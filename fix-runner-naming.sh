#!/bin/bash

echo "🔧 Fixing GitHub RunnerHub naming and removing extra runners..."

# Deploy updated runner manager
echo "📁 Deploying updated runner manager..."
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/backend/runner-manager.js drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/backend/

# Clean up and recreate runners with proper naming
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
echo "🛑 Stopping all current runners for proper recreation..."

# Remove all existing runners (both correctly and incorrectly named)
docker ps --format '{{.Names}}' | grep -E '^runnerhub[_-]' | grep -v frontend | grep -v backend | xargs -r docker rm -f

echo "🔄 Restarting backend to recreate runners with proper naming..."
cd /home/drwho/GitHub-RunnerHub
docker-compose restart backend

echo "⏳ Waiting for backend to recreate all runners..."
sleep 60

echo "📊 Current runner status:"
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep runnerhub | grep -v frontend | grep -v backend

echo ""
echo "✅ Runner naming fix completed!"
EOF

echo ""
echo "🎯 Expected result: 5 properly named runners:"
echo "  • runnerhub_ai_music_studio"
echo "  • runnerhub_mcp_enhanced_workspace"
echo "  • runnerhub_jarvisai"
echo "  • runnerhub_projecthub_mcp"
echo "  • runnerhub_github_runnerhub"
echo ""