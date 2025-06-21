import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { getGitHubAPIClient } from '../services/github-api-enhanced';
import { getGitHubCacheService } from '../services/github-cache-service';

const logger = createLogger('CacheController');

export class CacheController {
  /**
   * Get cache metrics
   */
  async getMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const githubAPI = getGitHubAPIClient();
      const metrics = githubAPI.getCombinedMetrics();
      
      res.json({
        success: true,
        metrics
      });
    } catch (error) {
      logger.error('Error getting cache metrics', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get cache metrics'
      });
    }
  }

  /**
   * Clear cache by tag
   */
  async clearByTag(req: Request, res: Response): Promise<void> {
    try {
      const { tag } = req.params;
      
      if (!tag) {
        res.status(400).json({
          success: false,
          error: 'Tag parameter is required'
        });
        return;
      }

      const cacheService = getGitHubCacheService();
      const count = await cacheService.invalidateByTag(tag);
      
      logger.info(`Cleared ${count} cache entries with tag: ${tag}`);
      
      res.json({
        success: true,
        message: `Cleared ${count} cache entries`,
        tag
      });
    } catch (error) {
      logger.error('Error clearing cache by tag', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear cache'
      });
    }
  }

  /**
   * Clear cache by pattern
   */
  async clearByPattern(req: Request, res: Response): Promise<void> {
    try {
      const { pattern } = req.params;
      
      if (!pattern) {
        res.status(400).json({
          success: false,
          error: 'Pattern parameter is required'
        });
        return;
      }

      const cacheService = getGitHubCacheService();
      const count = await cacheService.invalidateByPattern(pattern);
      
      logger.info(`Cleared ${count} cache entries matching pattern: ${pattern}`);
      
      res.json({
        success: true,
        message: `Cleared ${count} cache entries`,
        pattern
      });
    } catch (error) {
      logger.error('Error clearing cache by pattern', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear cache'
      });
    }
  }

  /**
   * Clear all cache
   */
  async clearAll(_req: Request, res: Response): Promise<void> {
    try {
      const cacheService = getGitHubCacheService();
      await cacheService.clearAll();
      
      logger.info('Cleared all cache entries');
      
      res.json({
        success: true,
        message: 'Cleared all cache entries'
      });
    } catch (error) {
      logger.error('Error clearing all cache', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear cache'
      });
    }
  }

  /**
   * Clear repository cache
   */
  async clearRepository(req: Request, res: Response): Promise<void> {
    try {
      const { owner, repo } = req.params;
      
      if (!owner || !repo) {
        res.status(400).json({
          success: false,
          error: 'Owner and repo parameters are required'
        });
        return;
      }

      const githubAPI = getGitHubAPIClient();
      await githubAPI.invalidateRepositoryCache(owner, repo);
      
      logger.info(`Cleared cache for repository: ${owner}/${repo}`);
      
      res.json({
        success: true,
        message: `Cleared cache for repository ${owner}/${repo}`
      });
    } catch (error) {
      logger.error('Error clearing repository cache', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear repository cache'
      });
    }
  }

  /**
   * Clear organization cache
   */
  async clearOrganization(req: Request, res: Response): Promise<void> {
    try {
      const { org } = req.params;
      
      if (!org) {
        res.status(400).json({
          success: false,
          error: 'Organization parameter is required'
        });
        return;
      }

      const githubAPI = getGitHubAPIClient();
      await githubAPI.invalidateOrganizationCache(org);
      
      logger.info(`Cleared cache for organization: ${org}`);
      
      res.json({
        success: true,
        message: `Cleared cache for organization ${org}`
      });
    } catch (error) {
      logger.error('Error clearing organization cache', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear organization cache'
      });
    }
  }

  /**
   * Warm up cache with frequently accessed data
   */
  async warmUp(req: Request, res: Response): Promise<void> {
    try {
      const { endpoints } = req.body;
      
      if (!Array.isArray(endpoints)) {
        res.status(400).json({
          success: false,
          error: 'Endpoints must be an array'
        });
        return;
      }

      const cacheService = getGitHubCacheService();
      await cacheService.warmUp(endpoints);
      
      logger.info(`Warmed up cache with ${endpoints.length} endpoints`);
      
      res.json({
        success: true,
        message: `Warmed up cache with ${endpoints.length} endpoints`
      });
    } catch (error) {
      logger.error('Error warming up cache', error);
      res.status(500).json({
        success: false,
        error: 'Failed to warm up cache'
      });
    }
  }
}

export default new CacheController();