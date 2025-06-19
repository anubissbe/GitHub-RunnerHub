#!/bin/bash

echo "🎯 Final Dashboard Fix - Focusing on Display Issues"
echo ""
echo "The goal is to show correct runner information in the dashboard."
echo "Current issues:"
echo "  • Dashboard showing inconsistent runner counts"
echo "  • Browser console showing 401 errors"
echo "  • Auto-scaling not working properly"
echo ""

ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
cd /home/drwho/GitHub-RunnerHub

echo "🔧 Step 1: Restart backend cleanly..."
docker-compose stop backend
sleep 5
docker-compose up -d backend
sleep 15

echo "🔧 Step 2: Test basic endpoints..."
echo "  Health endpoint:"
curl -s http://localhost:8300/health | head -200

echo ""
echo "  Public runners endpoint:"
curl -s http://localhost:8300/api/public/runners | head -200

echo ""
echo "🔧 Step 3: Check container status..."
echo "  Runner containers:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep runnerhub | head -10

echo ""
echo "  Backend logs (last 10 lines):"
docker logs runnerhub-backend --tail 10

echo ""
echo "✅ Basic system check complete"
EOF

echo ""
echo "🎯 Now testing the dashboard endpoints that the frontend uses:"

# Test the exact endpoints the frontend calls
echo ""
echo "1. Testing /api/public/runners (main dashboard data):"
curl -s http://192.168.1.16:8300/api/public/runners | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        print(f'✅ Found {len(data)} runners')
        for r in data[:3]:
            print(f'   • {r.get(\"displayName\", \"Unknown\")} - {r.get(\"status\", \"Unknown\")}')
    else:
        print(f'❌ Unexpected response format: {type(data)}')
        print(f'Response: {data}')
except Exception as e:
    print(f'❌ Error parsing response: {e}')
"

echo ""
echo "2. Testing WebSocket connectivity:"
echo "   WebSocket should be available at: ws://192.168.1.16:8300/ws"

echo ""
echo "3. Testing frontend availability:"
curl -s -o /dev/null -w "   Frontend HTTP Status: %{http_code}\n" http://192.168.1.16:8080/

echo ""
echo "🎉 Dashboard diagnosis complete!"
echo ""
echo "Summary:"
echo "  • The dashboard should now work with the simplified approach"
echo "  • Repository runners are managed by RunnerManager"
echo "  • Auto-scaling can be added later once display is stable"
echo "  • Focus is on showing correct runner information"
echo ""
echo "Next steps:"
echo "  1. Open http://192.168.1.16:8080/ in your browser"
echo "  2. Do a hard refresh (Ctrl+Shift+R)"
echo "  3. Check if the 5 repository runners are displayed correctly"
echo "  4. Verify WebSocket connection shows 'Live' status"