import { ContainerCleanupService } from '../../src/services/container-cleanup';
import database from '../../src/services/database';
import containerLifecycle from '../../src/services/container-lifecycle';
import monitoringService from '../../src/services/monitoring';

// Mock dependencies
jest.mock('../../src/services/database');
jest.mock('../../src/services/container-lifecycle');
jest.mock('../../src/services/monitoring');
jest.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

describe('ContainerCleanupService', () => {
  let cleanupService: ContainerCleanupService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Reset singleton instance
    (ContainerCleanupService as any).instance = null;
    
    // Get fresh instance
    cleanupService = ContainerCleanupService.getInstance();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await cleanupService.shutdown();
  });

  describe('initialize', () => {
    it('should load default policies on initialization', async () => {
      await cleanupService.initialize();

      const policies = cleanupService.getCleanupPolicies();
      
      expect(policies.length).toBe(4);
      expect(policies.map(p => p.id)).toContain('idle-containers');
      expect(policies.map(p => p.id)).toContain('failed-containers');
      expect(policies.map(p => p.id)).toContain('orphaned-containers');
      expect(policies.map(p => p.id)).toContain('expired-containers');
    });
  });

  describe('runCleanup', () => {
    const mockContainers = [
      {
        id: 'container-1',
        name: 'test-container-1',
        state: 'running',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        lastActivity: new Date(Date.now() - 45 * 60 * 1000), // 45 minutes ago
        labels: {},
        jobId: null,
        runnerId: 'runner-1'
      },
      {
        id: 'container-2',
        name: 'test-container-2',
        state: 'stopped',
        exitCode: 1,
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
        finishedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
        labels: {},
        jobId: 'job-1',
        runnerId: 'runner-2'
      },
      {
        id: 'container-3',
        name: 'test-container-3',
        state: 'running',
        createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        lastActivity: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        labels: { 'runnerhub.persistent': 'true' },
        jobId: null,
        runnerId: null
      }
    ];

    beforeEach(async () => {
      (containerLifecycle.getAllContainers as jest.Mock).mockReturnValue(mockContainers);
      (containerLifecycle.stopContainer as jest.Mock).mockResolvedValue(undefined);
      (containerLifecycle.removeContainer as jest.Mock).mockResolvedValue(undefined);
      (containerLifecycle.getContainerLogs as jest.Mock).mockResolvedValue('test logs');
      (database.query as jest.Mock).mockResolvedValue([]);

      await cleanupService.initialize();
    });

    it('should cleanup idle containers', async () => {
      const result = await cleanupService.runCleanup();

      expect(result.containersInspected).toBe(3);
      expect(result.containersCleaned).toBeGreaterThan(0);
      expect(result.policiesExecuted).toBe(4);
      
      // Should cleanup container-1 (idle for 45 minutes)
      expect(containerLifecycle.removeContainer).toHaveBeenCalledWith('container-1');
    });

    it('should cleanup failed containers', async () => {
      await cleanupService.runCleanup();

      // Should cleanup container-2 (failed with exit code 1)
      expect(containerLifecycle.removeContainer).toHaveBeenCalledWith('container-2');
    });

    it('should respect exclude labels', async () => {
      await cleanupService.runCleanup();

      // Should NOT cleanup container-3 (has persistent label)
      expect(containerLifecycle.removeContainer).not.toHaveBeenCalledWith('container-3');
    });

    it('should archive logs before cleanup', async () => {
      await cleanupService.runCleanup();

      expect(containerLifecycle.getContainerLogs).toHaveBeenCalled();
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO runnerhub.archived_logs'),
        expect.any(Array)
      );
    });

    it('should emit cleanup completed event', async () => {
      const eventHandler = jest.fn();
      cleanupService.on('cleanup-completed', eventHandler);

      await cleanupService.runCleanup();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          containersInspected: 3,
          policiesExecuted: 4
        })
      );
    });

    it('should record monitoring event', async () => {
      await cleanupService.runCleanup();

      expect(monitoringService.recordCleanupEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          containersInspected: 3,
          containersCleaned: expect.any(Number),
          diskSpaceReclaimed: expect.any(Number),
          duration: expect.any(Number)
        })
      );
    });
  });

  describe('policy management', () => {
    beforeEach(async () => {
      await cleanupService.initialize();
    });

    it('should update cleanup policy', async () => {
      const updates = {
        enabled: false,
        conditions: {
          idleTimeMinutes: 60
        }
      };

      const updated = await cleanupService.updatePolicy('idle-containers', updates);

      expect(updated.enabled).toBe(false);
      expect(updated.conditions.idleTimeMinutes).toBe(60);
    });

    it('should throw error for non-existent policy', async () => {
      await expect(
        cleanupService.updatePolicy('non-existent', { enabled: false })
      ).rejects.toThrow('Policy non-existent not found');
    });
  });

  describe('cleanup history', () => {
    it('should store cleanup history', async () => {
      (database.query as jest.Mock).mockResolvedValue([
        {
          timestamp: new Date(),
          policies_executed: 4,
          containers_inspected: 10,
          containers_cleaned: 3,
          errors: 0,
          disk_space_reclaimed: 300 * 1024 * 1024
        }
      ]);

      const history = await cleanupService.getCleanupHistory(24);

      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM runnerhub.cleanup_history'),
        expect.any(Array)
      );
      expect(history).toHaveLength(1);
    });
  });

  describe('container evaluation', () => {
    beforeEach(async () => {
      await cleanupService.initialize();
    });

    it('should identify idle containers correctly', async () => {
      const idleContainer = {
        id: 'idle-1',
        name: 'idle-container',
        state: 'running',
        lastActivity: new Date(Date.now() - 45 * 60 * 1000), // 45 minutes ago
        createdAt: new Date(),
        labels: {},
        jobId: null
      };

      (containerLifecycle.getAllContainers as jest.Mock).mockReturnValue([idleContainer]);

      const result = await cleanupService.runCleanup();
      const idlePolicy = cleanupService.getCleanupPolicies().find(p => p.id === 'idle-containers');
      
      expect(result.details.some(d => 
        d.containerId === 'idle-1' && 
        d.policy === idlePolicy?.name
      )).toBe(true);
    });

    it('should identify orphaned containers correctly', async () => {
      const orphanedContainer = {
        id: 'orphan-1',
        name: 'orphaned-container',
        state: 'running',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        labels: {},
        jobId: null,
        runnerId: null
      };

      (containerLifecycle.getAllContainers as jest.Mock).mockReturnValue([orphanedContainer]);

      const result = await cleanupService.runCleanup();
      const orphanPolicy = cleanupService.getCleanupPolicies().find(p => p.id === 'orphaned-containers');
      
      expect(result.details.some(d => 
        d.containerId === 'orphan-1' && 
        d.policy === orphanPolicy?.name
      )).toBe(true);
    });

    it('should identify expired containers correctly', async () => {
      const expiredContainer = {
        id: 'expired-1',
        name: 'expired-container',
        state: 'running',
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
        labels: {},
        jobId: 'job-old',
        runnerId: 'runner-old'
      };

      (containerLifecycle.getAllContainers as jest.Mock).mockReturnValue([expiredContainer]);

      const result = await cleanupService.runCleanup();
      const expiredPolicy = cleanupService.getCleanupPolicies().find(p => p.id === 'expired-containers');
      
      expect(result.details.some(d => 
        d.containerId === 'expired-1' && 
        d.policy === expiredPolicy?.name
      )).toBe(true);
    });
  });

  describe('manual trigger', () => {
    it('should allow manual cleanup trigger', async () => {
      await cleanupService.initialize();
      
      (containerLifecycle.getAllContainers as jest.Mock).mockReturnValue([]);

      const result = await cleanupService.triggerCleanup();

      expect(result.containersInspected).toBe(0);
      expect(result.policiesExecuted).toBe(4);
    });
  });
});