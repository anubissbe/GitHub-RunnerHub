#!/bin/bash

echo "🔧 Fixing token refresher to parse JSON correctly..."

cat > /tmp/fix-refresher.sh << 'SCRIPT'
#!/bin/bash

echo "📦 Updating token refresher with JSON parsing fix..."

# Update the token refresher script
cat > ~/GitHub-RunnerHub/scripts/token-refresher-fixed.sh << 'REFRESHER'
#!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"
LOG_FILE="$HOME/GitHub-RunnerHub/token-refresher.log"

echo "[$(date)] Token Refresher (Fixed) Started" >> "$LOG_FILE"

refresh_runner_token() {
    local container_name=$1
    echo "[$(date)] Refreshing token for $container_name" >> "$LOG_FILE"
    
    # Get new registration token with proper JSON parsing
    RESPONSE=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners/registration-token")
    
    TOKEN=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)
    
    if [ -n "$TOKEN" ]; then
        # Stop the container
        docker stop "$container_name" 2>/dev/null
        
        # Get container details
        RUNNER_NAME=$(docker inspect "$container_name" 2>/dev/null | grep -o '"RUNNER_NAME=[^"]*' | cut -d= -f2 | head -1)
        
        # Remove old container
        docker rm -f "$container_name" 2>/dev/null
        
        # Create new container with fresh token
        docker run -d \
            --name "$container_name" \
            --restart unless-stopped \
            -e RUNNER_TOKEN="$TOKEN" \
            -e RUNNER_NAME="${RUNNER_NAME:-$container_name}" \
            -e RUNNER_WORKDIR="/tmp/runner/work" \
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub" \
            -e REPO_URL="https://github.com/$GITHUB_ORG/$REPO" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            myoung34/github-runner:latest > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            echo "[$(date)] ✅ Successfully refreshed $container_name" >> "$LOG_FILE"
        else
            echo "[$(date)] ❌ Failed to refresh $container_name" >> "$LOG_FILE"
        fi
    else
        echo "[$(date)] ❌ Failed to get new token for $container_name (Response: $RESPONSE)" >> "$LOG_FILE"
    fi
}

# Main loop - check every 45 minutes
while true; do
    echo "[$(date)] Checking runners..." >> "$LOG_FILE"
    
    # Get all runner containers
    RUNNERS=$(docker ps -a --format "{{.Names}}" | grep "^runnerhub-" | grep -v "backend\|frontend")
    
    for runner in $RUNNERS; do
        # Check if runner is in restart loop or exited
        STATUS=$(docker inspect "$runner" --format='{{.State.Status}}' 2>/dev/null)
        RESTART_COUNT=$(docker inspect "$runner" --format='{{.RestartCount}}' 2>/dev/null || echo 0)
        
        if [ "$STATUS" = "restarting" ] || [ "$STATUS" = "exited" ] || [ "$RESTART_COUNT" -gt 2 ]; then
            echo "[$(date)] Runner $runner needs refresh (status: $STATUS, restarts: $RESTART_COUNT)" >> "$LOG_FILE"
            refresh_runner_token "$runner"
        fi
        
        # Also check container age - refresh if older than 50 minutes
        CREATED=$(docker inspect "$runner" --format='{{.Created}}' 2>/dev/null)
        if [ -n "$CREATED" ]; then
            CREATED_TIMESTAMP=$(date -d "$CREATED" +%s 2>/dev/null || echo 0)
            CURRENT_TIMESTAMP=$(date +%s)
            AGE_MINUTES=$(( (CURRENT_TIMESTAMP - CREATED_TIMESTAMP) / 60 ))
            
            if [ "$AGE_MINUTES" -gt 50 ]; then
                echo "[$(date)] Runner $runner is $AGE_MINUTES minutes old, refreshing..." >> "$LOG_FILE"
                refresh_runner_token "$runner"
            fi
        fi
    done
    
    # Sleep for 45 minutes
    sleep 2700
done
REFRESHER

chmod +x ~/GitHub-RunnerHub/scripts/token-refresher-fixed.sh

# Kill old refresher
pkill -f "token-refresher.sh" 2>/dev/null

# Start new refresher
cd ~/GitHub-RunnerHub/scripts
nohup ./token-refresher-fixed.sh > /dev/null 2>&1 &
echo $! > ~/GitHub-RunnerHub/token-refresher.pid

echo ""
echo "✅ Token Refresher Fixed!"
echo "   PID: $(cat ~/GitHub-RunnerHub/token-refresher.pid)"
echo ""

# Force refresh all old runners now
echo "🔄 Refreshing all old runners immediately..."
RUNNERS=$(docker ps -a --format "{{.Names}}" | grep "^runnerhub-" | grep -v "backend\|frontend")
for runner in $RUNNERS; do
    CREATED=$(docker inspect "$runner" --format='{{.Created}}' 2>/dev/null)
    if [ -n "$CREATED" ]; then
        CREATED_TIMESTAMP=$(date -d "$CREATED" +%s 2>/dev/null || echo 0)
        CURRENT_TIMESTAMP=$(date +%s)
        AGE_MINUTES=$(( (CURRENT_TIMESTAMP - CREATED_TIMESTAMP) / 60 ))
        
        if [ "$AGE_MINUTES" -gt 50 ]; then
            echo "Refreshing $runner (age: $AGE_MINUTES minutes)..."
            ./token-refresher-fixed.sh &
            sleep 1
            pkill -f "token-refresher-fixed.sh"
            break
        fi
    fi
done

echo ""
echo "📊 Current runners:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep runnerhub | grep -v "backend\|frontend"
SCRIPT

# Deploy and execute
scp -i ~/.ssh/git-runner_rsa /tmp/fix-refresher.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/fix-refresher.sh && bash /tmp/fix-refresher.sh"