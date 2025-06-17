#!/bin/bash

echo "🔧 Fixing workflow labels to match RunnerHub runners..."

cd /opt/projects/projects/ProjectHub-Mcp

# Find all workflow files and update the runner labels
for workflow in .github/workflows/*.yml; do
    echo "Updating $workflow..."
    
    # Replace the old labels with new ones
    sed -i 's/\[self-hosted, docker, git-runner\]/[self-hosted, docker, runnerhub]/g' "$workflow"
    sed -i 's/\[self-hosted, Linux, X64, docker, git-runner\]/[self-hosted, docker, runnerhub]/g' "$workflow"
    sed -i 's/runs-on: self-hosted/runs-on: [self-hosted, docker, runnerhub]/g' "$workflow"
done

echo ""
echo "📋 Updated workflows:"
grep -l "runnerhub" .github/workflows/*.yml

echo ""
echo "🔍 Checking changes:"
git diff --name-only .github/workflows/

echo ""
echo "✅ Workflow labels fixed! Committing changes..."

git add .github/workflows/
git commit -m "fix: Update workflow labels to use runnerhub runners

- Changed from 'git-runner' to 'runnerhub' label
- Ensures workflows run on the new RunnerHub infrastructure
- Fixes issue where runners were ready but not picking up jobs"

git push origin main

echo ""
echo "🚀 Changes pushed! Workflows should now use RunnerHub runners."