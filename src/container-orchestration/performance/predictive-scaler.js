/**
 * Predictive Scaler
 * Machine Learning-based predictive scaling system that anticipates resource needs
 * and proactively scales containers before demand spikes
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class PredictiveScaler extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    
    this.config = {
      // ML Model configuration
      model: {
        type: options.modelType || 'lstm', // 'lstm', 'arima', 'prophet'
        lookbackWindow: options.lookbackWindow || 168, // 1 week in hours
        predictionHorizon: options.predictionHorizon || 24, // 24 hours ahead
        updateInterval: options.modelUpdateInterval || 86400000, // 24 hours
        minDataPoints: options.minDataPoints || 336 // 2 weeks of hourly data
      },
      
      // Scaling configuration
      scaling: {
        scaleAheadTime: options.scaleAheadTime || 300000, // 5 minutes
        minConfidence: options.minConfidence || 0.85, // 85% confidence threshold
        maxScaleUpRatio: options.maxScaleUpRatio || 3.0, // Max 3x current capacity
        maxScaleDownRatio: options.maxScaleDownRatio || 0.2, // Min 20% of current
        smoothingFactor: options.smoothingFactor || 0.7, // Exponential smoothing
        burstDetectionSensitivity: options.burstDetectionSensitivity || 2.0
      },
      
      // Pattern detection
      patterns: {
        detectDaily: options.detectDailyPatterns !== false,
        detectWeekly: options.detectWeeklyPatterns !== false,
        detectMonthly: options.detectMonthlyPatterns !== false,
        detectAnomalies: options.detectAnomalies !== false,
        customPatterns: options.customPatterns || []
      },
      
      // Resource prediction
      resources: {
        predictCPU: options.predictCPU !== false,
        predictMemory: options.predictMemory !== false,
        predictNetwork: options.predictNetwork !== false,
        predictJobDuration: options.predictJobDuration !== false
      },
      
      // Integration
      integration: {
        githubWebhooks: options.githubWebhooks || false,
        calendarIntegration: options.calendarIntegration || false,
        externalDataSources: options.externalDataSources || []
      },
      
      ...options
    };
    
    // ML Models
    this.models = {
      demand: null, // Main demand prediction model
      cpu: null, // CPU usage prediction
      memory: null, // Memory usage prediction
      jobDuration: null, // Job duration prediction
      anomaly: null // Anomaly detection model
    };
    
    // Historical data storage
    this.historicalData = {
      jobCounts: [], // Time series of job counts
      resourceUsage: [], // Time series of resource usage
      jobTypes: new Map(), // Job type frequency
      patterns: new Map(), // Detected patterns
      anomalies: [] // Detected anomalies
    };
    
    // Predictions
    this.predictions = {
      demand: [], // Future demand predictions
      resources: new Map(), // Resource predictions
      confidence: new Map(), // Prediction confidence scores
      recommendations: [] // Scaling recommendations
    };
    
    // Pattern detection
    this.patterns = {
      daily: null,
      weekly: null,
      monthly: null,
      seasonal: null,
      custom: new Map()
    };
    
    // Statistics
    this.stats = {
      predictionsTotal: 0,
      accuratePredictions: 0,
      scalingDecisions: 0,
      resourceSaved: 0,
      overProvisioningAvoided: 0,
      underProvisioningAvoided: 0
    };
    
    // Timers
    this.predictionTimer = null;
    this.modelUpdateTimer = null;
    this.patternDetectionTimer = null;
    
    this.isInitialized = false;
  }

  /**
   * Initialize the predictive scaler
   */
  async initialize() {
    try {
      logger.info('Initializing Predictive Scaler');
      
      // Load historical data
      await this.loadHistoricalData();
      
      // Initialize ML models
      await this.initializeModels();
      
      // Detect initial patterns
      await this.detectPatterns();
      
      // Generate initial predictions
      await this.generatePredictions();
      
      // Start timers
      this.startTimers();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Predictive Scaler initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Predictive Scaler:', error);
      throw error;
    }
  }

  /**
   * Initialize ML models
   */
  async initializeModels() {
    logger.info('Initializing ML models');
    
    // Initialize demand prediction model
    this.models.demand = await this.createDemandModel();
    
    // Initialize resource prediction models
    if (this.config.resources.predictCPU) {
      this.models.cpu = await this.createResourceModel('cpu');
    }
    
    if (this.config.resources.predictMemory) {
      this.models.memory = await this.createResourceModel('memory');
    }
    
    if (this.config.resources.predictJobDuration) {
      this.models.jobDuration = await this.createJobDurationModel();
    }
    
    // Initialize anomaly detection
    if (this.config.patterns.detectAnomalies) {
      this.models.anomaly = await this.createAnomalyDetectionModel();
    }
  }

  /**
   * Create demand prediction model
   */
  async createDemandModel() {
    // Simplified LSTM-like model for demand prediction
    return {
      type: 'lstm',
      predict: async (data, horizon) => {
        const predictions = [];
        const trend = this.calculateTrend(data);
        const seasonality = this.calculateSeasonality(data);
        
        for (let i = 0; i < horizon; i++) {
          const baseValue = data[data.length - 1] || 0;
          const trendComponent = trend * (i + 1);
          const seasonalComponent = seasonality[i % seasonality.length];
          const noise = (Math.random() - 0.5) * 0.1;
          
          const prediction = Math.max(0, baseValue + trendComponent + seasonalComponent + noise);
          predictions.push({
            timestamp: Date.now() + (i * 3600000), // Hourly predictions
            value: prediction,
            confidence: 0.85 - (i * 0.01) // Confidence decreases with horizon
          });
        }
        
        return predictions;
      }
    };
  }

  /**
   * Create resource prediction model
   */
  async createResourceModel(resourceType) {
    return {
      type: 'resource',
      resourceType,
      predict: async (data, horizon) => {
        const avgUsage = data.reduce((sum, d) => sum + d.value, 0) / data.length;
        const variance = this.calculateVariance(data.map(d => d.value));
        
        return Array.from({ length: horizon }, (_, i) => ({
          timestamp: Date.now() + (i * 3600000),
          value: avgUsage + (Math.random() - 0.5) * Math.sqrt(variance),
          confidence: 0.8 - (i * 0.01)
        }));
      }
    };
  }

  /**
   * Create job duration prediction model
   */
  async createJobDurationModel() {
    return {
      type: 'duration',
      predict: async (jobType, _features) => {
        const historicalDurations = this.getHistoricalJobDurations(jobType);
        if (historicalDurations.length === 0) {
          return { duration: 300000, confidence: 0.5 }; // Default 5 minutes
        }
        
        const avgDuration = historicalDurations.reduce((sum, d) => sum + d, 0) / historicalDurations.length;
        const variance = this.calculateVariance(historicalDurations);
        
        return {
          duration: avgDuration,
          confidence: Math.max(0.5, 1 - (Math.sqrt(variance) / avgDuration)),
          range: {
            min: avgDuration - Math.sqrt(variance),
            max: avgDuration + Math.sqrt(variance)
          }
        };
      }
    };
  }

  /**
   * Create anomaly detection model
   */
  async createAnomalyDetectionModel() {
    return {
      type: 'anomaly',
      detect: async (data) => {
        const mean = data.reduce((sum, d) => sum + d.value, 0) / data.length;
        const stdDev = Math.sqrt(this.calculateVariance(data.map(d => d.value)));
        const threshold = this.config.scaling.burstDetectionSensitivity;
        
        return data.filter(d => 
          Math.abs(d.value - mean) > threshold * stdDev
        ).map(d => ({
          ...d,
          severity: Math.abs(d.value - mean) / stdDev,
          type: d.value > mean ? 'spike' : 'drop'
        }));
      }
    };
  }

  /**
   * Generate predictions
   */
  async generatePredictions() {
    try {
      logger.info('Generating predictions');
      
      // Predict demand
      const demandData = this.historicalData.jobCounts.slice(-this.config.model.lookbackWindow);
      if (demandData.length >= this.config.model.minDataPoints) {
        const demandPredictions = await this.models.demand.predict(
          demandData,
          this.config.model.predictionHorizon
        );
        this.predictions.demand = demandPredictions;
        
        // Emit predictions for monitoring
        this.emit('demandPredicted', {
          predictions: demandPredictions,
          confidence: this.calculateAverageConfidence(demandPredictions)
        });
      }
      
      // Predict resources
      if (this.config.resources.predictCPU && this.models.cpu) {
        const cpuData = this.historicalData.resourceUsage
          .filter(r => r.type === 'cpu')
          .slice(-this.config.model.lookbackWindow);
        
        if (cpuData.length > 0) {
          const cpuPredictions = await this.models.cpu.predict(
            cpuData,
            this.config.model.predictionHorizon
          );
          this.predictions.resources.set('cpu', cpuPredictions);
        }
      }
      
      // Detect anomalies
      if (this.config.patterns.detectAnomalies && this.models.anomaly) {
        const recentData = this.historicalData.jobCounts.slice(-24); // Last 24 hours
        const anomalies = await this.models.anomaly.detect(recentData);
        
        if (anomalies.length > 0) {
          this.handleAnomalies(anomalies);
        }
      }
      
      // Generate scaling recommendations
      await this.generateScalingRecommendations();
      
      this.stats.predictionsTotal++;
      
    } catch (error) {
      logger.error('Failed to generate predictions:', error);
    }
  }

  /**
   * Generate scaling recommendations
   */
  async generateScalingRecommendations() {
    const recommendations = [];
    const currentCapacity = await this.getCurrentCapacity();
    
    // Check demand predictions
    for (const prediction of this.predictions.demand) {
      const timeUntil = prediction.timestamp - Date.now();
      
      if (timeUntil > 0 && timeUntil <= this.config.scaling.scaleAheadTime) {
        const requiredCapacity = Math.ceil(prediction.value);
        const scalingRatio = requiredCapacity / currentCapacity;
        
        if (scalingRatio > 1.1 && prediction.confidence >= this.config.scaling.minConfidence) {
          recommendations.push({
            type: 'scale_up',
            timestamp: prediction.timestamp,
            currentCapacity,
            requiredCapacity,
            confidence: prediction.confidence,
            reason: 'predicted_demand_increase'
          });
        } else if (scalingRatio < 0.9 && prediction.confidence >= this.config.scaling.minConfidence) {
          recommendations.push({
            type: 'scale_down',
            timestamp: prediction.timestamp,
            currentCapacity,
            requiredCapacity,
            confidence: prediction.confidence,
            reason: 'predicted_demand_decrease'
          });
        }
      }
    }
    
    // Check for burst patterns
    const burstPrediction = this.predictBurstPattern();
    if (burstPrediction) {
      recommendations.push(burstPrediction);
    }
    
    this.predictions.recommendations = recommendations;
    
    if (recommendations.length > 0) {
      this.emit('scalingRecommendations', recommendations);
    }
  }

  /**
   * Detect patterns in historical data
   */
  async detectPatterns() {
    try {
      logger.info('Detecting patterns in historical data');
      
      const data = this.historicalData.jobCounts;
      if (data.length < this.config.model.minDataPoints) {
        return;
      }
      
      // Detect daily patterns
      if (this.config.patterns.detectDaily) {
        this.patterns.daily = this.detectDailyPattern(data);
      }
      
      // Detect weekly patterns
      if (this.config.patterns.detectWeekly) {
        this.patterns.weekly = this.detectWeeklyPattern(data);
      }
      
      // Detect monthly patterns
      if (this.config.patterns.detectMonthly) {
        this.patterns.monthly = this.detectMonthlyPattern(data);
      }
      
      // Detect custom patterns
      for (const customPattern of this.config.patterns.customPatterns) {
        const detected = await this.detectCustomPattern(data, customPattern);
        if (detected) {
          this.patterns.custom.set(customPattern.name, detected);
        }
      }
      
      this.emit('patternsDetected', {
        daily: this.patterns.daily,
        weekly: this.patterns.weekly,
        monthly: this.patterns.monthly,
        custom: Array.from(this.patterns.custom.entries())
      });
      
    } catch (error) {
      logger.error('Failed to detect patterns:', error);
    }
  }

  /**
   * Detect daily pattern
   */
  detectDailyPattern(data) {
    const hourlyAverages = new Array(24).fill(0);
    const hourlyCounts = new Array(24).fill(0);
    
    for (const point of data) {
      const hour = new Date(point.timestamp).getHours();
      hourlyAverages[hour] += point.value;
      hourlyCounts[hour]++;
    }
    
    return hourlyAverages.map((sum, hour) => ({
      hour,
      average: hourlyCounts[hour] > 0 ? sum / hourlyCounts[hour] : 0,
      samples: hourlyCounts[hour]
    }));
  }

  /**
   * Detect weekly pattern
   */
  detectWeeklyPattern(data) {
    const dailyAverages = new Array(7).fill(0);
    const dailyCounts = new Array(7).fill(0);
    
    for (const point of data) {
      const day = new Date(point.timestamp).getDay();
      dailyAverages[day] += point.value;
      dailyCounts[day]++;
    }
    
    return dailyAverages.map((sum, day) => ({
      day,
      average: dailyCounts[day] > 0 ? sum / dailyCounts[day] : 0,
      samples: dailyCounts[day]
    }));
  }

  /**
   * Detect monthly pattern
   */
  detectMonthlyPattern(data) {
    const monthlyAverages = new Array(31).fill(0);
    const monthlyCounts = new Array(31).fill(0);
    
    for (const point of data) {
      const date = new Date(point.timestamp).getDate() - 1;
      monthlyAverages[date] += point.value;
      monthlyCounts[date]++;
    }
    
    return monthlyAverages.map((sum, date) => ({
      date: date + 1,
      average: monthlyCounts[date] > 0 ? sum / monthlyCounts[date] : 0,
      samples: monthlyCounts[date]
    }));
  }

  /**
   * Detect custom pattern
   */
  async detectCustomPattern(_data, _patternConfig) {
    // Implement custom pattern detection based on configuration
    return null;
  }

  /**
   * Predict burst pattern
   */
  predictBurstPattern() {
    const recentAnomalies = this.historicalData.anomalies.slice(-10);
    
    if (recentAnomalies.length >= 3) {
      // Check for recurring burst pattern
      const intervals = [];
      for (let i = 1; i < recentAnomalies.length; i++) {
        intervals.push(recentAnomalies[i].timestamp - recentAnomalies[i-1].timestamp);
      }
      
      const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
      const lastAnomaly = recentAnomalies[recentAnomalies.length - 1];
      const nextBurst = lastAnomaly.timestamp + avgInterval;
      
      if (nextBurst > Date.now() && nextBurst < Date.now() + this.config.model.predictionHorizon * 3600000) {
        return {
          type: 'scale_up',
          timestamp: nextBurst,
          currentCapacity: 0, // Will be filled by recommendation generator
          requiredCapacity: 0, // Will be calculated
          confidence: 0.7,
          reason: 'predicted_burst_pattern'
        };
      }
    }
    
    return null;
  }

  /**
   * Handle detected anomalies
   */
  handleAnomalies(anomalies) {
    for (const anomaly of anomalies) {
      this.historicalData.anomalies.push(anomaly);
      
      if (anomaly.severity > 3) {
        this.emit('anomalyDetected', {
          anomaly,
          recommendation: anomaly.type === 'spike' ? 'immediate_scale_up' : 'monitor'
        });
      }
    }
    
    // Keep only recent anomalies
    this.historicalData.anomalies = this.historicalData.anomalies.slice(-100);
  }

  /**
   * Update models with new data
   */
  async updateModels(newData) {
    try {
      // Add new data to historical
      this.historicalData.jobCounts.push({
        timestamp: Date.now(),
        value: newData.jobCount
      });
      
      if (newData.resourceUsage) {
        this.historicalData.resourceUsage.push({
          timestamp: Date.now(),
          type: 'cpu',
          value: newData.resourceUsage.cpu
        });
        
        this.historicalData.resourceUsage.push({
          timestamp: Date.now(),
          type: 'memory',
          value: newData.resourceUsage.memory
        });
      }
      
      // Maintain sliding window
      const maxDataPoints = this.config.model.lookbackWindow * 2;
      this.historicalData.jobCounts = this.historicalData.jobCounts.slice(-maxDataPoints);
      this.historicalData.resourceUsage = this.historicalData.resourceUsage.slice(-maxDataPoints);
      
      // Update job type frequencies
      if (newData.jobType) {
        const count = this.historicalData.jobTypes.get(newData.jobType) || 0;
        this.historicalData.jobTypes.set(newData.jobType, count + 1);
      }
      
      // Check prediction accuracy
      await this.checkPredictionAccuracy(newData);
      
    } catch (error) {
      logger.error('Failed to update models:', error);
    }
  }

  /**
   * Check prediction accuracy
   */
  async checkPredictionAccuracy(actualData) {
    const relevantPredictions = this.predictions.demand.filter(p => 
      Math.abs(p.timestamp - Date.now()) < 3600000 // Within 1 hour
    );
    
    for (const prediction of relevantPredictions) {
      const error = Math.abs(prediction.value - actualData.jobCount) / actualData.jobCount;
      if (error < 0.2) { // Within 20% error
        this.stats.accuratePredictions++;
      }
      
      // Update confidence based on accuracy
      const newConfidence = prediction.confidence * (1 - error);
      this.predictions.confidence.set(prediction.timestamp, newConfidence);
    }
  }

  /**
   * Get current capacity
   */
  async getCurrentCapacity() {
    const containers = await this.dockerAPI.getActiveContainers();
    return containers.length;
  }

  /**
   * Load historical data
   */
  async loadHistoricalData() {
    // In a real implementation, this would load from a database
    // For now, generate synthetic data for testing
    const now = Date.now();
    const dataPoints = this.config.model.lookbackWindow;
    
    for (let i = dataPoints; i > 0; i--) {
      const timestamp = now - (i * 3600000); // Hourly data
      const hour = new Date(timestamp).getHours();
      const dayOfWeek = new Date(timestamp).getDay();
      
      // Simulate realistic patterns
      let baseLoad = 10;
      
      // Business hours pattern
      if (hour >= 9 && hour <= 17 && dayOfWeek >= 1 && dayOfWeek <= 5) {
        baseLoad = 50;
      }
      
      // Peak hours
      if (hour >= 10 && hour <= 12) {
        baseLoad *= 1.5;
      }
      
      // Add some noise
      const noise = (Math.random() - 0.5) * 10;
      
      this.historicalData.jobCounts.push({
        timestamp,
        value: Math.max(0, baseLoad + noise)
      });
    }
    
    logger.info(`Loaded ${this.historicalData.jobCounts.length} historical data points`);
  }

  /**
   * Get historical job durations
   */
  getHistoricalJobDurations(_jobType) {
    // In a real implementation, this would query historical job data
    return [300000, 320000, 280000, 350000, 290000]; // Sample durations in ms
  }

  /**
   * Calculate trend
   */
  calculateTrend(data) {
    if (data.length < 2) return 0;
    
    const n = data.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += data[i].value || data[i];
      sumXY += i * (data[i].value || data[i]);
      sumX2 += i * i;
    }
    
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  /**
   * Calculate seasonality
   */
  calculateSeasonality(data) {
    const seasonalityLength = 24; // Hourly seasonality
    const seasonal = new Array(seasonalityLength).fill(0);
    const counts = new Array(seasonalityLength).fill(0);
    
    for (let i = 0; i < data.length; i++) {
      const index = i % seasonalityLength;
      seasonal[index] += data[i].value || data[i];
      counts[index]++;
    }
    
    return seasonal.map((sum, i) => 
      counts[i] > 0 ? sum / counts[i] : 0
    );
  }

  /**
   * Calculate variance
   */
  calculateVariance(data) {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    return data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
  }

  /**
   * Calculate average confidence
   */
  calculateAverageConfidence(predictions) {
    return predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
  }

  /**
   * Start timers
   */
  startTimers() {
    // Prediction timer
    this.predictionTimer = setInterval(() => {
      this.generatePredictions().catch(err => 
        logger.error('Prediction generation failed:', err)
      );
    }, 3600000); // Every hour
    
    // Model update timer
    this.modelUpdateTimer = setInterval(() => {
      this.detectPatterns().catch(err => 
        logger.error('Pattern detection failed:', err)
      );
    }, this.config.model.updateInterval);
  }

  /**
   * Get predictive insights
   */
  getPredictiveInsights() {
    return {
      predictions: {
        demand: this.predictions.demand,
        resources: Object.fromEntries(this.predictions.resources),
        recommendations: this.predictions.recommendations
      },
      patterns: {
        daily: this.patterns.daily,
        weekly: this.patterns.weekly,
        monthly: this.patterns.monthly,
        custom: Object.fromEntries(this.patterns.custom)
      },
      anomalies: this.historicalData.anomalies.slice(-10),
      statistics: this.stats,
      accuracy: this.stats.predictionsTotal > 0 
        ? (this.stats.accuratePredictions / this.stats.predictionsTotal * 100).toFixed(2) + '%'
        : 'N/A'
    };
  }

  /**
   * Stop the predictive scaler
   */
  async stop() {
    logger.info('Stopping Predictive Scaler');
    
    if (this.predictionTimer) {
      clearInterval(this.predictionTimer);
      this.predictionTimer = null;
    }
    
    if (this.modelUpdateTimer) {
      clearInterval(this.modelUpdateTimer);
      this.modelUpdateTimer = null;
    }
    
    this.emit('stopped');
    logger.info('Predictive Scaler stopped');
  }
}

module.exports = PredictiveScaler;