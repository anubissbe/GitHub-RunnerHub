#!/bin/bash

# Redis Sentinel Deployment Script for GitHub RunnerHub HA
# This script deploys and tests the complete Redis Sentinel cluster

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Default environment file
ENV_FILE="${PROJECT_DIR}/.env.ha"

# Utility functions
info() {
    echo -e "${CYAN}ℹ️  $1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

header() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

# Help function
show_help() {
    cat << EOF
Redis Sentinel Deployment Script

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --env-file FILE         Environment file to use (default: .env.ha)
    --deploy                Deploy Redis Sentinel cluster
    --test                  Test Redis Sentinel cluster
    --status                Show cluster status
    --failover-test         Perform failover testing
    --reset                 Reset and redeploy cluster
    --logs                  Show Redis and Sentinel logs
    --cleanup               Clean up all Redis resources
    -h, --help              Show this help

EXAMPLES:
    $0 --deploy             # Deploy Redis Sentinel cluster
    $0 --test               # Test cluster functionality
    $0 --failover-test      # Test automatic failover
    $0 --status             # Show cluster status

EOF
}

# Parse command line arguments
parse_args() {
    DEPLOY=false
    TEST=false
    STATUS=false
    FAILOVER_TEST=false
    RESET=false
    LOGS=false
    CLEANUP=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            --env-file)
                ENV_FILE="$2"
                shift 2
                ;;
            --deploy)
                DEPLOY=true
                shift
                ;;
            --test)
                TEST=true
                shift
                ;;
            --status)
                STATUS=true
                shift
                ;;
            --failover-test)
                FAILOVER_TEST=true
                shift
                ;;
            --reset)
                RESET=true
                shift
                ;;
            --logs)
                LOGS=true
                shift
                ;;
            --cleanup)
                CLEANUP=true
                shift
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

# Load environment variables
load_environment() {
    if [[ -f "$ENV_FILE" ]]; then
        info "Loading environment from $ENV_FILE"
        set -a
        source "$ENV_FILE"
        set +a
        success "Environment loaded"
    else
        warning "Environment file $ENV_FILE not found"
        if [[ -f "${PROJECT_DIR}/.env.ha.example" ]]; then
            info "Copying example environment file"
            cp "${PROJECT_DIR}/.env.ha.example" "$ENV_FILE"
            warning "Please edit $ENV_FILE with your configuration before deploying"
            exit 1
        else
            error "No environment configuration found"
            exit 1
        fi
    fi
}

# Verify prerequisites
verify_prerequisites() {
    header "Verifying Prerequisites"
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
        exit 1
    fi
    success "Docker is available"
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose is not installed"
        exit 1
    fi
    success "Docker Compose is available"
    
    # Check Redis CLI
    if ! command -v redis-cli &> /dev/null; then
        warning "Redis CLI not found, installing via Docker"
    else
        success "Redis CLI is available"
    fi
    
    # Check environment variables
    local required_vars=(
        "REDIS_PASSWORD"
        "REDIS_MASTER_NAME"
        "REDIS_SENTINEL_HOSTS"
    )
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            error "Required environment variable $var is not set"
            exit 1
        fi
    done
    success "Required environment variables are set"
}

# Deploy Redis Sentinel cluster
deploy_cluster() {
    header "Deploying Redis Sentinel Cluster"
    
    info "Starting Redis master and slave..."
    docker-compose -f "${PROJECT_DIR}/docker-compose.ha.yml" up -d redis-master redis-slave
    
    # Wait for Redis instances to be ready
    info "Waiting for Redis instances to be ready..."
    sleep 10
    
    # Check Redis master
    if docker exec runnerhub-redis-master redis-cli -a "$REDIS_PASSWORD" ping | grep -q "PONG"; then
        success "Redis master is ready"
    else
        error "Redis master failed to start"
        return 1
    fi
    
    # Check Redis slave
    if docker exec runnerhub-redis-slave redis-cli -a "$REDIS_PASSWORD" ping | grep -q "PONG"; then
        success "Redis slave is ready"
    else
        error "Redis slave failed to start"
        return 1
    fi
    
    # Configure slave replication
    info "Configuring slave replication..."
    docker exec runnerhub-redis-slave redis-cli -a "$REDIS_PASSWORD" \
        SLAVEOF redis-master 6379
    docker exec runnerhub-redis-slave redis-cli -a "$REDIS_PASSWORD" \
        CONFIG SET masterauth "$REDIS_PASSWORD"
    
    # Start Sentinel instances
    info "Starting Redis Sentinel instances..."
    docker-compose -f "${PROJECT_DIR}/docker-compose.ha.yml" up -d redis-sentinel-1 redis-sentinel-2 redis-sentinel-3
    
    # Wait for Sentinels to be ready
    info "Waiting for Sentinels to be ready..."
    sleep 15
    
    # Check Sentinel instances
    local sentinels=("redis-sentinel-1" "redis-sentinel-2" "redis-sentinel-3")
    for sentinel in "${sentinels[@]}"; do
        if docker exec "runnerhub-${sentinel}" redis-cli -p 26379 ping | grep -q "PONG"; then
            success "Sentinel $sentinel is ready"
        else
            error "Sentinel $sentinel failed to start"
            return 1
        fi
    done
    
    # Configure Sentinels
    info "Configuring Sentinel cluster..."
    for sentinel in "${sentinels[@]}"; do
        docker exec "runnerhub-${sentinel}" redis-cli -p 26379 << EOF
SENTINEL MONITOR $REDIS_MASTER_NAME redis-master 6379 2
SENTINEL AUTH-PASS $REDIS_MASTER_NAME $REDIS_PASSWORD
SENTINEL DOWN-AFTER-MILLISECONDS $REDIS_MASTER_NAME 30000
SENTINEL PARALLEL-SYNCS $REDIS_MASTER_NAME 1
SENTINEL FAILOVER-TIMEOUT $REDIS_MASTER_NAME 180000
EOF
    done
    
    success "Redis Sentinel cluster deployed successfully"
}

# Test Redis Sentinel cluster
test_cluster() {
    header "Testing Redis Sentinel Cluster"
    
    # Test basic connectivity
    info "Testing Redis master connectivity..."
    if docker exec runnerhub-redis-master redis-cli -a "$REDIS_PASSWORD" ping | grep -q "PONG"; then
        success "Redis master is responding"
    else
        error "Redis master is not responding"
        return 1
    fi
    
    info "Testing Redis slave connectivity..."
    if docker exec runnerhub-redis-slave redis-cli -a "$REDIS_PASSWORD" ping | grep -q "PONG"; then
        success "Redis slave is responding"
    else
        error "Redis slave is not responding"
        return 1
    fi
    
    # Test replication
    info "Testing replication..."
    local test_key="test_replication_$(date +%s)"
    local test_value="test_value_$(date +%s)"
    
    docker exec runnerhub-redis-master redis-cli -a "$REDIS_PASSWORD" SET "$test_key" "$test_value"
    sleep 2
    
    local slave_value=$(docker exec runnerhub-redis-slave redis-cli -a "$REDIS_PASSWORD" GET "$test_key")
    if [[ "$slave_value" == "$test_value" ]]; then
        success "Replication is working correctly"
    else
        error "Replication is not working (expected: $test_value, got: $slave_value)"
        return 1
    fi
    
    # Test Sentinel discovery
    info "Testing Sentinel discovery..."
    local sentinels=("redis-sentinel-1" "redis-sentinel-2" "redis-sentinel-3")
    for sentinel in "${sentinels[@]}"; do
        info "Checking Sentinel $sentinel..."
        local master_info=$(docker exec "runnerhub-${sentinel}" redis-cli -p 26379 \
            SENTINEL GET-MASTER-ADDR-BY-NAME "$REDIS_MASTER_NAME")
        
        if [[ -n "$master_info" ]]; then
            success "Sentinel $sentinel knows about master"
        else
            error "Sentinel $sentinel does not know about master"
            return 1
        fi
    done
    
    # Test application connectivity
    info "Testing application Redis connectivity..."
    if command -v node &> /dev/null; then
        cd "$PROJECT_DIR"
        if npm run test:redis &> /dev/null; then
            success "Application can connect to Redis via Sentinel"
        else
            warning "Application Redis connectivity test not available"
        fi
    fi
    
    success "All Redis Sentinel cluster tests passed"
}

# Show cluster status
show_status() {
    header "Redis Sentinel Cluster Status"
    
    info "Redis Master Status:"
    if docker ps --filter "name=runnerhub-redis-master" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -q "runnerhub-redis-master"; then
        docker exec runnerhub-redis-master redis-cli -a "$REDIS_PASSWORD" INFO replication
        echo
    else
        error "Redis master is not running"
    fi
    
    info "Redis Slave Status:"
    if docker ps --filter "name=runnerhub-redis-slave" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -q "runnerhub-redis-slave"; then
        docker exec runnerhub-redis-slave redis-cli -a "$REDIS_PASSWORD" INFO replication
        echo
    else
        error "Redis slave is not running"
    fi
    
    info "Sentinel Cluster Status:"
    local sentinels=("redis-sentinel-1" "redis-sentinel-2" "redis-sentinel-3")
    for sentinel in "${sentinels[@]}"; do
        echo "=== $sentinel ==="
        if docker ps --filter "name=runnerhub-${sentinel}" --format "table {{.Names}}\t{{.Status}}" | grep -q "runnerhub-${sentinel}"; then
            docker exec "runnerhub-${sentinel}" redis-cli -p 26379 SENTINEL MASTERS | head -20
            echo
        else
            error "Sentinel $sentinel is not running"
        fi
    done
    
    info "Docker Container Status:"
    docker ps --filter "name=runnerhub-redis" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

# Perform failover test
failover_test() {
    header "Redis Failover Testing"
    
    warning "This test will intentionally cause a Redis master failure"
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Failover test cancelled"
        return
    fi
    
    # Get current master
    info "Identifying current master..."
    local current_master=$(docker exec runnerhub-redis-sentinel-1 redis-cli -p 26379 \
        SENTINEL GET-MASTER-ADDR-BY-NAME "$REDIS_MASTER_NAME" | head -1)
    info "Current master: $current_master"
    
    # Write test data
    info "Writing test data to master..."
    local test_key="failover_test_$(date +%s)"
    local test_value="failover_value_$(date +%s)"
    docker exec runnerhub-redis-master redis-cli -a "$REDIS_PASSWORD" SET "$test_key" "$test_value"
    
    # Simulate master failure
    info "Simulating master failure..."
    docker pause runnerhub-redis-master
    
    # Wait for failover
    info "Waiting for Sentinel failover (this may take up to 30 seconds)..."
    sleep 35
    
    # Check new master
    info "Checking new master..."
    local new_master=$(docker exec runnerhub-redis-sentinel-1 redis-cli -p 26379 \
        SENTINEL GET-MASTER-ADDR-BY-NAME "$REDIS_MASTER_NAME" | head -1)
    info "New master: $new_master"
    
    if [[ "$current_master" != "$new_master" ]]; then
        success "Failover completed successfully"
        
        # Test data accessibility
        info "Testing data accessibility on new master..."
        if [[ "$new_master" == "redis-slave" ]]; then
            local retrieved_value=$(docker exec runnerhub-redis-slave redis-cli -a "$REDIS_PASSWORD" GET "$test_key")
            if [[ "$retrieved_value" == "$test_value" ]]; then
                success "Test data is accessible on new master"
            else
                error "Test data is not accessible on new master"
            fi
        fi
    else
        error "Failover did not occur"
    fi
    
    # Restore original master
    info "Restoring original master..."
    docker unpause runnerhub-redis-master
    sleep 10
    
    # Reconfigure as slave
    info "Reconfiguring original master as slave..."
    docker exec runnerhub-redis-master redis-cli -a "$REDIS_PASSWORD" \
        SLAVEOF "$new_master" 6379
    
    success "Failover test completed"
}

# Show logs
show_logs() {
    header "Redis and Sentinel Logs"
    
    info "Redis Master Logs:"
    docker logs runnerhub-redis-master --tail 50
    echo
    
    info "Redis Slave Logs:"
    docker logs runnerhub-redis-slave --tail 50
    echo
    
    info "Sentinel Logs:"
    local sentinels=("redis-sentinel-1" "redis-sentinel-2" "redis-sentinel-3")
    for sentinel in "${sentinels[@]}"; do
        echo "=== $sentinel ==="
        docker logs "runnerhub-${sentinel}" --tail 30
        echo
    done
}

# Reset cluster
reset_cluster() {
    header "Resetting Redis Sentinel Cluster"
    
    warning "This will stop and remove all Redis containers and volumes"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Reset cancelled"
        return
    fi
    
    info "Stopping Redis services..."
    docker-compose -f "${PROJECT_DIR}/docker-compose.ha.yml" stop \
        redis-master redis-slave redis-sentinel-1 redis-sentinel-2 redis-sentinel-3
    
    info "Removing containers..."
    docker-compose -f "${PROJECT_DIR}/docker-compose.ha.yml" rm -f \
        redis-master redis-slave redis-sentinel-1 redis-sentinel-2 redis-sentinel-3
    
    info "Removing volumes..."
    docker volume rm -f $(docker volume ls -q | grep redis) 2>/dev/null || true
    
    success "Redis cluster reset completed"
    
    if [[ "$DEPLOY" == "true" ]]; then
        info "Redeploying cluster..."
        deploy_cluster
    fi
}

# Cleanup all resources
cleanup_all() {
    header "Cleaning Up All Redis Resources"
    
    warning "This will remove ALL Redis-related containers, volumes, and networks"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Cleanup cancelled"
        return
    fi
    
    info "Stopping all Redis containers..."
    docker stop $(docker ps -q --filter "name=redis") 2>/dev/null || true
    
    info "Removing all Redis containers..."
    docker rm -f $(docker ps -aq --filter "name=redis") 2>/dev/null || true
    
    info "Removing Redis volumes..."
    docker volume rm -f $(docker volume ls -q | grep redis) 2>/dev/null || true
    
    info "Removing Redis images (optional)..."
    docker rmi $(docker images -q redis) 2>/dev/null || true
    
    success "Cleanup completed"
}

# Main execution
main() {
    echo -e "${CYAN}"
    cat << "EOF"
╔══════════════════════════════════════════════════════════════════════════════╗
║              Redis Sentinel Deployment - GitHub RunnerHub HA                ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    
    if [[ "$CLEANUP" == "true" ]]; then
        cleanup_all
        return
    fi
    
    load_environment
    verify_prerequisites
    
    if [[ "$RESET" == "true" ]]; then
        reset_cluster
    elif [[ "$DEPLOY" == "true" ]]; then
        deploy_cluster
    fi
    
    if [[ "$TEST" == "true" ]]; then
        test_cluster
    fi
    
    if [[ "$FAILOVER_TEST" == "true" ]]; then
        failover_test
    fi
    
    if [[ "$STATUS" == "true" ]]; then
        show_status
    fi
    
    if [[ "$LOGS" == "true" ]]; then
        show_logs
    fi
    
    # If no specific action was requested, show status
    if [[ "$DEPLOY" == "false" && "$TEST" == "false" && "$STATUS" == "false" && "$FAILOVER_TEST" == "false" && "$RESET" == "false" && "$LOGS" == "false" ]]; then
        show_help
    fi
}

# Parse arguments and run
parse_args "$@"
main