import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import ServiceManager from '../services/service-manager';
import VaultService from '../services/vault-service';
import HAManager from '../services/ha-manager';
import { config } from '../config';

const logger = createLogger('SystemController');

export class SystemController {
  private haManager?: HAManager;

  constructor() {
    // Get HA Manager instance from service manager when needed
    const serviceManager = ServiceManager.getInstance();
    if (serviceManager.hasService('haManager')) {
      this.haManager = serviceManager.getService<HAManager>('haManager');
    }
  }
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

  /**
   * Get High Availability status
   */
  async getHAStatus(_req: Request, res: Response): Promise<void> {
    try {
      if (!config.ha.enabled) {
        res.json({
          success: true,
          data: {
            enabled: false,
            mode: 'single-node',
            nodeId: config.ha.nodeId,
            message: 'High Availability is disabled'
          }
        });
        return;
      }

      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.hasService('haManager')) {
        res.status(503).json({
          success: false,
          error: 'HA Manager not available'
        });
        return;
      }

      const haManager = serviceManager.getService<HAManager>('haManager');
      const haStatus = haManager.getStatus();

      res.json({
        success: true,
        data: haStatus
      });

    } catch (error) {
      logger.error('HA status check failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'HA status check failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Get comprehensive HA health status
   */
  async getHAHealth(_req: Request, res: Response): Promise<void> {
    try {
      if (!config.ha.enabled) {
        res.json({
          success: true,
          data: {
            enabled: false,
            status: 'healthy',
            message: 'Running in single-node mode'
          }
        });
        return;
      }

      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.hasService('haManager')) {
        res.status(503).json({
          success: false,
          error: 'HA Manager not available'
        });
        return;
      }

      const haManager = serviceManager.getService<HAManager>('haManager');
      const healthStatus = await haManager.forceHealthCheck();

      const statusCode = healthStatus?.overall.status === 'healthy' ? 200 : 
                        healthStatus?.overall.status === 'degraded' ? 206 : 503;

      res.status(statusCode).json({
        success: true,
        data: healthStatus
      });

    } catch (error) {
      logger.error('HA health check failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'HA health check failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Get database health with replication status
   */
  async getDatabaseHealthHA(_req: Request, res: Response): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.hasService('haManager')) {
        // Fall back to basic database status
        return this.getDatabaseStatus(_req, res);
      }

      const haManager = serviceManager.getService<HAManager>('haManager');
      const healthStatus = await haManager.forceHealthCheck();

      if (!healthStatus) {
        res.status(503).json({
          success: false,
          error: 'Unable to retrieve database health'
        });
        return;
      }

      const dbHealth = {
        primary: healthStatus.database.primary,
        replica: healthStatus.database.replica,
        replicationLag: healthStatus.database.replicationLag,
        currentConnection: config.ha.database.enableReadReplica ? 'primary' : 'single'
      };

      const isHealthy = dbHealth.primary.status === 'healthy';
      const statusCode = isHealthy ? 200 : 503;

      res.status(statusCode).json({
        success: isHealthy,
        data: dbHealth
      });

    } catch (error) {
      logger.error('HA database health check failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'HA database health check failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Get Redis health with Sentinel status
   */
  async getRedisHealthHA(_req: Request, res: Response): Promise<void> {
    try {
      if (!config.ha.enabled || !config.ha.redis.enableSentinel) {
        res.json({
          success: true,
          data: {
            mode: 'single-instance',
            sentinel: false,
            status: 'healthy'
          }
        });
        return;
      }

      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.hasService('haManager')) {
        res.status(503).json({
          success: false,
          error: 'HA Manager not available'
        });
        return;
      }

      const haManager = serviceManager.getService<HAManager>('haManager');
      const healthStatus = await haManager.forceHealthCheck();

      if (!healthStatus) {
        res.status(503).json({
          success: false,
          error: 'Unable to retrieve Redis health'
        });
        return;
      }

      const redisHealth = {
        master: healthStatus.redis.master,
        slave: healthStatus.redis.slave,
        sentinel: healthStatus.redis.sentinel,
        mode: 'sentinel-cluster'
      };

      const isHealthy = redisHealth.master.status === 'healthy';
      const statusCode = isHealthy ? 200 : 503;

      res.status(statusCode).json({
        success: isHealthy,
        data: redisHealth
      });

    } catch (error) {
      logger.error('HA Redis health check failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'HA Redis health check failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Force leader election (admin only)
   */
  async forceLeaderElection(_req: Request, res: Response): Promise<void> {
    try {
      if (!config.ha.enabled || !config.ha.leaderElection.enabled) {
        res.status(400).json({
          success: false,
          error: 'Leader election not enabled'
        });
        return;
      }

      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.hasService('haManager')) {
        res.status(503).json({
          success: false,
          error: 'HA Manager not available'
        });
        return;
      }

      const haManager = serviceManager.getService<HAManager>('haManager');
      await haManager.forceElection();

      res.json({
        success: true,
        message: 'Leader election forced',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Force leader election failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Force leader election failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Get cluster information
   */
  async getClusterInfo(_req: Request, res: Response): Promise<void> {
    try {
      if (!config.ha.enabled) {
        res.json({
          success: true,
          data: {
            mode: 'single-node',
            nodes: [config.ha.nodeId],
            currentNode: config.ha.nodeId,
            clusterSize: 1
          }
        });
        return;
      }

      const serviceManager = ServiceManager.getInstance();
      
      if (!serviceManager.hasService('haManager')) {
        res.status(503).json({
          success: false,
          error: 'HA Manager not available'
        });
        return;
      }

      const haManager = serviceManager.getService<HAManager>('haManager');
      const haStatus = haManager.getStatus();

      res.json({
        success: true,
        data: {
          mode: 'high-availability',
          nodes: config.ha.clusterNodes,
          currentNode: config.ha.nodeId,
          clusterSize: config.ha.clusterNodes.length,
          leader: haStatus.currentLeader,
          isLeader: haStatus.isLeader,
          services: haStatus.services
        }
      });

    } catch (error) {
      logger.error('Cluster info retrieval failed', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Cluster info retrieval failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * Get PostgreSQL replication status
   */
  async getPostgresReplicationStatus(_req: Request, res: Response): Promise<void> {
    try {
      if (!this.haManager) {
        res.status(503).json({
          success: false,
          error: 'HA Manager not available'
        });
        return;
      }

      const dbHealth = await this.haManager.getDatabaseHealth();
      const dbMetrics = await this.haManager.getDatabaseMetrics();
      
      res.json({
        success: true,
        data: {
          health: dbHealth,
          metrics: dbMetrics,
          timestamp: new Date()
        }
      });
    } catch (error) {
      logger.error('Failed to get PostgreSQL replication status', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get PostgreSQL replication status'
      });
    }
  }

  /**
   * Trigger PostgreSQL failover
   */
  async triggerPostgresFailover(req: Request, res: Response): Promise<void> {
    try {
      const { target, reason } = req.body;
      
      if (!target || !['primary', 'replica'].includes(target)) {
        res.status(400).json({
          success: false,
          error: 'Invalid failover target. Must be "primary" or "replica"'
        });
        return;
      }
      
      if (!this.haManager) {
        res.status(500).json({
          success: false,
          error: 'HA Manager not available'
        });
        return;
      }
      
      // Get the Database HA service
      const databaseHA = (this.haManager as any).databaseHA;
      if (!databaseHA) {
        res.status(500).json({
          success: false,
          error: 'Database HA service not available'
        });
        return;
      }
      
      const failoverEvent = await databaseHA.performFailover(
        target, 
        reason || `Manual failover triggered via API to ${target}`
      );
      
      res.json({
        success: true,
        data: {
          failover: failoverEvent,
          timestamp: new Date()
        }
      });
      
    } catch (error) {
      logger.error('Failed to trigger PostgreSQL failover', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to trigger PostgreSQL failover'
      });
    }
  }

  /**
   * Get PostgreSQL connection pool status
   */
  async getPostgresPoolStatus(_req: Request, res: Response): Promise<void> {
    try {
      if (!this.haManager) {
        res.status(500).json({
          success: false,
          error: 'HA Manager not available'
        });
        return;
      }
      
      const metrics = await this.haManager.getDatabaseMetrics();
      
      res.json({
        success: true,
        data: {
          pools: {
            primary: {
              connections: metrics?.primaryConnections || 0
            },
            replica: {
              connections: metrics?.replicaConnections || 0
            }
          },
          replication: {
            lagBytes: metrics?.replicationLagBytes || 0,
            lagSeconds: metrics?.replicationLagSeconds || 0
          },
          failover: {
            count: metrics?.failoverCount || 0,
            lastFailover: metrics?.lastFailover || null
          },
          uptime: metrics?.uptime || 0,
          timestamp: new Date()
        }
      });
      
    } catch (error) {
      logger.error('Failed to get PostgreSQL pool status', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get PostgreSQL pool status'
      });
    }
  }
}

export default new SystemController();