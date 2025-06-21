import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import githubWebhookEnhanced from '../services/github-webhook-enhanced';
import { GITHUB_EVENT_TYPES } from '../services/github-webhook-enhanced';
import { getGitHubAPIClient } from '../services/github-api-enhanced';

const logger = createLogger('WebhookControllerEnhanced');

export class WebhookControllerEnhanced {
  /**
   * Handle GitHub webhook with enhanced validation and processing
   */
  async handleGitHubWebhook(req: Request, res: Response): Promise<void> {
    try {
      const eventType = req.get('X-GitHub-Event');
      const signature = req.get('X-Hub-Signature-256') || '';
      const deliveryId = req.get('X-GitHub-Delivery') || '';
      const userAgent = req.get('User-Agent') || '';

      // Log webhook receipt
      logger.info('Received GitHub webhook', {
        eventType,
        deliveryId,
        repository: req.body.repository?.full_name,
        action: req.body.action,
        sender: req.body.sender?.login,
        userAgent
      });

      // Validate GitHub user agent
      if (!userAgent.includes('GitHub-Hookshot')) {
        logger.warn('Invalid user agent for webhook', { userAgent, deliveryId });
      }

      // Process the webhook
      const result = await githubWebhookEnhanced.processWebhook(
        req,
        eventType || '',
        signature,
        deliveryId,
        req.body
      );

      // Trigger cache invalidation based on webhook event
      if (result.success && eventType) {
        const githubAPI = getGitHubAPIClient();
        await githubAPI.handleWebhookEvent(eventType, req.body);
      }

      // Set appropriate response headers
      res.set({
        'X-GitHub-Delivery': deliveryId,
        'X-Processing-Time-Ms': result.processingTimeMs?.toString() || '0'
      });

      if (result.success) {
        res.status(200).json({
          success: true,
          message: result.message,
          processed: result.processed,
          deduplicated: result.deduplicated,
          processingTimeMs: result.processingTimeMs
        });
      } else {
        // Return appropriate error code
        const statusCode = result.validationErrors ? 400 : 500;
        res.status(statusCode).json({
          success: false,
          error: result.message,
          validationErrors: result.validationErrors,
          processingTimeMs: result.processingTimeMs
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
   * Get webhook events with enhanced filtering
   */
  async getWebhookEvents(req: Request, res: Response): Promise<void> {
    try {
      const {
        repository,
        event,
        action,
        processed,
        startDate,
        endDate,
        limit = '100',
        offset = '0'
      } = req.query;

      const events = await githubWebhookEnhanced.getWebhookEvents({
        repository: repository as string,
        event: event as string,
        action: action as string,
        processed: processed ? processed === 'true' : undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10)
      });

      res.json({
        success: true,
        data: {
          events,
          total: events.length,
          limit: parseInt(limit as string, 10),
          offset: parseInt(offset as string, 10),
          filters: {
            repository,
            event,
            action,
            processed,
            startDate,
            endDate
          }
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
   * Get webhook statistics with enhanced metrics
   */
  async getWebhookStatistics(req: Request, res: Response): Promise<void> {
    try {
      const { hours = '24' } = req.query;
      
      const stats = await githubWebhookEnhanced.getWebhookStatistics(
        parseInt(hours as string, 10)
      );

      // Calculate totals
      const summary = stats.reduce((acc: any, stat: any) => {
        acc.totalEvents += stat.total;
        acc.processedEvents += stat.processed;
        acc.pendingEvents += stat.pending;
        acc.failedEvents += stat.failed;
        acc.avgProcessingTimeMs = 
          (acc.avgProcessingTimeMs * acc.eventTypes + stat.avgProcessingTimeMs) / 
          (acc.eventTypes + 1);
        acc.eventTypes += 1;
        return acc;
      }, {
        totalEvents: 0,
        processedEvents: 0,
        pendingEvents: 0,
        failedEvents: 0,
        avgProcessingTimeMs: 0,
        eventTypes: 0
      });

      // Success rate
      summary.successRate = summary.totalEvents > 0 
        ? ((summary.processedEvents / summary.totalEvents) * 100).toFixed(2)
        : 0;

      res.json({
        success: true,
        data: {
          timeWindow: `${hours} hours`,
          summary,
          byEvent: stats,
          supportedEvents: Object.values(GITHUB_EVENT_TYPES)
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
   * Replay a webhook event
   */
  async replayWebhook(req: Request, res: Response): Promise<void> {
    try {
      const { deliveryId } = req.params;

      if (!deliveryId) {
        res.status(400).json({
          success: false,
          error: 'Delivery ID is required'
        });
        return;
      }

      logger.info('Replaying webhook', { deliveryId });

      const result = await githubWebhookEnhanced.replayWebhook(deliveryId);

      if (result.success) {
        res.json({
          success: true,
          message: 'Webhook replayed successfully',
          result
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
          result
        });
      }

    } catch (error) {
      logger.error('Error replaying webhook', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to replay webhook'
      });
    }
  }

  /**
   * Get failed webhooks
   */
  async getFailedWebhooks(req: Request, res: Response): Promise<void> {
    try {
      const { limit = '10' } = req.query;
      
      const failedWebhooks = await githubWebhookEnhanced.getFailedWebhooks(
        parseInt(limit as string, 10)
      );

      res.json({
        success: true,
        data: {
          webhooks: failedWebhooks,
          total: failedWebhooks.length
        }
      });

    } catch (error) {
      logger.error('Error getting failed webhooks', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get failed webhooks'
      });
    }
  }

  /**
   * Retry failed webhooks
   */
  async retryFailedWebhooks(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Retrying failed webhooks');

      const results = await githubWebhookEnhanced.retryFailedWebhooks();

      res.json({
        success: true,
        data: {
          message: 'Failed webhooks retry completed',
          results
        }
      });

    } catch (error) {
      logger.error('Error retrying failed webhooks', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retry webhooks'
      });
    }
  }

  /**
   * Test webhook endpoint with various event types
   */
  async testWebhook(req: Request, res: Response): Promise<void> {
    try {
      const { 
        eventType = 'ping', 
        repository = 'test/repo',
        action
      } = req.body;

      // Generate test payload based on event type
      let testPayload: any = {
        repository: {
          id: 123456,
          node_id: 'MDEwOlJlcG9zaXRvcnkxMjM0NTY=',
          name: repository.split('/')[1] || 'repo',
          full_name: repository,
          private: false,
          owner: {
            login: repository.split('/')[0] || 'test',
            id: 1,
            type: 'Organization'
          }
        },
        sender: {
          login: 'test-user',
          id: 1,
          type: 'User'
        }
      };

      // Add event-specific payload
      switch (eventType) {
        case GITHUB_EVENT_TYPES.WORKFLOW_JOB:
          testPayload.action = action || 'queued';
          testPayload.workflow_job = {
            id: Date.now(),
            run_id: Date.now() + 1000,
            run_attempt: 1,
            node_id: 'WFJ_' + Date.now(),
            head_sha: 'abc123def456',
            url: `https://api.github.com/repos/${repository}/actions/jobs/${Date.now()}`,
            html_url: `https://github.com/${repository}/actions/runs/${Date.now()}/job/${Date.now()}`,
            status: action || 'queued',
            name: 'Test Job',
            steps: [],
            check_run_url: `https://api.github.com/repos/${repository}/check-runs/${Date.now()}`,
            labels: ['self-hosted', 'ubuntu-latest'],
            workflow_name: 'Test Workflow'
          };
          break;

        case GITHUB_EVENT_TYPES.PUSH:
          testPayload.ref = 'refs/heads/main';
          testPayload.before = '0000000000000000000000000000000000000000';
          testPayload.after = 'abc123def456789012345678901234567890abcd';
          testPayload.commits = [{
            id: 'abc123def456789012345678901234567890abcd',
            message: 'Test commit',
            author: {
              name: 'Test User',
              email: 'test@example.com'
            }
          }];
          testPayload.pusher = {
            name: 'test-user',
            email: 'test@example.com'
          };
          break;

        case GITHUB_EVENT_TYPES.PULL_REQUEST:
          testPayload.action = action || 'opened';
          testPayload.pull_request = {
            id: Date.now(),
            number: Math.floor(Math.random() * 1000),
            title: 'Test Pull Request',
            state: 'open',
            head: {
              ref: 'feature-branch',
              sha: 'abc123def456'
            },
            base: {
              ref: 'main',
              sha: '123456789abc'
            }
          };
          break;

        case GITHUB_EVENT_TYPES.PING:
          testPayload.zen = 'Design for failure.';
          testPayload.hook_id = 999999;
          testPayload.hook = {
            type: 'Repository',
            id: 999999,
            name: 'web',
            active: true,
            events: ['*'],
            config: {
              content_type: 'json',
              insecure_ssl: '0',
              url: 'http://localhost:3000/api/webhooks/github'
            }
          };
          break;

        default:
          testPayload.action = action;
          break;
      }

      const result = await githubWebhookEnhanced.processWebhook(
        req,
        eventType,
        'sha256=test-signature',
        `test-delivery-${Date.now()}`,
        testPayload
      );

      res.json({
        success: true,
        message: 'Test webhook processed',
        eventType,
        result,
        payload: testPayload
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
   * Get webhook health with detailed metrics
   */
  async getWebhookHealth(req: Request, res: Response): Promise<void> {
    try {
      // Get recent webhook activity
      const recentEvents = await githubWebhookEnhanced.getWebhookEvents({
        limit: 10
      });

      const hourlyStats = await githubWebhookEnhanced.getWebhookStatistics(1);
      const dailyStats = await githubWebhookEnhanced.getWebhookStatistics(24);

      // Get failed webhooks count
      const failedWebhooks = await githubWebhookEnhanced.getFailedWebhooks(100);

      // Calculate health score
      let healthScore = 100;
      const totalHourly = hourlyStats.reduce((sum, stat) => sum + stat.total, 0);
      const failedHourly = hourlyStats.reduce((sum, stat) => sum + stat.failed, 0);
      
      if (totalHourly > 0) {
        const failureRate = (failedHourly / totalHourly) * 100;
        healthScore -= failureRate * 2; // Deduct 2 points per 1% failure
      }

      // Check processing time
      const avgProcessingTime = hourlyStats.reduce((sum, stat) => 
        sum + stat.avgProcessingTimeMs, 0) / (hourlyStats.length || 1);
      
      if (avgProcessingTime > 1000) {
        healthScore -= 10; // Deduct if slow
      }

      const health = {
        status: healthScore >= 90 ? 'healthy' : healthScore >= 70 ? 'degraded' : 'unhealthy',
        healthScore: Math.max(0, Math.round(healthScore)),
        recentEvents: recentEvents.length,
        lastEventTime: recentEvents[0]?.timestamp || null,
        failedWebhooksCount: failedWebhooks.length,
        metrics: {
          hourly: {
            total: totalHourly,
            failed: failedHourly,
            avgProcessingTimeMs: Math.round(avgProcessingTime)
          },
          daily: {
            total: dailyStats.reduce((sum, stat) => sum + stat.total, 0),
            failed: dailyStats.reduce((sum, stat) => sum + stat.failed, 0)
          }
        },
        eventBreakdown: hourlyStats
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

  /**
   * Get supported event types
   */
  async getSupportedEvents(_req: Request, res: Response): Promise<void> {
    try {
      const eventTypes = Object.entries(GITHUB_EVENT_TYPES).map(([key, value]) => ({
        key,
        value,
        description: this.getEventDescription(value)
      }));

      res.json({
        success: true,
        data: {
          totalSupported: eventTypes.length,
          events: eventTypes
        }
      });

    } catch (error) {
      logger.error('Error getting supported events', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get supported events'
      });
    }
  }

  /**
   * Get event description
   */
  private getEventDescription(eventType: string): string {
    const descriptions: Record<string, string> = {
      [GITHUB_EVENT_TYPES.WORKFLOW_JOB]: 'Workflow job queued, in progress, or completed',
      [GITHUB_EVENT_TYPES.WORKFLOW_RUN]: 'Workflow run requested, in progress, or completed',
      [GITHUB_EVENT_TYPES.WORKFLOW_DISPATCH]: 'Manual workflow trigger',
      [GITHUB_EVENT_TYPES.PUSH]: 'Git push to a repository',
      [GITHUB_EVENT_TYPES.PULL_REQUEST]: 'Pull request opened, closed, or updated',
      [GITHUB_EVENT_TYPES.CREATE]: 'Branch or tag created',
      [GITHUB_EVENT_TYPES.DELETE]: 'Branch or tag deleted',
      [GITHUB_EVENT_TYPES.DEPLOYMENT]: 'Deployment created',
      [GITHUB_EVENT_TYPES.DEPLOYMENT_STATUS]: 'Deployment status updated',
      [GITHUB_EVENT_TYPES.RELEASE]: 'Release published',
      [GITHUB_EVENT_TYPES.ISSUES]: 'Issue opened, closed, or updated',
      [GITHUB_EVENT_TYPES.ISSUE_COMMENT]: 'Comment on issue',
      [GITHUB_EVENT_TYPES.CODE_SCANNING_ALERT]: 'Code scanning alert',
      [GITHUB_EVENT_TYPES.SECRET_SCANNING_ALERT]: 'Secret scanning alert',
      [GITHUB_EVENT_TYPES.SECURITY_ADVISORY]: 'Security advisory published',
      [GITHUB_EVENT_TYPES.PING]: 'Webhook connectivity test'
    };

    return descriptions[eventType] || 'GitHub event';
  }
}

export default new WebhookControllerEnhanced();