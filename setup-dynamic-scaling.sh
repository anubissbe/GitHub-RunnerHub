#!/bin/bash

echo "🚀 Setting up Dynamic Auto-Scaling System..."

cat > /tmp/dynamic-scaler.sh << 'SCALER'
#!/bin/bash

echo "📦 Installing Dynamic Auto-Scaler with scale up/down..."

# First, stop all current runners except backend
echo "Stopping current runners..."
docker ps --format "{{.Names}}" | grep "^runnerhub-" | grep -v "backend\|frontend" | while read runner; do
    echo "Stopping $runner"
    docker stop $runner
    docker rm $runner
done

# Create the dynamic auto-scaler
cd ~/GitHub-RunnerHub
cat > dynamic-autoscaler.sh << 'AUTOSCALER'
#!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_USER="anubissbe"
DEFAULT_REPO="ProjectHub-Mcp"  # Default repo for general runners

# Configuration
MIN_RUNNERS=5          # Minimum runners to maintain
MAX_RUNNERS=20         # Maximum runners allowed
SCALE_UP_THRESHOLD=80  # Scale up when utilization > 80%
SCALE_DOWN_THRESHOLD=20 # Scale down when utilization < 20%
CHECK_INTERVAL=30      # Check every 30 seconds
IDLE_TIME=300         # Remove runner after 5 minutes idle (300 seconds)

# Track runner idle times
declare -A RUNNER_IDLE_TIMES

echo "🤖 Dynamic Auto-Scaler Started"
echo "   Min runners: $MIN_RUNNERS"
echo "   Max runners: $MAX_RUNNERS"
echo "   Scale up at: >${SCALE_UP_THRESHOLD}% utilization"
echo "   Scale down at: <${SCALE_DOWN_THRESHOLD}% utilization"
echo ""

# Function to get registration token
get_token() {
    local REPO=${1:-$DEFAULT_REPO}
    TOKEN=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners/registration-token" | \
        python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)
    echo "$TOKEN"
}

# Function to spawn a runner
spawn_runner() {
    local RUNNER_ID=$(openssl rand -hex 3)
    local RUNNER_NAME="runnerhub-dynamic-${RUNNER_ID}"
    
    echo "[$(date '+%H:%M:%S')] 🚀 Spawning new runner: $RUNNER_NAME"
    
    local TOKEN=$(get_token)
    
    if [ -n "$TOKEN" ]; then
        docker run -d \
            --name "$RUNNER_NAME" \
            --restart unless-stopped \
            -e RUNNER_TOKEN="$TOKEN" \
            -e RUNNER_NAME="$RUNNER_NAME" \
            -e RUNNER_WORKDIR="/tmp/runner/work" \
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub,dynamic" \
            -e REPO_URL="https://github.com/$GITHUB_USER/$DEFAULT_REPO" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            myoung34/github-runner:latest > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            echo "   ✅ Successfully spawned $RUNNER_NAME"
            RUNNER_IDLE_TIMES[$RUNNER_NAME]=0
            return 0
        fi
    fi
    echo "   ❌ Failed to spawn runner"
    return 1
}

# Function to remove a runner
remove_runner() {
    local RUNNER_NAME=$1
    echo "[$(date '+%H:%M:%S')] 🗑️  Removing idle runner: $RUNNER_NAME"
    
    docker stop "$RUNNER_NAME" > /dev/null 2>&1
    docker rm "$RUNNER_NAME" > /dev/null 2>&1
    
    unset RUNNER_IDLE_TIMES[$RUNNER_NAME]
    echo "   ✅ Removed $RUNNER_NAME"
}

# Function to get runner statistics
get_runner_stats() {
    # Get all RunnerHub containers
    local TOTAL=$(docker ps --format "{{.Names}}" | grep -c "^runnerhub-dynamic-" || echo 0)
    
    # Get busy runners from GitHub API (more accurate)
    local BUSY=0
    local REPOS="ProjectHub-Mcp JarvisAI GitHub-RunnerHub image-gen checkmarx-dashboards alicia-document-assistant ai-video-studio ai-music-studio"
    
    for REPO in $REPOS; do
        local REPO_BUSY=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
            "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners" 2>/dev/null | \
            python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    busy = sum(1 for r in data.get('runners', []) if r.get('busy', False) and r.get('name', '').startswith('runnerhub'))
    print(busy)
except: print(0)
" 2>/dev/null || echo 0)
        BUSY=$((BUSY + REPO_BUSY))
    done
    
    echo "$TOTAL $BUSY"
}

# Initial spawn of minimum runners
echo "[$(date '+%H:%M:%S')] 🏁 Starting with $MIN_RUNNERS runners..."
for i in $(seq 1 $MIN_RUNNERS); do
    spawn_runner
    sleep 2
done

# Main loop
while true; do
    # Get current stats
    read TOTAL BUSY <<< $(get_runner_stats)
    FREE=$((TOTAL - BUSY))
    
    if [ $TOTAL -gt 0 ]; then
        UTILIZATION=$(( (BUSY * 100) / TOTAL ))
    else
        UTILIZATION=0
    fi
    
    echo "[$(date '+%H:%M:%S')] 📊 Status: Total=$TOTAL, Busy=$BUSY, Free=$FREE, Utilization=$UTILIZATION%"
    
    # Scale UP logic
    if [ $UTILIZATION -gt $SCALE_UP_THRESHOLD ] && [ $TOTAL -lt $MAX_RUNNERS ]; then
        echo "   📈 High utilization detected! Scaling up..."
        # Spawn multiple runners if very high utilization
        RUNNERS_TO_SPAWN=1
        if [ $UTILIZATION -gt 90 ]; then
            RUNNERS_TO_SPAWN=3
        fi
        
        for i in $(seq 1 $RUNNERS_TO_SPAWN); do
            if [ $TOTAL -lt $MAX_RUNNERS ]; then
                spawn_runner && TOTAL=$((TOTAL + 1))
                sleep 2
            fi
        done
    
    # Scale DOWN logic
    elif [ $UTILIZATION -lt $SCALE_DOWN_THRESHOLD ] && [ $TOTAL -gt $MIN_RUNNERS ]; then
        # Update idle times
        docker ps --format "{{.Names}}" | grep "^runnerhub-dynamic-" | while read RUNNER; do
            # Check if runner is busy
            IS_BUSY=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
                "https://api.github.com/repos/$GITHUB_USER/$DEFAULT_REPO/actions/runners" 2>/dev/null | \
                python3 -c "
import sys, json
try:
                    data = json.load(sys.stdin)
                    for r in data.get('runners', []):
                        if r.get('name') == '$RUNNER' and r.get('busy'):
                            print('1')
                            break
except: pass
" 2>/dev/null)
            
            if [ -z "$IS_BUSY" ]; then
                # Runner is idle, increment idle time
                CURRENT_IDLE=${RUNNER_IDLE_TIMES[$RUNNER]:-0}
                RUNNER_IDLE_TIMES[$RUNNER]=$((CURRENT_IDLE + CHECK_INTERVAL))
                
                # Remove if idle too long and we're above minimum
                if [ ${RUNNER_IDLE_TIMES[$RUNNER]} -gt $IDLE_TIME ] && [ $TOTAL -gt $MIN_RUNNERS ]; then
                    remove_runner "$RUNNER"
                    TOTAL=$((TOTAL - 1))
                    break  # Only remove one at a time
                fi
            else
                # Runner is busy, reset idle time
                RUNNER_IDLE_TIMES[$RUNNER]=0
            fi
        done
    
    # Ensure minimum runners
    elif [ $TOTAL -lt $MIN_RUNNERS ]; then
        echo "   ⚠️  Below minimum runners, spawning..."
        spawn_runner
    fi
    
    # Reset idle times for busy runners
    for RUNNER in "${!RUNNER_IDLE_TIMES[@]}"; do
        if ! docker ps --format "{{.Names}}" | grep -q "^$RUNNER$"; then
            unset RUNNER_IDLE_TIMES[$RUNNER]
        fi
    done
    
    sleep $CHECK_INTERVAL
done
AUTOSCALER

chmod +x dynamic-autoscaler.sh

# Kill any existing auto-scalers
pkill -f "autoscaler" 2>/dev/null || true

# Start the dynamic auto-scaler
nohup ./dynamic-autoscaler.sh > autoscaler.log 2>&1 &
echo $! > autoscaler.pid

echo ""
echo "✅ Dynamic Auto-Scaler Installed!"
echo ""
echo "📊 Configuration:"
echo "   - Minimum runners: 5 (always ready)"
echo "   - Maximum runners: 20"
echo "   - Scale UP: When utilization > 80%"
echo "   - Scale DOWN: When utilization < 20% (after 5 min idle)"
echo "   - Check interval: 30 seconds"
echo ""
echo "📍 Monitoring:"
echo "   - PID: $(cat autoscaler.pid)"
echo "   - Log: ~/GitHub-RunnerHub/autoscaler.log"
echo "   - Dashboard: http://192.168.1.16:8080"
echo ""
echo "To watch it work: tail -f ~/GitHub-RunnerHub/autoscaler.log"
SCALER

# Deploy and execute
scp -i ~/.ssh/git-runner_rsa /tmp/dynamic-scaler.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/dynamic-scaler.sh && bash /tmp/dynamic-scaler.sh"

echo ""
echo "🎯 Dynamic scaling is now active!"
echo "   - Minimum 5 runners always ready"
echo "   - Auto-scales up when busy"
echo "   - Auto-scales down when idle"
echo "   - Dashboard shows real-time status"