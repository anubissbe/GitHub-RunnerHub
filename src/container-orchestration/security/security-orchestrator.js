/**
 * Security Orchestrator
 * Central coordinator for all security components in the GitHub RunnerHub system
 * Provides unified security management and policy enforcement
 */

const EventEmitter = require('events');
const NetworkIsolationManager = require('./network-isolation');
const ResourceQuotaManager = require('./resource-quotas');
const SecretManagementSystem = require('./secret-management');
const ContainerSecurityScanner = require('./container-scanner');
const AuditLogger = require('./audit-logger');
const RBACSystem = require('./rbac');
const RuntimeSecurityMonitor = require('./runtime-monitor');
const logger = require('../../utils/logger');

class SecurityOrchestrator extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    
    this.config = {
      // Security levels
      securityLevel: options.securityLevel || 'high', // 'low', 'medium', 'high', 'paranoid'
      
      // Component configuration
      components: {
        networkIsolation: options.networkIsolation !== false,
        resourceQuotas: options.resourceQuotas !== false,
        secretManagement: options.secretManagement !== false,
        containerScanning: options.containerScanning !== false,
        auditLogging: options.auditLogging !== false,
        rbac: options.rbac !== false,
        runtimeMonitoring: options.runtimeMonitoring !== false
      },
      
      // Security policies
      policies: {
        enforceNetworkIsolation: options.enforceNetworkIsolation !== false,
        enforceResourceLimits: options.enforceResourceLimits !== false,
        requireContainerScanning: options.requireContainerScanning !== false,
        blockOnSecurityFailure: options.blockOnSecurityFailure !== false,
        requireAuthentication: options.requireAuthentication !== false,
        enforceSecretEncryption: options.enforceSecretEncryption !== false
      },
      
      // Integration settings
      integration: {
        webhookUrl: options.webhookUrl,
        slackWebhook: options.slackWebhook,
        emailAlerts: options.emailAlerts || []
      },
      
      ...options
    };
    
    // Security components
    this.components = {};
    
    // Security state
    this.securityState = {
      overallStatus: 'initializing',
      componentStatus: {},
      activeThreats: 0,
      securityScore: 100
    };
    
    // Job security contexts
    this.jobSecurityContexts = new Map(); // jobId -> securityContext
    
    // Statistics
    this.stats = {
      jobsProcessed: 0,
      jobsBlocked: 0,
      threatsDetected: 0,
      threatsBlocked: 0,
      securityScans: 0,
      auditEvents: 0
    };
    
    this.isInitialized = false;
  }

  /**
   * Initialize the security orchestrator
   */
  async initialize() {
    try {
      logger.info('Initializing Security Orchestrator');
      
      // Initialize audit logger first (needed by other components)
      if (this.config.components.auditLogging) {
        this.components.auditLogger = new AuditLogger(this.config.auditLogger);
        await this.components.auditLogger.initialize();
        this.setupAuditLoggerHandlers();
      }
      
      // Initialize RBAC
      if (this.config.components.rbac) {
        this.components.rbac = new RBACSystem(this.components.auditLogger, this.config.rbac);
        await this.components.rbac.initialize();
        this.setupRBACHandlers();
      }
      
      // Initialize network isolation
      if (this.config.components.networkIsolation) {
        this.components.networkIsolation = new NetworkIsolationManager(this.dockerAPI, this.config.networkIsolation);
        await this.components.networkIsolation.initialize();
        this.setupNetworkHandlers();
      }
      
      // Initialize resource quotas
      if (this.config.components.resourceQuotas) {
        this.components.resourceQuotas = new ResourceQuotaManager(this.dockerAPI, this.config.resourceQuotas);
        await this.components.resourceQuotas.initialize();
        this.setupResourceHandlers();
      }
      
      // Initialize secret management
      if (this.config.components.secretManagement) {
        this.components.secretManagement = new SecretManagementSystem(this.config.secretManagement);
        await this.components.secretManagement.initialize();
        this.setupSecretHandlers();
      }
      
      // Initialize container scanning
      if (this.config.components.containerScanning) {
        this.components.containerScanner = new ContainerSecurityScanner(this.dockerAPI, this.config.containerScanner);
        await this.components.containerScanner.initialize();
        this.setupScannerHandlers();
      }
      
      // Initialize runtime monitoring
      if (this.config.components.runtimeMonitoring) {
        this.components.runtimeMonitor = new RuntimeSecurityMonitor(
          this.dockerAPI, 
          this.components.auditLogger,
          this.config.runtimeMonitor
        );
        await this.components.runtimeMonitor.initialize();
        this.setupMonitorHandlers();
      }
      
      // Update security state
      this.updateSecurityState();
      
      // Log initialization
      await this.logSecurityEvent('security_orchestrator_initialized', {
        components: Object.keys(this.components),
        securityLevel: this.config.securityLevel
      });
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Security Orchestrator initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Security Orchestrator:', error);
      throw error;
    }
  }

  /**
   * Create security context for a job
   */
  async createJobSecurityContext(jobId, jobConfig) {
    try {
      logger.info(`Creating security context for job ${jobId}`);
      
      const context = {
        jobId,
        repository: jobConfig.repository,
        userId: jobConfig.userId,
        createdAt: new Date(),
        state: 'initializing',
        
        // Security components
        network: null,
        resources: null,
        secrets: [],
        scanning: null,
        monitoring: null,
        
        // Security checks
        checks: {
          authentication: false,
          authorization: false,
          scanning: false,
          resourceAllocation: false,
          networkIsolation: false
        },
        
        // Threats and violations
        threats: [],
        violations: []
      };
      
      // Check authentication and authorization
      if (this.config.policies.requireAuthentication && this.components.rbac) {
        context.checks.authentication = await this.authenticateUser(jobConfig.userId);
        context.checks.authorization = await this.authorizeJob(jobConfig.userId, jobConfig);
        
        if (!context.checks.authentication || !context.checks.authorization) {
          context.state = 'blocked';
          await this.blockJob(jobId, 'Authentication/Authorization failed');
          return context;
        }
      }
      
      // Allocate resources
      if (this.config.policies.enforceResourceLimits && this.components.resourceQuotas) {
        try {
          context.resources = await this.components.resourceQuotas.allocateResources(jobId, jobConfig);
          context.checks.resourceAllocation = true;
        } catch (error) {
          context.state = 'blocked';
          await this.blockJob(jobId, 'Resource allocation failed');
          return context;
        }
      }
      
      // Create isolated network
      if (this.config.policies.enforceNetworkIsolation && this.components.networkIsolation) {
        try {
          context.network = await this.components.networkIsolation.createIsolatedNetwork(jobId, jobConfig);
          context.checks.networkIsolation = true;
        } catch (error) {
          logger.error(`Network isolation failed for job ${jobId}:`, error);
          if (this.config.policies.blockOnSecurityFailure) {
            context.state = 'blocked';
            await this.blockJob(jobId, 'Network isolation failed');
            return context;
          }
        }
      }
      
      context.state = 'ready';
      this.jobSecurityContexts.set(jobId, context);
      
      // Log security context creation
      await this.logSecurityEvent('job_security_context_created', {
        jobId,
        repository: jobConfig.repository,
        checks: context.checks
      });
      
      this.emit('securityContextCreated', context);
      
      return context;
      
    } catch (error) {
      logger.error(`Failed to create security context for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Prepare container with security controls
   */
  async prepareSecureContainer(containerId, jobId) {
    try {
      logger.info(`Preparing secure container ${containerId} for job ${jobId}`);
      
      const context = this.jobSecurityContexts.get(jobId);
      if (!context) {
        throw new Error(`No security context found for job ${jobId}`);
      }
      
      // Scan container image
      if (this.config.policies.requireContainerScanning && this.components.containerScanner) {
        const imageId = await this.getContainerImageId(containerId);
        const scanResults = await this.components.containerScanner.scanImage(imageId);
        
        context.scanning = scanResults;
        context.checks.scanning = scanResults.overallStatus === 'pass';
        
        if (!context.checks.scanning && this.config.policies.blockOnSecurityFailure) {
          await this.blockContainer(containerId, 'Container security scan failed');
          return false;
        }
      }
      
      // Apply resource limits
      if (context.resources && this.components.resourceQuotas) {
        await this.components.resourceQuotas.applyResourceLimits(containerId, jobId);
      }
      
      // Connect to isolated network
      if (context.network && this.components.networkIsolation) {
        await this.components.networkIsolation.connectContainerToNetwork(containerId, jobId);
      }
      
      // Inject secrets
      if (this.components.secretManagement && context.secrets.length > 0) {
        await this.components.secretManagement.injectSecrets(containerId, jobId, context.secrets);
      }
      
      // Start runtime monitoring
      if (this.components.runtimeMonitor) {
        await this.components.runtimeMonitor.startContainerMonitoring(containerId, jobId, {
          repository: context.repository
        });
        context.monitoring = true;
      }
      
      // Log container preparation
      await this.logSecurityEvent('container_secured', {
        containerId,
        jobId,
        securityFeatures: {
          resourceLimits: !!context.resources,
          networkIsolation: !!context.network,
          scanning: !!context.scanning,
          monitoring: !!context.monitoring
        }
      });
      
      this.emit('containerSecured', { containerId, jobId });
      
      return true;
      
    } catch (error) {
      logger.error(`Failed to prepare secure container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up security context after job completion
   */
  async cleanupJobSecurity(jobId) {
    try {
      logger.info(`Cleaning up security for job ${jobId}`);
      
      const context = this.jobSecurityContexts.get(jobId);
      if (!context) {
        return;
      }
      
      // Stop runtime monitoring
      if (context.monitoring && this.components.runtimeMonitor) {
        const containers = await this.getJobContainers(jobId);
        for (const containerId of containers) {
          await this.components.runtimeMonitor.stopContainerMonitoring(containerId);
        }
      }
      
      // Release resources
      if (context.resources && this.components.resourceQuotas) {
        await this.components.resourceQuotas.releaseResources(jobId);
      }
      
      // Remove network
      if (context.network && this.components.networkIsolation) {
        await this.components.networkIsolation.removeIsolatedNetwork(jobId);
      }
      
      // Generate security report
      const report = await this.generateJobSecurityReport(jobId);
      
      // Log cleanup
      await this.logSecurityEvent('job_security_cleanup', {
        jobId,
        duration: Date.now() - context.createdAt.getTime(),
        threats: context.threats.length,
        violations: context.violations.length
      });
      
      // Clean up context
      this.jobSecurityContexts.delete(jobId);
      
      this.emit('securityCleanup', { jobId, report });
      
      return report;
      
    } catch (error) {
      logger.error(`Failed to cleanup security for job ${jobId}:`, error);
    }
  }

  /**
   * Handle security threat
   */
  async handleSecurityThreat(threat) {
    try {
      logger.warn(`Handling security threat: ${threat.type}`);
      
      this.stats.threatsDetected++;
      
      // Update job context if applicable
      if (threat.jobId) {
        const context = this.jobSecurityContexts.get(threat.jobId);
        if (context) {
          context.threats.push(threat);
        }
      }
      
      // Take action based on threat severity
      if (threat.severity === 'critical') {
        await this.handleCriticalThreat(threat);
      } else if (threat.severity === 'high') {
        await this.handleHighThreat(threat);
      }
      
      // Send alerts
      await this.sendSecurityAlert(threat);
      
      // Log threat
      await this.logSecurityEvent('threat_detected', threat);
      
      // Update security state
      this.updateSecurityState();
      
      this.emit('threatHandled', threat);
      
    } catch (error) {
      logger.error('Failed to handle security threat:', error);
    }
  }

  /**
   * Handle critical threat
   */
  async handleCriticalThreat(threat) {
    logger.error(`Critical threat detected: ${threat.type}`);
    
    this.stats.threatsBlocked++;
    
    // Immediate actions
    if (threat.containerId) {
      await this.isolateContainer(threat.containerId);
    }
    
    if (threat.jobId && this.config.policies.blockOnSecurityFailure) {
      await this.terminateJob(threat.jobId, 'Critical security threat');
    }
    
    // Update security score
    this.securityState.securityScore = Math.max(0, this.securityState.securityScore - 20);
  }

  /**
   * Handle high severity threat
   */
  async handleHighThreat(threat) {
    logger.warn(`High severity threat detected: ${threat.type}`);
    
    // Containment actions
    if (threat.containerId && this.components.networkIsolation) {
      // Restrict network access
      logger.info(`Restricting network access for container ${threat.containerId}`);
    }
    
    // Update security score
    this.securityState.securityScore = Math.max(0, this.securityState.securityScore - 10);
  }

  /**
   * Send security alert
   */
  async sendSecurityAlert(threat) {
    const alert = {
      type: 'security_alert',
      severity: threat.severity,
      threat: threat.type,
      message: `Security threat detected: ${threat.type}`,
      details: threat,
      timestamp: new Date()
    };
    
    // Webhook notification
    if (this.config.integration.webhookUrl) {
      try {
        // Send webhook
        logger.info('Sending security webhook alert');
      } catch (error) {
        logger.error('Failed to send webhook:', error);
      }
    }
    
    // Slack notification
    if (this.config.integration.slackWebhook) {
      try {
        // Send Slack alert
        logger.info('Sending Slack security alert');
      } catch (error) {
        logger.error('Failed to send Slack alert:', error);
      }
    }
    
    this.emit('securityAlert', alert);
  }

  /**
   * Generate job security report
   */
  async generateJobSecurityReport(jobId) {
    const context = this.jobSecurityContexts.get(jobId);
    if (!context) {
      return null;
    }
    
    const report = {
      jobId,
      repository: context.repository,
      duration: Date.now() - context.createdAt.getTime(),
      securityChecks: context.checks,
      threats: context.threats,
      violations: context.violations,
      
      // Component reports
      scanning: context.scanning,
      resourceUsage: await this.getResourceUsageReport(jobId),
      networkActivity: await this.getNetworkActivityReport(jobId),
      auditTrail: await this.getJobAuditTrail(jobId),
      
      // Overall assessment
      securityScore: this.calculateJobSecurityScore(context),
      recommendations: this.generateSecurityRecommendations(context)
    };
    
    return report;
  }

  /**
   * Calculate job security score
   */
  calculateJobSecurityScore(context) {
    let score = 100;
    
    // Deduct for failed checks
    Object.entries(context.checks).forEach(([check, passed]) => {
      if (!passed) score -= 10;
    });
    
    // Deduct for threats
    score -= context.threats.length * 5;
    score -= context.violations.length * 3;
    
    // Deduct for critical threats
    const criticalThreats = context.threats.filter(t => t.severity === 'critical');
    score -= criticalThreats.length * 15;
    
    return Math.max(0, score);
  }

  /**
   * Generate security recommendations
   */
  generateSecurityRecommendations(context) {
    const recommendations = [];
    
    if (!context.checks.scanning) {
      recommendations.push({
        priority: 'high',
        message: 'Enable container security scanning to detect vulnerabilities'
      });
    }
    
    if (context.threats.length > 5) {
      recommendations.push({
        priority: 'high',
        message: 'High number of threats detected - review security policies'
      });
    }
    
    if (!context.network) {
      recommendations.push({
        priority: 'medium',
        message: 'Enable network isolation for better security'
      });
    }
    
    return recommendations;
  }

  /**
   * Setup component event handlers
   */
  setupAuditLoggerHandlers() {
    this.components.auditLogger.on('auditEvent', (event) => {
      this.stats.auditEvents++;
    });
  }

  setupRBACHandlers() {
    this.components.rbac.on('authorizationDenied', (event) => {
      this.handleSecurityThreat({
        type: 'authorization_denied',
        severity: 'medium',
        userId: event.userId,
        permission: event.permission
      });
    });
  }

  setupNetworkHandlers() {
    this.components.networkIsolation.on('securityViolation', (violation) => {
      this.handleSecurityThreat({
        type: 'network_violation',
        severity: violation.severity,
        containerId: violation.containerId,
        details: violation
      });
    });
  }

  setupResourceHandlers() {
    this.components.resourceQuotas.on('quotaViolation', (violation) => {
      this.handleSecurityThreat({
        type: 'resource_violation',
        severity: 'medium',
        containerId: violation.containerId,
        details: violation
      });
    });
  }

  setupSecretHandlers() {
    this.components.secretManagement.on('secretViolation', (violation) => {
      this.handleSecurityThreat({
        type: 'secret_violation',
        severity: 'high',
        details: violation
      });
    });
  }

  setupScannerHandlers() {
    this.components.containerScanner.on('securityAlert', (alert) => {
      this.handleSecurityThreat({
        type: 'vulnerability_detected',
        severity: alert.severity,
        containerId: alert.image,
        details: alert
      });
    });
    
    this.components.containerScanner.on('scanCompleted', () => {
      this.stats.securityScans++;
    });
  }

  setupMonitorHandlers() {
    this.components.runtimeMonitor.on('threatDetected', (threat) => {
      this.handleSecurityThreat(threat);
    });
  }

  /**
   * Update overall security state
   */
  updateSecurityState() {
    // Update component status
    for (const [name, component] of Object.entries(this.components)) {
      this.securityState.componentStatus[name] = 'active';
    }
    
    // Calculate overall status
    if (this.securityState.securityScore < 50) {
      this.securityState.overallStatus = 'critical';
    } else if (this.securityState.securityScore < 70) {
      this.securityState.overallStatus = 'warning';
    } else {
      this.securityState.overallStatus = 'healthy';
    }
    
    this.securityState.activeThreats = this.countActiveThreats();
  }

  /**
   * Count active threats
   */
  countActiveThreats() {
    let count = 0;
    for (const context of this.jobSecurityContexts.values()) {
      count += context.threats.filter(t => !t.resolved).length;
    }
    return count;
  }

  /**
   * Helper methods
   */
  async authenticateUser(userId) {
    // Simplified authentication check
    return !!userId;
  }

  async authorizeJob(userId, jobConfig) {
    if (!this.components.rbac) return true;
    
    return await this.components.rbac.checkPermission(userId, 'jobs:create', {
      repository: jobConfig.repository
    });
  }

  async blockJob(jobId, reason) {
    this.stats.jobsBlocked++;
    
    await this.logSecurityEvent('job_blocked', {
      jobId,
      reason
    });
    
    this.emit('jobBlocked', { jobId, reason });
  }

  async blockContainer(containerId, reason) {
    await this.logSecurityEvent('container_blocked', {
      containerId,
      reason
    });
    
    this.emit('containerBlocked', { containerId, reason });
  }

  async isolateContainer(containerId) {
    logger.warn(`Isolating container ${containerId} due to security threat`);
    
    if (this.components.networkIsolation) {
      // Disconnect from network
      const jobId = await this.getContainerJobId(containerId);
      if (jobId) {
        await this.components.networkIsolation.disconnectContainerFromNetwork(containerId, jobId);
      }
    }
  }

  async terminateJob(jobId, reason) {
    logger.error(`Terminating job ${jobId}: ${reason}`);
    
    // This would integrate with job management system
    this.emit('jobTerminated', { jobId, reason });
  }

  async getContainerImageId(containerId) {
    const container = this.dockerAPI.docker.getContainer(containerId);
    const info = await container.inspect();
    return info.Image;
  }

  async getJobContainers(jobId) {
    // This would get all containers for a job
    return [];
  }

  async getContainerJobId(containerId) {
    // This would look up job ID from container
    return null;
  }

  async getResourceUsageReport(jobId) {
    if (!this.components.resourceQuotas) return null;
    
    // Get resource usage data
    return {};
  }

  async getNetworkActivityReport(jobId) {
    if (!this.components.networkIsolation) return null;
    
    // Get network activity data
    return {};
  }

  async getJobAuditTrail(jobId) {
    if (!this.components.auditLogger) return [];
    
    return await this.components.auditLogger.search({
      resourceId: jobId,
      limit: 100
    });
  }

  async logSecurityEvent(action, details) {
    if (!this.components.auditLogger) return;
    
    await this.components.auditLogger.log({
      category: 'security',
      action,
      userId: 'system',
      details
    });
  }

  /**
   * Get security orchestrator status
   */
  getStatus() {
    return {
      state: this.securityState,
      statistics: this.stats,
      components: Object.keys(this.components),
      activeJobs: this.jobSecurityContexts.size,
      configuration: {
        securityLevel: this.config.securityLevel,
        policies: this.config.policies
      }
    };
  }

  /**
   * Get security metrics
   */
  getSecurityMetrics() {
    const metrics = {
      overall: this.securityState,
      components: {}
    };
    
    // Get metrics from each component
    if (this.components.networkIsolation) {
      metrics.components.networkIsolation = this.components.networkIsolation.getNetworkReport();
    }
    
    if (this.components.resourceQuotas) {
      metrics.components.resourceQuotas = this.components.resourceQuotas.getResourceReport();
    }
    
    if (this.components.secretManagement) {
      metrics.components.secretManagement = this.components.secretManagement.getSecretReport();
    }
    
    if (this.components.containerScanner) {
      metrics.components.containerScanner = this.components.containerScanner.getSecurityReport();
    }
    
    if (this.components.rbac) {
      metrics.components.rbac = this.components.rbac.getStatistics();
    }
    
    if (this.components.runtimeMonitor) {
      metrics.components.runtimeMonitor = this.components.runtimeMonitor.getStatistics();
    }
    
    if (this.components.auditLogger) {
      metrics.components.auditLogger = this.components.auditLogger.getStatistics();
    }
    
    return metrics;
  }

  /**
   * Stop the security orchestrator
   */
  async stop() {
    logger.info('Stopping Security Orchestrator');
    
    // Stop all components
    for (const [name, component] of Object.entries(this.components)) {
      if (component && typeof component.stop === 'function') {
        try {
          await component.stop();
          logger.info(`Stopped ${name}`);
        } catch (error) {
          logger.error(`Failed to stop ${name}:`, error);
        }
      }
    }
    
    // Clean up remaining contexts
    for (const jobId of this.jobSecurityContexts.keys()) {
      await this.cleanupJobSecurity(jobId);
    }
    
    this.emit('stopped');
    logger.info('Security Orchestrator stopped');
  }
}

module.exports = SecurityOrchestrator;