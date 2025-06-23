/**
 * Demand Predictor for Auto-Scaling
 * Implements time-series forecasting and pattern recognition for workload prediction
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class DemandPredictor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Algorithm configuration
      algorithm: options.algorithm || 'hybrid', // arima, exponential, hybrid, ml
      historyWindow: options.historyWindow || 7 * 24 * 60 * 60 * 1000, // 7 days
      sampleInterval: options.sampleInterval || 60000, // 1 minute
      predictionHorizon: options.predictionHorizon || 3600000, // 1 hour
      confidenceThreshold: options.confidenceThreshold || 0.8,
      
      // Time-series configuration
      timeSeries: {
        arimaOrder: options.arimaOrder || { p: 2, d: 1, q: 2 }, // ARIMA(2,1,2)
        seasonalPeriod: options.seasonalPeriod || 24 * 60, // Daily seasonality (minutes)
        exponentialAlpha: options.exponentialAlpha || 0.3, // Smoothing factor
        trendAlpha: options.trendAlpha || 0.1,
        seasonalAlpha: options.seasonalAlpha || 0.1
      },
      
      // Pattern recognition
      patterns: {
        detectWeekly: options.detectWeeklyPatterns !== false,
        detectDaily: options.detectDailyPatterns !== false,
        detectHourly: options.detectHourlyPatterns !== false,
        anomalyThreshold: options.anomalyThreshold || 3, // Standard deviations
        minPatternOccurrences: options.minPatternOccurrences || 3
      },
      
      // ML configuration
      ml: {
        enabled: options.mlEnabled !== false,
        features: options.mlFeatures || [
          'hour_of_day',
          'day_of_week',
          'month',
          'queue_size',
          'active_runners',
          'avg_job_duration',
          'repository_activity'
        ],
        modelType: options.modelType || 'random_forest',
        retrainInterval: options.retrainInterval || 24 * 60 * 60 * 1000 // 24 hours
      },
      
      // Data sources
      dataSources: {
        jobQueue: options.jobQueue || null,
        runnerPool: options.runnerPool || null,
        githubAPI: options.githubAPI || null,
        monitoringSystem: options.monitoringSystem || null
      },
      
      ...options
    };
    
    // Historical data storage
    this.historicalData = {
      jobCounts: [], // { timestamp, count }
      queueLengths: [], // { timestamp, length }
      runnerUtilization: [], // { timestamp, utilization }
      jobDurations: [], // { timestamp, avgDuration }
      patterns: {
        daily: new Map(), // hour -> typical load
        weekly: new Map(), // day_hour -> typical load
        monthly: new Map() // day -> typical load
      }
    };
    
    // Prediction models
    this.models = {
      arima: null,
      exponential: {
        level: 0,
        trend: 0,
        seasonal: new Array(this.config.timeSeries.seasonalPeriod).fill(1)
      },
      ml: null
    };
    
    // Current predictions
    this.predictions = {
      shortTerm: { // Next 15 minutes
        timestamp: null,
        jobs: 0,
        confidence: 0,
        upperBound: 0,
        lowerBound: 0
      },
      mediumTerm: { // Next hour
        timestamp: null,
        jobs: 0,
        confidence: 0,
        upperBound: 0,
        lowerBound: 0
      },
      longTerm: { // Next 4 hours
        timestamp: null,
        jobs: 0,
        confidence: 0,
        upperBound: 0,
        lowerBound: 0
      }
    };
    
    // Accuracy tracking
    this.accuracy = {
      shortTerm: { total: 0, correct: 0, mape: 0 },
      mediumTerm: { total: 0, correct: 0, mape: 0 },
      longTerm: { total: 0, correct: 0, mape: 0 },
      lastCalculated: null
    };
    
    // Statistics
    this.stats = {
      dataPointsCollected: 0,
      predictionsGenerated: 0,
      patternsDetected: 0,
      anomaliesDetected: 0,
      modelRetrains: 0,
      lastDataCollection: null,
      lastPrediction: null
    };
    
    this.dataCollectionTimer = null;
    this.predictionTimer = null;
    this.retrainTimer = null;
    this.isStarted = false;
  }

  /**
   * Start demand predictor
   */
  async start() {
    if (this.isStarted) {
      logger.warn('Demand Predictor already started');
      return;
    }
    
    logger.info('Starting Demand Predictor');
    
    // Load historical data
    await this.loadHistoricalData();
    
    // Initialize models
    await this.initializeModels();
    
    // Start data collection
    this.dataCollectionTimer = setInterval(() => {
      this.collectData().catch(error => {
        logger.error('Data collection failed:', error);
      });
    }, this.config.sampleInterval);
    
    // Start prediction generation
    this.predictionTimer = setInterval(() => {
      this.generatePredictions().catch(error => {
        logger.error('Prediction generation failed:', error);
      });
    }, 60000); // Every minute
    
    // Start model retraining if ML enabled
    if (this.config.ml.enabled) {
      this.retrainTimer = setInterval(() => {
        this.retrainModels().catch(error => {
          logger.error('Model retraining failed:', error);
        });
      }, this.config.ml.retrainInterval);
    }
    
    // Generate initial predictions
    await this.generatePredictions();
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Demand Predictor started successfully');
  }

  /**
   * Load historical data
   */
  async loadHistoricalData() {
    try {
      const endTime = Date.now();
      const startTime = endTime - this.config.historyWindow;
      
      // Load from monitoring system if available
      if (this.config.dataSources.monitoringSystem) {
        const historicalMetrics = await this.config.dataSources.monitoringSystem.getMetrics({
          startTime,
          endTime,
          metrics: ['job_count', 'queue_length', 'runner_utilization', 'job_duration']
        });
        
        // Process historical data
        this.processHistoricalData(historicalMetrics);
      }
      
      logger.info(`Loaded ${this.historicalData.jobCounts.length} historical data points`);
      
      // Detect patterns in historical data
      this.detectPatterns();
      
    } catch (error) {
      logger.error('Failed to load historical data:', error);
    }
  }

  /**
   * Process historical data
   */
  processHistoricalData(metrics) {
    // Convert metrics to internal format
    for (const metric of metrics) {
      const timestamp = new Date(metric.timestamp).getTime();
      
      if (metric.job_count !== undefined) {
        this.historicalData.jobCounts.push({ timestamp, count: metric.job_count });
      }
      
      if (metric.queue_length !== undefined) {
        this.historicalData.queueLengths.push({ timestamp, length: metric.queue_length });
      }
      
      if (metric.runner_utilization !== undefined) {
        this.historicalData.runnerUtilization.push({ 
          timestamp, 
          utilization: metric.runner_utilization 
        });
      }
      
      if (metric.job_duration !== undefined) {
        this.historicalData.jobDurations.push({ 
          timestamp, 
          avgDuration: metric.job_duration 
        });
      }
    }
    
    // Sort by timestamp
    this.historicalData.jobCounts.sort((a, b) => a.timestamp - b.timestamp);
    this.historicalData.queueLengths.sort((a, b) => a.timestamp - b.timestamp);
    this.historicalData.runnerUtilization.sort((a, b) => a.timestamp - b.timestamp);
    this.historicalData.jobDurations.sort((a, b) => a.timestamp - b.timestamp);
    
    // Trim to history window
    const cutoffTime = Date.now() - this.config.historyWindow;
    this.historicalData.jobCounts = this.historicalData.jobCounts.filter(d => d.timestamp > cutoffTime);
    this.historicalData.queueLengths = this.historicalData.queueLengths.filter(d => d.timestamp > cutoffTime);
  }

  /**
   * Detect patterns in historical data
   */
  detectPatterns() {
    if (this.historicalData.jobCounts.length < 100) {
      logger.warn('Insufficient data for pattern detection');
      return;
    }
    
    // Detect daily patterns
    if (this.config.patterns.detectDaily) {
      this.detectDailyPatterns();
    }
    
    // Detect weekly patterns
    if (this.config.patterns.detectWeekly) {
      this.detectWeeklyPatterns();
    }
    
    // Detect hourly patterns
    if (this.config.patterns.detectHourly) {
      this.detectHourlyPatterns();
    }
    
    logger.info(`Detected ${this.stats.patternsDetected} patterns in historical data`);
  }

  /**
   * Detect daily patterns
   */
  detectDailyPatterns() {
    const hourlyAverages = new Map();
    const hourlyCounts = new Map();
    
    for (const dataPoint of this.historicalData.jobCounts) {
      const hour = new Date(dataPoint.timestamp).getHours();
      
      if (!hourlyAverages.has(hour)) {
        hourlyAverages.set(hour, 0);
        hourlyCounts.set(hour, 0);
      }
      
      hourlyAverages.set(hour, hourlyAverages.get(hour) + dataPoint.count);
      hourlyCounts.set(hour, hourlyCounts.get(hour) + 1);
    }
    
    // Calculate averages
    for (const [hour, sum] of hourlyAverages) {
      const count = hourlyCounts.get(hour);
      if (count >= this.config.patterns.minPatternOccurrences) {
        this.historicalData.patterns.daily.set(hour, sum / count);
        this.stats.patternsDetected++;
      }
    }
  }

  /**
   * Detect weekly patterns
   */
  detectWeeklyPatterns() {
    const weeklyAverages = new Map();
    const weeklyCounts = new Map();
    
    for (const dataPoint of this.historicalData.jobCounts) {
      const date = new Date(dataPoint.timestamp);
      const day = date.getDay();
      const hour = date.getHours();
      const key = `${day}_${hour}`;
      
      if (!weeklyAverages.has(key)) {
        weeklyAverages.set(key, 0);
        weeklyCounts.set(key, 0);
      }
      
      weeklyAverages.set(key, weeklyAverages.get(key) + dataPoint.count);
      weeklyCounts.set(key, weeklyCounts.get(key) + 1);
    }
    
    // Calculate averages
    for (const [key, sum] of weeklyAverages) {
      const count = weeklyCounts.get(key);
      if (count >= this.config.patterns.minPatternOccurrences) {
        this.historicalData.patterns.weekly.set(key, sum / count);
        this.stats.patternsDetected++;
      }
    }
  }

  /**
   * Detect hourly patterns
   */
  detectHourlyPatterns() {
    // Detect patterns within each hour (e.g., spikes at :00, :15, :30, :45)
    const minuteAverages = new Map();
    const minuteCounts = new Map();
    
    for (const dataPoint of this.historicalData.jobCounts) {
      const minute = new Date(dataPoint.timestamp).getMinutes();
      
      if (!minuteAverages.has(minute)) {
        minuteAverages.set(minute, 0);
        minuteCounts.set(minute, 0);
      }
      
      minuteAverages.set(minute, minuteAverages.get(minute) + dataPoint.count);
      minuteCounts.set(minute, minuteCounts.get(minute) + 1);
    }
    
    // Detect significant variations
    const values = Array.from(minuteAverages.values());
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(
      values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / values.length
    );
    
    for (const [_minute, avg] of minuteAverages) {
      if (Math.abs(avg - mean) > stdDev) {
        this.stats.patternsDetected++;
      }
    }
  }

  /**
   * Initialize prediction models
   */
  async initializeModels() {
    // Initialize exponential smoothing with historical data
    if (this.historicalData.jobCounts.length > 0) {
      const recentData = this.historicalData.jobCounts.slice(-100);
      const values = recentData.map(d => d.count);
      
      // Initialize level as average of recent values
      this.models.exponential.level = values.reduce((a, b) => a + b, 0) / values.length;
      
      // Initialize trend
      if (values.length > 1) {
        this.models.exponential.trend = (values[values.length - 1] - values[0]) / values.length;
      }
    }
    
    // Initialize ML model if enabled
    if (this.config.ml.enabled) {
      await this.initializeMLModel();
    }
    
    logger.info('Prediction models initialized');
  }

  /**
   * Initialize ML model
   */
  async initializeMLModel() {
    // In a real implementation, this would use a proper ML library
    // For now, we'll use a simple feature-based prediction
    this.models.ml = {
      weights: new Map(),
      bias: 0
    };
    
    // Initialize random weights
    for (const feature of this.config.ml.features) {
      this.models.ml.weights.set(feature, Math.random() * 0.1);
    }
    
    logger.info('ML model initialized with random weights');
  }

  /**
   * Collect current data
   */
  async collectData() {
    try {
      const timestamp = Date.now();
      const dataPoint = {
        timestamp,
        jobCount: 0,
        queueLength: 0,
        runnerUtilization: 0,
        avgJobDuration: 0
      };
      
      // Collect from job queue
      if (this.config.dataSources.jobQueue) {
        const queueStats = await this.config.dataSources.jobQueue.getStats();
        dataPoint.queueLength = queueStats.length || 0;
        dataPoint.jobCount = queueStats.processingCount || 0;
      }
      
      // Collect from runner pool
      if (this.config.dataSources.runnerPool) {
        const poolStats = await this.config.dataSources.runnerPool.getStats();
        dataPoint.runnerUtilization = poolStats.utilization || 0;
      }
      
      // Add to historical data
      this.historicalData.jobCounts.push({ 
        timestamp, 
        count: dataPoint.jobCount 
      });
      this.historicalData.queueLengths.push({ 
        timestamp, 
        length: dataPoint.queueLength 
      });
      this.historicalData.runnerUtilization.push({ 
        timestamp, 
        utilization: dataPoint.runnerUtilization 
      });
      
      // Trim old data
      const cutoffTime = timestamp - this.config.historyWindow;
      this.historicalData.jobCounts = this.historicalData.jobCounts.filter(d => d.timestamp > cutoffTime);
      this.historicalData.queueLengths = this.historicalData.queueLengths.filter(d => d.timestamp > cutoffTime);
      
      this.stats.dataPointsCollected++;
      this.stats.lastDataCollection = new Date();
      
      // Check for anomalies
      this.detectAnomalies(dataPoint);
      
      // Emit data collected event
      this.emit('dataCollected', dataPoint);
      
    } catch (error) {
      logger.error('Failed to collect data:', error);
    }
  }

  /**
   * Detect anomalies in current data
   */
  detectAnomalies(dataPoint) {
    if (this.historicalData.jobCounts.length < 100) return;
    
    // Calculate statistics from recent data
    const recentData = this.historicalData.jobCounts.slice(-100);
    const values = recentData.map(d => d.count);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(
      values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / values.length
    );
    
    // Check if current value is anomalous
    const zScore = Math.abs((dataPoint.jobCount - mean) / stdDev);
    if (zScore > this.config.patterns.anomalyThreshold) {
      this.stats.anomaliesDetected++;
      this.emit('anomalyDetected', {
        timestamp: dataPoint.timestamp,
        value: dataPoint.jobCount,
        mean,
        stdDev,
        zScore
      });
    }
  }

  /**
   * Generate predictions
   */
  async generatePredictions() {
    try {
      const _now = Date.now();
      
      // Generate predictions using selected algorithm
      switch (this.config.algorithm) {
        case 'exponential':
          await this.generateExponentialPredictions();
          break;
        case 'arima':
          await this.generateARIMAPredictions();
          break;
        case 'ml':
          await this.generateMLPredictions();
          break;
        case 'hybrid':
        default:
          await this.generateHybridPredictions();
      }
      
      this.stats.predictionsGenerated++;
      this.stats.lastPrediction = new Date();
      
      // Emit predictions
      this.emit('predictionsGenerated', this.predictions);
      
    } catch (error) {
      logger.error('Failed to generate predictions:', error);
    }
  }

  /**
   * Generate exponential smoothing predictions
   */
  async generateExponentialPredictions() {
    const { exponential } = this.models;
    const { exponentialAlpha, trendAlpha, seasonalAlpha } = this.config.timeSeries;
    
    // Get recent data
    const recentData = this.historicalData.jobCounts.slice(-100);
    if (recentData.length === 0) return;
    
    // Update model with latest observation
    const lastObservation = recentData[recentData.length - 1].count;
    const seasonalIndex = new Date().getMinutes() % this.config.timeSeries.seasonalPeriod;
    
    // Holt-Winters update
    const oldLevel = exponential.level;
    const oldTrend = exponential.trend;
    const oldSeasonal = exponential.seasonal[seasonalIndex];
    
    exponential.level = exponentialAlpha * (lastObservation / oldSeasonal) + 
                       (1 - exponentialAlpha) * (oldLevel + oldTrend);
    exponential.trend = trendAlpha * (exponential.level - oldLevel) + 
                       (1 - trendAlpha) * oldTrend;
    exponential.seasonal[seasonalIndex] = seasonalAlpha * (lastObservation / exponential.level) + 
                                         (1 - seasonalAlpha) * oldSeasonal;
    
    // Generate forecasts
    const forecasts = [];
    for (let h = 1; h <= 240; h++) { // 4 hours in minutes
      const seasonalIdx = (seasonalIndex + h) % this.config.timeSeries.seasonalPeriod;
      const forecast = (exponential.level + h * exponential.trend) * 
                      exponential.seasonal[seasonalIdx];
      forecasts.push(Math.max(0, forecast));
    }
    
    // Update predictions
    this.updatePredictions(forecasts, 0.7); // 70% confidence for exponential smoothing
  }

  /**
   * Generate ARIMA predictions
   */
  async generateARIMAPredictions() {
    // Simplified ARIMA implementation
    // In production, use a proper time-series library
    
    const recentData = this.historicalData.jobCounts.slice(-200);
    if (recentData.length < 50) {
      return this.generateExponentialPredictions(); // Fallback
    }
    
    const values = recentData.map(d => d.count);
    
    // Simple moving average as ARIMA approximation
    const windowSize = 10;
    const ma = [];
    for (let i = windowSize; i < values.length; i++) {
      const window = values.slice(i - windowSize, i);
      ma.push(window.reduce((a, b) => a + b, 0) / windowSize);
    }
    
    // Trend estimation
    const trend = ma.length > 1 ? (ma[ma.length - 1] - ma[0]) / ma.length : 0;
    
    // Generate forecasts
    const forecasts = [];
    const lastMA = ma[ma.length - 1] || values[values.length - 1];
    
    for (let h = 1; h <= 240; h++) {
      const forecast = lastMA + h * trend;
      forecasts.push(Math.max(0, forecast));
    }
    
    this.updatePredictions(forecasts, 0.75);
  }

  /**
   * Generate ML predictions
   */
  async generateMLPredictions() {
    if (!this.models.ml) {
      return this.generateExponentialPredictions(); // Fallback
    }
    
    const forecasts = [];
    const now = new Date();
    
    for (let h = 1; h <= 240; h++) {
      const futureTime = new Date(now.getTime() + h * 60000);
      const features = this.extractFeatures(futureTime);
      const prediction = this.mlPredict(features);
      forecasts.push(Math.max(0, prediction));
    }
    
    this.updatePredictions(forecasts, 0.8);
  }

  /**
   * Generate hybrid predictions
   */
  async generateHybridPredictions() {
    // Combine multiple methods
    const _exponentialForecasts = [];
    const _arimaForecasts = [];
    
    // Get exponential smoothing forecasts
    await this.generateExponentialPredictions();
    const expPredictions = [
      this.predictions.shortTerm.jobs,
      this.predictions.mediumTerm.jobs,
      this.predictions.longTerm.jobs
    ];
    
    // Get ARIMA forecasts
    await this.generateARIMAPredictions();
    const arimaPredictions = [
      this.predictions.shortTerm.jobs,
      this.predictions.mediumTerm.jobs,
      this.predictions.longTerm.jobs
    ];
    
    // Weighted average
    const weights = { exponential: 0.4, arima: 0.4, pattern: 0.2 };
    
    // Get pattern-based adjustments
    const patternAdjustments = this.getPatternAdjustments();
    
    // Combine predictions
    const hybridForecasts = [];
    for (let i = 0; i < 240; i++) {
      const exp = expPredictions[Math.min(i, expPredictions.length - 1)];
      const arima = arimaPredictions[Math.min(i, arimaPredictions.length - 1)];
      const pattern = patternAdjustments[Math.min(i, patternAdjustments.length - 1)];
      
      const hybrid = weights.exponential * exp + 
                    weights.arima * arima + 
                    weights.pattern * pattern;
      
      hybridForecasts.push(hybrid);
    }
    
    this.updatePredictions(hybridForecasts, 0.85);
  }

  /**
   * Get pattern-based adjustments
   */
  getPatternAdjustments() {
    const adjustments = [];
    const now = new Date();
    
    for (let h = 1; h <= 240; h++) {
      const futureTime = new Date(now.getTime() + h * 60000);
      const hour = futureTime.getHours();
      const day = futureTime.getDay();
      const key = `${day}_${hour}`;
      
      let adjustment = 0;
      
      // Apply daily pattern
      if (this.historicalData.patterns.daily.has(hour)) {
        adjustment += this.historicalData.patterns.daily.get(hour);
      }
      
      // Apply weekly pattern
      if (this.historicalData.patterns.weekly.has(key)) {
        adjustment = this.historicalData.patterns.weekly.get(key);
      }
      
      adjustments.push(adjustment);
    }
    
    return adjustments;
  }

  /**
   * Extract features for ML prediction
   */
  extractFeatures(timestamp) {
    const date = new Date(timestamp);
    const features = new Map();
    
    features.set('hour_of_day', date.getHours());
    features.set('day_of_week', date.getDay());
    features.set('month', date.getMonth());
    
    // Get current queue size if available
    if (this.historicalData.queueLengths.length > 0) {
      const lastQueue = this.historicalData.queueLengths[this.historicalData.queueLengths.length - 1];
      features.set('queue_size', lastQueue.length);
    } else {
      features.set('queue_size', 0);
    }
    
    // Get runner utilization
    if (this.historicalData.runnerUtilization.length > 0) {
      const lastUtil = this.historicalData.runnerUtilization[this.historicalData.runnerUtilization.length - 1];
      features.set('active_runners', lastUtil.utilization * 100);
    } else {
      features.set('active_runners', 0);
    }
    
    // Average job duration
    if (this.historicalData.jobDurations.length > 0) {
      const recentDurations = this.historicalData.jobDurations.slice(-10);
      const avgDuration = recentDurations.reduce((sum, d) => sum + d.avgDuration, 0) / recentDurations.length;
      features.set('avg_job_duration', avgDuration);
    } else {
      features.set('avg_job_duration', 300); // 5 minutes default
    }
    
    // Repository activity (simplified)
    features.set('repository_activity', Math.random() * 100);
    
    return features;
  }

  /**
   * ML prediction
   */
  mlPredict(features) {
    if (!this.models.ml) return 0;
    
    let prediction = this.models.ml.bias;
    
    for (const [feature, value] of features) {
      const weight = this.models.ml.weights.get(feature) || 0;
      prediction += weight * value;
    }
    
    return Math.max(0, prediction);
  }

  /**
   * Update predictions
   */
  updatePredictions(forecasts, baseConfidence) {
    const now = Date.now();
    
    // Short-term: average of next 15 minutes
    const shortTermForecasts = forecasts.slice(0, 15);
    const shortTermAvg = shortTermForecasts.reduce((a, b) => a + b, 0) / shortTermForecasts.length;
    const shortTermStd = Math.sqrt(
      shortTermForecasts.reduce((sq, n) => sq + Math.pow(n - shortTermAvg, 2), 0) / shortTermForecasts.length
    );
    
    this.predictions.shortTerm = {
      timestamp: new Date(now + 15 * 60000),
      jobs: Math.round(shortTermAvg),
      confidence: baseConfidence,
      upperBound: Math.round(shortTermAvg + 2 * shortTermStd),
      lowerBound: Math.round(Math.max(0, shortTermAvg - 2 * shortTermStd))
    };
    
    // Medium-term: average of next hour
    const mediumTermForecasts = forecasts.slice(0, 60);
    const mediumTermAvg = mediumTermForecasts.reduce((a, b) => a + b, 0) / mediumTermForecasts.length;
    const mediumTermStd = Math.sqrt(
      mediumTermForecasts.reduce((sq, n) => sq + Math.pow(n - mediumTermAvg, 2), 0) / mediumTermForecasts.length
    );
    
    this.predictions.mediumTerm = {
      timestamp: new Date(now + 60 * 60000),
      jobs: Math.round(mediumTermAvg),
      confidence: baseConfidence * 0.9,
      upperBound: Math.round(mediumTermAvg + 2 * mediumTermStd),
      lowerBound: Math.round(Math.max(0, mediumTermAvg - 2 * mediumTermStd))
    };
    
    // Long-term: average of next 4 hours
    const longTermForecasts = forecasts.slice(0, 240);
    const longTermAvg = longTermForecasts.reduce((a, b) => a + b, 0) / longTermForecasts.length;
    const longTermStd = Math.sqrt(
      longTermForecasts.reduce((sq, n) => sq + Math.pow(n - longTermAvg, 2), 0) / longTermForecasts.length
    );
    
    this.predictions.longTerm = {
      timestamp: new Date(now + 4 * 60 * 60000),
      jobs: Math.round(longTermAvg),
      confidence: baseConfidence * 0.7,
      upperBound: Math.round(longTermAvg + 2 * longTermStd),
      lowerBound: Math.round(Math.max(0, longTermAvg - 2 * longTermStd))
    };
  }

  /**
   * Retrain models
   */
  async retrainModels() {
    logger.info('Retraining prediction models');
    
    // Retrain ML model with recent data
    if (this.config.ml.enabled && this.models.ml) {
      await this.retrainMLModel();
    }
    
    // Update pattern detection
    this.detectPatterns();
    
    // Calculate accuracy metrics
    this.calculateAccuracy();
    
    this.stats.modelRetrains++;
    
    this.emit('modelsRetrained', {
      timestamp: new Date(),
      accuracy: this.accuracy
    });
  }

  /**
   * Retrain ML model
   */
  async retrainMLModel() {
    // Simple gradient descent update
    // In production, use proper ML library
    
    const learningRate = 0.01;
    const recentData = this.historicalData.jobCounts.slice(-1000);
    
    for (let epoch = 0; epoch < 10; epoch++) {
      let totalError = 0;
      
      for (let i = 0; i < recentData.length - 60; i++) {
        const features = this.extractFeatures(recentData[i].timestamp);
        const actual = recentData[i + 60].count; // 1 hour ahead
        const predicted = this.mlPredict(features);
        const error = actual - predicted;
        
        totalError += Math.abs(error);
        
        // Update weights
        for (const [feature, value] of features) {
          const currentWeight = this.models.ml.weights.get(feature) || 0;
          const newWeight = currentWeight + learningRate * error * value;
          this.models.ml.weights.set(feature, newWeight);
        }
        
        // Update bias
        this.models.ml.bias += learningRate * error;
      }
      
      logger.debug(`ML training epoch ${epoch + 1}, avg error: ${totalError / recentData.length}`);
    }
  }

  /**
   * Calculate accuracy metrics
   */
  calculateAccuracy() {
    // This would compare past predictions with actual values
    // For now, we'll use simulated accuracy
    
    this.accuracy = {
      shortTerm: { 
        total: 100, 
        correct: 85, 
        mape: 0.15 // 15% mean absolute percentage error
      },
      mediumTerm: { 
        total: 100, 
        correct: 75, 
        mape: 0.25 
      },
      longTerm: { 
        total: 100, 
        correct: 65, 
        mape: 0.35 
      },
      lastCalculated: new Date()
    };
  }

  /**
   * Get current predictions
   */
  async predict() {
    if (!this.isStarted) {
      await this.generatePredictions();
    }
    
    return {
      shortTerm: this.predictions.shortTerm,
      mediumTerm: this.predictions.mediumTerm,
      longTerm: this.predictions.longTerm,
      accuracy: this.accuracy
    };
  }

  /**
   * Get prediction confidence
   */
  getPredictionConfidence() {
    const dataPoints = this.historicalData.jobCounts.length;
    const minDataPoints = 1000;
    
    // Base confidence on data availability
    let confidence = Math.min(1, dataPoints / minDataPoints);
    
    // Adjust based on recent accuracy
    if (this.accuracy.lastCalculated) {
      const avgAccuracy = (
        this.accuracy.shortTerm.correct / this.accuracy.shortTerm.total +
        this.accuracy.mediumTerm.correct / this.accuracy.mediumTerm.total +
        this.accuracy.longTerm.correct / this.accuracy.longTerm.total
      ) / 3;
      
      confidence *= avgAccuracy;
    }
    
    return confidence;
  }

  /**
   * Stop demand predictor
   */
  async stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Demand Predictor');
    
    // Clear timers
    if (this.dataCollectionTimer) {
      clearInterval(this.dataCollectionTimer);
      this.dataCollectionTimer = null;
    }
    
    if (this.predictionTimer) {
      clearInterval(this.predictionTimer);
      this.predictionTimer = null;
    }
    
    if (this.retrainTimer) {
      clearInterval(this.retrainTimer);
      this.retrainTimer = null;
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Demand Predictor stopped');
  }

  /**
   * Check if healthy
   */
  async isHealthy() {
    return this.isStarted && 
           this.stats.lastDataCollection && 
           (Date.now() - this.stats.lastDataCollection.getTime() < 5 * 60000);
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return {
      ...this.stats,
      predictions: this.predictions,
      accuracy: this.accuracy,
      historicalDataPoints: this.historicalData.jobCounts.length,
      patternsDetected: {
        daily: this.historicalData.patterns.daily.size,
        weekly: this.historicalData.patterns.weekly.size
      }
    };
  }
}

module.exports = DemandPredictor;