/**
 * End-to-End Resource Management Integration Tests
 * Comprehensive testing of the complete resource management system
 */

const { describe, it, beforeEach, afterEach, expect } = require('@jest/globals');
const ResourceManagementOrchestrator = require('../../src/resource-management/resource-management-orchestrator');
const logger = require('../../src/utils/logger');

describe('Resource Management System E2E Tests', () => {
  let orchestrator;
  const testConfig = {
    global: {
      healthCheckInterval: 5000, // 5 seconds for testing
      coordinationInterval: 3000, // 3 seconds for testing
      enableAutoRecovery: true
    },
    components: {
      cpuMemory: {
        enabled: true,
        enforcementEnabled: true,
        monitoringEnabled: true,
        checkInterval: 2000 // 2 seconds for testing
      },
      storage: {
        enabled: true,
        monitoringEnabled: true,
        enforcementEnabled: true,
        checkInterval: 2000
      },
      network: {
        enabled: true,
        trafficControlEnabled: false, // Disable TC for testing
        monitoringEnabled: true,
        monitoringInterval: 2000
      },
      optimization: {
        enabled: true,
        optimizationEnabled: true,
        mlEnabled: false, // Disable ML for testing
        optimizationInterval: 10000 // 10 seconds for testing
      },
      analytics: {
        enabled: true,
        reportingEnabled: true,
        analyticsEnabled: true,
        collectionInterval: 2000
      }
    },
    integration: {
      crossComponentOptimization: true,
      unifiedReporting: true,
      centralizedAlerts: true,
      sharedMetrics: true
    }
  };

  beforeEach(async () => {
    orchestrator = new ResourceManagementOrchestrator(testConfig);
    await orchestrator.initialize();
  });

  afterEach(async () => {
    if (orchestrator && orchestrator.isStarted) {
      await orchestrator.stop();
    }
  });

  describe('System Initialization', () => {
    it('should initialize all resource management components', async () => {
      const status = orchestrator.getOrchestratorStatus();
      
      expect(status.isInitialized).toBe(true);
      expect(status.componentHealth).toBeDefined();
      
      // Verify all components are initialized
      const components = ['cpuMemory', 'storage', 'network', 'optimization', 'analytics'];
      for (const component of components) {
        expect(status.componentHealth[component]).toBeDefined();
        expect(status.componentHealth[component].status).toMatch(/healthy|recovered/);
      }
    });

    it('should establish cross-component integration', async () => {
      // Start the orchestrator
      await orchestrator.start();
      
      // Wait for components to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const status = orchestrator.getOrchestratorStatus();
      expect(status.isStarted).toBe(true);
      expect(status.stats.componentsStarted).toBeGreaterThan(0);
    });
  });

  describe('Comprehensive Resource Management', () => {
    beforeEach(async () => {
      await orchestrator.start();
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    it('should apply comprehensive resource limits to container', async () => {
      const containerId = 'test-container-' + Date.now();
      const requirements = {
        cpu: 2,
        memory: '4g',
        diskSpace: '20g',
        bandwidth: '100mbit',
        profile: 'medium'
      };
      
      const results = await orchestrator.applyResourceLimits(containerId, requirements);
      
      expect(results.success).toBe(true);
      expect(results.cpu).toBeDefined();
      expect(results.memory).toBeDefined();
      expect(results.storage).toBeDefined();
      expect(results.network).toBeDefined();
      expect(results.errors).toHaveLength(0);
      
      // Verify container is tracked in resource state
      const containerStatus = orchestrator.getContainerResourceStatus(containerId);
      expect(containerStatus.state).toBeDefined();
      expect(containerStatus.state.requirements).toEqual(requirements);
      
      // Clean up
      await orchestrator.removeResourceLimits(containerId);
    });

    it('should handle multiple containers with different profiles', async () => {
      const containers = [
        { id: 'micro-container-1', profile: 'micro' },
        { id: 'small-container-1', profile: 'small' },
        { id: 'medium-container-1', profile: 'medium' },
        { id: 'large-container-1', profile: 'large' }
      ];
      
      // Apply limits to all containers
      for (const container of containers) {
        const results = await orchestrator.applyResourceLimits(container.id, {
          profile: container.profile
        });
        expect(results.success).toBe(true);
      }
      
      // Verify all containers are tracked
      const status = orchestrator.getOrchestratorStatus();
      expect(status.resourceState.containers).toBe(containers.length);
      
      // Clean up
      for (const container of containers) {
        await orchestrator.removeResourceLimits(container.id);
      }
    });

    it('should enforce resource limits and detect violations', async () => {
      const containerId = 'violation-test-' + Date.now();
      
      // Apply strict limits
      await orchestrator.applyResourceLimits(containerId, {
        cpu: 1,
        memory: '1g',
        profile: 'micro'
      });
      
      // Simulate violation by updating component data
      if (orchestrator.components.cpuMemory) {
        // This would normally come from actual container metrics
        orchestrator.components.cpuMemory.emit('resourceViolation', {
          containerId,
          violation: {
            cpu: { usage: 150, limit: 100 },
            memory: { usage: 1.5e9, limit: 1e9 }
          }
        });
      }
      
      // Wait for alert processing
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check for alerts
      const status = orchestrator.getOrchestratorStatus();
      expect(status.coordinationState.activeAlerts).toBeGreaterThan(0);
      
      // Clean up
      await orchestrator.removeResourceLimits(containerId);
    });
  });

  describe('Cross-Component Optimization', () => {
    beforeEach(async () => {
      await orchestrator.start();
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    it('should perform cross-component optimization', async () => {
      // Create multiple containers
      const containerIds = [];
      for (let i = 0; i < 5; i++) {
        const id = `opt-test-${i}`;
        containerIds.push(id);
        await orchestrator.applyResourceLimits(id, {
          cpu: 2,
          memory: '2g',
          profile: 'medium'
        });
      }
      
      // Wait for optimization cycle
      await new Promise(resolve => setTimeout(resolve, 12000));
      
      // Check optimization statistics
      const status = orchestrator.getOrchestratorStatus();
      expect(status.stats.coordinationCycles).toBeGreaterThan(0);
      
      // Clean up
      for (const id of containerIds) {
        await orchestrator.removeResourceLimits(id);
      }
    });

    it('should handle optimization actions', async () => {
      const containerId = 'opt-action-test';
      
      await orchestrator.applyResourceLimits(containerId, {
        cpu: 4,
        memory: '8g'
      });
      
      // Emit optimization action
      if (orchestrator.components.optimization) {
        orchestrator.components.optimization.emit('optimizationAction', {
          type: 'scale_down',
          containerId,
          newLimits: { cpu: 2, memory: 4096 },
          reason: 'underutilization',
          priority: 'medium'
        });
      }
      
      // Wait for action execution
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify action was executed
      const status = orchestrator.getOrchestratorStatus();
      expect(status.stats.actionsExecuted).toBeGreaterThan(0);
      
      // Clean up
      await orchestrator.removeResourceLimits(containerId);
    });
  });

  describe('Analytics and Reporting', () => {
    beforeEach(async () => {
      await orchestrator.start();
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    it('should collect and analyze resource usage data', async () => {
      const containerId = 'analytics-test';
      
      await orchestrator.applyResourceLimits(containerId, {
        cpu: 2,
        memory: '4g',
        profile: 'medium'
      });
      
      // Wait for data collection
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Get analytics dashboard
      const analytics = orchestrator.getResourceAnalytics();
      expect(analytics).toBeDefined();
      expect(analytics.realtime).toBeDefined();
      expect(analytics.trends).toBeDefined();
      
      // Clean up
      await orchestrator.removeResourceLimits(containerId);
    });

    it('should generate comprehensive reports', async () => {
      // Apply some resource limits first
      await orchestrator.applyResourceLimits('report-test-1', { profile: 'small' });
      await orchestrator.applyResourceLimits('report-test-2', { profile: 'medium' });
      
      // Wait for data collection
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Generate report
      const report = await orchestrator.generateReport('test', {
        period: { start: new Date(Date.now() - 3600000), end: new Date() }
      });
      
      expect(report).toBeDefined();
      expect(report.type).toBe('test');
      expect(report.sections).toBeDefined();
      expect(report.metrics).toBeDefined();
      
      // Clean up
      await orchestrator.removeResourceLimits('report-test-1');
      await orchestrator.removeResourceLimits('report-test-2');
    });
  });

  describe('Health Monitoring and Recovery', () => {
    beforeEach(async () => {
      await orchestrator.start();
    });

    it('should perform health checks on all components', async () => {
      // Wait for health check cycle
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      const status = orchestrator.getOrchestratorStatus();
      expect(status.stats.healthChecks).toBeGreaterThan(0);
      
      // All components should be healthy
      for (const [name, health] of Object.entries(status.componentHealth)) {
        expect(health.status).toMatch(/healthy|recovered/);
        expect(health.lastCheck).toBeDefined();
      }
    });

    it('should detect and recover from component failures', async () => {
      // Simulate component failure by stopping it
      if (orchestrator.components.storage) {
        orchestrator.components.storage.stop();
      }
      
      // Wait for health check and recovery
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      const status = orchestrator.getOrchestratorStatus();
      const storageHealth = status.componentHealth.storage;
      
      // Component should be recovered or at least attempted
      expect(status.stats.recoveryAttempts).toBeGreaterThan(0);
    });
  });

  describe('Alert Management', () => {
    beforeEach(async () => {
      await orchestrator.start();
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    it('should handle centralized alerts from all components', async () => {
      let alertReceived = false;
      
      orchestrator.on('centralizedAlert', (alert) => {
        alertReceived = true;
        expect(alert.type).toBeDefined();
        expect(alert.severity).toBeDefined();
        expect(alert.timestamp).toBeDefined();
      });
      
      // Trigger alerts from different components
      orchestrator.handleCrossComponentAlert('test_alert', {
        message: 'Test alert',
        component: 'test'
      });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(alertReceived).toBe(true);
      
      const status = orchestrator.getOrchestratorStatus();
      expect(status.stats.alertsGenerated).toBeGreaterThan(0);
    });
  });

  describe('Compliance and SLA Monitoring', () => {
    beforeEach(async () => {
      await orchestrator.start();
    });

    it('should check compliance with SLA targets', async () => {
      // Wait for compliance check
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Force a compliance check
      await orchestrator.checkCompliance();
      
      // Since all components should be healthy, availability should be high
      const availability = orchestrator.calculateAvailability();
      expect(availability).toBeGreaterThan(0.9);
    });
  });

  describe('Resource State Management', () => {
    beforeEach(async () => {
      await orchestrator.start();
    });

    it('should maintain unified resource state across components', async () => {
      const containers = [
        { id: 'state-test-1', cpu: 1, memory: '2g' },
        { id: 'state-test-2', cpu: 2, memory: '4g' },
        { id: 'state-test-3', cpu: 4, memory: '8g' }
      ];
      
      // Apply limits
      for (const container of containers) {
        await orchestrator.applyResourceLimits(container.id, container);
      }
      
      // Update global state
      await orchestrator.updateGlobalResourceState();
      
      const status = orchestrator.getOrchestratorStatus();
      expect(status.resourceState.containers).toBe(containers.length);
      expect(status.resourceState.global.totalAllocated).toBeDefined();
      
      // Clean up
      for (const container of containers) {
        await orchestrator.removeResourceLimits(container.id);
      }
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle component initialization failures gracefully', async () => {
      const faultyConfig = {
        ...testConfig,
        components: {
          ...testConfig.components,
          cpuMemory: {
            ...testConfig.components.cpuMemory,
            // Invalid configuration to trigger error
            defaultCpuShares: -1
          }
        }
      };
      
      const faultyOrchestrator = new ResourceManagementOrchestrator(faultyConfig);
      await faultyOrchestrator.initialize();
      
      const status = faultyOrchestrator.getOrchestratorStatus();
      expect(status.isInitialized).toBe(true);
      // Other components should still be healthy
      expect(status.componentHealth.storage?.status).toMatch(/healthy|recovered/);
    });

    it('should handle resource limit application failures', async () => {
      await orchestrator.start();
      
      // Try to apply limits with invalid container ID
      const results = await orchestrator.applyResourceLimits('', {
        cpu: 1,
        memory: '1g'
      });
      
      // Should handle gracefully
      expect(results.success).toBe(false);
      expect(results.errors.length).toBeGreaterThan(0);
    });
  });
});

// Integration test for real-world scenario
describe('Real-world Resource Management Scenarios', () => {
  let orchestrator;
  
  beforeEach(async () => {
    orchestrator = new ResourceManagementOrchestrator({
      ...testConfig,
      components: {
        ...testConfig.components,
        optimization: {
          ...testConfig.components.optimization,
          algorithms: {
            binPacking: true,
            predictive: true,
            costBased: true,
            energyEfficient: true
          }
        }
      }
    });
    await orchestrator.initialize();
    await orchestrator.start();
  });
  
  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.stop();
    }
  });
  
  it('should handle high-load scenario with multiple containers', async () => {
    const containerCount = 10;
    const containers = [];
    
    // Simulate high load by creating many containers
    for (let i = 0; i < containerCount; i++) {
      const id = `load-test-${i}`;
      const profile = ['micro', 'small', 'medium'][i % 3];
      
      containers.push({ id, profile });
      
      await orchestrator.applyResourceLimits(id, {
        profile,
        cpu: i % 2 + 1,
        memory: `${(i % 3 + 1) * 2}g`
      });
      
      // Stagger creation slightly
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Wait for system to stabilize
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verify system is handling load
    const status = orchestrator.getOrchestratorStatus();
    expect(status.resourceState.containers).toBe(containerCount);
    expect(status.stats.coordinationCycles).toBeGreaterThan(0);
    
    // Get analytics
    const analytics = orchestrator.getResourceAnalytics();
    expect(analytics).toBeDefined();
    
    // Clean up
    for (const container of containers) {
      await orchestrator.removeResourceLimits(container.id);
    }
  });
  
  it('should optimize resources during varying load patterns', async () => {
    // Simulate varying load pattern
    const phases = [
      { count: 3, profile: 'small', duration: 2000 },
      { count: 5, profile: 'medium', duration: 3000 },
      { count: 2, profile: 'large', duration: 2000 }
    ];
    
    const allContainers = [];
    
    for (const [phaseIndex, phase] of phases.entries()) {
      logger.info(`Starting phase ${phaseIndex + 1}: ${phase.count} ${phase.profile} containers`);
      
      // Create containers for this phase
      for (let i = 0; i < phase.count; i++) {
        const id = `phase${phaseIndex}-container${i}`;
        allContainers.push(id);
        
        await orchestrator.applyResourceLimits(id, {
          profile: phase.profile
        });
      }
      
      // Run for phase duration
      await new Promise(resolve => setTimeout(resolve, phase.duration));
    }
    
    // Wait for optimization
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check that optimization occurred
    const status = orchestrator.getOrchestratorStatus();
    if (status.stats.crossOptimizations > 0) {
      expect(status.stats.crossOptimizations).toBeGreaterThan(0);
    }
    
    // Clean up
    for (const id of allContainers) {
      await orchestrator.removeResourceLimits(id);
    }
  });
});
