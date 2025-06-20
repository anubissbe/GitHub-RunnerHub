const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const GitHubAPIService = require('./services/github-api-service');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;

// PostgreSQL connection - force external database
const pool = new Pool({
    connectionString: 'postgresql://app_user:app_secure_2024@192.168.1.24:5433/github_runnerhub',
    ssl: false
});

// Initialize GitHub API service
const githubService = new GitHubAPIService();

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('✅ Connected to PostgreSQL at:', res.rows[0].now);
    }
});

// Initialize GitHub service and start sync when ready
async function initializeGitHubIntegration() {
    try {
        // Wait for GitHub service to initialize from Vault
        await new Promise(resolve => setTimeout(resolve, 2000)); // Give Vault time to initialize
        
        if (githubService.isEnabled()) {
            console.log('🚀 Starting GitHub API integration with Vault credentials...');
            githubService.startPeriodicSync();
        } else {
            console.log('⚠️ GitHub integration disabled - no token found in Vault or environment');
        }
    } catch (error) {
        console.error('❌ Failed to initialize GitHub integration:', error.message);
    }
}

// Start GitHub initialization
initializeGitHubIntegration();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const dbResult = await pool.query('SELECT 1');
        const rateLimitStatus = githubService.getRateLimitStatus();
        
        res.json({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            database: 'connected',
            github: {
                rateLimit: rateLimitStatus,
                integration: githubService.isEnabled() ? 'enabled' : 'disabled',
                source: githubService.githubToken ? (process.env.GITHUB_TOKEN ? 'environment' : 'vault') : 'none'
            }
        });
    } catch (error) {
        res.status(503).json({ 
            status: 'unhealthy', 
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: error.message
        });
    }
});

// GitHub API info endpoint
app.get('/api/github/status', async (req, res) => {
    try {
        const rateLimitStatus = githubService.getRateLimitStatus();
        
        // Get recent sync stats
        const syncStats = await pool.query(`
            SELECT 
                COUNT(*) as total_jobs,
                COUNT(CASE WHEN id LIKE 'github-%' THEN 1 END) as github_jobs,
                MAX(updated_at) as last_sync
            FROM runnerhub.jobs
        `);

        const runnerStats = await pool.query(`
            SELECT 
                COUNT(*) as total_runners,
                COUNT(CASE WHEN id LIKE 'github-%' THEN 1 END) as github_runners
            FROM runnerhub.runners
        `);

        res.json({
            success: true,
            data: {
                integration: githubService.isEnabled() ? 'enabled' : 'disabled',
                organization: githubService.organization || 'anubissbe',
                tokenSource: githubService.githubToken ? (process.env.GITHUB_TOKEN ? 'environment' : 'vault') : 'none',
                rateLimit: rateLimitStatus,
                sync: {
                    lastSync: syncStats.rows[0].last_sync,
                    totalJobs: parseInt(syncStats.rows[0].total_jobs),
                    githubJobs: parseInt(syncStats.rows[0].github_jobs),
                    totalRunners: parseInt(runnerStats.rows[0].total_runners),
                    githubRunners: parseInt(runnerStats.rows[0].github_runners)
                }
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Force GitHub sync endpoint
app.post('/api/github/sync', async (req, res) => {
    try {
        if (!process.env.GITHUB_TOKEN) {
            return res.status(400).json({
                success: false,
                error: 'GitHub token not configured'
            });
        }

        console.log('🔄 Manual GitHub sync triggered...');
        await githubService.performSync();

        res.json({
            success: true,
            message: 'GitHub sync completed'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Dashboard API endpoint with real/GitHub data
app.get("/api/monitoring/dashboard", async (req, res) => {
    try {
        // Get job statistics from last 24 hours
        const jobStatsQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                AVG(EXTRACT(EPOCH FROM (started_at - created_at))) as avg_wait_time,
                AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_execution_time,
                COUNT(CASE WHEN id LIKE 'github-%' THEN 1 END) as github_jobs
            FROM runnerhub.jobs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
        `;

        // Get runner statistics
        const runnerStatsQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN type = 'proxy' THEN 1 END) as proxy,
                COUNT(CASE WHEN type = 'ephemeral' THEN 1 END) as ephemeral,
                COUNT(CASE WHEN type = 'github-hosted' THEN 1 END) as github_hosted,
                COUNT(CASE WHEN status = 'idle' THEN 1 END) as idle,
                COUNT(CASE WHEN status = 'busy' THEN 1 END) as busy,
                COUNT(CASE WHEN status = 'offline' THEN 1 END) as offline,
                COUNT(CASE WHEN id LIKE 'github-%' THEN 1 END) as github_runners
            FROM runnerhub.runners
            WHERE last_heartbeat >= NOW() - INTERVAL '10 minutes'
        `;

        // Get recent jobs with GitHub indicators
        const recentJobsQuery = `
            SELECT 
                id, job_id, run_id, repository, workflow, 
                status, runner_name, started_at, completed_at, 
                created_at, updated_at,
                CASE WHEN id LIKE 'github-%' THEN true ELSE false END as is_github_job
            FROM runnerhub.jobs
            ORDER BY created_at DESC
            LIMIT 20
        `;

        // Get job timeline (hourly stats for last 24 hours)
        const timelineQuery = `
            WITH hours AS (
                SELECT generate_series(
                    date_trunc('hour', NOW() - INTERVAL '23 hours'),
                    date_trunc('hour', NOW()),
                    '1 hour'::interval
                ) as hour
            )
            SELECT 
                h.hour,
                COUNT(j.id) as total,
                COUNT(CASE WHEN j.status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN j.status = 'failed' THEN 1 END) as failed,
                COUNT(CASE WHEN j.id LIKE 'github-%' THEN 1 END) as github_jobs,
                AVG(EXTRACT(EPOCH FROM (j.completed_at - j.started_at))) as avg_duration
            FROM hours h
            LEFT JOIN runnerhub.jobs j ON 
                date_trunc('hour', j.created_at) = h.hour
            GROUP BY h.hour
            ORDER BY h.hour
        `;

        // Get runner health with GitHub integration status
        const runnerHealthQuery = `
            SELECT 
                id, name, type, status, repository, last_heartbeat,
                CASE 
                    WHEN last_heartbeat >= NOW() - INTERVAL '1 minute' THEN 'healthy'
                    WHEN last_heartbeat >= NOW() - INTERVAL '5 minutes' THEN 'warning'
                    WHEN last_heartbeat >= NOW() - INTERVAL '10 minutes' THEN 'critical'
                    ELSE 'offline'
                END as health_status,
                last_heartbeat >= NOW() - INTERVAL '5 minutes' as is_healthy,
                CASE WHEN id LIKE 'github-%' THEN true ELSE false END as is_github_runner
            FROM runnerhub.runners
            ORDER BY is_github_runner DESC, last_heartbeat DESC
            LIMIT 20
        `;

        // Execute all queries in parallel
        const [jobStats, runnerStats, recentJobs, timeline, runnerHealth] = await Promise.all([
            pool.query(jobStatsQuery),
            pool.query(runnerStatsQuery),
            pool.query(recentJobsQuery),
            pool.query(timelineQuery),
            pool.query(runnerHealthQuery)
        ]);

        // Get rate limit info
        const rateLimitStatus = githubService.getRateLimitStatus();

        const now = new Date();
        res.json({
            success: true,
            data: {
                system: {
                    timestamp: now.toISOString(),
                    jobs: {
                        total: parseInt(jobStats.rows[0]?.total || 0),
                        pending: parseInt(jobStats.rows[0]?.pending || 0),
                        running: parseInt(jobStats.rows[0]?.running || 0),
                        completed: parseInt(jobStats.rows[0]?.completed || 0),
                        failed: parseInt(jobStats.rows[0]?.failed || 0),
                        githubJobs: parseInt(jobStats.rows[0]?.github_jobs || 0),
                        averageWaitTime: parseFloat(jobStats.rows[0]?.avg_wait_time || 0),
                        averageExecutionTime: parseFloat(jobStats.rows[0]?.avg_execution_time || 0)
                    },
                    runners: {
                        total: parseInt(runnerStats.rows[0]?.total || 0),
                        proxy: parseInt(runnerStats.rows[0]?.proxy || 0),
                        ephemeral: parseInt(runnerStats.rows[0]?.ephemeral || 0),
                        githubHosted: parseInt(runnerStats.rows[0]?.github_hosted || 0),
                        idle: parseInt(runnerStats.rows[0]?.idle || 0),
                        busy: parseInt(runnerStats.rows[0]?.busy || 0),
                        offline: parseInt(runnerStats.rows[0]?.offline || 0),
                        githubRunners: parseInt(runnerStats.rows[0]?.github_runners || 0)
                    },
                    pools: {
                        total: 2,
                        averageUtilization: runnerStats.rows[0]?.total > 0 
                            ? (parseInt(runnerStats.rows[0]?.busy || 0) / parseInt(runnerStats.rows[0]?.total || 1))
                            : 0,
                        scalingEvents: 0
                    },
                    system: {
                        cpuUsage: process.cpuUsage().user / 1000000,
                        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
                        diskUsage: 0,
                        uptime: process.uptime()
                    },
                    github: {
                        integration: process.env.GITHUB_TOKEN ? 'enabled' : 'disabled',
                        rateLimit: rateLimitStatus
                    }
                },
                recentJobs: recentJobs.rows.map(job => ({
                    ...job,
                    startedAt: job.started_at?.toISOString(),
                    completedAt: job.completed_at?.toISOString(),
                    createdAt: job.created_at?.toISOString(),
                    updatedAt: job.updated_at?.toISOString(),
                    source: job.is_github_job ? 'github' : 'sample'
                })),
                timeline: timeline.rows.map(row => ({
                    hour: row.hour.toISOString(),
                    total: parseInt(row.total || 0),
                    completed: parseInt(row.completed || 0),
                    failed: parseInt(row.failed || 0),
                    githubJobs: parseInt(row.github_jobs || 0),
                    avg_duration: parseFloat(row.avg_duration || 0)
                })),
                runnerHealth: runnerHealth.rows.map(runner => ({
                    ...runner,
                    lastHeartbeat: runner.last_heartbeat?.toISOString(),
                    isHealthy: runner.is_healthy,
                    healthStatus: runner.health_status,
                    source: runner.is_github_runner ? 'github' : 'sample'
                })),
                lastUpdated: now.toISOString()
            }
        });
    } catch (error) {
        console.error('Dashboard data error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get real-time metrics for WebSocket with GitHub integration
async function getSystemMetrics() {
    try {
        const jobCountQuery = `
            SELECT 
                COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN id LIKE 'github-%' THEN 1 END) as github_jobs
            FROM runnerhub.jobs
            WHERE created_at >= NOW() - INTERVAL '1 hour'
        `;

        const runnerCountQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'idle' THEN 1 END) as idle,
                COUNT(CASE WHEN status = 'busy' THEN 1 END) as busy,
                COUNT(CASE WHEN status = 'offline' OR last_heartbeat < NOW() - INTERVAL '5 minutes' THEN 1 END) as offline,
                COUNT(CASE WHEN id LIKE 'github-%' THEN 1 END) as github_runners
            FROM runnerhub.runners
        `;

        const [jobCounts, runnerCounts] = await Promise.all([
            pool.query(jobCountQuery),
            pool.query(runnerCountQuery)
        ]);

        const rateLimitStatus = githubService.getRateLimitStatus();

        return {
            system: {
                cpuUsage: process.cpuUsage().user / 1000000,
                memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
                uptime: process.uptime()
            },
            jobs: {
                running: parseInt(jobCounts.rows[0]?.running || 0),
                pending: parseInt(jobCounts.rows[0]?.pending || 0),
                githubJobs: parseInt(jobCounts.rows[0]?.github_jobs || 0)
            },
            runners: {
                total: parseInt(runnerCounts.rows[0]?.total || 0),
                online: parseInt(runnerCounts.rows[0]?.total || 0) - parseInt(runnerCounts.rows[0]?.offline || 0),
                idle: parseInt(runnerCounts.rows[0]?.idle || 0),
                busy: parseInt(runnerCounts.rows[0]?.busy || 0),
                githubRunners: parseInt(runnerCounts.rows[0]?.github_runners || 0)
            },
            github: {
                integration: process.env.GITHUB_TOKEN ? 'enabled' : 'disabled',
                rateLimit: rateLimitStatus
            }
        };
    } catch (error) {
        console.error('Metrics query error:', error);
        return null;
    }
}

// Dashboard HTML route
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Send initial metrics
    getSystemMetrics().then(metrics => {
        if (metrics) {
            socket.emit('metrics:update', metrics);
        }
    });
    
    // Join monitoring room
    socket.on('join-monitoring', () => {
        socket.join('monitoring');
        console.log('Client joined monitoring room:', socket.id);
    });

    // Handle GitHub sync request
    socket.on('github:sync', async () => {
        if (process.env.GITHUB_TOKEN) {
            console.log('🔄 GitHub sync requested via WebSocket');
            try {
                await githubService.performSync();
                socket.emit('github:sync:complete', { success: true });
            } catch (error) {
                socket.emit('github:sync:complete', { success: false, error: error.message });
            }
        } else {
            socket.emit('github:sync:complete', { success: false, error: 'GitHub token not configured' });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Send periodic metrics updates to all connected clients
setInterval(async () => {
    const metrics = await getSystemMetrics();
    if (metrics) {
        io.to('monitoring').emit('metrics:update', metrics);
    }
}, 5000);

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing connections...');
    await githubService.cleanup();
    await pool.end();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ GitHub RunnerHub with real GitHub integration running on port ${PORT}`);
    console.log(`📊 Dashboard available at http://localhost:${PORT}/dashboard`);
    console.log(`🗄️  Connected to PostgreSQL at 192.168.1.24:5433`);
    console.log(`🐙 GitHub API integration: ${process.env.GITHUB_TOKEN ? 'ENABLED' : 'DISABLED (set GITHUB_TOKEN)'}`);
    
    if (process.env.GITHUB_TOKEN) {
        console.log(`📡 Monitoring organization: ${process.env.GITHUB_ORG || 'anubissbe'}`);
        console.log(`⚡ Real-time sync: Every 5 minutes`);
        console.log(`📈 Rate limit: Smart queuing enabled`);
    }
});