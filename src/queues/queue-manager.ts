import { Queue, Worker, QueueScheduler, FlowProducer, Job } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Express } from 'express';
import { getBullConnectionOptions, QUEUE_CONFIG, JobType } from './config/redis-config';
import { logger } from '../utils/logger';
import { JobProcessor } from './processors/job-processor';
import { ContainerProcessor } from './processors/container-processor';
import { MonitoringProcessor } from './processors/monitoring-processor';
import { WebhookProcessor } from './processors/webhook-processor';
import { CleanupProcessor } from './processors/cleanup-processor';

export interface QueueManagerOptions {
  enableScheduler?: boolean;
  enableFlowProducer?: boolean;
  enableDashboard?: boolean;
  dashboardPath?: string;
}

export class QueueManager {
  private static instance: QueueManager;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private schedulers: Map<string, QueueScheduler> = new Map();
  private flowProducer: FlowProducer | null = null;
  private dashboardAdapter: ExpressAdapter | null = null;
  private isInitialized = false;

  private constructor(private options: QueueManagerOptions = {}) {
    this.options = {
      enableScheduler: true,
      enableFlowProducer: true,
      enableDashboard: true,
      dashboardPath: '/admin/queues',
      ...options
    };
  }

  public static getInstance(options?: QueueManagerOptions): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager(options);
    }
    return QueueManager.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('QueueManager already initialized');
      return;
    }

    try {
      logger.info('Initializing Redis Job Queue System...');
      
      // Initialize queues
      await this.initializeQueues();
      
      // Initialize workers
      await this.initializeWorkers();
      
      // Initialize schedulers if enabled
      if (this.options.enableScheduler) {
        await this.initializeSchedulers();
      }
      
      // Initialize flow producer if enabled
      if (this.options.enableFlowProducer) {
        await this.initializeFlowProducer();
      }
      
      // Initialize dashboard if enabled
      if (this.options.enableDashboard) {
        this.initializeDashboard();
      }
      
      this.isInitialized = true;
      logger.info('Redis Job Queue System initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize QueueManager:', error);
      throw error;
    }
  }

  private async initializeQueues(): Promise<void> {
    const connection = getBullConnectionOptions();
    
    for (const [name, queueName] of Object.entries(QUEUE_CONFIG.queues)) {
      const queue = new Queue(queueName, {
        connection: connection.connection,
        defaultJobOptions: QUEUE_CONFIG.defaultJobOptions
      });
      
      this.queues.set(queueName, queue);
      logger.info(`Queue initialized: ${queueName}`);
      
      // Add queue event listeners
      this.setupQueueEventListeners(queue, queueName);
    }
  }

  private async initializeWorkers(): Promise<void> {
    const connection = getBullConnectionOptions();
    
    // Job execution worker
    const jobWorker = new Worker(
      QUEUE_CONFIG.queues.JOB_EXECUTION,
      JobProcessor.process,
      {
        connection: connection.connection,
        concurrency: parseInt(process.env.JOB_WORKER_CONCURRENCY || '5', 10)
      }
    );
    this.workers.set(QUEUE_CONFIG.queues.JOB_EXECUTION, jobWorker);
    
    // Container management worker
    const containerWorker = new Worker(
      QUEUE_CONFIG.queues.CONTAINER_MANAGEMENT,
      ContainerProcessor.process,
      {
        connection: connection.connection,
        concurrency: parseInt(process.env.CONTAINER_WORKER_CONCURRENCY || '10', 10)
      }
    );
    this.workers.set(QUEUE_CONFIG.queues.CONTAINER_MANAGEMENT, containerWorker);
    
    // Monitoring worker
    const monitoringWorker = new Worker(
      QUEUE_CONFIG.queues.MONITORING,
      MonitoringProcessor.process,
      {
        connection: connection.connection,
        concurrency: parseInt(process.env.MONITORING_WORKER_CONCURRENCY || '3', 10)
      }
    );
    this.workers.set(QUEUE_CONFIG.queues.MONITORING, monitoringWorker);
    
    // Webhook processing worker
    const webhookWorker = new Worker(
      QUEUE_CONFIG.queues.WEBHOOK_PROCESSING,
      WebhookProcessor.process,
      {
        connection: connection.connection,
        concurrency: parseInt(process.env.WEBHOOK_WORKER_CONCURRENCY || '20', 10)
      }
    );
    this.workers.set(QUEUE_CONFIG.queues.WEBHOOK_PROCESSING, webhookWorker);
    
    // Cleanup worker
    const cleanupWorker = new Worker(
      QUEUE_CONFIG.queues.CLEANUP,
      CleanupProcessor.process,
      {
        connection: connection.connection,
        concurrency: 1 // Cleanup should be sequential
      }
    );
    this.workers.set(QUEUE_CONFIG.queues.CLEANUP, cleanupWorker);
    
    // Setup worker event listeners
    this.workers.forEach((worker, name) => {
      this.setupWorkerEventListeners(worker, name);
    });
    
    logger.info('Workers initialized successfully');
  }

  private async initializeSchedulers(): Promise<void> {
    const connection = getBullConnectionOptions();
    
    for (const [name, queueName] of Object.entries(QUEUE_CONFIG.queues)) {
      const scheduler = new QueueScheduler(queueName, {
        connection: connection.connection
      });
      
      this.schedulers.set(queueName, scheduler);
      logger.info(`Scheduler initialized for queue: ${queueName}`);
    }
  }

  private async initializeFlowProducer(): Promise<void> {
    const connection = getBullConnectionOptions();
    
    this.flowProducer = new FlowProducer({
      connection: connection.connection
    });
    
    logger.info('Flow producer initialized');
  }

  private initializeDashboard(): void {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath(this.options.dashboardPath!);
    
    const bullAdapters = Array.from(this.queues.values()).map(
      queue => new BullMQAdapter(queue)
    );
    
    createBullBoard({
      queues: bullAdapters,
      serverAdapter
    });
    
    this.dashboardAdapter = serverAdapter;
    logger.info(`Bull dashboard initialized at path: ${this.options.dashboardPath}`);
  }

  private setupQueueEventListeners(queue: Queue, name: string): void {
    queue.on('error', (error) => {
      logger.error(`Queue ${name} error:`, error);
    });
    
    queue.on('waiting', (jobId) => {
      logger.debug(`Job ${jobId} waiting in queue ${name}`);
    });
    
    queue.on('drained', () => {
      logger.debug(`Queue ${name} drained`);
    });
  }

  private setupWorkerEventListeners(worker: Worker, name: string): void {
    worker.on('completed', (job) => {
      logger.info(`Job ${job.id} completed in worker ${name}`);
    });
    
    worker.on('failed', (job, error) => {
      logger.error(`Job ${job?.id} failed in worker ${name}:`, error);
    });
    
    worker.on('error', (error) => {
      logger.error(`Worker ${name} error:`, error);
    });
    
    worker.on('stalled', (jobId) => {
      logger.warn(`Job ${jobId} stalled in worker ${name}`);
    });
  }

  // Public methods for job management
  public async addJob(
    queueName: string,
    jobType: JobType,
    data: any,
    options: any = {}
  ): Promise<Job> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    const jobOptions = {
      ...QUEUE_CONFIG.defaultJobOptions,
      ...options
    };
    
    const job = await queue.add(jobType, data, jobOptions);
    logger.info(`Job ${job.id} added to queue ${queueName}, type: ${jobType}`);
    
    return job;
  }

  public async addBulkJobs(
    queueName: string,
    jobs: Array<{ name: string; data: any; opts?: any }>
  ): Promise<Job[]> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    const bulkJobs = await queue.addBulk(jobs);
    logger.info(`${bulkJobs.length} jobs added to queue ${queueName}`);
    
    return bulkJobs;
  }

  public async createFlow(flowData: any): Promise<any> {
    if (!this.flowProducer) {
      throw new Error('Flow producer not initialized');
    }
    
    const flow = await this.flowProducer.add(flowData);
    logger.info('Flow created successfully');
    
    return flow;
  }

  public getQueue(queueName: string): Queue | undefined {
    return this.queues.get(queueName);
  }

  public getDashboardAdapter(): ExpressAdapter | null {
    return this.dashboardAdapter;
  }

  public async getQueueStats(queueName: string): Promise<any> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      queue.getPausedCount()
    ]);
    
    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused,
      total: waiting + active + completed + failed + delayed + paused
    };
  }

  public async getAllQueuesStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};
    
    for (const [name, queue] of this.queues.entries()) {
      stats[name] = await this.getQueueStats(name);
    }
    
    return stats;
  }

  public async pauseQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    await queue.pause();
    logger.info(`Queue ${queueName} paused`);
  }

  public async resumeQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    await queue.resume();
    logger.info(`Queue ${queueName} resumed`);
  }

  public async drainQueue(queueName: string, delayed = false): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    await queue.drain(delayed);
    logger.info(`Queue ${queueName} drained`);
  }

  public async cleanQueue(queueName: string, grace: number, limit: number, type: 'completed' | 'failed'): Promise<string[]> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    const jobs = await queue.clean(grace, limit, type);
    logger.info(`Cleaned ${jobs.length} ${type} jobs from queue ${queueName}`);
    
    return jobs;
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down QueueManager...');
    
    // Close all workers
    for (const [name, worker] of this.workers.entries()) {
      await worker.close();
      logger.info(`Worker ${name} closed`);
    }
    
    // Close all schedulers
    for (const [name, scheduler] of this.schedulers.entries()) {
      await scheduler.close();
      logger.info(`Scheduler ${name} closed`);
    }
    
    // Close flow producer
    if (this.flowProducer) {
      await this.flowProducer.close();
      logger.info('Flow producer closed');
    }
    
    // Close all queues
    for (const [name, queue] of this.queues.entries()) {
      await queue.close();
      logger.info(`Queue ${name} closed`);
    }
    
    this.isInitialized = false;
    logger.info('QueueManager shutdown complete');
  }

  // Utility method to mount dashboard on Express app
  public mountDashboard(app: Express): void {
    if (!this.dashboardAdapter) {
      throw new Error('Dashboard not initialized');
    }
    
    app.use(this.options.dashboardPath!, this.dashboardAdapter.getRouter());
    logger.info(`Bull dashboard mounted at: ${this.options.dashboardPath}`);
  }
}

export default QueueManager;