import { Queue, Job, QueueEvents } from 'bullmq';
import { logger } from '../utils/logger';
import { DatabaseService } from '../services/database-service';
import { QueueManager } from './queue-manager';
import { JobType, QUEUE_CONFIG } from './config/redis-config';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface PersistedJob {
  id: string;
  queueName: string;
  jobType: JobType;
  data: any;
  opts: any;
  status: string;
  progress: number;
  attemptsMade: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  stacktrace?: string[];
  returnvalue?: any;
  persistedAt: Date;
}

export interface RecoveryOptions {
  recoverFailed?: boolean;
  recoverStalled?: boolean;
  recoverIncomplete?: boolean;
  maxAge?: number; // Max age of jobs to recover (in ms)
  batchSize?: number;
}

export class JobPersistence {
  private static instance: JobPersistence;
  private db: DatabaseService;
  private queueManager: QueueManager;
  private persistenceDir: string;
  private isRecovering = false;
  
  private constructor() {
    this.db = DatabaseService.getInstance();
    this.queueManager = QueueManager.getInstance();
    this.persistenceDir = process.env.JOB_PERSISTENCE_DIR || '/var/lib/github-runnerhub/jobs';
    this.ensurePersistenceDirectory();
  }
  
  public static getInstance(): JobPersistence {
    if (!JobPersistence.instance) {
      JobPersistence.instance = new JobPersistence();
    }
    return JobPersistence.instance;
  }
  
  private async ensurePersistenceDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.persistenceDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create persistence directory:', error);
    }
  }
  
  public async persistJob(job: Job): Promise<void> {
    try {
      const persistedJob: PersistedJob = {
        id: job.id!,
        queueName: job.queueName,
        jobType: job.name as JobType,
        data: job.data,
        opts: job.opts,
        status: await job.getState() || 'unknown',
        progress: job.progress as number,
        attemptsMade: job.attemptsMade,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        returnvalue: job.returnvalue,
        persistedAt: new Date()
      };
      
      // Save to database
      await this.db.persistJob(persistedJob);
      
      // Save to file as backup
      await this.saveJobToFile(persistedJob);
      
      logger.debug(`Persisted job ${job.id} from queue ${job.queueName}`);
    } catch (error) {
      logger.error(`Failed to persist job ${job.id}:`, error);
    }
  }
  
  public async persistQueue(queueName: string): Promise<number> {
    try {
      const queue = this.queueManager.getQueue(queueName);
      if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
      }
      
      let persistedCount = 0;
      
      // Get all jobs in different states
      const states = ['waiting', 'active', 'delayed', 'failed', 'paused'];
      
      for (const state of states) {
        const jobs = await queue.getJobs([state as any]);
        
        for (const job of jobs) {
          await this.persistJob(job);
          persistedCount++;
        }
      }
      
      logger.info(`Persisted ${persistedCount} jobs from queue ${queueName}`);
      return persistedCount;
    } catch (error) {
      logger.error(`Failed to persist queue ${queueName}:`, error);
      throw error;
    }
  }
  
  public async persistAllQueues(): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    
    for (const queueName of Object.values(QUEUE_CONFIG.queues)) {
      try {
        results[queueName] = await this.persistQueue(queueName);
      } catch (error) {
        logger.error(`Failed to persist queue ${queueName}:`, error);
        results[queueName] = 0;
      }
    }
    
    return results;
  }
  
  private async saveJobToFile(job: PersistedJob): Promise<void> {
    const filename = `${job.queueName}_${job.id}_${Date.now()}.json`;
    const filepath = path.join(this.persistenceDir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(job, null, 2));
  }
  
  public async recoverJobs(options: RecoveryOptions = {}): Promise<Record<string, number>> {
    if (this.isRecovering) {
      logger.warn('Recovery already in progress');
      return {};
    }
    
    const {
      recoverFailed = true,
      recoverStalled = true,
      recoverIncomplete = true,
      maxAge = 24 * 60 * 60 * 1000, // 24 hours default
      batchSize = 100
    } = options;
    
    this.isRecovering = true;
    const results: Record<string, number> = {};
    
    try {
      logger.info('Starting job recovery process...');
      
      // Recover from database
      const cutoffDate = new Date(Date.now() - maxAge);
      
      // Get persisted jobs to recover
      const jobsToRecover = await this.db.getPersistedJobs({
        statuses: this.getRecoveryStatuses(options),
        after: cutoffDate,
        limit: batchSize
      });
      
      // Group jobs by queue
      const jobsByQueue = new Map<string, PersistedJob[]>();
      
      for (const job of jobsToRecover) {
        if (!jobsByQueue.has(job.queueName)) {
          jobsByQueue.set(job.queueName, []);
        }
        jobsByQueue.get(job.queueName)!.push(job);
      }
      
      // Recover jobs per queue
      for (const [queueName, jobs] of jobsByQueue.entries()) {
        const recovered = await this.recoverQueueJobs(queueName, jobs);
        results[queueName] = recovered;
      }
      
      // Also recover from file backup if database recovery fails
      if (Object.values(results).every(count => count === 0)) {
        logger.info('Attempting recovery from file backup...');
        const fileResults = await this.recoverFromFiles(options);
        
        for (const [queue, count] of Object.entries(fileResults)) {
          results[queue] = (results[queue] || 0) + count;
        }
      }
      
      logger.info('Job recovery completed', results);
      return results;
    } catch (error) {
      logger.error('Job recovery failed:', error);
      throw error;
    } finally {
      this.isRecovering = false;
    }
  }
  
  private getRecoveryStatuses(options: RecoveryOptions): string[] {
    const statuses: string[] = [];
    
    if (options.recoverFailed) {
      statuses.push('failed');
    }
    
    if (options.recoverStalled) {
      statuses.push('stalled', 'active'); // Active jobs might be stalled
    }
    
    if (options.recoverIncomplete) {
      statuses.push('waiting', 'delayed', 'paused');
    }
    
    return statuses;
  }
  
  private async recoverQueueJobs(queueName: string, jobs: PersistedJob[]): Promise<number> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      logger.error(`Queue ${queueName} not found for recovery`);
      return 0;
    }
    
    let recovered = 0;
    
    for (const job of jobs) {
      try {
        // Check if job already exists
        const existingJob = await queue.getJob(job.id);
        if (existingJob) {
          logger.debug(`Job ${job.id} already exists in queue ${queueName}`);
          continue;
        }
        
        // Re-add job to queue
        const newJob = await queue.add(
          job.jobType,
          job.data,
          {
            ...job.opts,
            jobId: job.id, // Preserve original job ID
            delay: 0 // Process immediately
          }
        );
        
        // Update job progress if it had any
        if (job.progress > 0) {
          await newJob.updateProgress(job.progress);
        }
        
        // Add recovery metadata
        await newJob.update({
          ...job.data,
          _recovery: {
            recoveredAt: new Date(),
            originalStatus: job.status,
            attemptsMade: job.attemptsMade
          }
        });
        
        recovered++;
        logger.info(`Recovered job ${job.id} to queue ${queueName}`);
      } catch (error) {
        logger.error(`Failed to recover job ${job.id}:`, error);
      }
    }
    
    return recovered;
  }
  
  private async recoverFromFiles(options: RecoveryOptions): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    
    try {
      const files = await fs.readdir(this.persistenceDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      for (const file of jsonFiles) {
        try {
          const filepath = path.join(this.persistenceDir, file);
          const content = await fs.readFile(filepath, 'utf-8');
          const job: PersistedJob = JSON.parse(content);
          
          // Check if job should be recovered based on options
          if (this.shouldRecoverJob(job, options)) {
            const recovered = await this.recoverQueueJobs(job.queueName, [job]);
            results[job.queueName] = (results[job.queueName] || 0) + recovered;
            
            // Delete file after successful recovery
            if (recovered > 0) {
              await fs.unlink(filepath);
            }
          }
        } catch (error) {
          logger.error(`Failed to recover from file ${file}:`, error);
        }
      }
    } catch (error) {
      logger.error('Failed to read persistence directory:', error);
    }
    
    return results;
  }
  
  private shouldRecoverJob(job: PersistedJob, options: RecoveryOptions): boolean {
    const maxAge = options.maxAge || 24 * 60 * 60 * 1000;
    const jobAge = Date.now() - job.persistedAt.getTime();
    
    if (jobAge > maxAge) {
      return false;
    }
    
    const recoveryStatuses = this.getRecoveryStatuses(options);
    return recoveryStatuses.includes(job.status);
  }
  
  public async setupAutoPersistence(): Promise<void> {
    logger.info('Setting up automatic job persistence...');
    
    // Persist on system shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, persisting all jobs...');
      await this.persistAllQueues();
    });
    
    process.on('SIGINT', async () => {
      logger.info('SIGINT received, persisting all jobs...');
      await this.persistAllQueues();
    });
    
    // Periodic persistence
    setInterval(async () => {
      try {
        await this.persistAllQueues();
      } catch (error) {
        logger.error('Periodic persistence failed:', error);
      }
    }, parseInt(process.env.JOB_PERSISTENCE_INTERVAL || '300000', 10)); // 5 minutes default
    
    // Setup queue event listeners for critical jobs
    for (const queueName of Object.values(QUEUE_CONFIG.queues)) {
      const queue = this.queueManager.getQueue(queueName);
      if (!queue) continue;
      
      const queueEvents = new QueueEvents(queueName, {
        connection: queue.opts.connection
      });
      
      // Persist failed jobs immediately
      queueEvents.on('failed', async ({ jobId }) => {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            await this.persistJob(job);
          }
        } catch (error) {
          logger.error(`Failed to persist failed job ${jobId}:`, error);
        }
      });
      
      // Persist stalled jobs
      queueEvents.on('stalled', async ({ jobId }) => {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            await this.persistJob(job);
          }
        } catch (error) {
          logger.error(`Failed to persist stalled job ${jobId}:`, error);
        }
      });
    }
    
    logger.info('Automatic job persistence setup complete');
  }
  
  public async cleanupOldPersistence(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    let cleaned = 0;
    
    // Clean database
    const cutoffDate = new Date(Date.now() - maxAge);
    cleaned += await this.db.cleanupPersistedJobs(cutoffDate);
    
    // Clean files
    try {
      const files = await fs.readdir(this.persistenceDir);
      
      for (const file of files) {
        const filepath = path.join(this.persistenceDir, file);
        const stats = await fs.stat(filepath);
        
        if (Date.now() - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filepath);
          cleaned++;
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup persistence files:', error);
    }
    
    logger.info(`Cleaned up ${cleaned} old persisted jobs`);
    return cleaned;
  }
  
  public async exportJobs(queueName?: string, format: 'json' | 'csv' = 'json'): Promise<string> {
    const jobs = await this.db.getPersistedJobs({
      queueName,
      limit: 10000
    });
    
    if (format === 'json') {
      return JSON.stringify(jobs, null, 2);
    } else {
      // CSV format
      const headers = ['id', 'queueName', 'jobType', 'status', 'attemptsMade', 'persistedAt'];
      const rows = jobs.map(job => 
        headers.map(h => job[h as keyof PersistedJob] || '').join(',')
      );
      
      return [headers.join(','), ...rows].join('\n');
    }
  }
}

export default JobPersistence;