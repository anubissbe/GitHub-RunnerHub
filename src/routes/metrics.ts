import { Router } from 'express';
import authMiddleware from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();

// Apply authentication and rate limiting to all routes
router.use(authMiddleware.authenticate());
router.use(rateLimiter);

// Placeholder - will be implemented with Prometheus integration
router.get('/', (_req, res) => {
  res.json({ success: true, data: {} });
});

export default router;