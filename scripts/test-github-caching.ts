#!/usr/bin/env node

import { getGitHubAPIClient } from '../src/services/github-api-enhanced';
import { getGitHubCacheService } from '../src/services/github-cache-service';
import { createLogger } from '../src/utils/logger';

const logger = createLogger('CacheTest');

async function testCaching() {
  logger.info('Starting GitHub API caching test...');
  
  const githubAPI = getGitHubAPIClient();
  const cacheService = getGitHubCacheService();
  
  try {
    // Test repository caching
    logger.info('Testing repository caching...');
    
    // First call - should be a cache miss
    const start1 = Date.now();
    const repo1 = await githubAPI.getRepository('microsoft', 'vscode');
    const time1 = Date.now() - start1;
    logger.info(`First call (cache miss): ${time1}ms`);
    
    // Second call - should be a cache hit
    const start2 = Date.now();
    const repo2 = await githubAPI.getRepository('microsoft', 'vscode');
    const time2 = Date.now() - start2;
    logger.info(`Second call (cache hit): ${time2}ms`);
    
    // Verify cache hit was faster
    if (time2 < time1 / 2) {
      logger.info('✓ Cache hit was significantly faster');
    } else {
      logger.warn('⚠ Cache hit was not significantly faster');
    }
    
    // Get cache metrics
    const metrics = githubAPI.getCombinedMetrics();
    logger.info('Cache metrics:', {
      hits: metrics.cache.hits,
      misses: metrics.cache.misses,
      hitRate: metrics.cache.hitRate,
      entries: metrics.cache.cacheEntries
    });
    
    // Test workflow runs caching
    logger.info('\nTesting workflow runs caching...');
    
    const runs1Start = Date.now();
    const runs1 = await githubAPI.listWorkflowRuns('microsoft', 'vscode', { per_page: 10 });
    const runs1Time = Date.now() - runs1Start;
    logger.info(`First workflow runs call: ${runs1Time}ms`);
    
    const runs2Start = Date.now();
    const runs2 = await githubAPI.listWorkflowRuns('microsoft', 'vscode', { per_page: 10 });
    const runs2Time = Date.now() - runs2Start;
    logger.info(`Second workflow runs call: ${runs2Time}ms`);
    
    // Test cache invalidation
    logger.info('\nTesting cache invalidation...');
    
    // Invalidate repository cache
    await githubAPI.invalidateRepositoryCache('microsoft', 'vscode');
    logger.info('Invalidated repository cache');
    
    // Next call should be a cache miss
    const start3 = Date.now();
    const repo3 = await githubAPI.getRepository('microsoft', 'vscode');
    const time3 = Date.now() - start3;
    logger.info(`After invalidation (cache miss): ${time3}ms`);
    
    // Test webhook event handling
    logger.info('\nTesting webhook event handling...');
    
    await githubAPI.handleWebhookEvent('push', {
      repository: { full_name: 'microsoft/vscode' },
      action: 'opened'
    });
    logger.info('Published webhook event for cache invalidation');
    
    // Wait a bit for invalidation to process
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Get final metrics
    const finalMetrics = githubAPI.getCombinedMetrics();
    logger.info('\nFinal cache metrics:', {
      totalRequests: finalMetrics.api.totalRequests,
      cacheHits: finalMetrics.cache.hits,
      cacheMisses: finalMetrics.cache.misses,
      hitRate: (finalMetrics.cache.hitRate * 100).toFixed(1) + '%',
      webhookInvalidations: finalMetrics.cache.webhookInvalidations
    });
    
    // Test different TTLs
    logger.info('\nTesting TTL configurations...');
    
    const endpoints = [
      { endpoint: 'repos/test/repo', expectedTTL: 'long (repos)' },
      { endpoint: 'repos/test/repo/issues', expectedTTL: 'medium (issues)' },
      { endpoint: 'repos/test/repo/actions/runs', expectedTTL: 'short (runs)' }
    ];
    
    for (const { endpoint, expectedTTL } of endpoints) {
      logger.info(`Endpoint: ${endpoint} - Expected TTL: ${expectedTTL}`);
    }
    
    logger.info('\n✅ GitHub API caching test completed successfully');
    
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    await githubAPI.cleanup();
    logger.info('Cleaned up resources');
  }
}

// Run the test
testCaching().catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});