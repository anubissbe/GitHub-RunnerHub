const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock modules before requiring the server
jest.mock('dockerode');
jest.mock('@octokit/rest');
jest.mock('../../runner-lifecycle');

const Docker = require('dockerode');
const { Octokit } = require('@octokit/rest');

describe('API Integration Tests', () => {
  let app;
  let server;
  let authToken;
  let apiKey;
  
  beforeAll(async () => {
    // Set test environment
    process.env.JWT_SECRET = 'test-secret';
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.GITHUB_ORG = 'test-org';
    process.env.GITHUB_REPO = 'test-repo';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'testpass';
    
    // Mock Docker
    const mockDocker = {
      createContainer: jest.fn().mockResolvedValue({
        id: 'container-123',
        start: jest.fn().mockResolvedValue()
      }),
      listContainers: jest.fn().mockResolvedValue([]),
      getContainer: jest.fn().mockReturnValue({
        stats: jest.fn().mockResolvedValue({}),
        inspect: jest.fn().mockResolvedValue({ State: { Running: true } })
      })
    };
    Docker.mockImplementation(() => mockDocker);
    
    // Mock Octokit
    const mockOctokit = {
      rest: {
        actions: {
          listSelfHostedRunnersForRepo: jest.fn().mockResolvedValue({
            data: { runners: [] }
          }),
          createRegistrationTokenForRepo: jest.fn().mockResolvedValue({
            data: { token: 'registration-token' }
          }),
          listWorkflowRunsForRepo: jest.fn().mockResolvedValue({
            data: { workflow_runs: [] }
          }),
          listJobsForWorkflowRun: jest.fn().mockResolvedValue({
            data: { jobs: [] }
          })
        },
        users: {
          getAuthenticated: jest.fn().mockResolvedValue({
            data: { id: 1, login: 'testuser', email: 'test@example.com' }
          })
        }
      }
    };
    Octokit.mockImplementation(() => mockOctokit);
    
    // Create app
    const createApp = require('../../server');
    app = createApp();
    
    // Start server
    await new Promise((resolve) => {
      server = app.listen(0, () => resolve());
    });
  });
  
  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });
  
  describe('Authentication', () => {
    test('POST /api/auth/login - should login with admin credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'testpass'
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.user).toMatchObject({
        username: 'admin',
        role: 'admin'
      });
      
      authToken = response.body.accessToken;
    });
    
    test('POST /api/auth/login - should fail with invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'wrongpass'
        });
      
      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });
    
    test('POST /api/auth/login - should handle rate limiting', async () => {
      // Make 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ username: 'test', password: 'wrong' });
      }
      
      // 6th attempt should be rate limited
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test', password: 'wrong' });
      
      expect(response.status).toBe(429);
      expect(response.body.error).toContain('Too many');
    });
  });
  
  describe('API Key Management', () => {
    test('POST /api/keys - should create API key', async () => {
      const response = await request(app)
        .post('/api/keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test API Key',
          scopes: ['read', 'write']
        });
      
      expect(response.status).toBe(200);
      expect(response.body.apiKey).toHaveProperty('key');
      expect(response.body.apiKey.key).toMatch(/^rh_test_/);
      
      apiKey = response.body.apiKey.key;
    });
    
    test('GET /api/keys - should list API keys', async () => {
      const response = await request(app)
        .get('/api/keys')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.keys).toBeInstanceOf(Array);
      expect(response.body.keys.length).toBeGreaterThan(0);
    });
  });
  
  describe('Protected Endpoints with JWT', () => {
    test('GET /api/runners - should get runners with JWT', async () => {
      const response = await request(app)
        .get('/api/runners')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
    });
    
    test('GET /api/metrics - should get metrics', async () => {
      const response = await request(app)
        .get('/api/metrics')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('total_runners');
      expect(response.body).toHaveProperty('utilization_percentage');
    });
  });
  
  describe('Protected Endpoints with API Key', () => {
    test('GET /api/runners - should work with API key', async () => {
      const response = await request(app)
        .get('/api/runners')
        .set('X-API-Key', apiKey);
      
      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
    });
    
    test('GET /api/runners - should fail without auth', async () => {
      const response = await request(app)
        .get('/api/runners');
      
      expect(response.status).toBe(401);
    });
  });
  
  describe('Auto-scaling Endpoints', () => {
    test('GET /api/scaler/status - admin only', async () => {
      const response = await request(app)
        .get('/api/scaler/status')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('enabled');
    });
    
    test('POST /api/runners/scale - should trigger scaling', async () => {
      const response = await request(app)
        .post('/api/runners/scale')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          action: 'up',
          count: 5
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success');
    });
    
    test('POST /api/runners/scale - should enforce rate limit', async () => {
      // Scale operations have strict limits
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/runners/scale')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ action: 'up' });
      }
      
      const response = await request(app)
        .post('/api/runners/scale')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ action: 'up' });
      
      expect(response.status).toBe(429);
    });
  });
  
  describe('Public Endpoints', () => {
    test('GET /health - should be accessible without auth', async () => {
      const response = await request(app)
        .get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });
    
    test('GET /api/public/status - should return basic status', async () => {
      const response = await request(app)
        .get('/api/public/status');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('runners');
      expect(response.body).toHaveProperty('workflows');
    });
  });
});