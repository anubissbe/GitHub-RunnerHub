# GitHub-RunnerHub Development Guide

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Development Setup](#development-setup)
3. [Code Structure](#code-structure)
4. [API Reference](#api-reference)
5. [Testing Guide](#testing-guide)
6. [Deployment](#deployment)
7. [Troubleshooting](#troubleshooting)

## Architecture Overview

GitHub-RunnerHub implements a proxy runner pattern where lightweight persistent runners intercept GitHub Actions jobs and delegate execution to ephemeral Docker containers.

### Key Components

1. **Proxy Runners**: Persistent GitHub Actions runners with custom hooks
2. **Orchestration Service**: Central API managing job distribution
3. **Job Queue**: Redis-backed BullMQ for reliable job processing
4. **Container Orchestrator**: Manages ephemeral container lifecycle
5. **State Database**: PostgreSQL for job tracking and metrics

### Data Flow

```
GitHub Actions → Proxy Runner → Orchestration API → Job Queue → Container Orchestrator → Ephemeral Container
```

## Development Setup

### Prerequisites

- Node.js 20+ 
- Docker and Docker Compose
- PostgreSQL 16 with pgvector extension
- Redis 7+
- GitHub Personal Access Token with repo and admin:org permissions

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/anubissbe/GitHub-RunnerHub.git
   cd GitHub-RunnerHub
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start infrastructure services**
   ```bash
   docker-compose up -d redis postgres
   ```

5. **Initialize database**
   ```bash
   psql $DATABASE_URL < docker/postgres/init.sql
   ```

6. **Build the project**
   ```bash
   npm run build
   ```

7. **Start development server**
   ```bash
   npm run dev
   ```

## Code Structure

### Directory Layout

```
src/
├── app.ts                 # Express application setup
├── index.ts              # Application entry point
├── config/               # Configuration management
│   └── index.ts         # Config validation and defaults
├── controllers/          # Request handlers
│   └── job-controller.ts # Job delegation logic
├── middleware/           # Express middleware
│   ├── error-handler.ts # Global error handling
│   ├── rate-limiter.ts  # API rate limiting
│   └── request-logger.ts # Request logging
├── routes/               # API route definitions
│   ├── jobs.ts          # Job management endpoints
│   ├── runners.ts       # Runner management
│   ├── metrics.ts       # Prometheus metrics
│   └── health.ts        # Health checks
├── services/             # Business logic
│   ├── container-orchestrator.ts # Docker container management
│   ├── database.ts      # PostgreSQL service
│   ├── github-api.ts    # GitHub API client
│   ├── job-queue.ts     # BullMQ job processing
│   └── proxy-runner.ts  # Proxy runner management
├── types/                # TypeScript type definitions
│   └── index.ts         # Shared types
└── utils/                # Utility functions
    └── logger.ts        # Winston logger setup
```

### Key Services

#### DatabaseService
Singleton service managing PostgreSQL connections with connection pooling.

```typescript
const db = DatabaseService.getInstance();
const results = await db.query('SELECT * FROM jobs WHERE status = $1', ['queued']);
```

#### ContainerOrchestrator
Manages ephemeral Docker containers for job execution.

```typescript
const orchestrator = new ContainerOrchestrator();
const result = await orchestrator.runJob(delegatedJob);
```

#### ProxyRunnerManager
Manages lifecycle of proxy runners.

```typescript
const manager = new ProxyRunnerManager();
await manager.createRunner(config);
```

## API Reference

### Job Management

#### POST /api/jobs/delegate
Delegate a job from proxy runner to ephemeral container.

**Request Body:**
```json
{
  "jobId": "123",
  "runId": "456", 
  "repository": "owner/repo",
  "workflow": "CI",
  "runnerName": "proxy-1",
  "labels": ["ubuntu-latest", "self-hosted"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "delegationId": "uuid",
    "status": "queued"
  }
}
```

#### GET /api/jobs/:id
Get job details by delegation ID.

#### GET /api/jobs
List jobs with pagination.

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 20)
- `repository` (optional)
- `status` (optional)

### Health Check

#### GET /health
Returns system health status.

## Testing Guide

### Unit Tests

Run all tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

Generate coverage report:
```bash
npm test -- --coverage
```

### Integration Tests

Test job delegation flow:
```bash
npm run test:integration
```

### E2E Testing

1. **Start all services**
   ```bash
   docker-compose up -d
   npm start
   ```

2. **Register a proxy runner**
   ```bash
   ./scripts/register-proxy-runner.sh
   ```

3. **Trigger a test workflow**
   ```bash
   ./scripts/test-job-delegation.sh
   ```

### Manual Testing

1. **Test health endpoint**
   ```bash
   curl http://localhost:3000/health
   ```

2. **Test job delegation**
   ```bash
   curl -X POST http://localhost:3000/api/jobs/delegate \
     -H "Content-Type: application/json" \
     -d '{
       "jobId": "test-123",
       "runId": "run-456",
       "repository": "test/repo",
       "workflow": "Test Workflow",
       "runnerName": "proxy-test",
       "labels": ["self-hosted", "ubuntu-latest"]
     }'
   ```

## Deployment

### Docker Deployment

1. **Build images**
   ```bash
   docker-compose build
   ```

2. **Start all services**
   ```bash
   docker-compose up -d
   ```

3. **Scale proxy runners**
   ```bash
   docker-compose up -d --scale proxy-runner=3
   ```

### Production Configuration

1. **Environment Variables**
   - Set `NODE_ENV=production`
   - Use strong JWT_SECRET and ENCRYPTION_KEY
   - Configure proper database credentials
   - Set up Vault integration

2. **Security**
   - Enable TLS/SSL
   - Configure firewall rules
   - Set up network isolation
   - Enable audit logging

3. **Monitoring**
   - Configure Prometheus scraping
   - Set up Grafana dashboards
   - Enable alerting rules
   - Configure log aggregation

## Troubleshooting

### Common Issues

#### Job delegation fails
1. Check proxy runner logs: `docker logs runnerhub-proxy-runner-1`
2. Verify orchestrator is accessible
3. Check GitHub token permissions
4. Review hook script execution

#### Container creation fails
1. Verify Docker daemon access
2. Check Docker socket proxy configuration
3. Review container resource limits
4. Check network configuration

#### Database connection errors
1. Verify PostgreSQL is running
2. Check connection string
3. Review firewall rules
4. Check connection pool settings

### Debug Mode

Enable detailed logging:
```bash
export LOG_LEVEL=debug
export ACTIONS_STEP_DEBUG=true
npm run dev
```

### Monitoring Queries

**Active jobs:**
```sql
SELECT * FROM runnerhub.jobs 
WHERE status IN ('queued', 'running', 'assigned')
ORDER BY created_at DESC;
```

**Runner status:**
```sql
SELECT name, status, last_heartbeat 
FROM runnerhub.runners
WHERE type = 'proxy';
```

**Job metrics:**
```sql
SELECT 
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as total_jobs,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration
FROM runnerhub.jobs
WHERE completed_at IS NOT NULL
GROUP BY hour
ORDER BY hour DESC;
```

## Contributing

1. Follow TypeScript best practices
2. Add tests for new features
3. Update documentation
4. Run linting before committing: `npm run lint`
5. Ensure all tests pass: `npm test`

## Support

- GitHub Issues: Report bugs and feature requests
- Documentation: See `/docs` directory
- Architecture: See `ARCHITECTURE.md`