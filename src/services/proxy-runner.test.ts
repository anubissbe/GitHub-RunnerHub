import { ProxyRunner, ProxyRunnerConfig, ProxyRunnerManager } from './proxy-runner';
import { RunnerStatus } from '../types';

describe('ProxyRunner', () => {
  let proxyRunner: ProxyRunner;
  let config: ProxyRunnerConfig;

  beforeEach(() => {
    config = {
      name: 'test-runner',
      url: 'https://github.com/test/repo',
      token: 'test-token',
      labels: ['self-hosted', 'test'],
      orchestratorUrl: 'http://localhost:3000',
      runnerPath: '/tmp/test-runner',
      hooksPath: '/tmp/test-runner/hooks'
    };
    proxyRunner = new ProxyRunner(config);
  });

  describe('getStatus', () => {
    it('should return OFFLINE when not running', () => {
      expect(proxyRunner.getStatus()).toBe(RunnerStatus.OFFLINE);
    });
  });

  describe('configuration', () => {
    it('should store configuration correctly', () => {
      expect(proxyRunner).toBeDefined();
      // Private property access for testing
      expect((proxyRunner as any).config).toEqual(config);
    });
  });
});

describe('ProxyRunnerManager', () => {
  let manager: ProxyRunnerManager;

  beforeEach(() => {
    manager = new ProxyRunnerManager();
  });

  describe('createRunner', () => {
    it('should reject duplicate runner names', async () => {
      const config: ProxyRunnerConfig = {
        name: 'duplicate-runner',
        url: 'https://github.com/test/repo',
        token: 'test-token',
        labels: ['self-hosted'],
        orchestratorUrl: 'http://localhost:3000',
        runnerPath: '/tmp/runner',
        hooksPath: '/tmp/runner/hooks'
      };

      // Mock the runner lifecycle methods
      jest.spyOn(ProxyRunner.prototype, 'configure').mockResolvedValue();
      jest.spyOn(ProxyRunner.prototype, 'start').mockResolvedValue();

      await manager.createRunner(config);

      await expect(manager.createRunner(config)).rejects.toThrow(
        'Runner duplicate-runner already exists'
      );
    });
  });

  describe('getRunners', () => {
    it('should return empty map initially', () => {
      const runners = manager.getRunners();
      expect(runners.size).toBe(0);
    });
  });

  describe('removeRunner', () => {
    it('should throw error for non-existent runner', async () => {
      await expect(manager.removeRunner('non-existent')).rejects.toThrow(
        'Runner non-existent not found'
      );
    });
  });
});