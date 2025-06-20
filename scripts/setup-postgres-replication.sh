#!/bin/bash

# PostgreSQL Replication Setup Script for GitHub RunnerHub HA
# This script sets up PostgreSQL streaming replication between primary and replica

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
PRIMARY_HOST=${POSTGRES_PRIMARY_HOST:-postgres-primary}
REPLICA_HOST=${POSTGRES_REPLICA_HOST:-postgres-replica}
POSTGRES_DB=${POSTGRES_DB:-github_runnerhub}
POSTGRES_USER=${POSTGRES_USER:-app_user}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-change_me}
REPLICATION_USER=${POSTGRES_REPLICATION_USER:-replicator}
REPLICATION_PASSWORD=${POSTGRES_REPLICATION_PASSWORD:-repl_password}

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
PostgreSQL Replication Setup Script

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --primary-host HOST     Primary PostgreSQL host (default: postgres-primary)
    --replica-host HOST     Replica PostgreSQL host (default: postgres-replica)
    --db-name NAME          Database name (default: github_runnerhub)
    --db-user USER          Database user (default: app_user)
    --db-password PASS      Database password
    --repl-user USER        Replication user (default: replicator)
    --repl-password PASS    Replication password
    --setup-users           Setup replication users
    --init-replica          Initialize replica from primary
    --test-replication      Test replication setup
    --status                Show replication status
    -h, --help              Show this help

EXAMPLES:
    $0 --setup-users                    # Setup replication users
    $0 --init-replica                   # Initialize replica
    $0 --test-replication               # Test replication
    $0 --status                         # Show status

ENVIRONMENT VARIABLES:
    POSTGRES_PRIMARY_HOST, POSTGRES_REPLICA_HOST, POSTGRES_DB
    POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_REPLICATION_USER
    POSTGRES_REPLICATION_PASSWORD

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --primary-host)
                PRIMARY_HOST="$2"
                shift 2
                ;;
            --replica-host)
                REPLICA_HOST="$2"
                shift 2
                ;;
            --db-name)
                POSTGRES_DB="$2"
                shift 2
                ;;
            --db-user)
                POSTGRES_USER="$2"
                shift 2
                ;;
            --db-password)
                POSTGRES_PASSWORD="$2"
                shift 2
                ;;
            --repl-user)
                REPLICATION_USER="$2"
                shift 2
                ;;
            --repl-password)
                REPLICATION_PASSWORD="$2"
                shift 2
                ;;
            --setup-users)
                SETUP_USERS=true
                shift
                ;;
            --init-replica)
                INIT_REPLICA=true
                shift
                ;;
            --test-replication)
                TEST_REPLICATION=true
                shift
                ;;
            --status)
                SHOW_STATUS=true
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

# Check if PostgreSQL is accessible
check_postgres_connection() {
    local host=$1
    local user=$2
    local db=$3
    local password=$4
    
    info "Checking PostgreSQL connection to $host..."
    
    if PGPASSWORD="$password" psql -h "$host" -U "$user" -d "$db" -c "SELECT 1;" > /dev/null 2>&1; then
        success "Successfully connected to PostgreSQL at $host"
        return 0
    else
        error "Failed to connect to PostgreSQL at $host"
        return 1
    fi
}

# Setup replication users and permissions
setup_replication_users() {
    header "Setting Up Replication Users"
    
    info "Creating replication user on primary..."
    
    # Connect to primary and create replication user
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" << EOF
-- Create replication user if not exists
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$REPLICATION_USER') THEN
        CREATE ROLE $REPLICATION_USER WITH LOGIN REPLICATION PASSWORD '$REPLICATION_PASSWORD';
    END IF;
END
\$\$;

-- Grant necessary permissions
GRANT CONNECT ON DATABASE $POSTGRES_DB TO $REPLICATION_USER;

-- Check if user was created successfully
SELECT rolname, rolreplication FROM pg_roles WHERE rolname = '$REPLICATION_USER';
EOF

    if [[ $? -eq 0 ]]; then
        success "Replication user created successfully"
    else
        error "Failed to create replication user"
        exit 1
    fi
}

# Configure PostgreSQL for replication
configure_primary() {
    header "Configuring Primary PostgreSQL"
    
    info "Updating postgresql.conf..."
    
    # Check if we're running in Docker
    if docker ps --format "table {{.Names}}" | grep -q "$PRIMARY_HOST"; then
        info "Detected Docker environment, updating configuration..."
        
        # Update postgresql.conf in container
        docker exec "$PRIMARY_HOST" bash -c "
            cp /etc/postgresql/postgresql.conf /etc/postgresql/postgresql.conf.backup
            sed -i \"s/#wal_level = replica/wal_level = replica/g\" /etc/postgresql/postgresql.conf
            sed -i \"s/#max_wal_senders = 10/max_wal_senders = 10/g\" /etc/postgresql/postgresql.conf
            sed -i \"s/#wal_keep_size = 0/wal_keep_size = 1GB/g\" /etc/postgresql/postgresql.conf
            sed -i \"s/#hot_standby = on/hot_standby = on/g\" /etc/postgresql/postgresql.conf
            sed -i \"s/#archive_mode = off/archive_mode = on/g\" /etc/postgresql/postgresql.conf
            sed -i \"s|#archive_command = ''|archive_command = 'cp %p /var/lib/postgresql/archive/%f'|g\" /etc/postgresql/postgresql.conf
        "
        
        # Update pg_hba.conf for replication connections
        docker exec "$PRIMARY_HOST" bash -c "
            echo 'host replication $REPLICATION_USER 0.0.0.0/0 md5' >> /etc/postgresql/pg_hba.conf
        "
        
        # Create archive directory
        docker exec "$PRIMARY_HOST" bash -c "
            mkdir -p /var/lib/postgresql/archive
            chown postgres:postgres /var/lib/postgresql/archive
        "
        
        # Restart PostgreSQL
        info "Restarting primary PostgreSQL..."
        docker restart "$PRIMARY_HOST"
        
        # Wait for restart
        sleep 10
        
    else
        warning "Non-Docker environment detected. Please manually configure:"
        echo "1. Update postgresql.conf with replication settings"
        echo "2. Update pg_hba.conf to allow replication connections"
        echo "3. Restart PostgreSQL service"
    fi
    
    success "Primary PostgreSQL configuration completed"
}

# Initialize replica from primary
initialize_replica() {
    header "Initializing Replica from Primary"
    
    info "Stopping replica PostgreSQL..."
    docker stop "$REPLICA_HOST" || true
    
    info "Removing existing replica data..."
    docker run --rm -v "$(docker volume ls -q | grep postgres_replica_data):/data" alpine rm -rf /data/*
    
    info "Creating base backup from primary..."
    
    # Use pg_basebackup to create replica
    docker run --rm \
        --network "$(docker network ls --filter name=runnerhub --format "{{.Name}}" | head -1)" \
        -v "$(docker volume ls -q | grep postgres_replica_data):/replica_data" \
        -e PGPASSWORD="$REPLICATION_PASSWORD" \
        postgres:16-alpine \
        pg_basebackup -h "$PRIMARY_HOST" -D /replica_data -U "$REPLICATION_USER" -v -P -W --wal-method=stream
    
    if [[ $? -eq 0 ]]; then
        success "Base backup completed successfully"
    else
        error "Base backup failed"
        exit 1
    fi
    
    info "Creating standby.signal file..."
    docker run --rm \
        -v "$(docker volume ls -q | grep postgres_replica_data):/replica_data" \
        alpine touch /replica_data/standby.signal
    
    info "Creating recovery configuration..."
    docker run --rm \
        -v "$(docker volume ls -q | grep postgres_replica_data):/replica_data" \
        alpine sh -c "echo \"primary_conninfo = 'host=$PRIMARY_HOST port=5432 user=$REPLICATION_USER password=$REPLICATION_PASSWORD'\" > /replica_data/postgresql.auto.conf"
    
    info "Starting replica PostgreSQL..."
    docker start "$REPLICA_HOST"
    
    # Wait for replica to start
    sleep 15
    
    success "Replica initialization completed"
}

# Test replication setup
test_replication() {
    header "Testing Replication Setup"
    
    info "Checking primary status..."
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery();"
    
    info "Checking replica status..."
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$REPLICA_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_is_in_recovery();"
    
    info "Checking replication connections..."
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT client_addr, state, replay_lsn FROM pg_stat_replication;"
    
    info "Testing replication lag..."
    
    # Create test table on primary
    TEST_TABLE="replication_test_$(date +%s)"
    info "Creating test table: $TEST_TABLE"
    
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" << EOF
CREATE TABLE $TEST_TABLE (
    id SERIAL PRIMARY KEY,
    test_data TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO $TEST_TABLE (test_data) VALUES ('Replication test data');
EOF

    # Wait a moment for replication
    sleep 2
    
    # Check if data replicated to replica
    info "Checking if data replicated to replica..."
    REPLICA_COUNT=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$REPLICA_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c "SELECT COUNT(*) FROM $TEST_TABLE;" | xargs)
    
    if [[ "$REPLICA_COUNT" == "1" ]]; then
        success "Replication test passed! Data successfully replicated."
        
        # Clean up test table
        PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP TABLE $TEST_TABLE;"
        
    else
        error "Replication test failed! Data not found on replica."
        exit 1
    fi
}

# Show replication status
show_replication_status() {
    header "Replication Status"
    
    info "Primary server status:"
    echo "Host: $PRIMARY_HOST"
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" << EOF
SELECT 
    'Primary Status' as component,
    pg_is_in_recovery() as is_recovery,
    pg_current_wal_lsn() as current_lsn,
    pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0') as lsn_bytes;

SELECT 
    client_addr,
    application_name,
    state,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) as lag_bytes,
    reply_time
FROM pg_stat_replication;
EOF
    
    echo
    info "Replica server status:"
    echo "Host: $REPLICA_HOST"
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$REPLICA_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" << EOF
SELECT 
    'Replica Status' as component,
    pg_is_in_recovery() as is_recovery,
    pg_last_wal_receive_lsn() as receive_lsn,
    pg_last_wal_replay_lsn() as replay_lsn,
    pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) as lag_bytes;
EOF
}

# Main execution
main() {
    echo -e "${CYAN}"
    cat << "EOF"
╔══════════════════════════════════════════════════════════════════════════════╗
║              PostgreSQL Replication Setup - GitHub RunnerHub HA             ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    
    info "PostgreSQL Replication Setup Script"
    echo "Primary: $PRIMARY_HOST | Replica: $REPLICA_HOST"
    echo "Database: $POSTGRES_DB | User: $POSTGRES_USER"
    echo
    
    # Check connections first
    check_postgres_connection "$PRIMARY_HOST" "$POSTGRES_USER" "$POSTGRES_DB" "$POSTGRES_PASSWORD"
    
    if [[ "${SETUP_USERS:-false}" == "true" ]]; then
        setup_replication_users
        configure_primary
    fi
    
    if [[ "${INIT_REPLICA:-false}" == "true" ]]; then
        initialize_replica
    fi
    
    if [[ "${TEST_REPLICATION:-false}" == "true" ]]; then
        test_replication
    fi
    
    if [[ "${SHOW_STATUS:-false}" == "true" ]]; then
        show_replication_status
    fi
    
    # If no specific action was requested, show help
    if [[ "${SETUP_USERS:-false}" == "false" && "${INIT_REPLICA:-false}" == "false" && "${TEST_REPLICATION:-false}" == "false" && "${SHOW_STATUS:-false}" == "false" ]]; then
        show_help
    fi
}

# Parse arguments and run
parse_args "$@"
main