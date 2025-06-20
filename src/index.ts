import { config as dotenvConfig } from 'dotenv';
import config, { validateConfig } from './config';
import { createLogger } from './utils/logger';
import App from './app';
import ServiceManager from './services/service-manager';
import { startWorker, stopWorker } from './services/job-queue';
import runnerPoolManager from './services/runner-pool-manager';
import containerOrchestrator from './services/container-orchestrator-v2';
import autoScaler from './services/auto-scaler';
import containerCleanup from './services/container-cleanup';
import githubWebhook from './services/github-webhook';

// Load environment variables
dotenvConfig();

const logger = createLogger('Main');

// Graceful shutdown handling
let app: App;
let serviceManager: ServiceManager;
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    // Stop accepting new connections
    if (app) {
      await app.stop();
    }

    // Stop job queue worker
    await stopWorker();

    // Shutdown auto-scaler
    await autoScaler.shutdown();

    // Shutdown container cleanup
    await containerCleanup.shutdown();

    // Shutdown GitHub webhook service
    await githubWebhook.shutdown();

    // Shutdown container orchestrator
    await containerOrchestrator.shutdown();

    // Shutdown all core services through ServiceManager
    if (serviceManager) {
      await serviceManager.shutdown();
    }

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
}

async function startServer() {
  try {
    // Validate configuration
    validateConfig();
    logger.info('Configuration validated');

    // Initialize core services through ServiceManager (Vault, Database)
    serviceManager = ServiceManager.getInstance();
    await serviceManager.initialize();
    logger.info('Core services initialized through ServiceManager');

    // Initialize database schema if needed
    await initializeDatabase();

    // Start job queue worker
    await startWorker();
    logger.info('Job queue worker started');

    // Initialize runner pool manager
    await runnerPoolManager.initialize();
    logger.info('Runner pool manager initialized');

    // Initialize container orchestrator
    await containerOrchestrator.initialize();
    logger.info('Container orchestrator initialized');

    // Initialize auto-scaler
    await autoScaler.initialize();
    logger.info('Auto-scaler initialized');

    // Initialize container cleanup service
    await containerCleanup.initialize();
    logger.info('Container cleanup service initialized');

    // Initialize GitHub webhook service
    await githubWebhook.initialize();
    logger.info('GitHub webhook service initialized');

    // Create and start Express app
    app = new App();
    await app.start();

    // Perform initial health check
    const systemHealth = serviceManager.getSystemHealth();
    logger.info('System health check', systemHealth);

    logger.info('GitHub-RunnerHub started successfully', {
      environment: config.app.env,
      port: config.app.port,
      vaultEnabled: true,
      systemHealth: systemHealth.overall
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

async function initializeDatabase() {
  try {
    // Get database service from ServiceManager
    const database = serviceManager.getService<any>('database');
    
    // Check if schema exists
    const [schemaExists] = await database.query(
      "SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = 'runnerhub')"
    );

    if (!schemaExists.exists) {
      logger.info('Initializing database schema...');
      // Schema will be created by init.sql script in Docker
      // For manual setup, you would execute the init.sql script here
    }
  } catch (error) {
    logger.error('Database initialization failed', { error });
    throw error;
  }
}

// Process event handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  shutdown('unhandledRejection');
});

// Start the server
startServer();