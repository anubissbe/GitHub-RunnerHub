#!/bin/bash

echo "🚀 Deploying GitHub RunnerHub to 192.168.1.16..."

# First clean up runners from wrong server
echo "🧹 Cleaning up runners from 192.168.1.25..."
ssh remote-server << 'EOF'
docker ps -a --format '{{.Names}}' | grep -E '(runner|runnerhub)' | xargs -r docker rm -f
docker stop github-runners-monitor-frontend github-runners-monitor-backend 2>/dev/null
docker rm github-runners-monitor-frontend github-runners-monitor-backend 2>/dev/null
pkill -f "server.js" 2>/dev/null || true
EOF

# Create installation script
cat > /tmp/install-on-16.sh << 'SCRIPT'
#!/bin/bash

echo "📦 Installing GitHub RunnerHub on 192.168.1.16..."

# Install Docker if needed
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
fi

# Create directories
sudo mkdir -p /opt/GitHub-RunnerHub
sudo chown -R $USER:$USER /opt/GitHub-RunnerHub
cd /opt/GitHub-RunnerHub

# Create docker-compose.yml
cat > docker-compose.yml << 'COMPOSE'
version: '3.8'

services:
  backend:
    image: ghcr.io/anubissbe/github-runnerhub-backend:latest
    container_name: runnerhub-backend
    ports:
      - "8300:8300"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - GITHUB_TOKEN=YOUR_GITHUB_TOKEN_HERE
      - GITHUB_ORG=anubissbe
      - GITHUB_REPO=ProjectHub-Mcp
      - NODE_ENV=production
    restart: unless-stopped

  frontend:
    image: ghcr.io/anubissbe/github-runnerhub-frontend:latest
    container_name: runnerhub-frontend
    ports:
      - "8080:80"
    environment:
      - VITE_API_URL=http://192.168.1.16:8300
      - VITE_WS_URL=ws://192.168.1.16:8300
    restart: unless-stopped
COMPOSE

# Pull and start containers
docker-compose pull || echo "Using local build"
docker-compose up -d

# If images don't exist, create simple versions
if ! docker ps | grep -q runnerhub-backend; then
    echo "Creating simple backend..."
    mkdir -p backend
    cat > backend/Dockerfile << 'DOCKERFILE'
FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY . .
RUN npm install express cors @octokit/rest ws dockerode
CMD ["node", "server.js"]
DOCKERFILE

    cat > backend/server.js << 'SERVER'
const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const WebSocket = require('ws');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: GITHUB_TOKEN });
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let runners = [];

async function updateRunners() {
    try {
        const { data } = await octokit.rest.actions.listSelfHostedRunnersForRepo({
            owner: 'anubissbe',
            repo: 'ProjectHub-Mcp',
            per_page: 100
        });
        runners = data.runners;
        broadcast('runners', runners);
    } catch (error) {
        console.error('Error fetching runners:', error.message);
    }
}

function broadcast(type, data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type, data }));
        }
    });
}

// Update every 30 seconds
setInterval(updateRunners, 30000);
updateRunners();

app.get('/api/runners', (req, res) => res.json(runners));
app.get('/api/metrics', (req, res) => {
    const online = runners.filter(r => r.status === 'online').length;
    const busy = runners.filter(r => r.busy).length;
    res.json({
        total_runners: runners.length,
        online_runners: online,
        busy_runners: busy,
        utilization_percentage: online > 0 ? ((busy / online) * 100).toFixed(1) : 0
    });
});
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.post('/api/auth/login', (req, res) => res.json({ token: 'mock' }));

server.listen(8300, () => console.log('Backend running on 8300'));
SERVER

    docker build -t ghcr.io/anubissbe/github-runnerhub-backend:latest backend/
    docker-compose up -d
fi

# Create 5 initial runners
echo "🏃 Creating 5 runners..."
for i in {1..5}; do
    RUNNER_ID=$(openssl rand -hex 3)
    RUNNER_NAME="runnerhub-${RUNNER_ID}"
    
    TOKEN=$(curl -s -X POST \
        -H "Authorization: token YOUR_GITHUB_TOKEN_HERE" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/anubissbe/ProjectHub-Mcp/actions/runners/registration-token" | \
        jq -r '.token')
    
    if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
        docker run -d \
            --name "$RUNNER_NAME" \
            --restart unless-stopped \
            -e RUNNER_TOKEN="$TOKEN" \
            -e RUNNER_NAME="$RUNNER_NAME" \
            -e RUNNER_WORKDIR="/tmp/runner/work" \
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub" \
            -e REPO_URL="https://github.com/anubissbe/ProjectHub-Mcp" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            myoung34/github-runner:latest
        echo "✅ Created: $RUNNER_NAME"
    fi
    sleep 2
done

echo ""
echo "✅ GitHub RunnerHub deployed to 192.168.1.16!"
echo ""
echo "📱 Dashboard: http://192.168.1.16:8080"
echo "🔧 API: http://192.168.1.16:8300"
echo ""
docker ps | grep runnerhub
SCRIPT

# Deploy to 192.168.1.16
scp -i ~/.ssh/git-runner_rsa /tmp/install-on-16.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/install-on-16.sh && bash /tmp/install-on-16.sh"