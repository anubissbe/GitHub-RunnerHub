# Comprehensive Testing Guide

This document describes the comprehensive testing framework implemented for GitHub-RunnerHub, covering all aspects of quality assurance from unit tests to load testing.

## 🧪 Testing Overview

The testing framework consists of 5 major components:

1. **Unit Tests** - Test individual components and services
2. **Integration Tests** - Test API endpoints and service interactions
3. **End-to-End Tests** - Test complete user workflows
4. **Security Tests** - Test for vulnerabilities and security issues
5. **Load Tests** - Test performance under various load conditions

## 📋 Quick Start

### Run All Tests
```bash
npm run test:comprehensive
```

### Run Specific Test Types
```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# End-to-end tests
npm run test:e2e

# Security tests
npm run test:security

# Load tests
npm run test:load
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Watch Mode for Development
```bash
npm run test:watch
```

## 🔧 Test Configuration

### Jest Configuration
The project uses a comprehensive Jest configuration (`jest.config.comprehensive.js`) with:

- **Multi-project setup** for different test types
- **Coverage thresholds** (70% minimum)
- **Custom test environments** for different scenarios
- **Global setup/teardown** for test database and Redis

### Environment Variables
Tests use these environment variables:
```bash
NODE_ENV=test
DATABASE_URL=postgresql://test_user:test_password@localhost:5432/github_runnerhub_test
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=test-secret-key
LOG_LEVEL=error
DISABLE_WEBHOOKS=true
DISABLE_VAULT=true
DISABLE_EXTERNAL_APIS=true
```

## 📁 Test Structure

```
tests/
├── setup.js                           # Global test utilities
├── global-setup.js                    # Global setup
├── global-teardown.js                 # Global cleanup
├── unit/                              # Unit tests
│   ├── services/
│   │   ├── monitoring.comprehensive.test.ts
│   │   └── ...
│   └── controllers/
├── integration/                       # Integration tests
│   ├── api-endpoints.test.ts
│   └── ...
├── e2e/                              # End-to-end tests
│   ├── comprehensive-workflow.test.js
│   └── ...
├── security/                         # Security tests
│   ├── penetration-tests.js
│   └── ...
└── load/                             # Load testing
    ├── artillery-config.yml
    └── load-test-processor.js
```

## 🧩 Unit Tests

Unit tests focus on testing individual components in isolation.

### Example Unit Test
```typescript
describe('MonitoringService', () => {
  let monitoringService: MonitoringService;

  beforeEach(() => {
    monitoringService = new MonitoringService();
  });

  it('should collect system metrics', async () => {
    const metrics = await monitoringService.getSystemMetrics();
    
    expect(metrics).toHaveProperty('cpu');
    expect(metrics).toHaveProperty('memory');
    expect(typeof metrics.cpu.usage).toBe('number');
  });
});
```

### Coverage Requirements
- **Lines**: 70% minimum
- **Functions**: 70% minimum
- **Branches**: 70% minimum
- **Statements**: 70% minimum

## 🔗 Integration Tests

Integration tests verify that different components work together correctly.

### API Endpoint Testing
```typescript
describe('Jobs API', () => {
  it('should create a new job', async () => {
    const response = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        repository: 'test/repo',
        workflow: 'test-workflow'
      });

    expect(response.status).to.equal(201);
    expect(response.body).to.have.property('id');
  });
});
```

### Database Integration
- Tests use a separate test database
- Automatic cleanup after each test
- Transaction rollback for isolation

## 🎭 End-to-End Tests

E2E tests simulate complete user workflows from start to finish.

### Workflow Testing
- **Job Lifecycle**: Creation → Execution → Completion
- **Runner Management**: Registration → Status Updates → Deregistration
- **Monitoring**: Real-time updates via WebSocket
- **Error Handling**: Graceful failure recovery

### Test Scenarios
1. Complete job execution workflow
2. Runner registration and management
3. Real-time monitoring and alerts
4. Security and RBAC enforcement
5. Error handling and recovery

## 🔒 Security Tests

Security tests check for vulnerabilities and attack vectors.

### Test Categories
- **Authentication Security**: Brute force protection, weak passwords
- **Input Validation**: SQL injection, XSS, path traversal
- **Authorization**: RBAC, privilege escalation
- **Data Protection**: Information disclosure, secure headers
- **Session Management**: Session fixation, secure cookies

### Example Security Test
```javascript
it('should prevent SQL injection attacks', async () => {
  const sqlPayloads = [
    "'; DROP TABLE users; --",
    "1' OR '1'='1"
  ];

  for (const payload of sqlPayloads) {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: payload, password: 'password' });

    expect(response.status).to.not.equal(200);
    expect(response.body.error || '').to.not.include('SQL');
  }
});
```

## ⚡ Load Tests

Load tests evaluate system performance under various traffic conditions.

### Artillery Configuration
The load testing uses Artillery with these phases:
1. **Warm-up**: 5 requests/second for 30 seconds
2. **Load Test**: 50 requests/second for 2 minutes
3. **Spike Test**: 100 requests/second for 1 minute
4. **Sustained Load**: 75 requests/second for 5 minutes

### Test Scenarios
- Health check endpoints
- Authentication workflows
- Job management operations
- Runner operations
- Monitoring and metrics

### Performance Metrics
- **Response Time**: Average, P95, P99
- **Throughput**: Requests per second
- **Error Rate**: Failed requests percentage
- **Resource Usage**: CPU, memory, database connections

## 🚀 Running Tests in CI/CD

### GitHub Actions Integration
The comprehensive testing workflow runs:
- On every push to main/develop branches
- On pull requests
- Daily scheduled runs for regression testing

### Test Matrix
Tests run against multiple Node.js versions:
- Node.js 18.x
- Node.js 20.x
- Node.js 22.x

### Services
CI includes required services:
- PostgreSQL 15
- Redis 7

## 📊 Test Reporting

### Coverage Reports
- **HTML Report**: `coverage/lcov-report/index.html`
- **LCOV Format**: `coverage/lcov.info`
- **JSON Format**: `coverage/coverage-final.json`

### Load Test Reports
- Response time percentiles
- Error rate analysis
- Throughput metrics
- Resource utilization

### Security Scan Reports
- Vulnerability assessment
- Dependency security audit
- SARIF format for GitHub Security tab

## 🛠 Test Utilities

### Global Test Utilities
```javascript
// Sleep utility
await testUtils.sleep(1000);

// Mock request/response
const req = testUtils.mockRequest({ body: { test: true } });
const res = testUtils.mockResponse();

// Test data generators
const user = testUtils.createTestUser({ role: 'admin' });
const job = testUtils.createTestJob({ status: 'pending' });
```

### Custom Matchers
Additional Jest matchers for specific assertions:
- `toBeValidJobId()` - Validates job ID format
- `toHaveValidTimestamp()` - Validates timestamp format
- `toBeHealthyStatus()` - Validates health check response

## 🐛 Debugging Tests

### Running Single Tests
```bash
# Run specific test file
npm test -- tests/unit/services/monitoring.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="should collect metrics"

# Run tests in debug mode
npm test -- --inspect-brk
```

### Debug Configuration
- Enable test logging: `LOG_TESTS=true npm test`
- Increase timeout: Add `this.timeout(10000)` in tests
- Skip cleanup: `SKIP_CLEANUP=true npm test`

## 📝 Writing New Tests

### Best Practices
1. **Descriptive Names**: Use clear, descriptive test names
2. **Arrange-Act-Assert**: Structure tests clearly
3. **Isolation**: Each test should be independent
4. **Cleanup**: Always clean up test data
5. **Mocking**: Mock external dependencies
6. **Error Cases**: Test both success and failure scenarios

### Test Template
```typescript
describe('FeatureName', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  describe('when condition', () => {
    it('should do expected behavior', async () => {
      // Arrange
      const input = setupTestData();

      // Act
      const result = await systemUnderTest.method(input);

      // Assert
      expect(result).toHaveProperty('expectedProperty');
    });
  });
});
```

## 🔄 Continuous Testing

### Pre-commit Hooks
- Run linter and type check
- Run relevant unit tests
- Validate commit message format

### Development Workflow
1. Write tests first (TDD approach)
2. Implement feature
3. Run tests locally
4. Commit and push
5. CI runs full test suite
6. Merge after all tests pass

## 📚 Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Artillery Documentation](https://www.artillery.io/docs)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)

## 🆘 Troubleshooting

### Common Issues

**Database Connection Errors**
```bash
# Start test database
docker run -d --name test-postgres -p 5432:5432 -e POSTGRES_PASSWORD=test_password postgres:15
```

**Redis Connection Errors**
```bash
# Start test Redis
docker run -d --name test-redis -p 6379:6379 redis:7
```

**Memory Issues**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
```

**Test Timeouts**
- Increase Jest timeout in configuration
- Check for hanging promises or connections
- Ensure proper cleanup in afterEach/afterAll hooks

---

For questions or issues with testing, please check the troubleshooting section or create an issue in the repository.