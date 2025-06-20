import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/error-handler';
import runnerPoolManager from '../services/runner-pool-manager';
import database from '../services/database';
import { Runner } from '../types';
import config from '../config';


export class RunnerController {
  /**
   * List all runners
   */
  async listRunners(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { type, status, repository } = req.query;
      const conditions: string[] = [];
      const params: any[] = [];

      if (type) {
        params.push(type);
        conditions.push(`type = $${params.length}`);
      }
      if (status) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }
      if (repository) {
        params.push(repository);
        conditions.push(`repository = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      const runners = await database.query<Runner>(
        `SELECT * FROM runnerhub.runners ${whereClause} ORDER BY created_at DESC`,
        params
      );

      res.json({
        success: true,
        data: runners
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get specific runner
   */
  async getRunner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const [runner] = await database.query<Runner>(
        'SELECT * FROM runnerhub.runners WHERE id = $1',
        [id]
      );

      if (!runner) {
        throw new AppError(404, 'Runner not found');
      }

      res.json({
        success: true,
        data: runner
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove a runner
   */
  async removeRunner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      await runnerPoolManager.removeRunner(id);

      res.json({
        success: true,
        message: 'Runner removed successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List all runner pools
   */
  async listPools(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pools = await runnerPoolManager.getAllPools();

      // Add metrics to each pool
      const poolsWithMetrics = await Promise.all(
        pools.map(async (pool) => {
          const metrics = await runnerPoolManager.getPoolMetrics(pool.repository);
          return {
            ...pool,
            metrics
          };
        })
      );

      res.json({
        success: true,
        data: poolsWithMetrics
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get specific pool
   */
  async getPool(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.params.repository.replace('_', '/'); // Allow _ as / substitute

      const pool = await runnerPoolManager.getOrCreatePool(repository);
      const metrics = await runnerPoolManager.getPoolMetrics(repository);

      res.json({
        success: true,
        data: {
          ...pool,
          metrics
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update pool configuration
   */
  async updatePool(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.params.repository.replace('_', '/');
      const { minRunners, maxRunners, scaleIncrement, scaleThreshold } = req.body;

      // Validate inputs
      if (minRunners !== undefined && (minRunners < 0 || minRunners > 100)) {
        throw new AppError(400, 'Invalid minRunners value');
      }
      if (maxRunners !== undefined && (maxRunners < 1 || maxRunners > 100)) {
        throw new AppError(400, 'Invalid maxRunners value');
      }
      if (minRunners !== undefined && maxRunners !== undefined && minRunners > maxRunners) {
        throw new AppError(400, 'minRunners cannot be greater than maxRunners');
      }
      if (scaleIncrement !== undefined && (scaleIncrement < 1 || scaleIncrement > 10)) {
        throw new AppError(400, 'Invalid scaleIncrement value');
      }
      if (scaleThreshold !== undefined && (scaleThreshold < 0 || scaleThreshold > 1)) {
        throw new AppError(400, 'Invalid scaleThreshold value');
      }

      const updatedPool = await runnerPoolManager.updatePool(repository, {
        minRunners,
        maxRunners,
        scaleIncrement,
        scaleThreshold
      });

      res.json({
        success: true,
        data: updatedPool
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Manually trigger scaling
   */
  async scalePool(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.params.repository.replace('_', '/');
      const { action, count } = req.body;

      if (action !== 'up' && action !== 'down') {
        throw new AppError(400, 'Invalid action. Must be "up" or "down"');
      }

      if (action === 'up') {
        const runnerCount = count || config.runner.scaleIncrement;
        await runnerPoolManager.scaleUp(repository, runnerCount);
        
        res.json({
          success: true,
          message: `Scaling up ${runnerCount} runners for ${repository}`
        });
      } else {
        const removed = await runnerPoolManager.scaleDown(repository);
        
        res.json({
          success: true,
          message: `Removed ${removed} idle runners from ${repository}`
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get pool metrics
   */
  async getPoolMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.params.repository.replace('_', '/');
      const metrics = await runnerPoolManager.getPoolMetrics(repository);

      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      next(error);
    }
  }
}