/**
 * Container Health Monitoring System
 * Monitors container performance, resource usage, and health status
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class ContainerMonitor extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.config = {
      monitoringInterval: options.monitoringInterval || 15000, // 15 seconds
      metricsRetention: options.metricsRetention || 3600000, // 1 hour
      alertThresholds: {
        cpu: options.cpuThreshold || 80, // CPU usage percentage
        memory: options.memoryThreshold || 85, // Memory usage percentage
        responseTime: options.responseTimeThreshold || 5000, // 5 seconds
        ...options.alertThresholds
      },
      ...options
    };
    
    this.metrics = new Map(); // Store metrics by jobId
    this.alerts = new Map(); // Track active alerts
    this.monitoringTimer = null;
    this.isMonitoring = false;
  }

  /**
   * Start monitoring
   */
  start() {
    if (this.isMonitoring) {
      logger.warn('Container monitoring is already running');
      return;
    }

    logger.info('Starting container health monitoring');
    this.isMonitoring = true;
    
    this.monitoringTimer = setInterval(() => {
      this.collectMetrics().catch(err => 
        logger.error('Metrics collection failed:', err)
      );
    }, this.config.monitoringInterval);

    // Clean up old metrics periodically
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 300000); // Every 5 minutes

    this.emit('monitoringStarted');
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (!this.isMonitoring) {
      return;
    }

    logger.info('Stopping container health monitoring');
    this.isMonitoring = false;

    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }

    this.emit('monitoringStopped');
  }

  /**
   * Collect metrics from all active containers
   */
  async collectMetrics() {
    const activeContainers = this.dockerAPI.getActiveContainers();
    const timestamp = new Date();

    for (const containerInfo of activeContainers) {
      try {
        const metrics = await this.collectContainerMetrics(containerInfo.jobId, timestamp);
        this.storeMetrics(containerInfo.jobId, metrics);
        this.evaluateAlerts(containerInfo.jobId, metrics);
      } catch (error) {
        logger.error(`Failed to collect metrics for container ${containerInfo.jobId}:`, error);
      }
    }
  }

  /**
   * Collect metrics for a specific container
   */
  async collectContainerMetrics(jobId, timestamp) {
    const startTime = Date.now();
    
    try {
      // Get container stats
      const stats = await this.dockerAPI.getContainerStats(jobId);
      const responseTime = Date.now() - startTime;

      // Calculate CPU usage
      const cpuUsage = this.calculateCPUUsage(stats);
      
      // Calculate memory usage
      const memoryUsage = this.calculateMemoryUsage(stats);
      
      // Get network I/O
      const networkIO = this.calculateNetworkIO(stats);
      
      // Get block I/O
      const blockIO = this.calculateBlockIO(stats);

      // Get container status
      const containerStatus = await this.getContainerStatus(jobId);

      const metrics = {
        timestamp,
        jobId,
        cpu: cpuUsage,
        memory: memoryUsage,
        network: networkIO,
        disk: blockIO,
        responseTime,
        status: containerStatus,
        rawStats: stats // Keep raw stats for detailed analysis
      };

      this.emit('metricsCollected', { jobId, metrics });
      return metrics;
    } catch (error) {
      logger.error(`Error collecting metrics for container ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Calculate CPU usage percentage
   */
  calculateCPUUsage(stats) {
    if (!stats.cpu_stats || !stats.precpu_stats) {
      return { usage: 0, cores: 0 };
    }

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numberCpus = stats.cpu_stats.online_cpus || 1;

    let cpuUsage = 0;
    if (systemDelta > 0 && cpuDelta > 0) {
      cpuUsage = (cpuDelta / systemDelta) * numberCpus * 100;
    }

    return {
      usage: Math.round(cpuUsage * 100) / 100, // Round to 2 decimal places
      cores: numberCpus,
      throttling: stats.cpu_stats.throttling_data || {}
    };
  }

  /**
   * Calculate memory usage
   */
  calculateMemoryUsage(stats) {
    if (!stats.memory_stats) {
      return { usage: 0, limit: 0, percentage: 0 };
    }

    const usage = stats.memory_stats.usage || 0;
    const limit = stats.memory_stats.limit || 0;
    const percentage = limit > 0 ? (usage / limit) * 100 : 0;

    return {
      usage: usage,
      limit: limit,
      percentage: Math.round(percentage * 100) / 100,
      cache: stats.memory_stats.stats?.cache || 0,
      rss: stats.memory_stats.stats?.rss || 0
    };
  }

  /**
   * Calculate network I/O
   */
  calculateNetworkIO(stats) {
    if (!stats.networks) {
      return { rx_bytes: 0, tx_bytes: 0, rx_packets: 0, tx_packets: 0 };
    }

    let totalRxBytes = 0;
    let totalTxBytes = 0;
    let totalRxPackets = 0;
    let totalTxPackets = 0;

    for (const [networkName, networkStats] of Object.entries(stats.networks)) {
      totalRxBytes += networkStats.rx_bytes || 0;
      totalTxBytes += networkStats.tx_bytes || 0;
      totalRxPackets += networkStats.rx_packets || 0;
      totalTxPackets += networkStats.tx_packets || 0;
    }

    return {
      rx_bytes: totalRxBytes,
      tx_bytes: totalTxBytes,
      rx_packets: totalRxPackets,
      tx_packets: totalTxPackets
    };
  }

  /**
   * Calculate block I/O
   */
  calculateBlockIO(stats) {
    if (!stats.blkio_stats) {
      return { read_bytes: 0, write_bytes: 0 };
    }

    let readBytes = 0;
    let writeBytes = 0;

    if (stats.blkio_stats.io_service_bytes_recursive) {
      for (const stat of stats.blkio_stats.io_service_bytes_recursive) {
        if (stat.op === 'Read') {
          readBytes += stat.value;
        } else if (stat.op === 'Write') {
          writeBytes += stat.value;
        }
      }
    }

    return {
      read_bytes: readBytes,
      write_bytes: writeBytes
    };
  }

  /**
   * Get container status information
   */
  async getContainerStatus(jobId) {
    try {
      const containerInfo = this.dockerAPI.containers.get(jobId);
      if (!containerInfo) {
        return { state: 'unknown' };
      }

      const container = containerInfo.container;
      const inspect = await container.inspect();

      return {
        state: inspect.State.Status,
        running: inspect.State.Running,
        paused: inspect.State.Paused,
        restarting: inspect.State.Restarting,
        oomKilled: inspect.State.OOMKilled,
        dead: inspect.State.Dead,
        pid: inspect.State.Pid,
        exitCode: inspect.State.ExitCode,
        startedAt: inspect.State.StartedAt,
        finishedAt: inspect.State.FinishedAt
      };
    } catch (error) {
      logger.error(`Failed to get container status for ${jobId}:`, error);
      return { state: 'error', error: error.message };
    }
  }

  /**
   * Store metrics in memory
   */
  storeMetrics(jobId, metrics) {
    if (!this.metrics.has(jobId)) {
      this.metrics.set(jobId, []);
    }

    const containerMetrics = this.metrics.get(jobId);
    containerMetrics.push(metrics);

    // Keep only recent metrics
    const cutoffTime = new Date(Date.now() - this.config.metricsRetention);
    const filteredMetrics = containerMetrics.filter(m => m.timestamp > cutoffTime);
    this.metrics.set(jobId, filteredMetrics);
  }

  /**
   * Evaluate alert conditions
   */
  evaluateAlerts(jobId, metrics) {
    const alerts = [];

    // CPU usage alert
    if (metrics.cpu.usage > this.config.alertThresholds.cpu) {
      alerts.push({
        type: 'high_cpu',
        severity: 'warning',
        message: `High CPU usage: ${metrics.cpu.usage}%`,
        threshold: this.config.alertThresholds.cpu,
        value: metrics.cpu.usage
      });
    }

    // Memory usage alert
    if (metrics.memory.percentage > this.config.alertThresholds.memory) {
      alerts.push({
        type: 'high_memory',
        severity: 'warning',
        message: `High memory usage: ${metrics.memory.percentage}%`,
        threshold: this.config.alertThresholds.memory,
        value: metrics.memory.percentage
      });
    }

    // Response time alert
    if (metrics.responseTime > this.config.alertThresholds.responseTime) {
      alerts.push({
        type: 'slow_response',
        severity: 'warning',
        message: `Slow response time: ${metrics.responseTime}ms`,
        threshold: this.config.alertThresholds.responseTime,
        value: metrics.responseTime
      });
    }

    // Container state alerts
    if (metrics.status.state !== 'running' && metrics.status.state !== 'exited') {
      alerts.push({
        type: 'container_state',
        severity: 'error',
        message: `Container in abnormal state: ${metrics.status.state}`,
        value: metrics.status.state
      });
    }

    // Process alerts
    for (const alert of alerts) {
      this.processAlert(jobId, alert, metrics.timestamp);
    }
  }

  /**
   * Process an alert
   */
  processAlert(jobId, alert, timestamp) {
    const alertKey = `${jobId}_${alert.type}`;
    const existingAlert = this.alerts.get(alertKey);

    if (!existingAlert) {
      // New alert
      const alertRecord = {
        ...alert,
        jobId,
        firstSeen: timestamp,
        lastSeen: timestamp,
        count: 1,
        active: true
      };

      this.alerts.set(alertKey, alertRecord);
      logger.warn(`Alert triggered for container ${jobId}:`, alert.message);
      this.emit('alertTriggered', alertRecord);
    } else {
      // Update existing alert
      existingAlert.lastSeen = timestamp;
      existingAlert.count += 1;
      existingAlert.value = alert.value;

      this.emit('alertUpdated', existingAlert);
    }
  }

  /**
   * Get metrics for a specific container
   */
  getContainerMetrics(jobId, timeRange = 3600000) { // Default 1 hour
    const containerMetrics = this.metrics.get(jobId);
    if (!containerMetrics) {
      return [];
    }

    const cutoffTime = new Date(Date.now() - timeRange);
    return containerMetrics.filter(m => m.timestamp > cutoffTime);
  }

  /**
   * Get latest metrics for a container
   */
  getLatestMetrics(jobId) {
    const containerMetrics = this.metrics.get(jobId);
    if (!containerMetrics || containerMetrics.length === 0) {
      return null;
    }

    return containerMetrics[containerMetrics.length - 1];
  }

  /**
   * Get aggregated metrics for a container
   */
  getAggregatedMetrics(jobId, timeRange = 3600000) {
    const metrics = this.getContainerMetrics(jobId, timeRange);
    if (metrics.length === 0) {
      return null;
    }

    return {
      cpu: {
        avg: this.calculateAverage(metrics, 'cpu.usage'),
        max: this.calculateMax(metrics, 'cpu.usage'),
        min: this.calculateMin(metrics, 'cpu.usage')
      },
      memory: {
        avg: this.calculateAverage(metrics, 'memory.percentage'),
        max: this.calculateMax(metrics, 'memory.percentage'),
        min: this.calculateMin(metrics, 'memory.percentage')
      },
      responseTime: {
        avg: this.calculateAverage(metrics, 'responseTime'),
        max: this.calculateMax(metrics, 'responseTime'),
        min: this.calculateMin(metrics, 'responseTime')
      },
      dataPoints: metrics.length,
      timeRange: timeRange
    };
  }

  /**
   * Get all active alerts
   */
  getActiveAlerts() {
    return Array.from(this.alerts.values()).filter(alert => alert.active);
  }

  /**
   * Get alerts for a specific container
   */
  getContainerAlerts(jobId) {
    return Array.from(this.alerts.values()).filter(alert => 
      alert.jobId === jobId && alert.active
    );
  }

  /**
   * Resolve an alert
   */
  resolveAlert(jobId, alertType) {
    const alertKey = `${jobId}_${alertType}`;
    const alert = this.alerts.get(alertKey);
    
    if (alert) {
      alert.active = false;
      alert.resolvedAt = new Date();
      this.emit('alertResolved', alert);
    }
  }

  /**
   * Get monitoring statistics
   */
  getMonitoringStats() {
    const activeContainers = this.dockerAPI.getActiveContainers().length;
    const totalMetrics = Array.from(this.metrics.values())
      .reduce((sum, metrics) => sum + metrics.length, 0);
    const activeAlerts = this.getActiveAlerts().length;

    return {
      activeContainers,
      totalMetrics,
      activeAlerts,
      isMonitoring: this.isMonitoring,
      monitoringInterval: this.config.monitoringInterval,
      metricsRetention: this.config.metricsRetention
    };
  }

  /**
   * Clean up old metrics and alerts
   */
  cleanupOldMetrics() {
    const cutoffTime = new Date(Date.now() - this.config.metricsRetention);
    let cleanedCount = 0;

    // Clean up metrics
    for (const [jobId, metrics] of this.metrics.entries()) {
      const filteredMetrics = metrics.filter(m => m.timestamp > cutoffTime);
      
      if (filteredMetrics.length === 0) {
        this.metrics.delete(jobId);
      } else {
        this.metrics.set(jobId, filteredMetrics);
      }
      
      cleanedCount += metrics.length - filteredMetrics.length;
    }

    // Clean up old alerts
    for (const [alertKey, alert] of this.alerts.entries()) {
      if (!alert.active && alert.resolvedAt < cutoffTime) {
        this.alerts.delete(alertKey);
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} old metrics`);
    }
  }

  /**
   * Helper methods for calculations
   */
  calculateAverage(metrics, path) {
    const values = metrics.map(m => this.getNestedValue(m, path)).filter(v => v != null);
    return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
  }

  calculateMax(metrics, path) {
    const values = metrics.map(m => this.getNestedValue(m, path)).filter(v => v != null);
    return values.length > 0 ? Math.max(...values) : 0;
  }

  calculateMin(metrics, path) {
    const values = metrics.map(m => this.getNestedValue(m, path)).filter(v => v != null);
    return values.length > 0 ? Math.min(...values) : 0;
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current && current[key], obj);
  }
}

module.exports = ContainerMonitor;