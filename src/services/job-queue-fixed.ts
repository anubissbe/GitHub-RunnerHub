import { Queue, Worker, QueueEvents } from 'bullmq';
import { createLogger } from '../utils/logger';
import { DelegatedJob, JobStatus } from '../types';
import containerOrchestrator from './container-orchestrator-v2';
import database from './database';
import { createBullMQConnection, createQueueEventsConnection } from './redis-connection';

const logger = createLogger('JobQueue');

// Delay Redis connection creation until initialization
let redisConnection: any = null;
let queueEventsConnection: any = null;
let jobQueue: Queue | null = null;
let queueEvents: QueueEvents | null = null;
let worker: Worker | null = null;
let initialized = false;

/**
 * Initialize the job queue service
 */
export async function initializeJobQueue(): Promise<void> {
  if (initialized) {
    logger.warn('Job queue already initialized');
    return;
  }

  logger.info('Initializing job queue service');

  try {
    // Create Redis connections with HA support
    redisConnection = createBullMQConnection();
    queueEventsConnection = createQueueEventsConnection();

    // Wait for connections to be ready
    if (redisConnection.status !== 'ready') {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 10000);

        redisConnection.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        redisConnection.once('error', (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    }

    // Create queue with HA-aware Redis connection
    jobQueue = new Queue('github-jobs', {
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

    // Queue events for monitoring with HA-aware connection
    queueEvents = new QueueEvents('github-jobs', {
      connection: queueEventsConnection
    });

    // Create worker
    worker = new Worker(
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

          // Create and run container
          const result = await containerOrchestrator.executeJob(delegatedJob);

          // Update job completion
          await database.query(
            'UPDATE runnerhub.jobs SET status = $2, completed_at = NOW() WHERE id = $1',
            [delegatedJob.id, JobStatus.COMPLETED]
          );

          logger.info('Job completed successfully', {
            jobId: delegatedJob.id,
            duration: result.duration
          });

          return result;
        } catch (error) {
          logger.error('Job failed', {
            jobId: delegatedJob.id,
            error: (error as Error).message
          });

          // Update job failure
          await database.query(
            'UPDATE runnerhub.jobs SET status = $2, error = $3, completed_at = NOW() WHERE id = $1',
            [delegatedJob.id, JobStatus.FAILED, (error as Error).message]
          );

          throw error;
        }
      },
      {
        connection: redisConnection,
        concurrency: 5
      }
    );

    // Set up event listeners
    queueEvents.on('completed', ({ jobId }) => {
      logger.info('Job completed event', { jobId });
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error('Job failed event', { jobId, reason: failedReason });
    });

    worker.on('completed', (job) => {
      logger.info('Worker completed job', { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
      if (job) {
        logger.error('Worker failed job', { jobId: job.id, error: err.message });
      }
    });

    initialized = true;
    logger.info('Job queue service initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize job queue', { error });
    throw error;
  }
}

/**
 * Add a job to the queue
 */
export async function addJob(job: DelegatedJob): Promise<void> {
  if (!jobQueue) {
    throw new Error('Job queue not initialized');
  }

  await jobQueue.add('process-job', job, {
    jobId: job.id,
    removeOnComplete: true,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  });

  logger.info('Job added to queue', {
    jobId: job.id,
    repository: job.repository
  });
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  if (!jobQueue) {
    throw new Error('Job queue not initialized');
  }

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
    failed,
    total: waiting + active + completed + failed
  };
}

/**
 * Clean up old jobs
 */
export async function cleanOldJobs(): Promise<void> {
  if (!jobQueue) {
    throw new Error('Job queue not initialized');
  }

  const [completed, failed] = await Promise.all([
    jobQueue.clean(3600 * 1000, 100, 'completed'), // 1 hour old
    jobQueue.clean(86400 * 1000, 100, 'failed')    // 24 hours old
  ]);

  logger.info('Cleaned old jobs', {
    completed: completed.length,
    failed: failed.length
  });
}

/**
 * Pause the queue
 */
export async function pauseQueue(): Promise<void> {
  if (!jobQueue) {
    throw new Error('Job queue not initialized');
  }

  await jobQueue.pause();
  logger.info('Job queue paused');
}

/**
 * Resume the queue
 */
export async function resumeQueue(): Promise<void> {
  if (!jobQueue) {
    throw new Error('Job queue not initialized');
  }

  await jobQueue.resume();
  logger.info('Job queue resumed');
}

/**
 * Shutdown the job queue gracefully
 */
export async function shutdownJobQueue(): Promise<void> {
  if (!initialized) {
    return;
  }

  logger.info('Shutting down job queue service');

  try {
    // Close worker first
    if (worker) {
      await worker.close();
    }

    // Close queue events
    if (queueEvents) {
      await queueEvents.close();
    }

    // Close queue
    if (jobQueue) {
      await jobQueue.close();
    }

    // Close Redis connections
    if (redisConnection) {
      redisConnection.disconnect();
    }
    if (queueEventsConnection) {
      queueEventsConnection.disconnect();
    }

    initialized = false;
    logger.info('Job queue service shut down successfully');
  } catch (error) {
    logger.error('Error shutting down job queue', { error });
    throw error;
  }
}

export default {
  initializeJobQueue,
  addJob,
  getQueueStats,
  cleanOldJobs,
  pauseQueue,
  resumeQueue,
  shutdownJobQueue
};