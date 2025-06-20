#!/bin/bash

# GitHub RunnerHub - Quick Start Script
# Simplified 5-minute setup for GitHub RunnerHub

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

info() {
    echo -e "${CYAN}ℹ️  $1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

header() {
    echo -e "\n${PURPLE}=== $1 ===${NC}"
}

# Show banner
echo -e "${PURPLE}"
cat << "EOF"
   ______ _ _   _   _       _       _____                             _   _       _     
  / _____(_) | | | | |     | |     |  __ \                           | | | |     | |    
 | |  __  _| |_| |_| |_   _| |__   | |__) |   _ _ __  _ __   ___ _ __  | |_| |_   _| |__  
 | | |_ |  _   _   _  | | | |  _ \  |  _  / | | | '_ \| '_ \ / _ \ '__| |  _  | | | |  _ \ 
 | |__| | | | | | | | | |_| | |_) | | | \ \ |_| | | | | | | |  __/ |    | | | | |_| | |_) |
  \_____| |_| |_| |_|  \__,_|_.__/  |_|  \_\__,_|_| |_|_| |_|\___|_|    |_| |_|\__,_|_.__/ 
       _| |                                                                              
      |__/                                                                               
EOF
echo -e "${NC}"

info "GitHub RunnerHub - Quick Start (5 minutes)"
echo

# Quick prerequisites check
header "Quick Prerequisites Check"

if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker first."
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 20+ first."
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Docker daemon not running. Please start Docker first."
    exit 1
fi

success "Prerequisites OK"

# Get essential configuration
header "Essential Configuration"

echo "We need just two things to get started:"
echo

read -p "Enter your GitHub Personal Access Token: " -r GITHUB_TOKEN
read -p "Enter your GitHub Organization name: " -r GITHUB_ORG

# Generate minimal .env
header "Creating Configuration"

cat > .env << EOF
# Essential Configuration
GITHUB_TOKEN=$GITHUB_TOKEN
GITHUB_ORG=$GITHUB_ORG
GITHUB_RUNNER_VERSION=2.311.0

# Application
NODE_ENV=development
PORT=3001
LOG_LEVEL=info

# Database (using defaults)
DATABASE_URL=postgresql://app_user:quickstart123@localhost:5432/github_runnerhub
DB_HOST=localhost
DB_PORT=5432
DB_NAME=github_runnerhub
DB_USER=app_user
DB_PASSWORD=quickstart123

# Redis (using defaults)
REDIS_HOST=localhost
REDIS_PORT=6379

# Security (basic setup)
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Skip advanced features for quick start
SECURITY_SCAN_IMAGES=false
PROMETHEUS_ENABLED=false
GRAFANA_ENABLED=false
VAULT_ENABLED=false
EOF

success "Configuration created"

# Install and build
header "Installing Dependencies"
npm ci --silent
success "Dependencies installed"

npm run build > /dev/null
success "Application built"

# Start minimal services
header "Starting Services"

docker-compose up -d postgres redis > /dev/null 2>&1
success "Database and cache started"

# Wait for services
info "Waiting for services to initialize..."
sleep 10

# Quick health check
if docker-compose exec -T postgres pg_isready -U app_user -d github_runnerhub > /dev/null 2>&1; then
    success "PostgreSQL ready"
else
    echo "⚠️  PostgreSQL still starting up..."
fi

# Final message
header "Quick Start Complete!"

success "GitHub RunnerHub is ready!"
echo
info "Next steps:"
echo "  1. Start the application: npm start"
echo "  2. Open your browser to: http://localhost:3001/health"
echo "  3. Check the dashboard: http://localhost:3000"
echo
info "To enable advanced features, run: ./install.sh"
echo
success "Happy running! 🚀"