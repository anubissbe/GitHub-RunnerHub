# GitHub-RunnerHub

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-required-blue)](https://www.docker.com/)
[![GitHub release](https://img.shields.io/github/release/YOUR_GITHUB_ORG/GitHub-RunnerHub.svg)](https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub/releases/)
[![CI/CD](https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub/actions)

> **Enterprise-grade GitHub Actions proxy runner system providing real-time monitoring, intelligent orchestration, and secure execution environments through ephemeral Docker containers.**

## 🌟 Overview

GitHub-RunnerHub is a comprehensive GitHub Actions management platform that integrates directly with GitHub's API to provide real-time monitoring, intelligent runner orchestration, and enterprise-grade security features.

### ✨ Key Features

- **🔗 Real GitHub Integration** - Live monitoring of actual GitHub Actions jobs and runners
- **🧠 Smart Rate Limiting** - Intelligent API usage staying well under GitHub's 5,000/hour limit  
- **📊 Real-time Dashboard** - Live metrics from your actual GitHub organization
- **🚀 Container Orchestration** - Advanced container lifecycle management with 5x concurrency improvement
- **🔒 Perfect Isolation** - Each job runs in a fresh, single-use container with network isolation
- **📈 Intelligent Scaling** - Dynamic container pool management with automatic resource optimization
- **🛡️ Enhanced Security** - Secret scanning, vulnerability detection, audit logging
- **⚡ Auto-scaling** - Dynamic runner provisioning based on demand
- **🏗️ High Availability** - Multi-node deployment with automatic failover
- **📦 One-Click Installation** - Automated deployment with health verification

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   GitHub API    │◄──►│  RunnerHub Core  │◄──►│   PostgreSQL    │
│                 │    │                  │    │   + Redis       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ GitHub Actions  │    │  Proxy Runners   │    │  Monitoring &   │
│   Workflows     │───►│   + Webhooks     │───►│   Alerting      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Ephemeral       │
                       │  Containers      │
                       └──────────────────┘
```

### Core Components

1. **🔌 GitHub API Integration** - Real-time sync with intelligent rate limiting
2. **📈 Real-time Dashboard** - Live monitoring with WebSocket updates  
3. **🤖 Smart Sync Engine** - Efficient data synchronization
4. **🔄 Proxy Runners** - Self-hosted runners with job delegation
5. **🎛️ Container Orchestration** - Advanced container lifecycle management and auto-scaling
6. **🐳 Ephemeral Containers** - Secure, isolated execution environments with health monitoring
7. **📊 Resource Management** - Dynamic container pool with intelligent cleanup procedures
8. **💾 PostgreSQL Database** - Stores GitHub data and metrics
9. **⚡ Redis Queue** - Job queue and caching layer

## 🚀 Quick Start

### One-Click Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub.git
cd GitHub-RunnerHub

# Run the comprehensive installation script
./install-comprehensive.sh

# For production with High Availability
./install-comprehensive.sh --mode production --enable-ha

# For development environment
./install-comprehensive.sh --mode development
```

### Environment Setup

1. **Create GitHub Personal Access Token** with these scopes:
   - `repo` - Repository access
   - `admin:org` - Organization runners
   - `workflow` - Workflow data

2. **Set environment variables:**
```bash
export GITHUB_TOKEN="your_github_token"
export GITHUB_ORG="your_organization"
```

3. **Access the dashboard:**
   - Dashboard: http://localhost:3001/dashboard
   - API: http://localhost:3001/api
   - Monitoring: http://localhost:9090 (Prometheus)

## 📋 Features Overview

### 🔗 GitHub Integration
- **Real-time API Sync** - Live monitoring with smart rate limiting
- **Webhook Processing** - Real-time event handling for all GitHub events
- **Intelligent Caching** - 80% reduction in API calls with Redis caching
- **Rate Limit Management** - Adaptive strategies staying under GitHub limits

### 🛡️ Security Features
- **Secret Scanning** - Automatic detection and redaction in job logs
- **Container Security** - Vulnerability scanning with Trivy integration
- **RBAC** - Role-based access control with JWT authentication
- **Audit Logging** - Comprehensive audit trail for all operations
- **Network Isolation** - Per-repository network segmentation

### 🏗️ High Availability
- **Multi-node Deployment** - Distributed architecture with leader election
- **Database Replication** - PostgreSQL primary/replica setup
- **Redis Sentinel** - Automatic failover for queue management
- **Load Balancing** - HAProxy with health checks
- **Backup & Recovery** - Automated backup with disaster recovery

### 📊 Monitoring & Observability
- **Real-time Metrics** - Prometheus integration with custom metrics
- **Grafana Dashboards** - Pre-configured monitoring dashboards
- **WebSocket Updates** - Live dashboard updates
- **Health Checks** - Comprehensive system health monitoring
- **Performance Analytics** - Job execution time and success rate tracking

## 🛠️ Installation Options

### Quick Development Setup
```bash
./quick-start.sh
```

### Production Deployment
```bash
# Full production setup with HA
./install-comprehensive.sh --mode production --enable-ha

# Verify installation
./verify-comprehensive-install.sh
```

### GitHub Runners Setup
```bash
# Setup self-hosted runners
./simple-runner-setup.sh

# Check runner status
sudo systemctl status github-runner-runnerhub-*
```

## 📁 Project Structure

```
├── src/                          # Source code
│   ├── controllers/              # API controllers
│   ├── services/                 # Business logic
│   ├── routes/                   # API routes
│   ├── middleware/               # Express middleware
│   ├── container-orchestration/  # Container management system
│   │   ├── docker/              # Docker API integration
│   │   ├── lifecycle/           # Container lifecycle management
│   │   ├── monitoring/          # Health monitoring & metrics
│   │   └── cleanup/             # Resource cleanup procedures
│   └── utils/                    # Utilities
├── backup/                       # Backup and disaster recovery
│   ├── scripts/                  # Backup automation scripts
│   ├── config/                   # Backup configurations
│   └── docs/                     # DR documentation
├── load-testing/                 # Performance testing
├── docs/                         # Documentation
│   ├── container-orchestration/  # Container orchestration docs
│   ├── features/                 # Feature documentation
│   ├── ARCHITECTURE.md           # System architecture
│   ├── DEPLOYMENT_GUIDE.md       # Deployment instructions
│   ├── GITHUB_API_INTEGRATION.md # API integration guide
│   └── SECRET_SCANNING.md        # Security features
├── migrations/                   # Database migrations
├── scripts/                      # Utility scripts
├── public/                       # Dashboard UI
└── docker-compose*.yml          # Container orchestration
```

## 🔧 Configuration

### Required Environment Variables

```bash
# GitHub Integration (Required)
GITHUB_TOKEN=ghp_xxx           # GitHub Personal Access Token
GITHUB_ORG=your-org            # GitHub Organization name

# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Security
JWT_SECRET=your-secret
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Vault (Optional)
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=your-vault-token
```

### GitHub Token Permissions
Your GitHub Personal Access Token requires:
- ✅ **repo** - Repository data and workflow runs
- ✅ **admin:org** - Organization runners and settings  
- ✅ **workflow** - Workflow data and job information

## 🧪 Testing

### Unit & Integration Tests
```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm test -- --coverage     # Coverage report
```

### E2E Testing
```bash
npm run test:e2e           # End-to-end tests
./scripts/test-enhanced-webhooks.sh  # Webhook testing
```

### Load Testing
```bash
cd load-testing
npm run load-test          # Performance testing
```

### System Verification
```bash
./verify-comprehensive-install.sh    # Complete system check
```

## 📊 API Documentation

### Authentication
All API endpoints require JWT authentication:
```http
Authorization: Bearer <jwt_token>
```

### Core Endpoints

#### Job Management
- `POST /api/jobs/delegate` - Delegate job execution
- `GET /api/jobs` - List jobs with filtering
- `GET /api/jobs/:id/logs` - Retrieve job logs
- `PUT /api/jobs/:id/status` - Update job status

#### Runner Management  
- `GET /api/runners` - List all runners
- `POST /api/runners` - Register new runner
- `GET /api/runners/:id/status` - Get runner status

#### GitHub Integration
- `GET /api/github/status` - GitHub API status
- `GET /api/github/repositories` - Tracked repositories
- `POST /api/github/sync` - Force sync with GitHub

#### Security
- `POST /api/security/scan` - Container security scan
- `GET /api/security/scans` - Scan results
- `POST /api/security/secret-scan` - Secret scanning

#### Monitoring
- `GET /health` - Health check
- `GET /api/metrics` - Prometheus metrics
- `GET /api/monitoring/dashboard` - Dashboard data

### WebSocket Events
Real-time updates available via WebSocket:
- Job status changes
- Runner state updates  
- GitHub webhook events
- System health notifications

## 🏭 Production Deployment

### High Availability Setup

1. **Multi-node Orchestrators**
```bash
# Deploy 3-node cluster
docker-compose -f docker-compose.ha.yml up -d
```

2. **Database Replication**
```bash
./scripts/setup-postgres-replication.sh --setup-users --init-replica
```

3. **Redis Sentinel**
```bash
./scripts/setup-redis-sentinel.sh --setup-master --setup-slave --setup-sentinels
```

### Security Best Practices

1. **Network Security**
   - Use private VPC/network
   - Enable TLS encryption
   - Implement firewall rules
   - Network segmentation

2. **Container Security**
   - Run with minimal privileges
   - Use signed images
   - Enable runtime monitoring
   - Regular vulnerability scans

3. **Access Control**
   - RBAC for API access
   - JWT token authentication
   - Audit logging enabled
   - Secret management via Vault

### Monitoring & Alerting

- **Prometheus** - Metrics collection (port 9090)
- **Grafana** - Visualization dashboards (port 3002)
- **Structured Logging** - JSON format with log levels
- **WebSocket Events** - Real-time notifications
- **Health Checks** - Automated health monitoring

## 🔍 Troubleshooting

### Common Issues

**Job delegation fails:**
```bash
# Check runner logs
sudo journalctl -u github-runner-runnerhub-1 -f

# Verify API connectivity
curl -H "Authorization: Bearer $JWT_TOKEN" http://localhost:3001/api/health
```

**GitHub API issues:**
```bash
# Check rate limits
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit

# Verify token permissions
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
```

**Database connectivity:**
```bash
# Test database connection
psql $DATABASE_URL -c "SELECT current_database();"

# Check service status
docker-compose ps
```

### Debug Mode
```bash
export LOG_LEVEL=debug
export ACTIONS_STEP_DEBUG=true
npm run dev
```

## 🗑️ Uninstallation

### Complete Removal
```bash
# Interactive uninstall with backup
./uninstall.sh

# Force removal without confirmation
./uninstall.sh --force --remove-data --remove-images
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
```bash
git clone https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub.git
cd GitHub-RunnerHub
npm install
npm run dev
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📚 Documentation

### Core Documentation
- [📐 Architecture](docs/ARCHITECTURE.md) - System design and components
- [🚀 Deployment Guide](docs/DEPLOYMENT_GUIDE.md) - Production deployment
- [🔌 GitHub API Integration](docs/GITHUB_API_INTEGRATION.md) - API setup and usage
- [🐳 Container Orchestration](docs/container-orchestration/README.md) - Advanced container management
- [🔐 Security Features](docs/SECRET_SCANNING.md) - Security implementation
- [💾 Backup & Recovery](backup/docs/BACKUP_AND_DISASTER_RECOVERY.md) - DR procedures

### Feature Documentation
- [🏗️ High Availability](docs/features/high-availability.md) - HA architecture
- [🛡️ Container Security](docs/features/container-security-scanning.md) - Security scanning
- [🌐 Network Isolation](docs/features/network-isolation.md) - Network security
- [📋 Audit Logging](docs/features/audit-logging.md) - Compliance features
- [🔐 Vault Integration](docs/VAULT_INTEGRATION.md) - Secret management

### Implementation Details
- [📊 Load Testing Results](LOAD_TESTING_SUMMARY.md) - Performance validation
- [⚡ Performance Optimization](PERFORMANCE_OPTIMIZATION_REPORT.md) - Optimization guide
- [🎯 Implementation Summary](docs/IMPLEMENTATION_SUMMARY.md) - Technical overview

## 🆘 Support

- **Documentation**: Comprehensive guides in `/docs` directory
- **Issues**: [GitHub Issues](https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub/issues)
- **Discussions**: [GitHub Discussions](https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub/discussions)

## ☕ Support the Project

If you find this project helpful, consider supporting it:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/YOUR_USERNAME)

---

**Made with ❤️ by [YOUR_GITHUB_ORG](https://github.com/YOUR_GITHUB_ORG)**