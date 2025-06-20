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
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub
```

2. Generate configuration:
```bash
./remote-quick-start.sh
```

This creates a `.env` file with:
- GitHub credentials
- Generated secure passwords
- Database configuration
- Redis settings

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

```bash
docker exec -i runnerhub-postgres psql -U $DB_USER -d $DB_NAME < docker/postgres/init.sql
```

## Configuration

### Environment Variables

Key configuration in `.env`:

```bash
# GitHub Configuration
GITHUB_TOKEN=your_github_token
GITHUB_ORG=your_organization

# Application
NODE_ENV=production
PORT=3001
EXTERNAL_HOST=your.server.ip

# Database (auto-generated)
DB_USER=runnerhub
DB_PASSWORD=secure_password
DB_NAME=github_runnerhub

# Redis (auto-generated)
REDIS_PASSWORD=secure_password

# Security (auto-generated)
JWT_SECRET=random_secret
ENCRYPTION_KEY=random_key
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

### Common Issues

#### 1. Container Won't Start
```bash
# Check logs
docker logs runnerhub-app

# Common fixes:
- Verify .env file exists
- Check port availability: sudo lsof -i :3001
- Ensure Docker daemon is running
```

#### 2. Database Connection Failed
```bash
# Test connection
docker exec runnerhub-postgres pg_isready

# Check credentials
grep DB_ .env
```

#### 3. Redis Connection Issues
```bash
# Test Redis
docker exec runnerhub-redis redis-cli ping

# Should return: PONG
```

#### 4. Dashboard Not Loading
- Check browser console for errors
- Verify WebSocket connection
- Ensure all static files are served

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

1. **Network Security**
   - Use firewall rules to restrict access
   - Enable SSL/TLS for production
   - Use VPN for management access

2. **Secret Management**
   - Never commit `.env` to git
   - Rotate tokens regularly
   - Use HashiCorp Vault for production

3. **Container Security**
   - Keep base images updated
   - Run containers as non-root
   - Use read-only filesystems where possible

## Support

- **Issues**: [GitHub Issues](https://github.com/anubissbe/GitHub-RunnerHub/issues)
- **Documentation**: [/docs](./docs)
- **Community**: GitHub Discussions

---

For detailed architecture information, see [ARCHITECTURE.md](./ARCHITECTURE.md)