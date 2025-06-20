import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import database from './database';
import runnerPoolManager from './runner-pool-manager';
import monitoringService from './monitoring';
import { RunnerPool } from '../types';

const logger = createLogger('AutoScaler');

export interface ScalingMetrics {
  timestamp: Date;
  repository: string;
  utilization: number;
  queueDepth: number;
  avgWaitTime: number;
  runnerCount: number;
  activeJobs: number;
  scalingDecision: 'scale-up' | 'scale-down' | 'maintain';
  reason: string;
}

export interface ScalingPolicy {
  repository: string;
  scaleUpThreshold: number;    // Default: 80%
  scaleDownThreshold: number;  // Default: 20%
  scaleUpIncrement: number;    // Runners to add
  scaleDownIncrement: number;  // Runners to remove
  cooldownPeriod: number;      // Seconds between scaling actions
  queueDepthThreshold: number; // Jobs waiting threshold
  avgWaitTimeThreshold: number; // Seconds threshold
}

export class AutoScaler extends EventEmitter {
  private static instance: AutoScaler;
  private policies: Map<string, ScalingPolicy> = new Map();
  private lastScalingAction: Map<string, Date> = new Map();
  private scalingInterval: NodeJS.Timeout | null = null;
  private metricsHistory: ScalingMetrics[] = [];
  private isScaling: Set<string> = new Set();

  private constructor() {
    super();
  }

  public static getInstance(): AutoScaler {
    if (!AutoScaler.instance) {
      AutoScaler.instance = new AutoScaler();
    }
    return AutoScaler.instance;
  }

  /**
   * Initialize the auto-scaler
   */
  async initialize(): Promise<void> {
    logger.info('Initializing auto-scaler');

    try {
      // Load scaling policies from database
      await this.loadPolicies();

      // Start monitoring
      this.startMonitoring();

      logger.info('Auto-scaler initialized');
    } catch (error) {
      logger.error('Failed to initialize auto-scaler', { error });
      throw error;
    }
  }

  /**
   * Load or create default scaling policies
   */
  private async loadPolicies(): Promise<void> {
    // Get all runner pools
    const pools = await runnerPoolManager.getAllPools();

    for (const pool of pools) {
      const policy: ScalingPolicy = {
        repository: pool.repository,
        scaleUpThreshold: pool.scaleThreshold || 0.8,
        scaleDownThreshold: 0.2,
        scaleUpIncrement: pool.scaleIncrement || 5,
        scaleDownIncrement: Math.max(1, Math.floor(pool.scaleIncrement / 2)),
        cooldownPeriod: 300, // 5 minutes
        queueDepthThreshold: 5,
        avgWaitTimeThreshold: 60 // 1 minute
      };

      this.policies.set(pool.repository, policy);
      logger.info('Loaded scaling policy', { repository: pool.repository, policy });
    }

    // Add default policy for new repositories
    if (!this.policies.has('*')) {
      this.policies.set('*', {
        repository: '*',
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.2,
        scaleUpIncrement: 3,
        scaleDownIncrement: 1,
        cooldownPeriod: 300,
        queueDepthThreshold: 3,
        avgWaitTimeThreshold: 30
      });
    }
  }

  /**
   * Get or create policy for repository
   */
  private getPolicy(repository: string): ScalingPolicy {
    return this.policies.get(repository) || this.policies.get('*')!;
  }

  /**
   * Check if repository is in cooldown
   */
  private isInCooldown(repository: string, policy: ScalingPolicy): boolean {
    const lastAction = this.lastScalingAction.get(repository);
    if (!lastAction) return false;

    const timeSinceLastAction = Date.now() - lastAction.getTime();
    return timeSinceLastAction < policy.cooldownPeriod * 1000;
  }

  /**
   * Collect metrics for scaling decision
   */
  private async collectMetrics(repository: string): Promise<ScalingMetrics> {
    // Get pool metrics
    const poolMetrics = await runnerPoolManager.getPoolMetrics(repository);

    // Get queue depth and wait times
    const [queueStats] = await database.query<any>(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as queue_depth,
        AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))) 
          FILTER (WHERE status = 'pending') as avg_wait_time,
        COUNT(*) FILTER (WHERE status = 'running') as active_jobs
      FROM runnerhub.jobs
      WHERE repository = $1
      AND created_at >= CURRENT_TIMESTAMP - INTERVAL '5 minutes'
    `, [repository]);

    return {
      timestamp: new Date(),
      repository,
      utilization: poolMetrics.utilization,
      queueDepth: parseInt(queueStats.queue_depth) || 0,
      avgWaitTime: parseFloat(queueStats.avg_wait_time) || 0,
      runnerCount: poolMetrics.totalRunners,
      activeJobs: parseInt(queueStats.active_jobs) || 0,
      scalingDecision: 'maintain',
      reason: 'Initial metrics collection'
    };
  }

  /**
   * Make scaling decision based on metrics
   */
  private makeScalingDecision(
    metrics: ScalingMetrics,
    policy: ScalingPolicy,
    pool: RunnerPool
  ): ScalingMetrics {
    // Check if we're already scaling
    if (this.isScaling.has(metrics.repository)) {
      return {
        ...metrics,
        scalingDecision: 'maintain',
        reason: 'Scaling already in progress'
      };
    }

    // Check cooldown
    if (this.isInCooldown(metrics.repository, policy)) {
      return {
        ...metrics,
        scalingDecision: 'maintain',
        reason: 'In cooldown period'
      };
    }

    // Priority 1: Queue depth (immediate response needed)
    if (metrics.queueDepth >= policy.queueDepthThreshold) {
      if (metrics.runnerCount < pool.maxRunners) {
        return {
          ...metrics,
          scalingDecision: 'scale-up',
          reason: `Queue depth (${metrics.queueDepth}) exceeds threshold (${policy.queueDepthThreshold})`
        };
      }
    }

    // Priority 2: High utilization
    if (metrics.utilization >= policy.scaleUpThreshold) {
      if (metrics.runnerCount < pool.maxRunners) {
        return {
          ...metrics,
          scalingDecision: 'scale-up',
          reason: `Utilization (${(metrics.utilization * 100).toFixed(0)}%) exceeds threshold (${(policy.scaleUpThreshold * 100).toFixed(0)}%)`
        };
      }
    }

    // Priority 3: Average wait time
    if (metrics.avgWaitTime > policy.avgWaitTimeThreshold) {
      if (metrics.runnerCount < pool.maxRunners) {
        return {
          ...metrics,
          scalingDecision: 'scale-up',
          reason: `Average wait time (${metrics.avgWaitTime.toFixed(0)}s) exceeds threshold (${policy.avgWaitTimeThreshold}s)`
        };
      }
    }

    // Check for scale down conditions
    if (metrics.utilization <= policy.scaleDownThreshold) {
      if (metrics.runnerCount > pool.minRunners) {
        // Additional checks before scaling down
        if (metrics.queueDepth === 0 && metrics.activeJobs === 0) {
          return {
            ...metrics,
            scalingDecision: 'scale-down',
            reason: `Low utilization (${(metrics.utilization * 100).toFixed(0)}%) with no pending jobs`
          };
        }
      }
    }

    return {
      ...metrics,
      scalingDecision: 'maintain',
      reason: 'Metrics within normal range'
    };
  }

  /**
   * Execute scaling action
   */
  private async executeScaling(
    decision: ScalingMetrics,
    policy: ScalingPolicy,
    pool: RunnerPool
  ): Promise<void> {
    if (decision.scalingDecision === 'maintain') {
      return;
    }

    this.isScaling.add(decision.repository);

    try {
      if (decision.scalingDecision === 'scale-up') {
        const runnersToAdd = Math.min(
          policy.scaleUpIncrement,
          pool.maxRunners - decision.runnerCount
        );

        logger.info('Scaling up runners', {
          repository: decision.repository,
          count: runnersToAdd,
          reason: decision.reason
        });

        await runnerPoolManager.scaleUp(decision.repository, runnersToAdd);

        this.emit('scaled-up', {
          repository: decision.repository,
          runnersAdded: runnersToAdd,
          reason: decision.reason,
          metrics: decision
        });

        monitoringService.recordScalingEvent(
          decision.repository,
          'scale-up',
          runnersToAdd,
          decision.reason
        );
      } else if (decision.scalingDecision === 'scale-down') {
        const runnersToRemove = Math.min(
          policy.scaleDownIncrement,
          decision.runnerCount - pool.minRunners
        );

        logger.info('Scaling down runners', {
          repository: decision.repository,
          count: runnersToRemove,
          reason: decision.reason
        });

        const removed = await runnerPoolManager.scaleDown(decision.repository);

        this.emit('scaled-down', {
          repository: decision.repository,
          runnersRemoved: removed,
          reason: decision.reason,
          metrics: decision
        });

        monitoringService.recordScalingEvent(
          decision.repository,
          'scale-down',
          removed,
          decision.reason
        );
      }

      // Update last scaling time
      this.lastScalingAction.set(decision.repository, new Date());
    } catch (error) {
      logger.error('Failed to execute scaling', {
        repository: decision.repository,
        decision: decision.scalingDecision,
        error
      });

      this.emit('scaling-error', {
        repository: decision.repository,
        error,
        metrics: decision
      });
    } finally {
      this.isScaling.delete(decision.repository);
    }
  }

  /**
   * Start monitoring for auto-scaling
   */
  private startMonitoring(): void {
    // Run every 30 seconds
    this.scalingInterval = setInterval(async () => {
      try {
        const pools = await runnerPoolManager.getAllPools();

        for (const pool of pools) {
          try {
            // Collect metrics
            const metrics = await this.collectMetrics(pool.repository);

            // Make scaling decision
            const policy = this.getPolicy(pool.repository);
            const decision = this.makeScalingDecision(metrics, policy, pool);

            // Store metrics
            this.metricsHistory.push(decision);
            
            // Keep only last hour of metrics
            const oneHourAgo = Date.now() - 3600000;
            this.metricsHistory = this.metricsHistory.filter(
              m => m.timestamp.getTime() > oneHourAgo
            );

            // Log decision
            if (decision.scalingDecision !== 'maintain') {
              logger.info('Scaling decision', {
                repository: pool.repository,
                decision: decision.scalingDecision,
                reason: decision.reason,
                metrics: {
                  utilization: decision.utilization,
                  queueDepth: decision.queueDepth,
                  avgWaitTime: decision.avgWaitTime
                }
              });
            }

            // Execute scaling
            await this.executeScaling(decision, policy, pool);
          } catch (error) {
            logger.error('Error processing repository for auto-scaling', {
              repository: pool.repository,
              error
            });
          }
        }
      } catch (error) {
        logger.error('Auto-scaling monitoring error', { error });
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Update scaling policy
   */
  async updatePolicy(repository: string, updates: Partial<ScalingPolicy>): Promise<void> {
    const currentPolicy = this.getPolicy(repository);
    const newPolicy = { ...currentPolicy, ...updates, repository };

    this.policies.set(repository, newPolicy);

    logger.info('Updated scaling policy', { repository, policy: newPolicy });

    this.emit('policy-updated', { repository, policy: newPolicy });
  }

  /**
   * Get scaling metrics history
   */
  getMetricsHistory(repository?: string, minutes: number = 60): ScalingMetrics[] {
    const cutoff = Date.now() - minutes * 60000;
    
    return this.metricsHistory
      .filter(m => 
        m.timestamp.getTime() > cutoff &&
        (!repository || m.repository === repository)
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Get current scaling status
   */
  getScalingStatus(): Map<string, any> {
    const status = new Map<string, any>();

    for (const [repo, policy] of this.policies) {
      const lastAction = this.lastScalingAction.get(repo);
      const inCooldown = this.isInCooldown(repo, policy);
      const isScaling = this.isScaling.has(repo);

      status.set(repo, {
        policy,
        lastAction,
        inCooldown,
        isScaling,
        cooldownRemaining: lastAction && inCooldown
          ? Math.max(0, policy.cooldownPeriod - 
            (Date.now() - lastAction.getTime()) / 1000)
          : 0
      });
    }

    return status;
  }

  /**
   * Predict scaling needs based on historical data
   */
  async predictScalingNeeds(repository: string, minutes: number = 30): Promise<{
    predictedUtilization: number;
    recommendedRunners: number;
    confidence: number;
  }> {
    const history = this.getMetricsHistory(repository, 60);
    
    if (history.length < 10) {
      return {
        predictedUtilization: 0,
        recommendedRunners: 0,
        confidence: 0
      };
    }

    // Simple linear regression for utilization trend
    const recentMetrics = history.slice(-10);
    const avgUtilization = recentMetrics.reduce((sum, m) => sum + m.utilization, 0) / recentMetrics.length;
    const avgQueueDepth = recentMetrics.reduce((sum, m) => sum + m.queueDepth, 0) / recentMetrics.length;

    // Calculate trend
    const firstHalf = recentMetrics.slice(0, 5);
    const secondHalf = recentMetrics.slice(5);
    
    const firstAvg = firstHalf.reduce((sum, m) => sum + m.utilization, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, m) => sum + m.utilization, 0) / secondHalf.length;
    
    const trend = secondAvg - firstAvg;
    const predictedUtilization = Math.min(1, Math.max(0, avgUtilization + trend * (minutes / 30)));

    // Calculate recommended runners
    const pool = await runnerPoolManager.getOrCreatePool(repository);
    const currentRunners = recentMetrics[recentMetrics.length - 1].runnerCount;
    let recommendedRunners = currentRunners;

    if (predictedUtilization > 0.8 || avgQueueDepth > 3) {
      recommendedRunners = Math.min(
        pool.maxRunners,
        Math.ceil(currentRunners * (predictedUtilization / 0.7))
      );
    } else if (predictedUtilization < 0.3 && avgQueueDepth === 0) {
      recommendedRunners = Math.max(
        pool.minRunners,
        Math.floor(currentRunners * 0.7)
      );
    }

    // Confidence based on data consistency
    const utilizationVariance = recentMetrics.reduce((sum, m) => 
      sum + Math.pow(m.utilization - avgUtilization, 2), 0
    ) / recentMetrics.length;
    
    const confidence = Math.max(0, Math.min(1, 1 - Math.sqrt(utilizationVariance)));

    return {
      predictedUtilization,
      recommendedRunners,
      confidence
    };
  }

  /**
   * Force immediate scaling evaluation
   */
  async evaluateNow(repository: string): Promise<ScalingMetrics> {
    const pool = await runnerPoolManager.getOrCreatePool(repository);
    const policy = this.getPolicy(repository);
    const metrics = await this.collectMetrics(repository);
    const decision = this.makeScalingDecision(metrics, policy, pool);

    logger.info('Manual scaling evaluation', {
      repository,
      decision: decision.scalingDecision,
      reason: decision.reason
    });

    // Clear cooldown for manual evaluation
    this.lastScalingAction.delete(repository);
    
    // Execute if needed
    await this.executeScaling(decision, policy, pool);

    return decision;
  }

  /**
   * Stop auto-scaler
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down auto-scaler');

    if (this.scalingInterval) {
      clearInterval(this.scalingInterval);
      this.scalingInterval = null;
    }

    this.metricsHistory = [];
    this.policies.clear();
    this.lastScalingAction.clear();
    this.isScaling.clear();
  }
}

export default AutoScaler.getInstance();