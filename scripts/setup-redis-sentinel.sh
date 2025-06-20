#!/bin/bash

# Redis Sentinel Setup Script for GitHub RunnerHub HA
# This script sets up Redis Sentinel cluster for high availability

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
CONFIG_DIR="$PROJECT_DIR/config"

# Default configuration
REDIS_MASTER_HOST=${REDIS_MASTER_HOST:-redis-master}
REDIS_SLAVE_HOST=${REDIS_SLAVE_HOST:-redis-slave}
REDIS_PASSWORD=${REDIS_PASSWORD:-change_me}
REDIS_MASTER_NAME=${REDIS_MASTER_NAME:-github-runnerhub-redis}
SENTINEL_QUORUM=${SENTINEL_QUORUM:-2}
SENTINEL_HOSTS=("redis-sentinel-1" "redis-sentinel-2" "redis-sentinel-3")

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
Redis Sentinel Setup Script

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --master-host HOST      Redis master host (default: redis-master)
    --slave-host HOST       Redis slave host (default: redis-slave)
    --password PASS         Redis password
    --master-name NAME      Sentinel master name (default: github-runnerhub-redis)
    --quorum NUM            Sentinel quorum (default: 2)
    --setup-master          Setup Redis master
    --setup-slave           Setup Redis slave
    --setup-sentinels       Setup Redis Sentinel cluster
    --test-failover         Test Redis failover
    --status                Show Redis and Sentinel status
    --reset                 Reset all Redis instances
    -h, --help              Show this help

EXAMPLES:
    $0 --setup-master               # Setup Redis master
    $0 --setup-slave                # Setup Redis slave
    $0 --setup-sentinels            # Setup Sentinel cluster
    $0 --test-failover              # Test failover
    $0 --status                     # Show status

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --master-host)
                REDIS_MASTER_HOST="$2"
                shift 2
                ;;
            --slave-host)
                REDIS_SLAVE_HOST="$2"
                shift 2
                ;;
            --password)
                REDIS_PASSWORD="$2"
                shift 2
                ;;
            --master-name)
                REDIS_MASTER_NAME="$2"
                shift 2
                ;;
            --quorum)
                SENTINEL_QUORUM="$2"
                shift 2
                ;;
            --setup-master)
                SETUP_MASTER=true
                shift
                ;;
            --setup-slave)
                SETUP_SLAVE=true
                shift
                ;;
            --setup-sentinels)
                SETUP_SENTINELS=true
                shift
                ;;
            --test-failover)
                TEST_FAILOVER=true
                shift
                ;;
            --status)
                SHOW_STATUS=true
                shift
                ;;
            --reset)
                RESET_ALL=true
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

# Check Redis connection
check_redis_connection() {
    local host=$1
    local port=${2:-6379}
    local password=$3
    
    info "Checking Redis connection to $host:$port..."
    
    if redis-cli -h "$host" -p "$port" -a "$password" ping > /dev/null 2>&1; then
        success "Successfully connected to Redis at $host:$port"
        return 0
    else
        # Try with docker exec if direct connection fails
        if docker exec "$host" redis-cli -a "$password" ping > /dev/null 2>&1; then
            success "Successfully connected to Redis at $host via Docker"
            return 0
        else
            error "Failed to connect to Redis at $host"
            return 1
        fi
    fi
}

# Setup Redis master
setup_redis_master() {
    header "Setting Up Redis Master"
    
    info "Configuring Redis master at $REDIS_MASTER_HOST..."
    
    # Start Redis master if not running
    if ! docker ps --format "{{.Names}}" | grep -q "^$REDIS_MASTER_HOST$"; then
        info "Starting Redis master container..."
        docker-compose up -d "$REDIS_MASTER_HOST"
        sleep 5
    fi
    
    # Configure master
    docker exec "$REDIS_MASTER_HOST" redis-cli -a "$REDIS_PASSWORD" << 'EOF'
CONFIG SET save "900 1 300 10 60 10000"
CONFIG SET appendonly yes
CONFIG SET appendfsync everysec
CONFIG REWRITE
EOF
    
    # Get master info
    info "Redis master info:"
    docker exec "$REDIS_MASTER_HOST" redis-cli -a "$REDIS_PASSWORD" INFO replication
    
    success "Redis master setup completed"
}

# Setup Redis slave
setup_redis_slave() {
    header "Setting Up Redis Slave"
    
    info "Configuring Redis slave at $REDIS_SLAVE_HOST..."
    
    # Start Redis slave if not running
    if ! docker ps --format "{{.Names}}" | grep -q "^$REDIS_SLAVE_HOST$"; then
        info "Starting Redis slave container..."
        docker-compose up -d "$REDIS_SLAVE_HOST"
        sleep 5
    fi
    
    # Configure slave to replicate from master
    docker exec "$REDIS_SLAVE_HOST" redis-cli -a "$REDIS_PASSWORD" << EOF
SLAVEOF $REDIS_MASTER_HOST 6379
CONFIG SET masterauth $REDIS_PASSWORD
CONFIG SET slave-read-only yes
CONFIG REWRITE
EOF
    
    # Wait for replication to start
    sleep 5
    
    # Check replication status
    info "Redis slave info:"
    docker exec "$REDIS_SLAVE_HOST" redis-cli -a "$REDIS_PASSWORD" INFO replication
    
    success "Redis slave setup completed"
}

# Setup Redis Sentinel cluster
setup_redis_sentinels() {
    header "Setting Up Redis Sentinel Cluster"
    
    for sentinel in "${SENTINEL_HOSTS[@]}"; do
        info "Setting up Sentinel: $sentinel"
        
        # Start Sentinel if not running
        if ! docker ps --format "{{.Names}}" | grep -q "^$sentinel$"; then
            info "Starting Sentinel container: $sentinel"
            docker-compose up -d "$sentinel"
            sleep 3
        fi
        
        # Configure Sentinel
        docker exec "$sentinel" redis-cli -p 26379 << EOF
SENTINEL MONITOR $REDIS_MASTER_NAME $REDIS_MASTER_HOST 6379 $SENTINEL_QUORUM
SENTINEL AUTH-PASS $REDIS_MASTER_NAME $REDIS_PASSWORD
SENTINEL DOWN-AFTER-MILLISECONDS $REDIS_MASTER_NAME 30000
SENTINEL PARALLEL-SYNCS $REDIS_MASTER_NAME 1
SENTINEL FAILOVER-TIMEOUT $REDIS_MASTER_NAME 180000
EOF
        
        success "Sentinel $sentinel configured"
    done
    
    # Wait for Sentinels to discover each other
    info "Waiting for Sentinels to discover each other..."
    sleep 10
    
    # Check Sentinel cluster status
    info "Checking Sentinel cluster status..."
    for sentinel in "${SENTINEL_HOSTS[@]}"; do
        echo "=== $sentinel ==="
        docker exec "$sentinel" redis-cli -p 26379 SENTINEL MASTERS
        echo
    done
    
    success "Redis Sentinel cluster setup completed"
}

# Test Redis failover
test_redis_failover() {
    header "Testing Redis Failover"
    
    info "Current master status:"
    docker exec "${SENTINEL_HOSTS[0]}" redis-cli -p 26379 SENTINEL MASTERS
    
    info "Writing test data to master..."
    docker exec "$REDIS_MASTER_HOST" redis-cli -a "$REDIS_PASSWORD" SET test_failover_key "test_value_$(date +%s)"
    
    info "Reading test data from slave..."
    TEST_VALUE=$(docker exec "$REDIS_SLAVE_HOST" redis-cli -a "$REDIS_PASSWORD" GET test_failover_key)
    echo "Test value on slave: $TEST_VALUE"
    
    warning "Initiating manual failover..."
    docker exec "${SENTINEL_HOSTS[0]}" redis-cli -p 26379 SENTINEL FAILOVER "$REDIS_MASTER_NAME"
    
    info "Waiting for failover to complete..."
    sleep 10
    
    info "New master status:"
    docker exec "${SENTINEL_HOSTS[0]}" redis-cli -p 26379 SENTINEL MASTERS
    
    info "Checking if test data is accessible on new master..."
    # Find current master
    CURRENT_MASTER=$(docker exec "${SENTINEL_HOSTS[0]}" redis-cli -p 26379 SENTINEL GET-MASTER-ADDR-BY-NAME "$REDIS_MASTER_NAME" | head -1)
    echo "Current master: $CURRENT_MASTER"
    
    success "Failover test completed"
}

# Show Redis and Sentinel status
show_redis_status() {
    header "Redis and Sentinel Status"
    
    info "Redis Master ($REDIS_MASTER_HOST) status:"
    if check_redis_connection "$REDIS_MASTER_HOST" 6379 "$REDIS_PASSWORD"; then
        docker exec "$REDIS_MASTER_HOST" redis-cli -a "$REDIS_PASSWORD" INFO replication
        echo
        docker exec "$REDIS_MASTER_HOST" redis-cli -a "$REDIS_PASSWORD" INFO server | grep "redis_version\|role\|connected_clients"
    fi
    
    echo
    info "Redis Slave ($REDIS_SLAVE_HOST) status:"
    if check_redis_connection "$REDIS_SLAVE_HOST" 6379 "$REDIS_PASSWORD"; then
        docker exec "$REDIS_SLAVE_HOST" redis-cli -a "$REDIS_PASSWORD" INFO replication
        echo
        docker exec "$REDIS_SLAVE_HOST" redis-cli -a "$REDIS_PASSWORD" INFO server | grep "redis_version\|role\|connected_clients"
    fi
    
    echo
    info "Sentinel Cluster status:"
    for sentinel in "${SENTINEL_HOSTS[@]}"; do
        echo "=== $sentinel ==="
        if docker ps --format "{{.Names}}" | grep -q "^$sentinel$"; then
            docker exec "$sentinel" redis-cli -p 26379 INFO sentinel
            echo
            docker exec "$sentinel" redis-cli -p 26379 SENTINEL MASTERS | head -20
            echo
        else
            warning "$sentinel is not running"
        fi
    done
    
    info "Monitored masters:"
    docker exec "${SENTINEL_HOSTS[0]}" redis-cli -p 26379 SENTINEL MASTERS
    
    info "Sentinel cluster members:"
    docker exec "${SENTINEL_HOSTS[0]}" redis-cli -p 26379 SENTINEL SENTINELS "$REDIS_MASTER_NAME"
}

# Reset all Redis instances
reset_redis_instances() {
    header "Resetting All Redis Instances"
    
    warning "This will stop and reset all Redis and Sentinel instances!"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Reset cancelled"
        return
    fi
    
    info "Stopping all Redis instances..."
    docker-compose stop "$REDIS_MASTER_HOST" "$REDIS_SLAVE_HOST" "${SENTINEL_HOSTS[@]}"
    
    info "Removing containers..."
    docker-compose rm -f "$REDIS_MASTER_HOST" "$REDIS_SLAVE_HOST" "${SENTINEL_HOSTS[@]}"
    
    info "Removing volumes..."
    docker volume rm -f $(docker volume ls -q | grep redis) 2>/dev/null || true
    
    success "All Redis instances reset"
}

# Create Redis notification scripts
create_notification_scripts() {
    header "Creating Notification Scripts"
    
    # Create notification script
    cat > "$PROJECT_DIR/scripts/redis-notify.sh" << 'EOF'
#!/bin/bash
# Redis Sentinel notification script

EVENT_TYPE=$1
EVENT_INSTANCE=$2
shift 2
EVENT_DETAILS="$@"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
LOG_FILE="/var/log/redis/sentinel-notifications.log"

echo "[$TIMESTAMP] $EVENT_TYPE $EVENT_INSTANCE $EVENT_DETAILS" >> "$LOG_FILE"

# Send notification (customize as needed)
case $EVENT_TYPE in
    "+sdown")
        echo "Redis instance $EVENT_INSTANCE is down (subjectively)"
        ;;
    "+odown")
        echo "Redis instance $EVENT_INSTANCE is down (objectively)"
        ;;
    "+failover-end")
        echo "Failover completed for $EVENT_INSTANCE"
        ;;
    "+switch-master")
        echo "Master switched: $EVENT_DETAILS"
        ;;
esac
EOF

    # Create reconfiguration script
    cat > "$PROJECT_DIR/scripts/redis-reconfig.sh" << 'EOF'
#!/bin/bash
# Redis Sentinel reconfiguration script

MASTER_NAME=$1
ROLE=$2
STATE=$3
FROM_IP=$4
FROM_PORT=$5
TO_IP=$6
TO_PORT=$7

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
LOG_FILE="/var/log/redis/sentinel-reconfig.log"

echo "[$TIMESTAMP] Reconfig: $MASTER_NAME $ROLE $STATE $FROM_IP:$FROM_PORT -> $TO_IP:$TO_PORT" >> "$LOG_FILE"

# Update application configuration if needed
# This script can be used to notify applications about Redis master changes
EOF

    chmod +x "$PROJECT_DIR/scripts/redis-notify.sh"
    chmod +x "$PROJECT_DIR/scripts/redis-reconfig.sh"
    
    success "Notification scripts created"
}

# Health check for Redis cluster
health_check() {
    header "Redis Cluster Health Check"
    
    local issues=0
    
    # Check Redis master
    if check_redis_connection "$REDIS_MASTER_HOST" 6379 "$REDIS_PASSWORD"; then
        success "Redis master is healthy"
    else
        error "Redis master is unhealthy"
        ((issues++))
    fi
    
    # Check Redis slave
    if check_redis_connection "$REDIS_SLAVE_HOST" 6379 "$REDIS_PASSWORD"; then
        success "Redis slave is healthy"
    else
        error "Redis slave is unhealthy"
        ((issues++))
    fi
    
    # Check Sentinels
    local healthy_sentinels=0
    for sentinel in "${SENTINEL_HOSTS[@]}"; do
        if docker exec "$sentinel" redis-cli -p 26379 ping > /dev/null 2>&1; then
            success "Sentinel $sentinel is healthy"
            ((healthy_sentinels++))
        else
            error "Sentinel $sentinel is unhealthy"
            ((issues++))
        fi
    done
    
    # Check quorum
    if [[ $healthy_sentinels -ge $SENTINEL_QUORUM ]]; then
        success "Sentinel quorum ($healthy_sentinels >= $SENTINEL_QUORUM) is satisfied"
    else
        error "Sentinel quorum ($healthy_sentinels < $SENTINEL_QUORUM) is NOT satisfied"
        ((issues++))
    fi
    
    # Overall health
    if [[ $issues -eq 0 ]]; then
        success "Redis cluster is fully healthy"
        return 0
    else
        error "Redis cluster has $issues issues"
        return 1
    fi
}

# Main execution
main() {
    echo -e "${CYAN}"
    cat << "EOF"
╔══════════════════════════════════════════════════════════════════════════════╗
║                Redis Sentinel Setup - GitHub RunnerHub HA                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    
    info "Redis Sentinel Setup Script"
    echo "Master: $REDIS_MASTER_HOST | Slave: $REDIS_SLAVE_HOST"
    echo "Sentinel Master Name: $REDIS_MASTER_NAME | Quorum: $SENTINEL_QUORUM"
    echo "Sentinels: ${SENTINEL_HOSTS[*]}"
    echo
    
    # Create notification scripts
    create_notification_scripts
    
    if [[ "${SETUP_MASTER:-false}" == "true" ]]; then
        setup_redis_master
    fi
    
    if [[ "${SETUP_SLAVE:-false}" == "true" ]]; then
        setup_redis_slave
    fi
    
    if [[ "${SETUP_SENTINELS:-false}" == "true" ]]; then
        setup_redis_sentinels
    fi
    
    if [[ "${TEST_FAILOVER:-false}" == "true" ]]; then
        test_redis_failover
    fi
    
    if [[ "${SHOW_STATUS:-false}" == "true" ]]; then
        show_redis_status
    fi
    
    if [[ "${RESET_ALL:-false}" == "true" ]]; then
        reset_redis_instances
    fi
    
    # If no specific action was requested, show help
    if [[ "${SETUP_MASTER:-false}" == "false" && "${SETUP_SLAVE:-false}" == "false" && "${SETUP_SENTINELS:-false}" == "false" && "${TEST_FAILOVER:-false}" == "false" && "${SHOW_STATUS:-false}" == "false" && "${RESET_ALL:-false}" == "false" ]]; then
        show_help
    fi
    
    # Always run health check at the end
    echo
    health_check
}

# Parse arguments and run
parse_args "$@"
main