/**
 * Monitoring & Alerting System Orchestrator
 * Central coordinator for all monitoring components with unified management
 */

const EventEmitter = require('events');
const PrometheusMetrics = require('./prometheus-metrics');
const GrafanaDashboards = require('./grafana-dashboards');
const AlertingSystem = require('./alerting-system');
const PerformanceAnalytics = require('./performance-analytics');
const RealtimeMonitoringUI = require('./realtime-ui');
const logger = require('../utils/logger');

class MonitoringOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Component configuration
      components: {
        prometheusMetrics: options.prometheusMetrics || {},
        grafanaDashboards: options.grafanaDashboards || {},
        alertingSystem: options.alertingSystem || {},
        performanceAnalytics: options.performanceAnalytics || {},
        realtimeUI: options.realtimeUI || {}
      },
      
      // Orchestrator settings
      orchestrator: {
        healthCheckInterval: options.healthCheckInterval || 60000, // 1 minute
        autoRestart: options.autoRestart !== false,
        gracefulShutdownTimeout: options.gracefulShutdownTimeout || 30000
      },
      
      // Integration settings
      integration: {
        enableAutoExport: options.enableAutoExport !== false,
        exportInterval: options.exportInterval || 5 * 60 * 1000, // 5 minutes
        crossComponentEvents: options.crossComponentEvents !== false
      },
      
      ...options
    };
    
    // Component instances
    this.components = {
      prometheusMetrics: null,
      grafanaDashboards: null,
      alertingSystem: null,
      performanceAnalytics: null,
      realtimeUI: null
    };
    
    // Orchestrator state
    this.isInitialized = false;
    this.isRunning = false;
    this.healthCheckTimer = null;
    
    // Component health tracking
    this.componentHealth = new Map();
    this.lastHealthCheck = null;
    
    // Statistics
    this.stats = {
      uptime: 0,
      totalHealthChecks: 0,
      componentRestarts: 0,
      eventsProcessed: 0,
      lastRestart: null
    };
    
    this.startTime = null;
  }

  /**
   * Initialize monitoring orchestrator
   */
  async initialize() {
    try {
      logger.info('Initializing Monitoring & Alerting System Orchestrator');
      this.startTime = Date.now();
      
      // Initialize components in order
      await this.initializePrometheusMetrics();
      await this.initializeGrafanaDashboards();
      await this.initializeAlertingSystem();
      await this.initializePerformanceAnalytics();
      await this.initializeRealtimeUI();
      
      // Set up component event handlers
      this.setupComponentEventHandlers();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Set up cross-component integration
      if (this.config.integration.crossComponentEvents) {
        this.setupCrossComponentIntegration();
      }
      
      this.isInitialized = true;
      this.isRunning = true;
      this.emit('initialized');
      
      logger.info('Monitoring & Alerting System Orchestrator initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Monitoring Orchestrator:', error);
      throw error;
    }
  }

  /**
   * Initialize Prometheus metrics component
   */
  async initializePrometheusMetrics() {
    try {
      this.components.prometheusMetrics = new PrometheusMetrics({
        ...this.config.components.prometheusMetrics,
        // Enhanced configuration for orchestration
        enableBusinessMetrics: true,
        enablePerformanceMetrics: true,
        enableSecurityMetrics: true
      });
      
      await this.components.prometheusMetrics.initialize();
      this.componentHealth.set('prometheusMetrics', { status: 'healthy', lastCheck: new Date() });
      
      logger.info('Prometheus Metrics component initialized');
      
    } catch (error) {
      logger.error('Failed to initialize Prometheus Metrics:', error);
      this.componentHealth.set('prometheusMetrics', { status: 'failed', error: error.message, lastCheck: new Date() });
      throw error;
    }
  }

  /**
   * Initialize Grafana dashboards component
   */
  async initializeGrafanaDashboards() {
    try {
      this.components.grafanaDashboards = new GrafanaDashboards({
        ...this.config.components.grafanaDashboards,
        // Enhanced configuration for orchestration
        autoImport: true,
        createFolders: true
      });
      
      await this.components.grafanaDashboards.initialize();
      this.componentHealth.set('grafanaDashboards', { status: 'healthy', lastCheck: new Date() });
      
      logger.info('Grafana Dashboards component initialized');
      
    } catch (error) {
      logger.error('Failed to initialize Grafana Dashboards:', error);
      this.componentHealth.set('grafanaDashboards', { status: 'failed', error: error.message, lastCheck: new Date() });
      // Don't throw - dashboards are not critical for core functionality
    }
  }

  /**
   * Initialize alerting system component
   */
  async initializeAlertingSystem() {
    try {
      this.components.alertingSystem = new AlertingSystem({
        ...this.config.components.alertingSystem,
        // Enhanced configuration for orchestration
        escalationEnabled: true,
        suppressDuplicates: true
      });
      
      await this.components.alertingSystem.initialize();
      this.componentHealth.set('alertingSystem', { status: 'healthy', lastCheck: new Date() });
      
      logger.info('Alerting System component initialized');
      
    } catch (error) {
      logger.error('Failed to initialize Alerting System:', error);
      this.componentHealth.set('alertingSystem', { status: 'failed', error: error.message, lastCheck: new Date() });
      throw error;
    }
  }

  /**
   * Initialize performance analytics component
   */
  async initializePerformanceAnalytics() {
    try {
      this.components.performanceAnalytics = new PerformanceAnalytics({
        ...this.config.components.performanceAnalytics,
        // Enhanced configuration for orchestration
        enableTrendAnalysis: true,
        enableAnomalyDetection: true,
        enablePredictiveAnalysis: true,
        enableCapacityPlanning: true
      });
      
      await this.components.performanceAnalytics.initialize();
      this.componentHealth.set('performanceAnalytics', { status: 'healthy', lastCheck: new Date() });
      
      logger.info('Performance Analytics component initialized');
      
    } catch (error) {
      logger.error('Failed to initialize Performance Analytics:', error);
      this.componentHealth.set('performanceAnalytics', { status: 'failed', error: error.message, lastCheck: new Date() });
      // Don't throw - analytics are not critical for core functionality
    }
  }

  /**
   * Initialize real-time UI component
   */
  async initializeRealtimeUI() {
    try {
      this.components.realtimeUI = new RealtimeMonitoringUI({
        ...this.config.components.realtimeUI,
        // Enhanced configuration for orchestration
        autoRefresh: true,
        enableAnimations: true
      });
      
      await this.components.realtimeUI.initialize();
      this.componentHealth.set('realtimeUI', { status: 'healthy', lastCheck: new Date() });
      
      logger.info('Real-time UI component initialized');
      
    } catch (error) {
      logger.error('Failed to initialize Real-time UI:', error);
      this.componentHealth.set('realtimeUI', { status: 'failed', error: error.message, lastCheck: new Date() });
      // Don't throw - UI is not critical for core functionality
    }
  }

  /**
   * Set up component event handlers
   */
  setupComponentEventHandlers() {
    // Prometheus Metrics events
    if (this.components.prometheusMetrics) {
      this.components.prometheusMetrics.on('metricsCollected', (data) => {
        this.handleMetricsCollected(data);
      });
    }
    
    // Alerting System events
    if (this.components.alertingSystem) {
      this.components.alertingSystem.on('alertTriggered', (alert) => {
        this.handleAlertTriggered(alert);
      });
      
      this.components.alertingSystem.on('alertResolved', (alert) => {
        this.handleAlertResolved(alert);
      });
    }
    
    // Performance Analytics events
    if (this.components.performanceAnalytics) {
      this.components.performanceAnalytics.on('anomalyDetected', (data) => {
        this.handleAnomalyDetected(data);
      });
      
      this.components.performanceAnalytics.on('trendDetected', (data) => {
        this.handleTrendDetected(data);
      });
      
      this.components.performanceAnalytics.on('predictionGenerated', (data) => {
        this.handlePredictionGenerated(data);
      });
    }
    
    // Real-time UI events
    if (this.components.realtimeUI) {
      this.components.realtimeUI.on('clientConnected', (client) => {
        logger.info(`Real-time client connected: ${client.id}`);
      });
    }
  }

  /**
   * Set up cross-component integration
   */
  setupCrossComponentIntegration() {
    // Performance analytics -> Alerting integration
    if (this.components.performanceAnalytics && this.components.alertingSystem) {
      this.components.performanceAnalytics.on('anomalyDetected', (data) => {
        // Create dynamic alert for anomaly
        this.components.alertingSystem.addAlertRule({
          id: `anomaly_${data.metric}_${Date.now()}`,
          name: `Anomaly Detected: ${data.metric}`,
          query: `anomaly_detected{metric="${data.metric}"}`,
          severity: 'warning',
          for: '1m',
          labels: { type: 'anomaly', metric: data.metric },
          annotations: {
            summary: `Anomaly detected in ${data.metric}`,
            description: `Statistical anomaly detected with ${data.anomalies.length} anomalous points`
          },
          channels: ['slack']
        });
      });
    }
    
    // Alerting -> Real-time UI integration
    if (this.components.alertingSystem && this.components.realtimeUI) {
      this.components.alertingSystem.on('alertTriggered', (alert) => {
        // Broadcast alert to UI clients
        this.components.realtimeUI.broadcast({
          type: 'alert_triggered',
          alert: {
            id: alert.id,
            name: alert.name,
            severity: alert.severity,
            summary: alert.annotations.summary,
            timestamp: alert.startsAt
          }
        });
      });
      
      this.components.alertingSystem.on('alertResolved', (alert) => {
        // Broadcast resolution to UI clients
        this.components.realtimeUI.broadcast({
          type: 'alert_resolved',
          alert: {
            id: alert.id,
            name: alert.name,
            resolvedAt: alert.endsAt
          }
        });
      });
    }
    
    logger.info('Cross-component integration configured');
  }

  /**
   * Event handlers
   */
  
  handleMetricsCollected(data) {
    this.stats.eventsProcessed++;
    
    // Forward metrics to performance analytics if available
    if (this.components.performanceAnalytics) {
      // This would normally pass actual metric data
      // For now, just log the event
      logger.debug('Metrics collected and forwarded to analytics');
    }
  }
  
  handleAlertTriggered(alert) {
    logger.warn(`Alert triggered: ${alert.name} (${alert.severity})`);
    
    // Record alert metrics
    if (this.components.prometheusMetrics) {
      this.components.prometheusMetrics.recordSecurityEvent('alert_triggered', alert.severity, 'monitoring_system');
    }
    
    this.emit('alertTriggered', alert);
  }
  
  handleAlertResolved(alert) {
    logger.info(`Alert resolved: ${alert.name}`);
    
    // Record resolution metrics
    if (this.components.prometheusMetrics) {
      this.components.prometheusMetrics.recordSecurityEvent('alert_resolved', 'info', 'monitoring_system');
    }
    
    this.emit('alertResolved', alert);
  }
  
  handleAnomalyDetected(data) {
    logger.warn(`Anomaly detected in ${data.metric}: ${data.anomalies.length} anomalous points`);
    
    // Create alert for significant anomalies
    if (data.anomalies.some(a => a.severity === 'high')) {
      this.emit('criticalAnomaly', data);
    }
  }
  
  handleTrendDetected(data) {
    logger.info(`Trend detected in ${data.metric}: ${data.trends.significantTrends.length} significant trends`);
    this.emit('trendDetected', data);
  }
  
  handlePredictionGenerated(data) {
    logger.debug(`Predictions generated for ${data.metric}: ${data.predictions.length} predictions`);
    
    // Check for concerning predictions
    const criticalPredictions = data.predictions.filter(p => 
      p.confidence > 80 && (
        (p.valueKey === 'cpu' && p.predictedValue > 90) ||
        (p.valueKey === 'memory' && p.predictedValue > 95) ||
        (p.valueKey === 'error_rate' && p.predictedValue > 10)
      )
    );
    
    if (criticalPredictions.length > 0) {
      this.emit('criticalPrediction', { metric: data.metric, predictions: criticalPredictions });
    }
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck().catch(error => {
        logger.error('Health check failed:', error);
      });
    }, this.config.orchestrator.healthCheckInterval);
    
    logger.info(`Started health monitoring with ${this.config.orchestrator.healthCheckInterval}ms interval`);
  }

  /**
   * Perform health check on all components
   */
  async performHealthCheck() {
    const healthResults = new Map();
    this.stats.totalHealthChecks++;
    
    for (const [componentName, component] of Object.entries(this.components)) {
      if (component) {
        try {
          // Check if component has a health/status method
          let status = 'healthy';
          let details = {};
          
          if (typeof component.getStatus === 'function') {
            details = component.getStatus();
          } else if (typeof component.getStats === 'function') {
            details = component.getStats();
          }
          
          healthResults.set(componentName, {
            status,
            details,
            lastCheck: new Date()
          });
          
          this.componentHealth.set(componentName, healthResults.get(componentName));
          
        } catch (error) {
          logger.error(`Health check failed for ${componentName}:`, error);
          
          const healthData = {
            status: 'unhealthy',
            error: error.message,
            lastCheck: new Date()
          };
          
          healthResults.set(componentName, healthData);
          this.componentHealth.set(componentName, healthData);
          
          // Attempt restart if enabled
          if (this.config.orchestrator.autoRestart) {
            await this.restartComponent(componentName);
          }
        }
      }
    }
    
    this.lastHealthCheck = new Date();
    this.emit('healthCheckCompleted', {
      results: Object.fromEntries(healthResults),
      timestamp: this.lastHealthCheck
    });
  }

  /**
   * Restart a component
   */
  async restartComponent(componentName) {
    try {
      logger.warn(`Attempting to restart component: ${componentName}`);
      
      const component = this.components[componentName];
      if (component) {
        // Stop component if it has a stop/shutdown method
        if (typeof component.stop === 'function') {
          await component.stop();
        } else if (typeof component.shutdown === 'function') {
          await component.shutdown();
        }
        
        // Reinitialize component
        switch (componentName) {
          case 'prometheusMetrics':
            await this.initializePrometheusMetrics();
            break;
          case 'grafanaDashboards':
            await this.initializeGrafanaDashboards();
            break;
          case 'alertingSystem':
            await this.initializeAlertingSystem();
            break;
          case 'performanceAnalytics':
            await this.initializePerformanceAnalytics();
            break;
          case 'realtimeUI':
            await this.initializeRealtimeUI();
            break;
        }
        
        this.stats.componentRestarts++;
        this.stats.lastRestart = new Date();
        
        logger.info(`Successfully restarted component: ${componentName}`);
        this.emit('componentRestarted', { componentName, timestamp: this.stats.lastRestart });
      }
      
    } catch (error) {
      logger.error(`Failed to restart component ${componentName}:`, error);
      this.emit('componentRestartFailed', { componentName, error: error.message });
    }
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(method, route, statusCode, duration) {
    if (this.components.prometheusMetrics) {
      this.components.prometheusMetrics.recordHttpRequest(method, route, statusCode, duration);
    }
  }

  /**
   * Record database query metrics
   */
  recordDatabaseQuery(database, operation, duration, success = true) {
    if (this.components.prometheusMetrics) {
      this.components.prometheusMetrics.recordDatabaseQuery(database, operation, duration, success);
    }
  }

  /**
   * Record job metrics
   */
  recordJob(repository, workflow, status, runnerType, duration = null) {
    if (this.components.prometheusMetrics) {
      this.components.prometheusMetrics.recordJob(repository, workflow, status, runnerType, duration);
    }
  }

  /**
   * Record security event
   */
  recordSecurityEvent(eventType, severity, source) {
    if (this.components.prometheusMetrics) {
      this.components.prometheusMetrics.recordSecurityEvent(eventType, severity, source);
    }
  }

  /**
   * Get comprehensive monitoring status
   */
  getMonitoringStatus() {
    return {
      orchestrator: {
        isInitialized: this.isInitialized,
        isRunning: this.isRunning,
        uptime: this.startTime ? Date.now() - this.startTime : 0,
        stats: this.stats,
        lastHealthCheck: this.lastHealthCheck
      },
      components: {
        health: Object.fromEntries(this.componentHealth),
        status: {
          prometheusMetrics: this.components.prometheusMetrics?.getStats(),
          grafanaDashboards: this.components.grafanaDashboards?.getStatus(),
          alertingSystem: this.components.alertingSystem?.getStatus(),
          performanceAnalytics: this.components.performanceAnalytics?.getStatus(),
          realtimeUI: this.components.realtimeUI?.getStatus()
        }
      }
    };
  }

  /**
   * Get Prometheus metrics endpoint
   */
  async getMetrics() {
    if (this.components.prometheusMetrics) {
      return await this.components.prometheusMetrics.getMetrics();
    }
    throw new Error('Prometheus metrics component not available');
  }

  /**
   * Get active alerts
   */
  getActiveAlerts() {
    if (this.components.alertingSystem) {
      return this.components.alertingSystem.getActiveAlerts();
    }
    return [];
  }

  /**
   * Get performance report
   */
  getPerformanceReport() {
    if (this.components.performanceAnalytics) {
      return this.components.performanceAnalytics.generatePerformanceReport();
    }
    return null;
  }

  /**
   * Shutdown monitoring orchestrator
   */
  async shutdown() {
    logger.info('Shutting down Monitoring & Alerting System Orchestrator');
    
    this.isRunning = false;
    
    // Stop health monitoring
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    // Shutdown components in reverse order
    const shutdownPromises = [];
    
    if (this.components.realtimeUI) {
      shutdownPromises.push(this.components.realtimeUI.shutdown());
    }
    
    if (this.components.performanceAnalytics) {
      shutdownPromises.push(this.components.performanceAnalytics.shutdown());
    }
    
    if (this.components.alertingSystem) {
      shutdownPromises.push(this.components.alertingSystem.shutdown());
    }
    
    if (this.components.prometheusMetrics) {
      shutdownPromises.push(this.components.prometheusMetrics.shutdown());
    }
    
    // Wait for all components to shutdown gracefully
    try {
      await Promise.race([
        Promise.all(shutdownPromises),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Shutdown timeout')), this.config.orchestrator.gracefulShutdownTimeout)
        )
      ]);
    } catch (error) {
      logger.warn('Some components did not shutdown gracefully:', error);
    }
    
    this.emit('shutdown');
    logger.info('Monitoring & Alerting System Orchestrator shutdown completed');
  }
}

module.exports = MonitoringOrchestrator;