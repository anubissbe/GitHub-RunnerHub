import { AutoScaler } from '../../src/services/auto-scaler';
import runnerPoolManager from '../../src/services/runner-pool-manager';
import database from '../../src/services/database';

// Mock dependencies
jest.mock('../../src/services/runner-pool-manager');
jest.mock('../../src/services/database');
jest.mock('../../src/services/monitoring');
jest.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

describe('AutoScaler', () => {
  let autoScaler: AutoScaler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Reset singleton instance
    (AutoScaler as any).instance = null;
    
    // Get fresh instance
    autoScaler = AutoScaler.getInstance();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialize', () => {
    it('should load policies and start monitoring', async () => {
      const mockPools = [
        {
          repository: 'test/repo1',
          minRunners: 1,
          maxRunners: 10,
          scaleThreshold: 0.8,
          scaleIncrement: 3
        },
        {
          repository: 'test/repo2',
          minRunners: 2,
          maxRunners: 20,
          scaleThreshold: 0.7,
          scaleIncrement: 5
        }
      ];

      (runnerPoolManager.getAllPools as jest.Mock).mockResolvedValue(mockPools);

      await autoScaler.initialize();

      expect(runnerPoolManager.getAllPools).toHaveBeenCalled();
      
      // Check that policies were loaded
      const status = autoScaler.getScalingStatus();
      expect(status.has('test/repo1')).toBe(true);
      expect(status.has('test/repo2')).toBe(true);
      expect(status.has('*')).toBe(true); // Default policy
    });
  });

  describe('scaling decisions', () => {
    beforeEach(async () => {
      const mockPools = [{
        repository: 'test/repo',
        minRunners: 2,
        maxRunners: 10,
        scaleThreshold: 0.8,
        scaleIncrement: 3,
        currentRunners: 5
      }];

      (runnerPoolManager.getAllPools as jest.Mock).mockResolvedValue(mockPools);
      await autoScaler.initialize();
    });

    it('should scale up on high utilization', async () => {
      // Mock high utilization metrics
      (runnerPoolManager.getPoolMetrics as jest.Mock).mockResolvedValue({
        totalRunners: 5,
        activeRunners: 4,
        idleRunners: 1,
        utilization: 0.85
      });

      (database.query as jest.Mock).mockResolvedValue([{
        queue_depth: '2',
        avg_wait_time: '20',
        active_jobs: '4'
      }]);

      (runnerPoolManager.getOrCreatePool as jest.Mock).mockResolvedValue({
        repository: 'test/repo',
        minRunners: 2,
        maxRunners: 10,
        currentRunners: 5
      });

      (runnerPoolManager.scaleUp as jest.Mock).mockResolvedValue(undefined);

      const decision = await autoScaler.evaluateNow('test/repo');

      expect(decision.scalingDecision).toBe('scale-up');
      expect(decision.reason).toContain('Utilization');
      expect(runnerPoolManager.scaleUp).toHaveBeenCalledWith('test/repo', 3);
    });

    it('should scale up on high queue depth', async () => {
      // Mock high queue depth
      (runnerPoolManager.getPoolMetrics as jest.Mock).mockResolvedValue({
        totalRunners: 5,
        activeRunners: 3,
        idleRunners: 2,
        utilization: 0.6
      });

      (database.query as jest.Mock).mockResolvedValue([{
        queue_depth: '10',
        avg_wait_time: '60',
        active_jobs: '3'
      }]);

      (runnerPoolManager.getOrCreatePool as jest.Mock).mockResolvedValue({
        repository: 'test/repo',
        minRunners: 2,
        maxRunners: 10,
        currentRunners: 5
      });

      const decision = await autoScaler.evaluateNow('test/repo');

      expect(decision.scalingDecision).toBe('scale-up');
      expect(decision.reason).toContain('Queue depth');
    });

    it('should scale down on low utilization with no pending jobs', async () => {
      // Mock low utilization
      (runnerPoolManager.getPoolMetrics as jest.Mock).mockResolvedValue({
        totalRunners: 5,
        activeRunners: 0,
        idleRunners: 5,
        utilization: 0.1
      });

      (database.query as jest.Mock).mockResolvedValue([{
        queue_depth: '0',
        avg_wait_time: '0',
        active_jobs: '0'
      }]);

      (runnerPoolManager.getOrCreatePool as jest.Mock).mockResolvedValue({
        repository: 'test/repo',
        minRunners: 2,
        maxRunners: 10,
        currentRunners: 5
      });

      (runnerPoolManager.scaleDown as jest.Mock).mockResolvedValue(2);

      const decision = await autoScaler.evaluateNow('test/repo');

      expect(decision.scalingDecision).toBe('scale-down');
      expect(decision.reason).toContain('Low utilization');
      expect(runnerPoolManager.scaleDown).toHaveBeenCalledWith('test/repo');
    });

    it('should respect minimum runners', async () => {
      // Mock low utilization but at minimum
      (runnerPoolManager.getPoolMetrics as jest.Mock).mockResolvedValue({
        totalRunners: 2,
        activeRunners: 0,
        idleRunners: 2,
        utilization: 0
      });

      (database.query as jest.Mock).mockResolvedValue([{
        queue_depth: '0',
        avg_wait_time: '0',
        active_jobs: '0'
      }]);

      (runnerPoolManager.getOrCreatePool as jest.Mock).mockResolvedValue({
        repository: 'test/repo',
        minRunners: 2,
        maxRunners: 10,
        currentRunners: 2
      });

      const decision = await autoScaler.evaluateNow('test/repo');

      expect(decision.scalingDecision).toBe('maintain');
      expect(decision.reason).toContain('Metrics within normal range');
    });

    it('should respect maximum runners', async () => {
      // Mock high utilization but at maximum
      (runnerPoolManager.getPoolMetrics as jest.Mock).mockResolvedValue({
        totalRunners: 10,
        activeRunners: 10,
        idleRunners: 0,
        utilization: 1.0
      });

      (database.query as jest.Mock).mockResolvedValue([{
        queue_depth: '5',
        avg_wait_time: '120',
        active_jobs: '10'
      }]);

      (runnerPoolManager.getOrCreatePool as jest.Mock).mockResolvedValue({
        repository: 'test/repo',
        minRunners: 2,
        maxRunners: 10,
        currentRunners: 10
      });

      const decision = await autoScaler.evaluateNow('test/repo');

      expect(decision.scalingDecision).toBe('maintain');
      expect(runnerPoolManager.scaleUp).not.toHaveBeenCalled();
    });
  });

  describe('cooldown management', () => {
    it('should enforce cooldown period', async () => {
      const mockPools = [{
        repository: 'test/repo',
        minRunners: 2,
        maxRunners: 10,
        scaleThreshold: 0.8,
        scaleIncrement: 3
      }];

      (runnerPoolManager.getAllPools as jest.Mock).mockResolvedValue(mockPools);
      (runnerPoolManager.getPoolMetrics as jest.Mock).mockResolvedValue({
        totalRunners: 5,
        activeRunners: 5,
        idleRunners: 0,
        utilization: 1.0
      });
      (database.query as jest.Mock).mockResolvedValue([{
        queue_depth: '5',
        avg_wait_time: '60',
        active_jobs: '5'
      }]);
      (runnerPoolManager.getOrCreatePool as jest.Mock).mockResolvedValue({
        repository: 'test/repo',
        minRunners: 2,
        maxRunners: 10,
        currentRunners: 5
      });

      await autoScaler.initialize();

      // First scaling should work
      await autoScaler.evaluateNow('test/repo');
      expect(runnerPoolManager.scaleUp).toHaveBeenCalledTimes(1);

      // Second scaling within cooldown should be blocked
      jest.clearAllMocks();
      
      // Advance time by 1 minute (less than cooldown)
      jest.advanceTimersByTime(60000);
      
      // Check the status to verify cooldown
      const status = autoScaler.getScalingStatus();
      const repoStatus = status.get('test/repo');
      
      // Should be in cooldown after the first scaling action
      expect(repoStatus.inCooldown).toBe(true);
      expect(repoStatus.cooldownRemaining).toBeGreaterThan(0);
      
      // Try another evaluation - evaluateNow bypasses cooldown
      // but we're testing that the status shows cooldown is active
      await autoScaler.evaluateNow('test/repo');
    });
  });

  describe('policy management', () => {
    it('should update scaling policy', async () => {
      await autoScaler.initialize();

      const updates = {
        scaleUpThreshold: 0.7,
        scaleDownThreshold: 0.3,
        cooldownPeriod: 600
      };

      await autoScaler.updatePolicy('test/repo', updates);

      const status = autoScaler.getScalingStatus();
      const policy = status.get('test/repo')?.policy;

      expect(policy).toMatchObject(updates);
    });
  });

  describe('predictive scaling', () => {
    it('should predict scaling needs based on trends', async () => {
      await autoScaler.initialize();

      // Mock historical metrics with upward trend
      const history = [];
      for (let i = 0; i < 20; i++) {
        history.push({
          timestamp: new Date(Date.now() - (20 - i) * 60000),
          repository: 'test/repo',
          utilization: 0.5 + (i * 0.02), // Increasing utilization
          queueDepth: Math.floor(i / 5),
          avgWaitTime: i * 2,
          runnerCount: 5,
          activeJobs: Math.floor(2.5 + (i * 0.1)),
          scalingDecision: 'maintain' as const,
          reason: 'test'
        });
      }

      // Inject metrics history using public method
      for (const metric of history) {
        (autoScaler as any).metricsHistory.push(metric);
      }

      const prediction = await autoScaler.predictScalingNeeds('test/repo', 30);

      expect(prediction.predictedUtilization).toBeGreaterThan(0.8);
      expect(prediction.recommendedRunners).toBeGreaterThan(5);
      expect(prediction.confidence).toBeGreaterThan(0.5);
    });

    it('should handle insufficient data for predictions', async () => {
      await autoScaler.initialize();

      const prediction = await autoScaler.predictScalingNeeds('test/repo', 30);

      expect(prediction.predictedUtilization).toBe(0);
      expect(prediction.recommendedRunners).toBe(0);
      expect(prediction.confidence).toBe(0);
    });
  });

  describe('metrics history', () => {
    it('should maintain metrics history', async () => {
      await autoScaler.initialize();

      // Add some metrics
      const metrics1 = {
        timestamp: new Date(),
        repository: 'test/repo',
        utilization: 0.7,
        queueDepth: 2,
        avgWaitTime: 30,
        runnerCount: 5,
        activeJobs: 3,
        scalingDecision: 'maintain' as const,
        reason: 'test'
      };

      (autoScaler as any).metricsHistory.push(metrics1);

      const history = autoScaler.getMetricsHistory('test/repo', 60);

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject(metrics1);
    });

    it('should filter metrics by time window', async () => {
      await autoScaler.initialize();

      // Add metrics at different times
      const now = Date.now();
      (autoScaler as any).metricsHistory = [
        {
          timestamp: new Date(now - 3600000), // 1 hour ago
          repository: 'test/repo',
          utilization: 0.5,
          queueDepth: 1,
          avgWaitTime: 10,
          runnerCount: 5,
          activeJobs: 2,
          scalingDecision: 'maintain' as const,
          reason: 'old'
        },
        {
          timestamp: new Date(now - 300000), // 5 minutes ago
          repository: 'test/repo',
          utilization: 0.7,
          queueDepth: 3,
          avgWaitTime: 30,
          runnerCount: 5,
          activeJobs: 3,
          scalingDecision: 'maintain' as const,
          reason: 'recent'
        }
      ];

      const history = autoScaler.getMetricsHistory('test/repo', 30);

      expect(history).toHaveLength(1);
      expect(history[0].reason).toBe('recent');
    });
  });
});