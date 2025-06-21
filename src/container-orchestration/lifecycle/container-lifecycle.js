/**
 * Container Lifecycle Management
 * Manages the complete lifecycle of containers from creation to cleanup
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class ContainerLifecycleManager extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.config = {
      maxAge: options.maxAge || 3600000, // 1 hour in milliseconds
      healthCheckInterval: options.healthCheckInterval || 30000, // 30 seconds
      cleanupInterval: options.cleanupInterval || 300000, // 5 minutes
      maxRetries: options.maxRetries || 3,
      ...options
    };
    
    this.lifecycles = new Map(); // Track container lifecycles
    this.healthCheckTimer = null;
    this.cleanupTimer = null;
    
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for Docker API events
   */
  setupEventHandlers() {
    this.dockerAPI.on('containerCreated', ({ jobId, containerId }) => {
      this.trackLifecycle(jobId, 'created', { containerId });
    });

    this.dockerAPI.on('containerStarted', ({ jobId, containerId }) => {
      this.trackLifecycle(jobId, 'started', { containerId });
    });

    this.dockerAPI.on('containerStopped', ({ jobId, containerId }) => {
      this.trackLifecycle(jobId, 'stopped', { containerId });
    });

    this.dockerAPI.on('containerRemoved', ({ jobId }) => {
      this.lifecycles.delete(jobId);
    });
  }

  /**
   * Start lifecycle management
   */
  start() {
    logger.info('Starting container lifecycle management');
    
    // Start health checking
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks().catch(err => 
        logger.error('Health check failed:', err)
      );
    }, this.config.healthCheckInterval);

    // Start cleanup process
    this.cleanupTimer = setInterval(() => {
      this.performCleanup().catch(err => 
        logger.error('Cleanup failed:', err)
      );
    }, this.config.cleanupInterval);

    this.emit('started');
  }

  /**
   * Stop lifecycle management
   */
  stop() {
    logger.info('Stopping container lifecycle management');
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.emit('stopped');
  }

  /**
   * Track container lifecycle state
   */
  trackLifecycle(jobId, state, metadata = {}) {
    const now = new Date();
    
    if (!this.lifecycles.has(jobId)) {
      this.lifecycles.set(jobId, {
        jobId,
        states: [],
        createdAt: now,
        lastUpdate: now,
        retryCount: 0,
        metadata: {}
      });
    }

    const lifecycle = this.lifecycles.get(jobId);
    lifecycle.states.push({
      state,
      timestamp: now,
      metadata
    });
    lifecycle.lastUpdate = now;
    lifecycle.metadata = { ...lifecycle.metadata, ...metadata };

    logger.debug(`Container ${jobId} transitioned to state: ${state}`);
    this.emit('stateChanged', { jobId, state, lifecycle });
  }

  /**
   * Create and start container for job
   */
  async createAndStartContainer(jobId, jobConfig = {}) {
    try {
      logger.info(`Creating container for job: ${jobId}`);
      
      // Create container
      const container = await this.dockerAPI.createContainer(jobId, jobConfig);
      
      // Start container
      await this.dockerAPI.startContainer(jobId);
      
      // Set up job execution environment
      await this.setupJobEnvironment(jobId, jobConfig);
      
      return container;
    } catch (error) {
      logger.error(`Failed to create and start container for job ${jobId}:`, error);
      await this.handleContainerFailure(jobId, error);
      throw error;
    }
  }

  /**
   * Set up job execution environment in container
   */
  async setupJobEnvironment(jobId, jobConfig) {
    try {
      // Create necessary directories
      await this.dockerAPI.execInContainer(jobId, [
        'mkdir', '-p', 
        '/github/workspace',
        '/github/home',
        '/github/workflow'
      ]);

      // Set up GitHub Actions environment
      const envSetup = [
        'export GITHUB_WORKSPACE=/github/workspace',
        'export GITHUB_HOME=/github/home',
        'export RUNNER_WORKSPACE=/github/workspace',
        'export RUNNER_TEMP=/tmp',
        `export GITHUB_RUN_ID=${jobConfig.runId || ''}`,
        `export GITHUB_RUN_NUMBER=${jobConfig.runNumber || ''}`,
        `export GITHUB_JOB=${jobConfig.jobName || ''}`,
        `export GITHUB_REPOSITORY=${jobConfig.repository || ''}`
      ].join(' && ');

      await this.dockerAPI.execInContainer(jobId, envSetup);
      
      logger.debug(`Environment setup completed for job ${jobId}`);
    } catch (error) {
      logger.error(`Failed to setup environment for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Execute job in container
   */
  async executeJob(jobId, jobScript, options = {}) {
    const lifecycle = this.lifecycles.get(jobId);
    if (!lifecycle) {
      throw new Error(`Container lifecycle for job ${jobId} not found`);
    }

    try {
      this.trackLifecycle(jobId, 'executing');
      
      logger.info(`Executing job in container: ${jobId}`);
      
      // Execute the job script
      const result = await this.dockerAPI.execInContainer(
        jobId, 
        jobScript, 
        { 
          Tty: true,
          AttachStdin: false,
          ...options 
        }
      );

      // Track execution result
      this.trackLifecycle(jobId, result.success ? 'completed' : 'failed', {
        exitCode: result.exitCode,
        output: result.output.substring(0, 1000) // Limit output size
      });

      logger.info(`Job ${jobId} ${result.success ? 'completed' : 'failed'} with exit code ${result.exitCode}`);
      
      return result;
    } catch (error) {
      this.trackLifecycle(jobId, 'error', { error: error.message });
      logger.error(`Job execution failed for ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Stop and clean up container
   */
  async stopAndCleanupContainer(jobId, force = false) {
    try {
      logger.info(`Stopping and cleaning up container: ${jobId}`);
      
      // Stop container gracefully
      await this.dockerAPI.stopContainer(jobId, force ? 0 : 30);
      
      // Get final logs
      const logs = await this.dockerAPI.getContainerLogs(jobId);
      this.trackLifecycle(jobId, 'logs_collected', { 
        logsSize: logs.length 
      });
      
      // Remove container
      await this.dockerAPI.removeContainer(jobId, force);
      
      this.trackLifecycle(jobId, 'removed');
      
      logger.info(`Container cleanup completed for job: ${jobId}`);
      
      return true;
    } catch (error) {
      logger.error(`Failed to cleanup container for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Handle container failure
   */
  async handleContainerFailure(jobId, error) {
    const lifecycle = this.lifecycles.get(jobId);
    if (!lifecycle) return;

    lifecycle.retryCount = (lifecycle.retryCount || 0) + 1;
    
    this.trackLifecycle(jobId, 'failed', {
      error: error.message,
      retryCount: lifecycle.retryCount
    });

    // Attempt cleanup of failed container
    try {
      await this.dockerAPI.removeContainer(jobId, true);
    } catch (cleanupError) {
      logger.error(`Failed to cleanup failed container ${jobId}:`, cleanupError);
    }

    // Emit failure event
    this.emit('containerFailed', { 
      jobId, 
      error, 
      retryCount: lifecycle.retryCount,
      canRetry: lifecycle.retryCount < this.config.maxRetries
    });
  }

  /**
   * Perform health checks on all containers
   */
  async performHealthChecks() {
    const activeContainers = this.dockerAPI.getActiveContainers();
    
    for (const containerInfo of activeContainers) {
      try {
        const stats = await this.dockerAPI.getContainerStats(containerInfo.jobId);
        
        // Check if container is responsive
        const healthStatus = this.evaluateContainerHealth(containerInfo, stats);
        
        if (healthStatus.status === 'unhealthy') {
          logger.warn(`Container ${containerInfo.jobId} is unhealthy:`, healthStatus.reason);
          this.emit('containerUnhealthy', { 
            jobId: containerInfo.jobId, 
            reason: healthStatus.reason 
          });
        }
      } catch (error) {
        logger.error(`Health check failed for container ${containerInfo.jobId}:`, error);
      }
    }
  }

  /**
   * Evaluate container health based on stats
   */
  evaluateContainerHealth(containerInfo, stats) {
    const now = new Date();
    const age = now - containerInfo.createdAt;
    
    // Check age
    if (age > this.config.maxAge) {
      return {
        status: 'unhealthy',
        reason: 'Container exceeded maximum age'
      };
    }

    // Check memory usage
    if (stats.memory_stats && stats.memory_stats.usage) {
      const memoryUsage = stats.memory_stats.usage / stats.memory_stats.limit;
      if (memoryUsage > 0.95) {
        return {
          status: 'unhealthy',
          reason: 'High memory usage'
        };
      }
    }

    return { status: 'healthy' };
  }

  /**
   * Perform cleanup of old and unused containers
   */
  async performCleanup() {
    const now = new Date();
    const containersToCleanup = [];

    // Find containers that need cleanup
    for (const [jobId, lifecycle] of this.lifecycles.entries()) {
      const age = now - lifecycle.createdAt;
      
      // Cleanup old containers
      if (age > this.config.maxAge) {
        containersToCleanup.push(jobId);
      }
      
      // Cleanup failed containers
      const lastState = lifecycle.states[lifecycle.states.length - 1];
      if (lastState && ['failed', 'error'].includes(lastState.state)) {
        if (age > 300000) { // 5 minutes for failed containers
          containersToCleanup.push(jobId);
        }
      }
    }

    // Perform cleanup
    for (const jobId of containersToCleanup) {
      try {
        await this.stopAndCleanupContainer(jobId, true);
        logger.info(`Cleaned up old container: ${jobId}`);
      } catch (error) {
        logger.error(`Failed to cleanup container ${jobId}:`, error);
      }
    }

    if (containersToCleanup.length > 0) {
      logger.info(`Cleanup completed. Removed ${containersToCleanup.length} containers`);
    }
  }

  /**
   * Get lifecycle information for a job
   */
  getLifecycle(jobId) {
    return this.lifecycles.get(jobId);
  }

  /**
   * Get all active lifecycles
   */
  getAllLifecycles() {
    return Array.from(this.lifecycles.values());
  }

  /**
   * Get lifecycle statistics
   */
  getStatistics() {
    const lifecycles = Array.from(this.lifecycles.values());
    const now = new Date();
    
    return {
      total: lifecycles.length,
      byState: this.groupByCurrentState(lifecycles),
      averageAge: this.calculateAverageAge(lifecycles, now),
      oldestContainer: this.findOldestContainer(lifecycles, now),
      healthStatus: this.getOverallHealth(lifecycles)
    };
  }

  /**
   * Group lifecycles by current state
   */
  groupByCurrentState(lifecycles) {
    const grouped = {};
    
    for (const lifecycle of lifecycles) {
      const lastState = lifecycle.states[lifecycle.states.length - 1];
      const state = lastState ? lastState.state : 'unknown';
      grouped[state] = (grouped[state] || 0) + 1;
    }
    
    return grouped;
  }

  /**
   * Calculate average age of containers
   */
  calculateAverageAge(lifecycles, now) {
    if (lifecycles.length === 0) return 0;
    
    const totalAge = lifecycles.reduce((sum, lifecycle) => 
      sum + (now - lifecycle.createdAt), 0
    );
    
    return Math.round(totalAge / lifecycles.length / 1000); // in seconds
  }

  /**
   * Find oldest container
   */
  findOldestContainer(lifecycles, now) {
    if (lifecycles.length === 0) return null;
    
    const oldest = lifecycles.reduce((oldest, lifecycle) => 
      lifecycle.createdAt < oldest.createdAt ? lifecycle : oldest
    );
    
    return {
      jobId: oldest.jobId,
      age: Math.round((now - oldest.createdAt) / 1000) // in seconds
    };
  }

  /**
   * Get overall health status
   */
  getOverallHealth(lifecycles) {
    const unhealthyStates = ['failed', 'error'];
    const unhealthyCount = lifecycles.filter(lifecycle => {
      const lastState = lifecycle.states[lifecycle.states.length - 1];
      return lastState && unhealthyStates.includes(lastState.state);
    }).length;
    
    const healthyPercentage = lifecycles.length > 0 
      ? ((lifecycles.length - unhealthyCount) / lifecycles.length) * 100 
      : 100;
    
    return {
      healthy: lifecycles.length - unhealthyCount,
      unhealthy: unhealthyCount,
      percentage: Math.round(healthyPercentage)
    };
  }
}

module.exports = ContainerLifecycleManager;