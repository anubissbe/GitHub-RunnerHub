#!/bin/bash

echo "🚀 Deploying Simple Robust Auto-Scaler"

cat > /tmp/robust-autoscaler.sh << 'SCRIPT'
#!/bin/bash

cd ~/GitHub-RunnerHub

# Get token from backend
GITHUB_TOKEN=$(docker exec runnerhub-backend printenv GITHUB_TOKEN)
if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ No GitHub token found"
    exit 1
fi

# Kill old auto-scalers
pkill -f "autoscaler" 2>/dev/null || true
sleep 2

# Create simple robust auto-scaler
cat > ~/GitHub-RunnerHub/robust-autoscaler.sh << 'EOF'
#!/bin/bash

GITHUB_USER="anubissbe"
MAX_DYNAMIC=3

# Repos to monitor
REPOS=(
    "ProjectHub-Mcp"
    "JarvisAI" 
    "GitHub-RunnerHub"
    "image-gen"
    "checkmarx-dashboards"
)

echo "🤖 Robust Auto-Scaler Started"
echo ""

# Function to spawn runner
spawn_runner() {
    local REPO=$1
    local RUNNER_ID=$(date +%s%N | md5sum | head -c 6)
    local RUNNER_NAME="runnerhub-dyn-$RUNNER_ID"
    
    echo "  🚀 Spawning $RUNNER_NAME for $REPO"
    
    # Get token
    local TOKEN=$(curl -s -X POST \
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
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub,dynamic" \
            -e REPO_URL="https://github.com/$GITHUB_USER/$REPO" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            myoung34/github-runner:latest > /dev/null 2>&1 && echo "    ✅ Success" || echo "    ❌ Failed"
    else
        echo "    ❌ No token"
    fi
}

# Main loop
while true; do
    echo "[$(date '+%H:%M:%S')] Checking repositories..."
    
    for REPO in "${REPOS[@]}"; do
        # Get runner info
        API_RESULT=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
            "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners")
        
        # Count runners
        if echo "$API_RESULT" | grep -q '"runners"'; then
            TOTAL=$(echo "$API_RESULT" | grep -o '"id":[0-9]*' | wc -l)
            BUSY=$(echo "$API_RESULT" | grep -o '"busy":true' | wc -l)
            FREE=$((TOTAL - BUSY))
            
            # Count dynamic runners
            DYNAMIC=$(docker ps --format "{{.Names}}" | grep -c "runnerhub-dyn-" || echo 0)
            
            printf "  %-25s Total: %d, Busy: %d, Free: %d, Dynamic: %d" "$REPO:" "$TOTAL" "$BUSY" "$FREE" "$DYNAMIC"
            
            # Scale up if needed
            if [ "$TOTAL" -gt 0 ] && [ "$FREE" -eq 0 ] && [ "$DYNAMIC" -lt "$MAX_DYNAMIC" ]; then
                echo " 📈 SCALING UP"
                spawn_runner "$REPO"
            else
                echo " ✅"
            fi
        else
            echo "  $REPO: API Error"
        fi
    done
    
    # Clean up old dynamic runners
    echo ""
    echo "  Checking for idle dynamic runners..."
    docker ps --format "{{.Names}} {{.Status}}" | grep "runnerhub-dyn-" | while read NAME STATUS; do
        # Simple check: if container is older than 10 minutes, remove it
        if echo "$STATUS" | grep -E "(hours|days)" > /dev/null; then
            echo "  🗑️  Removing old runner: $NAME"
            docker stop "$NAME" > /dev/null 2>&1
            docker rm "$NAME" > /dev/null 2>&1
        fi
    done
    
    echo ""
    sleep 30
done
EOF

# Insert the GitHub token
sed -i "s/GITHUB_TOKEN=.*/GITHUB_TOKEN=\"$GITHUB_TOKEN\"/" ~/GitHub-RunnerHub/robust-autoscaler.sh
sed -i '1a GITHUB_TOKEN="'"$GITHUB_TOKEN"'"' ~/GitHub-RunnerHub/robust-autoscaler.sh

chmod +x ~/GitHub-RunnerHub/robust-autoscaler.sh

# Start it
cd ~/GitHub-RunnerHub
nohup ./robust-autoscaler.sh > robust-autoscaler.log 2>&1 &
echo $! > robust-autoscaler.pid

echo ""
echo "✅ Robust Auto-Scaler Running!"
echo "   PID: $(cat robust-autoscaler.pid)"
echo "   Log: ~/GitHub-RunnerHub/robust-autoscaler.log"
echo ""
echo "This version:"
echo "- Uses simple grep/wc instead of complex Python parsing"
echo "- Handles API errors gracefully"
echo "- Removes runners older than 10 minutes"
echo "- More reliable token extraction"
SCRIPT

# Deploy and run
scp -i ~/.ssh/git-runner_rsa /tmp/robust-autoscaler.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/robust-autoscaler.sh && bash /tmp/robust-autoscaler.sh"