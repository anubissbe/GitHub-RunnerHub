import { Octokit } from '@octokit/rest';
import { createLogger } from '../utils/logger';
import config from '../config';
import * as redis from 'redis';
import { getGitHubCacheService, GitHubCacheService } from './github-cache-service';

const logger = createLogger('GitHubAPIEnhanced');

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  reset: Date;
  used: number;
  resetIn: number;
}

interface QueuedRequest {
  id: string;
  function: () => Promise<any>;
  priority: 'critical' | 'high' | 'normal' | 'low';
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timestamp: number;
  retries: number;
  maxRetries: number;
}

interface RateLimitStrategy {
  shouldDelay(rateLimit: RateLimitInfo): boolean;
  calculateDelay(rateLimit: RateLimitInfo): number;
}

export class GitHubAPIEnhanced {
  private octokit: Octokit;
  private redisClient!: redis.RedisClientType;
  private cacheService: GitHubCacheService;
  private rateLimit: RateLimitInfo;
  private requestQueue: QueuedRequest[] = [];
  private processing = false;
  private strategies: Map<string, RateLimitStrategy>;
  private metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    rateLimitHits: number;
    averageResponseTime: number;
    cacheHits: number;
    cacheMisses: number;
  };

  constructor() {
    this.octokit = new Octokit({
      auth: config.github.token,
      userAgent: 'GitHub-RunnerHub/2.0',
      retry: {
        doNotRetry: [400, 401, 422],
        retries: 3
      }
    });

    // Initialize rate limit tracking
    this.rateLimit = {
      remaining: 5000,
      limit: 5000,
      reset: new Date(Date.now() + 3600000),
      used: 0,
      resetIn: 3600000
    };

    // Initialize cache service
    this.cacheService = getGitHubCacheService();

    // Initialize metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      averageResponseTime: 0,
      cacheHits: 0,
      cacheMisses: 0
    };

    // Initialize rate limit strategies
    this.strategies = new Map([
      ['conservative', {
        shouldDelay: (rl) => rl.remaining < rl.limit * 0.2, // Delay when < 20% remaining
        calculateDelay: (rl) => {
          const percentRemaining = rl.remaining / rl.limit;
          if (percentRemaining < 0.05) return 5000; // 5s delay when < 5%
          if (percentRemaining < 0.1) return 2000;  // 2s delay when < 10%
          if (percentRemaining < 0.2) return 500;   // 0.5s delay when < 20%
          return 100;
        }
      }],
      ['aggressive', {
        shouldDelay: (rl) => rl.remaining < 50, // Only delay when very low
        calculateDelay: (rl) => {
          if (rl.remaining < 10) return 10000; // 10s when critical
          if (rl.remaining < 25) return 1000;  // 1s when low
          return 200;
        }
      }],
      ['adaptive', {
        shouldDelay: (rl) => {
          const timeToReset = rl.resetIn;
          const requestsPerMinute = (rl.used / (3600000 - timeToReset)) * 60000;
          const remainingMinutes = timeToReset / 60000;
          const projectedUsage = requestsPerMinute * remainingMinutes;
          return projectedUsage > rl.remaining * 0.9; // Delay if projected to exceed 90%
        },
        calculateDelay: (rl) => {
          const timeToReset = rl.resetIn;
          const optimalRate = rl.remaining / (timeToReset / 1000); // requests per second
          return Math.max(100, Math.floor(1000 / optimalRate));
        }
      }]
    ]);

    this.initializeRedis();
    this.startMetricsReporting();
  }

  private async initializeRedis() {
    try {
      this.redisClient = redis.createClient({
        url: `redis://${config.redis.host}:${config.redis.port}`,
        password: config.redis.password
      });

      await this.redisClient.connect();
      logger.info('Connected to Redis for distributed rate limit tracking');

      // Restore rate limit from Redis if available
      const savedRateLimit = await this.redisClient.get('github:rateLimit');
      if (savedRateLimit) {
        const parsed = JSON.parse(savedRateLimit);
        this.rateLimit = {
          ...parsed,
          reset: new Date(parsed.reset)
        };
        logger.info('Restored rate limit from Redis', this.rateLimit);
      }
    } catch (error) {
      logger.warn('Failed to connect to Redis, using in-memory rate limiting', error);
    }
  }

  /**
   * Make a cached and rate-limited request
   */
  async cachedRequest<T>(
    endpoint: string,
    requestFn: () => Promise<T>,
    options: {
      params?: any;
      priority?: 'critical' | 'high' | 'normal' | 'low';
      maxRetries?: number;
      strategy?: 'conservative' | 'aggressive' | 'adaptive';
      metadata?: Record<string, any>;
      cache?: boolean;
      cacheTTL?: number;
      cacheTags?: string[];
    } = {}
  ): Promise<T> {
    const {
      params,
      cache = true,
      cacheTTL,
      cacheTags,
      ...requestOptions
    } = options;

    // Try to get from cache first
    if (cache) {
      const cached = await this.cacheService.get(endpoint, params);
      if (cached !== null) {
        this.metrics.cacheHits++;
        logger.debug(`Cache hit for ${endpoint}`);
        return cached as T;
      }
      this.metrics.cacheMisses++;
    }

    // Make the actual request
    const result = await this.request(requestFn, requestOptions);

    // Cache the result
    if (cache && result) {
      await this.cacheService.set(endpoint, result, params, {
        ttl: cacheTTL,
        tags: cacheTags
      });
    }

    return result;
  }

  /**
   * Make a rate-limited request with smart queuing and retry logic
   */
  async request<T>(
    requestFn: () => Promise<T>,
    options: {
      priority?: 'critical' | 'high' | 'normal' | 'low';
      maxRetries?: number;
      strategy?: 'conservative' | 'aggressive' | 'adaptive';
      metadata?: Record<string, any>;
    } = {}
  ): Promise<T> {
    const {
      priority = 'normal',
      maxRetries = 3,
      strategy = 'adaptive',
      metadata = {}
    } = options;

    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        id: `${Date.now()}-${Math.random()}`,
        function: requestFn,
        priority,
        resolve,
        reject,
        timestamp: Date.now(),
        retries: 0,
        maxRetries
      };

      this.requestQueue.push(request);
      logger.debug(`Queued request ${request.id}`, { priority, metadata });

      if (!this.processing) {
        this.processQueue(strategy);
      }
    });
  }

  /**
   * Process the request queue with intelligent rate limiting
   */
  private async processQueue(strategyName: string = 'adaptive') {
    if (this.processing) return;
    this.processing = true;

    const strategy = this.strategies.get(strategyName) || this.strategies.get('adaptive')!;

    while (this.requestQueue.length > 0) {
      // Sort by priority
      this.requestQueue.sort((a, b) => {
        const priorityWeight = {
          critical: 4,
          high: 3,
          normal: 2,
          low: 1
        };
        
        // Consider both priority and age of request
        const aPriority = priorityWeight[a.priority] - (Date.now() - a.timestamp) / 60000; // Reduce priority by 1 per minute
        const bPriority = priorityWeight[b.priority] - (Date.now() - b.timestamp) / 60000;
        
        return bPriority - aPriority;
      });

      const request = this.requestQueue.shift()!;
      
      // Check if we should delay based on strategy
      if (strategy.shouldDelay(this.rateLimit)) {
        const delay = strategy.calculateDelay(this.rateLimit);
        logger.info(`Rate limit strategy triggered, delaying ${delay}ms`, {
          remaining: this.rateLimit.remaining,
          strategy: strategyName
        });
        await this.sleep(delay);
      }

      // Execute the request
      const startTime = Date.now();
      try {
        this.metrics.totalRequests++;
        const result = await request.function();
        
        // Update metrics
        this.metrics.successfulRequests++;
        const responseTime = Date.now() - startTime;
        this.metrics.averageResponseTime = 
          (this.metrics.averageResponseTime * (this.metrics.successfulRequests - 1) + responseTime) / 
          this.metrics.successfulRequests;

        // Extract rate limit from response
        if (result && result.headers) {
          await this.updateRateLimit(result.headers);
        }

        request.resolve(result);
        logger.debug(`Request ${request.id} completed in ${responseTime}ms`);

      } catch (error: any) {
        this.metrics.failedRequests++;
        
        // Handle rate limit errors specially
        if (error.status === 403 && error.message.includes('rate limit')) {
          this.metrics.rateLimitHits++;
          logger.warn('Rate limit exceeded, backing off', {
            reset: this.rateLimit.reset
          });
          
          // Wait until rate limit resets
          const waitTime = this.rateLimit.reset.getTime() - Date.now();
          if (waitTime > 0) {
            await this.sleep(waitTime);
          }
          
          // Retry the request
          if (request.retries < request.maxRetries) {
            request.retries++;
            this.requestQueue.unshift(request); // Put it back at the front
            continue;
          }
        }

        // Handle other retryable errors
        if (request.retries < request.maxRetries && this.isRetryableError(error)) {
          request.retries++;
          const backoff = Math.min(1000 * Math.pow(2, request.retries), 30000);
          logger.info(`Retrying request ${request.id} after ${backoff}ms`, {
            attempt: request.retries,
            error: error.message
          });
          
          await this.sleep(backoff);
          this.requestQueue.push(request); // Put it back in queue
        } else {
          logger.error(`Request ${request.id} failed after ${request.retries} retries`, error);
          request.reject(error);
        }
      }

      // Small delay between all requests to be respectful
      await this.sleep(50);
    }

    this.processing = false;
  }

  /**
   * Update rate limit information from response headers
   */
  private async updateRateLimit(headers: any) {
    if (headers['x-ratelimit-remaining'] !== undefined) {
      const newRateLimit: RateLimitInfo = {
        remaining: parseInt(headers['x-ratelimit-remaining']),
        limit: parseInt(headers['x-ratelimit-limit']),
        reset: new Date(parseInt(headers['x-ratelimit-reset']) * 1000),
        used: parseInt(headers['x-ratelimit-used'] || '0'),
        resetIn: new Date(parseInt(headers['x-ratelimit-reset']) * 1000).getTime() - Date.now()
      };

      this.rateLimit = newRateLimit;
      
      // Save to Redis for distributed tracking
      if (this.redisClient && this.redisClient.isOpen) {
        try {
          await this.redisClient.set(
            'github:rateLimit',
            JSON.stringify({
              ...this.rateLimit,
              reset: this.rateLimit.reset.toISOString()
            }),
            { EX: 3600 } // Expire after 1 hour
          );
        } catch (error) {
          logger.error('Failed to save rate limit to Redis', error);
        }
      }

      logger.debug('Rate limit updated', this.rateLimit);
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error.status) return true; // Network errors are retryable
    
    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    return retryableStatuses.includes(error.status);
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus() {
    return {
      ...this.rateLimit,
      queueLength: this.requestQueue.length,
      metrics: { ...this.metrics },
      strategy: 'adaptive'
    };
  }

  /**
   * Pre-fetch rate limit information
   */
  async checkRateLimit(): Promise<RateLimitInfo> {
    try {
      const response = await this.request(
        () => this.octokit.rest.rateLimit.get(),
        { priority: 'low' }
      );
      
      const core = response.data.rate;
      this.rateLimit = {
        remaining: core.remaining,
        limit: core.limit,
        reset: new Date(core.reset * 1000),
        used: core.used,
        resetIn: new Date(core.reset * 1000).getTime() - Date.now()
      };
      
      return this.rateLimit;
    } catch (error) {
      logger.error('Failed to check rate limit', error);
      return this.rateLimit;
    }
  }

  /**
   * Batch multiple requests efficiently
   */
  async batchRequests<T>(
    requests: Array<{
      fn: () => Promise<T>;
      priority?: 'critical' | 'high' | 'normal' | 'low';
    }>
  ): Promise<T[]> {
    logger.info(`Batching ${requests.length} requests`);
    
    return Promise.all(
      requests.map(req => 
        this.request(req.fn, { priority: req.priority || 'normal' })
      )
    );
  }

  /**
   * Start periodic metrics reporting
   */
  private startMetricsReporting() {
    setInterval(() => {
      logger.info('GitHub API Metrics', {
        ...this.metrics,
        rateLimit: this.rateLimit,
        queueLength: this.requestQueue.length
      });
    }, 60000); // Every minute
  }

  /**
   * Predict when rate limit will be exhausted
   */
  predictRateLimitExhaustion(): Date | null {
    if (this.metrics.totalRequests === 0) return null;
    
    const elapsedTime = Date.now() - (this.rateLimit.reset.getTime() - 3600000);
    const requestRate = this.metrics.totalRequests / (elapsedTime / 1000); // requests per second
    
    if (requestRate === 0) return null;
    
    const secondsToExhaustion = this.rateLimit.remaining / requestRate;
    return new Date(Date.now() + secondsToExhaustion * 1000);
  }

  /**
   * Emergency pause - stop all requests immediately
   */
  pauseRequests() {
    logger.warn('Emergency pause activated - clearing request queue');
    const pausedRequests = [...this.requestQueue];
    this.requestQueue = [];
    
    // Reject all queued requests
    pausedRequests.forEach(req => {
      req.reject(new Error('Requests paused due to rate limit concerns'));
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get repository information with caching
   */
  async getRepository(owner: string, repo: string): Promise<any> {
    const endpoint = `repos/${owner}/${repo}`;
    return this.cachedRequest(
      endpoint,
      () => this.octokit.rest.repos.get({ owner, repo }),
      { 
        priority: 'normal',
        cacheTags: [`repo:${owner}/${repo}`, 'type:repos']
      }
    );
  }

  /**
   * List workflow runs with caching
   */
  async listWorkflowRuns(owner: string, repo: string, options: any = {}): Promise<any> {
    const endpoint = `repos/${owner}/${repo}/actions/runs`;
    return this.cachedRequest(
      endpoint,
      () => this.octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo, ...options }),
      { 
        params: options,
        priority: 'normal',
        cacheTTL: 120, // 2 minutes for dynamic data
        cacheTags: [`repo:${owner}/${repo}`, 'type:runs']
      }
    );
  }

  /**
   * Get workflow run details with caching
   */
  async getWorkflowRun(owner: string, repo: string, runId: number): Promise<any> {
    const endpoint = `repos/${owner}/${repo}/actions/runs/${runId}`;
    return this.cachedRequest(
      endpoint,
      () => this.octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId }),
      { 
        priority: 'high',
        cacheTTL: 60, // 1 minute for run details
        cacheTags: [`repo:${owner}/${repo}`, 'type:runs', `run:${runId}`]
      }
    );
  }

  /**
   * List workflow jobs with caching
   */
  async listWorkflowJobs(owner: string, repo: string, runId: number): Promise<any> {
    const endpoint = `repos/${owner}/${repo}/actions/runs/${runId}/jobs`;
    return this.cachedRequest(
      endpoint,
      () => this.octokit.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id: runId }),
      { 
        priority: 'normal',
        cacheTTL: 60, // 1 minute for job lists
        cacheTags: [`repo:${owner}/${repo}`, 'type:jobs', `run:${runId}`]
      }
    );
  }

  /**
   * List repositories for organization with caching
   */
  async listOrgRepos(org: string, options: any = {}): Promise<any> {
    const endpoint = `orgs/${org}/repos`;
    return this.cachedRequest(
      endpoint,
      () => this.octokit.rest.repos.listForOrg({ org, ...options }),
      { 
        params: options,
        priority: 'normal',
        cacheTTL: 3600, // 1 hour for org repos
        cacheTags: [`org:${org}`, 'type:repos']
      }
    );
  }

  /**
   * Invalidate cache for a specific repository
   */
  async invalidateRepositoryCache(owner: string, repo: string): Promise<void> {
    await this.cacheService.invalidateByTag(`repo:${owner}/${repo}`);
    logger.info(`Invalidated cache for repository: ${owner}/${repo}`);
  }

  /**
   * Invalidate cache for a specific organization
   */
  async invalidateOrganizationCache(org: string): Promise<void> {
    await this.cacheService.invalidateByTag(`org:${org}`);
    logger.info(`Invalidated cache for organization: ${org}`);
  }

  /**
   * Handle webhook event for cache invalidation
   */
  async handleWebhookEvent(event: string, payload: any): Promise<void> {
    const webhookEvent = {
      event,
      repository: payload.repository?.full_name,
      organization: payload.organization?.login,
      action: payload.action,
      timestamp: Date.now()
    };

    await this.cacheService.publishWebhookEvent(webhookEvent);
  }

  /**
   * Get combined metrics including cache
   */
  getCombinedMetrics(): any {
    const cacheMetrics = this.cacheService.getMetrics();
    return {
      api: {
        ...this.metrics,
        rateLimit: this.rateLimit,
        queueLength: this.requestQueue.length
      },
      cache: cacheMetrics
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    // Cleanup cache service
    await this.cacheService.cleanup();

    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.quit();
    }
    
    // Clear any pending requests
    this.requestQueue.forEach(req => {
      req.reject(new Error('Service shutting down'));
    });
    this.requestQueue = [];
    
    logger.info('GitHub API Enhanced service cleaned up');
  }
}

// Singleton instance
let instance: GitHubAPIEnhanced | null = null;

export function getGitHubAPIClient(): GitHubAPIEnhanced {
  if (!instance) {
    instance = new GitHubAPIEnhanced();
  }
  return instance;
}

export default GitHubAPIEnhanced;