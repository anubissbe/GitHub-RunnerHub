#!/bin/bash

echo "🚀 Setting up GitHub RunnerHub with Auto-Scaling System..."

# Configuration
GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
MIN_FREE_RUNNERS=5
SCALE_INCREMENT=5
SCALE_THRESHOLD=0.8

# Create the complete auto-scaling system
cat > /tmp/setup-autoscaling.sh << 'EOF'
#!/bin/bash

echo "📦 Installing GitHub RunnerHub Auto-Scaling System..."

# Stop and remove all existing runners to start fresh
echo "🧹 Cleaning up existing runners..."
docker ps -a --format '{{.Names}}' | grep -E '(runner-|runnerhub-)' | xargs -r docker rm -f

# Create directory structure
mkdir -p /opt/runnerhub/{config,scripts,logs}
cd /opt/runnerhub

# Create the auto-scaling engine
cat > /opt/runnerhub/scripts/autoscale-engine.js << 'AUTOSCALE'
const Docker = require('dockerode');
const { Octokit } = require('@octokit/rest');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const config = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || 'YOUR_GITHUB_TOKEN_HERE',
  GITHUB_ORG: 'anubissbe',
  MIN_FREE_RUNNERS: 5,
  MAX_RUNNERS: 100,
  SCALE_INCREMENT: 5,
  SCALE_THRESHOLD: 0.8,
  CHECK_INTERVAL: 30000, // 30 seconds
  repositories: [
    'GitHub-RunnerHub', 'ProjectHub-Mcp', 'JarvisAI', 'ai-video-studio',
    'ai-music-studio', 'alicia-analytics', 'alicia-document-assistant',
    'checkmarx-dashboards', 'image-gen', 'Jarvis2.0', 'mcp-enhanced-workspace',
    'mcp-jarvis', 'threat-modeling-platform', 'Wan2GPExtended'
  ]
};

const octokit = new Octokit({ auth: config.GITHUB_TOKEN });
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// State management
let state = {
  runners: [],
  jobs: [],
  workflows: [],
  metrics: {
    totalRunners: 0,
    onlineRunners: 0,
    busyRunners: 0,
    freeRunners: 0,
    utilizationRate: 0,
    scalingEvents: []
  },
  lastUpdate: null,
  isScaling: false
};

// WebSocket broadcasting
function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Get all runners across repositories
async function getAllRunners() {
  console.log('📊 Fetching runners from all repositories...');
  const allRunners = [];
  
  for (const repo of config.repositories) {
    try {
      const { data } = await octokit.rest.actions.listSelfHostedRunnersForRepo({
        owner: config.GITHUB_ORG,
        repo: repo,
        per_page: 100
      });
      
      const runnersWithRepo = data.runners.map(runner => ({
        ...runner,
        repository: repo,
        globalId: `${repo}-${runner.id}`
      }));
      
      allRunners.push(...runnersWithRepo);
    } catch (error) {
      console.error(`Error fetching runners from ${repo}:`, error.message);
    }
  }
  
  return allRunners;
}

// Get active jobs and workflows
async function getActiveWorkloads() {
  const allJobs = [];
  const allWorkflows = [];
  
  for (const repo of config.repositories) {
    try {
      // Get active workflows
      const { data: workflows } = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner: config.GITHUB_ORG,
        repo: repo,
        status: 'in_progress',
        per_page: 20
      });
      
      allWorkflows.push(...workflows.workflow_runs);
      
      // Get jobs
      for (const workflow of workflows.workflow_runs) {
        try {
          const { data: jobsData } = await octokit.rest.actions.listJobsForWorkflowRun({
            owner: config.GITHUB_ORG,
            repo: repo,
            run_id: workflow.id
          });
          allJobs.push(...jobsData.jobs);
        } catch (error) {
          console.error(`Error fetching jobs for workflow ${workflow.id}:`, error.message);
        }
      }
    } catch (error) {
      console.error(`Error fetching workloads from ${repo}:`, error.message);
    }
  }
  
  return { jobs: allJobs, workflows: allWorkflows };
}

// Create a new runner
async function spawnRunner(targetRepo = null) {
  const runnerId = Math.random().toString(36).substr(2, 6);
  const runnerName = `runnerhub-auto-${runnerId}`;
  
  // Select repository (round-robin if not specified)
  const repo = targetRepo || config.repositories[Math.floor(Math.random() * config.repositories.length)];
  
  try {
    console.log(`🚀 Spawning runner ${runnerName} for ${repo}...`);
    
    // Get registration token
    const { data: token } = await octokit.rest.actions.createRegistrationTokenForRepo({
      owner: config.GITHUB_ORG,
      repo: repo
    });
    
    // Create container
    const container = await docker.createContainer({
      Image: 'myoung34/github-runner:latest',
      name: runnerName,
      Env: [
        `RUNNER_TOKEN=${token.token}`,
        `RUNNER_NAME=${runnerName}`,
        `RUNNER_WORKDIR=/tmp/runner/work`,
        `LABELS=self-hosted,Linux,X64,docker,runnerhub,auto-scaled`,
        `REPO_URL=https://github.com/${config.GITHUB_ORG}/${repo}`
      ],
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: ['/var/run/docker.sock:/var/run/docker.sock']
      }
    });
    
    await container.start();
    console.log(`✅ Spawned ${runnerName} for ${repo}`);
    
    // Log scaling event
    state.metrics.scalingEvents.push({
      type: 'spawn',
      runner: runnerName,
      repository: repo,
      timestamp: new Date()
    });
    
    return { name: runnerName, repository: repo };
  } catch (error) {
    console.error(`Failed to spawn runner: ${error.message}`);
    throw error;
  }
}

// Remove idle runner
async function removeRunner(runner) {
  try {
    console.log(`🗑️ Removing idle runner ${runner.name}...`);
    
    // Remove from GitHub
    await octokit.rest.actions.deleteSelfHostedRunnerFromRepo({
      owner: config.GITHUB_ORG,
      repo: runner.repository,
      runner_id: runner.id
    });
    
    // Stop container
    const containers = await docker.listContainers({ all: true });
    const container = containers.find(c => c.Names.includes(`/${runner.name}`));
    if (container) {
      const dockerContainer = docker.getContainer(container.Id);
      await dockerContainer.stop();
      await dockerContainer.remove();
    }
    
    // Log scaling event
    state.metrics.scalingEvents.push({
      type: 'remove',
      runner: runner.name,
      repository: runner.repository,
      timestamp: new Date()
    });
    
    console.log(`✅ Removed ${runner.name}`);
  } catch (error) {
    console.error(`Failed to remove runner ${runner.name}: ${error.message}`);
  }
}

// Auto-scaling logic
async function performAutoScaling() {
  if (state.isScaling) return;
  
  try {
    state.isScaling = true;
    
    // Calculate current state
    const onlineRunners = state.runners.filter(r => r.status === 'online');
    const busyRunners = onlineRunners.filter(r => r.busy);
    const freeRunners = onlineRunners.length - busyRunners.length;
    const utilizationRate = onlineRunners.length > 0 ? busyRunners.length / onlineRunners.length : 0;
    
    console.log(`📊 Auto-scaling check: ${onlineRunners.length} online, ${busyRunners.length} busy, ${freeRunners} free`);
    
    // Scale UP if we have less than MIN_FREE_RUNNERS free
    if (freeRunners < config.MIN_FREE_RUNNERS && state.runners.length < config.MAX_RUNNERS) {
      const needed = config.MIN_FREE_RUNNERS - freeRunners;
      console.log(`📈 Scaling UP: Need ${needed} more runners to maintain ${config.MIN_FREE_RUNNERS} free`);
      
      for (let i = 0; i < needed; i++) {
        await spawnRunner();
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay between spawns
      }
      
      broadcast('scale', {
        type: 'up',
        count: needed,
        reason: `Maintaining ${config.MIN_FREE_RUNNERS} free runners`
      });
    }
    
    // Scale UP if utilization is too high
    else if (utilizationRate >= config.SCALE_THRESHOLD && state.runners.length < config.MAX_RUNNERS) {
      console.log(`📈 Scaling UP: High utilization (${(utilizationRate * 100).toFixed(1)}%)`);
      
      for (let i = 0; i < config.SCALE_INCREMENT; i++) {
        await spawnRunner();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      broadcast('scale', {
        type: 'up',
        count: config.SCALE_INCREMENT,
        reason: `High utilization: ${(utilizationRate * 100).toFixed(1)}%`
      });
    }
    
    // Scale DOWN if we have too many idle runners
    else if (freeRunners > config.MIN_FREE_RUNNERS * 2 && onlineRunners.length > config.MIN_FREE_RUNNERS) {
      const toRemove = Math.min(
        freeRunners - config.MIN_FREE_RUNNERS,
        config.SCALE_INCREMENT
      );
      
      console.log(`📉 Scaling DOWN: Removing ${toRemove} excess idle runners`);
      
      const idleRunners = onlineRunners.filter(r => !r.busy).slice(0, toRemove);
      for (const runner of idleRunners) {
        await removeRunner(runner);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      broadcast('scale', {
        type: 'down',
        count: toRemove,
        reason: 'Excess idle runners'
      });
    }
    
  } finally {
    state.isScaling = false;
  }
}

// Update system state
async function updateState() {
  try {
    console.log('🔄 Updating system state...');
    
    // Get all data
    const runners = await getAllRunners();
    const { jobs, workflows } = await getActiveWorkloads();
    
    // Calculate metrics
    const onlineRunners = runners.filter(r => r.status === 'online');
    const busyRunners = onlineRunners.filter(r => r.busy);
    
    state = {
      runners,
      jobs,
      workflows,
      metrics: {
        totalRunners: runners.length,
        onlineRunners: onlineRunners.length,
        busyRunners: busyRunners.length,
        freeRunners: onlineRunners.length - busyRunners.length,
        utilizationRate: onlineRunners.length > 0 ? busyRunners.length / onlineRunners.length : 0,
        scalingEvents: state.metrics.scalingEvents.slice(-20) // Keep last 20 events
      },
      lastUpdate: new Date()
    };
    
    // Broadcast updates
    broadcast('update', state);
    
    // Perform auto-scaling
    await performAutoScaling();
    
  } catch (error) {
    console.error('Error updating state:', error);
  }
}

// API endpoints
app.get('/api/runners', (req, res) => res.json(state.runners));
app.get('/api/jobs/active', (req, res) => res.json(state.jobs));
app.get('/api/workflows/active', (req, res) => res.json(state.workflows));
app.get('/api/metrics', (req, res) => res.json(state.metrics));
app.get('/api/alerts', (req, res) => res.json([]));
app.get('/health', (req, res) => res.json({ status: 'ok', ...state.metrics }));

// WebSocket endpoint
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  ws.send(JSON.stringify({ type: 'welcome', data: state }));
});

// Initialize system
async function initialize() {
  console.log('🚀 Initializing GitHub RunnerHub Auto-Scaling System...');
  
  // Initial update
  await updateState();
  
  // Ensure minimum runners
  if (state.metrics.onlineRunners < config.MIN_FREE_RUNNERS) {
    console.log(`📦 Creating initial ${config.MIN_FREE_RUNNERS} runners...`);
    for (let i = 0; i < config.MIN_FREE_RUNNERS; i++) {
      await spawnRunner();
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Start periodic updates
  setInterval(updateState, config.CHECK_INTERVAL);
  
  // Start server
  server.listen(8300, '0.0.0.0', () => {
    console.log('✅ RunnerHub Auto-Scaling System running on port 8300');
    console.log(`📊 Monitoring ${config.repositories.length} repositories`);
    console.log(`🎯 Maintaining ${config.MIN_FREE_RUNNERS} free runners at all times`);
  });
}

// Start the system
initialize().catch(console.error);
AUTOSCALE

# Create package.json
cat > /opt/runnerhub/package.json << 'PACKAGE'
{
  "name": "github-runnerhub-autoscale",
  "version": "2.0.0",
  "description": "GitHub RunnerHub with Auto-Scaling",
  "main": "scripts/autoscale-engine.js",
  "scripts": {
    "start": "node scripts/autoscale-engine.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "@octokit/rest": "^20.0.2",
    "dockerode": "^4.0.2",
    "ws": "^8.16.0"
  }
}
PACKAGE

# Install dependencies
cd /opt/runnerhub
npm install

# Stop old backend
docker stop runnerhub-backend 2>/dev/null || true
docker rm runnerhub-backend 2>/dev/null || true

# Create systemd service for auto-start
cat > /tmp/runnerhub-autoscale.service << 'SERVICE'
[Unit]
Description=GitHub RunnerHub Auto-Scaling System
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=10
WorkingDirectory=/opt/runnerhub
ExecStart=/usr/bin/node /opt/runnerhub/scripts/autoscale-engine.js
StandardOutput=append:/opt/runnerhub/logs/autoscale.log
StandardError=append:/opt/runnerhub/logs/autoscale-error.log

[Install]
WantedBy=multi-user.target
SERVICE

# Start the auto-scaling system
cd /opt/runnerhub
nohup node scripts/autoscale-engine.js > logs/autoscale.log 2>&1 &

echo "✅ Auto-Scaling System Started!"
echo ""
echo "📊 System Configuration:"
echo "   - Minimum free runners: 5"
echo "   - Scale increment: 5 runners"
echo "   - Scale threshold: 80% utilization"
echo "   - Monitoring: All repositories"
echo ""
echo "🔍 Check logs: tail -f /opt/runnerhub/logs/autoscale.log"
EOF

chmod +x /tmp/setup-autoscaling.sh

# Deploy to server
echo "🚀 Deploying Auto-Scaling System to server..."
scp /tmp/setup-autoscaling.sh remote-server:/tmp/
ssh remote-server "bash /tmp/setup-autoscaling.sh"