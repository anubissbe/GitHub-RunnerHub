/**
 * Container Cleanup Procedures
 * Advanced cleanup strategies for container resources and data
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class ContainerCleanupManager extends EventEmitter {
  constructor(dockerAPI, lifecycleManager, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.lifecycleManager = lifecycleManager;
    this.config = {
      cleanupInterval: options.cleanupInterval || 300000, // 5 minutes
      maxContainerAge: options.maxContainerAge || 3600000, // 1 hour
      maxFailedAge: options.maxFailedAge || 900000, // 15 minutes
      orphanedContainerAge: options.orphanedContainerAge || 1800000, // 30 minutes
      volumeCleanupAge: options.volumeCleanupAge || 86400000, // 24 hours
      logRetentionDays: options.logRetentionDays || 7,
      enableMetricsCleanup: options.enableMetricsCleanup !== false,
      enableVolumeCleanup: options.enableVolumeCleanup !== false,
      enableImageCleanup: options.enableImageCleanup !== false,
      ...options
    };
    
    this.cleanupStats = {
      totalCleanupRuns: 0,
      containersRemoved: 0,
      volumesRemoved: 0,
      imagesRemoved: 0,
      bytesFreed: 0,
      lastCleanupAt: null,
      errors: []
    };
    
    this.cleanupTimer = null;
    this.isRunning = false;
  }

  /**
   * Start automated cleanup
   */
  start() {
    if (this.isRunning) {
      logger.warn('Container cleanup is already running');
      return;
    }

    logger.info('Starting container cleanup manager');
    this.isRunning = true;
    
    // Run initial cleanup
    this.performCleanup().catch(err => 
      logger.error('Initial cleanup failed:', err)
    );
    
    // Schedule periodic cleanup
    this.cleanupTimer = setInterval(() => {
      this.performCleanup().catch(err => 
        logger.error('Scheduled cleanup failed:', err)
      );
    }, this.config.cleanupInterval);

    this.emit('started');
  }

  /**
   * Stop automated cleanup
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping container cleanup manager');
    this.isRunning = false;
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.emit('stopped');
  }

  /**
   * Perform comprehensive cleanup
   */
  async performCleanup() {
    const startTime = Date.now();
    this.cleanupStats.totalCleanupRuns++;
    
    try {
      logger.info('Starting comprehensive container cleanup');
      
      const results = await Promise.allSettled([
        this.cleanupContainers(),
        this.cleanupOrphanedContainers(),
        this.cleanupVolumes(),
        this.cleanupImages(),
        this.cleanupLogs(),
        this.cleanupMetrics()
      ]);

      // Process results
      const errors = results
        .filter(result => result.status === 'rejected')
        .map(result => result.reason);

      if (errors.length > 0) {
        logger.warn(`Cleanup completed with ${errors.length} errors:`, errors);
        this.cleanupStats.errors.push(...errors);
      }

      this.cleanupStats.lastCleanupAt = new Date();
      const duration = Date.now() - startTime;
      
      logger.info(`Cleanup completed in ${duration}ms`);
      this.emit('cleanupCompleted', { 
        duration, 
        errors: errors.length,
        stats: this.getCleanupStats() 
      });
      
    } catch (error) {
      logger.error('Cleanup failed:', error);
      this.cleanupStats.errors.push(error);
      this.emit('cleanupFailed', error);
    }
  }

  /**
   * Clean up old and unused containers
   */
  async cleanupContainers() {
    const now = new Date();
    const activeContainers = this.dockerAPI.getActiveContainers();
    const containersToRemove = [];
    
    for (const containerInfo of activeContainers) {
      const age = now - containerInfo.createdAt;
      let shouldRemove = false;
      
      // Check age limits
      if (age > this.config.maxContainerAge) {
        shouldRemove = true;
        logger.debug(`Container ${containerInfo.jobId} exceeded max age: ${age}ms`);
      }
      
      // Check failed containers
      if (containerInfo.status === 'failed' && age > this.config.maxFailedAge) {
        shouldRemove = true;
        logger.debug(`Failed container ${containerInfo.jobId} cleanup: ${age}ms old`);
      }
      
      // Check lifecycle status
      const lifecycle = this.lifecycleManager.getLifecycle(containerInfo.jobId);
      if (lifecycle) {
        const lastState = lifecycle.states[lifecycle.states.length - 1];
        if (lastState && ['completed', 'failed', 'error'].includes(lastState.state)) {
          const timeSinceCompletion = now - lastState.timestamp;
          if (timeSinceCompletion > 300000) { // 5 minutes after completion
            shouldRemove = true;
            logger.debug(`Completed container ${containerInfo.jobId} cleanup`);
          }
        }
      }
      
      if (shouldRemove) {
        containersToRemove.push(containerInfo.jobId);
      }
    }
    
    // Remove containers
    const removedContainers = [];
    for (const jobId of containersToRemove) {
      try {
        await this.dockerAPI.removeContainer(jobId, true);
        removedContainers.push(jobId);
        this.cleanupStats.containersRemoved++;
        logger.info(`Cleaned up container: ${jobId}`);
      } catch (error) {
        logger.error(`Failed to remove container ${jobId}:`, error);
      }
    }
    
    return { removed: removedContainers, total: containersToRemove.length };
  }

  /**
   * Clean up orphaned containers (not tracked in our system)
   */
  async cleanupOrphanedContainers() {
    try {
      const allContainers = await this.dockerAPI.docker.listContainers({ 
        all: true,
        filters: {
          label: ['github-runner=true']
        }
      });
      
      const managedJobIds = new Set(this.dockerAPI.getActiveContainers().map(c => c.jobId));
      const orphanedContainers = [];
      
      for (const containerData of allContainers) {
        const jobId = containerData.Labels['job-id'];
        const createdAt = new Date(containerData.Labels['created-at'] || containerData.Created * 1000);
        const age = Date.now() - createdAt.getTime();
        
        // Check if container is orphaned and old enough
        if (!managedJobIds.has(jobId) && age > this.config.orphanedContainerAge) {
          orphanedContainers.push({
            id: containerData.Id,
            jobId,
            age,
            name: containerData.Names[0]
          });
        }
      }
      
      // Remove orphaned containers
      const removedOrphaned = [];
      for (const orphaned of orphanedContainers) {
        try {
          const container = this.dockerAPI.docker.getContainer(orphaned.id);
          await container.remove({ force: true });
          removedOrphaned.push(orphaned.jobId);
          this.cleanupStats.containersRemoved++;
          logger.info(`Cleaned up orphaned container: ${orphaned.name} (${orphaned.jobId})`);
        } catch (error) {
          logger.error(`Failed to remove orphaned container ${orphaned.id}:`, error);
        }
      }
      
      return { removed: removedOrphaned, total: orphanedContainers.length };
    } catch (error) {
      logger.error('Failed to cleanup orphaned containers:', error);
      return { removed: [], total: 0 };
    }
  }

  /**
   * Clean up unused volumes
   */
  async cleanupVolumes() {
    if (!this.config.enableVolumeCleanup) {
      return { removed: [], total: 0 };
    }
    
    try {
      const volumes = await this.dockerAPI.docker.listVolumes({
        filters: {
          label: ['github-runner=true']
        }
      });
      
      const volumesToRemove = [];
      const now = Date.now();
      
      for (const volume of volumes.Volumes || []) {
        const createdAt = new Date(volume.CreatedAt);
        const age = now - createdAt.getTime();
        
        if (age > this.config.volumeCleanupAge) {
          volumesToRemove.push(volume);
        }
      }
      
      // Remove old volumes
      const removedVolumes = [];
      for (const volume of volumesToRemove) {
        try {
          const vol = this.dockerAPI.docker.getVolume(volume.Name);
          await vol.remove();
          removedVolumes.push(volume.Name);
          this.cleanupStats.volumesRemoved++;
          logger.info(`Cleaned up volume: ${volume.Name}`);
        } catch (error) {
          if (error.statusCode !== 404) {
            logger.error(`Failed to remove volume ${volume.Name}:`, error);
          }
        }
      }
      
      return { removed: removedVolumes, total: volumesToRemove.length };
    } catch (error) {
      logger.error('Failed to cleanup volumes:', error);
      return { removed: [], total: 0 };
    }
  }

  /**
   * Clean up unused images
   */
  async cleanupImages() {
    if (!this.config.enableImageCleanup) {
      return { removed: [], total: 0 };
    }
    
    try {
      // Get dangling images
      const danglingImages = await this.dockerAPI.docker.listImages({
        filters: {
          dangling: ['true']
        }
      });
      
      const removedImages = [];
      let bytesFreed = 0;
      
      for (const imageData of danglingImages) {
        try {
          const image = this.dockerAPI.docker.getImage(imageData.Id);
          await image.remove();
          removedImages.push(imageData.Id);
          bytesFreed += imageData.Size || 0;
          this.cleanupStats.imagesRemoved++;
          logger.debug(`Cleaned up dangling image: ${imageData.Id.substring(0, 12)}`);
        } catch (error) {
          if (error.statusCode !== 404 && error.statusCode !== 409) {
            logger.error(`Failed to remove image ${imageData.Id}:`, error);
          }
        }
      }
      
      this.cleanupStats.bytesFreed += bytesFreed;
      
      if (removedImages.length > 0) {
        logger.info(`Cleaned up ${removedImages.length} dangling images, freed ${this.formatBytes(bytesFreed)}`);
      }
      
      return { removed: removedImages, total: danglingImages.length, bytesFreed };
    } catch (error) {
      logger.error('Failed to cleanup images:', error);
      return { removed: [], total: 0, bytesFreed: 0 };
    }
  }

  /**
   * Clean up old log files
   */
  async cleanupLogs() {
    try {
      const logDir = path.join(process.cwd(), 'logs');
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.logRetentionDays);
      
      try {
        const files = await fs.readdir(logDir);
        const removedLogs = [];
        
        for (const file of files) {
          const filePath = path.join(logDir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.isFile() && stats.mtime < cutoffDate) {
            await fs.unlink(filePath);
            removedLogs.push(file);
            logger.debug(`Cleaned up old log file: ${file}`);
          }
        }
        
        if (removedLogs.length > 0) {
          logger.info(`Cleaned up ${removedLogs.length} old log files`);
        }
        
        return { removed: removedLogs, total: files.length };
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        return { removed: [], total: 0 };
      }
    } catch (error) {
      logger.error('Failed to cleanup logs:', error);
      return { removed: [], total: 0 };
    }
  }

  /**
   * Clean up old metrics data
   */
  async cleanupMetrics() {
    if (!this.config.enableMetricsCleanup) {
      return { cleaned: false };
    }
    
    try {
      // This would integrate with your monitoring system
      // For now, we'll just clean up in-memory metrics
      const cutoffTime = new Date(Date.now() - (this.config.logRetentionDays * 86400000));
      
      // Clean up error logs in cleanup stats
      this.cleanupStats.errors = this.cleanupStats.errors.filter(error => 
        !error.timestamp || error.timestamp > cutoffTime
      );
      
      logger.debug('Cleaned up old metrics data');
      return { cleaned: true };
    } catch (error) {
      logger.error('Failed to cleanup metrics:', error);
      return { cleaned: false };
    }
  }

  /**
   * Force cleanup of specific container
   */
  async forceCleanupContainer(jobId) {
    try {
      logger.info(`Force cleaning up container: ${jobId}`);
      
      // Stop container
      try {
        await this.dockerAPI.stopContainer(jobId, 0); // Immediate stop
      } catch (error) {
        logger.debug(`Container ${jobId} already stopped or not found`);
      }
      
      // Remove container
      await this.dockerAPI.removeContainer(jobId, true);
      
      // Clean up lifecycle data
      const lifecycle = this.lifecycleManager.getLifecycle(jobId);
      if (lifecycle) {
        this.lifecycleManager.lifecycles.delete(jobId);
      }
      
      this.cleanupStats.containersRemoved++;
      logger.info(`Force cleanup completed for container: ${jobId}`);
      
      return true;
    } catch (error) {
      logger.error(`Force cleanup failed for container ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Emergency cleanup - remove all containers
   */
  async emergencyCleanup() {
    logger.warn('Performing emergency cleanup - removing all containers');
    
    try {
      const allContainers = this.dockerAPI.getActiveContainers();
      const cleanupPromises = allContainers.map(container => 
        this.forceCleanupContainer(container.jobId).catch(err => 
          logger.error(`Emergency cleanup failed for ${container.jobId}:`, err)
        )
      );
      
      await Promise.all(cleanupPromises);
      
      // Clean up Docker system
      await this.dockerAPI.docker.pruneContainers({
        filters: {
          label: ['github-runner=true']
        }
      });
      
      logger.info('Emergency cleanup completed');
      this.emit('emergencyCleanupCompleted', { containersRemoved: allContainers.length });
      
      return true;
    } catch (error) {
      logger.error('Emergency cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Get cleanup statistics
   */
  getCleanupStats() {
    return {
      ...this.cleanupStats,
      uptime: this.isRunning ? Date.now() - (this.cleanupStats.lastCleanupAt || Date.now()) : 0,
      nextCleanupIn: this.isRunning ? this.config.cleanupInterval : null,
      errorRate: this.cleanupStats.totalCleanupRuns > 0 
        ? (this.cleanupStats.errors.length / this.cleanupStats.totalCleanupRuns) * 100 
        : 0
    };
  }

  /**
   * Get detailed cleanup report
   */
  getCleanupReport() {
    const stats = this.getCleanupStats();
    
    return {
      overview: {
        status: this.isRunning ? 'active' : 'stopped',
        totalRuns: stats.totalCleanupRuns,
        lastCleanup: stats.lastCleanupAt,
        errorRate: `${stats.errorRate.toFixed(2)}%`
      },
      resources: {
        containersRemoved: stats.containersRemoved,
        volumesRemoved: stats.volumesRemoved,
        imagesRemoved: stats.imagesRemoved,
        diskSpaceFreed: this.formatBytes(stats.bytesFreed)
      },
      configuration: {
        cleanupInterval: `${this.config.cleanupInterval / 1000}s`,
        maxContainerAge: `${this.config.maxContainerAge / 1000}s`,
        logRetentionDays: this.config.logRetentionDays,
        enabledFeatures: {
          volumeCleanup: this.config.enableVolumeCleanup,
          imageCleanup: this.config.enableImageCleanup,
          metricsCleanup: this.config.enableMetricsCleanup
        }
      },
      recentErrors: stats.errors.slice(-5) // Last 5 errors
    };
  }

  /**
   * Format bytes to human readable format
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Validate cleanup configuration
   */
  validateConfig() {
    const errors = [];
    
    if (this.config.cleanupInterval < 60000) { // 1 minute minimum
      errors.push('Cleanup interval too short (minimum 1 minute)');
    }
    
    if (this.config.maxContainerAge < 300000) { // 5 minutes minimum
      errors.push('Max container age too short (minimum 5 minutes)');
    }
    
    if (this.config.logRetentionDays < 1) {
      errors.push('Log retention must be at least 1 day');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = ContainerCleanupManager;