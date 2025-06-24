import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { 
  EnhancedOrchestrator, 
  EnhancedOrchestratorConfig,
  EnhancedOrchestratorStatus 
} from '../enhanced-orchestrator';
import { JobDistributionSystem } from '../../job-distribution';
import { DockerIntegrationService } from '../../docker';
import { RunnerOrchestrator } from '../runner-orchestrator';
import { JobParser } from '../job-parser';
import { ContainerAssignmentManager } from '../container-assignment';
import { StatusReporter } from '../status-reporter';

// Mock all dependencies
jest.mock('../../job-distribution');
jest.mock('../../docker');
jest.mock('../runner-orchestrator');
jest.mock('../job-parser');
jest.mock('../container-assignment');
jest.mock('../status-reporter');
jest.mock('../../services/database-service');
jest.mock('../../services/metrics-collector');

const MockedJobDistributionSystem = jest.mocked(JobDistributionSystem);
const MockedDockerIntegrationService = jest.mocked(DockerIntegrationService);
const MockedRunnerOrchestrator = jest.mocked(RunnerOrchestrator);
const MockedJobParser = jest.mocked(JobParser);
const MockedContainerAssignmentManager = jest.mocked(ContainerAssignmentManager);
const MockedStatusReporter = jest.mocked(StatusReporter);

describe('EnhancedOrchestrator', () => {
  let enhancedOrchestrator: EnhancedOrchestrator;
  let mockJobDistributionSystem: jest.Mocked<JobDistributionSystem>;
  let mockDockerIntegration: jest.Mocked<DockerIntegrationService>;
  let mockLegacyOrchestrator: jest.Mocked<RunnerOrchestrator>;
  let mockJobParser: jest.Mocked<JobParser>;
  let mockContainerAssignment: jest.Mocked<ContainerAssignmentManager>;
  let mockStatusReporter: jest.Mocked<StatusReporter>;

  const createMockConfig = (): EnhancedOrchestratorConfig => ({
    maxConcurrentJobs: 10,
    containerPoolSize: 20,
    healthCheckInterval: 30000,
    metricsInterval: 60000,
    webhookSecret: 'test-secret',
    gitHubToken: 'test-token',
    gitHubOrg: 'test-org',
    jobDistribution: {
      enabled: true,
      maxConcurrentJobs: 50,
      maxQueuedJobs: 100,
      enableDependencyExecution: true,
      enableResourceAwareScheduling: true,
      enableLoadBalancing: true
    },
    docker: {
      enabled: true,
      socketPath: '/var/run/docker.sock',
      registryUrl: 'https://registry.example.com',
      networkConfig: {
        defaultDriver: 'bridge',
        enableMonitoring: true
      },
      volumeConfig: {
        defaultDriver: 'local',
        enableCleanup: true
      }
    },
    scaling: {
      autoScaling: true,
      minContainers: 5,
      maxContainers: 50,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.3,
      cooldownPeriod: 300000
    }
  });

  const createMockWorkflowJob = (overrides: any = {}) => ({
    id: 12345,
    name: 'Test Job',
    workflow_name: 'CI',
    labels: ['self-hosted', 'linux', 'x64'],
    steps: [
      { name: 'Checkout', uses: 'actions/checkout@v3' },
      { name: 'Test', run: 'npm test' }
    ],
    head_sha: 'abc123',
    head_ref: 'main',
    run_id: 67890,
    run_attempt: 1,
    timeout_minutes: 60,
    container: null,
    services: {},
    needs: [],
    ...overrides
  });

  const createMockRepository = (overrides: any = {}) => ({
    full_name: 'test/repo',
    name: 'repo',
    owner: { login: 'test' },
    ...overrides
  });

  beforeEach(() => {
    // Reset singleton
    (EnhancedOrchestrator as any).instance = undefined;

    // Mock JobDistributionSystem
    mockJobDistributionSystem = {
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      submitJob: jest.fn().mockResolvedValue('plan-123'),
      submitJobBatch: jest.fn().mockResolvedValue('plan-456'),
      getSystemMetrics: jest.fn().mockReturnValue({
        router: { totalJobs: 0 },
        loadBalancer: { activeJobs: 0 },
        scheduler: { queuedJobs: 0 },
        dependencyManager: { activeDependencies: 0 },
        parallelExecutor: { activeExecutions: 0 }
      }),
      getSystemHealth: jest.fn().mockReturnValue({
        router: true,
        loadBalancer: true,
        scheduler: true,
        dependencyManager: true,
        parallelExecutor: true
      }),
      components: {
        parallelExecutor: {
          on: jest.fn(),
          submitJob: jest.fn().mockResolvedValue('plan-123'),
          submitJobBatch: jest.fn().mockResolvedValue('plan-456'),
          cancelExecution: jest.fn().mockResolvedValue(true),
          getMetrics: jest.fn().mockReturnValue({
            activeExecutions: 0,
            queuedExecutions: 0
          })
        }
      }
    } as any;
    MockedJobDistributionSystem.mockImplementation(() => mockJobDistributionSystem);

    // Mock DockerIntegrationService
    mockDockerIntegration = {
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      getHealthStatus: jest.fn().mockReturnValue({
        docker: true,
        templates: { available: 4 },
        networks: { configured: 3 },
        volumes: { configured: 3 }
      }),
      getSystemMetrics: jest.fn().mockReturnValue({
        docker: { connected: true },
        templates: { total: 4 },
        networks: { totalNetworks: 3 },
        volumes: { totalVolumes: 3 }
      })
    } as any;
    MockedDockerIntegrationService.getInstance.mockReturnValue(mockDockerIntegration);

    // Mock RunnerOrchestrator
    mockLegacyOrchestrator = {
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      handleWorkflowJobEvent: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      getStatus: jest.fn().mockReturnValue('ready'),
      getMetrics: jest.fn().mockReturnValue({
        activeJobs: 0,
        pendingJobs: 0
      })
    } as any;
    MockedRunnerOrchestrator.getInstance.mockReturnValue(mockLegacyOrchestrator);

    // Mock JobParser
    mockJobParser = {
      parseJob: jest.fn().mockReturnValue({
        id: '12345',
        name: 'Test Job',
        runs_on: ['self-hosted', 'linux', 'x64'],
        steps: [
          { id: 'checkout', name: 'Checkout', uses: 'actions/checkout@v3' },
          { id: 'test', name: 'Test', run: 'npm test' }
        ],
        timeout_minutes: 60,
        env: {}
      }),
      validateJob: jest.fn().mockReturnValue([]),
      canRunJob: jest.fn().mockReturnValue(true),
      transformForExecution: jest.fn().mockReturnValue({
        id: '12345',
        name: 'Test Job',
        container: { image: 'ubuntu:latest' },
        steps: []
      })
    } as any;
    MockedJobParser.getInstance.mockReturnValue(mockJobParser);

    // Mock ContainerAssignmentManager
    mockContainerAssignment = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getInstance: jest.fn(),
      on: jest.fn(),
      scaleUp: jest.fn().mockResolvedValue(undefined),
      scaleDown: jest.fn().mockResolvedValue(undefined)
    } as any;
    MockedContainerAssignmentManager.getInstance.mockReturnValue(mockContainerAssignment);

    // Mock StatusReporter
    mockStatusReporter = {
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      reportJobStatus: jest.fn().mockResolvedValue(undefined),
      reportJobCompleted: jest.fn().mockResolvedValue(undefined)
    } as any;
    MockedStatusReporter.getInstance.mockReturnValue(mockStatusReporter);

    enhancedOrchestrator = EnhancedOrchestrator.getInstance(createMockConfig());
  });

  afterEach(async () => {
    try {
      await enhancedOrchestrator.shutdown();
    } catch {
      // Ignore shutdown errors in tests
    }
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should create singleton instance', () => {
      const instance1 = EnhancedOrchestrator.getInstance(createMockConfig());
      const instance2 = EnhancedOrchestrator.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should initialize with all components enabled', async () => {
      await enhancedOrchestrator.initialize();

      expect(mockDockerIntegration.initialize).toHaveBeenCalled();
      expect(mockJobDistributionSystem.initialize).toHaveBeenCalled();
      expect(mockLegacyOrchestrator.initialize).toHaveBeenCalled();
      expect(mockContainerAssignment.initialize).toHaveBeenCalled();
      expect(mockStatusReporter.initialize).toHaveBeenCalled();
      
      expect(enhancedOrchestrator.getStatus()).toBe(EnhancedOrchestratorStatus.READY);
    });

    it('should initialize with job distribution disabled', async () => {
      const config = createMockConfig();
      config.jobDistribution.enabled = false;
      
      const orchestrator = EnhancedOrchestrator.getInstance(config);
      await orchestrator.initialize();

      expect(mockJobDistributionSystem.initialize).not.toHaveBeenCalled();
      expect(orchestrator.getStatus()).toBe(EnhancedOrchestratorStatus.READY);
    });

    it('should initialize with docker disabled', async () => {
      const config = createMockConfig();
      config.docker.enabled = false;
      
      const orchestrator = EnhancedOrchestrator.getInstance(config);
      await orchestrator.initialize();

      expect(mockDockerIntegration.initialize).not.toHaveBeenCalled();
      expect(orchestrator.getStatus()).toBe(EnhancedOrchestratorStatus.READY);
    });

    it('should handle initialization failure', async () => {
      mockDockerIntegration.initialize.mockRejectedValueOnce(new Error('Docker init failed'));

      await expect(enhancedOrchestrator.initialize()).rejects.toThrow('Docker init failed');
      expect(enhancedOrchestrator.getStatus()).toBe(EnhancedOrchestratorStatus.ERROR);
    });
  });

  describe('Workflow Job Event Handling', () => {
    beforeEach(async () => {
      await enhancedOrchestrator.initialize();
    });

    it('should handle job queued event with job distribution enabled', async () => {
      const workflowJob = createMockWorkflowJob();
      const repository = createMockRepository();

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository
      });

      expect(mockJobParser.parseJob).toHaveBeenCalledWith({
        id: '12345',
        name: 'Test Job',
        labels: ['self-hosted', 'linux', 'x64'],
        steps: workflowJob.steps,
        container: null,
        services: {},
        timeout_minutes: 60,
        env: {},
        needs: []
      });

      expect(mockJobParser.validateJob).toHaveBeenCalled();
      expect(mockJobParser.canRunJob).toHaveBeenCalled();
      expect(mockJobDistributionSystem.submitJob).toHaveBeenCalled();
      expect(mockStatusReporter.reportJobStatus).toHaveBeenCalledWith({
        id: '12345',
        repository: 'test/repo',
        sha: 'abc123',
        runId: 67890,
        name: 'Test Job',
        status: 'queued',
        output: {
          title: 'Test Job - Queued',
          summary: 'Job has been queued for execution in enhanced orchestrator'
        }
      });
    });

    it('should handle job validation failure', async () => {
      const workflowJob = createMockWorkflowJob();
      const repository = createMockRepository();

      mockJobParser.validateJob.mockReturnValueOnce([
        { field: 'id', message: 'Invalid job ID', severity: 'error' }
      ]);

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository
      });

      expect(mockJobDistributionSystem.submitJob).not.toHaveBeenCalled();
      expect(mockStatusReporter.reportJobCompleted).toHaveBeenCalledWith(
        '12345',
        'test/repo',
        'abc123',
        'Test Job',
        expect.any(Number),
        'failure',
        {
          title: 'Job Failed',
          summary: 'Job validation failed'
        }
      );
    });

    it('should reject unsupported job', async () => {
      const workflowJob = createMockWorkflowJob({
        labels: ['windows-latest'] // Unsupported platform
      });
      const repository = createMockRepository();

      mockJobParser.canRunJob.mockReturnValueOnce(false);

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository
      });

      expect(mockJobDistributionSystem.submitJob).not.toHaveBeenCalled();
    });

    it('should handle job in progress event', async () => {
      const workflowJob = createMockWorkflowJob();

      // First queue the job
      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });

      // Then handle in progress
      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'in_progress',
        workflow_job: workflowJob
      });

      const activeJobs = enhancedOrchestrator.getActiveJobs();
      const jobContext = activeJobs.get('12345');
      
      expect(jobContext?.status).toBe('in_progress');
      expect(jobContext?.startedAt).toBeDefined();
    });

    it('should handle job completed event', async () => {
      const workflowJob = createMockWorkflowJob({ conclusion: 'success' });

      // First queue the job
      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });

      // Then complete it
      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'completed',
        workflow_job: workflowJob
      });

      const activeJobs = enhancedOrchestrator.getActiveJobs();
      const executionHistory = enhancedOrchestrator.getExecutionHistory();
      
      expect(activeJobs.has('12345')).toBe(false);
      expect(executionHistory.has('12345')).toBe(true);
      
      const result = executionHistory.get('12345');
      expect(result?.status).toBe('success');
      expect(result?.conclusion).toBe('success');
    });

    it('should fallback to legacy orchestrator when job distribution disabled', async () => {
      const config = createMockConfig();
      config.jobDistribution.enabled = false;
      
      const orchestrator = EnhancedOrchestrator.getInstance(config);
      await orchestrator.initialize();

      const workflowJob = createMockWorkflowJob();
      const repository = createMockRepository();

      await orchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository
      });

      expect(mockLegacyOrchestrator.handleWorkflowJobEvent).toHaveBeenCalledWith({
        action: 'queued',
        workflow_job: workflowJob,
        repository
      });
    });
  });

  describe('Job Priority Calculation', () => {
    beforeEach(async () => {
      await enhancedOrchestrator.initialize();
    });

    it('should assign critical priority to deployment jobs', async () => {
      const workflowJob = createMockWorkflowJob({
        workflow_name: 'Deploy to Production'
      });

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });

      const submitJobCall = mockJobDistributionSystem.submitJob.mock.calls[0];
      const jobRequest = submitJobCall[0];
      
      expect(jobRequest.priority).toBe('critical');
    });

    it('should assign high priority to urgent jobs', async () => {
      const workflowJob = createMockWorkflowJob({
        labels: ['self-hosted', 'linux', 'x64', 'urgent']
      });

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });

      const submitJobCall = mockJobDistributionSystem.submitJob.mock.calls[0];
      const jobRequest = submitJobCall[0];
      
      expect(jobRequest.priority).toBe('high');
    });

    it('should assign medium priority to test jobs', async () => {
      const workflowJob = createMockWorkflowJob({
        workflow_name: 'Test Suite'
      });

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });

      const submitJobCall = mockJobDistributionSystem.submitJob.mock.calls[0];
      const jobRequest = submitJobCall[0];
      
      expect(jobRequest.priority).toBe('medium');
    });
  });

  describe('Resource Requirements Estimation', () => {
    beforeEach(async () => {
      await enhancedOrchestrator.initialize();
    });

    it('should estimate default resource requirements', async () => {
      const workflowJob = createMockWorkflowJob();

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });

      const submitJobCall = mockJobDistributionSystem.submitJob.mock.calls[0];
      const jobRequest = submitJobCall[0];
      
      expect(jobRequest.resourceRequirements).toMatchObject({
        cpu: { min: 1, max: 4, preferred: 2 },
        memory: { min: '1GB', max: '8GB', preferred: '4GB' },
        disk: { min: '10GB', max: '100GB', preferred: '50GB' },
        specialized: ['docker']
      });
    });

    it('should estimate larger requirements for large runner', async () => {
      const workflowJob = createMockWorkflowJob({
        labels: ['self-hosted', 'linux', 'x64', 'large-runner']
      });

      // Mock the job parser to return the large runner label
      mockJobParser.parseJob.mockReturnValueOnce({
        id: '12345',
        name: 'Test Job',
        runs_on: ['self-hosted', 'linux', 'x64', 'large-runner'],
        steps: [],
        timeout_minutes: 60,
        env: {}
      });

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });

      const submitJobCall = mockJobDistributionSystem.submitJob.mock.calls[0];
      const jobRequest = submitJobCall[0];
      
      expect(jobRequest.resourceRequirements.cpu.preferred).toBe(4);
      expect(jobRequest.resourceRequirements.memory.preferred).toBe('8GB');
    });
  });

  describe('Auto-scaling', () => {
    beforeEach(async () => {
      await enhancedOrchestrator.initialize();
    });

    it('should scale up when needed', async () => {
      // Simulate high load condition
      enhancedOrchestrator.emit('scaling:needed', { 
        direction: 'up', 
        reason: 'high load' 
      });

      // Wait for async scaling operation
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockContainerAssignment.scaleUp).toHaveBeenCalledWith(2);
    });

    it('should scale down when needed', async () => {
      // Simulate low load condition
      enhancedOrchestrator.emit('scaling:needed', { 
        direction: 'down', 
        reason: 'low load' 
      });

      // Wait for async scaling operation
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockContainerAssignment.scaleDown).toHaveBeenCalledWith(1);
    });
  });

  describe('Job Management', () => {
    beforeEach(async () => {
      await enhancedOrchestrator.initialize();
    });

    it('should cancel job successfully', async () => {
      const workflowJob = createMockWorkflowJob();

      // Queue a job first
      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });

      const cancelled = await enhancedOrchestrator.cancelJob('12345');

      expect(cancelled).toBe(true);
      expect(mockJobDistributionSystem.components.parallelExecutor.cancelExecution)
        .toHaveBeenCalledWith('plan-123');
      
      const activeJobs = enhancedOrchestrator.getActiveJobs();
      expect(activeJobs.has('12345')).toBe(false);
    });

    it('should return false when cancelling non-existent job', async () => {
      const cancelled = await enhancedOrchestrator.cancelJob('non-existent');
      expect(cancelled).toBe(false);
    });

    it('should get job status for active job', async () => {
      const workflowJob = createMockWorkflowJob();

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });

      const status = await enhancedOrchestrator.getJobStatus('12345');
      
      expect(status).toBeDefined();
      expect(status.jobId).toBe('12345');
      expect(status.status).toBe('queued');
    });

    it('should return null for non-existent job status', async () => {
      const status = await enhancedOrchestrator.getJobStatus('non-existent');
      expect(status).toBeNull();
    });
  });

  describe('Metrics and Monitoring', () => {
    beforeEach(async () => {
      await enhancedOrchestrator.initialize();
    });

    it('should provide orchestrator metrics', () => {
      const metrics = enhancedOrchestrator.getMetrics();
      
      expect(metrics).toMatchObject({
        totalJobsProcessed: expect.any(Number),
        activeJobs: expect.any(Number),
        queuedJobs: expect.any(Number),
        completedJobs: expect.any(Number),
        failedJobs: expect.any(Number),
        averageJobDuration: expect.any(Number),
        containerUtilization: expect.any(Number),
        errorRate: expect.any(Number)
      });
    });

    it('should track job completion metrics', async () => {
      const workflowJob = createMockWorkflowJob({ conclusion: 'success' });

      // Queue and complete a job
      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'completed',
        workflow_job: workflowJob
      });

      const metrics = enhancedOrchestrator.getMetrics();
      expect(metrics.completedJobs).toBe(1);
      expect(metrics.totalJobsProcessed).toBe(1);
    });
  });

  describe('Event Handling', () => {
    beforeEach(async () => {
      await enhancedOrchestrator.initialize();
    });

    it('should emit job events', async (done) => {
      const workflowJob = createMockWorkflowJob();
      let eventCount = 0;

      enhancedOrchestrator.on('job:queued', () => {
        eventCount++;
        if (eventCount === 1) done();
      });

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository: createMockRepository()
      });
    });

    it('should handle job distribution system events', () => {
      // Simulate job execution started event
      const eventHandler = mockJobDistributionSystem.components.parallelExecutor.on.mock.calls
        .find(call => call[0] === 'job_execution_started')?.[1];
      
      expect(eventHandler).toBeDefined();
      
      if (eventHandler) {
        eventHandler({ jobId: 'test-job', job: { status: 'executing' } });
        // This should not throw
      }
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await enhancedOrchestrator.initialize();
    });

    it('should handle job submission failure', async () => {
      mockJobDistributionSystem.submitJob.mockRejectedValueOnce(new Error('Submission failed'));

      const workflowJob = createMockWorkflowJob();
      const repository = createMockRepository();

      await enhancedOrchestrator.handleWorkflowJobEvent({
        action: 'queued',
        workflow_job: workflowJob,
        repository
      });

      expect(mockStatusReporter.reportJobCompleted).toHaveBeenCalledWith(
        '12345',
        'test/repo',
        'abc123',
        'Test Job',
        expect.any(Number),
        'failure',
        {
          title: 'Job Failed',
          summary: 'Job queueing failed: Submission failed'
        }
      );
    });

    it('should handle scaling failure gracefully', async () => {
      mockContainerAssignment.scaleUp.mockRejectedValueOnce(new Error('Scale up failed'));

      // This should not throw
      enhancedOrchestrator.emit('scaling:needed', { 
        direction: 'up', 
        reason: 'high load' 
      });

      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(enhancedOrchestrator.getStatus()).toBe(EnhancedOrchestratorStatus.ERROR);
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      await enhancedOrchestrator.initialize();
      await enhancedOrchestrator.shutdown();

      expect(mockJobDistributionSystem.shutdown).toHaveBeenCalled();
      expect(mockDockerIntegration.shutdown).toHaveBeenCalled();
      expect(mockLegacyOrchestrator.shutdown).toHaveBeenCalled();
      expect(enhancedOrchestrator.getStatus()).toBe(EnhancedOrchestratorStatus.STOPPED);
    });

    it('should handle shutdown when already shutting down', async () => {
      await enhancedOrchestrator.initialize();
      
      // Start two shutdown operations simultaneously
      const shutdown1 = enhancedOrchestrator.shutdown();
      const shutdown2 = enhancedOrchestrator.shutdown();
      
      await Promise.all([shutdown1, shutdown2]);
      
      // Should only call shutdown once
      expect(mockJobDistributionSystem.shutdown).toHaveBeenCalledTimes(1);
    });
  });
});