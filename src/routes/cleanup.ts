import { Router } from 'express';
import { CleanupController } from '../controllers/cleanup-controller';
import { asyncHandler } from '../middleware/async-handler';
import authMiddleware from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();
const cleanupController = new CleanupController();

// Apply rate limiting and authentication to all routes
router.use(rateLimiter);
router.use(authMiddleware.authenticate());

// Get all cleanup policies
router.get('/policies', asyncHandler(cleanupController.getCleanupPolicies));

// Get cleanup history
router.get('/history', asyncHandler(cleanupController.getCleanupHistory));

// Get last cleanup result
router.get('/last-result', asyncHandler(cleanupController.getLastCleanupResult));

// Get cleanup statistics
router.get('/statistics', asyncHandler(cleanupController.getCleanupStatistics));

// Preview cleanup (dry run)
router.get('/preview', asyncHandler(cleanupController.previewCleanup));

// Get specific cleanup policy
router.get('/policies/:id', asyncHandler(cleanupController.getCleanupPolicy));

// Update cleanup policy
router.put('/policies/:id', asyncHandler(cleanupController.updateCleanupPolicy));

// Trigger manual cleanup
router.post('/trigger', asyncHandler(cleanupController.triggerCleanup));

export default router;