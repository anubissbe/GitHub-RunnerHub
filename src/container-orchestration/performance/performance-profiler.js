/**
 * Performance Profiler
 * Comprehensive performance monitoring and profiling system for GitHub-RunnerHub
 */

const EventEmitter = require('events');
const { performance } = require('perf_hooks');
const os = require('os');
const process = require('process');
const logger = require('../../utils/logger');

class PerformanceProfiler extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Profiling intervals
      systemMetricsInterval: options.systemMetricsInterval || 5000,  // 5 seconds
      containerMetricsInterval: options.containerMetricsInterval || 10000, // 10 seconds
      performanceSnapshotInterval: options.performanceSnapshotInterval || 30000, // 30 seconds
      
      // Data retention
      metricsRetentionPeriod: options.metricsRetentionPeriod || 3600000, // 1 hour
      snapshotRetentionPeriod: options.snapshotRetentionPeriod || 86400000, // 24 hours
      
      // Profiling configuration
      enableCpuProfiling: options.enableCpuProfiling !== false,
      enableMemoryProfiling: options.enableMemoryProfiling !== false,
      enableNetworkProfiling: options.enableNetworkProfiling !== false,
      enableDiskProfiling: options.enableDiskProfiling !== false,
      enableApplicationProfiling: options.enableApplicationProfiling !== false,
      
      // Performance baselines
      baselines: {
        cpuUsage: options.cpuBaseline || 70,
        memoryUsage: options.memoryBaseline || 80,
        diskUsage: options.diskBaseline || 85,
        networkLatency: options.networkBaseline || 100,
        containerStartup: options.containerStartupBaseline || 5000,
        jobExecution: options.jobExecutionBaseline || 30000
      },
      
      // Alert thresholds
      alertThresholds: {
        criticalCpu: options.criticalCpu || 90,
        criticalMemory: options.criticalMemory || 95,
        criticalDisk: options.criticalDisk || 95,
        slowStartup: options.slowStartup || 10000,
        failedJobRatio: options.failedJobRatio || 0.1
      },
      
      // Advanced profiling
      enableMethodProfiling: options.enableMethodProfiling || false,
      enableAsyncProfiling: options.enableAsyncProfiling || false,
      enableGCProfiling: options.enableGCProfiling || false,
      
      ...options
    };
    
    // Data storage
    this.systemMetrics = [];
    this.containerMetrics = new Map();
    this.performanceSnapshots = [];
    this.methodProfileData = new Map();
    this.asyncOperations = new Map();
    this.gcEvents = [];
    
    // Timers
    this.systemMetricsTimer = null;
    this.containerMetricsTimer = null;
    this.snapshotTimer = null;
    
    // Performance tracking
    this.activeOperations = new Map();
    this.operationHistory = [];
    
    // Baseline calculations
    this.baselineCalculator = {
      cpuSamples: [],
      memorySamples: [],
      networkSamples: [],
      diskSamples: []
    };
    
    this.isRunning = false;
    this.startTime = null;
  }

  /**
   * Start performance profiling
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Performance profiler is already running');
      return;
    }
    
    logger.info('Starting Performance Profiler');
    this.isRunning = true;
    this.startTime = new Date();
    
    // Start system metrics collection
    if (this.config.enableCpuProfiling || this.config.enableMemoryProfiling) {
      this.startSystemMetricsCollection();
    }
    
    // Start container metrics collection
    this.startContainerMetricsCollection();
    
    // Start performance snapshots
    this.startPerformanceSnapshots();
    
    // Start GC profiling if enabled
    if (this.config.enableGCProfiling) {
      this.startGCProfiling();
    }
    
    // Start method profiling if enabled
    if (this.config.enableMethodProfiling) {
      this.startMethodProfiling();
    }
    
    this.emit('started');
    logger.info('Performance Profiler started successfully');
  }

  /**
   * Stop performance profiling
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    logger.info('Stopping Performance Profiler');
    this.isRunning = false;
    
    // Clear all timers
    if (this.systemMetricsTimer) {
      clearInterval(this.systemMetricsTimer);
      this.systemMetricsTimer = null;
    }
    
    if (this.containerMetricsTimer) {
      clearInterval(this.containerMetricsTimer);
      this.containerMetricsTimer = null;
    }
    
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    
    this.emit('stopped');
    logger.info('Performance Profiler stopped');
  }

  /**
   * Start system metrics collection
   */
  startSystemMetricsCollection() {
    this.systemMetricsTimer = setInterval(() => {
      this.collectSystemMetrics().catch(err => 
        logger.error('System metrics collection failed:', err)
      );
    }, this.config.systemMetricsInterval);
  }

  /**
   * Collect system-level performance metrics
   */
  async collectSystemMetrics() {
    try {
      const timestamp = new Date();
      const metrics = {
        timestamp,
        cpu: await this.collectCpuMetrics(),
        memory: this.collectMemoryMetrics(),
        disk: await this.collectDiskMetrics(),
        network: await this.collectNetworkMetrics(),
        load: this.collectLoadMetrics(),
        process: this.collectProcessMetrics()
      };
      
      this.systemMetrics.push(metrics);
      this.cleanupOldMetrics();
      
      // Update baseline calculations
      this.updateBaselines(metrics);
      
      // Check for performance alerts
      this.checkPerformanceAlerts(metrics);
      
      this.emit('systemMetricsCollected', metrics);
      
    } catch (error) {
      logger.error('Failed to collect system metrics:', error);
    }
  }

  /**
   * Collect CPU metrics
   */
  async collectCpuMetrics() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    // Calculate CPU usage
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
      for (const type of Object.keys(cpu.times)) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - Math.floor((idle / total) * 100);
    
    return {
      usage,
      cores: cpus.length,
      loadAverage: {
        '1m': loadAvg[0],
        '5m': loadAvg[1],
        '15m': loadAvg[2]
      },
      frequency: cpus[0]?.speed || 0
    };
  }

  /**
   * Collect memory metrics
   */
  collectMemoryMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = (usedMem / totalMem) * 100;
    
    const processMemory = process.memoryUsage();
    
    return {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      usage: Math.round(memUsage * 100) / 100,
      process: {
        rss: processMemory.rss,
        heapTotal: processMemory.heapTotal,
        heapUsed: processMemory.heapUsed,
        external: processMemory.external,
        arrayBuffers: processMemory.arrayBuffers
      }
    };
  }

  /**
   * Collect disk metrics
   */
  async collectDiskMetrics() {
    try {
      const { execSync } = require('child_process');
      
      // Get disk usage for root filesystem
      const dfOutput = execSync('df -h /', { encoding: 'utf8' });
      const lines = dfOutput.trim().split('\n');
      const diskLine = lines[1].split(/\s+/);
      
      return {
        filesystem: diskLine[0],
        total: diskLine[1],
        used: diskLine[2],
        available: diskLine[3],
        usage: parseFloat(diskLine[4].replace('%', '')),
        mountpoint: diskLine[5]
      };
    } catch (error) {
      logger.debug('Failed to collect disk metrics:', error.message);
      return { usage: 0, error: error.message };
    }
  }

  /**
   * Collect network metrics
   */
  async collectNetworkMetrics() {
    try {
      const networkInterfaces = os.networkInterfaces();
      const interfaces = [];
      
      for (const [name, addresses] of Object.entries(networkInterfaces)) {
        for (const addr of addresses) {
          if (!addr.internal && addr.family === 'IPv4') {
            interfaces.push({
              name,
              address: addr.address,
              netmask: addr.netmask,
              mac: addr.mac
            });
          }
        }
      }
      
      return { interfaces };
    } catch (error) {
      logger.debug('Failed to collect network metrics:', error.message);
      return { interfaces: [], error: error.message };
    }
  }

  /**
   * Collect load metrics
   */
  collectLoadMetrics() {
    return {
      uptime: os.uptime(),
      platform: os.platform(),
      arch: os.arch(),
      version: os.version(),
      hostname: os.hostname()
    };
  }

  /**
   * Collect process metrics
   */
  collectProcessMetrics() {
    return {
      pid: process.pid,
      uptime: process.uptime(),
      argv: process.argv.slice(0, 2), // Only include node and script path
      version: process.version,
      arch: process.arch,
      platform: process.platform,
      cpuUsage: process.cpuUsage(),
      resourceUsage: process.resourceUsage?.() || {}
    };
  }

  /**
   * Start container metrics collection
   */
  startContainerMetricsCollection() {
    this.containerMetricsTimer = setInterval(() => {
      this.collectContainerMetrics().catch(err => 
        logger.error('Container metrics collection failed:', err)
      );
    }, this.config.containerMetricsInterval);
  }

  /**
   * Collect container-specific metrics
   */
  async collectContainerMetrics() {
    // This would integrate with the Docker API to collect container metrics
    // For now, we'll create a placeholder structure
    const timestamp = new Date();
    
    try {
      // Placeholder for container metrics collection
      const containerMetrics = {
        timestamp,
        totalContainers: 0,
        runningContainers: 0,
        stoppedContainers: 0,
        averageStartupTime: 0,
        averageExecutionTime: 0,
        resourceUtilization: {
          cpu: 0,
          memory: 0,
          disk: 0,
          network: 0
        }
      };
      
      this.containerMetrics.set(timestamp.getTime(), containerMetrics);
      
      // Clean up old container metrics
      this.cleanupOldContainerMetrics();
      
      this.emit('containerMetricsCollected', containerMetrics);
      
    } catch (error) {
      logger.error('Failed to collect container metrics:', error);
    }
  }

  /**
   * Start performance snapshots
   */
  startPerformanceSnapshots() {
    this.snapshotTimer = setInterval(() => {
      this.createPerformanceSnapshot().catch(err => 
        logger.error('Performance snapshot creation failed:', err)
      );
    }, this.config.performanceSnapshotInterval);
  }

  /**
   * Create comprehensive performance snapshot
   */
  async createPerformanceSnapshot() {
    try {
      const timestamp = new Date();
      const snapshot = {
        timestamp,
        summary: this.getPerformanceSummary(),
        trends: this.analyzePerformanceTrends(),
        bottlenecks: this.identifyBottlenecks(),
        recommendations: this.generateRecommendations(),
        systemHealth: this.assessSystemHealth()
      };
      
      this.performanceSnapshots.push(snapshot);
      this.cleanupOldSnapshots();
      
      this.emit('performanceSnapshotCreated', snapshot);
      
    } catch (error) {
      logger.error('Failed to create performance snapshot:', error);
    }
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    const recentMetrics = this.getRecentSystemMetrics(300000); // Last 5 minutes
    
    if (recentMetrics.length === 0) {
      return null;
    }
    
    const avgCpu = recentMetrics.reduce((sum, m) => sum + m.cpu.usage, 0) / recentMetrics.length;
    const avgMemory = recentMetrics.reduce((sum, m) => sum + m.memory.usage, 0) / recentMetrics.length;
    
    return {
      averageCpuUsage: Math.round(avgCpu * 100) / 100,
      averageMemoryUsage: Math.round(avgMemory * 100) / 100,
      totalOperations: this.operationHistory.length,
      activeOperations: this.activeOperations.size,
      uptime: Date.now() - this.startTime?.getTime() || 0
    };
  }

  /**
   * Analyze performance trends
   */
  analyzePerformanceTrends() {
    const recentMetrics = this.getRecentSystemMetrics(1800000); // Last 30 minutes
    
    if (recentMetrics.length < 10) {
      return { trend: 'insufficient_data' };
    }
    
    // Simple trend analysis
    const firstHalf = recentMetrics.slice(0, Math.floor(recentMetrics.length / 2));
    const secondHalf = recentMetrics.slice(Math.floor(recentMetrics.length / 2));
    
    const firstHalfAvgCpu = firstHalf.reduce((sum, m) => sum + m.cpu.usage, 0) / firstHalf.length;
    const secondHalfAvgCpu = secondHalf.reduce((sum, m) => sum + m.cpu.usage, 0) / secondHalf.length;
    
    const cpuTrend = secondHalfAvgCpu - firstHalfAvgCpu;
    
    return {
      cpu: {
        trend: cpuTrend > 5 ? 'increasing' : cpuTrend < -5 ? 'decreasing' : 'stable',
        change: Math.round(cpuTrend * 100) / 100
      },
      direction: cpuTrend > 10 ? 'deteriorating' : cpuTrend < -10 ? 'improving' : 'stable'
    };
  }

  /**
   * Identify performance bottlenecks
   */
  identifyBottlenecks() {
    const bottlenecks = [];
    const recentMetrics = this.getRecentSystemMetrics(300000); // Last 5 minutes
    
    if (recentMetrics.length === 0) {
      return bottlenecks;
    }
    
    const latestMetrics = recentMetrics[recentMetrics.length - 1];
    
    // CPU bottleneck
    if (latestMetrics.cpu.usage > this.config.alertThresholds.criticalCpu) {
      bottlenecks.push({
        type: 'cpu',
        severity: 'critical',
        value: latestMetrics.cpu.usage,
        threshold: this.config.alertThresholds.criticalCpu,
        description: 'High CPU usage detected'
      });
    }
    
    // Memory bottleneck
    if (latestMetrics.memory.usage > this.config.alertThresholds.criticalMemory) {
      bottlenecks.push({
        type: 'memory',
        severity: 'critical',
        value: latestMetrics.memory.usage,
        threshold: this.config.alertThresholds.criticalMemory,
        description: 'High memory usage detected'
      });
    }
    
    // Disk bottleneck
    if (latestMetrics.disk.usage > this.config.alertThresholds.criticalDisk) {
      bottlenecks.push({
        type: 'disk',
        severity: 'critical',
        value: latestMetrics.disk.usage,
        threshold: this.config.alertThresholds.criticalDisk,
        description: 'High disk usage detected'
      });
    }
    
    return bottlenecks;
  }

  /**
   * Generate performance recommendations
   */
  generateRecommendations() {
    const recommendations = [];
    const bottlenecks = this.identifyBottlenecks();
    const summary = this.getPerformanceSummary();
    
    for (const bottleneck of bottlenecks) {
      switch (bottleneck.type) {
        case 'cpu':
          recommendations.push({
            priority: 'high',
            category: 'resource',
            action: 'Scale up CPU resources or optimize CPU-intensive operations',
            impact: 'High performance improvement expected'
          });
          break;
          
        case 'memory':
          recommendations.push({
            priority: 'high',
            category: 'resource',
            action: 'Increase memory allocation or optimize memory usage',
            impact: 'Prevent OOM errors and improve stability'
          });
          break;
          
        case 'disk':
          recommendations.push({
            priority: 'medium',
            category: 'storage',
            action: 'Clean up disk space or increase storage capacity',
            impact: 'Prevent disk full errors'
          });
          break;
      }
    }
    
    // General recommendations based on performance summary
    if (summary && summary.activeOperations > 10) {
      recommendations.push({
        priority: 'medium',
        category: 'concurrency',
        action: 'Consider implementing operation queuing or rate limiting',
        impact: 'Better resource utilization and stability'
      });
    }
    
    return recommendations;
  }

  /**
   * Assess overall system health
   */
  assessSystemHealth() {
    const bottlenecks = this.identifyBottlenecks();
    const criticalBottlenecks = bottlenecks.filter(b => b.severity === 'critical');
    
    let health = 'good';
    let score = 100;
    
    if (criticalBottlenecks.length > 0) {
      health = 'critical';
      score = Math.max(0, score - (criticalBottlenecks.length * 30));
    } else if (bottlenecks.length > 0) {
      health = 'warning';
      score = Math.max(0, score - (bottlenecks.length * 15));
    }
    
    return {
      status: health,
      score,
      issues: bottlenecks.length,
      criticalIssues: criticalBottlenecks.length,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0
    };
  }

  /**
   * Start operation timing
   */
  startOperation(operationId, metadata = {}) {
    const operation = {
      id: operationId,
      startTime: performance.now(),
      startTimestamp: new Date(),
      metadata
    };
    
    this.activeOperations.set(operationId, operation);
    
    if (this.config.enableApplicationProfiling) {
      this.emit('operationStarted', operation);
    }
    
    return operationId;
  }

  /**
   * End operation timing
   */
  endOperation(operationId, result = {}) {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      logger.warn(`Operation ${operationId} not found`);
      return null;
    }
    
    const endTime = performance.now();
    const duration = endTime - operation.startTime;
    
    const completedOperation = {
      ...operation,
      endTime,
      endTimestamp: new Date(),
      duration,
      result
    };
    
    this.activeOperations.delete(operationId);
    this.operationHistory.push(completedOperation);
    
    // Clean up old operation history
    if (this.operationHistory.length > 1000) {
      this.operationHistory = this.operationHistory.slice(-500);
    }
    
    if (this.config.enableApplicationProfiling) {
      this.emit('operationCompleted', completedOperation);
    }
    
    return completedOperation;
  }

  /**
   * Start GC profiling
   */
  startGCProfiling() {
    if (!performance.measureUserAgentSpecificMemory) {
      logger.warn('GC profiling not available in this environment');
      return;
    }
    
    // Monitor garbage collection events
    const originalGC = global.gc;
    if (originalGC) {
      global.gc = (...args) => {
        const gcStart = performance.now();
        const result = originalGC.apply(this, args);
        const gcDuration = performance.now() - gcStart;
        
        this.gcEvents.push({
          timestamp: new Date(),
          duration: gcDuration,
          type: 'manual'
        });
        
        return result;
      };
    }
  }

  /**
   * Start method profiling
   */
  startMethodProfiling() {
    // This would implement method-level profiling
    // Placeholder for more advanced profiling implementation
    logger.debug('Method profiling started');
  }

  /**
   * Get recent system metrics
   */
  getRecentSystemMetrics(timeWindow) {
    const cutoff = Date.now() - timeWindow;
    return this.systemMetrics.filter(m => m.timestamp.getTime() > cutoff);
  }

  /**
   * Update baseline calculations
   */
  updateBaselines(metrics) {
    this.baselineCalculator.cpuSamples.push(metrics.cpu.usage);
    this.baselineCalculator.memorySamples.push(metrics.memory.usage);
    
    // Keep only recent samples for baseline calculation
    const maxSamples = 100;
    if (this.baselineCalculator.cpuSamples.length > maxSamples) {
      this.baselineCalculator.cpuSamples = this.baselineCalculator.cpuSamples.slice(-maxSamples);
    }
    if (this.baselineCalculator.memorySamples.length > maxSamples) {
      this.baselineCalculator.memorySamples = this.baselineCalculator.memorySamples.slice(-maxSamples);
    }
  }

  /**
   * Check for performance alerts
   */
  checkPerformanceAlerts(metrics) {
    const alerts = [];
    
    if (metrics.cpu.usage > this.config.alertThresholds.criticalCpu) {
      alerts.push({
        type: 'cpu_critical',
        severity: 'critical',
        message: `Critical CPU usage: ${metrics.cpu.usage}%`,
        value: metrics.cpu.usage,
        threshold: this.config.alertThresholds.criticalCpu
      });
    }
    
    if (metrics.memory.usage > this.config.alertThresholds.criticalMemory) {
      alerts.push({
        type: 'memory_critical',
        severity: 'critical',
        message: `Critical memory usage: ${metrics.memory.usage}%`,
        value: metrics.memory.usage,
        threshold: this.config.alertThresholds.criticalMemory
      });
    }
    
    for (const alert of alerts) {
      this.emit('performanceAlert', alert);
    }
  }

  /**
   * Clean up old metrics
   */
  cleanupOldMetrics() {
    const cutoff = Date.now() - this.config.metricsRetentionPeriod;
    this.systemMetrics = this.systemMetrics.filter(m => m.timestamp.getTime() > cutoff);
  }

  /**
   * Clean up old container metrics
   */
  cleanupOldContainerMetrics() {
    const cutoff = Date.now() - this.config.metricsRetentionPeriod;
    for (const [timestamp, metrics] of this.containerMetrics.entries()) {
      if (timestamp < cutoff) {
        this.containerMetrics.delete(timestamp);
      }
    }
  }

  /**
   * Clean up old snapshots
   */
  cleanupOldSnapshots() {
    const cutoff = Date.now() - this.config.snapshotRetentionPeriod;
    this.performanceSnapshots = this.performanceSnapshots.filter(
      s => s.timestamp.getTime() > cutoff
    );
  }

  /**
   * Get performance report
   */
  getPerformanceReport() {
    return {
      summary: this.getPerformanceSummary(),
      systemHealth: this.assessSystemHealth(),
      trends: this.analyzePerformanceTrends(),
      bottlenecks: this.identifyBottlenecks(),
      recommendations: this.generateRecommendations(),
      statistics: {
        metricsCollected: this.systemMetrics.length,
        operationsTracked: this.operationHistory.length,
        activeOperations: this.activeOperations.size,
        snapshotsCreated: this.performanceSnapshots.length
      }
    };
  }
}

module.exports = PerformanceProfiler;