import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { 
  NetworkManager, 
  NetworkConfig, 
  NetworkDriver, 
  NetworkScope, 
  NetworkEnvironment, 
  NetworkIsolation 
} from '../network-manager';
import { DockerClient } from '../../docker-client';

// Mock DockerClient
jest.mock('../../docker-client');
const MockedDockerClient = jest.mocked(DockerClient);

describe('NetworkManager', () => {
  let networkManager: NetworkManager;
  let mockDockerClient: jest.Mocked<DockerClient>;

  beforeEach(() => {
    // Reset singleton
    (NetworkManager as any).instance = undefined;
    
    // Mock DockerClient
    mockDockerClient = {
      createNetwork: jest.fn(),
      removeNetwork: jest.fn(),
      getContainerInfo: jest.fn(),
      docker: {
        getNetwork: jest.fn()
      }
    } as any;
    
    MockedDockerClient.getInstance.mockReturnValue(mockDockerClient);
    
    networkManager = NetworkManager.getInstance();
  });

  afterEach(() => {
    networkManager.stopMonitoring();
    jest.clearAllMocks();
  });

  describe('Network Configuration Management', () => {
    it('should initialize with default network configurations', () => {
      const configs = networkManager.listNetworkConfigs();
      
      expect(configs.length).toBe(3);
      expect(configs.map(c => c.id)).toEqual([
        'runner-bridge',
        'runner-isolated',
        'runner-performance'
      ]);
    });

    it('should register new network configuration', () => {
      const customConfig: NetworkConfig = {
        id: 'custom-network',
        name: 'custom-test-network',
        driver: NetworkDriver.BRIDGE,
        scope: NetworkScope.LOCAL,
        internal: false,
        attachable: true,
        ingress: false,
        enableIPv6: false,
        options: {},
        labels: {
          'test': 'true'
        },
        ipamConfig: {
          driver: 'default',
          config: [{
            subnet: '172.30.0.0/16',
            gateway: '172.30.0.1'
          }],
          options: {}
        },
        metadata: {
          created: new Date(),
          updated: new Date(),
          description: 'Custom test network',
          environment: NetworkEnvironment.TESTING,
          isolation: NetworkIsolation.BASIC,
          performance: {
            bandwidth: '1Gbps',
            latency: 1,
            mtu: 1500,
            priority: 5
          },
          security: {
            encrypted: false,
            firewallRules: [],
            accessControl: {
              defaultAction: 'allow',
              allowedNetworks: [],
              blockedNetworks: [],
              serviceAccounts: []
            },
            monitoring: {
              enabled: true,
              logTraffic: false,
              alertOnAnomalies: false,
              metricsCollection: true
            }
          },
          tags: ['custom', 'test']
        }
      };

      networkManager.registerNetworkConfig(customConfig);
      
      const retrieved = networkManager.getNetworkConfig('custom-network');
      expect(retrieved).toEqual(customConfig);
    });

    it('should filter network configurations', () => {
      // Filter by driver
      const bridgeNetworks = networkManager.listNetworkConfigs({
        driver: NetworkDriver.BRIDGE
      });
      expect(bridgeNetworks.length).toBe(3);

      // Filter by environment
      const prodNetworks = networkManager.listNetworkConfigs({
        environment: NetworkEnvironment.PRODUCTION
      });
      expect(prodNetworks.length).toBe(3);

      // Filter by isolation
      const strictNetworks = networkManager.listNetworkConfigs({
        isolation: NetworkIsolation.STRICT
      });
      expect(strictNetworks.length).toBe(1);
      expect(strictNetworks[0].id).toBe('runner-isolated');

      // Filter by tags
      const performanceNetworks = networkManager.listNetworkConfigs({
        tags: ['performance']
      });
      expect(performanceNetworks.length).toBe(1);
      expect(performanceNetworks[0].id).toBe('runner-performance');
    });
  });

  describe('Network Creation and Management', () => {
    beforeEach(() => {
      mockDockerClient.createNetwork.mockResolvedValue('network-123');
      mockDockerClient.removeNetwork.mockResolvedValue(undefined);
    });

    it('should create Docker network from configuration', async () => {
      const networkId = await networkManager.createNetwork('runner-bridge');

      expect(networkId).toBe('network-123');
      expect(mockDockerClient.createNetwork).toHaveBeenCalledWith(
        expect.objectContaining({
          Name: 'github-runner-bridge',
          Driver: 'bridge',
          Scope: 'local',
          Internal: false,
          Attachable: true,
          Labels: expect.objectContaining({
            'github.runner.network': 'bridge',
            'network.config.id': 'runner-bridge'
          }),
          IPAM: expect.objectContaining({
            Driver: 'default',
            Config: [{
              Subnet: '172.20.0.0/16',
              Gateway: '172.20.0.1'
            }]
          })
        })
      );
    });

    it('should remove Docker network', async () => {
      await networkManager.removeNetwork('network-123');

      expect(mockDockerClient.removeNetwork).toHaveBeenCalledWith('network-123');
    });

    it('should throw error for non-existent network configuration', async () => {
      await expect(
        networkManager.createNetwork('non-existent')
      ).rejects.toThrow('Network configuration not found: non-existent');
    });
  });

  describe('Container Network Management', () => {
    beforeEach(() => {
      const mockNetwork = {
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined)
      };
      
      (mockDockerClient as any).docker = {
        getNetwork: jest.fn().mockReturnValue(mockNetwork)
      };
    });

    it('should connect container to network', async () => {
      await networkManager.connectContainer(
        'container-123',
        'network-456',
        {
          aliases: ['test-container'],
          ipv4Address: '172.20.0.10'
        }
      );

      const mockNetwork = (mockDockerClient as any).docker.getNetwork();
      expect(mockNetwork.connect).toHaveBeenCalledWith({
        Container: 'container-123',
        EndpointConfig: {
          Aliases: ['test-container'],
          IPAMConfig: {
            IPv4Address: '172.20.0.10',
            IPv6Address: undefined
          },
          Links: undefined
        }
      });
    });

    it('should disconnect container from network', async () => {
      await networkManager.disconnectContainer('container-123', 'network-456');

      const mockNetwork = (mockDockerClient as any).docker.getNetwork();
      expect(mockNetwork.disconnect).toHaveBeenCalledWith({
        Container: 'container-123',
        Force: false
      });
    });

    it('should get container network information', async () => {
      mockDockerClient.getContainerInfo.mockResolvedValue({
        id: 'container-123',
        name: 'test-container',
        image: 'ubuntu:22.04',
        status: 'running',
        state: 'running',
        created: new Date(),
        ports: [],
        mounts: [],
        networks: [
          {
            name: 'bridge',
            id: 'network-456',
            ipAddress: '172.17.0.2',
            gateway: '172.17.0.1',
            macAddress: '02:42:ac:11:00:02'
          }
        ],
        labels: {},
        environment: []
      });

      const networkInfo = await networkManager.getContainerNetworkInfo('container-123');

      expect(networkInfo).toHaveLength(1);
      expect(networkInfo[0]).toMatchObject({
        containerId: 'container-123',
        containerName: 'test-container',
        networkId: 'network-456',
        networkName: 'bridge',
        ipAddress: '172.17.0.2',
        macAddress: '02:42:ac:11:00:02'
      });
    });
  });

  describe('Network Configuration Validation', () => {
    it('should validate network configuration', () => {
      const validConfig = networkManager.getNetworkConfig('runner-bridge')!;
      const errors = networkManager.validateNetworkConfig(validConfig);
      
      expect(errors).toEqual([]);
    });

    it('should detect validation errors', () => {
      const invalidConfig: NetworkConfig = {
        id: '',
        name: '',
        driver: NetworkDriver.BRIDGE,
        scope: NetworkScope.LOCAL,
        internal: false,
        attachable: true,
        ingress: false,
        enableIPv6: false,
        options: {},
        labels: {},
        ipamConfig: {
          driver: 'default',
          config: [], // Empty config
          options: {}
        },
        metadata: {
          created: new Date(),
          updated: new Date(),
          description: 'Invalid config',
          environment: NetworkEnvironment.TESTING,
          isolation: NetworkIsolation.STRICT, // Should require internal: true
          performance: {
            bandwidth: '1Gbps',
            latency: 1,
            mtu: 99999, // Invalid MTU
            priority: 5
          },
          security: {
            encrypted: false,
            firewallRules: [],
            accessControl: {
              defaultAction: 'allow',
              allowedNetworks: [],
              blockedNetworks: [],
              serviceAccounts: []
            },
            monitoring: {
              enabled: false,
              logTraffic: false,
              alertOnAnomalies: false,
              metricsCollection: false
            }
          },
          tags: []
        }
      };

      const errors = networkManager.validateNetworkConfig(invalidConfig);
      
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Network ID is required');
      expect(errors).toContain('Network name is required');
      expect(errors).toContain('At least one IPAM config is required');
      expect(errors).toContain('Strict isolation requires internal network');
      expect(errors).toContain('MTU must be between 68 and 9000');
    });
  });

  describe('Network Recommendations', () => {
    it('should recommend networks based on isolation requirements', () => {
      const recommendations = networkManager.getNetworkRecommendations({
        isolation: NetworkIsolation.STRICT
      });

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].id).toBe('runner-isolated');
    });

    it('should recommend networks based on performance requirements', () => {
      const recommendations = networkManager.getNetworkRecommendations({
        performance: {
          bandwidth: '10Gbps',
          latency: 1
        }
      });

      expect(recommendations.length).toBeGreaterThan(0);
      // Should prefer the performance network
      expect(recommendations[0].id).toBe('runner-performance');
    });

    it('should recommend networks based on security requirements', () => {
      const recommendations = networkManager.getNetworkRecommendations({
        security: {
          monitoring: true
        }
      });

      // All default networks have monitoring enabled
      expect(recommendations.length).toBe(3);
    });

    it('should recommend networks based on environment', () => {
      const recommendations = networkManager.getNetworkRecommendations({
        environment: NetworkEnvironment.PRODUCTION
      });

      expect(recommendations.length).toBe(3);
      // All default networks are for production
    });
  });

  describe('Network Monitoring', () => {
    it('should start and stop monitoring', () => {
      const startSpy = jest.spyOn(networkManager, 'emit');
      
      networkManager.startMonitoring(1000);
      expect(startSpy).toHaveBeenCalledWith('monitoring:started', { intervalMs: 1000 });

      networkManager.stopMonitoring();
      expect(startSpy).toHaveBeenCalledWith('monitoring:stopped');
    });

    it('should collect network metrics', async () => {
      const metricsSpy = jest.spyOn(networkManager, 'emit');
      
      // Start monitoring with very short interval for testing
      networkManager.startMonitoring(100);
      
      // Wait for at least one metrics collection
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(metricsSpy).toHaveBeenCalledWith(
        'metrics:collected',
        expect.objectContaining({
          networkId: expect.any(String),
          stats: expect.objectContaining({
            networkId: expect.any(String),
            bytesReceived: expect.any(Number),
            bytesSent: expect.any(Number),
            timestamp: expect.any(Date)
          })
        })
      );
    });

    it('should get network statistics', async () => {
      // Start monitoring to generate some stats
      networkManager.startMonitoring(50);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const stats = await networkManager.getNetworkStats('runner-bridge');
      expect(stats).toBeTruthy();
      expect(stats!.networkId).toBe('runner-bridge');
      expect(stats!.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Network Configuration Updates', () => {
    it('should update network configuration', () => {
      networkManager.updateNetworkConfig('runner-bridge', {
        metadata: {
          description: 'Updated bridge network description',
          tags: ['updated', 'bridge']
        }
      });

      const updated = networkManager.getNetworkConfig('runner-bridge')!;
      expect(updated.metadata.description).toBe('Updated bridge network description');
      expect(updated.metadata.tags).toContain('updated');
      expect(updated.metadata.updated.getTime()).toBeGreaterThan(
        updated.metadata.created.getTime()
      );
    });

    it('should remove network configuration', () => {
      const result = networkManager.removeNetworkConfig('runner-bridge');
      
      expect(result).toBe(true);
      expect(networkManager.getNetworkConfig('runner-bridge')).toBeUndefined();
    });

    it('should throw error when updating non-existent configuration', () => {
      expect(() => {
        networkManager.updateNetworkConfig('non-existent', {
          name: 'Updated Name'
        });
      }).toThrow('Network configuration not found: non-existent');
    });
  });

  describe('Network Manager Statistics', () => {
    it('should provide network manager statistics', () => {
      const stats = networkManager.getNetworkManagerStats();

      expect(stats).toMatchObject({
        totalNetworks: 3,
        byDriver: {
          'bridge': 3
        },
        byIsolation: {
          'basic': 2,
          'strict': 1
        },
        byEnvironment: {
          'production': 3
        },
        monitoring: {
          enabled: false,
          networksWithStats: 0,
          totalDataPoints: 0
        }
      });
    });

    it('should show monitoring stats when active', () => {
      networkManager.startMonitoring(100);
      
      const stats = networkManager.getNetworkManagerStats();
      expect(stats.monitoring.enabled).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle Docker network creation errors', async () => {
      const error = new Error('Docker daemon not responding');
      mockDockerClient.createNetwork.mockRejectedValue(error);

      const errorSpy = jest.spyOn(networkManager, 'emit');

      await expect(
        networkManager.createNetwork('runner-bridge')
      ).rejects.toThrow('Docker daemon not responding');

      expect(errorSpy).toHaveBeenCalledWith(
        'network:create:failed',
        expect.objectContaining({
          config: expect.any(Object),
          error
        })
      );
    });

    it('should handle container connection errors', async () => {
      const error = new Error('Container not found');
      const mockNetwork = {
        connect: jest.fn().mockRejectedValue(error)
      };
      
      (mockDockerClient as any).docker = {
        getNetwork: jest.fn().mockReturnValue(mockNetwork)
      };

      const errorSpy = jest.spyOn(networkManager, 'emit');

      await expect(
        networkManager.connectContainer('container-123', 'network-456')
      ).rejects.toThrow('Container not found');

      expect(errorSpy).toHaveBeenCalledWith(
        'container:connect:failed',
        expect.objectContaining({
          containerId: 'container-123',
          networkId: 'network-456',
          error
        })
      );
    });
  });
});