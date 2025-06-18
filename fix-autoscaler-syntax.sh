#!/bin/bash

echo "🔧 Fixing Auto-Scaler Syntax Error"

cat > /tmp/fix-autoscaler.sh << 'SCRIPT'
#!/bin/bash

cd ~/GitHub-RunnerHub

# Get the GitHub token from backend
GITHUB_TOKEN=$(docker exec runnerhub-backend printenv GITHUB_TOKEN)

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Could not get GitHub token"
    exit 1
fi

# Kill existing auto-scaler
pkill -f "optimal-autoscaler" 2>/dev/null || true
sleep 2

# Create fixed auto-scaler
cat > ~/GitHub-RunnerHub/optimal-autoscaler-fixed.sh << 'AUTOSCALER'
#!/bin/bash

# Optimal Auto-Scaler for RunnerHub
GITHUB_TOKEN="'$GITHUB_TOKEN'"
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

echo "🤖 Optimal Auto-Scaler Started at $(date)"
echo "   Strategy: 1 dedicated + up to $MAX_DYNAMIC_PER_REPO dynamic per repo"
echo ""

# Track dynamic runners with timestamps
declare -A DYNAMIC_RUNNERS

while true; do
    echo "[$(date '+%H:%M:%S')] Checking repositories..."
    
    TOTAL_RUNNERS=0
    TOTAL_DYNAMIC=0
    
    for REPO in "${REPOS[@]}"; do
        # Get runner stats from GitHub API
        STATS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
            "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners" 2>/dev/null)
        
        # Check if we got valid JSON
        if [ -z "$STATS" ] || [ "$STATS" = "null" ]; then
            printf "  %-25s API Error\n" "$REPO:"
            continue
        fi
        
        # Parse runner counts safely
        TOTAL=$(echo "$STATS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(len(data.get('runners', [])))
except:
    print(0)
" 2>/dev/null)
        
        BUSY=$(echo "$STATS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    busy = sum(1 for r in data.get('runners', []) if r.get('busy', False))
    print(busy)
except:
    print(0)
" 2>/dev/null)
        
        # Ensure we have numbers
        TOTAL=${TOTAL:-0}
        BUSY=${BUSY:-0}
        FREE=$((TOTAL - BUSY))
        
        TOTAL_RUNNERS=$((TOTAL_RUNNERS + TOTAL))
        
        # Count dynamic runners for this repo
        REPO_SHORT=$(echo $REPO | tr '[:upper:]' '[:lower:]' | tr -d '.-' | cut -c1-10)
        DYNAMIC_COUNT=$(docker ps --format "{{.Names}}" 2>/dev/null | grep -c "runnerhub-dyn-${REPO_SHORT}" || echo 0)
        TOTAL_DYNAMIC=$((TOTAL_DYNAMIC + DYNAMIC_COUNT))
        
        printf "  %-25s Total: %d, Busy: %d, Free: %d, Dynamic: %d" "$REPO:" "$TOTAL" "$BUSY" "$FREE" "$DYNAMIC_COUNT"
        
        # Scale UP: If all runners are busy and we haven't hit the limit
        if [ "$TOTAL" -gt 0 ] && [ "$FREE" -eq 0 ] && [ "$DYNAMIC_COUNT" -lt "$MAX_DYNAMIC_PER_REPO" ]; then
            echo " 📈 SCALING UP"
            
            # Spawn dynamic runner
            RUNNER_ID=$(openssl rand -hex 3)
            RUNNER_NAME="runnerhub-dyn-${REPO_SHORT}-${RUNNER_ID}"
            
            TOKEN=$(curl -s -X POST \
                -H "Authorization: token $GITHUB_TOKEN" \
                -H "Accept: application/vnd.github.v3+json" \
                "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners/registration-token" 2>/dev/null | \
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
                    DYNAMIC_RUNNERS[$RUNNER_NAME]=$(date +%s)
                    echo "    ✅ Spawned $RUNNER_NAME"
                else
                    echo "    ❌ Failed to spawn runner"
                fi
            fi
            
        # Scale DOWN: If we have dynamic runners and they're all free
        elif [ "$DYNAMIC_COUNT" -gt 0 ] && [ "$BUSY" -eq 0 ]; then
            echo " 📉 Checking for scale down..."
            
            # Find and remove idle dynamic runners (older than 5 minutes)
            CURRENT_TIME=$(date +%s)
            docker ps --format "{{.Names}}" 2>/dev/null | grep "runnerhub-dyn-${REPO_SHORT}" | while read RUNNER; do
                SPAWN_TIME=${DYNAMIC_RUNNERS[$RUNNER]:-$CURRENT_TIME}
                IDLE_TIME=$((CURRENT_TIME - SPAWN_TIME))
                
                if [ $IDLE_TIME -gt 300 ]; then  # 5 minutes
                    echo "    🗑️  Removing $RUNNER (idle for ${IDLE_TIME}s)"
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
    echo "  📊 Summary: $TOTAL_RUNNERS total runners ($TOTAL_DYNAMIC dynamic)"
    echo ""
    
    sleep $CHECK_INTERVAL
done
AUTOSCALER

chmod +x ~/GitHub-RunnerHub/optimal-autoscaler-fixed.sh

# Start the fixed auto-scaler
nohup ./optimal-autoscaler-fixed.sh > optimal-autoscaler.log 2>&1 &
echo $! > optimal-autoscaler.pid

echo "✅ Auto-scaler fixed and restarted!"
echo "   PID: $(cat optimal-autoscaler.pid)"
echo "   Log: ~/GitHub-RunnerHub/optimal-autoscaler.log"
SCRIPT

# Deploy and run
scp -i ~/.ssh/git-runner_rsa /tmp/fix-autoscaler.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/fix-autoscaler.sh && bash /tmp/fix-autoscaler.sh"