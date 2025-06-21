#!/bin/bash

# GitHub-RunnerHub Sanitization Script
# Removes sensitive data before pushing to GitHub

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🧹 Sanitizing GitHub-RunnerHub for public release..."

# Function to sanitize a file
sanitize_file() {
    local file="$1"
    echo "  📄 Sanitizing: $file"
    
    # Backup original
    cp "$file" "$file.backup"
    
    # Replace sensitive IPs with localhost
    sed -i 's/192\.168\.1\.24/localhost/g' "$file"
    sed -i 's/192\.168\.1\.25/remote-server/g' "$file"
    
    # Replace Vault tokens
    sed -i 's/hvs\.[A-Za-z0-9]\{22,\}/hvs.EXAMPLE_TOKEN_REPLACE_WITH_YOURS/g' "$file"
    
    # Replace GitHub tokens (keep examples but make them obviously fake)
    sed -i 's/ghp_[A-Za-z0-9]\{36\}/ghp_EXAMPLE_TOKEN_REPLACE_WITH_YOURS/g' "$file"
    sed -i 's/github_pat_[A-Za-z0-9_]\{82\}/github_pat_EXAMPLE_TOKEN_REPLACE_WITH_YOURS/g' "$file"
    
    # Replace any real organization names with examples
    sed -i 's/YOUR_GITHUB_ORG/YOUR_GITHUB_ORG/g' "$file"
    sed -i 's/telkom\.be/your-domain.com/g' "$file"
    
    # Replace SSH private keys patterns
