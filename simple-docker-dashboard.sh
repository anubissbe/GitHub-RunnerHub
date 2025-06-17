#!/bin/bash

echo "🚀 Creating Simple Docker Dashboard..."

cat > /tmp/simple-dashboard.sh << 'DASHBOARD'
#!/bin/bash

echo "📦 Installing Simple Docker Dashboard on 192.168.1.16..."

mkdir -p ~/GitHub-RunnerHub/dashboard
cd ~/GitHub-RunnerHub/dashboard

# Create a simple Python server
cat > dashboard.py << 'PYTHON'
#!/usr/bin/env python3
import subprocess
import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

class DashboardHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(self.get_html().encode())
        elif self.path == '/api/runners':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            runners = self.get_runners()
            self.wfile.write(json.dumps(runners).encode())
        else:
            self.send_error(404)
    
    def log_message(self, format, *args):
        return  # Suppress logs
    
    def get_runners(self):
        try:
            result = subprocess.run(['docker', 'ps', '--format', '{{.Names}}|{{.Status}}'], 
                                  capture_output=True, text=True)
            runners = []
            for line in result.stdout.strip().split('\n'):
                if 'runnerhub' in line and 'backend' not in line and 'frontend' not in line:
                    parts = line.split('|')
                    if len(parts) >= 2:
                        runners.append({
                            'name': parts[0],
                            'status': parts[1],
                            'type': 'auto-scaled' if 'auto' in parts[0] else 'manual'
                        })
            return runners
        except:
            return []
    
    def get_html(self):
        return '''<!DOCTYPE html>
<html>
<head>
    <title>GitHub RunnerHub - Docker Monitor</title>
    <style>
        body { background: #0a0a0a; color: #fff; font-family: Arial; margin: 0; padding: 20px; }
        h1 { color: #ff6500; }
        .metrics { display: flex; gap: 20px; margin: 20px 0; }
        .metric { background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid #333; min-width: 150px; text-align: center; }
        .metric h2 { margin: 0; font-size: 36px; color: #ff6500; }
        .metric p { margin: 5px 0 0 0; color: #888; }
        .runners { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; margin-top: 30px; }
        .runner { background: #1a1a1a; padding: 15px; border-radius: 8px; border: 2px solid #333; }
        .runner.running { border-color: #00ff00; }
        .runner-name { font-weight: bold; color: #ff6500; margin-bottom: 5px; }
        .runner-status { color: #888; font-size: 14px; }
        .auto-scaled { background: #1f1300; }
        .refresh { position: fixed; top: 20px; right: 20px; color: #666; }
    </style>
</head>
<body>
    <h1>🏃 GitHub RunnerHub - Docker Monitor</h1>
    <div class="refresh">Auto-refresh: 3s</div>
    
    <div class="metrics">
        <div class="metric">
            <h2 id="total">-</h2>
            <p>Total Runners</p>
        </div>
        <div class="metric">
            <h2 id="running">-</h2>
            <p>Running</p>
        </div>
        <div class="metric">
            <h2 id="autoscaled">-</h2>
            <p>Auto-Scaled</p>
        </div>
    </div>
    
    <div id="runners" class="runners">Loading...</div>
    
    <script>
        function updateDashboard() {
            fetch('/api/runners')
                .then(r => r.json())
                .then(runners => {
                    // Update metrics
                    document.getElementById('total').textContent = runners.length;
                    document.getElementById('running').textContent = runners.filter(r => r.status.includes('Up')).length;
                    document.getElementById('autoscaled').textContent = runners.filter(r => r.type === 'auto-scaled').length;
                    
                    // Update runner list
                    const container = document.getElementById('runners');
                    if (runners.length === 0) {
                        container.innerHTML = '<p style="text-align:center; color:#666;">No runners detected</p>';
                    } else {
                        container.innerHTML = runners.map(r => `
                            <div class="runner ${r.status.includes('Up') ? 'running' : ''} ${r.type === 'auto-scaled' ? 'auto-scaled' : ''}">
                                <div class="runner-name">${r.name}</div>
                                <div class="runner-status">${r.status}</div>
                            </div>
                        `).join('');
                    }
                })
                .catch(err => {
                    document.getElementById('runners').innerHTML = '<p style="color:red;">Error loading runners</p>';
                });
        }
        
        // Update immediately and then every 3 seconds
        updateDashboard();
        setInterval(updateDashboard, 3000);
    </script>
</body>
</html>'''

def run_server():
    server = HTTPServer(('0.0.0.0', 8302), DashboardHandler)
    print('Docker Dashboard running on http://192.168.1.16:8302')
    server.serve_forever()

if __name__ == '__main__':
    run_server()
PYTHON

chmod +x dashboard.py

# Run in background
nohup python3 dashboard.py > dashboard.log 2>&1 &
echo $! > dashboard.pid

echo ""
echo "✅ Simple Docker Dashboard Running!"
echo ""
echo "📱 Access at: http://192.168.1.16:8302"
echo ""
echo "📊 Features:"
echo "   - Shows all 'runnerhub-*' Docker containers"
echo "   - Updates every 3 seconds"
echo "   - No dependencies needed (uses Python3)"
echo "   - Reads directly from Docker"
echo ""
echo "🚀 Watch runners appear as they spawn!"
DASHBOARD

# Deploy to 192.168.1.16
scp -i ~/.ssh/git-runner_rsa /tmp/simple-dashboard.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/simple-dashboard.sh && bash /tmp/simple-dashboard.sh"