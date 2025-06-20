import { GitHubWebhookService } from '../../src/services/github-webhook';
import database from '../../src/services/database';
import jobQueue from '../../src/services/job-queue';
import runnerPoolManager from '../../src/services/runner-pool-manager';
import monitoringService from '../../src/services/monitoring';
import crypto from 'crypto';

// Mock dependencies
jest.mock('../../src/services/database');
jest.mock('../../src/services/job-queue');
jest.mock('../../src/services/runner-pool-manager');
jest.mock('../../src/services/monitoring');
jest.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

describe('GitHubWebhookService', () => {
  let webhookService: GitHubWebhookService;
  const mockRequest = {
    body: {},
    get: jest.fn()
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset singleton instance
    (GitHubWebhookService as any).instance = null;
    
    // Set up environment
    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
    
    // Get fresh instance
    webhookService = GitHubWebhookService.getInstance();
    
    // Mock database queries
    (database.query as jest.Mock).mockResolvedValue([]);
  });

  afterEach(async () => {
    await webhookService.shutdown();
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await webhookService.initialize();
      
      // Should create webhook tables
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS runnerhub.webhook_events')
      );
    });
  });

  describe('processWebhook', () => {
    const mockPayload = {
      repository: {
        full_name: 'test/repo'
      },
      action: 'queued'
    };

    beforeEach(async () => {
      await webhookService.initialize();
    });

    it('should process valid webhook with correct signature', async () => {
      const signature = crypto
        .createHmac('sha256', 'test-secret')
        .update(JSON.stringify(mockPayload))
        .digest('hex');

      const result = await webhookService.processWebhook(
        mockRequest,
        'ping',
        `sha256=${signature}`,
        'delivery-123',
        mockPayload
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Webhook processed successfully');
    });

    it('should reject webhook with invalid signature', async () => {
      const result = await webhookService.processWebhook(
        mockRequest,
        'ping',
        'sha256=invalid-signature',
        'delivery-123',
        mockPayload
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid signature');
    });

    it('should accept webhook when no secret is configured', async () => {
      delete process.env.GITHUB_WEBHOOK_SECRET;
      
      // Recreate service without secret
      (GitHubWebhookService as any).instance = null;
      webhookService = GitHubWebhookService.getInstance();
      await webhookService.initialize();

      const result = await webhookService.processWebhook(
        mockRequest,
        'ping',
        '',
        'delivery-123',
        mockPayload
      );

      expect(result.success).toBe(true);
    });

    it('should handle unsupported event types gracefully', async () => {
      const result = await webhookService.processWebhook(
        mockRequest,
        'unsupported-event',
        '',
        'delivery-123',
        mockPayload
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Event type unsupported-event not supported');
    });

    it('should store webhook events in database', async () => {
      await webhookService.processWebhook(
        mockRequest,
        'ping',
        '',
        'delivery-123',
        mockPayload
      );

      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO runnerhub.webhook_events'),
        expect.arrayContaining(['delivery-123', 'test/repo', 'ping'])
      );
    });
  });

  describe('workflow job events', () => {
    const mockWorkflowJobEvent = {
      action: 'queued',
      workflow_job: {
        id: 12345,
        run_id: 67890,
        name: 'test-job',
        status: 'queued',
        labels: ['ubuntu-latest', 'self-hosted'],
        head_sha: 'abc123',
        html_url: 'https://github.com/test/repo/actions/runs/67890/job/12345'
      },
      repository: {
        full_name: 'test/repo',
        private: false
      }
    };

    beforeEach(async () => {
      await webhookService.initialize();
      
      // Mock runner pool manager
      (runnerPoolManager.requestRunner as jest.Mock).mockResolvedValue({
        id: 'runner-request-123'
      });
      (runnerPoolManager.releaseRunner as jest.Mock).mockResolvedValue(undefined);
      
      // Mock job queue (BullMQ API)
      (jobQueue.queue.add as jest.Mock).mockResolvedValue({ id: 'job-123' });
    });

    it('should handle queued workflow job', async () => {
      const result = await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        '',
        'delivery-123',
        mockWorkflowJobEvent
      );

      expect(result.success).toBe(true);
      
      // Should add job to queue
      expect(jobQueue.queue.add).toHaveBeenCalledWith(
        'process-github-job',
        expect.objectContaining({
          jobId: '12345',
          runId: '67890',
          repository: 'test/repo',
          labels: ['ubuntu-latest', 'self-hosted']
        }),
        expect.any(Object)
      );

      // Should request runner
      expect(runnerPoolManager.requestRunner).toHaveBeenCalledWith(
        'test/repo',
        ['ubuntu-latest', 'self-hosted']
      );
    });

    it('should handle in-progress workflow job', async () => {
      const inProgressEvent = {
        ...mockWorkflowJobEvent,
        action: 'in_progress',
        workflow_job: {
          ...mockWorkflowJobEvent.workflow_job,
          status: 'in_progress',
          runner_id: 999,
          runner_name: 'test-runner',
          started_at: new Date().toISOString()
        }
      };

      const result = await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        '',
        'delivery-124',
        inProgressEvent
      );

      expect(result.success).toBe(true);
      
      // Should update job status
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE runnerhub.jobs'),
        expect.arrayContaining(['in_progress', expect.any(String), 999, 'test-runner', '12345'])
      );

      // Should update runner status
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE runnerhub.runners'),
        expect.arrayContaining(['busy', '12345', '999'])
      );
    });

    it('should handle completed workflow job', async () => {
      const completedEvent = {
        ...mockWorkflowJobEvent,
        action: 'completed',
        workflow_job: {
          ...mockWorkflowJobEvent.workflow_job,
          status: 'completed',
          conclusion: 'success',
          runner_id: 999,
          started_at: new Date(Date.now() - 60000).toISOString(),
          completed_at: new Date().toISOString()
        }
      };

      const result = await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        '',
        'delivery-125',
        completedEvent
      );

      expect(result.success).toBe(true);
      
      // Should update job status
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE runnerhub.jobs'),
        expect.arrayContaining(['completed', 'success'])
      );

      // Should release runner
      expect(runnerPoolManager.releaseRunner).toHaveBeenCalledWith('999');

      // Should record metrics
      expect(monitoringService.recordJobCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: '12345',
          repository: 'test/repo',
          conclusion: 'success'
        })
      );
    });
  });

  describe('priority calculation', () => {
    it('should calculate higher priority for production jobs', async () => {
      await webhookService.initialize();
      
      const productionJobEvent = {
        action: 'queued',
        workflow_job: {
          id: 12345,
          run_id: 67890,
          name: 'deploy-production',
          status: 'queued',
          labels: ['production', 'deploy', 'ubuntu-latest'],
          head_sha: 'abc123',
          html_url: 'https://github.com/test/repo/actions/runs/67890/job/12345'
        },
        repository: {
          full_name: 'test/repo'
        }
      };

      await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        '',
        'delivery-126',
        productionJobEvent
      );

      expect(jobQueue.queue.add).toHaveBeenCalledWith(
        'process-github-job',
        expect.objectContaining({
          priority: 110 // 100 for production + 10 for ubuntu-latest
        }),
        expect.any(Object)
      );
    });

    it('should calculate lower priority for large runners', async () => {
      await webhookService.initialize();
      
      const largeJobEvent = {
        action: 'queued',
        workflow_job: {
          id: 12345,
          run_id: 67890,
          name: 'test-large',
          status: 'queued',
          labels: ['large', 'self-hosted'],
          head_sha: 'abc123',
          html_url: 'https://github.com/test/repo/actions/runs/67890/job/12345'
        },
        repository: {
          full_name: 'test/repo'
        }
      };

      await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        '',
        'delivery-127',
        largeJobEvent
      );

      expect(jobQueue.queue.add).toHaveBeenCalledWith(
        'process-github-job',
        expect.objectContaining({
          priority: -10 // -10 for large runner
        }),
        expect.any(Object)
      );
    });
  });

  describe('webhook statistics', () => {
    beforeEach(async () => {
      await webhookService.initialize();
    });

    it('should get webhook statistics', async () => {
      const mockStats = [
        { event: 'workflow_job', total: 10, processed: 8, pending: 2 },
        { event: 'push', total: 5, processed: 5, pending: 0 }
      ];

      (database.query as jest.Mock).mockResolvedValue(mockStats);

      const stats = await webhookService.getWebhookStatistics(24);

      expect(stats).toEqual(mockStats);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY event'),
        expect.any(Array)
      );
    });

    it('should get webhook events with filtering', async () => {
      const mockEvents = [
        {
          id: 'delivery-123',
          repository: 'test/repo',
          event: 'workflow_job',
          action: 'queued',
          payload: {},
          delivery_id: 'delivery-123',
          timestamp: new Date(),
          processed: true
        }
      ];

      (database.query as jest.Mock).mockResolvedValue(mockEvents);

      const events = await webhookService.getWebhookEvents({
        repository: 'test/repo',
        event: 'workflow_job',
        limit: 10
      });

      expect(events).toHaveLength(1);
      expect(events[0].repository).toBe('test/repo');
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE 1=1 AND repository = $1 AND event = $2'),
        expect.arrayContaining(['test/repo', 'workflow_job', 10, 0])
      );
    });
  });

  describe('event emission', () => {
    beforeEach(async () => {
      await webhookService.initialize();
    });

    it('should emit webhook events', async () => {
      const eventHandler = jest.fn();
      webhookService.on('webhook-event', eventHandler);

      await webhookService.processWebhook(
        mockRequest,
        'ping',
        '',
        'delivery-123',
        { zen: 'Test ping' }
      );

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'ping',
          deliveryId: 'delivery-123'
        })
      );
    });

    it('should emit workflow job events', async () => {
      const workflowJobHandler = jest.fn();
      webhookService.on('workflow-job', workflowJobHandler);

      const workflowJobEvent = {
        action: 'queued',
        workflow_job: { id: 123, labels: [] },
        repository: { full_name: 'test/repo' }
      };

      await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        '',
        'delivery-123',
        workflowJobEvent
      );

      expect(workflowJobHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'queued',
          job: expect.objectContaining({ id: 123 })
        })
      );
    });
  });
});