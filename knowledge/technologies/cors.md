# CORS - Cross-Origin Resource Sharing

## Overview
CORS (Cross-Origin Resource Sharing) is a security feature implemented by web browsers that controls access to resources from different origins. The 'cors' npm package is a Node.js middleware that enables CORS with various configuration options for Express applications.

**Official Documentation**: https://github.com/expressjs/cors

## Key Concepts and Features

### Core Concepts
- **Origin**: Protocol + Domain + Port (e.g., https://example.com:3000)
- **Same-Origin Policy**: Browser security restricting cross-origin requests
- **Preflight Requests**: OPTIONS requests to check permissions
- **Simple Requests**: GET/POST with standard headers
- **Credentialed Requests**: Requests with cookies/auth headers
- **Allowed Headers**: Headers permitted in cross-origin requests

### CORS Headers
- `Access-Control-Allow-Origin`: Specifies allowed origins
- `Access-Control-Allow-Methods`: Allowed HTTP methods
- `Access-Control-Allow-Headers`: Allowed request headers
- `Access-Control-Allow-Credentials`: Allow credentials
- `Access-Control-Max-Age`: Preflight cache duration
- `Access-Control-Expose-Headers`: Headers exposed to client

## Common Use Cases

1. **API Access**
   - Public APIs
   - Private APIs with authentication
   - Microservices communication
   - Third-party integrations

2. **Frontend-Backend Separation**
   - SPA applications
   - Mobile app backends
   - Different deployment domains
   - Development environments

3. **Content Delivery**
   - CDN resources
   - Font serving
   - Image hosting
   - Static assets

4. **Security Boundaries**
   - Controlled access
   - Origin whitelisting
   - Method restrictions
   - Header filtering

## Best Practices

### Basic CORS Setup
```javascript
import cors from 'cors';
import express from 'express';

const app = express();

// Enable CORS for all origins (NOT recommended for production)
app.use(cors());

// Basic CORS with specific origin
app.use(cors({
  origin: 'https://example.com'
}));

// Multiple origins
app.use(cors({
  origin: ['https://example.com', 'https://app.example.com']
}));

// Dynamic origin validation
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://example.com',
      'https://app.example.com',
      'http://localhost:3000'
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
```

### Advanced Configuration
```javascript
const corsOptions = {
  // Allowed origins
  origin: function (origin, callback) {
    // Database lookup or dynamic validation
    const isAllowed = checkOriginInDatabase(origin);
    callback(null, isAllowed);
  },
  
  // Allowed HTTP methods
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  
  // Allowed headers
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-API-Key',
    'X-CSRF-Token'
  ],
  
  // Headers to expose to the client
  exposedHeaders: [
    'X-Total-Count',
    'X-Page-Number',
    'X-Page-Size',
    'X-Rate-Limit-Remaining'
  ],
  
  // Allow credentials (cookies, authorization headers)
  credentials: true,
  
  // Cache preflight response for 24 hours
  maxAge: 86400,
  
  // Pass the CORS preflight response to the next handler
  preflightContinue: false,
  
  // Provides a status code to use for successful OPTIONS requests
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
```

### Environment-Based Configuration
```javascript
const configureCors = () => {
  const isProd = process.env.NODE_ENV === 'production';
  
  if (isProd) {
    return {
      origin: [
        'https://app.runnerhub.com',
        'https://www.runnerhub.com',
        'https://api.runnerhub.com'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400 // 24 hours
    };
  } else {
    // Development configuration
    return {
      origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173', // Vite
        'http://127.0.0.1:3000'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Debug-Mode'],
      exposedHeaders: ['X-Debug-Info'],
      maxAge: 3600 // 1 hour
    };
  }
};

app.use(cors(configureCors()));
```

## Integration Patterns with GitHub RunnerHub Stack

### API Server CORS Configuration
```javascript
class CorsManager {
  constructor() {
    this.allowedOrigins = new Set();
    this.loadAllowedOrigins();
  }

  async loadAllowedOrigins() {
    // Load from database or configuration
    const origins = await db.query('SELECT origin FROM allowed_origins WHERE active = true');
    origins.forEach(({ origin }) => this.allowedOrigins.add(origin));
  }

  getCorsMiddleware() {
    return cors({
      origin: async (origin, callback) => {
        // Special handling for development
        if (!origin && process.env.NODE_ENV === 'development') {
          return callback(null, true);
        }

        // Check if origin is allowed
        if (this.allowedOrigins.has(origin)) {
          callback(null, true);
        } else {
          // Check for pattern matching (e.g., subdomains)
          const allowed = this.checkOriginPatterns(origin);
          callback(null, allowed);
        }
      },
      
      credentials: true,
      
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Runner-Token',
        'X-Request-ID'
      ],
      
      exposedHeaders: [
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'X-Response-Time',
        'X-Request-ID'
      ],
      
      maxAge: process.env.NODE_ENV === 'production' ? 86400 : 3600
    });
  }

  checkOriginPatterns(origin) {
    try {
      const url = new URL(origin);
      
      // Allow all subdomains of runnerhub.com
      if (url.hostname.endsWith('.runnerhub.com') || url.hostname === 'runnerhub.com') {
        return true;
      }
      
      // Allow localhost in development
      if (process.env.NODE_ENV === 'development' && 
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
        return true;
      }
      
      // Allow specific IP ranges (e.g., internal network)
      if (this.isInternalIP(url.hostname)) {
        return true;
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  isInternalIP(hostname) {
    // Check if IP is in internal range
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(hostname)) return false;
    
    const parts = hostname.split('.').map(Number);
    
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    
    return false;
  }

  addOrigin(origin) {
    this.allowedOrigins.add(origin);
  }

  removeOrigin(origin) {
    this.allowedOrigins.delete(origin);
  }

  async reloadOrigins() {
    this.allowedOrigins.clear();
    await this.loadAllowedOrigins();
  }
}

// Usage
const corsManager = new CorsManager();
app.use(corsManager.getCorsMiddleware());

// Admin endpoint to manage CORS
app.post('/admin/cors/origins', authenticate, authorize('admin'), async (req, res) => {
  const { origin, action } = req.body;
  
  if (action === 'add') {
    corsManager.addOrigin(origin);
    await db.query('INSERT INTO allowed_origins (origin) VALUES (?)', [origin]);
  } else if (action === 'remove') {
    corsManager.removeOrigin(origin);
    await db.query('DELETE FROM allowed_origins WHERE origin = ?', [origin]);
  }
  
  res.json({ success: true });
});
```

### Per-Route CORS Configuration
```javascript
// Global CORS for most routes
app.use(cors({
  origin: 'https://app.runnerhub.com',
  credentials: true
}));

// Different CORS for specific routes
const publicApiCors = cors({
  origin: '*',
  methods: ['GET'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
  credentials: false
});

const webhookCors = cors({
  origin: 'https://github.com',
  methods: ['POST'],
  allowedHeaders: ['Content-Type', 'X-Hub-Signature-256'],
  credentials: false
});

// Public API endpoints
app.get('/api/public/runners', publicApiCors, (req, res) => {
  res.json({ runners: getPublicRunnerInfo() });
});

// GitHub webhook endpoint
app.post('/webhooks/github', webhookCors, (req, res) => {
  handleGitHubWebhook(req, res);
});

// Admin endpoints with strict CORS
const adminCors = cors({
  origin: 'https://admin.runnerhub.com',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token']
});

app.use('/admin', adminCors, adminRouter);
```

### WebSocket CORS Handling
```javascript
import { WebSocketServer } from 'ws';
import url from 'url';

class WebSocketCors {
  constructor(allowedOrigins) {
    this.allowedOrigins = new Set(allowedOrigins);
  }

  verifyClient(info) {
    const origin = info.origin || info.req.headers.origin;
    
    if (!origin) {
      // No origin header (could be a non-browser client)
      return process.env.NODE_ENV === 'development';
    }
    
    return this.allowedOrigins.has(origin);
  }

  createServer(server) {
    const wss = new WebSocketServer({
      server,
      verifyClient: (info) => this.verifyClient(info)
    });

    wss.on('connection', (ws, req) => {
      const origin = req.headers.origin;
      console.log(`WebSocket connection from origin: ${origin}`);
      
      // Additional origin verification if needed
      if (!this.allowedOrigins.has(origin) && process.env.NODE_ENV === 'production') {
        ws.close(1008, 'Origin not allowed');
        return;
      }
      
      // Handle WebSocket connection
      this.handleConnection(ws, req);
    });

    return wss;
  }

  handleConnection(ws, req) {
    // Set up WebSocket handlers
    ws.on('message', (data) => {
      // Handle messages
    });
  }
}

// Usage
const wsServer = http.createServer(app);
const wsCors = new WebSocketCors([
  'https://app.runnerhub.com',
  'http://localhost:3000'
]);

const wss = wsCors.createServer(wsServer);
```

### Preflight Request Optimization
```javascript
// Cache preflight responses
const preflightCache = new Map();

const optimizedCors = (req, res, next) => {
  const origin = req.headers.origin;
  const method = req.method;
  
  if (method === 'OPTIONS') {
    // Check cache
    const cacheKey = `${origin}:${req.headers['access-control-request-method']}`;
    const cached = preflightCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 3600000) { // 1 hour
      res.set(cached.headers);
      return res.sendStatus(204);
    }
  }
  
  // Standard CORS handling
  cors({
    origin: (origin, callback) => {
      const allowed = checkOrigin(origin);
      
      if (method === 'OPTIONS' && allowed) {
        // Cache the response
        const headers = {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Max-Age': '3600'
        };
        
        preflightCache.set(cacheKey, {
          headers,
          timestamp: Date.now()
        });
      }
      
      callback(null, allowed);
    },
    credentials: true
  })(req, res, next);
};

app.use(optimizedCors);
```

## GitHub RunnerHub Specific Patterns

### Multi-Tenant CORS
```javascript
class TenantCorsManager {
  constructor() {
    this.tenantOrigins = new Map();
  }

  async loadTenantOrigins() {
    const tenants = await db.query(`
      SELECT t.id, t.slug, tc.allowed_origin 
      FROM tenants t 
      JOIN tenant_cors tc ON t.id = tc.tenant_id 
      WHERE t.active = true AND tc.active = true
    `);

    for (const tenant of tenants) {
      if (!this.tenantOrigins.has(tenant.id)) {
        this.tenantOrigins.set(tenant.id, new Set());
      }
      this.tenantOrigins.get(tenant.id).add(tenant.allowed_origin);
    }
  }

  getMiddleware() {
    return async (req, res, next) => {
      const origin = req.headers.origin;
      const tenantId = this.extractTenantId(req);

      if (!tenantId) {
        return cors()(req, res, next);
      }

      const allowedOrigins = this.tenantOrigins.get(tenantId);
      
      const corsOptions = {
        origin: (origin, callback) => {
          if (!origin || (allowedOrigins && allowedOrigins.has(origin))) {
            callback(null, true);
          } else {
            callback(new Error('CORS policy violation for tenant'));
          }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID']
      };

      cors(corsOptions)(req, res, next);
    };
  }

  extractTenantId(req) {
    // From subdomain
    const host = req.get('host');
    const subdomain = host.split('.')[0];
    
    // From header
    const tenantHeader = req.get('X-Tenant-ID');
    
    // From JWT token
    const token = req.get('Authorization')?.replace('Bearer ', '');
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return decoded.tenantId;
      } catch (error) {
        // Invalid token
      }
    }

    return tenantHeader || subdomain;
  }
}
```

### API Gateway CORS
```javascript
class ApiGatewayCors {
  constructor() {
    this.routeConfigs = new Map();
    this.setupRouteConfigs();
  }

  setupRouteConfigs() {
    // Public endpoints
    this.routeConfigs.set('/api/public/*', {
      origin: '*',
      methods: ['GET'],
      credentials: false,
      maxAge: 86400
    });

    // Authenticated endpoints
    this.routeConfigs.set('/api/v1/*', {
      origin: [
        'https://app.runnerhub.com',
        'https://mobile.runnerhub.com'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization']
    });

    // Admin endpoints
    this.routeConfigs.set('/api/admin/*', {
      origin: 'https://admin.runnerhub.com',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key']
    });

    // Webhook endpoints
    this.routeConfigs.set('/webhooks/*', {
      origin: (origin, callback) => {
        // Allow known webhook sources
        const webhookSources = [
          'https://github.com',
          'https://api.github.com',
          'https://gitlab.com',
          'https://bitbucket.org'
        ];
        
        callback(null, webhookSources.includes(origin));
      },
      methods: ['POST'],
      credentials: false
    });
  }

  getMiddleware() {
    return (req, res, next) => {
      const path = req.path;
      
      // Find matching route config
      let config = null;
      for (const [pattern, routeConfig] of this.routeConfigs) {
        if (this.matchPath(path, pattern)) {
          config = routeConfig;
          break;
        }
      }

      if (!config) {
        // Default CORS config
        config = {
          origin: false,
          credentials: false
        };
      }

      cors(config)(req, res, next);
    };
  }

  matchPath(path, pattern) {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return path.startsWith(prefix);
    }
    return path === pattern;
  }
}

// Usage
const apiGateway = new ApiGatewayCors();
app.use(apiGateway.getMiddleware());
```

### CORS Error Handling
```javascript
class CorsErrorHandler {
  static handle(err, req, res, next) {
    if (err && err.message === 'Not allowed by CORS') {
      const origin = req.headers.origin;
      const method = req.method;
      const path = req.path;

      // Log CORS violation
      logger.warn('CORS violation', {
        origin,
        method,
        path,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      // Send appropriate error response
      if (method === 'OPTIONS') {
        // Preflight request failed
        res.status(200).json({
          error: 'CORS preflight check failed',
          origin,
          allowed: false
        });
      } else {
        // Actual request failed
        res.status(403).json({
          error: 'Cross-origin request blocked',
          message: 'The request origin is not allowed to access this resource',
          origin
        });
      }
    } else {
      next(err);
    }
  }

  static createMiddleware() {
    return (err, req, res, next) => {
      CorsErrorHandler.handle(err, req, res, next);
    };
  }
}

// Usage
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(CorsErrorHandler.createMiddleware());
```

### Dynamic CORS with Feature Flags
```javascript
class FeatureFlagCors {
  constructor(featureFlagService) {
    this.featureFlagService = featureFlagService;
  }

  async getCorsOptions(req) {
    const flags = await this.featureFlagService.getFlags();
    
    const baseOptions = {
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE']
    };

    // Check feature flags
    if (flags.enablePublicApi) {
      baseOptions.origin = '*';
      baseOptions.credentials = false;
    } else if (flags.enablePartnerApi) {
      baseOptions.origin = await this.getPartnerOrigins();
    } else {
      baseOptions.origin = flags.allowedOrigins || 'https://app.runnerhub.com';
    }

    if (flags.enableDebugHeaders) {
      baseOptions.exposedHeaders = [
        ...baseOptions.exposedHeaders || [],
        'X-Debug-Info',
        'X-Feature-Flags'
      ];
    }

    return baseOptions;
  }

  async getPartnerOrigins() {
    const partners = await db.query('SELECT domain FROM partners WHERE active = true');
    return partners.map(p => `https://${p.domain}`);
  }

  middleware() {
    return async (req, res, next) => {
      try {
        const options = await this.getCorsOptions(req);
        cors(options)(req, res, next);
      } catch (error) {
        // Fallback to restrictive CORS on error
        cors({ origin: false })(req, res, next);
      }
    };
  }
}
```

## Security Considerations

### CORS Security Best Practices
```javascript
// 1. Never use wildcard with credentials
// BAD
app.use(cors({
  origin: '*',
  credentials: true // This won't work and is insecure
}));

// GOOD
app.use(cors({
  origin: 'https://app.example.com',
  credentials: true
}));

// 2. Validate origins strictly
const secureOriginValidator = (origin, callback) => {
  // Reject null origin in production
  if (!origin && process.env.NODE_ENV === 'production') {
    return callback(new Error('Origin required'));
  }

  // Use allowlist, not blocklist
  const allowlist = new Set([
    'https://app.example.com',
    'https://www.example.com'
  ]);

  if (allowlist.has(origin)) {
    callback(null, true);
  } else {
    callback(new Error('Not allowed by CORS'));
  }
};

// 3. Limit exposed headers
app.use(cors({
  exposedHeaders: [
    'X-Total-Count', // Only expose necessary headers
    'X-Page-Number'
    // Don't expose sensitive headers like X-Internal-Request-Id
  ]
}));

// 4. Short preflight cache in development
const corsOptions = {
  maxAge: process.env.NODE_ENV === 'production' ? 86400 : 600 // 10 minutes in dev
};

// 5. Restrict methods to what's needed
app.use(cors({
  methods: ['GET', 'POST'], // Don't include DELETE, PUT if not needed
}));
```

### CORS Bypass Prevention
```javascript
class CorsSecurityMiddleware {
  static preventBypass(req, res, next) {
    // Check for CORS bypass attempts
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const host = req.headers.host;

    // Detect origin spoofing
    if (origin && !isValidOrigin(origin)) {
      logger.warn('Invalid origin detected', { origin, ip: req.ip });
      return res.status(400).json({ error: 'Invalid origin' });
    }

    // Check referer consistency
    if (referer && origin) {
      try {
        const refererOrigin = new URL(referer).origin;
        if (refererOrigin !== origin) {
          logger.warn('Origin/Referer mismatch', { origin, referer });
        }
      } catch (error) {
        // Invalid referer URL
      }
    }

    // Prevent host header injection
    const validHosts = ['app.runnerhub.com', 'api.runnerhub.com'];
    if (!validHosts.includes(host) && process.env.NODE_ENV === 'production') {
      return res.status(400).json({ error: 'Invalid host header' });
    }

    next();
  }
}

app.use(CorsSecurityMiddleware.preventBypass);
```

## Testing CORS

### Unit Testing
```javascript
import request from 'supertest';
import express from 'express';
import cors from 'cors';

describe('CORS Configuration', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(cors({
      origin: 'https://app.example.com',
      credentials: true
    }));
    app.get('/test', (req, res) => res.json({ success: true }));
  });

  test('should allow requests from allowed origin', async () => {
    const response = await request(app)
      .get('/test')
      .set('Origin', 'https://app.example.com')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  test('should block requests from disallowed origin', async () => {
    const response = await request(app)
      .get('/test')
      .set('Origin', 'https://evil.com')
      .expect(200); // Request succeeds but without CORS headers

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('should handle preflight requests', async () => {
    const response = await request(app)
      .options('/test')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain('Content-Type');
  });
});
```

### Integration Testing
```javascript
describe('CORS Integration', () => {
  test('should handle CORS for API endpoints', async () => {
    // Test from browser-like environment
    const response = await fetch('http://localhost:3000/api/runners', {
      method: 'GET',
      headers: {
        'Origin': 'https://app.example.com'
      },
      credentials: 'include'
    });

    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  test('should enforce CORS on WebSocket upgrade', async () => {
    const ws = new WebSocket('ws://localhost:3000', {
      headers: {
        'Origin': 'https://unauthorized.com'
      }
    });

    await expect(new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.on('open', resolve);
    })).rejects.toThrow();
  });
});
```

## Debugging CORS Issues

### CORS Debugging Middleware
```javascript
const corsDebugger = (req, res, next) => {
  if (process.env.DEBUG_CORS === 'true') {
    console.log('CORS Debug Info:');
    console.log('  Origin:', req.headers.origin);
    console.log('  Method:', req.method);
    console.log('  Headers:', req.headers);
    
    // Log CORS response headers
    const originalSend = res.send;
    res.send = function(data) {
      console.log('CORS Response Headers:');
      console.log('  Allow-Origin:', res.get('Access-Control-Allow-Origin'));
      console.log('  Allow-Credentials:', res.get('Access-Control-Allow-Credentials'));
      console.log('  Allow-Methods:', res.get('Access-Control-Allow-Methods'));
      console.log('  Allow-Headers:', res.get('Access-Control-Allow-Headers'));
      
      originalSend.call(this, data);
    };
  }
  
  next();
};

app.use(corsDebugger);
app.use(cors(corsOptions));
```

### Common CORS Issues and Solutions
```javascript
// Issue 1: Credentials with wildcard origin
// Problem: Browsers reject credentials: true with origin: '*'
// Solution:
app.use(cors({
  origin: (origin, callback) => {
    // Dynamically set origin to match request
    callback(null, origin || true);
  },
  credentials: true
}));

// Issue 2: Missing headers in preflight
// Problem: Custom headers not allowed
// Solution:
app.use(cors({
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Custom-Header']
}));

// Issue 3: Preflight failing for PUT/DELETE
// Problem: Methods not explicitly allowed
// Solution:
app.use(cors({
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));

// Issue 4: Headers not visible to client
// Problem: Response headers not exposed
// Solution:
app.use(cors({
  exposedHeaders: ['X-Total-Count', 'X-Rate-Limit']
}));
```

## Resources
- [CORS NPM Package](https://github.com/expressjs/cors)
- [MDN CORS Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [CORS Specification](https://www.w3.org/TR/cors/)
- [OWASP CORS Security](https://owasp.org/www-community/attacks/CORS_OriginHeaderScrutiny)