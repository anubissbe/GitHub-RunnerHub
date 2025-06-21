#!/bin/bash

# Automated GitHub Runner Setup for GitHub-RunnerHub repository
# This script automatically sets up 2 self-hosted runners

set -euo pipefail

echo "🚀 Starting automated GitHub runner setup for GitHub-RunnerHub..."

# Check if we're on the remote server
if [ -f "/home/git-runner/github-runnerhub/.env" ]; then
    echo "📍 Detected remote server environment"
    REMOTE_SETUP=true
    cd /home/git-runner
else
    echo "📍 Detected local environment"
    REMOTE_SETUP=false
fi

# Load GitHub token from Vault
echo "🔐 Loading GitHub credentials from Vault..."

# Use curl to get token from Vault API
# Note: Replace VAULT_TOKEN with your actual Vault token
VAULT_TOKEN="${VAULT_TOKEN:-your-vault-token-here}"
VAULT_ADDR="${VAULT_ADDR:-http://your-vault-server:8200}"
GITHUB_TOKEN=$(curl -s -H "X-Vault-Token: $VAULT_TOKEN" \
    "$VAULT_ADDR/v1/secret/data/github" | \
    jq -r '.data.data.GITHUB_TOKEN // empty' 2>/dev/null || echo "")

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Could not get GitHub token from Vault"
    echo "Please ensure Vault is accessible and contains GitHub token"
    exit 1
fi

echo "✅ GitHub token loaded from Vault"

# Configuration
GITHUB_USER="YOUR_GITHUB_ORG"
TARGET_REPO="GitHub-RunnerHub"
RUNNER_NAME_PREFIX="runnerhub"
RUNNER_COUNT=2
RUNNER_VERSION="2.311.0"

# Create runners directory
RUNNER_DIR="$HOME/github-runners"
echo "📁 Creating runner directory: $RUNNER_DIR"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Download runner if needed
RUNNER_TARBALL="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
if [ ! -f "$RUNNER_TARBALL" ]; then
    echo "⬇️  Downloading GitHub Actions runner v$RUNNER_VERSION..."
    curl -o "$RUNNER_TARBALL" -L \
        "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_TARBALL}"
    echo "✅ Runner downloaded"
else
    echo "✅ Runner already downloaded"
fi

# Install dependencies
echo "📦 Installing dependencies..."
sudo apt-get update >/dev/null 2>&1
sudo apt-get install -y jq curl wget unzip docker.io >/dev/null 2>&1

# Add user to docker group
sudo usermod -aG docker "$USER" || true

# Function to setup a runner
setup_runner() {
    local runner_id=$1
    local runner_name="${RUNNER_NAME_PREFIX}-${runner_id}"
    local runner_dir="${RUNNER_DIR}/${runner_name}"
    
    echo "🔧 Setting up runner: $runner_name"
    
    # Create runner directory
    mkdir -p "$runner_dir"
    cd "$runner_dir"
    
    # Extract runner
    if [ ! -f "./config.sh" ]; then
        echo "📦 Extracting runner files..."
        tar xzf "../$RUNNER_TARBALL" >/dev/null 2>&1
    fi
    
    # Get registration token
    echo "🎫 Getting registration token..."
    TOKEN_RESPONSE=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_USER/$TARGET_REPO/actions/runners/registration-token")
    
    REGISTRATION_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token // empty')
    
    if [ -z "$REGISTRATION_TOKEN" ]; then
        echo "❌ Failed to get registration token"
        return 1
    fi
    
    # Configure runner
    echo "⚙️  Configuring runner..."
    ./config.sh \
        --url "https://github.com/$GITHUB_USER/$TARGET_REPO" \
        --token "$REGISTRATION_TOKEN" \
        --name "$runner_name" \
        --labels "self-hosted,docker,runnerhub,projecthub" \
        --work "/tmp/runner-work" \
        --unattended \
        --replace >/dev/null 2>&1
    
    if [ $? -eq 0 ]; then
        echo "✅ Runner $runner_name configured"
        
        # Create and start systemd service
        create_service "$runner_name" "$runner_dir"
        return 0
    else
        echo "❌ Failed to configure $runner_name"
        return 1
    fi
}

# Function to create systemd service
create_service() {
    local runner_name=$1
    local runner_dir=$2
    local service_name="github-runner-${runner_name}"
    
    echo "🔄 Creating service for $runner_name..."
    
    sudo tee "/etc/systemd/system/${service_name}.service" >/dev/null <<EOF
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
    
    sudo systemctl daemon-reload
    sudo systemctl enable "$service_name" >/dev/null 2>&1
    sudo systemctl start "$service_name"
    
    if sudo systemctl is-active --quiet "$service_name"; then
        echo "✅ Service $service_name started"
    else
        echo "❌ Failed to start service $service_name"
    fi
}

# Set up runners
echo ""
echo "🔄 Setting up $RUNNER_COUNT runners for $TARGET_REPO..."

success_count=0
for i in $(seq 1 "$RUNNER_COUNT"); do
    if setup_runner "$i"; then
        ((success_count++))
    fi
    echo ""
done

echo "🎉 Setup complete! $success_count/$RUNNER_COUNT runners configured"
echo ""
echo "📊 Runner Status:"
echo "=================="

for i in $(seq 1 "$RUNNER_COUNT"); do
    runner_name="${RUNNER_NAME_PREFIX}-${i}"
    service_name="github-runner-${runner_name}"
    
    if sudo systemctl is-active --quiet "$service_name"; then
        echo "✅ $runner_name: RUNNING"
    else
        echo "❌ $runner_name: STOPPED"
    fi
done

echo ""
echo "🔗 Check your runners at:"
echo "   https://github.com/$GITHUB_USER/$TARGET_REPO/settings/actions/runners"
echo ""
echo "📋 Management commands:"
echo "   sudo systemctl status github-runner-runnerhub-1"
echo "   sudo journalctl -u github-runner-runnerhub-1 -f"
echo ""

if [ "$success_count" -gt 0 ]; then
    echo "🎊 GitHub Runners are now online and ready!"
    echo "   They will appear as 'Idle' in your repository settings"
    echo "   Use 'runs-on: self-hosted' in your workflows to use them"
else
    echo "❌ No runners were successfully configured"
    echo "   Check the errors above and try again"
fi