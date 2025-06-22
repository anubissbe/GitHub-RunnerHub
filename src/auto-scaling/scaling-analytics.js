/**
 * Scaling Analytics and Metrics System
 * Comprehensive analytics for auto-scaling performance and insights
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class ScalingAnalytics extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Collection configuration
      metricsInterval: options.metricsInterval || 30000, // 30 seconds
      retentionPeriod: options.retentionPeriod || 30 * 24 * 60 * 60 * 1000, // 30 days
      aggregationLevels: options.aggregationLevels || ['minute', 'hour', 'day'],
      
      // Analytics configuration
      anomalyDetection: {
        enabled: options.anomalyDetectionEnabled !== false,
        threshold: options.anomalyThreshold || 3, // 3 standard deviations
        window: options.anomalyWindow || 100 // data points
      },
      
      // Performance tracking
      performance: {
        trackPredictionAccuracy: options.trackPredictionAccuracy !== false,
        trackScalingLatency: options.trackScalingLatency !== false,
        trackCostEfficiency: options.trackCostEfficiency !== false,
        trackUserSatisfaction: options.trackUserSatisfaction !== false
      },
      
      // Reporting configuration
      reporting: {
        enabled: options.reportingEnabled !== false,
        formats: ['json', 'csv', 'html'],
        destinations: options.reportDestinations || ['file'],
        schedule: options.reportSchedule || 'daily'
      },
      
      // Dashboard configuration
      dashboard: {
        enabled: options.dashboardEnabled !== false,
        refreshInterval: options.dashboardRefreshInterval || 15000, // 15 seconds
        widgets: options.dashboardWidgets || [
          'scaling_events',
          'prediction_accuracy',
          'cost_trends',
          'performance_metrics',
          'capacity_utilization'
        ]
      },
      
      // Integration points
      predictor: options.predictor || null,
      scaler: options.scaler || null,
      costOptimizer: options.costOptimizer || null,
      prewarmer: options.prewarmer || null,
      
      ...options
    };
    
    // Metrics storage
    this.metrics = {
      raw: new Map(), // timestamp -> metrics
      aggregated: {
        minute: new Map(),
        hour: new Map(),
        day: new Map()
      },
      current: {
        timestamp: null,
        scaling: {},
        performance: {},
        cost: {},
        capacity: {}
      }
    };
    
    // Scaling events tracking
    this.scalingEvents = [];
    this.scalingDecisions = [];
    
    // Performance metrics
    this.performance = {
      predictionAccuracy: {
        shortTerm: [],
        mediumTerm: [],
        longTerm: []
      },
      scalingLatency: {
        scaleUp: [],
        scaleDown: []
      },
      costEfficiency: {
        savingsRealized: 0,
        wasteReduced: 0,
        optimizationImpact: 0
      },
      systemHealth: {
        availability: 0.999,
        reliability: 0.995,
        responsiveness: 0.98
      }
    };
    
    // Analytics insights
    this.insights = {
      patterns: new Map(),
      trends: new Map(),
      anomalies: [],
      recommendations: []
    };
    
    // Dashboard data
    this.dashboardData = {
      widgets: new Map(),
      lastUpdate: null,
      updateCount: 0
    };
    
    // Statistics
    this.stats = {
      metricsCollected: 0,
      eventsTracked: 0,
      reportsGenerated: 0,
      anomaliesDetected: 0,
      insightsGenerated: 0,
      dashboardUpdates: 0
    };
    
    this.metricsTimer = null;
    this.aggregationTimer = null;
    this.reportingTimer = null;
    this.dashboardTimer = null;
    this.isStarted = false;
  }

  /**
   * Start scaling analytics
   */
  async start() {
    if (this.isStarted) {
      logger.warn('Scaling Analytics already started');
      return;
    }
    
    logger.info('Starting Scaling Analytics');
    
    // Start metrics collection
    this.metricsTimer = setInterval(() => {
      this.collectMetrics().catch(error => {
        logger.error('Metrics collection failed:', error);
      });
    }, this.config.metricsInterval);
    
    // Start aggregation
    this.aggregationTimer = setInterval(() => {
      this.performAggregation().catch(error => {
        logger.error('Metrics aggregation failed:', error);
      });
    }, 60000); // Every minute
    
    // Start dashboard updates
    if (this.config.dashboard.enabled) {
      this.dashboardTimer = setInterval(() => {
        this.updateDashboard().catch(error => {
          logger.error('Dashboard update failed:', error);
        });
      }, this.config.dashboard.refreshInterval);
    }
    
    // Start reporting
    if (this.config.reporting.enabled) {
      this.scheduleReporting();
    }
    
    // Initial data collection
    await this.collectMetrics();
    await this.updateDashboard();
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Scaling Analytics started successfully');
  }

  /**
   * Collect metrics
   */
  async collectMetrics() {
    const timestamp = Date.now();
    const metrics = {
      timestamp,
      scaling: await this.collectScalingMetrics(),
      performance: await this.collectPerformanceMetrics(),
      cost: await this.collectCostMetrics(),
      capacity: await this.collectCapacityMetrics(),
      prediction: await this.collectPredictionMetrics()
    };
    
    // Store raw metrics
    this.metrics.raw.set(timestamp, metrics);
    this.metrics.current = metrics;
    
    // Cleanup old data
    this.cleanupOldMetrics();
    
    // Detect anomalies
    if (this.config.anomalyDetection.enabled) {
      await this.detectAnomalies(metrics);
    }
    
    // Generate insights
    await this.generateInsights(metrics);
    
    this.stats.metricsCollected++;
    
    this.emit('metricsCollected', metrics);
  }

  /**
   * Collect scaling metrics
   */
  async collectScalingMetrics() {
    const metrics = {
      totalRunners: 0,
      activeRunners: 0,
      idleRunners: 0,
      startingRunners: 0,
      failedRunners: 0,
      utilizationRate: 0,
      queueLength: 0,
      avgWaitTime: 0,
      scalingInProgress: false,
      lastScaleAction: null,
      lastScaleTime: null
    };
    
    // Get scaling controller metrics
    if (this.config.scaler) {
      try {
        const scalerStats = this.config.scaler.getStatistics();
        Object.assign(metrics, {
          totalRunners: scalerStats.currentRunners || 0,
          lastScaleAction: scalerStats.lastScaleUp || scalerStats.lastScaleDown,
          inCooldown: scalerStats.inCooldown
        });
      } catch (error) {
        logger.error('Failed to get scaler metrics:', error);
      }
    }
    
    return metrics;
  }

  /**
   * Collect performance metrics
   */
  async collectPerformanceMetrics() {
    const metrics = {
      systemLatency: 0,
      responseTime: 0,
      throughput: 0,
      errorRate: 0,
      availability: 0,
      reliability: 0
    };
    
    // Calculate prediction accuracy
    if (this.config.predictor) {
      try {
        const predictorStats = this.config.predictor.getStatistics();
        metrics.predictionAccuracy = {
          shortTerm: predictorStats.accuracy?.shortTerm?.correct / predictorStats.accuracy?.shortTerm?.total || 0,
          mediumTerm: predictorStats.accuracy?.mediumTerm?.correct / predictorStats.accuracy?.mediumTerm?.total || 0,
          longTerm: predictorStats.accuracy?.longTerm?.correct / predictorStats.accuracy?.longTerm?.total || 0
        };
      } catch (error) {
        logger.error('Failed to get predictor metrics:', error);
      }
    }
    
    return metrics;
  }

  /**
   * Collect cost metrics
   */
  async collectCostMetrics() {
    const metrics = {
      currentHourlyRate: 0,
      dailySpend: 0,
      monthlyProjection: 0,
      savingsRealized: 0,
      costPerJob: 0,
      efficiency: 0
    };
    
    // Get cost optimizer metrics
    if (this.config.costOptimizer) {
      try {
        const costStats = this.config.costOptimizer.getStatistics();
        Object.assign(metrics, {
          currentHourlyRate: costStats.costs?.current?.hourly || 0,
          dailySpend: costStats.costs?.current?.daily || 0,
          monthlyProjection: costStats.costs?.current?.projected || 0,
          savingsRealized: costStats.savings?.total || 0
        });
      } catch (error) {
        logger.error('Failed to get cost metrics:', error);
      }
    }
    
    return metrics;
  }

  /**
   * Collect capacity metrics
   */
  async collectCapacityMetrics() {
    const metrics = {
      totalCapacity: 0,
      usedCapacity: 0,
      availableCapacity: 0,
      reservedCapacity: 0,
      utilizationPercentage: 0,
      prewarmPoolSize: 0,
      prewarmUtilization: 0
    };
    
    // Get prewarmer metrics
    if (this.config.prewarmer) {
      try {
        const prewarmerStats = this.config.prewarmer.getStatistics();
        Object.assign(metrics, {
          prewarmPoolSize: prewarmerStats.poolState?.totalContainers || 0,
          prewarmUtilization: prewarmerStats.poolState?.availableContainers || 0
        });
      } catch (error) {
        logger.error('Failed to get prewarmer metrics:', error);
      }
    }
    
    return metrics;
  }

  /**
   * Collect prediction metrics
   */
  async collectPredictionMetrics() {
    const metrics = {
      shortTermPrediction: 0,
      mediumTermPrediction: 0,
      longTermPrediction: 0,
      confidence: 0,
      lastUpdate: null
    };
    
    if (this.config.predictor) {
      try {
        const predictions = await this.config.predictor.predict();
        Object.assign(metrics, {
          shortTermPrediction: predictions.shortTerm?.jobs || 0,
          mediumTermPrediction: predictions.mediumTerm?.jobs || 0,
          longTermPrediction: predictions.longTerm?.jobs || 0,
          confidence: predictions.shortTerm?.confidence || 0,
          lastUpdate: new Date()
        });
      } catch (error) {
        logger.error('Failed to get prediction metrics:', error);
      }
    }
    
    return metrics;
  }

  /**
   * Cleanup old metrics
   */
  cleanupOldMetrics() {
    const cutoff = Date.now() - this.config.retentionPeriod;
    
    for (const [timestamp] of this.metrics.raw) {
      if (timestamp < cutoff) {
        this.metrics.raw.delete(timestamp);
      }
    }
    
    // Cleanup scaling events
    this.scalingEvents = this.scalingEvents.filter(event => 
      event.timestamp.getTime() > cutoff
    );
  }

  /**
   * Detect anomalies
   */
  async detectAnomalies(metrics) {
    const anomalies = [];
    
    // Get recent metrics for comparison
    const recentMetrics = Array.from(this.metrics.raw.values())
      .slice(-this.config.anomalyDetection.window);
    
    if (recentMetrics.length < 10) return; // Need minimum data
    
    // Check various metrics for anomalies
    const checks = [
      { key: 'scaling.utilizationRate', name: 'Utilization Rate' },
      { key: 'performance.responseTime', name: 'Response Time' },
      { key: 'cost.currentHourlyRate', name: 'Hourly Cost' },
      { key: 'capacity.utilizationPercentage', name: 'Capacity Utilization' }
    ];
    
    for (const check of checks) {
      const values = recentMetrics.map(m => this.getNestedValue(m, check.key))
        .filter(v => v !== undefined && v !== null);
      
      if (values.length < 5) continue;
      
      const current = this.getNestedValue(metrics, check.key);
      if (current === undefined || current === null) continue;
      
      const anomaly = this.detectValueAnomaly(values, current);
      if (anomaly) {
        anomalies.push({
          type: 'statistical_anomaly',
          metric: check.name,
          current,
          expected: anomaly.expected,
          deviation: anomaly.deviation,
          severity: anomaly.severity,
          timestamp: new Date(metrics.timestamp)
        });
      }
    }
    
    // Store anomalies
    this.insights.anomalies.push(...anomalies);
    
    // Keep only recent anomalies
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    this.insights.anomalies = this.insights.anomalies.filter(a => 
      a.timestamp.getTime() > recentCutoff
    );
    
    this.stats.anomaliesDetected += anomalies.length;
    
    if (anomalies.length > 0) {
      this.emit('anomaliesDetected', anomalies);
    }
  }

  /**
   * Get nested value from object
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => 
      current && current[key] !== undefined ? current[key] : undefined, obj
    );
  }

  /**
   * Detect value anomaly
   */
  detectValueAnomaly(values, current) {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) return null; // No variation
    
    const zScore = Math.abs((current - mean) / stdDev);
    
    if (zScore > this.config.anomalyDetection.threshold) {
      return {
        expected: mean,
        deviation: zScore,
        severity: zScore > 5 ? 'critical' : zScore > 4 ? 'high' : 'medium'
      };
    }
    
    return null;
  }

  /**
   * Generate insights
   */
  async generateInsights(metrics) {
    // Generate trend insights
    this.generateTrendInsights();
    
    // Generate pattern insights
    this.generatePatternInsights();
    
    // Generate performance insights
    this.generatePerformanceInsights(metrics);
    
    // Generate cost insights
    this.generateCostInsights(metrics);
    
    this.stats.insightsGenerated++;
  }

  /**
   * Generate trend insights
   */
  generateTrendInsights() {
    const trends = new Map();
    
    // Analyze utilization trend
    const recentMetrics = Array.from(this.metrics.raw.values()).slice(-100);
    if (recentMetrics.length >= 10) {
      const utilizationValues = recentMetrics
        .map(m => m.scaling?.utilizationRate)
        .filter(v => v !== undefined);
      
      if (utilizationValues.length >= 5) {
        const trend = this.calculateTrend(utilizationValues);
        trends.set('utilization', {
          direction: trend.direction,
          strength: trend.strength,
          projection: trend.projection
        });
      }
    }
    
    this.insights.trends = trends;
  }

  /**
   * Calculate trend
   */
  calculateTrend(values) {
    if (values.length < 2) return { direction: 'stable', strength: 0 };
    
    // Simple linear regression
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    const direction = slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable';
    const strength = Math.abs(slope);
    const projection = intercept + slope * n;
    
    return { direction, strength, projection };
  }

  /**
   * Generate pattern insights
   */
  generatePatternInsights() {
    // Analyze daily patterns
    const patterns = new Map();
    
    const hourlyData = new Map();
    for (const [timestamp, metrics] of this.metrics.raw) {
      const hour = new Date(timestamp).getHours();
      if (!hourlyData.has(hour)) {
        hourlyData.set(hour, []);
      }
      if (metrics.scaling?.utilizationRate !== undefined) {
        hourlyData.get(hour).push(metrics.scaling.utilizationRate);
      }
    }
    
    // Find peak hours
    const hourlyAverages = new Map();
    for (const [hour, values] of hourlyData) {
      if (values.length >= 3) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        hourlyAverages.set(hour, avg);
      }
    }
    
    if (hourlyAverages.size > 0) {
      const maxHour = Array.from(hourlyAverages.entries())
        .reduce((max, [hour, avg]) => avg > max[1] ? [hour, avg] : max);
      
      patterns.set('peak_hour', {
        hour: maxHour[0],
        utilization: maxHour[1]
      });
    }
    
    this.insights.patterns = patterns;
  }

  /**
   * Generate performance insights
   */
  generatePerformanceInsights(metrics) {
    const insights = [];
    
    // Check prediction accuracy
    if (metrics.performance?.predictionAccuracy) {
      const accuracy = metrics.performance.predictionAccuracy;
      if (accuracy.shortTerm < 0.7) {
        insights.push({
          type: 'performance',
          severity: 'medium',
          message: 'Short-term prediction accuracy is low',
          recommendation: 'Consider adjusting prediction model parameters',
          metric: 'prediction_accuracy',
          value: accuracy.shortTerm
        });
      }
    }
    
    // Check scaling latency
    if (this.config.scaler) {
      const scalerStats = this.config.scaler.getStatistics();
      if (scalerStats.metrics?.avgScaleUpTime > 300000) { // 5 minutes
        insights.push({
          type: 'performance',
          severity: 'high',
          message: 'Scale-up time is too slow',
          recommendation: 'Increase pre-warmed container pool size',
          metric: 'scale_up_time',
          value: scalerStats.metrics.avgScaleUpTime
        });
      }
    }
    
    this.insights.recommendations = insights;
  }

  /**
   * Generate cost insights
   */
  generateCostInsights(metrics) {
    if (!metrics.cost) return;
    
    const insights = [];
    
    // Check cost trends
    if (metrics.cost.currentHourlyRate > 10) { // $10/hour threshold
      insights.push({
        type: 'cost',
        severity: 'medium',
        message: 'High hourly cost detected',
        recommendation: 'Consider using more spot instances',
        metric: 'hourly_rate',
        value: metrics.cost.currentHourlyRate
      });
    }
    
    // Check cost efficiency
    if (metrics.cost.efficiency < 0.5) {
      insights.push({
        type: 'cost',
        severity: 'high',
        message: 'Low cost efficiency',
        recommendation: 'Review resource allocation and rightsizing',
        metric: 'cost_efficiency',
        value: metrics.cost.efficiency
      });
    }
    
    this.insights.recommendations.push(...insights);
  }

  /**
   * Perform aggregation
   */
  async performAggregation() {
    const now = Date.now();
    
    // Aggregate to minute level
    await this.aggregateToLevel('minute', 60000); // 1 minute
    
    // Aggregate to hour level (every hour)
    if (now % 3600000 < 60000) {
      await this.aggregateToLevel('hour', 3600000); // 1 hour
    }
    
    // Aggregate to day level (daily at midnight)
    if (now % 86400000 < 60000) {
      await this.aggregateToLevel('day', 86400000); // 1 day
    }
  }

  /**
   * Aggregate to specific level
   */
  async aggregateToLevel(level, interval) {
    const now = Date.now();
    const bucketStart = Math.floor(now / interval) * interval;
    
    // Get raw metrics for this bucket
    const bucketMetrics = [];
    for (const [timestamp, metrics] of this.metrics.raw) {
      if (timestamp >= bucketStart && timestamp < bucketStart + interval) {
        bucketMetrics.push(metrics);
      }
    }
    
    if (bucketMetrics.length === 0) return;
    
    // Calculate aggregated values
    const aggregated = {
      timestamp: bucketStart,
      count: bucketMetrics.length,
      scaling: this.aggregateScalingMetrics(bucketMetrics),
      performance: this.aggregatePerformanceMetrics(bucketMetrics),
      cost: this.aggregateCostMetrics(bucketMetrics),
      capacity: this.aggregateCapacityMetrics(bucketMetrics)
    };
    
    this.metrics.aggregated[level].set(bucketStart, aggregated);
    
    // Cleanup old aggregated data
    const cutoff = now - this.config.retentionPeriod;
    for (const [timestamp] of this.metrics.aggregated[level]) {
      if (timestamp < cutoff) {
        this.metrics.aggregated[level].delete(timestamp);
      }
    }
  }

  /**
   * Aggregate scaling metrics
   */
  aggregateScalingMetrics(metrics) {
    const values = metrics.map(m => m.scaling).filter(s => s);
    if (values.length === 0) return {};
    
    return {
      avgUtilization: this.average(values.map(v => v.utilizationRate)),
      maxUtilization: this.max(values.map(v => v.utilizationRate)),
      avgQueueLength: this.average(values.map(v => v.queueLength)),
      maxQueueLength: this.max(values.map(v => v.queueLength)),
      avgRunners: this.average(values.map(v => v.totalRunners)),
      maxRunners: this.max(values.map(v => v.totalRunners))
    };
  }

  /**
   * Aggregate performance metrics
   */
  aggregatePerformanceMetrics(metrics) {
    const values = metrics.map(m => m.performance).filter(p => p);
    if (values.length === 0) return {};
    
    return {
      avgLatency: this.average(values.map(v => v.systemLatency)),
      maxLatency: this.max(values.map(v => v.systemLatency)),
      avgResponseTime: this.average(values.map(v => v.responseTime)),
      maxResponseTime: this.max(values.map(v => v.responseTime)),
      avgThroughput: this.average(values.map(v => v.throughput)),
      avgErrorRate: this.average(values.map(v => v.errorRate))
    };
  }

  /**
   * Aggregate cost metrics
   */
  aggregateCostMetrics(metrics) {
    const values = metrics.map(m => m.cost).filter(c => c);
    if (values.length === 0) return {};
    
    return {
      avgHourlyRate: this.average(values.map(v => v.currentHourlyRate)),
      maxHourlyRate: this.max(values.map(v => v.currentHourlyRate)),
      totalSpend: this.sum(values.map(v => v.dailySpend / 24)), // Per hour
      avgCostPerJob: this.average(values.map(v => v.costPerJob)),
      avgEfficiency: this.average(values.map(v => v.efficiency))
    };
  }

  /**
   * Aggregate capacity metrics
   */
  aggregateCapacityMetrics(metrics) {
    const values = metrics.map(m => m.capacity).filter(c => c);
    if (values.length === 0) return {};
    
    return {
      avgUtilization: this.average(values.map(v => v.utilizationPercentage)),
      maxUtilization: this.max(values.map(v => v.utilizationPercentage)),
      avgCapacity: this.average(values.map(v => v.totalCapacity)),
      avgPrewarmPool: this.average(values.map(v => v.prewarmPoolSize))
    };
  }

  /**
   * Calculate average
   */
  average(values) {
    const filtered = values.filter(v => v !== undefined && v !== null);
    return filtered.length > 0 ? filtered.reduce((a, b) => a + b, 0) / filtered.length : 0;
  }

  /**
   * Calculate maximum
   */
  max(values) {
    const filtered = values.filter(v => v !== undefined && v !== null);
    return filtered.length > 0 ? Math.max(...filtered) : 0;
  }

  /**
   * Calculate sum
   */
  sum(values) {
    const filtered = values.filter(v => v !== undefined && v !== null);
    return filtered.reduce((a, b) => a + b, 0);
  }

  /**
   * Update dashboard
   */
  async updateDashboard() {
    if (!this.config.dashboard.enabled) return;
    
    const dashboardData = {};
    
    for (const widget of this.config.dashboard.widgets) {
      try {
        dashboardData[widget] = await this.generateWidgetData(widget);
      } catch (error) {
        logger.error(`Failed to generate widget data for ${widget}:`, error);
        dashboardData[widget] = { error: error.message };
      }
    }
    
    this.dashboardData.widgets = new Map(Object.entries(dashboardData));
    this.dashboardData.lastUpdate = new Date();
    this.dashboardData.updateCount++;
    
    this.stats.dashboardUpdates++;
    
    this.emit('dashboardUpdated', dashboardData);
  }

  /**
   * Generate widget data
   */
  async generateWidgetData(widget) {
    switch (widget) {
      case 'scaling_events':
        return this.generateScalingEventsWidget();
      case 'prediction_accuracy':
        return this.generatePredictionAccuracyWidget();
      case 'cost_trends':
        return this.generateCostTrendsWidget();
      case 'performance_metrics':
        return this.generatePerformanceMetricsWidget();
      case 'capacity_utilization':
        return this.generateCapacityUtilizationWidget();
      default:
        throw new Error(`Unknown widget: ${widget}`);
    }
  }

  /**
   * Generate scaling events widget
   */
  generateScalingEventsWidget() {
    const recentEvents = this.scalingEvents.slice(-20);
    const eventCounts = {
      scaleUp: 0,
      scaleDown: 0,
      failed: 0
    };
    
    for (const event of recentEvents) {
      if (event.success) {
        eventCounts[event.action] = (eventCounts[event.action] || 0) + 1;
      } else {
        eventCounts.failed++;
      }
    }
    
    return {
      title: 'Recent Scaling Events',
      type: 'chart',
      data: {
        events: recentEvents,
        summary: eventCounts,
        timeline: this.generateEventTimeline(recentEvents)
      }
    };
  }

  /**
   * Generate prediction accuracy widget
   */
  generatePredictionAccuracyWidget() {
    const accuracy = this.performance.predictionAccuracy;
    
    return {
      title: 'Prediction Accuracy',
      type: 'gauge',
      data: {
        shortTerm: this.average(accuracy.shortTerm.slice(-10)),
        mediumTerm: this.average(accuracy.mediumTerm.slice(-10)),
        longTerm: this.average(accuracy.longTerm.slice(-10)),
        overall: (
          this.average(accuracy.shortTerm.slice(-10)) +
          this.average(accuracy.mediumTerm.slice(-10)) +
          this.average(accuracy.longTerm.slice(-10))
        ) / 3
      }
    };
  }

  /**
   * Generate cost trends widget
   */
  generateCostTrendsWidget() {
    const recentCosts = Array.from(this.metrics.raw.values())
      .slice(-100)
      .map(m => ({
        timestamp: m.timestamp,
        hourlyRate: m.cost?.currentHourlyRate || 0,
        efficiency: m.cost?.efficiency || 0
      }));
    
    return {
      title: 'Cost Trends',
      type: 'line_chart',
      data: {
        timeline: recentCosts,
        current: this.metrics.current?.cost || {},
        trends: this.insights.trends.get('cost') || {}
      }
    };
  }

  /**
   * Generate performance metrics widget
   */
  generatePerformanceMetricsWidget() {
    return {
      title: 'Performance Metrics',
      type: 'metrics_grid',
      data: {
        current: this.metrics.current?.performance || {},
        averages: this.calculatePerformanceAverages(),
        health: this.performance.systemHealth
      }
    };
  }

  /**
   * Generate capacity utilization widget
   */
  generateCapacityUtilizationWidget() {
    const recent = Array.from(this.metrics.raw.values()).slice(-50);
    const utilization = recent.map(m => ({
      timestamp: m.timestamp,
      utilization: m.capacity?.utilizationPercentage || 0,
      capacity: m.capacity?.totalCapacity || 0
    }));
    
    return {
      title: 'Capacity Utilization',
      type: 'area_chart',
      data: {
        timeline: utilization,
        current: this.metrics.current?.capacity || {},
        recommendations: this.insights.recommendations.filter(r => 
          r.type === 'capacity'
        )
      }
    };
  }

  /**
   * Calculate performance averages
   */
  calculatePerformanceAverages() {
    const recent = Array.from(this.metrics.raw.values()).slice(-100);
    const perfMetrics = recent.map(m => m.performance).filter(p => p);
    
    if (perfMetrics.length === 0) return {};
    
    return {
      avgLatency: this.average(perfMetrics.map(p => p.systemLatency)),
      avgResponseTime: this.average(perfMetrics.map(p => p.responseTime)),
      avgThroughput: this.average(perfMetrics.map(p => p.throughput)),
      avgErrorRate: this.average(perfMetrics.map(p => p.errorRate))
    };
  }

  /**
   * Generate event timeline
   */
  generateEventTimeline(events) {
    return events.map(event => ({
      timestamp: event.timestamp,
      action: event.action,
      success: event.success,
      duration: event.duration
    }));
  }

  /**
   * Record scaling decision
   */
  recordScalingDecision(decision) {
    this.scalingDecisions.push({
      ...decision,
      id: `decision-${Date.now()}`,
      timestamp: new Date()
    });
    
    // Keep only recent decisions
    if (this.scalingDecisions.length > 1000) {
      this.scalingDecisions.shift();
    }
    
    this.stats.eventsTracked++;
  }

  /**
   * Record scaling event
   */
  recordScalingEvent(event) {
    this.scalingEvents.push({
      ...event,
      id: `event-${Date.now()}`,
      timestamp: new Date(event.timestamp)
    });
    
    // Keep only recent events
    if (this.scalingEvents.length > 1000) {
      this.scalingEvents.shift();
    }
    
    this.stats.eventsTracked++;
  }

  /**
   * Schedule reporting
   */
  scheduleReporting() {
    const interval = this.getReportingInterval();
    
    this.reportingTimer = setInterval(() => {
      this.generateScheduledReport().catch(error => {
        logger.error('Scheduled report generation failed:', error);
      });
    }, interval);
  }

  /**
   * Get reporting interval
   */
  getReportingInterval() {
    switch (this.config.reporting.schedule) {
      case 'hourly': return 3600000;
      case 'daily': return 86400000;
      case 'weekly': return 7 * 86400000;
      default: return 86400000; // daily
    }
  }

  /**
   * Generate scheduled report
   */
  async generateScheduledReport() {
    const report = await this.generateReport('scheduled', {
      period: this.config.reporting.schedule,
      format: this.config.reporting.formats[0]
    });
    
    this.stats.reportsGenerated++;
    
    this.emit('reportGenerated', report);
  }

  /**
   * Generate report
   */
  async generateReport(type, options = {}) {
    const report = {
      id: `report-${Date.now()}`,
      type,
      period: options.period || 'daily',
      format: options.format || 'json',
      generatedAt: new Date(),
      data: {}
    };
    
    // Generate report sections
    report.data.summary = this.generateReportSummary();
    report.data.scaling = this.generateScalingReport();
    report.data.performance = this.generatePerformanceReport();
    report.data.cost = this.generateCostReport();
    report.data.insights = this.generateInsightsReport();
    report.data.recommendations = this.insights.recommendations.slice();
    
    return report;
  }

  /**
   * Generate report summary
   */
  generateReportSummary() {
    return {
      period: 'last_24h',
      metrics: {
        totalEvents: this.scalingEvents.length,
        successRate: this.calculateSuccessRate(),
        avgUtilization: this.calculateAvgUtilization(),
        costSavings: this.performance.costEfficiency.savingsRealized
      },
      health: this.performance.systemHealth,
      anomalies: this.insights.anomalies.length
    };
  }

  /**
   * Generate scaling report
   */
  generateScalingReport() {
    const recentEvents = this.scalingEvents.slice(-100);
    
    return {
      totalEvents: recentEvents.length,
      scaleUpEvents: recentEvents.filter(e => e.action === 'scale-up').length,
      scaleDownEvents: recentEvents.filter(e => e.action === 'scale-down').length,
      successRate: this.calculateSuccessRate(),
      avgLatency: this.average(this.performance.scalingLatency.scaleUp.slice(-10))
    };
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport() {
    return {
      predictionAccuracy: {
        shortTerm: this.average(this.performance.predictionAccuracy.shortTerm.slice(-10)),
        mediumTerm: this.average(this.performance.predictionAccuracy.mediumTerm.slice(-10)),
        longTerm: this.average(this.performance.predictionAccuracy.longTerm.slice(-10))
      },
      systemHealth: this.performance.systemHealth,
      responseTime: this.calculateAvgResponseTime()
    };
  }

  /**
   * Generate cost report
   */
  generateCostReport() {
    return {
      totalSpend: this.calculateTotalSpend(),
      savingsRealized: this.performance.costEfficiency.savingsRealized,
      efficiency: this.performance.costEfficiency.efficiency,
      recommendations: this.insights.recommendations.filter(r => r.type === 'cost')
    };
  }

  /**
   * Generate insights report
   */
  generateInsightsReport() {
    return {
      trends: Object.fromEntries(this.insights.trends),
      patterns: Object.fromEntries(this.insights.patterns),
      anomalies: this.insights.anomalies.slice(-10),
      recommendations: this.insights.recommendations.slice(-10)
    };
  }

  /**
   * Calculate success rate
   */
  calculateSuccessRate() {
    const recent = this.scalingEvents.slice(-100);
    if (recent.length === 0) return 1;
    
    const successful = recent.filter(e => e.success).length;
    return successful / recent.length;
  }

  /**
   * Calculate average utilization
   */
  calculateAvgUtilization() {
    const recent = Array.from(this.metrics.raw.values()).slice(-100);
    const utilizations = recent
      .map(m => m.scaling?.utilizationRate)
      .filter(u => u !== undefined);
    
    return this.average(utilizations);
  }

  /**
   * Calculate average response time
   */
  calculateAvgResponseTime() {
    const recent = Array.from(this.metrics.raw.values()).slice(-100);
    const responseTimes = recent
      .map(m => m.performance?.responseTime)
      .filter(rt => rt !== undefined);
    
    return this.average(responseTimes);
  }

  /**
   * Calculate total spend
   */
  calculateTotalSpend() {
    const recent = Array.from(this.metrics.raw.values()).slice(-100);
    const costs = recent
      .map(m => m.cost?.currentHourlyRate)
      .filter(c => c !== undefined);
    
    return this.sum(costs);
  }

  /**
   * Get analytics dashboard
   */
  getAnalyticsDashboard() {
    return {
      widgets: Object.fromEntries(this.dashboardData.widgets),
      lastUpdate: this.dashboardData.lastUpdate,
      updateCount: this.dashboardData.updateCount,
      insights: {
        trends: Object.fromEntries(this.insights.trends),
        patterns: Object.fromEntries(this.insights.patterns),
        anomalies: this.insights.anomalies.slice(-5),
        recommendations: this.insights.recommendations.slice(-10)
      },
      summary: {
        totalMetrics: this.metrics.raw.size,
        recentEvents: this.scalingEvents.length,
        successRate: this.calculateSuccessRate(),
        systemHealth: this.performance.systemHealth
      }
    };
  }

  /**
   * Stop scaling analytics
   */
  async stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Scaling Analytics');
    
    // Clear timers
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
    
    if (this.dashboardTimer) {
      clearInterval(this.dashboardTimer);
      this.dashboardTimer = null;
    }
    
    if (this.reportingTimer) {
      clearInterval(this.reportingTimer);
      this.reportingTimer = null;
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Scaling Analytics stopped');
  }

  /**
   * Check if healthy
   */
  async isHealthy() {
    return this.isStarted && 
           this.metrics.raw.size > 0 &&
           this.dashboardData.lastUpdate &&
           (Date.now() - this.dashboardData.lastUpdate.getTime() < 60000);
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return {
      ...this.stats,
      metrics: {
        rawDataPoints: this.metrics.raw.size,
        aggregatedPoints: {
          minute: this.metrics.aggregated.minute.size,
          hour: this.metrics.aggregated.hour.size,
          day: this.metrics.aggregated.day.size
        }
      },
      insights: {
        trends: this.insights.trends.size,
        patterns: this.insights.patterns.size,
        anomalies: this.insights.anomalies.length,
        recommendations: this.insights.recommendations.length
      },
      events: {
        scalingEvents: this.scalingEvents.length,
        scalingDecisions: this.scalingDecisions.length
      },
      dashboard: {
        widgets: this.dashboardData.widgets.size,
        lastUpdate: this.dashboardData.lastUpdate,
        updateCount: this.dashboardData.updateCount
      }
    };
  }
}

module.exports = ScalingAnalytics;