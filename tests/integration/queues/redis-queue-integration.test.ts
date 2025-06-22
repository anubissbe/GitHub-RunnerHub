import { QueueManager } from '../../../src/queues/queue-manager';
import { JobRouter } from '../../../src/queues/job-router';
import { JobType, QUEUE_CONFIG } from '../../../src/queues/config/redis-config';
import Redis from 'ioredis';
import { Job } from 'bullmq';

// Integration test - requires Redis running
describe('Redis Queue Integration', () => {
  let queueManager: QueueManager;
  let jobRouter: JobRouter;
  let redisClient: Redis;
  
  beforeAll(async () => {
    // Check if Redis is available
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: 1
    });
    
    try {
      await redisClient.ping();
    } catch (error) {
      console.log('Redis not available, skipping integration tests');
      return;
    }
    
    // Initialize queue system
    queueManager = QueueManager.getInstance();
    await queueManager.initialize();
    
    jobRouter = JobRouter.getInstance();
  });
  
  afterAll(async () => {
    if (queueManager) {
      // Clean up all queues
      for (const queueName of Object.values(QUEUE_CONFIG.queues)) {
        await queueManager.drainQueue(queueName, true);
      }
      
      await queueManager.shutdown();
    }
    
    if (redisClient) {
      await redisClient.quit();
    }
  });
  
  describe('Job Lifecycle', () => {
    it('should add and process a job', async () => {
      const jobData = {
        type: JobType.HEALTH_CHECK,
        data: {
          containerId: 'test-container-123'
        }
      };
      
      // Add job
      const job = await jobRouter.route(jobData);
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      
      // Check job state
      const state = await job.getState();
      expect(['waiting', 'active']).toContain(state);
      
      // Wait for job to complete (health checks are quick)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Job should be processed
      const updatedState = await job.getState();
      expect(['completed', 'failed']).toContain(updatedState);
    });
    
    it('should handle job priority correctly', async () => {
      const queue = queueManager.getQueue(QUEUE_CONFIG.queues.JOB_EXECUTION);
      if (!queue) throw new Error('Queue not found');
      
      // Clear queue
      await queue.drain(true);
      
      // Add jobs with different priorities
      const highPriorityJob = await jobRouter.route({
        type: JobType.EXECUTE_WORKFLOW,
        data: { workflow: 'deploy-hotfix' },
        priority: QUEUE_CONFIG.priorities.CRITICAL
      });
      
      const lowPriorityJob = await jobRouter.route({
        type: JobType.CLEANUP_RUNNER,
        data: { runnerId: 'runner-123' },
        priority: QUEUE_CONFIG.priorities.LOW
      });
      
      const normalPriorityJob = await jobRouter.route({
        type: JobType.PREPARE_RUNNER,
        data: { runnerId: 'runner-456' }
      });
      
      // Check job order in queue
      const waitingJobs = await queue.getWaiting();
      const jobIds = waitingJobs.map(j => j.id);
      
      // High priority should be processed first
      expect(jobIds.indexOf(highPriorityJob.id)).toBeLessThan(
        jobIds.indexOf(normalPriorityJob.id)
      );
      expect(jobIds.indexOf(normalPriorityJob.id)).toBeLessThan(
        jobIds.indexOf(lowPriorityJob.id)
      );
    });
    
    it('should handle bulk job addition', async () => {
      const jobs = Array.from({ length: 10 }, (_, i) => ({
        type: JobType.COLLECT_METRICS,
        data: {
          targets: ['system'],
          iteration: i
        }
      }));
      
      const results = await jobRouter.routeBatch(jobs);
      
      expect(results).toHaveLength(10);
      results.forEach(job => {
        expect(job.id).toBeDefined();
      });
      
      // Check queue stats
      const stats = await queueManager.getQueueStats(QUEUE_CONFIG.queues.MONITORING);
      expect(stats.total).toBeGreaterThanOrEqual(10);
    });
  });
  
  describe('Queue Operations', () => {
    it('should pause and resume queue', async () => {
      const queueName = QUEUE_CONFIG.queues.CLEANUP;
      
      // Add a job
      await jobRouter.route({
        type: JobType.CLEANUP_LOGS,
        data: { maxAge: 1000 }
      });
      
      // Pause queue
      await queueManager.pauseQueue(queueName);
      
      // Check if paused
      const pausedStats = await queueManager.getQueueStats(queueName);
      expect(pausedStats.paused).toBeGreaterThan(0);
      
      // Resume queue
      await queueManager.resumeQueue(queueName);
      
      // Check if resumed
      const resumedStats = await queueManager.getQueueStats(queueName);
      expect(resumedStats.paused).toBe(0);
    });
    
    it('should clean completed jobs', async () => {
      const queueName = QUEUE_CONFIG.queues.MONITORING;
      const queue = queueManager.getQueue(queueName);
      if (!queue) throw new Error('Queue not found');
      
      // Add and complete some jobs
      const jobPromises = Array.from({ length: 5 }, async () => {
        const job = await queue.add('test-completed', { test: true });
        await job.updateProgress(100);
        await job.moveToCompleted('done', true);
        return job;
      });
      
      await Promise.all(jobPromises);
      
      // Clean completed jobs older than 0ms (all)
      const cleaned = await queueManager.cleanQueue(queueName, 0, 100, 'completed');
      
      expect(cleaned.length).toBeGreaterThan(0);
    });
  });
  
  describe('Error Handling', () => {
    it('should retry failed jobs', async () => {
      // Create a job that will fail
      const job = await queueManager.addJob(
        QUEUE_CONFIG.queues.JOB_EXECUTION,
        JobType.EXECUTE_WORKFLOW,
        {
          type: JobType.EXECUTE_WORKFLOW,
          data: {
            workflow: 'test-fail',
            shouldFail: true
          }
        },
        {
          attempts: 3,
          backoff: {
            type: 'fixed',
            delay: 100
          }
        }
      );
      
      // Wait for first attempt
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Check attempts
      const updatedJob = await job.queue.getJob(job.id!);
      if (updatedJob) {
        expect(updatedJob.attemptsMade).toBeGreaterThan(0);
      }
    });
    
    it('should move job to failed after max attempts', async () => {
      const job = await queueManager.addJob(
        QUEUE_CONFIG.queues.CONTAINER_MANAGEMENT,
        JobType.CREATE_CONTAINER,
        {
          type: JobType.CREATE_CONTAINER,
          data: {
            image: 'invalid:image:name',
            shouldFail: true
          }
        },
        {
          attempts: 2,
          backoff: {
            type: 'fixed',
            delay: 100
          }
        }
      );
      
      // Wait for retries to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check final state
      const finalState = await job.getState();
      expect(finalState).toBe('failed');
      
      // Check failed reason
      const failedJob = await job.queue.getJob(job.id!);
      if (failedJob) {
        expect(failedJob.failedReason).toBeDefined();
        expect(failedJob.attemptsMade).toBe(2);
      }
    });
  });
  
  describe('Queue Statistics', () => {
    it('should provide accurate queue statistics', async () => {
      const queueName = QUEUE_CONFIG.queues.WEBHOOK_PROCESSING;
      
      // Clear queue
      await queueManager.drainQueue(queueName, true);
      
      // Add various jobs
      await jobRouter.route({
        type: JobType.PROCESS_WEBHOOK,
        data: { event: 'push' }
      });
      
      await jobRouter.route({
        type: JobType.PROCESS_WEBHOOK,
        data: { event: 'pull_request' },
        delay: 5000 // Delayed job
      });
      
      // Get stats
      const stats = await queueManager.getQueueStats(queueName);
      
      expect(stats).toMatchObject({
        waiting: expect.any(Number),
        active: expect.any(Number),
        completed: expect.any(Number),
        failed: expect.any(Number),
        delayed: expect.any(Number),
        paused: expect.any(Number),
        total: expect.any(Number)
      });
      
      expect(stats.total).toBeGreaterThanOrEqual(2);
      expect(stats.delayed).toBeGreaterThanOrEqual(1);
    });
    
    it('should provide all queues statistics', async () => {
      const allStats = await queueManager.getAllQueuesStats();
      
      expect(Object.keys(allStats)).toHaveLength(
        Object.keys(QUEUE_CONFIG.queues).length
      );
      
      Object.values(allStats).forEach(stats => {
        expect(stats).toHaveProperty('total');
        expect(stats.total).toBeGreaterThanOrEqual(0);
      });
    });
  });
  
  describe('Recurring Jobs', () => {
    it('should schedule recurring jobs', async () => {
      const job = await jobRouter.route({
        type: JobType.COLLECT_METRICS,
        data: {
          targets: ['system'],
          interval: 1000 // Every second for testing
        }
      });
      
      expect(job.opts.repeat).toBeDefined();
      expect(job.opts.repeat?.every).toBe(1000);
      
      // Wait for a repeat
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if job repeated
      const queue = queueManager.getQueue(QUEUE_CONFIG.queues.MONITORING);
      if (queue) {
        const jobs = await queue.getRepeatableJobs();
        expect(jobs.length).toBeGreaterThan(0);
        
        // Clean up repeatable job
        for (const repeatableJob of jobs) {
          await queue.removeRepeatableByKey(repeatableJob.key);
        }
      }
    });
    
    it('should schedule cron-based jobs', async () => {
      const job = await jobRouter.route({
        type: JobType.CLEANUP_OLD_JOBS,
        data: {
          cronPattern: '*/5 * * * * *' // Every 5 seconds for testing
        }
      });
      
      expect(job.opts.repeat).toBeDefined();
      expect(job.opts.repeat?.pattern).toBe('*/5 * * * * *');
      
      // Clean up
      const queue = queueManager.getQueue(QUEUE_CONFIG.queues.CLEANUP);
      if (queue) {
        const jobs = await queue.getRepeatableJobs();
        for (const repeatableJob of jobs) {
          await queue.removeRepeatableByKey(repeatableJob.key);
        }
      }
    });
  });
});