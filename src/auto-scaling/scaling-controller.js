/**
 * Horizontal Scaling Controller
 * Manages scale-up and scale-down operations for GitHub Actions runners
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class ScalingController extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Scaling boundaries
      minRunners: options.minRunners || 1,
      maxRunners: options.maxRunners || 100,
      
      // Scaling thresholds
      scaleUpThreshold: options.scaleUpThreshold || 0.8, // 80% utilization
      scaleDownThreshold: options.scaleDownThreshold || 0.3, // 30% utilization
      targetUtilization: options.targetUtilization || 0.6, // 60% target
      
      // Scaling rates
      scaleUpRate: options.scaleUpRate || 0.5, // Scale up by 50% of current
      scaleDownRate: options.scaleDownRate || 0.2, // Scale down by 20% of current
      maxScaleUpStep: options.maxScaleUpStep || 10, // Max runners to add at once
      maxScaleDownStep: options.maxScaleDownStep || 5, // Max runners to remove at once
      
      // Timing configuration
      scaleUpDelay: options.scaleUpDelay || 60000, // 1 minute
      scaleDownDelay: options.scaleDownDelay || 600000, // 10 minutes
      cooldownPeriod: options.cooldownPeriod || 300000, // 5 minutes
      gracefulShutdownTimeout: options.gracefulShutdownTimeout || 300000, // 5 minutes
      
      // Runner configuration
      runnerTypes: options.runnerTypes || [
        { name: 'small', cpu: 2, memory: 4, labels: ['self-hosted', 'small'] },
        { name: 'medium', cpu: 4, memory: 8, labels: ['self-hosted', 'medium'] },
        { name: 'large', cpu: 8, memory: 16, labels: ['self-hosted', 'large'] }
      ],
      defaultRunnerType: options.defaultRunnerType || 'medium',
      
      // Cloud provider configuration
      cloudProvider: {
        enabled: options.cloudProviderEnabled !== false,
        type: options.cloudProviderType || 'aws', // aws, gcp, azure
        regions: options.cloudRegions || ['us-east-1', 'us-west-2'],
        instanceTypes: options.instanceTypes || {
          small: 't3.medium',
          medium: 't3.large',
          large: 't3.xlarge'
        },
        spotEnabled: options.spotEnabled !== false,
        spotMaxPrice: options.spotMaxPrice || 0.5 // 50% of on-demand
      },
      
      // Multi-region support
      multiRegion: {
        enabled: options.multiRegionEnabled !== false,
        strategy: options.multiRegionStrategy || 'balanced', // balanced, latency, cost
        maxRegions: options.maxRegions || 3,
        regionWeights: options.regionWeights || {}
      },
      
      // Scaling policies
      policies: {
        aggressive: {
          scaleUpRate: 1.0, // Double capacity
          scaleDownRate: 0.1, // Reduce by 10%
          scaleUpDelay: 30000, // 30 seconds
          scaleDownDelay: 900000 // 15 minutes
        },
        balanced: {
          scaleUpRate: 0.5,
          scaleDownRate: 0.2,
          scaleUpDelay: 60000,
          scaleDownDelay: 600000
        },
        conservative: {
          scaleUpRate: 0.25,
          scaleDownRate: 0.1,
          scaleUpDelay: 120000,
          scaleDownDelay: 1200000 // 20 minutes
        }
      },
      currentPolicy: options.scalingPolicy || 'balanced',
      
      // Integration points
      runnerPool: options.runnerPool || null,
      dockerAPI: options.dockerAPI || null,
      cloudAPI: options.cloudAPI || null,
      monitoringSystem: options.monitoringSystem || null,
      
      ...options
    };
    
    // Apply policy settings
    this.applyPolicy(this.config.currentPolicy);
    
    // Scaling state
    this.scalingState = {
      currentRunners: new Map(), // runnerId -> runnerInfo
      runnersByRegion: new Map(), // region -> Set of runnerIds
      runnersByType: new Map(), // type -> Set of runnerIds
      pendingScaleOps: [],
      lastScaleUp: null,
      lastScaleDown: null,
      inCooldown: false,
      scalingInProgress: false
    };
    
    // Metrics
    this.metrics = {
      totalScaleUps: 0,
      totalScaleDowns: 0,
      successfulScaleUps: 0,
      successfulScaleDowns: 0,
      failedScaleUps: 0,
      failedScaleDowns: 0,
      avgScaleUpTime: 0,
      avgScaleDownTime: 0,
      runnerLifecycles: new Map() // runnerId -> { startTime, endTime, totalJobs }
    };
    
    // Statistics
    this.stats = {
      runnersCreated: 0,
      runnersTerminated: 0,
      totalJobsProcessed: 0,
      avgRunnerLifetime: 0,
      avgJobsPerRunner: 0,
      regionDistribution: new Map(),
      typeDistribution: new Map()
    };
    
    this.scaleUpTimer = null;
    this.scaleDownTimer = null;
    this.cooldownTimer = null;
    this.isStarted = false;
  }

  /**
   * Apply scaling policy
   */
  applyPolicy(policyName) {
    const policy = this.config.policies[policyName];
    if (!policy) {
      logger.warn(`Unknown scaling policy: ${policyName}, using balanced`);
      return;
    }
    
    Object.assign(this.config, policy);
    this.config.currentPolicy = policyName;
    logger.info(`Applied scaling policy: ${policyName}`);
  }

  /**
   * Start scaling controller
   */
  async start() {
    if (this.isStarted) {
      logger.warn('Scaling Controller already started');
      return;
    }
    
    logger.info('Starting Scaling Controller');
    
    // Initialize current state
    await this.initializeState();
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Scaling Controller started successfully');
  }

  /**
   * Initialize scaling state
   */
  async initializeState() {
    try {
      // Get current runners from runner pool
      if (this.config.runnerPool) {
        const runners = await this.config.runnerPool.getRunners();
        
        for (const runner of runners) {
          this.scalingState.currentRunners.set(runner.id, {
            id: runner.id,
            type: runner.type || this.config.defaultRunnerType,
            region: runner.region || this.config.cloudProvider.regions[0],
            status: runner.status,
            startTime: runner.startTime || new Date(),
            labels: runner.labels || []
          });
          
          // Update region mapping
          if (!this.scalingState.runnersByRegion.has(runner.region)) {
            this.scalingState.runnersByRegion.set(runner.region, new Set());
          }
          this.scalingState.runnersByRegion.get(runner.region).add(runner.id);
          
          // Update type mapping
          const type = runner.type || this.config.defaultRunnerType;
          if (!this.scalingState.runnersByType.has(type)) {
            this.scalingState.runnersByType.set(type, new Set());
          }
          this.scalingState.runnersByType.get(type).add(runner.id);
        }
      }
      
      logger.info(`Initialized with ${this.scalingState.currentRunners.size} existing runners`);
      
    } catch (error) {
      logger.error('Failed to initialize scaling state:', error);
    }
  }

  /**
   * Execute scale decision
   */
  async executeScaleDecision(decision) {
    const { action, count, reason, metrics } = decision;
    
    if (this.scalingState.scalingInProgress) {
      logger.debug('Scaling operation already in progress, queuing decision');
      this.scalingState.pendingScaleOps.push(decision);
      return;
    }
    
    if (this.scalingState.inCooldown) {
      logger.debug('In cooldown period, skipping scale decision');
      return;
    }
    
    this.scalingState.scalingInProgress = true;
    const startTime = Date.now();
    
    try {
      let result;
      
      if (action === 'scale-up') {
        result = await this.scaleUp(count, reason, metrics);
      } else if (action === 'scale-down') {
        result = await this.scaleDown(count, reason, metrics);
      } else {
        throw new Error(`Unknown scale action: ${action}`);
      }
      
      const duration = Date.now() - startTime;
      this.updateMetrics(action, true, duration);
      
      // Start cooldown
      this.startCooldown();
      
      this.emit('scalingCompleted', {
        action,
        count,
        reason,
        duration,
        result,
        timestamp: new Date()
      });
      
      return result;
      
    } catch (error) {
      logger.error(`Scaling ${action} failed:`, error);
      this.updateMetrics(action, false, Date.now() - startTime);
      
      this.emit('scalingFailed', {
        action,
        count,
        reason,
        error: error.message,
        timestamp: new Date()
      });
      
      throw error;
      
    } finally {
      this.scalingState.scalingInProgress = false;
      
      // Process pending operations
      if (this.scalingState.pendingScaleOps.length > 0) {
        const nextOp = this.scalingState.pendingScaleOps.shift();
        setTimeout(() => this.executeScaleDecision(nextOp), 1000);
      }
    }
  }

  /**
   * Scale up runners
   */
  async scaleUp(count, reason, metrics) {
    logger.info(`Scaling up by ${count} runners. Reason: ${reason}`);
    
    // Apply constraints
    const currentCount = this.scalingState.currentRunners.size;
    const targetCount = currentCount + count;
    const actualCount = Math.min(count, this.config.maxRunners - currentCount);
    
    if (actualCount <= 0) {
      logger.warn('Already at maximum runner capacity');
      return { added: 0, reason: 'max_capacity_reached' };
    }
    
    // Determine runner distribution
    const distribution = this.calculateRunnerDistribution(actualCount, metrics);
    
    // Create runners
    const createdRunners = [];
    const errors = [];
    
    for (const { type, region, count: regionCount } of distribution) {
      try {
        const runners = await this.createRunners(type, region, regionCount);
        createdRunners.push(...runners);
      } catch (error) {
        logger.error(`Failed to create runners in ${region}:`, error);
        errors.push({ region, error: error.message });
      }
    }
    
    // Update state
    for (const runner of createdRunners) {
      this.scalingState.currentRunners.set(runner.id, runner);
      
      // Update region mapping
      if (!this.scalingState.runnersByRegion.has(runner.region)) {
        this.scalingState.runnersByRegion.set(runner.region, new Set());
      }
      this.scalingState.runnersByRegion.get(runner.region).add(runner.id);
      
      // Update type mapping
      if (!this.scalingState.runnersByType.has(runner.type)) {
        this.scalingState.runnersByType.set(runner.type, new Set());
      }
      this.scalingState.runnersByType.get(runner.type).add(runner.id);
      
      // Track lifecycle
      this.metrics.runnerLifecycles.set(runner.id, {
        startTime: new Date(),
        totalJobs: 0
      });
    }
    
    this.scalingState.lastScaleUp = new Date();
    this.stats.runnersCreated += createdRunners.length;
    
    return {
      added: createdRunners.length,
      targetCount,
      actualCount,
      distribution,
      errors,
      runners: createdRunners
    };
  }

  /**
   * Scale down runners
   */
  async scaleDown(count, reason, metrics) {
    logger.info(`Scaling down by ${count} runners. Reason: ${reason}`);
    
    // Apply constraints
    const currentCount = this.scalingState.currentRunners.size;
    const targetCount = Math.max(this.config.minRunners, currentCount - count);
    const actualCount = currentCount - targetCount;
    
    if (actualCount <= 0) {
      logger.warn('Already at minimum runner capacity');
      return { removed: 0, reason: 'min_capacity_reached' };
    }
    
    // Select runners to remove
    const runnersToRemove = await this.selectRunnersForRemoval(actualCount);
    
    // Gracefully shutdown runners
    const removedRunners = [];
    const errors = [];
    
    for (const runner of runnersToRemove) {
      try {
        await this.gracefullyShutdownRunner(runner);
        removedRunners.push(runner);
      } catch (error) {
        logger.error(`Failed to shutdown runner ${runner.id}:`, error);
        errors.push({ runner: runner.id, error: error.message });
      }
    }
    
    // Update state
    for (const runner of removedRunners) {
      this.scalingState.currentRunners.delete(runner.id);
      
      // Update region mapping
      if (this.scalingState.runnersByRegion.has(runner.region)) {
        this.scalingState.runnersByRegion.get(runner.region).delete(runner.id);
      }
      
      // Update type mapping
      if (this.scalingState.runnersByType.has(runner.type)) {
        this.scalingState.runnersByType.get(runner.type).delete(runner.id);
      }
      
      // Complete lifecycle tracking
      if (this.metrics.runnerLifecycles.has(runner.id)) {
        const lifecycle = this.metrics.runnerLifecycles.get(runner.id);
        lifecycle.endTime = new Date();
        lifecycle.lifetime = lifecycle.endTime - lifecycle.startTime;
      }
    }
    
    this.scalingState.lastScaleDown = new Date();
    this.stats.runnersTerminated += removedRunners.length;
    
    return {
      removed: removedRunners.length,
      targetCount,
      actualCount,
      errors,
      runners: removedRunners
    };
  }

  /**
   * Calculate runner distribution across regions and types
   */
  calculateRunnerDistribution(count, metrics) {
    const distribution = [];
    
    if (!this.config.multiRegion.enabled) {
      // Single region
      distribution.push({
        type: this.config.defaultRunnerType,
        region: this.config.cloudProvider.regions[0],
        count
      });
      return distribution;
    }
    
    // Multi-region distribution
    const regions = this.config.cloudProvider.regions.slice(0, this.config.multiRegion.maxRegions);
    let remainingCount = count;
    
    switch (this.config.multiRegion.strategy) {
      case 'balanced':
        // Distribute evenly across regions
        const perRegion = Math.floor(count / regions.length);
        const remainder = count % regions.length;
        
        regions.forEach((region, index) => {
          const regionCount = perRegion + (index < remainder ? 1 : 0);
          if (regionCount > 0) {
            distribution.push({
              type: this.determineRunnerType(metrics),
              region,
              count: regionCount
            });
          }
        });
        break;
        
      case 'latency':
        // Prioritize regions with lower latency
        // For now, use first region as primary
        distribution.push({
          type: this.determineRunnerType(metrics),
          region: regions[0],
          count: Math.ceil(count * 0.6)
        });
        
        remainingCount = count - Math.ceil(count * 0.6);
        if (remainingCount > 0 && regions.length > 1) {
          distribution.push({
            type: this.determineRunnerType(metrics),
            region: regions[1],
            count: remainingCount
          });
        }
        break;
        
      case 'cost':
        // Prioritize cheaper regions
        // This would integrate with cloud pricing APIs
        // For now, distribute based on weights
        for (const region of regions) {
          const weight = this.config.multiRegion.regionWeights[region] || 1;
          const regionCount = Math.round(count * weight / regions.length);
          if (regionCount > 0) {
            distribution.push({
              type: this.determineRunnerType(metrics),
              region,
              count: regionCount
            });
            remainingCount -= regionCount;
          }
        }
        
        // Add remainder to first region
        if (remainingCount > 0) {
          distribution[0].count += remainingCount;
        }
        break;
    }
    
    return distribution;
  }

  /**
   * Determine runner type based on workload
   */
  determineRunnerType(metrics) {
    if (!metrics || !metrics.jobs) {
      return this.config.defaultRunnerType;
    }
    
    // Simple heuristic based on queue size
    const avgQueueSize = metrics.jobs.queued || 0;
    
    if (avgQueueSize > 50) {
      return 'large'; // High load, use larger runners
    } else if (avgQueueSize > 20) {
      return 'medium';
    } else {
      return 'small';
    }
  }

  /**
   * Create runners
   */
  async createRunners(type, region, count) {
    const runners = [];
    const runnerConfig = this.config.runnerTypes.find(r => r.name === type) || 
                        this.config.runnerTypes.find(r => r.name === this.config.defaultRunnerType);
    
    for (let i = 0; i < count; i++) {
      const runnerId = `runner-${type}-${region}-${Date.now()}-${i}`;
      
      try {
        let instanceInfo = null;
        
        // Create cloud instance if enabled
        if (this.config.cloudProvider.enabled && this.config.cloudAPI) {
          instanceInfo = await this.createCloudInstance(type, region);
        }
        
        // Register runner with GitHub
        const runner = {
          id: runnerId,
          type,
          region,
          labels: runnerConfig.labels,
          status: 'starting',
          startTime: new Date(),
          instanceId: instanceInfo?.instanceId,
          ipAddress: instanceInfo?.ipAddress,
          cpu: runnerConfig.cpu,
          memory: runnerConfig.memory
        };
        
        // Register with runner pool
        if (this.config.runnerPool) {
          await this.config.runnerPool.registerRunner(runner);
        }
        
        runners.push(runner);
        logger.info(`Created runner ${runnerId} in ${region}`);
        
      } catch (error) {
        logger.error(`Failed to create runner ${runnerId}:`, error);
        throw error;
      }
    }
    
    return runners;
  }

  /**
   * Create cloud instance
   */
  async createCloudInstance(type, region) {
    if (!this.config.cloudAPI) {
      throw new Error('Cloud API not configured');
    }
    
    const instanceType = this.config.cloudProvider.instanceTypes[type];
    
    const instanceConfig = {
      instanceType,
      region,
      imageId: 'github-runner-latest',
      securityGroups: ['github-runners'],
      userData: this.generateUserData(type),
      tags: {
        Name: `github-runner-${type}-${Date.now()}`,
        Type: 'github-runner',
        RunnerType: type,
        ManagedBy: 'runnerhub'
      }
    };
    
    // Try spot instance first if enabled
    if (this.config.cloudProvider.spotEnabled) {
      try {
        const spotPrice = await this.config.cloudAPI.getSpotPrice(instanceType, region);
        const onDemandPrice = await this.config.cloudAPI.getOnDemandPrice(instanceType, region);
        
        if (spotPrice <= onDemandPrice * this.config.cloudProvider.spotMaxPrice) {
          instanceConfig.spotPrice = spotPrice;
          return await this.config.cloudAPI.createSpotInstance(instanceConfig);
        }
      } catch (error) {
        logger.warn('Failed to create spot instance, falling back to on-demand:', error);
      }
    }
    
    // Create on-demand instance
    return await this.config.cloudAPI.createInstance(instanceConfig);
  }

  /**
   * Generate user data script for cloud instances
   */
  generateUserData(type) {
    return `#!/bin/bash
# GitHub Runner Setup Script
set -e

# Update system
apt-get update
apt-get install -y docker.io curl jq

# Install GitHub runner
RUNNER_VERSION="2.311.0"
cd /home/ubuntu
curl -o actions-runner-linux-x64-\${RUNNER_VERSION}.tar.gz -L https://github.com/actions/runner/releases/download/v\${RUNNER_VERSION}/actions-runner-linux-x64-\${RUNNER_VERSION}.tar.gz
tar xzf actions-runner-linux-x64-\${RUNNER_VERSION}.tar.gz
rm actions-runner-linux-x64-\${RUNNER_VERSION}.tar.gz

# Configure runner
./config.sh --url https://github.com/YOUR_ORG --token YOUR_TOKEN --labels ${type},self-hosted --unattended

# Start runner service
./svc.sh install
./svc.sh start

# Report ready
curl -X POST http://runnerhub-api/runners/ready -d '{"type":"${type}"}'
`;
  }

  /**
   * Select runners for removal
   */
  async selectRunnersForRemoval(count) {
    const candidates = [];
    
    // Get runner statistics
    for (const [runnerId, runner] of this.scalingState.currentRunners) {
      const stats = await this.getRunnerStats(runnerId);
      candidates.push({
        ...runner,
        ...stats,
        score: this.calculateRemovalScore(runner, stats)
      });
    }
    
    // Sort by removal score (higher score = better candidate for removal)
    candidates.sort((a, b) => b.score - a.score);
    
    // Select top candidates
    return candidates.slice(0, count);
  }

  /**
   * Get runner statistics
   */
  async getRunnerStats(runnerId) {
    const stats = {
      isIdle: true,
      jobsProcessed: 0,
      lastJobTime: null,
      uptime: 0,
      utilizationRate: 0
    };
    
    // Get stats from runner pool
    if (this.config.runnerPool) {
      const runnerStats = await this.config.runnerPool.getRunnerStats(runnerId);
      Object.assign(stats, runnerStats);
    }
    
    // Calculate uptime
    const runner = this.scalingState.currentRunners.get(runnerId);
    if (runner && runner.startTime) {
      stats.uptime = Date.now() - runner.startTime.getTime();
    }
    
    return stats;
  }

  /**
   * Calculate removal score (higher = better candidate)
   */
  calculateRemovalScore(runner, stats) {
    let score = 0;
    
    // Prefer idle runners
    if (stats.isIdle) {
      score += 100;
    }
    
    // Prefer runners with low utilization
    score += (1 - stats.utilizationRate) * 50;
    
    // Prefer newer runners (LIFO for cost optimization)
    const ageHours = stats.uptime / (1000 * 60 * 60);
    if (ageHours < 1) {
      score += 30; // Very new, good candidate
    } else if (ageHours > 24) {
      score -= 20; // Old runner, might want to keep for stability
    }
    
    // Prefer runners with fewer processed jobs
    if (stats.jobsProcessed === 0) {
      score += 20;
    } else if (stats.jobsProcessed < 5) {
      score += 10;
    }
    
    // Consider runner type (prefer removing smaller runners)
    if (runner.type === 'small') {
      score += 10;
    } else if (runner.type === 'large') {
      score -= 10;
    }
    
    // Consider region (can be customized based on strategy)
    // For now, no region preference
    
    return score;
  }

  /**
   * Gracefully shutdown runner
   */
  async gracefullyShutdownRunner(runner) {
    logger.info(`Gracefully shutting down runner ${runner.id}`);
    
    try {
      // Mark runner as draining (no new jobs)
      if (this.config.runnerPool) {
        await this.config.runnerPool.drainRunner(runner.id);
      }
      
      // Wait for current job to complete
      const timeout = this.config.gracefulShutdownTimeout;
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeout) {
        const stats = await this.getRunnerStats(runner.id);
        if (stats.isIdle) {
          break;
        }
        
        logger.debug(`Waiting for runner ${runner.id} to become idle...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // Unregister runner
      if (this.config.runnerPool) {
        await this.config.runnerPool.unregisterRunner(runner.id);
      }
      
      // Terminate cloud instance if applicable
      if (runner.instanceId && this.config.cloudAPI) {
        await this.config.cloudAPI.terminateInstance(runner.instanceId, runner.region);
      }
      
      logger.info(`Successfully shutdown runner ${runner.id}`);
      
    } catch (error) {
      logger.error(`Error during graceful shutdown of runner ${runner.id}:`, error);
      throw error;
    }
  }

  /**
   * Start cooldown period
   */
  startCooldown() {
    this.scalingState.inCooldown = true;
    
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }
    
    this.cooldownTimer = setTimeout(() => {
      this.scalingState.inCooldown = false;
      logger.debug('Cooldown period ended');
    }, this.config.cooldownPeriod);
    
    logger.debug(`Started cooldown period for ${this.config.cooldownPeriod}ms`);
  }

  /**
   * Update metrics
   */
  updateMetrics(action, success, duration) {
    if (action === 'scale-up') {
      this.metrics.totalScaleUps++;
      if (success) {
        this.metrics.successfulScaleUps++;
        this.metrics.avgScaleUpTime = 
          (this.metrics.avgScaleUpTime * (this.metrics.successfulScaleUps - 1) + duration) / 
          this.metrics.successfulScaleUps;
      } else {
        this.metrics.failedScaleUps++;
      }
    } else if (action === 'scale-down') {
      this.metrics.totalScaleDowns++;
      if (success) {
        this.metrics.successfulScaleDowns++;
        this.metrics.avgScaleDownTime = 
          (this.metrics.avgScaleDownTime * (this.metrics.successfulScaleDowns - 1) + duration) / 
          this.metrics.successfulScaleDowns;
      } else {
        this.metrics.failedScaleDowns++;
      }
    }
  }

  /**
   * Get scaling recommendations
   */
  async getScalingRecommendations(metrics) {
    const recommendations = [];
    const currentCount = this.scalingState.currentRunners.size;
    
    // Check utilization
    if (metrics.utilization > this.config.scaleUpThreshold) {
      const recommended = Math.ceil(currentCount * (metrics.utilization / this.config.targetUtilization));
      recommendations.push({
        action: 'scale-up',
        count: recommended - currentCount,
        reason: 'high_utilization',
        confidence: 0.8
      });
    } else if (metrics.utilization < this.config.scaleDownThreshold) {
      const recommended = Math.floor(currentCount * (metrics.utilization / this.config.targetUtilization));
      recommendations.push({
        action: 'scale-down',
        count: currentCount - recommended,
        reason: 'low_utilization',
        confidence: 0.7
      });
    }
    
    // Check queue length
    if (metrics.jobs && metrics.jobs.queued > currentCount * 2) {
      recommendations.push({
        action: 'scale-up',
        count: Math.ceil(metrics.jobs.queued / 10),
        reason: 'high_queue_length',
        confidence: 0.9
      });
    }
    
    // Check regional balance
    if (this.config.multiRegion.enabled) {
      const imbalance = this.checkRegionalImbalance();
      if (imbalance) {
        recommendations.push(imbalance);
      }
    }
    
    return recommendations;
  }

  /**
   * Check regional imbalance
   */
  checkRegionalImbalance() {
    const regionCounts = new Map();
    let total = 0;
    
    for (const [region, runnerIds] of this.scalingState.runnersByRegion) {
      const count = runnerIds.size;
      regionCounts.set(region, count);
      total += count;
    }
    
    if (total === 0) return null;
    
    const avgPerRegion = total / regionCounts.size;
    const threshold = avgPerRegion * 0.3; // 30% deviation
    
    for (const [region, count] of regionCounts) {
      if (Math.abs(count - avgPerRegion) > threshold) {
        return {
          action: 'rebalance',
          region,
          currentCount: count,
          targetCount: Math.round(avgPerRegion),
          reason: 'regional_imbalance',
          confidence: 0.6
        };
      }
    }
    
    return null;
  }

  /**
   * Stop scaling controller
   */
  async stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Scaling Controller');
    
    // Clear timers
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Scaling Controller stopped');
  }

  /**
   * Check if healthy
   */
  async isHealthy() {
    return this.isStarted && !this.scalingState.scalingInProgress;
  }

  /**
   * Get statistics
   */
  getStatistics() {
    // Calculate additional stats
    let totalLifetime = 0;
    let totalJobs = 0;
    let completedLifecycles = 0;
    
    for (const [runnerId, lifecycle] of this.metrics.runnerLifecycles) {
      if (lifecycle.endTime) {
        totalLifetime += lifecycle.lifetime;
        totalJobs += lifecycle.totalJobs;
        completedLifecycles++;
      }
    }
    
    if (completedLifecycles > 0) {
      this.stats.avgRunnerLifetime = totalLifetime / completedLifecycles;
      this.stats.avgJobsPerRunner = totalJobs / completedLifecycles;
    }
    
    // Update distribution stats
    this.stats.regionDistribution.clear();
    for (const [region, runners] of this.scalingState.runnersByRegion) {
      this.stats.regionDistribution.set(region, runners.size);
    }
    
    this.stats.typeDistribution.clear();
    for (const [type, runners] of this.scalingState.runnersByType) {
      this.stats.typeDistribution.set(type, runners.size);
    }
    
    return {
      currentRunners: this.scalingState.currentRunners.size,
      runnersByRegion: Object.fromEntries(this.stats.regionDistribution),
      runnersByType: Object.fromEntries(this.stats.typeDistribution),
      metrics: this.metrics,
      stats: this.stats,
      policy: this.config.currentPolicy,
      lastScaleUp: this.scalingState.lastScaleUp,
      lastScaleDown: this.scalingState.lastScaleDown,
      inCooldown: this.scalingState.inCooldown
    };
  }
}

module.exports = ScalingController;