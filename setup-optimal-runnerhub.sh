#!/bin/bash

echo "🚀 Setting up OPTIMAL RunnerHub Configuration"
echo "Strategy: 1 dedicated runner per repo + dynamic scaling pool"

cat > /tmp/optimal-setup.sh << 'SCRIPT'
#!/bin/bash

cd ~/GitHub-RunnerHub

# Configuration
GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_USER="anubissbe"

# Your active repositories
REPOS=(
    "ProjectHub-Mcp"
    "JarvisAI"
    "GitHub-RunnerHub"
    "image-gen"
    "checkmarx-dashboards"
    "alicia-document-assistant"
    "ai-video-studio"
    "ai-music-studio"
    "Jarvis2.0"
    "claude-code-tools"
)

echo "📦 Optimal RunnerHub Setup"
echo "   - 1 dedicated runner per repository (always ready)"
echo "   - Dynamic scaling when workload increases"
echo "   - Smart cleanup when idle"
echo ""

# Step 1: Clean up ALL existing runners
echo "🧹 Cleaning up all existing runners..."
docker ps -a --format '{{.Names}}' | grep -E '^runnerhub-' | grep -v 'backend\|frontend' | xargs -r docker rm -f

# Step 2: Create ONE dedicated runner per repository
echo "🏃 Creating dedicated runners (1 per repo)..."
for REPO in "${REPOS[@]}"; do
    RUNNER_NAME="runnerhub-$(echo $REPO | tr '[:upper:]' '[:lower:]' | tr -d '.-' | cut -c1-15)"
    
    echo "Creating $RUNNER_NAME for $REPO..."
    
    # Get registration token
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
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub,dedicated" \
            -e REPO_URL="https://github.com/$GITHUB_USER/$REPO" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            myoung34/github-runner:latest > /dev/null 2>&1
        
        echo "  ✅ Created dedicated runner for $REPO"
    else
        echo "  ❌ Failed to create runner for $REPO"
    fi
    
    sleep 2
done

# Step 3: Create the optimal auto-scaler
echo ""
echo "📝 Creating optimal auto-scaler..."

cat > ~/GitHub-RunnerHub/optimal-autoscaler.sh << 'AUTOSCALER'
#!/bin/bash

# Optimal Auto-Scaler for RunnerHub
# Strategy: Each repo has 1 dedicated runner + dynamic scaling when busy

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_USER="anubissbe"
SCALE_THRESHOLD=1      # Scale when ALL runners are busy
MAX_DYNAMIC_PER_REPO=3 # Max 3 dynamic runners per repo
CHECK_INTERVAL=30      # Check every 30 seconds

# Repositories to monitor
REPOS=(
    "ProjectHub-Mcp"
    "JarvisAI"
    "GitHub-RunnerHub"
    "image-gen"
    "checkmarx-dashboards"
    "alicia-document-assistant"
    "ai-video-studio"
    "ai-music-studio"
    "Jarvis2.0"
    "claude-code-tools"
)

echo "🤖 Optimal Auto-Scaler Started"
echo "   Strategy: 1 dedicated + up to $MAX_DYNAMIC_PER_REPO dynamic per repo"
echo ""

# Track dynamic runners
declare -A DYNAMIC_RUNNERS

while true; do
    echo "[$(date '+%H:%M:%S')] Checking repositories..."
    
    for REPO in "${REPOS[@]}"; do
        # Get runner stats
        STATS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
            "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners" 2>/dev/null)
        
        TOTAL=$(echo "$STATS" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('runners', [])))" 2>/dev/null || echo 0)
        BUSY=$(echo "$STATS" | python3 -c "import sys, json; print(sum(1 for r in json.load(sys.stdin).get('runners', []) if r.get('busy')))" 2>/dev/null || echo 0)
        FREE=$((TOTAL - BUSY))
        
        # Count dynamic runners for this repo
        DYNAMIC_COUNT=$(docker ps --format "{{.Names}}" | grep -c "runnerhub-dyn-$(echo $REPO | tr '[:upper:]' '[:lower:]' | tr -d '.-' | cut -c1-10)" || echo 0)
        
        printf "  %-25s Total: %d, Busy: %d, Free: %d, Dynamic: %d" "$REPO:" "$TOTAL" "$BUSY" "$FREE" "$DYNAMIC_COUNT"
        
        # Scale UP: If all runners are busy and we haven't hit the limit
        if [ $FREE -eq 0 ] && [ $DYNAMIC_COUNT -lt $MAX_DYNAMIC_PER_REPO ]; then
            echo " 📈 SCALING UP"
            
            # Spawn dynamic runner
            RUNNER_ID=$(openssl rand -hex 3)
            RUNNER_NAME="runnerhub-dyn-$(echo $REPO | tr '[:upper:]' '[:lower:]' | tr -d '.-' | cut -c1-10)-$RUNNER_ID"
            
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
                
                DYNAMIC_RUNNERS[$RUNNER_NAME]=$(date +%s)
                echo "    ✅ Spawned $RUNNER_NAME"
            fi
            
        # Scale DOWN: If we have dynamic runners and they're all free
        elif [ $DYNAMIC_COUNT -gt 0 ] && [ $BUSY -eq 0 ]; then
            echo " 📉 Checking for scale down..."
            
            # Find and remove idle dynamic runners (older than 5 minutes)
            CURRENT_TIME=$(date +%s)
            docker ps --format "{{.Names}}" | grep "runnerhub-dyn-$(echo $REPO | tr '[:upper:]' '[:lower:]' | tr -d '.-' | cut -c1-10)" | while read RUNNER; do
                SPAWN_TIME=${DYNAMIC_RUNNERS[$RUNNER]:-$CURRENT_TIME}
                IDLE_TIME=$((CURRENT_TIME - SPAWN_TIME))
                
                if [ $IDLE_TIME -gt 300 ]; then  # 5 minutes
                    echo "    🗑️  Removing idle $RUNNER (idle for ${IDLE_TIME}s)"
                    docker stop "$RUNNER" > /dev/null 2>&1
                    docker rm "$RUNNER" > /dev/null 2>&1
                    unset DYNAMIC_RUNNERS[$RUNNER]
                    break  # Remove one at a time
                fi
            done
        else
            echo " ✅"
        fi
    done
    
    echo ""
    sleep $CHECK_INTERVAL
done
AUTOSCALER

chmod +x ~/GitHub-RunnerHub/optimal-autoscaler.sh

# Kill any existing auto-scalers
pkill -f "autoscaler" 2>/dev/null || true
sleep 2

# Start the optimal auto-scaler
cd ~/GitHub-RunnerHub
nohup ./optimal-autoscaler.sh > optimal-autoscaler.log 2>&1 &
echo $! > optimal-autoscaler.pid

echo ""
echo "✅ OPTIMAL RunnerHub Setup Complete!"
echo ""
echo "📊 Configuration:"
echo "   - ${#REPOS[@]} repositories configured"
echo "   - 1 dedicated runner per repository (always ready)"
echo "   - Dynamic scaling: 0-$MAX_DYNAMIC_PER_REPO additional runners per repo"
echo "   - Scale up: When all runners busy"
echo "   - Scale down: After 5 minutes idle"
echo ""
echo "📍 Status:"
echo "   - Dedicated runners: $(docker ps --format '{{.Names}}' | grep -c 'runnerhub-[^dyn]' | grep -v backend)"
echo "   - Auto-scaler PID: $(cat ~/GitHub-RunnerHub/optimal-autoscaler.pid)"
echo "   - Log: ~/GitHub-RunnerHub/optimal-autoscaler.log"
echo ""
echo "To monitor: tail -f ~/GitHub-RunnerHub/optimal-autoscaler.log"
SCRIPT

# Deploy to server
scp -i ~/.ssh/git-runner_rsa /tmp/optimal-setup.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/optimal-setup.sh && bash /tmp/optimal-setup.sh"