/**
 * Container Reuse Optimizer
 * Advanced optimization for container reuse patterns and efficiency
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class ContainerReuseOptimizer extends EventEmitter {
  constructor(poolManager, options = {}) {
    super();
    
    this.poolManager = poolManager;
    
    this.config = {
      // Reuse strategy configuration
      strategy: {
        maxReuseCount: options.maxReuseCount || 100,
        maxContainerAge: options.maxContainerAge || 3600000, // 1 hour
        reuseEfficiencyThreshold: options.reuseEfficiencyThreshold || 0.85,
        preemptiveRecyclingThreshold: options.preemptiveRecyclingThreshold || 0.7
      },
      
      // Job pattern analysis
      patterns: {
        enablePatternAnalysis: options.enablePatternAnalysis !== false,
        patternWindowSize: options.patternWindowSize || 100,
        similarityThreshold: options.similarityThreshold || 0.8,
        jobTypeWeights: options.jobTypeWeights || {
          build: 1.0,
          test: 0.8,
          deploy: 1.2,
          scan: 0.6
        }
      },
      
      // Performance optimization
      performance: {
        enablePerformanceTracking: options.enablePerformanceTracking !== false,
        performanceWindowSize: options.performanceWindowSize || 50,
        slowExecutionThreshold: options.slowExecutionThreshold || 300000, // 5 minutes
        fastExecutionBonus: options.fastExecutionBonus || 0.1
      },
      
      // Container matching
      matching: {
        enableSmartMatching: options.enableSmartMatching !== false,
        matchingAlgorithm: options.matchingAlgorithm || 'weighted_score',
        environmentSimilarityWeight: options.environmentSimilarityWeight || 0.4,
        performanceHistoryWeight: options.performanceHistoryWeight || 0.3,
        resourceUtilizationWeight: options.resourceUtilizationWeight || 0.3
      },
      
      // Optimization intervals
      timing: {
        optimizationInterval: options.optimizationInterval || 60000, // 1 minute
        patternAnalysisInterval: options.patternAnalysisInterval || 300000, // 5 minutes
        performanceReviewInterval: options.performanceReviewInterval || 180000 // 3 minutes
      },
      
      ...options
    };
    
    // Tracking data
    this.jobHistory = new Map(); // containerId -> job history
    this.performanceHistory = new Map(); // containerId -> performance data
    this.reusePatterns = new Map(); // job signature -> preferred containers
    this.containerMetrics = new Map(); // containerId -> optimization metrics
    
    // Job pattern analysis
    this.jobPatterns = {
      knownPatterns: new Map(),
      recentJobs: [],
      patternMatches: new Map()
    };
    
    // Performance tracking
    this.performanceTracking = {
      containerPerformance: new Map(),
      averageExecutionTimes: new Map(),
      performanceDeviations: new Map()
    };
    
    // Statistics
    this.stats = {
      totalReuseOptimizations: 0,
      successfulMatches: 0,
      patternMatches: 0,
      performanceImprovements: 0,
      avgReuseEfficiency: 0,
      recyclingEvents: 0,
      lastOptimization: null
    };
    
    this.optimizationTimer = null;
    this.patternAnalysisTimer = null;
    this.performanceReviewTimer = null;
    this.isStarted = false;
  }

  /**
   * Start reuse optimizer
   */
  start() {
    if (this.isStarted) {
      logger.warn('Container reuse optimizer already started');
      return;
    }
    
    logger.info('Starting Container Reuse Optimizer');
    
    // Start optimization timers
    this.optimizationTimer = setInterval(() => {
      this.optimizeContainerReuse().catch(error => {
        logger.error('Container reuse optimization failed:', error);
      });
    }, this.config.timing.optimizationInterval);
    
    if (this.config.patterns.enablePatternAnalysis) {
      this.patternAnalysisTimer = setInterval(() => {
        this.analyzeJobPatterns().catch(error => {
          logger.error('Job pattern analysis failed:', error);
        });
      }, this.config.timing.patternAnalysisInterval);
    }
    
    if (this.config.performance.enablePerformanceTracking) {
      this.performanceReviewTimer = setInterval(() => {
        this.reviewContainerPerformance().catch(error => {
          logger.error('Performance review failed:', error);
        });
      }, this.config.timing.performanceReviewInterval);
    }
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Container reuse optimizer started');
  }

  /**
   * Stop reuse optimizer
   */
  stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Container Reuse Optimizer');
    
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
      this.optimizationTimer = null;
    }
    
    if (this.patternAnalysisTimer) {
      clearInterval(this.patternAnalysisTimer);
      this.patternAnalysisTimer = null;
    }
    
    if (this.performanceReviewTimer) {
      clearInterval(this.performanceReviewTimer);
      this.performanceReviewTimer = null;
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Container reuse optimizer stopped');
  }

  /**
   * Optimize container for job assignment
   */
  async optimizeContainerSelection(jobRequirements) {
    try {
      const startTime = Date.now();
      
      // Get available containers
      const availableContainers = Array.from(this.poolManager.availableContainers);
      
      if (availableContainers.length === 0) {
        return null;
      }
      
      // Generate job signature
      const jobSignature = this.generateJobSignature(jobRequirements);
      
      // Find optimal container
      const selectedContainer = await this.selectOptimalContainer(
        availableContainers, 
        jobRequirements, 
        jobSignature
      );
      
      // Record optimization
      this.recordOptimization(selectedContainer, jobRequirements, Date.now() - startTime);
      
      return selectedContainer;
      
    } catch (error) {
      logger.error('Container selection optimization failed:', error);
      return null;
    }
  }

  /**
   * Select optimal container for job
   */
  async selectOptimalContainer(availableContainers, jobRequirements, jobSignature) {
    const scores = new Map();
    
    for (const containerId of availableContainers) {
      const score = await this.calculateContainerScore(containerId, jobRequirements, jobSignature);
      scores.set(containerId, score);
    }
    
    // Sort by score (highest first)
    const sortedContainers = Array.from(scores.entries())
      .sort((a, b) => b[1].totalScore - a[1].totalScore);
    
    if (sortedContainers.length === 0) {
      return null;
    }
    
    const bestMatch = sortedContainers[0];
    logger.debug(`Selected container ${bestMatch[0].substring(0, 12)} with score ${bestMatch[1].totalScore.toFixed(3)}`);
    
    return bestMatch[0];
  }

  /**
   * Calculate container suitability score
   */
  async calculateContainerScore(containerId, jobRequirements, jobSignature) {
    const containerInfo = this.poolManager.containers.get(containerId);
    if (!containerInfo) {
      return { totalScore: 0 };
    }
    
    const scores = {
      patternMatch: 0,
      performance: 0,
      resourceUtilization: 0,
      recentUsage: 0,
      totalScore: 0
    };
    
    // Pattern matching score
    if (this.config.patterns.enablePatternAnalysis) {
      scores.patternMatch = this.calculatePatternMatchScore(containerId, jobSignature);
    }
    
    // Performance history score
    if (this.config.performance.enablePerformanceTracking) {
      scores.performance = this.calculatePerformanceScore(containerId, jobRequirements);
    }
    
    // Resource utilization score
    scores.resourceUtilization = this.calculateResourceUtilizationScore(containerId);
    
    // Recent usage score (prefer containers that haven't been used recently)
    scores.recentUsage = this.calculateRecentUsageScore(containerInfo);
    
    // Calculate weighted total score
    const weights = this.config.matching;
    scores.totalScore = 
      (scores.patternMatch * weights.environmentSimilarityWeight) +
      (scores.performance * weights.performanceHistoryWeight) +
      (scores.resourceUtilization * weights.resourceUtilizationWeight) +
      (scores.recentUsage * 0.1); // Small weight for recency
    
    return scores;
  }

  /**
   * Calculate pattern match score
   */
  calculatePatternMatchScore(containerId, jobSignature) {
    const jobHistory = this.jobHistory.get(containerId) || [];
    
    if (jobHistory.length === 0) {
      return 0.5; // Neutral score for new containers
    }
    
    // Calculate similarity with previous jobs
    let maxSimilarity = 0;
    let totalSimilarity = 0;
    
    for (const previousJob of jobHistory.slice(-10)) { // Check last 10 jobs
      const similarity = this.calculateJobSimilarity(jobSignature, previousJob.signature);
      maxSimilarity = Math.max(maxSimilarity, similarity);
      totalSimilarity += similarity;
    }
    
    const avgSimilarity = totalSimilarity / Math.min(jobHistory.length, 10);
    
    // Combine max and average similarity
    return (maxSimilarity * 0.7) + (avgSimilarity * 0.3);
  }

  /**
   * Calculate performance score
   */
  calculatePerformanceScore(containerId, _jobRequirements) {
    const performanceData = this.performanceTracking.containerPerformance.get(containerId);
    
    if (!performanceData) {
      return 0.5; // Neutral score for containers without performance data
    }
    
    // Calculate performance metrics
    const avgExecutionTime = performanceData.avgExecutionTime || 0;
    const successRate = performanceData.successRate || 1.0;
    const resourceEfficiency = performanceData.resourceEfficiency || 0.5;
    
    // Normalize scores (lower execution time is better)
    const executionScore = avgExecutionTime > 0 ? 
      Math.max(0, 1 - (avgExecutionTime / this.config.performance.slowExecutionThreshold)) : 0.5;
    
    // Combine metrics
    return (executionScore * 0.4) + (successRate * 0.4) + (resourceEfficiency * 0.2);
  }

  /**
   * Calculate resource utilization score
   */
  calculateResourceUtilizationScore(containerId) {
    const containerInfo = this.poolManager.containers.get(containerId);
    
    if (!containerInfo || !containerInfo.resourceUsage) {
      return 0.5;
    }
    
    const cpuUsage = containerInfo.resourceUsage.cpu || 0;
    const memoryUsage = containerInfo.resourceUsage.memory || 0;
    
    // Prefer containers with lower current resource usage
    const cpuScore = Math.max(0, 1 - (cpuUsage / 100));
    const memoryScore = Math.max(0, 1 - (memoryUsage / 100));
    
    return (cpuScore + memoryScore) / 2;
  }

  /**
   * Calculate recent usage score
   */
  calculateRecentUsageScore(containerInfo) {
    if (!containerInfo.lastUsed) {
      return 1.0; // Highest score for never-used containers
    }
    
    const timeSinceLastUse = Date.now() - containerInfo.lastUsed.getTime();
    const maxIdleTime = 300000; // 5 minutes
    
    // Score increases with time since last use
    return Math.min(1.0, timeSinceLastUse / maxIdleTime);
  }

  /**
   * Generate job signature for pattern matching
   */
  generateJobSignature(jobRequirements) {
    const signature = {
      jobType: jobRequirements.jobType || 'unknown',
      language: jobRequirements.language || 'unknown',
      framework: jobRequirements.framework || 'unknown',
      resourceRequirements: {
        cpu: jobRequirements.cpu || 'standard',
        memory: jobRequirements.memory || 'standard',
        storage: jobRequirements.storage || 'standard'
      },
      dependencies: jobRequirements.dependencies || [],
      environmentHash: this.hashEnvironmentRequirements(jobRequirements)
    };
    
    return signature;
  }

  /**
   * Calculate job similarity
   */
  calculateJobSimilarity(signature1, signature2) {
    let similarity = 0;
    let factors = 0;
    
    // Job type similarity
    if (signature1.jobType === signature2.jobType) {
      similarity += 0.3;
    }
    factors += 0.3;
    
    // Language similarity
    if (signature1.language === signature2.language) {
      similarity += 0.25;
    }
    factors += 0.25;
    
    // Framework similarity
    if (signature1.framework === signature2.framework) {
      similarity += 0.2;
    }
    factors += 0.2;
    
    // Resource requirements similarity
    const resourceSimilarity = this.calculateResourceSimilarity(
      signature1.resourceRequirements, 
      signature2.resourceRequirements
    );
    similarity += resourceSimilarity * 0.15;
    factors += 0.15;
    
    // Dependencies similarity
    const depSimilarity = this.calculateDependencySimilarity(
      signature1.dependencies, 
      signature2.dependencies
    );
    similarity += depSimilarity * 0.1;
    factors += 0.1;
    
    return factors > 0 ? similarity / factors : 0;
  }

  /**
   * Calculate resource similarity
   */
  calculateResourceSimilarity(resources1, resources2) {
    const keys = ['cpu', 'memory', 'storage'];
    let matches = 0;
    
    for (const key of keys) {
      if (resources1[key] === resources2[key]) {
        matches++;
      }
    }
    
    return matches / keys.length;
  }

  /**
   * Calculate dependency similarity
   */
  calculateDependencySimilarity(deps1, deps2) {
    if (deps1.length === 0 && deps2.length === 0) {
      return 1.0;
    }
    
    if (deps1.length === 0 || deps2.length === 0) {
      return 0;
    }
    
    const set1 = new Set(deps1);
    const set2 = new Set(deps2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * Hash environment requirements
   */
  hashEnvironmentRequirements(requirements) {
    const envString = JSON.stringify({
      env: requirements.environment || {},
      volumes: requirements.volumes || [],
      networks: requirements.networks || []
    });
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < envString.length; i++) {
      const char = envString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return hash.toString(36);
  }

  /**
   * Record job completion for optimization
   */
  recordJobCompletion(containerId, jobData, executionResult) {
    try {
      // Record job history
      if (!this.jobHistory.has(containerId)) {
        this.jobHistory.set(containerId, []);
      }
      
      const jobHistory = this.jobHistory.get(containerId);
      jobHistory.push({
        timestamp: Date.now(),
        signature: this.generateJobSignature(jobData),
        executionTime: executionResult.duration || 0,
        success: executionResult.success || false,
        resourceUsage: executionResult.resourceUsage || {}
      });
      
      // Keep history limited
      if (jobHistory.length > this.config.patterns.patternWindowSize) {
        jobHistory.shift();
      }
      
      // Update performance tracking
      this.updatePerformanceTracking(containerId, executionResult);
      
      // Update container metrics
      this.updateContainerMetrics(containerId, jobData, executionResult);
      
      // Record for pattern analysis
      this.jobPatterns.recentJobs.push({
        containerId,
        jobData,
        executionResult,
        timestamp: Date.now()
      });
      
      // Keep recent jobs limited
      if (this.jobPatterns.recentJobs.length > this.config.patterns.patternWindowSize) {
        this.jobPatterns.recentJobs.shift();
      }
      
    } catch (error) {
      logger.error('Failed to record job completion:', error);
    }
  }

  /**
   * Update performance tracking
   */
  updatePerformanceTracking(containerId, executionResult) {
    if (!this.performanceTracking.containerPerformance.has(containerId)) {
      this.performanceTracking.containerPerformance.set(containerId, {
        totalJobs: 0,
        successfulJobs: 0,
        totalExecutionTime: 0,
        avgExecutionTime: 0,
        successRate: 0,
        resourceEfficiency: 0
      });
    }
    
    const performance = this.performanceTracking.containerPerformance.get(containerId);
    
    performance.totalJobs++;
    if (executionResult.success) {
      performance.successfulJobs++;
    }
    
    if (executionResult.duration) {
      performance.totalExecutionTime += executionResult.duration;
      performance.avgExecutionTime = performance.totalExecutionTime / performance.totalJobs;
    }
    
    performance.successRate = performance.successfulJobs / performance.totalJobs;
    
    // Calculate resource efficiency (simplified)
    if (executionResult.resourceUsage) {
      const cpuEfficiency = Math.min(1, (executionResult.resourceUsage.cpu || 50) / 100);
      const memoryEfficiency = Math.min(1, (executionResult.resourceUsage.memory || 50) / 100);
      performance.resourceEfficiency = (cpuEfficiency + memoryEfficiency) / 2;
    }
  }

  /**
   * Update container metrics
   */
  updateContainerMetrics(containerId, jobData, executionResult) {
    if (!this.containerMetrics.has(containerId)) {
      this.containerMetrics.set(containerId, {
        reuseCount: 0,
        reuseEfficiency: 0,
        averageJobDuration: 0,
        lastOptimizationScore: 0
      });
    }
    
    const metrics = this.containerMetrics.get(containerId);
    metrics.reuseCount++;
    
    // Update reuse efficiency
    if (executionResult.success && executionResult.duration) {
      const efficiency = this.calculateJobEfficiency(executionResult);
      metrics.reuseEfficiency = (metrics.reuseEfficiency + efficiency) / 2;
    }
    
    // Update average job duration
    if (executionResult.duration) {
      metrics.averageJobDuration = metrics.averageJobDuration > 0 ?
        (metrics.averageJobDuration + executionResult.duration) / 2 :
        executionResult.duration;
    }
  }

  /**
   * Calculate job efficiency
   */
  calculateJobEfficiency(executionResult) {
    if (!executionResult.success) {
      return 0;
    }
    
    const duration = executionResult.duration || 0;
    const resourceUsage = executionResult.resourceUsage || {};
    
    // Efficiency based on execution time and resource usage
    const timeEfficiency = duration > 0 ? 
      Math.max(0, 1 - (duration / this.config.performance.slowExecutionThreshold)) : 0.5;
    
    const cpuEfficiency = Math.min(1, (resourceUsage.cpu || 50) / 100);
    const memoryEfficiency = Math.min(1, (resourceUsage.memory || 50) / 100);
    const resourceEfficiency = (cpuEfficiency + memoryEfficiency) / 2;
    
    return (timeEfficiency * 0.6) + (resourceEfficiency * 0.4);
  }

  /**
   * Main container reuse optimization
   */
  async optimizeContainerReuse() {
    try {
      const optimizationResults = {
        recycledContainers: 0,
        optimizedContainers: 0,
        performanceImprovements: 0
      };
      
      // Check for containers that need recycling
      const containersToRecycle = this.identifyContainersForRecycling();
      for (const containerId of containersToRecycle) {
        await this.recycleContainer(containerId);
        optimizationResults.recycledContainers++;
      }
      
      // Optimize existing containers
      const containersToOptimize = this.identifyContainersForOptimization();
      for (const containerId of containersToOptimize) {
        await this.optimizeContainer(containerId);
        optimizationResults.optimizedContainers++;
      }
      
      // Update statistics
      this.stats.totalReuseOptimizations++;
      this.stats.recyclingEvents += optimizationResults.recycledContainers;
      this.stats.lastOptimization = new Date();
      
      if (optimizationResults.recycledContainers > 0 || optimizationResults.optimizedContainers > 0) {
        logger.info(`Reuse optimization completed: ${optimizationResults.recycledContainers} recycled, ${optimizationResults.optimizedContainers} optimized`);
      }
      
      this.emit('optimizationCompleted', optimizationResults);
      
    } catch (error) {
      logger.error('Container reuse optimization failed:', error);
    }
  }

  /**
   * Identify containers for recycling
   */
  identifyContainersForRecycling() {
    const containersToRecycle = [];
    
    for (const [containerId, metrics] of this.containerMetrics) {
      const containerInfo = this.poolManager.containers.get(containerId);
      
      if (!containerInfo) {
        continue;
      }
      
      // Check reuse count
      if (metrics.reuseCount >= this.config.strategy.maxReuseCount) {
        containersToRecycle.push(containerId);
        continue;
      }
      
      // Check age
      const age = Date.now() - containerInfo.createdAt.getTime();
      if (age >= this.config.strategy.maxContainerAge) {
        containersToRecycle.push(containerId);
        continue;
      }
      
      // Check efficiency
      if (metrics.reuseEfficiency < this.config.strategy.preemptiveRecyclingThreshold && 
          metrics.reuseCount > 10) {
        containersToRecycle.push(containerId);
        continue;
      }
    }
    
    return containersToRecycle;
  }

  /**
   * Identify containers for optimization
   */
  identifyContainersForOptimization() {
    const containersToOptimize = [];
    
    for (const [containerId, metrics] of this.containerMetrics) {
      if (metrics.reuseEfficiency < this.config.strategy.reuseEfficiencyThreshold &&
          metrics.reuseCount >= 5) {
        containersToOptimize.push(containerId);
      }
    }
    
    return containersToOptimize;
  }

  /**
   * Recycle container
   */
  async recycleContainer(containerId) {
    try {
      // Only recycle if container is available
      if (this.poolManager.availableContainers.has(containerId)) {
        await this.poolManager.recycleContainer(containerId);
        
        // Clean up tracking data
        this.jobHistory.delete(containerId);
        this.performanceTracking.containerPerformance.delete(containerId);
        this.containerMetrics.delete(containerId);
        
        logger.debug(`Recycled container for reuse optimization: ${containerId.substring(0, 12)}`);
      }
    } catch (error) {
      logger.error(`Failed to recycle container ${containerId}:`, error);
    }
  }

  /**
   * Optimize container
   */
  async optimizeContainer(containerId) {
    try {
      // Placeholder for container optimization logic
      // This could include container warming, cache optimization, etc.
      logger.debug(`Optimized container: ${containerId.substring(0, 12)}`);
    } catch (error) {
      logger.error(`Failed to optimize container ${containerId}:`, error);
    }
  }

  /**
   * Analyze job patterns
   */
  async analyzeJobPatterns() {
    if (this.jobPatterns.recentJobs.length < this.config.patterns.minimumDataPoints) {
      return;
    }
    
    try {
      // Analyze common job patterns
      const patterns = this.extractJobPatterns();
      
      // Update known patterns
      for (const [signature, containers] of patterns) {
        this.jobPatterns.knownPatterns.set(signature, containers);
      }
      
      // Update pattern match statistics
      this.updatePatternMatchStats();
      
      logger.debug(`Analyzed ${patterns.size} job patterns from ${this.jobPatterns.recentJobs.length} recent jobs`);
      
    } catch (error) {
      logger.error('Job pattern analysis failed:', error);
    }
  }

  /**
   * Extract job patterns from recent jobs
   */
  extractJobPatterns() {
    const patterns = new Map();
    
    for (const job of this.jobPatterns.recentJobs) {
      const signature = this.generateJobSignature(job.jobData);
      const signatureKey = JSON.stringify(signature);
      
      if (!patterns.has(signatureKey)) {
        patterns.set(signatureKey, {
          signature,
          containers: new Map(),
          totalJobs: 0
        });
      }
      
      const pattern = patterns.get(signatureKey);
      pattern.totalJobs++;
      
      if (!pattern.containers.has(job.containerId)) {
        pattern.containers.set(job.containerId, {
          count: 0,
          avgDuration: 0,
          successRate: 0
        });
      }
      
      const containerData = pattern.containers.get(job.containerId);
      containerData.count++;
      
      if (job.executionResult.duration) {
        containerData.avgDuration = containerData.avgDuration > 0 ?
          (containerData.avgDuration + job.executionResult.duration) / 2 :
          job.executionResult.duration;
      }
      
      containerData.successRate = job.executionResult.success ?
        (containerData.successRate + 1) / 2 : containerData.successRate / 2;
    }
    
    return patterns;
  }

  /**
   * Update pattern match statistics
   */
  updatePatternMatchStats() {
    // Calculate pattern matching accuracy
    let totalMatches = 0;
    let successfulMatches = 0;
    
    for (const pattern of this.jobPatterns.knownPatterns.values()) {
      for (const containerData of pattern.containers.values()) {
        totalMatches += containerData.count;
        successfulMatches += containerData.count * containerData.successRate;
      }
    }
    
    if (totalMatches > 0) {
      this.stats.patternMatches = totalMatches;
      this.stats.successfulMatches = successfulMatches;
    }
  }

  /**
   * Review container performance
   */
  async reviewContainerPerformance() {
    try {
      let totalPerformanceScore = 0;
      let containerCount = 0;
      
      for (const [containerId, performance] of this.performanceTracking.containerPerformance) {
        // Calculate overall performance score
        const performanceScore = (performance.successRate * 0.5) + 
                               (performance.resourceEfficiency * 0.3) +
                               (this.calculateSpeedScore(performance.avgExecutionTime) * 0.2);
        
        totalPerformanceScore += performanceScore;
        containerCount++;
        
        // Update container metrics
        const metrics = this.containerMetrics.get(containerId);
        if (metrics) {
          metrics.lastOptimizationScore = performanceScore;
        }
      }
      
      // Update average reuse efficiency
      if (containerCount > 0) {
        this.stats.avgReuseEfficiency = totalPerformanceScore / containerCount;
      }
      
    } catch (error) {
      logger.error('Container performance review failed:', error);
    }
  }

  /**
   * Calculate speed score
   */
  calculateSpeedScore(avgExecutionTime) {
    if (avgExecutionTime <= 0) {
      return 0.5;
    }
    
    return Math.max(0, 1 - (avgExecutionTime / this.config.performance.slowExecutionThreshold));
  }

  /**
   * Record optimization event
   */
  recordOptimization(containerId, jobRequirements, optimizationTime) {
    this.stats.totalReuseOptimizations++;
    
    // Update average optimization time
    const currentAvg = this.stats.avgOptimizationTime || 0;
    const count = this.stats.totalReuseOptimizations;
    this.stats.avgOptimizationTime = count > 1 ?
      ((currentAvg * (count - 1)) + optimizationTime) / count :
      optimizationTime;
  }

  /**
   * Get reuse optimization statistics
   */
  getReuseStats() {
    return {
      isStarted: this.isStarted,
      stats: this.stats,
      containerMetrics: this.containerMetrics.size,
      knownPatterns: this.jobPatterns.knownPatterns.size,
      recentJobs: this.jobPatterns.recentJobs.length,
      performanceTracking: this.performanceTracking.containerPerformance.size,
      config: {
        maxReuseCount: this.config.strategy.maxReuseCount,
        reuseEfficiencyThreshold: this.config.strategy.reuseEfficiencyThreshold,
        patternAnalysis: this.config.patterns.enablePatternAnalysis,
        performanceTracking: this.config.performance.enablePerformanceTracking
      }
    };
  }

  /**
   * Get container efficiency report
   */
  getContainerEfficiencyReport() {
    const report = {
      totalContainers: this.containerMetrics.size,
      highEfficiencyContainers: 0,
      lowEfficiencyContainers: 0,
      avgReuseCount: 0,
      avgReuseEfficiency: 0,
      containers: []
    };
    
    let totalReuseCount = 0;
    let totalEfficiency = 0;
    
    for (const [containerId, metrics] of this.containerMetrics) {
      totalReuseCount += metrics.reuseCount;
      totalEfficiency += metrics.reuseEfficiency;
      
      if (metrics.reuseEfficiency >= this.config.strategy.reuseEfficiencyThreshold) {
        report.highEfficiencyContainers++;
      } else {
        report.lowEfficiencyContainers++;
      }
      
      report.containers.push({
        id: containerId.substring(0, 12),
        reuseCount: metrics.reuseCount,
        reuseEfficiency: metrics.reuseEfficiency,
        averageJobDuration: metrics.averageJobDuration,
        lastOptimizationScore: metrics.lastOptimizationScore
      });
    }
    
    if (this.containerMetrics.size > 0) {
      report.avgReuseCount = totalReuseCount / this.containerMetrics.size;
      report.avgReuseEfficiency = totalEfficiency / this.containerMetrics.size;
    }
    
    // Sort containers by efficiency
    report.containers.sort((a, b) => b.reuseEfficiency - a.reuseEfficiency);
    
    return report;
  }
}

module.exports = ContainerReuseOptimizer;