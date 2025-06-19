# Docker Compose - Multi-Container Orchestration

## Overview

Docker Compose is a tool for defining and running multi-container Docker applications. In GitHub RunnerHub, it orchestrates the entire infrastructure including the backend API, frontend UI, PostgreSQL database, and GitHub runners.

## Official Documentation

- **Official Site**: https://docs.docker.com/compose/
- **Compose Specification**: https://github.com/compose-spec/compose-spec
- **CLI Reference**: https://docs.docker.com/compose/reference/
- **Best Practices**: https://docs.docker.com/compose/production/

## Integration with GitHub RunnerHub

### Primary docker-compose.yml Configuration

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    container_name: github-runner-backend
    ports:
      - "8300:8300"
    environment:
      - NODE_ENV=production
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - GITHUB_ORG=${GITHUB_ORG}
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/runnerhub
    depends_on:
      - db
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8300/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    build: ./frontend
    container_name: github-runner-frontend
    ports:
      - "8080:80"
    depends_on:
      - backend
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    container_name: github-runner-db
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=runnerhub
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql
    restart: unless-stopped

volumes:
  postgres_data:

networks:
  default:
    name: runnerhub_network
```

### Key Features Used

1. **Service Dependencies**: Ensures proper startup order
2. **Health Checks**: Monitors service availability
3. **Volume Mounts**: Persistent data and Docker socket access
4. **Environment Variables**: Configuration management
5. **Restart Policies**: Automatic recovery from failures
6. **Custom Networks**: Isolated communication

## Configuration Best Practices

### 1. Environment Variable Management

```yaml
# Use .env file for sensitive data
env_file:
  - .env
  - .env.local

# Override with environment-specific values
environment:
  - NODE_ENV=${NODE_ENV:-production}
  - API_PORT=${API_PORT:-8300}
```

### 2. Resource Limits

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
```

### 3. Logging Configuration

```yaml
services:
  backend:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 4. Build Context Optimization

```yaml
services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
      args:
        - NODE_VERSION=18
      cache_from:
        - github-runner-backend:latest
```

## Security Considerations

### 1. Docker Socket Access

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

**Security Implications**:
- Read-only mount minimizes risk
- Required for container management
- Should use Docker API proxy in production

### 2. Secrets Management

```yaml
secrets:
  github_token:
    external: true
  db_password:
    file: ./secrets/db_password

services:
  backend:
    secrets:
      - github_token
      - db_password
```

### 3. Network Isolation

```yaml
networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true
```

## Monitoring and Debugging

### 1. Service Health Monitoring

```bash
# Check all services status
docker-compose ps

# View service logs
docker-compose logs -f backend

# Monitor resource usage
docker stats
```

### 2. Debugging Commands

```bash
# Execute commands in running container
docker-compose exec backend sh

# View container configuration
docker-compose config

# Validate compose file
docker-compose config --quiet
```

### 3. Container Inspection

```bash
# Inspect service details
docker inspect github-runner-backend

# View network configuration
docker network inspect runnerhub_network

# Check volume details
docker volume inspect runnerhub_postgres_data
```

## Advanced Patterns

### 1. Multi-Stage Builds

```dockerfile
# backend/Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 8300
CMD ["node", "server.js"]
```

### 2. Override Files

```yaml
# docker-compose.override.yml (development)
version: '3.8'
services:
  backend:
    build:
      target: development
    volumes:
      - ./backend:/app
      - /app/node_modules
    command: npm run dev
```

### 3. Scaling Services

```yaml
# Scale specific services
services:
  runner:
    image: myoung34/github-runner:latest
    deploy:
      replicas: 5
      restart_policy:
        condition: on-failure
        delay: 5s
```

## Common Issues and Solutions

### 1. Container Startup Order

**Problem**: Services start before dependencies are ready

**Solution**:
```yaml
depends_on:
  db:
    condition: service_healthy
healthcheck:
  test: ["CMD", "pg_isready", "-U", "postgres"]
```

### 2. Volume Permissions

**Problem**: Permission denied errors

**Solution**:
```yaml
services:
  backend:
    user: "${UID}:${GID}"
    volumes:
      - ./data:/app/data:rw
```

### 3. Memory Issues

**Problem**: Containers running out of memory

**Solution**:
```yaml
services:
  backend:
    mem_limit: 2g
    memswap_limit: 2g
```

## Performance Optimization

### 1. Build Cache

```yaml
services:
  backend:
    build:
      cache_from:
        - registry.example.com/backend:latest
        - registry.example.com/backend:${BRANCH_NAME}
```

### 2. Layer Caching

```dockerfile
# Order commands by change frequency
COPY package*.json ./
RUN npm ci
COPY . .
```

### 3. Multi-Stage Optimization

```dockerfile
# Minimize final image size
FROM node:18-alpine AS deps
# Install dependencies

FROM node:18-alpine AS build
# Build application

FROM node:18-alpine
# Copy only production artifacts
```

## Integration with CI/CD

### GitHub Actions Workflow

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v3
      
      - name: Build and Deploy
        run: |
          docker-compose build
          docker-compose up -d
          docker-compose ps
```

## Useful Commands Reference

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Rebuild and start
docker-compose up -d --build

# View logs
docker-compose logs -f [service]

# Scale a service
docker-compose up -d --scale runner=10

# Remove everything including volumes
docker-compose down -v

# Update single service
docker-compose up -d --no-deps backend

# Run one-off command
docker-compose run --rm backend npm test
```

## Related Technologies

- Docker Engine
- Docker Swarm (orchestration alternative)
- Kubernetes (enterprise orchestration)
- Docker Hub (image registry)
- BuildKit (advanced builder)