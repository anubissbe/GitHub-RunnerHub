#!/bin/bash

echo "🚀 Deploying public dashboard that works without authentication..."

# Deploy updated frontend
echo "📦 Deploying frontend with public access support..."
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/frontend/src/App.tsx drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/frontend/src/

ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
cd /home/drwho/GitHub-RunnerHub

echo "🔨 Rebuilding frontend..."
docker-compose build frontend
docker-compose restart frontend

echo "⏳ Waiting for frontend to be ready..."
sleep 15

echo ""
echo "🔍 Verifying public API is accessible..."
curl -s http://localhost:8300/api/public/runners | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f'✅ Public API working - Found {len(data)} runners')
for r in data[:3]:
    print(f'   • {r.get(\"displayName\", r.get(\"name\"))}')"

echo ""
echo "✅ Deployment complete!"
EOF

echo ""
echo "🎉 Dashboard now works without authentication!"
echo ""
echo "Key features:"
echo "  • Runners display with repository names via public API"
echo "  • Real-time updates via WebSocket"
echo "  • Optional login for additional features"
echo "  • No more 401 errors blocking the dashboard"
echo ""
echo "🌐 Dashboard: http://192.168.1.16:8080/"
echo ""
echo "Clear your browser cache (Ctrl+F5) for the latest changes."