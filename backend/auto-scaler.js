const { Octokit } = require('@octokit/rest');
const Docker = require('dockerode');
const RunnerLifecycleManager = require('./runner-lifecycle');
const docker = new Docker();

class AutoScaler {
  constructor(config) {
    this.config = {
      minRunners: config.MIN_RUNNERS || 5,
      maxRunners: config.MAX_RUNNERS || 50,
      scaleThreshold: config.SCALE_THRESHOLD || 0.8,
      scaleIncrement: config.SCALE_INCREMENT || 5,
      cooldownPeriod: config.COOLDOWN_PERIOD || 300, // 5 minutes
      idleTimeout: config.IDLE_TIMEOUT || 1800, // 30 minutes
      githubToken: config.GITHUB_TOKEN,
      githubOrg: config.GITHUB_ORG,
      githubRepo: config.GITHUB_REPO,
      runnerImage: config.RUNNER_IMAGE || 'myoung34/github-runner:latest',
      ...config
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
    
    // Start lifecycle manager
    await this.lifecycleManager.start();
    
    // Initial runner spawn
    await this.ensureMinimumRunners();
    
    // Start monitoring loop
    this.monitorInterval = setInterval(() => this.monitorAndScale(), 30000); // Check every 30 seconds
    
    // Start idle cleanup loop
    this.cleanupInterval = setInterval(() => this.cleanupIdleRunners(), 60000); // Check every minute
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
      console.error('Error getting runner metrics:', error);
      return { totalRunners: 0, busyRunners: 0, idleRunners: 0, utilization: 0, runners: [] };
    }
  }

  canScale() {
    const now = Date.now();
    const timeSinceLastScale = (now - this.lastScaleTime) / 1000;
    return timeSinceLastScale >= this.config.cooldownPeriod;
  }

  async scaleUp() {
    this.scalingInProgress = true;
    const metrics = await this.getRunnerMetrics();
    
    console.log(`🚀 Scaling up! Current: ${metrics.totalRunners} runners at ${(metrics.utilization * 100).toFixed(1)}% utilization`);
    
    try {
      const runnersToAdd = Math.min(
        this.config.scaleIncrement,
        this.config.maxRunners - metrics.totalRunners
      );

      console.log(`Adding ${runnersToAdd} new runners...`);
      
      const promises = [];
      for (let i = 0; i < runnersToAdd; i++) {
        promises.push(this.spawnRunner());
      }
      
      await Promise.all(promises);
      this.lastScaleTime = Date.now();
      
      console.log(`✅ Successfully added ${runnersToAdd} runners`);
      
      // Emit scaling event
      this.emit('scale', {
        action: 'up',
        count: runnersToAdd,
        reason: `Utilization reached ${(metrics.utilization * 100).toFixed(1)}%`,
        totalRunners: metrics.totalRunners + runnersToAdd
      });
    } catch (error) {
      console.error('Error scaling up:', error);
    } finally {
      this.scalingInProgress = false;
    }
  }

  async scaleDown() {
    const metrics = await this.getRunnerMetrics();
    
    console.log(`📉 Scaling down! Current: ${metrics.totalRunners} runners at ${(metrics.utilization * 100).toFixed(1)}% utilization`);
    
    try {
      const runnersToRemove = Math.min(
        this.config.scaleIncrement,
        metrics.totalRunners - this.config.minRunners
      );

      // Find idle runners to remove
      const idleRunners = metrics.runners
        .filter(r => r.status === 'online' && !r.busy)
        .slice(0, runnersToRemove);

      for (const runner of idleRunners) {
        await this.removeRunner(runner.id);
      }
      
      console.log(`✅ Successfully removed ${idleRunners.length} idle runners`);
      
      // Emit scaling event
      this.emit('scale', {
        action: 'down',
        count: idleRunners.length,
        reason: `Low utilization: ${(metrics.utilization * 100).toFixed(1)}%`,
        totalRunners: metrics.totalRunners - idleRunners.length
      });
    } catch (error) {
      console.error('Error scaling down:', error);
    }
  }

  async spawnRunner() {
    const runnerName = `github-runner-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
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
          `ACCESS_TOKEN=${token.token}`,
          `RUNNER_NAME=${runnerName}`,
          `RUNNER_WORKDIR=/tmp/runner/work`,
          `RUNNER_GROUP=default`,
          `LABELS=self-hosted,Linux,X64,docker,auto-scaled`,
          `REPO_URL=https://github.com/${this.config.githubOrg}/${this.config.githubRepo}`,
          'EPHEMERAL=true' // Runner removes itself after job completion
        ],
        HostConfig: {
          AutoRemove: true,
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
        lastActiveTime: Date.now(),
        labels: [
          { id: 1, name: 'self-hosted', type: 'read-only' },
          { id: 2, name: 'Linux', type: 'read-only' },
          { id: 3, name: 'X64', type: 'read-only' },
          { id: 4, name: 'docker', type: 'read-only' },
          { id: 5, name: 'auto-scaled', type: 'read-only' }
        ]
      };
      
      this.runnerPool.set(runnerName, runnerInfo);
      
      // Register with lifecycle manager
      this.lifecycleManager.registerRunner(runnerName, runnerInfo);

      return runnerName;
    } catch (error) {
      console.error(`Error spawning runner ${runnerName}:`, error);
      throw error;
    }
  }

  async removeRunner(runnerId) {
    try {
      // Find runner in pool
      let runnerContainer = null;
      let runnerName = null;
      
      for (const [name, info] of this.runnerPool.entries()) {
        if (name.includes(runnerId.toString())) {
          runnerContainer = info.container;
          runnerName = name;
          break;
        }
      }

      if (runnerContainer) {
        // Stop and remove container
        await runnerContainer.stop();
        this.runnerPool.delete(runnerName);
        console.log(`✅ Removed runner: ${runnerName}`);
      }

      // Remove from GitHub
      try {
        await this.octokit.rest.actions.deleteSelfHostedRunnerFromRepo({
          owner: this.config.githubOrg,
          repo: this.config.githubRepo,
          runner_id: runnerId
        });
      } catch (error) {
        // Runner might already be removed
        console.log(`Runner ${runnerId} may already be removed from GitHub`);
      }
    } catch (error) {
      console.error(`Error removing runner ${runnerId}:`, error);
    }
  }

  async ensureMinimumRunners() {
    const metrics = await this.getRunnerMetrics();
    const runnersNeeded = this.config.minRunners - metrics.totalRunners;
    
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
        if (runner && !runner.busy) {
          await this.removeRunner(runner.id);
        }
      }
    }
  }

  // Event emitter functionality
  emit(event, data) {
    if (this.onScaleCallback) {
      this.onScaleCallback(event, data);
    }
  }

  onScale(callback) {
    this.onScaleCallback = callback;
  }

  async getStatus() {
    const metrics = await this.getRunnerMetrics();
    const containers = await docker.listContainers({
      filters: { name: ['github-runner'] }
    });

    // Get lifecycle status
    const lifecycleRunners = this.lifecycleManager.getAllRunners();

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
        startTime: info.startTime,
        uptime: Math.round((Date.now() - info.startTime) / 1000 / 60), // minutes
        health: lifecycleRunners.find(r => r.name === name)?.health || 'unknown'
      })),
      containers: containers.length,
      lastScaleTime: this.lastScaleTime,
      scalingInProgress: this.scalingInProgress,
      lifecycleStatus: {
        totalTracked: lifecycleRunners.length,
        healthy: lifecycleRunners.filter(r => r.health === 'healthy').length,
        unhealthy: lifecycleRunners.filter(r => r.health === 'unhealthy').length
      }
    };
  }

  // Lifecycle event handlers
  async handleUnhealthyRunner(data) {
    console.log(`Handling unhealthy runner: ${data.runnerId}`);
    
    // Check if we're below minimum runners
    const metrics = await this.getRunnerMetrics();
    if (metrics.totalRunners <= this.config.minRunners) {
      console.log('Below minimum runners, spawning replacement...');
      await this.spawnRunner();
    }
  }

  async handleRunnerRemoved(data) {
    console.log(`Runner removed: ${data.name}`);
    
    // Remove from our pool
    this.runnerPool.delete(data.name);
    
    // Check if we need to maintain minimum
    const metrics = await this.getRunnerMetrics();
    if (metrics.totalRunners < this.config.minRunners) {
      console.log('Below minimum runners after removal, spawning replacement...');
      await this.spawnRunner();
    }
  }

  async shutdown() {
    console.log('Shutting down Auto-Scaler...');
    
    // Clear intervals
    clearInterval(this.monitorInterval);
    clearInterval(this.cleanupInterval);
    
    // Shutdown lifecycle manager
    await this.lifecycleManager.gracefulShutdown();
  }
}

module.exports = AutoScaler;