#!/bin/bash
# E2E test for monitoring dashboard

set -e

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
DB_URL="${DATABASE_URL:-postgresql://app_user:app_secure_2024@192.168.1.24:5433/mcp_learning}"
LOG_FILE="/tmp/monitoring-dashboard-e2e-test.log"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Initialize test
echo "=== Monitoring Dashboard E2E Test ===" | tee $LOG_FILE
echo "Start time: $(date)" | tee -a $LOG_FILE
echo | tee -a $LOG_FILE

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
log() {
    echo -e "$1" | tee -a $LOG_FILE
}

test_start() {
    log "${BLUE}TEST: $1${NC}"
}

test_pass() {
    ((TESTS_PASSED++))
    log "${GREEN}✓ PASS${NC}: $1"
}

test_fail() {
    ((TESTS_FAILED++))
    log "${RED}✗ FAIL${NC}: $1"
    if [ -n "$2" ]; then
        log "  Error: $2"
    fi
}

api_call() {
    local method=$1
    local endpoint=$2
    local expected_status=${3:-200}
    
    local response
    local status
    
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$endpoint" 2>/dev/null)
    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$status" -eq "$expected_status" ]; then
        echo "$body"
        return 0
    else
        echo "Expected status $expected_status, got $status. Response: $body" >&2
        return 1
    fi
}

verify_service_running() {
    test_start "Verify orchestrator service is running"
    
    if api_call GET "/health" > /dev/null 2>&1; then
        test_pass "Orchestrator service is healthy"
    else
        test_fail "Orchestrator service is not responding"
        log "Please ensure the service is running: npm start"
        exit 1
    fi
}

# Test 1: Dashboard UI accessibility
test_dashboard_ui() {
    test_start "Dashboard UI accessibility"
    
    local response=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/dashboard")
    
    if [ "$response" -eq "200" ]; then
        test_pass "Dashboard UI is accessible"
    else
        test_fail "Dashboard UI returned status $response"
    fi
}

# Test 2: System metrics API
test_system_metrics() {
    test_start "System metrics API"
    
    local response=$(api_call GET "/api/monitoring/system")
    
    if echo "$response" | jq -e '.success == true and .data | has("jobs") and has("runners") and has("pools") and has("system")' > /dev/null; then
        local total_jobs=$(echo "$response" | jq -r '.data.jobs.total')
        local total_runners=$(echo "$response" | jq -r '.data.runners.total')
        log "  Found $total_jobs jobs and $total_runners runners"
        test_pass "System metrics API returns valid data"
    else
        test_fail "System metrics API response invalid" "$response"
    fi
}

# Test 3: Repository metrics API
test_repository_metrics() {
    test_start "Repository metrics API"
    
    local test_repo="test_monitoring"
    local response=$(api_call GET "/api/monitoring/repository/$test_repo")
    
    if echo "$response" | jq -e '.success == true and .data.repository' > /dev/null; then
        test_pass "Repository metrics API works"
    else
        test_fail "Repository metrics API failed" "$response"
    fi
}

# Test 4: Job timeline API
test_job_timeline() {
    test_start "Job timeline API"
    
    local response=$(api_call GET "/api/monitoring/timeline?hours=24")
    
    if echo "$response" | jq -e '.success == true and .data | type == "array"' > /dev/null; then
        local timeline_points=$(echo "$response" | jq '.data | length')
        log "  Timeline has $timeline_points data points"
        test_pass "Job timeline API returns valid data"
    else
        test_fail "Job timeline API failed" "$response"
    fi
}

# Test 5: Runner health API
test_runner_health() {
    test_start "Runner health API"
    
    local response=$(api_call GET "/api/monitoring/health")
    
    if echo "$response" | jq -e '.success == true and .data | type == "array"' > /dev/null; then
        local runner_count=$(echo "$response" | jq '.data | length')
        log "  Health data for $runner_count runners"
        test_pass "Runner health API works"
    else
        test_fail "Runner health API failed" "$response"
    fi
}

# Test 6: Dashboard aggregated data
test_dashboard_data() {
    test_start "Dashboard aggregated data API"
    
    local response=$(api_call GET "/api/monitoring/dashboard")
    
    if echo "$response" | jq -e '.success == true and .data | has("system") and has("recentJobs") and has("timeline") and has("runnerHealth")' > /dev/null; then
        test_pass "Dashboard data API returns all required fields"
    else
        test_fail "Dashboard data API incomplete" "$response"
    fi
}

# Test 7: Prometheus metrics
test_prometheus_metrics() {
    test_start "Prometheus metrics endpoint"
    
    local response=$(curl -s "$API_URL/metrics")
    
    if echo "$response" | grep -q "github_runnerhub_jobs_total" && \
       echo "$response" | grep -q "github_runnerhub_runners_total" && \
       echo "$response" | grep -q "github_runnerhub_pool_utilization"; then
        local metric_count=$(echo "$response" | grep -c "github_runnerhub_")
        log "  Found $metric_count Prometheus metrics"
        test_pass "Prometheus metrics endpoint working"
    else
        test_fail "Prometheus metrics missing expected values"
    fi
}

# Test 8: WebSocket connectivity
test_websocket() {
    test_start "WebSocket connectivity"
    
    # Use Node.js to test WebSocket
    local ws_test_script="/tmp/ws-test.js"
    cat > "$ws_test_script" << 'EOF'
const io = require('socket.io-client');
const socket = io('http://localhost:3000');

let connected = false;
let metricsReceived = false;

socket.on('connect', () => {
    connected = true;
    console.log('Connected to WebSocket');
});

socket.on('metrics', (data) => {
    metricsReceived = true;
    console.log('Received metrics event');
    socket.close();
    process.exit(connected && metricsReceived ? 0 : 1);
});

setTimeout(() => {
    console.log('Timeout waiting for metrics');
    socket.close();
    process.exit(1);
}, 15000);
EOF

    if npm list socket.io-client > /dev/null 2>&1; then
        if node "$ws_test_script" > /dev/null 2>&1; then
            test_pass "WebSocket connection and metrics events working"
        else
            test_fail "WebSocket connection or metrics events failed"
        fi
    else
        log "${YELLOW}  Skipping WebSocket test (socket.io-client not installed)${NC}"
    fi
    
    rm -f "$ws_test_script"
}

# Test 9: Static assets
test_static_assets() {
    test_start "Static assets serving"
    
    local js_response=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/js/dashboard.js")
    
    if [ "$js_response" -eq "200" ]; then
        test_pass "Static assets are being served correctly"
    else
        test_fail "Static assets not accessible (status: $js_response)"
    fi
}

# Test 10: Create test data and verify updates
test_data_updates() {
    test_start "Data updates in monitoring"
    
    # Create a test job
    psql "$DB_URL" -c "INSERT INTO runnerhub.jobs (job_id, run_id, repository, workflow, status) 
                       VALUES ('e2e-test-job', 'e2e-run', 'test/repo', 'E2E Test', 'pending');" 2>/dev/null || true
    
    sleep 2
    
    # Check if the job appears in recent jobs
    local response=$(api_call GET "/api/monitoring/jobs?limit=5")
    
    if echo "$response" | jq -e '.data[] | select(.jobId == "e2e-test-job")' > /dev/null 2>&1; then
        test_pass "Monitoring picks up new data correctly"
        
        # Cleanup
        psql "$DB_URL" -c "DELETE FROM runnerhub.jobs WHERE job_id = 'e2e-test-job';" 2>/dev/null || true
    else
        test_fail "New data not reflected in monitoring"
    fi
}

# Test 11: Performance check
test_performance() {
    test_start "API performance check"
    
    local start_time=$(date +%s%N)
    api_call GET "/api/monitoring/dashboard" > /dev/null
    local end_time=$(date +%s%N)
    
    local duration=$((($end_time - $start_time) / 1000000)) # Convert to milliseconds
    
    if [ $duration -lt 1000 ]; then
        test_pass "Dashboard API responds quickly (${duration}ms)"
    else
        test_fail "Dashboard API too slow (${duration}ms > 1000ms)"
    fi
}

# Test 12: Error handling
test_error_handling() {
    test_start "Error handling"
    
    # Test invalid repository
    local response=$(api_call GET "/api/monitoring/repository/../../etc/passwd" 200)
    
    if echo "$response" | jq -e '.success' > /dev/null 2>&1; then
        test_pass "API handles invalid input gracefully"
    else
        test_fail "API error handling needs improvement"
    fi
}

# Main test execution
main() {
    log "Starting E2E tests for monitoring dashboard..."
    log "API URL: $API_URL"
    log ""
    
    # Verify service is running
    verify_service_running
    
    # Run tests
    test_dashboard_ui
    test_system_metrics
    test_repository_metrics
    test_job_timeline
    test_runner_health
    test_dashboard_data
    test_prometheus_metrics
    test_websocket
    test_static_assets
    test_data_updates
    test_performance
    test_error_handling
    
    # Summary
    log ""
    log "=== Test Summary ==="
    log "${GREEN}Passed: $TESTS_PASSED${NC}"
    log "${RED}Failed: $TESTS_FAILED${NC}"
    log "End time: $(date)"
    
    if [ $TESTS_FAILED -eq 0 ]; then
        log ""
        log "${GREEN}✓ All monitoring dashboard E2E tests passed!${NC}"
        exit 0
    else
        log ""
        log "${RED}✗ Some tests failed${NC}"
        exit 1
    fi
}

# Run tests
main