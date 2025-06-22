# GitHub-RunnerHub System Architecture

## 🏗️ Overview

GitHub-RunnerHub is an enterprise-grade GitHub Actions proxy runner system that provides intelligent orchestration, real-time monitoring, and secure execution environments through ephemeral Docker containers. The system integrates directly with GitHub's API to provide seamless job delegation and execution.

## 📐 High-Level Architecture

```mermaid
graph TB
    subgraph "External Services"
        GH[GitHub API]
        GHW[GitHub Webhooks]
        CLOUD[Cloud Providers<br/>AWS/GCP/Azure]
    end

    subgraph "GitHub-RunnerHub Core"
        subgraph "API Layer"
            API[REST API Server]
            WS[WebSocket Server]
            AUTH[Authentication Layer]
        end

        subgraph "Orchestration Layer"
            ORCH[Container Orchestrator]
            QUEUE[Job Queue<br/>BullMQ/Redis]
            ROUTER[Job Router]
        end

        subgraph "Execution Layer"
            POOL[Container Pool Manager]
            AUTO[Auto-Scaling System]
            EXEC[Job Executor]
        end

        subgraph "Management Layer"
            MON[Monitoring System]
            SEC[Security System]
            RES[Resource Management]
        end

        subgraph "Data Layer"
            PG[(PostgreSQL)]
            REDIS[(Redis)]
            VAULT[HashiCorp Vault]
        end
    end

    subgraph "Self-Hosted Runners"
        R1[Proxy Runner 1]
        R2[Proxy Runner 2]
        RN[Proxy Runner N]
    end

    subgraph "Container Infrastructure"
        C1[Ephemeral Container 1]
        C2[Ephemeral Container 2]
        CN[Ephemeral Container N]
    end

    %% External connections
    GH <--> API
    GHW --> API
    CLOUD <--> AUTO

    %% Internal connections
    API --> ORCH
    WS --> MON
    AUTH --> API
    ORCH --> QUEUE
    ORCH --> POOL
    QUEUE --> ROUTER
    ROUTER --> EXEC
    POOL --> AUTO
    EXEC --> SEC
    EXEC --> RES
    MON --> PG
    MON --> REDIS
    SEC --> VAULT
    
    %% Runner connections
    R1 --> API
    R2 --> API
    RN --> API
    
    %% Container connections
    EXEC --> C1
    EXEC --> C2
    EXEC --> CN
```

## 🎯 Core Components

### 1. API Layer

#### REST API Server
- **Purpose**: Primary interface for all external interactions
- **Technology**: Express.js with TypeScript
- **Key Features**:
  - RESTful endpoints for all operations
  - JWT-based authentication
  - Rate limiting and request validation
  - Comprehensive error handling
  - API versioning support

#### WebSocket Server
- **Purpose**: Real-time updates and live monitoring
- **Technology**: Socket.IO
- **Key Features**:
  - Live dashboard updates
  - Real-time job status notifications
  - System health monitoring
  - Event streaming for external consumers

#### Authentication Layer
- **Purpose**: Security and access control
- **Technology**: JWT with bcrypt
- **Key Features**:
  - Role-based access control (RBAC)
  - Token-based authentication
  - Session management
  - Rate limiting and account lockout

### 2. Orchestration Layer

#### Container Orchestrator
- **Purpose**: Central coordination of container lifecycle
- **Technology**: Docker API integration
- **Key Features**:
  - Container creation and destruction
  - Lifecycle management
  - Health monitoring
  - Resource allocation
  - Performance optimization

#### Job Queue (BullMQ/Redis)
- **Purpose**: Asynchronous job processing and queuing
- **Technology**: BullMQ with Redis backend
- **Key Features**:
  - Priority-based job queuing
  - Retry logic with exponential backoff
  - Job status tracking
  - Dead letter queue handling
  - Horizontal scaling support

#### Job Router
- **Purpose**: Intelligent job routing and runner selection
- **Technology**: Custom routing engine
- **Key Features**:
  - Label-based job matching
  - Repository-specific routing
  - Capability-based selection
  - Fallback routing strategies
  - Performance-optimized matching

### 3. Execution Layer

#### Container Pool Manager
- **Purpose**: Efficient container pool management
- **Technology**: Custom pool management with ML optimization
- **Key Features**:
  - Pre-warmed container pools
  - Dynamic pool sizing
  - Template-based container creation
  - Health monitoring and replacement
  - Resource optimization

#### Auto-Scaling System
- **Purpose**: Intelligent demand-based scaling
- **Technology**: ML-based prediction with cloud integration
- **Key Features**:
  - Demand prediction algorithms
  - Horizontal scaling logic
  - Cost optimization
  - Performance analytics
  - Multi-cloud support

#### Job Executor
- **Purpose**: Secure job execution in isolated containers
- **Technology**: Docker containers with security hardening
- **Key Features**:
  - Isolated execution environments
  - Security scanning and validation
  - Resource limit enforcement
  - Log collection and analysis
  - Cleanup and recovery procedures

### 4. Management Layer

#### Monitoring System
- **Purpose**: Comprehensive system observability
- **Technology**: Prometheus metrics with custom analytics
- **Key Features**:
  - Real-time metrics collection
  - Performance analytics
  - Anomaly detection
  - Dashboard generation
  - Alert management

#### Security System
- **Purpose**: Enterprise-grade security controls
- **Technology**: Multi-layered security architecture
- **Key Features**:
  - Container vulnerability scanning
  - Secret management
  - Network isolation
  - Audit logging
  - Compliance frameworks

#### Resource Management
- **Purpose**: Comprehensive resource control and optimization
- **Technology**: AI-driven resource optimization
- **Key Features**:
  - CPU and memory limits
  - Storage quota management
  - Network bandwidth controls
  - Usage analytics and reporting
  - Cost optimization

### 5. Data Layer

#### PostgreSQL
- **Purpose**: Primary persistent data storage
- **Technology**: PostgreSQL 16 with extensions
- **Key Features**:
  - ACID transactions
  - JSON/JSONB support
  - Full-text search
  - Partitioning and indexing
  - Backup and recovery

#### Redis
- **Purpose**: Caching and session storage
- **Technology**: Redis with persistence
- **Key Features**:
  - High-performance caching
  - Session management
  - Rate limiting storage
  - Pub/sub messaging
  - Data persistence

#### HashiCorp Vault
- **Purpose**: Secrets management and encryption
- **Technology**: HashiCorp Vault
- **Key Features**:
  - Secret storage and rotation
  - Dynamic credentials
  - Encryption as a service
  - Audit logging
  - Fine-grained access policies

## 🔄 Data Flow Architecture

### 1. Job Submission Flow

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant WH as Webhook Handler
    participant Q as Job Queue
    participant R as Job Router
    participant E as Job Executor
    participant C as Container

    GH->>WH: Webhook Event (workflow_job)
    WH->>WH: Validate Signature
    WH->>Q: Queue Job with Priority
    Q->>R: Dequeue Job
    R->>R: Match Job to Runner
    R->>E: Execute Job
    E->>C: Create Isolated Container
    C->>C: Execute Job Steps
    C->>E: Return Results
    E->>GH: Update Job Status
    E->>Q: Mark Job Complete
```

### 2. Scaling Decision Flow

```mermaid
sequenceDiagram
    participant D as Demand Predictor
    participant S as Scaling Controller
    participant P as Container Prewarmer
    participant C as Cost Optimizer
    participant A as Analytics

    D->>D: Analyze Historical Data
    D->>D: Generate Predictions
    D->>S: Send Demand Forecast
    S->>S: Calculate Target Capacity
    S->>C: Check Cost Constraints
    C->>S: Return Cost Guidance
    S->>P: Request Container Scaling
    P->>P: Scale Container Pools
    P->>A: Record Scaling Metrics
    A->>D: Provide Feedback Loop
```

### 3. Security Validation Flow

```mermaid
sequenceDiagram
    participant J as Job Request
    participant S as Security Scanner
    participant V as Vault
    participant N as Network Isolation
    participant E as Executor

    J->>S: Submit for Security Check
    S->>S: Scan for Vulnerabilities
    S->>V: Retrieve Secrets
    V->>S: Return Encrypted Secrets
    S->>N: Setup Network Isolation
    N->>N: Create Isolated Network
    S->>E: Approve for Execution
    E->>E: Execute in Secure Context
```

## 🔧 Integration Architecture

### GitHub API Integration

```mermaid
graph LR
    subgraph "GitHub Services"
        API[GitHub API]
        WH[Webhooks]
        APP[GitHub App]
    end

    subgraph "RunnerHub Integration"
        CACHE[API Cache Layer]
        SYNC[Sync Engine]
        RATE[Rate Limiter]
        AUTH[GitHub Auth]
    end

    subgraph "Internal Services"
        DB[(Database)]
        QUEUE[Job Queue]
        MON[Monitoring]
    end

    API <--> CACHE
    WH --> SYNC
    APP <--> AUTH
    CACHE --> RATE
    RATE --> SYNC
    SYNC --> DB
    SYNC --> QUEUE
    SYNC --> MON
```

### Cloud Provider Integration

```mermaid
graph TB
    subgraph "RunnerHub Core"
        AUTO[Auto-Scaling System]
        COST[Cost Optimizer]
        MON[Monitoring]
    end

    subgraph "AWS Integration"
        EC2[EC2 Instances]
        SPOT[Spot Instances]
        CW[CloudWatch]
        BILL[Billing API]
    end

    subgraph "GCP Integration"
        GCE[Compute Engine]
        PREEMPT[Preemptible VMs]
        STACK[Cloud Monitoring]
        BILLING[Billing API]
    end

    subgraph "Azure Integration"
        VM[Virtual Machines]
        LOW[Low Priority VMs]
        MONITOR[Azure Monitor]
        COST_API[Cost Management API]
    end

    AUTO --> EC2
    AUTO --> GCE
    AUTO --> VM
    COST --> SPOT
    COST --> PREEMPT
    COST --> LOW
    MON --> CW
    MON --> STACK
    MON --> MONITOR
    COST --> BILL
    COST --> BILLING
    COST --> COST_API
```

## 🛡️ Security Architecture

### Defense in Depth

```mermaid
graph TB
    subgraph "Perimeter Security"
        FW[Firewall]
        LB[Load Balancer]
        WAF[Web Application Firewall]
    end

    subgraph "Application Security"
        AUTH[Authentication]
        AUTHZ[Authorization]
        RATE[Rate Limiting]
        VAL[Input Validation]
    end

    subgraph "Container Security"
        SCAN[Vulnerability Scanning]
        ISO[Network Isolation]
        LIMITS[Resource Limits]
        SECRETS[Secret Management]
    end

    subgraph "Data Security"
        ENC[Encryption at Rest]
        TLS[Encryption in Transit]
        AUDIT[Audit Logging]
        BACKUP[Secure Backups]
    end

    FW --> AUTH
    LB --> AUTHZ
    WAF --> RATE
    AUTH --> SCAN
    AUTHZ --> ISO
    RATE --> LIMITS
    VAL --> SECRETS
    SCAN --> ENC
    ISO --> TLS
    LIMITS --> AUDIT
    SECRETS --> BACKUP
```

### Container Isolation

```mermaid
graph TB
    subgraph "Host System"
        KERNEL[Linux Kernel]
        DOCKER[Docker Engine]
        NET[Network Stack]
    end

    subgraph "Container 1"
        APP1[Application]
        NS1[Namespaces]
        CG1[Cgroups]
        SEC1[Seccomp]
    end

    subgraph "Container 2"
        APP2[Application]
        NS2[Namespaces]
        CG2[Cgroups]
        SEC2[Seccomp]
    end

    subgraph "Security Controls"
        APPARMOR[AppArmor]
        SELINUX[SELinux]
        CAPS[Capabilities]
        USER[User Namespaces]
    end

    KERNEL --> NS1
    KERNEL --> NS2
    DOCKER --> CG1
    DOCKER --> CG2
    NET --> SEC1
    NET --> SEC2
    APPARMOR --> APP1
    APPARMOR --> APP2
    SELINUX --> NS1
    SELINUX --> NS2
    CAPS --> CG1
    CAPS --> CG2
    USER --> SEC1
    USER --> SEC2
```

## 📊 Performance Architecture

### Scaling Strategies

```mermaid
graph TB
    subgraph "Horizontal Scaling"
        PRED[Demand Prediction]
        SCALE[Scaling Controller]
        POOL[Container Pools]
    end

    subgraph "Vertical Optimization"
        RES[Resource Optimization]
        CACHE[Caching Layer]
        PERF[Performance Tuning]
    end

    subgraph "Load Distribution"
        LB[Load Balancer]
        ROUTE[Job Router]
        QUEUE[Queue Management]
    end

    subgraph "Performance Monitoring"
        METRICS[Metrics Collection]
        ANALYTICS[Performance Analytics]
        ALERTS[Performance Alerts]
    end

    PRED --> SCALE
    SCALE --> POOL
    RES --> CACHE
    CACHE --> PERF
    LB --> ROUTE
    ROUTE --> QUEUE
    METRICS --> ANALYTICS
    ANALYTICS --> ALERTS
    
    POOL --> METRICS
    PERF --> METRICS
    QUEUE --> METRICS
```

### Caching Architecture

```mermaid
graph TB
    subgraph "Application Layer"
        API[API Requests]
        APP[Application Logic]
    end

    subgraph "Caching Layers"
        L1[L1 Cache<br/>In-Memory]
        L2[L2 Cache<br/>Redis]
        L3[L3 Cache<br/>Database Query Cache]
    end

    subgraph "Data Sources"
        DB[(PostgreSQL)]
        GH[GitHub API]
        EXT[External APIs]
    end

    API --> L1
    L1 --> L2
    L2 --> L3
    L3 --> DB
    APP --> L1
    L1 --> GH
    L2 --> EXT
```

## 🎯 Design Principles

### 1. Scalability
- **Horizontal Scaling**: Components designed for horizontal scaling
- **Stateless Design**: Stateless services for easy scaling
- **Queue-Based Processing**: Asynchronous processing for better throughput
- **Resource Efficiency**: Optimal resource utilization

### 2. Reliability
- **Fault Tolerance**: Graceful handling of component failures
- **Recovery Mechanisms**: Automatic recovery from failures
- **Health Monitoring**: Continuous health checking
- **Data Persistence**: Reliable data storage and backup

### 3. Security
- **Defense in Depth**: Multiple layers of security controls
- **Least Privilege**: Minimal required permissions
- **Isolation**: Strong container and network isolation
- **Audit Trail**: Comprehensive logging and monitoring

### 4. Performance
- **Efficient Resource Usage**: Optimal CPU, memory, and storage usage
- **Caching Strategy**: Multi-level caching for performance
- **Asynchronous Processing**: Non-blocking operations
- **Performance Monitoring**: Continuous performance optimization

### 5. Maintainability
- **Modular Design**: Loosely coupled, highly cohesive modules
- **Clean Architecture**: Clear separation of concerns
- **Documentation**: Comprehensive documentation
- **Testing**: Extensive testing coverage

## 📈 Deployment Architecture

### Development Environment

```mermaid
graph TB
    subgraph "Development Setup"
        DEV[Developer Machine]
        DOCKER[Docker Desktop]
        LOCAL[Local Services]
    end

    subgraph "Local Services"
        PG_L[(PostgreSQL)]
        REDIS_L[(Redis)]
        VAULT_L[Vault]
    end

    DEV --> DOCKER
    DOCKER --> LOCAL
    LOCAL --> PG_L
    LOCAL --> REDIS_L
    LOCAL --> VAULT_L
```

### Production Environment

```mermaid
graph TB
    subgraph "Load Balancer Tier"
        LB[HAProxy/NGINX]
        SSL[SSL Termination]
    end

    subgraph "Application Tier"
        APP1[RunnerHub Instance 1]
        APP2[RunnerHub Instance 2]
        APP3[RunnerHub Instance 3]
    end

    subgraph "Data Tier"
        PG_M[(PostgreSQL Primary)]
        PG_S[(PostgreSQL Replica)]
        REDIS_CLUSTER[(Redis Cluster)]
        VAULT_CLUSTER[Vault Cluster]
    end

    subgraph "Monitoring Tier"
        PROM[Prometheus]
        GRAF[Grafana]
        ALERT[AlertManager]
    end

    LB --> APP1
    LB --> APP2
    LB --> APP3
    SSL --> LB
    APP1 --> PG_M
    APP2 --> PG_M
    APP3 --> PG_M
    PG_M --> PG_S
    APP1 --> REDIS_CLUSTER
    APP2 --> REDIS_CLUSTER
    APP3 --> REDIS_CLUSTER
    APP1 --> VAULT_CLUSTER
    APP2 --> VAULT_CLUSTER
    APP3 --> VAULT_CLUSTER
    PROM --> APP1
    PROM --> APP2
    PROM --> APP3
    GRAF --> PROM
    ALERT --> PROM
```

This comprehensive system architecture provides a solid foundation for understanding how GitHub-RunnerHub operates, scales, and maintains security and reliability in production environments.