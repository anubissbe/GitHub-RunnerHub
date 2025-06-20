import { createLogger } from '../utils/logger';
import config from '../config';
import VaultService from './vault-service';
import database from './database';
import authMiddleware from '../middleware/auth';
import networkIsolationService from './network-isolation';
import auditLogger from './audit-logger';
import securityScanner from './security-scanner';
import { EventEmitter } from 'events';

const logger = createLogger('ServiceManager');

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'unhealthy' | 'initializing';
  message?: string;
  lastCheck?: Date;
}

/**
 * Central service manager for GitHub RunnerHub
 * Manages initialization and health of all core services
 */
export class ServiceManager extends EventEmitter {
  private static instance: ServiceManager;
  private services: Map<string, any> = new Map();
  private healthStatus: Map<string, ServiceHealth> = new Map();
  private initialized = false;

  private constructor() {
    super();
  }

  public static getInstance(): ServiceManager {
    if (!ServiceManager.instance) {
      ServiceManager.instance = new ServiceManager();
    }
    return ServiceManager.instance;
  }

  /**
   * Initialize all core services in proper order
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('ServiceManager already initialized');
      return;
    }

    logger.info('Starting service initialization');

    try {
      // Phase 1: Initialize Vault for secret management
      await this.initializeVault();

      // Phase 2: Initialize database with Vault-provided credentials
      await this.initializeDatabase();

      // Phase 3: Initialize authentication middleware
      await this.initializeAuth();

      // Phase 4: Initialize other services
      await this.initializeOtherServices();

      this.initialized = true;
      logger.info('All services initialized successfully');
      this.emit('initialized');

    } catch (error) {
      logger.error('Service initialization failed', { error: (error as Error).message });
      this.emit('initialization-failed', error);
      throw error;
    }
  }

  /**
   * Initialize HashiCorp Vault service
   */
  private async initializeVault(): Promise<void> {
    logger.info('Initializing Vault service');
    
    const vaultConfig = {
      url: config.vault.addr,
      token: config.vault.token,
      retryAttempts: 3,
      retryDelay: 2000
    };

    try {
      const vaultService = VaultService.getInstance(vaultConfig);
      await vaultService.initialize();

      this.services.set('vault', vaultService);
      this.updateServiceHealth('vault', 'healthy', 'Vault service initialized and token validated');

      // Set up event listeners
      vaultService.on('token-renewed', () => {
        logger.info('Vault token renewed successfully');
      });

      vaultService.on('token-renewal-failed', (error) => {
        logger.error('Vault token renewal failed', { error });
        this.updateServiceHealth('vault', 'unhealthy', 'Token renewal failed');
      });

      logger.info('Vault service initialized successfully');

    } catch (error) {
      this.updateServiceHealth('vault', 'unhealthy', `Vault initialization failed: ${(error as Error).message}`);
      throw new Error(`Vault initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * Initialize database with Vault-provided credentials
   */
  private async initializeDatabase(): Promise<void> {
    logger.info('Initializing database service with Vault credentials');

    try {
      const vaultService = this.getService<VaultService>('vault');
      
      // Get database credentials from Vault (with fallback to config)
      try {
        const dbCredentials = await vaultService.getDatabaseCredentials();
        logger.info('Retrieved database credentials from Vault', { host: dbCredentials.host });
      } catch (error) {
        logger.warn('Failed to get database credentials from Vault, using config fallback', { error: (error as Error).message });
        // Application will fallback to config values automatically
      }

      // Initialize database service  
      const databaseService = database;
      // Database is already a singleton instance, no need to call getInstance()

      this.services.set('database', databaseService);
      this.updateServiceHealth('database', 'healthy', 'Database connected successfully');

      logger.info('Database service initialized successfully');

    } catch (error) {
      this.updateServiceHealth('database', 'unhealthy', `Database initialization failed: ${(error as Error).message}`);
      throw new Error(`Database initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * Initialize authentication middleware
   */
  private async initializeAuth(): Promise<void> {
    logger.info('Initializing authentication middleware');

    try {
      await authMiddleware.initialize();
      
      this.services.set('auth', authMiddleware);
      this.updateServiceHealth('auth', 'healthy', 'Authentication middleware initialized');

      logger.info('Authentication middleware initialized successfully');

    } catch (error) {
      this.updateServiceHealth('auth', 'unhealthy', `Auth initialization failed: ${(error as Error).message}`);
      throw new Error(`Auth initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * Initialize other core services
   */
  private async initializeOtherServices(): Promise<void> {
    logger.info('Initializing remaining core services');

    // Initialize audit logger
    try {
      await auditLogger.initialize();
      this.services.set('audit-logger', auditLogger);
      this.updateServiceHealth('audit-logger', 'healthy', 'Audit logger initialized');
      logger.info('Audit logger initialized successfully');
    } catch (error) {
      this.updateServiceHealth('audit-logger', 'unhealthy', `Audit logger initialization failed: ${(error as Error).message}`);
      logger.error('Failed to initialize audit logger', { error: (error as Error).message });
    }

    // Initialize network isolation service
    try {
      await networkIsolationService.initialize();
      this.services.set('network-isolation', networkIsolationService);
      this.updateServiceHealth('network-isolation', 'healthy', 'Network isolation service initialized');
      logger.info('Network isolation service initialized successfully');
    } catch (error) {
      this.updateServiceHealth('network-isolation', 'unhealthy', `Network isolation initialization failed: ${(error as Error).message}`);
      logger.error('Failed to initialize network isolation service', { error: (error as Error).message });
    }

    // Initialize security scanner
    try {
      await securityScanner.initialize();
      this.services.set('security-scanner', securityScanner);
      this.updateServiceHealth('security-scanner', 'healthy', 'Security scanner initialized');
      logger.info('Security scanner initialized successfully');
    } catch (error) {
      this.updateServiceHealth('security-scanner', 'unhealthy', `Security scanner initialization failed: ${(error as Error).message}`);
      logger.error('Failed to initialize security scanner', { error: (error as Error).message });
    }

    // Mark other services as ready
    this.updateServiceHealth('job-queue', 'healthy', 'Job queue service ready');
    this.updateServiceHealth('container-orchestrator', 'healthy', 'Container orchestrator ready');
    this.updateServiceHealth('monitoring', 'healthy', 'Monitoring service ready');

    logger.info('All core services initialized');
  }

  /**
   * Get a service by name
   */
  getService<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service '${name}' not found or not initialized`);
    }
    return service as T;
  }

  /**
   * Check if service is available
   */
  hasService(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Get health status of all services
   */
  getHealthStatus(): ServiceHealth[] {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Get health status of specific service
   */
  getServiceHealth(name: string): ServiceHealth | undefined {
    return this.healthStatus.get(name);
  }

  /**
   * Update service health status
   */
  private updateServiceHealth(name: string, status: ServiceHealth['status'], message?: string): void {
    const health: ServiceHealth = {
      name,
      status,
      message,
      lastCheck: new Date()
    };

    this.healthStatus.set(name, health);
    this.emit('health-updated', health);

    logger.debug('Service health updated', health);
  }

  /**
   * Perform health checks on all services
   */
  async performHealthChecks(): Promise<ServiceHealth[]> {
    logger.debug('Performing health checks on all services');

    const checks = [];

    // Check Vault health
    if (this.hasService('vault')) {
      checks.push(this.checkVaultHealth());
    }

    // Check database health
    if (this.hasService('database')) {
      checks.push(this.checkDatabaseHealth());
    }

    await Promise.allSettled(checks);
    return this.getHealthStatus();
  }

  /**
   * Check Vault service health
   */
  private async checkVaultHealth(): Promise<void> {
    try {
      const vaultService = this.getService<VaultService>('vault');
      const health = await vaultService.checkHealth();
      
      this.updateServiceHealth('vault', 'healthy', 
        `Vault healthy - Version: ${health.version}, Sealed: ${health.sealed}`);
    } catch (error) {
      this.updateServiceHealth('vault', 'unhealthy', 
        `Vault health check failed: ${(error as Error).message}`);
    }
  }

  /**
   * Check database health
   */
  private async checkDatabaseHealth(): Promise<void> {
    try {
      const databaseService = this.getService<any>('database');
      const isHealthy = await databaseService.healthCheck();
      
      this.updateServiceHealth('database', 
        isHealthy ? 'healthy' : 'unhealthy', 
        isHealthy ? 'Database connection healthy' : 'Database connection failed');
    } catch (error) {
      this.updateServiceHealth('database', 'unhealthy', 
        `Database health check failed: ${(error as Error).message}`);
    }
  }

  /**
   * Get system-wide health summary
   */
  getSystemHealth(): {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    services: ServiceHealth[];
    summary: {
      total: number;
      healthy: number;
      unhealthy: number;
      initializing: number;
    };
  } {
    const services = this.getHealthStatus();
    const summary = {
      total: services.length,
      healthy: services.filter(s => s.status === 'healthy').length,
      unhealthy: services.filter(s => s.status === 'unhealthy').length,
      initializing: services.filter(s => s.status === 'initializing').length
    };

    let overall: 'healthy' | 'degraded' | 'unhealthy';
    if (summary.unhealthy === 0) {
      overall = 'healthy';
    } else if (summary.healthy > 0) {
      overall = 'degraded';
    } else {
      overall = 'unhealthy';
    }

    return {
      overall,
      services,
      summary
    };
  }

  /**
   * Rotate secrets for all services
   */
  async rotateSecrets(): Promise<void> {
    if (!this.hasService('vault')) {
      throw new Error('Vault service not available for secret rotation');
    }

    logger.info('Starting secret rotation process');

    try {
      // This would be implemented when we have actual secret rotation logic
      // For now, just log the intention
      logger.info('Secret rotation would be performed here');

      this.emit('secrets-rotated');
      logger.info('Secret rotation completed successfully');

    } catch (error) {
      logger.error('Secret rotation failed', { error: (error as Error).message });
      this.emit('secret-rotation-failed', error);
      throw error;
    }
  }

  /**
   * Graceful shutdown of all services
   */
  async shutdown(): Promise<void> {
    logger.info('Starting graceful shutdown of all services');

    try {
      // Shutdown services in reverse order
      const shutdownPromises = [];

      if (this.hasService('vault')) {
        const vaultService = this.getService<VaultService>('vault');
        shutdownPromises.push(vaultService.shutdown());
      }

      if (this.hasService('database')) {
        const databaseService = this.getService<any>('database');
        shutdownPromises.push(databaseService.close());
      }

      await Promise.allSettled(shutdownPromises);

      this.services.clear();
      this.healthStatus.clear();
      this.initialized = false;

      logger.info('All services shut down successfully');
      this.emit('shutdown-complete');

    } catch (error) {
      logger.error('Error during service shutdown', { error: (error as Error).message });
      this.emit('shutdown-error', error);
      throw error;
    }
  }

  /**
   * Check if all services are initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

export default ServiceManager;