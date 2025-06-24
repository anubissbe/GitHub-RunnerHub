import Docker from 'dockerode';
import config from '../config';
import { createLogger } from '../utils/logger';
import { DelegatedJob, ContainerConfig } from '../types';
import { GitHubAPIService } from './github-api';

const logger = createLogger('ContainerOrchestrator');

export interface JobResult {
  success: boolean;
  exitCode: number;
  logs?: string;
  duration?: number;
}

export class ContainerOrchestrator {
  private docker: Docker;
  private githubApi: GitHubAPIService;

  constructor() {
    // Use Docker socket proxy if configured
    if (config.docker.socketProxy) {
      this.docker = new Docker({
        host: config.docker.socketProxy.split('://')[1].split(':')[0],
        port: parseInt(config.docker.socketProxy.split(':')[2] || '2375'),
        protocol: config.docker.socketProxy.split('://')[0] as 'http' | 'https'
      });
    } else {
      this.docker = new Docker({ socketPath: config.docker.host });
    }

    this.githubApi = new GitHubAPIService();
  }

  /**
   * Run a job in an ephemeral container
   */
  async runJob(job: DelegatedJob): Promise<JobResult> {
    const startTime = Date.now();
    const containerName = `runner-${job.id}`;

    try {
      logger.info('Starting ephemeral container for job', {
        jobId: job.id,
        repository: job.repository
      });

      // Generate JIT runner token
      const runnerToken = await this.githubApi.generateRunnerToken(job.repository);

      // Prepare container configuration
      const containerConfig: ContainerConfig = {
        image: 'ghcr.io/YOUR_GITHUB_ORG/github-runner:latest',
        name: containerName,
        env: {
          RUNNER_TOKEN: runnerToken,
          RUNNER_NAME: `ephemeral-${job.id}`,
          RUNNER_LABELS: `ephemeral,container,${job.labels.join(',')}`,
          GITHUB_URL: `https://github.com/${job.repository}`,
          RUNNER_EPHEMERAL: '1',
          RUNNER_WORK_DIRECTORY: '_work',
          JOB_ID: job.jobId,
          RUN_ID: job.runId
        },
        labels: {
          'com.github.runnerhub.job-id': job.id,
          'com.github.runnerhub.repository': job.repository,
          'com.github.runnerhub.type': 'ephemeral'
        },
        networks: [this.getNetworkName(job.repository)],
        cpuLimit: 2,
        memoryLimit: '4g',
        autoRemove: true
      };

      // Ensure network exists
      await this.ensureNetwork(job.repository);

      // Create and start container
      const container = await this.createContainer(containerConfig);
      await container.start();

      logger.info('Container started successfully', {
        jobId: job.id,
        containerId: container.id
      });

      // Wait for container to exit
      const result = await this.waitForContainer(container, job);

      const duration = Date.now() - startTime;
      logger.info('Job execution completed', {
        jobId: job.id,
        success: result.success,
        exitCode: result.exitCode,
        duration
      });

      return {
        ...result,
        duration
      };
    } catch (error) {
      logger.error('Failed to run job in container', {
        jobId: job.id,
        error
      });

      return {
        success: false,
        exitCode: -1,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Create container with configuration
   */
  private async createContainer(config: ContainerConfig): Promise<Docker.Container> {
    const createOptions: Docker.ContainerCreateOptions = {
      Image: config.image,
      name: config.name,
      Env: Object.entries(config.env).map(([k, v]) => `${k}=${v}`),
      Labels: config.labels,
      HostConfig: {
        AutoRemove: config.autoRemove ?? true,
        NetworkMode: config.networks[0],
        CpuQuota: config.cpuLimit ? config.cpuLimit * 100000 : undefined,
        Memory: config.memoryLimit ? this.parseMemoryLimit(config.memoryLimit) : undefined,
        MemorySwap: config.memoryLimit ? this.parseMemoryLimit(config.memoryLimit) : undefined,
        SecurityOpt: ['no-new-privileges'],
        ReadonlyRootfs: false,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=1g'
        }
      }
    };

    return await this.docker.createContainer(createOptions);
  }

  /**
   * Wait for container to complete
   */
  private async waitForContainer(container: Docker.Container, job: DelegatedJob): Promise<JobResult> {
    return new Promise((resolve) => {
      let logs = '';
      let resolved = false;

      // Set timeout
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          logger.warn('Container execution timeout', { jobId: job.id });
          container.kill().catch(() => {});
          resolve({
            success: false,
            exitCode: -1,
            logs: logs.substring(logs.length - 10000) // Last 10KB of logs
          });
        }
      }, 3600000); // 1 hour timeout

      // Stream logs
      container.logs({
        stdout: true,
        stderr: true,
        follow: true,
        timestamps: true
      }, (err, stream) => {
        if (err) {
          logger.error('Failed to get container logs', { error: err });
          return;
        }

        stream?.on('data', (chunk) => {
          logs += chunk.toString();
        });
      });

      // Wait for container to exit
      container.wait((err, data) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);

          if (err) {
            logger.error('Container wait error', { error: err });
            resolve({
              success: false,
              exitCode: -1,
              logs: logs.substring(logs.length - 10000)
            });
          } else {
            resolve({
              success: data.StatusCode === 0,
              exitCode: data.StatusCode,
              logs: logs.substring(logs.length - 10000)
            });
          }
        }
      });
    });
  }

  /**
   * Ensure network exists for repository
   */
  private async ensureNetwork(repository: string): Promise<void> {
    const networkName = this.getNetworkName(repository);

    try {
      await this.docker.getNetwork(networkName).inspect();
    } catch (_error) {
      // Network doesn't exist, create it
      logger.info('Creating network for repository', { repository, networkName });
      
      await this.docker.createNetwork({
        Name: networkName,
        Driver: 'bridge',
        Labels: {
          'com.github.runnerhub.repository': repository
        },
        Options: {
          'com.docker.network.bridge.name': networkName
        }
      });
    }
  }

  /**
   * Get network name for repository
   */
  private getNetworkName(repository: string): string {
    const sanitized = repository.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
    return `${config.runner.networkPrefix}-${sanitized}`;
  }

  /**
   * Parse memory limit string to bytes
   */
  private parseMemoryLimit(limit: string): number {
    const units: Record<string, number> = {
      'b': 1,
      'k': 1024,
      'm': 1024 * 1024,
      'g': 1024 * 1024 * 1024
    };

    const match = limit.toLowerCase().match(/^(\d+)([bkmg])?$/);
    if (!match) {
      throw new Error(`Invalid memory limit: ${limit}`);
    }

    const value = parseInt(match[1]);
    const unit = match[2] || 'b';
    
    return value * units[unit];
  }

  /**
   * Clean up stale containers
   */
  async cleanupStaleContainers(): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: ['com.github.runnerhub.type=ephemeral']
        }
      });

      const now = Date.now();
      for (const containerInfo of containers) {
        const created = containerInfo.Created * 1000;
        const age = now - created;

        // Remove containers older than 2 hours
        if (age > 7200000) {
          logger.info('Removing stale container', {
            containerId: containerInfo.Id,
            age: Math.floor(age / 60000) + ' minutes'
          });

          try {
            const container = this.docker.getContainer(containerInfo.Id);
            await container.remove({ force: true });
          } catch (err) {
            logger.error('Failed to remove container', { 
              containerId: containerInfo.Id, 
              error: err 
            });
          }
        }
      }
    } catch (error) {
      logger.error('Cleanup failed', { error });
    }
  }
}

export default ContainerOrchestrator;