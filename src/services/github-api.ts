import axios, { AxiosInstance } from 'axios';
import config from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('GitHubAPIService');

export interface RunnerToken {
  token: string;
  expires_at: string;
}

export interface GitHubRunner {
  id: number;
  name: string;
  os: string;
  status: string;
  busy: boolean;
  labels: Array<{
    id: number;
    name: string;
    type: string;
  }>;
}

export class GitHubAPIService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Authorization: `Bearer ${config.github.token}`,
        Accept: 'application/vnd.github.v3+json'
      },
      timeout: 30000
    });

    // Add request/response interceptors for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('GitHub API request', {
          method: config.method,
          url: config.url
        });
        return config;
      },
      (error) => {
        logger.error('GitHub API request error', { error });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('GitHub API response', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        logger.error('GitHub API response error', {
          status: error.response?.status,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Generate a registration token for a runner
   */
  async generateRunnerToken(repository: string): Promise<string> {
    try {
      const [owner, repo] = repository.split('/');
      const response = await this.client.post<RunnerToken>(
        `/repos/${owner}/${repo}/actions/runners/registration-token`
      );
      
      logger.info('Generated runner token', { repository });
      return response.data.token;
    } catch (error) {
      logger.error('Failed to generate runner token', { repository, error });
      throw new Error(`Failed to generate runner token: ${error}`);
    }
  }

  /**
   * List all runners for a repository
   */
  async listRunners(repository: string): Promise<GitHubRunner[]> {
    try {
      const [owner, repo] = repository.split('/');
      const response = await this.client.get<{ runners: GitHubRunner[] }>(
        `/repos/${owner}/${repo}/actions/runners`
      );
      
      return response.data.runners;
    } catch (error) {
      logger.error('Failed to list runners', { repository, error });
      throw new Error(`Failed to list runners: ${error}`);
    }
  }

  /**
   * Remove a runner from a repository
   */
  async removeRunner(repository: string, runnerId: number): Promise<void> {
    try {
      const [owner, repo] = repository.split('/');
      await this.client.delete(
        `/repos/${owner}/${repo}/actions/runners/${runnerId}`
      );
      
      logger.info('Removed runner', { repository, runnerId });
    } catch (error) {
      logger.error('Failed to remove runner', { repository, runnerId, error });
      throw new Error(`Failed to remove runner: ${error}`);
    }
  }

  /**
   * Get workflow runs for a repository
   */
  async getWorkflowRuns(repository: string, options?: {
    status?: 'completed' | 'action_required' | 'cancelled' | 'failure' | 'neutral' | 'skipped' | 'stale' | 'success' | 'timed_out' | 'in_progress' | 'queued' | 'requested' | 'waiting';
    per_page?: number;
    page?: number;
  }) {
    try {
      const [owner, repo] = repository.split('/');
      const response = await this.client.get(
        `/repos/${owner}/${repo}/actions/runs`,
        { params: options }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Failed to get workflow runs', { repository, error });
      throw new Error(`Failed to get workflow runs: ${error}`);
    }
  }

  /**
   * Get workflow jobs for a run
   */
  async getWorkflowJobs(repository: string, runId: number) {
    try {
      const [owner, repo] = repository.split('/');
      const response = await this.client.get(
        `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`
      );
      
      return response.data;
    } catch (error) {
      logger.error('Failed to get workflow jobs', { repository, runId, error });
      throw new Error(`Failed to get workflow jobs: ${error}`);
    }
  }

  /**
   * Check rate limit status
   */
  async getRateLimit() {
    try {
      const response = await this.client.get('/rate_limit');
      return response.data;
    } catch (error) {
      logger.error('Failed to get rate limit', { error });
      throw new Error(`Failed to get rate limit: ${error}`);
    }
  }

  /**
   * Clean up offline runners
   */
  async cleanupOfflineRunners(repository: string): Promise<number> {
    try {
      const runners = await this.listRunners(repository);
      const offlineRunners = runners.filter(r => r.status === 'offline');
      
      let removed = 0;
      for (const runner of offlineRunners) {
        try {
          await this.removeRunner(repository, runner.id);
          removed++;
        } catch (err) {
          logger.warn('Failed to remove offline runner', {
            repository,
            runnerId: runner.id,
            runnerName: runner.name
          });
        }
      }

      logger.info('Cleaned up offline runners', { repository, removed });
      return removed;
    } catch (error) {
      logger.error('Failed to cleanup offline runners', { repository, error });
      return 0;
    }
  }
}

export default GitHubAPIService;