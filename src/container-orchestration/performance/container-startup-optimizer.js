/**
 * Container Startup Optimizer
 * Advanced optimization strategies for reducing container creation and startup times
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class ContainerStartupOptimizer extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.config = {
      // Pre-warming configuration
      enablePreWarming: options.enablePreWarming !== false,
      preWarmPoolSize: options.preWarmPoolSize || 3,
      preWarmImage: options.preWarmImage || 'github-actions-runner:latest',
      
      // Image optimization
      enableImageCaching: options.enableImageCaching !== false,
      enableLayerCaching: options.enableLayerCaching !== false,
      imagePrePull: options.imagePrePull !== false,
      
      // Container template optimization
      enableTemplateOptimization: options.enableTemplateOptimization !== false,
      templateCache: new Map(),
      
      // Network optimization
      enableNetworkReuse: options.enableNetworkReuse !== false,
      networkWarmupEnabled: options.networkWarmupEnabled !== false,
      
      // Resource optimization
      enableResourcePreAllocation: options.enableResourcePreAllocation !== false,
      cpuPinning: options.cpuPinning || false,
      memoryPreAllocation: options.memoryPreAllocation || false,
      
      // Startup sequence optimization
      parallelInitialization: options.parallelInitialization !== false,
      fastStartupMode: options.fastStartupMode !== false,
      
      // Performance monitoring
      trackStartupMetrics: options.trackStartupMetrics !== false,
      startupMetrics: new Map(),
      
      ...options
    };
    
    this.preWarmedContainers = new Map();
    this.imageCache = new Map();
    this.networkPool = new Map();
    this.templateCache = new Map();
    this.performanceMetrics = {
      totalStartups: 0,
      averageStartupTime: 0,
      fastestStartup: Infinity,
      slowestStartup: 0,
      optimizationSavings: 0
    };
    
    this.isInitialized = false;
    this.warmupTimer = null;
  }

  /**
   * Initialize the startup optimizer
   */
  async initialize() {
    try {
      logger.info('Initializing Container Startup Optimizer');
      
      if (this.config.enablePreWarming) {
        await this.initializePreWarmPool();
      }
      
      if (this.config.enableImageCaching) {
        await this.initializeImageCache();
      }
      
      if (this.config.enableNetworkReuse) {
        await this.initializeNetworkPool();
      }
      
      if (this.config.enableTemplateOptimization) {
        await this.initializeContainerTemplates();
      }
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Container Startup Optimizer initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Container Startup Optimizer:', error);
      throw error;
    }
  }

  /**
   * Initialize pre-warmed container pool
   */
  async initializePreWarmPool() {
    logger.info('Initializing pre-warmed container pool');
    
    const warmupPromises = [];
    for (let i = 0; i < this.config.preWarmPoolSize; i++) {
      const warmupId = `prewarm-${Date.now()}-${i}`;
      warmupPromises.push(this.createPreWarmedContainer(warmupId));
    }
    
    const results = await Promise.allSettled(warmupPromises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    logger.info(`Pre-warmed container pool initialized: ${successful}/${this.config.preWarmPoolSize} containers`);
    
    // Start continuous warmup maintenance
    this.startWarmupMaintenance();
  }

  /**
   * Create a pre-warmed container
   */
  async createPreWarmedContainer(warmupId) {
    try {
      const startTime = Date.now();
      
      // Create container with optimized configuration
      const containerConfig = this.getOptimizedContainerConfig(warmupId, {
        preWarmed: true,
        fastStartup: true
      });
      
      const container = await this.dockerAPI.docker.createContainer(containerConfig);
      
      // Start container
      await container.start();
      
      // Store in pre-warmed pool
      this.preWarmedContainers.set(warmupId, {
        container,
        containerId: container.id,
        createdAt: new Date(),
        warmupTime: Date.now() - startTime,
        isPreWarmed: true,
        inUse: false
      });
      
      logger.debug(`Pre-warmed container created: ${warmupId} (${Date.now() - startTime}ms)`);
      this.emit('preWarmedContainerCreated', { warmupId, warmupTime: Date.now() - startTime });
      
      return container;
    } catch (error) {
      logger.error(`Failed to create pre-warmed container ${warmupId}:`, error);
      throw error;
    }
  }

  /**
   * Get optimized container configuration
   */
  getOptimizedContainerConfig(containerId, options = {}) {
    const cacheKey = `${options.image || this.config.preWarmImage}-${JSON.stringify(options)}`;
    
    // Check template cache
    if (this.config.enableTemplateOptimization && this.templateCache.has(cacheKey)) {
      const template = this.templateCache.get(cacheKey);
      return {
        ...template,
        name: `github-runner-${containerId}`,
        Labels: {
          ...template.Labels,
          'job-id': containerId,
          'created-at': new Date().toISOString()
        }
      };
    }
    
    const baseConfig = {
      Image: options.image || this.config.preWarmImage,
      name: `github-runner-${containerId}`,
      Env: [
        `CONTAINER_ID=${containerId}`,
        `STARTUP_MODE=${options.fastStartup ? 'fast' : 'normal'}`,
        'DEBIAN_FRONTEND=noninteractive',
        'RUNNER_ALLOW_RUNASROOT=1',
        ...options.env || []
      ],
      HostConfig: {
        Memory: options.memory || this.dockerAPI.config.resourceLimits.memory,
        CpuQuota: options.cpuQuota || Math.floor(parseFloat(this.dockerAPI.config.resourceLimits.cpus) * 100000),
        CpuPeriod: 100000,
        NetworkMode: options.networkMode || this.dockerAPI.config.networkName,
        AutoRemove: false,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID'],
        ReadonlyRootfs: false,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=100m',
          '/var/tmp': 'rw,noexec,nosuid,size=50m'
        },
        // Optimization-specific settings
        CpusetCpus: this.config.cpuPinning ? this.getCpuSet() : undefined,
        OomKillDisable: false,
        PidsLimit: 1024
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [this.dockerAPI.config.networkName]: {
            Aliases: [`github-runner-${containerId}`]
          }
        }
      },
      Labels: {
        'github-runner': 'true',
        'job-id': containerId,
        'managed-by': 'github-runnerhub-optimizer',
        'optimization-level': options.fastStartup ? 'high' : 'standard',
        'pre-warmed': options.preWarmed ? 'true' : 'false',
        'created-at': new Date().toISOString()
      },
      WorkingDir: '/github/workspace',
      // Optimizations
      AttachStdout: false,
      AttachStderr: false,
      AttachStdin: false,
      Tty: false,
      OpenStdin: false,
      StdinOnce: false
    };

    // Cache the template for reuse
    if (this.config.enableTemplateOptimization) {
      this.templateCache.set(cacheKey, JSON.parse(JSON.stringify(baseConfig)));
    }

    return baseConfig;
  }

  /**
   * Get optimized CPU set for CPU pinning
   */
  getCpuSet() {
    // Simple CPU pinning strategy - can be enhanced based on system topology
    const availableCpus = require('os').cpus().length;
    const cpusPerContainer = Math.max(1, Math.floor(availableCpus / 4)); // Use 1/4 of available CPUs
    return `0-${cpusPerContainer - 1}`;
  }

  /**
   * Initialize image cache and pre-pull strategies
   */
  async initializeImageCache() {
    logger.info('Initializing image cache');
    
    try {
      // Pre-pull common base images
      const imagesToPrePull = [
        this.config.preWarmImage,
        'node:18-alpine',
        'python:3.11-slim',
        'ubuntu:22.04'
      ];
      
      for (const image of imagesToPrePull) {
        try {
          await this.prePullImage(image);
          this.imageCache.set(image, {
            pulledAt: new Date(),
            available: true
          });
        } catch (error) {
          logger.warn(`Failed to pre-pull image ${image}:`, error.message);
        }
      }
      
      logger.info(`Image cache initialized with ${this.imageCache.size} images`);
    } catch (error) {
      logger.error('Failed to initialize image cache:', error);
    }
  }

  /**
   * Pre-pull Docker image
   */
  async prePullImage(imageName) {
    return new Promise((resolve, reject) => {
      this.dockerAPI.docker.pull(imageName, (err, stream) => {
        if (err) return reject(err);
        
        this.dockerAPI.docker.modem.followProgress(stream, (err, res) => {
          if (err) return reject(err);
          logger.debug(`Image ${imageName} pre-pulled successfully`);
          resolve(res);
        });
      });
    });
  }

  /**
   * Initialize network pool for reuse
   */
  async initializeNetworkPool() {
    logger.info('Initializing network pool');
    
    try {
      // Ensure main network exists and is optimized
      const networks = await this.dockerAPI.docker.listNetworks();
      const existingNetwork = networks.find(net => net.Name === this.dockerAPI.config.networkName);
      
      if (existingNetwork) {
        this.networkPool.set(this.dockerAPI.config.networkName, {
          networkId: existingNetwork.Id,
          optimized: true,
          createdAt: new Date()
        });
      }
      
      logger.info('Network pool initialized');
    } catch (error) {
      logger.error('Failed to initialize network pool:', error);
    }
  }

  /**
   * Initialize container templates for faster creation
   */
  async initializeContainerTemplates() {
    logger.info('Initializing container templates');
    
    // Pre-generate common templates
    const commonConfigurations = [
      { type: 'default', fastStartup: false },
      { type: 'fast', fastStartup: true },
      { type: 'prewarmed', preWarmed: true, fastStartup: true }
    ];
    
    for (const config of commonConfigurations) {
      const template = this.getOptimizedContainerConfig('template', config);
      const templateKey = `template-${config.type}`;
      this.templateCache.set(templateKey, template);
    }
    
    logger.info(`Container templates initialized: ${this.templateCache.size} templates`);
  }

  /**
   * Optimized container creation using pre-warmed containers
   */
  async createOptimizedContainer(jobId, jobConfig = {}) {
    const startTime = Date.now();
    
    try {
      // Try to use pre-warmed container first
      if (this.config.enablePreWarming && this.preWarmedContainers.size > 0) {
        const preWarmedContainer = this.getAvailablePreWarmedContainer();
        if (preWarmedContainer) {
          const container = await this.configurePreWarmedContainer(preWarmedContainer, jobId, jobConfig);
          this.recordStartupMetrics(jobId, startTime, 'pre-warmed');
          return container;
        }
      }
      
      // Fall back to optimized creation
      const container = await this.createOptimizedContainerFromScratch(jobId, jobConfig);
      this.recordStartupMetrics(jobId, startTime, 'optimized');
      return container;
      
    } catch (error) {
      logger.error(`Failed to create optimized container for job ${jobId}:`, error);
      this.recordStartupMetrics(jobId, startTime, 'failed');
      throw error;
    }
  }

  /**
   * Get available pre-warmed container
   */
  getAvailablePreWarmedContainer() {
    for (const [warmupId, containerInfo] of this.preWarmedContainers.entries()) {
      if (!containerInfo.inUse) {
        containerInfo.inUse = true;
        return { warmupId, ...containerInfo };
      }
    }
    return null;
  }

  /**
   * Configure pre-warmed container for specific job
   */
  async configurePreWarmedContainer(preWarmedContainer, jobId, jobConfig) {
    try {
      const { container, warmupId } = preWarmedContainer;
      
      // Update container labels and environment
      const execConfig = {
        Cmd: ['/bin/bash', '-c', [
          `export JOB_ID=${jobId}`,
          `export GITHUB_RUN_ID=${jobConfig.runId || ''}`,
          `export GITHUB_REPOSITORY=${jobConfig.repository || ''}`,
          'echo "Container configured for job execution"'
        ].join(' && ')],
        AttachStdout: false,
        AttachStderr: false
      };
      
      const exec = await container.exec(execConfig);
      await exec.start({ hijack: false });
      
      // Remove from pre-warmed pool and track as active
      this.preWarmedContainers.delete(warmupId);
      
      // Schedule replacement
      setImmediate(() => {
        this.createPreWarmedContainer(`prewarm-${Date.now()}-replacement`)
          .catch(err => logger.warn('Failed to create replacement pre-warmed container:', err));
      });
      
      logger.debug(`Pre-warmed container ${warmupId} configured for job ${jobId}`);
      this.emit('preWarmedContainerUsed', { warmupId, jobId });
      
      return container;
    } catch (error) {
      logger.error(`Failed to configure pre-warmed container for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Create optimized container from scratch
   */
  async createOptimizedContainerFromScratch(jobId, jobConfig) {
    const containerConfig = this.getOptimizedContainerConfig(jobId, {
      ...jobConfig,
      fastStartup: this.config.fastStartupMode
    });
    
    // Parallel initialization if enabled
    if (this.config.parallelInitialization) {
      return await this.createContainerWithParallelInit(containerConfig);
    } else {
      return await this.dockerAPI.docker.createContainer(containerConfig);
    }
  }

  /**
   * Create container with parallel initialization
   */
  async createContainerWithParallelInit(containerConfig) {
    const [container] = await Promise.all([
      this.dockerAPI.docker.createContainer(containerConfig),
      this.preWarmNetworkAndVolumes(containerConfig)
    ]);
    
    return container;
  }

  /**
   * Pre-warm network and volumes
   */
  async preWarmNetworkAndVolumes(containerConfig) {
    const promises = [];
    
    // Pre-warm network connections
    if (this.config.networkWarmupEnabled) {
      promises.push(this.warmupNetworkConnections());
    }
    
    // Pre-allocate volumes if needed
    if (containerConfig.HostConfig?.Binds) {
      promises.push(this.preAllocateVolumes(containerConfig.HostConfig.Binds));
    }
    
    return Promise.allSettled(promises);
  }

  /**
   * Warm up network connections
   */
  async warmupNetworkConnections() {
    // Perform DNS lookups and network warmup
    // This is a placeholder for more advanced network optimization
    return Promise.resolve();
  }

  /**
   * Pre-allocate volumes
   */
  async preAllocateVolumes(_binds) {
    // Pre-allocate volume space if needed
    // This is a placeholder for volume optimization
    return Promise.resolve();
  }

  /**
   * Start warmup maintenance
   */
  startWarmupMaintenance() {
    if (this.warmupTimer) {
      clearInterval(this.warmupTimer);
    }
    
    this.warmupTimer = setInterval(() => {
      this.maintainPreWarmPool().catch(err => 
        logger.error('Pre-warm pool maintenance failed:', err)
      );
    }, 60000); // Check every minute
  }

  /**
   * Maintain pre-warmed container pool
   */
  async maintainPreWarmPool() {
    const availableContainers = Array.from(this.preWarmedContainers.values())
      .filter(c => !c.inUse).length;
    
    if (availableContainers < this.config.preWarmPoolSize) {
      const containersNeeded = this.config.preWarmPoolSize - availableContainers;
      
      logger.debug(`Maintaining pre-warm pool: creating ${containersNeeded} containers`);
      
      const promises = [];
      for (let i = 0; i < containersNeeded; i++) {
        const warmupId = `prewarm-${Date.now()}-maintenance-${i}`;
        promises.push(
          this.createPreWarmedContainer(warmupId).catch(err => 
            logger.warn(`Failed to create maintenance pre-warmed container ${warmupId}:`, err)
          )
        );
      }
      
      await Promise.allSettled(promises);
    }
    
    // Clean up old pre-warmed containers
    await this.cleanupOldPreWarmedContainers();
  }

  /**
   * Clean up old pre-warmed containers
   */
  async cleanupOldPreWarmedContainers() {
    const maxAge = 3600000; // 1 hour
    const now = Date.now();
    
    for (const [warmupId, containerInfo] of this.preWarmedContainers.entries()) {
      if (!containerInfo.inUse && now - containerInfo.createdAt.getTime() > maxAge) {
        try {
          await containerInfo.container.remove({ force: true });
          this.preWarmedContainers.delete(warmupId);
          logger.debug(`Cleaned up old pre-warmed container: ${warmupId}`);
        } catch (error) {
          logger.warn(`Failed to cleanup old pre-warmed container ${warmupId}:`, error);
        }
      }
    }
  }

  /**
   * Record startup metrics
   */
  recordStartupMetrics(jobId, startTime, type) {
    if (!this.config.trackStartupMetrics) return;
    
    const duration = Date.now() - startTime;
    
    this.performanceMetrics.totalStartups++;
    this.performanceMetrics.averageStartupTime = 
      (this.performanceMetrics.averageStartupTime * (this.performanceMetrics.totalStartups - 1) + duration) / 
      this.performanceMetrics.totalStartups;
    
    if (duration < this.performanceMetrics.fastestStartup) {
      this.performanceMetrics.fastestStartup = duration;
    }
    
    if (duration > this.performanceMetrics.slowestStartup) {
      this.performanceMetrics.slowestStartup = duration;
    }
    
    // Calculate optimization savings
    if (type === 'pre-warmed') {
      const estimatedNormalTime = this.performanceMetrics.averageStartupTime * 1.5; // Estimate
      this.performanceMetrics.optimizationSavings += Math.max(0, estimatedNormalTime - duration);
    }
    
    this.config.startupMetrics.set(jobId, {
      duration,
      type,
      timestamp: new Date()
    });
    
    logger.debug(`Startup metrics recorded for ${jobId}: ${duration}ms (${type})`);
    this.emit('startupMetricsRecorded', { jobId, duration, type });
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return {
      ...this.performanceMetrics,
      preWarmedContainers: {
        total: this.preWarmedContainers.size,
        available: Array.from(this.preWarmedContainers.values()).filter(c => !c.inUse).length,
        inUse: Array.from(this.preWarmedContainers.values()).filter(c => c.inUse).length
      },
      cacheStats: {
        imageCache: this.imageCache.size,
        templateCache: this.templateCache.size,
        networkPool: this.networkPool.size
      },
      recentStartups: Array.from(this.config.startupMetrics.entries())
        .slice(-10)
        .map(([jobId, metrics]) => ({ jobId, ...metrics }))
    };
  }

  /**
   * Stop the optimizer
   */
  async stop() {
    logger.info('Stopping Container Startup Optimizer');
    
    if (this.warmupTimer) {
      clearInterval(this.warmupTimer);
      this.warmupTimer = null;
    }
    
    // Clean up pre-warmed containers
    const cleanupPromises = Array.from(this.preWarmedContainers.values()).map(
      containerInfo => containerInfo.container.remove({ force: true }).catch(err => 
        logger.warn('Failed to cleanup pre-warmed container:', err)
      )
    );
    
    await Promise.allSettled(cleanupPromises);
    this.preWarmedContainers.clear();
    
    this.emit('stopped');
    logger.info('Container Startup Optimizer stopped');
  }

  /**
   * Get optimization recommendations
   */
  getOptimizationRecommendations() {
    const stats = this.getPerformanceStats();
    const recommendations = [];
    
    // Analyze performance patterns
    if (stats.averageStartupTime > 5000) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: 'High average startup time detected. Consider increasing pre-warm pool size.',
        action: 'increase_prewarm_pool'
      });
    }
    
    if (stats.preWarmedContainers.available === 0) {
      recommendations.push({
        type: 'capacity',
        priority: 'medium',
        message: 'No pre-warmed containers available. Increase pool size or reduce usage.',
        action: 'scale_prewarm_pool'
      });
    }
    
    if (stats.totalStartups > 100 && stats.optimizationSavings / stats.totalStartups < 1000) {
      recommendations.push({
        type: 'efficiency',
        priority: 'low',
        message: 'Low optimization savings. Review startup optimization settings.',
        action: 'tune_optimization'
      });
    }
    
    return recommendations;
  }
}

module.exports = ContainerStartupOptimizer;