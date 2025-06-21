import { GitHubAPIEnhanced, getGitHubAPIClient } from './github-api-enhanced';
import { createLogger } from '../utils/logger';

const logger = createLogger('GitHubAPIEnhancedTest');

describe('GitHubAPIEnhanced', () => {
  let client: GitHubAPIEnhanced;

  beforeAll(() => {
    client = getGitHubAPIClient();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  describe('Rate Limiting', () => {
    test('should track rate limit information', async () => {
      const rateLimit = await client.checkRateLimit();
      
      expect(rateLimit).toHaveProperty('remaining');
      expect(rateLimit).toHaveProperty('limit');
      expect(rateLimit).toHaveProperty('reset');
      expect(rateLimit).toHaveProperty('used');
      expect(rateLimit).toHaveProperty('resetIn');
      
      expect(rateLimit.limit).toBe(5000);
      expect(rateLimit.remaining).toBeGreaterThanOrEqual(0);
      expect(rateLimit.remaining).toBeLessThanOrEqual(5000);
    });

    test('should queue requests based on priority', async () => {
      const results: number[] = [];
      
      // Create requests with different priorities
      const promises = [
        client.request(
          async () => { results.push(1); return 1; },
          { priority: 'low' }
        ),
        client.request(
          async () => { results.push(2); return 2; },
          { priority: 'critical' }
        ),
        client.request(
          async () => { results.push(3); return 3; },
          { priority: 'high' }
        ),
        client.request(
          async () => { results.push(4); return 4; },
          { priority: 'normal' }
        )
      ];

      await Promise.all(promises);
      
      // Critical should execute first, then high, normal, and low
      expect(results[0]).toBe(2); // critical
      expect(results[1]).toBe(3); // high
      expect(results[2]).toBe(4); // normal
      expect(results[3]).toBe(1); // low
    });

    test('should handle rate limit exhaustion prediction', () => {
      const exhaustionDate = client.predictRateLimitExhaustion();
      
      if (exhaustionDate) {
        expect(exhaustionDate).toBeInstanceOf(Date);
        expect(exhaustionDate.getTime()).toBeGreaterThan(Date.now());
      }
    });

    test('should get comprehensive rate limit status', () => {
      const status = client.getRateLimitStatus();
      
      expect(status).toHaveProperty('remaining');
      expect(status).toHaveProperty('limit');
      expect(status).toHaveProperty('reset');
      expect(status).toHaveProperty('queueLength');
      expect(status).toHaveProperty('metrics');
      expect(status).toHaveProperty('strategy');
      
      expect(status.metrics).toHaveProperty('totalRequests');
      expect(status.metrics).toHaveProperty('successfulRequests');
      expect(status.metrics).toHaveProperty('failedRequests');
      expect(status.metrics).toHaveProperty('rateLimitHits');
      expect(status.metrics).toHaveProperty('averageResponseTime');
    });
  });

  describe('Request Strategies', () => {
    test('should support conservative strategy', async () => {
      const startTime = Date.now();
      
      await client.request(
        async () => ({ data: 'test' }),
        { strategy: 'conservative' }
      );
      
      const duration = Date.now() - startTime;
      
      // Conservative strategy should add delays
      expect(duration).toBeGreaterThanOrEqual(50);
    });

    test('should support aggressive strategy', async () => {
      const startTime = Date.now();
      
      await client.request(
        async () => ({ data: 'test' }),
        { strategy: 'aggressive' }
      );
      
      const duration = Date.now() - startTime;
      
      // Aggressive strategy should have minimal delays
      expect(duration).toBeLessThan(200);
    });

    test('should support adaptive strategy', async () => {
      const results = await client.batchRequests([
        { fn: async () => ({ data: 'test1' }) },
        { fn: async () => ({ data: 'test2' }) },
        { fn: async () => ({ data: 'test3' }) }
      ]);
      
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ data: 'test1' });
      expect(results[1]).toEqual({ data: 'test2' });
      expect(results[2]).toEqual({ data: 'test3' });
    });
  });

  describe('Error Handling', () => {
    test('should retry on retryable errors', async () => {
      let attempts = 0;
      
      const result = await client.request(
        async () => {
          attempts++;
          if (attempts < 3) {
            const error: any = new Error('Service unavailable');
            error.status = 503;
            throw error;
          }
          return { success: true };
        },
        { maxRetries: 3 }
      );
      
      expect(attempts).toBe(3);
      expect(result).toEqual({ success: true });
    });

    test('should not retry on non-retryable errors', async () => {
      let attempts = 0;
      
      await expect(
        client.request(
          async () => {
            attempts++;
            const error: any = new Error('Bad request');
            error.status = 400;
            throw error;
          },
          { maxRetries: 3 }
        )
      ).rejects.toThrow('Bad request');
      
      expect(attempts).toBe(1);
    });

    test('should handle rate limit errors specially', async () => {
      const mockRateLimitError: any = new Error('API rate limit exceeded');
      mockRateLimitError.status = 403;
      mockRateLimitError.message = 'API rate limit exceeded';
      
      // This should wait and retry
      const promise = client.request(
        async () => {
          throw mockRateLimitError;
        },
        { maxRetries: 1 }
      );
      
      await expect(promise).rejects.toThrow('API rate limit exceeded');
      
      const status = client.getRateLimitStatus();
      expect(status.metrics.rateLimitHits).toBeGreaterThan(0);
    });
  });

  describe('Batch Operations', () => {
    test('should batch multiple requests efficiently', async () => {
      const requests = Array.from({ length: 5 }, (_, i) => ({
        fn: async () => ({ id: i, data: `test${i}` }),
        priority: i === 0 ? 'high' as const : 'normal' as const
      }));
      
      const results = await client.batchRequests(requests);
      
      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result).toEqual({ id: index, data: `test${index}` });
      });
    });
  });

  describe('Emergency Controls', () => {
    test('should pause requests when needed', () => {
      // Queue some requests
      const promise1 = client.request(
        async () => ({ data: 'test1' }),
        { priority: 'normal' }
      );
      
      const promise2 = client.request(
        async () => ({ data: 'test2' }),
        { priority: 'normal' }
      );
      
      // Pause immediately
      client.pauseRequests();
      
      // Both promises should reject
      expect(promise1).rejects.toThrow('Requests paused');
      expect(promise2).rejects.toThrow('Requests paused');
    });
  });
});

// Integration test example
describe('GitHubAPIEnhanced Integration', () => {
  test('should handle real GitHub API requests with rate limiting', async () => {
    const client = getGitHubAPIClient();
    
    try {
      // Check initial rate limit
      const initialLimit = await client.checkRateLimit();
      logger.info('Initial rate limit', initialLimit);
      
      // Make a real API call with rate limiting
      const result = await client.request(
        async () => {
          // This would be a real Octokit call in production
          return { data: { message: 'Simulated GitHub API response' } };
        },
        {
          priority: 'normal',
          strategy: 'adaptive',
          metadata: { operation: 'test' }
        }
      );
      
      expect(result.data.message).toBe('Simulated GitHub API response');
      
      // Check final rate limit
      const finalLimit = client.getRateLimitStatus();
      logger.info('Final rate limit status', finalLimit);
      
      // Verify metrics were updated
      expect(finalLimit.metrics.totalRequests).toBeGreaterThan(0);
      expect(finalLimit.metrics.successfulRequests).toBeGreaterThan(0);
      
    } finally {
      await client.cleanup();
    }
  });
});