#!/bin/bash

# Create a complete deployment package for GitHub-RunnerHub
# This package can be transferred to any server for installation

set -e

echo "📦 Creating GitHub-RunnerHub Deployment Package"
echo "==============================================="

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

# Create deployment directory
DEPLOY_DIR="github-runnerhub-deployment-$(date +%Y%m%d-%H%M%S)"
DEPLOY_PACKAGE="${DEPLOY_DIR}.tar.gz"

print_info "Creating deployment directory: $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

# Copy essential files
print_info "Copying project files..."
cp -r backend "$DEPLOY_DIR/"
cp -r frontend "$DEPLOY_DIR/"
cp docker-compose.yml "$DEPLOY_DIR/"
cp .env.example "$DEPLOY_DIR/"
cp README.md "$DEPLOY_DIR/"
cp IMPLEMENTATION_COMPLETE_SUMMARY.md "$DEPLOY_DIR/"

# Create production docker-compose file
print_info "Creating production Docker Compose configuration..."
cat > "$DEPLOY_DIR/docker-compose.production.yml" << 'EOF'
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

# Create deployment-specific installation script
print_info "Creating deployment installation script..."
cat > "$DEPLOY_DIR/install-production.sh" << 'EOF'
#!/bin/bash

set -e

echo "🚀 GitHub-RunnerHub Production Installation"
echo "=========================================="
echo ""
echo "📋 Per-Repository Auto-Scaling Features:"
echo "• 1 dedicated runner per repository (always ready)"
echo "• 0-3 dynamic runners when ALL runners busy"
echo "• 5-minute idle cleanup for dynamic runners"
echo "• 30-second monitoring intervals"
echo "• Real-time WebSocket dashboard updates"
echo "• Independent per-repository scaling"
echo ""

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

# Check prerequisites
print_info "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    echo "Visit: https://docs.docker.com/engine/install/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    echo "Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

if ! docker info &> /dev/null; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

print_success "All prerequisites met!"

# Check if environment file exists
if [ ! -f .env ]; then
    print_info "Creating .env file from template..."
    cp .env.example .env
    
    print_warning "Configuration required!"
    echo ""
    echo "Please edit the .env file and configure:"
    echo "1. GITHUB_TOKEN=your_github_personal_access_token"
    echo "2. GITHUB_ORG=your_github_organization_or_username"
    echo ""
    echo "Required GitHub token scopes: 'repo' and 'admin:org'"
    echo "Create token at: https://github.com/settings/tokens/new"
    echo ""
    echo "After configuration, run this script again."
    exit 0
fi

# Source environment variables
source .env

# Validate configuration
if [ -z "$GITHUB_TOKEN" ] || [ "$GITHUB_TOKEN" = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" ]; then
    print_error "GITHUB_TOKEN is not configured in .env file"
    echo "Please edit .env and set your GitHub Personal Access Token"
    exit 1
fi

if [ -z "$GITHUB_ORG" ] || [ "$GITHUB_ORG" = "your-github-username" ]; then
    print_error "GITHUB_ORG is not configured in .env file"
    echo "Please edit .env and set your GitHub organization/username"
    exit 1
fi

print_success "Environment configured for organization: $GITHUB_ORG"

# Stop any existing installation
print_info "Stopping any existing RunnerHub services..."
docker-compose -f docker-compose.production.yml down 2>/dev/null || true

# Clean up any existing containers
docker container prune -f || true

# Build and start services
print_info "Building and starting GitHub-RunnerHub services..."
docker-compose -f docker-compose.production.yml up -d --build

print_info "Waiting for services to be ready..."
sleep 15

# Health checks
print_info "Performing health checks..."

BACKEND_HEALTHY=false
FRONTEND_HEALTHY=false

# Check backend
for i in {1..10}; do
    if curl -s http://localhost:8300/health > /dev/null; then
        BACKEND_HEALTHY=true
        break
    fi
    sleep 2
done

# Check frontend
for i in {1..5}; do
    if curl -s http://localhost:8080 > /dev/null; then
        FRONTEND_HEALTHY=true
        break
    fi
    sleep 2
done

# Report status
echo ""
echo "🎉 GitHub-RunnerHub Installation Complete!"
echo "=========================================="
echo ""

if [ "$BACKEND_HEALTHY" = true ]; then
    print_success "✅ Backend API is running and healthy"
else
    print_warning "⚠️ Backend API might not be ready yet"
    echo "   Check logs with: docker logs runnerhub-backend"
fi

if [ "$FRONTEND_HEALTHY" = true ]; then
    print_success "✅ Frontend dashboard is running and accessible"
else
    print_warning "⚠️ Frontend might not be ready yet"
    echo "   Check logs with: docker logs runnerhub-frontend"
fi

echo ""
echo "🔗 Access URLs:"
echo "• Dashboard: http://$(hostname -I | awk '{print $1}'):8080"
echo "• API: http://$(hostname -I | awk '{print $1}'):8300"
echo "• Health Check: http://$(hostname -I | awk '{print $1}'):8300/health"
echo ""

echo "📊 Auto-Scaling Status:"
curl -s http://localhost:8300/health | python3 -m json.tool 2>/dev/null || echo "Run 'curl http://localhost:8300/health' to check status"

echo ""
echo "🔧 Management Commands:"
echo "• View backend logs: docker logs -f runnerhub-backend"
echo "• View frontend logs: docker logs -f runnerhub-frontend"
echo "• Restart services: docker-compose -f docker-compose.production.yml restart"
echo "• Stop services: docker-compose -f docker-compose.production.yml down"
echo "• View all containers: docker ps"
echo ""

echo "🚀 Per-Repository Auto-Scaler is now active!"
echo "• Monitoring repositories: $GITHUB_ORG"
echo "• Check dashboard for real-time scaling events"
echo "• Each repository will maintain 1 dedicated + 0-3 dynamic runners"
EOF

chmod +x "$DEPLOY_DIR/install-production.sh"

# Create cleanup script
print_info "Creating cleanup script..."
cat > "$DEPLOY_DIR/cleanup.sh" << 'EOF'
#!/bin/bash

echo "🧹 Cleaning up GitHub-RunnerHub installation..."

# Stop all services
docker-compose -f docker-compose.production.yml down

# Remove containers
docker container prune -f

# Remove images (optional - comment out if you want to keep images)
# docker image prune -f

echo "✅ Cleanup complete"
EOF

chmod +x "$DEPLOY_DIR/cleanup.sh"

# Create README for deployment
print_info "Creating deployment README..."
cat > "$DEPLOY_DIR/DEPLOYMENT_README.md" << 'EOF'
# GitHub-RunnerHub Deployment Package

## 🚀 Quick Installation

1. **Extract the package:**
   ```bash
   tar -xzf github-runnerhub-deployment-*.tar.gz
   cd github-runnerhub-deployment-*
   ```

2. **Run the installer:**
   ```bash
   ./install-production.sh
   ```

3. **Configure environment (first run):**
   - Edit `.env` file with your GitHub token and organization
   - Run installer again: `./install-production.sh`

4. **Access dashboard:**
   - Open: `http://your-server-ip:8080`

## 📋 Per-Repository Auto-Scaling Features

✅ **1 dedicated runner per repository** (always maintained)
✅ **0-3 dynamic runners per repository** (spawned when ALL runners busy)  
✅ **5-minute idle cleanup** for dynamic runners only
✅ **30-second monitoring intervals**
✅ **Real-time WebSocket dashboard updates**
✅ **Independent per-repository scaling**

## 🔧 Configuration

### Required Environment Variables (.env)
```bash
GITHUB_TOKEN=ghp_your_github_token_here
GITHUB_ORG=your_github_organization
```

### GitHub Token Requirements
- **Scopes needed:** `repo` and `admin:org`
- **Create at:** https://github.com/settings/tokens/new

## 🖥️ Service Management

### Start Services
```bash
docker-compose -f docker-compose.production.yml up -d
```

### Stop Services  
```bash
docker-compose -f docker-compose.production.yml down
```

### View Logs
```bash
# Backend logs
docker logs -f runnerhub-backend

# Frontend logs  
docker logs -f runnerhub-frontend
```

### Health Check
```bash
curl http://localhost:8300/health
```

## 🔗 Access Points

- **Dashboard:** http://your-server-ip:8080
- **API:** http://your-server-ip:8300  
- **Health:** http://your-server-ip:8300/health

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│ GitHub-RunnerHub (Per-Repository Auto-Scaling) │
├─────────────────────────────────────────────────┤
│ Frontend (React + Vite)    │ Port 8080          │
│ Backend (Node.js + Express)│ Port 8300          │
│ Per-Repository Scaler      │ Auto-scaling logic │
│ WebSocket Server           │ Real-time updates  │
└─────────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │ Docker Socket Access    │
        │ (Runner Management)     │
        └─────────────────────────┘
                     │
   ┌─────────────────┼─────────────────┐
   │                 │                 │
┌──▼──┐         ┌───▼───┐         ┌───▼───┐
│🏃 R1│         │🏃 R2  │         │🏃 R3  │
│Repo1│         │Repo2  │         │Repo3  │
└─────┘         └───────┘         └───────┘
   │               │                 │
┌──▼──┐         ┌───▼───┐         ┌───▼───┐
│⚡ D1│         │⚡ D2  │         │⚡ D3  │
│Dyn 1│         │Dyn 2  │         │Dyn 3  │
└─────┘         └───────┘         └───────┘
```

## 🎯 Auto-Scaling Behavior

### Normal State
- Each repository: 1 dedicated runner (idle)

### Heavy Load (4+ workflows for one repo)
- Repository scales: 1 dedicated + 3 dynamic runners
- Other repositories: unaffected (independent scaling)

### After Load (workflows complete + 5 minutes)
- Dynamic runners: automatically removed
- Dedicated runners: always maintained

## 🧹 Cleanup

To completely remove the installation:
```bash
./cleanup.sh
```

## 🆘 Troubleshooting

### Port Already in Use
```bash
# Check what's using the port
sudo lsof -i :8300
sudo lsof -i :8080

# Kill processes if needed
sudo pkill -f runnerhub
```

### Docker Issues
```bash
# Restart Docker
sudo systemctl restart docker

# Check Docker status
docker info
```

### GitHub API Issues
```bash
# Test API connectivity
curl -H "Authorization: token YOUR_GITHUB_TOKEN" \
     https://api.github.com/user
```

---

**Implementation Status:** ✅ README-Compliant ✅ Production-Ready ✅ Tested
EOF

# Create the final package
print_info "Creating deployment package..."
tar -czf "$DEPLOY_PACKAGE" "$DEPLOY_DIR/"

# Display results
print_success "✅ Deployment package created successfully!"
echo ""
echo "📦 Package Details:"
echo "   File: $DEPLOY_PACKAGE"
echo "   Size: $(ls -lh $DEPLOY_PACKAGE | awk '{print $5}')"
echo ""
echo "📋 Package Contents:"
echo "   • Complete backend and frontend code"
echo "   • Production Docker Compose configuration"
echo "   • Installation and setup scripts"
echo "   • Cleanup utilities"
echo "   • Comprehensive documentation"
echo ""
echo "🚀 Deployment Instructions:"
echo "1. Transfer $DEPLOY_PACKAGE to target server (192.168.1.16)"
echo "2. Extract: tar -xzf $DEPLOY_PACKAGE"
echo "3. Run: cd $DEPLOY_DIR && ./install-production.sh"
echo "4. Configure GitHub token in .env file"
echo "5. Run installer again: ./install-production.sh"
echo "6. Access dashboard: http://192.168.1.16:8080"
echo ""

# Cleanup
rm -rf "$DEPLOY_DIR"

print_success "🎉 Ready for deployment to 192.168.1.16!"