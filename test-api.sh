#!/bin/bash

echo "🔍 Testing GitHub RunnerHub API endpoints..."

# Test public endpoints
echo ""
echo "1. Testing public endpoints:"
echo "   - Health check:"
curl -s http://192.168.1.16:8300/health | jq '.'

echo ""
echo "   - Public status:"
curl -s http://192.168.1.16:8300/api/public/status

echo ""
echo ""
echo "2. Testing authentication:"
echo "   - Login with default credentials:"
TOKEN=$(curl -s -X POST http://192.168.1.16:8300/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}' | jq -r '.accessToken')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Login failed, trying demo credentials..."
  TOKEN=$(curl -s -X POST http://192.168.1.16:8300/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username": "demo", "password": "demo123"}' | jq -r '.accessToken')
fi

echo "   Token: ${TOKEN:0:20}..."

echo ""
echo "3. Testing authenticated API:"
if [ "$TOKEN" != "null" ] && [ -n "$TOKEN" ]; then
  echo "   - Runners endpoint:"
  curl -s http://192.168.1.16:8300/api/runners \
    -H "Authorization: Bearer $TOKEN" | jq '.[0:2]'
else
  echo "   ❌ No valid token, cannot test authenticated endpoints"
fi

echo ""
echo "4. Alternative - direct Docker data:"
curl -s http://192.168.1.16:8300/api/public/docker-runners 2>/dev/null | jq '.' || echo "   ❌ Public Docker endpoint not available"