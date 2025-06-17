const crypto = require('crypto');

// Simple in-memory rate limiter (use Redis in production)
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.blockedIPs = new Set();
    
    // Clean up old entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  cleanup() {
    const now = Date.now();
    const windowSize = 900000; // 15 minutes
    
    // Clean up request records
    for (const [key, timestamps] of this.requests.entries()) {
      const filtered = timestamps.filter(time => now - time < windowSize);
      if (filtered.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, filtered);
      }
    }
  }

  getKey(req, options) {
    const { keyBy = 'ip' } = options;
    
    switch (keyBy) {
      case 'ip':
        return req.ip || req.connection.remoteAddress;
      
      case 'user':
        return req.user?.id || req.user?.userId || 'anonymous';
      
      case 'apikey':
        return req.apiKey?.id || 'no-key';
      
      case 'combined':
        // Combine multiple factors for the key
        const ip = req.ip || req.connection.remoteAddress;
        const userId = req.user?.id || req.apiKey?.id || 'anonymous';
        return `${ip}:${userId}`;
      
      default:
        return req.ip || req.connection.remoteAddress;
    }
  }

  isBlocked(key) {
    return this.blockedIPs.has(key);
  }

  block(key, duration = 3600000) {
    // Block for 1 hour by default
    this.blockedIPs.add(key);
    
    // Auto-unblock after duration
    setTimeout(() => {
      this.blockedIPs.delete(key);
    }, duration);
  }

  recordRequest(key) {
    const now = Date.now();
    
    if (!this.requests.has(key)) {
      this.requests.set(key, [now]);
    } else {
      this.requests.get(key).push(now);
    }
  }

  checkLimit(key, limit, windowMs) {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];
    
    // Filter timestamps within the window
    const recentRequests = timestamps.filter(time => now - time < windowMs);
    
    return {
      allowed: recentRequests.length < limit,
      current: recentRequests.length,
      limit,
      remaining: Math.max(0, limit - recentRequests.length),
      resetAt: recentRequests.length > 0 ? 
        new Date(recentRequests[0] + windowMs) : 
        new Date(now + windowMs)
    };
  }
}

// Create singleton instance
const rateLimiter = new RateLimiter();

// Rate limiting middleware factory
function createRateLimiter(options = {}) {
  const {
    windowMs = 900000,       // 15 minutes
    max = 100,               // Max requests per window
    message = 'Too many requests, please try again later',
    statusCode = 429,
    headers = true,          // Send rate limit headers
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyBy = 'ip',           // 'ip', 'user', 'apikey', 'combined'
    skip = null,            // Function to skip rate limiting
    onLimitReached = null,  // Callback when limit is reached
    // Different limits for different auth methods
    limits = {
      anonymous: 50,        // No auth
      apikey: 200,          // API key auth
      jwt: 500,             // JWT auth
      admin: 1000           // Admin users
    }
  } = options;

  return async (req, res, next) => {
    // Skip if function provided and returns true
    if (skip && skip(req, res)) {
      return next();
    }

    // Get the key for rate limiting
    const key = rateLimiter.getKey(req, { keyBy });
    
    // Check if blocked
    if (rateLimiter.isBlocked(key)) {
      return res.status(403).json({
        error: 'Access blocked due to rate limit violations'
      });
    }

    // Determine the limit based on auth method
    let limit = max;
    if (limits) {
      if (req.user?.role === 'admin') {
        limit = limits.admin || max;
      } else if (req.user) {
        limit = limits.jwt || max;
      } else if (req.apiKey) {
        limit = limits.apikey || max;
      } else {
        limit = limits.anonymous || max;
      }
    }

    // Check rate limit
    const result = rateLimiter.checkLimit(key, limit, windowMs);
    
    // Add headers if enabled
    if (headers) {
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.resetAt.toISOString());
      res.setHeader('X-RateLimit-Window', `${windowMs}ms`);
    }

    // If limit not exceeded, continue
    if (result.allowed) {
      // Record request (before response to include failed requests)
      if (!skipSuccessfulRequests) {
        rateLimiter.recordRequest(key);
      }
      
      // Hook into response to record only on certain status codes
      if (skipFailedRequests || skipSuccessfulRequests) {
        const originalEnd = res.end;
        res.end = function(...args) {
          if (skipFailedRequests && res.statusCode >= 400) {
            // Don't count failed requests
          } else if (skipSuccessfulRequests && res.statusCode < 400) {
            // Don't count successful requests
          } else {
            rateLimiter.recordRequest(key);
          }
          originalEnd.apply(res, args);
        };
      }
      
      return next();
    }

    // Limit reached
    rateLimiter.recordRequest(key);
    
    // Check if should block (too many violations)
    const violations = result.current - result.limit;
    if (violations > 50) {
      // Block if exceeded limit by more than 50 requests
      rateLimiter.block(key);
    }

    // Call callback if provided
    if (onLimitReached) {
      onLimitReached(req, res, key, result);
    }

    // Add retry-after header
    const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);
    res.setHeader('Retry-After', retryAfter);

    // Send error response
    return res.status(statusCode).json({
      error: message,
      retryAfter,
      limit: result.limit,
      window: `${windowMs / 1000} seconds`
    });
  };
}

// Pre-configured rate limiters
const rateLimiters = {
  // Strict limit for authentication endpoints
  auth: createRateLimiter({
    windowMs: 900000,  // 15 minutes
    max: 5,            // 5 attempts per 15 minutes
    message: 'Too many authentication attempts',
    keyBy: 'ip',
    onLimitReached: (req, res, key) => {
      console.warn(`Rate limit reached for auth endpoint: ${key}`);
    }
  }),

  // Standard API limit
  api: createRateLimiter({
    windowMs: 900000,  // 15 minutes
    keyBy: 'combined',
    limits: {
      anonymous: 50,
      apikey: 500,
      jwt: 1000,
      admin: 5000
    },
    skipFailedRequests: true
  }),

  // Lenient limit for read operations
  read: createRateLimiter({
    windowMs: 300000,  // 5 minutes
    keyBy: 'combined',
    limits: {
      anonymous: 100,
      apikey: 1000,
      jwt: 2000,
      admin: 10000
    }
  }),

  // Strict limit for write operations
  write: createRateLimiter({
    windowMs: 300000,  // 5 minutes
    keyBy: 'combined',
    limits: {
      anonymous: 0,    // No anonymous writes
      apikey: 50,
      jwt: 100,
      admin: 500
    },
    message: 'Too many write operations'
  }),

  // Very strict limit for scaling operations
  scaling: createRateLimiter({
    windowMs: 3600000,  // 1 hour
    max: 10,            // 10 scaling operations per hour
    message: 'Too many scaling operations',
    keyBy: 'user'
  }),

  // Custom rate limiter factory
  custom: createRateLimiter
};

// Express middleware to apply rate limiting to all routes
function globalRateLimit(options = {}) {
  const limiter = createRateLimiter({
    windowMs: 900000,  // 15 minutes
    max: 1000,         // 1000 requests per 15 minutes
    ...options
  });

  return limiter;
}

module.exports = {
  rateLimiter,
  createRateLimiter,
  rateLimiters,
  globalRateLimit
};