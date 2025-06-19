# REST API - Backend Endpoints Best Practices

## Overview

REST (Representational State Transfer) is an architectural style for building scalable web services. GitHub RunnerHub implements a RESTful API using Express.js, following industry best practices for endpoint design, error handling, and security.

## Official Resources

- **REST Architectural Constraints**: https://www.ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm
- **HTTP Status Codes**: https://httpstatuses.com/
- **OpenAPI Specification**: https://swagger.io/specification/
- **JSON:API Specification**: https://jsonapi.org/
- **REST API Design Best Practices**: https://restfulapi.net/

## Integration with GitHub RunnerHub

### API Structure

```javascript
// server.js - Main API setup
const express = require('express');
const app = express();

// Middleware
app.use(express.json());
app.use(cors(corsOptions));
app.use(helmet());
app.use(compression());

// API Routes
app.use('/api/runners', runnerRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

### RESTful Endpoint Design

```javascript
// runners.routes.js
const router = express.Router();

// GET /api/runners - List all runners
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, repo } = req.query;
    const runners = await runnerService.list({ page, limit, status, repo });
    
    res.json({
      data: runners,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: runners.total,
        totalPages: Math.ceil(runners.total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/runners/:id - Get specific runner
router.get('/:id', async (req, res) => {
  try {
    const runner = await runnerService.getById(req.params.id);
    if (!runner) {
      return res.status(404).json({ error: 'Runner not found' });
    }
    res.json({ data: runner });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/runners - Create new runner
router.post('/', validateRunnerInput, async (req, res) => {
  try {
    const runner = await runnerService.create(req.body);
    res.status(201).json({
      data: runner,
      links: {
        self: `/api/runners/${runner.id}`
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PATCH /api/runners/:id - Update runner
router.patch('/:id', async (req, res) => {
  try {
    const runner = await runnerService.update(req.params.id, req.body);
    res.json({ data: runner });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/runners/:id - Remove runner
router.delete('/:id', async (req, res) => {
  try {
    await runnerService.remove(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/runners/:id/actions/restart - Runner action
router.post('/:id/actions/restart', async (req, res) => {
  try {
    const result = await runnerService.restart(req.params.id);
    res.json({ data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

## Configuration Best Practices

### 1. API Versioning

```javascript
// Version in URL path
app.use('/api/v1/runners', runnersV1);
app.use('/api/v2/runners', runnersV2);

// Version in header
app.use((req, res, next) => {
  const version = req.headers['api-version'] || 'v1';
  req.apiVersion = version;
  next();
});

// Version in query parameter
app.get('/api/runners', (req, res) => {
  const version = req.query.version || 'v1';
  // Route to appropriate handler
});
```

### 2. Response Format Standardization

```javascript
// Standard success response
const successResponse = (res, data, statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    data: data,
    timestamp: new Date().toISOString()
  });
};

// Standard error response
const errorResponse = (res, message, statusCode = 400, errors = []) => {
  res.status(statusCode).json({
    success: false,
    error: {
      message: message,
      code: statusCode,
      errors: errors
    },
    timestamp: new Date().toISOString()
  });
};

// Paginated response
const paginatedResponse = (res, data, pagination) => {
  res.json({
    success: true,
    data: data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      totalPages: Math.ceil(pagination.total / pagination.limit),
      hasNext: pagination.page < Math.ceil(pagination.total / pagination.limit),
      hasPrev: pagination.page > 1
    },
    links: {
      first: `${req.baseUrl}?page=1&limit=${pagination.limit}`,
      last: `${req.baseUrl}?page=${Math.ceil(pagination.total / pagination.limit)}&limit=${pagination.limit}`,
      next: pagination.hasNext ? `${req.baseUrl}?page=${pagination.page + 1}&limit=${pagination.limit}` : null,
      prev: pagination.hasPrev ? `${req.baseUrl}?page=${pagination.page - 1}&limit=${pagination.limit}` : null
    }
  });
};
```

### 3. Input Validation

```javascript
// Using express-validator
const { body, validationResult } = require('express-validator');

const validateRunnerInput = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Name must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9-_]+$/)
    .withMessage('Name can only contain alphanumeric characters, hyphens, and underscores'),
  
  body('repository')
    .trim()
    .notEmpty()
    .withMessage('Repository is required')
    .matches(/^[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+$/)
    .withMessage('Invalid repository format'),
  
  body('labels')
    .optional()
    .isArray()
    .withMessage('Labels must be an array'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    next();
  }
];
```

### 4. Error Handling

```javascript
// Global error handler
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Async error wrapper
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

// Error handling middleware
app.use((err, req, res, next) => {
  const { statusCode = 500, message } = err;
  
  res.status(statusCode).json({
    success: false,
    error: {
      message: statusCode === 500 ? 'Internal Server Error' : message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
  
  // Log error
  logger.error({
    err,
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body
    }
  });
});
```

## Security Considerations

### 1. Authentication & Authorization

```javascript
// JWT authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Role-based authorization
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Apply to routes
router.post('/api/runners', authenticateToken, authorize('admin'), createRunner);
```

### 2. Input Sanitization

```javascript
// Sanitize middleware
const sanitizeInput = (req, res, next) => {
  // Recursively clean object
  const clean = (obj) => {
    for (let key in obj) {
      if (typeof obj[key] === 'string') {
        // Remove potential XSS
        obj[key] = obj[key].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        // Trim whitespace
        obj[key] = obj[key].trim();
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        clean(obj[key]);
      }
    }
  };
  
  clean(req.body);
  clean(req.query);
  clean(req.params);
  next();
};
```

### 3. CORS Configuration

```javascript
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080'];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 86400 // 24 hours
};
```

## Monitoring and Debugging

### 1. Request Logging

```javascript
// Morgan logging middleware
const morgan = require('morgan');

// Custom token for response time
morgan.token('response-time-ms', (req, res) => {
  return Math.round(res.getHeader('X-Response-Time'));
});

// Development logging
app.use(morgan('dev'));

// Production logging
app.use(morgan(':method :url :status :response-time-ms ms - :res[content-length]', {
  skip: (req, res) => res.statusCode < 400,
  stream: logger.stream
}));
```

### 2. Performance Monitoring

```javascript
// Response time middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    res.setHeader('X-Response-Time', duration);
    
    // Log slow requests
    if (duration > 1000) {
      logger.warn({
        message: 'Slow request detected',
        method: req.method,
        url: req.url,
        duration: duration,
        statusCode: res.statusCode
      });
    }
  });
  
  next();
});
```

### 3. API Documentation

```javascript
// Swagger/OpenAPI documentation
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'GitHub RunnerHub API',
      version: '1.0.0',
      description: 'API for managing GitHub Actions runners'
    },
    servers: [
      {
        url: 'http://localhost:8300/api/v1',
        description: 'Development server'
      }
    ]
  },
  apis: ['./routes/*.js']
};

const specs = swaggerJsdoc(options);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
```

## Advanced Patterns

### 1. Batch Operations

```javascript
// Batch endpoint for multiple operations
router.post('/api/runners/batch', async (req, res) => {
  const { operations } = req.body;
  const results = [];
  
  for (const op of operations) {
    try {
      let result;
      switch (op.method) {
        case 'create':
          result = await runnerService.create(op.data);
          break;
        case 'update':
          result = await runnerService.update(op.id, op.data);
          break;
        case 'delete':
          result = await runnerService.remove(op.id);
          break;
      }
      
      results.push({
        id: op.id,
        success: true,
        data: result
      });
    } catch (error) {
      results.push({
        id: op.id,
        success: false,
        error: error.message
      });
    }
  }
  
  res.json({ results });
});
```

### 2. Streaming Responses

```javascript
// Stream large datasets
router.get('/api/logs/:runnerId/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const stream = runnerService.streamLogs(req.params.runnerId);
  
  stream.on('data', (chunk) => {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  });
  
  stream.on('end', () => {
    res.write('event: end\ndata: Stream ended\n\n');
    res.end();
  });
  
  req.on('close', () => {
    stream.destroy();
  });
});
```

### 3. Conditional Requests

```javascript
// ETag support
const generateETag = (data) => {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
};

router.get('/api/runners/:id', async (req, res) => {
  const runner = await runnerService.getById(req.params.id);
  const etag = generateETag(runner);
  
  res.setHeader('ETag', etag);
  
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).send();
  }
  
  res.json({ data: runner });
});
```

## Performance Optimization

### 1. Response Compression

```javascript
const compression = require('compression');

app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6, // Balance between speed and compression
  threshold: 1024 // Only compress responses > 1KB
}));
```

### 2. Caching Strategy

```javascript
// Redis caching middleware
const cache = (duration) => {
  return async (req, res, next) => {
    const key = `cache:${req.originalUrl || req.url}`;
    
    try {
      const cached = await redis.get(key);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    } catch (err) {
      logger.error('Cache error:', err);
    }
    
    // Store original send
    const originalSend = res.json;
    
    res.json = function(data) {
      res.json = originalSend;
      
      // Cache the response
      redis.setex(key, duration, JSON.stringify(data))
        .catch(err => logger.error('Cache set error:', err));
      
      return res.json(data);
    };
    
    next();
  };
};

// Apply to routes
router.get('/api/metrics', cache(60), getMetrics);
```

### 3. Database Query Optimization

```javascript
// Efficient pagination
const paginate = async (model, page = 1, limit = 20, filter = {}) => {
  const offset = (page - 1) * limit;
  
  const [data, total] = await Promise.all([
    model.find(filter)
      .limit(limit)
      .skip(offset)
      .lean() // Return plain objects
      .exec(),
    model.countDocuments(filter)
  ]);
  
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};
```

## Common Issues and Solutions

### 1. CORS Preflight Issues

**Problem**: Browser blocks requests due to CORS

**Solution**:
```javascript
// Handle preflight requests
app.options('*', cors(corsOptions));

// Ensure CORS headers on errors
app.use((err, req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next(err);
});
```

### 2. Large Payload Handling

**Problem**: Request entity too large

**Solution**:
```javascript
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// For file uploads
const multer = require('multer');
const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});
```

### 3. Timeout Issues

**Problem**: Long-running requests timeout

**Solution**:
```javascript
// Increase server timeout
server.setTimeout(5 * 60 * 1000); // 5 minutes

// For specific routes
router.post('/api/runners/bulk-create', (req, res) => {
  req.setTimeout(10 * 60 * 1000); // 10 minutes
  // Handle bulk creation
});
```

## Testing Best Practices

```javascript
// API testing with Jest and Supertest
const request = require('supertest');
const app = require('../app');

describe('Runners API', () => {
  test('GET /api/runners', async () => {
    const response = await request(app)
      .get('/api/runners')
      .set('Authorization', 'Bearer ' + token)
      .expect('Content-Type', /json/)
      .expect(200);
    
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toBeInstanceOf(Array);
  });
  
  test('POST /api/runners', async () => {
    const newRunner = {
      name: 'test-runner',
      repository: 'org/repo'
    };
    
    const response = await request(app)
      .post('/api/runners')
      .set('Authorization', 'Bearer ' + token)
      .send(newRunner)
      .expect(201);
    
    expect(response.body.data).toMatchObject(newRunner);
    expect(response.headers.location).toBeDefined();
  });
});
```

## Related Technologies

- Express.js
- Fastify (alternative framework)
- GraphQL (alternative API style)
- gRPC (RPC alternative)
- OpenAPI/Swagger