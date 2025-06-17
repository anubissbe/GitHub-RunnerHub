const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');

const app = express();
app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PORT = process.env.PORT || 8300;

console.log('Starting GitHub Runners Monitor backend...');
console.log('Port:', PORT);
console.log('GitHub Token present:', !!GITHUB_TOKEN);

const octokit = new Octokit({
  auth: GITHUB_TOKEN || undefined,
});

// Mock runners since we can't access them without auth
const mockRunners = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  name: `github-runner-${i + 1}`,
  os: 'Linux',
  status: i >= 36 ? 'offline' : 'online',
  busy: false,
  labels: [
    { id: 1, name: 'self-hosted', type: 'read-only' },
    { id: 2, name: 'Linux', type: 'read-only' },
    { id: 3, name: 'X64', type: 'read-only' }
  ]
}));

// Cache for API responses
let cache = {
  runners: mockRunners,
  workflows: [],
  jobs: [],
  lastUpdate: null
};

// Update cache every 30 seconds
async function updateCache() {
  try {
    console.log('Updating cache...');
    
    // Update runner busy status based on jobs
    mockRunners.forEach(runner => {
      runner.busy = false;
    });
    
    // Fetch active workflows (public API)
    try {
      const workflowsResponse = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner: 'anubissbe',
        repo: 'ProjectHub-Mcp',
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
          owner: 'anubissbe',
          repo: 'ProjectHub-Mcp',
          run_id: workflow.id,
          per_page: 100
        });
        allJobs.push(...jobsResponse.data.jobs);
      } catch (error) {
        console.error(`Error fetching jobs for workflow ${workflow.id}:`, error.message);
      }
    }
    cache.jobs = allJobs;
    
    // Mark runners as busy if they have active jobs
    allJobs.forEach(job => {
      if (job.status === 'in_progress' && job.runner_id) {
        const runner = mockRunners.find(r => r.id === job.runner_id);
        if (runner) {
          runner.busy = true;
        }
      }
    });
    
    cache.lastUpdate = new Date();
    console.log(`Cache updated: ${cache.runners.length} runners, ${cache.workflows.length} workflows, ${cache.jobs.length} jobs`);
  } catch (error) {
    console.error('Error updating cache:', error.message);
  }
}

// Initialize cache
updateCache();
setInterval(updateCache, 30000);

// API endpoints
app.get('/api/runners', (req, res) => {
  res.json(cache.runners);
});

app.get('/api/workflows/active', (req, res) => {
  res.json(cache.workflows);
});

app.get('/api/jobs/active', (req, res) => {
  res.json(cache.jobs);
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
    most_active_repo: 'anubissbe/ProjectHub-Mcp'
  };
  
  if (metrics.online_runners > 0) {
    metrics.utilization_percentage = (metrics.busy_runners / metrics.online_runners * 100).toFixed(1);
  }
  
  res.json(metrics);
});

app.get('/api/alerts', (req, res) => {
  res.json([]);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    lastUpdate: cache.lastUpdate,
    runners: cache.runners.length,
    workflows: cache.workflows.length
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GitHub Runners Monitor backend running on port ${PORT}`);
});