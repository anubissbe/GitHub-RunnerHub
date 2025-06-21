/**
 * Docker API Integration Layer
 * Provides high-level interface for container management
 */

const Docker = require('dockerode');
const EventEmitter = require('events');
const logger = require('../utils/logger');

class DockerAPIManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.docker = new Docker(options.dockerOptions || {});
    this.config = {
      baseImage: options.baseImage || 'github-actions-runner:latest',
      networkName: options.networkName || 'github-runners',
      volumePrefix: options.volumePrefix || 'github-runner-',
      maxContainers: options.maxContainers || 10,
      resourceLimits: {
        memory: options.memory || '2147483648', // 2GB in bytes
        cpus: options.cpus || '1.0',
        ...options.resourceLimits
      }
    };
    
    this.containers = new Map(); // Track running containers
    this.initialized = false;
  }

  /**
   * Initialize Docker environment
   */
  async initialize() {
    try {
      // Test Docker connection
      await this.docker.ping();
      logger.info('Docker daemon connection established');

      // Create dedicated network for runners
      await this.ensureNetwork();
      
      // Pull base image if not exists
      await this.ensureBaseImage();
      
      this.initialized = true;
      this.emit('initialized');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize Docker API:', error);
      throw error;
    }
  }

  /**
   * Ensure dedicated network exists
   */
  async ensureNetwork() {
    try {
      const networks = await this.docker.listNetworks();
      const networkExists = networks.some(net => net.Name === this.config.networkName);
      
      if (!networkExists) {
        logger.info(`Creating network: ${this.config.networkName}`);
        await this.docker.createNetwork({
          Name: this.config.networkName,
          Driver: 'bridge',
          Options: {
            'com.docker.network.bridge.enable_icc': 'false', // Disable inter-container communication
            'com.docker.network.bridge.enable_ip_masquerade': 'true'
          },
          Labels: {
            'github-runner': 'true',
            'managed-by': 'github-runnerhub'
          }
        });
        logger.info(`Network ${this.config.networkName} created`);
      }
    } catch (error) {
      logger.error('Failed to ensure network:', error);
      throw error;
    }
  }

  /**
   * Ensure base image is available
   */
  async ensureBaseImage() {
    try {
      const images = await this.docker.listImages();
      const imageExists = images.some(img => 
        img.RepoTags && img.RepoTags.includes(this.config.baseImage)
      );
      
      if (!imageExists) {
        logger.info(`Pulling base image: ${this.config.baseImage}`);
        await this.pullImage(this.config.baseImage);
      }
    } catch (error) {
      logger.warn('Base image not available, will need to build or pull:', error.message);
    }
  }

  /**
   * Pull Docker image
   */
  async pullImage(imageName) {
    return new Promise((resolve, reject) => {
      this.docker.pull(imageName, (err, stream) => {
        if (err) return reject(err);
        
        this.docker.modem.followProgress(stream, (err, res) => {
          if (err) return reject(err);
          logger.info(`Image ${imageName} pulled successfully`);
          resolve(res);
        });
      });
    });
  }

  /**
   * Create a new container for job execution
   */
  async createContainer(jobId, config = {}) {
    if (!this.initialized) {
      throw new Error('Docker API not initialized');
    }

    const containerName = `github-runner-${jobId}`;
    const containerConfig = {
      Image: this.config.baseImage,
      name: containerName,
      Env: [
        `JOB_ID=${jobId}`,
        `RUNNER_NAME=${containerName}`,
        ...config.env || []
      ],
      HostConfig: {
        Memory: this.config.resourceLimits.memory,
        CpuQuota: Math.floor(parseFloat(this.config.resourceLimits.cpus) * 100000),
        CpuPeriod: 100000,
        NetworkMode: this.config.networkName,
        AutoRemove: false, // We'll handle cleanup manually
        SecurityOpt: [
          'no-new-privileges:true'
        ],
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID'], // Minimal capabilities
        ReadonlyRootfs: false, // GitHub Actions needs write access
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=100m'
        }
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [this.config.networkName]: {
            Aliases: [containerName]
          }
        }
      },
      Labels: {
        'github-runner': 'true',
        'job-id': jobId,
        'managed-by': 'github-runnerhub',
        'created-at': new Date().toISOString()
      },
      ...config.containerConfig
    };

    try {
      const container = await this.docker.createContainer(containerConfig);
      
      // Track container
      this.containers.set(jobId, {
        container,
        jobId,
        name: containerName,
        status: 'created',
        createdAt: new Date(),
        config: containerConfig
      });

      logger.info(`Container created for job ${jobId}: ${container.id}`);
      this.emit('containerCreated', { jobId, containerId: container.id });
      
      return container;
    } catch (error) {
      logger.error(`Failed to create container for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Start a container
   */
  async startContainer(jobId) {
    const containerInfo = this.containers.get(jobId);
    if (!containerInfo) {
      throw new Error(`Container for job ${jobId} not found`);
    }

    try {
      await containerInfo.container.start();
      containerInfo.status = 'running';
      containerInfo.startedAt = new Date();
      
      logger.info(`Container started for job ${jobId}`);
      this.emit('containerStarted', { jobId, containerId: containerInfo.container.id });
      
      return containerInfo.container;
    } catch (error) {
      logger.error(`Failed to start container for job ${jobId}:`, error);
      containerInfo.status = 'failed';
      throw error;
    }
  }

  /**
   * Execute command in container
   */
  async execInContainer(jobId, cmd, options = {}) {
    const containerInfo = this.containers.get(jobId);
    if (!containerInfo) {
      throw new Error(`Container for job ${jobId} not found`);
    }

    const execOptions = {
      Cmd: Array.isArray(cmd) ? cmd : ['/bin/bash', '-c', cmd],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      ...options
    };

    try {
      const exec = await containerInfo.container.exec(execOptions);
      const stream = await exec.start({ hijack: true, stdin: false });
      
      return new Promise((resolve, reject) => {
        const chunks = [];
        
        stream.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        stream.on('end', async () => {
          try {
            const inspect = await exec.inspect();
            const output = Buffer.concat(chunks).toString();
            
            resolve({
              exitCode: inspect.ExitCode,
              output,
              success: inspect.ExitCode === 0
            });
          } catch (error) {
            reject(error);
          }
        });
        
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error(`Failed to execute command in container ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(jobId, options = {}) {
    const containerInfo = this.containers.get(jobId);
    if (!containerInfo) {
      throw new Error(`Container for job ${jobId} not found`);
    }

    const logOptions = {
      stdout: true,
      stderr: true,
      follow: false,
      tail: 1000,
      ...options
    };

    try {
      const logs = await containerInfo.container.logs(logOptions);
      return logs.toString();
    } catch (error) {
      logger.error(`Failed to get logs for container ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Stop container
   */
  async stopContainer(jobId, timeout = 30) {
    const containerInfo = this.containers.get(jobId);
    if (!containerInfo) {
      throw new Error(`Container for job ${jobId} not found`);
    }

    try {
      await containerInfo.container.stop({ t: timeout });
      containerInfo.status = 'stopped';
      containerInfo.stoppedAt = new Date();
      
      logger.info(`Container stopped for job ${jobId}`);
      this.emit('containerStopped', { jobId, containerId: containerInfo.container.id });
      
      return true;
    } catch (error) {
      if (error.statusCode === 304) {
        // Container already stopped
        containerInfo.status = 'stopped';
        return true;
      }
      logger.error(`Failed to stop container for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Remove container and cleanup
   */
  async removeContainer(jobId, force = false) {
    const containerInfo = this.containers.get(jobId);
    if (!containerInfo) {
      return true; // Already removed
    }

    try {
      await containerInfo.container.remove({ force });
      this.containers.delete(jobId);
      
      logger.info(`Container removed for job ${jobId}`);
      this.emit('containerRemoved', { jobId });
      
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        // Container already removed
        this.containers.delete(jobId);
        return true;
      }
      logger.error(`Failed to remove container for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get container stats
   */
  async getContainerStats(jobId) {
    const containerInfo = this.containers.get(jobId);
    if (!containerInfo) {
      throw new Error(`Container for job ${jobId} not found`);
    }

    try {
      const stats = await containerInfo.container.stats({ stream: false });
      return stats;
    } catch (error) {
      logger.error(`Failed to get stats for container ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * List all managed containers
   */
  getActiveContainers() {
    return Array.from(this.containers.values());
  }

  /**
   * Cleanup all containers
   */
  async cleanup() {
    const containers = Array.from(this.containers.keys());
    const cleanupPromises = containers.map(jobId => 
      this.removeContainer(jobId, true).catch(err => 
        logger.error(`Failed to cleanup container ${jobId}:`, err)
      )
    );
    
    await Promise.all(cleanupPromises);
    logger.info('Docker cleanup completed');
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      await this.docker.ping();
      return {
        status: 'healthy',
        containers: this.containers.size,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date()
      };
    }
  }
}

module.exports = DockerAPIManager;