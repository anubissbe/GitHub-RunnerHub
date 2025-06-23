import { Router } from 'express';
import authMiddleware from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();

// Apply rate limiting and authentication to all routes
router.use(rateLimiter);
router.use(authMiddleware.authenticate());

// Placeholder - will be implemented with Prometheus integration
router.get('/', (_req, res) => {
  res.json({ success: true, data: {} });
});

export default router;