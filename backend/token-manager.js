const { Octokit } = require('@octokit/rest');
const EventEmitter = require('events');

/**
 * GitHub Token Manager for Runner Registration
 * Handles token lifecycle, rotation, and recovery
 */
class TokenManager extends EventEmitter {
  constructor(config) {
    super();
    
    this.config = {
      githubToken: config.GITHUB_TOKEN,
      githubOrg: config.GITHUB_ORG,
      repositories: config.REPOSITORIES || [], // Array of repository names
      tokenRefreshInterval: config.TOKEN_REFRESH_INTERVAL || 45 * 60 * 1000, // 45 minutes
      tokenExpiryTime: config.TOKEN_EXPIRY_TIME || 60 * 60 * 1000, // 1 hour
      maxRetries: config.MAX_RETRIES || 3,
      retryDelay: config.RETRY_DELAY || 5000 // 5 seconds
    };

    this.octokit = new Octokit({
      auth: this.config.githubToken
    });

    // Token storage: repo -> { token, expiresAt, createdAt }
    this.tokenStorage = new Map();
    
    // Track token refresh intervals
    this.refreshIntervals = new Map();
    
    // Repository configuration with last known good tokens
    this.repositoryConfig = new Map();
    
    this.isRunning = false;
  }

  /**
   * Initialize token manager with repository list
   */
  async initialize(repositories = null) {
    const repos = repositories || this.config.repositories;
    
    if (!repos || repos.length === 0) {
      console.warn('No repositories specified for token management');
      return;
    }

    console.log(`🔐 Initializing Token Manager for ${repos.length} repositories...`);
    
    // Initialize each repository
    for (const repo of repos) {
      try {
        await this.initializeRepository(repo);
      } catch (error) {
        console.error(`Failed to initialize repository ${repo}:`, error.message);
        this.emit('repository:init_failed', { repo, error: error.message });
      }
    }

    this.isRunning = true;
    console.log('✅ Token Manager initialized successfully');
  }

  /**
   * Initialize a single repository with fresh token
   */
  async initializeRepository(repo) {
    console.log(`🔑 Initializing tokens for repository: ${repo}`);
    
    try {
      const tokenData = await this.generateFreshToken(repo);
      
      if (tokenData) {
        this.repositoryConfig.set(repo, {
          name: repo,
          fullName: `${this.config.githubOrg}/${repo}`,
          initialized: true,
          lastTokenGeneration: Date.now()
        });

        // Start automatic refresh for this repository
        this.startTokenRefresh(repo);
        
        console.log(`✅ Repository ${repo} initialized with fresh token`);
        this.emit('repository:initialized', { repo, tokenData });
      }
    } catch (error) {
      console.error(`❌ Failed to initialize repository ${repo}:`, error.message);
      throw error;
    }
  }

  /**
   * Generate a fresh registration token for a repository
   */
  async generateFreshToken(repo, retryCount = 0) {
    try {
      console.log(`🔄 Generating fresh token for ${repo} (attempt ${retryCount + 1})`);
      
      const response = await this.octokit.rest.actions.createRegistrationTokenForRepo({
        owner: this.config.githubOrg,
        repo: repo
      });

      const tokenData = {
        token: response.data.token,
        expiresAt: new Date(response.data.expires_at),
        createdAt: new Date(),
        repo: repo
      };

      // Store the token
      this.tokenStorage.set(repo, tokenData);
      
      console.log(`✅ Fresh token generated for ${repo}, expires at ${tokenData.expiresAt.toISOString()}`);
      this.emit('token:generated', { repo, expiresAt: tokenData.expiresAt });
      
      return tokenData;
      
    } catch (error) {
      console.error(`❌ Failed to generate token for ${repo}:`, error.message);
      
      if (retryCount < this.config.maxRetries) {
        console.log(`🔄 Retrying token generation for ${repo} in ${this.config.retryDelay}ms...`);
        await this.sleep(this.config.retryDelay);
        return this.generateFreshToken(repo, retryCount + 1);
      }
      
      this.emit('token:generation_failed', { repo, error: error.message, retryCount });
      throw error;
    }
  }

  /**
   * Get current valid token for a repository
   */
  async getValidToken(repo) {
    const tokenData = this.tokenStorage.get(repo);
    
    if (!tokenData) {
      console.log(`🔑 No token found for ${repo}, generating fresh token...`);
      return this.generateFreshToken(repo);
    }

    const now = new Date();
    const timeUntilExpiry = tokenData.expiresAt.getTime() - now.getTime();
    
    // If token expires in less than 5 minutes, generate a new one
    if (timeUntilExpiry < 5 * 60 * 1000) {
      console.log(`⏰ Token for ${repo} expires soon (${Math.round(timeUntilExpiry / 1000)}s), generating fresh token...`);
      return this.generateFreshToken(repo);
    }

    console.log(`✅ Valid token found for ${repo}, expires in ${Math.round(timeUntilExpiry / 1000)}s`);
    return tokenData;
  }

  /**
   * Start automatic token refresh for a repository
   */
  startTokenRefresh(repo) {
    // Clear existing interval if any
    if (this.refreshIntervals.has(repo)) {
      clearInterval(this.refreshIntervals.get(repo));
    }

    // Set up refresh interval (every 45 minutes)
    const interval = setInterval(async () => {
      try {
        console.log(`🔄 Proactive token refresh for ${repo}...`);
        await this.generateFreshToken(repo);
      } catch (error) {
        console.error(`❌ Proactive token refresh failed for ${repo}:`, error.message);
        this.emit('token:refresh_failed', { repo, error: error.message });
      }
    }, this.config.tokenRefreshInterval);

    this.refreshIntervals.set(repo, interval);
    console.log(`⏰ Automatic token refresh started for ${repo} (every ${this.config.tokenRefreshInterval / 60000} minutes)`);
  }

  /**
   * Stop token refresh for a repository
   */
  stopTokenRefresh(repo) {
    if (this.refreshIntervals.has(repo)) {
      clearInterval(this.refreshIntervals.get(repo));
      this.refreshIntervals.delete(repo);
      console.log(`🛑 Stopped token refresh for ${repo}`);
    }
  }

  /**
   * Get all repository configurations
   */
  getRepositories() {
    return Array.from(this.repositoryConfig.values());
  }

  /**
   * Get token status for all repositories
   */
  getTokenStatus() {
    const status = [];
    
    for (const [repo, tokenData] of this.tokenStorage.entries()) {
      const now = new Date();
      const timeUntilExpiry = tokenData.expiresAt.getTime() - now.getTime();
      
      status.push({
        repository: repo,
        hasToken: true,
        expiresAt: tokenData.expiresAt,
        timeUntilExpiry: timeUntilExpiry,
        isExpired: timeUntilExpiry <= 0,
        needsRefresh: timeUntilExpiry < 5 * 60 * 1000 // Less than 5 minutes
      });
    }

    return status;
  }

  /**
   * Force refresh all tokens
   */
  async refreshAllTokens() {
    console.log('🔄 Force refreshing all tokens...');
    
    const repositories = Array.from(this.repositoryConfig.keys());
    const results = [];
    
    for (const repo of repositories) {
      try {
        const tokenData = await this.generateFreshToken(repo);
        results.push({ repo, success: true, tokenData });
      } catch (error) {
        results.push({ repo, success: false, error: error.message });
      }
    }

    this.emit('tokens:bulk_refresh', { results });
    return results;
  }

  /**
   * Cleanup and stop all token management
   */
  async stop() {
    console.log('🛑 Stopping Token Manager...');
    
    this.isRunning = false;
    
    // Clear all refresh intervals
    for (const [repo, interval] of this.refreshIntervals.entries()) {
      clearInterval(interval);
    }
    
    this.refreshIntervals.clear();
    console.log('✅ Token Manager stopped');
  }

  /**
   * Utility function for delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get health status of token manager
   */
  getHealth() {
    const tokenStatus = this.getTokenStatus();
    const expiredTokens = tokenStatus.filter(t => t.isExpired);
    const soonToExpire = tokenStatus.filter(t => t.needsRefresh && !t.isExpired);
    
    return {
      isRunning: this.isRunning,
      repositories: this.repositoryConfig.size,
      totalTokens: this.tokenStorage.size,
      expiredTokens: expiredTokens.length,
      soonToExpire: soonToExpire.length,
      healthStatus: expiredTokens.length === 0 ? 'healthy' : 'degraded',
      lastUpdate: new Date().toISOString()
    };
  }
}

module.exports = TokenManager;