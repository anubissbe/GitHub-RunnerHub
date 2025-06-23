import { Router } from 'express';
import webhookController from '../controllers/webhook-controller';
import { asyncHandler } from '../middleware/async-handler';
import { validateWebhookSignature } from '../middleware/webhook-middleware';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     WebhookEvent:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique event identifier
 *         repository:
 *           type: string
 *           description: Repository full name
 *         event:
 *           type: string
 *           description: GitHub event type
 *         action:
 *           type: string
 *           description: Event action
 *         payload:
 *           type: object
 *           description: Full webhook payload
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: When the event was received
 *         processed:
 *           type: boolean
 *           description: Whether the event has been processed
 */

/**
 * @swagger
 * /api/webhooks/github:
 *   post:
 *     summary: Receive GitHub webhook
 *     tags: [Webhooks]
 *     description: Endpoint for receiving GitHub webhook events
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: GitHub webhook payload
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request or invalid signature
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error
 */
router.post('/github', 
  rateLimiter,
  validateWebhookSignature,
  asyncHandler(webhookController.handleGitHubWebhook)
);

/**
 * @swagger
 * /api/webhooks/events:
 *   get:
 *     summary: Get webhook events
 *     tags: [Webhooks]
 *     description: Retrieve webhook events with optional filtering
 *     parameters:
 *       - in: query
 *         name: repository
 *         schema:
 *           type: string
 *         description: Filter by repository full name
 *       - in: query
 *         name: event
 *         schema:
 *           type: string
 *         description: Filter by event type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of events to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of events to skip
 *     responses:
 *       200:
 *         description: Webhook events retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     events:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/WebhookEvent'
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 */
router.get('/events', asyncHandler(webhookController.getWebhookEvents));

/**
 * @swagger
 * /api/webhooks/statistics:
 *   get:
 *     summary: Get webhook statistics
 *     tags: [Webhooks]
 *     description: Get webhook processing statistics
 *     parameters:
 *       - in: query
 *         name: hours
 *         schema:
 *           type: integer
 *           default: 24
 *         description: Time window in hours
 *     responses:
 *       200:
 *         description: Webhook statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     timeWindow:
 *                       type: string
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalEvents:
 *                           type: integer
 *                         processedEvents:
 *                           type: integer
 *                         pendingEvents:
 *                           type: integer
 *                     byEvent:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           event:
 *                             type: string
 *                           total:
 *                             type: integer
 *                           processed:
 *                             type: integer
 *                           pending:
 *                             type: integer
 */
router.get('/statistics', asyncHandler(webhookController.getWebhookStatistics));

/**
 * @swagger
 * /api/webhooks/health:
 *   get:
 *     summary: Get webhook health status
 *     tags: [Webhooks]
 *     description: Check webhook service health and recent activity
 *     responses:
 *       200:
 *         description: Webhook health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                     recentEvents:
 *                       type: integer
 *                     lastEventTime:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     hourlyStats:
 *                       type: array
 */
router.get('/health', asyncHandler(webhookController.getWebhookHealth));

/**
 * @swagger
 * /api/webhooks/test:
 *   post:
 *     summary: Test webhook endpoint
 *     tags: [Webhooks]
 *     description: Send a test webhook event (development only)
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               eventType:
 *                 type: string
 *                 default: ping
 *               repository:
 *                 type: string
 *                 default: test/repo
 *     responses:
 *       200:
 *         description: Test webhook processed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 result:
 *                   type: object
 */
router.post('/test', asyncHandler(webhookController.testWebhook));

export default router;