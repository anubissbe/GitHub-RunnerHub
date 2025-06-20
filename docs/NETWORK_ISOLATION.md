# Network Isolation Implementation

## Overview

GitHub-RunnerHub implements per-repository container network isolation to ensure complete security and prevent cross-repository communication. Each repository gets its own isolated Docker bridge network with unique subnet allocation.

## Architecture

### Network Isolation Service

The `NetworkIsolationService` manages all aspects of Docker network creation, container attachment, and cleanup:

```typescript
class NetworkIsolationService {
  // Core network management
  async createRepositoryNetwork(repository: string): Promise<NetworkInfo>
  async attachContainerToNetwork(containerId: string, repository: string): Promise<void>
  async detachContainerFromNetwork(containerId: string, repository: string): Promise<void>
  async removeRepositoryNetworks(repository: string): Promise<void>
  
  // Monitoring and maintenance
  async cleanupUnusedNetworks(): Promise<CleanupResult>
  async verifyNetworkIsolation(containerId: string): Promise<boolean>
  getNetworkStats(): NetworkStats
}
```

### Network Configuration

- **Subnet Range**: 10.100.0.0/16
- **Per-Repository Subnet**: /24 (254 usable IPs)
- **Network Driver**: bridge (internal mode)
- **DNS**: Disabled for security
- **External Access**: Blocked

### Integration Points

1. **ContainerOrchestratorV2**: Automatically attaches new containers to repository networks
2. **ContainerCleanup**: Detaches containers from networks before removal
3. **NetworkController**: Provides API endpoints for network management
4. **Database**: Tracks all network operations and associations

## Security Features

### 1. Complete Isolation
- Each repository gets a dedicated Docker network
- Networks are marked as "internal" (no external routing)
- Default bridge network disconnected from containers

### 2. Subnet Management
- Automatic subnet allocation (10.100.x.0/24)
- No overlap between repository networks
- Gateway automatically configured

### 3. Access Control
- Network creation requires operator/admin role
- Network removal requires admin role
- All operations are audit logged

## API Endpoints

### List Networks
```http
GET /api/networks
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "networks": [
      {
        "id": "abc123",
        "name": "runnerhub-org-repo",
        "repository": "org/repo",
        "subnet": "10.100.1.0/24",
        "gateway": "10.100.1.1",
        "containers": ["container1", "container2"],
        "created": "2025-06-19T10:00:00Z",
        "lastUsed": "2025-06-19T11:00:00Z"
      }
    ]
  }
}
```

### Create Network
```http
POST /api/networks
Authorization: Bearer <token>
Content-Type: application/json

{
  "repository": "org/repo"
}

Response:
{
  "success": true,
  "data": {
    "network": {
      "id": "abc123",
      "name": "runnerhub-org-repo",
      "subnet": "10.100.1.0/24"
    }
  }
}
```

### Verify Isolation
```http
GET /api/networks/verify-isolation?containerId=abc123
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "isolated": true,
    "networks": ["runnerhub-org-repo"],
    "warnings": []
  }
}
```

## Database Schema

### network_isolation Table
```sql
CREATE TABLE network_isolation (
    network_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    repository VARCHAR(255) NOT NULL,
    subnet CIDR NOT NULL,
    gateway INET NOT NULL,
    driver VARCHAR(50) DEFAULT 'bridge',
    internal BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    removed_at TIMESTAMP WITH TIME ZONE
);
```

### container_network_associations Table
```sql
CREATE TABLE container_network_associations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    container_id VARCHAR(64) NOT NULL,
    network_id VARCHAR(64) NOT NULL,
    repository VARCHAR(255) NOT NULL,
    aliases TEXT[],
    attached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    detached_at TIMESTAMP WITH TIME ZONE
);
```

## Operational Procedures

### Network Cleanup

Networks are automatically cleaned up when:
1. No containers attached for 60 minutes
2. Manual cleanup triggered via API
3. Repository is removed from system

### Monitoring

Network statistics available via:
- `/api/networks/stats` endpoint
- Prometheus metrics
- Database views and functions

### Troubleshooting

#### Container Can't Communicate
1. Verify both containers in same network: `docker network inspect <network>`
2. Check network isolation: `GET /api/networks/verify-isolation`
3. Review audit logs for network operations

#### Network Creation Fails
1. Check available subnet ranges
2. Verify Docker daemon permissions
3. Check for naming conflicts

## Implementation Details

### Subnet Allocation Algorithm
```typescript
private allocateSubnet(): string {
  const usedSubnets = new Set<number>();
  
  for (const network of this.networkCache.values()) {
    const parts = network.subnet.split('.');
    usedSubnets.add(parseInt(parts[2]));
  }
  
  // Find first available subnet
  for (let i = 1; i <= 254; i++) {
    if (!usedSubnets.has(i)) {
      return `10.100.${i}.0/24`;
    }
  }
  
  throw new Error('No available subnets');
}
```

### Network Naming Convention
- Pattern: `runnerhub-<normalized-repo-name>`
- Example: `runnerhub-myorg-myrepo`
- Normalization: lowercase, alphanumeric and hyphens only

### Cleanup Process
1. Query networks idle > 60 minutes
2. Verify no active containers
3. Remove from Docker
4. Mark as removed in database
5. Log cleanup operation

## Performance Considerations

- Network information cached for 10 minutes
- Cleanup runs every 5 minutes
- Subnet allocation O(n) complexity
- Maximum 254 concurrent repository networks

## Future Enhancements

1. **Custom Network Policies**: Allow per-repository network configuration
2. **Inter-Repository Communication**: Controlled communication between specific repositories
3. **Network Metrics**: Bandwidth and packet statistics per network
4. **IPv6 Support**: Dual-stack networking for future compatibility
5. **Network Segmentation**: Multiple networks per repository for different environments