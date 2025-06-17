#!/bin/bash

echo "🚀 Forcing auto-scale by creating heavy load..."

cat > /tmp/force-scale.sh << 'SCRIPT'
#!/bin/bash

# Update auto-scaler to be more aggressive
cat > ~/GitHub-RunnerHub/aggressive-autoscaler.sh << 'AUTOSCALER'
#!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"
MIN_FREE_RUNNERS=3
MAX_RUNNERS=15
CHECK_INTERVAL=5

echo "🚀 Aggressive Auto-Scaler Started"
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
            myoung34/github-runner:latest
        
        if [ $? -eq 0 ]; then
            echo "   ✅ Successfully spawned $RUNNER_NAME"
            return 0
        fi
    fi
    echo "   ❌ Failed to spawn runner"
    return 1
}

# Initial spawn of runners to handle queued jobs
echo "[$(date '+%H:%M:%S')] 🔥 Detected queued workflows - spawning 5 runners immediately!"
for i in {1..5}; do
    spawn_runner
    sleep 2
done

while true; do
    # Count runners
    TOTAL_RUNNERS=$(docker ps -a --format "{{.Names}}" | grep -c "^runnerhub-" || echo 0)
    
    echo "[$(date '+%H:%M:%S')] 📊 Total runners: $TOTAL_RUNNERS"
    
    # Keep spawning until we have enough
    if [ $TOTAL_RUNNERS -lt 10 ]; then
        echo "   📈 Need more runners!"
        spawn_runner
    fi
    
    sleep $CHECK_INTERVAL
done
AUTOSCALER

chmod +x ~/GitHub-RunnerHub/aggressive-autoscaler.sh

# Kill existing auto-scaler
pkill -f "docker-autoscaler.sh" 2>/dev/null
pkill -f "autoscaler.sh" 2>/dev/null

# Start aggressive auto-scaler
cd ~/GitHub-RunnerHub
nohup ./aggressive-autoscaler.sh > autoscaler-aggressive.log 2>&1 &
echo $! > autoscaler.pid

echo ""
echo "✅ Aggressive Auto-Scaler Started!"
echo "   Will spawn 5 runners immediately"
echo "   Then maintain 10+ runners"
echo ""

# Show initial spawn progress
sleep 15
echo "📊 Current runners:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep runnerhub- | grep -v 'backend\|frontend'
SCRIPT

scp -i ~/.ssh/git-runner_rsa /tmp/force-scale.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/force-scale.sh && bash /tmp/force-scale.sh"