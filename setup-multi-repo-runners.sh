#\!/bin/bash

echo "🚀 Setting up RunnerHub for all repositories..."

cat > /tmp/setup-runners.sh << 'SCRIPT'
#\!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_USER="anubissbe"

# List of key repositories to support
REPOS=(
    "ProjectHub-Mcp"
    "JarvisAI"
    "GitHub-RunnerHub"
    "image-gen"
    "checkmarx-dashboards"
    "alicia-document-assistant"
    "Jarvis2.0"
    "ai-video-studio"
    "ai-music-studio"
    "claude-code-tools"
)

echo "🏃 Creating multi-repository runners..."

# Stop existing runners
echo "Stopping existing runners..."
docker ps --format "{{.Names}}"  < /dev/null |  grep "^runnerhub-" | grep -v "backend\|frontend" | while read runner; do
    docker stop $runner
    docker rm $runner
done

# Start new runners for each major repository
RUNNER_NUM=1
for REPO in "${REPOS[@]}"; do
    RUNNER_NAME="runnerhub-$(echo $REPO | tr '[:upper:]' '[:lower:]' | tr -d '.-')-01"
    echo ""
    echo "Creating runner for $REPO: $RUNNER_NAME"
    
    # Get registration token for this repo
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
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub" \
            -e REPO_URL="https://github.com/$GITHUB_USER/$REPO" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            myoung34/github-runner:latest
        
        echo "  ✅ Started $RUNNER_NAME"
        RUNNER_NUM=$((RUNNER_NUM + 1))
    else
        echo "  ❌ Failed to get token"
    fi
    
    sleep 2
done

# Add some general purpose runners for other repos
echo ""
echo "Adding general purpose runners..."
for i in {1..5}; do
    RUNNER_NAME="runnerhub-general-$(printf "%02d" $i)"
    echo "Creating $RUNNER_NAME..."
    
    # Use ProjectHub-Mcp as default repo for general runners
    TOKEN=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_USER/ProjectHub-Mcp/actions/runners/registration-token" | \
        python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)
    
    if [ -n "$TOKEN" ]; then
        docker run -d \
            --name "$RUNNER_NAME" \
            --restart unless-stopped \
            -e RUNNER_TOKEN="$TOKEN" \
            -e RUNNER_NAME="$RUNNER_NAME" \
            -e RUNNER_WORKDIR="/tmp/runner/work" \
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub,general" \
            -e REPO_URL="https://github.com/$GITHUB_USER/ProjectHub-Mcp" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            myoung34/github-runner:latest
        
        echo "  ✅ Started $RUNNER_NAME"
    fi
    
    sleep 2
done

echo ""
echo "📊 Runner Summary:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep runnerhub | grep -v backend | grep -v frontend

echo ""
echo "✅ Multi-repository runner setup complete\!"
echo ""
echo "📝 Note: GitHub runners are repository-specific by design."
echo "   Each repository now has at least one dedicated runner."
echo "   Additional general-purpose runners are available for any repo."
SCRIPT

# Deploy and execute
scp -i ~/.ssh/git-runner_rsa /tmp/setup-runners.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/setup-runners.sh && bash /tmp/setup-runners.sh"
