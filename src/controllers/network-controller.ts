import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import networkIsolation from '../services/network-isolation';
import { AuthenticatedRequest } from '../middleware/auth';

const logger = createLogger('NetworkController');

export class NetworkController {
  /**
   * Get network isolation statistics
   */
  async getNetworkStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = networkIsolation.getNetworkStats();

      res.json({
        success: true,
        data: {
          totalNetworks: stats.totalNetworks,
          activeNetworks: stats.activeNetworks,
          isolatedContainers: stats.isolatedContainers,
          repositories: Array.from(stats.networksByRepository.entries()).map(
            ([repo, count]) => ({ repository: repo, networks: count })
          )
        }
      });

    } catch (error) {
      logger.error('Failed to get network stats', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to get network statistics'
      });
    }
  }

  /**
   * List all isolated networks
   */
  async listNetworks(req: Request, res: Response): Promise<void> {
    try {
      const { repository, active } = req.query;
      let networks = await networkIsolation.listIsolatedNetworks();

      // Filter by repository if specified
      if (repository) {
        networks = networks.filter(n => n.repository === repository);
      }

      // Filter by active status if specified
      if (active !== undefined) {
        const isActive = active === 'true';
        networks = networks.filter(n => 
          isActive ? n.containers.length > 0 : n.containers.length === 0
        );
      }

      res.json({
        success: true,
        data: {
          networks: networks.map(network => ({
            id: network.id,
            name: network.name,
            repository: network.repository,
            subnet: network.subnet,
            gateway: network.gateway,
            containerCount: network.containers.length,
            created: network.created,
            lastUsed: network.lastUsed,
            internal: network.internal
          })),
          total: networks.length
        }
      });

    } catch (error) {
      logger.error('Failed to list networks', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to list networks'
      });
    }
  }

  /**
   * Get networks for a specific repository
   */
  async getRepositoryNetworks(req: Request, res: Response): Promise<void> {
    try {
      const { repository } = req.params;
      const networks = await networkIsolation.getRepositoryNetworks(repository);

      res.json({
        success: true,
        data: {
          repository,
          networks: networks.map(network => ({
            id: network.id,
            name: network.name,
            subnet: network.subnet,
            gateway: network.gateway,
            containerCount: network.containers.length,
            containers: network.containers,
            created: network.created,
            lastUsed: network.lastUsed
          })),
          total: networks.length
        }
      });

    } catch (error) {
      logger.error('Failed to get repository networks', { 
        repository: req.params.repository,
        error: (error as Error).message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get repository networks'
      });
    }
  }

  /**
   * Create a network for a repository
   */
  async createRepositoryNetwork(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { repository } = req.body;

      if (!repository) {
        res.status(400).json({
          success: false,
          error: 'Repository name is required'
        });
        return;
      }

      const network = await networkIsolation.createRepositoryNetwork(repository);

      logger.info('Created repository network', {
        repository,
        networkId: network.id,
        requestedBy: req.user?.username
      });

      res.status(201).json({
        success: true,
        data: {
          id: network.id,
          name: network.name,
          repository: network.repository,
          subnet: network.subnet,
          gateway: network.gateway,
          created: network.created
        }
      });

    } catch (error) {
      logger.error('Failed to create repository network', { 
        error: (error as Error).message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create network',
        message: (error as Error).message
      });
    }
  }

  /**
   * Remove networks for a repository
   */
  async removeRepositoryNetworks(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { repository } = req.params;
      const { force } = req.query;

      await networkIsolation.removeRepositoryNetwork(
        repository, 
        force === 'true'
      );

      logger.info('Removed repository networks', {
        repository,
        force: force === 'true',
        requestedBy: req.user?.username
      });

      res.json({
        success: true,
        message: `Networks for repository ${repository} removed successfully`
      });

    } catch (error) {
      logger.error('Failed to remove repository networks', { 
        repository: req.params.repository,
        error: (error as Error).message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to remove networks',
        message: (error as Error).message
      });
    }
  }

  /**
   * Clean up unused networks
   */
  async cleanupNetworks(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { maxIdleMinutes } = req.body;
      const idleMinutes = maxIdleMinutes || 60;

      const removedCount = await networkIsolation.cleanupUnusedNetworks(idleMinutes);

      logger.info('Network cleanup completed', {
        removedCount,
        maxIdleMinutes: idleMinutes,
        requestedBy: req.user?.username
      });

      res.json({
        success: true,
        data: {
          removedCount,
          maxIdleMinutes: idleMinutes,
          timestamp: new Date()
        }
      });

    } catch (error) {
      logger.error('Network cleanup failed', { 
        error: (error as Error).message 
      });
      res.status(500).json({
        success: false,
        error: 'Network cleanup failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Verify network isolation between containers
   */
  async verifyIsolation(req: Request, res: Response): Promise<void> {
    try {
      const { container1, container2 } = req.query;

      if (!container1 || !container2) {
        res.status(400).json({
          success: false,
          error: 'Both container1 and container2 parameters are required'
        });
        return;
      }

      const isIsolated = await networkIsolation.verifyNetworkIsolation(
        container1 as string,
        container2 as string
      );

      res.json({
        success: true,
        data: {
          container1,
          container2,
          isolated: isIsolated,
          message: isIsolated 
            ? 'Containers are properly isolated'
            : 'Containers can communicate (not isolated)'
        }
      });

    } catch (error) {
      logger.error('Failed to verify network isolation', { 
        error: (error as Error).message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to verify network isolation',
        message: (error as Error).message
      });
    }
  }

  /**
   * Attach container to network
   */
  async attachContainer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { containerId, repository, aliases } = req.body;

      if (!containerId || !repository) {
        res.status(400).json({
          success: false,
          error: 'Container ID and repository are required'
        });
        return;
      }

      await networkIsolation.attachContainerToNetwork(
        containerId,
        repository,
        aliases
      );

      logger.info('Attached container to network', {
        containerId,
        repository,
        requestedBy: req.user?.username
      });

      res.json({
        success: true,
        message: `Container ${containerId} attached to ${repository} network`
      });

    } catch (error) {
      logger.error('Failed to attach container to network', { 
        error: (error as Error).message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to attach container',
        message: (error as Error).message
      });
    }
  }

  /**
   * Detach container from network
   */
  async detachContainer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { containerId, repository } = req.body;

      if (!containerId || !repository) {
        res.status(400).json({
          success: false,
          error: 'Container ID and repository are required'
        });
        return;
      }

      await networkIsolation.detachContainerFromNetwork(
        containerId,
        repository
      );

      logger.info('Detached container from network', {
        containerId,
        repository,
        requestedBy: req.user?.username
      });

      res.json({
        success: true,
        message: `Container ${containerId} detached from ${repository} network`
      });

    } catch (error) {
      logger.error('Failed to detach container from network', { 
        error: (error as Error).message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to detach container',
        message: (error as Error).message
      });
    }
  }
}

export default new NetworkController();