const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const AutoScaler = require('./auto-scaler');
const WebSocket = require('ws');
const http = require('http');
const { jwtAuth, setupAuthEndpoints } = require('./auth/jwt-middleware');
const { setupAPIKeyEndpoints } = require('./auth/api-key-manager');
const { createAuthMiddleware } = require('./auth/combined-auth');

const app = express();
app.use(cors());
app.use(express.json());

// Import rate limiting
const { rateLimiters, globalRateLimit } = require('./middleware/rate-limiter');

// Apply global rate limit
app.use(globalRateLimit({
  windowMs: 900000,  // 15 minutes
  max: 1000,         // 1000 requests per window
  message: 'Too many requests from this IP, please try again later'
}));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PORT = process.env.PORT || 8300;

console.log('Starting GitHub RunnerHub backend...');
console.log('Port:', PORT);
console.log('GitHub Token present:', !!GITHUB_TOKEN);

const octokit = new Octokit({
  auth: GITHUB_TOKEN || undefined,
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  
  ws.on('error', console.error);
  
  // Send initial data
  ws.send(JSON.stringify({
    event: 'connected',
    data: { message: 'Connected to GitHub RunnerHub' }
  }));
});

// Broadcast function with error handling
function broadcast(type, data) {
  const message = JSON.stringify({ 
    type, 
    data,
    timestamp: new Date().toISOString()
  });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('Error broadcasting to client:', error.message);
      }
    }
  });
}

// Initialize Auto-Scaler
let autoScaler = null;
if (GITHUB_TOKEN && process.env.GITHUB_ORG && process.env.GITHUB_REPO) {
  autoScaler = new AutoScaler({
    GITHUB_TOKEN,
    GITHUB_ORG: process.env.GITHUB_ORG,
    GITHUB_REPO: process.env.GITHUB_REPO,
    MIN_RUNNERS: parseInt(process.env.MIN_RUNNERS) || 5,
    MAX_RUNNERS: parseInt(process.env.MAX_RUNNERS) || 50,
    SCALE_THRESHOLD: parseFloat(process.env.SCALE_THRESHOLD) || 0.8,
    SCALE_INCREMENT: parseInt(process.env.SCALE_INCREMENT) || 5,
    COOLDOWN_PERIOD: parseInt(process.env.COOLDOWN_PERIOD) || 300,
    IDLE_TIMEOUT: parseInt(process.env.IDLE_TIMEOUT) || 1800
  });

  // Start auto-scaler
  autoScaler.start().catch(console.error);

  // Listen for scaling events
  autoScaler.onScale((event, data) => {
    broadcast('scale', data);
  });
} else {
  console.warn('Auto-scaler not initialized. Missing required environment variables.');
}

// Cache for API responses
let cache = {
  runners: [],
  workflows: [],
  jobs: [],
  lastUpdate: null
};

// Update cache every 30 seconds
async function updateCache() {
  try {
    console.log('Updating cache...');
    
    // Get real runners if we have auth
    if (GITHUB_TOKEN && process.env.GITHUB_ORG && process.env.GITHUB_REPO) {
      try {
        const runnersResponse = await octokit.rest.actions.listSelfHostedRunnersForRepo({
          owner: process.env.GITHUB_ORG,
          repo: process.env.GITHUB_REPO,
          per_page: 100
        });
        cache.runners = runnersResponse.data.runners || [];
      } catch (error) {
        console.error('Error fetching runners:', error.message);
        // Use mock runners if API fails
        cache.runners = generateMockRunners();
      }
    } else {
      // Use mock runners
      cache.runners = generateMockRunners();
    }
    
    // Fetch active workflows
    try {
      const org = process.env.GITHUB_ORG || 'anubissbe';
      const repo = process.env.GITHUB_REPO || 'ProjectHub-Mcp';
      
      const workflowsResponse = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner: org,
        repo: repo,
        status: 'in_progress',
        per_page: 100
      });
      cache.workflows = workflowsResponse.data.workflow_runs || [];
    } catch (error) {
      console.error('Error fetching workflows:', error.message);
    }
    
    // Fetch jobs for active workflows
    const allJobs = [];
    for (const workflow of cache.workflows) {
      try {
        const jobsResponse = await octokit.rest.actions.listJobsForWorkflowRun({
          owner: process.env.GITHUB_ORG || 'anubissbe',
          repo: process.env.GITHUB_REPO || 'ProjectHub-Mcp',
          run_id: workflow.id,
          per_page: 100
        });
        allJobs.push(...jobsResponse.data.jobs);
      } catch (error) {
        console.error(`Error fetching jobs for workflow ${workflow.id}:`, error.message);
      }
    }
    cache.jobs = allJobs;
    
    cache.lastUpdate = new Date();
    console.log(`Cache updated: ${cache.runners.length} runners, ${cache.workflows.length} workflows, ${cache.jobs.length} jobs`);
    
    // Broadcast updates with correct types
    broadcast('runners', cache.runners);
    broadcast('workflows', cache.workflows);
    broadcast('jobs', cache.jobs);
    broadcast('metrics', {
      total_runners: cache.runners.length,
      online_runners: cache.runners.filter(r => r.status === 'online').length,
      busy_runners: cache.runners.filter(r => r.busy).length,
      total_workflows_today: cache.workflows.length
    });
  } catch (error) {
    console.error('Error updating cache:', error.message);
  }
}

// Generate mock runners for demo
function generateMockRunners() {
  return Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    name: `github-runner-${i + 1}`,
    os: 'Linux',
    status: i >= 36 ? 'offline' : 'online',
    busy: i < 5, // First 5 are busy for demo
    labels: [
      { id: 1, name: 'self-hosted', type: 'read-only' },
      { id: 2, name: 'Linux', type: 'read-only' },
      { id: 3, name: 'X64', type: 'read-only' },
      { id: 4, name: 'docker', type: 'read-only' },
      { id: 5, name: 'auto-scaled', type: 'read-only' }
    ]
  }));
}

// Initialize cache
updateCache();
setInterval(updateCache, 30000);

// Setup authentication endpoints with rate limiting
setupAuthEndpoints(app, rateLimiters);

// Setup API key management endpoints
const apiKeyManager = setupAPIKeyEndpoints(app, jwtAuth);

// Create combined auth middleware
const auth = createAuthMiddleware(apiKeyManager);

// Public endpoints (no auth required)
app.get('/api/public/status', (req, res) => {
  res.json({
    runners: cache.runners.length,
    workflows: cache.workflows.length,
    autoScaler: !!autoScaler
  });
});

// Protected API endpoints (auth required - JWT or API key)
app.get('/api/runners', rateLimiters.read, auth.readAccess(), (req, res) => {
  res.json(cache.runners);
});

app.get('/api/workflows/active', rateLimiters.read, auth.readAccess(), (req, res) => {
  res.json(cache.workflows);
});

app.get('/api/jobs/active', rateLimiters.read, auth.readAccess(), (req, res) => {
  res.json(cache.jobs);
});

app.get('/api/metrics', auth.readAccess(), async (req, res) => {
  const metrics = {
    total_runners: cache.runners.length,
    online_runners: cache.runners.filter(r => r.status === 'online').length,
    busy_runners: cache.runners.filter(r => r.busy).length,
    avg_job_duration_minutes: 0,
    queue_time_minutes: 0,
    utilization_percentage: 0,
    total_workflows_today: cache.workflows.length,
    success_rate: 100,
    most_active_repo: process.env.GITHUB_REPO || 'ProjectHub-Mcp'
  };
  
  if (metrics.online_runners > 0) {
    metrics.utilization_percentage = (metrics.busy_runners / metrics.online_runners * 100).toFixed(1);
  }
  
  res.json(metrics);
});

// Auto-scaler status endpoint (admin only)
app.get('/api/scaler/status', auth.adminOnly(), async (req, res) => {
  if (!autoScaler) {
    return res.json({ 
      enabled: false, 
      message: 'Auto-scaler not configured' 
    });
  }
  
  const status = await autoScaler.getStatus();
  res.json({
    enabled: true,
    ...status
  });
});

// Runner lifecycle status endpoint
app.get('/api/runners/lifecycle', auth.readAccess(), async (req, res) => {
  if (!autoScaler) {
    return res.json({ 
      enabled: false, 
      message: 'Lifecycle manager not configured' 
    });
  }
  
  const lifecycleRunners = autoScaler.lifecycleManager.getAllRunners();
  res.json({
    enabled: true,
    runners: lifecycleRunners,
    summary: {
      total: lifecycleRunners.length,
      healthy: lifecycleRunners.filter(r => r.health === 'healthy').length,
      unhealthy: lifecycleRunners.filter(r => r.health === 'unhealthy').length,
      unknown: lifecycleRunners.filter(r => r.health === 'unknown').length
    }
  });
});

// Manual scaling endpoint (admin only or write access)
app.post('/api/runners/scale', rateLimiters.scaling, auth.writeAccess(), async (req, res) => {
  if (!autoScaler) {
    return res.status(400).json({ 
      error: 'Auto-scaler not configured' 
    });
  }
  
  const { action, count } = req.body;
  
  if (!['up', 'down'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Use "up" or "down"' });
  }
  
  try {
    if (action === 'up') {
      await autoScaler.scaleUp();
    } else {
      await autoScaler.scaleDown();
    }
    
    res.json({ success: true, action, message: `Scaling ${action} initiated` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alerts', auth.readAccess(), (req, res) => {
  res.json([]);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    lastUpdate: cache.lastUpdate,
    runners: cache.runners.length,
    workflows: cache.workflows.length,
    autoScaler: !!autoScaler
  });
});

// WebSocket endpoint
app.get('/ws', (req, res) => {
  res.status(426).send('Upgrade required');
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`GitHub RunnerHub backend running on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}`);
  if (autoScaler) {
    console.log('Auto-scaler is active and monitoring runner utilization');
  }
});