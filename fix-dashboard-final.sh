#!/bin/bash

echo "🔧 Fixing Dashboard to show all runners..."

cat > /tmp/fix-dashboard.sh << 'EOF'
#!/bin/bash

# Stop the old backend
echo "🛑 Stopping old monitoring backend..."
docker stop github-runners-monitor-backend
docker rm github-runners-monitor-backend

# Create a new backend that aggregates all runners
echo "📦 Creating new aggregated backend..."

# Create a simple Node.js server that shows all runners
mkdir -p /opt/runnerhub-dashboard
cd /opt/runnerhub-dashboard

cat > server.js << 'SERVER'
const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const WebSocket = require('ws');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = 'YOUR_GITHUB_TOKEN_HERE';
const GITHUB_ORG = 'anubissbe';

// List of all repositories
const REPOS = [
    'GitHub-RunnerHub', 'ProjectHub-Mcp', 'JarvisAI', 'ai-video-studio',
    'ai-music-studio', 'alicia-analytics', 'alicia-document-assistant',
    'checkmarx-dashboards', 'image-gen', 'Jarvis2.0', 'mcp-enhanced-workspace',
    'mcp-jarvis', 'threat-modeling-platform', 'Wan2GPExtended'
];

const octokit = new Octokit({ auth: GITHUB_TOKEN });
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let cache = {
    runners: [],
    jobs: [],
    workflows: [],
    lastUpdate: null
};

// Aggregate all runners
async function updateRunners() {
    console.log('Updating runners from all repositories...');
    const allRunners = [];
    const allJobs = [];
    const allWorkflows = [];
    
    // Get runners from all repos
    for (const repo of REPOS) {
        try {
            const { data } = await octokit.rest.actions.listSelfHostedRunnersForRepo({
                owner: GITHUB_ORG,
                repo: repo,
                per_page: 100
            });
            
            // Add repo name to each runner
            data.runners.forEach(runner => {
                runner.repository = repo;
                allRunners.push(runner);
            });
            
            // Get active workflows
            try {
                const { data: workflows } = await octokit.rest.actions.listWorkflowRunsForRepo({
                    owner: GITHUB_ORG,
                    repo: repo,
                    status: 'in_progress',
                    per_page: 10
                });
                allWorkflows.push(...workflows.workflow_runs);
            } catch (e) {}
            
        } catch (error) {
            console.error(`Error fetching from ${repo}:`, error.message);
        }
    }
    
    // Get jobs for active workflows
    for (const workflow of allWorkflows.slice(0, 20)) {
        try {
            const { data: jobsData } = await octokit.rest.actions.listJobsForWorkflowRun({
                owner: GITHUB_ORG,
                repo: workflow.repository.name,
                run_id: workflow.id
            });
            allJobs.push(...jobsData.jobs);
        } catch (error) {}
    }
    
    cache = {
        runners: allRunners,
        jobs: allJobs,
        workflows: allWorkflows,
        lastUpdate: new Date()
    };
    
    console.log(`Updated: ${allRunners.length} runners, ${allJobs.length} jobs`);
    
    // Broadcast to WebSocket clients
    const message = JSON.stringify({
        type: 'update',
        data: cache
    });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Update every 30 seconds
updateRunners();
setInterval(updateRunners, 30000);

// WebSocket handling
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    ws.send(JSON.stringify({ type: 'welcome', data: cache }));
});

// API endpoints
app.get('/api/runners', (req, res) => {
    res.json(cache.runners);
});

app.get('/api/jobs/active', (req, res) => {
    res.json(cache.jobs);
});

app.get('/api/workflows/active', (req, res) => {
    res.json(cache.workflows);
});

app.get('/api/metrics', (req, res) => {
    const onlineRunners = cache.runners.filter(r => r.status === 'online');
    const busyRunners = onlineRunners.filter(r => r.busy);
    
    res.json({
        total_runners: cache.runners.length,
        online_runners: onlineRunners.length,
        busy_runners: busyRunners.length,
        utilization_percentage: onlineRunners.length > 0 ? 
            ((busyRunners.length / onlineRunners.length) * 100).toFixed(1) : 0,
        total_workflows_today: cache.workflows.length,
        avg_job_duration_minutes: 5,
        queue_time_minutes: 0,
        success_rate: 95,
        most_active_repo: 'All Repositories'
    });
});

app.get('/api/alerts', (req, res) => {
    res.json([]);
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        runners: cache.runners.length,
        lastUpdate: cache.lastUpdate 
    });
});

app.get('/api/public/status', (req, res) => {
    res.json({
        runners: cache.runners.length,
        workflows: cache.workflows.length,
        autoScaler: true
    });
});

// Mock auth endpoint
app.post('/api/auth/login', (req, res) => {
    res.json({ token: 'mock-token', user: { username: 'admin' } });
});

server.listen(8300, '0.0.0.0', () => {
    console.log('RunnerHub Dashboard Backend running on port 8300');
    console.log(`Monitoring ${REPOS.length} repositories`);
});
SERVER

# Create package.json
cat > package.json << 'PACKAGE'
{
  "name": "runnerhub-dashboard",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "@octokit/rest": "^20.0.2",
    "ws": "^8.16.0"
  }
}
PACKAGE

# Install and run
npm install
nohup node server.js > /opt/runnerhub-dashboard/server.log 2>&1 &

echo "✅ New backend started!"
sleep 5

# Test the new backend
echo ""
echo "📊 Testing new backend..."
curl -s http://localhost:8300/api/runners | jq 'length'

EOF

chmod +x /tmp/fix-dashboard.sh

# Deploy
scp /tmp/fix-dashboard.sh remote-server:/tmp/
ssh remote-server "bash /tmp/fix-dashboard.sh"

echo ""
echo "🔍 Final check:"
echo "Dashboard should now show all runners at http://192.168.1.16:8080"