/**
 * E2E Tests for Security Orchestrator
 * Tests the complete security workflow from job submission to cleanup
 */

const { expect } = require('chai');
const sinon = require('sinon');
const Docker = require('dockerode');
const ContainerOrchestrator = require('../../../src/container-orchestration/orchestrator');
const SecurityOrchestrator = require('../../../src/container-orchestration/security/security-orchestrator');

describe('Security Orchestrator E2E Tests', () => {
  let orchestrator;
  let docker;
  let sandbox;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    docker = new Docker();
    
    orchestrator = new ContainerOrchestrator({
      securityEnabled: true,
      securityLevel: 'high',
      maxContainers: 5,
      minContainers: 1,
      dockerOptions: {
        socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock'
      }
    });

    await orchestrator.initialize();
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.stop();
    }
    sandbox.restore();
  });

  describe('Job Security Context Creation', () => {
    it('should create security context for authorized job', async () => {
      const jobId = `test-job-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        priority: 'normal',
        steps: [
          { run: 'echo "Hello World"' },
          { run: 'node --version' }
        ]
      };

      const result = await orchestrator.submitJob(jobId, jobConfig);
      expect(result).to.be.true;

      // Verify security context was created
      const securityContext = orchestrator.securityOrchestrator.jobSecurityContexts.get(jobId);
      expect(securityContext).to.exist;
      expect(securityContext.state).to.equal('ready');
      expect(securityContext.checks.authentication).to.be.true;
      expect(securityContext.checks.authorization).to.be.true;
    });

    it('should block unauthorized job', async () => {
      const jobId = `unauthorized-job-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: null, // No user ID
        priority: 'normal'
      };

      try {
        await orchestrator.submitJob(jobId, jobConfig);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('blocked by security policy');
      }
    });
  });

  describe('Network Isolation', () => {
    it('should create isolated network for job', async () => {
      const jobId = `network-test-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        networkConfig: {
          allowInternet: false,
          allowedDomains: ['github.com']
        }
      };

      await orchestrator.submitJob(jobId, jobConfig);
      
      // Wait for job to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check network isolation
      const networks = await docker.listNetworks();
      const jobNetwork = networks.find(n => n.Name.includes(jobId));
      expect(jobNetwork).to.exist;
      expect(jobNetwork.Internal).to.be.true;
    });

    it('should enforce network policies', async () => {
      const jobId = `network-policy-test-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        steps: [
          { run: 'curl -I https://example.com || true' } // Should fail
        ],
        networkConfig: {
          allowedDomains: ['github.com'] // example.com not allowed
        }
      };

      await orchestrator.submitJob(jobId, jobConfig);
      
      // Monitor for network violations
      const violations = [];
      orchestrator.on('securityAlert', (alert) => {
        if (alert.type === 'network_violation') {
          violations.push(alert);
        }
      });

      // Wait for job completion
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Should have network violations
      expect(violations.length).to.be.greaterThan(0);
    });
  });

  describe('Resource Quota Management', () => {
    it('should enforce resource limits', async () => {
      const jobId = `resource-test-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        resources: {
          cpu: '0.5',
          memory: '512m'
        },
        steps: [
          { run: 'stress --vm 1 --vm-bytes 1G --timeout 5s || true' } // Try to use more memory
        ]
      };

      await orchestrator.submitJob(jobId, jobConfig);

      // Monitor for resource violations
      const violations = [];
      orchestrator.on('securityAlert', (alert) => {
        if (alert.type === 'resource_violation') {
          violations.push(alert);
        }
      });

      // Wait for job execution
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Should detect resource violation
      expect(violations.length).to.be.greaterThan(0);
    });

    it('should prevent resource exhaustion', async () => {
      // Try to allocate more resources than available
      const jobs = [];
      const maxJobs = 10;

      for (let i = 0; i < maxJobs; i++) {
        const jobId = `exhaustion-test-${Date.now()}-${i}`;
        const jobConfig = {
          repository: 'test-org/test-repo',
          userId: 'admin',
          resources: {
            cpu: '2.0', // High CPU request
            memory: '4GB'
          }
        };

        try {
          await orchestrator.submitJob(jobId, jobConfig);
          jobs.push(jobId);
        } catch (error) {
          // Some jobs should fail due to resource exhaustion
          expect(error.message).to.include('resource');
        }
      }

      // Not all jobs should succeed
      expect(jobs.length).to.be.lessThan(maxJobs);
    });
  });

  describe('Container Security Scanning', () => {
    it('should scan container before execution', async function() {
      this.timeout(30000); // Scanning can take time

      const jobId = `scan-test-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        image: 'alpine:3.18' // Known good image
      };

      await orchestrator.submitJob(jobId, jobConfig);

      // Wait for scanning
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check scan results
      const securityContext = orchestrator.securityOrchestrator.jobSecurityContexts.get(jobId);
      expect(securityContext.checks.scanning).to.be.true;
      expect(securityContext.scanning).to.exist;
      expect(securityContext.scanning.overallStatus).to.equal('pass');
    });

    it('should block vulnerable images', async function() {
      this.timeout(30000);

      const jobId = `vulnerable-test-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        image: 'vulnerable/test:latest' // Simulated vulnerable image
      };

      // Mock scanner to return vulnerabilities
      if (orchestrator.securityOrchestrator.components.containerScanner) {
        sandbox.stub(orchestrator.securityOrchestrator.components.containerScanner, 'scanImage')
          .resolves({
            overallStatus: 'fail',
            vulnerabilities: {
              critical: 5,
              high: 10
            }
          });
      }

      try {
        await orchestrator.submitJob(jobId, jobConfig);
        expect.fail('Should have blocked vulnerable image');
      } catch (error) {
        expect(error.message).to.include('security');
      }
    });
  });

  describe('Runtime Security Monitoring', () => {
    it('should detect suspicious processes', async function() {
      this.timeout(20000);

      const jobId = `suspicious-test-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        steps: [
          { run: 'echo "Starting job"' },
          { run: 'nc -l 4444 &' }, // Suspicious netcat listener
          { run: 'sleep 10' }
        ]
      };

      const threats = [];
      orchestrator.on('securityThreat', (threat) => {
        threats.push(threat);
      });

      await orchestrator.submitJob(jobId, jobConfig);

      // Wait for monitoring to detect threat
      await new Promise(resolve => setTimeout(resolve, 15000));

      // Should detect suspicious process
      expect(threats.length).to.be.greaterThan(0);
      const ncThreat = threats.find(t => t.type === 'suspicious_process');
      expect(ncThreat).to.exist;
    });

    it('should detect cryptomining attempts', async function() {
      this.timeout(20000);

      const jobId = `crypto-test-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        steps: [
          { run: 'echo "xmrig --donate-level=1" > miner.sh' }, // Simulate miner
          { run: 'chmod +x miner.sh' },
          { run: './miner.sh || true' }
        ]
      };

      const threats = [];
      orchestrator.on('securityThreat', (threat) => {
        threats.push(threat);
      });

      await orchestrator.submitJob(jobId, jobConfig);

      // Wait for detection
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Should detect cryptomining pattern
      const miningThreat = threats.find(t => 
        t.type === 'cryptomining_detected' || 
        t.details?.pattern?.includes('xmrig')
      );
      expect(miningThreat).to.exist;
    });
  });

  describe('Audit Logging', () => {
    it('should log all security events', async () => {
      const jobId = `audit-test-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        steps: [
          { run: 'echo "Audit test"' }
        ]
      };

      await orchestrator.submitJob(jobId, jobConfig);
      
      // Wait for job completion
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Search audit logs
      const auditLogger = orchestrator.securityOrchestrator.components.auditLogger;
      const events = await auditLogger.search({
        resourceId: jobId,
        limit: 100
      });

      // Should have multiple audit events
      expect(events.length).to.be.greaterThan(0);
      
      // Check for key events
      const eventTypes = events.map(e => e.action);
      expect(eventTypes).to.include('job_security_context_created');
      expect(eventTypes).to.include('container_secured');
    });

    it('should maintain audit log integrity', async () => {
      const auditLogger = orchestrator.securityOrchestrator.components.auditLogger;
      
      // Create some audit events
      for (let i = 0; i < 10; i++) {
        await auditLogger.log({
          category: 'test',
          action: `test_event_${i}`,
          userId: 'test_user',
          details: { index: i }
        });
      }

      // Verify integrity
      const now = new Date();
      const results = await auditLogger.verifyIntegrity(
        new Date(now.getTime() - 3600000), // 1 hour ago
        now
      );

      expect(results.failed).to.equal(0);
      expect(results.verified).to.be.greaterThan(0);
    });
  });

  describe('RBAC Integration', () => {
    it('should enforce role-based permissions', async () => {
      const rbac = orchestrator.securityOrchestrator.components.rbac;
      
      // Create test user with limited permissions
      const user = await rbac.createUser({
        username: 'test-viewer',
        email: 'viewer@test.com'
      });
      
      await rbac.assignRole(user.id, 'viewer');

      // Try to execute job as viewer (should fail)
      const jobId = `rbac-test-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: user.id
      };

      // Mock permission check to use our RBAC
      sandbox.stub(orchestrator.securityOrchestrator, 'authorizeJob')
        .callsFake(async (userId, config) => {
          return await rbac.checkPermission(userId, 'jobs:create', {
            repository: config.repository
          });
        });

      try {
        await orchestrator.submitJob(jobId, jobConfig);
        expect.fail('Should have denied permission');
      } catch (error) {
        expect(error.message).to.include('blocked');
      }
    });
  });

  describe('Security Orchestration', () => {
    it('should coordinate all security components', async function() {
      this.timeout(30000);

      const jobId = `orchestration-test-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        priority: 'high',
        resources: {
          cpu: '1.0',
          memory: '1GB'
        },
        networkConfig: {
          allowedDomains: ['github.com', 'npmjs.org']
        },
        steps: [
          { run: 'echo "Starting orchestration test"' },
          { run: 'curl -s https://api.github.com/rate_limit' },
          { run: 'echo "Test completed"' }
        ]
      };

      // Track security events
      const events = {
        contextCreated: false,
        containerSecured: false,
        jobCompleted: false,
        securityCleanup: false
      };

      orchestrator.on('securityContextCreated', () => {
        events.contextCreated = true;
      });

      orchestrator.on('containerSecured', () => {
        events.containerSecured = true;
      });

      orchestrator.on('jobCompleted', () => {
        events.jobCompleted = true;
      });

      orchestrator.on('securityCleanup', () => {
        events.securityCleanup = true;
      });

      // Submit and execute job
      await orchestrator.submitJob(jobId, jobConfig);

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 20000));

      // Verify all security steps completed
      expect(events.contextCreated).to.be.true;
      expect(events.containerSecured).to.be.true;
      expect(events.jobCompleted).to.be.true;
      
      // Cleanup happens after delay
      await new Promise(resolve => setTimeout(resolve, 35000));
      expect(events.securityCleanup).to.be.true;
    });
  });

  describe('Threat Response', () => {
    it('should automatically respond to critical threats', async function() {
      this.timeout(20000);

      const jobId = `threat-response-${Date.now()}`;
      const jobConfig = {
        repository: 'test-org/test-repo',
        userId: 'admin',
        steps: [
          { run: 'echo "Starting threat test"' },
          { run: 'sleep 30' } // Long running job
        ]
      };

      await orchestrator.submitJob(jobId, jobConfig);

      // Wait for job to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Simulate critical threat
      await orchestrator.securityOrchestrator.handleSecurityThreat({
        type: 'malware_detected',
        severity: 'critical',
        jobId: jobId,
        containerId: 'test-container',
        message: 'Malware signature detected'
      });

      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Job should be terminated
      const activeJob = orchestrator.activeJobs.get(jobId);
      expect(activeJob).to.be.undefined;
    });
  });
});