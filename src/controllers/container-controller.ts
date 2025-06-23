import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/error-handler';
import containerLifecycle from '../services/container-lifecycle';
import database from '../services/database';
import { Runner } from '../types';

export class ContainerController {
  /**
   * List all containers
   */
  async listContainers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { state, repository, jobId } = req.query;
      
      let containers = containerLifecycle.getAllContainers();
      
      // Apply filters
      if (state) {
        containers = containers.filter(c => c.state === state);
      }
      if (repository) {
        containers = containers.filter(c => c.repository === repository);
      }
      if (jobId) {
        containers = containers.filter(c => c.jobId === jobId);
      }
      
      res.json({
        success: true,
        data: containers
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get container details
   */
  async getContainer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      
      const containers = containerLifecycle.getAllContainers();
      const container = containers.find(c => c.id === id);
      
      if (!container) {
        throw new AppError(404, 'Container not found');
      }
      
      // Get additional stats if running
      let stats = null;
      if (container.state === 'running') {
        try {
          stats = await containerLifecycle.getContainerStats(id);
        } catch (_error) {
          // Stats might not be available
        }
      }
      
      res.json({
        success: true,
        data: {
          ...container,
          stats
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Stop a container
   */
  async stopContainer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { timeout } = req.body;
      
      await containerLifecycle.stopContainer(id, timeout);
      
      res.json({
        success: true,
        message: 'Container stopped successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { force } = req.body;
      
      await containerLifecycle.removeContainer(id, force);
      
      res.json({
        success: true,
        message: 'Container removed successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Execute command in container
   */
  async executeCommand(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { command, user, workingDir, env } = req.body;
      
      if (!command || !Array.isArray(command)) {
        throw new AppError(400, 'Command must be an array');
      }
      
      const result = await containerLifecycle.executeCommand(id, command, {
        user,
        workingDir,
        env
      });
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get container stats
   */
  async getContainerStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      
      const stats = await containerLifecycle.getContainerStats(id);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { tail = '100', timestamps = 'false' } = req.query;
      
      // Get logs using docker exec
      const { output } = await containerLifecycle.executeCommand(
        id,
        ['tail', `-n${tail}`, '/home/runner/_diag/Runner_*.log'],
        { user: 'runner' }
      );
      
      res.json({
        success: true,
        data: {
          logs: output,
          containerId: id,
          tail: parseInt(tail as string),
          timestamps: timestamps === 'true'
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get containers by runner
   */
  async getContainersByRunner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { runnerId } = req.params;
      
      // Verify runner exists
      const [runner] = await database.query<Runner>(
        'SELECT * FROM runnerhub.runners WHERE id = $1',
        [runnerId]
      );
      
      if (!runner) {
        throw new AppError(404, 'Runner not found');
      }
      
      const container = containerLifecycle.getContainerByRunnerId(runnerId);
      
      res.json({
        success: true,
        data: container ? [container] : []
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get resource usage summary
   */
  async getResourceUsage(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const containers = containerLifecycle.getAllContainers()
        .filter(c => c.state === 'running' && c.resourceUsage);
      
      const summary = {
        totalContainers: containers.length,
        totalCpuPercent: 0,
        totalMemoryMB: 0,
        totalNetworkRxMB: 0,
        totalNetworkTxMB: 0,
        containers: containers.map(c => ({
          id: c.id,
          name: c.name,
          repository: c.repository,
          cpuPercent: c.resourceUsage!.cpuPercent,
          memoryMB: Math.round(c.resourceUsage!.memoryUsage / 1024 / 1024),
          networkRxMB: Math.round(c.resourceUsage!.networkRx / 1024 / 1024),
          networkTxMB: Math.round(c.resourceUsage!.networkTx / 1024 / 1024)
        }))
      };
      
      // Calculate totals
      summary.containers.forEach(c => {
        summary.totalCpuPercent += c.cpuPercent;
        summary.totalMemoryMB += c.memoryMB;
        summary.totalNetworkRxMB += c.networkRxMB;
        summary.totalNetworkTxMB += c.networkTxMB;
      });
      
      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      next(error);
    }
  }
}