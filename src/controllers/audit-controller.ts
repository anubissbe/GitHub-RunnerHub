import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import auditLogger, { AuditEventType, AuditCategory, AuditSeverity, AuditQuery, AuditEvent } from '../services/audit-logger';

interface AuthenticatedRequest extends Request {
  user?: {
    id?: string;
    username?: string;
  };
}

const logger = createLogger('AuditController');

export class AuditController {
  /**
   * Query audit logs
   * GET /api/audit/logs
   */
  async queryLogs(req: Request, res: Response): Promise<void> {
    try {
      const query: AuditQuery = {
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        eventTypes: req.query.eventTypes ? (req.query.eventTypes as string).split(',') as AuditEventType[] : undefined,
        categories: req.query.categories ? (req.query.categories as string).split(',') as AuditCategory[] : undefined,
        severities: req.query.severities ? (req.query.severities as string).split(',') as AuditSeverity[] : undefined,
        userId: req.query.userId as string,
        username: req.query.username as string,
        resource: req.query.resource as string,
        result: req.query.result as 'success' | 'failure',
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0
      };

      // Validate date range
      if (query.startDate && query.endDate && query.startDate > query.endDate) {
        res.status(400).json({
          success: false,
          error: 'Start date must be before end date'
        });
        return;
      }

      // Validate limit
      if (query.limit && (query.limit < 1 || query.limit > 1000)) {
        res.status(400).json({
          success: false,
          error: 'Limit must be between 1 and 1000'
        });
        return;
      }

      const logs = await auditLogger.query(query);

      // Log the audit query itself
      await auditLogger.log({
        eventType: AuditEventType.DATA_EXPORTED,
        category: AuditCategory.DATA_MANAGEMENT,
        severity: AuditSeverity.INFO,
        userId: (req as AuthenticatedRequest).user?.id,
        username: (req as AuthenticatedRequest).user?.username,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        action: 'Query audit logs',
        details: {
          query,
          resultCount: logs.length
        },
        result: 'success'
      });

      res.json({
        success: true,
        data: {
          logs,
          query,
          count: logs.length
        }
      });
    } catch (error) {
      logger.error('Failed to query audit logs', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to query audit logs'
      });
    }
  }

  /**
   * Get audit statistics
   * GET /api/audit/stats
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const stats = await auditLogger.getStats(startDate, endDate);

      res.json({
        success: true,
        data: {
          stats,
          dateRange: {
            startDate,
            endDate
          }
        }
      });
    } catch (error) {
      logger.error('Failed to get audit stats', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get audit statistics'
      });
    }
  }

  /**
   * Export audit logs
   * GET /api/audit/export
   */
  async exportLogs(req: Request, res: Response): Promise<void> {
    try {
      const format = (req.query.format as 'json' | 'csv') || 'json';
      
      const query: AuditQuery = {
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        eventTypes: req.query.eventTypes ? (req.query.eventTypes as string).split(',') as AuditEventType[] : undefined,
        categories: req.query.categories ? (req.query.categories as string).split(',') as AuditCategory[] : undefined,
        severities: req.query.severities ? (req.query.severities as string).split(',') as AuditSeverity[] : undefined,
        userId: req.query.userId as string,
        username: req.query.username as string,
        resource: req.query.resource as string,
        result: req.query.result as 'success' | 'failure',
        limit: req.query.limit ? parseInt(req.query.limit as string) : 10000,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0
      };

      const data = await auditLogger.export(query, format);

      // Set appropriate headers
      const filename = `audit-logs-${new Date().toISOString().split('T')[0]}.${format}`;
      res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      // Log the export
      await auditLogger.log({
        eventType: AuditEventType.DATA_EXPORTED,
        category: AuditCategory.DATA_MANAGEMENT,
        severity: AuditSeverity.WARNING,
        userId: (req as AuthenticatedRequest).user?.id,
        username: (req as AuthenticatedRequest).user?.username,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        action: 'Export audit logs',
        details: {
          format,
          query
        },
        result: 'success'
      });

      res.send(data);
    } catch (error) {
      logger.error('Failed to export audit logs', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to export audit logs'
      });
    }
  }

  /**
   * Get event types
   * GET /api/audit/event-types
   */
  async getEventTypes(_req: Request, res: Response): Promise<void> {
    try {
      const eventTypes = Object.values(AuditEventType);
      const categories = Object.values(AuditCategory);
      const severities = Object.values(AuditSeverity);

      res.json({
        success: true,
        data: {
          eventTypes,
          categories,
          severities
        }
      });
    } catch (error) {
      logger.error('Failed to get event types', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get event types'
      });
    }
  }

  /**
   * Cleanup old audit logs (admin only)
   * POST /api/audit/cleanup
   */
  async cleanup(req: Request, res: Response): Promise<void> {
    try {
      const retentionDays = parseInt(req.body.retentionDays) || 90;

      // Validate retention days
      if (retentionDays < 7 || retentionDays > 3650) {
        res.status(400).json({
          success: false,
          error: 'Retention days must be between 7 and 3650'
        });
        return;
      }

      const deletedCount = await auditLogger.cleanup(retentionDays);

      // Log the cleanup operation (this is also done internally)
      logger.info('Audit log cleanup completed', {
        retentionDays,
        deletedCount,
        requestedBy: (req as AuthenticatedRequest).user?.username
      });

      res.json({
        success: true,
        data: {
          deletedCount,
          retentionDays,
          cutoffDate: new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
        }
      });
    } catch (error) {
      logger.error('Failed to cleanup audit logs', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to cleanup audit logs'
      });
    }
  }

  /**
   * Get security events (admin only)
   * GET /api/audit/security
   */
  async getSecurityEvents(req: Request, res: Response): Promise<void> {
    try {
      const query: AuditQuery = {
        categories: [AuditCategory.SECURITY, AuditCategory.AUTHENTICATION, AuditCategory.AUTHORIZATION],
        severities: req.query.includeLowSeverity === 'true' 
          ? undefined 
          : [AuditSeverity.WARNING, AuditSeverity.ERROR, AuditSeverity.CRITICAL],
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 24 * 60 * 60 * 1000), // Default: last 24 hours
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0
      };

      const events = await auditLogger.query(query);

      // Group by severity for summary
      const summary = {
        critical: events.filter(e => e.severity === AuditSeverity.CRITICAL).length,
        error: events.filter(e => e.severity === AuditSeverity.ERROR).length,
        warning: events.filter(e => e.severity === AuditSeverity.WARNING).length,
        info: events.filter(e => e.severity === AuditSeverity.INFO).length
      };

      res.json({
        success: true,
        data: {
          events,
          summary,
          query
        }
      });
    } catch (error) {
      logger.error('Failed to get security events', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get security events'
      });
    }
  }

  /**
   * Get user activity
   * GET /api/audit/users/:userId
   */
  async getUserActivity(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      
      const query: AuditQuery = {
        userId,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Default: last 7 days
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0
      };

      const events = await auditLogger.query(query);

      // Calculate activity summary
      const activitySummary = {
        totalActions: events.length,
        successfulActions: events.filter(e => e.result === 'success').length,
        failedActions: events.filter(e => e.result === 'failure').length,
        lastActivity: events[0]?.timestamp,
        mostCommonActions: this.getTopActions(events, 5),
        affectedResources: this.getAffectedResources(events)
      };

      res.json({
        success: true,
        data: {
          userId,
          events,
          summary: activitySummary
        }
      });
    } catch (error) {
      logger.error('Failed to get user activity', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get user activity'
      });
    }
  }

  /**
   * Get resource history
   * GET /api/audit/resources/:resourceType/:resourceId
   */
  async getResourceHistory(req: Request, res: Response): Promise<void> {
    try {
      const { resourceType, resourceId } = req.params;
      
      const query: AuditQuery = {
        resource: resourceType,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0
      };

      // Query all events for this resource type
      const allEvents = await auditLogger.query(query);
      
      // Filter by resourceId
      const events = allEvents.filter(e => e.resourceId === resourceId);

      // Build timeline
      const timeline = {
        created: events.find(e => e.action.includes('created'))?.timestamp,
        lastModified: events.filter(e => e.action.includes('updated')).pop()?.timestamp,
        lastAccessed: events[0]?.timestamp,
        totalModifications: events.filter(e => e.action.includes('updated')).length,
        modifiedBy: [...new Set(events.filter(e => e.username).map(e => e.username))]
      };

      res.json({
        success: true,
        data: {
          resourceType,
          resourceId,
          events,
          timeline
        }
      });
    } catch (error) {
      logger.error('Failed to get resource history', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get resource history'
      });
    }
  }

  /**
   * Helper: Get top actions from events
   */
  private getTopActions(events: AuditEvent[], limit: number): Array<{ action: string; count: number }> {
    const actionCounts: Record<string, number> = {};
    
    events.forEach(event => {
      actionCounts[event.action] = (actionCounts[event.action] || 0) + 1;
    });

    return Object.entries(actionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([action, count]) => ({ action, count }));
  }

  /**
   * Helper: Get affected resources from events
   */
  private getAffectedResources(events: AuditEvent[]): Record<string, number> {
    const resources: Record<string, number> = {};
    
    events.forEach(event => {
      if (event.resource) {
        resources[event.resource] = (resources[event.resource] || 0) + 1;
      }
    });

    return resources;
  }
}

export default new AuditController();