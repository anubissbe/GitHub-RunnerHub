import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import database from './database';
import runnerPoolManager from './runner-pool-manager';
import { Job, Runner, RunnerPool, RunnerStatus } from '../types';

const logger = createLogger('MonitoringService');

export interface SystemMetrics {
  timestamp: Date;
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
  system: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    uptime: number;
  };
}

export interface RepositoryMetrics {
  repository: string;
  jobs: {
    total: number;
    running: number;
    averageWaitTime: number;
    successRate: number;
  };
  runners: {
    total: number;
    active: number;
    utilization: number;
  };
  pool: RunnerPool | null;
}

export class MonitoringService extends EventEmitter {
  private static instance: MonitoringService;
  private metricsInterval: NodeJS.Timeout | null = null;
  private startTime: Date = new Date();

  private constructor() {
    super();
  }

  public static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  /**
   * Start monitoring service
   */
  async start(): Promise<void> {
    logger.info('Starting monitoring service');

    // Start metrics collection
    this.startMetricsCollection();

    // Emit initial metrics
    await this.emitSystemMetrics();
  }

  /**
   * Stop monitoring service
   */
  stop(): void {
    logger.info('Stopping monitoring service');

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  /**
   * Get system-wide metrics
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    try {
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

      // Get system metrics (simplified for now)
      const uptime = (Date.now() - this.startTime.getTime()) / 1000;

      return {
        timestamp: new Date(),
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
        },
        system: {
          cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
          memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // Convert to MB
          diskUsage: 0, // Would need to implement disk usage check
          uptime
        }
      };
    } catch (error) {
      logger.error('Failed to get system metrics', { error });
      throw error;
    }
  }

  /**
   * Get metrics for a specific repository
   */
  async getRepositoryMetrics(repository: string): Promise<RepositoryMetrics> {
    try {
      // Get job metrics for repository
      const [jobMetrics] = await database.query<any>(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'running') as running,
          AVG(EXTRACT(EPOCH FROM (started_at - created_at))) FILTER (WHERE started_at IS NOT NULL) as avg_wait_time,
          COUNT(*) FILTER (WHERE status = 'completed')::float / NULLIF(COUNT(*), 0) as success_rate
        FROM runnerhub.jobs
        WHERE repository = $1
        AND created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
      `, [repository]);

      // Get runner metrics
      const poolMetrics = await runnerPoolManager.getPoolMetrics(repository);
      
      // Get pool configuration
      let pool = null;
      try {
        pool = await runnerPoolManager.getOrCreatePool(repository);
      } catch (error) {
        logger.warn('Failed to get pool for repository', { repository, error });
      }

      return {
        repository,
        jobs: {
          total: parseInt(jobMetrics.total) || 0,
          running: parseInt(jobMetrics.running) || 0,
          averageWaitTime: parseFloat(jobMetrics.avg_wait_time) || 0,
          successRate: parseFloat(jobMetrics.success_rate) || 0
        },
        runners: {
          total: poolMetrics.totalRunners,
          active: poolMetrics.activeRunners,
          utilization: poolMetrics.utilization
        },
        pool
      };
    } catch (error) {
      logger.error('Failed to get repository metrics', { repository, error });
      throw error;
    }
  }

  /**
   * Get recent jobs
   */
  async getRecentJobs(limit: number = 20): Promise<Job[]> {
    return await database.query<Job>(`
      SELECT * FROM runnerhub.jobs
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
  }

  /**
   * Get job timeline data
   */
  async getJobTimeline(hours: number = 24): Promise<any[]> {
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
   * Get runner health status
   */
  async getRunnerHealth(): Promise<any[]> {
    const runners = await database.query<Runner>(`
      SELECT * FROM runnerhub.runners
      ORDER BY last_heartbeat DESC
    `);

    return runners.map(runner => ({
      id: runner.id,
      name: runner.name,
      type: runner.type,
      status: runner.status,
      repository: runner.repository,
      lastHeartbeat: runner.lastHeartbeat,
      isHealthy: this.isRunnerHealthy(runner),
      healthStatus: this.getRunnerHealthStatus(runner)
    }));
  }

  /**
   * Check if runner is healthy
   */
  private isRunnerHealthy(runner: Runner): boolean {
    if (runner.status === RunnerStatus.OFFLINE) {
      return false;
    }

    const lastHeartbeat = runner.lastHeartbeat ? new Date(runner.lastHeartbeat).getTime() : 0;
    const now = Date.now();
    const heartbeatAge = (now - lastHeartbeat) / 1000;

    return heartbeatAge < 60; // Healthy if heartbeat within last minute
  }

  /**
   * Get runner health status
   */
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

  /**
   * Start metrics collection interval
   */
  private startMetricsCollection(): void {
    // Emit metrics every 10 seconds
    this.metricsInterval = setInterval(async () => {
      await this.emitSystemMetrics();
    }, 10000);
  }

  /**
   * Emit system metrics
   */
  private async emitSystemMetrics(): Promise<void> {
    try {
      const metrics = await this.getSystemMetrics();
      this.emit('metrics', metrics);
    } catch (error) {
      logger.error('Failed to emit system metrics', { error });
    }
  }

  /**
   * Record job event
   */
  recordJobEvent(jobId: string, event: string, data?: any): void {
    this.emit('job-event', {
      timestamp: new Date(),
      jobId,
      event,
      data
    });

    logger.debug('Job event recorded', { jobId, event });
  }

  /**
   * Record runner event
   */
  recordRunnerEvent(runnerId: string, event: string, data?: any): void {
    this.emit('runner-event', {
      timestamp: new Date(),
      runnerId,
      event,
      data
    });

    logger.debug('Runner event recorded', { runnerId, event });
  }

  /**
   * Record scaling event
   */
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

  /**
   * Record cleanup event
   */
  recordCleanupEvent(data: {
    containersInspected: number;
    containersCleaned: number;
    diskSpaceReclaimed: number;
    duration: number;
  }): void {
    this.emit('cleanup-event', {
      timestamp: new Date(),
      ...data
    });

    logger.info('Cleanup event recorded', data);
  }

  /**
   * Get Prometheus metrics
   */
  async getPrometheusMetrics(): Promise<string> {
    const metrics = await this.getSystemMetrics();
    const pools = await runnerPoolManager.getAllPools();

    let output = '';

    // Job metrics
    output += '# HELP github_runnerhub_jobs_total Total number of jobs\n';
    output += '# TYPE github_runnerhub_jobs_total gauge\n';
    output += `github_runnerhub_jobs_total ${metrics.jobs.total}\n`;

    output += '# HELP github_runnerhub_jobs_by_status Number of jobs by status\n';
    output += '# TYPE github_runnerhub_jobs_by_status gauge\n';
    output += `github_runnerhub_jobs_by_status{status="pending"} ${metrics.jobs.pending}\n`;
    output += `github_runnerhub_jobs_by_status{status="running"} ${metrics.jobs.running}\n`;
    output += `github_runnerhub_jobs_by_status{status="completed"} ${metrics.jobs.completed}\n`;
    output += `github_runnerhub_jobs_by_status{status="failed"} ${metrics.jobs.failed}\n`;

    output += '# HELP github_runnerhub_job_wait_time_seconds Average job wait time\n';
    output += '# TYPE github_runnerhub_job_wait_time_seconds gauge\n';
    output += `github_runnerhub_job_wait_time_seconds ${metrics.jobs.averageWaitTime}\n`;

    // Runner metrics
    output += '# HELP github_runnerhub_runners_total Total number of runners\n';
    output += '# TYPE github_runnerhub_runners_total gauge\n';
    output += `github_runnerhub_runners_total ${metrics.runners.total}\n`;

    output += '# HELP github_runnerhub_runners_by_type Number of runners by type\n';
    output += '# TYPE github_runnerhub_runners_by_type gauge\n';
    output += `github_runnerhub_runners_by_type{type="proxy"} ${metrics.runners.proxy}\n`;
    output += `github_runnerhub_runners_by_type{type="ephemeral"} ${metrics.runners.ephemeral}\n`;

    output += '# HELP github_runnerhub_runners_by_status Number of runners by status\n';
    output += '# TYPE github_runnerhub_runners_by_status gauge\n';
    output += `github_runnerhub_runners_by_status{status="idle"} ${metrics.runners.idle}\n`;
    output += `github_runnerhub_runners_by_status{status="busy"} ${metrics.runners.busy}\n`;
    output += `github_runnerhub_runners_by_status{status="offline"} ${metrics.runners.offline}\n`;

    // Pool metrics
    output += '# HELP github_runnerhub_pool_utilization Runner pool utilization\n';
    output += '# TYPE github_runnerhub_pool_utilization gauge\n';
    for (const pool of pools) {
      const poolMetrics = await runnerPoolManager.getPoolMetrics(pool.repository);
      output += `github_runnerhub_pool_utilization{repository="${pool.repository}"} ${poolMetrics.utilization}\n`;
    }

    // System metrics
    output += '# HELP github_runnerhub_uptime_seconds System uptime\n';
    output += '# TYPE github_runnerhub_uptime_seconds counter\n';
    output += `github_runnerhub_uptime_seconds ${metrics.system.uptime}\n`;

    return output;
  }

  /**
   * Record job completion metrics (used by webhook integration)
   */
  async recordJobCompletion(jobMetrics: {
    jobId: string;
    repository: string;
    conclusion: string;
    duration?: number;
    runnerId?: string;
  }): Promise<void> {
    logger.info('Recording job completion metrics', jobMetrics);

    try {
      // Store detailed job metrics in database
      await database.query(
        `INSERT INTO runnerhub.job_metrics 
         (job_id, repository, conclusion, duration, runner_id, recorded_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (job_id) DO UPDATE SET
         conclusion = $3, duration = $4, runner_id = $5, recorded_at = CURRENT_TIMESTAMP`,
        [
          jobMetrics.jobId,
          jobMetrics.repository,
          jobMetrics.conclusion,
          jobMetrics.duration || null,
          jobMetrics.runnerId || null
        ]
      );

      // Emit event for real-time monitoring
      this.emit('job-completed', {
        jobId: jobMetrics.jobId,
        repository: jobMetrics.repository,
        conclusion: jobMetrics.conclusion,
        duration: jobMetrics.duration,
        timestamp: new Date()
      });

      // Update repository statistics
      await this.updateRepositoryStats(jobMetrics.repository, jobMetrics.conclusion);

    } catch (error) {
      logger.error('Failed to record job completion metrics', { 
        jobMetrics, 
        error 
      });
    }
  }

  /**
   * Update repository-level statistics
   */
  private async updateRepositoryStats(repository: string, conclusion: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO runnerhub.repository_stats 
         (repository, total_jobs, successful_jobs, failed_jobs, last_job_at)
         VALUES ($1, 1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (repository) DO UPDATE SET
         total_jobs = repository_stats.total_jobs + 1,
         successful_jobs = repository_stats.successful_jobs + $2,
         failed_jobs = repository_stats.failed_jobs + $3,
         last_job_at = CURRENT_TIMESTAMP`,
        [
          repository,
          conclusion === 'success' ? 1 : 0,
          conclusion === 'failure' ? 1 : 0
        ]
      );
    } catch (error) {
      logger.error('Failed to update repository stats', { repository, conclusion, error });
    }
  }
}

export default MonitoringService.getInstance();