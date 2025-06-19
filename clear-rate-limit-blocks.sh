#!/bin/bash

echo "🔧 Clearing rate limit blocks and optimizing dashboard..."

# First, let's restart the backend to clear any in-memory blocks
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
cd /home/drwho/GitHub-RunnerHub

echo "🔄 Restarting backend to clear rate limit blocks..."
docker-compose restart backend

echo "⏳ Waiting for backend to be ready..."
sleep 10

echo ""
echo "✅ Rate limit blocks cleared!"
EOF

echo ""
echo "🌐 Dashboard: http://192.168.1.16:8080/"
echo ""
echo "The dashboard should now:"
echo "  • Show all 5 runners with repository names"
echo "  • Update via WebSocket in real-time"
echo "  • Not show any 403 or 429 errors"
echo ""
echo "If you still see errors, please refresh the page (Ctrl+F5)"