/**
 * Performance Analytics Engine
 * Advanced analytics for performance monitoring, trend analysis, and predictive insights
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class PerformanceAnalytics extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Data collection
      collection: {
        interval: options.collectionInterval || 60000, // 1 minute
        batchSize: options.batchSize || 1000,
        retentionDays: options.retentionDays || 30,
        aggregationLevels: options.aggregationLevels || ['1m', '5m', '15m', '1h', '6h', '1d']
      },
      
      // Analytics configuration
      analytics: {
        enableTrendAnalysis: options.enableTrendAnalysis !== false,
        enableAnomalyDetection: options.enableAnomalyDetection !== false,
        enablePredictiveAnalysis: options.enablePredictiveAnalysis !== false,
        enableCapacityPlanning: options.enableCapacityPlanning !== false,
        
        // Thresholds
        anomalyThreshold: options.anomalyThreshold || 2.5, // Standard deviations
        trendWindow: options.trendWindow || 7 * 24 * 60 * 60 * 1000, // 7 days
        predictionWindow: options.predictionWindow || 24 * 60 * 60 * 1000 // 24 hours
      },
      
      // Performance metrics tracking
      metrics: {
        responseTime: options.trackResponseTime !== false,
        throughput: options.trackThroughput !== false,
        errorRate: options.trackErrorRate !== false,
        resourceUtilization: options.trackResourceUtilization !== false,
        jobPerformance: options.trackJobPerformance !== false,
        cachePerformance: options.trackCachePerformance !== false
      },
      
      // Reporting
      reporting: {
        generateReports: options.generateReports !== false,
        reportInterval: options.reportInterval || 24 * 60 * 60 * 1000, // Daily
        emailReports: options.emailReports || false,
        reportRecipients: options.reportRecipients || []
      },
      
      ...options
    };
    
    // Data storage
    this.metricsData = new Map(); // metric -> timeSeriesData
    this.aggregatedData = new Map(); // level -> metric -> aggregatedData
    this.trends = new Map(); // metric -> trendData
    this.anomalies = new Map(); // metric -> anomalyData
    this.predictions = new Map(); // metric -> predictionData
    
    // Analytics state
    this.isAnalyzing = false;
    this.analysisTimer = null;
    this.lastAnalysis = null;
    
    // Performance baselines
    this.baselines = new Map();
    this.thresholds = new Map();
    
    // Statistics
    this.stats = {
      totalDataPoints: 0,
      anomaliesDetected: 0,
      trendsIdentified: 0,
      predictionsGenerated: 0,
      lastCollection: null,
      analysisRuns: 0
    };
  }

  /**
   * Initialize performance analytics
   */
  async initialize() {
    try {
      logger.info('Initializing Performance Analytics Engine');
      
      // Initialize baselines and thresholds
      this.initializeBaselines();
      
      // Load historical data if available
      await this.loadHistoricalData();
      
      // Start analytics processing
      this.startAnalysis();
      
      this.emit('initialized');
      logger.info('Performance Analytics Engine initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Performance Analytics:', error);
      throw error;
    }
  }

  /**
   * Initialize performance baselines
   */
  initializeBaselines() {
    // Response time baselines
    this.baselines.set('http_response_time', {
      p50: 0.1,   // 100ms
      p95: 0.5,   // 500ms
      p99: 1.0    // 1s
    });
    
    // Throughput baselines
    this.baselines.set('http_throughput', {
      requests_per_second: 100,
      peak_capacity: 500
    });
    
    // Error rate baselines
    this.baselines.set('error_rate', {
      http_4xx: 0.05,  // 5%
      http_5xx: 0.01   // 1%
    });
    
    // Resource utilization baselines
    this.baselines.set('resource_utilization', {
      cpu: 0.7,      // 70%
      memory: 0.8,   // 80%
      disk: 0.85     // 85%
    });
    
    // Job performance baselines
    this.baselines.set('job_performance', {
      startup_time: 10,        // 10 seconds
      execution_time: 300,     // 5 minutes
      success_rate: 0.95       // 95%
    });
    
    logger.info('Initialized performance baselines');
  }

  /**
   * Load historical data
   */
  async loadHistoricalData() {
    // In a real implementation, this would load from a database
    logger.info('Loading historical performance data');
    
    // Initialize empty time series for each metric
    const metrics = [
      'http_response_time',
      'http_throughput',
      'error_rate',
      'resource_utilization',
      'job_performance',
      'cache_performance'
    ];
    
    for (const metric of metrics) {
      this.metricsData.set(metric, []);
    }
  }

  /**
   * Start analytics processing
   */
  startAnalysis() {
    if (this.isAnalyzing) {
      logger.warn('Performance analysis already running');
      return;
    }
    
    this.isAnalyzing = true;
    this.analysisTimer = setInterval(() => {
      this.performAnalysis().catch(error => {
        logger.error('Performance analysis failed:', error);
      });
    }, this.config.collection.interval);
    
    logger.info(`Started performance analysis with ${this.config.collection.interval}ms interval`);
  }

  /**
   * Stop analytics processing
   */
  stopAnalysis() {
    if (!this.isAnalyzing) {
      return;
    }
    
    this.isAnalyzing = false;
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
    
    logger.info('Stopped performance analysis');
  }

  /**
   * Perform comprehensive analytics
   */
  async performAnalysis() {
    const startTime = Date.now();
    
    try {
      // Collect current metrics
      await this.collectMetrics();
      
      // Aggregate data
      await this.aggregateData();
      
      // Perform trend analysis
      if (this.config.analytics.enableTrendAnalysis) {
        await this.analyzeTrends();
      }
      
      // Detect anomalies
      if (this.config.analytics.enableAnomalyDetection) {
        await this.detectAnomalies();
      }
      
      // Generate predictions
      if (this.config.analytics.enablePredictiveAnalysis) {
        await this.generatePredictions();
      }
      
      // Capacity planning
      if (this.config.analytics.enableCapacityPlanning) {
        await this.performCapacityPlanning();
      }
      
      // Update statistics
      this.stats.analysisRuns++;
      this.lastAnalysis = new Date();
      
      this.emit('analysisCompleted', {
        duration: Date.now() - startTime,
        timestamp: this.lastAnalysis
      });
      
    } catch (error) {
      logger.error('Performance analysis failed:', error);
      throw error;
    }
  }

  /**
   * Collect current metrics
   */
  async collectMetrics() {
    const timestamp = Date.now();
    
    // Simulate metric collection (in real implementation, this would query Prometheus)
    const currentMetrics = {
      http_response_time: {
        p50: 0.08 + Math.random() * 0.04,
        p95: 0.4 + Math.random() * 0.2,
        p99: 0.8 + Math.random() * 0.4
      },
      
      http_throughput: {
        requests_per_second: 80 + Math.random() * 40,
        bytes_per_second: 1024 * 1024 * (50 + Math.random() * 100)
      },
      
      error_rate: {
        http_4xx: Math.random() * 0.1,
        http_5xx: Math.random() * 0.02
      },
      
      resource_utilization: {
        cpu: 0.3 + Math.random() * 0.4,
        memory: 0.4 + Math.random() * 0.3,
        disk: 0.5 + Math.random() * 0.2
      },
      
      job_performance: {
        startup_time: 8 + Math.random() * 6,
        execution_time: 250 + Math.random() * 100,
        success_rate: 0.9 + Math.random() * 0.08
      },
      
      cache_performance: {
        hit_ratio: 0.8 + Math.random() * 0.15,
        miss_ratio: 0.05 + Math.random() * 0.1,
        latency: 0.001 + Math.random() * 0.005
      }
    };
    
    // Store metrics with timestamp
    for (const [metric, values] of Object.entries(currentMetrics)) {
      const data = this.metricsData.get(metric) || [];
      data.push({
        timestamp,
        values
      });
      
      // Keep only recent data
      const cutoff = timestamp - (this.config.collection.retentionDays * 24 * 60 * 60 * 1000);
      const filteredData = data.filter(point => point.timestamp > cutoff);
      
      this.metricsData.set(metric, filteredData);
      this.stats.totalDataPoints++;
    }
    
    this.stats.lastCollection = new Date();
  }

  /**
   * Aggregate data at different time intervals
   */
  async aggregateData() {
    for (const level of this.config.collection.aggregationLevels) {
      const intervalMs = this.parseInterval(level);
      
      for (const [metric, data] of this.metricsData) {
        const aggregated = this.aggregateMetricData(data, intervalMs);
        
        if (!this.aggregatedData.has(level)) {
          this.aggregatedData.set(level, new Map());
        }
        
        this.aggregatedData.get(level).set(metric, aggregated);
      }
    }
  }

  /**
   * Aggregate metric data for specific interval
   */
  aggregateMetricData(data, intervalMs) {
    const aggregated = [];
    
    // Group data by intervals
    const intervals = new Map();
    
    for (const point of data) {
      const intervalStart = Math.floor(point.timestamp / intervalMs) * intervalMs;
      
      if (!intervals.has(intervalStart)) {
        intervals.set(intervalStart, []);
      }
      
      intervals.get(intervalStart).push(point);
    }
    
    // Calculate aggregations for each interval
    for (const [intervalStart, points] of intervals) {
      if (points.length === 0) continue;
      
      const aggregation = {
        timestamp: intervalStart,
        count: points.length,
        values: {}
      };
      
      // Aggregate each value type
      const firstPoint = points[0];
      for (const [key, _value] of Object.entries(firstPoint.values)) {
        const values = points.map(p => p.values[key]).filter(v => v !== undefined);
        
        if (values.length > 0) {
          aggregation.values[key] = {
            min: Math.min(...values),
            max: Math.max(...values),
            avg: values.reduce((sum, v) => sum + v, 0) / values.length,
            sum: values.reduce((sum, v) => sum + v, 0),
            count: values.length
          };
        }
      }
      
      aggregated.push(aggregation);
    }
    
    return aggregated.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Analyze trends
   */
  async analyzeTrends() {
    for (const [metric, data] of this.metricsData) {
      if (data.length < 10) continue; // Need minimum data points
      
      const trends = this.calculateTrends(data);
      this.trends.set(metric, trends);
      
      if (trends.significantTrends.length > 0) {
        this.stats.trendsIdentified++;
        
        this.emit('trendDetected', {
          metric,
          trends: trends.significantTrends
        });
      }
    }
  }

  /**
   * Calculate trends for metric data
   */
  calculateTrends(data) {
    const trends = {
      overall: {},
      byValue: {},
      significantTrends: []
    };
    
    // Calculate trends for each value type
    const firstPoint = data[0];
    for (const valueKey of Object.keys(firstPoint.values)) {
      const values = data.map(point => ({
        timestamp: point.timestamp,
        value: point.values[valueKey]
      })).filter(p => p.value !== undefined);
      
      if (values.length < 5) continue;
      
      const trendData = this.calculateLinearTrend(values);
      trends.byValue[valueKey] = trendData;
      
      // Check if trend is significant
      if (Math.abs(trendData.slope) > 0.001 && trendData.correlation > 0.7) {
        trends.significantTrends.push({
          valueKey,
          direction: trendData.slope > 0 ? 'increasing' : 'decreasing',
          strength: Math.abs(trendData.correlation),
          slope: trendData.slope,
          prediction: trendData.predict(Date.now() + 24 * 60 * 60 * 1000) // 24h ahead
        });
      }
    }
    
    return trends;
  }

  /**
   * Calculate linear trend
   */
  calculateLinearTrend(points) {
    const n = points.length;
    const sumX = points.reduce((sum, p) => sum + p.timestamp, 0);
    const sumY = points.reduce((sum, p) => sum + p.value, 0);
    const sumXY = points.reduce((sum, p) => sum + p.timestamp * p.value, 0);
    const sumXX = points.reduce((sum, p) => sum + p.timestamp * p.timestamp, 0);
    const sumYY = points.reduce((sum, p) => sum + p.value * p.value, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate correlation coefficient
    const correlation = (n * sumXY - sumX * sumY) / 
      Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    
    return {
      slope,
      intercept,
      correlation,
      predict: (x) => slope * x + intercept
    };
  }

  /**
   * Detect anomalies
   */
  async detectAnomalies() {
    for (const [metric, data] of this.metricsData) {
      if (data.length < 20) continue; // Need sufficient data for statistical analysis
      
      const anomalies = this.detectStatisticalAnomalies(data);
      this.anomalies.set(metric, anomalies);
      
      if (anomalies.length > 0) {
        this.stats.anomaliesDetected += anomalies.length;
        
        this.emit('anomalyDetected', {
          metric,
          anomalies
        });
      }
    }
  }

  /**
   * Detect statistical anomalies using Z-score
   */
  detectStatisticalAnomalies(data) {
    const anomalies = [];
    const recentData = data.slice(-100); // Use last 100 points
    
    // Calculate statistics for each value type
    const firstPoint = recentData[0];
    for (const valueKey of Object.keys(firstPoint.values)) {
      const values = recentData.map(p => p.values[valueKey]).filter(v => v !== undefined);
      
      if (values.length < 10) continue;
      
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);
      
      // Check recent points for anomalies
      const recentPoints = recentData.slice(-10);
      for (const point of recentPoints) {
        const value = point.values[valueKey];
        if (value === undefined) continue;
        
        const zScore = Math.abs((value - mean) / stdDev);
        
        if (zScore > this.config.analytics.anomalyThreshold) {
          anomalies.push({
            timestamp: point.timestamp,
            valueKey,
            value,
            mean,
            stdDev,
            zScore,
            severity: zScore > 3 ? 'high' : 'medium'
          });
        }
      }
    }
    
    return anomalies;
  }

  /**
   * Generate predictions
   */
  async generatePredictions() {
    for (const [metric, data] of this.metricsData) {
      if (data.length < 50) continue; // Need sufficient historical data
      
      const predictions = this.generateMetricPredictions(data);
      this.predictions.set(metric, predictions);
      
      if (predictions.length > 0) {
        this.stats.predictionsGenerated++;
        
        this.emit('predictionGenerated', {
          metric,
          predictions
        });
      }
    }
  }

  /**
   * Generate predictions for metric
   */
  generateMetricPredictions(data) {
    const predictions = [];
    const now = Date.now();
    
    // Use last 100 points for prediction
    const recentData = data.slice(-100);
    
    // Generate predictions for next 24 hours
    const predictionIntervals = [
      { label: '1h', offset: 1 * 60 * 60 * 1000 },
      { label: '6h', offset: 6 * 60 * 60 * 1000 },
      { label: '12h', offset: 12 * 60 * 60 * 1000 },
      { label: '24h', offset: 24 * 60 * 60 * 1000 }
    ];
    
    const firstPoint = recentData[0];
    for (const valueKey of Object.keys(firstPoint.values)) {
      const values = recentData.map(point => ({
        timestamp: point.timestamp,
        value: point.values[valueKey]
      })).filter(p => p.value !== undefined);
      
      if (values.length < 20) continue;
      
      // Simple linear prediction (in real implementation, use more sophisticated models)
      const trend = this.calculateLinearTrend(values);
      
      for (const interval of predictionIntervals) {
        const futureTimestamp = now + interval.offset;
        const predictedValue = trend.predict(futureTimestamp);
        
        // Calculate confidence based on correlation
        const confidence = Math.abs(trend.correlation) * 100;
        
        predictions.push({
          valueKey,
          interval: interval.label,
          timestamp: futureTimestamp,
          predictedValue,
          confidence,
          trend: trend.slope > 0 ? 'increasing' : 'decreasing'
        });
      }
    }
    
    return predictions;
  }

  /**
   * Perform capacity planning analysis
   */
  async performCapacityPlanning() {
    const capacityAnalysis = {
      currentUtilization: {},
      projectedUtilization: {},
      recommendations: []
    };
    
    // Analyze resource utilization
    const resourceData = this.metricsData.get('resource_utilization');
    if (resourceData && resourceData.length > 0) {
      const latest = resourceData[resourceData.length - 1];
      capacityAnalysis.currentUtilization = latest.values;
      
      // Get predictions for resource utilization
      const predictions = this.predictions.get('resource_utilization') || [];
      const futureUtilization = predictions.filter(p => p.interval === '24h');
      
      for (const prediction of futureUtilization) {
        capacityAnalysis.projectedUtilization[prediction.valueKey] = prediction.predictedValue;
        
        // Generate recommendations
        if (prediction.predictedValue > 0.9) {
          capacityAnalysis.recommendations.push({
            type: 'scale_up',
            resource: prediction.valueKey,
            urgency: 'high',
            description: `${prediction.valueKey} utilization projected to exceed 90% in ${prediction.interval}`
          });
        } else if (prediction.predictedValue < 0.3) {
          capacityAnalysis.recommendations.push({
            type: 'scale_down',
            resource: prediction.valueKey,
            urgency: 'low',
            description: `${prediction.valueKey} utilization projected to be below 30% in ${prediction.interval}`
          });
        }
      }
    }
    
    this.emit('capacityAnalysis', capacityAnalysis);
    return capacityAnalysis;
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport() {
    const report = {
      timestamp: new Date(),
      summary: {
        totalMetrics: this.metricsData.size,
        dataPoints: this.stats.totalDataPoints,
        anomaliesDetected: this.stats.anomaliesDetected,
        trendsIdentified: this.stats.trendsIdentified,
        predictionsGenerated: this.stats.predictionsGenerated
      },
      metrics: {},
      trends: {},
      anomalies: {},
      predictions: {},
      recommendations: []
    };
    
    // Add current metric values
    for (const [metric, data] of this.metricsData) {
      if (data.length > 0) {
        const latest = data[data.length - 1];
        report.metrics[metric] = latest.values;
      }
    }
    
    // Add trend analysis
    for (const [metric, trends] of this.trends) {
      report.trends[metric] = trends.significantTrends;
    }
    
    // Add anomalies
    for (const [metric, anomalies] of this.anomalies) {
      report.anomalies[metric] = anomalies.filter(a => 
        Date.now() - a.timestamp < 24 * 60 * 60 * 1000 // Last 24 hours
      );
    }
    
    // Add predictions
    for (const [metric, predictions] of this.predictions) {
      report.predictions[metric] = predictions;
    }
    
    return report;
  }

  /**
   * Helper methods
   */
  
  parseInterval(interval) {
    const multipliers = {
      's': 1000,
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000
    };
    
    const match = interval.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error(`Invalid interval: ${interval}`);
    
    return parseInt(match[1]) * multipliers[match[2]];
  }

  /**
   * Get analytics status
   */
  getStatus() {
    return {
      isAnalyzing: this.isAnalyzing,
      lastAnalysis: this.lastAnalysis,
      stats: this.stats,
      config: {
        collectionInterval: this.config.collection.interval,
        retentionDays: this.config.collection.retentionDays,
        enabledFeatures: {
          trendAnalysis: this.config.analytics.enableTrendAnalysis,
          anomalyDetection: this.config.analytics.enableAnomalyDetection,
          predictiveAnalysis: this.config.analytics.enablePredictiveAnalysis,
          capacityPlanning: this.config.analytics.enableCapacityPlanning
        }
      },
      dataStatus: {
        metrics: this.metricsData.size,
        trends: this.trends.size,
        anomalies: this.anomalies.size,
        predictions: this.predictions.size
      }
    };
  }

  /**
   * Shutdown performance analytics
   */
  async shutdown() {
    logger.info('Shutting down Performance Analytics Engine');
    
    this.stopAnalysis();
    this.emit('shutdown');
    
    logger.info('Performance Analytics Engine shutdown completed');
  }
}

module.exports = PerformanceAnalytics;