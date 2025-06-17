#!/bin/bash

echo "🚀 Starting Auto-Scaler Service..."

cat > /tmp/start-autoscaler.sh << 'SCRIPT'
#!/bin/bash

echo "📦 Starting RunnerHub Auto-Scaler..."

# Create a simple auto-scaler that monitors and spawns runners
cat > ~/GitHub-RunnerHub/docker-autoscaler.sh << 'AUTOSCALER'
#!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"
MIN_FREE_RUNNERS=2
MAX_RUNNERS=15
CHECK_INTERVAL=10

echo "🤖 RunnerHub Auto-Scaler Started"
echo "   Min free runners: $MIN_FREE_RUNNERS"
echo "   Max total runners: $MAX_RUNNERS"
echo "   Check interval: ${CHECK_INTERVAL}s"
echo ""

spawn_runner() {
    RUNNER_ID=$(openssl rand -hex 3)
    RUNNER_NAME="runnerhub-auto-${RUNNER_ID}"
    
    echo "[$(date '+%H:%M:%S')] 🚀 Spawning new runner: $RUNNER_NAME"
    
    # Get token from GitHub
    TOKEN=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners/registration-token" | \
        python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)
    
    if [ -n "$TOKEN" ]; then
        docker run -d \
            --name "$RUNNER_NAME" \
            --restart unless-stopped \
            -e RUNNER_TOKEN="$TOKEN" \
            -e RUNNER_NAME="$RUNNER_NAME" \
            -e RUNNER_WORKDIR="/tmp/runner/work" \
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub,auto-scaled" \
            -e REPO_URL="https://github.com/$GITHUB_ORG/$REPO" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            myoung34/github-runner:latest > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            echo "   ✅ Successfully spawned $RUNNER_NAME"
        else
            echo "   ❌ Failed to spawn runner"
        fi
    else
        echo "   ❌ Failed to get registration token"
    fi
}

while true; do
    # Count runners
    TOTAL_RUNNERS=$(docker ps --format "{{.Names}}" | grep -c "^runnerhub-" | grep -v "backend\|frontend" || echo 0)
    BUSY_RUNNERS=$(docker ps --format "{{.Names}}|{{.Status}}" | grep "^runnerhub-" | grep -v "backend\|frontend" | grep -c "Up [0-9]* seconds\|Up [0-9]* minutes" || echo 0)
    FREE_RUNNERS=$((TOTAL_RUNNERS - BUSY_RUNNERS))
    
    # Get actual busy count from backend API
    ACTUAL_BUSY=$(curl -s http://localhost:8300/api/runners 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
busy = sum(1 for r in data if r.get('busy', False))
print(busy)
" 2>/dev/null || echo 0)
    
    if [ -n "$ACTUAL_BUSY" ] && [ "$ACTUAL_BUSY" -gt 0 ]; then
        BUSY_RUNNERS=$ACTUAL_BUSY
        FREE_RUNNERS=$((TOTAL_RUNNERS - BUSY_RUNNERS))
    fi
    
    UTILIZATION=0
    if [ $TOTAL_RUNNERS -gt 0 ]; then
        UTILIZATION=$((BUSY_RUNNERS * 100 / TOTAL_RUNNERS))
    fi
    
    echo "[$(date '+%H:%M:%S')] 📊 Status: Total=$TOTAL_RUNNERS, Busy=$BUSY_RUNNERS, Free=$FREE_RUNNERS, Utilization=$UTILIZATION%"
    
    # Auto-scaling logic
    if [ $TOTAL_RUNNERS -lt $MAX_RUNNERS ]; then
        if [ $FREE_RUNNERS -lt $MIN_FREE_RUNNERS ] || [ $UTILIZATION -gt 80 ]; then
            echo "   📈 Scaling up! (Free: $FREE_RUNNERS < $MIN_FREE_RUNNERS OR Utilization: $UTILIZATION% > 80%)"
            spawn_runner
        fi
    else
        echo "   ⚠️  At max capacity ($MAX_RUNNERS runners)"
    fi
    
    sleep $CHECK_INTERVAL
done
AUTOSCALER

chmod +x ~/GitHub-RunnerHub/docker-autoscaler.sh

# Kill any existing auto-scaler
pkill -f "docker-autoscaler.sh" 2>/dev/null
pkill -f "simple-autoscaler.sh" 2>/dev/null

# Start the auto-scaler
cd ~/GitHub-RunnerHub
nohup ./docker-autoscaler.sh > autoscaler.log 2>&1 &
echo $! > autoscaler.pid

echo ""
echo "✅ Auto-Scaler Started!"
echo "   PID: $(cat autoscaler.pid)"
echo "   Log: ~/GitHub-RunnerHub/autoscaler.log"
echo ""
echo "📊 Auto-scaling rules:"
echo "   - Maintains minimum 2 free runners"
echo "   - Scales up when utilization > 80%"
echo "   - Maximum 15 total runners"
echo "   - Checks every 10 seconds"
echo ""
echo "To monitor: tail -f ~/GitHub-RunnerHub/autoscaler.log"
SCRIPT

# Deploy and execute
scp -i ~/.ssh/git-runner_rsa /tmp/start-autoscaler.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/start-autoscaler.sh && bash /tmp/start-autoscaler.sh"