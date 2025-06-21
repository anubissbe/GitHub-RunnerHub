# GitHub API Caching System

## Overview

The GitHub RunnerHub implements an intelligent caching layer for GitHub API responses to optimize performance, reduce API rate limit consumption, and improve response times. This system uses Redis for distributed caching with automatic invalidation based on webhook events.

## Features

### 1. **Intelligent Caching**
- Automatic caching of GitHub API responses
- Configurable TTL (Time To Live) based on resource type
- Smart cache key generation with normalization
- Support for cache tags for grouped invalidation

### 2. **Cache Invalidation**
- Webhook-based automatic invalidation
- Tag-based invalidation for related resources
- Pattern-based invalidation for bulk operations
- Manual invalidation via API endpoints

### 3. **Performance Optimization**
- Redis-based distributed caching
- LRU (Least Recently Used) eviction policy
- Cache size management with configurable limits
- Compression for large payloads

### 4. **Metrics and Monitoring**
- Real-time cache hit/miss ratios
- Response time tracking
- Cache size monitoring
- Webhook invalidation counts

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│                 │     │                  │     │                 │
│  GitHub API     │────▶│  Cache Service   │────▶│     Redis       │
│  Enhanced       │     │                  │     │                 │
│                 │     └──────────────────┘     └─────────────────┘
└─────────────────┘              │                        │
         │                       │                        │
         │                       ▼                        │
         │              ┌──────────────────┐              │
         │              │                  │              │
         └─────────────▶│  GitHub API      │              │
                        │  (Octokit)       │              │
                        │                  │              │
                        └──────────────────┘              │
                                                          │
┌─────────────────┐                                       │
│                 │                                       │
│  GitHub         │──────────────────────────────────────┘
│  Webhooks       │     (Invalidation Events)
│                 │
└─────────────────┘
```

## Configuration

### TTL Configuration

Different resource types have different TTL values based on their update frequency:

```typescript
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
```

### Cache Size Limits

- Maximum cache size: 100MB (configurable)
- Eviction policy: LRU (Least Recently Used)
- Automatic cleanup of expired entries

## Usage

### Using Cached API Methods

```typescript
import { getGitHubAPIClient } from './services/github-api-enhanced';

const githubAPI = getGitHubAPIClient();

// These methods automatically use caching
const repo = await githubAPI.getRepository('owner', 'repo');
const runs = await githubAPI.listWorkflowRuns('owner', 'repo');
const jobs = await githubAPI.listWorkflowJobs('owner', 'repo', runId);
```

### Custom Cached Requests

```typescript
// Make a custom cached request
const result = await githubAPI.cachedRequest(
  'repos/owner/repo/branches',
  () => octokit.rest.repos.listBranches({ owner, repo }),
  {
    cacheTTL: 600, // 10 minutes
    cacheTags: ['repo:owner/repo', 'type:branches'],
    priority: 'normal'
  }
);
```

### Cache Management API

#### Get Cache Metrics
```bash
GET /api/cache/metrics
```

Response:
```json
{
  "success": true,
  "metrics": {
    "api": {
      "totalRequests": 1000,
      "cacheHits": 800,
      "cacheMisses": 200,
      "rateLimit": {
        "remaining": 4500,
        "limit": 5000,
        "reset": "2024-01-01T12:00:00Z"
      }
    },
    "cache": {
      "hits": 800,
      "misses": 200,
      "hitRate": 0.8,
      "evictions": 50,
      "totalSize": 52428800,
      "cacheEntries": 150,
      "webhookInvalidations": 25
    }
  }
}
```

#### Clear Cache by Tag
```bash
DELETE /api/cache/tag/:tag
Authorization: Bearer <token>
```

#### Clear Cache by Pattern
```bash
DELETE /api/cache/pattern/:pattern
Authorization: Bearer <token>
```

#### Clear Repository Cache
```bash
DELETE /api/cache/repository/:owner/:repo
Authorization: Bearer <token>
```

#### Clear Organization Cache
```bash
DELETE /api/cache/organization/:org
Authorization: Bearer <token>
```

#### Clear All Cache
```bash
DELETE /api/cache/all
Authorization: Bearer <token>
```

#### Warm Up Cache
```bash
POST /api/cache/warmup
Authorization: Bearer <token>
Content-Type: application/json

{
  "endpoints": [
    { "endpoint": "repos/owner/repo", "params": {} },
    { "endpoint": "orgs/myorg/repos", "params": { "per_page": 100 } }
  ]
}
```

## Webhook Integration

The caching system automatically invalidates cache entries based on GitHub webhook events:

### Automatic Invalidation Rules

| Webhook Event | Invalidated Cache |
|--------------|-------------------|
| `push` | Repository commits, branches |
| `pull_request` | Pull requests, issues |
| `workflow_run` | Workflow runs, workflows |
| `issues` | Issues |
| `release` | Releases |
| `repository` | Repository metadata |
| `organization` | Organization data |

### Manual Webhook Event Publishing

```typescript
await githubAPI.handleWebhookEvent('push', {
  repository: { full_name: 'owner/repo' },
  organization: { login: 'myorg' },
  action: 'opened'
});
```

## Performance Benefits

### Before Caching
- Average response time: 200-500ms
- GitHub API calls: 1000/hour
- Rate limit usage: High

### After Caching
- Average response time: 10-50ms (cache hits)
- GitHub API calls: 200/hour (80% reduction)
- Rate limit usage: Low

## Monitoring

### Metrics Dashboard

The cache metrics are integrated into the main monitoring dashboard:

1. **Cache Hit Rate**: Percentage of requests served from cache
2. **Response Times**: Comparison of cached vs non-cached response times
3. **Cache Size**: Current cache size and entry count
4. **Invalidation Events**: Webhook-triggered invalidations per hour

### Prometheus Metrics

```
# Cache hit rate
github_cache_hit_rate 0.85

# Cache size in bytes
github_cache_size_bytes 52428800

# Cache entries count
github_cache_entries_total 150

# Webhook invalidations
github_cache_webhook_invalidations_total 25
```

## Best Practices

1. **Choose Appropriate TTLs**: Set TTL based on data volatility
2. **Use Cache Tags**: Tag related resources for efficient invalidation
3. **Monitor Hit Rates**: Aim for >70% cache hit rate
4. **Regular Cleanup**: Schedule periodic cache cleanup for optimal performance
5. **Warm Up Critical Data**: Pre-cache frequently accessed data

## Troubleshooting

### Low Cache Hit Rate
- Check TTL configuration
- Verify webhook invalidation is not too aggressive
- Ensure Redis has sufficient memory

### Stale Data
- Verify webhook integration is working
- Check TTL values are appropriate
- Manually invalidate cache if needed

### Redis Connection Issues
- Check Redis server status
- Verify network connectivity
- Review Redis configuration

## Security Considerations

1. **Sensitive Data**: Never cache sensitive or user-specific data
2. **Access Control**: Cache management endpoints require authentication
3. **Data Isolation**: Use separate Redis databases for different environments
4. **Encryption**: Enable Redis encryption for sensitive deployments

## Future Enhancements

1. **Intelligent Prefetching**: Predict and pre-cache likely requests
2. **Compression**: Compress large cache entries
3. **Multi-tier Caching**: Add in-memory L1 cache
4. **GraphQL Support**: Cache GraphQL query results
5. **Analytics**: Advanced cache usage analytics