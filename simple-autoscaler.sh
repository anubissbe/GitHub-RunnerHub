#!/bin/bash

echo "🚀 Installing Simple Auto-Scaler..."

cat > /tmp/simple-autoscaler.sh << 'AUTOSCALER'
#!/bin/bash

echo "📦 Installing Simple Auto-Scaler (no dependencies)..."

# Kill old autoscaler
pkill -f "autoscaler.sh" 2>/dev/null

cd ~
cat > simple-autoscaler.sh << 'SCRIPT'
#!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"
MIN_FREE_RUNNERS=5

echo "🤖 Simple Auto-Scaler Started"
echo "   Checking every 30 seconds"
echo "   Maintaining $MIN_FREE_RUNNERS free runners"
echo ""

spawn_runner() {
    RUNNER_ID=$(openssl rand -hex 3)
    RUNNER_NAME="runnerhub-auto-${RUNNER_ID}"
    
    echo "[$(date '+%H:%M:%S')] Spawning new runner: $RUNNER_NAME"
    
    # Get token from GitHub
    TOKEN=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners/registration-token" | \
        grep -o '"token":"[^"]*' | cut -d'"' -f4)
    
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
            echo "   📊 Dashboard will show it at http://192.168.1.16:8302"
        else
            echo "   ❌ Failed to spawn runner"
        fi
    else
        echo "   ❌ Failed to get registration token"
    fi
}

while true; do
    # Count current runners
    TOTAL_RUNNERS=$(docker ps --format "{{.Names}}" | grep -c "^runnerhub-" | grep -v "backend\|frontend" || echo 0)
    
    echo "[$(date '+%H:%M:%S')] Current runners: $TOTAL_RUNNERS"
    
    # Simple logic: if we have less than 10 runners, spawn one
    if [ $TOTAL_RUNNERS -lt 10 ]; then
        echo "   📈 Need more runners (have $TOTAL_RUNNERS, want at least 10)"
        spawn_runner
    else
        echo "   ✅ Enough runners for now"
    fi
    
    sleep 30
done
SCRIPT

chmod +x simple-autoscaler.sh

# Start it
nohup ./simple-autoscaler.sh > simple-autoscaler.log 2>&1 &
echo $! > simple-autoscaler.pid

echo ""
echo "✅ Simple Auto-Scaler Started!"
echo "   PID: $(cat simple-autoscaler.pid)"
echo "   Log: ~/simple-autoscaler.log"
echo ""
echo "🎯 This auto-scaler will:"
echo "   - Check every 30 seconds"
echo "   - Spawn runners until there are 10"
echo "   - Each new runner appears on http://192.168.1.16:8302"
echo ""
echo "To watch it work:"
echo "   tail -f ~/simple-autoscaler.log"
AUTOSCALER

# Deploy
scp -i ~/.ssh/git-runner_rsa /tmp/simple-autoscaler.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "bash /tmp/simple-autoscaler.sh"