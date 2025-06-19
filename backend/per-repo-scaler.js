const Docker = require('dockerode');
const { Octokit } = require('@octokit/rest');
const EventEmitter = require('events');

/**
 * Per-Repository Auto-Scaler - Implements exact README specifications
 * 
 * Key Features:
 * 1. 1 dedicated runner per repository (always maintained)
 * 2. 0-3 dynamic runners per repository (spawned when ALL runners busy)
 * 3. Independent scaling per repository
 * 4. 5-minute idle cleanup for dynamic runners
 * 5. 30-second monitoring intervals
 */
class PerRepositoryScaler extends EventEmitter {
  constructor(config) {
    super();
    
    this.config = {
      githubToken: config.GITHUB_TOKEN,
      githubOrg: config.GITHUB_ORG,
      repositories: config.REPOSITORIES || [],
      
      // Per-repository configuration matching README
      dedicatedRunnersPerRepo: 1,
      maxDynamicPerRepo: 3,
      scaleUpTrigger: 'all_runners_busy',
      scaleDownTrigger: '5_minutes_idle',
      checkInterval: 30, // 30 seconds as per README
      idleCleanupTime: 5 * 60 * 1000, // 5 minutes in milliseconds
      
      runnerImage: config.RUNNER_IMAGE || 'myoung34/github-runner:latest'
    };

    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.octokit = new Octokit({ auth: this.config.githubToken });
    
    // State tracking - organized by repository
    this.repositoryStates = new Map(); // repo -> { dedicated: runner, dynamic: [runners] }
    this.runnerWorkflowMap = new Map(); // runner_id -> { busy: boolean, lastActivity: Date }
    
    this.isRunning = false;
    this.monitoringInterval = null;
    this.cleanupInterval = null;
  }

  /**
   * Initialize the per-repository scaler
   */
  async initialize() {
    console.log('🚀 Initializing Per-Repository Auto-Scaler...');
    console.log(`Configuration: ${this.config.dedicatedRunnersPerRepo} dedicated + 0-${this.config.maxDynamicPerRepo} dynamic per repo`);
    
    try {
      // Initialize state for each repository
      for (const repo of this.config.repositories) {
        this.repositoryStates.set(repo, {
          dedicated: null,
          dynamic: [],
          lastScaleTime: 0
        });
      }
      
      // Ensure dedicated runners exist for each repository
      await this.ensureDedicatedRunners();
      
      // Start monitoring and cleanup loops
      this.startMonitoring();
      
      this.isRunning = true;
      console.log('✅ Per-Repository Auto-Scaler initialized successfully');
      
      this.emit('scaler:initialized', {
        repositories: this.config.repositories.length,
        dedicatedRunners: this.config.repositories.length * this.config.dedicatedRunnersPerRepo
      });
      
    } catch (error) {
      console.error('❌ Failed to initialize Per-Repository Auto-Scaler:', error.message);
      throw error;
    }
  }

  /**
   * Ensure each repository has its dedicated runner(s)
   */
  async ensureDedicatedRunners() {
    console.log('📂 Ensuring dedicated runners for all repositories...');
    
    for (const repo of this.config.repositories) {
      try {
        const state = this.repositoryStates.get(repo);
        
        // Check if dedicated runner exists and is running
        const existingRunner = await this.findDedicatedRunner(repo);
        
        if (existingRunner && existingRunner.State === 'running') {
          console.log(`✅ Dedicated runner for ${repo} already exists`);
          state.dedicated = {
            container: existingRunner,
            type: 'dedicated',
            repo: repo,
            status: 'running',
            busy: false,
            lastActivity: new Date()
          };
        } else {
          console.log(`🔄 Creating dedicated runner for ${repo}...`);
          const runner = await this.createDedicatedRunner(repo);
          state.dedicated = runner;
          
          this.emit('runner:created', {
            type: 'dedicated',
            repo: repo,
            name: runner.container.name
          });
        }
      } catch (error) {
        console.error(`❌ Failed to ensure dedicated runner for ${repo}:`, error.message);
      }
    }
  }

  /**
   * Find existing dedicated runner for a repository
   */
  async findDedicatedRunner(repo) {
    try {
      const containers = await this.docker.listContainers({ all: true });
      const runnerName = `runnerhub-dedicated-${repo.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      
      return containers.find(container =>
        container.Names.some(name => name.includes(runnerName)) &&
        container.Labels && 
        container.Labels['runnerhub.type'] === 'dedicated' &&
        container.Labels['runnerhub.repo'] === repo
      );
    } catch (error) {
      console.error(`Error finding dedicated runner for ${repo}:`, error.message);
      return null;
    }
  }

  /**
   * Create a dedicated runner for a specific repository
   */
  async createDedicatedRunner(repo) {
    const token = await this.generateRunnerToken(repo);
    const runnerName = `runnerhub-dedicated-${repo.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    
    const container = await this.docker.createContainer({
      Image: this.config.runnerImage,
      name: runnerName,
      Env: [
        `REPO_URL=https://github.com/${this.config.githubOrg}/${repo}`,
        `RUNNER_TOKEN=${token}`,
        `RUNNER_NAME=${runnerName}`,
        `RUNNER_LABELS=self-hosted,Linux,X64,docker,runnerhub,dedicated,${repo}`,
        'RUNNER_WORKDIR=/tmp/runner/work',
        'RUNNER_GROUP=default',
        'EPHEMERAL=false' // Dedicated runners are persistent
      ],
      HostConfig: {
        AutoRemove: false,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
        Resources: {
          Memory: 2147483648, // 2GB
          CpuShares: 1024
        }
      },
      Labels: {
        'runnerhub.type': 'dedicated',
        'runnerhub.repo': repo,
        'runnerhub.org': this.config.githubOrg,
        'runnerhub.created': new Date().toISOString()
      }
    });

    await container.start();
    
    return {
      container: container,
      type: 'dedicated',
      repo: repo,
      status: 'running',
      busy: false,
      lastActivity: new Date()
    };
  }

  /**
   * Create a dynamic runner for a specific repository
   */
  async createDynamicRunner(repo) {
    const token = await this.generateRunnerToken(repo);
    const timestamp = Date.now();
    const runnerName = `runnerhub-dynamic-${repo.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${timestamp}`;
    
    const container = await this.docker.createContainer({
      Image: this.config.runnerImage,
      name: runnerName,
      Env: [
        `REPO_URL=https://github.com/${this.config.githubOrg}/${repo}`,
        `RUNNER_TOKEN=${token}`,
        `RUNNER_NAME=${runnerName}`,
        `RUNNER_LABELS=self-hosted,Linux,X64,docker,runnerhub,dynamic,${repo}`,
        'RUNNER_WORKDIR=/tmp/runner/work',
        'RUNNER_GROUP=default',
        'EPHEMERAL=true' // Dynamic runners are ephemeral
      ],
      HostConfig: {
        AutoRemove: true, // Auto-remove when stopped
        RestartPolicy: { Name: 'no' }, // Don't restart dynamic runners
        Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
        Resources: {
          Memory: 2147483648, // 2GB
          CpuShares: 1024
        }
      },
      Labels: {
        'runnerhub.type': 'dynamic',
        'runnerhub.repo': repo,
        'runnerhub.org': this.config.githubOrg,
        'runnerhub.created': new Date().toISOString(),
        'runnerhub.cleanup_after': new Date(Date.now() + this.config.idleCleanupTime).toISOString()
      }
    });

    await container.start();
    
    return {
      container: container,
      type: 'dynamic',
      repo: repo,
      status: 'running',
      busy: false,
      lastActivity: new Date(),
      createdAt: new Date()
    };
  }

  /**
   * Generate registration token for a repository
   */
  async generateRunnerToken(repo) {
    try {
      const response = await this.octokit.rest.actions.createRegistrationTokenForRepo({
        owner: this.config.githubOrg,
        repo: repo
      });
      return response.data.token;
    } catch (error) {
      console.error(`Error generating token for ${repo}:`, error.message);
      throw error;
    }
  }

  /**
   * Start monitoring and cleanup loops
   */
  startMonitoring() {
    console.log(`🔍 Starting monitoring (${this.config.checkInterval}s intervals)...`);
    
    // Main monitoring loop - check every 30 seconds as per README
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.monitorAndScale();
      } catch (error) {
        console.error('Error in monitoring loop:', error.message);
      }
    }, this.config.checkInterval * 1000);

    // Cleanup loop - check for idle dynamic runners every minute
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupIdleDynamicRunners();
      } catch (error) {
        console.error('Error in cleanup loop:', error.message);
      }
    }, 60 * 1000);
  }

  /**
   * Main monitoring and scaling logic - per repository
   */
  async monitorAndScale() {
    console.log('🔍 Monitoring runner utilization per repository...');
    
    for (const repo of this.config.repositories) {
      try {
        await this.evaluateRepositoryScaling(repo);
      } catch (error) {
        console.error(`Error evaluating scaling for ${repo}:`, error.message);
      }
    }
  }

  /**
   * Evaluate scaling for a specific repository
   */
  async evaluateRepositoryScaling(repo) {
    const state = this.repositoryStates.get(repo);
    if (!state || !state.dedicated) {
      console.log(`⚠️ No dedicated runner found for ${repo}, skipping...`);
      return;
    }

    // Get current runner status for this repository
    const runners = await this.getRepositoryRunners(repo);
    const allRunners = [state.dedicated, ...state.dynamic].filter(r => r && r.status === 'running');
    const busyRunners = allRunners.filter(r => r.busy);
    
    console.log(`📊 ${repo}: ${allRunners.length} runners (${busyRunners.length} busy)`);

    // Scale UP logic: ALL runners busy and under max dynamic limit
    if (busyRunners.length === allRunners.length && allRunners.length > 0) {
      if (state.dynamic.length < this.config.maxDynamicPerRepo) {
        console.log(`📈 Scaling UP for ${repo}: All runners busy, adding dynamic runner`);
        await this.scaleUpRepository(repo);
      } else {
        console.log(`⚠️ ${repo} at maximum capacity (${this.config.maxDynamicPerRepo} dynamic runners)`);
      }
    }

    // Update runner activity status
    await this.updateRunnerActivity(repo);
  }

  /**
   * Scale up a specific repository by adding a dynamic runner
   */
  async scaleUpRepository(repo) {
    try {
      const state = this.repositoryStates.get(repo);
      
      // Create new dynamic runner
      const dynamicRunner = await this.createDynamicRunner(repo);
      state.dynamic.push(dynamicRunner);
      state.lastScaleTime = Date.now();
      
      console.log(`✅ Added dynamic runner for ${repo} (${state.dynamic.length}/${this.config.maxDynamicPerRepo})`);
      
      this.emit('scaling:up', {
        repo: repo,
        count: 1,
        total: state.dynamic.length + 1, // +1 for dedicated
        type: 'dynamic'
      });
      
      this.emit('runner:created', {
        type: 'dynamic',
        repo: repo,
        name: dynamicRunner.container.name
      });
      
    } catch (error) {
      console.error(`❌ Failed to scale up ${repo}:`, error.message);
    }
  }

  /**
   * Clean up idle dynamic runners (5 minutes as per README)
   */
  async cleanupIdleDynamicRunners() {
    console.log('🧹 Checking for idle dynamic runners to cleanup...');
    
    for (const repo of this.config.repositories) {
      const state = this.repositoryStates.get(repo);
      if (!state || !state.dynamic) continue;
      
      // Check each dynamic runner for idle time
      for (let i = state.dynamic.length - 1; i >= 0; i--) {
        const runner = state.dynamic[i];
        const idleTime = Date.now() - runner.lastActivity.getTime();
        
        // Remove if idle for more than 5 minutes AND not busy
        if (idleTime > this.config.idleCleanupTime && !runner.busy) {
          console.log(`🗑️ Removing idle dynamic runner for ${repo} (idle for ${Math.round(idleTime / 1000)}s)`);
          
          try {
            await this.removeDynamicRunner(repo, i);
            
            this.emit('scaling:down', {
              repo: repo,
              count: 1,
              total: state.dynamic.length + 1, // +1 for dedicated
              reason: 'idle_cleanup'
            });
            
          } catch (error) {
            console.error(`❌ Failed to remove idle runner for ${repo}:`, error.message);
          }
        }
      }
    }
  }

  /**
   * Remove a dynamic runner
   */
  async removeDynamicRunner(repo, index) {
    const state = this.repositoryStates.get(repo);
    const runner = state.dynamic[index];
    
    try {
      // Stop and remove container
      const container = this.docker.getContainer(runner.container.id);
      await container.stop({ t: 10 }); // 10 second grace period
      
      // Remove from state
      state.dynamic.splice(index, 1);
      
      console.log(`✅ Removed dynamic runner for ${repo}`);
    } catch (error) {
      console.error(`Error removing dynamic runner:`, error.message);
      // Remove from state even if container removal failed
      state.dynamic.splice(index, 1);
    }
  }

  /**
   * Get all runners for a specific repository
   */
  async getRepositoryRunners(repo) {
    try {
      const containers = await this.docker.listContainers({ all: true });
      
      return containers.filter(container =>
        container.Labels &&
        container.Labels['runnerhub.repo'] === repo &&
        ['dedicated', 'dynamic'].includes(container.Labels['runnerhub.type'])
      );
    } catch (error) {
      console.error(`Error getting runners for ${repo}:`, error.message);
      return [];
    }
  }

  /**
   * Update runner activity status by checking GitHub Actions API
   */
  async updateRunnerActivity(repo) {
    try {
      // Get active workflow runs for this repository
      const workflows = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner: this.config.githubOrg,
        repo: repo,
        status: 'in_progress',
        per_page: 100
      });

      // Get jobs for active workflows
      const activeJobs = [];
      for (const workflow of workflows.data.workflow_runs) {
        try {
          const jobs = await this.octokit.rest.actions.listJobsForWorkflowRun({
            owner: this.config.githubOrg,
            repo: repo,
            run_id: workflow.id
          });
          activeJobs.push(...jobs.data.jobs.filter(job => job.status === 'in_progress'));
        } catch (error) {
          console.error(`Error fetching jobs for workflow ${workflow.id}:`, error.message);
        }
      }

      // Update runner busy status based on active jobs
      const state = this.repositoryStates.get(repo);
      if (state) {
        const allRunners = [state.dedicated, ...state.dynamic].filter(r => r);
        
        // Simple heuristic: if we have active jobs, mark runners as busy
        const busyCount = Math.min(activeJobs.length, allRunners.length);
        
        allRunners.forEach((runner, index) => {
          const wasBusy = runner.busy;
          runner.busy = index < busyCount;
          
          if (runner.busy) {
            runner.lastActivity = new Date();
          }
          
          // Emit status change event
          if (wasBusy !== runner.busy) {
            this.emit('runner:status', {
              repo: repo,
              type: runner.type,
              name: runner.container.name,
              status: runner.busy ? 'busy' : 'idle'
            });
          }
        });
      }
      
    } catch (error) {
      console.error(`Error updating runner activity for ${repo}:`, error.message);
    }
  }

  /**
   * Get current status of the scaler
   */
  getStatus() {
    const summary = {
      isRunning: this.isRunning,
      repositories: this.config.repositories.length,
      totalRunners: 0,
      dedicatedRunners: 0,
      dynamicRunners: 0,
      busyRunners: 0,
      repositoryDetails: {}
    };

    for (const [repo, state] of this.repositoryStates) {
      const dedicated = state.dedicated ? 1 : 0;
      const dynamic = state.dynamic.length;
      const busy = [state.dedicated, ...state.dynamic]
        .filter(r => r && r.busy).length;

      summary.totalRunners += dedicated + dynamic;
      summary.dedicatedRunners += dedicated;
      summary.dynamicRunners += dynamic;
      summary.busyRunners += busy;

      summary.repositoryDetails[repo] = {
        dedicated: dedicated,
        dynamic: dynamic,
        busy: busy,
        total: dedicated + dynamic
      };
    }

    return summary;
  }

  /**
   * Stop the scaler
   */
  stop() {
    console.log('🛑 Stopping Per-Repository Auto-Scaler...');
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.isRunning = false;
    console.log('✅ Per-Repository Auto-Scaler stopped');
  }
}

module.exports = PerRepositoryScaler;