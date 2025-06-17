#!/bin/bash

echo "🧪 Testing Dynamic Scaling System..."
echo ""

# Function to trigger workflow
trigger_test() {
    local REPO=$1
    local BRANCH=${2:-main}
    
    cd /tmp
    rm -rf "scale-test-$REPO" 2>/dev/null
    
    if gh repo clone "anubissbe/$REPO" "scale-test-$REPO" -- --depth=1 2>/dev/null; then
        cd "scale-test-$REPO"
        echo "Dynamic scale test $(date)" > "scale-test-$(date +%s).txt"
        git add .
        git config user.name "anubissbe"
        git config user.email "bert@telkom.be"
        git commit -m "test: Dynamic scaling test - trigger workflows" 2>/dev/null
        git push origin $BRANCH 2>/dev/null || git push origin master 2>/dev/null
        cd ..
        rm -rf "scale-test-$REPO"
    fi
}

echo "📊 Initial State:"
INITIAL_COUNT=$(ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 'docker ps | grep runnerhub- | grep -v backend | grep -v frontend | wc -l')
echo "   Runners: $INITIAL_COUNT"
echo ""

echo "🚀 Phase 1: Triggering workflows in multiple repos..."
REPOS=("ProjectHub-Mcp" "JarvisAI" "GitHub-RunnerHub" "image-gen" "ai-video-studio" "ai-music-studio")

for REPO in "${REPOS[@]}"; do
    echo "   Triggering $REPO..."
    trigger_test "$REPO" &
done

wait
echo ""
echo "⏳ Waiting for workflows to start (30s)..."
sleep 30

echo ""
echo "📈 Checking if scaled UP:"
SCALED_COUNT=$(ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 'docker ps | grep runnerhub- | grep -v backend | grep -v frontend | wc -l')
echo "   Runners now: $SCALED_COUNT (was $INITIAL_COUNT)"

if [ $SCALED_COUNT -gt $INITIAL_COUNT ]; then
    echo "   ✅ Auto-scaling UP worked! Added $((SCALED_COUNT - INITIAL_COUNT)) runners"
else
    echo "   ⚠️  No scale up detected yet"
fi

echo ""
echo "📊 Current utilization:"
curl -s http://192.168.1.16:8300/api/metrics | jq -r '"   Busy: \(.busy_runners)/\(.total_runners) (\(.utilization_percentage)%)"'

echo ""
echo "⏳ Waiting for workflows to complete (2 min)..."
sleep 120

echo ""
echo "📉 Checking if scaled DOWN:"
FINAL_COUNT=$(ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 'docker ps | grep runnerhub- | grep -v backend | grep -v frontend | wc -l')
echo "   Runners now: $FINAL_COUNT"

echo ""
echo "📊 Auto-Scaler Log (last 10 lines):"
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "tail -10 ~/GitHub-RunnerHub/autoscaler.log"

echo ""
echo "✅ Dynamic Scaling Test Complete!"