import { Router } from 'express';
import { RunnerController } from '../controllers/runner-controller';

const router = Router();
const runnerController = new RunnerController();

// Runner management
router.get('/', runnerController.listRunners.bind(runnerController));
router.get('/:id', runnerController.getRunner.bind(runnerController));
router.delete('/:id', runnerController.removeRunner.bind(runnerController));

// Pool management
router.get('/pools', runnerController.listPools.bind(runnerController));
router.get('/pools/:repository', runnerController.getPool.bind(runnerController));
router.put('/pools/:repository', runnerController.updatePool.bind(runnerController));
router.post('/pools/:repository/scale', runnerController.scalePool.bind(runnerController));

// Metrics
router.get('/pools/:repository/metrics', runnerController.getPoolMetrics.bind(runnerController));

export default router;