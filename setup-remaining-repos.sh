#!/bin/bash

echo "🚀 Setting up runners for remaining repositories..."

# Get GitHub token from Vault
GITHUB_TOKEN=$(curl -s -H "X-Vault-Token: YOUR_VAULT_TOKEN_HERE" \
    http://192.168.1.24:8200/v1/secret/data/github | \
    jq -r '.data.data.GITHUB_TOKEN')

GITHUB_USER="anubissbe"

# Remaining repositories that need runners
REMAINING_REPOS=(
    "checkmarx-dashboards"
    "claude-code-tools"
    "cline-documentation"
    "image-gen"
    "mcp-enhanced-workspace"
    "mcp-human-writing-style"
    "mcp-human-writing-style-reddit"
    "mcp-jarvis"
    "scripts"
    "threat-modeling-platform"
)

# Create deployment script
cat > /tmp/deploy-remaining-runners.sh << 'EOF'
#!/bin/bash

GITHUB_TOKEN="$1"
GITHUB_USER="$2"
shift 2
REPOS=("$@")

echo "🏃 Creating runners for ${#REPOS[@]} remaining repositories..."

RUNNERS_PER_REPO=5
RUNNER_COUNT=0

for REPO in "${REPOS[@]}"; do
    echo "📦 Setting up runners for $REPO..."
    
    for i in $(seq 1 $RUNNERS_PER_REPO); do
        RUNNER_ID=$(openssl rand -hex 3)
        RUNNER_NAME="${REPO,,}-runner-${RUNNER_ID}"
        RUNNER_NAME="${RUNNER_NAME:0:40}" # Limit name length
        
        # Get repository registration token
        TOKEN=$(curl -s -X POST \
            -H "Authorization: token $GITHUB_TOKEN" \
            -H "Accept: application/vnd.github.v3+json" \
            "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runners/registration-token" | \
            jq -r '.token')
        
        if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
            echo "  ❌ Failed to get token for $REPO"
            continue
        fi
        
        # Create runner container
        docker run -d \
            --name "$RUNNER_NAME" \
            --restart unless-stopped \
            -e RUNNER_TOKEN="$TOKEN" \
            -e RUNNER_NAME="$RUNNER_NAME" \
            -e RUNNER_WORKDIR="/tmp/runner/work" \
            -e RUNNER_GROUP="default" \
            -e LABELS="self-hosted,Linux,X64,docker,runnerhub" \
            -e REPO_URL="https://github.com/$GITHUB_USER/$REPO" \
            -v /var/run/docker.sock:/var/run/docker.sock \
            --security-opt label:disable \
            myoung34/github-runner:latest > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            echo "  ✅ Created runner: $RUNNER_NAME"
            RUNNER_COUNT=$((RUNNER_COUNT + 1))
        else
            echo "  ❌ Failed to create runner: $RUNNER_NAME"
        fi
        
        sleep 1
    done
    
    echo ""
done

echo "✅ Created $RUNNER_COUNT runners for remaining repositories"
echo ""
echo "📊 Total runners now running:"
docker ps --format "{{.Names}}" | grep -- "-runner-" | wc -l
EOF

chmod +x /tmp/deploy-remaining-runners.sh

# Execute on remote server
echo "🚀 Deploying runners for remaining repositories..."
scp /tmp/deploy-remaining-runners.sh remote-server:/tmp/
ssh remote-server "bash /tmp/deploy-remaining-runners.sh '$GITHUB_TOKEN' '$GITHUB_USER' ${REMAINING_REPOS[@]}"