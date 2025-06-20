import { Router } from 'express';
import securityController from '../controllers/security-controller';
import authMiddleware from '../middleware/auth';

const router = Router();

/**
 * Security scanning routes
 * All routes require authentication
 */

// Apply authentication to all security routes
router.use(authMiddleware.authenticate());

// POST /api/security/scan - Scan an image (operator+)
router.post('/scan',
  authMiddleware.authorize(['admin', 'operator']),
  securityController.scanImage.bind(securityController)
);

// GET /api/security/scans - Get scan results (viewer+)
router.get('/scans',
  authMiddleware.authorize(['admin', 'operator', 'viewer']),
  securityController.getScanResults.bind(securityController)
);

// GET /api/security/scans/:scanId - Get specific scan result (viewer+)
router.get('/scans/:scanId',
  authMiddleware.authorize(['admin', 'operator', 'viewer']),
  securityController.getScanResult.bind(securityController)
);

// GET /api/security/policies - Get security policies (viewer+)
router.get('/policies',
  authMiddleware.authorize(['admin', 'operator', 'viewer']),
  securityController.getPolicies.bind(securityController)
);

// POST /api/security/policies - Create/update policy (admin only)
router.post('/policies',
  authMiddleware.authorize('admin'),
  securityController.upsertPolicy.bind(securityController)
);

// POST /api/security/check-policy - Check scan against policy (operator+)
router.post('/check-policy',
  authMiddleware.authorize(['admin', 'operator']),
  securityController.checkPolicy.bind(securityController)
);

// GET /api/security/stats - Get vulnerability statistics (viewer+)
router.get('/stats',
  authMiddleware.authorize(['admin', 'operator', 'viewer']),
  securityController.getVulnerabilityStats.bind(securityController)
);

// GET /api/security/vulnerabilities/:scanId - Get vulnerabilities for scan (viewer+)
router.get('/vulnerabilities/:scanId',
  authMiddleware.authorize(['admin', 'operator', 'viewer']),
  securityController.getVulnerabilities.bind(securityController)
);

// GET /api/security/export/:scanId - Export scan results (operator+)
router.get('/export/:scanId',
  authMiddleware.authorize(['admin', 'operator']),
  securityController.exportScanResult.bind(securityController)
);

export default router;