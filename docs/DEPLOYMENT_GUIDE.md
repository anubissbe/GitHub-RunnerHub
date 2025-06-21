# GitHub RunnerHub - Deployment Guide

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Deployment Options](#deployment-options)
- [Remote Server Deployment](#remote-server-deployment)
- [Configuration](#configuration)
- [Post-Deployment](#post-deployment)
- [Troubleshooting](#troubleshooting)
- [Maintenance](#maintenance)

## Overview

GitHub RunnerHub is a dynamic GitHub Actions self-hosted runner management system with auto-scaling capabilities and real-time monitoring dashboard. This guide covers deployment to production servers.

## Prerequisites

### System Requirements
- **OS**: Ubuntu 20.04+ or similar Linux distribution
- **RAM**: Minimum 4GB (8GB recommended)
- **Storage**: 20GB+ free disk space
- **Network**: Stable internet connection
- **Ports**: 80, 3001 (configurable)

### Software Requirements
- Docker 20.10+
- Docker Compose 2.0+ (optional)
- SSH access to target server
- Git (for cloning repository)

## Deployment Options

### 1. Quick Start (Development)
```bash
./quick-start.sh
```

### 2. Remote Server Deployment (Production)
```bash
./deploy-to-remote.sh
```

### 3. Manual Deployment
Follow the steps in this guide for custom deployments.

## Remote Server Deployment

### Step 1: Prepare Configuration

1. Clone the repository locally:
```bash
git clone https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub.git
cd GitHub-RunnerHub
```

2. Set up GitHub token with required permissions:
   - Go to GitHub → Settings → Developer settings → Personal access tokens
   - Create token with scopes: `repo`, `workflow`, `admin:org`, `read:user`
   - For GitHub App: Configure with permissions for `actions`, `contents`, `metadata`, `workflows`

3. Generate configuration:
```bash
./remote-quick-start.sh
```

This creates a `.env` file with:
- GitHub API credentials and configuration
- Generated secure passwords for database and Redis
- Database configuration with GitHub integration tables
- Redis settings for caching and rate limiting
- Webhook configuration for real-time updates
- Security settings and JWT secrets

4. Validate GitHub API access:
```bash
# Test GitHub API connectivity
node test-github-integration.js

# This will verify:
# - Token permissions and scopes
# - Rate limit status
# - Organization/repository access
# - Webhook configuration capability
```

### Step 2: Deploy to Server

#### Option A: Automated Deployment
```bash
./deploy-to-remote.sh
```

This script:
- Checks prerequisites
- Copies files to server
- Sets up Docker environment
- Starts all services
- Creates systemd service

#### Option B: Manual Deployment

1. Copy files to server:
```bash
rsync -av --exclude='node_modules' --exclude='.git' \
  ./ user@your-server:/opt/github-runnerhub/
```

2. SSH to server:
```bash
ssh user@your-server
cd /opt/github-runnerhub
```

3. Start services:
```bash
docker-compose -f docker-compose.remote.yml up -d
```

### Step 3: Initialize Database

1. Initialize standard database:
```bash
docker exec -i runnerhub-postgres psql -U $DB_USER -d $DB_NAME < docker/postgres/init.sql
```

2. Set up GitHub integration tables:
```bash
# Create GitHub-specific tables for caching and tracking
docker exec -i runnerhub-postgres psql -U $DB_USER -d $DB_NAME << 'EOF'
-- GitHub repositories tracking
CREATE TABLE IF NOT EXISTS github_repositories (
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
CREATE TABLE IF NOT EXISTS github_workflow_runs (
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
CREATE TABLE IF NOT EXISTS github_jobs (
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
CREATE TABLE IF NOT EXISTS github_runners (
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

-- GitHub API rate limiting tracking
CREATE TABLE IF NOT EXISTS github_rate_limits (
  id SERIAL PRIMARY KEY,
  resource VARCHAR(50) NOT NULL,
  limit_value INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  reset_time TIMESTAMP WITH TIME ZONE NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_github_repos_full_name ON github_repositories(full_name);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo_status ON github_workflow_runs(repository_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_run_status ON github_jobs(run_id, status);
CREATE INDEX IF NOT EXISTS idx_runners_status ON github_runners(status, busy);
CREATE INDEX IF NOT EXISTS idx_rate_limits_resource ON github_rate_limits(resource, recorded_at);
EOF
```

3. Verify database setup:
```bash
# Check tables were created
docker exec runnerhub-postgres psql -U $DB_USER -d $DB_NAME -c "\dt github_*"

# Verify GitHub integration is working
node setup-database.js --verify-github
```

## Configuration

### Environment Variables

Key configuration in `.env`:

```bash
# GitHub API Configuration (Required)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx         # Personal Access Token with required scopes
GITHUB_ORG=your_organization                  # Organization name (optional for personal repos)
GITHUB_APP_ID=123456                         # GitHub App ID (if using GitHub App)
GITHUB_APP_PRIVATE_KEY_PATH=/secrets/app.pem # GitHub App private key path

# GitHub API Advanced Settings
GITHUB_RATE_LIMIT_STRATEGY=adaptive          # Options: conservative, aggressive, adaptive
GITHUB_MAX_REQUESTS_PER_HOUR=4500            # Rate limit threshold (default: 4500)
GITHUB_REQUEST_TIMEOUT=30000                 # Request timeout in milliseconds
GITHUB_RETRY_COUNT=3                         # Number of retries for failed requests
GITHUB_BASE_URL=https://api.github.com       # GitHub Enterprise Server URL (if applicable)

# GitHub Caching Configuration
GITHUB_CACHE_TTL_REPOS=300                   # Repository cache TTL (seconds)
GITHUB_CACHE_TTL_WORKFLOWS=60                # Workflow runs cache TTL (seconds)
GITHUB_CACHE_TTL_RUNNERS=30                  # Runners cache TTL (seconds)
GITHUB_CACHE_TTL_JOBS=30                     # Jobs cache TTL (seconds)

# GitHub Webhook Configuration
GITHUB_WEBHOOK_SECRET=your_webhook_secret     # Webhook payload verification secret
GITHUB_WEBHOOK_URL=https://your-domain.com/webhooks/github # Public webhook URL

# GitHub Feature Flags
GITHUB_ENABLE_WEBHOOKS=true                  # Enable webhook processing
GITHUB_ENABLE_CACHING=true                   # Enable Redis caching
GITHUB_ENABLE_METRICS=true                   # Enable metrics collection
GITHUB_ENABLE_AUTO_SYNC=true                 # Enable automatic synchronization

# Application Configuration
NODE_ENV=production
PORT=3001
EXTERNAL_HOST=your.server.ip
LOG_LEVEL=info                               # Log level: debug, info, warn, error

# Database Configuration (auto-generated)
DATABASE_URL=postgresql://user:password@host:5432/database
DB_USER=runnerhub
DB_PASSWORD=secure_password
DB_NAME=github_runnerhub
DB_HOST=runnerhub-postgres
DB_PORT=5432

# Redis Configuration (auto-generated)
REDIS_URL=redis://:secure_password@runnerhub-redis:6379/0
REDIS_HOST=runnerhub-redis
REDIS_PORT=6379
REDIS_PASSWORD=secure_password

# Security Configuration (auto-generated)
JWT_SECRET=random_secret_64_chars_long
ENCRYPTION_KEY=random_key_32_chars_long
SESSION_SECRET=random_session_secret

# HashiCorp Vault Configuration (Production)
VAULT_ADDR=https://vault.your-domain.com:8200
VAULT_TOKEN=hvs.YOUR_VAULT_TOKEN
VAULT_MOUNT_PATH=secret
VAULT_GITHUB_PATH=api-keys
```

### Docker Compose Configuration

The `docker-compose.remote.yml` includes:
- PostgreSQL with pgvector extension
- Redis for job queue
- RunnerHub application
- Optional Nginx proxy

### Network Configuration

Services communicate via Docker network:
- Internal network: `runnerhub-network`
- PostgreSQL: `runnerhub-postgres:5432`
- Redis: `runnerhub-redis:6379`

## Post-Deployment

### 1. Verify Services

Check all services are running:
```bash
docker ps | grep runnerhub
```

Expected output:
```
runnerhub-app       Up      0.0.0.0:3001->3001/tcp
runnerhub-postgres  Up      5432/tcp
runnerhub-redis     Up      6379/tcp
```

### 2. Test Endpoints

- **Health Check**: `http://your-server:3001/health`
- **Dashboard**: `http://your-server:3001/dashboard`
- **API**: `http://your-server:3001/api`

### 3. Configure GitHub Webhooks

In your GitHub organization settings:
1. Go to Settings → Webhooks
2. Add webhook:
   - URL: `http://your-server:3001/api/webhooks`
   - Content type: `application/json`
   - Events: `Workflow jobs`, `Workflow runs`

### 4. Set Up SSL (Recommended)

Using Nginx reverse proxy:
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Troubleshooting

### GitHub API Issues

#### 1. GitHub Token Authentication Failed
```bash
# Verify token validity
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user

# Expected response: User information JSON
# Error responses:
# - 401: Invalid token
# - 403: Token doesn't have required scopes

# Check token scopes
curl -H "Authorization: token $GITHUB_TOKEN" -I https://api.github.com/user
# Look for 'X-OAuth-Scopes' header
```

**Solutions:**
- Regenerate token with correct scopes: `repo`, `workflow`, `admin:org`
- For GitHub Enterprise: Update `GITHUB_BASE_URL` in .env
- Verify token hasn't expired

#### 2. Rate Limit Exceeded
```bash
# Check current rate limit status
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit

# Check application logs
docker logs runnerhub-app | grep "rate limit"
```

**Solutions:**
- Wait for rate limit reset (check `reset` timestamp)
- Switch to `conservative` rate limiting strategy
- Use GitHub App for higher rate limits (5000 → 15000/hour)
- Configure multiple tokens for load balancing

#### 3. GitHub Webhook Issues
```bash
# Test webhook endpoint
curl -X POST http://your-server:3001/api/webhooks/github \
  -H \"Content-Type: application/json\" \
  -d '{\"action\": \"test\"}'

# Check webhook logs
docker logs runnerhub-app | grep webhook
```

**Solutions:**
- Verify webhook URL is publicly accessible
- Check webhook secret matches `GITHUB_WEBHOOK_SECRET`
- Ensure firewall allows inbound connections on webhook port
- Test with ngrok for local development: `ngrok http 3001`

#### 4. Repository Access Denied
```bash
# Test repository access
curl -H \"Authorization: token $GITHUB_TOKEN\" \
  https://api.github.com/repos/OWNER/REPO

# Check organization membership
curl -H \"Authorization: token $GITHUB_TOKEN\" \
  https://api.github.com/orgs/ORG/members/USERNAME
```

**Solutions:**
- Verify repository exists and is accessible
- Check organization membership and permissions
- For private repos: Ensure token has `repo` scope
- For organization repos: Ensure token has `read:org` scope

#### 5. GitHub App Configuration Issues
```bash
# Verify GitHub App credentials
openssl rsa -in /path/to/private-key.pem -check

# Test GitHub App authentication
node -e \"
const jwt = require('jsonwebtoken');
const fs = require('fs');
const key = fs.readFileSync('./github-app-key.pem');
const payload = { iss: process.env.GITHUB_APP_ID, iat: Math.floor(Date.now() / 1000) };
const token = jwt.sign(payload, key, { algorithm: 'RS256' });
console.log('JWT:', token);
\"
```

**Solutions:**
- Verify GitHub App ID matches installed app
- Check private key format (PEM, not OpenSSH)
- Ensure GitHub App has required permissions
- Verify installation on target repositories

### Common System Issues

#### 1. Container Won't Start
```bash
# Check detailed logs
docker logs runnerhub-app --tail 100

# Check container status
docker ps -a | grep runnerhub

# Common fixes:
- Verify .env file exists and has correct permissions
- Check port availability: sudo lsof -i :3001
- Ensure Docker daemon is running
- Verify Docker network exists: docker network ls
```

#### 2. Database Connection Failed
```bash
# Test PostgreSQL connection
docker exec runnerhub-postgres pg_isready -U $DB_USER

# Test database connectivity from app container
docker exec runnerhub-app psql \"$DATABASE_URL\" -c \"SELECT version();\"

# Check database logs
docker logs runnerhub-postgres --tail 50
```

**Solutions:**
- Verify database container is running
- Check DATABASE_URL format: `postgresql://user:pass@host:port/db`
- Ensure database initialization completed successfully
- Check network connectivity between containers

#### 3. Redis Connection Issues
```bash
# Test Redis connectivity
docker exec runnerhub-redis redis-cli ping
# Should return: PONG

# Test Redis from application container  
docker exec runnerhub-app redis-cli -h runnerhub-redis -a \"$REDIS_PASSWORD\" ping

# Check Redis configuration
docker exec runnerhub-redis redis-cli config get \"*\"
```

**Solutions:**
- Verify Redis container is running and healthy
- Check REDIS_URL format: `redis://:password@host:port/db`
- Ensure Redis password matches configuration
- Clear Redis cache if corrupted: `docker exec runnerhub-redis redis-cli FLUSHALL`

#### 4. Dashboard Not Loading
```bash
# Check application status
curl -f http://localhost:3001/health

# Check static file serving
curl -I http://localhost:3001/css/styles.css

# Check WebSocket connection
curl -I http://localhost:3001/socket.io/
```

**Solutions:**
- Check browser console for JavaScript errors
- Verify WebSocket connection (check for proxy issues)
- Ensure all static files are served correctly
- Check Content Security Policy (CSP) settings
- Clear browser cache and cookies

#### 5. High Memory/CPU Usage
```bash
# Monitor container resources
docker stats runnerhub-app

# Check application metrics
curl http://localhost:3001/api/metrics | grep memory

# Analyze memory leaks
docker exec runnerhub-app node --trace-warnings app.js
```

**Solutions:**
- Increase container memory limits in docker-compose.yml
- Optimize GitHub API request patterns
- Adjust cache TTL settings to reduce memory usage
- Enable garbage collection tuning: `--max-old-space-size=2048`
- Monitor for memory leaks in long-running processes

### Debug Mode

Run interactively to see errors:
```bash
docker run --rm -it \
  --network runnerhub-network \
  --env-file .env \
  -p 3001:3001 \
  runnerhub:latest
```

## Maintenance

### Daily Tasks
- Monitor dashboard for runner health
- Check job queue status
- Review error logs

### Weekly Tasks
- Update container images
- Check disk usage
- Review security logs

### Backup Procedures

1. Database backup:
```bash
docker exec runnerhub-postgres \
  pg_dump -U runnerhub github_runnerhub > backup-$(date +%Y%m%d).sql
```

2. Configuration backup:
```bash
tar -czf config-backup-$(date +%Y%m%d).tar.gz .env docker-compose.yml
```

### Updates

1. Pull latest changes:
```bash
git pull origin main
```

2. Rebuild and restart:
```bash
docker-compose down
docker-compose build
docker-compose up -d
```

### Monitoring

- Use `/health` endpoint for uptime monitoring
- Set up alerts for container restarts
- Monitor resource usage with `docker stats`

## Security Considerations

### 1. GitHub API Security

#### Token Management
```bash
# Generate secure token with minimal required scopes
# Personal Access Token scopes:
- repo (if accessing private repositories)
- workflow (required for GitHub Actions)  
- admin:org (if managing organization runners)
- read:user (for user identification)

# GitHub App permissions (recommended for production):
- actions: read
- contents: read  
- metadata: read
- workflows: write
- repository_hooks: write (for webhooks)
```

#### Token Security Best Practices
```bash
# 1. Store tokens securely in HashiCorp Vault
vault kv put secret/github/token value="ghp_xxxxxxxxxxxx"

# 2. Use environment variable injection (never hardcode)
export GITHUB_TOKEN=$(vault kv get -field=value secret/github/token)

# 3. Regular token rotation (every 90 days)
# Script to rotate GitHub token:
#!/bin/bash
NEW_TOKEN=$(generate_new_github_token.sh)
vault kv put secret/github/token value="$NEW_TOKEN"
docker-compose restart runnerhub-app

# 4. Monitor token usage and rate limits
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/rate_limit | jq '.rate'
```

#### Webhook Security
```bash
# 1. Generate strong webhook secret
WEBHOOK_SECRET=$(openssl rand -hex 32)
vault kv put secret/github/webhook-secret value="$WEBHOOK_SECRET"

# 2. Validate webhook payloads (automatically handled by app)
# 3. Use HTTPS for webhook URLs in production
# 4. Restrict webhook source IPs (GitHub's IP ranges)

# GitHub webhook IP ranges (update periodically)
# https://api.github.com/meta
curl -s https://api.github.com/meta | jq -r '.hooks[]'
```

#### Repository Access Control
```bash
# 1. Use principle of least privilege
# - Only grant access to required repositories
# - Use GitHub App for fine-grained permissions
# - Regularly audit repository access

# 2. Monitor access patterns
# - Log all GitHub API requests
# - Alert on unusual access patterns  
# - Track repository addition/removal

# 3. Repository isolation
# - Separate tokens for different repository groups
# - Use organization-level permissions when possible
# - Implement approval workflows for new repositories
```

### 2. Network Security

#### Firewall Configuration
```bash
# Allow only required ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (redirect to HTTPS)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 3001/tcp  # Application (restrict to specific IPs)

# Block direct database/Redis access
sudo ufw deny 5432/tcp   # PostgreSQL
sudo ufw deny 6379/tcp   # Redis

# Allow GitHub webhook IPs only
for ip in $(curl -s https://api.github.com/meta | jq -r '.hooks[]'); do
  sudo ufw allow from $ip to any port 3001
done
```

#### SSL/TLS Configuration
```nginx
# Nginx configuration for production
server {
    listen 443 ssl http2;
    server_name runnerhub.your-domain.com;
    
    # Strong SSL configuration
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header X-XSS-Protection "1; mode=block";
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'";
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 3. Secret Management

#### HashiCorp Vault Integration
```bash
# 1. Store all secrets in Vault
vault kv put secret/github/api \
  token="ghp_xxxxxxxxxxxx" \
  webhook_secret="webhook_secret_32_chars" \
  app_id="123456" \
  app_private_key="@/path/to/private-key.pem"

vault kv put secret/database \
  url="postgresql://user:password@host:5432/database \
  password="secure_db_password"

vault kv put secret/redis \
  url="redis://:password@host:6379/0" \
  password="secure_redis_password"

# 2. Use Vault agent for automatic secret rotation
# /etc/vault-agent.conf
vault {
  address = "https://vault.your-domain.com:8200"
}

auto_auth {
  method "aws" {
    mount_path = "auth/aws"
    config = {
      type = "iam"
      role = "github-runnerhub"
    }
  }
}

template {
  source = "/etc/vault-templates/github.env.tpl"
  destination = "/opt/github-runnerhub/.env"
  command = "docker-compose restart runnerhub-app"
}
```

#### Secret Rotation Schedule
```bash
# Automated secret rotation cron jobs
# /etc/cron.d/runnerhub-security

# Rotate GitHub token every 90 days
0 2 1 */3 * /opt/scripts/rotate-github-token.sh

# Rotate database password every 180 days  
0 2 1 */6 * /opt/scripts/rotate-database-password.sh

# Rotate Redis password every 30 days
0 2 1 * * /opt/scripts/rotate-redis-password.sh

# Rotate JWT secrets every 30 days
0 2 15 * * /opt/scripts/rotate-jwt-secrets.sh
```

### 4. Container Security

#### Dockerfile Security Best Practices
```dockerfile
# Use specific version tags (not 'latest')
FROM node:18.19.0-alpine3.19

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Set working directory
WORKDIR /app

# Copy package files first (layer caching)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY --chown=nextjs:nodejs . .

# Remove development dependencies and unnecessary files
RUN rm -rf .git .gitignore README.md docs/ tests/

# Use non-root user
USER nextjs

# Expose port
EXPOSE 3001

# Use exec form for CMD
CMD ["node", "dist/index.js"]
```

#### Runtime Security Configuration
```yaml
# docker-compose.yml security settings
version: '3.8'
services:
  runnerhub-app:
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:noexec,nosuid,size=100m
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    user: "1001:1001"
    environment:
      - NODE_ENV=production
    secrets:
      - github_token
      - db_password
      - redis_password

secrets:
  github_token:
    external: true
  db_password:
    external: true  
  redis_password:
    external: true
```

### 5. Monitoring and Alerting

#### Security Event Monitoring
```bash
# Monitor for security events
# 1. Failed authentication attempts
grep "authentication failed" /var/log/runnerhub/app.log

# 2. Rate limit violations
grep "rate limit exceeded" /var/log/runnerhub/app.log

# 3. Unusual API usage patterns
grep "GitHub API" /var/log/runnerhub/app.log | \
  awk '{print $1, $2, $3}' | sort | uniq -c | sort -nr

# 4. Database connection anomalies
grep "database" /var/log/runnerhub/error.log
```

#### Automated Security Alerts
```bash
# Slack webhook for security alerts
#!/bin/bash
send_security_alert() {
  local message="$1"
  local severity="$2"
  
  curl -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"🚨 GitHub RunnerHub Security Alert [$severity]: $message\"}" \
    "$SLACK_WEBHOOK_URL"
}

# Example usage in monitoring script
if [[ $(grep -c "rate limit exceeded" /var/log/app.log) -gt 10 ]]; then
  send_security_alert "High rate limit violations detected" "HIGH"
fi
```

### 6. Compliance and Auditing

#### Audit Logging
```bash
# Enable comprehensive audit logging
export LOG_LEVEL=audit
export AUDIT_LOG_FILE=/var/log/runnerhub/audit.log

# Audit log format includes:
# - Timestamp
# - User/Token identification  
# - Action performed
# - Resource accessed
# - Result (success/failure)
# - IP address/source
```

#### Regular Security Reviews
```bash
# Monthly security checklist
#!/bin/bash

echo "=== GitHub RunnerHub Security Review ==="
echo "Date: $(date)"

# 1. Check for outdated tokens
echo "Checking GitHub token age..."
TOKEN_CREATED=$(vault kv get -field=created_at secret/github/token)

# 2. Review access logs
echo "Reviewing access patterns..."
tail -1000 /var/log/runnerhub/access.log | \
  awk '{print $1}' | sort | uniq -c | sort -nr | head -20

# 3. Check for security updates
echo "Checking for security updates..."
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.CreatedAt}}"

# 4. Validate SSL certificates
echo "Checking SSL certificate expiry..."
echo | openssl s_client -connect your-domain.com:443 2>/dev/null | \
  openssl x509 -noout -dates

# 5. Review firewall rules
echo "Current firewall status..."
sudo ufw status numbered
```

## Support

- **Issues**: [GitHub Issues](https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub/issues)
- **Documentation**: [/docs](./docs)
- **Community**: GitHub Discussions

---

For detailed architecture information, see [ARCHITECTURE.md](./ARCHITECTURE.md)