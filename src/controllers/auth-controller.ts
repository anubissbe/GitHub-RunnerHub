import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { createLogger } from '../utils/logger';
import authMiddleware, { AuthenticatedRequest } from '../middleware/auth';
import ServiceManager from '../services/service-manager';
import auditLogger from '../services/audit-logger';

const logger = createLogger('AuthController');

interface DatabaseService {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
}

interface LoginRequest {
  username: string;
  password: string;
}

interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
  permissions: string[];
  password_hash: string;
  created_at: Date;
  last_login?: Date;
  active: boolean;
}

export class AuthController {
  private readonly SALT_ROUNDS = 12;

  /**
   * User login endpoint
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password }: LoginRequest = req.body;

      if (!username || !password) {
        res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
        return;
      }

      // Get user from database
      const user = await this.getUserByUsername(username);
      
      if (!user) {
        logger.warn('Login attempt with non-existent username', { username });
        
        // Audit log failed login
        await auditLogger.logFailedLogin(
          username,
          'User not found',
          req.ip,
          req.headers['user-agent']
        );
        
        res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
        return;
      }

      if (!user.active) {
        logger.warn('Login attempt with inactive user', { username, userId: user.id });
        
        // Audit log failed login
        await auditLogger.logFailedLogin(
          username,
          'Account is inactive',
          req.ip,
          req.headers['user-agent']
        );
        
        res.status(401).json({
          success: false,
          error: 'Account is inactive'
        });
        return;
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      
      if (!isValidPassword) {
        logger.warn('Login attempt with invalid password', { username, userId: user.id });
        
        // Audit log failed login
        await auditLogger.logFailedLogin(
          username,
          'Invalid password',
          req.ip,
          req.headers['user-agent']
        );
        
        res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
        return;
      }

      // Generate JWT token
      const tokenPayload = {
        sub: user.id,
        username: user.username,
        role: user.role,
        permissions: user.permissions
      };

      const token = authMiddleware.generateToken(tokenPayload);

      // Update last login time
      await this.updateLastLogin(user.id);

      // Audit log successful login
      await auditLogger.logSuccessfulLogin(
        user.id,
        user.username,
        req.ip,
        req.headers['user-agent']
      );

      logger.info('User logged in successfully', {
        userId: user.id,
        username: user.username,
        role: user.role
      });

      res.json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            permissions: user.permissions
          },
          expiresIn: '24h'
        }
      });

    } catch (error) {
      logger.error('Login error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Refresh token endpoint
   */
  async refreshToken(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user || !req.token) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      // Generate new token with same user data
      const tokenPayload = {
        sub: req.user.sub,
        username: req.user.username,
        role: req.user.role,
        permissions: req.user.permissions
      };

      const newToken = authMiddleware.generateToken(tokenPayload);

      logger.info('Token refreshed', {
        userId: req.user.sub,
        username: req.user.username
      });

      res.json({
        success: true,
        data: {
          token: newToken,
          expiresIn: '24h'
        }
      });

    } catch (error) {
      logger.error('Token refresh error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to refresh token'
      });
    }
  }

  /**
   * Get current user profile
   */
  async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const user = await this.getUserById(req.user.sub);
      
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found'
        });
        return;
      }

      res.json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          permissions: user.permissions,
          created_at: user.created_at,
          last_login: user.last_login
        }
      });

    } catch (error) {
      logger.error('Get profile error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to get user profile'
      });
    }
  }

  /**
   * Create a new user (admin only)
   */
  async createUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { username, email, password, role, permissions } = req.body;

      if (!username || !email || !password || !role) {
        res.status(400).json({
          success: false,
          error: 'Username, email, password, and role are required'
        });
        return;
      }

      // Check if user already exists
      const existingUser = await this.getUserByUsername(username);
      if (existingUser) {
        res.status(409).json({
          success: false,
          error: 'Username already exists'
        });
        return;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, this.SALT_ROUNDS);

      // Create user
      const userId = await this.createUserInDatabase({
        username,
        email,
        password_hash: passwordHash,
        role: role as 'admin' | 'operator' | 'viewer',
        permissions: permissions || this.getDefaultPermissions(role),
        active: true
      });

      logger.info('User created', {
        userId,
        username,
        role,
        createdBy: req.user?.username
      });

      res.status(201).json({
        success: true,
        data: {
          id: userId,
          username,
          email,
          role,
          permissions: permissions || this.getDefaultPermissions(role),
          message: 'User created successfully'
        }
      });

    } catch (error) {
      logger.error('Create user error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to create user'
      });
    }
  }

  /**
   * List all users (admin only)
   */
  async listUsers(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const users = await this.getAllUsers();

      // Remove sensitive information
      const sanitizedUsers = users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        created_at: user.created_at,
        last_login: user.last_login,
        active: user.active
      }));

      res.json({
        success: true,
        data: {
          users: sanitizedUsers,
          total: sanitizedUsers.length
        }
      });

    } catch (error) {
      logger.error('List users error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to list users'
      });
    }
  }

  /**
   * Update user role and permissions (admin only)
   */
  async updateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { role, permissions, active } = req.body;

      const user = await this.getUserById(userId);
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found'
        });
        return;
      }

      // Prevent self-deactivation
      if (req.user?.sub === userId && active === false) {
        res.status(400).json({
          success: false,
          error: 'Cannot deactivate your own account'
        });
        return;
      }

      await this.updateUserInDatabase(userId, {
        role,
        permissions,
        active
      });

      logger.info('User updated', {
        userId,
        username: user.username,
        updatedBy: req.user?.username,
        changes: { role, permissions, active }
      });

      res.json({
        success: true,
        message: 'User updated successfully'
      });

    } catch (error) {
      logger.error('Update user error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to update user'
      });
    }
  }

  /**
   * Delete user (admin only)
   */
  async deleteUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      // Prevent self-deletion
      if (req.user?.sub === userId) {
        res.status(400).json({
          success: false,
          error: 'Cannot delete your own account'
        });
        return;
      }

      const user = await this.getUserById(userId);
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found'
        });
        return;
      }

      await this.deleteUserFromDatabase(userId);

      logger.info('User deleted', {
        userId,
        username: user.username,
        deletedBy: req.user?.username
      });

      res.json({
        success: true,
        message: 'User deleted successfully'
      });

    } catch (error) {
      logger.error('Delete user error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to delete user'
      });
    }
  }

  // Database methods
  private async getUserByUsername(username: string): Promise<User | null> {
    try {
      const serviceManager = ServiceManager.getInstance();
      const database = serviceManager.getService<DatabaseService>('database');

      const result = await database.query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      ) as User[];

      return result[0] || null;
    } catch (error) {
      logger.error('Error getting user by username', { error: (error as Error).message });
      return null;
    }
  }

  private async getUserById(id: string): Promise<User | null> {
    try {
      const serviceManager = ServiceManager.getInstance();
      const database = serviceManager.getService<DatabaseService>('database');

      const result = await database.query(
        'SELECT * FROM users WHERE id = $1',
        [id]
      ) as User[];

      return result[0] || null;
    } catch (error) {
      logger.error('Error getting user by ID', { error: (error as Error).message });
      return null;
    }
  }

  private async getAllUsers(): Promise<User[]> {
    const serviceManager = ServiceManager.getInstance();
    const database = serviceManager.getService<DatabaseService>('database');

    return await database.query(
      'SELECT * FROM users ORDER BY created_at DESC'
    ) as User[];
  }

  private async createUserInDatabase(userData: Partial<User>): Promise<string> {
    const serviceManager = ServiceManager.getInstance();
    const database = serviceManager.getService<DatabaseService>('database');

    const result = await database.query(
      `INSERT INTO users (username, email, password_hash, role, permissions, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        userData.username,
        userData.email,
        userData.password_hash,
        userData.role,
        JSON.stringify(userData.permissions),
        userData.active
      ]
    ) as Array<{ id: string }>;

    return result[0].id;
  }

  private async updateUserInDatabase(id: string, updates: Partial<User>): Promise<void> {
    const serviceManager = ServiceManager.getInstance();
    const database = serviceManager.getService<DatabaseService>('database');

    const setClause = [];
    const values = [];
    let paramIndex = 1;

    if (updates.role) {
      setClause.push(`role = $${paramIndex++}`);
      values.push(updates.role);
    }

    if (updates.permissions) {
      setClause.push(`permissions = $${paramIndex++}`);
      values.push(JSON.stringify(updates.permissions));
    }

    if (updates.active !== undefined) {
      setClause.push(`active = $${paramIndex++}`);
      values.push(updates.active);
    }

    if (setClause.length > 0) {
      values.push(id);
      await database.query(
        `UPDATE users SET ${setClause.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }
  }

  private async deleteUserFromDatabase(id: string): Promise<void> {
    const serviceManager = ServiceManager.getInstance();
    const database = serviceManager.getService<DatabaseService>('database');

    await database.query('DELETE FROM users WHERE id = $1', [id]);
  }

  private async updateLastLogin(userId: string): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      const database = serviceManager.getService<DatabaseService>('database');

      await database.query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [userId]
      );
    } catch (error) {
      logger.error('Error updating last login', { error: (error as Error).message });
    }
  }

  private getDefaultPermissions(role: string): string[] {
    switch (role) {
      case 'admin':
        return [
          'users:read', 'users:write', 'users:delete',
          'jobs:read', 'jobs:write', 'jobs:delete',
          'runners:read', 'runners:write', 'runners:delete',
          'system:read', 'system:write',
          'monitoring:read', 'monitoring:write'
        ];
      case 'operator':
        return [
          'jobs:read', 'jobs:write',
          'runners:read', 'runners:write',
          'system:read',
          'monitoring:read'
        ];
      case 'viewer':
        return [
          'jobs:read',
          'runners:read',
          'system:read',
          'monitoring:read'
        ];
      default:
        return ['monitoring:read'];
    }
  }
}

export default new AuthController();