#!/bin/bash
# Demonstrate runner pool management functionality

set -e

echo "=== GitHub-RunnerHub Runner Pool Demo ==="
echo

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
TEST_REPO="demo/test-repo"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Helper function
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -n "$data" ]; then
        curl -s -X "$method" "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data" | jq '.' || echo "API call failed"
    else
        curl -s -X "$method" "$API_URL$endpoint" | jq '.' || echo "API call failed"
    fi
}

echo -e "${BLUE}1. List all runner pools${NC}"
echo "GET /api/runners/pools"
api_call GET "/api/runners/pools"
echo

echo -e "${BLUE}2. Get or create pool for repository${NC}"
echo "GET /api/runners/pools/$(echo $TEST_REPO | tr '/' '_')"
api_call GET "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')"
echo

echo -e "${BLUE}3. Update pool configuration${NC}"
echo "PUT /api/runners/pools/$(echo $TEST_REPO | tr '/' '_')"
POOL_CONFIG='{
  "minRunners": 2,
  "maxRunners": 8,
  "scaleIncrement": 3,
  "scaleThreshold": 0.75
}'
echo "Data: $POOL_CONFIG"
api_call PUT "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')" "$POOL_CONFIG"
echo

echo -e "${BLUE}4. Get pool metrics${NC}"
echo "GET /api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/metrics"
api_call GET "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/metrics"
echo

echo -e "${BLUE}5. Manually scale up${NC}"
echo "POST /api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/scale"
SCALE_UP='{
  "action": "up",
  "count": 2
}'
echo "Data: $SCALE_UP"
api_call POST "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/scale" "$SCALE_UP"
echo

echo -e "${BLUE}6. List all runners${NC}"
echo "GET /api/runners"
api_call GET "/api/runners"
echo

echo -e "${BLUE}7. Simulate high load by delegating multiple jobs${NC}"
for i in {1..5}; do
    JOB_DATA="{
      \"jobId\": \"load-test-$i\",
      \"runId\": \"run-$i\",
      \"repository\": \"$TEST_REPO\",
      \"workflow\": \"Load Test\",
      \"runnerName\": \"proxy-test\",
      \"labels\": [\"self-hosted\", \"load-test\"]
    }"
    echo -n "Delegating job $i... "
    RESPONSE=$(curl -s -X POST "$API_URL/api/jobs/delegate" \
        -H "Content-Type: application/json" \
        -d "$JOB_DATA")
    if echo "$RESPONSE" | jq -e '.success' > /dev/null; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${YELLOW}Failed${NC}"
    fi
done
echo

echo -e "${BLUE}8. Check pool metrics after load${NC}"
sleep 2
api_call GET "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/metrics"
echo

echo -e "${BLUE}9. Scale down idle runners${NC}"
echo "POST /api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/scale"
SCALE_DOWN='{
  "action": "down"
}'
echo "Data: $SCALE_DOWN"
api_call POST "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/scale" "$SCALE_DOWN"
echo

echo -e "${GREEN}Demo completed!${NC}"
echo
echo "Key features demonstrated:"
echo "- Dynamic runner pool creation"
echo "- Pool configuration management"
echo "- Real-time metrics"
echo "- Manual and automatic scaling"
echo "- Load-based scaling triggers"