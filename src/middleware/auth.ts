import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createLogger } from '../utils/logger';
import ServiceManager from '../services/service-manager';
import VaultService from '../services/vault-service';

const logger = createLogger('AuthMiddleware');

export interface JWTPayload {
  sub: string; // User ID
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  permissions: string[];
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
  token?: string;
}

/**
 * JWT Authentication middleware for GitHub RunnerHub
 * Validates JWT tokens and extracts user information
 */
export class AuthMiddleware {
  private static instance: AuthMiddleware;
  private jwtSecret: string | null = null;
  private initialized = false;

  private constructor() {}

  public static getInstance(): AuthMiddleware {
    if (!AuthMiddleware.instance) {
      AuthMiddleware.instance = new AuthMiddleware();
    }
    return AuthMiddleware.instance;
  }

  /**
   * Initialize the auth middleware with JWT secret from Vault
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('AuthMiddleware already initialized');
      return;
    }

    try {
      const serviceManager = ServiceManager.getInstance();
      
      if (serviceManager.hasService('vault')) {
        const vaultService = serviceManager.getService<VaultService>('vault');
        
        try {
          const securitySecrets = await vaultService.getSecret('security/runnerhub');
          this.jwtSecret = securitySecrets.data.jwt_secret as string;
          logger.info('JWT secret loaded from Vault');
        } catch (error) {
          logger.warn('Failed to load JWT secret from Vault, using fallback', { 
            error: (error as Error).message 
          });
          this.jwtSecret = process.env.JWT_SECRET || 'change-me-in-production';
        }
      } else {
        logger.warn('Vault service not available, using environment variable for JWT secret');
        this.jwtSecret = process.env.JWT_SECRET || 'change-me-in-production';
      }

      if (this.jwtSecret === 'change-me-in-production') {
        logger.error('JWT secret is not properly configured - using default value');
        throw new Error('JWT secret must be configured for authentication');
      }

      this.initialized = true;
      logger.info('AuthMiddleware initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize AuthMiddleware', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Generate a JWT token for a user
   */
  generateToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss' | 'aud'>): string {
    if (!this.initialized || !this.jwtSecret) {
      throw new Error('AuthMiddleware not initialized');
    }

    const tokenPayload: JWTPayload = {
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      iss: 'github-runnerhub',
      aud: 'github-runnerhub-api'
    };

    return jwt.sign(tokenPayload, this.jwtSecret, { algorithm: 'HS256' });
  }

  /**
   * Verify and decode a JWT token
   */
  verifyToken(token: string): JWTPayload {
    if (!this.initialized || !this.jwtSecret) {
      throw new Error('AuthMiddleware not initialized');
    }

    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
        issuer: 'github-runnerhub',
        audience: 'github-runnerhub-api'
      }) as JWTPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      } else {
        throw new Error('Token verification failed');
      }
    }
  }

  /**
   * Extract token from Authorization header
   */
  private extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return null;
    }

    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    if (authHeader.startsWith('Token ')) {
      return authHeader.substring(6);
    }

    return null;
  }

  /**
   * Authentication middleware function
   */
  authenticate() {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!this.initialized) {
          res.status(500).json({
            success: false,
            error: 'Authentication service not available'
          });
          return;
        }

        const token = this.extractToken(req);
        
        if (!token) {
          res.status(401).json({
            success: false,
            error: 'Authentication required',
            message: 'No valid token provided'
          });
          return;
        }

        try {
          const decoded = this.verifyToken(token);
          req.user = decoded;
          req.token = token;

          logger.debug('User authenticated', {
            userId: decoded.sub,
            username: decoded.username,
            role: decoded.role,
            endpoint: req.path
          });

          next();
        } catch (error) {
          res.status(401).json({
            success: false,
            error: 'Authentication failed',
            message: (error as Error).message
          });
          return;
        }

      } catch (error) {
        logger.error('Authentication middleware error', { error: (error as Error).message });
        res.status(500).json({
          success: false,
          error: 'Internal authentication error'
        });
        return;
      }
    };
  }

  /**
   * Authorization middleware - check if user has required role
   */
  authorize(requiredRoles: string | string[]) {
    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      if (!roles.includes(req.user.role)) {
        logger.warn('Access denied - insufficient role', {
          userId: req.user.sub,
          username: req.user.username,
          userRole: req.user.role,
          requiredRoles: roles,
          endpoint: req.path
        });

        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          message: `Required role: ${roles.join(' or ')}, your role: ${req.user.role}`
        });
        return;
      }

      logger.debug('User authorized', {
        userId: req.user.sub,
        username: req.user.username,
        role: req.user.role,
        endpoint: req.path
      });

      next();
    };
  }

  /**
   * Permission-based authorization middleware
   */
  requirePermission(permission: string) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      if (!req.user.permissions.includes(permission) && req.user.role !== 'admin') {
        logger.warn('Access denied - missing permission', {
          userId: req.user.sub,
          username: req.user.username,
          userRole: req.user.role,
          userPermissions: req.user.permissions,
          requiredPermission: permission,
          endpoint: req.path
        });

        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          message: `Required permission: ${permission}`
        });
        return;
      }

      next();
    };
  }

  /**
   * Optional authentication - doesn't fail if no token provided
   */
  optionalAuth() {
    return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
      if (!this.initialized) {
        next();
        return;
      }

      const token = this.extractToken(req);
      
      if (token) {
        try {
          const decoded = this.verifyToken(token);
          req.user = decoded;
          req.token = token;

          logger.debug('Optional auth - user authenticated', {
            userId: decoded.sub,
            username: decoded.username,
            role: decoded.role
          });
        } catch (error) {
          logger.debug('Optional auth - invalid token provided', { 
            error: (error as Error).message 
          });
          // Don't fail, just continue without user info
        }
      }

      next();
    };
  }

  /**
   * Refresh a token (extend expiration)
   */
  refreshToken(token: string): string {
    const decoded = this.verifyToken(token);
    
    // Create new token with extended expiration
    const newPayload = {
      sub: decoded.sub,
      username: decoded.username,
      role: decoded.role,
      permissions: decoded.permissions
    };

    return this.generateToken(newPayload);
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

export default AuthMiddleware.getInstance();