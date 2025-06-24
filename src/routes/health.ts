import { Router, Request, Response } from 'express';
import database from '../services/database';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const dbHealthy = await database.healthCheck();
    
    const health = {
      status: dbHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbHealthy ? 'pass' : 'fail'
      }
    };

    res.status(dbHealthy ? 200 : 503).json(health);
  } catch {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

export default router;