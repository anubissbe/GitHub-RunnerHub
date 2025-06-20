# GitHub-RunnerHub API Reference

## Base URL
```
http://localhost:3000
```

## Authentication
All API endpoints require authentication via Bearer token in the Authorization header:
```
Authorization: Bearer <token>
```

## Common Response Format
All API responses follow this format:
```json
{
  "success": true|false,
  "data": <response_data>,
  "error": "error message (only on failure)",
  "metadata": {
    "timestamp": "2025-06-19T10:00:00Z",
    "version": "1.0.0"
  }
}
```

## Endpoints

### Health Check

#### GET /health
Check the health status of the service and its dependencies.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-06-19T10:00:00Z",
  "checks": {
    "database": "pass"
  }
}
```

**Status Codes:**
- `200`: Service is healthy
- `503`: Service is degraded or unhealthy

### Job Management

#### POST /api/jobs/delegate
Delegate a job from a proxy runner to an ephemeral container.

**Request Body:**
```json
{
  "jobId": "123456",
  "runId": "789012",
  "repository": "owner/repo",
  "workflow": "CI/CD Pipeline",
  "runnerName": "proxy-runner-1",
  "sha": "abc123def456",
  "ref": "refs/heads/main",
  "eventName": "push",
  "actor": "username",
  "labels": ["self-hosted", "ubuntu-latest", "docker"]
}
```

**Required Fields:**
- `jobId`: GitHub job ID
- `runId`: GitHub run ID
- `repository`: Repository in format "owner/repo"

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "delegationId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "queued"
  }
}
```

**Error Responses:**
- `400`: Missing required fields or invalid data
- `401`: Invalid authentication token
- `500`: Internal server error

#### GET /api/jobs/:id
Retrieve details of a specific job by its delegation ID.

**Parameters:**
- `id`: Delegation ID (UUID)

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "githubJobId": 123456,
    "jobId": "build",
    "runId": "789012",
    "repository": "owner/repo",
    "workflow": "CI/CD Pipeline",
    "runnerName": "proxy-runner-1",
    "status": "running",
    "runnerId": "runner-uuid",
    "containerId": "docker-container-id",
    "labels": ["self-hosted", "ubuntu-latest"],
    "startedAt": "2025-06-19T10:00:00Z",
    "completedAt": null,
    "metadata": {
      "delegatedAt": "2025-06-19T09:59:00Z",
      "proxyRunner": "proxy-runner-1"
    }
  }
}
```

**Error Responses:**
- `404`: Job not found

#### GET /api/jobs
List jobs with pagination and filtering.

**Query Parameters:**
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 20, max: 100): Items per page
- `repository` (string, optional): Filter by repository
- `status` (string, optional): Filter by status (queued, assigned, running, completed, failed, cancelled)
- `startDate` (ISO 8601, optional): Filter jobs created after this date
- `endDate` (ISO 8601, optional): Filter jobs created before this date

**Example Request:**
```
GET /api/jobs?page=1&limit=10&repository=owner/repo&status=running
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "githubJobId": 123456,
      "repository": "owner/repo",
      "workflow": "CI/CD Pipeline",
      "status": "running",
      "startedAt": "2025-06-19T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "totalPages": 5
  }
}
```

#### PATCH /api/jobs/:id/status
Update the status of a job (internal use only).

**Parameters:**
- `id`: Delegation ID

**Request Body:**
```json
{
  "status": "running",
  "runnerId": "runner-uuid",
  "containerId": "container-id"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "running",
    "updatedAt": "2025-06-19T10:01:00Z"
  }
}
```

#### POST /api/jobs/:id/proxy-complete
Mark a job as complete from the proxy runner perspective.

**Parameters:**
- `id`: Delegation ID

**Request Body:**
```json
{
  "status": "completed",
  "runId": "789012",
  "jobId": "123456"
}
```

**Response (200 OK):**
```json
{
  "success": true
}
```

#### GET /api/jobs/:id/logs
Retrieve logs for a specific job.

**Parameters:**
- `id`: Delegation ID

**Query Parameters:**
- `tail` (integer, optional): Number of lines from the end
- `follow` (boolean, optional): Stream logs in real-time

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "logs": "2025-06-19T10:00:00Z Starting job execution...\n2025-06-19T10:00:01Z Running tests..."
  }
}
```

### Runner Management

#### GET /api/runners
List all runners (proxy and ephemeral).

**Query Parameters:**
- `type` (string, optional): Filter by runner type (proxy, ephemeral, dedicated)
- `status` (string, optional): Filter by status (idle, busy, offline, starting, stopping)
- `repository` (string, optional): Filter by repository

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "runner-uuid",
      "name": "proxy-runner-1",
      "type": "proxy",
      "status": "idle",
      "labels": ["self-hosted", "ubuntu-latest"],
      "lastHeartbeat": "2025-06-19T10:00:00Z"
    }
  ]
}
```

### Metrics

#### GET /api/metrics
Get Prometheus-compatible metrics.

**Response (200 OK):**
```
# HELP github_runnerhub_jobs_total Total number of jobs processed
# TYPE github_runnerhub_jobs_total counter
github_runnerhub_jobs_total{status="completed"} 42
github_runnerhub_jobs_total{status="failed"} 3

# HELP github_runnerhub_job_duration_seconds Job execution duration
# TYPE github_runnerhub_job_duration_seconds histogram
github_runnerhub_job_duration_seconds_bucket{le="10"} 20
github_runnerhub_job_duration_seconds_bucket{le="30"} 35
```

## WebSocket Events

Connect to WebSocket endpoint at `ws://localhost:3001` for real-time updates.

### Events

#### job:delegated
Emitted when a new job is delegated.
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "repository": "owner/repo",
  "status": "queued"
}
```

#### job:status
Emitted when job status changes.
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "repository": "owner/repo",
  "status": "running"
}
```

### Subscriptions

#### subscribe:repository
Subscribe to events for a specific repository.
```json
{
  "event": "subscribe:repository",
  "data": "owner/repo"
}
```

#### unsubscribe:repository
Unsubscribe from repository events.
```json
{
  "event": "unsubscribe:repository",
  "data": "owner/repo"
}
```

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid input data |
| 401 | Unauthorized - Invalid or missing token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

## Rate Limiting

API requests are rate limited to prevent abuse:
- **Default limit**: 100 requests per 15 minutes per IP
- **Headers**: 
  - `X-RateLimit-Limit`: Request limit
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Reset timestamp

## Examples

### cURL Examples

**Delegate a job:**
```bash
curl -X POST http://localhost:3000/api/jobs/delegate \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "123",
    "runId": "456",
    "repository": "owner/repo",
    "workflow": "CI",
    "runnerName": "proxy-1",
    "labels": ["self-hosted"]
  }'
```

**Get job status:**
```bash
curl http://localhost:3000/api/jobs/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer your-token"
```

**List running jobs:**
```bash
curl "http://localhost:3000/api/jobs?status=running&limit=10" \
  -H "Authorization: Bearer your-token"
```

### JavaScript/TypeScript Example

```typescript
import axios from 'axios';

const client = axios.create({
  baseURL: 'http://localhost:3000',
  headers: {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
  }
});

// Delegate a job
async function delegateJob(jobContext) {
  try {
    const response = await client.post('/api/jobs/delegate', jobContext);
    return response.data.data.delegationId;
  } catch (error) {
    console.error('Failed to delegate job:', error.response?.data);
    throw error;
  }
}

// WebSocket connection
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3001');

socket.on('connect', () => {
  console.log('Connected to WebSocket');
  socket.emit('subscribe:repository', 'owner/repo');
});

socket.on('job:status', (data) => {
  console.log('Job status update:', data);
});
```