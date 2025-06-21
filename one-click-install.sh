#!/bin/bash

# GitHub RunnerHub - Simple One-Click Installation
# This is a wrapper for the comprehensive installer with sensible defaults

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}GitHub RunnerHub - One-Click Installation${NC}"
echo

# Detect if we should use production or development mode
if [[ -n "$GITHUB_TOKEN" ]] && [[ -n "$GITHUB_ORG" ]]; then
    echo -e "${GREEN}✓${NC} GitHub credentials detected in environment"
    MODE="production"
else
    echo -e "${YELLOW}!${NC} No GitHub credentials in environment"
    echo "  Set GITHUB_TOKEN and GITHUB_ORG for automatic setup"
    echo
    read -p "Select installation mode [development/production] (default: development): " MODE
    MODE=${MODE:-development}
fi

echo -e "${BLUE}Installing in ${MODE} mode...${NC}"
echo

# Run the comprehensive installer with appropriate defaults
if [[ "$MODE" == "production" ]]; then
    # Production installation with all features
    exec ./install-comprehensive.sh \
        --mode production \
        --enable-ha \
        --force \
        "$@"
else
    # Development installation with minimal features
    exec ./install-comprehensive.sh \
        --mode development \
        --no-vault \
        --no-monitoring \
        --force \
        "$@"
fi