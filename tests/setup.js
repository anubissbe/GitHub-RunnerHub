/**
 * Jest Test Setup
 * Global test configuration and utilities
 */

const { expect } = require('chai');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'test-secret-key';

// Database configuration for tests
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test_user:test_password@localhost:5432/github_runnerhub_test';
process.env.REDIS_HOST = process.env.TEST_REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.TEST_REDIS_PORT || '6379';

// Disable external services in tests
process.env.DISABLE_WEBHOOKS = 'true';
process.env.DISABLE_VAULT = 'true';
process.env.DISABLE_EXTERNAL_APIS = 'true';

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

// Suppress console logs in tests unless LOG_TESTS is set
if (!process.env.LOG_TESTS) {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
}

// Clean up after each test
afterEach(() => {
  // Clear all mocks
  jest.clearAllMocks();
});