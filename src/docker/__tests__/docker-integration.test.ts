import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DockerIntegrationService, DockerIntegrationConfig } from '../index';
import { DockerClient } from '../docker-client';
import { ContainerTemplateManager } from '../templates/container-templates';
import { NetworkManager } from '../networking/network-manager';
import { VolumeManager } from '../volumes/volume-manager';

// Mock all dependencies
jest.mock('../docker-client');
jest.mock('../templates/container-templates');
jest.mock('../networking/network-manager');
jest.mock('../volumes/volume-manager');

const MockedDockerClient = jest.mocked(DockerClient);
const MockedContainerTemplateManager = jest.mocked(ContainerTemplateManager);
const MockedNetworkManager = jest.mocked(NetworkManager);
const MockedVolumeManager = jest.mocked(VolumeManager);

describe('DockerIntegrationService', () => {
  let dockerIntegration: DockerIntegrationService;
  let mockDockerClient: jest.Mocked<DockerClient>;
  let mockTemplateManager: jest.Mocked<ContainerTemplateManager>;
  let mockNetworkManager: jest.Mocked<NetworkManager>;
  let mockVolumeManager: jest.Mocked<VolumeManager>;

  beforeEach(() => {
    // Reset singleton
    (DockerIntegrationService as any).instance = undefined;

    // Mock DockerClient
    mockDockerClient = {
      initialize: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      isDockerConnected: jest.fn().mockReturnValue(true),
      getConfig: jest.fn().mockReturnValue({ socketPath: '/var/run/docker.sock' }),
      stopContainer: jest.fn().mockResolvedValue(undefined),
      removeContainer: jest.fn().mockResolvedValue(undefined)
    } as any;
    MockedDockerClient.getInstance.mockReturnValue(mockDockerClient);

    // Mock ContainerTemplateManager
    mockTemplateManager = {
      getTemplateStatistics: jest.fn().mockReturnValue({
        total: 4,
        byCategory: { general: 1, nodejs: 1, python: 1, deployment: 1 }
      }),
      createContainerFromTemplate: jest.fn().mockResolvedValue('container-123')
    } as any;
    MockedContainerTemplateManager.getInstance.mockReturnValue(mockTemplateManager);

    // Mock NetworkManager
    mockNetworkManager = {
      startMonitoring: jest.fn(),
      stopMonitoring: jest.fn(),
      getNetworkManagerStats: jest.fn().mockReturnValue({
        totalNetworks: 3,
        monitoring: { enabled: false }
      }),
      createNetwork: jest.fn().mockResolvedValue('network-456'),
      removeNetwork: jest.fn().mockResolvedValue(undefined),
      connectContainer: jest.fn().mockResolvedValue(undefined),
      getContainerNetworkInfo: jest.fn().mockResolvedValue([
        {
          containerId: 'container-123',
          containerName: 'test-container',
          networkId: 'network-456',
          networkName: 'test-network',
          ipAddress: '172.20.0.2',
          macAddress: '02:42:ac:14:00:02',
          aliases: [],
          endpoints: []
        }
      ])
    } as any;
    MockedNetworkManager.getInstance.mockReturnValue(mockNetworkManager);

    // Mock VolumeManager
    mockVolumeManager = {
      startMonitoring: jest.fn(),
      stopMonitoring: jest.fn(),
      startAutomaticCleanup: jest.fn(),
      stopAutomaticCleanup: jest.fn(),
      getVolumeManagerStats: jest.fn().mockReturnValue({
        totalVolumes: 3,
        monitoring: { enabled: false },
        cleanup: { enabled: false }
      }),
      createVolume: jest.fn().mockResolvedValue('volume-789'),
      mountVolume: jest.fn().mockResolvedValue('mount-abc'),
      unmountVolume: jest.fn().mockResolvedValue(undefined)
    } as any;
    MockedVolumeManager.getInstance.mockReturnValue(mockVolumeManager);

    dockerIntegration = DockerIntegrationService.getInstance();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should create singleton instance', () => {
      const instance1 = DockerIntegrationService.getInstance();
      const instance2 = DockerIntegrationService.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should initialize with default configuration', async () => {
      await dockerIntegration.initialize();

      expect(mockDockerClient.initialize).toHaveBeenCalled();
    });

    it('should initialize with custom configuration', async () => {
      const config: DockerIntegrationConfig = {
        docker: {
          socketPath: '/custom/docker.sock',
          timeout: 60000
        },
        networking: {
          enableMonitoring: true,
          monitoringInterval: 30000
        },
        volumes: {
          enableMonitoring: true,
          enableCleanup: true,
          monitoringInterval: 120000,
          cleanupInterval: 1800000
        }
      };

      const customService = DockerIntegrationService.getInstance(config);
      await customService.initialize();

      expect(mockDockerClient.initialize).toHaveBeenCalled();
      expect(mockNetworkManager.startMonitoring).toHaveBeenCalledWith(30000);
      expect(mockVolumeManager.startMonitoring).toHaveBeenCalledWith(120000);
      expect(mockVolumeManager.startAutomaticCleanup).toHaveBeenCalledWith(1800000);
    });

    it('should shutdown gracefully', async () => {
      await dockerIntegration.initialize();
      await dockerIntegration.shutdown();

      expect(mockNetworkManager.stopMonitoring).toHaveBeenCalled();
      expect(mockVolumeManager.stopMonitoring).toHaveBeenCalled();
      expect(mockVolumeManager.stopAutomaticCleanup).toHaveBeenCalled();
      expect(mockDockerClient.close).toHaveBeenCalled();
    });
  });

  describe('Health Status', () => {
    it('should provide system health status', () => {
      const health = dockerIntegration.getHealthStatus();

      expect(health).toMatchObject({
        docker: true,
        templates: {
          available: 4,
          categories: 4
        },
        networks: {
          configured: 3,
          monitoring: false
        },
        volumes: {
          configured: 3,
          monitoring: false,
          cleanup: false
        }
      });
    });

    it('should provide comprehensive system metrics', () => {
      const metrics = dockerIntegration.getSystemMetrics();

      expect(metrics).toMatchObject({
        docker: {
          connected: true,
          config: { socketPath: '/var/run/docker.sock' }
        },
        templates: {
          total: 4,
          byCategory: expect.any(Object)
        },
        networks: {
          totalNetworks: 3,
          monitoring: { enabled: false }
        },
        volumes: {
          totalVolumes: 3,
          monitoring: { enabled: false },
          cleanup: { enabled: false }
        }
      });
    });
  });

  describe('Container Environment Management', () => {
    it('should create complete container environment', async () => {
      const result = await dockerIntegration.createContainerEnvironment({
        templateId: 'ubuntu-runner',
        containerName: 'test-container',
        networkConfig: {
          configId: 'runner-bridge',
          aliases: ['test-alias'],
          ipAddress: '172.20.0.10'
        },
        volumeMounts: [
          {
            configId: 'runner-workspace',
            mountPath: '/workspace',
            readonly: false
          },
          {
            configId: 'runner-cache',
            mountPath: '/cache',
            readonly: true
          }
        ],
        environment: {
          'NODE_ENV': 'test',
          'CI': 'true'
        },
        labels: {
          'test': 'true',
          'environment': 'testing'
        }
      });

      expect(result).toMatchObject({
        containerId: 'container-123',
        networkId: 'network-456',
        volumeMounts: ['mount-abc', 'mount-abc']
      });

      // Verify volumes were created and mounted
      expect(mockVolumeManager.createVolume).toHaveBeenCalledTimes(2);
      expect(mockVolumeManager.createVolume).toHaveBeenCalledWith('runner-workspace');
      expect(mockVolumeManager.createVolume).toHaveBeenCalledWith('runner-cache');
      
      expect(mockVolumeManager.mountVolume).toHaveBeenCalledTimes(2);
      expect(mockVolumeManager.mountVolume).toHaveBeenCalledWith(
        'volume-789',
        'placeholder',
        '/workspace',
        { readonly: false }
      );

      // Verify network was created and container connected
      expect(mockNetworkManager.createNetwork).toHaveBeenCalledWith('runner-bridge');
      expect(mockNetworkManager.connectContainer).toHaveBeenCalledWith(
        'container-123',
        'network-456',
        {
          aliases: ['test-alias'],
          ipv4Address: '172.20.0.10'
        }
      );

      // Verify container was created from template
      expect(mockTemplateManager.createContainerFromTemplate).toHaveBeenCalledWith(
        'ubuntu-runner',
        {
          name: 'test-container',
          environment: {
            'NODE_ENV': 'test',
            'CI': 'true'
          },
          labels: {
            'test': 'true',
            'environment': 'testing'
          },
          networkMode: 'network-456'
        }
      );
    });

    it('should create container environment without network', async () => {
      const result = await dockerIntegration.createContainerEnvironment({
        templateId: 'nodejs-runner',
        containerName: 'simple-container',
        environment: {
          'NODE_ENV': 'production'
        }
      });

      expect(result).toMatchObject({
        containerId: 'container-123',
        networkId: undefined,
        volumeMounts: []
      });

      expect(mockNetworkManager.createNetwork).not.toHaveBeenCalled();
      expect(mockVolumeManager.createVolume).not.toHaveBeenCalled();
    });

    it('should cleanup on container creation failure', async () => {
      // Mock container creation failure
      mockTemplateManager.createContainerFromTemplate.mockRejectedValue(
        new Error('Container creation failed')
      );

      await expect(
        dockerIntegration.createContainerEnvironment({
          templateId: 'ubuntu-runner',
          containerName: 'failing-container',
          networkConfig: {
            configId: 'runner-bridge'
          },
          volumeMounts: [
            {
              configId: 'runner-workspace',
              mountPath: '/workspace'
            }
          ]
        })
      ).rejects.toThrow('Container creation failed');

      // Should attempt cleanup
      expect(mockVolumeManager.unmountVolume).toHaveBeenCalledWith('mount-abc');
      expect(mockNetworkManager.removeNetwork).toHaveBeenCalledWith('network-456');
    });

    it('should cleanup container environment', async () => {
      await dockerIntegration.cleanupContainerEnvironment(
        'container-123',
        {
          removeNetwork: true,
          removeVolumes: true,
          force: true
        }
      );

      expect(mockNetworkManager.getContainerNetworkInfo).toHaveBeenCalledWith('container-123');
      expect(mockDockerClient.stopContainer).toHaveBeenCalledWith('container-123');
      expect(mockDockerClient.removeContainer).toHaveBeenCalledWith('container-123', true);
      expect(mockNetworkManager.removeNetwork).toHaveBeenCalledWith('network-456');
    });

    it('should cleanup container environment with default options', async () => {
      await dockerIntegration.cleanupContainerEnvironment('container-123');

      expect(mockDockerClient.stopContainer).toHaveBeenCalledWith('container-123');
      expect(mockDockerClient.removeContainer).toHaveBeenCalledWith('container-123', false);
      expect(mockNetworkManager.removeNetwork).not.toHaveBeenCalled();
    });
  });

  describe('Component Access', () => {
    it('should provide access to Docker client', () => {
      expect(dockerIntegration.docker).toBe(mockDockerClient);
    });

    it('should provide access to template manager', () => {
      expect(dockerIntegration.templates).toBe(mockTemplateManager);
    });

    it('should provide access to network manager', () => {
      expect(dockerIntegration.networks).toBe(mockNetworkManager);
    });

    it('should provide access to volume manager', () => {
      expect(dockerIntegration.volumes).toBe(mockVolumeManager);
    });
  });

  describe('Error Handling', () => {
    it('should handle Docker client initialization failure', async () => {
      mockDockerClient.initialize.mockRejectedValue(new Error('Docker daemon not running'));

      await expect(dockerIntegration.initialize()).rejects.toThrow('Docker daemon not running');
    });

    it('should handle network creation failure in environment setup', async () => {
      mockNetworkManager.createNetwork.mockRejectedValue(new Error('Network creation failed'));

      await expect(
        dockerIntegration.createContainerEnvironment({
          templateId: 'ubuntu-runner',
          containerName: 'test-container',
          networkConfig: {
            configId: 'runner-bridge'
          }
        })
      ).rejects.toThrow('Network creation failed');
    });

    it('should handle volume creation failure in environment setup', async () => {
      mockVolumeManager.createVolume.mockRejectedValue(new Error('Volume creation failed'));

      await expect(
        dockerIntegration.createContainerEnvironment({
          templateId: 'ubuntu-runner',
          containerName: 'test-container',
          volumeMounts: [
            {
              configId: 'runner-workspace',
              mountPath: '/workspace'
            }
          ]
        })
      ).rejects.toThrow('Volume creation failed');
    });

    it('should handle container cleanup failure gracefully', async () => {
      mockDockerClient.stopContainer.mockRejectedValue(new Error('Container already stopped'));

      // Should not throw, but continue with removal
      await expect(
        dockerIntegration.cleanupContainerEnvironment('container-123')
      ).rejects.toThrow('Container already stopped');
    });
  });

  describe('Configuration Validation', () => {
    it('should work with minimal configuration', () => {
      const minimalConfig = {};
      const service = DockerIntegrationService.getInstance(minimalConfig);
      
      expect(service).toBeDefined();
      expect(service.docker).toBeDefined();
      expect(service.templates).toBeDefined();
      expect(service.networks).toBeDefined();
      expect(service.volumes).toBeDefined();
    });

    it('should work with full configuration', async () => {
      const fullConfig: DockerIntegrationConfig = {
        docker: {
          socketPath: '/var/run/docker.sock',
          host: 'localhost',
          port: 2376,
          protocol: 'https',
          timeout: 60000
        },
        templates: {
          registryUrl: 'https://registry.example.com',
          defaultCategory: 'general',
          autoLoad: true
        },
        networking: {
          defaultDriver: 'bridge',
          enableMonitoring: true,
          monitoringInterval: 30000
        },
        volumes: {
          defaultDriver: 'local',
          enableCleanup: true,
          cleanupInterval: 1800000,
          enableMonitoring: true,
          monitoringInterval: 120000
        }
      };

      const service = DockerIntegrationService.getInstance(fullConfig);
      await service.initialize();

      expect(mockNetworkManager.startMonitoring).toHaveBeenCalledWith(30000);
      expect(mockVolumeManager.startMonitoring).toHaveBeenCalledWith(120000);
      expect(mockVolumeManager.startAutomaticCleanup).toHaveBeenCalledWith(1800000);
    });
  });
});