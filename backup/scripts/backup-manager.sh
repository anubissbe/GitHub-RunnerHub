#!/bin/bash
# GitHub-RunnerHub Backup Manager
# Comprehensive backup solution for all RunnerHub components

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-/mnt/synology/github-runnerhub-backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

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

# Create backup directory structure
create_backup_dirs() {
    log_info "Creating backup directory structure at $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"/{postgres,redis,configs,docker,runners,logs,metadata}
}

# Backup PostgreSQL database
backup_postgres() {
    log_info "Starting PostgreSQL backup..."
    
    # Full database dump
    PGPASSWORD="$DB_PASSWORD" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -f "$BACKUP_DIR/postgres/full_dump_$TIMESTAMP.sql" \
        --verbose \
        --no-owner \
        --no-privileges
    
    # Backup individual tables for faster partial recovery
    PGPASSWORD="$DB_PASSWORD" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -t -c "SELECT tablename FROM pg_tables WHERE schemaname='public'" | \
    while read table; do
        if [ ! -z "$table" ]; then
            log_info "Backing up table: $table"
            PGPASSWORD="$DB_PASSWORD" pg_dump \
                -h "$DB_HOST" \
                -p "$DB_PORT" \
                -U "$DB_USER" \
                -d "$DB_NAME" \
                -t "$table" \
                -f "$BACKUP_DIR/postgres/table_${table}_$TIMESTAMP.sql" \
                --no-owner \
                --no-privileges
        fi
    done
    
    # Create compressed archive
    tar -czf "$BACKUP_DIR/postgres.tar.gz" -C "$BACKUP_DIR" postgres/
    
    log_info "PostgreSQL backup completed"
}

# Backup Redis data
backup_redis() {
    log_info "Starting Redis backup..."
    
    # Trigger Redis BGSAVE
    if [ -n "$REDIS_PASSWORD" ]; then
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" BGSAVE
    else
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" BGSAVE
    fi
    
    # Wait for BGSAVE to complete
    log_info "Waiting for Redis BGSAVE to complete..."
    while true; do
        if [ -n "$REDIS_PASSWORD" ]; then
            result=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" LASTSAVE)
        else
            result=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" LASTSAVE)
        fi
        
        if [ "$result" != "$last_save" ]; then
            break
        fi
        sleep 1
    done
    
    # Copy Redis dump file
    docker cp runnerhub-redis:/data/dump.rdb "$BACKUP_DIR/redis/dump_$TIMESTAMP.rdb"
    
    # Also export Redis data as JSON for easier inspection
    if [ -n "$REDIS_PASSWORD" ]; then
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" --rdb "$BACKUP_DIR/redis/redis_export_$TIMESTAMP.rdb"
    else
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --rdb "$BACKUP_DIR/redis/redis_export_$TIMESTAMP.rdb"
    fi
    
    # Create compressed archive
    tar -czf "$BACKUP_DIR/redis.tar.gz" -C "$BACKUP_DIR" redis/
    
    log_info "Redis backup completed"
}

# Backup configuration files
backup_configs() {
    log_info "Backing up configuration files..."
    
    # Core configuration files
    cp -r "$PROJECT_ROOT/config" "$BACKUP_DIR/configs/"
    cp "$PROJECT_ROOT/docker-compose.yml" "$BACKUP_DIR/configs/"
    cp "$PROJECT_ROOT/docker-compose.ha.yml" "$BACKUP_DIR/configs/" 2>/dev/null || true
    cp "$PROJECT_ROOT/docker-compose.remote.yml" "$BACKUP_DIR/configs/" 2>/dev/null || true
    cp "$PROJECT_ROOT/.env" "$BACKUP_DIR/configs/" 2>/dev/null || true
    
    # Nginx configuration
    cp "$PROJECT_ROOT/nginx.conf" "$BACKUP_DIR/configs/" 2>/dev/null || true
    
    # Docker configurations
    cp -r "$PROJECT_ROOT/docker" "$BACKUP_DIR/configs/"
    
    # Scripts
    cp -r "$PROJECT_ROOT/scripts" "$BACKUP_DIR/configs/"
    cp -r "$PROJECT_ROOT/hooks" "$BACKUP_DIR/configs/"
    
    # Create compressed archive
    tar -czf "$BACKUP_DIR/configs.tar.gz" -C "$BACKUP_DIR" configs/
    
    log_info "Configuration backup completed"
}

# Backup Docker volumes
backup_docker_volumes() {
    log_info "Backing up Docker volumes..."
    
    # Get list of RunnerHub volumes
    docker volume ls --format "{{.Name}}" | grep -E "runnerhub|github-runnerhub" | while read volume; do
        log_info "Backing up volume: $volume"
        
        # Create temporary container to access volume
        docker run --rm \
            -v "$volume:/data" \
            -v "$BACKUP_DIR/docker:/backup" \
            alpine \
            tar -czf "/backup/${volume}_$TIMESTAMP.tar.gz" -C /data .
    done
    
    log_info "Docker volumes backup completed"
}

# Backup runner states
backup_runner_states() {
    log_info "Backing up runner states..."
    
    # Get list of running runners
    docker ps --format "table {{.Names}}\t{{.Status}}" | grep runner | while read line; do
        runner_name=$(echo "$line" | awk '{print $1}')
        log_info "Capturing state of runner: $runner_name"
        
        # Export runner container state
        docker export "$runner_name" | gzip > "$BACKUP_DIR/runners/${runner_name}_$TIMESTAMP.tar.gz"
        
        # Save runner metadata
        docker inspect "$runner_name" > "$BACKUP_DIR/runners/${runner_name}_metadata_$TIMESTAMP.json"
    done
    
    # Backup runner data directories
    if [ -d "$PROJECT_ROOT/runner-data" ]; then
        tar -czf "$BACKUP_DIR/runners/runner-data_$TIMESTAMP.tar.gz" -C "$PROJECT_ROOT" runner-data/
    fi
    
    log_info "Runner states backup completed"
}

# Backup logs
backup_logs() {
    log_info "Backing up logs..."
    
    # Application logs
    if [ -d "$PROJECT_ROOT/logs" ]; then
        tar -czf "$BACKUP_DIR/logs/app-logs_$TIMESTAMP.tar.gz" -C "$PROJECT_ROOT" logs/
    fi
    
    # Docker container logs
    docker ps --format "{{.Names}}" | grep -E "runnerhub|github-runnerhub" | while read container; do
        log_info "Backing up logs for container: $container"
        docker logs "$container" > "$BACKUP_DIR/logs/${container}_$TIMESTAMP.log" 2>&1
    done
    
    log_info "Logs backup completed"
}

# Generate backup metadata
generate_metadata() {
    log_info "Generating backup metadata..."
    
    cat > "$BACKUP_DIR/metadata/backup_info.json" << EOF
{
    "timestamp": "$TIMESTAMP",
    "backup_version": "1.0.0",
    "system_info": {
        "hostname": "$(hostname)",
        "os": "$(uname -s)",
        "kernel": "$(uname -r)",
        "docker_version": "$(docker --version)",
        "postgres_version": "$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c 'SELECT version()')"
    },
    "components": {
        "postgres": true,
        "redis": true,
        "configs": true,
        "docker_volumes": true,
        "runner_states": true,
        "logs": true
    },
    "backup_size": "$(du -sh $BACKUP_DIR | cut -f1)",
    "project_root": "$PROJECT_ROOT"
}
EOF
    
    # Generate checksums
    find "$BACKUP_DIR" -type f -name "*.tar.gz" -o -name "*.sql" -o -name "*.rdb" | while read file; do
        sha256sum "$file" >> "$BACKUP_DIR/metadata/checksums.txt"
    done
    
    log_info "Metadata generation completed"
}

# Upload to Synology NAS
upload_to_synology() {
    log_info "Uploading backup to Synology NAS..."
    
    # Create remote directory if it doesn't exist
    ssh -p "$SYNOLOGY_SSH_PORT" "$SYNOLOGY_USER@$SYNOLOGY_HOST" "mkdir -p $SYNOLOGY_BACKUP_PATH"
    
    # Upload backup using rsync
    rsync -avz --progress \
        -e "ssh -p $SYNOLOGY_SSH_PORT" \
        "$BACKUP_DIR/" \
        "$SYNOLOGY_USER@$SYNOLOGY_HOST:$SYNOLOGY_BACKUP_PATH/$TIMESTAMP/"
    
    log_info "Upload to Synology completed"
}

# Clean up old backups
cleanup_old_backups() {
    log_info "Cleaning up old backups..."
    
    # Local cleanup
    find "$BACKUP_ROOT" -maxdepth 1 -type d -name "20*" -mtime +$BACKUP_RETENTION_DAYS -exec rm -rf {} \;
    
    # Remote cleanup on Synology
    ssh -p "$SYNOLOGY_SSH_PORT" "$SYNOLOGY_USER@$SYNOLOGY_HOST" \
        "find $SYNOLOGY_BACKUP_PATH -maxdepth 1 -type d -name '20*' -mtime +$BACKUP_RETENTION_DAYS -exec rm -rf {} \;"
    
    log_info "Cleanup completed"
}

# Verify backup integrity
verify_backup() {
    log_info "Verifying backup integrity..."
    
    # Check if all expected files exist
    for component in postgres.tar.gz redis.tar.gz configs.tar.gz; do
        if [ ! -f "$BACKUP_DIR/$component" ]; then
            log_error "Missing backup component: $component"
            return 1
        fi
    done
    
    # Verify checksums
    cd "$BACKUP_DIR"
    sha256sum -c metadata/checksums.txt
    
    log_info "Backup verification completed"
}

# Main backup function
main() {
    log_info "Starting GitHub-RunnerHub backup process"
    
    # Create lock file to prevent concurrent backups
    LOCK_FILE="/tmp/runnerhub_backup.lock"
    if [ -f "$LOCK_FILE" ]; then
        log_error "Another backup is already running"
        exit 1
    fi
    
    touch "$LOCK_FILE"
    trap "rm -f $LOCK_FILE" EXIT
    
    # Execute backup steps
    create_backup_dirs
    backup_postgres
    backup_redis
    backup_configs
    backup_docker_volumes
    backup_runner_states
    backup_logs
    generate_metadata
    
    # Compress entire backup
    log_info "Creating final backup archive..."
    tar -czf "$BACKUP_ROOT/runnerhub_backup_$TIMESTAMP.tar.gz" -C "$BACKUP_DIR" .
    
    # Verify and upload
    if verify_backup; then
        upload_to_synology
        cleanup_old_backups
        log_info "Backup completed successfully!"
        
        # Send notification (if configured)
        if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
            curl -X POST "$SLACK_WEBHOOK_URL" \
                -H 'Content-Type: application/json' \
                -d "{\"text\": \"GitHub-RunnerHub backup completed successfully at $TIMESTAMP\"}"
        fi
    else
        log_error "Backup verification failed!"
        exit 1
    fi
}

# Run main function
main "$@"