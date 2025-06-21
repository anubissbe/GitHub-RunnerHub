/**
 * Security Orchestrator
 * Coordinates all security components and provides unified security management
 */

const EventEmitter = require('events');
const NetworkIsolationManager = require('./network-isolation');
const ResourceQuotaManager = require('./resource-quotas');
const SecretManager = require('./secret-management');
const ContainerSecurityScanner = require('./container-scanner');
const AuditLogger = require('./audit-logger');
const logger = require('../utils/logger');

class SecurityOrchestrator extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.config = {
      // Security policy configuration
      securityLevel: options.securityLevel || 'high', // 'low', 'medium', 'high', 'critical'
      
      // Component configuration
      components: {
        networkIsolation: options.networkIsolation || {},
        resourceQuotas: options.resourceQuotas || {},
        secretManagement: options.secretManagement || {},
        containerScanning: options.containerScanning || {},
        auditLogging: options.auditLogging || {}
      },
      
      // Security policies
      policies: {
        requireNetworkIsolation: options.requireNetworkIsolation !== false,
        enforceResourceQuotas: options.enforceResourceQuotas !== false,
        mandatorySecretScanning: options.mandatorySecretScanning !== false,
        blockVulnerableImages: options.blockVulnerableImages !== false,
        comprehensiveAuditing: options.comprehensiveAuditing !== false
      },
      
      // Threat response
      threatResponse: {
        enabled: options.threatResponseEnabled !== false,
        autoQuarantine: options.autoQuarantine || false,
        alertThresholds: options.alertThresholds || {
          criticalVulns: 1,
          resourceViolations: 3,
          networkAnomalies: 5
        }
      },
      
      ...options
    };
    
    // Initialize security components
    this.components = {
      networkIsolation: new NetworkIsolationManager(dockerAPI, this.config.components.networkIsolation),
      resourceQuotas: new ResourceQuotaManager(dockerAPI, this.config.components.resourceQuotas),
      secretManager: new SecretManager(this.config.components.secretManagement),
      containerScanner: new ContainerSecurityScanner(dockerAPI, this.config.components.containerScanning),
      auditLogger: new AuditLogger(this.config.components.auditLogging)
    };
    
    // Security state tracking
    this.securityContexts = new Map(); // jobId -> securityContext
    this.threatAlerts = new Map(); // alertId -> alert
    this.securityMetrics = {
      activeSecurityContexts: 0,
      totalThreatAlerts: 0,
      blockedContainers: 0,
      quarantinedJobs: 0
    };
    
    this.isInitialized = false;
  }

  /**
   * Initialize the security orchestrator
   */
  async initialize() {
    try {
      logger.info('Initializing Security Orchestrator');
      
      // Initialize audit logger first (for logging other initializations)
      await this.components.auditLogger.initialize();
      
      // Log security orchestrator initialization
      await this.components.auditLogger.logAuditEvent({
        category: 'system',
        action: 'security_orchestrator_initializing',
        level: 'INFO',
        actor: 'system',
        resource: 'security_orchestrator',
        outcome: 'success',
        details: {
          securityLevel: this.config.securityLevel,
          enabledComponents: Object.keys(this.components)
        }
      });
      
      // Initialize other components
      await this.components.networkIsolation.initialize();
      await this.components.resourceQuotas.initialize();
      await this.components.secretManager.initialize();
      await this.components.containerScanner.initialize();
      
      // Set up component event handlers
      this.setupComponentEventHandlers();
      
      // Apply security level policies
      this.applySecurityLevelPolicies();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      // Log successful initialization
      await this.components.auditLogger.logAuditEvent({
        category: 'system',
        action: 'security_orchestrator_initialized',
        level: 'INFO',
        actor: 'system',
        resource: 'security_orchestrator',
        outcome: 'success',
        details: {
          securityLevel: this.config.securityLevel,
          componentStatus: await this.getComponentStatus()
        }
      });
      
      logger.info('Security Orchestrator initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Security Orchestrator:', error);
      
      // Try to log the error
      if (this.components.auditLogger.isInitialized) {
        await this.components.auditLogger.logAuditEvent({
          category: 'system',
          action: 'security_orchestrator_init_failed',
          level: 'ERROR',
          actor: 'system',
          resource: 'security_orchestrator',
          outcome: 'failure',
          details: { error: error.message }
        });
      }
      
      throw error;
    }
  }

  /**
   * Create security context for a job
   */
  async createJobSecurityContext(jobId, jobConfig) {
    try {
      if (!this.isInitialized) {
        throw new Error('Security Orchestrator not initialized');
      }
      
      logger.info(`Creating security context for job ${jobId}`);
      
      // Log job security context creation
      await this.components.auditLogger.logAuditEvent({
        category: 'job',
        action: 'security_context_creating',
        level: 'INFO',
        actor: jobConfig.actor || 'system',
        resource: jobId,
        outcome: 'success',
        details: {
          jobConfig: this.sanitizeJobConfig(jobConfig),
          securityLevel: this.config.securityLevel
        }
      });
      
      const securityContext = {
        jobId,
        createdAt: new Date(),
        securityLevel: this.config.securityLevel,
        components: {}
      };
      
      // Create network isolation
      if (this.config.policies.requireNetworkIsolation) {
        securityContext.components.network = await this.components.networkIsolation.createIsolatedNetwork(jobId, jobConfig);
      }
      
      // Set up resource quotas
      if (this.config.policies.enforceResourceQuotas) {
        securityContext.components.resourceQuotas = {
          limits: await this.calculateResourceLimits(jobConfig),
          enforced: true
        };
      }
      
      // Prepare secret management
      securityContext.components.secrets = {
        requests: jobConfig.secrets || [],
        manager: this.components.secretManager
      };
      
      // Schedule container scanning
      if (this.config.policies.mandatorySecretScanning && jobConfig.image) {
        securityContext.components.scanning = {
          imageId: jobConfig.imageId,
          imageName: jobConfig.image,
          scheduled: true
        };
      }
      
      // Store security context
      this.securityContexts.set(jobId, securityContext);
      this.securityMetrics.activeSecurityContexts++;
      
      // Emit event
      this.emit('securityContextCreated', {
        jobId,
        securityContext,
        securityLevel: this.config.securityLevel
      });
      
      // Log successful creation
      await this.components.auditLogger.logAuditEvent({
        category: 'job',
        action: 'security_context_created',
        level: 'INFO',
        actor: jobConfig.actor || 'system',
        resource: jobId,
        outcome: 'success',
        details: {
          securityContextId: securityContext.jobId,
          componentsEnabled: Object.keys(securityContext.components)
        }
      });
      
      logger.info(`Created security context for job ${jobId}`);
      return securityContext;
      
    } catch (error) {
      logger.error(`Failed to create security context for job ${jobId}:`, error);
      
      // Log the error
      await this.components.auditLogger.logAuditEvent({
        category: 'job',
        action: 'security_context_creation_failed',
        level: 'ERROR',
        actor: jobConfig?.actor || 'system',
        resource: jobId,
        outcome: 'failure',
        details: { error: error.message }
      });
      
      throw error;
    }
  }

  /**
   * Secure container creation and startup
   */
  async secureContainer(containerId, jobId, containerConfig) {
    try {
      const securityContext = this.securityContexts.get(jobId);
      if (!securityContext) {
        throw new Error(`No security context found for job ${jobId}`);
      }
      
      logger.info(`Securing container ${containerId} for job ${jobId}`);
      
      // Log container security start
      await this.components.auditLogger.logAuditEvent({
        category: 'container',
        action: 'container_securing_started',
        level: 'INFO',
        actor: 'security_orchestrator',
        resource: containerId,
        outcome: 'success',
        details: {
          jobId,
          containerConfig: this.sanitizeContainerConfig(containerConfig)
        }
      });
      
      // Scan container image (if required)
      if (securityContext.components.scanning) {
        const scanResult = await this.components.containerScanner.scanImage(
          securityContext.components.scanning.imageId,
          securityContext.components.scanning.imageName
        );
        
        if (scanResult.policy.blocked) {
          await this.handleBlockedContainer(containerId, jobId, scanResult);
          return { blocked: true, reason: scanResult.policy.reason };
        }
        
        securityContext.components.scanning.result = scanResult;
      }
      
      // Allocate resources with quotas
      if (securityContext.components.resourceQuotas) {
        const allocation = await this.components.resourceQuotas.allocateResources(
          containerId,
          jobId,
          containerConfig.resources || {}
        );
        securityContext.components.resourceQuotas.allocation = allocation;
      }
      
      // Connect to isolated network
      if (securityContext.components.network) {
        await this.components.networkIsolation.connectContainer(
          jobId,
          containerId,
          containerConfig.network || {}
        );
      }
      
      // Inject secrets
      if (securityContext.components.secrets.requests.length > 0) {
        const injectedSecrets = await this.components.secretManager.injectSecrets(
          containerId,
          securityContext.components.secrets.requests
        );
        securityContext.components.secrets.injected = injectedSecrets;
      }
      
      // Log successful container security
      await this.components.auditLogger.logAuditEvent({
        category: 'container',
        action: 'container_secured',
        level: 'INFO',
        actor: 'security_orchestrator',
        resource: containerId,
        outcome: 'success',
        details: {
          jobId,
          securityComponents: Object.keys(securityContext.components),
          blocked: false
        }
      });
      
      logger.info(`Successfully secured container ${containerId} for job ${jobId}`);
      return { blocked: false, securityContext };
      
    } catch (error) {
      logger.error(`Failed to secure container ${containerId}:`, error);
      
      // Log the error
      await this.components.auditLogger.logAuditEvent({
        category: 'container',
        action: 'container_security_failed',
        level: 'ERROR',
        actor: 'security_orchestrator',
        resource: containerId,
        outcome: 'failure',
        details: {
          jobId,
          error: error.message
        }
      });
      
      throw error;
    }
  }

  /**
   * Clean up security context for a job
   */
  async cleanupJobSecurity(jobId) {
    try {
      const securityContext = this.securityContexts.get(jobId);
      if (!securityContext) {
        logger.warn(`No security context found for job ${jobId}`);
        return;
      }
      
      logger.info(`Cleaning up security context for job ${jobId}`);
      
      // Log cleanup start
      await this.components.auditLogger.logAuditEvent({
        category: 'job',
        action: 'security_cleanup_started',
        level: 'INFO',
        actor: 'security_orchestrator',
        resource: jobId,
        outcome: 'success'
      });
      
      // Release resources
      if (securityContext.components.resourceQuotas?.allocation) {
        await this.components.resourceQuotas.releaseResources(
          securityContext.components.resourceQuotas.allocation.containerId
        );
      }
      
      // Remove network isolation
      if (securityContext.components.network) {
        await this.components.networkIsolation.removeIsolatedNetwork(jobId);
      }
      
      // Clean up secrets
      if (securityContext.components.secrets?.injected) {
        for (const injection of securityContext.components.secrets.injected) {
          if (injection.cleanup) {
            await injection.cleanup();
          }
        }
      }
      
      // Remove security context
      this.securityContexts.delete(jobId);
      this.securityMetrics.activeSecurityContexts--;
      
      // Log successful cleanup
      await this.components.auditLogger.logAuditEvent({
        category: 'job',
        action: 'security_cleanup_completed',
        level: 'INFO',
        actor: 'security_orchestrator',
        resource: jobId,
        outcome: 'success',
        details: {
          cleanedComponents: Object.keys(securityContext.components)
        }
      });
      
      logger.info(`Successfully cleaned up security context for job ${jobId}`);
      
    } catch (error) {
      logger.error(`Failed to cleanup security for job ${jobId}:`, error);
      
      // Log the error
      await this.components.auditLogger.logAuditEvent({
        category: 'job',
        action: 'security_cleanup_failed',
        level: 'ERROR',
        actor: 'security_orchestrator',
        resource: jobId,
        outcome: 'failure',
        details: { error: error.message }
      });
    }
  }

  /**
   * Handle blocked container
   */
  async handleBlockedContainer(containerId, jobId, scanResult) {
    this.securityMetrics.blockedContainers++;
    
    // Log blocked container
    await this.components.auditLogger.logAuditEvent({
      category: 'security',
      action: 'container_blocked',
      level: 'WARN',
      actor: 'security_orchestrator',
      resource: containerId,
      outcome: 'blocked',
      details: {
        jobId,
        reason: scanResult.policy.reason,
        vulnerabilities: scanResult.summary.severityCounts,
        riskScore: scanResult.summary.riskScore
      }
    });
    
    // Emit security alert
    const alert = {
      id: this.generateAlertId(),
      type: 'container_blocked',
      severity: 'HIGH',
      containerId,
      jobId,
      reason: scanResult.policy.reason,
      details: scanResult,
      timestamp: new Date()
    };
    
    this.threatAlerts.set(alert.id, alert);
    this.securityMetrics.totalThreatAlerts++;
    
    this.emit('securityAlert', alert);
    
    logger.warn(`Blocked container ${containerId} due to security violations: ${scanResult.policy.reason}`);
  }

  /**
   * Set up component event handlers
   */
  setupComponentEventHandlers() {
    // Network isolation events
    this.components.networkIsolation.on('securityAlert', (alert) => {
      this.handleNetworkSecurityAlert(alert);
    });
    
    // Resource quota events
    this.components.resourceQuotas.on('quotaViolation', (violation) => {
      this.handleResourceQuotaViolation(violation);
    });
    
    this.components.resourceQuotas.on('containerTerminated', (termination) => {
      this.handleContainerTermination(termination);
    });
    
    // Container scanner events
    this.components.containerScanner.on('imageBlocked', (blockEvent) => {
      this.handleImageBlocked(blockEvent);
    });
    
    // Secret manager events
    this.components.secretManager.on('secretAccessed', (accessEvent) => {
      this.handleSecretAccess(accessEvent);
    });
    
    this.components.secretManager.on('auditLog', (auditEvent) => {
      // Forward to audit logger
      this.components.auditLogger.logAuditEvent({
        category: 'secrets',
        action: auditEvent.operation,
        level: auditEvent.success ? 'INFO' : 'WARN',
        actor: 'secret_manager',
        resource: auditEvent.secretId,
        outcome: auditEvent.success ? 'success' : 'failure',
        details: auditEvent.details
      });
    });
  }

  /**
   * Event handlers
   */
  
  async handleNetworkSecurityAlert(alert) {
    await this.components.auditLogger.logAuditEvent({
      category: 'security',
      action: 'network_security_alert',
      level: 'WARN',
      actor: 'network_isolation',
      resource: alert.networkId,
      outcome: 'alert_raised',
      details: alert
    });
    
    this.emit('securityAlert', {
      type: 'network_security',
      ...alert
    });
  }
  
  async handleResourceQuotaViolation(violation) {
    await this.components.auditLogger.logAuditEvent({
      category: 'security',
      action: 'resource_quota_violation',
      level: violation.violation.severity === 'critical' ? 'ERROR' : 'WARN',
      actor: 'resource_quota_manager',
      resource: violation.containerId,
      outcome: 'violation_detected',
      details: violation
    });
    
    // Check if we need to take action
    if (this.config.threatResponse.enabled && violation.violation.severity === 'critical') {
      await this.handleCriticalResourceViolation(violation);
    }
  }
  
  async handleContainerTermination(termination) {
    await this.components.auditLogger.logAuditEvent({
      category: 'security',
      action: 'container_terminated',
      level: 'WARN',
      actor: 'resource_quota_manager',
      resource: termination.containerId,
      outcome: 'terminated',
      details: termination
    });
  }
  
  async handleImageBlocked(blockEvent) {
    await this.components.auditLogger.logAuditEvent({
      category: 'security',
      action: 'image_blocked',
      level: 'ERROR',
      actor: 'container_scanner',
      resource: blockEvent.imageId,
      outcome: 'blocked',
      details: blockEvent
    });
  }
  
  async handleSecretAccess(accessEvent) {
    await this.components.auditLogger.logAuditEvent({
      category: 'secrets',
      action: 'secret_accessed',
      level: 'INFO',
      actor: 'secret_manager',
      resource: accessEvent.secretId,
      outcome: 'success',
      details: accessEvent
    });
  }

  /**
   * Apply security level policies
   */
  applySecurityLevelPolicies() {
    switch (this.config.securityLevel) {
      case 'critical':
        this.config.policies.requireNetworkIsolation = true;
        this.config.policies.enforceResourceQuotas = true;
        this.config.policies.mandatorySecretScanning = true;
        this.config.policies.blockVulnerableImages = true;
        this.config.policies.comprehensiveAuditing = true;
        this.config.threatResponse.autoQuarantine = true;
        break;
        
      case 'high':
        this.config.policies.requireNetworkIsolation = true;
        this.config.policies.enforceResourceQuotas = true;
        this.config.policies.mandatorySecretScanning = true;
        this.config.policies.blockVulnerableImages = true;
        this.config.policies.comprehensiveAuditing = true;
        break;
        
      case 'medium':
        this.config.policies.requireNetworkIsolation = true;
        this.config.policies.enforceResourceQuotas = true;
        this.config.policies.mandatorySecretScanning = false;
        this.config.policies.blockVulnerableImages = false;
        this.config.policies.comprehensiveAuditing = true;
        break;
        
      case 'low':
        this.config.policies.requireNetworkIsolation = false;
        this.config.policies.enforceResourceQuotas = false;
        this.config.policies.mandatorySecretScanning = false;
        this.config.policies.blockVulnerableImages = false;
        this.config.policies.comprehensiveAuditing = false;
        break;
    }
    
    logger.info(`Applied ${this.config.securityLevel} security level policies`);
  }

  /**
   * Helper methods
   */
  
  async calculateResourceLimits(jobConfig) {
    // Calculate appropriate resource limits based on job configuration
    return {
      cpu: jobConfig.resources?.cpu || 2.0,
      memory: jobConfig.resources?.memory || 4096,
      disk: jobConfig.resources?.disk || 10240
    };
  }
  
  sanitizeJobConfig(jobConfig) {
    const sanitized = { ...jobConfig };
    if (sanitized.secrets) {
      sanitized.secrets = `[${sanitized.secrets.length} secrets]`;
    }
    return sanitized;
  }
  
  sanitizeContainerConfig(containerConfig) {
    const sanitized = { ...containerConfig };
    if (sanitized.environment) {
      sanitized.environment = '[REDACTED]';
    }
    return sanitized;
  }
  
  generateAlertId() {
    return `alert-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
  
  async handleCriticalResourceViolation(violation) {
    // Implementation for critical resource violation response
    logger.warn(`Handling critical resource violation for container ${violation.containerId}`);
    
    if (this.config.threatResponse.autoQuarantine) {
      // Quarantine the job
      await this.quarantineJob(violation.jobId, 'critical_resource_violation');
    }
  }
  
  async quarantineJob(jobId, reason) {
    this.securityMetrics.quarantinedJobs++;
    
    await this.components.auditLogger.logAuditEvent({
      category: 'security',
      action: 'job_quarantined',
      level: 'CRITICAL',
      actor: 'security_orchestrator',
      resource: jobId,
      outcome: 'quarantined',
      details: { reason }
    });
    
    this.emit('jobQuarantined', { jobId, reason });
    
    logger.critical(`Quarantined job ${jobId} due to: ${reason}`);
  }

  /**
   * Get component status
   */
  async getComponentStatus() {
    return {
      networkIsolation: this.components.networkIsolation.getNetworkStatus(),
      resourceQuotas: this.components.resourceQuotas.getQuotaStatus(),
      secretManager: this.components.secretManager.getStatus(),
      containerScanner: this.components.containerScanner.getScannerStatus(),
      auditLogger: this.components.auditLogger.getAuditStatus()
    };
  }

  /**
   * Get security orchestrator status
   */
  getSecurityStatus() {
    return {
      isInitialized: this.isInitialized,
      securityLevel: this.config.securityLevel,
      policies: this.config.policies,
      threatResponse: this.config.threatResponse,
      metrics: this.securityMetrics,
      activeContexts: this.securityContexts.size,
      activeThreatAlerts: this.threatAlerts.size,
      components: {
        networkIsolation: this.components.networkIsolation.isInitialized,
        resourceQuotas: this.components.resourceQuotas.isInitialized,
        secretManager: this.components.secretManager.isInitialized,
        containerScanner: this.components.containerScanner.isInitialized,
        auditLogger: this.components.auditLogger.isInitialized
      }
    };
  }

  /**
   * Stop security orchestrator
   */
  async stop() {
    logger.info('Stopping Security Orchestrator');
    
    // Log shutdown start
    await this.components.auditLogger.logAuditEvent({
      category: 'system',
      action: 'security_orchestrator_stopping',
      level: 'INFO',
      actor: 'system',
      resource: 'security_orchestrator',
      outcome: 'success'
    });
    
    // Clean up all active security contexts
    for (const jobId of this.securityContexts.keys()) {
      await this.cleanupJobSecurity(jobId);
    }
    
    // Stop all components
    await this.components.networkIsolation.stop();
    await this.components.resourceQuotas.stop();
    await this.components.secretManager.stop();
    await this.components.containerScanner.stop();
    
    // Log shutdown completion
    await this.components.auditLogger.logAuditEvent({
      category: 'system',
      action: 'security_orchestrator_stopped',
      level: 'INFO',
      actor: 'system',
      resource: 'security_orchestrator',
      outcome: 'success',
      details: {
        finalMetrics: this.securityMetrics,
        componentsShutdown: Object.keys(this.components)
      }
    });
    
    // Stop audit logger last
    await this.components.auditLogger.stop();
    
    this.emit('stopped');
    logger.info('Security Orchestrator stopped');
  }
}

module.exports = SecurityOrchestrator;