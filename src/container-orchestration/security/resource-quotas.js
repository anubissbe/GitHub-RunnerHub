/**
 * Resource Quota Manager
 * Manages and enforces resource quotas and limits for GitHub Runner containers
 * ensuring fair resource allocation and preventing resource exhaustion attacks
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class ResourceQuotaManager extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.docker = dockerAPI.docker;
    
    this.config = {
      // Default resource limits
      defaultLimits: {
        cpu: options.defaultCpuLimit || '1.0', // 1 CPU core
        memory: options.defaultMemoryLimit || '2147483648', // 2GB
        memorySwap: options.defaultMemorySwap || '4294967296', // 4GB
        cpuPeriod: options.cpuPeriod || 100000, // 100ms
        cpuQuota: options.cpuQuota || 100000, // 100% of period
        pidsLimit: options.pidsLimit || 1000, // Max processes
        diskQuota: options.diskQuota || '10737418240', // 10GB
        networkBandwidth: options.networkBandwidth || '104857600' // 100Mbps
      },
      
      // Repository-specific quotas
      repositoryQuotas: options.repositoryQuotas || new Map(),
      
      // Organization-wide quotas
      organizationQuotas: options.organizationQuotas || new Map(),
      
      // Resource allocation strategy
      allocationStrategy: options.allocationStrategy || 'fair', // 'fair', 'priority', 'burst'
      overCommitRatio: options.overCommitRatio || 1.2, // Allow 20% overcommit
      
      // Monitoring settings
      monitoringInterval: options.monitoringInterval || 30000, // 30 seconds
      enforceHardLimits: options.enforceHardLimits !== false,
      enableBurstMode: options.enableBurstMode || false,
      
      // Alert thresholds
      alertThresholds: {
        cpu: options.cpuAlertThreshold || 0.9, // 90%
        memory: options.memoryAlertThreshold || 0.85, // 85%
        disk: options.diskAlertThreshold || 0.8 // 80%
      },
      
      ...options
    };
    
    // Resource tracking
    this.containerResources = new Map(); // containerId -> resourceUsage
    this.quotaAllocations = new Map(); // jobId -> quotaAllocation
    this.resourcePools = new Map(); // resourceType -> availableAmount
    
    // Usage statistics
    this.usageHistory = [];
    this.quotaViolations = [];
    
    // System resources
    this.systemResources = {
      totalCpu: 0,
      totalMemory: 0,
      totalDisk: 0,
      availableCpu: 0,
      availableMemory: 0,
      availableDisk: 0
    };
    
    // Monitoring
    this.monitoringTimer = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the resource quota manager
   */
  async initialize() {
    try {
      logger.info('Initializing Resource Quota Manager');
      
      // Detect system resources
      await this.detectSystemResources();
      
      // Initialize resource pools
      this.initializeResourcePools();
      
      // Load saved quotas if available
      await this.loadQuotaConfigurations();
      
      // Start resource monitoring
      this.startResourceMonitoring();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Resource Quota Manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Resource Quota Manager:', error);
      throw error;
    }
  }

  /**
   * Allocate resources for a container
   */
  async allocateResources(jobId, jobConfig = {}) {
    try {
      logger.info(`Allocating resources for job ${jobId}`);
      
      // Determine applicable quota
      const quota = this.determineQuota(jobConfig);
      
      // Check resource availability
      const available = await this.checkResourceAvailability(quota);
      if (!available) {
        throw new Error('Insufficient resources available');
      }
      
      // Reserve resources
      const allocation = await this.reserveResources(jobId, quota);
      
      // Store allocation
      this.quotaAllocations.set(jobId, allocation);
      
      // Emit allocation event
      this.emit('resourcesAllocated', {
        jobId,
        allocation,
        repository: jobConfig.repository
      });
      
      // Audit log
      this.auditResourceAction('allocate', jobId, allocation);
      
      return allocation;
      
    } catch (error) {
      logger.error(`Failed to allocate resources for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Apply resource limits to a container
   */
  async applyResourceLimits(containerId, jobId) {
    try {
      const allocation = this.quotaAllocations.get(jobId);
      if (!allocation) {
        throw new Error(`No resource allocation found for job ${jobId}`);
      }
      
      logger.info(`Applying resource limits to container ${containerId}`);
      
      const container = this.docker.getContainer(containerId);
      
      // Update container with resource limits
      await container.update({
        // CPU limits
        CpuShares: this.calculateCpuShares(allocation.cpu),
        CpuPeriod: this.config.defaultLimits.cpuPeriod,
        CpuQuota: Math.floor(allocation.cpu * this.config.defaultLimits.cpuQuota),
        CpusetCpus: allocation.cpuSet || '', // Specific CPU cores if pinned
        
        // Memory limits
        Memory: parseInt(allocation.memory),
        MemorySwap: parseInt(allocation.memorySwap),
        MemoryReservation: Math.floor(parseInt(allocation.memory) * 0.8), // 80% soft limit
        
        // Process limits
        PidsLimit: allocation.pidsLimit,
        
        // I/O limits
        BlkioWeight: allocation.blkioWeight || 500, // Default weight
        
        // Restart policy
        RestartPolicy: {
          Name: 'on-failure',
          MaximumRetryCount: 3
        }
      });
      
      // Apply disk quota if supported
      if (allocation.diskQuota) {
        await this.applyDiskQuota(containerId, allocation.diskQuota);
      }
      
      // Apply network bandwidth limits
      if (allocation.networkBandwidth) {
        await this.applyNetworkBandwidth(containerId, allocation.networkBandwidth);
      }
      
      // Track container resources
      this.trackContainerResources(containerId, jobId, allocation);
      
      // Emit limits applied event
      this.emit('limitsApplied', {
        containerId,
        jobId,
        limits: allocation
      });
      
      // Audit log
      this.auditResourceAction('apply_limits', jobId, {
        containerId,
        limits: allocation
      });
      
      return true;
      
    } catch (error) {
      logger.error(`Failed to apply resource limits to container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Monitor container resource usage
   */
  async monitorContainerResources(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });
      
      // Calculate resource usage
      const usage = {
        cpu: this.calculateCpuUsage(stats),
        memory: stats.memory_stats.usage || 0,
        memoryPercent: this.calculateMemoryPercent(stats),
        diskIo: {
          read: stats.blkio_stats?.io_service_bytes_recursive?.[0]?.value || 0,
          write: stats.blkio_stats?.io_service_bytes_recursive?.[1]?.value || 0
        },
        networkIo: {
          rx: stats.networks?.eth0?.rx_bytes || 0,
          tx: stats.networks?.eth0?.tx_bytes || 0
        },
        pids: stats.pids_stats?.current || 0,
        timestamp: new Date()
      };
      
      // Update tracking
      this.containerResources.set(containerId, usage);
      
      // Check for quota violations
      await this.checkQuotaViolations(containerId, usage);
      
      // Check alert thresholds
      await this.checkResourceAlerts(containerId, usage);
      
      return usage;
      
    } catch (error) {
      logger.error(`Failed to monitor resources for container ${containerId}:`, error);
      return null;
    }
  }

  /**
   * Release allocated resources
   */
  async releaseResources(jobId) {
    try {
      const allocation = this.quotaAllocations.get(jobId);
      if (!allocation) {
        logger.warn(`No resource allocation found for job ${jobId}`);
        return;
      }
      
      logger.info(`Releasing resources for job ${jobId}`);
      
      // Return resources to pools
      this.returnResourcesToPool(allocation);
      
      // Remove allocation
      this.quotaAllocations.delete(jobId);
      
      // Clean up container tracking
      for (const [containerId, data] of this.containerResources.entries()) {
        if (data.jobId === jobId) {
          this.containerResources.delete(containerId);
        }
      }
      
      // Emit release event
      this.emit('resourcesReleased', {
        jobId,
        allocation
      });
      
      // Audit log
      this.auditResourceAction('release', jobId, allocation);
      
    } catch (error) {
      logger.error(`Failed to release resources for job ${jobId}:`, error);
    }
  }

  /**
   * Determine applicable quota for a job
   */
  determineQuota(jobConfig) {
    let quota = { ...this.config.defaultLimits };
    
    // Check repository-specific quota
    if (jobConfig.repository) {
      const repoQuota = this.config.repositoryQuotas.get(jobConfig.repository);
      if (repoQuota) {
        quota = { ...quota, ...repoQuota };
      }
    }
    
    // Check organization quota
    if (jobConfig.organization) {
      const orgQuota = this.config.organizationQuotas.get(jobConfig.organization);
      if (orgQuota) {
        quota = { ...quota, ...orgQuota };
      }
    }
    
    // Apply job-specific overrides
    if (jobConfig.resourceLimits) {
      quota = { ...quota, ...jobConfig.resourceLimits };
    }
    
    // Apply burst mode if enabled
    if (this.config.enableBurstMode && jobConfig.burstable) {
      quota = this.applyBurstQuota(quota);
    }
    
    return quota;
  }

  /**
   * Check resource availability
   */
  async checkResourceAvailability(quota) {
    const requiredCpu = parseFloat(quota.cpu);
    const requiredMemory = parseInt(quota.memory);
    const requiredDisk = parseInt(quota.diskQuota || '0');
    
    // Check against available resources
    const cpuAvailable = this.resourcePools.get('cpu') || 0;
    const memoryAvailable = this.resourcePools.get('memory') || 0;
    const diskAvailable = this.resourcePools.get('disk') || 0;
    
    // Consider overcommit ratio
    const effectiveCpuAvailable = cpuAvailable * this.config.overCommitRatio;
    const effectiveMemoryAvailable = memoryAvailable * this.config.overCommitRatio;
    
    if (requiredCpu > effectiveCpuAvailable) {
      logger.warn(`Insufficient CPU: required ${requiredCpu}, available ${effectiveCpuAvailable}`);
      return false;
    }
    
    if (requiredMemory > effectiveMemoryAvailable) {
      logger.warn(`Insufficient memory: required ${requiredMemory}, available ${effectiveMemoryAvailable}`);
      return false;
    }
    
    if (requiredDisk > diskAvailable) {
      logger.warn(`Insufficient disk: required ${requiredDisk}, available ${diskAvailable}`);
      return false;
    }
    
    return true;
  }

  /**
   * Reserve resources from pools
   */
  async reserveResources(jobId, quota) {
    const allocation = {
      jobId,
      cpu: parseFloat(quota.cpu),
      memory: quota.memory,
      memorySwap: quota.memorySwap,
      diskQuota: quota.diskQuota,
      networkBandwidth: quota.networkBandwidth,
      pidsLimit: quota.pidsLimit,
      allocatedAt: new Date(),
      status: 'active'
    };
    
    // Deduct from resource pools
    const currentCpu = this.resourcePools.get('cpu') || 0;
    const currentMemory = this.resourcePools.get('memory') || 0;
    const currentDisk = this.resourcePools.get('disk') || 0;
    
    this.resourcePools.set('cpu', currentCpu - allocation.cpu);
    this.resourcePools.set('memory', currentMemory - parseInt(allocation.memory));
    this.resourcePools.set('disk', currentDisk - parseInt(allocation.diskQuota || '0'));
    
    logger.debug(`Reserved resources for job ${jobId}:`, allocation);
    
    return allocation;
  }

  /**
   * Return resources to pools
   */
  returnResourcesToPool(allocation) {
    const currentCpu = this.resourcePools.get('cpu') || 0;
    const currentMemory = this.resourcePools.get('memory') || 0;
    const currentDisk = this.resourcePools.get('disk') || 0;
    
    this.resourcePools.set('cpu', currentCpu + allocation.cpu);
    this.resourcePools.set('memory', currentMemory + parseInt(allocation.memory));
    this.resourcePools.set('disk', currentDisk + parseInt(allocation.diskQuota || '0'));
    
    logger.debug(`Returned resources to pool:`, allocation);
  }

  /**
   * Apply burst quota
   */
  applyBurstQuota(quota) {
    return {
      ...quota,
      cpu: (parseFloat(quota.cpu) * 1.5).toString(), // 50% burst
      memory: (parseInt(quota.memory) * 1.2).toString(), // 20% burst
      burstDuration: 300000 // 5 minutes
    };
  }

  /**
   * Calculate CPU shares from CPU limit
   */
  calculateCpuShares(cpuLimit) {
    // Docker uses 1024 shares as baseline for 1 CPU
    return Math.floor(parseFloat(cpuLimit) * 1024);
  }

  /**
   * Calculate CPU usage percentage
   */
  calculateCpuUsage(stats) {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || 1;
    
    if (systemDelta > 0) {
      return (cpuDelta / systemDelta) * cpuCount * 100;
    }
    
    return 0;
  }

  /**
   * Calculate memory usage percentage
   */
  calculateMemoryPercent(stats) {
    const usage = stats.memory_stats.usage || 0;
    const limit = stats.memory_stats.limit || 1;
    return (usage / limit) * 100;
  }

  /**
   * Apply disk quota to container
   */
  async applyDiskQuota(containerId, diskQuota) {
    // This would integrate with filesystem quotas (XFS, ext4)
    // For now, we'll track the quota
    
    logger.debug(`Applied disk quota ${diskQuota} to container ${containerId}`);
  }

  /**
   * Apply network bandwidth limits
   */
  async applyNetworkBandwidth(containerId, bandwidth) {
    // This would integrate with tc (traffic control)
    // For now, we'll track the limit
    
    logger.debug(`Applied bandwidth limit ${bandwidth} to container ${containerId}`);
  }

  /**
   * Track container resources
   */
  trackContainerResources(containerId, jobId, allocation) {
    this.containerResources.set(containerId, {
      jobId,
      allocation,
      startTime: new Date(),
      usage: {
        cpu: 0,
        memory: 0,
        diskIo: { read: 0, write: 0 },
        networkIo: { rx: 0, tx: 0 }
      }
    });
  }

  /**
   * Check for quota violations
   */
  async checkQuotaViolations(containerId, usage) {
    const resourceData = this.containerResources.get(containerId);
    if (!resourceData) return;
    
    const allocation = resourceData.allocation;
    const violations = [];
    
    // Check CPU violation
    if (usage.cpu > parseFloat(allocation.cpu) * 100) {
      violations.push({
        type: 'cpu',
        actual: usage.cpu,
        limit: parseFloat(allocation.cpu) * 100,
        severity: 'high'
      });
    }
    
    // Check memory violation
    if (usage.memory > parseInt(allocation.memory)) {
      violations.push({
        type: 'memory',
        actual: usage.memory,
        limit: parseInt(allocation.memory),
        severity: 'critical'
      });
    }
    
    // Check process limit violation
    if (usage.pids > allocation.pidsLimit) {
      violations.push({
        type: 'pids',
        actual: usage.pids,
        limit: allocation.pidsLimit,
        severity: 'medium'
      });
    }
    
    if (violations.length > 0) {
      await this.handleQuotaViolations(containerId, violations);
    }
  }

  /**
   * Handle quota violations
   */
  async handleQuotaViolations(containerId, violations) {
    for (const violation of violations) {
      logger.warn(`Quota violation in container ${containerId}:`, violation);
      
      // Record violation
      this.quotaViolations.push({
        containerId,
        violation,
        timestamp: new Date()
      });
      
      // Take action based on severity
      if (violation.severity === 'critical' && this.config.enforceHardLimits) {
        // Container will be killed by Docker if it exceeds memory limit
        logger.error(`Critical quota violation in container ${containerId}`);
      }
      
      // Emit violation event
      this.emit('quotaViolation', {
        containerId,
        violation
      });
    }
  }

  /**
   * Check resource alerts
   */
  async checkResourceAlerts(containerId, usage) {
    const resourceData = this.containerResources.get(containerId);
    if (!resourceData) return;
    
    const allocation = resourceData.allocation;
    
    // Check CPU alert
    const cpuPercent = usage.cpu / (parseFloat(allocation.cpu) * 100);
    if (cpuPercent > this.config.alertThresholds.cpu) {
      this.emit('resourceAlert', {
        containerId,
        type: 'cpu',
        usage: cpuPercent,
        threshold: this.config.alertThresholds.cpu
      });
    }
    
    // Check memory alert
    const memoryPercent = usage.memory / parseInt(allocation.memory);
    if (memoryPercent > this.config.alertThresholds.memory) {
      this.emit('resourceAlert', {
        containerId,
        type: 'memory',
        usage: memoryPercent,
        threshold: this.config.alertThresholds.memory
      });
    }
  }

  /**
   * Detect system resources
   */
  async detectSystemResources() {
    try {
      const info = await this.docker.info();
      
      this.systemResources = {
        totalCpu: info.NCPU || 1,
        totalMemory: info.MemTotal || 0,
        totalDisk: await this.getSystemDiskSpace(),
        availableCpu: info.NCPU || 1,
        availableMemory: info.MemTotal || 0,
        availableDisk: await this.getSystemDiskSpace()
      };
      
      logger.info('System resources detected:', {
        cpu: this.systemResources.totalCpu,
        memory: `${Math.round(this.systemResources.totalMemory / 1073741824)}GB`,
        disk: `${Math.round(this.systemResources.totalDisk / 1073741824)}GB`
      });
      
    } catch (error) {
      logger.error('Failed to detect system resources:', error);
      
      // Use defaults
      this.systemResources = {
        totalCpu: 4,
        totalMemory: 8589934592, // 8GB
        totalDisk: 107374182400, // 100GB
        availableCpu: 4,
        availableMemory: 8589934592,
        availableDisk: 107374182400
      };
    }
  }

  /**
   * Get system disk space
   */
  async getSystemDiskSpace() {
    // This would use df or similar command
    // For now, return a default value
    return 107374182400; // 100GB
  }

  /**
   * Initialize resource pools
   */
  initializeResourcePools() {
    // Initialize with 80% of system resources (leave 20% for system)
    this.resourcePools.set('cpu', this.systemResources.totalCpu * 0.8);
    this.resourcePools.set('memory', this.systemResources.totalMemory * 0.8);
    this.resourcePools.set('disk', this.systemResources.totalDisk * 0.8);
    
    logger.debug('Resource pools initialized');
  }

  /**
   * Load quota configurations
   */
  async loadQuotaConfigurations() {
    // This would load from a configuration file or database
    // For now, we'll set some example quotas
    
    // Example repository quotas
    this.config.repositoryQuotas.set('high-priority-repo', {
      cpu: '2.0',
      memory: '4294967296', // 4GB
      diskQuota: '21474836480', // 20GB
      priority: 'high'
    });
    
    // Example organization quotas
    this.config.organizationQuotas.set('premium-org', {
      cpu: '4.0',
      memory: '8589934592', // 8GB
      diskQuota: '53687091200', // 50GB
      priority: 'premium'
    });
  }

  /**
   * Start resource monitoring
   */
  startResourceMonitoring() {
    this.monitoringTimer = setInterval(async () => {
      try {
        // Monitor all tracked containers
        for (const [containerId] of this.containerResources.entries()) {
          await this.monitorContainerResources(containerId);
        }
        
        // Update usage history
        this.updateUsageHistory();
        
        // Check system resource health
        await this.checkSystemResourceHealth();
        
      } catch (error) {
        logger.error('Resource monitoring cycle failed:', error);
      }
    }, this.config.monitoringInterval);
  }

  /**
   * Update usage history
   */
  updateUsageHistory() {
    const snapshot = {
      timestamp: new Date(),
      totalAllocated: {
        cpu: 0,
        memory: 0,
        disk: 0
      },
      totalUsed: {
        cpu: 0,
        memory: 0,
        disk: 0
      },
      containerCount: this.containerResources.size
    };
    
    // Calculate totals
    for (const [, data] of this.containerResources.entries()) {
      snapshot.totalAllocated.cpu += data.allocation.cpu;
      snapshot.totalAllocated.memory += parseInt(data.allocation.memory);
      snapshot.totalAllocated.disk += parseInt(data.allocation.diskQuota || '0');
      
      if (data.usage) {
        snapshot.totalUsed.cpu += data.usage.cpu / 100; // Convert percentage to cores
        snapshot.totalUsed.memory += data.usage.memory;
        snapshot.totalUsed.disk += data.usage.diskIo.read + data.usage.diskIo.write;
      }
    }
    
    this.usageHistory.push(snapshot);
    
    // Keep only last 24 hours
    const cutoff = Date.now() - 86400000;
    this.usageHistory = this.usageHistory.filter(h => h.timestamp.getTime() > cutoff);
  }

  /**
   * Check system resource health
   */
  async checkSystemResourceHealth() {
    const cpuUsage = 1 - (this.resourcePools.get('cpu') / (this.systemResources.totalCpu * 0.8));
    const memoryUsage = 1 - (this.resourcePools.get('memory') / (this.systemResources.totalMemory * 0.8));
    const diskUsage = 1 - (this.resourcePools.get('disk') / (this.systemResources.totalDisk * 0.8));
    
    if (cpuUsage > 0.9) {
      this.emit('systemResourceAlert', {
        type: 'cpu',
        usage: cpuUsage,
        message: 'System CPU resources critically low'
      });
    }
    
    if (memoryUsage > 0.9) {
      this.emit('systemResourceAlert', {
        type: 'memory',
        usage: memoryUsage,
        message: 'System memory resources critically low'
      });
    }
    
    if (diskUsage > 0.9) {
      this.emit('systemResourceAlert', {
        type: 'disk',
        usage: diskUsage,
        message: 'System disk resources critically low'
      });
    }
  }

  /**
   * Update repository quota
   */
  updateRepositoryQuota(repository, quota) {
    this.config.repositoryQuotas.set(repository, quota);
    
    logger.info(`Updated quota for repository ${repository}:`, quota);
    
    this.emit('quotaUpdated', {
      type: 'repository',
      name: repository,
      quota
    });
  }

  /**
   * Update organization quota
   */
  updateOrganizationQuota(organization, quota) {
    this.config.organizationQuotas.set(organization, quota);
    
    logger.info(`Updated quota for organization ${organization}:`, quota);
    
    this.emit('quotaUpdated', {
      type: 'organization',
      name: organization,
      quota
    });
  }

  /**
   * Audit resource action
   */
  auditResourceAction(action, jobId, details) {
    const audit = {
      timestamp: new Date(),
      action,
      jobId,
      details,
      type: 'resource'
    };
    
    // Emit audit event
    this.emit('resourceAudit', audit);
  }

  /**
   * Get resource quota report
   */
  getResourceReport() {
    return {
      systemResources: this.systemResources,
      resourcePools: Object.fromEntries(this.resourcePools),
      activeAllocations: Array.from(this.quotaAllocations.values()),
      containerUsage: Array.from(this.containerResources.values()),
      quotaViolations: this.quotaViolations.slice(-100), // Last 100 violations
      usageHistory: this.usageHistory.slice(-50), // Last 50 snapshots
      statistics: {
        totalContainers: this.containerResources.size,
        totalAllocatedCpu: Array.from(this.quotaAllocations.values())
          .reduce((sum, a) => sum + a.cpu, 0),
        totalAllocatedMemory: Array.from(this.quotaAllocations.values())
          .reduce((sum, a) => sum + parseInt(a.memory), 0),
        averageCpuUsage: this.calculateAverageCpuUsage(),
        averageMemoryUsage: this.calculateAverageMemoryUsage()
      }
    };
  }

  /**
   * Calculate average CPU usage
   */
  calculateAverageCpuUsage() {
    const usages = Array.from(this.containerResources.values())
      .map(r => r.usage?.cpu || 0)
      .filter(u => u > 0);
    
    return usages.length > 0 
      ? usages.reduce((sum, u) => sum + u, 0) / usages.length 
      : 0;
  }

  /**
   * Calculate average memory usage
   */
  calculateAverageMemoryUsage() {
    const usages = Array.from(this.containerResources.values())
      .map(r => r.usage?.memory || 0)
      .filter(u => u > 0);
    
    return usages.length > 0 
      ? usages.reduce((sum, u) => sum + u, 0) / usages.length 
      : 0;
  }

  /**
   * Stop the resource quota manager
   */
  async stop() {
    logger.info('Stopping Resource Quota Manager');
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    // Release all allocations
    for (const jobId of this.quotaAllocations.keys()) {
      await this.releaseResources(jobId);
    }
    
    this.emit('stopped');
    logger.info('Resource Quota Manager stopped');
  }
}

module.exports = ResourceQuotaManager;