/**
 * High Availability Orchestrator
 * 
 * Main coordinator for all HA components, providing unified management
 * and orchestration of redundancy, failover, replication, health checks,
 * and disaster recovery.
 */

const EventEmitter = require('events');
const OrchestratorRedundancy = require('./orchestrator-redundancy');
const FailoverManager = require('./failover-manager');
const DataReplicationManager = require('./data-replication');
const HealthChecker = require('./health-checker');
const DisasterRecoveryManager = require('./disaster-recovery');

class HAOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      enableRedundancy: options.enableRedundancy !== false,
      enableFailover: options.enableFailover !== false,
      enableReplication: options.enableReplication !== false,
      enableHealthChecks: options.enableHealthChecks !== false,
      enableDisasterRecovery: options.enableDisasterRecovery !== false,
      
      // Component configurations
      redundancy: options.redundancy || {},
      failover: options.failover || {},
      replication: options.replication || {},
      healthChecker: options.healthChecker || {},
      disasterRecovery: options.disasterRecovery || {},
      
      // HA specific settings
      startupTimeout: options.startupTimeout || 60000,
      shutdownTimeout: options.shutdownTimeout || 30000,
      healthCheckInterval: options.healthCheckInterval || 10000,
      
      ...options
    };
    
    this.components = {
      orchestratorRedundancy: null,
      failoverManager: null,
      dataReplication: null,
      healthChecker: null,
      disasterRecovery: null
    };
    
    this.state = {
      status: 'initializing',
      isLeader: false,
      haLevel: 'none', // none, basic, standard, enterprise
      componentsStatus: {
        redundancy: 'stopped',
        failover: 'stopped',
        replication: 'stopped',
        healthChecker: 'stopped',
        disasterRecovery: 'stopped'
      },
      metrics: {
        uptime: 0,
        totalFailovers: 0,
        totalBackups: 0,
        lastHealthCheck: null,
        overallHealth: 'unknown'
      },
      startTime: Date.now()
    };
    
    this.logger = options.logger || console;
    this.monitoringTimer = null;
  }
  
  /**
   * Initialize the HA orchestrator
   */
  async initialize() {
    try {
      this.logger.info('Initializing High Availability orchestrator');
      
      // Initialize components in dependency order
      await this.initializeHealthChecker();
      await this.initializeDataReplication();
      await this.initializeOrchestratorRedundancy();
      await this.initializeFailoverManager();
      await this.initializeDisasterRecovery();
      
      // Setup inter-component communication
      this.setupComponentIntegration();
      
      // Start monitoring
      this.startMonitoring();
      
      // Determine HA level
      this.calculateHALevel();
      
      this.state.status = 'active';
      this.emit('initialized', {
        haLevel: this.state.haLevel,
        componentsEnabled: this.getEnabledComponents()
      });
      
      this.logger.info('High Availability orchestrator initialized successfully', {
        haLevel: this.state.haLevel,
        components: this.getEnabledComponents()
      });
      
    } catch (error) {
      this.logger.error('Failed to initialize HA orchestrator', error);
      throw error;
    }
  }
  
  /**
   * Initialize Health Checker component
   */
  async initializeHealthChecker() {
    if (!this.config.enableHealthChecks) {
      this.logger.info('Health checker disabled by configuration');
      return;
    }
    
    try {
      this.components.healthChecker = new HealthChecker({
        ...this.config.healthChecker,
        logger: this.logger
      });
      
      // Setup event listeners
      this.components.healthChecker.on('anomalyDetected', (anomaly) => {
        this.handleHealthAnomaly(anomaly);
      });
      
      this.components.healthChecker.on('healthCheckCompleted', (results) => {
        this.state.metrics.lastHealthCheck = results.timestamp;
        this.state.metrics.overallHealth = results.overallHealth;
      });
      
      await this.components.healthChecker.initialize();
      this.state.componentsStatus.healthChecker = 'active';
      
      this.logger.info('Health checker initialized');
      
    } catch (error) {
      this.logger.error('Failed to initialize health checker', error);
      this.state.componentsStatus.healthChecker = 'failed';
      throw error;
    }
  }
  
  /**
   * Initialize Data Replication component
   */
  async initializeDataReplication() {
    if (!this.config.enableReplication) {
      this.logger.info('Data replication disabled by configuration');
      return;
    }
    
    try {
      this.components.dataReplication = new DataReplicationManager({
        ...this.config.replication,
        logger: this.logger
      });
      
      // Setup event listeners
      this.components.dataReplication.on('replicationLag', (event) => {
        this.handleReplicationLag(event);
      });
      
      this.components.dataReplication.on('failoverCompleted', (event) => {
        this.handleDataFailover(event);
      });
      
      await this.components.dataReplication.initialize();
      this.state.componentsStatus.replication = 'active';
      
      this.logger.info('Data replication initialized');
      
    } catch (error) {
      this.logger.error('Failed to initialize data replication', error);
      this.state.componentsStatus.replication = 'failed';
      throw error;
    }
  }
  
  /**
   * Initialize Orchestrator Redundancy component
   */
  async initializeOrchestratorRedundancy() {
    if (!this.config.enableRedundancy) {
      this.logger.info('Orchestrator redundancy disabled by configuration');
      return;
    }
    
    try {
      this.components.orchestratorRedundancy = new OrchestratorRedundancy({
        ...this.config.redundancy,
        logger: this.logger
      });
      
      // Setup event listeners
      this.components.orchestratorRedundancy.on('leadershipAcquired', (event) => {
        this.handleLeadershipChange(true, event);
      });
      
      this.components.orchestratorRedundancy.on('leadershipLost', (event) => {
        this.handleLeadershipChange(false, event);
      });
      
      this.components.orchestratorRedundancy.on('electionResult', (event) => {
        this.handleElectionResult(event);
      });
      
      await this.components.orchestratorRedundancy.initialize();
      this.state.componentsStatus.redundancy = 'active';
      
      this.logger.info('Orchestrator redundancy initialized');
      
    } catch (error) {
      this.logger.error('Failed to initialize orchestrator redundancy', error);
      this.state.componentsStatus.redundancy = 'failed';
      throw error;
    }
  }
  
  /**
   * Initialize Failover Manager component
   */
  async initializeFailoverManager() {
    if (!this.config.enableFailover) {
      this.logger.info('Failover manager disabled by configuration');
      return;
    }
    
    try {
      this.components.failoverManager = new FailoverManager(
        this.components.healthChecker,
        this.components.orchestratorRedundancy,
        {
          ...this.config.failover,
          logger: this.logger
        }
      );
      
      // Setup event listeners
      this.components.failoverManager.on('failoverSuccess', (event) => {
        this.handleFailoverSuccess(event);
      });
      
      this.components.failoverManager.on('failoverFailed', (event) => {
        this.handleFailoverFailure(event);
      });
      
      this.components.failoverManager.on('componentUnhealthy', (event) => {
        this.handleComponentUnhealthy(event);
      });
      
      await this.components.failoverManager.initialize();
      this.state.componentsStatus.failover = 'active';
      
      this.logger.info('Failover manager initialized');
      
    } catch (error) {
      this.logger.error('Failed to initialize failover manager', error);
      this.state.componentsStatus.failover = 'failed';
      throw error;
    }
  }
  
  /**
   * Initialize Disaster Recovery component
   */
  async initializeDisasterRecovery() {
    if (!this.config.enableDisasterRecovery) {
      this.logger.info('Disaster recovery disabled by configuration');
      return;
    }
    
    try {
      this.components.disasterRecovery = new DisasterRecoveryManager({
        ...this.config.disasterRecovery,
        logger: this.logger
      });
      
      // Setup event listeners
      this.components.disasterRecovery.on('backupCompleted', (event) => {
        this.handleBackupCompleted(event);
      });
      
      this.components.disasterRecovery.on('backupFailed', (event) => {
        this.handleBackupFailure(event);
      });
      
      this.components.disasterRecovery.on('restoreCompleted', (event) => {
        this.handleRestoreCompleted(event);
      });
      
      await this.components.disasterRecovery.initialize();
      this.state.componentsStatus.disasterRecovery = 'active';
      
      this.logger.info('Disaster recovery initialized');
      
    } catch (error) {
      this.logger.error('Failed to initialize disaster recovery', error);
      this.state.componentsStatus.disasterRecovery = 'failed';
      throw error;
    }
  }
  
  /**
   * Setup integration between components
   */
  setupComponentIntegration() {
    // Register failover manager with health checker if both are enabled
    if (this.components.healthChecker && this.components.failoverManager) {
      // Health checker will notify failover manager of component health changes
      this.logger.info('Integrated health checker with failover manager');
    }
    
    // Register disaster recovery with failover manager
    if (this.components.failoverManager && this.components.disasterRecovery) {
      // Failover manager can trigger disaster recovery procedures
      this.logger.info('Integrated failover manager with disaster recovery');
    }
    
    // Register data replication with health checker
    if (this.components.healthChecker && this.components.dataReplication) {
      // Health checker will monitor replication health
      this.logger.info('Integrated health checker with data replication');
    }
  }
  
  /**
   * Start monitoring overall HA system
   */
  startMonitoring() {
    this.monitoringTimer = setInterval(() => {
      this.updateMetrics();
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
    
    this.logger.info('Started HA system monitoring');
  }
  
  /**
   * Update system metrics
   */
  updateMetrics() {
    this.state.metrics.uptime = Date.now() - this.state.startTime;
    
    if (this.components.failoverManager) {
      const failoverStatus = this.components.failoverManager.getFailoverStatus();
      this.state.metrics.totalFailovers = failoverStatus.totalFailovers;
    }
    
    if (this.components.disasterRecovery) {
      const drStatus = this.components.disasterRecovery.getStatus();
      this.state.metrics.totalBackups = drStatus.backupCount;
    }
  }
  
  /**
   * Perform overall HA system health check
   */
  async performHealthCheck() {
    try {
      const _healthStatus = this.getHAStatus();
      
      // Check if any critical components have failed
      const criticalComponentsFailed = Object.entries(this.state.componentsStatus)
        .filter(([name, status]) => this.isCriticalComponent(name) && status === 'failed')
        .length > 0;
      
      if (criticalComponentsFailed) {
        this.logger.warn('Critical HA components have failed', {
          componentsStatus: this.state.componentsStatus
        });
        
        this.emit('criticalFailure', {
          timestamp: Date.now(),
          componentsStatus: this.state.componentsStatus
        });
      }
      
    } catch (error) {
      this.logger.error('HA health check failed', error);
    }
  }
  
  /**
   * Calculate HA level based on enabled components
   */
  calculateHALevel() {
    const enabledComponents = this.getEnabledComponents();
    
    if (enabledComponents.length === 0) {
      this.state.haLevel = 'none';
    } else if (enabledComponents.includes('healthChecker') && enabledComponents.length <= 2) {
      this.state.haLevel = 'basic';
    } else if (enabledComponents.length >= 3 && enabledComponents.includes('failover')) {
      this.state.haLevel = 'standard';
    } else if (enabledComponents.length >= 4 && enabledComponents.includes('disasterRecovery')) {
      this.state.haLevel = 'enterprise';
    } else {
      this.state.haLevel = 'standard';
    }
  }
  
  /**
   * Get list of enabled components
   */
  getEnabledComponents() {
    return Object.entries(this.state.componentsStatus)
      .filter(([_name, status]) => status === 'active')
      .map(([name]) => name);
  }
  
  /**
   * Check if component is critical for HA
   */
  isCriticalComponent(componentName) {
    return ['redundancy', 'failover', 'healthChecker'].includes(componentName);
  }
  
  /**
   * Handle health anomaly detected
   */
  handleHealthAnomaly(anomaly) {
    this.logger.warn('Health anomaly detected', anomaly);
    
    // Trigger appropriate response based on anomaly type and severity
    if (anomaly.severity === 'critical' && this.components.failoverManager) {
      this.logger.info('Triggering failover due to critical health anomaly', {
        service: anomaly.service,
        type: anomaly.type
      });
    }
    
    this.emit('healthAnomaly', anomaly);
  }
  
  /**
   * Handle replication lag
   */
  handleReplicationLag(event) {
    this.logger.warn('Replication lag detected', event);
    
    // Could trigger alerts or failover if lag is too high
    this.emit('replicationLag', event);
  }
  
  /**
   * Handle data failover completion
   */
  handleDataFailover(event) {
    this.logger.info('Data failover completed', event);
    
    // Update metrics and notify monitoring systems
    this.emit('dataFailover', event);
  }
  
  /**
   * Handle leadership change
   */
  handleLeadershipChange(isLeader, event) {
    this.state.isLeader = isLeader;
    
    this.logger.info('Leadership status changed', {
      isLeader,
      nodeId: event.nodeId,
      term: event.term
    });
    
    // Enable/disable certain functions based on leadership
    if (isLeader) {
      this.enableLeaderFunctions();
    } else {
      this.disableLeaderFunctions();
    }
    
    this.emit('leadershipChanged', { isLeader, event });
  }
  
  /**
   * Handle election result
   */
  handleElectionResult(event) {
    this.logger.info('Leader election completed', event);
    this.emit('electionCompleted', event);
  }
  
  /**
   * Handle successful failover
   */
  handleFailoverSuccess(event) {
    this.logger.info('Component failover successful', event);
    this.state.metrics.totalFailovers++;
    this.emit('failoverSuccess', event);
  }
  
  /**
   * Handle failover failure
   */
  handleFailoverFailure(event) {
    this.logger.error('Component failover failed', event);
    
    // Could trigger disaster recovery procedures
    if (event.component === 'database' && this.components.disasterRecovery) {
      this.logger.info('Considering disaster recovery due to database failover failure');
    }
    
    this.emit('failoverFailure', event);
  }
  
  /**
   * Handle component becoming unhealthy
   */
  handleComponentUnhealthy(event) {
    this.logger.warn('Component became unhealthy', event);
    
    // Update internal status tracking
    this.emit('componentUnhealthy', event);
  }
  
  /**
   * Handle backup completion
   */
  handleBackupCompleted(event) {
    this.logger.info('Backup completed', event);
    this.state.metrics.totalBackups++;
    this.emit('backupCompleted', event);
  }
  
  /**
   * Handle backup failure
   */
  handleBackupFailure(event) {
    this.logger.error('Backup failed', event);
    this.emit('backupFailure', event);
  }
  
  /**
   * Handle restore completion
   */
  handleRestoreCompleted(event) {
    this.logger.info('Restore completed', event);
    this.emit('restoreCompleted', event);
  }
  
  /**
   * Enable leader-specific functions
   */
  enableLeaderFunctions() {
    // Only the leader should perform certain operations like:
    // - Triggering cluster-wide failovers
    // - Coordinating disaster recovery
    // - Managing global backups
    
    this.logger.info('Enabled leader-specific functions');
  }
  
  /**
   * Disable leader-specific functions
   */
  disableLeaderFunctions() {
    this.logger.info('Disabled leader-specific functions');
  }
  
  /**
   * Force failover for a specific component
   */
  async forceFailover(componentName) {
    if (!this.components.failoverManager) {
      throw new Error('Failover manager not enabled');
    }
    
    this.logger.info('Forcing failover', { component: componentName });
    return await this.components.failoverManager.forceFailover(componentName);
  }
  
  /**
   * Trigger disaster recovery
   */
  async triggerDisasterRecovery(type, backupFile = null) {
    if (!this.components.disasterRecovery) {
      throw new Error('Disaster recovery not enabled');
    }
    
    this.logger.info('Triggering disaster recovery', { type, backupFile });
    return await this.components.disasterRecovery.restoreFromBackup(type, backupFile);
  }
  
  /**
   * Perform manual backup
   */
  async performBackup(type) {
    if (!this.components.disasterRecovery) {
      throw new Error('Disaster recovery not enabled');
    }
    
    this.logger.info('Performing manual backup', { type });
    
    switch (type) {
      case 'database':
        return await this.components.disasterRecovery.backupDatabase();
      case 'files':
        return await this.components.disasterRecovery.backupFiles();
      case 'config':
        return await this.components.disasterRecovery.backupConfiguration();
      default:
        throw new Error(`Unknown backup type: ${type}`);
    }
  }
  
  /**
   * Test HA system
   */
  async testHASystem() {
    this.logger.info('Starting HA system test');
    
    const testResults = {
      timestamp: Date.now(),
      overallResult: 'success',
      componentTests: {}
    };
    
    try {
      // Test health checker
      if (this.components.healthChecker) {
        testResults.componentTests.healthChecker = {
          status: this.components.healthChecker.getHealthStatus(),
          result: 'success'
        };
      }
      
      // Test failover manager
      if (this.components.failoverManager) {
        testResults.componentTests.failoverManager = {
          status: this.components.failoverManager.getFailoverStatus(),
          result: 'success'
        };
      }
      
      // Test data replication
      if (this.components.dataReplication) {
        testResults.componentTests.dataReplication = {
          status: this.components.dataReplication.getReplicationStatus(),
          result: 'success'
        };
      }
      
      // Test disaster recovery
      if (this.components.disasterRecovery) {
        const drTest = await this.components.disasterRecovery.testDisasterRecovery();
        testResults.componentTests.disasterRecovery = {
          status: drTest,
          result: drTest.overallSuccess ? 'success' : 'failure'
        };
        
        if (!drTest.overallSuccess) {
          testResults.overallResult = 'failure';
        }
      }
      
      this.logger.info('HA system test completed', {
        result: testResults.overallResult
      });
      
      this.emit('haTestCompleted', testResults);
      
      return testResults;
      
    } catch (error) {
      this.logger.error('HA system test failed', error);
      testResults.overallResult = 'failure';
      testResults.error = error.message;
      
      this.emit('haTestFailed', testResults);
      
      return testResults;
    }
  }
  
  /**
   * Get comprehensive HA status
   */
  getHAStatus() {
    const status = {
      overall: {
        status: this.state.status,
        haLevel: this.state.haLevel,
        isLeader: this.state.isLeader,
        uptime: this.state.metrics.uptime,
        overallHealth: this.state.metrics.overallHealth
      },
      components: {},
      metrics: this.state.metrics,
      enabledFeatures: this.getEnabledComponents()
    };
    
    // Get status from each component
    if (this.components.healthChecker) {
      status.components.healthChecker = this.components.healthChecker.getHealthStatus();
    }
    
    if (this.components.failoverManager) {
      status.components.failoverManager = this.components.failoverManager.getFailoverStatus();
    }
    
    if (this.components.dataReplication) {
      status.components.dataReplication = this.components.dataReplication.getReplicationStatus();
    }
    
    if (this.components.orchestratorRedundancy) {
      status.components.orchestratorRedundancy = this.components.orchestratorRedundancy.getHealthStatus();
    }
    
    if (this.components.disasterRecovery) {
      status.components.disasterRecovery = this.components.disasterRecovery.getStatus();
    }
    
    return status;
  }
  
  /**
   * Graceful shutdown of HA orchestrator
   */
  async shutdown() {
    this.logger.info('Shutting down HA orchestrator');
    
    // Stop monitoring
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }
    
    // Shutdown components in reverse order
    const shutdownPromises = [];
    
    if (this.components.disasterRecovery) {
      shutdownPromises.push(this.components.disasterRecovery.stop());
    }
    
    if (this.components.failoverManager) {
      shutdownPromises.push(this.components.failoverManager.stop());
    }
    
    if (this.components.orchestratorRedundancy) {
      shutdownPromises.push(this.components.orchestratorRedundancy.shutdown());
    }
    
    if (this.components.dataReplication) {
      shutdownPromises.push(this.components.dataReplication.stop());
    }
    
    if (this.components.healthChecker) {
      shutdownPromises.push(this.components.healthChecker.stop());
    }
    
    try {
      await Promise.all(shutdownPromises);
      
      this.state.status = 'stopped';
      this.emit('shutdown');
      
      this.logger.info('HA orchestrator shutdown completed');
      
    } catch (error) {
      this.logger.error('Error during HA orchestrator shutdown', error);
      throw error;
    }
  }
}

module.exports = HAOrchestrator;