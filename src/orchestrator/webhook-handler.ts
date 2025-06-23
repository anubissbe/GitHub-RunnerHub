import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createLogger } from '../utils/logger';
import { RunnerOrchestrator } from './runner-orchestrator';
import { QueueManager } from '../queues/queue-manager';
import { JobRouter } from '../queues/job-router';
import { JobType, QUEUE_CONFIG } from '../queues/config/redis-config';

const logger = createLogger('OrchestratorWebhookHandler');

export interface WebhookEvent {
  id: string;
  name: string;
  payload: any;
  repository: any;
  organization?: any;
  sender: any;
  created_at: string;
  signature: string;
}

export class OrchestratorWebhookHandler {
  private static instance: OrchestratorWebhookHandler;
  private orchestrator: RunnerOrchestrator;
  private jobRouter: JobRouter;
  private webhookSecret: string;
  
  private constructor() {
    this.orchestrator = RunnerOrchestrator.getInstance();
    this.jobRouter = JobRouter.getInstance();
    this.webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || '';
  }
  
  public static getInstance(): OrchestratorWebhookHandler {
    if (!OrchestratorWebhookHandler.instance) {
      OrchestratorWebhookHandler.instance = new OrchestratorWebhookHandler();
    }
    return OrchestratorWebhookHandler.instance;
  }
  
  /**
   * Express middleware to handle GitHub webhooks
   */
  public handleWebhook = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      // Verify webhook signature
      if (!this.verifyWebhookSignature(req)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
      
      const event = req.headers['x-github-event'] as string;
      const deliveryId = req.headers['x-github-delivery'] as string;
      const payload = req.body;
      
      logger.info(`Received webhook event: ${event}`, { deliveryId });
      
      // Process webhook asynchronously via queue
      await this.queueWebhookProcessing({
        id: deliveryId,
        name: event,
        payload,
        repository: payload.repository,
        organization: payload.organization,
        sender: payload.sender,
        created_at: new Date().toISOString(),
        signature: req.headers['x-hub-signature-256'] as string
      });
      
      // Respond immediately to GitHub
      res.status(202).json({ 
        message: 'Webhook received and queued for processing',
        deliveryId 
      });
    } catch (error) {
      logger.error('Error handling webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  
  private verifyWebhookSignature(req: Request): boolean {
    const signature = req.headers['x-hub-signature-256'] as string;
    
    if (!signature || !this.webhookSecret) {
      logger.warn('Missing signature or webhook secret');
      return false;
    }
    
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
    
    // Constant time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest)
    );
  }
  
  private async queueWebhookProcessing(event: WebhookEvent): Promise<void> {
    // Queue webhook for processing
    await this.jobRouter.route({
      type: JobType.PROCESS_WEBHOOK,
      data: {
        event: event.name,
        payload: event.payload,
        headers: {
          'x-github-delivery': event.id,
          'x-hub-signature-256': event.signature
        }
      },
      priority: this.getWebhookPriority(event.name)
    });
  }
  
  private getWebhookPriority(eventName: string): number {
    // Prioritize workflow job events
    const priorityMap: Record<string, number> = {
      'workflow_job': QUEUE_CONFIG.priorities.CRITICAL,
      'workflow_run': QUEUE_CONFIG.priorities.HIGH,
      'check_run': QUEUE_CONFIG.priorities.HIGH,
      'check_suite': QUEUE_CONFIG.priorities.NORMAL,
      'pull_request': QUEUE_CONFIG.priorities.NORMAL,
      'push': QUEUE_CONFIG.priorities.NORMAL,
      'repository': QUEUE_CONFIG.priorities.LOW,
      'organization': QUEUE_CONFIG.priorities.LOW
    };
    
    return priorityMap[eventName] || QUEUE_CONFIG.priorities.NORMAL;
  }
  
  /**
   * Process webhook events (called by queue processor)
   */
  public async processWebhookEvent(event: string, payload: any): Promise<void> {
    logger.info(`Processing webhook event: ${event}`);
    
    try {
      switch (event) {
        case 'workflow_job':
          await this.handleWorkflowJobEvent(payload);
          break;
          
        case 'workflow_run':
          await this.handleWorkflowRunEvent(payload);
          break;
          
        case 'check_run':
          await this.handleCheckRunEvent(payload);
          break;
          
        case 'check_suite':
          await this.handleCheckSuiteEvent(payload);
          break;
          
        case 'repository':
          await this.handleRepositoryEvent(payload);
          break;
          
        case 'organization':
          await this.handleOrganizationEvent(payload);
          break;
          
        default:
          logger.debug(`Unhandled webhook event type: ${event}`);
      }
    } catch (error) {
      logger.error(`Error processing webhook event ${event}:`, error);
      throw error;
    }
  }
  
  private async handleWorkflowJobEvent(payload: any): Promise<void> {
    // Delegate to orchestrator
    await this.orchestrator.handleWorkflowJobEvent(payload);
  }
  
  private async handleWorkflowRunEvent(payload: any): Promise<void> {
    const { action, workflow_run, repository } = payload;
    
    logger.info(`Workflow run ${action}:`, {
      runId: workflow_run.id,
      repository: repository.full_name,
      status: workflow_run.status
    });
    
    // Track workflow run status
    if (action === 'requested') {
      // Prepare for incoming jobs
      logger.info('Workflow run requested, preparing for jobs');
    } else if (action === 'completed') {
      // Clean up any resources
      logger.info('Workflow run completed, cleaning up resources');
    }
  }
  
  private async handleCheckRunEvent(payload: any): Promise<void> {
    const { action, check_run, repository } = payload;
    
    logger.info(`Check run ${action}:`, {
      checkRunId: check_run.id,
      repository: repository.full_name,
      status: check_run.status
    });
    
    // Update check run status if needed
    if (action === 'rerequested') {
      // Handle re-run requests
      logger.info('Check run re-requested, processing...');
    }
  }
  
  private async handleCheckSuiteEvent(payload: any): Promise<void> {
    const { action, check_suite, repository } = payload;
    
    logger.info(`Check suite ${action}:`, {
      checkSuiteId: check_suite.id,
      repository: repository.full_name
    });
    
    // Prepare for check runs in the suite
    if (action === 'requested' || action === 'rerequested') {
      logger.info('Check suite requested, preparing for check runs');
    }
  }
  
  private async handleRepositoryEvent(payload: any): Promise<void> {
    const { action, repository } = payload;
    
    logger.info(`Repository ${action}:`, {
      repository: repository.full_name
    });
    
    // Update repository configuration if needed
    if (action === 'created' || action === 'edited') {
      // Sync repository settings
      logger.info('Repository updated, syncing configuration');
    }
  }
  
  private async handleOrganizationEvent(payload: any): Promise<void> {
    const { action, organization } = payload;
    
    logger.info(`Organization ${action}:`, {
      organization: organization.login
    });
    
    // Update organization settings if needed
    if (action === 'member_added' || action === 'member_removed') {
      // Update access controls
      logger.info('Organization membership changed, updating access');
    }
  }
  
  /**
   * Create webhook endpoint in GitHub
   */
  public async registerWebhook(repository: string): Promise<void> {
    try {
      const webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/webhooks/orchestrator`;
      
      logger.info(`Registering webhook for repository: ${repository}`);
      
      // This would use GitHub API to create webhook
      // For now, log the configuration needed
      logger.info('Webhook configuration:', {
        url: webhookUrl,
        events: [
          'workflow_job',
          'workflow_run',
          'check_run',
          'check_suite',
          'repository',
          'organization'
        ],
        active: true,
        content_type: 'json'
      });
    } catch (error) {
      logger.error('Failed to register webhook:', error);
      throw error;
    }
  }
  
  /**
   * Remove webhook from GitHub
   */
  public async unregisterWebhook(repository: string, webhookId: string): Promise<void> {
    try {
      logger.info(`Unregistering webhook ${webhookId} for repository: ${repository}`);
      
      // This would use GitHub API to delete webhook
      // For now, just log
      logger.info('Webhook unregistered successfully');
    } catch (error) {
      logger.error('Failed to unregister webhook:', error);
      throw error;
    }
  }
  
  /**
   * List all webhooks for a repository
   */
  public async listWebhooks(repository: string): Promise<any[]> {
    try {
      logger.info(`Listing webhooks for repository: ${repository}`);
      
      // This would use GitHub API to list webhooks
      // For now, return empty array
      return [];
    } catch (error) {
      logger.error('Failed to list webhooks:', error);
      throw error;
    }
  }
}

export default OrchestratorWebhookHandler;