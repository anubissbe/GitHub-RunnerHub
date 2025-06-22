# GitHub RunnerHub Orchestrator Architecture

## Overview

The GitHub RunnerHub Orchestrator system represents a fundamental shift from traditional dedicated GitHub Actions runners to a sophisticated, container-based orchestration platform. This system provides enhanced scalability, resource efficiency, and operational flexibility while maintaining full compatibility with GitHub Actions workflows.

## Architecture Goals

- **Replace dedicated runners** with dynamic container assignment
- **Intelligent load balancing** across available compute resources
- **Real-time status reporting** and comprehensive monitoring
- **Seamless GitHub integration** with webhook-driven automation
- **Horizontal scalability** with automatic resource management
- **High availability** with health monitoring and auto-recovery

## System Components

### Core Orchestrator (`RunnerOrchestrator`)

The central coordination engine that manages the entire orchestrator lifecycle.

**Key Responsibilities:**
- GitHub webhook event processing
- Job queue management and prioritization
- Container assignment coordination
- Health monitoring and metrics collection
- Graceful shutdown and recovery

**Status Management:**
- `INITIALIZING` - System startup and component initialization
- `READY` - Accepting and processing jobs
- `PROCESSING` - Actively executing workflows
- `SCALING` - Adjusting container capacity
- `DRAINING` - Graceful shutdown in progress
- `STOPPED` - System halted
- `ERROR` - Critical failure state

### Container Assignment Manager (`ContainerAssignmentManager`)

Sophisticated container selection and assignment engine with multiple load balancing strategies.

**Load Balancing Strategies:**
1. **Round-Robin** - Distributes jobs evenly across containers
2. **Least-Loaded** - Assigns to containers with lowest utilization
3. **Resource-Aware** - Considers resource requirements and availability
4. **Affinity-Based** - Respects job affinity and anti-affinity rules

**Container Lifecycle:**
```
CREATING → READY → ASSIGNED → BUSY → [READY | DRAINING | UNHEALTHY] → TERMINATING
```

**Health Monitoring:**
- Connectivity checks
- Resource utilization tracking
- Automatic unhealthy container isolation
- Recovery detection and reintegration

### Job Parser and Validator (`JobParser`)

Comprehensive GitHub Actions job configuration parser with validation.

**Supported Features:**
- Container and service definitions
- Step parsing (actions and run commands)
- Matrix strategy handling
- Environment variable processing
- Timeout and error handling configuration
- Label-based runner selection

**Validation Categories:**
- Required field validation
- Container image compatibility
- Resource requirement feasibility
- Step configuration correctness
- Security policy compliance

### Status Reporter (`StatusReporter`)

Real-time GitHub integration for job status updates and reporting.

**Reporting Pipeline:**
1. **Queue Management** - Batched status updates for efficiency
2. **GitHub Integration** - Check run creation and updates
3. **Retry Logic** - Automatic retry with exponential backoff
4. **Error Handling** - Graceful degradation and alerting

**Supported Status Types:**
- Job queued, started, and completed
- Step-by-step progress reporting
- Real-time log streaming
- Test result annotations
- Performance metrics

### Webhook Handler (`OrchestratorWebhookHandler`)

Secure GitHub webhook processing with signature verification.

**Supported Events:**
- `workflow_job` - Primary job execution events
- `workflow_run` - Workflow-level coordination
- `check_run` - Check re-runs and updates
- `check_suite` - Suite-level operations
- `repository` - Repository configuration changes
- `organization` - Organization-level events

### Monitoring System (`OrchestratorMonitor` + `OrchestratorDashboard`)

Comprehensive monitoring, alerting, and dashboard system.

**Health Metrics:**
- Component health status (orchestrator, containers, database, queues)
- Resource utilization tracking
- Job throughput and completion rates
- Error rates and failure analysis
- Response time monitoring

**Alerting System:**
- Configurable thresholds for all metrics
- Multi-level alerting (info, warning, critical)
- Automatic alert resolution tracking
- Integration with external monitoring systems

## Workflow Processing Flow

### 1. Webhook Reception
```
GitHub → Webhook Handler → Signature Verification → Event Queue
```

### 2. Job Processing
```
Event Queue → Job Parser → Validation → Orchestrator → Container Assignment
```

### 3. Execution Management
```
Container Assignment → Job Execution → Status Reporting → GitHub Updates
```

### 4. Completion Handling
```
Job Completion → Container Release → Metrics Collection → Cleanup
```

## Container Management

### Resource Estimation
The system automatically estimates resource requirements based on:
- Job labels (`large-runner`, `xlarge-runner`)
- Historical execution data
- Workflow type analysis
- Explicit resource requests

### Auto-Scaling Logic
```typescript
if (pendingJobs > 5 && containerUtilization > 0.8) {
  // Scale up containers
} else if (activeJobs < 2 && containerUtilization < 0.3) {
  // Scale down containers
}
```

### Health Monitoring
- **Connectivity Checks** - Network reachability
- **Resource Monitoring** - CPU, memory, disk, network utilization  
- **Docker Daemon Status** - Container runtime health
- **Heartbeat Tracking** - Regular health check responses

## Priority and Scheduling

### Job Priority Levels
1. **CRITICAL** - Deployment and release workflows
2. **HIGH** - Urgent jobs and high-priority workflows
3. **NORMAL** - Standard CI/CD workflows
4. **LOW** - Non-critical background jobs

### Scheduling Factors
- Job priority level
- Resource requirements
- Container affinity rules
- Queue wait time
- Historical execution patterns

## Integration Architecture

### Database Integration
- **PostgreSQL** - Primary data storage for jobs, containers, metrics
- **Redis** - Queue management and caching
- **Persistent Storage** - Job logs, artifacts, and historical data

### GitHub Integration
- **Check Runs API** - Real-time status updates
- **Webhooks** - Event-driven job processing
- **Repository API** - Configuration and metadata
- **Actions API** - Runner registration and management

### Monitoring Integration
- **Prometheus Metrics** - Time-series data export
- **Grafana Dashboards** - Visual monitoring interfaces
- **AlertManager** - Alert routing and notification
- **Custom Webhooks** - External system integration

## Security Considerations

### Webhook Security
- **Signature Verification** - HMAC-SHA256 validation
- **Timing Attack Protection** - Constant-time comparison
- **Rate Limiting** - DOS protection
- **IP Whitelist** - GitHub IP range validation

### Container Security
- **Image Validation** - Approved image registry enforcement
- **Resource Limits** - CPU, memory, and disk quotas
- **Network Isolation** - Container-to-container communication controls
- **Secret Management** - Secure environment variable handling

### Access Control
- **GitHub Token Validation** - Scope and permission verification
- **Repository Access** - Fine-grained permission checking
- **Audit Logging** - Complete action audit trail
- **Encryption** - Data at rest and in transit protection

## Migration Strategy

### Phase 1: Hybrid Mode
- Run orchestrator alongside existing runners
- Route specific job types to orchestrator
- Gradual migration of workflows
- Fallback to traditional runners for unsupported cases

### Phase 2: Full Migration
- Complete replacement of dedicated runners
- All jobs processed through orchestrator
- Traditional runner infrastructure decommissioning
- Performance optimization and tuning

### Migration Decision Logic
```typescript
function shouldUseOrchestrator(jobLabels: string[]): boolean {
  const orchestratorLabels = ['self-hosted', 'linux', 'docker'];
  const traditionalLabels = ['windows', 'macos'];
  
  const hasOrchestratorLabels = jobLabels.some(label => 
    orchestratorLabels.includes(label.toLowerCase())
  );
  
  const hasTraditionalLabels = jobLabels.some(label => 
    traditionalLabels.includes(label.toLowerCase())
  );
  
  return hasOrchestratorLabels && !hasTraditionalLabels;
}
```

## Performance Characteristics

### Scalability Metrics
- **Concurrent Jobs** - Up to 1000+ simultaneous executions
- **Container Pool** - Dynamic scaling from 10 to 500+ containers
- **Throughput** - 100+ jobs per minute processing capacity
- **Response Time** - Sub-second job assignment and status updates

### Resource Efficiency
- **Container Reuse** - 80%+ container utilization improvement
- **Resource Optimization** - Right-sized container allocation
- **Queue Management** - Minimal job wait times
- **Auto-scaling** - Demand-based capacity adjustment

## Operational Procedures

### Deployment
1. Database schema initialization
2. Container registry configuration
3. GitHub webhook registration
4. Orchestrator service deployment
5. Monitoring system setup
6. Health check validation

### Monitoring
- **Dashboard Access** - Real-time system status
- **Alert Configuration** - Threshold-based notifications
- **Metric Collection** - Historical performance data
- **Log Aggregation** - Centralized logging system

### Troubleshooting
- **Health Check API** - Component status verification
- **Debug Logging** - Detailed execution tracing
- **Container Inspection** - Direct container access
- **Failover Procedures** - Automatic and manual recovery

### Backup and Recovery
- **Database Backups** - Automated daily snapshots
- **Configuration Backup** - Version-controlled settings
- **State Recovery** - Job queue and assignment restoration
- **Disaster Recovery** - Cross-region failover capability

## Future Enhancements

### Planned Features
- **Multi-Cloud Support** - AWS, Azure, GCP container orchestration
- **GPU Support** - Machine learning and compute-intensive workloads
- **Cost Optimization** - Spot instance and preemptible container support
- **Advanced Scheduling** - Gang scheduling and resource reservation

### Integration Roadmap
- **Kubernetes Integration** - Native k8s job execution
- **Terraform Provider** - Infrastructure as code support
- **CI/CD Platform Integration** - Jenkins, GitLab CI, Azure DevOps
- **Observability Enhancement** - OpenTelemetry and distributed tracing

## Configuration Reference

### Environment Variables
```bash
# Core Configuration
ORCHESTRATOR_MAX_CONCURRENT_JOBS=100
ORCHESTRATOR_CONTAINER_POOL_SIZE=200
ORCHESTRATOR_HEALTH_CHECK_INTERVAL=30000
ORCHESTRATOR_METRICS_INTERVAL=60000

# GitHub Integration
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_TOKEN=your-github-token
GITHUB_ORG=your-organization

# Database Configuration
DATABASE_URL=postgresql://user:pass@host:5432/database
REDIS_URL=redis://host:6379

# Security
WEBHOOK_BASE_URL=https://your-domain.com
CONTAINER_REGISTRY_URL=your-registry.com
```

### Database Schema
```sql
-- Core tables for orchestrator system
CREATE TABLE orchestrator_jobs (
  id VARCHAR PRIMARY KEY,
  repository VARCHAR NOT NULL,
  workflow VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  container_id VARCHAR,
  metadata JSONB
);

CREATE TABLE container_assignments (
  id SERIAL PRIMARY KEY,
  job_id VARCHAR NOT NULL,
  container_id VARCHAR NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP,
  priority INTEGER DEFAULT 3
);

CREATE TABLE container_registry (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  image VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  labels JSONB,
  resources JSONB,
  health_status JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_heartbeat TIMESTAMP
);
```

This orchestrator architecture provides a robust, scalable, and maintainable foundation for modern GitHub Actions execution, replacing traditional dedicated runners with intelligent container orchestration.