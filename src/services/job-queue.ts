import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import config from '../config';
import { createLogger } from '../utils/logger';
import { DelegatedJob, JobStatus } from '../types';
import containerOrchestrator from './container-orchestrator-v2';
import database from './database';

const logger = createLogger('JobQueue');

// Redis connection
const redisConnection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null, // Required by BullMQ
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    logger.warn(`Redis connection retry attempt ${times}, delay ${delay}ms`);
    return delay;
  }
});

// Handle Redis errors
redisConnection.on('error', (err) => {
  logger.error('Redis connection error', err);
});

// Create queue
export const jobQueue = new Queue('github-jobs', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 100 // Keep last 100 completed jobs
    },
    removeOnFail: {
      age: 86400 // Keep failed jobs for 24 hours
    }
  }
});

// Queue events for monitoring
const queueEvents = new QueueEvents('github-jobs', {
  connection: new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null
  })
});


// Create worker
const worker = new Worker(
  'github-jobs',
  async (job) => {
    const delegatedJob: DelegatedJob = job.data;
    logger.info('Processing job', {
      jobId: delegatedJob.id,
      repository: delegatedJob.repository
    });

    try {
      // Update job status to assigned
      await database.query(
        'UPDATE runnerhub.jobs SET status = $2 WHERE id = $1',
        [delegatedJob.id, JobStatus.ASSIGNED]
      );

      // Execute job using container orchestrator v2
      const result = await containerOrchestrator.executeJob(delegatedJob);

      // Update job with results
      await database.query(
        `UPDATE runnerhub.jobs 
         SET status = $2, exit_code = $3, completed_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [delegatedJob.id, result.success ? JobStatus.COMPLETED : JobStatus.FAILED, result.exitCode]
      );

      logger.info('Job completed', {
        jobId: delegatedJob.id,
        success: result.success,
        exitCode: result.exitCode
      });

      return result;
    } catch (error) {
      logger.error('Job processing failed', {
        jobId: delegatedJob.id,
        error
      });

      // Update job status to failed
      await database.query(
        'UPDATE runnerhub.jobs SET status = $2 WHERE id = $1',
        [delegatedJob.id, JobStatus.FAILED]
      );

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 10,
    autorun: false
  }
);

// Worker event handlers
worker.on('completed', (job) => {
  logger.debug('Job completed', { jobId: job.id });
});

worker.on('failed', (job, err) => {
  logger.error('Job failed', { 
    jobId: job?.id, 
    error: err.message 
  });
});

worker.on('active', (job) => {
  logger.debug('Job active', { jobId: job.id });
});

// Queue event handlers
queueEvents.on('waiting', ({ jobId }) => {
  logger.debug('Job waiting', { jobId });
});

queueEvents.on('progress', ({ jobId, data }) => {
  logger.debug('Job progress', { jobId, progress: data });
});

// Queue management functions
export const startWorker = async (): Promise<void> => {
  await worker.run();
  logger.info('Job queue worker started');
};

export const stopWorker = async (): Promise<void> => {
  await worker.close();
  logger.info('Job queue worker stopped');
};

export const getQueueMetrics = async () => {
  const [waiting, active, completed, failed] = await Promise.all([
    jobQueue.getWaitingCount(),
    jobQueue.getActiveCount(),
    jobQueue.getCompletedCount(),
    jobQueue.getFailedCount()
  ]);

  return {
    waiting,
    active,
    completed,
    failed
  };
};

export default {
  queue: jobQueue,
  startWorker,
  stopWorker,
  getQueueMetrics
};