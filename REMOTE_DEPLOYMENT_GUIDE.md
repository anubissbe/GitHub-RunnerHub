# GitHub RunnerHub - Remote Deployment Guide

## Overview

This guide helps you deploy GitHub RunnerHub on a remote server (YOUR_DOCKER_HOST or any other server).

## Prerequisites

### On Your Local Machine
- SSH access to the remote server
- Git installed
- The GitHub RunnerHub repository cloned

### On the Remote Server (YOUR_DOCKER_HOST)
- Ubuntu 20.04+ or similar Linux distribution
- Root or sudo access
- At least 4GB RAM
- 20GB free disk space
- Ports 80, 3000, 3001 available

## Quick Deployment Steps

### 1. Prepare Configuration Locally

```bash
cd /opt/projects/projects/GitHub-RunnerHub
./remote-quick-start.sh
```

This will:
- Ask for your GitHub token and organization
- Generate secure passwords
- Create a production-ready .env file

### 2. Copy Files to Remote Server

```bash
# Create directory on remote server
ssh root@YOUR_DOCKER_HOST "mkdir -p /opt/github-runnerhub"

# Copy files (excluding unnecessary ones)
rsync -av \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='logs' \
  --exclude='coverage' \
  ./ root@YOUR_DOCKER_HOST:/opt/github-runnerhub/
```

### 3. Setup Remote Server

SSH to the server and run the setup:

```bash
ssh root@YOUR_DOCKER_HOST
cd /opt/github-runnerhub

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# Install Docker Compose if not present
if ! command -v docker-compose &> /dev/null; then
    curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

# Start services
docker-compose -f docker-compose.remote.yml up -d
```

### 4. Verify Deployment

```bash
# Check if services are running
docker-compose -f docker-compose.remote.yml ps

# Test health endpoint
curl http://localhost:3001/health

# View logs
docker-compose -f docker-compose.remote.yml logs -f
```

## Alternative: Automated Deployment

Use the provided deployment script:

```bash
cd /opt/projects/projects/GitHub-RunnerHub
./deploy-to-remote.sh
```

This script automates the entire process.

## Troubleshooting

### Common Issues and Solutions

#### 1. Docker Not Found
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
```

#### 2. Port Already in Use
```bash
# Find what's using the port
sudo lsof -i :3001
# Kill the process or change the port in .env
```

#### 3. Database Connection Failed
```bash
# Check if postgres is running
docker-compose -f docker-compose.remote.yml ps postgres
# Check logs
docker-compose -f docker-compose.remote.yml logs postgres
```

#### 4. Permission Denied for Docker Socket
```bash
# Add user to docker group
sudo usermod -aG docker $USER
# Logout and login again
```

#### 5. Out of Memory
```bash
# Check memory usage
free -h
# Increase swap if needed
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## Configuration Options

### Environment Variables

Key variables in `.env`:

```bash
# Change these for your setup
GITHUB_TOKEN=your_github_token
GITHUB_ORG=your_organization
EXTERNAL_HOST=YOUR_DOCKER_HOST

# Database settings (auto-generated passwords)
DB_PASSWORD=secure_password
REDIS_PASSWORD=secure_password

# Security (auto-generated)
JWT_SECRET=random_secret
ENCRYPTION_KEY=random_key

# Features
ENABLE_AUTO_SCALING=true
SECURITY_SCAN_IMAGES=false  # Enable if you want Trivy scanning
PROMETHEUS_ENABLED=false    # Enable for monitoring
```

### Resource Limits

Edit `docker-compose.remote.yml` to adjust resources:

```yaml
services:
  runnerhub:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

## Security Considerations

1. **Firewall Rules**
   ```bash
   # Allow only necessary ports
   ufw allow 22/tcp   # SSH
   ufw allow 80/tcp   # HTTP
   ufw allow 3001/tcp # API (if needed externally)
   ufw enable
   ```

2. **SSL/TLS Setup**
   - Use a reverse proxy like nginx with Let's Encrypt
   - Or use Cloudflare for SSL termination

3. **GitHub Token Security**
   - Use a token with minimal required permissions
   - Rotate tokens regularly
   - Never commit tokens to git

## Monitoring

### View Logs
```bash
# All services
docker-compose -f docker-compose.remote.yml logs -f

# Specific service
docker-compose -f docker-compose.remote.yml logs -f runnerhub
```

### Check Resource Usage
```bash
# Docker stats
docker stats

# System resources
htop
```

### Health Checks
```bash
# API health
curl http://YOUR_DOCKER_HOST:3001/health

# Database health
docker-compose -f docker-compose.remote.yml exec postgres pg_isready

# Redis health
docker-compose -f docker-compose.remote.yml exec redis redis-cli ping
```

## Backup and Recovery

### Backup Database
```bash
# Create backup
docker-compose -f docker-compose.remote.yml exec postgres \
  pg_dump -U runnerhub github_runnerhub > backup.sql

# Restore backup
docker-compose -f docker-compose.remote.yml exec -T postgres \
  psql -U runnerhub github_runnerhub < backup.sql
```

### Backup Configuration
```bash
# Backup important files
tar -czf runnerhub-backup-$(date +%Y%m%d).tar.gz \
  .env \
  docker-compose.remote.yml \
  nginx.conf
```

## Updates

To update RunnerHub:

```bash
# On local machine
cd /opt/projects/projects/GitHub-RunnerHub
git pull

# Copy updated files to server
rsync -av \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  ./ root@YOUR_DOCKER_HOST:/opt/github-runnerhub/

# On remote server
ssh root@YOUR_DOCKER_HOST
cd /opt/github-runnerhub
docker-compose -f docker-compose.remote.yml down
docker-compose -f docker-compose.remote.yml up -d
```

## Support

If you encounter issues:

1. Check the logs: `docker-compose -f docker-compose.remote.yml logs`
2. Verify all services are healthy: `docker-compose -f docker-compose.remote.yml ps`
3. Ensure ports are not blocked: `netstat -tlnp`
4. Check system resources: `free -h` and `df -h`

For additional help, refer to the main documentation or create an issue on GitHub.