import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { QueueManager } from '../queues/queue-manager';
import { JobRouter } from '../queues/job-router';
import { JobType, QUEUE_CONFIG } from '../queues/config/redis-config';
import _database from '../services/database';
import { DatabaseService } from '../services/database';
import { GitHubAPIService } from '../services/github-api';
import { ContainerPoolManager } from '../container-orchestration/pool/integrated-pool-orchestrator';
import _monitoringService from '../services/monitoring';
import { MonitoringService } from '../services/monitoring';
import { StatusReporter, JobConclusion } from './status-reporter';

const logger = createLogger('RunnerOrchestrator');

export interface OrchestratorConfig {
  maxConcurrentJobs: number;
  containerPoolSize: number;
  healthCheckInterval: number;
  metricsInterval: number;
  webhookSecret: string;
  gitHubToken: string;
  gitHubOrg: string;
}

export interface JobRequest {
  id: string;
  repository: string;
  workflow: string;
  jobName: string;
  runId: number;
  runNumber: number;
  sha: string;
  ref: string;
  environment: Record<string, string>;
  labels: string[];
  matrix?: any;
  steps: any[];
  needs?: string[];
  services?: Record<string, any>;
  container?: any;
}

export interface ContainerAssignment {
  jobId: string;
  containerId: string;
  containerName: string;
  assignedAt: Date;
  estimatedDuration: number;
  priority: number;
}

export enum OrchestratorStatus {
  INITIALIZING = 'initializing',
  READY = 'ready',
  PROCESSING = 'processing',
  SCALING = 'scaling',
  DRAINING = 'draining',
  STOPPED = 'stopped',
  ERROR = 'error'
}

export class RunnerOrchestrator extends EventEmitter {
  private static instance: RunnerOrchestrator;
  private config: OrchestratorConfig;
  private status: OrchestratorStatus = OrchestratorStatus.INITIALIZING;
  private queueManager: QueueManager;
  private jobRouter: JobRouter;
  private databaseService: DatabaseService;
  private githubService: GitHubAPIService;
  private containerPool: ContainerPoolManager;
  private metricsCollector: MonitoringService;
  private statusReporter: StatusReporter;
  
  private activeJobs: Map<string, ContainerAssignment> = new Map();
  private pendingJobs: Map<string, JobRequest> = new Map();
  private containerUtilization: Map<string, number> = new Map();
  
  private healthCheckInterval?: NodeJS.Timer;
  private metricsInterval?: NodeJS.Timer;
  private isShuttingDown = false;

  private constructor(config: OrchestratorConfig) {
    super();
    this.config = config;
    this.queueManager = QueueManager.getInstance();
    this.jobRouter = JobRouter.getInstance();
    this.databaseService = DatabaseService.getInstance();
    this.githubService = new GitHubAPIService();
    this.containerPool = ContainerPoolManager.getInstance();
    this.metricsCollector = MonitoringService.getInstance();
    this.statusReporter = StatusReporter.getInstance();
  }

  public static getInstance(config?: OrchestratorConfig): RunnerOrchestrator {
    if (!RunnerOrchestrator.instance) {
      if (!config) {
        throw new Error('Configuration required for first initialization');
      }
      RunnerOrchestrator.instance = new RunnerOrchestrator(config);
    }
    return RunnerOrchestrator.instance;
  }

  public async initialize(): Promise<void> {
    try {
      logger.info('Initializing Runner Orchestrator...');
      
      // Initialize container pool
      await this.containerPool.initialize({
        minContainers: 5,
        maxContainers: this.config.containerPoolSize,
        targetUtilization: 0.8,
        scaleUpThreshold: 0.9,
        scaleDownThreshold: 0.3
      });
      
      // Initialize status reporter
      await this.statusReporter.initialize();
      
      // Setup webhook handlers
      await this.setupWebhookHandlers();
      
      // Start health checks
      this.startHealthChecks();
      
      // Start metrics collection
      this.startMetricsCollection();
      
      // Recover any interrupted jobs
      await this.recoverInterruptedJobs();
      
      this.status = OrchestratorStatus.READY;
      logger.info('Runner Orchestrator initialized successfully');
      
      this.emit('initialized');
    } catch (error) {
      logger.error('Failed to initialize orchestrator:', error);
      this.status = OrchestratorStatus.ERROR;
      throw error;
    }
  }

  private async setupWebhookHandlers(): Promise<void> {
    // This will be called by webhook routes to process GitHub events
    logger.info('Setting up webhook handlers for orchestrator');
  }

  public async handleWorkflowJobEvent(event: any): Promise<void> {
    const { action, workflow_job, repository } = event;
    
    logger.info(`Handling workflow job event: ${action}`, {
      jobId: workflow_job.id,
      repository: repository.full_name,
      jobName: workflow_job.name
    });
    
    switch (action) {
      case 'queued':
        await this.handleJobQueued(workflow_job, repository);
        break;
        
      case 'in_progress':
        await this.handleJobInProgress(workflow_job);
        break;
        
      case 'completed':
        await this.handleJobCompleted(workflow_job);
        break;
        
      default:
        logger.debug(`Unhandled workflow job action: ${action}`);
    }
  }

  private async handleJobQueued(workflowJob: any, repository: any): Promise<void> {
    const jobRequest: JobRequest = {
      id: workflowJob.id.toString(),
      repository: repository.full_name,
      workflow: workflowJob.workflow_name,
      jobName: workflowJob.name,
      runId: workflowJob.run_id,
      runNumber: workflowJob.run_attempt,
      sha: workflowJob.head_sha,
      ref: workflowJob.head_ref || workflowJob.head_branch,
      environment: {},
      labels: workflowJob.labels,
      steps: workflowJob.steps || [],
      services: workflowJob.services,
      container: workflowJob.container
    };
    
    // Validate job
    if (!this.validateJob(jobRequest)) {
      logger.error('Invalid job request:', jobRequest);
      await this.reportJobFailure(jobRequest.id, 'Invalid job configuration');
      return;
    }
    
    // Add to pending jobs
    this.pendingJobs.set(jobRequest.id, jobRequest);
    
    // Report job as queued to GitHub
    await this.statusReporter.reportJobStatus({
      id: jobRequest.id,
      repository: jobRequest.repository,
      sha: jobRequest.sha,
      runId: jobRequest.runId,
      name: jobRequest.jobName,
      status: 'queued' as any,
      output: {
        title: `${jobRequest.jobName} - Queued`,
        summary: 'Job has been queued for execution'
      }
    });
    
    // Queue job for processing
    await this.jobRouter.route({
      type: JobType.EXECUTE_WORKFLOW,
      data: {
        jobRequest,
        orchestratorId: this.getOrchestratorId()
      },
      priority: this.calculateJobPriority(jobRequest)
    });
    
    logger.info(`Job ${jobRequest.id} queued for processing`);
    this.emit('job:queued', jobRequest);
  }

  private validateJob(jobRequest: JobRequest): boolean {
    // Validate required fields
    if (!jobRequest.id || !jobRequest.repository || !jobRequest.workflow) {
      return false;
    }
    
    // Validate labels match our capabilities
    const supportedLabels = ['self-hosted', 'linux', 'x64', 'docker'];
    const hasValidLabels = jobRequest.labels.some(label => 
      supportedLabels.includes(label.toLowerCase())
    );
    
    if (!hasValidLabels) {
      logger.warn('Job has unsupported labels:', jobRequest.labels);
      return false;
    }
    
    // Additional validation logic
    if (jobRequest.container && !this.isContainerSupported(jobRequest.container)) {
      logger.warn('Unsupported container configuration:', jobRequest.container);
      return false;
    }
    
    return true;
  }

  private isContainerSupported(container: any): boolean {
    // Check if we support the requested container image
    if (typeof container === 'string') {
      return true; // Simple image reference
    }
    
    if (container.image) {
      // Check if image is in allowed list or pattern
      const allowedPatterns = [
        /^node:/,
        /^python:/,
        /^ubuntu:/,
        /^debian:/,
        /^alpine:/,
        /^golang:/,
        /^rust:/
      ];
      
      return allowedPatterns.some(pattern => pattern.test(container.image));
    }
    
    return false;
  }

  private calculateJobPriority(jobRequest: JobRequest): number {
    // Priority based on workflow type and labels
    if (jobRequest.workflow.toLowerCase().includes('deploy') || 
        jobRequest.workflow.toLowerCase().includes('release')) {
      return QUEUE_CONFIG.priorities.CRITICAL;
    }
    
    if (jobRequest.labels.includes('urgent') || 
        jobRequest.labels.includes('high-priority')) {
      return QUEUE_CONFIG.priorities.HIGH;
    }
    
    if (jobRequest.workflow.toLowerCase().includes('test') || 
        jobRequest.workflow.toLowerCase().includes('build')) {
      return QUEUE_CONFIG.priorities.NORMAL;
    }
    
    return QUEUE_CONFIG.priorities.LOW;
  }

  public async assignContainer(jobId: string): Promise<ContainerAssignment | null> {
    const jobRequest = this.pendingJobs.get(jobId);
    if (!jobRequest) {
      logger.error(`Job ${jobId} not found in pending jobs`);
      return null;
    }
    
    try {
      // Get available container from pool
      const container = await this.containerPool.acquireContainer({
        labels: jobRequest.labels,
        image: jobRequest.container?.image || 'ubuntu:latest',
        resources: this.estimateResourceRequirements(jobRequest)
      });
      
      if (!container) {
        logger.warn(`No available container for job ${jobId}`);
        return null;
      }
      
      const assignment: ContainerAssignment = {
        jobId,
        containerId: container.id,
        containerName: container.name,
        assignedAt: new Date(),
        estimatedDuration: this.estimateJobDuration(jobRequest),
        priority: this.calculateJobPriority(jobRequest)
      };
      
      // Update tracking
      this.activeJobs.set(jobId, assignment);
      this.pendingJobs.delete(jobId);
      this.containerUtilization.set(container.id, 1.0);
      
      // Store assignment in database
      await this.databaseService.createContainerAssignment(assignment);
      
      logger.info(`Assigned container ${container.id} to job ${jobId}`);
      this.emit('container:assigned', assignment);
      
      return assignment;
    } catch (error) {
      logger.error(`Failed to assign container for job ${jobId}:`, error);
      await this.reportJobFailure(jobId, 'Container assignment failed');
      return null;
    }
  }

  private estimateResourceRequirements(jobRequest: JobRequest): any {
    // Estimate based on job type and history
    const baseRequirements = {
      cpu: 1,
      memory: '2Gi',
      disk: '10Gi'
    };
    
    // Adjust based on job characteristics
    if (jobRequest.labels.includes('large-runner')) {
      baseRequirements.cpu = 4;
      baseRequirements.memory = '8Gi';
      baseRequirements.disk = '50Gi';
    } else if (jobRequest.labels.includes('xlarge-runner')) {
      baseRequirements.cpu = 8;
      baseRequirements.memory = '16Gi';
      baseRequirements.disk = '100Gi';
    }
    
    // Check for specific resource requests in job
    if (jobRequest.container?.resources) {
      Object.assign(baseRequirements, jobRequest.container.resources);
    }
    
    return baseRequirements;
  }

  private estimateJobDuration(jobRequest: JobRequest): number {
    // Estimate based on historical data and job type
    const workflowType = jobRequest.workflow.toLowerCase();
    
    if (workflowType.includes('deploy')) {
      return 10 * 60 * 1000; // 10 minutes
    } else if (workflowType.includes('test')) {
      return 15 * 60 * 1000; // 15 minutes
    } else if (workflowType.includes('build')) {
      return 20 * 60 * 1000; // 20 minutes
    }
    
    // Default estimate
    return 30 * 60 * 1000; // 30 minutes
  }

  private async handleJobInProgress(workflowJob: any): Promise<void> {
    const jobId = workflowJob.id.toString();
    const assignment = this.activeJobs.get(jobId);
    
    if (!assignment) {
      logger.warn(`Job ${jobId} started but no container assignment found`);
      return;
    }
    
    // Update job status
    await this.databaseService.updateJobStatus(jobId, {
      status: 'in_progress',
      startedAt: new Date(),
      containerId: assignment.containerId
    });
    
    // Report to GitHub that job is in progress
    const jobRequest = await this.getJobFromPending(jobId);
    if (jobRequest) {
      await this.statusReporter.reportJobStarted(
        jobId,
        jobRequest.repository,
        jobRequest.sha,
        jobRequest.jobName,
        jobRequest.runId
      );
    }
    
    logger.info(`Job ${jobId} is now in progress on container ${assignment.containerId}`);
    this.emit('job:started', { jobId, containerId: assignment.containerId });
  }

  private async handleJobCompleted(workflowJob: any): Promise<void> {
    const jobId = workflowJob.id.toString();
    const assignment = this.activeJobs.get(jobId);
    
    if (!assignment) {
      logger.warn(`Job ${jobId} completed but no container assignment found`);
      return;
    }
    
    try {
      // Release container back to pool
      await this.containerPool.releaseContainer(assignment.containerId);
      
      // Update tracking
      this.activeJobs.delete(jobId);
      this.containerUtilization.delete(assignment.containerId);
      
      // Update database
      await this.databaseService.updateJobStatus(jobId, {
        status: 'completed',
        conclusion: workflowJob.conclusion,
        completedAt: new Date()
      });
      
      // Calculate actual duration for future estimates
      const duration = new Date().getTime() - assignment.assignedAt.getTime();
      await this.updateJobDurationEstimates(workflowJob.workflow_name, duration);
      
      // Report completion to GitHub
      const jobRequest = await this.getJobFromDatabase(jobId);
      if (jobRequest) {
        const conclusion = this.mapGitHubConclusionToInternal(workflowJob.conclusion);
        await this.statusReporter.reportJobCompleted(
          jobId,
          jobRequest.repository,
          jobRequest.sha,
          jobRequest.jobName,
          jobRequest.runId,
          conclusion,
          {
            title: `${jobRequest.jobName} - ${this.formatConclusion(conclusion)}`,
            summary: `Job completed with conclusion: ${workflowJob.conclusion}\nDuration: ${this.formatDuration(duration)}`
          }
        );
      }
      
      logger.info(`Job ${jobId} completed with conclusion: ${workflowJob.conclusion}`);
      this.emit('job:completed', { jobId, conclusion: workflowJob.conclusion });
    } catch (error) {
      logger.error(`Error handling job completion for ${jobId}:`, error);
    }
  }

  public async reportJobStatus(jobId: string, status: string, details?: any): Promise<void> {
    try {
      const jobRequest = this.pendingJobs.get(jobId) || 
                        await this.getJobFromActive(jobId);
      
      if (!jobRequest) {
        logger.error(`Cannot report status for unknown job ${jobId}`);
        return;
      }
      
      // Report to GitHub
      await this.githubService.updateCheckRun(
        jobRequest.repository,
        jobRequest.sha,
        {
          name: jobRequest.jobName,
          status: status === 'in_progress' ? 'in_progress' : 'completed',
          conclusion: status === 'completed' ? details?.conclusion : undefined,
          output: details?.output
        }
      );
      
      // Update internal tracking
      await this.databaseService.updateJobStatus(jobId, {
        status,
        ...details
      });
      
      logger.info(`Reported job ${jobId} status: ${status}`);
    } catch (error) {
      logger.error(`Failed to report job status for ${jobId}:`, error);
    }
  }

  private async reportJobFailure(jobId: string, reason: string): Promise<void> {
    const jobRequest = this.pendingJobs.get(jobId) || await this.getJobFromDatabase(jobId);
    if (jobRequest) {
      await this.statusReporter.reportJobCompleted(
        jobId,
        jobRequest.repository,
        jobRequest.sha,
        jobRequest.jobName,
        jobRequest.runId,
        JobConclusion.FAILURE,
        {
          title: 'Job Failed',
          summary: reason
        }
      );
    }
  }

  private async getJobFromActive(jobId: string): Promise<JobRequest | null> {
    const assignment = this.activeJobs.get(jobId);
    if (!assignment) return null;
    
    // Retrieve from database if needed
    const jobData = await this.databaseService.getJob(jobId);
    return jobData ? jobData.request : null;
  }

  private async updateJobDurationEstimates(workflow: string, actualDuration: number): Promise<void> {
    // Update ML model or statistics for better future estimates
    await this.metricsCollector.recordJobDuration(workflow, actualDuration);
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Health check failed:', error);
      }
    }, this.config.healthCheckInterval);
  }

  private async performHealthCheck(): Promise<void> {
    const health = {
      status: this.status,
      activeJobs: this.activeJobs.size,
      pendingJobs: this.pendingJobs.size,
      containerUtilization: this.calculateAverageUtilization(),
      timestamp: new Date()
    };
    
    // Check if we need to scale
    if (health.pendingJobs > 5 && health.containerUtilization > 0.8) {
      this.emit('scaling:needed', { direction: 'up', reason: 'high load' });
    } else if (health.activeJobs < 2 && health.containerUtilization < 0.3) {
      this.emit('scaling:needed', { direction: 'down', reason: 'low load' });
    }
    
    // Report health metrics
    await this.metricsCollector.recordOrchestratorHealth(health);
  }

  private calculateAverageUtilization(): number {
    if (this.containerUtilization.size === 0) return 0;
    
    const sum = Array.from(this.containerUtilization.values())
      .reduce((acc, val) => acc + val, 0);
    
    return sum / this.containerUtilization.size;
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        logger.error('Metrics collection failed:', error);
      }
    }, this.config.metricsInterval);
  }

  private async collectMetrics(): Promise<void> {
    const metrics = {
      activeJobs: this.activeJobs.size,
      pendingJobs: this.pendingJobs.size,
      containerCount: this.containerUtilization.size,
      avgUtilization: this.calculateAverageUtilization(),
      status: this.status,
      timestamp: new Date()
    };
    
    await this.metricsCollector.recordOrchestratorMetrics(metrics);
    this.emit('metrics:collected', metrics);
  }

  private async recoverInterruptedJobs(): Promise<void> {
    try {
      const interruptedJobs = await this.databaseService.getInterruptedJobs();
      
      for (const job of interruptedJobs) {
        logger.info(`Recovering interrupted job ${job.id}`);
        
        // Re-queue the job
        await this.jobRouter.route({
          type: JobType.EXECUTE_WORKFLOW,
          data: {
            jobRequest: job.request,
            orchestratorId: this.getOrchestratorId(),
            isRecovery: true
          },
          priority: QUEUE_CONFIG.priorities.HIGH
        });
      }
      
      logger.info(`Recovered ${interruptedJobs.length} interrupted jobs`);
    } catch (error) {
      logger.error('Failed to recover interrupted jobs:', error);
    }
  }

  private getOrchestratorId(): string {
    return `orchestrator-${process.env.HOSTNAME || 'default'}`;
  }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    this.status = OrchestratorStatus.DRAINING;
    
    logger.info('Shutting down orchestrator...');
    
    // Stop accepting new jobs
    this.emit('shutdown:started');
    
    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    // Wait for active jobs to complete (with timeout)
    const timeout = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();
    
    while (this.activeJobs.size > 0 && Date.now() - startTime < timeout) {
      logger.info(`Waiting for ${this.activeJobs.size} active jobs to complete...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Force release remaining containers
    for (const [jobId, assignment] of this.activeJobs) {
      logger.warn(`Force releasing container for job ${jobId}`);
      await this.containerPool.releaseContainer(assignment.containerId);
    }
    
    // Shutdown status reporter
    await this.statusReporter.shutdown();
    
    this.status = OrchestratorStatus.STOPPED;
    logger.info('Orchestrator shutdown complete');
    
    this.emit('shutdown:complete');
  }

  // Getters for monitoring
  public getStatus(): OrchestratorStatus {
    return this.status;
  }

  public getActiveJobs(): Map<string, ContainerAssignment> {
    return new Map(this.activeJobs);
  }

  public getPendingJobs(): Map<string, JobRequest> {
    return new Map(this.pendingJobs);
  }

  public getMetrics(): any {
    return {
      status: this.status,
      activeJobs: this.activeJobs.size,
      pendingJobs: this.pendingJobs.size,
      containers: this.containerUtilization.size,
      utilization: this.calculateAverageUtilization()
    };
  }

  // Helper methods for status reporting
  private async getJobFromPending(jobId: string): Promise<JobRequest | null> {
    return this.pendingJobs.get(jobId) || null;
  }

  private async getJobFromDatabase(jobId: string): Promise<JobRequest | null> {
    try {
      const jobData = await this.databaseService.getJob(jobId);
      return jobData ? jobData.request : null;
    } catch (error) {
      logger.error(`Failed to get job ${jobId} from database:`, error);
      return null;
    }
  }

  private mapGitHubConclusionToInternal(conclusion: string): JobConclusion {
    switch (conclusion) {
      case 'success':
        return JobConclusion.SUCCESS;
      case 'failure':
        return JobConclusion.FAILURE;
      case 'cancelled':
        return JobConclusion.CANCELLED;
      case 'skipped':
        return JobConclusion.SKIPPED;
      case 'timed_out':
        return JobConclusion.TIMED_OUT;
      case 'action_required':
        return JobConclusion.ACTION_REQUIRED;
      case 'neutral':
        return JobConclusion.NEUTRAL;
      default:
        return JobConclusion.FAILURE;
    }
  }

  private formatConclusion(conclusion: JobConclusion): string {
    const conclusionMap: Record<JobConclusion, string> = {
      [JobConclusion.SUCCESS]: 'Success',
      [JobConclusion.FAILURE]: 'Failed',
      [JobConclusion.CANCELLED]: 'Cancelled',
      [JobConclusion.SKIPPED]: 'Skipped',
      [JobConclusion.TIMED_OUT]: 'Timed Out',
      [JobConclusion.ACTION_REQUIRED]: 'Action Required',
      [JobConclusion.NEUTRAL]: 'Neutral'
    };
    
    return conclusionMap[conclusion] || conclusion;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

export { RunnerOrchestrator };
export default RunnerOrchestrator;