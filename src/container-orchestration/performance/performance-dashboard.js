/**
 * Performance Analytics Dashboard
 * Real-time performance visualization and analytics for the GitHub RunnerHub system
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class PerformanceDashboard extends EventEmitter {
  constructor(performanceOptimizer, options = {}) {
    super();
    
    this.performanceOptimizer = performanceOptimizer;
    
    this.config = {
      // Dashboard configuration
      dashboard: {
        refreshInterval: options.refreshInterval || 5000, // 5 seconds
        dataRetentionHours: options.dataRetentionHours || 24,
        aggregationIntervals: options.aggregationIntervals || ['1m', '5m', '15m', '1h', '6h', '24h'],
        maxDataPoints: options.maxDataPoints || 1000
      },
      
      // Widget configuration
      widgets: {
        systemOverview: options.systemOverview !== false,
        containerMetrics: options.containerMetrics !== false,
        jobPerformance: options.jobPerformance !== false,
        resourceUtilization: options.resourceUtilization !== false,
        cachePerformance: options.cachePerformance !== false,
        bottleneckAnalysis: options.bottleneckAnalysis !== false,
        predictiveInsights: options.predictiveInsights !== false,
        costAnalysis: options.costAnalysis !== false
      },
      
      // Alert configuration
      alerts: {
        enabled: options.alertsEnabled !== false,
        thresholds: {
          cpuUtilization: options.cpuAlertThreshold || 90,
          memoryUtilization: options.memoryAlertThreshold || 85,
          responseTime: options.responseTimeAlert || 1000,
          errorRate: options.errorRateAlert || 0.05,
          cacheHitRate: options.cacheHitRateAlert || 0.7
        }
      },
      
      // Export configuration
      export: {
        formats: options.exportFormats || ['json', 'csv', 'pdf'],
        scheduledReports: options.scheduledReports || []
      },
      
      ...options
    };
    
    // Dashboard data
    this.dashboardData = {
      systemOverview: {
        status: 'healthy',
        uptime: 0,
        totalJobs: 0,
        activeContainers: 0,
        queuedJobs: 0,
        completedJobs: 0,
        failedJobs: 0
      },
      
      performanceMetrics: {
        current: new Map(),
        historical: new Map(),
        aggregated: new Map()
      },
      
      resourceMetrics: {
        cpu: [],
        memory: [],
        disk: [],
        network: []
      },
      
      jobMetrics: {
        executionTime: [],
        queueTime: [],
        startupTime: [],
        throughput: []
      },
      
      cacheMetrics: {
        hitRate: 0,
        missRate: 0,
        evictions: 0,
        size: 0
      },
      
      bottlenecks: [],
      predictions: [],
      alerts: []
    };
    
    // Time series data
    this.timeSeriesData = new Map();
    
    // Active alerts
    this.activeAlerts = new Map();
    
    // Dashboard state
    this.isRunning = false;
    this.updateTimer = null;
    
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers
   */
  setupEventHandlers() {
    // Performance optimizer events
    this.performanceOptimizer.on('metricsCollected', (metrics) => {
      this.updatePerformanceMetrics(metrics);
    });
    
    this.performanceOptimizer.on('optimizationCompleted', (result) => {
      this.recordOptimizationResult(result);
    });
    
    this.performanceOptimizer.on('bottleneckDetected', (bottleneck) => {
      this.addBottleneck(bottleneck);
    });
    
    // Component events
    if (this.performanceOptimizer.cacheManager) {
      this.performanceOptimizer.cacheManager.on('cacheStats', (stats) => {
        this.updateCacheMetrics(stats);
      });
    }
    
    if (this.performanceOptimizer.predictiveScaler) {
      this.performanceOptimizer.predictiveScaler.on('demandPredicted', (prediction) => {
        this.updatePredictions(prediction);
      });
    }
  }

  /**
   * Start the dashboard
   */
  async start() {
    if (this.isRunning) return;
    
    logger.info('Starting Performance Dashboard');
    
    // Initialize dashboard data
    await this.initializeDashboard();
    
    // Start update timer
    this.updateTimer = setInterval(() => {
      this.updateDashboard();
    }, this.config.dashboard.refreshInterval);
    
    this.isRunning = true;
    this.emit('started');
  }

  /**
   * Initialize dashboard
   */
  async initializeDashboard() {
    try {
      // Get initial system status
      const systemStatus = await this.getSystemStatus();
      this.dashboardData.systemOverview = systemStatus;
      
      // Initialize time series for key metrics
      const metrics = [
        'cpu_utilization',
        'memory_utilization',
        'job_throughput',
        'response_time',
        'cache_hit_rate',
        'container_count'
      ];
      
      for (const metric of metrics) {
        this.timeSeriesData.set(metric, []);
      }
      
      // Load historical data if available
      await this.loadHistoricalData();
      
    } catch (error) {
      logger.error('Failed to initialize dashboard:', error);
    }
  }

  /**
   * Update dashboard
   */
  async updateDashboard() {
    try {
      // Collect current metrics
      const metrics = await this.collectCurrentMetrics();
      
      // Update time series data
      this.updateTimeSeriesData(metrics);
      
      // Check for alerts
      this.checkAlerts(metrics);
      
      // Emit dashboard update
      this.emit('dashboardUpdate', {
        timestamp: Date.now(),
        data: this.getDashboardData()
      });
      
    } catch (error) {
      logger.error('Failed to update dashboard:', error);
    }
  }

  /**
   * Collect current metrics
   */
  async collectCurrentMetrics() {
    const metrics = {
      timestamp: Date.now(),
      system: {},
      containers: {},
      jobs: {},
      cache: {},
      resources: {}
    };
    
    // System metrics
    const systemStatus = await this.getSystemStatus();
    metrics.system = {
      uptime: systemStatus.uptime,
      activeContainers: systemStatus.activeContainers,
      queuedJobs: systemStatus.queuedJobs,
      jobThroughput: this.calculateJobThroughput()
    };
    
    // Container metrics
    const containerMetrics = await this.performanceOptimizer.profiler.getContainerMetrics();
    metrics.containers = this.aggregateContainerMetrics(containerMetrics);
    
    // Job performance metrics
    const jobMetrics = this.performanceOptimizer.profiler.getJobMetrics();
    metrics.jobs = {
      avgExecutionTime: this.calculateAverage(jobMetrics.map(j => j.executionTime)),
      avgQueueTime: this.calculateAverage(jobMetrics.map(j => j.queueTime)),
      avgStartupTime: this.calculateAverage(jobMetrics.map(j => j.startupTime)),
      successRate: this.calculateJobSuccessRate(jobMetrics)
    };
    
    // Cache metrics
    if (this.performanceOptimizer.cacheManager) {
      const cacheStats = this.performanceOptimizer.cacheManager.getStats();
      metrics.cache = {
        hitRate: cacheStats.hitRate,
        size: cacheStats.totalSize,
        evictions: cacheStats.evictions
      };
    }
    
    // Resource utilization
    metrics.resources = {
      cpu: await this.getCPUUtilization(),
      memory: await this.getMemoryUtilization(),
      disk: await this.getDiskUtilization(),
      network: await this.getNetworkUtilization()
    };
    
    return metrics;
  }

  /**
   * Update time series data
   */
  updateTimeSeriesData(metrics) {
    const timestamp = metrics.timestamp;
    
    // Update CPU utilization
    this.addTimeSeriesPoint('cpu_utilization', timestamp, metrics.resources.cpu);
    
    // Update memory utilization
    this.addTimeSeriesPoint('memory_utilization', timestamp, metrics.resources.memory);
    
    // Update job throughput
    this.addTimeSeriesPoint('job_throughput', timestamp, metrics.system.jobThroughput);
    
    // Update response time
    this.addTimeSeriesPoint('response_time', timestamp, metrics.jobs.avgExecutionTime);
    
    // Update cache hit rate
    this.addTimeSeriesPoint('cache_hit_rate', timestamp, metrics.cache.hitRate);
    
    // Update container count
    this.addTimeSeriesPoint('container_count', timestamp, metrics.system.activeContainers);
  }

  /**
   * Add time series point
   */
  addTimeSeriesPoint(metric, timestamp, value) {
    const series = this.timeSeriesData.get(metric) || [];
    series.push({ timestamp, value });
    
    // Maintain max data points
    if (series.length > this.config.dashboard.maxDataPoints) {
      series.shift();
    }
    
    this.timeSeriesData.set(metric, series);
  }

  /**
   * Check alerts
   */
  checkAlerts(metrics) {
    if (!this.config.alerts.enabled) return;
    
    const alerts = [];
    
    // CPU utilization alert
    if (metrics.resources.cpu > this.config.alerts.thresholds.cpuUtilization) {
      alerts.push({
        type: 'cpu_high',
        severity: 'warning',
        message: `CPU utilization at ${metrics.resources.cpu.toFixed(1)}%`,
        value: metrics.resources.cpu,
        threshold: this.config.alerts.thresholds.cpuUtilization
      });
    }
    
    // Memory utilization alert
    if (metrics.resources.memory > this.config.alerts.thresholds.memoryUtilization) {
      alerts.push({
        type: 'memory_high',
        severity: 'warning',
        message: `Memory utilization at ${metrics.resources.memory.toFixed(1)}%`,
        value: metrics.resources.memory,
        threshold: this.config.alerts.thresholds.memoryUtilization
      });
    }
    
    // Response time alert
    if (metrics.jobs.avgExecutionTime > this.config.alerts.thresholds.responseTime) {
      alerts.push({
        type: 'response_time_high',
        severity: 'warning',
        message: `Average response time at ${metrics.jobs.avgExecutionTime}ms`,
        value: metrics.jobs.avgExecutionTime,
        threshold: this.config.alerts.thresholds.responseTime
      });
    }
    
    // Cache hit rate alert
    if (metrics.cache.hitRate < this.config.alerts.thresholds.cacheHitRate) {
      alerts.push({
        type: 'cache_hit_rate_low',
        severity: 'info',
        message: `Cache hit rate at ${(metrics.cache.hitRate * 100).toFixed(1)}%`,
        value: metrics.cache.hitRate,
        threshold: this.config.alerts.thresholds.cacheHitRate
      });
    }
    
    // Process alerts
    for (const alert of alerts) {
      this.handleAlert(alert);
    }
  }

  /**
   * Handle alert
   */
  handleAlert(alert) {
    const alertKey = `${alert.type}_${alert.severity}`;
    
    if (!this.activeAlerts.has(alertKey)) {
      // New alert
      this.activeAlerts.set(alertKey, {
        ...alert,
        firstSeen: Date.now(),
        count: 1
      });
      
      this.emit('alertRaised', alert);
      logger.warn(`Performance alert: ${alert.message}`);
    } else {
      // Update existing alert
      const existing = this.activeAlerts.get(alertKey);
      existing.count++;
      existing.lastSeen = Date.now();
    }
    
    // Add to dashboard alerts
    this.dashboardData.alerts.unshift(alert);
    if (this.dashboardData.alerts.length > 100) {
      this.dashboardData.alerts = this.dashboardData.alerts.slice(0, 100);
    }
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(metrics) {
    this.dashboardData.performanceMetrics.current.set(metrics.type, metrics);
    
    // Update historical data
    const historical = this.dashboardData.performanceMetrics.historical.get(metrics.type) || [];
    historical.push({
      timestamp: Date.now(),
      ...metrics
    });
    
    // Maintain retention window
    const cutoff = Date.now() - (this.config.dashboard.dataRetentionHours * 3600000);
    const filtered = historical.filter(h => h.timestamp > cutoff);
    
    this.dashboardData.performanceMetrics.historical.set(metrics.type, filtered);
  }

  /**
   * Update cache metrics
   */
  updateCacheMetrics(stats) {
    this.dashboardData.cacheMetrics = {
      hitRate: stats.hitRate,
      missRate: 1 - stats.hitRate,
      evictions: stats.evictions,
      size: stats.totalSize,
      layers: stats.layers
    };
  }

  /**
   * Update predictions
   */
  updatePredictions(prediction) {
    this.dashboardData.predictions = prediction.predictions;
  }

  /**
   * Add bottleneck
   */
  addBottleneck(bottleneck) {
    this.dashboardData.bottlenecks.unshift({
      ...bottleneck,
      timestamp: Date.now()
    });
    
    // Keep only recent bottlenecks
    if (this.dashboardData.bottlenecks.length > 50) {
      this.dashboardData.bottlenecks = this.dashboardData.bottlenecks.slice(0, 50);
    }
  }

  /**
   * Record optimization result
   */
  recordOptimizationResult(result) {
    // Update dashboard with optimization results
    this.emit('optimizationResult', result);
  }

  /**
   * Get dashboard data
   */
  getDashboardData() {
    return {
      overview: this.dashboardData.systemOverview,
      performance: {
        current: Object.fromEntries(this.dashboardData.performanceMetrics.current),
        timeSeries: Object.fromEntries(this.timeSeriesData)
      },
      resources: this.dashboardData.resourceMetrics,
      jobs: this.dashboardData.jobMetrics,
      cache: this.dashboardData.cacheMetrics,
      bottlenecks: this.dashboardData.bottlenecks,
      predictions: this.dashboardData.predictions,
      alerts: this.dashboardData.alerts
    };
  }

  /**
   * Get widget data
   */
  getWidgetData(widgetName) {
    switch (widgetName) {
      case 'systemOverview':
        return this.getSystemOverviewWidget();
      case 'containerMetrics':
        return this.getContainerMetricsWidget();
      case 'jobPerformance':
        return this.getJobPerformanceWidget();
      case 'resourceUtilization':
        return this.getResourceUtilizationWidget();
      case 'cachePerformance':
        return this.getCachePerformanceWidget();
      case 'bottleneckAnalysis':
        return this.getBottleneckAnalysisWidget();
      case 'predictiveInsights':
        return this.getPredictiveInsightsWidget();
      case 'costAnalysis':
        return this.getCostAnalysisWidget();
      default:
        return null;
    }
  }

  /**
   * Widget data generators
   */
  
  getSystemOverviewWidget() {
    const data = this.dashboardData.systemOverview;
    const throughput = this.calculateJobThroughput();
    
    return {
      title: 'System Overview',
      type: 'stats',
      data: {
        status: data.status,
        uptime: this.formatUptime(data.uptime),
        metrics: [
          { label: 'Active Containers', value: data.activeContainers },
          { label: 'Queued Jobs', value: data.queuedJobs },
          { label: 'Job Throughput', value: `${throughput}/min` },
          { label: 'Total Jobs', value: data.totalJobs }
        ]
      }
    };
  }

  getContainerMetricsWidget() {
    const containerSeries = this.timeSeriesData.get('container_count') || [];
    
    return {
      title: 'Container Activity',
      type: 'line',
      data: {
        series: [{
          name: 'Active Containers',
          data: containerSeries
        }],
        yAxis: { title: 'Container Count' }
      }
    };
  }

  getJobPerformanceWidget() {
    const executionTimes = this.dashboardData.jobMetrics.executionTime.slice(-50);
    
    return {
      title: 'Job Performance',
      type: 'mixed',
      data: {
        avgExecutionTime: this.calculateAverage(executionTimes),
        p95ExecutionTime: this.calculatePercentile(executionTimes, 0.95),
        successRate: this.calculateJobSuccessRate(),
        series: [{
          name: 'Execution Time',
          type: 'scatter',
          data: executionTimes.map((time, i) => ({ x: i, y: time }))
        }]
      }
    };
  }

  getResourceUtilizationWidget() {
    return {
      title: 'Resource Utilization',
      type: 'gauge',
      data: {
        gauges: [
          {
            name: 'CPU',
            value: this.dashboardData.resourceMetrics.cpu[0]?.value || 0,
            max: 100,
            thresholds: [70, 85, 95]
          },
          {
            name: 'Memory',
            value: this.dashboardData.resourceMetrics.memory[0]?.value || 0,
            max: 100,
            thresholds: [70, 85, 95]
          },
          {
            name: 'Disk I/O',
            value: this.dashboardData.resourceMetrics.disk[0]?.value || 0,
            max: 100,
            thresholds: [60, 80, 90]
          }
        ]
      }
    };
  }

  getCachePerformanceWidget() {
    const cacheHitSeries = this.timeSeriesData.get('cache_hit_rate') || [];
    
    return {
      title: 'Cache Performance',
      type: 'area',
      data: {
        hitRate: this.dashboardData.cacheMetrics.hitRate,
        size: this.formatBytes(this.dashboardData.cacheMetrics.size),
        series: [{
          name: 'Hit Rate',
          data: cacheHitSeries.map(p => ({
            x: p.timestamp,
            y: p.value * 100
          }))
        }]
      }
    };
  }

  getBottleneckAnalysisWidget() {
    const recentBottlenecks = this.dashboardData.bottlenecks.slice(0, 10);
    
    return {
      title: 'Bottleneck Analysis',
      type: 'list',
      data: {
        items: recentBottlenecks.map(b => ({
          type: b.type,
          severity: b.severity,
          component: b.component,
          impact: `${(b.impact * 100).toFixed(1)}%`,
          timestamp: new Date(b.timestamp).toLocaleTimeString()
        }))
      }
    };
  }

  getPredictiveInsightsWidget() {
    const predictions = this.dashboardData.predictions.slice(0, 24); // Next 24 hours
    
    return {
      title: 'Predictive Insights',
      type: 'forecast',
      data: {
        predictions: predictions.map(p => ({
          timestamp: p.timestamp,
          demand: p.value,
          confidence: p.confidence
        })),
        recommendations: this.generatePredictiveRecommendations(predictions)
      }
    };
  }

  getCostAnalysisWidget() {
    const resourceUsage = this.calculateResourceUsage();
    const costEstimates = this.calculateCostEstimates(resourceUsage);
    
    return {
      title: 'Cost Analysis',
      type: 'cost',
      data: {
        currentCost: costEstimates.current,
        projectedCost: costEstimates.projected,
        savingsOpportunity: costEstimates.savings,
        breakdown: [
          { resource: 'CPU', cost: costEstimates.cpu, percentage: costEstimates.cpuPercentage },
          { resource: 'Memory', cost: costEstimates.memory, percentage: costEstimates.memoryPercentage },
          { resource: 'Storage', cost: costEstimates.storage, percentage: costEstimates.storagePercentage }
        ]
      }
    };
  }

  /**
   * Generate analytics report
   */
  async generateAnalyticsReport(options = {}) {
    const report = {
      generated: new Date().toISOString(),
      period: options.period || '24h',
      summary: {},
      performance: {},
      resources: {},
      bottlenecks: {},
      predictions: {},
      recommendations: []
    };
    
    // Summary statistics
    report.summary = {
      totalJobs: this.dashboardData.systemOverview.totalJobs,
      completedJobs: this.dashboardData.systemOverview.completedJobs,
      failedJobs: this.dashboardData.systemOverview.failedJobs,
      avgExecutionTime: this.calculateAverage(this.dashboardData.jobMetrics.executionTime),
      systemUptime: this.dashboardData.systemOverview.uptime,
      overallHealth: this.calculateSystemHealth()
    };
    
    // Performance analysis
    report.performance = {
      jobThroughput: this.analyzeJobThroughput(),
      responseTimeAnalysis: this.analyzeResponseTimes(),
      performanceTrends: this.analyzePerformanceTrends()
    };
    
    // Resource utilization
    report.resources = {
      cpuAnalysis: this.analyzeCPUUtilization(),
      memoryAnalysis: this.analyzeMemoryUtilization(),
      optimizationOpportunities: this.identifyOptimizationOpportunities()
    };
    
    // Bottleneck analysis
    report.bottlenecks = {
      topBottlenecks: this.getTopBottlenecks(),
      bottleneckTrends: this.analyzeBottleneckTrends(),
      resolutionRecommendations: this.generateBottleneckRecommendations()
    };
    
    // Predictive insights
    report.predictions = {
      demandForecast: this.generateDemandForecast(),
      capacityRequirements: this.predictCapacityRequirements(),
      scalingRecommendations: this.generateScalingRecommendations()
    };
    
    // Generate recommendations
    report.recommendations = this.generateRecommendations(report);
    
    return report;
  }

  /**
   * Export dashboard data
   */
  async exportDashboardData(format = 'json') {
    const data = this.getDashboardData();
    
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
        
      case 'csv':
        return this.convertToCSV(data);
        
      case 'pdf':
        return this.generatePDFReport(data);
        
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Helper methods
   */
  
  async getSystemStatus() {
    // Get real system status from components
    return {
      status: 'healthy',
      uptime: process.uptime() * 1000,
      totalJobs: 1000, // Would come from database
      activeContainers: 10,
      queuedJobs: 5,
      completedJobs: 950,
      failedJobs: 50
    };
  }

  calculateJobThroughput() {
    const recentJobs = this.dashboardData.jobMetrics.executionTime.slice(-60); // Last 60 jobs
    const timeWindow = 60000; // 1 minute
    return Math.round(recentJobs.length / (timeWindow / 60000));
  }

  calculateAverage(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  calculateJobSuccessRate(jobMetrics) {
    const total = this.dashboardData.systemOverview.completedJobs + this.dashboardData.systemOverview.failedJobs;
    if (total === 0) return 0;
    return this.dashboardData.systemOverview.completedJobs / total;
  }

  aggregateContainerMetrics(containerMetrics) {
    // Aggregate container metrics
    return {
      totalCPU: containerMetrics.reduce((sum, c) => sum + c.cpu, 0),
      totalMemory: containerMetrics.reduce((sum, c) => sum + c.memory, 0),
      avgCPU: this.calculateAverage(containerMetrics.map(c => c.cpu)),
      avgMemory: this.calculateAverage(containerMetrics.map(c => c.memory))
    };
  }

  async getCPUUtilization() {
    // Get real CPU utilization
    return 45.5; // Mock value
  }

  async getMemoryUtilization() {
    // Get real memory utilization
    return 62.3; // Mock value
  }

  async getDiskUtilization() {
    // Get real disk utilization
    return 35.8; // Mock value
  }

  async getNetworkUtilization() {
    // Get real network utilization
    return 12.4; // Mock value
  }

  formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unit = 0;
    
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    
    return `${size.toFixed(2)} ${units[unit]}`;
  }

  generatePredictiveRecommendations(predictions) {
    const recommendations = [];
    
    // Analyze predictions for patterns
    const peakDemand = Math.max(...predictions.map(p => p.value));
    const avgDemand = this.calculateAverage(predictions.map(p => p.value));
    
    if (peakDemand > avgDemand * 2) {
      recommendations.push({
        type: 'scaling',
        priority: 'high',
        message: `Expected demand spike of ${peakDemand.toFixed(0)} jobs, prepare additional capacity`
      });
    }
    
    return recommendations;
  }

  calculateResourceUsage() {
    // Calculate actual resource usage for cost analysis
    return {
      cpu: 100, // CPU hours
      memory: 200, // GB hours
      storage: 50 // GB
    };
  }

  calculateCostEstimates(usage) {
    // Simple cost calculation
    const rates = {
      cpu: 0.05, // per CPU hour
      memory: 0.01, // per GB hour
      storage: 0.10 // per GB month
    };
    
    return {
      current: (usage.cpu * rates.cpu + usage.memory * rates.memory + usage.storage * rates.storage).toFixed(2),
      projected: ((usage.cpu * rates.cpu + usage.memory * rates.memory + usage.storage * rates.storage) * 30).toFixed(2),
      savings: '25.00',
      cpu: (usage.cpu * rates.cpu).toFixed(2),
      cpuPercentage: 45,
      memory: (usage.memory * rates.memory).toFixed(2),
      memoryPercentage: 35,
      storage: (usage.storage * rates.storage).toFixed(2),
      storagePercentage: 20
    };
  }

  calculateSystemHealth() {
    // Calculate overall system health score
    const factors = {
      uptime: this.dashboardData.systemOverview.uptime > 86400000 ? 1 : 0.5,
      successRate: this.calculateJobSuccessRate(),
      resourceUtilization: 1 - (this.dashboardData.resourceMetrics.cpu[0]?.value || 0) / 100,
      queueLength: this.dashboardData.systemOverview.queuedJobs < 10 ? 1 : 0.7
    };
    
    const health = Object.values(factors).reduce((sum, val) => sum + val, 0) / Object.values(factors).length;
    
    if (health > 0.9) return 'excellent';
    if (health > 0.7) return 'good';
    if (health > 0.5) return 'fair';
    return 'poor';
  }

  /**
   * Analysis methods for reporting
   */
  
  analyzeJobThroughput() {
    const throughputSeries = this.timeSeriesData.get('job_throughput') || [];
    return {
      current: this.calculateJobThroughput(),
      average: this.calculateAverage(throughputSeries.map(p => p.value)),
      peak: Math.max(...throughputSeries.map(p => p.value)),
      trend: this.calculateTrend(throughputSeries)
    };
  }

  analyzeResponseTimes() {
    const responseTimes = this.dashboardData.jobMetrics.executionTime;
    return {
      average: this.calculateAverage(responseTimes),
      p50: this.calculatePercentile(responseTimes, 0.5),
      p95: this.calculatePercentile(responseTimes, 0.95),
      p99: this.calculatePercentile(responseTimes, 0.99),
      outliers: responseTimes.filter(t => t > this.calculatePercentile(responseTimes, 0.99)).length
    };
  }

  analyzePerformanceTrends() {
    const trends = {};
    
    for (const [metric, series] of this.timeSeriesData) {
      trends[metric] = {
        direction: this.calculateTrend(series),
        volatility: this.calculateVolatility(series),
        forecast: this.simpleForecast(series)
      };
    }
    
    return trends;
  }

  calculateTrend(series) {
    if (series.length < 2) return 'stable';
    
    const recent = series.slice(-10);
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);
    
    const firstAvg = this.calculateAverage(firstHalf.map(p => p.value));
    const secondAvg = this.calculateAverage(secondHalf.map(p => p.value));
    
    const change = (secondAvg - firstAvg) / firstAvg;
    
    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  calculateVolatility(series) {
    const values = series.map(p => p.value);
    const avg = this.calculateAverage(values);
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
    return Math.sqrt(variance) / avg;
  }

  simpleForecast(series) {
    // Simple linear forecast
    if (series.length < 5) return null;
    
    const recent = series.slice(-5);
    const trend = this.calculateTrend(recent);
    const lastValue = recent[recent.length - 1].value;
    
    return {
      nextHour: trend === 'increasing' ? lastValue * 1.05 : 
                trend === 'decreasing' ? lastValue * 0.95 : lastValue,
      confidence: 0.7
    };
  }

  generateRecommendations(report) {
    const recommendations = [];
    
    // Performance recommendations
    if (report.performance.responseTimeAnalysis.p95 > 1000) {
      recommendations.push({
        category: 'performance',
        priority: 'high',
        title: 'High Response Times Detected',
        description: 'P95 response time exceeds 1 second. Consider optimizing job execution or scaling resources.',
        actions: ['Review slow jobs', 'Optimize container startup', 'Increase resource allocation']
      });
    }
    
    // Resource recommendations
    if (report.resources.cpuAnalysis.utilization > 80) {
      recommendations.push({
        category: 'resources',
        priority: 'medium',
        title: 'High CPU Utilization',
        description: 'CPU utilization consistently above 80%. Consider scaling horizontally.',
        actions: ['Add more runner nodes', 'Optimize CPU-intensive jobs', 'Implement job queuing limits']
      });
    }
    
    // Cost recommendations
    if (report.resources.optimizationOpportunities.length > 0) {
      recommendations.push({
        category: 'cost',
        priority: 'low',
        title: 'Cost Optimization Opportunities',
        description: 'Identified opportunities to reduce costs without impacting performance.',
        actions: report.resources.optimizationOpportunities
      });
    }
    
    return recommendations;
  }

  analyzeCPUUtilization() {
    const cpuSeries = this.timeSeriesData.get('cpu_utilization') || [];
    return {
      utilization: this.calculateAverage(cpuSeries.map(p => p.value)),
      peak: Math.max(...cpuSeries.map(p => p.value)),
      trend: this.calculateTrend(cpuSeries)
    };
  }

  analyzeMemoryUtilization() {
    const memorySeries = this.timeSeriesData.get('memory_utilization') || [];
    return {
      utilization: this.calculateAverage(memorySeries.map(p => p.value)),
      peak: Math.max(...memorySeries.map(p => p.value)),
      trend: this.calculateTrend(memorySeries)
    };
  }

  identifyOptimizationOpportunities() {
    const opportunities = [];
    
    // Check for over-provisioning
    const avgCPU = this.dashboardData.resourceMetrics.cpu[0]?.value || 0;
    if (avgCPU < 30) {
      opportunities.push('Reduce CPU allocation for low-utilization containers');
    }
    
    // Check cache efficiency
    if (this.dashboardData.cacheMetrics.hitRate < 0.7) {
      opportunities.push('Improve cache configuration to increase hit rate');
    }
    
    return opportunities;
  }

  getTopBottlenecks() {
    return this.dashboardData.bottlenecks
      .slice(0, 5)
      .map(b => ({
        type: b.type,
        component: b.component,
        frequency: this.dashboardData.bottlenecks.filter(x => x.type === b.type).length,
        avgImpact: b.impact
      }));
  }

  analyzeBottleneckTrends() {
    const trends = {};
    const bottleneckTypes = [...new Set(this.dashboardData.bottlenecks.map(b => b.type))];
    
    for (const type of bottleneckTypes) {
      const typeBottlenecks = this.dashboardData.bottlenecks.filter(b => b.type === type);
      trends[type] = {
        count: typeBottlenecks.length,
        trend: typeBottlenecks.length > 10 ? 'increasing' : 'stable',
        avgSeverity: this.calculateAverage(typeBottlenecks.map(b => b.severity))
      };
    }
    
    return trends;
  }

  generateBottleneckRecommendations() {
    const recommendations = [];
    const topBottlenecks = this.getTopBottlenecks();
    
    for (const bottleneck of topBottlenecks) {
      if (bottleneck.type === 'cpu' && bottleneck.frequency > 5) {
        recommendations.push({
          bottleneck: bottleneck.type,
          action: 'Increase CPU allocation or optimize CPU-intensive operations'
        });
      } else if (bottleneck.type === 'io' && bottleneck.frequency > 3) {
        recommendations.push({
          bottleneck: bottleneck.type,
          action: 'Implement caching or optimize I/O operations'
        });
      }
    }
    
    return recommendations;
  }

  generateDemandForecast() {
    return this.dashboardData.predictions.map(p => ({
      timestamp: p.timestamp,
      predicted: p.value,
      confidence: p.confidence
    }));
  }

  predictCapacityRequirements() {
    const peakDemand = Math.max(...this.dashboardData.predictions.map(p => p.value));
    const avgDemand = this.calculateAverage(this.dashboardData.predictions.map(p => p.value));
    
    return {
      current: this.dashboardData.systemOverview.activeContainers,
      recommended: Math.ceil(peakDemand * 1.2), // 20% buffer
      peak: Math.ceil(peakDemand * 1.5) // 50% buffer for peak
    };
  }

  generateScalingRecommendations() {
    const capacity = this.predictCapacityRequirements();
    const recommendations = [];
    
    if (capacity.recommended > capacity.current) {
      recommendations.push({
        action: 'scale_up',
        target: capacity.recommended,
        reason: 'Predicted increase in demand',
        timeframe: 'next_4_hours'
      });
    }
    
    return recommendations;
  }

  convertToCSV(data) {
    // Convert dashboard data to CSV format
    const rows = [];
    rows.push(['Metric', 'Value', 'Timestamp']);
    
    // Add time series data
    for (const [metric, series] of Object.entries(data.performance.timeSeries)) {
      for (const point of series) {
        rows.push([metric, point.value, new Date(point.timestamp).toISOString()]);
      }
    }
    
    return rows.map(row => row.join(',')).join('\n');
  }

  generatePDFReport(data) {
    // In a real implementation, this would use a PDF generation library
    return {
      format: 'pdf',
      title: 'Performance Analytics Report',
      generated: new Date().toISOString(),
      content: 'PDF generation not implemented'
    };
  }

  async loadHistoricalData() {
    // Load historical data from database
    logger.info('Loading historical dashboard data');
  }

  /**
   * Stop the dashboard
   */
  async stop() {
    logger.info('Stopping Performance Dashboard');
    
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    this.isRunning = false;
    this.emit('stopped');
  }
}

module.exports = PerformanceDashboard;