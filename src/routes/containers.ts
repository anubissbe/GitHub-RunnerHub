import { Router } from 'express';
import { ContainerController } from '../controllers/container-controller';
import authMiddleware from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();
const containerController = new ContainerController();

// Apply rate limiting and authentication to all routes
router.use(rateLimiter);
router.use(authMiddleware.authenticate());

// Container management
router.get('/', containerController.listContainers.bind(containerController));
router.get('/:id', containerController.getContainer.bind(containerController));
router.post('/:id/stop', containerController.stopContainer.bind(containerController));
router.delete('/:id', containerController.removeContainer.bind(containerController));

// Container operations
router.post('/:id/exec', containerController.executeCommand.bind(containerController));
router.get('/:id/stats', containerController.getContainerStats.bind(containerController));
router.get('/:id/logs', containerController.getContainerLogs.bind(containerController));

// Resource usage
router.get('/usage/summary', containerController.getResourceUsage.bind(containerController));

// Runner containers
router.get('/runner/:runnerId', containerController.getContainersByRunner.bind(containerController));

export default router;