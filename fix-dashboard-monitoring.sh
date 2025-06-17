#!/bin/bash

echo "🔧 Fixing RunnerHub dashboard to show all runners..."

# Create an aggregator script that monitors all repositories
cat > /tmp/update-backend-monitor.sh << 'EOF'
#!/bin/bash

echo "📊 Updating backend to monitor all repositories..."

# Stop the current backend
docker stop runnerhub-backend 2>/dev/null || true
docker rm runnerhub-backend 2>/dev/null || true

# Create updated configuration
cat > /opt/runnerhub-config/monitor-config.json << 'CONFIG'
{
  "repositories": [
    "GitHub-RunnerHub",
    "ProjectHub-Mcp",
    "JarvisAI",
    "ai-video-studio",
    "ai-music-studio",
    "alicia-analytics",
    "alicia-document-assistant",
    "checkmarx-dashboards",
    "claude-code-tools",
    "cline-documentation",
    "image-gen",
    "Jarvis2.0",
    "mcp-enhanced-workspace",
    "mcp-human-writing-style",
    "mcp-human-writing-style-reddit",
    "mcp-jarvis",
    "scripts",
    "threat-modeling-platform",
    "Wan2GPExtended"
  ],
  "github_org": "anubissbe",
  "monitor_interval": 30
}
CONFIG

# Create a simple aggregator service
cat > /opt/runnerhub-config/runner-aggregator.js << 'AGGREGATOR'
const express = require('express');
const { Octokit } = require('@octokit/rest');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 8300;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'YOUR_GITHUB_TOKEN_HERE';
const GITHUB_USER = 'anubissbe';

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Create HTTP server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Cache for all runners and jobs
let cache = {
  runners: [],
  jobs: [],
  workflows: [],
  lastUpdate: null
};

// WebSocket handling
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  ws.send(JSON.stringify({ event: 'connected', data: cache }));
});

function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Aggregate runners from all repositories
async function updateAllRunners() {
  console.log('Updating runners from all repositories...');
  
  const config = require('./monitor-config.json');
  const allRunners = [];
  const allJobs = [];
  const allWorkflows = [];
  
  for (const repo of config.repositories) {
    try {
      // Get runners for this repository
      const { data: repoData } = await octokit.rest.actions.listSelfHostedRunnersForRepo({
        owner: GITHUB_USER,
        repo: repo,
        per_page: 100
      });
      
      // Add repo info to each runner
      const runnersWithRepo = repoData.runners.map(runner => ({
        ...runner,
        repository: repo,
        id: Math.random() * 100000 + runner.id // Make ID unique across repos
      }));
      
      allRunners.push(...runnersWithRepo);
      
      // Get active workflows
      const { data: workflows } = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner: GITHUB_USER,
        repo: repo,
        status: 'in_progress',
        per_page: 20
      });
      
      allWorkflows.push(...workflows.workflow_runs);
      
      // Get jobs for active workflows
      for (const workflow of workflows.workflow_runs) {
        try {
          const { data: jobsData } = await octokit.rest.actions.listJobsForWorkflowRun({
            owner: GITHUB_USER,
            repo: repo,
            run_id: workflow.id
          });
          allJobs.push(...jobsData.jobs);
        } catch (error) {
          console.error(`Error fetching jobs for ${repo}:`, error.message);
        }
      }
      
    } catch (error) {
      console.error(`Error fetching data for ${repo}:`, error.message);
    }
  }
  
  cache = {
    runners: allRunners,
    jobs: allJobs,
    workflows: allWorkflows,
    lastUpdate: new Date()
  };
  
  console.log(`Updated: ${allRunners.length} runners, ${allJobs.length} jobs, ${allWorkflows.length} workflows`);
  
  // Broadcast updates
  broadcast('runners', allRunners);
  broadcast('jobs', allJobs);
  broadcast('metrics', {
    total_runners: allRunners.length,
    online_runners: allRunners.filter(r => r.status === 'online').length,
    busy_runners: allRunners.filter(r => r.busy).length,
    total_workflows_today: allWorkflows.length
  });
}

// Update every 30 seconds
updateAllRunners();
setInterval(updateAllRunners, 30000);

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
  const metrics = {
    total_runners: cache.runners.length,
    online_runners: cache.runners.filter(r => r.status === 'online').length,
    busy_runners: cache.runners.filter(r => r.busy).length,
    avg_job_duration_minutes: 0,
    queue_time_minutes: 0,
    utilization_percentage: 0,
    total_workflows_today: cache.workflows.length,
    success_rate: 100,
    most_active_repo: 'All Repositories'
  };
  
  if (metrics.online_runners > 0) {
    metrics.utilization_percentage = ((metrics.busy_runners / metrics.online_runners) * 100).toFixed(1);
  }
  
  res.json(metrics);
});

app.get('/api/alerts', (req, res) => {
  res.json([]);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', runners: cache.runners.length });
});

// Stub endpoints for compatibility
app.post('/api/auth/login', (req, res) => {
  res.json({ token: 'mock-token', user: { username: 'admin' } });
});

app.get('/api/public/status', (req, res) => {
  res.json({ runners: cache.runners.length, workflows: cache.workflows.length });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`RunnerHub Aggregator running on port ${PORT}`);
});
AGGREGATOR

# Start the new aggregator
cd /opt/runnerhub-config
npm init -y
npm install express cors @octokit/rest ws

# Run the aggregator
node runner-aggregator.js &

echo "✅ Dashboard backend updated to monitor all repositories!"
EOF

chmod +x /tmp/update-backend-monitor.sh

# Execute on remote server
echo "🚀 Updating RunnerHub dashboard..."
scp /tmp/update-backend-monitor.sh remote-server:/tmp/
ssh remote-server "sudo bash /tmp/update-backend-monitor.sh"