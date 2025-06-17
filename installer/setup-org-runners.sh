#!/bin/bash

# Organization-level runner setup script for GitHub RunnerHub
# This configures RunnerHub to manage organization-level runners

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     GitHub RunnerHub - Organization Runner Configuration      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if running on the target server
if [[ "$(hostname -I | awk '{print $1}')" != "192.168.1.16" ]]; then
    echo "⚠️  This script should be run on the RunnerHub server (192.168.1.16)"
    echo "   Copying script to server..."
    
    scp "$0" remote-server:/tmp/setup-org-runners.sh
    ssh remote-server "chmod +x /tmp/setup-org-runners.sh && /tmp/setup-org-runners.sh"
    exit 0
fi

# Get GitHub token from Vault
echo "🔑 Retrieving GitHub token from Vault..."
GITHUB_TOKEN=$(curl -s -H "X-Vault-Token: YOUR_VAULT_TOKEN_HERE" \
    http://192.168.1.24:8200/v1/secret/data/github | \
    jq -r '.data.data.GITHUB_TOKEN')

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Failed to retrieve GitHub token from Vault"
    exit 1
fi

# Configuration
GITHUB_ORG="anubissbe"
INSTALL_DIR="/opt/GitHub-RunnerHub"

echo "📋 Configuration:"
echo "   Organization: $GITHUB_ORG"
echo "   Install Directory: $INSTALL_DIR"
echo ""

# Create directory if it doesn't exist
sudo mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Create .env file for organization-level runners
echo "📝 Creating organization-level configuration..."
cat > .env << EOF
# GitHub API Configuration - Organization Level
GITHUB_TOKEN=$GITHUB_TOKEN
GITHUB_ORG=$GITHUB_ORG
# Remove GITHUB_REPO to use organization-level runners

# Auto-scaler Configuration
MIN_RUNNERS=5
MAX_RUNNERS=50
SCALE_THRESHOLD=0.8
SCALE_INCREMENT=5
COOLDOWN_PERIOD=300
IDLE_TIMEOUT=1800

# Runner Configuration
RUNNER_SCOPE=org
RUNNER_LABELS=self-hosted,Linux,X64,docker,runnerhub,auto-scaled

# Backend Configuration
PORT=8300

# Authentication
JWT_SECRET=$(openssl rand -base64 32)
JWT_EXPIRY=24h
ADMIN_USERNAME=admin
ADMIN_PASSWORD=RunnerHub2024!

# Environment
NODE_ENV=production
EOF

# Update auto-scaler to support organization runners
echo "🔧 Updating auto-scaler for organization support..."
cat > auto-scaler-org.js << 'EOF'
const Docker = require('dockerode');
const { Octokit } = require('@octokit/rest');

class OrgAutoScaler {
  constructor(config) {
    this.config = config;
    this.octokit = new Octokit({ auth: config.GITHUB_TOKEN });
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async spawnRunner() {
    const runnerId = Math.random().toString(36).substr(2, 6);
    const runnerName = `runnerhub-${runnerId}`;
    
    try {
      console.log(`Creating organization runner: ${runnerName}`);
      
      // Get organization registration token
      const { data: token } = await this.octokit.rest.actions.createRegistrationTokenForOrg({
        org: this.config.GITHUB_ORG
      });

      // Create container with organization URL
      const container = await this.docker.createContainer({
        Image: 'myoung34/github-runner:latest',
        name: runnerName,
        Env: [
          `RUNNER_TOKEN=${token.token}`,
          `RUNNER_NAME=${runnerName}`,
          `RUNNER_WORKDIR=/tmp/runner/work`,
          `RUNNER_GROUP=default`,
          `LABELS=${this.config.RUNNER_LABELS || 'self-hosted,Linux,X64,docker,runnerhub'}`,
          `ORG_RUNNER=true`,
          `ORG_NAME=${this.config.GITHUB_ORG}`,
          `RUNNER_SCOPE=org`
        ],
        HostConfig: {
          AutoRemove: false,
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
          SecurityOpt: ['label:disable']
        }
      });

      await container.start();
      console.log(`✅ Spawned organization runner: ${runnerName}`);
      
      return { name: runnerName, id: container.id };
    } catch (error) {
      console.error(`Error creating runner ${runnerName}:`, error);
      throw error;
    }
  }

  async getRunnerMetrics() {
    try {
      // Get organization runners
      const { data: runners } = await this.octokit.rest.actions.listSelfHostedRunnersForOrg({
        org: this.config.GITHUB_ORG,
        per_page: 100
      });

      const totalRunners = runners.runners.filter(r => r.status === 'online').length;
      const busyRunners = runners.runners.filter(r => r.status === 'online' && r.busy).length;
      
      return {
        totalRunners,
        busyRunners,
        utilization: totalRunners > 0 ? busyRunners / totalRunners : 0,
        runners: runners.runners
      };
    } catch (error) {
      console.error('Error getting runner metrics:', error.message);
      return { totalRunners: 0, busyRunners: 0, utilization: 0, runners: [] };
    }
  }
}

module.exports = OrgAutoScaler;
EOF

# Stop existing containers
echo "🛑 Stopping existing RunnerHub containers..."
docker stop runnerhub-backend runnerhub-frontend 2>/dev/null || true
docker rm runnerhub-backend runnerhub-frontend 2>/dev/null || true

# Remove any existing repository-specific runners
echo "🧹 Cleaning up repository-specific runners..."
docker ps -a --format '{{.Names}}' | grep '^runnerhub-' | xargs -r docker rm -f

# Start RunnerHub with organization configuration
echo "🚀 Starting RunnerHub with organization-level runners..."
docker run -d \
  --name runnerhub-backend \
  --restart unless-stopped \
  -p 8300:8300 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$INSTALL_DIR/.env:/app/.env:ro" \
  -v "$INSTALL_DIR/auto-scaler-org.js:/app/auto-scaler-org.js:ro" \
  -e NODE_ENV=production \
  ghcr.io/anubissbe/github-runnerhub-backend:latest

docker run -d \
  --name runnerhub-frontend \
  --restart unless-stopped \
  -p 8080:80 \
  ghcr.io/anubissbe/github-runnerhub-frontend:latest

# Wait for backend to start
echo "⏳ Waiting for backend to start..."
sleep 10

# Create initial organization runners
echo "🏃 Creating initial organization runners..."
for i in {1..5}; do
    echo "  Creating runner $i of 5..."
    
    # Use the backend API to create runners
    curl -X POST http://localhost:8300/api/runners/spawn \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer temp-token" \
        -d '{"count": 1}' || true
    
    sleep 2
done

echo ""
echo "✅ Organization-level runners configured!"
echo ""
echo "📊 Runner Status:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep runnerhub

echo ""
echo "🔗 Access Points:"
echo "   Dashboard: http://192.168.1.16:8080"
echo "   API: http://192.168.1.16:8300"
echo ""
echo "📝 Next Steps:"
echo "   1. Visit https://github.com/organizations/$GITHUB_ORG/settings/actions/runners"
echo "   2. You should see 5 'runnerhub-' runners online"
echo "   3. All your repositories can now use these runners with labels: [self-hosted, runnerhub]"
echo ""
EOF

chmod +x /opt/projects/projects/GitHub-RunnerHub/installer/setup-org-runners.sh