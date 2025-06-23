import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import githubWebhook from '../services/github-webhook';

const logger = createLogger('WebhookController');

export class WebhookController {
  /**
   * Handle GitHub webhook
   */
  async handleGitHubWebhook(req: Request, res: Response): Promise<void> {
    try {
      const eventType = req.get('X-GitHub-Event');
      const signature = req.get('X-Hub-Signature-256') || '';
      const deliveryId = req.get('X-GitHub-Delivery') || '';

      if (!eventType) {
        res.status(400).json({
          success: false,
          error: 'Missing X-GitHub-Event header'
        });
        return;
      }

      if (!deliveryId) {
        res.status(400).json({
          success: false,
          error: 'Missing X-GitHub-Delivery header'
        });
        return;
      }

      logger.info('Received GitHub webhook', {
        eventType,
        deliveryId,
        repository: req.body.repository?.full_name
      });

      // Process the webhook
      const result = await githubWebhook.processWebhook(
        req,
        eventType,
        signature,
        deliveryId,
        req.body
      );

      if (result.success) {
        res.status(200).json({
          success: true,
          message: result.message
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message
        });
      }

    } catch (error) {
      logger.error('Error handling GitHub webhook', { error });
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Get webhook events
   */
  async getWebhookEvents(req: Request, res: Response): Promise<void> {
    try {
      const {
        repository,
        event,
        limit = '100',
        offset = '0'
      } = req.query;

      const events = await githubWebhook.getWebhookEvents({
        repository: repository as string,
        event: event as string,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10)
      });

      res.json({
        success: true,
        data: {
          events,
          total: events.length,
          limit: parseInt(limit as string, 10),
          offset: parseInt(offset as string, 10)
        }
      });

    } catch (error) {
      logger.error('Error getting webhook events', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get webhook events'
      });
    }
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStatistics(req: Request, res: Response): Promise<void> {
    try {
      const { hours = '24' } = req.query;
      
      const stats = await githubWebhook.getWebhookStatistics(
        parseInt(hours as string, 10)
      );

      // Calculate totals
      interface StatSummary {
        totalEvents: number;
        processedEvents: number;
        pendingEvents: number;
      }

      interface EventStat {
        total: number;
        processed: number;
        pending: number;
      }

      const summary = stats.reduce((acc: StatSummary, stat: EventStat) => {
        acc.totalEvents += stat.total;
        acc.processedEvents += stat.processed;
        acc.pendingEvents += stat.pending;
        return acc;
      }, {
        totalEvents: 0,
        processedEvents: 0,
        pendingEvents: 0
      });

      res.json({
        success: true,
        data: {
          timeWindow: `${hours} hours`,
          summary,
          byEvent: stats
        }
      });

    } catch (error) {
      logger.error('Error getting webhook statistics', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get webhook statistics'
      });
    }
  }

  /**
   * Test webhook endpoint (for development)
   */
  async testWebhook(_req: Request, res: Response): Promise<void> {
    try {
      const { eventType = 'ping', repository = 'test/repo' } = _req.body;

      const testPayload = {
        zen: 'Test webhook from RunnerHub',
        hook_id: 999999,
        hook: {
          type: 'Repository',
          id: 999999,
          name: 'web',
          active: true,
          events: ['workflow_job'],
          config: {
            content_type: 'json',
            insecure_ssl: '0',
            url: 'http://localhost:3000/api/webhooks/github'
          },
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          url: 'http://localhost:3000/api/webhooks/github',
          test_url: 'http://localhost:3000/api/webhooks/github/test',
          ping_url: 'http://localhost:3000/api/webhooks/github/ping',
          last_response: {
            code: null,
            status: 'unused',
            message: null
          }
        },
        repository: {
          id: 123456,
          node_id: 'MDEwOlJlcG9zaXRvcnkxMjM0NTY=',
          name: repository.split('/')[1] || 'repo',
          full_name: repository,
          private: false
        }
      };

      const result = await githubWebhook.processWebhook(
        _req,
        eventType,
        'sha256=test-signature',
        `test-delivery-${Date.now()}`,
        testPayload
      );

      res.json({
        success: true,
        message: 'Test webhook processed',
        result
      });

    } catch (error) {
      logger.error('Error processing test webhook', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to process test webhook'
      });
    }
  }

  /**
   * Get webhook health
   */
  async getWebhookHealth(_req: Request, res: Response): Promise<void> {
    try {
      // Get recent webhook activity
      const recentEvents = await githubWebhook.getWebhookEvents({
        limit: 10
      });

      const stats = await githubWebhook.getWebhookStatistics(1); // Last hour

      const health = {
        status: 'healthy',
        recentEvents: recentEvents.length,
        lastEventTime: recentEvents[0]?.timestamp || null,
        hourlyStats: stats
      };

      res.json({
        success: true,
        data: health
      });

    } catch (error) {
      logger.error('Error getting webhook health', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get webhook health'
      });
    }
  }
}

export default new WebhookController();