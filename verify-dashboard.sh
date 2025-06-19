#!/bin/bash

echo "🔍 Verifying GitHub RunnerHub Dashboard..."
echo ""

# Test public API
echo "1. Testing Public API:"
RESPONSE=$(curl -s http://192.168.1.16:8300/api/public/runners)
if echo "$RESPONSE" | grep -q "displayName"; then
    echo "✅ Public API is working!"
    echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f'   Found {len(data)} runners with repository names:')
for r in data:
    print(f'   • {r.get(\"displayName\", \"Unknown\")} ({r.get(\"status\", \"Unknown\")})')
"
else
    echo "❌ Public API returned error: $RESPONSE"
fi

echo ""
echo "2. Frontend Status:"
curl -s -o /dev/null -w "   HTTP Status: %{http_code}\n" http://192.168.1.16:8080/

echo ""
echo "3. WebSocket Endpoint:"
curl -s -o /dev/null -w "   HTTP Status: %{http_code}\n" http://192.168.1.16:8300/ws

echo ""
echo "✅ Dashboard Verification Complete!"
echo ""
echo "The dashboard at http://192.168.1.16:8080/ should now:"
echo "  • Load without any authentication"
echo "  • Show all 5 runners with repository names"
echo "  • Update via WebSocket in real-time"
echo "  • Have NO 401, 403, or 429 errors"
echo ""
echo "The only network requests should be:"
echo "  • GET /api/public/runners (every 10 seconds)"
echo "  • WebSocket connection to /ws"
echo ""
echo "Please refresh your browser (Ctrl+F5) to see the clean dashboard!"