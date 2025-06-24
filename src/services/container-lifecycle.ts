import Docker from 'dockerode';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import database from './database';
import monitoringService from './monitoring';
import { ContainerConfig, RunnerStatus } from '../types';
import config from '../config';

const logger = createLogger('ContainerLifecycle');

export interface ContainerInfo {
  id: string;
  name: string;
  state: ContainerState;
  runnerId?: string;
  jobId?: string;
  repository?: string;
  labels?: Record<string, string>;
  created: Date;
  started?: Date;
  finished?: Date;
  exitCode?: number;
  resourceUsage?: ResourceUsage;
}

export enum ContainerState {
  CREATING = 'creating',
  CREATED = 'created',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  REMOVING = 'removing',
  REMOVED = 'removed',
  ERROR = 'error'
}

export interface ResourceUsage {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
}

export interface ContainerLimits {
  cpuShares?: number;
  cpuQuota?: number;
  memoryMB?: number;
  diskGB?: number;
  pidsLimit?: number;
}

export class ContainerLifecycleManager extends EventEmitter {
  private static instance: ContainerLifecycleManager;
  private docker: Docker;
  private containers: Map<string, ContainerInfo> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.docker = new Docker({
      socketPath: config.docker.socketPath || '/var/run/docker.sock'
    });
  }

  public static getInstance(): ContainerLifecycleManager {
    if (!ContainerLifecycleManager.instance) {
      ContainerLifecycleManager.instance = new ContainerLifecycleManager();
    }
    return ContainerLifecycleManager.instance;
  }

  /**
   * Initialize the container lifecycle manager
   */
  async initialize(): Promise<void> {
    logger.info('Initializing container lifecycle manager');

    try {
      // Verify Docker connection
      await this.docker.ping();
      logger.info('Docker connection established');

      // Load existing containers
      await this.loadExistingContainers();

      // Start monitoring
      this.startMonitoring();
      this.startCleanup();

      logger.info('Container lifecycle manager initialized');
    } catch (error) {
      logger.error('Failed to initialize container lifecycle manager', { error });
      throw error;
    }
  }

  /**
   * Create a new container for a runner
   */
  async createContainer(
    runnerId: string,
    jobId: string,
    containerConfig: ContainerConfig,
    limits?: ContainerLimits
  ): Promise<string> {
    const containerName = `runner-${runnerId}-${Date.now()}`;
    
    logger.info('Creating container', { 
      runnerId, 
      jobId, 
      name: containerName 
    });

    try {
      // Build container options
      const createOptions: Docker.ContainerCreateOptions = {
        Image: containerConfig.image,
        name: containerName,
        Env: Object.entries(containerConfig.env).map(([k, v]) => `${k}=${v}`),
        Labels: {
          ...containerConfig.labels,
          'runnerhub.runner.id': runnerId,
          'runnerhub.job.id': jobId,
          'runnerhub.managed': 'true'
        },
        HostConfig: {
          AutoRemove: containerConfig.autoRemove ?? true,
          NetworkMode: containerConfig.networks?.[0] || 'bridge',
          RestartPolicy: {
            Name: 'no'
          },
          // Resource limits
          CpuShares: limits?.cpuShares || 1024,
          CpuQuota: limits?.cpuQuota || 0,
          Memory: limits?.memoryMB ? limits.memoryMB * 1024 * 1024 : 0,
          MemorySwap: limits?.memoryMB ? limits.memoryMB * 1024 * 1024 : 0,
          PidsLimit: limits?.pidsLimit || 0,
          // Security options
          ReadonlyRootfs: false,
          SecurityOpt: ['no-new-privileges'],
          CapDrop: ['ALL'],
          CapAdd: ['CHOWN', 'SETUID', 'SETGID']
        },
        // Volumes
        Volumes: containerConfig.volumes?.reduce((acc, vol) => {
          const [_host, container] = vol.split(':');
          acc[container] = {};
          return acc;
        }, {} as Record<string, any>),
        // Working directory
        WorkingDir: '/home/runner/work'
      };

      if (containerConfig.volumes) {
        createOptions.HostConfig!.Binds = containerConfig.volumes;
      }

      // Create container
      const container = await this.docker.createContainer(createOptions);
      
      // Track container
      const containerInfo: ContainerInfo = {
        id: container.id,
        name: containerName,
        state: ContainerState.CREATED,
        runnerId,
        jobId,
        repository: containerConfig.labels.repository,
        labels: containerConfig.labels,
        created: new Date()
      };

      this.containers.set(container.id, containerInfo);
      this.emit('container:created', containerInfo);

      // Update database
      await database.query(
        `UPDATE runnerhub.runners 
         SET container_id = $1, status = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [container.id, RunnerStatus.STARTING, runnerId]
      );

      logger.info('Container created successfully', { 
        containerId: container.id,
        name: containerName 
      });

      return container.id;
    } catch (error) {
      logger.error('Failed to create container', { 
        runnerId, 
        jobId, 
        error 
      });
      
      this.emit('container:error', {
        runnerId,
        jobId,
        error
      });
      
      throw error;
    }
  }

  /**
   * Start a container
   */
  async startContainer(containerId: string): Promise<void> {
    logger.info('Starting container', { containerId });

    try {
      const container = this.docker.getContainer(containerId);
      const containerInfo = this.containers.get(containerId);

      if (!containerInfo) {
        throw new Error('Container not tracked');
      }

      // Update state
      containerInfo.state = ContainerState.STARTING;
      this.emit('container:starting', containerInfo);

      // Start container
      await container.start();

      // Update state
      containerInfo.state = ContainerState.RUNNING;
      containerInfo.started = new Date();
      this.emit('container:started', containerInfo);

      // Update runner status
      if (containerInfo.runnerId) {
        await database.query(
          `UPDATE runnerhub.runners 
           SET status = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [RunnerStatus.BUSY, containerInfo.runnerId]
        );
      }

      // Record monitoring event
      monitoringService.recordRunnerEvent(
        containerInfo.runnerId || 'unknown',
        'container-started',
        { containerId, jobId: containerInfo.jobId }
      );

      logger.info('Container started successfully', { containerId });
    } catch (error) {
      logger.error('Failed to start container', { containerId, error });
      
      const containerInfo = this.containers.get(containerId);
      if (containerInfo) {
        containerInfo.state = ContainerState.ERROR;
        this.emit('container:error', { containerId, error });
      }
      
      throw error;
    }
  }

  /**
   * Stop a container
   */
  async stopContainer(containerId: string, timeout: number = 30): Promise<void> {
    logger.info('Stopping container', { containerId, timeout });

    try {
      const container = this.docker.getContainer(containerId);
      const containerInfo = this.containers.get(containerId);

      if (!containerInfo) {
        logger.warn('Container not tracked', { containerId });
        return;
      }

      // Update state
      containerInfo.state = ContainerState.STOPPING;
      this.emit('container:stopping', containerInfo);

      // Stop container
      await container.stop({ t: timeout });

      // Get exit code
      const inspect = await container.inspect();
      containerInfo.exitCode = inspect.State.ExitCode;
      containerInfo.finished = new Date();
      containerInfo.state = ContainerState.STOPPED;
      
      this.emit('container:stopped', containerInfo);

      // Update runner status
      if (containerInfo.runnerId) {
        await database.query(
          `UPDATE runnerhub.runners 
           SET status = $1, container_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [RunnerStatus.IDLE, containerInfo.runnerId]
        );
      }

      logger.info('Container stopped successfully', { 
        containerId,
        exitCode: containerInfo.exitCode 
      });
    } catch (error: any) {
      // Container might already be stopped
      if (error.statusCode === 304) {
        logger.debug('Container already stopped', { containerId });
        const containerInfo = this.containers.get(containerId);
        if (containerInfo) {
          containerInfo.state = ContainerState.STOPPED;
        }
      } else {
        logger.error('Failed to stop container', { containerId, error });
        throw error;
      }
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(containerId: string, force: boolean = false): Promise<void> {
    logger.info('Removing container', { containerId, force });

    try {
      const container = this.docker.getContainer(containerId);
      const containerInfo = this.containers.get(containerId);

      if (!containerInfo) {
        logger.warn('Container not tracked', { containerId });
      } else {
        containerInfo.state = ContainerState.REMOVING;
        this.emit('container:removing', containerInfo);
      }

      // Remove container
      await container.remove({ force });

      // Update tracking
      if (containerInfo) {
        containerInfo.state = ContainerState.REMOVED;
        this.emit('container:removed', containerInfo);
        this.containers.delete(containerId);
      }

      logger.info('Container removed successfully', { containerId });
    } catch (error: any) {
      // Container might already be removed
      if (error.statusCode === 404) {
        logger.debug('Container already removed', { containerId });
        this.containers.delete(containerId);
      } else {
        logger.error('Failed to remove container', { containerId, error });
        throw error;
      }
    }
  }

  /**
   * Get container stats
   */
  async getContainerStats(containerId: string): Promise<ResourceUsage> {
    try {
      const container = this.docker.getContainer(containerId);
      const stream = await container.stats({ stream: false });
      
      // Calculate CPU usage
      const cpuDelta = stream.cpu_stats.cpu_usage.total_usage - 
                      stream.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stream.cpu_stats.system_cpu_usage - 
                         stream.precpu_stats.system_cpu_usage;
      const cpuPercent = (cpuDelta / systemDelta) * 
                        stream.cpu_stats.online_cpus * 100;

      // Memory usage
      const memoryUsage = stream.memory_stats.usage || 0;
      const memoryLimit = stream.memory_stats.limit || 0;

      // Network stats
      const networks = stream.networks || {};
      let networkRx = 0;
      let networkTx = 0;
      
      Object.values(networks).forEach((net: any) => {
        networkRx += net.rx_bytes || 0;
        networkTx += net.tx_bytes || 0;
      });

      // Block I/O stats
      let blockRead = 0;
      let blockWrite = 0;
      
      if (stream.blkio_stats?.io_service_bytes_recursive) {
        stream.blkio_stats.io_service_bytes_recursive.forEach((stat: any) => {
          if (stat.op === 'Read') blockRead += stat.value;
          if (stat.op === 'Write') blockWrite += stat.value;
        });
      }

      return {
        cpuPercent: Math.round(cpuPercent * 100) / 100,
        memoryUsage,
        memoryLimit,
        networkRx,
        networkTx,
        blockRead,
        blockWrite
      };
    } catch (error) {
      logger.error('Failed to get container stats', { containerId, error });
      throw error;
    }
  }

  /**
   * Execute command in container
   */
  async executeCommand(
    containerId: string, 
    command: string[],
    options?: {
      user?: string;
      workingDir?: string;
      env?: string[];
    }
  ): Promise<{ exitCode: number; output: string }> {
    logger.debug('Executing command in container', { 
      containerId, 
      command: command.join(' ') 
    });

    try {
      const container = this.docker.getContainer(containerId);
      
      const exec = await container.exec({
        Cmd: command,
        AttachStdout: true,
        AttachStderr: true,
        User: options?.user,
        WorkingDir: options?.workingDir,
        Env: options?.env
      });

      const stream = await exec.start({ Detach: false });
      
      return new Promise((resolve, reject) => {
        let output = '';
        
        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        
        stream.on('end', async () => {
          const { ExitCode } = await exec.inspect();
          resolve({ exitCode: ExitCode || 0, output });
        });
        
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error('Failed to execute command', { containerId, error });
      throw error;
    }
  }

  /**
   * Load existing containers
   */
  private async loadExistingContainers(): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: ['runnerhub.managed=true']
        }
      });

      logger.info(`Found ${containers.length} existing managed containers`);

      for (const containerData of containers) {
        const containerInfo: ContainerInfo = {
          id: containerData.Id,
          name: containerData.Names[0]?.replace('/', '') || 'unknown',
          state: this.mapDockerState(containerData.State),
          runnerId: containerData.Labels['runnerhub.runner.id'],
          jobId: containerData.Labels['runnerhub.job.id'],
          repository: containerData.Labels['repository'],
          labels: containerData.Labels,
          created: new Date(containerData.Created * 1000)
        };

        this.containers.set(containerData.Id, containerInfo);
      }
    } catch (error) {
      logger.error('Failed to load existing containers', { error });
    }
  }

  /**
   * Map Docker state to our state
   */
  private mapDockerState(dockerState: string): ContainerState {
    switch (dockerState.toLowerCase()) {
      case 'created':
        return ContainerState.CREATED;
      case 'running':
        return ContainerState.RUNNING;
      case 'paused':
      case 'restarting':
        return ContainerState.STOPPED;
      case 'removing':
        return ContainerState.REMOVING;
      case 'exited':
      case 'dead':
        return ContainerState.STOPPED;
      default:
        return ContainerState.ERROR;
    }
  }

  /**
   * Start monitoring containers
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      for (const [containerId, containerInfo] of this.containers) {
        if (containerInfo.state === ContainerState.RUNNING) {
          try {
            const stats = await this.getContainerStats(containerId);
            containerInfo.resourceUsage = stats;
            
            // Emit high resource usage events
            if (stats.cpuPercent > 80) {
              this.emit('container:high-cpu', { containerId, cpu: stats.cpuPercent });
            }
            
            if (stats.memoryLimit > 0 && 
                (stats.memoryUsage / stats.memoryLimit) > 0.9) {
              this.emit('container:high-memory', { 
                containerId, 
                usage: stats.memoryUsage,
                limit: stats.memoryLimit 
              });
            }
          } catch {
            // Container might have stopped
            logger.debug('Failed to get stats for container', { containerId });
          }
        }
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Start cleanup process
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(async () => {
      const stoppedContainers = Array.from(this.containers.values())
        .filter(c => c.state === ContainerState.STOPPED);

      for (const container of stoppedContainers) {
        const age = Date.now() - container.created.getTime();
        
        // Remove containers older than 1 hour
        if (age > 3600000) {
          try {
            await this.removeContainer(container.id);
            logger.info('Cleaned up old container', { 
              containerId: container.id,
              age: Math.round(age / 60000) + ' minutes'
            });
          } catch (error) {
            logger.error('Failed to cleanup container', { 
              containerId: container.id,
              error 
            });
          }
        }
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * Stop monitoring and cleanup
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down container lifecycle manager');

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Stop all running containers
    const runningContainers = Array.from(this.containers.values())
      .filter(c => c.state === ContainerState.RUNNING);

    for (const container of runningContainers) {
      try {
        await this.stopContainer(container.id);
      } catch (error) {
        logger.error('Failed to stop container during shutdown', { 
          containerId: container.id,
          error 
        });
      }
    }
  }

  /**
   * Get all containers
   */
  getAllContainers(): ContainerInfo[] {
    return Array.from(this.containers.values());
  }

  /**
   * Get container by runner ID
   */
  getContainerByRunnerId(runnerId: string): ContainerInfo | undefined {
    return Array.from(this.containers.values())
      .find(c => c.runnerId === runnerId);
  }

  /**
   * Get container by job ID
   */
  getContainerByJobId(jobId: string): ContainerInfo | undefined {
    return Array.from(this.containers.values())
      .find(c => c.jobId === jobId);
  }

  /**
   * Get container logs
   */
  async getContainerLogs(
    containerId: string,
    _options?: {
      stdout?: boolean;
      stderr?: boolean;
      timestamps?: boolean;
      tail?: number | 'all';
    }
  ): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Use inspect to get container logs through exec
      const exec = await container.exec({
        Cmd: ['sh', '-c', 'cat /proc/1/fd/1 2>&1 || echo "No logs available"'],
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start({ hijack: true, stdin: false });
      
      // Collect output
      const chunks: Buffer[] = [];
      
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        
        stream.on('end', () => {
          const logs = Buffer.concat(chunks).toString('utf8');
          resolve(logs);
        });
        
        stream.on('error', (err: Error) => {
          reject(err);
        });
      });
    } catch (error) {
      logger.error('Failed to get container logs', { containerId, error });
      // Return empty string on error to avoid breaking cleanup
      return '';
    }
  }
}

export default ContainerLifecycleManager.getInstance();