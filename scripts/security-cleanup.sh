#!/bin/bash

# Security Cleanup Script for GitHub RunnerHub
# Removes sensitive data and replaces with environment variables

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔒 Security Cleanup for GitHub RunnerHub"
echo "========================================"

# Remove any .env files
find "$PROJECT_DIR" -name ".env*" -not -name ".env.example" -type f -exec rm -f {} \; || true
echo "✅ Removed .env files"

# Replace internal IP addresses with environment variables
sed -i 's/192\.168\.1\.24/${DB_HOST:-localhost}/g' "$PROJECT_DIR/scripts/run-migrations.sh" || true
sed -i 's/192\.168\.1\.24/${VAULT_HOST:-localhost}/g' "$PROJECT_DIR/scripts/setup-vault-secrets.sh" || true

# Clean up any GitHub tokens in example files
find "$PROJECT_DIR" -name "*.md" -o -name "*.yml" -o -name "*.yaml" | xargs sed -i 's/ghp_[a-zA-Z0-9]*/ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/g' || true

# Clean up any vault tokens
find "$PROJECT_DIR" -name "*.md" -o -name "*.yml" -o -name "*.yaml" | xargs sed -i 's/hvs\.[a-zA-Z0-9]*/hvs.XXXXXXXXXXXXXXXXXXXX/g' || true

echo "✅ Replaced sensitive data with placeholders"

# Create comprehensive .gitignore
cat >> "$PROJECT_DIR/.gitignore" << 'EOF'

# Environment files
.env
.env.local
.env.development
.env.test
.env.production
*.env

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# Dependency directories
node_modules/

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# next.js build output
.next

# nuxt.js build output
.nuxt

# vuepress build output
.vuepress/dist

# Serverless directories
.serverless

# Docker volumes
docker-volumes/

# Test results
test-results/
junit.xml

# IDE files
.vscode/
.idea/
*.swp
*.swo
*~

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Sensitive data
secrets/
vault-keys/
certificates/
*.key
*.pem
*.crt

EOF

echo "✅ Updated .gitignore with comprehensive exclusions"

echo "🎉 Security cleanup completed successfully!"
echo ""
echo "⚠️  IMPORTANT: Review all files before committing to ensure no sensitive data remains"
echo "⚠️  ALWAYS use environment variables for sensitive configuration"