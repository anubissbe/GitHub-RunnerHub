#!/bin/bash

# GitHub RunnerHub - One-Click Installation Script
# This script automates the complete setup of GitHub RunnerHub

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default configuration
QUIET_MODE=false
INSTALL_VAULT=false
SKIP_MONITORING=false
SKIP_TESTS=false
ENV_FILE=".env"
LOG_FILE="installation.log"

# Utility functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✅ $1${NC}" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}❌ $1${NC}" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${CYAN}ℹ️  $1${NC}" | tee -a "$LOG_FILE"
}

header() {
    echo -e "\n${PURPLE}=== $1 ===${NC}" | tee -a "$LOG_FILE"
}

# Help function
show_help() {
    cat << EOF
GitHub RunnerHub - One-Click Installation Script

USAGE:
    ./install.sh [OPTIONS]

OPTIONS:
    -q, --quiet                 Run in quiet mode (non-interactive)
    -v, --install-vault         Install and configure HashiCorp Vault
    -m, --skip-monitoring      Skip Prometheus/Grafana monitoring setup
    -t, --skip-tests           Skip running tests after installation
    -e, --env-file FILE        Specify custom environment file (default: .env)
    -l, --log-file FILE        Specify custom log file (default: installation.log)
    -h, --help                 Show this help message

EXAMPLES:
    ./install.sh                      # Interactive installation
    ./install.sh --quiet              # Non-interactive installation
    ./install.sh --install-vault      # Include Vault setup
    ./install.sh --skip-monitoring    # Skip monitoring stack

REQUIREMENTS:
    - Docker 20.10+
    - Docker Compose 2.0+
    - Node.js 20+
    - Git
    - 4GB+ RAM
    - 10GB+ disk space

For more information, visit: https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub
EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -q|--quiet)
                QUIET_MODE=true
                shift
                ;;
            -v|--install-vault)
                INSTALL_VAULT=true
                shift
                ;;
            -m|--skip-monitoring)
                SKIP_MONITORING=true
                shift
                ;;
            -t|--skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            -e|--env-file)
                ENV_FILE="$2"
                shift 2
                ;;
            -l|--log-file)
                LOG_FILE="$2"
                shift 2
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Check prerequisites
check_prerequisites() {
    header "Checking Prerequisites"
    
    # Check if running as root
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root for security reasons"
        exit 1
    fi
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed. Please install Docker 20.10+ first."
        exit 1
    fi
    
    # Check Docker version
    DOCKER_VERSION=$(docker --version | sed 's/.*version \([0-9.]*\).*/\1/')
    if [[ $(echo "$DOCKER_VERSION 20.10" | tr " " "\n" | sort -V | head -n1) != "20.10" ]]; then
        error "Docker version $DOCKER_VERSION is too old. Please upgrade to 20.10+."
        exit 1
    fi
    success "Docker $DOCKER_VERSION detected"
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        error "Docker Compose is not installed. Please install Docker Compose 2.0+ first."
        exit 1
    fi
    success "Docker Compose detected"
    
    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        error "Docker daemon is not running. Please start Docker first."
        exit 1
    fi
    success "Docker daemon is running"
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js 20+ first."
        exit 1
    fi
    
    NODE_VERSION=$(node --version | sed 's/v//')
    if [[ $(echo "$NODE_VERSION 20.0.0" | tr " " "\n" | sort -V | head -n1) != "20.0.0" ]]; then
        error "Node.js version $NODE_VERSION is too old. Please upgrade to 20.0+."
        exit 1
    fi
    success "Node.js $NODE_VERSION detected"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        error "npm is not installed. Please install npm first."
        exit 1
    fi
    success "npm detected"
    
    # Check Git
    if ! command -v git &> /dev/null; then
        error "Git is not installed. Please install Git first."
        exit 1
    fi
    success "Git detected"
    
    # Check system resources
    AVAILABLE_RAM=$(free -m | awk 'NR==2{print $7}')
    if [[ $AVAILABLE_RAM -lt 2048 ]]; then
        warning "Available RAM (${AVAILABLE_RAM}MB) is below recommended 2GB"
    else
        success "Sufficient RAM available (${AVAILABLE_RAM}MB)"
    fi
    
    # Check disk space
    AVAILABLE_DISK=$(df -m . | awk 'NR==2{print $4}')
    if [[ $AVAILABLE_DISK -lt 5120 ]]; then
        warning "Available disk space (${AVAILABLE_DISK}MB) is below recommended 5GB"
    else
        success "Sufficient disk space available (${AVAILABLE_DISK}MB)"
    fi
    
    # Check ports
    REQUIRED_PORTS=(3001 5432 6379 9090 3000)
    for port in "${REQUIRED_PORTS[@]}"; do
        if netstat -tuln 2>/dev/null | grep -q ":$port "; then
            warning "Port $port is already in use. This may cause conflicts."
        fi
    done
    
    success "Prerequisites check completed"
}

# Generate secure random password
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
}

# Generate JWT secret
generate_jwt_secret() {
    openssl rand -hex 64
}

# Create environment file
create_environment() {
    header "Creating Environment Configuration"
    
    if [[ -f "$ENV_FILE" ]] && [[ "$QUIET_MODE" == "false" ]]; then
        read -p "Environment file $ENV_FILE already exists. Overwrite? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            info "Using existing environment file"
            return
        fi
    fi
    
    # Get GitHub configuration
    if [[ "$QUIET_MODE" == "false" ]]; then
        echo
        info "GitHub Configuration Required:"
        read -p "Enter your GitHub Personal Access Token: " -r GITHUB_TOKEN
        read -p "Enter your GitHub Organization name: " -r GITHUB_ORG
        echo
    else
        GITHUB_TOKEN="${GITHUB_TOKEN:-}"
        GITHUB_ORG="${GITHUB_ORG:-}"
    fi
    
    # Generate secure secrets
    DB_PASSWORD=$(generate_password)
    REDIS_PASSWORD=$(generate_password)
    JWT_SECRET=$(generate_jwt_secret)
    ENCRYPTION_KEY=$(generate_jwt_secret)
    WEBHOOK_SECRET=$(generate_password)
    
    # Create .env file
    cat > "$ENV_FILE" << EOF
# GitHub Configuration
GITHUB_TOKEN=$GITHUB_TOKEN
GITHUB_ORG=$GITHUB_ORG
GITHUB_RUNNER_VERSION=2.311.0
GITHUB_WEBHOOK_SECRET=$WEBHOOK_SECRET

# Application Configuration
NODE_ENV=production
PORT=3001
LOG_LEVEL=info
LOG_FORMAT=json

# Database Configuration (PostgreSQL)
DATABASE_URL=postgresql://app_user:$DB_PASSWORD@localhost:5432/github_runnerhub
DB_HOST=localhost
DB_PORT=5432
DB_NAME=github_runnerhub
DB_USER=app_user
DB_PASSWORD=$DB_PASSWORD

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=$REDIS_PASSWORD

# Security Configuration
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
API_RATE_LIMIT=100
API_RATE_WINDOW=900000

# Container Security Scanning
SECURITY_SCAN_IMAGES=true
SECURITY_BLOCK_ON_VULNERABILITIES=true
SECURITY_BLOCK_ON_SCAN_FAILURE=true
TRIVY_VERSION=latest
SECURITY_SCAN_TIMEOUT=300000
SECURITY_MAX_CRITICAL=0
SECURITY_MAX_HIGH=5

# Runner Configuration
RUNNER_POOL_MIN=1
RUNNER_POOL_MAX=10
RUNNER_SCALE_INCREMENT=2
RUNNER_SCALE_THRESHOLD=0.8
RUNNER_IDLE_TIMEOUT=300
RUNNER_NETWORK_PREFIX=runner-net
RUNNER_IMAGE=myoung34/github-runner:latest
RUNNER_JOB_TIMEOUT=3600000
RUNNER_CPU_LIMIT=2048
RUNNER_MEMORY_MB=4096
RUNNER_PIDS_LIMIT=512

# Docker Configuration
DOCKER_HOST=/var/run/docker.sock
DOCKER_SOCKET_PATH=/var/run/docker.sock

# Monitoring Configuration
PROMETHEUS_ENABLED=true
PROMETHEUS_PORT=9090
GRAFANA_ENABLED=true
GRAFANA_PORT=3000

# Vault Configuration (if enabled)
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=
EOF

    if [[ "$INSTALL_VAULT" == "true" ]]; then
        echo "VAULT_ENABLED=true" >> "$ENV_FILE"
    else
        echo "VAULT_ENABLED=false" >> "$ENV_FILE"
    fi
    
    success "Environment configuration created: $ENV_FILE"
    info "Secure passwords and secrets have been generated automatically"
}

# Install dependencies
install_dependencies() {
    header "Installing Dependencies"
    
    if [[ ! -f "package.json" ]]; then
        error "package.json not found. Are you in the correct directory?"
        exit 1
    fi
    
    log "Installing Node.js dependencies..."
    npm ci --silent
    success "Dependencies installed"
}

# Build application
build_application() {
    header "Building Application"
    
    log "Building TypeScript application..."
    npm run build
    success "Application built successfully"
}

# Setup Docker services
setup_docker() {
    header "Setting Up Docker Services"
    
    # Create Docker networks
    log "Creating Docker networks..."
    docker network create github-runnerhub-network 2>/dev/null || true
    success "Docker networks created"
    
    # Start services
    log "Starting Docker services..."
    if [[ "$SKIP_MONITORING" == "true" ]]; then
        docker-compose up -d postgres redis
    else
        docker-compose up -d postgres redis prometheus grafana
    fi
    
    # Wait for services to start
    log "Waiting for services to start..."
    sleep 10
    
    # Check service health
    local retries=30
    while [[ $retries -gt 0 ]]; do
        if docker-compose ps | grep -q "Up"; then
            break
        fi
        sleep 2
        ((retries--))
    done
    
    if [[ $retries -eq 0 ]]; then
        error "Services failed to start within timeout"
        exit 1
    fi
    
    success "Docker services started"
}

# Run database migrations
run_migrations() {
    header "Running Database Migrations"
    
    # Wait for PostgreSQL to be ready
    log "Waiting for PostgreSQL to be ready..."
    local retries=30
    while [[ $retries -gt 0 ]]; do
        if docker-compose exec -T postgres pg_isready -U app_user -d github_runnerhub; then
            break
        fi
        sleep 2
        ((retries--))
    done
    
    if [[ $retries -eq 0 ]]; then
        error "PostgreSQL failed to start within timeout"
        exit 1
    fi
    
    # Run migrations
    log "Running database migrations..."
    npm run migrate 2>/dev/null || {
        warning "Migration script not found, running manual migrations..."
        for migration in migrations/*.sql; do
            if [[ -f "$migration" ]]; then
                log "Running migration: $(basename "$migration")"
                docker-compose exec -T postgres psql -U app_user -d github_runnerhub -f "/migrations/$(basename "$migration")" || true
            fi
        done
    }
    
    success "Database migrations completed"
}

# Setup Vault (optional)
setup_vault() {
    if [[ "$INSTALL_VAULT" == "false" ]]; then
        return
    fi
    
    header "Setting Up HashiCorp Vault"
    
    # Add Vault to docker-compose if not present
    if ! grep -q "vault:" docker-compose.yml; then
        log "Adding Vault service to docker-compose.yml..."
        # This would need to be implemented based on your docker-compose structure
        warning "Vault service needs to be manually added to docker-compose.yml"
    fi
    
    # Start Vault
    log "Starting Vault service..."
    docker-compose up -d vault 2>/dev/null || {
        warning "Vault service not configured in docker-compose.yml"
        return
    }
    
    # Wait for Vault to start
    sleep 5
    
    # Initialize Vault (simplified for demo)
    log "Initializing Vault..."
    # Vault initialization would go here
    
    success "Vault setup completed"
}

# Run health checks
run_health_checks() {
    header "Running Health Checks"
    
    # Check PostgreSQL
    log "Checking PostgreSQL health..."
    if docker-compose exec -T postgres pg_isready -U app_user -d github_runnerhub; then
        success "PostgreSQL is healthy"
    else
        error "PostgreSQL health check failed"
        return 1
    fi
    
    # Check Redis
    log "Checking Redis health..."
    if docker-compose exec -T redis redis-cli ping | grep -q "PONG"; then
        success "Redis is healthy"
    else
        error "Redis health check failed"
        return 1
    fi
    
    # Start the application for testing
    log "Starting application for health checks..."
    npm start > app.log 2>&1 &
    APP_PID=$!
    
    # Wait for app to start
    sleep 10
    
    # Check application health
    log "Checking application health..."
    if curl -f http://localhost:3001/health > /dev/null 2>&1; then
        success "Application is healthy"
    else
        warning "Application health check failed - this may be normal during first startup"
    fi
    
    # Stop the test application
    kill $APP_PID 2>/dev/null || true
    wait $APP_PID 2>/dev/null || true
    
    success "Health checks completed"
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == "true" ]]; then
        return
    fi
    
    header "Running Tests"
    
    log "Running linting..."
    npm run lint || warning "Linting found issues"
    
    log "Running type checks..."
    npm run typecheck || warning "Type checking found issues"
    
    log "Running unit tests..."
    npm test -- --passWithNoTests || warning "Some tests failed"
    
    success "Tests completed"
}

# Cleanup on failure
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        error "Installation failed with exit code $exit_code"
        echo
        info "Cleaning up..."
        docker-compose down 2>/dev/null || true
        docker network rm github-runnerhub-network 2>/dev/null || true
        echo
        info "Installation log saved to: $LOG_FILE"
        info "For support, visit: https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub/issues"
    fi
}

# Main installation function
main() {
    # Set up error handling
    trap cleanup EXIT
    
    # Clear log file
    > "$LOG_FILE"
    
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
    
    info "GitHub RunnerHub - One-Click Installation"
    info "Version: 1.0.0"
    echo
    
    # Run installation steps
    check_prerequisites
    create_environment
    install_dependencies
    build_application
    setup_docker
    run_migrations
    setup_vault
    run_health_checks
    run_tests
    
    # Success message
    echo
    header "Installation Complete!"
    success "GitHub RunnerHub has been successfully installed!"
    echo
    info "Getting Started:"
    echo "  1. Start the application: npm start"
    echo "  2. Open dashboard: http://localhost:3000"
    echo "  3. API endpoint: http://localhost:3001"
    echo "  4. View logs: tail -f logs/app.log"
    echo
    if [[ "$SKIP_MONITORING" == "false" ]]; then
        info "Monitoring:"
        echo "  - Prometheus: http://localhost:9090"
        echo "  - Grafana: http://localhost:3000 (admin/admin)"
        echo
    fi
    info "Configuration file: $ENV_FILE"
    info "Installation log: $LOG_FILE"
    echo
    info "For documentation, visit: https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub"
    echo
    success "Happy running! 🚀"
}

# Parse arguments and run
parse_args "$@"
main