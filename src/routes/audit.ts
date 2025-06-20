import { Router } from 'express';
import auditController from '../controllers/audit-controller';
import authMiddleware from '../middleware/auth';

const router = Router();

/**
 * Audit logging routes
 * All routes require authentication
 */

// Apply authentication to all audit routes
router.use(authMiddleware.authenticate());

// GET /api/audit/logs - Query audit logs (viewer+)
router.get('/logs', 
  authMiddleware.authorize(['admin', 'operator', 'viewer']),
  auditController.queryLogs.bind(auditController)
);

// GET /api/audit/stats - Get audit statistics (viewer+)
router.get('/stats',
  authMiddleware.authorize(['admin', 'operator', 'viewer']),
  auditController.getStats.bind(auditController)
);

// GET /api/audit/export - Export audit logs (operator+)
router.get('/export',
  authMiddleware.authorize(['admin', 'operator']),
  auditController.exportLogs.bind(auditController)
);

// GET /api/audit/event-types - Get available event types (viewer+)
router.get('/event-types',
  authMiddleware.authorize(['admin', 'operator', 'viewer']),
  auditController.getEventTypes.bind(auditController)
);

// POST /api/audit/cleanup - Cleanup old logs (admin only)
router.post('/cleanup',
  authMiddleware.authorize('admin'),
  auditController.cleanup.bind(auditController)
);

// GET /api/audit/security - Get security events (admin only)
router.get('/security',
  authMiddleware.authorize('admin'),
  auditController.getSecurityEvents.bind(auditController)
);

// GET /api/audit/users/:userId - Get user activity (operator+)
router.get('/users/:userId',
  authMiddleware.authorize(['admin', 'operator']),
  auditController.getUserActivity.bind(auditController)
);

// GET /api/audit/resources/:resourceType/:resourceId - Get resource history (operator+)
router.get('/resources/:resourceType/:resourceId',
  authMiddleware.authorize(['admin', 'operator']),
  auditController.getResourceHistory.bind(auditController)
);

export default router;