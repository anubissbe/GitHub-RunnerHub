import { Router } from 'express';
import networkController from '../controllers/network-controller';
import authMiddleware from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();

/**
 * Network isolation routes
 * Rate limiting applied to prevent abuse
 */

// Apply rate limiting and authentication to all network routes
router.use(rateLimiter);
router.use(authMiddleware.authenticate());

// GET /api/networks/stats - Get network statistics
router.get('/stats', networkController.getNetworkStats.bind(networkController));

// GET /api/networks - List all isolated networks
router.get('/', networkController.listNetworks.bind(networkController));

// GET /api/networks/repository/:repository - Get networks for a repository
router.get('/repository/:repository', 
  networkController.getRepositoryNetworks.bind(networkController)
);

// POST /api/networks - Create network for repository (operator/admin)
router.post('/',
  authMiddleware.authorize(['admin', 'operator']),
  networkController.createRepositoryNetwork.bind(networkController)
);

// DELETE /api/networks/repository/:repository - Remove repository networks (admin)
router.delete('/repository/:repository',
  authMiddleware.authorize('admin'),
  networkController.removeRepositoryNetworks.bind(networkController)
);

// POST /api/networks/cleanup - Clean up unused networks (admin)
router.post('/cleanup',
  authMiddleware.authorize('admin'),
  networkController.cleanupNetworks.bind(networkController)
);

// GET /api/networks/verify-isolation - Verify network isolation
router.get('/verify-isolation',
  networkController.verifyIsolation.bind(networkController)
);

// POST /api/networks/attach - Attach container to network (operator/admin)
router.post('/attach',
  authMiddleware.authorize(['admin', 'operator']),
  networkController.attachContainer.bind(networkController)
);

// POST /api/networks/detach - Detach container from network (operator/admin)
router.post('/detach',
  authMiddleware.authorize(['admin', 'operator']),
  networkController.detachContainer.bind(networkController)
);

export default router;