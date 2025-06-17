const Docker = require('dockerode');
const { Octokit } = require('@octokit/rest');
const EventEmitter = require('events');
const RunnerLifecycleManager = require('./runner-lifecycle');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

class AutoScaler extends EventEmitter {
  constructor(config) {
    super();
    this.config = {
      githubToken: config.GITHUB_TOKEN,
      githubOrg: config.GITHUB_ORG,
      githubRepo: config.GITHUB_REPO,
      minRunners: config.MIN_RUNNERS || 5,
      maxRunners: config.MAX_RUNNERS || 50,
      scaleThreshold: config.SCALE_THRESHOLD || 0.8,
      scaleIncrement: config.SCALE_INCREMENT || 5,
      cooldownPeriod: config.COOLDOWN_PERIOD || 300,
      idleTimeout: config.IDLE_TIMEOUT || 1800,
      runnerImage: config.RUNNER_IMAGE || 'myoung34/github-runner:latest'
    };

    this.octokit = new Octokit({
      auth: this.config.githubToken
    });

    this.lastScaleTime = 0;
    this.runnerPool = new Map(); // runner_id -> container_info
    this.scalingInProgress = false;
    
    // Initialize lifecycle manager
    this.lifecycleManager = new RunnerLifecycleManager(this.config);
    this.lifecycleManager.on('runner:unhealthy', (data) => this.handleUnhealthyRunner(data));
    this.lifecycleManager.on('runner:removed', (data) => this.handleRunnerRemoved(data));
  }

  async start() {
    console.log('Starting Auto-Scaler Engine...');
    console.log(`Configuration: Min=${this.config.minRunners}, Max=${this.config.maxRunners}, Threshold=${this.config.scaleThreshold * 100}%`);
    
    try {
      // Start lifecycle manager (without cleanup to avoid blocking)
      console.log('Starting lifecycle manager...');
      this.lifecycleManager.startHealthMonitoring();
      this.lifecycleManager.startStateSynchronization();
      
      // Initial runner spawn
      console.log('Checking initial runner state...');
      await this.ensureMinimumRunners();
      
      // Start monitoring loop
      this.monitorInterval = setInterval(() => {
        console.log('Running monitoring cycle...');
        this.monitorAndScale().catch(err => console.error('Monitor error:', err));
      }, 30000); // Check every 30 seconds
      
      // Start idle cleanup loop
      this.cleanupInterval = setInterval(() => this.cleanupIdleRunners(), 60000); // Check every minute
      
      // Clean up orphaned containers in background after a delay
      setTimeout(() => {
        console.log('Starting background cleanup of orphaned containers...');
        this.lifecycleManager.cleanupOrphanedContainers().catch(err => 
          console.error('Background cleanup error:', err)
        );
      }, 10000); // 10 second delay
      
    } catch (error) {
      console.error('Error starting auto-scaler:', error);
      throw error;
    }
  }

  async monitorAndScale() {
    if (this.scalingInProgress) {
      console.log('Scaling already in progress, skipping...');
      return;
    }

    try {
      const metrics = await this.getRunnerMetrics();
      console.log(`Current utilization: ${(metrics.utilization * 100).toFixed(1)}% (${metrics.busyRunners}/${metrics.totalRunners} runners busy)`);

      // Check if we need to scale up
      if (metrics.utilization >= this.config.scaleThreshold && metrics.totalRunners < this.config.maxRunners) {
        if (this.canScale()) {
          await this.scaleUp();
        }
      }

      // Check if we need to scale down
      if (metrics.utilization < 0.2 && metrics.totalRunners > this.config.minRunners) {
        await this.scaleDown();
      }
    } catch (error) {
      console.error('Error in monitoring loop:', error);
    }
  }

  async getRunnerMetrics() {
    try {
      // Get runners from GitHub
      const { data: runners } = await this.octokit.rest.actions.listSelfHostedRunnersForRepo({
        owner: this.config.githubOrg,
        repo: this.config.githubRepo,
        per_page: 100
      });

      const totalRunners = runners.runners.filter(r => r.status === 'online').length;
      const busyRunners = runners.runners.filter(r => r.status === 'online' && r.busy).length;
      const utilization = totalRunners > 0 ? busyRunners / totalRunners : 0;

      return {
        totalRunners,
        busyRunners,
        idleRunners: totalRunners - busyRunners,
        utilization,
        runners: runners.runners
      };
    } catch (error) {
      console.error('Error getting runner metrics:', error.message);
      // Return empty metrics on error
      return {
        totalRunners: 0,
        busyRunners: 0,
        idleRunners: 0,
        utilization: 0,
        runners: []
      };
    }
  }

  canScale() {
    const now = Date.now();
    const timeSinceLastScale = (now - this.lastScaleTime) / 1000;
    return timeSinceLastScale >= this.config.cooldownPeriod;
  }

  async scaleUp() {
    this.scalingInProgress = true;
    console.log(`📈 Scaling up by ${this.config.scaleIncrement} runners`);

    try {
      const promises = [];
      for (let i = 0; i < this.config.scaleIncrement; i++) {
        promises.push(this.spawnRunner());
      }

      await Promise.all(promises);
      this.lastScaleTime = Date.now();
      this.emit('scale', 'up', { count: this.config.scaleIncrement });
    } catch (error) {
      console.error('Error scaling up:', error);
      this.emit('scale', 'error', { error: error.message });
    } finally {
      this.scalingInProgress = false;
    }
  }

  async scaleDown() {
    console.log(`📉 Scaling down by removing idle runners`);
    
    try {
      const metrics = await this.getRunnerMetrics();
      const idleRunners = metrics.runners.filter(r => r.status === 'online' && !r.busy);
      
      // Remove up to scaleIncrement idle runners
      let removed = 0;
      for (const runner of idleRunners) {
        if (removed >= this.config.scaleIncrement) break;
        if (metrics.totalRunners - removed <= this.config.minRunners) break;
        
        await this.removeRunner(runner.id, runner.name);
        removed++;
      }

      this.emit('scale', 'down', { count: removed });
    } catch (error) {
      console.error('Error scaling down:', error);
      this.emit('scale', 'error', { error: error.message });
    }
  }

  async removeRunner(runnerId, runnerName) {
    try {
      // Remove from GitHub
      await this.octokit.rest.actions.deleteSelfHostedRunnerFromRepo({
        owner: this.config.githubOrg,
        repo: this.config.githubRepo,
        runner_id: runnerId
      });

      // Stop and remove container
      const containers = await docker.listContainers({ all: true });
      const container = containers.find(c => c.Names.includes(`/${runnerName}`));
      
      if (container) {
        const dockerContainer = docker.getContainer(container.Id);
        await dockerContainer.stop();
        await dockerContainer.remove();
      }

      console.log(`🗑️  Removed runner: ${runnerName}`);
    } catch (error) {
      console.error(`Error removing runner ${runnerName}:`, error.message);
    }
  }

  async spawnRunner() {
    const runnerName = `github-runner-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`Creating runner: ${runnerName}`);
      
      // Get registration token
      const { data: token } = await this.octokit.rest.actions.createRegistrationTokenForRepo({
        owner: this.config.githubOrg,
        repo: this.config.githubRepo
      });

      // Create container
      const container = await docker.createContainer({
        Image: this.config.runnerImage,
        name: runnerName,
        Env: [
          `RUNNER_TOKEN=${token.token}`,
          `RUNNER_NAME=${runnerName}`,
          `RUNNER_WORKDIR=/tmp/runner/work`,
          `RUNNER_GROUP=default`,
          `LABELS=self-hosted,Linux,X64,docker,auto-scaled`,
          `REPO_URL=https://github.com/${this.config.githubOrg}/${this.config.githubRepo}`
          // Removed EPHEMERAL=true to keep runners persistent
        ],
        HostConfig: {
          AutoRemove: false,
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
          SecurityOpt: ['label:disable']
        }
      });

      await container.start();
      console.log(`✅ Spawned runner: ${runnerName}`);
      
      // Track container
      const runnerInfo = {
        container,
        containerId: container.id,
        name: runnerName,
        startTime: Date.now(),
        lastActiveTime: Date.now()
      };
      
      this.runnerPool.set(runnerName, runnerInfo);
      // TODO: Fix lifecycle manager tracking
      // this.lifecycleManager.trackRunner(runnerName, container.id);
      
      this.emit('runner', 'spawned', { name: runnerName, id: container.id });
    } catch (error) {
      console.error(`Error creating runner ${runnerName}:`, error);
      this.emit('runner', 'error', { name: runnerName, error: error.message });
      throw error;
    }
  }

  async handleUnhealthyRunner(data) {
    console.log(`🏥 Handling unhealthy runner: ${data.name}`);
    
    try {
      // Try to restart the container
      const container = docker.getContainer(data.containerId);
      await container.restart();
      console.log(`Restarted unhealthy runner: ${data.name}`);
    } catch (error) {
      console.error(`Failed to restart runner ${data.name}, removing it:`, error.message);
      // Remove the runner if restart fails
      try {
        const metrics = await this.getRunnerMetrics();
        const runner = metrics.runners.find(r => r.name === data.name);
        if (runner) {
          await this.removeRunner(runner.id, runner.name);
        }
      } catch (removeError) {
        console.error(`Failed to remove unhealthy runner ${data.name}:`, removeError.message);
      }
    }
  }

  async handleRunnerRemoved(data) {
    this.runnerPool.delete(data.name);
    console.log(`Runner removed from pool: ${data.name}`);
    
    // Ensure minimum runners
    await this.ensureMinimumRunners();
  }

  async ensureMinimumRunners() {
    console.log('Ensuring minimum runners...');
    const metrics = await this.getRunnerMetrics();
    const runnersNeeded = this.config.minRunners - metrics.totalRunners;
    
    console.log(`Current runners: ${metrics.totalRunners}, Minimum required: ${this.config.minRunners}, Need to spawn: ${runnersNeeded}`);
    
    if (runnersNeeded > 0) {
      console.log(`📦 Spawning ${runnersNeeded} runners to meet minimum requirement`);
      const promises = [];
      for (let i = 0; i < runnersNeeded; i++) {
        promises.push(this.spawnRunner());
      }
      await Promise.all(promises);
    }
  }

  async cleanupIdleRunners() {
    const now = Date.now();
    const metrics = await this.getRunnerMetrics();
    
    // Only cleanup if we're above minimum
    if (metrics.totalRunners <= this.config.minRunners) {
      return;
    }

    for (const [name, info] of this.runnerPool.entries()) {
      const idleTime = (now - info.lastActiveTime) / 1000;
      
      if (idleTime > this.config.idleTimeout) {
        console.log(`🧹 Cleaning up idle runner: ${name} (idle for ${Math.round(idleTime / 60)} minutes)`);
        
        // Find the runner ID
        const runner = metrics.runners.find(r => r.name === name);
        if (runner) {
          await this.removeRunner(runner.id, name);
        }
      }
    }
  }

  async stop() {
    console.log('Stopping Auto-Scaler Engine...');
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    await this.lifecycleManager.stop();
  }

  // Get status for API
  async getStatus() {
    const metrics = await this.getRunnerMetrics();
    const containers = await docker.listContainers({ all: true, filters: { name: ['github-runner'] } });
    
    return {
      config: {
        minRunners: this.config.minRunners,
        maxRunners: this.config.maxRunners,
        scaleThreshold: this.config.scaleThreshold,
        scaleIncrement: this.config.scaleIncrement
      },
      metrics,
      runnerPool: Array.from(this.runnerPool.entries()).map(([name, info]) => ({
        name,
        containerId: info.containerId,
        startTime: info.startTime,
        lastActiveTime: info.lastActiveTime
      })),
      containers: containers.length,
      lastScaleTime: this.lastScaleTime,
      scalingInProgress: this.scalingInProgress,
      lifecycleStatus: this.lifecycleManager.getStatus()
    };
  }
}

module.exports = AutoScaler;