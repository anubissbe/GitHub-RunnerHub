import { JobRouter } from '../../src/services/job-router';
import database from '../../src/services/database';
import runnerPoolManager from '../../src/services/runner-pool-manager';
import { DelegatedJob, Runner, RunnerStatus, JobStatus } from '../../src/types';

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

describe('JobRouter', () => {
  let jobRouter: JobRouter;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset singleton instance
    (JobRouter as any).instance = null;
    
    // Get fresh instance
    jobRouter = JobRouter.getInstance();
  });

  afterEach(async () => {
    // Clean up the job router to stop intervals
    await jobRouter.shutdown();
  });

  describe('initialize', () => {
    it('should load routing rules on initialization', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          name: 'GPU Workloads',
          priority: 100,
          conditions: { labels: ['gpu'] },
          targets: { runnerLabels: ['gpu-enabled'] },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      (database.query as jest.Mock).mockResolvedValue(mockRules);

      await jobRouter.initialize();

      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM runnerhub.routing_rules')
      );
    });
  });

  describe('routeJob', () => {
    const mockJob: DelegatedJob = {
      id: 'job-123',
      githubJobId: 123,
      jobId: 'job-id-123',
      repository: 'test/repo',
      workflow: 'test-workflow',
      runnerName: 'test-runner',
      runId: '1',
      status: JobStatus.PENDING,
      labels: ['gpu', 'linux']
    };

    const mockRunners: Runner[] = [
      {
        id: 'runner-1',
        name: 'gpu-runner-1',
        type: 'dedicated' as any,
        status: RunnerStatus.IDLE,
        labels: ['gpu-enabled', 'linux'],
        repository: 'test/repo',
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'runner-2',
        name: 'cpu-runner-1',
        type: 'dedicated' as any,
        status: RunnerStatus.IDLE,
        labels: ['linux'],
        repository: 'test/repo',
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    beforeEach(async () => {
      // Initialize with test rules
      (database.query as jest.Mock).mockResolvedValue([
        {
          id: 'rule-1',
          name: 'GPU Workloads',
          priority: 100,
          conditions: { labels: ['gpu'] },
          targets: { runnerLabels: ['gpu-enabled'] },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);

      await jobRouter.initialize();

      // Mock runner pool manager
      (runnerPoolManager.getOrCreatePool as jest.Mock).mockResolvedValue({
        repository: 'test/repo',
        minRunners: 1,
        maxRunners: 10
      });
      (runnerPoolManager.getActiveRunners as jest.Mock).mockResolvedValue(mockRunners);
    });

    it('should match job to appropriate routing rule', async () => {
      const decision = await jobRouter.routeJob(mockJob);

      expect(decision.matchedRule).toBeDefined();
      expect(decision.matchedRule?.name).toBe('GPU Workloads');
      expect(decision.targetRunners).toHaveLength(1);
      expect(decision.targetRunners[0].id).toBe('runner-1');
    });

    it('should use default routing when no rules match', async () => {
      const jobWithoutGpu = { ...mockJob, labels: ['linux'] };
      
      const decision = await jobRouter.routeJob(jobWithoutGpu);

      expect(decision.matchedRule).toBeUndefined();
      expect(decision.reason).toContain('Default routing');
      expect(decision.targetRunners).toHaveLength(2); // All runners
    });

    it('should filter runners by job labels in default routing', async () => {
      const jobWithSpecificLabel = { ...mockJob, labels: ['special-label'] };
      
      // No runners have 'special-label'
      const decision = await jobRouter.routeJob(jobWithSpecificLabel);

      expect(decision.matchedRule).toBeUndefined();
      // Should fallback to all runners when no matches
      expect(decision.targetRunners).toHaveLength(2);
    });
  });

  describe('routing rule matching', () => {
    beforeEach(async () => {
      (database.query as jest.Mock).mockResolvedValue([
        {
          id: 'rule-1',
          name: 'Production Jobs',
          priority: 90,
          conditions: {
            repository: '*/production',
            branch: 'main'
          },
          targets: {
            runnerLabels: ['production', 'secure']
          },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'rule-2',
          name: 'Windows Builds',
          priority: 70,
          conditions: {
            labels: ['windows']
          },
          targets: {
            runnerLabels: ['windows'],
            poolOverride: 'windows-pool'
          },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);

      await jobRouter.initialize();
    });

    it('should match repository pattern with wildcards', async () => {
      const job: DelegatedJob = {
        id: 'job-123',
        githubJobId: 123,
        jobId: 'job-id-123',
        repository: 'myorg/production',
        workflow: 'deploy',
        runnerName: 'deploy-runner',
        runId: '1',
        status: JobStatus.PENDING,
        labels: [],
        ref: 'refs/heads/main'
      };

      (runnerPoolManager.getOrCreatePool as jest.Mock).mockResolvedValue({});
      (runnerPoolManager.getActiveRunners as jest.Mock).mockResolvedValue([]);

      const decision = await jobRouter.routeJob(job);

      expect(decision.matchedRule?.name).toBe('Production Jobs');
    });

    it('should respect rule priority order', async () => {
      // Add a higher priority rule that also matches
      const highPriorityRule = {
        id: 'rule-3',
        name: 'High Priority Rule',
        priority: 150,
        conditions: { labels: ['windows'] },
        targets: { runnerLabels: ['high-priority'] },
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Get the original rules from the first call
      const originalRules = [
        {
          id: 'rule-1',
          name: 'Production Jobs',
          priority: 90,
          conditions: {
            repository: '*/production',
            branch: 'main'
          },
          targets: {
            runnerLabels: ['production', 'secure']
          },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'rule-2',
          name: 'Windows Builds',
          priority: 70,
          conditions: {
            labels: ['windows']
          },
          targets: {
            runnerLabels: ['windows'],
            poolOverride: 'windows-pool'
          },
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      (database.query as jest.Mock).mockResolvedValue([
        highPriorityRule,
        ...originalRules
      ]);

      await jobRouter.initialize();

      const job: DelegatedJob = {
        id: 'job-123',
        githubJobId: 123,
        jobId: 'job-id-123',
        repository: 'test/repo',
        workflow: 'build',
        runnerName: 'build-runner',
        runId: '1',
        status: JobStatus.PENDING,
        labels: ['windows']
      };

      (runnerPoolManager.getOrCreatePool as jest.Mock).mockResolvedValue({});
      (runnerPoolManager.getActiveRunners as jest.Mock).mockResolvedValue([]);

      const decision = await jobRouter.routeJob(job);

      expect(decision.matchedRule?.name).toBe('High Priority Rule');
    });
  });

  describe('CRUD operations', () => {
    it('should create a new routing rule', async () => {
      const newRule = {
        name: 'Test Rule',
        priority: 50,
        conditions: { labels: ['test'] },
        targets: { runnerLabels: ['test-runner'] },
        enabled: true
      };

      const createdRule = {
        ...newRule,
        id: 'rule-123',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (database.query as jest.Mock).mockResolvedValue([createdRule]);

      const result = await jobRouter.createRoutingRule(newRule);

      expect(result).toEqual(createdRule);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO runnerhub.routing_rules'),
        expect.any(Array)
      );
    });

    it('should update an existing routing rule', async () => {
      const updates = {
        priority: 60,
        enabled: false
      };

      const updatedRule = {
        id: 'rule-123',
        name: 'Test Rule',
        priority: 60,
        conditions: { labels: ['test'] },
        targets: { runnerLabels: ['test-runner'] },
        enabled: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (database.query as jest.Mock).mockResolvedValue([updatedRule]);

      const result = await jobRouter.updateRoutingRule('rule-123', updates);

      expect(result).toEqual(updatedRule);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE runnerhub.routing_rules'),
        expect.arrayContaining([60, false, 'rule-123'])
      );
    });

    it('should delete a routing rule', async () => {
      (database.query as jest.Mock).mockResolvedValue([]);

      await jobRouter.deleteRoutingRule('rule-123');

      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM runnerhub.routing_rules'),
        ['rule-123']
      );
    });
  });

  describe('testRoutingRule', () => {
    it('should test a rule against a sample job', async () => {
      const testRule = {
        name: 'Test Rule',
        priority: 50,
        conditions: { labels: ['gpu'] },
        targets: { runnerLabels: ['gpu-enabled'] },
        enabled: true
      };

      const sampleJob = {
        repository: 'test/repo',
        labels: ['gpu', 'linux']
      };

      const mockRunners = [
        {
          id: 'runner-1',
          labels: ['gpu-enabled', 'linux']
        },
        {
          id: 'runner-2',
          labels: ['cpu-only']
        }
      ];

      (runnerPoolManager.getActiveRunners as jest.Mock).mockResolvedValue(mockRunners);

      const result = await jobRouter.testRoutingRule(testRule, sampleJob);

      expect(result.matches).toBe(true);
      expect(result.targetRunners).toHaveLength(1);
      expect(result.reason).toContain('found 1 target runners');
    });

    it('should handle non-matching test cases', async () => {
      const testRule = {
        name: 'Test Rule',
        priority: 50,
        conditions: { labels: ['gpu'] },
        targets: { runnerLabels: ['gpu-enabled'] },
        enabled: true
      };

      const sampleJob = {
        repository: 'test/repo',
        labels: ['cpu-only']
      };

      const result = await jobRouter.testRoutingRule(testRule, sampleJob);

      expect(result.matches).toBe(false);
      expect(result.targetRunners).toHaveLength(0);
      expect(result.reason).toContain('does not match');
    });
  });

  describe('getRoutingAnalytics', () => {
    it('should return routing analytics', async () => {
      const mockAnalytics = [
        {
          rule_id: 'rule-1',
          rule_name: 'GPU Workloads',
          match_count: '25',
          avg_targets: '3.5',
          last_matched: new Date()
        }
      ];

      (database.query as jest.Mock).mockResolvedValue(mockAnalytics);

      const result = await jobRouter.getRoutingAnalytics(24);

      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('routing_decisions')
      );
      expect(result).toEqual(mockAnalytics);
    });
  });
});