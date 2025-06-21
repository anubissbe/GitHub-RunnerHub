import { Request, Response, NextFunction } from 'express';
import monitoringServiceEnhancedEnhanced from '../services/monitoring-enhanced';
import { AppError } from '../middleware/error-handler';

export class MonitoringController {
  /**
   * Get system metrics
   */
  async getSystemMetrics(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const metrics = await monitoringServiceEnhancedEnhanced.getSystemMetrics();
      
      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get repository metrics
   */
  async getRepositoryMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.params.repository.replace('_', '/');
      const metrics = await monitoringServiceEnhancedEnhanced.getRepositoryMetrics(repository);
      
      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get recent jobs
   */
  async getRecentJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      
      if (limit < 1 || limit > 100) {
        throw new AppError(400, 'Limit must be between 1 and 100');
      }
      
      const jobs = await monitoringServiceEnhanced.getRecentJobs(limit);
      
      res.json({
        success: true,
        data: jobs
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get job timeline
   */
  async getJobTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      
      if (hours < 1 || hours > 168) { // Max 1 week
        throw new AppError(400, 'Hours must be between 1 and 168');
      }
      
      const timeline = await monitoringServiceEnhanced.getJobTimeline(hours);
      
      res.json({
        success: true,
        data: timeline
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get runner health
   */
  async getRunnerHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const health = await monitoringServiceEnhanced.getRunnerHealth();
      
      res.json({
        success: true,
        data: health
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Prometheus metrics
   */
  async getPrometheusMetrics(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const metrics = await monitoringServiceEnhanced.getPrometheusMetrics();
      
      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get dashboard data
   */
  async getDashboardData(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Aggregate data for dashboard
      const [systemMetrics, recentJobs, timeline, runnerHealth] = await Promise.all([
        monitoringServiceEnhanced.getSystemMetrics(),
        monitoringServiceEnhanced.getRecentJobs(10),
        monitoringServiceEnhanced.getJobTimeline(24),
        monitoringServiceEnhanced.getRunnerHealth()
      ]);

      res.json({
        success: true,
        data: {
          system: systemMetrics,
          recentJobs,
          timeline,
          runnerHealth,
          lastUpdated: new Date()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get tracked repositories
   */
  async getTrackedRepositories(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repositories = monitoringServiceEnhanced.getTrackedRepositories();
      
      res.json({
        success: true,
        data: repositories
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add tracked repository
   */
  async addTrackedRepository(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { repository } = req.body;
      
      if (!repository || !repository.includes('/')) {
        throw new AppError(400, 'Invalid repository format. Use "owner/repo" format');
      }
      
      await monitoringServiceEnhanced.addTrackedRepository(repository);
      
      res.json({
        success: true,
        message: `Repository ${repository} added to tracking`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove tracked repository
   */
  async removeTrackedRepository(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const repository = req.params.repository.replace('_', '/');
      
      monitoringServiceEnhanced.removeTrackedRepository(repository);
      
      res.json({
        success: true,
        message: `Repository ${repository} removed from tracking`
      });
    } catch (error) {
      next(error);
    }
  }
}