# myoung34/github-runner - Docker Image for GitHub Actions Runners

## Overview

The myoung34/github-runner is a popular Docker image that provides a containerized GitHub Actions runner. It's the foundation for GitHub RunnerHub's self-hosted runner infrastructure, offering flexibility, security, and easy deployment.

## Official Documentation

- **Docker Hub**: https://hub.docker.com/r/myoung34/github-runner
- **GitHub Repository**: https://github.com/myoung34/docker-github-actions-runner
- **Configuration Guide**: https://github.com/myoung34/docker-github-actions-runner/wiki
- **Environment Variables**: https://github.com/myoung34/docker-github-actions-runner#environment-variables

## Integration with GitHub RunnerHub

### Basic Runner Deployment

```javascript
// runner-manager.js implementation
async createRunner(repoName, runnerName, isDynamic = false) {
  const container = await docker.createContainer({
    Image: 'myoung34/github-runner:latest',
    name: runnerName,
    Env: [
      `REPO_URL=https://github.com/${this.org}/${repoName}`,
      `RUNNER_NAME=${runnerName}`,
      `RUNNER_TOKEN=${await this.getRegistrationToken(repoName)}`,
      `RUNNER_WORKDIR=/tmp/runner/work`,
      'RUNNER_GROUP=default',
      `LABELS=self-hosted,docker,runnerhub,${isDynamic ? 'dynamic' : 'dedicated'}`,
      'EPHEMERAL=true', // For dynamic runners
      'DISABLE_AUTO_UPDATE=true'
    ],
    HostConfig: {
      AutoRemove: isDynamic, // Auto-cleanup for dynamic runners
      RestartPolicy: {
        Name: isDynamic ? 'no' : 'unless-stopped'
      },
      Binds: [
        '/var/run/docker.sock:/var/run/docker.sock:rw'
      ]
    }
  });
  
  return container;
}
```

### Advanced Configuration

```yaml
# docker-compose.yml runner service
runner:
  image: myoung34/github-runner:2.311.0
  environment:
    # Repository configuration
    REPO_URL: ${REPO_URL}
    ACCESS_TOKEN: ${GITHUB_TOKEN}
    
    # Runner configuration
    RUNNER_NAME_PREFIX: runnerhub
    RUNNER_WORKDIR: /tmp/runner/work
    RUNNER_GROUP: default
    LABELS: self-hosted,docker,runnerhub,x64,linux
    
    # Performance tuning
    RUNNER_SCOPE: repo
    EPHEMERAL: true
    DISABLE_AUTO_UPDATE: true
    
    # Security
    RUN_AS_ROOT: false
    
  volumes:
    # Docker socket for Docker-in-Docker
    - /var/run/docker.sock:/var/run/docker.sock
    # Cache directories
    - runner_cache:/home/runner/.cache
    - runner_npm:/home/runner/.npm
    
  deploy:
    replicas: 5
    resources:
      limits:
        cpus: '2'
        memory: 4G
      reservations:
        cpus: '0.5'
        memory: 1G
```

## Configuration Best Practices

### 1. Environment Variables Reference

```bash
# Essential Variables
REPO_URL                 # GitHub repository URL
RUNNER_TOKEN            # Registration token (preferred over PAT)
ACCESS_TOKEN            # Personal Access Token (alternative)

# Runner Configuration
RUNNER_NAME             # Custom runner name
RUNNER_NAME_PREFIX      # Prefix for auto-generated names
RUNNER_WORKDIR          # Working directory (default: _work)
RUNNER_GROUP            # Runner group assignment
LABELS                  # Comma-separated labels

# Behavior Options
EPHEMERAL              # Single job runner (true/false)
DISABLE_AUTO_UPDATE    # Prevent auto-updates (true/false)
START_DOCKER_SERVICE   # Start Docker daemon (true/false)
RUN_AS_ROOT           # Run as root user (true/false)

# Organization Runners
ORG_URL               # Organization URL (instead of REPO_URL)
RUNNER_SCOPE          # 'org' or 'repo' (default: repo)
```

### 2. Ephemeral vs Persistent Runners

```javascript
// Ephemeral runners (recommended for security)
const ephemeralConfig = {
  Env: [
    'EPHEMERAL=true', // Runner removes itself after one job
    'DISABLE_AUTO_UPDATE=true' // Prevent updates during job
  ],
  HostConfig: {
    AutoRemove: true, // Container removed after exit
    RestartPolicy: { Name: 'no' }
  }
};

// Persistent runners (for dedicated workloads)
const persistentConfig = {
  Env: [
    'EPHEMERAL=false',
    'DISABLE_AUTO_UPDATE=false'
  ],
  HostConfig: {
    RestartPolicy: { Name: 'unless-stopped' },
    Binds: [
      'runner_work:/home/runner/_work' // Persistent workspace
    ]
  }
};
```

### 3. Custom Runner Images

```dockerfile
# Dockerfile for custom runner
FROM myoung34/github-runner:latest

# Install additional tools
USER root
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    jq \
    aws-cli \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js versions
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# Install Docker Compose
RUN curl -L "https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose

# Switch back to runner user
USER runner

# Pre-install global npm packages
RUN npm install -g yarn pnpm typescript
```

## Security Considerations

### 1. Token Management

```javascript
// Secure token rotation
class TokenManager {
  async rotateRunnerTokens() {
    const runners = await this.listRunners();
    
    for (const runner of runners) {
      // Get new registration token
      const newToken = await this.getRegistrationToken(runner.repo);
      
      // Stop runner gracefully
      await container.stop({ t: 30 });
      
      // Update token and restart
      await container.update({
        Env: this.updateEnvVar(container.Env, 'RUNNER_TOKEN', newToken)
      });
      
      await container.start();
    }
  }
}
```

### 2. Container Security

```yaml
# Security-hardened configuration
runner:
  image: myoung34/github-runner:latest
  security_opt:
    - no-new-privileges:true
    - seccomp:unconfined  # Required for some builds
  cap_drop:
    - ALL
  cap_add:
    - CHOWN
    - SETUID
    - SETGID
  user: "1000:1000"  # Non-root user
  read_only: false   # Runner needs write access
  environment:
    RUN_AS_ROOT: false
```

### 3. Network Isolation

```yaml
networks:
  runners:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.enable_icc: "false"
    ipam:
      config:
        - subnet: 172.20.0.0/16

services:
  runner:
    networks:
      - runners
    dns:
      - 8.8.8.8
      - 8.8.4.4
```

## Monitoring and Debugging

### 1. Runner Health Checks

```javascript
// Health check implementation
async checkRunnerHealth(containerName) {
  const container = docker.getContainer(containerName);
  const info = await container.inspect();
  
  // Check container status
  if (info.State.Status !== 'running') {
    return { healthy: false, reason: 'Container not running' };
  }
  
  // Check runner process
  const exec = await container.exec({
    Cmd: ['pgrep', '-f', 'Runner.Listener'],
    AttachStdout: true
  });
  
  const stream = await exec.start();
  const output = await streamToString(stream);
  
  return {
    healthy: output.trim() !== '',
    pid: output.trim(),
    uptime: Date.now() - new Date(info.State.StartedAt).getTime()
  };
}
```

### 2. Log Analysis

```bash
# View runner logs
docker logs -f github-runner-dedicated-projecthub

# Filter for specific events
docker logs github-runner-dedicated-projecthub 2>&1 | grep -E "(Listening for Jobs|Running job|Job completed)"

# Export logs for analysis
docker logs github-runner-dedicated-projecthub > runner.log 2>&1
```

### 3. Performance Monitoring

```javascript
// Monitor runner resources
async getRunnerStats(containerName) {
  const container = docker.getContainer(containerName);
  const stats = await container.stats({ stream: false });
  
  return {
    cpu: {
      usage: this.calculateCPUPercentage(stats),
      throttling: stats.cpu_stats.throttling_data
    },
    memory: {
      usage: stats.memory_stats.usage,
      limit: stats.memory_stats.limit,
      percentage: (stats.memory_stats.usage / stats.memory_stats.limit) * 100
    },
    network: {
      rx_bytes: stats.networks.eth0.rx_bytes,
      tx_bytes: stats.networks.eth0.tx_bytes
    },
    disk: {
      reads: stats.blkio_stats.io_service_bytes_recursive.find(s => s.op === 'read').value,
      writes: stats.blkio_stats.io_service_bytes_recursive.find(s => s.op === 'write').value
    }
  };
}
```

## Advanced Patterns

### 1. Multi-Architecture Support

```yaml
# Support ARM and x64
runner:
  image: myoung34/github-runner:latest
  platform: linux/amd64  # or linux/arm64
  environment:
    LABELS: self-hosted,docker,${PLATFORM}
```

### 2. Runner Pools

```javascript
// Create specialized runner pools
const runnerPools = {
  'high-memory': {
    image: 'myoung34/github-runner:latest',
    memory: 16 * 1024 * 1024 * 1024, // 16GB
    labels: 'self-hosted,high-memory'
  },
  'gpu': {
    image: 'myoung34/github-runner:latest-ubuntu-20.04',
    devices: ['/dev/nvidia0'],
    labels: 'self-hosted,gpu,cuda'
  },
  'windows': {
    image: 'myoung34/github-runner:latest-windows',
    platform: 'windows',
    labels: 'self-hosted,windows'
  }
};
```

### 3. Caching Strategies

```yaml
volumes:
  # Language-specific caches
  maven_cache:
  gradle_cache:
  npm_cache:
  pip_cache:
  
services:
  runner:
    volumes:
      # Mount caches
      - maven_cache:/home/runner/.m2
      - gradle_cache:/home/runner/.gradle
      - npm_cache:/home/runner/.npm
      - pip_cache:/home/runner/.cache/pip
      
      # Docker layer cache
      - /var/lib/docker:/var/lib/docker
```

## Performance Optimization

### 1. Pre-built Images

```dockerfile
# Pre-install common dependencies
FROM myoung34/github-runner:latest

# Pre-warm package managers
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    jq \
    libssl-dev \
    pkg-config \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Pre-download common actions
RUN mkdir -p /home/runner/actions-cache \
    && cd /home/runner/actions-cache \
    && git clone https://github.com/actions/checkout \
    && git clone https://github.com/actions/setup-node \
    && git clone https://github.com/actions/cache
```

### 2. Resource Allocation

```javascript
// Dynamic resource allocation based on job type
const getResourceConfig = (labels) => {
  if (labels.includes('heavy')) {
    return {
      CpuShares: 2048,
      Memory: 8 * 1024 * 1024 * 1024,
      MemorySwap: 8 * 1024 * 1024 * 1024
    };
  }
  
  return {
    CpuShares: 1024,
    Memory: 2 * 1024 * 1024 * 1024,
    MemorySwap: 2 * 1024 * 1024 * 1024
  };
};
```

## Common Issues and Solutions

### 1. Runner Registration Failures

**Problem**: Runner fails to register with GitHub

**Solution**:
```bash
# Check token validity
curl -H "Authorization: token ${GITHUB_TOKEN}" \
  https://api.github.com/repos/${ORG}/${REPO}/actions/runners/registration-token

# Manual registration test
docker run --rm -it \
  -e REPO_URL="https://github.com/${ORG}/${REPO}" \
  -e RUNNER_TOKEN="${TOKEN}" \
  myoung34/github-runner:latest \
  bash -c "./config.sh --check"
```

### 2. Docker-in-Docker Permission Issues

**Problem**: Cannot access Docker socket

**Solution**:
```yaml
runner:
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
  group_add:
    - ${DOCKER_GROUP_ID}  # Usually 999 or 998
  environment:
    DOCKER_HOST: unix:///var/run/docker.sock
```

### 3. Job Timeout Issues

**Problem**: Long-running jobs timeout

**Solution**:
```yaml
# In workflow
jobs:
  build:
    runs-on: self-hosted
    timeout-minutes: 360  # 6 hours

# In runner config
runner:
  environment:
    ACTIONS_RUNNER_HOOK_JOB_STARTED: /hooks/job-started.sh
    ACTIONS_RUNNER_HOOK_JOB_COMPLETED: /hooks/job-completed.sh
```

## Integration Examples

### 1. Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: github-runners
spec:
  replicas: 10
  selector:
    matchLabels:
      app: github-runner
  template:
    metadata:
      labels:
        app: github-runner
    spec:
      containers:
      - name: runner
        image: myoung34/github-runner:latest
        env:
        - name: REPO_URL
          value: "https://github.com/org/repo"
        - name: RUNNER_TOKEN
          valueFrom:
            secretKeyRef:
              name: github-runner-secret
              key: token
        - name: EPHEMERAL
          value: "true"
        resources:
          requests:
            memory: "2Gi"
            cpu: "1"
          limits:
            memory: "4Gi"
            cpu: "2"
```

### 2. Docker Swarm Service

```yaml
version: '3.8'
services:
  runner:
    image: myoung34/github-runner:latest
    deploy:
      replicas: 10
      placement:
        constraints:
          - node.role == worker
      resources:
        limits:
          cpus: '2'
          memory: 4G
    environment:
      REPO_URL: ${REPO_URL}
      RUNNER_TOKEN: ${RUNNER_TOKEN}
      EPHEMERAL: 'true'
```

## Related Technologies

- GitHub Actions
- Docker Engine
- Kubernetes Actions Runner Controller
- Jenkins Docker agents
- GitLab Runner