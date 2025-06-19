# Jest - Testing Framework

## Overview

Jest is a comprehensive JavaScript testing framework developed by Facebook. In GitHub RunnerHub, Jest provides unit testing, integration testing, and code coverage analysis across the entire application stack, ensuring reliability and maintainability.

## Official Resources

- **Jest Official Site**: https://jestjs.io/
- **Getting Started Guide**: https://jestjs.io/docs/getting-started
- **Configuration Reference**: https://jestjs.io/docs/configuration
- **API Reference**: https://jestjs.io/docs/api
- **Testing Best Practices**: https://jestjs.io/docs/testing-asynchronous-code

## Integration with GitHub RunnerHub

### Jest Configuration

```javascript
// jest.config.js
module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Roots for test discovery
  roots: ['<rootDir>/backend', '<rootDir>/frontend', '<rootDir>/shared'],
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.(js|ts)',
    '**/*.(test|spec).(js|ts)',
    '**/*.integration.test.(js|ts)'
  ],
  
  // Transform configuration
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': 'babel-jest'
  },
  
  // Module file extensions
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  
  // Module name mapping
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/backend/src/$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1'
  },
  
  // Setup files
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.js',
    '<rootDir>/tests/matchers.js'
  ],
  
  // Coverage configuration
  collectCoverage: true,
  collectCoverageFrom: [
    'backend/src/**/*.{js,ts}',
    'frontend/src/**/*.{js,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**',
    '!**/*.config.js'
  ],
  
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov',
    'json'
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    // Stricter thresholds for critical modules
    './backend/src/services/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './backend/src/auth/': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95
    }
  },
  
  // Test timeout
  testTimeout: 30000,
  
  // Reporters
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: './test-results',
      outputName: 'junit.xml'
    }],
    ['jest-html-reporters', {
      publicPath: './test-results',
      filename: 'report.html',
      expand: true
    }]
  ],
  
  // Global setup and teardown
  globalSetup: '<rootDir>/tests/global-setup.js',
  globalTeardown: '<rootDir>/tests/global-teardown.js',
  
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  
  // Verbose output
  verbose: process.env.CI ? false : true,
  
  // Projects for monorepo support
  projects: [
    {
      displayName: 'backend',
      testMatch: ['<rootDir>/backend/**/*.test.js'],
      testEnvironment: 'node'
    },
    {
      displayName: 'frontend',
      testMatch: ['<rootDir>/frontend/**/*.test.{js,ts,tsx}'],
      testEnvironment: 'jsdom',
      setupFilesAfterEnv: ['<rootDir>/frontend/tests/setup.js']
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      testEnvironment: 'node',
      testTimeout: 60000
    }
  ]
};
```

### Test Setup Files

```javascript
// tests/setup.js - Global test setup
const { MongoMemoryServer } = require('mongodb-memory-server');
const redis = require('redis-mock');

// Global test database
let mongoServer;
let redisClient;

// Setup before all tests
beforeAll(async () => {
  // Start in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  process.env.TEST_DATABASE_URL = mongoUri;
  
  // Setup Redis mock
  redisClient = redis.createClient();
  global.redisClient = redisClient;
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-key';
  process.env.GITHUB_TOKEN = 'test-github-token';
  
  console.log('🧪 Test environment initialized');
});

// Cleanup after all tests
afterAll(async () => {
  if (mongoServer) {
    await mongoServer.stop();
  }
  
  if (redisClient) {
    redisClient.quit();
  }
  
  console.log('🧹 Test environment cleaned up');
});

// Reset database between tests
beforeEach(async () => {
  if (global.db) {
    await global.db.dropDatabase();
  }
});
```

```javascript
// tests/matchers.js - Custom Jest matchers
expect.extend({
  toBeValidRunner(received) {
    const pass = received &&
                 typeof received.id === 'string' &&
                 typeof received.name === 'string' &&
                 typeof received.status === 'string' &&
                 ['idle', 'busy', 'offline'].includes(received.status);

    return {
      message: () => `expected ${received} to be a valid runner object`,
      pass
    };
  },

  toHaveValidJWT(received) {
    const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
    const pass = typeof received === 'string' && jwtRegex.test(received);

    return {
      message: () => `expected ${received} to be a valid JWT token`,
      pass
    };
  },

  toBeWithinTimeRange(received, expectedTime, toleranceMs = 1000) {
    const receivedTime = new Date(received).getTime();
    const expectedTimeMs = new Date(expectedTime).getTime();
    const pass = Math.abs(receivedTime - expectedTimeMs) <= toleranceMs;

    return {
      message: () => `expected ${received} to be within ${toleranceMs}ms of ${expectedTime}`,
      pass
    };
  },

  toHaveDockerContainer(received, containerName) {
    const pass = received &&
                 Array.isArray(received) &&
                 received.some(container => container.name === containerName);

    return {
      message: () => `expected Docker client to have container "${containerName}"`,
      pass
    };
  }
});
```

### Testing Patterns for GitHub RunnerHub

```javascript
// backend/tests/services/runner-manager.test.js
const RunnerManager = require('../../src/services/runner-manager');
const DockerClient = require('../../src/services/docker-client');

jest.mock('../../src/services/docker-client');

describe('RunnerManager', () => {
  let runnerManager;
  let mockDockerClient;

  beforeEach(() => {
    mockDockerClient = new DockerClient();
    runnerManager = new RunnerManager(mockDockerClient);
  });

  describe('createRunner', () => {
    test('should create a new runner with valid configuration', async () => {
      // Arrange
      const runnerConfig = {
        name: 'test-runner',
        repository: 'test/repo',
        type: 'dedicated'
      };

      mockDockerClient.createRunnerContainer.mockResolvedValue({
        id: 'container-123',
        name: 'test-runner',
        created: true
      });

      // Act
      const result = await runnerManager.createRunner(runnerConfig);

      // Assert
      expect(result).toBeValidRunner();
      expect(result.name).toBe('test-runner');
      expect(mockDockerClient.createRunnerContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-runner',
          repository: 'test/repo'
        })
      );
    });

    test('should throw error for invalid repository format', async () => {
      // Arrange
      const invalidConfig = {
        name: 'test-runner',
        repository: 'invalid-repo-format',
        type: 'dedicated'
      };

      // Act & Assert
      await expect(runnerManager.createRunner(invalidConfig))
        .rejects
        .toThrow('Invalid repository format');
    });

    test('should handle Docker creation failure', async () => {
      // Arrange
      const runnerConfig = {
        name: 'test-runner',
        repository: 'test/repo',
        type: 'dedicated'
      };

      mockDockerClient.createRunnerContainer.mockRejectedValue(
        new Error('Docker creation failed')
      );

      // Act & Assert
      await expect(runnerManager.createRunner(runnerConfig))
        .rejects
        .toThrow('Docker creation failed');
    });
  });

  describe('scaleRunners', () => {
    test('should scale up runners when demand is high', async () => {
      // Arrange
      const repository = 'test/repo';
      const targetCount = 3;

      mockDockerClient.getRunnerContainers.mockResolvedValue([
        { id: '1', name: 'runner-1', state: 'running' }
      ]);

      mockDockerClient.createRunnerContainer.mockResolvedValue({
        id: 'new-container',
        name: 'dynamic-runner',
        created: true
      });

      // Act
      const result = await runnerManager.scaleRunners(repository, targetCount);

      // Assert
      expect(result.scaled).toBe(true);
      expect(result.newRunners).toBe(2);
      expect(mockDockerClient.createRunnerContainer).toHaveBeenCalledTimes(2);
    });

    test('should not scale when already at target', async () => {
      // Arrange
      const repository = 'test/repo';
      const targetCount = 2;

      mockDockerClient.getRunnerContainers.mockResolvedValue([
        { id: '1', name: 'runner-1', state: 'running' },
        { id: '2', name: 'runner-2', state: 'running' }
      ]);

      // Act
      const result = await runnerManager.scaleRunners(repository, targetCount);

      // Assert
      expect(result.scaled).toBe(false);
      expect(result.newRunners).toBe(0);
      expect(mockDockerClient.createRunnerContainer).not.toHaveBeenCalled();
    });
  });

  describe('getRunnerStats', () => {
    test('should return aggregated runner statistics', async () => {
      // Arrange
      mockDockerClient.getRunnerContainers.mockResolvedValue([
        { id: '1', state: 'running', labels: { repository: 'repo1' } },
        { id: '2', state: 'running', labels: { repository: 'repo1' } },
        { id: '3', state: 'running', labels: { repository: 'repo2' } }
      ]);

      // Act
      const stats = await runnerManager.getRunnerStats();

      // Assert
      expect(stats).toEqual({
        total: 3,
        running: 3,
        by_repository: {
          repo1: 2,
          repo2: 1
        }
      });
    });
  });
});
```

### API Endpoint Testing

```javascript
// backend/tests/routes/runners.test.js
const request = require('supertest');
const app = require('../../src/app');
const jwt = require('jsonwebtoken');

describe('/api/runners', () => {
  let authToken;

  beforeEach(() => {
    // Create valid JWT token for tests
    authToken = jwt.sign(
      { userId: 'test-user', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  describe('GET /api/runners', () => {
    test('should return list of runners for authenticated user', async () => {
      const response = await request(app)
        .get('/api/runners')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.headers['content-type']).toMatch(/json/);
    });

    test('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/runners')
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    test('should filter runners by repository', async () => {
      const response = await request(app)
        .get('/api/runners?repository=test/repo')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            repository: 'test/repo'
          })
        ])
      );
    });

    test('should paginate results', async () => {
      const response = await request(app)
        .get('/api/runners?page=1&limit=10')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta).toHaveProperty('page', 1);
      expect(response.body.meta).toHaveProperty('limit', 10);
    });
  });

  describe('POST /api/runners', () => {
    test('should create new runner with valid data', async () => {
      const newRunner = {
        name: 'test-runner',
        repository: 'test/repo',
        type: 'dedicated'
      };

      const response = await request(app)
        .post('/api/runners')
        .set('Authorization', `Bearer ${authToken}`)
        .send(newRunner)
        .expect(201);

      expect(response.body.data).toMatchObject(newRunner);
      expect(response.body.data).toHaveProperty('id');
      expect(response.headers.location).toBeDefined();
    });

    test('should validate required fields', async () => {
      const invalidRunner = {
        name: 'test-runner'
        // Missing repository
      };

      const response = await request(app)
        .post('/api/runners')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidRunner)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'repository',
            message: expect.stringContaining('required')
          })
        ])
      );
    });

    test('should validate repository format', async () => {
      const invalidRunner = {
        name: 'test-runner',
        repository: 'invalid-format',
        type: 'dedicated'
      };

      const response = await request(app)
        .post('/api/runners')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidRunner)
        .expect(400);

      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'repository',
            message: expect.stringContaining('format')
          })
        ])
      );
    });
  });

  describe('DELETE /api/runners/:id', () => {
    test('should remove runner successfully', async () => {
      // First create a runner
      const createResponse = await request(app)
        .post('/api/runners')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'temp-runner',
          repository: 'test/repo',
          type: 'dynamic'
        });

      const runnerId = createResponse.body.data.id;

      // Then delete it
      await request(app)
        .delete(`/api/runners/${runnerId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);
    });

    test('should return 404 for non-existent runner', async () => {
      await request(app)
        .delete('/api/runners/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });
});
```

### Testing Utilities

```javascript
// tests/utils/test-helpers.js
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');

class TestHelpers {
  static createMockRunner(overrides = {}) {
    return {
      id: 'mock-runner-id',
      name: 'mock-runner',
      repository: 'test/repo',
      status: 'idle',
      type: 'dedicated',
      created: new Date(),
      ...overrides
    };
  }

  static createAuthToken(payload = {}) {
    return jwt.sign(
      {
        userId: 'test-user',
        role: 'user',
        ...payload
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  static async waitForCondition(conditionFn, timeout = 5000, interval = 100) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await conditionFn()) {
        return true;
      }
      await this.sleep(interval);
    }
    
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static async createTestContainer(dockerClient, config = {}) {
    const defaultConfig = {
      name: 'test-container',
      image: 'myoung34/github-runner:latest',
      environment: ['REPO_URL=https://github.com/test/repo'],
      autoRemove: true,
      ...config
    };

    return await dockerClient.createRunnerContainer(defaultConfig);
  }

  static generateMockMetrics() {
    return {
      cpu: {
        usage_percent: Math.random() * 100,
        throttling: { periods: 0, throttled_periods: 0 }
      },
      memory: {
        usage_bytes: Math.floor(Math.random() * 2147483648), // Up to 2GB
        limit_bytes: 2147483648,
        usage_percent: Math.random() * 100
      },
      network: {
        rx_bytes: Math.floor(Math.random() * 1000000),
        tx_bytes: Math.floor(Math.random() * 1000000)
      },
      timestamp: new Date()
    };
  }

  static async executeCommand(command, args = []) {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });
    });
  }

  static mockWebSocket() {
    const events = new Map();
    
    return {
      on: jest.fn((event, handler) => {
        if (!events.has(event)) {
          events.set(event, []);
        }
        events.get(event).push(handler);
      }),
      
      emit: jest.fn((event, data) => {
        const handlers = events.get(event) || [];
        handlers.forEach(handler => handler(data));
      }),
      
      send: jest.fn(),
      close: jest.fn(),
      
      // Helper to trigger events in tests
      triggerEvent: (event, data) => {
        const handlers = events.get(event) || [];
        handlers.forEach(handler => handler(data));
      }
    };
  }
}

module.exports = TestHelpers;
```

## Advanced Testing Patterns

### 1. Integration Testing

```javascript
// tests/integration/workflow.integration.test.js
const request = require('supertest');
const app = require('../../backend/src/app');
const TestHelpers = require('../utils/test-helpers');

describe('Workflow Integration Tests', () => {
  let authToken;
  let createdRunners = [];

  beforeAll(async () => {
    authToken = TestHelpers.createAuthToken({ role: 'admin' });
  });

  afterAll(async () => {
    // Cleanup created runners
    for (const runner of createdRunners) {
      try {
        await request(app)
          .delete(`/api/runners/${runner.id}`)
          .set('Authorization', `Bearer ${authToken}`);
      } catch (error) {
        console.warn(`Failed to cleanup runner ${runner.id}:`, error.message);
      }
    }
  });

  test('complete workflow: create → scale → monitor → cleanup', async () => {
    // Step 1: Create initial runner
    const createResponse = await request(app)
      .post('/api/runners')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'integration-test-runner',
        repository: 'test/integration-repo',
        type: 'dedicated'
      })
      .expect(201);

    const runnerId = createResponse.body.data.id;
    createdRunners.push({ id: runnerId });

    // Step 2: Verify runner is created and active
    await TestHelpers.waitForCondition(async () => {
      const statusResponse = await request(app)
        .get(`/api/runners/${runnerId}`)
        .set('Authorization', `Bearer ${authToken}`);
      
      return statusResponse.body.data.status === 'idle';
    }, 10000);

    // Step 3: Trigger scaling
    const scaleResponse = await request(app)
      .post('/api/runners/scale')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        repository: 'test/integration-repo',
        action: 'up',
        count: 2
      })
      .expect(200);

    expect(scaleResponse.body.scaled).toBe(true);

    // Step 4: Verify additional runners were created
    const listResponse = await request(app)
      .get('/api/runners?repository=test/integration-repo')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(listResponse.body.data.length).toBeGreaterThanOrEqual(2);

    // Step 5: Check metrics
    const metricsResponse = await request(app)
      .get('/api/metrics')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(metricsResponse.body.runners.total).toBeGreaterThan(0);

    // Store all runners for cleanup
    listResponse.body.data.forEach(runner => {
      if (!createdRunners.find(r => r.id === runner.id)) {
        createdRunners.push({ id: runner.id });
      }
    });
  });

  test('webhook processing workflow', async () => {
    // Simulate GitHub webhook
    const webhookPayload = {
      action: 'requested',
      workflow_run: {
        id: 123456,
        status: 'queued',
        repository: { full_name: 'test/webhook-repo' }
      }
    };

    const webhookResponse = await request(app)
      .post('/api/public/webhooks/github')
      .set('X-GitHub-Event', 'workflow_run')
      .set('X-Hub-Signature-256', 'sha256=test-signature')
      .send(webhookPayload)
      .expect(200);

    expect(webhookResponse.body.received).toBe(true);

    // Verify scaling was triggered
    await TestHelpers.waitForCondition(async () => {
      const runnersResponse = await request(app)
        .get('/api/runners?repository=test/webhook-repo')
        .set('Authorization', `Bearer ${authToken}`);
      
      return runnersResponse.body.data.length > 0;
    }, 5000);
  });
});
```

### 2. Performance Testing

```javascript
// tests/performance/load.test.js
const request = require('supertest');
const app = require('../../backend/src/app');
const TestHelpers = require('../utils/test-helpers');

describe('Performance Tests', () => {
  let authToken;

  beforeAll(() => {
    authToken = TestHelpers.createAuthToken();
  });

  test('API should handle concurrent requests', async () => {
    const concurrentRequests = 50;
    const startTime = Date.now();

    const promises = Array.from({ length: concurrentRequests }, () =>
      request(app)
        .get('/api/runners')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
    );

    const responses = await Promise.all(promises);
    const endTime = Date.now();
    const duration = endTime - startTime;

    // All requests should complete within reasonable time
    expect(duration).toBeLessThan(5000); // 5 seconds
    
    // All requests should succeed
    responses.forEach(response => {
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
    });

    console.log(`✅ ${concurrentRequests} concurrent requests completed in ${duration}ms`);
  });

  test('memory usage should remain stable during load', async () => {
    const initialMemory = process.memoryUsage();
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      await request(app)
        .get('/api/health')
        .expect(200);
    }

    const finalMemory = process.memoryUsage();
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
    const memoryIncreasePercent = (memoryIncrease / initialMemory.heapUsed) * 100;

    // Memory increase should be reasonable (less than 50%)
    expect(memoryIncreasePercent).toBeLessThan(50);

    console.log(`📊 Memory increase: ${Math.round(memoryIncreasePercent)}% (${Math.round(memoryIncrease / 1024 / 1024)}MB)`);
  });
});
```

### 3. Snapshot Testing

```javascript
// tests/snapshots/api-responses.test.js
const request = require('supertest');
const app = require('../../backend/src/app');

describe('API Response Snapshots', () => {
  test('GET /api/health response structure', async () => {
    const response = await request(app)
      .get('/api/health')
      .expect(200);

    // Remove timestamp for consistent snapshots
    const sanitizedResponse = {
      ...response.body,
      timestamp: '[TIMESTAMP]'
    };

    expect(sanitizedResponse).toMatchSnapshot();
  });

  test('GET /api/runners response structure', async () => {
    const authToken = TestHelpers.createAuthToken();
    
    const response = await request(app)
      .get('/api/runners')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    // Sanitize dynamic data
    const sanitizedResponse = {
      ...response.body,
      data: response.body.data.map(runner => ({
        ...runner,
        id: '[RUNNER_ID]',
        created: '[TIMESTAMP]',
        updated: '[TIMESTAMP]'
      }))
    };

    expect(sanitizedResponse).toMatchSnapshot();
  });
});
```

## CI/CD Integration

### 1. GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: [self-hosted, docker, runnerhub]
    
    strategy:
      matrix:
        node-version: [16, 18, 20]
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Run integration tests
        run: npm run test:integration
      
      - name: Upload test results
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: test-results-node-${{ matrix.node-version }}
          path: |
            test-results/
            coverage/
      
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/lcov.info
          flags: unittests
          name: codecov-umbrella
```

### 2. Test Scripts

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest --testPathPattern='\\.(test|spec)\\.(js|ts)$'",
    "test:integration": "jest --testPathPattern='\\.integration\\.test\\.(js|ts)$'",
    "test:e2e": "jest --testPathPattern='\\.e2e\\.test\\.(js|ts)$'",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --coverage --watchAll=false --maxWorkers=4",
    "test:performance": "jest --testPathPattern='performance'",
    "test:snapshots": "jest --updateSnapshot"
  }
}
```

## Monitoring and Reporting

### 1. Test Metrics Collection

```javascript
// scripts/test-metrics.js
const jest = require('jest');
const fs = require('fs');

class TestMetrics {
  async collectMetrics() {
    const results = await jest.runCLI(
      {
        json: true,
        coverage: true,
        silent: true
      },
      [process.cwd()]
    );

    const testResults = results.results;
    
    const metrics = {
      summary: {
        total_tests: testResults.numTotalTests,
        passed_tests: testResults.numPassedTests,
        failed_tests: testResults.numFailedTests,
        skipped_tests: testResults.numPendingTests,
        success_rate: (testResults.numPassedTests / testResults.numTotalTests) * 100,
        execution_time: testResults.testResults.reduce((sum, r) => sum + (r.perfStats?.end - r.perfStats?.start || 0), 0)
      },
      coverage: testResults.coverageMap ? {
        lines: testResults.coverageMap.getCoverageSummary().lines.pct,
        functions: testResults.coverageMap.getCoverageSummary().functions.pct,
        branches: testResults.coverageMap.getCoverageSummary().branches.pct,
        statements: testResults.coverageMap.getCoverageSummary().statements.pct
      } : null,
      by_test_suite: testResults.testResults.map(suite => ({
        name: suite.testFilePath.replace(process.cwd(), ''),
        tests: suite.numPassingTests + suite.numFailingTests,
        passed: suite.numPassingTests,
        failed: suite.numFailingTests,
        duration: suite.perfStats?.end - suite.perfStats?.start || 0
      })),
      timestamp: new Date().toISOString()
    };

    return metrics;
  }

  async generateReport() {
    const metrics = await this.collectMetrics();
    
    const report = {
      grade: this.calculateGrade(metrics),
      metrics,
      recommendations: this.generateRecommendations(metrics)
    };

    fs.writeFileSync('test-metrics.json', JSON.stringify(report, null, 2));
    
    return report;
  }

  calculateGrade(metrics) {
    const { success_rate } = metrics.summary;
    const coverage = metrics.coverage;
    
    if (!coverage) return 'N/A';
    
    const avgCoverage = (coverage.lines + coverage.functions + coverage.branches + coverage.statements) / 4;
    
    if (success_rate === 100 && avgCoverage >= 90) return 'A';
    if (success_rate >= 95 && avgCoverage >= 80) return 'B';
    if (success_rate >= 85 && avgCoverage >= 70) return 'C';
    if (success_rate >= 70) return 'D';
    return 'F';
  }

  generateRecommendations(metrics) {
    const recommendations = [];
    
    if (metrics.summary.failed_tests > 0) {
      recommendations.push('Fix failing tests before deployment');
    }
    
    if (metrics.coverage && metrics.coverage.lines < 80) {
      recommendations.push('Increase test coverage - target 80% line coverage');
    }
    
    const slowSuites = metrics.by_test_suite
      .filter(suite => suite.duration > 5000)
      .sort((a, b) => b.duration - a.duration);
    
    if (slowSuites.length > 0) {
      recommendations.push(`Optimize slow test suites: ${slowSuites[0].name} (${slowSuites[0].duration}ms)`);
    }
    
    return recommendations;
  }
}

module.exports = TestMetrics;
```

## Related Technologies

- Mocha (alternative test framework)
- Jasmine (BDD testing framework)
- Cypress (E2E testing)
- Playwright (browser testing)
- SuperTest (HTTP assertion library)