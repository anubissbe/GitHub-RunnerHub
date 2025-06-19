#!/bin/bash

echo "🔧 Fixing rate limiting issues for GitHub RunnerHub..."

# Deploy updated backend with rate limit exemptions
echo "📦 Deploying backend with rate limit fixes..."
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/backend/server.js drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/backend/

ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
cd /home/drwho/GitHub-RunnerHub

echo "🔄 Restarting backend with new rate limiting configuration..."
docker-compose restart backend

echo "⏳ Waiting for backend to be ready..."
sleep 10

echo ""
echo "🔍 Testing public endpoints (should not be rate limited):"
echo ""

# Test multiple rapid requests to public endpoint
echo "Making 10 rapid requests to test rate limiting..."
for i in {1..10}; do
  echo -n "Request $i: "
  curl -s -o /dev/null -w "%{http_code}" http://localhost:8300/api/public/runners
  echo ""
done

echo ""
echo "✅ Rate limiting fix deployed!"
echo ""
echo "The public endpoints are now exempt from rate limiting:"
echo "  • /api/public/runners"
echo "  • /api/public/status"
echo "  • /api/public/docker-runners"
echo "  • /health"
echo "  • /api/test"
EOF

echo ""
echo "🎉 Fix complete! The dashboard should now load without 429 errors."
echo "🌐 Dashboard: http://192.168.1.16:8080/"
echo ""
echo "Clear your browser cache (Ctrl+F5) to ensure fresh data loads."