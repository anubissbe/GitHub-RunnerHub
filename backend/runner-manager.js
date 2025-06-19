const Docker = require('dockerode');
const EventEmitter = require('events');
const TokenManager = require('./token-manager');

/**
 * Enhanced Runner Manager with Health Monitoring and Token Management
 * Manages GitHub Actions runners with automatic recovery and token rotation
 */
class RunnerManager extends EventEmitter {
  constructor(config) {
    super();
    
    this.config = {
      githubToken: config.GITHUB_TOKEN,
      githubOrg: config.GITHUB_ORG,
      repositories: config.REPOSITORIES || [
        'ai-music-studio',
        'mcp-enhanced-workspace', 
        'JarvisAI',
        'ProjectHub-Mcp',
        'GitHub-RunnerHub'
      ],
      runnerImage: config.RUNNER_IMAGE || 'myoung34/github-runner:latest',
      healthCheckInterval: config.HEALTH_CHECK_INTERVAL || 60000, // 1 minute
      recoveryAttempts: config.RECOVERY_ATTEMPTS || 3,
      recoveryDelay: config.RECOVERY_DELAY || 30000, // 30 seconds
      containerRestartTimeout: config.CONTAINER_RESTART_TIMEOUT || 300000 // 5 minutes
    };

    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    
    // Initialize Token Manager
    this.tokenManager = new TokenManager({
      GITHUB_TOKEN: this.config.githubToken,
      GITHUB_ORG: this.config.githubOrg,
      REPOSITORIES: this.config.repositories
    });

    // Runner tracking
    this.runnerStatus = new Map(); // repo -> { container, status, lastCheck, recoveryAttempts }
    this.healthCheckInterval = null;
    this.isRunning = false;

    // Listen to token manager events
    this.tokenManager.on('token:generated', (data) => this.handleTokenGenerated(data));
    this.tokenManager.on('token:generation_failed', (data) => this.handleTokenGenerationFailed(data));
  }

  /**
   * Initialize the Runner Manager
   */
  async initialize() {
    console.log('🚀 Initializing Enhanced Runner Manager...');
    
    try {
      // Initialize token manager first
      await this.tokenManager.initialize(this.config.repositories);
      
      // Start health monitoring
      await this.startHealthMonitoring();
      
      // Ensure all repository runners exist
      await this.ensureAllRunners();
      
      this.isRunning = true;
      console.log('✅ Enhanced Runner Manager initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize Runner Manager:', error);
      throw error;
    }
  }

  /**
   * Clean up auto-scaler generated runners (they have random suffixes)
   */
  async cleanupAutoScalerRunners() {
    try {
      console.log('🧹 Cleaning up auto-scaler generated runners...');
      
      const containers = await this.docker.listContainers({ all: true });
      const autoScalerRunners = containers.filter(container => 
        container.Names.some(name => 
          name.includes('runnerhub-') && // Auto-scaler pattern
          !name.includes('frontend') && 
          !name.includes('backend') &&
          name.match(/runnerhub-[a-z0-9]{6}/) // Random suffix pattern
        )
      );
      
      for (const containerInfo of autoScalerRunners) {
        try {
          const container = this.docker.getContainer(containerInfo.Id);
          const containerName = containerInfo.Names[0].replace('/', '');
          console.log(`🗑️ Removing auto-scaler runner: ${containerName}`);
          
          await container.stop({ t: 10 });
          await container.remove();
          
        } catch (error) {
          console.warn(`⚠️ Error removing auto-scaler runner:`, error.message);
        }
      }
      
      if (autoScalerRunners.length > 0) {
        console.log(`✅ Cleaned up ${autoScalerRunners.length} auto-scaler runners`);
      }
      
    } catch (error) {
      console.error('❌ Error cleaning up auto-scaler runners:', error.message);
    }
  }

  /**
   * Ensure all repository runners are created and healthy
   */
  async ensureAllRunners() {
    console.log('🔍 Ensuring all repository runners are created...');
    
    // First clean up any auto-scaler runners
    await this.cleanupAutoScalerRunners();
    
    for (const repo of this.config.repositories) {
      try {
        await this.ensureRunner(repo);
      } catch (error) {
        console.error(`❌ Failed to ensure runner for ${repo}:`, error.message);
        this.emit('runner:ensure_failed', { repo, error: error.message });
      }
    }
  }

  /**
   * Ensure a specific repository runner exists and is healthy
   */
  async ensureRunner(repo) {
    const expectedName = this.getContainerName(repo);
    
    try {
      // Check if container already exists
      const existingContainer = await this.getRunnerContainer(repo);
      
      if (existingContainer) {
        // Check if container needs recreation due to wrong naming
        if (existingContainer._needsRecreation) {
          console.log(`📝 Runner for ${repo} needs recreation for proper naming`);
          await this.recreateRunner(repo, existingContainer);
          return await this.getRunnerContainer(repo);
        }
        
        // Check container health
        const isHealthy = await this.checkRunnerHealth(repo, existingContainer);
        
        if (isHealthy) {
          console.log(`✅ Runner for ${repo} is healthy`);
          this.updateRunnerStatus(repo, 'healthy', existingContainer);
          return existingContainer;
        } else {
          console.log(`🏥 Runner for ${repo} is unhealthy, recreating...`);
          await this.recreateRunner(repo, existingContainer);
          return await this.getRunnerContainer(repo);
        }
      } else {
        // Create new runner
        console.log(`🆕 Creating new runner for ${repo}...`);
        return await this.createRunner(repo);
      }
      
    } catch (error) {
      console.error(`❌ Error ensuring runner for ${repo}:`, error.message);
      this.updateRunnerStatus(repo, 'error', null, error.message);
      throw error;
    }
  }

  /**
   * Create a new runner for a repository
   */
  async createRunner(repo) {
    // Normalize container name to match repository naming consistently
    const containerName = this.getContainerName(repo);
    
    try {
      console.log(`🔨 Creating runner container: ${containerName}`);
      
      // Get fresh token from token manager
      const tokenData = await this.tokenManager.getValidToken(repo);
      
      if (!tokenData || !tokenData.token) {
        throw new Error(`No valid token available for repository ${repo}`);
      }

      // Create container
      const container = await this.docker.createContainer({
        Image: this.config.runnerImage,
        name: containerName,
        Env: [
          `RUNNER_TOKEN=${tokenData.token}`,
          `RUNNER_NAME=${containerName}`,
          `RUNNER_WORKDIR=/tmp/runner/work`,
          `RUNNER_GROUP=default`,
          `LABELS=self-hosted,Linux,X64,docker,runnerhub,${repo}`,
          `REPO_URL=https://github.com/${this.config.githubOrg}/${repo}`
        ],
        HostConfig: {
          AutoRemove: false,
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
          SecurityOpt: ['label:disable']
        },
        Labels: {
          'runnerhub.repository': repo,
          'runnerhub.created': new Date().toISOString(),
          'runnerhub.token_expires': tokenData.expiresAt.toISOString()
        }
      });

      // Start container
      await container.start();
      console.log(`✅ Runner created and started: ${containerName}`);
      
      // Update status
      this.updateRunnerStatus(repo, 'creating', container);
      
      // Wait for container to be ready
      await this.waitForRunnerReady(repo, container);
      
      this.emit('runner:created', { repo, container: containerName });
      return container;
      
    } catch (error) {
      console.error(`❌ Failed to create runner for ${repo}:`, error.message);
      this.emit('runner:creation_failed', { repo, error: error.message });
      throw error;
    }
  }

  /**
   * Recreate a runner (remove old, create new)
   */
  async recreateRunner(repo, oldContainer = null) {
    const containerName = this.getContainerName(repo);
    
    try {
      console.log(`🔄 Recreating runner for ${repo}...`);
      
      // Remove old container if provided
      if (oldContainer) {
        try {
          await oldContainer.stop({ t: 10 }); // 10 second grace period
          await oldContainer.remove();
          console.log(`🗑️ Removed old container for ${repo}`);
        } catch (error) {
          console.warn(`⚠️ Error removing old container for ${repo}:`, error.message);
        }
      }

      // Create new runner
      const newContainer = await this.createRunner(repo);
      
      console.log(`✅ Successfully recreated runner for ${repo}`);
      this.emit('runner:recreated', { repo, container: containerName });
      
      return newContainer;
      
    } catch (error) {
      console.error(`❌ Failed to recreate runner for ${repo}:`, error.message);
      this.updateRunnerStatus(repo, 'error', null, error.message);
      throw error;
    }
  }

  /**
   * Get normalized container name for a repository
   */
  getContainerName(repo) {
    // Normalize repository names to consistent container naming
    const repoMap = {
      'ai-music-studio': 'runnerhub_ai_music_studio',
      'mcp-enhanced-workspace': 'runnerhub_mcp_enhanced_workspace',
      'JarvisAI': 'runnerhub_jarvisai',
      'ProjectHub-Mcp': 'runnerhub_projecthub_mcp',
      'GitHub-RunnerHub': 'runnerhub_github_runnerhub'
    };
    
    return repoMap[repo] || `runnerhub_${repo.toLowerCase().replace('-', '_')}`;
  }

  /**
   * Get runner container for a repository (handles both old and new naming)
   */
  async getRunnerContainer(repo) {
    const expectedName = this.getContainerName(repo);
    
    // Also check for old naming patterns that might exist
    const possibleNames = [
      expectedName,
      `runnerhub_${repo.replace('-', '_')}`, // Old pattern
      `runnerhub_${repo}`, // Direct name
      `runnerhub_${repo.replace('GitHub-RunnerHub', 'GitHub_RunnerHub')}`, // Special case
      `runnerhub_${repo.replace('ProjectHub-Mcp', 'ProjectHub_Mcp')}`, // Special case
      `runnerhub_${repo.replace('JarvisAI', 'JarvisAI')}` // Special case
    ];
    
    try {
      const containers = await this.docker.listContainers({ all: true });
      
      // First look for exact name match
      let runnerContainer = containers.find(container => 
        container.Names.some(name => name.replace('/', '') === expectedName)
      );
      
      // If not found, look for any of the possible names
      if (!runnerContainer) {
        runnerContainer = containers.find(container => 
          possibleNames.some(possibleName => 
            container.Names.some(name => name.includes(possibleName))
          )
        );
      }
      
      // If found but name doesn't match expected, schedule for renaming
      if (runnerContainer) {
        const actualName = runnerContainer.Names[0].replace('/', '');
        if (actualName !== expectedName) {
          console.log(`📝 Found runner for ${repo} with old name: ${actualName}, will recreate with proper name: ${expectedName}`);
          // Return the container but mark it for recreation
          const container = this.docker.getContainer(runnerContainer.Id);
          container._needsRecreation = true;
          return container;
        }
        return this.docker.getContainer(runnerContainer.Id);
      }
      
      return null;
    } catch (error) {
      console.error(`Error getting container for ${repo}:`, error.message);
      return null;
    }
  }

  /**
   * Check health of a runner
   */
  async checkRunnerHealth(repo, container) {
    try {
      // Get container info
      const info = await container.inspect();
      
      // Check if container is running
      if (info.State.Status !== 'running') {
        console.log(`⚠️ Container for ${repo} is not running (status: ${info.State.Status})`);
        return false;
      }

      // Check if container is restarting frequently
      if (info.RestartCount > 5) {
        console.log(`⚠️ Container for ${repo} has restarted ${info.RestartCount} times`);
        return false;
      }

      // Check container age vs restart count
      const containerAge = Date.now() - new Date(info.Created).getTime();
      const recentRestarts = info.RestartCount > 0 && containerAge < this.config.containerRestartTimeout;
      
      if (recentRestarts) {
        console.log(`⚠️ Container for ${repo} has recent restarts`);
        return false;
      }

      // Additional health checks can be added here
      // - Check if GitHub runner process is running inside container
      // - Check network connectivity
      // - Check registration status with GitHub
      
      return true;
      
    } catch (error) {
      console.error(`❌ Health check failed for ${repo}:`, error.message);
      return false;
    }
  }

  /**
   * Wait for runner to be ready
   */
  async waitForRunnerReady(repo, container, timeout = 120000) {
    console.log(`⏳ Waiting for runner ${repo} to be ready...`);
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const info = await container.inspect();
        
        if (info.State.Status === 'running' && !info.State.Restarting) {
          console.log(`✅ Runner ${repo} is ready`);
          this.updateRunnerStatus(repo, 'healthy', container);
          return true;
        }
        
        if (info.State.Status === 'exited') {
          throw new Error(`Runner container exited with code ${info.State.ExitCode}`);
        }
        
        await this.sleep(5000); // Wait 5 seconds
        
      } catch (error) {
        console.error(`❌ Error waiting for runner ${repo}:`, error.message);
        throw error;
      }
    }
    
    throw new Error(`Timeout waiting for runner ${repo} to be ready`);
  }

  /**
   * Start health monitoring for all runners
   */
  async startHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    console.log(`🏥 Starting health monitoring (interval: ${this.config.healthCheckInterval}ms)`);
    
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);

    // Perform initial health check
    await this.performHealthChecks();
  }

  /**
   * Perform health checks on all runners
   */
  async performHealthChecks() {
    console.log('🔍 Performing health checks on all runners...');
    
    for (const repo of this.config.repositories) {
      try {
        await this.checkAndRecoverRunner(repo);
      } catch (error) {
        console.error(`❌ Health check failed for ${repo}:`, error.message);
      }
    }
  }

  /**
   * Check and recover a specific runner if needed
   */
  async checkAndRecoverRunner(repo) {
    const container = await this.getRunnerContainer(repo);
    const status = this.runnerStatus.get(repo) || { recoveryAttempts: 0 };
    
    if (!container) {
      console.log(`⚠️ No container found for ${repo}, creating...`);
      await this.createRunner(repo);
      return;
    }

    const isHealthy = await this.checkRunnerHealth(repo, container);
    
    if (!isHealthy) {
      console.log(`🏥 Runner ${repo} is unhealthy, attempting recovery...`);
      
      if (status.recoveryAttempts < this.config.recoveryAttempts) {
        try {
          await this.recoverRunner(repo, container);
          status.recoveryAttempts = 0; // Reset on successful recovery
        } catch (error) {
          status.recoveryAttempts++;
          console.error(`❌ Recovery attempt ${status.recoveryAttempts} failed for ${repo}:`, error.message);
          
          if (status.recoveryAttempts >= this.config.recoveryAttempts) {
            console.log(`🆘 Maximum recovery attempts reached for ${repo}, recreating...`);
            await this.recreateRunner(repo, container);
            status.recoveryAttempts = 0;
          }
        }
      }
    } else {
      status.recoveryAttempts = 0; // Reset recovery attempts for healthy runners
    }
    
    this.runnerStatus.set(repo, status);
  }

  /**
   * Attempt to recover a runner
   */
  async recoverRunner(repo, container) {
    console.log(`🔧 Attempting to recover runner ${repo}...`);
    
    try {
      // Try restarting the container first
      await container.restart({ t: 10 });
      
      // Wait for recovery
      await this.sleep(this.config.recoveryDelay);
      
      // Check if recovery was successful
      const isHealthy = await this.checkRunnerHealth(repo, container);
      
      if (isHealthy) {
        console.log(`✅ Successfully recovered runner ${repo}`);
        this.updateRunnerStatus(repo, 'recovered', container);
        this.emit('runner:recovered', { repo });
      } else {
        throw new Error('Runner still unhealthy after restart');
      }
      
    } catch (error) {
      console.error(`❌ Recovery failed for ${repo}:`, error.message);
      throw error;
    }
  }

  /**
   * Update runner status tracking
   */
  updateRunnerStatus(repo, status, container = null, error = null) {
    const currentStatus = this.runnerStatus.get(repo) || {};
    
    this.runnerStatus.set(repo, {
      ...currentStatus,
      status,
      container,
      lastCheck: new Date(),
      error: error || null
    });
    
    this.emit('runner:status_updated', { repo, status, error });
  }

  /**
   * Handle token generation events
   */
  async handleTokenGenerated(data) {
    console.log(`🔑 New token generated for ${data.repo}, checking if runner needs token refresh...`);
    
    // Check if we need to recreate runner with new token
    const container = await this.getRunnerContainer(data.repo);
    if (container) {
      const info = await container.inspect();
      const tokenExpiry = info.Config.Labels['runnerhub.token_expires'];
      
      if (tokenExpiry) {
        const expiryTime = new Date(tokenExpiry).getTime();
        const now = Date.now();
        
        // If current token expires soon, recreate runner with new token
        if (expiryTime - now < 10 * 60 * 1000) { // Less than 10 minutes
          console.log(`🔄 Recreating runner ${data.repo} with fresh token...`);
          await this.recreateRunner(data.repo, container);
        }
      }
    }
  }

  /**
   * Handle token generation failures
   */
  async handleTokenGenerationFailed(data) {
    console.error(`❌ Token generation failed for ${data.repo}, marking runner as degraded`);
    this.updateRunnerStatus(data.repo, 'token_error', null, data.error);
  }

  /**
   * Get status of all runners
   */
  getRunnerStatus() {
    const status = [];
    
    for (const repo of this.config.repositories) {
      const runnerStatus = this.runnerStatus.get(repo);
      const tokenStatus = this.tokenManager.getTokenStatus().find(t => t.repository === repo);
      
      status.push({
        repository: repo,
        status: runnerStatus?.status || 'unknown',
        lastCheck: runnerStatus?.lastCheck || null,
        recoveryAttempts: runnerStatus?.recoveryAttempts || 0,
        error: runnerStatus?.error || null,
        hasValidToken: tokenStatus?.hasToken && !tokenStatus?.isExpired,
        tokenExpiresAt: tokenStatus?.expiresAt || null
      });
    }
    
    return status;
  }

  /**
   * Get health summary
   */
  getHealth() {
    const runnerStatus = this.getRunnerStatus();
    const tokenHealth = this.tokenManager.getHealth();
    
    const healthyRunners = runnerStatus.filter(r => r.status === 'healthy').length;
    const totalRunners = runnerStatus.length;
    
    return {
      isRunning: this.isRunning,
      runners: {
        total: totalRunners,
        healthy: healthyRunners,
        unhealthy: totalRunners - healthyRunners,
        status: runnerStatus
      },
      tokens: tokenHealth,
      overallHealth: healthyRunners === totalRunners && tokenHealth.healthStatus === 'healthy' ? 'healthy' : 'degraded'
    };
  }

  /**
   * Stop the runner manager
   */
  async stop() {
    console.log('🛑 Stopping Enhanced Runner Manager...');
    
    this.isRunning = false;
    
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    // Stop token manager
    await this.tokenManager.stop();
    
    console.log('✅ Enhanced Runner Manager stopped');
  }

  /**
   * Utility function for delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RunnerManager;