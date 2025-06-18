#!/bin/bash

echo "🚀 Deploying Optimal RunnerHub with Token from Backend"

# Get the token from the backend environment
cat > /tmp/deploy-optimal.sh << 'SCRIPT'
#!/bin/bash

cd ~/GitHub-RunnerHub

# Get token from backend container
GITHUB_TOKEN=$(docker exec runnerhub-backend printenv GITHUB_TOKEN)

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Could not get GitHub token from backend"
    exit 1
fi

echo "✅ Retrieved GitHub token from backend"

# Now run the optimal setup with the token
export GITHUB_TOKEN

# Configuration
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
echo "   - 1 dedicated runner per repository"
echo "   - Dynamic scaling when busy"
echo ""

# Clean up all existing runners first
echo "🧹 Cleaning up existing runners..."
docker ps -a --format '{{.Names}}' | grep -E '^runnerhub-' | grep -v 'backend\|frontend' | xargs -r docker rm -f

# Create ONE dedicated runner per repository
echo "🏃 Creating dedicated runners..."
SUCCESS=0
FAILED=0

for REPO in "${REPOS[@]}"; do
    RUNNER_NAME="runnerhub-$(echo $REPO | tr '[:upper:]' '[:lower:]' | tr -d '.-' | cut -c1-15)"
    
    echo -n "Creating runner for $REPO... "
    
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
        
        if [ $? -eq 0 ]; then
            echo "✅"
            SUCCESS=$((SUCCESS + 1))
        else
            echo "❌ (container failed)"
            FAILED=$((FAILED + 1))
        fi
    else
        echo "❌ (no token)"
        FAILED=$((FAILED + 1))
    fi
    
    sleep 1
done

echo ""
echo "📊 Runner Creation Summary:"
echo "   ✅ Success: $SUCCESS"
echo "   ❌ Failed: $FAILED"
echo ""

# Create the optimal auto-scaler with embedded token
cat > ~/GitHub-RunnerHub/optimal-autoscaler.sh << AUTOSCALER
#!/bin/bash

# Optimal Auto-Scaler for RunnerHub
GITHUB_TOKEN="$GITHUB_TOKEN"
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

echo "🤖 Optimal Auto-Scaler Started at \$(date)"
echo "   Strategy: 1 dedicated + up to \$MAX_DYNAMIC_PER_REPO dynamic per repo"
echo ""

# Track dynamic runners with timestamps
declare -A DYNAMIC_RUNNERS

while true; do
    echo "[\$(date '+%H:%M:%S')] Checking repositories..."
    
    TOTAL_RUNNERS=0
    TOTAL_DYNAMIC=0
    
    for REPO in "\${REPOS[@]}"; do
        # Get runner stats from GitHub API
        STATS=\$(curl -s -H "Authorization: token \$GITHUB_TOKEN" \
            "https://api.github.com/repos/\$GITHUB_USER/\$REPO/actions/runners" 2>/dev/null)
        
        if [ -z "\$STATS" ]; then
            printf "  %-25s API Error\\n" "\$REPO:"
            continue
        fi
        
        TOTAL=\$(echo "\$STATS" | python3 -c "import sys, json; d=json.load(sys.stdin); print(len(d.get('runners', [])))" 2>/dev/null || echo 0)
        BUSY=\$(echo "\$STATS" | python3 -c "import sys, json; d=json.load(sys.stdin); print(sum(1 for r in d.get('runners', []) if r.get('busy')))" 2>/dev/null || echo 0)
        FREE=\$((TOTAL - BUSY))
        
        TOTAL_RUNNERS=\$((TOTAL_RUNNERS + TOTAL))
        
        # Count dynamic runners for this repo
        REPO_SHORT=\$(echo \$REPO | tr '[:upper:]' '[:lower:]' | tr -d '.-' | cut -c1-10)
        DYNAMIC_COUNT=\$(docker ps --format "{{.Names}}" | grep -c "runnerhub-dyn-\${REPO_SHORT}" || echo 0)
        TOTAL_DYNAMIC=\$((TOTAL_DYNAMIC + DYNAMIC_COUNT))
        
        printf "  %-25s Total: %d, Busy: %d, Free: %d, Dynamic: %d" "\$REPO:" "\$TOTAL" "\$BUSY" "\$FREE" "\$DYNAMIC_COUNT"
        
        # Scale UP: If all runners are busy and we haven't hit the limit
        if [ \$FREE -eq 0 ] && [ \$TOTAL -gt 0 ] && [ \$DYNAMIC_COUNT -lt \$MAX_DYNAMIC_PER_REPO ]; then
            echo " 📈 SCALING UP"
            
            # Spawn dynamic runner
            RUNNER_ID=\$(openssl rand -hex 3)
            RUNNER_NAME="runnerhub-dyn-\${REPO_SHORT}-\${RUNNER_ID}"
            
            TOKEN=\$(curl -s -X POST \
                -H "Authorization: token \$GITHUB_TOKEN" \
                -H "Accept: application/vnd.github.v3+json" \
                "https://api.github.com/repos/\$GITHUB_USER/\$REPO/actions/runners/registration-token" | \
                python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)
            
            if [ -n "\$TOKEN" ]; then
                docker run -d \
                    --name "\$RUNNER_NAME" \
                    --restart unless-stopped \
                    -e RUNNER_TOKEN="\$TOKEN" \
                    -e RUNNER_NAME="\$RUNNER_NAME" \
                    -e RUNNER_WORKDIR="/tmp/runner/work" \
                    -e LABELS="self-hosted,Linux,X64,docker,runnerhub,dynamic" \
                    -e REPO_URL="https://github.com/\$GITHUB_USER/\$REPO" \
                    -v /var/run/docker.sock:/var/run/docker.sock \
                    myoung34/github-runner:latest > /dev/null 2>&1
                
                if [ \$? -eq 0 ]; then
                    DYNAMIC_RUNNERS[\$RUNNER_NAME]=\$(date +%s)
                    echo "    ✅ Spawned \$RUNNER_NAME"
                else
                    echo "    ❌ Failed to spawn runner"
                fi
            fi
            
        # Scale DOWN: If we have dynamic runners and they're all free
        elif [ \$DYNAMIC_COUNT -gt 0 ] && [ \$BUSY -eq 0 ]; then
            echo " 📉 Checking for scale down..."
            
            # Find and remove idle dynamic runners (older than 5 minutes)
            CURRENT_TIME=\$(date +%s)
            docker ps --format "{{.Names}}" | grep "runnerhub-dyn-\${REPO_SHORT}" | while read RUNNER; do
                SPAWN_TIME=\${DYNAMIC_RUNNERS[\$RUNNER]:-\$CURRENT_TIME}
                IDLE_TIME=\$((CURRENT_TIME - SPAWN_TIME))
                
                if [ \$IDLE_TIME -gt 300 ]; then  # 5 minutes
                    echo "    🗑️  Removing \$RUNNER (idle for \${IDLE_TIME}s)"
                    docker stop "\$RUNNER" > /dev/null 2>&1
                    docker rm "\$RUNNER" > /dev/null 2>&1
                    unset DYNAMIC_RUNNERS[\$RUNNER]
                    break  # Remove one at a time
                fi
            done
        else
            echo " ✅"
        fi
    done
    
    echo ""
    echo "  📊 Summary: \$TOTAL_RUNNERS total runners (\$TOTAL_DYNAMIC dynamic)"
    echo ""
    
    sleep \$CHECK_INTERVAL
done
AUTOSCALER

chmod +x ~/GitHub-RunnerHub/optimal-autoscaler.sh

# Kill any existing auto-scalers
echo "🔄 Restarting auto-scaler..."
pkill -f "autoscaler" 2>/dev/null || true
sleep 2

# Start the optimal auto-scaler
cd ~/GitHub-RunnerHub
nohup ./optimal-autoscaler.sh > optimal-autoscaler.log 2>&1 &
echo $! > optimal-autoscaler.pid

echo ""
echo "✅ OPTIMAL RunnerHub Deployment Complete!"
echo ""
echo "📊 Current Status:"
echo "   - Dedicated runners: $(docker ps --format '{{.Names}}' | grep -c '^runnerhub-[^dyn]' | grep -v 'backend\|frontend' || echo 0)"
echo "   - Dynamic runners: $(docker ps --format '{{.Names}}' | grep -c '^runnerhub-dyn-' || echo 0)"
echo "   - Auto-scaler PID: $(cat ~/GitHub-RunnerHub/optimal-autoscaler.pid)"
echo ""
echo "📍 Monitoring:"
echo "   - Dashboard: http://192.168.1.16:8080"
echo "   - Auto-scaler log: tail -f ~/GitHub-RunnerHub/optimal-autoscaler.log"
echo ""
echo "🚀 The system will now:"
echo "   1. Maintain 1 dedicated runner per repo"
echo "   2. Spawn dynamic runners when repos get busy"
echo "   3. Remove dynamic runners after 5 min idle"
echo "   4. Scale each repo independently (0-3 dynamic)"
SCRIPT

# Deploy to server
scp -i ~/.ssh/git-runner_rsa /tmp/deploy-optimal.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/deploy-optimal.sh && bash /tmp/deploy-optimal.sh"