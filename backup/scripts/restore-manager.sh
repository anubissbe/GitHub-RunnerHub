#!/bin/bash
# GitHub-RunnerHub Restore Manager
# Comprehensive restore solution for disaster recovery

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-/mnt/synology/github-runnerhub-backups}"

# Synology NAS Configuration
SYNOLOGY_HOST="${SYNOLOGY_HOST:-YOUR_SERVER_IP}"
SYNOLOGY_USER="${SYNOLOGY_USER:-Bert}"
SYNOLOGY_SSH_PORT="${SYNOLOGY_SSH_PORT:-2222}"
SYNOLOGY_BACKUP_PATH="${SYNOLOGY_BACKUP_PATH:-/volume1/backup/github-runnerhub}"

# PostgreSQL Configuration
DB_USER="${DB_USER:-runnerhub}"
DB_PASSWORD="${DB_PASSWORD:-runnerhub_secure_2024}"
DB_NAME="${DB_NAME:-github_runnerhub}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

# Redis Configuration
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_prompt() {
    echo -e "${BLUE}[PROMPT]${NC} $1"
}

# List available backups
list_backups() {
    log_info "Available backups:"
    echo ""
    
    # Local backups
    if [ -d "$BACKUP_ROOT" ]; then
        echo "Local backups:"
        ls -1 "$BACKUP_ROOT" | grep -E "^20[0-9]{6}_[0-9]{6}$" | sort -r | head -10
        echo ""
    fi
    
    # Remote backups on Synology
    echo "Remote backups (Synology):"
    ssh -p "$SYNOLOGY_SSH_PORT" "$SYNOLOGY_USER@$SYNOLOGY_HOST" \
        "ls -1 $SYNOLOGY_BACKUP_PATH | grep -E '^20[0-9]{6}_[0-9]{6}$' | sort -r | head -10"
    echo ""
}

# Download backup from Synology
download_from_synology() {
    local backup_timestamp=$1
    local local_backup_dir="$BACKUP_ROOT/$backup_timestamp"
    
    if [ ! -d "$local_backup_dir" ]; then
        log_info "Downloading backup $backup_timestamp from Synology..."
        mkdir -p "$local_backup_dir"
        
        rsync -avz --progress \
            -e "ssh -p $SYNOLOGY_SSH_PORT" \
            "$SYNOLOGY_USER@$SYNOLOGY_HOST:$SYNOLOGY_BACKUP_PATH/$backup_timestamp/" \
            "$local_backup_dir/"
    else
        log_info "Backup $backup_timestamp already exists locally"
    fi
}

# Stop all services
stop_services() {
    log_info "Stopping all RunnerHub services..."
    
    cd "$PROJECT_ROOT"
    docker-compose down || true
    
    # Stop any additional runners
    docker ps --format "{{.Names}}" | grep -E "runner|runnerhub" | while read container; do
        log_info "Stopping container: $container"
        docker stop "$container" || true
    done
    
    log_info "All services stopped"
}

# Restore PostgreSQL database
restore_postgres() {
    local backup_dir=$1
    
    log_info "Restoring PostgreSQL database..."
    
    # Drop existing database and recreate
    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d postgres \
        -c "DROP DATABASE IF EXISTS $DB_NAME;"
    
    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d postgres \
        -c "CREATE DATABASE $DB_NAME;"
    
    # Extract PostgreSQL backup
    tar -xzf "$backup_dir/postgres.tar.gz" -C "$backup_dir"
    
    # Restore full database dump
    if [ -f "$backup_dir/postgres/full_dump_"*.sql ]; then
        local dump_file=$(ls "$backup_dir/postgres/full_dump_"*.sql | head -1)
        log_info "Restoring from: $dump_file"
        
        PGPASSWORD="$DB_PASSWORD" psql \
            -h "$DB_HOST" \
            -p "$DB_PORT" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            -f "$dump_file"
    else
        log_error "PostgreSQL dump file not found!"
        return 1
    fi
    
    log_info "PostgreSQL restore completed"
}

# Restore Redis data
restore_redis() {
    local backup_dir=$1
    
    log_info "Restoring Redis data..."
    
    # Extract Redis backup
    tar -xzf "$backup_dir/redis.tar.gz" -C "$backup_dir"
    
    # Stop Redis to restore data
    docker stop runnerhub-redis || true
    
    # Copy dump file to Redis volume
    local dump_file=$(ls "$backup_dir/redis/dump_"*.rdb | head -1)
    if [ -f "$dump_file" ]; then
        docker run --rm \
            -v redis-data:/data \
            -v "$backup_dir/redis:/backup" \
            alpine \
            cp "/backup/$(basename $dump_file)" /data/dump.rdb
        
        # Set correct permissions
        docker run --rm \
            -v redis-data:/data \
            alpine \
            chown 999:999 /data/dump.rdb
    else
        log_error "Redis dump file not found!"
        return 1
    fi
    
    # Start Redis
    docker-compose up -d redis
    
    log_info "Redis restore completed"
}

# Restore configuration files
restore_configs() {
    local backup_dir=$1
    
    log_info "Restoring configuration files..."
    
    # Extract configs backup
    tar -xzf "$backup_dir/configs.tar.gz" -C "$backup_dir"
    
    # Backup current configs
    if [ -d "$PROJECT_ROOT/config" ]; then
        mv "$PROJECT_ROOT/config" "$PROJECT_ROOT/config.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    # Restore configs
    cp -r "$backup_dir/configs/config" "$PROJECT_ROOT/"
    cp "$backup_dir/configs/docker-compose.yml" "$PROJECT_ROOT/"
    
    # Restore optional files if they exist
    [ -f "$backup_dir/configs/docker-compose.ha.yml" ] && cp "$backup_dir/configs/docker-compose.ha.yml" "$PROJECT_ROOT/"
    [ -f "$backup_dir/configs/docker-compose.remote.yml" ] && cp "$backup_dir/configs/docker-compose.remote.yml" "$PROJECT_ROOT/"
    [ -f "$backup_dir/configs/.env" ] && cp "$backup_dir/configs/.env" "$PROJECT_ROOT/"
    [ -f "$backup_dir/configs/nginx.conf" ] && cp "$backup_dir/configs/nginx.conf" "$PROJECT_ROOT/"
    
    # Restore Docker configurations
    [ -d "$backup_dir/configs/docker" ] && cp -r "$backup_dir/configs/docker" "$PROJECT_ROOT/"
    
    # Restore scripts and hooks
    [ -d "$backup_dir/configs/scripts" ] && cp -r "$backup_dir/configs/scripts" "$PROJECT_ROOT/"
    [ -d "$backup_dir/configs/hooks" ] && cp -r "$backup_dir/configs/hooks" "$PROJECT_ROOT/"
    
    log_info "Configuration restore completed"
}

# Restore Docker volumes
restore_docker_volumes() {
    local backup_dir=$1
    
    log_info "Restoring Docker volumes..."
    
    # Find volume backup files
    find "$backup_dir/docker" -name "*.tar.gz" 2>/dev/null | while read volume_backup; do
        local volume_name=$(basename "$volume_backup" | sed 's/_[0-9]*_[0-9]*.tar.gz$//')
        log_info "Restoring volume: $volume_name"
        
        # Create volume if it doesn't exist
        docker volume create "$volume_name" || true
        
        # Restore volume data
        docker run --rm \
            -v "$volume_name:/data" \
            -v "$backup_dir/docker:/backup" \
            alpine \
            sh -c "cd /data && tar -xzf /backup/$(basename $volume_backup)"
    done
    
    log_info "Docker volumes restore completed"
}

# Restore runner states
restore_runner_states() {
    local backup_dir=$1
    
    log_info "Restoring runner states..."
    
    # Restore runner data directories
    if [ -f "$backup_dir/runners/runner-data_"*.tar.gz ]; then
        local runner_data_backup=$(ls "$backup_dir/runners/runner-data_"*.tar.gz | head -1)
        
        # Backup current runner data
        if [ -d "$PROJECT_ROOT/runner-data" ]; then
            mv "$PROJECT_ROOT/runner-data" "$PROJECT_ROOT/runner-data.backup.$(date +%Y%m%d_%H%M%S)"
        fi
        
        # Extract runner data
        tar -xzf "$runner_data_backup" -C "$PROJECT_ROOT"
    fi
    
    log_info "Runner states restore completed"
}

# Verify restore
verify_restore() {
    log_info "Verifying restore..."
    
    local errors=0
    
    # Check PostgreSQL
    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1; then
        log_info "PostgreSQL: OK"
    else
        log_error "PostgreSQL: FAILED"
        ((errors++))
    fi
    
    # Check Redis
    if [ -n "$REDIS_PASSWORD" ]; then
        if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" ping > /dev/null 2>&1; then
            log_info "Redis: OK"
        else
            log_error "Redis: FAILED"
            ((errors++))
        fi
    else
        if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping > /dev/null 2>&1; then
            log_info "Redis: OK"
        else
            log_error "Redis: FAILED"
            ((errors++))
        fi
    fi
    
    # Check configuration files
    if [ -f "$PROJECT_ROOT/docker-compose.yml" ]; then
        log_info "Configuration files: OK"
    else
        log_error "Configuration files: FAILED"
        ((errors++))
    fi
    
    return $errors
}

# Start services
start_services() {
    log_info "Starting RunnerHub services..."
    
    cd "$PROJECT_ROOT"
    docker-compose up -d
    
    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    sleep 30
    
    # Check service health
    docker-compose ps
}

# Main restore function
restore() {
    local backup_timestamp=$1
    local backup_dir="$BACKUP_ROOT/$backup_timestamp"
    
    log_warn "This will restore GitHub-RunnerHub from backup: $backup_timestamp"
    log_warn "ALL CURRENT DATA WILL BE LOST!"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " confirm
    
    if [ "$confirm" != "yes" ]; then
        log_info "Restore cancelled"
        exit 0
    fi
    
    # Download from Synology if needed
    if [ ! -d "$backup_dir" ]; then
        download_from_synology "$backup_timestamp"
    fi
    
    # Verify backup exists
    if [ ! -d "$backup_dir" ]; then
        log_error "Backup not found: $backup_timestamp"
        exit 1
    fi
    
    # Stop all services
    stop_services
    
    # Restore components
    restore_postgres "$backup_dir"
    restore_redis "$backup_dir"
    restore_configs "$backup_dir"
    restore_docker_volumes "$backup_dir"
    restore_runner_states "$backup_dir"
    
    # Verify restore
    if verify_restore; then
        log_info "Restore verification passed"
        
        # Start services
        start_services
        
        log_info "Restore completed successfully!"
        
        # Send notification (if configured)
        if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
            curl -X POST "$SLACK_WEBHOOK_URL" \
                -H 'Content-Type: application/json' \
                -d "{\"text\": \"GitHub-RunnerHub restored successfully from backup: $backup_timestamp\"}"
        fi
    else
        log_error "Restore verification failed!"
        exit 1
    fi
}

# Partial restore function
partial_restore() {
    local backup_timestamp=$1
    local component=$2
    local backup_dir="$BACKUP_ROOT/$backup_timestamp"
    
    # Download from Synology if needed
    if [ ! -d "$backup_dir" ]; then
        download_from_synology "$backup_timestamp"
    fi
    
    case "$component" in
        postgres)
            stop_services
            restore_postgres "$backup_dir"
            start_services
            ;;
        redis)
            restore_redis "$backup_dir"
            ;;
        configs)
            restore_configs "$backup_dir"
            ;;
        volumes)
            stop_services
            restore_docker_volumes "$backup_dir"
            start_services
            ;;
        runners)
            restore_runner_states "$backup_dir"
            ;;
        *)
            log_error "Unknown component: $component"
            echo "Valid components: postgres, redis, configs, volumes, runners"
            exit 1
            ;;
    esac
    
    log_info "Partial restore of $component completed"
}

# Main entry point
main() {
    case "${1:-}" in
        list)
            list_backups
            ;;
        restore)
            if [ -z "${2:-}" ]; then
                log_error "Please specify backup timestamp"
                echo "Usage: $0 restore <timestamp>"
                list_backups
                exit 1
            fi
            restore "$2"
            ;;
        partial)
            if [ -z "${2:-}" ] || [ -z "${3:-}" ]; then
                log_error "Please specify backup timestamp and component"
                echo "Usage: $0 partial <timestamp> <component>"
                echo "Components: postgres, redis, configs, volumes, runners"
                exit 1
            fi
            partial_restore "$2" "$3"
            ;;
        *)
            echo "GitHub-RunnerHub Restore Manager"
            echo ""
            echo "Usage: $0 {list|restore|partial} [options]"
            echo ""
            echo "Commands:"
            echo "  list                    - List available backups"
            echo "  restore <timestamp>     - Full restore from backup"
            echo "  partial <timestamp> <component> - Partial restore"
            echo ""
            echo "Components for partial restore:"
            echo "  postgres - PostgreSQL database"
            echo "  redis    - Redis data"
            echo "  configs  - Configuration files"
            echo "  volumes  - Docker volumes"
            echo "  runners  - Runner states"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"