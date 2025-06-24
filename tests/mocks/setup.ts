// Mock AuditEventType enum
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

// Global type extensions
declare global {
  const AuditEventType: typeof import('./setup').AuditEventType;
}

// Export to global scope
(global as any).AuditEventType = AuditEventType;