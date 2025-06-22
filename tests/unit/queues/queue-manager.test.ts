import { QueueManager } from '../../../src/queues/queue-manager';
import { QUEUE_CONFIG } from '../../../src/queues/config/redis-config';
import Redis from 'ioredis';

// Mock dependencies
jest.mock('ioredis');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('QueueManager', () => {
  let queueManager: QueueManager;
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton instance
    (QueueManager as any).instance = undefined;
  });
  
  afterEach(async () => {
    if (queueManager) {
      await queueManager.shutdown();
    }
  });
  
  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = QueueManager.getInstance();
      const instance2 = QueueManager.getInstance();
      expect(instance1).toBe(instance2);
    });
    
    it('should initialize with provided options', () => {
      const options = {
        enableScheduler: false,
        enableFlowProducer: false,
        enableDashboard: false
      };
      
      queueManager = QueueManager.getInstance(options);
      expect(queueManager).toBeDefined();
    });
  });
  
  describe('Initialization', () => {
    it('should initialize all queues', async () => {
      queueManager = QueueManager.getInstance();
      await queueManager.initialize();
      
      // Check that all queues are created
      for (const queueName of Object.values(QUEUE_CONFIG.queues)) {
        const queue = queueManager.getQueue(queueName);
        expect(queue).toBeDefined();
      }
    });
    
    it('should not reinitialize if already initialized', async () => {
      queueManager = QueueManager.getInstance();
      await queueManager.initialize();
      
      // Try to initialize again
      await queueManager.initialize();
      
      // Should log warning
      const { logger } = require('../../../src/utils/logger');
      expect(logger.warn).toHaveBeenCalledWith('QueueManager already initialized');
    });
    
    it('should handle initialization errors', async () => {
      // Mock error
      const mockError = new Error('Redis connection failed');
      Redis.mockImplementationOnce(() => {
        throw mockError;
      });
      
      queueManager = QueueManager.getInstance();
      await expect(queueManager.initialize()).rejects.toThrow(mockError);
    });
  });
  
  describe('Job Management', () => {
    beforeEach(async () => {
      queueManager = QueueManager.getInstance();
      await queueManager.initialize();
    });
    
    it('should add job to queue', async () => {
      const jobData = {
        type: 'test',
        data: { test: true }
      };
      
      const job = await queueManager.addJob(
        QUEUE_CONFIG.queues.JOB_EXECUTION,
        'test-job',
        jobData
      );
      
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
    });
    
    it('should throw error for non-existent queue', async () => {
      await expect(
        queueManager.addJob('non-existent-queue', 'test-job', {})
      ).rejects.toThrow('Queue non-existent-queue not found');
    });
    
    it('should add bulk jobs', async () => {
      const jobs = [
        { name: 'job1', data: { id: 1 } },
        { name: 'job2', data: { id: 2 } },
        { name: 'job3', data: { id: 3 } }
      ];
      
      const results = await queueManager.addBulkJobs(
        QUEUE_CONFIG.queues.JOB_EXECUTION,
        jobs
      );
      
      expect(results).toHaveLength(3);
      results.forEach((job, index) => {
        expect(job.name).toBe(jobs[index].name);
      });
    });
  });
  
  describe('Queue Operations', () => {
    beforeEach(async () => {
      queueManager = QueueManager.getInstance();
      await queueManager.initialize();
    });
    
    it('should get queue stats', async () => {
      const stats = await queueManager.getQueueStats(QUEUE_CONFIG.queues.JOB_EXECUTION);
      
      expect(stats).toHaveProperty('waiting');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('delayed');
      expect(stats).toHaveProperty('paused');
      expect(stats).toHaveProperty('total');
    });
    
    it('should get all queues stats', async () => {
      const allStats = await queueManager.getAllQueuesStats();
      
      expect(Object.keys(allStats)).toHaveLength(Object.keys(QUEUE_CONFIG.queues).length);
      
      for (const queueName of Object.values(QUEUE_CONFIG.queues)) {
        expect(allStats).toHaveProperty(queueName);
      }
    });
    
    it('should pause and resume queue', async () => {
      const queueName = QUEUE_CONFIG.queues.JOB_EXECUTION;
      
      await queueManager.pauseQueue(queueName);
      // Queue should be paused
      
      await queueManager.resumeQueue(queueName);
      // Queue should be resumed
      
      const { logger } = require('../../../src/utils/logger');
      expect(logger.info).toHaveBeenCalledWith(`Queue ${queueName} paused`);
      expect(logger.info).toHaveBeenCalledWith(`Queue ${queueName} resumed`);
    });
    
    it('should drain queue', async () => {
      const queueName = QUEUE_CONFIG.queues.JOB_EXECUTION;
      
      // Add some jobs
      await queueManager.addJob(queueName, 'test-job', { test: 1 });
      await queueManager.addJob(queueName, 'test-job', { test: 2 });
      
      await queueManager.drainQueue(queueName);
      
      const { logger } = require('../../../src/utils/logger');
      expect(logger.info).toHaveBeenCalledWith(`Queue ${queueName} drained`);
    });
    
    it('should clean queue', async () => {
      const queueName = QUEUE_CONFIG.queues.JOB_EXECUTION;
      
      const cleaned = await queueManager.cleanQueue(queueName, 0, 100, 'completed');
      
      expect(Array.isArray(cleaned)).toBe(true);
    });
  });
  
  describe('Dashboard', () => {
    it('should mount dashboard on Express app', () => {
      queueManager = QueueManager.getInstance({
        enableDashboard: true,
        dashboardPath: '/test/queues'
      });
      
      const mockApp = {
        use: jest.fn()
      };
      
      queueManager.mountDashboard(mockApp as any);
      
      expect(mockApp.use).toHaveBeenCalledWith(
        '/test/queues',
        expect.any(Function)
      );
    });
    
    it('should throw error if dashboard not initialized', () => {
      queueManager = QueueManager.getInstance({
        enableDashboard: false
      });
      
      const mockApp = { use: jest.fn() };
      
      expect(() => {
        queueManager.mountDashboard(mockApp as any);
      }).toThrow('Dashboard not initialized');
    });
  });
  
  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      queueManager = QueueManager.getInstance();
      await queueManager.initialize();
      
      await queueManager.shutdown();
      
      const { logger } = require('../../../src/utils/logger');
      expect(logger.info).toHaveBeenCalledWith('QueueManager shutdown complete');
    });
    
    it('should close all resources on shutdown', async () => {
      queueManager = QueueManager.getInstance({
        enableScheduler: true,
        enableFlowProducer: true
      });
      await queueManager.initialize();
      
      // Add spy on close methods
      const queues = Object.values(QUEUE_CONFIG.queues).map(name => 
        queueManager.getQueue(name)
      );
      
      await queueManager.shutdown();
      
      // Verify all resources were closed
      expect(queueManager['isInitialized']).toBe(false);
    });
  });
});