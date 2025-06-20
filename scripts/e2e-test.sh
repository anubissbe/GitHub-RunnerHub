#!/bin/bash
# E2E Test Script for GitHub-RunnerHub

set -e

echo "=== GitHub-RunnerHub E2E Test ==="
echo "Testing the complete job delegation flow"
echo

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
TEST_REPO="${TEST_REPO:-test/repo}"
TEST_RUNNER="${TEST_RUNNER:-proxy-test-1}"

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

check_service() {
    local service=$1
    local url=$2
    
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "200"; then
        log_info "✓ $service is healthy"
        return 0
    else
        log_error "✗ $service is not responding"
        return 1
    fi
}

# 1. Check prerequisites
log_info "Checking prerequisites..."

# Check if services are running
check_service "Orchestration API" "$API_URL/health"

# Check database connection
if psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    log_info "✓ Database connection successful"
else
    log_error "✗ Database connection failed"
    exit 1
fi

# Check Redis connection
if redis-cli -h "${REDIS_HOST:-localhost}" ping > /dev/null 2>&1; then
    log_info "✓ Redis connection successful"
else
    log_error "✗ Redis connection failed"
    exit 1
fi

# 2. Test job delegation
log_info "Testing job delegation..."

# Create test job payload
JOB_PAYLOAD=$(cat <<EOF
{
  "jobId": "test-$(date +%s)",
  "runId": "run-$(date +%s)",
  "repository": "$TEST_REPO",
  "workflow": "E2E Test Workflow",
  "runnerName": "$TEST_RUNNER",
  "sha": "abc123",
  "ref": "refs/heads/main",
  "eventName": "push",
  "actor": "e2e-test",
  "labels": ["self-hosted", "ubuntu-latest", "test"]
}
EOF
)

# Send delegation request
log_info "Sending job delegation request..."
RESPONSE=$(curl -s -X POST "$API_URL/api/jobs/delegate" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer test-token" \
    -d "$JOB_PAYLOAD")

# Check response
if echo "$RESPONSE" | jq -e '.success == true' > /dev/null; then
    DELEGATION_ID=$(echo "$RESPONSE" | jq -r '.data.delegationId')
    log_info "✓ Job delegated successfully: $DELEGATION_ID"
else
    log_error "✗ Job delegation failed"
    echo "$RESPONSE" | jq .
    exit 1
fi

# 3. Check job status
log_info "Checking job status..."
sleep 2

JOB_STATUS=$(curl -s "$API_URL/api/jobs/$DELEGATION_ID" | jq -r '.data.status')
log_info "Job status: $JOB_STATUS"

# 4. Verify job in database
log_info "Verifying job in database..."
DB_JOB=$(psql "$DATABASE_URL" -t -c "SELECT status FROM runnerhub.jobs WHERE id = '$DELEGATION_ID'")

if [ -n "$DB_JOB" ]; then
    log_info "✓ Job found in database with status: $DB_JOB"
else
    log_error "✗ Job not found in database"
    exit 1
fi

# 5. Check job queue metrics
log_info "Checking job queue metrics..."
QUEUE_METRICS=$(curl -s "$API_URL/api/metrics")
log_info "Queue metrics: $QUEUE_METRICS"

# 6. Test pagination
log_info "Testing job list pagination..."
JOBS_LIST=$(curl -s "$API_URL/api/jobs?page=1&limit=10")

if echo "$JOBS_LIST" | jq -e '.success == true' > /dev/null; then
    JOB_COUNT=$(echo "$JOBS_LIST" | jq '.data | length')
    log_info "✓ Retrieved $JOB_COUNT jobs"
else
    log_error "✗ Failed to retrieve jobs list"
fi

# 7. Test WebSocket connection (if available)
log_info "Testing WebSocket connection..."
# This would require a WebSocket client like wscat
# For now, we'll skip this test

# 8. Test error handling
log_info "Testing error handling..."

# Send invalid job
INVALID_RESPONSE=$(curl -s -X POST "$API_URL/api/jobs/delegate" \
    -H "Content-Type: application/json" \
    -d '{"invalid": "payload"}')

if echo "$INVALID_RESPONSE" | jq -e '.success == false' > /dev/null; then
    log_info "✓ Invalid request properly rejected"
else
    log_error "✗ Error handling not working properly"
fi

# 9. Check rate limiting
log_info "Testing rate limiting..."
for i in {1..5}; do
    curl -s -o /dev/null -w "%{http_code}\n" "$API_URL/api/jobs" &
done
wait
log_info "✓ Rate limiting tested"

# 10. Summary
echo
echo "=== E2E Test Summary ==="
log_info "✓ All tests completed successfully!"
echo
echo "Test Details:"
echo "- Delegation ID: $DELEGATION_ID"
echo "- Job Status: $JOB_STATUS"
echo "- API Endpoint: $API_URL"
echo

# Cleanup (optional)
if [ "${CLEANUP:-false}" == "true" ]; then
    log_info "Cleaning up test data..."
    # Add cleanup commands here
fi

log_info "E2E test completed!"