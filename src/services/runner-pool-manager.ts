import { createLogger } from '../utils/logger';
import database from './database';
import { RunnerPool, Runner, RunnerStatus, RunnerType, ScalingDecision } from '../types';
import { GitHubAPIService } from './github-api';
import { ProxyRunnerManager } from './proxy-runner';
import config from '../config';

const logger = createLogger('RunnerPoolManager');

export interface PoolMetrics {
  totalRunners: number;
  activeRunners: number;
  idleRunners: number;
  utilization: number;
}

export class RunnerPoolManager {
  private static instance: RunnerPoolManager;
  private githubApi: GitHubAPIService;
  private proxyRunnerManager: ProxyRunnerManager;
  private scalingInProgress: Set<string> = new Set();

  private constructor() {
    this.githubApi = new GitHubAPIService();
    this.proxyRunnerManager = new ProxyRunnerManager();
  }

  public static getInstance(): RunnerPoolManager {
    if (!RunnerPoolManager.instance) {
      RunnerPoolManager.instance = new RunnerPoolManager();
    }
    return RunnerPoolManager.instance;
  }

  /**
   * Initialize runner pools from database
   */
  async initialize(): Promise<void> {
    logger.info('Initializing runner pool manager');

    try {
      // Load existing pools from database
      const pools = await database.query<RunnerPool>(
        'SELECT * FROM runnerhub.runner_pools'
      );

      for (const pool of pools) {
        logger.info('Loaded runner pool', { 
          repository: pool.repository,
          min: pool.minRunners,
          max: pool.maxRunners
        });

        // Ensure minimum runners are running
        await this.ensureMinimumRunners(pool.repository);
      }

      // Start monitoring loop
      this.startMonitoring();
    } catch (error) {
      logger.error('Failed to initialize runner pool manager', { error });
      throw error;
    }
  }

  /**
   * Get or create runner pool for repository
   */
  async getOrCreatePool(repository: string): Promise<RunnerPool> {
    let [pool] = await database.query<RunnerPool>(
      'SELECT * FROM runnerhub.runner_pools WHERE repository = $1',
      [repository]
    );

    if (!pool) {
      // Create new pool with defaults
      [pool] = await database.query<RunnerPool>(
        `INSERT INTO runnerhub.runner_pools 
         (repository, min_runners, max_runners, scale_increment, scale_threshold)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          repository,
          config.runner.poolMin,
          config.runner.poolMax,
          config.runner.scaleIncrement,
          config.runner.scaleThreshold
        ]
      );

      logger.info('Created new runner pool', { repository });
    }

    return pool;
  }

  /**
   * Get active runners for a specific pool
   */
  async getActiveRunners(repository: string): Promise<Runner[]> {
    const runners = await database.query<Runner>(
      'SELECT * FROM runnerhub.runners WHERE repository = $1 AND status != $2',
      [repository, RunnerStatus.OFFLINE]
    );
    return runners;
  }

  /**
   * Get pool metrics for a repository
   */
  async getPoolMetrics(repository: string): Promise<PoolMetrics> {
    const runners = await database.query<Runner>(
      'SELECT * FROM runnerhub.runners WHERE repository = $1',
      [repository]
    );

    const totalRunners = runners.length;
    const activeRunners = runners.filter(r => r.status === RunnerStatus.BUSY).length;
    const idleRunners = runners.filter(r => r.status === RunnerStatus.IDLE).length;
    const utilization = totalRunners > 0 ? activeRunners / totalRunners : 0;

    return {
      totalRunners,
      activeRunners,
      idleRunners,
      utilization
    };
  }

  /**
   * Check if scaling is needed for a repository
   */
  async checkScaling(repository: string): Promise<ScalingDecision> {
    const pool = await this.getOrCreatePool(repository);
    const metrics = await this.getPoolMetrics(repository);

    logger.debug('Checking scaling for repository', { 
      repository,
      metrics,
      threshold: pool.scaleThreshold
    });

    // Check if we're already at max capacity
    if (metrics.totalRunners >= pool.maxRunners) {
      return {
        shouldScale: false,
        currentUtilization: metrics.utilization,
        runnersToAdd: 0,
        reason: 'Already at maximum capacity'
      };
    }

    // Check if utilization exceeds threshold
    if (metrics.utilization >= pool.scaleThreshold) {
      const runnersToAdd = Math.min(
        pool.scaleIncrement,
        pool.maxRunners - metrics.totalRunners
      );

      return {
        shouldScale: true,
        currentUtilization: metrics.utilization,
        runnersToAdd,
        reason: `Utilization ${(metrics.utilization * 100).toFixed(0)}% exceeds threshold ${(pool.scaleThreshold * 100).toFixed(0)}%`
      };
    }

    return {
      shouldScale: false,
      currentUtilization: metrics.utilization,
      runnersToAdd: 0,
      reason: 'Utilization within acceptable range'
    };
  }

  /**
   * Scale up runners for a repository
   */
  async scaleUp(repository: string, count: number): Promise<void> {
    if (this.scalingInProgress.has(repository)) {
      logger.warn('Scaling already in progress for repository', { repository });
      return;
    }

    this.scalingInProgress.add(repository);

    try {
      logger.info('Scaling up runners', { repository, count });

      const pool = await this.getOrCreatePool(repository);
      const promises: Promise<void>[] = [];

      for (let i = 0; i < count; i++) {
        promises.push(this.createRunner(repository, pool));
      }

      await Promise.all(promises);

      // Update pool metrics
      await database.query(
        'UPDATE runnerhub.runner_pools SET last_scaled_at = CURRENT_TIMESTAMP WHERE repository = $1',
        [repository]
      );

      logger.info('Successfully scaled up runners', { repository, count });
    } catch (error) {
      logger.error('Failed to scale up runners', { repository, error });
      throw error;
    } finally {
      this.scalingInProgress.delete(repository);
    }
  }

  /**
   * Scale down idle runners
   */
  async scaleDown(repository: string): Promise<number> {
    const pool = await this.getOrCreatePool(repository);
    const metrics = await this.getPoolMetrics(repository);

    // Don't scale below minimum
    if (metrics.totalRunners <= pool.minRunners) {
      return 0;
    }

    // Find idle runners that can be removed
    const idleRunners = await database.query<Runner>(
      `SELECT * FROM runnerhub.runners 
       WHERE repository = $1 
       AND status = $2 
       AND type = $3
       AND last_heartbeat < CURRENT_TIMESTAMP - INTERVAL '${config.runner.idleTimeout} seconds'
       LIMIT $4`,
      [
        repository, 
        RunnerStatus.IDLE, 
        RunnerType.EPHEMERAL,
        metrics.totalRunners - pool.minRunners
      ]
    );

    let removed = 0;
    for (const runner of idleRunners) {
      try {
        await this.removeRunner(runner.id);
        removed++;
      } catch (error) {
        logger.error('Failed to remove idle runner', { 
          runnerId: runner.id, 
          error 
        });
      }
    }

    if (removed > 0) {
      logger.info('Scaled down idle runners', { repository, count: removed });
    }

    return removed;
  }

  /**
   * Create a new runner
   */
  private async createRunner(repository: string, pool: RunnerPool): Promise<void> {
    const runnerName = `runner-${repository.replace('/', '-')}-${Date.now()}`;
    
    try {
      // For proxy runners, we need different logic
      if (pool.repository === '*') {
        // This is the default pool, create a proxy runner
        await this.proxyRunnerManager.createRunner({
          name: runnerName,
          url: `https://github.com/${repository}`,
          token: config.github.token,
          labels: ['self-hosted-proxy', 'ubuntu-latest'],
          orchestratorUrl: `http://localhost:${config.app.port}`,
          runnerPath: `/opt/runners/${runnerName}`,
          hooksPath: `/opt/runners/${runnerName}/hooks`
        });
      } else {
        // Repository-specific runner (ephemeral)
        logger.info('Creating ephemeral runner', { repository, name: runnerName });
        
        // Note: Ephemeral runners are created on-demand when jobs are delegated
        // This is just a placeholder registration
        await database.query(
          `INSERT INTO runnerhub.runners 
           (name, type, status, repository, labels)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            runnerName,
            RunnerType.EPHEMERAL,
            RunnerStatus.IDLE,
            repository,
            ['self-hosted', 'ephemeral', repository]
          ]
        );
      }

      // Update current runner count
      await database.query(
        'UPDATE runnerhub.runner_pools SET current_runners = current_runners + 1 WHERE repository = $1',
        [pool.repository === '*' ? repository : pool.repository]
      );
    } catch (error) {
      logger.error('Failed to create runner', { repository, error });
      throw error;
    }
  }

  /**
   * Remove a runner
   */
  async removeRunner(runnerId: string): Promise<void> {
    const [runner] = await database.query<Runner>(
      'SELECT * FROM runnerhub.runners WHERE id = $1',
      [runnerId]
    );

    if (!runner) {
      throw new Error(`Runner ${runnerId} not found`);
    }

    try {
      // Remove from GitHub if registered
      if (runner.githubRunnerId) {
        await this.githubApi.removeRunner(runner.repository!, runner.githubRunnerId);
      }

      // Remove from database
      await database.query(
        'DELETE FROM runnerhub.runners WHERE id = $1',
        [runnerId]
      );

      // Update pool count
      if (runner.repository) {
        await database.query(
          'UPDATE runnerhub.runner_pools SET current_runners = current_runners - 1 WHERE repository = $1',
          [runner.repository]
        );
      }

      logger.info('Removed runner', { runnerId, name: runner.name });
    } catch (error) {
      logger.error('Failed to remove runner', { runnerId, error });
      throw error;
    }
  }

  /**
   * Ensure minimum runners are running
   */
  private async ensureMinimumRunners(repository: string): Promise<void> {
    const pool = await this.getOrCreatePool(repository);
    const metrics = await this.getPoolMetrics(repository);

    if (metrics.totalRunners < pool.minRunners) {
      const needed = pool.minRunners - metrics.totalRunners;
      logger.info('Ensuring minimum runners', { repository, needed });
      await this.scaleUp(repository, needed);
    }
  }

  /**
   * Start monitoring loop
   */
  private monitoringInterval?: NodeJS.Timeout;

  private startMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      try {
        // Get all active repositories
        const pools = await database.query<RunnerPool>(
          'SELECT * FROM runnerhub.runner_pools'
        );

        for (const pool of pools) {
          // Check scaling
          const decision = await this.checkScaling(pool.repository);
          if (decision.shouldScale) {
            logger.info('Scaling decision', { 
              repository: pool.repository,
              ...decision 
            });
            await this.scaleUp(pool.repository, decision.runnersToAdd);
          }

          // Clean up idle runners
          await this.scaleDown(pool.repository);

          // Ensure minimum runners
          await this.ensureMinimumRunners(pool.repository);
        }

        // Clean up offline runners
        await this.cleanupOfflineRunners();
      } catch (error) {
        logger.error('Monitoring loop error', { error });
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Clean up offline runners
   */
  private async cleanupOfflineRunners(): Promise<void> {
    const offlineRunners = await database.query<Runner>(
      `SELECT * FROM runnerhub.runners 
       WHERE status = $1 
       AND last_heartbeat < CURRENT_TIMESTAMP - INTERVAL '5 minutes'`,
      [RunnerStatus.OFFLINE]
    );

    for (const runner of offlineRunners) {
      try {
        await this.removeRunner(runner.id);
      } catch (error) {
        logger.error('Failed to cleanup offline runner', { 
          runnerId: runner.id,
          error 
        });
      }
    }
  }

  /**
   * Get all runner pools
   */
  async getAllPools(): Promise<RunnerPool[]> {
    return await database.query<RunnerPool>(
      'SELECT * FROM runnerhub.runner_pools ORDER BY repository'
    );
  }

  /**
   * Update pool configuration
   */
  async updatePool(repository: string, updates: Partial<RunnerPool>): Promise<RunnerPool> {
    const setClause = [];
    const values: any[] = [repository];
    let paramCount = 1;

    if (updates.minRunners !== undefined) {
      setClause.push(`min_runners = $${++paramCount}`);
      values.push(updates.minRunners);
    }
    if (updates.maxRunners !== undefined) {
      setClause.push(`max_runners = $${++paramCount}`);
      values.push(updates.maxRunners);
    }
    if (updates.scaleIncrement !== undefined) {
      setClause.push(`scale_increment = $${++paramCount}`);
      values.push(updates.scaleIncrement);
    }
    if (updates.scaleThreshold !== undefined) {
      setClause.push(`scale_threshold = $${++paramCount}`);
      values.push(updates.scaleThreshold);
    }

    const [updatedPool] = await database.query<RunnerPool>(
      `UPDATE runnerhub.runner_pools 
       SET ${setClause.join(', ')}
       WHERE repository = $1
       RETURNING *`,
      values
    );

    logger.info('Updated runner pool configuration', { repository, updates });
    return updatedPool;
  }

  /**
   * Request a runner for a job (used by webhook integration)
   */
  async requestRunner(repository: string, labels: string[] = []): Promise<{ id: string; runner?: Runner }> {
    logger.info('Requesting runner for job', { repository, labels });

    try {
      // Get or create pool for repository
      await this.getOrCreatePool(repository);
      
      // Get available runners
      const activeRunners = await this.getActiveRunners(repository);
      const availableRunner = activeRunners.find(r => r.status === RunnerStatus.IDLE);

      if (availableRunner) {
        // Mark runner as busy
        await database.query(
          'UPDATE runnerhub.runners SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [RunnerStatus.BUSY, availableRunner.id]
        );

        logger.info('Assigned existing runner to job', { 
          runnerId: availableRunner.id, 
          repository 
        });

        return { 
          id: `request-${Date.now()}`, 
          runner: { ...availableRunner, status: RunnerStatus.BUSY }
        };
      }

      // Check if we can scale up
      const scalingDecision = await this.checkScaling(repository);
      if (scalingDecision.shouldScale && scalingDecision.runnersToAdd > 0) {
        await this.scaleUp(repository, 1);
        logger.info('Scaled up runners for job request', { repository });
      }

      // Return request ID (actual runner assignment happens asynchronously)
      return { id: `request-${Date.now()}-${repository.replace('/', '-')}` };

    } catch (error) {
      logger.error('Failed to request runner', { repository, labels, error });
      throw error;
    }
  }

  /**
   * Release a runner back to the pool (used by webhook integration)
   */
  async releaseRunner(runnerId: string): Promise<void> {
    logger.info('Releasing runner back to pool', { runnerId });

    try {
      // Find the runner
      const [runner] = await database.query<Runner>(
        'SELECT * FROM runnerhub.runners WHERE id = $1 OR runner_id = $1',
        [runnerId]
      );

      if (!runner) {
        logger.warn('Runner not found for release', { runnerId });
        return;
      }

      // Mark runner as idle and clear current job
      await database.query(
        `UPDATE runnerhub.runners 
         SET status = $1, current_job_id = NULL, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [RunnerStatus.IDLE, runner.id]
      );

      logger.info('Released runner back to pool', { 
        runnerId: runner.id, 
        repository: runner.repository 
      });

      // Check if we should scale down (simplified - check if we have excess idle runners)
      if (runner.repository) {
        const activeRunners = await this.getActiveRunners(runner.repository);
        const idleRunners = activeRunners.filter(r => r.status === RunnerStatus.IDLE);
        
        if (idleRunners.length > 1) {
          await this.scaleDown(runner.repository);
          logger.info('Scaled down runners after release', { repository: runner.repository });
        }
      }

    } catch (error) {
      logger.error('Failed to release runner', { runnerId, error });
      throw error;
    }
  }

  /**
   * Graceful shutdown of runner pool manager
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down RunnerPoolManager...');
    
    try {
      // Clear monitoring interval
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = undefined;
      }
      
      // Clear scaling in progress set
      this.scalingInProgress.clear();
      
      logger.info('RunnerPoolManager shutdown completed');
    } catch (error) {
      logger.error('Error during RunnerPoolManager shutdown:', error);
      throw error;
    }
  }
}

export default RunnerPoolManager.getInstance();