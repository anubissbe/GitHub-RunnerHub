# Quick Start Guide 🚀

Get GitHub-RunnerHub up and running in **5 minutes** with this comprehensive quick start guide.

## 🎯 Prerequisites

Before you begin, ensure you have:

- **Docker** and **Docker Compose** installed
- **Node.js 20+** for development
- **GitHub Personal Access Token** with required permissions
- **PostgreSQL** and **Redis** (or use Docker containers)

## ⚡ One-Command Installation

The fastest way to get started:

```bash
# Clone and install in one command
curl -fsSL https://raw.githubusercontent.com/anubissbe/GitHub-RunnerHub/main/quick-start.sh | bash
```

This script will:
- ✅ Clone the repository
- ✅ Set up environment variables
- ✅ Start all services with Docker Compose
- ✅ Verify the installation
- ✅ Display access URLs

## 🔧 Manual Installation

### Step 1: Clone Repository

```bash
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub
```

### Step 2: Environment Setup

Create your environment file:

```bash
# Copy example environment
cp .env.example .env

# Edit with your settings
nano .env
```

**Required Environment Variables:**

```bash
# GitHub Integration (Required)
GITHUB_TOKEN=ghp_your_github_token_here
GITHUB_ORG=your-organization

# Database
DATABASE_URL=postgresql://runnerhub:secure_password@localhost:5432/runnerhub

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Security (Required)
JWT_SECRET=your-very-strong-jwt-secret-here
GITHUB_WEBHOOK_SECRET=your-webhook-secret
ENCRYPTION_KEY=your-32-character-encryption-key

# Security Settings
SECURITY_LEVEL=high
ENABLE_SECURITY_SCANNING=true
ENABLE_AUDIT_LOGGING=true
```

### Step 3: GitHub Token Setup

1. **Create Personal Access Token**:
   - Go to GitHub Settings → Developer settings → Personal access tokens
   - Click "Generate new token (classic)"
   - Select required scopes:
     - ✅ `repo` - Repository access
     - ✅ `admin:org` - Organization runners
     - ✅ `workflow` - Workflow data
     - ✅ `actions` - Actions API
     - ✅ `checks` - Check runs

2. **Verify Token Permissions**:
```bash
# Test your token
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
```

### Step 4: Start Services

**Option A: Docker Compose (Recommended)**

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f
```

**Option B: Local Development**

```bash
# Install dependencies
npm install

# Run database migrations
npm run migrate

# Start in development mode
npm run dev
```

### Step 5: Verify Installation

```bash
# Run comprehensive verification
./verify-comprehensive-install.sh

# Or check manually
curl http://localhost:3001/health
```

## 🌐 Access Your Installation

Once started, you can access:

| Service | URL | Description |
|---------|-----|-------------|
| **Main Dashboard** | http://localhost:3001 | Primary web interface |
| **API Documentation** | http://localhost:3001/api/docs | Interactive API docs |
| **Health Check** | http://localhost:3001/health | System health status |
| **Monitoring Dashboard** | http://localhost:3001/dashboard | Real-time monitoring |
| **Queue Dashboard** | http://localhost:3001/dashboard/queues | Job queue monitoring |
| **Prometheus** | http://localhost:9090 | Metrics collection |
| **Grafana** | http://localhost:3002 | Visualization dashboards |

### Default Login Credentials

```
Username: admin
Password: admin123
```

**⚠️ Important**: Change default credentials immediately in production!

## 🔒 Security Setup

### Enable HTTPS (Production)

```bash
# Generate SSL certificates
./scripts/setup-ssl.sh

# Update docker-compose with SSL
docker-compose -f docker-compose.ssl.yml up -d
```

### Configure Firewall

```bash
# Allow only necessary ports
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw allow 3001  # RunnerHub API
sudo ufw enable
```

### Setup Vault (Optional but Recommended)

```bash
# Start HashiCorp Vault
docker run -d --name vault \
  -p 8200:8200 \
  --cap-add=IPC_LOCK \
  vault:latest

# Initialize and configure
./scripts/setup-vault-secrets.sh
```

## 🎯 First Actions

### 1. Register Your First Runner

```bash
# Create and register a self-hosted runner
./setup-github-runners.sh
```

### 2. Test Job Delegation

```bash
# Test API connectivity
curl -X POST http://localhost:3001/api/jobs/delegate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "repository": "your-org/your-repo",
    "job_id": "test-job-123",
    "job_name": "Test Job"
  }'
```

### 3. Monitor Your First Job

- Visit the **Dashboard**: http://localhost:3001/dashboard
- Check **Queue Status**: http://localhost:3001/dashboard/queues
- View **Real-time Logs**: http://localhost:3001/logs

## 📊 Quick Configuration

### Performance Optimization

```bash
# Enable AI-driven optimization
export ENABLE_AI_OPTIMIZATION=true
export CONTAINER_POOL_SIZE=10
export MAX_CONCURRENT_JOBS=50

# Restart services to apply
docker-compose restart
```

### Security Hardening

```bash
# Enable maximum security
export SECURITY_LEVEL=critical
export ENABLE_SECURITY_SCANNING=true
export ENABLE_AUDIT_LOGGING=true
export ENABLE_NETWORK_ISOLATION=true

# Apply security settings
docker-compose restart
```

### Monitoring Setup

```bash
# Enable comprehensive monitoring
export ENABLE_PROMETHEUS=true
export ENABLE_GRAFANA=true
export LOG_LEVEL=info

# Start monitoring stack
docker-compose -f docker-compose.monitoring.yml up -d
```

## 🚨 Troubleshooting Quick Fixes

### Common Issues

**1. Database Connection Failed**
```bash
# Check database status
docker-compose ps postgres
docker-compose logs postgres

# Restart database
docker-compose restart postgres
```

**2. Redis Connection Issues**
```bash
# Check Redis status
docker-compose ps redis
redis-cli ping

# Restart Redis
docker-compose restart redis
```

**3. GitHub API Rate Limits**
```bash
# Check rate limit status
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit

# Verify token permissions
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
```

**4. Permission Issues**
```bash
# Fix file permissions
sudo chown -R $(whoami):$(whoami) .
chmod +x scripts/*.sh

# Fix Docker permissions
sudo usermod -aG docker $(whoami)
newgrp docker
```

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=debug
export ACTIONS_STEP_DEBUG=true

# Restart with debug
docker-compose restart
docker-compose logs -f
```

## 🎉 What's Next?

Congratulations! You now have a fully functional GitHub-RunnerHub installation. Here's what to explore next:

### 🔄 Immediate Next Steps
1. **[Configure Authentication](Configuration-Guide#authentication)** - Set up user accounts and permissions
2. **[Setup Webhooks](GitHub-API-Integration#webhooks)** - Enable real-time GitHub integration
3. **[Configure Monitoring](Monitoring-Guide)** - Set up alerts and dashboards
4. **[Security Hardening](Security-Best-Practices)** - Apply production security settings

### 🚀 Advanced Features
1. **[High Availability Setup](High-Availability)** - Multi-node deployment
2. **[Performance Optimization](Performance-Optimization)** - AI-driven tuning
3. **[Auto-Scaling Configuration](Auto-Scaling)** - Intelligent scaling
4. **[Container Orchestration](Container-Orchestration)** - Advanced container management

### 📚 Learn More
- **[Complete Configuration Guide](Configuration-Guide)** - Detailed setup options
- **[API Documentation](API-Reference)** - Complete API reference
- **[Security Guide](Security-Implementation)** - Comprehensive security features
- **[Troubleshooting Guide](Troubleshooting)** - Common issues and solutions

## 💡 Tips for Success

### Performance Tips
- **Use SSD storage** for database and Redis
- **Allocate sufficient RAM** (minimum 4GB, recommended 8GB+)
- **Enable container reuse** for faster job execution
- **Configure proper resource limits** to prevent resource exhaustion

### Security Tips
- **Change default passwords** immediately
- **Use strong encryption keys** (32+ characters)
- **Enable HTTPS** for all communications
- **Regularly update** to latest versions
- **Monitor security logs** for suspicious activity

### Monitoring Tips
- **Set up alerts** for system health issues
- **Monitor resource usage** to prevent bottlenecks
- **Track API rate limits** to avoid GitHub API issues
- **Review audit logs** regularly for compliance

---

## 🆘 Need Help?

If you encounter any issues during setup:

1. **Check our [Troubleshooting Guide](Troubleshooting)**
2. **Review the [FAQ](FAQ)**
3. **Search [GitHub Issues](https://github.com/anubissbe/GitHub-RunnerHub/issues)**
4. **Join our [Discussions](https://github.com/anubissbe/GitHub-RunnerHub/discussions)**

---

**🎯 Next: [Configuration Guide](Configuration-Guide) →**

**🏠 Back to: [Wiki Home](Home)**