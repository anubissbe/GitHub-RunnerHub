import { Request, Response, NextFunction } from 'express';
import monitoringService from '../services/monitoring';
import { AppError } from '../middleware/error-handler';

export class MonitoringController {
  /**
   * Get system metrics
   */
  async getSystemMetrics(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const metrics = await monitoringService.getSystemMetrics();
      
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
      const metrics = await monitoringService.getRepositoryMetrics(repository);
      
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
      
      const jobs = await monitoringService.getRecentJobs(limit);
      
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
      
      const timeline = await monitoringService.getJobTimeline(hours);
      
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
      const health = await monitoringService.getRunnerHealth();
      
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
      const metrics = await monitoringService.getPrometheusMetrics();
      
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
        monitoringService.getSystemMetrics(),
        monitoringService.getRecentJobs(10),
        monitoringService.getJobTimeline(24),
        monitoringService.getRunnerHealth()
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
}