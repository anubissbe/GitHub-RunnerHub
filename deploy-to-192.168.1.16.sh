#!/bin/bash

# Deploy GitHub-RunnerHub to 192.168.1.16
# Complete implementation with per-repository auto-scaling

set -e

SERVER="git-runner"
PROJECT_DIR="/opt/GitHub-RunnerHub"
BACKUP_DIR="/opt/GitHub-RunnerHub-backup-$(date +%Y%m%d-%H%M%S)"

echo "🚀 Deploying GitHub-RunnerHub to $SERVER"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
ORANGE='\033[0;33m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to execute commands on remote server
remote_exec() {
    ssh $SERVER "$1"
}

print_info "Step 1: Checking server connectivity..."
if remote_exec "echo 'Server accessible'"; then
    print_success "Server $SERVER is accessible"
else
    print_error "Cannot connect to server $SERVER"
    exit 1
fi

print_info "Step 2: Stopping and backing up existing installation..."
remote_exec "
    # Stop existing services
    cd $PROJECT_DIR 2>/dev/null && docker-compose down 2>/dev/null || true
    
    # Kill any running processes on ports
    sudo pkill -f 'docker.*runnerhub' || true
    sudo pkill -f 'node.*server.js' || true
    
    # Backup existing installation if it exists
    if [ -d '$PROJECT_DIR' ]; then
        echo 'Backing up existing installation...'
        sudo mv $PROJECT_DIR $BACKUP_DIR || true
    fi
    
    # Clean up any existing containers
    docker container prune -f || true
    docker image prune -f || true
"

print_success "Existing installation cleaned and backed up"

print_info "Step 3: Creating project directory and uploading files..."

# Create a temporary deployment package
TEMP_DIR=$(mktemp -d)
DEPLOY_PACKAGE="$TEMP_DIR/runnerhub-deploy.tar.gz"

print_info "Creating deployment package..."

# Copy essential files to temp directory
mkdir -p "$TEMP_DIR/GitHub-RunnerHub"
cp -r backend "$TEMP_DIR/GitHub-RunnerHub/"
cp -r frontend "$TEMP_DIR/GitHub-RunnerHub/"
cp docker-compose.yml "$TEMP_DIR/GitHub-RunnerHub/"
cp install.sh "$TEMP_DIR/GitHub-RunnerHub/"
cp .env.example "$TEMP_DIR/GitHub-RunnerHub/"
cp README.md "$TEMP_DIR/GitHub-RunnerHub/"
cp IMPLEMENTATION_COMPLETE_SUMMARY.md "$TEMP_DIR/GitHub-RunnerHub/"

# Create deployment-specific docker-compose.yml
cat > "$TEMP_DIR/GitHub-RunnerHub/docker-compose.production.yml" << 'EOF'
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

# Create installation script for remote server
cat > "$TEMP_DIR/GitHub-RunnerHub/remote-install.sh" << 'EOF'
#!/bin/bash

set -e

echo "🚀 Installing GitHub-RunnerHub with Per-Repository Auto-Scaling"
echo "=============================================================="

# Check if environment file exists
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    
    echo ""
    echo "⚠️  IMPORTANT: You need to configure the following in .env file:"
    echo "   - GITHUB_TOKEN: Your GitHub Personal Access Token"
    echo "   - GITHUB_ORG: Your GitHub organization/username"
    echo ""
    echo "Edit .env file and then run: docker-compose -f docker-compose.production.yml up -d"
    echo ""
    exit 0
fi

# Source environment variables
source .env

if [ -z "$GITHUB_TOKEN" ] || [ "$GITHUB_TOKEN" = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" ]; then
    echo "❌ GITHUB_TOKEN is not configured in .env file"
    echo "Please edit .env and set your GitHub Personal Access Token"
    exit 1
fi

if [ -z "$GITHUB_ORG" ] || [ "$GITHUB_ORG" = "your-github-username" ]; then
    echo "❌ GITHUB_ORG is not configured in .env file" 
    echo "Please edit .env and set your GitHub organization/username"
    exit 1
fi

echo "✅ Environment configured for organization: $GITHUB_ORG"

# Build and start services
echo "Building and starting services..."
docker-compose -f docker-compose.production.yml up -d --build

echo "Waiting for services to be ready..."
sleep 10

# Check if services are running
if curl -s http://localhost:8300/health > /dev/null; then
    echo "✅ Backend API is running!"
else
    echo "⚠️ Backend API might not be ready yet. Check logs with: docker logs runnerhub-backend"
fi

if curl -s http://localhost:8080 > /dev/null; then
    echo "✅ Frontend dashboard is running!"
else
    echo "⚠️ Frontend might not be ready yet. Check logs with: docker logs runnerhub-frontend"
fi

echo ""
echo "🎉 GitHub-RunnerHub Installation Complete!"
echo "=========================================="
echo ""
echo "📊 Dashboard: http://192.168.1.16:8080"
echo "🔌 API: http://192.168.1.16:8300"
echo ""
echo "📋 Features Enabled:"
echo "• 1 dedicated runner per repository (always ready)"
echo "• 0-3 dynamic runners when ALL runners busy"
echo "• 5-minute idle cleanup for dynamic runners"
echo "• 30-second monitoring intervals"
echo "• Real-time WebSocket dashboard updates"
echo "• Per-repository independent scaling"
echo ""
echo "🔧 Management Commands:"
echo "• View logs: docker logs runnerhub-backend"
echo "• Restart: docker-compose -f docker-compose.production.yml restart"
echo "• Stop: docker-compose -f docker-compose.production.yml down"
echo "• Update: git pull && docker-compose -f docker-compose.production.yml up -d --build"
EOF

chmod +x "$TEMP_DIR/GitHub-RunnerHub/remote-install.sh"

# Create the deployment package
cd "$TEMP_DIR"
tar -czf "$DEPLOY_PACKAGE" GitHub-RunnerHub/

print_success "Deployment package created: $(ls -lh $DEPLOY_PACKAGE | awk '{print $5}')"

print_info "Step 4: Uploading deployment package..."
scp "$DEPLOY_PACKAGE" $SERVER:/tmp/

print_info "Step 5: Extracting and setting up on remote server..."
remote_exec "
    cd /opt
    sudo tar -xzf /tmp/runnerhub-deploy.tar.gz
    sudo chown -R \$USER:docker GitHub-RunnerHub
    cd GitHub-RunnerHub
    chmod +x remote-install.sh
    chmod +x install.sh
"

print_success "Files deployed to $SERVER:$PROJECT_DIR"

print_info "Step 6: Final setup instructions..."
echo ""
echo "🎯 Deployment Complete! Next Steps:"
echo "===================================="
echo ""
echo "1. SSH to the server:"
echo "   ssh $SERVER"
echo ""
echo "2. Navigate to project directory:"
echo "   cd $PROJECT_DIR"
echo ""
echo "3. Configure environment:"
echo "   nano .env"
echo "   # Set GITHUB_TOKEN and GITHUB_ORG"
echo ""
echo "4. Run installation:"
echo "   ./remote-install.sh"
echo ""
echo "5. Access dashboard:"
echo "   http://192.168.1.16:8080"
echo ""
echo "🔧 Quick Configuration Template:"
echo "GITHUB_TOKEN=ghp_your_github_token_here"
echo "GITHUB_ORG=anubissbe"
echo ""

# Cleanup
rm -rf "$TEMP_DIR"

print_success "✅ Deployment script completed successfully!"
print_info "The GitHub-RunnerHub with per-repository auto-scaling is ready for configuration on $SERVER"