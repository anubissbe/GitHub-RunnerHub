# Rate Limiting - Request Throttling Strategies

## Overview

Rate limiting is a crucial security and performance strategy that controls the number of requests a client can make to an API within a specified time window. GitHub RunnerHub implements sophisticated rate limiting to protect against abuse, ensure fair usage, and maintain system stability.

## Official Resources

- **OWASP Rate Limiting Guide**: https://owasp.org/www-community/controls/Blocking_Brute_Force_Attacks
- **GitHub API Rate Limiting**: https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting
- **Express Rate Limit**: https://github.com/nfriedly/express-rate-limit
- **Redis Rate Limiting**: https://redis.io/commands/incr#pattern-rate-limiter
- **Sliding Window Algorithm**: https://konghq.com/blog/how-to-design-a-scalable-rate-limiting-algorithm

## Integration with GitHub RunnerHub

### Basic Rate Limiting Implementation

```javascript
// middleware/rate-limiter.js
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('redis');

const redis = Redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379
});

// Basic rate limiter
const basicLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:basic:'
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
  onLimitReached: (req, res, options) => {
    console.log(`Rate limit exceeded for IP: ${req.ip}`);
    // Log to monitoring system
    logRateLimitEvent(req.ip, 'basic', 'exceeded');
  }
});

// Strict rate limiter for sensitive endpoints
const strictLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:strict:'
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  message: {
    error: 'Too many requests to sensitive endpoint',
    retryAfter: '1 minute'
  }
});

// Authentication rate limiter
const authLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:auth:'
  }),
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 login attempts per 15 minutes
  skipSuccessfulRequests: true, // Don't count successful requests
  message: {
    error: 'Too many authentication attempts, please try again later'
  }
});

module.exports = {
  basicLimiter,
  strictLimiter,
  authLimiter
};
```

### Advanced Multi-Tier Rate Limiting

```javascript
// Advanced rate limiting with multiple tiers
class AdvancedRateLimiter {
  constructor(redis) {
    this.redis = redis;
    this.tiers = {
      // Tier 1: Per-second burst protection
      burst: {
        window: 1000, // 1 second
        limit: 10,
        prefix: 'rl:burst:'
      },
      // Tier 2: Per-minute sustained rate
      sustained: {
        window: 60 * 1000, // 1 minute
        limit: 60,
        prefix: 'rl:sustained:'
      },
      // Tier 3: Per-hour volume protection
      volume: {
        window: 60 * 60 * 1000, // 1 hour
        limit: 1000,
        prefix: 'rl:volume:'
      }
    };
  }

  async checkLimits(identifier, endpoint = 'default') {
    const checks = await Promise.all(
      Object.entries(this.tiers).map(([tier, config]) =>
        this.checkTier(identifier, endpoint, tier, config)
      )
    );

    // Find the most restrictive tier that's exceeded
    const exceeded = checks.find(check => check.exceeded);
    
    if (exceeded) {
      return {
        allowed: false,
        tier: exceeded.tier,
        resetTime: exceeded.resetTime,
        remaining: 0
      };
    }

    // Return the most restrictive remaining count
    const remaining = Math.min(...checks.map(check => check.remaining));
    
    return {
      allowed: true,
      remaining,
      resetTime: Math.max(...checks.map(check => check.resetTime))
    };
  }

  async checkTier(identifier, endpoint, tier, config) {
    const key = `${config.prefix}${identifier}:${endpoint}`;
    const now = Date.now();
    const windowStart = now - config.window;

    // Use Redis sorted set for sliding window
    const multi = this.redis.multi();
    
    // Remove old entries
    multi.zremrangebyscore(key, 0, windowStart);
    
    // Count current requests
    multi.zcard(key);
    
    // Add current request
    multi.zadd(key, now, `${now}-${Math.random()}`);
    
    // Set expiration
    multi.expire(key, Math.ceil(config.window / 1000));
    
    const results = await multi.exec();
    const currentCount = results[1][1];

    return {
      tier,
      exceeded: currentCount >= config.limit,
      remaining: Math.max(0, config.limit - currentCount - 1),
      resetTime: now + config.window
    };
  }
}

// Middleware wrapper
const createAdvancedLimiter = (redis) => {
  const limiter = new AdvancedRateLimiter(redis);
  
  return async (req, res, next) => {
    const identifier = req.ip;
    const endpoint = req.route?.path || req.path;
    
    try {
      const result = await limiter.checkLimits(identifier, endpoint);
      
      // Set headers
      res.set({
        'X-RateLimit-Remaining': result.remaining,
        'X-RateLimit-Reset': new Date(result.resetTime).toISOString()
      });
      
      if (!result.allowed) {
        res.set('Retry-After', Math.ceil((result.resetTime - Date.now()) / 1000));
        return res.status(429).json({
          error: 'Rate limit exceeded',
          tier: result.tier,
          retryAfter: result.resetTime
        });
      }
      
      next();
    } catch (error) {
      console.error('Rate limiting error:', error);
      // Fail open - allow request if rate limiter fails
      next();
    }
  };
};
```

### User-Based Rate Limiting

```javascript
// User-specific rate limiting
class UserRateLimiter {
  constructor(redis) {
    this.redis = redis;
    this.userTiers = {
      'free': { limit: 100, window: 60 * 60 * 1000 }, // 100/hour
      'pro': { limit: 1000, window: 60 * 60 * 1000 }, // 1000/hour
      'enterprise': { limit: 10000, window: 60 * 60 * 1000 } // 10000/hour
    };
  }

  async checkUserLimit(userId, userTier = 'free') {
    const config = this.userTiers[userTier];
    if (!config) {
      throw new Error(`Unknown user tier: ${userTier}`);
    }

    const key = `user_rate_limit:${userId}`;
    const now = Date.now();
    const windowStart = now - config.window;

    // Get current usage
    const current = await this.redis.zcount(key, windowStart, now);
    
    if (current >= config.limit) {
      const oldestEntry = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
      const resetTime = oldestEntry.length > 0 
        ? parseInt(oldestEntry[1]) + config.window 
        : now + config.window;

      return {
        allowed: false,
        remaining: 0,
        resetTime,
        tier: userTier
      };
    }

    // Add current request
    await this.redis.zadd(key, now, `${now}-${Math.random()}`);
    await this.redis.expire(key, Math.ceil(config.window / 1000));

    return {
      allowed: true,
      remaining: config.limit - current - 1,
      resetTime: now + config.window,
      tier: userTier
    };
  }
}

// Apply user-based limiting
const userRateLimiter = new UserRateLimiter(redis);

const userLimitMiddleware = async (req, res, next) => {
  if (!req.user) {
    return next(); // Skip if no authenticated user
  }

  try {
    const result = await userRateLimiter.checkUserLimit(req.user.id, req.user.tier);
    
    res.set({
      'X-RateLimit-Limit': result.limit,
      'X-RateLimit-Remaining': result.remaining,
      'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
      'X-RateLimit-Tier': result.tier
    });

    if (!result.allowed) {
      return res.status(429).json({
        error: 'User rate limit exceeded',
        tier: result.tier,
        retryAfter: result.resetTime
      });
    }

    next();
  } catch (error) {
    console.error('User rate limiting error:', error);
    next();
  }
};
```

## Configuration Best Practices

### 1. Dynamic Rate Limiting

```javascript
// Dynamic rate limits based on system load
class DynamicRateLimiter {
  constructor(redis) {
    this.redis = redis;
    this.baseRates = {
      '/api/runners': { limit: 100, window: 60000 },
      '/api/workflows': { limit: 50, window: 60000 },
      '/api/metrics': { limit: 200, window: 60000 }
    };
  }

  async getSystemLoad() {
    // Get system metrics
    const cpuUsage = await this.getCPUUsage();
    const memoryUsage = await this.getMemoryUsage();
    const activeConnections = await this.getActiveConnections();
    
    return {
      cpu: cpuUsage,
      memory: memoryUsage,
      connections: activeConnections
    };
  }

  calculateDynamicRate(baseRate, systemLoad) {
    let multiplier = 1;
    
    // Reduce rate if CPU is high
    if (systemLoad.cpu > 80) {
      multiplier *= 0.5;
    } else if (systemLoad.cpu > 60) {
      multiplier *= 0.75;
    }
    
    // Reduce rate if memory is high
    if (systemLoad.memory > 85) {
      multiplier *= 0.5;
    } else if (systemLoad.memory > 70) {
      multiplier *= 0.8;
    }
    
    // Reduce rate if too many connections
    if (systemLoad.connections > 1000) {
      multiplier *= 0.6;
    }
    
    return {
      limit: Math.floor(baseRate.limit * multiplier),
      window: baseRate.window
    };
  }

  async checkDynamicLimit(endpoint, identifier) {
    const baseRate = this.baseRates[endpoint] || this.baseRates.default;
    const systemLoad = await this.getSystemLoad();
    const dynamicRate = this.calculateDynamicRate(baseRate, systemLoad);
    
    return this.checkLimit(identifier, endpoint, dynamicRate);
  }
}
```

### 2. Whitelist and Blacklist

```javascript
// IP whitelist/blacklist functionality
class IPFilterRateLimiter {
  constructor(redis) {
    this.redis = redis;
    this.whitelist = new Set(process.env.IP_WHITELIST?.split(',') || []);
    this.blacklist = new Set();
  }

  async addToBlacklist(ip, duration = 24 * 60 * 60 * 1000) {
    await this.redis.setex(`blacklist:${ip}`, Math.floor(duration / 1000), '1');
    this.blacklist.add(ip);
  }

  async removeFromBlacklist(ip) {
    await this.redis.del(`blacklist:${ip}`);
    this.blacklist.delete(ip);
  }

  async isBlacklisted(ip) {
    if (this.blacklist.has(ip)) {
      return true;
    }
    
    const result = await this.redis.get(`blacklist:${ip}`);
    if (result) {
      this.blacklist.add(ip);
      return true;
    }
    
    return false;
  }

  isWhitelisted(ip) {
    return this.whitelist.has(ip);
  }

  async checkAccess(ip) {
    if (this.isWhitelisted(ip)) {
      return { allowed: true, reason: 'whitelisted' };
    }
    
    if (await this.isBlacklisted(ip)) {
      return { allowed: false, reason: 'blacklisted' };
    }
    
    return { allowed: true, reason: 'normal' };
  }
}

// Middleware
const ipFilterMiddleware = (ipFilter) => {
  return async (req, res, next) => {
    const ip = req.ip;
    const access = await ipFilter.checkAccess(ip);
    
    if (!access.allowed) {
      return res.status(403).json({
        error: 'Access denied',
        reason: access.reason
      });
    }
    
    // Skip rate limiting for whitelisted IPs
    if (access.reason === 'whitelisted') {
      req.skipRateLimit = true;
    }
    
    next();
  };
};
```

### 3. Endpoint-Specific Configuration

```javascript
// Different rate limits for different endpoints
const endpointConfigs = {
  '/api/auth/login': {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    skipSuccessfulRequests: true,
    message: 'Too many login attempts'
  },
  '/api/runners': {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: 'Runner API rate limit exceeded'
  },
  '/api/workflows': {
    windowMs: 60 * 1000,
    max: 20,
    message: 'Workflow API rate limit exceeded'
  },
  '/api/metrics': {
    windowMs: 60 * 1000,
    max: 60, // Higher limit for metrics
    message: 'Metrics API rate limit exceeded'
  }
};

// Create endpoint-specific limiters
const createEndpointLimiters = () => {
  const limiters = {};
  
  for (const [endpoint, config] of Object.entries(endpointConfigs)) {
    limiters[endpoint] = rateLimit({
      store: new RedisStore({
        client: redis,
        prefix: `rl:${endpoint.replace(/\//g, ':')}:`
      }),
      ...config
    });
  }
  
  return limiters;
};

// Apply to routes
const endpointLimiters = createEndpointLimiters();

app.use('/api/auth/login', endpointLimiters['/api/auth/login']);
app.use('/api/runners', endpointLimiters['/api/runners']);
app.use('/api/workflows', endpointLimiters['/api/workflows']);
app.use('/api/metrics', endpointLimiters['/api/metrics']);
```

## Security Considerations

### 1. Distributed Rate Limiting

```javascript
// Redis-based distributed rate limiting
class DistributedRateLimiter {
  constructor(redis) {
    this.redis = redis;
    this.luaScript = `
      local key = KEYS[1]
      local window = tonumber(ARGV[1])
      local limit = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      
      -- Remove expired entries
      redis.call('zremrangebyscore', key, 0, now - window)
      
      -- Count current entries
      local current = redis.call('zcard', key)
      
      if current < limit then
        -- Add current request
        redis.call('zadd', key, now, now .. '-' .. math.random())
        redis.call('expire', key, math.ceil(window / 1000))
        return {1, limit - current - 1}
      else
        return {0, 0}
      end
    `;
  }

  async checkLimit(key, window, limit) {
    const now = Date.now();
    const result = await this.redis.eval(
      this.luaScript,
      1,
      key,
      window,
      limit,
      now
    );
    
    return {
      allowed: result[0] === 1,
      remaining: result[1]
    };
  }
}
```

### 2. Rate Limit Bypass Protection

```javascript
// Protect against rate limit bypass attempts
class RateLimitBypassProtection {
  constructor(redis) {
    this.redis = redis;
    this.suspiciousActivity = new Map();
  }

  async detectBypassAttempts(req) {
    const ip = req.ip;
    const userAgent = req.get('User-Agent');
    const xForwardedFor = req.get('X-Forwarded-For');
    
    // Check for suspicious patterns
    const suspiciousIndicators = [];
    
    // Multiple user agents from same IP
    const userAgentKey = `ua:${ip}`;
    await this.redis.sadd(userAgentKey, userAgent);
    await this.redis.expire(userAgentKey, 3600); // 1 hour
    const userAgentCount = await this.redis.scard(userAgentKey);
    
    if (userAgentCount > 10) {
      suspiciousIndicators.push('multiple_user_agents');
    }
    
    // X-Forwarded-For header manipulation
    if (xForwardedFor && xForwardedFor.split(',').length > 5) {
      suspiciousIndicators.push('suspicious_forwarded_headers');
    }
    
    // Rapid IP changes
    if (req.headers['x-real-ip'] !== ip) {
      suspiciousIndicators.push('ip_inconsistency');
    }
    
    // Store suspicious activity
    if (suspiciousIndicators.length > 0) {
      const key = `suspicious:${ip}`;
      await this.redis.incr(key);
      await this.redis.expire(key, 3600);
      
      const suspiciousCount = await this.redis.get(key);
      
      if (suspiciousCount > 5) {
        // Temporarily blacklist
        await this.redis.setex(`blacklist:${ip}`, 3600, '1');
        return { suspicious: true, action: 'blacklisted' };
      }
      
      return { suspicious: true, indicators: suspiciousIndicators };
    }
    
    return { suspicious: false };
  }
}
```

### 3. DoS Attack Protection

```javascript
// Advanced DoS protection
class DoSProtection {
  constructor(redis) {
    this.redis = redis;
    this.attackThresholds = {
      requests_per_second: 50,
      requests_per_minute: 500,
      concurrent_connections: 100
    };
  }

  async detectDoSPattern(ip) {
    const now = Date.now();
    const patterns = [];
    
    // Check request frequency
    const requestKey = `dos:requests:${ip}`;
    await this.redis.zadd(requestKey, now, now);
    await this.redis.expire(requestKey, 60);
    
    // Count requests in last second
    const lastSecond = await this.redis.zcount(requestKey, now - 1000, now);
    if (lastSecond > this.attackThresholds.requests_per_second) {
      patterns.push('high_frequency');
    }
    
    // Count requests in last minute
    const lastMinute = await this.redis.zcount(requestKey, now - 60000, now);
    if (lastMinute > this.attackThresholds.requests_per_minute) {
      patterns.push('volume_attack');
    }
    
    // Check for coordinated attacks
    const coordinatedKey = `dos:coordinated:${Math.floor(now / 1000)}`;
    await this.redis.sadd(coordinatedKey, ip);
    await this.redis.expire(coordinatedKey, 10);
    
    const uniqueIPs = await this.redis.scard(coordinatedKey);
    if (uniqueIPs > 20) {
      patterns.push('coordinated_attack');
    }
    
    return {
      isAttack: patterns.length > 0,
      patterns,
      severity: this.calculateSeverity(patterns)
    };
  }

  calculateSeverity(patterns) {
    if (patterns.includes('coordinated_attack')) return 'high';
    if (patterns.includes('volume_attack')) return 'medium';
    if (patterns.includes('high_frequency')) return 'low';
    return 'none';
  }

  async applyProtection(ip, severity) {
    switch (severity) {
      case 'high':
        await this.redis.setex(`blacklist:${ip}`, 86400, '1'); // 24 hours
        break;
      case 'medium':
        await this.redis.setex(`blacklist:${ip}`, 3600, '1'); // 1 hour
        break;
      case 'low':
        await this.redis.setex(`blacklist:${ip}`, 300, '1'); // 5 minutes
        break;
    }
  }
}
```

## Monitoring and Debugging

### 1. Rate Limit Metrics

```javascript
// Rate limiting metrics collection
class RateLimitMetrics {
  constructor(redis) {
    this.redis = redis;
    this.metrics = {
      requests_allowed: 0,
      requests_blocked: 0,
      unique_ips: new Set(),
      endpoints: new Map(),
      top_blocked_ips: new Map()
    };
  }

  recordRequest(ip, endpoint, allowed) {
    this.metrics.unique_ips.add(ip);
    
    if (!this.metrics.endpoints.has(endpoint)) {
      this.metrics.endpoints.set(endpoint, { allowed: 0, blocked: 0 });
    }
    
    const endpointStats = this.metrics.endpoints.get(endpoint);
    
    if (allowed) {
      this.metrics.requests_allowed++;
      endpointStats.allowed++;
    } else {
      this.metrics.requests_blocked++;
      endpointStats.blocked++;
      
      // Track blocked IPs
      const currentCount = this.metrics.top_blocked_ips.get(ip) || 0;
      this.metrics.top_blocked_ips.set(ip, currentCount + 1);
    }
  }

  getMetrics() {
    return {
      requests_allowed: this.metrics.requests_allowed,
      requests_blocked: this.metrics.requests_blocked,
      block_rate: this.metrics.requests_blocked / 
                  (this.metrics.requests_allowed + this.metrics.requests_blocked),
      unique_ips: this.metrics.unique_ips.size,
      endpoints: Object.fromEntries(this.metrics.endpoints),
      top_blocked_ips: Object.fromEntries(
        [...this.metrics.top_blocked_ips.entries()]
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
      )
    };
  }

  async persistMetrics() {
    const metrics = this.getMetrics();
    const key = `rate_limit_metrics:${Date.now()}`;
    await this.redis.setex(key, 3600, JSON.stringify(metrics));
  }
}

// Middleware to collect metrics
const metricsMiddleware = (metrics) => {
  return (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      const allowed = res.statusCode !== 429;
      metrics.recordRequest(req.ip, req.path, allowed);
      return originalSend.call(this, data);
    };
    
    next();
  };
};
```

### 2. Rate Limit Alerting

```javascript
// Alert system for rate limiting events
class RateLimitAlerting {
  constructor(redis, notificationService) {
    this.redis = redis;
    this.notificationService = notificationService;
    this.alertThresholds = {
      block_rate: 0.1, // 10% of requests blocked
      unique_blocked_ips: 50,
      coordinated_attacks: 3
    };
  }

  async checkAlerts() {
    const metrics = await this.getRecentMetrics();
    
    // Check block rate threshold
    if (metrics.block_rate > this.alertThresholds.block_rate) {
      await this.sendAlert('high_block_rate', {
        current_rate: metrics.block_rate,
        threshold: this.alertThresholds.block_rate
      });
    }
    
    // Check for coordinated attacks
    const coordinatedAttacks = await this.detectCoordinatedAttacks();
    if (coordinatedAttacks.count > this.alertThresholds.coordinated_attacks) {
      await this.sendAlert('coordinated_attack', coordinatedAttacks);
    }
  }

  async sendAlert(type, data) {
    const alert = {
      type,
      data,
      timestamp: new Date().toISOString(),
      severity: this.determineAlertSeverity(type)
    };
    
    // Send to monitoring system
    await this.notificationService.send(alert);
    
    // Log alert
    console.log(`[ALERT] ${type}:`, alert);
  }
}
```

### 3. Dashboard Integration

```javascript
// API endpoint for rate limiting dashboard
app.get('/api/admin/rate-limits', authenticateAdmin, async (req, res) => {
  try {
    const metrics = await rateLimitMetrics.getMetrics();
    const recentAlerts = await rateLimitAlerting.getRecentAlerts();
    const topBlockedIPs = await getTopBlockedIPs();
    const endpointStats = await getEndpointStats();
    
    res.json({
      metrics,
      alerts: recentAlerts,
      blocked_ips: topBlockedIPs,
      endpoints: endpointStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to manually manage IP blacklist
app.post('/api/admin/blacklist', authenticateAdmin, async (req, res) => {
  const { ip, duration = 3600, reason } = req.body;
  
  try {
    await redis.setex(`blacklist:${ip}`, duration, reason);
    
    // Log the action
    console.log(`Admin blacklisted IP ${ip} for ${duration}s: ${reason}`);
    
    res.json({
      success: true,
      ip,
      duration,
      reason,
      expires_at: new Date(Date.now() + duration * 1000).toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## Performance Optimization

### 1. Efficient Rate Limit Storage

```javascript
// Optimized Redis operations for rate limiting
class OptimizedRateLimiter {
  constructor(redis) {
    this.redis = redis;
    
    // Pre-compiled Lua scripts for atomic operations
    this.scripts = {
      slidingWindow: redis.defineCommand('slidingWindow', {
        numberOfKeys: 1,
        lua: `
          local key = KEYS[1]
          local window = tonumber(ARGV[1])
          local limit = tonumber(ARGV[2])
          local now = tonumber(ARGV[3])
          
          -- Clean old entries and count
          redis.call('zremrangebyscore', key, 0, now - window)
          local current = redis.call('zcard', key)
          
          if current < limit then
            redis.call('zadd', key, now, now)
            redis.call('expire', key, math.ceil(window / 1000))
            return {1, limit - current - 1, now + window}
          else
            local oldest = redis.call('zrange', key, 0, 0, 'withscores')
            local resetTime = oldest[2] and (tonumber(oldest[2]) + window) or (now + window)
            return {0, 0, resetTime}
          end
        `
      })
    };
  }

  async checkLimit(key, window, limit) {
    const result = await this.redis.slidingWindow(key, window, limit, Date.now());
    return {
      allowed: result[0] === 1,
      remaining: result[1],
      resetTime: result[2]
    };
  }
}
```

### 2. Memory-Efficient Tracking

```javascript
// Use bloom filters for memory-efficient IP tracking
const BloomFilter = require('bloom-filters').BloomFilter;

class MemoryEfficientRateLimiter {
  constructor(redis) {
    this.redis = redis;
    this.bloomFilter = new BloomFilter(10000, 4); // 10k elements, 4 hash functions
    this.exactCounts = new Map(); // Only store exact counts for suspected IPs
  }

  async checkRequest(ip) {
    // Quick bloom filter check
    if (!this.bloomFilter.has(ip)) {
      // First time seeing this IP
      this.bloomFilter.add(ip);
      return { allowed: true, firstTime: true };
    }
    
    // IP might be rate limited, check exact count
    if (!this.exactCounts.has(ip)) {
      const count = await this.redis.get(`rl:${ip}`);
      this.exactCounts.set(ip, parseInt(count) || 0);
    }
    
    const currentCount = this.exactCounts.get(ip);
    
    if (currentCount >= 100) { // Rate limit threshold
      return { allowed: false, count: currentCount };
    }
    
    // Increment count
    const newCount = currentCount + 1;
    this.exactCounts.set(ip, newCount);
    await this.redis.setex(`rl:${ip}`, 3600, newCount);
    
    return { allowed: true, count: newCount };
  }
}
```

## Common Issues and Solutions

### 1. Redis Connection Issues

**Problem**: Rate limiter fails when Redis is unavailable

**Solution**:
```javascript
// Fallback to in-memory rate limiting
class ResilientRateLimiter {
  constructor(redis) {
    this.redis = redis;
    this.memoryStore = new Map();
    this.redisAvailable = true;
  }

  async checkLimit(key, window, limit) {
    try {
      if (this.redisAvailable) {
        return await this.checkRedisLimit(key, window, limit);
      }
    } catch (error) {
      console.error('Redis unavailable, falling back to memory:', error);
      this.redisAvailable = false;
      
      // Retry Redis connection after 30 seconds
      setTimeout(() => {
        this.redisAvailable = true;
      }, 30000);
    }
    
    return this.checkMemoryLimit(key, window, limit);
  }

  checkMemoryLimit(key, window, limit) {
    const now = Date.now();
    
    if (!this.memoryStore.has(key)) {
      this.memoryStore.set(key, []);
    }
    
    const requests = this.memoryStore.get(key);
    
    // Remove old requests
    const validRequests = requests.filter(time => now - time < window);
    
    if (validRequests.length >= limit) {
      return { allowed: false, remaining: 0 };
    }
    
    validRequests.push(now);
    this.memoryStore.set(key, validRequests);
    
    return { allowed: true, remaining: limit - validRequests.length };
  }
}
```

### 2. Clock Synchronization

**Problem**: Distributed systems with unsynchronized clocks

**Solution**:
```javascript
// Use Redis time for consistency
class ClockSafeRateLimiter {
  constructor(redis) {
    this.redis = redis;
    this.clockOffset = 0;
  }

  async syncClock() {
    const start = Date.now();
    const redisTime = await this.redis.time();
    const end = Date.now();
    
    const networkDelay = (end - start) / 2;
    const redisTimestamp = redisTime[0] * 1000 + redisTime[1] / 1000;
    
    this.clockOffset = redisTimestamp - start + networkDelay;
  }

  getRedisTime() {
    return Date.now() + this.clockOffset;
  }

  async checkLimit(key, window, limit) {
    const now = this.getRedisTime();
    // Use Redis time for all calculations
    return this.checkWithTime(key, window, limit, now);
  }
}
```

### 3. Rate Limit Headers

**Problem**: Inconsistent rate limit headers

**Solution**:
```javascript
// Standardized rate limit headers
const setRateLimitHeaders = (res, result) => {
  res.set({
    'X-RateLimit-Limit': result.limit,
    'X-RateLimit-Remaining': result.remaining,
    'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
    'X-RateLimit-Used': result.limit - result.remaining
  });
  
  if (!result.allowed) {
    res.set('Retry-After', Math.ceil((result.resetTime - Date.now()) / 1000));
  }
};
```

## Testing Strategies

```javascript
// Rate limiting tests
describe('Rate Limiter', () => {
  let rateLimiter;
  let redis;
  
  beforeEach(async () => {
    redis = new Redis();
    rateLimiter = new RateLimiter(redis);
    await redis.flushall();
  });
  
  test('should allow requests within limit', async () => {
    const result = await rateLimiter.checkLimit('test', 60000, 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });
  
  test('should block requests exceeding limit', async () => {
    // Make 10 requests
    for (let i = 0; i < 10; i++) {
      await rateLimiter.checkLimit('test', 60000, 10);
    }
    
    const result = await rateLimiter.checkLimit('test', 60000, 10);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
  
  test('should reset after window expires', async () => {
    // Fill the limit
    for (let i = 0; i < 10; i++) {
      await rateLimiter.checkLimit('test', 1000, 10); // 1 second window
    }
    
    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    const result = await rateLimiter.checkLimit('test', 1000, 10);
    expect(result.allowed).toBe(true);
  });
});
```

## Related Technologies

- Express Rate Limit
- Redis
- Nginx rate limiting
- CloudFlare Rate Limiting
- AWS API Gateway Throttling