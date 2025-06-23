import { Router } from 'express';
import { RoutingController } from '../controllers/routing-controller';
import { asyncHandler } from '../middleware/async-handler';
import authMiddleware from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();
const routingController = new RoutingController();

// Apply rate limiting and authentication to all routes
router.use(rateLimiter);
router.use(authMiddleware.authenticate());

// Get all routing rules
router.get('/rules', asyncHandler(routingController.getRoutingRules));

// Get routing analytics
router.get('/analytics', asyncHandler(routingController.getRoutingAnalytics));

// Get suggested labels
router.get('/labels/suggestions', asyncHandler(routingController.getSuggestedLabels));

// Get specific routing rule
router.get('/rules/:id', asyncHandler(routingController.getRoutingRule));

// Create new routing rule
router.post('/rules', asyncHandler(routingController.createRoutingRule));

// Update routing rule
router.put('/rules/:id', asyncHandler(routingController.updateRoutingRule));

// Delete routing rule
router.delete('/rules/:id', asyncHandler(routingController.deleteRoutingRule));

// Test routing rule
router.post('/test', asyncHandler(routingController.testRoutingRule));

// Preview routing for a job
router.post('/preview', asyncHandler(routingController.previewRouting));

export default router;