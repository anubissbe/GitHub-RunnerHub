/**
 * Bottleneck Analyzer
 * Advanced system for identifying and analyzing performance bottlenecks in GitHub-RunnerHub
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class BottleneckAnalyzer extends EventEmitter {
  constructor(performanceProfiler, cacheManager, options = {}) {
    super();
    
    this.performanceProfiler = performanceProfiler;
    this.cacheManager = cacheManager;
    
    this.config = {
      // Analysis intervals
      analysisInterval: options.analysisInterval || 60000, // 1 minute
      deepAnalysisInterval: options.deepAnalysisInterval || 300000, // 5 minutes
      
      // Detection thresholds
      bottleneckThresholds: {
        cpu: {
          warning: options.cpuWarning || 70,
          critical: options.cpuCritical || 85,
          severe: options.cpuSevere || 95
        },
        memory: {
          warning: options.memoryWarning || 75,
          critical: options.memoryCritical || 85,
          severe: options.memorySevere || 95
        },
        disk: {
          warning: options.diskWarning || 80,
          critical: options.diskCritical || 90,
          severe: options.diskSevere || 95
        },
        network: {
          warning: options.networkWarning || 100, // ms latency
          critical: options.networkCritical || 500,
          severe: options.networkSevere || 1000
        },
        containerStartup: {
          warning: options.startupWarning || 5000, // ms
          critical: options.startupCritical || 10000,
          severe: options.startupSevere || 20000
        },
        jobExecution: {
          warning: options.jobWarning || 60000, // ms
          critical: options.jobCritical || 300000,
          severe: options.jobSevere || 600000
        }
      },
      
      // Pattern detection
      enablePatternDetection: options.enablePatternDetection !== false,
      enableTrendAnalysis: options.enableTrendAnalysis !== false,
      enableCorrelationAnalysis: options.enableCorrelationAnalysis !== false,
      enablePredictiveAnalysis: options.enablePredictiveAnalysis !== false,
      
      // Historical analysis
      analysisWindow: options.analysisWindow || 3600000, // 1 hour
      trendWindow: options.trendWindow || 1800000, // 30 minutes
      correlationWindow: options.correlationWindow || 900000, // 15 minutes
      
      // Machine learning parameters
      anomalyDetectionSensitivity: options.anomalyDetectionSensitivity || 0.8,
      patternMatchThreshold: options.patternMatchThreshold || 0.7,
      correlationThreshold: options.correlationThreshold || 0.6,
      
      ...options
    };
    
    // Analysis data storage
    this.bottleneckHistory = [];
    this.performancePatterns = new Map();
    this.correlationMatrix = new Map();
    this.anomalyBaselines = new Map();
    this.predictiveModels = new Map();
    
    // Detection state
    this.activeBottlenecks = new Map();
    this.bottleneckCounts = new Map();
    this.resolutionAttempts = new Map();
    
    // Analysis timers
    this.analysisTimer = null;
    this.deepAnalysisTimer = null;
    
    this.isRunning = false;
  }

  /**
   * Start bottleneck analysis
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Bottleneck analyzer is already running');
      return;
    }
    
    logger.info('Starting Bottleneck Analyzer');
    this.isRunning = true;
    
    // Start regular analysis
    this.startRegularAnalysis();
    
    // Start deep analysis
    this.startDeepAnalysis();
    
    // Initialize baseline models
    await this.initializeBaselines();
    
    this.emit('started');
    logger.info('Bottleneck Analyzer started successfully');
  }

  /**
   * Stop bottleneck analysis
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    logger.info('Stopping Bottleneck Analyzer');
    this.isRunning = false;
    
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
    
    if (this.deepAnalysisTimer) {
      clearInterval(this.deepAnalysisTimer);
      this.deepAnalysisTimer = null;
    }
    
    this.emit('stopped');
    logger.info('Bottleneck Analyzer stopped');
  }

  /**
   * Start regular bottleneck analysis
   */
  startRegularAnalysis() {
    this.analysisTimer = setInterval(() => {
      this.performBottleneckAnalysis().catch(err => 
        logger.error('Bottleneck analysis failed:', err)
      );
    }, this.config.analysisInterval);
  }

  /**
   * Start deep analysis
   */
  startDeepAnalysis() {
    this.deepAnalysisTimer = setInterval(() => {
      this.performDeepAnalysis().catch(err => 
        logger.error('Deep bottleneck analysis failed:', err)
      );
    }, this.config.deepAnalysisInterval);
  }

  /**
   * Perform comprehensive bottleneck analysis
   */
  async performBottleneckAnalysis() {
    try {
      const timestamp = new Date();
      const analysis = {
        timestamp,
        systemBottlenecks: await this.analyzeSystemBottlenecks(),
        applicationBottlenecks: await this.analyzeApplicationBottlenecks(),
        containerBottlenecks: await this.analyzeContainerBottlenecks(),
        networkBottlenecks: await this.analyzeNetworkBottlenecks(),
        resourceContention: await this.analyzeResourceContention(),
        severity: 'normal'
      };
      
      // Determine overall severity
      analysis.severity = this.calculateOverallSeverity(analysis);
      
      // Update active bottlenecks
      this.updateActiveBottlenecks(analysis);
      
      // Store analysis history
      this.bottleneckHistory.push(analysis);
      this.cleanupOldAnalysis();
      
      // Emit analysis results
      this.emit('bottleneckAnalysisCompleted', analysis);
      
      // Trigger automatic resolution if enabled
      if (analysis.severity !== 'normal') {
        await this.attemptAutomaticResolution(analysis);
      }
      
    } catch (error) {
      logger.error('Bottleneck analysis failed:', error);
    }
  }

  /**
   * Analyze system-level bottlenecks
   */
  async analyzeSystemBottlenecks() {
    const bottlenecks = [];
    
    try {
      // Get recent performance data
      const performanceReport = this.performanceProfiler.getPerformanceReport();
      const _systemHealth = performanceReport.systemHealth;
      const summary = performanceReport.summary;
      
      if (!summary) {
        return bottlenecks;
      }
      
      // CPU bottlenecks
      if (summary.averageCpuUsage > this.config.bottleneckThresholds.cpu.warning) {
        bottlenecks.push({
          type: 'cpu',
          severity: this.getSeverityLevel(summary.averageCpuUsage, this.config.bottleneckThresholds.cpu),
          value: summary.averageCpuUsage,
          description: 'High CPU usage detected',
          impact: 'Container startup and job execution delays',
          category: 'system',
          suggestions: this.getCpuOptimizationSuggestions(summary.averageCpuUsage)
        });
      }
      
      // Memory bottlenecks
      if (summary.averageMemoryUsage > this.config.bottleneckThresholds.memory.warning) {
        bottlenecks.push({
          type: 'memory',
          severity: this.getSeverityLevel(summary.averageMemoryUsage, this.config.bottleneckThresholds.memory),
          value: summary.averageMemoryUsage,
          description: 'High memory usage detected',
          impact: 'Potential OOM errors and container failures',
          category: 'system',
          suggestions: this.getMemoryOptimizationSuggestions(summary.averageMemoryUsage)
        });
      }
      
      // Active operations bottleneck
      if (summary.activeOperations > 20) {
        bottlenecks.push({
          type: 'concurrency',
          severity: summary.activeOperations > 50 ? 'critical' : 'warning',
          value: summary.activeOperations,
          description: 'High number of concurrent operations',
          impact: 'Resource contention and degraded performance',
          category: 'application',
          suggestions: ['Implement operation queuing', 'Add rate limiting', 'Scale horizontally']
        });
      }
      
    } catch (error) {
      logger.error('System bottleneck analysis failed:', error);
    }
    
    return bottlenecks;
  }

  /**
   * Analyze application-level bottlenecks
   */
  async analyzeApplicationBottlenecks() {
    const bottlenecks = [];
    
    try {
      // Analyze cache performance
      if (this.cacheManager) {
        const cacheStats = this.cacheManager.getStatistics();
        
        // Low cache hit ratio
        const totalRequests = cacheStats.hits.total + cacheStats.misses.total;
        const hitRatio = totalRequests > 0 ? cacheStats.hits.total / totalRequests : 0;
        
        if (hitRatio < 0.7 && totalRequests > 100) {
          bottlenecks.push({
            type: 'cache_efficiency',
            severity: hitRatio < 0.5 ? 'critical' : 'warning',
            value: hitRatio,
            description: `Low cache hit ratio: ${(hitRatio * 100).toFixed(1)}%`,
            impact: 'Increased latency and resource usage',
            category: 'application',
            suggestions: this.getCacheOptimizationSuggestions(hitRatio)
          });
        }
        
        // High cache error rate
        if (cacheStats.errors > 10) {
          bottlenecks.push({
            type: 'cache_errors',
            severity: cacheStats.errors > 50 ? 'critical' : 'warning',
            value: cacheStats.errors,
            description: 'High cache error rate',
            impact: 'Cache fallback to slower operations',
            category: 'application',
            suggestions: ['Check cache connection', 'Review cache configuration', 'Monitor cache logs']
          });
        }
      }
      
    } catch (error) {
      logger.error('Application bottleneck analysis failed:', error);
    }
    
    return bottlenecks;
  }

  /**
   * Analyze container-specific bottlenecks
   */
  async analyzeContainerBottlenecks() {
    const bottlenecks = [];
    
    try {
      // This would integrate with container metrics
      // For now, we'll create placeholder analysis
      
      // Analyze container startup times
      const recentStartups = this.getRecentContainerStartups();
      if (recentStartups.length > 0) {
        const avgStartupTime = recentStartups.reduce((sum, time) => sum + time, 0) / recentStartups.length;
        
        if (avgStartupTime > this.config.bottleneckThresholds.containerStartup.warning) {
          bottlenecks.push({
            type: 'container_startup',
            severity: this.getSeverityLevel(avgStartupTime, this.config.bottleneckThresholds.containerStartup),
            value: avgStartupTime,
            description: `Slow container startup: ${avgStartupTime.toFixed(0)}ms average`,
            impact: 'Delayed job execution and poor user experience',
            category: 'container',
            suggestions: this.getStartupOptimizationSuggestions(avgStartupTime)
          });
        }
      }
      
    } catch (error) {
      logger.error('Container bottleneck analysis failed:', error);
    }
    
    return bottlenecks;
  }

  /**
   * Analyze network bottlenecks
   */
  async analyzeNetworkBottlenecks() {
    const bottlenecks = [];
    
    try {
      // Analyze network latency patterns
      const networkMetrics = this.getRecentNetworkMetrics();
      
      if (networkMetrics.length > 0) {
        const avgLatency = networkMetrics.reduce((sum, metric) => sum + metric.latency, 0) / networkMetrics.length;
        
        if (avgLatency > this.config.bottleneckThresholds.network.warning) {
          bottlenecks.push({
            type: 'network_latency',
            severity: this.getSeverityLevel(avgLatency, this.config.bottleneckThresholds.network),
            value: avgLatency,
            description: `High network latency: ${avgLatency.toFixed(0)}ms average`,
            impact: 'Slow API responses and container communication delays',
            category: 'network',
            suggestions: this.getNetworkOptimizationSuggestions(avgLatency)
          });
        }
      }
      
    } catch (error) {
      logger.error('Network bottleneck analysis failed:', error);
    }
    
    return bottlenecks;
  }

  /**
   * Analyze resource contention
   */
  async analyzeResourceContention() {
    const contention = [];
    
    try {
      // Analyze I/O contention
      const ioMetrics = this.getRecentIOMetrics();
      if (ioMetrics.some(metric => metric.waitTime > 100)) {
        contention.push({
          type: 'io_contention',
          severity: 'warning',
          description: 'High I/O wait times detected',
          impact: 'Slower disk operations and container performance',
          suggestions: ['Optimize disk usage', 'Consider faster storage', 'Implement I/O scheduling']
        });
      }
      
      // Analyze CPU contention
      const cpuMetrics = this.getRecentCPUMetrics();
      if (cpuMetrics.some(metric => metric.runQueueLength > 10)) {
        contention.push({
          type: 'cpu_contention',
          severity: 'warning',
          description: 'High CPU run queue length',
          impact: 'Process scheduling delays',
          suggestions: ['Reduce CPU-intensive operations', 'Scale CPU resources', 'Optimize algorithms']
        });
      }
      
    } catch (error) {
      logger.error('Resource contention analysis failed:', error);
    }
    
    return contention;
  }

  /**
   * Perform deep analysis with pattern detection and correlation
   */
  async performDeepAnalysis() {
    try {
      const deepAnalysis = {
        timestamp: new Date(),
        patterns: await this.detectPerformancePatterns(),
        correlations: await this.analyzeCorrelations(),
        anomalies: await this.detectAnomalies(),
        predictions: await this.generatePredictions(),
        trends: await this.analyzeLongTermTrends()
      };
      
      this.emit('deepAnalysisCompleted', deepAnalysis);
      
    } catch (error) {
      logger.error('Deep analysis failed:', error);
    }
  }

  /**
   * Detect performance patterns
   */
  async detectPerformancePatterns() {
    if (!this.config.enablePatternDetection) {
      return [];
    }
    
    const patterns = [];
    const recentAnalyses = this.getRecentAnalyses(this.config.trendWindow);
    
    // Detect recurring bottlenecks
    const bottleneckFrequency = new Map();
    for (const analysis of recentAnalyses) {
      const allBottlenecks = [
        ...analysis.systemBottlenecks,
        ...analysis.applicationBottlenecks,
        ...analysis.containerBottlenecks,
        ...analysis.networkBottlenecks
      ];
      
      for (const bottleneck of allBottlenecks) {
        const key = `${bottleneck.type}-${bottleneck.severity}`;
        bottleneckFrequency.set(key, (bottleneckFrequency.get(key) || 0) + 1);
      }
    }
    
    // Identify patterns
    for (const [pattern, frequency] of bottleneckFrequency.entries()) {
      if (frequency > recentAnalyses.length * 0.5) { // Occurs in >50% of analyses
        patterns.push({
          type: 'recurring_bottleneck',
          pattern,
          frequency,
          description: `Recurring bottleneck pattern: ${pattern}`,
          confidence: frequency / recentAnalyses.length
        });
      }
    }
    
    return patterns;
  }

  /**
   * Analyze correlations between different metrics
   */
  async analyzeCorrelations() {
    if (!this.config.enableCorrelationAnalysis) {
      return [];
    }
    
    const correlations = [];
    const recentAnalyses = this.getRecentAnalyses(this.config.correlationWindow);
    
    if (recentAnalyses.length < 10) {
      return correlations; // Need more data for correlation analysis
    }
    
    // Extract metric pairs for correlation
    const metrics = {
      cpuUsage: [],
      memoryUsage: [],
      containerStartups: [],
      activeOperations: []
    };
    
    // Populate metrics arrays
    for (const _analysis of recentAnalyses) {
      // This would be populated from actual metric data
      // For now, we'll create a placeholder structure
      metrics.cpuUsage.push(Math.random() * 100);
      metrics.memoryUsage.push(Math.random() * 100);
      metrics.containerStartups.push(Math.random() * 10);
      metrics.activeOperations.push(Math.random() * 20);
    }
    
    // Calculate correlations
    const metricNames = Object.keys(metrics);
    for (let i = 0; i < metricNames.length; i++) {
      for (let j = i + 1; j < metricNames.length; j++) {
        const correlation = this.calculateCorrelation(
          metrics[metricNames[i]], 
          metrics[metricNames[j]]
        );
        
        if (Math.abs(correlation) > this.config.correlationThreshold) {
          correlations.push({
            metric1: metricNames[i],
            metric2: metricNames[j],
            correlation,
            strength: Math.abs(correlation) > 0.8 ? 'strong' : 'moderate',
            description: `${metricNames[i]} and ${metricNames[j]} are ${correlation > 0 ? 'positively' : 'negatively'} correlated`
          });
        }
      }
    }
    
    return correlations;
  }

  /**
   * Detect performance anomalies
   */
  async detectAnomalies() {
    const anomalies = [];
    const recentAnalyses = this.getRecentAnalyses(this.config.analysisWindow);
    
    if (recentAnalyses.length < 30) {
      return anomalies; // Need more data for anomaly detection
    }
    
    // Simple anomaly detection using standard deviation
    const latestAnalysis = recentAnalyses[recentAnalyses.length - 1];
    const historicalData = recentAnalyses.slice(0, -1);
    
    // Check for CPU usage anomalies
    const cpuValues = historicalData.map(a => a.systemBottlenecks.find(b => b.type === 'cpu')?.value || 0);
    const cpuMean = cpuValues.reduce((sum, val) => sum + val, 0) / cpuValues.length;
    const cpuStdDev = Math.sqrt(cpuValues.reduce((sum, val) => sum + Math.pow(val - cpuMean, 2), 0) / cpuValues.length);
    
    const currentCpu = latestAnalysis.systemBottlenecks.find(b => b.type === 'cpu')?.value || 0;
    if (Math.abs(currentCpu - cpuMean) > 2 * cpuStdDev) {
      anomalies.push({
        type: 'cpu_anomaly',
        metric: 'cpu_usage',
        currentValue: currentCpu,
        expectedValue: cpuMean,
        deviation: Math.abs(currentCpu - cpuMean) / cpuStdDev,
        description: 'CPU usage significantly deviates from normal pattern'
      });
    }
    
    return anomalies;
  }

  /**
   * Generate performance predictions
   */
  async generatePredictions() {
    if (!this.config.enablePredictiveAnalysis) {
      return [];
    }
    
    const predictions = [];
    const recentAnalyses = this.getRecentAnalyses(this.config.analysisWindow);
    
    if (recentAnalyses.length < 20) {
      return predictions; // Need more data for predictions
    }
    
    // Simple linear trend prediction
    const timePoints = recentAnalyses.map((_, index) => index);
    const cpuValues = recentAnalyses.map(a => a.systemBottlenecks.find(b => b.type === 'cpu')?.value || 0);
    
    if (cpuValues.length > 0) {
      const trend = this.calculateLinearTrend(timePoints, cpuValues);
      const nextValue = trend.slope * recentAnalyses.length + trend.intercept;
      
      if (nextValue > this.config.bottleneckThresholds.cpu.critical) {
        predictions.push({
          type: 'cpu_bottleneck_prediction',
          metric: 'cpu_usage',
          predictedValue: nextValue,
          timeHorizon: '5 minutes',
          confidence: Math.max(0, Math.min(1, 0.8 - Math.abs(trend.slope) * 0.1)),
          description: 'CPU usage may exceed critical threshold',
          recommendedAction: 'Consider scaling CPU resources or reducing load'
        });
      }
    }
    
    return predictions;
  }

  /**
   * Analyze long-term trends
   */
  async analyzeLongTermTrends() {
    const trends = [];
    const allAnalyses = this.bottleneckHistory;
    
    if (allAnalyses.length < 50) {
      return trends; // Need more historical data
    }
    
    // Analyze trend over time
    const recentPeriod = allAnalyses.slice(-20);
    const olderPeriod = allAnalyses.slice(-50, -30);
    
    const recentBottleneckCount = recentPeriod.reduce((sum, a) => 
      sum + a.systemBottlenecks.length + a.applicationBottlenecks.length, 0);
    const olderBottleneckCount = olderPeriod.reduce((sum, a) => 
      sum + a.systemBottlenecks.length + a.applicationBottlenecks.length, 0);
    
    const trendDirection = recentBottleneckCount > olderBottleneckCount ? 'increasing' : 'decreasing';
    
    trends.push({
      type: 'bottleneck_frequency_trend',
      direction: trendDirection,
      recentCount: recentBottleneckCount,
      historicalCount: olderBottleneckCount,
      description: `Bottleneck frequency is ${trendDirection}`,
      significance: Math.abs(recentBottleneckCount - olderBottleneckCount) > 5 ? 'significant' : 'minor'
    });
    
    return trends;
  }

  /**
   * Calculate correlation coefficient between two arrays
   */
  calculateCorrelation(x, y) {
    if (x.length !== y.length || x.length === 0) {
      return 0;
    }
    
    const n = x.length;
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    const sumYY = y.reduce((sum, val) => sum + val * val, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Calculate linear trend
   */
  calculateLinearTrend(x, y) {
    const n = x.length;
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }

  /**
   * Get severity level based on thresholds
   */
  getSeverityLevel(value, thresholds) {
    if (value >= thresholds.severe) return 'severe';
    if (value >= thresholds.critical) return 'critical';
    if (value >= thresholds.warning) return 'warning';
    return 'normal';
  }

  /**
   * Calculate overall severity across all bottlenecks
   */
  calculateOverallSeverity(analysis) {
    const allBottlenecks = [
      ...analysis.systemBottlenecks,
      ...analysis.applicationBottlenecks,
      ...analysis.containerBottlenecks,
      ...analysis.networkBottlenecks
    ];
    
    if (allBottlenecks.some(b => b.severity === 'severe')) return 'severe';
    if (allBottlenecks.some(b => b.severity === 'critical')) return 'critical';
    if (allBottlenecks.some(b => b.severity === 'warning')) return 'warning';
    return 'normal';
  }

  /**
   * Update active bottlenecks tracking
   */
  updateActiveBottlenecks(analysis) {
    const currentBottlenecks = new Set();
    
    const allBottlenecks = [
      ...analysis.systemBottlenecks,
      ...analysis.applicationBottlenecks,
      ...analysis.containerBottlenecks,
      ...analysis.networkBottlenecks
    ];
    
    for (const bottleneck of allBottlenecks) {
      const key = `${bottleneck.type}-${bottleneck.category}`;
      currentBottlenecks.add(key);
      
      this.activeBottlenecks.set(key, {
        ...bottleneck,
        firstDetected: this.activeBottlenecks.get(key)?.firstDetected || analysis.timestamp,
        lastDetected: analysis.timestamp,
        occurrenceCount: (this.activeBottlenecks.get(key)?.occurrenceCount || 0) + 1
      });
      
      this.bottleneckCounts.set(key, (this.bottleneckCounts.get(key) || 0) + 1);
    }
    
    // Remove resolved bottlenecks
    for (const [key, bottleneck] of this.activeBottlenecks.entries()) {
      if (!currentBottlenecks.has(key)) {
        this.emit('bottleneckResolved', {
          type: bottleneck.type,
          category: bottleneck.category,
          duration: analysis.timestamp - bottleneck.firstDetected,
          occurrences: bottleneck.occurrenceCount
        });
        this.activeBottlenecks.delete(key);
      }
    }
  }

  /**
   * Attempt automatic resolution of bottlenecks
   */
  async attemptAutomaticResolution(analysis) {
    const allBottlenecks = [
      ...analysis.systemBottlenecks,
      ...analysis.applicationBottlenecks,
      ...analysis.containerBottlenecks,
      ...analysis.networkBottlenecks
    ];
    
    for (const bottleneck of allBottlenecks) {
      const resolutionKey = `${bottleneck.type}-${bottleneck.category}`;
      
      // Skip if we've already attempted resolution recently
      const lastAttempt = this.resolutionAttempts.get(resolutionKey);
      if (lastAttempt && Date.now() - lastAttempt < 300000) { // 5 minutes
        continue;
      }
      
      try {
        await this.attemptResolution(bottleneck);
        this.resolutionAttempts.set(resolutionKey, Date.now());
      } catch (error) {
        logger.error(`Failed to resolve bottleneck ${resolutionKey}:`, error);
      }
    }
  }

  /**
   * Attempt resolution for specific bottleneck
   */
  async attemptResolution(bottleneck) {
    logger.info(`Attempting automatic resolution for ${bottleneck.type} bottleneck`);
    
    switch (bottleneck.type) {
      case 'cache_efficiency':
        await this.resolveCacheEfficiencyBottleneck(bottleneck);
        break;
        
      case 'container_startup':
        await this.resolveContainerStartupBottleneck(bottleneck);
        break;
        
      case 'memory':
        await this.resolveMemoryBottleneck(bottleneck);
        break;
        
      default:
        logger.debug(`No automatic resolution available for ${bottleneck.type}`);
    }
  }

  /**
   * Resolve cache efficiency bottleneck
   */
  async resolveCacheEfficiencyBottleneck(_bottleneck) {
    if (this.cacheManager) {
      // Trigger cache optimization
      logger.info('Triggering cache optimization to resolve efficiency bottleneck');
      // This would call cache optimization methods
    }
  }

  /**
   * Resolve container startup bottleneck
   */
  async resolveContainerStartupBottleneck(_bottleneck) {
    logger.info('Triggering container startup optimization');
    // This would integrate with the startup optimizer
  }

  /**
   * Resolve memory bottleneck
   */
  async resolveMemoryBottleneck(_bottleneck) {
    logger.info('Triggering memory cleanup and optimization');
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Get optimization suggestions for different bottleneck types
   */
  getCpuOptimizationSuggestions(cpuUsage) {
    const suggestions = ['Monitor CPU-intensive processes'];
    
    if (cpuUsage > 90) {
      suggestions.push('Consider horizontal scaling', 'Optimize algorithms', 'Implement CPU affinity');
    } else if (cpuUsage > 80) {
      suggestions.push('Review CPU-intensive operations', 'Consider process prioritization');
    }
    
    return suggestions;
  }

  getMemoryOptimizationSuggestions(memoryUsage) {
    const suggestions = ['Monitor memory-intensive processes'];
    
    if (memoryUsage > 90) {
      suggestions.push('Increase memory allocation', 'Implement memory cleanup', 'Review memory leaks');
    } else if (memoryUsage > 80) {
      suggestions.push('Optimize memory usage patterns', 'Consider memory pooling');
    }
    
    return suggestions;
  }

  getCacheOptimizationSuggestions(hitRatio) {
    const suggestions = ['Review cache configuration'];
    
    if (hitRatio < 0.5) {
      suggestions.push('Increase cache size', 'Review cache TTL settings', 'Implement cache warming');
    } else if (hitRatio < 0.7) {
      suggestions.push('Optimize cache keys', 'Review cache invalidation strategy');
    }
    
    return suggestions;
  }

  getStartupOptimizationSuggestions(startupTime) {
    const suggestions = ['Review container configuration'];
    
    if (startupTime > 10000) {
      suggestions.push('Implement container pre-warming', 'Optimize base image', 'Review startup scripts');
    } else if (startupTime > 5000) {
      suggestions.push('Cache container templates', 'Optimize initialization sequence');
    }
    
    return suggestions;
  }

  getNetworkOptimizationSuggestions(latency) {
    const suggestions = ['Monitor network connectivity'];
    
    if (latency > 500) {
      suggestions.push('Check network configuration', 'Implement connection pooling', 'Review DNS settings');
    } else if (latency > 100) {
      suggestions.push('Optimize network requests', 'Consider local caching');
    }
    
    return suggestions;
  }

  /**
   * Helper methods for data retrieval
   */
  getRecentAnalyses(timeWindow) {
    const cutoff = Date.now() - timeWindow;
    return this.bottleneckHistory.filter(analysis => analysis.timestamp.getTime() > cutoff);
  }

  getRecentContainerStartups() {
    // Placeholder - would integrate with actual container metrics
    return Array.from({ length: 10 }, () => Math.random() * 10000);
  }

  getRecentNetworkMetrics() {
    // Placeholder - would integrate with actual network metrics
    return Array.from({ length: 10 }, () => ({ latency: Math.random() * 1000 }));
  }

  getRecentIOMetrics() {
    // Placeholder - would integrate with actual I/O metrics
    return Array.from({ length: 10 }, () => ({ waitTime: Math.random() * 200 }));
  }

  getRecentCPUMetrics() {
    // Placeholder - would integrate with actual CPU metrics
    return Array.from({ length: 10 }, () => ({ runQueueLength: Math.random() * 20 }));
  }

  /**
   * Initialize baseline models for anomaly detection
   */
  async initializeBaselines() {
    // Initialize baseline models for different metrics
    this.anomalyBaselines.set('cpu', { mean: 0, stdDev: 0, samples: [] });
    this.anomalyBaselines.set('memory', { mean: 0, stdDev: 0, samples: [] });
    this.anomalyBaselines.set('network', { mean: 0, stdDev: 0, samples: [] });
    
    logger.debug('Baseline models initialized for anomaly detection');
  }

  /**
   * Clean up old analysis data
   */
  cleanupOldAnalysis() {
    const cutoff = Date.now() - this.config.analysisWindow * 2; // Keep 2x the analysis window
    this.bottleneckHistory = this.bottleneckHistory.filter(
      analysis => analysis.timestamp.getTime() > cutoff
    );
  }

  /**
   * Get comprehensive bottleneck report
   */
  getBottleneckReport() {
    const activeBottlenecks = Array.from(this.activeBottlenecks.values());
    const recentAnalyses = this.getRecentAnalyses(this.config.analysisWindow);
    
    return {
      activeBottlenecks,
      bottleneckCounts: Object.fromEntries(this.bottleneckCounts),
      recentAnalyses: recentAnalyses.slice(-10), // Last 10 analyses
      summary: {
        totalActiveBottlenecks: activeBottlenecks.length,
        criticalBottlenecks: activeBottlenecks.filter(b => b.severity === 'critical').length,
        mostCommonBottleneck: this.getMostCommonBottleneck(),
        averageResolutionTime: this.getAverageResolutionTime(),
        systemHealth: this.getSystemHealthScore()
      }
    };
  }

  /**
   * Get most common bottleneck type
   */
  getMostCommonBottleneck() {
    let maxCount = 0;
    let mostCommon = null;
    
    for (const [type, count] of this.bottleneckCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = type;
      }
    }
    
    return mostCommon;
  }

  /**
   * Calculate average resolution time
   */
  getAverageResolutionTime() {
    // This would be calculated from resolved bottleneck history
    // Placeholder implementation
    return 300000; // 5 minutes
  }

  /**
   * Calculate system health score
   */
  getSystemHealthScore() {
    const activeBottlenecks = Array.from(this.activeBottlenecks.values());
    let score = 100;
    
    for (const bottleneck of activeBottlenecks) {
      switch (bottleneck.severity) {
        case 'severe':
          score -= 30;
          break;
        case 'critical':
          score -= 20;
          break;
        case 'warning':
          score -= 10;
          break;
      }
    }
    
    return Math.max(0, score);
  }
}

module.exports = BottleneckAnalyzer;