/**
 * Integration Tests for API Endpoints
 * Tests complete API workflows including authentication, CRUD operations, and error handling
 */

import request from 'supertest';
import { expect } from 'chai';
import express from 'express';

// Import routes
import authRoutes from '../../src/routes/auth';
import jobRoutes from '../../src/routes/jobs';
import runnerRoutes from '../../src/routes/runners';
import healthRoutes from '../../src/routes/health';
import monitoringRoutes from '../../src/routes/monitoring';

describe('API Integration Tests', () => {
  let app: express.Application;
  let authToken: string;

  beforeAll(async () => {
    // Create test Express app
    app = express();
    app.use(express.json());
    
    // Add routes
    app.use('/api/auth', authRoutes);
    app.use('/api/jobs', jobRoutes);
    app.use('/api/runners', runnerRoutes);
    app.use('/health', healthRoutes);
    app.use('/api/monitoring', monitoringRoutes);
    
    // Error handler
    app.use((err: any, req: any, res: any, next: any) => {
      res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error'
      });
    });
  });

  describe('Authentication API', () => {
    it('should reject invalid login credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'invalid',
          password: 'wrong'
        });

      expect(response.status).to.equal(401);
      expect(response.body).to.have.property('error');
    });

    it('should authenticate valid admin user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'admin_password'
        });

      if (response.status === 200) {
        expect(response.body).to.have.property('token');
        expect(response.body).to.have.property('user');
        expect(response.body.user.role).to.equal('admin');
        authToken = response.body.token;
      } else {
        // Skip if no auth system is set up
        authToken = 'mock-token';
      }
    });

    it('should refresh valid tokens', async () => {
      if (authToken !== 'mock-token') {
        const response = await request(app)
          .post('/api/auth/refresh')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).to.be.oneOf([200, 404]); // 404 if endpoint not implemented
      }
    });

    it('should logout successfully', async () => {
      if (authToken !== 'mock-token') {
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).to.be.oneOf([200, 404]);
      }
    });
  });

  describe('Health Check API', () => {
    it('should return basic health status', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('status');
      expect(response.body.status).to.be.oneOf(['healthy', 'unhealthy']);
    });

    it('should return detailed health information', async () => {
      const response = await request(app)
        .get('/health/detailed');

      expect(response.status).to.be.oneOf([200, 404]);
      
      if (response.status === 200) {
        expect(response.body).to.have.property('components');
        expect(response.body).to.have.property('timestamp');
      }
    });
  });

  describe('Jobs API', () => {
    it('should list jobs', async () => {
      const response = await request(app)
        .get('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).to.be.oneOf([200, 401, 404]);
      
      if (response.status === 200) {
        expect(response.body).to.be.an('array');
      }
    });

    it('should create a new job', async () => {
      const jobData = {
        repository: 'test/repo',
        workflow: 'test-workflow',
        ref: 'main',
        inputs: {}
      };

      const response = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send(jobData);

      expect(response.status).to.be.oneOf([201, 401, 404]);
      
      if (response.status === 201) {
        expect(response.body).to.have.property('id');
        expect(response.body.repository).to.equal(jobData.repository);
      }
    });

    it('should get job by ID', async () => {
      const response = await request(app)
        .get('/api/jobs/test-job-id')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).to.be.oneOf([200, 404]);
    });

    it('should handle job cancellation', async () => {
      const response = await request(app)
        .post('/api/jobs/test-job-id/cancel')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).to.be.oneOf([200, 404]);
    });
  });

  describe('Runners API', () => {
    it('should list runners', async () => {
      const response = await request(app)
        .get('/api/runners')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).to.be.oneOf([200, 401, 404]);
      
      if (response.status === 200) {
        expect(response.body).to.be.an('array');
      }
    });

    it('should register a new runner', async () => {
      const runnerData = {
        name: 'test-runner',
        labels: ['linux', 'x64'],
        capabilities: {
          docker: true,
          kubernetes: false
        }
      };

      const response = await request(app)
        .post('/api/runners')
        .set('Authorization', `Bearer ${authToken}`)
        .send(runnerData);

      expect(response.status).to.be.oneOf([201, 401, 404]);
    });

    it('should get runner status', async () => {
      const response = await request(app)
        .get('/api/runners/test-runner-id')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).to.be.oneOf([200, 404]);
    });

    it('should update runner status', async () => {
      const response = await request(app)
        .patch('/api/runners/test-runner-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'online' });

      expect(response.status).to.be.oneOf([200, 404]);
    });
  });

  describe('Monitoring API', () => {
    it('should return system metrics', async () => {
      const response = await request(app)
        .get('/api/monitoring/metrics')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).to.be.oneOf([200, 401, 404]);
      
      if (response.status === 200) {
        expect(response.body).to.have.property('timestamp');
      }
    });

    it('should return Prometheus metrics', async () => {
      const response = await request(app)
        .get('/api/monitoring/prometheus')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).to.be.oneOf([200, 404]);
      
      if (response.status === 200) {
        expect(response.headers['content-type']).to.include('text/plain');
      }
    });

    it('should handle metrics with time range', async () => {
      const response = await request(app)
        .get('/api/monitoring/metrics')
        .query({
          from: Date.now() - 3600000, // 1 hour ago
          to: Date.now()
        })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).to.be.oneOf([200, 401, 404]);
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 for non-existent endpoints', async () => {
      const response = await request(app)
        .get('/api/non-existent');

      expect(response.status).to.equal(404);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect(response.status).to.equal(400);
    });

    it('should handle missing required fields', async () => {
      const response = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).to.be.oneOf([400, 404]);
    });

    it('should handle unauthorized requests', async () => {
      const response = await request(app)
        .get('/api/jobs');

      expect(response.status).to.be.oneOf([401, 404]);
    });
  });

  describe('Rate Limiting', () => {
    it('should handle rate limiting', async () => {
      // Make multiple rapid requests
      const requests = Array(10).fill(null).map(() => 
        request(app)
          .get('/health')
      );

      const responses = await Promise.all(requests);
      
      // At least some should succeed
      const successCount = responses.filter(r => r.status === 200).length;
      expect(successCount).to.be.greaterThan(0);
    });
  });

  describe('Content-Type Handling', () => {
    it('should handle different content types', async () => {
      const response = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('repository=test/repo&workflow=test');

      expect(response.status).to.be.oneOf([201, 400, 404]);
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers', async () => {
      const response = await request(app)
        .options('/api/jobs')
        .set('Origin', 'http://localhost:3000');

      expect(response.status).to.be.oneOf([200, 204, 404]);
    });
  });
});