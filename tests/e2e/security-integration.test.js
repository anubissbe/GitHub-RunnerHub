/**
 * End-to-End Security Integration Tests
 * Tests the complete security implementation with all components working together
 */

const { describe, it, beforeEach, afterEach, expect } = require('@jest/globals');
const Docker = require('dockerode');
const SecurityOrchestrator = require('../../src/security/security-orchestrator');
const NetworkIsolationManager = require('../../src/security/network-isolation');
const ResourceQuotaManager = require('../../src/security/resource-quotas');
const SecretManager = require('../../src/security/secret-management');
const ContainerSecurityScanner = require('../../src/security/container-scanner');
const AuditLogger = require('../../src/security/audit-logger');

describe('Security Integration E2E Tests', () => {
  let docker;
  let securityOrchestrator;
  let testContainerIds = [];
  let testNetworkIds = [];

  beforeEach(async () => {
    // Initialize Docker client
    docker = new Docker();
    
    // Initialize security orchestrator with test configuration
    securityOrchestrator = new SecurityOrchestrator(docker, {
      securityLevel: 'high',
      networkIsolation: {
        isolationMode: 'strict',
        subnetBase: '172.30.0.0/16'
      },
      resourceQuotas: {
        defaultCpuLimit: 1.0,
        defaultMemoryLimit: 512
      },
      secretManagement: {
        storageType: 'memory',
        requireEncryption: true
      },
      containerScanning: {
        trivyEnabled: false, // Disable external tools for E2E tests
        blockCritical: true
      },
      auditLogging: {
        destinations: ['memory'],
        logLevel: 'INFO'
      }
    });

    await securityOrchestrator.initialize();
  });

  afterEach(async () => {
    // Clean up test containers
    for (const containerId of testContainerIds) {
      try {
        const container = docker.getContainer(containerId);
        await container.remove({ force: true });
      } catch (error) {
        // Container might already be removed
      }
    }

    // Clean up test networks
    for (const networkId of testNetworkIds) {
      try {
        const network = docker.getNetwork(networkId);
        await network.remove();
      } catch (error) {
        // Network might already be removed
      }
    }

    if (securityOrchestrator) {
      await securityOrchestrator.stop();
    }

    testContainerIds = [];
    testNetworkIds = [];
  });

  describe('Complete Security Workflow', () => {
    it('should create secure job context and container', async () => {
      const jobId = 'test-job-001';
      const jobConfig = {
        actor: 'test-user',
        image: 'alpine:latest',
        imageId: 'alpine:latest',
        resources: {
          cpu: 0.5,
          memory: 256
        },
        secrets: ['test-secret-1', 'test-secret-2']
      };

      // Step 1: Create security context
      const securityContext = await securityOrchestrator.createJobSecurityContext(jobId, jobConfig);
      
      expect(securityContext).toBeDefined();
      expect(securityContext.jobId).toBe(jobId);
      expect(securityContext.components.network).toBeDefined();
      expect(securityContext.components.resourceQuotas).toBeDefined();
      expect(securityContext.components.secrets).toBeDefined();

      // Step 2: Create and secure container
      const containerConfig = {
        Image: 'alpine:latest',
        Cmd: ['sleep', '30'],
        resources: jobConfig.resources,
        network: {}
      };

      const container = await docker.createContainer(containerConfig);
      testContainerIds.push(container.id);

      const secureResult = await securityOrchestrator.secureContainer(container.id, jobId, containerConfig);
      
      expect(secureResult.blocked).toBe(false);
      expect(secureResult.securityContext).toBeDefined();

      // Step 3: Verify network isolation
      const networkStatus = securityOrchestrator.components.networkIsolation.getNetworkStatus();
      expect(networkStatus.activeNetworks).toBeGreaterThan(0);

      // Step 4: Verify resource allocation
      const quotaStatus = securityOrchestrator.components.resourceQuotas.getQuotaStatus();
      expect(quotaStatus.activeAllocations).toBeGreaterThan(0);

      // Step 5: Cleanup
      await securityOrchestrator.cleanupJobSecurity(jobId);
      
      const finalQuotaStatus = securityOrchestrator.components.resourceQuotas.getQuotaStatus();
      expect(finalQuotaStatus.activeAllocations).toBe(0);
    });

    it('should block container with critical vulnerabilities', async () => {
      const jobId = 'test-job-002';
      const jobConfig = {
        actor: 'test-user',
        image: 'vulnerable-image:latest',
        imageId: 'vulnerable-image:latest'
      };

      // Mock vulnerable scan result
      jest.spyOn(securityOrchestrator.components.containerScanner, 'scanImage')
        .mockResolvedValue({
          vulnerabilities: [
            { id: 'CVE-2023-1234', severity: 'CRITICAL' },
            { id: 'CVE-2023-5678', severity: 'HIGH' }
          ],
          summary: {
            severityCounts: { CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0 },
            riskScore: 50
          },
          policy: {
            blocked: true,
            reason: 'Critical vulnerabilities detected'
          }
        });

      const securityContext = await securityOrchestrator.createJobSecurityContext(jobId, jobConfig);
      
      const containerConfig = {
        Image: 'vulnerable-image:latest',
        Cmd: ['sleep', '10']
      };

      const container = await docker.createContainer(containerConfig);
      testContainerIds.push(container.id);

      const secureResult = await securityOrchestrator.secureContainer(container.id, jobId, containerConfig);
      
      expect(secureResult.blocked).toBe(true);
      expect(secureResult.reason).toContain('Critical vulnerabilities');
    });

    it('should handle resource quota violations', async () => {
      const jobId = 'test-job-003';
      const jobConfig = {
        actor: 'test-user',
        image: 'alpine:latest',
        imageId: 'alpine:latest',
        resources: {
          cpu: 10.0, // Excessive CPU request
          memory: 1024
        }
      };

      // This should fail due to insufficient resources
      await expect(
        securityOrchestrator.createJobSecurityContext(jobId, jobConfig)
      ).rejects.toThrow(/Insufficient CPU/);
    });

    it('should inject and manage secrets securely', async () => {
      const jobId = 'test-job-004';
      const secretManager = securityOrchestrator.components.secretManager;

      // Store test secrets
      await secretManager.storeSecret('test-secret-1', { 
        token: 'abc123',
        type: 'api_key' 
      });
      await secretManager.storeSecret('test-secret-2', { 
        username: 'testuser',
        password: 'testpass' 
      });

      const jobConfig = {
        actor: 'test-user',
        image: 'alpine:latest',
        imageId: 'alpine:latest',
        secrets: [
          { secretId: 'test-secret-1', method: 'env', target: 'API_TOKEN' },
          { secretId: 'test-secret-2', method: 'file', target: '/secrets/creds' }
        ]
      };

      const securityContext = await securityOrchestrator.createJobSecurityContext(jobId, jobConfig);
      
      const containerConfig = {
        Image: 'alpine:latest',
        Cmd: ['sleep', '10']
      };

      const container = await docker.createContainer(containerConfig);
      testContainerIds.push(container.id);

      const secureResult = await securityOrchestrator.secureContainer(container.id, jobId, containerConfig);
      
      expect(secureResult.blocked).toBe(false);
      expect(secureResult.securityContext.components.secrets.injected).toBeDefined();
      expect(secureResult.securityContext.components.secrets.injected.length).toBe(2);

      // Verify secrets were injected correctly
      const injectedSecrets = secureResult.securityContext.components.secrets.injected;
      expect(injectedSecrets[0].method).toBe('env');
      expect(injectedSecrets[0].target).toBe('API_TOKEN');
      expect(injectedSecrets[1].method).toBe('file');
      expect(injectedSecrets[1].target).toBe('/secrets/creds');
    });

    it('should generate comprehensive audit logs', async () => {
      const jobId = 'test-job-005';
      const auditLogger = securityOrchestrator.components.auditLogger;
      
      // Clear existing logs
      auditLogger.logBuffer = [];

      const jobConfig = {
        actor: 'test-user',
        image: 'alpine:latest',
        imageId: 'alpine:latest'
      };

      // Perform security operations
      await securityOrchestrator.createJobSecurityContext(jobId, jobConfig);
      
      const containerConfig = {
        Image: 'alpine:latest',
        Cmd: ['sleep', '5']
      };

      const container = await docker.createContainer(containerConfig);
      testContainerIds.push(container.id);

      await securityOrchestrator.secureContainer(container.id, jobId, containerConfig);
      await securityOrchestrator.cleanupJobSecurity(jobId);

      // Force flush of audit logs
      await auditLogger.flush();

      // Verify audit events were logged
      const auditStatus = auditLogger.getAuditStatus();
      expect(auditStatus.statistics.totalEvents).toBeGreaterThan(5);
      
      // Check for specific audit events
      const jobEvents = auditLogger.logBuffer.filter(event => 
        event.category === 'job' && event.resource === jobId
      );
      expect(jobEvents.length).toBeGreaterThan(0);

      const containerEvents = auditLogger.logBuffer.filter(event => 
        event.category === 'container' && event.resource === container.id
      );
      expect(containerEvents.length).toBeGreaterThan(0);
    });

    it('should maintain security component isolation', async () => {
      // Test that components can be used independently
      const networkManager = new NetworkIsolationManager(docker);
      const resourceManager = new ResourceQuotaManager(docker);
      const secretManager = new SecretManager();
      const scanner = new ContainerSecurityScanner(docker);
      const auditLogger = new AuditLogger();

      await networkManager.initialize();
      await resourceManager.initialize();
      await secretManager.initialize();
      await scanner.initialize();
      await auditLogger.initialize();

      // Verify each component is functional independently
      expect(networkManager.isInitialized).toBe(true);
      expect(resourceManager.isInitialized).toBe(true);
      expect(secretManager.isInitialized).toBe(true);
      expect(scanner.isInitialized).toBe(true);
      expect(auditLogger.isInitialized).toBe(true);

      // Clean up
      await networkManager.stop();
      await resourceManager.stop();
      await secretManager.stop();
      await scanner.stop();
      await auditLogger.stop();
    });
  });

  describe('Security Event Handling', () => {
    it('should handle security alerts and events', async () => {
      const alerts = [];
      
      securityOrchestrator.on('securityAlert', (alert) => {
        alerts.push(alert);
      });

      const jobId = 'test-job-006';
      const jobConfig = {
        actor: 'test-user',
        image: 'alpine:latest',
        imageId: 'alpine:latest'
      };

      await securityOrchestrator.createJobSecurityContext(jobId, jobConfig);

      // Simulate a security alert
      securityOrchestrator.components.networkIsolation.emit('securityAlert', {
        type: 'suspicious_connection',
        networkId: 'test-network',
        details: 'Unusual traffic pattern detected'
      });

      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].type).toBe('network_security');
    });

    it('should handle component failures gracefully', async () => {
      const jobId = 'test-job-007';
      const jobConfig = {
        actor: 'test-user',
        image: 'alpine:latest',
        imageId: 'alpine:latest'
      };

      // Mock a component failure
      jest.spyOn(securityOrchestrator.components.networkIsolation, 'createIsolatedNetwork')
        .mockRejectedValue(new Error('Network creation failed'));

      await expect(
        securityOrchestrator.createJobSecurityContext(jobId, jobConfig)
      ).rejects.toThrow('Network creation failed');

      // Verify audit log captured the error
      const auditStatus = securityOrchestrator.components.auditLogger.getAuditStatus();
      expect(auditStatus.statistics.totalEvents).toBeGreaterThan(0);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle multiple concurrent jobs', async () => {
      const jobPromises = [];
      const jobCount = 5;

      for (let i = 0; i < jobCount; i++) {
        const jobId = `concurrent-job-${i}`;
        const jobConfig = {
          actor: 'test-user',
          image: 'alpine:latest',
          imageId: 'alpine:latest',
          resources: {
            cpu: 0.2,
            memory: 128
          }
        };

        jobPromises.push(
          securityOrchestrator.createJobSecurityContext(jobId, jobConfig)
        );
      }

      const securityContexts = await Promise.all(jobPromises);
      expect(securityContexts.length).toBe(jobCount);

      // Verify all contexts are tracked
      const orchestratorStatus = securityOrchestrator.getSecurityStatus();
      expect(orchestratorStatus.activeContexts).toBe(jobCount);

      // Clean up all jobs
      for (let i = 0; i < jobCount; i++) {
        await securityOrchestrator.cleanupJobSecurity(`concurrent-job-${i}`);
      }

      const finalStatus = securityOrchestrator.getSecurityStatus();
      expect(finalStatus.activeContexts).toBe(0);
    });

    it('should maintain performance under load', async () => {
      const startTime = Date.now();
      const operationCount = 10;

      for (let i = 0; i < operationCount; i++) {
        const jobId = `perf-job-${i}`;
        const jobConfig = {
          actor: 'test-user',
          image: 'alpine:latest',
          imageId: 'alpine:latest'
        };

        await securityOrchestrator.createJobSecurityContext(jobId, jobConfig);
        await securityOrchestrator.cleanupJobSecurity(jobId);
      }

      const duration = Date.now() - startTime;
      const avgTimePerOperation = duration / operationCount;

      // Should complete operations reasonably quickly
      expect(avgTimePerOperation).toBeLessThan(1000); // Less than 1 second per operation
    });
  });
});