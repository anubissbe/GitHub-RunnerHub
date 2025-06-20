import { Router } from 'express';

const router = Router();

// Placeholder - will be implemented with Prometheus integration
router.get('/', (_req, res) => {
  res.json({ success: true, data: {} });
});

export default router;