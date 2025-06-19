#!/bin/bash
# Script to manually spawn dynamic runners for GitHub-RunnerHub

echo "🚀 Spawning dynamic runners for GitHub-RunnerHub..."

# SSH to the runner server and create dynamic runners
ssh git-runner << 'EOF'
cd /home/drwho/GitHub-RunnerHub

# Function to create a dynamic runner
create_dynamic_runner() {
    local timestamp=$(date +%s)
    local runner_name="runnerhub-dynamic-github-runnerhub-$timestamp"
    
    echo "Creating dynamic runner: $runner_name"
    
    docker run -d \
        --name "$runner_name" \
        --network runnerhub-network \
        -e RUNNER_NAME="$runner_name" \
        -e GITHUB_TOKEN="$GITHUB_TOKEN" \
        -e RUNNER_WORKDIR="/tmp/runner/work" \
        -e RUNNER_GROUP="default" \
        -e LABELS="self-hosted,docker,runnerhub,GitHub-RunnerHub,dynamic" \
        -e REPO_URL="https://github.com/anubissbe/GitHub-RunnerHub" \
        -e EPHEMERAL="true" \
        myoung34/github-runner:latest
}

# Get GitHub token from backend container
export GITHUB_TOKEN=$(docker exec runnerhub-backend printenv GITHUB_TOKEN)

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Error: Could not get GitHub token"
    exit 1
fi

# Create 3 dynamic runners
for i in {1..3}; do
    create_dynamic_runner
    sleep 5
done

echo "✅ Dynamic runners created. Checking status..."
docker ps --filter "name=runnerhub-dynamic-github-runnerhub"
EOF

echo "✅ Done! Dynamic runners should now be processing queued workflows."