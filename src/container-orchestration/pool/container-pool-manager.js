/**
 * Container Pool Manager
 * Advanced container pool management system for optimal resource usage and dynamic scaling
 */

const EventEmitter = require('events');
const Docker = require('dockerode');
const logger = require('../../utils/logger');

class ContainerPoolManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Pool configuration
      pool: {
        minSize: options.minPoolSize || 3,
        maxSize: options.maxPoolSize || 20,
        targetSize: options.targetPoolSize || 8,
        warmupContainers: options.warmupContainers || 2
      },
      
      // Container configuration
      container: {
        baseImage: options.baseImage || 'ubuntu:22.04',
        networkMode: options.networkMode || 'bridge',
        memory: options.memoryLimit || '2g',
        cpus: options.cpuLimit || '1.0',
        workingDir: options.workingDir || '/workspace',
        autoRemove: options.autoRemove !== false
      },
      
      // Scaling configuration
      scaling: {
        scaleUpThreshold: options.scaleUpThreshold || 0.8, // 80%
        scaleDownThreshold: options.scaleDownThreshold || 0.3, // 30%
        scaleUpCooldown: options.scaleUpCooldown || 30000, // 30 seconds
        scaleDownCooldown: options.scaleDownCooldown || 180000, // 3 minutes
        maxScaleUpPerInterval: options.maxScaleUpPerInterval || 3,
        maxScaleDownPerInterval: options.maxScaleDownPerInterval || 2
      },
      
      // Health monitoring
      health: {
        checkInterval: options.healthCheckInterval || 30000, // 30 seconds
        unhealthyThreshold: options.unhealthyThreshold || 3,
        idleTimeout: options.idleTimeout || 300000, // 5 minutes
        maxContainerAge: options.maxContainerAge || 3600000 // 1 hour
      },
      
      // Resource monitoring
      resources: {
        monitoringInterval: options.resourceMonitoringInterval || 15000, // 15 seconds
        cpuThreshold: options.cpuThreshold || 80, // 80%
        memoryThreshold: options.memoryThreshold || 85, // 85%
        enableResourceOptimization: options.enableResourceOptimization !== false
      },
      
      ...options
    };
    
    // Docker client
    this.docker = new Docker();
    
    // Pool state
    this.containers = new Map(); // containerId -> container info
    this.availableContainers = new Set(); // containers ready for work
    this.busyContainers = new Set(); // containers currently in use
    this.warmingContainers = new Set(); // containers being prepared
    this.poolTemplates = new Map(); // template -> container configs
    
    // Scaling state
    this.lastScaleUp = 0;
    this.lastScaleDown = 0;
    this.scalingInProgress = false;
    
    // Statistics
    this.stats = {
      totalCreated: 0,
      totalDestroyed: 0,
      totalJobsProcessed: 0,
      avgJobDuration: 0,
      poolUtilization: 0,
      resourceUtilization: {
        cpu: 0,
        memory: 0
      },
      uptime: Date.now()
    };
    
    // Timers
    this.healthCheckTimer = null;
    this.resourceMonitorTimer = null;
    this.scalingTimer = null;
    
    // Pool initialization state
    this.isInitialized = false;
    this.isStarted = false;
  }

  /**
   * Initialize container pool manager
   */
  async initialize() {
    try {
      logger.info('Initializing Container Pool Manager');
      
      // Validate Docker connection
      await this.validateDockerConnection();
      
      // Create default pool template
      this.createDefaultPoolTemplate();
      
      // Initialize base containers
      await this.initializePool();
      
      // Start monitoring systems
      this.startHealthMonitoring();
      this.startResourceMonitoring();
      this.startScalingEngine();
      
      this.isInitialized = true;
      this.isStarted = true;
      
      this.emit('initialized', {
        poolSize: this.getPoolSize(),
        availableContainers: this.availableContainers.size
      });
      
      logger.info(`Container Pool Manager initialized with ${this.getPoolSize()} containers`);
      
    } catch (error) {
      logger.error('Failed to initialize Container Pool Manager:', error);
      throw error;
    }
  }

  /**
   * Validate Docker connection
   */
  async validateDockerConnection() {
    try {
      const info = await this.docker.info();
      logger.info(`Connected to Docker daemon: ${info.ServerVersion}`);
      
      // Check if we have sufficient resources
      const systemInfo = {
        containers: info.Containers,
        images: info.Images,
        memTotal: Math.round(info.MemTotal / 1024 / 1024 / 1024), // GB
        cpus: info.NCPU
      };
      
      logger.info('Docker system info:', systemInfo);
      
      if (systemInfo.memTotal < 2) {
        logger.warn('Low memory detected. Consider increasing available memory.');
      }
      
    } catch (error) {
      logger.error('Docker connection failed:', error);
      throw new Error(`Docker connection failed: ${error.message}`);
    }
  }

  /**
   * Create default pool template
   */
  createDefaultPoolTemplate() {
    const defaultTemplate = {
      name: 'default-runner',
      image: this.config.container.baseImage,
      config: {
        Image: this.config.container.baseImage,
        WorkingDir: this.config.container.workingDir,
        Env: [
          'RUNNER_POOL=true',
          'RUNNER_TEMPLATE=default',
          'DEBIAN_FRONTEND=noninteractive'
        ],
        Labels: {
          'runnerhub.pool': 'true',
          'runnerhub.template': 'default-runner',
          'runnerhub.created': new Date().toISOString()
        },
        HostConfig: {
          Memory: this.parseMemoryLimit(this.config.container.memory),
          NanoCpus: this.parseCpuLimit(this.config.container.cpus),
          NetworkMode: this.config.container.networkMode,
          AutoRemove: this.config.container.autoRemove,
          SecurityOpt: ['no-new-privileges:true'],
          ReadonlyRootfs: false,
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=100m'
          }
        },
        NetworkingConfig: {
          EndpointsConfig: {}
        }
      },
      setupCommands: [
        'apt-get update -qq',
        'apt-get install -y -qq curl git wget unzip',
        'apt-get clean && rm -rf /var/lib/apt/lists/*',
        'mkdir -p /workspace',
        'chmod 755 /workspace'
      ]
    };
    
    this.poolTemplates.set('default-runner', defaultTemplate);
    logger.info('Created default pool template');
  }

  /**
   * Initialize container pool
   */
  async initializePool() {
    logger.info(`Initializing container pool with ${this.config.pool.minSize} containers`);
    
    const initPromises = [];
    for (let i = 0; i < this.config.pool.minSize; i++) {
      initPromises.push(this.createPoolContainer('default-runner'));
    }
    
    const results = await Promise.allSettled(initPromises);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        errorCount++;
        logger.error('Failed to create pool container:', result.reason);
      }
    }
    
    logger.info(`Pool initialization complete: ${successCount} created, ${errorCount} failed`);
    
    if (successCount === 0) {
      throw new Error('Failed to create any pool containers');
    }
    
    // Start warmup containers if configured
    if (this.config.pool.warmupContainers > 0) {
      this.startWarmupContainers();
    }
  }

  /**
   * Create a new pool container
   */
  async createPoolContainer(templateName = 'default-runner') {
    const template = this.poolTemplates.get(templateName);
    if (!template) {
      throw new Error(`Pool template not found: ${templateName}`);
    }
    
    try {
      // Create container
      const container = await this.docker.createContainer(template.config);
      const containerId = container.id;
      
      // Store container info
      const containerInfo = {
        id: containerId,
        template: templateName,
        status: 'created',
        createdAt: new Date(),
        lastUsed: null,
        jobCount: 0,
        isHealthy: true,
        healthCheckFailures: 0,
        resourceUsage: {
          cpu: 0,
          memory: 0
        }
      };
      
      this.containers.set(containerId, containerInfo);
      
      // Start container
      await container.start();
      containerInfo.status = 'running';
      containerInfo.startedAt = new Date();
      
      // Run setup commands
      await this.runSetupCommands(container, template.setupCommands);
      
      // Mark as available
      containerInfo.status = 'available';
      this.availableContainers.add(containerId);
      
      this.stats.totalCreated++;
      
      logger.debug(`Created pool container: ${containerId.substring(0, 12)}`);
      
      this.emit('containerCreated', {
        containerId,
        template: templateName,
        poolSize: this.getPoolSize()
      });
      
      return containerId;
      
    } catch (error) {
      logger.error(`Failed to create pool container:`, error);
      throw error;
    }
  }

  /**
   * Run setup commands in container
   */
  async runSetupCommands(container, commands) {
    if (!commands || commands.length === 0) {
      return;
    }
    
    try {
      for (const command of commands) {
        const exec = await container.exec({
          Cmd: ['sh', '-c', command],
          AttachStdout: false,
          AttachStderr: false
        });
        
        await exec.start({ Detach: true });
      }
      
      // Wait a moment for commands to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      logger.warn('Setup command failed (non-fatal):', error.message);
    }
  }

  /**
   * Get an available container from the pool
   */
  async getContainer(requirements = {}) {
    // Check if we have available containers
    if (this.availableContainers.size === 0) {
      logger.warn('No available containers in pool, attempting to scale up');
      await this.scaleUp(1);
      
      // Wait a moment for container to be ready
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      if (this.availableContainers.size === 0) {
        throw new Error('No containers available and scaling failed');
      }
    }
    
    // Select best container based on requirements
    const containerId = this.selectBestContainer(requirements);
    
    if (!containerId) {
      throw new Error('Failed to select suitable container');
    }
    
    // Mark container as busy
    this.availableContainers.delete(containerId);
    this.busyContainers.add(containerId);
    
    const containerInfo = this.containers.get(containerId);
    containerInfo.status = 'busy';
    containerInfo.lastUsed = new Date();
    containerInfo.jobCount++;
    
    this.stats.totalJobsProcessed++;
    this.updatePoolUtilization();
    
    logger.debug(`Assigned container: ${containerId.substring(0, 12)}`);
    
    this.emit('containerAssigned', {
      containerId,
      availableContainers: this.availableContainers.size,
      busyContainers: this.busyContainers.size
    });
    
    return {
      id: containerId,
      container: this.docker.getContainer(containerId),
      info: containerInfo
    };
  }

  /**
   * Return container to pool
   */
  async returnContainer(containerId, jobResult = {}) {
    const containerInfo = this.containers.get(containerId);
    if (!containerInfo) {
      logger.warn(`Container not found in pool: ${containerId}`);
      return;
    }
    
    try {
      // Remove from busy set
      this.busyContainers.delete(containerId);
      
      // Update job statistics
      if (jobResult.duration) {
        this.updateJobDurationStats(jobResult.duration);
      }
      
      // Check if container should be recycled
      if (await this.shouldRecycleContainer(containerInfo)) {
        await this.recycleContainer(containerId);
        return;
      }
      
      // Clean up container for reuse
      await this.cleanupContainer(containerId);
      
      // Return to available pool
      containerInfo.status = 'available';
      this.availableContainers.add(containerId);
      
      this.updatePoolUtilization();
      
      logger.debug(`Returned container to pool: ${containerId.substring(0, 12)}`);
      
      this.emit('containerReturned', {
        containerId,
        availableContainers: this.availableContainers.size,
        busyContainers: this.busyContainers.size
      });
      
    } catch (error) {
      logger.error(`Failed to return container to pool:`, error);
      await this.removeContainer(containerId);
    }
  }

  /**
   * Select best container based on requirements
   */
  selectBestContainer(requirements = {}) {
    const availableIds = Array.from(this.availableContainers);
    
    if (availableIds.length === 0) {
      return null;
    }
    
    // Simple selection: least recently used
    let bestContainer = null;
    let oldestUsage = Date.now();
    
    for (const containerId of availableIds) {
      const info = this.containers.get(containerId);
      
      if (!info.isHealthy) {
        continue;
      }
      
      const lastUsed = info.lastUsed ? info.lastUsed.getTime() : 0;
      
      if (lastUsed < oldestUsage) {
        oldestUsage = lastUsed;
        bestContainer = containerId;
      }
    }
    
    return bestContainer || availableIds[0];
  }

  /**
   * Check if container should be recycled
   */
  async shouldRecycleContainer(containerInfo) {
    // Check age
    const age = Date.now() - containerInfo.createdAt.getTime();
    if (age > this.config.health.maxContainerAge) {
      logger.debug(`Container ${containerInfo.id.substring(0, 12)} needs recycling: too old`);
      return true;
    }
    
    // Check job count
    if (containerInfo.jobCount > 100) {
      logger.debug(`Container ${containerInfo.id.substring(0, 12)} needs recycling: high job count`);
      return true;
    }
    
    // Check health failures
    if (containerInfo.healthCheckFailures > this.config.health.unhealthyThreshold) {
      logger.debug(`Container ${containerInfo.id.substring(0, 12)} needs recycling: unhealthy`);
      return true;
    }
    
    return false;
  }

  /**
   * Cleanup container for reuse
   */
  async cleanupContainer(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Run cleanup commands
      const cleanupCommands = [
        'rm -rf /workspace/* /tmp/* 2>/dev/null || true',
        'pkill -f ".*" 2>/dev/null || true',
        'cd /workspace'
      ];
      
      for (const command of cleanupCommands) {
        try {
          const exec = await container.exec({
            Cmd: ['sh', '-c', command],
            AttachStdout: false,
            AttachStderr: false
          });
          
          await exec.start({ Detach: true });
        } catch (error) {
          logger.debug(`Cleanup command failed (non-fatal): ${error.message}`);
        }
      }
      
    } catch (error) {
      logger.warn(`Container cleanup failed:`, error);
      throw error;
    }
  }

  /**
   * Recycle container (remove and replace)
   */
  async recycleContainer(containerId) {
    try {
      const containerInfo = this.containers.get(containerId);
      const templateName = containerInfo ? containerInfo.template : 'default-runner';
      
      // Remove old container
      await this.removeContainer(containerId);
      
      // Create replacement if pool is below minimum
      if (this.getPoolSize() < this.config.pool.minSize) {
        await this.createPoolContainer(templateName);
      }
      
      logger.debug(`Recycled container: ${containerId.substring(0, 12)}`);
      
    } catch (error) {
      logger.error(`Failed to recycle container:`, error);
    }
  }

  /**
   * Remove container from pool
   */
  async removeContainer(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Remove from all sets
      this.availableContainers.delete(containerId);
      this.busyContainers.delete(containerId);
      this.warmingContainers.delete(containerId);
      
      // Stop and remove container
      try {
        await container.stop({ t: 10 });
      } catch (error) {
        // Container might already be stopped
      }
      
      try {
        await container.remove({ force: true });
      } catch (error) {
        // Container might already be removed
      }
      
      // Remove from tracking
      this.containers.delete(containerId);
      this.stats.totalDestroyed++;
      
      this.updatePoolUtilization();
      
      logger.debug(`Removed container: ${containerId.substring(0, 12)}`);
      
      this.emit('containerRemoved', {
        containerId,
        poolSize: this.getPoolSize()
      });
      
    } catch (error) {
      logger.error(`Failed to remove container:`, error);
    }
  }

  /**
   * Start warmup containers
   */
  async startWarmupContainers() {
    const warmupCount = Math.min(
      this.config.pool.warmupContainers,
      this.config.pool.maxSize - this.getPoolSize()
    );
    
    if (warmupCount <= 0) {
      return;
    }
    
    logger.info(`Starting ${warmupCount} warmup containers`);
    
    const warmupPromises = [];
    for (let i = 0; i < warmupCount; i++) {
      warmupPromises.push(this.createWarmupContainer());
    }
    
    await Promise.allSettled(warmupPromises);
  }

  /**
   * Create warmup container
   */
  async createWarmupContainer() {
    try {
      const containerId = await this.createPoolContainer('default-runner');
      this.warmingContainers.add(containerId);
      
      // Move to available after short delay
      setTimeout(() => {
        if (this.warmingContainers.has(containerId)) {
          this.warmingContainers.delete(containerId);
          if (this.availableContainers.has(containerId)) {
            logger.debug(`Warmup container ready: ${containerId.substring(0, 12)}`);
          }
        }
      }, 5000);
      
    } catch (error) {
      logger.error('Failed to create warmup container:', error);
    }
  }

  /**
   * Parse memory limit
   */
  parseMemoryLimit(memoryString) {
    const match = memoryString.match(/^(\d+(?:\.\d+)?)(k|m|g)?$/i);
    if (!match) {
      throw new Error(`Invalid memory format: ${memoryString}`);
    }
    
    const value = parseFloat(match[1]);
    const unit = (match[2] || '').toLowerCase();
    
    switch (unit) {
      case 'k':
        return Math.round(value * 1024);
      case 'm':
        return Math.round(value * 1024 * 1024);
      case 'g':
        return Math.round(value * 1024 * 1024 * 1024);
      default:
        return Math.round(value);
    }
  }

  /**
   * Parse CPU limit
   */
  parseCpuLimit(cpuString) {
    const cpus = parseFloat(cpuString);
    return Math.round(cpus * 1000000000); // Convert to nanocpus
  }

  /**
   * Update pool utilization metrics
   */
  updatePoolUtilization() {
    const totalContainers = this.getPoolSize();
    const busyCount = this.busyContainers.size;
    
    this.stats.poolUtilization = totalContainers > 0 ? 
      (busyCount / totalContainers) * 100 : 0;
  }

  /**
   * Update job duration statistics
   */
  updateJobDurationStats(duration) {
    const currentAvg = this.stats.avgJobDuration;
    const jobCount = this.stats.totalJobsProcessed;
    
    // Calculate running average
    this.stats.avgJobDuration = jobCount > 1 ?
      ((currentAvg * (jobCount - 1)) + duration) / jobCount :
      duration;
  }

  /**
   * Get pool size
   */
  getPoolSize() {
    return this.containers.size;
  }

  /**
   * Get pool status
   */
  getPoolStatus() {
    return {
      isInitialized: this.isInitialized,
      isStarted: this.isStarted,
      poolSize: this.getPoolSize(),
      availableContainers: this.availableContainers.size,
      busyContainers: this.busyContainers.size,
      warmingContainers: this.warmingContainers.size,
      stats: this.stats,
      config: {
        minSize: this.config.pool.minSize,
        maxSize: this.config.pool.maxSize,
        targetSize: this.config.pool.targetSize
      },
      scaling: {
        lastScaleUp: this.lastScaleUp,
        lastScaleDown: this.lastScaleDown,
        scalingInProgress: this.scalingInProgress
      }
    };
  }

  /**
   * Get detailed container information
   */
  getContainerDetails() {
    const details = [];
    
    for (const [containerId, info] of this.containers) {
      details.push({
        id: containerId.substring(0, 12),
        template: info.template,
        status: info.status,
        createdAt: info.createdAt,
        lastUsed: info.lastUsed,
        jobCount: info.jobCount,
        isHealthy: info.isHealthy,
        healthCheckFailures: info.healthCheckFailures,
        age: Date.now() - info.createdAt.getTime(),
        resourceUsage: info.resourceUsage
      });
    }
    
    return details.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Placeholder methods for scaling, health monitoring, and resource monitoring
   * These will be implemented in subsequent components
   */
  
  async scaleUp(count = 1) {
    // Will be implemented in dynamic scaling component
    logger.debug(`Scale up requested: ${count} containers`);
  }
  
  async scaleDown(count = 1) {
    // Will be implemented in dynamic scaling component
    logger.debug(`Scale down requested: ${count} containers`);
  }
  
  startHealthMonitoring() {
    // Will be implemented in health monitoring component
    logger.debug('Health monitoring started');
  }
  
  startResourceMonitoring() {
    // Will be implemented in resource monitoring component
    logger.debug('Resource monitoring started');
  }
  
  startScalingEngine() {
    // Will be implemented in dynamic scaling component
    logger.debug('Scaling engine started');
  }

  /**
   * Shutdown container pool manager
   */
  async shutdown() {
    logger.info('Shutting down Container Pool Manager');
    
    this.isStarted = false;
    
    // Clear timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    if (this.resourceMonitorTimer) {
      clearInterval(this.resourceMonitorTimer);
    }
    if (this.scalingTimer) {
      clearInterval(this.scalingTimer);
    }
    
    // Remove all containers
    const removePromises = [];
    for (const containerId of this.containers.keys()) {
      removePromises.push(this.removeContainer(containerId));
    }
    
    await Promise.allSettled(removePromises);
    
    this.emit('shutdown');
    logger.info('Container Pool Manager shutdown completed');
  }
}

module.exports = ContainerPoolManager;