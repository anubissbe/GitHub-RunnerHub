/**
 * Advanced Cache Manager
 * Multi-layer caching system for optimizing GitHub-RunnerHub performance
 */

const EventEmitter = require('events');
const Redis = require('ioredis');
const LRU = require('lru-cache');
const logger = require('../../utils/logger');

class AdvancedCacheManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Redis configuration
      redis: {
        host: options.redisHost || process.env.REDIS_HOST || 'localhost',
        port: options.redisPort || process.env.REDIS_PORT || 6379,
        password: options.redisPassword || process.env.REDIS_PASSWORD,
        db: options.redisDb || 1,
        keyPrefix: 'runnerhub:cache:',
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      },
      
      // Memory cache configuration
      memoryCache: {
        max: options.memoryCacheSize || 1000,
        ttl: options.memoryCacheTtl || 300000, // 5 minutes
        allowStale: false,
        updateAgeOnGet: true
      },
      
      // Cache layers configuration
      layers: {
        l1: { type: 'memory', ttl: 60000 },      // 1 minute - hot data
        l2: { type: 'redis', ttl: 3600000 },     // 1 hour - warm data
        l3: { type: 'redis', ttl: 86400000 }     // 24 hours - cold data
      },
      
      // Specialized caches
      cacheTypes: {
        // GitHub API responses
        githubApi: {
          enabled: options.enableGithubApiCache !== false,
          defaultTtl: 300000, // 5 minutes
          maxSize: 500,
          compression: true
        },
        
        // Container configurations
        containerConfig: {
          enabled: options.enableContainerConfigCache !== false,
          defaultTtl: 1800000, // 30 minutes
          maxSize: 200,
          compression: false
        },
        
        // Docker image metadata
        dockerImages: {
          enabled: options.enableDockerImageCache !== false,
          defaultTtl: 3600000, // 1 hour
          maxSize: 100,
          compression: true
        },
        
        // Job execution results
        jobResults: {
          enabled: options.enableJobResultsCache !== false,
          defaultTtl: 7200000, // 2 hours
          maxSize: 1000,
          compression: true
        },
        
        // Performance metrics
        performanceMetrics: {
          enabled: options.enablePerformanceMetricsCache !== false,
          defaultTtl: 900000, // 15 minutes
          maxSize: 300,
          compression: false
        },
        
        // Network topology
        networkTopology: {
          enabled: options.enableNetworkTopologyCache !== false,
          defaultTtl: 1800000, // 30 minutes
          maxSize: 50,
          compression: false
        }
      },
      
      // Performance optimization
      enableCompression: options.enableCompression !== false,
      enablePreloading: options.enablePreloading !== false,
      enablePrefetching: options.enablePrefetching !== false,
      enableInvalidation: options.enableInvalidation !== false,
      
      // Monitoring
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 60000,
      
      ...options
    };
    
    // Initialize cache instances
    this.redisClient = null;
    this.memoryCaches = new Map();
    this.compressionCache = new Map();
    
    // Cache statistics
    this.stats = {
      hits: { l1: 0, l2: 0, l3: 0, total: 0 },
      misses: { l1: 0, l2: 0, l3: 0, total: 0 },
      evictions: 0,
      errors: 0,
      compressionSavings: 0,
      lastReset: new Date()
    };
    
    // Prefetching system
    this.prefetchQueue = new Map();
    this.preloadPatterns = new Map();
    
    this.isInitialized = false;
    this.metricsTimer = null;
  }

  /**
   * Initialize the cache manager
   */
  async initialize() {
    try {
      logger.info('Initializing Advanced Cache Manager');
      
      // Initialize Redis connection
      await this.initializeRedis();
      
      // Initialize memory caches for each type
      await this.initializeMemoryCaches();
      
      // Set up cache warming
      if (this.config.enablePreloading) {
        await this.initializeCacheWarming();
      }
      
      // Start metrics collection
      if (this.config.enableMetrics) {
        this.startMetricsCollection();
      }
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Advanced Cache Manager initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Advanced Cache Manager:', error);
      throw error;
    }
  }

  /**
   * Initialize Redis connection
   */
  async initializeRedis() {
    try {
      this.redisClient = new Redis(this.config.redis);
      
      this.redisClient.on('connect', () => {
        logger.debug('Redis cache connected');
      });
      
      this.redisClient.on('error', (error) => {
        logger.error('Redis cache error:', error);
        this.stats.errors++;
      });
      
      this.redisClient.on('reconnecting', () => {
        logger.warn('Redis cache reconnecting');
      });
      
      // Test connection
      await this.redisClient.ping();
      logger.info('Redis cache connection established');
      
    } catch (error) {
      logger.warn('Redis not available, using memory-only caching:', error.message);
      this.redisClient = null;
    }
  }

  /**
   * Initialize memory caches for each cache type
   */
  async initializeMemoryCaches() {
    for (const [cacheType, config] of Object.entries(this.config.cacheTypes)) {
      if (config.enabled) {
        const cacheOptions = {
          max: config.maxSize || this.config.memoryCache.max,
          ttl: config.defaultTtl || this.config.memoryCache.ttl,
          allowStale: false,
          updateAgeOnGet: true,
          dispose: (value, key) => {
            this.stats.evictions++;
            this.emit('cacheEviction', { cacheType, key });
          }
        };
        
        this.memoryCaches.set(cacheType, new LRU(cacheOptions));
        logger.debug(`Memory cache initialized for type: ${cacheType}`);
      }
    }
    
    logger.info(`Memory caches initialized: ${this.memoryCaches.size} types`);
  }

  /**
   * Initialize cache warming strategies
   */
  async initializeCacheWarming() {
    // Pre-load common GitHub API endpoints
    this.preloadPatterns.set('github-repos', {
      pattern: /^github:repos:/,
      preloadFunction: this.preloadGithubRepos.bind(this)
    });
    
    // Pre-load container configurations
    this.preloadPatterns.set('container-configs', {
      pattern: /^container:config:/,
      preloadFunction: this.preloadContainerConfigs.bind(this)
    });
    
    // Pre-load Docker image metadata
    this.preloadPatterns.set('docker-images', {
      pattern: /^docker:images:/,
      preloadFunction: this.preloadDockerImages.bind(this)
    });
    
    logger.info('Cache warming patterns initialized');
  }

  /**
   * Get value from cache with multi-layer fallback
   */
  async get(key, cacheType = 'default') {
    try {
      const fullKey = this.buildCacheKey(key, cacheType);
      
      // L1 Cache (Memory) - fastest access
      const l1Result = await this.getFromL1(fullKey, cacheType);
      if (l1Result !== null) {
        this.stats.hits.l1++;
        this.stats.hits.total++;
        this.emit('cacheHit', { layer: 'l1', key: fullKey, cacheType });
        return l1Result;
      }
      this.stats.misses.l1++;
      
      // L2 Cache (Redis) - medium latency
      const l2Result = await this.getFromL2(fullKey, cacheType);
      if (l2Result !== null) {
        this.stats.hits.l2++;
        this.stats.hits.total++;
        
        // Promote to L1
        await this.setInL1(fullKey, l2Result, cacheType);
        
        this.emit('cacheHit', { layer: 'l2', key: fullKey, cacheType });
        return l2Result;
      }
      this.stats.misses.l2++;
      
      // L3 Cache (Redis with longer TTL) - highest latency but largest capacity
      const l3Result = await this.getFromL3(fullKey, cacheType);
      if (l3Result !== null) {
        this.stats.hits.l3++;
        this.stats.hits.total++;
        
        // Promote to L2 and L1
        await Promise.all([
          this.setInL1(fullKey, l3Result, cacheType),
          this.setInL2(fullKey, l3Result, cacheType)
        ]);
        
        this.emit('cacheHit', { layer: 'l3', key: fullKey, cacheType });
        return l3Result;
      }
      this.stats.misses.l3++;
      this.stats.misses.total++;
      
      this.emit('cacheMiss', { key: fullKey, cacheType });
      return null;
      
    } catch (error) {
      logger.error(`Cache get error for key ${key}:`, error);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Set value in cache across all appropriate layers
   */
  async set(key, value, cacheType = 'default', options = {}) {
    try {
      const fullKey = this.buildCacheKey(key, cacheType);
      const cacheConfig = this.config.cacheTypes[cacheType] || {};
      
      // Compress if enabled and beneficial
      let processedValue = value;
      if (this.config.enableCompression && cacheConfig.compression) {
        processedValue = await this.compressValue(value);
      }
      
      // Store in all appropriate layers
      const promises = [];
      
      // L1 (Memory)
      promises.push(this.setInL1(fullKey, processedValue, cacheType, options));
      
      // L2 (Redis) if available
      if (this.redisClient) {
        promises.push(this.setInL2(fullKey, processedValue, cacheType, options));
      }
      
      // L3 (Redis with longer TTL) if specified
      if (options.longTerm) {
        promises.push(this.setInL3(fullKey, processedValue, cacheType, options));
      }
      
      await Promise.allSettled(promises);
      
      // Trigger prefetching for related keys
      if (this.config.enablePrefetching) {
        this.schedulePrefetch(key, cacheType);
      }
      
      this.emit('cacheSet', { key: fullKey, cacheType, layers: promises.length });
      
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
      this.stats.errors++;
    }
  }

  /**
   * Delete value from all cache layers
   */
  async delete(key, cacheType = 'default') {
    try {
      const fullKey = this.buildCacheKey(key, cacheType);
      
      const promises = [];
      
      // Remove from memory cache
      const memoryCache = this.memoryCaches.get(cacheType);
      if (memoryCache) {
        memoryCache.delete(fullKey);
      }
      
      // Remove from Redis
      if (this.redisClient) {
        promises.push(this.redisClient.del(fullKey));
        promises.push(this.redisClient.del(`${fullKey}:l3`));
      }
      
      await Promise.allSettled(promises);
      
      this.emit('cacheDelete', { key: fullKey, cacheType });
      
    } catch (error) {
      logger.error(`Cache delete error for key ${key}:`, error);
      this.stats.errors++;
    }
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  async invalidatePattern(pattern, cacheType = 'default') {
    if (!this.config.enableInvalidation) return;
    
    try {
      const promises = [];
      
      // Invalidate memory caches
      const memoryCache = this.memoryCaches.get(cacheType);
      if (memoryCache) {
        for (const key of memoryCache.keys()) {
          if (pattern.test(key)) {
            memoryCache.delete(key);
          }
        }
      }
      
      // Invalidate Redis cache
      if (this.redisClient) {
        const keys = await this.redisClient.keys(`${this.config.redis.keyPrefix}*`);
        const matchingKeys = keys.filter(key => pattern.test(key));
        
        if (matchingKeys.length > 0) {
          promises.push(this.redisClient.del(...matchingKeys));
        }
      }
      
      await Promise.allSettled(promises);
      
      this.emit('cacheInvalidation', { pattern: pattern.toString(), cacheType, keysInvalidated: promises.length });
      
    } catch (error) {
      logger.error('Cache pattern invalidation error:', error);
      this.stats.errors++;
    }
  }

  /**
   * L1 Cache operations (Memory)
   */
  async getFromL1(key, cacheType) {
    const memoryCache = this.memoryCaches.get(cacheType);
    if (!memoryCache) return null;
    
    const value = memoryCache.get(key);
    return value !== undefined ? value : null;
  }

  async setInL1(key, value, cacheType, options = {}) {
    const memoryCache = this.memoryCaches.get(cacheType);
    if (!memoryCache) return;
    
    const ttl = options.ttl || this.config.layers.l1.ttl;
    memoryCache.set(key, value, { ttl });
  }

  /**
   * L2 Cache operations (Redis)
   */
  async getFromL2(key, _cacheType) {
    if (!this.redisClient) return null;
    
    try {
      const value = await this.redisClient.get(key);
      return value ? await this.decompressValue(value) : null;
    } catch (error) {
      logger.debug(`L2 cache get error: ${error.message}`);
      return null;
    }
  }

  async setInL2(key, value, cacheType, options = {}) {
    if (!this.redisClient) return;
    
    try {
      const ttl = options.ttl || this.config.layers.l2.ttl;
      await this.redisClient.setex(key, Math.floor(ttl / 1000), JSON.stringify(value));
    } catch (error) {
      logger.debug(`L2 cache set error: ${error.message}`);
    }
  }

  /**
   * L3 Cache operations (Redis with long TTL)
   */
  async getFromL3(key, _cacheType) {
    if (!this.redisClient) return null;
    
    try {
      const l3Key = `${key}:l3`;
      const value = await this.redisClient.get(l3Key);
      return value ? await this.decompressValue(value) : null;
    } catch (error) {
      logger.debug(`L3 cache get error: ${error.message}`);
      return null;
    }
  }

  async setInL3(key, value, cacheType, options = {}) {
    if (!this.redisClient) return;
    
    try {
      const l3Key = `${key}:l3`;
      const ttl = options.ttl || this.config.layers.l3.ttl;
      await this.redisClient.setex(l3Key, Math.floor(ttl / 1000), JSON.stringify(value));
    } catch (error) {
      logger.debug(`L3 cache set error: ${error.message}`);
    }
  }

  /**
   * Build cache key with proper namespacing
   */
  buildCacheKey(key, cacheType) {
    return `${cacheType}:${key}`;
  }

  /**
   * Compress value for storage
   */
  async compressValue(value) {
    if (typeof value !== 'string') {
      value = JSON.stringify(value);
    }
    
    if (value.length < 1024) {
      return value; // Don't compress small values
    }
    
    try {
      const zlib = require('zlib');
      const compressed = zlib.gzipSync(value);
      
      if (compressed.length < value.length * 0.8) {
        this.stats.compressionSavings += value.length - compressed.length;
        return {
          compressed: true,
          data: compressed.toString('base64')
        };
      }
      
      return value;
    } catch (error) {
      logger.debug('Compression failed:', error.message);
      return value;
    }
  }

  /**
   * Decompress value from storage
   */
  async decompressValue(value) {
    try {
      const parsed = JSON.parse(value);
      
      if (parsed && parsed.compressed) {
        const zlib = require('zlib');
        const decompressed = zlib.gunzipSync(Buffer.from(parsed.data, 'base64'));
        return JSON.parse(decompressed.toString());
      }
      
      return parsed;
    } catch (error) {
      // Fallback to raw value if decompression fails
      return value;
    }
  }

  /**
   * Schedule prefetch for related keys
   */
  schedulePrefetch(key, cacheType) {
    const prefetchKey = `${cacheType}:${key}`;
    
    if (this.prefetchQueue.has(prefetchKey)) return;
    
    this.prefetchQueue.set(prefetchKey, {
      key,
      cacheType,
      scheduledAt: new Date()
    });
    
    // Process prefetch queue
    setImmediate(() => this.processPrefetchQueue());
  }

  /**
   * Process prefetch queue
   */
  async processPrefetchQueue() {
    const batchSize = 5;
    const entries = Array.from(this.prefetchQueue.entries()).slice(0, batchSize);
    
    for (const [prefetchKey, { key, cacheType }] of entries) {
      try {
        // Check if we have a preload function for this pattern
        for (const [_patternName, { pattern, preloadFunction }] of this.preloadPatterns.entries()) {
          if (pattern.test(key)) {
            await preloadFunction(key, cacheType);
            break;
          }
        }
        
        this.prefetchQueue.delete(prefetchKey);
      } catch (error) {
        logger.debug(`Prefetch failed for ${key}:`, error.message);
        this.prefetchQueue.delete(prefetchKey);
      }
    }
  }

  /**
   * Preload GitHub repositories data
   */
  async preloadGithubRepos(key, cacheType) {
    // Implementation would depend on GitHub API service
    logger.debug(`Preloading GitHub repos for key: ${key}`);
  }

  /**
   * Preload container configurations
   */
  async preloadContainerConfigs(key, cacheType) {
    // Implementation would depend on container configuration service
    logger.debug(`Preloading container configs for key: ${key}`);
  }

  /**
   * Preload Docker images metadata
   */
  async preloadDockerImages(key, cacheType) {
    // Implementation would depend on Docker service
    logger.debug(`Preloading Docker images for key: ${key}`);
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    this.metricsTimer = setInterval(() => {
      this.collectMetrics();
    }, this.config.metricsInterval);
  }

  /**
   * Collect and emit cache metrics
   */
  collectMetrics() {
    const metrics = {
      ...this.stats,
      hitRatio: {
        l1: this.stats.hits.l1 / (this.stats.hits.l1 + this.stats.misses.l1) || 0,
        l2: this.stats.hits.l2 / (this.stats.hits.l2 + this.stats.misses.l2) || 0,
        l3: this.stats.hits.l3 / (this.stats.hits.l3 + this.stats.misses.l3) || 0,
        total: this.stats.hits.total / (this.stats.hits.total + this.stats.misses.total) || 0
      },
      memoryCacheStats: {},
      redisStats: null
    };
    
    // Collect memory cache statistics
    for (const [cacheType, cache] of this.memoryCaches.entries()) {
      metrics.memoryCacheStats[cacheType] = {
        size: cache.size,
        max: cache.max,
        calculatedSize: cache.calculatedSize
      };
    }
    
    // Collect Redis statistics if available
    if (this.redisClient) {
      this.redisClient.info('memory').then(info => {
        metrics.redisStats = this.parseRedisInfo(info);
      }).catch(err => {
        logger.debug('Failed to collect Redis stats:', err.message);
      });
    }
    
    this.emit('metricsCollected', metrics);
  }

  /**
   * Parse Redis INFO response
   */
  parseRedisInfo(info) {
    const stats = {};
    const lines = info.split('\r\n');
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        if (key && value) {
          stats[key] = isNaN(value) ? value : Number(value);
        }
      }
    }
    
    return stats;
  }

  /**
   * Get cache statistics
   */
  getStatistics() {
    return {
      ...this.stats,
      memoryCaches: this.memoryCaches.size,
      redisConnected: this.redisClient?.status === 'ready',
      prefetchQueueSize: this.prefetchQueue.size,
      compressionRatio: this.stats.compressionSavings > 0 ? 
        this.stats.compressionSavings / (this.stats.compressionSavings + 1000000) : 0
    };
  }

  /**
   * Clear all caches
   */
  async clearAll() {
    try {
      // Clear memory caches
      for (const cache of this.memoryCaches.values()) {
        cache.clear();
      }
      
      // Clear Redis cache
      if (this.redisClient) {
        const keys = await this.redisClient.keys(`${this.config.redis.keyPrefix}*`);
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
        }
      }
      
      // Reset statistics
      this.stats = {
        hits: { l1: 0, l2: 0, l3: 0, total: 0 },
        misses: { l1: 0, l2: 0, l3: 0, total: 0 },
        evictions: 0,
        errors: 0,
        compressionSavings: 0,
        lastReset: new Date()
      };
      
      this.emit('cachesCleared');
      logger.info('All caches cleared');
      
    } catch (error) {
      logger.error('Failed to clear caches:', error);
      throw error;
    }
  }

  /**
   * Stop the cache manager
   */
  async stop() {
    logger.info('Stopping Advanced Cache Manager');
    
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    
    // Close Redis connection
    if (this.redisClient) {
      await this.redisClient.quit();
      this.redisClient = null;
    }
    
    // Clear memory caches
    this.memoryCaches.clear();
    this.prefetchQueue.clear();
    
    this.emit('stopped');
    logger.info('Advanced Cache Manager stopped');
  }
}

module.exports = AdvancedCacheManager;