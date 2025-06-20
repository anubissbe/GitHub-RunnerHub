import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import database from './database';
import containerLifecycle from './container-lifecycle';
import jobRouter from './job-router';
import containerCleanup from './container-cleanup';
import networkIsolation from './network-isolation';
import securityScanner from './security-scanner';
import { Runner, RunnerStatus, DelegatedJob, ContainerConfig, JobStatus } from '../types';
import { GitHubAPIService } from './github-api';
import monitoringService from './monitoring';
import config from '../config';

const logger = createLogger('ContainerOrchestratorV2');

export interface JobExecutionResult {
  success: boolean;
  exitCode: number;
  logs?: string;
  duration: number;
  containerId: string;
  runnerId: string;
}

export class ContainerOrchestratorV2 extends EventEmitter {
  private static instance: ContainerOrchestratorV2;
  private githubApi: GitHubAPIService;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private healthInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.githubApi = new GitHubAPIService();
  }

  public static getInstance(): ContainerOrchestratorV2 {
    if (!ContainerOrchestratorV2.instance) {
      ContainerOrchestratorV2.instance = new ContainerOrchestratorV2();
    }
    return ContainerOrchestratorV2.instance;
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    logger.info('Initializing container orchestrator v2');

    try {
      // Initialize container lifecycle manager
      await containerLifecycle.initialize();

      // Initialize job router
      await jobRouter.initialize();

      // Initialize container cleanup service
      await containerCleanup.initialize();

      // Initialize network isolation service
      await networkIsolation.initialize();

      // Set up event listeners
      this.setupEventListeners();

      // Start background tasks
      this.startBackgroundTasks();

      logger.info('Container orchestrator v2 initialized');
    } catch (error) {
      logger.error('Failed to initialize container orchestrator', { error });
      throw error;
    }
  }

  /**
   * Execute a delegated job
   */
  async executeJob(job: DelegatedJob): Promise<JobExecutionResult> {
    const startTime = Date.now();
    let runnerId: string | undefined;
    let containerId: string | undefined;

    try {
      logger.info('Executing delegated job', {
        jobId: job.id,
        repository: job.repository,
        workflow: job.workflow
      });

      // Update job status
      await this.updateJobStatus(job.id, JobStatus.ASSIGNED);

      // Route the job to find appropriate runners
      const routingDecision = await jobRouter.routeJob(job);
      
      logger.info('Job routing decision', {
        jobId: job.id,
        poolName: routingDecision.poolName,
        targetRunnerCount: routingDecision.targetRunners.length,
        matchedRule: routingDecision.matchedRule?.name
      });

      // If no target runners available, use default ephemeral approach
      if (routingDecision.targetRunners.length === 0) {
        logger.warn('No target runners found, creating ephemeral runner', {
          jobId: job.id
        });
      }

      // Create ephemeral runner with routing information
      runnerId = await this.createEphemeralRunner(
        job, 
        job.labels,
        routingDecision.poolName
      );
      
      // Get container ID
      const containerInfo = containerLifecycle.getContainerByRunnerId(runnerId);
      if (!containerInfo) {
        throw new Error('Container not found after creation');
      }
      containerId = containerInfo.id;

      // Wait for job completion
      const result = await this.waitForJobCompletion(job.id, containerId, runnerId);

      // Calculate duration
      const duration = Date.now() - startTime;

      logger.info('Job execution completed', {
        jobId: job.id,
        success: result.success,
        exitCode: result.exitCode,
        duration
      });

      return {
        ...result,
        duration,
        containerId: containerId!,
        runnerId: runnerId!
      };
    } catch (error) {
      logger.error('Job execution failed', {
        jobId: job.id,
        error
      });

      // Update job status to failed
      await this.updateJobStatus(job.id, JobStatus.FAILED, error);

      // Clean up if needed
      if (containerId) {
        try {
          await containerLifecycle.stopContainer(containerId);
          await containerLifecycle.removeContainer(containerId);
        } catch (cleanupError) {
          logger.error('Failed to cleanup after job failure', { cleanupError });
        }
      }

      throw error;
    }
  }

  /**
   * Create ephemeral runner container
   */
  private async createEphemeralRunner(
    job: DelegatedJob,
    labels: string[],
    _poolName?: string
  ): Promise<string> {
    const runnerName = `ephemeral-${job.repository.replace('/', '-')}-${job.id.substring(0, 8)}`;
    
    logger.info('Creating ephemeral runner', {
      job: job.id,
      repository: job.repository,
      runnerName
    });

    try {
      // Register runner in database first
      const [runner] = await database.query<Runner>(
        `INSERT INTO runnerhub.runners 
         (name, type, status, repository, labels)
         VALUES ($1, 'ephemeral', $2, $3, $4)
         RETURNING *`,
        [
          runnerName,
          RunnerStatus.STARTING,
          job.repository,
          labels
        ]
      );

      // Get runner token
      const runnerToken = await this.githubApi.generateRunnerToken(job.repository);

      // Security scan the image before using it
      const imageToUse = config.runner.image || 'myoung34/github-runner:latest';
      
      if (config.security?.scanImages !== false) {
        try {
          logger.info('Scanning container image for vulnerabilities', { image: imageToUse });
          
          const scanResult = await securityScanner.scanImage({
            imageId: imageToUse,
            imageName: imageToUse.split(':')[0],
            imageTag: imageToUse.split(':')[1] || 'latest',
            repository: job.repository,
            username: 'system',
            policyId: config.security?.defaultPolicyId
          });

          if (config.security?.blockOnVulnerabilities && scanResult.summary.critical > 0) {
            throw new Error(`Image ${imageToUse} has ${scanResult.summary.critical} critical vulnerabilities`);
          }

          logger.info('Image security scan completed', {
            image: imageToUse,
            vulnerabilities: scanResult.summary
          });
        } catch (error) {
          logger.error('Image security scan failed', { image: imageToUse, error });
          
          if (config.security?.blockOnScanFailure) {
            throw new Error(`Security scan failed: ${(error as Error).message}`);
          }
        }
      }

      // Prepare container configuration
      const containerConfig: ContainerConfig = {
        image: imageToUse,
        name: runnerName,
        env: {
          RUNNER_NAME: runnerName,
          RUNNER_WORKDIR: '/tmp/runner/work',
          RUNNER_GROUP: 'default',
          LABELS: labels.join(','),
          EPHEMERAL: 'true',
          DISABLE_AUTO_UPDATE: 'true',
          RUNNER_TOKEN: runnerToken,
          REPO_URL: `https://github.com/${job.repository}`,
          // Pass job context
          GITHUB_JOB_ID: job.jobId,
          GITHUB_RUN_ID: job.runId,
          GITHUB_WORKFLOW: job.workflow
        },
        labels: {
          'runnerhub.type': 'ephemeral',
          'runnerhub.job': job.id,
          'runnerhub.repository': job.repository,
          'repository': job.repository,
          'workflow': job.workflow
        },
        networks: [], // Will be handled by network isolation
        volumes: [
          '/var/run/docker.sock:/var/run/docker.sock', // Allow Docker-in-Docker if needed
        ],
        autoRemove: false // We'll handle cleanup manually
      };

      // Create container using lifecycle manager
      const containerId = await containerLifecycle.createContainer(
        runner.id,
        job.id,
        containerConfig,
        {
          cpuShares: config.runner.limits?.cpu || 2048,
          memoryMB: config.runner.limits?.memory || 4096,
          pidsLimit: config.runner.limits?.pids || 512
        }
      );

      // Attach container to isolated network
      await networkIsolation.attachContainerToNetwork(
        containerId,
        job.repository,
        [`runner-${runnerName}`, runnerName]
      );

      // Start container
      await containerLifecycle.startContainer(containerId);

      // Update job assignment
      await database.query(
        `UPDATE runnerhub.jobs 
         SET assigned_runner_id = $1, 
             status = $2,
             started_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [runner.id, JobStatus.RUNNING, job.id]
      );

      // Emit events
      this.emit('runner:created', {
        runnerId: runner.id,
        containerId,
        job: job.id
      });

      monitoringService.recordRunnerEvent(runner.id, 'created', {
        jobId: job.id,
        containerId
      });

      logger.info('Ephemeral runner created successfully', {
        runnerId: runner.id,
        containerId,
        job: job.id
      });

      return runner.id;
    } catch (error) {
      logger.error('Failed to create ephemeral runner', {
        job: job.id,
        error
      });
      throw error;
    }
  }

  /**
   * Wait for job completion
   */
  private async waitForJobCompletion(
    jobId: string,
    containerId: string,
    runnerId: string
  ): Promise<{ success: boolean; exitCode: number; logs?: string }> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Job execution timeout'));
        }
      }, config.runner.jobTimeout || 3600000); // 1 hour default

      // Check job status periodically
      const checkInterval = setInterval(async () => {
        try {
          const containerInfo = containerLifecycle.getContainerByRunnerId(runnerId);
          
          if (!containerInfo) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              reject(new Error('Container lost'));
            }
            return;
          }

          // Check if container stopped
          if (containerInfo.state === 'stopped') {
            clearInterval(checkInterval);
            clearTimeout(timeout);

            if (!resolved) {
              resolved = true;
              
              // Get logs if available
              let logs: string | undefined;
              try {
                const { output } = await containerLifecycle.executeCommand(
                  containerId,
                  ['cat', '/home/runner/_diag/Runner_*.log'],
                  { user: 'runner' }
                );
                logs = output;
              } catch (error) {
                logger.debug('Failed to get runner logs', { error });
              }

              // Update job status
              const success = containerInfo.exitCode === 0;
              await this.updateJobStatus(
                jobId,
                success ? JobStatus.COMPLETED : JobStatus.FAILED,
                success ? undefined : new Error(`Exit code: ${containerInfo.exitCode}`)
              );

              resolve({
                success,
                exitCode: containerInfo.exitCode || -1,
                logs
              });
            }
          }

          // Check job status in database
          const [job] = await database.query<DelegatedJob>(
            'SELECT status FROM runnerhub.jobs WHERE id = $1',
            [jobId]
          );

          if (job && (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED)) {
            clearInterval(checkInterval);
            clearTimeout(timeout);

            if (!resolved) {
              resolved = true;
              resolve({
                success: job.status === JobStatus.COMPLETED,
                exitCode: job.status === JobStatus.COMPLETED ? 0 : 1
              });
            }
          }
        } catch (error) {
          logger.error('Error checking job status', { jobId, error });
        }
      }, 5000); // Check every 5 seconds
    });
  }

  /**
   * Update job status
   */
  private async updateJobStatus(
    jobId: string,
    status: JobStatus,
    error?: any
  ): Promise<void> {
    try {
      const updates: any[] = [status];
      let query = 'UPDATE runnerhub.jobs SET status = $1';
      let paramCount = 1;

      if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
        query += `, completed_at = CURRENT_TIMESTAMP`;
      }

      if (error) {
        query += `, error = $${++paramCount}`;
        updates.push(error.message || String(error));
      }

      query += ` WHERE id = $${++paramCount}`;
      updates.push(jobId);

      await database.query(query, updates);

      // Emit event
      this.emit(`job:${status.toLowerCase()}`, { jobId, error });

      // Record monitoring event
      monitoringService.recordJobEvent(jobId, status.toLowerCase(), { error });
    } catch (dbError) {
      logger.error('Failed to update job status', { jobId, status, error: dbError });
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Container lifecycle events
    containerLifecycle.on('container:high-cpu', ({ containerId, cpu }) => {
      logger.warn('High CPU usage detected', { containerId, cpu });
      this.emit('resource:high-cpu', { containerId, cpu });
    });

    containerLifecycle.on('container:high-memory', ({ containerId, usage, limit }) => {
      logger.warn('High memory usage detected', { containerId, usage, limit });
      this.emit('resource:high-memory', { containerId, usage, limit });
    });

    containerLifecycle.on('container:stopped', async (containerInfo) => {
      if (containerInfo.jobId) {
        logger.info('Container stopped for job', {
          jobId: containerInfo.jobId,
          exitCode: containerInfo.exitCode
        });
      }
    });
  }

  /**
   * Start background tasks
   */
  private startBackgroundTasks(): void {
    // Cleanup completed containers
    this.cleanupInterval = setInterval(() => {
      this.cleanupCompletedContainers();
    }, 60000); // Every minute

    // Monitor container health
    this.healthInterval = setInterval(() => {
      this.monitorContainerHealth();
    }, 30000); // Every 30 seconds
  }

  /**
   * Clean up completed containers
   */
  private async cleanupCompletedContainers(): Promise<void> {
    try {
      const completedJobs = await database.query<any>(
        `SELECT j.*, r.container_id, r.id as runner_id
         FROM runnerhub.jobs j
         JOIN runnerhub.runners r ON j.assigned_runner_id = r.id
         WHERE j.status IN ('completed', 'failed')
         AND j.completed_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
         AND r.container_id IS NOT NULL`
      );

      for (const job of completedJobs) {
        try {
          if (job.container_id) {
            await containerLifecycle.removeContainer(job.container_id, true);
            
            // Remove runner record
            await database.query(
              'DELETE FROM runnerhub.runners WHERE id = $1',
              [job.runner_id]
            );

            logger.info('Cleaned up completed job container', {
              jobId: job.id,
              containerId: job.containerId
            });
          }
        } catch (error) {
          logger.error('Failed to cleanup job container', {
            jobId: job.id,
            error
          });
        }
      }
    } catch (error) {
      logger.error('Cleanup task failed', { error });
    }
  }

  /**
   * Monitor container health
   */
  private async monitorContainerHealth(): Promise<void> {
    try {
      const activeContainers = containerLifecycle.getAllContainers()
        .filter(c => c.state === 'running' && c.jobId);

      for (const container of activeContainers) {
        if (container.resourceUsage) {
          // Log high resource usage
          if (container.resourceUsage.cpuPercent > 90) {
            logger.warn('Container using high CPU', {
              containerId: container.id,
              jobId: container.jobId,
              cpu: container.resourceUsage.cpuPercent
            });
          }

          if (container.resourceUsage.memoryLimit > 0) {
            const memoryPercent = (container.resourceUsage.memoryUsage / container.resourceUsage.memoryLimit) * 100;
            if (memoryPercent > 90) {
              logger.warn('Container using high memory', {
                containerId: container.id,
                jobId: container.jobId,
                memoryPercent: Math.round(memoryPercent)
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error('Health monitoring failed', { error });
    }
  }

  /**
   * Shutdown the orchestrator
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down container orchestrator');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.healthInterval) {
      clearInterval(this.healthInterval);
    }

    await containerLifecycle.shutdown();
  }
}

export default ContainerOrchestratorV2.getInstance();