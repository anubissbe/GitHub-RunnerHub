# GitHub-RunnerHub Troubleshooting Guide

## 🔍 Overview

This comprehensive troubleshooting guide helps you diagnose and resolve common issues with GitHub-RunnerHub. Issues are organized by category with step-by-step solutions.

## 🚨 Emergency Quick Fixes

### System Not Responding
```bash
# Check all services
docker-compose ps

# Restart all services
docker-compose restart

# Check system resources
df -h && free -h && docker system df
```

### Dashboard Not Loading
```bash
# Quick health check
curl http://localhost:3001/health

# Restart API service
docker-compose restart api

# Check API logs
docker-compose logs -f api
```

### Jobs Not Running
```bash
# Check runner status
curl http://localhost:3001/api/runners

# Check job queue
curl http://localhost:3001/api/jobs?status=queued

# Restart job processor
docker-compose restart queue-worker
```

## 📂 Issue Categories

### 1. Installation & Setup Issues

#### Installation Script Fails
**Symptoms**: Installation script exits with errors

**Diagnosis**:
```bash
# Check prerequisites
docker --version
docker-compose --version
git --version

# Check available disk space
df -h

# Check available memory
free -h

# Check ports availability
netstat -tlnp | grep -E ':3001|:5432|:6379|:8200'
```

**Solutions**:

1. **Missing Dependencies**:
   ```bash
   # Ubuntu/Debian
   sudo apt update
   sudo apt install docker.io docker-compose git curl

   # CentOS/RHEL
   sudo yum install docker docker-compose git curl
   sudo systemctl start docker
   sudo systemctl enable docker
   ```

2. **Port Conflicts**:
   ```bash
   # Kill conflicting processes
   sudo lsof -ti:3001 | xargs sudo kill -9
   sudo lsof -ti:5432 | xargs sudo kill -9
   
   # Or change ports in docker-compose.yml
   ```

3. **Insufficient Resources**:
   ```bash
   # Clean up Docker
   docker system prune -a
   docker volume prune
   
   # Free up disk space
   sudo apt autoremove
   sudo apt autoclean
   ```

#### Database Connection Issues
**Symptoms**: "Database connection failed" errors

**Diagnosis**:
```bash
# Check PostgreSQL container
docker-compose ps postgres

# Test database connection
docker-compose exec postgres psql -U runnerhub -d runnerhub -c "SELECT 1;"

# Check database logs
docker-compose logs postgres
```

**Solutions**:

1. **Container Not Running**:
   ```bash
   # Start PostgreSQL
   docker-compose up -d postgres
   
   # Wait for startup
   sleep 10
   
   # Verify connection
   docker-compose exec postgres pg_isready
   ```

2. **Connection String Issues**:
   ```bash
   # Check environment variables
   cat .env | grep DATABASE_URL
   
   # Update connection string
   DATABASE_URL=postgresql://runnerhub:password@postgres:5432/runnerhub
   ```

3. **Database Corruption**:
   ```bash
   # Backup existing data
   docker-compose exec postgres pg_dump -U runnerhub runnerhub > backup.sql
   
   # Reset database
   docker-compose down -v
   docker-compose up -d postgres
   
   # Restore data if needed
   docker-compose exec -T postgres psql -U runnerhub -d runnerhub < backup.sql
   ```

### 2. GitHub Integration Issues

#### GitHub API Connection Failed
**Symptoms**: "GitHub API unreachable" or "Invalid token" errors

**Diagnosis**:
```bash
# Test GitHub token
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user

# Check rate limits
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit

# Test organization access
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/orgs/YOUR_ORG
```

**Solutions**:

1. **Invalid Token**:
   ```bash
   # Generate new token at github.com/settings/tokens
   # Ensure these scopes: repo, admin:org, workflow
   
   # Update environment
   export GITHUB_TOKEN=ghp_new_token_here
   echo "GITHUB_TOKEN=ghp_new_token_here" >> .env
   
   # Restart services
   docker-compose restart
   ```

2. **Rate Limiting**:
   ```bash
   # Check current limits
   curl -H "Authorization: token $GITHUB_TOKEN" \
     https://api.github.com/rate_limit
   
   # Enable caching to reduce API calls
   curl -X PUT http://localhost:3001/api/github/cache \
     -H "Content-Type: application/json" \
     -d '{"enabled": true, "ttl": 300}'
   ```

3. **Organization Access**:
   ```bash
   # Verify organization membership
   curl -H "Authorization: token $GITHUB_TOKEN" \
     https://api.github.com/orgs/YOUR_ORG/members/YOUR_USERNAME
   
   # Check runner permissions
   curl -H "Authorization: token $GITHUB_TOKEN" \
     https://api.github.com/orgs/YOUR_ORG/actions/runners
   ```

#### Webhook Not Receiving Events
**Symptoms**: Jobs not appearing in dashboard, no real-time updates

**Diagnosis**:
```bash
# Check webhook configuration
curl http://localhost:3001/api/github/webhooks

# Check webhook logs
docker-compose logs api | grep webhook

# Test webhook endpoint
curl -X POST http://localhost:3001/api/webhooks/github \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

**Solutions**:

1. **Webhook Not Configured**:
   ```bash
   # Configure webhook in GitHub repository/organization
   # URL: https://your-domain.com/api/webhooks/github
   # Events: workflow_job, workflow_run, check_run
   # Content type: application/json
   ```

2. **SSL/Domain Issues**:
   ```bash
   # For development, use ngrok
   npm install -g ngrok
   ngrok http 3001
   
   # Use the ngrok URL for webhook
   ```

3. **Firewall Issues**:
   ```bash
   # Check if port 3001 is accessible
   sudo ufw status
   sudo ufw allow 3001
   
   # For cloud deployments, check security groups
   ```

### 3. Runner Issues

#### Runner Not Appearing in Dashboard
**Symptoms**: Runner registered with GitHub but not visible in RunnerHub

**Diagnosis**:
```bash
# Check runner service status
sudo systemctl status github-runner-runnerhub-*

# Check runner logs
sudo journalctl -u github-runner-runnerhub-1 -f

# Check GitHub runner registration
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/orgs/YOUR_ORG/actions/runners
```

**Solutions**:

1. **Runner Service Issues**:
   ```bash
   # Restart runner service
   sudo systemctl restart github-runner-runnerhub-1
   
   # Check service configuration
   sudo systemctl status github-runner-runnerhub-1 -l
   
   # Reconfigure runner
   cd ~/actions-runner
   sudo ./svc.sh uninstall
   ./config.sh remove --token $RUNNER_REMOVE_TOKEN
   ./config.sh --url https://github.com/YOUR_ORG --token $RUNNER_TOKEN
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```

2. **Network Connectivity**:
   ```bash
   # Test GitHub connectivity
   curl -v https://api.github.com/
   
   # Test RunnerHub API
   curl http://localhost:3001/health
   
   # Check DNS resolution
   nslookup github.com
   nslookup your-runnerhub-domain.com
   ```

3. **Authentication Issues**:
   ```bash
   # Generate new runner token
   curl -X POST \
     -H "Authorization: token $GITHUB_TOKEN" \
     https://api.github.com/orgs/YOUR_ORG/actions/runners/registration-token
   
   # Reconfigure with new token
   ./config.sh --url https://github.com/YOUR_ORG --token $NEW_TOKEN
   ```

#### Runner Stuck in "Busy" State
**Symptoms**: Runner shows as busy but no job is running

**Diagnosis**:
```bash
# Check runner processes
ps aux | grep Runner

# Check for stuck containers
docker ps -a | grep runner

# Check job queue
curl http://localhost:3001/api/jobs?status=running
```

**Solutions**:

1. **Force Runner Reset**:
   ```bash
   # Stop runner service
   sudo systemctl stop github-runner-runnerhub-1
   
   # Kill any stuck processes
   sudo pkill -f Runner.Listener
   sudo pkill -f Runner.Worker
   
   # Clean up containers
   docker ps -q --filter "label=runner=runnerhub-1" | xargs docker stop
   docker ps -aq --filter "label=runner=runnerhub-1" | xargs docker rm
   
   # Restart runner
   sudo systemctl start github-runner-runnerhub-1
   ```

2. **Container Cleanup**:
   ```bash
   # Force cleanup via API
   curl -X POST http://localhost:3001/api/cleanup/force \
     -H "Authorization: Bearer $JWT_TOKEN"
   
   # Manual container cleanup
   docker system prune -f
   docker volume prune -f
   ```

### 4. Container & Job Issues

#### Jobs Failing with Container Errors
**Symptoms**: Jobs fail during container creation or execution

**Diagnosis**:
```bash
# Check Docker daemon
sudo systemctl status docker

# Check available disk space
df -h /var/lib/docker

# Check container logs
docker logs $(docker ps -q --filter "label=job-id=YOUR_JOB_ID")

# Check job logs
curl http://localhost:3001/api/jobs/YOUR_JOB_ID/logs
```

**Solutions**:

1. **Docker Space Issues**:
   ```bash
   # Clean up Docker
   docker system prune -a -f
   docker volume prune -f
   
   # Remove old images
   docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.CreatedAt}}" | grep "weeks ago" | awk '{print $1":"$2}' | xargs docker rmi
   
   # Check available space
   df -h /var/lib/docker
   ```

2. **Container Resource Limits**:
   ```bash
   # Check resource usage
   docker stats
   
   # Increase limits in configuration
   curl -X PUT http://localhost:3001/api/config/resources \
     -H "Authorization: Bearer $JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "cpu": "4",
       "memory": "8g",
       "storage": "50g"
     }'
   ```

3. **Image Pull Issues**:
   ```bash
   # Test image pull manually
   docker pull ghcr.io/actions/runner:latest
   
   # Check registry connectivity
   curl -v https://ghcr.io/v2/
   
   # Configure registry authentication
   docker login ghcr.io
   ```

#### Job Queue Backup
**Symptoms**: Jobs stuck in queue, not being processed

**Diagnosis**:
```bash
# Check queue status
curl http://localhost:3001/api/queue/status

# Check worker processes
docker-compose ps queue-worker

# Check Redis connectivity
docker-compose exec redis redis-cli ping
```

**Solutions**:

1. **Queue Worker Issues**:
   ```bash
   # Restart queue workers
   docker-compose restart queue-worker
   
   # Scale up workers
   docker-compose up -d --scale queue-worker=3
   
   # Check worker logs
   docker-compose logs -f queue-worker
   ```

2. **Redis Issues**:
   ```bash
   # Restart Redis
   docker-compose restart redis
   
   # Check Redis memory
   docker-compose exec redis redis-cli info memory
   
   # Clear stuck jobs (use with caution)
   docker-compose exec redis redis-cli flushdb
   ```

### 5. Performance Issues

#### Slow Dashboard Loading
**Symptoms**: Dashboard takes long time to load or times out

**Diagnosis**:
```bash
# Check API response times
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3001/api/dashboard

# Check database performance
docker-compose exec postgres psql -U runnerhub -d runnerhub -c "
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;"

# Check memory usage
free -h
docker stats
```

**Solutions**:

1. **Database Optimization**:
   ```bash
   # Analyze and vacuum database
   docker-compose exec postgres psql -U runnerhub -d runnerhub -c "
   VACUUM ANALYZE;
   REINDEX DATABASE runnerhub;"
   
   # Update database statistics
   docker-compose exec postgres psql -U runnerhub -d runnerhub -c "
   ANALYZE;"
   ```

2. **Enable Caching**:
   ```bash
   # Enable Redis caching
   curl -X PUT http://localhost:3001/api/config/cache \
     -H "Authorization: Bearer $JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "enabled": true,
       "ttl": 300,
       "maxMemory": "1gb"
     }'
   ```

3. **Increase Resources**:
   ```bash
   # Update Docker Compose with more resources
   # Edit docker-compose.yml:
   services:
     api:
       deploy:
         resources:
           limits:
             memory: 2G
             cpus: '2'
   
   # Restart with new limits
   docker-compose up -d
   ```

#### High CPU/Memory Usage
**Symptoms**: System sluggish, high resource usage

**Diagnosis**:
```bash
# Check system resources
top
htop
iostat 1

# Check container resources
docker stats

# Check for resource leaks
ps aux --sort=-%cpu | head -20
ps aux --sort=-%mem | head -20
```

**Solutions**:

1. **Container Resource Limits**:
   ```bash
   # Set container limits
   echo "deploy:
     resources:
       limits:
         memory: 1G
         cpus: '1'" >> docker-compose.yml
   
   # Restart services
   docker-compose up -d
   ```

2. **Clean Up Resources**:
   ```bash
   # Clean up old containers
   docker container prune -f
   
   # Clean up old images
   docker image prune -a -f
   
   # Clean up volumes
   docker volume prune -f
   
   # Clean up networks
   docker network prune -f
   ```

## 🛠️ Diagnostic Tools

### Health Check Script
```bash
#!/bin/bash
# health-check.sh

echo "=== GitHub-RunnerHub Health Check ==="

# Check services
echo "Checking services..."
docker-compose ps

# Check disk space
echo "Checking disk space..."
df -h

# Check memory
echo "Checking memory..."
free -h

# Check API health
echo "Checking API health..."
curl -s http://localhost:3001/health | jq .

# Check database
echo "Checking database..."
docker-compose exec -T postgres pg_isready

# Check Redis
echo "Checking Redis..."
docker-compose exec -T redis redis-cli ping

# Check GitHub connectivity
echo "Checking GitHub API..."
curl -s -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit | jq .

echo "=== Health Check Complete ==="
```

### Log Aggregation Script
```bash
#!/bin/bash
# collect-logs.sh

LOG_DIR="./troubleshooting-logs-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

# Collect Docker logs
echo "Collecting Docker logs..."
docker-compose logs --no-color > "$LOG_DIR/docker-compose.log"

# Collect system logs
echo "Collecting system logs..."
journalctl -u docker --no-pager > "$LOG_DIR/docker-system.log"
journalctl -u github-runner-* --no-pager > "$LOG_DIR/runner-services.log"

# Collect API logs
echo "Collecting API logs..."
docker-compose logs --no-color api > "$LOG_DIR/api.log"

# Collect health status
echo "Collecting health status..."
curl -s http://localhost:3001/health > "$LOG_DIR/health.json"
curl -s http://localhost:3001/api/status > "$LOG_DIR/status.json"

# Collect configuration
echo "Collecting configuration..."
cp .env "$LOG_DIR/env.txt" 2>/dev/null || echo "No .env file found"
docker-compose config > "$LOG_DIR/docker-config.yml"

# Create archive
tar -czf "${LOG_DIR}.tar.gz" "$LOG_DIR"
echo "Logs collected in ${LOG_DIR}.tar.gz"
```

## 📞 Getting Help

### Before Contacting Support

1. **Run Health Check**: Use the health check script above
2. **Collect Logs**: Use the log collection script  
3. **Check Documentation**: Review relevant documentation sections
4. **Search Issues**: Check GitHub issues for similar problems

### Support Channels

- **GitHub Issues**: [Report bugs and feature requests](https://github.com/anubissbe/GitHub-RunnerHub/issues)
- **Documentation**: Complete documentation in `/docs` directory
- **Community**: GitHub Discussions for questions and help

### Creating a Support Request

Include the following information:

1. **Environment Details**:
   - Operating system and version
   - Docker version
   - Hardware specifications
   - Installation method

2. **Problem Description**:
   - Detailed description of the issue
   - Steps to reproduce
   - Expected vs actual behavior
   - Error messages (exact text)

3. **Logs and Diagnostics**:
   - Health check output
   - Relevant log files
   - Configuration (sanitized)
   - Screenshots if applicable

4. **Troubleshooting Attempted**:
   - Steps already tried
   - Results of those steps
   - Any temporary workarounds

This troubleshooting guide covers the most common issues and their solutions. For additional help, refer to the specific troubleshooting documents in the `/troubleshooting` directory.