const AutoScaler = require('../auto-scaler');
const Docker = require('dockerode');
const { Octokit } = require('@octokit/rest');

// Mock dependencies
jest.mock('dockerode');
jest.mock('@octokit/rest');
jest.mock('../runner-lifecycle');

describe('AutoScaler', () => {
  let autoScaler;
  let mockDocker;
  let mockOctokit;
  let mockConfig;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Setup mock config
    mockConfig = {
      GITHUB_TOKEN: 'test-token',
      GITHUB_ORG: 'test-org',
      GITHUB_REPO: 'test-repo',
      MIN_RUNNERS: 5,
      MAX_RUNNERS: 50,
      SCALE_THRESHOLD: 0.8,
      SCALE_INCREMENT: 5,
      COOLDOWN_PERIOD: 300,
      IDLE_TIMEOUT: 1800,
      RUNNER_IMAGE: 'test-image:latest'
    };

    // Setup Docker mock
    mockDocker = {
      createContainer: jest.fn(),
      listContainers: jest.fn().mockResolvedValue([]),
      getContainer: jest.fn()
    };
    Docker.mockImplementation(() => mockDocker);

    // Setup Octokit mock
    mockOctokit = {
      rest: {
        actions: {
          listSelfHostedRunnersForRepo: jest.fn(),
          createRegistrationTokenForRepo: jest.fn(),
          deleteSelfHostedRunnerFromRepo: jest.fn()
        }
      }
    };
    Octokit.mockImplementation(() => mockOctokit);

    // Create AutoScaler instance
    autoScaler = new AutoScaler(mockConfig);
  });

  afterEach(() => {
    // Clear any intervals
    if (autoScaler.monitorInterval) clearInterval(autoScaler.monitorInterval);
    if (autoScaler.cleanupInterval) clearInterval(autoScaler.cleanupInterval);
  });

  describe('Constructor', () => {
    test('should initialize with correct configuration', () => {
      expect(autoScaler.config.minRunners).toBe(5);
      expect(autoScaler.config.maxRunners).toBe(50);
      expect(autoScaler.config.scaleThreshold).toBe(0.8);
      expect(autoScaler.config.scaleIncrement).toBe(5);
    });

    test('should use default values when not provided', () => {
      const minimalConfig = {
        GITHUB_TOKEN: 'token',
        GITHUB_ORG: 'org',
        GITHUB_REPO: 'repo'
      };
      const scaler = new AutoScaler(minimalConfig);
      
      expect(scaler.config.minRunners).toBe(5);
      expect(scaler.config.maxRunners).toBe(50);
      expect(scaler.config.scaleThreshold).toBe(0.8);
    });
  });

  describe('getRunnerMetrics', () => {
    test('should return correct metrics for online runners', async () => {
      const mockRunners = {
        runners: [
          { id: 1, name: 'runner-1', status: 'online', busy: true },
          { id: 2, name: 'runner-2', status: 'online', busy: false },
          { id: 3, name: 'runner-3', status: 'online', busy: true },
          { id: 4, name: 'runner-4', status: 'offline', busy: false }
        ]
      };

      mockOctokit.rest.actions.listSelfHostedRunnersForRepo.mockResolvedValue({
        data: mockRunners
      });

      const metrics = await autoScaler.getRunnerMetrics();

      expect(metrics.totalRunners).toBe(3); // Only online runners
      expect(metrics.busyRunners).toBe(2);
      expect(metrics.idleRunners).toBe(1);
      expect(metrics.utilization).toBeCloseTo(0.667, 2);
    });

    test('should handle API errors gracefully', async () => {
      mockOctokit.rest.actions.listSelfHostedRunnersForRepo.mockRejectedValue(
        new Error('API Error')
      );

      const metrics = await autoScaler.getRunnerMetrics();

      expect(metrics.totalRunners).toBe(0);
      expect(metrics.busyRunners).toBe(0);
      expect(metrics.utilization).toBe(0);
    });
  });

  describe('canScale', () => {
    test('should allow scaling after cooldown period', () => {
      autoScaler.lastScaleTime = Date.now() - 301000; // 301 seconds ago
      expect(autoScaler.canScale()).toBe(true);
    });

    test('should prevent scaling during cooldown period', () => {
      autoScaler.lastScaleTime = Date.now() - 100000; // 100 seconds ago
      expect(autoScaler.canScale()).toBe(false);
    });
  });

  describe('scaleUp', () => {
    beforeEach(() => {
      autoScaler.lastScaleTime = 0; // Allow scaling
      mockOctokit.rest.actions.createRegistrationTokenForRepo.mockResolvedValue({
        data: { token: 'test-registration-token' }
      });
    });

    test('should scale up when utilization exceeds threshold', async () => {
      // Mock current metrics
      const getMetricsSpy = jest.spyOn(autoScaler, 'getRunnerMetrics');
      getMetricsSpy.mockResolvedValue({
        totalRunners: 10,
        busyRunners: 9,
        idleRunners: 1,
        utilization: 0.9,
        runners: []
      });

      // Mock container creation
      const mockContainer = {
        id: 'container-123',
        start: jest.fn().mockResolvedValue()
      };
      mockDocker.createContainer.mockResolvedValue(mockContainer);

      // Mock spawn runner
      const spawnSpy = jest.spyOn(autoScaler, 'spawnRunner');

      await autoScaler.scaleUp();

      expect(spawnSpy).toHaveBeenCalledTimes(5); // SCALE_INCREMENT
      expect(autoScaler.lastScaleTime).toBeGreaterThan(0);
    });

    test('should respect maximum runners limit', async () => {
      const getMetricsSpy = jest.spyOn(autoScaler, 'getRunnerMetrics');
      getMetricsSpy.mockResolvedValue({
        totalRunners: 48,
        busyRunners: 40,
        idleRunners: 8,
        utilization: 0.83,
        runners: []
      });

      const spawnSpy = jest.spyOn(autoScaler, 'spawnRunner');
      spawnSpy.mockResolvedValue('runner-name');

      await autoScaler.scaleUp();

      // Should only spawn 2 runners to reach max of 50
      expect(spawnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('scaleDown', () => {
    test('should remove idle runners when utilization is low', async () => {
      const mockRunners = [
        { id: 1, name: 'runner-1', status: 'online', busy: false },
        { id: 2, name: 'runner-2', status: 'online', busy: false },
        { id: 3, name: 'runner-3', status: 'online', busy: true },
        { id: 4, name: 'runner-4', status: 'online', busy: false },
        { id: 5, name: 'runner-5', status: 'online', busy: false },
        { id: 6, name: 'runner-6', status: 'online', busy: false },
      ];

      const getMetricsSpy = jest.spyOn(autoScaler, 'getRunnerMetrics');
      getMetricsSpy.mockResolvedValue({
        totalRunners: 6,
        busyRunners: 1,
        idleRunners: 5,
        utilization: 0.167,
        runners: mockRunners
      });

      const removeSpy = jest.spyOn(autoScaler, 'removeRunner');
      removeSpy.mockResolvedValue();

      await autoScaler.scaleDown();

      // Should remove only 1 runner (6 - 5 = 1 to maintain minimum)
      expect(removeSpy).toHaveBeenCalledTimes(1);
    });

    test('should not scale down below minimum runners', async () => {
      const getMetricsSpy = jest.spyOn(autoScaler, 'getRunnerMetrics');
      getMetricsSpy.mockResolvedValue({
        totalRunners: 5, // Already at minimum
        busyRunners: 0,
        idleRunners: 5,
        utilization: 0,
        runners: []
      });

      const removeSpy = jest.spyOn(autoScaler, 'removeRunner');

      await autoScaler.scaleDown();

      expect(removeSpy).not.toHaveBeenCalled();
    });
  });

  describe('spawnRunner', () => {
    test('should create and register a new runner', async () => {
      mockOctokit.rest.actions.createRegistrationTokenForRepo.mockResolvedValue({
        data: { token: 'registration-token' }
      });

      const mockContainer = {
        id: 'container-123',
        start: jest.fn().mockResolvedValue()
      };
      mockDocker.createContainer.mockResolvedValue(mockContainer);

      const runnerName = await autoScaler.spawnRunner();

      expect(runnerName).toMatch(/^github-runner-\d+-\w+$/);
      expect(mockDocker.createContainer).toHaveBeenCalledWith({
        Image: 'test-image:latest',
        name: runnerName,
        Env: expect.arrayContaining([
          'ACCESS_TOKEN=registration-token',
          `RUNNER_NAME=${runnerName}`,
          'EPHEMERAL=true'
        ]),
        HostConfig: expect.objectContaining({
          AutoRemove: true,
          RestartPolicy: { Name: 'unless-stopped' }
        })
      });

      expect(mockContainer.start).toHaveBeenCalled();
      expect(autoScaler.runnerPool.has(runnerName)).toBe(true);
    });

    test('should handle container creation errors', async () => {
      mockOctokit.rest.actions.createRegistrationTokenForRepo.mockResolvedValue({
        data: { token: 'token' }
      });

      mockDocker.createContainer.mockRejectedValue(new Error('Docker error'));

      await expect(autoScaler.spawnRunner()).rejects.toThrow('Docker error');
    });
  });

  describe('ensureMinimumRunners', () => {
    test('should spawn runners to meet minimum requirement', async () => {
      const getMetricsSpy = jest.spyOn(autoScaler, 'getRunnerMetrics');
      getMetricsSpy.mockResolvedValue({
        totalRunners: 2,
        busyRunners: 0,
        idleRunners: 2,
        utilization: 0,
        runners: []
      });

      const spawnSpy = jest.spyOn(autoScaler, 'spawnRunner');
      spawnSpy.mockResolvedValue('runner-name');

      await autoScaler.ensureMinimumRunners();

      expect(spawnSpy).toHaveBeenCalledTimes(3); // 5 - 2 = 3
    });
  });

  describe('monitorAndScale', () => {
    test('should scale up when threshold is exceeded', async () => {
      autoScaler.scalingInProgress = false;
      autoScaler.lastScaleTime = 0;

      const getMetricsSpy = jest.spyOn(autoScaler, 'getRunnerMetrics');
      getMetricsSpy.mockResolvedValue({
        totalRunners: 10,
        busyRunners: 9,
        idleRunners: 1,
        utilization: 0.9,
        runners: []
      });

      const scaleUpSpy = jest.spyOn(autoScaler, 'scaleUp');
      scaleUpSpy.mockResolvedValue();

      await autoScaler.monitorAndScale();

      expect(scaleUpSpy).toHaveBeenCalled();
    });

    test('should scale down when utilization is low', async () => {
      autoScaler.scalingInProgress = false;

      const getMetricsSpy = jest.spyOn(autoScaler, 'getRunnerMetrics');
      getMetricsSpy.mockResolvedValue({
        totalRunners: 10,
        busyRunners: 1,
        idleRunners: 9,
        utilization: 0.1,
        runners: []
      });

      const scaleDownSpy = jest.spyOn(autoScaler, 'scaleDown');
      scaleDownSpy.mockResolvedValue();

      await autoScaler.monitorAndScale();

      expect(scaleDownSpy).toHaveBeenCalled();
    });

    test('should skip when scaling is in progress', async () => {
      autoScaler.scalingInProgress = true;

      const getMetricsSpy = jest.spyOn(autoScaler, 'getRunnerMetrics');
      await autoScaler.monitorAndScale();

      expect(getMetricsSpy).not.toHaveBeenCalled();
    });
  });

  describe('Lifecycle integration', () => {
    test('should handle unhealthy runner events', async () => {
      const getMetricsSpy = jest.spyOn(autoScaler, 'getRunnerMetrics');
      getMetricsSpy.mockResolvedValue({
        totalRunners: 5,
        busyRunners: 2,
        idleRunners: 3,
        utilization: 0.4,
        runners: []
      });

      const spawnSpy = jest.spyOn(autoScaler, 'spawnRunner');
      spawnSpy.mockResolvedValue('new-runner');

      await autoScaler.handleUnhealthyRunner({ runnerId: 'runner-1' });

      // Should not spawn because we're at minimum
      expect(spawnSpy).not.toHaveBeenCalled();

      // Test when below minimum
      getMetricsSpy.mockResolvedValue({
        totalRunners: 4,
        busyRunners: 2,
        idleRunners: 2,
        utilization: 0.5,
        runners: []
      });

      await autoScaler.handleUnhealthyRunner({ runnerId: 'runner-2' });

      expect(spawnSpy).toHaveBeenCalled();
    });

    test('should handle runner removed events', async () => {
      autoScaler.runnerPool.set('runner-1', { container: {} });

      const getMetricsSpy = jest.spyOn(autoScaler, 'getRunnerMetrics');
      getMetricsSpy.mockResolvedValue({
        totalRunners: 4,
        busyRunners: 1,
        idleRunners: 3,
        utilization: 0.25,
        runners: []
      });

      const spawnSpy = jest.spyOn(autoScaler, 'spawnRunner');
      spawnSpy.mockResolvedValue('new-runner');

      await autoScaler.handleRunnerRemoved({ name: 'runner-1' });

      expect(autoScaler.runnerPool.has('runner-1')).toBe(false);
      expect(spawnSpy).toHaveBeenCalled();
    });
  });
});