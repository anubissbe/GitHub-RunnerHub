const { Octokit } = require('@octokit/rest');
const { Pool } = require('pg');
const VaultClient = require('./vault-client');

class GitHubAPIService {
    constructor(options = {}) {
        this.vault = new VaultClient(options.vault);
        this.githubToken = null;
        this.organization = null;
        this.octokit = null;
        this.initialized = false;
        
        // Rate limiting
        this.rateLimit = {
            remaining: 5000,
            reset: new Date(),
            limit: 5000
        };
        
        // Request queue for rate limiting
        this.requestQueue = [];
        this.processing = false;
        
        // Database connection
        this.db = new Pool({
            connectionString: 'postgresql://app_user:app_secure_2024@192.168.1.24:5433/github_runnerhub',
            ssl: false
        });

        // Initialize GitHub credentials from Vault
        this.initializeFromVault();
    }

    /**
     * Initialize GitHub credentials from Vault
     */
    async initializeFromVault() {
        try {
            console.log('🔐 Initializing GitHub credentials from Vault...');
            
            // Test Vault connectivity first
            const vaultConnected = await this.vault.testConnection();
            if (!vaultConnected) {
                console.warn('⚠️ Vault not accessible, checking environment variables...');
                this.fallbackToEnvironment();
                return;
            }

            // Get GitHub secrets from Vault
            const githubSecrets = await this.vault.getGitHubSecrets();
            
            if (githubSecrets && githubSecrets.token) {
                this.githubToken = githubSecrets.token;
                this.organization = githubSecrets.org || process.env.GITHUB_ORG || 'anubissbe';
                
                // Initialize Octokit with Vault token
                this.octokit = new Octokit({
                    auth: this.githubToken,
                    userAgent: 'RunnerHub/1.0.0',
                    retry: {
                        doNotRetry: [400, 401, 403, 422]
                    }
                });

                this.initialized = true;
                console.log(`✅ GitHub API Service initialized from Vault for organization: ${this.organization}`);
                
                // Test the token
                await this.testGitHubConnection();
            } else {
                console.warn('⚠️ No GitHub token found in Vault, checking environment variables...');
                this.fallbackToEnvironment();
            }
        } catch (error) {
            console.error('❌ Failed to initialize from Vault:', error.message);
            this.fallbackToEnvironment();
        }
    }

    /**
     * Fallback to environment variables if Vault fails
     */
    fallbackToEnvironment() {
        const envToken = process.env.GITHUB_TOKEN;
        if (envToken) {
            console.log('🔄 Using GitHub token from environment variables');
            this.githubToken = envToken;
            this.organization = process.env.GITHUB_ORG || 'anubissbe';
            
            this.octokit = new Octokit({
                auth: this.githubToken,
                userAgent: 'RunnerHub/1.0.0',
                retry: {
                    doNotRetry: [400, 401, 403, 422]
                }
            });
            
            this.initialized = true;
            console.log(`✅ GitHub API Service initialized from environment for organization: ${this.organization}`);
        } else {
            console.warn('⚠️ No GitHub token found in Vault or environment variables');
            console.log('🔧 GitHub integration disabled - running with sample data only');
        }
    }

    /**
     * Test GitHub API connection
     */
    async testGitHubConnection() {
        if (!this.octokit) return false;
        
        try {
            const { data } = await this.octokit.rest.users.getAuthenticated();
            console.log(`✅ GitHub API connection successful - authenticated as: ${data.login}`);
            
            // Test organization access
            try {
                await this.octokit.rest.orgs.get({ org: this.organization });
                console.log(`✅ Organization access confirmed: ${this.organization}`);
            } catch (orgError) {
                console.warn(`⚠️ Organization access issue for ${this.organization}:`, orgError.message);
            }
            
            return true;
        } catch (error) {
            console.error('❌ GitHub API connection test failed:', error.message);
            return false;
        }
    }

    /**
     * Check if GitHub integration is enabled
     */
    isEnabled() {
        return this.initialized && this.githubToken && this.octokit;
    }

    /**
     * Smart rate limiting - queue requests when approaching limit
     */
    async makeRequest(requestFunction, priority = 'normal') {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                function: requestFunction,
                priority,
                resolve,
                reject,
                timestamp: Date.now()
            });

            if (!this.processing) {
                this.processQueue();
            }
        });
    }

    /**
     * Process request queue with rate limiting
     */
    async processQueue() {
        if (this.processing || this.requestQueue.length === 0) return;
        
        this.processing = true;

        while (this.requestQueue.length > 0) {
            // Check rate limit
            if (this.rateLimit.remaining <= 10 && Date.now() < this.rateLimit.reset.getTime()) {
                const waitTime = this.rateLimit.reset.getTime() - Date.now();
                console.log(`⏱️ Rate limit near exhaustion, waiting ${waitTime}ms`);
                await this.sleep(waitTime);
            }

            // Sort by priority (high priority first)
            this.requestQueue.sort((a, b) => {
                const priorityOrder = { high: 3, normal: 2, low: 1 };
                return priorityOrder[b.priority] - priorityOrder[a.priority];
            });

            const request = this.requestQueue.shift();

            try {
                const result = await request.function();
                if (result && result.headers) {
                    this.updateRateLimit(result.headers);
                }
                request.resolve(result);
            } catch (error) {
                console.error('GitHub API request failed:', error.message);
                request.reject(error);
            }

            // Small delay between requests to be respectful
            await this.sleep(100);
        }

        this.processing = false;
    }

    /**
     * Update rate limit info from response headers
     */
    updateRateLimit(headers) {
        if (headers['x-ratelimit-remaining']) {
            this.rateLimit.remaining = parseInt(headers['x-ratelimit-remaining']);
            this.rateLimit.limit = parseInt(headers['x-ratelimit-limit']);
            this.rateLimit.reset = new Date(parseInt(headers['x-ratelimit-reset']) * 1000);
        }
    }

    /**
     * Get all self-hosted runners for the organization or repository
     */
    async getRunners() {
        if (!this.isEnabled()) {
            throw new Error('GitHub integration not enabled');
        }
        
        console.log('📡 Fetching GitHub runners...');
        
        return this.makeRequest(async () => {
            // First try organization (if it's actually an org)
            try {
                const response = await this.octokit.rest.actions.listSelfHostedRunnersForOrg({
                    org: this.organization,
                    per_page: 100
                });
                
                console.log(`✅ Found ${response.data.runners.length} GitHub org runners`);
                return response;
            } catch (error) {
                // If org fails, try repository-level runners (for personal accounts)
                console.log('⚠️ No organization runners available, checking repository runners...');
                return await this.getRepositoryRunners();
            }
        }, 'high');
    }

    /**
     * Get repository-level self-hosted runners (for personal accounts)
     */
    async getRepositoryRunners() {
        const allRunners = [];
        
        try {
            // Get runners for the main repository
            const response = await this.octokit.rest.actions.listSelfHostedRunnersForRepo({
                owner: this.organization,
                repo: 'GitHub-RunnerHub',
                per_page: 100
            });
            
            console.log(`✅ Found ${response.data.runners.length} repository runners for GitHub-RunnerHub`);
            allRunners.push(...response.data.runners);
            
        } catch (error) {
            console.warn(`⚠️ Failed to get repository runners: ${error.message}`);
        }
        
        return { data: { runners: allRunners } };
    }

    /**
     * Get workflow runs for the organization (last 24 hours)
     */
    async getRecentWorkflowRuns(repositories = []) {
        if (!this.isEnabled()) {
            throw new Error('GitHub integration not enabled');
        }
        
        console.log('📡 Fetching recent workflow runs...');
        
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const allRuns = [];

        // If no repositories specified, get all user repos (handles both orgs and personal accounts)
        if (repositories.length === 0) {
            try {
                // Try user repos first (works for personal accounts)
                const reposResponse = await this.makeRequest(async () => {
                    return await this.octokit.rest.repos.listForUser({
                        username: this.organization,
                        type: 'all',
                        per_page: 100
                    });
                }, 'normal');
                
                repositories = reposResponse.data.map(repo => repo.name);
                console.log(`✅ Found ${repositories.length} repositories for user ${this.organization}`);
            } catch (error) {
                console.warn('⚠️ Failed to get user repositories, trying authenticated user repos');
                
                // Fallback to authenticated user's repos
                const reposResponse = await this.makeRequest(async () => {
                    return await this.octokit.rest.repos.listForAuthenticatedUser({
                        type: 'all',
                        per_page: 100
                    });
                }, 'normal');
                
                repositories = reposResponse.data.map(repo => repo.name);
                console.log(`✅ Found ${repositories.length} repositories for authenticated user`);
            }
        }

        // Get workflow runs for each repository
        for (const repo of repositories.slice(0, 10)) { // Limit to 10 repos to avoid rate limits
            try {
                const runsResponse = await this.makeRequest(async () => {
                    return await this.octokit.rest.actions.listWorkflowRunsForRepo({
                        owner: this.organization,
                        repo,
                        created: `>=${since}`,
                        per_page: 50
                    });
                }, 'normal');

                allRuns.push(...runsResponse.data.workflow_runs.map(run => ({
                    ...run,
                    repository: `${this.organization}/${repo}`
                })));
            } catch (error) {
                console.error(`Failed to fetch runs for ${repo}:`, error.message);
            }
        }

        console.log(`✅ Found ${allRuns.length} workflow runs in last 24h`);
        return { data: { workflow_runs: allRuns } };
    }

    /**
     * Get workflow jobs for specific runs
     */
    async getWorkflowJobs(owner, repo, runId) {
        return this.makeRequest(async () => {
            return await this.octokit.rest.actions.listJobsForWorkflowRun({
                owner,
                repo,
                run_id: runId
            });
        }, 'low');
    }

    /**
     * Sync GitHub runners to database
     */
    async syncRunners() {
        if (!this.isEnabled()) {
            console.log('⚠️ GitHub integration disabled, skipping runner sync');
            return 0;
        }
        
        try {
            console.log('🔄 Syncing GitHub runners to database...');
            
            const runnersResponse = await this.getRunners();
            const githubRunners = runnersResponse.data.runners;

            // Clear existing runners
            await this.db.query('DELETE FROM runnerhub.runners WHERE name LIKE $1', ['github-%']);

            // Insert GitHub runners
            for (const runner of githubRunners) {
                const status = runner.status === 'online' ? 'idle' : 'offline';
                const healthStatus = runner.status === 'online' ? 'healthy' : 'offline';

                await this.db.query(`
                    INSERT INTO runnerhub.runners (
                        id, name, type, status, last_heartbeat, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        status = $4,
                        last_heartbeat = $5,
                        updated_at = NOW()
                `, [
                    `github-${runner.id}`,
                    `github-${runner.name}`,
                    'github-hosted',
                    status,
                    runner.status === 'online' ? new Date() : new Date(Date.now() - 10 * 60 * 1000) // 10 min ago if offline
                ]);
            }

            console.log(`✅ Synced ${githubRunners.length} GitHub runners to database`);
            return githubRunners.length;
        } catch (error) {
            console.error('❌ Failed to sync runners:', error.message);
            throw error;
        }
    }

    /**
     * Sync workflow runs and jobs to database
     */
    async syncWorkflowData() {
        if (!this.isEnabled()) {
            console.log('⚠️ GitHub integration disabled, skipping workflow sync');
            return 0;
        }
        
        try {
            console.log('🔄 Syncing GitHub workflow data to database...');
            
            const runsResponse = await this.getRecentWorkflowRuns();
            const workflowRuns = runsResponse.data.workflow_runs;

            let syncedJobs = 0;

            for (const run of workflowRuns.slice(0, 20)) { // Limit to avoid rate limits
                try {
                    // Extract repo name from repository
                    const [owner, repo] = run.repository.split('/');
                    
                    // Get jobs for this workflow run
                    const jobsResponse = await this.getWorkflowJobs(owner, repo, run.id);
                    const jobs = jobsResponse.data.jobs;

                    for (const job of jobs) {
                        const status = this.mapGitHubStatus(job.status, job.conclusion);
                        
                        await this.db.query(`
                            INSERT INTO runnerhub.jobs (
                                id, job_id, run_id, repository, workflow, status,
                                runner_name, started_at, completed_at, created_at, updated_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                            ON CONFLICT (id) DO UPDATE SET
                                status = $6,
                                completed_at = $9,
                                updated_at = $11
                        `, [
                            `github-${job.id}`,
                            `${job.id}`,
                            `${run.id}`,
                            run.repository,
                            job.name || run.name,
                            status,
                            job.runner_name || null,
                            job.started_at ? new Date(job.started_at) : null,
                            job.completed_at ? new Date(job.completed_at) : null,
                            new Date(job.created_at),
                            new Date()
                        ]);

                        syncedJobs++;
                    }
                } catch (error) {
                    console.error(`Failed to sync jobs for run ${run.id}:`, error.message);
                }
            }

            console.log(`✅ Synced ${syncedJobs} GitHub jobs to database`);
            return syncedJobs;
        } catch (error) {
            console.error('❌ Failed to sync workflow data:', error.message);
            throw error;
        }
    }

    /**
     * Map GitHub job status to our internal status
     */
    mapGitHubStatus(status, conclusion) {
        if (status === 'completed') {
            switch (conclusion) {
                case 'success': return 'completed';
                case 'failure':
                case 'cancelled':
                case 'timed_out': return 'failed';
                default: return 'completed';
            }
        }
        
        switch (status) {
            case 'queued': return 'pending';
            case 'in_progress': return 'running';
            default: return 'pending';
        }
    }

    /**
     * Get rate limit status
     */
    getRateLimitStatus() {
        return {
            remaining: this.rateLimit.remaining,
            limit: this.rateLimit.limit,
            reset: this.rateLimit.reset,
            resetIn: Math.max(0, this.rateLimit.reset.getTime() - Date.now()),
            queueLength: this.requestQueue.length
        };
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Start periodic sync (every 1 minute for real-time updates)
     */
    startPeriodicSync() {
        console.log('🕐 Starting periodic GitHub sync (every 1 minute for real-time updates)');
        
        // Initial sync
        this.performSync();

        // Set up interval - 1 minute for real-time runner status
        // This uses only 3.6% of GitHub's rate limit (180 calls/hour vs 5000 limit)
        this.syncInterval = setInterval(() => {
            this.performSync();
        }, 1 * 60 * 1000); // 1 minute
    }

    /**
     * Perform a complete sync
     */
    async performSync() {
        try {
            console.log('🔄 Starting GitHub data sync...');
            const start = Date.now();

            const [runnerCount, jobCount] = await Promise.all([
                this.syncRunners(),
                this.syncWorkflowData()
            ]);

            const duration = Date.now() - start;
            console.log(`✅ GitHub sync completed in ${duration}ms: ${runnerCount} runners, ${jobCount} jobs`);
            
            const rateLimitStatus = this.getRateLimitStatus();
            console.log(`📊 Rate limit: ${rateLimitStatus.remaining}/${rateLimitStatus.limit} remaining`);

        } catch (error) {
            console.error('❌ GitHub sync failed:', error.message);
        }
    }

    /**
     * Stop periodic sync
     */
    stopPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('⏹️ Stopped periodic GitHub sync');
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.stopPeriodicSync();
        await this.db.end();
        console.log('🧹 GitHub API Service cleaned up');
    }
}

module.exports = GitHubAPIService;