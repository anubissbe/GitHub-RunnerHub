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

- 🔒 **Complete Job Isolation**: Every job runs in a pristine container
- 🚀 **Auto-scaling**: Dynamic runner provisioning based on demand
- 📊 **Real-time Monitoring**: WebSocket-based live status updates
- 🔐 **Vault Integration**: Secure secret management
- 🌐 **Network Isolation**: Per-repository network segmentation
- 🛡️ **Container Security Scanning**: Automatic vulnerability scanning with Trivy
- 📝 **Comprehensive Audit Logging**: Full audit trail for all operations
- 📈 **Prometheus Metrics**: Built-in observability
- 🎯 **Label-based Routing**: Smart job distribution

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+
- PostgreSQL 16 (with pgvector extension)
- Redis 7+
- GitHub Personal Access Token

### Installation

1. Clone the repository:
```bash
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment configuration:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start services:
```bash
docker-compose up -d
```

5. Build and start the orchestrator:
```bash
npm run build
npm start
```

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

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## Support the Project

If you find this project helpful, consider buying me a coffee!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/anubissbe)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Documentation

### Feature Documentation
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