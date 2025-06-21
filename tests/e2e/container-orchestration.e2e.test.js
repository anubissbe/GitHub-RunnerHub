/**
 * Container Orchestration E2E Tests
 * Comprehensive end-to-end testing of the container orchestration system
 */

const { ContainerOrchestrator } = require('../../src/container-orchestration');
const Docker = require('dockerode');
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);

describe('Container Orchestration E2E Tests', () => {
  let orchestrator;
  let docker;
  
  const testConfig = {
    baseImage: 'node:18-alpine', // Use a lightweight test image
    networkName: 'test-github-runners',
    maxContainers: 3,
    minContainers: 1,
    resourceLimits: {
      memory: '134217728', // 128MB for testing
      cpus: '0.5'
    },
    monitoringInterval: 5000, // 5 seconds for faster testing
    cleanupInterval: 10000, // 10 seconds for faster testing
    scaleCheckInterval: 5000,
    jobQueueCheckInterval: 3000
  };

  beforeAll(async () => {
    // Initialize Docker client
    docker = new Docker();
    
    // Verify Docker is available
    try {
      await docker.ping();
    } catch (error) {
      throw new Error('Docker daemon not available. Please ensure Docker is running.');
    }
    
    // Pull test image if not available
    try {
      const images = await docker.listImages();
      const imageExists = images.some(img => 
        img.RepoTags && img.RepoTags.includes(testConfig.baseImage)
      );
      
      if (!imageExists) {
        console.log(`Pulling test image: ${testConfig.baseImage}`);
        await new Promise((resolve, reject) => {
          docker.pull(testConfig.baseImage, (err, stream) => {
            if (err) return reject(err);
            docker.modem.followProgress(stream, (err, res) => {
              if (err) return reject(err);
              resolve(res);
            });
          });
        });
      }
    } catch (error) {
      console.warn('Could not verify/pull test image:', error.message);
    }
    
    // Initialize orchestrator
    orchestrator = new ContainerOrchestrator(testConfig);
    
    // Clean up any existing test containers
    await cleanupTestContainers();
  }, 60000);

  afterAll(async () => {
    if (orchestrator) {
      try {
        await orchestrator.stop();
      } catch (error) {
        console.warn('Error stopping orchestrator:', error.message);
      }
    }
    
    // Clean up test containers and network
    await cleanupTestContainers();
    await cleanupTestNetwork();
  }, 30000);

  beforeEach(async () => {
    // Clean up between tests
    await cleanupTestContainers();
  });

  afterEach(async () => {
    // Clean up after each test
    await cleanupTestContainers();
  });

  describe('Orchestrator Initialization', () => {
    test('should initialize successfully', async () => {
      await orchestrator.initialize();
      
      const status = orchestrator.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.running).toBe(false);
    });

    test('should start and create minimum containers', async () => {
      await orchestrator.initialize();
      await orchestrator.start();
      
      // Wait for minimum containers to be created
      await waitForCondition(
        () => orchestrator.getStatus().containers.active >= testConfig.minContainers,
        10000,
        'Minimum containers to be created'
      );
      
      const status = orchestrator.getStatus();
      expect(status.running).toBe(true);
      expect(status.containers.active).toBeGreaterThanOrEqual(testConfig.minContainers);
      
      await orchestrator.stop();
    }, 30000);
  });

  describe('Job Execution', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
      await orchestrator.start();
      
      // Wait for orchestrator to be ready
      await waitForCondition(
        () => orchestrator.getStatus().containers.active >= 1,
        15000,
        'At least one container to be ready'
      );
    });

    afterEach(async () => {
      await orchestrator.stop();
    });

    test('should execute a simple job successfully', async () => {
      const jobId = 'test-job-simple';
      const jobConfig = {
        steps: ['echo "Hello World"', 'echo "Job completed"'],
        timeout: 30000
      };

      let jobCompleted = false;
      let jobResult = null;

      // Listen for job completion
      orchestrator.once('jobCompleted', (event) => {
        jobCompleted = true;
        jobResult = event;
      });

      // Submit job
      await orchestrator.submitJob(jobId, jobConfig);

      // Wait for job completion
      await waitForCondition(
        () => jobCompleted,
        30000,
        'Job to complete'
      );

      expect(jobResult).not.toBeNull();
      expect(jobResult.jobId).toBe(jobId);
      expect(jobResult.success).toBe(true);
      expect(jobResult.duration).toBeGreaterThan(0);
    }, 45000);

    test('should handle multiple concurrent jobs', async () => {
      const jobCount = 3;
      const jobs = [];
      const completedJobs = [];

      // Listen for job completions
      orchestrator.on('jobCompleted', (event) => {
        completedJobs.push(event);
      });

      // Submit multiple jobs
      for (let i = 0; i < jobCount; i++) {
        const jobId = `test-job-concurrent-${i}`;
        const jobConfig = {
          steps: [
            `echo "Job ${i} starting"`,
            `sleep 2`,
            `echo "Job ${i} completed"`
          ],
          timeout: 30000
        };
        
        jobs.push({ jobId, jobConfig });
        await orchestrator.submitJob(jobId, jobConfig);
      }

      // Wait for all jobs to complete
      await waitForCondition(
        () => completedJobs.length >= jobCount,
        60000,
        'All concurrent jobs to complete'
      );

      expect(completedJobs).toHaveLength(jobCount);
      completedJobs.forEach(result => {
        expect(result.success).toBe(true);
      });
    }, 90000);

    test('should handle job failures correctly', async () => {
      const jobId = 'test-job-failure';
      const jobConfig = {
        steps: ['echo "Before failure"', 'exit 1', 'echo "After failure"'],
        timeout: 30000
      };

      let jobFailed = false;
      let jobFailureEvent = null;

      // Listen for job failure
      orchestrator.once('jobFailed', (event) => {
        jobFailed = true;
        jobFailureEvent = event;
      });

      // Submit failing job
      await orchestrator.submitJob(jobId, jobConfig);

      // Wait for job failure
      await waitForCondition(
        () => jobFailed,
        30000,
        'Job to fail'
      );

      expect(jobFailureEvent).not.toBeNull();
      expect(jobFailureEvent.jobId).toBe(jobId);
    }, 45000);
  });

  describe('Container Scaling', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
      await orchestrator.start();
      
      // Wait for initial setup
      await waitForCondition(
        () => orchestrator.getStatus().containers.active >= 1,
        15000,
        'Initial containers to be ready'
      );
    });

    afterEach(async () => {
      await orchestrator.stop();
    });

    test('should scale up when job queue grows', async () => {
      const initialContainers = orchestrator.getStatus().containers.active;
      
      // Submit multiple jobs to trigger scaling
      const jobPromises = [];
      for (let i = 0; i < testConfig.scaleUpThreshold + 1; i++) {
        const jobId = `scale-test-job-${i}`;
        jobPromises.push(orchestrator.submitJob(jobId, {
          steps: ['sleep 10'], // Long-running job to keep containers busy
          timeout: 30000
        }));
      }
      
      await Promise.all(jobPromises);
      
      // Wait for scaling to occur
      await waitForCondition(
        () => orchestrator.getStatus().containers.active > initialContainers,
        20000,
        'Containers to scale up'
      );
      
      const finalContainers = orchestrator.getStatus().containers.active;
      expect(finalContainers).toBeGreaterThan(initialContainers);
      expect(finalContainers).toBeLessThanOrEqual(testConfig.maxContainers);
    }, 60000);
  });

  describe('Health Monitoring', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
      await orchestrator.start();
      
      // Wait for monitoring to start
      await waitForCondition(
        () => orchestrator.getStatus().containers.active >= 1,
        15000,
        'Containers to be ready for monitoring'
      );
    });

    afterEach(async () => {
      await orchestrator.stop();
    });

    test('should collect container metrics', async () => {
      // Submit a job to create active container
      await orchestrator.submitJob('metrics-test-job', {
        steps: ['sleep 5'],
        timeout: 30000
      });
      
      // Wait for metrics collection
      await new Promise(resolve => setTimeout(resolve, testConfig.monitoringInterval + 2000));
      
      const metrics = orchestrator.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.status).toBeDefined();
      expect(metrics.containerMetrics).toBeDefined();
      expect(Array.isArray(metrics.containerMetrics)).toBe(true);
    }, 30000);
  });

  describe('Container Cleanup', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
      await orchestrator.start();
    });

    afterEach(async () => {
      await orchestrator.stop();
    });

    test('should clean up completed containers', async () => {
      // Submit and complete a job
      await orchestrator.submitJob('cleanup-test-job', {
        steps: ['echo "Quick job"'],
        timeout: 10000
      });
      
      // Wait for job completion
      await waitForCondition(
        () => {
          const status = orchestrator.getStatus();
          return status.jobs.active === 0; // No active jobs
        },
        20000,
        'Job to complete'
      );
      
      // Wait for cleanup to occur
      await new Promise(resolve => setTimeout(resolve, testConfig.cleanupInterval + 5000));
      
      // Verify cleanup occurred
      const finalStatus = orchestrator.getStatus();
      expect(finalStatus.containers.active).toBeLessThanOrEqual(testConfig.maxContainers);
    }, 45000);
  });

  describe('Error Handling', () => {
    test('should handle Docker daemon disconnection gracefully', async () => {
      await orchestrator.initialize();
      
      // Simulate Docker API error by using invalid configuration
      const invalidOrchestrator = new ContainerOrchestrator({
        ...testConfig,
        dockerOptions: { host: 'invalid-host' }
      });
      
      await expect(invalidOrchestrator.initialize()).rejects.toThrow();
    });

    test('should handle container creation failures', async () => {
      await orchestrator.initialize();
      await orchestrator.start();
      
      // Try to create container with invalid image
      const orchestratorWithInvalidImage = new ContainerOrchestrator({
        ...testConfig,
        baseImage: 'non-existent-image:latest'
      });
      
      await orchestratorWithInvalidImage.initialize();
      
      let jobFailed = false;
      orchestratorWithInvalidImage.once('jobFailed', () => {
        jobFailed = true;
      });
      
      try {
        await orchestratorWithInvalidImage.submitJob('invalid-image-job', {
          steps: ['echo "test"']
        });
        
        await waitForCondition(
          () => jobFailed,
          15000,
          'Job with invalid image to fail'
        );
        
        expect(jobFailed).toBe(true);
      } finally {
        await orchestratorWithInvalidImage.stop();
      }
    }, 30000);
  });

  describe('Performance Validation', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
      await orchestrator.start();
    });

    afterEach(async () => {
      await orchestrator.stop();
    });

    test('should execute jobs within acceptable time limits', async () => {
      const jobId = 'performance-test-job';
      const startTime = Date.now();
      
      let jobCompleted = false;
      orchestrator.once('jobCompleted', () => {
        jobCompleted = true;
      });
      
      await orchestrator.submitJob(jobId, {
        steps: ['echo "Performance test"'],
        timeout: 10000
      });
      
      await waitForCondition(
        () => jobCompleted,
        15000,
        'Performance test job to complete'
      );
      
      const executionTime = Date.now() - startTime;
      expect(executionTime).toBeLessThan(15000); // Should complete within 15 seconds
    }, 20000);
  });

  // Helper Functions
  async function waitForCondition(condition, timeout, description) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Timeout waiting for: ${description}`);
  }

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
          if (error.statusCode !== 404) {
            console.warn(`Failed to remove container ${containerData.Id}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.warn('Error during container cleanup:', error.message);
    }
  }

  async function cleanupTestNetwork() {
    try {
      const networks = await docker.listNetworks();
      const testNetwork = networks.find(net => net.Name === testConfig.networkName);
      
      if (testNetwork) {
        const network = docker.getNetwork(testNetwork.Id);
        await network.remove();
      }
    } catch (error) {
      // Ignore errors for networks that don't exist
      if (error.statusCode !== 404) {
        console.warn(`Failed to remove test network:`, error.message);
      }
    }
  }
});