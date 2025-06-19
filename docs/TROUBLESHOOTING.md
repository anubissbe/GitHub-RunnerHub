# 🔧 GitHub RunnerHub Troubleshooting Guide

## Common Issues and Solutions

### 🚫 Runners Not Starting

#### Symptoms
- Runners show as "offline" in dashboard
- Workflows remain queued indefinitely
- No runners visible in GitHub repository settings

#### Solutions

1. **Check GitHub Token**
```bash
# Verify token is valid
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user

# Check token scopes (should include repo, workflow, admin:org)
curl -sI -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user | grep x-oauth-scopes
```

2. **Verify Docker Containers**
```bash
# Check if runners are running
docker ps | grep runnerhub

# Check runner logs
docker logs runnerhub-dedicated-github-runnerhub

# Restart specific runner
docker restart runnerhub-dedicated-github-runnerhub
```

3. **Check Backend Logs**
```bash
# View backend logs
docker-compose -f docker-compose.production.yml logs -f backend

# Check for specific errors
docker-compose logs backend | grep -E "(Error|Failed|Exception)"
```

### ❌ Workflows Stuck in Queue

#### Symptoms
- Workflows show "queued" status
- Runners are online but not picking up jobs
- Multiple workflows waiting

#### Solutions

1. **Verify Runner Labels**
```bash
# Check runner labels via API
curl http://localhost:8300/api/public/runners | jq '.[].labels'

# Ensure workflow uses correct labels
# In .github/workflows/your-workflow.yml:
# runs-on: [self-hosted, runnerhub]
```

2. **Force Dynamic Runner Creation**
```bash
# Restart backend to trigger runner checks
docker-compose -f docker-compose.production.yml restart backend

# Monitor dynamic runner creation
docker-compose logs -f backend | grep "dynamic"
```

3. **Cancel Stuck Workflows**
```bash
# List queued workflows
gh run list --repo your-org/your-repo --status queued

# Cancel specific workflow
gh run cancel <run-id>
```

### 🔴 Frontend Connection Issues

#### Symptoms
- Dashboard shows "Disconnected"
- No real-time updates
- API calls return 404 or CORS errors

#### Solutions

1. **Check CORS Configuration**
```bash
# Verify backend is accessible
curl http://localhost:8300/health

# Test WebSocket connection
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
  http://localhost:8300
```

2. **Rebuild Frontend**
```bash
# Rebuild with correct API URL
docker-compose -f docker-compose.production.yml build frontend --no-cache

# Restart frontend
docker-compose -f docker-compose.production.yml up -d frontend
```

3. **Check Environment Variables**
```bash
# Verify frontend environment
docker-compose exec frontend printenv | grep API

# Check backend CORS settings
docker-compose exec backend printenv | grep CORS
```

### 💥 Runner Registration Failures

#### Symptoms
- "Http response code: NotFound" in logs
- "Invalid configuration provided for token" errors
- Runners exit immediately after starting

#### Solutions

1. **Generate New Token**
```bash
# Create new PAT at: https://github.com/settings/tokens
# Required scopes: repo, workflow, admin:org

# Update token in .env file
GITHUB_TOKEN=ghp_your_new_token_here

# Restart services
docker-compose -f docker-compose.production.yml down
docker-compose -f docker-compose.production.yml up -d
```

2. **Clean Up Failed Runners**
```bash
# Remove all failed runner containers
docker ps -a | grep runnerhub | grep -E "(Exited|Created)" | awk '{print $1}' | xargs -r docker rm -f

# Let backend recreate runners
docker-compose restart backend
```

### 🔄 Dynamic Runners Not Spawning

#### Symptoms
- Only dedicated runners visible
- No dynamic runners created under load
- System shows "0 busy" even with queued jobs

#### Solutions

1. **Check Auto-Scaling Logic**
```bash
# Monitor auto-scaler logs
docker-compose logs -f backend | grep -E "(scale|dynamic|spawn)"

# Verify configuration
docker-compose exec backend printenv | grep -E "(MAX_RUNNERS|IDLE_TIMEOUT)"
```

2. **Manual Dynamic Runner Creation**
```bash
# SSH to server and create manually
docker run -d \
  --name runnerhub-dynamic-test \
  --network github-runnerhub_runnerhub \
  -e RUNNER_NAME="runnerhub-dynamic-test" \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  -e LABELS="self-hosted,docker,runnerhub,dynamic" \
  -e REPO_URL="https://github.com/your-org/your-repo" \
  -e EPHEMERAL="true" \
  myoung34/github-runner:latest
```

### 📊 Monitoring and Diagnostics

#### Health Check Commands

```bash
# System health
curl http://localhost:8300/health | jq

# Runner status
curl http://localhost:8300/api/public/runners | jq

# Check specific repository
curl http://localhost:8300/health | jq '.repositoryDetails["your-repo"]'

# WebSocket test
websocat ws://localhost:8300
```

#### Log Analysis

```bash
# Get all error logs
docker-compose logs --tail=1000 | grep -i error > errors.log

# Check runner registration
docker-compose logs backend | grep -i "runner.*created"

# Monitor real-time
watch -n 5 'docker ps | grep runnerhub'
```

### 🛠️ Advanced Debugging

#### Enable Debug Logging

1. **Backend Debug Mode**
```bash
# Add to docker-compose.production.yml
environment:
  - DEBUG=runnerhub:*
  - LOG_LEVEL=debug
```

2. **Runner Debug Mode**
```bash
# Add to runner environment
-e RUNNER_DEBUG=1
```

#### Direct API Testing

```bash
# Test runner registration endpoint
curl -X POST http://localhost:8300/api/internal/runners/test \
  -H "Content-Type: application/json" \
  -d '{"repository": "test-repo"}'

# Force health check
curl -X POST http://localhost:8300/api/internal/health/check
```

### 📞 Getting Help

If you're still experiencing issues:

1. **Check Logs**
   - Collect all relevant logs
   - Note exact error messages
   - Document steps to reproduce

2. **Open an Issue**
   - Go to: https://github.com/anubissbe/GitHub-RunnerHub/issues
   - Use the bug report template
   - Include logs and configuration

3. **Community Support**
   - GitHub Discussions: https://github.com/anubissbe/GitHub-RunnerHub/discussions
   - Include your setup details
   - Describe what you've already tried

### 🔍 Useful Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Self-Hosted Runners Guide](https://docs.github.com/en/actions/hosting-your-own-runners)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [GitHub API Reference](https://docs.github.com/en/rest)