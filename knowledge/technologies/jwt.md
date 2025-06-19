# JWT - JSON Web Tokens for Authentication

## Overview
JSON Web Tokens (JWT) are an open standard (RFC 7519) for securely transmitting information between parties as a JSON object. JWTs are commonly used for authentication and information exchange in modern web applications.

**Official Documentation**: https://jwt.io/

## Key Concepts and Features

### JWT Structure
- **Header**: Contains token type and signing algorithm
- **Payload**: Contains claims (user data and metadata)
- **Signature**: Ensures token integrity

### Token Format
```
header.payload.signature
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

### Claims Types
- **Registered Claims**: Standard claims (iss, exp, sub, aud)
- **Public Claims**: Defined in IANA JWT Registry
- **Private Claims**: Custom claims for your application

### Security Features
- Digital signatures (HMAC or RSA)
- Optional encryption (JWE)
- Expiration time
- Token revocation strategies
- Refresh token patterns

## Common Use Cases

1. **Authentication**
   - User login sessions
   - API authentication
   - Single Sign-On (SSO)
   - Mobile app authentication

2. **Authorization**
   - Role-based access control
   - Resource permissions
   - API rate limiting
   - Feature flags

3. **Information Exchange**
   - Cross-service communication
   - Temporary access grants
   - Email verification
   - Password reset tokens

4. **Stateless Sessions**
   - Microservices authentication
   - Distributed systems
   - Serverless functions
   - Load-balanced environments

## Best Practices

### Token Generation
```javascript
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

class JWTService {
  constructor() {
    this.accessTokenSecret = process.env.JWT_ACCESS_SECRET;
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET;
    this.accessTokenExpiry = '15m';
    this.refreshTokenExpiry = '7d';
  }

  generateTokens(user) {
    const payload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions
    };

    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
      tokenType: 'Bearer'
    };
  }

  generateAccessToken(payload) {
    return jwt.sign(payload, this.accessTokenSecret, {
      expiresIn: this.accessTokenExpiry,
      issuer: 'runnerhub.com',
      audience: 'runnerhub-api',
      algorithm: 'HS256'
    });
  }

  generateRefreshToken(userId) {
    const jti = crypto.randomBytes(16).toString('hex');
    
    return jwt.sign(
      { 
        sub: userId,
        jti, // Unique token ID for revocation
        type: 'refresh'
      },
      this.refreshTokenSecret,
      {
        expiresIn: this.refreshTokenExpiry,
        issuer: 'runnerhub.com',
        algorithm: 'HS256'
      }
    );
  }

  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.accessTokenSecret, {
        issuer: 'runnerhub.com',
        audience: 'runnerhub-api',
        algorithms: ['HS256']
      });
      
      return { valid: true, payload: decoded };
    } catch (error) {
      return { 
        valid: false, 
        error: error.name,
        message: error.message 
      };
    }
  }

  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.refreshTokenSecret, {
        issuer: 'runnerhub.com',
        algorithms: ['HS256']
      });
      
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      
      return { valid: true, payload: decoded };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async refreshTokens(refreshToken) {
    const verification = this.verifyRefreshToken(refreshToken);
    
    if (!verification.valid) {
      throw new Error('Invalid refresh token');
    }

    // Check if token is revoked
    const isRevoked = await this.isTokenRevoked(verification.payload.jti);
    if (isRevoked) {
      throw new Error('Token has been revoked');
    }

    // Get user and generate new tokens
    const user = await User.findById(verification.payload.sub);
    if (!user) {
      throw new Error('User not found');
    }

    // Revoke old refresh token
    await this.revokeToken(verification.payload.jti);

    return this.generateTokens(user);
  }

  async revokeToken(jti) {
    // Store in Redis with TTL matching token expiry
    await redis.setex(`revoked_token:${jti}`, 604800, 'true'); // 7 days
  }

  async isTokenRevoked(jti) {
    const revoked = await redis.get(`revoked_token:${jti}`);
    return revoked === 'true';
  }
}
```

### Authentication Middleware
```javascript
class AuthMiddleware {
  constructor(jwtService) {
    this.jwtService = jwtService;
  }

  authenticate(options = {}) {
    return async (req, res, next) => {
      try {
        const token = this.extractToken(req);
        
        if (!token) {
          return res.status(401).json({ 
            error: 'Authentication required',
            code: 'NO_TOKEN'
          });
        }

        const verification = this.jwtService.verifyAccessToken(token);
        
        if (!verification.valid) {
          return this.handleTokenError(res, verification);
        }

        // Check additional constraints
        if (options.checkRevoked) {
          const isRevoked = await this.jwtService.isTokenRevoked(token);
          if (isRevoked) {
            return res.status(401).json({ 
              error: 'Token has been revoked',
              code: 'TOKEN_REVOKED'
            });
          }
        }

        // Attach user to request
        req.user = {
          id: verification.payload.sub,
          email: verification.payload.email,
          roles: verification.payload.roles || [],
          permissions: verification.payload.permissions || []
        };
        
        req.token = token;
        req.tokenPayload = verification.payload;
        
        next();
      } catch (error) {
        logger.error('Authentication error:', error);
        res.status(500).json({ 
          error: 'Authentication failed',
          code: 'AUTH_ERROR'
        });
      }
    };
  }

  extractToken(req) {
    // From Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // From cookie
    if (req.cookies && req.cookies.access_token) {
      return req.cookies.access_token;
    }

    // From query parameter (not recommended for production)
    if (process.env.NODE_ENV === 'development' && req.query.token) {
      return req.query.token;
    }

    return null;
  }

  handleTokenError(res, verification) {
    const errorResponses = {
      'TokenExpiredError': {
        status: 401,
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      },
      'JsonWebTokenError': {
        status: 401,
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      },
      'NotBeforeError': {
        status: 401,
        error: 'Token not active yet',
        code: 'TOKEN_NOT_ACTIVE'
      }
    };

    const response = errorResponses[verification.error] || {
      status: 401,
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    };

    return res.status(response.status).json(response);
  }

  authorize(...requiredRoles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ 
          error: 'Authentication required',
          code: 'NOT_AUTHENTICATED'
        });
      }

      const hasRole = requiredRoles.some(role => 
        req.user.roles.includes(role) || req.user.roles.includes('admin')
      );

      if (!hasRole) {
        return res.status(403).json({ 
          error: 'Insufficient permissions',
          code: 'FORBIDDEN',
          required: requiredRoles,
          current: req.user.roles
        });
      }

      next();
    };
  }

  checkPermission(permission) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ 
          error: 'Authentication required',
          code: 'NOT_AUTHENTICATED'
        });
      }

      const hasPermission = req.user.permissions.includes(permission) || 
                           req.user.permissions.includes('*') ||
                           req.user.roles.includes('admin');

      if (!hasPermission) {
        return res.status(403).json({ 
          error: 'Missing required permission',
          code: 'PERMISSION_DENIED',
          required: permission
        });
      }

      next();
    };
  }
}
```

## Integration Patterns with GitHub RunnerHub Stack

### Runner Authentication System
```javascript
class RunnerAuthService {
  constructor(jwtService) {
    this.jwtService = jwtService;
  }

  async authenticateRunner(runnerId, runnerToken) {
    // Verify runner token against database
    const runner = await Runner.findOne({ 
      id: runnerId, 
      token: runnerToken 
    });

    if (!runner) {
      throw new Error('Invalid runner credentials');
    }

    // Generate JWT for runner
    const token = jwt.sign(
      {
        sub: `runner:${runner.id}`,
        type: 'runner',
        name: runner.name,
        labels: runner.labels,
        permissions: ['runner:heartbeat', 'runner:logs', 'runner:status']
      },
      process.env.JWT_RUNNER_SECRET,
      {
        expiresIn: '24h',
        issuer: 'runnerhub.com',
        audience: 'runner-api'
      }
    );

    return {
      token,
      runner: {
        id: runner.id,
        name: runner.name,
        status: runner.status
      }
    };
  }

  createRunnerMiddleware() {
    return async (req, res, next) => {
      try {
        const token = req.headers['x-runner-token'];
        
        if (!token) {
          return res.status(401).json({ 
            error: 'Runner token required',
            code: 'NO_RUNNER_TOKEN'
          });
        }

        const decoded = jwt.verify(token, process.env.JWT_RUNNER_SECRET, {
          issuer: 'runnerhub.com',
          audience: 'runner-api'
        });

        if (decoded.type !== 'runner') {
          return res.status(401).json({ 
            error: 'Invalid token type',
            code: 'INVALID_TOKEN_TYPE'
          });
        }

        req.runner = {
          id: decoded.sub.replace('runner:', ''),
          name: decoded.name,
          labels: decoded.labels,
          permissions: decoded.permissions
        };

        next();
      } catch (error) {
        res.status(401).json({ 
          error: 'Invalid runner token',
          code: 'INVALID_RUNNER_TOKEN'
        });
      }
    };
  }
}
```

### API Key with JWT
```javascript
class ApiKeyAuth {
  constructor(jwtService) {
    this.jwtService = jwtService;
  }

  async authenticateApiKey(apiKey) {
    // Look up API key
    const keyData = await ApiKey.findOne({ 
      key: apiKey,
      active: true 
    });

    if (!keyData) {
      throw new Error('Invalid API key');
    }

    // Check rate limits
    await this.checkRateLimit(keyData);

    // Generate short-lived JWT
    const token = jwt.sign(
      {
        sub: `apikey:${keyData.id}`,
        type: 'apikey',
        accountId: keyData.accountId,
        permissions: keyData.permissions,
        rateLimit: keyData.rateLimit
      },
      process.env.JWT_API_SECRET,
      {
        expiresIn: '1h',
        issuer: 'runnerhub.com',
        audience: 'api'
      }
    );

    // Log usage
    await this.logApiKeyUsage(keyData.id);

    return {
      token,
      expiresIn: 3600,
      rateLimit: {
        limit: keyData.rateLimit,
        remaining: keyData.rateLimitRemaining,
        reset: keyData.rateLimitReset
      }
    };
  }

  createApiKeyMiddleware() {
    return async (req, res, next) => {
      const apiKey = req.headers['x-api-key'];
      const token = this.extractToken(req);

      if (apiKey) {
        // Exchange API key for JWT
        try {
          const auth = await this.authenticateApiKey(apiKey);
          req.headers.authorization = `Bearer ${auth.token}`;
          
          // Set rate limit headers
          res.set({
            'X-RateLimit-Limit': auth.rateLimit.limit,
            'X-RateLimit-Remaining': auth.rateLimit.remaining,
            'X-RateLimit-Reset': auth.rateLimit.reset
          });
        } catch (error) {
          return res.status(401).json({ 
            error: 'Invalid API key',
            code: 'INVALID_API_KEY'
          });
        }
      }

      // Continue with normal JWT authentication
      next();
    };
  }

  async checkRateLimit(apiKey) {
    const key = `rate_limit:${apiKey.id}`;
    const current = await redis.incr(key);
    
    if (current === 1) {
      await redis.expire(key, 3600); // 1 hour window
    }

    if (current > apiKey.rateLimit) {
      throw new Error('Rate limit exceeded');
    }

    apiKey.rateLimitRemaining = apiKey.rateLimit - current;
    apiKey.rateLimitReset = Date.now() + (await redis.ttl(key)) * 1000;
  }
}
```

### WebSocket JWT Authentication
```javascript
class WebSocketAuth {
  constructor(wss, jwtService) {
    this.wss = wss;
    this.jwtService = jwtService;
    this.authenticatedClients = new Map();
  }

  setup() {
    this.wss.on('connection', (ws, req) => {
      let authenticated = false;
      let authTimeout;

      // Try to authenticate from query params
      const token = this.extractTokenFromUrl(req.url);
      if (token) {
        authenticated = this.authenticateWebSocket(ws, token);
      }

      if (!authenticated) {
        // Wait for auth message
        authTimeout = setTimeout(() => {
          ws.close(1008, 'Authentication timeout');
        }, 10000);

        ws.once('message', (data) => {
          try {
            const message = JSON.parse(data);
            if (message.type === 'auth' && message.token) {
              if (this.authenticateWebSocket(ws, message.token)) {
                clearTimeout(authTimeout);
                ws.send(JSON.stringify({ 
                  type: 'authenticated',
                  message: 'Authentication successful'
                }));
              } else {
                ws.close(1008, 'Authentication failed');
              }
            } else {
              ws.close(1008, 'Authentication required');
            }
          } catch (error) {
            ws.close(1008, 'Invalid message format');
          }
        });
      }

      ws.on('close', () => {
        this.authenticatedClients.delete(ws);
        if (authTimeout) clearTimeout(authTimeout);
      });
    });
  }

  authenticateWebSocket(ws, token) {
    const verification = this.jwtService.verifyAccessToken(token);
    
    if (!verification.valid) {
      return false;
    }

    this.authenticatedClients.set(ws, {
      userId: verification.payload.sub,
      roles: verification.payload.roles,
      permissions: verification.payload.permissions,
      connectedAt: Date.now()
    });

    // Set up authenticated message handlers
    ws.on('message', (data) => {
      this.handleAuthenticatedMessage(ws, data);
    });

    return true;
  }

  extractTokenFromUrl(url) {
    try {
      const urlObj = new URL(url, 'http://localhost');
      return urlObj.searchParams.get('token');
    } catch (error) {
      return null;
    }
  }

  handleAuthenticatedMessage(ws, data) {
    const client = this.authenticatedClients.get(ws);
    if (!client) {
      ws.close(1008, 'Not authenticated');
      return;
    }

    try {
      const message = JSON.parse(data);
      
      // Check permissions for specific operations
      if (message.type === 'subscribe' && message.channel === 'admin') {
        if (!client.roles.includes('admin')) {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Insufficient permissions for admin channel'
          }));
          return;
        }
      }

      // Process message...
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid message format'
      }));
    }
  }
}
```

### Token Rotation Strategy
```javascript
class TokenRotation {
  constructor(jwtService) {
    this.jwtService = jwtService;
    this.rotationThreshold = 5 * 60 * 1000; // 5 minutes before expiry
  }

  shouldRotate(token) {
    try {
      const decoded = jwt.decode(token);
      const expiryTime = decoded.exp * 1000;
      const timeUntilExpiry = expiryTime - Date.now();
      
      return timeUntilExpiry <= this.rotationThreshold;
    } catch (error) {
      return false;
    }
  }

  createRotationMiddleware() {
    return async (req, res, next) => {
      // Only rotate on successful responses
      const originalSend = res.send;
      res.send = async function(data) {
        if (res.statusCode >= 200 && res.statusCode < 300 && req.token) {
          if (this.shouldRotate(req.token)) {
            try {
              const newTokens = await this.jwtService.refreshTokens(req.refreshToken);
              
              res.set({
                'X-New-Access-Token': newTokens.accessToken,
                'X-New-Refresh-Token': newTokens.refreshToken,
                'X-Token-Expires-In': newTokens.expiresIn
              });
              
              // Also set cookies if used
              if (req.cookies && req.cookies.access_token) {
                res.cookie('access_token', newTokens.accessToken, {
                  httpOnly: true,
                  secure: process.env.NODE_ENV === 'production',
                  sameSite: 'strict',
                  maxAge: newTokens.expiresIn * 1000
                });
              }
            } catch (error) {
              logger.error('Token rotation failed:', error);
            }
          }
        }
        
        originalSend.call(this, data);
      }.bind(this);
      
      next();
    };
  }
}
```

## GitHub RunnerHub Specific Patterns

### Multi-Tenant JWT
```javascript
class MultiTenantJWT {
  constructor() {
    this.tenantSecrets = new Map();
  }

  async loadTenantSecrets() {
    const tenants = await db.query('SELECT id, jwt_secret FROM tenants WHERE active = true');
    tenants.forEach(tenant => {
      this.tenantSecrets.set(tenant.id, tenant.jwt_secret);
    });
  }

  generateTenantToken(tenantId, user) {
    const secret = this.tenantSecrets.get(tenantId);
    if (!secret) {
      throw new Error('Invalid tenant');
    }

    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        tenantId: tenantId,
        roles: user.roles,
        permissions: user.permissions
      },
      secret,
      {
        expiresIn: '1h',
        issuer: `runnerhub-tenant-${tenantId}`,
        audience: `tenant-${tenantId}`
      }
    );
  }

  verifyTenantToken(token, tenantId) {
    const secret = this.tenantSecrets.get(tenantId);
    if (!secret) {
      return { valid: false, error: 'Invalid tenant' };
    }

    try {
      const decoded = jwt.verify(token, secret, {
        issuer: `runnerhub-tenant-${tenantId}`,
        audience: `tenant-${tenantId}`
      });

      if (decoded.tenantId !== tenantId) {
        throw new Error('Tenant mismatch');
      }

      return { valid: true, payload: decoded };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  createTenantMiddleware() {
    return async (req, res, next) => {
      const tenantId = this.extractTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ 
          error: 'Tenant identification required',
          code: 'NO_TENANT'
        });
      }

      const token = this.extractToken(req);
      if (!token) {
        return res.status(401).json({ 
          error: 'Authentication required',
          code: 'NO_TOKEN'
        });
      }

      const verification = this.verifyTenantToken(token, tenantId);
      if (!verification.valid) {
        return res.status(401).json({ 
          error: 'Invalid token for tenant',
          code: 'INVALID_TENANT_TOKEN'
        });
      }

      req.user = verification.payload;
      req.tenantId = tenantId;
      next();
    };
  }

  extractTenantId(req) {
    // From subdomain
    const host = req.get('host');
    const subdomain = host.split('.')[0];
    if (subdomain !== 'www' && subdomain !== 'api') {
      return subdomain;
    }

    // From header
    return req.get('X-Tenant-ID');
  }
}
```

### JWT Audit Trail
```javascript
class JWTAuditTrail {
  constructor() {
    this.auditLogger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.File({ filename: 'jwt-audit.log' }),
        new winston.transports.Console()
      ]
    });
  }

  async logTokenGeneration(userId, tokenType, metadata = {}) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      event: 'token_generated',
      userId,
      tokenType,
      ip: metadata.ip,
      userAgent: metadata.userAgent,
      sessionId: metadata.sessionId,
      tokenId: metadata.jti
    };

    this.auditLogger.info(auditEntry);
    
    // Store in database for queries
    await db.query(
      `INSERT INTO jwt_audit_log 
       (user_id, event, token_type, ip_address, user_agent, metadata) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, 'token_generated', tokenType, metadata.ip, metadata.userAgent, JSON.stringify(metadata)]
    );
  }

  async logTokenUsage(token, endpoint, statusCode) {
    try {
      const decoded = jwt.decode(token);
      
      const auditEntry = {
        timestamp: new Date().toISOString(),
        event: 'token_used',
        userId: decoded.sub,
        endpoint,
        statusCode,
        tokenExp: new Date(decoded.exp * 1000).toISOString(),
        tokenId: decoded.jti
      };

      this.auditLogger.info(auditEntry);
    } catch (error) {
      // Invalid token, still log attempt
      this.auditLogger.warn({
        timestamp: new Date().toISOString(),
        event: 'invalid_token_used',
        endpoint,
        error: error.message
      });
    }
  }

  async logTokenRevocation(tokenId, reason, revokedBy) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      event: 'token_revoked',
      tokenId,
      reason,
      revokedBy
    };

    this.auditLogger.info(auditEntry);
    
    await db.query(
      `INSERT INTO jwt_audit_log 
       (user_id, event, token_type, metadata) 
       VALUES (?, ?, ?, ?)`,
      [revokedBy, 'token_revoked', 'access', JSON.stringify({ tokenId, reason })]
    );
  }

  createAuditMiddleware() {
    return (req, res, next) => {
      if (req.token) {
        // Log token usage after response
        res.on('finish', () => {
          this.logTokenUsage(req.token, req.path, res.statusCode);
        });
      }
      next();
    };
  }
}
```

### Secure Token Storage
```javascript
class SecureTokenStorage {
  constructor() {
    this.encryptionKey = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');
  }

  async storeRefreshToken(userId, refreshToken, metadata = {}) {
    // Encrypt token before storage
    const encrypted = this.encryptToken(refreshToken);
    
    // Hash for indexing
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    await db.query(
      `INSERT INTO refresh_tokens 
       (user_id, token_hash, encrypted_token, expires_at, device_info, created_at) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        tokenHash,
        encrypted,
        metadata.expiresAt,
        JSON.stringify(metadata.deviceInfo),
        new Date()
      ]
    );

    return tokenHash;
  }

  async validateRefreshToken(userId, refreshToken) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const stored = await db.query(
      `SELECT encrypted_token, expires_at 
       FROM refresh_tokens 
       WHERE user_id = ? AND token_hash = ? AND revoked = false`,
      [userId, tokenHash]
    );

    if (!stored.length) {
      return { valid: false, error: 'Token not found' };
    }

    const record = stored[0];
    
    // Check expiration
    if (new Date(record.expires_at) < new Date()) {
      return { valid: false, error: 'Token expired' };
    }

    // Decrypt and compare
    const decrypted = this.decryptToken(record.encrypted_token);
    if (decrypted !== refreshToken) {
      return { valid: false, error: 'Token mismatch' };
    }

    return { valid: true };
  }

  encryptToken(token) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(token, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const authTag = cipher.getAuthTag();
    
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decryptToken(encryptedToken) {
    const buffer = Buffer.from(encryptedToken, 'base64');
    
    const iv = buffer.slice(0, 16);
    const authTag = buffer.slice(16, 32);
    const encrypted = buffer.slice(32);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  }

  async revokeAllUserTokens(userId, except = []) {
    await db.query(
      `UPDATE refresh_tokens 
       SET revoked = true, revoked_at = ? 
       WHERE user_id = ? AND token_hash NOT IN (?)`,
      [new Date(), userId, except.length ? except : ['']]
    );
  }

  async cleanupExpiredTokens() {
    const result = await db.query(
      `DELETE FROM refresh_tokens 
       WHERE expires_at < ? OR (revoked = true AND revoked_at < ?)`,
      [new Date(), new Date(Date.now() - 24 * 60 * 60 * 1000)] // 24 hours
    );

    logger.info(`Cleaned up ${result.affectedRows} expired tokens`);
  }
}
```

## Security Considerations

### Token Security Best Practices
```javascript
// 1. Use strong secrets
const generateSecret = () => {
  return crypto.randomBytes(64).toString('hex');
};

// 2. Implement token binding
const generateBoundToken = (user, request) => {
  const fingerprint = crypto
    .createHash('sha256')
    .update(request.ip + request.headers['user-agent'])
    .digest('hex');

  return jwt.sign(
    {
      sub: user.id,
      fingerprint,
      // ... other claims
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
};

// 3. Short-lived access tokens
const TOKEN_CONFIG = {
  access: { expiresIn: '15m' },
  refresh: { expiresIn: '7d' },
  passwordReset: { expiresIn: '1h' },
  emailVerification: { expiresIn: '24h' }
};

// 4. Implement proper token revocation
class TokenRevocation {
  async revokeToken(token) {
    const decoded = jwt.decode(token);
    const expiresAt = decoded.exp;
    const ttl = expiresAt - Math.floor(Date.now() / 1000);
    
    if (ttl > 0) {
      await redis.setex(`revoked:${decoded.jti}`, ttl, '1');
    }
  }

  async isRevoked(token) {
    const decoded = jwt.decode(token);
    if (!decoded.jti) return false;
    
    const revoked = await redis.get(`revoked:${decoded.jti}`);
    return revoked === '1';
  }
}

// 5. Secure cookie settings
const setSecureTokenCookie = (res, token) => {
  res.cookie('access_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: '/',
    domain: '.runnerhub.com'
  });
};
```

### JWT Vulnerabilities Prevention
```javascript
// 1. Prevent algorithm switching attacks
const verifyTokenSecurely = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ['HS256'] // Explicitly specify allowed algorithms
  });
};

// 2. Validate all claims
const validateTokenClaims = (decoded) => {
  const now = Math.floor(Date.now() / 1000);
  
  // Check expiration
  if (!decoded.exp || decoded.exp < now) {
    throw new Error('Token expired');
  }
  
  // Check not before
  if (decoded.nbf && decoded.nbf > now) {
    throw new Error('Token not yet valid');
  }
  
  // Check issuer
  if (decoded.iss !== 'runnerhub.com') {
    throw new Error('Invalid issuer');
  }
  
  // Check audience
  if (!decoded.aud || !decoded.aud.includes('runnerhub-api')) {
    throw new Error('Invalid audience');
  }
  
  return true;
};

// 3. Implement token replay protection
class ReplayProtection {
  constructor() {
    this.usedTokens = new Map();
  }

  async checkAndMarkUsed(token) {
    const decoded = jwt.decode(token);
    const tokenId = decoded.jti || crypto.createHash('sha256').update(token).digest('hex');
    
    if (this.usedTokens.has(tokenId)) {
      throw new Error('Token already used');
    }
    
    this.usedTokens.set(tokenId, Date.now());
    
    // Clean up old entries
    this.cleanup();
    
    return true;
  }

  cleanup() {
    const oneHourAgo = Date.now() - 3600000;
    for (const [tokenId, timestamp] of this.usedTokens) {
      if (timestamp < oneHourAgo) {
        this.usedTokens.delete(tokenId);
      }
    }
  }
}
```

## Testing JWT Implementation

### Unit Tests
```javascript
import jwt from 'jsonwebtoken';
import { JWTService } from './jwt.service';

describe('JWTService', () => {
  let jwtService;
  const mockUser = {
    id: 'user123',
    email: 'test@example.com',
    roles: ['user'],
    permissions: ['read:profile']
  };

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    jwtService = new JWTService();
  });

  describe('generateTokens', () => {
    test('should generate valid access and refresh tokens', () => {
      const tokens = jwtService.generateTokens(mockUser);
      
      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(tokens.expiresIn).toBe(900);
      expect(tokens.tokenType).toBe('Bearer');
      
      // Verify access token
      const decoded = jwt.verify(tokens.accessToken, process.env.JWT_ACCESS_SECRET);
      expect(decoded.sub).toBe(mockUser.id);
      expect(decoded.email).toBe(mockUser.email);
      expect(decoded.roles).toEqual(mockUser.roles);
    });
  });

  describe('verifyAccessToken', () => {
    test('should verify valid token', () => {
      const tokens = jwtService.generateTokens(mockUser);
      const result = jwtService.verifyAccessToken(tokens.accessToken);
      
      expect(result.valid).toBe(true);
      expect(result.payload.sub).toBe(mockUser.id);
    });

    test('should reject expired token', () => {
      const expiredToken = jwt.sign(
        { sub: mockUser.id },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '-1h' }
      );
      
      const result = jwtService.verifyAccessToken(expiredToken);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('TokenExpiredError');
    });

    test('should reject token with wrong signature', () => {
      const wrongToken = jwt.sign(
        { sub: mockUser.id },
        'wrong-secret'
      );
      
      const result = jwtService.verifyAccessToken(wrongToken);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('JsonWebTokenError');
    });
  });
});
```

### Integration Tests
```javascript
import request from 'supertest';
import app from './app';

describe('JWT Authentication Flow', () => {
  let accessToken;
  let refreshToken;

  test('should login and receive tokens', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      })
      .expect(200);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    
    accessToken = response.body.accessToken;
    refreshToken = response.body.refreshToken;
  });

  test('should access protected route with token', async () => {
    const response = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toHaveProperty('email', 'test@example.com');
  });

  test('should reject request without token', async () => {
    await request(app)
      .get('/api/profile')
      .expect(401);
  });

  test('should refresh tokens', async () => {
    const response = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body.accessToken).not.toBe(accessToken);
  });
});
```

## Resources
- [JWT.io - JWT Debugger and Documentation](https://jwt.io/)
- [RFC 7519 - JSON Web Token](https://tools.ietf.org/html/rfc7519)
- [OWASP JWT Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [Node.js JWT Library](https://github.com/auth0/node-jsonwebtoken)