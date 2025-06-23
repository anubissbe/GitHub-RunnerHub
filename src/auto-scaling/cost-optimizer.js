/**
 * Cost Optimizer for Auto-Scaling
 * Implements cost tracking, budget management, and optimization strategies
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class CostOptimizer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Budget configuration
      budgetLimit: options.budgetLimit || null, // No limit by default
      dailyBudget: options.dailyBudget || null,
      monthlyBudget: options.monthlyBudget || null,
      alertThresholds: {
        warning: options.warningThreshold || 0.8, // 80% of budget
        critical: options.criticalThreshold || 0.95 // 95% of budget
      },
      
      // Cost tracking
      trackingEnabled: options.trackingEnabled !== false,
      granularity: options.granularity || 'hourly', // minute, hourly, daily
      retentionPeriod: options.retentionPeriod || 90 * 24 * 60 * 60 * 1000, // 90 days
      
      // Spot instance configuration
      spotEnabled: options.spotEnabled !== false,
      spotRatio: options.spotRatio || 0.7, // 70% spot instances
      spotMaxPrice: options.spotMaxPrice || 0.5, // 50% of on-demand price
      spotRegions: options.spotRegions || ['us-east-1', 'us-west-2'],
      
      // Instance optimization
      rightsizing: {
        enabled: options.rightsizingEnabled !== false,
        evaluationWindow: options.evaluationWindow || 24 * 60 * 60 * 1000, // 24 hours
        utilizationThreshold: options.utilizationThreshold || 0.2, // 20%
        oversizeThreshold: options.oversizeThreshold || 0.8 // 80%
      },
      
      // Idle detection
      idleDetection: {
        enabled: options.idleDetectionEnabled !== false,
        timeout: options.idleTimeout || 600000, // 10 minutes
        gracePerod: options.idleGracePeriod || 300000, // 5 minutes
        actionThreshold: options.idleActionThreshold || 0.05 // 5% utilization
      },
      
      // Cost allocation
      allocation: {
        enabled: options.allocationEnabled !== false,
        dimensions: options.allocationDimensions || ['team', 'project', 'repository'],
        defaultTags: options.defaultTags || {}
      },
      
      // Savings goals
      savingsTargets: {
        monthly: options.monthlySavingsTarget || 0.3, // 30% savings
        spot: options.spotSavingsTarget || 0.6, // 60% savings on spot
        idle: options.idleSavingsTarget || 0.9 // 90% savings on idle resources
      },
      
      // Integration points
      cloudAPI: options.cloudAPI || null,
      billingAPI: options.billingAPI || null,
      monitoringSystem: options.monitoringSystem || null,
      
      ...options
    };
    
    // Cost tracking
    this.costs = {
      current: {
        hourly: 0,
        daily: 0,
        monthly: 0,
        projected: 0
      },
      historical: new Map(), // timestamp -> cost data
      breakdown: {
        onDemand: 0,
        spot: 0,
        storage: 0,
        network: 0,
        other: 0
      },
      byResource: new Map(), // resourceId -> cost
      byTag: new Map() // tag -> cost
    };
    
    // Savings tracking
    this.savings = {
      total: 0,
      monthly: 0,
      fromSpot: 0,
      fromIdle: 0,
      fromRightsizing: 0,
      fromScheduling: 0,
      potential: 0
    };
    
    // Budget state
    this.budget = {
      remaining: null,
      spent: 0,
      utilization: 0,
      alerts: [],
      violations: []
    };
    
    // Resource tracking
    this.resources = new Map(); // resourceId -> resource info
    this.instances = new Map(); // instanceId -> instance cost data
    
    // Optimization recommendations
    this.recommendations = [];
    
    // Statistics
    this.stats = {
      costsTracked: 0,
      optimizationsApplied: 0,
      savingsRealized: 0,
      budgetAlerts: 0,
      resourcesOptimized: 0,
      spotsRecommended: 0,
      lastOptimization: null
    };
    
    this.costTrackingTimer = null;
    this.optimizationTimer = null;
    this.budgetCheckTimer = null;
    this.isStarted = false;
  }

  /**
   * Start cost optimizer
   */
  async start() {
    if (this.isStarted) {
      logger.warn('Cost Optimizer already started');
      return;
    }
    
    logger.info('Starting Cost Optimizer');
    
    // Initialize cost tracking
    await this.initializeCostTracking();
    
    // Start cost tracking timer
    this.costTrackingTimer = setInterval(() => {
      this.updateCostTracking().catch(error => {
        logger.error('Cost tracking update failed:', error);
      });
    }, this.getCostTrackingInterval());
    
    // Start optimization timer
    this.optimizationTimer = setInterval(() => {
      this.runOptimization().catch(error => {
        logger.error('Cost optimization failed:', error);
      });
    }, 3600000); // Every hour
    
    // Start budget monitoring if enabled
    if (this.config.budgetLimit) {
      this.budgetCheckTimer = setInterval(() => {
        this.checkBudget().catch(error => {
          logger.error('Budget check failed:', error);
        });
      }, 300000); // Every 5 minutes
    }
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Cost Optimizer started successfully');
  }

  /**
   * Initialize cost tracking
   */
  async initializeCostTracking() {
    try {
      // Load historical cost data
      await this.loadHistoricalCosts();
      
      // Initialize current costs
      await this.updateCurrentCosts();
      
      // Load resource inventory
      await this.loadResourceInventory();
      
      logger.info('Cost tracking initialized');
      
    } catch (error) {
      logger.error('Failed to initialize cost tracking:', error);
    }
  }

  /**
   * Load historical cost data
   */
  async loadHistoricalCosts() {
    if (!this.config.billingAPI) return;
    
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - this.config.retentionPeriod);
    
    try {
      const historicalData = await this.config.billingAPI.getCostData({
        startDate,
        endDate,
        granularity: this.config.granularity
      });
      
      for (const dataPoint of historicalData) {
        this.costs.historical.set(dataPoint.timestamp, dataPoint);
      }
      
      logger.info(`Loaded ${historicalData.length} historical cost data points`);
      
    } catch (error) {
      logger.error('Failed to load historical costs:', error);
    }
  }

  /**
   * Update current costs
   */
  async updateCurrentCosts() {
    try {
      const currentCosts = await this.calculateCurrentCosts();
      Object.assign(this.costs.current, currentCosts);
      
      // Update breakdown
      await this.updateCostBreakdown();
      
      // Track costs by resource
      await this.updateResourceCosts();
      
      this.stats.costsTracked++;
      
    } catch (error) {
      logger.error('Failed to update current costs:', error);
    }
  }

  /**
   * Calculate current costs
   */
  async calculateCurrentCosts() {
    const costs = {
      hourly: 0,
      daily: 0,
      monthly: 0,
      projected: 0
    };
    
    // Get running instances
    for (const [_instanceId, instance] of this.instances) {
      if (instance.state === 'running') {
        const hourlyCost = this.calculateInstanceHourlyCost(instance);
        costs.hourly += hourlyCost;
      }
    }
    
    // Calculate daily and monthly projections
    costs.daily = costs.hourly * 24;
    costs.monthly = costs.daily * 30;
    
    // Calculate projected monthly cost based on current usage
    const currentDate = new Date();
    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
    const dayOfMonth = currentDate.getDate();
    
    if (this.costs.historical.size > 0) {
      const monthToDate = this.getMonthToDateCost();
      costs.projected = (monthToDate / dayOfMonth) * daysInMonth;
    } else {
      costs.projected = costs.monthly;
    }
    
    return costs;
  }

  /**
   * Calculate instance hourly cost
   */
  calculateInstanceHourlyCost(instance) {
    // This would integrate with cloud provider pricing APIs
    // For now, using estimated costs
    
    const baseCosts = {
      't3.micro': 0.0104,
      't3.small': 0.0208,
      't3.medium': 0.0416,
      't3.large': 0.0832,
      't3.xlarge': 0.1664,
      't3.2xlarge': 0.3328
    };
    
    let hourlyCost = baseCosts[instance.instanceType] || 0.05;
    
    // Apply spot pricing discount
    if (instance.lifecycle === 'spot') {
      hourlyCost *= 0.3; // 70% discount
    }
    
    return hourlyCost;
  }

  /**
   * Update cost breakdown
   */
  async updateCostBreakdown() {
    const breakdown = {
      onDemand: 0,
      spot: 0,
      storage: 0,
      network: 0,
      other: 0
    };
    
    for (const [_instanceId, instance] of this.instances) {
      if (instance.state === 'running') {
        const cost = this.calculateInstanceHourlyCost(instance);
        
        if (instance.lifecycle === 'spot') {
          breakdown.spot += cost;
        } else {
          breakdown.onDemand += cost;
        }
      }
    }
    
    // Add storage and network costs (simplified)
    breakdown.storage = this.instances.size * 0.001; // $0.001 per instance
    breakdown.network = this.instances.size * 0.002; // $0.002 per instance
    
    Object.assign(this.costs.breakdown, breakdown);
  }

  /**
   * Update resource costs
   */
  async updateResourceCosts() {
    this.costs.byResource.clear();
    
    for (const [instanceId, instance] of this.instances) {
      if (instance.state === 'running') {
        const cost = this.calculateInstanceHourlyCost(instance);
        this.costs.byResource.set(instanceId, cost);
        
        // Track by tags
        if (instance.tags) {
          for (const [key, value] of Object.entries(instance.tags)) {
            const tagKey = `${key}:${value}`;
            const currentCost = this.costs.byTag.get(tagKey) || 0;
            this.costs.byTag.set(tagKey, currentCost + cost);
          }
        }
      }
    }
  }

  /**
   * Load resource inventory
   */
  async loadResourceInventory() {
    if (!this.config.cloudAPI) return;
    
    try {
      const instances = await this.config.cloudAPI.describeInstances();
      
      for (const instance of instances) {
        this.instances.set(instance.instanceId, {
          instanceId: instance.instanceId,
          instanceType: instance.instanceType,
          state: instance.state,
          lifecycle: instance.lifecycle,
          launchTime: new Date(instance.launchTime),
          tags: instance.tags || {},
          region: instance.region
        });
      }
      
      logger.info(`Loaded ${instances.length} instances in inventory`);
      
    } catch (error) {
      logger.error('Failed to load resource inventory:', error);
    }
  }

  /**
   * Run optimization
   */
  async runOptimization() {
    logger.info('Running cost optimization');
    
    try {
      // Clear old recommendations
      this.recommendations = [];
      
      // Generate recommendations
      await this.generateSpotRecommendations();
      await this.generateRightsizingRecommendations();
      await this.generateIdleResourceRecommendations();
      await this.generateSchedulingRecommendations();
      
      // Apply automatic optimizations
      await this.applyAutomaticOptimizations();
      
      // Calculate potential savings
      this.calculatePotentialSavings();
      
      this.stats.lastOptimization = new Date();
      
      this.emit('optimizationCompleted', {
        recommendations: this.recommendations.length,
        potentialSavings: this.savings.potential,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error('Cost optimization failed:', error);
    }
  }

  /**
   * Generate spot instance recommendations
   */
  async generateSpotRecommendations() {
    const candidates = [];
    
    for (const [instanceId, instance] of this.instances) {
      if (instance.state === 'running' && 
          instance.lifecycle === 'on-demand' &&
          this.isSpotCandidate(instance)) {
        
        const onDemandCost = this.calculateInstanceHourlyCost(instance);
        const spotCost = onDemandCost * 0.3; // 70% savings
        const savings = onDemandCost - spotCost;
        
        candidates.push({
          type: 'spot_instance',
          instanceId,
          current: { type: 'on-demand', cost: onDemandCost },
          recommended: { type: 'spot', cost: spotCost },
          savings: { hourly: savings, monthly: savings * 24 * 30 },
          confidence: this.calculateSpotConfidence(instance),
          implementation: {
            steps: [
              'Create launch template with spot configuration',
              'Launch spot replacement instance',
              'Migrate workload gracefully',
              'Terminate on-demand instance'
            ],
            effort: 'medium',
            risk: 'low'
          }
        });
      }
    }
    
    // Sort by potential savings
    candidates.sort((a, b) => b.savings.monthly - a.savings.monthly);
    
    this.recommendations.push(...candidates.slice(0, 10)); // Top 10
    this.stats.spotsRecommended += candidates.length;
  }

  /**
   * Check if instance is spot candidate
   */
  isSpotCandidate(instance) {
    // Check if workload is suitable for spot instances
    const age = Date.now() - instance.launchTime.getTime();
    const minAge = 2 * 60 * 60 * 1000; // 2 hours
    
    // Must be running for at least 2 hours
    if (age < minAge) return false;
    
    // Check if instance type supports spot
    const spotSupportedTypes = ['t3.', 'm5.', 'c5.', 'r5.'];
    const isSupported = spotSupportedTypes.some(type => 
      instance.instanceType.startsWith(type)
    );
    
    return isSupported;
  }

  /**
   * Calculate spot confidence
   */
  calculateSpotConfidence(instance) {
    // Historical spot interruption rate for instance type
    // This would use actual AWS/GCP data
    const baseConfidence = 0.8;
    
    // Adjust based on region
    if (this.config.spotRegions.includes(instance.region)) {
      return Math.min(0.95, baseConfidence + 0.1);
    }
    
    return baseConfidence;
  }

  /**
   * Generate rightsizing recommendations
   */
  async generateRightsizingRecommendations() {
    if (!this.config.rightsizing.enabled) return;
    
    for (const [instanceId, instance] of this.instances) {
      if (instance.state !== 'running') continue;
      
      const utilization = await this.getInstanceUtilization(instanceId);
      
      if (utilization.cpu < this.config.rightsizing.utilizationThreshold ||
          utilization.memory < this.config.rightsizing.utilizationThreshold) {
        
        const recommended = this.recommendSmallerInstance(instance, utilization);
        if (recommended) {
          const currentCost = this.calculateInstanceHourlyCost(instance);
          const newCost = this.calculateInstanceHourlyCost({ 
            ...instance, 
            instanceType: recommended.instanceType 
          });
          const savings = currentCost - newCost;
          
          this.recommendations.push({
            type: 'rightsize_down',
            instanceId,
            current: { instanceType: instance.instanceType, cost: currentCost },
            recommended: { instanceType: recommended.instanceType, cost: newCost },
            savings: { hourly: savings, monthly: savings * 24 * 30 },
            utilization,
            confidence: 0.9,
            implementation: {
              steps: [
                'Create snapshot of current instance',
                'Launch new instance with smaller type',
                'Migrate data and configuration',
                'Update DNS/load balancer',
                'Terminate original instance'
              ],
              effort: 'high',
              risk: 'medium'
            }
          });
        }
      }
    }
  }

  /**
   * Get instance utilization
   */
  async getInstanceUtilization(_instanceId) {
    // This would integrate with CloudWatch or monitoring system
    // For now, return simulated data
    
    return {
      cpu: Math.random() * 100,
      memory: Math.random() * 100,
      network: Math.random() * 100,
      period: '24h'
    };
  }

  /**
   * Recommend smaller instance
   */
  recommendSmallerInstance(instance, _utilization) {
    const downsizeMap = {
      't3.2xlarge': 't3.xlarge',
      't3.xlarge': 't3.large',
      't3.large': 't3.medium',
      't3.medium': 't3.small',
      't3.small': 't3.micro'
    };
    
    const recommended = downsizeMap[instance.instanceType];
    return recommended ? { instanceType: recommended } : null;
  }

  /**
   * Generate idle resource recommendations
   */
  async generateIdleResourceRecommendations() {
    if (!this.config.idleDetection.enabled) return;
    
    for (const [instanceId, instance] of this.instances) {
      if (instance.state !== 'running') continue;
      
      const utilization = await this.getInstanceUtilization(instanceId);
      const age = Date.now() - instance.launchTime.getTime();
      
      if (utilization.cpu < this.config.idleDetection.actionThreshold &&
          age > this.config.idleDetection.timeout) {
        
        const cost = this.calculateInstanceHourlyCost(instance);
        
        this.recommendations.push({
          type: 'terminate_idle',
          instanceId,
          current: { state: 'running', cost },
          recommended: { state: 'terminated', cost: 0 },
          savings: { hourly: cost, monthly: cost * 24 * 30 },
          utilization,
          idleTime: age,
          confidence: 0.95,
          implementation: {
            steps: [
              'Verify no active connections',
              'Gracefully shutdown applications',
              'Create final snapshot if needed',
              'Terminate instance'
            ],
            effort: 'low',
            risk: 'low'
          }
        });
      }
    }
  }

  /**
   * Generate scheduling recommendations
   */
  async generateSchedulingRecommendations() {
    // Recommend scheduled start/stop for development environments
    
    for (const [instanceId, instance] of this.instances) {
      if (instance.tags.Environment === 'development' ||
          instance.tags.Environment === 'staging') {
        
        const cost = this.calculateInstanceHourlyCost(instance);
        const scheduledSavings = cost * 12; // 12 hours saved per day
        
        this.recommendations.push({
          type: 'scheduled_shutdown',
          instanceId,
          schedule: { start: '09:00', stop: '18:00', timezone: 'UTC' },
          savings: { hourly: scheduledSavings, monthly: scheduledSavings * 30 },
          confidence: 0.8,
          implementation: {
            steps: [
              'Create Lambda function for scheduling',
              'Set up CloudWatch events',
              'Configure start/stop tags',
              'Test schedule'
            ],
            effort: 'medium',
            risk: 'low'
          }
        });
      }
    }
  }

  /**
   * Apply automatic optimizations
   */
  async applyAutomaticOptimizations() {
    // Only apply low-risk optimizations automatically
    
    const autoApplicable = this.recommendations.filter(rec => 
      rec.confidence > 0.9 && 
      rec.implementation.risk === 'low' &&
      rec.savings.monthly > 10 // Only if savings > $10/month
    );
    
    for (const recommendation of autoApplicable) {
      try {
        await this.applyRecommendation(recommendation);
        this.stats.optimizationsApplied++;
        
        logger.info(`Applied optimization: ${recommendation.type} for ${recommendation.instanceId}`);
        
      } catch (error) {
        logger.error(`Failed to apply optimization ${recommendation.type}:`, error);
      }
    }
  }

  /**
   * Apply recommendation
   */
  async applyRecommendation(recommendation) {
    switch (recommendation.type) {
      case 'terminate_idle':
        await this.terminateIdleInstance(recommendation.instanceId);
        break;
        
      case 'scheduled_shutdown':
        await this.setupScheduledShutdown(recommendation);
        break;
        
      default:
        logger.warn(`Cannot auto-apply recommendation type: ${recommendation.type}`);
    }
  }

  /**
   * Terminate idle instance
   */
  async terminateIdleInstance(instanceId) {
    if (!this.config.cloudAPI) return;
    
    // Final verification
    const utilization = await this.getInstanceUtilization(instanceId);
    if (utilization.cpu > this.config.idleDetection.actionThreshold) {
      throw new Error('Instance no longer idle, skipping termination');
    }
    
    await this.config.cloudAPI.terminateInstance(instanceId);
    
    // Update local state
    this.instances.delete(instanceId);
  }

  /**
   * Setup scheduled shutdown
   */
  async setupScheduledShutdown(recommendation) {
    // This would set up cloud provider scheduling
    logger.info(`Setting up scheduled shutdown for ${recommendation.instanceId}`);
  }

  /**
   * Calculate potential savings
   */
  calculatePotentialSavings() {
    let potential = 0;
    
    for (const recommendation of this.recommendations) {
      potential += recommendation.savings.monthly;
    }
    
    this.savings.potential = potential;
  }

  /**
   * Check budget
   */
  async checkBudget() {
    if (!this.config.budgetLimit) return;
    
    const spent = this.getMonthToDateCost();
    const remaining = this.config.budgetLimit - spent;
    const utilization = spent / this.config.budgetLimit;
    
    this.budget = {
      remaining,
      spent,
      utilization,
      alerts: [],
      violations: []
    };
    
    // Check thresholds
    if (utilization >= this.config.alertThresholds.critical) {
      this.budget.alerts.push({
        level: 'critical',
        message: `Budget utilization at ${(utilization * 100).toFixed(1)}%`,
        timestamp: new Date()
      });
      
      this.emit('budgetAlert', {
        level: 'critical',
        utilization,
        spent,
        remaining
      });
      
    } else if (utilization >= this.config.alertThresholds.warning) {
      this.budget.alerts.push({
        level: 'warning',
        message: `Budget utilization at ${(utilization * 100).toFixed(1)}%`,
        timestamp: new Date()
      });
      
      this.emit('budgetAlert', {
        level: 'warning',
        utilization,
        spent,
        remaining
      });
    }
    
    this.stats.budgetAlerts += this.budget.alerts.length;
  }

  /**
   * Get month-to-date cost
   */
  getMonthToDateCost() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    let total = 0;
    
    for (const [timestamp, costData] of this.costs.historical) {
      if (timestamp >= monthStart.getTime()) {
        total += costData.amount || 0;
      }
    }
    
    return total;
  }

  /**
   * Calculate projected cost
   */
  calculateProjectedCost(targetRunners) {
    // Simple projection based on current cost per runner
    const currentRunners = this.instances.size;
    if (currentRunners === 0) return 0;
    
    const costPerRunner = this.costs.current.hourly / currentRunners;
    return targetRunners * costPerRunner;
  }

  /**
   * Get cost tracking interval
   */
  getCostTrackingInterval() {
    switch (this.config.granularity) {
      case 'minute': return 60000; // 1 minute
      case 'hourly': return 3600000; // 1 hour
      case 'daily': return 86400000; // 1 day
      default: return 3600000;
    }
  }

  /**
   * Get recommendations
   */
  async getRecommendations() {
    return this.recommendations.slice(); // Return copy
  }

  /**
   * Stop cost optimizer
   */
  async stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Cost Optimizer');
    
    // Clear timers
    if (this.costTrackingTimer) {
      clearInterval(this.costTrackingTimer);
      this.costTrackingTimer = null;
    }
    
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
      this.optimizationTimer = null;
    }
    
    if (this.budgetCheckTimer) {
      clearInterval(this.budgetCheckTimer);
      this.budgetCheckTimer = null;
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Cost Optimizer stopped');
  }

  /**
   * Check if healthy
   */
  async isHealthy() {
    return this.isStarted && this.costs.current.hourly >= 0;
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return {
      costs: this.costs,
      savings: this.savings,
      budget: this.budget,
      stats: this.stats,
      recommendations: this.recommendations.length,
      instances: this.instances.size
    };
  }
}

module.exports = CostOptimizer;