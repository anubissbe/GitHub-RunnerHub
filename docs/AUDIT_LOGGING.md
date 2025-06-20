# Audit Logging System

## Overview

GitHub-RunnerHub implements a comprehensive audit logging system that tracks all security-relevant events, user actions, and system operations. The audit system provides complete traceability, compliance support, and security monitoring capabilities.

## Architecture

### Core Components

1. **AuditLogger Service** (`src/services/audit-logger.ts`)
   - Singleton service managing all audit operations
   - Event buffering for performance (100 events / 5 seconds)
   - Automatic flushing for critical events
   - Graceful shutdown with buffer persistence

2. **Audit Controller** (`src/controllers/audit-controller.ts`)
   - REST API for querying and managing audit logs
   - Export functionality (JSON/CSV)
   - Security event filtering
   - User activity tracking

3. **Database Schema** (`migrations/005_create_audit_logs_table.sql`)
   - Comprehensive audit_logs table
   - Performance indexes
   - Audit summary views
   - Suspicious activity detection functions

## Event Types

### Authentication Events
- `user.login` - Successful user login
- `user.logout` - User logout
- `user.login.failed` - Failed login attempt
- `token.refresh` - JWT token refresh
- `token.expired` - Token expiration

### User Management
- `user.created` - New user account created
- `user.updated` - User details modified
- `user.deleted` - User account removed
- `user.role.changed` - User role modification
- `user.activated` - Account activation
- `user.deactivated` - Account deactivation

### Job Operations
- `job.created` - New job created
- `job.started` - Job execution started
- `job.completed` - Job completed successfully
- `job.failed` - Job execution failed
- `job.cancelled` - Job cancelled
- `job.delegated` - Job delegated to runner

### Runner Operations
- `runner.created` - New runner created
- `runner.started` - Runner started
- `runner.stopped` - Runner stopped
- `runner.deleted` - Runner removed
- `runner.scaled` - Runner pool scaled

### Container Operations
- `container.created` - Container created
- `container.started` - Container started
- `container.stopped` - Container stopped
- `container.removed` - Container removed
- `container.exec` - Command executed in container

### Network Operations
- `network.created` - Network created
- `network.removed` - Network removed
- `network.attached` - Container attached to network
- `network.detached` - Container detached from network
- `network.cleanup` - Network cleanup performed

### System Operations
- `system.start` - System started
- `system.stop` - System stopped
- `system.config.changed` - Configuration modified
- `secret.rotated` - Secrets rotated
- `webhook.received` - GitHub webhook received
- `webhook.processed` - Webhook processed

### Security Events
- `security.unauthorized` - Unauthorized access attempt
- `security.permission.denied` - Permission denied
- `security.suspicious` - Suspicious activity detected
- `security.rate.limit` - Rate limit exceeded

### Data Operations
- `data.exported` - Data exported
- `data.imported` - Data imported
- `data.deleted` - Data deleted
- `backup.created` - Backup created
- `backup.restored` - Backup restored

## Event Categories

- `authentication` - Login/logout events
- `authorization` - Permission-related events
- `user_management` - User CRUD operations
- `job_management` - Job lifecycle events
- `runner_management` - Runner operations
- `container_management` - Container lifecycle
- `network_management` - Network operations
- `system_management` - System-level events
- `security` - Security-related events
- `data_management` - Data operations

## Severity Levels

- `info` - Normal operations
- `warning` - Potentially problematic events
- `error` - Error conditions
- `critical` - Critical security events

## API Endpoints

### Query Audit Logs
```http
GET /api/audit/logs
Authorization: Bearer <token>

Query Parameters:
- startDate: ISO 8601 date
- endDate: ISO 8601 date
- eventTypes: Comma-separated event types
- categories: Comma-separated categories
- severities: Comma-separated severities
- userId: Filter by user ID
- username: Filter by username (partial match)
- resource: Filter by resource type
- result: Filter by result (success/failure)
- limit: Max results (1-1000, default: 100)
- offset: Pagination offset

Response:
{
  "success": true,
  "data": {
    "logs": [...],
    "query": {...},
    "count": 100
  }
}
```

### Get Audit Statistics
```http
GET /api/audit/stats
Authorization: Bearer <token>

Query Parameters:
- startDate: ISO 8601 date
- endDate: ISO 8601 date

Response:
{
  "success": true,
  "data": {
    "stats": {
      "totalEvents": 1523,
      "eventsByCategory": {...},
      "eventsBySeverity": {...},
      "eventsByResult": {...},
      "topUsers": [...],
      "topEventTypes": [...],
      "failureRate": 2.5
    }
  }
}
```

### Export Audit Logs
```http
GET /api/audit/export?format=csv
Authorization: Bearer <token>

Query Parameters:
- format: json or csv (default: json)
- All query parameters from /logs endpoint

Response: File download
```

### Get Security Events
```http
GET /api/audit/security
Authorization: Bearer <token> (Admin only)

Query Parameters:
- startDate: ISO 8601 date (default: last 24h)
- endDate: ISO 8601 date
- includeLowSeverity: Include info events (default: false)

Response:
{
  "success": true,
  "data": {
    "events": [...],
    "summary": {
      "critical": 2,
      "error": 5,
      "warning": 15,
      "info": 0
    }
  }
}
```

### Get User Activity
```http
GET /api/audit/users/:userId
Authorization: Bearer <token> (Operator+)

Query Parameters:
- startDate: ISO 8601 date (default: last 7 days)
- endDate: ISO 8601 date
- limit: Max results
- offset: Pagination

Response:
{
  "success": true,
  "data": {
    "userId": "...",
    "events": [...],
    "summary": {
      "totalActions": 245,
      "successfulActions": 240,
      "failedActions": 5,
      "lastActivity": "2025-06-19T10:30:00Z",
      "mostCommonActions": [...],
      "affectedResources": {...}
    }
  }
}
```

### Get Resource History
```http
GET /api/audit/resources/:resourceType/:resourceId
Authorization: Bearer <token> (Operator+)

Response:
{
  "success": true,
  "data": {
    "resourceType": "job",
    "resourceId": "...",
    "events": [...],
    "timeline": {
      "created": "...",
      "lastModified": "...",
      "lastAccessed": "...",
      "totalModifications": 12,
      "modifiedBy": ["user1", "user2"]
    }
  }
}
```

### Cleanup Old Logs
```http
POST /api/audit/cleanup
Authorization: Bearer <token> (Admin only)
Content-Type: application/json

{
  "retentionDays": 90
}

Response:
{
  "success": true,
  "data": {
    "deletedCount": 15234,
    "retentionDays": 90,
    "cutoffDate": "2025-03-19T00:00:00Z"
  }
}
```

## Integration Examples

### Logging Authentication Events
```typescript
// Successful login
await auditLogger.logSuccessfulLogin(
  user.id,
  user.username,
  req.ip,
  req.headers['user-agent']
);

// Failed login
await auditLogger.logFailedLogin(
  username,
  'Invalid password',
  req.ip,
  req.headers['user-agent']
);
```

### Logging Job Operations
```typescript
await auditLogger.logJobOperation(
  AuditEventType.JOB_CREATED,
  jobId,
  repository,
  userId,
  username,
  { workflowName, runId }
);
```

### Logging Security Events
```typescript
await auditLogger.logSecurityEvent(
  AuditEventType.SUSPICIOUS_ACTIVITY,
  AuditSeverity.WARNING,
  'Multiple failed login attempts detected',
  ipAddress,
  userId,
  { attemptCount: 5, timeWindow: '10 minutes' }
);
```

### Custom Event Logging
```typescript
await auditLogger.log({
  eventType: AuditEventType.SYSTEM_CONFIG_CHANGED,
  category: AuditCategory.SYSTEM_MANAGEMENT,
  severity: AuditSeverity.WARNING,
  userId: req.user.id,
  username: req.user.username,
  ipAddress: req.ip,
  action: 'Updated system configuration',
  details: {
    setting: 'maxConcurrentJobs',
    oldValue: 10,
    newValue: 20
  },
  result: 'success'
});
```

## Database Schema

### audit_logs Table
```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    user_id VARCHAR(255),
    username VARCHAR(255),
    user_role VARCHAR(50),
    ip_address INET,
    user_agent TEXT,
    resource VARCHAR(100),
    resource_id VARCHAR(255),
    action TEXT NOT NULL,
    details JSONB,
    result VARCHAR(20) NOT NULL,
    error_message TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    correlation_id UUID
);
```

### Indexes
- timestamp (DESC) - For time-based queries
- event_type - For filtering by event
- category - For category filtering
- severity - For security monitoring
- user_id - For user activity tracking
- resource + resource_id - For resource history
- correlation_id - For related events

### Views
- `audit_summary` - Hourly aggregated statistics
- `security_audit_events` - Security-focused events
- `user_activity_summary` - User activity overview

### Functions
- `get_audit_statistics()` - Comprehensive statistics
- `detect_suspicious_activity()` - Pattern detection
- `cleanup_audit_logs()` - Retention management

## Security Monitoring

### Suspicious Activity Detection

The system automatically detects:
1. **Rapid Failed Logins**: 5+ failures in 10 minutes
2. **Multiple IPs**: User accessing from 3+ IPs in 1 hour
3. **Excessive Permission Denials**: 10+ denials in 1 hour

### Real-time Monitoring

Subscribe to audit events:
```typescript
auditLogger.on('audit-event', (event) => {
  if (event.severity === AuditSeverity.CRITICAL) {
    // Send alert
  }
});
```

## Configuration

### Buffer Settings
```typescript
private bufferSize = 100;        // Events before flush
private flushIntervalMs = 5000;  // 5 seconds
```

### Retention Policy
- Default: 90 days
- Configurable: 7-3650 days
- Automatic cleanup available

## Performance Considerations

1. **Buffering**: Events are buffered to reduce database writes
2. **Indexes**: Optimized for common query patterns
3. **Views**: Pre-aggregated data for dashboards
4. **Cleanup**: Automatic retention management

## Compliance Support

The audit system supports compliance requirements by providing:
- Complete event traceability
- Tamper-proof logging
- Export capabilities
- Retention management
- User activity tracking
- Security event monitoring

## Best Practices

1. **Always log security events**: Authentication, authorization, suspicious activity
2. **Include context**: User, IP, resource, action details
3. **Use appropriate severity**: Critical for security breaches
4. **Leverage correlation IDs**: Group related events
5. **Regular cleanup**: Maintain retention policy
6. **Monitor critical events**: Set up alerts for severity >= warning
7. **Export for analysis**: Use CSV export for external analysis