# GitHub-RunnerHub API Reference

## 🔗 Overview

The GitHub-RunnerHub API provides comprehensive programmatic access to all system functionality. The API follows RESTful principles and uses JSON for data exchange.

## 🔑 Authentication

All API endpoints require JWT authentication unless explicitly noted.

### Authentication Header
```http
Authorization: Bearer <jwt_token>
```

### Login Endpoint
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your_secure_password"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "refresh_token_here",
  "user": {
    "id": "user_id",
    "username": "admin",
    "role": "admin",
    "permissions": ["read", "write", "admin"]
  },
  "expiresIn": 3600
}
```

## 📊 Base URL

- **Development**: `http://localhost:3001/api`
- **Production**: `https://your-domain.com/api`

## 🎯 API Endpoints

### Authentication & User Management

#### `POST /api/auth/login`
Authenticate user and receive JWT token.

**Request:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "token": "string",
  "refreshToken": "string",
  "user": {
    "id": "string",
    "username": "string",
    "role": "admin|operator|viewer",
    "permissions": ["string"]
  },
  "expiresIn": 3600
}
```

#### `POST /api/auth/refresh`
Refresh JWT token using refresh token.

**Request:**
```json
{
  "refreshToken": "string"
}
```

#### `POST /api/auth/logout`
Logout and invalidate tokens.

#### `GET /api/users`
List all users (admin only).

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)
- `role` (optional): Filter by role

**Response:**
```json
{
  "users": [
    {
      "id": "string",
      "username": "string",
      "role": "admin|operator|viewer",
      "createdAt": "2023-01-01T00:00:00Z",
      "lastLogin": "2023-01-01T00:00:00Z",
      "active": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5
  }
}
```

#### `POST /api/users`
Create new user (admin only).

**Request:**
```json
{
  "username": "string",
  "password": "string",
  "role": "admin|operator|viewer",
  "email": "string" // optional
}
```

#### `PUT /api/users/:id`
Update user details.

#### `DELETE /api/users/:id`
Delete user (admin only).

### Job Management

#### `GET /api/jobs`
List jobs with filtering and pagination.

**Query Parameters:**
- `status` (optional): Filter by status (`queued`, `running`, `completed`, `failed`)
- `repository` (optional): Filter by repository
- `runner` (optional): Filter by runner ID
- `page` (optional): Page number
- `limit` (optional): Items per page
- `startDate` (optional): Filter jobs after date (ISO 8601)
- `endDate` (optional): Filter jobs before date (ISO 8601)

**Response:**
```json
{
  "jobs": [
    {
      "id": "string",
      "runId": "number",
      "jobId": "number",
      "repository": "owner/repo",
      "workflow": "CI/CD Pipeline",
      "status": "running",
      "runner": {
        "id": "string",
        "name": "runner-1",
        "labels": ["self-hosted", "linux"]
      },
      "startedAt": "2023-01-01T00:00:00Z",
      "completedAt": null,
      "duration": 120,
      "logs": "/api/jobs/123/logs"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  },
  "summary": {
    "total": 150,
    "queued": 5,
    "running": 10,
    "completed": 125,
    "failed": 10
  }
}
```

#### `GET /api/jobs/:id`
Get specific job details.

**Response:**
```json
{
  "id": "string",
  "runId": 123456789,
  "jobId": 987654321,
  "repository": "owner/repo",
  "workflow": "CI/CD Pipeline",
  "status": "completed",
  "conclusion": "success",
  "runner": {
    "id": "runner-1",
    "name": "GitHub Actions Runner 1",
    "labels": ["self-hosted", "linux", "x64"]
  },
  "steps": [
    {
      "name": "Checkout code",
      "status": "completed",
      "conclusion": "success",
      "startedAt": "2023-01-01T00:00:00Z",
      "completedAt": "2023-01-01T00:00:30Z",
      "logs": "/api/jobs/123/steps/1/logs"
    }
  ],
  "startedAt": "2023-01-01T00:00:00Z",
  "completedAt": "2023-01-01T00:05:00Z",
  "duration": 300,
  "queueTime": 15,
  "metadata": {
    "containerId": "container-123",
    "resourceUsage": {
      "cpu": "2 cores",
      "memory": "4GB",
      "storage": "20GB"
    }
  }
}
```

#### `GET /api/jobs/:id/logs`
Retrieve job logs.

**Query Parameters:**
- `download` (optional): Download as file (true/false)
- `format` (optional): Log format (`json`, `text`)

**Response (text format):**
```
2023-01-01T00:00:00Z [INFO] Starting job execution
2023-01-01T00:00:01Z [INFO] Checking out repository owner/repo
2023-01-01T00:00:05Z [INFO] Running: npm install
...
```

**Response (json format):**
```json
{
  "logs": [
    {
      "timestamp": "2023-01-01T00:00:00Z",
      "level": "INFO",
      "message": "Starting job execution",
      "source": "system"
    }
  ],
  "metadata": {
    "jobId": "string",
    "totalLines": 1500,
    "truncated": false
  }
}
```

#### `PUT /api/jobs/:id/status`
Update job status (system use).

#### `POST /api/jobs/delegate`
Delegate job to available runner.

**Request:**
```json
{
  "runId": 123456789,
  "jobId": 987654321,
  "repository": "owner/repo",
  "workflow": "CI/CD Pipeline",
  "labels": ["self-hosted", "linux"],
  "requirements": {
    "cpu": 2,
    "memory": 4096,
    "storage": 20480
  }
}
```

#### `POST /api/jobs/:id/cancel`
Cancel running job.

### Runner Management

#### `GET /api/runners`
List all runners with status information.

**Query Parameters:**
- `status` (optional): Filter by status (`online`, `offline`, `busy`)
- `labels` (optional): Filter by labels (comma-separated)
- `repository` (optional): Filter by repository access

**Response:**
```json
{
  "runners": [
    {
      "id": "runner-1",
      "name": "GitHub Actions Runner 1",
      "status": "online",
      "busy": false,
      "labels": ["self-hosted", "linux", "x64"],
      "version": "2.311.0",
      "os": "linux",
      "architecture": "x64",
      "lastSeen": "2023-01-01T00:00:00Z",
      "currentJob": null,
      "capabilities": {
        "cpu": 4,
        "memory": 8192,
        "storage": 100000,
        "docker": true,
        "gpu": false
      },
      "repository": "owner/repo",
      "runnerGroup": "default"
    }
  ],
  "summary": {
    "total": 10,
    "online": 8,
    "offline": 2,
    "busy": 3,
    "idle": 5
  }
}
```

#### `GET /api/runners/:id`
Get specific runner details.

#### `GET /api/runners/:id/status`
Get detailed runner status.

**Response:**
```json
{
  "id": "runner-1",
  "status": "online",
  "busy": true,
  "health": {
    "cpu": 45.2,
    "memory": 62.8,
    "storage": 25.5,
    "uptime": 86400,
    "lastHealthCheck": "2023-01-01T00:00:00Z"
  },
  "currentJob": {
    "id": "job-123",
    "repository": "owner/repo",
    "startedAt": "2023-01-01T00:00:00Z"
  },
  "performance": {
    "jobsCompleted": 150,
    "averageJobTime": 300,
    "successRate": 98.5,
    "lastJobCompleted": "2023-01-01T00:00:00Z"
  }
}
```

#### `POST /api/runners`
Register new runner.

#### `PUT /api/runners/:id`
Update runner configuration.

#### `DELETE /api/runners/:id`
Remove runner registration.

### GitHub Integration

#### `GET /api/github/status`
Get GitHub API integration status.

**Response:**
```json
{
  "connected": true,
  "rateLimit": {
    "limit": 5000,
    "remaining": 4750,
    "reset": "2023-01-01T01:00:00Z",
    "used": 250
  },
  "webhookStatus": {
    "configured": true,
    "lastEvent": "2023-01-01T00:00:00Z",
    "eventsReceived": 1500
  },
  "repositories": {
    "total": 25,
    "active": 20,
    "monitored": 15
  }
}
```

#### `GET /api/github/repositories`
List tracked repositories.

**Response:**
```json
{
  "repositories": [
    {
      "id": 123456789,
      "name": "owner/repo",
      "fullName": "owner/repository-name",
      "private": false,
      "defaultBranch": "main",
      "workflowRuns": {
        "total": 500,
        "successful": 475,
        "failed": 25
      },
      "lastActivity": "2023-01-01T00:00:00Z",
      "runners": ["runner-1", "runner-2"]
    }
  ]
}
```

#### `POST /api/github/sync`
Force synchronization with GitHub.

#### `GET /api/github/workflows/:repository`
Get workflows for repository.

#### `GET /api/github/runs/:repository`
Get workflow runs for repository.

### Container Management

#### `GET /api/containers`
List containers and their status.

**Response:**
```json
{
  "containers": [
    {
      "id": "container-123",
      "name": "job-runner-456",
      "status": "running",
      "jobId": "job-456",
      "runner": "runner-1",
      "image": "ghcr.io/actions/runner:latest",
      "createdAt": "2023-01-01T00:00:00Z",
      "startedAt": "2023-01-01T00:00:05Z",
      "resourceUsage": {
        "cpu": 25.5,
        "memory": 45.2,
        "storage": 15.8
      }
    }
  ],
  "summary": {
    "total": 15,
    "running": 10,
    "stopped": 3,
    "failed": 2
  }
}
```

#### `GET /api/containers/:id`
Get container details.

#### `GET /api/containers/:id/logs`
Get container logs.

#### `POST /api/containers/:id/stop`
Stop container.

#### `DELETE /api/containers/:id`
Remove container.

### Security

#### `POST /api/security/scan`
Initiate security scan of container or image.

**Request:**
```json
{
  "target": "container|image",
  "identifier": "container-id or image-name",
  "scanType": "vulnerability|secret|compliance"
}
```

**Response:**
```json
{
  "scanId": "scan-123",
  "status": "initiated",
  "estimatedDuration": 300,
  "resultsUrl": "/api/security/scans/scan-123"
}
```

#### `GET /api/security/scans`
List security scans.

#### `GET /api/security/scans/:id`
Get scan results.

**Response:**
```json
{
  "id": "scan-123",
  "target": "container-456",
  "scanType": "vulnerability",
  "status": "completed",
  "startedAt": "2023-01-01T00:00:00Z",
  "completedAt": "2023-01-01T00:05:00Z",
  "results": {
    "vulnerabilities": [
      {
        "id": "CVE-2023-12345",
        "severity": "HIGH",
        "package": "package-name",
        "version": "1.0.0",
        "fixedVersion": "1.0.1",
        "description": "Vulnerability description"
      }
    ],
    "summary": {
      "total": 5,
      "critical": 0,
      "high": 1,
      "medium": 2,
      "low": 2
    }
  }
}
```

#### `GET /api/security/policies`
Get security policies.

#### `PUT /api/security/policies`
Update security policies.

#### `GET /api/security/audit-logs`
Get audit logs.

### Monitoring & Analytics

#### `GET /api/metrics`
Get Prometheus-compatible metrics.

**Response (Prometheus format):**
```
# HELP runnerhub_jobs_total Total number of jobs processed
# TYPE runnerhub_jobs_total counter
runnerhub_jobs_total{status="completed"} 1500
runnerhub_jobs_total{status="failed"} 25

# HELP runnerhub_runners_active Number of active runners
# TYPE runnerhub_runners_active gauge
runnerhub_runners_active 10
```

#### `GET /api/monitoring/dashboard`
Get dashboard data.

**Response:**
```json
{
  "summary": {
    "jobs": {
      "total": 1525,
      "queued": 5,
      "running": 10,
      "completed": 1500,
      "failed": 25
    },
    "runners": {
      "total": 10,
      "online": 8,
      "busy": 3,
      "idle": 5
    },
    "performance": {
      "averageJobTime": 300,
      "successRate": 98.4,
      "throughput": 120
    }
  },
  "charts": {
    "jobsOverTime": [
      {
        "timestamp": "2023-01-01T00:00:00Z",
        "completed": 50,
        "failed": 2
      }
    ],
    "runnerUtilization": [
      {
        "runner": "runner-1",
        "utilization": 75.5,
        "jobs": 25
      }
    ]
  }
}
```

#### `GET /api/analytics/dashboard`
Get comprehensive analytics dashboard.

#### `GET /api/analytics/widgets/:name`
Get specific widget data.

#### `GET /api/analytics/insights`
Get AI-powered insights.

#### `GET /api/analytics/predictions`
Get performance predictions.

#### `GET /api/analytics/realtime`
Get real-time updates (Server-Sent Events).

#### `POST /api/analytics/optimization/trigger`
Trigger manual optimization.

### Auto-Scaling

#### `GET /api/scaling/status`
Get auto-scaling system status.

**Response:**
```json
{
  "enabled": true,
  "mode": "balanced",
  "currentRunners": 10,
  "targetRunners": 12,
  "predictions": {
    "shortTerm": {
      "jobs": 25,
      "confidence": 0.85
    },
    "mediumTerm": {
      "jobs": 30,
      "confidence": 0.78
    }
  },
  "lastScalingAction": {
    "timestamp": "2023-01-01T00:00:00Z",
    "action": "scale-up",
    "count": 2
  }
}
```

#### `POST /api/scaling/trigger`
Trigger manual scaling decision.

#### `GET /api/scaling/history`
Get scaling history.

#### `PUT /api/scaling/config`
Update scaling configuration.

### Health & Status

#### `GET /health`
Health check endpoint (no authentication required).

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2023-01-01T00:00:00Z",
  "version": "1.0.0",
  "uptime": 86400,
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "github": "healthy",
    "vault": "healthy"
  }
}
```

#### `GET /api/status`
Detailed system status.

**Response:**
```json
{
  "system": {
    "status": "operational",
    "version": "1.0.0",
    "uptime": 86400,
    "environment": "production"
  },
  "services": {
    "api": {
      "status": "healthy",
      "responseTime": 50,
      "requestsPerSecond": 45
    },
    "database": {
      "status": "healthy",
      "connections": 15,
      "queryTime": 25
    },
    "queue": {
      "status": "healthy",
      "jobs": {
        "pending": 5,
        "processing": 10
      }
    }
  },
  "resources": {
    "cpu": 45.2,
    "memory": 62.8,
    "storage": 25.5
  }
}
```

## 📝 Response Formats

### Standard Success Response
```json
{
  "success": true,
  "data": { /* response data */ },
  "message": "Operation completed successfully",
  "timestamp": "2023-01-01T00:00:00Z"
}
```

### Standard Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": "Additional error details",
    "field": "field_name" // for validation errors
  },
  "timestamp": "2023-01-01T00:00:00Z"
}
```

### Pagination Response
```json
{
  "data": [ /* array of items */ ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## 🔒 Rate Limiting

The API implements rate limiting to ensure fair usage:

- **Default**: 1000 requests per hour per user
- **Authentication**: 10 login attempts per 15 minutes
- **Heavy operations**: 100 requests per hour for resource-intensive endpoints

Rate limit headers are included in responses:
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 995
X-RateLimit-Reset: 1640995200
```

## 📡 WebSocket Events

Real-time events available via WebSocket connection to `/socket.io`:

### Connection
```javascript
const socket = io('http://localhost:3001', {
  auth: {
    token: 'your-jwt-token'
  }
});
```

### Event Types
- `job:status` - Job status changes
- `runner:status` - Runner status updates
- `system:health` - System health notifications
- `container:lifecycle` - Container creation/destruction
- `scaling:action` - Auto-scaling events
- `security:alert` - Security alerts

### Example Event
```json
{
  "type": "job:status",
  "data": {
    "jobId": "job-123",
    "status": "completed",
    "duration": 300,
    "timestamp": "2023-01-01T00:00:00Z"
  }
}
```

## 🔍 Error Codes

| Code | Description |
|------|-------------|
| `AUTH_REQUIRED` | Authentication required |
| `AUTH_INVALID` | Invalid authentication token |
| `AUTH_EXPIRED` | Authentication token expired |
| `PERMISSION_DENIED` | Insufficient permissions |
| `VALIDATION_ERROR` | Request validation failed |
| `RESOURCE_NOT_FOUND` | Requested resource not found |
| `RESOURCE_CONFLICT` | Resource conflict (e.g., duplicate) |
| `RATE_LIMIT_EXCEEDED` | Rate limit exceeded |
| `SERVICE_UNAVAILABLE` | Service temporarily unavailable |
| `INTERNAL_ERROR` | Internal server error |

This comprehensive API reference provides complete documentation for all GitHub-RunnerHub endpoints, enabling developers to effectively integrate with and extend the system.