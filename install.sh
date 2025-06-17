#!/bin/bash

# GitHub RunnerHub Installer
# Auto-scaling GitHub Actions runner management system

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
ORANGE='\033[0;33m'
NC='\033[0m' # No Color

# Banner
clear
echo -e "${ORANGE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               ║"
echo "║     ██████╗ ██╗   ██╗███╗   ██╗███╗   ██╗███████╗██████╗    ║"
echo "║     ██╔══██╗██║   ██║████╗  ██║████╗  ██║██╔════╝██╔══██╗   ║"
echo "║     ██████╔╝██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██████╔╝   ║"
echo "║     ██╔══██╗██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██╔══██╗   ║"
echo "║     ██║  ██║╚██████╔╝██║ ╚████║██║ ╚████║███████╗██║  ██║   ║"
echo "║     ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝   ║"
echo "║                                                               ║"
echo "║     ██╗  ██╗██╗   ██╗██████╗                                 ║"
echo "║     ██║  ██║██║   ██║██╔══██╗                                ║"
echo "║     ███████║██║   ██║██████╔╝                                ║"
echo "║     ██╔══██║██║   ██║██╔══██╗                                ║"
echo "║     ██║  ██║╚██████╔╝██████╔╝                                ║"
echo "║     ╚═╝  ╚═╝ ╚═════╝ ╚═════╝                                 ║"
echo "║                                                               ║"
echo "║        Dynamic GitHub Actions Runner Management               ║"
echo "║                with Auto-Scaling                              ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Function to print colored messages
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
check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        echo "Visit: https://docs.docker.com/engine/install/"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        echo "Visit: https://docs.docker.com/compose/install/"
        exit 1
    fi
    
    # Check if Docker is running
    if ! docker info &> /dev/null; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    
    print_success "All prerequisites are met!"
}

# Function to get user input with validation
get_input() {
    local prompt="$1"
    local var_name="$2"
    local default="$3"
    local secret="$4"
    
    if [ -n "$default" ]; then
        prompt="$prompt [$default]"
    fi
    
    while true; do
        if [ "$secret" = "true" ]; then
            read -s -p "$prompt: " value
            echo ""
        else
            read -p "$prompt: " value
        fi
        
        # Use default if empty
        if [ -z "$value" ] && [ -n "$default" ]; then
            value="$default"
        fi
        
        # Validate non-empty
        if [ -z "$value" ]; then
            print_error "This value cannot be empty. Please try again."
            continue
        fi
        
        eval "$var_name='$value'"
        break
    done
}

# Configuration
configure() {
    print_info "Starting configuration..."
    echo ""
    
    # GitHub Token
    echo -e "${ORANGE}GitHub Personal Access Token${NC}"
    echo "Required scopes: repo, admin:org (for organization runners)"
    echo "Create at: https://github.com/settings/tokens/new"
    get_input "GitHub Token" GITHUB_TOKEN "" "true"
    
    # GitHub Organization/User
    echo ""
    echo -e "${ORANGE}GitHub Configuration${NC}"
    get_input "GitHub Organization or Username" GITHUB_ORG "" "false"
    get_input "Repository Name" GITHUB_REPO "" "false"
    
    # Runner Configuration
    echo ""
    echo -e "${ORANGE}Runner Configuration${NC}"
    get_input "Minimum number of runners" MIN_RUNNERS "5" "false"
    get_input "Maximum number of runners" MAX_RUNNERS "50" "false"
    get_input "Scale-up threshold (0.0-1.0)" SCALE_THRESHOLD "0.8" "false"
    get_input "Runners to add when scaling" SCALE_INCREMENT "5" "false"
    
    # Port Configuration
    echo ""
    echo -e "${ORANGE}Port Configuration${NC}"
    get_input "Backend API Port" API_PORT "8300" "false"
    get_input "Dashboard UI Port" UI_PORT "8080" "false"
    
    # Advanced Configuration
    echo ""
    read -p "Configure advanced settings? (y/N): " advanced
    if [[ "$advanced" =~ ^[Yy]$ ]]; then
        echo ""
        echo -e "${ORANGE}Advanced Configuration${NC}"
        get_input "Cooldown period between scaling (seconds)" COOLDOWN_PERIOD "300" "false"
        get_input "Idle timeout before removing runners (seconds)" IDLE_TIMEOUT "1800" "false"
        get_input "Runner Docker image" RUNNER_IMAGE "myoung34/github-runner:latest" "false"
    else
        COOLDOWN_PERIOD="300"
        IDLE_TIMEOUT="1800"
        RUNNER_IMAGE="myoung34/github-runner:latest"
    fi
}

# Create environment file
create_env_file() {
    print_info "Creating environment configuration..."
    
    cat > .env << EOF
# GitHub Configuration
GITHUB_TOKEN=${GITHUB_TOKEN}
GITHUB_ORG=${GITHUB_ORG}
GITHUB_REPO=${GITHUB_REPO}

# Runner Configuration
MIN_RUNNERS=${MIN_RUNNERS}
MAX_RUNNERS=${MAX_RUNNERS}
SCALE_THRESHOLD=${SCALE_THRESHOLD}
SCALE_INCREMENT=${SCALE_INCREMENT}

# Advanced Configuration
COOLDOWN_PERIOD=${COOLDOWN_PERIOD}
IDLE_TIMEOUT=${IDLE_TIMEOUT}
RUNNER_IMAGE=${RUNNER_IMAGE}

# Port Configuration
API_PORT=${API_PORT}
UI_PORT=${UI_PORT}
PORT=${API_PORT}

# Environment
NODE_ENV=production
EOF
    
    chmod 600 .env
    print_success "Environment configuration created"
}

# Create Docker Compose file
create_docker_compose() {
    print_info "Creating Docker Compose configuration..."
    
    cat > docker-compose.yml << EOF
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: runnerhub-backend
    ports:
      - "\${API_PORT}:8300"
    environment:
      - NODE_ENV=production
      - PORT=8300
      - GITHUB_TOKEN=\${GITHUB_TOKEN}
      - GITHUB_ORG=\${GITHUB_ORG}
      - GITHUB_REPO=\${GITHUB_REPO}
      - MIN_RUNNERS=\${MIN_RUNNERS}
      - MAX_RUNNERS=\${MAX_RUNNERS}
      - SCALE_THRESHOLD=\${SCALE_THRESHOLD}
      - SCALE_INCREMENT=\${SCALE_INCREMENT}
      - COOLDOWN_PERIOD=\${COOLDOWN_PERIOD}
      - IDLE_TIMEOUT=\${IDLE_TIMEOUT}
      - RUNNER_IMAGE=\${RUNNER_IMAGE}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
    networks:
      - runnerhub

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        - VITE_API_URL=http://localhost:\${API_PORT}
        - VITE_WS_URL=ws://localhost:\${API_PORT}
    container_name: runnerhub-frontend
    ports:
      - "\${UI_PORT}:80"
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
    
    print_success "Docker Compose configuration created"
}

# Build and start services
start_services() {
    print_info "Building Docker images..."
    
    # Use docker compose or docker-compose based on what's available
    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    else
        COMPOSE_CMD="docker-compose"
    fi
    
    $COMPOSE_CMD build
    
    print_info "Starting services..."
    $COMPOSE_CMD up -d
    
    # Wait for services to be ready
    print_info "Waiting for services to be ready..."
    sleep 5
    
    # Check if services are running
    if curl -s http://localhost:${API_PORT}/health > /dev/null; then
        print_success "Backend API is running!"
    else
        print_warning "Backend API might not be ready yet. Check logs with: docker logs runnerhub-backend"
    fi
}

# Display success message
display_success() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║              🎉 Installation Complete! 🎉                     ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${ORANGE}Access your RunnerHub dashboard at:${NC}"
    echo -e "${BLUE}http://localhost:${UI_PORT}${NC}"
    echo ""
    echo -e "${ORANGE}API endpoint:${NC}"
    echo -e "${BLUE}http://localhost:${API_PORT}${NC}"
    echo ""
    echo -e "${ORANGE}Useful commands:${NC}"
    echo "• View logs:      docker logs -f runnerhub-backend"
    echo "• Stop services:  docker-compose down"
    echo "• Restart:        docker-compose restart"
    echo "• Update:         git pull && docker-compose up -d --build"
    echo ""
    echo -e "${ORANGE}Auto-scaling is now active!${NC}"
    echo "• Starting with ${MIN_RUNNERS} runners"
    echo "• Will scale up at ${SCALE_THRESHOLD}% utilization"
    echo "• Maximum of ${MAX_RUNNERS} runners"
    echo ""
}

# Main installation flow
main() {
    check_prerequisites
    configure
    create_env_file
    create_docker_compose
    start_services
    display_success
}

# Run main function
main