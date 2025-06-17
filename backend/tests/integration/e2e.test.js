const { Octokit } = require('@octokit/rest');
const Docker = require('dockerode');
const request = require('supertest');
const WebSocket = require('ws');

// Mock dependencies
jest.mock('dockerode');
jest.mock('@octokit/rest');

describe('End-to-End Integration Test', () => {
  let app;
  let server;
  let authToken;
  let ws;
  let mockDocker;
  let mockOctokit;
  
  beforeAll(async () => {
    // Setup environment
    process.env.JWT_SECRET = 'test-secret';
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_ORG = 'test-org';
    process.env.GITHUB_REPO = 'test-repo';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'testpass';
    process.env.MIN_RUNNERS = '5';
    process.env.MAX_RUNNERS = '10';
    process.env.SCALE_THRESHOLD = '0.8';
    
    // Setup mocks
    mockDocker = {
      createContainer: jest.fn(),
      listContainers: jest.fn(),
      getContainer: jest.fn()
    };
    Docker.mockImplementation(() => mockDocker);
    
    mockOctokit = {
      rest: {
        actions: {
          listSelfHostedRunnersForRepo: jest.fn(),
          createRegistrationTokenForRepo: jest.fn(),
          deleteSelfHostedRunnerFromRepo: jest.fn(),
          listWorkflowRunsForRepo: jest.fn(),
          listJobsForWorkflowRun: jest.fn()
        },
        users: {
          getAuthenticated: jest.fn()
        }
      }
    };
    Octokit.mockImplementation(() => mockOctokit);
    
    // Start server
    const createApp = require('../../server');
    app = createApp();
    
    await new Promise((resolve) => {
      server = app.listen(0, () => resolve());
    });
  });
  
  afterAll(async () => {
    if (ws) ws.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });
  
  describe('Complete Runner Lifecycle Flow', () => {
    test('Should handle complete runner lifecycle from auth to scaling', async () => {
      // Step 1: Authenticate
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'testpass'
        });
      
      expect(loginResponse.status).toBe(200);
      authToken = loginResponse.body.accessToken;
      
      // Step 2: Check initial status
      mockOctokit.rest.actions.listSelfHostedRunnersForRepo.mockResolvedValue({
        data: {
          runners: [
            { id: 1, name: 'runner-1', status: 'online', busy: false },
            { id: 2, name: 'runner-2', status: 'online', busy: false }
          ]
        }
      });
      
      const statusResponse = await request(app)
        .get('/api/runners')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(statusResponse.status).toBe(200);
      
      // Step 3: Connect WebSocket for real-time updates
      const port = server.address().port;
      ws = new WebSocket(`ws://localhost:${port}`);
      
      const wsMessages = [];
      ws.on('message', (data) => {
        wsMessages.push(JSON.parse(data));
      });
      
      await new Promise((resolve) => {
        ws.on('open', resolve);
      });
      
      // Step 4: Simulate high load (80%+ utilization)
      mockOctokit.rest.actions.listSelfHostedRunnersForRepo.mockResolvedValue({
        data: {
          runners: [
            { id: 1, name: 'runner-1', status: 'online', busy: true },
            { id: 2, name: 'runner-2', status: 'online', busy: true },
            { id: 3, name: 'runner-3', status: 'online', busy: true },
            { id: 4, name: 'runner-4', status: 'online', busy: true },
            { id: 5, name: 'runner-5', status: 'online', busy: false }
          ]
        }
      });
      
      // Mock successful container creation
      mockDocker.createContainer.mockResolvedValue({
        id: 'new-container-123',
        start: jest.fn().mockResolvedValue()
      });
      
      mockOctokit.rest.actions.createRegistrationTokenForRepo.mockResolvedValue({
        data: { token: 'new-reg-token' }
      });
      
      // Step 5: Wait for auto-scaling to trigger
      // In real scenario, this would happen automatically
      // For test, we'll trigger it manually
      const scaleResponse = await request(app)
        .post('/api/runners/scale')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ action: 'up' });
      
      expect(scaleResponse.status).toBe(200);
      
      // Step 6: Verify scaling happened
      const scalerStatus = await request(app)
        .get('/api/scaler/status')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(scalerStatus.status).toBe(200);
      expect(scalerStatus.body.enabled).toBe(true);
      
      // Step 7: Check lifecycle status
      const lifecycleResponse = await request(app)
        .get('/api/runners/lifecycle')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(lifecycleResponse.status).toBe(200);
      expect(lifecycleResponse.body.enabled).toBe(true);
      
      // Step 8: Create API key for external access
      const apiKeyResponse = await request(app)
        .post('/api/keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'CI/CD Pipeline Key',
          scopes: ['read']
        });
      
      expect(apiKeyResponse.status).toBe(200);
      const apiKey = apiKeyResponse.body.apiKey.key;
      
      // Step 9: Test API key access
      const apiKeyTest = await request(app)
        .get('/api/metrics')
        .set('X-API-Key', apiKey);
      
      expect(apiKeyTest.status).toBe(200);
      expect(apiKeyTest.body).toHaveProperty('utilization_percentage');
      
      // Step 10: Simulate runner going offline
      mockDocker.getContainer.mockReturnValue({
        stats: jest.fn().mockResolvedValue({}),
        inspect: jest.fn().mockResolvedValue({
          State: { Running: false }
        }),
        logs: jest.fn().mockResolvedValue(
          Buffer.from('Runner registration failed')
        ),
        stop: jest.fn().mockResolvedValue(),
        remove: jest.fn().mockResolvedValue()
      });
      
      // Verify WebSocket received scaling events
      await new Promise(resolve => setTimeout(resolve, 100));
      const scaleEvents = wsMessages.filter(m => m.event === 'scale');
      expect(scaleEvents.length).toBeGreaterThan(0);
    });
  });
  
  describe('Error Handling and Recovery', () => {
    test('Should handle Docker failures gracefully', async () => {
      mockDocker.createContainer.mockRejectedValue(
        new Error('Docker daemon not responding')
      );
      
      const response = await request(app)
        .post('/api/runners/scale')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ action: 'up' });
      
      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });
    
    test('Should handle GitHub API failures', async () => {
      mockOctokit.rest.actions.listSelfHostedRunnersForRepo.mockRejectedValue(
        new Error('GitHub API rate limit exceeded')
      );
      
      const response = await request(app)
        .get('/api/runners')
        .set('Authorization', `Bearer ${authToken}`);
      
      // Should return cached data or empty array
      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
    });
  });
  
  describe('Performance and Load Testing', () => {
    test('Should handle concurrent requests', async () => {
      const promises = [];
      
      // Make 50 concurrent requests
      for (let i = 0; i < 50; i++) {
        promises.push(
          request(app)
            .get('/api/public/status')
        );
      }
      
      const responses = await Promise.all(promises);
      
      // All should succeed (within rate limits)
      const successCount = responses.filter(r => r.status === 200).length;
      expect(successCount).toBeGreaterThan(40); // Allow some rate limiting
    });
    
    test('Should maintain performance under load', async () => {
      const startTime = Date.now();
      
      // Make sequential requests to test response time
      for (let i = 0; i < 10; i++) {
        await request(app)
          .get('/api/metrics')
          .set('Authorization', `Bearer ${authToken}`);
      }
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(2000); // Should complete in under 2 seconds
    });
  });
});