import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import database from './database';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('AuditLogger');

export interface AuditEvent {
  id?: string;
  eventType: AuditEventType;
  category: AuditCategory;
  severity: AuditSeverity;
  userId?: string;
  username?: string;
  userRole?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  resourceId?: string;
  action: string;
  details?: Record<string, any>;
  result: 'success' | 'failure';
  errorMessage?: string;
  timestamp?: Date;
  correlationId?: string;
}

export enum AuditEventType {
  // Authentication events
  USER_LOGIN = 'user.login',
  USER_LOGOUT = 'user.logout',
  USER_LOGIN_FAILED = 'user.login.failed',
  TOKEN_REFRESH = 'token.refresh',
  TOKEN_EXPIRED = 'token.expired',
  
  // User management
  USER_CREATED = 'user.created',
  USER_UPDATED = 'user.updated',
  USER_DELETED = 'user.deleted',
  USER_ROLE_CHANGED = 'user.role.changed',
  USER_ACTIVATED = 'user.activated',
  USER_DEACTIVATED = 'user.deactivated',
  
  // Job operations
  JOB_CREATED = 'job.created',
  JOB_STARTED = 'job.started',
  JOB_COMPLETED = 'job.completed',
  JOB_FAILED = 'job.failed',
  JOB_CANCELLED = 'job.cancelled',
  JOB_DELEGATED = 'job.delegated',
  
  // Runner operations
  RUNNER_CREATED = 'runner.created',
  RUNNER_STARTED = 'runner.started',
  RUNNER_STOPPED = 'runner.stopped',
  RUNNER_DELETED = 'runner.deleted',
  RUNNER_SCALED = 'runner.scaled',
  
  // Container operations
  CONTAINER_CREATED = 'container.created',
  CONTAINER_STARTED = 'container.started',
  CONTAINER_STOPPED = 'container.stopped',
  CONTAINER_REMOVED = 'container.removed',
  CONTAINER_EXEC = 'container.exec',
  
  // Network operations
  NETWORK_CREATED = 'network.created',
  NETWORK_REMOVED = 'network.removed',
  NETWORK_ATTACHED = 'network.attached',
  NETWORK_DETACHED = 'network.detached',
  NETWORK_CLEANUP = 'network.cleanup',
  
  // System operations
  SYSTEM_START = 'system.start',
  SYSTEM_STOP = 'system.stop',
  SYSTEM_CONFIG_CHANGED = 'system.config.changed',
  SECRET_ROTATED = 'secret.rotated',
  WEBHOOK_RECEIVED = 'webhook.received',
  WEBHOOK_PROCESSED = 'webhook.processed',
  
  // Security events
  UNAUTHORIZED_ACCESS = 'security.unauthorized',
  PERMISSION_DENIED = 'security.permission.denied',
  SUSPICIOUS_ACTIVITY = 'security.suspicious',
  RATE_LIMIT_EXCEEDED = 'security.rate.limit',
  
  // Data operations
  DATA_EXPORTED = 'data.exported',
  DATA_IMPORTED = 'data.imported',
  DATA_DELETED = 'data.deleted',
  BACKUP_CREATED = 'backup.created',
  BACKUP_RESTORED = 'backup.restored'
}

export enum AuditCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  USER_MANAGEMENT = 'user_management',
  JOB_MANAGEMENT = 'job_management',
  RUNNER_MANAGEMENT = 'runner_management',
  CONTAINER_MANAGEMENT = 'container_management',
  NETWORK_MANAGEMENT = 'network_management',
  SYSTEM_MANAGEMENT = 'system_management',
  SECURITY = 'security',
  DATA_MANAGEMENT = 'data_management'
}

export enum AuditSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export interface AuditQuery {
  startDate?: Date;
  endDate?: Date;
  eventTypes?: AuditEventType[];
  categories?: AuditCategory[];
  severities?: AuditSeverity[];
  userId?: string;
  username?: string;
  resource?: string;
  result?: 'success' | 'failure';
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalEvents: number;
  eventsByCategory: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  eventsByResult: Record<string, number>;
  topUsers: Array<{ username: string; count: number }>;
  topEventTypes: Array<{ eventType: string; count: number }>;
  failureRate: number;
}

export class AuditLogger extends EventEmitter {
  private static instance: AuditLogger;
  private buffer: AuditEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private bufferSize = 100;
  private flushIntervalMs = 5000;
  private initialized = false;

  private constructor() {
    super();
  }

  public static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  /**
   * Initialize the audit logger
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Audit logger already initialized');
      return;
    }

    logger.info('Initializing audit logger');

    try {
      // Start buffer flush interval
      this.startFlushInterval();

      // Set up graceful shutdown
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());

      this.initialized = true;
      logger.info('Audit logger initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize audit logger', { error });
      throw error;
    }
  }

  /**
   * Log an audit event
   */
  async log(event: AuditEvent): Promise<void> {
    try {
      // Add metadata
      const auditEvent: AuditEvent = {
        id: uuidv4(),
        ...event,
        timestamp: new Date()
      };

      // Add to buffer
      this.buffer.push(auditEvent);

      // Emit event for real-time monitoring
      this.emit('audit-event', auditEvent);

      // Flush if buffer is full
      if (this.buffer.length >= this.bufferSize) {
        await this.flush();
      }

      // Log critical events immediately
      if (event.severity === AuditSeverity.CRITICAL) {
        await this.flush();
      }

    } catch (error) {
      logger.error('Failed to log audit event', { error, event });
      // Don't throw - audit logging should not break the application
    }
  }

  /**
   * Log a successful authentication
   */
  async logSuccessfulLogin(userId: string, username: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      eventType: AuditEventType.USER_LOGIN,
      category: AuditCategory.AUTHENTICATION,
      severity: AuditSeverity.INFO,
      userId,
      username,
      ipAddress,
      userAgent,
      action: 'User logged in successfully',
      result: 'success'
    });
  }

  /**
   * Log a failed authentication attempt
   */
  async logFailedLogin(username: string, reason: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      eventType: AuditEventType.USER_LOGIN_FAILED,
      category: AuditCategory.AUTHENTICATION,
      severity: AuditSeverity.WARNING,
      username,
      ipAddress,
      userAgent,
      action: 'User login failed',
      details: { reason },
      result: 'failure',
      errorMessage: reason
    });
  }

  /**
   * Log a permission denied event
   */
  async logPermissionDenied(
    userId: string,
    username: string,
    resource: string,
    action: string,
    requiredPermission: string,
    ipAddress?: string
  ): Promise<void> {
    await this.log({
      eventType: AuditEventType.PERMISSION_DENIED,
      category: AuditCategory.AUTHORIZATION,
      severity: AuditSeverity.WARNING,
      userId,
      username,
      resource,
      action: `Permission denied for ${action}`,
      details: { requiredPermission },
      ipAddress,
      result: 'failure',
      errorMessage: `User lacks required permission: ${requiredPermission}`
    });
  }

  /**
   * Log a job operation
   */
  async logJobOperation(
    eventType: AuditEventType,
    jobId: string,
    repository: string,
    userId?: string,
    username?: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      eventType,
      category: AuditCategory.JOB_MANAGEMENT,
      severity: AuditSeverity.INFO,
      userId,
      username,
      resource: 'job',
      resourceId: jobId,
      action: `Job ${eventType.split('.')[1]}`,
      details: { repository, ...details },
      result: 'success'
    });
  }

  /**
   * Log a container operation
   */
  async logContainerOperation(
    eventType: AuditEventType,
    containerId: string,
    repository?: string,
    userId?: string,
    username?: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      eventType,
      category: AuditCategory.CONTAINER_MANAGEMENT,
      severity: AuditSeverity.INFO,
      userId,
      username,
      resource: 'container',
      resourceId: containerId,
      action: `Container ${eventType.split('.')[1]}`,
      details: { repository, ...details },
      result: 'success'
    });
  }

  /**
   * Log a network operation
   */
  async logNetworkOperation(
    eventType: AuditEventType,
    networkId: string,
    repository: string,
    userId?: string,
    username?: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      eventType,
      category: AuditCategory.NETWORK_MANAGEMENT,
      severity: AuditSeverity.INFO,
      userId,
      username,
      resource: 'network',
      resourceId: networkId,
      action: `Network ${eventType.split('.')[1]}`,
      details: { repository, ...details },
      result: 'success'
    });
  }

  /**
   * Log a security event
   */
  async logSecurityEvent(
    eventType: AuditEventType,
    severity: AuditSeverity,
    description: string,
    ipAddress?: string,
    userId?: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      eventType,
      category: AuditCategory.SECURITY,
      severity,
      userId,
      ipAddress,
      action: description,
      details,
      result: 'failure'
    });
  }

  /**
   * Query audit logs
   */
  async query(query: AuditQuery): Promise<AuditEvent[]> {
    try {
      let sql = `
        SELECT 
          id, event_type, category, severity, user_id, username, user_role,
          ip_address, user_agent, resource, resource_id, action, details,
          result, error_message, timestamp, correlation_id
        FROM audit_logs
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramCount = 0;

      // Add filters
      if (query.startDate) {
        sql += ` AND timestamp >= $${++paramCount}`;
        params.push(query.startDate);
      }

      if (query.endDate) {
        sql += ` AND timestamp <= $${++paramCount}`;
        params.push(query.endDate);
      }

      if (query.eventTypes && query.eventTypes.length > 0) {
        sql += ` AND event_type = ANY($${++paramCount})`;
        params.push(query.eventTypes);
      }

      if (query.categories && query.categories.length > 0) {
        sql += ` AND category = ANY($${++paramCount})`;
        params.push(query.categories);
      }

      if (query.severities && query.severities.length > 0) {
        sql += ` AND severity = ANY($${++paramCount})`;
        params.push(query.severities);
      }

      if (query.userId) {
        sql += ` AND user_id = $${++paramCount}`;
        params.push(query.userId);
      }

      if (query.username) {
        sql += ` AND username ILIKE $${++paramCount}`;
        params.push(`%${query.username}%`);
      }

      if (query.resource) {
        sql += ` AND resource = $${++paramCount}`;
        params.push(query.resource);
      }

      if (query.result) {
        sql += ` AND result = $${++paramCount}`;
        params.push(query.result);
      }

      // Add ordering and pagination
      sql += ` ORDER BY timestamp DESC`;

      if (query.limit) {
        sql += ` LIMIT $${++paramCount}`;
        params.push(query.limit);
      }

      if (query.offset) {
        sql += ` OFFSET $${++paramCount}`;
        params.push(query.offset);
      }

      const rows = await database.query(sql, params);
      return rows.map((row: any) => this.mapRowToEvent(row));

    } catch (error) {
      logger.error('Failed to query audit logs', { error, query });
      throw error;
    }
  }

  /**
   * Get audit statistics
   */
  async getStats(startDate?: Date, endDate?: Date): Promise<AuditStats> {
    try {
      const dateFilter = this.buildDateFilter(startDate, endDate);
      const params: any[] = [];
      
      if (startDate) params.push(startDate);
      if (endDate) params.push(endDate);

      // Get total events
      const totalRows = await database.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM audit_logs ${dateFilter}`,
        params
      );

      // Get events by category
      const categoryRows = await database.query<{ category: string; count: string }>(
        `SELECT category, COUNT(*) as count FROM audit_logs ${dateFilter} 
         GROUP BY category`,
        params
      );

      // Get events by severity
      const severityRows = await database.query<{ severity: string; count: string }>(
        `SELECT severity, COUNT(*) as count FROM audit_logs ${dateFilter} 
         GROUP BY severity`,
        params
      );

      // Get events by result
      const resultRows = await database.query<{ result: string; count: string }>(
        `SELECT result, COUNT(*) as count FROM audit_logs ${dateFilter} 
         GROUP BY result`,
        params
      );

      // Get top users
      const topUsersRows = await database.query<{ username: string; count: string }>(
        `SELECT username, COUNT(*) as count FROM audit_logs ${dateFilter} 
         WHERE username IS NOT NULL 
         GROUP BY username 
         ORDER BY count DESC 
         LIMIT 10`,
        params
      );

      // Get top event types
      const topEventsRows = await database.query<{ event_type: string; count: string }>(
        `SELECT event_type, COUNT(*) as count FROM audit_logs ${dateFilter} 
         GROUP BY event_type 
         ORDER BY count DESC 
         LIMIT 10`,
        params
      );

      // Calculate failure rate
      const failureCount = resultRows.find((r: any) => r.result === 'failure')?.count || '0';
      const totalCount = parseInt(totalRows[0].count);
      const failureRate = totalCount > 0 ? (parseInt(failureCount) / totalCount) * 100 : 0;

      return {
        totalEvents: totalCount,
        eventsByCategory: this.rowsToRecord(categoryRows, 'category'),
        eventsBySeverity: this.rowsToRecord(severityRows, 'severity'),
        eventsByResult: this.rowsToRecord(resultRows, 'result'),
        topUsers: topUsersRows.map((r: any) => ({
          username: r.username,
          count: parseInt(r.count)
        })),
        topEventTypes: topEventsRows.map((r: any) => ({
          eventType: r.event_type,
          count: parseInt(r.count)
        })),
        failureRate: Math.round(failureRate * 100) / 100
      };

    } catch (error) {
      logger.error('Failed to get audit stats', { error });
      throw error;
    }
  }

  /**
   * Export audit logs
   */
  async export(query: AuditQuery, format: 'json' | 'csv' = 'json'): Promise<string> {
    try {
      const events = await this.query(query);

      if (format === 'json') {
        return JSON.stringify(events, null, 2);
      }

      // CSV format
      const headers = [
        'ID', 'Timestamp', 'Event Type', 'Category', 'Severity',
        'User ID', 'Username', 'IP Address', 'Resource', 'Action',
        'Result', 'Error Message'
      ];

      const rows = events.map(e => [
        e.id,
        e.timestamp?.toISOString(),
        e.eventType,
        e.category,
        e.severity,
        e.userId || '',
        e.username || '',
        e.ipAddress || '',
        e.resource || '',
        e.action,
        e.result,
        e.errorMessage || ''
      ]);

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      return csv;

    } catch (error) {
      logger.error('Failed to export audit logs', { error });
      throw error;
    }
  }

  /**
   * Clean up old audit logs
   */
  async cleanup(retentionDays: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Use a transaction to get row count from DELETE
      const deletedCount = await database.transaction(async (client) => {
        const result = await client.query(
          'DELETE FROM audit_logs WHERE timestamp < $1',
          [cutoffDate]
        );
        return result.rowCount || 0;
      });
      
      logger.info('Cleaned up old audit logs', {
        retentionDays,
        deletedCount,
        cutoffDate
      });

      // Log the cleanup operation
      await this.log({
        eventType: AuditEventType.DATA_DELETED,
        category: AuditCategory.DATA_MANAGEMENT,
        severity: AuditSeverity.INFO,
        action: 'Audit log cleanup',
        details: {
          retentionDays,
          deletedCount,
          cutoffDate
        },
        result: 'success'
      });

      return deletedCount;

    } catch (error) {
      logger.error('Failed to cleanup audit logs', { error });
      throw error;
    }
  }

  /**
   * Flush buffer to database
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const events = [...this.buffer];
    this.buffer = [];

    try {
      const values = events.map(e => [
        e.id,
        e.eventType,
        e.category,
        e.severity,
        e.userId,
        e.username,
        e.userRole,
        e.ipAddress,
        e.userAgent,
        e.resource,
        e.resourceId,
        e.action,
        JSON.stringify(e.details || {}),
        e.result,
        e.errorMessage,
        e.timestamp,
        e.correlationId
      ]);

      const placeholders = values.map((_, i) => 
        `($${i * 17 + 1}, $${i * 17 + 2}, $${i * 17 + 3}, $${i * 17 + 4}, $${i * 17 + 5}, 
          $${i * 17 + 6}, $${i * 17 + 7}, $${i * 17 + 8}, $${i * 17 + 9}, $${i * 17 + 10}, 
          $${i * 17 + 11}, $${i * 17 + 12}, $${i * 17 + 13}, $${i * 17 + 14}, $${i * 17 + 15}, 
          $${i * 17 + 16}, $${i * 17 + 17})`
      ).join(', ');

      const query = `
        INSERT INTO audit_logs (
          id, event_type, category, severity, user_id, username, user_role,
          ip_address, user_agent, resource, resource_id, action, details,
          result, error_message, timestamp, correlation_id
        ) VALUES ${placeholders}
      `;

      await database.query(query, values.flat());

      logger.debug('Flushed audit events to database', { count: events.length });

    } catch (error) {
      logger.error('Failed to flush audit events', { error, eventCount: events.length });
      // Re-add events to buffer for retry
      this.buffer.unshift(...events);
    }
  }

  /**
   * Start flush interval
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(async () => {
      await this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * Shutdown audit logger
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down audit logger');

    // Stop flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Flush remaining events
    await this.flush();

    logger.info('Audit logger shut down successfully');
  }

  /**
   * Map database row to audit event
   */
  private mapRowToEvent(row: any): AuditEvent {
    return {
      id: row.id,
      eventType: row.event_type,
      category: row.category,
      severity: row.severity,
      userId: row.user_id,
      username: row.username,
      userRole: row.user_role,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      resource: row.resource,
      resourceId: row.resource_id,
      action: row.action,
      details: row.details,
      result: row.result,
      errorMessage: row.error_message,
      timestamp: row.timestamp,
      correlationId: row.correlation_id
    };
  }

  /**
   * Convert rows to record
   */
  private rowsToRecord(rows: any[], key: string): Record<string, number> {
    const record: Record<string, number> = {};
    rows.forEach(row => {
      record[row[key]] = parseInt(row.count);
    });
    return record;
  }

  /**
   * Build date filter for queries
   */
  private buildDateFilter(startDate?: Date, endDate?: Date): string {
    const conditions: string[] = [];
    
    if (startDate || endDate) {
      if (startDate) conditions.push('timestamp >= $1');
      if (endDate) conditions.push(`timestamp <= $${startDate ? 2 : 1}`);
      return `WHERE ${conditions.join(' AND ')}`;
    }
    
    return '';
  }
}

export default AuditLogger.getInstance();