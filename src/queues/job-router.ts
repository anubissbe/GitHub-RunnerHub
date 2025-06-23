import { QueueManager } from './queue-manager';
import { QUEUE_CONFIG, JobType } from './config/redis-config';
import { logger } from '../utils/logger';

export interface JobRequest {
  type: JobType;
  data: any;
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: any;
  removeOnComplete?: boolean | any;
  removeOnFail?: boolean | any;
  metadata?: Record<string, any>;
}

export interface RouteDecision {
  queue: string;
  priority: number;
  jobOptions: any;
}

export class JobRouter {
  private static instance: JobRouter;
  private queueManager: QueueManager;
  private routingRules: Map<JobType, (data: any) => RouteDecision> = new Map();
  
  private constructor() {
    this.queueManager = QueueManager.getInstance();
    this.initializeRoutingRules();
  }
  
  public static getInstance(): JobRouter {
    if (!JobRouter.instance) {
      JobRouter.instance = new JobRouter();
    }
    return JobRouter.instance;
  }
  
  private initializeRoutingRules(): void {
    // Job execution routing rules
    this.routingRules.set(JobType.EXECUTE_WORKFLOW, (data) => ({
      queue: QUEUE_CONFIG.queues.JOB_EXECUTION,
      priority: this.calculateWorkflowPriority(data),
      jobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: {
          age: 24 * 3600,
          count: 100
        }
      }
    }));
    
    this.routingRules.set(JobType.PREPARE_RUNNER, (_data) => ({
      queue: QUEUE_CONFIG.queues.JOB_EXECUTION,
      priority: QUEUE_CONFIG.priorities.HIGH,
      jobOptions: {
        attempts: 5,
        backoff: {
          type: 'fixed',
          delay: 2000
        }
      }
    }));
    
    this.routingRules.set(JobType.CLEANUP_RUNNER, (_data) => ({
      queue: QUEUE_CONFIG.queues.JOB_EXECUTION,
      priority: QUEUE_CONFIG.priorities.LOW,
      jobOptions: {
        attempts: 2,
        delay: 30000 // Delay cleanup by 30 seconds
      }
    }));
    
    // Container management routing rules
    this.routingRules.set(JobType.CREATE_CONTAINER, (data) => ({
      queue: QUEUE_CONFIG.queues.CONTAINER_MANAGEMENT,
      priority: data.urgent ? QUEUE_CONFIG.priorities.HIGH : QUEUE_CONFIG.priorities.NORMAL,
      jobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 3000
        }
      }
    }));
    
    this.routingRules.set(JobType.DESTROY_CONTAINER, (_data) => ({
      queue: QUEUE_CONFIG.queues.CONTAINER_MANAGEMENT,
      priority: QUEUE_CONFIG.priorities.NORMAL,
      jobOptions: {
        attempts: 5,
        removeOnComplete: true
      }
    }));
    
    this.routingRules.set(JobType.HEALTH_CHECK, (_data) => ({
      queue: QUEUE_CONFIG.queues.CONTAINER_MANAGEMENT,
      priority: QUEUE_CONFIG.priorities.LOW,
      jobOptions: {
        attempts: 1,
        removeOnComplete: {
          age: 3600,
          count: 1000
        }
      }
    }));
    
    // Monitoring routing rules
    this.routingRules.set(JobType.COLLECT_METRICS, (data) => ({
      queue: QUEUE_CONFIG.queues.MONITORING,
      priority: QUEUE_CONFIG.priorities.NORMAL,
      jobOptions: {
        repeat: {
          every: data.interval || 60000 // Default 1 minute
        },
        removeOnComplete: {
          age: 3600,
          count: 100
        }
      }
    }));
    
    this.routingRules.set(JobType.SEND_ALERT, (data) => ({
      queue: QUEUE_CONFIG.queues.MONITORING,
      priority: this.calculateAlertPriority(data),
      jobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      }
    }));
    
    this.routingRules.set(JobType.UPDATE_STATUS, (_data) => ({
      queue: QUEUE_CONFIG.queues.MONITORING,
      priority: QUEUE_CONFIG.priorities.HIGH,
      jobOptions: {
        attempts: 3,
        removeOnComplete: true
      }
    }));
    
    // Webhook processing routing rules
    this.routingRules.set(JobType.PROCESS_WEBHOOK, (data) => ({
      queue: QUEUE_CONFIG.queues.WEBHOOK_PROCESSING,
      priority: this.calculateWebhookPriority(data),
      jobOptions: {
        attempts: 3,
        backoff: {
          type: 'fixed',
          delay: 1000
        }
      }
    }));
    
    this.routingRules.set(JobType.SYNC_GITHUB_DATA, (_data) => ({
      queue: QUEUE_CONFIG.queues.WEBHOOK_PROCESSING,
      priority: QUEUE_CONFIG.priorities.LOW,
      jobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 10000
        }
      }
    }));
    
    // Cleanup routing rules
    this.routingRules.set(JobType.CLEANUP_OLD_JOBS, (data) => ({
      queue: QUEUE_CONFIG.queues.CLEANUP,
      priority: QUEUE_CONFIG.priorities.LOW,
      jobOptions: {
        repeat: {
          pattern: data.cronPattern || '0 2 * * *' // Default: 2 AM daily
        },
        removeOnComplete: true
      }
    }));
    
    this.routingRules.set(JobType.CLEANUP_CONTAINERS, (data) => ({
      queue: QUEUE_CONFIG.queues.CLEANUP,
      priority: QUEUE_CONFIG.priorities.LOW,
      jobOptions: {
        repeat: {
          pattern: data.cronPattern || '0 */6 * * *' // Default: Every 6 hours
        },
        removeOnComplete: true
      }
    }));
    
    this.routingRules.set(JobType.CLEANUP_LOGS, (data) => ({
      queue: QUEUE_CONFIG.queues.CLEANUP,
      priority: QUEUE_CONFIG.priorities.LOW,
      jobOptions: {
        repeat: {
          pattern: data.cronPattern || '0 3 * * 0' // Default: 3 AM on Sundays
        },
        removeOnComplete: true
      }
    }));
  }
  
  public async route(jobRequest: JobRequest): Promise<any> {
    const { type, data, priority: requestedPriority, ...customOptions } = jobRequest;
    
    // Get routing decision
    const routingRule = this.routingRules.get(type);
    if (!routingRule) {
      throw new Error(`No routing rule defined for job type: ${type}`);
    }
    
    const decision = routingRule(data);
    
    // Merge options
    const finalOptions = {
      ...decision.jobOptions,
      ...customOptions,
      priority: requestedPriority ?? decision.priority
    };
    
    // Log routing decision
    logger.info(`Routing job ${type} to queue ${decision.queue} with priority ${finalOptions.priority}`);
    
    // Add job to queue
    const job = await this.queueManager.addJob(
      decision.queue,
      type,
      data,
      finalOptions
    );
    
    return job;
  }
  
  public async routeBatch(jobRequests: JobRequest[]): Promise<any[]> {
    const results = [];
    
    // Group by queue for efficient bulk operations
    const groupedByQueue = new Map<string, Array<{ name: string; data: any; opts: any }>>();
    
    for (const jobRequest of jobRequests) {
      const { type, data, priority: requestedPriority, ...customOptions } = jobRequest;
      
      const routingRule = this.routingRules.get(type);
      if (!routingRule) {
        logger.warn(`No routing rule for job type: ${type}, skipping`);
        continue;
      }
      
      const decision = routingRule(data);
      const finalOptions = {
        ...decision.jobOptions,
        ...customOptions,
        priority: requestedPriority ?? decision.priority
      };
      
      if (!groupedByQueue.has(decision.queue)) {
        groupedByQueue.set(decision.queue, []);
      }
      
      groupedByQueue.get(decision.queue)!.push({
        name: type,
        data: { type, data },
        opts: finalOptions
      });
    }
    
    // Add jobs in bulk per queue
    for (const [queueName, jobs] of groupedByQueue.entries()) {
      const bulkResults = await this.queueManager.addBulkJobs(queueName, jobs);
      results.push(...bulkResults);
    }
    
    logger.info(`Routed ${results.length} jobs to ${groupedByQueue.size} queues`);
    
    return results;
  }
  
  // Priority calculation methods
  private calculateWorkflowPriority(data: any): number {
    // Critical workflows get highest priority
    if (data.workflow?.includes('deploy') || data.workflow?.includes('hotfix')) {
      return QUEUE_CONFIG.priorities.CRITICAL;
    }
    
    // PR workflows get high priority
    if (data.event === 'pull_request') {
      return QUEUE_CONFIG.priorities.HIGH;
    }
    
    // Regular push events get normal priority
    if (data.event === 'push') {
      return QUEUE_CONFIG.priorities.NORMAL;
    }
    
    // Everything else gets low priority
    return QUEUE_CONFIG.priorities.LOW;
  }
  
  private calculateAlertPriority(data: any): number {
    const severityMap = {
      critical: QUEUE_CONFIG.priorities.CRITICAL,
      error: QUEUE_CONFIG.priorities.HIGH,
      warning: QUEUE_CONFIG.priorities.NORMAL,
      info: QUEUE_CONFIG.priorities.LOW
    };
    
    return severityMap[data.severity as keyof typeof severityMap] || QUEUE_CONFIG.priorities.NORMAL;
  }
  
  private calculateWebhookPriority(data: any): number {
    const eventPriorityMap = {
      workflow_job: QUEUE_CONFIG.priorities.CRITICAL,
      workflow_run: QUEUE_CONFIG.priorities.HIGH,
      check_run: QUEUE_CONFIG.priorities.HIGH,
      pull_request: QUEUE_CONFIG.priorities.NORMAL,
      push: QUEUE_CONFIG.priorities.NORMAL,
      repository: QUEUE_CONFIG.priorities.LOW
    };
    
    return eventPriorityMap[data.event as keyof typeof eventPriorityMap] || QUEUE_CONFIG.priorities.NORMAL;
  }
  
  // Utility methods
  public getRoutingRules(): Map<JobType, Function> {
    return new Map(this.routingRules);
  }
  
  public updateRoutingRule(jobType: JobType, rule: (data: any) => RouteDecision): void {
    this.routingRules.set(jobType, rule);
    logger.info(`Updated routing rule for job type: ${jobType}`);
  }
  
  public async getQueueDistribution(): Promise<Record<string, number>> {
    const distribution: Record<string, number> = {};
    
    for (const queueName of Object.values(QUEUE_CONFIG.queues)) {
      const stats = await this.queueManager.getQueueStats(queueName);
      distribution[queueName] = stats.total;
    }
    
    return distribution;
  }
  
  public async optimizeRouting(): Promise<void> {
    // Get current queue loads
    const queueStats = await this.queueManager.getAllQueuesStats();
    
    // Analyze queue performance
    const queuePerformance: Record<string, any> = {};
    
    for (const [queueName, stats] of Object.entries(queueStats)) {
      const throughput = stats.completed / (stats.completed + stats.failed + 1);
      const backlog = stats.waiting + stats.delayed;
      
      queuePerformance[queueName] = {
        throughput,
        backlog,
        utilization: stats.active / (stats.active + stats.waiting + 1)
      };
    }
    
    // Log optimization suggestions
    for (const [queueName, performance] of Object.entries(queuePerformance)) {
      if (performance.backlog > 100) {
        logger.warn(`Queue ${queueName} has high backlog (${performance.backlog}), consider scaling workers`);
      }
      
      if (performance.throughput < 0.8) {
        logger.warn(`Queue ${queueName} has low throughput (${(performance.throughput * 100).toFixed(1)}%), check for failures`);
      }
    }
  }
}

export default JobRouter;