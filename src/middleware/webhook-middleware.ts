import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('WebhookMiddleware');

/**
 * Middleware to validate GitHub webhook signatures
 */
export function validateWebhookSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const signature = req.get('X-Hub-Signature-256');
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    // Skip validation if no secret is configured
    if (!webhookSecret) {
      logger.warn('GitHub webhook secret not configured - skipping signature validation');
      next();
      return;
    }

    if (!signature) {
      logger.warn('Missing webhook signature');
      res.status(401).json({
        success: false,
        error: 'Missing webhook signature'
      });
      return;
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    const actualSignature = signature.replace('sha256=', '');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(actualSignature, 'hex')
    );

    if (!isValid) {
      logger.warn('Invalid webhook signature', {
        deliveryId: req.get('X-GitHub-Delivery'),
        event: req.get('X-GitHub-Event')
      });
      
      res.status(401).json({
        success: false,
        error: 'Invalid webhook signature'
      });
      return;
    }

    logger.debug('Webhook signature validated successfully');
    next();

  } catch (error) {
    logger.error('Error validating webhook signature', { error });
    res.status(500).json({
      success: false,
      error: 'Error validating webhook signature'
    });
  }
}

/**
 * Middleware to log webhook requests
 */
export function logWebhookRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const eventType = req.get('X-GitHub-Event');
  const deliveryId = req.get('X-GitHub-Delivery');
  const userAgent = req.get('User-Agent');

  logger.info('Webhook request received', {
    eventType,
    deliveryId,
    userAgent,
    repository: req.body?.repository?.full_name,
    action: req.body?.action,
    contentLength: req.get('Content-Length'),
    ip: req.ip
  });

  // Log response when finished
  const originalSend = res.send;
  res.send = function(body: any) {
    logger.info('Webhook response sent', {
      deliveryId,
      statusCode: res.statusCode,
      responseTime: Date.now() - req.timestamp
    });
    return originalSend.call(this, body);
  };

  next();
}

/**
 * Middleware to rate limit webhook requests
 */
export function rateLimitWebhooks(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  // Basic rate limiting - in production, use Redis-based rate limiting
  const deliveryId = req.get('X-GitHub-Delivery');
  const repository = req.body?.repository?.full_name;

  // For now, just log the request - implement proper rate limiting as needed
  logger.debug('Webhook rate limit check', {
    deliveryId,
    repository,
    ip: req.ip
  });

  next();
}

/**
 * Middleware to validate required headers
 */
export function validateWebhookHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const eventType = req.get('X-GitHub-Event');
  const deliveryId = req.get('X-GitHub-Delivery');

  if (!eventType) {
    res.status(400).json({
      success: false,
      error: 'Missing X-GitHub-Event header'
    });
    return;
  }

  if (!deliveryId) {
    res.status(400).json({
      success: false,
      error: 'Missing X-GitHub-Delivery header'
    });
    return;
  }

  next();
}

/**
 * Middleware to parse and validate webhook payload
 */
export function validateWebhookPayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Ensure we have a valid JSON payload
    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({
        success: false,
        error: 'Invalid or missing JSON payload'
      });
      return;
    }

    // Add timestamp for processing metrics
    req.timestamp = Date.now();

    next();

  } catch (error) {
    logger.error('Error validating webhook payload', { error });
    res.status(400).json({
      success: false,
      error: 'Invalid JSON payload'
    });
  }
}

// Extend Request interface to include timestamp
declare module 'express-serve-static-core' {
  interface Request {
    timestamp: number;
  }
}