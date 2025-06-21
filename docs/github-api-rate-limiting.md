# GitHub API Smart Rate Limiting

## Overview

The GitHub-RunnerHub implements an advanced rate limiting system for GitHub API interactions that ensures optimal performance while respecting GitHub's rate limits (5000 requests/hour for authenticated requests).

## Features

### 1. **Intelligent Request Queuing**
- Priority-based queue system (critical, high, normal, low)
- Automatic request ordering based on priority and age
- Request deduplication to avoid redundant API calls

### 2. **Multiple Rate Limiting Strategies**

#### Conservative Strategy
- Starts throttling when < 20% of rate limit remains
- Progressive delays: 5s (< 5%), 2s (< 10%), 0.5s (< 20%)
- Best for: Long-running operations, background syncs

#### Aggressive Strategy
- Only throttles when < 50 requests remain
- Minimal delays to maximize throughput
- Best for: Time-critical operations, real-time updates

#### Adaptive Strategy (Default)
- Dynamically adjusts based on usage patterns
- Predicts rate limit exhaustion
- Optimizes request distribution over time
- Best for: General use, mixed workloads

### 3. **Distributed Rate Limit Tracking**
- Redis-based shared state across multiple instances
- Prevents rate limit violations in distributed deployments
- Automatic failover to in-memory tracking if Redis unavailable

### 4. **Comprehensive Metrics**
- Total requests, success/failure rates
- Average response times
- Rate limit hit tracking
- Queue length monitoring

### 5. **Error Handling & Retry Logic**
- Automatic retry with exponential backoff
- Special handling for rate limit errors (403)
- Configurable max retries per request
- Network error resilience

### 6. **Advanced Features**
- Batch request processing
- Rate limit exhaustion prediction
- Emergency pause functionality
- Real-time metrics reporting

## Implementation Details

### Core Components

1. **GitHubAPIEnhanced** (`src/services/github-api-enhanced.ts`)
   - Main service class with rate limiting logic
   - Request queue management
   - Strategy implementation

2. **GitHubAPIService** (`services/github-api-service.js`)
   - Production-ready implementation
   - Vault integration for credentials
   - Database sync capabilities

### Rate Limit Information

GitHub provides the following headers with each response:
- `X-RateLimit-Limit`: Total requests allowed (5000)
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when limit resets
- `X-RateLimit-Used`: Requests used in current window

### Usage Examples

#### Basic Request with Rate Limiting
```typescript
const client = getGitHubAPIClient();

// Make a rate-limited request
const result = await client.request(
  () => octokit.rest.repos.get({ owner, repo }),
  { 
    priority: 'normal',
    strategy: 'adaptive'
  }
);
```

#### Batch Operations
```typescript
// Process multiple requests efficiently
const results = await client.batchRequests([
  { fn: () => getRepository(repo1), priority: 'high' },
  { fn: () => getRepository(repo2), priority: 'normal' },
  { fn: () => getRepository(repo3), priority: 'normal' }
]);
```

#### Monitoring Rate Limits
```typescript
// Get current rate limit status
const status = client.getRateLimitStatus();
console.log(`Remaining: ${status.remaining}/${status.limit}`);
console.log(`Resets in: ${status.resetIn}ms`);
console.log(`Queue length: ${status.queueLength}`);

// Predict exhaustion
const exhaustionTime = client.predictRateLimitExhaustion();
if (exhaustionTime) {
  console.log(`Rate limit will be exhausted at: ${exhaustionTime}`);
}
```

#### Emergency Controls
```typescript
// Pause all requests immediately
client.pauseRequests();

// Check rate limit before heavy operations
const rateLimit = await client.checkRateLimit();
if (rateLimit.remaining < 1000) {
  console.log('Low on rate limit, switching to conservative strategy');
}
```

## Configuration

### Environment Variables
```bash
# GitHub API Token (required)
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Redis Configuration (optional)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=yourpassword

# Rate Limit Strategy (optional)
GITHUB_RATE_LIMIT_STRATEGY=adaptive # conservative, aggressive, adaptive
```

### Strategy Selection Guidelines

| Strategy | Use When | Pros | Cons |
|----------|----------|------|------|
| Conservative | - Background syncs<br>- Non-urgent operations<br>- Shared API tokens | - Never hits rate limits<br>- Predictable performance | - Slower throughput<br>- May underutilize quota |
| Aggressive | - Real-time monitoring<br>- User-facing features<br>- Dedicated tokens | - Maximum throughput<br>- Minimal delays | - Risk of hitting limits<br>- Requires monitoring |
| Adaptive | - Mixed workloads<br>- Default choice<br>- Production systems | - Self-adjusting<br>- Balanced approach | - More complex<br>- Requires Redis for best results |

## Monitoring & Alerting

### Metrics Endpoint
The system exposes metrics at `/api/github/metrics`:
```json
{
  "rateLimit": {
    "remaining": 4521,
    "limit": 5000,
    "reset": "2024-12-20T15:00:00Z",
    "used": 479,
    "resetIn": 2134000
  },
  "metrics": {
    "totalRequests": 1523,
    "successfulRequests": 1518,
    "failedRequests": 5,
    "rateLimitHits": 0,
    "averageResponseTime": 234.5
  },
  "queueLength": 3,
  "strategy": "adaptive"
}
```

### Recommended Alerts
1. **Rate Limit Warning**: When remaining < 500 (10%)
2. **Rate Limit Critical**: When remaining < 100 (2%)
3. **Queue Backup**: When queue length > 50
4. **High Failure Rate**: When failure rate > 5%

## Best Practices

1. **Use Appropriate Priorities**
   - `critical`: User-facing, time-sensitive operations
   - `high`: Important background tasks
   - `normal`: Regular operations
   - `low`: Non-urgent, bulk operations

2. **Monitor Rate Limits**
   - Set up alerts for low remaining requests
   - Use predictive exhaustion for planning
   - Switch strategies based on current state

3. **Optimize API Usage**
   - Batch similar requests when possible
   - Use GraphQL for complex queries
   - Cache responses when appropriate
   - Implement webhook listeners for real-time data

4. **Handle Errors Gracefully**
   - Always handle rate limit errors
   - Implement user-friendly error messages
   - Provide fallback data when possible

## Testing

Run the comprehensive test suite:
```bash
npm test -- github-api-enhanced.test.ts
```

The tests cover:
- Rate limit tracking and updates
- Priority queue ordering
- Strategy implementations
- Error handling and retries
- Batch operations
- Emergency controls

## Performance Considerations

1. **Request Overhead**: Each request adds ~50-100ms overhead for rate limiting logic
2. **Memory Usage**: Queue can grow with pending requests (monitor queue length)
3. **Redis Latency**: Adds ~1-5ms per request for distributed tracking
4. **Strategy Impact**:
   - Conservative: 10-30% throughput reduction
   - Aggressive: 0-5% throughput reduction
   - Adaptive: 5-15% throughput reduction

## Troubleshooting

### Common Issues

1. **"Rate limit exceeded" errors**
   - Check current rate limit status
   - Switch to conservative strategy
   - Verify token permissions

2. **Slow request processing**
   - Check queue length
   - Review strategy settings
   - Monitor Redis connectivity

3. **Requests timing out**
   - Increase request timeout
   - Check GitHub API status
   - Review network connectivity

### Debug Mode
Enable debug logging:
```typescript
process.env.LOG_LEVEL = 'debug';
```

This will log:
- Queue operations
- Rate limit updates
- Strategy decisions
- Retry attempts

## Future Enhancements

1. **Machine Learning-based Prediction**
   - Learn usage patterns
   - Predict peak times
   - Auto-adjust strategies

2. **Multi-Token Support**
   - Rotate between multiple tokens
   - Automatic failover
   - Load balancing

3. **GraphQL Optimization**
   - Detect similar queries
   - Combine into single GraphQL request
   - Reduce total API calls

4. **Webhook Integration**
   - Reduce polling needs
   - Real-time updates
   - Lower API usage