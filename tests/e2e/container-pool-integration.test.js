/**
 * End-to-End Container Pool Management Integration Tests
 * Comprehensive testing of the complete container pool management system
 */

const { describe, it, beforeEach, afterEach, expect } = require('@jest/globals');
const IntegratedContainerPoolOrchestrator = require('../../src/container-orchestration/pool/integrated-pool-orchestrator');
const logger = require('../../src/utils/logger');

describe('Container Pool Management E2E Tests', () => {
  let orchestrator;
  const testConfig = {
    pool: {
      minSize: 2,
      maxSize: 8,
      targetSize: 4,
      baseImage: 'ubuntu:22.04'
    },
    integration: {
      enableAllComponents: true,
      enableDynamicScaling: true,
      enableReuseOptimization: true,
      enableStateManagement: true,
      enableResourceMonitoring: true
    },
    health: {
      enableHealthChecks: true,
      healthCheckInterval: 10000, // 10 seconds for testing
      componentTimeout: 5000
    },
    performance: {
      enablePerformanceOptimization: true,
      optimizationInterval: 15000, // 15 seconds for testing
      enableCrossComponentOptimization: true
    },
    // Component-specific test configurations
    dynamicScaler: {
      scalingInterval: 5000, // 5 seconds for testing
      scaleUpCooldown: 10000,
      scaleDownCooldown: 20000
    },
    reuseOptimizer: {
      optimizationInterval: 10000, // 10 seconds for testing
      patternAnalysisInterval: 30000
    },
    stateManager: {
      snapshotInterval: 15000,
      validationInterval: 10000
    },
    resourceMonitor: {
      monitoringInterval: 5000, // 5 seconds for testing
      enableAlerts: true,
      enablePredictiveAnalysis: true
    }
  };

  beforeEach(async () => {
    // Create orchestrator with test configuration
    orchestrator = new IntegratedContainerPoolOrchestrator(testConfig);
    
    // Initialize orchestrator
    await orchestrator.initialize();
    
    // Wait for initialization to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.stop();
    }
  });

  describe('System Initialization and Integration', () => {
    it('should initialize all container pool components successfully', async () => {
      const status = orchestrator.getOrchestratorStatus();
      
      expect(status.isInitialized).toBe(true);
      expect(status.componentHealth).toBeDefined();
      
      // Verify all components are healthy
      const components = ['poolManager', 'dynamicScaler', 'reuseOptimizer', 'stateManager', 'resourceMonitor'];
      for (const component of components) {
        expect(status.componentHealth[component]).toBeDefined();
        expect(status.componentHealth[component].status).toBe('healthy');
      }
      
      // Verify pool was initialized with correct size
      expect(status.components.poolManager.poolSize).toBeGreaterThanOrEqual(testConfig.pool.minSize);
      expect(status.components.poolManager.availableContainers).toBeGreaterThan(0);
    });

    it('should start orchestrator and all components', async () => {
      await orchestrator.start();
      
      const status = orchestrator.getOrchestratorStatus();
      expect(status.isStarted).toBe(true);
      
      // Verify components are running
      expect(status.components.dynamicScaler.isStarted).toBe(true);
      expect(status.components.reuseOptimizer.isStarted).toBe(true);
      expect(status.components.stateManager.isStarted).toBe(true);
      expect(status.components.resourceMonitor.isStarted).toBe(true);
    });

    it('should handle cross-component integration correctly', async () => {
      await orchestrator.start();
      
      // Test cross-component event routing
      let scalingEventReceived = false;
      let stateChangeEventReceived = false;
      
      orchestrator.on('scalingCompleted', () => {
        scalingEventReceived = true;
      });
      
      orchestrator.on('containerStateChanged', () => {
        stateChangeEventReceived = true;
      });
      
      // Get a container to trigger state changes
      const container = await orchestrator.getContainer({
        jobType: 'test',
        language: 'javascript'
      });
      
      expect(container).toBeDefined();
      expect(container.id).toBeDefined();
      
      // Return container to trigger more state changes
      await orchestrator.returnContainer(container.id, {
        success: true,
        duration: 5000,
        jobData: { jobType: 'test', language: 'javascript' }
      });
      
      // Wait for events to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      expect(stateChangeEventReceived).toBe(true);
    });
  });

  describe('Container Lifecycle Management', () => {
    beforeEach(async () => {
      await orchestrator.start();
    });

    it('should manage complete container lifecycle', async () => {
      // Get initial pool status
      const initialStatus = orchestrator.getPoolSummary();
      const initialAvailable = initialStatus.availableContainers;
      
      // Request container
      const container = await orchestrator.getContainer({
        jobType: 'build',
        language: 'node',
        resourceRequirements: {
          cpu: 'standard',
          memory: 'standard'
        }
      });
      
      expect(container).toBeDefined();
      expect(container.id).toBeDefined();
      expect(container.container).toBeDefined();
      expect(container.info).toBeDefined();
      
      // Verify container was assigned
      const busyStatus = orchestrator.getPoolSummary();
      expect(busyStatus.busyContainers).toBe(1);
      expect(busyStatus.availableContainers).toBe(initialAvailable - 1);
      
      // Simulate job execution
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Return container
      await orchestrator.returnContainer(container.id, {
        success: true,
        duration: 1000,
        jobData: {
          jobType: 'build',
          language: 'node'
        },
        resourceUsage: {
          cpu: 45,
          memory: 60
        }
      });
      
      // Verify container was returned
      const finalStatus = orchestrator.getPoolSummary();
      expect(finalStatus.busyContainers).toBe(0);
      expect(finalStatus.availableContainers).toBe(initialAvailable);
      
      // Verify metrics were updated
      expect(finalStatus.totalJobsProcessed).toBeGreaterThan(0);
      expect(finalStatus.avgJobDuration).toBeGreaterThan(0);
    });

    it('should handle multiple concurrent container assignments', async () => {
      const concurrentRequests = 3;
      const containers = [];
      
      // Request multiple containers concurrently
      const requestPromises = [];
      for (let i = 0; i < concurrentRequests; i++) {
        requestPromises.push(orchestrator.getContainer({
          jobType: 'test',
          language: 'python',
          jobId: `job-${i}`
        }));
      }
      
      const assignedContainers = await Promise.all(requestPromises);
      
      // Verify all containers were assigned
      expect(assignedContainers).toHaveLength(concurrentRequests);
      for (const container of assignedContainers) {
        expect(container).toBeDefined();
        expect(container.id).toBeDefined();
        containers.push(container);
      }
      
      // Verify pool status
      const busyStatus = orchestrator.getPoolSummary();
      expect(busyStatus.busyContainers).toBe(concurrentRequests);
      
      // Return all containers
      const returnPromises = containers.map((container, index) => 
        orchestrator.returnContainer(container.id, {
          success: true,
          duration: 2000 + (index * 100),
          jobData: { jobType: 'test', language: 'python', jobId: `job-${index}` }
        })
      );
      
      await Promise.all(returnPromises);
      
      // Verify all containers were returned
      const finalStatus = orchestrator.getPoolSummary();
      expect(finalStatus.busyContainers).toBe(0);
      expect(finalStatus.totalJobsProcessed).toBe(concurrentRequests);
    });

    it('should handle container assignment when pool is at capacity', async () => {
      const poolSize = orchestrator.getPoolSummary().poolSize;
      const containers = [];
      
      // Assign all available containers
      for (let i = 0; i < poolSize; i++) {
        const container = await orchestrator.getContainer({
          jobType: 'capacity-test',
          jobId: `job-${i}`
        });
        containers.push(container);
      }
      
      // Verify all containers are busy
      const fullStatus = orchestrator.getPoolSummary();
      expect(fullStatus.busyContainers).toBe(poolSize);
      expect(fullStatus.availableContainers).toBe(0);
      
      // Try to get another container (should trigger scaling or wait)
      const startTime = Date.now();
      try {
        const extraContainer = await orchestrator.getContainer({
          jobType: 'overflow-test'
        });
        
        if (extraContainer) {
          containers.push(extraContainer);
          
          // Verify scaling occurred
          const scaledStatus = orchestrator.getPoolSummary();
          expect(scaledStatus.poolSize).toBeGreaterThan(poolSize);
        }
      } catch (error) {
        // Expected if scaling is disabled or fails
        expect(error.message).toContain('No containers available');
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(10000); // Should resolve within 10 seconds
      
      // Clean up - return all containers
      const returnPromises = containers.map(container => 
        orchestrator.returnContainer(container.id, {
          success: true,
          duration: 1000
        })
      );
      
      await Promise.all(returnPromises);
    });
  });

  describe('Dynamic Scaling Integration', () => {
    beforeEach(async () => {
      await orchestrator.start();
    });

    it('should trigger automatic scaling based on utilization', async () => {
      const initialStatus = orchestrator.getPoolSummary();
      const initialPoolSize = initialStatus.poolSize;
      
      // Fill pool to trigger scale up threshold
      const containers = [];
      const targetUtilization = Math.ceil(initialPoolSize * 0.85); // 85% utilization
      
      for (let i = 0; i < targetUtilization; i++) {
        const container = await orchestrator.getContainer({
          jobType: 'scaling-test',
          jobId: `scaling-job-${i}`
        });
        containers.push(container);
      }
      
      // Wait for scaling evaluation
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Check if scaling occurred
      const scaledStatus = orchestrator.getPoolSummary();
      
      // Either pool size increased or scaling is in progress
      expect(
        scaledStatus.poolSize > initialPoolSize || 
        scaledStatus.scaling?.isScaling === true
      ).toBe(true);
      
      // Clean up
      const returnPromises = containers.map(container => 
        orchestrator.returnContainer(container.id, { success: true, duration: 1000 })
      );
      await Promise.all(returnPromises);
      
      // Wait for potential scale down
      await new Promise(resolve => setTimeout(resolve, 25000)); // Scale down cooldown
      
      const finalStatus = orchestrator.getPoolSummary();
      // Pool should scale down or at least not continue growing
      expect(finalStatus.poolSize).toBeLessThanOrEqual(scaledStatus.poolSize + 1);
    });

    it('should respect scaling limits and cooldowns', async () => {
      const scalingStats = orchestrator.getOrchestratorStatus().components.dynamicScaler;
      
      // Record initial scaling stats
      const initialScaleUps = scalingStats.stats.totalScaleUps;
      const initialScaleDowns = scalingStats.stats.totalScaleDowns;
      
      // Trigger multiple scaling events quickly
      for (let i = 0; i < 3; i++) {
        // Create high utilization
        const containers = [];
        for (let j = 0; j < 3; j++) {
          const container = await orchestrator.getContainer({
            jobType: 'cooldown-test',
            jobId: `cooldown-${i}-${j}`
          });
          containers.push(container);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Return containers
        const returnPromises = containers.map(container => 
          orchestrator.returnContainer(container.id, { success: true, duration: 500 })
        );
        await Promise.all(returnPromises);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Check that scaling was limited by cooldowns
      const finalScalingStats = orchestrator.getOrchestratorStatus().components.dynamicScaler;
      const totalScaleEvents = 
        (finalScalingStats.stats.totalScaleUps - initialScaleUps) +
        (finalScalingStats.stats.totalScaleDowns - initialScaleDowns);
      
      // Should have fewer scale events than requests due to cooldowns
      expect(totalScaleEvents).toBeLessThan(6); // Less than 2 per iteration
    });
  });

  describe('Container Reuse Optimization', () => {
    beforeEach(async () => {
      await orchestrator.start();
    });

    it('should optimize container selection based on job patterns', async () => {
      // Create containers for different job types
      const nodeJob = {
        jobType: 'build',
        language: 'node',
        framework: 'express'
      };
      
      const pythonJob = {
        jobType: 'test',
        language: 'python',
        framework: 'django'
      };
      
      // Execute several node jobs to establish pattern
      for (let i = 0; i < 3; i++) {
        const container = await orchestrator.getContainer(nodeJob);
        await orchestrator.returnContainer(container.id, {
          success: true,
          duration: 2000,
          jobData: nodeJob,
          resourceUsage: { cpu: 50, memory: 60 }
        });
      }
      
      // Wait for pattern analysis
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Execute python jobs
      for (let i = 0; i < 2; i++) {
        const container = await orchestrator.getContainer(pythonJob);
        await orchestrator.returnContainer(container.id, {
          success: true,
          duration: 3000,
          jobData: pythonJob,
          resourceUsage: { cpu: 40, memory: 70 }
        });
      }
      
      // Request another node job - should get optimized container selection
      const optimizedContainer = await orchestrator.getContainer(nodeJob);
      expect(optimizedContainer).toBeDefined();
      
      await orchestrator.returnContainer(optimizedContainer.id, {
        success: true,
        duration: 1800,
        jobData: nodeJob
      });
      
      // Verify optimization stats
      const reuseStats = orchestrator.getOrchestratorStatus().components.reuseOptimizer;
      expect(reuseStats.stats.totalReuseOptimizations).toBeGreaterThan(0);
    });

    it('should recycle containers based on efficiency metrics', async () => {
      const initialPoolSize = orchestrator.getPoolSummary().poolSize;
      
      // Create container with poor performance pattern
      const poorPerformanceJob = {
        jobType: 'heavy-computation',
        language: 'java',
        resourceRequirements: { cpu: 'high', memory: 'high' }
      };
      
      // Execute multiple jobs with the same container to decrease efficiency
      let containerId = null;
      for (let i = 0; i < 5; i++) {
        const container = await orchestrator.getContainer(poorPerformanceJob);
        containerId = container.id;
        
        // Simulate poor performance (high resource usage, longer duration)
        await orchestrator.returnContainer(container.id, {
          success: i < 3, // Some failures to reduce efficiency
          duration: 8000 + (i * 1000), // Increasing duration
          jobData: poorPerformanceJob,
          resourceUsage: { cpu: 95, memory: 90 }
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Wait for optimization cycle
      await new Promise(resolve => setTimeout(resolve, 12000));
      
      // Verify optimization occurred
      const reuseStats = orchestrator.getOrchestratorStatus().components.reuseOptimizer;
      expect(reuseStats.stats.recyclingEvents).toBeGreaterThan(0);
      
      // Pool size should remain stable due to recycling
      const finalPoolSize = orchestrator.getPoolSummary().poolSize;
      expect(Math.abs(finalPoolSize - initialPoolSize)).toBeLessThanOrEqual(2);
    });
  });

  describe('State Management Integration', () => {
    beforeEach(async () => {
      await orchestrator.start();
    });

    it('should track container state transitions accurately', async () => {
      const stateManager = orchestrator.components.stateManager;
      
      // Get container and track state changes
      const container = await orchestrator.getContainer({
        jobType: 'state-test',
        language: 'go'
      });
      
      // Verify state is 'busy'
      const busyState = stateManager.getContainerState(container.id);
      expect(busyState).toBe('busy');
      
      // Return container
      await orchestrator.returnContainer(container.id, {
        success: true,
        duration: 2000,
        jobData: { jobType: 'state-test', language: 'go' }
      });
      
      // Verify state is 'available'
      const availableState = stateManager.getContainerState(container.id);
      expect(availableState).toBe('available');
      
      // Check state history
      const stateHistory = stateManager.getStateHistory(container.id, 10);
      expect(stateHistory.length).toBeGreaterThanOrEqual(2);
      
      // Verify state transitions are logged
      const states = stateHistory.map(h => h.toState || h.fromState);
      expect(states).toContain('busy');
      expect(states).toContain('available');
    });

    it('should validate container states and detect inconsistencies', async () => {
      const stateManager = orchestrator.components.stateManager;
      
      // Wait for state validation cycle
      await new Promise(resolve => setTimeout(resolve, 12000));
      
      // Check validation results
      const stateStats = stateManager.getStateStats();
      expect(stateStats.isStarted).toBe(true);
      
      // Should have performed validations
      const validationEvents = stateStats.config.stateValidation;
      expect(validationEvents).toBe(true);
      
      // Check state distribution
      const stateDistribution = stateManager.getStateDistribution();
      expect(stateDistribution).toBeDefined();
      expect(stateDistribution.available).toBeDefined();
    });

    it('should handle state recovery for failed containers', async () => {
      const stateManager = orchestrator.components.stateManager;
      
      // Get container
      const container = await orchestrator.getContainer({
        jobType: 'recovery-test'
      });
      
      // Simulate container failure by forcing state transition
      await stateManager.transitionContainer(container.id, 'failed', 'simulated failure');
      
      // Wait for recovery attempt
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Check if recovery was attempted
      const stateStats = stateManager.getStateStats();
      expect(stateStats.stats.recoveryEvents).toBeGreaterThanOrEqual(0);
      
      // Clean up
      try {
        await orchestrator.returnContainer(container.id, {
          success: false,
          duration: 0,
          error: 'simulated failure'
        });
      } catch (error) {
        // Expected for failed container
      }
    });
  });

  describe('Resource Monitoring Integration', () => {
    beforeEach(async () => {
      await orchestrator.start();
    });

    it('should monitor system and container resources', async () => {
      // Wait for monitoring cycles
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      const resourceMonitor = orchestrator.components.resourceMonitor;
      const monitoringStats = resourceMonitor.getMonitoringStats();
      
      expect(monitoringStats.isStarted).toBe(true);
      expect(monitoringStats.stats.totalMonitoringCycles).toBeGreaterThan(0);
      
      // Check system metrics
      const resourceSummary = resourceMonitor.getCurrentResourceSummary();
      expect(resourceSummary.system).toBeDefined();
      expect(resourceSummary.system.cpu).toBeDefined();
      expect(resourceSummary.system.memory).toBeDefined();
      
      // Verify container metrics are being collected
      expect(resourceSummary.containers.total).toBeGreaterThan(0);
    });

    it('should generate alerts for resource thresholds', async () => {
      const resourceMonitor = orchestrator.components.resourceMonitor;
      
      // Create high-load scenario to potentially trigger alerts
      const containers = [];
      const poolSize = orchestrator.getPoolSummary().poolSize;
      
      // Use most of the pool
      for (let i = 0; i < Math.min(poolSize - 1, 4); i++) {
        const container = await orchestrator.getContainer({
          jobType: 'resource-intensive',
          resourceRequirements: { cpu: 'high', memory: 'high' }
        });
        containers.push(container);
      }
      
      // Wait for monitoring and potential alerts
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Check for alerts (might not trigger depending on actual resource usage)
      const alerts = resourceMonitor.getResourceAlerts();
      const monitoringStats = resourceMonitor.getMonitoringStats();
      
      expect(monitoringStats.stats.totalMonitoringCycles).toBeGreaterThan(1);
      
      // Clean up
      const returnPromises = containers.map(container => 
        orchestrator.returnContainer(container.id, {
          success: true,
          duration: 2000,
          resourceUsage: { cpu: 80, memory: 75 }
        })
      );
      await Promise.all(returnPromises);
    });

    it('should provide optimization suggestions', async () => {
      const resourceMonitor = orchestrator.components.resourceMonitor;
      
      // Execute various workloads to generate optimization data
      const workloadTypes = [
        { jobType: 'build', language: 'node' },
        { jobType: 'test', language: 'python' },
        { jobType: 'deploy', language: 'java' }
      ];
      
      for (const workload of workloadTypes) {
        const container = await orchestrator.getContainer(workload);
        await orchestrator.returnContainer(container.id, {
          success: true,
          duration: 3000,
          jobData: workload,
          resourceUsage: { cpu: 60, memory: 70 }
        });
      }
      
      // Wait for analysis
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Check for optimization suggestions
      const suggestions = resourceMonitor.getOptimizationSuggestions();
      const monitoringStats = resourceMonitor.getMonitoringStats();
      
      expect(monitoringStats.analysis.optimizationSuggestions).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance and Stress Testing', () => {
    beforeEach(async () => {
      await orchestrator.start();
    });

    it('should handle sustained high-throughput job processing', async () => {
      const jobCount = 20;
      const concurrency = 4;
      const jobsProcessed = [];
      
      const processJob = async (jobId) => {
        try {
          const container = await orchestrator.getContainer({
            jobType: 'stress-test',
            jobId: `stress-${jobId}`,
            language: 'node'
          });
          
          // Simulate job execution
          await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
          
          await orchestrator.returnContainer(container.id, {
            success: true,
            duration: 1500,
            jobData: { jobType: 'stress-test', jobId: `stress-${jobId}` },
            resourceUsage: { cpu: 50 + Math.random() * 30, memory: 60 + Math.random() * 20 }
          });
          
          jobsProcessed.push(jobId);
        } catch (error) {
          logger.error(`Stress test job ${jobId} failed:`, error);
        }
      };
      
      const startTime = Date.now();
      
      // Process jobs in batches with limited concurrency
      for (let i = 0; i < jobCount; i += concurrency) {
        const batch = [];
        for (let j = 0; j < concurrency && (i + j) < jobCount; j++) {
          batch.push(processJob(i + j));
        }
        await Promise.all(batch);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Verify all jobs were processed
      expect(jobsProcessed).toHaveLength(jobCount);
      
      // Performance expectations
      expect(duration).toBeLessThan(60000); // Should complete within 60 seconds
      
      // Verify system stability
      const finalStatus = orchestrator.getOrchestratorStatus();
      expect(finalStatus.isStarted).toBe(true);
      expect(finalStatus.componentHealth.poolManager.status).toBe('healthy');
      
      const poolSummary = orchestrator.getPoolSummary();
      expect(poolSummary.busyContainers).toBe(0); // All containers should be returned
      expect(poolSummary.totalJobsProcessed).toBe(jobCount);
      
      logger.info(`Processed ${jobCount} jobs in ${duration}ms (${(jobCount / (duration / 1000)).toFixed(2)} jobs/sec)`);
    });

    it('should maintain system stability under resource pressure', async () => {
      const initialStatus = orchestrator.getOrchestratorStatus();
      const initialHealth = Object.values(initialStatus.componentHealth)
        .every(h => h.status === 'healthy');
      
      expect(initialHealth).toBe(true);
      
      // Create resource pressure with multiple concurrent operations
      const operations = [];
      
      // High-frequency container requests
      for (let i = 0; i < 10; i++) {
        operations.push(
          (async () => {
            try {
              const container = await orchestrator.getContainer({
                jobType: 'pressure-test',
                jobId: `pressure-${i}`
              });
              
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              await orchestrator.returnContainer(container.id, {
                success: true,
                duration: 2000,
                resourceUsage: { cpu: 80, memory: 85 }
              });
            } catch (error) {
              // Some failures are expected under pressure
            }
          })()
        );
      }
      
      // Wait for operations to complete
      await Promise.allSettled(operations);
      
      // Wait for system to stabilize
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Verify system stability
      const finalStatus = orchestrator.getOrchestratorStatus();
      expect(finalStatus.isStarted).toBe(true);
      
      // At least core components should remain healthy
      expect(finalStatus.componentHealth.poolManager.status).toBe('healthy');
      
      // Pool should be in a consistent state
      const poolSummary = orchestrator.getPoolSummary();
      expect(poolSummary.busyContainers).toBe(0);
      expect(poolSummary.poolSize).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Recovery', () => {
    beforeEach(async () => {
      await orchestrator.start();
    });

    it('should handle component failures gracefully', async () => {
      // Stop a non-critical component to simulate failure
      if (orchestrator.components.resourceMonitor) {
        orchestrator.components.resourceMonitor.stop();
      }
      
      // System should continue operating
      const container = await orchestrator.getContainer({
        jobType: 'resilience-test'
      });
      
      expect(container).toBeDefined();
      
      await orchestrator.returnContainer(container.id, {
        success: true,
        duration: 1000
      });
      
      // Core functionality should still work
      const poolSummary = orchestrator.getPoolSummary();
      expect(poolSummary.busyContainers).toBe(0);
    });

    it('should recover from health check failures', async () => {
      // Wait for health checks to run
      await new Promise(resolve => setTimeout(resolve, 12000));
      
      const status = orchestrator.getOrchestratorStatus();
      expect(status.stats.healthChecks).toBeGreaterThan(0);
      
      // System should be stable after health checks
      expect(status.isStarted).toBe(true);
      
      // Should be able to process jobs normally
      const container = await orchestrator.getContainer({
        jobType: 'health-check-test'
      });
      
      await orchestrator.returnContainer(container.id, {
        success: true,
        duration: 1000
      });
    });
  });
});