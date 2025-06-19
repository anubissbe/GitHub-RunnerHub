# Express.js - Node.js Web Framework

## Overview
Express.js is a minimal and flexible Node.js web application framework that provides a robust set of features for web and mobile applications. It's the de facto standard for Node.js web development.

**Official Documentation**: https://expressjs.com/

## Key Concepts and Features

### Core Features
- **Middleware Architecture**: Composable request processing pipeline
- **Routing System**: Flexible URL pattern matching
- **HTTP Utility Methods**: Simplified request/response handling
- **Template Engine Support**: Multiple view engines (EJS, Pug, Handlebars)
- **Static File Serving**: Built-in static asset serving
- **Error Handling**: Centralized error management

### Technical Characteristics
- Minimal core with extensible plugin system
- Built on Node.js HTTP module
- Supports both callbacks and promises
- RESTful route design
- Content negotiation
- Cookie and session handling

## Common Use Cases

1. **REST APIs**
   ```javascript
   app.get('/api/runners', async (req, res) => {
     const runners = await Runner.findAll();
     res.json(runners);
   });
   ```

2. **Web Applications**
   - Server-side rendered pages
   - Single-page application backends
   - Progressive web apps
   - Admin dashboards

3. **Microservices**
   - API gateways
   - Service endpoints
   - Proxy servers
   - Load balancers

4. **Real-time Applications**
   - WebSocket integration
   - Server-sent events
   - Long polling endpoints
   - Push notifications

## Best Practices

### Project Structure
```
/src
  /controllers    # Route handlers
  /middleware     # Custom middleware
  /routes         # Route definitions
  /models         # Data models
  /services       # Business logic
  /utils          # Helper functions
  app.js          # Express app setup
  server.js       # Server startup
```

### Middleware Organization
```javascript
// Middleware order matters
app.use(helmet());                    // Security headers
app.use(cors(corsOptions));           // CORS
app.use(morgan('combined'));          // Logging
app.use(express.json());              // Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(compression());               // Response compression
app.use(express.static('public'));    // Static files

// Custom middleware
app.use(authenticate);                // Authentication
app.use(rateLimit);                   // Rate limiting

// Routes
app.use('/api/v1', apiRoutes);

// Error handling (always last)
app.use(errorHandler);
```

### Route Organization
```javascript
// routes/runners.js
import { Router } from 'express';
import { runnerController } from '../controllers/runner.controller.js';
import { validate } from '../middleware/validation.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, runnerController.list);
router.get('/:id', authenticate, runnerController.get);
router.post('/', authenticate, validate(runnerSchema), runnerController.create);
router.put('/:id', authenticate, validate(runnerSchema), runnerController.update);
router.delete('/:id', authenticate, runnerController.delete);

export default router;
```

### Error Handling
```javascript
// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Global error handler
app.use((err, req, res, next) => {
  logger.error(err.stack);
  
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  
  res.status(status).json({
    error: {
      message,
      status,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
});
```

### Security Best Practices
```javascript
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);

// Data sanitization
app.use(mongoSanitize());
```

## Integration Patterns with GitHub RunnerHub Stack

### CORS Configuration
```javascript
import cors from 'cors';

const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
```

### JWT Authentication Middleware
```javascript
import jwt from 'jsonwebtoken';

export const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      throw new Error();
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    
    if (!req.user) {
      throw new Error();
    }
    
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};
```

### WebSocket Integration
```javascript
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Parse session from request
  const session = parseSession(req);
  
  ws.on('message', (message) => {
    // Handle WebSocket messages
  });
});

server.listen(PORT);
```

### Docker Health Check Endpoint
```javascript
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});
```

### Request Validation
```javascript
import { body, validationResult } from 'express-validator';

export const validateRunner = [
  body('name').isString().trim().notEmpty(),
  body('labels').isArray(),
  body('maxJobs').isInt({ min: 1, max: 10 }),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];
```

## GitHub RunnerHub Specific Patterns

### Runner API Routes
```javascript
// Runner management endpoints
app.post('/api/runners', authenticate, async (req, res) => {
  const runner = await runnerService.create(req.body);
  res.status(201).json(runner);
});

app.get('/api/runners/:id/logs', authenticate, async (req, res) => {
  const logs = await runnerService.getLogs(req.params.id);
  res.json(logs);
});

app.post('/api/runners/:id/restart', authenticate, async (req, res) => {
  await runnerService.restart(req.params.id);
  res.json({ message: 'Runner restarted successfully' });
});
```

### Streaming Responses
```javascript
// Stream Docker logs
app.get('/api/runners/:id/logs/stream', authenticate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const stream = runnerService.streamLogs(req.params.id);
  
  stream.on('data', (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
  
  req.on('close', () => {
    stream.destroy();
  });
});
```

### File Upload Handling
```javascript
import multer from 'multer';

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed'));
    }
  }
});

app.post('/api/runners/:id/icon', authenticate, upload.single('icon'), async (req, res) => {
  const iconUrl = await runnerService.updateIcon(req.params.id, req.file);
  res.json({ iconUrl });
});
```

## Performance Optimization

### Response Compression
```javascript
import compression from 'compression';

app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));
```

### Caching
```javascript
// Cache control middleware
const cache = (duration) => {
  return (req, res, next) => {
    res.setHeader('Cache-Control', `public, max-age=${duration}`);
    next();
  };
};

// Use for static resources
app.get('/api/runners', cache(300), runnerController.list); // 5 minutes
```

### Connection Pooling
```javascript
// Database connection pool
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

app.locals.db = pool;
```

## Testing Express Applications

### Unit Testing
```javascript
import request from 'supertest';
import app from '../app';

describe('Runner API', () => {
  test('GET /api/runners', async () => {
    const response = await request(app)
      .get('/api/runners')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    
    expect(response.body).toHaveProperty('runners');
    expect(Array.isArray(response.body.runners)).toBe(true);
  });
});
```

### Integration Testing
```javascript
import { createTestServer } from './helpers';

describe('Runner Creation Flow', () => {
  let server;
  
  beforeAll(async () => {
    server = await createTestServer();
  });
  
  afterAll(async () => {
    await server.close();
  });
  
  test('Create and start runner', async () => {
    // Test implementation
  });
});
```

## Debugging and Monitoring

### Request Logging
```javascript
import morgan from 'morgan';
import winston from 'winston';

// HTTP request logging
app.use(morgan('combined', {
  stream: { write: (message) => winston.info(message.trim()) }
}));

// Custom request logger
app.use((req, res, next) => {
  req.startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      userAgent: req.get('user-agent')
    });
  });
  next();
});
```

### Performance Monitoring
```javascript
// Track response times
app.use((req, res, next) => {
  const start = process.hrtime();
  
  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds * 1000 + nanoseconds / 1000000;
    
    metrics.histogram('http_request_duration_ms', duration, {
      method: req.method,
      route: req.route?.path || 'unknown',
      status: res.statusCode
    });
  });
  
  next();
});
```

## Resources
- [Express.js Official Guide](https://expressjs.com/en/guide/routing.html)
- [Express.js API Reference](https://expressjs.com/en/4x/api.html)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Express.js Performance Best Practices](https://expressjs.com/en/advanced/best-practice-performance.html)