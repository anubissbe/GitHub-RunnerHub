import { Job, Worker, UnrecoverableError } from 'bullmq';
import { logger } from '../utils/logger';
import { QueueManager } from './queue-manager';
import { JobType, QUEUE_CONFIG } from './config/redis-config';
import { AlertingService } from '../services/alerting-service';
import { DatabaseService } from '../services/database-service';

export interface RetryStrategy {
  maxAttempts: number;
  backoffType: 'fixed' | 'exponential' | 'linear' | 'custom';
  backoffDelay: number;
  backoffMultiplier?: number;
  maxBackoffDelay?: number;
  retryableErrors?: string[];
  nonRetryableErrors?: string[];
  customBackoff?: (attemptsMade: number) => number;
}

export interface FailureHandler {
  onFailure: (job: Job, error: Error) => Promise<void>;
  onMaxAttemptsReached: (job: Job, error: Error) => Promise<void>;
  shouldRetry: (job: Job, error: Error) => Promise<boolean>;
}

export class RetryHandler {
  private static instance: RetryHandler;
  private retryStrategies: Map<JobType, RetryStrategy> = new Map();
  private failureHandlers: Map<JobType, FailureHandler> = new Map();
  private alertingService: AlertingService;
  private databaseService: DatabaseService;
  
  private constructor() {
    this.alertingService = AlertingService.getInstance();
    this.databaseService = DatabaseService.getInstance();
    this.initializeStrategies();
    this.initializeFailureHandlers();
  }
  
  public static getInstance(): RetryHandler {
    if (!RetryHandler.instance) {
      RetryHandler.instance = new RetryHandler();
    }
    return RetryHandler.instance;
  }
  
  private initializeStrategies(): void {
    // Job execution retry strategies
    this.retryStrategies.set(JobType.EXECUTE_WORKFLOW, {
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
    
    this.retryStrategies.set(JobType.PREPARE_RUNNER, {
      maxAttempts: 5,
      backoffType: 'fixed',
      backoffDelay: 2000,
      retryableErrors: [
        'DOCKER_PULL_ERROR',
        'DISK_SPACE_ERROR',
        'NETWORK_ERROR'
      ]
    });
    
    this.retryStrategies.set(JobType.CLEANUP_RUNNER, {
      maxAttempts: 2,
      backoffType: 'fixed',
      backoffDelay: 5000
    });
    
    // Container management retry strategies
    this.retryStrategies.set(JobType.CREATE_CONTAINER, {
      maxAttempts: 3,
      backoffType: 'exponential',
      backoffDelay: 3000,
      backoffMultiplier: 1.5,
      retryableErrors: [
        'IMAGE_PULL_ERROR',
        'RESOURCE_EXHAUSTED',
        'DOCKER_DAEMON_BUSY'
      ]
    });
    
    this.retryStrategies.set(JobType.DESTROY_CONTAINER, {
      maxAttempts: 5,
      backoffType: 'linear',
      backoffDelay: 1000,
      backoffMultiplier: 1000 // Add 1 second per attempt
    });
    
    this.retryStrategies.set(JobType.HEALTH_CHECK, {
      maxAttempts: 1, // Health checks should not retry
      backoffType: 'fixed',
      backoffDelay: 0
    });
    
    // Monitoring retry strategies
    this.retryStrategies.set(JobType.COLLECT_METRICS, {
      maxAttempts: 2,
      backoffType: 'fixed',
      backoffDelay: 5000
    });
    
    this.retryStrategies.set(JobType.SEND_ALERT, {
      maxAttempts: 5,
      backoffType: 'exponential',
      backoffDelay: 1000,
      backoffMultiplier: 2,
      maxBackoffDelay: 30000,
      retryableErrors: [
        'SMTP_CONNECTION_ERROR',
        'SLACK_API_ERROR',
        'WEBHOOK_TIMEOUT'
      ]
    });
    
    // Webhook processing retry strategies
    this.retryStrategies.set(JobType.PROCESS_WEBHOOK, {
      maxAttempts: 3,
      backoffType: 'fixed',
      backoffDelay: 1000,
      nonRetryableErrors: [
        'INVALID_SIGNATURE',
        'MALFORMED_PAYLOAD'
      ]
    });
    
    this.retryStrategies.set(JobType.SYNC_GITHUB_DATA, {
      maxAttempts: 5,
      backoffType: 'exponential',
      backoffDelay: 10000,
      backoffMultiplier: 2,
      maxBackoffDelay: 300000, // Max 5 minutes
      retryableErrors: [
        'GITHUB_RATE_LIMIT',
        'GITHUB_API_ERROR',
        'NETWORK_ERROR'
      ]
    });
    
    // Cleanup retry strategies
    this.retryStrategies.set(JobType.CLEANUP_OLD_JOBS, {
      maxAttempts: 2,
      backoffType: 'fixed',
      backoffDelay: 60000 // 1 minute
    });
  }
  
  private initializeFailureHandlers(): void {
    // Default failure handler
    const defaultHandler: FailureHandler = {
      onFailure: async (job: Job, error: Error) => {
        logger.error(`Job ${job.id} failed:`, error);
        
        // Store failure in database
        await this.databaseService.recordJobFailure({
          jobId: job.id!,
          jobType: job.name,
          error: error.message,
          stackTrace: error.stack,
          attemptsMade: job.attemptsMade,
          data: job.data,
          timestamp: new Date()
        });
      },
      
      onMaxAttemptsReached: async (job: Job, error: Error) => {
        logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts`);
        
        // Send alert
        await this.alertingService.sendAlert({
          severity: 'error',
          type: 'job_failure',
          title: `Job ${job.name} Failed`,
          description: `Job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`,
          metadata: {
            jobId: job.id,
            jobType: job.name,
            error: error.message,
            data: job.data
          }
        });
      },
      
      shouldRetry: async (job: Job, error: Error) => {
        const strategy = this.retryStrategies.get(job.name as JobType);
        if (!strategy) return false;
        
        // Check if error is non-retryable
        if (strategy.nonRetryableErrors?.includes(error.message)) {
          return false;
        }
        
        // Check if error is explicitly retryable
        if (strategy.retryableErrors && !strategy.retryableErrors.includes(error.message)) {
          return false;
        }
        
        // Check max attempts
        return job.attemptsMade < strategy.maxAttempts;
      }
    };
    
    // Set default handler for all job types
    for (const jobType of Object.values(JobType)) {
      this.failureHandlers.set(jobType as JobType, defaultHandler);
    }
    
    // Custom handler for workflow execution
    this.failureHandlers.set(JobType.EXECUTE_WORKFLOW, {
      ...defaultHandler,
      onFailure: async (job: Job, error: Error) => {
        await defaultHandler.onFailure(job, error);
        
        // Update workflow status
        const { runId } = job.data.data;
        await this.databaseService.updateJobStatus(runId, {
          status: 'failed',
          error: error.message,
          failedAt: new Date()
        });
      },
      
      onMaxAttemptsReached: async (job: Job, error: Error) => {
        await defaultHandler.onMaxAttemptsReached(job, error);
        
        // Trigger cleanup
        const queueManager = QueueManager.getInstance();
        await queueManager.addJob(
          QUEUE_CONFIG.queues.JOB_EXECUTION,
          JobType.CLEANUP_RUNNER,
          {
            type: JobType.CLEANUP_RUNNER,
            data: {
              runnerId: job.data.data.runnerId,
              force: true,
              reason: `Workflow failed: ${error.message}`
            }
          }
        );
      }
    });
    
    // Custom handler for alerts
    this.failureHandlers.set(JobType.SEND_ALERT, {
      ...defaultHandler,
      onMaxAttemptsReached: async (job: Job, error: Error) => {
        logger.error(`Critical: Alert delivery failed after ${job.attemptsMade} attempts`);
        
        // Try fallback alert method
        try {
          await this.alertingService.sendFallbackAlert({
            message: `Alert system failure: ${error.message}`,
            originalAlert: job.data.data
          });
        } catch (fallbackError) {
          logger.error('Fallback alert also failed:', fallbackError);
        }
      }
    });
  }
  
  public getRetryStrategy(jobType: JobType): RetryStrategy | undefined {
    return this.retryStrategies.get(jobType);
  }
  
  public getFailureHandler(jobType: JobType): FailureHandler {
    return this.failureHandlers.get(jobType) || this.failureHandlers.get(JobType.EXECUTE_WORKFLOW)!;
  }
  
  public calculateBackoff(jobType: JobType, attemptsMade: number): number {
    const strategy = this.retryStrategies.get(jobType);
    if (!strategy) return 0;
    
    let delay = strategy.backoffDelay;
    
    switch (strategy.backoffType) {
      case 'fixed':
        return delay;
        
      case 'linear':
        delay = strategy.backoffDelay + (attemptsMade * (strategy.backoffMultiplier || 1000));
        break;
        
      case 'exponential':
        delay = strategy.backoffDelay * Math.pow(strategy.backoffMultiplier || 2, attemptsMade - 1);
        break;
        
      case 'custom':
        if (strategy.customBackoff) {
          delay = strategy.customBackoff(attemptsMade);
        }
        break;
    }
    
    // Apply max delay cap
    if (strategy.maxBackoffDelay) {
      delay = Math.min(delay, strategy.maxBackoffDelay);
    }
    
    return delay;
  }
  
  public async handleJobFailure(job: Job, error: Error): Promise<void> {
    const handler = this.getFailureHandler(job.name as JobType);
    
    // Execute failure handler
    await handler.onFailure(job, error);
    
    // Check if should retry
    const shouldRetry = await handler.shouldRetry(job, error);
    
    if (!shouldRetry) {
      // Mark as unrecoverable
      throw new UnrecoverableError(error.message);
    }
    
    // Check if max attempts reached
    const strategy = this.getRetryStrategy(job.name as JobType);
    if (strategy && job.attemptsMade >= strategy.maxAttempts) {
      await handler.onMaxAttemptsReached(job, error);
      throw new UnrecoverableError(`Max attempts (${strategy.maxAttempts}) reached`);
    }
    
    // Calculate backoff
    const backoffDelay = this.calculateBackoff(job.name as JobType, job.attemptsMade);
    
    // Log retry
    logger.info(`Job ${job.id} will retry in ${backoffDelay}ms (attempt ${job.attemptsMade + 1}/${strategy?.maxAttempts})`);
    
    // Throw error to trigger retry
    throw error;
  }
  
  public attachToWorker(worker: Worker): void {
    // Handle failed jobs
    worker.on('failed', async (job, error) => {
      if (job) {
        try {
          await this.handleJobFailure(job, error);
        } catch (finalError) {
          logger.error(`Final failure for job ${job.id}:`, finalError);
        }
      }
    });
    
    // Handle stalled jobs
    worker.on('stalled', async (jobId) => {
      logger.warn(`Job ${jobId} stalled, will be retried`);
      
      // Record stalled event
      await this.databaseService.recordJobEvent({
        jobId,
        event: 'stalled',
        timestamp: new Date()
      });
    });
  }
  
  public async getFailureStats(): Promise<any> {
    const stats = await this.databaseService.getJobFailureStats();
    
    return {
      totalFailures: stats.total,
      failuresByType: stats.byType,
      failuresByError: stats.byError,
      averageAttempts: stats.averageAttempts,
      recentFailures: stats.recent
    };
  }
  
  public updateRetryStrategy(jobType: JobType, strategy: Partial<RetryStrategy>): void {
    const currentStrategy = this.retryStrategies.get(jobType);
    if (currentStrategy) {
      this.retryStrategies.set(jobType, {
        ...currentStrategy,
        ...strategy
      });
      logger.info(`Updated retry strategy for ${jobType}`);
    }
  }
}

export default RetryHandler;