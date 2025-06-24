import { RunnerOrchestrator, OrchestratorConfig, OrchestratorStatus } from '../runner-orchestrator';
import { QUEUE_CONFIG } from '../../queues/config/redis-config';
import { JobConclusion } from '../status-reporter';

// Mock dependencies
jest.mock('../../utils/logger');
jest.mock('../../queues/queue-manager');
jest.mock('../../queues/job-router');
jest.mock('../../services/database');
jest.mock('../../services/github-service');
jest.mock('../../container-orchestration/pool/integrated-pool-orchestrator');
jest.mock('../../services/monitoring');
jest.mock('../status-reporter');

describe('RunnerOrchestrator', () => {
  let orchestrator: RunnerOrchestrator;
  let config: OrchestratorConfig;

  beforeEach(() => {
    config = {
      maxConcurrentJobs: 10,
      containerPoolSize: 20,
      healthCheckInterval: 30000,
      metricsInterval: 60000,
      webhookSecret: 'test-secret',
      gitHubToken: 'test-token',
      gitHubOrg: 'test-org'
    };

    // Reset singleton instance
    (RunnerOrchestrator as any).instance = null;
    orchestrator = RunnerOrchestrator.getInstance(config);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await orchestrator.initialize();
      expect(orchestrator.getStatus()).toBe(OrchestratorStatus.READY);
    });

    it('should handle initialization failure', async () => {
      // Mock container pool initialization failure
      const mockContainerPool = jest.requireMock('../../container-orchestration/pool/integrated-pool-orchestrator').ContainerPoolManager;
      mockContainerPool.getInstance.mockReturnValue({
        initialize: jest.fn().mockRejectedValue(new Error('Container pool init failed'))
      });

      await expect(orchestrator.initialize()).rejects.toThrow('Container pool init failed');
      expect(orchestrator.getStatus()).toBe(OrchestratorStatus.ERROR);
    });
  });

  describe('workflow job handling', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should handle job queued event', async () => {
      const workflowJobEvent = {
        action: 'queued',
        workflow_job: {
          id: 123,
          name: 'test-job',
          workflow_name: 'CI',
          run_id: 456,
          run_attempt: 1,
          head_sha: 'abc123',
          head_ref: 'main',
          labels: ['self-hosted', 'linux'],
          steps: []
        },
        repository: {
          full_name: 'test/repo'
        }
      };

      await orchestrator.handleWorkflowJobEvent(workflowJobEvent);

      // Verify job was added to pending jobs
      const pendingJobs = orchestrator.getPendingJobs();
      expect(pendingJobs.has('123')).toBe(true);

      const jobRequest = pendingJobs.get('123');
      expect(jobRequest).toMatchObject({
        id: '123',
        repository: 'test/repo',
        workflow: 'CI',
        jobName: 'test-job',
        runId: 456,
        labels: ['self-hosted', 'linux']
      });
    });

    it('should reject jobs with unsupported labels', async () => {
      const workflowJobEvent = {
        action: 'queued',
        workflow_job: {
          id: 123,
          name: 'test-job',
          workflow_name: 'CI',
          run_id: 456,
          run_attempt: 1,
          head_sha: 'abc123',
          head_ref: 'main',
          labels: ['windows', 'macos'], // Unsupported labels
          steps: []
        },
        repository: {
          full_name: 'test/repo'
        }
      };

      await orchestrator.handleWorkflowJobEvent(workflowJobEvent);

      // Verify job was not added to pending jobs
      const pendingJobs = orchestrator.getPendingJobs();
      expect(pendingJobs.has('123')).toBe(false);
    });

    it('should handle job in progress event', async () => {
      // First queue a job
      const mockAssignment = {
        jobId: '123',
        containerId: 'container-1',
        containerName: 'test-container',
        assignedAt: new Date(),
        estimatedDuration: 300000,
        priority: 1
      };

      orchestrator.getActiveJobs().set('123', mockAssignment);

      const workflowJobEvent = {
        action: 'in_progress',
        workflow_job: {
          id: 123,
          name: 'test-job'
        }
      };

      await orchestrator.handleWorkflowJobEvent(workflowJobEvent);

      // Verify database service was called to update job status
      const mockDatabaseService = jest.requireMock('../../services/database').DatabaseService;
      expect(mockDatabaseService.getInstance().updateJobStatus).toHaveBeenCalledWith(
        '123',
        expect.objectContaining({
          status: 'in_progress',
          containerId: 'container-1'
        })
      );
    });

    it('should handle job completed event', async () => {
      // Set up active job
      const mockAssignment = {
        jobId: '123',
        containerId: 'container-1',
        containerName: 'test-container',
        assignedAt: new Date(Date.now() - 300000), // 5 minutes ago
        estimatedDuration: 300000,
        priority: 1
      };

      orchestrator.getActiveJobs().set('123', mockAssignment);

      const workflowJobEvent = {
        action: 'completed',
        workflow_job: {
          id: 123,
          name: 'test-job',
          workflow_name: 'CI',
          conclusion: 'success'
        }
      };

      await orchestrator.handleWorkflowJobEvent(workflowJobEvent);

      // Verify job was removed from active jobs
      const activeJobs = orchestrator.getActiveJobs();
      expect(activeJobs.has('123')).toBe(false);

      // Verify container was released
      const mockContainerPool = jest.requireMock('../../container-orchestration/pool/integrated-pool-orchestrator').ContainerPoolManager;
      expect(mockContainerPool.getInstance().releaseContainer).toHaveBeenCalledWith('container-1');
    });
  });

  describe('container assignment', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should assign container to job', async () => {
      // Set up pending job
      const jobRequest = {
        id: '123',
        repository: 'test/repo',
        workflow: 'CI',
        jobName: 'test-job',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux'],
        steps: []
      };

      orchestrator.getPendingJobs().set('123', jobRequest);

      // Mock container pool response
      const mockContainer = {
        id: 'container-1',
        name: 'test-container'
      };

      const mockContainerPool = jest.requireMock('../../container-orchestration/pool/integrated-pool-orchestrator').ContainerPoolManager;
      mockContainerPool.getInstance().acquireContainer.mockResolvedValue(mockContainer);

      const assignment = await orchestrator.assignContainer('123');

      expect(assignment).toMatchObject({
        jobId: '123',
        containerId: 'container-1',
        containerName: 'test-container'
      });

      // Verify job moved from pending to active
      expect(orchestrator.getPendingJobs().has('123')).toBe(false);
      expect(orchestrator.getActiveJobs().has('123')).toBe(true);
    });

    it('should handle no available containers', async () => {
      // Set up pending job
      const jobRequest = {
        id: '123',
        repository: 'test/repo',
        workflow: 'CI',
        jobName: 'test-job',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux'],
        steps: []
      };

      orchestrator.getPendingJobs().set('123', jobRequest);

      // Mock no available containers
      const mockContainerPool = jest.requireMock('../../container-orchestration/pool/integrated-pool-orchestrator').ContainerPoolManager;
      mockContainerPool.getInstance().acquireContainer.mockResolvedValue(null);

      const assignment = await orchestrator.assignContainer('123');

      expect(assignment).toBeNull();
      expect(orchestrator.getPendingJobs().has('123')).toBe(true); // Job remains pending
    });
  });

  describe('job validation', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should validate required fields', () => {
      const validJob = {
        id: '123',
        repository: 'test/repo',
        workflow: 'CI',
        jobName: 'test-job',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux'],
        steps: []
      };

      expect((orchestrator as any).validateJob(validJob)).toBe(true);
    });

    it('should reject job with missing required fields', () => {
      const invalidJob = {
        id: '',
        repository: '',
        workflow: '',
        jobName: 'test-job',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux'],
        steps: []
      };

      expect((orchestrator as any).validateJob(invalidJob)).toBe(false);
    });

    it('should validate container support', () => {
      const supportedContainer = {
        image: 'node:18'
      };

      const unsupportedContainer = {
        image: 'windows/servercore:latest'
      };

      expect((orchestrator as any).isContainerSupported(supportedContainer)).toBe(true);
      expect((orchestrator as any).isContainerSupported(unsupportedContainer)).toBe(false);
    });
  });

  describe('priority calculation', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should assign critical priority to deployment workflows', () => {
      const deployJob = {
        id: '123',
        repository: 'test/repo',
        workflow: 'Deploy to Production',
        jobName: 'deploy',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux'],
        steps: []
      };

      const priority = (orchestrator as any).calculateJobPriority(deployJob);
      expect(priority).toBe(QUEUE_CONFIG.priorities.CRITICAL);
    });

    it('should assign high priority to urgent jobs', () => {
      const urgentJob = {
        id: '123',
        repository: 'test/repo',
        workflow: 'CI',
        jobName: 'test',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux', 'urgent'],
        steps: []
      };

      const priority = (orchestrator as any).calculateJobPriority(urgentJob);
      expect(priority).toBe(QUEUE_CONFIG.priorities.HIGH);
    });

    it('should assign normal priority to test workflows', () => {
      const testJob = {
        id: '123',
        repository: 'test/repo',
        workflow: 'Test Suite',
        jobName: 'test',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux'],
        steps: []
      };

      const priority = (orchestrator as any).calculateJobPriority(testJob);
      expect(priority).toBe(QUEUE_CONFIG.priorities.NORMAL);
    });
  });

  describe('resource estimation', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should estimate base resources for standard job', () => {
      const standardJob = {
        id: '123',
        repository: 'test/repo',
        workflow: 'CI',
        jobName: 'test',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux'],
        steps: []
      };

      const resources = (orchestrator as any).estimateResourceRequirements(standardJob);
      expect(resources).toMatchObject({
        cpu: 1,
        memory: '2Gi',
        disk: '10Gi'
      });
    });

    it('should estimate higher resources for large runner jobs', () => {
      const largeJob = {
        id: '123',
        repository: 'test/repo',
        workflow: 'CI',
        jobName: 'test',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux', 'large-runner'],
        steps: []
      };

      const resources = (orchestrator as any).estimateResourceRequirements(largeJob);
      expect(resources).toMatchObject({
        cpu: 4,
        memory: '8Gi',
        disk: '50Gi'
      });
    });
  });

  describe('metrics and monitoring', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should return current metrics', () => {
      // Add some mock jobs
      orchestrator.getPendingJobs().set('job1', {} as any);
      orchestrator.getActiveJobs().set('job2', {} as any);

      const metrics = orchestrator.getMetrics();

      expect(metrics).toMatchObject({
        status: OrchestratorStatus.READY,
        activeJobs: 1,
        pendingJobs: 1,
        containers: 0,
        utilization: 0
      });
    });

    it('should emit scaling events when needed', async () => {
      let _scalingEvent: unknown = null;
      orchestrator.on('scaling:needed', (event) => {
        _scalingEvent = event;
      });

      // Simulate high load condition
      // This would typically be triggered by the health check
      // For testing, we'll call the method directly
      await (orchestrator as any).performHealthCheck();

      // The actual scaling logic would depend on the implementation
      // This is a placeholder test structure
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should shutdown gracefully', async () => {
      await orchestrator.shutdown();
      expect(orchestrator.getStatus()).toBe(OrchestratorStatus.STOPPED);
    });

    it('should wait for active jobs to complete during shutdown', async () => {
      // Add an active job
      const mockAssignment = {
        jobId: '123',
        containerId: 'container-1',
        containerName: 'test-container',
        assignedAt: new Date(),
        estimatedDuration: 300000,
        priority: 1
      };

      orchestrator.getActiveJobs().set('123', mockAssignment);

      // Mock container pool release
      const mockContainerPool = jest.requireMock('../../container-orchestration/pool/integrated-pool-orchestrator').ContainerPoolManager;
      mockContainerPool.getInstance().releaseContainer.mockResolvedValue(undefined);

      const shutdownPromise = orchestrator.shutdown();

      // Simulate job completion during shutdown
      setTimeout(() => {
        orchestrator.getActiveJobs().delete('123');
      }, 100);

      await shutdownPromise;

      expect(orchestrator.getStatus()).toBe(OrchestratorStatus.STOPPED);
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should handle database errors gracefully', async () => {
      // Mock database error
      const mockDatabaseService = jest.requireMock('../../services/database').DatabaseService;
      mockDatabaseService.getInstance().createContainerAssignment.mockRejectedValue(
        new Error('Database connection failed')
      );

      const jobRequest = {
        id: '123',
        repository: 'test/repo',
        workflow: 'CI',
        jobName: 'test-job',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux'],
        steps: []
      };

      orchestrator.getPendingJobs().set('123', jobRequest);

      // Mock container acquisition
      const mockContainerPool = jest.requireMock('../../container-orchestration/pool/integrated-pool-orchestrator').ContainerPoolManager;
      mockContainerPool.getInstance().acquireContainer.mockResolvedValue({
        id: 'container-1',
        name: 'test-container'
      });

      const assignment = await orchestrator.assignContainer('123');

      // Should handle the error and return null
      expect(assignment).toBeNull();
    });

    it('should report job failures correctly', async () => {
      const mockStatusReporter = jest.requireMock('../status-reporter').StatusReporter;
      const mockReportJobCompleted = jest.fn();
      mockStatusReporter.getInstance.mockReturnValue({
        reportJobCompleted: mockReportJobCompleted
      });

      // Add a pending job
      const jobRequest = {
        id: '123',
        repository: 'test/repo',
        workflow: 'CI',
        jobName: 'test-job',
        runId: 456,
        runNumber: 1,
        sha: 'abc123',
        ref: 'main',
        environment: {},
        labels: ['self-hosted', 'linux'],
        steps: []
      };

      orchestrator.getPendingJobs().set('123', jobRequest);

      await (orchestrator as any).reportJobFailure('123', 'Test failure reason');

      expect(mockReportJobCompleted).toHaveBeenCalledWith(
        '123',
        'test/repo',
        'abc123',
        'test-job',
        456,
        JobConclusion.FAILURE,
        expect.objectContaining({
          title: 'Job Failed',
          summary: 'Test failure reason'
        })
      );
    });
  });
});