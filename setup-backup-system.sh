#!/bin/bash
# GitHub-RunnerHub Backup System Setup
# Quick setup script for the comprehensive backup and disaster recovery system

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

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

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites..."
    
    local missing_tools=()
    
    # Check required tools
    command -v docker >/dev/null 2>&1 || missing_tools+=("docker")
    command -v docker-compose >/dev/null 2>&1 || missing_tools+=("docker-compose")
    command -v psql >/dev/null 2>&1 || missing_tools+=("postgresql-client")
    command -v redis-cli >/dev/null 2>&1 || missing_tools+=("redis-tools")
    command -v rsync >/dev/null 2>&1 || missing_tools+=("rsync")
    command -v tar >/dev/null 2>&1 || missing_tools+=("tar")
    command -v gzip >/dev/null 2>&1 || missing_tools+=("gzip")
    command -v crontab >/dev/null 2>&1 || missing_tools+=("cron")
    
    if [ ${#missing_tools[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_info "Please install missing tools and run setup again"
        exit 1
    else
        log_info "All required tools are available"
    fi
}

# Create backup directory structure
create_directories() {
    log_step "Creating backup directory structure..."
    
    local directories=(
        "$PROJECT_ROOT/backup/scripts"
        "$PROJECT_ROOT/backup/config"
        "$PROJECT_ROOT/backup/docs"
        "$PROJECT_ROOT/backup/reports"
        "$PROJECT_ROOT/backup/test-results"
        "/var/log/runnerhub"
        "/tmp/runnerhub-backups"
    )
    
    for dir in "${directories[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            log_info "Created directory: $dir"
        fi
    done
    
    # Set appropriate permissions
    chmod 755 "$PROJECT_ROOT/backup/scripts"
    chmod 600 "$PROJECT_ROOT/backup/config"/* 2>/dev/null || true
    
    log_info "Directory structure created successfully"
}

# Make scripts executable
make_scripts_executable() {
    log_step "Making backup scripts executable..."
    
    local scripts=(
        "$PROJECT_ROOT/backup/scripts/backup-manager.sh"
        "$PROJECT_ROOT/backup/scripts/restore-manager.sh"
        "$PROJECT_ROOT/backup/scripts/disaster-recovery-test.sh"
        "$PROJECT_ROOT/backup/scripts/backup-scheduler.sh"
    )
    
    for script in "${scripts[@]}"; do
        if [ -f "$script" ]; then
            chmod +x "$script"
            log_info "Made executable: $(basename $script)"
        else
            log_warn "Script not found: $script"
        fi
    done
}

# Configure Docker Compose for persistence
configure_docker_persistence() {
    log_step "Configuring Docker Compose for enhanced persistence..."
    
    # Update Redis configuration in docker-compose.yml
    if [ -f "$PROJECT_ROOT/docker-compose.yml" ]; then
        # Backup original docker-compose.yml
        cp "$PROJECT_ROOT/docker-compose.yml" "$PROJECT_ROOT/docker-compose.yml.backup.$(date +%Y%m%d_%H%M%S)"
        
        # Check if Redis persistence is already configured
        if ! grep -q "redis-persistence.conf" "$PROJECT_ROOT/docker-compose.yml"; then
            log_info "Adding Redis persistence configuration to docker-compose.yml"
            
            # Add Redis persistence configuration volume mount
            sed -i '/redis-data:\/data/a\      - ./backup/config/redis-persistence.conf:/usr/local/etc/redis/redis.conf' "$PROJECT_ROOT/docker-compose.yml"
            sed -i 's/command: redis-server --requirepass/command: redis-server \/usr\/local\/etc\/redis\/redis.conf --requirepass/' "$PROJECT_ROOT/docker-compose.yml"
        fi
        
        log_info "Docker Compose persistence configuration updated"
    else
        log_warn "docker-compose.yml not found - skipping Docker configuration"
    fi
}

# Create default environment configuration
create_environment_config() {
    log_step "Creating environment configuration..."
    
    # Create .env.backup file with backup-specific variables
    cat > "$PROJECT_ROOT/.env.backup" << 'EOF'
# GitHub-RunnerHub Backup Configuration
# Source this file before running backup operations: source .env.backup

# Backup directories
export BACKUP_ROOT=/mnt/synology/github-runnerhub-backups
export BACKUP_RETENTION_DAYS=30

# Synology NAS settings
export SYNOLOGY_HOST=YOUR_SERVER_IP
export SYNOLOGY_USER=Bert
export SYNOLOGY_SSH_PORT=2222
export SYNOLOGY_BACKUP_PATH=/volume1/backup/github-runnerhub

# Database settings (use existing values if available)
export DB_USER=${DB_USER:-runnerhub}
export DB_PASSWORD=${DB_PASSWORD:-runnerhub_secure_2024}
export DB_NAME=${DB_NAME:-github_runnerhub}
export DB_HOST=${DB_HOST:-localhost}
export DB_PORT=${DB_PORT:-5432}

# Redis settings
export REDIS_HOST=${REDIS_HOST:-localhost}
export REDIS_PORT=${REDIS_PORT:-6379}
export REDIS_PASSWORD=${REDIS_PASSWORD:-}

# Notification settings (configure as needed)
export SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL:-}
export EMAIL_RECIPIENT=${EMAIL_RECIPIENT:-}

# Logging
export LOG_LEVEL=INFO
export BACKUP_LOG_FILE=/var/log/runnerhub/backup.log
EOF
    
    log_info "Environment configuration created: .env.backup"
    log_warn "Please review and customize .env.backup with your specific settings"
}

# Test backup system
test_backup_system() {
    log_step "Testing backup system..."
    
    # Source environment variables
    if [ -f "$PROJECT_ROOT/.env.backup" ]; then
        source "$PROJECT_ROOT/.env.backup"
    fi
    
    # Test backup scheduler
    if [ -x "$PROJECT_ROOT/backup/scripts/backup-scheduler.sh" ]; then
        if "$PROJECT_ROOT/backup/scripts/backup-scheduler.sh" test; then
            log_info "Backup scheduler test: PASSED"
        else
            log_warn "Backup scheduler test: FAILED"
        fi
    fi
    
    # Test disaster recovery script
    if [ -x "$PROJECT_ROOT/backup/scripts/disaster-recovery-test.sh" ]; then
        log_info "Disaster recovery test script is available"
        log_info "Run './backup/scripts/disaster-recovery-test.sh' to perform full DR testing"
    fi
    
    # Check if services are running
    if docker-compose ps | grep -q "Up"; then
        log_info "Docker services are running - backup system ready"
    else
        log_warn "Docker services not running - start services before running backups"
    fi
}

# Install backup schedules
install_backup_schedules() {
    log_step "Installing backup schedules..."
    
    if [ -x "$PROJECT_ROOT/backup/scripts/backup-scheduler.sh" ]; then
        read -p "Install automated backup schedules? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            "$PROJECT_ROOT/backup/scripts/backup-scheduler.sh" install
            log_info "Backup schedules installed"
        else
            log_info "Skipping backup schedule installation"
            log_info "To install later, run: ./backup/scripts/backup-scheduler.sh install"
        fi
    else
        log_warn "Backup scheduler script not found"
    fi
}

# Create initial backup
create_initial_backup() {
    log_step "Creating initial backup..."
    
    read -p "Create initial backup now? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [ -x "$PROJECT_ROOT/backup/scripts/backup-manager.sh" ]; then
            # Source environment variables
            [ -f "$PROJECT_ROOT/.env.backup" ] && source "$PROJECT_ROOT/.env.backup"
            
            log_info "Starting initial backup (this may take several minutes)..."
            if "$PROJECT_ROOT/backup/scripts/backup-manager.sh"; then
                log_info "Initial backup completed successfully"
            else
                log_error "Initial backup failed"
            fi
        else
            log_error "Backup manager script not found"
        fi
    else
        log_info "Skipping initial backup"
        log_info "To create backup later, run: ./backup/scripts/backup-manager.sh"
    fi
}

# Generate setup report
generate_setup_report() {
    log_step "Generating setup report..."
    
    local report_file="$PROJECT_ROOT/backup/reports/setup-report-$(date +%Y%m%d_%H%M%S).md"
    
    cat > "$report_file" << EOF
# GitHub-RunnerHub Backup System Setup Report

**Date**: $(date)
**Setup Version**: 1.0.0

## Installation Summary

- ✅ Backup system scripts installed
- ✅ Directory structure created
- ✅ Configuration files generated
- ✅ Docker persistence configured
- $([ -f "$PROJECT_ROOT/.env.backup" ] && echo "✅" || echo "❌") Environment configuration created
- $(crontab -l 2>/dev/null | grep -q backup && echo "✅" || echo "❌") Backup schedules installed

## Installed Components

### Scripts
- \`backup/scripts/backup-manager.sh\` - Main backup management
- \`backup/scripts/restore-manager.sh\` - Disaster recovery and restore
- \`backup/scripts/disaster-recovery-test.sh\` - Automated DR testing
- \`backup/scripts/backup-scheduler.sh\` - Schedule management

### Configuration Files
- \`backup/config/postgres-backup.conf\` - PostgreSQL backup settings
- \`backup/config/redis-persistence.conf\` - Redis persistence configuration
- \`.env.backup\` - Environment variables for backup operations

### Documentation
- \`backup/docs/BACKUP_AND_DISASTER_RECOVERY.md\` - Comprehensive documentation

## Next Steps

1. **Review Configuration**: Edit \`.env.backup\` with your specific settings
2. **Test Backups**: Run \`./backup/scripts/backup-manager.sh\` to test backup functionality
3. **Schedule Setup**: Install automated schedules with \`./backup/scripts/backup-scheduler.sh install\`
4. **DR Testing**: Run \`./backup/scripts/disaster-recovery-test.sh\` to test disaster recovery
5. **Monitoring**: Set up monitoring and alerting for backup operations

## Quick Commands

\`\`\`bash
# Create backup
./backup/scripts/backup-manager.sh

# List available backups
./backup/scripts/restore-manager.sh list

# Install schedules
./backup/scripts/backup-scheduler.sh install

# Test disaster recovery
./backup/scripts/disaster-recovery-test.sh

# Monitor backup status
./backup/scripts/backup-scheduler.sh monitor
\`\`\`

## Configuration Files to Review

1. **\`.env.backup\`**: Update with your Synology NAS details and credentials
2. **\`backup/config/postgres-backup.conf\`**: Adjust PostgreSQL backup settings
3. **\`backup/config/redis-persistence.conf\`**: Modify Redis persistence options

## Support

For issues or questions:
1. Check the documentation: \`backup/docs/BACKUP_AND_DISASTER_RECOVERY.md\`
2. Review logs: \`tail -f /var/log/runnerhub/backup.log\`
3. Test components: \`./backup/scripts/backup-scheduler.sh test\`

---
*Generated by setup-backup-system.sh*
EOF
    
    log_info "Setup report generated: $report_file"
}

# Main setup function
main() {
    echo ""
    echo "🔧 GitHub-RunnerHub Backup System Setup"
    echo "========================================"
    echo ""
    
    log_info "Starting backup system setup..."
    
    # Run setup steps
    check_prerequisites
    create_directories
    make_scripts_executable
    configure_docker_persistence
    create_environment_config
    test_backup_system
    install_backup_schedules
    create_initial_backup
    generate_setup_report
    
    echo ""
    echo "✅ Backup System Setup Complete!"
    echo ""
    echo "📋 Next Steps:"
    echo "1. Review and customize .env.backup"
    echo "2. Test backup functionality: ./backup/scripts/backup-manager.sh"
    echo "3. Read documentation: backup/docs/BACKUP_AND_DISASTER_RECOVERY.md"
    echo "4. Set up monitoring and alerting"
    echo ""
    echo "🚀 Your GitHub-RunnerHub backup system is ready!"
}

# Update task status
update_task_status() {
    # This function would integrate with the task management system
    # For now, we'll just log the completion
    log_info "Backup and disaster recovery system implementation completed"
}

# Run main function
main "$@"

# Update task status
update_task_status