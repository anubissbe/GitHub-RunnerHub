# Redis Job Queue System Documentation

## Overview

The GitHub RunnerHub Redis Job Queue System is a comprehensive job processing framework built on top of Bull (BullMQ) that provides reliable, scalable, and fault-tolerant job processing capabilities. This system manages all asynchronous tasks in the RunnerHub platform, from GitHub webhook processing to container management and cleanup operations.

## Architecture

### Core Components

1. **Queue Manager** - Central orchestrator for all queue operations
2. **Job Router** - Intelligent routing system with priority-based job distribution
3. **Job Processors** - Specialized processors for different job types
4. **Retry Handler** - Advanced retry mechanisms with exponential backoff
5. **Job Persistence** - Job recovery and persistence layer
6. **Monitoring Dashboard** - Real-time queue monitoring and management

### Queue Types

The system manages 6 primary queues:

- **job-execution** - GitHub Actions workflow execution
- **container-management** - Docker container lifecycle management
- **monitoring** - Metrics collection and alerting
- **webhook-processing** - GitHub webhook event processing
- **cleanup** - System cleanup and maintenance tasks
- **metrics-collection** - Performance metrics gathering

## Features

### 1. Priority-Based Job Routing

Jobs are automatically routed to appropriate queues with intelligent priority assignment:

```typescript
// Priority levels
CRITICAL: 1
HIGH: 2
NORMAL: 3
LOW: 4
```

The router analyzes job types and data to determine optimal priority:
- Deploy/hotfix workflows → CRITICAL
- Pull request workflows → HIGH
- Regular push events → NORMAL
- Cleanup tasks → LOW

### 2. Advanced Retry Mechanisms

Each job type has customized retry strategies:

```typescript
// Example: Workflow execution retry strategy
{
  maxAttempts: 3,
  backoffType: 'exponential',
  backoffDelay: 5000,
  backoffMultiplier: 2,
  maxBackoffDelay: 60000,
  retryableErrors: [
    'DOCKER_DAEMON_ERROR',
    'NETWORK_TIMEOUT',
    'RESOURCE_TEMPORARILY_UNAVAILABLE'
  ],
  nonRetryableErrors: [
    'INVALID_WORKFLOW_CONFIGURATION',
    'AUTHENTICATION_FAILED'
  ]
}
```

### 3. Job Persistence & Recovery

The system provides automatic job persistence and recovery:

- **Automatic Persistence**: Jobs are persisted on failure, system shutdown, or at regular intervals
- **Recovery on Startup**: Previously interrupted jobs are automatically recovered
- **Configurable Recovery**: Choose which job types to recover (failed, stalled, incomplete)
- **File-based Backup**: Dual persistence in database and filesystem

### 4. Real-time Monitoring

The system includes comprehensive monitoring capabilities:

- **Bull Dashboard**: Professional queue management UI at `/admin/queues`
- **Custom Dashboard**: Real-time statistics and job management at `/dashboard/queues`
- **WebSocket Updates**: Live queue statistics and job progress
- **Performance Metrics**: Throughput, latency, and error rate tracking

### 5. Job Types

The system supports various job types:

#### Job Execution
- `EXECUTE_WORKFLOW` - Run GitHub Actions workflows
- `PREPARE_RUNNER` - Initialize runner environment
- `CLEANUP_RUNNER` - Clean up after job completion

#### Container Management
- `CREATE_CONTAINER` - Spawn new Docker containers
- `DESTROY_CONTAINER` - Remove containers
- `HEALTH_CHECK` - Monitor container health

#### Monitoring
- `COLLECT_METRICS` - Gather system metrics
- `SEND_ALERT` - Dispatch alerts via multiple channels
- `UPDATE_STATUS` - Update component status

#### Webhook Processing
- `PROCESS_WEBHOOK` - Handle GitHub webhook events
- `SYNC_GITHUB_DATA` - Synchronize repository data

#### Cleanup
- `CLEANUP_OLD_JOBS` - Remove old job records
- `CLEANUP_CONTAINERS` - Clean up abandoned containers
- `CLEANUP_LOGS` - Archive and remove old logs

## Usage

### Adding Jobs

```typescript
// Simple job addition
const job = await jobRouter.route({
  type: JobType.EXECUTE_WORKFLOW,
  data: {
    repository: 'org/repo',
    workflow: 'ci.yml',
    ref: 'main'
  }
});

// With custom options
const job = await jobRouter.route({
  type: JobType.CREATE_CONTAINER,
  data: {
    image: 'node:20',
    name: 'test-container'
  },
  priority: QUEUE_CONFIG.priorities.HIGH,
  delay: 5000, // Start after 5 seconds
  attempts: 5
});

// Bulk job addition
const jobs = await jobRouter.routeBatch([
  { type: JobType.COLLECT_METRICS, data: { targets: ['system'] } },
  { type: JobType.HEALTH_CHECK, data: { containerId: 'abc123' } }
]);
```

### Recurring Jobs

```typescript
// Interval-based recurring job
await jobRouter.route({
  type: JobType.COLLECT_METRICS,
  data: {
    targets: ['system', 'containers'],
    interval: 60000 // Every minute
  }
});

// Cron-based recurring job
await jobRouter.route({
  type: JobType.CLEANUP_OLD_JOBS,
  data: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    cronPattern: '0 2 * * *' // Daily at 2 AM
  }
});
```

### Queue Management

```typescript
// Get queue statistics
const stats = await queueManager.getQueueStats('job-execution');
console.log(stats);
// { waiting: 10, active: 2, completed: 150, failed: 3, ... }

// Pause/resume queue
await queueManager.pauseQueue('job-execution');
await queueManager.resumeQueue('job-execution');

// Clean old jobs
await queueManager.cleanQueue('job-execution', 3600000, 1000, 'completed');

// Drain queue (process all jobs and stop)
await queueManager.drainQueue('cleanup');
```

### Error Handling

The system automatically handles errors with configurable retry strategies:

```typescript
// Errors are automatically retried based on job type
// Non-retryable errors throw UnrecoverableError
// Max attempts trigger failure handlers and alerts

// Manual retry
const job = await queue.getJob(jobId);
await job.retry();
```

## API Endpoints

### Queue Management
- `GET /api/queues/stats` - Get all queue statistics
- `GET /api/queues/stats/:queueName` - Get specific queue statistics
- `POST /api/queues/jobs` - Add new job
- `POST /api/queues/jobs/bulk` - Add multiple jobs
- `GET /api/queues/jobs/:jobId` - Get job details
- `POST /api/queues/jobs/:jobId/retry` - Retry failed job

### Queue Operations
- `POST /api/queues/:queueName/pause` - Pause queue
- `POST /api/queues/:queueName/resume` - Resume queue
- `POST /api/queues/:queueName/drain` - Drain queue
- `POST /api/queues/:queueName/clean` - Clean old jobs

### Persistence & Recovery
- `POST /api/queues/persistence/backup` - Backup jobs
- `POST /api/queues/persistence/recover` - Recover jobs
- `GET /api/queues/persistence/export` - Export jobs (JSON/CSV)

### Monitoring
- `GET /api/queues/retry/stats` - Get retry statistics
- `POST /api/queues/routing/optimize` - Optimize queue routing
- `GET /api/queues/routing/distribution` - Get job distribution

## Configuration

### Environment Variables

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-password
REDIS_DB=0

# Worker Configuration
JOB_WORKER_CONCURRENCY=5
CONTAINER_WORKER_CONCURRENCY=10
MONITORING_WORKER_CONCURRENCY=3
WEBHOOK_WORKER_CONCURRENCY=20

# Persistence
JOB_PERSISTENCE_DIR=/var/lib/github-runnerhub/jobs
JOB_PERSISTENCE_INTERVAL=300000  # 5 minutes
```

### Queue Configuration

Default job options can be customized in `redis-config.ts`:

```typescript
defaultJobOptions: {
  removeOnComplete: {
    age: 24 * 3600,     // Keep for 24 hours
    count: 1000         // Keep max 1000 jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // Keep for 7 days
    count: 5000         // Keep max 5000 jobs
  },
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000
  }
}
```

## Monitoring & Debugging

### Bull Dashboard

Access the Bull Dashboard at `http://localhost:3001/admin/queues` for:
- Visual queue management
- Job inspection and manipulation
- Real-time statistics
- Manual job retry/removal

### Custom Queue Dashboard

Access the custom dashboard at `http://localhost:3001/dashboard/queues` for:
- Real-time queue statistics
- Job distribution charts
- Failed job management
- Queue throughput monitoring

### Logging

All queue operations are logged with appropriate levels:
- **INFO**: Normal operations (job added, completed)
- **WARN**: Recoverable issues (job stalled, queue backlog)
- **ERROR**: Failures requiring attention

### Health Checks

Monitor queue health via:
```bash
curl http://localhost:3001/api/queues/stats
```

## Best Practices

1. **Job Design**
   - Keep jobs small and focused
   - Store minimal data in job payload
   - Use job IDs to reference external data

2. **Error Handling**
   - Define clear retryable vs non-retryable errors
   - Set appropriate max attempts per job type
   - Implement proper cleanup in failure handlers

3. **Performance**
   - Use bulk operations for multiple jobs
   - Configure appropriate concurrency levels
   - Monitor queue backlogs and adjust workers

4. **Persistence**
   - Enable auto-persistence for critical jobs
   - Regularly clean old completed jobs
   - Monitor persistence directory size

5. **Monitoring**
   - Set up alerts for queue backlogs
   - Monitor failure rates by job type
   - Track job processing times

## Troubleshooting

### Common Issues

1. **Jobs stuck in waiting state**
   - Check if queue is paused
   - Verify Redis connection
   - Check worker health

2. **High failure rate**
   - Review retry configurations
   - Check for systemic issues (network, resources)
   - Analyze failure patterns

3. **Memory issues**
   - Clean old completed jobs
   - Reduce job payload size
   - Increase Redis memory limit

4. **Slow job processing**
   - Increase worker concurrency
   - Optimize job processor logic
   - Check for resource constraints

### Debug Mode

Enable detailed logging:
```bash
export DEBUG=bull*
export LOG_LEVEL=debug
```

## Security Considerations

1. **Job Data**: Avoid storing sensitive data in job payloads
2. **Redis Security**: Use authentication and encryption
3. **Access Control**: Protect queue management endpoints
4. **Audit Logging**: Track all queue operations
5. **Resource Limits**: Set appropriate job timeouts and retries

## Performance Tuning

### Redis Optimization
```redis
# Recommended Redis settings
maxmemory 2gb
maxmemory-policy allkeys-lru
save ""  # Disable persistence for better performance
```

### Worker Scaling
- Monitor CPU and memory usage
- Scale workers based on queue depth
- Use different concurrency for different job types

### Job Optimization
- Batch similar operations
- Use job flows for complex workflows
- Implement proper job deduplication

## Migration Guide

### From Legacy Job Queue

1. Map old job types to new JobType enum
2. Update job data structures
3. Implement new processors
4. Migrate retry configurations
5. Update API endpoints
6. Test thoroughly before switching

### Database Schema

The system uses the following tables:
- `jobs` - Job execution history
- `job_failures` - Failure tracking
- `persisted_jobs` - Job recovery data
- `job_events` - Audit trail

## Future Enhancements

1. **Job Dependencies**: Support for complex job workflows
2. **Rate Limiting**: Per-queue rate limiting
3. **Job Deduplication**: Automatic duplicate detection
4. **Enhanced Analytics**: ML-based performance optimization
5. **Multi-Region Support**: Distributed queue processing

---

For additional support or questions, please refer to the main project documentation or create an issue in the repository.