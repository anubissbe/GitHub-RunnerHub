import { Router } from 'express';
import authController from '../controllers/auth-controller';
import authMiddleware from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();

/**
 * Authentication routes
 * Rate limiting applied to prevent brute force attacks
 */

// Apply rate limiting to all auth routes
router.use(rateLimiter);

// POST /api/auth/login - User login
router.post('/login', authController.login.bind(authController));

// POST /api/auth/refresh - Refresh JWT token
router.post('/refresh', 
  authMiddleware.authenticate(),
  authController.refreshToken.bind(authController)
);

// GET /api/auth/profile - Get current user profile
router.get('/profile',
  authMiddleware.authenticate(),
  authController.getProfile.bind(authController)
);

// POST /api/auth/users - Create new user (admin only)
router.post('/users',
  authMiddleware.authenticate(),
  authMiddleware.authorize('admin'),
  authController.createUser.bind(authController)
);

// GET /api/auth/users - List all users (admin only)
router.get('/users',
  authMiddleware.authenticate(),
  authMiddleware.authorize('admin'),
  authController.listUsers.bind(authController)
);

// PUT /api/auth/users/:userId - Update user (admin only)
router.put('/users/:userId',
  authMiddleware.authenticate(),
  authMiddleware.authorize('admin'),
  authController.updateUser.bind(authController)
);

// DELETE /api/auth/users/:userId - Delete user (admin only)
router.delete('/users/:userId',
  authMiddleware.authenticate(),
  authMiddleware.authorize('admin'),
  authController.deleteUser.bind(authController)
);

export default router;