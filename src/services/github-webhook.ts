import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createLogger } from '../utils/logger';
import database from './database';
import jobQueue from './job-queue';
import runnerPoolManager from './runner-pool-manager';
import monitoringService from './monitoring';
import { Request } from 'express';

const logger = createLogger('GitHubWebhook');

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
    conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
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
      gravatar_id: string;
      url: string;
      html_url: string;
      type: string;
      site_admin: boolean;
    };
  };
  organization?: {
    login: string;
    id: number;
    node_id: string;
    url: string;
    repos_url: string;
    events_url: string;
    hooks_url: string;
    issues_url: string;
    members_url: string;
    public_members_url: string;
    avatar_url: string;
    description: string;
  };
}

export interface PingEvent {
  zen: string;
  hook_id: number;
  hook: {
    type: string;
    id: number;
    name: string;
    active: boolean;
    events: string[];
    config: {
      content_type: string;
      insecure_ssl: string;
      url: string;
    };
    updated_at: string;
    created_at: string;
    url: string;
    test_url: string;
    ping_url: string;
    last_response: {
      code: number | null;
      status: string;
      message: string | null;
    };
  };
  repository: {
    id: number;
    node_id: string;
    name: string;
    full_name: string;
    private: boolean;
  };
}

export class GitHubWebhookService extends EventEmitter {
  private static instance: GitHubWebhookService;
  private webhookSecret: string;
  private supportedEvents: Set<string> = new Set([
    'workflow_job',
    'workflow_run',
    'push',
    'pull_request',
    'ping'
  ]);

  private constructor() {
    super();
    this.webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || '';
    
    if (!this.webhookSecret) {
      logger.warn('No GitHub webhook secret configured - webhook signature verification disabled');
    }
  }

  public static getInstance(): GitHubWebhookService {
    if (!GitHubWebhookService.instance) {
      GitHubWebhookService.instance = new GitHubWebhookService();
    }
    return GitHubWebhookService.instance;
  }

  /**
   * Initialize the webhook service
   */
  async initialize(): Promise<void> {
    logger.info('Initializing GitHub webhook service');

    try {
      // Set up event listeners
      this.setupEventListeners();

      // Create webhook events table if it doesn't exist
      await this.ensureWebhookTable();

      logger.info('GitHub webhook service initialized');
    } catch (error) {
      logger.error('Failed to initialize GitHub webhook service', { error });
      throw error;
    }
  }

  /**
   * Process incoming webhook
   */
  async processWebhook(
    _req: Request,
    eventType: string,
    signature: string,
    deliveryId: string,
    payload: any
  ): Promise<{ success: boolean; message: string }> {
    const startTime = Date.now();

    try {
      // Verify signature if secret is configured
      if (this.webhookSecret && !this.verifySignature(payload, signature)) {
        logger.warn('Invalid webhook signature', { deliveryId, eventType });
        return {
          success: false,
          message: 'Invalid signature'
        };
      }

      // Check if event type is supported
      if (!this.supportedEvents.has(eventType)) {
        logger.debug('Unsupported event type', { eventType });
        return {
          success: true,
          message: `Event type ${eventType} not supported`
        };
      }

      // Create webhook event record
      const webhookEvent: WebhookEvent = {
        id: deliveryId,
        repository: payload.repository?.full_name || 'unknown',
        event: eventType,
        action: payload.action,
        payload,
        signature,
        deliveryId,
        timestamp: new Date(),
        processed: false
      };

      // Store webhook event
      await this.storeWebhookEvent(webhookEvent);

      // Process the event
      await this.handleWebhookEvent(webhookEvent);

      // Update processing status
      await this.markWebhookProcessed(deliveryId);

      // Record monitoring metrics (simplified for now)
      // TODO: Add webhook-specific monitoring methods
      logger.debug('Webhook processed successfully', {
        event: eventType,
        action: payload.action,
        repository: webhookEvent.repository,
        processingTime: Date.now() - startTime
      });

      logger.info('Webhook processed successfully', {
        deliveryId,
        eventType,
        action: payload.action,
        repository: webhookEvent.repository,
        processingTime: Date.now() - startTime
      });

      return {
        success: true,
        message: 'Webhook processed successfully'
      };

    } catch (error) {
      logger.error('Failed to process webhook', {
        deliveryId,
        eventType,
        error
      });

      // Record error metrics (simplified for now)
      logger.error('Webhook processing error', {
        event: eventType,
        action: payload.action,
        repository: payload.repository?.full_name || 'unknown',
        processingTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle specific webhook event types
   */
  private async handleWebhookEvent(webhookEvent: WebhookEvent): Promise<void> {
    switch (webhookEvent.event) {
      case 'workflow_job':
        await this.handleWorkflowJobEvent(webhookEvent);
        break;
      
      case 'workflow_run':
        await this.handleWorkflowRunEvent(webhookEvent);
        break;
      
      case 'push':
        await this.handlePushEvent(webhookEvent);
        break;
      
      case 'pull_request':
        await this.handlePullRequestEvent(webhookEvent);
        break;
      
      case 'ping':
        await this.handlePingEvent(webhookEvent);
        break;
      
      default:
        logger.debug('Unhandled event type', { event: webhookEvent.event });
    }

    // Emit event for other components to listen
    this.emit('webhook-event', webhookEvent);
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
      labels: job.labels
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
      repository: jobEvent.repository
    });
  }

  /**
   * Handle queued workflow job
   */
  private async handleJobQueued(jobEvent: WorkflowJobEvent): Promise<void> {
    const job = jobEvent.workflow_job;
    
    try {
      // Create job in queue for processing
      const jobData = {
        jobId: job.id.toString(),
        runId: job.run_id.toString(),
        repository: jobEvent.repository.full_name,
        labels: job.labels,
        headSha: job.head_sha,
        jobName: job.name,
        jobUrl: job.html_url,
        queuedAt: new Date(),
        priority: this.calculateJobPriority(job.labels, jobEvent.repository)
      };

      // Add to job queue (using BullMQ add method)
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

      logger.info('Job queued for processing', {
        jobId: job.id,
        repository: jobEvent.repository.full_name,
        labels: job.labels
      });

    } catch (error) {
      logger.error('Failed to handle queued job', {
        jobId: job.id,
        error
      });
    }
  }

  /**
   * Handle in-progress workflow job
   */
  private async handleJobInProgress(jobEvent: WorkflowJobEvent): Promise<void> {
    const job = jobEvent.workflow_job;
    
    try {
      // Update job status in database
      await database.query(
        `UPDATE runnerhub.jobs 
         SET status = $1, started_at = $2, runner_id = $3, runner_name = $4
         WHERE job_id = $5`,
        ['in_progress', job.started_at, job.runner_id, job.runner_name, job.id.toString()]
      );

      // Update runner status if we have runner info
      if (job.runner_id) {
        await database.query(
          `UPDATE runnerhub.runners 
           SET status = $1, current_job_id = $2, updated_at = CURRENT_TIMESTAMP
           WHERE runner_id = $3`,
          ['busy', job.id.toString(), job.runner_id.toString()]
        );
      }

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
    }
  }

  /**
   * Handle completed workflow job
   */
  private async handleJobCompleted(jobEvent: WorkflowJobEvent): Promise<void> {
    const job = jobEvent.workflow_job;
    
    try {
      // Update job status in database
      await database.query(
        `UPDATE runnerhub.jobs 
         SET status = $1, conclusion = $2, completed_at = $3
         WHERE job_id = $4`,
        ['completed', job.conclusion, job.completed_at, job.id.toString()]
      );

      // Release runner back to pool
      if (job.runner_id) {
        await runnerPoolManager.releaseRunner(job.runner_id.toString());
        
        logger.info('Released runner back to pool', {
          runnerId: job.runner_id.toString()
        });
      }

      // Record job metrics
      const duration = job.started_at && job.completed_at 
        ? new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
        : 0;

      // Record job completion in monitoring service
      await monitoringService.recordJobCompletion({
        jobId: job.id.toString(),
        repository: jobEvent.repository.full_name,
        conclusion: job.conclusion || 'unknown',
        duration,
        runnerId: job.runner_id?.toString()
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
    }
  }

  /**
   * Handle workflow run events
   */
  private async handleWorkflowRunEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.debug('Processing workflow run event', {
      action: payload.action,
      runId: payload.workflow_run?.id,
      repository: payload.repository?.full_name
    });

    // Store workflow run information for tracking
    if (payload.workflow_run) {
      try {
        await database.query(
          `INSERT INTO runnerhub.workflow_runs 
           (run_id, repository, workflow_name, head_branch, head_sha, 
            event, status, conclusion, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (run_id) DO UPDATE SET
           status = $7, conclusion = $8, updated_at = $10`,
          [
            payload.workflow_run.id,
            payload.repository.full_name,
            payload.workflow_run.name,
            payload.workflow_run.head_branch,
            payload.workflow_run.head_sha,
            payload.workflow_run.event,
            payload.workflow_run.status,
            payload.workflow_run.conclusion,
            payload.workflow_run.created_at,
            payload.workflow_run.updated_at
          ]
        );
      } catch (error) {
        logger.error('Failed to store workflow run', { error });
      }
    }
  }

  /**
   * Handle push events
   */
  private async handlePushEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.debug('Processing push event', {
      repository: payload.repository?.full_name,
      ref: payload.ref,
      commits: payload.commits?.length
    });

    // Could trigger pre-warming of runners for expected workflow runs
    this.emit('push-event', {
      repository: payload.repository,
      ref: payload.ref,
      commits: payload.commits
    });
  }

  /**
   * Handle pull request events
   */
  private async handlePullRequestEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload;
    
    logger.debug('Processing pull request event', {
      action: payload.action,
      repository: payload.repository?.full_name,
      number: payload.pull_request?.number
    });

    // Could trigger runner pre-warming for PR workflows
    this.emit('pull-request-event', {
      action: payload.action,
      repository: payload.repository,
      pullRequest: payload.pull_request
    });
  }

  /**
   * Handle ping events
   */
  private async handlePingEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload as PingEvent;
    
    logger.info('Received ping event', {
      repository: payload.repository?.full_name,
      hookId: payload.hook_id,
      zen: payload.zen
    });

    this.emit('ping-event', payload);
  }

  /**
   * Calculate job priority based on labels and repository
   */
  private calculateJobPriority(labels: string[], _repository: any): number {
    let priority = 0;

    // Higher priority for production deployments
    if (labels.includes('production') || labels.includes('deploy')) {
      priority += 100;
    }

    // Higher priority for critical or urgent labels
    if (labels.includes('critical') || labels.includes('urgent')) {
      priority += 50;
    }

    // Higher priority for smaller runners (faster allocation)
    if (labels.includes('ubuntu-latest') || labels.includes('small')) {
      priority += 10;
    }

    // Lower priority for larger runners
    if (labels.includes('large') || labels.includes('xl')) {
      priority -= 10;
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

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    const actualSignature = signature.replace('sha256=', '');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(actualSignature, 'hex')
    );
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    // TODO: Set up event listeners when runner pool manager supports events
    logger.debug('Event listeners setup (placeholder)');
  }

  /**
   * Ensure webhook events table exists
   */
  private async ensureWebhookTable(): Promise<void> {
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
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_webhook_events_repository 
        ON runnerhub.webhook_events(repository);
        
        CREATE INDEX IF NOT EXISTS idx_webhook_events_event 
        ON runnerhub.webhook_events(event);
        
        CREATE INDEX IF NOT EXISTS idx_webhook_events_timestamp 
        ON runnerhub.webhook_events(timestamp);

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
      `);
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
         (id, repository, event, action, payload, signature, delivery_id, timestamp, processed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          webhookEvent.id,
          webhookEvent.repository,
          webhookEvent.event,
          webhookEvent.action,
          JSON.stringify(webhookEvent.payload),
          webhookEvent.signature,
          webhookEvent.deliveryId,
          webhookEvent.timestamp,
          webhookEvent.processed
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
  private async markWebhookProcessed(deliveryId: string): Promise<void> {
    try {
      await database.query(
        'UPDATE runnerhub.webhook_events SET processed = TRUE WHERE delivery_id = $1',
        [deliveryId]
      );
    } catch (error) {
      logger.error('Failed to mark webhook as processed', { error });
    }
  }

  /**
   * Get webhook events
   */
  async getWebhookEvents(options: {
    repository?: string;
    event?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<WebhookEvent[]> {
    const { repository, event, limit = 100, offset = 0 } = options;

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
      processed: row.processed
    }));
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStatistics(hours: number = 24): Promise<any> {
    const result = await database.query(
      `SELECT 
         event,
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE processed = true) as processed,
         COUNT(*) FILTER (WHERE processed = false) as pending
       FROM runnerhub.webhook_events 
       WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '${hours} hours'
       GROUP BY event
       ORDER BY total DESC`
    );

    return result;
  }

  /**
   * Shutdown the webhook service
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down GitHub webhook service');
    this.removeAllListeners();
  }
}

export default GitHubWebhookService.getInstance();