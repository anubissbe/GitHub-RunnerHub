#!/bin/bash

echo "🎨 Deploying frontend fix to show repository names..."

# Copy updated frontend file
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/frontend/src/components/RunnerCard.tsx drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/frontend/src/components/

# Rebuild frontend
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
cd /home/drwho/GitHub-RunnerHub

echo "🔨 Rebuilding frontend with repository names..."
docker-compose build --no-cache frontend
docker-compose restart frontend

echo "⏳ Waiting for frontend to be ready..."
sleep 10

echo ""
echo "✅ Frontend updated!"
echo ""
echo "🎯 The dashboard should now show:"
echo "  • Repository names instead of generic 'Runner #X'"
echo "  • All 5 runners with their proper repository assignments"
echo ""
echo "📊 Current runners:"
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep runnerhub | grep -v frontend | grep -v backend
EOF

echo ""
echo "🌐 Dashboard URL: http://192.168.1.16:8080"
echo ""
echo "✨ You should now see:"
echo "  • ProjectHub-Mcp"
echo "  • GitHub-RunnerHub"  
echo "  • JarvisAI"
echo "  • mcp-enhanced-workspace"
echo "  • ai-music-studio"
echo ""