import { RetryHandler } from '../../../src/queues/retry-handler';
import { JobType } from '../../../src/queues/config/redis-config';
import { Job, UnrecoverableError } from 'bullmq';

// Mock dependencies
jest.mock('../../../src/services/alerting-service');
jest.mock('../../../src/services/database-service');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('RetryHandler', () => {
  let retryHandler: RetryHandler;
  let mockJob: Partial<Job>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton instance
    (RetryHandler as any).instance = undefined;
    
    retryHandler = RetryHandler.getInstance();
    
    // Setup mock job
    mockJob = {
      id: 'job-123',
      name: JobType.EXECUTE_WORKFLOW,
      data: { type: JobType.EXECUTE_WORKFLOW, data: { test: true } },
      attemptsMade: 1,
      queue: {
        add: jest.fn()
      } as any
    };
  });
  
  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = RetryHandler.getInstance();
      const instance2 = RetryHandler.getInstance();
      expect(instance1).toBe(instance2);
    });
  });
  
  describe('Retry Strategies', () => {
    it('should have retry strategy for each job type', () => {
      for (const jobType of Object.values(JobType)) {
        const strategy = retryHandler.getRetryStrategy(jobType as JobType);
        expect(strategy).toBeDefined();
      }
    });
    
    it('should return correct strategy for workflow execution', () => {
      const strategy = retryHandler.getRetryStrategy(JobType.EXECUTE_WORKFLOW);
      
      expect(strategy).toEqual({
        maxAttempts: 3,
        backoffType: 'exponential',
        backoffDelay: 5000,
        backoffMultiplier: 2,
        maxBackoffDelay: 60000,
        retryableErrors: [
          'DOCKER_DAEMON_ERROR',
          'NETWORK_TIMEOUT',
          'RESOURCE_TEMPORARILY_UNAVAILABLE'
        ],
        nonRetryableErrors: [
          'INVALID_WORKFLOW_CONFIGURATION',
          'AUTHENTICATION_FAILED',
          'REPOSITORY_NOT_FOUND'
        ]
      });
    });
    
    it('should update retry strategy', () => {
      const newStrategy = {
        maxAttempts: 5,
        backoffDelay: 10000
      };
      
      retryHandler.updateRetryStrategy(JobType.EXECUTE_WORKFLOW, newStrategy);
      
      const updatedStrategy = retryHandler.getRetryStrategy(JobType.EXECUTE_WORKFLOW);
      expect(updatedStrategy?.maxAttempts).toBe(5);
      expect(updatedStrategy?.backoffDelay).toBe(10000);
    });
  });
  
  describe('Backoff Calculation', () => {
    it('should calculate fixed backoff', () => {
      const delay = retryHandler.calculateBackoff(JobType.PREPARE_RUNNER, 3);
      expect(delay).toBe(2000); // Fixed delay
    });
    
    it('should calculate exponential backoff', () => {
      const delays = [
        retryHandler.calculateBackoff(JobType.EXECUTE_WORKFLOW, 1),
        retryHandler.calculateBackoff(JobType.EXECUTE_WORKFLOW, 2),
        retryHandler.calculateBackoff(JobType.EXECUTE_WORKFLOW, 3)
      ];
      
      expect(delays[0]).toBe(5000); // Base delay
      expect(delays[1]).toBe(10000); // 5000 * 2^1
      expect(delays[2]).toBe(20000); // 5000 * 2^2
    });
    
    it('should respect max backoff delay', () => {
      // Large attempt number should be capped
      const delay = retryHandler.calculateBackoff(JobType.EXECUTE_WORKFLOW, 10);
      expect(delay).toBe(60000); // Max delay
    });
    
    it('should calculate linear backoff', () => {
      const delays = [
        retryHandler.calculateBackoff(JobType.DESTROY_CONTAINER, 1),
        retryHandler.calculateBackoff(JobType.DESTROY_CONTAINER, 2),
        retryHandler.calculateBackoff(JobType.DESTROY_CONTAINER, 3)
      ];
      
      expect(delays[0]).toBe(1000); // Base delay
      expect(delays[1]).toBe(2000); // 1000 + 1000
      expect(delays[2]).toBe(3000); // 1000 + 2000
    });
    
    it('should return 0 for unknown job type', () => {
      const delay = retryHandler.calculateBackoff('UNKNOWN' as JobType, 1);
      expect(delay).toBe(0);
    });
  });
  
  describe('Failure Handling', () => {
    it('should handle retryable errors', async () => {
      const error = new Error('NETWORK_TIMEOUT');
      mockJob.name = JobType.EXECUTE_WORKFLOW;
      mockJob.attemptsMade = 1;
      
      await expect(
        retryHandler.handleJobFailure(mockJob as Job, error)
      ).rejects.toThrow(error);
      
      const { logger } = require('../../../src/utils/logger');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('will retry')
      );
    });
    
    it('should throw UnrecoverableError for non-retryable errors', async () => {
      const error = new Error('AUTHENTICATION_FAILED');
      mockJob.name = JobType.EXECUTE_WORKFLOW;
      
      await expect(
        retryHandler.handleJobFailure(mockJob as Job, error)
      ).rejects.toThrow(UnrecoverableError);
    });
    
    it('should throw UnrecoverableError when max attempts reached', async () => {
      const error = new Error('NETWORK_TIMEOUT');
      mockJob.name = JobType.EXECUTE_WORKFLOW;
      mockJob.attemptsMade = 3; // Max attempts for EXECUTE_WORKFLOW
      
      await expect(
        retryHandler.handleJobFailure(mockJob as Job, error)
      ).rejects.toThrow(UnrecoverableError);
      
      await expect(
        retryHandler.handleJobFailure(mockJob as Job, error)
      ).rejects.toThrow('Max attempts (3) reached');
    });
    
    it('should not retry health check jobs', async () => {
      const error = new Error('Health check failed');
      mockJob.name = JobType.HEALTH_CHECK;
      mockJob.attemptsMade = 1;
      
      // Health checks have maxAttempts = 1
      await expect(
        retryHandler.handleJobFailure(mockJob as Job, error)
      ).rejects.toThrow(UnrecoverableError);
    });
  });
  
  describe('Failure Handlers', () => {
    it('should execute custom failure handler for workflow execution', async () => {
      const error = new Error('Workflow failed');
      mockJob.name = JobType.EXECUTE_WORKFLOW;
      mockJob.data = {
        type: JobType.EXECUTE_WORKFLOW,
        data: { runId: 'run-123' }
      };
      mockJob.attemptsMade = 3;
      
      const handler = retryHandler.getFailureHandler(JobType.EXECUTE_WORKFLOW);
      await handler.onMaxAttemptsReached(mockJob as Job, error);
      
      // Should trigger cleanup
      expect(mockJob.queue?.add).toHaveBeenCalled();
    });
    
    it('should execute fallback alert for failed alerts', async () => {
      const error = new Error('Alert delivery failed');
      mockJob.name = JobType.SEND_ALERT;
      mockJob.data = {
        type: JobType.SEND_ALERT,
        data: { severity: 'critical', message: 'System down' }
      };
      mockJob.attemptsMade = 5;
      
      const handler = retryHandler.getFailureHandler(JobType.SEND_ALERT);
      await handler.onMaxAttemptsReached(mockJob as Job, error);
      
      const { logger } = require('../../../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Critical: Alert delivery failed')
      );
    });
  });
  
  describe('Worker Integration', () => {
    it('should attach to worker and handle events', () => {
      const mockWorker = {
        on: jest.fn()
      };
      
      retryHandler.attachToWorker(mockWorker as any);
      
      expect(mockWorker.on).toHaveBeenCalledWith('failed', expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith('stalled', expect.any(Function));
    });
    
    it('should handle failed event', async () => {
      const mockWorker = {
        on: jest.fn()
      };
      
      retryHandler.attachToWorker(mockWorker as any);
      
      // Get the failed handler
      const failedHandler = mockWorker.on.mock.calls.find(
        call => call[0] === 'failed'
      )[1];
      
      const error = new Error('Job failed');
      await failedHandler(mockJob, error);
      
      const { logger } = require('../../../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Job job-123 failed:'),
        error
      );
    });
    
    it('should handle stalled event', async () => {
      const mockWorker = {
        on: jest.fn()
      };
      
      retryHandler.attachToWorker(mockWorker as any);
      
      // Get the stalled handler
      const stalledHandler = mockWorker.on.mock.calls.find(
        call => call[0] === 'stalled'
      )[1];
      
      await stalledHandler('job-456');
      
      const { logger } = require('../../../src/utils/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        'Job job-456 stalled, will be retried'
      );
    });
  });
  
  describe('Failure Statistics', () => {
    it('should return failure stats', async () => {
      const { DatabaseService } = require('../../../src/services/database-service');
      DatabaseService.getInstance.mockReturnValue({
        getJobFailureStats: jest.fn().mockResolvedValue({
          total: 100,
          byType: { [JobType.EXECUTE_WORKFLOW]: 50 },
          byError: { 'NETWORK_TIMEOUT': 30 },
          averageAttempts: 2.5,
          recent: []
        })
      });
      
      const stats = await retryHandler.getFailureStats();
      
      expect(stats).toEqual({
        totalFailures: 100,
        failuresByType: { [JobType.EXECUTE_WORKFLOW]: 50 },
        failuresByError: { 'NETWORK_TIMEOUT': 30 },
        averageAttempts: 2.5,
        recentFailures: []
      });
    });
  });
});