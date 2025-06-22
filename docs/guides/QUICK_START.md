# GitHub-RunnerHub Quick Start Guide

## 🚀 Get Started in 5 Minutes

This guide will get you up and running with GitHub-RunnerHub in just 5 minutes using our automated installation script.

## 📋 Prerequisites

Before you begin, ensure you have:

- **Linux/macOS/WSL2** - Docker Desktop on Windows
- **Docker & Docker Compose** - Version 20.10+
- **Git** - For cloning the repository
- **GitHub Personal Access Token** - With required permissions
- **4GB RAM minimum** - 8GB recommended
- **10GB free disk space** - For containers and data

## 🔑 Step 1: GitHub Token Setup

1. **Create a Personal Access Token**:
   - Go to GitHub → Settings → Developer settings → Personal access tokens
   - Click "Generate new token (classic)"
   - Select these scopes:
     - ✅ `repo` - Repository access
     - ✅ `admin:org` - Organization runners  
     - ✅ `workflow` - Workflow data

2. **Copy your token** - You'll need it in Step 3

## 📥 Step 2: Download and Install

```bash
# Clone the repository
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub

# Run the one-click installation
./install-comprehensive.sh --mode development
```

The installer will:
- ✅ Install all dependencies
- ✅ Set up Docker containers
- ✅ Configure the database
- ✅ Start all services
- ✅ Verify the installation

## ⚙️ Step 3: Initial Configuration

When prompted by the installer, provide:

```bash
# GitHub configuration
GITHUB_TOKEN=ghp_your_token_here
GITHUB_ORG=your-organization-name

# Optional: Webhook secret for security
GITHUB_WEBHOOK_SECRET=your-random-secret
```

## 🎛️ Step 4: Access the Dashboard

Once installation completes:

1. **Open your browser** to: http://localhost:3001/dashboard
2. **Login** with default credentials:
   - Username: `admin`
   - Password: `admin` (change this immediately!)

## 🏃‍♂️ Step 5: Set Up Your First Runner

### Automatic Runner Setup
```bash
# Run the simple runner setup script
./simple-runner-setup.sh

# This will:
# - Download GitHub Actions runner
# - Configure it to connect to your org
# - Register it with RunnerHub
# - Start the runner service
```

### Manual Runner Setup (Alternative)
```bash
# Create runner directory
mkdir -p ~/actions-runner && cd ~/actions-runner

# Download runner (replace with latest version)
curl -o actions-runner-linux-x64-2.311.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz

# Extract
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz

# Configure runner
./config.sh --url https://github.com/YOUR_ORG \
             --token YOUR_RUNNER_TOKEN \
             --name "runnerhub-1" \
             --labels "self-hosted,linux,x64,runnerhub" \
             --runnergroup default \
             --work _work

# Install as service
sudo ./svc.sh install
sudo ./svc.sh start
```

## ✅ Step 6: Verify Everything Works

### Check Dashboard
1. Go to http://localhost:3001/dashboard
2. You should see:
   - ✅ Your runner listed and "Online"
   - ✅ System status showing "Healthy"
   - ✅ GitHub integration connected

### Test with a Simple Workflow
Create a test workflow in your repository (`.github/workflows/test.yml`):

```yaml
name: Test RunnerHub
on: [push]

jobs:
  test:
    runs-on: [self-hosted, runnerhub]
    steps:
      - name: Test runner
        run: |
          echo "Hello from RunnerHub!"
          echo "Runner: $(hostname)"
          echo "Date: $(date)"
```

Push this workflow and watch it execute in the dashboard!

## 🔧 Basic Configuration

### Environment Variables
The installer creates `/opt/projects/projects/GitHub-RunnerHub/.env`:

```bash
# GitHub Integration
GITHUB_TOKEN=your_token
GITHUB_ORG=your_org
GITHUB_WEBHOOK_SECRET=your_secret

# Database
DATABASE_URL=postgresql://runnerhub:password@localhost:5432/runnerhub

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# API
JWT_SECRET=auto-generated-secret
API_PORT=3001

# Logging
LOG_LEVEL=info
```

### Basic Security Setup
```bash
# Change default admin password
curl -X PUT http://localhost:3001/api/users/admin \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password": "your_secure_password"}'

# Create operator user
curl -X POST http://localhost:3001/api/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "operator",
    "password": "secure_password",
    "role": "operator"
  }'
```

## 📊 Next Steps

### Explore the Dashboard
- **Jobs Tab**: Monitor job execution in real-time
- **Runners Tab**: Manage your runner fleet
- **Analytics Tab**: View performance metrics
- **Security Tab**: Review security scans and logs

### Add More Runners
```bash
# Add additional runners
./simple-runner-setup.sh --name runner-2 --labels "linux,docker"
./simple-runner-setup.sh --name runner-3 --labels "linux,gpu" 
```

### Configure Auto-Scaling
```bash
# Enable auto-scaling
curl -X PUT http://localhost:3001/api/scaling/config \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "mode": "balanced",
    "minRunners": 1,
    "maxRunners": 10
  }'
```

### Set Up Monitoring
```bash
# Access Prometheus metrics
curl http://localhost:3001/api/metrics

# Set up alerts (example)
curl -X POST http://localhost:3001/api/monitoring/alerts \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "High Job Failure Rate",
    "condition": "job_failure_rate > 0.1",
    "channels": ["email", "slack"]
  }'
```

## 🔍 Troubleshooting

### Common Issues

**Installation fails:**
```bash
# Check Docker is running
docker ps

# Check ports are available
netstat -tlnp | grep -E ':3001|:5432|:6379'

# Re-run with debug output
LOG_LEVEL=debug ./install-comprehensive.sh --mode development
```

**Runner not appearing:**
```bash
# Check runner service
sudo systemctl status github-runner-runnerhub-*

# Check runner logs
sudo journalctl -u github-runner-runnerhub-1 -f

# Verify GitHub connection
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/orgs/YOUR_ORG/actions/runners
```

**Dashboard not loading:**
```bash
# Check API service
curl http://localhost:3001/health

# Check logs
docker-compose logs -f api

# Restart services
docker-compose restart
```

### Get Help
- **Logs**: `docker-compose logs -f`
- **Health Check**: http://localhost:3001/health
- **Documentation**: http://localhost:3001/docs
- **GitHub Issues**: Report issues on the repository

## 🎉 Success!

You now have a fully functional GitHub-RunnerHub installation! Your setup includes:

- ✅ **Web Dashboard** - Monitor and manage everything
- ✅ **Auto-Scaling** - Intelligent runner scaling
- ✅ **Security Scanning** - Container vulnerability detection
- ✅ **Real-time Monitoring** - Live metrics and alerts
- ✅ **Job Orchestration** - Efficient job routing and execution

### What's Next?

1. **Production Deployment**: See [Deployment Guide](DEPLOYMENT_GUIDE.md)
2. **Advanced Configuration**: See [User Manual](USER_MANUAL.md)
3. **Security Hardening**: See [Security Guide](SECURITY_GUIDE.md)
4. **Performance Tuning**: See [Performance Guide](../performance/OPTIMIZATION.md)

**Need help?** Check out our [Troubleshooting Guide](../troubleshooting/README.md) or [FAQ](../FAQ.md).

---

**🎯 Quick Summary**: In just 5 minutes, you've installed GitHub-RunnerHub, connected it to GitHub, set up a runner, and verified everything works. You're now ready to scale your GitHub Actions workflows efficiently and securely!