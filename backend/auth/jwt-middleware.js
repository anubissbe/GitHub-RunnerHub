const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Generate a secure secret if not provided
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

// Store active tokens (in production, use Redis or similar)
const activeTokens = new Set();
const refreshTokens = new Map(); // refreshToken -> userId

class JWTAuth {
  constructor() {
    this.secret = JWT_SECRET;
    this.expiry = JWT_EXPIRY;
  }

  // Generate access token
  generateAccessToken(payload) {
    const token = jwt.sign(payload, this.secret, {
      expiresIn: this.expiry,
      issuer: 'github-runnerhub',
      audience: 'runnerhub-api'
    });
    
    activeTokens.add(token);
    return token;
  }

  // Generate refresh token
  generateRefreshToken(userId) {
    const refreshToken = crypto.randomBytes(64).toString('hex');
    refreshTokens.set(refreshToken, userId);
    return refreshToken;
  }

  // Generate both tokens
  generateTokenPair(payload) {
    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload.userId || payload.id);
    
    return {
      accessToken,
      refreshToken,
      expiresIn: this.expiry,
      tokenType: 'Bearer'
    };
  }

  // Verify token
  verifyToken(token) {
    try {
      // Check if token is in active set
      if (!activeTokens.has(token)) {
        throw new Error('Token has been revoked');
      }

      const decoded = jwt.verify(token, this.secret, {
        issuer: 'github-runnerhub',
        audience: 'runnerhub-api'
      });

      return decoded;
    } catch (error) {
      throw new Error(`Invalid token: ${error.message}`);
    }
  }

  // Refresh access token
  refreshAccessToken(refreshToken) {
    const userId = refreshTokens.get(refreshToken);
    if (!userId) {
      throw new Error('Invalid refresh token');
    }

    // Generate new access token
    const newAccessToken = this.generateAccessToken({ userId });
    
    return {
      accessToken: newAccessToken,
      expiresIn: this.expiry,
      tokenType: 'Bearer'
    };
  }

  // Revoke token
  revokeToken(token) {
    activeTokens.delete(token);
  }

  // Revoke refresh token
  revokeRefreshToken(refreshToken) {
    refreshTokens.delete(refreshToken);
  }

  // Middleware for Express
  middleware(options = {}) {
    const { required = true, roles = [] } = options;

    return (req, res, next) => {
      // Skip auth for health checks and public endpoints
      if (req.path === '/health' || req.path === '/api/auth/login') {
        return next();
      }

      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        if (required) {
          return res.status(401).json({ error: 'No authorization header provided' });
        }
        return next();
      }

      const [type, token] = authHeader.split(' ');
      
      if (type !== 'Bearer') {
        return res.status(401).json({ error: 'Invalid authorization type' });
      }

      try {
        const decoded = this.verifyToken(token);
        req.user = decoded;

        // Check roles if specified
        if (roles.length > 0 && !roles.includes(decoded.role)) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
      } catch (error) {
        return res.status(401).json({ error: error.message });
      }
    };
  }

  // Admin middleware
  adminOnly() {
    return this.middleware({ required: true, roles: ['admin'] });
  }

  // Optional auth middleware
  optional() {
    return this.middleware({ required: false });
  }
}

// Create singleton instance
const jwtAuth = new JWTAuth();

// Auth endpoints
function setupAuthEndpoints(app, rateLimiters) {
  // Apply rate limiting to auth endpoints if provided
  const authRateLimit = rateLimiters?.auth || ((req, res, next) => next());
  
  // Login endpoint
  app.post('/api/auth/login', authRateLimit, async (req, res) => {
    const { username, password, githubToken } = req.body;

    try {
      // Validate credentials
      let user = null;
      
      if (githubToken) {
        // Validate GitHub token
        const { Octokit } = require('@octokit/rest');
        const octokit = new Octokit({ auth: githubToken });
        
        try {
          const { data: githubUser } = await octokit.rest.users.getAuthenticated();
          user = {
            id: githubUser.id,
            username: githubUser.login,
            email: githubUser.email,
            role: 'user',
            provider: 'github'
          };
        } catch (error) {
          return res.status(401).json({ error: 'Invalid GitHub token' });
        }
      } else if (username && password) {
        // Simple username/password auth (for demo - use bcrypt in production)
        if (username === process.env.ADMIN_USERNAME && 
            password === process.env.ADMIN_PASSWORD) {
          user = {
            id: 'admin-1',
            username: 'admin',
            role: 'admin',
            provider: 'local'
          };
        } else {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
      } else {
        return res.status(400).json({ error: 'Missing credentials' });
      }

      // Generate tokens
      const tokens = jwtAuth.generateTokenPair(user);
      
      res.json({
        user,
        ...tokens
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Refresh token endpoint
  app.post('/api/auth/refresh', (req, res) => {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh token' });
    }

    try {
      const tokens = jwtAuth.refreshAccessToken(refreshToken);
      res.json(tokens);
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  });

  // Logout endpoint
  app.post('/api/auth/logout', jwtAuth.middleware(), (req, res) => {
    const authHeader = req.headers.authorization;
    const [, token] = authHeader.split(' ');
    
    // Revoke the token
    jwtAuth.revokeToken(token);
    
    // Also revoke refresh token if provided
    if (req.body.refreshToken) {
      jwtAuth.revokeRefreshToken(req.body.refreshToken);
    }
    
    res.json({ message: 'Logged out successfully' });
  });

  // Get current user endpoint
  app.get('/api/auth/me', jwtAuth.middleware(), (req, res) => {
    res.json({ user: req.user });
  });
}

module.exports = {
  jwtAuth,
  setupAuthEndpoints,
  JWT_SECRET
};