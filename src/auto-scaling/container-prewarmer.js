/**
 * Container Pre-warming Manager
 * Pre-creates and maintains pools of ready-to-use containers for faster scaling
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class ContainerPrewarmer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Pool configuration
      poolSize: options.poolSize || 5,
      minPoolSize: options.minPoolSize || 2,
      maxPoolSize: options.maxPoolSize || 20,
      
      // Container templates
      templates: options.templates || [
        {
          name: 'ubuntu-latest',
          image: 'ghcr.io/actions/runner:latest',
          labels: ['self-hosted', 'linux', 'x64'],
          resources: { cpu: 2, memory: 4096 }
        },
        {
          name: 'ubuntu-22.04',
          image: 'ghcr.io/actions/runner:2.311.0-ubuntu-22.04',
          labels: ['self-hosted', 'linux', 'x64', 'ubuntu-22.04'],
          resources: { cpu: 2, memory: 4096 }
        },
        {
          name: 'node',
          image: 'ghcr.io/actions/runner:latest',
          labels: ['self-hosted', 'linux', 'x64', 'node'],
          resources: { cpu: 2, memory: 4096 },
          customization: {
            packages: ['nodejs', 'npm'],
            env: { NODE_ENV: 'production' }
          }
        }
      ],
      
      // Timing configuration
      refreshInterval: options.refreshInterval || 900000, // 15 minutes
      containerMaxAge: options.containerMaxAge || 3600000, // 1 hour
      warmupTimeout: options.warmupTimeout || 300000, // 5 minutes
      healthCheckInterval: options.healthCheckInterval || 60000, // 1 minute
      
      // Optimization settings
      predictiveWarming: options.predictiveWarming !== false,
      adaptivePoolSize: options.adaptivePoolSize !== false,
      aggressivePrewarming: options.aggressivePrewarming || false,
      recycleContainers: options.recycleContainers !== false,
      
      // Resource limits
      maxConcurrentWarmups: options.maxConcurrentWarmups || 5,
      maxMemoryUsage: options.maxMemoryUsage || 16384, // 16GB
      maxCpuUsage: options.maxCpuUsage || 8, // 8 cores
      
      // Caching configuration
      caching: {
        enabled: options.cachingEnabled !== false,
        layerCache: options.layerCache !== false,
        buildCache: options.buildCache !== false,
        packageCache: options.packageCache !== false,
        cacheDir: options.cacheDir || '/var/cache/runnerhub'
      },
      
      // Integration points
      dockerAPI: options.dockerAPI || null,
      predictor: options.predictor || null,
      monitoringSystem: options.monitoringSystem || null,
      
      ...options
    };
    
    // Pre-warmed container pools
    this.pools = new Map(); // template -> Set of container IDs
    this.containers = new Map(); // containerId -> containerInfo
    
    // Pool state
    this.poolState = {
      totalContainers: 0,
      availableContainers: 0,
      claimedContainers: 0,
      warmingContainers: 0,
      failedContainers: 0,
      lastRefresh: null,
      lastClaim: null
    };
    
    // Warming queue
    this.warmingQueue = [];
    this.warmingInProgress = new Set();
    
    // Performance metrics
    this.metrics = {
      containersWarmed: 0,
      containersClailed: 0,
      containersFailed: 0,
      containersRecycled: 0,
      avgWarmupTime: 0,
      avgClaimTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      warmupTimesByTemplate: new Map()
    };
    
    // Resource tracking
    this.resourceUsage = {
      cpu: 0,
      memory: 0,
      disk: 0,
      network: 0
    };
    
    // Statistics
    this.stats = {
      startTime: null,
      totalWarmups: 0,
      successfulWarmups: 0,
      failedWarmups: 0,
      totalClaims: 0,
      hitRate: 0,
      avgContainerAge: 0,
      templateDistribution: new Map()
    };
    
    this.refreshTimer = null;
    this.healthCheckTimer = null;
    this.isStarted = false;
  }

  /**
   * Start container pre-warmer
   */
  async start() {
    if (this.isStarted) {
      logger.warn('Container Prewarmer already started');
      return;
    }
    
    logger.info('Starting Container Prewarmer');
    this.stats.startTime = Date.now();
    
    // Initialize pools
    this.initializePools();
    
    // Start initial warming
    await this.warmInitialContainers();
    
    // Start refresh timer
    this.refreshTimer = setInterval(() => {
      this.refreshPools().catch(error => {
        logger.error('Pool refresh failed:', error);
      });
    }, this.config.refreshInterval);
    
    // Start health check timer
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck().catch(error => {
        logger.error('Health check failed:', error);
      });
    }, this.config.healthCheckInterval);
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Container Prewarmer started successfully');
  }

  /**
   * Initialize container pools
   */
  initializePools() {
    for (const template of this.config.templates) {
      this.pools.set(template.name, new Set());
      this.metrics.warmupTimesByTemplate.set(template.name, []);
      this.stats.templateDistribution.set(template.name, 0);
    }
  }

  /**
   * Warm initial containers
   */
  async warmInitialContainers() {
    logger.info('Warming initial container pools');
    
    const warmupPromises = [];
    
    for (const template of this.config.templates) {
      const count = Math.ceil(this.config.poolSize / this.config.templates.length);
      
      for (let i = 0; i < count; i++) {
        warmupPromises.push(this.warmContainer(template));
      }
    }
    
    // Warm containers with concurrency limit
    await this.executeWithConcurrency(warmupPromises, this.config.maxConcurrentWarmups);
    
    logger.info(`Initial warming complete: ${this.poolState.availableContainers} containers ready`);
  }

  /**
   * Warm a single container
   */
  async warmContainer(template) {
    const containerId = `prewarm-${template.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    try {
      logger.debug(`Starting warmup for container ${containerId}`);
      this.warmingInProgress.add(containerId);
      this.poolState.warmingContainers++;
      
      // Check resource availability
      if (!this.hasResourcesAvailable(template.resources)) {
        throw new Error('Insufficient resources for container warmup');
      }
      
      // Create container
      const container = await this.createContainer(containerId, template);
      
      // Perform warmup steps
      await this.performWarmupSteps(container, template);
      
      // Verify container health
      await this.verifyContainerHealth(container);
      
      // Add to pool
      this.pools.get(template.name).add(containerId);
      this.containers.set(containerId, {
        id: containerId,
        template: template.name,
        status: 'ready',
        createdAt: new Date(),
        lastHealthCheck: new Date(),
        claims: 0,
        resources: template.resources
      });
      
      // Update metrics
      const warmupTime = Date.now() - startTime;
      this.updateWarmupMetrics(template.name, warmupTime, true);
      
      this.poolState.availableContainers++;
      this.poolState.totalContainers++;
      this.stats.templateDistribution.set(
        template.name,
        this.stats.templateDistribution.get(template.name) + 1
      );
      
      logger.info(`Container ${containerId} warmed successfully in ${warmupTime}ms`);
      
      this.emit('containerWarmed', {
        containerId,
        template: template.name,
        warmupTime,
        timestamp: new Date()
      });
      
      return container;
      
    } catch (error) {
      logger.error(`Failed to warm container ${containerId}:`, error);
      
      this.updateWarmupMetrics(template.name, Date.now() - startTime, false);
      this.poolState.failedContainers++;
      
      // Cleanup failed container
      await this.cleanupContainer(containerId);
      
      throw error;
      
    } finally {
      this.warmingInProgress.delete(containerId);
      this.poolState.warmingContainers--;
    }
  }

  /**
   * Create container
   */
  async createContainer(containerId, template) {
    if (!this.config.dockerAPI) {
      throw new Error('Docker API not configured');
    }
    
    const containerConfig = {
      Image: template.image,
      name: containerId,
      Labels: {
        'runnerhub.prewarmed': 'true',
        'runnerhub.template': template.name,
        'runnerhub.created': new Date().toISOString()
      },
      Env: this.buildEnvironment(template),
      HostConfig: {
        CpuShares: template.resources.cpu * 1024,
        Memory: template.resources.memory * 1024 * 1024,
        MemorySwap: template.resources.memory * 1024 * 1024,
        NetworkMode: 'bridge',
        RestartPolicy: { Name: 'no' }
      }
    };
    
    // Apply customizations
    if (template.customization) {
      if (template.customization.env) {
        containerConfig.Env.push(
          ...Object.entries(template.customization.env).map(([k, v]) => `${k}=${v}`)
        );
      }
    }
    
    // Use cached image layers if available
    if (this.config.caching.layerCache) {
      containerConfig.HostConfig.CacheFrom = [template.image];
    }
    
    const container = await this.config.dockerAPI.createContainer(containerConfig);
    
    // Start container but don't run the runner yet
    await container.start();
    
    // Update resource usage
    this.resourceUsage.cpu += template.resources.cpu;
    this.resourceUsage.memory += template.resources.memory;
    
    return container;
  }

  /**
   * Build environment variables
   */
  buildEnvironment(template) {
    const env = [
      'RUNNER_ALLOW_RUNASROOT=1',
      'RUNNER_NAME=' + template.name,
      'RUNNER_LABELS=' + template.labels.join(','),
      'RUNNER_GROUP=default',
      'RUNNER_WORK_DIRECTORY=/tmp/runner-work',
      'RUNNERHUB_PREWARMED=true'
    ];
    
    return env;
  }

  /**
   * Perform warmup steps
   */
  async performWarmupSteps(container, template) {
    const steps = [
      // Step 1: Install packages if needed
      async () => {
        if (template.customization?.packages) {
          await this.installPackages(container, template.customization.packages);
        }
      },
      
      // Step 2: Pre-download common dependencies
      async () => {
        if (this.config.caching.packageCache) {
          await this.predownloadDependencies(container, template);
        }
      },
      
      // Step 3: Configure runner
      async () => {
        await this.configureRunner(container, template);
      },
      
      // Step 4: Warm up runtime
      async () => {
        await this.warmupRuntime(container, template);
      },
      
      // Step 5: Create cache directories
      async () => {
        if (this.config.caching.enabled) {
          await this.setupCacheDirectories(container);
        }
      }
    ];
    
    for (const [index, step] of steps.entries()) {
      try {
        logger.debug(`Executing warmup step ${index + 1}/${steps.length}`);
        await step();
      } catch (error) {
        logger.error(`Warmup step ${index + 1} failed:`, error);
        throw error;
      }
    }
  }

  /**
   * Install packages in container
   */
  async installPackages(container, packages) {
    const commands = [
      'apt-get update',
      `apt-get install -y ${packages.join(' ')}`,
      'apt-get clean',
      'rm -rf /var/lib/apt/lists/*'
    ];
    
    for (const cmd of commands) {
      const exec = await container.exec({
        Cmd: ['bash', '-c', cmd],
        AttachStdout: true,
        AttachStderr: true
      });
      
      await exec.start();
    }
  }

  /**
   * Pre-download common dependencies
   */
  async predownloadDependencies(container, template) {
    // This would be customized based on template type
    if (template.name.includes('node')) {
      await container.exec({
        Cmd: ['bash', '-c', 'npm install -g npm@latest yarn'],
        AttachStdout: true,
        AttachStderr: true
      }).then(exec => exec.start());
    }
    
    // Pre-pull common Docker images if needed
    // Pre-download common tools
    // etc.
  }

  /**
   * Configure runner
   */
  async configureRunner(container, template) {
    // Pre-configure the runner without registering it
    // This saves time when the container is claimed
    
    const configCmd = [
      'bash', '-c',
      `cd /actions-runner && ./config.sh --unattended --url https://github.com/ORG --labels ${template.labels.join(',')} --ephemeral || true`
    ];
    
    const exec = await container.exec({
      Cmd: configCmd,
      AttachStdout: true,
      AttachStderr: true
    });
    
    await exec.start();
  }

  /**
   * Warm up runtime
   */
  async warmupRuntime(container, template) {
    // Execute runtime-specific warmup
    const warmupCommands = {
      'node': 'node -e "console.log(process.version)"',
      'python': 'python3 -c "import sys; print(sys.version)"',
      'default': 'echo "Warmup complete"'
    };
    
    const runtimeType = this.detectRuntimeType(template);
    const cmd = warmupCommands[runtimeType] || warmupCommands.default;
    
    const exec = await container.exec({
      Cmd: ['bash', '-c', cmd],
      AttachStdout: true,
      AttachStderr: true
    });
    
    await exec.start();
  }

  /**
   * Detect runtime type from template
   */
  detectRuntimeType(template) {
    if (template.name.includes('node') || template.labels.includes('node')) {
      return 'node';
    }
    if (template.name.includes('python') || template.labels.includes('python')) {
      return 'python';
    }
    return 'default';
  }

  /**
   * Setup cache directories
   */
  async setupCacheDirectories(container) {
    const dirs = [
      '/var/cache/runner',
      '/var/cache/npm',
      '/var/cache/pip',
      '/var/cache/maven',
      '/var/cache/gradle'
    ];
    
    const cmd = dirs.map(dir => `mkdir -p ${dir}`).join(' && ');
    
    const exec = await container.exec({
      Cmd: ['bash', '-c', cmd],
      AttachStdout: true,
      AttachStderr: true
    });
    
    await exec.start();
  }

  /**
   * Verify container health
   */
  async verifyContainerHealth(container) {
    const checks = [
      // Check container is running
      async () => {
        const info = await container.inspect();
        if (info.State.Status !== 'running') {
          throw new Error('Container not running');
        }
      },
      
      // Check basic commands work
      async () => {
        const exec = await container.exec({
          Cmd: ['bash', '-c', 'echo "health check"'],
          AttachStdout: true,
          AttachStderr: true
        });
        await exec.start();
      },
      
      // Check runner is accessible
      async () => {
        const exec = await container.exec({
          Cmd: ['bash', '-c', 'test -f /actions-runner/run.sh'],
          AttachStdout: true,
          AttachStderr: true
        });
        await exec.start();
      }
    ];
    
    for (const check of checks) {
      await check();
    }
  }

  /**
   * Get available containers
   */
  async getAvailableContainers(count = null) {
    const available = [];
    
    for (const [_templateName, containerIds] of this.pools) {
      for (const containerId of containerIds) {
        const container = this.containers.get(containerId);
        if (container && container.status === 'ready') {
          available.push(container);
          
          if (count && available.length >= count) {
            return available;
          }
        }
      }
    }
    
    return available;
  }

  /**
   * Claim containers for use
   */
  async claimContainers(count, requirements = {}) {
    const startTime = Date.now();
    const claimed = [];
    
    try {
      // Get available containers matching requirements
      const available = await this.getMatchingContainers(count, requirements);
      
      if (available.length < count) {
        logger.warn(`Only ${available.length} containers available, requested ${count}`);
        
        // Trigger aggressive warming if enabled
        if (this.config.aggressivePrewarming) {
          this.triggerAggressiveWarming(count - available.length, requirements);
        }
      }
      
      // Claim containers
      for (const container of available.slice(0, count)) {
        await this.claimContainer(container);
        claimed.push(container);
      }
      
      // Update metrics
      const claimTime = Date.now() - startTime;
      this.metrics.avgClaimTime = 
        (this.metrics.avgClaimTime * this.metrics.containersClailed + claimTime) /
        (this.metrics.containersClailed + claimed.length);
      this.metrics.containersClailed += claimed.length;
      
      this.poolState.availableContainers -= claimed.length;
      this.poolState.claimedContainers += claimed.length;
      this.stats.totalClaims += claimed.length;
      
      // Calculate hit rate
      this.stats.hitRate = this.stats.totalClaims / 
        (this.stats.totalClaims + this.metrics.cacheMisses);
      
      logger.info(`Claimed ${claimed.length} containers in ${claimTime}ms`);
      
      this.emit('containersClaimed', {
        count: claimed.length,
        claimTime,
        timestamp: new Date()
      });
      
      // Trigger pool refresh if needed
      if (this.poolState.availableContainers < this.config.minPoolSize) {
        this.refreshPools();
      }
      
      return claimed;
      
    } catch (error) {
      logger.error('Failed to claim containers:', error);
      this.metrics.cacheMisses++;
      throw error;
    }
  }

  /**
   * Get containers matching requirements
   */
  async getMatchingContainers(count, requirements) {
    const matching = [];
    
    // Priority order for template matching
    const templatePriority = this.getTemplatePriority(requirements);
    
    for (const templateName of templatePriority) {
      const containerIds = this.pools.get(templateName) || new Set();
      
      for (const containerId of containerIds) {
        const container = this.containers.get(containerId);
        if (container && 
            container.status === 'ready' &&
            this.meetsRequirements(container, requirements)) {
          matching.push(container);
          
          if (matching.length >= count) {
            return matching;
          }
        }
      }
    }
    
    return matching;
  }

  /**
   * Get template priority based on requirements
   */
  getTemplatePriority(requirements) {
    const priority = [];
    
    // Exact match first
    if (requirements.template) {
      priority.push(requirements.template);
    }
    
    // Then by labels
    if (requirements.labels) {
      for (const template of this.config.templates) {
        const hasAllLabels = requirements.labels.every(label => 
          template.labels.includes(label)
        );
        if (hasAllLabels && !priority.includes(template.name)) {
          priority.push(template.name);
        }
      }
    }
    
    // Then all others
    for (const template of this.config.templates) {
      if (!priority.includes(template.name)) {
        priority.push(template.name);
      }
    }
    
    return priority;
  }

  /**
   * Check if container meets requirements
   */
  meetsRequirements(container, requirements) {
    // Check age
    const age = Date.now() - container.createdAt.getTime();
    if (age > this.config.containerMaxAge) {
      return false;
    }
    
    // Check resources
    if (requirements.cpu && container.resources.cpu < requirements.cpu) {
      return false;
    }
    if (requirements.memory && container.resources.memory < requirements.memory) {
      return false;
    }
    
    return true;
  }

  /**
   * Claim a single container
   */
  async claimContainer(container) {
    const containerId = container.id;
    
    // Remove from pool
    this.pools.get(container.template).delete(containerId);
    
    // Update container state
    container.status = 'claimed';
    container.claimedAt = new Date();
    container.claims++;
    
    // Final preparation
    await this.prepareContainerForUse(containerId);
    
    logger.debug(`Container ${containerId} claimed`);
  }

  /**
   * Prepare container for use
   */
  async prepareContainerForUse(_containerId) {
    // Any last-minute preparation
    // e.g., inject fresh tokens, update configuration, etc.
  }

  /**
   * Trigger aggressive warming
   */
  triggerAggressiveWarming(count, requirements) {
    logger.info(`Triggering aggressive warming for ${count} containers`);
    
    // Determine which templates to warm
    const templates = this.getTemplatePriority(requirements);
    
    for (let i = 0; i < count; i++) {
      const template = this.config.templates.find(t => 
        t.name === templates[i % templates.length]
      );
      
      if (template) {
        this.warmingQueue.push(template);
      }
    }
    
    // Process warming queue
    this.processWarmingQueue();
  }

  /**
   * Process warming queue
   */
  async processWarmingQueue() {
    if (this.warmingQueue.length === 0) return;
    
    const concurrent = Math.min(
      this.config.maxConcurrentWarmups - this.warmingInProgress.size,
      this.warmingQueue.length
    );
    
    if (concurrent <= 0) return;
    
    const toWarm = this.warmingQueue.splice(0, concurrent);
    const warmupPromises = toWarm.map(template => this.warmContainer(template));
    
    Promise.all(warmupPromises).then(() => {
      // Continue processing queue
      if (this.warmingQueue.length > 0) {
        this.processWarmingQueue();
      }
    });
  }

  /**
   * Refresh container pools
   */
  async refreshPools() {
    logger.debug('Refreshing container pools');
    const startTime = Date.now();
    
    try {
      // Remove expired containers
      await this.removeExpiredContainers();
      
      // Calculate target pool sizes
      const targetSizes = await this.calculateTargetPoolSizes();
      
      // Warm new containers as needed
      const warmupPromises = [];
      
      for (const [templateName, targetSize] of targetSizes) {
        const currentSize = this.pools.get(templateName).size;
        const toWarm = targetSize - currentSize;
        
        if (toWarm > 0) {
          const template = this.config.templates.find(t => t.name === templateName);
          
          for (let i = 0; i < toWarm; i++) {
            warmupPromises.push(this.warmContainer(template));
          }
        }
      }
      
      // Execute warmups with concurrency limit
      await this.executeWithConcurrency(warmupPromises, this.config.maxConcurrentWarmups);
      
      this.poolState.lastRefresh = new Date();
      
      logger.info(`Pool refresh complete in ${Date.now() - startTime}ms`);
      
    } catch (error) {
      logger.error('Pool refresh failed:', error);
    }
  }

  /**
   * Remove expired containers
   */
  async removeExpiredContainers() {
    const expired = [];
    
    for (const [containerId, container] of this.containers) {
      const age = Date.now() - container.createdAt.getTime();
      
      if (age > this.config.containerMaxAge && container.status === 'ready') {
        expired.push(container);
      }
    }
    
    for (const container of expired) {
      await this.removeContainer(container.id);
      
      if (this.config.recycleContainers) {
        // Recycle by warming a new container of the same type
        const template = this.config.templates.find(t => t.name === container.template);
        if (template) {
          this.warmingQueue.push(template);
        }
      }
    }
    
    if (expired.length > 0) {
      logger.info(`Removed ${expired.length} expired containers`);
      this.metrics.containersRecycled += expired.length;
    }
  }

  /**
   * Calculate target pool sizes
   */
  async calculateTargetPoolSizes() {
    const targetSizes = new Map();
    
    if (!this.config.adaptivePoolSize) {
      // Fixed pool size
      const sizePerTemplate = Math.ceil(this.config.poolSize / this.config.templates.length);
      
      for (const template of this.config.templates) {
        targetSizes.set(template.name, sizePerTemplate);
      }
      
      return targetSizes;
    }
    
    // Adaptive pool sizing based on usage patterns
    const usage = await this.getUsagePatterns();
    const totalTarget = Math.min(
      Math.max(this.config.minPoolSize, usage.predictedDemand),
      this.config.maxPoolSize
    );
    
    // Distribute based on template popularity
    for (const template of this.config.templates) {
      const popularity = usage.templatePopularity.get(template.name) || 0.1;
      const size = Math.ceil(totalTarget * popularity);
      targetSizes.set(template.name, size);
    }
    
    return targetSizes;
  }

  /**
   * Get usage patterns
   */
  async getUsagePatterns() {
    const patterns = {
      predictedDemand: this.config.poolSize,
      templatePopularity: new Map()
    };
    
    // Get predictions if available
    if (this.config.predictor) {
      const predictions = await this.config.predictor.predict();
      patterns.predictedDemand = Math.ceil(predictions.shortTerm.jobs / 10);
    }
    
    // Calculate template popularity
    let totalClaims = 0;
    for (const template of this.config.templates) {
      const claims = this.stats.templateDistribution.get(template.name) || 0;
      totalClaims += claims;
    }
    
    for (const template of this.config.templates) {
      const claims = this.stats.templateDistribution.get(template.name) || 0;
      const popularity = totalClaims > 0 ? claims / totalClaims : 1 / this.config.templates.length;
      patterns.templatePopularity.set(template.name, popularity);
    }
    
    return patterns;
  }

  /**
   * Remove container
   */
  async removeContainer(containerId) {
    try {
      const containerInfo = this.containers.get(containerId);
      if (!containerInfo) return;
      
      // Remove from pool
      if (containerInfo.template && this.pools.has(containerInfo.template)) {
        this.pools.get(containerInfo.template).delete(containerId);
      }
      
      // Stop and remove container
      await this.cleanupContainer(containerId);
      
      // Update state
      this.containers.delete(containerId);
      this.poolState.totalContainers--;
      
      if (containerInfo.status === 'ready') {
        this.poolState.availableContainers--;
      }
      
      // Update resource usage
      if (containerInfo.resources) {
        this.resourceUsage.cpu -= containerInfo.resources.cpu;
        this.resourceUsage.memory -= containerInfo.resources.memory;
      }
      
      logger.debug(`Removed container ${containerId}`);
      
    } catch (error) {
      logger.error(`Failed to remove container ${containerId}:`, error);
    }
  }

  /**
   * Cleanup container
   */
  async cleanupContainer(containerId) {
    if (!this.config.dockerAPI) return;
    
    try {
      const container = this.config.dockerAPI.getContainer(containerId);
      
      // Stop container
      try {
        await container.stop({ t: 10 });
      } catch (error) {
        // Container might already be stopped
      }
      
      // Remove container
      await container.remove({ force: true });
      
    } catch (error) {
      logger.error(`Failed to cleanup container ${containerId}:`, error);
    }
  }

  /**
   * Check resource availability
   */
  hasResourcesAvailable(requirements) {
    const availableCpu = this.config.maxCpuUsage - this.resourceUsage.cpu;
    const availableMemory = this.config.maxMemoryUsage - this.resourceUsage.memory;
    
    return availableCpu >= requirements.cpu && 
           availableMemory >= requirements.memory;
  }

  /**
   * Update warmup metrics
   */
  updateWarmupMetrics(templateName, warmupTime, success) {
    if (success) {
      this.metrics.containersWarmed++;
      this.stats.successfulWarmups++;
      
      // Update average warmup time
      this.metrics.avgWarmupTime = 
        (this.metrics.avgWarmupTime * (this.metrics.containersWarmed - 1) + warmupTime) /
        this.metrics.containersWarmed;
      
      // Update template-specific metrics
      const templateTimes = this.metrics.warmupTimesByTemplate.get(templateName);
      templateTimes.push(warmupTime);
      
      // Keep only recent times
      if (templateTimes.length > 100) {
        templateTimes.shift();
      }
    } else {
      this.metrics.containersFailed++;
      this.stats.failedWarmups++;
    }
    
    this.stats.totalWarmups++;
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    const unhealthy = [];
    
    for (const [containerId, container] of this.containers) {
      if (container.status !== 'ready') continue;
      
      try {
        await this.verifyContainerHealth({ id: containerId });
        container.lastHealthCheck = new Date();
      } catch (error) {
        logger.warn(`Container ${containerId} failed health check:`, error);
        unhealthy.push(container);
      }
    }
    
    // Remove unhealthy containers
    for (const container of unhealthy) {
      await this.removeContainer(container.id);
    }
    
    if (unhealthy.length > 0) {
      logger.info(`Removed ${unhealthy.length} unhealthy containers`);
      
      // Trigger refresh to replace them
      this.refreshPools();
    }
  }

  /**
   * Execute promises with concurrency limit
   */
  async executeWithConcurrency(promises, limit) {
    const results = [];
    const executing = [];
    
    for (const promise of promises) {
      const p = Promise.resolve().then(() => promise).then(
        result => results.push({ status: 'fulfilled', value: result }),
        error => results.push({ status: 'rejected', reason: error })
      );
      
      executing.push(p);
      
      if (executing.length >= limit) {
        await Promise.race(executing);
        executing.splice(executing.findIndex(p => p.isResolved), 1);
      }
    }
    
    await Promise.all(executing);
    return results;
  }

  /**
   * Stop container pre-warmer
   */
  async stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Container Prewarmer');
    
    // Clear timers
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    // Clean up all containers
    const containerIds = Array.from(this.containers.keys());
    for (const containerId of containerIds) {
      await this.removeContainer(containerId);
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Container Prewarmer stopped');
  }

  /**
   * Check if healthy
   */
  async isHealthy() {
    return this.isStarted && 
           this.poolState.availableContainers >= this.config.minPoolSize &&
           this.warmingInProgress.size < this.config.maxConcurrentWarmups;
  }

  /**
   * Get statistics
   */
  getStatistics() {
    // Calculate average container age
    let totalAge = 0;
    let containerCount = 0;
    
    for (const container of this.containers.values()) {
      if (container.status === 'ready') {
        totalAge += Date.now() - container.createdAt.getTime();
        containerCount++;
      }
    }
    
    if (containerCount > 0) {
      this.stats.avgContainerAge = totalAge / containerCount;
    }
    
    return {
      poolState: this.poolState,
      metrics: this.metrics,
      stats: {
        ...this.stats,
        uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0
      },
      resourceUsage: this.resourceUsage,
      pools: Object.fromEntries(
        Array.from(this.pools.entries()).map(([name, ids]) => [name, ids.size])
      ),
      warmingQueueSize: this.warmingQueue.length,
      warmingInProgress: this.warmingInProgress.size
    };
  }
}

module.exports = ContainerPrewarmer;