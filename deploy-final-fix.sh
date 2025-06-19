#!/bin/bash

echo "🎯 Final deployment to show repository names in dashboard..."

# Deploy backend with public runners endpoint
echo "📦 Deploying backend..."
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/backend/server.js drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/backend/

# Deploy frontend with public endpoint support
echo "📦 Deploying frontend..."
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/frontend/src/App.tsx drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/frontend/src/

ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
cd /home/drwho/GitHub-RunnerHub

echo "🔄 Restarting backend..."
docker-compose restart backend

echo "🔨 Rebuilding frontend..."
docker-compose build frontend
docker-compose restart frontend

echo "⏳ Waiting for services to be ready..."
sleep 15

echo ""
echo "🔍 Testing public runners endpoint:"
curl -s http://localhost:8300/api/public/runners | jq '.[0] | {name, displayName, repository, status}'

echo ""
echo "✅ Deployment complete!"
EOF

echo ""
echo "🎉 The dashboard should now show repository names:"
echo "   • ai-music-studio"
echo "   • mcp-enhanced-workspace"
echo "   • JarvisAI"
echo "   • ProjectHub-Mcp"
echo "   • GitHub-RunnerHub"
echo ""
echo "🌐 Dashboard: http://192.168.1.16:8080/"
echo ""