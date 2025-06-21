#!/bin/bash

# GitHub RunnerHub - Uninstall Script
# Safely removes GitHub RunnerHub and optionally cleans up data

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# Default options
FORCE_MODE=false
REMOVE_DATA=false
REMOVE_IMAGES=false
BACKUP_DATA=true
BACKUP_DIR="github-runnerhub-backup-$(date +%Y%m%d-%H%M%S)"

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
    echo -e "\n${PURPLE}=== $1 ===${NC}"
}

# Help function
show_help() {
    cat << EOF
GitHub RunnerHub - Uninstall Script

USAGE:
    ./uninstall.sh [OPTIONS]

OPTIONS:
    -f, --force             Force removal without confirmation prompts
    -d, --remove-data       Remove all data including volumes and databases
    -i, --remove-images     Also remove Docker images
    -b, --no-backup         Skip creating backup before removal
    -h, --help              Show this help message

EXAMPLES:
    ./uninstall.sh                      # Interactive uninstall with backup
    ./uninstall.sh --force              # Force removal without confirmation
    ./uninstall.sh --remove-data        # Remove all data including volumes
    ./uninstall.sh --remove-images      # Also remove Docker images

SAFETY:
    By default, this script:
    - Creates a backup before removal
    - Preserves data volumes
    - Keeps Docker images
    - Asks for confirmation

Use --force and --remove-data flags with caution!
EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--force)
                FORCE_MODE=true
                shift
                ;;
            -d|--remove-data)
                REMOVE_DATA=true
                shift
                ;;
            -i|--remove-images)
                REMOVE_IMAGES=true
                shift
                ;;
            -b|--no-backup)
                BACKUP_DATA=false
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

# Confirm with user
confirm_uninstall() {
    if [[ "$FORCE_MODE" == "true" ]]; then
        return
    fi
    
    header "Uninstall Confirmation"
    
    echo "This will remove GitHub RunnerHub from your system."
    echo
    echo "Actions to be performed:"
    echo "  - Stop all running containers"
    echo "  - Remove GitHub RunnerHub containers"
    echo "  - Remove Docker networks"
    
    if [[ "$BACKUP_DATA" == "true" ]]; then
        echo "  - Create backup in: $BACKUP_DIR"
    fi
    
    if [[ "$REMOVE_DATA" == "true" ]]; then
        echo "  - Remove all data volumes (PERMANENT)"
    else
        echo "  - Preserve data volumes"
    fi
    
    if [[ "$REMOVE_IMAGES" == "true" ]]; then
        echo "  - Remove Docker images"
    else
        echo "  - Keep Docker images"
    fi
    
    echo
    warning "This action cannot be undone!"
    echo
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        info "Uninstall cancelled"
        exit 0
    fi
}

# Create backup
create_backup() {
    if [[ "$BACKUP_DATA" == "false" ]]; then
        return
    fi
    
    header "Creating Backup"
    
    mkdir -p "$BACKUP_DIR"
    
    # Backup configuration files
    info "Backing up configuration files..."
    if [[ -f ".env" ]]; then
        cp .env "$BACKUP_DIR/"
        success "Environment file backed up"
    fi
    
    if [[ -f "docker-compose.yml" ]]; then
        cp docker-compose.yml "$BACKUP_DIR/"
    fi
    
    # Backup database
    info "Backing up database..."
    if docker-compose ps postgres | grep -q "Up"; then
        docker-compose exec -T postgres pg_dump -U app_user github_runnerhub > "$BACKUP_DIR/database.sql" 2>/dev/null || {
            warning "Database backup failed - database may not be running"
        }
    else
        warning "PostgreSQL not running - skipping database backup"
    fi
    
    # Backup logs
    if [[ -d "logs" ]]; then
        info "Backing up logs..."
        cp -r logs "$BACKUP_DIR/" 2>/dev/null || true
    fi
    
    # Create backup info
    cat > "$BACKUP_DIR/backup-info.txt" << EOF
GitHub RunnerHub Backup
Created: $(date)
Hostname: $(hostname)
User: $(whoami)
Directory: $(pwd)

Files included:
- Configuration files (.env, docker-compose.yml)
- Database dump (if available)
- Application logs
- This backup info

To restore:
1. Copy .env file back to GitHub RunnerHub directory
2. Run: docker-compose up -d postgres
3. Restore database: docker-compose exec -T postgres psql -U app_user -d github_runnerhub < database.sql
4. Start application: npm start
EOF
    
    success "Backup created in: $BACKUP_DIR"
}

# Stop services
stop_services() {
    header "Stopping Services"
    
    # Stop Node.js application if running
    info "Stopping Node.js application..."
    pkill -f "node.*github-runnerhub" 2>/dev/null || true
    pkill -f "npm.*start" 2>/dev/null || true
    success "Node.js application stopped"
    
    # Stop Docker containers
    info "Stopping Docker containers..."
    docker-compose down --timeout 30 2>/dev/null || {
        warning "docker-compose down failed - containers may not be running"
    }
    success "Docker containers stopped"
}

# Remove containers
remove_containers() {
    header "Removing Containers"
    
    # Get GitHub RunnerHub containers
    CONTAINERS=$(docker ps -a --filter "label=com.docker.compose.project=github-runnerhub" -q 2>/dev/null || true)
    
    if [[ -n "$CONTAINERS" ]]; then
        info "Removing GitHub RunnerHub containers..."
        docker rm -f $CONTAINERS 2>/dev/null || true
        success "Containers removed"
    else
        info "No containers to remove"
    fi
}

# Remove networks
remove_networks() {
    header "Removing Networks"
    
    # Remove custom networks
    NETWORKS=(
        "github-runnerhub-network"
        "github-runnerhub_default"
        "githubrunner_default"
    )
    
    for network in "${NETWORKS[@]}"; do
        if docker network ls --filter "name=$network" --format "{{.Name}}" | grep -q "^$network$"; then
            info "Removing network: $network"
            docker network rm "$network" 2>/dev/null || warning "Failed to remove network: $network"
        fi
    done
    
    success "Networks cleaned up"
}

# Remove volumes
remove_volumes() {
    if [[ "$REMOVE_DATA" == "false" ]]; then
        info "Skipping volume removal (data preserved)"
        return
    fi
    
    header "Removing Data Volumes"
    
    warning "This will permanently delete all data!"
    if [[ "$FORCE_MODE" == "false" ]]; then
        read -p "Are you ABSOLUTELY sure? Type 'DELETE' to confirm: " -r
        if [[ "$REPLY" != "DELETE" ]]; then
            info "Volume removal cancelled"
            return
        fi
    fi
    
    # Remove GitHub RunnerHub volumes
    VOLUMES=$(docker volume ls --filter "label=com.docker.compose.project=github-runnerhub" -q 2>/dev/null || true)
    
    if [[ -n "$VOLUMES" ]]; then
        info "Removing data volumes..."
        docker volume rm $VOLUMES 2>/dev/null || warning "Some volumes could not be removed"
        success "Data volumes removed"
    else
        info "No volumes to remove"
    fi
}

# Remove images
remove_images() {
    if [[ "$REMOVE_IMAGES" == "false" ]]; then
        info "Skipping image removal (images preserved)"
        return
    fi
    
    header "Removing Docker Images"
    
    # Images to remove
    IMAGES=(
        "github-runnerhub"
        "ghcr.io/YOUR_GITHUB_ORG/github-runnerhub"
        "postgres:16"
        "redis:7-alpine"
        "prometheus/prometheus"
        "grafana/grafana"
    )
    
    for image in "${IMAGES[@]}"; do
        if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "$image"; then
            info "Removing image: $image"
            docker rmi "$image" 2>/dev/null || warning "Failed to remove image: $image"
        fi
    done
    
    success "Images cleaned up"
}

# Clean up files
cleanup_files() {
    header "Cleaning Up Files"
    
    # Remove generated files
    FILES_TO_REMOVE=(
        "installation.log"
        "app.log"
        ".env"
        "dist/"
        "node_modules/"
        "logs/"
    )
    
    if [[ "$FORCE_MODE" == "false" ]]; then
        echo "The following files and directories will be removed:"
        for file in "${FILES_TO_REMOVE[@]}"; do
            if [[ -e "$file" ]]; then
                echo "  - $file"
            fi
        done
        echo
        read -p "Remove these files? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            info "File cleanup skipped"
            return
        fi
    fi
    
    for file in "${FILES_TO_REMOVE[@]}"; do
        if [[ -e "$file" ]]; then
            info "Removing: $file"
            rm -rf "$file"
        fi
    done
    
    success "Files cleaned up"
}

# Main uninstall function
main() {
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
    
    info "GitHub RunnerHub - Uninstall Script"
    echo
    
    # Check if in correct directory
    if [[ ! -f "package.json" ]] || ! grep -q "github-runnerhub" package.json 2>/dev/null; then
        error "Not in GitHub RunnerHub directory or package.json not found"
        exit 1
    fi
    
    # Run uninstall steps
    confirm_uninstall
    create_backup
    stop_services
    remove_containers
    remove_networks
    remove_volumes
    remove_images
    cleanup_files
    
    # Final message
    header "Uninstall Complete!"
    success "GitHub RunnerHub has been successfully uninstalled"
    echo
    
    if [[ "$BACKUP_DATA" == "true" ]]; then
        info "Your data has been backed up to: $BACKUP_DIR"
        info "Keep this backup safe in case you need to restore later"
        echo
    fi
    
    if [[ "$REMOVE_DATA" == "false" ]]; then
        info "Data volumes were preserved. To remove them later, run:"
        echo "  docker volume prune"
        echo
    fi
    
    info "To reinstall GitHub RunnerHub:"
    echo "  git clone https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub.git"
    echo "  cd GitHub-RunnerHub"
    echo "  ./install.sh"
    echo
    
    success "Thank you for using GitHub RunnerHub! 👋"
}

# Parse arguments and run
parse_args "$@"
main