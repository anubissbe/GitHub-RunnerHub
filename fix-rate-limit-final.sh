#!/bin/bash

echo "🔧 Final fix for rate limiting - clearing all blocks..."

ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
cd /home/drwho/GitHub-RunnerHub

echo "🛑 Stopping backend completely..."
docker-compose stop backend
docker-compose rm -f backend

echo "⏳ Waiting for complete shutdown..."
sleep 5

echo "🚀 Starting fresh backend (clears all in-memory rate limit data)..."
docker-compose up -d backend

echo "⏳ Waiting for backend to be ready..."
sleep 15

echo ""
echo "🔍 Testing public API (should work now):"
for i in {1..3}; do
  echo -n "Test $i: "
  RESPONSE=$(curl -s http://localhost:8300/api/public/runners)
  if echo "$RESPONSE" | grep -q "displayName"; then
    echo "✅ Success - API returned runners"
  else
    echo "❌ Failed - Response: ${RESPONSE:0:100}..."
  fi
  sleep 1
done

echo ""
echo "📊 Runner Status:"
curl -s http://localhost:8300/api/public/runners | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        print(f'✅ Found {len(data)} runners:')
        for r in data:
            print(f'   • {r.get(\"displayName\", r.get(\"name\", \"Unknown\"))}')
    else:
        print(f'Response: {data}')
except Exception as e:
    print(f'Error parsing response: {e}')
"

echo ""
echo "✅ Backend restarted with clean state!"
EOF

echo ""
echo "🎉 Rate limiting should be completely cleared!"
echo ""
echo "Dashboard: http://192.168.1.16:8080/"
echo ""
echo "Please do a hard refresh (Ctrl+Shift+R) in your browser."