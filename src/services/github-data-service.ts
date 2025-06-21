import { getGitHubAPIClient } from './github-api-enhanced';
import { createLogger } from '../utils/logger';
import config from '../config';
import * as redis from 'redis';

const logger = createLogger('GitHubDataService');

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    type: string;
  };
  private: boolean;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  workflow_id: number;
  workflow_name?: string;
  head_branch: string;
  head_sha: string;
  event: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  repository: {
    full_name: string;
  };
  created_at: string;
  updated_at: string;
  run_attempt: number;
  run_number: number;
  actor: {
    login: string;
    avatar_url: string;
  };
}

export interface WorkflowJob {
  id: number;
  run_id: number;
  workflow_name: string;
  head_branch: string;
  head_sha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  started_at: string | null;
  completed_at: string | null;
  name: string;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
  }>;
  runner_id: number | null;
  runner_name: string | null;
  runner_group_id: number | null;
  runner_group_name: string | null;
  labels: string[];
}

export interface GitHubRunner {
  id: number;
  name: string;
  os: string;
  status: 'online' | 'offline';
  busy: boolean;
  labels: Array<{
    id: number;
    name: string;
    type: string;
  }>;
}

export interface RepositoryActivity {
  repository: string;
  workflowRuns: {
    total: number;
    queued: number;
    in_progress: number;
    completed: number;
    success_rate: number;
  };
  jobs: {
    total: number;
    queued: number;
    running: number;
    average_duration: number;
  };
  runners: {
    total: number;
    online: number;
    busy: number;
    utilization: number;
  };
}

export class GitHubDataService {
  private githubClient = getGitHubAPIClient();
  private redisClient: redis.RedisClientType | null = null;
  private cacheEnabled: boolean = true;
  private cacheTTL = {
    repositories: 300,      // 5 minutes
    workflowRuns: 60,      // 1 minute
    runners: 30,           // 30 seconds
    jobs: 30               // 30 seconds
  };

  constructor() {
    this.initializeRedis();
  }

  private async initializeRedis() {
    try {
      if (config.redis?.url) {
        this.redisClient = redis.createClient({
          url: config.redis.url
        });
        
        this.redisClient.on('error', (err) => {
          logger.error('Redis client error:', err);
          this.cacheEnabled = false;
        });

        await this.redisClient.connect();
        logger.info('Redis cache connected for GitHub data');
      }
    } catch (error) {
      logger.warn('Failed to connect to Redis, caching disabled', error);
      this.cacheEnabled = false;
    }
  }

  /**
   * Get repositories for the authenticated user or organization
   */
  async getRepositories(options: {
    type?: 'all' | 'owner' | 'public' | 'private' | 'member';
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    per_page?: number;
    page?: number;
  } = {}): Promise<Repository[]> {
    const cacheKey = `github:repos:${JSON.stringify(options)}`;
    
    // Try cache first
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      logger.info('Fetching repositories from GitHub', options);
      
      const response = await this.githubClient.request(
        () => this.githubClient['octokit'].rest.repos.listForAuthenticatedUser({
          type: options.type || 'all',
          sort: options.sort || 'updated',
          per_page: options.per_page || 30,
          page: options.page || 1
        }),
        { priority: 'normal' }
      );

      const repositories = response.data as Repository[];
      
      // Cache the result
      await this.setCache(cacheKey, repositories, this.cacheTTL.repositories);
      
      return repositories;
    } catch (error) {
      logger.error('Failed to fetch repositories', error);
      throw error;
    }
  }

  /**
   * Get workflow runs for a repository
   */
  async getWorkflowRuns(owner: string, repo: string, options: {
    branch?: string;
    event?: string;
    status?: 'completed' | 'action_required' | 'cancelled' | 'failure' | 'neutral' | 'skipped' | 'stale' | 'success' | 'timed_out' | 'in_progress' | 'queued' | 'requested' | 'waiting';
    per_page?: number;
    page?: number;
  } = {}): Promise<WorkflowRun[]> {
    const cacheKey = `github:runs:${owner}/${repo}:${JSON.stringify(options)}`;
    
    // Try cache first
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      logger.info(`Fetching workflow runs for ${owner}/${repo}`, options);
      
      const response = await this.githubClient.request(
        () => this.githubClient['octokit'].rest.actions.listWorkflowRunsForRepo({
          owner,
          repo,
          branch: options.branch,
          event: options.event,
          status: options.status,
          per_page: options.per_page || 30,
          page: options.page || 1
        }),
        { priority: 'high' }
      );

      const runs = response.data.workflow_runs.map(run => ({
        ...run,
        repository: { full_name: `${owner}/${repo}` }
      })) as WorkflowRun[];
      
      // Cache the result
      await this.setCache(cacheKey, runs, this.cacheTTL.workflowRuns);
      
      return runs;
    } catch (error) {
      logger.error(`Failed to fetch workflow runs for ${owner}/${repo}`, error);
      throw error;
    }
  }

  /**
   * Get workflow jobs for a run
   */
  async getWorkflowJobs(owner: string, repo: string, runId: number): Promise<WorkflowJob[]> {
    const cacheKey = `github:jobs:${owner}/${repo}:${runId}`;
    
    // Try cache first
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      logger.info(`Fetching workflow jobs for run ${runId} in ${owner}/${repo}`);
      
      const response = await this.githubClient.request(
        () => this.githubClient['octokit'].rest.actions.listJobsForWorkflowRun({
          owner,
          repo,
          run_id: runId
        }),
        { priority: 'high' }
      );

      const jobs = response.data.jobs as WorkflowJob[];
      
      // Cache the result
      await this.setCache(cacheKey, jobs, this.cacheTTL.jobs);
      
      return jobs;
    } catch (error) {
      logger.error(`Failed to fetch workflow jobs for run ${runId}`, error);
      throw error;
    }
  }

  /**
   * Get self-hosted runners for a repository
   */
  async getRunners(owner: string, repo: string): Promise<GitHubRunner[]> {
    const cacheKey = `github:runners:${owner}/${repo}`;
    
    // Try cache first
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      logger.info(`Fetching runners for ${owner}/${repo}`);
      
      const response = await this.githubClient.request(
        () => this.githubClient['octokit'].rest.actions.listSelfHostedRunnersForRepo({
          owner,
          repo
        }),
        { priority: 'normal' }
      );

      const runners = response.data.runners as GitHubRunner[];
      
      // Cache the result
      await this.setCache(cacheKey, runners, this.cacheTTL.runners);
      
      return runners;
    } catch (error) {
      logger.error(`Failed to fetch runners for ${owner}/${repo}`, error);
      throw error;
    }
  }

  /**
   * Get aggregated repository activity
   */
  async getRepositoryActivity(owner: string, repo: string): Promise<RepositoryActivity> {
    try {
      // Fetch all data in parallel
      const [workflowRuns, runners] = await Promise.all([
        this.getWorkflowRuns(owner, repo, { per_page: 100 }),
        this.getRunners(owner, repo).catch(() => [] as GitHubRunner[]) // Gracefully handle no access to runners
      ]);

      // Calculate workflow run statistics
      const runStats = {
        total: workflowRuns.length,
        queued: workflowRuns.filter(r => r.status === 'queued').length,
        in_progress: workflowRuns.filter(r => r.status === 'in_progress').length,
        completed: workflowRuns.filter(r => r.status === 'completed').length,
        success_rate: 0
      };

      // Calculate success rate
      const completedRuns = workflowRuns.filter(r => r.status === 'completed');
      if (completedRuns.length > 0) {
        const successfulRuns = completedRuns.filter(r => r.conclusion === 'success').length;
        runStats.success_rate = (successfulRuns / completedRuns.length) * 100;
      }

      // Calculate runner statistics
      const runnerStats = {
        total: runners.length,
        online: runners.filter(r => r.status === 'online').length,
        busy: runners.filter(r => r.busy).length,
        utilization: 0
      };

      // Calculate utilization
      if (runnerStats.online > 0) {
        runnerStats.utilization = (runnerStats.busy / runnerStats.online) * 100;
      }

      // Get jobs for in-progress runs to calculate job statistics
      let totalJobs = 0;
      let queuedJobs = 0;
      let runningJobs = 0;
      let totalDuration = 0;
      let completedJobsWithDuration = 0;

      // Sample a few recent runs to get job statistics
      const recentRuns = workflowRuns.slice(0, 10);
      for (const run of recentRuns) {
        try {
          const jobs = await this.getWorkflowJobs(owner, repo, run.id);
          totalJobs += jobs.length;
          queuedJobs += jobs.filter(j => j.status === 'queued').length;
          runningJobs += jobs.filter(j => j.status === 'in_progress').length;
          
          // Calculate average duration
          jobs.forEach(job => {
            if (job.completed_at && job.started_at) {
              const duration = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime();
              totalDuration += duration;
              completedJobsWithDuration++;
            }
          });
        } catch (error) {
          // Skip if we can't get jobs for this run
          logger.debug(`Failed to get jobs for run ${run.id}`, error);
        }
      }

      const jobStats = {
        total: totalJobs,
        queued: queuedJobs,
        running: runningJobs,
        average_duration: completedJobsWithDuration > 0 ? totalDuration / completedJobsWithDuration / 1000 : 0 // Convert to seconds
      };

      return {
        repository: `${owner}/${repo}`,
        workflowRuns: runStats,
        jobs: jobStats,
        runners: runnerStats
      };
    } catch (error) {
      logger.error(`Failed to get repository activity for ${owner}/${repo}`, error);
      throw error;
    }
  }

  /**
   * Get aggregated data for multiple repositories
   */
  async getMultiRepositoryActivity(repositories: string[]): Promise<RepositoryActivity[]> {
    const activities = await Promise.all(
      repositories.map(async (repo) => {
        const [owner, name] = repo.split('/');
        try {
          return await this.getRepositoryActivity(owner, name);
        } catch (error) {
          logger.warn(`Failed to get activity for ${repo}`, error);
          return null;
        }
      })
    );

    return activities.filter(a => a !== null) as RepositoryActivity[];
  }

  /**
   * Get recent workflow jobs across repositories
   */
  async getRecentJobs(repositories: string[], limit: number = 20): Promise<WorkflowJob[]> {
    const allJobs: WorkflowJob[] = [];

    // Fetch recent runs for each repository
    for (const repo of repositories) {
      const [owner, name] = repo.split('/');
      try {
        const runs = await this.getWorkflowRuns(owner, name, { per_page: 5 });
        
        // Get jobs for each run
        for (const run of runs) {
          const jobs = await this.getWorkflowJobs(owner, name, run.id);
          allJobs.push(...jobs.map(job => ({
            ...job,
            workflow_name: run.name,
            head_branch: run.head_branch,
            head_sha: run.head_sha
          })));
        }
      } catch (error) {
        logger.warn(`Failed to get jobs for ${repo}`, error);
      }
    }

    // Sort by started_at or created_at and return the most recent
    return allJobs
      .sort((a, b) => {
        const aTime = a.started_at || a.completed_at || '0';
        const bTime = b.started_at || b.completed_at || '0';
        return bTime.localeCompare(aTime);
      })
      .slice(0, limit);
  }

  /**
   * Cache helper methods
   */
  private async getFromCache(key: string): Promise<any> {
    if (!this.cacheEnabled || !this.redisClient || !this.redisClient.isOpen) {
      return null;
    }

    try {
      const cached = await this.redisClient.get(key);
      if (cached) {
        logger.debug(`Cache hit for ${key}`);
        return JSON.parse(cached);
      }
    } catch (error) {
      logger.warn(`Cache get error for ${key}`, error);
    }

    return null;
  }

  private async setCache(key: string, value: any, ttl: number): Promise<void> {
    if (!this.cacheEnabled || !this.redisClient || !this.redisClient.isOpen) {
      return;
    }

    try {
      await this.redisClient.set(key, JSON.stringify(value), { EX: ttl });
      logger.debug(`Cached ${key} for ${ttl}s`);
    } catch (error) {
      logger.warn(`Cache set error for ${key}`, error);
    }
  }

  /**
   * Invalidate cache for a specific repository
   */
  async invalidateRepositoryCache(owner: string, repo: string): Promise<void> {
    if (!this.redisClient || !this.redisClient.isOpen) {
      return;
    }

    try {
      const pattern = `github:*:${owner}/${repo}:*`;
      const keys = await this.redisClient.keys(pattern);
      
      if (keys.length > 0) {
        await this.redisClient.del(keys);
        logger.info(`Invalidated ${keys.length} cache entries for ${owner}/${repo}`);
      }
    } catch (error) {
      logger.error('Failed to invalidate cache', error);
    }
  }

  /**
   * Get rate limit status from GitHub API
   */
  async getRateLimitStatus() {
    return this.githubClient.getRateLimitStatus();
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.quit();
    }
  }
}

// Singleton instance
let instance: GitHubDataService | null = null;

export function getGitHubDataService(): GitHubDataService {
  if (!instance) {
    instance = new GitHubDataService();
  }
  return instance;
}

export default GitHubDataService;