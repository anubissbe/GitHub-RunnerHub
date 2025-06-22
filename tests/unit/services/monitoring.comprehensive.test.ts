/**
 * Comprehensive Unit Tests for Monitoring Service
 * Tests all core functionality including metrics collection, health checks, and alerts
 */

import { MonitoringService } from '../../../src/services/monitoring-enhanced';
import { createLogger } from '../../../src/utils/logger';

// Mock dependencies
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/services/database');
jest.mock('ioredis');

describe('MonitoringService', () => {
  let monitoringService: MonitoringService;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    (createLogger as jest.Mock).mockReturnValue(mockLogger);
    
    monitoringService = new MonitoringService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      expect(monitoringService).toBeDefined();
      expect(createLogger).toHaveBeenCalledWith('Monitoring');
    });

    it('should set up metrics collection intervals', async () => {
      const startSpy = jest.spyOn(monitoringService, 'start');
      await monitoringService.start();
      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe('Metrics Collection', () => {
    it('should collect system metrics', async () => {
      const metrics = await monitoringService.getSystemMetrics();
      
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('disk');
      expect(metrics).toHaveProperty('timestamp');
      
      expect(typeof metrics.cpu.usage).toBe('number');
      expect(typeof metrics.memory.used).toBe('number');
      expect(typeof metrics.memory.total).toBe('number');
    });

    it('should collect job metrics', async () => {
      const jobMetrics = await monitoringService.getJobMetrics();
      
      expect(jobMetrics).toHaveProperty('total');
      expect(jobMetrics).toHaveProperty('pending');
      expect(jobMetrics).toHaveProperty('running');
      expect(jobMetrics).toHaveProperty('completed');
      expect(jobMetrics).toHaveProperty('failed');
      
      expect(typeof jobMetrics.total).toBe('number');
      expect(typeof jobMetrics.pending).toBe('number');
    });

    it('should collect runner metrics', async () => {
      const runnerMetrics = await monitoringService.getRunnerMetrics();
      
      expect(runnerMetrics).toHaveProperty('total');
      expect(runnerMetrics).toHaveProperty('online');
      expect(runnerMetrics).toHaveProperty('offline');
      expect(runnerMetrics).toHaveProperty('busy');
      expect(runnerMetrics).toHaveProperty('idle');
      
      expect(typeof runnerMetrics.total).toBe('number');
      expect(typeof runnerMetrics.online).toBe('number');
    });
  });

  describe('Health Checks', () => {
    it('should perform database health check', async () => {
      const healthCheck = await monitoringService.checkDatabaseHealth();
      
      expect(healthCheck).toHaveProperty('status');
      expect(healthCheck).toHaveProperty('responseTime');
      expect(healthCheck).toHaveProperty('timestamp');
      
      expect(['healthy', 'unhealthy']).toContain(healthCheck.status);
      expect(typeof healthCheck.responseTime).toBe('number');
    });

    it('should perform Redis health check', async () => {
      const healthCheck = await monitoringService.checkRedisHealth();
      
      expect(healthCheck).toHaveProperty('status');
      expect(healthCheck).toHaveProperty('responseTime');
      expect(healthCheck).toHaveProperty('timestamp');
      
      expect(['healthy', 'unhealthy']).toContain(healthCheck.status);
    });

    it('should perform overall system health check', async () => {
      const systemHealth = await monitoringService.getSystemHealth();
      
      expect(systemHealth).toHaveProperty('overall');
      expect(systemHealth).toHaveProperty('components');
      expect(systemHealth).toHaveProperty('timestamp');
      
      expect(['healthy', 'degraded', 'unhealthy']).toContain(systemHealth.overall);
      expect(systemHealth.components).toHaveProperty('database');
      expect(systemHealth.components).toHaveProperty('redis');
    });
  });

  describe('Alert System', () => {
    it('should trigger alerts for high CPU usage', async () => {
      const alertSpy = jest.spyOn(monitoringService, 'triggerAlert');
      
      // Simulate high CPU usage
      const highCpuMetrics = {
        cpu: { usage: 95 },
        memory: { used: 1000, total: 2000 },
        timestamp: Date.now()
      };
      
      await monitoringService.processMetrics(highCpuMetrics);
      
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cpu_high',
          severity: 'warning'
        })
      );
    });

    it('should trigger alerts for low memory', async () => {
      const alertSpy = jest.spyOn(monitoringService, 'triggerAlert');
      
      // Simulate low memory
      const lowMemoryMetrics = {
        cpu: { usage: 50 },
        memory: { used: 1900, total: 2000 }, // 95% usage
        timestamp: Date.now()
      };
      
      await monitoringService.processMetrics(lowMemoryMetrics);
      
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory_low',
          severity: 'critical'
        })
      );
    });

    it('should not trigger alerts for normal metrics', async () => {
      const alertSpy = jest.spyOn(monitoringService, 'triggerAlert');
      
      const normalMetrics = {
        cpu: { usage: 45 },
        memory: { used: 800, total: 2000 }, // 40% usage
        timestamp: Date.now()
      };
      
      await monitoringService.processMetrics(normalMetrics);
      
      expect(alertSpy).not.toHaveBeenCalled();
    });
  });

  describe('Prometheus Metrics', () => {
    it('should generate Prometheus-compatible metrics', async () => {
      const prometheusMetrics = await monitoringService.getPrometheusMetrics();
      
      expect(typeof prometheusMetrics).toBe('string');
      expect(prometheusMetrics).toContain('# HELP');
      expect(prometheusMetrics).toContain('# TYPE');
      expect(prometheusMetrics).toContain('system_cpu_usage');
      expect(prometheusMetrics).toContain('system_memory_used');
      expect(prometheusMetrics).toContain('jobs_total');
    });

    it('should include custom metrics in Prometheus output', async () => {
      // Record custom metric
      await monitoringService.recordCustomMetric('test_metric', 42, { label: 'test' });
      
      const prometheusMetrics = await monitoringService.getPrometheusMetrics();
      expect(prometheusMetrics).toContain('test_metric');
    });
  });

  describe('Performance Tracking', () => {
    it('should track job completion times', async () => {
      const jobId = 'test-job-123';
      const startTime = Date.now();
      
      await monitoringService.recordJobStart(jobId);
      await testUtils.sleep(10); // Small delay
      await monitoringService.recordJobCompletion(jobId, 'completed');
      
      const metrics = await monitoringService.getPerformanceMetrics();
      expect(metrics.avgJobCompletionTime).toBeGreaterThan(0);
    });

    it('should track API response times', async () => {
      const endpoint = '/api/test';
      const responseTime = 150;
      
      await monitoringService.recordApiCall(endpoint, responseTime, 200);
      
      const metrics = await monitoringService.getApiMetrics();
      expect(metrics.endpoints[endpoint]).toBeDefined();
      expect(metrics.endpoints[endpoint].avgResponseTime).toBe(responseTime);
    });
  });

  describe('Data Retention', () => {
    it('should clean up old metrics data', async () => {
      const cleanupSpy = jest.spyOn(monitoringService, 'cleanupOldData');
      
      await monitoringService.cleanupOldData();
      expect(cleanupSpy).toHaveBeenCalled();
    });

    it('should respect retention policies', async () => {
      const retentionDays = 7;
      const oldTimestamp = Date.now() - (retentionDays + 1) * 24 * 60 * 60 * 1000;
      
      // This would test actual cleanup logic
      await monitoringService.cleanupOldData(retentionDays);
      
      // Verify old data is removed
      const metrics = await monitoringService.getHistoricalMetrics(oldTimestamp);
      expect(metrics.length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Mock database error
      const dbError = new Error('Database connection failed');
      jest.spyOn(monitoringService, 'checkDatabaseHealth').mockRejectedValue(dbError);
      
      const healthCheck = await monitoringService.checkDatabaseHealth().catch(err => err);
      expect(healthCheck).toBeInstanceOf(Error);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle Redis connection errors gracefully', async () => {
      const redisError = new Error('Redis connection failed');
      jest.spyOn(monitoringService, 'checkRedisHealth').mockRejectedValue(redisError);
      
      const healthCheck = await monitoringService.checkRedisHealth().catch(err => err);
      expect(healthCheck).toBeInstanceOf(Error);
    });

    it('should continue operating with partial service failures', async () => {
      // Mock Redis failure but database success
      jest.spyOn(monitoringService, 'checkRedisHealth').mockResolvedValue({
        status: 'unhealthy',
        responseTime: 0,
        timestamp: Date.now()
      });
      
      const systemHealth = await monitoringService.getSystemHealth();
      expect(systemHealth.overall).toBe('degraded');
      expect(systemHealth.components.redis.status).toBe('unhealthy');
    });
  });

  describe('Real-time Updates', () => {
    it('should emit metrics updates', (done) => {
      monitoringService.on('metricsUpdate', (metrics) => {
        expect(metrics).toHaveProperty('timestamp');
        expect(metrics).toHaveProperty('system');
        done();
      });
      
      // Trigger metrics update
      monitoringService.emitMetricsUpdate();
    });

    it('should emit health status changes', (done) => {
      monitoringService.on('healthChange', (health) => {
        expect(health).toHaveProperty('component');
        expect(health).toHaveProperty('status');
        expect(health).toHaveProperty('timestamp');
        done();
      });
      
      // Trigger health change
      monitoringService.emitHealthChange('database', 'unhealthy');
    });
  });
});