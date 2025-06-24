import { createLogger } from '../../utils/logger';
import { EventEmitter } from 'events';
import { RunnerOrchestrator } from '../runner-orchestrator';
import { ContainerAssignmentManager } from '../container-assignment';
import { StatusReporter } from '../status-reporter';
import database from '../../services/database';
import monitoringService from '../../services/monitoring';

const logger = createLogger('OrchestratorMonitor');

export interface MonitoringConfig {
  healthCheckInterval: number;
  metricsCollectionInterval: number;
  alertThresholds: {
    queueSizeWarning: number;
    queueSizeCritical: number;
    containerUtilizationHigh: number;
    containerUtilizationLow: number;
    jobFailureRateHigh: number;
    responseTimeHigh: number;
  };
  retentionPeriods: {
    metrics: number; // days
    logs: number; // days
    alerts: number; // days
  };
}

export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    orchestrator: ComponentHealth;
    containerAssignment: ComponentHealth;
    statusReporter: ComponentHealth;
    database: ComponentHealth;
    queue: ComponentHealth;
  };
  timestamp: Date;
  uptime: number;
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  metrics?: any;
  lastCheck: Date;
}

export interface Alert {
  id: string;
  level: 'info' | 'warning' | 'critical';
  component: string;
  message: string;
  details: any;
  timestamp: Date;
  resolved?: Date;
  resolvedBy?: string;
}

export interface MetricSnapshot {
  timestamp: Date;
  orchestrator: {
    status: string;
    activeJobs: number;
    pendingJobs: number;
    totalContainers: number;
    utilization: number;
  };
  containerAssignment: {
    assignmentsPerMinute: number;
    averageAssignmentTime: number;
    failedAssignments: number;
    healthyContainers: number;
    unhealthyContainers: number;
  };
  statusReporter: {
    queueSize: number;
    reportsPerMinute: number;
    failedReports: number;
    averageReportTime: number;
  };
  system: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkIO: number;
  };
}

export class OrchestratorMonitor extends EventEmitter {
  private static instance: OrchestratorMonitor;
  private config: MonitoringConfig;
  private orchestrator: RunnerOrchestrator;
  private containerAssignmentManager: ContainerAssignmentManager;
  private statusReporter: StatusReporter;
  private databaseService: typeof database;
  private metricsCollector: typeof monitoringService;
  
  private healthCheckInterval?: NodeJS.Timer;
  private metricsInterval?: NodeJS.Timer;
  private alertCleanupInterval?: NodeJS.Timer;
  
  private currentHealth: HealthStatus;
  private activeAlerts: Map<string, Alert> = new Map();
  private startTime: Date = new Date();
  private lastMetrics: MetricSnapshot | null = null;
  
  private constructor(config: MonitoringConfig) {
    super();
    this.config = config;
    
    this.orchestrator = RunnerOrchestrator.getInstance();
    this.containerAssignmentManager = ContainerAssignmentManager.getInstance();
    this.statusReporter = StatusReporter.getInstance();
    this.databaseService = database;
    this.metricsCollector = monitoringService;
    
    this.currentHealth = this.initializeHealthStatus();
  }
  
  public static getInstance(config?: MonitoringConfig): OrchestratorMonitor {
    if (!OrchestratorMonitor.instance) {
      if (!config) {
        const defaultConfig: MonitoringConfig = {
          healthCheckInterval: 30000, // 30 seconds
          metricsCollectionInterval: 60000, // 1 minute
          alertThresholds: {
            queueSizeWarning: 50,
            queueSizeCritical: 100,
            containerUtilizationHigh: 0.9,
            containerUtilizationLow: 0.1,
            jobFailureRateHigh: 0.1,
            responseTimeHigh: 5000
          },
          retentionPeriods: {
            metrics: 30,
            logs: 7,
            alerts: 90
          }
        };
        config = defaultConfig;
      }
      OrchestratorMonitor.instance = new OrchestratorMonitor(config);
    }
    return OrchestratorMonitor.instance;
  }
  
  public async initialize(): Promise<void> {
    logger.info('Initializing Orchestrator Monitor');
    
    try {
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Start metrics collection
      this.startMetricsCollection();
      
      // Start alert cleanup
      this.startAlertCleanup();
      
      // Set up event listeners
      this.setupEventListeners();
      
      logger.info('Orchestrator Monitor initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Orchestrator Monitor:', error);
      throw error;
    }
  }
  
  private initializeHealthStatus(): HealthStatus {
    return {
      overall: 'healthy',
      components: {
        orchestrator: { status: 'healthy', lastCheck: new Date() },
        containerAssignment: { status: 'healthy', lastCheck: new Date() },
        statusReporter: { status: 'healthy', lastCheck: new Date() },
        database: { status: 'healthy', lastCheck: new Date() },
        queue: { status: 'healthy', lastCheck: new Date() }
      },
      timestamp: new Date(),
      uptime: 0
    };
  }
  
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Health check failed:', error);
        this.createAlert('critical', 'monitor', 'Health check failed', { error: error instanceof Error ? error.message : String(error) });
      }
    }, this.config.healthCheckInterval);
  }
  
  private async performHealthCheck(): Promise<void> {
    const health: HealthStatus = {
      overall: 'healthy',
      components: {
        orchestrator: await this.checkOrchestratorHealth(),
        containerAssignment: await this.checkContainerAssignmentHealth(),
        statusReporter: await this.checkStatusReporterHealth(),
        database: await this.checkDatabaseHealth(),
        queue: await this.checkQueueHealth()
      },
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime()
    };
    
    // Determine overall health
    const componentStatuses = Object.values(health.components).map(c => c.status);
    if (componentStatuses.some(s => s === 'unhealthy')) {
      health.overall = 'unhealthy';
    } else if (componentStatuses.some(s => s === 'degraded')) {
      health.overall = 'degraded';
    }
    
    // Check for threshold alerts
    await this.checkThresholds(health);
    
    this.currentHealth = health;
    this.emit('health:updated', health);
    
    // Store health metrics
    await this.metricsCollector.recordOrchestratorHealth(health);
  }
  
  private async checkOrchestratorHealth(): ComponentHealth {
    try {
      const status = this.orchestrator.getStatus();
      const metrics = this.orchestrator.getMetrics();
      
      if (status === 'ready') {
        return {
          status: 'healthy',
          message: `Orchestrator running with ${metrics.activeJobs} active jobs`,
          metrics,
          lastCheck: new Date()
        };
      } else if (status === 'processing' || status === 'scaling') {
        return {
          status: 'degraded',
          message: `Orchestrator in ${status} state`,
          metrics,
          lastCheck: new Date()
        };
      } else {
        return {
          status: 'unhealthy',
          message: `Orchestrator in ${status} state`,
          metrics,
          lastCheck: new Date()
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Failed to check orchestrator health: ${error.message}`,
        lastCheck: new Date()
      };
    }
  }
  
  private async checkContainerAssignmentHealth(): ComponentHealth {
    try {
      const stats = this.containerAssignmentManager.getStatistics();
      
      if (stats.total === 0) {
        return {
          status: 'degraded',
          message: 'No containers available',
          metrics: stats,
          lastCheck: new Date()
        };
      }
      
      const healthyRatio = (stats.ready + stats.assigned) / stats.total;
      
      if (healthyRatio >= 0.8) {
        return {
          status: 'healthy',
          message: `${stats.ready} ready containers, ${stats.assigned} assigned`,
          metrics: stats,
          lastCheck: new Date()
        };
      } else if (healthyRatio >= 0.5) {
        return {
          status: 'degraded',
          message: `Low healthy container ratio: ${(healthyRatio * 100).toFixed(0)}%`,
          metrics: stats,
          lastCheck: new Date()
        };
      } else {
        return {
          status: 'unhealthy',
          message: `Critical healthy container ratio: ${(healthyRatio * 100).toFixed(0)}%`,
          metrics: stats,
          lastCheck: new Date()
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Failed to check container assignment health: ${error.message}`,
        lastCheck: new Date()
      };
    }
  }
  
  private async checkStatusReporterHealth(): ComponentHealth {
    try {
      const stats = this.statusReporter.getStatistics();
      
      if (stats.queueSize < this.config.alertThresholds.queueSizeWarning) {
        return {
          status: 'healthy',
          message: `Status queue size: ${stats.queueSize}`,
          metrics: stats,
          lastCheck: new Date()
        };
      } else if (stats.queueSize < this.config.alertThresholds.queueSizeCritical) {
        return {
          status: 'degraded',
          message: `High status queue size: ${stats.queueSize}`,
          metrics: stats,
          lastCheck: new Date()
        };
      } else {
        return {
          status: 'unhealthy',
          message: `Critical status queue size: ${stats.queueSize}`,
          metrics: stats,
          lastCheck: new Date()
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Failed to check status reporter health: ${error.message}`,
        lastCheck: new Date()
      };
    }
  }
  
  private async checkDatabaseHealth(): ComponentHealth {
    try {
      const startTime = Date.now();
      await this.databaseService.query('SELECT 1');
      const responseTime = Date.now() - startTime;
      
      if (responseTime < 1000) {
        return {
          status: 'healthy',
          message: `Database responsive (${responseTime}ms)`,
          metrics: { responseTime },
          lastCheck: new Date()
        };
      } else if (responseTime < 5000) {
        return {
          status: 'degraded',
          message: `Database slow (${responseTime}ms)`,
          metrics: { responseTime },
          lastCheck: new Date()
        };
      } else {
        return {
          status: 'unhealthy',
          message: `Database very slow (${responseTime}ms)`,
          metrics: { responseTime },
          lastCheck: new Date()
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Database connection failed: ${error.message}`,
        lastCheck: new Date()
      };
    }
  }
  
  private async checkQueueHealth(): ComponentHealth {
    try {
      // This would check Redis queue health in a real implementation
      return {
        status: 'healthy',
        message: 'Queue system operational',
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Queue health check failed: ${error.message}`,
        lastCheck: new Date()
      };
    }
  }
  
  private async checkThresholds(health: HealthStatus): Promise<void> {
    const orchestratorMetrics = health.components.orchestrator.metrics;
    const containerMetrics = health.components.containerAssignment.metrics;
    const statusMetrics = health.components.statusReporter.metrics;
    
    // Check queue size thresholds
    if (orchestratorMetrics?.pendingJobs > this.config.alertThresholds.queueSizeCritical) {
      this.createAlert('critical', 'orchestrator', 'Critical queue size', {
        queueSize: orchestratorMetrics.pendingJobs,
        threshold: this.config.alertThresholds.queueSizeCritical
      });
    } else if (orchestratorMetrics?.pendingJobs > this.config.alertThresholds.queueSizeWarning) {
      this.createAlert('warning', 'orchestrator', 'High queue size', {
        queueSize: orchestratorMetrics.pendingJobs,
        threshold: this.config.alertThresholds.queueSizeWarning
      });
    }
    
    // Check container utilization
    if (containerMetrics?.utilization?.cpu > this.config.alertThresholds.containerUtilizationHigh) {
      this.createAlert('warning', 'containers', 'High container utilization', {
        utilization: containerMetrics.utilization.cpu,
        threshold: this.config.alertThresholds.containerUtilizationHigh
      });
    }
    
    // Check status reporter queue
    if (statusMetrics?.queueSize > this.config.alertThresholds.queueSizeCritical) {
      this.createAlert('critical', 'status-reporter', 'Status reporter queue overloaded', {
        queueSize: statusMetrics.queueSize,
        threshold: this.config.alertThresholds.queueSizeCritical
      });
    }
  }
  
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        logger.error('Metrics collection failed:', error);
      }
    }, this.config.metricsCollectionInterval);
  }
  
  private async collectMetrics(): Promise<void> {
    const metrics: MetricSnapshot = {
      timestamp: new Date(),
      orchestrator: this.collectOrchestratorMetrics(),
      containerAssignment: this.collectContainerAssignmentMetrics(),
      statusReporter: this.collectStatusReporterMetrics(),
      system: await this.collectSystemMetrics()
    };
    
    // Store metrics
    await this.metricsCollector.recordMetricSnapshot(metrics);
    
    // Calculate deltas if we have previous metrics
    if (this.lastMetrics) {
      const deltas = this.calculateMetricDeltas(this.lastMetrics, metrics);
      await this.metricsCollector.recordMetricDeltas(deltas);
    }
    
    this.lastMetrics = metrics;
    this.emit('metrics:collected', metrics);
  }
  
  private collectOrchestratorMetrics(): any {
    const metrics = this.orchestrator.getMetrics();
    return {
      status: metrics.status,
      activeJobs: metrics.activeJobs,
      pendingJobs: metrics.pendingJobs,
      totalContainers: metrics.containers,
      utilization: metrics.utilization
    };
  }
  
  private collectContainerAssignmentMetrics(): any {
    const stats = this.containerAssignmentManager.getStatistics();
    return {
      assignmentsPerMinute: 0, // Would be calculated from recent assignments
      averageAssignmentTime: 0, // Would be calculated from assignment times
      failedAssignments: 0, // Would be tracked from failures
      healthyContainers: stats.ready + stats.assigned,
      unhealthyContainers: stats.unhealthy
    };
  }
  
  private collectStatusReporterMetrics(): any {
    const stats = this.statusReporter.getStatistics();
    return {
      queueSize: stats.queueSize,
      reportsPerMinute: 0, // Would be calculated from recent reports
      failedReports: 0, // Would be tracked from failures
      averageReportTime: 0 // Would be calculated from report times
    };
  }
  
  private async collectSystemMetrics(): Promise<any> {
    // In a real implementation, this would collect actual system metrics
    return {
      cpuUsage: Math.random() * 100,
      memoryUsage: Math.random() * 100,
      diskUsage: Math.random() * 100,
      networkIO: Math.random() * 1000
    };
  }
  
  private calculateMetricDeltas(previous: MetricSnapshot, current: MetricSnapshot): any {
    const timeDelta = current.timestamp.getTime() - previous.timestamp.getTime();
    
    return {
      timeDelta,
      orchestrator: {
        activeJobsDelta: current.orchestrator.activeJobs - previous.orchestrator.activeJobs,
        pendingJobsDelta: current.orchestrator.pendingJobs - previous.orchestrator.pendingJobs
      },
      containerAssignment: {
        healthyContainersDelta: current.containerAssignment.healthyContainers - previous.containerAssignment.healthyContainers
      },
      statusReporter: {
        queueSizeDelta: current.statusReporter.queueSize - previous.statusReporter.queueSize
      }
    };
  }
  
  private createAlert(level: 'info' | 'warning' | 'critical', component: string, message: string, details: any): void {
    const alertId = `${component}-${Date.now()}`;
    const alert: Alert = {
      id: alertId,
      level,
      component,
      message,
      details,
      timestamp: new Date()
    };
    
    this.activeAlerts.set(alertId, alert);
    
    logger[level](`Alert created: ${message}`, details);
    this.emit('alert:created', alert);
    
    // Store alert in database
    this.databaseService.saveAlert(alert).catch(error => {
      logger.error('Failed to save alert:', error);
    });
  }
  
  public resolveAlert(alertId: string, resolvedBy: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      return false;
    }
    
    alert.resolved = new Date();
    alert.resolvedBy = resolvedBy;
    
    this.activeAlerts.delete(alertId);
    
    logger.info(`Alert resolved: ${alert.message}`, { resolvedBy });
    this.emit('alert:resolved', alert);
    
    // Update alert in database
    this.databaseService.updateAlert(alert).catch(error => {
      logger.error('Failed to update resolved alert:', error);
    });
    
    return true;
  }
  
  private startAlertCleanup(): void {
    this.alertCleanupInterval = setInterval(async () => {
      try {
        await this.cleanupOldData();
      } catch (error) {
        logger.error('Alert cleanup failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // Daily cleanup
  }
  
  private async cleanupOldData(): Promise<void> {
    const now = new Date();
    
    // Clean up old metrics
    const metricsRetention = new Date(now.getTime() - this.config.retentionPeriods.metrics * 24 * 60 * 60 * 1000);
    await this.databaseService.cleanupOldMetrics(metricsRetention);
    
    // Clean up old logs
    const logsRetention = new Date(now.getTime() - this.config.retentionPeriods.logs * 24 * 60 * 60 * 1000);
    await this.databaseService.cleanupOldLogs(logsRetention);
    
    // Clean up old alerts
    const alertsRetention = new Date(now.getTime() - this.config.retentionPeriods.alerts * 24 * 60 * 60 * 1000);
    await this.databaseService.cleanupOldAlerts(alertsRetention);
    
    logger.info('Old data cleanup completed');
  }
  
  private setupEventListeners(): void {
    // Listen to orchestrator events for monitoring
    this.orchestrator.on('job:queued', () => {
      this.emit('metric:job_queued');
    });
    
    this.orchestrator.on('job:started', () => {
      this.emit('metric:job_started');
    });
    
    this.orchestrator.on('job:completed', () => {
      this.emit('metric:job_completed');
    });
    
    this.containerAssignmentManager.on('container:assigned', () => {
      this.emit('metric:container_assigned');
    });
    
    this.containerAssignmentManager.on('container:unhealthy', (container) => {
      this.createAlert('warning', 'containers', `Container ${container.id} unhealthy`, {
        containerId: container.id,
        healthStatus: container.healthStatus
      });
    });
    
    this.statusReporter.on('status:failed', ({ status, error }) => {
      this.createAlert('warning', 'status-reporter', `Failed to report status for job ${status.id}`, {
        jobId: status.id,
        error: error.message
      });
    });
  }
  
  public getCurrentHealth(): HealthStatus {
    return this.currentHealth;
  }
  
  public getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }
  
  public getMetrics(): any {
    return {
      currentHealth: this.currentHealth,
      activeAlerts: this.activeAlerts.size,
      lastMetrics: this.lastMetrics,
      uptime: Date.now() - this.startTime.getTime(),
      config: this.config
    };
  }
  
  public async shutdown(): Promise<void> {
    logger.info('Shutting down Orchestrator Monitor');
    
    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    if (this.alertCleanupInterval) {
      clearInterval(this.alertCleanupInterval);
    }
    
    // Perform final cleanup
    await this.cleanupOldData();
    
    logger.info('Orchestrator Monitor shutdown complete');
  }
}

export default OrchestratorMonitor;