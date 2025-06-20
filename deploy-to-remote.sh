#!/bin/bash

# GitHub RunnerHub - Remote Deployment Script
# This script deploys GitHub RunnerHub to a remote server

set -euo pipefail

# Configuration
REMOTE_HOST="${REMOTE_HOST:-your-server-ip}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_DIR="/opt/github-runnerhub"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    info "Checking prerequisites..."
    
    # Check SSH access
    if ! ssh -q "${REMOTE_USER}@${REMOTE_HOST}" exit; then
        error "Cannot connect to ${REMOTE_USER}@${REMOTE_HOST}. Please check SSH access."
    fi
    
    # Check if .env exists
    if [ ! -f "${LOCAL_DIR}/.env" ]; then
        error ".env file not found. Please create it first using .env.example as template"
    fi
    
    success "Prerequisites check passed"
}

# Prepare files for deployment
prepare_deployment() {
    info "Preparing deployment package..."
    
    # Create deployment archive excluding unnecessary files
    tar -czf /tmp/runnerhub-deploy.tar.gz \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='dist' \
        --exclude='logs' \
        --exclude='*.log' \
        --exclude='coverage' \
        --exclude='.env.local' \
        -C "${LOCAL_DIR}" .
    
    success "Deployment package prepared"
}

# Deploy to remote server
deploy_to_remote() {
    info "Deploying to ${REMOTE_HOST}..."
    
    # Create remote directory
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"
    
    # Copy deployment package
    scp /tmp/runnerhub-deploy.tar.gz "${REMOTE_USER}@${REMOTE_HOST}:/tmp/"
    
    # Extract on remote
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "cd ${REMOTE_DIR} && tar -xzf /tmp/runnerhub-deploy.tar.gz"
    
    # Copy .env file
    scp "${LOCAL_DIR}/.env" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
    
    # Clean up
    rm /tmp/runnerhub-deploy.tar.gz
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "rm /tmp/runnerhub-deploy.tar.gz"
    
    success "Files deployed to remote server"
}

# Setup remote environment
setup_remote_environment() {
    info "Setting up remote environment..."
    
    # Create setup script
    cat > /tmp/remote-setup.sh << 'EOF'
#!/bin/bash
set -euo pipefail

cd /opt/github-runnerhub

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "Installing Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Install dependencies and build
echo "Installing dependencies..."
npm ci
npm run build

# Update .env with proper host configurations
sed -i "s/localhost/0.0.0.0/g" .env
sed -i "s/DB_HOST=.*/DB_HOST=postgres/g" .env
sed -i "s/REDIS_HOST=.*/REDIS_HOST=redis/g" .env

# Create necessary directories
mkdir -p logs
mkdir -p data

# Set permissions
chmod +x *.sh

echo "Remote setup completed!"
EOF

    # Copy and execute setup script
    scp /tmp/remote-setup.sh "${REMOTE_USER}@${REMOTE_HOST}:/tmp/"
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "chmod +x /tmp/remote-setup.sh && /tmp/remote-setup.sh"
    
    # Clean up
    rm /tmp/remote-setup.sh
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "rm /tmp/remote-setup.sh"
    
    success "Remote environment setup completed"
}

# Start services on remote
start_remote_services() {
    info "Starting services on remote server..."
    
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "cd ${REMOTE_DIR} && docker-compose down || true"
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "cd ${REMOTE_DIR} && docker-compose up -d"
    
    # Wait for services to be ready
    info "Waiting for services to initialize..."
    sleep 30
    
    # Check service health
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "cd ${REMOTE_DIR} && docker-compose ps"
    
    success "Services started on remote server"
}

# Create systemd service
create_systemd_service() {
    info "Creating systemd service..."
    
    cat > /tmp/github-runnerhub.service << EOF
[Unit]
Description=GitHub RunnerHub
After=docker.service
Requires=docker.service

[Service]
Type=forking
RemainAfterExit=yes
WorkingDirectory=${REMOTE_DIR}
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

    # Copy and install service
    scp /tmp/github-runnerhub.service "${REMOTE_USER}@${REMOTE_HOST}:/tmp/"
    ssh "${REMOTE_USER}@${REMOTE_HOST}" "mv /tmp/github-runnerhub.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable github-runnerhub"
    
    rm /tmp/github-runnerhub.service
    
    success "Systemd service created"
}

# Main deployment flow
main() {
    echo -e "${BLUE}GitHub RunnerHub Remote Deployment${NC}"
    echo "Target: ${REMOTE_USER}@${REMOTE_HOST}"
    echo "Destination: ${REMOTE_DIR}"
    echo
    
    check_prerequisites
    prepare_deployment
    deploy_to_remote
    setup_remote_environment
    start_remote_services
    create_systemd_service
    
    echo
    success "Deployment completed successfully!"
    echo
    info "Access points:"
    echo "  - Health Check: http://${REMOTE_HOST}:3001/health"
    echo "  - API: http://${REMOTE_HOST}:3001/api"
    echo "  - Dashboard: http://${REMOTE_HOST}:3000"
    echo
    info "Next steps:"
    echo "  1. Verify services: ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker-compose ps'"
    echo "  2. Check logs: ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker-compose logs -f'"
    echo "  3. Configure GitHub webhooks to point to http://${REMOTE_HOST}:3001/webhooks"
}

# Run main function
main "$@"