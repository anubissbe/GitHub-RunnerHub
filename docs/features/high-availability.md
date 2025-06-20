# High Availability Architecture

## Overview

This document describes the High Availability (HA) architecture for GitHub RunnerHub, designed to provide fault tolerance, automatic failover, and zero-downtime operations for enterprise production environments.

## Architecture Components

### 1. Load Balancer Layer
- **HAProxy** or **Nginx** as the primary load balancer
- Health checks for all backend services
- Automatic failover and traffic routing
- SSL termination and request distribution

### 2. Application Layer (Orchestration Service)
- **Multiple orchestration service instances** (minimum 3 for quorum)
- **Stateless design** with shared Redis queue and PostgreSQL database
- **Leader election** for singleton operations (cleanup, monitoring)
- **Session affinity** for WebSocket connections

### 3. Proxy Runner Layer
- **Distributed proxy runners** across multiple hosts/regions
- **Auto-registration** with central orchestration service
- **Health monitoring** and automatic replacement
- **Load balancing** across available runners

### 4. Database Layer
- **PostgreSQL Primary-Replica setup** with streaming replication
- **Automatic failover** using Patroni or similar
- **Connection pooling** with PgBouncer
- **Backup and point-in-time recovery**

### 5. Queue Layer
- **Redis Sentinel** for high availability
- **Master-Slave replication** with automatic failover
- **Client reconnection** handling
- **Persistent queue data**

### 6. Storage Layer
- **Shared storage** for logs and artifacts (NFS/S3)
- **Backup automation** to multiple locations
- **Data replication** across availability zones

## Deployment Architecture

```
                          ┌─────────────────┐
                          │   Load Balancer │
                          │    (HAProxy)    │
                          └─────────┬───────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
              │Orchestrator│   │Orchestrator│   │Orchestrator│
              │   Node 1   │   │   Node 2   │   │   Node 3   │
              └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
              │ PostgreSQL │   │   Redis   │   │  Shared   │
              │  Primary   │   │ Sentinel  │   │  Storage  │
              │            │   │ Cluster   │   │   (NFS)   │
              └─────┬─────┘   └───────────┘   └───────────┘
                    │
              ┌─────▼─────┐
              │ PostgreSQL│
              │  Replica  │
              └───────────┘
```

## Configuration Files

### HAProxy Configuration

```haproxy
global
    daemon
    maxconn 4096
    log stdout local0

defaults
    mode http
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms
    option httplog

frontend github_runnerhub_frontend
    bind *:80
    bind *:443 ssl crt /etc/ssl/certs/runnerhub.pem
    redirect scheme https if !{ ssl_fc }
    default_backend github_runnerhub_backend

backend github_runnerhub_backend
    balance roundrobin
    option httpchk GET /health
    server orchestrator1 192.168.1.10:3001 check
    server orchestrator2 192.168.1.11:3001 check
    server orchestrator3 192.168.1.12:3001 check

frontend websocket_frontend
    bind *:3001
    default_backend websocket_backend

backend websocket_backend
    balance source
    option httpchk GET /health
    server ws1 192.168.1.10:3002 check
    server ws2 192.168.1.11:3002 check
    server ws3 192.168.1.12:3002 check
```

### Redis Sentinel Configuration

```redis
# Redis Sentinel Configuration
port 26379
bind 0.0.0.0
sentinel announce-ip ${SENTINEL_ANNOUNCE_IP}
sentinel announce-port 26379

# Master monitoring configuration
sentinel monitor github-runnerhub-redis redis-master 6379 2
sentinel auth-pass github-runnerhub-redis ${REDIS_PASSWORD}
sentinel auth-user github-runnerhub-redis ${REDIS_USER:-default}

# Failure detection
sentinel down-after-milliseconds github-runnerhub-redis 30000
sentinel parallel-syncs github-runnerhub-redis 1
sentinel failover-timeout github-runnerhub-redis 180000

# Notification scripts
sentinel notification-script github-runnerhub-redis /etc/redis/notify.sh
sentinel client-reconfig-script github-runnerhub-redis /etc/redis/reconfig.sh

# Security and monitoring
sentinel deny-scripts-reconfig yes
sentinel resolve-hostnames yes
sentinel announce-hostnames yes
```

## 2. Redis Sentinel for Queue HA

### Overview
Redis Sentinel provides automatic failover for the BullMQ job queue system, ensuring continuous queue operations even during Redis master failures. The implementation includes:

- **3-node Sentinel cluster** for robust consensus
- **Automatic master discovery** and failover
- **HA-aware BullMQ integration** with seamless reconnection
- **Monitoring and alerting** for Redis health
- **Application-level resilience** with retry mechanisms

### Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Orchestrator-1 │    │  Orchestrator-2 │    │  Orchestrator-3 │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │   BullMQ    │ │    │ │   BullMQ    │ │    │ │   BullMQ    │ │
│ │   Queue     │ │    │ │   Queue     │ │    │ │   Queue     │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   │    Redis Sentinel Cluster │
                   │                           │
  ┌────────────────┼───────────────────────────┼────────────────┐
  │                │                           │                │
  ▼                ▼                           ▼                ▼
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│Sentinel │  │Sentinel │  │Sentinel │  │ Master  │  │  Slave  │
│   -1    │  │   -2    │  │   -3    │  │  Redis  │  │  Redis  │
└─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘
```

### Implementation Features

#### 1. HA-Aware Redis Connection Service
```typescript
// Automatic Sentinel discovery and failover
const redisConnection = createBullMQConnection();
// Supports both Sentinel and direct connections
```

#### 2. BullMQ Integration
- **Automatic reconnection** during Redis failover
- **Queue persistence** across master changes
- **Job processing continuity** with minimal interruption
- **Health monitoring** and metrics collection

#### 3. Configuration Management
```yaml
# Environment variables for HA Redis
REDIS_ENABLE_SENTINEL=true
REDIS_SENTINEL_HOSTS=redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379
REDIS_MASTER_NAME=github-runnerhub-redis
REDIS_PASSWORD=secure_password
```

### Deployment and Management

#### 1. Deploy Redis Sentinel Cluster
```bash
# Deploy complete Redis HA stack
./scripts/deploy-redis-sentinel.sh --deploy

# Test cluster connectivity
./scripts/deploy-redis-sentinel.sh --test

# Show cluster status
./scripts/deploy-redis-sentinel.sh --status
```

#### 2. Failover Testing
```bash
# Perform controlled failover test
./scripts/deploy-redis-sentinel.sh --failover-test

# Monitor logs during failover
./scripts/deploy-redis-sentinel.sh --logs
```

#### 3. Health Monitoring
```bash
# Check Redis and Sentinel health
./scripts/setup-redis-sentinel.sh --status

# Continuous health monitoring (in application)
curl http://localhost:3001/api/system/redis-health-ha
```

### Troubleshooting

#### Common Issues
1. **Sentinel Discovery Problems**
   ```bash
   # Check Sentinel configuration
   docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL MASTERS
   
   # Verify master monitoring
   docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL GET-MASTER-ADDR-BY-NAME github-runnerhub-redis
   ```

2. **BullMQ Connection Issues**
   ```bash
   # Test application Redis connection
   curl http://localhost:3001/api/system/redis-health-ha
   
   # Check queue status
   curl http://localhost:3001/api/jobs/metrics
   ```

3. **Failover Not Occurring**
   ```bash
   # Check Sentinel logs
   docker logs redis-sentinel-1
   
   # Verify quorum settings
   docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL MASTERS | grep quorum
   ```

### PostgreSQL Streaming Replication

```postgresql
# Primary postgresql.conf
wal_level = replica
max_wal_senders = 3
max_replication_slots = 3
hot_standby = on
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/archive/%f'
```

```postgresql
# Replica postgresql.conf
hot_standby = on
max_standby_streaming_delay = 30s
wal_receiver_status_interval = 10s
```

## Environment Configuration

### HA-Specific Environment Variables

```bash
# High Availability Configuration
HA_ENABLED=true
HA_NODE_ID=orchestrator-1
HA_CLUSTER_NODES=192.168.1.10,192.168.1.11,192.168.1.12

# Load Balancer
LOAD_BALANCER_URL=https://runnerhub.example.com
LOAD_BALANCER_HEALTH_CHECK=/health

# Database HA
DATABASE_PRIMARY_URL=postgresql://app_user:password@192.168.1.20:5432/github_runnerhub
DATABASE_REPLICA_URL=postgresql://app_user:password@192.168.1.21:5432/github_runnerhub
DATABASE_CONNECTION_POOL_SIZE=20
DATABASE_MAX_CONNECTIONS=100

# Redis HA
REDIS_SENTINEL_HOSTS=192.168.1.20:26379,192.168.1.21:26379,192.168.1.22:26379
REDIS_MASTER_NAME=github-runnerhub-redis
REDIS_SENTINEL_PASSWORD=your_sentinel_password

# Shared Storage
SHARED_STORAGE_PATH=/mnt/shared/runnerhub
NFS_SERVER=192.168.1.30
NFS_MOUNT_POINT=/exports/runnerhub

# Leader Election
LEADER_ELECTION_ENABLED=true
LEADER_ELECTION_TIMEOUT=30000
LEADER_ELECTION_RENEWAL=10000

# Health Checks
HEALTH_CHECK_INTERVAL=30000
HEALTH_CHECK_TIMEOUT=5000
HEALTH_CHECK_RETRIES=3
```

## Implementation Components

### 1. Leader Election Service

The leader election service ensures only one orchestrator instance performs singleton operations like cleanup and monitoring.

```typescript
// src/services/leader-election.ts
export class LeaderElectionService {
    private isLeader = false;
    private leadershipTimer?: NodeJS.Timeout;
    
    async startElection(): Promise<void> {
        // Implementation for leader election using Redis
    }
    
    async renewLeadership(): Promise<void> {
        // Renew leadership lease
    }
    
    async stopElection(): Promise<void> {
        // Clean shutdown and release leadership
    }
}
```

### 2. Health Check Service

Enhanced health checking for HA components:

```typescript
// src/services/ha-health-check.ts
export class HAHealthCheckService {
    async checkDatabaseHealth(): Promise<HealthStatus> {
        // Check both primary and replica
    }
    
    async checkRedisHealth(): Promise<HealthStatus> {
        // Check Redis Sentinel cluster
    }
    
    async checkLoadBalancerHealth(): Promise<HealthStatus> {
        // Check load balancer connectivity
    }
}
```

### 3. Failover Detection

Automatic detection and handling of component failures:

```typescript
// src/services/failover-detector.ts
export class FailoverDetector {
    async detectDatabaseFailover(): Promise<void> {
        // Detect PostgreSQL primary failure
    }
    
    async detectRedisFailover(): Promise<void> {
        // Detect Redis master failover
    }
    
    async handleFailover(component: string): Promise<void> {
        // Execute failover procedures
    }
}
```

## Deployment Procedures

### 1. Initial Setup

```bash
# 1. Deploy load balancer
docker-compose -f docker-compose.ha.yml up -d haproxy

# 2. Setup PostgreSQL replication
./scripts/setup-postgres-replication.sh

# 3. Deploy Redis Sentinel cluster
./scripts/setup-redis-sentinel.sh

# 4. Deploy orchestrator instances
./scripts/deploy-orchestrators.sh

# 5. Configure shared storage
./scripts/setup-shared-storage.sh
```

### 2. Rolling Updates

```bash
# Update orchestrator instances one by one
./scripts/rolling-update.sh --service orchestrator --instances 3
```

### 3. Disaster Recovery

```bash
# Restore from backup
./scripts/disaster-recovery.sh --backup-date 2024-01-01 --restore-point 14:30
```

## Monitoring and Alerting

### Health Check Endpoints

- `/health` - Overall system health
- `/health/database` - Database connectivity and replication status
- `/health/redis` - Redis cluster health
- `/health/leadership` - Leader election status
- `/health/storage` - Shared storage accessibility

### Prometheus Metrics

```prometheus
# High Availability Metrics
runnerhub_ha_leader_status{instance="orchestrator-1"} 1
runnerhub_ha_database_replication_lag_seconds 0.5
runnerhub_ha_redis_sentinel_masters 1
runnerhub_ha_failover_events_total 0
runnerhub_ha_cluster_nodes_healthy 3
```

### Alerting Rules

```yaml
# Alert on leader election failures
- alert: RunnerHubLeaderElectionFailed
  expr: runnerhub_ha_leader_status == 0
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: "GitHub RunnerHub has no leader"

# Alert on database replication lag
- alert: RunnerHubReplicationLag
  expr: runnerhub_ha_database_replication_lag_seconds > 10
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Database replication lag is high"
```

## Testing Procedures

### 1. Failover Testing

```bash
# Test orchestrator failover
./tests/ha/test-orchestrator-failover.sh

# Test database failover
./tests/ha/test-database-failover.sh

# Test Redis failover
./tests/ha/test-redis-failover.sh
```

### 2. Load Testing

```bash
# Test with multiple orchestrator failures
./tests/ha/chaos-testing.sh --kill-instances 2 --duration 10m
```

### 3. Recovery Testing

```bash
# Test full system recovery
./tests/ha/test-disaster-recovery.sh
```

## Operational Procedures

### Daily Operations

1. **Health Monitoring**: Check all health endpoints
2. **Replication Status**: Verify database and Redis replication
3. **Storage Space**: Monitor shared storage usage
4. **Log Analysis**: Review error logs and alerts

### Weekly Operations

1. **Failover Testing**: Test automatic failover mechanisms
2. **Backup Verification**: Verify backup integrity
3. **Performance Review**: Analyze performance metrics
4. **Capacity Planning**: Review resource utilization

### Emergency Procedures

1. **Manual Failover**: Procedures for forced failover
2. **Split-Brain Recovery**: Handle network partition scenarios
3. **Data Corruption Recovery**: Restore from backups
4. **Full System Recovery**: Complete disaster recovery

## Security Considerations

### Network Security
- Use TLS for all inter-component communication
- Network segmentation for database and Redis clusters
- Firewall rules for component access

### Access Control
- Certificate-based authentication for replication
- Role-based access for operational procedures
- Audit logging for all administrative actions

### Data Protection
- Encryption at rest for databases and backups
- Encrypted replication streams
- Secure key management with Vault

## Performance Tuning

### Database Optimization
- Connection pooling configuration
- Replication lag monitoring
- Query performance optimization

### Redis Optimization
- Memory usage optimization
- Sentinel configuration tuning
- Network latency reduction

### Load Balancer Optimization
- Connection limits and timeouts
- Health check intervals
- SSL/TLS performance

## Troubleshooting Guide

### Common Issues

1. **Split-Brain Scenarios**
   - Symptoms: Multiple leaders elected
   - Resolution: Manual intervention to resolve conflicts

2. **Replication Lag**
   - Symptoms: High database replication lag
   - Resolution: Check network connectivity and disk I/O

3. **Redis Master Down**
   - Symptoms: Queue operations failing
   - Resolution: Verify Sentinel failover process

4. **Load Balancer Issues**
   - Symptoms: Service unavailable errors
   - Resolution: Check backend health and configuration

### Log Analysis

```bash
# Check orchestrator logs
docker-compose logs -f orchestrator-1

# Check database replication status
docker-compose exec postgres-primary pg_stat_replication

# Check Redis Sentinel status
docker-compose exec redis-sentinel redis-cli -p 26379 sentinel masters
```

## Backup and Recovery

### Automated Backups

- **Database**: Continuous WAL archiving + daily base backups
- **Redis**: RDB snapshots + AOF persistence
- **Configuration**: Git-based configuration management
- **Logs**: Centralized log archiving

### Recovery Procedures

- **Point-in-time recovery** for databases
- **Configuration rollback** using Git
- **Log restoration** from archive storage
- **Complete system rebuild** from backups

## Future Enhancements

1. **Multi-Region Deployment**: Geographic distribution for global HA
2. **Auto-scaling Integration**: Dynamic resource scaling based on load
3. **Advanced Monitoring**: ML-based anomaly detection
4. **Chaos Engineering**: Automated failure injection testing
5. **Service Mesh Integration**: Enhanced inter-service communication

## Support and Escalation

### Support Levels
- **L1**: Basic health monitoring and alerts
- **L2**: Component-level troubleshooting
- **L3**: Architecture-level issue resolution

### Escalation Procedures
1. Check health endpoints and logs
2. Review recent changes and deployments
3. Execute standard troubleshooting procedures
4. Escalate to senior operations team
5. Engage development team if needed

---

This HA architecture provides enterprise-grade reliability and availability for GitHub RunnerHub, ensuring continuous operation even during component failures.