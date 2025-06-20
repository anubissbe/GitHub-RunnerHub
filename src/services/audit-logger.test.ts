import { AuditLogger, AuditEventType, AuditCategory, AuditSeverity } from './audit-logger';

// Mock database
jest.mock('./database', () => ({
  default: {
    query: jest.fn().mockResolvedValue([]),
    transaction: jest.fn().mockImplementation(async (callback) => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rowCount: 5 })
      };
      return callback(mockClient);
    })
  }
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-uuid-1234')
}));

import database from './database';

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton
    (AuditLogger as any).instance = null;
    auditLogger = AuditLogger.getInstance();
  });

  afterEach(() => {
    // Clear any intervals
    if (auditLogger['flushInterval']) {
      clearInterval(auditLogger['flushInterval']);
    }
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = AuditLogger.getInstance();
      const instance2 = AuditLogger.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await auditLogger.initialize();
      expect(auditLogger['initialized']).toBe(true);
      expect(auditLogger['flushInterval']).toBeDefined();
    });

    it('should not initialize twice', async () => {
      await auditLogger.initialize();
      await auditLogger.initialize();
      expect(auditLogger['initialized']).toBe(true);
    });
  });

  describe('log', () => {
    beforeEach(async () => {
      await auditLogger.initialize();
    });

    it('should add event to buffer', async () => {
      const event = {
        eventType: AuditEventType.USER_LOGIN,
        category: AuditCategory.AUTHENTICATION,
        severity: AuditSeverity.INFO,
        action: 'User login',
        result: 'success' as const
      };

      await auditLogger.log(event);
      
      expect(auditLogger['buffer']).toHaveLength(1);
      expect(auditLogger['buffer'][0]).toMatchObject({
        ...event,
        id: 'test-uuid-1234',
        timestamp: expect.any(Date)
      });
    });

    it('should emit audit-event', async () => {
      const eventHandler = jest.fn();
      auditLogger.on('audit-event', eventHandler);

      const event = {
        eventType: AuditEventType.USER_LOGIN,
        category: AuditCategory.AUTHENTICATION,
        severity: AuditSeverity.INFO,
        action: 'User login',
        result: 'success' as const
      };

      await auditLogger.log(event);
      
      expect(eventHandler).toHaveBeenCalledWith(expect.objectContaining(event));
    });

    it('should flush buffer when full', async () => {
      // Set small buffer size for testing
      auditLogger['bufferSize'] = 2;
      
      const event = {
        eventType: AuditEventType.USER_LOGIN,
        category: AuditCategory.AUTHENTICATION,
        severity: AuditSeverity.INFO,
        action: 'User login',
        result: 'success' as const
      };

      await auditLogger.log(event);
      await auditLogger.log(event);
      
      // Buffer should be flushed
      expect(database.query).toHaveBeenCalled();
      expect(auditLogger['buffer']).toHaveLength(0);
    });

    it('should flush immediately for critical events', async () => {
      const event = {
        eventType: AuditEventType.UNAUTHORIZED_ACCESS,
        category: AuditCategory.SECURITY,
        severity: AuditSeverity.CRITICAL,
        action: 'Unauthorized access attempt',
        result: 'failure' as const
      };

      await auditLogger.log(event);
      
      expect(database.query).toHaveBeenCalled();
      expect(auditLogger['buffer']).toHaveLength(0);
    });
  });

  describe('logSuccessfulLogin', () => {
    beforeEach(async () => {
      await auditLogger.initialize();
    });

    it('should log successful login event', async () => {
      await auditLogger.logSuccessfulLogin(
        'user-123',
        'testuser',
        '192.168.1.1',
        'Mozilla/5.0'
      );

      expect(auditLogger['buffer']).toHaveLength(1);
      expect(auditLogger['buffer'][0]).toMatchObject({
        eventType: AuditEventType.USER_LOGIN,
        category: AuditCategory.AUTHENTICATION,
        severity: AuditSeverity.INFO,
        userId: 'user-123',
        username: 'testuser',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        action: 'User logged in successfully',
        result: 'success'
      });
    });
  });

  describe('logFailedLogin', () => {
    beforeEach(async () => {
      await auditLogger.initialize();
    });

    it('should log failed login event', async () => {
      await auditLogger.logFailedLogin(
        'testuser',
        'Invalid password',
        '192.168.1.1',
        'Mozilla/5.0'
      );

      expect(auditLogger['buffer']).toHaveLength(1);
      expect(auditLogger['buffer'][0]).toMatchObject({
        eventType: AuditEventType.USER_LOGIN_FAILED,
        category: AuditCategory.AUTHENTICATION,
        severity: AuditSeverity.WARNING,
        username: 'testuser',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        action: 'User login failed',
        details: { reason: 'Invalid password' },
        result: 'failure',
        errorMessage: 'Invalid password'
      });
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await auditLogger.initialize();
    });

    it('should query audit logs with filters', async () => {
      const mockRows = [
        {
          id: '1',
          event_type: AuditEventType.USER_LOGIN,
          category: AuditCategory.AUTHENTICATION,
          severity: AuditSeverity.INFO,
          action: 'User login',
          result: 'success',
          timestamp: new Date()
        }
      ];

      (database.query as jest.Mock).mockResolvedValue(mockRows);

      const query = {
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
        eventTypes: [AuditEventType.USER_LOGIN],
        categories: [AuditCategory.AUTHENTICATION],
        limit: 10
      };

      const results = await auditLogger.query(query);

      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.arrayContaining([
          query.startDate,
          query.endDate,
          query.eventTypes,
          query.categories,
          query.limit
        ])
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: '1',
        eventType: AuditEventType.USER_LOGIN,
        category: AuditCategory.AUTHENTICATION,
        severity: AuditSeverity.INFO,
        action: 'User login',
        result: 'success'
      });
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await auditLogger.initialize();
    });

    it('should return audit statistics', async () => {
      // Mock database responses
      (database.query as jest.Mock)
        .mockResolvedValueOnce([{ count: '100' }]) // total
        .mockResolvedValueOnce([
          { category: 'authentication', count: '50' },
          { category: 'security', count: '50' }
        ]) // by category
        .mockResolvedValueOnce([
          { severity: 'info', count: '80' },
          { severity: 'warning', count: '20' }
        ]) // by severity
        .mockResolvedValueOnce([
          { result: 'success', count: '90' },
          { result: 'failure', count: '10' }
        ]) // by result
        .mockResolvedValueOnce([
          { username: 'user1', count: '30' },
          { username: 'user2', count: '20' }
        ]) // top users
        .mockResolvedValueOnce([
          { event_type: 'user.login', count: '40' },
          { event_type: 'job.created', count: '20' }
        ]); // top events

      const stats = await auditLogger.getStats();

      expect(stats).toEqual({
        totalEvents: 100,
        eventsByCategory: {
          authentication: 50,
          security: 50
        },
        eventsBySeverity: {
          info: 80,
          warning: 20
        },
        eventsByResult: {
          success: 90,
          failure: 10
        },
        topUsers: [
          { username: 'user1', count: 30 },
          { username: 'user2', count: 20 }
        ],
        topEventTypes: [
          { eventType: 'user.login', count: 40 },
          { eventType: 'job.created', count: 20 }
        ],
        failureRate: 10
      });
    });
  });

  describe('export', () => {
    beforeEach(async () => {
      await auditLogger.initialize();
    });

    it('should export as JSON', async () => {
      const mockEvents = [
        {
          id: '1',
          eventType: AuditEventType.USER_LOGIN,
          category: AuditCategory.AUTHENTICATION,
          severity: AuditSeverity.INFO,
          action: 'User login',
          result: 'success' as const,
          timestamp: new Date('2025-01-01')
        }
      ];

      jest.spyOn(auditLogger, 'query').mockResolvedValue(mockEvents);

      const result = await auditLogger.export({}, 'json');
      const parsed = JSON.parse(result);

      expect(parsed).toEqual(mockEvents);
    });

    it('should export as CSV', async () => {
      const mockEvents = [
        {
          id: '1',
          eventType: AuditEventType.USER_LOGIN,
          category: AuditCategory.AUTHENTICATION,
          severity: AuditSeverity.INFO,
          userId: 'user-123',
          username: 'testuser',
          ipAddress: '192.168.1.1',
          action: 'User login',
          result: 'success' as const,
          timestamp: new Date('2025-01-01')
        }
      ];

      jest.spyOn(auditLogger, 'query').mockResolvedValue(mockEvents);

      const result = await auditLogger.export({}, 'csv');
      
      expect(result).toContain('ID,Timestamp,Event Type,Category,Severity');
      expect(result).toContain('"1"');
      expect(result).toContain('"user.login"');
      expect(result).toContain('"authentication"');
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      await auditLogger.initialize();
    });

    it('should cleanup old logs', async () => {
      const deletedCount = await auditLogger.cleanup(90);

      expect(database.transaction).toHaveBeenCalled();
      expect(deletedCount).toBe(5);
    });

    it('should log cleanup operation', async () => {
      const logSpy = jest.spyOn(auditLogger, 'log');
      
      await auditLogger.cleanup(90);

      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: AuditEventType.DATA_DELETED,
        category: AuditCategory.DATA_MANAGEMENT,
        severity: AuditSeverity.INFO,
        action: 'Audit log cleanup',
        result: 'success'
      }));
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await auditLogger.initialize();
    });

    it('should flush buffer on shutdown', async () => {
      // Add some events to buffer
      await auditLogger.log({
        eventType: AuditEventType.USER_LOGIN,
        category: AuditCategory.AUTHENTICATION,
        severity: AuditSeverity.INFO,
        action: 'User login',
        result: 'success'
      });

      expect(auditLogger['buffer']).toHaveLength(1);

      await auditLogger.shutdown();

      expect(database.query).toHaveBeenCalled();
      expect(auditLogger['buffer']).toHaveLength(0);
      expect(auditLogger['flushInterval']).toBeNull();
    });
  });
});