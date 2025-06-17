#!/bin/bash

echo "🔄 Setting up Token Auto-Refresh System..."

cat > /tmp/token-refresher.sh << 'REFRESHER'
#!/bin/bash

echo "📦 Installing Token Refresher on 192.168.1.16..."

cd ~
mkdir -p GitHub-RunnerHub/scripts

# Create the token refresher script
cat > GitHub-RunnerHub/scripts/token-refresher.sh << 'SCRIPT'
#!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"
LOG_FILE="$HOME/GitHub-RunnerHub/token-refresher.log"

echo "[$(date)] Token Refresher Started" >> "$LOG_FILE"

refresh_runner_token() {
    local container_name=$1
    echo "[$(date)] Refreshing token for $container_name" >> "$LOG_FILE"
    
    # Get new registration token
    TOKEN=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners/registration-token" | \
        grep -o '"token":"[^"]*' | cut -d'"' -f4)
    
    if [ -n "$TOKEN" ]; then
        # Stop the container
        docker stop "$container_name" 2>/dev/null
        
        # Get container details
        RUNNER_NAME=$(docker inspect "$container_name" 2>/dev/null | grep -o '"RUNNER_NAME=[^"]*' | cut -d= -f2)
        
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
        echo "[$(date)] ❌ Failed to get new token for $container_name" >> "$LOG_FILE"
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
SCRIPT

chmod +x GitHub-RunnerHub/scripts/token-refresher.sh

# Create systemd-style service script
cat > GitHub-RunnerHub/scripts/start-token-refresher.sh << 'SERVICE'
#!/bin/bash
# Kill any existing token refresher
pkill -f "token-refresher.sh" 2>/dev/null

# Start new instance
cd ~/GitHub-RunnerHub/scripts
nohup ./token-refresher.sh > /dev/null 2>&1 &
echo $! > ~/GitHub-RunnerHub/token-refresher.pid

echo "✅ Token Refresher started with PID: $(cat ~/GitHub-RunnerHub/token-refresher.pid)"
SERVICE

chmod +x GitHub-RunnerHub/scripts/start-token-refresher.sh

# Start the token refresher
~/GitHub-RunnerHub/scripts/start-token-refresher.sh

# Also create a cron job for system reboots
(crontab -l 2>/dev/null; echo "@reboot $HOME/GitHub-RunnerHub/scripts/start-token-refresher.sh") | crontab -

echo ""
echo "✅ Token Auto-Refresh System Installed!"
echo ""
echo "🔄 How it works:"
echo "   - Checks all runners every 45 minutes"
echo "   - Refreshes tokens BEFORE they expire (at 50 minutes)"
echo "   - Automatically fixes runners in restart loops"
echo "   - Restarts on system reboot"
echo ""
echo "📊 Monitoring:"
echo "   - Log file: ~/GitHub-RunnerHub/token-refresher.log"
echo "   - PID file: ~/GitHub-RunnerHub/token-refresher.pid"
echo ""
echo "🚀 Your runners will now stay online indefinitely!"
REFRESHER

# Deploy to 192.168.1.16
scp -i ~/.ssh/git-runner_rsa /tmp/token-refresher.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/token-refresher.sh && bash /tmp/token-refresher.sh"