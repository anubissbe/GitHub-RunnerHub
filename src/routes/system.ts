import { Router } from 'express';
import systemController from '../controllers/system-controller';
import authMiddleware from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();

// Apply rate limiting and authentication to all routes
router.use(rateLimiter);
router.use(authMiddleware.authenticate());

/**
 * System health and status routes
 */

// GET /api/system/health - Get overall system health
router.get('/health', systemController.getSystemHealth.bind(systemController));

// GET /api/system/services/:serviceName/health - Get specific service health
router.get('/services/:serviceName/health', systemController.getServiceHealth.bind(systemController));

// GET /api/system/vault/status - Get Vault status and information
router.get('/vault/status', systemController.getVaultStatus.bind(systemController));

// GET /api/system/vault/test - Test Vault connectivity and permissions
router.get('/vault/test', systemController.testVaultConnection.bind(systemController));

// GET /api/system/database/status - Get database connection status
router.get('/database/status', systemController.getDatabaseStatus.bind(systemController));

// GET /api/system/config - Get system configuration (non-sensitive)
router.get('/config', systemController.getSystemConfig.bind(systemController));

// POST /api/system/secrets/rotate - Rotate system secrets (admin only)
router.post('/secrets/rotate', systemController.rotateSecrets.bind(systemController));

/**
 * High Availability routes
 */

// GET /api/system/ha/status - Get HA status
router.get('/ha/status', systemController.getHAStatus.bind(systemController));

// GET /api/system/ha/health - Get comprehensive HA health status
router.get('/ha/health', systemController.getHAHealth.bind(systemController));

// GET /api/system/ha/database - Get database health with replication status
router.get('/ha/database', systemController.getDatabaseHealthHA.bind(systemController));

// GET /api/system/ha/redis - Get Redis health with Sentinel status
router.get('/ha/redis', systemController.getRedisHealthHA.bind(systemController));

// GET /api/system/ha/cluster - Get cluster information
router.get('/ha/cluster', systemController.getClusterInfo.bind(systemController));

// POST /api/system/ha/election/force - Force leader election (admin only)
router.post('/ha/election/force', systemController.forceLeaderElection.bind(systemController));

/**
 * PostgreSQL Replication routes
 */

// GET /api/system/postgres/replication - Get PostgreSQL replication status
router.get('/postgres/replication', systemController.getPostgresReplicationStatus.bind(systemController));

// GET /api/system/postgres/pools - Get PostgreSQL connection pool status
router.get('/postgres/pools', systemController.getPostgresPoolStatus.bind(systemController));

// POST /api/system/postgres/failover - Trigger PostgreSQL failover (admin only)
router.post('/postgres/failover', systemController.triggerPostgresFailover.bind(systemController));

export default router;