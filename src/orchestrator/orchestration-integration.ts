import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import { EnhancedOrchestrator, EnhancedOrchestratorConfig } from './enhanced-orchestrator';
import { DockerIntegrationService } from '../docker';
import { JobDistributionSystem } from '../job-distribution';
import { WebhookHandler } from './webhook-handler';
import { DatabaseService } from '../services/database';
import { MonitoringService } from '../services/monitoring';

const logger = createLogger('OrchestrationIntegration');

export interface IntegrationConfig {
  orchestrator: EnhancedOrchestratorConfig;
  webhook: {
    enabled: boolean;
    port: number;
    path: string;
    secret: string;
  };
  monitoring: {
    enabled: boolean;
    metricsPort: number;
    healthCheckPort: number;
  };
  features: {
    jobDistribution: boolean;
    dockerIntegration: boolean;
    autoScaling: boolean;
    legacyCompatibility: boolean;
  };
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    orchestrator: boolean;
    jobDistribution: boolean;
    docker: boolean;
    database: boolean;
    webhooks: boolean;
  };
  metrics: {
    activeJobs: number;
    queuedJobs: number;
    containerUtilization: number;
    errorRate: number;
    uptime: number;
  };
  lastCheck: Date;
}

export interface IntegrationMetrics {
  totalWebhookEvents: number;
  processedWebhookEvents: number;
  failedWebhookEvents: number;
  averageProcessingTime: number;
  systemUptime: number;
  componentHealth: Record<string, boolean>;
  lastHealthCheck: Date;
}

export class OrchestrationIntegration extends EventEmitter {
  private static instance: OrchestrationIntegration;
  private config: IntegrationConfig;
  private startTime: Date;
  
  // Core components
  private orchestrator: EnhancedOrchestrator;
  private jobDistributionSystem: JobDistributionSystem;
  private dockerIntegration: DockerIntegrationService;
  private webhookHandler: WebhookHandler;
  private _databaseService: DatabaseService;
  private _monitoringService: MonitoringService;
  
  // Health and metrics
  private systemHealth: SystemHealth;
  private integrationMetrics: IntegrationMetrics;
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;
  
  // State management
  private isInitialized = false;
  private isShuttingDown = false;

  private constructor(config: IntegrationConfig) {
    super();
    this.config = config;
    this.startTime = new Date();
    
    // Initialize health and metrics
    this.systemHealth = this.initializeSystemHealth();
    this.integrationMetrics = this.initializeIntegrationMetrics();
    
    logger.info('Orchestration Integration created', {
      features: config.features,
      webhookEnabled: config.webhook.enabled,
      monitoringEnabled: config.monitoring.enabled
    });
  }

  public static getInstance(config?: IntegrationConfig): OrchestrationIntegration {
    if (!OrchestrationIntegration.instance) {
      if (!config) {
        throw new Error('Configuration required for first initialization');
      }
      OrchestrationIntegration.instance = new OrchestrationIntegration(config);
    }
    return OrchestrationIntegration.instance;
  }

  private initializeSystemHealth(): SystemHealth {
    return {
      overall: 'healthy',
      components: {
        orchestrator: false,
        jobDistribution: false,
        docker: false,
        database: false,
        webhooks: false
      },
      metrics: {
        activeJobs: 0,
        queuedJobs: 0,
        containerUtilization: 0,
        errorRate: 0,
        uptime: 0
      },
      lastCheck: new Date()
    };
  }

  private initializeIntegrationMetrics(): IntegrationMetrics {
    return {
      totalWebhookEvents: 0,
      processedWebhookEvents: 0,
      failedWebhookEvents: 0,
      averageProcessingTime: 0,
      systemUptime: 0,
      componentHealth: {},
      lastHealthCheck: new Date()
    };
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Integration already initialized');
      return;
    }

    try {
      logger.info('Initializing Orchestration Integration...');

      // Initialize core services
      await this.initializeCoreServices();

      // Initialize Enhanced Orchestrator
      this.orchestrator = EnhancedOrchestrator.getInstance(this.config.orchestrator);
      await this.orchestrator.initialize();
      this.systemHealth.components.orchestrator = true;
      logger.info('Enhanced Orchestrator initialized');

      // Initialize Job Distribution System if enabled
      if (this.config.features.jobDistribution) {
        this.jobDistributionSystem = new JobDistributionSystem();
        await this.jobDistributionSystem.initialize();
        this.systemHealth.components.jobDistribution = true;
        logger.info('Job Distribution System initialized');
      }

      // Initialize Docker Integration if enabled
      if (this.config.features.dockerIntegration) {
        this.dockerIntegration = DockerIntegrationService.getInstance();
        await this.dockerIntegration.initialize();
        this.systemHealth.components.docker = true;
        logger.info('Docker Integration initialized');
      }

      // Initialize Webhook Handler if enabled
      if (this.config.webhook.enabled) {
        this.webhookHandler = new WebhookHandler({
          port: this.config.webhook.port,
          path: this.config.webhook.path,
          secret: this.config.webhook.secret
        });
        await this.webhookHandler.initialize();
        this.systemHealth.components.webhooks = true;
        logger.info('Webhook Handler initialized');
      }

      // Set up event listeners
      this.setupEventListeners();

      // Start monitoring if enabled
      if (this.config.monitoring.enabled) {
        this.startHealthChecks();
        this.startMetricsCollection();
        logger.info('Monitoring and health checks started');
      }

      // Verify all required components are healthy
      await this.performInitialHealthCheck();

      this.isInitialized = true;
      this.systemHealth.overall = 'healthy';
      
      logger.info('Orchestration Integration initialized successfully');
      this.emit('initialized', { health: this.systemHealth });

    } catch (error) {
      logger.error('Failed to initialize Orchestration Integration:', error);
      this.systemHealth.overall = 'unhealthy';
      throw error;
    }
  }

  private async initializeCoreServices(): Promise<void> {
    // Initialize Database Service
    this.databaseService = DatabaseService.getInstance();
    await this.databaseService.initialize();
    this.systemHealth.components.database = true;
    logger.info('Database Service initialized');

    // Initialize Metrics Collector
    this.metricsCollector = MetricsCollector.getInstance();
    await this.metricsCollector.initialize();
    logger.info('Metrics Collector initialized');
  }

  private setupEventListeners(): void {
    // Orchestrator events
    this.orchestrator.on('job:queued', this.handleJobQueued.bind(this));
    this.orchestrator.on('job:started', this.handleJobStarted.bind(this));
    this.orchestrator.on('job:completed', this.handleJobCompleted.bind(this));
    this.orchestrator.on('job:failed', this.handleJobFailed.bind(this));
    this.orchestrator.on('job:cancelled', this.handleJobCancelled.bind(this));
    this.orchestrator.on('scaling:completed', this.handleScalingCompleted.bind(this));

    // Webhook events
    if (this.webhookHandler) {
      this.webhookHandler.on('webhook:received', this.handleWebhookReceived.bind(this));
      this.webhookHandler.on('webhook:processed', this.handleWebhookProcessed.bind(this));
      this.webhookHandler.on('webhook:failed', this.handleWebhookFailed.bind(this));
    }

    // Job Distribution System events
    if (this.jobDistributionSystem) {
      this.jobDistributionSystem.components.parallelExecutor.on('batch_submitted', 
        this.handleBatchSubmitted.bind(this));
      this.jobDistributionSystem.components.parallelExecutor.on('execution_plan_completed', 
        this.handleExecutionPlanCompleted.bind(this));
    }

    // Docker Integration events
    if (this.dockerIntegration) {
      this.dockerIntegration.on('container:created', this.handleContainerCreated.bind(this));
      this.dockerIntegration.on('container:removed', this.handleContainerRemoved.bind(this));
    }

    // System-level error handling
    process.on('uncaughtException', this.handleUncaughtException.bind(this));
    process.on('unhandledRejection', this.handleUnhandledRejection.bind(this));
    process.on('SIGTERM', this.handleGracefulShutdown.bind(this));
    process.on('SIGINT', this.handleGracefulShutdown.bind(this));
  }

  // Event handlers
  private handleJobQueued(data: any): void {
    logger.debug('Job queued in integration layer:', data);
    this.emit('job:queued', data);
  }

  private handleJobStarted(data: any): void {
    logger.debug('Job started in integration layer:', data);
    this.emit('job:started', data);
  }

  private handleJobCompleted(data: any): void {
    logger.debug('Job completed in integration layer:', data);
    this.integrationMetrics.processedWebhookEvents++;
    this.emit('job:completed', data);
  }

  private handleJobFailed(data: any): void {
    logger.warn('Job failed in integration layer:', data);
    this.integrationMetrics.failedWebhookEvents++;
    this.emit('job:failed', data);
  }

  private handleJobCancelled(data: any): void {
    logger.debug('Job cancelled in integration layer:', data);
    this.emit('job:cancelled', data);
  }

  private handleScalingCompleted(data: any): void {
    logger.info('Scaling completed:', data);
    this.emit('scaling:completed', data);
  }

  private handleWebhookReceived(data: any): void {
    const startTime = Date.now();
    this.integrationMetrics.totalWebhookEvents++;
    
    logger.debug('Webhook received:', { 
      event: data.event, 
      repository: data.repository,
      totalEvents: this.integrationMetrics.totalWebhookEvents 
    });

    // Route webhook to orchestrator
    if (data.event === 'workflow_job') {
      this.orchestrator.handleWorkflowJobEvent(data.payload)
        .then(() => {
          const processingTime = Date.now() - startTime;
          this.updateAverageProcessingTime(processingTime);
          this.handleWebhookProcessed({ ...data, processingTime });
        })
        .catch(error => {
          this.handleWebhookFailed({ ...data, error });
        });
    }
  }

  private handleWebhookProcessed(data: any): void {
    this.integrationMetrics.processedWebhookEvents++;
    logger.debug('Webhook processed successfully:', { 
      event: data.event, 
      processingTime: data.processingTime 
    });
  }

  private handleWebhookFailed(data: any): void {
    this.integrationMetrics.failedWebhookEvents++;
    logger.error('Webhook processing failed:', { 
      event: data.event, 
      error: data.error.message 
    });
    this.emit('webhook:failed', data);
  }

  private handleBatchSubmitted(data: any): void {
    logger.debug('Job batch submitted to distribution system:', data);
    this.emit('batch:submitted', data);
  }

  private handleExecutionPlanCompleted(data: any): void {
    logger.debug('Execution plan completed:', data);
    this.emit('execution_plan:completed', data);
  }

  private handleContainerCreated(data: any): void {
    logger.debug('Container created:', data);
    this.emit('container:created', data);
  }

  private handleContainerRemoved(data: any): void {
    logger.debug('Container removed:', data);
    this.emit('container:removed', data);
  }

  private handleUncaughtException(error: Error): void {
    logger.error('Uncaught exception in integration layer:', error);
    this.systemHealth.overall = 'unhealthy';
    this.emit('system:error', { type: 'uncaught_exception', error });
  }

  private handleUnhandledRejection(reason: any, promise: Promise<any>): void {
    logger.error('Unhandled promise rejection in integration layer:', { reason, promise });
    this.systemHealth.overall = 'degraded';
    this.emit('system:error', { type: 'unhandled_rejection', reason });
  }

  private handleGracefulShutdown(): void {
    logger.info('Graceful shutdown requested');
    this.shutdown().catch(error => {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    });
  }

  // Health checks and monitoring
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Health check failed:', error);
      }
    }, 30000); // Every 30 seconds
  }

  private async performHealthCheck(): Promise<void> {
    const startTime = Date.now();

    try {
      // Check orchestrator health
      this.systemHealth.components.orchestrator = this.orchestrator.getStatus() !== 'error';

      // Check job distribution system health
      if (this.jobDistributionSystem) {
        const jdsHealth = this.jobDistributionSystem.getSystemHealth();
        this.systemHealth.components.jobDistribution = Object.values(jdsHealth).every(h => h === true);
      }

      // Check Docker integration health
      if (this.dockerIntegration) {
        const dockerHealth = this.dockerIntegration.getHealthStatus();
        this.systemHealth.components.docker = dockerHealth.docker;
      }

      // Check database health
      this.systemHealth.components.database = await this.databaseService.isHealthy();

      // Check webhook handler health
      if (this.webhookHandler) {
        this.systemHealth.components.webhooks = this.webhookHandler.isHealthy();
      }

      // Update overall health
      const componentStates = Object.values(this.systemHealth.components);
      const healthyComponents = componentStates.filter(state => state).length;
      const totalComponents = componentStates.length;

      if (healthyComponents === totalComponents) {
        this.systemHealth.overall = 'healthy';
      } else if (healthyComponents >= totalComponents * 0.7) {
        this.systemHealth.overall = 'degraded';
      } else {
        this.systemHealth.overall = 'unhealthy';
      }

      // Update metrics
      const orchestratorMetrics = this.orchestrator.getMetrics();
      this.systemHealth.metrics = {
        activeJobs: orchestratorMetrics.activeJobs,
        queuedJobs: orchestratorMetrics.queuedJobs,
        containerUtilization: orchestratorMetrics.containerUtilization,
        errorRate: orchestratorMetrics.errorRate,
        uptime: Date.now() - this.startTime.getTime()
      };

      this.systemHealth.lastCheck = new Date();

      // Store health data in metrics
      this.integrationMetrics.componentHealth = { ...this.systemHealth.components };
      this.integrationMetrics.lastHealthCheck = new Date();

      // Emit health status
      this.emit('health:checked', this.systemHealth);

      logger.debug('Health check completed', {
        overall: this.systemHealth.overall,
        components: this.systemHealth.components,
        duration: Date.now() - startTime
      });

    } catch (error) {
      logger.error('Health check failed:', error);
      this.systemHealth.overall = 'unhealthy';
    }
  }

  private async performInitialHealthCheck(): Promise<void> {
    await this.performHealthCheck();
    
    if (this.systemHealth.overall === 'unhealthy') {
      throw new Error('Initial health check failed - system is unhealthy');
    }
    
    logger.info('Initial health check passed', { health: this.systemHealth.overall });
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        await this.collectIntegrationMetrics();
      } catch (error) {
        logger.error('Metrics collection failed:', error);
      }
    }, 60000); // Every minute
  }

  private async collectIntegrationMetrics(): Promise<void> {
    this.integrationMetrics.systemUptime = Date.now() - this.startTime.getTime();
    
    // Record metrics in the metrics collector
    await this.metricsCollector.recordCustomMetrics('integration', {
      webhookEvents: {
        total: this.integrationMetrics.totalWebhookEvents,
        processed: this.integrationMetrics.processedWebhookEvents,
        failed: this.integrationMetrics.failedWebhookEvents
      },
      processing: {
        averageTime: this.integrationMetrics.averageProcessingTime,
        uptime: this.integrationMetrics.systemUptime
      },
      health: this.systemHealth
    });

    this.emit('metrics:collected', this.integrationMetrics);
  }

  private updateAverageProcessingTime(newTime: number): void {
    if (this.integrationMetrics.averageProcessingTime === 0) {
      this.integrationMetrics.averageProcessingTime = newTime;
    } else {
      // Running average
      this.integrationMetrics.averageProcessingTime = 
        (this.integrationMetrics.averageProcessingTime + newTime) / 2;
    }
  }

  // Public API methods
  public getSystemHealth(): SystemHealth {
    return { ...this.systemHealth };
  }

  public getIntegrationMetrics(): IntegrationMetrics {
    return { ...this.integrationMetrics };
  }

  public getSystemMetrics(): any {
    return {
      orchestrator: this.orchestrator.getMetrics(),
      jobDistribution: this.jobDistributionSystem?.getSystemMetrics(),
      docker: this.dockerIntegration?.getSystemMetrics(),
      integration: this.integrationMetrics,
      health: this.systemHealth
    };
  }

  public async triggerHealthCheck(): Promise<SystemHealth> {
    await this.performHealthCheck();
    return this.getSystemHealth();
  }

  public async getJobStatus(jobId: string): Promise<any> {
    return await this.orchestrator.getJobStatus(jobId);
  }

  public async cancelJob(jobId: string): Promise<boolean> {
    return await this.orchestrator.cancelJob(jobId);
  }

  public getActiveJobs(): any {
    return this.orchestrator.getActiveJobs();
  }

  public getExecutionHistory(): any {
    return this.orchestrator.getExecutionHistory();
  }

  // Feature toggles
  public isFeatureEnabled(feature: keyof IntegrationConfig['features']): boolean {
    return this.config.features[feature];
  }

  public async enableFeature(feature: keyof IntegrationConfig['features']): Promise<void> {
    if (this.config.features[feature]) {
      logger.warn(`Feature ${feature} is already enabled`);
      return;
    }

    this.config.features[feature] = true;
    logger.info(`Feature ${feature} enabled`);

    // Reinitialize components if needed
    switch (feature) {
      case 'jobDistribution':
        if (!this.jobDistributionSystem) {
          this.jobDistributionSystem = new JobDistributionSystem();
          await this.jobDistributionSystem.initialize();
          this.systemHealth.components.jobDistribution = true;
        }
        break;
      case 'dockerIntegration':
        if (!this.dockerIntegration) {
          this.dockerIntegration = DockerIntegrationService.getInstance();
          await this.dockerIntegration.initialize();
          this.systemHealth.components.docker = true;
        }
        break;
    }

    this.emit('feature:enabled', { feature });
  }

  public async disableFeature(feature: keyof IntegrationConfig['features']): Promise<void> {
    if (!this.config.features[feature]) {
      logger.warn(`Feature ${feature} is already disabled`);
      return;
    }

    this.config.features[feature] = false;
    logger.info(`Feature ${feature} disabled`);

    // Shutdown components if needed
    switch (feature) {
      case 'jobDistribution':
        if (this.jobDistributionSystem) {
          await this.jobDistributionSystem.shutdown();
          this.systemHealth.components.jobDistribution = false;
        }
        break;
      case 'dockerIntegration':
        if (this.dockerIntegration) {
          await this.dockerIntegration.shutdown();
          this.systemHealth.components.docker = false;
        }
        break;
    }

    this.emit('feature:disabled', { feature });
  }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    logger.info('Shutting down Orchestration Integration...');

    // Stop monitoring
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.metricsInterval) clearInterval(this.metricsInterval);

    // Shutdown components in reverse order
    try {
      if (this.webhookHandler) {
        await this.webhookHandler.shutdown();
        logger.info('Webhook Handler shut down');
      }

      if (this.dockerIntegration) {
        await this.dockerIntegration.shutdown();
        logger.info('Docker Integration shut down');
      }

      if (this.jobDistributionSystem) {
        await this.jobDistributionSystem.shutdown();
        logger.info('Job Distribution System shut down');
      }

      await this.orchestrator.shutdown();
      logger.info('Enhanced Orchestrator shut down');

      // Final metrics collection
      await this.collectIntegrationMetrics();

      this.systemHealth.overall = 'unhealthy';
      this.isInitialized = false;

      logger.info('Orchestration Integration shutdown complete');
      this.emit('shutdown:complete');

    } catch (error) {
      logger.error('Error during shutdown:', error);
      throw error;
    }
  }
}

export default OrchestrationIntegration;