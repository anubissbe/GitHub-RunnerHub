#!/bin/bash

# Quick fix to convert RunnerHub to organization-level runners

echo "🔧 Converting RunnerHub to organization-level runners..."

# Get GitHub token from Vault
GITHUB_TOKEN=$(curl -s -H "X-Vault-Token: YOUR_VAULT_TOKEN_HERE" \
    http://192.168.1.24:8200/v1/secret/data/github | \
    jq -r '.data.data.GITHUB_TOKEN')

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Failed to retrieve GitHub token from Vault"
    exit 1
fi

GITHUB_ORG="anubissbe"

echo "📝 Creating runner spawn script..."
cat > /tmp/spawn-org-runners.sh << EOF
#!/bin/bash

# Spawn organization-level runners
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
    
    if [ -z "\$TOKEN" ]; then
        echo "Failed to get registration token"
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
        -e LABELS="self-hosted,Linux,X64,docker,runnerhub" \
        -e ORG_RUNNER="true" \
        -e ORG_NAME="$GITHUB_ORG" \
        -e RUNNER_SCOPE="org" \
        -e EPHEMERAL="false" \
        -v /var/run/docker.sock:/var/run/docker.sock \
        --security-opt label:disable \
        myoung34/github-runner:latest
    
    sleep 3
done

echo ""
echo "✅ Created 5 organization runners"
echo ""
echo "Current runners:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep runnerhub-
EOF

chmod +x /tmp/spawn-org-runners.sh

# Execute on remote server
echo "🚀 Executing on RunnerHub server..."
scp /tmp/spawn-org-runners.sh remote-server:/tmp/
ssh remote-server "bash /tmp/spawn-org-runners.sh"

echo ""
echo "📊 To check runner status:"
echo "   Visit: https://github.com/organizations/$GITHUB_ORG/settings/actions/runners"
echo "   Or: ssh remote-server 'docker ps | grep runnerhub-'"