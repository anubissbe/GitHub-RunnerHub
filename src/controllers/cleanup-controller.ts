import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import containerCleanup from '../services/container-cleanup';
import { AppError } from '../utils/errors';

const logger = createLogger('CleanupController');

export class CleanupController {
  /**
   * Get all cleanup policies
   */
  async getCleanupPolicies(_req: Request, res: Response): Promise<void> {
    try {
      const policies = containerCleanup.getCleanupPolicies();

      res.json({
        success: true,
        data: policies
      });
    } catch (error) {
      logger.error('Failed to get cleanup policies', { error });
      throw new AppError('Failed to get cleanup policies', 500);
    }
  }

  /**
   * Get specific cleanup policy
   */
  async getCleanupPolicy(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const policies = containerCleanup.getCleanupPolicies();
      const policy = policies.find(p => p.id === id);

      if (!policy) {
        res.status(404).json({
          success: false,
          error: 'Cleanup policy not found'
        });
        return;
      }

      res.json({
        success: true,
        data: policy
      });
    } catch (error) {
      logger.error('Failed to get cleanup policy', { error });
      throw new AppError('Failed to get cleanup policy', 500);
    }
  }

  /**
   * Update cleanup policy
   */
  async updateCleanupPolicy(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const updates = req.body;

      const policy = await containerCleanup.updatePolicy(id, updates);

      logger.info('Updated cleanup policy', {
        policyId: id,
        updates
      });

      res.json({
        success: true,
        data: policy
      });
    } catch (error) {
      logger.error('Failed to update cleanup policy', { error });
      
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: error.message
        });
        return;
      }

      throw new AppError('Failed to update cleanup policy', 500);
    }
  }

  /**
   * Get cleanup history
   */
  async getCleanupHistory(req: Request, res: Response): Promise<void> {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const history = await containerCleanup.getCleanupHistory(hours);

      res.json({
        success: true,
        data: {
          timeWindow: `${hours} hours`,
          history
        }
      });
    } catch (error) {
      logger.error('Failed to get cleanup history', { error });
      throw new AppError('Failed to get cleanup history', 500);
    }
  }

  /**
   * Get last cleanup result
   */
  async getLastCleanupResult(_req: Request, res: Response): Promise<void> {
    try {
      const result = containerCleanup.getLastCleanupResult();

      if (!result) {
        res.json({
          success: true,
          data: null,
          message: 'No cleanup has been run yet'
        });
        return;
      }

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Failed to get last cleanup result', { error });
      throw new AppError('Failed to get last cleanup result', 500);
    }
  }

  /**
   * Trigger manual cleanup
   */
  async triggerCleanup(_req: Request, res: Response): Promise<void> {
    try {
      logger.info('Manual cleanup triggered via API');

      // Start cleanup asynchronously
      containerCleanup.triggerCleanup()
        .then(result => {
          logger.info('Manual cleanup completed', {
            containersCleaned: result.containersCleaned,
            errors: result.errors
          });
        })
        .catch(error => {
          logger.error('Manual cleanup failed', { error });
        });

      res.json({
        success: true,
        message: 'Cleanup triggered successfully. Check cleanup history for results.'
      });
    } catch (error) {
      logger.error('Failed to trigger cleanup', { error });
      throw new AppError('Failed to trigger cleanup', 500);
    }
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStatistics(req: Request, res: Response): Promise<void> {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const policies = containerCleanup.getCleanupPolicies();

      // Calculate statistics
      const statistics = {
        timeWindow: `${days} days`,
        policies: policies.map(p => ({
          id: p.id,
          name: p.name,
          enabled: p.enabled,
          lastRun: p.lastRun,
          statistics: p.statistics
        })),
        summary: {
          totalContainersCleaned: 0,
          totalDiskSpaceReclaimed: 0,
          enabledPolicies: 0,
          totalPolicies: policies.length
        }
      };

      // Aggregate statistics
      for (const policy of policies) {
        if (policy.enabled) {
          statistics.summary.enabledPolicies++;
        }
        if (policy.statistics) {
          statistics.summary.totalContainersCleaned += policy.statistics.containersCleanedTotal;
          statistics.summary.totalDiskSpaceReclaimed += policy.statistics.diskSpaceReclaimed;
        }
      }

      res.json({
        success: true,
        data: statistics
      });
    } catch (error) {
      logger.error('Failed to get cleanup statistics', { error });
      throw new AppError('Failed to get cleanup statistics', 500);
    }
  }

  /**
   * Preview cleanup (dry run)
   */
  async previewCleanup(req: Request, res: Response): Promise<void> {
    try {
      const { policyId } = req.query;

      // Get containers that would be cleaned up
      const containers = require('../services/container-lifecycle').default.getAllContainers();
      const policies = containerCleanup.getCleanupPolicies();
      
      const previewResult = {
        containersToClean: [] as Array<{ id: string; name: string; status: string; created: string; policy: string }>,
        totalContainers: containers.length,
        policies: [] as Array<{ id: string; name: string; containersAffected: number }>
      };

      // Filter by specific policy if provided
      const policiesToCheck = policyId 
        ? policies.filter(p => p.id === policyId)
        : policies.filter(p => p.enabled);

      for (const policy of policiesToCheck) {
        const policyContainers = [];
        
        for (const container of containers) {
          // Simple evaluation logic (simplified from actual implementation)
          const wouldClean = await this.evaluateContainerForPreview(container, policy);
          if (wouldClean) {
            const containerToClean = {
              id: container.id,
              name: container.name,
              status: container.state,
              created: container.createdAt,
              policy: policy.name
            };
            policyContainers.push(containerToClean);
          }
        }

        if (policyContainers.length > 0) {
          previewResult.policies.push({
            id: policy.id,
            name: policy.name,
            containersAffected: policyContainers.length
          });
          previewResult.containersToClean.push(...policyContainers);
        }
      }

      res.json({
        success: true,
        data: previewResult
      });
    } catch (error) {
      logger.error('Failed to preview cleanup', { error });
      throw new AppError('Failed to preview cleanup', 500);
    }
  }

  /**
   * Evaluate container for preview (simplified)
   */
  private async evaluateContainerForPreview(
    container: { state: string; lastActivity?: string; exitCode?: number; runnerId?: string; jobId?: string; createdAt: string },
    policy: { type: string; conditions?: { idleTimeMinutes?: number; maxLifetimeHours?: number } }
  ): Promise<boolean> {
    const now = Date.now();

    switch (policy.type) {
      case 'idle':
        if (container.state === 'running' && container.lastActivity && policy.conditions) {
          const idleTime = now - new Date(container.lastActivity).getTime();
          return idleTime > (policy.conditions.idleTimeMinutes || 30) * 60 * 1000;
        }
        break;

      case 'failed':
        return container.state === 'stopped' && container.exitCode !== 0;

      case 'orphaned':
        return !container.runnerId && !container.jobId;

      case 'expired':
        if (policy.conditions) {
          const lifetime = now - new Date(container.createdAt).getTime();
          return lifetime > (policy.conditions.maxLifetimeHours || 24) * 60 * 60 * 1000;
        }
        return false;
    }

    return false;
  }

  /**
   * Get cleanup reason for container
   */
  private getCleanupReason(
    container: { lastActivity?: string; exitCode?: number; createdAt: string },
    policy: { type: string }
  ): string {
    const now = Date.now();

    switch (policy.type) {
      case 'idle':
        if (container.lastActivity) {
          const idleMinutes = Math.floor((now - new Date(container.lastActivity).getTime()) / 60000);
          return `Idle for ${idleMinutes} minutes`;
        }
        return 'No activity detected';

      case 'failed':
        return `Container failed with exit code ${container.exitCode}`;

      case 'orphaned':
        return 'No associated job or runner';

      case 'expired':
        const lifetimeHours = Math.floor((now - new Date(container.createdAt).getTime()) / 3600000);
        return `Container lifetime exceeded (${lifetimeHours} hours)`;

      default:
        return 'Unknown reason';
    }
  }
}