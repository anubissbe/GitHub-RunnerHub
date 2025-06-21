import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { createLogger } from './utils/logger';
import { validateConfig } from './config';
import config from './config';
import serviceManager from './services/service-manager';
import database from './services/database';
import { initializeJobQueue, shutdownJobQueue } from './services/job-queue-fixed';

// Import routes
import authRoutes from './routes/auth';
import jobRoutes from './routes/jobs';
import runnerRoutes from './routes/runners';
import healthRoutes from './routes/health';
import monitoringRoutes from './routes/monitoring';
import metricsRoutes from './routes/metrics';
import systemRoutes from './routes/system';
import networkRoutes from './routes/networks';
import securityRoutes from './routes/security';
import auditRoutes from './routes/audit';

const logger = createLogger('Server');

// Create Express app
const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : '*',
    credentials: true
  }
});

// Make io accessible to routes
app.set('io', io);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.tailwindcss.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/runners', runnerRoutes);
app.use('/health', healthRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/metrics', metricsRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/networks', networkRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/audit', auditRoutes);

// Dashboard route
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Root route
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  socket.on('disconnect', () => {
    logger.info('Client disconnected', { socketId: socket.id });
  });

  // Join room for real-time updates
  socket.on('join-monitoring', () => {
    socket.join('monitoring');
    logger.info('Client joined monitoring room', { socketId: socket.id });
  });
});

// Graceful shutdown
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown`);

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });

  try {
    // Shutdown services in reverse order
    await shutdownJobQueue();
    await database.end();
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', { error });
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  gracefulShutdown('unhandledRejection');
});

// Start server
async function startServer() {
  try {
    // Validate configuration first
    validateConfig();
    logger.info('Configuration validated');

    // Initialize service manager (handles Vault, database, etc.)
    await serviceManager.initialize();
    logger.info('Service manager initialized');

    // Initialize job queue after services are ready
    await initializeJobQueue();
    logger.info('Job queue initialized');

    // Start listening
    const port = config.app.port || 3001;
    const host = process.env.HOST || '0.0.0.0';

    server.listen(port, host, () => {
      logger.info(`GitHub RunnerHub started`, {
        port,
        host,
        env: config.app.env,
        pid: process.pid
      });
    });

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Start the application
startServer();