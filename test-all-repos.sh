#!/bin/bash

echo "🚀 Triggering workflows across multiple repositories..."
echo ""

# Function to trigger a workflow in a repo
trigger_workflow() {
    local REPO=$1
    echo "📦 Testing $REPO..."
    
    # Clone repo
    cd /tmp
    rm -rf "test-$REPO"
    if gh repo clone "anubissbe/$REPO" "test-$REPO" -- --depth=1 2>/dev/null; then
        cd "test-$REPO"
        
        # Make a test commit
        echo "RunnerHub test at $(date)" > "runnerhub-test-$(date +%s).txt"
        git add .
        git config user.name "anubissbe"
        git config user.email "bert@telkom.be"
        
        if git commit -m "test: RunnerHub multi-repo test - $REPO" 2>/dev/null; then
            if git push origin main 2>/dev/null || git push origin master 2>/dev/null; then
                echo "  ✅ Triggered workflow in $REPO"
            else
                echo "  ⚠️  Could not push to $REPO (may need PR)"
            fi
        else
            echo "  ℹ️  No changes to commit in $REPO"
        fi
    else
        echo "  ❌ Could not clone $REPO"
    fi
    
    cd /tmp
    rm -rf "test-$REPO"
}

# Test repositories with dedicated runners
REPOS=(
    "ProjectHub-Mcp"
    "JarvisAI"
    "GitHub-RunnerHub"
    "image-gen"
    "checkmarx-dashboards"
    "alicia-document-assistant"
    "ai-video-studio"
    "ai-music-studio"
    "claude-code-tools"
)

# Trigger workflows
for REPO in "${REPOS[@]}"; do
    trigger_workflow "$REPO" &
    sleep 2  # Stagger the triggers
done

# Wait for all background jobs
wait

echo ""
echo "⏳ Waiting for workflows to start..."
sleep 15

echo ""
echo "📊 Checking workflow status across repositories..."
echo ""

# Check status of each repo
for REPO in "${REPOS[@]}"; do
    echo "🔍 $REPO:"
    gh run list -R "anubissbe/$REPO" --limit 3 | grep -E "queued|in_progress" | head -3 || echo "  No active workflows"
    echo ""
done

echo "🏃 Checking runner status..."
echo ""

# Get runner busy status
BUSY_RUNNERS=$(curl -s http://192.168.1.16:8300/api/runners 2>/dev/null | jq -r '.[] | select(.busy == true) | .name' | sort)

if [ -n "$BUSY_RUNNERS" ]; then
    echo "Busy runners:"
    echo "$BUSY_RUNNERS" | sed 's/^/  - /'
else
    echo "Waiting for runners to pick up jobs..."
    sleep 10
    BUSY_RUNNERS=$(curl -s http://192.168.1.16:8300/api/runners 2>/dev/null | jq -r '.[] | select(.busy == true) | .name' | sort)
    if [ -n "$BUSY_RUNNERS" ]; then
        echo "Busy runners:"
        echo "$BUSY_RUNNERS" | sed 's/^/  - /'
    fi
fi

echo ""
echo "📈 Metrics:"
curl -s http://192.168.1.16:8300/api/metrics 2>/dev/null | jq -r '"  Total runners: \(.total_runners)\n  Online runners: \(.online_runners)\n  Busy runners: \(.busy_runners)\n  Utilization: \(.utilization_percentage)%"'

echo ""
echo "🌐 Monitor live at: http://192.168.1.16:8080"