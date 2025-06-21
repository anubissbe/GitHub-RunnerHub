import { getGitHubAPIClient } from './github-api-enhanced';
import { createLogger } from '../utils/logger';
import { Pool } from 'pg';
import config from '../config';

const logger = createLogger('RunnerSyncEnhanced');

export interface GitHubRunner {
  id: number;
  name: string;
  os: string;
  status: 'online' | 'offline';
  busy: boolean;
  labels: Array<{
    id: number;
    name: string;
    type: string;
  }>;
}

export interface WorkflowRun {
  id: number;
  name: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  workflow_id: number;
  repository: {
    full_name: string;
  };
  created_at: string;
  updated_at: string;
}

export class RunnerSyncEnhanced {
  private githubClient = getGitHubAPIClient();
  private db: Pool;
  private syncInterval: NodeJS.Timeout | null = null;
  private webhookQueue: Map<string, any> = new Map();

  constructor() {
    this.db = new Pool({
      connectionString: config.database.url
    });
  }

  /**
   * Start automated sync with intelligent scheduling
   */
  async startAutoSync() {
    logger.info('Starting enhanced runner sync with smart rate limiting');

    // Initial sync
    await this.performFullSync();

    // Set up intelligent sync intervals based on rate limit status
    this.scheduleSyncBasedOnRateLimit();
  }

  /**
   * Schedule sync operations based on current rate limit
   */
  private async scheduleSyncBasedOnRateLimit() {
    const status = this.githubClient.getRateLimitStatus();
    
    // Calculate optimal sync interval
    let syncInterval: number;
    
    if (status.remaining > 4000) {
      syncInterval = 60000; // 1 minute - aggressive when plenty of quota
    } else if (status.remaining > 2000) {
      syncInterval = 120000; // 2 minutes - moderate
    } else if (status.remaining > 500) {
      syncInterval = 300000; // 5 minutes - conservative
    } else {
      syncInterval = 600000; // 10 minutes - very conservative
    }

    logger.info(`Scheduling next sync in ${syncInterval / 1000}s based on rate limit`, {
      remaining: status.remaining,
      limit: status.limit
    });

    this.syncInterval = setTimeout(async () => {
      await this.performIntelligentSync();
      this.scheduleSyncBasedOnRateLimit(); // Reschedule based on new rate limit
    }, syncInterval);
  }

  /**
   * Perform intelligent sync based on priority and changes
   */
  private async performIntelligentSync() {
    try {
      const status = this.githubClient.getRateLimitStatus();
      
      // Process webhook events first (highest priority)
      if (this.webhookQueue.size > 0) {
        await this.processWebhookQueue();
      }

      // Determine what to sync based on rate limit
      if (status.remaining > 1000) {
        // Full sync when we have quota
        await this.performFullSync();
      } else if (status.remaining > 100) {
        // Partial sync - only critical data
        await this.syncRunners('critical');
        await this.syncActiveWorkflows();
      } else {
        // Minimal sync - only process webhooks
        logger.warn('Rate limit low, skipping periodic sync', status);
      }

      // Log metrics
      const metrics = this.githubClient.getRateLimitStatus();
      logger.info('Sync completed', {
        metrics: metrics.metrics,
        rateLimit: {
          remaining: metrics.remaining,
          resetIn: Math.floor(metrics.resetIn / 1000) + 's'
        }
      });

    } catch (error) {
      logger.error('Sync failed', error);
    }
  }

  /**
   * Perform a full sync of all data
   */
  private async performFullSync() {
    logger.info('Performing full sync');

    const tasks = [
      this.syncRunners('normal'),
      this.syncWorkflows('normal'),
      this.syncRepositories('low')
    ];

    const results = await Promise.allSettled(tasks);
    
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.error(`Task ${index} failed:`, result.reason);
      }
    });
  }

  /**
   * Sync GitHub runners with priority-based rate limiting
   */
  async syncRunners(priority: 'critical' | 'high' | 'normal' | 'low' = 'normal') {
    logger.info(`Syncing runners with ${priority} priority`);

    try {
      // Get organization runners
      const response = await this.githubClient.request(
        async () => {
          const { Octokit } = await import('@octokit/rest');
          const octokit = new Octokit({ auth: config.github.token });
          
          return await octokit.rest.actions.listSelfHostedRunnersForOrg({
            org: config.github.org,
            per_page: 100
          });
        },
        { 
          priority,
          strategy: priority === 'critical' ? 'aggressive' : 'adaptive',
          metadata: { operation: 'sync-runners' }
        }
      );

      const runners = response.data.runners;

      // Update database
      await this.db.query('BEGIN');

      try {
        // Mark all runners as potentially offline
        await this.db.query(
          `UPDATE runners SET status = 'unknown' WHERE type = 'self-hosted'`
        );

        // Update or insert runners
        for (const runner of runners) {
          await this.db.query(
            `INSERT INTO runners (id, name, os, status, busy, labels, last_seen)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (id) DO UPDATE SET
               name = $2, os = $3, status = $4, busy = $5, 
               labels = $6, last_seen = NOW()`,
            [
              runner.id,
              runner.name,
              runner.os,
              runner.status,
              runner.busy,
              JSON.stringify(runner.labels)
            ]
          );
        }

        // Remove runners not seen in this sync
        await this.db.query(
          `DELETE FROM runners 
           WHERE type = 'self-hosted' 
           AND status = 'unknown'`
        );

        await this.db.query('COMMIT');
        
        logger.info(`Successfully synced ${runners.length} runners`);
        return runners.length;

      } catch (error) {
        await this.db.query('ROLLBACK');
        throw error;
      }

    } catch (error) {
      logger.error('Failed to sync runners', error);
      throw error;
    }
  }

  /**
   * Sync active workflows only
   */
  async syncActiveWorkflows() {
    logger.info('Syncing active workflows');

    try {
      const response = await this.githubClient.request(
        async () => {
          const { Octokit } = await import('@octokit/rest');
          const octokit = new Octokit({ auth: config.github.token });
          
          // Get repositories first
          const reposResponse = await octokit.rest.repos.listForOrg({
            org: config.github.org,
            type: 'all',
            per_page: 100
          });

          // Get active runs for each repo
          const allRuns: WorkflowRun[] = [];
          
          for (const repo of reposResponse.data.slice(0, 5)) { // Limit to 5 repos
            const runsResponse = await octokit.rest.actions.listWorkflowRunsForRepo({
              owner: config.github.org,
              repo: repo.name,
              status: 'in_progress',
              per_page: 20
            });
            
            allRuns.push(...runsResponse.data.workflow_runs as WorkflowRun[]);
          }

          return { data: allRuns };
        },
        {
          priority: 'high',
          strategy: 'adaptive',
          metadata: { operation: 'sync-active-workflows' }
        }
      );

      logger.info(`Synced ${response.data.length} active workflows`);
      return response.data.length;

    } catch (error) {
      logger.error('Failed to sync active workflows', error);
      throw error;
    }
  }

  /**
   * Sync all workflows with batching
   */
  async syncWorkflows(priority: 'high' | 'normal' | 'low' = 'normal') {
    logger.info(`Syncing workflows with ${priority} priority`);

    try {
      // Get list of repositories
      const reposResponse = await this.githubClient.request(
        async () => {
          const { Octokit } = await import('@octokit/rest');
          const octokit = new Octokit({ auth: config.github.token });
          
          return await octokit.rest.repos.listForOrg({
            org: config.github.org,
            type: 'all',
            per_page: 100
          });
        },
        { priority: 'low' }
      );

      const repositories = reposResponse.data;
      
      // Batch process repositories
      const batchSize = priority === 'low' ? 3 : 5;
      let totalWorkflows = 0;

      for (let i = 0; i < repositories.length; i += batchSize) {
        const batch = repositories.slice(i, i + batchSize);
        
        const batchRequests = batch.map(repo => ({
          fn: async () => {
            const { Octokit } = await import('@octokit/rest');
            const octokit = new Octokit({ auth: config.github.token });
            
            return await octokit.rest.actions.listWorkflowRunsForRepo({
              owner: config.github.org,
              repo: repo.name,
              per_page: 50
            });
          },
          priority
        }));

        const results = await this.githubClient.batchRequests(batchRequests);
        
        for (const result of results) {
          if (result && result.data) {
            totalWorkflows += result.data.workflow_runs.length;
            // Process and store workflows
            await this.storeWorkflows(result.data.workflow_runs);
          }
        }

        // Check rate limit and adjust if needed
        const status = this.githubClient.getRateLimitStatus();
        if (status.remaining < 100) {
          logger.warn('Rate limit low, pausing workflow sync');
          break;
        }
      }

      logger.info(`Successfully synced ${totalWorkflows} workflows`);
      return totalWorkflows;

    } catch (error) {
      logger.error('Failed to sync workflows', error);
      throw error;
    }
  }

  /**
   * Sync repository information
   */
  async syncRepositories(priority: 'normal' | 'low' = 'low') {
    logger.info(`Syncing repositories with ${priority} priority`);

    try {
      const response = await this.githubClient.request(
        async () => {
          const { Octokit } = await import('@octokit/rest');
          const octokit = new Octokit({ auth: config.github.token });
          
          return await octokit.rest.repos.listForOrg({
            org: config.github.org,
            type: 'all',
            per_page: 100
          });
        },
        {
          priority,
          strategy: 'conservative',
          metadata: { operation: 'sync-repositories' }
        }
      );

      const repositories = response.data;
      
      // Store repository information
      for (const repo of repositories) {
        await this.db.query(
          `INSERT INTO repositories (id, name, full_name, private, default_branch, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             name = $2, full_name = $3, private = $4, 
             default_branch = $5, updated_at = $6`,
          [
            repo.id,
            repo.name,
            repo.full_name,
            repo.private,
            repo.default_branch,
            repo.updated_at
          ]
        );
      }

      logger.info(`Successfully synced ${repositories.length} repositories`);
      return repositories.length;

    } catch (error) {
      logger.error('Failed to sync repositories', error);
      throw error;
    }
  }

  /**
   * Process webhook events with high priority
   */
  async processWebhookEvent(event: any) {
    logger.info('Processing webhook event', { type: event.type });

    // Queue the event for processing
    this.webhookQueue.set(event.id, event);

    // Process immediately if rate limit allows
    const status = this.githubClient.getRateLimitStatus();
    if (status.remaining > 100) {
      await this.processWebhookQueue();
    }
  }

  /**
   * Process queued webhook events
   */
  private async processWebhookQueue() {
    const events = Array.from(this.webhookQueue.values());
    this.webhookQueue.clear();

    for (const event of events) {
      try {
        switch (event.type) {
          case 'workflow_run':
            await this.processWorkflowRunEvent(event);
            break;
          case 'runner':
            await this.processRunnerEvent(event);
            break;
          default:
            logger.warn('Unknown webhook event type', { type: event.type });
        }
      } catch (error) {
        logger.error('Failed to process webhook event', { event, error });
      }
    }
  }

  /**
   * Process workflow run webhook event
   */
  private async processWorkflowRunEvent(event: any) {
    // High priority API call to get latest workflow details
    await this.githubClient.request(
      async () => {
        // Process the workflow run update
        logger.info('Processing workflow run event', { 
          runId: event.workflow_run.id,
          status: event.workflow_run.status 
        });
        
        // Update database with latest status
        await this.storeWorkflows([event.workflow_run]);
      },
      {
        priority: 'critical',
        metadata: { operation: 'webhook-workflow-run' }
      }
    );
  }

  /**
   * Process runner webhook event
   */
  private async processRunnerEvent(event: any) {
    // Critical priority for runner status changes
    await this.githubClient.request(
      async () => {
        logger.info('Processing runner event', {
          runnerId: event.runner.id,
          status: event.action
        });
        
        // Update runner status immediately
        await this.db.query(
          `UPDATE runners SET status = $1, last_seen = NOW() WHERE id = $2`,
          [event.action === 'online' ? 'online' : 'offline', event.runner.id]
        );
      },
      {
        priority: 'critical',
        metadata: { operation: 'webhook-runner' }
      }
    );
  }

  /**
   * Store workflows in database
   */
  private async storeWorkflows(workflows: any[]) {
    for (const workflow of workflows) {
      await this.db.query(
        `INSERT INTO workflow_runs 
         (id, name, head_branch, head_sha, status, conclusion, 
          workflow_id, repository, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           status = $5, conclusion = $6, updated_at = $10`,
        [
          workflow.id,
          workflow.name,
          workflow.head_branch,
          workflow.head_sha,
          workflow.status,
          workflow.conclusion,
          workflow.workflow_id,
          workflow.repository?.full_name || workflow.repository,
          workflow.created_at,
          workflow.updated_at
        ]
      );
    }
  }

  /**
   * Get sync status and metrics
   */
  async getSyncStatus() {
    const rateLimitStatus = this.githubClient.getRateLimitStatus();
    
    const dbStats = await this.db.query(`
      SELECT 
        (SELECT COUNT(*) FROM runners WHERE status = 'online') as online_runners,
        (SELECT COUNT(*) FROM runners) as total_runners,
        (SELECT COUNT(*) FROM workflow_runs WHERE status = 'in_progress') as active_workflows,
        (SELECT COUNT(*) FROM repositories) as total_repositories,
        (SELECT MAX(last_seen) FROM runners) as last_runner_sync,
        (SELECT MAX(updated_at) FROM workflow_runs) as last_workflow_sync
    `);

    return {
      rateLimit: {
        remaining: rateLimitStatus.remaining,
        limit: rateLimitStatus.limit,
        resetIn: `${Math.floor(rateLimitStatus.resetIn / 1000)}s`,
        strategy: rateLimitStatus.strategy
      },
      metrics: rateLimitStatus.metrics,
      database: dbStats.rows[0],
      webhookQueueSize: this.webhookQueue.size,
      nextSyncIn: this.syncInterval ? 'scheduled' : 'not scheduled'
    };
  }

  /**
   * Stop auto sync
   */
  stopAutoSync() {
    if (this.syncInterval) {
      clearTimeout(this.syncInterval);
      this.syncInterval = null;
      logger.info('Stopped auto sync');
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.stopAutoSync();
    await this.db.end();
    await this.githubClient.cleanup();
    logger.info('Runner sync service cleaned up');
  }
}

// Export singleton instance
export const runnerSync = new RunnerSyncEnhanced();