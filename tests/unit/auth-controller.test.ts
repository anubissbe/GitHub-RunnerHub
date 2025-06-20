import bcrypt from 'bcrypt';
import { AuthController } from '../../src/controllers/auth-controller';

// Mock the dependencies
jest.mock('../../src/services/service-manager');
jest.mock('../../src/middleware/auth');
jest.mock('bcrypt');

describe('AuthController', () => {
  let authController: AuthController;
  let mockDatabase: any;

  beforeEach(() => {
    // Mock database
    mockDatabase = {
      query: jest.fn()
    };

    // Note: Service manager and auth middleware are mocked at module level

    // Mock bcrypt
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

    authController = new AuthController();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    const mockUser = {
      id: 'user123',
      username: 'testuser',
      email: 'test@example.com',
      role: 'admin',
      permissions: ['users:read', 'users:write'],
      password_hash: 'hashed-password',
      active: true,
      created_at: new Date(),
      last_login: new Date()
    };

    it('should successfully login with valid credentials', async () => {
      const req = {
        body: {
          username: 'testuser',
          password: 'password123'
        }
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock database query to return user
      mockDatabase.query.mockResolvedValueOnce([mockUser]);
      // Mock password comparison
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      // Mock update last login
      mockDatabase.query.mockResolvedValueOnce([]);

      await authController.login(req as any, res as any);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          token: 'mock-jwt-token',
          user: {
            id: mockUser.id,
            username: mockUser.username,
            email: mockUser.email,
            role: mockUser.role,
            permissions: mockUser.permissions
          },
          expiresIn: '24h'
        }
      });
    });

    it('should reject login with invalid username', async () => {
      const req = {
        body: {
          username: 'nonexistent',
          password: 'password123'
        }
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock database query to return no user
      mockDatabase.query.mockResolvedValueOnce([]);

      await authController.login(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid credentials'
      });
    });

    it('should reject login with invalid password', async () => {
      const req = {
        body: {
          username: 'testuser',
          password: 'wrongpassword'
        }
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock database query to return user
      mockDatabase.query.mockResolvedValueOnce([mockUser]);
      // Mock password comparison to fail
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await authController.login(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid credentials'
      });
    });

    it('should reject login for inactive user', async () => {
      const inactiveUser = { ...mockUser, active: false };
      
      const req = {
        body: {
          username: 'testuser',
          password: 'password123'
        }
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock database query to return inactive user
      mockDatabase.query.mockResolvedValueOnce([inactiveUser]);

      await authController.login(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Account is inactive'
      });
    });

    it('should validate required fields', async () => {
      const req = {
        body: {
          username: 'testuser'
          // missing password
        }
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await authController.login(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Username and password are required'
      });
    });
  });

  describe('getProfile', () => {
    it('should return user profile for authenticated user', async () => {
      const mockUser = {
        id: 'user123',
        username: 'testuser',
        email: 'test@example.com',
        role: 'admin',
        permissions: ['users:read'],
        created_at: new Date(),
        last_login: new Date()
      };

      const req = {
        user: {
          sub: 'user123'
        }
      };

      const res = {
        json: jest.fn()
      };

      // Mock database query
      mockDatabase.query.mockResolvedValueOnce([mockUser]);

      await authController.getProfile(req as any, res as any);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          id: mockUser.id,
          username: mockUser.username,
          email: mockUser.email,
          role: mockUser.role,
          permissions: mockUser.permissions,
          created_at: mockUser.created_at,
          last_login: mockUser.last_login
        }
      });
    });

    it('should require authentication', async () => {
      const req = {}; // No user

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await authController.getProfile(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Authentication required'
      });
    });
  });

  describe('createUser', () => {
    it('should create a new user with valid data', async () => {
      const req = {
        body: {
          username: 'newuser',
          email: 'newuser@example.com',
          password: 'password123',
          role: 'operator'
        },
        user: {
          username: 'admin'
        }
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock database queries
      mockDatabase.query.mockResolvedValueOnce([]); // No existing user
      mockDatabase.query.mockResolvedValueOnce([{ id: 'new-user-id' }]); // Create user

      await authController.createUser(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: 'new-user-id',
          username: 'newuser',
          email: 'newuser@example.com',
          role: 'operator'
        })
      });
    });

    it('should reject duplicate username', async () => {
      const req = {
        body: {
          username: 'existinguser',
          email: 'new@example.com',
          password: 'password123',
          role: 'operator'
        }
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock database query to return existing user
      mockDatabase.query.mockResolvedValueOnce([{ username: 'existinguser' }]);

      await authController.createUser(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Username already exists'
      });
    });

    it('should validate required fields', async () => {
      const req = {
        body: {
          username: 'newuser'
          // missing required fields
        }
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await authController.createUser(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Username, email, password, and role are required'
      });
    });
  });

  describe('Default Permissions', () => {
    it('should return correct permissions for admin role', () => {
      const permissions = (authController as any).getDefaultPermissions('admin');
      
      expect(permissions).toContain('users:read');
      expect(permissions).toContain('users:write');
      expect(permissions).toContain('users:delete');
      expect(permissions).toContain('system:write');
    });

    it('should return correct permissions for operator role', () => {
      const permissions = (authController as any).getDefaultPermissions('operator');
      
      expect(permissions).toContain('jobs:read');
      expect(permissions).toContain('jobs:write');
      expect(permissions).toContain('runners:read');
      expect(permissions).not.toContain('users:write');
      expect(permissions).not.toContain('system:write');
    });

    it('should return correct permissions for viewer role', () => {
      const permissions = (authController as any).getDefaultPermissions('viewer');
      
      expect(permissions).toContain('jobs:read');
      expect(permissions).toContain('runners:read');
      expect(permissions).not.toContain('jobs:write');
      expect(permissions).not.toContain('users:read');
    });

    it('should return minimal permissions for unknown role', () => {
      const permissions = (authController as any).getDefaultPermissions('unknown');
      
      expect(permissions).toEqual(['monitoring:read']);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const req = {
        body: {
          username: 'testuser',
          password: 'password123'
        }
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      // Mock database error
      mockDatabase.query.mockRejectedValueOnce(new Error('Database connection failed'));

      await authController.login(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Internal server error'
      });
    });
  });
});