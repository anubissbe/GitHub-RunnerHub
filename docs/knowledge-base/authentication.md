# Authentication - JWT + API Keys Patterns

## Overview

Authentication is the process of verifying the identity of users and systems accessing GitHub RunnerHub. The system implements a dual authentication strategy using JWT tokens for user sessions and API keys for programmatic access, providing flexibility and security for different use cases.

## Official Resources

- **JWT Specification**: https://tools.ietf.org/html/rfc7519
- **JWT Best Practices**: https://tools.ietf.org/html/rfc8725
- **OWASP Authentication Guide**: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- **API Key Security**: https://cloud.google.com/endpoints/docs/openapi/when-why-api-key
- **OAuth 2.0**: https://tools.ietf.org/html/rfc6749

## Integration with GitHub RunnerHub

### JWT Authentication Implementation

```javascript
// auth/jwt-middleware.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class JWTAuth {
  constructor() {
    this.secretKey = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
    this.refreshSecretKey = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString('hex');
    this.tokenExpiry = process.env.JWT_EXPIRY || '15m';
    this.refreshTokenExpiry = process.env.JWT_REFRESH_EXPIRY || '7d';
  }

  generateTokens(payload) {
    const accessToken = jwt.sign(
      {
        ...payload,
        type: 'access',
        iat: Math.floor(Date.now() / 1000)
      },
      this.secretKey,
      {
        expiresIn: this.tokenExpiry,
        issuer: 'github-runnerhub',
        audience: 'runnerhub-api'
      }
    );

    const refreshToken = jwt.sign(
      {
        userId: payload.userId,
        type: 'refresh',
        iat: Math.floor(Date.now() / 1000)
      },
      this.refreshSecretKey,
      {
        expiresIn: this.refreshTokenExpiry,
        issuer: 'github-runnerhub',
        audience: 'runnerhub-api'
      }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseExpiry(this.tokenExpiry),
      tokenType: 'Bearer'
    };
  }

  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.secretKey, {
        issuer: 'github-runnerhub',
        audience: 'runnerhub-api'
      });

      if (decoded.type !== 'access') {
        throw new Error('Invalid token type');
      }

      return { valid: true, payload: decoded };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.refreshSecretKey, {
        issuer: 'github-runnerhub',
        audience: 'runnerhub-api'
      });

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      return { valid: true, payload: decoded };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  parseExpiry(expiry) {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // Default 15 minutes

    const value = parseInt(match[1]);
    const unit = match[2];

    const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * multipliers[unit];
  }
}

// Middleware for JWT authentication
const authenticateJWT = (jwtAuth) => {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Access token required',
        code: 'TOKEN_MISSING'
      });
    }

    const token = authHeader.substring(7);
    const verification = jwtAuth.verifyAccessToken(token);

    if (!verification.valid) {
      return res.status(403).json({
        error: 'Invalid or expired token',
        code: 'TOKEN_INVALID',
        details: verification.error
      });
    }

    req.user = verification.payload;
    next();
  };
};

module.exports = { JWTAuth, authenticateJWT };
```

### API Key Authentication

```javascript
// auth/api-key-manager.js
const crypto = require('crypto');
const bcrypt = require('bcrypt');

class APIKeyManager {
  constructor(redis, db) {
    this.redis = redis;
    this.db = db;
    this.keyPrefix = 'rh_'; // RunnerHub prefix
    this.hashRounds = 12;
  }

  async generateAPIKey(userId, name, permissions = [], expiresIn = null) {
    // Generate a cryptographically secure API key
    const keyId = crypto.randomBytes(8).toString('hex');
    const keySecret = crypto.randomBytes(32).toString('hex');
    const apiKey = `${this.keyPrefix}${keyId}_${keySecret}`;

    // Hash the secret for storage
    const hashedSecret = await bcrypt.hash(keySecret, this.hashRounds);

    const keyData = {
      id: keyId,
      userId,
      name,
      hashedSecret,
      permissions,
      createdAt: new Date(),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn) : null,
      lastUsed: null,
      isActive: true
    };

    // Store in database
    await this.db.apiKeys.create(keyData);

    // Cache in Redis for faster lookups
    await this.redis.setex(
      `api_key:${keyId}`,
      expiresIn ? Math.floor(expiresIn / 1000) : 86400 * 365, // 1 year default
      JSON.stringify(keyData)
    );

    return {
      apiKey, // Return the full key only once
      keyId,
      name,
      permissions,
      expiresAt: keyData.expiresAt
    };
  }

  async verifyAPIKey(apiKey) {
    if (!apiKey || !apiKey.startsWith(this.keyPrefix)) {
      return { valid: false, error: 'Invalid API key format' };
    }

    const parts = apiKey.substring(this.keyPrefix.length).split('_');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid API key format' };
    }

    const [keyId, keySecret] = parts;

    try {
      // Try Redis cache first
      let keyData = await this.redis.get(`api_key:${keyId}`);
      
      if (keyData) {
        keyData = JSON.parse(keyData);
      } else {
        // Fall back to database
        keyData = await this.db.apiKeys.findOne({ id: keyId, isActive: true });
        if (keyData) {
          // Update cache
          await this.redis.setex(`api_key:${keyId}`, 3600, JSON.stringify(keyData));
        }
      }

      if (!keyData) {
        return { valid: false, error: 'API key not found' };
      }

      // Check expiration
      if (keyData.expiresAt && new Date() > new Date(keyData.expiresAt)) {
        return { valid: false, error: 'API key expired' };
      }

      // Verify secret
      const isValidSecret = await bcrypt.compare(keySecret, keyData.hashedSecret);
      if (!isValidSecret) {
        return { valid: false, error: 'Invalid API key' };
      }

      // Update last used timestamp
      await this.updateLastUsed(keyId);

      return {
        valid: true,
        keyData: {
          id: keyData.id,
          userId: keyData.userId,
          name: keyData.name,
          permissions: keyData.permissions
        }
      };
    } catch (error) {
      console.error('API key verification error:', error);
      return { valid: false, error: 'Verification failed' };
    }
  }

  async updateLastUsed(keyId) {
    const now = new Date();
    
    // Update database
    await this.db.apiKeys.updateOne(
      { id: keyId },
      { $set: { lastUsed: now } }
    );

    // Update cache
    const cachedData = await this.redis.get(`api_key:${keyId}`);
    if (cachedData) {
      const keyData = JSON.parse(cachedData);
      keyData.lastUsed = now;
      await this.redis.setex(`api_key:${keyId}`, 3600, JSON.stringify(keyData));
    }
  }

  async revokeAPIKey(keyId, userId = null) {
    // Verify ownership if userId provided
    if (userId) {
      const keyData = await this.db.apiKeys.findOne({ id: keyId });
      if (!keyData || keyData.userId !== userId) {
        throw new Error('API key not found or access denied');
      }
    }

    // Deactivate in database
    await this.db.apiKeys.updateOne(
      { id: keyId },
      { $set: { isActive: false, revokedAt: new Date() } }
    );

    // Remove from cache
    await this.redis.del(`api_key:${keyId}`);

    return { success: true };
  }

  async listAPIKeys(userId, includeRevoked = false) {
    const filter = { userId };
    if (!includeRevoked) {
      filter.isActive = true;
    }

    const keys = await this.db.apiKeys.find(filter, {
      projection: {
        hashedSecret: 0 // Never return hashed secrets
      }
    }).sort({ createdAt: -1 });

    return keys.map(key => ({
      id: key.id,
      name: key.name,
      permissions: key.permissions,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastUsed: key.lastUsed,
      isActive: key.isActive
    }));
  }
}

// Middleware for API key authentication
const authenticateAPIKey = (apiKeyManager) => {
  return async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
      return res.status(401).json({
        error: 'API key required',
        code: 'API_KEY_MISSING'
      });
    }

    const verification = await apiKeyManager.verifyAPIKey(apiKey);
    
    if (!verification.valid) {
      return res.status(403).json({
        error: 'Invalid API key',
        code: 'API_KEY_INVALID',
        details: verification.error
      });
    }

    req.apiKey = verification.keyData;
    req.user = { id: verification.keyData.userId, type: 'api_key' };
    next();
  };
};

module.exports = { APIKeyManager, authenticateAPIKey };
```

### Combined Authentication Strategy

```javascript
// auth/combined-auth.js
class CombinedAuth {
  constructor(jwtAuth, apiKeyManager) {
    this.jwtAuth = jwtAuth;
    this.apiKeyManager = apiKeyManager;
  }

  // Middleware that accepts either JWT or API key
  authenticate() {
    return async (req, res, next) => {
      // Check for JWT token first
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const verification = this.jwtAuth.verifyAccessToken(token);
        
        if (verification.valid) {
          req.user = verification.payload;
          req.authType = 'jwt';
          return next();
        }
      }

      // Check for API key
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (apiKey) {
        const verification = await this.apiKeyManager.verifyAPIKey(apiKey);
        
        if (verification.valid) {
          req.apiKey = verification.keyData;
          req.user = { 
            id: verification.keyData.userId, 
            permissions: verification.keyData.permissions,
            type: 'api_key' 
          };
          req.authType = 'api_key';
          return next();
        }
      }

      // No valid authentication found
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
        acceptedMethods: ['Bearer token', 'API key']
      });
    };
  }

  // Check specific permissions
  requirePermission(permission) {
    return (req, res, next) => {
      if (req.authType === 'jwt') {
        // JWT users have all permissions by default (authenticated users)
        return next();
      }

      if (req.authType === 'api_key') {
        const permissions = req.apiKey.permissions || [];
        
        if (!permissions.includes(permission) && !permissions.includes('*')) {
          return res.status(403).json({
            error: 'Insufficient permissions',
            code: 'PERMISSION_DENIED',
            required: permission
          });
        }
      }

      next();
    };
  }

  // Require specific authentication type
  requireAuthType(type) {
    return (req, res, next) => {
      if (req.authType !== type) {
        return res.status(403).json({
          error: `${type} authentication required`,
          code: 'AUTH_TYPE_REQUIRED',
          current: req.authType
        });
      }
      next();
    };
  }
}
```

## Configuration Best Practices

### 1. Security Configuration

```javascript
// Security settings for authentication
const authConfig = {
  jwt: {
    secret: process.env.JWT_SECRET, // Must be strong random string
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    algorithm: 'HS256',
    expiresIn: '15m',
    refreshExpiresIn: '7d',
    issuer: 'github-runnerhub',
    audience: 'runnerhub-api'
  },
  
  apiKey: {
    keyLength: 32, // bytes
    hashRounds: 12, // bcrypt rounds
    prefix: 'rh_',
    defaultExpiry: 365 * 24 * 60 * 60 * 1000, // 1 year
    maxKeysPerUser: 10
  },
  
  security: {
    maxLoginAttempts: 5,
    lockoutDuration: 15 * 60 * 1000, // 15 minutes
    passwordMinLength: 8,
    requireStrongPasswords: true,
    sessionTimeout: 60 * 60 * 1000, // 1 hour
    refreshTokenRotation: true
  }
};
```

### 2. Permission System

```javascript
// Permission definitions
const Permissions = {
  // Runner management
  RUNNERS_READ: 'runners:read',
  RUNNERS_CREATE: 'runners:create',
  RUNNERS_DELETE: 'runners:delete',
  RUNNERS_MANAGE: 'runners:manage',
  
  // Workflow access
  WORKFLOWS_READ: 'workflows:read',
  WORKFLOWS_TRIGGER: 'workflows:trigger',
  
  // Metrics access
  METRICS_READ: 'metrics:read',
  METRICS_DETAILED: 'metrics:detailed',
  
  // Admin operations
  ADMIN_USERS: 'admin:users',
  ADMIN_SYSTEM: 'admin:system',
  
  // All permissions
  ALL: '*'
};

// Permission groups for easy assignment
const PermissionGroups = {
  READONLY: [
    Permissions.RUNNERS_READ,
    Permissions.WORKFLOWS_READ,
    Permissions.METRICS_READ
  ],
  
  DEVELOPER: [
    Permissions.RUNNERS_READ,
    Permissions.RUNNERS_CREATE,
    Permissions.WORKFLOWS_READ,
    Permissions.WORKFLOWS_TRIGGER,
    Permissions.METRICS_READ
  ],
  
  OPERATOR: [
    Permissions.RUNNERS_MANAGE,
    Permissions.WORKFLOWS_READ,
    Permissions.WORKFLOWS_TRIGGER,
    Permissions.METRICS_DETAILED
  ],
  
  ADMIN: [Permissions.ALL]
};
```

### 3. Multi-Factor Authentication

```javascript
// MFA implementation
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

class MFAManager {
  constructor(db) {
    this.db = db;
  }

  async setupMFA(userId) {
    const secret = speakeasy.generateSecret({
      name: `GitHub RunnerHub (${userId})`,
      issuer: 'GitHub RunnerHub'
    });

    // Store temporary secret
    await this.db.mfaSetup.create({
      userId,
      tempSecret: secret.base32,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    // Generate QR code
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    return {
      secret: secret.base32,
      qrCode,
      backupCodes: this.generateBackupCodes()
    };
  }

  async verifyMFA(userId, token) {
    const user = await this.db.users.findById(userId);
    if (!user || !user.mfaSecret) {
      return { valid: false, error: 'MFA not enabled' };
    }

    // Verify TOTP token
    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token,
      window: 2 // Allow 2 time steps before/after
    });

    if (verified) {
      // Update last MFA time
      await this.db.users.updateOne(
        { _id: userId },
        { $set: { lastMFAVerification: new Date() } }
      );
    }

    return { valid: verified };
  }

  generateBackupCodes() {
    return Array.from({ length: 8 }, () => 
      crypto.randomBytes(4).toString('hex').toUpperCase()
    );
  }
}
```

## Security Considerations

### 1. Token Security

```javascript
// Secure token handling
class SecureTokenHandler {
  constructor() {
    this.blacklistedTokens = new Set();
    this.tokenMetrics = new Map();
  }

  // Track token usage patterns
  trackTokenUsage(token, req) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    if (!this.tokenMetrics.has(tokenHash)) {
      this.tokenMetrics.set(tokenHash, {
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        requestCount: 0,
        ips: new Set(),
        userAgents: new Set()
      });
    }

    const metrics = this.tokenMetrics.get(tokenHash);
    metrics.lastSeen = Date.now();
    metrics.requestCount++;
    metrics.ips.add(req.ip);
    metrics.userAgents.add(req.get('User-Agent'));

    // Detect suspicious activity
    if (metrics.ips.size > 5 || metrics.userAgents.size > 3) {
      this.flagSuspiciousToken(tokenHash);
    }
  }

  flagSuspiciousToken(tokenHash) {
    console.warn(`Suspicious token activity detected: ${tokenHash}`);
    // Could implement additional security measures here
  }

  blacklistToken(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    this.blacklistedTokens.add(tokenHash);
  }

  isTokenBlacklisted(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return this.blacklistedTokens.has(tokenHash);
  }
}
```

### 2. Session Management

```javascript
// Secure session management
class SessionManager {
  constructor(redis) {
    this.redis = redis;
    this.sessionTimeout = 60 * 60 * 1000; // 1 hour
  }

  async createSession(userId, metadata = {}) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const sessionData = {
      userId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      metadata,
      isActive: true
    };

    await this.redis.setex(
      `session:${sessionId}`,
      Math.floor(this.sessionTimeout / 1000),
      JSON.stringify(sessionData)
    );

    return sessionId;
  }

  async validateSession(sessionId) {
    const sessionData = await this.redis.get(`session:${sessionId}`);
    
    if (!sessionData) {
      return { valid: false, error: 'Session not found' };
    }

    const session = JSON.parse(sessionData);
    
    // Check if session is still active
    if (!session.isActive) {
      return { valid: false, error: 'Session inactive' };
    }

    // Update last activity
    session.lastActivity = Date.now();
    await this.redis.setex(
      `session:${sessionId}`,
      Math.floor(this.sessionTimeout / 1000),
      JSON.stringify(session)
    );

    return { valid: true, session };
  }

  async revokeSession(sessionId) {
    await this.redis.del(`session:${sessionId}`);
  }

  async revokeAllUserSessions(userId) {
    // This would require maintaining a user->sessions mapping
    const userSessions = await this.redis.smembers(`user_sessions:${userId}`);
    
    for (const sessionId of userSessions) {
      await this.revokeSession(sessionId);
    }
    
    await this.redis.del(`user_sessions:${userId}`);
  }
}
```

### 3. Brute Force Protection

```javascript
// Brute force protection
class BruteForceProtection {
  constructor(redis) {
    this.redis = redis;
    this.maxAttempts = 5;
    this.lockoutDuration = 15 * 60; // 15 minutes
  }

  async recordAttempt(identifier, success = false) {
    const key = `auth_attempts:${identifier}`;
    
    if (success) {
      // Clear attempts on successful login
      await this.redis.del(key);
      return { blocked: false };
    }

    // Increment failed attempts
    const attempts = await this.redis.incr(key);
    await this.redis.expire(key, this.lockoutDuration);

    if (attempts >= this.maxAttempts) {
      // Block further attempts
      await this.redis.setex(`blocked:${identifier}`, this.lockoutDuration, '1');
      
      return {
        blocked: true,
        attempts,
        resetTime: Date.now() + (this.lockoutDuration * 1000)
      };
    }

    return {
      blocked: false,
      attempts,
      remaining: this.maxAttempts - attempts
    };
  }

  async isBlocked(identifier) {
    const blocked = await this.redis.get(`blocked:${identifier}`);
    return !!blocked;
  }

  async unblock(identifier) {
    await this.redis.del(`auth_attempts:${identifier}`);
    await this.redis.del(`blocked:${identifier}`);
  }
}
```

## Monitoring and Debugging

### 1. Authentication Metrics

```javascript
// Authentication monitoring
class AuthMetrics {
  constructor(redis) {
    this.redis = redis;
    this.metrics = {
      loginAttempts: 0,
      successfulLogins: 0,
      failedLogins: 0,
      apiKeyUsage: 0,
      jwtTokensIssued: 0,
      blockedAttempts: 0
    };
  }

  recordLogin(success, method = 'jwt') {
    this.metrics.loginAttempts++;
    
    if (success) {
      this.metrics.successfulLogins++;
      if (method === 'jwt') {
        this.metrics.jwtTokensIssued++;
      }
    } else {
      this.metrics.failedLogins++;
    }
  }

  recordAPIKeyUsage(keyId) {
    this.metrics.apiKeyUsage++;
    
    // Track per-key usage
    this.redis.incr(`api_key_usage:${keyId}`);
  }

  recordBlocked(identifier) {
    this.metrics.blockedAttempts++;
    
    // Log blocked attempt
    console.warn(`Authentication blocked for: ${identifier}`);
  }

  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.successfulLogins / this.metrics.loginAttempts,
      failureRate: this.metrics.failedLogins / this.metrics.loginAttempts
    };
  }
}
```

### 2. Security Event Logging

```javascript
// Security event logging
class SecurityLogger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
  }

  logAuthEvent(event, data) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      data,
      level: this.getEventLevel(event)
    };

    console.log(JSON.stringify(logEntry));
    
    // Send to monitoring system
    if (this.shouldAlert(event)) {
      this.sendAlert(logEntry);
    }
  }

  getEventLevel(event) {
    const levels = {
      'login_success': 'info',
      'login_failure': 'warn',
      'brute_force_detected': 'error',
      'suspicious_token_usage': 'warn',
      'api_key_created': 'info',
      'api_key_revoked': 'warn'
    };

    return levels[event] || 'info';
  }

  shouldAlert(event) {
    const alertEvents = [
      'brute_force_detected',
      'suspicious_token_usage',
      'multiple_failed_logins'
    ];

    return alertEvents.includes(event);
  }

  sendAlert(logEntry) {
    // Implement alerting mechanism (email, Slack, etc.)
    console.error('SECURITY ALERT:', logEntry);
  }
}
```

## Performance Optimization

### 1. Token Caching

```javascript
// Efficient token validation with caching
class CachedTokenValidator {
  constructor(redis, jwtAuth) {
    this.redis = redis;
    this.jwtAuth = jwtAuth;
    this.cacheTimeout = 300; // 5 minutes
  }

  async validateToken(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const cacheKey = `token_validation:${tokenHash}`;
    
    // Check cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const result = JSON.parse(cached);
      
      // Check if token is close to expiry
      if (result.exp && (result.exp - Date.now() / 1000) < 60) {
        // Token expires in less than 1 minute, validate fresh
        return this.validateFresh(token, cacheKey);
      }
      
      return result;
    }

    return this.validateFresh(token, cacheKey);
  }

  async validateFresh(token, cacheKey) {
    const result = this.jwtAuth.verifyAccessToken(token);
    
    if (result.valid) {
      // Cache the result
      await this.redis.setex(
        cacheKey,
        this.cacheTimeout,
        JSON.stringify(result)
      );
    }

    return result;
  }
}
```

### 2. Connection Pooling

```javascript
// Database connection pooling for auth operations
class AuthDatabase {
  constructor() {
    this.pool = mysql.createPool({
      connectionLimit: 10,
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      acquireTimeout: 60000,
      timeout: 60000
    });
  }

  async getUserById(userId) {
    return new Promise((resolve, reject) => {
      this.pool.query(
        'SELECT * FROM users WHERE id = ?',
        [userId],
        (error, results) => {
          if (error) reject(error);
          else resolve(results[0]);
        }
      );
    });
  }

  async updateLastLogin(userId) {
    return new Promise((resolve, reject) => {
      this.pool.query(
        'UPDATE users SET last_login = NOW() WHERE id = ?',
        [userId],
        (error, results) => {
          if (error) reject(error);
          else resolve(results);
        }
      );
    });
  }
}
```

## Testing Authentication

```javascript
// Authentication testing
describe('Authentication', () => {
  let jwtAuth, apiKeyManager, combinedAuth;
  
  beforeEach(() => {
    jwtAuth = new JWTAuth();
    apiKeyManager = new APIKeyManager(redis, db);
    combinedAuth = new CombinedAuth(jwtAuth, apiKeyManager);
  });

  describe('JWT Authentication', () => {
    test('should generate valid tokens', () => {
      const tokens = jwtAuth.generateTokens({ userId: 'test123', role: 'user' });
      
      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(tokens.tokenType).toBe('Bearer');
    });

    test('should verify valid tokens', () => {
      const tokens = jwtAuth.generateTokens({ userId: 'test123' });
      const result = jwtAuth.verifyAccessToken(tokens.accessToken);
      
      expect(result.valid).toBe(true);
      expect(result.payload.userId).toBe('test123');
    });

    test('should reject expired tokens', (done) => {
      // Create JWT with very short expiry
      const shortJWT = new JWTAuth();
      shortJWT.tokenExpiry = '1ms';
      
      const tokens = shortJWT.generateTokens({ userId: 'test123' });
      
      setTimeout(() => {
        const result = shortJWT.verifyAccessToken(tokens.accessToken);
        expect(result.valid).toBe(false);
        done();
      }, 10);
    });
  });

  describe('API Key Authentication', () => {
    test('should generate and verify API keys', async () => {
      const keyInfo = await apiKeyManager.generateAPIKey(
        'user123', 
        'test-key', 
        ['runners:read']
      );
      
      expect(keyInfo.apiKey).toMatch(/^rh_[a-f0-9]{16}_[a-f0-9]{64}$/);
      
      const verification = await apiKeyManager.verifyAPIKey(keyInfo.apiKey);
      expect(verification.valid).toBe(true);
    });

    test('should revoke API keys', async () => {
      const keyInfo = await apiKeyManager.generateAPIKey('user123', 'test-key');
      
      await apiKeyManager.revokeAPIKey(keyInfo.keyId);
      
      const verification = await apiKeyManager.verifyAPIKey(keyInfo.apiKey);
      expect(verification.valid).toBe(false);
    });
  });
});
```

## Related Technologies

- OAuth 2.0 / OpenID Connect
- SAML
- Passport.js (Node.js authentication)
- Auth0 (identity platform)
- Firebase Authentication