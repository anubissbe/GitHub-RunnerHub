import { GitHubWebhookEnhancedService, GITHUB_EVENT_TYPES } from '../../src/services/github-webhook-enhanced';
import database from '../../src/services/database';
import jobQueue from '../../src/services/job-queue';
import runnerPoolManager from '../../src/services/runner-pool-manager';
import monitoringService from '../../src/services/monitoring';
import { Server as SocketIOServer } from 'socket.io';

// Mock dependencies
jest.mock('../../src/services/database');
jest.mock('../../src/services/job-queue');
jest.mock('../../src/services/runner-pool-manager');
jest.mock('../../src/services/monitoring');
jest.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

describe('GitHubWebhookEnhancedService', () => {
  let webhookService: GitHubWebhookEnhancedService;
  let mockIO: any;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock database responses
    (database.query as jest.Mock).mockResolvedValue([]);
    (database.initialize as jest.Mock).mockResolvedValue(undefined);
    
    // Mock job queue
    (jobQueue.queue as any) = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' })
    };
    
    // Mock runner pool manager
    (runnerPoolManager.requestRunner as jest.Mock).mockResolvedValue({
      id: 'request-123',
      runner: { id: 'runner-123' }
    });
    (runnerPoolManager.releaseRunner as jest.Mock).mockResolvedValue(undefined);
    
    // Mock monitoring service
    (monitoringService.recordJobCompletion as jest.Mock).mockResolvedValue(undefined);
    (monitoringService.recordWebhookProcessed as jest.Mock).mockResolvedValue(undefined);
    
    // Create mock Socket.IO instance
    mockIO = {
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
      of: jest.fn().mockReturnThis()
    };
    
    // Get fresh instance
    webhookService = GitHubWebhookEnhancedService.getInstance();
    webhookService.setSocketIO(mockIO as any);
    
    // Initialize service
    await webhookService.initialize();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Event Type Support', () => {
    test('should support all GitHub event types', () => {
      const eventTypes = Object.values(GITHUB_EVENT_TYPES);
      expect(eventTypes.length).toBeGreaterThan(30); // Should support 30+ event types
      expect(eventTypes).toContain('workflow_job');
      expect(eventTypes).toContain('push');
      expect(eventTypes).toContain('pull_request');
      expect(eventTypes).toContain('security_advisory');
    });
  });

  describe('Webhook Processing', () => {
    const mockRequest: any = {};
    const deliveryId = 'test-delivery-123';
    const signature = 'sha256=test-signature';

    test('should process workflow_job queued event successfully', async () => {
      const payload = {
        action: 'queued',
        workflow_job: {
          id: 12345,
          run_id: 67890,
          name: 'Test Job',
          status: 'queued',
          labels: ['self-hosted', 'ubuntu-latest'],
          head_sha: 'abc123',
          html_url: 'https://github.com/test/repo/actions/runs/67890/job/12345'
        },
        repository: {
          full_name: 'test/repo',
          owner: { login: 'test' }
        },
        sender: { login: 'test-user' }
      };

      const result = await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        signature,
        deliveryId,
        payload
      );

      expect(result.success).toBe(true);
      expect(result.processed).toBe(true);
      expect(result.message).toBe('Webhook processed successfully');
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO runnerhub.webhook_events'),
        expect.any(Array)
      );
      expect(jobQueue.queue.add).toHaveBeenCalledWith(
        'process-github-job',
        expect.objectContaining({
          jobId: '12345',
          repository: 'test/repo'
        }),
        expect.any(Object)
      );
      expect(runnerPoolManager.requestRunner).toHaveBeenCalledWith(
        'test/repo',
        ['self-hosted', 'ubuntu-latest']
      );
    });

    test('should handle workflow_job completed event', async () => {
      const payload = {
        action: 'completed',
        workflow_job: {
          id: 12345,
          run_id: 67890,
          name: 'Test Job',
          status: 'completed',
          conclusion: 'success',
          started_at: '2024-01-01T12:00:00Z',
          completed_at: '2024-01-01T12:05:00Z',
          runner_id: 123,
          labels: ['self-hosted']
        },
        repository: {
          full_name: 'test/repo'
        }
      };

      const result = await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        signature,
        deliveryId + '-completed',
        payload
      );

      expect(result.success).toBe(true);
      expect(runnerPoolManager.releaseRunner).toHaveBeenCalledWith('123');
      expect(monitoringService.recordJobCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: '12345',
          repository: 'test/repo',
          conclusion: 'success'
        })
      );
    });

    test('should handle push events', async () => {
      const payload = {
        ref: 'refs/heads/main',
        before: '0000000000000000000000000000000000000000',
        after: 'abc123def456',
        repository: {
          full_name: 'test/repo'
        },
        pusher: {
          name: 'test-user'
        },
        commits: [
          {
            id: 'abc123',
            message: 'Test commit',
            author: { name: 'Test User' }
          }
        ]
      };

      const result = await webhookService.processWebhook(
        mockRequest,
        'push',
        signature,
        deliveryId + '-push',
        payload
      );

      expect(result.success).toBe(true);
      expect(mockIO.emit).toHaveBeenCalledWith(
        'push-event',
        expect.objectContaining({
          repository: payload.repository,
          ref: payload.ref
        })
      );
    });

    test('should handle security events with high priority', async () => {
      const payload = {
        action: 'created',
        alert: {
          id: 1,
          severity: 'high',
          summary: 'Security vulnerability detected'
        },
        repository: {
          full_name: 'test/repo'
        }
      };

      const result = await webhookService.processWebhook(
        mockRequest,
        'security_advisory',
        signature,
        deliveryId + '-security',
        payload
      );

      expect(result.success).toBe(true);
      expect(mockIO.emit).toHaveBeenCalledWith(
        'security-alert',
        expect.objectContaining({
          type: 'security',
          severity: 'high'
        })
      );
    });
  });

  describe('Deduplication', () => {
    const mockRequest: any = {};
    
    test('should deduplicate identical events', async () => {
      const payload = {
        action: 'queued',
        workflow_job: {
          id: 99999,
          run_id: 88888,
          name: 'Duplicate Job',
          status: 'queued',
          labels: ['self-hosted']
        },
        repository: {
          full_name: 'test/repo'
        }
      };

      // First request
      const result1 = await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        'sha256=sig1',
        'dup-delivery-1',
        payload
      );

      // Second request with same content
      const result2 = await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        'sha256=sig1',
        'dup-delivery-1',
        payload
      );

      expect(result1.success).toBe(true);
      expect(result1.processed).toBe(true);
      expect(result1.deduplicated).toBeFalsy();

      expect(result2.success).toBe(true);
      expect(result2.processed).toBe(false);
      expect(result2.deduplicated).toBe(true);
      expect(result2.message).toBe('Duplicate event ignored');
    });

    test('should not deduplicate events with different delivery IDs', async () => {
      const payload = {
        action: 'queued',
        workflow_job: {
          id: 77777,
          run_id: 66666,
          name: 'Another Job',
          status: 'queued',
          labels: ['self-hosted']
        },
        repository: {
          full_name: 'test/repo'
        }
      };

      // First request
      const result1 = await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        'sha256=sig2',
        'delivery-unique-1',
        payload
      );

      // Second request with different delivery ID
      const result2 = await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        'sha256=sig2',
        'delivery-unique-2',
        payload
      );

      expect(result1.success).toBe(true);
      expect(result1.processed).toBe(true);
      expect(result2.success).toBe(true);
      expect(result2.processed).toBe(true);
    });
  });

  describe('Validation', () => {
    const mockRequest: any = {};

    test('should reject webhook with missing event type', async () => {
      const result = await webhookService.processWebhook(
        mockRequest,
        '',
        'sha256=sig',
        'delivery-123',
        { test: 'data' }
      );

      expect(result.success).toBe(false);
      expect(result.validationErrors).toContain('Missing X-GitHub-Event header');
    });

    test('should reject webhook with missing delivery ID', async () => {
      const result = await webhookService.processWebhook(
        mockRequest,
        'push',
        'sha256=sig',
        '',
        { test: 'data' }
      );

      expect(result.success).toBe(false);
      expect(result.validationErrors).toContain('Missing X-GitHub-Delivery header');
    });

    test('should handle invalid payload structure', async () => {
      const result = await webhookService.processWebhook(
        mockRequest,
        'push',
        'sha256=sig',
        'delivery-123',
        null
      );

      expect(result.success).toBe(false);
      expect(result.validationErrors).toContain('Invalid payload structure');
    });
  });

  describe('Priority Calculation', () => {
    test('should calculate high priority for production deployments', () => {
      const labels = ['production', 'deploy', 'self-hosted'];
      // Access private method through any type assertion
      const priority = (webhookService as any).calculateJobPriority(labels, {});
      expect(priority).toBe(100); // production priority
    });

    test('should calculate priority for critical jobs', () => {
      const labels = ['critical', 'ubuntu-latest'];
      const priority = (webhookService as any).calculateJobPriority(labels, {});
      expect(priority).toBe(60); // critical (50) + ubuntu-latest (10)
    });

    test('should reduce priority for large runners', () => {
      const labels = ['large', 'self-hosted'];
      const priority = (webhookService as any).calculateJobPriority(labels, {});
      expect(priority).toBe(-10); // large runner penalty
    });
  });

  describe('WebSocket Integration', () => {
    const mockRequest: any = {};

    test('should emit real-time updates for job events', async () => {
      const payload = {
        action: 'queued',
        workflow_job: {
          id: 55555,
          name: 'WebSocket Test Job',
          status: 'queued',
          labels: ['self-hosted']
        },
        repository: {
          full_name: 'test/websocket-repo'
        }
      };

      await webhookService.processWebhook(
        mockRequest,
        'workflow_job',
        'sha256=ws-sig',
        'ws-delivery-1',
        payload
      );

      expect(mockIO.emit).toHaveBeenCalledWith(
        'webhook:job-update',
        expect.objectContaining({
          type: 'job-update',
          action: 'queued'
        })
      );

      expect(mockIO.to).toHaveBeenCalledWith('repo:test/websocket-repo');
    });

    test('should emit security alerts to all clients', async () => {
      const payload = {
        action: 'created',
        alert: {
          severity: 'critical',
          summary: 'Critical security issue'
        },
        repository: {
          full_name: 'test/secure-repo'
        }
      };

      await webhookService.processWebhook(
        mockRequest,
        'security_advisory',
        'sha256=sec-sig',
        'sec-delivery-1',
        payload
      );

      expect(mockIO.emit).toHaveBeenCalledWith(
        'security-alert',
        expect.objectContaining({
          type: 'security',
          severity: 'high'
        })
      );
    });
  });

  describe('Statistics and Monitoring', () => {
    beforeEach(() => {
      // Mock database query for statistics
      (database.query as jest.Mock).mockImplementation((query: string) => {
        if (query.includes('SELECT') && query.includes('webhook_events')) {
          return [
            {
              event: 'workflow_job',
              total: '100',
              processed: '95',
              pending: '3',
              failed: '2',
              avg_processing_time_ms: '125.5',
              last_processed_at: new Date()
            },
            {
              event: 'push',
              total: '50',
              processed: '50',
              pending: '0',
              failed: '0',
              avg_processing_time_ms: '75.0',
              last_processed_at: new Date()
            }
          ];
        }
        return [];
      });
    });

    test('should get webhook statistics', async () => {
      const stats = await webhookService.getWebhookStatistics(24);

      expect(stats).toHaveLength(2);
      expect(stats[0]).toMatchObject({
        event: 'workflow_job',
        total: 100,
        processed: 95,
        pending: 3,
        failed: 2,
        avgProcessingTimeMs: 125.5
      });
    });

    test('should get webhook events with filtering', async () => {
      (database.query as jest.Mock).mockResolvedValueOnce([
        {
          id: 'event-1',
          repository: 'test/repo',
          event: 'push',
          action: null,
          processed: true
        }
      ]);

      const events = await webhookService.getWebhookEvents({
        repository: 'test/repo',
        event: 'push',
        processed: true,
        limit: 10
      });

      expect(events).toHaveLength(1);
      expect(events[0].repository).toBe('test/repo');
      expect(events[0].event).toBe('push');
    });
  });

  describe('Replay Functionality', () => {
    test('should replay webhook event', async () => {
      // Mock database query to return stored event
      (database.query as jest.Mock).mockResolvedValueOnce([
        {
          id: 'replay-1',
          event: 'workflow_job',
          signature: 'sha256=stored-sig',
          delivery_id: 'replay-delivery-1',
          payload: {
            action: 'queued',
            workflow_job: { id: 12345 },
            repository: { full_name: 'test/repo' }
          },
          dedup_key: 'old-dedup-key'
        }
      ]);

      const result = await webhookService.replayWebhook('replay-delivery-1');

      expect(result.success).toBe(true);
      expect(result.processed).toBe(true);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM runnerhub.webhook_events'),
        ['replay-delivery-1']
      );
    });

    test('should handle replay of non-existent webhook', async () => {
      (database.query as jest.Mock).mockResolvedValueOnce([]);

      const result = await webhookService.replayWebhook('non-existent');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Webhook event not found');
    });
  });

  describe('Failed Webhook Handling', () => {
    test('should get failed webhooks', async () => {
      (database.query as jest.Mock).mockResolvedValueOnce([
        {
          id: 'failed-1',
          repository: 'test/repo',
          event: 'workflow_job',
          processed: false,
          processing_attempts: 2,
          last_processing_error: 'Connection timeout'
        }
      ]);

      const failed = await webhookService.getFailedWebhooks(10);

      expect(failed).toHaveLength(1);
      expect(failed[0].lastProcessingError).toBe('Connection timeout');
    });

    test('should retry failed webhooks', async () => {
      // Mock failed webhooks
      (database.query as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: 'retry-1',
            delivery_id: 'retry-delivery-1',
            event: 'push',
            payload: { test: 'data' }
          }
        ])
        .mockResolvedValueOnce([
          {
            id: 'retry-1',
            event: 'push',
            signature: 'sha256=retry-sig',
            delivery_id: 'retry-delivery-1',
            payload: { test: 'data' }
          }
        ]);

      const results = await webhookService.retryFailedWebhooks();

      expect(results.total).toBe(1);
      expect(results.succeeded).toBe(1);
      expect(results.failed).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      (database.query as jest.Mock).mockRejectedValueOnce(new Error('Database connection failed'));

      const result = await webhookService.processWebhook(
        {} as any,
        'push',
        'sha256=sig',
        'error-delivery',
        { repository: { full_name: 'test/repo' } }
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Database connection failed');
    });

    test('should record webhook processing metrics on error', async () => {
      (database.query as jest.Mock)
        .mockResolvedValueOnce([]) // webhook table check
        .mockRejectedValueOnce(new Error('Processing failed')); // storing webhook

      await webhookService.processWebhook(
        {} as any,
        'push',
        'sha256=sig',
        'metric-error-delivery',
        { repository: { full_name: 'test/repo' } }
      );

      expect(monitoringService.recordWebhookProcessed).toHaveBeenCalledWith(
        'push',
        false,
        expect.any(Number)
      );
    });
  });
});