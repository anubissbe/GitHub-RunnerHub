import jwt from 'jsonwebtoken';
import { AuthMiddleware } from '../../src/middleware/auth';

describe('AuthMiddleware', () => {
  let authMiddleware: AuthMiddleware;
  const mockJWTSecret = 'test-secret-key-for-jwt-testing';

  beforeEach(() => {
    authMiddleware = AuthMiddleware.getInstance();
    // Mock the initialization to avoid Vault dependency in tests
    (authMiddleware as any).jwtSecret = mockJWTSecret;
    (authMiddleware as any).initialized = true;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Token Generation and Verification', () => {
    it('should generate a valid JWT token', () => {
      const payload = {
        sub: 'user123',
        username: 'testuser',
        role: 'admin' as const,
        permissions: ['users:read', 'users:write']
      };

      const token = authMiddleware.generateToken(payload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should verify and decode a valid token', () => {
      const payload = {
        sub: 'user123',
        username: 'testuser',
        role: 'operator' as const,
        permissions: ['jobs:read', 'jobs:write']
      };

      const token = authMiddleware.generateToken(payload);
      const decoded = authMiddleware.verifyToken(token);

      expect(decoded.sub).toBe(payload.sub);
      expect(decoded.username).toBe(payload.username);
      expect(decoded.role).toBe(payload.role);
      expect(decoded.permissions).toEqual(payload.permissions);
      expect(decoded.iss).toBe('github-runnerhub');
      expect(decoded.aud).toBe('github-runnerhub-api');
    });

    it('should reject an invalid token', () => {
      expect(() => {
        authMiddleware.verifyToken('invalid.token.here');
      }).toThrow('Invalid token');
    });

    it('should reject an expired token', () => {
      const expiredToken = jwt.sign(
        {
          sub: 'user123',
          username: 'testuser',
          role: 'viewer',
          permissions: ['jobs:read'],
          iat: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
          exp: Math.floor(Date.now() / 1000) - 1800, // 30 minutes ago (expired)
          iss: 'github-runnerhub',
          aud: 'github-runnerhub-api'
        },
        mockJWTSecret
      );

      expect(() => {
        authMiddleware.verifyToken(expiredToken);
      }).toThrow('Token has expired');
    });
  });

  describe('Token Refresh', () => {
    it('should refresh a valid token', () => {
      const payload = {
        sub: 'user123',
        username: 'testuser',
        role: 'admin' as const,
        permissions: ['users:read', 'users:write']
      };

      const originalToken = authMiddleware.generateToken(payload);
      const refreshedToken = authMiddleware.refreshToken(originalToken);

      expect(refreshedToken).toBeDefined();
      expect(refreshedToken).not.toBe(originalToken);

      const decoded = authMiddleware.verifyToken(refreshedToken);
      expect(decoded.sub).toBe(payload.sub);
      expect(decoded.username).toBe(payload.username);
    });
  });

  describe('Authentication Middleware', () => {
    it('should create authentication middleware function', () => {
      const middleware = authMiddleware.authenticate();
      expect(typeof middleware).toBe('function');
    });

    it('should create authorization middleware function', () => {
      const middleware = authMiddleware.authorize('admin');
      expect(typeof middleware).toBe('function');
    });

    it('should create permission-based middleware function', () => {
      const middleware = authMiddleware.requirePermission('users:read');
      expect(typeof middleware).toBe('function');
    });

    it('should create optional auth middleware function', () => {
      const middleware = authMiddleware.optionalAuth();
      expect(typeof middleware).toBe('function');
    });
  });

  describe('Role-Based Authorization', () => {
    const createMockRequest = (token?: string) => ({
      headers: {
        authorization: token ? `Bearer ${token}` : undefined
      }
    });

    // Utility function for creating mock responses (commented out as not used in current tests)
    // const createMockResponse = () => {
    //   const res = {
    //     status: jest.fn().mockReturnThis(),
    //     json: jest.fn().mockReturnThis()
    //   };
    //   return res;
    // };

    it('should extract token from Bearer authorization header', () => {
      const payload = {
        sub: 'user123',
        username: 'admin',
        role: 'admin' as const,
        permissions: ['users:read', 'users:write']
      };

      const token = authMiddleware.generateToken(payload);
      const extractToken = (authMiddleware as any).extractToken;
      
      const req = createMockRequest(token);
      const extractedToken = extractToken(req);
      
      expect(extractedToken).toBe(token);
    });

    it('should return null when no authorization header', () => {
      const extractToken = (authMiddleware as any).extractToken;
      const req = createMockRequest();
      const extractedToken = extractToken(req);
      
      expect(extractedToken).toBeNull();
    });
  });

  describe('Initialization', () => {
    it('should track initialization status', () => {
      expect(authMiddleware.isInitialized()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JWT tokens gracefully', () => {
      expect(() => {
        authMiddleware.verifyToken('not.a.valid.jwt.token.at.all');
      }).toThrow();
    });

    it('should handle empty token', () => {
      expect(() => {
        authMiddleware.verifyToken('');
      }).toThrow();
    });
  });

  describe('Role and Permission Validation', () => {
    it('should validate admin role permissions', () => {
      const payload = {
        sub: 'admin123',
        username: 'admin',
        role: 'admin' as const,
        permissions: [
          'users:read', 'users:write', 'users:delete',
          'jobs:read', 'jobs:write', 'jobs:delete',
          'runners:read', 'runners:write', 'runners:delete',
          'system:read', 'system:write',
          'monitoring:read', 'monitoring:write'
        ]
      };

      const token = authMiddleware.generateToken(payload);
      const decoded = authMiddleware.verifyToken(token);

      expect(decoded.role).toBe('admin');
      expect(decoded.permissions).toContain('users:write');
      expect(decoded.permissions).toContain('system:write');
    });

    it('should validate operator role permissions', () => {
      const payload = {
        sub: 'op123',
        username: 'operator',
        role: 'operator' as const,
        permissions: [
          'jobs:read', 'jobs:write',
          'runners:read', 'runners:write',
          'system:read',
          'monitoring:read'
        ]
      };

      const token = authMiddleware.generateToken(payload);
      const decoded = authMiddleware.verifyToken(token);

      expect(decoded.role).toBe('operator');
      expect(decoded.permissions).toContain('jobs:write');
      expect(decoded.permissions).not.toContain('users:write');
    });

    it('should validate viewer role permissions', () => {
      const payload = {
        sub: 'viewer123',
        username: 'viewer',
        role: 'viewer' as const,
        permissions: [
          'jobs:read',
          'runners:read',
          'system:read',
          'monitoring:read'
        ]
      };

      const token = authMiddleware.generateToken(payload);
      const decoded = authMiddleware.verifyToken(token);

      expect(decoded.role).toBe('viewer');
      expect(decoded.permissions).toContain('jobs:read');
      expect(decoded.permissions).not.toContain('jobs:write');
    });
  });
});