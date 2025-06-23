import { Router } from 'express';
import { JobController } from '../controllers/job-controller';
import authMiddleware from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();
const jobController = new JobController();

// Apply rate limiting and authentication to all routes
router.use(rateLimiter);
router.use(authMiddleware.authenticate());

// Delegate a job from proxy runner
router.post('/delegate', jobController.delegateJob.bind(jobController));

// Get job status
router.get('/:id', jobController.getJob.bind(jobController));

// List jobs with pagination
router.get('/', jobController.listJobs.bind(jobController));

// Update job status (internal use)
router.patch('/:id/status', jobController.updateJobStatus.bind(jobController));

// Mark job as complete from proxy runner
router.post('/:id/proxy-complete', jobController.proxyComplete.bind(jobController));

// Get job logs
router.get('/:id/logs', jobController.getJobLogs.bind(jobController));

// Get secret scan results for a job
router.get('/:id/secret-scans', jobController.getJobSecretScanResults.bind(jobController));

// Trigger manual secret scan for job logs
router.post('/:id/scan-secrets', jobController.scanJobLogs.bind(jobController));

export default router;