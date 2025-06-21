#!/bin/bash

# Sanitization Script for GitHub Publication
# Removes sensitive data and private network references

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to sanitize a file
sanitize_file() {
    local file="$1"
    local backup_file="${file}.backup"
    
    if [ ! -f "$file" ]; then
        log_warning "File not found: $file"
        return 0
    fi
    
    log_info "Sanitizing file: $file"
    
    # Create backup
    cp "$file" "$backup_file"
    
    # Replace sensitive data patterns
    sed -i \
        -e 's/192\.168\.1\.24/YOUR_SERVER_IP/g' \
        -e 's/192\.168\.1\.25/YOUR_RUNNER_SERVER_IP/g' \
        -e 's/hvs\.[A-Za-z0-9_-]*/hvs.YOUR_VAULT_TOKEN/g' \
        -e 's/postgresql:\/\/[^:]*:[^@]*@[^:]*:[0-9]*\/[^[:space:]]*/postgresql:\/\/user:password@host:5432\/database/g' \
        -e 's/user:password/user:password/g' \
        -e 's/YOUR_ROOT_TOKEN[A-Za-z0-9_-]*/YOUR_ROOT_TOKEN/g' \
        -e 's/YOUR_UNSEAL_KEY[A-Za-z0-9_+\/=]*/YOUR_UNSEAL_KEY/g' \
        -e 's/YOUR_UNSEAL_KEY/YOUR_UNSEAL_KEY/g' \
        -e 's/ssh your-server/ssh your-server/g' \
        -e 's/ssh your-remote-server/ssh your-remote-server/g' \
        -e 's/user YOUR_USERNAME/user YOUR_USERNAME/g' \
        -e 's/bert@telkom\.be/your-email@example.com/g' \
        -e 's/YOUR_GITHUB_ORG@gmail\.com/your-email@example.com/g' \
        -e 's/buymeacoffee\.com\/YOUR_GITHUB_ORG/buymeacoffee.com\/YOUR_USERNAME/g' \
        "$file"
    
    # Check if file was modified
    if ! cmp -s "$file" "$backup_file"; then
        log_success "Sanitized: $file"
        rm "$backup_file"
        return 0
    else
        log_info "No changes needed: $file"
        rm "$backup_file"
        return 0
    fi
}

# Function to remove sensitive files
remove_sensitive_files() {
    local sensitive_patterns=(
        "*.key"
        "*.pem"
        "*.crt"
        "*.p12"
        "**/secrets/*"
        "**/vault-keys/*"
        "**/certificates/*"
        "**/.credentials*"
        "**/private-*"
        "**/sensitive-*"
        "install.log"
        "setup.log"
        "logs/*.log"
        "load-testing/load-test-results/*"
    )
    
    log_info "Removing sensitive files..."
    
    for pattern in "${sensitive_patterns[@]}"; do
        # Use find to locate and remove matching files
        find . -name "$pattern" -type f 2>/dev/null | while read -r file; do
            if [ -f "$file" ]; then
                log_warning "Removing sensitive file: $file"
                rm -f "$file"
            fi
        done
    done
}

# Function to sanitize configuration files
sanitize_config_files() {
    local config_files=(
        ".env"
        ".env.example"
        "docker-compose.override.yml"
        "config/production.json"
        "config/staging.json"
    )
    
    for config_file in "${config_files[@]}"; do
        if [ -f "$config_file" ]; then
            log_info "Sanitizing config file: $config_file"
            
            # Replace sensitive values in config files
            sed -i \
                -e 's/GITHUB_TOKEN=.*/GITHUB_TOKEN=your_github_token_here/g' \
                -e 's/DATABASE_URL=.*/DATABASE_URL=postgresql:\/\/user:password@host:5432\/database/g' \
                -e 's/VAULT_TOKEN=.*/VAULT_TOKEN=your_vault_token/g' \
                -e 's/JWT_SECRET=.*/JWT_SECRET=your_jwt_secret/g' \
                -e 's/REDIS_PASSWORD=.*/REDIS_PASSWORD=your_redis_password/g' \
                -e 's/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=your_postgres_password/g' \
                "$config_file"
        fi
    done
}

# Main sanitization process
main() {
    echo "🧹 Starting GitHub Publication Sanitization"
    echo "============================================"
    
    # Change to project directory
    cd "$(dirname "$0")/.."
    
    log_info "Working directory: $(pwd)"
    
    # Remove sensitive files first
    remove_sensitive_files
    
    # Sanitize configuration files
    sanitize_config_files
    
    # Find and sanitize documentation files
    log_info "Sanitizing documentation files..."
    
    find . -name "*.md" -type f | while read -r file; do
        sanitize_file "$file"
    done
    
    # Sanitize specific file types that might contain sensitive data
    find . \( -name "*.yml" -o -name "*.yaml" -o -name "*.json" -o -name "*.sh" -o -name "*.js" -o -name "*.ts" \) -type f | while read -r file; do
        # Skip node_modules and dist directories
        if [[ "$file" == *"/node_modules/"* ]] || [[ "$file" == *"/dist/"* ]]; then
            continue
        fi
        
        # Check if file contains sensitive patterns
        if grep -q "192\.168\.\|hvs\.\|app_user:app_secure" "$file" 2>/dev/null; then
            sanitize_file "$file"
        fi
    done
    
    # Create sanitized .env.example
    if [ ! -f ".env.example" ]; then
        log_info "Creating .env.example with sanitized examples..."
        cat > .env.example << 'EOF'
# GitHub Integration
GITHUB_TOKEN=your_github_personal_access_token
GITHUB_ORG=your_github_organization

# Database
DATABASE_URL=postgresql://user:password@host:5432/database
POSTGRES_USER=postgres_user
POSTGRES_PASSWORD=postgres_password
POSTGRES_DB=github_runnerhub

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_password

# Application
NODE_ENV=development
JWT_SECRET=your_jwt_secret_here
PORT=3001

# Vault (Optional)
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=your_vault_token

# Webhook Security
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# Monitoring (Optional)
PROMETHEUS_PORT=9090
GRAFANA_PORT=3002
EOF
        log_success "Created .env.example"
    fi
    
    # Final verification
    log_info "Performing final verification..."
    
    # Check for remaining sensitive patterns
    if grep -r "192\.168\." . --include="*.md" --exclude-dir=node_modules 2>/dev/null | grep -v "YOUR_SERVER_IP"; then
        log_warning "Found remaining private IP addresses in documentation"
    fi
    
    if grep -r "hvs\." . --include="*.md" --exclude-dir=node_modules 2>/dev/null | grep -v "YOUR_VAULT_TOKEN"; then
        log_warning "Found remaining vault tokens in documentation"
    fi
    
    log_success "🎉 Sanitization complete!"
    echo ""
    echo "Summary of changes:"
    echo "- Private IP addresses replaced with placeholders"
    echo "- Vault tokens and secrets replaced with examples"
    echo "- Database credentials sanitized"
    echo "- Personal information replaced with placeholders"
    echo "- Sensitive files removed"
    echo ""
    echo "⚠️  Please review all files before committing to ensure no sensitive data remains!"
}

# Script options
case "${1:-}" in
    --help|-h)
        echo "GitHub Publication Sanitization Script"
        echo ""
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --dry-run      Show what would be changed without making changes"
        echo ""
        echo "This script removes sensitive data and private network references"
        echo "to prepare the codebase for public GitHub publication."
        echo ""
        exit 0
        ;;
    --dry-run)
        log_info "DRY RUN MODE - No changes will be made"
        echo "Files that would be sanitized:"
        find . -name "*.md" -type f | head -10
        echo "... and more"
        exit 0
        ;;
    "")
        main
        ;;
    *)
        echo "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac