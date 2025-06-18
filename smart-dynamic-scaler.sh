#!/bin/bash

echo "🚀 Smart Dynamic Scaler for GitHub RunnerHub"
echo "This scaler monitors ALL repositories and spawns runners where needed"

cat > /tmp/smart-scaler.sh << 'SCRIPT'
#!/bin/bash

cd ~/GitHub-RunnerHub

# Configuration
GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_USER="anubissbe"
MIN_FREE_PER_REPO=1    # Minimum free runners per repository
MAX_TOTAL_RUNNERS=25    # Maximum total runners across all repos
CHECK_INTERVAL=30       # Check every 30 seconds

# List of repositories to monitor
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

echo "🤖 Smart Dynamic Scaler Started"
echo "   Monitoring: ${#REPOS[@]} repositories"
echo "   Min free per repo: $MIN_FREE_PER_REPO"
echo "   Max total runners: $MAX_TOTAL_RUNNERS"
echo ""

# Function to get runner stats for a repo
get_repo_stats() {
    local REPO=$1
    local STATS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
        "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners" 2>/dev/null)
    
    local TOTAL=$(echo "$STATS" | python3 -c "import sys, json; d=json.load(sys.stdin); print(len(d.get('runners', [])))" 2>/dev/null || echo 0)
    local BUSY=$(echo "$STATS" | python3 -c "import sys, json; d=json.load(sys.stdin); print(sum(1 for r in d.get('runners', []) if r.get('busy', False)))" 2>/dev/null || echo 0)
    local FREE=$((TOTAL - BUSY))
    
    echo "$REPO $TOTAL $BUSY $FREE"
}

# Function to spawn runner for specific repo
spawn_runner_for_repo() {
    local REPO=$1
    local RUNNER_ID=$(openssl rand -hex 3)
    local RUNNER_NAME="runnerhub-$(echo $REPO | tr '[:upper:]' '[:lower:]' | tr -d '.-' | cut -c1-10)-$RUNNER_ID"
    
    echo "  🚀 Spawning $RUNNER_NAME for $REPO"
    
    # Get registration token
    local TOKEN=$(curl -s -X POST \
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
        
        if [ $? -eq 0 ]; then
            echo "    ✅ Success"
            return 0
        fi
    fi
    echo "    ❌ Failed"
    return 1
}

# Function to remove idle runner
remove_idle_runner() {
    local CONTAINER=$1
    echo "  🗑️  Removing idle runner: $CONTAINER"
    docker stop "$CONTAINER" > /dev/null 2>&1
    docker rm "$CONTAINER" > /dev/null 2>&1
}

# Main monitoring loop
while true; do
    echo "[$(date '+%H:%M:%S')] Checking all repositories..."
    
    TOTAL_RUNNERS=0
    TOTAL_BUSY=0
    REPOS_NEEDING_RUNNERS=()
    
    # Check each repository
    for REPO in "${REPOS[@]}"; do
        read REPO_NAME TOTAL BUSY FREE <<< $(get_repo_stats "$REPO")
        TOTAL_RUNNERS=$((TOTAL_RUNNERS + TOTAL))
        TOTAL_BUSY=$((TOTAL_BUSY + BUSY))
        
        printf "  %-30s Total: %2d, Busy: %2d, Free: %2d" "$REPO:" "$TOTAL" "$BUSY" "$FREE"
        
        # Check if repo needs more runners
        if [ $FREE -lt $MIN_FREE_PER_REPO ]; then
            echo " ⚠️  NEEDS RUNNERS"
            REPOS_NEEDING_RUNNERS+=("$REPO")
        else
            echo " ✅"
        fi
    done
    
    echo ""
    echo "  📊 Total across all repos: $TOTAL_RUNNERS runners ($TOTAL_BUSY busy)"
    echo ""
    
    # Spawn runners for repos that need them
    if [ ${#REPOS_NEEDING_RUNNERS[@]} -gt 0 ] && [ $TOTAL_RUNNERS -lt $MAX_TOTAL_RUNNERS ]; then
        echo "  📈 Scaling up for repos: ${REPOS_NEEDING_RUNNERS[*]}"
        for REPO in "${REPOS_NEEDING_RUNNERS[@]}"; do
            if [ $TOTAL_RUNNERS -lt $MAX_TOTAL_RUNNERS ]; then
                spawn_runner_for_repo "$REPO"
                TOTAL_RUNNERS=$((TOTAL_RUNNERS + 1))
                sleep 2
            else
                echo "  ⚠️  Reached max total runners limit ($MAX_TOTAL_RUNNERS)"
                break
            fi
        done
    fi
    
    # Scale down if we have too many idle runners
    if [ $TOTAL_BUSY -eq 0 ] && [ $TOTAL_RUNNERS -gt $((${#REPOS[@]} * MIN_FREE_PER_REPO)) ]; then
        echo "  📉 Too many idle runners, removing extras..."
        
        # Get dynamic runners sorted by age (oldest first)
        DYNAMIC_RUNNERS=$(docker ps --format "{{.Names}}" --filter "name=runnerhub-.*-[0-9a-f]{6}$" | head -5)
        
        for RUNNER in $DYNAMIC_RUNNERS; do
            if [ $TOTAL_RUNNERS -gt $((${#REPOS[@]} * MIN_FREE_PER_REPO)) ]; then
                remove_idle_runner "$RUNNER"
                TOTAL_RUNNERS=$((TOTAL_RUNNERS - 1))
                sleep 2
            else
                break
            fi
        done
    fi
    
    sleep $CHECK_INTERVAL
done
SCRIPT

chmod +x /tmp/smart-scaler.sh

# Deploy to server
scp -i ~/.ssh/git-runner_rsa /tmp/smart-scaler.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "bash /tmp/smart-scaler.sh"