import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { getGitHubDataService } from './github-data-service';
import database from './database';
import runnerPoolManager from './runner-pool-manager';
import { Job, Runner, RunnerStatus } from '../types';
import config from '../config';

const logger = createLogger('MonitoringEnhanced');

export interface GitHubEnhancedMetrics {
  timestamp: Date;
  github: {
    repositories: number;
    totalWorkflowRuns: number;
    activeWorkflowRuns: number;
    queuedJobs: number;
    runningJobs: number;
    githubRunners: {
      total: number;
      online: number;
      busy: number;
    };
    rateLimitStatus: {
      remaining: number;
      limit: number;
      used: number;
      resetIn: number;
    };
  };
  local: {
    jobs: {
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
      averageWaitTime: number;
      averageExecutionTime: number;
    };
    runners: {
      total: number;
      proxy: number;
      ephemeral: number;
      idle: number;
      busy: number;
      offline: number;
    };
    pools: {
      total: number;
      averageUtilization: number;
      scalingEvents: number;
    };
  };
  system: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    uptime: number;
  };
}

export class MonitoringServiceEnhanced extends EventEmitter {
  private static instance: MonitoringServiceEnhanced;
  private metricsInterval: NodeJS.Timeout | null = null;
  private startTime: Date = new Date();
  private githubService = getGitHubDataService();
  private trackedRepositories: string[] = [];
  private useGitHubData: boolean = true;

  private constructor() {
    super();
    this.loadTrackedRepositories();
  }

  public static getInstance(): MonitoringServiceEnhanced {
    if (!MonitoringServiceEnhanced.instance) {
      MonitoringServiceEnhanced.instance = new MonitoringServiceEnhanced();
    }
    return MonitoringServiceEnhanced.instance;
  }

  /**
   * Load tracked repositories from config or database
   */
  private async loadTrackedRepositories() {
    try {
      // Load from config first
      if (config.github?.repositories) {
        this.trackedRepositories = config.github.repositories;
      } else {
        // Load from database
        const repos = await database.query<{ repository: string }>(`
          SELECT DISTINCT repository 
          FROM runnerhub.jobs 
          WHERE repository IS NOT NULL
          UNION
          SELECT DISTINCT repository 
          FROM runnerhub.runners 
          WHERE repository IS NOT NULL
          LIMIT 20
        `);
        this.trackedRepositories = repos.map(r => r.repository);
      }

      // Default repositories if none found
      if (this.trackedRepositories.length === 0) {
        this.trackedRepositories = ['YOUR_GITHUB_ORG/GitHub-RunnerHub'];
      }

      logger.info('Loaded tracked repositories', { count: this.trackedRepositories.length });
    } catch (error) {
      logger.error('Failed to load tracked repositories', error);
      this.trackedRepositories = ['YOUR_GITHUB_ORG/GitHub-RunnerHub'];
    }
  }

  /**
   * Start monitoring service
   */
  async start(): Promise<void> {
    logger.info('Starting enhanced monitoring service with GitHub integration');

    // Start metrics collection
    this.startMetricsCollection();

    // Emit initial metrics
    await this.emitSystemMetrics();
  }

  /**
   * Stop monitoring service
   */
  stop(): void {
    logger.info('Stopping enhanced monitoring service');

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  /**
   * Get enhanced system metrics with GitHub data
   */
  async getSystemMetrics(): Promise<GitHubEnhancedMetrics> {
    try {
      // Get local metrics (existing functionality)
      const localMetrics = await this.getLocalMetrics();

      // Get GitHub metrics if enabled
      let githubMetrics;
      if (this.useGitHubData) {
        try {
          githubMetrics = await this.getGitHubMetrics();
        } catch (error) {
          logger.warn('Failed to fetch GitHub metrics, using local data only', error);
          this.useGitHubData = false; // Temporarily disable to avoid repeated failures
          setTimeout(() => { this.useGitHubData = true; }, 300000); // Re-enable after 5 minutes
        }
      }

      return {
        timestamp: new Date(),
        github: githubMetrics || {
          repositories: 0,
          totalWorkflowRuns: 0,
          activeWorkflowRuns: 0,
          queuedJobs: 0,
          runningJobs: 0,
          githubRunners: { total: 0, online: 0, busy: 0 },
          rateLimitStatus: { remaining: 5000, limit: 5000, used: 0, resetIn: 3600000 }
        },
        local: localMetrics,
        system: {
          cpuUsage: process.cpuUsage().user / 1000000,
          memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
          diskUsage: 0,
          uptime: (Date.now() - this.startTime.getTime()) / 1000
        }
      };
    } catch (error) {
      logger.error('Failed to get enhanced system metrics', { error });
      throw error;
    }
  }

  /**
   * Get GitHub metrics
   */
  private async getGitHubMetrics() {
    const activities = await this.githubService.getMultiRepositoryActivity(this.trackedRepositories);
    
    // Aggregate metrics
    let totalWorkflowRuns = 0;
    let activeWorkflowRuns = 0;
    let queuedJobs = 0;
    let runningJobs = 0;
    let totalGitHubRunners = 0;
    let onlineGitHubRunners = 0;
    let busyGitHubRunners = 0;

    activities.forEach(activity => {
      totalWorkflowRuns += activity.workflowRuns.total;
      activeWorkflowRuns += activity.workflowRuns.queued + activity.workflowRuns.in_progress;
      queuedJobs += activity.jobs.queued;
      runningJobs += activity.jobs.running;
      totalGitHubRunners += activity.runners.total;
      onlineGitHubRunners += activity.runners.online;
      busyGitHubRunners += activity.runners.busy;
    });

    // Get rate limit status
    const rateLimitStatus = await this.githubService.getRateLimitStatus();

    return {
      repositories: this.trackedRepositories.length,
      totalWorkflowRuns,
      activeWorkflowRuns,
      queuedJobs,
      runningJobs,
      githubRunners: {
        total: totalGitHubRunners,
        online: onlineGitHubRunners,
        busy: busyGitHubRunners
      },
      rateLimitStatus: {
        remaining: rateLimitStatus.remaining,
        limit: rateLimitStatus.limit,
        used: rateLimitStatus.used,
        resetIn: rateLimitStatus.resetIn
      }
    };
  }

  /**
   * Get local metrics (existing functionality)
   */
  private async getLocalMetrics() {
    // Get job metrics
    const [jobMetrics] = await database.query<any>(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        AVG(EXTRACT(EPOCH FROM (started_at - created_at))) FILTER (WHERE started_at IS NOT NULL) as avg_wait_time,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE completed_at IS NOT NULL) as avg_execution_time
      FROM runnerhub.jobs
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
    `);

    // Get runner metrics
    const [runnerMetrics] = await database.query<any>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE type = 'proxy') as proxy,
        COUNT(*) FILTER (WHERE type = 'ephemeral') as ephemeral,
        COUNT(*) FILTER (WHERE status = 'idle') as idle,
        COUNT(*) FILTER (WHERE status = 'busy') as busy,
        COUNT(*) FILTER (WHERE status = 'offline') as offline
      FROM runnerhub.runners
    `);

    // Get pool metrics
    const pools = await runnerPoolManager.getAllPools();
    let totalUtilization = 0;
    let poolCount = 0;

    for (const pool of pools) {
      const metrics = await runnerPoolManager.getPoolMetrics(pool.repository);
      if (metrics.totalRunners > 0) {
        totalUtilization += metrics.utilization;
        poolCount++;
      }
    }

    const averageUtilization = poolCount > 0 ? totalUtilization / poolCount : 0;

    // Get scaling events count from last hour
    const [scalingEvents] = await database.query<any>(`
      SELECT COUNT(*) as count
      FROM runnerhub.runner_pools
      WHERE last_scaled_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
    `);

    return {
      jobs: {
        total: parseInt(jobMetrics.total) || 0,
        pending: parseInt(jobMetrics.pending) || 0,
        running: parseInt(jobMetrics.running) || 0,
        completed: parseInt(jobMetrics.completed) || 0,
        failed: parseInt(jobMetrics.failed) || 0,
        averageWaitTime: parseFloat(jobMetrics.avg_wait_time) || 0,
        averageExecutionTime: parseFloat(jobMetrics.avg_execution_time) || 0
      },
      runners: {
        total: parseInt(runnerMetrics.total) || 0,
        proxy: parseInt(runnerMetrics.proxy) || 0,
        ephemeral: parseInt(runnerMetrics.ephemeral) || 0,
        idle: parseInt(runnerMetrics.idle) || 0,
        busy: parseInt(runnerMetrics.busy) || 0,
        offline: parseInt(runnerMetrics.offline) || 0
      },
      pools: {
        total: pools.length,
        averageUtilization,
        scalingEvents: parseInt(scalingEvents.count) || 0
      }
    };
  }

  /**
   * Get recent jobs with GitHub data
   */
  async getRecentJobs(limit: number = 20): Promise<any[]> {
    if (this.useGitHubData && this.trackedRepositories.length > 0) {
      try {
        // Get jobs from GitHub
        const githubJobs = await this.githubService.getRecentJobs(this.trackedRepositories, limit);
        
        // Transform to match existing format
        return githubJobs.map(job => ({
          id: `github-${job.id}`,
          workflow: job.workflow_name || job.name,
          repository: job.head_branch, // Will be updated by the run data
          status: job.status === 'completed' ? 
            (job.conclusion === 'success' ? 'completed' : 'failed') : 
            job.status,
          startedAt: job.started_at,
          completedAt: job.completed_at,
          runnerName: job.runner_name,
          labels: job.labels
        }));
      } catch (error) {
        logger.warn('Failed to get GitHub jobs, falling back to local data', error);
      }
    }

    // Fallback to local data
    return await database.query<Job>(`
      SELECT * FROM runnerhub.jobs
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
  }

  /**
   * Get job timeline with GitHub data
   */
  async getJobTimeline(hours: number = 24): Promise<any[]> {
    // For now, use local data for timeline
    // In a future enhancement, we could aggregate GitHub workflow run data
    const intervals = await database.query<any>(`
      SELECT 
        date_trunc('hour', created_at) as hour,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE completed_at IS NOT NULL) as avg_duration
      FROM runnerhub.jobs
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '${hours} hours'
      GROUP BY hour
      ORDER BY hour
    `);

    return intervals;
  }

  /**
   * Get runner health with GitHub data
   */
  async getRunnerHealth(): Promise<any[]> {
    const runners: any[] = [];

    // Get GitHub runners if available
    if (this.useGitHubData && this.trackedRepositories.length > 0) {
      try {
        for (const repo of this.trackedRepositories) {
          const [owner, name] = repo.split('/');
          const githubRunners = await this.githubService.getRunners(owner, name);
          
          githubRunners.forEach(runner => {
            runners.push({
              id: `github-${runner.id}`,
              name: runner.name,
              type: 'github',
              status: runner.busy ? 'busy' : (runner.status === 'online' ? 'idle' : 'offline'),
              repository: repo,
              lastHeartbeat: new Date(), // GitHub runners are real-time
              isHealthy: runner.status === 'online',
              healthStatus: runner.status === 'online' ? 'healthy' : 'offline'
            });
          });
        }
      } catch (error) {
        logger.warn('Failed to get GitHub runners, using local data only', error);
      }
    }

    // Get local runners
    const localRunners = await database.query<Runner>(`
      SELECT * FROM runnerhub.runners
      ORDER BY last_heartbeat DESC
    `);

    localRunners.forEach(runner => {
      runners.push({
        id: runner.id,
        name: runner.name,
        type: runner.type,
        status: runner.status,
        repository: runner.repository,
        lastHeartbeat: runner.lastHeartbeat,
        isHealthy: this.isRunnerHealthy(runner),
        healthStatus: this.getRunnerHealthStatus(runner)
      });
    });

    return runners;
  }

  /**
   * Get dashboard data with GitHub integration
   */
  async getDashboardData(): Promise<any> {
    // Get enhanced system metrics
    const systemMetrics = await this.getSystemMetrics();
    
    // Merge GitHub and local metrics for dashboard
    const mergedMetrics = {
      jobs: {
        total: systemMetrics.github.totalWorkflowRuns + systemMetrics.local.jobs.total,
        pending: systemMetrics.github.queuedJobs + systemMetrics.local.jobs.pending,
        running: systemMetrics.github.runningJobs + systemMetrics.local.jobs.running,
        completed: systemMetrics.local.jobs.completed,
        failed: systemMetrics.local.jobs.failed,
        averageWaitTime: systemMetrics.local.jobs.averageWaitTime,
        averageExecutionTime: systemMetrics.local.jobs.averageExecutionTime
      },
      runners: {
        total: systemMetrics.github.githubRunners.total + systemMetrics.local.runners.total,
        proxy: systemMetrics.local.runners.proxy,
        ephemeral: systemMetrics.local.runners.ephemeral,
        idle: systemMetrics.github.githubRunners.online - systemMetrics.github.githubRunners.busy + systemMetrics.local.runners.idle,
        busy: systemMetrics.github.githubRunners.busy + systemMetrics.local.runners.busy,
        offline: (systemMetrics.github.githubRunners.total - systemMetrics.github.githubRunners.online) + systemMetrics.local.runners.offline
      },
      pools: systemMetrics.local.pools,
      rateLimitStatus: systemMetrics.github.rateLimitStatus
    };

    const [recentJobs, timeline, runnerHealth] = await Promise.all([
      this.getRecentJobs(10),
      this.getJobTimeline(24),
      this.getRunnerHealth()
    ]);

    return {
      system: mergedMetrics,
      recentJobs,
      timeline,
      runnerHealth,
      lastUpdated: new Date(),
      githubIntegration: {
        enabled: this.useGitHubData,
        repositories: this.trackedRepositories,
        rateLimitStatus: systemMetrics.github.rateLimitStatus
      }
    };
  }

  /**
   * Add repository to tracking
   */
  async addTrackedRepository(repository: string): Promise<void> {
    if (!this.trackedRepositories.includes(repository)) {
      this.trackedRepositories.push(repository);
      logger.info('Added repository to tracking', { repository });
      
      // Invalidate cache for immediate update
      await this.githubService.invalidateRepositoryCache(
        repository.split('/')[0],
        repository.split('/')[1]
      );
    }
  }

  /**
   * Remove repository from tracking
   */
  removeTrackedRepository(repository: string): void {
    const index = this.trackedRepositories.indexOf(repository);
    if (index > -1) {
      this.trackedRepositories.splice(index, 1);
      logger.info('Removed repository from tracking', { repository });
    }
  }

  /**
   * Get tracked repositories
   */
  getTrackedRepositories(): string[] {
    return [...this.trackedRepositories];
  }

  /**
   * Get metrics for a specific repository (compatibility method)
   */
  async getRepositoryMetrics(repository: string): Promise<any> {
    try {
      const [owner, name] = repository.split('/');
      const activity = await this.githubService.getRepositoryActivity(owner, name);
      
      // Get local pool metrics
      const poolMetrics = await runnerPoolManager.getPoolMetrics(repository);
      let pool = null;
      try {
        pool = await runnerPoolManager.getOrCreatePool(repository);
      } catch (error) {
        logger.warn('Failed to get pool for repository', { repository, error });
      }

      return {
        repository,
        jobs: {
          total: activity.jobs.total,
          running: activity.jobs.running,
          averageWaitTime: activity.jobs.average_duration,
          successRate: activity.workflowRuns.success_rate
        },
        runners: {
          total: activity.runners.total + poolMetrics.totalRunners,
          active: activity.runners.busy + poolMetrics.activeRunners,
          utilization: activity.runners.utilization
        },
        pool
      };
    } catch (error) {
      logger.error('Failed to get repository metrics', { repository, error });
      
      // Fallback to local data only
      const poolMetrics = await runnerPoolManager.getPoolMetrics(repository);
      let pool = null;
      try {
        pool = await runnerPoolManager.getOrCreatePool(repository);
      } catch (error) {
        logger.warn('Failed to get pool for repository', { repository, error });
      }

      return {
        repository,
        jobs: {
          total: 0,
          running: 0,
          averageWaitTime: 0,
          successRate: 0
        },
        runners: {
          total: poolMetrics.totalRunners,
          active: poolMetrics.activeRunners,
          utilization: poolMetrics.utilization
        },
        pool
      };
    }
  }

  // Keep existing helper methods
  private isRunnerHealthy(runner: Runner): boolean {
    if (runner.status === RunnerStatus.OFFLINE) {
      return false;
    }

    const lastHeartbeat = runner.lastHeartbeat ? new Date(runner.lastHeartbeat).getTime() : 0;
    const now = Date.now();
    const heartbeatAge = (now - lastHeartbeat) / 1000;

    return heartbeatAge < 60;
  }

  private getRunnerHealthStatus(runner: Runner): string {
    if (runner.status === RunnerStatus.OFFLINE) {
      return 'offline';
    }

    const lastHeartbeat = runner.lastHeartbeat ? new Date(runner.lastHeartbeat).getTime() : 0;
    const now = Date.now();
    const heartbeatAge = (now - lastHeartbeat) / 1000;

    if (heartbeatAge < 60) {
      return 'healthy';
    } else if (heartbeatAge < 300) {
      return 'warning';
    } else {
      return 'critical';
    }
  }

  private startMetricsCollection(): void {
    // Emit metrics every 10 seconds
    this.metricsInterval = setInterval(async () => {
      await this.emitSystemMetrics();
    }, 10000);
  }

  private async emitSystemMetrics(): Promise<void> {
    try {
      const metrics = await this.getSystemMetrics();
      this.emit('metrics', metrics);
    } catch (error) {
      logger.error('Failed to emit system metrics', { error });
    }
  }

  // Keep existing event recording methods
  recordJobEvent(jobId: string, event: string, data?: any): void {
    this.emit('job-event', {
      timestamp: new Date(),
      jobId,
      event,
      data
    });

    logger.debug('Job event recorded', { jobId, event });
  }

  recordRunnerEvent(runnerId: string, event: string, data?: any): void {
    this.emit('runner-event', {
      timestamp: new Date(),
      runnerId,
      event,
      data
    });

    logger.debug('Runner event recorded', { runnerId, event });
  }

  recordScalingEvent(repository: string, action: string, count: number, reason: string): void {
    this.emit('scaling-event', {
      timestamp: new Date(),
      repository,
      action,
      count,
      reason
    });

    logger.info('Scaling event recorded', { repository, action, count, reason });
  }

  recordCleanupEvent(data: {
    containersInspected: number;
    containersCleaned: number;
    diskSpaceReclaimed: number;
    errors: number;
  }): void {
    this.emit('cleanup-event', {
      timestamp: new Date(),
      ...data
    });

    logger.info('Cleanup event recorded', data);
  }

  recordJobCompletion(jobId: string, duration: number, success: boolean): void {
    this.emit('job-completion', {
      timestamp: new Date(),
      jobId,
      duration,
      success
    });

    logger.debug('Job completion recorded', { jobId, duration, success });
  }

  /**
   * Get Prometheus metrics with GitHub data
   */
  async getPrometheusMetrics(): Promise<string> {
    const metrics = await this.getSystemMetrics();
    
    const lines = [
      '# HELP runnerhub_jobs_total Total number of jobs',
      '# TYPE runnerhub_jobs_total gauge',
      `runnerhub_jobs_total ${metrics.local.jobs.total + metrics.github.totalWorkflowRuns}`,
      '',
      '# HELP runnerhub_jobs_pending Number of pending jobs',
      '# TYPE runnerhub_jobs_pending gauge',
      `runnerhub_jobs_pending ${metrics.local.jobs.pending + metrics.github.queuedJobs}`,
      '',
      '# HELP runnerhub_jobs_running Number of running jobs',
      '# TYPE runnerhub_jobs_running gauge', 
      `runnerhub_jobs_running ${metrics.local.jobs.running + metrics.github.runningJobs}`,
      '',
      '# HELP runnerhub_runners_total Total number of runners',
      '# TYPE runnerhub_runners_total gauge',
      `runnerhub_runners_total ${metrics.local.runners.total + metrics.github.githubRunners.total}`,
      '',
      '# HELP runnerhub_runners_busy Number of busy runners',
      '# TYPE runnerhub_runners_busy gauge',
      `runnerhub_runners_busy ${metrics.local.runners.busy + metrics.github.githubRunners.busy}`,
      '',
      '# HELP github_api_rate_limit_remaining Remaining GitHub API rate limit',
      '# TYPE github_api_rate_limit_remaining gauge',
      `github_api_rate_limit_remaining ${metrics.github.rateLimitStatus.remaining}`,
      '',
      '# HELP github_api_rate_limit_used Used GitHub API rate limit',
      '# TYPE github_api_rate_limit_used gauge',
      `github_api_rate_limit_used ${metrics.github.rateLimitStatus.used}`,
      ''
    ];

    return lines.join('\n');
  }
}

// Export singleton instance
const monitoringServiceEnhanced = MonitoringServiceEnhanced.getInstance();
export default monitoringServiceEnhanced;