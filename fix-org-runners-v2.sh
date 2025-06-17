#!/bin/bash

echo "🔧 Fixing organization-level runners..."

# Get GitHub token from Vault
GITHUB_TOKEN=$(curl -s -H "X-Vault-Token: YOUR_VAULT_TOKEN_HERE" \
    http://192.168.1.24:8200/v1/secret/data/github | \
    jq -r '.data.data.GITHUB_TOKEN')

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Failed to retrieve GitHub token from Vault"
    exit 1
fi

GITHUB_ORG="anubissbe"

echo "🧹 Removing failed runners..."
ssh remote-server "docker ps -a --format '{{.Names}}' | grep '^runnerhub-' | xargs -r docker rm -f"

echo "📝 Creating proper organization runner script..."
cat > /tmp/spawn-org-runners-fixed.sh << EOF
#!/bin/bash

# Spawn organization-level runners with correct configuration
for i in {1..5}; do
    RUNNER_ID=\$(openssl rand -hex 3)
    RUNNER_NAME="runnerhub-\$RUNNER_ID"
    
    echo "Creating runner \$i/5: \$RUNNER_NAME"
    
    # Get org registration token
    TOKEN=\$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/orgs/$GITHUB_ORG/actions/runners/registration-token" | \
        jq -r '.token')
    
    if [ -z "\$TOKEN" ] || [ "\$TOKEN" = "null" ]; then
        echo "Failed to get registration token"
        continue
    fi
    
    echo "Got token: \${TOKEN:0:10}..."
    
    # Create runner container with correct ORG_RUNNER configuration
    docker run -d \
        --name "\$RUNNER_NAME" \
        --restart unless-stopped \
        -e RUNNER_TOKEN="\$TOKEN" \
        -e RUNNER_NAME="\$RUNNER_NAME" \
        -e RUNNER_WORKDIR="/tmp/runner/work" \
        -e RUNNER_GROUP="default" \
        -e LABELS="self-hosted,Linux,X64,docker,runnerhub" \
        -e ORG_RUNNER="true" \
        -e ORG_NAME="$GITHUB_ORG" \
        -e EPHEMERAL="false" \
        -v /var/run/docker.sock:/var/run/docker.sock \
        --security-opt label:disable \
        myoung34/github-runner:latest
    
    sleep 5
done

echo ""
echo "✅ Created organization runners"
echo ""
echo "Checking runner status..."
sleep 10
docker ps --format "table {{.Names}}\t{{.Status}}" | grep runnerhub- || echo "No runners found"
EOF

chmod +x /tmp/spawn-org-runners-fixed.sh

# Execute on remote server
echo "🚀 Executing on RunnerHub server..."
scp /tmp/spawn-org-runners-fixed.sh remote-server:/tmp/
ssh remote-server "bash /tmp/spawn-org-runners-fixed.sh"

echo ""
echo "📊 Runner locations:"
echo "   Organization: https://github.com/organizations/$GITHUB_ORG/settings/actions/runners"
echo "   ProjectHub-Mcp: https://github.com/anubissbe/ProjectHub-Mcp/settings/actions/runners"