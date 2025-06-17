#!/bin/bash

echo "🚀 Setting up self-hosted runners for all your repositories..."

# Get GitHub token from Vault
GITHUB_TOKEN=$(curl -s -H "X-Vault-Token: YOUR_VAULT_TOKEN_HERE" \
    http://192.168.1.24:8200/v1/secret/data/github | \
    jq -r '.data.data.GITHUB_TOKEN')

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Failed to retrieve GitHub token from Vault"
    exit 1
fi

GITHUB_USER="anubissbe"

# Get list of your original repositories (not forks)
echo "📋 Getting list of your repositories..."
REPOS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/user/repos?type=owner&per_page=100" | \
  jq -r '.[] | select(.fork == false) | .name' | sort)

echo "Found $(echo "$REPOS" | wc -l) repositories"
echo ""

# Create runner deployment script
cat > /tmp/deploy-all-runners.sh << 'EOF'
#!/bin/bash

GITHUB_TOKEN="$1"
GITHUB_USER="$2"
shift 2
REPOS=("$@")

echo "🏃 Creating runners for ${#REPOS[@]} repositories..."

# Calculate runners per repo (minimum 2 per repo, max 100 total)
TOTAL_RUNNERS=100
RUNNERS_PER_REPO=$((TOTAL_RUNNERS / ${#REPOS[@]}))
if [ $RUNNERS_PER_REPO -lt 2 ]; then
    RUNNERS_PER_REPO=2
fi
if [ $RUNNERS_PER_REPO -gt 5 ]; then
    RUNNERS_PER_REPO=5
fi

echo "Creating $RUNNERS_PER_REPO runners per repository"
echo ""

# Create runners for each repository
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
        
        # Small delay to avoid API rate limits
        sleep 1
    done
    
    echo ""
done

echo "✅ Created $RUNNER_COUNT runners total"
echo ""
echo "📊 Runner summary by repository:"
for REPO in "${REPOS[@]}"; do
    COUNT=$(docker ps --format "{{.Names}}" | grep "^${REPO,,}-runner-" | wc -l)
    if [ $COUNT -gt 0 ]; then
        echo "  - $REPO: $COUNT runners"
    fi
done

echo ""
echo "🔍 All running runners:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -- "-runner-" | head -20
RUNNER_TOTAL=$(docker ps --format "{{.Names}}" | grep -- "-runner-" | wc -l)
if [ $RUNNER_TOTAL -gt 20 ]; then
    echo "... and $((RUNNER_TOTAL - 20)) more"
fi
EOF

chmod +x /tmp/deploy-all-runners.sh

# Execute on remote server
echo "🚀 Deploying runners on remote server..."
scp /tmp/deploy-all-runners.sh remote-server:/tmp/

# Convert repos to array and pass to remote script
REPOS_ARRAY=($REPOS)
ssh remote-server "bash /tmp/deploy-all-runners.sh '$GITHUB_TOKEN' '$GITHUB_USER' ${REPOS_ARRAY[@]}"

echo ""
echo "📋 Repository runner URLs:"
echo "$REPOS" | while read repo; do
    echo "  - $repo: https://github.com/$GITHUB_USER/$repo/settings/actions/runners"
done