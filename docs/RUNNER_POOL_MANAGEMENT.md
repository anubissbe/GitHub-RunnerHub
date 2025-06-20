# Runner Pool Management

## Overview

The Runner Pool Management system provides dynamic scaling and lifecycle management for GitHub Actions runners. It supports both proxy runners and ephemeral containers with configurable scaling policies per repository.

## Architecture

### Components

1. **RunnerPoolManager**: Core service managing runner lifecycle
2. **Runner Pools**: Per-repository configuration for scaling
3. **Scaling Engine**: Monitors utilization and triggers scaling
4. **Cleanup Service**: Removes idle and offline runners

### Pool Configuration

Each repository can have its own runner pool with the following settings:

- **minRunners**: Minimum number of runners to maintain (default: 1)
- **maxRunners**: Maximum number of runners allowed (default: 10)
- **scaleIncrement**: Number of runners to add when scaling (default: 5)
- **scaleThreshold**: Utilization percentage to trigger scaling (default: 0.8)

## API Endpoints

### Pool Management

#### GET /api/runners/pools
List all runner pools with metrics.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "repository": "owner/repo",
      "minRunners": 1,
      "maxRunners": 10,
      "currentRunners": 3,
      "scaleIncrement": 5,
      "scaleThreshold": 0.8,
      "metrics": {
        "totalRunners": 3,
        "activeRunners": 2,
        "idleRunners": 1,
        "utilization": 0.67
      }
    }
  ]
}
```

#### GET /api/runners/pools/:repository
Get or create pool for a specific repository.

**Note**: Use underscore (_) instead of slash (/) in repository name.

#### PUT /api/runners/pools/:repository
Update pool configuration.

**Request Body:**
```json
{
  "minRunners": 2,
  "maxRunners": 15,
  "scaleIncrement": 3,
  "scaleThreshold": 0.75
}
```

#### POST /api/runners/pools/:repository/scale
Manually trigger scaling.

**Request Body:**
```json
{
  "action": "up|down",
  "count": 5  // Optional for scale up
}
```

#### GET /api/runners/pools/:repository/metrics
Get real-time metrics for a pool.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalRunners": 5,
    "activeRunners": 4,
    "idleRunners": 1,
    "utilization": 0.8
  }
}
```

### Runner Management

#### GET /api/runners
List all runners with optional filtering.

**Query Parameters:**
- `type`: Filter by runner type (proxy, ephemeral, dedicated)
- `status`: Filter by status (idle, busy, offline, starting, stopping)
- `repository`: Filter by repository

#### DELETE /api/runners/:id
Remove a specific runner.

## Scaling Behavior

### Automatic Scaling

The system monitors runner utilization every 30 seconds and makes scaling decisions:

1. **Scale Up Triggers**:
   - Utilization exceeds `scaleThreshold` (e.g., 80%)
   - Current runners < `maxRunners`
   - Adds `scaleIncrement` runners (respecting max limit)

2. **Scale Down Triggers**:
   - Idle runners detected (no activity for `idleTimeout`)
   - Current runners > `minRunners`
   - Removes only ephemeral runners

3. **Minimum Runner Guarantee**:
   - Always maintains at least `minRunners`
   - Automatically creates runners if below minimum

### Manual Scaling

Administrators can manually trigger scaling:

```bash
# Scale up by 3 runners
curl -X POST http://localhost:3000/api/runners/pools/owner_repo/scale \
  -H "Content-Type: application/json" \
  -d '{"action": "up", "count": 3}'

# Scale down idle runners
curl -X POST http://localhost:3000/api/runners/pools/owner_repo/scale \
  -H "Content-Type: application/json" \
  -d '{"action": "down"}'
```

## Configuration Examples

### High-Traffic Repository
```json
{
  "minRunners": 5,
  "maxRunners": 20,
  "scaleIncrement": 5,
  "scaleThreshold": 0.7
}
```

### Low-Traffic Repository
```json
{
  "minRunners": 1,
  "maxRunners": 5,
  "scaleIncrement": 1,
  "scaleThreshold": 0.9
}
```

### Cost-Optimized Setup
```json
{
  "minRunners": 0,
  "maxRunners": 10,
  "scaleIncrement": 2,
  "scaleThreshold": 0.95
}
```

## Monitoring

### Metrics Available

1. **Pool Metrics**:
   - Total runners per repository
   - Active vs idle runners
   - Current utilization percentage
   - Last scaling event timestamp

2. **Runner Metrics**:
   - Individual runner status
   - Last heartbeat time
   - Job assignment history
   - Container resource usage

### Prometheus Metrics

The system exposes Prometheus metrics:

```
# Runner pool size
github_runnerhub_pool_size{repository="owner/repo",type="total"} 5
github_runnerhub_pool_size{repository="owner/repo",type="active"} 3
github_runnerhub_pool_size{repository="owner/repo",type="idle"} 2

# Pool utilization
github_runnerhub_pool_utilization{repository="owner/repo"} 0.6

# Scaling events
github_runnerhub_scaling_events_total{repository="owner/repo",action="up"} 12
github_runnerhub_scaling_events_total{repository="owner/repo",action="down"} 8
```

## Best Practices

1. **Set Appropriate Thresholds**:
   - Production: 70-80% threshold
   - Development: 85-95% threshold
   - Cost-sensitive: 90-95% threshold

2. **Configure Increment Sizes**:
   - High-traffic: 5-10 runners
   - Medium-traffic: 2-5 runners
   - Low-traffic: 1-2 runners

3. **Monitor and Adjust**:
   - Review metrics weekly
   - Adjust thresholds based on queue times
   - Consider time-of-day patterns

4. **Security Considerations**:
   - Limit max runners to prevent resource exhaustion
   - Monitor for unusual scaling patterns
   - Implement budget alerts

## Troubleshooting

### Common Issues

1. **Runners not scaling up**:
   - Check if at max capacity
   - Verify GitHub token permissions
   - Check orchestrator logs

2. **Excessive scaling**:
   - Review threshold settings
   - Check for job queue backlog
   - Implement scaling cooldown

3. **Runners going offline**:
   - Check container health
   - Verify network connectivity
   - Review resource limits

### Debug Commands

```bash
# Check pool status
curl http://localhost:3000/api/runners/pools/owner_repo | jq

# View scaling decisions in logs
docker logs runnerhub-orchestrator | grep "Scaling decision"

# Force cleanup of offline runners
curl -X POST http://localhost:3000/api/runners/cleanup
```

## Integration with CI/CD

### GitHub Actions Workflow

```yaml
name: Load Test
on: [push]

jobs:
  test:
    runs-on: [self-hosted-proxy, high-priority]
    strategy:
      matrix:
        test: [1, 2, 3, 4, 5]
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: |
          echo "Running test ${{ matrix.test }}"
          sleep 60
```

This workflow will trigger auto-scaling if runner utilization exceeds the threshold.

## Cost Optimization

1. **Use Spot Instances**: Configure Docker hosts to use spot/preemptible instances
2. **Time-based Scaling**: Reduce min runners during off-hours
3. **Repository Prioritization**: Higher limits for critical repositories
4. **Idle Timeout**: Aggressive timeout for development environments

## Future Enhancements

- Predictive scaling based on historical patterns
- Cost tracking per repository
- Integration with cloud auto-scaling groups
- Custom scaling algorithms
- Multi-region runner pools