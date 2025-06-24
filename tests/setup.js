/**
 * Jest Test Setup - No External Dependencies
 * Provides mocks and environment setup without requiring Redis/DB
 */

// Import enum mocks
require('./mocks/index.js');

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';

// Disable external services in tests
process.env.DISABLE_WEBHOOKS = 'true';
process.env.DISABLE_VAULT = 'true';
process.env.DISABLE_EXTERNAL_APIS = 'true';

// Mock external dependencies that might not be available
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    flushdb: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    on: jest.fn(),
    off: jest.fn(),
    status: 'ready'
  }));
});

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
  })),
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn()
    }),
    end: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
  }))
}));

// Test timeouts
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
  // Sleep utility for async tests
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Mock request object
  mockRequest: (overrides = {}) => ({
    body: {},
    params: {},
    query: {},
    headers: {},
    user: null,
    ...overrides
  }),
  
  // Mock response object
  mockResponse: () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.end = jest.fn().mockReturnValue(res);
    return res;
  },
  
  // Generate test user
  createTestUser: (overrides = {}) => ({
    id: 'test-user-1',
    username: 'testuser',
    email: 'test@example.com',
    role: 'operator',
    created_at: new Date(),
    ...overrides
  }),
  
  // Generate test job
  createTestJob: (overrides = {}) => ({
    id: 'test-job-1',
    repository: 'test/repo',
    workflow: 'test-workflow',
    status: 'pending',
    created_at: new Date(),
    ...overrides
  })
};

// Mock console to reduce noise during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock timers for testing intervals and timeouts
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

// Global test utilities
global.createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

global.createMockDatabase = () => ({
  query: jest.fn(),
  getActiveContainers: jest.fn().mockResolvedValue([]),
  saveContainer: jest.fn(),
  removeContainer: jest.fn(),
  createAssignment: jest.fn(),
  completeAssignment: jest.fn(),
  updateJobStatus: jest.fn(),
  saveJobStatus: jest.fn(),
  markJobStatusReported: jest.fn(),
  getPendingStatusUpdates: jest.fn().mockResolvedValue([]),
  appendJobLogs: jest.fn(),
  updateJobCheckRunId: jest.fn(),
  getJob: jest.fn(),
  createContainerAssignment: jest.fn(),
  getInterruptedJobs: jest.fn().mockResolvedValue([]),
  createMigrationRules: jest.fn(),
  saveAlert: jest.fn(),
  updateAlert: jest.fn(),
  cleanupOldMetrics: jest.fn(),
  cleanupOldLogs: jest.fn(),
  cleanupOldAlerts: jest.fn()
});

global.createMockGitHubService = () => ({
  createCheckRun: jest.fn(),
  updateCheckRun: jest.fn(),
  removeRunner: jest.fn()
});

global.createMockContainerPool = () => ({
  initialize: jest.fn(),
  acquireContainer: jest.fn(),
  releaseContainer: jest.fn()
});

global.createMockMetricsCollector = () => ({
  recordAssignment: jest.fn(),
  recordJobDuration: jest.fn(),
  recordOrchestratorHealth: jest.fn(),
  recordOrchestratorMetrics: jest.fn(),
  recordStatusReports: jest.fn(),
  recordMetricSnapshot: jest.fn(),
  recordMetricDeltas: jest.fn()
});

// Custom Jest matchers
expect.extend({
  toBeWithinRange(received, floor, ceiling) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
});

console.log('Jest test setup complete - external dependencies mocked');