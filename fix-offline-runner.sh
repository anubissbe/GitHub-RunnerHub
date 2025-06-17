#!/bin/bash

echo "🔧 Fixing offline runner and ensuring token refresh..."

cat > /tmp/fix-runner.sh << 'SCRIPT'
#!/bin/bash

echo "🔧 Fixing offline runner on 192.168.1.16..."

# Remove the stuck runner
docker rm -f runnerhub-auto-fixed 2>/dev/null || true

# Get new token and spawn replacement
GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"

# Get new registration token
TOKEN=$(curl -s -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners/registration-token" | \
    grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
    # Create new runner
    docker run -d \
        --name "runnerhub-1" \
        --restart unless-stopped \
        -e RUNNER_TOKEN="$TOKEN" \
        -e RUNNER_NAME="runnerhub-1" \
        -e RUNNER_WORKDIR="/tmp/runner/work" \
        -e LABELS="self-hosted,Linux,X64,docker,runnerhub" \
        -e REPO_URL="https://github.com/$GITHUB_ORG/$REPO" \
        -v /var/run/docker.sock:/var/run/docker.sock \
        myoung34/github-runner:latest
    
    echo "✅ Created new runner: runnerhub-1"
else
    echo "❌ Failed to get registration token"
fi

# Check if token refresher is running
if ! pgrep -f "token-refresher.sh" > /dev/null; then
    echo "🔄 Starting token refresher..."
    cd ~/GitHub-RunnerHub/scripts
    nohup ./token-refresher.sh > /dev/null 2>&1 &
    echo "✅ Token refresher started"
else
    echo "✅ Token refresher already running"
fi

# Show current runners
echo ""
echo "📊 Current runners:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep runnerhub | grep -v "backend\|frontend"
SCRIPT

# Deploy and execute
scp -i ~/.ssh/git-runner_rsa /tmp/fix-runner.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/fix-runner.sh && bash /tmp/fix-runner.sh"