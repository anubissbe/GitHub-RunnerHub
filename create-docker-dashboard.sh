#!/bin/bash

echo "🚀 Creating Docker-based Dashboard for 192.168.1.16..."

cat > /tmp/docker-dashboard.sh << 'DASHBOARD'
#!/bin/bash

echo "📦 Installing Docker-based Dashboard..."

# Create directory
mkdir -p ~/GitHub-RunnerHub/dashboard
cd ~/GitHub-RunnerHub/dashboard

# Create a simple Node.js server that reads from Docker
cat > server.js << 'SERVER'
const express = require('express');
const { exec } = require('child_process');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('.'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Function to get Docker container info
function getDockerRunners(callback) {
    exec('docker ps --format "{{.Names}}|{{.Status}}|{{.State}}" | grep "runnerhub"', (error, stdout) => {
        const runners = [];
        if (!error && stdout) {
            const lines = stdout.trim().split('\n');
            lines.forEach(line => {
                const [name, status, state] = line.split('|');
                if (!name.includes('frontend') && !name.includes('backend')) {
                    runners.push({ name, status, state });
                }
            });
        }
        callback(runners);
    });
}

// Broadcast to all connected clients
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Update every 5 seconds
setInterval(() => {
    getDockerRunners(runners => {
        broadcast({ type: 'update', runners, timestamp: new Date() });
    });
}, 5000);

// WebSocket connection
wss.on('connection', ws => {
    console.log('Client connected');
    getDockerRunners(runners => {
        ws.send(JSON.stringify({ type: 'welcome', runners }));
    });
});

// API endpoint for runners
app.get('/api/runners', (req, res) => {
    getDockerRunners(runners => {
        res.json(runners);
    });
});

server.listen(8301, '0.0.0.0', () => {
    console.log('Docker Dashboard running on port 8301');
});
SERVER

# Create HTML dashboard
cat > index.html << 'HTML'
<!DOCTYPE html>
<html>
<head>
    <title>GitHub RunnerHub - Docker Dashboard</title>
    <style>
        body { 
            background: #0a0a0a; 
            color: #fff; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0; 
            padding: 20px;
        }
        .header {
            display: flex;
            align-items: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #ff6500;
            padding-bottom: 20px;
        }
        h1 { 
            color: #ff6500; 
            margin: 0;
            font-size: 2.5em;
        }
        .subtitle {
            color: #888;
            margin-left: 20px;
        }
        .metrics { 
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px; 
            margin-bottom: 30px;
        }
        .metric { 
            background: #1a1a1a; 
            padding: 20px; 
            border-radius: 12px; 
            border: 1px solid #333;
            text-align: center;
            transition: all 0.3s ease;
        }
        .metric:hover {
            border-color: #ff6500;
            transform: translateY(-2px);
        }
        .metric h2 { 
            margin: 0; 
            font-size: 48px; 
            color: #ff6500;
            font-weight: 700;
        }
        .metric p { 
            margin: 10px 0 0 0; 
            color: #888;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .runners { 
            display: grid; 
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); 
            gap: 20px;
        }
        .runner { 
            background: #1a1a1a; 
            padding: 20px; 
            border-radius: 12px; 
            border: 2px solid #333;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        .runner.active { 
            border-color: #00ff00;
            box-shadow: 0 0 20px rgba(0,255,0,0.2);
        }
        .runner::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: #ff6500;
            transform: scaleX(0);
            transition: transform 0.3s ease;
        }
        .runner.active::before {
            transform: scaleX(1);
            background: #00ff00;
        }
        .runner-name {
            font-weight: 600;
            font-size: 18px;
            margin-bottom: 10px;
            color: #fff;
        }
        .runner-status {
            color: #888;
            font-size: 14px;
        }
        .timestamp {
            position: fixed;
            bottom: 20px;
            right: 20px;
            color: #666;
            font-size: 12px;
        }
        .live-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: #00ff00;
            border-radius: 50%;
            margin-right: 5px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        .no-runners {
            text-align: center;
            padding: 60px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🏃 GitHub RunnerHub</h1>
        <span class="subtitle">Docker Container Monitor - 192.168.1.16</span>
    </div>
    
    <div class="metrics">
        <div class="metric">
            <h2 id="total">0</h2>
            <p>Total Runners</p>
        </div>
        <div class="metric">
            <h2 id="running">0</h2>
            <p>Running</p>
        </div>
        <div class="metric">
            <h2 id="spawned">0</h2>
            <p>Auto-Spawned</p>
        </div>
    </div>
    
    <div id="runners" class="runners"></div>
    
    <div class="timestamp">
        <span class="live-indicator"></span>
        <span id="timestamp">Connecting...</span>
    </div>
    
    <script>
        let totalSpawned = 0;
        let ws;
        
        function connect() {
            ws = new WebSocket('ws://192.168.1.16:8301');
            
            ws.onopen = () => {
                console.log('Connected to Docker monitor');
                document.getElementById('timestamp').textContent = 'Connected - Live updates every 5s';
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                updateDashboard(data.runners);
                
                if (data.timestamp) {
                    const time = new Date(data.timestamp).toLocaleTimeString();
                    document.getElementById('timestamp').textContent = `Last update: ${time}`;
                }
            };
            
            ws.onclose = () => {
                document.getElementById('timestamp').textContent = 'Disconnected - Reconnecting...';
                setTimeout(connect, 3000);
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        }
        
        function updateDashboard(runners) {
            // Update metrics
            document.getElementById('total').textContent = runners.length;
            document.getElementById('running').textContent = runners.filter(r => r.status.includes('Up')).length;
            
            // Count auto-spawned runners
            const autoSpawned = runners.filter(r => r.name.includes('auto')).length;
            document.getElementById('spawned').textContent = autoSpawned;
            
            // Update runner display
            const container = document.getElementById('runners');
            
            if (runners.length === 0) {
                container.innerHTML = '<div class="no-runners">No runners detected. They will appear here as they spawn!</div>';
                return;
            }
            
            container.innerHTML = runners.map(runner => `
                <div class="runner ${runner.status.includes('Up') ? 'active' : ''}">
                    <div class="runner-name">${runner.name}</div>
                    <div class="runner-status">${runner.status}</div>
                </div>
            `).join('');
        }
        
        // Also poll the API as backup
        setInterval(() => {
            fetch('/api/runners')
                .then(res => res.json())
                .then(runners => updateDashboard(runners))
                .catch(err => console.error('API error:', err));
        }, 5000);
        
        // Connect to WebSocket
        connect();
    </script>
</body>
</html>
HTML

# Create package.json
cat > package.json << 'PKG'
{
  "name": "docker-dashboard",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "cors": "^2.8.5"
  }
}
PKG

# Install and run
npm install
nohup node server.js > server.log 2>&1 &
echo $! > server.pid

echo ""
echo "✅ Docker Dashboard installed!"
echo "   URL: http://192.168.1.16:8301"
echo "   PID: $(cat server.pid)"
echo ""
echo "📊 This dashboard shows:"
echo "   - All Docker containers named 'runnerhub-*'"
echo "   - Live updates every 5 seconds"
echo "   - No API limits - reads directly from Docker!"
echo ""
echo "🚀 As new runners spawn, they'll appear immediately!"
DASHBOARD

# Deploy to 192.168.1.16
scp -i ~/.ssh/git-runner_rsa /tmp/docker-dashboard.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/docker-dashboard.sh && bash /tmp/docker-dashboard.sh"