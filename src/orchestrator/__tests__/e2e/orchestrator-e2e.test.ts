import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { Express } from 'express';
import App from '../../../app';
import { OrchestratorService } from '../../orchestrator-service';
import { ContainerAssignmentManager } from '../../container-assignment';
import { StatusReporter } from '../../status-reporter';

// Mock external dependencies
jest.mock('../../../services/github-api');
jest.mock('../../../services/database');
jest.mock('../../../container-orchestration/pool/integrated-pool-orchestrator');

describe('Orchestrator System E2E Tests', () => {
  let app: Express;
  let orchestratorService: OrchestratorService;

  beforeAll(async () => {
    // Initialize test application
    const appInstance = new App();
    app = appInstance.getApp();
    
    // Initialize orchestrator with test configuration
    orchestratorService = OrchestratorService.getInstance({
      orchestrator: {
        maxConcurrentJobs: 10,
        containerPoolSize: 20,
        healthCheckInterval: 5000,
        metricsInterval: 10000,
        webhookSecret: 'test-webhook-secret',
        gitHubToken: 'test-github-token',
        gitHubOrg: 'test-org'
      },
      enabled: true,
      fallbackToTraditionalRunners: false,
      migrationMode: false
    });

    await orchestratorService.initialize();
  });

  afterAll(async () => {
    await orchestratorService.shutdown();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Webhook Integration E2E', () => {
    it('should process complete workflow_job lifecycle', async () => {
      const workflowJobPayload = {
        action: 'queued',
        workflow_job: {
          id: 123456789,
          name: 'test-job',
          workflow_name: 'CI',
          run_id: 987654321,
          run_attempt: 1,
          head_sha: 'abc123def456',
          head_ref: 'feature/test-branch',
          labels: ['self-hosted', 'linux', 'ubuntu'],
          steps: [
            {
              name: 'Checkout',
              uses: 'actions/checkout@v3'
            },
            {
              name: 'Run tests',
              run: 'npm test'
            }
          ]
        },
        repository: {
          full_name: 'test-org/test-repo',
          id: 123,
          private: false
        }
      };

      // 1. Simulate job queued webhook
      const queuedResponse = await request(app)
        .post('/api/webhooks/orchestrator')
        .set('X-GitHub-Event', 'workflow_job')
        .set('X-GitHub-Delivery', 'test-delivery-id')
        .set('X-Hub-Signature-256', 'sha256=test-signature')
        .send(workflowJobPayload)
        .expect(202);

      expect(queuedResponse.body.message).toContain('Webhook received and queued');

      // 2. Verify job was processed and queued
      await new Promise(resolve => setTimeout(resolve, 1000)); // Allow processing time

      const orchestratorMetrics = orchestratorService.getOrchestratorMetrics();
      expect(orchestratorMetrics.orchestrator.pendingJobs).toBeGreaterThan(0);

      // 3. Simulate container assignment and job start
      workflowJobPayload.action = 'in_progress';
      
      const inProgressResponse = await request(app)
        .post('/api/webhooks/orchestrator')
        .set('X-GitHub-Event', 'workflow_job')
        .set('X-GitHub-Delivery', 'test-delivery-id-2')
        .set('X-Hub-Signature-256', 'sha256=test-signature')
        .send(workflowJobPayload)
        .expect(202);

      expect(inProgressResponse.body.message).toContain('Webhook received and queued');

      // 4. Simulate job completion
      workflowJobPayload.action = 'completed';
      workflowJobPayload.workflow_job.conclusion = 'success';

      const completedResponse = await request(app)
        .post('/api/webhooks/orchestrator')
        .set('X-GitHub-Event', 'workflow_job')
        .set('X-GitHub-Delivery', 'test-delivery-id-3')
        .set('X-Hub-Signature-256', 'sha256=test-signature')
        .send(workflowJobPayload)
        .expect(202);

      expect(completedResponse.body.message).toContain('Webhook received and queued');
    });

    it('should handle malformed webhook payloads gracefully', async () => {
      const malformedPayload = {
        action: 'queued',
        // Missing required workflow_job field
        repository: {
          full_name: 'test-org/test-repo'
        }
      };

      const response = await request(app)
        .post('/api/webhooks/orchestrator')
        .set('X-GitHub-Event', 'workflow_job')
        .set('X-GitHub-Delivery', 'test-delivery-malformed')
        .set('X-Hub-Signature-256', 'sha256=test-signature')
        .send(malformedPayload)
        .expect(202); // Should still accept but handle gracefully

      expect(response.body.message).toContain('Webhook received and queued');
    });

    it('should reject webhooks with invalid signatures', async () => {
      const payload = {
        action: 'queued',
        workflow_job: {
          id: 123,
          name: 'test-job'
        }
      };

      // Don't mock signature verification for this test
      const response = await request(app)
        .post('/api/webhooks/orchestrator')
        .set('X-GitHub-Event', 'workflow_job')
        .set('X-GitHub-Delivery', 'test-delivery-invalid')
        .set('X-Hub-Signature-256', 'sha256=invalid-signature')
        .send(payload)
        .expect(401);

      expect(response.body.error).toContain('Invalid signature');
    });
  });

  describe('Container Assignment E2E', () => {
    let containerManager: ContainerAssignmentManager;

    beforeEach(async () => {
      containerManager = ContainerAssignmentManager.getInstance();
      await containerManager.initialize();

      // Register test containers
      const testContainers = [
        {
          id: 'container-ubuntu-1',
          name: 'ubuntu-runner-1',
          image: 'ubuntu:22.04',
          status: 'ready' as const,
          labels: {
            'self-hosted': 'true',
            'linux': 'true',
            'ubuntu': 'true'
          },
          resources: {
            cpu: 4,
            memory: '8Gi',
            disk: '50Gi'
          },
          createdAt: new Date(),
          lastHealthCheck: new Date(),
          healthStatus: {
            healthy: true,
            lastCheck: new Date(),
            checks: {
              connectivity: true,
              diskSpace: true,
              memory: true,
              dockerDaemon: true
            }
          },
          utilization: {
            cpu: 0.2,
            memory: 0.3,
            disk: 0.1,
            network: 0.05
          }
        },
        {
          id: 'container-node-1',
          name: 'node-runner-1',
          image: 'node:18',
          status: 'ready' as const,
          labels: {
            'self-hosted': 'true',
            'linux': 'true',
            'node': 'true'
          },
          resources: {
            cpu: 2,
            memory: '4Gi',
            disk: '30Gi'
          },
          createdAt: new Date(),
          lastHealthCheck: new Date(),
          healthStatus: {
            healthy: true,
            lastCheck: new Date(),
            checks: {
              connectivity: true,
              diskSpace: true,
              memory: true,
              dockerDaemon: true
            }
          },
          utilization: {
            cpu: 0.1,
            memory: 0.2,
            disk: 0.05,
            network: 0.02
          }
        }
      ];

      for (const container of testContainers) {
        await containerManager.registerContainer(container);
      }
    });

    it('should assign containers based on job requirements', async () => {
      // Test Ubuntu job assignment
      const ubuntuJobRequest = {
        jobId: 'job-ubuntu-test',
        labels: ['self-hosted', 'linux', 'ubuntu'],
        priority: 1
      };

      const assignedContainer = await containerManager.assignContainer(ubuntuJobRequest);

      expect(assignedContainer).toBeTruthy();
      expect(assignedContainer!.id).toBe('container-ubuntu-1');
      expect(assignedContainer!.assignedJob).toBe('job-ubuntu-test');

      // Test Node.js job assignment
      const nodeJobRequest = {
        jobId: 'job-node-test',
        labels: ['self-hosted', 'linux', 'node'],
        priority: 1
      };

      const nodeContainer = await containerManager.assignContainer(nodeJobRequest);

      expect(nodeContainer).toBeTruthy();
      expect(nodeContainer!.id).toBe('container-node-1');
      expect(nodeContainer!.assignedJob).toBe('job-node-test');
    });

    it('should handle load balancing strategies', async () => {
      // Test round-robin strategy
      containerManager.setLoadBalancingStrategy({ type: 'round-robin' });

      const job1 = await containerManager.assignContainer({
        jobId: 'job-1',
        labels: ['self-hosted', 'linux'],
        priority: 1
      });

      await containerManager.releaseContainer('job-1');

      const job2 = await containerManager.assignContainer({
        jobId: 'job-2',
        labels: ['self-hosted', 'linux'],
        priority: 1
      });

      // Should get different containers due to round-robin
      expect(job1!.id).not.toBe(job2!.id);

      // Test least-loaded strategy
      containerManager.setLoadBalancingStrategy({ type: 'least-loaded' });

      await containerManager.releaseContainer('job-2');

      const job3 = await containerManager.assignContainer({
        jobId: 'job-3',
        labels: ['self-hosted', 'linux'],
        priority: 1
      });

      // Should get the container with lowest utilization
      expect(job3!.id).toBe('container-node-1'); // Has lower utilization
    });

    it('should handle container health changes', async () => {
      // Mark container as unhealthy
      await containerManager.updateContainerHealth('container-ubuntu-1', {
        healthy: false,
        lastCheck: new Date(),
        checks: {
          connectivity: false,
          diskSpace: true,
          memory: true,
          dockerDaemon: true
        },
        message: 'Connection timeout'
      });

      // Try to assign job to unhealthy container
      const jobRequest = {
        jobId: 'job-unhealthy-test',
        labels: ['self-hosted', 'linux', 'ubuntu'],
        priority: 1
      };

      const assignedContainer = await containerManager.assignContainer(jobRequest);

      // Should not assign to unhealthy container
      expect(assignedContainer).toBeNull();

      // Recover container health
      await containerManager.updateContainerHealth('container-ubuntu-1', {
        healthy: true,
        lastCheck: new Date(),
        checks: {
          connectivity: true,
          diskSpace: true,
          memory: true,
          dockerDaemon: true
        }
      });

      // Should now be able to assign
      const recoveredAssignment = await containerManager.assignContainer(jobRequest);
      expect(recoveredAssignment).toBeTruthy();
    });
  });

  describe('Status Reporting E2E', () => {
    let statusReporter: StatusReporter;

    beforeEach(async () => {
      statusReporter = StatusReporter.getInstance();
      await statusReporter.initialize();
    });

    it('should report job status to GitHub', async () => {
      const { GitHubService } = await import('../../../services/github-service');
      const mockGitHubService = GitHubService;
      mockGitHubService.getInstance().createCheckRun.mockResolvedValue({ id: 123456 });
      mockGitHubService.getInstance().updateCheckRun.mockResolvedValue(undefined);

      // Report job started
      await statusReporter.reportJobStarted(
        'job-status-test',
        'test-org/test-repo',
        'abc123def456',
        'Test Job',
        987654321
      );

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify GitHub service was called
      expect(mockGitHubService.getInstance().createCheckRun).toHaveBeenCalledWith(
        'test-org/test-repo',
        expect.objectContaining({
          name: 'Test Job',
          head_sha: 'abc123def456',
          status: 'in_progress'
        })
      );

      // Report job completed
      await statusReporter.reportJobCompleted(
        'job-status-test',
        'test-org/test-repo',
        'abc123def456',
        'Test Job',
        987654321,
        'success' as any,
        {
          title: 'Test Job - Success',
          summary: 'Job completed successfully'
        }
      );

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify status was updated
      expect(mockGitHubService.getInstance().updateCheckRun).toHaveBeenCalled();
    });

    it('should handle step status reporting', async () => {
      // First report job status
      await statusReporter.reportJobStarted(
        'job-steps-test',
        'test-org/test-repo',
        'abc123def456',
        'Test Job with Steps',
        987654321
      );

      // Report step status
      await statusReporter.reportStepStatus('job-steps-test', {
        number: 1,
        name: 'Checkout code',
        status: 'completed',
        conclusion: 'success',
        started_at: new Date(Date.now() - 30000),
        completed_at: new Date()
      });

      await statusReporter.reportStepStatus('job-steps-test', {
        number: 2,
        name: 'Run tests',
        status: 'in_progress',
        started_at: new Date()
      });

      // Verify steps were added to job status
      const stats = statusReporter.getStatistics();
      expect(stats.queueSize).toBeGreaterThan(0);
    });
  });

  describe('Health Monitoring E2E', () => {
    it('should provide system health status', async () => {
      const response = await request(app)
        .get('/api/orchestrator/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: expect.stringMatching(/healthy|degraded|unhealthy/),
        components: {
          orchestrator: expect.stringMatching(/healthy|degraded|unhealthy/),
          containerAssignment: expect.stringMatching(/healthy|degraded|unhealthy/),
          statusReporter: expect.stringMatching(/healthy|degraded|unhealthy/),
          database: expect.stringMatching(/healthy|degraded|unhealthy/)
        },
        timestamp: expect.any(String),
        uptime: expect.any(Number)
      });
    });

    it('should provide metrics endpoint', async () => {
      const response = await request(app)
        .get('/api/orchestrator/metrics')
        .expect(200);

      expect(response.body).toMatchObject({
        orchestrator: expect.any(Object),
        containerAssignment: expect.any(Object),
        statusReporter: expect.any(Object),
        system: expect.any(Object)
      });
    });

    it('should provide container statistics', async () => {
      const response = await request(app)
        .get('/api/orchestrator/containers/stats')
        .expect(200);

      expect(response.body).toMatchObject({
        total: expect.any(Number),
        ready: expect.any(Number),
        assigned: expect.any(Number),
        unhealthy: expect.any(Number),
        utilization: expect.any(Object)
      });
    });
  });

  describe('Dashboard Integration E2E', () => {
    it('should serve dashboard page', async () => {
      const response = await request(app)
        .get('/dashboard/orchestrator')
        .expect(200);

      expect(response.text).toContain('GitHub RunnerHub Orchestrator Dashboard');
      expect(response.headers['content-type']).toContain('text/html');
    });

    it('should provide dashboard data API', async () => {
      const response = await request(app)
        .get('/api/orchestrator/dashboard')
        .expect(200);

      expect(response.body).toMatchObject({
        timestamp: expect.any(String),
        health: expect.any(Object),
        metrics: expect.any(Object),
        alerts: expect.any(Object),
        orchestrator: expect.any(Object),
        containers: expect.any(Object),
        statusReporter: expect.any(Object),
        performance: expect.any(Object)
      });
    });
  });

  describe('Error Handling E2E', () => {
    it('should handle database connection failures gracefully', async () => {
      // Mock database error
      const { DatabaseService: mockDatabase } = await import('../../../services/database-service');
      mockDatabase.getInstance().query.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/orchestrator/health')
        .expect(200);

      // Should still respond but indicate unhealthy status
      expect(response.body.status).toBe('unhealthy');
      expect(response.body.components.database).toBe('unhealthy');
    });

    it('should handle GitHub API failures gracefully', async () => {
      const { GitHubService: mockGitHubService } = await import('../../../services/github-service');
      mockGitHubService.getInstance().createCheckRun.mockRejectedValue(new Error('GitHub API error'));

      const statusReporter = StatusReporter.getInstance();
      
      // Should not throw error but emit failure event
      let failureEvent: any = null;
      statusReporter.on('status:failed', (event) => {
        failureEvent = event;
      });

      await statusReporter.reportJobStarted(
        'job-error-test',
        'test-org/test-repo',
        'abc123',
        'Test Job',
        123
      );

      // Wait for processing and retries
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(failureEvent).toBeTruthy();
    });

    it('should handle container assignment failures', async () => {
      const containerManager = ContainerAssignmentManager.getInstance();

      // Try to assign job with no matching containers
      const assignment = await containerManager.assignContainer({
        jobId: 'job-no-match',
        labels: ['windows', 'large-runner'], // No containers with these labels
        priority: 1
      });

      expect(assignment).toBeNull();
    });
  });

  describe('Performance E2E', () => {
    it('should handle concurrent job assignments', async () => {
      const containerManager = ContainerAssignmentManager.getInstance();
      
      // Create multiple concurrent assignment requests
      const assignmentPromises = [];
      for (let i = 0; i < 5; i++) {
        assignmentPromises.push(
          containerManager.assignContainer({
            jobId: `concurrent-job-${i}`,
            labels: ['self-hosted', 'linux'],
            priority: 1
          })
        );
      }

      const results = await Promise.all(assignmentPromises);
      
      // At least some should succeed (limited by available containers)
      const successfulAssignments = results.filter(r => r !== null);
      expect(successfulAssignments.length).toBeGreaterThan(0);
      expect(successfulAssignments.length).toBeLessThanOrEqual(2); // Only 2 test containers
    });

    it('should handle high webhook volume', async () => {
      const webhookPromises = [];
      
      for (let i = 0; i < 10; i++) {
        webhookPromises.push(
          request(app)
            .post('/api/webhooks/orchestrator')
            .set('X-GitHub-Event', 'workflow_job')
            .set('X-GitHub-Delivery', `load-test-${i}`)
            .set('X-Hub-Signature-256', 'sha256=test-signature')
            .send({
              action: 'queued',
              workflow_job: {
                id: 1000 + i,
                name: `load-test-job-${i}`,
                workflow_name: 'Load Test',
                run_id: 2000 + i,
                labels: ['self-hosted', 'linux']
              },
              repository: {
                full_name: 'test-org/load-test-repo'
              }
            })
        );
      }

      const results = await Promise.all(webhookPromises);
      
      // All should be accepted
      results.forEach(response => {
        expect(response.status).toBe(202);
      });
    });
  });
});