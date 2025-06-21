import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler';
import { authenticate, authorize } from '../middleware/auth';
import webhookControllerEnhanced from '../controllers/webhook-controller-enhanced';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();

// Public webhook endpoint (GitHub will call this)
router.post(
  '/github',
  asyncHandler(webhookControllerEnhanced.handleGitHubWebhook.bind(webhookControllerEnhanced))
);

// Protected management endpoints
router.use(authenticate); // All routes below require authentication

// Get webhook events with filtering
router.get(
  '/events',
  authorize('webhook:read'),
  asyncHandler(webhookControllerEnhanced.getWebhookEvents.bind(webhookControllerEnhanced))
);

// Get webhook statistics
router.get(
  '/statistics',
  authorize('webhook:read'),
  asyncHandler(webhookControllerEnhanced.getWebhookStatistics.bind(webhookControllerEnhanced))
);

// Get webhook health
router.get(
  '/health',
  authorize('webhook:read'),
  asyncHandler(webhookControllerEnhanced.getWebhookHealth.bind(webhookControllerEnhanced))
);

// Get supported event types
router.get(
  '/events/types',
  authorize('webhook:read'),
  asyncHandler(webhookControllerEnhanced.getSupportedEvents.bind(webhookControllerEnhanced))
);

// Get failed webhooks
router.get(
  '/failed',
  authorize('webhook:read'),
  asyncHandler(webhookControllerEnhanced.getFailedWebhooks.bind(webhookControllerEnhanced))
);

// Replay a specific webhook
router.post(
  '/replay/:deliveryId',
  authorize('webhook:write'),
  rateLimiter, // Additional rate limiting for replay
  asyncHandler(webhookControllerEnhanced.replayWebhook.bind(webhookControllerEnhanced))
);

// Retry all failed webhooks
router.post(
  '/retry-failed',
  authorize('webhook:write'),
  rateLimiter, // Additional rate limiting for bulk retry
  asyncHandler(webhookControllerEnhanced.retryFailedWebhooks.bind(webhookControllerEnhanced))
);

// Test webhook endpoint (for development/testing)
router.post(
  '/test',
  authorize('webhook:write'),
  asyncHandler(webhookControllerEnhanced.testWebhook.bind(webhookControllerEnhanced))
);

export default router;