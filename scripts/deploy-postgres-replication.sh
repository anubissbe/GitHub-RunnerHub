#!/bin/bash

# PostgreSQL Replication Deployment Script for GitHub RunnerHub HA
# This script provides complete PostgreSQL primary/replica deployment and management

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
PostgreSQL Replication Deployment Script

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --env-file FILE         Environment file to use (default: .env.ha)
    --deploy                Deploy PostgreSQL replication cluster
    --setup-users           Setup replication users and permissions
    --init-replica          Initialize replica from primary backup
    --test                  Test replication functionality
    --status                Show replication status and health
    --failover-test         Test manual failover procedures
    --reset                 Reset and redeploy cluster
    --backup                Create full backup of primary
    --restore FILE          Restore from backup file
    --monitoring            Setup monitoring and alerting
    --cleanup               Clean up all PostgreSQL resources
    -h, --help              Show this help

EXAMPLES:
    $0 --deploy             # Deploy complete replication setup
    $0 --test               # Test replication functionality
    $0 --failover-test      # Test failover procedures
    $0 --status             # Show detailed status

EOF
}

# Parse command line arguments
parse_args() {
    DEPLOY=false
    SETUP_USERS=false
    INIT_REPLICA=false
    TEST=false
    STATUS=false
    FAILOVER_TEST=false
    RESET=false
    BACKUP=false
    RESTORE=false
    MONITORING=false
    CLEANUP=false
    RESTORE_FILE=""

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
            --setup-users)
                SETUP_USERS=true
                shift
                ;;
            --init-replica)
                INIT_REPLICA=true
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
            --backup)
                BACKUP=true
                shift
                ;;
            --restore)
                RESTORE=true
                RESTORE_FILE="$2"
                shift 2
                ;;
            --monitoring)
                MONITORING=true
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
    
    # Check PostgreSQL client tools
    if ! command -v psql &> /dev/null; then
        warning "PostgreSQL client tools not found, using Docker client"
    else
        success "PostgreSQL client tools are available"
    fi
    
    # Check environment variables
    local required_vars=(
        "DB_PASSWORD"
        "REPLICATION_PASSWORD"
        "DB_USER"
        "REPLICATION_USER"
    )
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            error "Required environment variable $var is not set"
            exit 1
        fi
    done
    success "Required environment variables are set"
}

# Deploy PostgreSQL replication cluster
deploy_cluster() {
    header "Deploying PostgreSQL Replication Cluster"
    
    info "Starting PostgreSQL primary..."
    docker-compose -f "${PROJECT_DIR}/docker-compose.ha.yml" up -d postgres-primary
    
    # Wait for primary to be ready
    info "Waiting for primary PostgreSQL to be ready..."
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if docker exec runnerhub-postgres-primary pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
            success "Primary PostgreSQL is ready"
            break
        fi
        
        if [[ $attempt -eq $max_attempts ]]; then
            error "Primary PostgreSQL failed to start within timeout"
            return 1
        fi
        
        info "Attempt $attempt/$max_attempts - waiting for PostgreSQL..."
        sleep 5
        ((attempt++))
    done
    
    # Setup replication users and configuration
    info "Setting up replication users and configuration..."
    ./scripts/setup-postgres-replication.sh --setup-users
    
    # Initialize replica
    info "Initializing replica from primary..."
    ./scripts/setup-postgres-replication.sh --init-replica
    
    # Start replica
    info "Starting PostgreSQL replica..."
    docker-compose -f "${PROJECT_DIR}/docker-compose.ha.yml" up -d postgres-replica
    
    # Wait for replica to be ready
    info "Waiting for replica PostgreSQL to be ready..."
    attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if docker exec runnerhub-postgres-replica pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
            success "Replica PostgreSQL is ready"
            break
        fi
        
        if [[ $attempt -eq $max_attempts ]]; then
            error "Replica PostgreSQL failed to start within timeout"
            return 1
        fi
        
        info "Attempt $attempt/$max_attempts - waiting for replica..."
        sleep 5
        ((attempt++))
    done
    
    # Test replication
    info "Testing replication setup..."
    sleep 10  # Give replication time to establish
    ./scripts/setup-postgres-replication.sh --test-replication
    
    success "PostgreSQL replication cluster deployed successfully"
}

# Setup comprehensive monitoring
setup_monitoring() {
    header "Setting Up PostgreSQL Monitoring"
    
    info "Creating monitoring database and user..."
    
    # Create monitoring user and database
    docker exec runnerhub-postgres-primary psql -U "$DB_USER" -d "$DB_NAME" << EOF
-- Create monitoring user
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pg_monitor_user') THEN
        CREATE ROLE pg_monitor_user WITH LOGIN PASSWORD 'monitor_password_123';
    END IF;
END
\$\$;

-- Grant monitoring permissions
GRANT pg_monitor TO pg_monitor_user;
GRANT CONNECT ON DATABASE $DB_NAME TO pg_monitor_user;
GRANT USAGE ON SCHEMA public TO pg_monitor_user;

-- Grant replication monitoring
GRANT SELECT ON pg_stat_replication TO pg_monitor_user;
GRANT SELECT ON pg_stat_wal_receiver TO pg_monitor_user;
GRANT EXECUTE ON FUNCTION pg_current_wal_lsn() TO pg_monitor_user;
GRANT EXECUTE ON FUNCTION pg_last_wal_receive_lsn() TO pg_monitor_user;
GRANT EXECUTE ON FUNCTION pg_last_wal_replay_lsn() TO pg_monitor_user;
EOF

    # Create monitoring views
    docker exec runnerhub-postgres-primary psql -U "$DB_USER" -d "$DB_NAME" << 'EOF'
-- Create replication lag monitoring view
CREATE OR REPLACE VIEW replication_lag AS
SELECT 
    client_addr,
    application_name,
    state,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes,
    EXTRACT(EPOCH FROM (now() - reply_time)) AS lag_seconds,
    reply_time
FROM pg_stat_replication;

-- Create database health view
CREATE OR REPLACE VIEW database_health AS
SELECT 
    'primary' as role,
    pg_is_in_recovery() as is_standby,
    pg_current_wal_lsn() as current_lsn,
    pg_database_size(current_database()) as db_size,
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
    (SELECT count(*) FROM pg_stat_activity) as total_connections;
EOF

    success "PostgreSQL monitoring setup completed"
}

# Test replication functionality
test_replication() {
    header "Testing PostgreSQL Replication"
    
    info "Running comprehensive replication tests..."
    
    # Test 1: Basic connectivity
    info "Test 1: Testing basic connectivity..."
    if docker exec runnerhub-postgres-primary pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
        success "Primary connectivity: OK"
    else
        error "Primary connectivity: FAILED"
        return 1
    fi
    
    if docker exec runnerhub-postgres-replica pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
        success "Replica connectivity: OK"
    else
        error "Replica connectivity: FAILED"
        return 1
    fi
    
    # Test 2: Replication status
    info "Test 2: Checking replication status..."
    local replication_count=$(docker exec runnerhub-postgres-primary psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM pg_stat_replication;" | xargs)
    
    if [[ "$replication_count" -ge "1" ]]; then
        success "Replication connections: $replication_count active"
    else
        error "No active replication connections found"
        return 1
    fi
    
    # Test 3: Data replication
    info "Test 3: Testing data replication..."
    local test_table="replication_test_$(date +%s)"
    local test_value="test_data_$(date +%s)"
    
    # Create test data on primary
    docker exec runnerhub-postgres-primary psql -U "$DB_USER" -d "$DB_NAME" << EOF
CREATE TABLE $test_table (
    id SERIAL PRIMARY KEY,
    test_data TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO $test_table (test_data) VALUES ('$test_value');
EOF

    # Wait for replication
    sleep 3
    
    # Check if data replicated to replica
    local replica_count=$(docker exec runnerhub-postgres-replica psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM $test_table WHERE test_data = '$test_value';" | xargs)
    
    if [[ "$replica_count" == "1" ]]; then
        success "Data replication: OK"
        
        # Clean up test table
        docker exec runnerhub-postgres-primary psql -U "$DB_USER" -d "$DB_NAME" -c "DROP TABLE $test_table;"
    else
        error "Data replication: FAILED"
        return 1
    fi
    
    # Test 4: Replication lag
    info "Test 4: Checking replication lag..."
    local lag_seconds=$(docker exec runnerhub-postgres-primary psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - reply_time)), 0) FROM pg_stat_replication LIMIT 1;" | xargs)
    
    if [[ -n "$lag_seconds" ]] && (( $(echo "$lag_seconds < 10" | bc -l) )); then
        success "Replication lag: ${lag_seconds}s (acceptable)"
    else
        warning "Replication lag: ${lag_seconds}s (high)"
    fi
    
    # Test 5: Read-only replica
    info "Test 5: Testing read-only replica..."
    if docker exec runnerhub-postgres-replica psql -U "$DB_USER" -d "$DB_NAME" -c "CREATE TABLE readonly_test (id INT);" 2>&1 | grep -q "read-only"; then
        success "Replica read-only enforcement: OK"
    else
        error "Replica read-only enforcement: FAILED"
        return 1
    fi
    
    success "All replication tests passed successfully"
}

# Test manual failover procedures
test_failover() {
    header "Testing PostgreSQL Failover Procedures"
    
    warning "This test will simulate a primary failure and test failover procedures"
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Failover test cancelled"
        return
    fi
    
    info "Step 1: Creating test data for failover verification..."
    local test_table="failover_test_$(date +%s)"
    local test_value="failover_data_$(date +%s)"
    
    docker exec runnerhub-postgres-primary psql -U "$DB_USER" -d "$DB_NAME" << EOF
CREATE TABLE $test_table (
    id SERIAL PRIMARY KEY,
    test_data TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO $test_table (test_data) VALUES ('$test_value');
EOF

    # Wait for replication
    sleep 3
    
    info "Step 2: Verifying data is replicated..."
    local replica_count=$(docker exec runnerhub-postgres-replica psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM $test_table WHERE test_data = '$test_value';" | xargs)
    
    if [[ "$replica_count" != "1" ]]; then
        error "Pre-failover data verification failed"
        return 1
    fi
    success "Pre-failover data verified on replica"
    
    info "Step 3: Simulating primary failure (stopping primary container)..."
    docker stop runnerhub-postgres-primary
    
    info "Step 4: Promoting replica to primary..."
    
    # Promote replica (in a real scenario, this would be automated)
    docker exec runnerhub-postgres-replica psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT pg_promote();"
    
    # Wait for promotion
    sleep 5
    
    info "Step 5: Verifying replica promotion..."
    local is_standby=$(docker exec runnerhub-postgres-replica psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT pg_is_in_recovery();" | xargs)
    
    if [[ "$is_standby" == "f" ]]; then
        success "Replica successfully promoted to primary"
    else
        error "Replica promotion failed"
        return 1
    fi
    
    info "Step 6: Testing write operations on promoted replica..."
    docker exec runnerhub-postgres-replica psql -U "$DB_USER" -d "$DB_NAME" << EOF
INSERT INTO $test_table (test_data) VALUES ('post_failover_data');
EOF

    if [[ $? -eq 0 ]]; then
        success "Write operations working on promoted replica"
    else
        error "Write operations failed on promoted replica"
        return 1
    fi
    
    info "Step 7: Verifying data integrity..."
    local total_count=$(docker exec runnerhub-postgres-replica psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM $test_table;" | xargs)
    
    if [[ "$total_count" == "2" ]]; then
        success "Data integrity verified after failover"
    else
        error "Data integrity check failed"
        return 1
    fi
    
    info "Step 8: Cleaning up test data..."
    docker exec runnerhub-postgres-replica psql -U "$DB_USER" -d "$DB_NAME" -c "DROP TABLE $test_table;"
    
    info "Step 9: Restarting original primary as new replica..."
    docker start runnerhub-postgres-primary
    
    # Wait for restart
    sleep 10
    
    warning "Manual steps required to configure old primary as new replica:"
    echo "1. Create standby.signal file in old primary"
    echo "2. Update primary_conninfo to point to new primary"
    echo "3. Restart old primary service"
    
    success "Failover test completed successfully"
}

# Show comprehensive replication status
show_status() {
    header "PostgreSQL Replication Status"
    
    info "Cluster Overview:"
    echo "Primary: runnerhub-postgres-primary"
    echo "Replica: runnerhub-postgres-replica"
    echo
    
    info "Container Status:"
    docker ps --filter "name=postgres" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo
    
    info "Primary Database Status:"
    if docker exec runnerhub-postgres-primary pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
        docker exec runnerhub-postgres-primary psql -U "$DB_USER" -d "$DB_NAME" << 'EOF'
SELECT 
    'Primary Status' as component,
    pg_is_in_recovery() as is_standby,
    pg_current_wal_lsn() as current_lsn,
    pg_database_size(current_database()) as db_size_bytes,
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections;

-- Replication connections
SELECT 
    'Replication Connections' as component,
    client_addr,
    application_name,
    state,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) as lag_bytes,
    EXTRACT(EPOCH FROM (now() - reply_time)) as lag_seconds
FROM pg_stat_replication;
EOF
    else
        error "Primary database is not accessible"
    fi
    
    echo
    info "Replica Database Status:"
    if docker exec runnerhub-postgres-replica pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
        docker exec runnerhub-postgres-replica psql -U "$DB_USER" -d "$DB_NAME" << 'EOF'
SELECT 
    'Replica Status' as component,
    pg_is_in_recovery() as is_standby,
    pg_last_wal_receive_lsn() as receive_lsn,
    pg_last_wal_replay_lsn() as replay_lsn,
    pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) as lag_bytes;
EOF
    else
        error "Replica database is not accessible"
    fi
    
    echo
    info "Health Summary:"
    
    # Check primary health
    if docker exec runnerhub-postgres-primary pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
        echo "✅ Primary: Healthy"
    else
        echo "❌ Primary: Unhealthy"
    fi
    
    # Check replica health
    if docker exec runnerhub-postgres-replica pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
        echo "✅ Replica: Healthy"
    else
        echo "❌ Replica: Unhealthy"
    fi
    
    # Check replication lag
    local lag_seconds=$(docker exec runnerhub-postgres-primary psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - reply_time)), 999) FROM pg_stat_replication LIMIT 1;" 2>/dev/null | xargs || echo "999")
    
    if [[ -n "$lag_seconds" ]] && (( $(echo "$lag_seconds < 5" | bc -l) )); then
        echo "✅ Replication Lag: ${lag_seconds}s (excellent)"
    elif [[ -n "$lag_seconds" ]] && (( $(echo "$lag_seconds < 30" | bc -l) )); then
        echo "⚠️  Replication Lag: ${lag_seconds}s (acceptable)"
    else
        echo "❌ Replication Lag: ${lag_seconds}s (high)"
    fi
}

# Create backup
create_backup() {
    header "Creating PostgreSQL Backup"
    
    local backup_dir="${PROJECT_DIR}/backups"
    local backup_file="postgres_backup_$(date +%Y%m%d_%H%M%S).sql"
    local backup_path="$backup_dir/$backup_file"
    
    info "Creating backup directory..."
    mkdir -p "$backup_dir"
    
    info "Creating full database backup..."
    docker exec runnerhub-postgres-primary pg_dumpall -U "$DB_USER" > "$backup_path"
    
    if [[ $? -eq 0 ]]; then
        success "Backup created: $backup_path"
        
        # Compress backup
        gzip "$backup_path"
        success "Backup compressed: ${backup_path}.gz"
        
        # Show backup info
        local backup_size=$(du -h "${backup_path}.gz" | cut -f1)
        info "Backup size: $backup_size"
    else
        error "Backup creation failed"
        return 1
    fi
}

# Reset cluster
reset_cluster() {
    header "Resetting PostgreSQL Cluster"
    
    warning "This will stop and remove all PostgreSQL containers and volumes"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Reset cancelled"
        return
    fi
    
    info "Stopping PostgreSQL services..."
    docker-compose -f "${PROJECT_DIR}/docker-compose.ha.yml" stop postgres-primary postgres-replica
    
    info "Removing containers..."
    docker-compose -f "${PROJECT_DIR}/docker-compose.ha.yml" rm -f postgres-primary postgres-replica
    
    info "Removing volumes..."
    docker volume rm -f $(docker volume ls -q | grep postgres) 2>/dev/null || true
    
    success "PostgreSQL cluster reset completed"
}

# Main execution
main() {
    echo -e "${CYAN}"
    cat << "EOF"
╔══════════════════════════════════════════════════════════════════════════════╗
║            PostgreSQL Replication Deployment - GitHub RunnerHub HA          ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    
    if [[ "$CLEANUP" == "true" ]]; then
        reset_cluster
        return
    fi
    
    load_environment
    verify_prerequisites
    
    if [[ "$RESET" == "true" ]]; then
        reset_cluster
        if [[ "$DEPLOY" == "true" ]]; then
            deploy_cluster
        fi
        return
    fi
    
    if [[ "$DEPLOY" == "true" ]]; then
        deploy_cluster
    fi
    
    if [[ "$SETUP_USERS" == "true" ]]; then
        ./scripts/setup-postgres-replication.sh --setup-users
    fi
    
    if [[ "$INIT_REPLICA" == "true" ]]; then
        ./scripts/setup-postgres-replication.sh --init-replica
    fi
    
    if [[ "$MONITORING" == "true" ]]; then
        setup_monitoring
    fi
    
    if [[ "$TEST" == "true" ]]; then
        test_replication
    fi
    
    if [[ "$FAILOVER_TEST" == "true" ]]; then
        test_failover
    fi
    
    if [[ "$BACKUP" == "true" ]]; then
        create_backup
    fi
    
    if [[ "$STATUS" == "true" ]]; then
        show_status
    fi
    
    # If no specific action was requested, show status
    if [[ "$DEPLOY" == "false" && "$TEST" == "false" && "$STATUS" == "false" && "$FAILOVER_TEST" == "false" && "$BACKUP" == "false" && "$MONITORING" == "false" ]]; then
        show_help
    fi
}

# Parse arguments and run
parse_args "$@"
main