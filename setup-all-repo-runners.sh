#!/bin/bash

echo "🔧 Setting up self-hosted runners for all repositories..."

# Get GitHub token from Vault
GITHUB_TOKEN=$(curl -s -H "X-Vault-Token: YOUR_VAULT_TOKEN_HERE" \
    http://192.168.1.24:8200/v1/secret/data/github | \
    jq -r '.data.data.GITHUB_TOKEN')

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Failed to retrieve GitHub token from Vault"
    exit 1
fi

GITHUB_ORG="anubissbe"

# List of your key repositories
REPOS=(
    "ProjectHub-Mcp"
    "GitHub-RunnerHub"
    "JarvisAI"
    "threat-modeling-platform"
    "ai-video-studio"
    "mcp-enhanced-workspace"
)

echo "📝 Creating multi-repo runner script..."
cat > /tmp/spawn-multi-repo-runners.sh << EOF
#!/bin/bash

# Configuration
RUNNERS_PER_REPO=2
TOTAL_RUNNERS=20

echo "🏃 Creating shared runner pool for multiple repositories..."

# Remove existing projecthub runners first
docker ps -a --format '{{.Names}}' | grep '^projecthub-runner-' | xargs -r docker rm -f

# Create a pool of runners that can handle jobs from any repository
for i in \$(seq 1 \$TOTAL_RUNNERS); do
    RUNNER_ID=\$(openssl rand -hex 3)
    RUNNER_NAME="runnerhub-shared-\$RUNNER_ID"
    
    # Determine which repository this runner will be registered to
    # We'll distribute them across repositories
    REPO_INDEX=\$(( (i - 1) % ${#REPOS[@]} ))
    REPO="${REPOS[\$REPO_INDEX]}"
    
    echo "Creating runner \$i/\$TOTAL_RUNNERS: \$RUNNER_NAME for \$REPO"
    
    # Get repository registration token
    TOKEN=\$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_ORG/\$REPO/actions/runners/registration-token" | \
        jq -r '.token')
    
    if [ -z "\$TOKEN" ] || [ "\$TOKEN" = "null" ]; then
        echo "Failed to get registration token for \$REPO"
        continue
    fi
    
    # Create runner container
    docker run -d \
        --name "\$RUNNER_NAME" \
        --restart unless-stopped \
        -e RUNNER_TOKEN="\$TOKEN" \
        -e RUNNER_NAME="\$RUNNER_NAME" \
        -e RUNNER_WORKDIR="/tmp/runner/work" \
        -e RUNNER_GROUP="default" \
        -e LABELS="self-hosted,Linux,X64,docker,runnerhub,shared" \
        -e REPO_URL="https://github.com/$GITHUB_ORG/\$REPO" \
        -v /var/run/docker.sock:/var/run/docker.sock \
        --security-opt label:disable \
        myoung34/github-runner:latest
    
    sleep 2
done

echo ""
echo "✅ Created shared runner pool"
echo ""
echo "Runner distribution:"
docker ps --format "{{.Names}}" | grep runnerhub-shared- | wc -l
echo ""
echo "Runner status:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep runnerhub-shared-
EOF

# Make array available in remote script
REPOS_STRING=$(printf "'%s' " "${REPOS[@]}")
sed -i "s/REPOS=.*/REPOS=($REPOS_STRING)/" /tmp/spawn-multi-repo-runners.sh

chmod +x /tmp/spawn-multi-repo-runners.sh

# Execute on remote server
echo "🚀 Executing on RunnerHub server..."
scp /tmp/spawn-multi-repo-runners.sh remote-server:/tmp/
ssh remote-server "bash /tmp/spawn-multi-repo-runners.sh"

echo ""
echo "📊 Runners have been distributed across repositories:"
for repo in "${REPOS[@]}"; do
    echo "   - $repo: https://github.com/$GITHUB_ORG/$repo/settings/actions/runners"
done
echo ""
echo "💡 Note: Each repository now has dedicated runners with the 'runnerhub' label"