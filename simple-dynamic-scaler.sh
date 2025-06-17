#!/bin/bash

echo "🚀 Setting up Simple Dynamic Scaler..."

cat > /tmp/simple-scaler.sh << 'SCRIPT'
#!/bin/bash

cd ~/GitHub-RunnerHub

# First check if old runners exist
CURRENT_RUNNERS=$(docker ps --format "{{.Names}}" | grep "^runnerhub-" | grep -v "backend\|frontend" | grep -v "dynamic")
if [ -n "$CURRENT_RUNNERS" ]; then
    echo "🧹 Cleaning up old runners..."
    echo "$CURRENT_RUNNERS" | while read runner; do
        docker stop $runner && docker rm $runner
    done
fi

# Kill old auto-scalers
pkill -f "autoscaler" 2>/dev/null || true

# Create simple dynamic scaler
cat > simple-dynamic-scaler.sh << 'SCALER'
#!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_USER="anubissbe"
REPO="ProjectHub-Mcp"

MIN_RUNNERS=5
MAX_RUNNERS=20
CHECK_INTERVAL=30

echo "🤖 Simple Dynamic Scaler Started"
echo "   Min: $MIN_RUNNERS runners"
echo "   Max: $MAX_RUNNERS runners"
echo ""

spawn_runner() {
    RUNNER_ID=$(date +%s%N | cut -b10-16)
    RUNNER_NAME="runnerhub-dynamic-$RUNNER_ID"
    
    echo "[$(date '+%H:%M:%S')] Spawning $RUNNER_NAME..."
    
    TOKEN=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners/registration-token" | \
        grep -o '"token":"[^"]*' | cut -d'"' -f4)
    
    if [ -n "$TOKEN" ]; then
        docker run -d \
            --name "$RUNNER_NAME" \
            --restart unless-stopped \
            -e RUNNER_TOKEN="$TOKEN" \
            -e RUNNER_NAME="$RUNNER_NAME" \
            -e RUNNER_WORKDIR="/tmp/runner/work" \
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub" \
            -e REPO_URL="https://github.com/$GITHUB_USER/$REPO" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            myoung34/github-runner:latest > /dev/null 2>&1
        
        [ $? -eq 0 ] && echo "   ✅ Spawned" || echo "   ❌ Failed"
    fi
}

# Start with minimum runners
echo "Starting $MIN_RUNNERS runners..."
for i in $(seq 1 $MIN_RUNNERS); do
    spawn_runner
    sleep 3
done

# Monitor and scale
while true; do
    TOTAL=$(docker ps --format "{{.Names}}" | grep -c "^runnerhub-dynamic-" || echo 0)
    echo "[$(date '+%H:%M:%S')] Runners: $TOTAL"
    
    # Maintain minimum
    if [ $TOTAL -lt $MIN_RUNNERS ]; then
        echo "   Below minimum, spawning..."
        spawn_runner
    fi
    
    sleep $CHECK_INTERVAL
done
SCALER

chmod +x simple-dynamic-scaler.sh
nohup ./simple-dynamic-scaler.sh > scaler.log 2>&1 &
echo $! > scaler.pid

echo ""
echo "✅ Simple Dynamic Scaler Running!"
echo "   PID: $(cat scaler.pid)"
echo "   Min runners: 5"
echo "   Log: ~/GitHub-RunnerHub/scaler.log"
SCRIPT

scp -i ~/.ssh/git-runner_rsa /tmp/simple-scaler.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/simple-scaler.sh && bash /tmp/simple-scaler.sh"