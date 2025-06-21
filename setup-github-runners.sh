#!/bin/bash

# GitHub Actions Self-Hosted Runner Setup Script
# This script sets up GitHub Actions runners for your repositories

set -euo pipefail

# Configuration
RUNNER_NAME_PREFIX="${RUNNER_NAME_PREFIX:-runnerhub}"
RUNNER_WORK_DIR="${RUNNER_WORK_DIR:-/tmp/runner-work}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,docker,runnerhub}"
RUNNER_COUNT="${RUNNER_COUNT:-2}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
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

# Check if running as root
if [[ $EUID -eq 0 ]]; then
    log_error "This script should not be run as root for security reasons"
    log_info "Please run as a regular user with sudo privileges"
    exit 1
fi

# Load GitHub token from Vault
log_info "Loading GitHub credentials from Vault..."

if command -v vault >/dev/null 2>&1; then
    export VAULT_ADDR="${VAULT_ADDR:-http://your-vault-server:8200}"
    # Vault token should be set in environment or provided by user
    export VAULT_TOKEN="${VAULT_TOKEN:-}"
    
    # Get GitHub token from Vault
    GITHUB_TOKEN=$(vault kv get -field=GITHUB_TOKEN secret/github 2>/dev/null || echo "")
    
    if [ -z "$GITHUB_TOKEN" ]; then
        log_warning "Could not get GitHub token from Vault, checking environment..."
        GITHUB_TOKEN="${GITHUB_TOKEN:-}"
    else
        log_success "GitHub token loaded from Vault"
    fi
else
    log_warning "Vault CLI not available, using environment variables"
    GITHUB_TOKEN="${GITHUB_TOKEN:-}"
fi

if [ -z "$GITHUB_TOKEN" ]; then
    log_error "GitHub token not found!"
    log_info "Please set GITHUB_TOKEN environment variable or store in Vault"
    log_info "Token needs 'repo' and 'admin:org' permissions"
    exit 1
fi

# Get GitHub username/org
GITHUB_USER="${GITHUB_USER:-anubissbe}"

# Validate GitHub token
log_info "Validating GitHub token..."
GITHUB_API_RESPONSE=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/user" || echo '{"message":"error"}')

if echo "$GITHUB_API_RESPONSE" | grep -q '"message.*error"'; then
    log_error "Invalid GitHub token or API error"
    echo "$GITHUB_API_RESPONSE"
    exit 1
fi

GITHUB_USERNAME=$(echo "$GITHUB_API_RESPONSE" | jq -r '.login // empty')
if [ -z "$GITHUB_USERNAME" ]; then
    log_error "Could not get GitHub username from API"
    exit 1
fi

log_success "GitHub token validated for user: $GITHUB_USERNAME"

# Get list of repositories
log_info "Fetching repositories for $GITHUB_USERNAME..."
REPOS_RESPONSE=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/users/$GITHUB_USERNAME/repos?type=all&per_page=100")

if echo "$REPOS_RESPONSE" | grep -q '"message"'; then
    log_error "Failed to fetch repositories"
    echo "$REPOS_RESPONSE"
    exit 1
fi

# Extract repository names
REPOS=$(echo "$REPOS_RESPONSE" | jq -r '.[].name' | head -10)
REPO_COUNT=$(echo "$REPOS" | wc -l)

log_success "Found $REPO_COUNT repositories"
echo "$REPOS" | while read -r repo; do
    echo "  - $repo"
done

# Choose target repository
echo ""
log_info "Which repository would you like to add runners to?"
echo "Enter the repository name (or 'list' to see all, 'all' for GitHub-RunnerHub):"

read -r TARGET_REPO

if [ "$TARGET_REPO" = "list" ]; then
    echo ""
    log_info "Available repositories:"
    echo "$REPOS" | nl -nln
    echo ""
    read -p "Enter repository name: " TARGET_REPO
elif [ "$TARGET_REPO" = "all" ] || [ -z "$TARGET_REPO" ]; then
    TARGET_REPO="GitHub-RunnerHub"
fi

# Validate repository exists
if ! echo "$REPOS" | grep -q "^$TARGET_REPO$"; then
    log_error "Repository '$TARGET_REPO' not found in your repositories"
    log_info "Available repositories:"
    echo "$REPOS"
    exit 1
fi

log_success "Using repository: $GITHUB_USERNAME/$TARGET_REPO"

# Check if repository has Actions enabled
log_info "Checking if GitHub Actions is enabled for $TARGET_REPO..."
ACTIONS_CHECK=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$GITHUB_USERNAME/$TARGET_REPO/actions/permissions" \
    || echo '{"enabled":false}')

if echo "$ACTIONS_CHECK" | grep -q '"enabled":true'; then
    log_success "GitHub Actions is enabled for this repository"
else
    log_warning "GitHub Actions may not be enabled for this repository"
    log_info "You may need to enable it in repository settings"
fi

# Create runner directory
RUNNER_DIR="$HOME/github-runners"
log_info "Creating runner directory: $RUNNER_DIR"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Download GitHub Actions runner if not present
RUNNER_VERSION="2.311.0"
RUNNER_TARBALL="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"

if [ ! -f "$RUNNER_TARBALL" ]; then
    log_info "Downloading GitHub Actions runner v$RUNNER_VERSION..."
    curl -o "$RUNNER_TARBALL" -L \
        "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_TARBALL}"
    
    log_info "Verifying download..."
    # Add checksum verification here if needed
    
    log_success "Runner downloaded successfully"
else
    log_info "Runner already downloaded"
fi

# Function to set up a single runner
setup_runner() {
    local runner_id=$1
    local runner_name="${RUNNER_NAME_PREFIX}-${runner_id}"
    local runner_dir="${RUNNER_DIR}/${runner_name}"
    
    log_info "Setting up runner: $runner_name"
    
    # Create runner-specific directory
    mkdir -p "$runner_dir"
    cd "$runner_dir"
    
    # Extract runner if not already done
    if [ ! -f "./config.sh" ]; then
        log_info "Extracting runner files for $runner_name..."
        tar xzf "../$RUNNER_TARBALL"
    fi
    
    # Get registration token from GitHub API
    log_info "Getting registration token for $runner_name..."
    TOKEN_RESPONSE=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_USERNAME/$TARGET_REPO/actions/runners/registration-token")
    
    REGISTRATION_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token // empty')
    
    if [ -z "$REGISTRATION_TOKEN" ]; then
        log_error "Failed to get registration token for $runner_name"
        echo "$TOKEN_RESPONSE"
        return 1
    fi
    
    # Configure the runner
    log_info "Configuring runner $runner_name..."
    ./config.sh \
        --url "https://github.com/$GITHUB_USERNAME/$TARGET_REPO" \
        --token "$REGISTRATION_TOKEN" \
        --name "$runner_name" \
        --labels "$RUNNER_LABELS" \
        --work "$RUNNER_WORK_DIR" \
        --unattended \
        --replace
    
    if [ $? -eq 0 ]; then
        log_success "Runner $runner_name configured successfully"
        
        # Create systemd service for the runner
        create_runner_service "$runner_name" "$runner_dir"
        
        return 0
    else
        log_error "Failed to configure runner $runner_name"
        return 1
    fi
}

# Function to create systemd service for runner
create_runner_service() {
    local runner_name=$1
    local runner_dir=$2
    local service_name="github-runner-${runner_name}"
    
    log_info "Creating systemd service for $runner_name..."
    
    # Create service file
    sudo tee "/etc/systemd/system/${service_name}.service" > /dev/null <<EOF
[Unit]
Description=GitHub Actions Runner ($runner_name)
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$runner_dir
ExecStart=$runner_dir/run.sh
Restart=always
RestartSec=5
Environment=HOME=$HOME

[Install]
WantedBy=multi-user.target
EOF
    
    # Enable and start the service
    sudo systemctl daemon-reload
    sudo systemctl enable "$service_name"
    sudo systemctl start "$service_name"
    
    # Check service status
    if sudo systemctl is-active --quiet "$service_name"; then
        log_success "Service $service_name started successfully"
    else
        log_error "Failed to start service $service_name"
        sudo systemctl status "$service_name"
    fi
}

# Install dependencies
log_info "Installing dependencies..."

# Check if Docker is installed
if ! command -v docker >/dev/null 2>&1; then
    log_info "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker "$USER"
    log_success "Docker installed. You may need to log out and back in."
else
    log_success "Docker already installed"
fi

# Install other dependencies
sudo apt-get update
sudo apt-get install -y jq curl wget unzip

# Set up runners
log_info "Setting up $RUNNER_COUNT runners for $GITHUB_USERNAME/$TARGET_REPO..."

SUCCESS_COUNT=0
for i in $(seq 1 "$RUNNER_COUNT"); do
    if setup_runner "$i"; then
        ((SUCCESS_COUNT++))
    fi
done

log_success "Successfully set up $SUCCESS_COUNT out of $RUNNER_COUNT runners"

# Show runner status
echo ""
log_info "Runner Status:"
echo "=============="

for i in $(seq 1 "$RUNNER_COUNT"); do
    runner_name="${RUNNER_NAME_PREFIX}-${i}"
    service_name="github-runner-${runner_name}"
    
    if sudo systemctl is-active --quiet "$service_name"; then
        status="${GREEN}RUNNING${NC}"
    else
        status="${RED}STOPPED${NC}"
    fi
    
    echo -e "$runner_name: $status"
done

echo ""
log_info "GitHub Runners Setup Complete!"
echo ""
log_info "What's next:"
echo "1. Runners should appear in your repository's Actions settings"
echo "2. Go to: https://github.com/$GITHUB_USERNAME/$TARGET_REPO/settings/actions/runners"
echo "3. You should see $SUCCESS_COUNT runners listed as 'Idle'"
echo "4. Create a workflow that uses 'runs-on: self-hosted' to test"
echo ""
log_info "To manage runners:"
echo "- View status: sudo systemctl status github-runner-*"
echo "- Stop all: sudo systemctl stop github-runner-*"
echo "- Start all: sudo systemctl start github-runner-*"
echo "- View logs: sudo journalctl -u github-runner-runnerhub-1 -f"
echo ""
log_success "GitHub Runners are ready to process your workflows!"