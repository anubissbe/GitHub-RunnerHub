import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import { JobRouter, JobRoutingRequest, JobRoutingResult } from './job-router';

const logger = createLogger('LoadBalancer');

export interface LoadBalancerConfig {
  maxConcurrentJobs: number;
  maxQueueSize: number;
  loadBalancingStrategy: LoadBalancingStrategy;
  healthCheckInterval: number;
  circuitBreakerThreshold: number;
  adaptiveThresholds: boolean;
  priorityQueues: number;
  preemptionEnabled: boolean;
}

export interface LoadBalancingStrategy {
  algorithm: LoadBalancingAlgorithm;
  weights?: Record<string, number>;
  stickyness?: StickyConfig;
  spillover?: SpilloverConfig;
  throttling?: ThrottlingConfig;
}

export interface StickyConfig {
  enabled: boolean;
  sessionKey: string; // e.g., 'repository', 'workflow', 'user'
  ttl: number; // Time to live in seconds
  maxSessions: number;
}

export interface SpilloverConfig {
  enabled: boolean;
  threshold: number; // 0-1, when to start spillover
  targetPools: string[]; // Other load balancer pools
  spilloverRatio: number; // 0-1, percentage to spillover
}

export interface ThrottlingConfig {
  enabled: boolean;
  maxRequestsPerSecond: number;
  maxRequestsPerMinute: number;
  burstCapacity: number;
  backoffStrategy: BackoffStrategy;
}

export interface LoadBalancerMetrics {
  totalRequests: number;
  activeJobs: number;
  queuedJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageResponseTime: number;
  throughput: number; // jobs per second
  errorRate: number;
  resourceUtilization: ResourceUtilization;
  poolHealth: PoolHealthMetrics[];
}

export interface ResourceUtilization {
  cpu: number;
  memory: number;
  network: number;
  storage: number;
}

export interface PoolHealthMetrics {
  poolId: string;
  healthy: boolean;
  activeRunners: number;
  totalRunners: number;
  averageLoad: number;
  lastHealthCheck: Date;
  errorCount: number;
  circuitBreakerOpen: boolean;
}

export interface JobQueue {
  id: string;
  priority: number;
  maxSize: number;
  currentSize: number;
  processing: boolean;
  jobs: QueuedJob[];
  drainMode: boolean;
}

export interface QueuedJob {
  id: string;
  request: JobRoutingRequest;
  enqueuedAt: Date;
  priority: number;
  retries: number;
  maxRetries: number;
  timeout: number;
  metadata: QueueJobMetadata;
}

export interface QueueJobMetadata {
  source: string;
  correlationId: string;
  parentJobId?: string;
  dependencies: string[];
  labels: Record<string, string>;
  estimatedProcessingTime: number;
}

export interface LoadBalancingResult {
  success: boolean;
  jobId: string;
  queueId?: string;
  estimatedWaitTime: number;
  position: number;
  routingResult?: JobRoutingResult;
  metadata: LoadBalancingMetadata;
}

export interface LoadBalancingMetadata {
  algorithm: LoadBalancingAlgorithm;
  processingTime: number;
  queueUtilization: number;
  loadDistribution: Record<string, number>;
  throttlingApplied: boolean;
  circuitBreakerState: CircuitBreakerState;
}

export enum LoadBalancingAlgorithm {
  ROUND_ROBIN = 'round-robin',
  WEIGHTED_ROUND_ROBIN = 'weighted-round-robin',
  LEAST_CONNECTIONS = 'least-connections',
  WEIGHTED_LEAST_CONNECTIONS = 'weighted-least-connections',
  RESOURCE_BASED = 'resource-based',
  PRIORITY_BASED = 'priority-based',
  ADAPTIVE = 'adaptive',
  CONSISTENT_HASH = 'consistent-hash'
}

export enum BackoffStrategy {
  LINEAR = 'linear',
  EXPONENTIAL = 'exponential',
  FIBONACCI = 'fibonacci',
  FIXED = 'fixed'
}

export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

export class LoadBalancer extends EventEmitter {
  private static instance: LoadBalancer;
  private jobRouter: JobRouter;
  private config: LoadBalancerConfig;
  private queues: Map<string, JobQueue> = new Map();
  private activeJobs: Map<string, QueuedJob> = new Map();
  private metrics!: LoadBalancerMetrics;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private throttlers: Map<string, RateLimiter> = new Map();
  private stickySessionManager: StickySessionManager;
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;

  private constructor(config: LoadBalancerConfig) {
    super();
    this.config = config;
    this.jobRouter = JobRouter.getInstance();
    this.stickySessionManager = new StickySessionManager(config.loadBalancingStrategy.stickyness);
    this.initializeQueues();
    this.initializeMetrics();
    this.startHealthChecks();
    this.startMetricsCollection();
  }

  public static getInstance(config?: LoadBalancerConfig): LoadBalancer {
    if (!LoadBalancer.instance) {
      const defaultConfig: LoadBalancerConfig = {
        maxConcurrentJobs: 100,
        maxQueueSize: 1000,
        loadBalancingStrategy: {
          algorithm: LoadBalancingAlgorithm.WEIGHTED_LEAST_CONNECTIONS
        },
        healthCheckInterval: 30000,
        circuitBreakerThreshold: 0.5,
        adaptiveThresholds: true,
        priorityQueues: 5,
        preemptionEnabled: false
      };

      LoadBalancer.instance = new LoadBalancer(config || defaultConfig);
    }
    return LoadBalancer.instance;
  }

  /**
   * Submit a job for load-balanced processing
   */
  public async submitJob(request: JobRoutingRequest): Promise<LoadBalancingResult> {
    const startTime = Date.now();

    try {
      logger.info(`Load balancing job ${request.jobId}`);

      // Apply throttling
      const throttlingResult = await this.applyThrottling(request);
      if (!throttlingResult.allowed) {
        return this.createThrottledResult(request, throttlingResult.reason);
      }

      // Check circuit breakers
      const circuitBreakerCheck = this.checkCircuitBreakers(request);
      if (!circuitBreakerCheck.allowed) {
        return this.createCircuitBreakerResult(request, circuitBreakerCheck.reason);
      }

      // Select queue based on priority and strategy
      const queueId = this.selectQueue(request);
      const queue = this.queues.get(queueId)!;

      // Check queue capacity
      if (queue.currentSize >= queue.maxSize) {
        return this.createQueueFullResult(request, queueId);
      }

      // Apply sticky session logic if enabled
      const stickyTarget = this.stickySessionManager.getTarget(request);

      // Create queued job
      const queuedJob: QueuedJob = {
        id: request.jobId,
        request,
        enqueuedAt: new Date(),
        priority: request.priority,
        retries: 0,
        maxRetries: 3,
        timeout: request.timeout || 3600000, // 1 hour default
        metadata: {
          source: 'load-balancer',
          correlationId: this.generateCorrelationId(),
          dependencies: request.needs || [],
          labels: {
            queue: queueId,
            sticky_target: stickyTarget || '',
            load_balancer: 'true'
          },
          estimatedProcessingTime: request.metadata.estimatedDuration
        }
      };

      // Add to queue
      this.enqueueJob(queue, queuedJob);

      // Update metrics
      this.updateMetrics('job_submitted', queuedJob);

      // Start processing if queue isn't already processing
      if (!queue.processing) {
        setImmediate(() => this.processQueue(queueId));
      }

      const result: LoadBalancingResult = {
        success: true,
        jobId: request.jobId,
        queueId,
        estimatedWaitTime: this.calculateEstimatedWaitTime(queue, queuedJob),
        position: this.getJobPosition(queue, queuedJob),
        metadata: {
          algorithm: this.config.loadBalancingStrategy.algorithm,
          processingTime: Date.now() - startTime,
          queueUtilization: queue.currentSize / queue.maxSize,
          loadDistribution: this.getLoadDistribution(),
          throttlingApplied: false,
          circuitBreakerState: CircuitBreakerState.CLOSED
        }
      };

      this.emit('job:submitted', { job: queuedJob, result });
      return result;

    } catch (error) {
      logger.error(`Failed to submit job ${request.jobId}:`, error);
      return this.createErrorResult(request, error as Error, Date.now() - startTime);
    }
  }

  /**
   * Process jobs in a specific queue
   */
  private async processQueue(queueId: string): Promise<void> {
    const queue = this.queues.get(queueId);
    if (!queue || queue.processing || queue.drainMode) {
      return;
    }

    queue.processing = true;

    try {
      while (queue.jobs.length > 0 && this.activeJobs.size < this.config.maxConcurrentJobs) {
        const job = this.dequeueJob(queue);
        if (!job) break;

        // Check if job has timed out in queue
        if (this.hasJobTimedOut(job)) {
          this.handleJobTimeout(job);
          continue;
        }

        // Process job
        await this.processJob(job);
      }
    } finally {
      queue.processing = false;
    }

    // Schedule next processing cycle if there are still jobs
    if (queue.jobs.length > 0) {
      setImmediate(() => this.processQueue(queueId));
    }
  }

  /**
   * Process an individual job
   */
  private async processJob(job: QueuedJob): Promise<void> {
    this.activeJobs.set(job.id, job);
    
    try {
      logger.info(`Processing job ${job.id} from queue ${job.metadata.labels.queue}`);

      // Apply load balancing algorithm
      const routingResult = await this.routeJobWithLoadBalancing(job);

      if (routingResult.success) {
        // Job successfully routed
        this.handleJobSuccess(job, routingResult);
      } else {
        // Job routing failed
        await this.handleJobFailure(job, new Error('Job routing failed'));
      }

    } catch (error) {
      await this.handleJobFailure(job, error as Error);
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  /**
   * Route job with load balancing considerations
   */
  private async routeJobWithLoadBalancing(job: QueuedJob): Promise<JobRoutingResult> {
    const algorithm = this.config.loadBalancingStrategy.algorithm;

    switch (algorithm) {
      case LoadBalancingAlgorithm.ROUND_ROBIN:
        return await this.routeWithRoundRobin(job);
      
      case LoadBalancingAlgorithm.WEIGHTED_ROUND_ROBIN:
        return await this.routeWithWeightedRoundRobin(job);
      
      case LoadBalancingAlgorithm.LEAST_CONNECTIONS:
        return await this.routeWithLeastConnections(job);
      
      case LoadBalancingAlgorithm.WEIGHTED_LEAST_CONNECTIONS:
        return await this.routeWithWeightedLeastConnections(job);
      
      case LoadBalancingAlgorithm.RESOURCE_BASED:
        return await this.routeWithResourceBased(job);
      
      case LoadBalancingAlgorithm.PRIORITY_BASED:
        return await this.routeWithPriorityBased(job);
      
      case LoadBalancingAlgorithm.ADAPTIVE:
        return await this.routeWithAdaptive(job);
      
      case LoadBalancingAlgorithm.CONSISTENT_HASH:
        return await this.routeWithConsistentHash(job);
      
      default:
        return await this.jobRouter.routeJob(job.request);
    }
  }

  /**
   * Load balancing algorithm implementations
   */
  private async routeWithRoundRobin(job: QueuedJob): Promise<JobRoutingResult> {
    // Simple delegation to job router for round-robin
    return await this.jobRouter.routeJob(job.request);
  }

  private async routeWithWeightedRoundRobin(job: QueuedJob): Promise<JobRoutingResult> {
    // Apply weights from configuration
    const weights = this.config.loadBalancingStrategy.weights || {};
    
    // Modify request to include weight preferences
    const weightedRequest = {
      ...job.request,
      metadata: {
        ...job.request.metadata,
        preferences: {
          ...job.request.metadata.preferences,
          performanceProfile: this.selectWeightedPerformanceProfile(weights)
        }
      }
    };

    return await this.jobRouter.routeJob(weightedRequest);
  }

  private async routeWithLeastConnections(job: QueuedJob): Promise<JobRoutingResult> {
    // Route to runner with least current connections/load
    const modifiedRequest = {
      ...job.request,
      metadata: {
        ...job.request.metadata,
        preferences: {
          ...job.request.metadata.preferences,
          performanceProfile: 'efficiency' as any
        }
      }
    };

    return await this.jobRouter.routeJob(modifiedRequest);
  }

  private async routeWithWeightedLeastConnections(job: QueuedJob): Promise<JobRoutingResult> {
    // Combine least connections with weights
    const weights = this.config.loadBalancingStrategy.weights || {};
    
    const weightedRequest = {
      ...job.request,
      metadata: {
        ...job.request.metadata,
        preferences: {
          ...job.request.metadata.preferences,
          performanceProfile: 'balanced' as any,
          affinityRules: this.createWeightedAffinityRules(weights)
        }
      }
    };

    return await this.jobRouter.routeJob(weightedRequest);
  }

  private async routeWithResourceBased(job: QueuedJob): Promise<JobRoutingResult> {
    // Route based on resource requirements and availability
    const resourceRequest = {
      ...job.request,
      metadata: {
        ...job.request.metadata,
        preferences: {
          ...job.request.metadata.preferences,
          performanceProfile: 'speed' as any
        }
      }
    };

    return await this.jobRouter.routeJob(resourceRequest);
  }

  private async routeWithPriorityBased(job: QueuedJob): Promise<JobRoutingResult> {
    // Route high-priority jobs to best available resources
    if (job.priority <= 2) { // High/Critical priority
      const priorityRequest = {
        ...job.request,
        metadata: {
          ...job.request.metadata,
          preferences: {
            ...job.request.metadata.preferences,
            performanceProfile: 'speed' as any,
            preferredRunners: this.getHighPerformanceRunners()
          }
        }
      };

      return await this.jobRouter.routeJob(priorityRequest);
    }

    return await this.jobRouter.routeJob(job.request);
  }

  private async routeWithAdaptive(job: QueuedJob): Promise<JobRoutingResult> {
    // Adapt routing strategy based on current system state
    const systemLoad = this.calculateSystemLoad();
    const queueLoad = this.calculateQueueLoad();

    let strategy: any = 'balanced';

    if (systemLoad > 0.8) {
      strategy = 'efficiency'; // Focus on resource efficiency
    } else if (queueLoad > 0.6) {
      strategy = 'speed'; // Focus on processing speed
    }

    const adaptiveRequest = {
      ...job.request,
      metadata: {
        ...job.request.metadata,
        preferences: {
          ...job.request.metadata.preferences,
          performanceProfile: strategy
        }
      }
    };

    return await this.jobRouter.routeJob(adaptiveRequest);
  }

  private async routeWithConsistentHash(job: QueuedJob): Promise<JobRoutingResult> {
    // Use consistent hashing for sticky routing
    const hashKey = this.stickySessionManager.generateHashKey(job.request);
    const targetRunner = this.stickySessionManager.getConsistentTarget(hashKey);

    if (targetRunner) {
      const consistentRequest = {
        ...job.request,
        metadata: {
          ...job.request.metadata,
          preferences: {
            ...job.request.metadata.preferences,
            preferredRunners: [targetRunner]
          }
        }
      };

      return await this.jobRouter.routeJob(consistentRequest);
    }

    return await this.jobRouter.routeJob(job.request);
  }

  /**
   * Initialize priority queues
   */
  private initializeQueues(): void {
    for (let i = 1; i <= this.config.priorityQueues; i++) {
      const queue: JobQueue = {
        id: `priority-${i}`,
        priority: i,
        maxSize: Math.floor(this.config.maxQueueSize / this.config.priorityQueues),
        currentSize: 0,
        processing: false,
        jobs: [],
        drainMode: false
      };

      this.queues.set(queue.id, queue);
    }

    logger.info(`Initialized ${this.config.priorityQueues} priority queues`);
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      activeJobs: 0,
      queuedJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      averageResponseTime: 0,
      throughput: 0,
      errorRate: 0,
      resourceUtilization: {
        cpu: 0,
        memory: 0,
        network: 0,
        storage: 0
      },
      poolHealth: []
    };
  }

  /**
   * Select appropriate queue for job
   */
  private selectQueue(request: JobRoutingRequest): string {
    // Map job priority to queue priority
    const queuePriority = Math.min(request.priority, this.config.priorityQueues);
    return `priority-${queuePriority}`;
  }

  /**
   * Add job to queue
   */
  private enqueueJob(queue: JobQueue, job: QueuedJob): void {
    // Insert job in priority order
    const insertIndex = this.findInsertIndex(queue.jobs, job);
    queue.jobs.splice(insertIndex, 0, job);
    queue.currentSize++;

    this.emit('job:enqueued', { queueId: queue.id, job });
  }

  /**
   * Remove job from queue
   */
  private dequeueJob(queue: JobQueue): QueuedJob | null {
    if (queue.jobs.length === 0) return null;

    const job = queue.jobs.shift()!;
    queue.currentSize--;

    this.emit('job:dequeued', { queueId: queue.id, job });
    return job;
  }

  /**
   * Find correct insertion index for priority ordering
   */
  private findInsertIndex(jobs: QueuedJob[], newJob: QueuedJob): number {
    let left = 0;
    let right = jobs.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      
      if (jobs[mid].priority > newJob.priority) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }

  /**
   * Calculate estimated wait time for job in queue
   */
  private calculateEstimatedWaitTime(queue: JobQueue, job: QueuedJob): number {
    const position = this.getJobPosition(queue, job);
    const averageProcessingTime = this.calculateAverageProcessingTime();
    
    return position * averageProcessingTime;
  }

  /**
   * Get position of job in queue
   */
  private getJobPosition(queue: JobQueue, job: QueuedJob): number {
    return queue.jobs.findIndex(j => j.id === job.id) + 1;
  }

  /**
   * Check if job has timed out in queue
   */
  private hasJobTimedOut(job: QueuedJob): boolean {
    const now = Date.now();
    const enqueuedTime = job.enqueuedAt.getTime();
    return (now - enqueuedTime) > job.timeout;
  }

  /**
   * Handle job timeout
   */
  private handleJobTimeout(job: QueuedJob): void {
    logger.warn(`Job ${job.id} timed out in queue`);
    
    this.updateMetrics('job_timeout', job);
    this.emit('job:timeout', { job });
  }

  /**
   * Handle successful job processing
   */
  private handleJobSuccess(job: QueuedJob, routingResult: JobRoutingResult): void {
    logger.info(`Job ${job.id} processed successfully`);
    
    this.updateMetrics('job_success', job);
    this.emit('job:success', { job, routingResult });

    // Update sticky session if enabled
    if (this.config.loadBalancingStrategy.stickyness?.enabled && routingResult.selectedRunner) {
      this.stickySessionManager.updateSession(job.request, routingResult.selectedRunner.runnerId);
    }
  }

  /**
   * Handle job processing failure
   */
  private async handleJobFailure(job: QueuedJob, error: Error): Promise<void> {
    logger.error(`Job ${job.id} failed:`, error);

    job.retries++;

    if (job.retries < job.maxRetries) {
      // Retry job with exponential backoff
      const backoffDelay = this.calculateBackoffDelay(job.retries);
      
      setTimeout(() => {
        // Re-enqueue job
        const queueId = job.metadata.labels.queue;
        const queue = this.queues.get(queueId);
        if (queue) {
          this.enqueueJob(queue, job);
        }
      }, backoffDelay);

      this.emit('job:retry', { job, attempt: job.retries, delay: backoffDelay });
    } else {
      // Job failed permanently
      this.updateMetrics('job_failure', job);
      this.emit('job:failed', { job, error });

      // Update circuit breaker
      const runnerId = job.metadata.labels.sticky_target;
      if (runnerId) {
        this.updateCircuitBreaker(runnerId, false);
      }
    }
  }

  /**
   * Apply rate throttling
   */
  private async applyThrottling(request: JobRoutingRequest): Promise<{ allowed: boolean; reason?: string }> {
    const throttling = this.config.loadBalancingStrategy.throttling;
    if (!throttling?.enabled) {
      return { allowed: true };
    }

    const key = this.generateThrottlingKey(request);
    const limiter = this.getOrCreateRateLimiter(key, throttling);

    const allowed = await limiter.isAllowed();
    if (!allowed) {
      return { 
        allowed: false, 
        reason: `Rate limit exceeded for ${key}` 
      };
    }

    return { allowed: true };
  }

  /**
   * Check circuit breakers
   */
  private checkCircuitBreakers(request: JobRoutingRequest): { allowed: boolean; reason?: string } {
    // Check if any circuit breakers would prevent this job
    const potentialRunners = this.getPotentialRunners(request);
    
    for (const runnerId of potentialRunners) {
      const circuitBreaker = this.circuitBreakers.get(runnerId);
      if (circuitBreaker && circuitBreaker.isOpen()) {
        return {
          allowed: false,
          reason: `Circuit breaker open for runner ${runnerId}`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Update metrics
   */
  private updateMetrics(event: string, _job: QueuedJob): void {
    switch (event) {
      case 'job_submitted':
        this.metrics.totalRequests++;
        this.metrics.queuedJobs++;
        break;
      
      case 'job_success':
        this.metrics.completedJobs++;
        this.metrics.queuedJobs--;
        break;
      
      case 'job_failure':
      case 'job_timeout':
        this.metrics.failedJobs++;
        this.metrics.queuedJobs--;
        break;
    }

    this.metrics.activeJobs = this.activeJobs.size;
    this.metrics.errorRate = this.metrics.failedJobs / (this.metrics.totalRequests || 1);
  }

  /**
   * Start health checks
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, 60000); // Every minute
  }

  /**
   * Perform health checks
   */
  private async performHealthChecks(): Promise<void> {
    // Check queue health
    for (const [queueId, queue] of this.queues.entries()) {
      const utilization = queue.currentSize / queue.maxSize;
      
      if (utilization > 0.9) {
        logger.warn(`Queue ${queueId} is ${Math.round(utilization * 100)}% full`);
        this.emit('queue:high_utilization', { queueId, utilization });
      }
    }

    // Check circuit breakers
    for (const [runnerId, circuitBreaker] of this.circuitBreakers.entries()) {
      if (circuitBreaker.isOpen()) {
        logger.warn(`Circuit breaker open for runner ${runnerId}`);
      }
    }
  }

  /**
   * Collect detailed metrics
   */
  private collectMetrics(): void {
    // Calculate throughput
    const now = Date.now();
    if (this.lastMetricsTime) {
      const timeDiff = (now - this.lastMetricsTime) / 1000; // seconds
      this.metrics.throughput = this.recentCompletedJobs / timeDiff;
      this.recentCompletedJobs = 0;
    }
    this.lastMetricsTime = now;

    // Emit metrics event
    this.emit('metrics:collected', this.metrics);
  }

  private lastMetricsTime?: number;
  private recentCompletedJobs = 0;

  /**
   * Helper methods
   */
  private generateCorrelationId(): string {
    return `lb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateThrottlingKey(request: JobRoutingRequest): string {
    return `${request.repository}:${request.workflowId}`;
  }

  private getOrCreateRateLimiter(key: string, config: ThrottlingConfig): RateLimiter {
    if (!this.throttlers.has(key)) {
      this.throttlers.set(key, new RateLimiter(config));
    }
    return this.throttlers.get(key)!;
  }

  private getPotentialRunners(_request: JobRoutingRequest): string[] {
    // This would typically query available runners
    // For now, return empty array
    return [];
  }

  private selectWeightedPerformanceProfile(weights: Record<string, number>): any {
    // Select performance profile based on weights
    const profiles = ['speed', 'balanced', 'efficiency'];
    const weighted = profiles.map(profile => ({
      profile,
      weight: weights[profile] || 1
    }));

    const total = weighted.reduce((sum, w) => sum + w.weight, 0);
    const random = Math.random() * total;
    
    let acc = 0;
    for (const w of weighted) {
      acc += w.weight;
      if (random <= acc) {
        return w.profile;
      }
    }

    return 'balanced';
  }

  private createWeightedAffinityRules(weights: Record<string, number>): any[] {
    return Object.entries(weights).map(([key, weight]) => ({
      type: 'soft',
      weight: weight * 100,
      selector: {
        labels: { [key]: 'true' }
      }
    }));
  }

  private getHighPerformanceRunners(): string[] {
    // Return list of high-performance runner IDs
    return ['high-perf-1', 'high-perf-2', 'high-perf-3'];
  }

  private calculateSystemLoad(): number {
    return this.activeJobs.size / this.config.maxConcurrentJobs;
  }

  private calculateQueueLoad(): number {
    const totalQueued = Array.from(this.queues.values())
      .reduce((sum, queue) => sum + queue.currentSize, 0);
    return totalQueued / this.config.maxQueueSize;
  }

  private calculateAverageProcessingTime(): number {
    // Return average processing time in milliseconds
    return 30000; // 30 seconds default
  }

  private calculateBackoffDelay(retryCount: number): number {
    const baseDelay = 1000; // 1 second
    return baseDelay * Math.pow(2, retryCount - 1); // Exponential backoff
  }

  private updateCircuitBreaker(runnerId: string, success: boolean): void {
    if (!this.circuitBreakers.has(runnerId)) {
      this.circuitBreakers.set(runnerId, new CircuitBreaker(this.config.circuitBreakerThreshold));
    }

    const circuitBreaker = this.circuitBreakers.get(runnerId)!;
    circuitBreaker.recordResult(success);
  }

  private getLoadDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};
    
    for (const [queueId, queue] of this.queues.entries()) {
      distribution[queueId] = queue.currentSize;
    }

    return distribution;
  }

  /**
   * Result creation methods
   */
  private createThrottledResult(request: JobRoutingRequest, _reason: string): LoadBalancingResult {
    return {
      success: false,
      jobId: request.jobId,
      estimatedWaitTime: 0,
      position: 0,
      metadata: {
        algorithm: this.config.loadBalancingStrategy.algorithm,
        processingTime: 0,
        queueUtilization: 0,
        loadDistribution: {},
        throttlingApplied: true,
        circuitBreakerState: CircuitBreakerState.CLOSED
      }
    };
  }

  private createCircuitBreakerResult(request: JobRoutingRequest, _reason: string): LoadBalancingResult {
    return {
      success: false,
      jobId: request.jobId,
      estimatedWaitTime: 0,
      position: 0,
      metadata: {
        algorithm: this.config.loadBalancingStrategy.algorithm,
        processingTime: 0,
        queueUtilization: 0,
        loadDistribution: {},
        throttlingApplied: false,
        circuitBreakerState: CircuitBreakerState.OPEN
      }
    };
  }

  private createQueueFullResult(request: JobRoutingRequest, queueId: string): LoadBalancingResult {
    return {
      success: false,
      jobId: request.jobId,
      queueId,
      estimatedWaitTime: 0,
      position: 0,
      metadata: {
        algorithm: this.config.loadBalancingStrategy.algorithm,
        processingTime: 0,
        queueUtilization: 1.0,
        loadDistribution: this.getLoadDistribution(),
        throttlingApplied: false,
        circuitBreakerState: CircuitBreakerState.CLOSED
      }
    };
  }

  private createErrorResult(request: JobRoutingRequest, error: Error, processingTime: number): LoadBalancingResult {
    return {
      success: false,
      jobId: request.jobId,
      estimatedWaitTime: 0,
      position: 0,
      metadata: {
        algorithm: this.config.loadBalancingStrategy.algorithm,
        processingTime,
        queueUtilization: 0,
        loadDistribution: {},
        throttlingApplied: false,
        circuitBreakerState: CircuitBreakerState.CLOSED
      }
    };
  }

  /**
   * Public API methods
   */
  public getMetrics(): LoadBalancerMetrics {
    return { ...this.metrics };
  }

  public getQueueStatus(): JobQueue[] {
    return Array.from(this.queues.values());
  }

  public async drainQueue(queueId: string): Promise<void> {
    const queue = this.queues.get(queueId);
    if (queue) {
      queue.drainMode = true;
      logger.info(`Queue ${queueId} set to drain mode`);
    }
  }

  public async pauseQueue(queueId: string): Promise<void> {
    const queue = this.queues.get(queueId);
    if (queue) {
      queue.processing = false;
      logger.info(`Queue ${queueId} paused`);
    }
  }

  public async resumeQueue(queueId: string): Promise<void> {
    const queue = this.queues.get(queueId);
    if (queue) {
      queue.drainMode = false;
      if (!queue.processing && queue.jobs.length > 0) {
        setImmediate(() => this.processQueue(queueId));
      }
      logger.info(`Queue ${queueId} resumed`);
    }
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down load balancer');

    // Stop health checks and metrics collection
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Drain all queues
    for (const queueId of this.queues.keys()) {
      await this.drainQueue(queueId);
    }

    // Wait for active jobs to complete (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeJobs.size > 0 && (Date.now() - startTime) < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.emit('shutdown:complete');
  }
}

/**
 * Supporting classes
 */
class CircuitBreaker {
  private failures = 0;
  private successes = 0;
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private lastFailureTime = 0;
  private halfOpenTimeout = 60000; // 1 minute

  constructor(private threshold: number) {}

  recordResult(success: boolean): void {
    if (success) {
      this.successes++;
      if (this.state === CircuitBreakerState.HALF_OPEN) {
        this.state = CircuitBreakerState.CLOSED;
        this.failures = 0;
      }
    } else {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      const failureRate = this.failures / (this.failures + this.successes);
      if (failureRate >= this.threshold) {
        this.state = CircuitBreakerState.OPEN;
      }
    }
  }

  isOpen(): boolean {
    if (this.state === CircuitBreakerState.OPEN) {
      // Check if we should transition to half-open
      if (Date.now() - this.lastFailureTime > this.halfOpenTimeout) {
        this.state = CircuitBreakerState.HALF_OPEN;
        return false;
      }
      return true;
    }
    return false;
  }

  getState(): CircuitBreakerState {
    return this.state;
  }
}

class RateLimiter {
  private requests: number[] = [];

  constructor(private config: ThrottlingConfig) {}

  async isAllowed(): Promise<boolean> {
    const now = Date.now();
    
    // Clean old requests
    this.requests = this.requests.filter(time => now - time < 60000); // Keep last minute

    // Check per-second limit
    const recentRequests = this.requests.filter(time => now - time < 1000);
    if (recentRequests.length >= this.config.maxRequestsPerSecond) {
      return false;
    }

    // Check per-minute limit
    if (this.requests.length >= this.config.maxRequestsPerMinute) {
      return false;
    }

    // Record this request
    this.requests.push(now);
    return true;
  }
}

class StickySessionManager {
  private sessions: Map<string, StickySession> = new Map();
  private consistentHashRing: ConsistentHashRing;

  constructor(private config?: StickyConfig) {
    this.consistentHashRing = new ConsistentHashRing();
  }

  getTarget(request: JobRoutingRequest): string | null {
    if (!this.config?.enabled) return null;

    const sessionKey = this.generateSessionKey(request);
    const session = this.sessions.get(sessionKey);

    if (session && !this.isSessionExpired(session)) {
      return session.targetId;
    }

    return null;
  }

  updateSession(request: JobRoutingRequest, targetId: string): void {
    if (!this.config?.enabled) return;

    const sessionKey = this.generateSessionKey(request);
    const session: StickySession = {
      key: sessionKey,
      targetId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.ttl * 1000)
    };

    this.sessions.set(sessionKey, session);

    // Cleanup expired sessions
    if (this.sessions.size > this.config.maxSessions) {
      this.cleanupExpiredSessions();
    }
  }

  generateHashKey(request: JobRoutingRequest): string {
    return `${request.repository}:${request.workflowId}`;
  }

  getConsistentTarget(hashKey: string): string | null {
    return this.consistentHashRing.getTarget(hashKey);
  }

  private generateSessionKey(request: JobRoutingRequest): string {
    switch (this.config?.sessionKey) {
      case 'repository':
        return request.repository;
      case 'workflow':
        return `${request.repository}:${request.workflowId}`;
      case 'user':
        return request.metadata.tags.find(tag => tag.startsWith('user:')) || 'anonymous';
      default:
        return request.repository;
    }
  }

  private isSessionExpired(session: StickySession): boolean {
    return new Date() > session.expiresAt;
  }

  private cleanupExpiredSessions(): void {
    for (const [key, session] of this.sessions.entries()) {
      if (this.isSessionExpired(session)) {
        this.sessions.delete(key);
      }
    }
  }
}

class ConsistentHashRing {
  private ring: Map<number, string> = new Map();
  private virtualNodes = 150;

  addNode(nodeId: string): void {
    for (let i = 0; i < this.virtualNodes; i++) {
      const hash = this.hash(`${nodeId}:${i}`);
      this.ring.set(hash, nodeId);
    }
  }

  removeNode(nodeId: string): void {
    for (let i = 0; i < this.virtualNodes; i++) {
      const hash = this.hash(`${nodeId}:${i}`);
      this.ring.delete(hash);
    }
  }

  getTarget(key: string): string | null {
    if (this.ring.size === 0) return null;

    const hash = this.hash(key);
    const sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b);

    // Find the first hash greater than or equal to the key hash
    for (const h of sortedHashes) {
      if (h >= hash) {
        return this.ring.get(h) || null;
      }
    }

    // Wrap around to the first node
    return this.ring.get(sortedHashes[0]) || null;
  }

  private hash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

interface StickySession {
  key: string;
  targetId: string;
  createdAt: Date;
  expiresAt: Date;
}

export default LoadBalancer;