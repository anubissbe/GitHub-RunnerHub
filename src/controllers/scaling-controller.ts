import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/error-handler';
import autoScaler from '../services/auto-scaler';
import runnerPoolManager from '../services/runner-pool-manager';

export class ScalingController {
  /**
   * Get scaling policies
   */
  async getPolicies(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = autoScaler.getScalingStatus();
      const policies = Array.from(status.entries()).map(([repository, data]) => ({
        repository,
        ...data
      }));

      res.json({
        success: true,
        data: policies
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get scaling policy for specific repository
   */
  async getPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.params.repository.replace('_', '/');
      const status = autoScaler.getScalingStatus();
      const policyData = status.get(repository);

      if (!policyData) {
        throw new AppError(404, 'Policy not found for repository');
      }

      res.json({
        success: true,
        data: {
          repository,
          ...policyData
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update scaling policy
   */
  async updatePolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.params.repository.replace('_', '/');
      const {
        scaleUpThreshold,
        scaleDownThreshold,
        scaleUpIncrement,
        scaleDownIncrement,
        cooldownPeriod,
        queueDepthThreshold,
        avgWaitTimeThreshold
      } = req.body;

      // Validate inputs
      if (scaleUpThreshold !== undefined) {
        if (scaleUpThreshold < 0.5 || scaleUpThreshold > 1) {
          throw new AppError(400, 'scaleUpThreshold must be between 0.5 and 1');
        }
      }
      if (scaleDownThreshold !== undefined) {
        if (scaleDownThreshold < 0 || scaleDownThreshold > 0.5) {
          throw new AppError(400, 'scaleDownThreshold must be between 0 and 0.5');
        }
      }
      if (scaleUpThreshold !== undefined && scaleDownThreshold !== undefined) {
        if (scaleDownThreshold >= scaleUpThreshold) {
          throw new AppError(400, 'scaleDownThreshold must be less than scaleUpThreshold');
        }
      }

      await autoScaler.updatePolicy(repository, {
        scaleUpThreshold,
        scaleDownThreshold,
        scaleUpIncrement,
        scaleDownIncrement,
        cooldownPeriod,
        queueDepthThreshold,
        avgWaitTimeThreshold
      });

      res.json({
        success: true,
        message: 'Scaling policy updated'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get scaling metrics history
   */
  async getMetricsHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.query.repository as string;
      const minutes = parseInt(req.query.minutes as string) || 60;

      if (minutes < 1 || minutes > 1440) { // Max 24 hours
        throw new AppError(400, 'Minutes must be between 1 and 1440');
      }

      const history = autoScaler.getMetricsHistory(
        repository?.replace('_', '/'),
        minutes
      );

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get scaling predictions
   */
  async getPredictions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.params.repository.replace('_', '/');
      const minutes = parseInt(req.query.minutes as string) || 30;

      const predictions = await autoScaler.predictScalingNeeds(repository, minutes);

      res.json({
        success: true,
        data: {
          repository,
          minutes,
          ...predictions
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Force immediate evaluation
   */
  async evaluateNow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.params.repository.replace('_', '/');

      const decision = await autoScaler.evaluateNow(repository);

      res.json({
        success: true,
        data: {
          decision: decision.scalingDecision,
          reason: decision.reason,
          metrics: {
            utilization: decision.utilization,
            queueDepth: decision.queueDepth,
            avgWaitTime: decision.avgWaitTime,
            runnerCount: decision.runnerCount,
            activeJobs: decision.activeJobs
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current scaling recommendations
   */
  async getRecommendations(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pools = await runnerPoolManager.getAllPools();
      const recommendations = [];

      for (const pool of pools) {
        const metrics = await runnerPoolManager.getPoolMetrics(pool.repository);
        const predictions = await autoScaler.predictScalingNeeds(pool.repository, 30);
        const history = autoScaler.getMetricsHistory(pool.repository, 60);

        // Calculate recommendations
        interface ScalingRecommendation {
          repository: string;
          currentRunners: number;
          currentUtilization: number;
          predictedUtilization: number;
          recommendedRunners: number;
          confidence: number;
          action: 'maintain' | 'scale-up' | 'scale-down';
          runnersToAdd?: number;
          runnersToRemove?: number;
          recentScaleUps?: number;
          recentScaleDowns?: number;
          trend?: string;
        }

        const recommendation: ScalingRecommendation = {
          repository: pool.repository,
          currentRunners: metrics.totalRunners,
          currentUtilization: metrics.utilization,
          predictedUtilization: predictions.predictedUtilization,
          recommendedRunners: predictions.recommendedRunners,
          confidence: predictions.confidence,
          action: 'maintain'
        };

        if (predictions.recommendedRunners > metrics.totalRunners) {
          recommendation.action = 'scale-up';
          recommendation.runnersToAdd = predictions.recommendedRunners - metrics.totalRunners;
        } else if (predictions.recommendedRunners < metrics.totalRunners) {
          recommendation.action = 'scale-down';
          recommendation.runnersToRemove = metrics.totalRunners - predictions.recommendedRunners;
        }

        // Add historical context
        const recentScaleUps = history.filter(m => m.scalingDecision === 'scale-up').length;
        const recentScaleDowns = history.filter(m => m.scalingDecision === 'scale-down').length;
        
        recommendation.recentActivity = {
          scaleUps: recentScaleUps,
          scaleDowns: recentScaleDowns,
          lastHour: history.length
        };

        recommendations.push(recommendation);
      }

      res.json({
        success: true,
        data: recommendations
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get scaling dashboard data
   */
  async getDashboardData(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pools = await runnerPoolManager.getAllPools();
      const status = autoScaler.getScalingStatus();
      const dashboardData = [];

      for (const pool of pools) {
        const metrics = await runnerPoolManager.getPoolMetrics(pool.repository);
        const policyStatus = status.get(pool.repository) || {};
        const history = autoScaler.getMetricsHistory(pool.repository, 60);

        // Calculate scaling activity
        const scalingEvents = history.filter(m => m.scalingDecision !== 'maintain');
        const lastScaleUp = history.filter(m => m.scalingDecision === 'scale-up').pop();
        const lastScaleDown = history.filter(m => m.scalingDecision === 'scale-down').pop();

        dashboardData.push({
          repository: pool.repository,
          pool: {
            minRunners: pool.minRunners,
            maxRunners: pool.maxRunners,
            currentRunners: pool.currentRunners
          },
          metrics: {
            utilization: metrics.utilization,
            totalRunners: metrics.totalRunners,
            activeRunners: metrics.activeRunners,
            idleRunners: metrics.idleRunners
          },
          scaling: {
            inCooldown: policyStatus.inCooldown || false,
            cooldownRemaining: policyStatus.cooldownRemaining || 0,
            isScaling: policyStatus.isScaling || false,
            lastAction: policyStatus.lastAction,
            recentEvents: scalingEvents.length,
            lastScaleUp: lastScaleUp?.timestamp,
            lastScaleDown: lastScaleDown?.timestamp
          },
          policy: policyStatus.policy || {}
        });
      }

      res.json({
        success: true,
        data: {
          repositories: dashboardData,
          totalPools: pools.length,
          activePools: dashboardData.filter(d => d.metrics.activeRunners > 0).length,
          scalingInProgress: dashboardData.filter(d => d.scaling.isScaling).length,
          timestamp: new Date()
        }
      });
    } catch (error) {
      next(error);
    }
  }
}