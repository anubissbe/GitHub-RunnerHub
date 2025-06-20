import { RunnerPoolManager } from './runner-pool-manager';
import database from './database';
import { RunnerStatus, RunnerType } from '../types';

// Mock dependencies
jest.mock('./database');
jest.mock('./github-api');
jest.mock('./container-orchestrator');
jest.mock('./proxy-runner');

describe('RunnerPoolManager', () => {
  let manager: RunnerPoolManager;

  beforeEach(() => {
    manager = RunnerPoolManager.getInstance();
    jest.clearAllMocks();
  });

  describe('getPoolMetrics', () => {
    it('should calculate metrics correctly', async () => {
      const mockRunners = [
        { id: '1', status: RunnerStatus.BUSY },
        { id: '2', status: RunnerStatus.BUSY },
        { id: '3', status: RunnerStatus.IDLE },
        { id: '4', status: RunnerStatus.IDLE },
        { id: '5', status: RunnerStatus.OFFLINE }
      ];

      (database.query as jest.Mock).mockResolvedValue(mockRunners);

      const metrics = await manager.getPoolMetrics('test/repo');

      expect(metrics).toEqual({
        totalRunners: 5,
        activeRunners: 2,
        idleRunners: 2,
        utilization: 0.4
      });
    });

    it('should handle empty runner list', async () => {
      (database.query as jest.Mock).mockResolvedValue([]);

      const metrics = await manager.getPoolMetrics('test/repo');

      expect(metrics).toEqual({
        totalRunners: 0,
        activeRunners: 0,
        idleRunners: 0,
        utilization: 0
      });
    });
  });

  describe('checkScaling', () => {
    beforeEach(() => {
      // Mock getOrCreatePool
      (database.query as jest.Mock).mockImplementation((query) => {
        if (query.includes('runner_pools')) {
          return [{
            repository: 'test/repo',
            minRunners: 1,
            maxRunners: 10,
            scaleIncrement: 5,
            scaleThreshold: 0.8
          }];
        }
        return [];
      });
    });

    it('should recommend scaling when utilization exceeds threshold', async () => {
      // Mock high utilization
      jest.spyOn(manager, 'getPoolMetrics').mockResolvedValue({
        totalRunners: 5,
        activeRunners: 5,
        idleRunners: 0,
        utilization: 1.0
      });

      const decision = await manager.checkScaling('test/repo');

      expect(decision.shouldScale).toBe(true);
      expect(decision.runnersToAdd).toBe(5);
      expect(decision.reason).toContain('100% exceeds threshold 80%');
    });

    it('should not scale when at max capacity', async () => {
      // Mock at max capacity
      jest.spyOn(manager, 'getPoolMetrics').mockResolvedValue({
        totalRunners: 10,
        activeRunners: 10,
        idleRunners: 0,
        utilization: 1.0
      });

      const decision = await manager.checkScaling('test/repo');

      expect(decision.shouldScale).toBe(false);
      expect(decision.reason).toBe('Already at maximum capacity');
    });

    it('should not scale when utilization is below threshold', async () => {
      // Mock low utilization
      jest.spyOn(manager, 'getPoolMetrics').mockResolvedValue({
        totalRunners: 5,
        activeRunners: 3,
        idleRunners: 2,
        utilization: 0.6
      });

      const decision = await manager.checkScaling('test/repo');

      expect(decision.shouldScale).toBe(false);
      expect(decision.reason).toBe('Utilization within acceptable range');
    });
  });

  describe('scaleDown', () => {
    it('should remove idle runners above minimum', async () => {
      // Mock pool config
      (database.query as jest.Mock).mockImplementation((query) => {
        if (query.includes('runner_pools')) {
          return [{
            repository: 'test/repo',
            minRunners: 2,
            maxRunners: 10
          }];
        }
        if (query.includes('SELECT * FROM runnerhub.runners')) {
          return [
            { id: 'idle-1', status: RunnerStatus.IDLE, type: RunnerType.EPHEMERAL },
            { id: 'idle-2', status: RunnerStatus.IDLE, type: RunnerType.EPHEMERAL }
          ];
        }
        return [];
      });

      // Mock metrics showing we have runners above minimum
      jest.spyOn(manager, 'getPoolMetrics').mockResolvedValue({
        totalRunners: 5,
        activeRunners: 1,
        idleRunners: 4,
        utilization: 0.2
      });

      const removed = await manager.scaleDown('test/repo');

      expect(removed).toBeGreaterThan(0);
    });

    it('should not scale below minimum runners', async () => {
      // Mock pool config
      (database.query as jest.Mock).mockImplementation((query) => {
        if (query.includes('runner_pools')) {
          return [{
            repository: 'test/repo',
            minRunners: 2,
            maxRunners: 10
          }];
        }
        return [];
      });

      // Mock metrics showing we're at minimum
      jest.spyOn(manager, 'getPoolMetrics').mockResolvedValue({
        totalRunners: 2,
        activeRunners: 0,
        idleRunners: 2,
        utilization: 0
      });

      const removed = await manager.scaleDown('test/repo');

      expect(removed).toBe(0);
    });
  });

  describe('updatePool', () => {
    it('should update pool configuration', async () => {
      const updates = {
        minRunners: 3,
        maxRunners: 15,
        scaleThreshold: 0.9
      };

      (database.query as jest.Mock).mockResolvedValue([{
        repository: 'test/repo',
        ...updates
      }]);

      const result = await manager.updatePool('test/repo', updates);

      expect(result.minRunners).toBe(3);
      expect(result.maxRunners).toBe(15);
      expect(result.scaleThreshold).toBe(0.9);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE'),
        expect.arrayContaining(['test/repo', 3, 15, 0.9])
      );
    });
  });
});