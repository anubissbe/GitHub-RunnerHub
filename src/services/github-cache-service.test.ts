import { GitHubCacheService } from './github-cache-service';
import * as redis from 'redis';
import { jest } from '@jest/globals';

// Mock Redis
jest.mock('redis');

// Mock logger
jest.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

// Mock config
jest.mock('../config', () => ({
  default: {
    redis: {
      host: 'localhost',
      port: 6379,
      password: 'test'
    }
  }
}));

describe('GitHubCacheService', () => {
  let cacheService: GitHubCacheService;
  let mockRedisClient: any;
  let mockPubClient: any;
  let mockSubClient: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock Redis clients
    mockRedisClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      set: jest.fn(),
      setEx: jest.fn(),
      del: jest.fn(),
      sAdd: jest.fn(),
      sMembers: jest.fn(),
      expire: jest.fn(),
      exists: jest.fn(),
      scanStream: jest.fn(),
      quit: jest.fn(),
      isOpen: true
    };

    mockPubClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn(),
      quit: jest.fn(),
      isOpen: true
    };

    mockSubClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn(),
      quit: jest.fn(),
      isOpen: true
    };

    // Mock Redis createClient
    (redis.createClient as jest.Mock)
      .mockReturnValueOnce(mockRedisClient)
      .mockReturnValueOnce(mockPubClient)
      .mockReturnValueOnce(mockSubClient);

    cacheService = new GitHubCacheService();
  });

  describe('Cache Operations', () => {
    it('should return null on cache miss', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await cacheService.get('repos/test/repo', {});
      
      expect(result).toBeNull();
      expect(mockRedisClient.get).toHaveBeenCalled();
    });

    it('should return cached data on cache hit', async () => {
      const cachedData = {
        data: { id: 1, name: 'test-repo' },
        timestamp: Date.now() - 60000, // 1 minute ago
        ttl: 300, // 5 minutes
        tags: ['repo:test/repo'],
        hits: 5,
        lastAccessed: Date.now() - 30000,
        size: 100
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await cacheService.get('repos/test/repo', {});
      
      expect(result).toEqual(cachedData.data);
      expect(mockRedisClient.get).toHaveBeenCalled();
    });

    it('should not return expired cached data', async () => {
      const expiredData = {
        data: { id: 1, name: 'test-repo' },
        timestamp: Date.now() - 600000, // 10 minutes ago
        ttl: 300, // 5 minutes TTL
        tags: ['repo:test/repo'],
        hits: 5,
        lastAccessed: Date.now() - 600000,
        size: 100
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(expiredData));

      const result = await cacheService.get('repos/test/repo', {});
      
      expect(result).toBeNull();
      expect(mockRedisClient.del).toHaveBeenCalled();
    });

    it('should set cache with correct TTL', async () => {
      const data = { id: 1, name: 'test-repo' };
      const endpoint = 'repos/test/repo';

      await cacheService.set(endpoint, data, {}, { ttl: 600 });

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        expect.any(String),
        600,
        expect.stringContaining('"data":{"id":1,"name":"test-repo"}')
      );
    });

    it('should add tags for cache invalidation', async () => {
      const data = { id: 1, name: 'test-repo' };
      const endpoint = 'repos/test/repo';
      const tags = ['repo:test/repo', 'type:repos'];

      await cacheService.set(endpoint, data, {}, { tags });

      expect(mockRedisClient.sAdd).toHaveBeenCalledWith(
        'github:cache:tag:repo:test/repo',
        expect.any(String)
      );
      expect(mockRedisClient.sAdd).toHaveBeenCalledWith(
        'github:cache:tag:type:repos',
        expect.any(String)
      );
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache by tag', async () => {
      const keys = ['github:cache:repos:key1', 'github:cache:repos:key2'];
      mockRedisClient.sMembers.mockResolvedValue(keys);

      const count = await cacheService.invalidateByTag('repo:test/repo');

      expect(mockRedisClient.sMembers).toHaveBeenCalledWith('github:cache:tag:repo:test/repo');
      expect(mockRedisClient.del).toHaveBeenCalledWith(keys);
      expect(count).toBe(2);
    });

    it('should invalidate cache by pattern', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield 'github:cache:repos/test/repo:1';
          yield 'github:cache:repos/test/repo:2';
        }
      };
      mockRedisClient.scanStream.mockReturnValue(mockStream);

      const count = await cacheService.invalidateByPattern('repos/test/repo');

      expect(mockRedisClient.scanStream).toHaveBeenCalledWith({
        match: 'github:cache:repos/test/repo*',
        count: 100
      });
      expect(mockRedisClient.del).toHaveBeenCalledWith([
        'github:cache:repos/test/repo:1',
        'github:cache:repos/test/repo:2'
      ]);
      expect(count).toBe(2);
    });

    it('should clear all cache entries', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield 'github:cache:key1';
          yield 'github:cache:key2';
        }
      };
      mockRedisClient.scanStream.mockReturnValue(mockStream);

      await cacheService.clearAll();

      expect(mockRedisClient.del).toHaveBeenCalledWith(['github:cache:key1', 'github:cache:key2']);
    });
  });

  describe('Webhook Integration', () => {
    it('should publish webhook events', async () => {
      const event = {
        event: 'push',
        repository: 'test/repo',
        organization: 'test-org',
        action: 'opened',
        timestamp: Date.now()
      };

      await cacheService.publishWebhookEvent(event);

      expect(mockPubClient.publish).toHaveBeenCalledWith(
        'github:webhook:push',
        JSON.stringify(event)
      );
    });
  });

  describe('Metrics', () => {
    it('should track cache hits and misses', async () => {
      // Simulate cache miss
      mockRedisClient.get.mockResolvedValueOnce(null);
      await cacheService.get('test-endpoint', {});

      // Simulate cache hit
      const cachedData = {
        data: { test: 'data' },
        timestamp: Date.now() - 1000,
        ttl: 300,
        tags: [],
        hits: 0,
        lastAccessed: Date.now(),
        size: 50
      };
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(cachedData));
      await cacheService.get('test-endpoint', {});

      const metrics = cacheService.getMetrics();
      expect(metrics.hits).toBe(1);
      expect(metrics.misses).toBe(1);
      expect(metrics.hitRate).toBe(0.5);
    });
  });

  describe('TTL Configuration', () => {
    it('should use correct TTL for different resource types', async () => {
      const testCases = [
        { endpoint: 'repos/test/repo', expectedTTL: 3600 },
        { endpoint: 'orgs/test-org', expectedTTL: 3600 },
        { endpoint: 'repos/test/repo/issues', expectedTTL: 300 },
        { endpoint: 'repos/test/repo/actions/runs', expectedTTL: 120 },
        { endpoint: 'some/other/endpoint', expectedTTL: 300 } // default
      ];

      for (const { endpoint, expectedTTL } of testCases) {
        await cacheService.set(endpoint, { test: 'data' });
        
        const lastCall = mockRedisClient.setEx.mock.calls[mockRedisClient.setEx.mock.calls.length - 1];
        expect(lastCall[1]).toBe(expectedTTL);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis connection failures gracefully', async () => {
      // Create a new instance with failing Redis connection
      (redis.createClient as jest.Mock).mockImplementation(() => ({
        connect: jest.fn().mockRejectedValue(new Error('Connection failed')),
        quit: jest.fn()
      }));

      const failingService = new GitHubCacheService();
      
      // Should return null when not connected
      const result = await failingService.get('test', {});
      expect(result).toBeNull();
    });

    it('should handle cache get errors gracefully', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

      const result = await cacheService.get('test-endpoint', {});
      
      expect(result).toBeNull();
    });

    it('should handle cache set errors gracefully', async () => {
      mockRedisClient.setEx.mockRejectedValue(new Error('Redis error'));

      // Should not throw
      await expect(
        cacheService.set('test-endpoint', { data: 'test' })
      ).resolves.not.toThrow();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources properly', async () => {
      await cacheService.cleanup();

      expect(mockRedisClient.quit).toHaveBeenCalled();
      expect(mockPubClient.quit).toHaveBeenCalled();
      expect(mockSubClient.quit).toHaveBeenCalled();
    });
  });
});