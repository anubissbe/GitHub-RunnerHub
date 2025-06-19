# Docker - Container Platform

## Overview
Docker is a platform for developing, shipping, and running applications in containers. It provides OS-level virtualization to deliver software in packages called containers that are isolated from one another and bundle their own software, libraries, and configuration files.

**Official Documentation**: https://docs.docker.com/

## Key Concepts and Features

### Core Components
- **Images**: Read-only templates containing application code and dependencies
- **Containers**: Running instances of Docker images
- **Dockerfile**: Text files with instructions to build images
- **Registry**: Storage and distribution system for Docker images
- **Volumes**: Persistent data storage mechanism
- **Networks**: Communication channels between containers

### Technical Architecture
- **Docker Engine**: Core runtime for creating and managing containers
- **containerd**: Container runtime
- **runc**: Low-level container runtime
- **Docker CLI**: Command-line interface
- **Docker API**: RESTful API for programmatic access
- **BuildKit**: Advanced build subsystem

## Common Use Cases

1. **Application Containerization**
   - Microservices deployment
   - Application packaging
   - Dependency isolation
   - Version control for environments

2. **Development Environments**
   - Consistent development setup
   - Isolated testing environments
   - Quick environment provisioning
   - Dependency management

3. **CI/CD Pipelines**
   - Build automation
   - Testing in isolated environments
   - Deployment artifacts
   - Multi-stage builds

4. **Cloud Deployments**
   - Container orchestration
   - Scalable applications
   - Resource optimization
   - Platform independence

## Best Practices

### Dockerfile Best Practices
```dockerfile
# Use specific base image versions
FROM node:18-alpine AS base

# Install dependencies in separate layer
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Build application
FROM base AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production image
FROM base AS runtime
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Copy production dependencies
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start application
CMD ["node", "dist/server.js"]
```

### Image Optimization
```dockerfile
# Multi-stage build for smaller images
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --production

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Security Best Practices
```dockerfile
# Security scanning
# Use official base images
FROM node:18-alpine

# Don't run as root
USER node

# Use COPY instead of ADD
COPY --chown=node:node . .

# Minimize layers
RUN apt-get update && apt-get install -y \
    package1 \
    package2 \
    && rm -rf /var/lib/apt/lists/*

# Use secrets during build
RUN --mount=type=secret,id=npm_token \
    npm config set //registry.npmjs.org/:_authToken=$(cat /run/secrets/npm_token) \
    && npm ci \
    && npm config delete //registry.npmjs.org/:_authToken
```

## Integration Patterns with GitHub RunnerHub Stack

### Docker Compose for Development
```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    ports:
      - "3000:3000"
    volumes:
      - ./src:/app/src
      - ./package.json:/app/package.json
      - node_modules:/app/node_modules
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://user:pass@db:5432/runnerhub
    depends_on:
      - db
      - redis
    command: npm run dev

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: runnerhub
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass redis_pass
    ports:
      - "6379:6379"

  runner:
    build:
      context: .
      dockerfile: Dockerfile.runner
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./runners:/app/runners
    environment:
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - RUNNER_WORKDIR=/app/runners
    depends_on:
      - app

volumes:
  node_modules:
  postgres_data:
```

### GitHub Actions Runner Dockerfile
```dockerfile
FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    tar \
    git \
    sudo \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create runner user
RUN useradd -m runner && \
    usermod -aG sudo runner && \
    echo "runner ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Download and install GitHub Actions runner
WORKDIR /home/runner
ARG RUNNER_VERSION="2.311.0"
RUN curl -o actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz -L \
    https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz && \
    tar xzf actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz && \
    rm actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz

# Install Docker (Docker-in-Docker)
RUN curl -fsSL https://get.docker.com | sh && \
    usermod -aG docker runner

# Copy startup script
COPY scripts/start-runner.sh /home/runner/start-runner.sh
RUN chmod +x /home/runner/start-runner.sh && \
    chown -R runner:runner /home/runner

USER runner
ENTRYPOINT ["/home/runner/start-runner.sh"]
```

### Dockerode Integration
```javascript
import Docker from 'dockerode';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Create runner container
async function createRunnerContainer(config) {
  const container = await docker.createContainer({
    Image: 'ghcr.io/org/github-runner:latest',
    name: `runner-${config.name}`,
    Env: [
      `RUNNER_NAME=${config.name}`,
      `RUNNER_TOKEN=${config.token}`,
      `RUNNER_WORKDIR=/work`,
      `LABELS=${config.labels.join(',')}`
    ],
    HostConfig: {
      Binds: [
        '/var/run/docker.sock:/var/run/docker.sock',
        `${config.workdir}:/work`
      ],
      RestartPolicy: {
        Name: 'unless-stopped'
      },
      Resources: {
        CpuShares: 1024,
        Memory: 2 * 1024 * 1024 * 1024 // 2GB
      }
    },
    Labels: {
      'com.github.runnerhub.managed': 'true',
      'com.github.runnerhub.runner-id': config.id
    }
  });
  
  await container.start();
  return container;
}

// Monitor container health
async function monitorContainerHealth(containerId) {
  const container = docker.getContainer(containerId);
  const stream = await container.stats({ stream: true });
  
  stream.on('data', (data) => {
    const stats = JSON.parse(data);
    const cpuPercent = calculateCPUPercent(stats);
    const memoryUsage = stats.memory_stats.usage;
    
    metrics.gauge('container_cpu_percent', cpuPercent, { container: containerId });
    metrics.gauge('container_memory_bytes', memoryUsage, { container: containerId });
  });
}
```

### Volume Management
```javascript
// Create named volume for runner workspace
async function createRunnerVolume(runnerId) {
  const volume = await docker.createVolume({
    Name: `runner-workspace-${runnerId}`,
    Labels: {
      'com.github.runnerhub.runner-id': runnerId
    }
  });
  
  return volume;
}

// Backup volume data
async function backupVolume(volumeName, backupPath) {
  const container = await docker.createContainer({
    Image: 'alpine',
    Cmd: ['tar', 'czf', '/backup/backup.tar.gz', '/data'],
    HostConfig: {
      Binds: [
        `${volumeName}:/data:ro`,
        `${backupPath}:/backup`
      ]
    }
  });
  
  await container.start();
  await container.wait();
  await container.remove();
}
```

### Network Configuration
```javascript
// Create isolated network for runners
async function createRunnerNetwork() {
  const network = await docker.createNetwork({
    Name: 'runnerhub-network',
    Driver: 'bridge',
    Internal: false,
    Attachable: true,
    Labels: {
      'com.github.runnerhub.network': 'true'
    },
    IPAM: {
      Config: [{
        Subnet: '172.20.0.0/16',
        Gateway: '172.20.0.1'
      }]
    }
  });
  
  return network;
}
```

## GitHub RunnerHub Specific Patterns

### Container Lifecycle Management
```javascript
class DockerRunnerManager {
  constructor(docker) {
    this.docker = docker;
  }

  async createRunner(config) {
    // Pull latest image
    await this.pullImage(config.image);
    
    // Create container
    const container = await this.docker.createContainer({
      Image: config.image,
      name: `gh-runner-${config.id}`,
      Env: this.buildEnvironment(config),
      HostConfig: this.buildHostConfig(config),
      Labels: this.buildLabels(config)
    });
    
    // Start container
    await container.start();
    
    // Wait for healthy state
    await this.waitForHealthy(container);
    
    return container;
  }

  async stopRunner(runnerId) {
    const container = await this.getContainer(runnerId);
    
    // Graceful shutdown
    await container.stop({ t: 30 });
    
    // Remove container
    await container.remove({ v: true });
  }

  async restartRunner(runnerId) {
    const container = await this.getContainer(runnerId);
    await container.restart();
  }

  buildEnvironment(config) {
    return [
      `RUNNER_NAME=${config.name}`,
      `RUNNER_TOKEN=${config.token}`,
      `RUNNER_LABELS=${config.labels.join(',')}`,
      `RUNNER_WORKDIR=/work`,
      `DISABLE_AUTO_UPDATE=true`
    ];
  }

  buildHostConfig(config) {
    return {
      Binds: [
        '/var/run/docker.sock:/var/run/docker.sock'
      ],
      RestartPolicy: {
        Name: 'unless-stopped',
        MaximumRetryCount: 3
      },
      Resources: {
        CpuShares: config.cpuShares || 1024,
        Memory: config.memory || 2147483648, // 2GB default
        CpuQuota: config.cpuQuota || 100000,
        CpuPeriod: 100000
      },
      SecurityOpt: ['no-new-privileges:true'],
      ReadonlyRootfs: false,
      Privileged: false
    };
  }

  buildLabels(config) {
    return {
      'com.github.runnerhub.managed': 'true',
      'com.github.runnerhub.runner-id': config.id,
      'com.github.runnerhub.runner-name': config.name,
      'com.github.runnerhub.created': new Date().toISOString()
    };
  }
}
```

### Image Building and Caching
```dockerfile
# Build cache optimization
# syntax=docker/dockerfile:1.4

# Download dependencies
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production

# Build application
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY . .
RUN npm run build

# Final image
FROM node:18-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Health Checks
```dockerfile
# Health check configuration
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
```

```javascript
// Implement health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await db.query('SELECT 1');
    
    // Check Docker daemon
    await docker.ping();
    
    res.status(200).json({
      status: 'healthy',
      checks: {
        database: 'ok',
        docker: 'ok'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});
```

## Monitoring and Logging

### Container Logging
```javascript
// Stream container logs
async function streamContainerLogs(containerId, options = {}) {
  const container = docker.getContainer(containerId);
  const stream = await container.logs({
    stdout: true,
    stderr: true,
    follow: true,
    tail: options.tail || 100,
    timestamps: true
  });
  
  return stream;
}

// Parse Docker logs
function parseDockerLogs(stream) {
  const parser = new Transform({
    transform(chunk, encoding, callback) {
      // Docker log format: header (8 bytes) + payload
      let offset = 0;
      while (offset < chunk.length) {
        const header = chunk.slice(offset, offset + 8);
        const size = header.readUInt32BE(4);
        const payload = chunk.slice(offset + 8, offset + 8 + size);
        
        this.push({
          stream: header[0] === 1 ? 'stdout' : 'stderr',
          message: payload.toString('utf8'),
          timestamp: new Date()
        });
        
        offset += 8 + size;
      }
      callback();
    }
  });
  
  return stream.pipe(parser);
}
```

### Resource Monitoring
```javascript
// Monitor container resources
async function monitorContainerResources(containerId) {
  const container = docker.getContainer(containerId);
  const stats = await container.stats({ stream: false });
  
  return {
    cpu: calculateCPUPercent(stats),
    memory: {
      usage: stats.memory_stats.usage,
      limit: stats.memory_stats.limit,
      percent: (stats.memory_stats.usage / stats.memory_stats.limit) * 100
    },
    network: {
      rx_bytes: stats.networks?.eth0?.rx_bytes || 0,
      tx_bytes: stats.networks?.eth0?.tx_bytes || 0
    },
    disk: {
      read_bytes: stats.blkio_stats?.io_service_bytes_recursive?.[0]?.value || 0,
      write_bytes: stats.blkio_stats?.io_service_bytes_recursive?.[1]?.value || 0
    }
  };
}

function calculateCPUPercent(stats) {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                   stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - 
                      stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus || 1;
  
  return (cpuDelta / systemDelta) * cpuCount * 100;
}
```

## Security Considerations

### Image Scanning
```bash
# Scan image for vulnerabilities
docker scan ghcr.io/org/app:latest

# Use Trivy for comprehensive scanning
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image ghcr.io/org/app:latest
```

### Runtime Security
```yaml
# Docker Compose security settings
services:
  app:
    image: app:latest
    security_opt:
      - no-new-privileges:true
      - seccomp:unconfined
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    read_only: true
    tmpfs:
      - /tmp
      - /var/run
```

## Troubleshooting

### Common Issues
```bash
# Container won't start
docker logs <container-id>
docker inspect <container-id>

# Permission issues
docker exec -it <container-id> ls -la /app
docker exec -it <container-id> id

# Network issues
docker network inspect bridge
docker exec -it <container-id> ping google.com

# Storage issues
docker system df
docker volume prune
docker image prune -a
```

### Debugging Containers
```bash
# Execute shell in running container
docker exec -it <container-id> /bin/sh

# Debug stopped container
docker run -it --rm --entrypoint /bin/sh <image>

# Copy files from container
docker cp <container-id>:/path/to/file ./local-file

# Inspect container processes
docker top <container-id>
```

## Resources
- [Docker Official Documentation](https://docs.docker.com/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Docker Security](https://docs.docker.com/engine/security/)
- [Dockerfile Reference](https://docs.docker.com/engine/reference/builder/)
- [Docker Compose](https://docs.docker.com/compose/)