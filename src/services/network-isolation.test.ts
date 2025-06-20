import { NetworkIsolationService } from './network-isolation';
import Docker from 'dockerode';

// Mock Docker
jest.mock('dockerode');

// Mock database
jest.mock('./database', () => ({
  default: {
    query: jest.fn().mockResolvedValue({ rows: [] })
  }
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

describe('NetworkIsolationService', () => {
  let service: NetworkIsolationService;
  let mockDocker: jest.Mocked<Docker>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock Docker instance
    mockDocker = {
      getNetwork: jest.fn(),
      createNetwork: jest.fn(),
      listNetworks: jest.fn()
    } as any;

    (Docker as jest.MockedClass<typeof Docker>).mockImplementation(() => mockDocker);
    
    // Get fresh instance
    (NetworkIsolationService as any).instance = null;
    service = NetworkIsolationService.getInstance();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = NetworkIsolationService.getInstance();
      const instance2 = NetworkIsolationService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('createRepositoryNetwork', () => {
    it('should create a new network for repository', async () => {
      const mockNetwork = { id: 'network123' };
      mockDocker.createNetwork.mockResolvedValue(mockNetwork as any);
      mockDocker.listNetworks.mockResolvedValue([]);

      const result = await service.createRepositoryNetwork('test-org/test-repo');

      expect(result).toHaveProperty('id', 'network123');
      expect(result).toHaveProperty('name', 'runnerhub-test-org-test-repo');
      expect(result).toHaveProperty('repository', 'test-org/test-repo');
      expect(result).toHaveProperty('subnet');
      expect(mockDocker.createNetwork).toHaveBeenCalledWith(
        expect.objectContaining({
          Name: 'runnerhub-test-org-test-repo',
          Driver: 'bridge',
          Internal: true,
          Attachable: true
        })
      );
    });

    it('should handle network creation errors', async () => {
      mockDocker.createNetwork.mockRejectedValue(new Error('Network creation failed'));
      mockDocker.listNetworks.mockResolvedValue([]);

      await expect(service.createRepositoryNetwork('test-org/test-repo'))
        .rejects.toThrow('Network creation failed');
    });

    it('should allocate unique subnets', async () => {
      // Mock existing networks with subnets
      mockDocker.listNetworks.mockResolvedValue([
        {
          Name: 'runnerhub-existing-repo1',
          IPAM: { Config: [{ Subnet: '10.100.1.0/24' }] }
        },
        {
          Name: 'runnerhub-existing-repo2',
          IPAM: { Config: [{ Subnet: '10.100.2.0/24' }] }
        }
      ] as any);

      mockDocker.createNetwork.mockResolvedValue({ id: 'network123' } as any);

      const result = await service.createRepositoryNetwork('test-org/new-repo');

      // Should allocate next available subnet (10.100.3.0/24)
      expect(result.subnet).toBe('10.100.3.0/24');
    });
  });

  describe('attachContainerToNetwork', () => {
    it('should attach container to network', async () => {
      const mockNetwork = {
        connect: jest.fn().mockResolvedValue(undefined),
        id: 'network123'
      };
      const mockBridgeNetwork = {
        disconnect: jest.fn().mockResolvedValue(undefined)
      };

      mockDocker.getNetwork.mockImplementation((name: string) => {
        if (name === 'bridge') return mockBridgeNetwork as any;
        return mockNetwork as any;
      });

      mockDocker.createNetwork.mockResolvedValue({ id: 'network123' } as any);
      mockDocker.listNetworks.mockResolvedValue([]);

      await service.attachContainerToNetwork('container123', 'test-org/test-repo');

      expect(mockBridgeNetwork.disconnect).toHaveBeenCalledWith({
        Container: 'container123',
        Force: true
      });
      expect(mockNetwork.connect).toHaveBeenCalledWith({
        Container: 'container123',
        EndpointConfig: {
          Aliases: ['runner-container123']
        }
      });
    });
  });

  describe('detachContainerFromNetwork', () => {
    it('should detach container from network', async () => {
      const mockNetwork = {
        disconnect: jest.fn().mockResolvedValue(undefined),
        id: 'network123'
      };

      mockDocker.getNetwork.mockReturnValue(mockNetwork as any);

      // Set up network cache
      await service['cacheNetworkInfo']({
        id: 'network123',
        name: 'runnerhub-test-org-test-repo',
        repository: 'test-org/test-repo',
        subnet: '10.100.1.0/24',
        gateway: '10.100.1.1',
        containers: ['container123'],
        created: new Date(),
        lastUsed: new Date()
      });

      await service.detachContainerFromNetwork('container123', 'test-org/test-repo');

      expect(mockNetwork.disconnect).toHaveBeenCalledWith({
        Container: 'container123',
        Force: true
      });
    });
  });

  describe('getNetworkStats', () => {
    it('should return network statistics', async () => {
      // Set up network cache
      await service['cacheNetworkInfo']({
        id: 'network1',
        name: 'runnerhub-repo1',
        repository: 'org/repo1',
        subnet: '10.100.1.0/24',
        gateway: '10.100.1.1',
        containers: ['container1', 'container2'],
        created: new Date(),
        lastUsed: new Date()
      });

      await service['cacheNetworkInfo']({
        id: 'network2',
        name: 'runnerhub-repo2',
        repository: 'org/repo2',
        subnet: '10.100.2.0/24',
        gateway: '10.100.2.1',
        containers: [],
        created: new Date(),
        lastUsed: new Date()
      });

      const stats = service.getNetworkStats();

      expect(stats.totalNetworks).toBe(2);
      expect(stats.activeNetworks).toBe(1); // Only network1 has containers
      expect(stats.isolatedContainers).toBe(2);
      expect(stats.networksByRepository.get('org/repo1')).toBe(1);
      expect(stats.networksByRepository.get('org/repo2')).toBe(1);
    });
  });

  describe('cleanupUnusedNetworks', () => {
    it('should cleanup networks without containers', async () => {
      const mockNetwork = {
        remove: jest.fn().mockResolvedValue(undefined),
        id: 'network123'
      };

      mockDocker.getNetwork.mockReturnValue(mockNetwork as any);
      mockDocker.listNetworks.mockResolvedValue([
        {
          Id: 'network123',
          Name: 'runnerhub-old-repo',
          Labels: { 'runnerhub.repository': 'org/old-repo' },
          IPAM: { Config: [{ Subnet: '10.100.1.0/24' }] },
          Containers: {} // Empty containers means no active containers
        }
      ] as any);

      const result = await service.cleanupUnusedNetworks();

      expect(result.networksRemoved).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockNetwork.remove).toHaveBeenCalled();
    });

    it('should not cleanup networks with active containers', async () => {
      mockDocker.listNetworks.mockResolvedValue([
        {
          Id: 'network123',
          Name: 'runnerhub-active-repo',
          Labels: { 'runnerhub.repository': 'org/active-repo' },
          IPAM: { Config: [{ Subnet: '10.100.1.0/24' }] },
          Containers: { 'container123': {} } // Has active container
        }
      ] as any);

      const result = await service.cleanupUnusedNetworks();

      expect(result.networksRemoved).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('verifyNetworkIsolation', () => {
    it('should verify container is properly isolated', async () => {
      const mockContainer = {
        inspect: jest.fn().mockResolvedValue({
          NetworkSettings: {
            Networks: {
              'runnerhub-test-repo': {
                NetworkID: 'network123'
              }
            }
          }
        })
      };

      (service as any).docker.getContainer = jest.fn().mockReturnValue(mockContainer);

      const result = await service.verifyNetworkIsolation('container123');

      expect(result).toBe(true);
      expect(mockContainer.inspect).toHaveBeenCalled();
    });

    it('should return false if container is on bridge network', async () => {
      const mockContainer = {
        inspect: jest.fn().mockResolvedValue({
          NetworkSettings: {
            Networks: {
              'bridge': {
                NetworkID: 'bridge123'
              },
              'runnerhub-test-repo': {
                NetworkID: 'network123'
              }
            }
          }
        })
      };

      (service as any).docker.getContainer = jest.fn().mockReturnValue(mockContainer);

      const result = await service.verifyNetworkIsolation('container123');

      expect(result).toBe(false);
    });
  });

  describe('removeRepositoryNetworks', () => {
    it('should remove all networks for a repository', async () => {
      const mockNetwork = {
        remove: jest.fn().mockResolvedValue(undefined),
        id: 'network123'
      };

      mockDocker.getNetwork.mockReturnValue(mockNetwork as any);
      
      // Set up network cache
      await service['cacheNetworkInfo']({
        id: 'network123',
        name: 'runnerhub-test-repo',
        repository: 'org/test-repo',
        subnet: '10.100.1.0/24',
        gateway: '10.100.1.1',
        containers: [],
        created: new Date(),
        lastUsed: new Date()
      });

      const result = await service.removeRepositoryNetworks('org/test-repo');

      expect(result.networksRemoved).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(mockNetwork.remove).toHaveBeenCalled();
    });
  });
});