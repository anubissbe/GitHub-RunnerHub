# GitHub-RunnerHub

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-required-blue)](https://www.docker.com/)
[![GitHub release](https://img.shields.io/github/release/anubissbe/GitHub-RunnerHub.svg)](https://github.com/anubissbe/GitHub-RunnerHub/releases/)

An enterprise-grade GitHub Actions proxy runner system that provides highly controlled, secure, and scalable execution environments through ephemeral Docker containers.

## Overview

GitHub-RunnerHub implements a proxy runner architecture where lightweight, persistent runners intercept GitHub Actions jobs and delegate them to ephemeral containers. This ensures:

- **Perfect isolation** - Each job runs in a fresh, single-use container
- **Enhanced security** - No state persistence between job executions
- **Full control** - Complete customization of execution environments
- **Enterprise scalability** - Separate control and execution planes

## Architecture

```
GitHub Actions → Proxy Runners → Orchestration Service → Ephemeral Containers
```

### Components

1. **Proxy Runners**: Lightweight runners that receive jobs from GitHub and delegate execution
2. **Orchestration Service**: Central control plane managing job distribution and container lifecycle
3. **Ephemeral Containers**: Single-use execution environments that run actual jobs
4. **Job Queue**: Redis-backed queue for reliable job processing
5. **State Database**: PostgreSQL for job tracking and metrics

## Features

### Core Features
- 🔒 **Complete Job Isolation**: Every job runs in a pristine container
- 🚀 **Auto-scaling**: Dynamic runner provisioning based on demand
- 📊 **Real-time Monitoring**: WebSocket-based live status updates
- 🔐 **Vault Integration**: Secure secret management
- 🌐 **Network Isolation**: Per-repository network segmentation
- 🛡️ **Container Security Scanning**: Automatic vulnerability scanning with Trivy
- 📝 **Comprehensive Audit Logging**: Full audit trail for all operations
- 📈 **Prometheus Metrics**: Built-in observability
- 🎯 **Label-based Routing**: Smart job distribution

### High Availability Features ⚡
- 🏗️ **Enterprise HA Architecture**: Multi-node deployment with automatic failover
- 👑 **Leader Election**: Redis-based distributed leadership with automatic renewal
- 💾 **Database Replication**: PostgreSQL primary/replica with streaming replication
- 🔄 **Redis Sentinel**: Automatic Redis master failover with 3-node cluster
- ⚖️ **Load Balancing**: HAProxy with health checks and session affinity
- 🩺 **Health Monitoring**: Comprehensive component health checks with alerting
- 🔀 **Automated Failover**: Database and Redis failover with minimal downtime
- 📊 **HA Metrics**: Specialized metrics for cluster health and performance

## Quick Start

### 🚀 Remote Server Deployment (Production)

Deploy GitHub RunnerHub to a remote server:

```bash
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub

# 1. Generate secure configuration
./remote-quick-start.sh

# 2. Deploy to your server
./deploy-to-remote.sh

# Access your deployment:
# Dashboard: http://your-server:3001/dashboard
# API: http://your-server:3001/api
```

**Remote Deployment Features:**
- ✅ Automated deployment via SSH
- ✅ Docker-based containerization
- ✅ Secure credential generation
- ✅ Production-ready defaults
- ✅ Complete guide: [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)

**Documentation:**
- 📚 [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) - Detailed deployment instructions
- 🏗️ [Architecture](docs/ARCHITECTURE.md) - System architecture overview
- 📁 [Project Structure](docs/PROJECT_STRUCTURE.md) - Directory layout and organization
- 🔐 [Security Features](docs/features/) - Security and feature documentation

### 💻 Local Development

The fastest way to get started locally:

```bash
./quick-start.sh
```

This script automatically handles everything from prerequisites checking to service startup in just 5 minutes!

### Installation Verification 🔍

After installation, verify everything is working correctly:

```bash
./verify-installation.sh
```

This comprehensive verification script checks:
- ✅ All prerequisites and dependencies
- ✅ Configuration files and environment
- ✅ Docker services and health status
- ✅ Database connectivity and operations
- ✅ API endpoints and authentication
- ✅ Network connectivity and ports
- ✅ Monitoring services (Prometheus, Grafana)
- ✅ Integration tests and functionality

### Advanced Installation Options

#### Full Installation Script

For complete control over the installation process:

```bash
# Interactive installation with configuration prompts
./install.sh

# Non-interactive installation
./install.sh --quiet

# Installation with custom options
./install.sh --install-vault --no-monitoring --log-file custom.log
```

**Installation script features:**
- ✅ Prerequisites checking (Docker, Node.js, Git, system resources)
- ✅ Automatic environment configuration
- ✅ Secure password generation with OpenSSL
- ✅ Docker network and service setup
- ✅ Database migrations and health checks
- ✅ Vault secrets configuration (optional)
- ✅ Monitoring stack setup (Prometheus, Grafana)
- ✅ Initial testing and validation
- ✅ Comprehensive logging and error handling
- ✅ Command-line options for customization

#### High Availability Deployment 🏗️

For enterprise production environments with zero-downtime requirements:

```bash
# Full HA deployment with all components
docker-compose -f docker-compose.ha.yml up -d

# Setup PostgreSQL replication
./scripts/setup-postgres-replication.sh --setup-users --init-replica

# Setup Redis Sentinel cluster  
./scripts/setup-redis-sentinel.sh --setup-master --setup-slave --setup-sentinels

# Verify HA setup
./scripts/verify-ha-deployment.sh
```

**HA Deployment Features:**
- ✅ **3-Node Orchestrator Cluster** with leader election
- ✅ **PostgreSQL Primary/Replica** with streaming replication
- ✅ **Redis Sentinel Cluster** with automatic failover
- ✅ **HAProxy Load Balancer** with health checks
- ✅ **Automated Setup Scripts** for zero-touch deployment
- ✅ **Comprehensive Health Monitoring** with real-time alerts
- ✅ **Failover Testing** and validation procedures

#### Manual Installation

If you prefer manual setup:

1. **Clone the repository:**
```bash
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start services:**
```bash
docker-compose up -d
```

5. **Build and start:**
```bash
npm run build
npm start
```

### Prerequisites

The installation script automatically checks for:
- Docker 20.10+ and Docker Compose 2.0+
- Node.js 20+
- Git
- Available ports (3000, 3001, 3002, 5432, 6379, 9090)
- System resources (4GB RAM recommended, 10GB disk space)

**Required for setup:**
- GitHub Personal Access Token (repo, admin:org, workflow scopes)
- GitHub Organization name

## Configuration

### Environment Variables

Key configuration options:

- `GITHUB_TOKEN`: GitHub PAT with repo and admin:org permissions
- `GITHUB_ORG`: Your GitHub organization
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_HOST/PORT`: Redis connection details
- `VAULT_ADDR/TOKEN`: HashiCorp Vault configuration

See `.env.example` for full configuration options.

### Runner Labels

Proxy runners use labels to determine job routing:
- `self-hosted-proxy`: Base label for all proxy runners
- `self-hosted-proxy-ubuntu`: Ubuntu-specific runners
- Custom labels for specialized workloads

## Development

### Project Structure

```
src/
├── app.ts              # Express application setup
├── config/             # Configuration management
├── controllers/        # API controllers
├── middleware/         # Express middleware
├── routes/             # API routes
├── services/           # Business logic services
├── types/              # TypeScript type definitions
└── utils/              # Utility functions
```

### Available Scripts

- `npm run dev`: Start development server with hot reload
- `npm run build`: Build TypeScript to JavaScript
- `npm test`: Run test suite
- `npm run lint`: Check code style
- `npm run typecheck`: Validate TypeScript types

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm test -- --coverage
```

## API Documentation

### Authentication
All API endpoints require JWT authentication. Include the token in the Authorization header:
```
Authorization: Bearer <token>
```

### Job Management
- `POST /api/jobs/delegate` - Delegate a job from proxy runner
- `GET /api/jobs/:id` - Get job details
- `GET /api/jobs` - List jobs with pagination
- `GET /api/jobs/:id/logs` - Retrieve job logs
- `PUT /api/jobs/:id/status` - Update job status

### Runner Management
- `GET /api/runners` - List all runners
- `POST /api/runners` - Create new runner
- `DELETE /api/runners/:id` - Remove runner
- `GET /api/runners/:id/status` - Get runner status
- `PUT /api/runners/:id` - Update runner configuration

### Security Scanning
- `POST /api/security/scan` - Scan container image
- `GET /api/security/scans` - List scan results
- `GET /api/security/scans/:id` - Get specific scan result
- `GET /api/security/policies` - List security policies
- `POST /api/security/policies` - Create/update policy
- `POST /api/security/policies/:id/check` - Check policy compliance
- `GET /api/security/stats` - Get vulnerability statistics

### Audit Logging
- `GET /api/audit/logs` - Query audit logs
- `GET /api/audit/stats` - Get audit statistics
- `POST /api/audit/export` - Export audit logs
- `GET /api/audit/events` - List event types

### Network Management
- `GET /api/networks` - List isolated networks
- `POST /api/networks` - Create repository network
- `DELETE /api/networks/:id` - Remove network
- `GET /api/networks/stats` - Network statistics

### High Availability Management
- `GET /api/system/ha/status` - Get HA cluster status
- `GET /api/system/ha/health` - Comprehensive HA health check
- `GET /api/system/ha/database` - Database replication status
- `GET /api/system/ha/redis` - Redis Sentinel cluster status
- `GET /api/system/ha/cluster` - Cluster node information
- `POST /api/system/ha/election/force` - Force leader election (admin)

### Monitoring
- `GET /health` - Health check endpoint
- `GET /api/metrics` - Prometheus metrics
- WebSocket at `ws://localhost:3001` for real-time updates

## Production Deployment

### High Availability Setup

1. Deploy multiple proxy runners across availability zones
2. Use PostgreSQL with streaming replication
3. Configure Redis Sentinel for queue HA
4. Place load balancer in front of orchestration service

### Security Considerations

1. **Network Security**:
   - Use private VPC for all components
   - Enable TLS for all communications
   - Implement egress filtering

2. **Container Security**:
   - Run containers with minimal privileges
   - Use signed container images
   - Enable runtime security monitoring (Falco)

3. **Access Control**:
   - Implement RBAC for API access
   - Use JWT tokens for authentication
   - Enable audit logging

### Monitoring

The system provides comprehensive monitoring through:
- Prometheus metrics (port 9090)
- Grafana dashboards (port 3002)
- Structured JSON logging
- Real-time WebSocket events

## Troubleshooting

### Common Issues

1. **Job delegation fails**:
   - Check proxy runner logs for hook execution
   - Verify orchestrator is accessible
   - Ensure GitHub token has correct permissions

2. **Containers not starting**:
   - Verify Docker daemon is accessible
   - Check network configuration
   - Review container resource limits

3. **Database connection errors**:
   - Confirm PostgreSQL is running
   - Verify connection string
   - Check firewall rules

### Debug Mode

Enable debug logging:
```bash
export LOG_LEVEL=debug
export ACTIONS_STEP_DEBUG=true
```

## Uninstallation

### Complete Removal

To completely remove GitHub-RunnerHub and all associated resources:

```bash
# Interactive uninstall with backup
./uninstall.sh

# Force uninstall without confirmation
./uninstall.sh --force

# Remove all data including volumes
./uninstall.sh --remove-data --remove-images

# Quiet uninstall
./uninstall.sh --quiet --remove-data
```

**Uninstall script features:**
- 🗑️ Stops all services and removes containers
- 🧹 Cleans up Docker networks and volumes
- 💾 Creates backup before removal (optional)
- 🔧 Removes Docker images (optional)
- 📋 Preserves source code and configuration
- 🔒 Safe removal with confirmation prompts

### Manual Cleanup

If you need to manually remove components:

```bash
# Stop services
docker-compose down

# Remove volumes (WARNING: This removes all data!)
docker-compose down -v

# Remove images
docker rmi $(docker images "*runnerhub*" -q)

# Clean up
rm -rf node_modules dist logs data
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## Support the Project

If you find this project helpful, consider buying me a coffee!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/anubissbe)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Documentation

### Feature Documentation
- [High Availability Architecture](docs/features/high-availability.md) - **NEW**: Complete HA setup and operations
- [Container Security Scanning](docs/features/container-security-scanning.md)
- [Network Isolation](docs/features/network-isolation.md)
- [Audit Logging](docs/features/audit-logging.md)
- [Vault Integration](docs/VAULT_INTEGRATION.md)
- [Implementation Summary](docs/IMPLEMENTATION_SUMMARY.md)

### Development Documentation
- [Project State](PROJECT_STATE.md)
- [Session Notes](SESSION_NOTES.md)
- [Migration Guide](docs/MIGRATION_GUIDE.md)

## Support

- Documentation: `/docs` directory
- Issues: GitHub Issues
- Discussions: GitHub Discussions

## Roadmap

- [ ] Kubernetes operator for container orchestration
- [ ] Built-in secret scanning
- [ ] Advanced job routing algorithms
- [ ] Multi-cloud support
- [ ] GraphQL API
- [ ] Web-based management UI