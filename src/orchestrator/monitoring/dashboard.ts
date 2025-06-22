import { createLogger } from '../../utils/logger';
import { EventEmitter } from 'events';
import { OrchestratorMonitor, HealthStatus, Alert, MetricSnapshot } from './orchestrator-monitor';
import { RunnerOrchestrator } from '../runner-orchestrator';
import { ContainerAssignmentManager } from '../container-assignment';
import { StatusReporter } from '../status-reporter';

const logger = createLogger('OrchestratorDashboard');

export interface DashboardConfig {
  updateInterval: number;
  historyRetention: number; // minutes
  alertSeverityFilter: ('info' | 'warning' | 'critical')[];
}

export interface DashboardData {
  timestamp: Date;
  health: HealthStatus;
  metrics: {
    current: any;
    historical: MetricSnapshot[];
  };
  alerts: {
    active: Alert[];
    recent: Alert[];
  };
  orchestrator: {
    status: string;
    activeJobs: number;
    pendingJobs: number;
    uptime: number;
  };
  containers: {
    total: number;
    healthy: number;
    assigned: number;
    unhealthy: number;
    utilization: number;
  };
  statusReporter: {
    queueSize: number;
    isReporting: boolean;
  };
  performance: {
    averageJobDuration: number;
    jobCompletionRate: number;
    errorRate: number;
    throughput: number;
  };
}

export interface RealtimeEvent {
  type: 'job_queued' | 'job_started' | 'job_completed' | 'container_assigned' | 'container_released' | 'alert_created' | 'health_updated';
  timestamp: Date;
  data: any;
}

/**
 * Real-time dashboard for monitoring orchestrator system
 */
export class OrchestratorDashboard extends EventEmitter {
  private static instance: OrchestratorDashboard;
  private config: DashboardConfig;
  private monitor: OrchestratorMonitor;
  private orchestrator: RunnerOrchestrator;
  private containerAssignmentManager: ContainerAssignmentManager;
  private statusReporter: StatusReporter;
  
  private updateInterval?: NodeJS.Timer;
  private metricsHistory: MetricSnapshot[] = [];
  private alertHistory: Alert[] = [];
  private eventHistory: RealtimeEvent[] = [];
  
  private constructor(config: DashboardConfig) {
    super();
    this.config = config;
    
    this.monitor = OrchestratorMonitor.getInstance();
    this.orchestrator = RunnerOrchestrator.getInstance();
    this.containerAssignmentManager = ContainerAssignmentManager.getInstance();
    this.statusReporter = StatusReporter.getInstance();
  }
  
  public static getInstance(config?: DashboardConfig): OrchestratorDashboard {
    if (!OrchestratorDashboard.instance) {
      const defaultConfig: DashboardConfig = {
        updateInterval: 5000, // 5 seconds
        historyRetention: 60, // 1 hour
        alertSeverityFilter: ['warning', 'critical']
      };
      OrchestratorDashboard.instance = new OrchestratorDashboard(config || defaultConfig);
    }
    return OrchestratorDashboard.instance;
  }
  
  public async initialize(): Promise<void> {
    logger.info('Initializing Orchestrator Dashboard');
    
    try {
      // Set up event listeners
      this.setupEventListeners();
      
      // Start dashboard updates
      this.startDashboardUpdates();
      
      logger.info('Orchestrator Dashboard initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Orchestrator Dashboard:', error);
      throw error;
    }
  }
  
  private setupEventListeners(): void {
    // Monitor events
    this.monitor.on('health:updated', (health: HealthStatus) => {
      this.addRealtimeEvent('health_updated', health);
      this.emit('dashboard:health_updated', health);
    });
    
    this.monitor.on('alert:created', (alert: Alert) => {
      this.alertHistory.unshift(alert);
      this.trimAlertHistory();
      
      if (this.config.alertSeverityFilter.includes(alert.level)) {
        this.addRealtimeEvent('alert_created', alert);
        this.emit('dashboard:alert_created', alert);
      }
    });
    
    this.monitor.on('metrics:collected', (metrics: MetricSnapshot) => {
      this.metricsHistory.unshift(metrics);
      this.trimMetricsHistory();
      this.emit('dashboard:metrics_updated', metrics);
    });
    
    // Orchestrator events
    this.orchestrator.on('job:queued', (jobRequest) => {
      this.addRealtimeEvent('job_queued', { jobId: jobRequest.id, repository: jobRequest.repository });
      this.emit('dashboard:job_queued', jobRequest);
    });
    
    this.orchestrator.on('job:started', ({ jobId, containerId }) => {
      this.addRealtimeEvent('job_started', { jobId, containerId });
      this.emit('dashboard:job_started', { jobId, containerId });
    });
    
    this.orchestrator.on('job:completed', ({ jobId, conclusion }) => {
      this.addRealtimeEvent('job_completed', { jobId, conclusion });
      this.emit('dashboard:job_completed', { jobId, conclusion });
    });
    
    // Container events
    this.containerAssignmentManager.on('container:assigned', ({ container, jobId }) => {
      this.addRealtimeEvent('container_assigned', { containerId: container.id, jobId });
      this.emit('dashboard:container_assigned', { container, jobId });
    });
    
    this.containerAssignmentManager.on('container:released', ({ container, jobId }) => {
      this.addRealtimeEvent('container_released', { containerId: container.id, jobId });
      this.emit('dashboard:container_released', { container, jobId });
    });
  }
  
  private addRealtimeEvent(type: RealtimeEvent['type'], data: any): void {
    const event: RealtimeEvent = {
      type,
      timestamp: new Date(),
      data
    };
    
    this.eventHistory.unshift(event);
    
    // Keep only recent events (last 1000)
    if (this.eventHistory.length > 1000) {
      this.eventHistory = this.eventHistory.slice(0, 1000);
    }
    
    this.emit('dashboard:realtime_event', event);
  }
  
  private startDashboardUpdates(): void {
    this.updateInterval = setInterval(() => {
      try {
        const dashboardData = this.getDashboardData();
        this.emit('dashboard:updated', dashboardData);
      } catch (error) {
        logger.error('Failed to update dashboard:', error);
      }
    }, this.config.updateInterval);
  }
  
  public getDashboardData(): DashboardData {
    const health = this.monitor.getCurrentHealth();
    const orchestratorMetrics = this.orchestrator.getMetrics();
    const containerStats = this.containerAssignmentManager.getStatistics();
    const statusReporterStats = this.statusReporter.getStatistics();
    const activeAlerts = this.monitor.getActiveAlerts();
    
    // Calculate performance metrics
    const performance = this.calculatePerformanceMetrics();
    
    return {
      timestamp: new Date(),
      health,
      metrics: {
        current: {
          orchestrator: orchestratorMetrics,
          containers: containerStats,
          statusReporter: statusReporterStats
        },
        historical: this.metricsHistory.slice(0, 60) // Last hour of metrics
      },
      alerts: {
        active: activeAlerts,
        recent: this.alertHistory.slice(0, 20) // Last 20 alerts
      },
      orchestrator: {
        status: orchestratorMetrics.status,
        activeJobs: orchestratorMetrics.activeJobs,
        pendingJobs: orchestratorMetrics.pendingJobs,
        uptime: health.uptime
      },
      containers: {
        total: containerStats.total,
        healthy: containerStats.ready + containerStats.assigned,
        assigned: containerStats.assigned,
        unhealthy: containerStats.unhealthy,
        utilization: containerStats.utilization?.cpu || 0
      },
      statusReporter: {
        queueSize: statusReporterStats.queueSize,
        isReporting: statusReporterStats.isReporting
      },
      performance
    };
  }
  
  private calculatePerformanceMetrics(): any {
    // In a real implementation, these would be calculated from historical data
    const recentEvents = this.eventHistory.slice(0, 100);
    
    const jobEvents = recentEvents.filter(e => 
      e.type === 'job_queued' || e.type === 'job_started' || e.type === 'job_completed'
    );
    
    const jobsCompleted = recentEvents.filter(e => e.type === 'job_completed').length;
    const jobsQueued = recentEvents.filter(e => e.type === 'job_queued').length;
    
    return {
      averageJobDuration: this.calculateAverageJobDuration(),
      jobCompletionRate: jobsQueued > 0 ? (jobsCompleted / jobsQueued) * 100 : 0,
      errorRate: this.calculateErrorRate(),
      throughput: this.calculateThroughput()
    };
  }
  
  private calculateAverageJobDuration(): number {
    // This would calculate from actual job completion times
    // For now, return a placeholder
    return 300000; // 5 minutes in milliseconds
  }
  
  private calculateErrorRate(): number {
    const recentAlerts = this.alertHistory.slice(0, 50);
    const criticalAlerts = recentAlerts.filter(a => a.level === 'critical').length;
    
    return recentAlerts.length > 0 ? (criticalAlerts / recentAlerts.length) * 100 : 0;
  }
  
  private calculateThroughput(): number {
    // Jobs per minute
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    
    const recentCompletions = this.eventHistory.filter(e => 
      e.type === 'job_completed' && e.timestamp >= oneMinuteAgo
    ).length;
    
    return recentCompletions;
  }
  
  private trimMetricsHistory(): void {
    const retentionTime = this.config.historyRetention * 60 * 1000; // Convert to milliseconds
    const cutoff = new Date(Date.now() - retentionTime);
    
    this.metricsHistory = this.metricsHistory.filter(m => m.timestamp >= cutoff);
  }
  
  private trimAlertHistory(): void {
    const retentionTime = this.config.historyRetention * 60 * 1000; // Convert to milliseconds
    const cutoff = new Date(Date.now() - retentionTime);
    
    this.alertHistory = this.alertHistory.filter(a => a.timestamp >= cutoff);
  }
  
  /**
   * Get real-time events for a specific time range
   */
  public getRealtimeEvents(since?: Date): RealtimeEvent[] {
    if (!since) {
      return this.eventHistory.slice(0, 50); // Last 50 events
    }
    
    return this.eventHistory.filter(e => e.timestamp >= since);
  }
  
  /**
   * Get system overview for quick status check
   */
  public getSystemOverview(): any {
    const health = this.monitor.getCurrentHealth();
    const orchestratorMetrics = this.orchestrator.getMetrics();
    const containerStats = this.containerAssignmentManager.getStatistics();
    const activeAlerts = this.monitor.getActiveAlerts();
    
    return {
      status: health.overall,
      uptime: health.uptime,
      activeJobs: orchestratorMetrics.activeJobs,
      pendingJobs: orchestratorMetrics.pendingJobs,
      containers: {
        total: containerStats.total,
        healthy: containerStats.ready + containerStats.assigned,
        utilization: (containerStats.utilization?.cpu * 100).toFixed(1) + '%'
      },
      alerts: {
        total: activeAlerts.length,
        critical: activeAlerts.filter(a => a.level === 'critical').length,
        warnings: activeAlerts.filter(a => a.level === 'warning').length
      },
      lastUpdate: new Date()
    };
  }
  
  /**
   * Export dashboard data for external monitoring systems
   */
  public exportMetrics(): any {
    const dashboardData = this.getDashboardData();
    
    return {
      timestamp: dashboardData.timestamp,
      health: {
        overall: dashboardData.health.overall,
        components: Object.keys(dashboardData.health.components).reduce((acc, key) => {
          acc[key] = dashboardData.health.components[key as keyof typeof dashboardData.health.components].status;
          return acc;
        }, {} as any)
      },
      metrics: {
        active_jobs: dashboardData.orchestrator.activeJobs,
        pending_jobs: dashboardData.orchestrator.pendingJobs,
        container_utilization: dashboardData.containers.utilization,
        status_queue_size: dashboardData.statusReporter.queueSize,
        throughput: dashboardData.performance.throughput,
        error_rate: dashboardData.performance.errorRate
      },
      alerts: {
        total: dashboardData.alerts.active.length,
        by_level: dashboardData.alerts.active.reduce((acc, alert) => {
          acc[alert.level] = (acc[alert.level] || 0) + 1;
          return acc;
        }, {} as any)
      }
    };
  }
  
  /**
   * Generate HTML dashboard for web interface
   */
  public generateHTMLDashboard(): string {
    const data = this.getDashboardData();
    const overview = this.getSystemOverview();
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GitHub RunnerHub Orchestrator Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .status-healthy { color: #28a745; }
        .status-degraded { color: #ffc107; }
        .status-unhealthy { color: #dc3545; }
        .metric { display: flex; justify-content: space-between; margin: 10px 0; }
        .alert { padding: 10px; margin: 5px 0; border-radius: 4px; }
        .alert-critical { background: #f8d7da; border-left: 4px solid #dc3545; }
        .alert-warning { background: #fff3cd; border-left: 4px solid #ffc107; }
        .alert-info { background: #d1ecf1; border-left: 4px solid #17a2b8; }
        .timestamp { color: #666; font-size: 0.9em; }
    </style>
</head>
<body>
    <h1>GitHub RunnerHub Orchestrator Dashboard</h1>
    <div class="timestamp">Last updated: ${data.timestamp.toISOString()}</div>
    
    <div class="dashboard">
        <div class="card">
            <h2>System Overview</h2>
            <div class="metric">
                <span>Status:</span>
                <span class="status-${overview.status}">${overview.status.toUpperCase()}</span>
            </div>
            <div class="metric">
                <span>Uptime:</span>
                <span>${Math.floor(overview.uptime / 1000 / 60)} minutes</span>
            </div>
            <div class="metric">
                <span>Active Jobs:</span>
                <span>${overview.activeJobs}</span>
            </div>
            <div class="metric">
                <span>Pending Jobs:</span>
                <span>${overview.pendingJobs}</span>
            </div>
        </div>
        
        <div class="card">
            <h2>Container Status</h2>
            <div class="metric">
                <span>Total Containers:</span>
                <span>${data.containers.total}</span>
            </div>
            <div class="metric">
                <span>Healthy:</span>
                <span>${data.containers.healthy}</span>
            </div>
            <div class="metric">
                <span>Assigned:</span>
                <span>${data.containers.assigned}</span>
            </div>
            <div class="metric">
                <span>Unhealthy:</span>
                <span>${data.containers.unhealthy}</span>
            </div>
            <div class="metric">
                <span>Utilization:</span>
                <span>${(data.containers.utilization * 100).toFixed(1)}%</span>
            </div>
        </div>
        
        <div class="card">
            <h2>Performance</h2>
            <div class="metric">
                <span>Throughput:</span>
                <span>${data.performance.throughput} jobs/min</span>
            </div>
            <div class="metric">
                <span>Completion Rate:</span>
                <span>${data.performance.jobCompletionRate.toFixed(1)}%</span>
            </div>
            <div class="metric">
                <span>Error Rate:</span>
                <span>${data.performance.errorRate.toFixed(1)}%</span>
            </div>
            <div class="metric">
                <span>Avg Duration:</span>
                <span>${Math.floor(data.performance.averageJobDuration / 1000 / 60)}m</span>
            </div>
        </div>
        
        <div class="card">
            <h2>Active Alerts</h2>
            ${data.alerts.active.length === 0 ? 
                '<p>No active alerts</p>' :
                data.alerts.active.map(alert => `
                    <div class="alert alert-${alert.level}">
                        <strong>${alert.level.toUpperCase()}: ${alert.component}</strong><br>
                        ${alert.message}<br>
                        <small>${alert.timestamp.toISOString()}</small>
                    </div>
                `).join('')
            }
        </div>
    </div>
    
    <script>
        // Auto-refresh every 30 seconds
        setTimeout(() => location.reload(), 30000);
    </script>
</body>
</html>`;
  }
  
  public async shutdown(): Promise<void> {
    logger.info('Shutting down Orchestrator Dashboard');
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    logger.info('Orchestrator Dashboard shutdown complete');
  }
}

export default OrchestratorDashboard;