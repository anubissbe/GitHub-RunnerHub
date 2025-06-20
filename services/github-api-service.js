const { Octokit } = require('@octokit/rest');
const { Pool } = require('pg');

class GitHubAPIService {
    constructor(options = {}) {
        this.octokit = new Octokit({
            auth: options.token || process.env.GITHUB_TOKEN,
            userAgent: 'RunnerHub/1.0.0',
            retry: {
                doNotRetry: [400, 401, 403, 422] // Don't retry client errors
            }
        });

        this.organization = options.organization || process.env.GITHUB_ORG;
        
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

        console.log(`✅ GitHub API Service initialized for organization: ${this.organization}`);
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
                this.updateRateLimit(result.headers);
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
     * Get all self-hosted runners for the organization
     */
    async getRunners() {
        console.log('📡 Fetching GitHub runners...');
        
        return this.makeRequest(async () => {
            const response = await this.octokit.rest.actions.listSelfHostedRunnersForOrg({
                org: this.organization,
                per_page: 100
            });
            
            console.log(`✅ Found ${response.data.runners.length} GitHub runners`);
            return response;
        }, 'high');
    }

    /**
     * Get workflow runs for the organization (last 24 hours)
     */
    async getRecentWorkflowRuns(repositories = []) {
        console.log('📡 Fetching recent workflow runs...');
        
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const allRuns = [];

        // If no repositories specified, get all org repos
        if (repositories.length === 0) {
            const reposResponse = await this.makeRequest(async () => {
                return await this.octokit.rest.repos.listForOrg({
                    org: this.organization,
                    type: 'all',
                    per_page: 100
                });
            }, 'normal');
            
            repositories = reposResponse.data.map(repo => repo.name);
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
     * Start periodic sync (every 5 minutes)
     */
    startPeriodicSync() {
        console.log('🕐 Starting periodic GitHub sync (every 5 minutes)');
        
        // Initial sync
        this.performSync();

        // Set up interval
        this.syncInterval = setInterval(() => {
            this.performSync();
        }, 5 * 60 * 1000); // 5 minutes
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