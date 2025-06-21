import { Router } from 'express';
import cacheController from '../controllers/cache-controller';
import authMiddleware from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';

const router = Router();

// Get cache metrics
router.get('/metrics', asyncHandler(cacheController.getMetrics));

// Clear cache operations (require authentication)
router.delete('/tag/:tag', authMiddleware.authenticate(), asyncHandler(cacheController.clearByTag));
router.delete('/pattern/:pattern', authMiddleware.authenticate(), asyncHandler(cacheController.clearByPattern));
router.delete('/all', authMiddleware.authenticate(), asyncHandler(cacheController.clearAll));
router.delete('/repository/:owner/:repo', authMiddleware.authenticate(), asyncHandler(cacheController.clearRepository));
router.delete('/organization/:org', authMiddleware.authenticate(), asyncHandler(cacheController.clearOrganization));

// Warm up cache
router.post('/warmup', authMiddleware.authenticate(), asyncHandler(cacheController.warmUp));

export default router;