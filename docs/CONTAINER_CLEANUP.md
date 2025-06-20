# Container Cleanup System

## Overview

The Container Cleanup System provides automated management of container lifecycles, ensuring efficient resource utilization by removing idle, failed, orphaned, and expired containers. It implements configurable policies with intelligent detection algorithms to maintain a clean and efficient runner environment.

## Key Features

- **Policy-Based Cleanup**: Four default policies for different container states
- **Intelligent Detection**: Identifies containers based on activity, status, and age
- **Log Archival**: Preserves container logs before removal
- **Exclude Labels**: Protect specific containers from cleanup
- **Manual Triggers**: On-demand cleanup execution
- **Comprehensive Monitoring**: Track cleanup metrics and history
- **Preview Mode**: Dry-run capability to preview cleanup actions

## Architecture

### Components

1. **ContainerCleanupService**: Core service managing cleanup operations
   - Policy evaluation engine
   - Container state detection
   - Log archival system
   - Statistics tracking

2. **Cleanup Policies**: Configurable rules for container management
   - Idle container detection
   - Failed container cleanup
   - Orphaned container removal
   - Expired container management

3. **REST API**: Management and monitoring interface
   - Policy configuration
   - History tracking
   - Manual triggers
   - Preview capabilities

4. **Database Schema**: Persistent storage for history and logs
   - `archived_logs`: Container logs preservation
   - `cleanup_history`: Cleanup run statistics
   - `cleanup_details`: Detailed action records

## Default Cleanup Policies

### 1. Idle Container Cleanup
Removes containers that have been inactive for a specified period.

```json
{
  "id": "idle-containers",
  "name": "Idle Container Cleanup",
  "type": "idle",
  "conditions": {
    "idleTimeMinutes": 30,
    "excludeLabels": ["persistent", "no-cleanup"]
  },
  "actions": {
    "stopContainer": true,
    "removeContainer": true,
    "archiveLogs": true,
    "notifyOnCleanup": false
  }
}
```

### 2. Failed Container Cleanup
Removes containers that exited with non-zero status codes.

```json
{
  "id": "failed-containers",
  "name": "Failed Container Cleanup",
  "type": "failed",
  "conditions": {
    "maxRetries": 3,
    "idleTimeMinutes": 10
  },
  "actions": {
    "stopContainer": true,
    "removeContainer": true,
    "archiveLogs": true,
    "notifyOnCleanup": true
  }
}
```

### 3. Orphaned Container Cleanup
Removes containers with no associated job or runner.

```json
{
  "id": "orphaned-containers",
  "name": "Orphaned Container Cleanup",
  "type": "orphaned",
  "conditions": {
    "idleTimeMinutes": 60
  },
  "actions": {
    "stopContainer": true,
    "removeContainer": true,
    "archiveLogs": false,
    "notifyOnCleanup": true
  }
}
```

### 4. Expired Container Cleanup
Removes containers that exceed maximum lifetime.

```json
{
  "id": "expired-containers",
  "name": "Expired Container Cleanup",
  "type": "expired",
  "conditions": {
    "maxLifetimeHours": 24
  },
  "actions": {
    "stopContainer": true,
    "removeContainer": true,
    "archiveLogs": true,
    "notifyOnCleanup": false
  }
}
```

## API Reference

### Policy Management

#### GET /api/cleanup/policies
Get all cleanup policies with their current configuration.

**Response:**
```json
{
  "success": true,
  "data": [{
    "id": "idle-containers",
    "name": "Idle Container Cleanup",
    "enabled": true,
    "type": "idle",
    "conditions": {
      "idleTimeMinutes": 30,
      "excludeLabels": ["persistent", "no-cleanup"]
    },
    "actions": {
      "stopContainer": true,
      "removeContainer": true,
      "archiveLogs": true,
      "notifyOnCleanup": false
    },
    "lastRun": "2024-01-01T12:00:00Z",
    "statistics": {
      "containersCleanedTotal": 150,
      "lastCleanupCount": 5,
      "diskSpaceReclaimed": 15728640000
    }
  }]
}
```

#### PUT /api/cleanup/policies/:id
Update a cleanup policy configuration.

**Request:**
```json
{
  "enabled": false,
  "conditions": {
    "idleTimeMinutes": 45
  },
  "actions": {
    "notifyOnCleanup": true
  }
}
```

### Cleanup Operations

#### POST /api/cleanup/trigger
Manually trigger a cleanup run.

**Response:**
```json
{
  "success": true,
  "message": "Cleanup triggered successfully. Check cleanup history for results."
}
```

#### GET /api/cleanup/preview
Preview containers that would be cleaned up (dry run).

**Query Parameters:**
- `policyId` (optional): Preview specific policy

**Response:**
```json
{
  "success": true,
  "data": {
    "containersToClean": [{
      "id": "abc123",
      "name": "runner-container-1",
      "state": "running",
      "createdAt": "2024-01-01T10:00:00Z",
      "reason": "Idle for 45 minutes"
    }],
    "totalContainers": 25,
    "policies": [{
      "id": "idle-containers",
      "name": "Idle Container Cleanup",
      "containers": [...]
    }]
  }
}
```

### History & Metrics

#### GET /api/cleanup/history
Get cleanup run history.

**Query Parameters:**
- `hours`: Time window (default: 24)

**Response:**
```json
{
  "success": true,
  "data": {
    "timeWindow": "24 hours",
    "history": [{
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "timestamp": "2024-01-01T12:00:00Z",
      "policies_executed": 4,
      "containers_inspected": 50,
      "containers_cleaned": 8,
      "errors": 0,
      "disk_space_reclaimed": 838860800
    }]
  }
}
```

#### GET /api/cleanup/last-result
Get the most recent cleanup run result.

**Response:**
```json
{
  "success": true,
  "data": {
    "timestamp": "2024-01-01T12:00:00Z",
    "policiesExecuted": 4,
    "containersInspected": 50,
    "containersCleaned": 8,
    "errors": 0,
    "diskSpaceReclaimed": 838860800,
    "details": [{
      "containerId": "abc123",
      "containerName": "runner-1",
      "policy": "Idle Container Cleanup",
      "reason": "idle container cleanup",
      "action": "removed"
    }]
  }
}
```

#### GET /api/cleanup/statistics
Get aggregate cleanup statistics.

**Query Parameters:**
- `days`: Time window (default: 7)

**Response:**
```json
{
  "success": true,
  "data": {
    "timeWindow": "7 days",
    "policies": [{
      "id": "idle-containers",
      "name": "Idle Container Cleanup",
      "enabled": true,
      "lastRun": "2024-01-01T12:00:00Z",
      "statistics": {
        "containersCleanedTotal": 523,
        "diskSpaceReclaimed": 54975581184
      }
    }],
    "summary": {
      "totalContainersCleaned": 892,
      "totalDiskSpaceReclaimed": 93415538688,
      "enabledPolicies": 4,
      "totalPolicies": 4
    }
  }
}
```

## Container Protection

### Exclude Labels

Containers can be protected from cleanup by adding specific labels:

```yaml
# Docker label format
labels:
  runnerhub.persistent: "true"      # Never cleanup
  runnerhub.no-cleanup: "true"      # Skip all cleanup policies
```

### Container Labels in Docker

```bash
# Create a persistent container
docker run -d \
  --label runnerhub.persistent=true \
  --name important-runner \
  runner-image:latest

# Create a container excluded from cleanup
docker run -d \
  --label runnerhub.no-cleanup=true \
  --name temporary-debug \
  runner-image:latest
```

## Cleanup Schedule

The cleanup service runs automatically every 5 minutes, evaluating all enabled policies. The schedule ensures:

1. **Regular Maintenance**: Frequent checks prevent resource accumulation
2. **Low Overhead**: Efficient evaluation minimizes performance impact
3. **Configurable Timing**: Adjust intervals based on workload

## Log Archival

Before removing containers, logs are archived for audit and debugging:

1. **Automatic Collection**: Last 1000 lines preserved
2. **Timestamped Storage**: Maintains chronological order
3. **Database Persistence**: Queryable for analysis
4. **Configurable Retention**: Set archive lifetime

### Accessing Archived Logs

```sql
-- Query archived logs
SELECT container_id, container_name, logs, archived_at
FROM runnerhub.archived_logs
WHERE container_name LIKE 'runner-%'
ORDER BY archived_at DESC;
```

## Best Practices

### 1. Policy Configuration

- **Start Conservative**: Begin with longer idle times
- **Monitor Impact**: Track cleanup frequency
- **Adjust Gradually**: Fine-tune based on usage patterns
- **Document Changes**: Log policy modifications

### 2. Container Labeling

```yaml
# Production containers - never cleanup
labels:
  runnerhub.persistent: "true"
  runnerhub.environment: "production"

# Development containers - aggressive cleanup
labels:
  runnerhub.environment: "development"
  runnerhub.max-lifetime: "4h"

# Debug containers - temporary protection
labels:
  runnerhub.no-cleanup: "true"
  runnerhub.debug: "true"
```

### 3. Monitoring

- **Review History**: Check cleanup patterns weekly
- **Track Metrics**: Monitor disk space reclaimed
- **Validate Policies**: Ensure intended containers cleaned
- **Set Alerts**: Notify on cleanup failures

### 4. Performance Optimization

- **Efficient Queries**: Use indexed container properties
- **Batch Operations**: Group cleanup actions
- **Async Processing**: Non-blocking cleanup execution
- **Resource Limits**: Cap concurrent cleanups

## Troubleshooting

### Common Issues

1. **Containers Not Being Cleaned**
   - Verify policy is enabled
   - Check exclude labels
   - Review container state
   - Examine cleanup history

2. **Excessive Cleanup**
   - Increase idle thresholds
   - Add exclude labels
   - Disable aggressive policies
   - Review container lifecycle

3. **Cleanup Failures**
   - Check container permissions
   - Verify Docker daemon access
   - Review error logs
   - Validate container state

### Debug Commands

```bash
# Preview cleanup without execution
curl http://localhost:3000/api/cleanup/preview

# Check specific policy
curl http://localhost:3000/api/cleanup/policies/idle-containers

# View recent cleanup history
curl "http://localhost:3000/api/cleanup/history?hours=1"

# Get last cleanup details
curl http://localhost:3000/api/cleanup/last-result
```

## Integration with Monitoring

The cleanup service integrates with the monitoring system:

1. **Real-time Events**: Cleanup actions broadcast via WebSocket
2. **Metrics Collection**: Statistics fed to Prometheus
3. **Dashboard Integration**: Visual cleanup tracking
4. **Alert Generation**: Notifications on anomalies

```javascript
// Listen for cleanup events
monitoringService.on('cleanup-event', (data) => {
  console.log('Cleanup completed:', {
    containersCleaned: data.containersCleaned,
    diskSpaceReclaimed: data.diskSpaceReclaimed
  });
});
```

## Security Considerations

1. **Access Control**: Restrict policy modifications
2. **Audit Trail**: Log all configuration changes
3. **Container Validation**: Verify container ownership
4. **Resource Limits**: Prevent excessive cleanup operations

## Performance Metrics

- **Evaluation Time**: <100ms per container
- **Cleanup Duration**: 1-5s per container
- **Memory Usage**: ~10MB base + 1KB per container
- **CPU Impact**: <5% during cleanup runs

## Future Enhancements

1. **Custom Policies**: User-defined cleanup rules
2. **ML-Based Detection**: Predictive container lifecycle
3. **Cost Analytics**: Track savings from cleanup
4. **External Integration**: Webhook notifications
5. **Advanced Scheduling**: Cron-based policy execution