#!/bin/bash

# Simple GitHub Runner Setup using token from container environment
set -euo pipefail

echo "🚀 Setting up GitHub runners for GitHub-RunnerHub..."

# Get GitHub token from the running container
GITHUB_TOKEN=$(docker exec runnerhub-app node -e "
const VaultClient = require('./services/vault-client');
const vault = new VaultClient();
vault.getGitHubSecrets().then(secrets => {
    if (secrets && secrets.token) {
        console.log(secrets.token);
    } else {
        console.log('');
    }
}).catch(() => console.log(''));
" 2>/dev/null || echo "")

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Could not get GitHub token from container"
    echo "Trying environment fallback..."
    GITHUB_TOKEN="${GITHUB_TOKEN:-}"
fi

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ No GitHub token available"
    echo "Please set GITHUB_TOKEN environment variable"
    exit 1
fi

echo "✅ GitHub token obtained"

# Configuration
GITHUB_USER="anubissbe"
TARGET_REPO="GitHub-RunnerHub"
RUNNER_VERSION="2.311.0"

# Install dependencies
echo "📦 Installing dependencies..."
sudo apt-get update >/dev/null 2>&1
sudo apt-get install -y jq curl wget unzip docker.io >/dev/null 2>&1

# Create runners directory
RUNNER_DIR="$HOME/github-runners"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Download runner
RUNNER_TARBALL="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
if [ ! -f "$RUNNER_TARBALL" ]; then
    echo "⬇️ Downloading GitHub Actions runner..."
    curl -o "$RUNNER_TARBALL" -L \
        "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_TARBALL}"
fi

# Setup function
setup_runner() {
    local runner_id=$1
    local runner_name="runnerhub-${runner_id}"
    local runner_dir="${RUNNER_DIR}/${runner_name}"
    
    echo "🔧 Setting up $runner_name..."
    
    mkdir -p "$runner_dir"
    cd "$runner_dir"
    
    # Extract runner
    if [ ! -f "./config.sh" ]; then
        tar xzf "../$RUNNER_TARBALL" >/dev/null 2>&1
    fi
    
    # Get registration token
    TOKEN_RESPONSE=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_USER/$TARGET_REPO/actions/runners/registration-token")
    
    REGISTRATION_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token // empty')
    
    if [ -z "$REGISTRATION_TOKEN" ]; then
        echo "❌ Failed to get registration token for $runner_name"
        echo "Response: $TOKEN_RESPONSE"
        return 1
    fi
    
    # Configure runner
    ./config.sh \
        --url "https://github.com/$GITHUB_USER/$TARGET_REPO" \
        --token "$REGISTRATION_TOKEN" \
        --name "$runner_name" \
        --labels "self-hosted,docker,runnerhub,projecthub" \
        --work "/tmp/runner-work" \
        --unattended \
        --replace >/dev/null 2>&1
    
    if [ $? -eq 0 ]; then
        echo "✅ $runner_name configured"
        
        # Create systemd service
        sudo tee "/etc/systemd/system/github-runner-${runner_name}.service" >/dev/null <<EOF
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
        sudo systemctl enable "github-runner-${runner_name}" >/dev/null 2>&1
        sudo systemctl start "github-runner-${runner_name}"
        
        if sudo systemctl is-active --quiet "github-runner-${runner_name}"; then
            echo "✅ Service started for $runner_name"
            return 0
        else
            echo "❌ Failed to start service for $runner_name"
            return 1
        fi
    else
        echo "❌ Failed to configure $runner_name"
        return 1
    fi
}

# Set up 2 runners
success=0
for i in 1 2; do
    if setup_runner "$i"; then
        ((success++))
    fi
    echo ""
done

echo "🎉 Setup complete! $success/2 runners configured"
echo ""
echo "📊 Runner Status:"
for i in 1 2; do
    if sudo systemctl is-active --quiet "github-runner-runnerhub-$i"; then
        echo "✅ runnerhub-$i: RUNNING"
    else
        echo "❌ runnerhub-$i: STOPPED"
    fi
done

echo ""
echo "🔗 View runners at: https://github.com/$GITHUB_USER/$TARGET_REPO/settings/actions/runners"
echo "📋 Check logs: sudo journalctl -u github-runner-runnerhub-1 -f"

if [ "$success" -gt 0 ]; then
    echo ""
    echo "🎊 Runners are online! They should appear as 'Idle' in GitHub."
fi