/**
 * Dynamic Container Pool Scaler
 * Intelligent scaling algorithms for container pool optimization
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class DynamicScaler extends EventEmitter {
  constructor(poolManager, options = {}) {
    super();
    
    this.poolManager = poolManager;
    
    this.config = {
      // Scaling thresholds
      thresholds: {
        scaleUpUtilization: options.scaleUpThreshold || 0.8, // 80%
        scaleDownUtilization: options.scaleDownThreshold || 0.3, // 30%
        criticalUtilization: options.criticalThreshold || 0.95, // 95%
        emergencyScaleUp: options.emergencyThreshold || 0.9, // 90%
      },
      
      // Scaling limits
      limits: {
        maxScaleUpPerInterval: options.maxScaleUpPerInterval || 3,
        maxScaleDownPerInterval: options.maxScaleDownPerInterval || 2,
        maxConcurrentScaling: options.maxConcurrentScaling || 5,
        minPoolSize: options.minPoolSize || 3,
        maxPoolSize: options.maxPoolSize || 20
      },
      
      // Timing configuration
      timing: {
        scalingInterval: options.scalingInterval || 30000, // 30 seconds
        scaleUpCooldown: options.scaleUpCooldown || 30000, // 30 seconds
        scaleDownCooldown: options.scaleDownCooldown || 180000, // 3 minutes
        evaluationWindow: options.evaluationWindow || 300000, // 5 minutes
        predictionWindow: options.predictionWindow || 600000 // 10 minutes
      },
      
      // Prediction algorithms
      prediction: {
        enablePredictiveScaling: options.enablePredictiveScaling !== false,
        demandSmoothingFactor: options.demandSmoothingFactor || 0.3,
        trendWeight: options.trendWeight || 0.4,
        seasonalityWeight: options.seasonalityWeight || 0.2,
        minimumDataPoints: options.minimumDataPoints || 10
      },
      
      // Cost optimization
      cost: {
        enableCostOptimization: options.enableCostOptimization !== false,
        containerCostPerHour: options.containerCostPerHour || 0.05,
        idleCostThreshold: options.idleCostThreshold || 0.8,
        scheduledScaleDown: options.scheduledScaleDown || []
      },
      
      ...options
    };
    
    // Scaling state
    this.isScaling = false;
    this.scalingInProgress = new Set();
    this.lastScaleUp = 0;
    this.lastScaleDown = 0;
    this.consecutiveScaleUps = 0;
    this.consecutiveScaleDowns = 0;
    
    // Metrics tracking
    this.metrics = {
      utilizationHistory: [],
      demandHistory: [],
      scalingHistory: [],
      containerAgeHistory: []
    };
    
    // Demand prediction
    this.demandPredictor = {
      smoothedDemand: 0,
      trendComponent: 0,
      seasonalComponents: new Map(),
      lastPrediction: null,
      predictionAccuracy: 0
    };
    
    // Statistics
    this.stats = {
      totalScaleUps: 0,
      totalScaleDowns: 0,
      totalContainersCreated: 0,
      totalContainersDestroyed: 0,
      avgScalingDecisionTime: 0,
      costSavings: 0,
      predictionAccuracy: 0,
      lastEvaluation: null
    };
    
    this.scalingTimer = null;
    this.isStarted = false;
  }

  /**
   * Start dynamic scaling engine
   */
  start() {
    if (this.isStarted) {
      logger.warn('Dynamic scaler already started');
      return;
    }
    
    logger.info('Starting Dynamic Container Pool Scaler');
    
    this.scalingTimer = setInterval(() => {
      this.evaluateScaling().catch(error => {
        logger.error('Scaling evaluation failed:', error);
      });
    }, this.config.timing.scalingInterval);
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info(`Dynamic scaler started with ${this.config.timing.scalingInterval}ms interval`);
  }

  /**
   * Stop dynamic scaling engine
   */
  stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Dynamic Container Pool Scaler');
    
    if (this.scalingTimer) {
      clearInterval(this.scalingTimer);
      this.scalingTimer = null;
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Dynamic scaler stopped');
  }

  /**
   * Main scaling evaluation logic
   */
  async evaluateScaling() {
    const startTime = Date.now();
    
    try {
      // Get current pool status
      const poolStatus = this.poolManager.getPoolStatus();
      const currentUtilization = poolStatus.stats.poolUtilization / 100;
      
      // Record metrics
      this.recordMetrics(poolStatus, currentUtilization);
      
      // Check cooldown periods
      if (!this.canScale()) {
        return;
      }
      
      // Evaluate scaling decision
      const scalingDecision = await this.makeScalingDecision(poolStatus, currentUtilization);
      
      // Execute scaling if needed
      if (scalingDecision.action !== 'none') {
        await this.executeScaling(scalingDecision);
      }
      
      // Update statistics
      const evaluationTime = Date.now() - startTime;
      this.updateEvaluationStats(evaluationTime);
      
      this.stats.lastEvaluation = new Date();
      
    } catch (error) {
      logger.error('Scaling evaluation failed:', error);
    }
  }

  /**
   * Make scaling decision based on current state and predictions
   */
  async makeScalingDecision(poolStatus, currentUtilization) {
    const decision = {
      action: 'none',
      count: 0,
      reason: '',
      priority: 'normal',
      confidence: 0
    };
    
    // Emergency scaling for critical utilization
    if (currentUtilization >= this.config.thresholds.criticalUtilization) {
      decision.action = 'scale_up';
      decision.count = Math.min(
        this.config.limits.maxScaleUpPerInterval * 2, // Double for emergency
        this.config.limits.maxPoolSize - poolStatus.poolSize
      );
      decision.reason = 'Emergency scaling - critical utilization';
      decision.priority = 'emergency';
      decision.confidence = 1.0;
      return decision;
    }
    
    // Regular scale up evaluation
    if (currentUtilization >= this.config.thresholds.scaleUpUtilization) {
      const scaleUpCount = this.calculateScaleUpCount(poolStatus, currentUtilization);
      if (scaleUpCount > 0) {
        decision.action = 'scale_up';
        decision.count = scaleUpCount;
        decision.reason = `High utilization: ${(currentUtilization * 100).toFixed(1)}%`;
        decision.confidence = Math.min(currentUtilization / this.config.thresholds.scaleUpUtilization, 1.0);
      }
    }
    
    // Scale down evaluation
    else if (currentUtilization <= this.config.thresholds.scaleDownUtilization) {
      const scaleDownCount = this.calculateScaleDownCount(poolStatus, currentUtilization);
      if (scaleDownCount > 0) {
        decision.action = 'scale_down';
        decision.count = scaleDownCount;
        decision.reason = `Low utilization: ${(currentUtilization * 100).toFixed(1)}%`;
        decision.confidence = Math.min(
          (this.config.thresholds.scaleDownUtilization - currentUtilization) / 
          this.config.thresholds.scaleDownUtilization, 1.0
        );
      }
    }
    
    // Apply predictive scaling adjustments
    if (this.config.prediction.enablePredictiveScaling) {
      this.applyPredictiveScaling(decision, poolStatus);
    }
    
    // Apply cost optimization
    if (this.config.cost.enableCostOptimization) {
      this.applyCostOptimization(decision, poolStatus);
    }
    
    return decision;
  }

  /**
   * Calculate scale up count
   */
  calculateScaleUpCount(poolStatus, utilization) {
    // Base scale up count based on utilization excess
    const utilizationExcess = utilization - this.config.thresholds.scaleUpUtilization;
    const baseCount = Math.ceil(utilizationExcess * poolStatus.poolSize);
    
    // Apply limits
    let scaleUpCount = Math.min(
      baseCount,
      this.config.limits.maxScaleUpPerInterval,
      this.config.limits.maxPoolSize - poolStatus.poolSize
    );
    
    // Aggressive scaling for consecutive high utilization
    if (this.consecutiveScaleUps > 2) {
      scaleUpCount = Math.min(scaleUpCount * 1.5, this.config.limits.maxScaleUpPerInterval);
    }
    
    // Consider pending demand
    const pendingDemand = this.estimatePendingDemand();
    if (pendingDemand > 0) {
      scaleUpCount = Math.max(scaleUpCount, Math.ceil(pendingDemand));
    }
    
    return Math.max(1, Math.floor(scaleUpCount));
  }

  /**
   * Calculate scale down count
   */
  calculateScaleDownCount(poolStatus, utilization) {
    // Calculate excess capacity
    const targetUtilization = (this.config.thresholds.scaleUpUtilization + this.config.thresholds.scaleDownUtilization) / 2;
    const excessCapacity = (targetUtilization - utilization) * poolStatus.poolSize;
    
    // Base scale down count
    let scaleDownCount = Math.floor(excessCapacity);
    
    // Apply limits
    scaleDownCount = Math.min(
      scaleDownCount,
      this.config.limits.maxScaleDownPerInterval,
      poolStatus.poolSize - this.config.limits.minPoolSize
    );
    
    // Conservative scaling for safety
    if (this.consecutiveScaleDowns > 3) {
      scaleDownCount = Math.max(1, Math.floor(scaleDownCount * 0.7));
    }
    
    // Don't scale down if demand is predicted to increase
    const predictedDemand = this.predictFutureDemand(this.config.timing.predictionWindow);
    if (predictedDemand > utilization * 1.2) {
      scaleDownCount = Math.min(scaleDownCount, 1);
    }
    
    return Math.max(0, scaleDownCount);
  }

  /**
   * Apply predictive scaling adjustments
   */
  applyPredictiveScaling(decision, poolStatus) {
    const prediction = this.predictFutureDemand(this.config.timing.predictionWindow);
    const currentUtilization = poolStatus.stats.poolUtilization / 100;
    
    // Adjust scale up decisions based on prediction
    if (decision.action === 'scale_up' && prediction < currentUtilization * 0.8) {
      decision.count = Math.max(1, Math.floor(decision.count * 0.7));
      decision.reason += ' (adjusted for predicted demand decrease)';
    }
    
    // Preemptive scale up for predicted demand increase
    if (decision.action === 'none' && prediction > currentUtilization * 1.3) {
      decision.action = 'scale_up';
      decision.count = Math.ceil((prediction - currentUtilization) * poolStatus.poolSize);
      decision.reason = 'Predictive scaling for anticipated demand increase';
      decision.confidence = this.demandPredictor.predictionAccuracy;
    }
    
    // Delay scale down if increase is predicted
    if (decision.action === 'scale_down' && prediction > currentUtilization * 1.1) {
      decision.action = 'none';
      decision.reason = 'Scale down delayed due to predicted demand increase';
    }
  }

  /**
   * Apply cost optimization
   */
  applyCostOptimization(decision, poolStatus) {
    const currentHour = new Date().getHours();
    const idleContainers = poolStatus.availableContainers;
    const totalContainers = poolStatus.poolSize;
    
    // Calculate idle cost
    const idleCost = idleContainers * this.config.cost.containerCostPerHour;
    const totalCost = totalContainers * this.config.cost.containerCostPerHour;
    const idleRatio = idleCost / totalCost;
    
    // Aggressive scale down during low usage hours
    if (idleRatio > this.config.cost.idleCostThreshold) {
      if (decision.action === 'scale_down') {
        decision.count = Math.min(decision.count + 1, idleContainers);
        decision.reason += ' (cost optimization)';
      } else if (decision.action === 'none' && idleContainers > 2) {
        decision.action = 'scale_down';
        decision.count = Math.min(2, idleContainers - 1);
        decision.reason = 'Cost optimization - high idle ratio';
      }
    }
    
    // Scheduled scale down
    for (const schedule of this.config.cost.scheduledScaleDown) {
      if (schedule.hours.includes(currentHour)) {
        if (decision.action === 'scale_up') {
          decision.count = Math.max(1, Math.floor(decision.count * 0.5));
          decision.reason += ' (scheduled scale down period)';
        }
      }
    }
  }

  /**
   * Execute scaling decision
   */
  async executeScaling(decision) {
    if (this.scalingInProgress.size >= this.config.limits.maxConcurrentScaling) {
      logger.warn('Maximum concurrent scaling operations reached');
      return;
    }
    
    logger.info(`Executing scaling: ${decision.action} ${decision.count} containers - ${decision.reason}`);
    
    this.isScaling = true;
    const scalingId = `${decision.action}_${Date.now()}`;
    this.scalingInProgress.add(scalingId);
    
    try {
      if (decision.action === 'scale_up') {
        await this.executeScaleUp(decision.count);
        this.lastScaleUp = Date.now();
        this.consecutiveScaleUps++;
        this.consecutiveScaleDowns = 0;
        this.stats.totalScaleUps++;
      } else if (decision.action === 'scale_down') {
        await this.executeScaleDown(decision.count);
        this.lastScaleDown = Date.now();
        this.consecutiveScaleDowns++;
        this.consecutiveScaleUps = 0;
        this.stats.totalScaleDowns++;
      }
      
      // Record scaling event
      this.recordScalingEvent(decision);
      
      this.emit('scalingCompleted', {
        action: decision.action,
        count: decision.count,
        reason: decision.reason,
        priority: decision.priority
      });
      
    } catch (error) {
      logger.error(`Scaling execution failed:`, error);
      this.emit('scalingFailed', {
        action: decision.action,
        count: decision.count,
        error: error.message
      });
    } finally {
      this.scalingInProgress.delete(scalingId);
      this.isScaling = this.scalingInProgress.size > 0;
    }
  }

  /**
   * Execute scale up
   */
  async executeScaleUp(count) {
    const promises = [];
    
    for (let i = 0; i < count; i++) {
      promises.push(this.poolManager.createPoolContainer());
    }
    
    const results = await Promise.allSettled(promises);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount++;
        this.stats.totalContainersCreated++;
      } else {
        errorCount++;
        logger.error('Container creation failed:', result.reason);
      }
    }
    
    logger.info(`Scale up completed: ${successCount} created, ${errorCount} failed`);
  }

  /**
   * Execute scale down
   */
  async executeScaleDown(count) {
    const poolStatus = this.poolManager.getPoolStatus();
    const availableContainers = Array.from(this.poolManager.availableContainers);
    
    if (availableContainers.length === 0) {
      logger.warn('No available containers to scale down');
      return;
    }
    
    // Select containers to remove (oldest first)
    const containersToRemove = this.selectContainersForRemoval(
      availableContainers, 
      Math.min(count, availableContainers.length)
    );
    
    const promises = [];
    for (const containerId of containersToRemove) {
      promises.push(this.poolManager.removeContainer(containerId));
    }
    
    const results = await Promise.allSettled(promises);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount++;
        this.stats.totalContainersDestroyed++;
      } else {
        errorCount++;
        logger.error('Container removal failed:', result.reason);
      }
    }
    
    logger.info(`Scale down completed: ${successCount} removed, ${errorCount} failed`);
  }

  /**
   * Select containers for removal
   */
  selectContainersForRemoval(availableContainers, count) {
    const containerDetails = [];
    
    for (const containerId of availableContainers) {
      const info = this.poolManager.containers.get(containerId);
      if (info) {
        containerDetails.push({
          id: containerId,
          age: Date.now() - info.createdAt.getTime(),
          jobCount: info.jobCount,
          lastUsed: info.lastUsed ? info.lastUsed.getTime() : 0
        });
      }
    }
    
    // Sort by age (oldest first), then by job count (highest first)
    containerDetails.sort((a, b) => {
      if (b.age !== a.age) return b.age - a.age;
      return b.jobCount - a.jobCount;
    });
    
    return containerDetails.slice(0, count).map(c => c.id);
  }

  /**
   * Check if scaling is allowed (cooldown periods)
   */
  canScale() {
    const now = Date.now();
    const scaleUpCooldown = now - this.lastScaleUp < this.config.timing.scaleUpCooldown;
    const scaleDownCooldown = now - this.lastScaleDown < this.config.timing.scaleDownCooldown;
    
    return !scaleUpCooldown && !scaleDownCooldown;
  }

  /**
   * Record metrics for analysis
   */
  recordMetrics(poolStatus, utilization) {
    const timestamp = Date.now();
    
    // Record utilization
    this.metrics.utilizationHistory.push({
      timestamp,
      utilization,
      poolSize: poolStatus.poolSize,
      availableContainers: poolStatus.availableContainers,
      busyContainers: poolStatus.busyContainers
    });
    
    // Keep history limited
    const maxHistory = 1000;
    if (this.metrics.utilizationHistory.length > maxHistory) {
      this.metrics.utilizationHistory.shift();
    }
    
    // Update demand predictor
    this.updateDemandPredictor(utilization);
  }

  /**
   * Update demand predictor with exponential smoothing
   */
  updateDemandPredictor(currentDemand) {
    const alpha = this.config.prediction.demandSmoothingFactor;
    
    if (this.demandPredictor.smoothedDemand === 0) {
      this.demandPredictor.smoothedDemand = currentDemand;
    } else {
      // Exponential smoothing
      this.demandPredictor.smoothedDemand = 
        alpha * currentDemand + (1 - alpha) * this.demandPredictor.smoothedDemand;
      
      // Update trend component
      const previousTrend = this.demandPredictor.trendComponent;
      this.demandPredictor.trendComponent = 
        alpha * (this.demandPredictor.smoothedDemand - currentDemand) + (1 - alpha) * previousTrend;
    }
  }

  /**
   * Predict future demand
   */
  predictFutureDemand(timeAheadMs) {
    if (this.metrics.utilizationHistory.length < this.config.prediction.minimumDataPoints) {
      return this.demandPredictor.smoothedDemand;
    }
    
    // Simple linear trend prediction
    const trendFactor = timeAheadMs / (this.config.timing.scalingInterval * 1000); // Convert to intervals
    const prediction = this.demandPredictor.smoothedDemand + 
                      (this.demandPredictor.trendComponent * trendFactor);
    
    // Apply seasonal adjustments (simplified)
    const hour = new Date().getHours();
    const seasonalAdjustment = this.getSeasonalAdjustment(hour);
    
    return Math.max(0, Math.min(1, prediction * seasonalAdjustment));
  }

  /**
   * Get seasonal adjustment factor
   */
  getSeasonalAdjustment(hour) {
    // Simple seasonal pattern (higher during business hours)
    const businessHours = [9, 10, 11, 12, 13, 14, 15, 16, 17];
    return businessHours.includes(hour) ? 1.2 : 0.8;
  }

  /**
   * Estimate pending demand
   */
  estimatePendingDemand() {
    // This would typically come from job queue size or webhook events
    // For now, return 0 as placeholder
    return 0;
  }

  /**
   * Record scaling event
   */
  recordScalingEvent(decision) {
    this.metrics.scalingHistory.push({
      timestamp: Date.now(),
      action: decision.action,
      count: decision.count,
      reason: decision.reason,
      priority: decision.priority,
      confidence: decision.confidence
    });
    
    // Keep history limited
    if (this.metrics.scalingHistory.length > 500) {
      this.metrics.scalingHistory.shift();
    }
  }

  /**
   * Update evaluation statistics
   */
  updateEvaluationStats(evaluationTime) {
    const currentAvg = this.stats.avgScalingDecisionTime;
    const totalEvaluations = this.stats.totalScaleUps + this.stats.totalScaleDowns + 1;
    
    this.stats.avgScalingDecisionTime = totalEvaluations > 1 ?
      ((currentAvg * (totalEvaluations - 1)) + evaluationTime) / totalEvaluations :
      evaluationTime;
  }

  /**
   * Get scaling statistics
   */
  getScalingStats() {
    return {
      isStarted: this.isStarted,
      isScaling: this.isScaling,
      scalingInProgress: this.scalingInProgress.size,
      stats: this.stats,
      metrics: {
        utilizationHistorySize: this.metrics.utilizationHistory.length,
        scalingHistorySize: this.metrics.scalingHistory.length,
        lastPrediction: this.demandPredictor.lastPrediction,
        predictionAccuracy: this.demandPredictor.predictionAccuracy
      },
      config: {
        scaleUpThreshold: this.config.thresholds.scaleUpUtilization,
        scaleDownThreshold: this.config.thresholds.scaleDownUtilization,
        scalingInterval: this.config.timing.scalingInterval,
        predictiveScaling: this.config.prediction.enablePredictiveScaling
      }
    };
  }

  /**
   * Get recent scaling history
   */
  getScalingHistory(limit = 50) {
    return this.metrics.scalingHistory
      .slice(-limit)
      .map(event => ({
        ...event,
        timestamp: new Date(event.timestamp).toISOString()
      }));
  }

  /**
   * Get utilization trends
   */
  getUtilizationTrends(timeWindow = 3600000) { // 1 hour default
    const cutoff = Date.now() - timeWindow;
    const recentHistory = this.metrics.utilizationHistory
      .filter(entry => entry.timestamp >= cutoff);
    
    if (recentHistory.length === 0) {
      return null;
    }
    
    const values = recentHistory.map(entry => entry.utilization);
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    return {
      average: avg,
      minimum: min,
      maximum: max,
      trend: this.demandPredictor.trendComponent,
      dataPoints: recentHistory.length,
      timeWindow: timeWindow
    };
  }
}

module.exports = DynamicScaler;