#!/bin/bash

echo "🔧 Setting up runners for ProjectHub-Mcp repository..."

# Get GitHub token from Vault
GITHUB_TOKEN=$(curl -s -H "X-Vault-Token: YOUR_VAULT_TOKEN_HERE" \
    http://192.168.1.24:8200/v1/secret/data/github | \
    jq -r '.data.data.GITHUB_TOKEN')

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Failed to retrieve GitHub token from Vault"
    exit 1
fi

GITHUB_ORG="anubissbe"
GITHUB_REPO="ProjectHub-Mcp"

echo "📝 Creating repository runner script..."
cat > /tmp/spawn-repo-runners.sh << EOF
#!/bin/bash

# Remove any existing runners
echo "🧹 Cleaning up existing runners..."
docker ps -a --format '{{.Names}}' | grep '^projecthub-runner-' | xargs -r docker rm -f

# Spawn repository-specific runners
for i in {1..5}; do
    RUNNER_ID=\$(openssl rand -hex 3)
    RUNNER_NAME="projecthub-runner-\$RUNNER_ID"
    
    echo "Creating runner \$i/5: \$RUNNER_NAME"
    
    # Get repository registration token
    TOKEN=\$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$GITHUB_ORG/$GITHUB_REPO/actions/runners/registration-token" | \
        jq -r '.token')
    
    if [ -z "\$TOKEN" ] || [ "\$TOKEN" = "null" ]; then
        echo "Failed to get registration token"
        continue
    fi
    
    echo "Got token: \${TOKEN:0:10}..."
    
    # Create runner container for repository
    docker run -d \
        --name "\$RUNNER_NAME" \
        --restart unless-stopped \
        -e RUNNER_TOKEN="\$TOKEN" \
        -e RUNNER_NAME="\$RUNNER_NAME" \
        -e RUNNER_WORKDIR="/tmp/runner/work" \
        -e RUNNER_GROUP="default" \
        -e LABELS="self-hosted,Linux,X64,docker,runnerhub" \
        -e REPO_URL="https://github.com/$GITHUB_ORG/$GITHUB_REPO" \
        -v /var/run/docker.sock:/var/run/docker.sock \
        --security-opt label:disable \
        myoung34/github-runner:latest
    
    sleep 5
done

echo ""
echo "✅ Created repository runners for $GITHUB_REPO"
echo ""
echo "Checking runner status..."
sleep 10
docker ps --format "table {{.Names}}\t{{.Status}}" | grep projecthub-runner-
EOF

chmod +x /tmp/spawn-repo-runners.sh

# Execute on remote server
echo "🚀 Executing on RunnerHub server..."
scp /tmp/spawn-repo-runners.sh remote-server:/tmp/
ssh remote-server "bash /tmp/spawn-repo-runners.sh"

echo ""
echo "📊 Check runners at:"
echo "   https://github.com/$GITHUB_ORG/$GITHUB_REPO/settings/actions/runners"
echo ""
echo "To create runners for other repositories, update GITHUB_REPO in this script"