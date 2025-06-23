/**
 * Comprehensive Audit Logging System
 * Secure, tamper-proof audit logging for compliance and security monitoring
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

class AuditLogger extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Logging configuration
      logging: {
        level: options.logLevel || 'INFO', // DEBUG, INFO, WARN, ERROR, CRITICAL
        destinations: options.destinations || ['file', 'database'],
        bufferSize: options.bufferSize || 1000,
        flushInterval: options.flushInterval || 30000, // 30 seconds
        maxFileSize: options.maxFileSize || 100 * 1024 * 1024, // 100MB
        maxFiles: options.maxFiles || 10
      },
      
      // Storage configuration
      storage: {
        directory: options.storageDirectory || '/var/log/runnerhub/audit',
        filename: options.filename || 'audit.log',
        format: options.format || 'json', // json, syslog, cef
        compression: options.compression || 'gzip',
        encryption: options.encryption !== false
      },
      
      // Integrity protection
      integrity: {
        enabled: options.integrityEnabled !== false,
        algorithm: options.hashAlgorithm || 'sha256',
        chainHashes: options.chainHashes !== false,
        signLogs: options.signLogs || false,
        signingKey: options.signingKey || null
      },
      
      // Compliance features
      compliance: {
        frameworks: options.complianceFrameworks || ['SOX', 'HIPAA', 'GDPR', 'PCI-DSS'],
        retention: {
          days: options.retentionDays || 2555, // 7 years default
          archiveAfter: options.archiveDays || 365, // 1 year
          deleteAfter: options.deleteDays || 2555
        },
        immutable: options.immutableLogs !== false
      },
      
      // Event categories
      categories: {
        authentication: ['login', 'logout', 'token_created', 'token_revoked', 'password_changed'],
        authorization: ['access_granted', 'access_denied', 'permission_changed', 'role_assigned'],
        data: ['data_accessed', 'data_modified', 'data_deleted', 'data_exported'],
        system: ['service_started', 'service_stopped', 'configuration_changed', 'backup_created'],
        security: ['vulnerability_detected', 'security_scan', 'policy_violation', 'incident_detected'],
        container: ['container_created', 'container_started', 'container_stopped', 'container_deleted'],
        job: ['job_submitted', 'job_started', 'job_completed', 'job_failed'],
        network: ['connection_established', 'connection_denied', 'network_policy_applied'],
        secrets: ['secret_accessed', 'secret_created', 'secret_rotated', 'secret_deleted']
      },
      
      // Field mapping for compliance
      fieldMapping: {
        timestamp: 'event_time',
        level: 'severity',
        category: 'event_category',
        action: 'event_action',
        actor: 'user_id',
        resource: 'resource_id',
        outcome: 'event_outcome',
        details: 'event_details'
      },
      
      ...options
    };
    
    // Audit log buffer
    this.logBuffer = [];
    this.hashChain = [];
    this.lastHash = null;
    
    // File handles and streams
    this.currentLogFile = null;
    this.currentFileSize = 0;
    this.fileRotationIndex = 0;
    
    // Flush timer
    this.flushTimer = null;
    
    // Statistics
    this.stats = {
      totalEvents: 0,
      eventsByCategory: new Map(),
      eventsByLevel: new Map(),
      errorCount: 0,
      lastFlush: null,
      filesCreated: 0
    };
    
    this.isInitialized = false;
  }

  /**
   * Initialize the audit logger
   */
  async initialize() {
    try {
      logger.info('Initializing Audit Logger');
      
      // Create storage directory
      await this.initializeStorage();
      
      // Initialize integrity protection
      if (this.config.integrity.enabled) {
        await this.initializeIntegrity();
      }
      
      // Start flush timer
      this.startFlushTimer();
      
      // Log initialization
      await this.logAuditEvent({
        category: 'system',
        action: 'audit_logger_initialized',
        level: 'INFO',
        actor: 'system',
        resource: 'audit_logger',
        outcome: 'success',
        details: {
          config: this.sanitizeConfig(this.config),
          timestamp: new Date().toISOString()
        }
      });
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Audit Logger initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Audit Logger:', error);
      throw error;
    }
  }

  /**
   * Log an audit event
   */
  async logAuditEvent(event) {
    try {
      if (!this.isInitialized && event.action !== 'audit_logger_initialized') {
        throw new Error('Audit Logger not initialized');
      }
      
      // Validate and normalize event
      const normalizedEvent = await this.normalizeEvent(event);
      
      // Add integrity protection
      if (this.config.integrity.enabled) {
        await this.addIntegrityProtection(normalizedEvent);
      }
      
      // Add to buffer
      this.logBuffer.push(normalizedEvent);
      
      // Update statistics
      this.updateStatistics(normalizedEvent);
      
      // Check for immediate flush conditions
      if (this.shouldFlushImmediately(normalizedEvent)) {
        await this.flush();
      } else if (this.logBuffer.length >= this.config.logging.bufferSize) {
        await this.flush();
      }
      
      // Emit event for real-time monitoring
      this.emit('auditEvent', normalizedEvent);
      
    } catch (error) {
      logger.error('Failed to log audit event:', error);
      this.stats.errorCount++;
      
      // Try to log the error itself (without recursion)
      if (event.action !== 'audit_error') {
        this.logAuditEventUnsafe({
          category: 'system',
          action: 'audit_error',
          level: 'ERROR',
          actor: 'audit_logger',
          resource: 'audit_logger',
          outcome: 'failure',
          details: {
            originalEvent: event,
            error: error.message
          }
        });
      }
    }
  }

  /**
   * Log audit event without error handling (for system errors)
   */
  logAuditEventUnsafe(event) {
    try {
      const normalizedEvent = this.normalizeEventSync(event);
      this.logBuffer.push(normalizedEvent);
    } catch (error) {
      // Last resort - log to console
      console.error('Critical audit logging failure:', error);
    }
  }

  /**
   * Flush audit log buffer
   */
  async flush() {
    if (this.logBuffer.length === 0) {
      return;
    }
    
    try {
      const eventsToFlush = [...this.logBuffer];
      this.logBuffer = [];
      
      // Write to all configured destinations
      await Promise.all([
        this.writeToFile(eventsToFlush),
        this.writeToDatabase(eventsToFlush),
        this.writeToSyslog(eventsToFlush)
      ]);
      
      this.stats.lastFlush = new Date();
      
      this.emit('flushed', {
        eventCount: eventsToFlush.length,
        timestamp: this.stats.lastFlush
      });
      
    } catch (error) {
      logger.error('Failed to flush audit log:', error);
      this.stats.errorCount++;
    }
  }

  /**
   * Write events to file
   */
  async writeToFile(events) {
    if (!this.config.logging.destinations.includes('file')) {
      return;
    }
    
    try {
      // Check if file rotation is needed
      await this.checkFileRotation();
      
      // Prepare log entries
      const logEntries = events.map(event => this.formatLogEntry(event)).join('\n') + '\n';
      
      // Write to file
      await fs.appendFile(this.getCurrentLogFilePath(), logEntries);
      this.currentFileSize += Buffer.byteLength(logEntries);
      
    } catch (error) {
      logger.error('Failed to write audit events to file:', error);
      throw error;
    }
  }

  /**
   * Write events to database
   */
  async writeToDatabase(events) {
    if (!this.config.logging.destinations.includes('database')) {
      return;
    }
    
    // Implementation would write to configured database
    // For now, just log that it would happen
    logger.debug(`Would write ${events.length} audit events to database`);
  }

  /**
   * Write events to syslog
   */
  async writeToSyslog(events) {
    if (!this.config.logging.destinations.includes('syslog')) {
      return;
    }
    
    // Implementation would write to syslog
    // For now, just log that it would happen
    logger.debug(`Would write ${events.length} audit events to syslog`);
  }

  /**
   * Normalize audit event
   */
  async normalizeEvent(event) {
    const normalizedEvent = {
      id: this.generateEventId(),
      timestamp: new Date().toISOString(),
      level: event.level || 'INFO',
      category: event.category || 'system',
      action: event.action,
      actor: event.actor || 'unknown',
      actorType: event.actorType || 'user',
      resource: event.resource || 'unknown',
      resourceType: event.resourceType || 'generic',
      outcome: event.outcome || 'unknown',
      sessionId: event.sessionId || null,
      sourceIP: event.sourceIP || null,
      userAgent: event.userAgent || null,
      details: event.details || {},
      compliance: this.addComplianceFields(event),
      version: '1.0'
    };
    
    // Add correlation ID for related events
    if (event.correlationId) {
      normalizedEvent.correlationId = event.correlationId;
    }
    
    return normalizedEvent;
  }

  /**
   * Synchronous event normalization for error scenarios
   */
  normalizeEventSync(event) {
    return {
      id: this.generateEventId(),
      timestamp: new Date().toISOString(),
      level: event.level || 'ERROR',
      category: event.category || 'system',
      action: event.action,
      actor: event.actor || 'system',
      resource: event.resource || 'unknown',
      outcome: event.outcome || 'failure',
      details: event.details || {},
      version: '1.0'
    };
  }

  /**
   * Add integrity protection to event
   */
  async addIntegrityProtection(event) {
    // Calculate event hash
    const eventData = JSON.stringify(event, Object.keys(event).sort());
    const eventHash = crypto.createHash(this.config.integrity.algorithm)
      .update(eventData)
      .digest('hex');
    
    event.integrity = {
      hash: eventHash,
      algorithm: this.config.integrity.algorithm
    };
    
    // Add to hash chain
    if (this.config.integrity.chainHashes) {
      const chainHash = this.calculateChainHash(eventHash);
      event.integrity.chainHash = chainHash;
      event.integrity.previousHash = this.lastHash;
      
      this.hashChain.push({
        eventId: event.id,
        hash: eventHash,
        chainHash: chainHash,
        timestamp: event.timestamp
      });
      
      this.lastHash = chainHash;
    }
    
    // Digital signature (if enabled)
    if (this.config.integrity.signLogs && this.config.integrity.signingKey) {
      const signature = await this.signEvent(event);
      event.integrity.signature = signature;
    }
  }

  /**
   * Calculate hash chain
   */
  calculateChainHash(eventHash) {
    const chainData = this.lastHash ? `${this.lastHash}${eventHash}` : eventHash;
    return crypto.createHash(this.config.integrity.algorithm)
      .update(chainData)
      .digest('hex');
  }

  /**
   * Sign event (if digital signatures are enabled)
   */
  async signEvent(event) {
    if (!this.config.integrity.signingKey) {
      return null;
    }
    
    // Simplified signature implementation
    const eventData = JSON.stringify(event, Object.keys(event).sort());
    return crypto.createHmac('sha256', this.config.integrity.signingKey)
      .update(eventData)
      .digest('hex');
  }

  /**
   * Add compliance-specific fields
   */
  addComplianceFields(event) {
    const compliance = {};
    
    // Add fields required by different compliance frameworks
    for (const framework of this.config.compliance.frameworks) {
      switch (framework) {
        case 'SOX':
          compliance.sox = {
            controlObjective: this.mapToSOXControl(event.category, event.action),
            riskLevel: this.calculateRiskLevel(event)
          };
          break;
          
        case 'HIPAA':
          compliance.hipaa = {
            safeguard: this.mapToHIPAASafeguard(event.category),
            phiInvolved: this.checkPHIInvolvement(event)
          };
          break;
          
        case 'GDPR':
          compliance.gdpr = {
            dataCategory: this.identifyDataCategory(event),
            lawfulBasis: this.determineLawfulBasis(event),
            subjectRights: this.checkSubjectRights(event)
          };
          break;
          
        case 'PCI-DSS':
          compliance.pciDss = {
            requirement: this.mapToPCIRequirement(event.category, event.action),
            cardDataInvolved: this.checkCardDataInvolvement(event)
          };
          break;
      }
    }
    
    return compliance;
  }

  /**
   * Check if immediate flush is needed
   */
  shouldFlushImmediately(event) {
    // Flush immediately for critical events
    return event.level === 'CRITICAL' || 
           event.level === 'ERROR' ||
           event.category === 'security' ||
           event.outcome === 'failure';
  }

  /**
   * Check file rotation needs
   */
  async checkFileRotation() {
    if (this.currentFileSize >= this.config.logging.maxFileSize) {
      await this.rotateLogFile();
    }
  }

  /**
   * Rotate log file
   */
  async rotateLogFile() {
    this.fileRotationIndex++;
    this.currentFileSize = 0;
    this.stats.filesCreated++;
    
    // Compress old log file if configured
    if (this.config.storage.compression) {
      const oldFilePath = this.getCurrentLogFilePath();
      await this.compressLogFile(oldFilePath);
    }
    
    // Clean up old files if we exceed max files limit
    await this.cleanupOldFiles();
  }

  /**
   * Compress log file
   */
  async compressLogFile(filePath) {
    // Implementation would compress the file
    logger.info(`Would compress log file: ${filePath}`);
  }

  /**
   * Clean up old log files
   */
  async cleanupOldFiles() {
    // Implementation would remove old files based on retention policy
    logger.info('Checking for old log files to clean up');
  }

  /**
   * Format log entry based on configured format
   */
  formatLogEntry(event) {
    switch (this.config.storage.format) {
      case 'json':
        return JSON.stringify(event);
        
      case 'syslog':
        return this.formatSyslogEntry(event);
        
      case 'cef':
        return this.formatCEFEntry(event);
        
      default:
        return JSON.stringify(event);
    }
  }

  /**
   * Format as syslog entry
   */
  formatSyslogEntry(event) {
    const timestamp = new Date(event.timestamp).toISOString();
    const facility = 16; // Local use 0
    const severity = this.mapLevelToSyslogSeverity(event.level);
    const priority = facility * 8 + severity;
    
    return `<${priority}>${timestamp} runnerhub ${event.category}[${event.id}]: ${event.action} by ${event.actor} on ${event.resource} - ${event.outcome}`;
  }

  /**
   * Format as CEF (Common Event Format) entry
   */
  formatCEFEntry(event) {
    const version = '0';
    const deviceVendor = 'RunnerHub';
    const deviceProduct = 'GitHub Actions Runner';
    const deviceVersion = '1.0';
    const signatureId = event.action;
    const name = `${event.category} - ${event.action}`;
    const severity = this.mapLevelToCEFSeverity(event.level);
    
    const extensions = [
      `rt=${new Date(event.timestamp).getTime()}`,
      `src=${event.sourceIP || 'unknown'}`,
      `suser=${event.actor}`,
      `outcome=${event.outcome}`,
      `cs1=${event.resource}`,
      `cs1Label=Resource`
    ].join(' ');
    
    return `CEF:${version}|${deviceVendor}|${deviceProduct}|${deviceVersion}|${signatureId}|${name}|${severity}|${extensions}`;
  }

  /**
   * Helper methods
   */
  
  async initializeStorage() {
    await fs.mkdir(this.config.storage.directory, { recursive: true });
    logger.info(`Initialized audit storage directory: ${this.config.storage.directory}`);
  }
  
  async initializeIntegrity() {
    // Initialize integrity protection
    this.lastHash = null;
    this.hashChain = [];
    logger.info('Initialized audit log integrity protection');
  }
  
  startFlushTimer() {
    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        logger.error('Scheduled flush failed:', error);
      });
    }, this.config.logging.flushInterval);
  }
  
  generateEventId() {
    return `audit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
  
  getCurrentLogFilePath() {
    const filename = this.fileRotationIndex > 0 
      ? `${this.config.storage.filename}.${this.fileRotationIndex}`
      : this.config.storage.filename;
    return path.join(this.config.storage.directory, filename);
  }
  
  updateStatistics(event) {
    this.stats.totalEvents++;
    
    // Update category stats
    const categoryCount = this.stats.eventsByCategory.get(event.category) || 0;
    this.stats.eventsByCategory.set(event.category, categoryCount + 1);
    
    // Update level stats
    const levelCount = this.stats.eventsByLevel.get(event.level) || 0;
    this.stats.eventsByLevel.set(event.level, levelCount + 1);
  }
  
  sanitizeConfig(config) {
    const sanitized = { ...config };
    // Remove sensitive information
    if (sanitized.integrity && sanitized.integrity.signingKey) {
      sanitized.integrity.signingKey = '[REDACTED]';
    }
    return sanitized;
  }
  
  mapLevelToSyslogSeverity(level) {
    const mapping = {
      'DEBUG': 7,
      'INFO': 6,
      'WARN': 4,
      'ERROR': 3,
      'CRITICAL': 0
    };
    return mapping[level] || 6;
  }
  
  mapLevelToCEFSeverity(level) {
    const mapping = {
      'DEBUG': 1,
      'INFO': 3,
      'WARN': 6,
      'ERROR': 8,
      'CRITICAL': 10
    };
    return mapping[level] || 3;
  }
  
  // Compliance mapping methods
  mapToSOXControl(category, action) {
    // Simplified SOX control mapping
    if (category === 'data' && action.includes('modify')) return 'IT-3.1';
    if (category === 'authentication') return 'IT-2.1';
    return 'IT-1.1';
  }
  
  calculateRiskLevel(event) {
    if (event.level === 'CRITICAL') return 'HIGH';
    if (event.level === 'ERROR') return 'MEDIUM';
    return 'LOW';
  }
  
  mapToHIPAASafeguard(category) {
    const mapping = {
      'authentication': 'Access Control',
      'data': 'Information Access Management',
      'network': 'Transmission Security',
      'system': 'Assigned Security Responsibility'
    };
    return mapping[category] || 'General';
  }
  
  checkPHIInvolvement(event) {
    // Check if event involves Protected Health Information
    return event.details && (
      event.details.hasOwnProperty('patient') ||
      event.details.hasOwnProperty('medical') ||
      event.details.hasOwnProperty('health')
    );
  }
  
  identifyDataCategory(event) {
    // GDPR data category identification
    if (event.details && event.details.personalData) return 'personal';
    if (event.details && event.details.specialCategory) return 'special';
    return 'non-personal';
  }
  
  determineLawfulBasis(_event) {
    // Simplified GDPR lawful basis determination
    return 'legitimate_interest';
  }
  
  checkSubjectRights(event) {
    // Check if event relates to data subject rights
    return event.action.includes('access') || 
           event.action.includes('delete') || 
           event.action.includes('export');
  }
  
  mapToPCIRequirement(category, action) {
    if (category === 'authentication') return '8.1';
    if (category === 'data' && action.includes('card')) return '3.1';
    if (category === 'network') return '1.1';
    return '12.1';
  }
  
  checkCardDataInvolvement(event) {
    return event.details && (
      event.details.hasOwnProperty('card') ||
      event.details.hasOwnProperty('payment') ||
      event.details.hasOwnProperty('pan')
    );
  }

  /**
   * Query audit logs
   */
  async queryAuditLogs(criteria = {}) {
    // Implementation would query stored audit logs
    // For now, return recent events from buffer
    const results = this.logBuffer.filter(event => {
      if (criteria.category && event.category !== criteria.category) return false;
      if (criteria.level && event.level !== criteria.level) return false;
      if (criteria.actor && event.actor !== criteria.actor) return false;
      if (criteria.startTime && new Date(event.timestamp) < new Date(criteria.startTime)) return false;
      if (criteria.endTime && new Date(event.timestamp) > new Date(criteria.endTime)) return false;
      return true;
    });
    
    return {
      events: results,
      totalCount: results.length,
      query: criteria
    };
  }

  /**
   * Verify log integrity
   */
  async verifyIntegrity(eventId = null) {
    if (!this.config.integrity.enabled) {
      return { verified: true, message: 'Integrity checking disabled' };
    }
    
    // Verify hash chain
    if (this.config.integrity.chainHashes) {
      let previousHash = null;
      
      for (const chainEntry of this.hashChain) {
        if (eventId && chainEntry.eventId !== eventId) continue;
        
        const expectedChainHash = this.calculateChainHash(chainEntry.hash);
        if (chainEntry.chainHash !== expectedChainHash) {
          return {
            verified: false,
            message: `Hash chain verification failed for event ${chainEntry.eventId}`,
            eventId: chainEntry.eventId
          };
        }
        
        if (previousHash && chainEntry.previousHash !== previousHash) {
          return {
            verified: false,
            message: `Chain link verification failed for event ${chainEntry.eventId}`,
            eventId: chainEntry.eventId
          };
        }
        
        previousHash = chainEntry.chainHash;
      }
    }
    
    return {
      verified: true,
      message: 'Log integrity verified',
      eventsChecked: eventId ? 1 : this.hashChain.length
    };
  }

  /**
   * Get audit logger status
   */
  getAuditStatus() {
    return {
      isInitialized: this.isInitialized,
      bufferSize: this.logBuffer.length,
      maxBufferSize: this.config.logging.bufferSize,
      currentFileSize: this.currentFileSize,
      maxFileSize: this.config.logging.maxFileSize,
      integrityEnabled: this.config.integrity.enabled,
      hashChainLength: this.hashChain.length,
      statistics: {
        ...this.stats,
        eventsByCategory: Object.fromEntries(this.stats.eventsByCategory),
        eventsByLevel: Object.fromEntries(this.stats.eventsByLevel)
      },
      compliance: {
        frameworks: this.config.compliance.frameworks,
        retention: this.config.compliance.retention
      }
    };
  }

  /**
   * Stop audit logger
   */
  async stop() {
    logger.info('Stopping Audit Logger');
    
    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    // Final flush
    await this.flush();
    
    // Log shutdown
    await this.logAuditEvent({
      category: 'system',
      action: 'audit_logger_stopped',
      level: 'INFO',
      actor: 'system',
      resource: 'audit_logger',
      outcome: 'success',
      details: {
        finalStats: this.stats,
        timestamp: new Date().toISOString()
      }
    });
    
    // Final flush for shutdown event
    await this.flush();
    
    this.emit('stopped');
    logger.info('Audit Logger stopped');
  }
}

module.exports = AuditLogger;