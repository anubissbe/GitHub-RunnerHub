import { Router } from 'express';
import { MonitoringController } from '../controllers/monitoring-controller';

const router = Router();
const monitoringController = new MonitoringController();

// System metrics
router.get('/system', monitoringController.getSystemMetrics.bind(monitoringController));

// Repository-specific metrics
router.get('/repository/:repository', monitoringController.getRepositoryMetrics.bind(monitoringController));

// Recent jobs
router.get('/jobs', monitoringController.getRecentJobs.bind(monitoringController));

// Job timeline
router.get('/timeline', monitoringController.getJobTimeline.bind(monitoringController));

// Runner health
router.get('/health', monitoringController.getRunnerHealth.bind(monitoringController));

// Dashboard data (aggregated)
router.get('/dashboard', monitoringController.getDashboardData.bind(monitoringController));

// Repository tracking management
router.get('/repositories', monitoringController.getTrackedRepositories.bind(monitoringController));
router.post('/repositories', monitoringController.addTrackedRepository.bind(monitoringController));
router.delete('/repositories/:repository', monitoringController.removeTrackedRepository.bind(monitoringController));

export default router;