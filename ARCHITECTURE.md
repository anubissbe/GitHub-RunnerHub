# GitHub-RunnerHub Proxy Runner Architecture

## Overview

GitHub-RunnerHub is a custom proxy runner system that provides a highly controlled, secure, and scalable execution environment for GitHub Actions. Jobs are dynamically delegated to ephemeral Docker containers, ensuring perfect isolation and deterministic builds.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          GitHub Actions                              │
│                    (Targets: self-hosted-proxy-*)                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS Long-poll
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Proxy Runner Layer                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │  Proxy Runner 1 │  │  Proxy Runner 2 │  │  Proxy Runner N │    │
│  │  (Persistent)   │  │  (Persistent)   │  │  (Persistent)   │    │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘    │
└───────────┼────────────────────┼────────────────────┼──────────────┘
            │                    │                    │
            └────────────────────┴────────────────────┘
                                 │ Job Delegation (REST API)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Orchestration Service                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      Control Plane                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │   │
│  │  │ REST API │  │   Job    │  │  State   │  │  GitHub  │  │   │
│  │  │  Server  │  │  Queue   │  │    DB    │  │   API    │  │   │
│  │  │(Express) │  │ (BullMQ) │  │(Postgres)│  │  Client  │  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Worker Processes                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │   │
│  │  │ Worker 1 │  │ Worker 2 │  │ Worker 3 │  │ Worker N │  │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │   │
│  └───────┼──────────────┼──────────────┼──────────────┼───────┘   │
└──────────┼──────────────┼──────────────┼──────────────┼────────────┘
           │              │              │              │
           ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Docker Execution Plane                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │   Docker    │  │   Docker    │  │   Docker    │                │
│  │   Host 1    │  │   Host 2    │  │   Host N    │                │
│  │ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │                │
│  │ │Container│ │  │ │Container│ │  │ │Container│ │                │
│  │ │(Runner) │ │  │ │(Runner) │ │  │ │(Runner) │ │                │
│  │ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │                │
│  └─────────────┘  └─────────────┘  └─────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Proxy Runner Layer
- **Purpose**: Lightweight, persistent runners registered with GitHub
- **Responsibilities**:
  - Receive job assignments from GitHub Actions
  - Package job context and metadata
  - Delegate execution to Orchestration Service
  - Report job status back to GitHub
- **Implementation**: Modified GitHub Actions runner with custom hooks

### 2. Orchestration Service

#### Control Plane Components:

**REST API Server**
- Express.js application
- Endpoints:
  - `POST /api/jobs/delegate` - Receive job from proxy runner
  - `GET /api/jobs/:id/status` - Check job status
  - `GET /api/metrics` - System metrics
  - `GET /api/health` - Health checks

**Job Queue (BullMQ)**
- Redis-backed job queue
- Handles async job processing
- Retry logic and dead letter queues
- Job prioritization

**State Database (PostgreSQL)**
- Job history and metadata
- Runner registration tracking
- Metrics and analytics
- Configuration storage

**GitHub API Client**
- JIT runner token generation
- Repository access validation
- Workflow status updates

#### Worker Processes:
- Poll job queue for work
- Provision Docker containers
- Monitor container lifecycle
- Clean up after job completion

### 3. Docker Execution Plane
- **Container Lifecycle**: Create → Register → Execute → Destroy
- **Image Management**: Pre-built images with common tools
- **Resource Limits**: CPU, memory, and disk quotas
- **Network Isolation**: Private networks per job

## Security Architecture

### Network Security
```
┌─────────────────────────────────────────────────────┐
│                   Internet                          │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS only
┌────────────────────▼────────────────────────────────┐
│              Load Balancer                          │
│            (TLS termination)                        │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│          Private VPC (10.0.0.0/16)                 │
│  ┌─────────────────────────────────────────────┐   │
│  │    Control Subnet (10.0.1.0/24)            │   │
│  │  ┌───────────┐  ┌───────────┐              │   │
│  │  │Orchestrator│  │ Database │              │   │
│  │  └───────────┘  └───────────┘              │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │    Execution Subnet (10.0.2.0/24)           │   │
│  │  ┌───────────┐  ┌───────────┐              │   │
│  │  │Docker Host│  │Docker Host│              │   │
│  │  └───────────┘  └───────────┘              │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Security Controls
1. **Docker Socket Proxy**: Mandatory for all Docker API access
2. **Secrets Management**: HashiCorp Vault integration
3. **Runtime Security**: Falco for anomaly detection
4. **Image Security**: Docker Content Trust, vulnerability scanning
5. **Access Control**: RBAC with JWT tokens
6. **Audit Logging**: All actions logged with correlation IDs

## Data Flow

1. **Job Reception**
   ```
   GitHub → Proxy Runner → REST API → Job Queue
   ```

2. **Job Execution**
   ```
   Job Queue → Worker → Docker API → Container Creation
   Container → JIT Registration → GitHub Runner Registration
   Container → Job Execution → Results Collection
   ```

3. **Job Completion**
   ```
   Container → Worker → State Update → Proxy Runner → GitHub
   ```

## Technology Stack

### Core Technologies
- **Runtime**: Node.js 20.x LTS
- **Framework**: Express.js
- **Queue**: BullMQ with Redis
- **Database**: PostgreSQL 16 with pgvector
- **Container**: Docker 24.x
- **Monitoring**: Prometheus + Grafana

### Supporting Services
- **Secrets**: HashiCorp Vault
- **Logging**: ELK Stack (Elasticsearch, Logstash, Kibana)
- **Tracing**: OpenTelemetry with Jaeger
- **Security**: Falco, Trivy, Docker Bench

## Deployment Architecture

### High Availability Setup
- Multiple proxy runners for redundancy
- Orchestrator service in active-active configuration
- PostgreSQL with streaming replication
- Redis Sentinel for queue HA

### Scaling Strategy
- **Horizontal**: Add more Docker hosts
- **Vertical**: Increase worker processes
- **Auto-scaling**: Based on queue depth and resource usage

## Operational Considerations

### Monitoring
- Job queue depth and processing times
- Container lifecycle metrics
- Resource utilization (CPU, memory, disk)
- API response times and error rates

### Disaster Recovery
- Database backups every 6 hours
- Cross-region replication for critical data
- Runbook for service restoration
- Regular DR drills

### Maintenance Windows
- Rolling updates for zero downtime
- Canary deployments for new features
- Automated rollback on failure

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- Core proxy runner implementation
- Basic orchestration service
- Manual container provisioning

### Phase 2: Automation (Weeks 3-4)
- Automated container lifecycle
- Job queue implementation
- Basic monitoring

### Phase 3: Security (Weeks 5-6)
- Vault integration
- Network isolation
- Security scanning

### Phase 4: Production (Weeks 7-8)
- High availability setup
- Performance optimization
- Documentation and training

## Cost Considerations

### Infrastructure Costs
- Compute: ~$500-1000/month for base setup
- Storage: ~$100/month for logs and metrics
- Network: ~$50/month for data transfer

### Operational Costs
- Maintenance: 0.5 FTE ongoing
- Monitoring: Included in infrastructure
- Security: Additional tools ~$200/month

## Alternatives Analysis

Before implementing this architecture, consider:
1. **GitHub-hosted runners**: Managed, no maintenance
2. **Actions Runner Controller (ARC)**: Official Kubernetes solution
3. **Third-party services**: WarpBuild, BuildJet, RunsOn

This architecture is recommended only when you have:
- Strict security/compliance requirements
- Need for deep customization
- Existing platform engineering expertise
- Scale that justifies the complexity