# Container Lifecycle Management

## Overview

The Container Lifecycle Management system provides comprehensive control over Docker containers used for GitHub Actions job execution. It handles creation, monitoring, resource management, and cleanup of ephemeral runner containers with enterprise-grade reliability.

## Architecture

### Core Components

1. **ContainerLifecycleManager**: Central service managing all container operations
2. **ContainerOrchestratorV2**: High-level orchestration for job execution
3. **ContainerController**: REST API for container management
4. **Resource Monitoring**: Real-time tracking of CPU, memory, and I/O usage

### Container States

```
CREATING → CREATED → STARTING → RUNNING → STOPPING → STOPPED → REMOVING → REMOVED
                                     ↓
                                   ERROR
```

## Features

### 1. Container Creation & Configuration

#### Resource Limits
```typescript
interface ContainerLimits {
  cpuShares?: number;    // Default: 1024 (1 CPU)
  cpuQuota?: number;     // Microseconds per period
  memoryMB?: number;     // Memory limit in MB
  diskGB?: number;       // Disk space limit
  pidsLimit?: number;    // Process ID limit
}
```

#### Security Configuration
- Read-only root filesystem option
- Dropped capabilities (ALL by default)
- No new privileges flag
- Custom security options
- User namespace isolation

### 2. Real-Time Monitoring

#### Resource Usage Tracking
```typescript
interface ResourceUsage {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
}
```

- CPU usage percentage
- Memory consumption and limits
- Network I/O statistics
- Block device I/O metrics

### 3. Lifecycle Events

The system emits events for all state transitions:
- `container:created`
- `container:starting`
- `container:started`
- `container:stopping`
- `container:stopped`
- `container:removing`
- `container:removed`
- `container:error`
- `container:high-cpu`
- `container:high-memory`

## API Endpoints

### Container Management

#### GET /api/containers
List all containers with optional filters.

**Query Parameters:**
- `state`: Filter by container state
- `repository`: Filter by repository
- `jobId`: Filter by job ID

**Response:**
```json
{
  "success": true,
  "data": [{
    "id": "container-id",
    "name": "runner-abc123",
    "state": "running",
    "runnerId": "runner-uuid",
    "jobId": "job-uuid",
    "repository": "owner/repo",
    "created": "2024-01-01T00:00:00Z",
    "resourceUsage": {
      "cpuPercent": 45.2,
      "memoryUsage": 1073741824,
      "memoryLimit": 4294967296
    }
  }]
}
```

#### GET /api/containers/:id
Get detailed information about a specific container.

#### POST /api/containers/:id/stop
Stop a running container.

**Request Body:**
```json
{
  "timeout": 30  // Optional, seconds to wait
}
```

#### DELETE /api/containers/:id
Remove a container.

**Request Body:**
```json
{
  "force": false  // Force removal of running container
}
```

### Container Operations

#### POST /api/containers/:id/exec
Execute a command inside a container.

**Request Body:**
```json
{
  "command": ["ls", "-la"],
  "user": "runner",
  "workingDir": "/home/runner",
  "env": ["KEY=value"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "exitCode": 0,
    "output": "command output..."
  }
}
```

#### GET /api/containers/:id/stats
Get real-time resource statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "cpuPercent": 23.5,
    "memoryUsage": 536870912,
    "memoryLimit": 2147483648,
    "networkRx": 1048576,
    "networkTx": 524288,
    "blockRead": 10485760,
    "blockWrite": 5242880
  }
}
```

#### GET /api/containers/:id/logs
Retrieve container logs.

**Query Parameters:**
- `tail`: Number of lines to return (default: 100)
- `timestamps`: Include timestamps (default: false)

### Resource Management

#### GET /api/containers/usage/summary
Get aggregated resource usage across all containers.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalContainers": 5,
    "totalCpuPercent": 125.5,
    "totalMemoryMB": 8192,
    "totalNetworkRxMB": 100,
    "totalNetworkTxMB": 50,
    "containers": [...]
  }
}
```

## Container Creation Flow

1. **Job Assignment**
   - Job delegated to orchestrator
   - Runner registered in database
   - Container configuration prepared

2. **Container Creation**
   ```typescript
   const containerId = await containerLifecycle.createContainer(
     runnerId,
     jobId,
     {
       image: 'myoung34/github-runner:latest',
       env: {
         RUNNER_TOKEN: token,
         REPO_URL: repoUrl,
         EPHEMERAL: 'true'
       },
       labels: {
         'runnerhub.type': 'ephemeral',
         'runnerhub.job': jobId
       }
     },
     {
       cpuShares: 2048,
       memoryMB: 4096,
       pidsLimit: 512
     }
   );
   ```

3. **Container Start**
   - Container started
   - Runner status updated to BUSY
   - Monitoring begins

4. **Job Execution**
   - GitHub runner connects
   - Job executes in isolated environment
   - Resources monitored continuously

5. **Cleanup**
   - Job completes
   - Container stopped
   - Resources released
   - Container removed after grace period

## Resource Monitoring

### Monitoring Intervals
- **Container Stats**: Every 30 seconds
- **Health Checks**: Every 30 seconds
- **Cleanup Scan**: Every 5 minutes

### Resource Alerts
- **High CPU**: >80% utilization
- **High Memory**: >90% of limit
- **Container Stopped**: Unexpected termination

### Automatic Actions
- Log high resource usage
- Emit warning events
- Update monitoring metrics
- Trigger scaling decisions

## Cleanup Policies

### Automatic Cleanup
1. **Completed Jobs**: Containers removed 5 minutes after job completion
2. **Failed Jobs**: Containers preserved for debugging (configurable)
3. **Orphaned Containers**: Removed after 1 hour of inactivity
4. **Stopped Containers**: Cleaned up based on age

### Manual Cleanup
```bash
# Remove specific container
curl -X DELETE http://localhost:3000/api/containers/{id}

# Force remove
curl -X DELETE http://localhost:3000/api/containers/{id} \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

## Security Features

### Container Isolation
- Separate network namespace
- Limited capabilities
- No privileged operations
- Read-only root filesystem option

### Resource Limits
- CPU quota enforcement
- Memory limits with swap prevention
- PID limits to prevent fork bombs
- I/O throttling available

### Access Control
- Container-specific tokens
- Job-bound lifecycle
- Automatic cleanup on failure
- Audit logging

## Integration with Job Queue

The container lifecycle is tightly integrated with the job queue:

1. **Job Queued**: Container configuration prepared
2. **Job Assigned**: Container created and started
3. **Job Running**: Container monitored
4. **Job Complete**: Container stopped and cleaned up

## Troubleshooting

### Common Issues

1. **Container Creation Failures**
   - Check Docker daemon status
   - Verify image availability
   - Check resource limits
   - Review security policies

2. **High Resource Usage**
   - Monitor container stats endpoint
   - Check for runaway processes
   - Review job requirements
   - Adjust resource limits

3. **Cleanup Issues**
   - Check container state
   - Verify removal permissions
   - Look for volume mounts
   - Check for running processes

### Debug Commands

```bash
# List all containers
curl http://localhost:3000/api/containers

# Get container details
curl http://localhost:3000/api/containers/{id}

# Check container logs
curl http://localhost:3000/api/containers/{id}/logs?tail=500

# Execute debug command
curl -X POST http://localhost:3000/api/containers/{id}/exec \
  -H "Content-Type: application/json" \
  -d '{"command": ["ps", "aux"]}'
```

## Best Practices

1. **Resource Allocation**
   - Set appropriate CPU and memory limits
   - Monitor usage patterns
   - Adjust based on job requirements
   - Leave headroom for spikes

2. **Container Images**
   - Use minimal base images
   - Pre-install common dependencies
   - Regular security updates
   - Version pinning

3. **Monitoring**
   - Set up alerts for high usage
   - Track container lifecycle events
   - Monitor cleanup effectiveness
   - Review error logs

4. **Security**
   - Minimal required capabilities
   - Network isolation
   - Regular image scanning
   - Least privilege principle

## Performance Optimization

1. **Image Caching**
   - Pre-pull common images
   - Use local registry mirror
   - Optimize layer caching

2. **Resource Tuning**
   - Profile job requirements
   - Right-size containers
   - Use burstable CPU
   - Optimize memory usage

3. **Cleanup Optimization**
   - Tune grace periods
   - Batch removal operations
   - Monitor cleanup performance

## Future Enhancements

1. **Advanced Scheduling**
   - Node affinity rules
   - Resource reservation
   - Priority queues
   - Spot instance support

2. **Enhanced Monitoring**
   - Prometheus metrics export
   - Custom metrics support
   - Performance profiling
   - Cost tracking

3. **Security Improvements**
   - Runtime security scanning
   - Network policy enforcement
   - Secret injection via Vault
   - Compliance reporting