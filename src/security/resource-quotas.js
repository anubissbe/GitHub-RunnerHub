/**
 * Resource Quotas and Limits System
 * Enforces resource limits and quotas for containers and jobs to prevent resource abuse
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class ResourceQuotaManager extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.config = {
      // Default resource limits
      defaultLimits: {
        cpu: options.defaultCpuLimit || 2.0, // 2 CPU cores
        memory: options.defaultMemoryLimit || 4096, // 4GB in MB
        disk: options.defaultDiskLimit || 10240, // 10GB in MB
        swap: options.defaultSwapLimit || 2048, // 2GB in MB
        networkBandwidth: options.defaultNetworkLimit || '100m', // 100 Mbps
        processes: options.defaultProcessLimit || 1024,
        fileDescriptors: options.defaultFdLimit || 4096
      },
      
      // Quota enforcement modes
      enforcementMode: options.enforcementMode || 'strict', // 'strict', 'warn', 'monitor'
      gracePeriod: options.gracePeriod || 30000, // 30 seconds
      
      // Repository-specific limits
      repositoryLimits: options.repositoryLimits || new Map(),
      
      // Job type limits
      jobTypeLimits: options.jobTypeLimits || {
        'build': { cpu: 4.0, memory: 8192, disk: 20480 },
        'test': { cpu: 2.0, memory: 4096, disk: 10240 },
        'deploy': { cpu: 1.0, memory: 2048, disk: 5120 },
        'security-scan': { cpu: 2.0, memory: 4096, disk: 15360 }
      },
      
      // Time-based quotas
      timeBasedQuotas: {
        enabled: options.enableTimeQuotas !== false,
        maxJobDuration: options.maxJobDuration || 3600000, // 1 hour
        maxConcurrentJobs: options.maxConcurrentJobs || 10,
        cooldownPeriod: options.cooldownPeriod || 300000 // 5 minutes
      },
      
      // Resource monitoring
      monitoring: {
        interval: options.monitoringInterval || 10000, // 10 seconds
        alertThreshold: options.alertThreshold || 0.9, // 90%
        enablePredictiveScaling: options.enablePredictiveScaling || false
      },
      
      ...options
    };
    
    // Resource tracking
    this.activeAllocations = new Map(); // containerId -> allocation
    this.jobAllocations = new Map(); // jobId -> totalAllocation
    this.repositoryUsage = new Map(); // repository -> usage stats
    this.quotaViolations = new Map(); // containerId -> violations
    
    // Resource pools
    this.resourcePools = new Map(); // poolId -> pool
    this.totalResources = {
      cpu: options.totalCpu || 16,
      memory: options.totalMemory || 32768, // 32GB
      disk: options.totalDisk || 1048576 // 1TB
    };
    
    // Monitoring state
    this.monitoringTimer = null;
    this.resourceHistory = new Map(); // containerId -> history
    
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
      
      // Create default resource pools
      await this.createDefaultPools();
      
      // Load repository-specific limits
      await this.loadRepositoryLimits();
      
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
  async allocateResources(containerId, jobId, requirements = {}) {
    try {
      if (!this.isInitialized) {
        throw new Error('Resource Quota Manager not initialized');
      }
      
      logger.info(`Allocating resources for container ${containerId} (job ${jobId})`);
      
      // Determine resource requirements
      const resourceReq = await this.calculateResourceRequirements(jobId, requirements);
      
      // Check resource availability
      await this.checkResourceAvailability(resourceReq);
      
      // Check quotas
      await this.checkQuotas(jobId, resourceReq);
      
      // Allocate resources
      const allocation = await this.performAllocation(containerId, jobId, resourceReq);
      
      // Apply resource limits to container
      await this.applyResourceLimits(containerId, allocation);
      
      // Track allocation
      this.trackAllocation(containerId, jobId, allocation);
      
      this.emit('resourcesAllocated', {
        containerId,
        jobId,
        allocation
      });
      
      logger.info(`Allocated resources for container ${containerId}:`, allocation);
      return allocation;
      
    } catch (error) {
      logger.error(`Failed to allocate resources for container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Release resources for a container
   */
  async releaseResources(containerId) {
    try {
      const allocation = this.activeAllocations.get(containerId);
      if (!allocation) {
        logger.warn(`No allocation found for container ${containerId}`);
        return;
      }
      
      logger.info(`Releasing resources for container ${containerId}`);
      
      // Update job allocation tracking
      const jobAllocation = this.jobAllocations.get(allocation.jobId);
      if (jobAllocation) {
        jobAllocation.cpu -= allocation.cpu;
        jobAllocation.memory -= allocation.memory;
        jobAllocation.disk -= allocation.disk;
        jobAllocation.activeContainers--;
        
        if (jobAllocation.activeContainers <= 0) {
          this.jobAllocations.delete(allocation.jobId);
        }
      }
      
      // Release from resource pools
      await this.releaseFromPools(allocation);
      
      // Clean up tracking
      this.activeAllocations.delete(containerId);
      this.resourceHistory.delete(containerId);
      this.quotaViolations.delete(containerId);
      
      this.emit('resourcesReleased', {
        containerId,
        jobId: allocation.jobId,
        allocation
      });
      
      logger.info(`Released resources for container ${containerId}`);
      
    } catch (error) {
      logger.error(`Failed to release resources for container ${containerId}:`, error);
    }
  }

  /**
   * Calculate resource requirements for a job
   */
  async calculateResourceRequirements(jobId, userRequirements) {
    const requirements = { ...this.config.defaultLimits };
    
    // Apply job type specific limits
    if (userRequirements.jobType && this.config.jobTypeLimits[userRequirements.jobType]) {
      Object.assign(requirements, this.config.jobTypeLimits[userRequirements.jobType]);
    }
    
    // Apply repository specific limits
    if (userRequirements.repository) {
      const repoLimits = this.config.repositoryLimits.get(userRequirements.repository);
      if (repoLimits) {
        Object.assign(requirements, repoLimits);
      }
    }
    
    // Apply user requirements (with validation)
    if (userRequirements.cpu) {
      requirements.cpu = Math.min(userRequirements.cpu, requirements.cpu);
    }
    if (userRequirements.memory) {
      requirements.memory = Math.min(userRequirements.memory, requirements.memory);
    }
    if (userRequirements.disk) {
      requirements.disk = Math.min(userRequirements.disk, requirements.disk);
    }
    
    return requirements;
  }

  /**
   * Check resource availability
   */
  async checkResourceAvailability(requirements) {
    const currentUsage = this.getCurrentResourceUsage();
    
    const availableResources = {
      cpu: this.totalResources.cpu - currentUsage.cpu,
      memory: this.totalResources.memory - currentUsage.memory,
      disk: this.totalResources.disk - currentUsage.disk
    };
    
    if (requirements.cpu > availableResources.cpu) {
      throw new Error(`Insufficient CPU: requested ${requirements.cpu}, available ${availableResources.cpu}`);
    }
    
    if (requirements.memory > availableResources.memory) {
      throw new Error(`Insufficient memory: requested ${requirements.memory}MB, available ${availableResources.memory}MB`);
    }
    
    if (requirements.disk > availableResources.disk) {
      throw new Error(`Insufficient disk: requested ${requirements.disk}MB, available ${availableResources.disk}MB`);
    }
  }

  /**
   * Check quotas for a job
   */
  async checkQuotas(jobId, requirements) {
    // Check concurrent job limits
    if (this.config.timeBasedQuotas.enabled) {
      const activeJobs = this.jobAllocations.size;
      if (activeJobs >= this.config.timeBasedQuotas.maxConcurrentJobs) {
        throw new Error(`Maximum concurrent jobs exceeded: ${activeJobs}/${this.config.timeBasedQuotas.maxConcurrentJobs}`);
      }
    }
    
    // Check job-specific resource quotas
    const jobAllocation = this.jobAllocations.get(jobId);
    if (jobAllocation) {
      const totalCpu = jobAllocation.cpu + requirements.cpu;
      const totalMemory = jobAllocation.memory + requirements.memory;
      
      const maxJobCpu = this.config.jobTypeLimits.build?.cpu || this.config.defaultLimits.cpu;
      const maxJobMemory = this.config.jobTypeLimits.build?.memory || this.config.defaultLimits.memory;
      
      if (totalCpu > maxJobCpu * 2) { // Allow up to 2x for multi-container jobs
        throw new Error(`Job CPU quota exceeded: ${totalCpu}/${maxJobCpu * 2}`);
      }
      
      if (totalMemory > maxJobMemory * 2) {
        throw new Error(`Job memory quota exceeded: ${totalMemory}MB/${maxJobMemory * 2}MB`);
      }
    }
  }

  /**
   * Perform resource allocation
   */
  async performAllocation(containerId, jobId, requirements) {
    const allocation = {
      containerId,
      jobId,
      cpu: requirements.cpu,
      memory: requirements.memory,
      disk: requirements.disk,
      swap: requirements.swap,
      networkBandwidth: requirements.networkBandwidth,
      processes: requirements.processes,
      fileDescriptors: requirements.fileDescriptors,
      allocatedAt: new Date(),
      pool: 'default'
    };
    
    // Allocate from appropriate resource pool
    const pool = this.selectResourcePool(requirements);
    allocation.pool = pool.id;
    
    await this.allocateFromPool(pool, allocation);
    
    return allocation;
  }

  /**
   * Apply resource limits to Docker container
   */
  async applyResourceLimits(containerId, allocation) {
    try {
      // Get container info
      const container = await this.dockerAPI.getContainer(containerId);
      
      // Update container with resource limits
      await container.update({
        Memory: allocation.memory * 1024 * 1024, // Convert MB to bytes
        MemorySwap: (allocation.memory + allocation.swap) * 1024 * 1024,
        CpuPeriod: 100000, // 100ms
        CpuQuota: Math.floor(allocation.cpu * 100000), // CPU quota
        BlkioWeight: 500, // Default IO weight
        PidsLimit: allocation.processes,
        Ulimits: [
          {
            Name: 'nofile',
            Soft: allocation.fileDescriptors,
            Hard: allocation.fileDescriptors
          }
        ]
      });
      
      logger.info(`Applied resource limits to container ${containerId}`);
      
    } catch (error) {
      logger.error(`Failed to apply resource limits to container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Monitor resource usage
   */
  async monitorResourceUsage() {
    try {
      for (const [containerId, allocation] of this.activeAllocations) {
        const stats = await this.getContainerStats(containerId);
        
        if (stats) {
          // Update resource history
          this.updateResourceHistory(containerId, stats);
          
          // Check for quota violations
          await this.checkQuotaViolations(containerId, allocation, stats);
          
          // Update usage statistics
          this.updateUsageStatistics(allocation.jobId, stats);
        }
      }
      
      // Check system-wide resource usage
      await this.checkSystemResourceUsage();
      
    } catch (error) {
      logger.error('Error monitoring resource usage:', error);
    }
  }

  /**
   * Check for quota violations
   */
  async checkQuotaViolations(containerId, allocation, stats) {
    const violations = [];
    
    // Check CPU usage
    if (stats.cpu.usage > allocation.cpu * 1.1) { // 10% tolerance
      violations.push({
        type: 'cpu',
        limit: allocation.cpu,
        usage: stats.cpu.usage,
        severity: stats.cpu.usage > allocation.cpu * 1.5 ? 'critical' : 'warning'
      });
    }
    
    // Check memory usage
    if (stats.memory.usage > allocation.memory * 1024 * 1024 * 0.9) { // 90% of limit
      violations.push({
        type: 'memory',
        limit: allocation.memory,
        usage: Math.round(stats.memory.usage / 1024 / 1024),
        severity: stats.memory.usage > allocation.memory * 1024 * 1024 ? 'critical' : 'warning'
      });
    }
    
    if (violations.length > 0) {
      this.quotaViolations.set(containerId, violations);
      
      await this.handleQuotaViolations(containerId, allocation, violations);
    }
  }

  /**
   * Handle quota violations
   */
  async handleQuotaViolations(containerId, allocation, violations) {
    for (const violation of violations) {
      this.emit('quotaViolation', {
        containerId,
        jobId: allocation.jobId,
        violation
      });
      
      switch (this.config.enforcementMode) {
        case 'strict':
          if (violation.severity === 'critical') {
            logger.warn(`Critical quota violation for container ${containerId}, terminating`);
            await this.terminateContainer(containerId, 'quota_violation');
          }
          break;
          
        case 'warn':
          logger.warn(`Quota violation for container ${containerId}:`, violation);
          break;
          
        case 'monitor':
          logger.info(`Quota violation detected for container ${containerId}:`, violation);
          break;
      }
    }
  }

  /**
   * Terminate container for quota violation
   */
  async terminateContainer(containerId, reason) {
    try {
      const container = await this.dockerAPI.getContainer(containerId);
      await container.kill();
      
      this.emit('containerTerminated', {
        containerId,
        reason,
        timestamp: new Date()
      });
      
      logger.info(`Terminated container ${containerId} for ${reason}`);
      
    } catch (error) {
      logger.error(`Failed to terminate container ${containerId}:`, error);
    }
  }

  /**
   * Helper methods
   */
  
  async detectSystemResources() {
    try {
      // In a real implementation, this would detect actual system resources
      const systemInfo = await this.dockerAPI.getSystemInfo();
      
      if (systemInfo.NCPU) {
        this.totalResources.cpu = systemInfo.NCPU;
      }
      
      if (systemInfo.MemTotal) {
        this.totalResources.memory = Math.floor(systemInfo.MemTotal / 1024 / 1024);
      }
      
      logger.info('Detected system resources:', this.totalResources);
      
    } catch (error) {
      logger.warn('Failed to detect system resources, using defaults:', error);
    }
  }
  
  async createDefaultPools() {
    this.resourcePools.set('default', {
      id: 'default',
      totalCpu: this.totalResources.cpu,
      totalMemory: this.totalResources.memory,
      totalDisk: this.totalResources.disk,
      allocatedCpu: 0,
      allocatedMemory: 0,
      allocatedDisk: 0,
      containers: new Set()
    });
    
    this.resourcePools.set('high-cpu', {
      id: 'high-cpu',
      totalCpu: Math.floor(this.totalResources.cpu * 0.3),
      totalMemory: Math.floor(this.totalResources.memory * 0.2),
      totalDisk: Math.floor(this.totalResources.disk * 0.2),
      allocatedCpu: 0,
      allocatedMemory: 0,
      allocatedDisk: 0,
      containers: new Set()
    });
  }
  
  async loadRepositoryLimits() {
    // Load repository-specific limits from configuration or database
    // For now, set some examples
    this.config.repositoryLimits.set('security/scanner', {
      cpu: 1.0,
      memory: 2048,
      disk: 5120
    });
    
    this.config.repositoryLimits.set('build/heavy-project', {
      cpu: 8.0,
      memory: 16384,
      disk: 51200
    });
  }
  
  startResourceMonitoring() {
    this.monitoringTimer = setInterval(() => {
      this.monitorResourceUsage();
    }, this.config.monitoring.interval);
  }
  
  getCurrentResourceUsage() {
    let totalCpu = 0;
    let totalMemory = 0;
    let totalDisk = 0;
    
    for (const allocation of this.activeAllocations.values()) {
      totalCpu += allocation.cpu;
      totalMemory += allocation.memory;
      totalDisk += allocation.disk;
    }
    
    return { cpu: totalCpu, memory: totalMemory, disk: totalDisk };
  }
  
  selectResourcePool(requirements) {
    // Simple pool selection logic
    if (requirements.cpu > 4.0) {
      return this.resourcePools.get('high-cpu');
    }
    return this.resourcePools.get('default');
  }
  
  async allocateFromPool(pool, allocation) {
    pool.allocatedCpu += allocation.cpu;
    pool.allocatedMemory += allocation.memory;
    pool.allocatedDisk += allocation.disk;
    pool.containers.add(allocation.containerId);
  }
  
  async releaseFromPools(allocation) {
    for (const pool of this.resourcePools.values()) {
      if (pool.containers.has(allocation.containerId)) {
        pool.allocatedCpu -= allocation.cpu;
        pool.allocatedMemory -= allocation.memory;
        pool.allocatedDisk -= allocation.disk;
        pool.containers.delete(allocation.containerId);
        break;
      }
    }
  }
  
  trackAllocation(containerId, jobId, allocation) {
    this.activeAllocations.set(containerId, allocation);
    
    // Update job allocation tracking
    if (!this.jobAllocations.has(jobId)) {
      this.jobAllocations.set(jobId, {
        jobId,
        cpu: 0,
        memory: 0,
        disk: 0,
        activeContainers: 0,
        startedAt: new Date()
      });
    }
    
    const jobAllocation = this.jobAllocations.get(jobId);
    jobAllocation.cpu += allocation.cpu;
    jobAllocation.memory += allocation.memory;
    jobAllocation.disk += allocation.disk;
    jobAllocation.activeContainers++;
  }
  
  async getContainerStats(containerId) {
    try {
      const container = await this.dockerAPI.getContainer(containerId);
      const stats = await container.stats({ stream: false });
      
      return {
        cpu: {
          usage: this.calculateCpuUsage(stats.cpu_stats, stats.precpu_stats)
        },
        memory: {
          usage: stats.memory_stats.usage,
          limit: stats.memory_stats.limit
        },
        network: {
          rx_bytes: stats.networks?.eth0?.rx_bytes || 0,
          tx_bytes: stats.networks?.eth0?.tx_bytes || 0
        }
      };
      
    } catch (error) {
      logger.error(`Failed to get stats for container ${containerId}:`, error);
      return null;
    }
  }
  
  calculateCpuUsage(cpuStats, precpuStats) {
    const cpuDelta = cpuStats.cpu_usage.total_usage - precpuStats.cpu_usage.total_usage;
    const systemDelta = cpuStats.system_cpu_usage - precpuStats.system_cpu_usage;
    
    if (systemDelta > 0 && cpuDelta > 0) {
      return (cpuDelta / systemDelta) * cpuStats.online_cpus;
    }
    
    return 0;
  }
  
  updateResourceHistory(containerId, stats) {
    if (!this.resourceHistory.has(containerId)) {
      this.resourceHistory.set(containerId, []);
    }
    
    const history = this.resourceHistory.get(containerId);
    history.push({
      timestamp: new Date(),
      cpu: stats.cpu.usage,
      memory: stats.memory.usage,
      network: stats.network
    });
    
    // Keep only last 100 entries
    if (history.length > 100) {
      history.shift();
    }
  }
  
  updateUsageStatistics(jobId, stats) {
    // Update repository usage statistics
    // Implementation would track usage by repository for reporting
  }
  
  async checkSystemResourceUsage() {
    const usage = this.getCurrentResourceUsage();
    const cpuUsagePercent = (usage.cpu / this.totalResources.cpu) * 100;
    const memoryUsagePercent = (usage.memory / this.totalResources.memory) * 100;
    
    if (cpuUsagePercent > this.config.monitoring.alertThreshold * 100) {
      this.emit('systemResourceAlert', {
        type: 'cpu',
        usage: cpuUsagePercent,
        threshold: this.config.monitoring.alertThreshold * 100
      });
    }
    
    if (memoryUsagePercent > this.config.monitoring.alertThreshold * 100) {
      this.emit('systemResourceAlert', {
        type: 'memory',
        usage: memoryUsagePercent,
        threshold: this.config.monitoring.alertThreshold * 100
      });
    }
  }

  /**
   * Get resource quota status
   */
  getQuotaStatus() {
    const currentUsage = this.getCurrentResourceUsage();
    
    return {
      totalResources: this.totalResources,
      currentUsage,
      utilization: {
        cpu: (currentUsage.cpu / this.totalResources.cpu) * 100,
        memory: (currentUsage.memory / this.totalResources.memory) * 100,
        disk: (currentUsage.disk / this.totalResources.disk) * 100
      },
      activeAllocations: this.activeAllocations.size,
      activeJobs: this.jobAllocations.size,
      quotaViolations: this.quotaViolations.size,
      resourcePools: Array.from(this.resourcePools.values()).map(pool => ({
        id: pool.id,
        utilization: {
          cpu: (pool.allocatedCpu / pool.totalCpu) * 100,
          memory: (pool.allocatedMemory / pool.totalMemory) * 100
        },
        containers: pool.containers.size
      }))
    };
  }

  /**
   * Stop resource quota manager
   */
  async stop() {
    logger.info('Stopping Resource Quota Manager');
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }
    
    this.emit('stopped');
    logger.info('Resource Quota Manager stopped');
  }
}

module.exports = ResourceQuotaManager;