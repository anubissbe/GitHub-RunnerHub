#!/bin/bash

echo "🔧 Final fix for GitHub RunnerHub naming and cleanup..."

echo "📁 Deploying updated files..."
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/backend/server.js drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/backend/
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/backend/runner-manager.js drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/backend/

echo "🛑 Removing ALL existing runners and auto-scaler containers..."
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
# Remove all runners (including auto-scaler ones)
docker ps --format '{{.Names}}' | grep -E '^runnerhub[_-]' | grep -v frontend | grep -v backend | xargs -r docker rm -f

# Rebuild and restart backend
cd /home/drwho/GitHub-RunnerHub
docker-compose build --no-cache backend
docker-compose restart backend

echo "⏳ Waiting for enhanced system to create properly named runners..."
sleep 90

echo "📊 Final runner status:"
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep runnerhub | grep -v frontend | grep -v backend

echo ""
echo "✅ Final naming fix completed!"
EOF

echo ""
echo "🎯 Should now see exactly 5 properly named runners:"
echo "  • runnerhub_ai_music_studio → ai-music-studio repo"
echo "  • runnerhub_mcp_enhanced_workspace → mcp-enhanced-workspace repo"
echo "  • runnerhub_jarvisai → JarvisAI repo"
echo "  • runnerhub_projecthub_mcp → ProjectHub-Mcp repo"
echo "  • runnerhub_github_runnerhub → GitHub-RunnerHub repo"
echo ""
echo "🚫 No more auto-scaler runners with random names!"
echo ""