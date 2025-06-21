/**
 * E2E Tests for Network Isolation
 * Tests network segmentation, DNS filtering, and policy enforcement
 */

const { expect } = require('chai');
const Docker = require('dockerode');
const NetworkIsolationManager = require('../../../src/container-orchestration/security/network-isolation');
const DockerAPIManager = require('../../../src/container-orchestration/docker/docker-api');

describe('Network Isolation E2E Tests', () => {
  let docker;
  let dockerAPI;
  let networkManager;
  let testNetworks = [];
  let testContainers = [];

  beforeEach(async () => {
    docker = new Docker();
    dockerAPI = new DockerAPIManager({
      baseImage: 'alpine:3.18',
      networkName: 'test-network'
    });
    
    await dockerAPI.initialize();
    
    networkManager = new NetworkIsolationManager(dockerAPI, {
      isolationMode: 'strict',
      enableDNSFiltering: true,
      allowedDomains: ['github.com', 'npmjs.org'],
      blockedPorts: [22, 23, 3389],
      networkDriver: 'bridge'
    });
    
    await networkManager.initialize();
  });

  afterEach(async () => {
    // Cleanup test resources
    for (const containerId of testContainers) {
      try {
        const container = docker.getContainer(containerId);
        await container.stop();
        await container.remove();
      } catch (error) {
        // Container might already be cleaned up
      }
    }
    
    for (const networkId of testNetworks) {
      try {
        const network = docker.getNetwork(networkId);
        await network.remove();
      } catch (error) {
        // Network might already be cleaned up
      }
    }
    
    testNetworks = [];
    testContainers = [];
  });

  describe('Network Creation and Isolation', () => {
    it('should create isolated network for job', async () => {
      const jobId = `network-create-${Date.now()}`;
      
      const network = await networkManager.createIsolatedNetwork(jobId, {
        allowInternet: false
      });
      
      expect(network).to.exist;
      expect(network.id).to.exist;
      testNetworks.push(network.id);
      
      // Verify network properties
      const dockerNetwork = await docker.getNetwork(network.id).inspect();
      expect(dockerNetwork.Internal).to.be.true; // No external access
      expect(dockerNetwork.Name).to.include(jobId);
    });

    it('should create separate networks for different jobs', async () => {
      const jobId1 = `network-job1-${Date.now()}`;
      const jobId2 = `network-job2-${Date.now()}`;
      
      const network1 = await networkManager.createIsolatedNetwork(jobId1);
      const network2 = await networkManager.createIsolatedNetwork(jobId2);
      
      testNetworks.push(network1.id, network2.id);
      
      expect(network1.id).to.not.equal(network2.id);
      
      // Create containers in each network
      const container1 = await docker.createContainer({
        Image: 'alpine:3.18',
        name: `test-container1-${Date.now()}`,
        NetworkingConfig: {
          EndpointsConfig: {
            [network1.name]: {}
          }
        },
        Cmd: ['sleep', '300']
      });
      
      const container2 = await docker.createContainer({
        Image: 'alpine:3.18',
        name: `test-container2-${Date.now()}`,
        NetworkingConfig: {
          EndpointsConfig: {
            [network2.name]: {}
          }
        },
        Cmd: ['sleep', '300']
      });
      
      await container1.start();
      await container2.start();
      testContainers.push(container1.id, container2.id);
      
      // Get container IPs
      const info1 = await container1.inspect();
      const info2 = await container2.inspect();
      
      const ip1 = info1.NetworkSettings.Networks[network1.name].IPAddress;
      const ip2 = info2.NetworkSettings.Networks[network2.name].IPAddress;
      
      // Try to ping from container1 to container2 (should fail)
      const exec = await container1.exec({
        Cmd: ['ping', '-c', '1', '-W', '1', ip2],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const stream = await exec.start();
      const output = await new Promise((resolve) => {
        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
      });
      
      // Ping should fail due to network isolation
      expect(output).to.include('unreachable');
    });
  });

  describe('DNS Filtering', () => {
    it('should allow whitelisted domains', async () => {
      const jobId = `dns-allow-${Date.now()}`;
      const network = await networkManager.createIsolatedNetwork(jobId, {
        allowInternet: true
      });
      testNetworks.push(network.id);
      
      // Create container with custom DNS
      const container = await docker.createContainer({
        Image: 'alpine:3.18',
        name: `dns-test-${Date.now()}`,
        NetworkingConfig: {
          EndpointsConfig: {
            [network.name]: {}
          }
        },
        Cmd: ['sh', '-c', 'apk add --no-cache curl && sleep 300']
      });
      
      await container.start();
      testContainers.push(container.id);
      
      // Wait for package installation
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Test allowed domain
      const exec = await container.exec({
        Cmd: ['curl', '-I', '-m', '5', 'https://github.com'],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const stream = await exec.start();
      const output = await new Promise((resolve) => {
        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
      });
      
      expect(output).to.include('200 OK');
    });

    it('should block non-whitelisted domains', async () => {
      const jobId = `dns-block-${Date.now()}`;
      const network = await networkManager.createIsolatedNetwork(jobId, {
        allowInternet: true,
        customDNS: ['8.8.8.8'] // Use public DNS
      });
      testNetworks.push(network.id);
      
      // Apply DNS filtering
      await networkManager.applyNetworkPolicies(jobId, {
        dnsPolicy: {
          allowedDomains: ['github.com'],
          blockAll: false
        }
      });
      
      const container = await docker.createContainer({
        Image: 'alpine:3.18',
        name: `dns-block-test-${Date.now()}`,
        NetworkingConfig: {
          EndpointsConfig: {
            [network.name]: {}
          }
        },
        Cmd: ['sh', '-c', 'apk add --no-cache curl && sleep 300']
      });
      
      await container.start();
      testContainers.push(container.id);
      
      // Wait for package installation
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Test blocked domain
      const exec = await container.exec({
        Cmd: ['curl', '-I', '-m', '5', 'https://example.com'],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const stream = await exec.start();
      const output = await new Promise((resolve) => {
        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
      });
      
      // Should timeout or fail
      expect(output).to.not.include('200 OK');
    });
  });

  describe('Port Restrictions', () => {
    it('should block restricted ports', async () => {
      const jobId = `port-block-${Date.now()}`;
      const network = await networkManager.createIsolatedNetwork(jobId, {
        allowInternet: true
      });
      testNetworks.push(network.id);
      
      const container = await docker.createContainer({
        Image: 'alpine:3.18',
        name: `port-test-${Date.now()}`,
        NetworkingConfig: {
          EndpointsConfig: {
            [network.name]: {}
          }
        },
        Cmd: ['sh', '-c', 'apk add --no-cache netcat-openbsd && sleep 300']
      });
      
      await container.start();
      testContainers.push(container.id);
      
      // Wait for package installation
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Try to connect to blocked port (SSH)
      const exec = await container.exec({
        Cmd: ['nc', '-zv', '-w', '2', '8.8.8.8', '22'],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const stream = await exec.start();
      const output = await new Promise((resolve) => {
        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
      });
      
      // Connection should fail
      expect(output).to.include('refused');
    });

    it('should allow non-restricted ports', async () => {
      const jobId = `port-allow-${Date.now()}`;
      const network = await networkManager.createIsolatedNetwork(jobId, {
        allowInternet: true
      });
      testNetworks.push(network.id);
      
      const container = await docker.createContainer({
        Image: 'alpine:3.18',
        name: `port-allow-test-${Date.now()}`,
        NetworkingConfig: {
          EndpointsConfig: {
            [network.name]: {}
          }
        },
        Cmd: ['sh', '-c', 'apk add --no-cache curl && sleep 300']
      });
      
      await container.start();
      testContainers.push(container.id);
      
      // Wait for package installation
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Try HTTPS (port 443)
      const exec = await container.exec({
        Cmd: ['curl', '-I', '-m', '5', 'https://github.com'],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const stream = await exec.start();
      const output = await new Promise((resolve) => {
        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
      });
      
      expect(output).to.include('200 OK');
    });
  });

  describe('Network Policies', () => {
    it('should enforce egress policies', async () => {
      const jobId = `egress-policy-${Date.now()}`;
      const network = await networkManager.createIsolatedNetwork(jobId);
      testNetworks.push(network.id);
      
      // Apply restrictive egress policy
      await networkManager.applyNetworkPolicies(jobId, {
        egress: [
          {
            to: 'github.com',
            ports: [443]
          }
        ]
      });
      
      const container = await docker.createContainer({
        Image: 'alpine:3.18',
        name: `egress-test-${Date.now()}`,
        NetworkingConfig: {
          EndpointsConfig: {
            [network.name]: {}
          }
        },
        Cmd: ['sleep', '300']
      });
      
      await container.start();
      testContainers.push(container.id);
      
      // Verify policy is in place
      const policies = networkManager.networkPolicies.get(jobId);
      expect(policies).to.exist;
      expect(policies.egress).to.have.lengthOf(1);
      expect(policies.egress[0].to).to.equal('github.com');
    });

    it('should detect policy violations', async () => {
      const jobId = `violation-test-${Date.now()}`;
      const network = await networkManager.createIsolatedNetwork(jobId);
      testNetworks.push(network.id);
      
      // Monitor for violations
      const violations = [];
      networkManager.on('securityViolation', (violation) => {
        violations.push(violation);
      });
      
      // Apply strict policy
      await networkManager.applyNetworkPolicies(jobId, {
        egress: [
          {
            to: 'github.com',
            ports: [443]
          }
        ],
        ingress: []
      });
      
      const container = await docker.createContainer({
        Image: 'alpine:3.18',
        name: `violation-container-${Date.now()}`,
        NetworkingConfig: {
          EndpointsConfig: {
            [network.name]: {}
          }
        },
        Cmd: ['sh', '-c', 'apk add --no-cache curl && curl https://example.com || true']
      });
      
      await container.start();
      testContainers.push(container.id);
      
      // Monitor traffic
      await networkManager.monitorNetworkTraffic(jobId);
      
      // Wait for violation detection
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Should have detected violation
      expect(violations.length).to.be.greaterThan(0);
    });
  });

  describe('Network Cleanup', () => {
    it('should clean up networks after job completion', async () => {
      const jobId = `cleanup-test-${Date.now()}`;
      const network = await networkManager.createIsolatedNetwork(jobId);
      
      // Verify network exists
      const networks = await docker.listNetworks();
      const exists = networks.some(n => n.Id === network.id);
      expect(exists).to.be.true;
      
      // Remove network
      await networkManager.removeIsolatedNetwork(jobId);
      
      // Verify network is removed
      const networksAfter = await docker.listNetworks();
      const stillExists = networksAfter.some(n => n.Id === network.id);
      expect(stillExists).to.be.false;
    });

    it('should handle cleanup of networks with containers', async () => {
      const jobId = `cleanup-containers-${Date.now()}`;
      const network = await networkManager.createIsolatedNetwork(jobId);
      
      // Create container in network
      const container = await docker.createContainer({
        Image: 'alpine:3.18',
        name: `cleanup-container-${Date.now()}`,
        NetworkingConfig: {
          EndpointsConfig: {
            [network.name]: {}
          }
        },
        Cmd: ['sleep', '300']
      });
      
      await container.start();
      
      // Connect container to network (already connected via creation)
      await networkManager.connectContainerToNetwork(container.id, jobId);
      
      // Try to remove network (should handle container disconnection)
      await networkManager.removeIsolatedNetwork(jobId);
      
      // Cleanup container
      await container.stop();
      await container.remove();
    });
  });

  describe('Network Performance', () => {
    it('should handle multiple concurrent networks', async () => {
      const networkCount = 10;
      const networks = [];
      
      // Create multiple networks concurrently
      const promises = [];
      for (let i = 0; i < networkCount; i++) {
        const jobId = `concurrent-${Date.now()}-${i}`;
        promises.push(networkManager.createIsolatedNetwork(jobId));
      }
      
      const results = await Promise.all(promises);
      
      expect(results).to.have.lengthOf(networkCount);
      results.forEach(network => {
        expect(network.id).to.exist;
        testNetworks.push(network.id);
      });
      
      // Cleanup
      await Promise.all(
        results.map((network, i) => 
          networkManager.removeIsolatedNetwork(`concurrent-${Date.now()}-${i}`)
        )
      );
    });
  });
});