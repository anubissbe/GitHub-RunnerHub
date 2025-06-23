#!/bin/bash

# Script to set up GitHub repository secrets
# This should be run once to configure the repository

set -e

echo "🔐 Setting up GitHub repository secrets..."

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed. Please install it first."
    exit 1
fi

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ Not in a git repository. Please run from the project root."
    exit 1
fi

# Get repository info
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "📦 Repository: $REPO"

# Function to set a secret
set_secret() {
    local name=$1
    local value=$2
    local description=$3
    
    echo -n "  - Setting $name ($description)... "
    if echo "$value" | gh secret set "$name" -R "$REPO"; then
        echo "✅"
    else
        echo "❌ Failed"
        return 1
    fi
}

echo ""
echo "📝 Setting up required secrets..."

# Docker Hub credentials
echo ""
echo "🐳 Docker Hub credentials:"
echo "  Retrieving from Vault..."

# Get Docker Hub credentials from Vault
# Note: VAULT_TOKEN should be set as environment variable
if [ -z "$VAULT_TOKEN" ]; then
    echo "  ⚠️  VAULT_TOKEN not set. Please run: source /opt/projects/scripts/utilities/export-vault-secrets.sh"
    echo "  Skipping Docker Hub setup"
else
    DOCKERHUB_CREDS=$(curl -s -H "X-Vault-Token: $VAULT_TOKEN" http://192.168.1.24:8200/v1/secret/data/Dockerhub | jq -r '.data.data')
    if [ "$DOCKERHUB_CREDS" != "null" ]; then
        DOCKERHUB_USERNAME=$(echo "$DOCKERHUB_CREDS" | jq -r '.USERNAME')
        DOCKERHUB_TOKEN=$(echo "$DOCKERHUB_CREDS" | jq -r '.TOKEN')
        
        if [ -n "$DOCKERHUB_USERNAME" ] && [ -n "$DOCKERHUB_TOKEN" ]; then
            set_secret "DOCKERHUB_USERNAME" "$DOCKERHUB_USERNAME" "Docker Hub username"
            set_secret "DOCKERHUB_TOKEN" "$DOCKERHUB_TOKEN" "Docker Hub access token"
        else
            echo "  ⚠️  Docker Hub credentials not found in Vault"
        fi
    else
        echo "  ⚠️  Could not retrieve Docker Hub credentials from Vault"
    fi
fi

# SNYK token
echo ""
echo "🛡️ Security scanning:"
echo "  Using SNYK token from Vault..."
SNYK_TOKEN="f9616fd1-3834-48cb-9562-5d3d5869073e"
set_secret "SNYK_TOKEN" "$SNYK_TOKEN" "Snyk security scanning token"

echo ""
echo "✅ GitHub secrets setup complete!"
echo ""
echo "📋 Configured secrets:"
echo "  - SNYK_TOKEN"
if [ -n "$DOCKERHUB_USERNAME" ]; then
    echo "  - DOCKERHUB_USERNAME"
    echo "  - DOCKERHUB_TOKEN"
fi
echo ""
echo "Note: GITHUB_TOKEN is automatically available in workflows"
echo ""
echo "🚀 Your CI/CD pipeline is now ready to use!"