#!/bin/bash

echo "🚀 Final complete deployment to fix repository name display..."

# Copy all updated files
echo "📦 Copying updated files..."
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/backend/server.js drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/backend/
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/frontend/src/App.tsx drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/frontend/src/

ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
cd /home/drwho/GitHub-RunnerHub

echo "🔨 Rebuilding backend..."
docker-compose build backend
docker-compose restart backend

echo "🔨 Rebuilding frontend..."
docker-compose build frontend  
docker-compose restart frontend

echo "⏳ Waiting for services..."
sleep 20

echo ""
echo "🔍 Testing public endpoint:"
curl -s http://localhost:8300/api/public/runners | python3 -c "
import json, sys
data = json.load(sys.stdin)
if data:
    print(f'✅ Found {len(data)} runners:')
    for r in data:
        print(f'   - {r.get(\"displayName\", r.get(\"name\"))} ({r.get(\"repository\", \"unknown\")})')
"

echo ""
echo "✅ Deployment complete!"
EOF

echo ""
echo "🎉 IMPORTANT: Clear your browser cache!"
echo ""
echo "1. Open http://192.168.1.16:8080/"
echo "2. Press Ctrl+F5 (or Cmd+Shift+R on Mac) to force refresh"
echo "3. You should now see repository names instead of Runner #01, #02"
echo ""
echo "Expected display:"
echo "   • ai-music-studio"
echo "   • mcp-enhanced-workspace"
echo "   • JarvisAI"
echo "   • ProjectHub-Mcp"
echo "   • GitHub-RunnerHub"
echo ""