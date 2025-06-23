# API Reference 📖

Complete API documentation for GitHub-RunnerHub v2.0.0 with interactive examples and comprehensive endpoint coverage.

## 🔐 Authentication

All API endpoints require JWT authentication unless otherwise specified.

### Authentication Headers
```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

### Obtaining JWT Token
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your_password"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h",
  "user": {
    "id": "user_id",
    "username": "admin",
    "role": "admin"
  }
}
```

## 🏃‍♂️ Job Management API

### Delegate Job Execution
Delegates a job to an available runner with intelligent container assignment.

```http
POST /api/jobs/delegate
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "repository": "owner/repo",
  "job_id": "123456789",
  "job_name": "Build and Test",
  "workflow_name": "CI/CD Pipeline",
  "labels": ["ubuntu-latest", "node"],
  "metadata": {
    "branch": "main",
    "commit_sha": "abc123def456",
    "pr_number": 42
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Job delegated successfully",
  "data": {
    "delegation_id": "del_abc123",
    "runner_id": "runner_001",
    "container_id": "container_xyz789",
    "status": "assigned",
    "created_at": "2024-06-23T10:30:00Z",
    "estimated_completion": "2024-06-23T10:45:00Z"
  }
}
```

### List Jobs
Retrieve jobs with filtering and pagination.

```http
GET /api/jobs?status=running&repository=owner/repo&limit=20&offset=0
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `status` - Filter by job status (`pending`, `running`, `completed`, `failed`)
- `repository` - Filter by repository name
- `runner_id` - Filter by runner ID
- `limit` - Number of results (default: 50, max: 100)
- `offset` - Pagination offset
- `sort` - Sort field (`created_at`, `updated_at`, `status`)
- `order` - Sort order (`asc`, `desc`)

**Response:**
```json
{
  "success": true,
  "data": {
    "jobs": [
      {
        "id": "job_123",
        "github_job_id": 123456789,
        "job_name": "Build and Test",
        "repository": "owner/repo",
        "workflow_name": "CI/CD Pipeline",
        "status": "running",
        "runner_id": "runner_001",
        "container_id": "container_xyz789",
        "labels": ["ubuntu-latest", "node"],
        "started_at": "2024-06-23T10:30:00Z",
        "estimated_completion": "2024-06-23T10:45:00Z",
        "metadata": {
          "branch": "main",
          "commit_sha": "abc123def456"
        }
      }
    ],
    "pagination": {
      "total": 156,
      "limit": 20,
      "offset": 0,
      "pages": 8
    }
  }
}
```

### Get Job Details
Retrieve detailed information about a specific job.

```http
GET /api/jobs/{job_id}
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "job_123",
    "github_job_id": 123456789,
    "job_name": "Build and Test",
    "repository": "owner/repo",
    "workflow_name": "CI/CD Pipeline",
    "status": "running",
    "runner_id": "runner_001",
    "container_id": "container_xyz789",
    "labels": ["ubuntu-latest", "node"],
    "started_at": "2024-06-23T10:30:00Z",
    "updated_at": "2024-06-23T10:35:00Z",
    "progress": {
      "current_step": "Build",
      "total_steps": 5,
      "percentage": 60
    },
    "resource_usage": {
      "cpu_usage": 45.2,
      "memory_usage": 512,
      "disk_usage": 2048
    },
    "logs_url": "/api/jobs/job_123/logs",
    "metadata": {
      "branch": "main",
      "commit_sha": "abc123def456",
      "pr_number": 42
    }
  }
}
```

### Get Job Logs
Stream or retrieve job execution logs.

```http
GET /api/jobs/{job_id}/logs?follow=true&lines=100
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `follow` - Stream logs in real-time (boolean)
- `lines` - Number of recent lines to retrieve
- `since` - Retrieve logs since timestamp (ISO 8601)
- `format` - Response format (`json`, `text`)

**Response (JSON format):**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "timestamp": "2024-06-23T10:30:15Z",
        "level": "info",
        "message": "Starting job execution",
        "step": "setup"
      },
      {
        "timestamp": "2024-06-23T10:30:30Z",
        "level": "info",
        "message": "Installing dependencies",
        "step": "build"
      }
    ],
    "metadata": {
      "total_lines": 245,
      "job_status": "running",
      "last_update": "2024-06-23T10:35:00Z"
    }
  }
}
```

### Update Job Status
Update the status of a running job (typically called by runners).

```http
PUT /api/jobs/{job_id}/status
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "status": "completed",
  "result": "success",
  "completed_at": "2024-06-23T10:45:00Z",
  "exit_code": 0,
  "artifacts": [
    {
      "name": "build-artifacts",
      "path": "/artifacts/build.zip",
      "size": 1024000
    }
  ]
}
```

## 🏃‍♂️ Runner Management API

### List Runners
Get all registered runners with their current status.

```http
GET /api/runners?status=online&labels=ubuntu-latest
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "runners": [
      {
        "id": "runner_001",
        "name": "runnerhub-1",
        "status": "online",
        "busy": false,
        "labels": ["ubuntu-latest", "docker", "node"],
        "os": "linux",
        "architecture": "x64",
        "current_job": null,
        "last_seen": "2024-06-23T10:35:00Z",
        "created_at": "2024-06-23T09:00:00Z",
        "capabilities": {
          "docker": true,
          "kubernetes": false,
          "max_concurrent_jobs": 5
        },
        "resource_info": {
          "cpu_cores": 4,
          "memory_gb": 8,
          "disk_gb": 100
        }
      }
    ],
    "summary": {
      "total": 10,
      "online": 8,
      "busy": 3,
      "idle": 5,
      "offline": 2
    }
  }
}
```

### Register New Runner
Register a new self-hosted runner.

```http
POST /api/runners
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "name": "runnerhub-2",
  "labels": ["ubuntu-latest", "docker", "node"],
  "os": "linux",
  "architecture": "x64",
  "capabilities": {
    "docker": true,
    "kubernetes": false,
    "max_concurrent_jobs": 5
  },
  "resource_info": {
    "cpu_cores": 8,
    "memory_gb": 16,
    "disk_gb": 200
  }
}
```

### Get Runner Status
Get detailed status of a specific runner.

```http
GET /api/runners/{runner_id}/status
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "runner_001",
    "name": "runnerhub-1",
    "status": "online",
    "busy": true,
    "current_job": {
      "job_id": "job_123",
      "job_name": "Build and Test",
      "started_at": "2024-06-23T10:30:00Z"
    },
    "resource_usage": {
      "cpu_usage": 75.5,
      "memory_usage": 6144,
      "disk_usage": 15360,
      "network_in": 1024,
      "network_out": 512
    },
    "health": {
      "status": "healthy",
      "last_heartbeat": "2024-06-23T10:35:00Z",
      "uptime": 3600
    }
  }
}
```

## 🔗 GitHub Integration API

### GitHub API Status
Check the status of GitHub API integration.

```http
GET /api/github/status
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "api_status": "operational",
    "rate_limit": {
      "remaining": 4850,
      "limit": 5000,
      "reset": "2024-06-23T11:00:00Z",
      "used": 150
    },
    "webhook_status": "active",
    "last_sync": "2024-06-23T10:30:00Z",
    "organization": "your-org",
    "repositories_tracked": 25,
    "runners_registered": 10
  }
}
```

### List Tracked Repositories
Get all repositories being monitored.

```http
GET /api/github/repositories
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "repositories": [
      {
        "id": 123456,
        "name": "awesome-project",
        "full_name": "your-org/awesome-project",
        "private": false,
        "active": true,
        "webhook_configured": true,
        "last_activity": "2024-06-23T10:00:00Z",
        "job_count": {
          "total": 1250,
          "this_month": 85,
          "running": 2
        }
      }
    ],
    "summary": {
      "total_repositories": 25,
      "active_repositories": 22,
      "webhooks_configured": 20
    }
  }
}
```

### Force GitHub Sync
Trigger a manual synchronization with GitHub.

```http
POST /api/github/sync
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "sync_type": "full",
  "repositories": ["owner/repo1", "owner/repo2"]
}
```

## 🔒 Security API

### Container Security Scan
Perform security scan on a container image.

```http
POST /api/security/scan
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "image": "ubuntu:20.04",
  "scan_type": "comprehensive",
  "severity_threshold": "medium"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "scan_id": "scan_abc123",
    "image": "ubuntu:20.04",
    "scan_date": "2024-06-23T10:35:00Z",
    "status": "completed",
    "vulnerabilities": {
      "total": 5,
      "critical": 0,
      "high": 1,
      "medium": 2,
      "low": 2
    },
    "details": [
      {
        "id": "CVE-2024-1234",
        "severity": "high",
        "package": "openssl",
        "installed_version": "1.1.1f",
        "fixed_version": "1.1.1g",
        "description": "Buffer overflow vulnerability"
      }
    ],
    "recommendation": "Update packages to latest versions"
  }
}
```

### Get Security Scan Results
Retrieve historical security scan results.

```http
GET /api/security/scans?image=ubuntu&limit=10
Authorization: Bearer <jwt_token>
```

### Secret Scan
Scan job logs for exposed secrets.

```http
POST /api/security/secret-scan
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "job_id": "job_123",
  "content": "Log content to scan for secrets",
  "scan_rules": ["api_keys", "passwords", "tokens"]
}
```

### Security Status
Get overall security status and compliance information.

```http
GET /api/security/status
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "security_level": "high",
    "compliance_status": {
      "owasp": "compliant",
      "soc2": "ready",
      "gdpr": "compliant"
    },
    "threat_detection": {
      "status": "active",
      "threats_detected": 0,
      "last_scan": "2024-06-23T10:30:00Z"
    },
    "vulnerabilities": {
      "critical": 0,
      "high": 2,
      "medium": 5,
      "low": 8
    },
    "security_policies": {
      "enforced": 15,
      "total": 15
    }
  }
}
```

## 📊 Monitoring & Metrics API

### Health Check
System health status (no authentication required).

```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-06-23T10:35:00Z",
  "version": "2.0.0",
  "uptime": 86400,
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "github_api": "healthy"
  },
  "metrics": {
    "active_jobs": 5,
    "total_runners": 10,
    "online_runners": 8
  }
}
```

### Get System Metrics
Retrieve comprehensive system metrics.

```http
GET /api/metrics
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "system": {
      "cpu_usage": 45.2,
      "memory_usage": 68.5,
      "disk_usage": 35.8,
      "uptime": 86400
    },
    "application": {
      "active_jobs": 5,
      "completed_jobs_today": 125,
      "average_job_duration": 180,
      "api_requests_per_minute": 45
    },
    "github": {
      "api_rate_limit_remaining": 4850,
      "webhook_events_today": 89,
      "repositories_synced": 25
    },
    "performance": {
      "cache_hit_ratio": 0.92,
      "average_response_time": 85,
      "container_startup_time": 3.2
    }
  }
}
```

### Dashboard Data
Get real-time dashboard data.

```http
GET /api/monitoring/dashboard
Authorization: Bearer <jwt_token>
```

## 🔄 Queue Management API

### Queue Status
Get status of all job queues.

```http
GET /api/queues/status
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "queues": [
      {
        "name": "high-priority",
        "waiting": 2,
        "active": 5,
        "completed": 1250,
        "failed": 15,
        "delayed": 0,
        "paused": false
      },
      {
        "name": "normal-priority",
        "waiting": 8,
        "active": 10,
        "completed": 5640,
        "failed": 45,
        "delayed": 1,
        "paused": false
      }
    ],
    "summary": {
      "total_waiting": 10,
      "total_active": 15,
      "total_completed": 6890,
      "total_failed": 60
    }
  }
}
```

### Queue Operations
Manage queue operations (pause, resume, clear).

```http
POST /api/queues/{queue_name}/pause
Authorization: Bearer <jwt_token>
```

```http
POST /api/queues/{queue_name}/resume
Authorization: Bearer <jwt_token>
```

```http
DELETE /api/queues/{queue_name}/failed
Authorization: Bearer <jwt_token>
```

## 🌐 WebSocket API

### Real-time Events
Connect to WebSocket for real-time updates.

```javascript
const ws = new WebSocket('ws://localhost:3001/api/ws');

ws.onopen = function() {
  // Subscribe to specific events
  ws.send(JSON.stringify({
    type: 'subscribe',
    events: ['job_status', 'runner_status', 'system_alerts']
  }));
};

ws.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
  /*
  {
    "type": "job_status",
    "data": {
      "job_id": "job_123",
      "status": "completed",
      "timestamp": "2024-06-23T10:45:00Z"
    }
  }
  */
};
```

### Available Event Types
- `job_status` - Job status changes
- `runner_status` - Runner status updates
- `system_alerts` - System health alerts
- `github_webhook` - GitHub webhook events
- `security_alerts` - Security notifications
- `performance_metrics` - Real-time performance data

## 📋 Error Handling

### Standard Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid repository format",
    "details": {
      "field": "repository",
      "value": "invalid-repo",
      "expected": "owner/repo format"
    },
    "timestamp": "2024-06-23T10:35:00Z",
    "request_id": "req_abc123"
  }
}
```

### Common Error Codes
- `AUTHENTICATION_REQUIRED` - Missing or invalid JWT token
- `AUTHORIZATION_FAILED` - Insufficient permissions
- `VALIDATION_ERROR` - Request validation failed
- `RESOURCE_NOT_FOUND` - Requested resource not found
- `RATE_LIMIT_EXCEEDED` - API rate limit exceeded
- `INTERNAL_ERROR` - Internal server error
- `SERVICE_UNAVAILABLE` - External service unavailable

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error
- `502` - Bad Gateway
- `503` - Service Unavailable

## 🔧 Rate Limiting

API endpoints are rate limited to prevent abuse:

- **Authentication endpoints**: 100 requests per hour per IP
- **General API endpoints**: 1000 requests per hour per authenticated user
- **WebSocket connections**: 10 concurrent connections per user

Rate limit headers are included in all responses:
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1640995200
```

## 📝 API Versioning

The API uses semantic versioning with the current version being `v2.0.0`.

- **Base URL**: `https://your-domain.com/api`
- **Version Header**: `API-Version: 2.0`
- **Deprecation**: Deprecated endpoints include `Deprecation` header

## 🧪 Testing the API

### Using cURL
```bash
# Get JWT token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | \
  jq -r '.token')

# Make authenticated request
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/jobs
```

### Using Postman
Import our Postman collection: [GitHub-RunnerHub-API.postman_collection.json](../config/postman-collection.json)

### Interactive Documentation
Visit the interactive API documentation at: `http://localhost:3001/api/docs`

---

## 📚 Additional Resources

- **[Quick Start Guide](Quick-Start-Guide)** - Get started with the API
- **[Authentication Guide](API-Authentication)** - Detailed authentication setup
- **[WebSocket Guide](WebSocket-API)** - Real-time event streaming
- **[Error Handling Guide](Error-Handling)** - Comprehensive error handling

---

**🔗 Base URL**: `http://localhost:3001/api`
**📖 Interactive Docs**: `http://localhost:3001/api/docs`
**🌐 WebSocket**: `ws://localhost:3001/api/ws`

**🏠 Back to: [Wiki Home](Home)**