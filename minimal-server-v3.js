const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Dashboard API endpoint
app.get("/api/monitoring/dashboard", (req, res) => {
    const now = new Date();
    res.json({
        success: true,
        data: {
            system: {
                timestamp: now.toISOString(),
                jobs: {
                    total: 150,
                    pending: 2,
                    running: 1,
                    completed: 142,
                    failed: 5,
                    averageWaitTime: 12.5,
                    averageExecutionTime: 45.2
                },
                runners: {
                    total: 5,
                    proxy: 2,
                    ephemeral: 3,
                    idle: 2,
                    busy: 1,
                    offline: 2
                },
                pools: {
                    total: 2,
                    averageUtilization: 0.65,
                    scalingEvents: 12
                },
                system: {
                    cpuUsage: 15.5,
                    memoryUsage: 512.8,
                    diskUsage: 0,
                    uptime: process.uptime()
                }
            },
            recentJobs: [
                {
                    id: "job-1",
                    jobId: "job-1",
                    runId: "run-1",
                    repository: "anubissbe/test-repo",
                    workflow: "CI Pipeline",
                    status: "completed",
                    runnerName: "runner-1",
                    startedAt: new Date(Date.now() - 300000).toISOString(),
                    completedAt: new Date(Date.now() - 240000).toISOString(),
                    createdAt: new Date(Date.now() - 360000).toISOString(),
                    updatedAt: new Date(Date.now() - 240000).toISOString()
                },
                {
                    id: "job-2",
                    jobId: "job-2",
                    runId: "run-2",
                    repository: "anubissbe/another-repo",
                    workflow: "Deploy",
                    status: "running",
                    runnerName: "runner-2",
                    startedAt: new Date(Date.now() - 120000).toISOString(),
                    createdAt: new Date(Date.now() - 180000).toISOString(),
                    updatedAt: new Date(Date.now() - 60000).toISOString()
                }
            ],
            timeline: Array.from({ length: 24 }, (_, i) => ({
                hour: new Date(Date.now() - (23 - i) * 3600000).toISOString(),
                total: Math.floor(Math.random() * 10) + 5,
                completed: Math.floor(Math.random() * 8) + 3,
                failed: Math.floor(Math.random() * 2),
                avg_duration: Math.random() * 60 + 20
            })),
            runnerHealth: [
                {
                    id: "runner-1",
                    name: "runnerhub-proxy-1",
                    type: "proxy",
                    status: "idle",
                    lastHeartbeat: new Date(Date.now() - 15000).toISOString(),
                    isHealthy: true,
                    healthStatus: "healthy"
                },
                {
                    id: "runner-2",
                    name: "runnerhub-ephemeral-1",
                    type: "ephemeral",
                    status: "busy",
                    repository: "anubissbe/test-repo",
                    lastHeartbeat: new Date(Date.now() - 30000).toISOString(),
                    isHealthy: true,
                    healthStatus: "healthy"
                },
                {
                    id: "runner-3",
                    name: "runnerhub-proxy-2",
                    type: "proxy",
                    status: "offline",
                    lastHeartbeat: new Date(Date.now() - 400000).toISOString(),
                    isHealthy: false,
                    healthStatus: "offline"
                }
            ],
            lastUpdated: now.toISOString()
        }
    });
});

// Dashboard HTML route
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Send initial metrics
    socket.emit('metrics:update', {
        system: {
            cpuUsage: 15.5,
            memoryUsage: 45.2,
            uptime: process.uptime()
        },
        runners: {
            total: 5,
            online: 3,
            idle: 2,
            busy: 1
        }
    });
    
    // Send periodic updates
    const metricsInterval = setInterval(() => {
        socket.emit('metrics:update', {
            system: {
                cpuUsage: 10 + Math.random() * 20,
                memoryUsage: 40 + Math.random() * 20,
                uptime: process.uptime()
            },
            runners: {
                total: 5,
                online: 3 + Math.floor(Math.random() * 2),
                idle: 1 + Math.floor(Math.random() * 2),
                busy: Math.floor(Math.random() * 3)
            }
        });
    }, 5000);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        clearInterval(metricsInterval);
    });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ GitHub RunnerHub minimal server running on port ${PORT}`);
    console.log(`📊 Dashboard available at http://localhost:${PORT}/dashboard`);
});