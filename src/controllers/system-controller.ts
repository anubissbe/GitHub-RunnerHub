import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import ServiceManager from '../services/service-manager';
import VaultService from '../services/vault-service';

const logger = createLogger('SystemController');

export class SystemController {
  /**
   * Get overall system health
   */
  async getSystemHealth(_req: Request, res: Response): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.isInitialized()) {
        res.status(503).json({
          success: false,
          error: 'System not fully initialized',
          status: 'initializing'
        });
        return;
      }

      // Perform health checks
      await serviceManager.performHealthChecks();
      const systemHealth = serviceManager.getSystemHealth();

      const statusCode = systemHealth.overall === 'healthy' ? 200 : 
                        systemHealth.overall === 'degraded' ? 206 : 503;

      res.status(statusCode).json({
        success: true,
        data: {
          overall: systemHealth.overall,
          timestamp: new Date().toISOString(),
          services: systemHealth.services,
          summary: systemHealth.summary
        }
      });

    } catch (error) {
      logger.error('System health check failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'System health check failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Get detailed service health
   */
  async getServiceHealth(req: Request, res: Response): Promise<void> {
    try {
      const { serviceName } = req.params;
      const serviceManager = ServiceManager.getInstance();

      const serviceHealth = serviceManager.getServiceHealth(serviceName);
      
      if (!serviceHealth) {
        res.status(404).json({
          success: false,
          error: `Service '${serviceName}' not found`
        });
        return;
      }

      res.json({
        success: true,
        data: serviceHealth
      });

    } catch (error) {
      logger.error('Service health check failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Service health check failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Get Vault status and information
   */
  async getVaultStatus(_req: Request, res: Response): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.hasService('vault')) {
        res.status(503).json({
          success: false,
          error: 'Vault service not available'
        });
        return;
      }

      const vaultService = serviceManager.getService<VaultService>('vault');
      
      // Get vault health and token info
      const [health, tokenInfo] = await Promise.all([
        vaultService.checkHealth(),
        vaultService.getTokenInfo()
      ]);

      res.json({
        success: true,
        data: {
          health: {
            initialized: health.initialized,
            sealed: health.sealed,
            standby: health.standby,
            version: health.version
          },
          token: {
            policies: tokenInfo.policies,
            ttl: tokenInfo.ttl,
            renewable: tokenInfo.renewable,
            displayName: tokenInfo.display_name
          },
          status: 'connected',
          lastCheck: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Vault status check failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Vault status check failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Rotate system secrets (requires admin access)
   */
  async rotateSecrets(req: Request, res: Response): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.hasService('vault')) {
        res.status(503).json({
          success: false,
          error: 'Vault service not available for secret rotation'
        });
        return;
      }

      logger.info('Starting secret rotation', { requestedBy: req.ip });

      await serviceManager.rotateSecrets();

      res.json({
        success: true,
        message: 'Secret rotation initiated successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Secret rotation failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Secret rotation failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Get database connection status
   */
  async getDatabaseStatus(_req: Request, res: Response): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.hasService('database')) {
        res.status(503).json({
          success: false,
          error: 'Database service not available'
        });
        return;
      }

      const database = serviceManager.getService<any>('database');
      const isHealthy = await database.checkHealth();

      res.status(isHealthy ? 200 : 503).json({
        success: isHealthy,
        data: {
          status: isHealthy ? 'connected' : 'disconnected',
          lastCheck: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Database status check failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Database status check failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Get system configuration (non-sensitive parts)
   */
  async getSystemConfig(_req: Request, res: Response): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      const systemHealth = serviceManager.getSystemHealth();

      res.json({
        success: true,
        data: {
          environment: process.env.NODE_ENV || 'development',
          version: process.env.npm_package_version || '1.0.0',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          services: {
            vault: serviceManager.hasService('vault'),
            database: serviceManager.hasService('database')
          },
          health: systemHealth.overall
        }
      });

    } catch (error) {
      logger.error('System config retrieval failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'System config retrieval failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Test Vault connectivity and permissions
   */
  async testVaultConnection(_req: Request, res: Response): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.hasService('vault')) {
        res.status(503).json({
          success: false,
          error: 'Vault service not available'
        });
        return;
      }

      const vaultService = serviceManager.getService<VaultService>('vault');
      
      // Test basic connectivity
      const health = await vaultService.checkHealth();
      
      // Test secret access (using a test path)
      const testResults = {
        connectivity: true,
        health: health,
        secretAccess: {
          github: false,
          database: false,
          redis: false
        }
      };

      // Test access to known secret paths
      try {
        await vaultService.getGitHubSecrets();
        testResults.secretAccess.github = true;
      } catch (error) {
        logger.debug('GitHub secrets not accessible', { error: (error as Error).message });
      }

      try {
        await vaultService.getDatabaseCredentials();
        testResults.secretAccess.database = true;
      } catch (error) {
        logger.debug('Database credentials not accessible', { error: (error as Error).message });
      }

      try {
        await vaultService.getRedisCredentials();
        testResults.secretAccess.redis = true;
      } catch (error) {
        logger.debug('Redis credentials not accessible', { error: (error as Error).message });
      }

      res.json({
        success: true,
        data: testResults
      });

    } catch (error) {
      logger.error('Vault connection test failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Vault connection test failed',
        message: (error as Error).message
      });
    }
  }
}

export default new SystemController();