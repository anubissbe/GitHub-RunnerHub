import { ContainerAssignmentManager, ContainerStatus, LoadBalancingStrategy } from '../container-assignment';

// Mock dependencies
jest.mock('../../utils/logger');
jest.mock('../../services/database-service');
jest.mock('../../services/metrics-collector');

describe('ContainerAssignmentManager', () => {
  let manager: ContainerAssignmentManager;

  beforeEach(() => {
    // Reset singleton instance
    (ContainerAssignmentManager as any).instance = null;
    manager = ContainerAssignmentManager.getInstance();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().getActiveContainers.mockResolvedValue([]);

      await manager.initialize();

      expect(mockDatabaseService.getInstance().getActiveContainers).toHaveBeenCalled();
    });

    it('should load existing containers from database', async () => {
      const mockContainers = [
        {
          id: 'container-1',
          name: 'test-container-1',
          image: 'ubuntu:latest',
          status: ContainerStatus.READY,
          labels: { 'self-hosted': 'true' },
          resources: { cpu: 2, memory: '4Gi', disk: '20Gi' },
          createdAt: new Date(),
          lastHealthCheck: new Date(),
          healthStatus: { healthy: true, lastCheck: new Date(), checks: {} },
          utilization: { cpu: 0.1, memory: 0.2, disk: 0.1, network: 0.05 }
        }
      ];

      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().getActiveContainers.mockResolvedValue(mockContainers);

      await manager.initialize();

      const stats = manager.getStatistics();
      expect(stats.total).toBe(1);
    });
  });

  describe('container registration', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should register new container', async () => {
      const container = {
        id: 'container-1',
        name: 'test-container',
        image: 'ubuntu:latest',
        status: ContainerStatus.READY,
        labels: { 'self-hosted': 'true', 'linux': 'true' },
        resources: { cpu: 2, memory: '4Gi', disk: '20Gi' },
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
        utilization: { cpu: 0.1, memory: 0.2, disk: 0.1, network: 0.05 }
      };

      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().saveContainer.mockResolvedValue(undefined);

      await manager.registerContainer(container);

      const stats = manager.getStatistics();
      expect(stats.total).toBe(1);
      expect(stats.ready).toBe(1);
    });

    it('should emit registration event', async () => {
      const container = {
        id: 'container-1',
        name: 'test-container',
        image: 'ubuntu:latest',
        status: ContainerStatus.READY,
        labels: {},
        resources: { cpu: 1, memory: '2Gi', disk: '10Gi' },
        createdAt: new Date(),
        lastHealthCheck: new Date(),
        healthStatus: { healthy: true, lastCheck: new Date(), checks: {} as any },
        utilization: { cpu: 0, memory: 0, disk: 0, network: 0 }
      };

      let registrationEvent: any = null;
      manager.on('container:registered', (event) => {
        registrationEvent = event;
      });

      await manager.registerContainer(container);

      expect(registrationEvent).toEqual(container);
    });
  });

  describe('container assignment', () => {
    beforeEach(async () => {
      await manager.initialize();
      
      // Register test containers
      const containers = [
        {
          id: 'container-1',
          name: 'test-container-1',
          image: 'ubuntu:latest',
          status: ContainerStatus.READY,
          labels: { 'self-hosted': 'true', 'linux': 'true' },
          resources: { cpu: 2, memory: '4Gi', disk: '20Gi' },
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
          utilization: { cpu: 0.1, memory: 0.2, disk: 0.1, network: 0.05 }
        },
        {
          id: 'container-2',
          name: 'test-container-2',
          image: 'node:18',
          status: ContainerStatus.READY,
          labels: { 'self-hosted': 'true', 'linux': 'true', 'node': 'true' },
          resources: { cpu: 4, memory: '8Gi', disk: '40Gi' },
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
          utilization: { cpu: 0.3, memory: 0.4, disk: 0.2, network: 0.1 }
        }
      ];

      for (const container of containers) {
        await manager.registerContainer(container);
      }
    });

    it('should assign container to job', async () => {
      const request = {
        jobId: 'job-1',
        labels: ['self-hosted', 'linux'],
        priority: 1
      };

      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().createAssignment.mockResolvedValue(undefined);

      const mockMetricsCollector = require('../../services/metrics-collector').MetricsCollector;
      mockMetricsCollector.getInstance().recordAssignment.mockResolvedValue(undefined);

      const container = await manager.assignContainer(request);

      expect(container).toBeTruthy();
      expect(container!.status).toBe(ContainerStatus.ASSIGNED);
      expect(container!.assignedJob).toBe('job-1');
    });

    it('should return null when no containers available', async () => {
      const request = {
        jobId: 'job-1',
        labels: ['windows'], // No containers with Windows label
        priority: 1
      };

      const container = await manager.assignContainer(request);

      expect(container).toBeNull();
    });

    it('should filter containers by labels', async () => {
      const request = {
        jobId: 'job-1',
        labels: ['node'], // Only container-2 has this label
        priority: 1
      };

      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().createAssignment.mockResolvedValue(undefined);

      const mockMetricsCollector = require('../../services/metrics-collector').MetricsCollector;
      mockMetricsCollector.getInstance().recordAssignment.mockResolvedValue(undefined);

      const container = await manager.assignContainer(request);

      expect(container).toBeTruthy();
      expect(container!.id).toBe('container-2');
    });

    it('should filter containers by image compatibility', async () => {
      const request = {
        jobId: 'job-1',
        labels: ['self-hosted', 'linux'],
        image: 'node:16', // Should match node:18 container
        priority: 1
      };

      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().createAssignment.mockResolvedValue(undefined);

      const mockMetricsCollector = require('../../services/metrics-collector').MetricsCollector;
      mockMetricsCollector.getInstance().recordAssignment.mockResolvedValue(undefined);

      const container = await manager.assignContainer(request);

      expect(container).toBeTruthy();
      expect(container!.id).toBe('container-2'); // node:18 container
    });

    it('should filter containers by resource requirements', async () => {
      const request = {
        jobId: 'job-1',
        labels: ['self-hosted', 'linux'],
        resources: {
          cpu: 3,
          memory: '6Gi'
        },
        priority: 1
      };

      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().createAssignment.mockResolvedValue(undefined);

      const mockMetricsCollector = require('../../services/metrics-collector').MetricsCollector;
      mockMetricsCollector.getInstance().recordAssignment.mockResolvedValue(undefined);

      const container = await manager.assignContainer(request);

      expect(container).toBeTruthy();
      expect(container!.id).toBe('container-2'); // Only container-2 has enough resources
    });
  });

  describe('load balancing strategies', () => {
    beforeEach(async () => {
      await manager.initialize();
      
      // Register containers with different loads
      const containers = [
        {
          id: 'container-1',
          name: 'low-load',
          image: 'ubuntu:latest',
          status: ContainerStatus.READY,
          labels: { 'self-hosted': 'true' },
          resources: { cpu: 2, memory: '4Gi', disk: '20Gi' },
          createdAt: new Date(),
          lastHealthCheck: new Date(),
          healthStatus: { healthy: true, lastCheck: new Date(), checks: {} as any },
          utilization: { cpu: 0.1, memory: 0.1, disk: 0.1, network: 0.1 }
        },
        {
          id: 'container-2',
          name: 'high-load',
          image: 'ubuntu:latest',
          status: ContainerStatus.READY,
          labels: { 'self-hosted': 'true' },
          resources: { cpu: 2, memory: '4Gi', disk: '20Gi' },
          createdAt: new Date(),
          lastHealthCheck: new Date(),
          healthStatus: { healthy: true, lastCheck: new Date(), checks: {} as any },
          utilization: { cpu: 0.8, memory: 0.7, disk: 0.6, network: 0.5 }
        }
      ];

      for (const container of containers) {
        await manager.registerContainer(container);
      }
    });

    it('should use round-robin strategy', async () => {
      const strategy: LoadBalancingStrategy = { type: 'round-robin' };
      manager.setLoadBalancingStrategy(strategy);

      const request1 = { jobId: 'job-1', labels: ['self-hosted'], priority: 1 };
      const request2 = { jobId: 'job-2', labels: ['self-hosted'], priority: 1 };

      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().createAssignment.mockResolvedValue(undefined);

      const mockMetricsCollector = require('../../services/metrics-collector').MetricsCollector;
      mockMetricsCollector.getInstance().recordAssignment.mockResolvedValue(undefined);

      const container1 = await manager.assignContainer(request1);
      
      // Release first container to make both available again
      await manager.releaseContainer('job-1');
      
      const container2 = await manager.assignContainer(request2);

      // Should alternate between containers
      expect(container1!.id).not.toBe(container2!.id);
    });

    it('should use least-loaded strategy', async () => {
      const strategy: LoadBalancingStrategy = { type: 'least-loaded' };
      manager.setLoadBalancingStrategy(strategy);

      const request = { jobId: 'job-1', labels: ['self-hosted'], priority: 1 };

      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().createAssignment.mockResolvedValue(undefined);

      const mockMetricsCollector = require('../../services/metrics-collector').MetricsCollector;
      mockMetricsCollector.getInstance().recordAssignment.mockResolvedValue(undefined);

      const container = await manager.assignContainer(request);

      // Should select the low-load container
      expect(container!.id).toBe('container-1');
    });

    it('should use resource-aware strategy', async () => {
      const strategy: LoadBalancingStrategy = { type: 'resource-aware' };
      manager.setLoadBalancingStrategy(strategy);

      const request = {
        jobId: 'job-1',
        labels: ['self-hosted'],
        priority: 1 // High priority
      };

      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().createAssignment.mockResolvedValue(undefined);

      const mockMetricsCollector = require('../../services/metrics-collector').MetricsCollector;
      mockMetricsCollector.getInstance().recordAssignment.mockResolvedValue(undefined);

      const container = await manager.assignContainer(request);

      expect(container).toBeTruthy();
      // Resource-aware strategy should consider multiple factors
    });
  });

  describe('container health management', () => {
    beforeEach(async () => {
      await manager.initialize();
      
      const container = {
        id: 'container-1',
        name: 'test-container',
        image: 'ubuntu:latest',
        status: ContainerStatus.READY,
        labels: { 'self-hosted': 'true' },
        resources: { cpu: 2, memory: '4Gi', disk: '20Gi' },
        createdAt: new Date(),
        lastHealthCheck: new Date(),
        healthStatus: { healthy: true, lastCheck: new Date(), checks: {} as any },
        utilization: { cpu: 0.1, memory: 0.2, disk: 0.1, network: 0.05 }
      };

      await manager.registerContainer(container);
    });

    it('should update container health status', async () => {
      const healthStatus = {
        healthy: false,
        lastCheck: new Date(),
        checks: {
          connectivity: false,
          diskSpace: true,
          memory: true,
          dockerDaemon: true
        },
        message: 'Connection timeout'
      };

      let unhealthyEvent: any = null;
      manager.on('container:unhealthy', (container) => {
        unhealthyEvent = container;
      });

      await manager.updateContainerHealth('container-1', healthStatus);

      const stats = manager.getStatistics();
      expect(stats.unhealthy).toBe(1);
      expect(unhealthyEvent).toBeTruthy();
    });

    it('should recover unhealthy container', async () => {
      // First mark container as unhealthy
      await manager.updateContainerHealth('container-1', {
        healthy: false,
        lastCheck: new Date(),
        checks: {} as any,
        message: 'Unhealthy'
      });

      // Then recover it
      let recoveredEvent: any = null;
      manager.on('container:recovered', (container) => {
        recoveredEvent = container;
      });

      await manager.updateContainerHealth('container-1', {
        healthy: true,
        lastCheck: new Date(),
        checks: {
          connectivity: true,
          diskSpace: true,
          memory: true,
          dockerDaemon: true
        }
      });

      const stats = manager.getStatistics();
      expect(stats.ready).toBe(1);
      expect(stats.unhealthy).toBe(0);
      expect(recoveredEvent).toBeTruthy();
    });

    it('should detect overloaded containers', async () => {
      let overloadedEvent: any = null;
      manager.on('container:overloaded', (container) => {
        overloadedEvent = container;
      });

      const highUtilization = {
        cpu: 0.95,
        memory: 0.92,
        disk: 0.5,
        network: 0.3
      };

      await manager.updateContainerUtilization('container-1', highUtilization);

      expect(overloadedEvent).toBeTruthy();
    });
  });

  describe('container release', () => {
    beforeEach(async () => {
      await manager.initialize();
      
      const container = {
        id: 'container-1',
        name: 'test-container',
        image: 'ubuntu:latest',
        status: ContainerStatus.ASSIGNED,
        labels: { 'self-hosted': 'true' },
        resources: { cpu: 2, memory: '4Gi', disk: '20Gi' },
        createdAt: new Date(),
        lastHealthCheck: new Date(),
        healthStatus: { healthy: true, lastCheck: new Date(), checks: {} as any },
        utilization: { cpu: 0.1, memory: 0.2, disk: 0.1, network: 0.05 },
        assignedJob: 'job-1'
      };

      await manager.registerContainer(container);
    });

    it('should release container from job', async () => {
      const mockDatabaseService = require('../../services/database-service').DatabaseService;
      mockDatabaseService.getInstance().completeAssignment.mockResolvedValue(undefined);

      let releasedEvent: any = null;
      manager.on('container:released', (event) => {
        releasedEvent = event;
      });

      await manager.releaseContainer('job-1');

      const stats = manager.getStatistics();
      expect(stats.ready).toBe(1);
      expect(stats.assigned).toBe(0);
      expect(releasedEvent).toBeTruthy();
    });

    it('should handle release of non-existent job', async () => {
      // Should not throw error
      await expect(manager.releaseContainer('non-existent-job')).resolves.not.toThrow();
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should calculate statistics correctly', async () => {
      const containers = [
        {
          id: 'container-1',
          status: ContainerStatus.READY,
          utilization: { cpu: 0.2, memory: 0.3, disk: 0.1, network: 0.05 }
        },
        {
          id: 'container-2',
          status: ContainerStatus.ASSIGNED,
          utilization: { cpu: 0.5, memory: 0.6, disk: 0.2, network: 0.1 }
        },
        {
          id: 'container-3',
          status: ContainerStatus.UNHEALTHY,
          utilization: { cpu: 0.1, memory: 0.1, disk: 0.1, network: 0.05 }
        }
      ];

      for (const containerData of containers) {
        const container = {
          id: containerData.id,
          name: `test-${containerData.id}`,
          image: 'ubuntu:latest',
          status: containerData.status,
          labels: {},
          resources: { cpu: 2, memory: '4Gi', disk: '20Gi' },
          createdAt: new Date(),
          lastHealthCheck: new Date(),
          healthStatus: { healthy: true, lastCheck: new Date(), checks: {} as any },
          utilization: containerData.utilization
        };

        await manager.registerContainer(container);
      }

      const stats = manager.getStatistics();

      expect(stats.total).toBe(3);
      expect(stats.ready).toBe(1);
      expect(stats.assigned).toBe(1);
      expect(stats.unhealthy).toBe(1);
      expect(stats.utilization.cpu).toBeCloseTo(0.27, 1); // Average of 0.2, 0.5, 0.1
    });
  });
});