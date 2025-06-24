import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import { JobRouter, JobRoutingRequest, JobRoutingResult } from './job-router';
import { LoadBalancer, LoadBalancingResult } from './load-balancer';
import { ResourceScheduler, SchedulingRequest, SchedulingResult } from './resource-scheduler';
import { DependencyManager, DependencyGraph } from './dependency-manager';

const logger = createLogger('ParallelExecutor');

export interface ParallelExecutionConfig {
  maxConcurrentJobs: number;
  maxQueuedJobs: number;
  jobTimeout: number;
  enableDependencyExecution: boolean;
  enableResourceAwareScheduling: boolean;
  enableLoadBalancing: boolean;
  executionStrategies: ExecutionStrategy[];
  failureHandling: FailureHandlingConfig;
  monitoring: MonitoringConfig;
}

export interface ExecutionStrategy {
  name: string;
  priority: number;
  conditions: ExecutionCondition[];
  configuration: Record<string, any>;
}

export interface ExecutionCondition {
  type: ConditionType;
  parameter: string;
  operator: ComparisonOperator;
  value: any;
}

export interface FailureHandlingConfig {
  retryEnabled: boolean;
  maxRetries: number;
  retryDelay: number;
  retryBackoffMultiplier: number;
  failFastEnabled: boolean;
  rollbackEnabled: boolean;
  notificationChannels: string[];
}

export interface MonitoringConfig {
  metricsEnabled: boolean;
  detailedLogging: boolean;
  performanceTracking: boolean;
  resourceUtilizationTracking: boolean;
  executionTimeTracking: boolean;
}

export interface ExecutionPlan {
  id: string;
  name: string;
  description: string;
  jobs: ExecutionJob[];
  dependencyGraph?: DependencyGraph;
  executionStrategy: string;
  estimatedDuration: number;
  resourceRequirements: TotalResourceRequirements;
  status: ExecutionPlanStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  metadata: ExecutionPlanMetadata;
}

export interface ExecutionJob {
  id: string;
  originalRequest: JobRoutingRequest;
  executionStage: ExecutionStage;
  assignedRunner?: string;
  routingResult?: JobRoutingResult;
  loadBalancingResult?: LoadBalancingResult;
  schedulingResult?: SchedulingResult;
  status: JobExecutionStatus;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  retryCount: number;
  error?: ExecutionError;
  metadata: JobExecutionMetadata;
}

export interface TotalResourceRequirements {
  totalCpu: number;
  totalMemory: string;
  totalStorage: string;
  totalGpu?: number;
  peakConcurrency: number;
  estimatedDuration: number;
}

export interface ExecutionPlanMetadata {
  priority: number;
  tags: string[];
  owner: string;
  project: string;
  environment: string;
  constraints: ExecutionConstraints;
  preferences: ExecutionPreferences;
}

export interface ExecutionConstraints {
  maxExecutionTime: number;
  maxResourceUsage: Record<string, any>;
  allowedFailureRate: number;
  requiredSuccessRate: number;
  geographicRestrictions?: string[];
}

export interface ExecutionPreferences {
  preferredExecutionStrategy: string;
  preferredRegions: string[];
  optimizationTarget: OptimizationTarget;
  costBudget?: number;
}

export interface ExecutionError {
  type: ExecutionErrorType;
  message: string;
  details: Record<string, any>;
  timestamp: Date;
  retryable: boolean;
  severity: ErrorSeverity;
}

export interface JobExecutionMetadata {
  executionAttempts: ExecutionAttempt[];
  resourceUsage: ResourceUsageRecord[];
  performanceMetrics: PerformanceMetrics;
  diagnostics: ExecutionDiagnostics;
}

export interface ExecutionAttempt {
  attemptNumber: number;
  startTime: Date;
  endTime?: Date;
  status: AttemptStatus;
  runner: string;
  error?: string;
  resourceUsage: ResourceUsageSnapshot;
}

export interface ResourceUsageRecord {
  timestamp: Date;
  cpu: number;
  memory: number;
  storage: number;
  network: number;
  gpu?: number;
}

export interface PerformanceMetrics {
  queueTime: number;
  executionTime: number;
  totalTime: number;
  throughput: number;
  efficiency: number;
  reliability: number;
}

export interface ExecutionDiagnostics {
  warnings: string[];
  recommendations: string[];
  performanceIssues: string[];
  resourceBottlenecks: string[];
}

export interface ResourceUsageSnapshot {
  cpu: number;
  memory: number;
  storage: number;
  network: number;
  timestamp: Date;
}

export interface ParallelExecutionMetrics {
  totalExecutions: number;
  activeExecutions: number;
  queuedExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  averageQueueTime: number;
  throughput: number;
  successRate: number;
  resourceUtilization: ResourceUtilizationMetrics;
  performanceStats: PerformanceStats;
}

export interface ResourceUtilizationMetrics {
  cpu: UtilizationMetric;
  memory: UtilizationMetric;
  storage: UtilizationMetric;
  network: UtilizationMetric;
  gpu?: UtilizationMetric;
}

export interface UtilizationMetric {
  current: number;
  average: number;
  peak: number;
  target: number;
  efficiency: number;
}

export interface PerformanceStats {
  executionTimeDistribution: Record<string, number>;
  queueTimeDistribution: Record<string, number>;
  failureReasons: Record<string, number>;
  bottleneckAnalysis: BottleneckAnalysis;
}

export interface BottleneckAnalysis {
  primaryBottleneck: string;
  contributingFactors: string[];
  recommendations: string[];
  impactAssessment: Record<string, number>;
}

// Enums
export enum ConditionType {
  ResourceAvailability = 'resource_availability',
  QueueLength = 'queue_length',
  ExecutionTime = 'execution_time',
  FailureRate = 'failure_rate',
  Cost = 'cost',
  Priority = 'priority'
}

export enum ComparisonOperator {
  Equals = 'eq',
  NotEquals = 'ne',
  GreaterThan = 'gt',
  GreaterThanOrEqual = 'gte',
  LessThan = 'lt',
  LessThanOrEqual = 'lte',
  In = 'in',
  NotIn = 'not_in'
}

export enum ExecutionPlanStatus {
  Draft = 'draft',
  Validated = 'validated',
  Queued = 'queued',
  Executing = 'executing',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Paused = 'paused'
}

export enum ExecutionStage {
  Created = 'created',
  Routing = 'routing',
  LoadBalancing = 'load_balancing',
  Scheduling = 'scheduling',
  Executing = 'executing',
  Completed = 'completed',
  Failed = 'failed'
}

export enum JobExecutionStatus {
  Pending = 'pending',
  Routing = 'routing',
  Queued = 'queued',
  Scheduled = 'scheduled',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Retrying = 'retrying',
  Cancelled = 'cancelled'
}

export enum ExecutionErrorType {
  RoutingError = 'routing_error',
  SchedulingError = 'scheduling_error',
  ResourceError = 'resource_error',
  DependencyError = 'dependency_error',
  TimeoutError = 'timeout_error',
  SystemError = 'system_error'
}

export enum ErrorSeverity {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical'
}

export enum AttemptStatus {
  Started = 'started',
  Completed = 'completed',
  Failed = 'failed',
  Timeout = 'timeout',
  Cancelled = 'cancelled'
}

export enum OptimizationTarget {
  Speed = 'speed',
  Cost = 'cost',
  Reliability = 'reliability',
  ResourceEfficiency = 'resource_efficiency',
  Balanced = 'balanced'
}

export class ParallelExecutor extends EventEmitter {
  private static instance: ParallelExecutor;
  private config: ParallelExecutionConfig;
  private jobRouter: JobRouter;
  private loadBalancer: LoadBalancer;
  private resourceScheduler: ResourceScheduler;
  private dependencyManager: DependencyManager;
  
  private executionPlans: Map<string, ExecutionPlan> = new Map();
  private activeExecutions: Map<string, ExecutionJob> = new Map();
  private executionQueue: ExecutionJob[] = [];
  private executionHistory: ExecutionJob[] = [];
  
  private metrics: ParallelExecutionMetrics;
  private isRunning: boolean = false;
  private executionInterval?: NodeJS.Timeout;
  
  private constructor(config?: Partial<ParallelExecutionConfig>) {
    super();
    
    this.config = this.mergeWithDefaults(config);
    this.jobRouter = JobRouter.getInstance();
    this.loadBalancer = LoadBalancer.getInstance();
    this.resourceScheduler = ResourceScheduler.getInstance();
    this.dependencyManager = DependencyManager.getInstance();
    
    this.metrics = this.initializeMetrics();
    this.setupEventListeners();
    
    logger.info('ParallelExecutor initialized', {
      maxConcurrentJobs: this.config.maxConcurrentJobs,
      enableDependencyExecution: this.config.enableDependencyExecution
    });
  }
  
  public static getInstance(config?: Partial<ParallelExecutionConfig>): ParallelExecutor {
    if (!ParallelExecutor.instance) {
      ParallelExecutor.instance = new ParallelExecutor(config);
    }
    return ParallelExecutor.instance;
  }
  
  private mergeWithDefaults(config?: Partial<ParallelExecutionConfig>): ParallelExecutionConfig {
    return {
      maxConcurrentJobs: 100,
      maxQueuedJobs: 1000,
      jobTimeout: 3600000, // 1 hour
      enableDependencyExecution: true,
      enableResourceAwareScheduling: true,
      enableLoadBalancing: true,
      executionStrategies: [
        {
          name: 'balanced',
          priority: 1,
          conditions: [],
          configuration: {
            loadBalancingWeight: 0.4,
            resourceSchedulingWeight: 0.4,
            routingWeight: 0.2
          }
        },
        {
          name: 'speed_optimized',
          priority: 2,
          conditions: [
            {
              type: ConditionType.Priority,
              parameter: 'jobPriority',
              operator: ComparisonOperator.GreaterThanOrEqual,
              value: 8
            }
          ],
          configuration: {
            loadBalancingWeight: 0.6,
            resourceSchedulingWeight: 0.3,
            routingWeight: 0.1
          }
        }
      ],
      failureHandling: {
        retryEnabled: true,
        maxRetries: 3,
        retryDelay: 5000,
        retryBackoffMultiplier: 2,
        failFastEnabled: false,
        rollbackEnabled: true,
        notificationChannels: ['email', 'slack']
      },
      monitoring: {
        metricsEnabled: true,
        detailedLogging: true,
        performanceTracking: true,
        resourceUtilizationTracking: true,
        executionTimeTracking: true
      },
      ...config
    };
  }
  
  private initializeMetrics(): ParallelExecutionMetrics {
    return {
      totalExecutions: 0,
      activeExecutions: 0,
      queuedExecutions: 0,
      completedExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      averageQueueTime: 0,
      throughput: 0,
      successRate: 1.0,
      resourceUtilization: {
        cpu: { current: 0, average: 0, peak: 0, target: 0.8, efficiency: 0 },
        memory: { current: 0, average: 0, peak: 0, target: 0.8, efficiency: 0 },
        storage: { current: 0, average: 0, peak: 0, target: 0.8, efficiency: 0 },
        network: { current: 0, average: 0, peak: 0, target: 0.8, efficiency: 0 }
      },
      performanceStats: {
        executionTimeDistribution: {},
        queueTimeDistribution: {},
        failureReasons: {},
        bottleneckAnalysis: {
          primaryBottleneck: 'none',
          contributingFactors: [],
          recommendations: [],
          impactAssessment: {}
        }
      }
    };
  }
  
  private setupEventListeners(): void {
    // Listen to job router events
    this.jobRouter.on('job_routed', this.handleJobRouted.bind(this));
    this.jobRouter.on('routing_failed', this.handleRoutingFailed.bind(this));
    
    // Listen to load balancer events
    this.loadBalancer.on('job_queued', this.handleJobQueued.bind(this));
    this.loadBalancer.on('job_processing', this.handleJobProcessing.bind(this));
    this.loadBalancer.on('job_completed', this.handleJobCompleted.bind(this));
    this.loadBalancer.on('job_failed', this.handleJobFailed.bind(this));
    
    // Listen to resource scheduler events
    this.resourceScheduler.on('job_scheduled', this.handleJobScheduled.bind(this));
    this.resourceScheduler.on('scheduling_failed', this.handleSchedulingFailed.bind(this));
    
    // Listen to dependency manager events
    this.dependencyManager.on('dependency_resolved', this.handleDependencyResolved.bind(this));
    this.dependencyManager.on('dependency_failed', this.handleDependencyFailed.bind(this));
  }
  
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('ParallelExecutor is already running');
      return;
    }
    
    this.isRunning = true;
    this.executionInterval = setInterval(
      () => this.processExecutionQueue(),
      1000 // Process queue every second
    );
    
    logger.info('ParallelExecutor started');
    this.emit('executor_started');
  }
  
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('ParallelExecutor is not running');
      return;
    }
    
    this.isRunning = false;
    
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = undefined;
    }
    
    // Wait for active executions to complete or timeout
    await this.waitForActiveExecutions();
    
    logger.info('ParallelExecutor stopped');
    this.emit('executor_stopped');
  }
  
  public async submitJobBatch(
    jobs: JobRoutingRequest[],
    options?: {
      planName?: string;
      planDescription?: string;
      executionStrategy?: string;
      enableDependencies?: boolean;
    }
  ): Promise<string> {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Create execution plan
      const executionPlan = await this.createExecutionPlan(planId, jobs, options);
      this.executionPlans.set(planId, executionPlan);
      
      // Process dependencies if enabled
      if (this.config.enableDependencyExecution && options?.enableDependencies) {
        const dependencyGraph = await this.dependencyManager.createDependencyGraph(
          `graph_${planId}`,
          jobs
        );
        executionPlan.dependencyGraph = dependencyGraph;
      }
      
      // Add jobs to execution queue
      for (const job of executionPlan.jobs) {
        this.executionQueue.push(job);
      }
      
      this.updateMetrics();
      
      logger.info('Job batch submitted', {
        planId,
        jobCount: jobs.length,
        strategy: options?.executionStrategy
      });
      
      this.emit('batch_submitted', { planId, jobCount: jobs.length });
      
      return planId;
      
    } catch (error) {
      logger.error('Failed to submit job batch', { error, planId });
      throw error;
    }
  }
  
  public async submitSingleJob(job: JobRoutingRequest): Promise<string> {
    return this.submitJobBatch([job], {
      planName: `single_job_${job.jobId}`,
      planDescription: `Single job execution for ${job.jobId}`
    });
  }
  
  private async createExecutionPlan(
    planId: string,
    jobs: JobRoutingRequest[],
    options?: any
  ): Promise<ExecutionPlan> {
    const executionJobs: ExecutionJob[] = jobs.map(job => ({
      id: `exec_${job.jobId}`,
      originalRequest: job,
      executionStage: ExecutionStage.Created,
      status: JobExecutionStatus.Pending,
      retryCount: 0,
      metadata: {
        executionAttempts: [],
        resourceUsage: [],
        performanceMetrics: {
          queueTime: 0,
          executionTime: 0,
          totalTime: 0,
          throughput: 0,
          efficiency: 0,
          reliability: 0
        },
        diagnostics: {
          warnings: [],
          recommendations: [],
          performanceIssues: [],
          resourceBottlenecks: []
        }
      }
    }));
    
    const totalResourceRequirements = this.calculateTotalResourceRequirements(jobs);
    const estimatedDuration = this.estimateExecutionDuration(jobs);
    
    return {
      id: planId,
      name: options?.planName || `Execution Plan ${planId}`,
      description: options?.planDescription || `Parallel execution of ${jobs.length} jobs`,
      jobs: executionJobs,
      executionStrategy: options?.executionStrategy || 'balanced',
      estimatedDuration,
      resourceRequirements: totalResourceRequirements,
      status: ExecutionPlanStatus.Queued,
      createdAt: new Date(),
      metadata: {
        priority: Math.max(...jobs.map(j => j.priority)),
        tags: [...new Set(jobs.flatMap(j => j.metadata.tags))],
        owner: 'system',
        project: jobs[0]?.repository || 'unknown',
        environment: 'production',
        constraints: {
          maxExecutionTime: this.config.jobTimeout,
          maxResourceUsage: {},
          allowedFailureRate: 0.1,
          requiredSuccessRate: 0.9
        },
        preferences: {
          preferredExecutionStrategy: options?.executionStrategy || 'balanced',
          preferredRegions: [],
          optimizationTarget: OptimizationTarget.Balanced
        }
      }
    };
  }
  
  private calculateTotalResourceRequirements(jobs: JobRoutingRequest[]): TotalResourceRequirements {
    const totalCpu = jobs.reduce((sum, job) => sum + job.resourceRequirements.cpu.preferred, 0);
    const totalMemoryMB = jobs.reduce((sum, job) => {
      const memoryValue = parseFloat(job.resourceRequirements.memory.preferred.replace(/[^\d.]/g, ''));
      const unit = job.resourceRequirements.memory.preferred.replace(/[0-9.]/g, '').toUpperCase();
      const multiplier = unit.includes('GB') ? 1024 : (unit.includes('TB') ? 1024 * 1024 : 1);
      return sum + (memoryValue * multiplier);
    }, 0);
    
    return {
      totalCpu,
      totalMemory: `${Math.ceil(totalMemoryMB / 1024)}GB`,
      totalStorage: '100GB', // Default estimate
      peakConcurrency: Math.min(jobs.length, this.config.maxConcurrentJobs),
      estimatedDuration: this.estimateExecutionDuration(jobs)
    };
  }
  
  private estimateExecutionDuration(jobs: JobRoutingRequest[]): number {
    const totalDuration = jobs.reduce((sum, job) => sum + job.metadata.estimatedDuration, 0);
    const maxConcurrency = Math.min(jobs.length, this.config.maxConcurrentJobs);
    return Math.ceil(totalDuration / maxConcurrency);
  }
  
  private async processExecutionQueue(): Promise<void> {
    if (!this.isRunning || this.executionQueue.length === 0) {
      return;
    }
    
    const availableSlots = this.config.maxConcurrentJobs - this.activeExecutions.size;
    if (availableSlots <= 0) {
      return;
    }
    
    const jobsToProcess = this.executionQueue.splice(0, availableSlots);
    
    for (const job of jobsToProcess) {
      await this.executeJob(job);
    }
  }
  
  private async executeJob(job: ExecutionJob): Promise<void> {
    try {
      job.status = JobExecutionStatus.Running;
      job.startTime = new Date();
      this.activeExecutions.set(job.id, job);
      
      const attempt: ExecutionAttempt = {
        attemptNumber: job.retryCount + 1,
        startTime: new Date(),
        status: AttemptStatus.Started,
        runner: 'unknown',
        resourceUsage: {
          cpu: 0,
          memory: 0,
          storage: 0,
          network: 0,
          timestamp: new Date()
        }
      };
      job.metadata.executionAttempts.push(attempt);
      
      this.emit('job_execution_started', { jobId: job.id, job });
      
      // Step 1: Route the job
      job.executionStage = ExecutionStage.Routing;
      job.routingResult = await this.jobRouter.routeJob(job.originalRequest);
      
      if (!job.routingResult.success) {
        throw new Error(`Job routing failed: ${job.routingResult.reason}`);
      }
      
      // Step 2: Load balance if enabled
      if (this.config.enableLoadBalancing) {
        job.executionStage = ExecutionStage.LoadBalancing;
        job.loadBalancingResult = await this.loadBalancer.submitJob(job.originalRequest);
        
        if (!job.loadBalancingResult.success) {
          throw new Error(`Load balancing failed: ${job.loadBalancingResult.error}`);
        }
      }
      
      // Step 3: Schedule resources if enabled
      if (this.config.enableResourceAwareScheduling) {
        job.executionStage = ExecutionStage.Scheduling;
        const schedulingRequest: SchedulingRequest = {
          job: job.originalRequest,
          constraints: job.originalRequest.metadata.constraints,
          preferences: job.originalRequest.metadata.preferences,
          estimatedDuration: job.originalRequest.metadata.estimatedDuration,
          resourceRequirements: job.originalRequest.resourceRequirements,
          deadline: job.originalRequest.metadata.constraints.timeConstraints?.deadline
        };
        
        job.schedulingResult = await this.resourceScheduler.scheduleJob(schedulingRequest);
        
        if (!job.schedulingResult.success) {
          throw new Error(`Resource scheduling failed: ${job.schedulingResult.reason}`);
        }
      }
      
      // Step 4: Execute the job
      job.executionStage = ExecutionStage.Executing;
      attempt.runner = job.routingResult.assignedRunner?.runnerId || 'unknown';
      
      // Simulate job execution (in real implementation, this would trigger actual job execution)
      await this.simulateJobExecution(job);
      
      // Step 5: Complete the job
      job.status = JobExecutionStatus.Completed;
      job.executionStage = ExecutionStage.Completed;
      job.endTime = new Date();
      job.duration = job.endTime.getTime() - job.startTime!.getTime();
      
      attempt.endTime = new Date();
      attempt.status = AttemptStatus.Completed;
      
      this.completeJobExecution(job);
      
    } catch (error) {
      await this.handleJobExecutionError(job, error as Error);
    }
  }
  
  private async simulateJobExecution(job: ExecutionJob): Promise<void> {
    // Simulate execution time based on job metadata
    const executionTime = job.originalRequest.metadata.estimatedDuration * 1000;
    const simulatedTime = Math.min(executionTime, 5000); // Cap simulation at 5 seconds
    
    return new Promise(resolve => {
      setTimeout(() => {
        // Simulate resource usage tracking
        job.metadata.resourceUsage.push({
          timestamp: new Date(),
          cpu: Math.random() * 100,
          memory: Math.random() * 100,
          storage: Math.random() * 100,
          network: Math.random() * 100
        });
        
        resolve();
      }, simulatedTime);
    });
  }
  
  private completeJobExecution(job: ExecutionJob): void {
    this.activeExecutions.delete(job.id);
    this.executionHistory.push(job);
    
    // Update job performance metrics
    job.metadata.performanceMetrics = {
      queueTime: job.startTime!.getTime() - new Date(job.originalRequest.metadata.estimatedDuration).getTime(),
      executionTime: job.duration || 0,
      totalTime: (job.endTime?.getTime() || 0) - (job.startTime?.getTime() || 0),
      throughput: 1 / ((job.duration || 1) / 1000),
      efficiency: 0.9, // Simulated efficiency
      reliability: 1.0 // Successful completion
    };
    
    this.updateMetrics();
    
    logger.info('Job execution completed', {
      jobId: job.id,
      duration: job.duration,
      stage: job.executionStage
    });
    
    this.emit('job_execution_completed', { jobId: job.id, job });
    
    // Check if execution plan is complete
    this.checkExecutionPlanCompletion(job);
  }
  
  private async handleJobExecutionError(job: ExecutionJob, error: Error): Promise<void> {
    job.error = {
      type: this.determineErrorType(error),
      message: error.message,
      details: { stack: error.stack },
      timestamp: new Date(),
      retryable: this.isRetryableError(error),
      severity: ErrorSeverity.Medium
    };
    
    const lastAttempt = job.metadata.executionAttempts[job.metadata.executionAttempts.length - 1];
    if (lastAttempt) {
      lastAttempt.endTime = new Date();
      lastAttempt.status = AttemptStatus.Failed;
      lastAttempt.error = error.message;
    }
    
    // Determine if we should retry
    if (this.shouldRetryJob(job)) {
      job.retryCount++;
      job.status = JobExecutionStatus.Retrying;
      
      // Add back to queue with delay
      setTimeout(() => {
        this.executionQueue.unshift(job);
      }, this.calculateRetryDelay(job.retryCount));
      
      logger.warn('Job execution failed, retrying', {
        jobId: job.id,
        retryCount: job.retryCount,
        error: error.message
      });
      
      this.emit('job_execution_retry', { jobId: job.id, job, error });
      
    } else {
      job.status = JobExecutionStatus.Failed;
      job.endTime = new Date();
      this.activeExecutions.delete(job.id);
      this.executionHistory.push(job);
      
      logger.error('Job execution failed permanently', {
        jobId: job.id,
        retryCount: job.retryCount,
        error: error.message
      });
      
      this.emit('job_execution_failed', { jobId: job.id, job, error });
      this.checkExecutionPlanCompletion(job);
    }
    
    this.updateMetrics();
  }
  
  private determineErrorType(error: Error): ExecutionErrorType {
    if (error.message.includes('routing')) return ExecutionErrorType.RoutingError;
    if (error.message.includes('scheduling')) return ExecutionErrorType.SchedulingError;
    if (error.message.includes('resource')) return ExecutionErrorType.ResourceError;
    if (error.message.includes('dependency')) return ExecutionErrorType.DependencyError;
    if (error.message.includes('timeout')) return ExecutionErrorType.TimeoutError;
    return ExecutionErrorType.SystemError;
  }
  
  private isRetryableError(error: Error): boolean {
    const nonRetryableErrors = ['validation', 'authentication', 'authorization'];
    return !nonRetryableErrors.some(keyword => error.message.toLowerCase().includes(keyword));
  }
  
  private shouldRetryJob(job: ExecutionJob): boolean {
    return (
      this.config.failureHandling.retryEnabled &&
      job.retryCount < this.config.failureHandling.maxRetries &&
      job.error?.retryable === true
    );
  }
  
  private calculateRetryDelay(retryCount: number): number {
    const baseDelay = this.config.failureHandling.retryDelay;
    const multiplier = this.config.failureHandling.retryBackoffMultiplier;
    return baseDelay * Math.pow(multiplier, retryCount - 1);
  }
  
  private checkExecutionPlanCompletion(job: ExecutionJob): void {
    // Find the execution plan for this job
    for (const [planId, plan] of this.executionPlans.entries()) {
      const planJob = plan.jobs.find(j => j.id === job.id);
      if (planJob) {
        // Update the job in the plan
        Object.assign(planJob, job);
        
        // Check if all jobs in the plan are complete
        const allJobsComplete = plan.jobs.every(j => 
          j.status === JobExecutionStatus.Completed || 
          j.status === JobExecutionStatus.Failed
        );
        
        if (allJobsComplete) {
          plan.status = plan.jobs.every(j => j.status === JobExecutionStatus.Completed)
            ? ExecutionPlanStatus.Completed
            : ExecutionPlanStatus.Failed;
          plan.completedAt = new Date();
          
          logger.info('Execution plan completed', {
            planId,
            status: plan.status,
            totalJobs: plan.jobs.length,
            successfulJobs: plan.jobs.filter(j => j.status === JobExecutionStatus.Completed).length
          });
          
          this.emit('execution_plan_completed', { planId, plan });
        }
        break;
      }
    }
  }
  
  private async waitForActiveExecutions(): Promise<void> {
    const timeout = 30000; // 30 seconds timeout
    const startTime = Date.now();
    
    while (this.activeExecutions.size > 0 && (Date.now() - startTime) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (this.activeExecutions.size > 0) {
      logger.warn('Forcing shutdown with active executions', {
        activeCount: this.activeExecutions.size
      });
      
      // Cancel remaining active executions
      for (const job of this.activeExecutions.values()) {
        job.status = JobExecutionStatus.Cancelled;
        job.endTime = new Date();
        this.emit('job_execution_cancelled', { jobId: job.id, job });
      }
      
      this.activeExecutions.clear();
    }
  }
  
  private updateMetrics(): void {
    this.metrics.activeExecutions = this.activeExecutions.size;
    this.metrics.queuedExecutions = this.executionQueue.length;
    this.metrics.totalExecutions = this.executionHistory.length + this.activeExecutions.size;
    this.metrics.completedExecutions = this.executionHistory.filter(
      job => job.status === JobExecutionStatus.Completed
    ).length;
    this.metrics.failedExecutions = this.executionHistory.filter(
      job => job.status === JobExecutionStatus.Failed
    ).length;
    
    if (this.executionHistory.length > 0) {
      const completedJobs = this.executionHistory.filter(
        job => job.status === JobExecutionStatus.Completed
      );
      
      if (completedJobs.length > 0) {
        this.metrics.averageExecutionTime = completedJobs.reduce(
          (sum, job) => sum + (job.duration || 0), 0
        ) / completedJobs.length;
        
        this.metrics.successRate = completedJobs.length / this.executionHistory.length;
      }
    }
    
    this.emit('metrics_updated', this.metrics);
  }
  
  // Event handlers for component events
  private handleJobRouted(data: any): void {
    logger.debug('Job routed', data);
  }
  
  private handleRoutingFailed(data: any): void {
    logger.error('Job routing failed', data);
  }
  
  private handleJobQueued(data: any): void {
    logger.debug('Job queued in load balancer', data);
  }
  
  private handleJobProcessing(data: any): void {
    logger.debug('Job processing started', data);
  }
  
  private handleJobCompleted(data: any): void {
    logger.debug('Job completed in load balancer', data);
  }
  
  private handleJobFailed(data: any): void {
    logger.error('Job failed in load balancer', data);
  }
  
  private handleJobScheduled(data: any): void {
    logger.debug('Job scheduled', data);
  }
  
  private handleSchedulingFailed(data: any): void {
    logger.error('Job scheduling failed', data);
  }
  
  private handleDependencyResolved(data: any): void {
    logger.debug('Job dependency resolved', data);
  }
  
  private handleDependencyFailed(data: any): void {
    logger.error('Job dependency failed', data);
  }
  
  // Public API methods
  public getExecutionPlan(planId: string): ExecutionPlan | undefined {
    return this.executionPlans.get(planId);
  }
  
  public getExecutionPlans(): ExecutionPlan[] {
    return Array.from(this.executionPlans.values());
  }
  
  public getActiveExecutions(): ExecutionJob[] {
    return Array.from(this.activeExecutions.values());
  }
  
  public getExecutionHistory(): ExecutionJob[] {
    return [...this.executionHistory];
  }
  
  public getMetrics(): ParallelExecutionMetrics {
    return { ...this.metrics };
  }
  
  public getConfiguration(): ParallelExecutionConfig {
    return { ...this.config };
  }
  
  public async cancelExecution(planId: string): Promise<boolean> {
    const plan = this.executionPlans.get(planId);
    if (!plan) {
      return false;
    }
    
    plan.status = ExecutionPlanStatus.Cancelled;
    
    // Cancel queued jobs
    this.executionQueue = this.executionQueue.filter(job => {
      const shouldCancel = plan.jobs.some(planJob => planJob.id === job.id);
      if (shouldCancel) {
        job.status = JobExecutionStatus.Cancelled;
        this.emit('job_execution_cancelled', { jobId: job.id, job });
      }
      return !shouldCancel;
    });
    
    // Cancel active jobs
    for (const job of this.activeExecutions.values()) {
      if (plan.jobs.some(planJob => planJob.id === job.id)) {
        job.status = JobExecutionStatus.Cancelled;
        job.endTime = new Date();
        this.activeExecutions.delete(job.id);
        this.emit('job_execution_cancelled', { jobId: job.id, job });
      }
    }
    
    this.updateMetrics();
    this.emit('execution_plan_cancelled', { planId, plan });
    
    return true;
  }
  
  public async pauseExecution(planId: string): Promise<boolean> {
    const plan = this.executionPlans.get(planId);
    if (!plan || plan.status !== ExecutionPlanStatus.Executing) {
      return false;
    }
    
    plan.status = ExecutionPlanStatus.Paused;
    this.emit('execution_plan_paused', { planId, plan });
    
    return true;
  }
  
  public async resumeExecution(planId: string): Promise<boolean> {
    const plan = this.executionPlans.get(planId);
    if (!plan || plan.status !== ExecutionPlanStatus.Paused) {
      return false;
    }
    
    plan.status = ExecutionPlanStatus.Executing;
    this.emit('execution_plan_resumed', { planId, plan });
    
    return true;
  }
}