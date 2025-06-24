import * as redis from 'redis';
import { createLogger } from '../utils/logger';
import config from '../config';
import crypto from 'crypto';

const logger = createLogger('GitHubCacheService');

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Tags for invalidation
  priority?: 'high' | 'normal' | 'low'; // Cache priority
}

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
  tags: string[];
  hits: number;
  lastAccessed: number;
  size: number;
}

interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  totalSize: number;
  hitRate: number;
  avgResponseTime: number;
  cacheEntries: number;
  webhookInvalidations: number;
}

interface WebhookEvent {
  event: string;
  repository?: string;
  organization?: string;
  action?: string;
  timestamp: number;
}

export class GitHubCacheService {
  private redisClient!: redis.RedisClientType;
  private pubClient!: redis.RedisClientType;
  private subClient!: redis.RedisClientType;
  private connected = false;
  private metrics: CacheMetrics;
  private defaultTTL = 300; // 5 minutes default
  private maxCacheSize = 1024 * 1024 * 100; // 100MB
  private evictionPolicy: 'lru' | 'lfu' | 'ttl' = 'lru';
  
  // TTL configuration for different resource types
  private ttlConfig = {
    // Static data - longer TTL
    'repos': 3600,              // 1 hour
    'orgs': 3600,               // 1 hour
    'users': 3600,              // 1 hour
    
    // Dynamic data - shorter TTL
    'issues': 300,              // 5 minutes
    'pulls': 300,               // 5 minutes
    'workflows': 180,           // 3 minutes
    'runs': 120,                // 2 minutes
    'jobs': 120,                // 2 minutes
    'artifacts': 600,           // 10 minutes
    
    // Real-time data - very short TTL
    'status': 60,               // 1 minute
    'rate_limit': 60,           // 1 minute
    'events': 60,               // 1 minute
  };

  constructor() {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalSize: 0,
      hitRate: 0,
      avgResponseTime: 0,
      cacheEntries: 0,
      webhookInvalidations: 0
    };
    
    this.initializeRedis();
  }

  private async initializeRedis() {
    try {
      // Main client for cache operations
      this.redisClient = redis.createClient({
        url: `redis://${config.redis.host}:${config.redis.port}`,
        password: config.redis.password,
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
        }
      });

      // Pub client for publishing invalidation events
      this.pubClient = redis.createClient({
        url: `redis://${config.redis.host}:${config.redis.port}`,
        password: config.redis.password
      });

      // Sub client for subscribing to invalidation events
      this.subClient = redis.createClient({
        url: `redis://${config.redis.host}:${config.redis.port}`,
        password: config.redis.password
      });

      await Promise.all([
        this.redisClient.connect(),
        this.pubClient.connect(),
        this.subClient.connect()
      ]);

      // Subscribe to webhook invalidation events
      await this.subClient.subscribe('github:webhook:*', (message, channel) => {
        this.handleWebhookInvalidation(channel, message);
      });

      // Subscribe to cache invalidation events
      await this.subClient.subscribe('cache:invalidate:*', (message, channel) => {
        this.handleCacheInvalidation(channel, message);
      });

      this.connected = true;
      logger.info('GitHub Cache Service connected to Redis');

      // Load metrics from Redis
      await this.loadMetrics();

      // Start metrics reporting
      this.startMetricsReporting();

      // Start cache maintenance
      this.startCacheMaintenance();

    } catch (error) {
      logger.error('Failed to initialize Redis connection', error);
      this.connected = false;
    }
  }

  /**
   * Generate cache key from request details
   */
  private generateCacheKey(endpoint: string, params?: any): string {
    const normalizedParams = params ? this.normalizeParams(params) : {};
    const keyData = {
      endpoint,
      params: normalizedParams
    };
    
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(keyData))
      .digest('hex');
    
    return `github:cache:${endpoint}:${hash}`;
  }

  /**
   * Normalize parameters for consistent cache keys
   */
  private normalizeParams(params: any): any {
    const normalized: any = {};
    const keys = Object.keys(params).sort();
    
    for (const key of keys) {
      if (params[key] !== undefined && params[key] !== null) {
        normalized[key] = params[key];
      }
    }
    
    return normalized;
  }

  /**
   * Get TTL for a specific endpoint
   */
  private getTTLForEndpoint(endpoint: string): number {
    for (const [resource, ttl] of Object.entries(this.ttlConfig)) {
      if (endpoint.includes(resource)) {
        return ttl;
      }
    }
    return this.defaultTTL;
  }

  /**
   * Get cached data
   */
  async get(endpoint: string, params?: any): Promise<any | null> {
    if (!this.connected) return null;

    const startTime = Date.now();
    const key = this.generateCacheKey(endpoint, params);

    try {
      const cached = await this.redisClient.get(key);
      
      if (cached) {
        const entry: CacheEntry = JSON.parse(cached);
        
        // Check if entry is still valid
        const now = Date.now();
        const age = (now - entry.timestamp) / 1000;
        
        if (age < entry.ttl) {
          // Update metrics
          this.metrics.hits++;
          entry.hits++;
          entry.lastAccessed = now;
          
          // Update hit count in Redis
          await this.redisClient.setEx(key, entry.ttl, JSON.stringify(entry));
          
          const responseTime = Date.now() - startTime;
          this.updateAvgResponseTime(responseTime);
          
          logger.debug(`Cache hit for ${endpoint}`, {
            age: Math.round(age),
            ttl: entry.ttl,
            hits: entry.hits
          });
          
          return entry.data;
        } else {
          // Entry expired, remove it
          await this.redisClient.del(key);
          this.metrics.evictions++;
        }
      }
      
      this.metrics.misses++;
      logger.debug(`Cache miss for ${endpoint}`);
      return null;
      
    } catch (error) {
      logger.error(`Cache get error for ${endpoint}`, error);
      return null;
    }
  }

  /**
   * Set cached data
   */
  async set(
    endpoint: string, 
    data: any, 
    params?: any, 
    options: CacheOptions = {}
  ): Promise<void> {
    if (!this.connected) return;

    const key = this.generateCacheKey(endpoint, params);
    const ttl = options.ttl || this.getTTLForEndpoint(endpoint);
    const tags = options.tags || this.extractTagsFromEndpoint(endpoint, params);

    try {
      const size = Buffer.byteLength(JSON.stringify(data));
      
      // Check cache size limits
      if (await this.shouldEvict(size)) {
        await this.evictEntries(size);
      }

      const entry: CacheEntry = {
        data,
        timestamp: Date.now(),
        ttl,
        tags,
        hits: 0,
        lastAccessed: Date.now(),
        size
      };

      await this.redisClient.setEx(key, ttl, JSON.stringify(entry));
      
      // Store tags for invalidation
      for (const tag of tags) {
        await this.redisClient.sAdd(`github:cache:tag:${tag}`, key);
        await this.redisClient.expire(`github:cache:tag:${tag}`, ttl);
      }

      // Update metrics
      this.metrics.cacheEntries++;
      this.metrics.totalSize += size;

      logger.debug(`Cached data for ${endpoint}`, {
        ttl,
        size,
        tags
      });

    } catch (error) {
      logger.error(`Cache set error for ${endpoint}`, error);
    }
  }

  /**
   * Invalidate cache entries by tag
   */
  async invalidateByTag(tag: string): Promise<number> {
    if (!this.connected) return 0;

    try {
      const keys = await this.redisClient.sMembers(`github:cache:tag:${tag}`);
      
      if (keys.length > 0) {
        await this.redisClient.del(keys);
        await this.redisClient.del(`github:cache:tag:${tag}`);
        
        logger.info(`Invalidated ${keys.length} cache entries with tag: ${tag}`);
        return keys.length;
      }
      
      return 0;
    } catch (error) {
      logger.error(`Failed to invalidate cache by tag: ${tag}`, error);
      return 0;
    }
  }

  /**
   * Invalidate cache entries by pattern
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    if (!this.connected) return 0;

    try {
      const keys: string[] = [];
      let cursor = 0;
      
      do {
        const result = await this.redisClient.scan(cursor, {
          MATCH: `github:cache:${pattern}*`,
          COUNT: 100
        });
        
        cursor = result.cursor;
        keys.push(...result.keys);
      } while (cursor !== 0);

      if (keys.length > 0) {
        await this.redisClient.del(keys);
        logger.info(`Invalidated ${keys.length} cache entries matching pattern: ${pattern}`);
        return keys.length;
      }

      return 0;
    } catch (error) {
      logger.error(`Failed to invalidate cache by pattern: ${pattern}`, error);
      return 0;
    }
  }

  /**
   * Handle webhook invalidation events
   */
  private async handleWebhookInvalidation(_channel: string, message: string) {
    try {
      const event: WebhookEvent = JSON.parse(message);
      logger.info('Received webhook invalidation event', event);

      this.metrics.webhookInvalidations++;

      // Determine what to invalidate based on the webhook event
      const invalidationRules = this.getInvalidationRules(event);
      
      for (const rule of invalidationRules) {
        if (rule.tag) {
          await this.invalidateByTag(rule.tag);
        }
        if (rule.pattern) {
          await this.invalidateByPattern(rule.pattern);
        }
      }

    } catch (error) {
      logger.error('Failed to handle webhook invalidation', error);
    }
  }

  /**
   * Get invalidation rules based on webhook event
   */
  private getInvalidationRules(event: WebhookEvent): Array<{ tag?: string; pattern?: string }> {
    const rules: Array<{ tag?: string; pattern?: string }> = [];

    // Repository events
    if (event.repository) {
      rules.push({ tag: `repo:${event.repository}` });
      rules.push({ pattern: `repos/${event.repository}` });
    }

    // Organization events
    if (event.organization) {
      rules.push({ tag: `org:${event.organization}` });
      rules.push({ pattern: `orgs/${event.organization}` });
    }

    // Specific event type rules
    switch (event.event) {
      case 'push':
        if (event.repository) {
          rules.push({ pattern: `repos/${event.repository}/commits` });
          rules.push({ pattern: `repos/${event.repository}/branches` });
        }
        break;

      case 'pull_request':
        if (event.repository) {
          rules.push({ pattern: `repos/${event.repository}/pulls` });
          rules.push({ pattern: `repos/${event.repository}/issues` });
        }
        break;

      case 'workflow_run':
        if (event.repository) {
          rules.push({ pattern: `repos/${event.repository}/actions/runs` });
          rules.push({ pattern: `repos/${event.repository}/actions/workflows` });
        }
        break;

      case 'issues':
        if (event.repository) {
          rules.push({ pattern: `repos/${event.repository}/issues` });
        }
        break;

      case 'release':
        if (event.repository) {
          rules.push({ pattern: `repos/${event.repository}/releases` });
        }
        break;
    }

    return rules;
  }

  /**
   * Handle cache invalidation events
   */
  private async handleCacheInvalidation(_channel: string, message: string) {
    try {
      const { type, target } = JSON.parse(message);
      
      switch (type) {
        case 'tag':
          await this.invalidateByTag(target);
          break;
        case 'pattern':
          await this.invalidateByPattern(target);
          break;
        case 'all':
          await this.clearAll();
          break;
      }
    } catch (error) {
      logger.error('Failed to handle cache invalidation', error);
    }
  }

  /**
   * Extract tags from endpoint and params
   */
  private extractTagsFromEndpoint(endpoint: string, _params?: any): string[] {
    const tags: string[] = [];

    // Extract repository info
    const repoMatch = endpoint.match(/repos\/([^/]+\/[^/]+)/);
    if (repoMatch) {
      tags.push(`repo:${repoMatch[1]}`);
    }

    // Extract organization info
    const orgMatch = endpoint.match(/orgs\/([^/]+)/);
    if (orgMatch) {
      tags.push(`org:${orgMatch[1]}`);
    }

    // Extract user info
    const userMatch = endpoint.match(/users\/([^/]+)/);
    if (userMatch) {
      tags.push(`user:${userMatch[1]}`);
    }

    // Add resource type tag
    const resourceTypes = ['repos', 'issues', 'pulls', 'workflows', 'runs', 'jobs'];
    for (const type of resourceTypes) {
      if (endpoint.includes(type)) {
        tags.push(`type:${type}`);
        break;
      }
    }

    return tags;
  }

  /**
   * Check if eviction is needed
   */
  private async shouldEvict(newSize: number): Promise<boolean> {
    const currentSize = await this.getCurrentCacheSize();
    return currentSize + newSize > this.maxCacheSize;
  }

  /**
   * Evict cache entries based on policy
   */
  private async evictEntries(requiredSpace: number): Promise<void> {
    logger.info(`Evicting cache entries to free ${requiredSpace} bytes`);

    try {
      const keys = await this.getAllCacheKeys();
      const entries: Array<{ key: string; entry: CacheEntry }> = [];

      // Load all entries
      for (const key of keys) {
        const data = await this.redisClient.get(key);
        if (data) {
          entries.push({ key, entry: JSON.parse(data) });
        }
      }

      // Sort based on eviction policy
      switch (this.evictionPolicy) {
        case 'lru':
          entries.sort((a, b) => a.entry.lastAccessed - b.entry.lastAccessed);
          break;
        case 'lfu':
          entries.sort((a, b) => a.entry.hits - b.entry.hits);
          break;
        case 'ttl':
          entries.sort((a, b) => 
            (a.entry.timestamp + a.entry.ttl * 1000) - 
            (b.entry.timestamp + b.entry.ttl * 1000)
          );
          break;
      }

      // Evict entries until we have enough space
      let freedSpace = 0;
      const keysToDelete: string[] = [];

      for (const { key, entry } of entries) {
        keysToDelete.push(key);
        freedSpace += entry.size;
        this.metrics.evictions++;

        if (freedSpace >= requiredSpace) {
          break;
        }
      }

      if (keysToDelete.length > 0) {
        await this.redisClient.del(keysToDelete);
        logger.info(`Evicted ${keysToDelete.length} cache entries, freed ${freedSpace} bytes`);
      }

    } catch (error) {
      logger.error('Failed to evict cache entries', error);
    }
  }

  /**
   * Get all cache keys
   */
  private async getAllCacheKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = 0;
    
    do {
      const result = await this.redisClient.scan(cursor, {
        MATCH: 'github:cache:*',
        COUNT: 100
      });
      
      cursor = result.cursor;
      for (const key of result.keys) {
        if (!key.includes(':tag:')) {
          keys.push(key);
        }
      }
    } while (cursor !== 0);

    return keys;
  }

  /**
   * Get current cache size
   */
  private async getCurrentCacheSize(): Promise<number> {
    const keys = await this.getAllCacheKeys();
    let totalSize = 0;

    for (const key of keys) {
      const data = await this.redisClient.get(key);
      if (data) {
        const entry: CacheEntry = JSON.parse(data);
        totalSize += entry.size;
      }
    }

    return totalSize;
  }

  /**
   * Clear all cache entries
   */
  async clearAll(): Promise<void> {
    if (!this.connected) return;

    try {
      const keys = await this.getAllCacheKeys();
      
      if (keys.length > 0) {
        await this.redisClient.del(keys);
        
        // Clear all tags
        const tagKeys: string[] = [];
        let tagCursor = 0;
        
        do {
          const result = await this.redisClient.scan(tagCursor, {
            MATCH: 'github:cache:tag:*',
            COUNT: 100
          });
          
          tagCursor = result.cursor;
          tagKeys.push(...result.keys);
        } while (tagCursor !== 0);

        if (tagKeys.length > 0) {
          await this.redisClient.del(tagKeys);
        }

        logger.info(`Cleared ${keys.length} cache entries`);
      }

      // Reset metrics
      this.metrics.cacheEntries = 0;
      this.metrics.totalSize = 0;

    } catch (error) {
      logger.error('Failed to clear cache', error);
    }
  }

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics {
    const hitRate = this.metrics.hits + this.metrics.misses > 0
      ? this.metrics.hits / (this.metrics.hits + this.metrics.misses)
      : 0;

    return {
      ...this.metrics,
      hitRate
    };
  }

  /**
   * Load metrics from Redis
   */
  private async loadMetrics(): Promise<void> {
    try {
      const metricsData = await this.redisClient.get('github:cache:metrics');
      if (metricsData) {
        this.metrics = JSON.parse(metricsData);
        logger.info('Loaded cache metrics from Redis', this.metrics);
      }
    } catch (error) {
      logger.error('Failed to load metrics', error);
    }
  }

  /**
   * Save metrics to Redis
   */
  private async saveMetrics(): Promise<void> {
    try {
      await this.redisClient.set(
        'github:cache:metrics',
        JSON.stringify(this.metrics),
        { EX: 86400 } // 24 hours
      );
    } catch (error) {
      logger.error('Failed to save metrics', error);
    }
  }

  /**
   * Update average response time
   */
  private updateAvgResponseTime(responseTime: number): void {
    const totalRequests = this.metrics.hits + this.metrics.misses;
    this.metrics.avgResponseTime = 
      (this.metrics.avgResponseTime * (totalRequests - 1) + responseTime) / totalRequests;
  }

  /**
   * Start metrics reporting
   */
  private startMetricsReporting(): void {
    // Report metrics every minute
    setInterval(async () => {
      const metrics = this.getMetrics();
      logger.info('GitHub Cache Metrics', metrics);
      
      // Save metrics to Redis
      await this.saveMetrics();
      
      // Publish metrics for monitoring
      if (this.pubClient.isOpen) {
        await this.pubClient.publish(
          'metrics:github:cache',
          JSON.stringify(metrics)
        );
      }
    }, 60000);
  }

  /**
   * Start cache maintenance
   */
  private startCacheMaintenance(): void {
    // Run maintenance every 5 minutes
    setInterval(async () => {
      try {
        // Update cache entry count and size
        const keys = await this.getAllCacheKeys();
        this.metrics.cacheEntries = keys.length;
        this.metrics.totalSize = await this.getCurrentCacheSize();
        
        // Clean up expired tags
        const tagKeys: string[] = [];
        let tagCursor = 0;
        
        do {
          const result = await this.redisClient.scan(tagCursor, {
            MATCH: 'github:cache:tag:*',
            COUNT: 100
          });
          
          tagCursor = result.cursor;
          tagKeys.push(...result.keys);
        } while (tagCursor !== 0);

        for (const tagKey of tagKeys) {
          const members = await this.redisClient.sMembers(tagKey);
          const validMembers: string[] = [];
          
          for (const member of members) {
            if (await this.redisClient.exists(member)) {
              validMembers.push(member);
            }
          }
          
          if (validMembers.length !== members.length) {
            await this.redisClient.del(tagKey);
            if (validMembers.length > 0) {
              await this.redisClient.sAdd(tagKey, validMembers);
            }
          }
        }
        
        logger.debug('Cache maintenance completed', {
          entries: this.metrics.cacheEntries,
          size: this.metrics.totalSize
        });
        
      } catch (error) {
        logger.error('Cache maintenance failed', error);
      }
    }, 300000); // 5 minutes
  }

  /**
   * Warm up cache with frequently accessed data
   */
  async warmUp(endpoints: Array<{ endpoint: string; params?: any }>): Promise<void> {
    logger.info(`Warming up cache with ${endpoints.length} endpoints`);
    
    for (const { endpoint, params } of endpoints) {
      const cached = await this.get(endpoint, params);
      if (!cached) {
        logger.debug(`Cache miss during warmup: ${endpoint}`);
      }
    }
  }

  /**
   * Publish webhook event for cache invalidation
   */
  async publishWebhookEvent(event: WebhookEvent): Promise<void> {
    if (!this.connected || !this.pubClient.isOpen) return;

    try {
      await this.pubClient.publish(
        `github:webhook:${event.event}`,
        JSON.stringify(event)
      );
      
      logger.debug('Published webhook event for cache invalidation', event);
    } catch (error) {
      logger.error('Failed to publish webhook event', error);
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.connected) {
      await this.saveMetrics();
      
      await Promise.all([
        this.redisClient.quit(),
        this.pubClient.quit(),
        this.subClient.quit()
      ]);
      
      this.connected = false;
      logger.info('GitHub Cache Service cleaned up');
    }
  }
}

// Singleton instance
let instance: GitHubCacheService | null = null;

export function getGitHubCacheService(): GitHubCacheService {
  if (!instance) {
    instance = new GitHubCacheService();
  }
  return instance;
}

export default GitHubCacheService;