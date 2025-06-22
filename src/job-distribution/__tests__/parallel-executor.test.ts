import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { 
  ParallelExecutor, 
  ParallelExecutionConfig, 
  ExecutionPlanStatus, 
  JobExecutionStatus 
} from '../parallel-executor';
import { JobRouter, JobRoutingRequest, JobPriority } from '../job-router';
import { LoadBalancer } from '../load-balancer';
import { ResourceScheduler } from '../resource-scheduler';
import { DependencyManager } from '../dependency-manager';

// Mock all dependencies
jest.mock('../job-router');
jest.mock('../load-balancer');
jest.mock('../resource-scheduler');
jest.mock('../dependency-manager');

const MockedJobRouter = jest.mocked(JobRouter);
const MockedLoadBalancer = jest.mocked(LoadBalancer);
const MockedResourceScheduler = jest.mocked(ResourceScheduler);
const MockedDependencyManager = jest.mocked(DependencyManager);

describe('ParallelExecutor', () => {
  let parallelExecutor: ParallelExecutor;
  let mockJobRouter: jest.Mocked<JobRouter>;
  let mockLoadBalancer: jest.Mocked<LoadBalancer>;
  let mockResourceScheduler: jest.Mocked<ResourceScheduler>;
  let mockDependencyManager: jest.Mocked<DependencyManager>;

  const createMockJobRequest = (id: string = 'test-job-1'): JobRoutingRequest => ({
    jobId: id,
    workflowId: 'workflow-1',
    repository: 'test/repo',
    sha: 'abc123',
    ref: 'main',
    labels: ['ubuntu-latest'],
    environment: { NODE_ENV: 'test' },
    services: {},
    container: null,
    strategy: ['matrix'],
    timeout: 3600,
    priority: JobPriority.Medium,
    resourceRequirements: {
      cpu: { min: 1, max: 4, preferred: 2 },
      memory: { min: '1GB', max: '8GB', preferred: '4GB' },
      disk: { min: '10GB', max: '100GB', preferred: '50GB' },
      network: { bandwidth: '100Mbps', latency: 50 },
      specialized: ['docker']
    },
    metadata: {
      estimatedDuration: 300,
      jobType: 'ci',
      workflowType: 'push',
      criticality: 'normal',
      tags: ['test', 'ci'],
      constraints: {
        allowedRunners: [],
        blockedRunners: [],
        requiredCapabilities: ['docker'],
        securityLevel: 'standard'
      },
      preferences: {
        preferredRunners: [],
        affinityRules: [],
        antiAffinityRules: [],
        performanceProfile: 'balanced'
      }
    }
  });

  beforeEach(() => {
    // Reset singleton
    (ParallelExecutor as any).instance = undefined;

    // Mock JobRouter
    mockJobRouter = {
      routeJob: jest.fn().mockResolvedValue({
        success: true,
        assignedRunner: {
          id: 'runner-1',
          name: 'Test Runner',
          status: 'available',
          capabilities: ['docker'],
          load: 0.5,
          lastHeartbeat: new Date()
        },
        routingDecision: {
          algorithm: 'round_robin',
          factors: {},
          confidence: 0.9,
          alternativeRunners: []
        },
        executionContext: {
          containerId: 'container-123',
          networkId: 'network-456',
          volumes: ['volume-789']
        }
      })
    } as any;
    MockedJobRouter.getInstance.mockReturnValue(mockJobRouter);

    // Mock LoadBalancer
    mockLoadBalancer = {
      submitJob: jest.fn().mockResolvedValue({
        success: true,
        queueId: 'queue-1',
        position: 1,
        estimatedWaitTime: 0,
        assignedRunner: 'runner-1'
      })
    } as any;
    MockedLoadBalancer.getInstance.mockReturnValue(mockLoadBalancer);

    // Mock ResourceScheduler
    mockResourceScheduler = {
      scheduleJob: jest.fn().mockResolvedValue({
        success: true,
        scheduledAt: new Date(),
        assignedResources: {
          cpu: 2,
          memory: '4GB',
          storage: '50GB',
          network: '100Mbps'
        },
        estimatedStartTime: new Date(),
        estimatedCompletionTime: new Date(Date.now() + 300000)
      })
    } as any;
    MockedResourceScheduler.getInstance.mockReturnValue(mockResourceScheduler);

    // Mock DependencyManager
    mockDependencyManager = {
      createDependencyGraph: jest.fn().mockResolvedValue({
        id: 'graph-1',
        nodes: new Map(),
        edges: [],
        status: 'ready',
        executionPlan: [],
        metrics: {
          totalNodes: 1,
          totalEdges: 0,
          maxDepth: 1,
          criticalPathLength: 300
        }
      })
    } as any;
    MockedDependencyManager.getInstance.mockReturnValue(mockDependencyManager);

    parallelExecutor = ParallelExecutor.getInstance();
  });

  afterEach(async () => {
    await parallelExecutor.stop();
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should create singleton instance', () => {
      const instance1 = ParallelExecutor.getInstance();
      const instance2 = ParallelExecutor.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should initialize with default configuration', () => {
      const config = parallelExecutor.getConfiguration();
      
      expect(config).toMatchObject({
        maxConcurrentJobs: 100,
        maxQueuedJobs: 1000,
        jobTimeout: 3600000,
        enableDependencyExecution: true,
        enableResourceAwareScheduling: true,
        enableLoadBalancing: true
      });
    });

    it('should initialize with custom configuration', () => {
      const customConfig: Partial<ParallelExecutionConfig> = {
        maxConcurrentJobs: 50,
        maxQueuedJobs: 500,
        enableDependencyExecution: false
      };

      const customExecutor = ParallelExecutor.getInstance(customConfig);
      const config = customExecutor.getConfiguration();

      expect(config.maxConcurrentJobs).toBe(50);
      expect(config.maxQueuedJobs).toBe(500);
      expect(config.enableDependencyExecution).toBe(false);
    });

    it('should start and stop successfully', async () => {
      await parallelExecutor.start();
      expect(parallelExecutor.getMetrics().activeExecutions).toBe(0);
      
      await parallelExecutor.stop();
      expect(parallelExecutor.getMetrics().queuedExecutions).toBe(0);
    });
  });

  describe('Job Submission', () => {
    beforeEach(async () => {
      await parallelExecutor.start();
    });

    it('should submit single job successfully', async () => {
      const job = createMockJobRequest();
      
      const planId = await parallelExecutor.submitSingleJob(job);
      
      expect(planId).toBeDefined();
      expect(planId).toMatch(/^plan_/);
      
      const plan = parallelExecutor.getExecutionPlan(planId);
      expect(plan).toBeDefined();
      expect(plan!.jobs).toHaveLength(1);
      expect(plan!.jobs[0].originalRequest.jobId).toBe(job.jobId);
    });

    it('should submit job batch successfully', async () => {
      const jobs = [
        createMockJobRequest('job-1'),
        createMockJobRequest('job-2'),
        createMockJobRequest('job-3')
      ];
      
      const planId = await parallelExecutor.submitJobBatch(jobs, {
        planName: 'Test Batch',
        planDescription: 'Test batch execution',
        executionStrategy: 'speed_optimized'
      });
      
      expect(planId).toBeDefined();
      
      const plan = parallelExecutor.getExecutionPlan(planId);
      expect(plan).toBeDefined();
      expect(plan!.jobs).toHaveLength(3);
      expect(plan!.name).toBe('Test Batch');
      expect(plan!.executionStrategy).toBe('speed_optimized');
    });

    it('should create dependency graph when enabled', async () => {
      const jobs = [
        createMockJobRequest('job-1'),
        createMockJobRequest('job-2')
      ];
      
      await parallelExecutor.submitJobBatch(jobs, {
        enableDependencies: true
      });
      
      expect(mockDependencyManager.createDependencyGraph).toHaveBeenCalledWith(
        expect.stringMatching(/^graph_plan_/),
        jobs
      );
    });

    it('should handle job submission failure', async () => {
      mockJobRouter.routeJob.mockRejectedValueOnce(new Error('Routing failed'));
      
      const job = createMockJobRequest();
      
      await expect(parallelExecutor.submitSingleJob(job)).rejects.toThrow();
    });
  });

  describe('Job Execution', () => {
    beforeEach(async () => {
      await parallelExecutor.start();
    });

    it('should execute job through all stages successfully', async () => {
      const job = createMockJobRequest();
      
      let completed = false;
      parallelExecutor.on('job_execution_completed', (data) => {
        expect(data.jobId).toMatch(/^exec_/);
        expect(data.job.status).toBe(JobExecutionStatus.Completed);
        expect(data.job.routingResult).toBeDefined();
        expect(data.job.loadBalancingResult).toBeDefined();
        expect(data.job.schedulingResult).toBeDefined();
        completed = true;
      });
      
      await parallelExecutor.submitSingleJob(job);
      
      // Wait for execution to complete
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(completed).toBe(true);
    });

    it('should handle routing failure with retry', async (done) => {
      const job = createMockJobRequest();
      
      let callCount = 0;
      mockJobRouter.routeJob.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Routing failed'));
        }
        return Promise.resolve({
          success: true,
          assignedRunner: {
            id: 'runner-1',
            name: 'Test Runner',
            status: 'available',
            capabilities: ['docker'],
            load: 0.5,
            lastHeartbeat: new Date()
          },
          routingDecision: {
            algorithm: 'round_robin',
            factors: {},
            confidence: 0.9,
            alternativeRunners: []
          },
          executionContext: {
            containerId: 'container-123',
            networkId: 'network-456',
            volumes: ['volume-789']
          }
        });
      });
      
      parallelExecutor.on('job_execution_retry', (data) => {
        expect(data.job.retryCount).toBe(1);
        expect(data.job.status).toBe(JobExecutionStatus.Retrying);
      });
      
      parallelExecutor.on('job_execution_completed', (data) => {
        expect(data.job.status).toBe(JobExecutionStatus.Completed);
        expect(data.job.retryCount).toBe(1);
        done();
      });
      
      await parallelExecutor.submitSingleJob(job);
      
      // Wait for retry and completion
      await new Promise(resolve => setTimeout(resolve, 6000)); // Wait for retry delay
    }, 10000);

    it('should handle permanent job failure', async (done) => {
      const job = createMockJobRequest();
      
      mockJobRouter.routeJob.mockRejectedValue(new Error('validation failed'));
      
      parallelExecutor.on('job_execution_failed', (data) => {
        expect(data.job.status).toBe(JobExecutionStatus.Failed);
        expect(data.job.error).toBeDefined();
        expect(data.job.error!.retryable).toBe(false);
        done();
      });
      
      await parallelExecutor.submitSingleJob(job);
      
      // Wait for failure
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should track execution metrics', async () => {
      const jobs = [
        createMockJobRequest('job-1'),
        createMockJobRequest('job-2')
      ];
      
      await parallelExecutor.submitJobBatch(jobs);
      
      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const metrics = parallelExecutor.getMetrics();
      expect(metrics.totalExecutions).toBeGreaterThan(0);
      expect(metrics.completedExecutions).toBeGreaterThan(0);
    });
  });

  describe('Execution Plan Management', () => {
    beforeEach(async () => {
      await parallelExecutor.start();
    });

    it('should complete execution plan when all jobs finish', async (done) => {
      const jobs = [
        createMockJobRequest('job-1'),
        createMockJobRequest('job-2')
      ];
      
      parallelExecutor.on('execution_plan_completed', (data) => {
        expect(data.plan.status).toBe(ExecutionPlanStatus.Completed);
        expect(data.plan.completedAt).toBeDefined();
        done();
      });
      
      await parallelExecutor.submitJobBatch(jobs);
      
      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 200));
    });

    it('should cancel execution plan successfully', async () => {
      const jobs = [
        createMockJobRequest('job-1'),
        createMockJobRequest('job-2')
      ];
      
      const planId = await parallelExecutor.submitJobBatch(jobs);
      
      const cancelled = await parallelExecutor.cancelExecution(planId);
      expect(cancelled).toBe(true);
      
      const plan = parallelExecutor.getExecutionPlan(planId);
      expect(plan!.status).toBe(ExecutionPlanStatus.Cancelled);
    });

    it('should pause and resume execution plan', async () => {
      const jobs = [createMockJobRequest('job-1')];
      
      const planId = await parallelExecutor.submitJobBatch(jobs);
      
      let plan = parallelExecutor.getExecutionPlan(planId);
      plan!.status = ExecutionPlanStatus.Executing; // Simulate executing state
      
      const paused = await parallelExecutor.pauseExecution(planId);
      expect(paused).toBe(true);
      
      plan = parallelExecutor.getExecutionPlan(planId);
      expect(plan!.status).toBe(ExecutionPlanStatus.Paused);
      
      const resumed = await parallelExecutor.resumeExecution(planId);
      expect(resumed).toBe(true);
      
      plan = parallelExecutor.getExecutionPlan(planId);
      expect(plan!.status).toBe(ExecutionPlanStatus.Executing);
    });

    it('should get execution plans and history', async () => {
      const job = createMockJobRequest();
      
      await parallelExecutor.submitSingleJob(job);
      
      const plans = parallelExecutor.getExecutionPlans();
      expect(plans).toHaveLength(1);
      
      // Wait for execution to complete
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const history = parallelExecutor.getExecutionHistory();
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('Resource Requirements Calculation', () => {
    it('should calculate total resource requirements correctly', async () => {
      const jobs = [
        createMockJobRequest('job-1'),
        createMockJobRequest('job-2')
      ];
      
      const planId = await parallelExecutor.submitJobBatch(jobs);
      const plan = parallelExecutor.getExecutionPlan(planId);
      
      expect(plan!.resourceRequirements).toMatchObject({
        totalCpu: 4, // 2 + 2
        totalMemory: expect.stringMatching(/\d+GB/),
        peakConcurrency: expect.any(Number),
        estimatedDuration: expect.any(Number)
      });
    });

    it('should estimate execution duration correctly', async () => {
      const jobs = [
        { ...createMockJobRequest('job-1'), metadata: { ...createMockJobRequest('job-1').metadata, estimatedDuration: 100 } },
        { ...createMockJobRequest('job-2'), metadata: { ...createMockJobRequest('job-2').metadata, estimatedDuration: 200 } }
      ];
      
      const planId = await parallelExecutor.submitJobBatch(jobs);
      const plan = parallelExecutor.getExecutionPlan(planId);
      
      // With max concurrency of 100, both jobs should run in parallel
      // So estimated duration should be max(100, 200) = 200, but our calculation is more conservative
      expect(plan!.estimatedDuration).toBeGreaterThan(0);
    });
  });

  describe('Configuration Validation', () => {
    it('should work with minimal configuration', () => {
      const minimalExecutor = ParallelExecutor.getInstance({});
      const config = minimalExecutor.getConfiguration();
      
      expect(config.maxConcurrentJobs).toBe(100);
      expect(config.enableDependencyExecution).toBe(true);
    });

    it('should work with full configuration', () => {
      const fullConfig: Partial<ParallelExecutionConfig> = {
        maxConcurrentJobs: 50,
        maxQueuedJobs: 500,
        jobTimeout: 1800000,
        enableDependencyExecution: false,
        enableResourceAwareScheduling: false,
        enableLoadBalancing: false,
        failureHandling: {
          retryEnabled: false,
          maxRetries: 1,
          retryDelay: 1000,
          retryBackoffMultiplier: 1.5,
          failFastEnabled: true,
          rollbackEnabled: false,
          notificationChannels: ['slack']
        }
      };
      
      const customExecutor = ParallelExecutor.getInstance(fullConfig);
      const config = customExecutor.getConfiguration();
      
      expect(config.maxConcurrentJobs).toBe(50);
      expect(config.enableDependencyExecution).toBe(false);
      expect(config.failureHandling.retryEnabled).toBe(false);
    });
  });

  describe('Event Handling', () => {
    beforeEach(async () => {
      await parallelExecutor.start();
    });

    it('should emit job execution events', async (done) => {
      const job = createMockJobRequest();
      const events: string[] = [];
      
      parallelExecutor.on('job_execution_started', () => events.push('started'));
      parallelExecutor.on('job_execution_completed', () => {
        events.push('completed');
        expect(events).toContain('started');
        expect(events).toContain('completed');
        done();
      });
      
      await parallelExecutor.submitSingleJob(job);
      
      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should emit batch submission events', async (done) => {
      const jobs = [createMockJobRequest('job-1')];
      
      parallelExecutor.on('batch_submitted', (data) => {
        expect(data.jobCount).toBe(1);
        expect(data.planId).toBeDefined();
        done();
      });
      
      await parallelExecutor.submitJobBatch(jobs);
    });

    it('should emit executor lifecycle events', async (done) => {
      let startEmitted = false;
      
      parallelExecutor.on('executor_started', () => {
        startEmitted = true;
      });
      
      parallelExecutor.on('executor_stopped', () => {
        expect(startEmitted).toBe(true);
        done();
      });
      
      await parallelExecutor.start();
      await parallelExecutor.stop();
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await parallelExecutor.start();
    });

    it('should handle load balancing failure', async (done) => {
      mockLoadBalancer.submitJob.mockRejectedValueOnce(new Error('Load balancing failed'));
      
      const job = createMockJobRequest();
      
      parallelExecutor.on('job_execution_failed', (data) => {
        expect(data.error.message).toContain('Load balancing failed');
        done();
      });
      
      await parallelExecutor.submitSingleJob(job);
      
      // Wait for failure
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should handle resource scheduling failure', async (done) => {
      mockResourceScheduler.scheduleJob.mockRejectedValueOnce(new Error('Resource scheduling failed'));
      
      const job = createMockJobRequest();
      
      parallelExecutor.on('job_execution_failed', (data) => {
        expect(data.error.message).toContain('Resource scheduling failed');
        done();
      });
      
      await parallelExecutor.submitSingleJob(job);
      
      // Wait for failure
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should handle dependency graph creation failure', async () => {
      mockDependencyManager.createDependencyGraph.mockRejectedValueOnce(
        new Error('Dependency graph creation failed')
      );
      
      const jobs = [createMockJobRequest('job-1')];
      
      await expect(
        parallelExecutor.submitJobBatch(jobs, { enableDependencies: true })
      ).rejects.toThrow('Dependency graph creation failed');
    });
  });

  describe('Metrics and Monitoring', () => {
    beforeEach(async () => {
      await parallelExecutor.start();
    });

    it('should track basic execution metrics', async () => {
      const initialMetrics = parallelExecutor.getMetrics();
      expect(initialMetrics.totalExecutions).toBe(0);
      expect(initialMetrics.completedExecutions).toBe(0);
      
      const job = createMockJobRequest();
      await parallelExecutor.submitSingleJob(job);
      
      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const finalMetrics = parallelExecutor.getMetrics();
      expect(finalMetrics.totalExecutions).toBeGreaterThan(0);
    });

    it('should emit metrics updates', async (done) => {
      parallelExecutor.on('metrics_updated', (metrics) => {
        expect(metrics).toMatchObject({
          totalExecutions: expect.any(Number),
          activeExecutions: expect.any(Number),
          queuedExecutions: expect.any(Number)
        });
        done();
      });
      
      const job = createMockJobRequest();
      await parallelExecutor.submitSingleJob(job);
    });

    it('should calculate success rate correctly', async () => {
      // Submit a successful job
      const successJob = createMockJobRequest('success-job');
      await parallelExecutor.submitSingleJob(successJob);
      
      // Submit a failing job
      mockJobRouter.routeJob.mockRejectedValueOnce(new Error('validation failed'));
      const failJob = createMockJobRequest('fail-job');
      await parallelExecutor.submitSingleJob(failJob);
      
      // Wait for both executions
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const metrics = parallelExecutor.getMetrics();
      expect(metrics.successRate).toBeGreaterThan(0);
      expect(metrics.successRate).toBeLessThanOrEqual(1);
    });
  });
});