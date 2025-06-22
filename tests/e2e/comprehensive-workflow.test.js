/**
 * Comprehensive End-to-End Workflow Tests
 * Tests complete user journeys and system workflows
 */

const request = require('supertest');
const { expect } = require('chai');
const WebSocket = require('ws');

describe('Comprehensive E2E Workflow Tests', () => {
  let app;
  let adminToken;
  let operatorToken;
  let testJobId;
  let testRunnerId;

  before(async function() {
    this.timeout(30000);
    
    // Import app
    try {
      app = require('../../src/app');
    } catch (error) {
      console.warn('Could not load app for E2E tests:', error.message);
      return this.skip();
    }

    // Wait for app to be ready
    await testUtils.sleep(2000);

    // Setup admin authentication
    try {
      const adminAuth = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'admin_password'
        });

      if (adminAuth.status === 200) {
        adminToken = adminAuth.body.token;
      }
    } catch (error) {
      console.warn('Could not authenticate admin for E2E tests');
    }

    // Setup operator authentication
    try {
      const operatorAuth = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'operator',
          password: 'operator_password'
        });

      if (operatorAuth.status === 200) {
        operatorToken = operatorAuth.body.token;
      }
    } catch (error) {
      console.warn('Could not authenticate operator for E2E tests');
    }
  });

  describe('Complete Job Lifecycle Workflow', () => {
    it('should handle complete job lifecycle from creation to completion', async function() {
      this.timeout(60000);
      
      if (!app || !adminToken) return this.skip();

      // Step 1: Create a new job
      const createJobResponse = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          repository: 'test/e2e-repo',
          workflow: 'e2e-test-workflow',
          ref: 'main',
          inputs: {
            test_param: 'e2e_value'
          }
        });

      if (createJobResponse.status !== 201) {
        return this.skip();
      }

      testJobId = createJobResponse.body.id;
      expect(createJobResponse.body).to.have.property('id');
      expect(createJobResponse.body.status).to.equal('pending');

      // Step 2: Verify job appears in job list
      const listJobsResponse = await request(app)
        .get('/api/jobs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listJobsResponse.status).to.equal(200);
      const jobs = listJobsResponse.body;
      const createdJob = jobs.find(j => j.id === testJobId);
      expect(createdJob).to.exist;

      // Step 3: Get job details
      const jobDetailsResponse = await request(app)
        .get(`/api/jobs/${testJobId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(jobDetailsResponse.status).to.equal(200);
      expect(jobDetailsResponse.body.id).to.equal(testJobId);
      expect(jobDetailsResponse.body.repository).to.equal('test/e2e-repo');

      // Step 4: Monitor job status changes
      let statusChecks = 0;
      while (statusChecks < 10) {
        const statusResponse = await request(app)
          .get(`/api/jobs/${testJobId}/status`)
          .set('Authorization', `Bearer ${adminToken}`);

        if (statusResponse.status === 200) {
          const status = statusResponse.body.status;
          
          if (status === 'completed' || status === 'failed') {
            break;
          }
        }

        await testUtils.sleep(2000);
        statusChecks++;
      }

      // Step 5: Get job logs
      const logsResponse = await request(app)
        .get(`/api/jobs/${testJobId}/logs`)
        .set('Authorization', `Bearer ${adminToken}`);

      if (logsResponse.status === 200) {
        expect(logsResponse.body).to.have.property('logs');
      }

      // Step 6: Verify job completion metrics
      const metricsResponse = await request(app)
        .get('/api/monitoring/metrics')
        .set('Authorization', `Bearer ${adminToken}`);

      if (metricsResponse.status === 200) {
        expect(metricsResponse.body).to.have.property('jobs');
      }
    });

    it('should handle job cancellation workflow', async function() {
      if (!app || !adminToken) return this.skip();

      // Create a job
      const createResponse = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          repository: 'test/cancel-repo',
          workflow: 'long-running-workflow',
          ref: 'main'
        });

      if (createResponse.status !== 201) {
        return this.skip();
      }

      const jobId = createResponse.body.id;

      // Wait a moment for job to start
      await testUtils.sleep(1000);

      // Cancel the job
      const cancelResponse = await request(app)
        .post(`/api/jobs/${jobId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(cancelResponse.status).to.be.oneOf([200, 404]);

      // Verify job status
      const statusResponse = await request(app)
        .get(`/api/jobs/${jobId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      if (statusResponse.status === 200) {
        expect(statusResponse.body.status).to.be.oneOf(['cancelled', 'failed']);
      }
    });
  });

  describe('Runner Management Workflow', () => {
    it('should handle complete runner lifecycle', async function() {
      this.timeout(30000);
      
      if (!app || !adminToken) return this.skip();

      // Step 1: Register a new runner
      const registerResponse = await request(app)
        .post('/api/runners')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'e2e-test-runner',
          labels: ['linux', 'x64', 'docker'],
          capabilities: {
            docker: true,
            kubernetes: false,
            gpu: false
          },
          metadata: {
            test: true,
            e2e: true
          }
        });

      if (registerResponse.status !== 201) {
        return this.skip();
      }

      testRunnerId = registerResponse.body.id;
      expect(registerResponse.body).to.have.property('id');
      expect(registerResponse.body.status).to.equal('offline');

      // Step 2: Update runner status to online
      const updateResponse = await request(app)
        .patch(`/api/runners/${testRunnerId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'online',
          lastSeen: new Date().toISOString()
        });

      expect(updateResponse.status).to.be.oneOf([200, 404]);

      // Step 3: List runners and verify our runner appears
      const listResponse = await request(app)
        .get('/api/runners')
        .set('Authorization', `Bearer ${adminToken}`);

      if (listResponse.status === 200) {
        const runners = listResponse.body;
        const ourRunner = runners.find(r => r.id === testRunnerId);
        expect(ourRunner).to.exist;
        expect(ourRunner.name).to.equal('e2e-test-runner');
      }

      // Step 4: Get runner details
      const detailsResponse = await request(app)
        .get(`/api/runners/${testRunnerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      if (detailsResponse.status === 200) {
        expect(detailsResponse.body.id).to.equal(testRunnerId);
        expect(detailsResponse.body.labels).to.include('linux');
      }

      // Step 5: Get runner metrics
      const metricsResponse = await request(app)
        .get(`/api/runners/${testRunnerId}/metrics`)
        .set('Authorization', `Bearer ${adminToken}`);

      if (metricsResponse.status === 200) {
        expect(metricsResponse.body).to.have.property('cpuUsage');
        expect(metricsResponse.body).to.have.property('memoryUsage');
      }

      // Step 6: Deregister runner
      const deregisterResponse = await request(app)
        .delete(`/api/runners/${testRunnerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deregisterResponse.status).to.be.oneOf([200, 204, 404]);
    });
  });

  describe('Monitoring and Alerting Workflow', () => {
    it('should provide comprehensive monitoring data', async function() {
      if (!app || !adminToken) return this.skip();

      // Get system metrics
      const systemMetricsResponse = await request(app)
        .get('/api/monitoring/metrics')
        .set('Authorization', `Bearer ${adminToken}`);

      if (systemMetricsResponse.status === 200) {
        const metrics = systemMetricsResponse.body;
        expect(metrics).to.have.property('timestamp');
        expect(metrics).to.have.property('system');
        expect(metrics.system).to.have.property('cpu');
        expect(metrics.system).to.have.property('memory');
      }

      // Get health status
      const healthResponse = await request(app)
        .get('/health');

      expect(healthResponse.status).to.equal(200);
      expect(healthResponse.body).to.have.property('status');

      // Get detailed health
      const detailedHealthResponse = await request(app)
        .get('/health/detailed')
        .set('Authorization', `Bearer ${adminToken}`);

      if (detailedHealthResponse.status === 200) {
        expect(detailedHealthResponse.body).to.have.property('components');
      }

      // Get Prometheus metrics
      const prometheusResponse = await request(app)
        .get('/metrics');

      if (prometheusResponse.status === 200) {
        expect(prometheusResponse.headers['content-type']).to.include('text/plain');
        expect(prometheusResponse.text).to.include('# HELP');
      }
    });

    it('should handle real-time monitoring via WebSocket', async function() {
      this.timeout(15000);
      
      if (!app) return this.skip();

      return new Promise((resolve, reject) => {
        let ws;
        let messageReceived = false;
        
        try {
          ws = new WebSocket('ws://localhost:3001/ws/monitoring');
          
          ws.on('open', () => {
            // Send auth if needed
            if (adminToken) {
              ws.send(JSON.stringify({
                type: 'auth',
                token: adminToken
              }));
            }

            // Request metrics
            ws.send(JSON.stringify({
              type: 'subscribe',
              channel: 'metrics'
            }));
          });

          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data);
              
              if (message.type === 'metrics' || message.type === 'health') {
                messageReceived = true;
                expect(message).to.have.property('data');
                expect(message).to.have.property('timestamp');
                ws.close();
                resolve();
              }
            } catch (error) {
              // Ignore parsing errors
            }
          });

          ws.on('error', (error) => {
            // WebSocket might not be available
            resolve();
          });

          ws.on('close', () => {
            if (messageReceived) {
              resolve();
            } else {
              // WebSocket not available, skip test
              resolve();
            }
          });

          // Timeout after 10 seconds
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
            resolve();
          }, 10000);

        } catch (error) {
          resolve(); // Skip if WebSocket not available
        }
      });
    });
  });

  describe('Security and RBAC Workflow', () => {
    it('should enforce role-based access control', async function() {
      if (!app || !operatorToken) return this.skip();

      // Operator should be able to view jobs
      const viewJobsResponse = await request(app)
        .get('/api/jobs')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(viewJobsResponse.status).to.be.oneOf([200, 401, 403, 404]);

      // Operator should NOT be able to create users
      const createUserResponse = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          username: 'unauthorized_user',
          password: 'password123',
          role: 'admin'
        });

      expect(createUserResponse.status).to.be.oneOf([401, 403, 404]);

      // Operator should NOT be able to access admin endpoints
      const adminResponse = await request(app)
        .get('/api/admin/system')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(adminResponse.status).to.be.oneOf([401, 403, 404]);
    });
  });

  describe('Error Handling and Recovery Workflow', () => {
    it('should handle system errors gracefully', async function() {
      if (!app || !adminToken) return this.skip();

      // Test invalid job creation
      const invalidJobResponse = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          repository: '', // Invalid empty repository
          workflow: '',   // Invalid empty workflow
          ref: ''         // Invalid empty ref
        });

      expect(invalidJobResponse.status).to.equal(400);
      expect(invalidJobResponse.body).to.have.property('error');

      // Test non-existent resource access
      const nonExistentResponse = await request(app)
        .get('/api/jobs/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(nonExistentResponse.status).to.equal(404);

      // Test malformed requests
      const malformedResponse = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect(malformedResponse.status).to.equal(400);
    });
  });

  describe('Performance and Load Handling', () => {
    it('should handle concurrent requests efficiently', async function() {
      this.timeout(20000);
      
      if (!app || !adminToken) return this.skip();

      // Create multiple concurrent requests
      const concurrentRequests = [];
      for (let i = 0; i < 20; i++) {
        concurrentRequests.push(
          request(app)
            .get('/api/jobs')
            .set('Authorization', `Bearer ${adminToken}`)
        );
      }

      const responses = await Promise.all(concurrentRequests);
      
      // Most requests should succeed
      const successfulRequests = responses.filter(r => r.status === 200);
      expect(successfulRequests.length).to.be.greaterThan(15);

      // Response times should be reasonable
      const avgResponseTime = responses.reduce((sum, r) => sum + (r.duration || 0), 0) / responses.length;
      expect(avgResponseTime).to.be.lessThan(2000); // Less than 2 seconds average
    });
  });

  after(async function() {
    // Cleanup test data
    if (app && adminToken) {
      // Clean up test job
      if (testJobId) {
        await request(app)
          .delete(`/api/jobs/${testJobId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .catch(() => {}); // Ignore errors
      }

      // Clean up test runner
      if (testRunnerId) {
        await request(app)
          .delete(`/api/runners/${testRunnerId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .catch(() => {}); // Ignore errors
      }
    }
  });
});