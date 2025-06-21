#!/bin/bash

set -euo pipefail

# Load Test Executor Entrypoint Script

echo "🚀 Starting GitHub-RunnerHub Load Test Executor"
echo "Configuration:"
echo "  ORCHESTRATOR_URL: ${ORCHESTRATOR_URL:-http://orchestrator-loadtest:3000}"
echo "  CONCURRENCY: ${CONCURRENCY:-100}"
echo "  DURATION: ${DURATION:-300}"
echo "  THROUGHPUT_TARGET: ${THROUGHPUT_TARGET:-1000}"

# Wait for orchestrator to be ready
echo "⏳ Waiting for orchestrator to be ready..."
max_attempts=60
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if curl -f -s "${ORCHESTRATOR_URL:-http://orchestrator-loadtest:3000}/health" > /dev/null 2>&1; then
        echo "✅ Orchestrator is ready"
        break
    fi
    
    echo "Attempt $((attempt + 1))/$max_attempts - waiting for orchestrator..."
    sleep 5
    ((attempt++))
    
    if [ $attempt -eq $max_attempts ]; then
        echo "❌ Orchestrator failed to become ready within timeout"
        exit 1
    fi
done

# Start metrics server for Prometheus scraping
cat > /app/metrics-server.js << 'EOF'
const http = require('http');
const os = require('os');

let metrics = {
    load_test_active: 0,
    load_test_total_requests: 0,
    load_test_successful_requests: 0,
    load_test_failed_requests: 0,
    load_test_response_time_ms_total: 0,
    system_cpu_usage: 0,
    system_memory_usage: 0
};

// Update system metrics periodically
setInterval(() => {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    });
    
    metrics.system_cpu_usage = Math.round((1 - totalIdle / totalTick) * 100);
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    metrics.system_memory_usage = Math.round(((totalMem - freeMem) / totalMem) * 100);
}, 5000);

// Prometheus metrics endpoint
const server = http.createServer((req, res) => {
    if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        
        let output = '';
        for (const [key, value] of Object.entries(metrics)) {
            output += `${key} ${value}\n`;
        }
        
        res.end(output);
    } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(8080, () => {
    console.log('📊 Metrics server listening on port 8080');
});

// Export metrics for external updates
global.updateMetrics = (updates) => {
    Object.assign(metrics, updates);
};
EOF

# Start metrics server in background
node /app/metrics-server.js &
METRICS_PID=$!

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up..."
    kill $METRICS_PID 2>/dev/null || true
    exit 0
}

trap cleanup TERM INT

# Execute the command
echo "🏃 Executing load tests..."
exec "$@"