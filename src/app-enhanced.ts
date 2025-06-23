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
import webhookRoutesEnhanced from './routes/webhook-routes-enhanced';
import systemRoutes from './routes/system';
import authRoutes from './routes/auth';
import networkRoutes from './routes/networks';
import auditRoutes from './routes/audit';
import securityRoutes from './routes/security';
import cacheRoutes from './routes/cache';
import { MonitoringController } from './controllers/monitoring-controller';
import monitoringServiceEnhanced from './services/monitoring-enhanced';
import githubWebhookEnhanced from './services/github-webhook-enhanced';
import path from 'path';

const logger = createLogger('AppEnhanced');

export class AppEnhanced {
  private app: Application;
  private server: import('http').Server | null = null;
  private io: Server;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      // Add transports configuration for better compatibility
      transports: ['websocket', 'polling']
    });
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupWebhookIntegration();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", "ws:", "wss:"],
        },
      },
    }));

    // CORS
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-GitHub-Event', 'X-GitHub-Delivery', 'X-Hub-Signature-256'],
      credentials: true
    }));

    // Compression
    this.app.use(compression());

    // Body parsing with increased limit for webhook payloads
    this.app.use(express.json({ limit: '25mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '25mb' }));

    // Static files
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Request logging
    this.app.use(requestLogger);

    // Rate limiting (with exclusion for webhook endpoint)
    this.app.use((req, res, next) => {
      // Skip rate limiting for GitHub webhook endpoint
      if (req.path === '/api/webhooks/github') {
        return next();
      }
      rateLimiter(req, res, next);
    });

    // Make io available in req
    this.app.use((req, _res, next) => {
      (req as Request & { io: Server }).io = this.io;
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
    this.app.use('/api/webhooks', webhookRoutesEnhanced); // Use enhanced routes
    this.app.use('/api/metrics', metricsRoutes);
    this.app.use('/api/monitoring', monitoringRoutes);
    this.app.use('/api/system', systemRoutes);
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/networks', networkRoutes);
    this.app.use('/api/audit', auditRoutes);
    this.app.use('/api/security', securityRoutes);
    this.app.use('/api/cache', cacheRoutes);
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
        version: '2.0.0',
        status: 'running',
        features: {
          webhooks: 'enhanced',
          websockets: 'enabled',
          realtime: 'active'
        },
        endpoints: {
          health: '/health',
          jobs: '/api/jobs',
          runners: '/api/runners',
          webhooks: '/api/webhooks',
          metrics: '/api/metrics',
          monitoring: '/api/monitoring',
          dashboard: '/dashboard',
          prometheus: '/metrics',
          websocket: `ws://localhost:${config.app.port}`
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
    // Configure WebSocket namespaces
    const webhookNamespace = this.io.of('/webhooks');
    const monitoringNamespace = this.io.of('/monitoring');

    // Main namespace
    this.io.on('connection', (socket) => {
      logger.info('WebSocket client connected', { 
        id: socket.id,
        transport: socket.conn.transport.name,
        address: socket.handshake.address
      });

      // Join repository-specific rooms
      socket.on('subscribe:repository', (repository: string) => {
        socket.join(`repo:${repository}`);
        logger.debug('Client subscribed to repository', { 
          socketId: socket.id, 
          repository 
        });
        
        // Send confirmation
        socket.emit('subscribed', { repository });
      });

      // Leave repository-specific rooms
      socket.on('unsubscribe:repository', (repository: string) => {
        socket.leave(`repo:${repository}`);
        logger.debug('Client unsubscribed from repository', { 
          socketId: socket.id, 
          repository 
        });
        
        // Send confirmation
        socket.emit('unsubscribed', { repository });
      });

      // Subscribe to specific event types
      socket.on('subscribe:events', (eventTypes: string[]) => {
        eventTypes.forEach(eventType => {
          socket.join(`event:${eventType}`);
        });
        logger.debug('Client subscribed to events', { 
          socketId: socket.id, 
          eventTypes 
        });
      });

      // Handle ping/pong for connection health
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        logger.info('WebSocket client disconnected', { 
          id: socket.id,
          reason 
        });
      });
    });

    // Webhook namespace for webhook-specific events
    webhookNamespace.on('connection', (socket) => {
      logger.info('WebSocket client connected to webhook namespace', { 
        id: socket.id 
      });

      socket.on('subscribe:webhook-events', (filters: { repository?: string; eventType?: string }) => {
        // Join rooms based on filters
        if (filters.repository) {
          socket.join(`webhook:repo:${filters.repository}`);
        }
        if (filters.eventType) {
          socket.join(`webhook:event:${filters.eventType}`);
        }
        
        socket.emit('webhook-subscribed', filters);
      });
    });

    // Monitoring namespace for real-time metrics
    monitoringNamespace.on('connection', (socket) => {
      logger.info('WebSocket client connected to monitoring namespace', { 
        id: socket.id 
      });

      // Send initial metrics on connection
      socket.emit('metrics:initial', {
        message: 'Connected to monitoring namespace'
      });
    });
  }

  private setupWebhookIntegration(): void {
    // Set Socket.IO instance in webhook service
    githubWebhookEnhanced.setSocketIO(this.io);

    // Initialize webhook service
    githubWebhookEnhanced.initialize().catch(error => {
      logger.error('Failed to initialize webhook service', { error });
    });

    // Connect webhook events to WebSocket
    githubWebhookEnhanced.on('webhook-event', (event) => {
      // Emit to main namespace
      this.io.emit('webhook:event', event);
      
      // Emit to webhook namespace
      this.io.of('/webhooks').emit('event', event);
      
      // Emit to specific event type room
      this.io.to(`event:${event.event}`).emit('webhook-event', event);
      this.io.of('/webhooks').to(`webhook:event:${event.event}`).emit('event', event);
    });

    // Workflow job events
    githubWebhookEnhanced.on('workflow-job', (data) => {
      const eventData = {
        type: 'workflow-job',
        action: data.action,
        job: data.job,
        repository: data.repository,
        timestamp: new Date()
      };

      // Emit to all connected clients
      this.io.emit('workflow-job', eventData);
      
      // Emit to repository-specific room
      if (data.repository?.full_name) {
        this.io.to(`repo:${data.repository.full_name}`).emit('workflow-job', eventData);
        this.io.of('/webhooks').to(`webhook:repo:${data.repository.full_name}`).emit('workflow-job', eventData);
      }
    });

    // Push events
    githubWebhookEnhanced.on('push-event', (data) => {
      const eventData = {
        type: 'push',
        repository: data.repository,
        ref: data.ref,
        commits: data.commits?.length || 0,
        timestamp: new Date()
      };

      this.io.emit('push-event', eventData);
      if (data.repository?.full_name) {
        this.io.to(`repo:${data.repository.full_name}`).emit('push-event', eventData);
      }
    });

    // Pull request events
    githubWebhookEnhanced.on('pull-request-event', (data) => {
      const eventData = {
        type: 'pull-request',
        action: data.action,
        repository: data.repository,
        pullRequest: data.pullRequest,
        timestamp: new Date()
      };

      this.io.emit('pull-request-event', eventData);
      if (data.repository?.full_name) {
        this.io.to(`repo:${data.repository.full_name}`).emit('pull-request-event', eventData);
      }
    });

    // Deployment events
    githubWebhookEnhanced.on('deployment-event', (data) => {
      const eventData = {
        type: 'deployment',
        action: data.action,
        repository: data.repository,
        deployment: data.deployment,
        timestamp: new Date()
      };

      this.io.emit('deployment-event', eventData);
      if (data.repository?.full_name) {
        this.io.to(`repo:${data.repository.full_name}`).emit('deployment-event', eventData);
      }
    });

    // Security events (high priority)
    githubWebhookEnhanced.on('security-event', (data) => {
      const eventData = {
        type: 'security',
        severity: 'high',
        eventType: data.type,
        action: data.action,
        repository: data.repository,
        alert: data.alert,
        timestamp: new Date()
      };

      // Broadcast to all clients for security events
      this.io.emit('security-alert', eventData);
      this.io.of('/webhooks').emit('security-alert', eventData);
    });

    // Generic webhook events
    githubWebhookEnhanced.on('generic-event', (data) => {
      this.io.emit('webhook:generic', data);
      this.io.of('/webhooks').emit('generic', data);
    });
  }

  private setupErrorHandling(): void {
    this.app.use(errorHandler);
  }

  public async start(): Promise<void> {
    const port = config.app.port;

    try {
      // Start monitoring service
      await monitoringServiceEnhanced.start();

      // Connect monitoring events to WebSocket
      monitoringServiceEnhanced.on('metrics', (metrics) => {
        this.io.emit('metrics', metrics);
        this.io.of('/monitoring').emit('update', metrics);
      });

      monitoringServiceEnhanced.on('job-event', (event) => {
        this.io.emit('job-event', event);
        if (event.data?.repository) {
          this.io.to(`repo:${event.data.repository}`).emit('job-event', event);
        }
      });

      monitoringServiceEnhanced.on('runner-event', (event) => {
        this.io.emit('runner-event', event);
        this.io.of('/monitoring').emit('runner-event', event);
      });

      monitoringServiceEnhanced.on('scaling-event', (event) => {
        this.io.emit('scaling-event', event);
        if (event.repository) {
          this.io.to(`repo:${event.repository}`).emit('scaling-event', event);
        }
      });

      // Start the server
      this.server.listen(port, () => {
        logger.info(`Enhanced server running on port ${port}`);
        logger.info(`Dashboard available at http://localhost:${port}/dashboard`);
        logger.info(`WebSocket server integrated on same port`);
        logger.info('WebSocket namespaces available:');
        logger.info('  - Main: ws://localhost:' + port);
        logger.info('  - Webhooks: ws://localhost:' + port + '/webhooks');
        logger.info('  - Monitoring: ws://localhost:' + port + '/monitoring');
      });

    } catch (error) {
      logger.error('Failed to start server', { error });
      throw error;
    }
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      logger.info('Stopping enhanced server...');
      
      // Stop monitoring service
      monitoringServiceEnhanced.stop();
      
      // Shutdown webhook service
      githubWebhookEnhanced.shutdown();
      
      // Close WebSocket connections
      this.io.close();
      
      // Close HTTP server
      this.server.close(() => {
        logger.info('Enhanced server stopped');
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

export default AppEnhanced;