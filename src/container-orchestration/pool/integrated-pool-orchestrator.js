/**
 * Integrated Container Pool Orchestrator
 * Unified orchestration of all container pool management components
 */

const EventEmitter = require('events');
const ContainerPoolManager = require('./container-pool-manager');
const DynamicScaler = require('./dynamic-scaler');
const ContainerReuseOptimizer = require('./reuse-optimizer');
const ContainerStateManager = require('./state-manager');
const ContainerPoolResourceMonitor = require('./resource-monitor');
const logger = require('../../utils/logger');

class IntegratedContainerPoolOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Pool configuration
      pool: {
        minSize: options.minPoolSize || 3,
        maxSize: options.maxPoolSize || 20,
        targetSize: options.targetPoolSize || 8,
        baseImage: options.baseImage || 'ubuntu:22.04'
      },
      
      // Integration configuration
      integration: {
        enableAllComponents: options.enableAllComponents !== false,
        enableDynamicScaling: options.enableDynamicScaling !== false,
        enableReuseOptimization: options.enableReuseOptimization !== false,
        enableStateManagement: options.enableStateManagement !== false,
        enableResourceMonitoring: options.enableResourceMonitoring !== false
      },
      
      // Health monitoring
      health: {
        enableHealthChecks: options.enableHealthChecks !== false,
        healthCheckInterval: options.healthCheckInterval || 60000, // 1 minute
        componentTimeout: options.componentTimeout || 30000 // 30 seconds
      },
      
      // Performance optimization
      performance: {
        enablePerformanceOptimization: options.enablePerformanceOptimization !== false,
        optimizationInterval: options.optimizationInterval || 300000, // 5 minutes
        enableCrossComponentOptimization: options.enableCrossComponentOptimization !== false
      },
      
      ...options
    };
    
    // Core components
    this.components = {
      poolManager: null,
      dynamicScaler: null,
      reuseOptimizer: null,
      stateManager: null,
      resourceMonitor: null
    };
    
    // Integration state
    this.isInitialized = false;
    this.isStarted = false;
    this.componentHealth = new Map();
    
    // Performance tracking
    this.performanceMetrics = {
      totalJobsProcessed: 0,
      avgJobDuration: 0,
      containerUtilization: 0,
      systemEfficiency: 0,
      crossComponentEvents: 0
    };
    
    // Statistics
    this.stats = {
      uptime: 0,
      startTime: null,
      componentRestarts: 0,
      healthChecks: 0,
      optimizationCycles: 0,
      lastOptimization: null
    };
    
    this.healthCheckTimer = null;
    this.optimizationTimer = null;
  }

  /**
   * Initialize all container pool components
   */
  async initialize() {
    try {
      logger.info('Initializing Integrated Container Pool Orchestrator');
      this.stats.startTime = Date.now();
      
      // Initialize core pool manager first
      await this.initializePoolManager();
      
      // Initialize optional components based on configuration
      if (this.config.integration.enableStateManagement) {
        await this.initializeStateManager();
      }
      
      if (this.config.integration.enableDynamicScaling) {
        await this.initializeDynamicScaler();
      }
      
      if (this.config.integration.enableReuseOptimization) {
        await this.initializeReuseOptimizer();
      }
      
      if (this.config.integration.enableResourceMonitoring) {
        await this.initializeResourceMonitor();
      }
      
      // Set up cross-component integration
      this.setupCrossComponentIntegration();
      
      // Start health monitoring
      if (this.config.health.enableHealthChecks) {
        this.startHealthMonitoring();
      }
      
      // Start performance optimization
      if (this.config.performance.enablePerformanceOptimization) {
        this.startPerformanceOptimization();
      }
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Integrated Container Pool Orchestrator initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Integrated Container Pool Orchestrator:', error);
      throw error;
    }
  }

  /**
   * Initialize container pool manager
   */
  async initializePoolManager() {
    try {
      this.components.poolManager = new ContainerPoolManager({
        minPoolSize: this.config.pool.minSize,
        maxPoolSize: this.config.pool.maxSize,
        targetPoolSize: this.config.pool.targetSize,
        baseImage: this.config.pool.baseImage,
        ...this.config.poolManager
      });
      
      await this.components.poolManager.initialize();
      this.componentHealth.set('poolManager', { status: 'healthy', lastCheck: new Date() });
      
      logger.info('Pool Manager component initialized');
      
    } catch (error) {
      logger.error('Failed to initialize Pool Manager:', error);
      this.componentHealth.set('poolManager', { status: 'failed', error: error.message, lastCheck: new Date() });
      throw error;
    }
  }

  /**
   * Initialize state manager
   */
  async initializeStateManager() {
    try {
      this.components.stateManager = new ContainerStateManager(
        this.components.poolManager,
        this.config.stateManager
      );
      
      this.components.stateManager.start();
      this.componentHealth.set('stateManager', { status: 'healthy', lastCheck: new Date() });
      
      logger.info('State Manager component initialized');
      
    } catch (error) {
      logger.error('Failed to initialize State Manager:', error);
      this.componentHealth.set('stateManager', { status: 'failed', error: error.message, lastCheck: new Date() });
      // Don't throw - state manager is optional
    }
  }

  /**
   * Initialize dynamic scaler
   */
  async initializeDynamicScaler() {
    try {
      this.components.dynamicScaler = new DynamicScaler(
        this.components.poolManager,
        {
          minPoolSize: this.config.pool.minSize,
          maxPoolSize: this.config.pool.maxSize,
          ...this.config.dynamicScaler
        }
      );
      
      this.components.dynamicScaler.start();
      this.componentHealth.set('dynamicScaler', { status: 'healthy', lastCheck: new Date() });
      
      logger.info('Dynamic Scaler component initialized');
      
    } catch (error) {
      logger.error('Failed to initialize Dynamic Scaler:', error);
      this.componentHealth.set('dynamicScaler', { status: 'failed', error: error.message, lastCheck: new Date() });
      // Don't throw - scaler is optional
    }
  }

  /**
   * Initialize reuse optimizer
   */
  async initializeReuseOptimizer() {
    try {
      this.components.reuseOptimizer = new ContainerReuseOptimizer(
        this.components.poolManager,
        this.config.reuseOptimizer
      );
      
      this.components.reuseOptimizer.start();
      this.componentHealth.set('reuseOptimizer', { status: 'healthy', lastCheck: new Date() });
      
      logger.info('Reuse Optimizer component initialized');
      
    } catch (error) {
      logger.error('Failed to initialize Reuse Optimizer:', error);
      this.componentHealth.set('reuseOptimizer', { status: 'failed', error: error.message, lastCheck: new Date() });
      // Don't throw - optimizer is optional
    }
  }

  /**
   * Initialize resource monitor
   */
  async initializeResourceMonitor() {
    try {
      this.components.resourceMonitor = new ContainerPoolResourceMonitor(
        this.components.poolManager,
        this.config.resourceMonitor
      );
      
      this.components.resourceMonitor.start();
      this.componentHealth.set('resourceMonitor', { status: 'healthy', lastCheck: new Date() });
      
      logger.info('Resource Monitor component initialized');
      
    } catch (error) {
      logger.error('Failed to initialize Resource Monitor:', error);
      this.componentHealth.set('resourceMonitor', { status: 'failed', error: error.message, lastCheck: new Date() });
      // Don't throw - monitor is optional
    }
  }

  /**
   * Set up cross-component integration
   */
  setupCrossComponentIntegration() {
    // State manager integration
    if (this.components.stateManager) {
      // Override pool manager's container transition methods to use state manager
      this.integratateStateManagerWithPool();
    }
    
    // Dynamic scaler integration
    if (this.components.dynamicScaler) {
      this.integrateDynamicScalerWithPool();
    }
    
    // Reuse optimizer integration
    if (this.components.reuseOptimizer) {
      this.integrateReuseOptimizerWithPool();
    }
    
    // Resource monitor integration
    if (this.components.resourceMonitor) {
      this.integrateResourceMonitorWithComponents();
    }
    
    // Cross-component event routing
    this.setupCrossComponentEventRouting();
    
    logger.info('Cross-component integration configured');
  }

  /**
   * Integrate state manager with pool manager
   */
  integratateStateManagerWithPool() {
    const stateManager = this.components.stateManager;
    const poolManager = this.components.poolManager;
    
    // Override container creation to include state tracking
    const originalCreatePoolContainer = poolManager.createPoolContainer.bind(poolManager);
    poolManager.createPoolContainer = async (templateName) => {
      const containerId = await originalCreatePoolContainer(templateName);
      await stateManager.transitionContainer(containerId, 'available', 'pool creation');
      return containerId;
    };
    
    // Override container assignment to include state tracking
    const originalGetContainer = poolManager.getContainer.bind(poolManager);
    poolManager.getContainer = async (requirements) => {
      const container = await originalGetContainer(requirements);
      if (container) {
        await stateManager.transitionContainer(container.id, 'busy', 'job assignment');
      }
      return container;
    };
    
    // Override container return to include state tracking
    const originalReturnContainer = poolManager.returnContainer.bind(poolManager);
    poolManager.returnContainer = async (containerId, jobResult) => {
      await originalReturnContainer(containerId, jobResult);
      await stateManager.transitionContainer(containerId, 'available', 'job completion');
    };
  }

  /**
   * Integrate dynamic scaler with pool manager
   */
  integrateDynamicScalerWithPool() {
    const scaler = this.components.dynamicScaler;
    const poolManager = this.components.poolManager;
    
    // Override scaler's scale up method to use pool manager
    scaler.executeScaleUp = async (count) => {
      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(poolManager.createPoolContainer());
      }
      return Promise.allSettled(promises);
    };
    
    // Override scaler's scale down method to use pool manager
    scaler.executeScaleDown = async (count) => {
      const availableContainers = Array.from(poolManager.availableContainers);
      const containersToRemove = availableContainers.slice(0, count);
      
      const promises = [];
      for (const containerId of containersToRemove) {
        promises.push(poolManager.removeContainer(containerId));
      }
      return Promise.allSettled(promises);
    };
  }

  /**
   * Integrate reuse optimizer with pool manager
   */
  integrateReuseOptimizerWithPool() {
    const optimizer = this.components.reuseOptimizer;
    const poolManager = this.components.poolManager;
    
    // Override pool manager's container selection to use optimizer
    const originalSelectBestContainer = poolManager.selectBestContainer.bind(poolManager);
    poolManager.selectBestContainer = async (requirements) => {
      const optimizedSelection = await optimizer.optimizeContainerSelection(requirements);
      return optimizedSelection || originalSelectBestContainer(requirements);
    };
    
    // Hook into job completion for optimizer learning
    const originalReturnContainer = poolManager.returnContainer.bind(poolManager);
    poolManager.returnContainer = async (containerId, jobResult) => {
      await originalReturnContainer(containerId, jobResult);
      
      // Record job completion for optimization
      if (jobResult.jobData) {
        optimizer.recordJobCompletion(containerId, jobResult.jobData, jobResult);
      }
    };
  }

  /**
   * Integrate resource monitor with other components
   */
  integrateResourceMonitorWithComponents() {
    const resourceMonitor = this.components.resourceMonitor;
    
    // Listen to resource alerts and trigger scaling decisions
    resourceMonitor.on('alertGenerated', (alert) => {
      this.handleResourceAlert(alert);
    });
    
    // Listen to optimization suggestions
    resourceMonitor.on('optimizationSuggestions', (suggestions) => {
      this.handleOptimizationSuggestions(suggestions);
    });
    
    // Listen to anomaly detection
    resourceMonitor.on('anomalyDetected', (anomaly) => {
      this.handleResourceAnomaly(anomaly);
    });
  }

  /**
   * Set up cross-component event routing
   */
  setupCrossComponentEventRouting() {
    // Route scaling events to other components
    if (this.components.dynamicScaler) {
      this.components.dynamicScaler.on('scalingCompleted', (event) => {
        this.performanceMetrics.crossComponentEvents++;
        this.emit('scalingCompleted', event);
        
        // Notify other components of scaling event
        if (this.components.resourceMonitor) {
          this.components.resourceMonitor.emit('poolScaled', event);
        }
      });
    }
    
    // Route state changes to interested components
    if (this.components.stateManager) {
      this.components.stateManager.on('stateTransitioned', (event) => {
        this.performanceMetrics.crossComponentEvents++;
        this.emit('containerStateChanged', event);
      });
    }
    
    // Route optimization events
    if (this.components.reuseOptimizer) {
      this.components.reuseOptimizer.on('optimizationCompleted', (event) => {
        this.performanceMetrics.crossComponentEvents++;
        this.emit('optimizationCompleted', event);
      });
    }
  }

  /**
   * Start the orchestrator
   */
  async start() {
    if (!this.isInitialized) {
      throw new Error('Orchestrator must be initialized before starting');
    }
    
    if (this.isStarted) {
      logger.warn('Orchestrator already started');
      return;
    }
    
    logger.info('Starting Integrated Container Pool Orchestrator');
    
    // Start all components
    for (const [name, component] of Object.entries(this.components)) {
      if (component && typeof component.start === 'function') {
        try {
          await component.start();
          logger.debug(`Started component: ${name}`);
        } catch (error) {
          logger.error(`Failed to start component ${name}:`, error);
        }
      }
    }
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Integrated Container Pool Orchestrator started successfully');
  }

  /**
   * Stop the orchestrator
   */
  async stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Integrated Container Pool Orchestrator');
    
    // Stop timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
      this.optimizationTimer = null;
    }
    
    // Stop all components in reverse order
    const componentNames = Object.keys(this.components).reverse();
    
    for (const name of componentNames) {
      const component = this.components[name];
      if (component && typeof component.stop === 'function') {
        try {
          await component.stop();
          logger.debug(`Stopped component: ${name}`);
        } catch (error) {
          logger.error(`Failed to stop component ${name}:`, error);
        }
      }
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Integrated Container Pool Orchestrator stopped');
  }

  /**
   * Get container for job assignment (main interface)
   */
  async getContainer(jobRequirements = {}) {
    if (!this.components.poolManager) {
      throw new Error('Pool manager not available');
    }
    
    try {
      const container = await this.components.poolManager.getContainer(jobRequirements);
      
      if (container) {
        this.performanceMetrics.totalJobsProcessed++;
        this.updatePerformanceMetrics();
      }
      
      return container;
      
    } catch (error) {
      logger.error('Failed to get container:', error);
      throw error;
    }
  }

  /**
   * Return container after job completion (main interface)
   */
  async returnContainer(containerId, jobResult = {}) {
    if (!this.components.poolManager) {
      throw new Error('Pool manager not available');
    }
    
    try {
      await this.components.poolManager.returnContainer(containerId, jobResult);
      
      // Update job duration statistics
      if (jobResult.duration) {
        this.updateJobDurationStats(jobResult.duration);
      }
      
      this.updatePerformanceMetrics();
      
    } catch (error) {
      logger.error('Failed to return container:', error);
      throw error;
    }
  }

  /**
   * Handle resource alerts from monitor
   */
  handleResourceAlert(alert) {
    logger.warn(`Resource alert received: ${alert.severity} - ${alert.message}`);
    
    // Take action based on alert severity and type
    if (alert.severity === 'critical') {
      this.handleCriticalResourceAlert(alert);
    } else if (alert.severity === 'warning') {
      this.handleWarningResourceAlert(alert);
    }
    
    this.emit('resourceAlert', alert);
  }

  /**
   * Handle critical resource alerts
   */
  async handleCriticalResourceAlert(alert) {
    try {
      if (alert.resourceKey.includes('cpu') || alert.resourceKey.includes('memory')) {
        // Scale down pool to reduce resource pressure
        if (this.components.dynamicScaler) {
          logger.info('Triggering emergency scale down due to critical resource alert');
          await this.components.dynamicScaler.executeScaleDown(2);
        }
      }
    } catch (error) {
      logger.error('Failed to handle critical resource alert:', error);
    }
  }

  /**
   * Handle warning resource alerts
   */
  async handleWarningResourceAlert(alert) {
    try {
      if (alert.resourceKey.includes('system')) {
        // Consider optimizing container pool
        if (this.components.reuseOptimizer) {
          logger.info('Triggering optimization due to resource warning');
          await this.components.reuseOptimizer.optimizeContainerReuse();
        }
      }
    } catch (error) {
      logger.error('Failed to handle warning resource alert:', error);
    }
  }

  /**
   * Handle optimization suggestions
   */
  async handleOptimizationSuggestions(suggestions) {
    for (const suggestion of suggestions) {
      try {
        await this.executeOptimizationSuggestion(suggestion);
      } catch (error) {
        logger.error(`Failed to execute optimization suggestion:`, error);
      }
    }
  }

  /**
   * Execute optimization suggestion
   */
  async executeOptimizationSuggestion(suggestion) {
    logger.info(`Executing optimization: ${suggestion.title}`);
    
    switch (suggestion.action) {
      case 'scale_down_pool':
        if (this.components.dynamicScaler) {
          await this.components.dynamicScaler.executeScaleDown(1);
        }
        break;
        
      case 'scale_up_pool':
        if (this.components.dynamicScaler) {
          await this.components.dynamicScaler.executeScaleUp(1);
        }
        break;
        
      case 'recycle_container':
        if (suggestion.metadata.containerId && this.components.poolManager) {
          await this.components.poolManager.recycleContainer(suggestion.metadata.containerId);
        }
        break;
        
      case 'optimize_memory':
        // Trigger container cleanup and optimization
        if (this.components.reuseOptimizer) {
          await this.components.reuseOptimizer.optimizeContainerReuse();
        }
        break;
    }
    
    this.stats.optimizationCycles++;
  }

  /**
   * Handle resource anomalies
   */
  handleResourceAnomaly(anomaly) {
    logger.warn(`Resource anomaly detected: ${anomaly.description}`);
    
    if (anomaly.severity === 'high') {
      // Take immediate action for high severity anomalies
      this.handleHighSeverityAnomaly(anomaly);
    }
    
    this.emit('resourceAnomaly', anomaly);
  }

  /**
   * Handle high severity anomalies
   */
  async handleHighSeverityAnomaly(anomaly) {
    try {
      if (anomaly.resourceKey.includes('container')) {
        // Extract container ID from resource key
        const containerIdMatch = anomaly.resourceKey.match(/container_.*_(.+)/);
        if (containerIdMatch && this.components.poolManager) {
          const containerId = containerIdMatch[1];
          logger.info(`Recycling container due to anomaly: ${containerId.substring(0, 12)}`);
          await this.components.poolManager.recycleContainer(containerId);
        }
      }
    } catch (error) {
      logger.error('Failed to handle high severity anomaly:', error);
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
    }, this.config.health.healthCheckInterval);
    
    logger.info('Health monitoring started');
  }

  /**
   * Perform health check on all components
   */
  async performHealthCheck() {
    this.stats.healthChecks++;
    
    for (const [name, component] of Object.entries(this.components)) {
      if (!component) continue;
      
      try {
        let isHealthy = true;
        let status = 'healthy';
        let details = {};
        
        // Check if component has health check method
        if (typeof component.getStatus === 'function') {
          const componentStatus = component.getStatus();
          details = componentStatus;
          
          // Determine health based on component status
          if (componentStatus.isStarted === false) {
            isHealthy = false;
            status = 'stopped';
          }
        } else if (typeof component.getStats === 'function') {
          details = component.getStats();
        }
        
        this.componentHealth.set(name, {
          status,
          isHealthy,
          details,
          lastCheck: new Date()
        });
        
        // Restart unhealthy components if needed
        if (!isHealthy && this.config.health.enableAutoRestart) {
          await this.restartComponent(name);
        }
        
      } catch (error) {
        logger.error(`Health check failed for component ${name}:`, error);
        
        this.componentHealth.set(name, {
          status: 'unhealthy',
          isHealthy: false,
          error: error.message,
          lastCheck: new Date()
        });
      }
    }
    
    this.emit('healthCheckCompleted', {
      components: Object.fromEntries(this.componentHealth),
      timestamp: new Date()
    });
  }

  /**
   * Restart component
   */
  async restartComponent(componentName) {
    try {
      logger.warn(`Restarting component: ${componentName}`);
      
      const component = this.components[componentName];
      if (!component) return;
      
      // Stop component
      if (typeof component.stop === 'function') {
        await component.stop();
      }
      
      // Start component
      if (typeof component.start === 'function') {
        await component.start();
      }
      
      this.stats.componentRestarts++;
      
      logger.info(`Component restarted successfully: ${componentName}`);
      
    } catch (error) {
      logger.error(`Failed to restart component ${componentName}:`, error);
    }
  }

  /**
   * Start performance optimization
   */
  startPerformanceOptimization() {
    this.optimizationTimer = setInterval(() => {
      this.performPerformanceOptimization().catch(error => {
        logger.error('Performance optimization failed:', error);
      });
    }, this.config.performance.optimizationInterval);
    
    logger.info('Performance optimization started');
  }

  /**
   * Perform cross-component performance optimization
   */
  async performPerformanceOptimization() {
    try {
      this.stats.lastOptimization = new Date();
      
      // Gather performance data from all components
      const performanceData = this.gatherPerformanceData();
      
      // Analyze cross-component performance
      const optimizations = this.analyzeCrossComponentPerformance(performanceData);
      
      // Execute optimizations
      for (const optimization of optimizations) {
        await this.executePerformanceOptimization(optimization);
      }
      
      this.stats.optimizationCycles++;
      
    } catch (error) {
      logger.error('Performance optimization failed:', error);
    }
  }

  /**
   * Gather performance data from all components
   */
  gatherPerformanceData() {
    const data = {
      timestamp: new Date(),
      pool: null,
      scaling: null,
      optimization: null,
      state: null,
      resources: null
    };
    
    if (this.components.poolManager) {
      data.pool = this.components.poolManager.getPoolStatus();
    }
    
    if (this.components.dynamicScaler) {
      data.scaling = this.components.dynamicScaler.getScalingStats();
    }
    
    if (this.components.reuseOptimizer) {
      data.optimization = this.components.reuseOptimizer.getReuseStats();
    }
    
    if (this.components.stateManager) {
      data.state = this.components.stateManager.getStateStats();
    }
    
    if (this.components.resourceMonitor) {
      data.resources = this.components.resourceMonitor.getMonitoringStats();
    }
    
    return data;
  }

  /**
   * Analyze cross-component performance
   */
  analyzeCrossComponentPerformance(data) {
    const optimizations = [];
    
    // Analyze pool utilization vs scaling behavior
    if (data.pool && data.scaling) {
      if (data.pool.stats.poolUtilization > 90 && !data.scaling.isScaling) {
        optimizations.push({
          type: 'scaling',
          action: 'trigger_scale_up',
          reason: 'High utilization detected but no scaling in progress'
        });
      }
    }
    
    // Analyze reuse efficiency vs pool size
    if (data.pool && data.optimization) {
      if (data.optimization.stats.avgReuseEfficiency < 0.7 && data.pool.poolSize > data.pool.config.minSize) {
        optimizations.push({
          type: 'optimization',
          action: 'aggressive_recycling',
          reason: 'Low reuse efficiency detected'
        });
      }
    }
    
    // Analyze state consistency
    if (data.state) {
      if (data.state.metrics.invalidTransitionAttempts > 10) {
        optimizations.push({
          type: 'state',
          action: 'state_validation',
          reason: 'High number of invalid state transitions'
        });
      }
    }
    
    return optimizations;
  }

  /**
   * Execute performance optimization
   */
  async executePerformanceOptimization(optimization) {
    logger.info(`Executing performance optimization: ${optimization.action} - ${optimization.reason}`);
    
    switch (optimization.action) {
      case 'trigger_scale_up':
        if (this.components.dynamicScaler) {
          await this.components.dynamicScaler.executeScaleUp(1);
        }
        break;
        
      case 'aggressive_recycling':
        if (this.components.reuseOptimizer) {
          await this.components.reuseOptimizer.optimizeContainerReuse();
        }
        break;
        
      case 'state_validation':
        if (this.components.stateManager) {
          await this.components.stateManager.validateContainerStates();
        }
        break;
    }
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics() {
    if (this.components.poolManager) {
      const poolStatus = this.components.poolManager.getPoolStatus();
      this.performanceMetrics.containerUtilization = poolStatus.stats.poolUtilization;
    }
    
    // Calculate system efficiency (simplified metric)
    this.performanceMetrics.systemEfficiency = 
      (this.performanceMetrics.containerUtilization + 
       (this.performanceMetrics.totalJobsProcessed > 0 ? 100 : 0)) / 2;
  }

  /**
   * Update job duration statistics
   */
  updateJobDurationStats(duration) {
    const currentAvg = this.performanceMetrics.avgJobDuration;
    const jobCount = this.performanceMetrics.totalJobsProcessed;
    
    this.performanceMetrics.avgJobDuration = jobCount > 1 ?
      ((currentAvg * (jobCount - 1)) + duration) / jobCount :
      duration;
  }

  /**
   * Get orchestrator status
   */
  getOrchestratorStatus() {
    return {
      isInitialized: this.isInitialized,
      isStarted: this.isStarted,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
      stats: this.stats,
      performanceMetrics: this.performanceMetrics,
      componentHealth: Object.fromEntries(this.componentHealth),
      components: {
        poolManager: this.components.poolManager?.getPoolStatus(),
        dynamicScaler: this.components.dynamicScaler?.getScalingStats(),
        reuseOptimizer: this.components.reuseOptimizer?.getReuseStats(),
        stateManager: this.components.stateManager?.getStateStats(),
        resourceMonitor: this.components.resourceMonitor?.getMonitoringStats()
      },
      config: {
        integration: this.config.integration,
        pool: this.config.pool,
        health: this.config.health,
        performance: this.config.performance
      }
    };
  }

  /**
   * Get container pool summary
   */
  getPoolSummary() {
    if (!this.components.poolManager) {
      return null;
    }
    
    const poolStatus = this.components.poolManager.getPoolStatus();
    const summary = {
      timestamp: new Date(),
      poolSize: poolStatus.poolSize,
      availableContainers: poolStatus.availableContainers,
      busyContainers: poolStatus.busyContainers,
      utilization: poolStatus.stats.poolUtilization,
      totalJobsProcessed: this.performanceMetrics.totalJobsProcessed,
      avgJobDuration: this.performanceMetrics.avgJobDuration,
      systemEfficiency: this.performanceMetrics.systemEfficiency
    };
    
    // Add component-specific data if available
    if (this.components.dynamicScaler) {
      const scalingStats = this.components.dynamicScaler.getScalingStats();
      summary.scaling = {
        isScaling: scalingStats.isScaling,
        totalScaleUps: scalingStats.stats.totalScaleUps,
        totalScaleDowns: scalingStats.stats.totalScaleDowns
      };
    }
    
    if (this.components.resourceMonitor) {
      const resourceStats = this.components.resourceMonitor.getCurrentResourceSummary();
      summary.resources = {
        systemCpu: resourceStats.system?.cpu?.usage,
        systemMemory: resourceStats.system?.memory?.usage,
        activeAlerts: resourceStats.alerts?.active
      };
    }
    
    return summary;
  }
}

module.exports = IntegratedContainerPoolOrchestrator;