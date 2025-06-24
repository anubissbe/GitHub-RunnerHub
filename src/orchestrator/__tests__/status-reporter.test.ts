import { StatusReporter, JobStatus, JobStatusType, JobConclusion } from '../status-reporter';
import { DatabaseService } from '../../services/database-service';
import { GitHubService } from '../../services/github-service';
import { MetricsCollector } from '../../services/metrics-collector';

// Mock dependencies
jest.mock('../../utils/logger');
jest.mock('../../services/github-service');
jest.mock('../../services/database-service');
jest.mock('../../services/metrics-collector');

describe('StatusReporter', () => {
  let statusReporter: StatusReporter;

  beforeEach(() => {
    // Reset singleton instance
    (StatusReporter as any).instance = null;
    statusReporter = StatusReporter.getInstance({
      batchSize: 5,
      reportInterval: 1000,
      retryAttempts: 2,
      retryDelay: 100
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      (DatabaseService.getInstance().getPendingStatusUpdates as jest.Mock).mockResolvedValue([]);

      await statusReporter.initialize();

      expect(DatabaseService.getInstance().getPendingStatusUpdates).toHaveBeenCalled();
    });

    it('should recover pending status updates', async () => {
      const pendingUpdates: JobStatus[] = [
        {
          id: 'job-1',
          repository: 'test/repo',
          sha: 'abc123',
          runId: 456,
          name: 'test-job',
          status: JobStatusType.IN_PROGRESS
        }
      ];

      (DatabaseService.getInstance().getPendingStatusUpdates as jest.Mock).mockResolvedValue(pendingUpdates);

      await statusReporter.initialize();

      const stats = statusReporter.getStatistics();
      expect(stats.queueSize).toBe(1);
    });
  });

  describe('job status reporting', () => {
    beforeEach(async () => {
      await statusReporter.initialize();
    });

    it('should queue job status for reporting', async () => {
      const jobStatus: JobStatus = {
        id: 'job-1',
        repository: 'test/repo',
        sha: 'abc123',
        runId: 456,
        name: 'test-job',
        status: JobStatusType.QUEUED,
        output: {
          title: 'Test Job - Queued',
          summary: 'Job has been queued'
        }
      };

      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);

      let queuedEvent: any = null;
      statusReporter.on('status:queued', (status) => {
        queuedEvent = status;
      });

      await statusReporter.reportJobStatus(jobStatus);

      expect(queuedEvent).toEqual(jobStatus);
      expect(statusReporter.getStatistics().queueSize).toBe(1);
    });

    it('should report job started', async () => {
      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);

      await statusReporter.reportJobStarted('job-1', 'test/repo', 'abc123', 'test-job', 456);

      const stats = statusReporter.getStatistics();
      expect(stats.queueSize).toBe(1);
    });

    it('should report job completed', async () => {
      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);

      await statusReporter.reportJobCompleted(
        'job-1',
        'test/repo',
        'abc123',
        'test-job',
        456,
        JobConclusion.SUCCESS,
        {
          title: 'Test Job - Success',
          summary: 'Job completed successfully'
        }
      );

      const stats = statusReporter.getStatistics();
      expect(stats.queueSize).toBe(1);
    });
  });

  describe('step status reporting', () => {
    beforeEach(async () => {
      await statusReporter.initialize();
      
      // Add a job to the queue first
      const jobStatus: JobStatus = {
        id: 'job-1',
        repository: 'test/repo',
        sha: 'abc123',
        runId: 456,
        name: 'test-job',
        status: JobStatusType.IN_PROGRESS
      };

      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);

      await statusReporter.reportJobStatus(jobStatus);
    });

    it('should update step status', async () => {
      const stepStatus = {
        number: 1,
        name: 'Checkout code',
        status: 'completed' as const,
        conclusion: 'success' as const,
        started_at: new Date(Date.now() - 60000),
        completed_at: new Date()
      };

      await statusReporter.reportStepStatus('job-1', stepStatus);

      // Verify step was added to job status
      const stats = statusReporter.getStatistics();
      expect(stats.queueSize).toBe(1);
    });

    it('should generate step summary', async () => {
      const steps = [
        {
          number: 1,
          name: 'Checkout code',
          status: 'completed' as const,
          conclusion: 'success' as const,
          started_at: new Date(Date.now() - 120000),
          completed_at: new Date(Date.now() - 60000)
        },
        {
          number: 2,
          name: 'Run tests',
          status: 'in_progress' as const,
          started_at: new Date(Date.now() - 60000)
        }
      ];

      for (const step of steps) {
        await statusReporter.reportStepStatus('job-1', step);
      }

      // The step summary would be generated in the job output
      const stats = statusReporter.getStatistics();
      expect(stats.queueSize).toBe(1);
    });
  });

  describe('batch processing', () => {
    beforeEach(async () => {
      await statusReporter.initialize();
    });

    it('should process status queue in batches', async () => {

      GitHubService.getInstance().createCheckRun.mockResolvedValue({ id: 123 });
      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);
      DatabaseService.getInstance().updateJobCheckRunId.mockResolvedValue(undefined);
      DatabaseService.getInstance().markJobStatusReported.mockResolvedValue(undefined);
      MetricsCollector.getInstance().recordStatusReports.mockResolvedValue(undefined);

      // Add multiple jobs to trigger batch processing
      const jobStatuses: JobStatus[] = [];
      for (let i = 1; i <= 6; i++) {
        jobStatuses.push({
          id: `job-${i}`,
          repository: 'test/repo',
          sha: 'abc123',
          runId: 456 + i,
          name: `test-job-${i}`,
          status: JobStatusType.COMPLETED,
          conclusion: JobConclusion.SUCCESS
        });
      }

      let reportedCount = 0;
      statusReporter.on('status:reported', () => {
        reportedCount++;
      });

      // Queue all jobs
      for (const jobStatus of jobStatuses) {
        await statusReporter.reportJobStatus(jobStatus);
      }

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(reportedCount).toBe(6);
      expect(GitHubService.getInstance().createCheckRun).toHaveBeenCalledTimes(6);
    });

    it('should handle reporting failures with retries', async () => {

      // Mock failure then success
      GitHubService.getInstance().createCheckRun
        .mockRejectedValueOnce(new Error('API rate limit'))
        .mockResolvedValue({ id: 123 });

      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);
      DatabaseService.getInstance().updateJobCheckRunId.mockResolvedValue(undefined);
      DatabaseService.getInstance().markJobStatusReported.mockResolvedValue(undefined);

      const jobStatus: JobStatus = {
        id: 'job-1',
        repository: 'test/repo',
        sha: 'abc123',
        runId: 456,
        name: 'test-job',
        status: JobStatusType.COMPLETED,
        conclusion: JobConclusion.SUCCESS
      };

      let reportedEvent: any = null;
      statusReporter.on('status:reported', (status) => {
        reportedEvent = status;
      });

      await statusReporter.reportJobStatus(jobStatus);

      // Trigger immediate processing
      await (statusReporter as any).processStatusQueue();

      expect(reportedEvent).toBeTruthy();
      expect(GitHubService.getInstance().createCheckRun).toHaveBeenCalledTimes(2); // Initial failure + retry
    });

    it('should emit failure event after max retries', async () => {

      // Mock persistent failure
      GitHubService.getInstance().createCheckRun.mockRejectedValue(new Error('Persistent failure'));
      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);

      const jobStatus: JobStatus = {
        id: 'job-1',
        repository: 'test/repo',
        sha: 'abc123',
        runId: 456,
        name: 'test-job',
        status: JobStatusType.COMPLETED,
        conclusion: JobConclusion.SUCCESS
      };

      let failedEvent: any = null;
      statusReporter.on('status:failed', (event) => {
        failedEvent = event;
      });

      await statusReporter.reportJobStatus(jobStatus);

      // Trigger immediate processing
      await (statusReporter as any).processStatusQueue();

      expect(failedEvent).toBeTruthy();
      expect(failedEvent.status).toEqual(jobStatus);
      expect(GitHubService.getInstance().createCheckRun).toHaveBeenCalledTimes(2); // Max retries
    });
  });

  describe('GitHub integration', () => {
    beforeEach(async () => {
      await statusReporter.initialize();
    });

    it('should create check run for new job', async () => {

      GitHubService.getInstance().createCheckRun.mockResolvedValue({ id: 123 });
      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);
      DatabaseService.getInstance().updateJobCheckRunId.mockResolvedValue(undefined);
      DatabaseService.getInstance().markJobStatusReported.mockResolvedValue(undefined);

      const jobStatus: JobStatus = {
        id: 'job-1',
        repository: 'test/repo',
        sha: 'abc123',
        runId: 456,
        name: 'test-job',
        status: JobStatusType.IN_PROGRESS,
        startedAt: new Date(),
        output: {
          title: 'Test Job - In Progress',
          summary: 'Job execution started'
        }
      };

      await statusReporter.reportJobStatus(jobStatus);
      await (statusReporter as any).processStatusQueue();

      expect(GitHubService.getInstance().createCheckRun).toHaveBeenCalledWith(
        'test/repo',
        expect.objectContaining({
          name: 'test-job',
          head_sha: 'abc123',
          status: 'in_progress',
          started_at: expect.any(String),
          output: jobStatus.output
        })
      );
    });

    it('should update existing check run', async () => {

      GitHubService.getInstance().updateCheckRun.mockResolvedValue(undefined);
      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);
      DatabaseService.getInstance().markJobStatusReported.mockResolvedValue(undefined);

      const jobStatus: JobStatus = {
        id: 'job-1',
        repository: 'test/repo',
        sha: 'abc123',
        runId: 456,
        checkRunId: 123, // Existing check run
        name: 'test-job',
        status: JobStatusType.COMPLETED,
        conclusion: JobConclusion.SUCCESS,
        completedAt: new Date(),
        output: {
          title: 'Test Job - Success',
          summary: 'Job completed successfully'
        }
      };

      await statusReporter.reportJobStatus(jobStatus);
      await (statusReporter as any).processStatusQueue();

      expect(GitHubService.getInstance().updateCheckRun).toHaveBeenCalledWith(
        'test/repo',
        123,
        expect.objectContaining({
          status: 'completed',
          conclusion: 'success',
          completed_at: expect.any(String),
          output: jobStatus.output
        })
      );
    });
  });

  describe('logs reporting', () => {
    beforeEach(async () => {
      await statusReporter.initialize();
    });

    it('should report logs', async () => {
      DatabaseService.getInstance().appendJobLogs.mockResolvedValue(undefined);

      let logsEvent: any = null;
      statusReporter.on('logs:received', (event) => {
        logsEvent = event;
      });

      await statusReporter.reportLogs('job-1', 'Test log message', 'info');

      expect(logsEvent).toEqual({
        jobId: 'job-1',
        logs: 'Test log message',
        level: 'info'
      });

      expect(DatabaseService.getInstance().appendJobLogs).toHaveBeenCalledWith(
        'job-1',
        'Test log message',
        'info'
      );
    });
  });

  describe('annotations', () => {
    it('should create annotations from test results', () => {
      const testResults = [
        {
          name: 'should pass',
          status: 'passed',
          file: 'test/example.test.js',
          line: 10
        },
        {
          name: 'should fail',
          status: 'failed',
          file: 'test/example.test.js',
          line: 20,
          message: 'Expected true but got false',
          stack: 'Error: Expected true but got false\n    at test/example.test.js:20:5'
        }
      ];

      const annotations = statusReporter.createAnnotationsFromTestResults(testResults);

      expect(annotations).toHaveLength(1); // Only failed tests become annotations
      expect(annotations[0]).toMatchObject({
        path: 'test/example.test.js',
        start_line: 20,
        end_line: 20,
        annotation_level: 'failure',
        message: 'Expected true but got false',
        title: 'should fail',
        raw_details: 'Error: Expected true but got false\n    at test/example.test.js:20:5'
      });
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      await statusReporter.initialize();
    });

    it('should return current statistics', async () => {
      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);

      // Add some jobs to the queue
      for (let i = 1; i <= 3; i++) {
        await statusReporter.reportJobStatus({
          id: `job-${i}`,
          repository: 'test/repo',
          sha: 'abc123',
          runId: 456 + i,
          name: `test-job-${i}`,
          status: JobStatusType.QUEUED
        });
      }

      const stats = statusReporter.getStatistics();

      expect(stats).toMatchObject({
        queueSize: 3,
        isReporting: false,
        config: expect.objectContaining({
          batchSize: 5,
          reportInterval: 1000,
          retryAttempts: 2,
          retryDelay: 100
        })
      });
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await statusReporter.initialize();
    });

    it('should process remaining queue during shutdown', async () => {

      GitHubService.getInstance().createCheckRun.mockResolvedValue({ id: 123 });
      DatabaseService.getInstance().saveJobStatus.mockResolvedValue(undefined);
      DatabaseService.getInstance().updateJobCheckRunId.mockResolvedValue(undefined);
      DatabaseService.getInstance().markJobStatusReported.mockResolvedValue(undefined);

      // Add job to queue
      await statusReporter.reportJobStatus({
        id: 'job-1',
        repository: 'test/repo',
        sha: 'abc123',
        runId: 456,
        name: 'test-job',
        status: JobStatusType.QUEUED
      });

      await statusReporter.shutdown();

      expect(GitHubService.getInstance().createCheckRun).toHaveBeenCalled();
    });
  });
});