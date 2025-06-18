#!/bin/bash

echo "🧪 Testing RunnerHub Auto-Scaling System"
echo "========================================"
echo ""

# Test configuration
REPO="GitHub-RunnerHub"
GITHUB_USER="anubissbe"

echo "📋 Test Plan:"
echo "1. Check initial state (1 dedicated runner per repo)"
echo "2. Trigger multiple workflows to force scaling"
echo "3. Monitor dynamic runner creation"
echo "4. Wait for workflows to complete"
echo "5. Verify dynamic runners are removed after 5 minutes"
echo ""

# Function to check runner status
check_runners() {
    echo "📊 Current Runner Status:"
    echo "Docker Containers:"
    ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "docker ps --format 'table {{.Names}}\t{{.Status}}' | grep runnerhub | grep -v backend | grep -v frontend"
    echo ""
    
    echo "Auto-scaler Log (last 5 entries):"
    ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "tail -5 ~/GitHub-RunnerHub/optimal-autoscaler.log"
    echo ""
}

# Function to trigger workflow
trigger_workflow() {
    echo "🚀 Triggering workflow..."
    cd /opt/projects/projects/GitHub-RunnerHub
    
    # Create a test file change
    echo "# Auto-scaling test $(date)" >> test-scaling.md
    git add test-scaling.md
    git commit -m "test: Auto-scaling test $(date +%s)"
    git push origin master
}

echo "=== TEST 1: Initial State ==="
check_runners

echo "=== TEST 2: Trigger Multiple Workflows ==="
echo "Triggering 3 workflows in rapid succession..."

for i in 1 2 3; do
    echo "Trigger $i:"
    trigger_workflow
    sleep 2
done

echo ""
echo "⏱️  Waiting 45 seconds for auto-scaler to respond..."
sleep 45

echo "=== TEST 3: Check Scaling Response ==="
check_runners

echo "=== TEST 4: Monitor Workflow Progress ==="
echo "Checking GitHub Actions status..."
gh run list --repo $GITHUB_USER/$REPO --limit 5

echo ""
echo "⏱️  Waiting for workflows to complete (2 minutes)..."
sleep 120

echo "=== TEST 5: Check Post-Workflow State ==="
check_runners

echo "=== TEST 6: Verify Auto-Cleanup ==="
echo "⏱️  Waiting 5 minutes for idle runner cleanup..."
echo "Check 1 (immediate):"
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "docker ps --format '{{.Names}}' | grep -c 'runnerhub-dyn-' || echo 0"

sleep 300  # 5 minutes

echo "Check 2 (after 5 minutes):"
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "docker ps --format '{{.Names}}' | grep -c 'runnerhub-dyn-' || echo 0"

echo ""
echo "=== Final State ==="
check_runners

echo ""
echo "✅ Auto-Scaling Test Complete!"
echo ""
echo "Summary:"
echo "- Dedicated runners should remain constant"
echo "- Dynamic runners should spawn when busy"
echo "- Dynamic runners should be removed after 5 min idle"
echo "- Check the dashboard at http://192.168.1.16:8080"