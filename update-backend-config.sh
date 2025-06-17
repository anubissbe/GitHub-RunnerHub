#!/bin/bash

echo "🔧 Updating RunnerHub backend configuration..."

# Create updated environment configuration
cat > /tmp/runnerhub.env << 'EOF'
# GitHub API Configuration
GITHUB_TOKEN=YOUR_GITHUB_TOKEN_HERE
GITHUB_ORG=anubissbe
GITHUB_REPO=ProjectHub-Mcp

# Auto-scaler Configuration
MIN_RUNNERS=5
MAX_RUNNERS=50
SCALE_THRESHOLD=0.8
SCALE_INCREMENT=5
COOLDOWN_PERIOD=300
IDLE_TIMEOUT=1800

# Backend Configuration
PORT=8300

# Authentication
JWT_SECRET=runnerhub-secret-2024-change-in-production
JWT_EXPIRY=24h
ADMIN_USERNAME=admin
ADMIN_PASSWORD=RunnerHub2024!

# Environment
NODE_ENV=production
EOF

# Copy to remote server
echo "📋 Copying configuration to RunnerHub server..."
scp /tmp/runnerhub.env remote-server:/tmp/

# Update on remote server
ssh remote-server << 'REMOTE_SCRIPT'
# Stop backend temporarily
docker stop runnerhub-backend 2>/dev/null || true

# Create config directory
sudo mkdir -p /opt/runnerhub-config
sudo cp /tmp/runnerhub.env /opt/runnerhub-config/.env

# Restart backend with new configuration
docker run -d \
  --name runnerhub-backend \
  --restart unless-stopped \
  -p 8300:8300 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/runnerhub-config/.env:/app/.env:ro \
  -e NODE_ENV=production \
  ghcr.io/anubissbe/github-runnerhub-backend:latest

echo "✅ Backend updated with new configuration"
REMOTE_SCRIPT

echo ""
echo "📊 Updated configuration:"
echo "   - Tracking ProjectHub-Mcp repository runners"
echo "   - Auto-scaling enabled with 80% threshold"
echo "   - Dashboard: http://192.168.1.16:8080"