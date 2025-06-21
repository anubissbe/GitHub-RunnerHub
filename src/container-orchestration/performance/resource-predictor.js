/**
 * Resource Predictor
 * Intelligent resource prediction system that analyzes job patterns
 * and predicts resource requirements for optimal allocation
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class ResourcePredictor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Prediction configuration
      prediction: {
        lookbackDays: options.lookbackDays || 30,
        confidenceThreshold: options.confidenceThreshold || 0.8,
        updateInterval: options.updateInterval || 3600000, // 1 hour
        minSamples: options.minSamples || 10
      },
      
      // Resource types
      resources: {
        cpu: { enabled: true, unit: 'cores' },
        memory: { enabled: true, unit: 'GB' },
        disk: { enabled: true, unit: 'GB' },
        network: { enabled: true, unit: 'Mbps' }
      },
      
      // Job classification
      classification: {
        enabled: options.classificationEnabled !== false,
        features: ['repository', 'workflow', 'runner_labels', 'time_of_day', 'day_of_week'],
        clusterCount: options.clusterCount || 10
      },
      
      // Optimization
      optimization: {
        overProvisioningFactor: options.overProvisioningFactor || 1.2,
        underProvisioningPenalty: options.underProvisioningPenalty || 2.0,
        costOptimization: options.costOptimization || false
      },
      
      ...options
    };
    
    // Job profiles
    this.jobProfiles = new Map(); // jobType -> resourceProfile
    this.jobHistory = new Map(); // jobId -> jobMetrics
    this.resourcePatterns = new Map(); // pattern -> statistics
    
    // Prediction models
    this.models = {
      cpu: null,
      memory: null,
      disk: null,
      network: null,
      duration: null
    };
    
    // Job clusters
    this.jobClusters = new Map(); // clusterId -> jobTypes
    this.clusterProfiles = new Map(); // clusterId -> resourceProfile
    
    // Prediction cache
    this.predictionCache = new Map(); // jobSignature -> prediction
    this.cacheExpiry = 300000; // 5 minutes
    
    // Statistics
    this.stats = {
      totalPredictions: 0,
      accuratePredictions: 0,
      overProvisionedJobs: 0,
      underProvisionedJobs: 0,
      resourcesSaved: {
        cpu: 0,
        memory: 0,
        disk: 0
      }
    };
    
    this.isInitialized = false;
  }

  /**
   * Initialize the resource predictor
   */
  async initialize() {
    try {
      logger.info('Initializing Resource Predictor');
      
      // Load historical job data
      await this.loadHistoricalData();
      
      // Build job profiles
      await this.buildJobProfiles();
      
      // Classify jobs into clusters
      if (this.config.classification.enabled) {
        await this.classifyJobs();
      }
      
      // Train prediction models
      await this.trainModels();
      
      // Start update timer
      this.startUpdateTimer();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Resource Predictor initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Resource Predictor:', error);
      throw error;
    }
  }

  /**
   * Predict resources for a job
   */
  async predictResources(jobConfig) {
    try {
      const jobSignature = this.generateJobSignature(jobConfig);
      
      // Check cache
      const cached = this.getCachedPrediction(jobSignature);
      if (cached) {
        return cached;
      }
      
      // Get job profile
      const profile = await this.getJobProfile(jobConfig);
      
      // Base prediction on profile
      let prediction = {
        cpu: profile.cpu.p95 || 1.0,
        memory: profile.memory.p95 || 2048,
        disk: profile.disk.p95 || 10240,
        network: profile.network.p95 || 100,
        duration: profile.duration.p95 || 300000,
        confidence: 0.5
      };
      
      // Enhance with ML predictions if available
      if (this.models.cpu) {
        const mlPrediction = await this.predictWithML(jobConfig);
        prediction = this.mergePredictions(prediction, mlPrediction);
      }
      
      // Apply optimization rules
      prediction = this.applyOptimizationRules(prediction, jobConfig);
      
      // Add buffer for safety
      prediction = this.addSafetyBuffer(prediction);
      
      // Cache prediction
      this.cachePrediction(jobSignature, prediction);
      
      this.stats.totalPredictions++;
      
      this.emit('resourcesPredicted', {
        jobConfig,
        prediction,
        profile
      });
      
      return prediction;
      
    } catch (error) {
      logger.error('Failed to predict resources:', error);
      return this.getDefaultResources();
    }
  }

  /**
   * Get job profile
   */
  async getJobProfile(jobConfig) {
    const jobType = this.getJobType(jobConfig);
    
    // Check if we have a profile
    let profile = this.jobProfiles.get(jobType);
    if (profile && profile.sampleCount >= this.config.prediction.minSamples) {
      return profile;
    }
    
    // Check cluster profile
    if (this.config.classification.enabled) {
      const clusterId = await this.findJobCluster(jobConfig);
      profile = this.clusterProfiles.get(clusterId);
      if (profile) {
        return profile;
      }
    }
    
    // Return default profile
    return this.getDefaultProfile();
  }

  /**
   * Build job profiles from historical data
   */
  async buildJobProfiles() {
    logger.info('Building job profiles');
    
    for (const [jobId, metrics] of this.jobHistory) {
      const jobType = metrics.jobType;
      
      if (!this.jobProfiles.has(jobType)) {
        this.jobProfiles.set(jobType, this.createEmptyProfile());
      }
      
      const profile = this.jobProfiles.get(jobType);
      this.updateProfile(profile, metrics);
    }
    
    // Calculate statistics for each profile
    for (const [jobType, profile] of this.jobProfiles) {
      this.calculateProfileStatistics(profile);
    }
    
    logger.info(`Built ${this.jobProfiles.size} job profiles`);
  }

  /**
   * Classify jobs into clusters
   */
  async classifyJobs() {
    logger.info('Classifying jobs into clusters');
    
    const features = [];
    const jobTypes = [];
    
    // Extract features for clustering
    for (const [jobType, profile] of this.jobProfiles) {
      const feature = this.extractJobFeatures(jobType, profile);
      features.push(feature);
      jobTypes.push(jobType);
    }
    
    // Simple k-means clustering
    const clusters = this.kMeansClustering(features, this.config.classification.clusterCount);
    
    // Assign jobs to clusters
    for (let i = 0; i < jobTypes.length; i++) {
      const clusterId = clusters[i];
      
      if (!this.jobClusters.has(clusterId)) {
        this.jobClusters.set(clusterId, new Set());
      }
      
      this.jobClusters.get(clusterId).add(jobTypes[i]);
    }
    
    // Build cluster profiles
    for (const [clusterId, members] of this.jobClusters) {
      const clusterProfile = this.buildClusterProfile(members);
      this.clusterProfiles.set(clusterId, clusterProfile);
    }
    
    logger.info(`Created ${this.jobClusters.size} job clusters`);
  }

  /**
   * Train ML models
   */
  async trainModels() {
    logger.info('Training prediction models');
    
    // Prepare training data
    const trainingData = this.prepareTrainingData();
    
    if (trainingData.length < this.config.prediction.minSamples * 10) {
      logger.warn('Insufficient training data for ML models');
      return;
    }
    
    // Train CPU model
    this.models.cpu = await this.trainResourceModel('cpu', trainingData);
    
    // Train memory model
    this.models.memory = await this.trainResourceModel('memory', trainingData);
    
    // Train disk model
    this.models.disk = await this.trainResourceModel('disk', trainingData);
    
    // Train duration model
    this.models.duration = await this.trainDurationModel(trainingData);
    
    logger.info('Prediction models trained successfully');
  }

  /**
   * Train resource model
   */
  async trainResourceModel(resourceType, trainingData) {
    // Simple linear regression model
    return {
      type: 'linear_regression',
      resourceType,
      predict: (features) => {
        // Simplified prediction based on historical averages
        const similar = trainingData.filter(d => 
          this.calculateSimilarity(features, d.features) > 0.8
        );
        
        if (similar.length === 0) {
          return null;
        }
        
        const values = similar.map(d => d.resources[resourceType]);
        return {
          value: this.calculatePercentile(values, 0.95),
          confidence: Math.min(0.9, similar.length / 10)
        };
      }
    };
  }

  /**
   * Train duration model
   */
  async trainDurationModel(trainingData) {
    return {
      type: 'duration_regression',
      predict: (features) => {
        const similar = trainingData.filter(d => 
          this.calculateSimilarity(features, d.features) > 0.8
        );
        
        if (similar.length === 0) {
          return null;
        }
        
        const durations = similar.map(d => d.duration);
        return {
          value: this.calculatePercentile(durations, 0.95),
          confidence: Math.min(0.9, similar.length / 10)
        };
      }
    };
  }

  /**
   * Predict with ML models
   */
  async predictWithML(jobConfig) {
    const features = this.extractJobConfigFeatures(jobConfig);
    const prediction = {};
    
    // CPU prediction
    if (this.models.cpu) {
      const cpuPred = this.models.cpu.predict(features);
      if (cpuPred) {
        prediction.cpu = cpuPred.value;
        prediction.cpuConfidence = cpuPred.confidence;
      }
    }
    
    // Memory prediction
    if (this.models.memory) {
      const memPred = this.models.memory.predict(features);
      if (memPred) {
        prediction.memory = memPred.value;
        prediction.memoryConfidence = memPred.confidence;
      }
    }
    
    // Disk prediction
    if (this.models.disk) {
      const diskPred = this.models.disk.predict(features);
      if (diskPred) {
        prediction.disk = diskPred.value;
        prediction.diskConfidence = diskPred.confidence;
      }
    }
    
    // Duration prediction
    if (this.models.duration) {
      const durPred = this.models.duration.predict(features);
      if (durPred) {
        prediction.duration = durPred.value;
        prediction.durationConfidence = durPred.confidence;
      }
    }
    
    // Overall confidence
    const confidences = [
      prediction.cpuConfidence || 0,
      prediction.memoryConfidence || 0,
      prediction.diskConfidence || 0,
      prediction.durationConfidence || 0
    ].filter(c => c > 0);
    
    prediction.confidence = confidences.length > 0
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : 0.5;
    
    return prediction;
  }

  /**
   * Update job metrics
   */
  async updateJobMetrics(jobId, metrics) {
    try {
      // Store job metrics
      this.jobHistory.set(jobId, {
        ...metrics,
        timestamp: Date.now()
      });
      
      // Update job profile
      const jobType = this.getJobType(metrics);
      if (!this.jobProfiles.has(jobType)) {
        this.jobProfiles.set(jobType, this.createEmptyProfile());
      }
      
      const profile = this.jobProfiles.get(jobType);
      this.updateProfile(profile, metrics);
      
      // Check prediction accuracy
      if (metrics.predictedResources) {
        this.checkPredictionAccuracy(metrics);
      }
      
      // Emit update event
      this.emit('metricsUpdated', {
        jobId,
        jobType,
        metrics
      });
      
    } catch (error) {
      logger.error('Failed to update job metrics:', error);
    }
  }

  /**
   * Check prediction accuracy
   */
  checkPredictionAccuracy(metrics) {
    const predicted = metrics.predictedResources;
    const actual = metrics.actualResources;
    
    if (!predicted || !actual) return;
    
    // Calculate accuracy for each resource
    const accuracies = {};
    
    for (const resource of ['cpu', 'memory', 'disk']) {
      if (predicted[resource] && actual[resource]) {
        const error = Math.abs(predicted[resource] - actual[resource]) / actual[resource];
        accuracies[resource] = 1 - error;
        
        // Track over/under provisioning
        if (predicted[resource] > actual[resource] * 1.2) {
          this.stats.overProvisionedJobs++;
          this.stats.resourcesSaved[resource] += predicted[resource] - actual[resource];
        } else if (predicted[resource] < actual[resource] * 0.9) {
          this.stats.underProvisionedJobs++;
        }
      }
    }
    
    // Overall accuracy
    const avgAccuracy = Object.values(accuracies).reduce((sum, a) => sum + a, 0) / Object.values(accuracies).length;
    
    if (avgAccuracy > 0.8) {
      this.stats.accuratePredictions++;
    }
  }

  /**
   * Apply optimization rules
   */
  applyOptimizationRules(prediction, jobConfig) {
    const optimized = { ...prediction };
    
    // Time-based optimization
    const hour = new Date().getHours();
    if (hour >= 0 && hour <= 6) {
      // Off-peak hours - can be more aggressive
      optimized.cpu *= 0.9;
      optimized.memory *= 0.9;
    }
    
    // Priority-based optimization
    if (jobConfig.priority === 'low') {
      optimized.cpu *= 0.8;
      optimized.memory *= 0.8;
    } else if (jobConfig.priority === 'high') {
      optimized.cpu *= 1.2;
      optimized.memory *= 1.2;
    }
    
    // Cost optimization
    if (this.config.optimization.costOptimization) {
      // Implement cost-aware resource allocation
      const costPerCPU = 0.05; // Example cost
      const costPerGB = 0.01;
      
      // Optimize for cost while maintaining performance
      if (optimized.confidence < 0.8) {
        optimized.cpu = Math.min(optimized.cpu, 2.0);
        optimized.memory = Math.min(optimized.memory, 4096);
      }
    }
    
    return optimized;
  }

  /**
   * Add safety buffer
   */
  addSafetyBuffer(prediction) {
    const buffered = { ...prediction };
    const bufferFactor = this.config.optimization.overProvisioningFactor;
    
    // Apply buffer based on confidence
    const confidenceFactor = 1 + (1 - prediction.confidence) * (bufferFactor - 1);
    
    buffered.cpu *= confidenceFactor;
    buffered.memory *= confidenceFactor;
    buffered.disk *= Math.min(confidenceFactor, 1.1); // Less buffer for disk
    
    // Round to reasonable values
    buffered.cpu = Math.round(buffered.cpu * 10) / 10;
    buffered.memory = Math.ceil(buffered.memory / 256) * 256; // Round to 256MB
    buffered.disk = Math.ceil(buffered.disk / 1024) * 1024; // Round to 1GB
    
    return buffered;
  }

  /**
   * Helper methods
   */
  
  generateJobSignature(jobConfig) {
    return `${jobConfig.repository}-${jobConfig.workflow}-${jobConfig.runner_labels?.join(',') || ''}-${new Date().getHours()}`;
  }

  getJobType(jobConfig) {
    return jobConfig.jobType || `${jobConfig.repository}:${jobConfig.workflow}`;
  }

  getCachedPrediction(signature) {
    const cached = this.predictionCache.get(signature);
    if (cached && cached.expires > Date.now()) {
      return cached.prediction;
    }
    this.predictionCache.delete(signature);
    return null;
  }

  cachePrediction(signature, prediction) {
    this.predictionCache.set(signature, {
      prediction,
      expires: Date.now() + this.cacheExpiry
    });
  }

  createEmptyProfile() {
    return {
      cpu: { values: [], min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 },
      memory: { values: [], min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 },
      disk: { values: [], min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 },
      network: { values: [], min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 },
      duration: { values: [], min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 },
      sampleCount: 0
    };
  }

  updateProfile(profile, metrics) {
    profile.cpu.values.push(metrics.actualResources?.cpu || 0);
    profile.memory.values.push(metrics.actualResources?.memory || 0);
    profile.disk.values.push(metrics.actualResources?.disk || 0);
    profile.network.values.push(metrics.actualResources?.network || 0);
    profile.duration.values.push(metrics.duration || 0);
    profile.sampleCount++;
    
    // Keep only recent values
    const maxValues = 1000;
    for (const resource of ['cpu', 'memory', 'disk', 'network', 'duration']) {
      if (profile[resource].values.length > maxValues) {
        profile[resource].values = profile[resource].values.slice(-maxValues);
      }
    }
  }

  calculateProfileStatistics(profile) {
    for (const resource of ['cpu', 'memory', 'disk', 'network', 'duration']) {
      const values = profile[resource].values.sort((a, b) => a - b);
      if (values.length === 0) continue;
      
      profile[resource].min = values[0];
      profile[resource].max = values[values.length - 1];
      profile[resource].avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      profile[resource].p50 = this.calculatePercentile(values, 0.5);
      profile[resource].p95 = this.calculatePercentile(values, 0.95);
      profile[resource].p99 = this.calculatePercentile(values, 0.99);
    }
  }

  calculatePercentile(values, percentile) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  calculateSimilarity(features1, features2) {
    // Simple cosine similarity
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < features1.length; i++) {
      dotProduct += features1[i] * features2[i];
      norm1 += features1[i] * features1[i];
      norm2 += features2[i] * features2[i];
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  extractJobFeatures(jobType, profile) {
    return [
      profile.cpu.avg,
      profile.memory.avg,
      profile.disk.avg,
      profile.duration.avg,
      profile.cpu.p95 / profile.cpu.avg, // Variability
      profile.memory.p95 / profile.memory.avg
    ];
  }

  extractJobConfigFeatures(jobConfig) {
    return [
      jobConfig.repository?.length || 0,
      jobConfig.workflow?.length || 0,
      jobConfig.runner_labels?.length || 0,
      new Date().getHours(),
      new Date().getDay(),
      jobConfig.priority === 'high' ? 1 : 0
    ];
  }

  kMeansClustering(features, k) {
    // Simplified k-means implementation
    const assignments = new Array(features.length).fill(0);
    
    // Random initial assignment
    for (let i = 0; i < features.length; i++) {
      assignments[i] = Math.floor(Math.random() * k);
    }
    
    // Simple iteration (in practice, would iterate until convergence)
    for (let iteration = 0; iteration < 10; iteration++) {
      // Update assignments based on distance to centroids
      // Simplified for brevity
    }
    
    return assignments;
  }

  buildClusterProfile(jobTypes) {
    const clusterProfile = this.createEmptyProfile();
    
    for (const jobType of jobTypes) {
      const profile = this.jobProfiles.get(jobType);
      if (profile) {
        // Merge profiles
        for (const resource of ['cpu', 'memory', 'disk', 'network', 'duration']) {
          clusterProfile[resource].values.push(...profile[resource].values);
        }
        clusterProfile.sampleCount += profile.sampleCount;
      }
    }
    
    this.calculateProfileStatistics(clusterProfile);
    return clusterProfile;
  }

  async findJobCluster(jobConfig) {
    const features = this.extractJobConfigFeatures(jobConfig);
    let bestCluster = 0;
    let bestSimilarity = 0;
    
    for (const [clusterId, profile] of this.clusterProfiles) {
      const clusterFeatures = this.extractJobFeatures('cluster', profile);
      const similarity = this.calculateSimilarity(features, clusterFeatures);
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestCluster = clusterId;
      }
    }
    
    return bestCluster;
  }

  getDefaultProfile() {
    return {
      cpu: { p95: 1.0 },
      memory: { p95: 2048 },
      disk: { p95: 10240 },
      network: { p95: 100 },
      duration: { p95: 300000 }
    };
  }

  getDefaultResources() {
    return {
      cpu: 1.0,
      memory: 2048,
      disk: 10240,
      network: 100,
      duration: 300000,
      confidence: 0.3
    };
  }

  mergePredictions(basePrediction, mlPrediction) {
    const merged = { ...basePrediction };
    
    // Weighted average based on confidence
    const baseWeight = basePrediction.confidence;
    const mlWeight = mlPrediction.confidence;
    const totalWeight = baseWeight + mlWeight;
    
    if (totalWeight > 0) {
      for (const resource of ['cpu', 'memory', 'disk', 'network', 'duration']) {
        if (mlPrediction[resource] !== undefined) {
          merged[resource] = (
            basePrediction[resource] * baseWeight +
            mlPrediction[resource] * mlWeight
          ) / totalWeight;
        }
      }
      
      merged.confidence = (baseWeight + mlWeight) / 2;
    }
    
    return merged;
  }

  prepareTrainingData() {
    const trainingData = [];
    
    for (const [jobId, metrics] of this.jobHistory) {
      if (metrics.actualResources) {
        trainingData.push({
          features: this.extractJobConfigFeatures(metrics),
          resources: metrics.actualResources,
          duration: metrics.duration
        });
      }
    }
    
    return trainingData;
  }

  async loadHistoricalData() {
    // In production, this would load from database
    logger.info('Loading historical job data');
    
    // Generate synthetic data for testing
    const jobTypes = [
      'org/repo:build',
      'org/repo:test',
      'org/repo:deploy',
      'org/other-repo:lint',
      'org/other-repo:security-scan'
    ];
    
    for (let i = 0; i < 100; i++) {
      const jobType = jobTypes[Math.floor(Math.random() * jobTypes.length)];
      const jobId = `job-${i}`;
      
      this.jobHistory.set(jobId, {
        jobType,
        repository: jobType.split(':')[0],
        workflow: jobType.split(':')[1],
        actualResources: {
          cpu: 0.5 + Math.random() * 3.5,
          memory: 512 + Math.random() * 7680,
          disk: 1024 + Math.random() * 20480,
          network: 10 + Math.random() * 490
        },
        duration: 60000 + Math.random() * 540000, // 1-10 minutes
        timestamp: Date.now() - Math.random() * 30 * 24 * 3600000 // Last 30 days
      });
    }
  }

  startUpdateTimer() {
    setInterval(() => {
      // Periodically retrain models with new data
      this.trainModels().catch(err => 
        logger.error('Failed to retrain models:', err)
      );
    }, this.config.prediction.updateInterval);
  }

  /**
   * Get prediction insights
   */
  getPredictionInsights() {
    return {
      profiles: {
        total: this.jobProfiles.size,
        wellTrained: Array.from(this.jobProfiles.values())
          .filter(p => p.sampleCount >= this.config.prediction.minSamples).length
      },
      clusters: {
        total: this.jobClusters.size,
        profiles: this.clusterProfiles.size
      },
      models: {
        cpu: !!this.models.cpu,
        memory: !!this.models.memory,
        disk: !!this.models.disk,
        duration: !!this.models.duration
      },
      statistics: {
        ...this.stats,
        accuracy: this.stats.totalPredictions > 0
          ? (this.stats.accuratePredictions / this.stats.totalPredictions * 100).toFixed(2) + '%'
          : 'N/A'
      },
      cache: {
        size: this.predictionCache.size,
        hitRate: 'N/A' // Would need to track hits/misses
      }
    };
  }
}

module.exports = ResourcePredictor;