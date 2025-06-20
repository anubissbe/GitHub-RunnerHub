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
    res.json({
        success: true,
        data: {
            systemMetrics: {
                cpuUsage: 15.5,
                memoryUsage: 45.2,
                activeConnections: io.engine.clientsCount || 0,
                uptime: process.uptime()
            },
            runnerStats: {
                total: 5,
                online: 3,
                idle: 2,
                busy: 1
            },
            jobStats: {
                totalJobs: 150,
                successfulJobs: 145,
                failedJobs: 5,
                averageExecutionTime: 45.2
            },
            queueStats: {
                pending: 2,
                processing: 1,
                completed: 147,
                failed: 5
            }
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