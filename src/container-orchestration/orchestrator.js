/**
 * Container Orchestration Manager
 * Main orchestrator that coordinates all container management components
 */

const EventEmitter = require('events');
const DockerAPIManager = require('./docker/docker-api');
const ContainerLifecycleManager = require('./lifecycle/container-lifecycle');
const ContainerMonitor = require('./monitoring/container-monitoring');
const ContainerCleanupManager = require('./cleanup/container-cleanup');
const SecurityOrchestrator = require('./security/security-orchestrator');
const logger = require('../utils/logger');

class ContainerOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Container pool configuration
      maxContainers: options.maxContainers || 10,
      minContainers: options.minContainers || 2,
      scaleUpThreshold: options.scaleUpThreshold || 5,
      scaleDownThreshold: options.scaleDownThreshold || 1,
      
      // Container configuration
      baseImage: options.baseImage || 'github-actions-runner:latest',
      networkName: options.networkName || 'github-runners',
      resourceLimits: {
        memory: options.memory || '2147483648', // 2GB
        cpus: options.cpus || '1.0',
        ...options.resourceLimits
      },
      
      // Monitoring configuration
      monitoringEnabled: options.monitoringEnabled !== false,
      cleanupEnabled: options.cleanupEnabled !== false,
      
      // Scaling configuration
      scaleCheckInterval: options.scaleCheckInterval || 30000, // 30 seconds
      jobQueueCheckInterval: options.jobQueueCheckInterval || 15000, // 15 seconds
      
      // Security configuration
      securityEnabled: options.securityEnabled !== false,
      securityLevel: options.securityLevel || 'high',
      securityPolicies: {
        enforceNetworkIsolation: options.enforceNetworkIsolation !== false,
        enforceResourceLimits: options.enforceResourceLimits !== false,
        requireContainerScanning: options.requireContainerScanning !== false,
        blockOnSecurityFailure: options.blockOnSecurityFailure !== false,
        requireAuthentication: options.requireAuthentication !== false
      },
      
      ...options
    };
    
    // Initialize components
    this.dockerAPI = new DockerAPIManager({
      baseImage: this.config.baseImage,
      networkName: this.config.networkName,
      maxContainers: this.config.maxContainers,
      resourceLimits: this.config.resourceLimits,
      dockerOptions: options.dockerOptions
    });
    
    this.lifecycleManager = new ContainerLifecycleManager(
      this.dockerAPI,
      {
        maxAge: options.maxAge || 3600000, // 1 hour
        healthCheckInterval: options.healthCheckInterval || 30000,
        cleanupInterval: options.cleanupInterval || 300000,
        maxRetries: options.maxRetries || 3
      }
    );
    
    this.monitor = this.config.monitoringEnabled ? new ContainerMonitor(
      this.dockerAPI,
      {
        monitoringInterval: options.monitoringInterval || 15000,
        metricsRetention: options.metricsRetention || 3600000,
        alertThresholds: options.alertThresholds || {
          cpu: 80,
          memory: 85,
          responseTime: 5000
        }
      }
    ) : null;
    
    this.cleanupManager = this.config.cleanupEnabled ? new ContainerCleanupManager(
      this.dockerAPI,
      this.lifecycleManager,
      {
        cleanupInterval: options.cleanupInterval || 300000,
        maxContainerAge: options.maxContainerAge || 3600000,
        enableVolumeCleanup: options.enableVolumeCleanup !== false,
        enableImageCleanup: options.enableImageCleanup !== false
      }
    ) : null;
    
    this.securityOrchestrator = this.config.securityEnabled ? new SecurityOrchestrator(
      this.dockerAPI,
      {
        securityLevel: this.config.securityLevel,
        policies: this.config.securityPolicies,
        auditPath: options.auditPath || '/opt/github-runnerhub/audit-logs',
        networkIsolation: options.networkIsolation,
        resourceQuotas: options.resourceQuotas,
        secretManagement: options.secretManagement,
        containerScanner: options.containerScanner,
        rbac: options.rbac,
        runtimeMonitor: options.runtimeMonitor
      }
    ) : null;
    
    // State management
    this.jobQueue = new Map(); // Track queued jobs
    this.activeJobs = new Map(); // Track running jobs
    this.initialized = false;
    this.running = false;
    
    // Timers
    this.scaleCheckTimer = null;
    this.queueCheckTimer = null;
    
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers between components
   */
  setupEventHandlers() {
    // Docker API events
    this.dockerAPI.on('containerCreated', (event) => {
      this.emit('containerCreated', event);
    });

    this.dockerAPI.on('containerStarted', (event) => {
      this.emit('containerStarted', event);
    });

    this.dockerAPI.on('containerStopped', (event) => {
      this.emit('containerStopped', event);
    });

    // Lifecycle events
    this.lifecycleManager.on('containerFailed', (event) => {
      this.handleContainerFailure(event);
    });

    this.lifecycleManager.on('containerUnhealthy', (event) => {
      this.handleUnhealthyContainer(event);
    });

    // Monitoring events
    if (this.monitor) {
      this.monitor.on('alertTriggered', (alert) => {
        this.handleMonitoringAlert(alert);
      });

      this.monitor.on('metricsCollected', (event) => {
        this.emit('metricsCollected', event);
      });
    }

    // Cleanup events
    if (this.cleanupManager) {
      this.cleanupManager.on('cleanupCompleted', (event) => {
        logger.info('Cleanup completed:', event);
        this.emit('cleanupCompleted', event);
      });
    }

    // Security events
    if (this.securityOrchestrator) {
      this.securityOrchestrator.on('threatHandled', (threat) => {
        this.handleSecurityThreat(threat);
      });

      this.securityOrchestrator.on('jobBlocked', (event) => {
        this.handleJobBlocked(event);
      });

      this.securityOrchestrator.on('containerBlocked', (event) => {
        this.handleContainerBlocked(event);
      });

      this.securityOrchestrator.on('securityAlert', (alert) => {
        this.emit('securityAlert', alert);
      });
    }
  }

  /**
   * Initialize the orchestrator
   */
  async initialize() {
    try {
      logger.info('Initializing Container Orchestrator');
      
      // Initialize Docker API
      await this.dockerAPI.initialize();
      
      // Start lifecycle manager
      this.lifecycleManager.start();
      
      // Start monitoring if enabled
      if (this.monitor) {
        this.monitor.start();
      }
      
      // Start cleanup if enabled
      if (this.cleanupManager) {
        this.cleanupManager.start();
      }
      
      // Initialize security if enabled
      if (this.securityOrchestrator) {
        await this.securityOrchestrator.initialize();
      }
      
      this.initialized = true;
      logger.info('Container Orchestrator initialized successfully');
      this.emit('initialized');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize Container Orchestrator:', error);
      throw error;
    }
  }

  /**
   * Start the orchestrator
   */
  async start() {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (this.running) {
      logger.warn('Container Orchestrator is already running');
      return;
    }
    
    logger.info('Starting Container Orchestrator');
    this.running = true;
    
    // Start scaling checks
    this.scaleCheckTimer = setInterval(() => {
      this.checkScaling().catch(err => 
        logger.error('Scaling check failed:', err)
      );
    }, this.config.scaleCheckInterval);
    
    // Start job queue monitoring
    this.queueCheckTimer = setInterval(() => {
      this.processJobQueue().catch(err => 
        logger.error('Job queue processing failed:', err)
      );
    }, this.config.jobQueueCheckInterval);
    
    // Ensure minimum containers are running
    await this.ensureMinimumContainers();
    
    this.emit('started');
    logger.info('Container Orchestrator started successfully');
  }

  /**
   * Stop the orchestrator
   */
  async stop() {
    if (!this.running) {
      return;
    }
    
    logger.info('Stopping Container Orchestrator');
    this.running = false;
    
    // Clear timers
    if (this.scaleCheckTimer) {
      clearInterval(this.scaleCheckTimer);
      this.scaleCheckTimer = null;
    }
    
    if (this.queueCheckTimer) {
      clearInterval(this.queueCheckTimer);
      this.queueCheckTimer = null;
    }
    
    // Stop components
    this.lifecycleManager.stop();
    
    if (this.monitor) {
      this.monitor.stop();
    }
    
    if (this.cleanupManager) {
      this.cleanupManager.stop();
    }
    
    if (this.securityOrchestrator) {
      await this.securityOrchestrator.stop();
    }
    
    // Clean up all containers
    await this.dockerAPI.cleanup();
    
    this.emit('stopped');
    logger.info('Container Orchestrator stopped');
  }

  /**
   * Submit a job for execution
   */
  async submitJob(jobId, jobConfig = {}) {
    try {
      logger.info(`Submitting job for orchestration: ${jobId}`);
      
      // Create security context if security is enabled
      if (this.securityOrchestrator) {
        const securityContext = await this.securityOrchestrator.createJobSecurityContext(jobId, jobConfig);
        if (securityContext.state === 'blocked') {
          throw new Error(`Job blocked by security policy: ${jobId}`);
        }
      }
      
      // Add to job queue
      this.jobQueue.set(jobId, {
        jobId,
        config: jobConfig,
        submittedAt: new Date(),
        priority: jobConfig.priority || 'normal',
        repository: jobConfig.repository
      });
      
      this.emit('jobSubmitted', { jobId, config: jobConfig });
      
      // Try to process immediately if capacity available
      await this.processJobQueue();
      
      return true;
    } catch (error) {
      logger.error(`Failed to submit job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Process the job queue
   */
  async processJobQueue() {
    if (this.jobQueue.size === 0) {
      return;
    }
    
    const availableCapacity = this.getAvailableCapacity();
    if (availableCapacity <= 0) {
      return;
    }
    
    // Sort jobs by priority and submission time
    const sortedJobs = Array.from(this.jobQueue.values()).sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      const aPriority = priorityOrder[a.priority] || 2;
      const bPriority = priorityOrder[b.priority] || 2;
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority; // Higher priority first
      }
      
      return a.submittedAt - b.submittedAt; // Earlier submission first
    });
    
    // Process as many jobs as we have capacity for
    const jobsToProcess = sortedJobs.slice(0, availableCapacity);
    
    for (const job of jobsToProcess) {
      try {
        await this.executeJob(job.jobId, job.config);
        this.jobQueue.delete(job.jobId);
      } catch (error) {
        logger.error(`Failed to execute job ${job.jobId}:`, error);
        // Keep job in queue for retry (could implement retry logic here)
      }
    }
  }

  /**
   * Execute a job in a container
   */
  async executeJob(jobId, jobConfig) {
    try {
      logger.info(`Executing job in container: ${jobId}`);
      
      // Create and start container
      const containerId = await this.lifecycleManager.createAndStartContainer(jobId, jobConfig);
      
      // Apply security controls if enabled
      if (this.securityOrchestrator && containerId) {
        const secured = await this.securityOrchestrator.prepareSecureContainer(containerId, jobId);
        if (!secured) {
          await this.lifecycleManager.stopAndCleanupContainer(jobId);
          throw new Error(`Failed to secure container for job ${jobId}`);
        }
      }
      
      // Track active job
      this.activeJobs.set(jobId, {
        jobId,
        config: jobConfig,
        startedAt: new Date(),
        status: 'running'
      });
      
      // Execute the job script
      const jobScript = this.buildJobScript(jobConfig);
      const result = await this.lifecycleManager.executeJob(jobId, jobScript, {
        timeout: jobConfig.timeout || 3600000 // 1 hour default
      });
      
      // Update job status
      const activeJob = this.activeJobs.get(jobId);
      if (activeJob) {
        activeJob.status = result.success ? 'completed' : 'failed';
        activeJob.completedAt = new Date();
        activeJob.result = result;
      }
      
      this.emit('jobCompleted', { 
        jobId, 
        success: result.success,
        result: result,
        duration: Date.now() - activeJob.startedAt
      });
      
      // Clean up container and security context
      setTimeout(async () => {
        try {
          // Clean up security context first
          if (this.securityOrchestrator) {
            await this.securityOrchestrator.cleanupJobSecurity(jobId);
          }
          
          await this.lifecycleManager.stopAndCleanupContainer(jobId);
          this.activeJobs.delete(jobId);
        } catch (error) {
          logger.error(`Failed to cleanup container for job ${jobId}:`, error);
        }
      }, 30000); // 30 second delay before cleanup
      
      return result;
    } catch (error) {
      logger.error(`Job execution failed for ${jobId}:`, error);
      
      // Update job status
      const activeJob = this.activeJobs.get(jobId);
      if (activeJob) {
        activeJob.status = 'failed';
        activeJob.completedAt = new Date();
        activeJob.error = error.message;
      }
      
      this.emit('jobFailed', { jobId, error: error.message });
      throw error;
    }
  }

  /**
   * Build job script from configuration
   */
  buildJobScript(jobConfig) {
    const steps = jobConfig.steps || [];
    const commands = steps.map(step => {
      if (typeof step === 'string') {
        return step;
      }
      return step.run || '';
    }).filter(cmd => cmd);
    
    return commands.join(' && ');
  }

  /**
   * Check if scaling is needed
   */
  async checkScaling() {
    const queueDepth = this.jobQueue.size;
    const activeContainers = this.dockerAPI.getActiveContainers().length;
    
    // Scale up if needed
    if (queueDepth >= this.config.scaleUpThreshold && 
        activeContainers < this.config.maxContainers) {
      const containersToAdd = Math.min(
        Math.ceil(queueDepth / 2), // Add half the queue depth
        this.config.maxContainers - activeContainers
      );
      
      logger.info(`Scaling up: Adding ${containersToAdd} containers (queue: ${queueDepth})`);
      await this.scaleUp(containersToAdd);
    }
    
    // Scale down if needed
    if (queueDepth <= this.config.scaleDownThreshold && 
        activeContainers > this.config.minContainers) {
      const containersToRemove = Math.min(
        Math.floor((activeContainers - this.config.minContainers) / 2),
        activeContainers - this.config.minContainers
      );
      
      if (containersToRemove > 0) {
        logger.info(`Scaling down: Removing ${containersToRemove} containers (queue: ${queueDepth})`);
        await this.scaleDown(containersToRemove);
      }
    }
  }

  /**
   * Scale up by creating additional containers
   */
  async scaleUp(count) {
    const promises = [];
    
    for (let i = 0; i < count; i++) {
      const warmupJobId = `warmup-${Date.now()}-${i}`;
      promises.push(
        this.lifecycleManager.createAndStartContainer(warmupJobId, {
          warmup: true
        }).catch(err => 
          logger.error(`Failed to create warmup container ${warmupJobId}:`, err)
        )
      );
    }
    
    await Promise.allSettled(promises);
    this.emit('scaledUp', { count, totalContainers: this.dockerAPI.getActiveContainers().length });
  }

  /**
   * Scale down by removing idle containers
   */
  async scaleDown(count) {
    const containers = this.dockerAPI.getActiveContainers();
    const idleContainers = containers.filter(container => {
      const lifecycle = this.lifecycleManager.getLifecycle(container.jobId);
      return lifecycle && container.jobId.startsWith('warmup-');
    });
    
    const containersToRemove = idleContainers.slice(0, count);
    const promises = containersToRemove.map(container =>
      this.lifecycleManager.stopAndCleanupContainer(container.jobId).catch(err =>
        logger.error(`Failed to remove container ${container.jobId}:`, err)
      )
    );
    
    await Promise.allSettled(promises);
    this.emit('scaledDown', { count: containersToRemove.length, totalContainers: this.dockerAPI.getActiveContainers().length });
  }

  /**
   * Ensure minimum number of containers are running
   */
  async ensureMinimumContainers() {
    const activeContainers = this.dockerAPI.getActiveContainers().length;
    if (activeContainers < this.config.minContainers) {
      const containersNeeded = this.config.minContainers - activeContainers;
      logger.info(`Ensuring minimum containers: Creating ${containersNeeded} containers`);
      await this.scaleUp(containersNeeded);
    }
  }

  /**
   * Get available capacity for new jobs
   */
  getAvailableCapacity() {
    const activeContainers = this.dockerAPI.getActiveContainers().length;
    const runningJobs = this.activeJobs.size;
    return Math.max(0, activeContainers - runningJobs);
  }

  /**
   * Handle container failure
   */
  async handleContainerFailure(event) {
    const { jobId, error, canRetry } = event;
    
    logger.error(`Container failed for job ${jobId}:`, error);
    
    // Remove from active jobs
    this.activeJobs.delete(jobId);
    
    // If job can be retried, add back to queue
    if (canRetry) {
      const jobConfig = event.jobConfig || {};
      this.jobQueue.set(jobId, {
        jobId,
        config: jobConfig,
        submittedAt: new Date(),
        priority: 'high', // Higher priority for retries
        retry: true
      });
      
      logger.info(`Job ${jobId} added back to queue for retry`);
    }
    
    this.emit('containerFailed', event);
  }

  /**
   * Handle unhealthy container
   */
  async handleUnhealthyContainer(event) {
    const { jobId, reason } = event;
    
    logger.warn(`Container ${jobId} is unhealthy: ${reason}`);
    
    // Force cleanup of unhealthy container
    try {
      await this.cleanupManager.forceCleanupContainer(jobId);
    } catch (error) {
      logger.error(`Failed to cleanup unhealthy container ${jobId}:`, error);
    }
    
    this.emit('containerUnhealthy', event);
  }

  /**
   * Handle monitoring alerts
   */
  handleMonitoringAlert(alert) {
    logger.warn(`Monitoring alert for ${alert.jobId}: ${alert.message}`);
    
    // Could implement automated responses to alerts here
    // e.g., scaling, container restart, etc.
    
    this.emit('monitoringAlert', alert);
  }

  /**
   * Handle security threat
   */
  handleSecurityThreat(threat) {
    logger.error(`Security threat detected: ${threat.type} - ${threat.message}`);
    
    // Take action based on threat severity
    if (threat.severity === 'critical' && threat.jobId) {
      // Find and terminate the job
      const activeJob = this.activeJobs.get(threat.jobId);
      if (activeJob) {
        this.lifecycleManager.stopAndCleanupContainer(threat.jobId).catch(err =>
          logger.error(`Failed to terminate job ${threat.jobId} due to security threat:`, err)
        );
        this.activeJobs.delete(threat.jobId);
      }
    }
    
    this.emit('securityThreat', threat);
  }

  /**
   * Handle job blocked by security
   */
  handleJobBlocked(event) {
    const { jobId, reason } = event;
    logger.warn(`Job ${jobId} blocked: ${reason}`);
    
    // Remove from queue if present
    this.jobQueue.delete(jobId);
    
    this.emit('jobBlocked', event);
  }

  /**
   * Handle container blocked by security
   */
  handleContainerBlocked(event) {
    const { containerId, reason } = event;
    logger.warn(`Container ${containerId} blocked: ${reason}`);
    
    // Find associated job and clean up
    for (const [jobId, job] of this.activeJobs.entries()) {
      if (job.containerId === containerId) {
        this.lifecycleManager.stopAndCleanupContainer(jobId).catch(err =>
          logger.error(`Failed to cleanup blocked container ${containerId}:`, err)
        );
        this.activeJobs.delete(jobId);
        break;
      }
    }
    
    this.emit('containerBlocked', event);
  }

  /**
   * Get orchestrator status
   */
  getStatus() {
    const activeContainers = this.dockerAPI.getActiveContainers();
    const lifecycleStats = this.lifecycleManager.getStatistics();
    
    return {
      running: this.running,
      initialized: this.initialized,
      containers: {
        active: activeContainers.length,
        max: this.config.maxContainers,
        min: this.config.minContainers
      },
      jobs: {
        queued: this.jobQueue.size,
        active: this.activeJobs.size,
        capacity: this.getAvailableCapacity()
      },
      lifecycle: lifecycleStats,
      monitoring: this.monitor ? this.monitor.getMonitoringStats() : null,
      cleanup: this.cleanupManager ? this.cleanupManager.getCleanupStats() : null,
      security: this.securityOrchestrator ? this.securityOrchestrator.getStatus() : null
    };
  }

  /**
   * Get detailed metrics
   */
  getMetrics() {
    const status = this.getStatus();
    const containerMetrics = [];
    
    if (this.monitor) {
      for (const container of this.dockerAPI.getActiveContainers()) {
        const metrics = this.monitor.getLatestMetrics(container.jobId);
        if (metrics) {
          containerMetrics.push(metrics);
        }
      }
    }
    
    return {
      status,
      containerMetrics,
      security: this.securityOrchestrator ? this.securityOrchestrator.getSecurityMetrics() : null,
      timestamp: new Date()
    };
  }

  /**
   * Emergency stop - force stop all containers
   */
  async emergencyStop() {
    logger.warn('Emergency stop initiated');
    
    try {
      // Stop all timers
      this.running = false;
      if (this.scaleCheckTimer) clearInterval(this.scaleCheckTimer);
      if (this.queueCheckTimer) clearInterval(this.queueCheckTimer);
      
      // Emergency cleanup
      if (this.cleanupManager) {
        await this.cleanupManager.emergencyCleanup();
      } else {
        await this.dockerAPI.cleanup();
      }
      
      // Clear state
      this.jobQueue.clear();
      this.activeJobs.clear();
      
      this.emit('emergencyStop');
      logger.info('Emergency stop completed');
    } catch (error) {
      logger.error('Emergency stop failed:', error);
      throw error;
    }
  }
}

module.exports = ContainerOrchestrator;