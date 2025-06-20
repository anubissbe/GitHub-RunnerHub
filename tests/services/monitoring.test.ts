import { MonitoringService } from '../../src/services/monitoring';
import database from '../../src/services/database';
import runnerPoolManager from '../../src/services/runner-pool-manager';
import { RunnerStatus } from '../../src/types';

// Mock dependencies
jest.mock('../../src/services/database');
jest.mock('../../src/services/runner-pool-manager');
jest.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

describe('MonitoringService', () => {
  let monitoringService: MonitoringService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Get fresh instance
    monitoringService = MonitoringService.getInstance();
  });

  describe('getSystemMetrics', () => {
    it('should return aggregated system metrics', async () => {
      // Mock database responses
      (database.query as jest.Mock)
        .mockResolvedValueOnce([{
          total: '50',
          pending: '5',
          running: '10',
          completed: '30',
          failed: '5',
          avg_wait_time: '15.5',
          avg_execution_time: '120.3'
        }])
        .mockResolvedValueOnce([{
          total: '20',
          proxy: '5',
          ephemeral: '15',
          idle: '8',
          busy: '10',
          offline: '2'
        }])
        .mockResolvedValueOnce([{
          count: '3'
        }]);

      // Mock pool manager
      (runnerPoolManager.getAllPools as jest.Mock).mockResolvedValue([
        { repository: 'owner/repo1' },
        { repository: 'owner/repo2' }
      ]);

      (runnerPoolManager.getPoolMetrics as jest.Mock)
        .mockResolvedValueOnce({
          totalRunners: 5,
          activeRunners: 3,
          idleRunners: 2,
          utilization: 0.6
        })
        .mockResolvedValueOnce({
          totalRunners: 10,
          activeRunners: 8,
          idleRunners: 2,
          utilization: 0.8
        });

      const metrics = await monitoringService.getSystemMetrics();

      expect(metrics).toMatchObject({
        jobs: {
          total: 50,
          pending: 5,
          running: 10,
          completed: 30,
          failed: 5,
          averageWaitTime: 15.5,
          averageExecutionTime: 120.3
        },
        runners: {
          total: 20,
          proxy: 5,
          ephemeral: 15,
          idle: 8,
          busy: 10,
          offline: 2
        },
        pools: {
          total: 2,
          averageUtilization: 0.7,
          scalingEvents: 3
        }
      });
    });
  });

  describe('getRepositoryMetrics', () => {
    it('should return metrics for specific repository', async () => {
      const repository = 'owner/repo';

      (database.query as jest.Mock).mockResolvedValue([{
        total: '25',
        running: '5',
        avg_wait_time: '10.5',
        success_rate: '0.85'
      }]);

      (runnerPoolManager.getPoolMetrics as jest.Mock).mockResolvedValue({
        totalRunners: 5,
        activeRunners: 3,
        idleRunners: 2,
        utilization: 0.6
      });

      (runnerPoolManager.getOrCreatePool as jest.Mock).mockResolvedValue({
        repository,
        minRunners: 2,
        maxRunners: 10
      });

      const metrics = await monitoringService.getRepositoryMetrics(repository);

      expect(metrics).toMatchObject({
        repository,
        jobs: {
          total: 25,
          running: 5,
          averageWaitTime: 10.5,
          successRate: 0.85
        },
        runners: {
          total: 5,
          active: 3,
          utilization: 0.6
        }
      });
    });
  });

  describe('getRunnerHealth', () => {
    it('should calculate runner health status correctly', async () => {
      const now = new Date();
      const runners = [
        {
          id: '1',
          name: 'runner-1',
          type: 'proxy',
          status: RunnerStatus.BUSY,
          lastHeartbeat: new Date(now.getTime() - 30000), // 30 seconds ago
        },
        {
          id: '2',
          name: 'runner-2',
          type: 'ephemeral',
          status: RunnerStatus.IDLE,
          lastHeartbeat: new Date(now.getTime() - 180000), // 3 minutes ago
        },
        {
          id: '3',
          name: 'runner-3',
          type: 'ephemeral',
          status: RunnerStatus.OFFLINE,
          lastHeartbeat: new Date(now.getTime() - 600000), // 10 minutes ago
        }
      ];

      (database.query as jest.Mock).mockResolvedValue(runners);

      const health = await monitoringService.getRunnerHealth();

      expect(health).toHaveLength(3);
      expect(health[0]).toMatchObject({
        id: '1',
        isHealthy: true,
        healthStatus: 'healthy'
      });
      expect(health[1]).toMatchObject({
        id: '2',
        isHealthy: false,
        healthStatus: 'warning'
      });
      expect(health[2]).toMatchObject({
        id: '3',
        isHealthy: false,
        healthStatus: 'offline'
      });
    });
  });

  describe('getPrometheusMetrics', () => {
    it('should format metrics in Prometheus format', async () => {
      // Mock system metrics
      (database.query as jest.Mock)
        .mockResolvedValueOnce([{
          total: '10',
          pending: '2',
          running: '3',
          completed: '4',
          failed: '1',
          avg_wait_time: '5.0',
          avg_execution_time: '60.0'
        }])
        .mockResolvedValueOnce([{
          total: '5',
          proxy: '2',
          ephemeral: '3',
          idle: '2',
          busy: '2',
          offline: '1'
        }])
        .mockResolvedValueOnce([{
          count: '1'
        }]);

      (runnerPoolManager.getAllPools as jest.Mock).mockResolvedValue([
        { repository: 'owner/repo' }
      ]);

      (runnerPoolManager.getPoolMetrics as jest.Mock).mockResolvedValue({
        utilization: 0.75
      });

      const metrics = await monitoringService.getPrometheusMetrics();

      expect(metrics).toContain('github_runnerhub_jobs_total 10');
      expect(metrics).toContain('github_runnerhub_jobs_by_status{status="pending"} 2');
      expect(metrics).toContain('github_runnerhub_runners_total 5');
      expect(metrics).toContain('github_runnerhub_pool_utilization{repository="owner/repo"} 0.75');
    });
  });

  describe('Event recording', () => {
    it('should emit job events', (done) => {
      monitoringService.on('job-event', (event) => {
        expect(event).toMatchObject({
          jobId: 'job-123',
          event: 'started',
          data: { repository: 'owner/repo' }
        });
        done();
      });

      monitoringService.recordJobEvent('job-123', 'started', { repository: 'owner/repo' });
    });

    it('should emit scaling events', (done) => {
      monitoringService.on('scaling-event', (event) => {
        expect(event).toMatchObject({
          repository: 'owner/repo',
          action: 'scale-up',
          count: 3,
          reason: 'High utilization'
        });
        done();
      });

      monitoringService.recordScalingEvent('owner/repo', 'scale-up', 3, 'High utilization');
    });
  });
});