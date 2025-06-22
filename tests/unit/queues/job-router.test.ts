import { JobRouter } from '../../../src/queues/job-router';
import { QueueManager } from '../../../src/queues/queue-manager';
import { JobType, QUEUE_CONFIG } from '../../../src/queues/config/redis-config';

// Mock dependencies
jest.mock('../../../src/queues/queue-manager');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('JobRouter', () => {
  let jobRouter: JobRouter;
  let mockQueueManager: jest.Mocked<QueueManager>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton instance
    (JobRouter as any).instance = undefined;
    
    // Setup mock queue manager
    mockQueueManager = {
      addJob: jest.fn().mockResolvedValue({ id: 'job-123', queueName: 'test-queue' }),
      addBulkJobs: jest.fn().mockResolvedValue([
        { id: 'job-1', queueName: 'test-queue' },
        { id: 'job-2', queueName: 'test-queue' }
      ]),
      getQueueStats: jest.fn().mockResolvedValue({
        waiting: 10,
        active: 5,
        completed: 100,
        failed: 2,
        delayed: 3,
        paused: 0,
        total: 120
      }),
      getAllQueuesStats: jest.fn().mockResolvedValue({
        'job-execution': { total: 50, completed: 40, failed: 2 },
        'container-management': { total: 30, completed: 25, failed: 1 }
      })
    } as any;
    
    (QueueManager.getInstance as jest.Mock).mockReturnValue(mockQueueManager);
    
    jobRouter = JobRouter.getInstance();
  });
  
  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = JobRouter.getInstance();
      const instance2 = JobRouter.getInstance();
      expect(instance1).toBe(instance2);
    });
  });
  
  describe('Job Routing', () => {
    it('should route workflow execution job correctly', async () => {
      const jobRequest = {
        type: JobType.EXECUTE_WORKFLOW,
        data: {
          workflow: 'deploy-production',
          event: 'push'
        }
      };
      
      const job = await jobRouter.route(jobRequest);
      
      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        QUEUE_CONFIG.queues.JOB_EXECUTION,
        JobType.EXECUTE_WORKFLOW,
        jobRequest.data,
        expect.objectContaining({
          priority: QUEUE_CONFIG.priorities.NORMAL,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          }
        })
      );
      
      expect(job.id).toBe('job-123');
    });
    
    it('should assign critical priority to deploy workflows', async () => {
      const jobRequest = {
        type: JobType.EXECUTE_WORKFLOW,
        data: {
          workflow: 'deploy-production',
          event: 'workflow_dispatch'
        }
      };
      
      await jobRouter.route(jobRequest);
      
      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          priority: QUEUE_CONFIG.priorities.CRITICAL
        })
      );
    });
    
    it('should route container creation with custom priority', async () => {
      const jobRequest = {
        type: JobType.CREATE_CONTAINER,
        data: {
          image: 'node:20',
          urgent: true
        }
      };
      
      await jobRouter.route(jobRequest);
      
      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        QUEUE_CONFIG.queues.CONTAINER_MANAGEMENT,
        JobType.CREATE_CONTAINER,
        expect.any(Object),
        expect.objectContaining({
          priority: QUEUE_CONFIG.priorities.HIGH
        })
      );
    });
    
    it('should route alert based on severity', async () => {
      const jobRequest = {
        type: JobType.SEND_ALERT,
        data: {
          severity: 'critical',
          message: 'System down'
        }
      };
      
      await jobRouter.route(jobRequest);
      
      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        QUEUE_CONFIG.queues.MONITORING,
        JobType.SEND_ALERT,
        expect.any(Object),
        expect.objectContaining({
          priority: QUEUE_CONFIG.priorities.CRITICAL
        })
      );
    });
    
    it('should throw error for unknown job type', async () => {
      const jobRequest = {
        type: 'UNKNOWN_JOB' as JobType,
        data: {}
      };
      
      await expect(jobRouter.route(jobRequest)).rejects.toThrow(
        'No routing rule defined for job type: UNKNOWN_JOB'
      );
    });
    
    it('should use custom options if provided', async () => {
      const jobRequest = {
        type: JobType.CLEANUP_RUNNER,
        data: { runnerId: 'runner-123' },
        delay: 60000,
        attempts: 5,
        priority: QUEUE_CONFIG.priorities.CRITICAL
      };
      
      await jobRouter.route(jobRequest);
      
      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          delay: 60000,
          attempts: 5,
          priority: QUEUE_CONFIG.priorities.CRITICAL
        })
      );
    });
  });
  
  describe('Batch Routing', () => {
    it('should route multiple jobs efficiently', async () => {
      const jobRequests = [
        {
          type: JobType.EXECUTE_WORKFLOW,
          data: { workflow: 'test-1' }
        },
        {
          type: JobType.CREATE_CONTAINER,
          data: { image: 'nginx' }
        },
        {
          type: JobType.COLLECT_METRICS,
          data: { targets: ['system'] }
        }
      ];
      
      const results = await jobRouter.routeBatch(jobRequests);
      
      expect(results).toHaveLength(2); // Mocked to return 2 jobs
      expect(mockQueueManager.addBulkJobs).toHaveBeenCalled();
    });
    
    it('should group jobs by queue', async () => {
      const jobRequests = [
        {
          type: JobType.EXECUTE_WORKFLOW,
          data: { id: 1 }
        },
        {
          type: JobType.PREPARE_RUNNER,
          data: { id: 2 }
        },
        {
          type: JobType.CREATE_CONTAINER,
          data: { id: 3 }
        }
      ];
      
      await jobRouter.routeBatch(jobRequests);
      
      // Should be called twice - once for job-execution queue, once for container-management
      expect(mockQueueManager.addBulkJobs).toHaveBeenCalledTimes(2);
    });
    
    it('should skip jobs with no routing rules', async () => {
      const jobRequests = [
        {
          type: JobType.EXECUTE_WORKFLOW,
          data: { id: 1 }
        },
        {
          type: 'INVALID_TYPE' as JobType,
          data: { id: 2 }
        }
      ];
      
      const results = await jobRouter.routeBatch(jobRequests);
      
      // Only valid job should be routed
      expect(mockQueueManager.addBulkJobs).toHaveBeenCalledTimes(1);
      
      const { logger } = require('../../../src/utils/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        'No routing rule for job type: INVALID_TYPE, skipping'
      );
    });
  });
  
  describe('Priority Calculation', () => {
    it('should calculate workflow priority based on event type', async () => {
      const testCases = [
        {
          data: { workflow: 'deploy-api', event: 'push' },
          expectedPriority: QUEUE_CONFIG.priorities.CRITICAL
        },
        {
          data: { workflow: 'test', event: 'pull_request' },
          expectedPriority: QUEUE_CONFIG.priorities.HIGH
        },
        {
          data: { workflow: 'build', event: 'push' },
          expectedPriority: QUEUE_CONFIG.priorities.NORMAL
        },
        {
          data: { workflow: 'cleanup', event: 'schedule' },
          expectedPriority: QUEUE_CONFIG.priorities.LOW
        }
      ];
      
      for (const testCase of testCases) {
        await jobRouter.route({
          type: JobType.EXECUTE_WORKFLOW,
          data: testCase.data
        });
        
        const lastCall = mockQueueManager.addJob.mock.calls.slice(-1)[0];
        expect(lastCall[3].priority).toBe(testCase.expectedPriority);
      }
    });
    
    it('should calculate webhook priority based on event', async () => {
      const eventPriorities = {
        workflow_job: QUEUE_CONFIG.priorities.CRITICAL,
        workflow_run: QUEUE_CONFIG.priorities.HIGH,
        pull_request: QUEUE_CONFIG.priorities.NORMAL,
        repository: QUEUE_CONFIG.priorities.LOW
      };
      
      for (const [event, priority] of Object.entries(eventPriorities)) {
        await jobRouter.route({
          type: JobType.PROCESS_WEBHOOK,
          data: { event }
        });
        
        const lastCall = mockQueueManager.addJob.mock.calls.slice(-1)[0];
        expect(lastCall[3].priority).toBe(priority);
      }
    });
  });
  
  describe('Queue Management', () => {
    it('should get queue distribution', async () => {
      const distribution = await jobRouter.getQueueDistribution();
      
      expect(distribution).toEqual({
        'job-execution': 120,
        'container-management': 120,
        'monitoring': 120,
        'cleanup': 120,
        'webhook-processing': 120,
        'metrics-collection': 120
      });
    });
    
    it('should optimize routing based on queue performance', async () => {
      // Mock different queue performances
      mockQueueManager.getAllQueuesStats.mockResolvedValue({
        'job-execution': {
          waiting: 200,
          active: 10,
          completed: 100,
          failed: 50,
          delayed: 10,
          total: 370
        },
        'container-management': {
          waiting: 5,
          active: 2,
          completed: 100,
          failed: 1,
          delayed: 0,
          total: 108
        }
      });
      
      await jobRouter.optimizeRouting();
      
      const { logger } = require('../../../src/utils/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('high backlog')
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('low throughput')
      );
    });
  });
  
  describe('Routing Rules', () => {
    it('should allow updating routing rules', () => {
      const customRule = jest.fn().mockReturnValue({
        queue: 'custom-queue',
        priority: 1,
        jobOptions: {}
      });
      
      jobRouter.updateRoutingRule(JobType.EXECUTE_WORKFLOW, customRule);
      
      const rules = jobRouter.getRoutingRules();
      expect(rules.get(JobType.EXECUTE_WORKFLOW)).toBe(customRule);
    });
    
    it('should apply recurring job patterns', async () => {
      await jobRouter.route({
        type: JobType.COLLECT_METRICS,
        data: { interval: 30000 }
      });
      
      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          repeat: {
            every: 30000
          }
        })
      );
    });
    
    it('should apply cron patterns for cleanup jobs', async () => {
      await jobRouter.route({
        type: JobType.CLEANUP_OLD_JOBS,
        data: { cronPattern: '0 0 * * *' }
      });
      
      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          repeat: {
            pattern: '0 0 * * *'
          }
        })
      );
    });
  });
});