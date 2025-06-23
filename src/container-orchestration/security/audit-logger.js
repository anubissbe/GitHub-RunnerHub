/**
 * Comprehensive Audit Logging System
 * Provides centralized, tamper-proof audit logging for all security-relevant events
 * with support for compliance requirements and forensic analysis
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const logger = require('../../utils/logger');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class AuditLogger extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Storage configuration
      storage: {
        basePath: options.auditPath || '/opt/github-runnerhub/audit-logs',
        format: options.format || 'json',
        compression: options.compression !== false,
        encryption: options.encryption || false,
        maxFileSize: options.maxFileSize || 104857600, // 100MB
        maxFiles: options.maxFiles || 1000,
        retentionDays: options.retentionDays || 365
      },
      
      // Log levels and categories
      levels: {
        emergency: 0,
        alert: 1,
        critical: 2,
        error: 3,
        warning: 4,
        notice: 5,
        info: 6,
        debug: 7
      },
      
      categories: {
        authentication: { level: 'info', enabled: true },
        authorization: { level: 'info', enabled: true },
        resourceAccess: { level: 'info', enabled: true },
        configuration: { level: 'notice', enabled: true },
        security: { level: 'warning', enabled: true },
        compliance: { level: 'info', enabled: true },
        system: { level: 'info', enabled: true }
      },
      
      // Integrity and compliance
      integrity: {
        enabled: options.integrityEnabled !== false,
        algorithm: options.hashAlgorithm || 'sha256',
        chainHashes: options.chainHashes !== false
      },
      
      compliance: {
        standards: options.complianceStandards || ['SOC2', 'ISO27001', 'GDPR'],
        includeMetadata: options.includeMetadata !== false,
        anonymizePII: options.anonymizePII || false
      },
      
      // Real-time processing
      realtime: {
        enabled: options.realtimeEnabled || false,
        destinations: options.realtimeDestinations || [],
        batchSize: options.batchSize || 100,
        flushInterval: options.flushInterval || 5000
      },
      
      // Search and analysis
      indexing: {
        enabled: options.indexingEnabled !== false,
        fields: options.indexFields || ['timestamp', 'category', 'action', 'userId', 'resourceId']
      },
      
      ...options
    };
    
    // Audit log state
    this.currentFile = null;
    this.currentFileSize = 0;
    this.logBuffer = [];
    this.hashChain = null;
    this.fileIndex = new Map(); // filename -> metadata
    
    // Statistics
    this.stats = {
      totalEvents: 0,
      eventsByCategory: {},
      eventsByLevel: {},
      filesCreated: 0,
      compressionRatio: 0
    };
    
    // Timers
    this.flushTimer = null;
    this.rotationTimer = null;
    this.cleanupTimer = null;
    
    this.isInitialized = false;
  }

  /**
   * Initialize the audit logger
   */
  async initialize() {
    try {
      logger.info('Initializing Audit Logger');
      
      // Create audit directory structure
      await this.createDirectoryStructure();
      
      // Load file index
      await this.loadFileIndex();
      
      // Initialize hash chain
      await this.initializeHashChain();
      
      // Open current log file
      await this.openLogFile();
      
      // Start timers
      this.startTimers();
      
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
  async log(event) {
    try {
      if (!this.isInitialized) {
        throw new Error('Audit logger not initialized');
      }
      
      // Validate and enrich event
      const auditEvent = this.createAuditEvent(event);
      
      // Check if event should be logged
      if (!this.shouldLog(auditEvent)) {
        return;
      }
      
      // Add integrity hash if enabled
      if (this.config.integrity.enabled) {
        auditEvent.integrity = await this.generateIntegrityHash(auditEvent);
      }
      
      // Add to buffer
      this.logBuffer.push(auditEvent);
      
      // Update statistics
      this.updateStatistics(auditEvent);
      
      // Check if we should flush
      if (this.shouldFlush()) {
        await this.flush();
      }
      
      // Emit event for real-time processing
      if (this.config.realtime.enabled) {
        this.emit('auditEvent', auditEvent);
      }
      
      return auditEvent.id;
      
    } catch (error) {
      logger.error('Failed to log audit event:', error);
      throw error;
    }
  }

  /**
   * Create standardized audit event
   */
  createAuditEvent(event) {
    const now = new Date();
    
    const auditEvent = {
      // Core fields
      id: this.generateEventId(),
      timestamp: now.toISOString(),
      timestampMs: now.getTime(),
      
      // Event details
      category: event.category || 'system',
      action: event.action || 'unknown',
      result: event.result || 'success',
      level: event.level || 'info',
      
      // Context
      userId: event.userId || 'system',
      sessionId: event.sessionId || null,
      ipAddress: event.ipAddress || null,
      userAgent: event.userAgent || null,
      
      // Resource information
      resourceType: event.resourceType || null,
      resourceId: event.resourceId || null,
      resourceName: event.resourceName || null,
      
      // Additional data
      details: event.details || {},
      tags: event.tags || [],
      
      // System context
      hostname: process.env.HOSTNAME || 'unknown',
      processId: process.pid,
      
      // Compliance metadata
      compliance: this.getComplianceMetadata(event)
    };
    
    // Anonymize PII if required
    if (this.config.compliance.anonymizePII) {
      this.anonymizePII(auditEvent);
    }
    
    return auditEvent;
  }

  /**
   * Determine if event should be logged
   */
  shouldLog(event) {
    const categoryConfig = this.config.categories[event.category];
    if (!categoryConfig || !categoryConfig.enabled) {
      return false;
    }
    
    const eventLevel = this.config.levels[event.level] || 6;
    const categoryLevel = this.config.levels[categoryConfig.level] || 6;
    
    return eventLevel <= categoryLevel;
  }

  /**
   * Generate event ID
   */
  generateEventId() {
    return `evt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Generate integrity hash for event
   */
  async generateIntegrityHash(event) {
    const content = JSON.stringify({
      id: event.id,
      timestamp: event.timestamp,
      category: event.category,
      action: event.action,
      userId: event.userId,
      resourceId: event.resourceId,
      previousHash: this.hashChain
    });
    
    const hash = crypto
      .createHash(this.config.integrity.algorithm)
      .update(content)
      .digest('hex');
    
    // Update hash chain if enabled
    if (this.config.integrity.chainHashes) {
      this.hashChain = hash;
    }
    
    return {
      hash,
      algorithm: this.config.integrity.algorithm,
      previousHash: this.hashChain
    };
  }

  /**
   * Get compliance metadata for event
   */
  getComplianceMetadata(event) {
    if (!this.config.compliance.includeMetadata) {
      return null;
    }
    
    const metadata = {
      standards: this.config.compliance.standards,
      dataClassification: event.dataClassification || 'internal',
      retentionRequired: this.getRetentionRequirement(event),
      regulatoryScope: event.regulatoryScope || []
    };
    
    // Add GDPR-specific metadata
    if (this.config.compliance.standards.includes('GDPR') && event.personalData) {
      metadata.gdpr = {
        lawfulBasis: event.lawfulBasis || 'legitimate_interest',
        dataSubjectId: event.dataSubjectId || null,
        processingPurpose: event.processingPurpose || null
      };
    }
    
    return metadata;
  }

  /**
   * Get retention requirement for event type
   */
  getRetentionRequirement(event) {
    // Security events - 2 years
    if (event.category === 'security' || event.category === 'authentication') {
      return 730;
    }
    
    // Compliance events - 7 years
    if (event.category === 'compliance') {
      return 2555;
    }
    
    // Default - 1 year
    return 365;
  }

  /**
   * Anonymize PII in event
   */
  anonymizePII(event) {
    // Hash user ID
    if (event.userId && event.userId !== 'system') {
      event.userId = crypto
        .createHash('sha256')
        .update(event.userId)
        .digest('hex')
        .substring(0, 16);
    }
    
    // Anonymize IP address
    if (event.ipAddress) {
      const parts = event.ipAddress.split('.');
      if (parts.length === 4) {
        event.ipAddress = `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
      }
    }
    
    // Remove sensitive details
    if (event.details) {
      const sensitiveFields = ['password', 'token', 'secret', 'key', 'email', 'phone'];
      for (const field of sensitiveFields) {
        if (event.details[field]) {
          event.details[field] = '[REDACTED]';
        }
      }
    }
  }

  /**
   * Update statistics
   */
  updateStatistics(event) {
    this.stats.totalEvents++;
    
    // By category
    if (!this.stats.eventsByCategory[event.category]) {
      this.stats.eventsByCategory[event.category] = 0;
    }
    this.stats.eventsByCategory[event.category]++;
    
    // By level
    if (!this.stats.eventsByLevel[event.level]) {
      this.stats.eventsByLevel[event.level] = 0;
    }
    this.stats.eventsByLevel[event.level]++;
  }

  /**
   * Check if buffer should be flushed
   */
  shouldFlush() {
    return this.logBuffer.length >= this.config.realtime.batchSize ||
           this.currentFileSize >= this.config.storage.maxFileSize;
  }

  /**
   * Flush log buffer to disk
   */
  async flush() {
    if (this.logBuffer.length === 0) {
      return;
    }
    
    // Define events at the function scope
    const events = [...this.logBuffer];
    
    try {
      this.logBuffer = [];
      
      // Convert to storage format
      let content;
      switch (this.config.storage.format) {
        case 'json':
          content = events.map(e => JSON.stringify(e)).join('\n') + '\n';
          break;
        case 'csv':
          content = this.convertToCSV(events);
          break;
        default:
          content = events.map(e => JSON.stringify(e)).join('\n') + '\n';
      }
      
      // Compress if enabled
      if (this.config.storage.compression) {
        content = await gzip(content);
      }
      
      // Encrypt if enabled
      if (this.config.storage.encryption) {
        content = await this.encryptContent(content);
      }
      
      // Write to file
      await fs.appendFile(this.currentFile, content);
      this.currentFileSize += content.length;
      
      // Check if rotation needed
      if (this.currentFileSize >= this.config.storage.maxFileSize) {
        await this.rotateLogFile();
      }
      
      logger.debug(`Flushed ${events.length} audit events to disk`);
      
    } catch (error) {
      logger.error('Failed to flush audit buffer:', error);
      // Re-add events to buffer for retry
      this.logBuffer.unshift(...events);
      throw error;
    }
  }

  /**
   * Create directory structure
   */
  async createDirectoryStructure() {
    const dirs = [
      this.config.storage.basePath,
      path.join(this.config.storage.basePath, 'active'),
      path.join(this.config.storage.basePath, 'archive'),
      path.join(this.config.storage.basePath, 'index')
    ];
    
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    }
  }

  /**
   * Initialize hash chain
   */
  async initializeHashChain() {
    if (!this.config.integrity.chainHashes) {
      return;
    }
    
    // Try to load previous hash chain
    try {
      const chainFile = path.join(this.config.storage.basePath, 'hash-chain.json');
      const chainData = await fs.readFile(chainFile, 'utf8');
      const chain = JSON.parse(chainData);
      this.hashChain = chain.lastHash;
    } catch (error) {
      // Initialize new chain
      this.hashChain = crypto.randomBytes(32).toString('hex');
    }
  }

  /**
   * Save hash chain
   */
  async saveHashChain() {
    if (!this.config.integrity.chainHashes) {
      return;
    }
    
    const chainFile = path.join(this.config.storage.basePath, 'hash-chain.json');
    await fs.writeFile(chainFile, JSON.stringify({
      lastHash: this.hashChain,
      updatedAt: new Date().toISOString()
    }));
  }

  /**
   * Open log file
   */
  async openLogFile() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `audit-${timestamp}.log${this.config.storage.compression ? '.gz' : ''}`;
    this.currentFile = path.join(this.config.storage.basePath, 'active', filename);
    this.currentFileSize = 0;
    
    // Create file with header
    const header = {
      type: 'audit_log_header',
      version: '1.0',
      created: new Date().toISOString(),
      hostname: process.env.HOSTNAME || 'unknown',
      previousFile: this.fileIndex.size > 0 ? Array.from(this.fileIndex.keys()).pop() : null
    };
    
    let content = JSON.stringify(header) + '\n';
    
    if (this.config.storage.compression) {
      content = await gzip(content);
    }
    
    await fs.writeFile(this.currentFile, content);
    this.currentFileSize = content.length;
    
    // Update file index
    this.fileIndex.set(filename, {
      path: this.currentFile,
      created: new Date(),
      status: 'active'
    });
    
    this.stats.filesCreated++;
  }

  /**
   * Rotate log file
   */
  async rotateLogFile() {
    try {
      // Flush any remaining events
      await this.flush();
      
      // Close current file
      const oldFile = this.currentFile;
      const oldFilename = path.basename(oldFile);
      
      // Move to archive
      const archivePath = path.join(this.config.storage.basePath, 'archive', oldFilename);
      await fs.rename(oldFile, archivePath);
      
      // Update file index
      const fileInfo = this.fileIndex.get(oldFilename);
      if (fileInfo) {
        fileInfo.status = 'archived';
        fileInfo.archived = new Date();
        fileInfo.path = archivePath;
      }
      
      // Create index entry
      await this.createFileIndex(oldFilename, archivePath);
      
      // Save hash chain
      await this.saveHashChain();
      
      // Open new file
      await this.openLogFile();
      
      logger.info(`Rotated audit log file: ${oldFilename}`);
      
    } catch (error) {
      logger.error('Failed to rotate audit log:', error);
      throw error;
    }
  }

  /**
   * Create file index for searching
   */
  async createFileIndex(filename, filepath) {
    if (!this.config.indexing.enabled) {
      return;
    }
    
    const indexPath = path.join(this.config.storage.basePath, 'index', `${filename}.idx`);
    const index = {
      filename,
      filepath,
      created: new Date().toISOString(),
      events: []
    };
    
    // Read file and create index
    try {
      let content = await fs.readFile(filepath);
      
      if (this.config.storage.compression) {
        content = await gunzip(content);
      }
      
      const lines = content.toString().split('\n');
      for (const line of lines) {
        if (!line) continue;
        
        try {
          const event = JSON.parse(line);
          if (event.type === 'audit_log_header') continue;
          
          // Index key fields
          const indexEntry = {};
          for (const field of this.config.indexing.fields) {
            if (event[field]) {
              indexEntry[field] = event[field];
            }
          }
          
          index.events.push(indexEntry);
        } catch (err) {
          // Skip invalid lines
        }
      }
      
      await fs.writeFile(indexPath, JSON.stringify(index));
      
    } catch (error) {
      logger.error(`Failed to create index for ${filename}:`, error);
    }
  }

  /**
   * Load file index
   */
  async loadFileIndex() {
    try {
      const indexDir = path.join(this.config.storage.basePath, 'index');
      const files = await fs.readdir(indexDir);
      
      for (const file of files) {
        if (file.endsWith('.idx')) {
          try {
            const indexPath = path.join(indexDir, file);
            const indexData = await fs.readFile(indexPath, 'utf8');
            const index = JSON.parse(indexData);
            
            this.fileIndex.set(index.filename, {
              path: index.filepath,
              created: new Date(index.created),
              status: 'indexed',
              eventCount: index.events.length
            });
          } catch (err) {
            logger.error(`Failed to load index ${file}:`, err);
          }
        }
      }
      
      logger.info(`Loaded ${this.fileIndex.size} file indexes`);
      
    } catch (error) {
      logger.error('Failed to load file index:', error);
    }
  }

  /**
   * Search audit logs
   */
  async search(query) {
    const results = [];
    const { startDate, endDate, category, action, userId, resourceId, limit = 100 } = query;
    
    // Search in current buffer first
    for (const event of this.logBuffer) {
      if (this.matchesQuery(event, query)) {
        results.push(event);
        if (results.length >= limit) return results;
      }
    }
    
    // Search in indexed files
    for (const [filename, fileInfo] of this.fileIndex.entries()) {
      if (fileInfo.status !== 'indexed') continue;
      
      // Check date range
      if (startDate && fileInfo.created < startDate) continue;
      if (endDate && fileInfo.created > endDate) continue;
      
      // Search file
      const fileResults = await this.searchFile(fileInfo.path, query, limit - results.length);
      results.push(...fileResults);
      
      if (results.length >= limit) break;
    }
    
    return results;
  }

  /**
   * Search individual file
   */
  async searchFile(filepath, query, maxResults) {
    const results = [];
    
    try {
      let content = await fs.readFile(filepath);
      
      if (this.config.storage.compression) {
        content = await gunzip(content);
      }
      
      const lines = content.toString().split('\n');
      for (const line of lines) {
        if (!line) continue;
        
        try {
          const event = JSON.parse(line);
          if (event.type === 'audit_log_header') continue;
          
          if (this.matchesQuery(event, query)) {
            results.push(event);
            if (results.length >= maxResults) break;
          }
        } catch (err) {
          // Skip invalid lines
        }
      }
    } catch (error) {
      logger.error(`Failed to search file ${filepath}:`, error);
    }
    
    return results;
  }

  /**
   * Check if event matches search query
   */
  matchesQuery(event, query) {
    if (query.startDate && new Date(event.timestamp) < query.startDate) return false;
    if (query.endDate && new Date(event.timestamp) > query.endDate) return false;
    if (query.category && event.category !== query.category) return false;
    if (query.action && event.action !== query.action) return false;
    if (query.userId && event.userId !== query.userId) return false;
    if (query.resourceId && event.resourceId !== query.resourceId) return false;
    if (query.level && this.config.levels[event.level] > this.config.levels[query.level]) return false;
    
    return true;
  }

  /**
   * Export audit logs
   */
  async export(query, format = 'json') {
    const events = await this.search(query);
    
    switch (format) {
      case 'json':
        return JSON.stringify(events, null, 2);
        
      case 'csv':
        return this.convertToCSV(events);
        
      case 'compliance':
        return this.generateComplianceReport(events);
        
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Convert events to CSV format
   */
  convertToCSV(events) {
    if (events.length === 0) return '';
    
    // Get all unique keys
    const keys = new Set();
    for (const event of events) {
      Object.keys(event).forEach(key => keys.add(key));
    }
    
    const headers = Array.from(keys);
    let csv = headers.join(',') + '\n';
    
    for (const event of events) {
      const values = headers.map(header => {
        const value = event[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value).includes(',') ? `"${value}"` : value;
      });
      csv += values.join(',') + '\n';
    }
    
    return csv;
  }

  /**
   * Generate compliance report
   */
  generateComplianceReport(events) {
    const report = {
      generatedAt: new Date().toISOString(),
      period: {
        start: events[0]?.timestamp || null,
        end: events[events.length - 1]?.timestamp || null
      },
      summary: {
        totalEvents: events.length,
        byCategory: {},
        byResult: {},
        securityEvents: 0,
        complianceEvents: 0
      },
      standards: this.config.compliance.standards,
      events: []
    };
    
    for (const event of events) {
      // Update summary
      report.summary.byCategory[event.category] = (report.summary.byCategory[event.category] || 0) + 1;
      report.summary.byResult[event.result] = (report.summary.byResult[event.result] || 0) + 1;
      
      if (event.category === 'security') report.summary.securityEvents++;
      if (event.category === 'compliance') report.summary.complianceEvents++;
      
      // Add compliance-relevant fields
      report.events.push({
        timestamp: event.timestamp,
        category: event.category,
        action: event.action,
        result: event.result,
        userId: event.userId,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        compliance: event.compliance
      });
    }
    
    return report;
  }

  /**
   * Start timers
   */
  startTimers() {
    // Flush timer
    this.flushTimer = setInterval(() => {
      this.flush().catch(err => logger.error('Auto-flush failed:', err));
    }, this.config.realtime.flushInterval);
    
    // Cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldLogs().catch(err => logger.error('Cleanup failed:', err));
    }, 86400000); // Daily
  }

  /**
   * Clean up old logs
   */
  async cleanupOldLogs() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.storage.retentionDays);
    
    const archiveDir = path.join(this.config.storage.basePath, 'archive');
    const files = await fs.readdir(archiveDir);
    
    for (const file of files) {
      const filePath = path.join(archiveDir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.mtime < cutoffDate) {
        await fs.unlink(filePath);
        this.fileIndex.delete(file);
        logger.info(`Deleted old audit log: ${file}`);
      }
    }
  }

  /**
   * Encrypt content
   */
  async encryptContent(content) {
    // This would implement encryption
    // For now, return content as-is
    return content;
  }

  /**
   * Get audit logger statistics
   */
  getStatistics() {
    return {
      ...this.stats,
      bufferSize: this.logBuffer.length,
      currentFileSize: this.currentFileSize,
      totalFiles: this.fileIndex.size,
      oldestLog: Array.from(this.fileIndex.values())[0]?.created || null,
      configuration: {
        retentionDays: this.config.storage.retentionDays,
        compression: this.config.storage.compression,
        encryption: this.config.storage.encryption,
        integrity: this.config.integrity.enabled
      }
    };
  }

  /**
   * Verify log integrity
   */
  async verifyIntegrity(startDate, endDate) {
    if (!this.config.integrity.enabled) {
      throw new Error('Integrity checking not enabled');
    }
    
    const results = {
      verified: 0,
      failed: 0,
      errors: []
    };
    
    const events = await this.search({ startDate, endDate });
    let previousHash = null;
    
    for (const event of events) {
      if (!event.integrity) {
        results.errors.push({
          eventId: event.id,
          error: 'No integrity hash'
        });
        results.failed++;
        continue;
      }
      
      // Verify hash
      const content = JSON.stringify({
        id: event.id,
        timestamp: event.timestamp,
        category: event.category,
        action: event.action,
        userId: event.userId,
        resourceId: event.resourceId,
        previousHash: previousHash || event.integrity.previousHash
      });
      
      const expectedHash = crypto
        .createHash(event.integrity.algorithm)
        .update(content)
        .digest('hex');
      
      if (expectedHash === event.integrity.hash) {
        results.verified++;
        previousHash = event.integrity.hash;
      } else {
        results.failed++;
        results.errors.push({
          eventId: event.id,
          error: 'Hash mismatch',
          expected: expectedHash,
          actual: event.integrity.hash
        });
      }
    }
    
    return results;
  }

  /**
   * Stop the audit logger
   */
  async stop() {
    logger.info('Stopping Audit Logger');
    
    // Clear timers
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Final flush
    await this.flush();
    
    // Save hash chain
    await this.saveHashChain();
    
    this.emit('stopped');
    logger.info('Audit Logger stopped');
  }
}

module.exports = AuditLogger;