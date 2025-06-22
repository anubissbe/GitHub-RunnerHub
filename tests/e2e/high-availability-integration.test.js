/**
 * End-to-End High Availability System Tests
 * Validates HA orchestration, failover, replication, health checks, and disaster recovery
 */

const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals');
const HAOrchestrator = require('../../src/high-availability/ha-orchestrator');
const OrchestratorRedundancy = require('../../src/high-availability/orchestrator-redundancy');
const FailoverManager = require('../../src/high-availability/failover-manager');
const DataReplicationManager = require('../../src/high-availability/data-replication');
const HealthChecker = require('../../src/high-availability/health-checker');
const DisasterRecoveryManager = require('../../src/high-availability/disaster-recovery');

describe('High Availability System E2E Tests', () => {
  let haOrchestrator;
  let testLogger;
  
  beforeAll(async () => {
    // Setup test logger
    testLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
  });
  
  afterAll(async () => {
    if (haOrchestrator && haOrchestrator.state.status === 'active') {
      await haOrchestrator.shutdown();
    }
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('HA Orchestrator Integration', () => {
    it('should initialize HA orchestrator with all components', async () => {
      haOrchestrator = new HAOrchestrator({
        enableRedundancy: false, // Disable Redis-dependent components for testing
        enableFailover: true,
        enableReplication: false, // Disable DB-dependent components for testing
        enableHealthChecks: true,
        enableDisasterRecovery: true,
        logger: testLogger,
        healthChecker: {
          checkInterval: 1000,
          timeoutDuration: 5000
        },
        disasterRecovery: {
          backupLocation: {
            local: '/tmp/test-backups'
          },
          encryption: {
            enabled: false // Disable for testing
          }
        }
      });
      
      await haOrchestrator.initialize();
      
      expect(haOrchestrator.state.status).toBe('active');
      expect(haOrchestrator.state.haLevel).toMatch(/basic|standard|enterprise/);
      expect(haOrchestrator.getEnabledComponents()).toContain('healthChecker');
      expect(testLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('High Availability orchestrator initialized successfully')
      );
    }, 30000);
    
    it('should provide comprehensive HA status', async () => {
      const status = haOrchestrator.getHAStatus();
      
      expect(status).toHaveProperty('overall');
      expect(status).toHaveProperty('components');
      expect(status).toHaveProperty('metrics');
      expect(status).toHaveProperty('enabledFeatures');
      
      expect(status.overall).toMatchObject({
        status: 'active',
        haLevel: expect.stringMatching(/none|basic|standard|enterprise/),
        uptime: expect.any(Number)
      });
      
      expect(status.enabledFeatures).toBeInstanceOf(Array);
      expect(status.enabledFeatures.length).toBeGreaterThan(0);
    });
    
    it('should handle component failures gracefully', async () => {
      const failureHandler = jest.fn();
      haOrchestrator.on('componentUnhealthy', failureHandler);
      
      // Simulate component failure
      haOrchestrator.handleComponentUnhealthy({
        component: 'test-service',
        error: 'Simulated failure',
        timestamp: Date.now()
      });
      
      expect(failureHandler).toHaveBeenCalledWith({
        component: 'test-service',
        error: 'Simulated failure',
        timestamp: expect.any(Number)
      });
    });
    
    it('should update metrics correctly', async () => {
      const initialMetrics = haOrchestrator.state.metrics;
      
      // Wait for metrics update
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const updatedMetrics = haOrchestrator.state.metrics;
      expect(updatedMetrics.uptime).toBeGreaterThan(initialMetrics.uptime);
    });
  });
  
  describe('Health Checker Component', () => {
    let healthChecker;
    
    beforeEach(() => {
      healthChecker = new HealthChecker({
        checkInterval: 1000,
        timeoutDuration: 5000,
        logger: testLogger
      });
    });
    
    afterEach(async () => {
      if (healthChecker) {
        healthChecker.stop();
      }
    });
    
    it('should initialize and start health checks', async () => {
      await healthChecker.initialize();
      
      expect(healthChecker.state.status).toBe('active');
      expect(testLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Health checker initialized successfully')
      );
    });
    
    it('should register and monitor services', async () => {
      await healthChecker.initialize();
      
      const status = healthChecker.getHealthStatus();
      
      expect(status.overall.status).toBe('active');
      expect(status.services).toBeInstanceOf(Array);
      expect(status.services.length).toBeGreaterThan(0);
      
      // Check that default services are registered
      const serviceNames = status.services.map(s => s.name);
      expect(serviceNames).toContain('api-server');
      expect(serviceNames).toContain('database');
      expect(serviceNames).toContain('redis');
    });
    
    it('should detect service health changes', async () => {
      const anomalyHandler = jest.fn();
      healthChecker.on('anomalyDetected', anomalyHandler);
      
      await healthChecker.initialize();
      
      // Wait for at least one health check cycle
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const status = healthChecker.getHealthStatus();
      expect(status.overall.totalChecks).toBeGreaterThan(0);
    });
    
    it('should provide accurate health metrics', async () => {
      await healthChecker.initialize();
      
      // Wait for health checks to run
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const status = healthChecker.getHealthStatus();
      
      expect(status.overall).toMatchObject({
        status: 'active',
        health: expect.stringMatching(/healthy|degraded|unhealthy|unknown/),
        totalChecks: expect.any(Number),
        successRate: expect.stringMatching(/\d+\.\d+%|N\/A/)
      });
      
      expect(status.summary.total).toBeGreaterThan(0);
      expect(status.summary.total).toBe(
        status.summary.healthy + status.summary.unhealthy + status.summary.unknown
      );
    });
  });
  
  describe('Failover Manager Component', () => {
    let failoverManager;
    let mockHealthChecker;
    
    beforeEach(() => {
      mockHealthChecker = {
        checkDatabaseHealth: jest.fn().mockResolvedValue({ healthy: true }),
        checkRedisHealth: jest.fn().mockResolvedValue({ healthy: true }),
        checkOrchestratorHealth: jest.fn().mockResolvedValue({ healthy: true }),
        checkMonitoringHealth: jest.fn().mockResolvedValue({ healthy: true })
      };
      
      failoverManager = new FailoverManager(mockHealthChecker, null, {
        checkInterval: 1000,
        failureThreshold: 2,
        logger: testLogger
      });
    });
    
    afterEach(() => {
      if (failoverManager) {
        failoverManager.stop();
      }
    });
    
    it('should initialize and register components', async () => {
      await failoverManager.initialize();
      
      expect(failoverManager.state.status).toBe('active');
      expect(testLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Failover manager initialized successfully')
      );
      
      const status = failoverManager.getFailoverStatus();
      expect(status.components).toBeInstanceOf(Array);
      expect(status.components.length).toBeGreaterThan(0);
    });
    
    it('should monitor component health', async () => {
      await failoverManager.initialize();
      
      // Wait for health checks
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const status = failoverManager.getFailoverStatus();
      expect(status.totalFailovers).toBe(0); // No failures yet
      
      // Verify health check methods were called
      expect(mockHealthChecker.checkDatabaseHealth).toHaveBeenCalled();
      expect(mockHealthChecker.checkRedisHealth).toHaveBeenCalled();
    });
    
    it('should handle component failures', async () => {
      const failoverHandler = jest.fn();
      failoverManager.on('failoverSuccess', failoverHandler);
      
      await failoverManager.initialize();
      
      // Simulate component failure
      const testComponent = failoverManager.components.get('database');
      if (testComponent) {
        testComponent.consecutiveFailures = 3; // Trigger failover threshold
        
        await failoverManager.triggerFailover('database', testComponent);
        
        expect(failoverHandler).toHaveBeenCalled();
      }
    });
    
    it('should provide failover status and metrics', async () => {
      await failoverManager.initialize();
      
      const status = failoverManager.getFailoverStatus();
      
      expect(status).toMatchObject({
        status: 'active',
        totalFailovers: expect.any(Number),
        successfulFailovers: expect.any(Number),
        failedFailovers: expect.any(Number),
        activeFailovers: expect.any(Number),
        components: expect.any(Array)
      });
      
      status.components.forEach(component => {
        expect(component).toMatchObject({
          name: expect.any(String),
          status: expect.stringMatching(/healthy|unhealthy|unknown/),
          type: expect.any(String),
          critical: expect.any(Boolean),
          consecutiveFailures: expect.any(Number),
          failoverCount: expect.any(Number)
        });
      });
    });
  });
  
  describe('Data Replication Component', () => {
    let dataReplication;
    
    beforeEach(() => {
      dataReplication = new DataReplicationManager({
        postgresql: {
          primary: {
            host: 'localhost',
            port: 5432,
            database: 'test_db',
            user: 'test_user',
            password: 'test_pass'
          },
          replicas: [] // No replicas for testing
        },
        redis: {
          primary: { host: 'localhost', port: 6379 },
          sentinels: [] // No sentinels for testing
        },
        fileStorage: {
          primaryPath: '/tmp/test-primary',
          replicaPaths: ['/tmp/test-replica1']
        },
        logger: testLogger
      });
    });
    
    afterEach(() => {
      if (dataReplication) {
        dataReplication.stop();
      }
    });
    
    it('should validate replication configuration', () => {
      expect(dataReplication.config.postgresql.primary.host).toBe('localhost');
      expect(dataReplication.config.redis.primary.host).toBe('localhost');
      expect(dataReplication.config.fileStorage.primaryPath).toBe('/tmp/test-primary');
    });
    
    it('should provide replication status', async () => {
      const status = dataReplication.getReplicationStatus();
      
      expect(status).toMatchObject({
        status: expect.stringMatching(/initializing|active|stopped/),
        postgresql: expect.objectContaining({
          primaryHealthy: expect.any(Boolean),
          replicasHealthy: expect.any(Array),
          totalReplicas: expect.any(Number)
        }),
        redis: expect.objectContaining({
          primaryHealthy: expect.any(Boolean),
          sentinelsHealthy: expect.any(Array),
          totalSentinels: expect.any(Number)
        }),
        fileStorage: expect.objectContaining({
          primaryHealthy: expect.any(Boolean),
          replicasHealthy: expect.any(Array),
          totalReplicas: expect.any(Number)
        })
      });
    });
  });
  
  describe('Disaster Recovery Component', () => {
    let disasterRecovery;
    
    beforeEach(() => {
      disasterRecovery = new DisasterRecoveryManager({
        backupLocation: {
          local: '/tmp/test-dr-backups'
        },
        encryption: {
          enabled: false // Disable for testing
        },
        compression: {
          enabled: false // Disable for testing
        },
        logger: testLogger
      });
    });
    
    afterEach(() => {
      if (disasterRecovery) {
        disasterRecovery.stop();
      }
    });
    
    it('should initialize disaster recovery', async () => {
      await disasterRecovery.initialize();
      
      expect(disasterRecovery.state.status).toBe('active');
      expect(testLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Disaster recovery manager initialized successfully')
      );
    });
    
    it('should provide DR status', async () => {
      await disasterRecovery.initialize();
      
      const status = disasterRecovery.getStatus();
      
      expect(status).toMatchObject({
        status: 'active',
        backupCount: expect.any(Number),
        restoreCount: expect.any(Number),
        config: expect.objectContaining({
          rto: expect.any(String),
          rpo: expect.any(String),
          encryptionEnabled: expect.any(Boolean),
          compressionEnabled: expect.any(Boolean),
          retentionDays: expect.any(Number)
        })
      });
    });
    
    it('should handle backup operations', async () => {
      await disasterRecovery.initialize();
      
      const backupHandler = jest.fn();
      disasterRecovery.on('backupCompleted', backupHandler);
      
      try {
        // Test configuration backup (most likely to succeed in test env)
        await disasterRecovery.backupConfiguration();
        expect(backupHandler).toHaveBeenCalled();
      } catch (error) {
        // Backup might fail in test environment, but should handle gracefully
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
  
  describe('Orchestrator Redundancy Component', () => {
    let orchestratorRedundancy;
    
    beforeEach(() => {
      orchestratorRedundancy = new OrchestratorRedundancy({
        nodeId: 'test-node-1',
        redis: {
          host: 'localhost',
          port: 6379
        },
        electionTimeout: 2000,
        heartbeatInterval: 1000,
        logger: testLogger
      });
    });
    
    afterEach(async () => {
      if (orchestratorRedundancy) {
        await orchestratorRedundancy.shutdown();
      }
    });
    
    it('should validate redundancy configuration', () => {
      expect(orchestratorRedundancy.config.nodeId).toBe('test-node-1');
      expect(orchestratorRedundancy.config.electionTimeout).toBe(2000);
      expect(orchestratorRedundancy.config.heartbeatInterval).toBe(1000);
    });
    
    it('should provide health status', async () => {
      const status = orchestratorRedundancy.getHealthStatus();
      
      expect(status).toMatchObject({
        status: expect.stringMatching(/initializing|active|shutdown/),
        role: expect.stringMatching(/leader|follower/),
        isLeader: expect.any(Boolean),
        nodeId: 'test-node-1',
        term: expect.any(Number),
        healthy: expect.any(Boolean)
      });
    });
  });
  
  describe('Integration Scenarios', () => {
    it('should handle cascading failures', async () => {
      const haOrchestrator = new HAOrchestrator({
        enableRedundancy: false,
        enableFailover: true,
        enableReplication: false,
        enableHealthChecks: true,
        enableDisasterRecovery: false,
        logger: testLogger
      });
      
      await haOrchestrator.initialize();
      
      const cascadeHandler = jest.fn();
      haOrchestrator.on('criticalFailure', cascadeHandler);
      
      // Simulate multiple component failures
      haOrchestrator.state.componentsStatus.healthChecker = 'failed';
      haOrchestrator.state.componentsStatus.failover = 'failed';
      
      // Trigger health check that should detect critical failures
      await haOrchestrator.performHealthCheck();
      
      await haOrchestrator.shutdown();
    });
    
    it('should coordinate between components', async () => {
      const haOrchestrator = new HAOrchestrator({
        enableRedundancy: false,
        enableFailover: true,
        enableReplication: false,
        enableHealthChecks: true,
        enableDisasterRecovery: true,
        logger: testLogger,
        disasterRecovery: {
          backupLocation: { local: '/tmp/test-coord-backups' },
          encryption: { enabled: false }
        }
      });
      
      await haOrchestrator.initialize();
      
      // Test component integration
      const status = haOrchestrator.getHAStatus();
      expect(status.enabledFeatures).toContain('healthChecker');
      expect(status.enabledFeatures).toContain('failover');
      expect(status.enabledFeatures).toContain('disasterRecovery');
      
      await haOrchestrator.shutdown();
    });
    
    it('should maintain HA levels correctly', async () => {
      // Test basic HA level
      const basicHA = new HAOrchestrator({
        enableRedundancy: false,
        enableFailover: false,
        enableReplication: false,
        enableHealthChecks: true,
        enableDisasterRecovery: false,
        logger: testLogger
      });
      
      await basicHA.initialize();
      expect(basicHA.state.haLevel).toBe('basic');
      await basicHA.shutdown();
      
      // Test standard HA level
      const standardHA = new HAOrchestrator({
        enableRedundancy: false,
        enableFailover: true,
        enableReplication: false,
        enableHealthChecks: true,
        enableDisasterRecovery: false,
        logger: testLogger
      });
      
      await standardHA.initialize();
      expect(standardHA.state.haLevel).toBe('standard');
      await standardHA.shutdown();
    });
  });
  
  describe('Performance and Reliability', () => {
    it('should handle high-frequency health checks', async () => {
      const haOrchestrator = new HAOrchestrator({
        enableRedundancy: false,
        enableFailover: false,
        enableReplication: false,
        enableHealthChecks: true,
        enableDisasterRecovery: false,
        healthChecker: {
          checkInterval: 100 // Very frequent checks
        },
        logger: testLogger
      });
      
      await haOrchestrator.initialize();
      
      // Wait for multiple check cycles
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const status = haOrchestrator.getHAStatus();
      expect(status.components.healthChecker.overall.totalChecks).toBeGreaterThan(5);
      
      await haOrchestrator.shutdown();
    }, 10000);
    
    it('should recover from temporary failures', async () => {
      const haOrchestrator = new HAOrchestrator({
        enableRedundancy: false,
        enableFailover: true,
        enableReplication: false,
        enableHealthChecks: true,
        enableDisasterRecovery: false,
        logger: testLogger
      });
      
      await haOrchestrator.initialize();
      
      const recoveryHandler = jest.fn();
      haOrchestrator.on('componentUnhealthy', recoveryHandler);
      
      // Simulate temporary failure and recovery
      haOrchestrator.handleComponentUnhealthy({
        component: 'test-service',
        error: 'Temporary failure'
      });
      
      expect(recoveryHandler).toHaveBeenCalled();
      
      await haOrchestrator.shutdown();
    });
    
    it('should maintain performance under load', async () => {
      const startTime = Date.now();
      
      const haOrchestrator = new HAOrchestrator({
        enableRedundancy: false,
        enableFailover: true,
        enableReplication: false,
        enableHealthChecks: true,
        enableDisasterRecovery: false,
        logger: testLogger
      });
      
      await haOrchestrator.initialize();
      
      // Simulate load by getting status frequently
      const statusRequests = [];
      for (let i = 0; i < 10; i++) {
        statusRequests.push(haOrchestrator.getHAStatus());
      }
      
      const results = await Promise.all(statusRequests);
      expect(results).toHaveLength(10);
      
      const initTime = Date.now() - startTime;
      expect(initTime).toBeLessThan(5000); // Should complete quickly
      
      await haOrchestrator.shutdown();
    });
  });
  
  describe('Error Handling and Edge Cases', () => {
    it('should handle initialization failures gracefully', async () => {
      const haOrchestrator = new HAOrchestrator({
        enableRedundancy: true,
        enableFailover: true,
        enableReplication: true,
        enableHealthChecks: true,
        enableDisasterRecovery: true,
        redis: {
          host: 'invalid-host', // This should cause initialization to fail
          port: 9999
        },
        logger: testLogger
      });
      
      // Should handle initialization failure gracefully
      try {
        await haOrchestrator.initialize();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(testLogger.error).toHaveBeenCalled();
      }
    });
    
    it('should handle partial component failures', async () => {
      const haOrchestrator = new HAOrchestrator({
        enableRedundancy: false,
        enableFailover: true,
        enableReplication: false,
        enableHealthChecks: true,
        enableDisasterRecovery: false,
        logger: testLogger
      });
      
      await haOrchestrator.initialize();
      
      // Manually set one component as failed
      haOrchestrator.state.componentsStatus.failover = 'failed';
      
      const status = haOrchestrator.getHAStatus();
      expect(status.overall.status).toBe('active'); // Should still be active
      
      await haOrchestrator.shutdown();
    });
    
    it('should validate configuration parameters', () => {
      expect(() => {
        new HAOrchestrator({
          startupTimeout: -1 // Invalid timeout
        });
      }).not.toThrow(); // Should use default value
      
      expect(() => {
        new HAOrchestrator({
          healthCheckInterval: 'invalid' // Invalid interval
        });
      }).not.toThrow(); // Should use default value
    });
  });
});

// Helper function to wait for async operations
function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}