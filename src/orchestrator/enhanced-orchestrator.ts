import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { JobDistributionSystem, JobRoutingRequest, JobPriority } from '../job-distribution';
import { DockerIntegrationService } from '../docker';
import { RunnerOrchestrator, OrchestratorConfig, JobRequest } from './runner-orchestrator';
import { JobParser, ParsedJob } from './job-parser';
import { ContainerAssignmentManager, Container, AssignmentRequest } from './container-assignment';
import { StatusReporter, JobConclusion } from './status-reporter';
import { DatabaseService } from '../services/database-service';
import { MetricsCollector } from '../services/metrics-collector';

const logger = createLogger('EnhancedOrchestrator');

export interface EnhancedOrchestratorConfig extends OrchestratorConfig {
  jobDistribution: {
    enabled: boolean;
    maxConcurrentJobs: number;
    maxQueuedJobs: number;
    enableDependencyExecution: boolean;
    enableResourceAwareScheduling: boolean;
    enableLoadBalancing: boolean;
  };
  docker: {
    enabled: boolean;
    socketPath: string;
    registryUrl?: string;
    networkConfig?: {
      defaultDriver: string;
      enableMonitoring: boolean;
    };
    volumeConfig?: {
      defaultDriver: string;
      enableCleanup: boolean;
    };
  };
  scaling: {
    autoScaling: boolean;
    minContainers: number;
    maxContainers: number;
    scaleUpThreshold: number;
    scaleDownThreshold: number;
    cooldownPeriod: number;
  };
}

export interface JobExecutionResult {
  jobId: string;
  status: 'success' | 'failure' | 'cancelled' | 'timeout';
  conclusion: JobConclusion;
  startTime: Date;
  endTime: Date;
  duration: number;
  containerId: string;
  logs?: string;
  artifacts?: string[];
  metrics: {
    cpu: number;
    memory: number;
    network: number;
    disk: number;
  };
  stepResults: StepResult[];
}

export interface StepResult {
  stepId: string;
  name: string;
  status: 'success' | 'failure' | 'skipped';
  startTime: Date;
  endTime: Date;
  duration: number;
  output?: string;
  error?: string;
}

export interface OrchestratorMetrics {
  totalJobsProcessed: number;
  activeJobs: number;
  queuedJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageJobDuration: number;
  averageQueueTime: number;
  containerUtilization: number;
  systemLoad: number;
  throughput: number;
  errorRate: number;
  scalingEvents: number;
  lastScalingEvent?: Date;
}

export enum EnhancedOrchestratorStatus {
  INITIALIZING = 'initializing',
  READY = 'ready',
  PROCESSING = 'processing',
  SCALING_UP = 'scaling_up',
  SCALING_DOWN = 'scaling_down',
  DRAINING = 'draining',
  MAINTENANCE = 'maintenance',
  STOPPED = 'stopped',
  ERROR = 'error'
}

export class EnhancedOrchestrator extends EventEmitter {
  private static instance: EnhancedOrchestrator;
  private config: EnhancedOrchestratorConfig;
  private status: EnhancedOrchestratorStatus = EnhancedOrchestratorStatus.INITIALIZING;
  
  // Core components
  private jobDistributionSystem: JobDistributionSystem;
  private dockerIntegration: DockerIntegrationService;
  private legacyOrchestrator: RunnerOrchestrator;
  private jobParser: JobParser;
  private containerAssignment: ContainerAssignmentManager;
  private statusReporter: StatusReporter;
  private databaseService: DatabaseService;
  private metricsCollector: MetricsCollector;
  
  // Job tracking
  private activeJobs: Map<string, JobExecutionContext> = new Map();
  private jobQueue: Map<string, JobRequest> = new Map();
  private executionHistory: Map<string, JobExecutionResult> = new Map();
  
  // Container management
  private containerPool: Map<string, Container> = new Map();
  private containerJobMapping: Map<string, string> = new Map(); // containerId -> jobId
  
  // Metrics and monitoring
  private metrics: OrchestratorMetrics;
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;
  private scalingInterval?: NodeJS.Timeout;
  
  private isShuttingDown = false;
  private lastScalingAction?: Date;

  private constructor(config: EnhancedOrchestratorConfig) {
    super();
    this.config = config;
    
    // Initialize components
    this.jobDistributionSystem = new JobDistributionSystem();
    this.dockerIntegration = DockerIntegrationService.getInstance();
    this.legacyOrchestrator = RunnerOrchestrator.getInstance(config);
    this.jobParser = JobParser.getInstance();
    this.containerAssignment = ContainerAssignmentManager.getInstance();
    this.statusReporter = StatusReporter.getInstance();
    this.databaseService = DatabaseService.getInstance();
    this.metricsCollector = MetricsCollector.getInstance();
    
    this.metrics = this.initializeMetrics();
    this.setupEventListeners();
    
    logger.info('Enhanced Orchestrator initialized', {
      jobDistributionEnabled: config.jobDistribution.enabled,
      dockerEnabled: config.docker.enabled,
      autoScaling: config.scaling.autoScaling
    });
  }

  public static getInstance(config?: EnhancedOrchestratorConfig): EnhancedOrchestrator {
    if (!EnhancedOrchestrator.instance) {
      if (!config) {
        throw new Error('Configuration required for first initialization');
      }
      EnhancedOrchestrator.instance = new EnhancedOrchestrator(config);
    }
    return EnhancedOrchestrator.instance;
  }

  private initializeMetrics(): OrchestratorMetrics {
    return {
      totalJobsProcessed: 0,
      activeJobs: 0,
      queuedJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      averageJobDuration: 0,
      averageQueueTime: 0,
      containerUtilization: 0,
      systemLoad: 0,
      throughput: 0,
      errorRate: 0,
      scalingEvents: 0
    };
  }

  private setupEventListeners(): void {
    // Job Distribution System events
    this.jobDistributionSystem.components.parallelExecutor.on('job_execution_started', 
      this.handleJobExecutionStarted.bind(this));
    this.jobDistributionSystem.components.parallelExecutor.on('job_execution_completed', 
      this.handleJobExecutionCompleted.bind(this));
    this.jobDistributionSystem.components.parallelExecutor.on('job_execution_failed', 
      this.handleJobExecutionFailed.bind(this));

    // Container events
    this.containerAssignment.on('container:assigned', this.handleContainerAssigned.bind(this));
    this.containerAssignment.on('container:released', this.handleContainerReleased.bind(this));
    this.containerAssignment.on('container:unhealthy', this.handleContainerUnhealthy.bind(this));

    // Legacy orchestrator events for backward compatibility
    this.legacyOrchestrator.on('job:queued', this.handleLegacyJobQueued.bind(this));
    this.legacyOrchestrator.on('job:started', this.handleLegacyJobStarted.bind(this));
    this.legacyOrchestrator.on('job:completed', this.handleLegacyJobCompleted.bind(this));

    // Scaling events
    this.on('scaling:needed', this.handleScalingNeeded.bind(this));
  }

  public async initialize(): Promise<void> {
    try {
      logger.info('Initializing Enhanced Orchestrator...');
      
      // Initialize Docker integration if enabled
      if (this.config.docker.enabled) {
        await this.dockerIntegration.initialize({
          docker: {
            socketPath: this.config.docker.socketPath
          },
          networking: this.config.docker.networkConfig,
          volumes: this.config.docker.volumeConfig
        });
        logger.info('Docker integration initialized');
      }

      // Initialize Job Distribution System if enabled
      if (this.config.jobDistribution.enabled) {
        await this.jobDistributionSystem.initialize();
        logger.info('Job Distribution System initialized');
      }

      // Initialize legacy orchestrator for backward compatibility
      await this.legacyOrchestrator.initialize();
      logger.info('Legacy orchestrator initialized');

      // Initialize container assignment manager
      await this.containerAssignment.initialize();
      logger.info('Container assignment manager initialized');

      // Initialize status reporter
      await this.statusReporter.initialize();
      logger.info('Status reporter initialized');

      // Start monitoring and health checks
      this.startHealthChecks();
      this.startMetricsCollection();
      
      if (this.config.scaling.autoScaling) {
        this.startAutoScaling();
      }

      // Recover any interrupted jobs
      await this.recoverInterruptedJobs();

      this.status = EnhancedOrchestratorStatus.READY;
      logger.info('Enhanced Orchestrator initialized successfully');
      
      this.emit('initialized');
    } catch (error) {
      logger.error('Failed to initialize Enhanced Orchestrator:', error);
      this.status = EnhancedOrchestratorStatus.ERROR;
      throw error;
    }
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
    try {
      // Parse the job using the enhanced job parser
      const parsedJob = this.jobParser.parseJob({
        id: workflowJob.id.toString(),
        name: workflowJob.name,
        labels: workflowJob.labels,
        steps: workflowJob.steps || [],
        container: workflowJob.container,
        services: workflowJob.services,
        timeout_minutes: workflowJob.timeout_minutes || 360,
        env: {},
        needs: workflowJob.needs
      });

      // Validate the job
      const validationErrors = this.jobParser.validateJob(parsedJob);
      if (validationErrors.some(err => err.severity === 'error')) {
        logger.error('Job validation failed:', { jobId: workflowJob.id, errors: validationErrors });
        await this.reportJobFailure(workflowJob.id.toString(), 'Job validation failed');
        return;
      }

      // Check if we can run this job
      if (!this.jobParser.canRunJob(parsedJob)) {
        logger.warn('Job cannot be run on this orchestrator:', { 
          jobId: workflowJob.id, 
          labels: workflowJob.labels 
        });
        return;
      }

      // Create job routing request for the new job distribution system
      if (this.config.jobDistribution.enabled) {
        const jobRoutingRequest: JobRoutingRequest = {
          jobId: workflowJob.id.toString(),
          workflowId: workflowJob.workflow_name,
          repository: repository.full_name,
          sha: workflowJob.head_sha,
          ref: workflowJob.head_ref || workflowJob.head_branch,
          labels: workflowJob.labels,
          environment: {},
          services: workflowJob.services || {},
          container: workflowJob.container,
          strategy: [],
          needs: workflowJob.needs ? (Array.isArray(workflowJob.needs) ? workflowJob.needs : [workflowJob.needs]) : [],
          timeout: (workflowJob.timeout_minutes || 360) * 60 * 1000,
          priority: this.calculateJobPriority(workflowJob),
          resourceRequirements: this.estimateResourceRequirements(parsedJob),
          metadata: {
            estimatedDuration: this.estimateJobDuration(parsedJob),
            jobType: this.getJobType(workflowJob),
            workflowType: this.getWorkflowType(workflowJob.workflow_name),
            criticality: this.getJobCriticality(workflowJob),
            tags: this.extractJobTags(workflowJob),
            constraints: {
              allowedRunners: [],
              blockedRunners: [],
              requiredCapabilities: this.extractRequiredCapabilities(parsedJob),
              securityLevel: 'standard'
            },
            preferences: {
              preferredRunners: [],
              affinityRules: [],
              antiAffinityRules: [],
              performanceProfile: 'balanced'
            }
          }
        };

        // Submit to job distribution system
        const planId = await this.jobDistributionSystem.submitJob(jobRoutingRequest);
        
        // Track the job
        const executionContext: JobExecutionContext = {
          jobId: workflowJob.id.toString(),
          planId,
          parsedJob,
          originalRequest: jobRoutingRequest,
          status: 'queued',
          queuedAt: new Date(),
          repository: repository.full_name,
          workflow: workflowJob.workflow_name
        };
        
        this.activeJobs.set(workflowJob.id.toString(), executionContext);
        this.jobQueue.set(workflowJob.id.toString(), this.createJobRequest(workflowJob, repository));

        logger.info(`Job ${workflowJob.id} submitted to job distribution system`, { planId });
      } else {
        // Fallback to legacy orchestrator
        await this.legacyOrchestrator.handleWorkflowJobEvent({ action: 'queued', workflow_job: workflowJob, repository });
      }

      // Report job as queued to GitHub
      await this.statusReporter.reportJobStatus({
        id: workflowJob.id.toString(),
        repository: repository.full_name,
        sha: workflowJob.head_sha,
        runId: workflowJob.run_id,
        name: workflowJob.name,
        status: 'queued' as any,
        output: {
          title: `${workflowJob.name} - Queued`,
          summary: 'Job has been queued for execution in enhanced orchestrator'
        }
      });

      this.updateMetrics();
      this.emit('job:queued', { jobId: workflowJob.id, planId: this.activeJobs.get(workflowJob.id.toString())?.planId });

    } catch (error) {
      logger.error('Failed to handle queued job:', error);
      await this.reportJobFailure(workflowJob.id.toString(), `Job queueing failed: ${error.message}`);
    }
  }

  private createJobRequest(workflowJob: any, repository: any): JobRequest {
    return {
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
  }

  private calculateJobPriority(workflowJob: any): JobPriority {
    const workflow = workflowJob.workflow_name?.toLowerCase() || '';
    const labels = workflowJob.labels || [];
    
    if (workflow.includes('deploy') || workflow.includes('release') || workflow.includes('hotfix')) {
      return JobPriority.Critical;
    }
    
    if (labels.includes('urgent') || labels.includes('high-priority') || workflow.includes('security')) {
      return JobPriority.High;
    }
    
    if (workflow.includes('test') || workflow.includes('build') || workflow.includes('ci')) {
      return JobPriority.Medium;
    }
    
    return JobPriority.Low;
  }

  private estimateResourceRequirements(job: ParsedJob): any {
    const baseRequirements = {
      cpu: { min: 1, max: 4, preferred: 2 },
      memory: { min: '1GB', max: '8GB', preferred: '4GB' },
      disk: { min: '10GB', max: '100GB', preferred: '50GB' },
      network: { bandwidth: '100Mbps', latency: 50 },
      specialized: ['docker']
    };

    // Adjust based on job characteristics
    const labels = Array.isArray(job.runs_on) ? job.runs_on : [job.runs_on];
    
    if (labels.includes('large-runner')) {
      baseRequirements.cpu = { min: 2, max: 8, preferred: 4 };
      baseRequirements.memory = { min: '4GB', max: '16GB', preferred: '8GB' };
      baseRequirements.disk = { min: '25GB', max: '200GB', preferred: '100GB' };
    } else if (labels.includes('xlarge-runner')) {
      baseRequirements.cpu = { min: 4, max: 16, preferred: 8 };
      baseRequirements.memory = { min: '8GB', max: '32GB', preferred: '16GB' };
      baseRequirements.disk = { min: '50GB', max: '500GB', preferred: '200GB' };
    }

    // Adjust for container requirements
    if (job.container?.image) {
      if (job.container.image.includes('node')) {
        baseRequirements.memory.preferred = '6GB';
      } else if (job.container.image.includes('docker')) {
        baseRequirements.specialized.push('docker-in-docker');
      }
    }

    return baseRequirements;
  }

  private estimateJobDuration(job: ParsedJob): number {
    // Base estimate on job characteristics
    let baseDuration = 15 * 60; // 15 minutes default

    // Adjust based on job name/type
    const jobName = job.name.toLowerCase();
    if (jobName.includes('test')) {
      baseDuration = 20 * 60; // 20 minutes
    } else if (jobName.includes('build')) {
      baseDuration = 30 * 60; // 30 minutes
    } else if (jobName.includes('deploy')) {
      baseDuration = 10 * 60; // 10 minutes
    }

    // Adjust based on number of steps
    baseDuration += job.steps.length * 30; // 30 seconds per step

    // Adjust based on container complexity
    if (job.services && Object.keys(job.services).length > 0) {
      baseDuration += 5 * 60; // 5 minutes for services
    }

    return baseDuration;
  }

  private getJobType(workflowJob: any): 'ci' | 'cd' | 'test' | 'build' | 'deploy' | 'other' {
    const workflow = workflowJob.workflow_name?.toLowerCase() || '';
    const jobName = workflowJob.name?.toLowerCase() || '';
    
    if (workflow.includes('deploy') || jobName.includes('deploy')) return 'deploy';
    if (workflow.includes('build') || jobName.includes('build')) return 'build';
    if (workflow.includes('test') || jobName.includes('test')) return 'test';
    if (workflow.includes('ci')) return 'ci';
    if (workflow.includes('cd')) return 'cd';
    
    return 'other';
  }

  private getWorkflowType(workflowName: string): 'push' | 'pull_request' | 'schedule' | 'manual' | 'other' {
    // This would normally come from the event context
    return 'push'; // Simplified for now
  }

  private getJobCriticality(workflowJob: any): 'low' | 'normal' | 'high' | 'critical' {
    const workflow = workflowJob.workflow_name?.toLowerCase() || '';
    const labels = workflowJob.labels || [];
    
    if (workflow.includes('hotfix') || labels.includes('critical')) return 'critical';
    if (workflow.includes('release') || workflow.includes('deploy')) return 'high';
    if (workflow.includes('security') || labels.includes('urgent')) return 'high';
    
    return 'normal';
  }

  private extractJobTags(workflowJob: any): string[] {
    const tags = [];
    
    if (workflowJob.workflow_name) {
      tags.push(`workflow:${workflowJob.workflow_name}`);
    }
    
    if (workflowJob.labels) {
      tags.push(...workflowJob.labels.map((label: string) => `label:${label}`));
    }
    
    return tags;
  }

  private extractRequiredCapabilities(job: ParsedJob): string[] {
    const capabilities = ['docker']; // Base capability
    
    if (job.container) {
      capabilities.push('container-runtime');
    }
    
    if (job.services && Object.keys(job.services).length > 0) {
      capabilities.push('docker-compose');
    }
    
    // Extract from runs_on labels
    const labels = Array.isArray(job.runs_on) ? job.runs_on : [job.runs_on];
    capabilities.push(...labels.filter(label => 
      ['docker', 'kubernetes', 'gpu', 'large-runner'].includes(label)
    ));
    
    return [...new Set(capabilities)];
  }

  private async handleJobInProgress(workflowJob: any): Promise<void> {
    const jobId = workflowJob.id.toString();
    const context = this.activeJobs.get(jobId);
    
    if (!context) {
      logger.warn(`Job ${jobId} started but no context found`);
      return;
    }
    
    context.status = 'in_progress';
    context.startedAt = new Date();
    
    logger.info(`Job ${jobId} is now in progress`);
    this.emit('job:started', { jobId, context });
  }

  private async handleJobCompleted(workflowJob: any): Promise<void> {
    const jobId = workflowJob.id.toString();
    const context = this.activeJobs.get(jobId);
    
    if (!context) {
      logger.warn(`Job ${jobId} completed but no context found`);
      return;
    }
    
    const result: JobExecutionResult = {
      jobId,
      status: workflowJob.conclusion === 'success' ? 'success' : 'failure',
      conclusion: this.mapGitHubConclusionToInternal(workflowJob.conclusion),
      startTime: context.startedAt || context.queuedAt,
      endTime: new Date(),
      duration: (new Date().getTime() - (context.startedAt || context.queuedAt).getTime()),
      containerId: context.containerId || 'unknown',
      stepResults: [],
      metrics: {
        cpu: 0,
        memory: 0,
        network: 0,
        disk: 0
      }
    };
    
    // Store execution result
    this.executionHistory.set(jobId, result);
    this.activeJobs.delete(jobId);
    this.jobQueue.delete(jobId);
    
    // Update metrics
    this.updateMetrics();
    
    logger.info(`Job ${jobId} completed with conclusion: ${workflowJob.conclusion}`);
    this.emit('job:completed', { jobId, result });
  }

  // Event handlers for job distribution system
  private handleJobExecutionStarted(data: any): void {
    const { jobId } = data;
    const context = this.findJobContextByPlanOrJobId(jobId);
    
    if (context) {
      context.status = 'executing';
      context.startedAt = new Date();
      logger.info(`Job execution started via job distribution system: ${jobId}`);
    }
  }

  private handleJobExecutionCompleted(data: any): void {
    const { jobId, job } = data;
    const context = this.findJobContextByPlanOrJobId(jobId);
    
    if (context) {
      context.status = 'completed';
      context.completedAt = new Date();
      
      const result: JobExecutionResult = {
        jobId: context.jobId,
        status: 'success',
        conclusion: JobConclusion.SUCCESS,
        startTime: context.startedAt || context.queuedAt,
        endTime: new Date(),
        duration: job.duration || 0,
        containerId: context.containerId || 'distributed',
        stepResults: [],
        metrics: {
          cpu: 0,
          memory: 0,
          network: 0,
          disk: 0
        }
      };
      
      this.executionHistory.set(context.jobId, result);
      logger.info(`Job execution completed via job distribution system: ${context.jobId}`);
    }
  }

  private handleJobExecutionFailed(data: any): void {
    const { jobId, error } = data;
    const context = this.findJobContextByPlanOrJobId(jobId);
    
    if (context) {
      context.status = 'failed';
      context.error = error.message;
      logger.error(`Job execution failed via job distribution system: ${context.jobId}`, error);
    }
  }

  private findJobContextByPlanOrJobId(id: string): JobExecutionContext | undefined {
    // First try to find by job ID
    let context = this.activeJobs.get(id);
    if (context) return context;
    
    // Then try to find by plan ID
    for (const [jobId, ctx] of this.activeJobs.entries()) {
      if (ctx.planId === id) {
        return ctx;
      }
    }
    
    return undefined;
  }

  // Legacy orchestrator event handlers for backward compatibility
  private handleLegacyJobQueued(data: any): void {
    logger.debug('Legacy job queued:', data);
  }

  private handleLegacyJobStarted(data: any): void {
    logger.debug('Legacy job started:', data);
  }

  private handleLegacyJobCompleted(data: any): void {
    logger.debug('Legacy job completed:', data);
  }

  // Container management event handlers
  private handleContainerAssigned(data: any): void {
    const { jobId, containerId } = data;
    const context = this.activeJobs.get(jobId);
    
    if (context) {
      context.containerId = containerId;
      context.containerAssignedAt = new Date();
      this.containerJobMapping.set(containerId, jobId);
      logger.info(`Container ${containerId} assigned to job ${jobId}`);
    }
  }

  private handleContainerReleased(data: any): void {
    const { containerId } = data;
    const jobId = this.containerJobMapping.get(containerId);
    
    if (jobId) {
      this.containerJobMapping.delete(containerId);
      logger.info(`Container ${containerId} released from job ${jobId}`);
    }
  }

  private handleContainerUnhealthy(data: any): void {
    const { containerId } = data;
    const jobId = this.containerJobMapping.get(containerId);
    
    if (jobId) {
      logger.warn(`Container ${containerId} is unhealthy, job ${jobId} may be affected`);
      this.emit('job:container_unhealthy', { jobId, containerId });
    }
  }

  // Auto-scaling functionality
  private startAutoScaling(): void {
    this.scalingInterval = setInterval(async () => {
      try {
        await this.evaluateScaling();
      } catch (error) {
        logger.error('Auto-scaling evaluation failed:', error);
      }
    }, 30000); // Check every 30 seconds
  }

  private async evaluateScaling(): Promise<void> {
    const now = new Date();
    
    // Avoid scaling too frequently
    if (this.lastScalingAction && now.getTime() - this.lastScalingAction.getTime() < this.config.scaling.cooldownPeriod) {
      return;
    }

    const queueDepth = this.jobQueue.size;
    const activeJobs = this.activeJobs.size;
    const containerCount = this.containerPool.size;
    const utilizationRate = activeJobs / Math.max(containerCount, 1);

    // Scale up conditions
    if (utilizationRate > this.config.scaling.scaleUpThreshold && 
        containerCount < this.config.scaling.maxContainers &&
        queueDepth > 2) {
      
      await this.scaleUp();
    }
    
    // Scale down conditions
    else if (utilizationRate < this.config.scaling.scaleDownThreshold &&
             containerCount > this.config.scaling.minContainers &&
             queueDepth === 0) {
      
      await this.scaleDown();
    }
  }

  private async scaleUp(): Promise<void> {
    this.status = EnhancedOrchestratorStatus.SCALING_UP;
    this.lastScalingAction = new Date();
    this.metrics.scalingEvents++;
    this.metrics.lastScalingEvent = new Date();
    
    logger.info('Scaling up container capacity');
    
    try {
      // Request more containers from the container pool
      await this.containerAssignment.scaleUp(2); // Scale up by 2 containers
      
      this.emit('scaling:completed', { direction: 'up', timestamp: new Date() });
      this.status = EnhancedOrchestratorStatus.READY;
    } catch (error) {
      logger.error('Scale up failed:', error);
      this.status = EnhancedOrchestratorStatus.ERROR;
    }
  }

  private async scaleDown(): Promise<void> {
    this.status = EnhancedOrchestratorStatus.SCALING_DOWN;
    this.lastScalingAction = new Date();
    this.metrics.scalingEvents++;
    this.metrics.lastScalingEvent = new Date();
    
    logger.info('Scaling down container capacity');
    
    try {
      // Remove idle containers from the pool
      await this.containerAssignment.scaleDown(1); // Scale down by 1 container
      
      this.emit('scaling:completed', { direction: 'down', timestamp: new Date() });
      this.status = EnhancedOrchestratorStatus.READY;
    } catch (error) {
      logger.error('Scale down failed:', error);
      this.status = EnhancedOrchestratorStatus.ERROR;
    }
  }

  private handleScalingNeeded(data: any): void {
    const { direction, reason } = data;
    logger.info(`Scaling needed: ${direction} - ${reason}`);
    
    if (this.config.scaling.autoScaling) {
      if (direction === 'up') {
        this.scaleUp();
      } else if (direction === 'down') {
        this.scaleDown();
      }
    }
  }

  // Health checks and monitoring
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
      queuedJobs: this.jobQueue.size,
      containerCount: this.containerPool.size,
      containerUtilization: this.calculateContainerUtilization(),
      systemLoad: await this.calculateSystemLoad(),
      timestamp: new Date()
    };

    // Report health metrics
    await this.metricsCollector.recordOrchestratorHealth(health);
    
    // Check for scaling needs
    if (health.queuedJobs > 5 && health.containerUtilization > 0.8) {
      this.emit('scaling:needed', { direction: 'up', reason: 'high load' });
    } else if (health.activeJobs < 2 && health.containerUtilization < 0.3) {
      this.emit('scaling:needed', { direction: 'down', reason: 'low load' });
    }
  }

  private calculateContainerUtilization(): number {
    if (this.containerPool.size === 0) return 0;
    
    const busyContainers = Array.from(this.containerPool.values())
      .filter(container => container.assignedJob).length;
    
    return busyContainers / this.containerPool.size;
  }

  private async calculateSystemLoad(): Promise<number> {
    // Calculate system load based on various factors
    const cpuLoad = await this.getCpuLoad();
    const memoryLoad = await this.getMemoryLoad();
    const diskLoad = await this.getDiskLoad();
    
    return (cpuLoad + memoryLoad + diskLoad) / 3;
  }

  private async getCpuLoad(): Promise<number> {
    // Simplified CPU load calculation
    // In a real implementation, this would use system metrics
    return Math.random() * 0.8; // Simulated
  }

  private async getMemoryLoad(): Promise<number> {
    // Simplified memory load calculation
    return Math.random() * 0.7; // Simulated
  }

  private async getDiskLoad(): Promise<number> {
    // Simplified disk load calculation
    return Math.random() * 0.6; // Simulated
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
    this.updateMetrics();
    
    await this.metricsCollector.recordOrchestratorMetrics(this.metrics);
    this.emit('metrics:collected', this.metrics);
  }

  private updateMetrics(): void {
    const now = new Date();
    const completedJobs = Array.from(this.executionHistory.values());
    
    this.metrics.activeJobs = this.activeJobs.size;
    this.metrics.queuedJobs = this.jobQueue.size;
    this.metrics.totalJobsProcessed = completedJobs.length;
    this.metrics.completedJobs = completedJobs.filter(job => job.status === 'success').length;
    this.metrics.failedJobs = completedJobs.filter(job => job.status === 'failure').length;
    this.metrics.containerUtilization = this.calculateContainerUtilization();
    
    if (completedJobs.length > 0) {
      this.metrics.averageJobDuration = completedJobs.reduce((sum, job) => sum + job.duration, 0) / completedJobs.length;
      this.metrics.errorRate = this.metrics.failedJobs / this.metrics.totalJobsProcessed;
      
      // Calculate throughput (jobs per minute)
      const recentJobs = completedJobs.filter(job => 
        now.getTime() - job.endTime.getTime() < 60000); // Last minute
      this.metrics.throughput = recentJobs.length;
    }
  }

  private async recoverInterruptedJobs(): Promise<void> {
    try {
      const interruptedJobs = await this.databaseService.getInterruptedJobs();
      
      for (const job of interruptedJobs) {
        logger.info(`Recovering interrupted job ${job.id}`);
        
        if (this.config.jobDistribution.enabled) {
          // Re-submit to job distribution system
          const jobRoutingRequest = this.createJobRoutingRequestFromInterruptedJob(job);
          await this.jobDistributionSystem.submitJob(jobRoutingRequest);
        } else {
          // Fallback to legacy orchestrator
          // Implementation would go here
        }
      }
      
      logger.info(`Recovered ${interruptedJobs.length} interrupted jobs`);
    } catch (error) {
      logger.error('Failed to recover interrupted jobs:', error);
    }
  }

  private createJobRoutingRequestFromInterruptedJob(job: any): JobRoutingRequest {
    // Convert interrupted job data back to routing request format
    return {
      jobId: job.id,
      workflowId: job.workflow,
      repository: job.repository,
      sha: job.sha,
      ref: job.ref,
      labels: job.labels || [],
      environment: job.environment || {},
      services: job.services || {},
      container: job.container,
      strategy: [],
      needs: job.needs || [],
      timeout: job.timeout || 3600000,
      priority: JobPriority.High, // High priority for recovery
      resourceRequirements: job.resourceRequirements || {
        cpu: { min: 1, max: 4, preferred: 2 },
        memory: { min: '1GB', max: '8GB', preferred: '4GB' },
        disk: { min: '10GB', max: '100GB', preferred: '50GB' },
        network: { bandwidth: '100Mbps', latency: 50 },
        specialized: ['docker']
      },
      metadata: job.metadata || {
        estimatedDuration: 1800,
        jobType: 'other',
        workflowType: 'push',
        criticality: 'normal',
        tags: ['recovery'],
        constraints: {
          allowedRunners: [],
          blockedRunners: [],
          requiredCapabilities: ['docker'],
          securityLevel: 'standard'
        },
        preferences: {
          preferredRunners: [],
          affinityRules: [],
          antiAffinityRules: [],
          performanceProfile: 'balanced'
        }
      }
    };
  }

  private async reportJobFailure(jobId: string, reason: string): Promise<void> {
    const context = this.activeJobs.get(jobId);
    if (context) {
      await this.statusReporter.reportJobCompleted(
        jobId,
        context.repository,
        context.originalRequest.sha,
        context.originalRequest.jobId,
        context.originalRequest.metadata.estimatedDuration,
        JobConclusion.FAILURE,
        {
          title: 'Job Failed',
          summary: reason
        }
      );
    }
  }

  private mapGitHubConclusionToInternal(conclusion: string): JobConclusion {
    switch (conclusion) {
      case 'success': return JobConclusion.SUCCESS;
      case 'failure': return JobConclusion.FAILURE;
      case 'cancelled': return JobConclusion.CANCELLED;
      case 'skipped': return JobConclusion.SKIPPED;
      case 'timed_out': return JobConclusion.TIMED_OUT;
      case 'action_required': return JobConclusion.ACTION_REQUIRED;
      case 'neutral': return JobConclusion.NEUTRAL;
      default: return JobConclusion.FAILURE;
    }
  }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    this.status = EnhancedOrchestratorStatus.DRAINING;
    
    logger.info('Shutting down Enhanced Orchestrator...');
    
    // Stop accepting new jobs
    this.emit('shutdown:started');
    
    // Clear intervals
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.metricsInterval) clearInterval(this.metricsInterval);
    if (this.scalingInterval) clearInterval(this.scalingInterval);
    
    // Shutdown job distribution system
    if (this.config.jobDistribution.enabled) {
      await this.jobDistributionSystem.shutdown();
    }
    
    // Shutdown Docker integration
    if (this.config.docker.enabled) {
      await this.dockerIntegration.shutdown();
    }
    
    // Shutdown legacy orchestrator
    await this.legacyOrchestrator.shutdown();
    
    // Wait for active jobs to complete
    const timeout = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();
    
    while (this.activeJobs.size > 0 && Date.now() - startTime < timeout) {
      logger.info(`Waiting for ${this.activeJobs.size} active jobs to complete...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    this.status = EnhancedOrchestratorStatus.STOPPED;
    logger.info('Enhanced Orchestrator shutdown complete');
    
    this.emit('shutdown:complete');
  }

  // Public API methods
  public getStatus(): EnhancedOrchestratorStatus {
    return this.status;
  }

  public getMetrics(): OrchestratorMetrics {
    return { ...this.metrics };
  }

  public getActiveJobs(): Map<string, JobExecutionContext> {
    return new Map(this.activeJobs);
  }

  public getJobQueue(): Map<string, JobRequest> {
    return new Map(this.jobQueue);
  }

  public getExecutionHistory(): Map<string, JobExecutionResult> {
    return new Map(this.executionHistory);
  }

  public getContainerPool(): Map<string, Container> {
    return new Map(this.containerPool);
  }

  public async getJobStatus(jobId: string): Promise<JobExecutionContext | JobExecutionResult | null> {
    const activeJob = this.activeJobs.get(jobId);
    if (activeJob) return activeJob;
    
    const completedJob = this.executionHistory.get(jobId);
    if (completedJob) return completedJob;
    
    return null;
  }

  public async cancelJob(jobId: string): Promise<boolean> {
    const context = this.activeJobs.get(jobId);
    if (!context) return false;
    
    try {
      if (this.config.jobDistribution.enabled && context.planId) {
        await this.jobDistributionSystem.components.parallelExecutor.cancelExecution(context.planId);
      }
      
      context.status = 'cancelled';
      context.cancelledAt = new Date();
      
      this.activeJobs.delete(jobId);
      this.jobQueue.delete(jobId);
      
      logger.info(`Job ${jobId} cancelled successfully`);
      this.emit('job:cancelled', { jobId });
      
      return true;
    } catch (error) {
      logger.error(`Failed to cancel job ${jobId}:`, error);
      return false;
    }
  }
}

interface JobExecutionContext {
  jobId: string;
  planId?: string;
  parsedJob: ParsedJob;
  originalRequest: JobRoutingRequest;
  status: 'queued' | 'in_progress' | 'executing' | 'completed' | 'failed' | 'cancelled';
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  containerId?: string;
  containerAssignedAt?: Date;
  repository: string;
  workflow: string;
  error?: string;
}

export default EnhancedOrchestrator;