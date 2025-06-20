import { Router } from 'express';
import { ScalingController } from '../controllers/scaling-controller';

const router = Router();
const scalingController = new ScalingController();

// Scaling policies
router.get('/policies', scalingController.getPolicies.bind(scalingController));
router.get('/policies/:repository', scalingController.getPolicy.bind(scalingController));
router.put('/policies/:repository', scalingController.updatePolicy.bind(scalingController));

// Metrics and history
router.get('/metrics/history', scalingController.getMetricsHistory.bind(scalingController));
router.get('/metrics/predictions/:repository', scalingController.getPredictions.bind(scalingController));
router.get('/metrics/recommendations', scalingController.getRecommendations.bind(scalingController));

// Actions
router.post('/evaluate/:repository', scalingController.evaluateNow.bind(scalingController));

// Dashboard
router.get('/dashboard', scalingController.getDashboardData.bind(scalingController));

export default router;