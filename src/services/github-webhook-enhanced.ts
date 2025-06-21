import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createLogger } from '../utils/logger';
import database from './database';
import jobQueue from './job-queue';
import runnerPoolManager from './runner-pool-manager';
import monitoringService from './monitoring';
import { Request } from 'express';
import { Server as SocketIOServer } from 'socket.io';

const logger = createLogger('GitHubWebhookEnhanced');

// Comprehensive GitHub event types
export const GITHUB_EVENT_TYPES = {
  // Actions events
  CHECK_RUN: 'check_run',
  CHECK_SUITE: 'check_suite',
  WORKFLOW_DISPATCH: 'workflow_dispatch',
  WORKFLOW_JOB: 'workflow_job',
  WORKFLOW_RUN: 'workflow_run',
  
  // Code events
  CREATE: 'create',
  DELETE: 'delete',
  PUSH: 'push',
  
  // PR events
  PULL_REQUEST: 'pull_request',
  PULL_REQUEST_REVIEW: 'pull_request_review',
  PULL_REQUEST_REVIEW_COMMENT: 'pull_request_review_comment',
  PULL_REQUEST_TARGET: 'pull_request_target',
  
  // Issue events
  ISSUES: 'issues',
  ISSUE_COMMENT: 'issue_comment',
  
  // Repository events
  DEPLOYMENT: 'deployment',
  DEPLOYMENT_STATUS: 'deployment_status',
  FORK: 'fork',
  GOLLUM: 'gollum', // Wiki pages
  PAGE_BUILD: 'page_build',
  PUBLIC: 'public',
  RELEASE: 'release',
  REPOSITORY: 'repository',
  REPOSITORY_DISPATCH: 'repository_dispatch',
  STAR: 'star',
  STATUS: 'status',
  WATCH: 'watch',
  
  // Organization events
  MEMBER: 'member',
  MEMBERSHIP: 'membership',
  ORGANIZATION: 'organization',
  ORG_BLOCK: 'org_block',
  TEAM: 'team',
  TEAM_ADD: 'team_add',
  
  // Security events
  CODE_SCANNING_ALERT: 'code_scanning_alert',
  SECRET_SCANNING_ALERT: 'secret_scanning_alert',
  SECURITY_ADVISORY: 'security_advisory',
  VULNERABILITY_ALERT: 'vulnerability_alert',
  
  // App events
  INSTALLATION: 'installation',
  INSTALLATION_REPOSITORIES: 'installation_repositories',
  
  // Other events
  LABEL: 'label',
  MILESTONE: 'milestone',
  PACKAGE: 'package',
  PING: 'ping',
  PROJECT: 'project',
  PROJECT_CARD: 'project_card',
  PROJECT_COLUMN: 'project_column',
  REGISTRY_PACKAGE: 'registry_package',
  SPONSORSHIP: 'sponsorship'
} as const;

export type GitHubEventType = typeof GITHUB_EVENT_TYPES[keyof typeof GITHUB_EVENT_TYPES];

export interface WebhookEvent {
  id: string;
  repository: string;
  event: string;
  action?: string;
  payload: any;
  signature: string;
  deliveryId: string;
  timestamp: Date;
  processed: boolean;
  processingAttempts: number;
  lastProcessingError?: string;
  processingDurationMs?: number;
  dedupKey?: string;
}

export interface WebhookProcessingResult {
  success: boolean;
  message: string;
  processed: boolean;
  deduplicated?: boolean;
  validationErrors?: string[];
  processingTimeMs?: number;
}

export interface WebhookEventStats {
  event: string;
  total: number;
  processed: number;
  pending: number;
  failed: number;
  avgProcessingTimeMs: number;
  lastProcessedAt?: Date;
}

export interface WorkflowJobEvent {
  action: 'queued' | 'in_progress' | 'completed';
  workflow_job: {
    id: number;
    run_id: number;
    run_attempt: number;
    node_id: string;
    head_sha: string;
    url: string;
    html_url: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral' | 'stale';
    started_at?: string;
    completed_at?: string;
    name: string;
    steps: Array<{
      name: string;
      status: string;
      conclusion?: string;
      number: number;
      started_at?: string;
      completed_at?: string;
    }>;
    check_run_url: string;
    labels: string[];
    runner_id?: number;
    runner_name?: string;
    runner_group_id?: number;
    runner_group_name?: string;
    workflow_name?: string;
  };
  repository: {
    id: number;
    node_id: string;
    name: string;
    full_name: string;
    private: boolean;
    owner: {
      login: string;
      id: number;
      node_id: string;
      avatar_url: string;
      type: string;
    };
  };
  organization?: {
    login: string;
    id: number;
    node_id: string;
  };
  sender: {
    login: string;
    id: number;
    type: string;
  };
}

export class GitHubWebhookEnhancedService extends EventEmitter {
  private static instance: GitHubWebhookEnhancedService;
  private webhookSecret: string;
  private io: SocketIOServer | null = null;
  private processingCache: Map<string, Date> = new Map(); // For deduplication
  private cacheTTL: number = 60000; // 1 minute TTL for dedup cache
  private supportedEvents: Set<string>;
  private eventHandlers: Map<string, (event: WebhookEvent) => Promise<void>> = new Map();

  private constructor() {
    super();
    this.webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || '';
    this.supportedEvents = new Set(Object.values(GITHUB_EVENT_TYPES));
    
    if (!this.webhookSecret) {
      logger.warn('No GitHub webhook secret configured - webhook signature verification disabled');
    }

    this.setupEventHandlers();
    this.startCacheCleanup();
  }

  public static getInstance(): GitHubWebhookEnhancedService {
    if (!GitHubWebhookEnhancedService.instance) {
      GitHubWebhookEnhancedService.instance = new GitHubWebhookEnhancedService();
    }
    return GitHubWebhookEnhancedService.instance;
  }

  /**
   * Set Socket.IO instance for real-time updates
   */
  public setSocketIO(io: SocketIOServer): void {
    this.io = io;
    logger.info('Socket.IO instance set for webhook service');
  }

  /**
   * Initialize the webhook service
   */
  async initialize(): Promise<void> {
    logger.info('Initializing enhanced GitHub webhook service');

    try {
      // Create webhook events table with enhanced schema
      await this.ensureWebhookTables();
      
      // Setup event listeners
      this.setupEventListeners();

      logger.info('Enhanced GitHub webhook service initialized');
    } catch (error) {
      logger.error('Failed to initialize enhanced GitHub webhook service', { error });
      throw error;
    }
  }

  /**
   * Process incoming webhook with enhanced features
   */
  async processWebhook(
    req: Request,
    eventType: string,
    signature: string,
    deliveryId: string,
    payload: any
  ): Promise<WebhookProcessingResult> {
    const startTime = Date.now();
    const result: WebhookProcessingResult = {
      success: false,
      message: '',
      processed: false
    };

    try {
      // 1. Validate webhook
      const validationErrors = await this.validateWebhook(req, eventType, signature, deliveryId, payload);
      if (validationErrors.length > 0) {
        result.validationErrors = validationErrors;
        result.message = `Validation failed: ${validationErrors.join(', ')}`;
        logger.warn('Webhook validation failed', { deliveryId, errors: validationErrors });
        return result;
      }

      // 2. Check for duplicate
      const dedupKey = this.generateDedupKey(eventType, deliveryId, payload);
      if (this.isDuplicate(dedupKey)) {
        result.success = true;
        result.processed = false;
        result.deduplicated = true;
        result.message = 'Duplicate event ignored';
        logger.debug('Duplicate webhook ignored', { deliveryId, dedupKey });
        return result;
      }

      // 3. Create webhook event record
      const webhookEvent: WebhookEvent = {
        id: deliveryId,
        repository: payload.repository?.full_name || 'unknown',
        event: eventType,
        action: payload.action,
        payload,
        signature,
        deliveryId,
        timestamp: new Date(),
        processed: false,
        processingAttempts: 0,
        dedupKey
      };

      // 4. Store webhook event
      await this.storeWebhookEvent(webhookEvent);

      // 5. Process the event
      await this.handleWebhookEvent(webhookEvent);

      // 6. Update processing status
      const processingDurationMs = Date.now() - startTime;
      await this.markWebhookProcessed(deliveryId, true, processingDurationMs);

      // 7. Mark as processed in dedup cache
      this.markAsProcessed(dedupKey);

      // 8. Emit real-time updates via WebSocket
      this.emitWebSocketUpdate(webhookEvent);

      // 9. Record metrics
      await this.recordWebhookMetrics(eventType, true, processingDurationMs);

      result.success = true;
      result.processed = true;
      result.message = 'Webhook processed successfully';
      result.processingTimeMs = processingDurationMs;

      logger.info('Webhook processed successfully', {
        deliveryId,
        eventType,
        action: payload.action,
        repository: webhookEvent.repository,
        processingTimeMs: processingDurationMs
      });

      return result;

    } catch (error) {
      const processingDurationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Update processing status with error
      await this.markWebhookProcessed(deliveryId, false, processingDurationMs, errorMessage);
      
      // Record error metrics
      await this.recordWebhookMetrics(eventType, false, processingDurationMs);

      logger.error('Failed to process webhook', {
        deliveryId,
        eventType,
        error: errorMessage,
        processingTimeMs: processingDurationMs
      });

      result.message = errorMessage;
      result.processingTimeMs = processingDurationMs;
      return result;
    }
  }

  /**
   * Validate incoming webhook
   */
  private async validateWebhook(
    _req: Request,
    eventType: string,
    signature: string,
    deliveryId: string,
    payload: any
  ): Promise<string[]> {
    const errors: string[] = [];

    // Check required headers
    if (!eventType) {
      errors.push('Missing X-GitHub-Event header');
    }

    if (!deliveryId) {
      errors.push('Missing X-GitHub-Delivery header');
    }

    // Verify signature if secret is configured
    if (this.webhookSecret && !this.verifySignature(payload, signature)) {
      errors.push('Invalid webhook signature');
    }

    // Check if event type is supported
    if (!this.supportedEvents.has(eventType)) {
      logger.info('Received unsupported event type', { eventType });
      // Don't treat as error, just log
    }

    // Validate payload structure
    if (!payload || typeof payload !== 'object') {
      errors.push('Invalid payload structure');
    }

    return errors;
  }

  /**
   * Generate deduplication key
   */
  private generateDedupKey(eventType: string, deliveryId: string, payload: any): string {
    // Create a unique key based on event type, delivery ID, and key payload fields
    const keyComponents = [
      eventType,
      deliveryId,
      payload.action || '',
      payload.repository?.full_name || '',
      payload.workflow_job?.id || '',
      payload.workflow_run?.id || '',
      payload.pull_request?.id || '',
      payload.issue?.id || ''
    ].filter(Boolean);

    return crypto
      .createHash('sha256')
      .update(keyComponents.join(':'))
      .digest('hex');
  }

  /**
   * Check if event is duplicate
   */
  private isDuplicate(dedupKey: string): boolean {
    return this.processingCache.has(dedupKey);
  }

  /**
   * Mark event as processed in dedup cache
   */
  private markAsProcessed(dedupKey: string): void {
    this.processingCache.set(dedupKey, new Date());
  }

  /**
   * Clean up expired cache entries
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of this.processingCache.entries()) {
        if (now - timestamp.getTime() > this.cacheTTL) {
          this.processingCache.delete(key);
        }
      }
    }, 30000); // Clean up every 30 seconds
  }

  /**
   * Setup event handlers for all GitHub event types
   */
  private setupEventHandlers(): void {
    // Workflow events
    this.eventHandlers.set(GITHUB_EVENT_TYPES.WORKFLOW_JOB, this.handleWorkflowJobEvent.bind(this));
    this.eventHandlers.set(GITHUB_EVENT_TYPES.WORKFLOW_RUN, this.handleWorkflowRunEvent.bind(this));
    this.eventHandlers.set(GITHUB_EVENT_TYPES.WORKFLOW_DISPATCH, this.handleWorkflowDispatchEvent.bind(this));
    
    // Code events
    this.eventHandlers.set(GITHUB_EVENT_TYPES.PUSH, this.handlePushEvent.bind(this));
    this.eventHandlers.set(GITHUB_EVENT_TYPES.PULL_REQUEST, this.handlePullRequestEvent.bind(this));
    this.eventHandlers.set(GITHUB_EVENT_TYPES.CREATE, this.handleCreateEvent.bind(this));
    this.eventHandlers.set(GITHUB_EVENT_TYPES.DELETE, this.handleDeleteEvent.bind(this));
    
    // Deployment events
    this.eventHandlers.set(GITHUB_EVENT_TYPES.DEPLOYMENT, this.handleDeploymentEvent.bind(this));
    this.eventHandlers.set(GITHUB_EVENT_TYPES.DEPLOYMENT_STATUS, this.handleDeploymentStatusEvent.bind(this));
    
    // Security events
    this.eventHandlers.set(GITHUB_EVENT_TYPES.CODE_SCANNING_ALERT, this.handleSecurityEvent.bind(this));
    this.eventHandlers.set(GITHUB_EVENT_TYPES.SECRET_SCANNING_ALERT, this.handleSecurityEvent.bind(this));
    this.eventHandlers.set(GITHUB_EVENT_TYPES.SECURITY_ADVISORY, this.handleSecurityEvent.bind(this));
    
    // Repository events
    this.eventHandlers.set(GITHUB_EVENT_TYPES.RELEASE, this.handleReleaseEvent.bind(this));
    this.eventHandlers.set(GITHUB_EVENT_TYPES.REPOSITORY, this.handleRepositoryEvent.bind(this));
    
    // Admin events
    this.eventHandlers.set(GITHUB_EVENT_TYPES.PING, this.handlePingEvent.bind(this));
  }

  /**
   * Handle webhook event with appropriate handler
   */
  private async handleWebhookEvent(webhookEvent: WebhookEvent): Promise<void> {
    const handler = this.eventHandlers.get(webhookEvent.event);
    
    if (handler) {
      await handler(webhookEvent);
    } else {
      // Generic handler for unhandled events
      await this.handleGenericEvent(webhookEvent);
    }

    // Always emit event for listeners
    this.emit('webhook-event', webhookEvent);
    this.emit(`webhook:${webhookEvent.event}`, webhookEvent);
  }

  /**
   * Handle workflow job events
   */
  private async handleWorkflowJobEvent(webhookEvent: WebhookEvent): Promise<void> {
    const jobEvent = webhookEvent.payload as WorkflowJobEvent;
    const job = jobEvent.workflow_job;

    logger.info('Processing workflow job event', {
      action: jobEvent.action,
      jobId: job.id,
      jobName: job.name,
      repository: jobEvent.repository.full_name,
      labels: job.labels,
      workflowName: job.workflow_name
    });

    switch (jobEvent.action) {
      case 'queued':
        await this.handleJobQueued(jobEvent);
        break;
      
      case 'in_progress':
        await this.handleJobInProgress(jobEvent);
        break;
      
      case 'completed':
        await this.handleJobCompleted(jobEvent);
        break;
    }

    // Emit specific workflow job event
    this.emit('workflow-job', {
      action: jobEvent.action,
      job,
      repository: jobEvent.repository,
      sender: jobEvent.sender
    });
  }

  /**
   * Handle queued workflow job
   */
  private async handleJobQueued(jobEvent: WorkflowJobEvent): Promise<void> {
    const job = jobEvent.workflow_job;
    
    try {
      // Store job information
      await database.query(
        `INSERT INTO runnerhub.jobs 
         (job_id, run_id, repository, job_name, status, labels, workflow_name, 
          head_sha, job_url, queued_at, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (job_id) DO UPDATE SET
         status = $5, labels = $6, workflow_name = $7, queued_at = $10, priority = $11`,
        [
          job.id.toString(),
          job.run_id.toString(),
          jobEvent.repository.full_name,
          job.name,
          'queued',
          JSON.stringify(job.labels),
          job.workflow_name || 'unknown',
          job.head_sha,
          job.html_url,
          new Date(),
          this.calculateJobPriority(job.labels, jobEvent.repository)
        ]
      );

      // Create job in queue
      const jobData = {
        jobId: job.id.toString(),
        runId: job.run_id.toString(),
        repository: jobEvent.repository.full_name,
        labels: job.labels,
        headSha: job.head_sha,
        jobName: job.name,
        workflowName: job.workflow_name,
        jobUrl: job.html_url,
        queuedAt: new Date(),
        priority: this.calculateJobPriority(job.labels, jobEvent.repository)
      };

      // Add to job queue
      await jobQueue.queue.add('process-github-job', jobData, {
        priority: jobData.priority,
        delay: 0,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });

      // Request runner from pool
      const runnerRequest = await runnerPoolManager.requestRunner(
        jobEvent.repository.full_name,
        job.labels
      );
      
      logger.info('Requested runner for job', {
        repository: jobEvent.repository.full_name,
        jobId: job.id.toString(),
        requestId: runnerRequest.id,
        assignedRunner: runnerRequest.runner?.id
      });

      // Emit real-time update
      this.emitJobUpdate('queued', job, jobEvent.repository);

    } catch (error) {
      logger.error('Failed to handle queued job', {
        jobId: job.id,
        error
      });
      throw error;
    }
  }

  /**
   * Handle in-progress workflow job
   */
  private async handleJobInProgress(jobEvent: WorkflowJobEvent): Promise<void> {
    const job = jobEvent.workflow_job;
    
    try {
      // Update job status
      await database.query(
        `UPDATE runnerhub.jobs 
         SET status = $1, started_at = $2, runner_id = $3, runner_name = $4
         WHERE job_id = $5`,
        ['in_progress', job.started_at, job.runner_id, job.runner_name, job.id.toString()]
      );

      // Update runner status
      if (job.runner_id) {
        await database.query(
          `UPDATE runnerhub.runners 
           SET status = $1, current_job_id = $2, updated_at = CURRENT_TIMESTAMP
           WHERE runner_id = $3`,
          ['busy', job.id.toString(), job.runner_id.toString()]
        );
      }

      // Emit real-time update
      this.emitJobUpdate('in_progress', job, jobEvent.repository);

      logger.info('Job started', {
        jobId: job.id,
        runnerId: job.runner_id,
        runnerName: job.runner_name
      });

    } catch (error) {
      logger.error('Failed to handle job in progress', {
        jobId: job.id,
        error
      });
      throw error;
    }
  }

  /**
   * Handle completed workflow job
   */
  private async handleJobCompleted(jobEvent: WorkflowJobEvent): Promise<void> {
    const job = jobEvent.workflow_job;
    
    try {
      // Calculate duration
      const duration = job.started_at && job.completed_at 
        ? new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
        : 0;

      // Update job status
      await database.query(
        `UPDATE runnerhub.jobs 
         SET status = $1, conclusion = $2, completed_at = $3, duration_ms = $4
         WHERE job_id = $5`,
        ['completed', job.conclusion, job.completed_at, duration, job.id.toString()]
      );

      // Release runner
      if (job.runner_id) {
        await runnerPoolManager.releaseRunner(job.runner_id.toString());
        
        logger.info('Released runner back to pool', {
          runnerId: job.runner_id.toString()
        });
      }

      // Record job metrics
      await monitoringService.recordJobCompletion({
        jobId: job.id.toString(),
        repository: jobEvent.repository.full_name,
        conclusion: job.conclusion || 'unknown',
        duration,
        runnerId: job.runner_id?.toString()
      });

      // Emit real-time update
      this.emitJobUpdate('completed', job, jobEvent.repository, {
        conclusion: job.conclusion,
        duration
      });

      logger.info('Job completed', {
        jobId: job.id,
        conclusion: job.conclusion,
        duration,
        runnerId: job.runner_id
      });

    } catch (error) {
      logger.error('Failed to handle job completion', {
        jobId: job.id,
        error
      });
      throw error;
    }
  }

  /**
   * Handle workflow run events
   */
  private async handleWorkflowRunEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    const workflowRun = payload.workflow_run;
    
    logger.info('Processing workflow run event', {
      action: payload.action,
      runId: workflowRun?.id,
      repository: payload.repository?.full_name,
      workflowName: workflowRun?.name,
      status: workflowRun?.status,
      conclusion: workflowRun?.conclusion
    });

    if (workflowRun) {
      try {
        await database.query(
          `INSERT INTO runnerhub.workflow_runs 
           (run_id, repository, workflow_name, head_branch, head_sha, 
            event, status, conclusion, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (run_id) DO UPDATE SET
           status = $7, conclusion = $8, updated_at = $10`,
          [
            workflowRun.id,
            payload.repository.full_name,
            workflowRun.name,
            workflowRun.head_branch,
            workflowRun.head_sha,
            workflowRun.event,
            workflowRun.status,
            workflowRun.conclusion,
            workflowRun.created_at,
            workflowRun.updated_at || new Date()
          ]
        );

        // Emit workflow run update
        this.emitWorkflowRunUpdate(payload.action, workflowRun, payload.repository);
      } catch (error) {
        logger.error('Failed to store workflow run', { error });
      }
    }
  }

  /**
   * Handle workflow dispatch events
   */
  private async handleWorkflowDispatchEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.info('Processing workflow dispatch event', {
      repository: payload.repository?.full_name,
      workflow: payload.workflow,
      ref: payload.ref,
      inputs: payload.inputs
    });

    // Pre-warm runners for manually triggered workflows
    if (payload.repository) {
      this.emit('workflow-dispatch', {
        repository: payload.repository,
        workflow: payload.workflow,
        ref: payload.ref,
        inputs: payload.inputs,
        sender: payload.sender
      });
    }
  }

  /**
   * Handle push events
   */
  private async handlePushEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.info('Processing push event', {
      repository: payload.repository?.full_name,
      ref: payload.ref,
      commits: payload.commits?.length,
      pusher: payload.pusher?.name
    });

    // Could trigger pre-warming of runners for expected workflow runs
    this.emit('push-event', {
      repository: payload.repository,
      ref: payload.ref,
      commits: payload.commits,
      pusher: payload.pusher,
      before: payload.before,
      after: payload.after
    });
  }

  /**
   * Handle pull request events
   */
  private async handlePullRequestEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.info('Processing pull request event', {
      action: payload.action,
      repository: payload.repository?.full_name,
      number: payload.pull_request?.number,
      title: payload.pull_request?.title,
      state: payload.pull_request?.state
    });

    // Could trigger runner pre-warming for PR workflows
    this.emit('pull-request-event', {
      action: payload.action,
      repository: payload.repository,
      pullRequest: payload.pull_request,
      sender: payload.sender
    });
  }

  /**
   * Handle create events (branches/tags)
   */
  private async handleCreateEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.info('Processing create event', {
      repository: payload.repository?.full_name,
      refType: payload.ref_type,
      ref: payload.ref,
      masterBranch: payload.master_branch
    });

    this.emit('create-event', {
      repository: payload.repository,
      refType: payload.ref_type,
      ref: payload.ref,
      sender: payload.sender
    });
  }

  /**
   * Handle delete events (branches/tags)
   */
  private async handleDeleteEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.info('Processing delete event', {
      repository: payload.repository?.full_name,
      refType: payload.ref_type,
      ref: payload.ref
    });

    this.emit('delete-event', {
      repository: payload.repository,
      refType: payload.ref_type,
      ref: payload.ref,
      sender: payload.sender
    });
  }

  /**
   * Handle deployment events
   */
  private async handleDeploymentEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.info('Processing deployment event', {
      action: payload.action,
      repository: payload.repository?.full_name,
      environment: payload.deployment?.environment,
      ref: payload.deployment?.ref
    });

    // Could trigger special deployment runners
    this.emit('deployment-event', {
      action: payload.action,
      repository: payload.repository,
      deployment: payload.deployment,
      sender: payload.sender
    });
  }

  /**
   * Handle deployment status events
   */
  private async handleDeploymentStatusEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.info('Processing deployment status event', {
      repository: payload.repository?.full_name,
      state: payload.deployment_status?.state,
      environment: payload.deployment?.environment
    });

    this.emit('deployment-status-event', {
      repository: payload.repository,
      deployment: payload.deployment,
      deploymentStatus: payload.deployment_status,
      sender: payload.sender
    });
  }

  /**
   * Handle security events
   */
  private async handleSecurityEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.warn('Processing security event', {
      event: webhookEvent.event,
      action: payload.action,
      repository: payload.repository?.full_name,
      alert: payload.alert
    });

    // Important security events should be handled with care
    this.emit('security-event', {
      type: webhookEvent.event,
      action: payload.action,
      repository: payload.repository,
      alert: payload.alert,
      sender: payload.sender
    });
  }

  /**
   * Handle release events
   */
  private async handleReleaseEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.info('Processing release event', {
      action: payload.action,
      repository: payload.repository?.full_name,
      tagName: payload.release?.tag_name,
      name: payload.release?.name,
      prerelease: payload.release?.prerelease
    });

    this.emit('release-event', {
      action: payload.action,
      repository: payload.repository,
      release: payload.release,
      sender: payload.sender
    });
  }

  /**
   * Handle repository events
   */
  private async handleRepositoryEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.info('Processing repository event', {
      action: payload.action,
      repository: payload.repository?.full_name
    });

    this.emit('repository-event', {
      action: payload.action,
      repository: payload.repository,
      sender: payload.sender
    });
  }

  /**
   * Handle ping events
   */
  private async handlePingEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.info('Received ping event', {
      repository: payload.repository?.full_name,
      hookId: payload.hook_id,
      zen: payload.zen
    });

    this.emit('ping-event', payload);
  }

  /**
   * Handle generic/unknown events
   */
  private async handleGenericEvent(webhookEvent: WebhookEvent): Promise<void> {
    logger.debug('Processing generic event', {
      event: webhookEvent.event,
      action: webhookEvent.payload.action,
      repository: webhookEvent.payload.repository?.full_name
    });

    this.emit('generic-event', {
      type: webhookEvent.event,
      payload: webhookEvent.payload
    });
  }

  /**
   * Emit real-time job update via WebSocket
   */
  private emitJobUpdate(
    action: string,
    job: any,
    repository: any,
    additional?: any
  ): void {
    if (!this.io) return;

    const update = {
      type: 'job-update',
      action,
      job: {
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        labels: job.labels,
        runnerId: job.runner_id,
        runnerName: job.runner_name
      },
      repository: {
        fullName: repository.full_name,
        name: repository.name
      },
      timestamp: new Date(),
      ...additional
    };

    // Emit to all connected clients
    this.io.emit('webhook:job-update', update);
    
    // Emit to repository-specific room
    this.io.to(`repo:${repository.full_name}`).emit('job-update', update);
  }

  /**
   * Emit workflow run update via WebSocket
   */
  private emitWorkflowRunUpdate(
    action: string,
    workflowRun: any,
    repository: any
  ): void {
    if (!this.io) return;

    const update = {
      type: 'workflow-run-update',
      action,
      workflowRun: {
        id: workflowRun.id,
        name: workflowRun.name,
        status: workflowRun.status,
        conclusion: workflowRun.conclusion,
        event: workflowRun.event,
        headBranch: workflowRun.head_branch
      },
      repository: {
        fullName: repository.full_name,
        name: repository.name
      },
      timestamp: new Date()
    };

    // Emit to all connected clients
    this.io.emit('webhook:workflow-run-update', update);
    
    // Emit to repository-specific room
    this.io.to(`repo:${repository.full_name}`).emit('workflow-run-update', update);
  }

  /**
   * Emit generic webhook update via WebSocket
   */
  private emitWebSocketUpdate(webhookEvent: WebhookEvent): void {
    if (!this.io) return;

    const update = {
      type: 'webhook-event',
      event: webhookEvent.event,
      action: webhookEvent.payload.action,
      repository: webhookEvent.repository,
      deliveryId: webhookEvent.deliveryId,
      timestamp: webhookEvent.timestamp
    };

    // Emit to all connected clients
    this.io.emit('webhook:event', update);
    
    // Emit event-specific update
    this.io.emit(`webhook:${webhookEvent.event}`, update);
    
    // Emit to repository-specific room
    if (webhookEvent.repository && webhookEvent.repository !== 'unknown') {
      this.io.to(`repo:${webhookEvent.repository}`).emit('webhook-event', update);
    }
  }

  /**
   * Calculate job priority based on labels and repository
   */
  private calculateJobPriority(labels: string[], repository: any): number {
    let priority = 0;

    // Production deployments (highest priority)
    if (labels.some(l => ['production', 'prod', 'deploy-prod'].includes(l))) {
      priority += 100;
    }

    // Staging deployments
    if (labels.some(l => ['staging', 'stage', 'deploy-staging'].includes(l))) {
      priority += 75;
    }

    // Critical or urgent labels
    if (labels.some(l => ['critical', 'urgent', 'hotfix'].includes(l))) {
      priority += 50;
    }

    // CI/CD labels
    if (labels.some(l => ['ci', 'cd', 'build', 'test'].includes(l))) {
      priority += 20;
    }

    // Smaller runners (faster allocation)
    if (labels.some(l => ['ubuntu-latest', 'ubuntu-22.04', 'ubuntu-20.04', 'small'].includes(l))) {
      priority += 10;
    }

    // Larger runners (slower allocation)
    if (labels.some(l => ['large', 'xlarge', 'xl', '2xlarge'].includes(l))) {
      priority -= 10;
    }

    // Repository importance (could be configured)
    if (repository.private) {
      priority += 5; // Prioritize private repos slightly
    }

    return priority;
  }

  /**
   * Verify webhook signature
   */
  private verifySignature(payload: any, signature: string): boolean {
    if (!this.webhookSecret) {
      return true; // Skip verification if no secret configured
    }

    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', this.webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex')}`;

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      logger.error('Error verifying signature', { error });
      return false;
    }
  }

  /**
   * Record webhook processing metrics
   */
  private async recordWebhookMetrics(
    eventType: string,
    success: boolean,
    processingTimeMs: number
  ): Promise<void> {
    try {
      // Record to monitoring service
      await monitoringService.recordWebhookProcessed(
        eventType,
        success,
        processingTimeMs
      );

      // Could also update database metrics table
      await database.query(
        `INSERT INTO runnerhub.webhook_metrics 
         (event_type, success, processing_time_ms, recorded_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [eventType, success, processingTimeMs]
      );
    } catch (error) {
      logger.error('Failed to record webhook metrics', { error });
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for critical events that might need special handling
    this.on('security-event', (data) => {
      logger.warn('Security event detected', data);
      // Could trigger alerts or special handling
    });

    this.on('deployment-event', (data) => {
      logger.info('Deployment event detected', data);
      // Could trigger deployment-specific runners
    });
  }

  /**
   * Ensure webhook tables exist with enhanced schema
   */
  private async ensureWebhookTables(): Promise<void> {
    try {
      await database.query(`
        CREATE TABLE IF NOT EXISTS runnerhub.webhook_events (
          id VARCHAR(255) PRIMARY KEY,
          repository VARCHAR(255) NOT NULL,
          event VARCHAR(100) NOT NULL,
          action VARCHAR(100),
          payload JSONB NOT NULL,
          signature VARCHAR(255),
          delivery_id VARCHAR(255) NOT NULL,
          timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          processed BOOLEAN NOT NULL DEFAULT FALSE,
          processing_attempts INTEGER NOT NULL DEFAULT 0,
          last_processing_error TEXT,
          processing_duration_ms INTEGER,
          dedup_key VARCHAR(255),
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_webhook_events_repository 
        ON runnerhub.webhook_events(repository);
        
        CREATE INDEX IF NOT EXISTS idx_webhook_events_event 
        ON runnerhub.webhook_events(event);
        
        CREATE INDEX IF NOT EXISTS idx_webhook_events_timestamp 
        ON runnerhub.webhook_events(timestamp);
        
        CREATE INDEX IF NOT EXISTS idx_webhook_events_dedup_key 
        ON runnerhub.webhook_events(dedup_key);
        
        CREATE INDEX IF NOT EXISTS idx_webhook_events_processed 
        ON runnerhub.webhook_events(processed);

        CREATE TABLE IF NOT EXISTS runnerhub.workflow_runs (
          run_id BIGINT PRIMARY KEY,
          repository VARCHAR(255) NOT NULL,
          workflow_name VARCHAR(255) NOT NULL,
          head_branch VARCHAR(255),
          head_sha VARCHAR(255),
          event VARCHAR(100),
          status VARCHAR(100),
          conclusion VARCHAR(100),
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_workflow_runs_repository 
        ON runnerhub.workflow_runs(repository);
        
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status 
        ON runnerhub.workflow_runs(status);

        CREATE TABLE IF NOT EXISTS runnerhub.webhook_metrics (
          id SERIAL PRIMARY KEY,
          event_type VARCHAR(100) NOT NULL,
          success BOOLEAN NOT NULL,
          processing_time_ms INTEGER NOT NULL,
          recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_webhook_metrics_event_type 
        ON runnerhub.webhook_metrics(event_type);
        
        CREATE INDEX IF NOT EXISTS idx_webhook_metrics_recorded_at 
        ON runnerhub.webhook_metrics(recorded_at);
      `);

      logger.info('Webhook tables created/verified');
    } catch (error) {
      logger.error('Failed to create webhook tables', { error });
      throw error;
    }
  }

  /**
   * Store webhook event in database
   */
  private async storeWebhookEvent(webhookEvent: WebhookEvent): Promise<void> {
    try {
      await database.query(
        `INSERT INTO runnerhub.webhook_events 
         (id, repository, event, action, payload, signature, delivery_id, 
          timestamp, processed, processing_attempts, dedup_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
         processing_attempts = runnerhub.webhook_events.processing_attempts + 1,
         updated_at = CURRENT_TIMESTAMP`,
        [
          webhookEvent.id,
          webhookEvent.repository,
          webhookEvent.event,
          webhookEvent.action,
          JSON.stringify(webhookEvent.payload),
          webhookEvent.signature,
          webhookEvent.deliveryId,
          webhookEvent.timestamp,
          webhookEvent.processed,
          webhookEvent.processingAttempts,
          webhookEvent.dedupKey
        ]
      );
    } catch (error) {
      logger.error('Failed to store webhook event', { error });
      throw error;
    }
  }

  /**
   * Mark webhook as processed
   */
  private async markWebhookProcessed(
    deliveryId: string,
    success: boolean,
    processingDurationMs: number,
    error?: string
  ): Promise<void> {
    try {
      await database.query(
        `UPDATE runnerhub.webhook_events 
         SET processed = $1, processing_duration_ms = $2, 
             last_processing_error = $3, updated_at = CURRENT_TIMESTAMP
         WHERE delivery_id = $4`,
        [success, processingDurationMs, error || null, deliveryId]
      );
    } catch (error) {
      logger.error('Failed to mark webhook as processed', { error });
    }
  }

  /**
   * Get webhook events with enhanced filtering
   */
  async getWebhookEvents(options: {
    repository?: string;
    event?: string;
    action?: string;
    processed?: boolean;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}): Promise<WebhookEvent[]> {
    const { 
      repository, 
      event, 
      action,
      processed,
      startDate,
      endDate,
      limit = 100, 
      offset = 0 
    } = options;

    let query = 'SELECT * FROM runnerhub.webhook_events WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (repository) {
      query += ` AND repository = $${paramIndex}`;
      params.push(repository);
      paramIndex++;
    }

    if (event) {
      query += ` AND event = $${paramIndex}`;
      params.push(event);
      paramIndex++;
    }

    if (action) {
      query += ` AND action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }

    if (processed !== undefined) {
      query += ` AND processed = $${paramIndex}`;
      params.push(processed);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND timestamp >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND timestamp <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await database.query(query, params);
    
    return result.map((row: any) => ({
      id: row.id,
      repository: row.repository,
      event: row.event,
      action: row.action,
      payload: row.payload,
      signature: row.signature,
      deliveryId: row.delivery_id,
      timestamp: row.timestamp,
      processed: row.processed,
      processingAttempts: row.processing_attempts,
      lastProcessingError: row.last_processing_error,
      processingDurationMs: row.processing_duration_ms,
      dedupKey: row.dedup_key
    }));
  }

  /**
   * Get webhook statistics with enhanced metrics
   */
  async getWebhookStatistics(hours: number = 24): Promise<WebhookEventStats[]> {
    const result = await database.query(
      `SELECT 
         event,
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE processed = true) as processed,
         COUNT(*) FILTER (WHERE processed = false) as pending,
         COUNT(*) FILTER (WHERE last_processing_error IS NOT NULL) as failed,
         AVG(processing_duration_ms) FILTER (WHERE processing_duration_ms IS NOT NULL) as avg_processing_time_ms,
         MAX(timestamp) FILTER (WHERE processed = true) as last_processed_at
       FROM runnerhub.webhook_events 
       WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '${hours} hours'
       GROUP BY event
       ORDER BY total DESC`
    );

    return result.map((row: any) => ({
      event: row.event,
      total: parseInt(row.total),
      processed: parseInt(row.processed),
      pending: parseInt(row.pending),
      failed: parseInt(row.failed),
      avgProcessingTimeMs: parseFloat(row.avg_processing_time_ms) || 0,
      lastProcessedAt: row.last_processed_at
    }));
  }

  /**
   * Replay webhook event
   */
  async replayWebhook(deliveryId: string): Promise<WebhookProcessingResult> {
    try {
      // Fetch the webhook event
      const events = await database.query(
        'SELECT * FROM runnerhub.webhook_events WHERE delivery_id = $1',
        [deliveryId]
      );

      if (events.length === 0) {
        return {
          success: false,
          message: 'Webhook event not found',
          processed: false
        };
      }

      const event = events[0];
      
      // Clear from dedup cache to allow replay
      if (event.dedup_key) {
        this.processingCache.delete(event.dedup_key);
      }

      // Replay the webhook
      return await this.processWebhook(
        {} as Request, // Empty request for replay
        event.event,
        event.signature,
        event.delivery_id,
        event.payload
      );
    } catch (error) {
      logger.error('Failed to replay webhook', { deliveryId, error });
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        processed: false
      };
    }
  }

  /**
   * Get failed webhooks for retry
   */
  async getFailedWebhooks(limit: number = 10): Promise<WebhookEvent[]> {
    const result = await database.query(
      `SELECT * FROM runnerhub.webhook_events 
       WHERE processed = false 
       AND last_processing_error IS NOT NULL
       AND processing_attempts < 3
       ORDER BY timestamp DESC 
       LIMIT $1`,
      [limit]
    );

    return result.map((row: any) => ({
      id: row.id,
      repository: row.repository,
      event: row.event,
      action: row.action,
      payload: row.payload,
      signature: row.signature,
      deliveryId: row.delivery_id,
      timestamp: row.timestamp,
      processed: row.processed,
      processingAttempts: row.processing_attempts,
      lastProcessingError: row.last_processing_error,
      processingDurationMs: row.processing_duration_ms,
      dedupKey: row.dedup_key
    }));
  }

  /**
   * Retry failed webhooks
   */
  async retryFailedWebhooks(): Promise<{ total: number; succeeded: number; failed: number }> {
    const failedWebhooks = await this.getFailedWebhooks(50);
    let succeeded = 0;
    let failed = 0;

    for (const webhook of failedWebhooks) {
      try {
        const result = await this.replayWebhook(webhook.deliveryId);
        if (result.success) {
          succeeded++;
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
        logger.error('Failed to retry webhook', { 
          deliveryId: webhook.deliveryId, 
          error 
        });
      }
    }

    return {
      total: failedWebhooks.length,
      succeeded,
      failed
    };
  }

  /**
   * Shutdown the webhook service
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down enhanced GitHub webhook service');
    this.removeAllListeners();
    this.processingCache.clear();
  }
}

export default GitHubWebhookEnhancedService.getInstance();