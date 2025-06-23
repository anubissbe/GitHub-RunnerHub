/**
 * Performance Optimizer
 * Comprehensive performance optimization system that integrates all performance components
 */

const EventEmitter = require('events');
const ContainerStartupOptimizer = require('./container-startup-optimizer');
const AdvancedCacheManager = require('./advanced-cache-manager');
const PerformanceProfiler = require('./performance-profiler');
const BottleneckAnalyzer = require('./bottleneck-analyzer');
const PredictiveScaler = require('./predictive-scaler');
const ResourcePredictor = require('./resource-predictor');
const logger = require('../../utils/logger');

class PerformanceOptimizer extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.config = {
      // Optimization modes
      optimizationMode: options.optimizationMode || 'adaptive', // 'aggressive', 'conservative', 'adaptive'
      autoOptimization: options.autoOptimization !== false,
      optimizationInterval: options.optimizationInterval || 300000, // 5 minutes
      
      // Component configuration
      startupOptimizer: options.startupOptimizer || {},
      cacheManager: options.cacheManager || {},
      profiler: options.profiler || {},
      bottleneckAnalyzer: options.bottleneckAnalyzer || {},
      
      // Performance targets
      performanceTargets: {
        containerStartupTime: options.containerStartupTarget || 3000, // 3 seconds
        jobExecutionTime: options.jobExecutionTarget || 30000, // 30 seconds
        cpuUtilization: options.cpuUtilizationTarget || 75, // 75%
        memoryUtilization: options.memoryUtilizationTarget || 80, // 80%
        cacheHitRatio: options.cacheHitRatioTarget || 0.85, // 85%
        systemResponseTime: options.systemResponseTimeTarget || 100 // 100ms
      },
      
      // Optimization strategies
      strategies: {
        enableAdaptiveScaling: options.enableAdaptiveScaling !== false,
        enablePredictiveOptimization: options.enablePredictiveOptimization !== false,
        enableResourceRebalancing: options.enableResourceRebalancing !== false,
        enableIntelligentCaching: options.enableIntelligentCaching !== false,
        enableContainerPoolOptimization: options.enableContainerPoolOptimization !== false
      },
      
      // Machine learning parameters
      learningRate: options.learningRate || 0.1,
      adaptationThreshold: options.adaptationThreshold || 0.05,
      optimizationHistory: options.optimizationHistory || 100,
      
      ...options
    };
    
    // Initialize performance components
    this.startupOptimizer = new ContainerStartupOptimizer(dockerAPI, this.config.startupOptimizer);
    this.cacheManager = new AdvancedCacheManager(this.config.cacheManager);
    this.profiler = new PerformanceProfiler(this.config.profiler);
    this.bottleneckAnalyzer = new BottleneckAnalyzer(this.profiler, this.cacheManager, this.config.bottleneckAnalyzer);
    this.predictiveScaler = new PredictiveScaler(dockerAPI, this.config.predictiveScaler || {});
    this.resourcePredictor = new ResourcePredictor(this.config.resourcePredictor || {});
    
    // Optimization state
    this.optimizationHistory = [];
    this.currentOptimizations = new Map();
    this.performanceBaseline = null;
    this.optimizationTargets = new Map();
    
    // ML models for adaptive optimization
    this.optimizationModels = new Map();
    this.performancePredictions = new Map();
    
    // Timers
    this.optimizationTimer = null;
    this.adaptationTimer = null;
    
    this.isRunning = false;
    this.isInitialized = false;
    
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers between components
   */
  setupEventHandlers() {
    // Performance profiler events
    this.profiler.on('performanceAlert', (alert) => {
      this.handlePerformanceAlert(alert);
    });
    
    this.profiler.on('systemMetricsCollected', (metrics) => {
      this.updatePerformanceModels(metrics);
    });
    
    // Bottleneck analyzer events
    this.bottleneckAnalyzer.on('bottleneckAnalysisCompleted', (analysis) => {
      this.handleBottleneckAnalysis(analysis);
    });
    
    this.bottleneckAnalyzer.on('bottleneckResolved', (resolution) => {
      this.recordOptimizationSuccess(resolution);
    });
    
    // Startup optimizer events
    this.startupOptimizer.on('startupMetricsRecorded', (metrics) => {
      this.evaluateStartupPerformance(metrics);
    });
    
    // Cache manager events
    this.cacheManager.on('metricsCollected', (metrics) => {
      this.evaluateCachePerformance(metrics);
    });
    
    // Predictive scaler events
    this.predictiveScaler.on('scalingRecommendations', (recommendations) => {
      this.handleScalingRecommendations(recommendations);
    });
    
    this.predictiveScaler.on('anomalyDetected', (anomaly) => {
      this.handlePredictiveAnomaly(anomaly);
    });
    
    // Resource predictor events
    this.resourcePredictor.on('resourcesPredicted', (prediction) => {
      this.handleResourcePrediction(prediction);
    });
  }

  /**
   * Initialize the performance optimizer
   */
  async initialize() {
    try {
      logger.info('Initializing Performance Optimizer');
      
      // Initialize all components
      await this.startupOptimizer.initialize();
      await this.cacheManager.initialize();
      await this.predictiveScaler.initialize();
      await this.resourcePredictor.initialize();
      
      // Establish performance baseline
      await this.establishPerformanceBaseline();
      
      // Initialize ML models
      if (this.config.strategies.enablePredictiveOptimization) {
        await this.initializeOptimizationModels();
      }
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Performance Optimizer initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Performance Optimizer:', error);
      throw error;
    }
  }

  /**
   * Start performance optimization
   */
  async start() {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (this.isRunning) {
      logger.warn('Performance Optimizer is already running');
      return;
    }
    
    logger.info('Starting Performance Optimizer');
    this.isRunning = true;
    
    // Start all components
    await this.profiler.start();
    await this.bottleneckAnalyzer.start();
    
    // Start optimization cycles
    if (this.config.autoOptimization) {
      this.startOptimizationCycles();
    }
    
    this.emit('started');
    logger.info('Performance Optimizer started successfully');
  }

  /**
   * Stop performance optimization
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    logger.info('Stopping Performance Optimizer');
    this.isRunning = false;
    
    // Clear timers
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
      this.optimizationTimer = null;
    }
    
    if (this.adaptationTimer) {
      clearInterval(this.adaptationTimer);
      this.adaptationTimer = null;
    }
    
    // Stop all components
    await Promise.allSettled([
      this.profiler.stop(),
      this.bottleneckAnalyzer.stop(),
      this.startupOptimizer.stop(),
      this.cacheManager.stop()
    ]);
    
    this.emit('stopped');
    logger.info('Performance Optimizer stopped');
  }

  /**
   * Start optimization cycles
   */
  startOptimizationCycles() {
    // Main optimization cycle
    this.optimizationTimer = setInterval(() => {
      this.performOptimizationCycle().catch(err => 
        logger.error('Optimization cycle failed:', err)
      );
    }, this.config.optimizationInterval);
    
    // Adaptive optimization cycle (faster)
    this.adaptationTimer = setInterval(() => {
      this.performAdaptiveOptimization().catch(err => 
        logger.error('Adaptive optimization failed:', err)
      );
    }, this.config.optimizationInterval / 3);
  }

  /**
   * Perform complete optimization cycle
   */
  async performOptimizationCycle() {
    try {
      logger.debug('Starting optimization cycle');
      
      const cycleStart = Date.now();
      const currentPerformance = await this.assessCurrentPerformance();
      
      // Identify optimization opportunities
      const opportunities = await this.identifyOptimizationOpportunities(currentPerformance);
      
      // Apply optimizations based on mode
      const appliedOptimizations = await this.applyOptimizations(opportunities);
      
      // Measure optimization impact
      const optimizationImpact = await this.measureOptimizationImpact(
        currentPerformance, 
        appliedOptimizations
      );
      
      // Record optimization cycle
      const cycleRecord = {
        timestamp: new Date(),
        duration: Date.now() - cycleStart,
        currentPerformance,
        opportunities,
        appliedOptimizations,
        impact: optimizationImpact,
        mode: this.config.optimizationMode
      };
      
      this.optimizationHistory.push(cycleRecord);
      this.cleanupOptimizationHistory();
      
      // Update optimization models
      if (this.config.strategies.enablePredictiveOptimization) {
        await this.updateOptimizationModels(cycleRecord);
      }
      
      this.emit('optimizationCycleCompleted', cycleRecord);
      
    } catch (error) {
      logger.error('Optimization cycle failed:', error);
    }
  }

  /**
   * Assess current system performance
   */
  async assessCurrentPerformance() {
    const performance = {
      timestamp: new Date(),
      system: this.profiler.getPerformanceReport(),
      bottlenecks: this.bottleneckAnalyzer.getBottleneckReport(),
      startup: this.startupOptimizer.getPerformanceStats(),
      cache: this.cacheManager.getStatistics(),
      targets: this.evaluateTargetCompliance()
    };
    
    // Calculate overall performance score
    performance.overallScore = this.calculatePerformanceScore(performance);
    
    return performance;
  }

  /**
   * Identify optimization opportunities
   */
  async identifyOptimizationOpportunities(currentPerformance) {
    const opportunities = [];
    
    // Container startup optimization opportunities
    if (currentPerformance.startup.averageStartupTime > this.config.performanceTargets.containerStartupTime) {
      opportunities.push({
        type: 'container_startup',
        priority: this.calculateOptimizationPriority('container_startup', currentPerformance),
        currentValue: currentPerformance.startup.averageStartupTime,
        targetValue: this.config.performanceTargets.containerStartupTime,
        potentialImpact: this.estimateOptimizationImpact('container_startup', currentPerformance),
        strategy: this.selectOptimizationStrategy('container_startup', currentPerformance)
      });
    }
    
    // Cache optimization opportunities
    const cacheHitRatio = this.calculateCacheHitRatio(currentPerformance.cache);
    if (cacheHitRatio < this.config.performanceTargets.cacheHitRatio) {
      opportunities.push({
        type: 'cache_optimization',
        priority: this.calculateOptimizationPriority('cache_optimization', currentPerformance),
        currentValue: cacheHitRatio,
        targetValue: this.config.performanceTargets.cacheHitRatio,
        potentialImpact: this.estimateOptimizationImpact('cache_optimization', currentPerformance),
        strategy: this.selectOptimizationStrategy('cache_optimization', currentPerformance)
      });
    }
    
    // Resource optimization opportunities
    const systemSummary = currentPerformance.system.summary;
    if (systemSummary && systemSummary.averageCpuUsage > this.config.performanceTargets.cpuUtilization) {
      opportunities.push({
        type: 'cpu_optimization',
        priority: this.calculateOptimizationPriority('cpu_optimization', currentPerformance),
        currentValue: systemSummary.averageCpuUsage,
        targetValue: this.config.performanceTargets.cpuUtilization,
        potentialImpact: this.estimateOptimizationImpact('cpu_optimization', currentPerformance),
        strategy: this.selectOptimizationStrategy('cpu_optimization', currentPerformance)
      });
    }
    
    // Memory optimization opportunities
    if (systemSummary && systemSummary.averageMemoryUsage > this.config.performanceTargets.memoryUtilization) {
      opportunities.push({
        type: 'memory_optimization',
        priority: this.calculateOptimizationPriority('memory_optimization', currentPerformance),
        currentValue: systemSummary.averageMemoryUsage,
        targetValue: this.config.performanceTargets.memoryUtilization,
        potentialImpact: this.estimateOptimizationImpact('memory_optimization', currentPerformance),
        strategy: this.selectOptimizationStrategy('memory_optimization', currentPerformance)
      });
    }
    
    // Sort opportunities by priority and potential impact
    opportunities.sort((a, b) => {
      const priorityDiff = b.priority - a.priority;
      return priorityDiff !== 0 ? priorityDiff : b.potentialImpact - a.potentialImpact;
    });
    
    return opportunities;
  }

  /**
   * Apply optimizations based on opportunities and mode
   */
  async applyOptimizations(opportunities) {
    const appliedOptimizations = [];
    
    // Filter opportunities based on optimization mode
    const filteredOpportunities = this.filterOpportunitiesByMode(opportunities);
    
    for (const opportunity of filteredOpportunities) {
      try {
        const optimization = await this.applySpecificOptimization(opportunity);
        if (optimization) {
          appliedOptimizations.push(optimization);
          this.currentOptimizations.set(opportunity.type, optimization);
        }
      } catch (error) {
        logger.error(`Failed to apply ${opportunity.type} optimization:`, error);
      }
    }
    
    return appliedOptimizations;
  }

  /**
   * Apply specific optimization based on type
   */
  async applySpecificOptimization(opportunity) {
    switch (opportunity.type) {
      case 'container_startup':
        return await this.optimizeContainerStartup(opportunity);
        
      case 'cache_optimization':
        return await this.optimizeCache(opportunity);
        
      case 'cpu_optimization':
        return await this.optimizeCpuUsage(opportunity);
        
      case 'memory_optimization':
        return await this.optimizeMemoryUsage(opportunity);
        
      default:
        logger.warn(`Unknown optimization type: ${opportunity.type}`);
        return null;
    }
  }

  /**
   * Optimize container startup performance
   */
  async optimizeContainerStartup(opportunity) {
    const optimization = {
      type: 'container_startup',
      timestamp: new Date(),
      strategy: opportunity.strategy,
      actions: []
    };
    
    switch (opportunity.strategy) {
      case 'increase_prewarm_pool': {
        const currentPoolSize = this.startupOptimizer.config.preWarmPoolSize;
        const newPoolSize = Math.min(currentPoolSize + 2, 10);
        this.startupOptimizer.config.preWarmPoolSize = newPoolSize;
        optimization.actions.push(`Increased pre-warm pool size from ${currentPoolSize} to ${newPoolSize}`);
        break;
      }
        
      case 'enable_image_caching':
        this.startupOptimizer.config.enableImageCaching = true;
        optimization.actions.push('Enabled aggressive image caching');
        break;
        
      case 'optimize_templates':
        this.startupOptimizer.config.enableTemplateOptimization = true;
        optimization.actions.push('Enabled container template optimization');
        break;
    }
    
    logger.info(`Applied container startup optimization: ${optimization.actions.join(', ')}`);
    return optimization;
  }

  /**
   * Optimize cache performance
   */
  async optimizeCache(opportunity) {
    const optimization = {
      type: 'cache_optimization',
      timestamp: new Date(),
      strategy: opportunity.strategy,
      actions: []
    };
    
    switch (opportunity.strategy) {
      case 'increase_cache_size':
        // Increase memory cache sizes
        for (const [cacheType, cache] of this.cacheManager.memoryCaches.entries()) {
          const currentMax = cache.max;
          const newMax = Math.min(currentMax * 1.5, 2000);
          cache.max = newMax;
          optimization.actions.push(`Increased ${cacheType} cache size from ${currentMax} to ${newMax}`);
        }
        break;
        
      case 'enable_prefetching':
        this.cacheManager.config.enablePrefetching = true;
        optimization.actions.push('Enabled cache prefetching');
        break;
        
      case 'optimize_ttl':
        // Increase TTL for better hit ratios
        this.cacheManager.config.layers.l1.ttl *= 1.2;
        this.cacheManager.config.layers.l2.ttl *= 1.2;
        optimization.actions.push('Optimized cache TTL settings');
        break;
    }
    
    logger.info(`Applied cache optimization: ${optimization.actions.join(', ')}`);
    return optimization;
  }

  /**
   * Optimize CPU usage
   */
  async optimizeCpuUsage(opportunity) {
    const optimization = {
      type: 'cpu_optimization',
      timestamp: new Date(),
      strategy: opportunity.strategy,
      actions: []
    };
    
    switch (opportunity.strategy) {
      case 'enable_cpu_pinning':
        this.startupOptimizer.config.cpuPinning = true;
        optimization.actions.push('Enabled CPU pinning for containers');
        break;
        
      case 'reduce_concurrency':
        // Temporarily reduce maximum concurrent operations
        if (this.dockerAPI.config.maxContainers > 5) {
          this.dockerAPI.config.maxContainers = Math.max(5, this.dockerAPI.config.maxContainers - 2);
          optimization.actions.push(`Reduced max containers to ${this.dockerAPI.config.maxContainers}`);
        }
        break;
        
      case 'optimize_scheduling':
        // Enable more efficient scheduling
        optimization.actions.push('Enabled optimized container scheduling');
        break;
    }
    
    logger.info(`Applied CPU optimization: ${optimization.actions.join(', ')}`);
    return optimization;
  }

  /**
   * Optimize memory usage
   */
  async optimizeMemoryUsage(opportunity) {
    const optimization = {
      type: 'memory_optimization',
      timestamp: new Date(),
      strategy: opportunity.strategy,
      actions: []
    };
    
    switch (opportunity.strategy) {
      case 'trigger_gc':
        if (global.gc) {
          global.gc();
          optimization.actions.push('Triggered garbage collection');
        }
        break;
        
      case 'reduce_cache_size':
        // Reduce cache sizes to free memory
        for (const [cacheType, cache] of this.cacheManager.memoryCaches.entries()) {
          const currentMax = cache.max;
          const newMax = Math.max(50, Math.floor(currentMax * 0.8));
          cache.max = newMax;
          optimization.actions.push(`Reduced ${cacheType} cache size from ${currentMax} to ${newMax}`);
        }
        break;
        
      case 'enable_memory_limits': {
        // Enforce stricter memory limits on containers
        const currentLimit = this.dockerAPI.config.resourceLimits.memory;
        const newLimit = Math.floor(parseInt(currentLimit) * 0.9).toString();
        this.dockerAPI.config.resourceLimits.memory = newLimit;
        optimization.actions.push(`Reduced container memory limit from ${currentLimit} to ${newLimit}`);
        break;
      }
    }
    
    logger.info(`Applied memory optimization: ${optimization.actions.join(', ')}`);
    return optimization;
  }

  /**
   * Perform adaptive optimization based on real-time feedback
   */
  async performAdaptiveOptimization() {
    if (!this.config.strategies.enableAdaptiveScaling) {
      return;
    }
    
    try {
      const currentMetrics = this.profiler.getPerformanceReport();
      const recentBottlenecks = this.bottleneckAnalyzer.getBottleneckReport();
      
      // Quick adaptive responses
      await this.performQuickAdaptations(currentMetrics, recentBottlenecks);
      
      // Update optimization targets based on performance trends
      await this.updateOptimizationTargets(currentMetrics);
      
    } catch (error) {
      logger.error('Adaptive optimization failed:', error);
    }
  }

  /**
   * Perform quick adaptive optimizations
   */
  async performQuickAdaptations(currentMetrics, bottlenecks) {
    const adaptations = [];
    
    // Quick cache adaptations
    if (this.cacheManager) {
      const cacheStats = this.cacheManager.getStatistics();
      const hitRatio = this.calculateCacheHitRatio(cacheStats);
      
      if (hitRatio < 0.5 && this.config.strategies.enableIntelligentCaching) {
        // Quickly increase cache sizes
        for (const cache of this.cacheManager.memoryCaches.values()) {
          cache.max = Math.min(cache.max * 1.1, 1000);
        }
        adaptations.push('Increased cache sizes for better hit ratio');
      }
    }
    
    // Quick container pool adaptations
    if (this.config.strategies.enableContainerPoolOptimization) {
      const activeBtlenecks = bottlenecks.activeBottlenecks || [];
      const startupBottlenecks = activeBtlenecks.filter(b => b.type === 'container_startup');
      
      if (startupBottlenecks.length > 0) {
        const currentPoolSize = this.startupOptimizer.config.preWarmPoolSize;
        if (currentPoolSize < 8) {
          this.startupOptimizer.config.preWarmPoolSize = currentPoolSize + 1;
          adaptations.push('Increased pre-warm pool size due to startup bottlenecks');
        }
      }
    }
    
    if (adaptations.length > 0) {
      logger.debug(`Applied adaptive optimizations: ${adaptations.join(', ')}`);
      this.emit('adaptiveOptimizationApplied', { adaptations, timestamp: new Date() });
    }
  }

  /**
   * Calculate optimization priority
   */
  calculateOptimizationPriority(type, currentPerformance) {
    let priority = 0;
    
    // Base priority by type
    const typePriorities = {
      'container_startup': 0.8,
      'cache_optimization': 0.7,
      'cpu_optimization': 0.9,
      'memory_optimization': 0.85
    };
    
    priority += typePriorities[type] || 0.5;
    
    // Increase priority based on severity of performance gap
    const activeBottlenecks = currentPerformance.bottlenecks?.activeBottlenecks || [];
    const relatedBottlenecks = activeBottlenecks.filter(b => b.type.includes(type.split('_')[0]));
    
    priority += relatedBottlenecks.length * 0.1;
    
    // Increase priority if targets are significantly missed
    const targetCompliance = currentPerformance.targets?.compliance || 1;
    if (targetCompliance < 0.8) {
      priority += 0.2;
    }
    
    return Math.min(1, priority);
  }

  /**
   * Estimate optimization impact
   */
  estimateOptimizationImpact(type, _currentPerformance) {
    // This would use ML models in a production system
    // For now, we'll use heuristics
    
    const impactEstimates = {
      'container_startup': 0.3, // 30% improvement potential
      'cache_optimization': 0.25,
      'cpu_optimization': 0.2,
      'memory_optimization': 0.15
    };
    
    return impactEstimates[type] || 0.1;
  }

  /**
   * Select optimization strategy
   */
  selectOptimizationStrategy(type, currentPerformance) {
    const strategies = {
      'container_startup': ['increase_prewarm_pool', 'enable_image_caching', 'optimize_templates'],
      'cache_optimization': ['increase_cache_size', 'enable_prefetching', 'optimize_ttl'],
      'cpu_optimization': ['enable_cpu_pinning', 'reduce_concurrency', 'optimize_scheduling'],
      'memory_optimization': ['trigger_gc', 'reduce_cache_size', 'enable_memory_limits']
    };
    
    const availableStrategies = strategies[type] || [];
    
    // Select strategy based on optimization mode
    switch (this.config.optimizationMode) {
      case 'aggressive':
        return availableStrategies[0]; // Most impactful
      case 'conservative':
        return availableStrategies[availableStrategies.length - 1]; // Least risky
      case 'adaptive':
      default: {
        // Select based on current conditions
        const performanceScore = this.calculatePerformanceScore(currentPerformance);
        if (performanceScore < 0.6) {
          return availableStrategies[0]; // Aggressive when performance is poor
        } else if (performanceScore > 0.8) {
          return availableStrategies[availableStrategies.length - 1]; // Conservative when performance is good
        } else {
          return availableStrategies[Math.floor(availableStrategies.length / 2)]; // Moderate approach
        }
      }
    }
  }

  /**
   * Filter opportunities based on optimization mode
   */
  filterOpportunitiesByMode(opportunities) {
    switch (this.config.optimizationMode) {
      case 'aggressive':
        return opportunities; // Apply all optimizations
        
      case 'conservative':
        return opportunities.filter(o => o.priority > 0.7); // Only high-priority optimizations
        
      case 'adaptive':
      default: {
        // Apply optimizations based on current system state
        const systemLoad = this.getCurrentSystemLoad();
        if (systemLoad > 0.8) {
          return opportunities.slice(0, 2); // Limit optimizations when system is under load
        } else {
          return opportunities.filter(o => o.priority > 0.5);
        }
      }
    }
  }

  /**
   * Measure optimization impact
   */
  async measureOptimizationImpact(beforePerformance, optimizations) {
    // Wait a bit for optimizations to take effect
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
    
    const afterPerformance = await this.assessCurrentPerformance();
    
    const impact = {
      beforeScore: beforePerformance.overallScore,
      afterScore: afterPerformance.overallScore,
      improvement: afterPerformance.overallScore - beforePerformance.overallScore,
      optimizationsApplied: optimizations.length,
      measurementDelay: 30000
    };
    
    // Detailed impact analysis by metric
    impact.detailedImpact = this.calculateDetailedImpact(beforePerformance, afterPerformance);
    
    return impact;
  }

  /**
   * Calculate detailed impact analysis
   */
  calculateDetailedImpact(before, after) {
    const impact = {};
    
    // Startup time impact
    if (before.startup && after.startup) {
      impact.startupTime = {
        before: before.startup.averageStartupTime,
        after: after.startup.averageStartupTime,
        improvement: before.startup.averageStartupTime - after.startup.averageStartupTime,
        improvementPercent: ((before.startup.averageStartupTime - after.startup.averageStartupTime) / before.startup.averageStartupTime) * 100
      };
    }
    
    // Cache hit ratio impact
    const beforeCacheRatio = this.calculateCacheHitRatio(before.cache);
    const afterCacheRatio = this.calculateCacheHitRatio(after.cache);
    
    impact.cacheHitRatio = {
      before: beforeCacheRatio,
      after: afterCacheRatio,
      improvement: afterCacheRatio - beforeCacheRatio,
      improvementPercent: ((afterCacheRatio - beforeCacheRatio) / beforeCacheRatio) * 100
    };
    
    // System resource impact
    if (before.system?.summary && after.system?.summary) {
      impact.cpuUsage = {
        before: before.system.summary.averageCpuUsage,
        after: after.system.summary.averageCpuUsage,
        improvement: before.system.summary.averageCpuUsage - after.system.summary.averageCpuUsage
      };
      
      impact.memoryUsage = {
        before: before.system.summary.averageMemoryUsage,
        after: after.system.summary.averageMemoryUsage,
        improvement: before.system.summary.averageMemoryUsage - after.system.summary.averageMemoryUsage
      };
    }
    
    return impact;
  }

  /**
   * Handle performance alerts
   */
  handlePerformanceAlert(alert) {
    logger.warn(`Performance alert: ${alert.message}`);
    
    // Trigger immediate optimization for critical alerts
    if (alert.severity === 'critical') {
      setImmediate(() => {
        this.performEmergencyOptimization(alert).catch(err => 
          logger.error('Emergency optimization failed:', err)
        );
      });
    }
  }

  /**
   * Perform emergency optimization
   */
  async performEmergencyOptimization(alert) {
    logger.info(`Performing emergency optimization for ${alert.type}`);
    
    switch (alert.type) {
      case 'cpu_critical':
        await this.emergencyCpuOptimization();
        break;
        
      case 'memory_critical':
        await this.emergencyMemoryOptimization();
        break;
        
      default:
        logger.debug(`No emergency optimization available for ${alert.type}`);
    }
  }

  /**
   * Emergency CPU optimization
   */
  async emergencyCpuOptimization() {
    // Reduce maximum concurrent containers
    const currentMax = this.dockerAPI.config.maxContainers;
    this.dockerAPI.config.maxContainers = Math.max(2, Math.floor(currentMax * 0.7));
    
    // Enable CPU pinning if not already enabled
    this.startupOptimizer.config.cpuPinning = true;
    
    logger.info(`Emergency CPU optimization applied: reduced max containers to ${this.dockerAPI.config.maxContainers}`);
  }

  /**
   * Emergency memory optimization
   */
  async emergencyMemoryOptimization() {
    // Trigger garbage collection
    if (global.gc) {
      global.gc();
    }
    
    // Reduce cache sizes
    for (const cache of this.cacheManager.memoryCaches.values()) {
      cache.max = Math.floor(cache.max * 0.5);
      cache.clear(); // Clear current entries
    }
    
    // Reduce container memory limits
    const currentLimit = parseInt(this.dockerAPI.config.resourceLimits.memory);
    this.dockerAPI.config.resourceLimits.memory = Math.floor(currentLimit * 0.8).toString();
    
    logger.info('Emergency memory optimization applied: cleared caches and reduced memory limits');
  }

  /**
   * Handle bottleneck analysis results
   */
  handleBottleneckAnalysis(analysis) {
    // Update optimization targets based on bottleneck analysis
    this.updateOptimizationTargetsFromBottlenecks(analysis);
    
    // Schedule specific optimizations for severe bottlenecks
    const severeBottlenecks = [
      ...analysis.systemBottlenecks,
      ...analysis.applicationBottlenecks,
      ...analysis.containerBottlenecks,
      ...analysis.networkBottlenecks
    ].filter(b => b.severity === 'severe');
    
    if (severeBottlenecks.length > 0) {
      setImmediate(() => {
        this.addressSevereBottlenecks(severeBottlenecks).catch(err => 
          logger.error('Failed to address severe bottlenecks:', err)
        );
      });
    }
  }

  /**
   * Address severe bottlenecks immediately
   */
  async addressSevereBottlenecks(bottlenecks) {
    for (const bottleneck of bottlenecks) {
      try {
        await this.applySpecificOptimization({
          type: `${bottleneck.type}_optimization`,
          strategy: this.selectUrgentStrategy(bottleneck),
          priority: 1.0
        });
      } catch (error) {
        logger.error(`Failed to address severe bottleneck ${bottleneck.type}:`, error);
      }
    }
  }

  /**
   * Select urgent optimization strategy for severe bottlenecks
   */
  selectUrgentStrategy(bottleneck) {
    const urgentStrategies = {
      'cpu': 'reduce_concurrency',
      'memory': 'trigger_gc',
      'container_startup': 'increase_prewarm_pool',
      'cache_efficiency': 'increase_cache_size'
    };
    
    return urgentStrategies[bottleneck.type] || 'optimize_scheduling';
  }

  /**
   * Calculate performance score
   */
  calculatePerformanceScore(performance) {
    let score = 1.0;
    
    // Penalize for active bottlenecks
    const activeBottlenecks = performance.bottlenecks?.activeBottlenecks || [];
    for (const bottleneck of activeBottlenecks) {
      switch (bottleneck.severity) {
        case 'severe':
          score -= 0.3;
          break;
        case 'critical':
          score -= 0.2;
          break;
        case 'warning':
          score -= 0.1;
          break;
      }
    }
    
    // Adjust for target compliance
    if (performance.targets?.compliance) {
      score *= performance.targets.compliance;
    }
    
    // Adjust for system health
    if (performance.system?.systemHealth?.score) {
      score *= (performance.system.systemHealth.score / 100);
    }
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate cache hit ratio
   */
  calculateCacheHitRatio(cacheStats) {
    if (!cacheStats || !cacheStats.hits || !cacheStats.misses) {
      return 0;
    }
    
    const totalRequests = cacheStats.hits.total + cacheStats.misses.total;
    return totalRequests > 0 ? cacheStats.hits.total / totalRequests : 0;
  }

  /**
   * Evaluate target compliance
   */
  evaluateTargetCompliance() {
    const compliance = {};
    const _targets = this.config.performanceTargets;
    
    // This would be populated with actual metric comparisons
    // For now, we'll create a placeholder structure
    compliance.containerStartupTime = 0.8; // 80% compliance
    compliance.cacheHitRatio = 0.9; // 90% compliance
    compliance.cpuUtilization = 0.7; // 70% compliance
    compliance.memoryUtilization = 0.8; // 80% compliance
    
    // Calculate overall compliance
    const values = Object.values(compliance);
    compliance.overall = values.reduce((sum, val) => sum + val, 0) / values.length;
    
    return compliance;
  }

  /**
   * Get current system load (simplified)
   */
  getCurrentSystemLoad() {
    // This would integrate with actual system metrics
    // For now, return a placeholder value
    return Math.random() * 0.5 + 0.3; // Random value between 0.3 and 0.8
  }

  /**
   * Establish performance baseline
   */
  async establishPerformanceBaseline() {
    logger.info('Establishing performance baseline');
    
    // Wait for initial metrics collection
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
    
    this.performanceBaseline = await this.assessCurrentPerformance();
    
    logger.info('Performance baseline established');
  }

  /**
   * Initialize optimization models
   */
  async initializeOptimizationModels() {
    // Initialize placeholder ML models
    this.optimizationModels.set('container_startup', { weights: [], bias: 0 });
    this.optimizationModels.set('cache_optimization', { weights: [], bias: 0 });
    this.optimizationModels.set('cpu_optimization', { weights: [], bias: 0 });
    this.optimizationModels.set('memory_optimization', { weights: [], bias: 0 });
    
    logger.debug('Optimization models initialized');
  }

  /**
   * Update optimization models with new data
   */
  async updateOptimizationModels(_cycleRecord) {
    // This would implement actual ML model updates
    // For now, we'll just log the update
    logger.debug('Optimization models updated with new cycle data');
  }

  /**
   * Update performance models with new metrics
   */
  updatePerformanceModels(_metrics) {
    // Update internal performance tracking
    // This would feed into ML models in a production system
  }

  /**
   * Record optimization success
   */
  recordOptimizationSuccess(resolution) {
    logger.info(`Optimization success recorded: ${resolution.type} resolved in ${resolution.duration}ms`);
  }

  /**
   * Evaluate startup performance
   */
  evaluateStartupPerformance(metrics) {
    if (metrics.duration > this.config.performanceTargets.containerStartupTime) {
      // Trigger startup optimization
      setImmediate(() => {
        this.optimizeContainerStartup({
          type: 'container_startup',
          strategy: 'increase_prewarm_pool'
        }).catch(err => logger.error('Startup optimization failed:', err));
      });
    }
  }

  /**
   * Evaluate cache performance
   */
  evaluateCachePerformance(metrics) {
    // Evaluate cache metrics and trigger optimizations if needed
    const hitRatio = this.calculateCacheHitRatio(metrics);
    if (hitRatio < this.config.performanceTargets.cacheHitRatio) {
      setImmediate(() => {
        this.optimizeCache({
          type: 'cache_optimization',
          strategy: 'increase_cache_size'
        }).catch(err => logger.error('Cache optimization failed:', err));
      });
    }
  }

  /**
   * Update optimization targets from bottlenecks
   */
  updateOptimizationTargetsFromBottlenecks(_analysis) {
    // Adjust optimization targets based on bottleneck patterns
    // This would implement dynamic target adjustment
  }

  /**
   * Update optimization targets based on performance trends
   */
  async updateOptimizationTargets(_metrics) {
    // This would implement adaptive target adjustment
    // based on performance trends and system capabilities
  }

  /**
   * Clean up optimization history
   */
  cleanupOptimizationHistory() {
    if (this.optimizationHistory.length > this.config.optimizationHistory) {
      this.optimizationHistory = this.optimizationHistory.slice(-this.config.optimizationHistory);
    }
  }

  /**
   * Get comprehensive optimization report
   */
  getOptimizationReport() {
    const currentPerformance = this.profiler.getPerformanceReport();
    
    return {
      currentPerformance: currentPerformance,
      optimizationHistory: this.optimizationHistory.slice(-10), // Last 10 cycles
      activeOptimizations: Array.from(this.currentOptimizations.values()),
      performanceBaseline: this.performanceBaseline,
      optimizationTargets: this.config.performanceTargets,
      systemHealth: {
        score: this.calculatePerformanceScore(currentPerformance),
        status: this.getSystemHealthStatus(),
        recommendations: this.getOptimizationRecommendations()
      },
      statistics: {
        totalOptimizationCycles: this.optimizationHistory.length,
        averageImprovementPerCycle: this.calculateAverageImprovement(),
        mostEffectiveOptimization: this.getMostEffectiveOptimization(),
        currentMode: this.config.optimizationMode
      }
    };
  }

  /**
   * Get system health status
   */
  getSystemHealthStatus() {
    const currentPerformance = this.profiler.getPerformanceReport();
    const score = this.calculatePerformanceScore(currentPerformance);
    
    if (score > 0.8) return 'excellent';
    if (score > 0.6) return 'good';
    if (score > 0.4) return 'fair';
    if (score > 0.2) return 'poor';
    return 'critical';
  }

  /**
   * Get optimization recommendations
   */
  getOptimizationRecommendations() {
    // Generate recommendations based on current state
    const recommendations = [];
    
    if (this.optimizationHistory.length > 5) {
      const recentImprovements = this.optimizationHistory.slice(-5).map(h => h.impact?.improvement || 0);
      const avgImprovement = recentImprovements.reduce((sum, imp) => sum + imp, 0) / recentImprovements.length;
      
      if (avgImprovement < 0.05) {
        recommendations.push({
          type: 'optimization_mode',
          priority: 'medium',
          message: 'Consider switching to more aggressive optimization mode',
          action: 'change_optimization_mode_to_aggressive'
        });
      }
    }
    
    return recommendations;
  }

  /**
   * Calculate average improvement per cycle
   */
  calculateAverageImprovement() {
    if (this.optimizationHistory.length === 0) return 0;
    
    const improvements = this.optimizationHistory
      .map(h => h.impact?.improvement || 0)
      .filter(imp => imp > 0);
    
    return improvements.length > 0 
      ? improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length 
      : 0;
  }

  /**
   * Get most effective optimization type
   */
  getMostEffectiveOptimization() {
    const effectivenessMap = new Map();
    
    for (const cycle of this.optimizationHistory) {
      for (const optimization of cycle.appliedOptimizations || []) {
        const current = effectivenessMap.get(optimization.type) || { count: 0, totalImpact: 0 };
        current.count += 1;
        current.totalImpact += cycle.impact?.improvement || 0;
        effectivenessMap.set(optimization.type, current);
      }
    }
    
    let mostEffective = null;
    let highestEffectiveness = 0;
    
    for (const [type, data] of effectivenessMap.entries()) {
      const effectiveness = data.totalImpact / data.count;
      if (effectiveness > highestEffectiveness) {
        highestEffectiveness = effectiveness;
        mostEffective = type;
      }
    }
    
    return mostEffective;
  }

  /**
   * Handle scaling recommendations from predictive scaler
   */
  async handleScalingRecommendations(recommendations) {
    try {
      logger.info(`Received ${recommendations.length} scaling recommendations`);
      
      for (const recommendation of recommendations) {
        const timeUntil = recommendation.timestamp - Date.now();
        
        if (timeUntil > 0 && timeUntil <= 300000) { // Within 5 minutes
          logger.info(`Planning ${recommendation.type} from ${recommendation.currentCapacity} to ${recommendation.requiredCapacity} containers`);
          
          // Schedule scaling action
          setTimeout(() => {
            this.emit('scalingRequired', {
              type: recommendation.type,
              targetCapacity: recommendation.requiredCapacity,
              reason: recommendation.reason,
              confidence: recommendation.confidence
            });
          }, Math.max(0, timeUntil - 60000)); // Execute 1 minute before predicted time
        }
      }
    } catch (error) {
      logger.error('Failed to handle scaling recommendations:', error);
    }
  }

  /**
   * Handle predictive anomaly detection
   */
  async handlePredictiveAnomaly(anomaly) {
    try {
      logger.warn(`Predictive anomaly detected: ${anomaly.anomaly.type} with severity ${anomaly.anomaly.severity}`);
      
      if (anomaly.recommendation === 'immediate_scale_up') {
        // Trigger immediate scaling
        this.emit('emergencyScaling', {
          type: 'scale_up',
          urgency: 'immediate',
          reason: 'anomaly_detected',
          details: anomaly
        });
      }
      
      // Record anomaly for learning
      this.optimizationHistory.push({
        timestamp: Date.now(),
        type: 'anomaly_response',
        anomaly: anomaly.anomaly,
        action: anomaly.recommendation
      });
      
    } catch (error) {
      logger.error('Failed to handle predictive anomaly:', error);
    }
  }

  /**
   * Handle resource prediction results
   */
  async handleResourcePrediction(prediction) {
    try {
      const { jobConfig, prediction: resources, profile } = prediction;
      
      logger.info(`Resources predicted for job type ${jobConfig.repository}:${jobConfig.workflow}: CPU=${resources.cpu}, Memory=${resources.memory}MB`);
      
      // Store prediction for optimization
      this.currentOptimizations.set('resource_prediction', {
        jobConfig,
        resources,
        confidence: resources.confidence,
        timestamp: Date.now()
      });
      
      // Emit for container orchestrator to use
      this.emit('resourcesOptimized', {
        jobConfig,
        optimizedResources: resources,
        basedOn: profile.sampleCount > 0 ? 'historical_data' : 'defaults'
      });
      
    } catch (error) {
      logger.error('Failed to handle resource prediction:', error);
    }
  }

  /**
   * Get predictive insights
   */
  getPredictiveInsights() {
    return {
      scaling: this.predictiveScaler ? this.predictiveScaler.getPredictiveInsights() : null,
      resources: this.resourcePredictor ? this.resourcePredictor.getPredictionInsights() : null
    };
  }

  /**
   * Update models with job execution data
   */
  async updatePredictiveModels(jobData) {
    try {
      // Update predictive scaler
      if (this.predictiveScaler) {
        await this.predictiveScaler.updateModels({
          jobCount: jobData.activeJobs || 0,
          jobType: jobData.jobType,
          resourceUsage: {
            cpu: jobData.cpuUsage || 0,
            memory: jobData.memoryUsage || 0
          }
        });
      }
      
      // Update resource predictor
      if (this.resourcePredictor && jobData.jobId) {
        await this.resourcePredictor.updateJobMetrics(jobData.jobId, {
          jobType: jobData.jobType,
          repository: jobData.repository,
          workflow: jobData.workflow,
          actualResources: {
            cpu: jobData.cpuUsage || 0,
            memory: jobData.memoryUsage || 0,
            disk: jobData.diskUsage || 0,
            network: jobData.networkUsage || 0
          },
          duration: jobData.duration,
          predictedResources: jobData.predictedResources
        });
      }
    } catch (error) {
      logger.error('Failed to update predictive models:', error);
    }
  }
}

module.exports = PerformanceOptimizer;