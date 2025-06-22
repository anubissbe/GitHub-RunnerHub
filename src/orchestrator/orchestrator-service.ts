import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import { RunnerOrchestrator, OrchestratorConfig } from './runner-orchestrator';
import { ContainerAssignmentManager } from './container-assignment';
import { JobParser } from './job-parser';
import { StatusReporter } from './status-reporter';
import { OrchestratorWebhookHandler } from './webhook-handler';
import { DatabaseService } from '../services/database-service';

const logger = createLogger('OrchestratorService');

export interface OrchestratorServiceConfig {
  orchestrator: OrchestratorConfig;
  enabled: boolean;
  fallbackToTraditionalRunners: boolean;
  migrationMode: boolean;
}

/**
 * Main service that manages the orchestrator system as a replacement for traditional runners
 */
export class OrchestratorService extends EventEmitter {
  private static instance: OrchestratorService;
  private config: OrchestratorServiceConfig;
  private orchestrator: RunnerOrchestrator;
  private containerAssignmentManager: ContainerAssignmentManager;
  private jobParser: JobParser;
  private statusReporter: StatusReporter;
  private webhookHandler: OrchestratorWebhookHandler;
  private databaseService: DatabaseService;
  
  private isInitialized = false;
  private isShuttingDown = false;
  
  private constructor(config: OrchestratorServiceConfig) {
    super();
    this.config = config;
    
    // Initialize core components
    this.orchestrator = RunnerOrchestrator.getInstance(config.orchestrator);
    this.containerAssignmentManager = ContainerAssignmentManager.getInstance();
    this.jobParser = JobParser.getInstance();
    this.statusReporter = StatusReporter.getInstance();
    this.webhookHandler = OrchestratorWebhookHandler.getInstance();
    this.databaseService = DatabaseService.getInstance();
  }
  
  public static getInstance(config?: OrchestratorServiceConfig): OrchestratorService {
    if (!OrchestratorService.instance) {
      if (!config) {
        throw new Error('Configuration required for first initialization');
      }
      OrchestratorService.instance = new OrchestratorService(config);
    }
    return OrchestratorService.instance;
  }
  
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Orchestrator service already initialized');
      return;
    }
    
    logger.info('Initializing Orchestrator Service...');
    
    try {
      // Check if orchestrator mode is enabled
      if (!this.config.enabled) {
        logger.info('Orchestrator service is disabled, using traditional runners');
        return;
      }
      
      // Initialize container assignment manager
      await this.containerAssignmentManager.initialize();
      
      // Initialize status reporter
      await this.statusReporter.initialize();
      
      // Initialize orchestrator
      await this.orchestrator.initialize();
      
      // Setup event listeners for coordination
      this.setupEventListeners();
      
      // If in migration mode, set up compatibility layer
      if (this.config.migrationMode) {
        await this.setupMigrationMode();
      }
      
      this.isInitialized = true;
      logger.info('Orchestrator Service initialized successfully');
      
      this.emit('initialized');
    } catch (error) {
      logger.error('Failed to initialize Orchestrator Service:', error);
      throw error;
    }
  }
  
  private setupEventListeners(): void {
    // Orchestrator events
    this.orchestrator.on('job:queued', (jobRequest) => {
      logger.info(`Job queued in orchestrator: ${jobRequest.id}`);
      this.emit('job:queued', jobRequest);
    });
    
    this.orchestrator.on('job:started', ({ jobId, containerId }) => {
      logger.info(`Job started: ${jobId} on container ${containerId}`);
      this.emit('job:started', { jobId, containerId });
    });
    
    this.orchestrator.on('job:completed', ({ jobId, conclusion }) => {
      logger.info(`Job completed: ${jobId} with conclusion ${conclusion}`);
      this.emit('job:completed', { jobId, conclusion });
    });
    
    this.orchestrator.on('scaling:needed', ({ direction, reason }) => {
      logger.info(`Scaling needed: ${direction} - ${reason}`);
      this.emit('scaling:needed', { direction, reason });
    });
    
    // Container assignment events
    this.containerAssignmentManager.on('container:assigned', ({ container, jobId }) => {
      logger.info(`Container assigned: ${container.id} to job ${jobId}`);
      this.emit('container:assigned', { container, jobId });
    });
    
    this.containerAssignmentManager.on('container:released', ({ container, jobId }) => {
      logger.info(`Container released: ${container.id} from job ${jobId}`);
      this.emit('container:released', { container, jobId });
    });
    
    this.containerAssignmentManager.on('container:unhealthy', (container) => {
      logger.warn(`Container unhealthy: ${container.id}`);
      this.emit('container:unhealthy', container);
    });
    
    // Status reporter events
    this.statusReporter.on('status:reported', (status) => {
      logger.debug(`Status reported for job ${status.id}`);
      this.emit('status:reported', status);
    });
    
    this.statusReporter.on('status:failed', ({ status, error }) => {
      logger.error(`Failed to report status for job ${status.id}:`, error);
      this.emit('status:failed', { status, error });
    });
  }
  
  private async setupMigrationMode(): Promise<void> {
    logger.info('Setting up migration mode compatibility layer');
    
    // Create compatibility interface that existing systems can use
    // This allows gradual migration from traditional runners to orchestrator
    
    // Expose traditional runner interface methods
    this.exposeLegacyRunnerInterface();
    
    // Set up job routing to handle both orchestrator and traditional runner jobs
    await this.setupHybridJobRouting();
  }
  
  private exposeLegacyRunnerInterface(): void {
    // Provide compatibility methods that mimic the traditional runner API
    // but internally use the orchestrator system
    
    (this as any).requestRunner = async (repository: string, labels: string[] = []) => {
      logger.info('Legacy runner request, routing to orchestrator', { repository, labels });
      
      // Create a job request ID for tracking
      const requestId = `legacy-${Date.now()}-${repository.replace('/', '-')}`;
      
      // This would normally assign a container through the orchestrator
      return { id: requestId, runner: null };
    };
    
    (this as any).releaseRunner = async (runnerId: string) => {
      logger.info('Legacy runner release, routing to orchestrator', { runnerId });
      
      // Find and release the container assignment
      // This would interact with the container assignment manager
      return;
    };
  }
  
  private async setupHybridJobRouting(): Promise<void> {
    // Set up routing logic that can handle both types of jobs
    // during the migration period
    
    logger.info('Setting up hybrid job routing for migration mode');
    
    // Create migration rules in database
    await this.databaseService.createMigrationRules({
      enableOrchestratorFor: ['self-hosted', 'linux', 'docker'],
      fallbackToTraditionalFor: ['windows', 'macos'],
      migrationPhase: 'partial'
    });
  }
  
  /**
   * Process GitHub webhook events through the orchestrator
   */
  public async processWebhookEvent(event: string, payload: any): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Orchestrator service not initialized');
    }
    
    logger.info(`Processing webhook event: ${event}`);
    
    try {
      await this.webhookHandler.processWebhookEvent(event, payload);
    } catch (error) {
      logger.error('Failed to process webhook event:', error);
      
      // If orchestrator fails and fallback is enabled, route to traditional system
      if (this.config.fallbackToTraditionalRunners) {
        logger.info('Falling back to traditional runner system');
        await this.fallbackToTraditionalSystem(event, payload);
      } else {
        throw error;
      }
    }
  }
  
  private async fallbackToTraditionalSystem(event: string, payload: any): Promise<void> {
    logger.info('Executing fallback to traditional runner system');
    
    // This would trigger the existing runner pool manager
    // For now, just log the fallback
    logger.warn('Traditional runner fallback not implemented in this demo');
  }
  
  /**
   * Assign a container to a job (replaces traditional runner assignment)
   */
  public async assignContainer(jobId: string): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('Orchestrator service not initialized');
    }
    
    return await this.orchestrator.assignContainer(jobId);
  }
  
  /**
   * Get orchestrator metrics and health status
   */
  public getOrchestratorMetrics(): any {
    return {
      orchestrator: this.orchestrator.getMetrics(),
      containerAssignment: this.containerAssignmentManager.getStatistics(),
      statusReporter: this.statusReporter.getStatistics(),
      system: {
        initialized: this.isInitialized,
        shuttingDown: this.isShuttingDown,
        mode: this.config.migrationMode ? 'migration' : 'full-orchestrator',
        fallbackEnabled: this.config.fallbackToTraditionalRunners
      }
    };
  }
  
  /**
   * Health check for the orchestrator system
   */
  public async healthCheck(): Promise<any> {
    const health = {
      status: 'healthy',
      components: {
        orchestrator: 'unknown',
        containerAssignment: 'unknown',
        statusReporter: 'unknown',
        database: 'unknown'
      },
      timestamp: new Date()
    };
    
    try {
      // Check orchestrator
      const orchestratorStatus = this.orchestrator.getStatus();
      health.components.orchestrator = orchestratorStatus === 'ready' ? 'healthy' : 'unhealthy';
      
      // Check container assignment manager
      const containerStats = this.containerAssignmentManager.getStatistics();
      health.components.containerAssignment = containerStats.total > 0 ? 'healthy' : 'warning';
      
      // Check status reporter
      const reporterStats = this.statusReporter.getStatistics();
      health.components.statusReporter = reporterStats.queueSize < 100 ? 'healthy' : 'warning';
      
      // Check database connectivity
      await this.databaseService.query('SELECT 1');
      health.components.database = 'healthy';
      
      // Overall status
      const allHealthy = Object.values(health.components).every(status => status === 'healthy');
      const anyUnhealthy = Object.values(health.components).some(status => status === 'unhealthy');
      
      if (anyUnhealthy) {
        health.status = 'unhealthy';
      } else if (!allHealthy) {
        health.status = 'degraded';
      }
      
    } catch (error) {
      logger.error('Health check failed:', error);
      health.status = 'unhealthy';
    }
    
    return health;
  }
  
  /**
   * Gracefully shutdown the orchestrator system
   */
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Orchestrator service already shutting down');
      return;
    }
    
    this.isShuttingDown = true;
    logger.info('Shutting down Orchestrator Service...');
    
    try {
      // Shutdown orchestrator (this will handle status reporter shutdown)
      await this.orchestrator.shutdown();
      
      this.isInitialized = false;
      logger.info('Orchestrator Service shutdown complete');
      
      this.emit('shutdown:complete');
    } catch (error) {
      logger.error('Error during orchestrator service shutdown:', error);
      throw error;
    }
  }
  
  /**
   * Check if orchestrator should handle this job (migration mode)
   */
  public shouldUseOrchestrator(jobLabels: string[]): boolean {
    if (!this.config.enabled) {
      return false;
    }
    
    if (!this.config.migrationMode) {
      return true; // Full orchestrator mode
    }
    
    // Migration mode logic
    const orchestratorLabels = ['self-hosted', 'linux', 'docker'];
    const traditionalLabels = ['windows', 'macos'];
    
    // Use orchestrator if job has orchestrator-compatible labels
    const hasOrchestratorLabels = jobLabels.some(label => 
      orchestratorLabels.includes(label.toLowerCase())
    );
    
    // Don't use orchestrator if job has traditional-only labels
    const hasTraditionalLabels = jobLabels.some(label => 
      traditionalLabels.includes(label.toLowerCase())
    );
    
    return hasOrchestratorLabels && !hasTraditionalLabels;
  }
  
  public isEnabled(): boolean {
    return this.config.enabled;
  }
  
  public isInitializedStatus(): boolean {
    return this.isInitialized;
  }
}

export default OrchestratorService;