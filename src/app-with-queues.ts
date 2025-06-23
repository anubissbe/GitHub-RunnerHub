import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { Server } from 'socket.io';
import config from './config';
import { createLogger } from './utils/logger';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { rateLimiter } from './middleware/rate-limiter';
import { QueueManager } from './queues/queue-manager';
import ServiceManager from './services/service-manager';

// Import routes
import jobRoutes from './routes/jobs';
import runnerRoutes from './routes/runners';
import metricsRoutes from './routes/metrics';
import healthRoutes from './routes/health';
import monitoringRoutes from './routes/monitoring';
import containerRoutes from './routes/containers';
import scalingRoutes from './routes/scaling';
import routingRoutes from './routes/routing';
import cleanupRoutes from './routes/cleanup';
import webhookRoutes from './routes/webhook-routes';
import systemRoutes from './routes/system';
import authRoutes from './routes/auth';
import networkRoutes from './routes/networks';
import auditRoutes from './routes/audit';
import securityRoutes from './routes/security';
import queueRoutes from './routes/queue-routes';

// import { MonitoringController } from './controllers/monitoring-controller';
import monitoringServiceEnhanced from './services/monitoring-enhanced';
import path from 'path';

const logger = createLogger('App');

export class App {
  private app: Application;
  private server: any;
  private io: Server;
  private queueManager: QueueManager;
  private _serviceManager: ServiceManager; // Prefixed with underscore to indicate intentionally unused

  constructor(serviceManager: ServiceManager, queueManager: QueueManager) {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    this._serviceManager = serviceManager;
    this.queueManager = queueManager;
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disable for dashboard
    }));

    // CORS
    this.app.use(cors());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Compression
    this.app.use(compression());

    // Request logging
    this.app.use(requestLogger);

    // Rate limiting
    this.app.use('/api', rateLimiter);

    // Static files
    this.app.use(express.static(path.join(__dirname, '../public')));
  }

  private setupRoutes(): void {
    // API routes
    this.app.use('/api/jobs', jobRoutes);
    this.app.use('/api/runners', runnerRoutes);
    this.app.use('/api/metrics', metricsRoutes);
    this.app.use('/api/health', healthRoutes);
    this.app.use('/api/monitoring', monitoringRoutes);
    this.app.use('/api/containers', containerRoutes);
    this.app.use('/api/scaling', scalingRoutes);
    this.app.use('/api/routing', routingRoutes);
    this.app.use('/api/cleanup', cleanupRoutes);
    this.app.use('/api/webhooks', webhookRoutes);
    this.app.use('/api/system', systemRoutes);
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/networks', networkRoutes);
    this.app.use('/api/audit', auditRoutes);
    this.app.use('/api/security', securityRoutes);
    
    // Queue management routes
    this.app.use('/api/queues', queueRoutes);
    
    // Mount Bull Dashboard
    if (this.queueManager) {
      const dashboardAdapter = this.queueManager.getDashboardAdapter();
      if (dashboardAdapter) {
        this.app.use('/admin/queues', dashboardAdapter.getRouter());
        logger.info('Bull Dashboard mounted at /admin/queues');
      }
    }

    // Dashboard routes with rate limiting for file system access
    this.app.get('/dashboard', rateLimiter, (_req, res) => {
      res.sendFile(path.join(__dirname, '../public/dashboard.html'));
    });
    
    this.app.get('/dashboard/queues', rateLimiter, (_req, res) => {
      res.sendFile(path.join(__dirname, '../public/queue-dashboard.html'));
    });

    // Monitoring dashboard with enhanced realtime updates
    this.app.get('/monitoring/dashboard', rateLimiter, (_req, res) => {
      res.sendFile(path.join(__dirname, '../public/monitoring-dashboard.html'));
    });
    
    // Performance dashboard
    this.app.get('/dashboard/performance', rateLimiter, (_req, res) => {
      res.sendFile(path.join(__dirname, '../public/performance-dashboard.html'));
    });

    // Default route
    this.app.get('/', (_req, res) => {
      res.json({
        name: 'GitHub RunnerHub',
        version: '1.0.0',
        status: 'operational',
        features: {
          queues: 'Redis-based job queue system with Bull',
          monitoring: 'Real-time monitoring and alerting',
          scaling: 'Auto-scaling with ML predictions',
          security: 'Enterprise-grade security features'
        },
        endpoints: {
          api: '/api',
          health: '/api/health',
          metrics: '/api/metrics',
          dashboard: '/dashboard',
          queueDashboard: '/dashboard/queues',
          bullDashboard: '/admin/queues',
          docs: '/api-docs'
        }
      });
    });
  }

  private setupWebSocket(): void {
    this.io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);

      // Subscribe to monitoring updates
      socket.on('subscribe', (channel) => {
        socket.join(channel);
        logger.info(`Client ${socket.id} subscribed to ${channel}`);
      });

      // Handle monitoring requests
      socket.on('monitoring:request', async (_data) => {
        try {
          // Use getSystemMetrics instead of non-existent getCurrentMetrics
          const metrics = await monitoringServiceEnhanced.getSystemMetrics();
          socket.emit('monitoring:update', metrics);
        } catch (error) {
          logger.error('Error fetching monitoring data:', error);
          socket.emit('monitoring:error', { error: 'Failed to fetch metrics' });
        }
      });

      // Handle queue status requests
      socket.on('queues:request', async () => {
        try {
          const stats = await this.queueManager.getAllQueuesStats();
          socket.emit('queues:update', stats);
        } catch (error) {
          logger.error('Error fetching queue stats:', error);
          socket.emit('queues:error', { error: 'Failed to fetch queue stats' });
        }
      });

      socket.on('disconnect', () => {
        logger.info(`WebSocket client disconnected: ${socket.id}`);
      });
    });

    // Emit monitoring updates every 5 seconds
    setInterval(async () => {
      try {
        const metrics = await monitoringServiceEnhanced.getSystemMetrics();
        this.io.to('monitoring').emit('monitoring:update', metrics);
        
        // Also emit queue updates
        if (this.queueManager) {
          const queueStats = await this.queueManager.getAllQueuesStats();
          this.io.to('queues').emit('queues:update', queueStats);
        }
      } catch (error) {
        logger.error('Error broadcasting updates:', error);
      }
    }, 5000);
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`
      });
    });

    // Global error handler
    this.app.use(errorHandler);
  }

  public async start(): Promise<void> {
    const port = config.app.port;
    
    return new Promise((resolve, reject) => {
      this.server.listen(port, () => {
        logger.info(`Server is running on port ${port}`);
        logger.info(`Dashboard: http://localhost:${port}/dashboard`);
        logger.info(`Queue Dashboard: http://localhost:${port}/dashboard/queues`);
        logger.info(`Bull Dashboard: http://localhost:${port}/admin/queues`);
        logger.info(`API Documentation: http://localhost:${port}/api-docs`);
        resolve();
      }).on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close(() => {
        this.server.close(() => {
          logger.info('Server stopped');
          resolve();
        });
      });
    });
  }

  public getApp(): Application {
    return this.app;
  }

  public getIO(): Server {
    return this.io;
  }
}

export default App;