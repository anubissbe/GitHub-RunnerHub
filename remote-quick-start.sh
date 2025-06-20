#!/bin/bash

# GitHub RunnerHub - Remote Quick Start Script
# Simplified setup for remote deployment

set -euo pipefail

# Configuration
REMOTE_HOST="${REMOTE_HOST:-your-server-ip}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
GITHUB_ORG="${GITHUB_ORG:-}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Functions
info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if we have required info
if [ -z "$GITHUB_TOKEN" ] || [ -z "$GITHUB_ORG" ]; then
    echo "GitHub configuration required!"
    echo
    read -p "Enter your GitHub Personal Access Token: " -r GITHUB_TOKEN
    read -p "Enter your GitHub Organization name: " -r GITHUB_ORG
fi

# Generate secure passwords
DB_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Create .env file
info "Creating configuration..."
cat > .env << EOF
# GitHub Configuration
GITHUB_TOKEN=$GITHUB_TOKEN
GITHUB_ORG=$GITHUB_ORG
GITHUB_RUNNER_VERSION=2.311.0

# Application Settings
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
LOG_LEVEL=info
EXTERNAL_HOST=$REMOTE_HOST

# Database Configuration
DATABASE_URL=postgresql://runnerhub:$DB_PASSWORD@postgres:5432/github_runnerhub
DB_HOST=postgres
DB_PORT=5432
DB_NAME=github_runnerhub
DB_USER=runnerhub
DB_PASSWORD=$DB_PASSWORD

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$REDIS_PASSWORD

# Security
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY

# Runner Configuration
RUNNER_NAME_PREFIX=runnerhub
RUNNER_WORK_DIR=/tmp/runner-work
RUNNER_LABELS=self-hosted,docker,runnerhub

# Feature Flags
ENABLE_AUTO_SCALING=true
ENABLE_HEALTH_CHECKS=true
ENABLE_METRICS=true
SECURITY_SCAN_IMAGES=false
PROMETHEUS_ENABLED=false
GRAFANA_ENABLED=false
VAULT_ENABLED=false

# Container Limits
CONTAINER_CPU_LIMIT=2
CONTAINER_MEMORY_LIMIT=4096
CONTAINER_TIMEOUT=3600
EOF

success "Configuration created"

# Create minimal nginx.conf
info "Creating nginx configuration..."
cat > nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream runnerhub {
        server runnerhub:3001;
    }

    server {
        listen 80;
        server_name _;

        location / {
            proxy_pass http://runnerhub;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /health {
            proxy_pass http://runnerhub/health;
            access_log off;
        }
    }
}
EOF

# Instructions
echo
success "Configuration files created!"
echo
info "Next steps to deploy on $REMOTE_HOST:"
echo
echo "1. Copy this directory to the remote server:"
echo "   rsync -av --exclude='node_modules' --exclude='.git' ./ root@$REMOTE_HOST:/opt/github-runnerhub/"
echo
echo "2. SSH to the server and run:"
echo "   ssh root@$REMOTE_HOST"
echo "   cd /opt/github-runnerhub"
echo "   docker-compose -f docker-compose.remote.yml up -d"
echo
echo "3. Check deployment:"
echo "   curl http://$REMOTE_HOST:3001/health"
echo
echo "4. Access the dashboard:"
echo "   http://$REMOTE_HOST:3001/dashboard"
echo
echo "5. View logs:"
echo "   docker-compose -f docker-compose.remote.yml logs -f"
echo
info "Configuration saved to .env - keep this secure!"