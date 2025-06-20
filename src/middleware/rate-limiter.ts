import { Request, Response, NextFunction } from 'express';
import config from '../config';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

export const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = config.security.apiRateWindow;
  const limit = config.security.apiRateLimit;

  if (!store[key] || store[key].resetTime < now) {
    store[key] = {
      count: 1,
      resetTime: now + windowMs
    };
  } else {
    store[key].count++;
  }

  if (store[key].count > limit) {
    res.status(429).json({
      success: false,
      error: 'Too many requests'
    });
    return;
  }

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', limit.toString());
  res.setHeader('X-RateLimit-Remaining', (limit - store[key].count).toString());
  res.setHeader('X-RateLimit-Reset', store[key].resetTime.toString());

  next();
};

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach(key => {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  });
}, 60000);