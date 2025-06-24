import { config as dotenvConfig } from 'dotenv';
import { validateConfig } from './config';
import { createLogger } from './utils/logger';
import App from './app-with-queues';
import ServiceManager from './services/service-manager';
import { QueueManager } from './queues/queue-manager';
import { JobRouter } from './queues/job-router';
import { RetryHandler } from './queues/retry-handler';
import { JobPersistence } from './queues/job-persistence';
import { JobType, QUEUE_CONFIG } from './queues/config/redis-config';
import runnerPoolManager from './services/runner-pool-manager';
import containerOrchestrator from './services/container-orchestrator-v2';
import autoScaler from './services/auto-scaler';
import containerCleanup from './services/container-cleanup';
import githubWebhook from './services/github-webhook';
import jobLogSecretScanner from './services/job-log-secret-scanner';

// Load environment variables
dotenvConfig();

const logger = createLogger('Main');

// Service instances
let app: App;
let serviceManager: ServiceManager;
let queueManager: QueueManager;
let jobRouter: JobRouter;
// RetryHandler is initialized but not used in this context
let jobPersistence: JobPersistence;
let isShuttingDown = false;

async function initializeQueueSystem() {
  logger.info('Initializing Redis Job Queue System...');
  
  try {
    // Initialize queue manager
    queueManager = QueueManager.getInstance({
      enableScheduler: true,
      enableFlowProducer: true,
      enableDashboard: true,
      dashboardPath: '/admin/queues'
    });
    await queueManager.initialize();
    
    // Initialize job router
    jobRouter = JobRouter.getInstance();
    
    // Initialize retry handler
    RetryHandler.getInstance();
    
    // Attach retry handler to all workers
    const queues = Object.values(QUEUE_CONFIG.queues);
    for (const queueName of queues) {
      const queue = queueManager.getQueue(queueName);
      if (queue) {
        // Workers are already created in QueueManager, we just need to get them
        // This is handled internally by the retry handler
      }
    }
    
    // Initialize job persistence
    jobPersistence = JobPersistence.getInstance();
    await jobPersistence.setupAutoPersistence();
    
    // Schedule cleanup jobs
    await scheduleRecurringJobs();
    
    logger.info('Redis Job Queue System initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize queue system:', error);
    throw error;
  }
}

async function scheduleRecurringJobs() {
  logger.info('Scheduling recurring jobs...');
  
  // Schedule metrics collection
  await jobRouter.route({
    type: JobType.COLLECT_METRICS,
    data: {
      targets: ['system', 'containers', 'queues', 'application'],
      interval: 60000 // 1 minute
    }
  });
  
  // Schedule container cleanup
  await jobRouter.route({
    type: JobType.CLEANUP_CONTAINERS,
    data: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      cronPattern: '0 */6 * * *' // Every 6 hours
    }
  });
  
  // Schedule old job cleanup
  await jobRouter.route({
    type: JobType.CLEANUP_OLD_JOBS,
    data: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      cronPattern: '0 2 * * *' // Daily at 2 AM
    }
  });
  
  // Schedule log cleanup
  await jobRouter.route({
    type: JobType.CLEANUP_LOGS,
    data: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      cronPattern: '0 3 * * 0' // Weekly on Sunday at 3 AM
    }
  });
  
  logger.info('Recurring jobs scheduled');
}

async function recoverPreviousJobs() {
  logger.info('Attempting to recover previous jobs...');
  
  try {
    const recovered = await jobPersistence.recoverJobs({
      recoverFailed: true,
      recoverStalled: true,
      recoverIncomplete: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    const totalRecovered = Object.values(recovered).reduce((sum, count) => sum + count, 0);
    logger.info(`Recovered ${totalRecovered} jobs from previous session`);
  } catch (error) {
    logger.error('Failed to recover previous jobs:', error);
    // Continue startup even if recovery fails
  }
}

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    // Stop accepting new connections
    if (app) {
      await app.stop();
    }

    // Persist all jobs before shutdown
    if (jobPersistence) {
      logger.info('Persisting all jobs...');
      await jobPersistence.persistAllQueues();
    }

    // Shutdown queue manager
    if (queueManager) {
      logger.info('Shutting down queue manager...');
      await queueManager.shutdown();
    }

    // Shutdown auto-scaler
    await autoScaler.shutdown();

    // Shutdown container cleanup
    await containerCleanup.shutdown();

    // Shutdown GitHub webhook service
    await githubWebhook.shutdown();

    // Shutdown job log secret scanner
    await jobLogSecretScanner.shutdown();

    // Stop runner pool manager
    await runnerPoolManager.shutdown();

    // Stop container orchestrator
    await containerOrchestrator.shutdown();

    // Stop service manager
    if (serviceManager) {
      await serviceManager.shutdown();
    }

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

async function main() {
  try {
    // Validate configuration
    validateConfig();

    // Initialize core services
    serviceManager = ServiceManager.getInstance();
    await serviceManager.initialize();

    // Initialize queue system
    await initializeQueueSystem();

    // Recover previous jobs
    await recoverPreviousJobs();

    // Initialize runner pool manager
    await runnerPoolManager.initialize();

    // Initialize container orchestrator
    await containerOrchestrator.initialize();

    // Initialize auto-scaler
    await autoScaler.initialize();

    // Initialize container cleanup service
    await containerCleanup.initialize();

    // Initialize GitHub webhook service
    await githubWebhook.initialize();

    // Initialize job log secret scanner
    await jobLogSecretScanner.initialize();

    // Create and start Express app
    app = new App(serviceManager, queueManager);
    await app.start();

    logger.info('GitHub RunnerHub with Redis Job Queue System started successfully');
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Handle process signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection');
});

// Start the application
main();