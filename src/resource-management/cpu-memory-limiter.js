/**
 * CPU and Memory Resource Limiter
 * Advanced resource control and enforcement for container workloads
 */

const EventEmitter = require('events');
const Docker = require('dockerode');
const os = require('os');
const logger = require('../utils/logger');

class CpuMemoryResourceLimiter extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // CPU limits configuration
      cpu: {
        defaultCpuShares: options.defaultCpuShares || 1024, // Relative CPU weight
        defaultCpuQuota: options.defaultCpuQuota || 100000, // Microseconds per period
        defaultCpuPeriod: options.defaultCpuPeriod || 100000, // Period in microseconds
        maxCpus: options.maxCpus || os.cpus().length,
        minCpuShares: options.minCpuShares || 2,
        maxCpuShares: options.maxCpuShares || 262144,
        enableCpuThrottling: options.enableCpuThrottling !== false
      },
      
      // Memory limits configuration
      memory: {
        defaultMemoryLimit: options.defaultMemoryLimit || '2g',
        defaultMemoryReservation: options.defaultMemoryReservation || '1g',
        minMemoryLimit: options.minMemoryLimit || '128m',
        maxMemoryLimit: options.maxMemoryLimit || '32g',
        memorySwapLimit: options.memorySwapLimit || '-1', // -1 = 2x memory limit
        kernelMemoryLimit: options.kernelMemoryLimit || null,
        enableOomKill: options.enableOomKill !== false
      },
      
      // Resource profiles
      profiles: {
        micro: {
          cpuShares: 256,
          cpuQuota: 25000,
          memoryLimit: '512m',
          memoryReservation: '256m'
        },
        small: {
          cpuShares: 512,
          cpuQuota: 50000,
          memoryLimit: '1g',
          memoryReservation: '512m'
        },
        medium: {
          cpuShares: 1024,
          cpuQuota: 100000,
          memoryLimit: '2g',
          memoryReservation: '1g'
        },
        large: {
          cpuShares: 2048,
          cpuQuota: 200000,
          memoryLimit: '4g',
          memoryReservation: '2g'
        },
        xlarge: {
          cpuShares: 4096,
          cpuQuota: 400000,
          memoryLimit: '8g',
          memoryReservation: '4g'
        },
        ...options.customProfiles
      },
      
      // Enforcement configuration
      enforcement: {
        enabled: options.enforcementEnabled !== false,
        checkInterval: options.checkInterval || 30000, // 30 seconds
        violationThreshold: options.violationThreshold || 3,
        gracePeriod: options.gracePeriod || 60000, // 1 minute
        killOnViolation: options.killOnViolation !== false,
        notifyOnViolation: options.notifyOnViolation !== false
      },
      
      // Monitoring configuration
      monitoring: {
        enabled: options.monitoringEnabled !== false,
        metricsInterval: options.metricsInterval || 15000, // 15 seconds
        retainMetrics: options.retainMetrics || 3600000, // 1 hour
        enableAlerts: options.enableAlerts !== false
      },
      
      ...options
    };
    
    // Docker client
    this.docker = new Docker();
    
    // Resource tracking
    this.containerLimits = new Map(); // containerId -> limits
    this.containerMetrics = new Map(); // containerId -> metrics history
    this.violations = new Map(); // containerId -> violation count
    
    // System resource tracking
    this.systemResources = {
      totalCpus: os.cpus().length,
      totalMemory: os.totalmem(),
      availableMemory: os.freemem(),
      allocatedCpu: 0,
      allocatedMemory: 0
    };
    
    // Statistics
    this.stats = {
      totalContainersLimited: 0,
      totalViolations: 0,
      totalEnforcements: 0,
      profileUsage: new Map(),
      avgCpuUsage: 0,
      avgMemoryUsage: 0,
      peakCpuUsage: 0,
      peakMemoryUsage: 0
    };
    
    this.enforcementTimer = null;
    this.monitoringTimer = null;
    this.isStarted = false;
  }

  /**
   * Start resource limiter
   */
  start() {
    if (this.isStarted) {
      logger.warn('CPU/Memory resource limiter already started');
      return;
    }
    
    logger.info('Starting CPU/Memory Resource Limiter');
    
    // Start enforcement checks
    if (this.config.enforcement.enabled) {
      this.enforcementTimer = setInterval(() => {
        this.enforceResourceLimits().catch(error => {
          logger.error('Resource enforcement failed:', error);
        });
      }, this.config.enforcement.checkInterval);
    }
    
    // Start monitoring
    if (this.config.monitoring.enabled) {
      this.monitoringTimer = setInterval(() => {
        this.collectResourceMetrics().catch(error => {
          logger.error('Resource monitoring failed:', error);
        });
      }, this.config.monitoring.metricsInterval);
    }
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('CPU/Memory resource limiter started');
  }

  /**
   * Stop resource limiter
   */
  stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping CPU/Memory Resource Limiter');
    
    if (this.enforcementTimer) {
      clearInterval(this.enforcementTimer);
      this.enforcementTimer = null;
    }
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('CPU/Memory resource limiter stopped');
  }

  /**
   * Apply resource limits to container
   */
  async applyResourceLimits(containerId, requirements = {}) {
    try {
      // Determine resource profile
      const profile = this.determineResourceProfile(requirements);
      
      // Calculate actual limits
      const limits = await this.calculateResourceLimits(profile, requirements);
      
      // Validate resource availability
      const validation = await this.validateResourceAvailability(limits);
      if (!validation.available) {
        throw new Error(`Insufficient resources: ${validation.reason}`);
      }
      
      // Apply limits to container
      await this.applyContainerLimits(containerId, limits);
      
      // Track limits
      this.containerLimits.set(containerId, {
        limits,
        profile: profile.name,
        appliedAt: new Date(),
        requirements,
        violations: 0
      });
      
      // Initialize metrics tracking
      this.containerMetrics.set(containerId, {
        history: [],
        current: null,
        peak: { cpu: 0, memory: 0 }
      });
      
      // Update allocated resources
      this.updateAllocatedResources(limits, 1);
      
      this.stats.totalContainersLimited++;
      this.updateProfileUsage(profile.name);
      
      logger.info(`Applied resource limits to container ${containerId.substring(0, 12)}: ${profile.name} profile`);
      
      this.emit('limitsApplied', {
        containerId,
        profile: profile.name,
        limits
      });
      
      return limits;
      
    } catch (error) {
      logger.error(`Failed to apply resource limits to container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Determine resource profile based on requirements
   */
  determineResourceProfile(requirements) {
    // Check for explicit profile
    if (requirements.profile && this.config.profiles[requirements.profile]) {
      return {
        name: requirements.profile,
        ...this.config.profiles[requirements.profile]
      };
    }
    
    // Auto-select profile based on requirements
    const requiredMemory = this.parseMemoryValue(requirements.memory || '1g');
    const requiredCpu = requirements.cpu || 1;
    
    // Find best matching profile
    let selectedProfile = null;
    let selectedName = 'medium'; // default
    
    for (const [name, profile] of Object.entries(this.config.profiles)) {
      const profileMemory = this.parseMemoryValue(profile.memoryLimit);
      const profileCpu = (profile.cpuQuota / this.config.cpu.defaultCpuPeriod);
      
      if (profileMemory >= requiredMemory && profileCpu >= requiredCpu) {
        if (!selectedProfile || profileMemory < this.parseMemoryValue(selectedProfile.memoryLimit)) {
          selectedProfile = profile;
          selectedName = name;
        }
      }
    }
    
    return {
      name: selectedName,
      ...(selectedProfile || this.config.profiles.medium)
    };
  }

  /**
   * Calculate actual resource limits
   */
  async calculateResourceLimits(profile, requirements) {
    const limits = {
      // CPU limits
      cpu: {
        shares: requirements.cpuShares || profile.cpuShares || this.config.cpu.defaultCpuShares,
        quota: requirements.cpuQuota || profile.cpuQuota || this.config.cpu.defaultCpuQuota,
        period: requirements.cpuPeriod || profile.cpuPeriod || this.config.cpu.defaultCpuPeriod,
        cpus: null, // Will be calculated
        realtimePriority: requirements.realtimePriority || 0,
        realtimeRuntime: requirements.realtimeRuntime || 0
      },
      
      // Memory limits
      memory: {
        limit: this.parseMemoryValue(requirements.memoryLimit || profile.memoryLimit || this.config.memory.defaultMemoryLimit),
        reservation: this.parseMemoryValue(requirements.memoryReservation || profile.memoryReservation || this.config.memory.defaultMemoryReservation),
        swap: null, // Will be calculated
        kernel: requirements.kernelMemory ? this.parseMemoryValue(requirements.kernelMemory) : this.config.memory.kernelMemoryLimit,
        oomKillDisable: !this.config.memory.enableOomKill
      },
      
      // Additional limits
      pids: {
        limit: requirements.pidsLimit || 4096
      },
      
      // Block I/O limits
      blkio: {
        weight: requirements.blkioWeight || 500,
        weightDevice: requirements.blkioWeightDevice || []
      }
    };
    
    // Calculate CPU count from quota/period
    limits.cpu.cpus = (limits.cpu.quota / limits.cpu.period).toFixed(2);
    
    // Calculate swap limit
    if (this.config.memory.memorySwapLimit === '-1') {
      limits.memory.swap = limits.memory.limit * 2;
    } else {
      limits.memory.swap = this.parseMemoryValue(this.config.memory.memorySwapLimit);
    }
    
    // Apply bounds
    this.applyResourceBounds(limits);
    
    return limits;
  }

  /**
   * Apply bounds to resource limits
   */
  applyResourceBounds(limits) {
    // CPU bounds
    limits.cpu.shares = Math.max(
      this.config.cpu.minCpuShares,
      Math.min(this.config.cpu.maxCpuShares, limits.cpu.shares)
    );
    
    limits.cpu.quota = Math.max(
      1000, // Minimum 1ms
      Math.min(limits.cpu.period * this.config.cpu.maxCpus, limits.cpu.quota)
    );
    
    // Memory bounds
    const minMemory = this.parseMemoryValue(this.config.memory.minMemoryLimit);
    const maxMemory = this.parseMemoryValue(this.config.memory.maxMemoryLimit);
    
    limits.memory.limit = Math.max(minMemory, Math.min(maxMemory, limits.memory.limit));
    limits.memory.reservation = Math.min(limits.memory.limit, limits.memory.reservation);
  }

  /**
   * Validate resource availability
   */
  async validateResourceAvailability(limits) {
    try {
      // Update system resources
      await this.updateSystemResources();
      
      // Calculate required resources
      const requiredCpu = parseFloat(limits.cpu.cpus);
      const requiredMemory = limits.memory.limit;
      
      // Check CPU availability
      const availableCpu = this.systemResources.totalCpus - (this.systemResources.allocatedCpu / 100);
      if (requiredCpu > availableCpu) {
        return {
          available: false,
          reason: `Insufficient CPU: required ${requiredCpu}, available ${availableCpu.toFixed(2)}`
        };
      }
      
      // Check memory availability
      const availableMemory = this.systemResources.availableMemory - limits.memory.reservation;
      if (requiredMemory > availableMemory) {
        return {
          available: false,
          reason: `Insufficient memory: required ${this.formatMemory(requiredMemory)}, available ${this.formatMemory(availableMemory)}`
        };
      }
      
      return { available: true };
      
    } catch (error) {
      logger.error('Resource availability validation failed:', error);
      return { available: false, reason: error.message };
    }
  }

  /**
   * Apply limits to container
   */
  async applyContainerLimits(containerId, limits) {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Update container with resource limits
      await container.update({
        // CPU limits
        CpuShares: limits.cpu.shares,
        CpuQuota: limits.cpu.quota,
        CpuPeriod: limits.cpu.period,
        CpuRealtimePriority: limits.cpu.realtimePriority,
        CpuRealtimeRuntime: limits.cpu.realtimeRuntime,
        CpusetCpus: limits.cpu.cpusetCpus || '',
        CpusetMems: limits.cpu.cpusetMems || '',
        
        // Memory limits
        Memory: limits.memory.limit,
        MemoryReservation: limits.memory.reservation,
        MemorySwap: limits.memory.swap,
        KernelMemory: limits.memory.kernel || 0,
        OomKillDisable: limits.memory.oomKillDisable,
        
        // Other limits
        PidsLimit: limits.pids.limit,
        BlkioWeight: limits.blkio.weight,
        BlkioWeightDevice: limits.blkio.weightDevice
      });
      
      logger.debug(`Updated container ${containerId.substring(0, 12)} with resource limits`);
      
    } catch (error) {
      logger.error(`Failed to apply container limits:`, error);
      throw error;
    }
  }

  /**
   * Remove resource limits from container
   */
  async removeResourceLimits(containerId) {
    try {
      const containerInfo = this.containerLimits.get(containerId);
      if (!containerInfo) {
        logger.warn(`No resource limits found for container ${containerId}`);
        return;
      }
      
      // Update allocated resources
      this.updateAllocatedResources(containerInfo.limits, -1);
      
      // Remove tracking
      this.containerLimits.delete(containerId);
      this.containerMetrics.delete(containerId);
      this.violations.delete(containerId);
      
      logger.info(`Removed resource limits from container ${containerId.substring(0, 12)}`);
      
      this.emit('limitsRemoved', { containerId });
      
    } catch (error) {
      logger.error(`Failed to remove resource limits:`, error);
    }
  }

  /**
   * Enforce resource limits
   */
  async enforceResourceLimits() {
    try {
      const violations = [];
      
      for (const [containerId, limitInfo] of this.containerLimits) {
        try {
          const violation = await this.checkContainerCompliance(containerId, limitInfo);
          
          if (violation) {
            violations.push(violation);
            await this.handleViolation(containerId, violation);
          }
        } catch (error) {
          logger.debug(`Failed to check compliance for container ${containerId}:`, error);
        }
      }
      
      if (violations.length > 0) {
        this.emit('violationsDetected', { violations, count: violations.length });
      }
      
    } catch (error) {
      logger.error('Resource enforcement failed:', error);
    }
  }

  /**
   * Check container compliance with limits
   */
  async checkContainerCompliance(containerId, limitInfo) {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });
      
      // Parse current usage
      const usage = this.parseContainerStats(stats);
      
      // Check CPU compliance
      const cpuLimit = parseFloat(limitInfo.limits.cpu.cpus);
      const cpuViolation = usage.cpu > (cpuLimit * 100 * 1.1); // 10% tolerance
      
      // Check memory compliance
      const memoryLimit = limitInfo.limits.memory.limit;
      const memoryViolation = usage.memory.used > (memoryLimit * 1.1); // 10% tolerance
      
      if (cpuViolation || memoryViolation) {
        return {
          containerId,
          timestamp: new Date(),
          violations: {
            cpu: cpuViolation ? { limit: cpuLimit * 100, usage: usage.cpu } : null,
            memory: memoryViolation ? { limit: memoryLimit, usage: usage.memory.used } : null
          },
          usage
        };
      }
      
      return null;
      
    } catch (error) {
      logger.debug(`Compliance check failed for container ${containerId}:`, error);
      return null;
    }
  }

  /**
   * Handle resource violation
   */
  async handleViolation(containerId, violation) {
    try {
      // Track violation
      const violationCount = (this.violations.get(containerId) || 0) + 1;
      this.violations.set(containerId, violationCount);
      
      this.stats.totalViolations++;
      
      logger.warn(`Resource violation detected for container ${containerId.substring(0, 12)}: CPU=${violation.violations.cpu ? 'YES' : 'NO'}, Memory=${violation.violations.memory ? 'YES' : 'NO'} (count: ${violationCount})`);
      
      // Check if enforcement action needed
      if (violationCount >= this.config.enforcement.violationThreshold) {
        await this.enforceAction(containerId, violation, violationCount);
      }
      
      // Notify if enabled
      if (this.config.enforcement.notifyOnViolation) {
        this.emit('resourceViolation', {
          containerId,
          violation,
          count: violationCount,
          threshold: this.config.enforcement.violationThreshold
        });
      }
      
    } catch (error) {
      logger.error(`Failed to handle violation for container ${containerId}:`, error);
    }
  }

  /**
   * Enforce action on violating container
   */
  async enforceAction(containerId, violation, violationCount) {
    try {
      logger.warn(`Enforcing action on container ${containerId.substring(0, 12)} after ${violationCount} violations`);
      
      this.stats.totalEnforcements++;
      
      if (this.config.enforcement.killOnViolation) {
        // Kill container
        await this.killContainer(containerId, 'Resource limit violations');
      } else {
        // Throttle container
        await this.throttleContainer(containerId, violation);
      }
      
      // Reset violation count
      this.violations.set(containerId, 0);
      
      this.emit('enforcementAction', {
        containerId,
        action: this.config.enforcement.killOnViolation ? 'kill' : 'throttle',
        reason: 'Resource limit violations',
        violationCount
      });
      
    } catch (error) {
      logger.error(`Failed to enforce action on container ${containerId}:`, error);
    }
  }

  /**
   * Kill container for violations
   */
  async killContainer(containerId, reason) {
    try {
      const container = this.docker.getContainer(containerId);
      await container.kill();
      
      logger.warn(`Killed container ${containerId.substring(0, 12)} for: ${reason}`);
      
      // Clean up tracking
      await this.removeResourceLimits(containerId);
      
    } catch (error) {
      logger.error(`Failed to kill container ${containerId}:`, error);
    }
  }

  /**
   * Throttle container resources
   */
  async throttleContainer(containerId, violation) {
    try {
      const limitInfo = this.containerLimits.get(containerId);
      if (!limitInfo) return;
      
      const newLimits = { ...limitInfo.limits };
      
      // Reduce CPU quota by 25%
      if (violation.violations.cpu) {
        newLimits.cpu.quota = Math.floor(newLimits.cpu.quota * 0.75);
      }
      
      // Apply throttled limits
      await this.applyContainerLimits(containerId, newLimits);
      
      // Update tracked limits
      limitInfo.limits = newLimits;
      limitInfo.throttled = true;
      limitInfo.throttledAt = new Date();
      
      logger.warn(`Throttled container ${containerId.substring(0, 12)} resources`);
      
    } catch (error) {
      logger.error(`Failed to throttle container ${containerId}:`, error);
    }
  }

  /**
   * Collect resource metrics
   */
  async collectResourceMetrics() {
    try {
      const allMetrics = [];
      
      for (const [containerId, limitInfo] of this.containerLimits) {
        try {
          const metrics = await this.collectContainerMetrics(containerId, limitInfo);
          if (metrics) {
            allMetrics.push(metrics);
            
            // Update container metrics history
            const metricsData = this.containerMetrics.get(containerId);
            if (metricsData) {
              metricsData.current = metrics;
              metricsData.history.push(metrics);
              
              // Keep history limited
              const maxHistory = this.config.monitoring.retainMetrics / this.config.monitoring.metricsInterval;
              if (metricsData.history.length > maxHistory) {
                metricsData.history.shift();
              }
              
              // Update peak usage
              metricsData.peak.cpu = Math.max(metricsData.peak.cpu, metrics.usage.cpu);
              metricsData.peak.memory = Math.max(metricsData.peak.memory, metrics.usage.memory.percentage);
            }
          }
        } catch (error) {
          logger.debug(`Failed to collect metrics for container ${containerId}:`, error);
        }
      }
      
      // Update statistics
      this.updateResourceStatistics(allMetrics);
      
      // Check for alerts
      if (this.config.monitoring.enableAlerts) {
        this.checkResourceAlerts(allMetrics);
      }
      
    } catch (error) {
      logger.error('Resource metrics collection failed:', error);
    }
  }

  /**
   * Collect metrics for individual container
   */
  async collectContainerMetrics(containerId, limitInfo) {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });
      
      const usage = this.parseContainerStats(stats);
      
      return {
        containerId,
        timestamp: new Date(),
        limits: limitInfo.limits,
        usage,
        efficiency: {
          cpu: (usage.cpu / (parseFloat(limitInfo.limits.cpu.cpus) * 100)) * 100,
          memory: (usage.memory.used / limitInfo.limits.memory.limit) * 100
        }
      };
      
    } catch (error) {
      logger.debug(`Failed to collect metrics for container ${containerId}:`, error);
      return null;
    }
  }

  /**
   * Parse container stats
   */
  parseContainerStats(stats) {
    try {
      // CPU usage calculation
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                      (stats.precpu_stats.cpu_usage?.total_usage || 0);
      const systemDelta = stats.cpu_stats.system_cpu_usage - 
                         (stats.precpu_stats.system_cpu_usage || 0);
      
      const cpuUsage = systemDelta > 0 ? 
        (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;
      
      // Memory usage
      const memoryUsage = stats.memory_stats.usage || 0;
      const memoryCache = stats.memory_stats.stats?.cache || 0;
      const actualMemoryUsage = memoryUsage - memoryCache;
      const memoryLimit = stats.memory_stats.limit || 0;
      
      return {
        cpu: Math.round(cpuUsage * 100) / 100,
        memory: {
          used: actualMemoryUsage,
          limit: memoryLimit,
          percentage: memoryLimit > 0 ? (actualMemoryUsage / memoryLimit) * 100 : 0,
          cache: memoryCache
        },
        pids: stats.pids_stats?.current || 0,
        blkio: {
          read: this.sumBlkioStats(stats.blkio_stats?.io_service_bytes_recursive, 'Read'),
          write: this.sumBlkioStats(stats.blkio_stats?.io_service_bytes_recursive, 'Write')
        }
      };
    } catch (error) {
      logger.error('Failed to parse container stats:', error);
      return {
        cpu: 0,
        memory: { used: 0, limit: 0, percentage: 0, cache: 0 },
        pids: 0,
        blkio: { read: 0, write: 0 }
      };
    }
  }

  /**
   * Sum block I/O stats
   */
  sumBlkioStats(stats, operation) {
    if (!stats) return 0;
    
    return stats
      .filter(stat => stat.op === operation)
      .reduce((sum, stat) => sum + (stat.value || 0), 0);
  }

  /**
   * Update resource statistics
   */
  updateResourceStatistics(metrics) {
    if (metrics.length === 0) return;
    
    const cpuUsages = metrics.map(m => m.usage.cpu);
    const memoryUsages = metrics.map(m => m.usage.memory.percentage);
    
    // Update averages
    this.stats.avgCpuUsage = cpuUsages.reduce((sum, cpu) => sum + cpu, 0) / cpuUsages.length;
    this.stats.avgMemoryUsage = memoryUsages.reduce((sum, mem) => sum + mem, 0) / memoryUsages.length;
    
    // Update peaks
    this.stats.peakCpuUsage = Math.max(this.stats.peakCpuUsage, ...cpuUsages);
    this.stats.peakMemoryUsage = Math.max(this.stats.peakMemoryUsage, ...memoryUsages);
  }

  /**
   * Check for resource alerts
   */
  checkResourceAlerts(metrics) {
    const alerts = [];
    
    for (const metric of metrics) {
      // High CPU usage alert
      if (metric.usage.cpu > 90) {
        alerts.push({
          type: 'high_cpu',
          containerId: metric.containerId,
          severity: metric.usage.cpu > 95 ? 'critical' : 'warning',
          message: `Container ${metric.containerId.substring(0, 12)} CPU usage at ${metric.usage.cpu.toFixed(1)}%`,
          value: metric.usage.cpu
        });
      }
      
      // High memory usage alert
      if (metric.usage.memory.percentage > 90) {
        alerts.push({
          type: 'high_memory',
          containerId: metric.containerId,
          severity: metric.usage.memory.percentage > 95 ? 'critical' : 'warning',
          message: `Container ${metric.containerId.substring(0, 12)} memory usage at ${metric.usage.memory.percentage.toFixed(1)}%`,
          value: metric.usage.memory.percentage
        });
      }
      
      // Low efficiency alert
      if (metric.efficiency.cpu < 10 && metric.efficiency.memory < 10) {
        alerts.push({
          type: 'low_efficiency',
          containerId: metric.containerId,
          severity: 'info',
          message: `Container ${metric.containerId.substring(0, 12)} is underutilizing allocated resources`,
          efficiency: metric.efficiency
        });
      }
    }
    
    if (alerts.length > 0) {
      this.emit('resourceAlerts', { alerts, timestamp: new Date() });
    }
  }

  /**
   * Update system resources
   */
  async updateSystemResources() {
    this.systemResources.totalCpus = os.cpus().length;
    this.systemResources.totalMemory = os.totalmem();
    this.systemResources.availableMemory = os.freemem();
  }

  /**
   * Update allocated resources
   */
  updateAllocatedResources(limits, delta) {
    const cpuAllocation = parseFloat(limits.cpu.cpus) * 100 * delta;
    const memoryAllocation = limits.memory.reservation * delta;
    
    this.systemResources.allocatedCpu += cpuAllocation;
    this.systemResources.allocatedMemory += memoryAllocation;
    
    // Ensure non-negative
    this.systemResources.allocatedCpu = Math.max(0, this.systemResources.allocatedCpu);
    this.systemResources.allocatedMemory = Math.max(0, this.systemResources.allocatedMemory);
  }

  /**
   * Update profile usage statistics
   */
  updateProfileUsage(profileName) {
    const current = this.stats.profileUsage.get(profileName) || 0;
    this.stats.profileUsage.set(profileName, current + 1);
  }

  /**
   * Parse memory value to bytes
   */
  parseMemoryValue(value) {
    if (typeof value === 'number') return value;
    
    const match = String(value).match(/^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i);
    if (!match) {
      throw new Error(`Invalid memory value: ${value}`);
    }
    
    const num = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    
    const multipliers = {
      '': 1,
      'k': 1024,
      'm': 1024 * 1024,
      'g': 1024 * 1024 * 1024
    };
    
    return Math.floor(num * (multipliers[unit] || 1));
  }

  /**
   * Format memory value for display
   */
  formatMemory(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    
    return `${value.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Get resource allocation summary
   */
  getResourceAllocation() {
    const cpuAllocationPercentage = (this.systemResources.allocatedCpu / (this.systemResources.totalCpus * 100)) * 100;
    const memoryAllocationPercentage = (this.systemResources.allocatedMemory / this.systemResources.totalMemory) * 100;
    
    return {
      system: {
        cpu: {
          total: this.systemResources.totalCpus,
          allocated: this.systemResources.allocatedCpu / 100,
          available: this.systemResources.totalCpus - (this.systemResources.allocatedCpu / 100),
          percentage: cpuAllocationPercentage
        },
        memory: {
          total: this.systemResources.totalMemory,
          allocated: this.systemResources.allocatedMemory,
          available: this.systemResources.availableMemory,
          percentage: memoryAllocationPercentage,
          formatted: {
            total: this.formatMemory(this.systemResources.totalMemory),
            allocated: this.formatMemory(this.systemResources.allocatedMemory),
            available: this.formatMemory(this.systemResources.availableMemory)
          }
        }
      },
      containers: {
        total: this.containerLimits.size,
        byProfile: Object.fromEntries(this.stats.profileUsage)
      }
    };
  }

  /**
   * Get container resource usage
   */
  getContainerResourceUsage(containerId) {
    const limitInfo = this.containerLimits.get(containerId);
    const metricsInfo = this.containerMetrics.get(containerId);
    
    if (!limitInfo || !metricsInfo) {
      return null;
    }
    
    return {
      containerId,
      profile: limitInfo.profile,
      limits: limitInfo.limits,
      current: metricsInfo.current,
      peak: metricsInfo.peak,
      violations: this.violations.get(containerId) || 0,
      throttled: limitInfo.throttled || false,
      history: metricsInfo.history.slice(-20) // Last 20 data points
    };
  }

  /**
   * Get resource limiter statistics
   */
  getStatistics() {
    return {
      isStarted: this.isStarted,
      stats: {
        ...this.stats,
        profileUsage: Object.fromEntries(this.stats.profileUsage),
        avgCpuUsage: Math.round(this.stats.avgCpuUsage * 100) / 100,
        avgMemoryUsage: Math.round(this.stats.avgMemoryUsage * 100) / 100,
        peakCpuUsage: Math.round(this.stats.peakCpuUsage * 100) / 100,
        peakMemoryUsage: Math.round(this.stats.peakMemoryUsage * 100) / 100
      },
      allocation: this.getResourceAllocation(),
      containers: {
        total: this.containerLimits.size,
        withViolations: Array.from(this.violations.keys()).filter(id => this.violations.get(id) > 0).length,
        throttled: Array.from(this.containerLimits.values()).filter(info => info.throttled).length
      },
      config: {
        enforcementEnabled: this.config.enforcement.enabled,
        monitoringEnabled: this.config.monitoring.enabled,
        profiles: Object.keys(this.config.profiles)
      }
    };
  }
}

module.exports = CpuMemoryResourceLimiter;