const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const AutoScaler = require('./auto-scaler');
const RunnerManager = require('./runner-manager');
const HybridScaler = require('./hybrid-scaler');
const PerRepositoryScaler = require('./per-repo-scaler');
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

// Apply global rate limit with exemptions for public endpoints
app.use(globalRateLimit({
  windowMs: 900000,  // 15 minutes
  max: 1000,         // 1000 requests per window
  message: 'Too many requests from this IP, please try again later',
  skip: (req) => {
    // Skip rate limiting for public endpoints
    const publicPaths = [
      '/api/public/runners',
      '/api/public/status', 
      '/api/public/docker-runners',
      '/api/test',
      '/health'
    ];
    
    // Also skip rate limiting for local/trusted IPs
    const trustedIPs = [
      '127.0.0.1',
      'localhost',
      '::1',
      '192.168.1.16',  // Runner host
      '192.168.1.24',  // Synology NAS
      '192.168.1.25'   // Remote server
    ];
    
    const clientIP = req.ip || req.connection.remoteAddress || '';
    const isLocalRequest = req.headers.host && req.headers.host.includes('localhost');
    const isTrustedIP = trustedIPs.some(ip => clientIP.includes(ip));
    
    return publicPaths.includes(req.path) || isLocalRequest || isTrustedIP;
  }
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
  
  // Send initial connection confirmation (README-compliant)
  ws.send(JSON.stringify({
    event: 'connected',
    data: { message: 'Connected to GitHub RunnerHub' },
    timestamp: new Date().toISOString()
  }));
});

// Broadcast function with README-compliant event structure
function broadcast(event, data) {
  const message = JSON.stringify({ 
    event, 
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

// Initialize Per-Repository Scaler (README-compliant implementation)
let perRepoScaler = null;
let runnerManager = null; // Keep for compatibility
let autoScaler = null; // Keep for compatibility

if (GITHUB_TOKEN && process.env.GITHUB_ORG) {
  // Initialize Per-Repository Scaler with exact README specifications
  perRepoScaler = new PerRepositoryScaler({
    GITHUB_TOKEN,
    GITHUB_ORG: process.env.GITHUB_ORG,
    REPOSITORIES: [
      'ai-music-studio',
      'mcp-enhanced-workspace', 
      'JarvisAI',
      'ProjectHub-Mcp',
      'GitHub-RunnerHub'
    ],
    RUNNER_IMAGE: process.env.RUNNER_IMAGE || 'myoung34/github-runner:latest'
  });

  // Start Per-Repository Scaler
  perRepoScaler.initialize().catch(console.error);

  // Listen for per-repository scaler events (README-compliant event names)
  perRepoScaler.on('scaler:initialized', (data) => {
    console.log(`✅ Per-Repository Scaler initialized: ${data.repositories} repositories, ${data.dedicatedRunners} dedicated runners`);
    broadcast('connected', { message: 'Connected to GitHub RunnerHub' });
    broadcast('scale', { 
      event: 'initialized', 
      repositories: data.repositories,
      dedicatedRunners: data.dedicatedRunners 
    });
  });

  perRepoScaler.on('runner:created', (data) => {
    console.log(`✅ Runner created: ${data.type} - ${data.repo}`);
    broadcast('runner:status', {
      repo: data.repo,
      type: data.type,
      name: data.name,
      status: 'created'
    });
  });

  perRepoScaler.on('scaling:up', (data) => {
    console.log(`📈 Scaled up ${data.repo}: +${data.count} ${data.type} runners (total: ${data.total})`);
    broadcast('scale', {
      event: 'scale_up',
      repo: data.repo,
      count: data.count,
      total: data.total,
      type: data.type
    });
  });

  perRepoScaler.on('scaling:down', (data) => {
    console.log(`📉 Scaled down ${data.repo}: -${data.count} runners (total: ${data.total}) - ${data.reason}`);
    broadcast('scale', {
      event: 'scale_down',
      repo: data.repo,
      count: data.count,
      total: data.total,
      reason: data.reason
    });
  });

  perRepoScaler.on('runner:status', (data) => {
    broadcast('runner:status', data);
  });

  // Set autoScaler reference for compatibility with existing endpoints
  autoScaler = perRepoScaler;
  
  console.log('🚀 Per-Repository Scaler enabled - README-compliant implementation');
  console.log('   📋 1 dedicated runner per repository');
  console.log('   ⚡ 0-3 dynamic runners when ALL runners busy');
  console.log('   🕐 5-minute idle cleanup');
  console.log('   🔄 30-second monitoring intervals');
} else {
  console.warn('Runner management not initialized. Missing required environment variables.');
}

// Cache for API responses - FORCE REAL DATA ONLY
let cache = {
  runners: [],
  workflows: [],
  jobs: [],
  lastUpdate: null
};

// Force clear cache on startup and disable mock data
cache.runners = [];
const DISABLE_MOCK_DATA = true;

// Update cache every 30 seconds - FORCE DOCKER ONLY
async function updateCache() {
  try {
    console.log('Updating cache with REAL Docker data only...');
    
    // FORCE: Get runners directly from Docker - NO FALLBACKS
    const dockerRunners = await getDirectDockerRunners();
    cache.runners = dockerRunners;
    console.log(`FORCED Docker detection: ${cache.runners.length} runners found - [${cache.runners.map(r => r.name).join(', ')}]`);
    
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
    
    // Enhanced metrics with per-repository scaler info
    const enhancedMetrics = {
      total_runners: cache.runners.length,
      online_runners: cache.runners.filter(r => r.status === 'online').length,
      busy_runners: cache.runners.filter(r => r.busy).length,
      dedicated_runners: cache.runners.filter(r => r.runnerType === 'dedicated').length,
      dynamic_runners: cache.runners.filter(r => r.runnerType === 'dynamic').length,
      total_workflows_today: cache.workflows.length,
      scaler_enabled: !!perRepoScaler,
      last_cache_update: new Date()
    };
    
    // Add per-repository scaler specific metrics if available
    if (perRepoScaler) {
      const scalerStatus = perRepoScaler.getStatus();
      enhancedMetrics.scaler_metrics = scalerStatus;
      enhancedMetrics.scaler_running = scalerStatus.isRunning;
      enhancedMetrics.repository_breakdown = scalerStatus.repositoryDetails;
    }
    
    broadcast('update', { 
      runners: cache.runners.length,
      workflows: cache.workflows.length,
      metrics: enhancedMetrics
    });
    broadcast('metrics:update', enhancedMetrics);
  } catch (error) {
    console.error('Error updating cache:', error.message);
  }
}

// Enhanced Docker runner detection with per-repository scaler integration
async function getDirectDockerRunners() {
  try {
    const Docker = require('dockerode');
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    
    const containers = await docker.listContainers({ all: true });
    
    const runnerContainers = containers.filter(container => 
      container.Names.some(name => name.includes('runnerhub')) &&
      !container.Names.some(name => name.includes('frontend') || name.includes('backend'))
    );

    return runnerContainers.map(container => {
      const containerName = container.Names[0].replace('/', '');
      const labels = container.Labels || {};
      
      // Determine runner type and details
      let runnerType = 'unknown';
      let displayName = containerName;
      let repository = 'Unknown';
      let busy = false;
      
      // Check if this is a per-repository scaler managed container
      if (labels['runnerhub.type']) {
        runnerType = labels['runnerhub.type']; // 'dedicated' or 'dynamic'
        repository = labels['runnerhub.repo'] || 'Unknown';
        
        if (runnerType === 'dedicated') {
          displayName = `🏃 ${repository} (Dedicated)`;
        } else if (runnerType === 'dynamic') {
          displayName = `⚡ ${repository} (Dynamic)`;
        }
      } else {
        // Legacy naming detection for existing containers
        if (containerName.includes('ai_music') || containerName.includes('ai-music')) {
          displayName = 'AI Music Studio Runner';
          repository = 'ai-music-studio';
          runnerType = 'repository';
        } else if (containerName.includes('mcp_enhanced') || containerName.includes('mcp-enhanced')) {
          displayName = 'MCP Enhanced Workspace Runner';
          repository = 'mcp-enhanced-workspace';
          runnerType = 'repository';
        } else if (containerName.toLowerCase().includes('jarvis')) {
          displayName = 'JarvisAI Runner';
          repository = 'JarvisAI';
          runnerType = 'repository';
        } else if (containerName.toLowerCase().includes('projecthub') || containerName.includes('ProjectHub')) {
          displayName = 'ProjectHub MCP Runner';
          repository = 'ProjectHub-Mcp';
          runnerType = 'repository';
        } else if (containerName.toLowerCase().includes('github') && containerName.toLowerCase().includes('runner')) {
          displayName = 'GitHub RunnerHub Runner';
          repository = 'GitHub-RunnerHub';
          runnerType = 'repository';
        } else if (containerName.includes('dynamic')) {
          displayName = 'Dynamic Pool Runner';
          repository = 'Dynamic Pool';
          runnerType = 'dynamic';
        }
      }
      
      // Try to get busy status from per-repository scaler if available
      if (perRepoScaler) {
        const status = perRepoScaler.getStatus();
        
        if (runnerType === 'dedicated' && status.repositoryDetails[repository]) {
          // Check if dedicated runner is busy
          busy = status.repositoryDetails[repository].busy > 0;
        } else if (runnerType === 'dynamic' && status.repositoryDetails[repository]) {
          // For dynamic runners, check if any are busy (simplified heuristic)
          busy = status.repositoryDetails[repository].busy > 1; // More than just dedicated
        }
      }
      
      return {
        id: Math.abs(container.Id.split('').reduce((a, b) => a + b.charCodeAt(0), 0)),
        name: containerName,
        displayName: displayName,
        repository: repository,
        runnerType: runnerType,
        status: container.State === 'running' ? 'online' : 'offline',
        busy: busy,
        os: 'Linux',
        created: container.Created,
        state: container.State,
        image: container.Image,
        containerId: container.Id ? container.Id.substr(0, 12) : container.id,
        labels: [
          { id: 1, name: 'self-hosted', type: 'read-only' },
          { id: 2, name: 'Linux', type: 'read-only' },
          { id: 3, name: 'X64', type: 'read-only' },
          { id: 4, name: 'docker', type: 'read-only' },
          { id: 5, name: 'runnerhub', type: 'read-only' },
          { id: 6, name: repository, type: 'repository' },
          { id: 7, name: runnerType, type: 'runner-type' }
        ]
      };
    });
  } catch (error) {
    console.error('Error getting Docker runners:', error.message);
    return [];
  }
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

// Public endpoints (no auth or rate limiting)
app.get('/api/public/status', async (req, res) => {
  const realRunners = await getDirectDockerRunners();
  res.json({
    runners: realRunners.length,
    workflows: cache.workflows.length,
    autoScaler: !!autoScaler
  });
});

// Public endpoint to get runners without auth (for dashboard display)
// IMPORTANT: This endpoint bypasses ALL rate limiting
app.get('/api/public/runners', async (req, res) => {
  try {
    // Clear any rate limit headers that might have been set
    res.removeHeader('X-RateLimit-Limit');
    res.removeHeader('X-RateLimit-Remaining');
    res.removeHeader('X-RateLimit-Reset');
    res.removeHeader('X-RateLimit-Window');
    
    const runners = await getDirectDockerRunners();
    // Add CORS headers for cross-origin requests
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Max-Age', '3600');
    res.json(runners);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Simple test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'test endpoint working', timestamp: new Date() });
});

// Debug endpoint to test Docker-based runner detection
app.get('/api/debug/docker-runners', async (req, res) => {
  try {
    if (autoScaler) {
      const metrics = await autoScaler.getRunnerMetrics();
      res.json({
        success: true,
        metrics,
        source: 'docker'
      });
    } else {
      res.json({
        success: false,
        message: 'Auto-scaler not initialized',
        source: 'none'
      });
    }
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      source: 'error'
    });
  }
});

// Public endpoint to show actual Docker runners with hybrid scaler info (no auth)
app.get('/api/public/docker-runners', async (req, res) => {
  try {
    const runners = await getDirectDockerRunners();
    
    // Add hybrid scaler metrics if available
    let scalerMetrics = null;
    if (hybridScaler) {
      const status = hybridScaler.getStatus();
      scalerMetrics = {
        isRunning: status.isRunning,
        repositoryRunners: status.repositoryRunners.length,
        dynamicRunners: status.dynamicRunners.length,
        totalRunners: status.metrics.totalRunners,
        busyRunners: status.metrics.busyRunners,
        lastUpdate: status.metrics.lastUpdate
      };
    }

    res.json({
      success: true,
      runners,
      count: runners.length,
      scalerMetrics,
      source: 'hybrid-scaler-docker',
      breakdown: {
        repository: runners.filter(r => r.runnerType === 'repository').length,
        dynamic: runners.filter(r => r.runnerType === 'dynamic').length,
        online: runners.filter(r => r.status === 'online').length,
        busy: runners.filter(r => r.busy).length
      }
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      source: 'error'
    });
  }
});

// Protected API endpoints (auth required - JWT or API key)
app.get('/api/runners', rateLimiters.read, auth.readAccess(), async (req, res) => {
  // Return real Docker runners instead of cache
  const realRunners = await getDirectDockerRunners();
  res.json(realRunners);
});

app.get('/api/workflows/active', rateLimiters.read, auth.readAccess(), (req, res) => {
  res.json(cache.workflows);
});

app.get('/api/jobs/active', rateLimiters.read, auth.readAccess(), (req, res) => {
  res.json(cache.jobs);
});

app.get('/api/metrics', auth.readAccess(), async (req, res) => {
  const realRunners = await getDirectDockerRunners();
  const metrics = {
    total_runners: realRunners.length,
    online_runners: realRunners.filter(r => r.status === 'online').length,
    busy_runners: realRunners.filter(r => r.busy).length,
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

// Per-repository scaler status endpoint (admin only)
app.get('/api/scaler/status', auth.adminOnly(), async (req, res) => {
  if (!perRepoScaler) {
    return res.json({ 
      enabled: false, 
      message: 'Per-repository scaler not configured' 
    });
  }
  
  const status = perRepoScaler.getStatus();
  res.json({
    enabled: true,
    type: 'per-repository',
    ...status
  });
});

// Per-repository scaler lifecycle status endpoint
app.get('/api/runners/lifecycle', auth.readAccess(), async (req, res) => {
  if (!perRepoScaler) {
    return res.json({ 
      enabled: false, 
      message: 'Per-repository scaler not configured' 
    });
  }
  
  const status = perRepoScaler.getStatus();
  
  res.json({
    enabled: true,
    type: 'per-repository',
    summary: {
      total: status.totalRunners,
      dedicated: status.dedicatedRunners,
      dynamic: status.dynamicRunners,
      busy: status.busyRunners,
      repositories: status.repositories
    },
    repositoryDetails: status.repositoryDetails,
    isRunning: status.isRunning
  });
});

// Manual scaling endpoint (admin only or write access)
app.post('/api/runners/scale', rateLimiters.scaling, auth.writeAccess(), async (req, res) => {
  if (!perRepoScaler) {
    return res.status(400).json({ 
      error: 'Per-repository scaler not configured' 
    });
  }
  
  const { action, count = 1, repo } = req.body;
  
  if (!['up', 'down'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Use "up" or "down"' });
  }
  
  if (!repo) {
    return res.status(400).json({ error: 'Repository name is required for per-repository scaling' });
  }
  
  try {
    if (action === 'up') {
      await perRepoScaler.scaleUpRepository(repo);
    } else {
      // Manual scale down would remove dynamic runners for the repo
      const state = perRepoScaler.repositoryStates.get(repo);
      if (state && state.dynamic.length > 0) {
        await perRepoScaler.removeDynamicRunner(repo, 0);
      }
    }
    
    res.json({ 
      success: true, 
      action, 
      repo,
      message: `Manual scaling ${action} initiated for ${repo}` 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alerts', auth.readAccess(), (req, res) => {
  res.json([]);
});

// New public endpoint for hybrid scaler dashboard metrics
app.get('/api/public/scaler-metrics', async (req, res) => {
  try {
    if (!hybridScaler) {
      return res.json({
        enabled: false,
        message: 'Hybrid scaler not available'
      });
    }
    
    const status = hybridScaler.getStatus();
    const runners = await getDirectDockerRunners();
    
    res.json({
      enabled: true,
      metrics: status.metrics,
      runners: {
        total: runners.length,
        repository: runners.filter(r => r.runnerType === 'repository').length,
        dynamic: runners.filter(r => r.runnerType === 'dynamic').length,
        online: runners.filter(r => r.status === 'online').length,
        busy: runners.filter(r => r.busy).length
      },
      config: {
        repositoryRunners: status.config.repositoryRunners,
        dynamicPool: status.config.dynamicPool
      },
      repositories: hybridScaler.config.repositories,
      lastUpdate: new Date()
    });
  } catch (error) {
    res.status(500).json({
      enabled: false,
      error: error.message
    });
  }
});

// Enhanced health check with per-repository scaler status
app.get('/health', async (req, res) => {
  const realRunners = await getDirectDockerRunners();
  let perRepoScalerStatus = null;
  
  if (perRepoScaler) {
    perRepoScalerStatus = perRepoScaler.getStatus();
  }
  
  res.json({ 
    status: 'ok', 
    lastUpdate: new Date(),
    runners: realRunners.length,
    workflows: cache.workflows.length,
    perRepoScaler: !!perRepoScaler,
    autoScaler: !!perRepoScaler, // For compatibility
    runnerManager: !!perRepoScaler, // For compatibility
    realRunnerNames: realRunners.map(r => r.name),
    scalerStatus: perRepoScalerStatus,
    implementation: 'per-repository-readme-compliant'
  });
});

// Hybrid Scaler detailed status endpoint
app.get('/api/runner-manager/status', auth.readAccess(), async (req, res) => {
  if (!hybridScaler) {
    return res.json({ 
      enabled: false, 
      message: 'Hybrid Scaler not configured' 
    });
  }
  
  const status = hybridScaler.getStatus();
  
  res.json({
    enabled: true,
    type: 'hybrid',
    status,
    capabilities: {
      repositoryRunners: hybridScaler.config.repositoryRunners.enabled,
      autoScaling: hybridScaler.config.dynamicPool.enabled
    },
    repositories: hybridScaler.config.repositories
  });
});

// Token Manager status endpoint (hybrid scaler manages tokens internally)
app.get('/api/token-manager/status', auth.readAccess(), async (req, res) => {
  if (!hybridScaler) {
    return res.json({ 
      enabled: false, 
      message: 'Hybrid Scaler not configured' 
    });
  }
  
  res.json({
    enabled: true,
    type: 'integrated',
    message: 'Token management is integrated into Hybrid Scaler',
    repositories: hybridScaler.config.repositories
  });
});

// Force refresh all tokens (triggers runner recreation in hybrid scaler)
app.post('/api/token-manager/refresh', auth.adminOnly(), async (req, res) => {
  if (!hybridScaler) {
    return res.status(400).json({ 
      error: 'Hybrid Scaler not configured' 
    });
  }
  
  try {
    // Trigger recreation of all repository runners (which regenerates tokens)
    const results = [];
    for (const repo of hybridScaler.config.repositories) {
      await hybridScaler.recreateRepositoryRunner(repo);
      results.push({ repo, status: 'recreated' });
    }
    
    res.json({ 
      success: true, 
      message: 'Repository runners recreated with fresh tokens',
      results 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Force recreation of specific repository runner
app.post('/api/runner-manager/recreate/:repo', auth.adminOnly(), async (req, res) => {
  if (!hybridScaler) {
    return res.status(400).json({ 
      error: 'Hybrid Scaler not configured' 
    });
  }
  
  const { repo } = req.params;
  
  if (!hybridScaler.config.repositories.includes(repo)) {
    return res.status(400).json({ 
      error: `Repository ${repo} not managed by this system` 
    });
  }
  
  try {
    await hybridScaler.recreateRepositoryRunner(repo);
    
    res.json({ 
      success: true, 
      message: `Repository runner recreation initiated for ${repo}` 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check

// WebSocket endpoint
app.get('/ws', (req, res) => {
  res.status(426).send('Upgrade required');
});

// Export for testing
module.exports = app;

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`GitHub RunnerHub backend running on port ${PORT}`);
    console.log(`WebSocket available at ws://localhost:${PORT}`);
    if (autoScaler) {
      console.log('Auto-scaler is active and monitoring runner utilization');
    }
  });
}