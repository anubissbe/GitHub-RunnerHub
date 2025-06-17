const { Octokit } = require('@octokit/rest');
const Docker = require('dockerode');
const EventEmitter = require('events');

class RunnerLifecycleManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.docker = new Docker();
    this.octokit = new Octokit({ auth: config.GITHUB_TOKEN });
    this.runners = new Map(); // runnerId -> runnerInfo
    this.healthCheckInterval = 30000; // 30 seconds
    this.stateCheckInterval = 60000; // 1 minute
  }

  async start() {
    console.log('Starting Runner Lifecycle Manager...');
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    // Start state synchronization
    this.startStateSynchronization();
    
    // Clean up orphaned containers on startup
    await this.cleanupOrphanedContainers();
  }

  async startHealthMonitoring() {
    setInterval(async () => {
      await this.checkRunnersHealth();
    }, this.healthCheckInterval);
  }

  async startStateSynchronization() {
    setInterval(async () => {
      await this.syncRunnerStates();
    }, this.stateCheckInterval);
  }

  async checkRunnersHealth() {
    for (const [runnerId, runnerInfo] of this.runners.entries()) {
      try {
        const container = this.docker.getContainer(runnerInfo.containerId);
        const stats = await container.stats({ stream: false });
        
        // Check if container is running
        const inspect = await container.inspect();
        const isRunning = inspect.State.Running;
        
        if (!isRunning) {
          console.log(`Runner ${runnerId} container is not running, marking as unhealthy`);
          runnerInfo.health = 'unhealthy';
          runnerInfo.lastError = 'Container stopped';
          this.emit('runner:unhealthy', { runnerId, reason: 'Container stopped' });
        } else {
          // Check CPU and memory usage
          const cpuUsage = this.calculateCPUUsage(stats);
          const memoryUsage = this.calculateMemoryUsage(stats);
          
          runnerInfo.health = 'healthy';
          runnerInfo.metrics = {
            cpu: cpuUsage,
            memory: memoryUsage,
            uptime: Date.now() - runnerInfo.startTime
          };
          
          // Emit high resource usage warnings
          if (cpuUsage > 90) {
            this.emit('runner:high-cpu', { runnerId, usage: cpuUsage });
          }
          if (memoryUsage > 90) {
            this.emit('runner:high-memory', { runnerId, usage: memoryUsage });
          }
        }
      } catch (error) {
        console.error(`Error checking health for runner ${runnerId}:`, error.message);
        runnerInfo.health = 'unknown';
        runnerInfo.lastError = error.message;
      }
    }
  }

  async syncRunnerStates() {
    try {
      // Get runners from GitHub
      const { data: githubRunners } = await this.octokit.rest.actions.listSelfHostedRunnersForRepo({
        owner: this.config.GITHUB_ORG,
        repo: this.config.GITHUB_REPO,
        per_page: 100
      });

      // Create a map of GitHub runners by name
      const githubRunnerMap = new Map(
        githubRunners.runners.map(r => [r.name, r])
      );

      // Check each tracked runner
      for (const [runnerId, runnerInfo] of this.runners.entries()) {
        const githubRunner = githubRunnerMap.get(runnerInfo.name);
        
        if (!githubRunner) {
          // Runner not found in GitHub, might be deregistered
          console.log(`Runner ${runnerInfo.name} not found in GitHub, cleaning up`);
          await this.cleanupRunner(runnerId);
        } else {
          // Update runner state
          runnerInfo.githubStatus = githubRunner.status;
          runnerInfo.busy = githubRunner.busy;
          runnerInfo.labels = githubRunner.labels;
          
          // Handle offline runners
          if (githubRunner.status === 'offline' && runnerInfo.health === 'healthy') {
            console.log(`Runner ${runnerInfo.name} is offline in GitHub but container is healthy, investigating...`);
            await this.handleOfflineRunner(runnerId, runnerInfo);
          }
        }
      }

      // Find orphaned GitHub runners (registered but no container)
      for (const [name, githubRunner] of githubRunnerMap.entries()) {
        const tracked = Array.from(this.runners.values()).find(r => r.name === name);
        if (!tracked && name.startsWith('github-runner-')) {
          console.log(`Found orphaned GitHub runner: ${name}, removing from GitHub`);
          await this.removeGitHubRunner(githubRunner.id);
        }
      }
    } catch (error) {
      console.error('Error syncing runner states:', error);
    }
  }

  async handleOfflineRunner(runnerId, runnerInfo) {
    // Try to restart the runner registration
    try {
      const container = this.docker.getContainer(runnerInfo.containerId);
      
      // Check container logs for errors
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: 50
      });
      
      const logContent = logs.toString();
      
      if (logContent.includes('Runner registration failed') || 
          logContent.includes('Http response code: Unauthorized')) {
        // Registration token expired, need to re-register
        console.log(`Runner ${runnerInfo.name} registration failed, re-registering...`);
        await this.reregisterRunner(runnerId, runnerInfo);
      } else if (logContent.includes('Runner listener exited')) {
        // Runner process crashed, restart container
        console.log(`Runner ${runnerInfo.name} process crashed, restarting container...`);
        await container.restart();
        this.emit('runner:restarted', { runnerId, reason: 'Process crashed' });
      }
    } catch (error) {
      console.error(`Error handling offline runner ${runnerId}:`, error);
      // If we can't fix it, remove the runner
      await this.cleanupRunner(runnerId);
    }
  }

  async reregisterRunner(runnerId, runnerInfo) {
    try {
      // Stop the current container
      const container = this.docker.getContainer(runnerInfo.containerId);
      await container.stop();
      await container.remove();
      
      // Get new registration token
      const { data: token } = await this.octokit.rest.actions.createRegistrationTokenForRepo({
        owner: this.config.GITHUB_ORG,
        repo: this.config.GITHUB_REPO
      });

      // Create new container with fresh token
      const newContainer = await this.docker.createContainer({
        Image: this.config.RUNNER_IMAGE || 'myoung34/github-runner:latest',
        name: `${runnerInfo.name}-${Date.now()}`,
        Env: [
          `ACCESS_TOKEN=${token.token}`,
          `RUNNER_NAME=${runnerInfo.name}`,
          `RUNNER_WORKDIR=/tmp/runner/work`,
          `RUNNER_GROUP=default`,
          `LABELS=${runnerInfo.labels.map(l => l.name).join(',')}`,
          `REPO_URL=https://github.com/${this.config.GITHUB_ORG}/${this.config.GITHUB_REPO}`,
          'EPHEMERAL=true'
        ],
        HostConfig: {
          AutoRemove: true,
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
          SecurityOpt: ['label:disable']
        }
      });

      await newContainer.start();
      
      // Update runner info
      runnerInfo.containerId = newContainer.id;
      runnerInfo.startTime = Date.now();
      runnerInfo.health = 'healthy';
      
      console.log(`Successfully re-registered runner ${runnerInfo.name}`);
      this.emit('runner:reregistered', { runnerId, name: runnerInfo.name });
    } catch (error) {
      console.error(`Error re-registering runner ${runnerId}:`, error);
      await this.cleanupRunner(runnerId);
    }
  }

  async cleanupRunner(runnerId) {
    const runnerInfo = this.runners.get(runnerId);
    if (!runnerInfo) return;

    try {
      // Stop and remove container
      const container = this.docker.getContainer(runnerInfo.containerId);
      try {
        await container.stop();
        await container.remove();
      } catch (err) {
        // Container might already be stopped/removed
      }

      // Remove from GitHub if still registered
      if (runnerInfo.githubId) {
        await this.removeGitHubRunner(runnerInfo.githubId);
      }

      // Remove from tracking
      this.runners.delete(runnerId);
      
      console.log(`Cleaned up runner ${runnerInfo.name}`);
      this.emit('runner:removed', { runnerId, name: runnerInfo.name });
    } catch (error) {
      console.error(`Error cleaning up runner ${runnerId}:`, error);
    }
  }

  async removeGitHubRunner(githubRunnerId) {
    try {
      await this.octokit.rest.actions.deleteSelfHostedRunnerFromRepo({
        owner: this.config.GITHUB_ORG,
        repo: this.config.GITHUB_REPO,
        runner_id: githubRunnerId
      });
    } catch (error) {
      // Runner might already be removed
      console.log(`Could not remove runner ${githubRunnerId} from GitHub:`, error.message);
    }
  }

  async cleanupOrphanedContainers() {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          name: ['github-runner']
        }
      });

      for (const containerInfo of containers) {
        const container = this.docker.getContainer(containerInfo.Id);
        const inspect = await container.inspect();
        
        // Check if container is orphaned (not in our tracking)
        const isTracked = Array.from(this.runners.values()).some(
          r => r.containerId === containerInfo.Id
        );
        
        if (!isTracked) {
          console.log(`Found orphaned container: ${inspect.Name}, cleaning up...`);
          try {
            if (inspect.State.Running) {
              await container.stop();
            }
            await container.remove();
          } catch (err) {
            console.error(`Error removing orphaned container ${inspect.Name}:`, err);
          }
        }
      }
    } catch (error) {
      console.error('Error cleaning up orphaned containers:', error);
    }
  }

  // Helper methods
  calculateCPUUsage(stats) {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;
    return Math.round(cpuPercent * 100) / 100;
  }

  calculateMemoryUsage(stats) {
    const memoryUsage = stats.memory_stats.usage / stats.memory_stats.limit * 100;
    return Math.round(memoryUsage * 100) / 100;
  }

  // Public API
  registerRunner(runnerId, runnerInfo) {
    this.runners.set(runnerId, {
      ...runnerInfo,
      health: 'healthy',
      startTime: Date.now(),
      metrics: {}
    });
    console.log(`Registered runner ${runnerId} for lifecycle management`);
  }

  getRunnerStatus(runnerId) {
    return this.runners.get(runnerId);
  }

  getAllRunners() {
    return Array.from(this.runners.entries()).map(([id, info]) => ({
      id,
      ...info
    }));
  }

  async gracefulShutdown() {
    console.log('Shutting down Runner Lifecycle Manager...');
    
    // Stop all monitoring intervals
    clearInterval(this.healthCheckInterval);
    clearInterval(this.stateCheckInterval);
    
    // Clean up all runners
    for (const [runnerId] of this.runners.entries()) {
      await this.cleanupRunner(runnerId);
    }
  }
}

module.exports = RunnerLifecycleManager;