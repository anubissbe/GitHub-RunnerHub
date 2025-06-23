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

# Docker Hub credentials (optional)
echo ""
echo "🐳 Docker Hub credentials (optional - press Enter to skip):"
read -p "  Enter Docker Hub username (or press Enter to skip): " DOCKERHUB_USERNAME

if [ -n "$DOCKERHUB_USERNAME" ]; then
    read -s -p "  Enter Docker Hub token/password: " DOCKERHUB_TOKEN
    echo ""
    
    set_secret "DOCKERHUB_USERNAME" "$DOCKERHUB_USERNAME" "Docker Hub username"
    set_secret "DOCKERHUB_TOKEN" "$DOCKERHUB_TOKEN" "Docker Hub access token"
else
    echo "  Skipping Docker Hub setup"
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