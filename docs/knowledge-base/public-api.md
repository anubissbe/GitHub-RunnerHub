# Public API - Unauthenticated Endpoints Design

## Overview

Public APIs are endpoints that can be accessed without authentication, providing essential functionality for external integrations, monitoring, and public information. GitHub RunnerHub implements selective public endpoints with careful security considerations and rate limiting.

## Official Resources

- **REST API Design**: https://restfulapi.net/
- **OpenAPI Specification**: https://swagger.io/specification/
- **API Security Best Practices**: https://owasp.org/www-project-api-security/
- **Rate Limiting for Public APIs**: https://cloud.google.com/endpoints/docs/openapi/quotas-configure
- **CORS for Public APIs**: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS

## Integration with GitHub RunnerHub

### Public Endpoint Structure

```javascript
// routes/public.js
const express = require('express');
const router = express.Router();
const { publicRateLimiter } = require('../middleware/rate-limiter');
const { validatePublicRequest } = require('../middleware/validation');

// Apply rate limiting to all public endpoints
router.use(publicRateLimiter);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
    uptime: process.uptime()
  });
});

// System status endpoint
router.get('/status', async (req, res) => {
  try {
    const status = await getSystemStatus();
    res.json({
      system: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to retrieve system status',
      timestamp: new Date().toISOString()
    });
  }
});

// Public metrics endpoint (aggregated, non-sensitive)
router.get('/metrics', async (req, res) => {
  try {
    const metrics = await getPublicMetrics();
    res.json({
      data: metrics,
      timestamp: new Date().toISOString(),
      disclaimer: 'Aggregated metrics for public consumption'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to retrieve metrics',
      timestamp: new Date().toISOString()
    });
  }
});

// Runner statistics (anonymized)
router.get('/runners/stats', async (req, res) => {
  try {
    const stats = await getAnonymizedRunnerStats();
    res.json({
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to retrieve runner statistics',
      timestamp: new Date().toISOString()
    });
  }
});

// Webhook endpoint for GitHub
router.post('/webhooks/github', 
  validateGitHubWebhook,
  async (req, res) => {
    try {
      await processGitHubWebhook(req.body, req.headers);
      res.status(200).json({ received: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

// API documentation endpoint
router.get('/docs', (req, res) => {
  res.json({
    name: 'GitHub RunnerHub Public API',
    version: '1.0.0',
    description: 'Public endpoints for GitHub RunnerHub',
    endpoints: {
      '/health': 'System health check',
      '/status': 'System status information',
      '/metrics': 'Public metrics (aggregated)',
      '/runners/stats': 'Anonymous runner statistics',
      '/webhooks/github': 'GitHub webhook endpoint',
      '/docs': 'This documentation'
    },
    limits: {
      rateLimit: '100 requests per hour per IP',
      dataRetention: '24 hours for public metrics'
    }
  });
});

module.exports = router;
```

### Public Metrics Implementation

```javascript
// services/public-metrics.js
class PublicMetricsService {
  constructor(db, redis) {
    this.db = db;
    this.redis = redis;
    this.cacheTimeout = 300; // 5 minutes
  }

  async getPublicMetrics() {
    const cacheKey = 'public_metrics';
    
    // Check cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const metrics = await this.calculateMetrics();
    
    // Cache the result
    await this.redis.setex(cacheKey, this.cacheTimeout, JSON.stringify(metrics));
    
    return metrics;
  }

  async calculateMetrics() {
    // Aggregate non-sensitive metrics
    const [
      totalRunners,
      activeRunners,
      completedJobs,
      systemLoad
    ] = await Promise.all([
      this.getTotalRunners(),
      this.getActiveRunners(),
      this.getCompletedJobsCount(),
      this.getSystemLoad()
    ]);

    return {
      runners: {
        total: totalRunners,
        active: activeRunners,
        utilization: activeRunners / Math.max(totalRunners, 1)
      },
      jobs: {
        completed_24h: completedJobs.last24h,
        completed_7d: completedJobs.last7d,
        success_rate: completedJobs.successRate
      },
      system: {
        load: systemLoad,
        status: this.determineSystemStatus(systemLoad)
      },
      timestamp: new Date().toISOString()
    };
  }

  async getTotalRunners() {
    return await this.db.runners.countDocuments({ isActive: true });
  }

  async getActiveRunners() {
    return await this.db.runners.countDocuments({ 
      isActive: true, 
      status: 'busy' 
    });
  }

  async getCompletedJobsCount() {
    const now = new Date();
    const last24h = new Date(now - 24 * 60 * 60 * 1000);
    const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [jobs24h, jobs7d, successfulJobs] = await Promise.all([
      this.db.jobs.countDocuments({ 
        completedAt: { $gte: last24h },
        status: { $in: ['success', 'failure'] }
      }),
      this.db.jobs.countDocuments({ 
        completedAt: { $gte: last7d },
        status: { $in: ['success', 'failure'] }
      }),
      this.db.jobs.countDocuments({ 
        completedAt: { $gte: last7d },
        status: 'success'
      })
    ]);

    return {
      last24h: jobs24h,
      last7d: jobs7d,
      successRate: jobs7d > 0 ? successfulJobs / jobs7d : 0
    };
  }

  async getSystemLoad() {
    // Get system metrics without sensitive information
    const cpuUsage = await this.getCPUUsage();
    const memoryUsage = await this.getMemoryUsage();
    
    return {
      cpu: Math.round(cpuUsage * 100) / 100,
      memory: Math.round(memoryUsage * 100) / 100,
      status: this.determineLoadStatus(cpuUsage, memoryUsage)
    };
  }

  determineSystemStatus(load) {
    if (load.cpu > 90 || load.memory > 90) return 'high';
    if (load.cpu > 70 || load.memory > 70) return 'medium';
    return 'normal';
  }
}
```

### Webhook Handler

```javascript
// services/webhook-handler.js
const crypto = require('crypto');

class WebhookHandler {
  constructor(secretKey) {
    this.secretKey = secretKey;
  }

  validateGitHubWebhook(payload, signature) {
    if (!signature) {
      throw new Error('No signature provided');
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('hex');

    const providedSignature = signature.replace('sha256=', '');

    if (!crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(providedSignature, 'hex')
    )) {
      throw new Error('Invalid signature');
    }

    return true;
  }

  async processWebhook(event, payload) {
    console.log(`Processing webhook event: ${event}`);

    switch (event) {
      case 'workflow_run':
        return await this.handleWorkflowRun(payload);
      case 'workflow_job':
        return await this.handleWorkflowJob(payload);
      case 'repository':
        return await this.handleRepositoryEvent(payload);
      default:
        console.log(`Unhandled webhook event: ${event}`);
        return { processed: false, reason: 'Unhandled event type' };
    }
  }

  async handleWorkflowRun(payload) {
    const { action, workflow_run, repository } = payload;
    
    // Update workflow run status
    await this.updateWorkflowRun({
      id: workflow_run.id,
      status: workflow_run.status,
      conclusion: workflow_run.conclusion,
      repository: repository.full_name,
      createdAt: new Date(workflow_run.created_at),
      updatedAt: new Date(workflow_run.updated_at)
    });

    // Trigger scaling decisions if needed
    if (action === 'requested') {
      await this.triggerScalingCheck(repository.full_name);
    }

    return { processed: true, action, workflowId: workflow_run.id };
  }

  async handleWorkflowJob(payload) {
    const { action, workflow_job, repository } = payload;
    
    // Track job metrics
    await this.trackJobMetrics({
      jobId: workflow_job.id,
      status: workflow_job.status,
      conclusion: workflow_job.conclusion,
      repository: repository.full_name,
      runnerName: workflow_job.runner_name,
      duration: this.calculateJobDuration(workflow_job)
    });

    return { processed: true, action, jobId: workflow_job.id };
  }

  calculateJobDuration(job) {
    if (job.started_at && job.completed_at) {
      return new Date(job.completed_at) - new Date(job.started_at);
    }
    return null;
  }
}

// Middleware for webhook validation
const validateGitHubWebhook = (req, res, next) => {
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];
  
  if (!event) {
    return res.status(400).json({ error: 'Missing GitHub event header' });
  }

  try {
    const webhookHandler = new WebhookHandler(process.env.GITHUB_WEBHOOK_SECRET);
    webhookHandler.validateGitHubWebhook(JSON.stringify(req.body), signature);
    
    req.githubEvent = event;
    next();
  } catch (error) {
    console.error('Webhook validation failed:', error.message);
    return res.status(403).json({ error: 'Invalid webhook signature' });
  }
};
```

## Configuration Best Practices

### 1. Rate Limiting for Public APIs

```javascript
// Enhanced rate limiting for public endpoints
const createPublicRateLimiter = (redis) => {
  return rateLimit({
    store: new RedisStore({
      client: redis,
      prefix: 'rl:public:'
    }),
    windowMs: 60 * 60 * 1000, // 1 hour
    max: (req) => {
      // Different limits based on endpoint
      const endpointLimits = {
        '/health': 120, // 2 per minute
        '/metrics': 60,  // 1 per minute
        '/status': 60,
        '/runners/stats': 30,
        '/webhooks/github': 1000 // Higher for webhooks
      };
      
      return endpointLimits[req.path] || 60;
    },
    message: (req) => ({
      error: 'Public API rate limit exceeded',
      limit: req.rateLimit.limit,
      resetTime: new Date(Date.now() + req.rateLimit.resetTime).toISOString(),
      endpoint: req.path
    }),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks from known monitors
      if (req.path === '/health' && this.isKnownMonitor(req)) {
        return true;
      }
      return false;
    }
  });
};

// Identify known monitoring services
const isKnownMonitor = (req) => {
  const monitorUserAgents = [
    'StatusCake',
    'Pingdom',
    'UptimeRobot',
    'Datadog'
  ];
  
  const userAgent = req.get('User-Agent') || '';
  return monitorUserAgents.some(monitor => userAgent.includes(monitor));
};
```

### 2. Response Caching

```javascript
// Intelligent caching for public endpoints
class PublicAPICache {
  constructor(redis) {
    this.redis = redis;
    this.cacheConfigs = {
      '/health': { ttl: 30, vary: false },
      '/status': { ttl: 60, vary: false },
      '/metrics': { ttl: 300, vary: false },
      '/runners/stats': { ttl: 300, vary: true }
    };
  }

  middleware() {
    return async (req, res, next) => {
      const config = this.cacheConfigs[req.path];
      
      if (!config) {
        return next(); // No caching for this endpoint
      }

      const cacheKey = this.generateCacheKey(req, config);
      
      try {
        const cached = await this.redis.get(cacheKey);
        
        if (cached) {
          const data = JSON.parse(cached);
          
          // Add cache headers
          res.set({
            'Cache-Control': `public, max-age=${config.ttl}`,
            'X-Cache': 'HIT',
            'X-Cache-Key': cacheKey
          });
          
          return res.json(data);
        }
      } catch (error) {
        console.error('Cache read error:', error);
      }

      // Store original send method
      const originalSend = res.json.bind(res);
      
      res.json = (data) => {
        // Cache the response
        this.redis.setex(cacheKey, config.ttl, JSON.stringify(data))
          .catch(err => console.error('Cache write error:', err));
        
        // Add cache headers
        res.set({
          'Cache-Control': `public, max-age=${config.ttl}`,
          'X-Cache': 'MISS',
          'X-Cache-Key': cacheKey
        });
        
        return originalSend(data);
      };

      next();
    };
  }

  generateCacheKey(req, config) {
    let key = `public_api:${req.path}`;
    
    if (config.vary) {
      // Include query parameters for variable endpoints
      const queryString = new URLSearchParams(req.query).toString();
      if (queryString) {
        key += `:${crypto.createHash('md5').update(queryString).digest('hex')}`;
      }
    }
    
    return key;
  }
}
```

### 3. Data Sanitization

```javascript
// Sanitize sensitive data for public consumption
class DataSanitizer {
  static sanitizeRunnerStats(rawStats) {
    return {
      total_runners: rawStats.total,
      active_runners: rawStats.active,
      average_utilization: Math.round(rawStats.utilization * 100) / 100,
      regions: rawStats.regions ? this.sanitizeRegions(rawStats.regions) : undefined,
      // Exclude: specific runner names, IPs, user information
      timestamp: rawStats.timestamp
    };
  }

  static sanitizeRegions(regions) {
    // Only include aggregate regional data
    return Object.entries(regions).reduce((acc, [region, count]) => {
      if (count >= 5) { // Only show regions with 5+ runners
        acc[region] = count;
      }
      return acc;
    }, {});
  }

  static sanitizeMetrics(rawMetrics) {
    return {
      system: {
        load: rawMetrics.system.load,
        status: rawMetrics.system.status
        // Exclude: specific resource usage, internal metrics
      },
      performance: {
        jobs_completed: rawMetrics.jobs.completed,
        success_rate: Math.round(rawMetrics.jobs.successRate * 100) / 100,
        average_duration: rawMetrics.jobs.averageDuration
        // Exclude: specific job details, user information
      },
      timestamp: rawMetrics.timestamp
    };
  }

  static sanitizeSystemStatus(rawStatus) {
    return {
      status: rawStatus.overall,
      components: {
        api: rawStatus.components.api ? 'operational' : 'degraded',
        runners: rawStatus.components.runners ? 'operational' : 'degraded',
        database: rawStatus.components.database ? 'operational' : 'degraded'
        // Exclude: internal component details, error messages
      },
      last_updated: rawStatus.lastUpdated,
      // Exclude: internal monitoring data, specific error details
    };
  }
}
```

## Security Considerations

### 1. Information Disclosure Prevention

```javascript
// Prevent sensitive information leakage
class PublicAPISecurityFilter {
  static filterResponse(data, endpoint) {
    const sensitiveFields = [
      'password', 'token', 'secret', 'key', 'hash',
      'email', 'ip', 'internal_id', 'user_id',
      'api_key', 'private', 'confidential'
    ];

    return this.recursiveFilter(data, sensitiveFields);
  }

  static recursiveFilter(obj, sensitiveFields) {
    if (Array.isArray(obj)) {
      return obj.map(item => this.recursiveFilter(item, sensitiveFields));
    }
    
    if (obj && typeof obj === 'object') {
      const filtered = {};
      
      for (const [key, value] of Object.entries(obj)) {
        // Check if field name contains sensitive keywords
        const isSensitive = sensitiveFields.some(field => 
          key.toLowerCase().includes(field)
        );
        
        if (!isSensitive) {
          filtered[key] = this.recursiveFilter(value, sensitiveFields);
        }
      }
      
      return filtered;
    }
    
    return obj;
  }

  static validatePublicEndpoint(req, res, next) {
    // Ensure no authentication tokens are accidentally exposed
    const removeAuthHeaders = () => {
      delete req.headers.authorization;
      delete req.headers['x-api-key'];
    };

    // Log public API access for monitoring
    console.log(`Public API access: ${req.method} ${req.path} from ${req.ip}`);

    removeAuthHeaders();
    next();
  }
}
```

### 2. CORS Configuration

```javascript
// Secure CORS configuration for public APIs
const publicCorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Allow all origins for public endpoints, but log them
    console.log(`CORS request from origin: ${origin}`);
    callback(null, true);
  },
  methods: ['GET', 'POST'], // Only allow safe methods
  allowedHeaders: [
    'Content-Type',
    'Accept',
    'User-Agent',
    'X-GitHub-Event',
    'X-Hub-Signature-256'
  ],
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-Cache'
  ],
  credentials: false, // Don't allow credentials for public APIs
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200
};

// Apply CORS to public routes
app.use('/api/public', cors(publicCorsOptions));
```

### 3. Input Validation

```javascript
// Strict input validation for public endpoints
const { body, query, param, validationResult } = require('express-validator');

const publicValidationRules = {
  // Query parameter validation
  metrics: [
    query('timeframe')
      .optional()
      .isIn(['1h', '24h', '7d', '30d'])
      .withMessage('Invalid timeframe'),
    query('format')
      .optional()
      .isIn(['json', 'csv'])
      .withMessage('Invalid format')
  ],
  
  // Webhook validation
  githubWebhook: [
    body('action')
      .notEmpty()
      .isString()
      .withMessage('Action is required'),
    body('repository.full_name')
      .notEmpty()
      .matches(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/)
      .withMessage('Invalid repository name')
  ]
};

const validatePublicRequest = (rules) => {
  return [
    ...rules,
    (req, res, next) => {
      const errors = validationResult(req);
      
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array(),
          timestamp: new Date().toISOString()
        });
      }
      
      next();
    }
  ];
};
```

## Monitoring and Analytics

### 1. Public API Analytics

```javascript
// Analytics for public API usage
class PublicAPIAnalytics {
  constructor(redis, db) {
    this.redis = redis;
    this.db = db;
  }

  async trackRequest(req, res) {
    const analytics = {
      endpoint: req.path,
      method: req.method,
      timestamp: new Date(),
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      responseStatus: res.statusCode,
      responseTime: res.getHeader('X-Response-Time'),
      cacheHit: res.getHeader('X-Cache') === 'HIT'
    };

    // Store in Redis for real-time analytics
    await this.redis.lpush(
      'public_api_requests',
      JSON.stringify(analytics)
    );
    
    // Keep only last 10000 requests
    await this.redis.ltrim('public_api_requests', 0, 9999);

    // Aggregate hourly stats
    const hourKey = `public_api_stats:${this.getHourKey()}`;
    await this.redis.hincrby(hourKey, `${req.path}:${req.method}`, 1);
    await this.redis.expire(hourKey, 7 * 24 * 3600); // Keep for 7 days
  }

  getHourKey() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}`;
  }

  async getAnalytics(timeframe = '24h') {
    const requests = await this.redis.lrange('public_api_requests', 0, -1);
    const parsedRequests = requests.map(r => JSON.parse(r));

    const cutoff = this.getCutoffTime(timeframe);
    const recentRequests = parsedRequests.filter(r => 
      new Date(r.timestamp) > cutoff
    );

    return {
      total_requests: recentRequests.length,
      unique_ips: new Set(recentRequests.map(r => r.ip)).size,
      endpoints: this.aggregateByEndpoint(recentRequests),
      status_codes: this.aggregateByStatus(recentRequests),
      cache_hit_rate: this.calculateCacheHitRate(recentRequests),
      average_response_time: this.calculateAverageResponseTime(recentRequests)
    };
  }

  getCutoffTime(timeframe) {
    const now = new Date();
    const timeframes = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    };

    return new Date(now - timeframes[timeframe]);
  }
}
```

### 2. Performance Monitoring

```javascript
// Monitor public API performance
class PublicAPIMonitor {
  constructor() {
    this.metrics = {
      requestCount: 0,
      errorCount: 0,
      totalResponseTime: 0,
      slowQueries: []
    };
  }

  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        
        this.metrics.requestCount++;
        this.metrics.totalResponseTime += responseTime;
        
        if (res.statusCode >= 400) {
          this.metrics.errorCount++;
        }
        
        // Track slow queries
        if (responseTime > 1000) { // > 1 second
          this.metrics.slowQueries.push({
            endpoint: req.path,
            method: req.method,
            responseTime,
            timestamp: new Date(),
            ip: req.ip
          });
          
          // Keep only last 100 slow queries
          if (this.metrics.slowQueries.length > 100) {
            this.metrics.slowQueries.shift();
          }
        }
      });
      
      next();
    };
  }

  getMetrics() {
    const avgResponseTime = this.metrics.requestCount > 0 
      ? this.metrics.totalResponseTime / this.metrics.requestCount 
      : 0;

    return {
      request_count: this.metrics.requestCount,
      error_count: this.metrics.errorCount,
      error_rate: this.metrics.requestCount > 0 
        ? this.metrics.errorCount / this.metrics.requestCount 
        : 0,
      average_response_time: Math.round(avgResponseTime),
      slow_queries: this.metrics.slowQueries.length,
      uptime: process.uptime()
    };
  }
}
```

## Performance Optimization

### 1. Endpoint Optimization

```javascript
// Optimized public endpoint implementations
class OptimizedPublicEndpoints {
  constructor(cache, db) {
    this.cache = cache;
    this.db = db;
  }

  // Highly optimized health check
  async health(req, res) {
    // Use cached result for most requests
    const cacheKey = 'health_check';
    let health = await this.cache.get(cacheKey);
    
    if (!health) {
      health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid
      };
      
      // Cache for 30 seconds
      await this.cache.setex(cacheKey, 30, JSON.stringify(health));
    } else {
      health = JSON.parse(health);
    }
    
    res.json(health);
  }

  // Efficient metrics with pre-aggregation
  async metrics(req, res) {
    const timeframe = req.query.timeframe || '24h';
    const cacheKey = `metrics:${timeframe}`;
    
    let metrics = await this.cache.get(cacheKey);
    
    if (!metrics) {
      metrics = await this.calculateMetricsOptimized(timeframe);
      
      // Cache based on timeframe
      const cacheTTL = {
        '1h': 60,    // 1 minute
        '24h': 300,  // 5 minutes
        '7d': 900,   // 15 minutes
        '30d': 3600  // 1 hour
      };
      
      await this.cache.setex(
        cacheKey, 
        cacheTTL[timeframe] || 300, 
        JSON.stringify(metrics)
      );
    } else {
      metrics = JSON.parse(metrics);
    }
    
    res.json(metrics);
  }

  async calculateMetricsOptimized(timeframe) {
    // Use database aggregation pipeline for efficiency
    const pipeline = [
      {
        $match: {
          timestamp: {
            $gte: this.getTimeframeCutoff(timeframe)
          }
        }
      },
      {
        $group: {
          _id: null,
          total_jobs: { $sum: 1 },
          successful_jobs: {
            $sum: {
              $cond: [{ $eq: ['$status', 'success'] }, 1, 0]
            }
          },
          avg_duration: { $avg: '$duration' }
        }
      }
    ];

    const result = await this.db.jobs.aggregate(pipeline).toArray();
    
    return {
      jobs: result[0] || { total_jobs: 0, successful_jobs: 0, avg_duration: 0 },
      timeframe,
      generated_at: new Date().toISOString()
    };
  }
}
```

### 2. Response Compression

```javascript
// Intelligent compression for public APIs
const createCompressionMiddleware = () => {
  return compression({
    filter: (req, res) => {
      // Don't compress if client doesn't support it
      if (!req.headers['accept-encoding']) {
        return false;
      }

      // Always compress JSON responses > 1KB
      if (res.getHeader('Content-Type') === 'application/json') {
        return true;
      }

      return compression.filter(req, res);
    },
    level: 6, // Balance between compression and speed
    threshold: 1024, // Only compress responses > 1KB
    memLevel: 8
  });
};
```

## Testing Public APIs

```javascript
// Comprehensive testing for public APIs
describe('Public API', () => {
  describe('Health Endpoint', () => {
    test('should return health status without authentication', async () => {
      const response = await request(app)
        .get('/api/public/health')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
    });

    test('should include cache headers', async () => {
      const response = await request(app)
        .get('/api/public/health');
      
      expect(response.headers).toHaveProperty('cache-control');
      expect(response.headers['cache-control']).toContain('public');
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits', async () => {
      // Make requests up to the limit
      for (let i = 0; i < 60; i++) {
        await request(app).get('/api/public/metrics');
      }
      
      // Next request should be rate limited
      const response = await request(app)
        .get('/api/public/metrics')
        .expect(429);
      
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Data Sanitization', () => {
    test('should not expose sensitive information', async () => {
      const response = await request(app)
        .get('/api/public/metrics')
        .expect(200);
      
      const responseString = JSON.stringify(response.body);
      
      // Check for sensitive keywords
      const sensitiveTerms = ['password', 'token', 'secret', 'private'];
      sensitiveTerms.forEach(term => {
        expect(responseString.toLowerCase()).not.toContain(term);
      });
    });
  });
});
```

## Related Technologies

- Express.js Public Routes
- API Gateway patterns
- CDN integration (CloudFlare, AWS CloudFront)
- OpenAPI/Swagger documentation
- Webhook processing frameworks