#!/bin/bash

# Deploy GitHub RunnerHub to git-runner (192.168.1.16)

set -e

echo "🚀 Deploying GitHub RunnerHub to git-runner..."

# Check if GitHub token is provided
if [ -z "$1" ]; then
    echo "Error: Please provide GitHub token as argument"
    echo "Usage: ./deploy-to-git-runner.sh <GITHUB_TOKEN>"
    exit 1
fi

GITHUB_TOKEN=$1
REMOTE_HOST="git-runner"
REMOTE_DIR="~/GitHub-RunnerHub"

echo "📦 Creating deployment package..."

# Create a temporary directory for deployment
DEPLOY_DIR=$(mktemp -d)
cp -r backend frontend docker-compose.yml README.md install.sh $DEPLOY_DIR/

# Create environment file
cat > $DEPLOY_DIR/.env << EOF
# GitHub Configuration
GITHUB_TOKEN=${GITHUB_TOKEN}
GITHUB_ORG=anubissbe
GITHUB_REPO=GitHub-RunnerHub

# Runner Configuration
MIN_RUNNERS=5
MAX_RUNNERS=50
SCALE_THRESHOLD=0.8
SCALE_INCREMENT=5

# Advanced Configuration
COOLDOWN_PERIOD=300
IDLE_TIMEOUT=1800
RUNNER_IMAGE=myoung34/github-runner:latest

# Port Configuration
API_PORT=8300
UI_PORT=8080
PORT=8300

# Environment
NODE_ENV=production

# Authentication
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRY=24h
ADMIN_USERNAME=admin
ADMIN_PASSWORD=RunnerHub2024!

# Docker
COMPOSE_PROJECT_NAME=github-runnerhub
EOF

# Create docker-compose.yml with correct configuration
cat > $DEPLOY_DIR/docker-compose.yml << 'EOF'
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: runnerhub-backend
    ports:
      - "8300:8300"
    environment:
      - NODE_ENV=production
      - PORT=8300
    env_file:
      - .env
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
    networks:
      - runnerhub
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8300/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        - VITE_API_URL=http://192.168.1.16:8300
        - VITE_WS_URL=ws://192.168.1.16:8300
    container_name: runnerhub-frontend
    ports:
      - "8080:80"
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - runnerhub

networks:
  runnerhub:
    driver: bridge

volumes:
  runner_data:
EOF

echo "📤 Copying files to git-runner..."
# Use tar to copy everything efficiently
tar -czf - -C $DEPLOY_DIR . | ssh $REMOTE_HOST "mkdir -p GitHub-RunnerHub && cd GitHub-RunnerHub && tar -xzf -"

echo "🧹 Cleaning up old containers..."
ssh $REMOTE_HOST << 'ENDSSH'
# Stop and remove any existing containers
docker ps -a | grep -E "(runnerhub|github-monitor)" | awk '{print $1}' | xargs -r docker rm -f

# Remove old images
docker images | grep -E "(runnerhub|github-monitor)" | awk '{print $3}' | xargs -r docker rmi -f
ENDSSH

echo "🔨 Building and starting services..."
ssh $REMOTE_HOST << 'ENDSSH'
cd ~/GitHub-RunnerHub

# Build images
echo "Building backend..."
docker-compose build backend

echo "Building frontend..."
docker-compose build frontend

# Start services
echo "Starting services..."
docker-compose up -d

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 10

# Check health
if curl -s http://localhost:8300/health > /dev/null; then
    echo "✅ Backend API is running!"
else
    echo "⚠️  Backend API might not be ready yet."
    echo "Check logs with: docker logs runnerhub-backend"
fi
ENDSSH

# Clean up temp directory
rm -rf $DEPLOY_DIR

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               ║"
echo "║              🎉 Deployment Complete! 🎉                       ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Access your RunnerHub dashboard at:"
echo "http://192.168.1.16:8080"
echo ""
echo "API endpoint:"
echo "http://192.168.1.16:8300"
echo ""
echo "Login credentials:"
echo "Username: admin"
echo "Password: RunnerHub2024!"
echo ""
echo "Useful commands (run on git-runner):"
echo "• View logs:      docker logs -f runnerhub-backend"
echo "• Stop services:  cd ~/GitHub-RunnerHub && docker-compose down"
echo "• Restart:        cd ~/GitHub-RunnerHub && docker-compose restart"
echo ""