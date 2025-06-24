/**
 * Resource Optimization Engine
 * AI-driven resource optimization algorithms for efficient container management
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class ResourceOptimizationEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Optimization configuration
      optimization: {
        enabled: options.optimizationEnabled !== false,
        interval: options.optimizationInterval || 300000, // 5 minutes
        algorithms: {
          binPacking: options.binPackingEnabled !== false,
          predictive: options.predictiveEnabled !== false,
          costBased: options.costBasedEnabled !== false,
          energyEfficient: options.energyEfficientEnabled !== false
        },
        thresholds: {
          cpuEfficiency: options.cpuEfficiencyThreshold || 0.7, // 70%
          memoryEfficiency: options.memoryEfficiencyThreshold || 0.75, // 75%
          costEfficiency: options.costEfficiencyThreshold || 0.8, // 80%
          rebalanceTrigger: options.rebalanceTrigger || 0.3 // 30% imbalance
        }
      },
      
      // Machine learning configuration
      ml: {
        enabled: options.mlEnabled !== false,
        modelUpdateInterval: options.modelUpdateInterval || 3600000, // 1 hour
        minDataPoints: options.minDataPoints || 100,
        features: {
          timeSeries: options.timeSeriesEnabled !== false,
          patternRecognition: options.patternRecognitionEnabled !== false,
          anomalyDetection: options.anomalyDetectionEnabled !== false
        }
      },
      
      // Resource prediction
      prediction: {
        enabled: options.predictionEnabled !== false,
        horizons: {
          short: options.shortTermHorizon || 300000, // 5 minutes
          medium: options.mediumTermHorizon || 3600000, // 1 hour
          long: options.longTermHorizon || 86400000 // 24 hours
        },
        confidence: {
          minimum: options.minConfidence || 0.7,
          autoScale: options.autoScaleConfidence || 0.85
        }
      },
      
      // Cost optimization
      cost: {
        enabled: options.costOptimizationEnabled !== false,
        models: {
          perCpu: options.costPerCpu || 0.01, // $ per CPU-hour
          perMemory: options.costPerMemory || 0.005, // $ per GB-hour
          perStorage: options.costPerStorage || 0.001, // $ per GB-hour
          perNetwork: options.costPerNetwork || 0.0001 // $ per GB transferred
        },
        budgets: {
          hourly: options.hourlyBudget || 10,
          daily: options.dailyBudget || 200,
          monthly: options.monthlyBudget || 5000
        }
      },
      
      // Placement strategies
      placement: {
        strategy: options.placementStrategy || 'balanced', // balanced, packed, spread
        constraints: {
          sameHost: options.allowSameHost !== false,
          zoneAware: options.zoneAware || false,
          affinityRules: options.affinityRules || []
        }
      },
      
      ...options
    };
    
    // Resource tracking
    this.resourceData = {
      containers: new Map(), // containerId -> resource usage
      hosts: new Map(), // hostId -> available resources
      historical: [], // time-series data
      predictions: new Map() // containerId -> predicted usage
    };
    
    // ML models
    this.models = {
      demandPredictor: null,
      costOptimizer: null,
      anomalyDetector: null,
      patternAnalyzer: null
    };
    
    // Optimization state
    this.optimizationState = {
      lastRun: null,
      currentPlan: null,
      executionHistory: [],
      savings: {
        cpu: 0,
        memory: 0,
        cost: 0,
        energy: 0
      }
    };
    
    // Statistics
    this.stats = {
      totalOptimizations: 0,
      successfulOptimizations: 0,
      failedOptimizations: 0,
      resourcesSaved: {
        cpu: 0,
        memory: 0,
        storage: 0,
        network: 0
      },
      costSavings: {
        hourly: 0,
        daily: 0,
        total: 0
      },
      predictions: {
        total: 0,
        accurate: 0,
        accuracy: 0
      }
    };
    
    this.optimizationTimer = null;
    this.modelUpdateTimer = null;
    this.isStarted = false;
  }

  /**
   * Start optimization engine
   */
  async start() {
    if (this.isStarted) {
      logger.warn('Resource optimization engine already started');
      return;
    }
    
    logger.info('Starting Resource Optimization Engine');
    
    // Initialize ML models
    if (this.config.ml.enabled) {
      await this.initializeMLModels();
    }
    
    // Start optimization cycles
    if (this.config.optimization.enabled) {
      this.optimizationTimer = setInterval(() => {
        this.runOptimizationCycle().catch(error => {
          logger.error('Optimization cycle failed:', error);
        });
      }, this.config.optimization.interval);
    }
    
    // Start model updates
    if (this.config.ml.enabled) {
      this.modelUpdateTimer = setInterval(() => {
        this.updateMLModels().catch(error => {
          logger.error('Model update failed:', error);
        });
      }, this.config.ml.modelUpdateInterval);
    }
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Resource optimization engine started');
  }

  /**
   * Stop optimization engine
   */
  stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Resource Optimization Engine');
    
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
      this.optimizationTimer = null;
    }
    
    if (this.modelUpdateTimer) {
      clearInterval(this.modelUpdateTimer);
      this.modelUpdateTimer = null;
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Resource optimization engine stopped');
  }

  /**
   * Initialize ML models
   */
  async initializeMLModels() {
    try {
      // Initialize demand predictor
      this.models.demandPredictor = this.createDemandPredictor();
      
      // Initialize cost optimizer
      this.models.costOptimizer = this.createCostOptimizer();
      
      // Initialize anomaly detector
      this.models.anomalyDetector = this.createAnomalyDetector();
      
      // Initialize pattern analyzer
      this.models.patternAnalyzer = this.createPatternAnalyzer();
      
      logger.info('ML models initialized');
      
    } catch (error) {
      logger.error('Failed to initialize ML models:', error);
    }
  }

  /**
   * Create demand predictor model
   */
  createDemandPredictor() {
    return {
      type: 'exponential_smoothing',
      alpha: 0.3, // Smoothing factor
      beta: 0.1, // Trend factor
      gamma: 0.1, // Seasonal factor
      seasonalPeriods: 24, // Hourly seasonality
      
      predict: (historicalData, horizon) => {
        if (historicalData.length < 3) {
          return { value: historicalData[historicalData.length - 1] || 0, confidence: 0.5 };
        }
        
        // Simple exponential smoothing with trend
        let level = historicalData[0];
        let trend = historicalData.length > 1 ? historicalData[1] - historicalData[0] : 0;
        
        for (let i = 1; i < historicalData.length; i++) {
          const prevLevel = level;
          level = this.alpha * historicalData[i] + (1 - this.alpha) * (level + trend);
          trend = this.beta * (level - prevLevel) + (1 - this.beta) * trend;
        }
        
        // Project forward
        const steps = Math.ceil(horizon / this.config.optimization.interval);
        const prediction = level + (trend * steps);
        
        // Calculate confidence based on data variance
        const variance = this.calculateVariance(historicalData);
        const confidence = Math.max(0.5, Math.min(0.95, 1 - (variance / Math.abs(prediction))));
        
        return {
          value: Math.max(0, prediction),
          confidence,
          trend,
          seasonality: this.detectSeasonality(historicalData)
        };
      }
    };
  }

  /**
   * Create cost optimizer model
   */
  createCostOptimizer() {
    return {
      type: 'linear_programming',
      
      optimize: (resources, constraints, costs) => {
        // Simplified cost optimization using greedy approach
        const solution = {
          allocations: new Map(),
          totalCost: 0,
          savings: 0
        };
        
        // Sort containers by efficiency (value/cost ratio)
        const containers = Array.from(resources.entries())
          .map(([id, resource]) => ({
            id,
            resource,
            efficiency: this.calculateResourceEfficiency(resource),
            cost: this.calculateResourceCost(resource, costs)
          }))
          .sort((a, b) => b.efficiency / b.cost - a.efficiency / a.cost);
        
        // Allocate resources greedily
        let remainingBudget = constraints.budget || Infinity;
        
        for (const container of containers) {
          if (container.cost <= remainingBudget) {
            solution.allocations.set(container.id, {
              cpu: container.resource.cpu,
              memory: container.resource.memory,
              cost: container.cost
            });
            
            solution.totalCost += container.cost;
            remainingBudget -= container.cost;
          } else if (container.efficiency < this.config.optimization.thresholds.costEfficiency) {
            // Mark for deallocation
            solution.allocations.set(container.id, {
              cpu: 0,
              memory: 0,
              cost: 0,
              action: 'deallocate'
            });
            
            solution.savings += container.cost;
          }
        }
        
        return solution;
      }
    };
  }

  /**
   * Create anomaly detector model
   */
  createAnomalyDetector() {
    return {
      type: 'isolation_forest',
      contamination: 0.1, // Expected anomaly rate
      
      detect: (dataPoint, historicalData) => {
        if (historicalData.length < this.config.ml.minDataPoints) {
          return { isAnomaly: false, score: 0 };
        }
        
        // Calculate statistical measures
        const stats = this.calculateStatistics(historicalData);
        
        // Z-score based anomaly detection
        const zScores = {};
        for (const [key, value] of Object.entries(dataPoint)) {
          if (typeof value === 'number' && stats[key]) {
            zScores[key] = Math.abs((value - stats[key].mean) / stats[key].stdDev);
          }
        }
        
        // Combined anomaly score
        const anomalyScore = Object.values(zScores).reduce((sum, z) => sum + z, 0) / Object.keys(zScores).length;
        const threshold = 2.5; // Standard threshold
        
        return {
          isAnomaly: anomalyScore > threshold,
          score: anomalyScore,
          details: zScores,
          severity: anomalyScore > 3 ? 'high' : anomalyScore > 2.5 ? 'medium' : 'low'
        };
      }
    };
  }

  /**
   * Create pattern analyzer model
   */
  createPatternAnalyzer() {
    return {
      type: 'pattern_matching',
      
      analyze: (data, windowSize = 24) => {
        const patterns = {
          daily: [],
          weekly: [],
          trends: [],
          correlations: new Map()
        };
        
        if (data.length < windowSize * 2) {
          return patterns;
        }
        
        // Detect daily patterns
        patterns.daily = this.detectDailyPatterns(data, 24);
        
        // Detect weekly patterns
        patterns.weekly = this.detectWeeklyPatterns(data, 24 * 7);
        
        // Detect trends
        patterns.trends = this.detectTrends(data);
        
        // Detect correlations
        patterns.correlations = this.detectCorrelations(data);
        
        return patterns;
      }
    };
  }

  /**
   * Run optimization cycle
   */
  async runOptimizationCycle() {
    try {
      logger.info('Running resource optimization cycle');
      
      this.stats.totalOptimizations++;
      const startTime = Date.now();
      
      // Collect current resource data
      const resourceSnapshot = await this.collectResourceData();
      
      // Generate predictions
      const predictions = await this.generatePredictions(resourceSnapshot);
      
      // Run optimization algorithms
      const optimizationPlan = await this.generateOptimizationPlan(resourceSnapshot, predictions);
      
      // Validate optimization plan
      const validation = await this.validateOptimizationPlan(optimizationPlan);
      
      if (validation.isValid) {
        // Execute optimization plan
        await this.executeOptimizationPlan(optimizationPlan);
        
        this.stats.successfulOptimizations++;
        this.optimizationState.lastRun = new Date();
        this.optimizationState.currentPlan = optimizationPlan;
        
        // Record execution
        this.optimizationState.executionHistory.push({
          timestamp: new Date(),
          plan: optimizationPlan,
          duration: Date.now() - startTime,
          success: true
        });
        
        // Emit optimization completed event
        this.emit('optimizationCompleted', {
          plan: optimizationPlan,
          savings: this.calculateSavings(optimizationPlan),
          duration: Date.now() - startTime
        });
        
      } else {
        logger.warn('Optimization plan validation failed:', validation.reason);
        this.stats.failedOptimizations++;
      }
      
      // Clean up old history
      if (this.optimizationState.executionHistory.length > 100) {
        this.optimizationState.executionHistory.shift();
      }
      
    } catch (error) {
      logger.error('Optimization cycle failed:', error);
      this.stats.failedOptimizations++;
    }
  }

  /**
   * Collect resource data
   */
  async collectResourceData() {
    const snapshot = {
      timestamp: new Date(),
      containers: new Map(),
      hosts: new Map(),
      totals: {
        cpu: { used: 0, available: 0 },
        memory: { used: 0, available: 0 },
        storage: { used: 0, available: 0 },
        network: { ingress: 0, egress: 0 }
      }
    };
    
    // This would be populated from actual resource managers
    // For now, using mock data structure
    
    return snapshot;
  }

  /**
   * Generate predictions
   */
  async generatePredictions(resourceSnapshot) {
    const predictions = new Map();
    
    if (!this.config.prediction.enabled) {
      return predictions;
    }
    
    // Generate predictions for each container
    for (const [containerId, _resource] of resourceSnapshot.containers) {
      const historical = this.getHistoricalData(containerId);
      
      if (historical.length >= this.config.ml.minDataPoints) {
        const prediction = {
          shortTerm: this.predictResourceUsage(historical, this.config.prediction.horizons.short),
          mediumTerm: this.predictResourceUsage(historical, this.config.prediction.horizons.medium),
          longTerm: this.predictResourceUsage(historical, this.config.prediction.horizons.long)
        };
        
        predictions.set(containerId, prediction);
      }
    }
    
    return predictions;
  }

  /**
   * Predict resource usage
   */
  predictResourceUsage(historical, horizon) {
    if (!this.models.demandPredictor) {
      return { cpu: 0, memory: 0, confidence: 0 };
    }
    
    // Extract CPU and memory time series
    const cpuData = historical.map(h => h.cpu);
    const memoryData = historical.map(h => h.memory);
    
    // Generate predictions
    const cpuPrediction = this.models.demandPredictor.predict(cpuData, horizon);
    const memoryPrediction = this.models.demandPredictor.predict(memoryData, horizon);
    
    return {
      cpu: cpuPrediction.value,
      memory: memoryPrediction.value,
      confidence: (cpuPrediction.confidence + memoryPrediction.confidence) / 2,
      trend: {
        cpu: cpuPrediction.trend,
        memory: memoryPrediction.trend
      }
    };
  }

  /**
   * Generate optimization plan
   */
  async generateOptimizationPlan(resourceSnapshot, predictions) {
    const plan = {
      timestamp: new Date(),
      actions: [],
      estimatedSavings: {
        cpu: 0,
        memory: 0,
        cost: 0
      },
      confidence: 0
    };
    
    // Run different optimization algorithms
    if (this.config.optimization.algorithms.binPacking) {
      const binPackingActions = await this.runBinPackingOptimization(resourceSnapshot);
      plan.actions.push(...binPackingActions);
    }
    
    if (this.config.optimization.algorithms.predictive && predictions.size > 0) {
      const predictiveActions = await this.runPredictiveOptimization(resourceSnapshot, predictions);
      plan.actions.push(...predictiveActions);
    }
    
    if (this.config.optimization.algorithms.costBased) {
      const costActions = await this.runCostOptimization(resourceSnapshot);
      plan.actions.push(...costActions);
    }
    
    if (this.config.optimization.algorithms.energyEfficient) {
      const energyActions = await this.runEnergyOptimization(resourceSnapshot);
      plan.actions.push(...energyActions);
    }
    
    // Calculate estimated savings
    plan.estimatedSavings = this.calculateEstimatedSavings(plan.actions);
    
    // Calculate confidence
    plan.confidence = this.calculatePlanConfidence(plan.actions);
    
    return plan;
  }

  /**
   * Run bin packing optimization
   */
  async runBinPackingOptimization(resourceSnapshot) {
    const actions = [];
    
    // Sort containers by resource usage (descending)
    const containers = Array.from(resourceSnapshot.containers.entries())
      .map(([id, resource]) => ({ id, resource, size: resource.cpu + resource.memory }))
      .sort((a, b) => b.size - a.size);
    
    // Sort hosts by available capacity (descending)
    const hosts = Array.from(resourceSnapshot.hosts.entries())
      .map(([id, capacity]) => ({
        id,
        capacity,
        available: capacity.cpu + capacity.memory,
        allocated: []
      }))
      .sort((a, b) => b.available - a.available);
    
    // First-fit decreasing bin packing
    for (const container of containers) {
      // Check if container needs rebalancing
      const currentHost = this.findContainerHost(container.id);
      const currentHostLoad = this.calculateHostLoad(currentHost);
      
      if (currentHostLoad > this.config.optimization.thresholds.cpuEfficiency) {
        // Find better host
        for (const host of hosts) {
          if (host.id !== currentHost && 
              host.available >= container.size &&
              this.canPlaceContainer(container, host)) {
            
            actions.push({
              type: 'migrate',
              containerId: container.id,
              fromHost: currentHost,
              toHost: host.id,
              reason: 'bin_packing',
              priority: 'medium'
            });
            
            // Update host allocation
            host.available -= container.size;
            host.allocated.push(container.id);
            
            break;
          }
        }
      }
    }
    
    return actions;
  }

  /**
   * Run predictive optimization
   */
  async runPredictiveOptimization(resourceSnapshot, predictions) {
    const actions = [];
    
    for (const [containerId, prediction] of predictions) {
      const current = resourceSnapshot.containers.get(containerId);
      if (!current) continue;
      
      // Check short-term prediction
      if (prediction.shortTerm.confidence > this.config.prediction.confidence.minimum) {
        // Scale up if predicted usage exceeds current allocation
        if (prediction.shortTerm.cpu > current.cpuLimit * 0.9 ||
            prediction.shortTerm.memory > current.memoryLimit * 0.9) {
          
          actions.push({
            type: 'scale_up',
            containerId,
            newLimits: {
              cpu: Math.ceil(prediction.shortTerm.cpu * 1.2),
              memory: Math.ceil(prediction.shortTerm.memory * 1.2)
            },
            reason: 'predictive_scaling',
            confidence: prediction.shortTerm.confidence,
            priority: 'high'
          });
          
        } else if (prediction.shortTerm.cpu < current.cpuLimit * 0.3 &&
                   prediction.shortTerm.memory < current.memoryLimit * 0.3) {
          // Scale down if predicted usage is much lower
          
          actions.push({
            type: 'scale_down',
            containerId,
            newLimits: {
              cpu: Math.max(1, Math.ceil(prediction.shortTerm.cpu * 1.5)),
              memory: Math.max(512, Math.ceil(prediction.shortTerm.memory * 1.5))
            },
            reason: 'predictive_scaling',
            confidence: prediction.shortTerm.confidence,
            priority: 'low'
          });
        }
      }
      
      // Check for predicted spikes
      if (prediction.mediumTerm.trend.cpu > 0.2 || prediction.mediumTerm.trend.memory > 0.2) {
        actions.push({
          type: 'reserve_capacity',
          containerId,
          capacity: {
            cpu: Math.ceil(prediction.mediumTerm.cpu * 1.3),
            memory: Math.ceil(prediction.mediumTerm.memory * 1.3)
          },
          duration: this.config.prediction.horizons.medium,
          reason: 'predicted_spike',
          priority: 'medium'
        });
      }
    }
    
    return actions;
  }

  /**
   * Run cost optimization
   */
  async runCostOptimization(resourceSnapshot) {
    if (!this.models.costOptimizer) {
      return [];
    }
    
    const actions = [];
    
    // Calculate current costs
    const _currentCosts = this.calculateCurrentCosts(resourceSnapshot);
    
    // Run cost optimizer
    const solution = this.models.costOptimizer.optimize(
      resourceSnapshot.containers,
      { budget: this.config.cost.budgets.hourly },
      this.config.cost.models
    );
    
    // Generate actions from solution
    for (const [containerId, allocation] of solution.allocations) {
      if (allocation.action === 'deallocate') {
        actions.push({
          type: 'stop',
          containerId,
          reason: 'cost_optimization',
          estimatedSavings: allocation.cost,
          priority: 'low'
        });
      } else {
        const current = resourceSnapshot.containers.get(containerId);
        if (current && (allocation.cpu !== current.cpu || allocation.memory !== current.memory)) {
          actions.push({
            type: 'resize',
            containerId,
            newLimits: {
              cpu: allocation.cpu,
              memory: allocation.memory
            },
            reason: 'cost_optimization',
            estimatedSavings: current.cost - allocation.cost,
            priority: 'medium'
          });
        }
      }
    }
    
    return actions;
  }

  /**
   * Run energy optimization
   */
  async runEnergyOptimization(resourceSnapshot) {
    const actions = [];
    
    // Group containers by host
    const hostContainers = new Map();
    for (const [containerId, resource] of resourceSnapshot.containers) {
      const hostId = this.findContainerHost(containerId);
      if (!hostContainers.has(hostId)) {
        hostContainers.set(hostId, []);
      }
      hostContainers.get(hostId).push({ id: containerId, resource });
    }
    
    // Identify underutilized hosts
    for (const [hostId, containers] of hostContainers) {
      const hostCapacity = resourceSnapshot.hosts.get(hostId);
      if (!hostCapacity) continue;
      
      const utilization = this.calculateHostUtilization(containers, hostCapacity);
      
      if (utilization < 0.2 && containers.length > 0) {
        // Consolidate containers from underutilized host
        for (const container of containers) {
          const targetHost = this.findOptimalHost(
            container,
            resourceSnapshot.hosts,
            hostId // exclude current host
          );
          
          if (targetHost) {
            actions.push({
              type: 'migrate',
              containerId: container.id,
              fromHost: hostId,
              toHost: targetHost,
              reason: 'energy_consolidation',
              priority: 'low'
            });
          }
        }
        
        // Mark host for power down
        if (containers.length === actions.filter(a => a.fromHost === hostId).length) {
          actions.push({
            type: 'power_down_host',
            hostId,
            reason: 'energy_saving',
            estimatedSavings: this.calculateHostPowerConsumption(hostCapacity),
            priority: 'low'
          });
        }
      }
    }
    
    return actions;
  }

  /**
   * Validate optimization plan
   */
  async validateOptimizationPlan(plan) {
    const validation = {
      isValid: true,
      reason: null,
      warnings: []
    };
    
    // Check for conflicting actions
    const containerActions = new Map();
    for (const action of plan.actions) {
      if (action.containerId) {
        if (containerActions.has(action.containerId)) {
          validation.warnings.push(
            `Multiple actions for container ${action.containerId}`
          );
        }
        containerActions.set(action.containerId, action);
      }
    }
    
    // Validate resource constraints
    const resourceChanges = this.calculateResourceChanges(plan.actions);
    for (const [hostId, changes] of resourceChanges) {
      const hostCapacity = this.resourceData.hosts.get(hostId);
      if (hostCapacity) {
        if (changes.cpu > hostCapacity.cpu || changes.memory > hostCapacity.memory) {
          validation.isValid = false;
          validation.reason = `Resource constraints violated on host ${hostId}`;
          break;
        }
      }
    }
    
    // Validate cost constraints
    if (this.config.cost.enabled) {
      const estimatedCost = this.calculatePlanCost(plan);
      if (estimatedCost > this.config.cost.budgets.hourly) {
        validation.warnings.push('Plan may exceed hourly budget');
      }
    }
    
    // Check plan confidence
    if (plan.confidence < 0.5) {
      validation.warnings.push('Low confidence in optimization plan');
    }
    
    return validation;
  }

  /**
   * Execute optimization plan
   */
  async executeOptimizationPlan(plan) {
    logger.info(`Executing optimization plan with ${plan.actions.length} actions`);
    
    // Sort actions by priority
    const sortedActions = plan.actions.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
    });
    
    // Execute actions
    for (const action of sortedActions) {
      try {
        await this.executeAction(action);
        
        // Record success
        this.updateOptimizationStats(action, true);
        
      } catch (error) {
        logger.error(`Failed to execute optimization action:`, error);
        
        // Record failure
        this.updateOptimizationStats(action, false);
      }
    }
    
    // Update savings
    this.optimizationState.savings = this.calculateSavings(plan);
  }

  /**
   * Execute single optimization action
   */
  async executeAction(action) {
    logger.debug(`Executing ${action.type} action for container ${action.containerId || 'N/A'}`);
    
    // This would integrate with actual container and resource managers
    // For now, emit events for other components to handle
    
    this.emit('optimizationAction', action);
    
    switch (action.type) {
      case 'scale_up':
      case 'scale_down':
      case 'resize':
        this.emit('resizeContainer', {
          containerId: action.containerId,
          newLimits: action.newLimits,
          reason: action.reason
        });
        break;
        
      case 'migrate':
        this.emit('migrateContainer', {
          containerId: action.containerId,
          fromHost: action.fromHost,
          toHost: action.toHost,
          reason: action.reason
        });
        break;
        
      case 'stop':
        this.emit('stopContainer', {
          containerId: action.containerId,
          reason: action.reason
        });
        break;
        
      case 'reserve_capacity':
        this.emit('reserveCapacity', {
          containerId: action.containerId,
          capacity: action.capacity,
          duration: action.duration,
          reason: action.reason
        });
        break;
        
      case 'power_down_host':
        this.emit('powerDownHost', {
          hostId: action.hostId,
          reason: action.reason
        });
        break;
    }
  }

  /**
   * Update ML models
   */
  async updateMLModels() {
    try {
      logger.info('Updating ML models');
      
      // Collect training data
      const trainingData = this.prepareTrainingData();
      
      if (trainingData.length < this.config.ml.minDataPoints) {
        logger.warn('Insufficient data for model update');
        return;
      }
      
      // Update demand predictor
      if (this.models.demandPredictor) {
        this.updateDemandPredictor(trainingData);
      }
      
      // Update anomaly detector
      if (this.models.anomalyDetector) {
        this.updateAnomalyDetector(trainingData);
      }
      
      // Update pattern analyzer
      if (this.models.patternAnalyzer) {
        this.updatePatternAnalyzer(trainingData);
      }
      
      logger.info('ML models updated successfully');
      
    } catch (error) {
      logger.error('Failed to update ML models:', error);
    }
  }

  /**
   * Update resource data
   */
  updateResourceData(containerId, resourceUsage) {
    // Update current data
    this.resourceData.containers.set(containerId, {
      ...resourceUsage,
      timestamp: new Date()
    });
    
    // Add to historical data
    this.resourceData.historical.push({
      containerId,
      timestamp: new Date(),
      ...resourceUsage
    });
    
    // Limit historical data size
    const maxHistoricalSize = 10000;
    if (this.resourceData.historical.length > maxHistoricalSize) {
      this.resourceData.historical = this.resourceData.historical.slice(-maxHistoricalSize);
    }
    
    // Check for anomalies
    if (this.models.anomalyDetector) {
      const historical = this.getHistoricalData(containerId);
      const anomaly = this.models.anomalyDetector.detect(resourceUsage, historical);
      
      if (anomaly.isAnomaly) {
        this.emit('resourceAnomaly', {
          containerId,
          anomaly,
          resourceUsage,
          timestamp: new Date()
        });
      }
    }
  }

  /**
   * Get historical data for container
   */
  getHistoricalData(containerId) {
    return this.resourceData.historical
      .filter(h => h.containerId === containerId)
      .map(h => ({
        cpu: h.cpu,
        memory: h.memory,
        timestamp: h.timestamp
      }));
  }

  /**
   * Calculate variance
   */
  calculateVariance(data) {
    if (data.length < 2) return 0;
    
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const squaredDiffs = data.map(val => Math.pow(val - mean, 2));
    
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / data.length;
  }

  /**
   * Calculate statistics
   */
  calculateStatistics(data) {
    const stats = {};
    
    // Calculate stats for each numeric field
    const sample = data[0];
    for (const key of Object.keys(sample)) {
      if (typeof sample[key] === 'number') {
        const values = data.map(d => d[key]);
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const variance = this.calculateVariance(values);
        
        stats[key] = {
          mean,
          variance,
          stdDev: Math.sqrt(variance),
          min: Math.min(...values),
          max: Math.max(...values)
        };
      }
    }
    
    return stats;
  }

  /**
   * Calculate resource efficiency
   */
  calculateResourceEfficiency(resource) {
    const cpuEfficiency = resource.cpuUsed / resource.cpuLimit;
    const memoryEfficiency = resource.memoryUsed / resource.memoryLimit;
    
    return (cpuEfficiency + memoryEfficiency) / 2;
  }

  /**
   * Calculate resource cost
   */
  calculateResourceCost(resource, costModel) {
    const cpuCost = resource.cpuLimit * costModel.perCpu;
    const memoryCost = (resource.memoryLimit / 1024) * costModel.perMemory; // Convert to GB
    const storageCost = (resource.storageUsed / 1024) * costModel.perStorage;
    const networkCost = ((resource.networkIn + resource.networkOut) / 1024) * costModel.perNetwork;
    
    return cpuCost + memoryCost + storageCost + networkCost;
  }

  /**
   * Calculate savings
   */
  calculateSavings(plan) {
    const savings = {
      cpu: 0,
      memory: 0,
      cost: 0,
      energy: 0
    };
    
    for (const action of plan.actions) {
      if (action.estimatedSavings) {
        savings.cost += action.estimatedSavings;
      }
      
      if (action.type === 'scale_down' || action.type === 'resize') {
        const current = this.resourceData.containers.get(action.containerId);
        if (current && action.newLimits) {
          savings.cpu += Math.max(0, current.cpuLimit - action.newLimits.cpu);
          savings.memory += Math.max(0, current.memoryLimit - action.newLimits.memory);
        }
      }
      
      if (action.type === 'power_down_host') {
        savings.energy += action.estimatedSavings || 100; // Default 100W per host
      }
    }
    
    return savings;
  }

  /**
   * Update optimization statistics
   */
  updateOptimizationStats(action, success) {
    if (success) {
      switch (action.type) {
        case 'scale_down':
        case 'resize':
          if (action.newLimits) {
            this.stats.resourcesSaved.cpu += action.newLimits.cpu || 0;
            this.stats.resourcesSaved.memory += action.newLimits.memory || 0;
          }
          break;
          
        case 'stop':
          if (action.estimatedSavings) {
            this.stats.costSavings.hourly += action.estimatedSavings;
            this.stats.costSavings.total += action.estimatedSavings;
          }
          break;
      }
    }
  }

  /**
   * Helper methods for optimization algorithms
   */
  findContainerHost(_containerId) {
    // This would be implemented based on actual infrastructure
    return 'host-1';
  }

  calculateHostLoad(_hostId) {
    // Calculate host CPU/memory utilization
    return Math.random() * 0.9; // Mock implementation
  }

  canPlaceContainer(_container, _host) {
    // Check placement constraints
    return true; // Simplified
  }

  findOptimalHost(container, hosts, excludeHost) {
    // Find best host for container placement
    for (const [hostId, capacity] of hosts) {
      if (hostId !== excludeHost && 
          capacity.cpu >= container.resource.cpu &&
          capacity.memory >= container.resource.memory) {
        return hostId;
      }
    }
    return null;
  }

  calculateHostUtilization(containers, capacity) {
    const totalCpu = containers.reduce((sum, c) => sum + c.resource.cpu, 0);
    const totalMemory = containers.reduce((sum, c) => sum + c.resource.memory, 0);
    
    return Math.max(totalCpu / capacity.cpu, totalMemory / capacity.memory);
  }

  calculateHostPowerConsumption(capacity) {
    // Estimate power consumption based on capacity
    return 100 + (capacity.cpu * 10) + (capacity.memory * 0.5); // Watts
  }

  calculateResourceChanges(actions) {
    const changes = new Map();
    
    for (const action of actions) {
      if (action.type === 'migrate') {
        // Add to target host
        if (!changes.has(action.toHost)) {
          changes.set(action.toHost, { cpu: 0, memory: 0 });
        }
        const container = this.resourceData.containers.get(action.containerId);
        if (container) {
          changes.get(action.toHost).cpu += container.cpu;
          changes.get(action.toHost).memory += container.memory;
        }
      }
    }
    
    return changes;
  }

  calculatePlanCost(plan) {
    let totalCost = 0;
    
    for (const action of plan.actions) {
      if (action.newLimits) {
        const cost = this.calculateResourceCost(
          {
            cpuLimit: action.newLimits.cpu,
            memoryLimit: action.newLimits.memory,
            storageUsed: 0,
            networkIn: 0,
            networkOut: 0
          },
          this.config.cost.models
        );
        totalCost += cost;
      }
    }
    
    return totalCost;
  }

  calculateEstimatedSavings(actions) {
    return actions.reduce((savings, action) => {
      if (action.estimatedSavings) {
        savings.cost += action.estimatedSavings;
      }
      return savings;
    }, { cpu: 0, memory: 0, cost: 0 });
  }

  calculatePlanConfidence(actions) {
    if (actions.length === 0) return 0;
    
    const confidences = actions
      .filter(a => a.confidence)
      .map(a => a.confidence);
    
    if (confidences.length === 0) return 0.7; // Default confidence
    
    return confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  }

  prepareTrainingData() {
    // Prepare data for ML model training
    return this.resourceData.historical.slice(-1000);
  }

  updateDemandPredictor(_trainingData) {
    // Update exponential smoothing parameters based on recent performance
    const predictions = this.stats.predictions;
    if (predictions.total > 0) {
      const accuracy = predictions.accurate / predictions.total;
      
      // Adjust smoothing factors based on accuracy
      if (accuracy < 0.7) {
        this.models.demandPredictor.alpha = Math.min(0.5, this.models.demandPredictor.alpha * 1.1);
      } else if (accuracy > 0.9) {
        this.models.demandPredictor.alpha = Math.max(0.1, this.models.demandPredictor.alpha * 0.9);
      }
    }
  }

  updateAnomalyDetector(trainingData) {
    // Update anomaly detection thresholds based on recent data
    const stats = this.calculateStatistics(trainingData);
    
    // Store updated statistics for anomaly detection
    this.models.anomalyDetector.stats = stats;
  }

  updatePatternAnalyzer(_trainingData) {
    // Update pattern detection parameters
    // This would involve more sophisticated pattern learning
  }

  detectSeasonality(data) {
    // Simple seasonality detection
    if (data.length < 48) return null;
    
    // Check for daily patterns (24 hour cycle)
    const dailyCycle = [];
    for (let hour = 0; hour < 24; hour++) {
      const hourlyData = data.filter((_, idx) => idx % 24 === hour);
      if (hourlyData.length > 0) {
        dailyCycle[hour] = hourlyData.reduce((sum, val) => sum + val, 0) / hourlyData.length;
      }
    }
    
    return { daily: dailyCycle };
  }

  detectDailyPatterns(data, windowSize) {
    // Detect recurring daily patterns
    const patterns = [];
    
    if (data.length < windowSize * 7) return patterns;
    
    // Compare each day with previous days
    for (let day = 1; day < 7; day++) {
      const correlation = this.calculateCorrelation(
        data.slice(0, windowSize),
        data.slice(day * windowSize, (day + 1) * windowSize)
      );
      
      if (correlation > 0.7) {
        patterns.push({
          type: 'daily',
          dayOfWeek: day,
          correlation,
          strength: correlation > 0.9 ? 'strong' : 'moderate'
        });
      }
    }
    
    return patterns;
  }

  detectWeeklyPatterns(data, windowSize) {
    // Detect weekly patterns
    const patterns = [];
    
    if (data.length < windowSize * 4) return patterns;
    
    // Compare weeks
    const weekData1 = data.slice(0, windowSize);
    const weekData2 = data.slice(windowSize, windowSize * 2);
    
    const correlation = this.calculateCorrelation(weekData1, weekData2);
    
    if (correlation > 0.6) {
      patterns.push({
        type: 'weekly',
        correlation,
        strength: correlation > 0.8 ? 'strong' : 'moderate'
      });
    }
    
    return patterns;
  }

  detectTrends(data) {
    // Simple trend detection using linear regression
    const trends = [];
    
    if (data.length < 10) return trends;
    
    // Calculate slope
    const xValues = Array.from({ length: data.length }, (_, i) => i);
    const yValues = data.map(d => d.cpu || 0); // Use CPU as example
    
    const slope = this.calculateSlope(xValues, yValues);
    
    if (Math.abs(slope) > 0.01) {
      trends.push({
        metric: 'cpu',
        direction: slope > 0 ? 'increasing' : 'decreasing',
        rate: Math.abs(slope),
        strength: Math.abs(slope) > 0.1 ? 'strong' : 'moderate'
      });
    }
    
    return trends;
  }

  detectCorrelations(data) {
    // Detect correlations between metrics
    const correlations = new Map();
    
    if (data.length < 30) return correlations;
    
    // CPU vs Memory correlation
    const cpuData = data.map(d => d.cpu || 0);
    const memoryData = data.map(d => d.memory || 0);
    
    const correlation = this.calculateCorrelation(cpuData, memoryData);
    
    if (Math.abs(correlation) > 0.5) {
      correlations.set('cpu-memory', {
        value: correlation,
        strength: Math.abs(correlation) > 0.8 ? 'strong' : 'moderate',
        type: correlation > 0 ? 'positive' : 'negative'
      });
    }
    
    return correlations;
  }

  calculateCorrelation(x, y) {
    if (x.length !== y.length || x.length < 2) return 0;
    
    const n = x.length;
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
    const sumY2 = y.reduce((sum, val) => sum + val * val, 0);
    
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return den === 0 ? 0 : num / den;
  }

  calculateSlope(x, y) {
    if (x.length !== y.length || x.length < 2) return 0;
    
    const n = x.length;
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
    
    const num = n * sumXY - sumX * sumY;
    const den = n * sumX2 - sumX * sumX;
    
    return den === 0 ? 0 : num / den;
  }

  /**
   * Get optimization statistics
   */
  getStatistics() {
    return {
      isStarted: this.isStarted,
      stats: {
        ...this.stats,
        predictions: {
          ...this.stats.predictions,
          accuracy: this.stats.predictions.total > 0 ? 
            (this.stats.predictions.accurate / this.stats.predictions.total * 100).toFixed(1) + '%' : 'N/A'
        },
        successRate: this.stats.totalOptimizations > 0 ?
          (this.stats.successfulOptimizations / this.stats.totalOptimizations * 100).toFixed(1) + '%' : 'N/A'
      },
      optimizationState: {
        ...this.optimizationState,
        lastRun: this.optimizationState.lastRun?.toISOString() || 'Never',
        recentExecutions: this.optimizationState.executionHistory.slice(-5)
      },
      models: {
        demandPredictor: this.models.demandPredictor ? 'Active' : 'Inactive',
        costOptimizer: this.models.costOptimizer ? 'Active' : 'Inactive',
        anomalyDetector: this.models.anomalyDetector ? 'Active' : 'Inactive',
        patternAnalyzer: this.models.patternAnalyzer ? 'Active' : 'Inactive'
      },
      config: {
        optimization: this.config.optimization,
        ml: {
          enabled: this.config.ml.enabled,
          features: this.config.ml.features
        },
        prediction: {
          enabled: this.config.prediction.enabled,
          horizons: this.config.prediction.horizons
        },
        cost: {
          enabled: this.config.cost.enabled,
          budgets: this.config.cost.budgets
        }
      }
    };
  }
}

module.exports = ResourceOptimizationEngine;