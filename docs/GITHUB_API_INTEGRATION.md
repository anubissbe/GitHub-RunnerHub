# GitHub API Integration - Enhanced Implementation

## Overview

The GitHub-RunnerHub project now includes an enhanced GitHub API integration with smart rate limiting that ensures optimal performance while respecting GitHub's API rate limits (5000 requests/hour for authenticated requests).

## Key Features

### 1. Smart Rate Limiting
- **Adaptive Strategy**: Dynamically adjusts request timing based on current usage
- **Conservative Strategy**: Throttles early to preserve rate limit
- **Aggressive Strategy**: Maximizes throughput for critical operations
- **Priority Queue**: Critical requests are processed first

### 2. Distributed Rate Tracking
- Redis-based shared state across multiple instances
- Prevents rate limit violations in HA deployments
- Automatic failover to in-memory tracking

### 3. Advanced Error Handling
- Automatic retry with exponential backoff
- Special handling for rate limit errors
- Network resilience with configurable retries

### 4. Real-time Monitoring
- Live metrics on request performance
- Rate limit exhaustion prediction
- Queue length monitoring
- Comprehensive error tracking

## Implementation Files

### Core Components

1. **Enhanced GitHub API Client** (`src/services/github-api-enhanced.ts`)
   - Advanced rate limiting implementation
   - Multiple strategy support
   - Distributed tracking via Redis
   - Comprehensive metrics

2. **Production Service** (`services/github-api-service.js`)
   - Vault integration for credentials
   - Database synchronization
   - Webhook processing
   - Real-time updates

3. **Enhanced Runner Sync** (`src/services/runner-sync-enhanced.ts`)
   - Intelligent sync scheduling
   - Priority-based operations
   - Webhook event processing
   - Batch operations

4. **Test Suite** (`src/services/github-api-enhanced.test.ts`)
   - Comprehensive unit tests
   - Integration test examples
   - Strategy testing
   - Error handling verification

## Configuration

### Environment Variables
```bash
# Required - GitHub API Access
GITHUB_TOKEN=ghp_xxxxxxxxxxxx                    # Personal Access Token or GitHub App JWT
GITHUB_ORG=your-organization                     # Organization name (optional for personal repos)
GITHUB_APP_ID=123456                            # GitHub App ID (if using GitHub App)
GITHUB_APP_PRIVATE_KEY=/path/to/private-key.pem # GitHub App private key

# Required - Database Configuration
DATABASE_URL=postgresql://user:password@host:5432/database # PostgreSQL connection string
REDIS_HOST=YOUR_SERVER_IP                         # Redis host for caching and queuing
REDIS_PORT=6379                                 # Redis port
REDIS_PASSWORD=your_redis_password              # Redis authentication

# Optional - GitHub API Configuration
GITHUB_RATE_LIMIT_STRATEGY=adaptive             # Options: conservative, aggressive, adaptive
GITHUB_MAX_REQUESTS_PER_HOUR=4500              # Custom rate limit (default: 4500 for safety)
GITHUB_REQUEST_TIMEOUT=30000                    # Request timeout in milliseconds
GITHUB_RETRY_COUNT=3                           # Number of retries for failed requests
GITHUB_BASE_URL=https://api.github.com         # GitHub Enterprise Server URL if applicable

# Optional - Caching Configuration
GITHUB_CACHE_TTL_REPOS=300                     # Repository cache TTL (seconds)
GITHUB_CACHE_TTL_WORKFLOWS=60                  # Workflow runs cache TTL (seconds)
GITHUB_CACHE_TTL_RUNNERS=30                    # Runners cache TTL (seconds)
GITHUB_CACHE_TTL_JOBS=30                       # Jobs cache TTL (seconds)

# Optional - Webhook Configuration
GITHUB_WEBHOOK_SECRET=your_webhook_secret       # Webhook payload verification secret
GITHUB_WEBHOOK_URL=https://your-domain.com/webhooks/github # Public webhook URL

# Optional - Feature Flags
GITHUB_ENABLE_WEBHOOKS=true                     # Enable webhook processing
GITHUB_ENABLE_CACHING=true                      # Enable Redis caching
GITHUB_ENABLE_METRICS=true                      # Enable metrics collection
GITHUB_ENABLE_AUTO_SYNC=true                    # Enable automatic synchronization
```

### GitHub Token Permissions

#### Personal Access Token (Classic)
Required scopes for full functionality:
```bash
# Repository Access
- repo                    # Full repository access
- repo:status            # Repository status access
- repo_deployment        # Repository deployment access

# Actions Access  
- workflow               # GitHub Actions workflow access
- write:packages         # Package registry access (if needed)

# Organization Access (if using organization repositories)
- admin:org              # Organization administration
- read:org               # Organization read access

# User Access
- user:email             # User email access
- read:user              # User profile access
```

#### GitHub App Permissions
Recommended permissions for GitHub App:
```json
{
  "permissions": {
    "actions": "read",
    "administration": "read",
    "contents": "read",
    "metadata": "read",
    "pull_requests": "read",
    "repository_hooks": "write",
    "statuses": "read",
    "workflows": "write"
  },
  "events": [
    "workflow_run",
    "workflow_job", 
    "push",
    "pull_request",
    "repository"
  ]
}
```

### Vault Integration
The system automatically retrieves GitHub credentials from HashiCorp Vault:

```bash
# Vault paths for secrets
vault kv put secret/api-keys \
  GITHUB_TOKEN="ghp_xxxxxxxxxxxx" \
  GITHUB_ORG="your-organization" \
  GITHUB_APP_ID="123456" \
  GITHUB_WEBHOOK_SECRET="your_webhook_secret"

# Alternative: Store as separate secrets
vault kv put secret/github/token value="ghp_xxxxxxxxxxxx"
vault kv put secret/github/org value="your-organization"
vault kv put secret/github/app-id value="123456"
vault kv put secret/github/webhook-secret value="your_webhook_secret"
```

### Database Schema Setup
The GitHub integration requires specific database tables:

```sql
-- GitHub repositories tracking
CREATE TABLE github_repositories (
  id SERIAL PRIMARY KEY,
  github_id BIGINT UNIQUE NOT NULL,
  owner VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  full_name VARCHAR(500) NOT NULL,
  private BOOLEAN DEFAULT false,
  description TEXT,
  default_branch VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Workflow runs cache
CREATE TABLE github_workflow_runs (
  id BIGINT PRIMARY KEY,
  repository_id INTEGER REFERENCES github_repositories(id),
  name VARCHAR(255),
  head_branch VARCHAR(255),
  head_sha VARCHAR(40),
  status VARCHAR(50),
  conclusion VARCHAR(50),
  workflow_id BIGINT,
  run_number INTEGER,
  event VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  run_started_at TIMESTAMP WITH TIME ZONE,
  cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Jobs cache
CREATE TABLE github_jobs (
  id BIGINT PRIMARY KEY,
  run_id BIGINT REFERENCES github_workflow_runs(id),
  name VARCHAR(255),
  status VARCHAR(50),
  conclusion VARCHAR(50),
  runner_id INTEGER,
  runner_name VARCHAR(255),
  runner_group_name VARCHAR(255),
  labels JSONB,
  created_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Runners cache
CREATE TABLE github_runners (
  id INTEGER PRIMARY KEY,
  name VARCHAR(255),
  os VARCHAR(50),
  status VARCHAR(50),
  busy BOOLEAN,
  labels JSONB,
  runner_group_id INTEGER,
  runner_group_name VARCHAR(255),
  repository_id INTEGER REFERENCES github_repositories(id),
  cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_github_repos_full_name ON github_repositories(full_name);
CREATE INDEX idx_workflow_runs_repo_status ON github_workflow_runs(repository_id, status);
CREATE INDEX idx_jobs_run_status ON github_jobs(run_id, status);
CREATE INDEX idx_runners_status ON github_runners(status, busy);
```

## Usage Examples

### Basic Usage - Service Initialization
```javascript
const githubService = new GitHubAPIService({
  token: process.env.GITHUB_TOKEN,
  org: process.env.GITHUB_ORG,
  rateLimitStrategy: 'adaptive',
  enableCaching: true,
  enableWebhooks: true
});

// Start automatic synchronization
await githubService.startPeriodicSync();

// Get rate limit status with real GitHub data
const status = githubService.getRateLimitStatus();
console.log(`
GitHub API Status:
- Remaining: ${status.remaining}/${status.limit}
- Reset: ${new Date(status.reset * 1000).toISOString()}
- Current strategy: ${status.strategy}
- Usage: ${((status.used / status.limit) * 100).toFixed(1)}%
`);
```

### Enhanced Client Usage - Real API Calls
```typescript
import { getGitHubAPIClient } from './github-api-enhanced';

const client = getGitHubAPIClient();

// Fetch repository with real GitHub data structure
const repo = await client.request(
  () => octokit.rest.repos.get({ 
    owner: 'anubissbe', 
    repo: 'GitHub-RunnerHub' 
  }),
  { 
    priority: 'high',
    strategy: 'adaptive',
    maxRetries: 3
  }
);

console.log('Repository data:', {
  id: repo.data.id,
  name: repo.data.name,
  full_name: repo.data.full_name,
  private: repo.data.private,
  description: repo.data.description,
  stargazers_count: repo.data.stargazers_count,
  language: repo.data.language,
  default_branch: repo.data.default_branch,
  permissions: repo.data.permissions
});

// Fetch workflow runs with real data
const workflowRuns = await client.request(
  () => octokit.rest.actions.listWorkflowRunsForRepo({
    owner: 'anubissbe',
    repo: 'GitHub-RunnerHub',
    per_page: 10
  }),
  { priority: 'normal' }
);

console.log('Recent workflow runs:');
workflowRuns.data.workflow_runs.forEach(run => {
  console.log(`- ${run.name}: ${run.status} (${run.conclusion}) - ${run.head_branch}`);
});

// Batch multiple repository requests
const repositories = ['anubissbe/GitHub-RunnerHub', 'anubissbe/ProjectHub-Mcp'];
const results = await client.batchRequests(
  repositories.map(repo => {
    const [owner, repoName] = repo.split('/');
    return {
      fn: () => octokit.rest.repos.get({ owner, repo: repoName }),
      priority: 'normal'
    };
  })
);

results.forEach((result, index) => {
  if (result.status === 'fulfilled') {
    console.log(`${repositories[index]}: ${result.value.data.description}`);
  } else {
    console.error(`${repositories[index]}: ${result.reason.message}`);
  }
});
```

### Runner Management - Real GitHub Runners
```typescript
import { runnerSync } from './runner-sync-enhanced';

// Start automated sync with real GitHub runners
await runnerSync.startAutoSync();

// Fetch and display real runner data
const runners = await runnerSync.fetchRunners();
console.log('GitHub Runners Status:');
runners.forEach(runner => {
  console.log(`
Runner: ${runner.name}
- ID: ${runner.id}
- OS: ${runner.os}
- Status: ${runner.status}
- Busy: ${runner.busy}
- Labels: ${runner.labels.map(l => l.name).join(', ')}
- Group: ${runner.runner_group_name}
  `);
});

// Process real webhook event
const webhookEvent = {
  action: 'completed',
  workflow_run: {
    id: 7234567890,
    name: 'CI/CD Pipeline',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: 'abc123def456789',
    repository: {
      id: 12345,
      name: 'GitHub-RunnerHub',
      full_name: 'anubissbe/GitHub-RunnerHub'
    },
    actor: {
      login: 'anubissbe',
      id: 67890
    }
  }
};

await runnerSync.processWebhookEvent(webhookEvent);

// Get detailed sync status
const syncStatus = await runnerSync.getSyncStatus();
console.log('Synchronization Status:', {
  lastSync: syncStatus.lastSync,
  nextSync: syncStatus.nextSync,
  cachedRepositories: syncStatus.repositories.length,
  rateLimitRemaining: syncStatus.rateLimit.remaining,
  strategy: syncStatus.rateLimit.strategy
});
```

### Webhook Processing - Real GitHub Events
```typescript
import express from 'express';
import crypto from 'crypto';

const app = express();

// Webhook endpoint for real GitHub events
app.post('/api/webhooks/github', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const payload = req.body;
  
  // Verify webhook signature (real GitHub security)
  const expectedSignature = crypto
    .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  
  if (!crypto.timingSafeEqual(
    Buffer.from(`sha256=${expectedSignature}`),
    Buffer.from(signature)
  )) {
    return res.status(401).send('Invalid signature');
  }
  
  const event = JSON.parse(payload.toString());
  
  // Process different GitHub event types
  switch (req.headers['x-github-event']) {
    case 'workflow_run':
      handleWorkflowRunEvent(event);
      break;
    case 'workflow_job':
      handleWorkflowJobEvent(event);
      break;
    case 'push':
      handlePushEvent(event);
      break;
    case 'pull_request':
      handlePullRequestEvent(event);
      break;
  }
  
  res.status(200).send('OK');
});

// Handle workflow run events with real data structure
async function handleWorkflowRunEvent(event) {
  console.log(`Workflow ${event.action}:`, {
    id: event.workflow_run.id,
    name: event.workflow_run.name,
    status: event.workflow_run.status,
    conclusion: event.workflow_run.conclusion,
    repository: event.repository.full_name,
    actor: event.workflow_run.actor.login,
    branch: event.workflow_run.head_branch,
    commit: event.workflow_run.head_sha.substring(0, 7)
  });
  
  // Update local cache immediately
  await updateWorkflowRunCache(event.workflow_run);
  
  // Trigger runner scaling if needed
  if (event.action === 'requested') {
    await scaleRunnersIfNeeded(event.repository.full_name);
  }
}

// Handle workflow job events with real runner assignment
async function handleWorkflowJobEvent(event) {
  const job = event.workflow_job;
  
  console.log(`Job ${event.action}:`, {
    id: job.id,
    name: job.name,
    status: job.status,
    runner_id: job.runner_id,
    runner_name: job.runner_name,
    labels: job.labels,
    started_at: job.started_at,
    completed_at: job.completed_at
  });
  
  // Update job cache and runner status
  await updateJobCache(job);
  
  if (job.runner_id) {
    await updateRunnerStatus(job.runner_id, job.status === 'in_progress');
  }
}
```

### Dashboard Integration - Real-time Data
```typescript
// Real-time dashboard with GitHub API data
class GitHubDashboard {
  constructor() {
    this.githubApi = new GitHubAPIService();
    this.socket = io();
  }
  
  async initialize() {
    // Load real GitHub data
    await this.loadRepositories();
    await this.loadWorkflowRuns();
    await this.loadRunners();
    
    // Set up real-time updates
    this.setupWebSocketListeners();
    this.startPeriodicRefresh();
  }
  
  async loadRepositories() {
    const repos = await this.githubApi.getTrackedRepositories();
    
    const repoGrid = document.getElementById('repositories');
    repoGrid.innerHTML = repos.map(repo => `
      <div class="repo-card" data-repo-id="${repo.id}">
        <h3>${repo.full_name}</h3>
        <div class="repo-stats">
          <span class="stat">⭐ ${repo.stargazers_count}</span>
          <span class="stat">🍴 ${repo.forks_count}</span>
          <span class="stat">📝 ${repo.language || 'N/A'}</span>
          <span class="stat ${repo.private ? 'private' : 'public'}">
            ${repo.private ? '🔒 Private' : '🌐 Public'}
          </span>
        </div>
        <p class="repo-description">${repo.description || 'No description'}</p>
        <div class="repo-actions">
          <a href="${repo.html_url}" target="_blank">View on GitHub</a>
          <button onclick="dashboard.removeRepository('${repo.full_name}')">Remove</button>
        </div>
      </div>
    `).join('');
  }
  
  async loadWorkflowRuns() {
    const runs = await this.githubApi.getRecentWorkflowRuns();
    
    const runsTable = document.getElementById('workflow-runs');
    runsTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Workflow</th>
            <th>Repository</th>
            <th>Branch</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Actor</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          ${runs.map(run => `
            <tr class="status-${run.status}">
              <td>
                <a href="${run.html_url}" target="_blank">${run.name}</a>
              </td>
              <td>${run.repository.name}</td>
              <td>
                <code>${run.head_branch}</code>
                <small>${run.head_sha.substring(0, 7)}</small>
              </td>
              <td>
                <span class="status-badge status-${run.status}">
                  ${this.getStatusIcon(run.status)} ${run.status}
                  ${run.conclusion ? `(${run.conclusion})` : ''}
                </span>
              </td>
              <td>${this.formatDuration(run.run_started_at, run.updated_at)}</td>
              <td>
                <img src="${run.actor.avatar_url}" width="20" height="20" />
                ${run.actor.login}
              </td>
              <td>${this.formatRelativeTime(run.run_started_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  
  async loadRunners() {
    const runners = await this.githubApi.getRunners();
    
    const runnersGrid = document.getElementById('runners');
    runnersGrid.innerHTML = runners.map(runner => `
      <div class="runner-card status-${runner.status}">
        <div class="runner-header">
          <h4>${runner.name}</h4>
          <span class="runner-status ${runner.status}">
            ${this.getRunnerStatusIcon(runner.status)} ${runner.status}
          </span>
        </div>
        <div class="runner-details">
          <p><strong>OS:</strong> ${runner.os}</p>
          <p><strong>Busy:</strong> ${runner.busy ? 'Yes' : 'No'}</p>
          <p><strong>Group:</strong> ${runner.runner_group_name}</p>
          <div class="runner-labels">
            ${runner.labels.map(label => 
              `<span class="label ${label.type}">${label.name}</span>`
            ).join('')}
          </div>
        </div>
      </div>
    `).join('');
  }
  
  getStatusIcon(status) {
    const icons = {
      queued: '⏳',
      in_progress: '🔄',
      completed: '✅',
      cancelled: '❌',
      failure: '❌',
      success: '✅'
    };
    return icons[status] || '❓';
  }
  
  getRunnerStatusIcon(status) {
    const icons = {
      online: '🟢',
      offline: '🔴',
      busy: '🟡'
    };
    return icons[status] || '⚫';
  }
  
  formatDuration(start, end) {
    if (!start || !end) return 'N/A';
    const duration = Math.round((new Date(end) - new Date(start)) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  
  formatRelativeTime(timestamp) {
    if (!timestamp) return 'N/A';
    const now = new Date();
    const time = new Date(timestamp);
    const diff = Math.round((now - time) / 1000);
    
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
}

// Initialize dashboard with real GitHub data
const dashboard = new GitHubDashboard();
dashboard.initialize();
```

### Error Handling - Real GitHub API Errors
```typescript
// Comprehensive error handling for GitHub API
class GitHubErrorHandler {
  static async handleApiError(error: any, context: string) {
    console.error(`GitHub API Error in ${context}:`, error);
    
    // Handle specific GitHub API error codes
    switch (error.status) {
      case 401:
        console.error('Authentication failed - check GITHUB_TOKEN');
        await this.handleAuthError(error);
        break;
        
      case 403:
        if (error.headers['x-ratelimit-remaining'] === '0') {
          console.warn('Rate limit exceeded');
          await this.handleRateLimitError(error);
        } else {
          console.error('Forbidden - check token permissions');
          await this.handlePermissionError(error);
        }
        break;
        
      case 404:
        console.error('Resource not found - check repository/organization access');
        await this.handleNotFoundError(error, context);
        break;
        
      case 422:
        console.error('Validation failed:', error.response?.data?.errors);
        await this.handleValidationError(error);
        break;
        
      case 502:
      case 503:
      case 504:
        console.warn('GitHub API temporarily unavailable');
        await this.handleServiceUnavailable(error, context);
        break;
        
      default:
        console.error('Unexpected GitHub API error:', error.message);
        await this.handleUnexpectedError(error, context);
    }
  }
  
  static async handleRateLimitError(error: any) {
    const resetTime = error.headers['x-ratelimit-reset'];
    const resetDate = new Date(resetTime * 1000);
    const waitTime = resetDate.getTime() - Date.now();
    
    console.log(`Rate limit reset at: ${resetDate.toISOString()}`);
    console.log(`Waiting ${Math.round(waitTime / 1000)} seconds...`);
    
    // Switch to conservative strategy
    await githubApi.setRateLimitStrategy('conservative');
    
    // Notify monitoring system
    await this.notifyRateLimitExceeded(resetDate);
  }
  
  static async handleAuthError(error: any) {
    // Check if token is expired or invalid
    const tokenInfo = await this.validateToken();
    
    if (tokenInfo.expired) {
      console.error('GitHub token has expired');
      await this.requestTokenRenewal();
    } else if (!tokenInfo.valid) {
      console.error('GitHub token is invalid');
      await this.alertInvalidToken();
    }
  }
}
```

## API Endpoints

### Repository Management
```bash
# Get all tracked repositories
GET /api/github/repositories
```

Response:
```json
{
  "repositories": [
    {
      "id": 12345,
      "name": "GitHub-RunnerHub",
      "full_name": "anubissbe/GitHub-RunnerHub",
      "owner": {
        "login": "anubissbe",
        "id": 67890,
        "type": "User"
      },
      "private": true,
      "html_url": "https://github.com/anubissbe/GitHub-RunnerHub",
      "description": "GitHub Actions self-hosted runner management system",
      "fork": false,
      "created_at": "2024-12-01T10:00:00Z",
      "updated_at": "2024-12-20T14:30:00Z",
      "pushed_at": "2024-12-20T14:30:00Z",
      "size": 1024,
      "stargazers_count": 15,
      "watchers_count": 8,
      "language": "TypeScript",
      "forks_count": 3,
      "open_issues_count": 2,
      "default_branch": "main",
      "permissions": {
        "admin": true,
        "maintain": true,
        "push": true,
        "triage": true,
        "pull": true
      },
      "runners": {
        "total": 5,
        "online": 3,
        "busy": 1
      },
      "workflows": {
        "total": 3,
        "active": 1,
        "disabled": 0
      }
    }
  ],
  "total_count": 1
}
```

```bash
# Add repository to tracking
POST /api/github/repositories
{
  "owner": "anubissbe",
  "repo": "GitHub-RunnerHub"
}
```

```bash
# Remove repository from tracking
DELETE /api/github/repositories/{owner}/{repo}
```

```bash
# Get repository details
GET /api/github/repositories/{owner}/{repo}
```

### Workflow Management
```bash
# Get workflow runs for a repository
GET /api/github/repositories/{owner}/{repo}/workflows
```

Response:
```json
{
  "total_count": 156,
  "workflow_runs": [
    {
      "id": 7234567890,
      "name": "CI/CD Pipeline",
      "node_id": "WFR_kwDOABCD_7234567890",
      "head_branch": "main",
      "head_sha": "abc123def456789",
      "path": ".github/workflows/ci.yml",
      "display_title": "Update GitHub API integration",
      "run_number": 156,
      "event": "push",
      "status": "completed",
      "conclusion": "success",
      "workflow_id": 12345678,
      "check_suite_id": 98765432,
      "check_suite_node_id": "CS_kwDOABCD_98765432",
      "url": "https://api.github.com/repos/anubissbe/GitHub-RunnerHub/actions/runs/7234567890",
      "html_url": "https://github.com/anubissbe/GitHub-RunnerHub/actions/runs/7234567890",
      "pull_requests": [],
      "created_at": "2024-12-20T14:20:00Z",
      "updated_at": "2024-12-20T14:25:30Z",
      "actor": {
        "login": "anubissbe",
        "id": 67890,
        "type": "User"
      },
      "run_attempt": 1,
      "referenced_workflows": [],
      "run_started_at": "2024-12-20T14:20:05Z",
      "triggering_actor": {
        "login": "anubissbe",
        "id": 67890,
        "type": "User"
      },
      "jobs": [
        {
          "id": 1234567890,
          "run_id": 7234567890,
          "run_url": "https://api.github.com/repos/anubissbe/GitHub-RunnerHub/actions/runs/7234567890",
          "run_attempt": 1,
          "node_id": "J_kwDOABCD_1234567890",
          "head_sha": "abc123def456789",
          "url": "https://api.github.com/repos/anubissbe/GitHub-RunnerHub/actions/jobs/1234567890",
          "html_url": "https://github.com/anubissbe/GitHub-RunnerHub/actions/runs/7234567890/job/1234567890",
          "status": "completed",
          "conclusion": "success",
          "created_at": "2024-12-20T14:20:05Z",
          "started_at": "2024-12-20T14:20:10Z",
          "completed_at": "2024-12-20T14:25:15Z",
          "name": "Build and Test",
          "runner_id": 456,
          "runner_name": "Hosted Agent",
          "runner_group_id": 1,
          "runner_group_name": "GitHub Actions",
          "labels": ["ubuntu-latest"]
        }
      ]
    }
  ]
}
```

```bash
# Get specific workflow run
GET /api/github/workflows/{run_id}
```

```bash
# Cancel workflow run
POST /api/github/workflows/{run_id}/cancel
```

### Runner Management
```bash
# Get all runners for organization
GET /api/github/runners
```

Response:
```json
{
  "total_count": 8,
  "runners": [
    {
      "id": 123,
      "name": "runner-001",
      "os": "linux",
      "status": "online",
      "busy": false,
      "labels": [
        {
          "id": 1,
          "name": "self-hosted",
          "type": "read-only"
        },
        {
          "id": 2,
          "name": "linux",
          "type": "read-only"
        },
        {
          "id": 3,
          "name": "x64",
          "type": "read-only"
        },
        {
          "id": 4,
          "name": "docker",
          "type": "custom"
        },
        {
          "id": 5,
          "name": "projecthub",
          "type": "custom"
        }
      ],
      "runner_group_id": 1,
      "runner_group_name": "Default"
    },
    {
      "id": 124,
      "name": "runner-002",
      "os": "linux",
      "status": "online",
      "busy": true,
      "labels": [
        {
          "id": 1,
          "name": "self-hosted",
          "type": "read-only"
        },
        {
          "id": 2,
          "name": "linux",
          "type": "read-only"
        },
        {
          "id": 3,
          "name": "x64",
          "type": "read-only"
        }
      ],
      "runner_group_id": 1,
      "runner_group_name": "Default"
    }
  ]
}
```

```bash
# Get runners for specific repository
GET /api/github/repositories/{owner}/{repo}/runners
```

```bash
# Remove runner
DELETE /api/github/runners/{runner_id}
```

### Rate Limit Status
```bash
GET /api/github/status
```

Response (Real GitHub API Data):
```json
{
  "rateLimit": {
    "remaining": 4521,
    "limit": 5000,
    "reset": "2024-12-20T15:00:00Z",
    "resetIn": 2134000,
    "used": 479,
    "resource": "core"
  },
  "metrics": {
    "totalRequests": 1523,
    "successfulRequests": 1518,
    "failedRequests": 5,
    "rateLimitHits": 0,
    "averageResponseTime": 234.5,
    "lastRequestTime": "2024-12-20T14:30:15Z",
    "requestsLast24h": 2847
  },
  "integration": "enabled",
  "source": "vault",
  "tokenInfo": {
    "type": "personal_access_token",
    "scopes": ["repo", "workflow", "admin:org"],
    "expiresAt": "2025-06-20T00:00:00Z"
  },
  "repositories": {
    "tracked": 5,
    "accessible": 127,
    "privateRepos": 23,
    "organizationRepos": 45
  }
}
```

### Sync Status
```bash
GET /api/sync/status
```

Response (Real GitHub Integration Data):
```json
{
  "rateLimit": {
    "remaining": 4521,
    "limit": 5000,
    "resetIn": "35m",
    "strategy": "adaptive",
    "currentUsage": "9.6%"
  },
  "github": {
    "connection": "healthy",
    "lastSync": "2024-12-20T14:45:30Z",
    "syncDuration": "2.3s",
    "repositories": [
      {
        "name": "anubissbe/GitHub-RunnerHub",
        "lastActivity": "2024-12-20T14:30:00Z",
        "workflowRuns": 12,
        "queuedJobs": 2,
        "runners": {
          "online": 3,
          "offline": 1,
          "busy": 1
        }
      }
    ]
  },
  "database": {
    "online_runners": 5,
    "total_runners": 8,
    "active_workflows": 3,
    "total_repositories": 25,
    "cached_workflow_runs": 156,
    "cached_jobs": 342
  },
  "nextSyncIn": "2m 15s",
  "webhooks": {
    "configured": true,
    "lastWebhook": "2024-12-20T14:44:12Z",
    "queuedEvents": 0,
    "processedToday": 47
  }
}
```

## Monitoring & Alerts

### Recommended Monitoring
1. **Rate Limit Alerts**
   - Warning: < 500 remaining (10%)
   - Critical: < 100 remaining (2%)

2. **Performance Metrics**
   - Average response time > 1s
   - Queue length > 50
   - Failed requests > 5%

3. **Sync Health**
   - Last sync > 10 minutes ago
   - Webhook queue > 100 events

### Dashboard Integration
The RunnerHub dashboard displays:
- Current rate limit status
- Request metrics
- Sync status
- Error rates

## Best Practices

### 1. Choose the Right Strategy
- **Adaptive** (default): Best for most use cases
- **Conservative**: When sharing tokens or running background jobs
- **Aggressive**: For real-time features with dedicated tokens

### 2. Use Priorities Effectively
- **Critical**: User-facing, real-time operations
- **High**: Important background tasks
- **Normal**: Regular operations
- **Low**: Bulk operations, data collection

### 3. Monitor Rate Limits
```javascript
// Check before heavy operations
const status = client.getRateLimitStatus();
if (status.remaining < 1000) {
  logger.warn('Low rate limit, switching to conservative mode');
  // Adjust strategy or delay operations
}
```

### 4. Handle Webhooks
Webhooks reduce API calls significantly:
```javascript
// Process webhook instead of polling
app.post('/webhooks/github', (req, res) => {
  runnerSync.processWebhookEvent(req.body);
  res.status(200).send('OK');
});
```

## Testing

### Run Tests
```bash
# Unit tests
npm test -- github-api-enhanced.test.ts

# Integration tests
npm test -- --testNamePattern="integration"

# All tests
npm test
```

### Manual Testing
```bash
# Check rate limit
curl http://localhost:3001/api/github/status

# Trigger sync
curl -X POST http://localhost:3001/api/sync/trigger

# View metrics
curl http://localhost:3001/api/metrics
```

## Troubleshooting

### Common Issues

1. **Rate Limit Exceeded**
   - Check token permissions
   - Verify strategy settings
   - Review request patterns

2. **Slow Synchronization**
   - Check queue length
   - Review priority assignments
   - Monitor Redis connectivity

3. **Missing Data**
   - Verify webhook configuration
   - Check sync intervals
   - Review error logs

### Debug Mode
Enable detailed logging:
```bash
export LOG_LEVEL=debug
export DEBUG=github-api:*
```

## Performance Metrics

### Expected Performance
- **Request Overhead**: 50-100ms per request
- **Sync Interval**: 1-10 minutes (adaptive)
- **Webhook Processing**: < 500ms
- **Rate Limit Usage**: < 200 requests/hour (normal operation)

### Optimization Tips
1. Use webhooks to reduce polling
2. Batch similar requests
3. Cache responses when appropriate
4. Use GraphQL for complex queries

## Performance Optimization

### GitHub API Rate Limit Management

#### 1. Rate Limiting Strategies
```typescript
// Configure rate limiting strategy based on workload
const strategies = {
  conservative: {
    maxRequestsPerHour: 3000,        // 60% of limit
    requestInterval: 1200,           // 1.2 seconds between requests
    burstLimit: 10,                  // Max burst requests
    description: "Safe for shared tokens"
  },
  adaptive: {
    maxRequestsPerHour: 4000,        // 80% of limit
    requestInterval: 900,            // 0.9 seconds between requests
    burstLimit: 20,                  // Moderate burst
    description: "Balances performance and safety"
  },
  aggressive: {
    maxRequestsPerHour: 4800,        // 96% of limit
    requestInterval: 750,            // 0.75 seconds between requests
    burstLimit: 50,                  // High burst for real-time needs
    description: "Maximum performance for dedicated tokens"
  }
};

// Dynamic strategy switching based on rate limit status
function chooseStrategy(rateLimitStatus) {
  const usagePercent = (rateLimitStatus.used / rateLimitStatus.limit) * 100;
  
  if (usagePercent > 80) return 'conservative';
  if (usagePercent > 60) return 'adaptive';
  return 'aggressive';
}
```

#### 2. Caching Optimization
```typescript
// Optimized cache TTL configuration
const cacheTTLConfig = {
  repositories: {
    ttl: 300,                        // 5 minutes - repos change infrequently
    maxSize: 1000,                   // Max repos to cache
    strategy: 'LRU'
  },
  workflows: {
    ttl: 60,                         // 1 minute - workflows update frequently
    maxSize: 5000,
    strategy: 'LRU'
  },
  runners: {
    ttl: 30,                         // 30 seconds - runner status changes quickly
    maxSize: 500,
    strategy: 'LRU'
  },
  jobs: {
    ttl: 15,                         // 15 seconds - job status is critical
    maxSize: 10000,
    strategy: 'TTL'                  // Time-based for job data
  },
  rateLimits: {
    ttl: 5,                          // 5 seconds - rate limit info is critical
    maxSize: 10,
    strategy: 'FIFO'
  }
};

// Smart cache invalidation on webhook events
function invalidateCacheOnWebhook(event) {
  switch (event.action) {
    case 'workflow_run.requested':
      cache.del(`workflows:${event.repository.full_name}*`);
      break;
    case 'workflow_job.queued':
      cache.del(`jobs:${event.workflow_run.id}*`);
      cache.del(`runners:*`);        // Runner status may change
      break;
    case 'workflow_job.completed':
      cache.del(`jobs:${event.workflow_job.id}`);
      cache.del(`runners:${event.workflow_job.runner_id}`);
      break;
  }
}
```

#### 3. Request Batching and Prioritization
```typescript
// Priority-based request queue
interface GitHubRequest {
  fn: () => Promise<any>;
  priority: 'critical' | 'high' | 'normal' | 'low';
  retryCount?: number;
  timeout?: number;
}

class GitHubRequestQueue {
  private queues = {
    critical: [] as GitHubRequest[],
    high: [] as GitHubRequest[],
    normal: [] as GitHubRequest[],
    low: [] as GitHubRequest[]
  };

  // Process requests in priority order
  async processNext(): Promise<any> {
    const request = this.getNextRequest();
    if (!request) return null;

    try {
      return await this.executeWithRetry(request);
    } catch (error) {
      if (error.status === 403 && error.headers['x-ratelimit-remaining'] === '0') {
        // Rate limited - requeue with lower priority
        this.requeueWithDelay(request, error.headers['x-ratelimit-reset']);
      }
      throw error;
    }
  }

  private getNextRequest(): GitHubRequest | null {
    for (const priority of ['critical', 'high', 'normal', 'low']) {
      if (this.queues[priority].length > 0) {
        return this.queues[priority].shift()!;
      }
    }
    return null;
  }
}

// Batch similar requests to reduce API calls
async function batchRepositoryRequests(repos: string[]): Promise<any[]> {
  const BATCH_SIZE = 10;
  const batches = [];
  
  for (let i = 0; i < repos.length; i += BATCH_SIZE) {
    const batch = repos.slice(i, i + BATCH_SIZE);
    batches.push(batch);
  }

  const results = await Promise.allSettled(
    batches.map(batch => 
      Promise.all(batch.map(repo => fetchRepositoryData(repo)))
    )
  );

  return results.flatMap(result => 
    result.status === 'fulfilled' ? result.value : []
  );
}
```

### Database Performance Optimization

#### 1. Optimized Queries
```sql
-- Efficient workflow run queries with proper indexing
CREATE INDEX CONCURRENTLY idx_workflow_runs_repo_status_created 
  ON github_workflow_runs(repository_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY idx_jobs_run_status_started 
  ON github_jobs(run_id, status, started_at DESC);

CREATE INDEX CONCURRENTLY idx_runners_status_busy_cached 
  ON github_runners(status, busy, cached_at DESC);

-- Optimized query for dashboard data
WITH recent_runs AS (
  SELECT DISTINCT ON (repository_id) 
    repository_id, status, conclusion, created_at
  FROM github_workflow_runs 
  WHERE created_at > NOW() - INTERVAL '24 hours'
  ORDER BY repository_id, created_at DESC
),
runner_stats AS (
  SELECT 
    COUNT(*) as total_runners,
    COUNT(CASE WHEN status = 'online' THEN 1 END) as online_runners,
    COUNT(CASE WHEN busy = true THEN 1 END) as busy_runners
  FROM github_runners 
  WHERE cached_at > NOW() - INTERVAL '5 minutes'
)
SELECT 
  r.full_name,
  rr.status,
  rr.conclusion,
  rs.total_runners,
  rs.online_runners,
  rs.busy_runners
FROM github_repositories r
LEFT JOIN recent_runs rr ON r.id = rr.repository_id
CROSS JOIN runner_stats rs
ORDER BY r.full_name;
```

#### 2. Connection Pool Optimization
```typescript
// Optimized PostgreSQL connection pool
const poolConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  
  // Performance optimizations
  max: 20,                           // Maximum pool size
  min: 5,                            // Minimum pool size
  idleTimeoutMillis: 30000,          // 30 seconds idle timeout
  connectionTimeoutMillis: 5000,     // 5 seconds connection timeout
  
  // Connection optimization
  statement_timeout: 10000,          // 10 seconds statement timeout
  query_timeout: 5000,               // 5 seconds query timeout
  
  // Advanced settings
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  application_name: 'github-runnerhub',
  
  // Prepared statements for frequent queries
  preparedStatements: true,
  parseInputDatesAsUTC: true
};
```

#### 3. Redis Optimization
```typescript
// Redis optimization for caching and rate limiting
const redisConfig = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  
  // Performance settings
  connectTimeout: 5000,
  commandTimeout: 2000,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  
  // Memory optimization
  lazyConnect: true,
  keepAlive: 30000,
  
  // Cluster support (if using Redis Cluster)
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
  retryDelayOnFailover: 100,
  
  // Connection pooling
  family: 4,
  keyPrefix: 'runnerhub:',
  
  // Serialization optimization
  stringNumbers: true,
  enableOfflineQueue: false
};

// Efficient Redis pipeline for bulk operations
async function bulkCacheUpdate(updates: Array<{key: string, value: any, ttl: number}>) {
  const pipeline = redis.pipeline();
  
  updates.forEach(({key, value, ttl}) => {
    pipeline.setex(key, ttl, JSON.stringify(value));
  });
  
  const results = await pipeline.exec();
  return results?.every(([err]) => !err) ?? false;
}
```

### Monitoring and Metrics

#### 1. Performance Metrics Collection
```typescript
// Comprehensive performance monitoring
class PerformanceMonitor {
  private metrics = {
    githubApiRequests: new Map<string, number>(),
    githubApiResponseTimes: new Map<string, number[]>(),
    cacheHitRates: new Map<string, {hits: number, misses: number}>(),
    databaseQueryTimes: new Map<string, number[]>(),
    webhookProcessingTimes: new Array<number>()
  };

  recordGitHubApiRequest(endpoint: string, responseTime: number, success: boolean) {
    // Record request count
    const current = this.metrics.githubApiRequests.get(endpoint) || 0;
    this.metrics.githubApiRequests.set(endpoint, current + 1);

    // Record response time
    if (!this.metrics.githubApiResponseTimes.has(endpoint)) {
      this.metrics.githubApiResponseTimes.set(endpoint, []);
    }
    this.metrics.githubApiResponseTimes.get(endpoint)!.push(responseTime);

    // Keep only last 100 measurements
    const times = this.metrics.githubApiResponseTimes.get(endpoint)!;
    if (times.length > 100) {
      times.splice(0, times.length - 100);
    }
  }

  recordCacheAccess(key: string, hit: boolean) {
    if (!this.metrics.cacheHitRates.has(key)) {
      this.metrics.cacheHitRates.set(key, {hits: 0, misses: 0});
    }
    
    const stats = this.metrics.cacheHitRates.get(key)!;
    if (hit) {
      stats.hits++;
    } else {
      stats.misses++;
    }
  }

  getPerformanceReport() {
    return {
      githubApi: {
        totalRequests: Array.from(this.metrics.githubApiRequests.values()).reduce((a, b) => a + b, 0),
        averageResponseTime: this.calculateAverageResponseTime(),
        requestsByEndpoint: Object.fromEntries(this.metrics.githubApiRequests)
      },
      cache: {
        overallHitRate: this.calculateOverallCacheHitRate(),
        hitRatesByKey: this.calculateCacheHitRatesByKey()
      },
      database: {
        averageQueryTime: this.calculateAverageQueryTime(),
        slowestQueries: this.getSlowQueries()
      }
    };
  }
}
```

### Load Testing and Capacity Planning

#### 1. Performance Benchmarks
```bash
#!/bin/bash
# Performance testing script

echo "=== GitHub RunnerHub Performance Testing ==="

# Test 1: GitHub API rate limit handling
echo "Testing GitHub API rate limiting..."
for i in {1..100}; do
  curl -s -o /dev/null -w "%{http_code},%{time_total}\\n" \
    "http://localhost:3001/api/github/repositories" &
done
wait

# Test 2: Concurrent webhook processing
echo "Testing webhook processing under load..."
for i in {1..50}; do
  curl -X POST -s -o /dev/null -w "%{http_code},%{time_total}\\n" \
    -H "Content-Type: application/json" \
    -d '{"action":"workflow_run","workflow_run":{"id":12345}}' \
    "http://localhost:3001/api/webhooks/github" &
done
wait

# Test 3: Database query performance
echo "Testing database performance..."
time psql $DATABASE_URL -c "
  SELECT COUNT(*) FROM github_workflow_runs 
  WHERE created_at > NOW() - INTERVAL '1 hour';
"

# Test 4: Cache performance
echo "Testing Redis cache performance..."
redis-cli --latency-history -i 1 -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD
```

## Future Enhancements

1. **GraphQL Support**
   - Reduce API calls with batched queries
   - More efficient data fetching
   - Support for GitHub's GraphQL API v4

2. **Multi-Token Support**
   - Rotate between multiple tokens
   - Increase effective rate limit to 15,000+ req/hour
   - Load balancing across tokens

3. **Predictive Scaling**
   - ML-based usage prediction
   - Proactive rate limit management
   - Auto-scaling based on GitHub activity patterns

4. **Enhanced Caching**
   - Smart cache invalidation based on webhook events
   - Distributed cache support with Redis Cluster
   - Memory-optimized data structures

5. **Advanced Monitoring**
   - Real-time performance dashboards
   - Automated performance tuning
   - SLA monitoring and alerting

## Conclusion

The enhanced GitHub API integration provides a robust, production-ready solution for managing GitHub API interactions at scale. With smart rate limiting, distributed tracking, and comprehensive monitoring, the system ensures reliable operation while maximizing API usage efficiency.