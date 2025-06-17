const RunnerLifecycleManager = require('../runner-lifecycle');
const Docker = require('dockerode');
const { Octokit } = require('@octokit/rest');
const EventEmitter = require('events');

jest.mock('dockerode');
jest.mock('@octokit/rest');

describe('RunnerLifecycleManager', () => {
  let lifecycleManager;
  let mockDocker;
  let mockOctokit;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfig = {
      GITHUB_TOKEN: 'test-token',
      GITHUB_ORG: 'test-org',
      GITHUB_REPO: 'test-repo'
    };

    // Mock Docker
    mockDocker = {
      getContainer: jest.fn(),
      listContainers: jest.fn().mockResolvedValue([])
    };
    Docker.mockImplementation(() => mockDocker);

    // Mock Octokit
    mockOctokit = {
      rest: {
        actions: {
          listSelfHostedRunnersForRepo: jest.fn(),
          deleteSelfHostedRunnerFromRepo: jest.fn(),
          createRegistrationTokenForRepo: jest.fn()
        }
      }
    };
    Octokit.mockImplementation(() => mockOctokit);

    lifecycleManager = new RunnerLifecycleManager(mockConfig);
  });

  afterEach(() => {
    if (lifecycleManager.healthCheckInterval) {
      clearInterval(lifecycleManager.healthCheckInterval);
    }
    if (lifecycleManager.stateCheckInterval) {
      clearInterval(lifecycleManager.stateCheckInterval);
    }
  });

  describe('Constructor', () => {
    test('should initialize as EventEmitter', () => {
      expect(lifecycleManager).toBeInstanceOf(EventEmitter);
    });

    test('should set correct default intervals', () => {
      expect(lifecycleManager.healthCheckInterval).toBe(30000);
      expect(lifecycleManager.stateCheckInterval).toBe(60000);
    });
  });

  describe('registerRunner', () => {
    test('should register runner with correct properties', () => {
      const runnerInfo = {
        containerId: 'container-123',
        name: 'test-runner',
        githubId: 123
      };

      lifecycleManager.registerRunner('runner-1', runnerInfo);

      const registered = lifecycleManager.getRunnerStatus('runner-1');
      expect(registered).toBeDefined();
      expect(registered.health).toBe('healthy');
      expect(registered.startTime).toBeDefined();
      expect(registered.metrics).toBeDefined();
    });
  });

  describe('checkRunnersHealth', () => {
    test('should mark runner as unhealthy when container is not running', async () => {
      const mockContainer = {
        stats: jest.fn().mockResolvedValue({
          cpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 10000, online_cpus: 2 },
          precpu_stats: { cpu_usage: { total_usage: 500 }, system_cpu_usage: 5000 },
          memory_stats: { usage: 100, limit: 1000 }
        }),
        inspect: jest.fn().mockResolvedValue({
          State: { Running: false }
        })
      };

      mockDocker.getContainer.mockReturnValue(mockContainer);

      lifecycleManager.registerRunner('runner-1', {
        containerId: 'container-123',
        name: 'test-runner'
      });

      const emitSpy = jest.spyOn(lifecycleManager, 'emit');
      await lifecycleManager.checkRunnersHealth();

      expect(emitSpy).toHaveBeenCalledWith('runner:unhealthy', {
        runnerId: 'runner-1',
        reason: 'Container stopped'
      });

      const status = lifecycleManager.getRunnerStatus('runner-1');
      expect(status.health).toBe('unhealthy');
    });

    test('should emit high resource usage warnings', async () => {
      const mockContainer = {
        stats: jest.fn().mockResolvedValue({
          cpu_stats: { 
            cpu_usage: { total_usage: 95000 }, 
            system_cpu_usage: 100000,
            online_cpus: 1
          },
          precpu_stats: { 
            cpu_usage: { total_usage: 0 }, 
            system_cpu_usage: 0 
          },
          memory_stats: { usage: 950, limit: 1000 }
        }),
        inspect: jest.fn().mockResolvedValue({
          State: { Running: true }
        })
      };

      mockDocker.getContainer.mockReturnValue(mockContainer);

      lifecycleManager.registerRunner('runner-1', {
        containerId: 'container-123',
        name: 'test-runner'
      });

      const emitSpy = jest.spyOn(lifecycleManager, 'emit');
      await lifecycleManager.checkRunnersHealth();

      expect(emitSpy).toHaveBeenCalledWith('runner:high-cpu', 
        expect.objectContaining({ runnerId: 'runner-1' })
      );
      expect(emitSpy).toHaveBeenCalledWith('runner:high-memory', 
        expect.objectContaining({ runnerId: 'runner-1' })
      );
    });
  });

  describe('syncRunnerStates', () => {
    test('should clean up runners not found in GitHub', async () => {
      mockOctokit.rest.actions.listSelfHostedRunnersForRepo.mockResolvedValue({
        data: { runners: [] }
      });

      lifecycleManager.registerRunner('runner-1', {
        containerId: 'container-123',
        name: 'test-runner'
      });

      const cleanupSpy = jest.spyOn(lifecycleManager, 'cleanupRunner');
      await lifecycleManager.syncRunnerStates();

      expect(cleanupSpy).toHaveBeenCalledWith('runner-1');
    });

    test('should handle offline runners', async () => {
      const mockGitHubRunner = {
        id: 123,
        name: 'test-runner',
        status: 'offline',
        busy: false
      };

      mockOctokit.rest.actions.listSelfHostedRunnersForRepo.mockResolvedValue({
        data: { runners: [mockGitHubRunner] }
      });

      lifecycleManager.registerRunner('runner-1', {
        containerId: 'container-123',
        name: 'test-runner',
        health: 'healthy'
      });

      const handleOfflineSpy = jest.spyOn(lifecycleManager, 'handleOfflineRunner');
      await lifecycleManager.syncRunnerStates();

      expect(handleOfflineSpy).toHaveBeenCalled();
    });

    test('should remove orphaned GitHub runners', async () => {
      const orphanedRunner = {
        id: 999,
        name: 'github-runner-orphaned',
        status: 'offline'
      };

      mockOctokit.rest.actions.listSelfHostedRunnersForRepo.mockResolvedValue({
        data: { runners: [orphanedRunner] }
      });

      await lifecycleManager.syncRunnerStates();

      expect(mockOctokit.rest.actions.deleteSelfHostedRunnerFromRepo)
        .toHaveBeenCalledWith({
          owner: 'test-org',
          repo: 'test-repo',
          runner_id: 999
        });
    });
  });

  describe('handleOfflineRunner', () => {
    test('should re-register runner when token expired', async () => {
      const mockContainer = {
        logs: jest.fn().mockResolvedValue(
          Buffer.from('Runner registration failed\nHttp response code: Unauthorized')
        ),
        stop: jest.fn().mockResolvedValue(),
        remove: jest.fn().mockResolvedValue()
      };

      mockDocker.getContainer.mockReturnValue(mockContainer);
      mockDocker.createContainer = jest.fn().mockResolvedValue({
        id: 'new-container-123',
        start: jest.fn().mockResolvedValue()
      });

      mockOctokit.rest.actions.createRegistrationTokenForRepo.mockResolvedValue({
        data: { token: 'new-token' }
      });

      const runnerInfo = {
        containerId: 'old-container',
        name: 'test-runner',
        labels: [{ name: 'self-hosted' }]
      };

      const emitSpy = jest.spyOn(lifecycleManager, 'emit');
      await lifecycleManager.handleOfflineRunner('runner-1', runnerInfo);

      expect(mockContainer.stop).toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalled();
      expect(mockDocker.createContainer).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith('runner:reregistered', 
        expect.objectContaining({ runnerId: 'runner-1' })
      );
    });

    test('should restart container when process crashed', async () => {
      const mockContainer = {
        logs: jest.fn().mockResolvedValue(
          Buffer.from('Runner listener exited with error code 1')
        ),
        restart: jest.fn().mockResolvedValue()
      };

      mockDocker.getContainer.mockReturnValue(mockContainer);

      const runnerInfo = {
        containerId: 'container-123',
        name: 'test-runner'
      };

      const emitSpy = jest.spyOn(lifecycleManager, 'emit');
      await lifecycleManager.handleOfflineRunner('runner-1', runnerInfo);

      expect(mockContainer.restart).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith('runner:restarted', 
        expect.objectContaining({ reason: 'Process crashed' })
      );
    });
  });

  describe('cleanupRunner', () => {
    test('should stop container and remove from GitHub', async () => {
      const mockContainer = {
        stop: jest.fn().mockResolvedValue(),
        remove: jest.fn().mockResolvedValue()
      };

      mockDocker.getContainer.mockReturnValue(mockContainer);

      lifecycleManager.registerRunner('runner-1', {
        containerId: 'container-123',
        name: 'test-runner',
        githubId: 123
      });

      const emitSpy = jest.spyOn(lifecycleManager, 'emit');
      await lifecycleManager.cleanupRunner('runner-1');

      expect(mockContainer.stop).toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalled();
      expect(mockOctokit.rest.actions.deleteSelfHostedRunnerFromRepo)
        .toHaveBeenCalledWith({
          owner: 'test-org',
          repo: 'test-repo',
          runner_id: 123
        });
      expect(emitSpy).toHaveBeenCalledWith('runner:removed', 
        expect.objectContaining({ name: 'test-runner' })
      );
      expect(lifecycleManager.getRunnerStatus('runner-1')).toBeUndefined();
    });
  });

  describe('cleanupOrphanedContainers', () => {
    test('should remove containers not in tracking', async () => {
      const orphanedContainer = {
        Id: 'orphaned-123',
        Names: ['/github-runner-orphaned']
      };

      const mockContainer = {
        inspect: jest.fn().mockResolvedValue({
          Name: '/github-runner-orphaned',
          State: { Running: true }
        }),
        stop: jest.fn().mockResolvedValue(),
        remove: jest.fn().mockResolvedValue()
      };

      mockDocker.listContainers.mockResolvedValue([orphanedContainer]);
      mockDocker.getContainer.mockReturnValue(mockContainer);

      await lifecycleManager.cleanupOrphanedContainers();

      expect(mockContainer.stop).toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalled();
    });
  });

  describe('CPU and Memory calculations', () => {
    test('should calculate CPU usage correctly', () => {
      const stats = {
        cpu_stats: {
          cpu_usage: { total_usage: 2000 },
          system_cpu_usage: 20000,
          online_cpus: 2
        },
        precpu_stats: {
          cpu_usage: { total_usage: 1000 },
          system_cpu_usage: 10000
        }
      };

      const cpuUsage = lifecycleManager.calculateCPUUsage(stats);
      expect(cpuUsage).toBe(20); // ((2000-1000)/(20000-10000)) * 2 * 100 = 20%
    });

    test('should calculate memory usage correctly', () => {
      const stats = {
        memory_stats: {
          usage: 500,
          limit: 1000
        }
      };

      const memoryUsage = lifecycleManager.calculateMemoryUsage(stats);
      expect(memoryUsage).toBe(50); // (500/1000) * 100 = 50%
    });
  });

  describe('getAllRunners', () => {
    test('should return all registered runners with IDs', () => {
      lifecycleManager.registerRunner('runner-1', { name: 'test-1' });
      lifecycleManager.registerRunner('runner-2', { name: 'test-2' });

      const allRunners = lifecycleManager.getAllRunners();

      expect(allRunners).toHaveLength(2);
      expect(allRunners[0]).toHaveProperty('id', 'runner-1');
      expect(allRunners[1]).toHaveProperty('id', 'runner-2');
    });
  });
});