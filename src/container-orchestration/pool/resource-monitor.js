/**
 * Container Pool Resource Monitor
 * Advanced resource monitoring and analytics for container pool optimization
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class ContainerPoolResourceMonitor extends EventEmitter {
  constructor(poolManager, options = {}) {
    super();
    
    this.poolManager = poolManager;
    
    this.config = {
      // Monitoring configuration
      monitoring: {
        enabled: options.enabled !== false,
        interval: options.monitoringInterval || 15000, // 15 seconds
        detailedMetrics: options.detailedMetrics !== false,
        systemMetrics: options.systemMetrics !== false,
        containerMetrics: options.containerMetrics !== false
      },
      
      // Resource thresholds
      thresholds: {
        cpu: {
          warning: options.cpuWarningThreshold || 80,
          critical: options.cpuCriticalThreshold || 95,
          low: options.cpuLowThreshold || 20
        },
        memory: {
          warning: options.memoryWarningThreshold || 85,
          critical: options.memoryCriticalThreshold || 95,
          low: options.memoryLowThreshold || 30
        },
        disk: {
          warning: options.diskWarningThreshold || 80,
          critical: options.diskCriticalThreshold || 90,
          low: options.diskLowThreshold || 40
        },
        network: {
          warning: options.networkWarningThreshold || 80,
          critical: options.networkCriticalThreshold || 95
        }
      },
      
      // Alert configuration
      alerts: {
        enableAlerts: options.enableAlerts !== false,
        alertCooldown: options.alertCooldown || 300000, // 5 minutes
        severityLevels: ['info', 'warning', 'critical'],
        maxAlertsPerInterval: options.maxAlertsPerInterval || 10
      },
      
      // Data retention
      retention: {
        metricsHistorySize: options.metricsHistorySize || 1000,
        alertHistorySize: options.alertHistorySize || 500,
        aggregationIntervals: options.aggregationIntervals || [
          60000,   // 1 minute
          300000,  // 5 minutes
          900000,  // 15 minutes
          3600000  // 1 hour
        ]
      },
      
      // Performance optimization
      performance: {
        enablePredictiveAnalysis: options.enablePredictiveAnalysis !== false,
        enableAnomalyDetection: options.enableAnomalyDetection !== false,
        enableResourceOptimization: options.enableResourceOptimization !== false,
        optimizationCooldown: options.optimizationCooldown || 300000 // 5 minutes
      },
      
      ...options
    };
    
    // Monitoring data
    this.systemMetrics = {
      current: {},
      history: [],
      aggregated: new Map()
    };
    
    this.containerMetrics = new Map(); // containerId -> metrics
    this.resourceAlerts = [];
    this.alertCooldowns = new Map();
    
    // Resource analysis
    this.resourceAnalysis = {
      trends: new Map(),
      anomalies: [],
      predictions: new Map(),
      optimizationSuggestions: []
    };
    
    // Statistics
    this.stats = {
      totalMonitoringCycles: 0,
      alertsGenerated: 0,
      anomaliesDetected: 0,
      optimizationsApplied: 0,
      avgCpuUtilization: 0,
      avgMemoryUtilization: 0,
      peakResourceUsage: {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: 0
      },
      lastMonitoring: null
    };
    
    this.monitoringTimer = null;
    this.isStarted = false;
  }

  /**
   * Start resource monitoring
   */
  start() {
    if (this.isStarted) {
      logger.warn('Resource monitor already started');
      return;
    }
    
    if (!this.config.monitoring.enabled) {
      logger.info('Resource monitoring is disabled');
      return;
    }
    
    logger.info('Starting Container Pool Resource Monitor');
    
    // Start monitoring timer
    this.monitoringTimer = setInterval(() => {
      this.performMonitoringCycle().catch(error => {
        logger.error('Resource monitoring cycle failed:', error);
      });
    }, this.config.monitoring.interval);
    
    // Initial monitoring cycle
    this.performMonitoringCycle().catch(error => {
      logger.error('Initial monitoring cycle failed:', error);
    });
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info(`Resource monitoring started with ${this.config.monitoring.interval}ms interval`);
  }

  /**
   * Stop resource monitoring
   */
  stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Container Pool Resource Monitor');
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Resource monitoring stopped');
  }

  /**
   * Perform monitoring cycle
   */
  async performMonitoringCycle() {
    const cycleStart = Date.now();
    
    try {
      // Collect system metrics
      const systemMetrics = await this.collectSystemMetrics();
      
      // Collect container metrics
      const containerMetrics = await this.collectContainerMetrics();
      
      // Update metrics storage
      this.updateMetricsStorage(systemMetrics, containerMetrics);
      
      // Analyze resource utilization
      await this.analyzeResourceUtilization(systemMetrics, containerMetrics);
      
      // Check thresholds and generate alerts
      await this.checkThresholdsAndAlert(systemMetrics, containerMetrics);
      
      // Perform predictive analysis
      if (this.config.performance.enablePredictiveAnalysis) {
        await this.performPredictiveAnalysis();
      }
      
      // Detect anomalies
      if (this.config.performance.enableAnomalyDetection) {
        await this.detectAnomalies(systemMetrics, containerMetrics);
      }
      
      // Generate optimization suggestions
      if (this.config.performance.enableResourceOptimization) {
        await this.generateOptimizationSuggestions(systemMetrics, containerMetrics);
      }
      
      // Update statistics
      this.updateMonitoringStats(Date.now() - cycleStart);
      
      this.emit('monitoringCompleted', {
        systemMetrics,
        containerMetrics: containerMetrics.size,
        alerts: this.resourceAlerts.length,
        cycle: this.stats.totalMonitoringCycles
      });
      
    } catch (error) {
      logger.error('Monitoring cycle failed:', error);
      this.emit('monitoringFailed', { error: error.message });
    }
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics() {
    const metrics = {
      timestamp: new Date(),
      cpu: await this.getSystemCpuUsage(),
      memory: await this.getSystemMemoryUsage(),
      disk: await this.getSystemDiskUsage(),
      network: await this.getSystemNetworkUsage(),
      load: await this.getSystemLoadAverage(),
      processes: await this.getSystemProcessCount()
    };
    
    return metrics;
  }

  /**
   * Get system CPU usage
   */
  async getSystemCpuUsage() {
    try {
      const os = require('os');
      const cpus = os.cpus();
      
      let totalIdle = 0;
      let totalTick = 0;
      
      for (const cpu of cpus) {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      }
      
      const usage = 100 - (totalIdle / totalTick) * 100;
      
      return {
        usage: Math.round(usage * 100) / 100,
        cores: cpus.length,
        details: cpus.map(cpu => ({
          model: cpu.model,
          speed: cpu.speed
        }))
      };
    } catch (error) {
      logger.error('Failed to get CPU usage:', error);
      return { usage: 0, cores: 0, details: [] };
    }
  }

  /**
   * Get system memory usage
   */
  async getSystemMemoryUsage() {
    try {
      const os = require('os');
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      
      return {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        usage: Math.round((usedMemory / totalMemory) * 100 * 100) / 100,
        totalGB: Math.round(totalMemory / 1024 / 1024 / 1024 * 100) / 100,
        usedGB: Math.round(usedMemory / 1024 / 1024 / 1024 * 100) / 100,
        freeGB: Math.round(freeMemory / 1024 / 1024 / 1024 * 100) / 100
      };
    } catch (error) {
      logger.error('Failed to get memory usage:', error);
      return { usage: 0, total: 0, used: 0, free: 0 };
    }
  }

  /**
   * Get system disk usage
   */
  async getSystemDiskUsage() {
    try {
      const fs = require('fs').promises;
      const stats = await fs.statfs('/');
      
      const total = stats.blocks * stats.bsize;
      const free = stats.bavail * stats.bsize;
      const used = total - free;
      
      return {
        total,
        used,
        free,
        usage: Math.round((used / total) * 100 * 100) / 100,
        totalGB: Math.round(total / 1024 / 1024 / 1024 * 100) / 100,
        usedGB: Math.round(used / 1024 / 1024 / 1024 * 100) / 100,
        freeGB: Math.round(free / 1024 / 1024 / 1024 * 100) / 100
      };
    } catch (error) {
      logger.error('Failed to get disk usage:', error);
      return { usage: 0, total: 0, used: 0, free: 0 };
    }
  }

  /**
   * Get system network usage
   */
  async getSystemNetworkUsage() {
    try {
      const os = require('os');
      const interfaces = os.networkInterfaces();
      
      // This is a simplified implementation
      // In a real scenario, you'd track bytes in/out over time
      const networkStats = {
        interfaces: Object.keys(interfaces).length,
        usage: 0, // Placeholder - would need to track deltas
        bytesIn: 0,
        bytesOut: 0
      };
      
      return networkStats;
    } catch (error) {
      logger.error('Failed to get network usage:', error);
      return { usage: 0, interfaces: 0 };
    }
  }

  /**
   * Get system load average
   */
  async getSystemLoadAverage() {
    try {
      const os = require('os');
      const loadavg = os.loadavg();
      
      return {
        load1m: loadavg[0],
        load5m: loadavg[1],
        load15m: loadavg[2],
        normalized1m: loadavg[0] / os.cpus().length,
        normalized5m: loadavg[1] / os.cpus().length,
        normalized15m: loadavg[2] / os.cpus().length
      };
    } catch (error) {
      logger.error('Failed to get load average:', error);
      return { load1m: 0, load5m: 0, load15m: 0 };
    }
  }

  /**
   * Get system process count
   */
  async getSystemProcessCount() {
    try {
      // This would typically use system calls or parse /proc
      // Simplified implementation
      return {
        total: 100, // Placeholder
        running: 5, // Placeholder
        sleeping: 90 // Placeholder
      };
    } catch (error) {
      logger.error('Failed to get process count:', error);
      return { total: 0, running: 0, sleeping: 0 };
    }
  }

  /**
   * Collect container metrics
   */
  async collectContainerMetrics() {
    const containerMetrics = new Map();
    
    for (const [containerId] of this.poolManager.containers) {
      try {
        const metrics = await this.getContainerMetrics(containerId);
        if (metrics) {
          containerMetrics.set(containerId, metrics);
        }
      } catch (error) {
        logger.debug(`Failed to get metrics for container ${containerId.substring(0, 12)}:`, error);
      }
    }
    
    return containerMetrics;
  }

  /**
   * Get metrics for individual container
   */
  async getContainerMetrics(containerId) {
    try {
      const dockerContainer = this.poolManager.docker.getContainer(containerId);
      const stats = await dockerContainer.stats({ stream: false });
      
      // Calculate CPU usage
      const cpuUsage = this.calculateContainerCpuUsage(stats);
      
      // Calculate memory usage
      const memoryUsage = this.calculateContainerMemoryUsage(stats);
      
      // Calculate network usage
      const networkUsage = this.calculateContainerNetworkUsage(stats);
      
      // Calculate disk usage
      const diskUsage = this.calculateContainerDiskUsage(stats);
      
      return {
        timestamp: new Date(),
        containerId,
        cpu: cpuUsage,
        memory: memoryUsage,
        network: networkUsage,
        disk: diskUsage,
        pids: stats.pids_stats?.current || 0
      };
      
    } catch (error) {
      logger.debug(`Container metrics collection failed for ${containerId}:`, error);
      return null;
    }
  }

  /**
   * Calculate container CPU usage
   */
  calculateContainerCpuUsage(stats) {
    try {
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                      (stats.precpu_stats.cpu_usage?.total_usage || 0);
      const systemDelta = stats.cpu_stats.system_cpu_usage - 
                         (stats.precpu_stats.system_cpu_usage || 0);
      
      const cpuUsage = systemDelta > 0 ? 
        (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;
      
      return {
        usage: Math.round(Math.max(0, cpuUsage) * 100) / 100,
        throttled: stats.cpu_stats.throttling_data?.throttled_periods || 0,
        periods: stats.cpu_stats.throttling_data?.periods || 0
      };
    } catch (error) {
      return { usage: 0, throttled: 0, periods: 0 };
    }
  }

  /**
   * Calculate container memory usage
   */
  calculateContainerMemoryUsage(stats) {
    try {
      const memoryUsage = stats.memory_stats.usage || 0;
      const memoryLimit = stats.memory_stats.limit || 0;
      const memoryCache = stats.memory_stats.stats?.cache || 0;
      
      const actualUsage = memoryUsage - memoryCache;
      const usagePercentage = memoryLimit > 0 ? (actualUsage / memoryLimit) * 100 : 0;
      
      return {
        usage: Math.round(usagePercentage * 100) / 100,
        used: actualUsage,
        limit: memoryLimit,
        cache: memoryCache,
        usedMB: Math.round(actualUsage / 1024 / 1024 * 100) / 100,
        limitMB: Math.round(memoryLimit / 1024 / 1024 * 100) / 100
      };
    } catch (error) {
      return { usage: 0, used: 0, limit: 0, cache: 0 };
    }
  }

  /**
   * Calculate container network usage
   */
  calculateContainerNetworkUsage(stats) {
    try {
      let bytesReceived = 0;
      let bytesSent = 0;
      let packetsReceived = 0;
      let packetsSent = 0;
      
      if (stats.networks) {
        for (const network of Object.values(stats.networks)) {
          bytesReceived += network.rx_bytes || 0;
          bytesSent += network.tx_bytes || 0;
          packetsReceived += network.rx_packets || 0;
          packetsSent += network.tx_packets || 0;
        }
      }
      
      return {
        bytesReceived,
        bytesSent,
        packetsReceived,
        packetsSent,
        totalBytes: bytesReceived + bytesSent,
        receivedMB: Math.round(bytesReceived / 1024 / 1024 * 100) / 100,
        sentMB: Math.round(bytesSent / 1024 / 1024 * 100) / 100
      };
    } catch (error) {
      return { bytesReceived: 0, bytesSent: 0, totalBytes: 0 };
    }
  }

  /**
   * Calculate container disk usage
   */
  calculateContainerDiskUsage(stats) {
    try {
      let bytesRead = 0;
      let bytesWritten = 0;
      
      if (stats.blkio_stats?.io_service_bytes_recursive) {
        for (const io of stats.blkio_stats.io_service_bytes_recursive) {
          if (io.op === 'Read') {
            bytesRead += io.value || 0;
          } else if (io.op === 'Write') {
            bytesWritten += io.value || 0;
          }
        }
      }
      
      return {
        bytesRead,
        bytesWritten,
        totalBytes: bytesRead + bytesWritten,
        readMB: Math.round(bytesRead / 1024 / 1024 * 100) / 100,
        writtenMB: Math.round(bytesWritten / 1024 / 1024 * 100) / 100
      };
    } catch (error) {
      return { bytesRead: 0, bytesWritten: 0, totalBytes: 0 };
    }
  }

  /**
   * Update metrics storage
   */
  updateMetricsStorage(systemMetrics, containerMetrics) {
    // Update system metrics
    this.systemMetrics.current = systemMetrics;
    this.systemMetrics.history.push(systemMetrics);
    
    // Keep history limited
    if (this.systemMetrics.history.length > this.config.retention.metricsHistorySize) {
      this.systemMetrics.history.shift();
    }
    
    // Update container metrics
    for (const [containerId, metrics] of containerMetrics) {
      if (!this.containerMetrics.has(containerId)) {
        this.containerMetrics.set(containerId, { current: null, history: [] });
      }
      
      const containerData = this.containerMetrics.get(containerId);
      containerData.current = metrics;
      containerData.history.push(metrics);
      
      // Keep container history limited
      if (containerData.history.length > 100) {
        containerData.history.shift();
      }
    }
    
    // Aggregate metrics for different intervals
    this.aggregateMetrics();
  }

  /**
   * Aggregate metrics for different time intervals
   */
  aggregateMetrics() {
    for (const interval of this.config.retention.aggregationIntervals) {
      const cutoff = Date.now() - interval;
      const recentMetrics = this.systemMetrics.history.filter(
        m => m.timestamp.getTime() >= cutoff
      );
      
      if (recentMetrics.length > 0) {
        const aggregated = this.calculateAggregatedMetrics(recentMetrics);
        this.systemMetrics.aggregated.set(interval, aggregated);
      }
    }
  }

  /**
   * Calculate aggregated metrics
   */
  calculateAggregatedMetrics(metrics) {
    const cpuValues = metrics.map(m => m.cpu.usage);
    const memoryValues = metrics.map(m => m.memory.usage);
    const diskValues = metrics.map(m => m.disk.usage);
    
    return {
      cpu: {
        avg: this.calculateAverage(cpuValues),
        min: Math.min(...cpuValues),
        max: Math.max(...cpuValues),
        p95: this.calculatePercentile(cpuValues, 95)
      },
      memory: {
        avg: this.calculateAverage(memoryValues),
        min: Math.min(...memoryValues),
        max: Math.max(...memoryValues),
        p95: this.calculatePercentile(memoryValues, 95)
      },
      disk: {
        avg: this.calculateAverage(diskValues),
        min: Math.min(...diskValues),
        max: Math.max(...diskValues),
        p95: this.calculatePercentile(diskValues, 95)
      },
      dataPoints: metrics.length,
      timespan: metrics[metrics.length - 1].timestamp.getTime() - metrics[0].timestamp.getTime()
    };
  }

  /**
   * Analyze resource utilization
   */
  async analyzeResourceUtilization(systemMetrics, containerMetrics) {
    // Analyze system resource utilization
    this.analyzeSystemUtilization(systemMetrics);
    
    // Analyze container resource utilization
    this.analyzeContainerUtilization(containerMetrics);
    
    // Update peak usage tracking
    this.updatePeakResourceUsage(systemMetrics);
    
    // Analyze resource distribution
    this.analyzeResourceDistribution(containerMetrics);
  }

  /**
   * Analyze system utilization
   */
  analyzeSystemUtilization(systemMetrics) {
    const _trends = this.resourceAnalysis.trends;
    
    // CPU trend analysis
    this.updateResourceTrend('system_cpu', systemMetrics.cpu.usage);
    
    // Memory trend analysis
    this.updateResourceTrend('system_memory', systemMetrics.memory.usage);
    
    // Disk trend analysis
    this.updateResourceTrend('system_disk', systemMetrics.disk.usage);
    
    // Load average analysis
    this.updateResourceTrend('system_load', systemMetrics.load.normalized1m * 100);
  }

  /**
   * Analyze container utilization
   */
  analyzeContainerUtilization(containerMetrics) {
    let totalCpuUsage = 0;
    let totalMemoryUsage = 0;
    let containerCount = 0;
    
    for (const [containerId, metrics] of containerMetrics) {
      totalCpuUsage += metrics.cpu.usage;
      totalMemoryUsage += metrics.memory.usage;
      containerCount++;
      
      // Update individual container trends
      this.updateResourceTrend(`container_cpu_${containerId}`, metrics.cpu.usage);
      this.updateResourceTrend(`container_memory_${containerId}`, metrics.memory.usage);
    }
    
    // Calculate averages
    if (containerCount > 0) {
      this.stats.avgCpuUtilization = totalCpuUsage / containerCount;
      this.stats.avgMemoryUtilization = totalMemoryUsage / containerCount;
    }
  }

  /**
   * Update resource trend
   */
  updateResourceTrend(resourceKey, value) {
    if (!this.resourceAnalysis.trends.has(resourceKey)) {
      this.resourceAnalysis.trends.set(resourceKey, {
        values: [],
        trend: 0,
        direction: 'stable',
        lastUpdate: Date.now()
      });
    }
    
    const trend = this.resourceAnalysis.trends.get(resourceKey);
    trend.values.push({ timestamp: Date.now(), value });
    
    // Keep trend data limited
    if (trend.values.length > 50) {
      trend.values.shift();
    }
    
    // Calculate trend direction
    if (trend.values.length >= 5) {
      const recent = trend.values.slice(-5);
      const slope = this.calculateTrendSlope(recent);
      
      trend.trend = slope;
      trend.direction = slope > 0.5 ? 'increasing' : 
                       slope < -0.5 ? 'decreasing' : 'stable';
    }
    
    trend.lastUpdate = Date.now();
  }

  /**
   * Calculate trend slope
   */
  calculateTrendSlope(dataPoints) {
    const n = dataPoints.length;
    const sumX = dataPoints.reduce((sum, point, i) => sum + i, 0);
    const sumY = dataPoints.reduce((sum, point) => sum + point.value, 0);
    const sumXY = dataPoints.reduce((sum, point, i) => sum + (i * point.value), 0);
    const sumXX = dataPoints.reduce((sum, point, i) => sum + (i * i), 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return isNaN(slope) ? 0 : slope;
  }

  /**
   * Update peak resource usage
   */
  updatePeakResourceUsage(systemMetrics) {
    this.stats.peakResourceUsage.cpu = Math.max(
      this.stats.peakResourceUsage.cpu,
      systemMetrics.cpu.usage
    );
    
    this.stats.peakResourceUsage.memory = Math.max(
      this.stats.peakResourceUsage.memory,
      systemMetrics.memory.usage
    );
    
    this.stats.peakResourceUsage.disk = Math.max(
      this.stats.peakResourceUsage.disk,
      systemMetrics.disk.usage
    );
  }

  /**
   * Analyze resource distribution across containers
   */
  analyzeResourceDistribution(containerMetrics) {
    const cpuUsages = Array.from(containerMetrics.values()).map(m => m.cpu.usage);
    const memoryUsages = Array.from(containerMetrics.values()).map(m => m.memory.usage);
    
    if (cpuUsages.length > 0) {
      const cpuDistribution = {
        avg: this.calculateAverage(cpuUsages),
        stdDev: this.calculateStandardDeviation(cpuUsages),
        p50: this.calculatePercentile(cpuUsages, 50),
        p95: this.calculatePercentile(cpuUsages, 95),
        p99: this.calculatePercentile(cpuUsages, 99)
      };
      
      this.resourceAnalysis.cpuDistribution = cpuDistribution;
    }
    
    if (memoryUsages.length > 0) {
      const memoryDistribution = {
        avg: this.calculateAverage(memoryUsages),
        stdDev: this.calculateStandardDeviation(memoryUsages),
        p50: this.calculatePercentile(memoryUsages, 50),
        p95: this.calculatePercentile(memoryUsages, 95),
        p99: this.calculatePercentile(memoryUsages, 99)
      };
      
      this.resourceAnalysis.memoryDistribution = memoryDistribution;
    }
  }

  /**
   * Check thresholds and generate alerts
   */
  async checkThresholdsAndAlert(systemMetrics, containerMetrics) {
    // Check system thresholds
    await this.checkSystemThresholds(systemMetrics);
    
    // Check container thresholds
    await this.checkContainerThresholds(containerMetrics);
    
    // Clean up old alerts
    this.cleanupOldAlerts();
  }

  /**
   * Check system thresholds
   */
  async checkSystemThresholds(systemMetrics) {
    // CPU threshold checks
    await this.checkResourceThreshold('system_cpu', systemMetrics.cpu.usage, 'CPU');
    
    // Memory threshold checks
    await this.checkResourceThreshold('system_memory', systemMetrics.memory.usage, 'Memory');
    
    // Disk threshold checks
    await this.checkResourceThreshold('system_disk', systemMetrics.disk.usage, 'Disk');
    
    // Load average checks
    const normalizedLoad = systemMetrics.load.normalized1m * 100;
    await this.checkResourceThreshold('system_load', normalizedLoad, 'Load Average');
  }

  /**
   * Check container thresholds
   */
  async checkContainerThresholds(containerMetrics) {
    for (const [containerId, metrics] of containerMetrics) {
      const containerShortId = containerId.substring(0, 12);
      
      // CPU threshold checks
      await this.checkResourceThreshold(
        `container_cpu_${containerId}`,
        metrics.cpu.usage,
        `Container ${containerShortId} CPU`
      );
      
      // Memory threshold checks
      await this.checkResourceThreshold(
        `container_memory_${containerId}`,
        metrics.memory.usage,
        `Container ${containerShortId} Memory`
      );
    }
  }

  /**
   * Check resource threshold
   */
  async checkResourceThreshold(resourceKey, value, resourceName) {
    const thresholds = this.getThresholdsForResource(resourceKey);
    
    if (!thresholds) {
      return;
    }
    
    let severity = null;
    let message = '';
    
    if (value >= thresholds.critical) {
      severity = 'critical';
      message = `${resourceName} usage is critical: ${value.toFixed(1)}% (threshold: ${thresholds.critical}%)`;
    } else if (value >= thresholds.warning) {
      severity = 'warning';
      message = `${resourceName} usage is high: ${value.toFixed(1)}% (threshold: ${thresholds.warning}%)`;
    } else if (value <= thresholds.low) {
      severity = 'info';
      message = `${resourceName} usage is low: ${value.toFixed(1)}% (threshold: ${thresholds.low}%)`;
    }
    
    if (severity && this.shouldGenerateAlert(resourceKey, severity)) {
      await this.generateAlert(resourceKey, severity, message, { value, thresholds });
    }
  }

  /**
   * Get thresholds for resource type
   */
  getThresholdsForResource(resourceKey) {
    if (resourceKey.includes('cpu') || resourceKey.includes('load')) {
      return this.config.thresholds.cpu;
    } else if (resourceKey.includes('memory')) {
      return this.config.thresholds.memory;
    } else if (resourceKey.includes('disk')) {
      return this.config.thresholds.disk;
    } else if (resourceKey.includes('network')) {
      return this.config.thresholds.network;
    }
    
    return null;
  }

  /**
   * Check if alert should be generated (considering cooldowns)
   */
  shouldGenerateAlert(resourceKey, severity) {
    if (!this.config.alerts.enableAlerts) {
      return false;
    }
    
    const cooldownKey = `${resourceKey}_${severity}`;
    const lastAlert = this.alertCooldowns.get(cooldownKey);
    
    if (lastAlert) {
      const timeSinceLastAlert = Date.now() - lastAlert;
      if (timeSinceLastAlert < this.config.alerts.alertCooldown) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Generate resource alert
   */
  async generateAlert(resourceKey, severity, message, metadata = {}) {
    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date(),
      resourceKey,
      severity,
      message,
      metadata,
      resolved: false
    };
    
    this.resourceAlerts.push(alert);
    this.stats.alertsGenerated++;
    
    // Update cooldown
    const cooldownKey = `${resourceKey}_${severity}`;
    this.alertCooldowns.set(cooldownKey, Date.now());
    
    // Keep alerts limited
    if (this.resourceAlerts.length > this.config.retention.alertHistorySize) {
      this.resourceAlerts.shift();
    }
    
    logger.warn(`Resource alert generated: ${severity.toUpperCase()} - ${message}`);
    
    this.emit('alertGenerated', alert);
  }

  /**
   * Clean up old alerts
   */
  cleanupOldAlerts() {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    
    this.resourceAlerts = this.resourceAlerts.filter(
      alert => alert.timestamp.getTime() >= cutoff
    );
  }

  /**
   * Perform predictive analysis
   */
  async performPredictiveAnalysis() {
    try {
      // Predict system resource usage
      this.predictSystemResourceUsage();
      
      // Predict container resource requirements
      this.predictContainerResourceRequirements();
      
      // Generate capacity planning recommendations
      this.generateCapacityPlanningRecommendations();
      
    } catch (error) {
      logger.error('Predictive analysis failed:', error);
    }
  }

  /**
   * Predict system resource usage
   */
  predictSystemResourceUsage() {
    const predictions = new Map();
    
    for (const [resourceKey, trend] of this.resourceAnalysis.trends) {
      if (resourceKey.startsWith('system_') && trend.values.length >= 10) {
        const prediction = this.extrapolateResourceUsage(trend.values, 3600000); // 1 hour ahead
        predictions.set(resourceKey, prediction);
      }
    }
    
    this.resourceAnalysis.predictions = predictions;
  }

  /**
   * Extrapolate resource usage
   */
  extrapolateResourceUsage(dataPoints, timeAheadMs) {
    if (dataPoints.length < 5) {
      return null;
    }
    
    const recent = dataPoints.slice(-10);
    const slope = this.calculateTrendSlope(recent);
    const lastValue = recent[recent.length - 1].value;
    
    // Simple linear extrapolation
    const timeAheadIntervals = timeAheadMs / this.config.monitoring.interval;
    const predictedValue = lastValue + (slope * timeAheadIntervals);
    
    return {
      currentValue: lastValue,
      predictedValue: Math.max(0, Math.min(100, predictedValue)),
      confidence: Math.min(1, recent.length / 10),
      timeAhead: timeAheadMs,
      trend: slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable'
    };
  }

  /**
   * Detect anomalies in resource usage
   */
  async detectAnomalies(systemMetrics, containerMetrics) {
    try {
      // Detect system anomalies
      this.detectSystemAnomalies(systemMetrics);
      
      // Detect container anomalies
      this.detectContainerAnomalies(containerMetrics);
      
    } catch (error) {
      logger.error('Anomaly detection failed:', error);
    }
  }

  /**
   * Detect system anomalies
   */
  detectSystemAnomalies(systemMetrics) {
    const anomalies = [];
    
    // CPU anomaly detection
    const cpuAnomaly = this.detectResourceAnomaly('system_cpu', systemMetrics.cpu.usage);
    if (cpuAnomaly) {
      anomalies.push(cpuAnomaly);
    }
    
    // Memory anomaly detection
    const memoryAnomaly = this.detectResourceAnomaly('system_memory', systemMetrics.memory.usage);
    if (memoryAnomaly) {
      anomalies.push(memoryAnomaly);
    }
    
    if (anomalies.length > 0) {
      this.resourceAnalysis.anomalies.push(...anomalies);
      this.stats.anomaliesDetected += anomalies.length;
      
      for (const anomaly of anomalies) {
        this.emit('anomalyDetected', anomaly);
      }
    }
  }

  /**
   * Detect resource anomaly using statistical analysis
   */
  detectResourceAnomaly(resourceKey, currentValue) {
    const trend = this.resourceAnalysis.trends.get(resourceKey);
    
    if (!trend || trend.values.length < 20) {
      return null; // Need more data for anomaly detection
    }
    
    const values = trend.values.map(v => v.value);
    const mean = this.calculateAverage(values);
    const stdDev = this.calculateStandardDeviation(values);
    
    // Z-score anomaly detection
    const zScore = Math.abs((currentValue - mean) / stdDev);
    const threshold = 2.5; // 2.5 standard deviations
    
    if (zScore > threshold) {
      return {
        timestamp: new Date(),
        resourceKey,
        currentValue,
        expectedValue: mean,
        zScore,
        severity: zScore > 3 ? 'high' : 'medium',
        description: `${resourceKey} value ${currentValue.toFixed(1)} is ${zScore.toFixed(1)} standard deviations from mean ${mean.toFixed(1)}`
      };
    }
    
    return null;
  }

  /**
   * Generate optimization suggestions
   */
  async generateOptimizationSuggestions(systemMetrics, containerMetrics) {
    const suggestions = [];
    
    // System optimization suggestions
    suggestions.push(...this.generateSystemOptimizationSuggestions(systemMetrics));
    
    // Container optimization suggestions
    suggestions.push(...this.generateContainerOptimizationSuggestions(containerMetrics));
    
    // Pool optimization suggestions
    suggestions.push(...this.generatePoolOptimizationSuggestions());
    
    this.resourceAnalysis.optimizationSuggestions = suggestions;
    
    if (suggestions.length > 0) {
      this.emit('optimizationSuggestions', suggestions);
    }
  }

  /**
   * Generate system optimization suggestions
   */
  generateSystemOptimizationSuggestions(systemMetrics) {
    const suggestions = [];
    
    // High CPU usage suggestion
    if (systemMetrics.cpu.usage > 90) {
      suggestions.push({
        type: 'system',
        priority: 'high',
        category: 'cpu',
        title: 'High System CPU Usage Detected',
        description: `System CPU usage is at ${systemMetrics.cpu.usage.toFixed(1)}%. Consider reducing container pool size or optimizing workloads.`,
        action: 'scale_down_pool',
        metadata: { currentUsage: systemMetrics.cpu.usage }
      });
    }
    
    // High memory usage suggestion
    if (systemMetrics.memory.usage > 90) {
      suggestions.push({
        type: 'system',
        priority: 'high',
        category: 'memory',
        title: 'High System Memory Usage Detected',
        description: `System memory usage is at ${systemMetrics.memory.usage.toFixed(1)}%. Consider reducing memory limits or pool size.`,
        action: 'optimize_memory',
        metadata: { currentUsage: systemMetrics.memory.usage }
      });
    }
    
    return suggestions;
  }

  /**
   * Generate container optimization suggestions
   */
  generateContainerOptimizationSuggestions(containerMetrics) {
    const suggestions = [];
    
    // Find containers with consistently high resource usage
    for (const [containerId, metrics] of containerMetrics) {
      if (metrics.cpu.usage > 95) {
        suggestions.push({
          type: 'container',
          priority: 'medium',
          category: 'cpu',
          title: `Container ${containerId.substring(0, 12)} High CPU Usage`,
          description: `Container is using ${metrics.cpu.usage.toFixed(1)}% CPU. Consider recycling or investigating workload.`,
          action: 'recycle_container',
          metadata: { containerId, cpuUsage: metrics.cpu.usage }
        });
      }
      
      if (metrics.memory.usage > 95) {
        suggestions.push({
          type: 'container',
          priority: 'medium',
          category: 'memory',
          title: `Container ${containerId.substring(0, 12)} High Memory Usage`,
          description: `Container is using ${metrics.memory.usage.toFixed(1)}% memory. Risk of OOM kill.`,
          action: 'recycle_container',
          metadata: { containerId, memoryUsage: metrics.memory.usage }
        });
      }
    }
    
    return suggestions;
  }

  /**
   * Generate pool optimization suggestions
   */
  generatePoolOptimizationSuggestions() {
    const suggestions = [];
    const poolStatus = this.poolManager.getPoolStatus();
    
    // Pool size optimization
    if (poolStatus.stats.poolUtilization < 30) {
      suggestions.push({
        type: 'pool',
        priority: 'low',
        category: 'scaling',
        title: 'Low Pool Utilization Detected',
        description: `Pool utilization is only ${poolStatus.stats.poolUtilization.toFixed(1)}%. Consider reducing pool size to save resources.`,
        action: 'scale_down_pool',
        metadata: { utilization: poolStatus.stats.poolUtilization }
      });
    } else if (poolStatus.stats.poolUtilization > 85) {
      suggestions.push({
        type: 'pool',
        priority: 'medium',
        category: 'scaling',
        title: 'High Pool Utilization Detected',
        description: `Pool utilization is ${poolStatus.stats.poolUtilization.toFixed(1)}%. Consider scaling up to handle demand.`,
        action: 'scale_up_pool',
        metadata: { utilization: poolStatus.stats.poolUtilization }
      });
    }
    
    return suggestions;
  }

  /**
   * Utility functions
   */
  
  calculateAverage(values) {
    return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
  }
  
  calculateStandardDeviation(values) {
    const avg = this.calculateAverage(values);
    const squaredDiffs = values.map(val => Math.pow(val - avg, 2));
    const avgSquaredDiff = this.calculateAverage(squaredDiffs);
    return Math.sqrt(avgSquaredDiff);
  }
  
  calculatePercentile(values, percentile) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Update monitoring statistics
   */
  updateMonitoringStats(cycleTime) {
    this.stats.totalMonitoringCycles++;
    this.stats.lastMonitoring = new Date();
    
    // Update average cycle time
    const currentAvg = this.stats.avgCycleTime || 0;
    const count = this.stats.totalMonitoringCycles;
    this.stats.avgCycleTime = count > 1 ?
      ((currentAvg * (count - 1)) + cycleTime) / count :
      cycleTime;
  }

  /**
   * Get resource monitoring statistics
   */
  getMonitoringStats() {
    return {
      isStarted: this.isStarted,
      stats: this.stats,
      systemMetrics: {
        current: this.systemMetrics.current,
        historySize: this.systemMetrics.history.length,
        aggregatedIntervals: Array.from(this.systemMetrics.aggregated.keys())
      },
      containerMetrics: this.containerMetrics.size,
      alerts: {
        total: this.resourceAlerts.length,
        active: this.resourceAlerts.filter(a => !a.resolved).length,
        cooldowns: this.alertCooldowns.size
      },
      analysis: {
        trends: this.resourceAnalysis.trends.size,
        anomalies: this.resourceAnalysis.anomalies.length,
        predictions: this.resourceAnalysis.predictions.size,
        optimizationSuggestions: this.resourceAnalysis.optimizationSuggestions.length
      },
      config: {
        monitoringInterval: this.config.monitoring.interval,
        alertsEnabled: this.config.alerts.enableAlerts,
        predictiveAnalysis: this.config.performance.enablePredictiveAnalysis,
        anomalyDetection: this.config.performance.enableAnomalyDetection
      }
    };
  }

  /**
   * Get current resource summary
   */
  getCurrentResourceSummary() {
    const summary = {
      timestamp: new Date(),
      system: this.systemMetrics.current,
      containers: {
        total: this.containerMetrics.size,
        avgCpuUsage: this.stats.avgCpuUtilization,
        avgMemoryUsage: this.stats.avgMemoryUtilization
      },
      alerts: {
        active: this.resourceAlerts.filter(a => !a.resolved).length,
        critical: this.resourceAlerts.filter(a => !a.resolved && a.severity === 'critical').length
      },
      trends: {}
    };
    
    // Add trending information
    for (const [key, trend] of this.resourceAnalysis.trends) {
      if (key.startsWith('system_')) {
        summary.trends[key] = {
          direction: trend.direction,
          trend: trend.trend
        };
      }
    }
    
    return summary;
  }

  /**
   * Get resource alerts
   */
  getResourceAlerts(severity = null, limit = 50) {
    let alerts = this.resourceAlerts;
    
    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }
    
    return alerts
      .slice(-limit)
      .map(alert => ({
        ...alert,
        timestamp: alert.timestamp.toISOString()
      }))
      .reverse(); // Most recent first
  }

  /**
   * Get optimization suggestions
   */
  getOptimizationSuggestions(category = null, priority = null) {
    let suggestions = this.resourceAnalysis.optimizationSuggestions;
    
    if (category) {
      suggestions = suggestions.filter(s => s.category === category);
    }
    
    if (priority) {
      suggestions = suggestions.filter(s => s.priority === priority);
    }
    
    return suggestions;
  }
}

module.exports = ContainerPoolResourceMonitor;