import { ContainerLifecycleManager } from '../../src/services/container-lifecycle';
import Docker from 'dockerode';
import database from '../../src/services/database';
import { RunnerStatus } from '../../src/types';

// Mock dependencies
jest.mock('dockerode');
jest.mock('../../src/services/database');
jest.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

describe('ContainerLifecycleManager', () => {
  let containerLifecycle: ContainerLifecycleManager;
  let mockDocker: jest.Mocked<Docker>;
  let mockContainer: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Docker mock
    mockContainer = {
      id: 'test-container-123',
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      inspect: jest.fn().mockResolvedValue({
        State: {
          Running: true,
          ExitCode: 0,
          Status: 'running'
        }
      }),
      exec: jest.fn().mockResolvedValue({
        start: jest.fn().mockResolvedValue({
          on: jest.fn((event, callback) => {
            if (event === 'end') callback();
          })
        }),
        inspect: jest.fn().mockResolvedValue({ ExitCode: 0 })
      }),
      stats: jest.fn().mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 1000 },
          system_cpu_usage: 2000,
          online_cpus: 2
        },
        precpu_stats: {
          cpu_usage: { total_usage: 500 },
          system_cpu_usage: 1000
        },
        memory_stats: {
          usage: 1073741824,
          limit: 2147483648
        },
        networks: {
          eth0: { rx_bytes: 1024, tx_bytes: 512 }
        },
        blkio_stats: {
          io_service_bytes_recursive: [
            { op: 'Read', value: 2048 },
            { op: 'Write', value: 1024 }
          ]
        }
      })
    };

    mockDocker = {
      createContainer: jest.fn().mockResolvedValue(mockContainer),
      getContainer: jest.fn().mockReturnValue(mockContainer),
      listContainers: jest.fn().mockResolvedValue([]),
      ping: jest.fn().mockResolvedValue('OK')
    } as any;

    (Docker as jest.MockedClass<typeof Docker>).mockImplementation(() => mockDocker);

    // Get instance
    containerLifecycle = ContainerLifecycleManager.getInstance();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await containerLifecycle.initialize();

      expect(mockDocker.ping).toHaveBeenCalled();
      expect(mockDocker.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: { label: ['runnerhub.managed=true'] }
      });
    });

    it('should handle initialization failure', async () => {
      mockDocker.ping.mockRejectedValue(new Error('Docker not available'));

      await expect(containerLifecycle.initialize()).rejects.toThrow('Docker not available');
    });
  });

  describe('createContainer', () => {
    it('should create container with correct configuration', async () => {
      const runnerId = 'runner-123';
      const jobId = 'job-456';
      const containerConfig = {
        image: 'test-image:latest',
        name: 'test-container',
        env: { TEST: 'value' },
        labels: { test: 'label' },
        networks: ['test-network'],
        autoRemove: true
      };

      const containerId = await containerLifecycle.createContainer(
        runnerId,
        jobId,
        containerConfig,
        { cpuShares: 2048, memoryMB: 4096 }
      );

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Image: 'test-image:latest',
          name: expect.stringContaining('runner-'),
          Env: ['TEST=value'],
          Labels: expect.objectContaining({
            'runnerhub.runner.id': runnerId,
            'runnerhub.job.id': jobId,
            'runnerhub.managed': 'true'
          }),
          HostConfig: expect.objectContaining({
            AutoRemove: true,
            CpuShares: 2048,
            Memory: 4096 * 1024 * 1024
          })
        })
      );

      expect(containerId).toBe('test-container-123');
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE runnerhub.runners'),
        expect.arrayContaining([containerId, RunnerStatus.STARTING, runnerId])
      );
    });

    it('should handle container creation failure', async () => {
      mockDocker.createContainer.mockRejectedValue(new Error('Image not found'));

      await expect(
        containerLifecycle.createContainer('runner-1', 'job-1', {
          image: 'invalid:latest',
          name: 'test',
          env: {},
          labels: {},
          networks: []
        })
      ).rejects.toThrow('Image not found');
    });
  });

  describe('startContainer', () => {
    it('should start container successfully', async () => {
      // First create a container
      const containerId = await containerLifecycle.createContainer(
        'runner-123',
        'job-456',
        {
          image: 'test:latest',
          name: 'test',
          env: {},
          labels: {},
          networks: []
        }
      );

      await containerLifecycle.startContainer(containerId);

      expect(mockContainer.start).toHaveBeenCalled();
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE runnerhub.runners'),
        expect.arrayContaining([RunnerStatus.BUSY, 'runner-123'])
      );
    });

    it('should handle start failure', async () => {
      mockContainer.start.mockRejectedValue(new Error('Container already started'));

      await expect(
        containerLifecycle.startContainer('unknown-id')
      ).rejects.toThrow();
    });
  });

  describe('stopContainer', () => {
    it('should stop container with timeout', async () => {
      const containerId = await containerLifecycle.createContainer(
        'runner-123',
        'job-456',
        {
          image: 'test:latest',
          name: 'test',
          env: {},
          labels: {},
          networks: []
        }
      );

      await containerLifecycle.stopContainer(containerId, 60);

      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 60 });
      expect(mockContainer.inspect).toHaveBeenCalled();
    });

    it('should handle already stopped container', async () => {
      const error: any = new Error('Container already stopped');
      error.statusCode = 304;
      mockContainer.stop.mockRejectedValue(error);

      // Should not throw
      await expect(
        containerLifecycle.stopContainer('test-id')
      ).resolves.toBeUndefined();
    });
  });

  describe('getContainerStats', () => {
    it('should calculate resource usage correctly', async () => {
      const stats = await containerLifecycle.getContainerStats('test-id');

      expect(stats).toMatchObject({
        cpuPercent: expect.any(Number),
        memoryUsage: 1073741824,
        memoryLimit: 2147483648,
        networkRx: 1024,
        networkTx: 512,
        blockRead: 2048,
        blockWrite: 1024
      });

      expect(mockContainer.stats).toHaveBeenCalledWith({ stream: false });
    });
  });

  describe('executeCommand', () => {
    it('should execute command in container', async () => {
      const result = await containerLifecycle.executeCommand(
        'test-id',
        ['echo', 'hello'],
        { user: 'root' }
      );

      expect(result).toEqual({ exitCode: 0, output: '' });
      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['echo', 'hello'],
        AttachStdout: true,
        AttachStderr: true,
        User: 'root'
      });
    });
  });

  describe('container tracking', () => {
    it('should track containers by runner ID', async () => {
      const runnerId = 'runner-789';
      const containerId = await containerLifecycle.createContainer(
        runnerId,
        'job-123',
        {
          image: 'test:latest',
          name: 'test',
          env: {},
          labels: {},
          networks: []
        }
      );

      const container = containerLifecycle.getContainerByRunnerId(runnerId);

      expect(container).toBeDefined();
      expect(container?.id).toBe(containerId);
      expect(container?.runnerId).toBe(runnerId);
    });

    it('should track containers by job ID', async () => {
      const jobId = 'job-999';
      await containerLifecycle.createContainer(
        'runner-111',
        jobId,
        {
          image: 'test:latest',
          name: 'test',
          env: {},
          labels: {},
          networks: []
        }
      );

      const container = containerLifecycle.getContainerByJobId(jobId);

      expect(container).toBeDefined();
      expect(container?.jobId).toBe(jobId);
    });

    it('should return all containers', async () => {
      await containerLifecycle.createContainer(
        'runner-1',
        'job-1',
        {
          image: 'test:latest',
          name: 'test1',
          env: {},
          labels: {},
          networks: []
        }
      );

      await containerLifecycle.createContainer(
        'runner-2',
        'job-2',
        {
          image: 'test:latest',
          name: 'test2',
          env: {},
          labels: {},
          networks: []
        }
      );

      const containers = containerLifecycle.getAllContainers();

      expect(containers).toHaveLength(2);
      expect(containers[0].runnerId).toBe('runner-1');
      expect(containers[1].runnerId).toBe('runner-2');
    });
  });
});