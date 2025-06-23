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
import { MonitoringController } from './controllers/monitoring-controller';
import monitoringServiceEnhanced from './services/monitoring-enhanced';
import path from 'path';

const logger = createLogger('App');

export class App {
  private app: Application;
  private server: any;
  private io: Server;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", "ws:", "wss:"]
        }
      }
    }));
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Static files
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Request logging
    this.app.use(requestLogger);

    // Rate limiting
    this.app.use('/api', rateLimiter);

    // Make io available in req
    this.app.use((req, _res, next) => {
      (req as any).io = this.io;
      next();
    });
  }

  private setupRoutes(): void {
    // API routes
    this.app.use('/api/jobs', jobRoutes);
    this.app.use('/api/runners', runnerRoutes);
    this.app.use('/api/containers', containerRoutes);
    this.app.use('/api/scaling', scalingRoutes);
    this.app.use('/api/routing', routingRoutes);
    this.app.use('/api/cleanup', cleanupRoutes);
    this.app.use('/api/webhooks', webhookRoutes);
    this.app.use('/api/metrics', metricsRoutes);
    this.app.use('/api/monitoring', monitoringRoutes);
    this.app.use('/api/system', systemRoutes);
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/networks', networkRoutes);
    this.app.use('/api/audit', auditRoutes);
    this.app.use('/api/security', securityRoutes);
    this.app.use('/health', healthRoutes);

    // Prometheus metrics endpoint
    const monitoringController = new MonitoringController();
    this.app.get('/metrics', monitoringController.getPrometheusMetrics.bind(monitoringController));

    // Dashboard route - serve index.html with rate limiting
    this.app.get('/dashboard', rateLimiter, (_req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    // API info route
    this.app.get('/api', (_req, res) => {
      res.json({
        name: config.app.name,
        version: '1.0.0',
        status: 'running',
        endpoints: {
          health: '/health',
          jobs: '/api/jobs',
          runners: '/api/runners',
          metrics: '/api/metrics',
          monitoring: '/api/monitoring',
          dashboard: '/dashboard',
          prometheus: '/metrics',
          websocket: 'ws://localhost:' + (config.app.port + 1)
        }
      });
    });

    // 404 handler
    this.app.use((_req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found'
      });
    });
  }

  private setupWebSocket(): void {
    this.io.on('connection', (socket) => {
      logger.info('WebSocket client connected', { id: socket.id });

      // Join repository-specific rooms
      socket.on('subscribe:repository', (repository: string) => {
        socket.join(`repo:${repository}`);
        logger.debug('Client subscribed to repository', { 
          socketId: socket.id, 
          repository 
        });
      });

      // Leave repository-specific rooms
      socket.on('unsubscribe:repository', (repository: string) => {
        socket.leave(`repo:${repository}`);
        logger.debug('Client unsubscribed from repository', { 
          socketId: socket.id, 
          repository 
        });
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info('WebSocket client disconnected', { id: socket.id });
      });
    });
  }

  private setupErrorHandling(): void {
    this.app.use(errorHandler);
  }

  public async start(): Promise<void> {
    const port = config.app.port;

    // Start monitoring service
    await monitoringServiceEnhanced.start();

    // Connect monitoring events to WebSocket
    monitoringServiceEnhanced.on('metrics', (metrics) => {
      this.io.emit('metrics', metrics);
    });

    monitoringServiceEnhanced.on('job-event', (event) => {
      this.io.emit('job-event', event);
      if (event.data?.repository) {
        this.io.to(`repo:${event.data.repository}`).emit('job-event', event);
      }
    });

    monitoringServiceEnhanced.on('runner-event', (event) => {
      this.io.emit('runner-event', event);
    });

    monitoringServiceEnhanced.on('scaling-event', (event) => {
      this.io.emit('scaling-event', event);
      if (event.repository) {
        this.io.to(`repo:${event.repository}`).emit('scaling-event', event);
      }
    });

    this.server.listen(port, () => {
      logger.info(`Server running on port ${port}`);
      logger.info(`Dashboard available at http://localhost:${port}/dashboard`);
      logger.info(`WebSocket server integrated on same port`);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Stop monitoring service
      monitoringServiceEnhanced.stop();
      
      this.io.close();
      this.server.close(() => {
        logger.info('Server stopped');
        resolve();
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