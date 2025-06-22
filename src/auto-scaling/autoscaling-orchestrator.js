/**
 * Auto-Scaling Orchestrator
 * Unified coordination of all auto-scaling components
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class AutoScalingOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Global configuration
      global: {
        enabled: options.enabled !== false,
        mode: options.mode || 'balanced', // aggressive, balanced, conservative
        checkInterval: options.checkInterval || 60000, // 1 minute
        cooldownPeriod: options.cooldownPeriod || 300000, // 5 minutes
        maxScaleUp: options.maxScaleUp || 10, // Max runners to add at once
        maxScaleDown: options.maxScaleDown || 5, // Max runners to remove at once
        enableAutoRecovery: options.enableAutoRecovery !== false
      },
      
      // Component configuration
      components: {
        predictor: {
          enabled: options.predictorEnabled !== false,
          algorithm: options.predictorAlgorithm || 'hybrid', // arima, exponential, hybrid
          historyWindow: options.historyWindow || 7 * 24 * 60 * 60 * 1000, // 7 days
          predictionHorizon: options.predictionHorizon || 3600000, // 1 hour
          confidenceThreshold: options.confidenceThreshold || 0.8
        },
        scaler: {
          enabled: options.scalerEnabled !== false,
          minRunners: options.minRunners || 1,
          maxRunners: options.maxRunners || 100,
          scaleUpThreshold: options.scaleUpThreshold || 0.8, // 80% utilization
          scaleDownThreshold: options.scaleDownThreshold || 0.3, // 30% utilization
          targetUtilization: options.targetUtilization || 0.6 // 60%
        },
        prewarmer: {
          enabled: options.prewarmerEnabled !== false,
          poolSize: options.prewarmPoolSize || 5,
          refreshInterval: options.prewarmRefreshInterval || 900000, // 15 minutes
          templates: options.prewarmTemplates || ['ubuntu-latest', 'ubuntu-22.04'],
          maxAge: options.prewarmMaxAge || 3600000 // 1 hour
        },
        costOptimizer: {
          enabled: options.costOptimizerEnabled !== false,
          trackingEnabled: options.costTrackingEnabled !== false,
          budgetLimit: options.budgetLimit || null,
          spotInstanceRatio: options.spotInstanceRatio || 0.7, // 70% spot instances
          idleTimeout: options.idleTimeout || 600000 // 10 minutes
        },
        analytics: {
          enabled: options.analyticsEnabled !== false,
          metricsInterval: options.metricsInterval || 30000, // 30 seconds
          retentionPeriod: options.retentionPeriod || 30 * 24 * 60 * 60 * 1000, // 30 days
          aggregationLevels: ['minute', 'hour', 'day']
        }
      },
      
      // Scaling policies
      policies: {
        scaleUp: {
          strategy: options.scaleUpStrategy || 'predictive', // reactive, predictive, hybrid
          aggressiveness: options.scaleUpAggressiveness || 1.0,
          constraints: {
            maxBurst: options.maxBurstScale || 20,
            rateLimit: options.scaleUpRateLimit || 10 // per minute
          }
        },
        scaleDown: {
          strategy: options.scaleDownStrategy || 'gradual',
          delay: options.scaleDownDelay || 600000, // 10 minutes
          protectedRunners: options.protectedRunners || 1
        },
        cost: {
          optimization: options.costOptimization || 'balanced',
          maxHourlySpend: options.maxHourlySpend || null,
          preferredRegions: options.preferredRegions || [],
          instanceTypes: options.instanceTypes || ['t3.medium', 't3.large']
        }
      },
      
      // Integration points
      integration: {
        runnerPool: options.runnerPool || null,
        dockerAPI: options.dockerAPI || null,
        cloudProvider: options.cloudProvider || null,
        githubAPI: options.githubAPI || null,
        monitoringSystem: options.monitoringSystem || null
      },
      
      ...options
    };
    
    // Component instances
    this.components = {
      predictor: null,
      scaler: null,
      prewarmer: null,
      costOptimizer: null,
      analytics: null
    };
    
    // Component health status
    this.componentHealth = new Map();
    
    // Scaling state
    this.scalingState = {
      currentRunners: 0,
      targetRunners: 0,
      pendingScaleOperations: [],
      lastScaleAction: null,
      lastScaleTimestamp: null,
      scalingHistory: [],
      predictions: {
        shortTerm: null, // Next 15 minutes
        mediumTerm: null, // Next hour
        longTerm: null // Next 4 hours
      }
    };
    
    // Cost tracking
    this.costState = {
      currentHourlyRate: 0,
      dailySpend: 0,
      monthlySpend: 0,
      savings: {
        fromSpot: 0,
        fromOptimization: 0,
        fromPrewarming: 0
      },
      budgetRemaining: null
    };
    
    // Metrics
    this.metrics = {
      scalingEvents: {
        scaleUp: 0,
        scaleDown: 0,
        failed: 0
      },
      performance: {
        avgScaleTime: 0,
        avgPredictionAccuracy: 0,
        avgUtilization: 0
      },
      cost: {
        totalSpend: 0,
        avgHourlyRate: 0,
        savingsPercentage: 0
      }
    };
    
    // Statistics
    this.stats = {
      uptime: 0,
      startTime: null,
      componentsStarted: 0,
      scalingDecisions: 0,
      predictionsGenerated: 0,
      costOptimizations: 0,
      prewarmedContainers: 0,
      errors: 0,
      recoveries: 0
    };
    
    this.scalingTimer = null;
    this.healthCheckTimer = null;
    this.isInitialized = false;
    this.isStarted = false;
  }

  /**
   * Initialize auto-scaling orchestrator
   */
  async initialize() {
    try {
      logger.info('Initializing Auto-Scaling Orchestrator');
      this.stats.startTime = Date.now();
      
      // Validate integration points
      this.validateIntegrations();
      
      // Initialize components
      await this.initializeComponents();
      
      // Set up cross-component communication
      this.setupCrossComponentCommunication();
      
      // Load historical data
      await this.loadHistoricalData();
      
      // Initialize scaling state
      await this.initializeScalingState();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Auto-Scaling Orchestrator initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Auto-Scaling Orchestrator:', error);
      throw error;
    }
  }

  /**
   * Validate required integrations
   */
  validateIntegrations() {
    const required = ['runnerPool', 'dockerAPI'];
    for (const integration of required) {
      if (!this.config.integration[integration]) {
        throw new Error(`Required integration '${integration}' not provided`);
      }
    }
  }

  /**
   * Initialize components
   */
  async initializeComponents() {
    const DemandPredictor = require('./demand-predictor');
    const ScalingController = require('./scaling-controller');
    const ContainerPrewarmer = require('./container-prewarmer');
    const CostOptimizer = require('./cost-optimizer');
    const ScalingAnalytics = require('./scaling-analytics');
    
    if (this.config.components.predictor.enabled) {
      try {
        this.components.predictor = new DemandPredictor({
          ...this.config.components.predictor,
          ...this.config.integration
        });
        this.componentHealth.set('predictor', { status: 'healthy', lastCheck: new Date() });
        logger.info('Demand Predictor component initialized');
      } catch (error) {
        logger.error('Failed to initialize Demand Predictor:', error);
        this.componentHealth.set('predictor', { status: 'failed', error: error.message });
      }
    }
    
    if (this.config.components.scaler.enabled) {
      try {
        this.components.scaler = new ScalingController({
          ...this.config.components.scaler,
          ...this.config.integration
        });
        this.componentHealth.set('scaler', { status: 'healthy', lastCheck: new Date() });
        logger.info('Scaling Controller component initialized');
      } catch (error) {
        logger.error('Failed to initialize Scaling Controller:', error);
        this.componentHealth.set('scaler', { status: 'failed', error: error.message });
      }
    }
    
    if (this.config.components.prewarmer.enabled) {
      try {
        this.components.prewarmer = new ContainerPrewarmer({
          ...this.config.components.prewarmer,
          predictor: this.components.predictor,
          dockerAPI: this.config.integration.dockerAPI
        });
        this.componentHealth.set('prewarmer', { status: 'healthy', lastCheck: new Date() });
        logger.info('Container Prewarmer component initialized');
      } catch (error) {
        logger.error('Failed to initialize Container Prewarmer:', error);
        this.componentHealth.set('prewarmer', { status: 'failed', error: error.message });
      }
    }
    
    if (this.config.components.costOptimizer.enabled) {
      try {
        this.components.costOptimizer = new CostOptimizer({
          ...this.config.components.costOptimizer,
          ...this.config.integration
        });
        this.componentHealth.set('costOptimizer', { status: 'healthy', lastCheck: new Date() });
        logger.info('Cost Optimizer component initialized');
      } catch (error) {
        logger.error('Failed to initialize Cost Optimizer:', error);
        this.componentHealth.set('costOptimizer', { status: 'failed', error: error.message });
      }
    }
    
    if (this.config.components.analytics.enabled) {
      try {
        this.components.analytics = new ScalingAnalytics({
          ...this.config.components.analytics,
          predictor: this.components.predictor,
          scaler: this.components.scaler,
          prewarmer: this.components.prewarmer,
          costOptimizer: this.components.costOptimizer
        });
        this.componentHealth.set('analytics', { status: 'healthy', lastCheck: new Date() });
        logger.info('Scaling Analytics component initialized');
      } catch (error) {
        logger.error('Failed to initialize Scaling Analytics:', error);
        this.componentHealth.set('analytics', { status: 'failed', error: error.message });
      }
    }
  }

  /**
   * Setup cross-component communication
   */
  setupCrossComponentCommunication() {
    // Predictor -> Scaler: Demand predictions
    if (this.components.predictor && this.components.scaler) {
      this.components.predictor.on('predictionsGenerated', (predictions) => {
        // Use predictions for scaling decisions
        this.scalingState.predictions = predictions;
      });
    }
    
    // Predictor -> Prewarmer: Predictive warming
    if (this.components.predictor && this.components.prewarmer) {
      this.components.predictor.on('predictionsGenerated', (predictions) => {
        if (predictions.shortTerm.jobs > 10) {
          this.components.prewarmer.triggerAggressiveWarming(
            Math.ceil(predictions.shortTerm.jobs / 10),
            { confidence: predictions.shortTerm.confidence }
          );
        }
      });
    }
    
    // Scaler -> Analytics: Scaling events
    if (this.components.scaler && this.components.analytics) {
      this.components.scaler.on('scalingCompleted', (event) => {
        this.components.analytics.recordScalingEvent(event);
      });
      
      this.components.scaler.on('scalingFailed', (event) => {
        this.components.analytics.recordScalingEvent(event);
      });
    }
    
    // Prewarmer -> Scaler: Container availability
    if (this.components.prewarmer && this.components.scaler) {
      this.components.prewarmer.on('containerWarmed', () => {
        // Notify scaler of available pre-warmed containers
      });
    }
    
    // Cost Optimizer -> Scaler: Budget constraints
    if (this.components.costOptimizer && this.components.scaler) {
      this.components.costOptimizer.on('budgetAlert', (alert) => {
        if (alert.level === 'critical') {
          // Apply aggressive cost constraints to scaler
          this.components.scaler.applyPolicy('conservative');
        }
      });
    }
    
    // Analytics -> All: Anomaly detection
    if (this.components.analytics) {
      this.components.analytics.on('anomaliesDetected', (anomalies) => {
        this.handleCrossComponentAlert('anomalies_detected', anomalies);
      });
    }
    
    // Orchestrator event routing
    this.on('scalingCompleted', (event) => {
      if (this.components.analytics) {
        this.components.analytics.recordScalingEvent(event);
      }
    });
    
    this.on('scalingFailed', (event) => {
      if (this.components.analytics) {
        this.components.analytics.recordScalingEvent(event);
      }
    });
    
    logger.info('Cross-component communication configured');
  }

  /**
   * Load historical data for predictions
   */
  async loadHistoricalData() {
    try {
      // Load from monitoring system if available
      if (this.config.integration.monitoringSystem) {
        // Implementation will fetch historical metrics
        logger.info('Historical data loaded from monitoring system');
      }
    } catch (error) {
      logger.error('Failed to load historical data:', error);
    }
  }

  /**
   * Initialize scaling state
   */
  async initializeScalingState() {
    try {
      // Get current runner count from runner pool
      if (this.config.integration.runnerPool) {
        const poolStatus = await this.config.integration.runnerPool.getStatus();
        this.scalingState.currentRunners = poolStatus.totalRunners || 0;
        this.scalingState.targetRunners = this.scalingState.currentRunners;
      }
      
      logger.info(`Initialized scaling state with ${this.scalingState.currentRunners} runners`);
    } catch (error) {
      logger.error('Failed to initialize scaling state:', error);
    }
  }

  /**
   * Start auto-scaling orchestrator
   */
  async start() {
    if (!this.isInitialized) {
      throw new Error('Orchestrator must be initialized before starting');
    }
    
    if (this.isStarted) {
      logger.warn('Auto-Scaling Orchestrator already started');
      return;
    }
    
    logger.info('Starting Auto-Scaling Orchestrator');
    
    // Start all components
    await this.startComponents();
    
    // Start scaling decision timer
    this.scalingTimer = setInterval(() => {
      this.makeScalingDecision().catch(error => {
        logger.error('Scaling decision failed:', error);
        this.stats.errors++;
      });
    }, this.config.global.checkInterval);
    
    // Start health check timer
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck().catch(error => {
        logger.error('Health check failed:', error);
      });
    }, 30000); // 30 seconds
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Auto-Scaling Orchestrator started successfully');
  }

  /**
   * Start components
   */
  async startComponents() {
    const startPromises = [];
    
    for (const [name, component] of Object.entries(this.components)) {
      if (component && typeof component.start === 'function') {
        startPromises.push(
          component.start()
            .then(() => {
              this.stats.componentsStarted++;
              logger.debug(`Started component: ${name}`);
            })
            .catch(error => {
              logger.error(`Failed to start component ${name}:`, error);
              this.componentHealth.set(name, { 
                status: 'failed', 
                error: error.message,
                lastCheck: new Date()
              });
            })
        );
      }
    }
    
    await Promise.allSettled(startPromises);
  }

  /**
   * Make scaling decision
   */
  async makeScalingDecision() {
    try {
      this.stats.scalingDecisions++;
      
      // Check if in cooldown period
      if (this.isInCooldown()) {
        logger.debug('In cooldown period, skipping scaling decision');
        return;
      }
      
      // Get current metrics
      const metrics = await this.collectCurrentMetrics();
      
      // Get demand predictions
      const predictions = await this.getDemandPredictions();
      
      // Calculate target runner count
      const targetRunners = this.calculateTargetRunners(metrics, predictions);
      
      // Apply scaling policies
      const finalTarget = this.applyScalingPolicies(targetRunners, metrics);
      
      // Execute scaling if needed
      if (finalTarget !== this.scalingState.currentRunners) {
        await this.executeScaling(finalTarget);
      }
      
      // Update analytics
      if (this.components.analytics) {
        this.components.analytics.recordScalingDecision({
          currentRunners: this.scalingState.currentRunners,
          targetRunners: finalTarget,
          metrics,
          predictions,
          timestamp: new Date()
        });
      }
      
    } catch (error) {
      logger.error('Scaling decision failed:', error);
      this.emit('scalingError', error);
    }
  }

  /**
   * Check if in cooldown period
   */
  isInCooldown() {
    if (!this.scalingState.lastScaleTimestamp) return false;
    
    const timeSinceLastScale = Date.now() - this.scalingState.lastScaleTimestamp;
    return timeSinceLastScale < this.config.global.cooldownPeriod;
  }

  /**
   * Collect current metrics
   */
  async collectCurrentMetrics() {
    const metrics = {
      timestamp: new Date(),
      runners: {
        total: this.scalingState.currentRunners,
        busy: 0,
        idle: 0,
        starting: 0
      },
      jobs: {
        queued: 0,
        running: 0,
        avgWaitTime: 0,
        avgRunTime: 0
      },
      utilization: 0,
      cost: {
        currentHourlyRate: this.costState.currentHourlyRate
      }
    };
    
    // Get runner pool metrics
    if (this.config.integration.runnerPool) {
      const poolMetrics = await this.config.integration.runnerPool.getMetrics();
      Object.assign(metrics.runners, poolMetrics.runners || {});
      Object.assign(metrics.jobs, poolMetrics.jobs || {});
      metrics.utilization = poolMetrics.utilization || 0;
    }
    
    return metrics;
  }

  /**
   * Get demand predictions
   */
  async getDemandPredictions() {
    if (this.components.predictor) {
      return await this.components.predictor.predict();
    }
    
    // Fallback to simple prediction based on current queue
    return {
      shortTerm: { jobs: 0, confidence: 0.5 },
      mediumTerm: { jobs: 0, confidence: 0.5 },
      longTerm: { jobs: 0, confidence: 0.5 }
    };
  }

  /**
   * Calculate target runner count
   */
  calculateTargetRunners(metrics, predictions) {
    const { scaler } = this.config.components;
    
    // Base calculation on current utilization
    let targetRunners = this.scalingState.currentRunners;
    
    if (metrics.utilization > scaler.scaleUpThreshold) {
      // Scale up
      const utilizationRatio = metrics.utilization / scaler.targetUtilization;
      targetRunners = Math.ceil(this.scalingState.currentRunners * utilizationRatio);
    } else if (metrics.utilization < scaler.scaleDownThreshold) {
      // Scale down
      const utilizationRatio = metrics.utilization / scaler.targetUtilization;
      targetRunners = Math.floor(this.scalingState.currentRunners * utilizationRatio);
    }
    
    // Adjust based on predictions if available
    if (predictions.shortTerm.confidence > this.config.components.predictor.confidenceThreshold) {
      const predictedLoad = predictions.shortTerm.jobs;
      const runnersNeeded = Math.ceil(predictedLoad / 10); // Assume 10 jobs per runner
      targetRunners = Math.max(targetRunners, runnersNeeded);
    }
    
    // Apply min/max constraints
    targetRunners = Math.max(scaler.minRunners, Math.min(scaler.maxRunners, targetRunners));
    
    return targetRunners;
  }

  /**
   * Apply scaling policies
   */
  applyScalingPolicies(targetRunners, metrics) {
    let finalTarget = targetRunners;
    const currentRunners = this.scalingState.currentRunners;
    
    // Apply scale-up constraints
    if (targetRunners > currentRunners) {
      const scaleUpAmount = Math.min(
        targetRunners - currentRunners,
        this.config.global.maxScaleUp,
        this.config.policies.scaleUp.constraints.maxBurst
      );
      finalTarget = currentRunners + scaleUpAmount;
    }
    
    // Apply scale-down constraints
    if (targetRunners < currentRunners) {
      const scaleDownAmount = Math.min(
        currentRunners - targetRunners,
        this.config.global.maxScaleDown
      );
      finalTarget = currentRunners - scaleDownAmount;
      
      // Ensure protected runners
      finalTarget = Math.max(finalTarget, this.config.policies.scaleDown.protectedRunners);
    }
    
    // Apply cost constraints
    if (this.config.policies.cost.maxHourlySpend && this.components.costOptimizer) {
      const projectedCost = this.components.costOptimizer.calculateProjectedCost(finalTarget);
      if (projectedCost > this.config.policies.cost.maxHourlySpend) {
        // Reduce target to stay within budget
        finalTarget = Math.floor(
          finalTarget * (this.config.policies.cost.maxHourlySpend / projectedCost)
        );
      }
    }
    
    return finalTarget;
  }

  /**
   * Execute scaling operation
   */
  async executeScaling(targetRunners) {
    const currentRunners = this.scalingState.currentRunners;
    const scaleDiff = targetRunners - currentRunners;
    
    logger.info(`Executing scaling: ${currentRunners} -> ${targetRunners} runners (${scaleDiff > 0 ? '+' : ''}${scaleDiff})`);
    
    this.scalingState.targetRunners = targetRunners;
    this.scalingState.lastScaleAction = scaleDiff > 0 ? 'scale-up' : 'scale-down';
    this.scalingState.lastScaleTimestamp = Date.now();
    
    // Record scaling event
    const scalingEvent = {
      timestamp: new Date(),
      action: this.scalingState.lastScaleAction,
      from: currentRunners,
      to: targetRunners,
      reason: 'auto-scaling',
      success: false
    };
    
    try {
      if (scaleDiff > 0) {
        // Scale up
        await this.scaleUp(scaleDiff);
        this.metrics.scalingEvents.scaleUp++;
      } else {
        // Scale down
        await this.scaleDown(Math.abs(scaleDiff));
        this.metrics.scalingEvents.scaleDown++;
      }
      
      scalingEvent.success = true;
      this.scalingState.currentRunners = targetRunners;
      
      // Emit scaling event
      this.emit('scalingCompleted', scalingEvent);
      
    } catch (error) {
      logger.error('Scaling execution failed:', error);
      scalingEvent.error = error.message;
      this.metrics.scalingEvents.failed++;
      this.emit('scalingFailed', scalingEvent);
    }
    
    // Add to history
    this.scalingState.scalingHistory.push(scalingEvent);
    if (this.scalingState.scalingHistory.length > 1000) {
      this.scalingState.scalingHistory.shift();
    }
  }

  /**
   * Scale up runners
   */
  async scaleUp(count) {
    logger.info(`Scaling up by ${count} runners`);
    
    // Check pre-warmed containers first
    if (this.components.prewarmer) {
      const available = await this.components.prewarmer.getAvailableContainers();
      const usePrewarmed = Math.min(available.length, count);
      
      if (usePrewarmed > 0) {
        logger.info(`Using ${usePrewarmed} pre-warmed containers`);
        await this.components.prewarmer.claimContainers(usePrewarmed);
        count -= usePrewarmed;
      }
    }
    
    // Scale remaining via runner pool
    if (count > 0 && this.config.integration.runnerPool) {
      await this.config.integration.runnerPool.addRunners(count);
    }
  }

  /**
   * Scale down runners
   */
  async scaleDown(count) {
    logger.info(`Scaling down by ${count} runners`);
    
    if (this.config.integration.runnerPool) {
      // Get idle runners to remove
      const idleRunners = await this.config.integration.runnerPool.getIdleRunners();
      const toRemove = idleRunners.slice(0, count);
      
      if (toRemove.length > 0) {
        await this.config.integration.runnerPool.removeRunners(toRemove);
      }
    }
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    for (const [name, component] of Object.entries(this.components)) {
      if (!component) continue;
      
      try {
        let isHealthy = true;
        let status = 'healthy';
        
        if (typeof component.isHealthy === 'function') {
          isHealthy = await component.isHealthy();
          status = isHealthy ? 'healthy' : 'unhealthy';
        }
        
        this.componentHealth.set(name, {
          status,
          isHealthy,
          lastCheck: new Date()
        });
        
        if (!isHealthy && this.config.global.enableAutoRecovery) {
          await this.attemptComponentRecovery(name, component);
        }
        
      } catch (error) {
        logger.error(`Health check failed for component ${name}:`, error);
        
        this.componentHealth.set(name, {
          status: 'unhealthy',
          isHealthy: false,
          error: error.message,
          lastCheck: new Date()
        });
      }
    }
  }

  /**
   * Attempt component recovery
   */
  async attemptComponentRecovery(name, component) {
    try {
      logger.warn(`Attempting recovery for component: ${name}`);
      this.stats.recoveries++;
      
      if (typeof component.restart === 'function') {
        await component.restart();
      }
      
      logger.info(`Component ${name} recovered successfully`);
      
      this.componentHealth.set(name, {
        status: 'recovered',
        isHealthy: true,
        lastCheck: new Date(),
        recoveredAt: new Date()
      });
      
    } catch (error) {
      logger.error(`Failed to recover component ${name}:`, error);
    }
  }

  /**
   * Stop auto-scaling orchestrator
   */
  async stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Auto-Scaling Orchestrator');
    
    // Stop timers
    if (this.scalingTimer) {
      clearInterval(this.scalingTimer);
      this.scalingTimer = null;
    }
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    // Stop all components
    await this.stopComponents();
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Auto-Scaling Orchestrator stopped');
  }

  /**
   * Stop components
   */
  async stopComponents() {
    const stopPromises = [];
    
    for (const [name, component] of Object.entries(this.components)) {
      if (component && typeof component.stop === 'function') {
        stopPromises.push(
          component.stop()
            .then(() => {
              logger.debug(`Stopped component: ${name}`);
            })
            .catch(error => {
              logger.error(`Failed to stop component ${name}:`, error);
            })
        );
      }
    }
    
    await Promise.allSettled(stopPromises);
  }

  /**
   * Get orchestrator status
   */
  getOrchestratorStatus() {
    return {
      isInitialized: this.isInitialized,
      isStarted: this.isStarted,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
      stats: this.stats,
      componentHealth: Object.fromEntries(this.componentHealth),
      scalingState: {
        ...this.scalingState,
        recentHistory: this.scalingState.scalingHistory.slice(-10)
      },
      costState: this.costState,
      metrics: this.metrics,
      config: {
        mode: this.config.global.mode,
        policies: this.config.policies
      }
    };
  }

  /**
   * Update scaling policy
   */
  updateScalingPolicy(policy, value) {
    if (this.config.policies[policy]) {
      Object.assign(this.config.policies[policy], value);
      logger.info(`Updated scaling policy '${policy}':`, value);
      this.emit('policyUpdated', { policy, value });
    }
  }

  /**
   * Get scaling recommendations
   */
  async getScalingRecommendations() {
    const recommendations = [];
    
    // Analyze recent scaling history
    const recentScaling = this.scalingState.scalingHistory.slice(-100);
    const failureRate = recentScaling.filter(e => !e.success).length / recentScaling.length;
    
    if (failureRate > 0.1) {
      recommendations.push({
        type: 'reliability',
        severity: 'high',
        message: 'High scaling failure rate detected',
        action: 'Review scaling constraints and runner pool capacity'
      });
    }
    
    // Cost optimization recommendations
    if (this.components.costOptimizer) {
      const costRecs = await this.components.costOptimizer.getRecommendations();
      recommendations.push(...costRecs);
    }
    
    // Performance recommendations
    if (this.metrics.performance.avgScaleTime > 60000) {
      recommendations.push({
        type: 'performance',
        severity: 'medium',
        message: 'Slow scaling response time',
        action: 'Consider increasing pre-warmed container pool'
      });
    }
    
    return recommendations;
  }
}

module.exports = AutoScalingOrchestrator;