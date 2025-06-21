/**
 * E2E Tests for Performance Optimization System
 * Tests the complete performance optimization pipeline including:
 * - Performance profiling and monitoring
 * - Bottleneck detection and resolution
 * - Predictive scaling
 * - Resource prediction
 * - Performance analytics dashboard
 */

const request = require('supertest');
const { expect } = require('@jest/globals');
const DockerAPI = require('../../src/container-orchestration/docker/docker-api');
const PerformanceOptimizer = require('../../src/container-orchestration/performance/performance-optimizer');
const { initializePerformanceAnalytics } = require('../../src/api/performance-analytics');

describe('Performance Optimization E2E Tests', () => {
  let app;
  let dockerAPI;
  let performanceOptimizer;
  let server;

  beforeAll(async () => {
    // Initialize Docker API
    dockerAPI = new DockerAPI();
    await dockerAPI.initialize();

    // Initialize Performance Optimizer
    performanceOptimizer = new PerformanceOptimizer(dockerAPI, {
      optimizationMode: 'adaptive',
      autoOptimization: true,
      enablePredictiveOptimization: true
    });

    // Initialize server with performance analytics
    const express = require('express');
    app = express();
    app.use(express.json());
    
    // Initialize performance analytics
    initializePerformanceAnalytics(performanceOptimizer);
    const { router: analyticsRouter } = require('../../src/api/performance-analytics');
    app.use('/api/analytics', analyticsRouter);
    
    // Start server
    server = app.listen(0); // Random port
  });

  afterAll(async () => {
    await performanceOptimizer.stop();
    await dockerAPI.cleanup();
    server.close();
  });

  describe('Performance Optimizer Initialization', () => {
    test('Should initialize all components successfully', async () => {
      await performanceOptimizer.initialize();
      
      expect(performanceOptimizer.isInitialized).toBe(true);
      expect(performanceOptimizer.startupOptimizer).toBeDefined();
      expect(performanceOptimizer.cacheManager).toBeDefined();
      expect(performanceOptimizer.profiler).toBeDefined();
      expect(performanceOptimizer.bottleneckAnalyzer).toBeDefined();
      expect(performanceOptimizer.predictiveScaler).toBeDefined();
      expect(performanceOptimizer.resourcePredictor).toBeDefined();
    });

    test('Should establish performance baseline', async () => {
      const baseline = performanceOptimizer.performanceBaseline;
      expect(baseline).toBeDefined();
      expect(baseline.timestamp).toBeDefined();
    });
  });

  describe('Performance Profiling', () => {
    test('Should profile container performance', async () => {
      // Create a test container
      const container = await dockerAPI.createContainer({
        image: 'alpine:latest',
        cmd: ['sleep', '30']
      });
      
      await dockerAPI.startContainer(container.id);
      
      // Start profiling
      await performanceOptimizer.profiler.start();
      
      // Wait for metrics collection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get performance report
      const report = performanceOptimizer.profiler.getPerformanceReport();
      
      expect(report).toBeDefined();
      expect(report.systemMetrics).toBeDefined();
      expect(report.containerMetrics).toBeDefined();
      expect(report.systemMetrics.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(report.systemMetrics.memoryUsage).toBeGreaterThanOrEqual(0);
      
      // Cleanup
      await dockerAPI.stopContainer(container.id);
      await dockerAPI.removeContainer(container.id);
    });

    test('Should track job metrics', async () => {
      const jobId = 'test-job-123';
      const jobData = {
        repository: 'test/repo',
        workflow: 'test-workflow',
        runner_labels: ['self-hosted', 'docker']
      };
      
      // Record job start
      performanceOptimizer.profiler.recordJobStart(jobId, jobData);
      
      // Simulate job execution
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Record job completion
      performanceOptimizer.profiler.recordJobEnd(jobId, 'completed');
      
      // Get job metrics
      const metrics = performanceOptimizer.profiler.getJobMetrics();
      const jobMetric = metrics.find(m => m.jobId === jobId);
      
      expect(jobMetric).toBeDefined();
      expect(jobMetric.executionTime).toBeGreaterThan(0);
      expect(jobMetric.status).toBe('completed');
    });
  });

  describe('Bottleneck Detection', () => {
    test('Should detect CPU bottlenecks', async () => {
      // Simulate high CPU usage
      const metrics = {
        timestamp: Date.now(),
        type: 'system',
        data: {
          cpuUsage: 92,
          memoryUsage: 45,
          diskIO: 30,
          networkIO: 20
        }
      };
      
      // Update profiler with high CPU metrics
      performanceOptimizer.profiler.metrics.system.push(metrics);
      
      // Run bottleneck analysis
      await performanceOptimizer.bottleneckAnalyzer.start();
      await performanceOptimizer.bottleneckAnalyzer.analyze();
      
      // Check for bottleneck detection
      const analysis = await new Promise((resolve) => {
        performanceOptimizer.bottleneckAnalyzer.once('bottleneckDetected', resolve);
      });
      
      expect(analysis.type).toBe('cpu');
      expect(analysis.severity).toBeGreaterThan(0);
      expect(analysis.impact).toBeGreaterThan(0);
    });

    test('Should detect cache performance issues', async () => {
      // Simulate poor cache performance
      const cacheStats = {
        hits: 30,
        misses: 70,
        hitRate: 0.3,
        totalSize: 1024 * 1024 * 100, // 100MB
        evictions: 50
      };
      
      performanceOptimizer.cacheManager.stats = cacheStats;
      
      // Run bottleneck analysis
      await performanceOptimizer.bottleneckAnalyzer.analyzeCacheBottlenecks();
      
      // Verify cache bottleneck detection
      const bottlenecks = performanceOptimizer.bottleneckAnalyzer.currentBottlenecks;
      const cacheBottleneck = Array.from(bottlenecks.values()).find(b => b.type === 'cache');
      
      expect(cacheBottleneck).toBeDefined();
      expect(cacheBottleneck.details.hitRate).toBeLessThan(0.5);
    });
  });

  describe('Predictive Scaling', () => {
    test('Should predict future demand', async () => {
      // Initialize predictive scaler
      await performanceOptimizer.predictiveScaler.initialize();
      
      // Generate predictions
      await performanceOptimizer.predictiveScaler.generatePredictions();
      
      // Get predictions
      const predictions = performanceOptimizer.predictiveScaler.predictions.demand;
      
      expect(predictions).toBeDefined();
      expect(predictions.length).toBeGreaterThan(0);
      expect(predictions[0]).toHaveProperty('timestamp');
      expect(predictions[0]).toHaveProperty('value');
      expect(predictions[0]).toHaveProperty('confidence');
    });

    test('Should generate scaling recommendations', async () => {
      // Mock high demand prediction
      performanceOptimizer.predictiveScaler.predictions.demand = [
        {
          timestamp: Date.now() + 180000, // 3 minutes from now
          value: 100, // High demand
          confidence: 0.9
        }
      ];
      
      // Generate scaling recommendations
      await performanceOptimizer.predictiveScaler.generateScalingRecommendations();
      
      const recommendations = performanceOptimizer.predictiveScaler.predictions.recommendations;
      
      expect(recommendations).toBeDefined();
      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].type).toBe('scale_up');
      expect(recommendations[0].confidence).toBeGreaterThan(0.8);
    });

    test('Should detect anomalies', async () => {
      // Add anomalous data
      const anomalousData = [
        { timestamp: Date.now() - 3600000, value: 10 },
        { timestamp: Date.now() - 2400000, value: 12 },
        { timestamp: Date.now() - 1200000, value: 150 }, // Anomaly
        { timestamp: Date.now(), value: 15 }
      ];
      
      performanceOptimizer.predictiveScaler.historicalData.jobCounts = anomalousData;
      
      // Run anomaly detection
      await performanceOptimizer.predictiveScaler.generatePredictions();
      
      // Check for anomaly events
      const anomalyDetected = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('No anomaly detected')), 5000);
        performanceOptimizer.predictiveScaler.once('anomalyDetected', (data) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });
      
      expect(anomalyDetected).toBeDefined();
      expect(anomalyDetected.anomaly.type).toBe('spike');
    });
  });

  describe('Resource Prediction', () => {
    test('Should predict job resource requirements', async () => {
      // Initialize resource predictor
      await performanceOptimizer.resourcePredictor.initialize();
      
      // Predict resources for a job
      const jobConfig = {
        repository: 'test/repo',
        workflow: 'build',
        runner_labels: ['self-hosted', 'docker'],
        priority: 'normal'
      };
      
      const prediction = await performanceOptimizer.resourcePredictor.predictResources(jobConfig);
      
      expect(prediction).toBeDefined();
      expect(prediction.cpu).toBeGreaterThan(0);
      expect(prediction.memory).toBeGreaterThan(0);
      expect(prediction.disk).toBeGreaterThan(0);
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
    });

    test('Should update predictions based on actual usage', async () => {
      const jobId = 'test-job-456';
      const jobMetrics = {
        jobId,
        jobType: 'test/repo:build',
        predictedResources: {
          cpu: 2.0,
          memory: 4096,
          disk: 10240
        },
        actualResources: {
          cpu: 1.5,
          memory: 3072,
          disk: 8192
        },
        duration: 300000 // 5 minutes
      };
      
      // Update job metrics
      await performanceOptimizer.resourcePredictor.updateJobMetrics(jobId, jobMetrics);
      
      // Verify accuracy tracking
      const stats = performanceOptimizer.resourcePredictor.stats;
      expect(stats.totalPredictions).toBeGreaterThan(0);
    });
  });

  describe('Performance Analytics API', () => {
    test('Should return dashboard data', async () => {
      const response = await request(server)
        .get('/api/analytics/dashboard')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.overview).toBeDefined();
      expect(response.body.data.performance).toBeDefined();
      expect(response.body.data.resources).toBeDefined();
    });

    test('Should return specific widget data', async () => {
      const response = await request(server)
        .get('/api/analytics/widgets/systemOverview')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.widget).toBe('systemOverview');
      expect(response.body.data).toBeDefined();
      expect(response.body.data.title).toBe('System Overview');
    });

    test('Should return performance insights', async () => {
      const response = await request(server)
        .get('/api/analytics/insights')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.insights).toBeDefined();
      expect(response.body.insights.systemHealth).toBeDefined();
      expect(response.body.insights.recommendations).toBeInstanceOf(Array);
    });

    test('Should export dashboard data', async () => {
      const response = await request(server)
        .get('/api/analytics/export?format=json')
        .expect(200);
      
      expect(response.headers['content-type']).toContain('application/json');
      const data = JSON.parse(response.text);
      expect(data.overview).toBeDefined();
      expect(data.performance).toBeDefined();
    });

    test('Should trigger manual optimization', async () => {
      await performanceOptimizer.start();
      
      const response = await request(server)
        .post('/api/analytics/optimization/trigger')
        .send({
          targetComponent: 'cache',
          options: { aggressive: true }
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.optimizationId).toBeDefined();
      expect(response.body.status).toBeDefined();
    });

    test('Should return performance predictions', async () => {
      const response = await request(server)
        .get('/api/analytics/predictions?horizon=12')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.horizon).toBe(12);
      expect(response.body.predictions).toBeDefined();
      expect(response.body.predictions.demand).toBeInstanceOf(Array);
      expect(response.body.predictions.resourceRequirements).toBeDefined();
    });
  });

  describe('Optimization Integration', () => {
    test('Should optimize container startup', async () => {
      // Create optimized container pool
      await performanceOptimizer.startupOptimizer.initialize();
      await performanceOptimizer.startupOptimizer.warmupPool();
      
      // Measure startup time
      const startTime = Date.now();
      const container = await performanceOptimizer.startupOptimizer.getOptimizedContainer({
        image: 'alpine:latest',
        repository: 'test/repo'
      });
      const startupTime = Date.now() - startTime;
      
      expect(container).toBeDefined();
      expect(startupTime).toBeLessThan(5000); // Should start within 5 seconds
      
      // Cleanup
      await dockerAPI.stopContainer(container.id);
      await dockerAPI.removeContainer(container.id);
    });

    test('Should handle complete optimization cycle', async () => {
      // Start performance optimizer
      await performanceOptimizer.start();
      
      // Wait for optimization cycle
      const optimizationResult = await new Promise((resolve) => {
        performanceOptimizer.once('optimizationCompleted', resolve);
        performanceOptimizer.runOptimizationCycle();
      });
      
      expect(optimizationResult).toBeDefined();
      expect(optimizationResult.timestamp).toBeDefined();
      expect(optimizationResult.appliedOptimizations).toBeInstanceOf(Array);
      expect(optimizationResult.impact).toBeDefined();
    });
  });

  describe('Performance Dashboard', () => {
    test('Should handle real-time updates', async () => {
      // Note: This would test WebSocket/SSE connections
      // Simplified for unit testing
      const dashboardData = performanceOptimizer.performanceDashboard?.getDashboardData();
      
      expect(dashboardData).toBeDefined();
      expect(dashboardData.overview).toBeDefined();
      expect(dashboardData.performance).toBeDefined();
    });

    test('Should generate analytics report', async () => {
      const response = await request(server)
        .get('/api/analytics/reports/generate?period=24h')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.report).toBeDefined();
      expect(response.body.report.summary).toBeDefined();
      expect(response.body.report.performance).toBeDefined();
      expect(response.body.report.recommendations).toBeInstanceOf(Array);
    });
  });
});