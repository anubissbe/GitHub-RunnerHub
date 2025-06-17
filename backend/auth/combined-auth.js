const { jwtAuth } = require('./jwt-middleware');
const { APIKeyManager } = require('./api-key-manager');

// Combined authentication middleware that supports both JWT and API keys
function createCombinedAuth(apiKeyManager) {
  return function combinedAuth(options = {}) {
    const { 
      required = true, 
      roles = [], 
      scopes = [],
      preferJWT = true 
    } = options;

    return async (req, res, next) => {
      // Skip auth for health checks and auth endpoints
      if (req.path === '/health' || 
          req.path.startsWith('/api/auth/') ||
          req.path === '/api/public/status') {
        return next();
      }

      let authenticated = false;
      let authMethod = null;

      // Try JWT authentication first (if preferred)
      if (preferJWT) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          try {
            const token = authHeader.split(' ')[1];
            const decoded = jwtAuth.verifyToken(token);
            req.user = decoded;
            authenticated = true;
            authMethod = 'jwt';

            // Check roles for JWT
            if (roles.length > 0 && !roles.includes(decoded.role)) {
              return res.status(403).json({ 
                error: 'Insufficient permissions',
                required: roles,
                provided: decoded.role
              });
            }
          } catch (error) {
            // JWT failed, try API key next
          }
        }
      }

      // Try API key authentication if JWT failed or not preferred
      if (!authenticated) {
        const apiKey = req.headers['x-api-key'] || 
                       req.headers['authorization']?.replace('Bearer ', '');

        if (apiKey && apiKey.startsWith('rh_')) {
          try {
            const validation = await apiKeyManager.validateAPIKey(apiKey);
            
            if (validation.valid) {
              req.apiKey = {
                id: validation.keyId,
                scopes: validation.scopes,
                userId: validation.userId,
                name: validation.name
              };
              authenticated = true;
              authMethod = 'apikey';

              // Check scopes for API key
              if (scopes.length > 0) {
                const hasRequiredScopes = scopes.every(scope => 
                  validation.scopes.includes(scope)
                );
                
                if (!hasRequiredScopes) {
                  return res.status(403).json({ 
                    error: 'Insufficient permissions',
                    required: scopes,
                    provided: validation.scopes
                  });
                }
              }

              // API keys can't have roles, so deny if roles are required
              if (roles.length > 0 && !roles.includes('apikey')) {
                return res.status(403).json({ 
                  error: 'API keys cannot access role-restricted endpoints',
                  required: roles
                });
              }
            }
          } catch (error) {
            // API key failed
          }
        }
      }

      // Check if authentication succeeded
      if (!authenticated) {
        if (required) {
          return res.status(401).json({ 
            error: 'Authentication required. Use JWT token or API key.' 
          });
        }
        // Optional auth, continue without auth
        return next();
      }

      // Add auth method to request
      req.authMethod = authMethod;
      next();
    };
  };
}

// Helper middleware factories
function createAuthMiddleware(apiKeyManager) {
  const combinedAuth = createCombinedAuth(apiKeyManager);

  return {
    // Require authentication (JWT or API key)
    required: () => combinedAuth({ required: true }),
    
    // Optional authentication
    optional: () => combinedAuth({ required: false }),
    
    // Admin only (JWT with admin role)
    adminOnly: () => combinedAuth({ 
      required: true, 
      roles: ['admin'],
      preferJWT: true 
    }),
    
    // Read access (JWT or API key with read scope)
    readAccess: () => combinedAuth({ 
      required: true, 
      scopes: ['read'] 
    }),
    
    // Write access (JWT or API key with write scope)
    writeAccess: () => combinedAuth({ 
      required: true, 
      scopes: ['write'] 
    }),
    
    // Full access (JWT or API key with admin scope)
    fullAccess: () => combinedAuth({ 
      required: true, 
      scopes: ['admin'] 
    }),

    // Custom requirements
    custom: (options) => combinedAuth(options)
  };
}

module.exports = {
  createCombinedAuth,
  createAuthMiddleware
};