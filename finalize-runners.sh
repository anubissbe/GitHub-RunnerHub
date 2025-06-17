#!/bin/bash

echo "🔧 Finalizing runner setup..."

# Get GitHub token from Vault
GITHUB_TOKEN=$(curl -s -H "X-Vault-Token: YOUR_VAULT_TOKEN_HERE" \
    http://192.168.1.24:8200/v1/secret/data/github | \
    jq -r '.data.data.GITHUB_TOKEN')

GITHUB_USER="anubissbe"

# Check which repos still need runners
MISSING_REPOS=(
    "image-gen"
    "mcp-enhanced-workspace"
    "mcp-human-writing-style"
    "mcp-human-writing-style-reddit"
    "mcp-jarvis"
    "scripts"
    "threat-modeling-platform"
)

# Create final deployment script
cat > /tmp/finalize-runners.sh << 'EOF'
#!/bin/bash

GITHUB_TOKEN="$1"
GITHUB_USER="$2"
shift 2
REPOS=("$@")

echo "🏃 Finalizing runner setup..."

# Check current runner count for each repo
for REPO in "${REPOS[@]}"; do
    CURRENT_COUNT=$(docker ps --format "{{.Names}}" | grep "^${REPO,,}-runner-" | wc -l)
    NEEDED=$((5 - CURRENT_COUNT))
    
    if [ $NEEDED -gt 0 ]; then
        echo "📦 Creating $NEEDED more runners for $REPO..."
        
        for i in $(seq 1 $NEEDED); do
            RUNNER_ID=$(openssl rand -hex 3)
            RUNNER_NAME="${REPO,,}-runner-${RUNNER_ID}"
            RUNNER_NAME="${RUNNER_NAME:0:40}"
            
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
                echo "  ✅ Created: $RUNNER_NAME"
            fi
            
            sleep 1
        done
    else
        echo "✅ $REPO already has $CURRENT_COUNT runners"
    fi
done

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "                    RUNNER DEPLOYMENT COMPLETE                   "
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "📊 Final Runner Distribution:"
echo ""

# Get all repos with runners
ALL_REPOS=$(docker ps --format "{{.Names}}" | grep -- "-runner-" | sed 's/-runner-.*//' | sort -u)

TOTAL=0
for REPO in $ALL_REPOS; do
    COUNT=$(docker ps --format "{{.Names}}" | grep "^${REPO}-runner-" | wc -l)
    printf "  %-35s %2d runners\n" "$REPO:" "$COUNT"
    TOTAL=$((TOTAL + COUNT))
done

echo ""
echo "📈 Total runners deployed: $TOTAL"
echo ""
echo "🔗 Repository Runner URLs:"
echo ""
for REPO in $ALL_REPOS; do
    # Convert back to proper repo name
    PROPER_NAME=$(echo "$REPO" | sed 's/jarvis2\.0/Jarvis2.0/; s/jarvisai/JarvisAI/; s/projecthub-mcp/ProjectHub-Mcp/; s/wan2gpextended/Wan2GPExtended/')
    if [ "$REPO" != "$PROPER_NAME" ]; then
        echo "  $PROPER_NAME:"
        echo "    https://github.com/$GITHUB_USER/$PROPER_NAME/settings/actions/runners"
    else
        echo "  $REPO:"
        echo "    https://github.com/$GITHUB_USER/$REPO/settings/actions/runners"
    fi
done

echo ""
echo "✅ All repositories now have self-hosted runners with label: runnerhub"
echo "📱 Monitor at: http://192.168.1.16:8080"
EOF

chmod +x /tmp/finalize-runners.sh

# Execute on remote server
echo "🚀 Finalizing runner deployment..."
scp /tmp/finalize-runners.sh remote-server:/tmp/
ssh remote-server "bash /tmp/finalize-runners.sh '$GITHUB_TOKEN' '$GITHUB_USER' ${MISSING_REPOS[@]}"