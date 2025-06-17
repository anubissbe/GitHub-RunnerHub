#!/bin/bash

echo "🚀 Setting up Final Auto-Scaling System..."

cat > /tmp/final-autoscaler.sh << 'SCRIPT'
#!/bin/bash

cd ~/GitHub-RunnerHub

# Kill all existing scalers
echo "🧹 Cleaning up old processes..."
pkill -f "autoscaler" || true
pkill -f "scaler" || true

# Stop all dynamic runners but keep repo-specific ones
echo "🔄 Resetting runners..."
docker ps --format "{{.Names}}" | grep "^runnerhub-dynamic-" | while read runner; do
    docker stop $runner && docker rm $runner
done

# Create the production auto-scaler
cat > production-autoscaler.sh << 'AUTOSCALER'
#!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_USER="anubissbe"

# Configuration
MIN_RUNNERS=5
MAX_RUNNERS=25
SCALE_UP_THRESHOLD=70    # Scale up when 70% busy
SCALE_DOWN_THRESHOLD=30  # Scale down when less than 30% busy
CHECK_INTERVAL=30
IDLE_TIMEOUT=300         # 5 minutes

LOG_FILE="$HOME/GitHub-RunnerHub/autoscaler.log"

echo "[$(date)] 🤖 Production Auto-Scaler Started" | tee -a "$LOG_FILE"
echo "Configuration: MIN=$MIN_RUNNERS, MAX=$MAX_RUNNERS" | tee -a "$LOG_FILE"

# Array of repos to support
REPOS=(
    "ProjectHub-Mcp"
    "JarvisAI" 
    "GitHub-RunnerHub"
    "image-gen"
    "checkmarx-dashboards"
    "alicia-document-assistant"
    "ai-video-studio"
    "ai-music-studio"
    "claude-code-tools"
)

declare -A RUNNER_IDLE_TIME

spawn_runner() {
    # Pick a random repo from the list
    REPO=${REPOS[$((RANDOM % ${#REPOS[@]}))]}
    RUNNER_ID=$(openssl rand -hex 3)
    RUNNER_NAME="runnerhub-dynamic-$RUNNER_ID"
    
    echo "[$(date)] Spawning $RUNNER_NAME for $REPO" | tee -a "$LOG_FILE"
    
    # Get token
    TOKEN=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners/registration-token" | \
        python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)
    
    if [ -n "$TOKEN" ]; then
        docker run -d \
            --name "$RUNNER_NAME" \
            --restart unless-stopped \
            -e RUNNER_TOKEN="$TOKEN" \
            -e RUNNER_NAME="$RUNNER_NAME" \
            -e RUNNER_WORKDIR="/tmp/runner/work" \
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub,dynamic" \
            -e REPO_URL="https://github.com/$GITHUB_USER/$REPO" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            myoung34/github-runner:latest > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            echo "  ✅ Success" | tee -a "$LOG_FILE"
            RUNNER_IDLE_TIME[$RUNNER_NAME]=0
            return 0
        fi
    fi
    echo "  ❌ Failed" | tee -a "$LOG_FILE"
    return 1
}

remove_runner() {
    local RUNNER=$1
    echo "[$(date)] Removing idle runner: $RUNNER" | tee -a "$LOG_FILE"
    docker stop "$RUNNER" > /dev/null 2>&1
    docker rm "$RUNNER" > /dev/null 2>&1
    unset RUNNER_IDLE_TIME[$RUNNER]
}

get_runner_stats() {
    local TOTAL=0
    local BUSY=0
    
    # Count all runnerhub containers
    TOTAL=$(docker ps --format "{{.Names}}" | grep -c "^runnerhub-" | grep -v "backend\|frontend" || echo 0)
    
    # Check each repo for busy runners
    for REPO in "${REPOS[@]}"; do
        local REPO_RUNNERS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
            "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners" 2>/dev/null | \
            python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    busy = sum(1 for r in data.get('runners', []) if r.get('busy', False) and 'runnerhub' in r.get('name', ''))
    print(busy)
except: print(0)" 2>/dev/null || echo 0)
        BUSY=$((BUSY + REPO_RUNNERS))
    done
    
    echo "$TOTAL $BUSY"
}

# Initial spawn
echo "[$(date)] Spawning initial $MIN_RUNNERS runners..." | tee -a "$LOG_FILE"
for i in $(seq 1 $MIN_RUNNERS); do
    spawn_runner
    sleep 3
done

# Main loop
while true; do
    read TOTAL BUSY <<< $(get_runner_stats)
    FREE=$((TOTAL - BUSY))
    
    if [ $TOTAL -gt 0 ]; then
        UTILIZATION=$(( (BUSY * 100) / TOTAL ))
    else
        UTILIZATION=0
        TOTAL=0
    fi
    
    echo "[$(date)] Status: Total=$TOTAL, Busy=$BUSY, Free=$FREE, Util=$UTILIZATION%" | tee -a "$LOG_FILE"
    
    # Scale UP
    if [ $UTILIZATION -ge $SCALE_UP_THRESHOLD ] && [ $TOTAL -lt $MAX_RUNNERS ]; then
        echo "  📈 Scaling UP (utilization $UTILIZATION%)" | tee -a "$LOG_FILE"
        # Spawn 1-3 runners based on load
        SPAWN_COUNT=1
        [ $UTILIZATION -ge 90 ] && SPAWN_COUNT=3
        [ $UTILIZATION -ge 80 ] && [ $SPAWN_COUNT -eq 1 ] && SPAWN_COUNT=2
        
        for i in $(seq 1 $SPAWN_COUNT); do
            [ $TOTAL -lt $MAX_RUNNERS ] && spawn_runner && TOTAL=$((TOTAL + 1))
            sleep 2
        done
    
    # Scale DOWN
    elif [ $UTILIZATION -le $SCALE_DOWN_THRESHOLD ] && [ $TOTAL -gt $MIN_RUNNERS ]; then
        # Check idle runners
        docker ps --format "{{.Names}}" | grep "^runnerhub-dynamic-" | while read RUNNER; do
            if [ $TOTAL -le $MIN_RUNNERS ]; then
                break
            fi
            
            # Update idle time
            if [ -z "${RUNNER_IDLE_TIME[$RUNNER]}" ]; then
                RUNNER_IDLE_TIME[$RUNNER]=0
            fi
            
            RUNNER_IDLE_TIME[$RUNNER]=$((${RUNNER_IDLE_TIME[$RUNNER]} + CHECK_INTERVAL))
            
            # Remove if idle too long
            if [ ${RUNNER_IDLE_TIME[$RUNNER]} -ge $IDLE_TIMEOUT ]; then
                echo "  📉 Scaling DOWN (removing $RUNNER after ${RUNNER_IDLE_TIME[$RUNNER]}s idle)" | tee -a "$LOG_FILE"
                remove_runner "$RUNNER"
                TOTAL=$((TOTAL - 1))
                break
            fi
        done
    
    # Ensure minimum
    elif [ $TOTAL -lt $MIN_RUNNERS ]; then
        echo "  ⚠️  Below minimum, spawning..." | tee -a "$LOG_FILE"
        spawn_runner
    fi
    
    # Reset idle time for busy runners
    if [ $BUSY -gt 0 ]; then
        docker ps --format "{{.Names}}" | grep "^runnerhub-dynamic-" | while read RUNNER; do
            # Reset if we know it's busy
            [ -n "${RUNNER_IDLE_TIME[$RUNNER]}" ] && RUNNER_IDLE_TIME[$RUNNER]=0
        done
    fi
    
    sleep $CHECK_INTERVAL
done
AUTOSCALER

chmod +x production-autoscaler.sh

# Start it
nohup ./production-autoscaler.sh > /dev/null 2>&1 &
echo $! > autoscaler.pid

echo ""
echo "✅ Production Auto-Scaler Running!"
echo "   PID: $(cat autoscaler.pid)"
echo "   Log: ~/GitHub-RunnerHub/autoscaler.log"
echo ""
echo "📊 Configuration:"
echo "   - Minimum: 5 runners (always ready)"
echo "   - Maximum: 25 runners"
echo "   - Scale UP: >70% utilization"
echo "   - Scale DOWN: <30% utilization (5min idle)"
echo "   - Supports all your repositories"
echo ""
echo "To monitor: tail -f ~/GitHub-RunnerHub/autoscaler.log"
SCRIPT

scp -i ~/.ssh/git-runner_rsa /tmp/final-autoscaler.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/final-autoscaler.sh && bash /tmp/final-autoscaler.sh"