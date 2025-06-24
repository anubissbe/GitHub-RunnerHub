// Jest setup file for orchestrator tests

import { jest, beforeEach, afterEach, expect } from '@jest/globals';

// Declare global types
declare global {
  var createMockDatabase: () => any;
  var createMockMetricsCollector: () => any;
  var createMockGitHubService: () => any;
  var createMockContainerService: () => any;
  var createMockServiceManager: () => any;
  var createMockJobQueue: () => any;
}

// Mock console methods to reduce noise during tests
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

// Mock process.env
process.env = {
  ...process.env,
  NODE_ENV: 'test',
  GITHUB_TOKEN: 'test-token',
  GITHUB_WEBHOOK_SECRET: 'test-secret',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
  REDIS_URL: 'redis://localhost:6379',
  LOG_LEVEL: 'error'
};

// Global test utilities
global.createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

global.createMockDatabase = () => ({
  query: jest.fn(),
  getActiveContainers: jest.fn().mockResolvedValue([] as any[]),
  saveContainer: jest.fn(),
  removeContainer: jest.fn(),
  createAssignment: jest.fn(),
  completeAssignment: jest.fn(),
  updateJobStatus: jest.fn(),
  saveJobStatus: jest.fn(),
  markJobStatusReported: jest.fn(),
  getPendingStatusUpdates: jest.fn().mockResolvedValue([] as any[]),
  appendJobLogs: jest.fn(),
  updateJobCheckRunId: jest.fn(),
  getJob: jest.fn(),
  createContainerAssignment: jest.fn(),
  getInterruptedJobs: jest.fn().mockResolvedValue([] as any[]),
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

// Mock implementations for common dependencies
jest.mock('../../utils/logger', () => ({
  createLogger: jest.fn(() => global.createMockLogger())
}));

jest.mock('../../services/database', () => ({
  default: global.createMockDatabase(),
  DatabaseService: {
    getInstance: jest.fn(() => global.createMockDatabase())
  }
}));

jest.mock('../../services/github-service', () => ({
  GitHubService: {
    getInstance: jest.fn(() => global.createMockGitHubService())
  }
}));

jest.mock('../../container-orchestration/pool/integrated-pool-orchestrator', () => ({
  ContainerPoolManager: {
    getInstance: jest.fn(() => global.createMockContainerPool())
  }
}));

jest.mock('../../services/monitoring', () => ({
  default: global.createMockMetricsCollector(),
  MonitoringService: {
    getInstance: jest.fn(() => global.createMockMetricsCollector())
  }
}));

jest.mock('../../queues/queue-manager', () => ({
  QueueManager: {
    getInstance: jest.fn(() => ({
      initialize: jest.fn(),
      addJob: jest.fn(),
      processJob: jest.fn()
    }))
  }
}));

jest.mock('../../queues/job-router', () => ({
  JobRouter: {
    getInstance: jest.fn(() => ({
      route: jest.fn()
    }))
  }
}));

// Custom matchers
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
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

// Declare custom matcher types
declare global {
  var createMockLogger: () => any;
  var createMockDatabase: () => any;
  var createMockGitHubService: () => any;
  var createMockContainerPool: () => any;
  var createMockMetricsCollector: () => any;
}

declare module '@jest/expect' {
  interface Matchers<R> {
    toBeWithinRange(floor: number, ceiling: number): R;
  }
}