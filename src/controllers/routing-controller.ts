import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import jobRouter from '../services/job-router';
import { AppError } from '../utils/errors';
import { DelegatedJob, JobStatus } from '../types';
import runnerPoolManager from '../services/runner-pool-manager';

const logger = createLogger('RoutingController');

export class RoutingController {
  /**
   * Get all routing rules
   */
  async getRoutingRules(_req: Request, res: Response): Promise<void> {
    try {
      const rules = await jobRouter.getRoutingRules();

      res.json({
        success: true,
        data: rules
      });
    } catch (error) {
      logger.error('Failed to get routing rules', { error });
      throw new AppError('Failed to get routing rules', 500);
    }
  }

  /**
   * Get routing rule by ID
   */
  async getRoutingRule(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const rules = await jobRouter.getRoutingRules();
      const rule = rules.find(r => r.id === id);

      if (!rule) {
        res.status(404).json({
          success: false,
          error: 'Routing rule not found'
        });
        return;
      }

      res.json({
        success: true,
        data: rule
      });
    } catch (error) {
      logger.error('Failed to get routing rule', { error });
      throw new AppError('Failed to get routing rule', 500);
    }
  }

  /**
   * Create a new routing rule
   */
  async createRoutingRule(req: Request, res: Response): Promise<void> {
    try {
      const {
        name,
        priority = 0,
        conditions = {},
        targets,
        enabled = true
      } = req.body;

      // Validate required fields
      if (!name || !targets || !targets.runnerLabels) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: name, targets.runnerLabels'
        });
        return;
      }

      const rule = await jobRouter.createRoutingRule({
        name,
        priority,
        conditions,
        targets,
        enabled
      });

      logger.info('Created routing rule', {
        ruleId: rule.id,
        name: rule.name
      });

      res.status(201).json({
        success: true,
        data: rule
      });
    } catch (error) {
      logger.error('Failed to create routing rule', { error });
      throw new AppError('Failed to create routing rule', 500);
    }
  }

  /**
   * Update a routing rule
   */
  async updateRoutingRule(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const updates = req.body;

      const rule = await jobRouter.updateRoutingRule(id, updates);

      logger.info('Updated routing rule', {
        ruleId: rule.id,
        name: rule.name
      });

      res.json({
        success: true,
        data: rule
      });
    } catch (error) {
      logger.error('Failed to update routing rule', { error });
      throw new AppError('Failed to update routing rule', 500);
    }
  }

  /**
   * Delete a routing rule
   */
  async deleteRoutingRule(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      await jobRouter.deleteRoutingRule(id);

      logger.info('Deleted routing rule', { ruleId: id });

      res.json({
        success: true,
        message: 'Routing rule deleted'
      });
    } catch (error) {
      logger.error('Failed to delete routing rule', { error });
      throw new AppError('Failed to delete routing rule', 500);
    }
  }

  /**
   * Test a routing rule
   */
  async testRoutingRule(req: Request, res: Response): Promise<void> {
    try {
      const { rule, sampleJob } = req.body;

      if (!rule || !sampleJob) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: rule, sampleJob'
        });
        return;
      }

      const result = await jobRouter.testRoutingRule(rule, sampleJob);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Failed to test routing rule', { error });
      throw new AppError('Failed to test routing rule', 500);
    }
  }

  /**
   * Get routing analytics
   */
  async getRoutingAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const analytics = await jobRouter.getRoutingAnalytics(hours);

      res.json({
        success: true,
        data: {
          timeWindow: `${hours} hours`,
          rules: analytics
        }
      });
    } catch (error) {
      logger.error('Failed to get routing analytics', { error });
      throw new AppError('Failed to get routing analytics', 500);
    }
  }

  /**
   * Preview routing for a job
   */
  async previewRouting(req: Request, res: Response): Promise<void> {
    try {
      const { job } = req.body;

      if (!job) {
        res.status(400).json({
          success: false,
          error: 'Missing required field: job'
        });
        return;
      }

      // Create a mock job for routing preview
      interface MockJob {
        id: string;
        githubJobId: number;
        jobId: string;
        runId: string;
        repository: string;
        workflow: string;
        runnerName: string;
        status: string;
        labels: string[];
        createdAt: Date;
        updatedAt: Date;
      }

      const mockJob: MockJob = {
        id: 'preview',
        githubJobId: 1,
        jobId: 'preview-job',
        runId: '1',
        repository: job.repository || 'test/repo',
        workflow: job.workflow || 'test-workflow',
        runnerName: 'preview-runner',
        status: 'pending',
        labels: job.labels || [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Convert to DelegatedJob format
      const delegatedJob: DelegatedJob = {
        ...mockJob,
        status: JobStatus.PENDING
      };
      
      const decision = await jobRouter.routeJob(delegatedJob);

      res.json({
        success: true,
        data: {
          matchedRule: decision.matchedRule ? {
            id: decision.matchedRule.id,
            name: decision.matchedRule.name,
            priority: decision.matchedRule.priority
          } : null,
          targetRunnerCount: decision.targetRunners.length,
          targetRunners: decision.targetRunners.map(r => ({
            id: r.id,
            name: r.name,
            labels: r.labels,
            status: r.status
          })),
          poolName: decision.poolName,
          reason: decision.reason
        }
      });
    } catch (error) {
      logger.error('Failed to preview routing', { error });
      throw new AppError('Failed to preview routing', 500);
    }
  }

  /**
   * Get suggested labels based on existing runners
   */
  async getSuggestedLabels(req: Request, res: Response): Promise<void> {
    interface RunnerWithLabels {
      labels?: string[];
    }
    
    try {
      const { repository } = req.query;
      
      // Get all runners and collect unique labels
      const labelSet = new Set<string>();
      
      if (repository) {
        const runners = await runnerPoolManager.getActiveRunners(repository as string);
        
        runners.forEach((runner: RunnerWithLabels) => {
          if (runner.labels) {
            runner.labels.forEach((label: string) => labelSet.add(label));
          }
        });
      } else {
        // Get labels from all pools
        const pools = await runnerPoolManager.getAllPools();
        for (const pool of pools) {
          const runners = await runnerPoolManager.getActiveRunners(pool.repository);
          runners.forEach((runner: RunnerWithLabels) => {
            if (runner.labels) {
              runner.labels.forEach((label: string) => labelSet.add(label));
            }
          });
        }
      }

      // Common labels that might not be present yet
      const commonLabels = [
        'linux', 'windows', 'macos',
        'x64', 'arm64',
        'gpu', 'cuda',
        'docker', 'kubernetes',
        'self-hosted',
        'large', 'xlarge',
        'production', 'staging', 'development'
      ];

      commonLabels.forEach(label => labelSet.add(label));

      res.json({
        success: true,
        data: Array.from(labelSet).sort()
      });
    } catch (error) {
      logger.error('Failed to get suggested labels', { error });
      throw new AppError('Failed to get suggested labels', 500);
    }
  }
}

// Import runner pool manager for label suggestions
import runnerPoolManager from '../services/runner-pool-manager';