# GitHub RunnerHub Orchestrator Quick Start Guide

## Overview

This guide will help you quickly set up and deploy the GitHub RunnerHub Orchestrator system to replace traditional GitHub Actions runners with intelligent container orchestration.

## Prerequisites

- Node.js 18+ or TypeScript environment
- PostgreSQL 13+ database
- Redis 6+ for queue management
- Docker for container orchestration
- GitHub repository with Actions enabled
- GitHub token with appropriate permissions

## Installation

### 1. Environment Setup

```bash
# Clone the repository
git clone https://github.com/your-org/github-runnerhub
cd github-runnerhub

# Install dependencies
npm install

# Build the orchestrator system
npm run build:orchestrator
```

### 2. Database Configuration

```sql
-- Create orchestrator database
CREATE DATABASE github_runnerhub_orchestrator;

-- Run database migrations
npm run migrate:orchestrator
```

### 3. Environment Variables

Create a `.env` file with the following configuration:

```bash
# Core Orchestrator Settings
ORCHESTRATOR_ENABLED=true
ORCHESTRATOR_MAX_CONCURRENT_JOBS=50
ORCHESTRATOR_CONTAINER_POOL_SIZE=100
ORCHESTRATOR_HEALTH_CHECK_INTERVAL=30000
ORCHESTRATOR_METRICS_INTERVAL=60000

# GitHub Integration
GITHUB_TOKEN=ghp_your_github_token_here
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
GITHUB_ORG=your-organization
WEBHOOK_BASE_URL=https://your-domain.com

# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/github_runnerhub_orchestrator
REDIS_URL=redis://localhost:6379

# Container Configuration
CONTAINER_REGISTRY_URL=your-registry.com
DOCKER_SOCKET=/var/run/docker.sock

# Monitoring
LOG_LEVEL=info
METRICS_ENABLED=true
DASHBOARD_ENABLED=true
```

## Quick Deployment

### 1. Start the Orchestrator Service

```bash
# Development mode
npm run dev:orchestrator

# Production mode
npm run start:orchestrator
```

### 2. Verify System Health

```bash
# Check orchestrator status
curl http://localhost:3000/api/orchestrator/health

# Expected response:
{
  "status": "healthy",
  "components": {
    "orchestrator": "healthy",
    "containerAssignment": "healthy",
    "statusReporter": "healthy",
    "database": "healthy",
    "queue": "healthy"
  },
  "uptime": 12345,
  "timestamp": "2024-01-20T10:30:00Z"
}
```

### 3. Register GitHub Webhook

Configure your GitHub repository webhook:
- **URL**: `https://your-domain.com/api/webhooks/orchestrator`
- **Content Type**: `application/json`
- **Secret**: Your webhook secret from environment variables
- **Events**: Select "Workflow jobs" and "Workflow runs"

## Basic Usage

### 1. Container Registration

```typescript
import { ContainerAssignmentManager } from './src/orchestrator/container-assignment';

const manager = ContainerAssignmentManager.getInstance();

// Register a new container
await manager.registerContainer({
  id: 'container-1',
  name: 'ubuntu-runner-1',
  image: 'ubuntu:22.04',
  status: 'ready',
  labels: {
    'self-hosted': 'true',
    'linux': 'true',
    'ubuntu': 'true'
  },
  resources: {
    cpu: 4,
    memory: '8Gi',
    disk: '50Gi'
  },
  healthStatus: {
    healthy: true,
    lastCheck: new Date(),
    checks: {
      connectivity: true,
      diskSpace: true,
      memory: true,
      dockerDaemon: true
    }
  },
  utilization: {
    cpu: 0.1,
    memory: 0.2,
    disk: 0.1,
    network: 0.05
  }
});
```

### 2. Monitor Job Processing

```bash
# View active jobs
curl http://localhost:3000/api/orchestrator/jobs/active

# View pending jobs
curl http://localhost:3000/api/orchestrator/jobs/pending

# View container statistics
curl http://localhost:3000/api/orchestrator/containers/stats
```

### 3. Access Dashboard

Open your browser to `http://localhost:3000/dashboard` to view the real-time orchestrator dashboard with:
- System health status
- Active and pending jobs
- Container utilization
- Performance metrics
- Alert management

## Configuration Options

### Load Balancing Strategies

```typescript
import { ContainerAssignmentManager } from './src/orchestrator/container-assignment';

const manager = ContainerAssignmentManager.getInstance();

// Set round-robin strategy
manager.setLoadBalancingStrategy({
  type: 'round-robin'
});

// Set resource-aware strategy
manager.setLoadBalancingStrategy({
  type: 'resource-aware'
});

// Set least-loaded strategy
manager.setLoadBalancingStrategy({
  type: 'least-loaded'
});
```

### Monitoring Configuration

```typescript
import { OrchestratorMonitor } from './src/orchestrator/monitoring/orchestrator-monitor';

const monitor = OrchestratorMonitor.getInstance({
  healthCheckInterval: 30000,
  metricsCollectionInterval: 60000,
  alertThresholds: {
    queueSizeWarning: 50,
    queueSizeCritical: 100,
    containerUtilizationHigh: 0.9,
    containerUtilizationLow: 0.1,
    jobFailureRateHigh: 0.1,
    responseTimeHigh: 5000
  },
  retentionPeriods: {
    metrics: 30, // days
    logs: 7,     // days
    alerts: 90   // days
  }
});
```

## GitHub Actions Workflow Configuration

### Compatible Workflow Example

```yaml
name: CI with Orchestrator
on: [push, pull_request]

jobs:
  test:
    runs-on: [self-hosted, linux, ubuntu]
    container:
      image: node:18
    steps:
      - uses: actions/checkout@v3
      - name: Install dependencies
        run: npm install
      - name: Run tests
        run: npm test
      - name: Build application
        run: npm run build

  deploy:
    needs: test
    runs-on: [self-hosted, linux, large-runner]
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to production
        run: ./scripts/deploy.sh
```

### Migration from Traditional Runners

1. **Update runner labels** in your workflows:
   ```yaml
   # Before
   runs-on: ubuntu-latest
   
   # After
   runs-on: [self-hosted, linux, ubuntu]
   ```

2. **Add resource hints** for better container assignment:
   ```yaml
   runs-on: [self-hosted, linux, large-runner]  # For resource-intensive jobs
   runs-on: [self-hosted, linux, xlarge-runner] # For very large jobs
   ```

3. **Specify container requirements** when needed:
   ```yaml
   container:
     image: node:18
     options: --cpus="2" --memory="4g"
   ```

## Monitoring and Troubleshooting

### Health Checks

```bash
# Check orchestrator health
curl http://localhost:3000/api/orchestrator/health

# Check specific component
curl http://localhost:3000/api/orchestrator/health/containers

# View system metrics
curl http://localhost:3000/api/orchestrator/metrics
```

### Log Analysis

```bash
# View orchestrator logs
docker logs github-runnerhub-orchestrator

# View container assignment logs
curl http://localhost:3000/api/orchestrator/logs?component=container-assignment

# View status reporter logs
curl http://localhost:3000/api/orchestrator/logs?component=status-reporter
```

### Common Issues

1. **No containers available**
   ```bash
   # Check container registration
   curl http://localhost:3000/api/orchestrator/containers
   
   # Register new containers if needed
   curl -X POST http://localhost:3000/api/orchestrator/containers \
     -H "Content-Type: application/json" \
     -d '{"id":"container-1","name":"ubuntu-1","image":"ubuntu:22.04",...}'
   ```

2. **Jobs stuck in pending**
   ```bash
   # Check queue status
   curl http://localhost:3000/api/orchestrator/queue/status
   
   # Restart queue processing if needed
   curl -X POST http://localhost:3000/api/orchestrator/queue/restart
   ```

3. **GitHub webhook not working**
   ```bash
   # Test webhook endpoint
   curl -X POST http://localhost:3000/api/webhooks/orchestrator \
     -H "Content-Type: application/json" \
     -H "X-GitHub-Event: workflow_job" \
     -d '{"action":"queued","workflow_job":{...}}'
   ```

## Performance Optimization

### Container Pool Sizing

```bash
# Monitor container utilization
curl http://localhost:3000/api/orchestrator/containers/utilization

# Adjust pool size based on demand
export ORCHESTRATOR_CONTAINER_POOL_SIZE=200
```

### Queue Management

```bash
# Monitor queue metrics
curl http://localhost:3000/api/orchestrator/queue/metrics

# Adjust batch processing
export ORCHESTRATOR_BATCH_SIZE=10
export ORCHESTRATOR_PROCESS_INTERVAL=5000
```

## Production Deployment

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY docs/ ./docs/

EXPOSE 3000
CMD ["npm", "run", "start:orchestrator"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: github-runnerhub-orchestrator
spec:
  replicas: 3
  selector:
    matchLabels:
      app: github-runnerhub-orchestrator
  template:
    metadata:
      labels:
        app: github-runnerhub-orchestrator
    spec:
      containers:
      - name: orchestrator
        image: your-registry/github-runnerhub-orchestrator:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: orchestrator-secrets
              key: database-url
        - name: GITHUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: orchestrator-secrets
              key: github-token
```

## Next Steps

1. **Configure monitoring** - Set up Grafana dashboards and Prometheus metrics
2. **Scale containers** - Add more container capacity based on job demand
3. **Optimize performance** - Tune load balancing and resource allocation
4. **Enable advanced features** - Configure affinity rules and custom scheduling
5. **Set up backup** - Implement database backup and disaster recovery

For detailed configuration options and advanced usage, see the [Architecture Documentation](./ORCHESTRATOR_ARCHITECTURE.md).