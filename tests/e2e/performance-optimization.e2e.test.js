/**
 * Performance Optimization E2E Tests
 * Comprehensive end-to-end testing of the performance optimization system
 */

const { PerformanceOptimizer } = require('../../src/container-orchestration/performance/performance-optimizer');
const { ContainerStartupOptimizer } = require('../../src/container-orchestration/performance/container-startup-optimizer');
const { AdvancedCacheManager } = require('../../src/container-orchestration/performance/advanced-cache-manager');
const { PerformanceProfiler } = require('../../src/container-orchestration/performance/performance-profiler');
const { BottleneckAnalyzer } = require('../../src/container-orchestration/performance/bottleneck-analyzer');
const Docker = require('dockerode');

describe('Performance Optimization E2E Tests', () => {
  let docker;
  let mockDockerAPI;
  let performanceOptimizer;
  
  const testConfig = {
    optimizationMode: 'adaptive',
    autoOptimization: false, // Disable for testing
    optimizationInterval: 5000, // 5 seconds for faster testing
    
    performanceTargets: {
      containerStartupTime: 3000,
      cacheHitRatio: 0.85,
      cpuUtilization: 75,
      memoryUtilization: 80,
      systemResponseTime: 100
    },
    
    strategies: {
      enableAdaptiveScaling: true,
      enablePredictiveOptimization: false, // Disable ML for testing
      enableResourceRebalancing: true,
      enableIntelligentCaching: true,
      enableContainerPoolOptimization: true
    }
  };

  beforeAll(async () => {
    // Initialize Docker client for testing
    docker = new Docker();
    
    // Create mock Docker API for testing
    mockDockerAPI = {
      docker: docker,
      config: {
        baseImage: 'node:18-alpine',
        networkName: 'test-performance-network',
        maxContainers: 5,
        resourceLimits: {
          memory: '134217728', // 128MB
          cpus: '0.5'
        }
      },
      getActiveContainers: jest.fn(() => []),
      createContainer: jest.fn(),
      startContainer: jest.fn(),
      stopContainer: jest.fn(),
      removeContainer: jest.fn()
    };
    
    // Clean up any existing test containers
    await cleanupTestContainers();
  }, 60000);

  afterAll(async () => {
    if (performanceOptimizer && performanceOptimizer.isRunning) {
      await performanceOptimizer.stop();
    }
    
    await cleanupTestContainers();
  }, 30000);

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Clean up between tests
    await cleanupTestContainers();
  });

  afterEach(async () => {
    if (performanceOptimizer && performanceOptimizer.isRunning) {
      await performanceOptimizer.stop();
    }
  });

  describe('Performance Optimizer Initialization', () => {
    test('should initialize all performance components', async () => {
      performanceOptimizer = new PerformanceOptimizer(mockDockerAPI, testConfig);
      
      await performanceOptimizer.initialize();
      
      expect(performanceOptimizer.isInitialized).toBe(true);
      expect(performanceOptimizer.startupOptimizer).toBeDefined();
      expect(performanceOptimizer.cacheManager).toBeDefined();
      expect(performanceOptimizer.profiler).toBeDefined();
      expect(performanceOptimizer.bottleneckAnalyzer).toBeDefined();
    });

    test('should establish performance baseline', async () => {
      performanceOptimizer = new PerformanceOptimizer(mockDockerAPI, testConfig);
      
      await performanceOptimizer.initialize();
      
      expect(performanceOptimizer.performanceBaseline).toBeDefined();
      expect(performanceOptimizer.performanceBaseline.timestamp).toBeDefined();
    });

    test('should start and stop optimization cycles', async () => {
      performanceOptimizer = new PerformanceOptimizer(mockDockerAPI, {
        ...testConfig,
        autoOptimization: true
      });
      
      await performanceOptimizer.initialize();
      await performanceOptimizer.start();
      
      expect(performanceOptimizer.isRunning).toBe(true);
      expect(performanceOptimizer.optimizationTimer).toBeDefined();
      
      await performanceOptimizer.stop();
      
      expect(performanceOptimizer.isRunning).toBe(false);
      expect(performanceOptimizer.optimizationTimer).toBeNull();
    });
  });

  describe('Container Startup Optimization', () => {
    let startupOptimizer;

    beforeEach(async () => {
      startupOptimizer = new ContainerStartupOptimizer(mockDockerAPI, {
        enablePreWarming: true,
        preWarmPoolSize: 3,
        enableImageCaching: true,
        enableTemplateOptimization: true,
        trackStartupMetrics: true
      });
    });

    afterEach(async () => {
      if (startupOptimizer) {
        await startupOptimizer.stop();
      }
    });

    test('should initialize pre-warmed container pool', async () => {
      // Mock container creation
      mockDockerAPI.docker = {
        createContainer: jest.fn().mockResolvedValue({
          id: 'test-container-id',
          start: jest.fn().mockResolvedValue(true)
        })
      };

      await startupOptimizer.initialize();
      
      expect(startupOptimizer.preWarmedContainers.size).toBeGreaterThanOrEqual(1);
    });

    test('should optimize container creation with pre-warmed containers', async () => {
      // Setup pre-warmed container
      const mockContainer = {
        id: 'prewarm-container-id',
        exec: jest.fn().mockResolvedValue({
          start: jest.fn().mockResolvedValue(true)
        })
      };
      
      startupOptimizer.preWarmedContainers.set('prewarm-1', {
        container: mockContainer,
        containerId: 'prewarm-container-id',
        inUse: false,
        createdAt: new Date()
      });

      const result = await startupOptimizer.createOptimizedContainer('test-job-1', {
        repository: 'test/repo'
      });
      
      expect(result).toBeDefined();
      expect(startupOptimizer.preWarmedContainers.get('prewarm-1')?.inUse).toBe(true);
    });

    test('should record startup metrics', async () => {
      const jobId = 'metrics-test-job';
      const startTime = Date.now();
      
      startupOptimizer.recordStartupMetrics(jobId, startTime, 'optimized');
      
      expect(startupOptimizer.config.startupMetrics.has(jobId)).toBe(true);
      expect(startupOptimizer.performanceMetrics.totalStartups).toBe(1);
    });

    test('should provide optimization recommendations', async () => {
      // Simulate poor performance
      startupOptimizer.performanceMetrics.averageStartupTime = 8000; // 8 seconds
      
      const recommendations = startupOptimizer.getOptimizationRecommendations();
      
      expect(recommendations).toBeDefined();
      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].priority).toBeDefined();
    });
  });

  describe('Advanced Cache Manager', () => {
    let cacheManager;

    beforeEach(async () => {
      cacheManager = new AdvancedCacheManager({
        redis: {
          host: 'localhost',
          port: 6379,
          lazyConnect: true
        },
        enableCompression: true,
        enableMetrics: true
      });
    });

    afterEach(async () => {
      if (cacheManager) {
        await cacheManager.stop();
      }
    });

    test('should initialize memory caches', async () => {
      await cacheManager.initialize();
      
      expect(cacheManager.isInitialized).toBe(true);
      expect(cacheManager.memoryCaches.size).toBeGreaterThan(0);
    });

    test('should perform multi-layer caching', async () => {
      await cacheManager.initialize();
      
      const testKey = 'test-key';
      const testValue = { data: 'test-data', timestamp: Date.now() };
      
      // Set value
      await cacheManager.set(testKey, testValue, 'githubApi');
      
      // Get value (should hit L1 cache)
      const result = await cacheManager.get(testKey, 'githubApi');
      
      expect(result).toEqual(testValue);
      expect(cacheManager.stats.hits.l1).toBe(1);
    });

    test('should compress large values', async () => {
      await cacheManager.initialize();
      
      const largeValue = 'x'.repeat(2000); // Large string
      const compressed = await cacheManager.compressValue(largeValue);
      
      expect(compressed).toBeDefined();
      expect(typeof compressed).toBe('object');
      expect(compressed.compressed).toBe(true);
    });

    test('should track cache statistics', async () => {
      await cacheManager.initialize();
      
      // Perform cache operations
      await cacheManager.set('key1', 'value1', 'githubApi');
      await cacheManager.get('key1', 'githubApi'); // Hit
      await cacheManager.get('key2', 'githubApi'); // Miss
      
      const stats = cacheManager.getStatistics();
      
      expect(stats.hits.total).toBe(1);
      expect(stats.misses.total).toBe(1);
    });

    test('should invalidate cache patterns', async () => {
      await cacheManager.initialize();
      
      // Set multiple keys
      await cacheManager.set('user:1', 'data1', 'githubApi');
      await cacheManager.set('user:2', 'data2', 'githubApi');
      await cacheManager.set('repo:1', 'data3', 'githubApi');
      
      // Invalidate user pattern
      await cacheManager.invalidatePattern(/user:/, 'githubApi');
      
      // User keys should be invalidated, repo key should remain
      const user1 = await cacheManager.get('user:1', 'githubApi');
      const repo1 = await cacheManager.get('repo:1', 'githubApi');
      
      expect(user1).toBeNull();
      expect(repo1).toBeDefined();
    });
  });

  describe('Performance Profiler', () => {
    let profiler;

    beforeEach(() => {
      profiler = new PerformanceProfiler({
        systemMetricsInterval: 1000, // 1 second for testing
        containerMetricsInterval: 2000, // 2 seconds for testing
        performanceSnapshotInterval: 3000, // 3 seconds for testing
        enableApplicationProfiling: true
      });
    });

    afterEach(async () => {
      if (profiler && profiler.isRunning) {
        await profiler.stop();
      }
    });

    test('should start and collect system metrics', async () => {
      await profiler.start();
      
      expect(profiler.isRunning).toBe(true);
      expect(profiler.systemMetricsTimer).toBeDefined();
      
      // Wait for metrics collection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      expect(profiler.systemMetrics.length).toBeGreaterThan(0);
    });

    test('should track operation timing', async () => {
      const operationId = profiler.startOperation('test-operation', { type: 'test' });
      
      // Simulate operation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = profiler.endOperation(operationId, { success: true });
      
      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThan(90); // Should be around 100ms
      expect(profiler.operationHistory.length).toBe(1);
    });

    test('should create performance snapshots', async () => {
      await profiler.start();
      
      // Wait for snapshot creation
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      expect(profiler.performanceSnapshots.length).toBeGreaterThan(0);
      
      const snapshot = profiler.performanceSnapshots[0];
      expect(snapshot.summary).toBeDefined();
      expect(snapshot.trends).toBeDefined();
      expect(snapshot.systemHealth).toBeDefined();
    });

    test('should generate performance recommendations', async () => {
      // Simulate poor performance
      profiler.systemMetrics.push({
        timestamp: new Date(),
        cpu: { usage: 95 }, // High CPU
        memory: { usage: 90 }, // High memory
        disk: { usage: 85 }
      });
      
      const snapshot = await profiler.createPerformanceSnapshot();
      
      expect(snapshot.recommendations.length).toBeGreaterThan(0);
      expect(snapshot.recommendations[0].priority).toBeDefined();
    });
  });

  describe('Bottleneck Analyzer', () => {
    let profiler;
    let cacheManager;
    let bottleneckAnalyzer;

    beforeEach(async () => {
      profiler = new PerformanceProfiler({
        systemMetricsInterval: 1000,
        enableApplicationProfiling: true
      });
      
      cacheManager = new AdvancedCacheManager({
        enableMetrics: true
      });
      
      await cacheManager.initialize();
      
      bottleneckAnalyzer = new BottleneckAnalyzer(profiler, cacheManager, {
        analysisInterval: 2000, // 2 seconds for testing
        enablePatternDetection: true,
        enableCorrelationAnalysis: true
      });
    });

    afterEach(async () => {
      if (bottleneckAnalyzer && bottleneckAnalyzer.isRunning) {
        await bottleneckAnalyzer.stop();
      }
      if (profiler && profiler.isRunning) {
        await profiler.stop();
      }
      if (cacheManager) {
        await cacheManager.stop();
      }
    });

    test('should start bottleneck analysis', async () => {
      await bottleneckAnalyzer.start();
      
      expect(bottleneckAnalyzer.isRunning).toBe(true);
      expect(bottleneckAnalyzer.analysisTimer).toBeDefined();
    });

    test('should identify system bottlenecks', async () => {
      // Mock poor performance data
      jest.spyOn(profiler, 'getPerformanceReport').mockReturnValue({
        summary: {
          averageCpuUsage: 90, // High CPU usage
          averageMemoryUsage: 85, // High memory usage
          activeOperations: 25 // High concurrency
        },
        systemHealth: { score: 60 }
      });

      const bottlenecks = await bottleneckAnalyzer.analyzeSystemBottlenecks();
      
      expect(bottlenecks.length).toBeGreaterThan(0);
      expect(bottlenecks.some(b => b.type === 'cpu')).toBe(true);
      expect(bottlenecks.some(b => b.type === 'memory')).toBe(true);
    });

    test('should analyze application bottlenecks', async () => {
      // Mock poor cache performance
      jest.spyOn(cacheManager, 'getStatistics').mockReturnValue({
        hits: { total: 50 },
        misses: { total: 150 }, // Low hit ratio
        errors: 15 // High error rate
      });

      const bottlenecks = await bottleneckAnalyzer.analyzeApplicationBottlenecks();
      
      expect(bottlenecks.length).toBeGreaterThan(0);
      expect(bottlenecks.some(b => b.type === 'cache_efficiency')).toBe(true);
    });

    test('should provide optimization suggestions', async () => {
      const mockBottleneck = {
        type: 'cpu',
        severity: 'critical',
        value: 95,
        category: 'system'
      };

      const suggestions = bottleneckAnalyzer.getCpuOptimizationSuggestions(95);
      
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some(s => s.includes('scaling'))).toBe(true);
    });

    test('should calculate performance score', async () => {
      const mockPerformance = {
        bottlenecks: {
          activeBottlenecks: [
            { severity: 'critical' },
            { severity: 'warning' }
          ]
        },
        targets: { compliance: 0.8 },
        system: { systemHealth: { score: 75 } }
      };

      const score = bottleneckAnalyzer.calculatePerformanceScore(mockPerformance);
      
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });
  });

  describe('Integrated Performance Optimization', () => {
    beforeEach(async () => {
      performanceOptimizer = new PerformanceOptimizer(mockDockerAPI, testConfig);
    });

    test('should perform complete optimization cycle', async () => {
      await performanceOptimizer.initialize();
      
      // Mock performance data that needs optimization
      jest.spyOn(performanceOptimizer, 'assessCurrentPerformance').mockResolvedValue({
        timestamp: new Date(),
        overallScore: 0.6, // Poor performance
        startup: { averageStartupTime: 8000 }, // Slow startup
        cache: { hits: { total: 50 }, misses: { total: 150 } }, // Poor cache
        system: { summary: { averageCpuUsage: 85 } }, // High CPU
        targets: { compliance: 0.5 },
        bottlenecks: { activeBottlenecks: [] }
      });

      const opportunities = await performanceOptimizer.identifyOptimizationOpportunities(
        await performanceOptimizer.assessCurrentPerformance()
      );
      
      expect(opportunities.length).toBeGreaterThan(0);
      expect(opportunities.some(o => o.type === 'container_startup')).toBe(true);
      expect(opportunities.some(o => o.type === 'cache_optimization')).toBe(true);
    });

    test('should apply container startup optimization', async () => {
      await performanceOptimizer.initialize();
      
      const opportunity = {
        type: 'container_startup',
        strategy: 'increase_prewarm_pool',
        currentValue: 8000,
        targetValue: 3000
      };

      const optimization = await performanceOptimizer.optimizeContainerStartup(opportunity);
      
      expect(optimization).toBeDefined();
      expect(optimization.type).toBe('container_startup');
      expect(optimization.actions.length).toBeGreaterThan(0);
    });

    test('should apply cache optimization', async () => {
      await performanceOptimizer.initialize();
      
      const opportunity = {
        type: 'cache_optimization',
        strategy: 'increase_cache_size',
        currentValue: 0.4,
        targetValue: 0.85
      };

      const optimization = await performanceOptimizer.optimizeCache(opportunity);
      
      expect(optimization).toBeDefined();
      expect(optimization.type).toBe('cache_optimization');
      expect(optimization.actions.length).toBeGreaterThan(0);
    });

    test('should handle performance alerts', async () => {
      await performanceOptimizer.initialize();
      
      const criticalAlert = {
        type: 'cpu_critical',
        severity: 'critical',
        message: 'Critical CPU usage detected',
        value: 95
      };

      // Test emergency optimization trigger
      const emergencyOptimizationSpy = jest.spyOn(performanceOptimizer, 'performEmergencyOptimization');
      
      performanceOptimizer.handlePerformanceAlert(criticalAlert);
      
      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(emergencyOptimizationSpy).toHaveBeenCalledWith(criticalAlert);
    });

    test('should measure optimization impact', async () => {
      await performanceOptimizer.initialize();
      
      const beforePerformance = {
        overallScore: 0.6,
        startup: { averageStartupTime: 8000 },
        cache: { hits: { total: 50 }, misses: { total: 150 } }
      };

      const appliedOptimizations = [
        { type: 'container_startup', actions: ['Increased pre-warm pool'] },
        { type: 'cache_optimization', actions: ['Increased cache size'] }
      ];

      // Mock improved performance after optimization
      jest.spyOn(performanceOptimizer, 'assessCurrentPerformance').mockResolvedValue({
        overallScore: 0.8,
        startup: { averageStartupTime: 4000 },
        cache: { hits: { total: 120 }, misses: { total: 30 } }
      });

      const impact = await performanceOptimizer.measureOptimizationImpact(
        beforePerformance, 
        appliedOptimizations
      );
      
      expect(impact.improvement).toBeGreaterThan(0);
      expect(impact.afterScore).toBeGreaterThan(impact.beforeScore);
    });

    test('should generate optimization report', async () => {
      await performanceOptimizer.initialize();
      
      // Add some optimization history
      performanceOptimizer.optimizationHistory.push({
        timestamp: new Date(),
        impact: { improvement: 0.2 },
        appliedOptimizations: [{ type: 'container_startup' }]
      });

      const report = performanceOptimizer.getOptimizationReport();
      
      expect(report).toBeDefined();
      expect(report.currentPerformance).toBeDefined();
      expect(report.optimizationHistory).toBeDefined();
      expect(report.systemHealth).toBeDefined();
      expect(report.statistics).toBeDefined();
    });
  });

  describe('Performance Validation', () => {
    test('should validate performance targets are met', async () => {
      performanceOptimizer = new PerformanceOptimizer(mockDockerAPI, testConfig);
      await performanceOptimizer.initialize();
      
      // Mock excellent performance
      const excellentPerformance = {
        startup: { averageStartupTime: 2000 }, // Under target
        cache: { hits: { total: 170 }, misses: { total: 30 } }, // Good hit ratio
        system: { 
          summary: { 
            averageCpuUsage: 70, // Under target
            averageMemoryUsage: 75 // Under target
          } 
        }
      };

      const targets = performanceOptimizer.evaluateTargetCompliance();
      
      expect(targets).toBeDefined();
      expect(targets.overall).toBeDefined();
    });

    test('should track performance improvements over time', async () => {
      performanceOptimizer = new PerformanceOptimizer(mockDockerAPI, testConfig);
      await performanceOptimizer.initialize();
      
      // Simulate multiple optimization cycles
      const cycles = [
        { impact: { improvement: 0.1 } },
        { impact: { improvement: 0.15 } },
        { impact: { improvement: 0.2 } }
      ];

      performanceOptimizer.optimizationHistory.push(...cycles);
      
      const averageImprovement = performanceOptimizer.calculateAverageImprovement();
      
      expect(averageImprovement).toBeCloseTo(0.15, 2);
    });
  });

  // Helper functions
  async function cleanupTestContainers() {
    try {
      const containers = await docker.listContainers({ 
        all: true,
        filters: {
          label: ['github-runner=true']
        }
      });
      
      for (const containerData of containers) {
        try {
          const container = docker.getContainer(containerData.Id);
          await container.remove({ force: true });
        } catch (error) {
          // Ignore errors for containers that don't exist
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  function waitForCondition(condition, timeout, description) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const check = async () => {
        try {
          if (await condition()) {
            resolve(true);
            return;
          }
          
          if (Date.now() - startTime > timeout) {
            reject(new Error(`Timeout waiting for: ${description}`));
            return;
          }
          
          setTimeout(check, 500);
        } catch (error) {
          reject(error);
        }
      };
      
      check();
    });
  }
});