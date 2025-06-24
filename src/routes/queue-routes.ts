import { Router, Request, Response } from 'express';
import { QueueManager } from '../queues/queue-manager';
import { JobRouter } from '../queues/job-router';
import { RetryHandler } from '../queues/retry-handler';
import { JobPersistence } from '../queues/job-persistence';
import { JobType } from '../queues/config/redis-config';
import AuthMiddleware from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// Apply auth middleware to all queue routes
router.use(AuthMiddleware.authenticate());

// Queue statistics endpoint
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const queueManager = QueueManager.getInstance();
    const stats = await queueManager.getAllQueuesStats();
    
    res.json({
      success: true,
      stats,
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Error fetching queue stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch queue statistics'
    });
  }
});

// Individual queue statistics
router.get('/stats/:queueName', async (req: Request, res: Response) => {
  try {
    const { queueName } = req.params;
    const queueManager = QueueManager.getInstance();
    const stats = await queueManager.getQueueStats(queueName);
    
    res.json({
      success: true,
      queue: queueName,
      stats,
      timestamp: new Date()
    });
  } catch (error) {
    logger.error(`Error fetching stats for queue ${req.params.queueName}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch queue statistics'
    });
  }
});

// Add job to queue
router.post('/jobs', async (req: Request, res: Response) => {
  try {
    const { type, data, priority, delay, metadata } = req.body;
    
    if (!type || !data) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: type and data'
      });
      return;
    }
    
    const jobRouter = JobRouter.getInstance();
    const job = await jobRouter.route({
      type: type as JobType,
      data,
      priority,
      delay,
      metadata
    });
    
    res.json({
      success: true,
      jobId: job.id,
      queue: job.queueName,
      status: await job.getState()
    });
  } catch (error) {
    logger.error('Error adding job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add job to queue'
    });
  }
});

// Add multiple jobs
router.post('/jobs/bulk', async (req: Request, res: Response) => {
  try {
    const { jobs } = req.body;
    
    if (!Array.isArray(jobs)) {
      res.status(400).json({
        success: false,
        error: 'Jobs must be an array'
      });
      return;
    }
    
    const jobRouter = JobRouter.getInstance();
    const results = await jobRouter.routeBatch(jobs);
    
    res.json({
      success: true,
      jobsAdded: results.length,
      jobs: results.map(job => ({
        id: job.id,
        queue: job.queueName,
        type: job.name
      }))
    });
  } catch (error) {
    logger.error('Error adding bulk jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add jobs to queue'
    });
  }
});

// Get job details
router.get('/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const { queue } = req.query;
    
    if (!queue) {
      res.status(400).json({
        success: false,
        error: 'Queue name is required'
      });
      return;
    }
    
    const queueManager = QueueManager.getInstance();
    const queueInstance = queueManager.getQueue(queue as string);
    
    if (!queueInstance) {
      res.status(404).json({
        success: false,
        error: 'Queue not found'
      });
      return;
    }
    
    const job = await queueInstance.getJob(jobId);
    
    if (!job) {
      res.status(404).json({
        success: false,
        error: 'Job not found'
      });
      return;
    }
    
    res.json({
      success: true,
      job: {
        id: job.id,
        name: job.name,
        data: job.data,
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        returnvalue: job.returnvalue,
        state: await job.getState(),
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn
      }
    });
  } catch (error) {
    logger.error('Error fetching job details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch job details'
    });
  }
});

// Retry failed job
router.post('/jobs/:jobId/retry', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const { queue } = req.body;
    
    if (!queue) {
      res.status(400).json({
        success: false,
        error: 'Queue name is required'
      });
      return;
    }
    
    const queueManager = QueueManager.getInstance();
    const queueInstance = queueManager.getQueue(queue);
    
    if (!queueInstance) {
      res.status(404).json({
        success: false,
        error: 'Queue not found'
      });
      return;
    }
    
    const job = await queueInstance.getJob(jobId);
    
    if (!job) {
      res.status(404).json({
        success: false,
        error: 'Job not found'
      });
      return;
    }
    
    await job.retry();
    
    res.json({
      success: true,
      message: 'Job queued for retry',
      jobId: job.id,
      state: await job.getState()
    });
  } catch (error) {
    logger.error('Error retrying job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retry job'
    });
  }
});

// Queue management operations
router.post('/queues/:queueName/pause', async (req: Request, res: Response) => {
  try {
    const { queueName } = req.params;
    const queueManager = QueueManager.getInstance();
    
    await queueManager.pauseQueue(queueName);
    
    res.json({
      success: true,
      message: `Queue ${queueName} paused`
    });
  } catch (error) {
    logger.error('Error pausing queue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to pause queue'
    });
  }
});

router.post('/queues/:queueName/resume', async (req: Request, res: Response) => {
  try {
    const { queueName } = req.params;
    const queueManager = QueueManager.getInstance();
    
    await queueManager.resumeQueue(queueName);
    
    res.json({
      success: true,
      message: `Queue ${queueName} resumed`
    });
  } catch (error) {
    logger.error('Error resuming queue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resume queue'
    });
  }
});

router.post('/queues/:queueName/drain', async (req: Request, res: Response) => {
  try {
    const { queueName } = req.params;
    const { delayed = false } = req.body;
    const queueManager = QueueManager.getInstance();
    
    await queueManager.drainQueue(queueName, delayed);
    
    res.json({
      success: true,
      message: `Queue ${queueName} drained`
    });
  } catch (error) {
    logger.error('Error draining queue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to drain queue'
    });
  }
});

router.post('/queues/:queueName/clean', async (req: Request, res: Response) => {
  try {
    const { queueName } = req.params;
    const { grace = 60000, limit = 1000, type = 'completed' } = req.body;
    const queueManager = QueueManager.getInstance();
    
    const cleaned = await queueManager.cleanQueue(queueName, grace, limit, type);
    
    res.json({
      success: true,
      message: `Cleaned ${cleaned.length} jobs from queue ${queueName}`,
      jobsCleaned: cleaned.length
    });
  } catch (error) {
    logger.error('Error cleaning queue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clean queue'
    });
  }
});

// Job persistence endpoints
router.post('/persistence/backup', async (req: Request, res: Response) => {
  try {
    const { queueName } = req.body;
    const persistence = JobPersistence.getInstance();
    
    let result;
    if (queueName) {
      result = await persistence.persistQueue(queueName);
    } else {
      result = await persistence.persistAllQueues();
    }
    
    res.json({
      success: true,
      message: 'Jobs persisted successfully',
      result
    });
  } catch (error) {
    logger.error('Error persisting jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to persist jobs'
    });
  }
});

router.post('/persistence/recover', async (req: Request, res: Response) => {
  try {
    const options = req.body;
    const persistence = JobPersistence.getInstance();
    
    const result = await persistence.recoverJobs(options);
    
    res.json({
      success: true,
      message: 'Jobs recovered successfully',
      recovered: result
    });
  } catch (error) {
    logger.error('Error recovering jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to recover jobs'
    });
  }
});

router.get('/persistence/export', async (req: Request, res: Response) => {
  try {
    const { queue, format = 'json' } = req.query;
    const persistence = JobPersistence.getInstance();
    
    const data = await persistence.exportJobs(
      queue as string | undefined,
      format as 'json' | 'csv'
    );
    
    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const filename = `jobs-export-${Date.now()}.${format}`;
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(data);
  } catch (error) {
    logger.error('Error exporting jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export jobs'
    });
  }
});

// Retry handler statistics
router.get('/retry/stats', async (_req: Request, res: Response) => {
  try {
    const retryHandler = RetryHandler.getInstance();
    const stats = await retryHandler.getFailureStats();
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Error fetching retry stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch retry statistics'
    });
  }
});

// Queue routing optimization
router.post('/routing/optimize', async (_req: Request, res: Response) => {
  try {
    const jobRouter = JobRouter.getInstance();
    await jobRouter.optimizeRouting();
    
    res.json({
      success: true,
      message: 'Queue routing optimization completed'
    });
  } catch (error) {
    logger.error('Error optimizing routing:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to optimize routing'
    });
  }
});

router.get('/routing/distribution', async (_req: Request, res: Response) => {
  try {
    const jobRouter = JobRouter.getInstance();
    const distribution = await jobRouter.getQueueDistribution();
    
    res.json({
      success: true,
      distribution
    });
  } catch (error) {
    logger.error('Error fetching queue distribution:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch queue distribution'
    });
  }
});

export default router;