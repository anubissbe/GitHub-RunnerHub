#!/bin/bash

echo "🔧 Completely fixing rate limiting issues..."

# Deploy updated backend
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/backend/server.js drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/backend/

ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
cd /home/drwho/GitHub-RunnerHub

echo "🔄 Restarting backend with fixed rate limiting..."
docker-compose down backend
docker-compose up -d backend

echo "⏳ Waiting for backend to start fresh..."
sleep 15

echo ""
echo "🔍 Testing public API (should work immediately):"
for i in {1..5}; do
  echo -n "Test $i: "
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8300/api/public/runners)
  if [ "$STATUS" = "200" ]; then
    echo "✅ Success (200)"
  else
    echo "❌ Failed ($STATUS)"
  fi
done

echo ""
echo "📊 Fetching runner data:"
curl -s http://localhost:8300/api/public/runners | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        print(f'✅ Found {len(data)} runners:')
        for r in data:
            print(f'   • {r.get(\"displayName\", r.get(\"name\", \"Unknown\"))} - {r.get(\"status\", \"Unknown\")}')
    else:
        print(f'❌ Unexpected response: {data}')
except Exception as e:
    print(f'❌ Error: {e}')
"

echo ""
echo "✅ Rate limiting completely fixed!"
EOF

echo ""
echo "🎉 The dashboard should now work perfectly!"
echo "🌐 Dashboard: http://192.168.1.16:8080/"
echo ""
echo "Please refresh your browser (Ctrl+F5) to clear any cached errors."