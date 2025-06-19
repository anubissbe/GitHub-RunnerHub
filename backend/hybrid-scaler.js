const Docker = require('dockerode');
const { Octokit } = require('@octokit/rest');
const EventEmitter = require('events');

/**
 * Hybrid Scaler - Combines Repository-Specific Runners with Auto-Scaling
 * 
 * Architecture:
 * 1. Repository-Specific Runners (1 per repo) - Always maintained
 * 2. Dynamic Pool Runners - Auto-scaled based on demand
 * 3. Intelligent Load Distribution - Routes jobs optimally
 */
class HybridScaler extends EventEmitter {
  constructor(config) {
    super();
    
    this.config = {
      githubToken: config.GITHUB_TOKEN,
      githubOrg: config.GITHUB_ORG,
      repositories: config.REPOSITORIES || [],
      
      // Repository-specific runners (fixed)
      repositoryRunners: {
        enabled: true,
        minPerRepo: 1,
        maxPerRepo: 3
      },
      
      // Dynamic pool runners (auto-scaled)
      dynamicPool: {
        enabled: true,
        minRunners: 2,
        maxRunners: 10,
        scaleThreshold: 0.7, // Scale up when 70% busy
        scaleDownThreshold: 0.3, // Scale down when < 30% busy
        cooldownPeriod: 300000, // 5 minutes
        idleTimeout: 1800000 // 30 minutes
      },
      
      runnerImage: config.RUNNER_IMAGE || 'myoung34/github-runner:latest',
      healthCheckInterval: config.HEALTH_CHECK_INTERVAL || 60000,
      metricsInterval: config.METRICS_INTERVAL || 30000
    };

    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.octokit = new Octokit({ auth: this.config.githubToken });
    
    // State tracking
    this.repositoryRunners = new Map(); // repo -> container info
    this.dynamicRunners = new Map(); // container_id -> container info
    this.metrics = {
      totalRunners: 0,
      busyRunners: 0,
      idleRunners: 0,
      queuedJobs: 0,
      avgJobDuration: 0,
      lastScaleTime: 0
    };
    
    this.isRunning = false;
    this.intervals = [];
  }

  /**
   * Initialize the Hybrid Scaler
   */
  async initialize() {
    console.log('🚀 Initializing Hybrid Scaler...');
    
    try {
      // Initialize repository-specific runners
      if (this.config.repositoryRunners.enabled) {
        await this.initializeRepositoryRunners();
      }
      
      // Initialize dynamic pool
      if (this.config.dynamicPool.enabled) {
        await this.initializeDynamicPool();
      }
      
      // Start monitoring
      this.startMonitoring();
      
      this.isRunning = true;
      console.log('✅ Hybrid Scaler initialized successfully');
      
      this.emit('scaler:initialized', {
        repositoryRunners: this.repositoryRunners.size,
        dynamicRunners: this.dynamicRunners.size
      });
      
    } catch (error) {
      console.error('❌ Failed to initialize Hybrid Scaler:', error.message);
      throw error;
    }
  }

  /**
   * Initialize repository-specific runners (1 per repository)
   */
  async initializeRepositoryRunners() {
    console.log('📂 Initializing repository-specific runners...');
    
    for (const repo of this.config.repositories) {
      try {
        const existingContainer = await this.findRepositoryRunner(repo);
        
        if (existingContainer && existingContainer.State === 'running') {
          console.log(`✅ Repository runner for ${repo} already running`);
          this.repositoryRunners.set(repo, {
            container: existingContainer,
            type: 'repository',
            repo: repo,
            status: 'running',
            lastCheck: new Date(),
            busy: false
          });
        } else {
          console.log(`🔄 Creating repository runner for ${repo}...`);
          const container = await this.createRepositoryRunner(repo);
          this.repositoryRunners.set(repo, {
            container: container,
            type: 'repository', 
            repo: repo,
            status: 'starting',
            lastCheck: new Date(),
            busy: false
          });
        }
      } catch (error) {
        console.error(`❌ Failed to initialize runner for ${repo}:`, error.message);
      }
    }
  }

  /**
   * Initialize dynamic pool with minimum runners
   */
  async initializeDynamicPool() {
    console.log('🔄 Initializing dynamic runner pool...');
    
    const currentDynamic = await this.getDynamicRunners();
    const needed = this.config.dynamicPool.minRunners - currentDynamic.length;
    
    if (needed > 0) {
      console.log(`📈 Creating ${needed} dynamic runners to meet minimum...`);
      await this.scaleUp(needed);
    }
  }

  /**
   * Find existing repository runner container
   */
  async findRepositoryRunner(repo) {
    try {
      const containers = await this.docker.listContainers({ all: true });
      const containerName = `runnerhub_${repo.toLowerCase().replace(/-/g, '_')}`;
      
      return containers.find(container =>
        container.Names.some(name => name.includes(containerName))
      );
    } catch (error) {
      console.error(`Error finding repository runner for ${repo}:`, error.message);
      return null;
    }
  }

  /**
   * Create a new repository-specific runner
   */
  async createRepositoryRunner(repo) {
    const token = await this.generateRunnerToken(repo);
    const containerName = `runnerhub_${repo.toLowerCase().replace(/-/g, '_')}`;
    
    const container = await this.docker.createContainer({
      Image: this.config.runnerImage,
      name: containerName,
      Env: [
        `REPO_URL=https://github.com/${this.config.githubOrg}/${repo}`,
        `RUNNER_TOKEN=${token}`,
        `RUNNER_NAME=${containerName}`,
        `RUNNER_LABELS=self-hosted,Linux,X64,docker,runnerhub,${repo}`,
        'RUNNER_WORKDIR=/tmp/runner/work',
        'RUNNER_GROUP=default',
        'EPHEMERAL=true'
      ],
      HostConfig: {
        AutoRemove: false,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: ['/var/run/docker.sock:/var/run/docker.sock']
      },
      Labels: {
        'runnerhub.type': 'repository',
        'runnerhub.repo': repo,
        'runnerhub.org': this.config.githubOrg
      }
    });

    await container.start();
    console.log(`✅ Created repository runner: ${containerName}`);
    
    this.emit('runner:created', {
      type: 'repository',
      repo: repo,
      containerId: container.id,
      containerName: containerName
    });
    
    return container;
  }

  /**
   * Create a dynamic pool runner
   */
  async createDynamicRunner() {
    // Use the first repository for dynamic runners (fallback approach)
    const fallbackRepo = this.config.repositories[0];
    const token = await this.generateRunnerToken(fallbackRepo);
    const containerName = `runnerhub_dynamic_${Date.now()}`;
    
    const container = await this.docker.createContainer({
      Image: this.config.runnerImage,
      name: containerName,
      Env: [
        `REPO_URL=https://github.com/${this.config.githubOrg}/${fallbackRepo}`,
        `RUNNER_TOKEN=${token}`,
        `RUNNER_NAME=${containerName}`,
        'RUNNER_LABELS=self-hosted,Linux,X64,docker,runnerhub,dynamic',
        'RUNNER_WORKDIR=/tmp/runner/work',
        'RUNNER_GROUP=default',
        'EPHEMERAL=true'
      ],
      HostConfig: {
        AutoRemove: true,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: ['/var/run/docker.sock:/var/run/docker.sock']
      },
      Labels: {
        'runnerhub.type': 'dynamic',
        'runnerhub.org': this.config.githubOrg,
        'runnerhub.fallback-repo': fallbackRepo
      }
    });

    await container.start();
    console.log(`✅ Created dynamic runner: ${containerName} (using ${fallbackRepo} token)`);
    
    this.dynamicRunners.set(container.id, {
      container: container,
      type: 'dynamic',
      status: 'starting',
      createdAt: new Date(),
      lastActive: new Date(),
      busy: false,
      fallbackRepo: fallbackRepo
    });
    
    this.emit('runner:created', {
      type: 'dynamic',
      containerId: container.id,
      containerName: containerName,
      fallbackRepo: fallbackRepo
    });
    
    return container;
  }

  /**
   * Generate GitHub runner token
   */
  async generateRunnerToken(repo = null) {
    try {
      // For dynamic runners, use the first repository as fallback
      // since organization tokens require enterprise features
      const targetRepo = repo || this.config.repositories[0];
      
      const response = await this.octokit.rest.actions.createRegistrationTokenForRepo({
        owner: this.config.githubOrg,
        repo: targetRepo
      });
      
      return response.data.token;
    } catch (error) {
      console.error(`Failed to generate runner token for ${repo || 'dynamic'}:`, error.message);
      throw error;
    }
  }

  /**
   * Get current dynamic runners
   */
  async getDynamicRunners() {
    try {
      const containers = await this.docker.listContainers({ all: true });
      return containers.filter(container =>
        container.Labels && 
        container.Labels['runnerhub.type'] === 'dynamic'
      );
    } catch (error) {
      console.error('Error getting dynamic runners:', error.message);
      return [];
    }
  }

  /**
   * Scale up dynamic pool
   */
  async scaleUp(count = 1) {
    if (this.dynamicRunners.size + count > this.config.dynamicPool.maxRunners) {
      count = this.config.dynamicPool.maxRunners - this.dynamicRunners.size;
    }
    
    if (count <= 0) {
      console.log('⚠️ Cannot scale up: already at maximum capacity');
      return;
    }
    
    console.log(`📈 Scaling up: creating ${count} dynamic runners`);
    
    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(this.createDynamicRunner().catch(error => {
        console.error('Failed to create dynamic runner:', error.message);
        return null;
      }));
    }
    
    await Promise.all(promises);
    this.metrics.lastScaleTime = Date.now();
    
    this.emit('scaling:up', { count, total: this.dynamicRunners.size });
  }

  /**
   * Scale down dynamic pool
   */
  async scaleDown(count = 1) {
    const idleRunners = Array.from(this.dynamicRunners.values())
      .filter(runner => !runner.busy && runner.status === 'running')
      .sort((a, b) => a.lastActive - b.lastActive); // Remove oldest idle first
    
    count = Math.min(count, idleRunners.length);
    
    if (count <= 0) {
      console.log('⚠️ No idle runners to scale down');
      return;
    }
    
    console.log(`📉 Scaling down: removing ${count} idle runners`);
    
    for (let i = 0; i < count; i++) {
      const runner = idleRunners[i];
      try {
        await runner.container.stop();
        await runner.container.remove();
        this.dynamicRunners.delete(runner.container.id);
        console.log(`✅ Removed idle runner: ${runner.container.id.substr(0, 12)}`);
      } catch (error) {
        console.error('Failed to remove runner:', error.message);
      }
    }
    
    this.metrics.lastScaleTime = Date.now();
    this.emit('scaling:down', { count, total: this.dynamicRunners.size });
  }

  /**
   * Check if scaling is needed based on current metrics
   */
  async checkScalingNeeds() {
    try {
      await this.updateMetrics();
      
      const now = Date.now();
      const cooldownRemaining = this.config.dynamicPool.cooldownPeriod - (now - this.metrics.lastScaleTime);
      
      if (cooldownRemaining > 0) {
        return; // Still in cooldown period
      }
      
      const utilizationRate = this.metrics.totalRunners > 0 
        ? this.metrics.busyRunners / this.metrics.totalRunners 
        : 0;
      
      console.log(`📊 Utilization: ${(utilizationRate * 100).toFixed(1)}% (${this.metrics.busyRunners}/${this.metrics.totalRunners})`);
      
      // Scale up if utilization is high
      if (utilizationRate >= this.config.dynamicPool.scaleThreshold) {
        const scaleAmount = Math.min(3, this.config.dynamicPool.maxRunners - this.dynamicRunners.size);
        if (scaleAmount > 0) {
          await this.scaleUp(scaleAmount);
        }
      }
      // Scale down if utilization is low
      else if (utilizationRate <= this.config.dynamicPool.scaleDownThreshold) {
        const currentDynamic = this.dynamicRunners.size;
        const minRequired = this.config.dynamicPool.minRunners;
        const canRemove = currentDynamic - minRequired;
        
        if (canRemove > 0) {
          const scaleAmount = Math.min(2, canRemove);
          await this.scaleDown(scaleAmount);
        }
      }
      
    } catch (error) {
      console.error('Error checking scaling needs:', error.message);
    }
  }

  /**
   * Update current metrics
   */
  async updateMetrics() {
    try {
      // Get all runners (repository + dynamic)
      const allRunners = [
        ...Array.from(this.repositoryRunners.values()),
        ...Array.from(this.dynamicRunners.values())
      ];
      
      // Get current job queue from GitHub
      const queuedJobs = await this.getQueuedJobs();
      
      this.metrics = {
        totalRunners: allRunners.length,
        busyRunners: allRunners.filter(r => r.busy).length,
        idleRunners: allRunners.filter(r => !r.busy && r.status === 'running').length,
        queuedJobs: queuedJobs.length,
        repositoryRunners: this.repositoryRunners.size,
        dynamicRunners: this.dynamicRunners.size,
        lastUpdate: new Date()
      };
      
      this.emit('metrics:updated', this.metrics);
      
    } catch (error) {
      console.error('Error updating metrics:', error.message);
    }
  }

  /**
   * Get queued jobs from GitHub
   */
  async getQueuedJobs() {
    try {
      const jobs = [];
      
      for (const repo of this.config.repositories) {
        const runs = await this.octokit.rest.actions.listWorkflowRunsForRepo({
          owner: this.config.githubOrg,
          repo: repo,
          status: 'queued',
          per_page: 100
        });
        
        for (const run of runs.data.workflow_runs) {
          const runJobs = await this.octokit.rest.actions.listJobsForWorkflowRun({
            owner: this.config.githubOrg,
            repo: repo,
            run_id: run.id
          });
          
          jobs.push(...runJobs.data.jobs.filter(job => job.status === 'queued'));
        }
      }
      
      return jobs;
    } catch (error) {
      console.error('Error getting queued jobs:', error.message);
      return [];
    }
  }

  /**
   * Start monitoring and auto-scaling
   */
  startMonitoring() {
    console.log('📡 Starting monitoring and auto-scaling...');
    
    // Health check interval
    const healthInterval = setInterval(() => {
      this.healthCheck().catch(console.error);
    }, this.config.healthCheckInterval);
    
    // Metrics and scaling check interval
    const scalingInterval = setInterval(() => {
      this.checkScalingNeeds().catch(console.error);
    }, this.config.metricsInterval);
    
    this.intervals.push(healthInterval, scalingInterval);
  }

  /**
   * Perform health check on all runners
   */
  async healthCheck() {
    try {
      // Check repository runners
      for (const [repo, runner] of this.repositoryRunners) {
        const container = this.docker.getContainer(runner.container.id);
        const info = await container.inspect();
        
        if (!info.State.Running) {
          console.log(`🔧 Repository runner for ${repo} is down, attempting restart...`);
          await this.restartRepositoryRunner(repo);
        }
      }
      
      // Check dynamic runners
      for (const [id, runner] of this.dynamicRunners) {
        const container = this.docker.getContainer(id);
        try {
          const info = await container.inspect();
          
          if (!info.State.Running) {
            console.log(`🗑️ Removing failed dynamic runner: ${id.substr(0, 12)}`);
            this.dynamicRunners.delete(id);
          }
        } catch (error) {
          // Container doesn't exist, remove from tracking
          this.dynamicRunners.delete(id);
        }
      }
      
    } catch (error) {
      console.error('Error during health check:', error.message);
    }
  }

  /**
   * Restart a repository runner
   */
  async restartRepositoryRunner(repo) {
    try {
      const runner = this.repositoryRunners.get(repo);
      if (runner) {
        await runner.container.restart();
        runner.status = 'running';
        runner.lastCheck = new Date();
        
        this.emit('runner:restarted', { type: 'repository', repo });
      }
    } catch (error) {
      console.error(`Failed to restart repository runner for ${repo}:`, error.message);
      // If restart fails, recreate the runner
      await this.recreateRepositoryRunner(repo);
    }
  }

  /**
   * Recreate a repository runner
   */
  async recreateRepositoryRunner(repo) {
    try {
      console.log(`🔄 Recreating repository runner for ${repo}...`);
      
      // Remove old runner
      const oldRunner = this.repositoryRunners.get(repo);
      if (oldRunner) {
        try {
          await oldRunner.container.stop();
          await oldRunner.container.remove();
        } catch (error) {
          // Ignore errors if container is already gone
        }
      }
      
      // Create new runner
      const container = await this.createRepositoryRunner(repo);
      this.repositoryRunners.set(repo, {
        container: container,
        type: 'repository',
        repo: repo,
        status: 'running',
        lastCheck: new Date(),
        busy: false
      });
      
      this.emit('runner:recreated', { type: 'repository', repo });
      
    } catch (error) {
      console.error(`Failed to recreate repository runner for ${repo}:`, error.message);
    }
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      metrics: this.metrics,
      repositoryRunners: Array.from(this.repositoryRunners.entries()).map(([repo, runner]) => ({
        repo,
        status: runner.status,
        containerId: runner.container && runner.container.id ? runner.container.id.substr(0, 12) : 'unknown',
        busy: runner.busy
      })),
      dynamicRunners: Array.from(this.dynamicRunners.entries()).map(([id, runner]) => ({
        containerId: id && typeof id === 'string' ? id.substr(0, 12) : 'unknown',
        status: runner.status,
        createdAt: runner.createdAt,
        busy: runner.busy
      })),
      config: {
        repositoryRunners: this.config.repositoryRunners,
        dynamicPool: this.config.dynamicPool
      }
    };
  }

  /**
   * Stop the scaler
   */
  async stop() {
    console.log('🛑 Stopping Hybrid Scaler...');
    
    this.isRunning = false;
    
    // Clear intervals
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    
    this.emit('scaler:stopped');
  }

  /**
   * Manual scale operations
   */
  async manualScaleUp(count = 1) {
    console.log(`🔧 Manual scale up: ${count} runners`);
    await this.scaleUp(count);
  }

  async manualScaleDown(count = 1) {
    console.log(`🔧 Manual scale down: ${count} runners`);
    await this.scaleDown(count);
  }
}

module.exports = HybridScaler;