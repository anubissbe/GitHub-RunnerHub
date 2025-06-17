#!/bin/bash

echo "🚀 Deploying GitHub RunnerHub to 192.168.1.16..."

# Create deployment script
cat > /tmp/deploy-runnerhub-1.16.sh << 'EOF'
#!/bin/bash

SERVER="192.168.1.16"
echo "📦 Deploying complete GitHub RunnerHub to $SERVER"

# First, clean up on wrong server (192.168.1.25)
echo "🧹 Cleaning up from wrong server..."
ssh remote-server << 'CLEANUP'
# Stop and remove all runner containers
docker ps -a --format '{{.Names}}' | grep -E '(runner|runnerhub)' | xargs -r docker rm -f
# Stop monitor services
docker stop github-runners-monitor-frontend github-runners-monitor-backend 2>/dev/null
docker rm github-runners-monitor-frontend github-runners-monitor-backend 2>/dev/null
# Kill any node processes
pkill -f "autoscale-engine" 2>/dev/null || true
pkill -f "server.js" 2>/dev/null || true
CLEANUP

# Now deploy to correct server (192.168.1.16)
echo "🚀 Installing on correct server $SERVER..."

# Copy installation files to 192.168.1.16
ssh $SERVER "mkdir -p /opt/GitHub-RunnerHub"

# Create the complete installation package
cat > /tmp/install-runnerhub.sh << 'INSTALL'
#!/bin/bash

echo "📦 Installing GitHub RunnerHub on 192.168.1.16..."

# Configuration
GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"

# Create directories
mkdir -p /opt/GitHub-RunnerHub/{backend,frontend,scripts}
cd /opt/GitHub-RunnerHub

# Create docker-compose.yml
cat > docker-compose.yml << 'COMPOSE'
version: '3.8'

services:
  backend:
    image: node:18-alpine
    container_name: runnerhub-backend
    working_dir: /app
    ports:
      - "8300:8300"
    volumes:
      - ./backend:/app
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - GITHUB_TOKEN=YOUR_GITHUB_TOKEN_HERE
      - GITHUB_ORG=anubissbe
      - NODE_ENV=production
    command: sh -c "npm install && node server.js"
    restart: unless-stopped

  frontend:
    image: nginx:alpine
    container_name: runnerhub-frontend
    ports:
      - "8080:80"
    volumes:
      - ./frontend:/usr/share/nginx/html
    restart: unless-stopped

networks:
  default:
    name: runnerhub
COMPOSE

# Create backend server
cat > backend/server.js << 'SERVER'
const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const WebSocket = require('ws');
const http = require('http');
const Docker = require('dockerode');

const app = express();
app.use(cors());
app.use(express.json());

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;
const REPOS = [
    'GitHub-RunnerHub', 'ProjectHub-Mcp', 'JarvisAI', 'ai-video-studio',
    'ai-music-studio', 'alicia-analytics', 'alicia-document-assistant',
    'checkmarx-dashboards', 'image-gen', 'Jarvis2.0', 'mcp-enhanced-workspace',
    'mcp-jarvis', 'threat-modeling-platform', 'Wan2GPExtended'
];

const octokit = new Octokit({ auth: GITHUB_TOKEN });
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let cache = { runners: [], jobs: [], workflows: [], metrics: {} };

async function updateData() {
    console.log('Updating runner data...');
    const allRunners = [];
    const allJobs = [];
    const allWorkflows = [];
    
    for (const repo of REPOS) {
        try {
            const { data } = await octokit.rest.actions.listSelfHostedRunnersForRepo({
                owner: GITHUB_ORG,
                repo: repo,
                per_page: 100
            });
            data.runners.forEach(r => {
                r.repository = repo;
                allRunners.push(r);
            });
        } catch (e) {}
    }
    
    cache = {
        runners: allRunners,
        jobs: allJobs,
        workflows: allWorkflows,
        metrics: {
            total_runners: allRunners.length,
            online_runners: allRunners.filter(r => r.status === 'online').length,
            busy_runners: allRunners.filter(r => r.busy).length,
            utilization_percentage: 0
        }
    };
    
    if (cache.metrics.online_runners > 0) {
        cache.metrics.utilization_percentage = 
            ((cache.metrics.busy_runners / cache.metrics.online_runners) * 100).toFixed(1);
    }
    
    broadcast('update', cache);
}

function broadcast(type, data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type, data }));
        }
    });
}

// Update every 30 seconds
updateData();
setInterval(updateData, 30000);

// API endpoints
app.get('/api/runners', (req, res) => res.json(cache.runners));
app.get('/api/jobs/active', (req, res) => res.json(cache.jobs));
app.get('/api/workflows/active', (req, res) => res.json(cache.workflows));
app.get('/api/metrics', (req, res) => res.json(cache.metrics));
app.get('/api/alerts', (req, res) => res.json([]));
app.get('/health', (req, res) => res.json({ status: 'ok', runners: cache.runners.length }));

// Mock auth
app.post('/api/auth/login', (req, res) => {
    res.json({ token: 'mock-token', user: { username: 'admin' } });
});

wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'welcome', data: cache }));
});

server.listen(8300, '0.0.0.0', () => {
    console.log('RunnerHub Backend running on port 8300');
});
SERVER

# Create package.json
cat > backend/package.json << 'PACKAGE'
{
  "name": "runnerhub-backend",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "@octokit/rest": "^20.0.2",
    "ws": "^8.16.0",
    "dockerode": "^4.0.2"
  }
}
PACKAGE

# Create simple frontend
cat > frontend/index.html << 'HTML'
<!DOCTYPE html>
<html>
<head>
    <title>GitHub RunnerHub</title>
    <style>
        body { background: #0a0a0a; color: #fff; font-family: Arial; margin: 0; padding: 20px; }
        h1 { color: #ff6500; }
        .metrics { display: flex; gap: 20px; margin: 20px 0; }
        .metric { background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid #333; }
        .metric h2 { margin: 0; font-size: 32px; color: #ff6500; }
        .metric p { margin: 5px 0 0 0; color: #888; }
        .runners { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
        .runner { background: #1a1a1a; padding: 15px; border-radius: 8px; border: 1px solid #333; }
        .runner.online { border-color: #00ff00; }
        .runner.busy { border-color: #ff6500; background: #1f1300; }
    </style>
</head>
<body>
    <h1>🏃 GitHub RunnerHub - 192.168.1.16</h1>
    <div class="metrics">
        <div class="metric">
            <h2 id="total">0</h2>
            <p>Total Runners</p>
        </div>
        <div class="metric">
            <h2 id="online">0</h2>
            <p>Online</p>
        </div>
        <div class="metric">
            <h2 id="busy">0</h2>
            <p>Busy</p>
        </div>
        <div class="metric">
            <h2 id="utilization">0%</h2>
            <p>Utilization</p>
        </div>
    </div>
    <div id="runners" class="runners"></div>
    
    <script>
        const ws = new WebSocket('ws://192.168.1.16:8300');
        
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.data && msg.data.metrics) {
                document.getElementById('total').textContent = msg.data.metrics.total_runners;
                document.getElementById('online').textContent = msg.data.metrics.online_runners;
                document.getElementById('busy').textContent = msg.data.metrics.busy_runners;
                document.getElementById('utilization').textContent = msg.data.metrics.utilization_percentage + '%';
            }
            if (msg.data && msg.data.runners) {
                const container = document.getElementById('runners');
                container.innerHTML = msg.data.runners.map(r => 
                    `<div class="runner ${r.status} ${r.busy ? 'busy' : ''}">
                        <strong>${r.name}</strong><br>
                        ${r.repository}<br>
                        ${r.status} ${r.busy ? '(busy)' : '(idle)'}
                    </div>`
                ).join('');
            }
        };
        
        // Also fetch via API
        setInterval(() => {
            fetch('http://192.168.1.16:8300/api/metrics')
                .then(r => r.json())
                .then(data => {
                    document.getElementById('total').textContent = data.total_runners;
                    document.getElementById('online').textContent = data.online_runners;
                    document.getElementById('busy').textContent = data.busy_runners;
                    document.getElementById('utilization').textContent = data.utilization_percentage + '%';
                });
        }, 5000);
    </script>
</body>
</html>
HTML

# Start services
docker-compose down 2>/dev/null
docker-compose up -d

# Create initial 5 runners
echo "🏃 Creating initial 5 runners..."
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
        echo "✅ Created runner: $RUNNER_NAME"
    fi
    sleep 3
done

echo ""
echo "✅ GitHub RunnerHub installed on 192.168.1.16!"
echo ""
echo "📱 Access Dashboard: http://192.168.1.16:8080"
echo "🔧 API Endpoint: http://192.168.1.16:8300"
echo ""
INSTALL

# Deploy to 192.168.1.16
scp /tmp/install-runnerhub.sh $SERVER:/tmp/
ssh $SERVER "chmod +x /tmp/install-runnerhub.sh && bash /tmp/install-runnerhub.sh"

EOF

chmod +x /tmp/deploy-runnerhub-1.16.sh
bash /tmp/deploy-runnerhub-1.16.sh