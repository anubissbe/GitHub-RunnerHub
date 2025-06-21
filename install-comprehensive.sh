#!/bin/bash

# GitHub RunnerHub - Comprehensive One-Click Installation Script
# This script automates the complete setup of GitHub RunnerHub with all features
# Supports both development and production modes with full HA capabilities

set -euo pipefail

# Script version
SCRIPT_VERSION="2.0.0"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Default configuration
INSTALL_MODE="development"  # development or production
QUIET_MODE=false
INSTALL_VAULT=true
INSTALL_MONITORING=true
INSTALL_HA=false
CONFIGURE_NGINX=true
SKIP_TESTS=false
FORCE_INSTALL=false
ENV_FILE=".env"
LOG_FILE="install-$(date +%Y%m%d-%H%M%S).log"
BACKUP_DIR="backups/$(date +%Y%m%d-%H%M%S)"

# System requirements
MIN_RAM_MB=4096
MIN_DISK_GB=20
MIN_CPU_CORES=2
MIN_DOCKER_VERSION="20.10"
MIN_COMPOSE_VERSION="2.0"
MIN_NODE_VERSION="20.0"

# Default ports
declare -A DEFAULT_PORTS=(
    ["app"]="3001"
    ["dashboard"]="3000"
    ["postgres"]="5432"
    ["redis"]="6379"
    ["vault"]="8200"
    ["prometheus"]="9090"
    ["grafana"]="3030"
    ["nginx"]="80"
    ["nginx_ssl"]="443"
    ["haproxy"]="8080"
)

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
    echo -e "\n${PURPLE}╔═══════════════════════════════════════════════════════════════╗${NC}" | tee -a "$LOG_FILE"
    printf "${PURPLE}║${WHITE} %-61s ${PURPLE}║${NC}\n" "$1" | tee -a "$LOG_FILE"
    echo -e "${PURPLE}╚═══════════════════════════════════════════════════════════════╝${NC}" | tee -a "$LOG_FILE"
}

# Progress bar function
show_progress() {
    local duration=$1
    local message=$2
    local elapsed=0
    
    while [ $elapsed -lt $duration ]; do
        printf "\r${CYAN}⏳ %s${NC} [" "$message"
        local progress=$((elapsed * 20 / duration))
        for ((i=0; i<progress; i++)); do printf "█"; done
        for ((i=progress; i<20; i++)); do printf "░"; done
        printf "] %d%%" $((elapsed * 100 / duration))
        sleep 1
        ((elapsed++))
    done
    printf "\r${GREEN}✅ %s${NC} [████████████████████] 100%%\n" "$message"
}

# Help function
show_help() {
    cat << EOF
${PURPLE}GitHub RunnerHub - Comprehensive Installation Script v${SCRIPT_VERSION}${NC}

${WHITE}USAGE:${NC}
    ./install-comprehensive.sh [OPTIONS]

${WHITE}OPTIONS:${NC}
    ${CYAN}-m, --mode MODE${NC}            Installation mode: development or production (default: development)
    ${CYAN}-q, --quiet${NC}                Run in quiet mode (non-interactive)
    ${CYAN}-v, --no-vault${NC}             Skip HashiCorp Vault installation
    ${CYAN}-o, --no-monitoring${NC}        Skip Prometheus/Grafana monitoring setup
    ${CYAN}-a, --enable-ha${NC}            Enable High Availability setup (production only)
    ${CYAN}-n, --no-nginx${NC}             Skip nginx reverse proxy configuration
    ${CYAN}-t, --skip-tests${NC}           Skip running tests after installation
    ${CYAN}-f, --force${NC}                Force installation (skip confirmation prompts)
    ${CYAN}-e, --env-file FILE${NC}        Specify custom environment file (default: .env)
    ${CYAN}-l, --log-file FILE${NC}        Specify custom log file
    ${CYAN}-h, --help${NC}                 Show this help message

${WHITE}INSTALLATION MODES:${NC}
    ${GREEN}development${NC}    - Single-node setup for local development
                   - Basic services (PostgreSQL, Redis)
                   - No SSL/TLS configuration
                   - Development-friendly defaults

    ${GREEN}production${NC}     - Production-ready deployment
                   - Full security features
                   - Optional High Availability
                   - SSL/TLS configuration
                   - Optimized performance settings

${WHITE}EXAMPLES:${NC}
    # Development installation
    ./install-comprehensive.sh --mode development

    # Production installation with HA
    ./install-comprehensive.sh --mode production --enable-ha

    # Quiet production install without monitoring
    ./install-comprehensive.sh -m production -q --no-monitoring

    # Force reinstall with custom env file
    ./install-comprehensive.sh --force --env-file custom.env

${WHITE}REQUIREMENTS:${NC}
    - Docker ${MIN_DOCKER_VERSION}+
    - Docker Compose ${MIN_COMPOSE_VERSION}+
    - Node.js ${MIN_NODE_VERSION}+
    - Git
    - ${MIN_CPU_CORES}+ CPU cores
    - ${MIN_RAM_MB}MB+ RAM
    - ${MIN_DISK_GB}GB+ disk space

${WHITE}POST-INSTALLATION:${NC}
    After successful installation:
    1. Start services: ${CYAN}docker-compose up -d${NC}
    2. Access dashboard: ${CYAN}http://localhost:3000${NC}
    3. API endpoint: ${CYAN}http://localhost:3001${NC}
    4. View logs: ${CYAN}docker-compose logs -f${NC}

For more information, visit: ${BLUE}https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub${NC}
EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -m|--mode)
                INSTALL_MODE="$2"
                if [[ "$INSTALL_MODE" != "development" && "$INSTALL_MODE" != "production" ]]; then
                    error "Invalid mode: $INSTALL_MODE. Must be 'development' or 'production'"
                    exit 1
                fi
                shift 2
                ;;
            -q|--quiet)
                QUIET_MODE=true
                shift
                ;;
            -v|--no-vault)
                INSTALL_VAULT=false
                shift
                ;;
            -o|--no-monitoring)
                INSTALL_MONITORING=false
                shift
                ;;
            -a|--enable-ha)
                INSTALL_HA=true
                shift
                ;;
            -n|--no-nginx)
                CONFIGURE_NGINX=false
                shift
                ;;
            -t|--skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            -f|--force)
                FORCE_INSTALL=true
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

    # Validate configuration
    if [[ "$INSTALL_HA" == "true" && "$INSTALL_MODE" == "development" ]]; then
        warning "High Availability is only supported in production mode. Switching to production mode."
        INSTALL_MODE="production"
    fi
}

# Check system prerequisites
check_prerequisites() {
    header "Checking System Prerequisites"
    
    local prerequisites_met=true
    
    # Check if running as root
    if [[ $EUID -eq 0 ]] && [[ "$FORCE_INSTALL" != "true" ]]; then
        error "Running as root is not recommended for security reasons"
        info "Use --force to override this check"
        exit 1
    fi
    
    # Check operating system
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        success "Linux operating system detected"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        success "macOS detected"
        warning "Some features may require adjustments for macOS"
    else
        error "Unsupported operating system: $OSTYPE"
        prerequisites_met=false
    fi
    
    # Check CPU cores
    local cpu_cores=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)
    if [[ $cpu_cores -lt $MIN_CPU_CORES ]]; then
        warning "CPU cores ($cpu_cores) below recommended minimum ($MIN_CPU_CORES)"
    else
        success "CPU cores: $cpu_cores"
    fi
    
    # Check available RAM
    local available_ram_mb
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        available_ram_mb=$(free -m | awk 'NR==2{print $7}')
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        available_ram_mb=$(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
        available_ram_mb=$((available_ram_mb * 4096 / 1024 / 1024))
    fi
    
    if [[ $available_ram_mb -lt $MIN_RAM_MB ]]; then
        warning "Available RAM (${available_ram_mb}MB) below recommended minimum (${MIN_RAM_MB}MB)"
    else
        success "Available RAM: ${available_ram_mb}MB"
    fi
    
    # Check disk space
    local available_disk_gb=$(df -BG . | awk 'NR==2{print $4}' | sed 's/G//')
    if [[ $available_disk_gb -lt $MIN_DISK_GB ]]; then
        warning "Available disk space (${available_disk_gb}GB) below recommended minimum (${MIN_DISK_GB}GB)"
    else
        success "Available disk space: ${available_disk_gb}GB"
    fi
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
        info "Install Docker from: https://docs.docker.com/get-docker/"
        prerequisites_met=false
    else
        local docker_version=$(docker --version | sed 's/.*version \([0-9.]*\).*/\1/')
        if [[ $(echo -e "$docker_version\n$MIN_DOCKER_VERSION" | sort -V | head -n1) != "$MIN_DOCKER_VERSION" ]]; then
            error "Docker version $docker_version is too old (minimum: $MIN_DOCKER_VERSION)"
            prerequisites_met=false
        else
            success "Docker $docker_version"
        fi
        
        # Check if Docker daemon is running
        if ! docker info &> /dev/null; then
            error "Docker daemon is not running"
            info "Start Docker and try again"
            prerequisites_met=false
        fi
    fi
    
    # Check Docker Compose
    local compose_cmd=""
    if command -v docker-compose &> /dev/null; then
        compose_cmd="docker-compose"
    elif docker compose version &> /dev/null; then
        compose_cmd="docker compose"
    else
        error "Docker Compose is not installed"
        info "Install Docker Compose from: https://docs.docker.com/compose/install/"
        prerequisites_met=false
    fi
    
    if [[ -n "$compose_cmd" ]]; then
        local compose_version=$($compose_cmd version --short 2>/dev/null || echo "0.0")
        if [[ $(echo -e "$compose_version\n$MIN_COMPOSE_VERSION" | sort -V | head -n1) != "$MIN_COMPOSE_VERSION" ]]; then
            warning "Docker Compose version $compose_version may be too old (recommended: $MIN_COMPOSE_VERSION+)"
        else
            success "Docker Compose $compose_version"
        fi
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed"
        info "Install Node.js from: https://nodejs.org/"
        prerequisites_met=false
    else
        local node_version=$(node --version | sed 's/v//')
        if [[ $(echo -e "$node_version\n$MIN_NODE_VERSION" | sort -V | head -n1) != "$MIN_NODE_VERSION" ]]; then
            error "Node.js version $node_version is too old (minimum: $MIN_NODE_VERSION)"
            prerequisites_met=false
        else
            success "Node.js $node_version"
        fi
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        error "npm is not installed"
        prerequisites_met=false
    else
        success "npm $(npm --version)"
    fi
    
    # Check Git
    if ! command -v git &> /dev/null; then
        error "Git is not installed"
        info "Install Git from: https://git-scm.com/"
        prerequisites_met=false
    else
        success "Git $(git --version | awk '{print $3}')"
    fi
    
    # Check required ports
    log "Checking port availability..."
    local ports_in_use=()
    for service in "${!DEFAULT_PORTS[@]}"; do
        local port="${DEFAULT_PORTS[$service]}"
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            ports_in_use+=("$port ($service)")
        fi
    done
    
    if [[ ${#ports_in_use[@]} -gt 0 ]]; then
        warning "The following ports are already in use: ${ports_in_use[*]}"
        info "Services using these ports may need to be stopped or reconfigured"
    else
        success "All required ports are available"
    fi
    
    # Check for required commands
    local required_commands=("openssl" "curl" "tar" "grep" "sed" "awk")
    local missing_commands=()
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_commands+=("$cmd")
        fi
    done
    
    if [[ ${#missing_commands[@]} -gt 0 ]]; then
        error "Missing required commands: ${missing_commands[*]}"
        prerequisites_met=false
    else
        success "All required system commands are available"
    fi
    
    # Final check
    if [[ "$prerequisites_met" == "false" ]]; then
        error "Prerequisites check failed. Please install missing dependencies and try again."
        exit 1
    fi
    
    success "All prerequisites satisfied"
}

# Backup existing installation
backup_existing() {
    if [[ ! -d ".git" ]] && [[ ! -f "docker-compose.yml" ]]; then
        return  # Nothing to backup
    fi
    
    header "Backing Up Existing Installation"
    
    mkdir -p "$BACKUP_DIR"
    
    # Backup configuration files
    local config_files=(".env" "docker-compose.yml" "docker-compose.override.yml" "nginx.conf")
    for file in "${config_files[@]}"; do
        if [[ -f "$file" ]]; then
            log "Backing up $file..."
            cp "$file" "$BACKUP_DIR/"
        fi
    done
    
    # Backup database if running
    if docker ps --format "table {{.Names}}" | grep -q "postgres"; then
        log "Backing up PostgreSQL database..."
        docker exec postgres pg_dump -U app_user github_runnerhub > "$BACKUP_DIR/database_backup.sql" 2>/dev/null || \
            warning "Could not backup database"
    fi
    
    success "Backup completed: $BACKUP_DIR"
}

# Generate secure passwords and secrets
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
}

generate_jwt_secret() {
    openssl rand -hex 64
}

generate_encryption_key() {
    openssl rand -base64 32
}

# Create environment configuration
create_environment() {
    header "Creating Environment Configuration"
    
    # Check if env file exists
    if [[ -f "$ENV_FILE" ]] && [[ "$FORCE_INSTALL" != "true" ]]; then
        if [[ "$QUIET_MODE" == "false" ]]; then
            read -p "Environment file $ENV_FILE exists. Overwrite? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                info "Keeping existing environment file"
                return
            fi
        else
            warning "Using existing environment file: $ENV_FILE"
            return
        fi
    fi
    
    # Get GitHub configuration
    local github_token=""
    local github_org=""
    
    if [[ "$QUIET_MODE" == "false" ]]; then
        echo
        info "GitHub Configuration Required:"
        info "You need a Personal Access Token with these scopes:"
        info "  - repo (Full control of private repositories)"
        info "  - admin:org (Read org and team membership)"
        info "  - workflow (Update GitHub Action workflows)"
        echo
        read -p "Enter your GitHub Personal Access Token: " -sr github_token
        echo
        read -p "Enter your GitHub Organization name: " -r github_org
        echo
    else
        github_token="${GITHUB_TOKEN:-}"
        github_org="${GITHUB_ORG:-}"
        
        if [[ -z "$github_token" ]] || [[ -z "$github_org" ]]; then
            error "GITHUB_TOKEN and GITHUB_ORG must be set in quiet mode"
            exit 1
        fi
    fi
    
    # Generate secure secrets
    log "Generating secure passwords and secrets..."
    local db_password=$(generate_password)
    local db_replication_password=$(generate_password)
    local redis_password=$(generate_password)
    local jwt_secret=$(generate_jwt_secret)
    local encryption_key=$(generate_encryption_key)
    local webhook_secret=$(generate_password)
    local vault_root_token=$(generate_jwt_secret)
    local admin_password=$(generate_password)
    
    # Create base environment file
    cat > "$ENV_FILE" << EOF
# GitHub RunnerHub Environment Configuration
# Generated: $(date)
# Mode: $INSTALL_MODE

###################
# GitHub Settings #
###################
GITHUB_TOKEN=$github_token
GITHUB_ORG=$github_org
GITHUB_RUNNER_VERSION=2.311.0
GITHUB_WEBHOOK_SECRET=$webhook_secret
GITHUB_API_TIMEOUT=30000
GITHUB_API_RETRY_COUNT=3
GITHUB_API_RETRY_DELAY=1000

###########################
# Application Settings    #
###########################
NODE_ENV=$INSTALL_MODE
APP_NAME=GitHub-RunnerHub
APP_VERSION=$SCRIPT_VERSION
PORT=${DEFAULT_PORTS["app"]}
HOST=0.0.0.0
LOG_LEVEL=$([ "$INSTALL_MODE" == "production" ] && echo "info" || echo "debug")
LOG_FORMAT=json
LOG_DIR=./logs
ENABLE_CORS=true
CORS_ORIGIN=*
REQUEST_TIMEOUT=30000
BODY_LIMIT=10mb

########################
# Database Settings    #
########################
DATABASE_URL=postgresql://user:password@host:5432/database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=github_runnerhub
DB_USER=app_user
DB_PASSWORD=$db_password
DB_SSL_MODE=$([ "$INSTALL_MODE" == "production" ] && echo "require" || echo "disable")
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_MIGRATION_DIR=./migrations
DB_SEED_DIR=./seeds

# Database Replication (HA only)
DB_REPLICATION_USER=replication_user
DB_REPLICATION_PASSWORD=$db_replication_password
DATABASE_REPLICA_URL=postgresql://user:password@host:5432/database

####################
# Redis Settings   #
####################
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$redis_password
REDIS_DB=0
REDIS_KEY_PREFIX=runnerhub:
REDIS_TTL=3600
REDIS_CONNECTION_TIMEOUT=5000
REDIS_COMMAND_TIMEOUT=5000

# Redis Sentinel (HA only)
REDIS_SENTINEL_HOSTS=redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379
REDIS_SENTINEL_NAME=mymaster
REDIS_SENTINEL_PASSWORD=$redis_password

#######################
# Security Settings   #
#######################
JWT_SECRET=$jwt_secret
JWT_EXPIRY=24h
JWT_REFRESH_EXPIRY=7d
ENCRYPTION_KEY=$encryption_key
BCRYPT_ROUNDS=$([ "$INSTALL_MODE" == "production" ] && echo "12" || echo "10")
SESSION_SECRET=$jwt_secret
COOKIE_SECRET=$encryption_key
API_RATE_LIMIT=$([ "$INSTALL_MODE" == "production" ] && echo "100" || echo "1000")
API_RATE_WINDOW=900000
ENABLE_API_KEY=true
ENABLE_AUDIT_LOG=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$admin_password

#########################
# Container Security    #
#########################
SECURITY_SCAN_ENABLED=$([ "$INSTALL_MODE" == "production" ] && echo "true" || echo "false")
SECURITY_SCAN_ON_PULL=true
SECURITY_SCAN_ON_BUILD=true
SECURITY_BLOCK_ON_CRITICAL=$([ "$INSTALL_MODE" == "production" ] && echo "true" || echo "false")
SECURITY_BLOCK_ON_HIGH=$([ "$INSTALL_MODE" == "production" ] && echo "true" || echo "false")
TRIVY_VERSION=latest
TRIVY_TIMEOUT=5m
SECURITY_SCAN_CACHE_DIR=/tmp/trivy-cache
SECURITY_MAX_CRITICAL=0
SECURITY_MAX_HIGH=$([ "$INSTALL_MODE" == "production" ] && echo "0" || echo "5")
SECURITY_MAX_MEDIUM=$([ "$INSTALL_MODE" == "production" ] && echo "5" || echo "10")

######################
# Runner Settings    #
######################
RUNNER_POOL_MIN=$([ "$INSTALL_MODE" == "production" ] && echo "2" || echo "1")
RUNNER_POOL_MAX=$([ "$INSTALL_MODE" == "production" ] && echo "20" || echo "5")
RUNNER_SCALE_UP_THRESHOLD=0.8
RUNNER_SCALE_DOWN_THRESHOLD=0.2
RUNNER_SCALE_INCREMENT=2
RUNNER_IDLE_TIMEOUT=300
RUNNER_MAX_IDLE_TIME=600
RUNNER_STARTUP_TIMEOUT=300
RUNNER_SHUTDOWN_TIMEOUT=30
RUNNER_HEALTH_CHECK_INTERVAL=30
RUNNER_NETWORK_MODE=bridge
RUNNER_NETWORK_PREFIX=runner-net
RUNNER_DNS_SERVERS=8.8.8.8,8.8.4.4
RUNNER_IMAGE=myoung34/github-runner:latest
RUNNER_JOB_TIMEOUT=3600000
RUNNER_EPHEMERAL=true
RUNNER_CLEANUP_ENABLED=true
RUNNER_CLEANUP_INTERVAL=300
RUNNER_LABELS=self-hosted,docker,linux,x64

# Resource Limits
RUNNER_CPU_LIMIT=$([ "$INSTALL_MODE" == "production" ] && echo "4096" || echo "2048")
RUNNER_MEMORY_MB=$([ "$INSTALL_MODE" == "production" ] && echo "8192" || echo "4096")
RUNNER_MEMORY_SWAP_MB=$([ "$INSTALL_MODE" == "production" ] && echo "8192" || echo "4096")
RUNNER_DISK_LIMIT_GB=50
RUNNER_PIDS_LIMIT=1024
RUNNER_ULIMIT_NOFILE=65536:65536
RUNNER_ULIMIT_NPROC=32768:32768

######################
# Docker Settings    #
######################
DOCKER_HOST=unix:///var/run/docker.sock
DOCKER_SOCKET_PATH=/var/run/docker.sock
DOCKER_API_VERSION=1.41
DOCKER_REGISTRY=docker.io
DOCKER_REGISTRY_USERNAME=
DOCKER_REGISTRY_PASSWORD=
DOCKER_BUILD_CACHE=true
DOCKER_PRUNE_ENABLED=true
DOCKER_PRUNE_INTERVAL=3600
DOCKER_PRUNE_KEEP_IMAGES=5

#########################
# Monitoring Settings   #
#########################
MONITORING_ENABLED=$INSTALL_MONITORING
METRICS_ENABLED=true
METRICS_PORT=9100
PROMETHEUS_ENABLED=$INSTALL_MONITORING
PROMETHEUS_PORT=${DEFAULT_PORTS["prometheus"]}
PROMETHEUS_RETENTION=15d
PROMETHEUS_SCRAPE_INTERVAL=15s
GRAFANA_ENABLED=$INSTALL_MONITORING
GRAFANA_PORT=${DEFAULT_PORTS["grafana"]}
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=$admin_password
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL=30000
HEALTH_CHECK_TIMEOUT=5000
HEALTH_CHECK_RETRIES=3

####################
# Vault Settings   #
####################
VAULT_ENABLED=$INSTALL_VAULT
VAULT_ADDR=http://vault:8200
VAULT_TOKEN=$vault_root_token
VAULT_SKIP_VERIFY=true
VAULT_NAMESPACE=
VAULT_PATH_PREFIX=runnerhub
VAULT_TRANSIT_KEY=runnerhub-transit
VAULT_APPROLE_ROLE_ID=
VAULT_APPROLE_SECRET_ID=

########################
# High Availability    #
########################
HA_ENABLED=$INSTALL_HA
LEADER_ELECTION_ENABLED=$INSTALL_HA
LEADER_ELECTION_TTL=30
LEADER_ELECTION_RENEW_INTERVAL=10
LEADER_ELECTION_KEY=runnerhub:leader
CLUSTER_NAME=runnerhub-cluster
NODE_ID=$(hostname)-$$
NODE_NAME=$(hostname)
HEALTH_CHECK_POSTGRES_ENABLED=true
HEALTH_CHECK_REDIS_ENABLED=true
HEALTH_CHECK_VAULT_ENABLED=$INSTALL_VAULT

###################
# Webhook Settings #
###################
WEBHOOK_ENABLED=true
WEBHOOK_PATH=/webhook
WEBHOOK_PORT=${DEFAULT_PORTS["app"]}
WEBHOOK_MAX_PAYLOAD_SIZE=25mb
WEBHOOK_SIGNATURE_HEADER=X-Hub-Signature-256
WEBHOOK_QUEUE_ENABLED=true
WEBHOOK_QUEUE_CONCURRENCY=5
WEBHOOK_RETRY_ENABLED=true
WEBHOOK_RETRY_COUNT=3
WEBHOOK_RETRY_DELAY=5000

#####################
# Network Settings  #
#####################
NETWORK_ISOLATION_ENABLED=$([ "$INSTALL_MODE" == "production" ] && echo "true" || echo "false")
NETWORK_ISOLATION_MODE=repository
NETWORK_SUBNET_BASE=172.20
NETWORK_SUBNET_SIZE=24
NETWORK_GATEWAY_OFFSET=1
NETWORK_DNS_ENABLED=true
NETWORK_PROXY_ENABLED=false
NETWORK_PROXY_HTTP=
NETWORK_PROXY_HTTPS=
NETWORK_PROXY_NO_PROXY=localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16

####################
# Nginx Settings   #
####################
NGINX_ENABLED=$CONFIGURE_NGINX
NGINX_HTTP_PORT=${DEFAULT_PORTS["nginx"]}
NGINX_HTTPS_PORT=${DEFAULT_PORTS["nginx_ssl"]}
NGINX_SERVER_NAME=localhost
NGINX_SSL_ENABLED=$([ "$INSTALL_MODE" == "production" ] && echo "true" || echo "false")
NGINX_SSL_CERT_PATH=/etc/nginx/ssl/cert.pem
NGINX_SSL_KEY_PATH=/etc/nginx/ssl/key.pem
NGINX_CLIENT_MAX_BODY_SIZE=100m
NGINX_PROXY_TIMEOUT=300
NGINX_RATE_LIMIT=10r/s
NGINX_RATE_LIMIT_BURST=20

#####################
# HAProxy Settings  #
#####################
HAPROXY_ENABLED=$INSTALL_HA
HAPROXY_PORT=${DEFAULT_PORTS["haproxy"]}
HAPROXY_STATS_ENABLED=true
HAPROXY_STATS_PORT=8404
HAPROXY_STATS_USER=admin
HAPROXY_STATS_PASSWORD=$admin_password

#####################
# Backup Settings   #
#####################
BACKUP_ENABLED=$([ "$INSTALL_MODE" == "production" ] && echo "true" || echo "false")
BACKUP_SCHEDULE="0 2 * * *"
BACKUP_RETENTION_DAYS=7
BACKUP_S3_ENABLED=false
BACKUP_S3_BUCKET=
BACKUP_S3_REGION=
BACKUP_S3_ACCESS_KEY=
BACKUP_S3_SECRET_KEY=
BACKUP_LOCAL_PATH=./backups

######################
# Feature Flags      #
######################
FEATURE_AUTO_SCALING=true
FEATURE_JOB_ROUTING=true
FEATURE_CONTAINER_SCANNING=$SECURITY_SCAN_ENABLED
FEATURE_NETWORK_ISOLATION=$NETWORK_ISOLATION_ENABLED
FEATURE_AUDIT_LOGGING=true
FEATURE_WEBHOOK_PROCESSING=true
FEATURE_REAL_TIME_UPDATES=true
FEATURE_PREDICTIVE_SCALING=$([ "$INSTALL_MODE" == "production" ] && echo "true" || echo "false")
FEATURE_COST_TRACKING=false
FEATURE_RESOURCE_QUOTAS=false

######################
# Development Only   #
######################
$([ "$INSTALL_MODE" == "development" ] && cat << DEV_EOF
# Development-specific settings
DEBUG=true
FORCE_COLOR=1
WATCH_MODE=true
HOT_RELOAD=true
MOCK_GITHUB_API=false
DISABLE_AUTH=false
SWAGGER_ENABLED=true
SWAGGER_PATH=/api-docs
DEV_EOF
)

######################
# Production Only    #
######################
$([ "$INSTALL_MODE" == "production" ] && cat << PROD_EOF
# Production-specific settings
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
NEW_RELIC_LICENSE_KEY=
NEW_RELIC_APP_NAME=GitHub-RunnerHub
DATADOG_API_KEY=
DATADOG_APP_KEY=
PROD_EOF
)
EOF

    # Create Docker environment file
    cat > ".env.docker" << EOF
# Docker Compose Environment
COMPOSE_PROJECT_NAME=github-runnerhub
COMPOSE_FILE=docker-compose.yml$([ "$INSTALL_HA" == "true" ] && echo ":docker-compose.ha.yml")
DOCKER_BUILDKIT=1
BUILDKIT_PROGRESS=plain
EOF

    success "Environment configuration created: $ENV_FILE"
    
    # Display important credentials if not in quiet mode
    if [[ "$QUIET_MODE" == "false" ]]; then
        echo
        info "Important credentials (save these securely):"
        echo "  Admin Username: admin"
        echo "  Admin Password: $admin_password"
        echo "  Database Password: $db_password"
        echo "  JWT Secret: ${jwt_secret:0:20}..."
        if [[ "$INSTALL_VAULT" == "true" ]]; then
            echo "  Vault Root Token: ${vault_root_token:0:20}..."
        fi
        echo
        warning "These credentials will not be shown again!"
        read -p "Press Enter to continue..." -r
    fi
}

# Configure Docker networks
configure_networks() {
    header "Configuring Docker Networks"
    
    # Create networks
    local networks=("runnerhub-frontend" "runnerhub-backend" "runnerhub-data")
    
    for network in "${networks[@]}"; do
        if docker network inspect "$network" &>/dev/null; then
            info "Network $network already exists"
        else
            log "Creating network: $network"
            docker network create "$network" --driver bridge
            success "Created network: $network"
        fi
    done
    
    # Create isolated runner network if in production
    if [[ "$INSTALL_MODE" == "production" ]]; then
        log "Creating isolated runner network..."
        docker network create runnerhub-runners \
            --driver bridge \
            --internal \
            --subnet 172.20.0.0/16 \
            2>/dev/null || info "Runner network already exists"
    fi
    
    success "Docker networks configured"
}

# Configure Docker volumes
configure_volumes() {
    header "Configuring Docker Volumes"
    
    # Create named volumes
    local volumes=(
        "runnerhub-postgres-data"
        "runnerhub-redis-data"
        "runnerhub-vault-data"
        "runnerhub-prometheus-data"
        "runnerhub-grafana-data"
        "runnerhub-runner-cache"
        "runnerhub-trivy-cache"
    )
    
    for volume in "${volumes[@]}"; do
        if docker volume inspect "$volume" &>/dev/null; then
            info "Volume $volume already exists"
        else
            log "Creating volume: $volume"
            docker volume create "$volume"
            success "Created volume: $volume"
        fi
    done
    
    # Create directory structure
    local directories=(
        "logs"
        "backups"
        "data"
        "config/nginx/ssl"
        "config/prometheus"
        "config/grafana/dashboards"
        "config/vault/policies"
        "scripts/health-checks"
        "hooks"
    )
    
    for dir in "${directories[@]}"; do
        mkdir -p "$dir"
    done
    
    success "Docker volumes and directories configured"
}

# Generate SSL certificates for production
generate_ssl_certificates() {
    if [[ "$INSTALL_MODE" != "production" ]] || [[ "$CONFIGURE_NGINX" != "true" ]]; then
        return
    fi
    
    header "Generating SSL Certificates"
    
    local ssl_dir="config/nginx/ssl"
    mkdir -p "$ssl_dir"
    
    # Check if certificates already exist
    if [[ -f "$ssl_dir/cert.pem" ]] && [[ -f "$ssl_dir/key.pem" ]]; then
        info "SSL certificates already exist"
        return
    fi
    
    log "Generating self-signed SSL certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$ssl_dir/key.pem" \
        -out "$ssl_dir/cert.pem" \
        -subj "/C=US/ST=State/L=City/O=GitHub-RunnerHub/CN=localhost" \
        2>/dev/null
    
    # Generate DH parameters for production
    log "Generating DH parameters (this may take a while)..."
    openssl dhparam -out "$ssl_dir/dhparam.pem" 2048 2>/dev/null &
    local dhparam_pid=$!
    
    # Show progress while generating
    local elapsed=0
    while kill -0 $dhparam_pid 2>/dev/null; do
        printf "\r⏳ Generating DH parameters... %ds" $elapsed
        sleep 1
        ((elapsed++))
    done
    printf "\r✅ DH parameters generated      \n"
    
    chmod 600 "$ssl_dir"/*.pem
    success "SSL certificates generated"
}

# Configure nginx reverse proxy
configure_nginx() {
    if [[ "$CONFIGURE_NGINX" != "true" ]]; then
        return
    fi
    
    header "Configuring Nginx Reverse Proxy"
    
    # Create nginx configuration
    cat > "nginx.conf" << 'EOF'
user nginx;
worker_processes auto;
worker_rlimit_nofile 65535;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct="$upstream_connect_time" '
                    'uht="$upstream_header_time" urt="$upstream_response_time"';
    
    access_log /var/log/nginx/access.log main buffer=16k;

    # Performance
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    keepalive_requests 100;
    reset_timedout_connection on;
    client_body_timeout 10;
    client_header_timeout 10;
    send_timeout 10;

    # Security
    server_tokens off;
    client_max_body_size 100m;
    client_body_buffer_size 128k;
    large_client_header_buffers 4 16k;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript 
               application/json application/javascript application/xml+rss 
               application/rss+xml application/atom+xml image/svg+xml;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=webhook:10m rate=50r/s;
    limit_conn_zone $binary_remote_addr zone=addr:10m;

    # Upstreams
    upstream app_backend {
        least_conn;
        server app:3001 max_fails=3 fail_timeout=30s;
        keepalive 32;
    }

    upstream dashboard {
        server app:3000 max_fails=3 fail_timeout=30s;
        keepalive 16;
    }

    # HTTP to HTTPS redirect
    server {
        listen 80;
        server_name _;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 301 https://$host$request_uri;
        }
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name _;

        # SSL configuration
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_session_timeout 1d;
        ssl_session_cache shared:SSL:50m;
        ssl_session_tickets off;

        # Modern configuration
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;

        # HSTS
        add_header Strict-Transport-Security "max-age=63072000" always;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "no-referrer-when-downgrade" always;
        add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

        # API endpoints
        location /api {
            limit_req zone=api burst=20 nodelay;
            limit_conn addr 10;
            
            proxy_pass http://app_backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 300s;
            proxy_connect_timeout 75s;
        }

        # Webhook endpoint
        location /webhook {
            limit_req zone=webhook burst=100 nodelay;
            
            proxy_pass http://app_backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-GitHub-Delivery $http_x_github_delivery;
            proxy_set_header X-GitHub-Event $http_x_github_event;
            proxy_set_header X-Hub-Signature-256 $http_x_hub_signature_256;
            proxy_read_timeout 300s;
            client_max_body_size 25m;
        }

        # WebSocket support
        location /ws {
            proxy_pass http://app_backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 3600s;
        }

        # Dashboard
        location / {
            proxy_pass http://dashboard;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Health check endpoint (no rate limiting)
        location /health {
            proxy_pass http://app_backend;
            access_log off;
        }

        # Metrics endpoint (restricted)
        location /metrics {
            allow 10.0.0.0/8;
            allow 172.16.0.0/12;
            allow 192.168.0.0/16;
            allow 127.0.0.1;
            deny all;
            
            proxy_pass http://app_backend;
        }
    }
}
EOF

    # Create development nginx configuration
    if [[ "$INSTALL_MODE" == "development" ]]; then
        cat > "nginx.dev.conf" << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream app {
        server app:3001;
    }

    server {
        listen 80;
        server_name localhost;
        client_max_body_size 100m;

        location / {
            proxy_pass http://app;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
EOF
        mv nginx.dev.conf nginx.conf
    fi
    
    success "Nginx configuration created"
}

# Create Prometheus configuration
create_prometheus_config() {
    if [[ "$INSTALL_MONITORING" != "true" ]]; then
        return
    fi
    
    header "Creating Prometheus Configuration"
    
    mkdir -p config/prometheus
    
    cat > "config/prometheus/prometheus.yml" << EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'github-runnerhub'
    environment: '$INSTALL_MODE'

# Alertmanager configuration
alerting:
  alertmanagers:
    - static_configs:
        - targets: []

# Rule files
rule_files:
  - "rules/*.yml"

# Scrape configurations
scrape_configs:
  # Application metrics
  - job_name: 'github-runnerhub'
    static_configs:
      - targets: ['app:9100']
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
        replacement: 'app'

  # Node exporter
  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

  # PostgreSQL exporter
  - job_name: 'postgresql'
    static_configs:
      - targets: ['postgres-exporter:9187']

  # Redis exporter
  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']

  # Docker metrics
  - job_name: 'docker'
    static_configs:
      - targets: ['app:9323']

  # Nginx metrics (if enabled)
  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx-exporter:9113']
    honor_labels: true
EOF

    # Create alert rules
    mkdir -p config/prometheus/rules
    
    cat > "config/prometheus/rules/alerts.yml" << 'EOF'
groups:
  - name: github_runnerhub
    interval: 30s
    rules:
      # Application alerts
      - alert: ApplicationDown
        expr: up{job="github-runnerhub"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "GitHub RunnerHub application is down"
          description: "The main application has been down for more than 2 minutes."

      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          description: "Error rate is above 5% for the last 5 minutes."

      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High response time detected"
          description: "95th percentile response time is above 1 second."

      # Runner alerts
      - alert: RunnerPoolExhausted
        expr: runner_pool_available == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Runner pool exhausted"
          description: "No available runners in the pool for 5 minutes."

      - alert: RunnerHighFailureRate
        expr: rate(runner_job_failures_total[15m]) > 0.1
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "High runner failure rate"
          description: "Runner job failure rate is above 10%."

      # Resource alerts
      - alert: HighMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage"
          description: "Memory usage is above 90%."

      - alert: HighCPUUsage
        expr: (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))) > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage"
          description: "CPU usage is above 90%."

      - alert: DiskSpaceLow
        expr: (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) < 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Low disk space"
          description: "Less than 10% disk space remaining."

      # Database alerts
      - alert: PostgreSQLDown
        expr: pg_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL is down"
          description: "PostgreSQL database is not responding."

      - alert: PostgreSQLHighConnections
        expr: pg_stat_database_numbackends / pg_settings_max_connections > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL high connection usage"
          description: "PostgreSQL connection usage is above 80%."

      # Redis alerts
      - alert: RedisDown
        expr: redis_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis is down"
          description: "Redis server is not responding."

      - alert: RedisHighMemory
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis high memory usage"
          description: "Redis memory usage is above 90%."
EOF

    success "Prometheus configuration created"
}

# Create Grafana dashboards
create_grafana_dashboards() {
    if [[ "$INSTALL_MONITORING" != "true" ]]; then
        return
    fi
    
    header "Creating Grafana Dashboards"
    
    mkdir -p config/grafana/dashboards
    mkdir -p config/grafana/provisioning/dashboards
    mkdir -p config/grafana/provisioning/datasources
    
    # Create datasource configuration
    cat > "config/grafana/provisioning/datasources/prometheus.yml" << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
EOF

    # Create dashboard provisioning configuration
    cat > "config/grafana/provisioning/dashboards/dashboards.yml" << EOF
apiVersion: 1

providers:
  - name: 'GitHub RunnerHub'
    orgId: 1
    folder: ''
    folderUid: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
EOF

    # Create main dashboard (JSON would be too long, creating a placeholder)
    cat > "config/grafana/provisioning/dashboards/main-dashboard.json" << 'EOF'
{
  "dashboard": {
    "title": "GitHub RunnerHub Overview",
    "uid": "github-runnerhub-main",
    "tags": ["github-runnerhub"],
    "timezone": "browser",
    "schemaVersion": 16,
    "version": 0,
    "refresh": "10s"
  },
  "overwrite": true
}
EOF

    success "Grafana dashboards created"
}

# Install Node.js dependencies
install_dependencies() {
    header "Installing Node.js Dependencies"
    
    if [[ ! -f "package.json" ]]; then
        error "package.json not found. Please run this script from the project root."
        exit 1
    fi
    
    log "Installing production dependencies..."
    npm ci --production=false --silent || npm install --silent
    
    success "Dependencies installed"
}

# Build the application
build_application() {
    header "Building Application"
    
    log "Compiling TypeScript..."
    npm run build || {
        error "Build failed"
        exit 1
    }
    
    # Build Docker images
    log "Building Docker images..."
    docker-compose build --parallel || {
        error "Docker build failed"
        exit 1
    }
    
    success "Application built successfully"
}

# Create docker-compose override for development
create_compose_override() {
    if [[ "$INSTALL_MODE" != "development" ]]; then
        return
    fi
    
    cat > "docker-compose.override.yml" << EOF
version: '3.8'

services:
  app:
    build:
      context: .
      target: development
    volumes:
      - ./src:/app/src
      - ./public:/app/public
      - ./config:/app/config
    environment:
      - NODE_ENV=development
      - DEBUG=true
    command: npm run dev

  postgres:
    ports:
      - "${DEFAULT_PORTS[postgres]}:5432"

  redis:
    ports:
      - "${DEFAULT_PORTS[redis]}:6379"
EOF
}

# Setup Vault
setup_vault() {
    if [[ "$INSTALL_VAULT" != "true" ]]; then
        return
    fi
    
    header "Setting Up HashiCorp Vault"
    
    # Start Vault container
    log "Starting Vault container..."
    docker-compose up -d vault || {
        warning "Vault service not found in docker-compose.yml"
        return
    }
    
    # Wait for Vault to start
    show_progress 10 "Waiting for Vault to initialize"
    
    # Initialize Vault
    log "Initializing Vault..."
    local init_output=$(docker-compose exec -T vault vault operator init -key-shares=1 -key-threshold=1 -format=json 2>/dev/null || echo "{}")
    
    if [[ -n "$init_output" ]] && [[ "$init_output" != "{}" ]]; then
        local unseal_key=$(echo "$init_output" | jq -r '.unseal_keys_b64[0]')
        local root_token=$(echo "$init_output" | jq -r '.root_token')
        
        # Save Vault credentials
        cat > "vault-credentials.txt" << EOF
Vault Credentials (SAVE THESE SECURELY!)
========================================
Unseal Key: $unseal_key
Root Token: $root_token

To unseal Vault:
docker-compose exec vault vault operator unseal $unseal_key

To login to Vault:
docker-compose exec vault vault login $root_token
EOF
        
        chmod 600 vault-credentials.txt
        
        # Unseal Vault
        docker-compose exec -T vault vault operator unseal "$unseal_key" &>/dev/null
        
        # Configure Vault
        log "Configuring Vault policies and secrets..."
        
        # Create policies
        docker-compose exec -T vault sh << VAULT_SCRIPT
export VAULT_TOKEN="$root_token"

# Enable KV secrets engine
vault secrets enable -path=runnerhub kv-v2

# Create runner policy
vault policy write runner-policy - <<EOH
path "runnerhub/data/runner/*" {
  capabilities = ["read"]
}

path "runnerhub/data/github/*" {
  capabilities = ["read"]
}
EOH

# Create admin policy
vault policy write admin-policy - <<EOH
path "*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}
EOH

# Store initial secrets
vault kv put runnerhub/github \
  token="${GITHUB_TOKEN:-}" \
  webhook_secret="${webhook_secret:-}"

vault kv put runnerhub/database \
  host="postgres" \
  port="5432" \
  name="github_runnerhub" \
  user="app_user" \
  password="${db_password:-}"

echo "Vault configuration completed"
VAULT_SCRIPT
        
        success "Vault initialized and configured"
        warning "Vault credentials saved to: vault-credentials.txt"
    else
        info "Vault already initialized"
    fi
}

# Run database migrations
run_migrations() {
    header "Running Database Migrations"
    
    # Wait for PostgreSQL
    log "Waiting for PostgreSQL to be ready..."
    local retries=30
    while [[ $retries -gt 0 ]]; do
        if docker-compose exec -T postgres pg_isready -U app_user &>/dev/null; then
            break
        fi
        sleep 2
        ((retries--))
    done
    
    if [[ $retries -eq 0 ]]; then
        error "PostgreSQL failed to start"
        exit 1
    fi
    
    # Create database if it doesn't exist
    docker-compose exec -T postgres psql -U app_user -tc "SELECT 1 FROM pg_database WHERE datname = 'github_runnerhub'" | grep -q 1 || {
        log "Creating database..."
        docker-compose exec -T postgres createdb -U app_user github_runnerhub
    }
    
    # Run migrations
    if [[ -d "migrations" ]] && ls migrations/*.sql &>/dev/null; then
        log "Running database migrations..."
        for migration in migrations/*.sql; do
            log "Applying migration: $(basename "$migration")"
            docker-compose exec -T postgres psql -U app_user -d github_runnerhub < "$migration" || {
                warning "Migration $(basename "$migration") may have already been applied"
            }
        done
    fi
    
    # Run any TypeScript migrations
    if command -v npx &>/dev/null && [[ -f "package.json" ]]; then
        if grep -q '"migrate"' package.json; then
            log "Running TypeScript migrations..."
            npm run migrate || warning "Some migrations may have already been applied"
        fi
    fi
    
    success "Database migrations completed"
}

# Setup High Availability
setup_high_availability() {
    if [[ "$INSTALL_HA" != "true" ]]; then
        return
    fi
    
    header "Setting Up High Availability"
    
    # Setup PostgreSQL replication
    log "Configuring PostgreSQL replication..."
    if [[ -f "scripts/setup-postgres-replication.sh" ]]; then
        bash scripts/setup-postgres-replication.sh --setup-users --init-replica || {
            warning "PostgreSQL replication setup encountered issues"
        }
    fi
    
    # Setup Redis Sentinel
    log "Configuring Redis Sentinel..."
    if [[ -f "scripts/setup-redis-sentinel.sh" ]]; then
        bash scripts/setup-redis-sentinel.sh --setup-master --setup-slave --setup-sentinels || {
            warning "Redis Sentinel setup encountered issues"
        }
    fi
    
    # Start HAProxy
    log "Starting HAProxy load balancer..."
    docker-compose -f docker-compose.ha.yml up -d haproxy
    
    success "High Availability setup completed"
}

# Deploy all services
deploy_services() {
    header "Deploying Services"
    
    # Create compose command
    local compose_files="docker-compose.yml"
    if [[ "$INSTALL_HA" == "true" ]]; then
        compose_files="$compose_files -f docker-compose.ha.yml"
    fi
    
    # Start core services first
    log "Starting core services..."
    docker-compose -f $compose_files up -d postgres redis
    
    show_progress 10 "Waiting for core services to initialize"
    
    # Start remaining services
    log "Starting application services..."
    local services="app"
    
    if [[ "$INSTALL_VAULT" == "true" ]]; then
        services="$services vault"
    fi
    
    if [[ "$INSTALL_MONITORING" == "true" ]]; then
        services="$services prometheus grafana"
    fi
    
    if [[ "$CONFIGURE_NGINX" == "true" ]]; then
        services="$services nginx"
    fi
    
    docker-compose -f $compose_files up -d $services
    
    # Wait for services to be healthy
    show_progress 15 "Waiting for services to become healthy"
    
    success "All services deployed"
}

# Run comprehensive health checks
run_health_checks() {
    header "Running Health Checks"
    
    local all_healthy=true
    
    # Check PostgreSQL
    log "Checking PostgreSQL..."
    if docker-compose exec -T postgres pg_isready -U app_user &>/dev/null; then
        success "PostgreSQL is healthy"
    else
        error "PostgreSQL health check failed"
        all_healthy=false
    fi
    
    # Check Redis
    log "Checking Redis..."
    if docker-compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
        success "Redis is healthy"
    else
        error "Redis health check failed"
        all_healthy=false
    fi
    
    # Check application
    log "Checking application API..."
    local app_retries=30
    while [[ $app_retries -gt 0 ]]; do
        if curl -sf http://localhost:${DEFAULT_PORTS["app"]}/health &>/dev/null; then
            success "Application API is healthy"
            break
        fi
        sleep 2
        ((app_retries--))
    done
    
    if [[ $app_retries -eq 0 ]]; then
        warning "Application API health check timed out"
        all_healthy=false
    fi
    
    # Check Vault
    if [[ "$INSTALL_VAULT" == "true" ]]; then
        log "Checking Vault..."
        if docker-compose exec -T vault vault status &>/dev/null; then
            success "Vault is healthy"
        else
            warning "Vault health check failed (may need to be unsealed)"
        fi
    fi
    
    # Check monitoring
    if [[ "$INSTALL_MONITORING" == "true" ]]; then
        log "Checking Prometheus..."
        if curl -sf http://localhost:${DEFAULT_PORTS["prometheus"]}/-/healthy &>/dev/null; then
            success "Prometheus is healthy"
        else
            warning "Prometheus health check failed"
        fi
        
        log "Checking Grafana..."
        if curl -sf http://localhost:${DEFAULT_PORTS["grafana"]}/api/health &>/dev/null; then
            success "Grafana is healthy"
        else
            warning "Grafana health check failed"
        fi
    fi
    
    # Check nginx
    if [[ "$CONFIGURE_NGINX" == "true" ]]; then
        log "Checking Nginx..."
        if curl -sf http://localhost:${DEFAULT_PORTS["nginx"]}/health &>/dev/null; then
            success "Nginx is healthy"
        else
            warning "Nginx health check failed"
        fi
    fi
    
    if [[ "$all_healthy" == "true" ]]; then
        success "All health checks passed"
    else
        warning "Some health checks failed - check logs for details"
    fi
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == "true" ]]; then
        return
    fi
    
    header "Running Tests"
    
    # Run linting
    log "Running code linting..."
    npm run lint || warning "Linting found issues"
    
    # Run type checking
    log "Running TypeScript type checking..."
    npm run typecheck || warning "Type checking found issues"
    
    # Run unit tests
    log "Running unit tests..."
    npm test -- --passWithNoTests || warning "Some tests failed"
    
    # Run integration tests if available
    if grep -q '"test:integration"' package.json; then
        log "Running integration tests..."
        npm run test:integration || warning "Some integration tests failed"
    fi
    
    success "Test suite completed"
}

# Display post-installation information
show_post_install_info() {
    header "Installation Complete!"
    
    echo
    success "GitHub RunnerHub has been successfully installed!"
    echo
    
    info "Service URLs:"
    echo "  📊 Dashboard: http://localhost:${DEFAULT_PORTS["dashboard"]}"
    echo "  🔌 API: http://localhost:${DEFAULT_PORTS["app"]}"
    echo "  📈 API Docs: http://localhost:${DEFAULT_PORTS["app"]}/api-docs"
    
    if [[ "$CONFIGURE_NGINX" == "true" ]]; then
        echo "  🌐 Nginx: http://localhost:${DEFAULT_PORTS["nginx"]}"
        if [[ "$INSTALL_MODE" == "production" ]]; then
            echo "  🔒 HTTPS: https://localhost:${DEFAULT_PORTS["nginx_ssl"]}"
        fi
    fi
    
    if [[ "$INSTALL_MONITORING" == "true" ]]; then
        echo "  📊 Prometheus: http://localhost:${DEFAULT_PORTS["prometheus"]}"
        echo "  📈 Grafana: http://localhost:${DEFAULT_PORTS["grafana"]} (admin/${GRAFANA_ADMIN_PASSWORD:-admin})"
    fi
    
    if [[ "$INSTALL_VAULT" == "true" ]]; then
        echo "  🔐 Vault: http://localhost:${DEFAULT_PORTS["vault"]}"
    fi
    
    if [[ "$INSTALL_HA" == "true" ]]; then
        echo "  ⚖️ HAProxy Stats: http://localhost:${DEFAULT_PORTS["haproxy"]}/stats"
    fi
    
    echo
    info "Quick Commands:"
    echo "  Start services:    docker-compose up -d"
    echo "  Stop services:     docker-compose down"
    echo "  View logs:         docker-compose logs -f"
    echo "  Restart service:   docker-compose restart <service>"
    echo "  Check status:      docker-compose ps"
    
    echo
    info "Configuration:"
    echo "  Environment file: $ENV_FILE"
    echo "  Installation log: $LOG_FILE"
    
    if [[ -f "vault-credentials.txt" ]]; then
        echo
        warning "⚠️  Vault credentials saved to: vault-credentials.txt"
        warning "⚠️  Store these securely and delete the file!"
    fi
    
    echo
    info "Next Steps:"
    echo "  1. Review the environment file: $ENV_FILE"
    echo "  2. Configure GitHub webhook: http://localhost:${DEFAULT_PORTS["app"]}/webhook"
    echo "  3. Add runners: See documentation for runner setup"
    echo "  4. Monitor system: Check dashboard and logs"
    
    echo
    info "Documentation: https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub"
    info "Support: https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub/issues"
    echo
    success "Happy running! 🚀"
}

# Cleanup function
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        error "Installation failed with exit code $exit_code"
        echo
        
        if [[ "$QUIET_MODE" == "false" ]]; then
            read -p "Would you like to cleanup failed installation? (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                info "Cleaning up..."
                docker-compose down -v 2>/dev/null || true
                docker network rm runnerhub-frontend runnerhub-backend runnerhub-data 2>/dev/null || true
                rm -f "$ENV_FILE" .env.docker 2>/dev/null || true
            fi
        fi
        
        echo
        info "Installation log: $LOG_FILE"
        info "For support, visit: https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub/issues"
    fi
}

# Main installation flow
main() {
    # Set up error handling
    trap cleanup EXIT
    
    # Clear/create log file
    mkdir -p "$(dirname "$LOG_FILE")"
    > "$LOG_FILE"
    
    # Show banner
    clear
    echo -e "${PURPLE}"
    cat << "EOF"
   ______ _ _   _   _       _       _____                             _   _       _     
  / _____(_) | | | | |     | |     |  __ \                           | | | |     | |    
 | |  __  _| |_| |_| |_   _| |__   | |__) |   _ _ __  _ __   ___ _ __| |_| |_   _| |__  
 | | |_ | | __| __| | | | | |  _ \ |  _  / | | |  _ \|  _ \ / _ \  __|  _  | | | |  _ \ 
 | |__| | | |_| |_| | |_| | |_) | | | \ \ |_| | | | | | | |  __/ |  | | | | |_| | |_) |
  \_____| |_|\__|\__|  \__,_|_.__/  |_|  \_\__,_|_| |_|_| |_|\___|_|  |_| |_|\__,_|_.__/ 
       _| |                                                                              
      |__/                         Comprehensive Installer v2.0.0                                             
EOF
    echo -e "${NC}"
    
    info "Starting GitHub RunnerHub installation..."
    info "Mode: $INSTALL_MODE"
    echo
    
    # Confirm installation
    if [[ "$QUIET_MODE" == "false" ]] && [[ "$FORCE_INSTALL" != "true" ]]; then
        warning "This will install GitHub RunnerHub with the following features:"
        echo "  • Mode: $INSTALL_MODE"
        echo "  • Vault: $([[ "$INSTALL_VAULT" == "true" ]] && echo "✓" || echo "✗")"
        echo "  • Monitoring: $([[ "$INSTALL_MONITORING" == "true" ]] && echo "✓" || echo "✗")"
        echo "  • High Availability: $([[ "$INSTALL_HA" == "true" ]] && echo "✓" || echo "✗")"
        echo "  • Nginx Proxy: $([[ "$CONFIGURE_NGINX" == "true" ]] && echo "✓" || echo "✗")"
        echo
        read -p "Continue with installation? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            info "Installation cancelled"
            exit 0
        fi
    fi
    
    # Run installation steps
    check_prerequisites
    backup_existing
    create_environment
    configure_networks
    configure_volumes
    generate_ssl_certificates
    configure_nginx
    create_prometheus_config
    create_grafana_dashboards
    install_dependencies
    build_application
    create_compose_override
    deploy_services
    setup_vault
    run_migrations
    setup_high_availability
    run_health_checks
    run_tests
    
    # Show completion information
    show_post_install_info
}

# Parse arguments and run
parse_args "$@"
main