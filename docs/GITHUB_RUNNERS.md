# GitHub Self-Hosted Runners Setup

This guide explains how to set up and manage GitHub self-hosted runners that integrate with the GitHub-RunnerHub system.

## Overview

GitHub-RunnerHub provides automated scripts to deploy and manage GitHub self-hosted runners with enterprise-grade features:

- **Vault Integration**: Secure GitHub token management
- **Multi-Runner Support**: Deploy multiple runners per server
- **Systemd Services**: Auto-startup and monitoring
- **Docker Ready**: Full containerized job support
- **Smart Labels**: Automatic labeling for job routing

## Quick Setup

### Prerequisites

- RunnerHub application deployed with Vault integration
- GitHub Personal Access Token stored in Vault at path `github`
- Server with Docker and systemd support
- Sudo privileges for systemd service management
- Vault server configured with appropriate credentials

### Environment Setup

Before running the setup scripts, ensure these environment variables are set:

```bash
export VAULT_ADDR="http://your-vault-server:8200"
export VAULT_TOKEN="your-vault-token"
export GITHUB_ORG="your-github-organization"
```

### One-Command Setup

The simplest way to set up runners:

```bash
./simple-runner-setup.sh
```

This script:
1. Retrieves GitHub token from the RunnerHub container's Vault integration
2. Downloads GitHub Actions runner binary
3. Configures 2 runners with proper labels
4. Creates systemd services for auto-startup
5. Starts the runners immediately

## Setup Scripts

### 1. `simple-runner-setup.sh` (Recommended)

**Best for**: Production deployments with existing RunnerHub container

```bash
# Features:
# - Vault integration via container
# - Automated setup of 2 runners
# - Systemd service creation
# - Immediate startup

./simple-runner-setup.sh
```

### 2. `auto-setup-runners.sh`

**Best for**: Remote server deployment with direct Vault access

```bash
# Features:
# - Direct Vault API access
# - Configurable runner count
# - Enterprise setup options
# - Comprehensive logging

./auto-setup-runners.sh
```

### 3. `setup-github-runners.sh`

**Best for**: Interactive setup with customization

```bash
# Features:
# - Interactive configuration
# - Repository selection
# - Custom labels and settings
# - Validation checks

./setup-github-runners.sh
```

## Runner Configuration

### Default Configuration

All runners are configured with:

- **Name Pattern**: `runnerhub-1`, `runnerhub-2`, etc.
- **Labels**: `self-hosted,docker,runnerhub,projecthub`
- **Work Directory**: `/tmp/runner-work` (separate for each runner)
- **Repository**: `anubissbe/GitHub-RunnerHub` (configurable)

### Custom Labels

To add custom labels, modify the setup script:

```bash
--labels "self-hosted,docker,runnerhub,projecthub,your-custom-label"
```

### Multiple Repositories

To register runners for different repositories, run the setup script multiple times with different `TARGET_REPO` values.

## Management

### Service Management

Each runner runs as a systemd service:

```bash
# Check status
sudo systemctl status github-runner-runnerhub-1
sudo systemctl status github-runner-runnerhub-2

# Start/stop/restart
sudo systemctl start github-runner-runnerhub-1
sudo systemctl stop github-runner-runnerhub-1
sudo systemctl restart github-runner-runnerhub-1

# Enable/disable auto-start
sudo systemctl enable github-runner-runnerhub-1
sudo systemctl disable github-runner-runnerhub-1
```

### Log Monitoring

View real-time logs:

```bash
# Follow logs for specific runner
sudo journalctl -u github-runner-runnerhub-1 -f

# View recent logs
sudo journalctl -u github-runner-runnerhub-1 --since "1 hour ago"

# View all runner logs
sudo journalctl -u github-runner-* -f
```

### Runner Status

Check runner status via GitHub API:

```bash
# Get all runners for repository
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/anubissbe/GitHub-RunnerHub/actions/runners

# Check specific runner (replace ID)
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/anubissbe/GitHub-RunnerHub/actions/runners/151
```

## Troubleshooting

### Common Issues

#### 1. Runner Shows as Offline

**Symptoms**: Runner registered but shows "offline" in GitHub

**Solutions**:
```bash
# Check if service is running
sudo systemctl status github-runner-runnerhub-1

# Check service logs
sudo journalctl -u github-runner-runnerhub-1 --since "10 minutes ago"

# Restart the service
sudo systemctl restart github-runner-runnerhub-1
```

#### 2. Token Authentication Failed

**Symptoms**: "Invalid configuration provided for token"

**Solutions**:
```bash
# Verify token in Vault
docker exec runnerhub-app node -e "
const VaultClient = require('./services/vault-client');
const vault = new VaultClient();
vault.getGitHubSecrets().then(secrets => {
    console.log('Token found:', !!secrets?.token);
}).catch(err => console.error('Error:', err.message));
"

# Check token permissions on GitHub
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
```

#### 3. Service Won't Start

**Symptoms**: Systemd service fails to start

**Solutions**:
```bash
# Check service configuration
sudo systemctl cat github-runner-runnerhub-1

# Check file permissions
ls -la ~/github-runners/runnerhub-1/

# Manually test runner
cd ~/github-runners/runnerhub-1
./run.sh
```

#### 4. Multiple Job Conflicts

**Symptoms**: Jobs failing due to resource conflicts

**Solutions**:
- Ensure separate work directories for each runner
- Check available disk space and memory
- Verify Docker daemon has sufficient resources

### Debug Mode

Enable debug logging for detailed troubleshooting:

```bash
# Stop the service
sudo systemctl stop github-runner-runnerhub-1

# Run manually with debug
cd ~/github-runners/runnerhub-1
ACTIONS_RUNNER_DEBUG=1 ./run.sh
```

## Security Considerations

### Token Security

- GitHub tokens are stored securely in HashiCorp Vault
- Tokens are retrieved at runtime, not stored in scripts
- Use least-privilege tokens with only required scopes

### Network Security

- Runners communicate only with GitHub and Docker daemon
- Consider firewall rules for additional security
- Use private networks when possible

### Container Security

- All job execution happens in isolated Docker containers
- Containers are ephemeral and cleaned up after jobs
- Consider using security scanning for job containers

## Advanced Configuration

### Multiple Organizations

To support multiple GitHub organizations:

1. Store additional tokens in Vault under different paths
2. Modify scripts to use appropriate token for each org
3. Use different runner labels to distinguish organizations

### Custom Runner Images

To use custom runner environments:

1. Build custom Docker images with required tools
2. Configure runners to use custom images in workflow files
3. Use `runs-on: self-hosted` with appropriate labels

### Scaling

For high-scale deployments:

1. Deploy runners across multiple servers
2. Use configuration management (Ansible, etc.) for deployment
3. Monitor runner queue lengths and auto-scale accordingly
4. Consider using autoscaling groups in cloud environments

## Monitoring Integration

### RunnerHub Dashboard

Runners automatically appear in the RunnerHub dashboard:

- Real-time status monitoring
- Job execution metrics
- Historical performance data

### Prometheus Metrics

Expose runner metrics for monitoring:

```bash
# Custom metrics endpoint (if implemented)
curl http://localhost:3001/api/metrics | grep runner
```

### Alerting

Set up alerts for:
- Runner offline status
- High job failure rates
- Resource exhaustion
- Service failures

## Workflow Usage

### Basic Usage

Use self-hosted runners in your GitHub workflows:

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: npm test
```

### Label-Specific Runners

Target specific runners using labels:

```yaml
jobs:
  docker-build:
    runs-on: [self-hosted, docker, runnerhub]
    steps:
      - name: Build Docker image
        run: docker build -t myapp .
```

### Matrix Jobs

Run parallel jobs across multiple runners:

```yaml
jobs:
  test:
    runs-on: self-hosted
    strategy:
      matrix:
        node-version: [16, 18, 20]
    steps:
      - uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
```

## Maintenance

### Regular Maintenance Tasks

1. **Update Runner Version**: Periodically update to latest GitHub Actions runner
2. **Clean Work Directories**: Remove old job artifacts from work directories
3. **Monitor Logs**: Check for errors or performance issues
4. **Update Scripts**: Keep setup scripts updated with latest features

### Backup and Recovery

1. **Configuration Backup**: Backup runner configuration files
2. **Service Definitions**: Backup systemd service files
3. **Logs Archive**: Archive old logs for compliance
4. **Token Rotation**: Regularly rotate GitHub tokens

### Performance Optimization

1. **Resource Monitoring**: Monitor CPU, memory, and disk usage
2. **Job Optimization**: Profile and optimize job execution times
3. **Network Optimization**: Optimize network connectivity to GitHub
4. **Storage Optimization**: Use fast storage for work directories

## Support

For issues and questions:

- Check the troubleshooting section above
- Review runner logs using journalctl
- Consult GitHub Actions documentation
- Open issues in the GitHub-RunnerHub repository

## References

- [GitHub Actions Self-Hosted Runners](https://docs.github.com/en/actions/hosting-your-own-runners)
- [GitHub API - Actions Runners](https://docs.github.com/en/rest/actions/self-hosted-runners)
- [Systemd Service Management](https://www.freedesktop.org/software/systemd/man/systemctl.html)
- [HashiCorp Vault Integration](../VAULT_INTEGRATION.md)