# 🌐 GitHub RunnerHub API Reference

## Overview

The GitHub RunnerHub API provides RESTful endpoints for managing and monitoring self-hosted GitHub Actions runners. All public endpoints require no authentication.

## Base URL

```
http://localhost:8300
```

## Endpoints

### 🏥 Health Check

#### `GET /health`

Returns comprehensive system health information including runner statistics, repository details, and system status.

**Response:**
```json
{
  "status": "ok",
  "lastUpdate": "2025-06-19T08:30:00.000Z",
  "githubConnected": true,
  "runnerCount": 6,
  "activeRunners": 6,
  "busyRunners": 0,
  "repositories": ["ai-music-studio", "mcp-enhanced-workspace", "JarvisAI", "Jarvis2.0", "ProjectHub-Mcp", "GitHub-RunnerHub"],
  "repositoryDetails": {
    "GitHub-RunnerHub": {
      "totalRunners": 1,
      "dedicatedRunners": 1,
      "dynamicRunners": 0,
      "busyRunners": 0,
      "runners": [{
        "name": "runnerhub-dedicated-github-runnerhub",
        "type": "dedicated",
        "status": "online",
        "busy": false
      }]
    }
  },
  "realRunnerNames": ["runnerhub-dedicated-github-runnerhub", "..."],
  "version": "2.0.0"
}
```

### 🏃 Runner Management

#### `GET /api/public/runners`

Returns detailed information about all runners.

**Response:**
```json
[
  {
    "id": 12345,
    "name": "runnerhub-dedicated-github-runnerhub",
    "status": "online",
    "busy": false,
    "labels": [
      {"name": "self-hosted", "type": "read-only"},
      {"name": "docker", "type": "read-only"},
      {"name": "runnerhub", "type": "read-only"},
      {"name": "github-runnerhub", "type": "repository"},
      {"name": "dedicated", "type": "runner-type"}
    ],
    "os": "Linux",
    "architecture": "X64"
  }
]
```

#### `GET /api/public/repositories`

Returns repository configuration and status.

**Response:**
```json
{
  "repositories": [
    {
      "name": "GitHub-RunnerHub",
      "fullName": "anubissbe/GitHub-RunnerHub",
      "runners": {
        "dedicated": 1,
        "dynamic": 0,
        "total": 1
      },
      "status": "active"
    }
  ]
}
```

### 📊 Metrics

#### `GET /api/public/metrics`

Returns system metrics and statistics.

**Response:**
```json
{
  "timestamp": "2025-06-19T08:30:00.000Z",
  "runners": {
    "total": 6,
    "online": 6,
    "offline": 0,
    "busy": 0,
    "idle": 6
  },
  "repositories": {
    "total": 6,
    "active": 6
  },
  "jobs": {
    "queued": 0,
    "inProgress": 0,
    "completed": 150
  },
  "system": {
    "uptime": 86400,
    "memoryUsage": 45.5,
    "cpuUsage": 12.3
  }
}
```

### 🔄 WebSocket Connection

#### `WS /`

Establishes a WebSocket connection for real-time updates.

**Connection:**
```javascript
const ws = new WebSocket('ws://localhost:8300');
```

**Message Types:**

1. **runners** - Runner status updates
```json
{
  "type": "runners",
  "data": [/* array of runner objects */],
  "timestamp": "2025-06-19T08:30:00.000Z"
}
```

2. **workflows** - Workflow status updates
```json
{
  "type": "workflows",
  "data": [/* array of workflow objects */],
  "timestamp": "2025-06-19T08:30:00.000Z"
}
```

3. **jobs** - Job status updates
```json
{
  "type": "jobs",
  "data": [/* array of job objects */],
  "timestamp": "2025-06-19T08:30:00.000Z"
}
```

4. **metrics** - System metrics updates
```json
{
  "type": "metrics",
  "data": {/* metrics object */},
  "timestamp": "2025-06-19T08:30:00.000Z"
}
```

## Error Responses

All endpoints follow a consistent error response format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional context"
    }
  },
  "timestamp": "2025-06-19T08:30:00.000Z"
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `RUNNER_NOT_FOUND` | 404 | Runner with specified ID not found |
| `INVALID_REQUEST` | 400 | Request validation failed |
| `GITHUB_API_ERROR` | 502 | GitHub API communication error |
| `INTERNAL_ERROR` | 500 | Internal server error |

## Rate Limiting

Public endpoints are not rate-limited. However, the system implements internal rate limiting for GitHub API calls:

- **GitHub API**: 5000 requests per hour
- **Runner Registration**: 100 operations per hour
- **Health Checks**: No limit

## CORS Configuration

The API supports CORS with the following configuration:

```javascript
{
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}
```

## Examples

### cURL Examples

```bash
# Get system health
curl http://localhost:8300/health | jq

# Get all runners
curl http://localhost:8300/api/public/runners | jq

# Get repository details
curl http://localhost:8300/api/public/repositories | jq

# Get metrics
curl http://localhost:8300/api/public/metrics | jq
```

### JavaScript Examples

```javascript
// Fetch runners
fetch('http://localhost:8300/api/public/runners')
  .then(res => res.json())
  .then(runners => console.log(runners));

// WebSocket connection
const ws = new WebSocket('ws://localhost:8300');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log(`${message.type}:`, message.data);
};

ws.onopen = () => {
  console.log('Connected to RunnerHub WebSocket');
};
```

### Python Examples

```python
import requests
import websocket

# Get runners
response = requests.get('http://localhost:8300/api/public/runners')
runners = response.json()

# WebSocket connection
def on_message(ws, message):
    print(f"Received: {message}")

ws = websocket.WebSocketApp("ws://localhost:8300",
                            on_message=on_message)
ws.run_forever()
```

## Changelog

### Version 2.0.0
- Added public API endpoints
- Implemented WebSocket real-time updates
- Enhanced health check endpoint
- Added repository-specific metrics

### Version 1.0.0
- Initial API implementation
- Basic health check endpoint