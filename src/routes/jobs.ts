import { Router } from 'express';
import { JobController } from '../controllers/job-controller';

const router = Router();
const jobController = new JobController();

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

export default router;