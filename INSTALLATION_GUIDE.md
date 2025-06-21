# GitHub RunnerHub - Installation Guide

This guide covers the comprehensive installation options for GitHub RunnerHub.

## 🚀 Quick Start

### One-Click Installation (Recommended)

The easiest way to install GitHub RunnerHub:

```bash
./one-click-install.sh
```

This will:
- Detect your environment and choose appropriate settings
- Install with sensible defaults
- Set up all required services
- Run health checks automatically

### Environment Variables

For automated installation, set these environment variables:

```bash
export GITHUB_TOKEN="your-github-token"
export GITHUB_ORG="your-github-org"
./one-click-install.sh
```

## 📋 Installation Options

### Comprehensive Installation Script

For more control over the installation process:

```bash
./install-comprehensive.sh [OPTIONS]
```

#### Available Options

| Option | Description | Default |
|--------|-------------|---------|
| `-m, --mode MODE` | Installation mode: `development` or `production` | `development` |
| `-q, --quiet` | Run in quiet mode (non-interactive) | `false` |
| `-v, --no-vault` | Skip HashiCorp Vault installation | Include Vault |
| `-o, --no-monitoring` | Skip Prometheus/Grafana setup | Include monitoring |
| `-a, --enable-ha` | Enable High Availability (production only) | `false` |
| `-n, --no-nginx` | Skip nginx reverse proxy | Include nginx |
| `-t, --skip-tests` | Skip running tests after installation | Run tests |
| `-f, --force` | Force installation (skip confirmations) | `false` |
| `-e, --env-file FILE` | Custom environment file | `.env` |
| `-h, --help` | Show help message | - |

### Installation Modes

#### Development Mode
Perfect for local development and testing:
- Single-node setup
- Basic services (PostgreSQL, Redis)
- Development-friendly defaults
- No SSL/TLS configuration
- Minimal resource requirements

```bash
./install-comprehensive.sh --mode development
```

#### Production Mode
Enterprise-ready deployment:
- Full security features
- SSL/TLS configuration
- Optional High Availability
- Performance optimizations
- Production logging

```bash
./install-comprehensive.sh --mode production --enable-ha
```

## 🔧 Prerequisites

### System Requirements

- **CPU**: 2+ cores (4+ recommended for production)
- **RAM**: 4GB minimum (8GB+ recommended)
- **Disk**: 20GB minimum free space
- **OS**: Linux or macOS

### Software Requirements

- **Docker**: 20.10+
- **Docker Compose**: 2.0+
- **Node.js**: 20.0+
- **Git**: Any recent version
- **OpenSSL**: For generating secrets

### Required Ports

The installer will check if these ports are available:

| Service | Port | Description |
|---------|------|-------------|
| Application API | 3001 | Main API endpoint |
| Dashboard | 3000 | Web UI |
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache/Queue |
| Vault | 8200 | Secret management |
| Prometheus | 9090 | Metrics |
| Grafana | 3030 | Monitoring dashboards |
| Nginx | 80/443 | Reverse proxy |

## 📝 Configuration

### GitHub Personal Access Token

You need a GitHub Personal Access Token with these scopes:
- `repo` - Full control of private repositories
- `admin:org` - Read org and team membership
- `workflow` - Update GitHub Action workflows

### Environment Configuration

The installer creates a comprehensive `.env` file with:
- GitHub credentials
- Database configuration
- Security settings
- Service endpoints
- Feature flags

## 🏗️ Installation Process

The comprehensive installer performs these steps:

1. **Prerequisites Check**
   - Validates system requirements
   - Checks software dependencies
   - Verifies port availability

2. **Environment Setup**
   - Creates configuration files
   - Generates secure passwords
   - Sets up directory structure

3. **Docker Configuration**
   - Creates Docker networks
   - Sets up persistent volumes
   - Configures service isolation

4. **Service Deployment**
   - PostgreSQL with replication (HA mode)
   - Redis with Sentinel (HA mode)
   - Application containers
   - Monitoring stack
   - Reverse proxy

5. **Security Setup**
   - SSL certificate generation
   - Vault initialization
   - JWT secret creation
   - Network isolation

6. **Database Setup**
   - Creates database schema
   - Runs migrations
   - Sets up replication (HA mode)

7. **Health Verification**
   - Tests all services
   - Validates API endpoints
   - Checks database connectivity

## ✅ Post-Installation

### Verify Installation

Run the verification script to ensure everything is working:

```bash
./verify-comprehensive-install.sh
```

### Access Services

After successful installation:

- **Dashboard**: http://localhost:3000
- **API**: http://localhost:3001
- **API Documentation**: http://localhost:3001/api-docs
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3030 (admin/[generated-password])
- **Vault**: http://localhost:8200

### Default Credentials

The installer generates secure passwords for:
- Database user
- Redis password
- Admin account
- JWT secrets
- Vault root token

These are saved in your `.env` file and displayed during installation.

### Next Steps

1. **Configure GitHub Webhook**
   ```bash
   Webhook URL: http://your-server:3001/webhook
   Content Type: application/json
   Secret: [from .env file]
   Events: Workflow jobs, Workflow runs
   ```

2. **Add Self-Hosted Runners**
   ```bash
   # The system will automatically manage runners
   # Configure via the dashboard or API
   ```

3. **Set Up Monitoring**
   - Import Grafana dashboards
   - Configure alerting rules
   - Set up log aggregation

## 🔧 Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Find process using port
sudo lsof -i :PORT

# Stop conflicting service or change port in .env
```

#### Docker Permission Errors
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in
```

#### Database Connection Failed
```bash
# Check PostgreSQL logs
docker-compose logs postgres

# Verify credentials in .env
```

#### Service Won't Start
```bash
# Check service logs
docker-compose logs [service-name]

# Restart service
docker-compose restart [service-name]
```

### Getting Help

- Check logs: `docker-compose logs -f`
- Review installation log: `install-*.log`
- GitHub Issues: https://github.com/anubissbe/GitHub-RunnerHub/issues

## 🛠️ Advanced Configuration

### High Availability Setup

For production HA deployment:

```bash
./install-comprehensive.sh \
  --mode production \
  --enable-ha \
  --quiet
```

This enables:
- PostgreSQL streaming replication
- Redis Sentinel cluster
- Multi-node orchestration
- Automatic failover
- Load balancing with HAProxy

### Custom SSL Certificates

Replace the self-signed certificates:

```bash
# Copy your certificates
cp your-cert.pem config/nginx/ssl/cert.pem
cp your-key.pem config/nginx/ssl/key.pem

# Restart nginx
docker-compose restart nginx
```

### External Database

To use an external database:

1. Edit `.env` file:
   ```env
   DATABASE_URL=postgresql://user:pass@host:port/dbname
   DB_HOST=external-host
   DB_PORT=5432
   ```

2. Skip local PostgreSQL:
   ```bash
   docker-compose up -d redis app nginx
   ```

## 📦 Uninstallation

To completely remove GitHub RunnerHub:

```bash
# Stop and remove containers
docker-compose down -v

# Remove Docker networks
docker network rm runnerhub-frontend runnerhub-backend runnerhub-data

# Remove data (optional - this deletes all data!)
rm -rf data/ logs/ backups/

# Remove configuration
rm .env .env.docker
```

## 🔄 Upgrading

To upgrade an existing installation:

1. Backup your data
2. Pull latest changes
3. Re-run the installer with `--force`
4. Run migrations if needed

```bash
# Backup
docker-compose exec postgres pg_dump -U app_user github_runnerhub > backup.sql

# Upgrade
git pull
./install-comprehensive.sh --force

# Verify
./verify-comprehensive-install.sh
```

---

For more information, visit the [GitHub RunnerHub documentation](https://github.com/anubissbe/GitHub-RunnerHub).