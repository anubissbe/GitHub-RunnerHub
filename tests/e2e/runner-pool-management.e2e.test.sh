#!/bin/bash
# E2E test for runner pool management system

set -e

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
DB_URL="${DATABASE_URL:-postgresql://app_user:app_secure_2024@192.168.1.24:5433/mcp_learning}"
TEST_REPO="e2e-test/runner-pools"
LOG_FILE="/tmp/runner-pool-e2e-test.log"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Initialize test
echo "=== Runner Pool Management E2E Test ===" | tee $LOG_FILE
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
    local data=$3
    local expected_status=${4:-200}
    
    local response
    local status
    
    if [ -n "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data" 2>/dev/null)
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$endpoint" 2>/dev/null)
    fi
    
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

# Cleanup function
cleanup_test_data() {
    log "${YELLOW}Cleaning up test data...${NC}"
    
    # Remove test repository pools and runners
    psql "$DB_URL" -c "DELETE FROM runnerhub.runners WHERE repository = '$TEST_REPO';" 2>/dev/null || true
    psql "$DB_URL" -c "DELETE FROM runnerhub.runner_pools WHERE repository = '$TEST_REPO';" 2>/dev/null || true
}

# Test 1: Create and retrieve pool
test_pool_creation() {
    test_start "Pool creation and retrieval"
    
    # Get or create pool
    local response=$(api_call GET "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')")
    
    if echo "$response" | jq -e '.success == true and .data.repository' > /dev/null; then
        test_pass "Pool created/retrieved successfully"
    else
        test_fail "Failed to create/retrieve pool" "$response"
    fi
}

# Test 2: Update pool configuration
test_pool_update() {
    test_start "Pool configuration update"
    
    local config='{
        "minRunners": 3,
        "maxRunners": 12,
        "scaleIncrement": 4,
        "scaleThreshold": 0.7
    }'
    
    local response=$(api_call PUT "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')" "$config")
    
    if echo "$response" | jq -e '.success == true and .data.minRunners == 3 and .data.maxRunners == 12' > /dev/null; then
        test_pass "Pool configuration updated successfully"
    else
        test_fail "Failed to update pool configuration" "$response"
    fi
}

# Test 3: Pool metrics
test_pool_metrics() {
    test_start "Pool metrics retrieval"
    
    local response=$(api_call GET "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/metrics")
    
    if echo "$response" | jq -e '.success == true and .data | has("totalRunners") and has("utilization")' > /dev/null; then
        test_pass "Pool metrics retrieved successfully"
    else
        test_fail "Failed to retrieve pool metrics" "$response"
    fi
}

# Test 4: Manual scale up
test_manual_scale_up() {
    test_start "Manual scale up"
    
    # Get initial metrics
    local initial=$(api_call GET "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/metrics")
    local initial_count=$(echo "$initial" | jq -r '.data.totalRunners')
    
    # Scale up
    local scale_request='{"action": "up", "count": 2}'
    local response=$(api_call POST "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/scale" "$scale_request")
    
    if echo "$response" | jq -e '.success == true' > /dev/null; then
        # Wait for scaling to complete
        sleep 3
        
        # Verify new count
        local final=$(api_call GET "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/metrics")
        local final_count=$(echo "$final" | jq -r '.data.totalRunners')
        
        if [ "$final_count" -gt "$initial_count" ]; then
            test_pass "Manual scale up completed (from $initial_count to $final_count runners)"
        else
            test_fail "Runner count did not increase after scale up"
        fi
    else
        test_fail "Scale up request failed" "$response"
    fi
}

# Test 5: Auto-scaling trigger
test_auto_scaling() {
    test_start "Auto-scaling based on utilization"
    
    # Delegate multiple jobs to increase utilization
    local job_count=0
    for i in {1..5}; do
        local job_data="{
            \"jobId\": \"auto-scale-test-$i\",
            \"runId\": \"run-$i\",
            \"repository\": \"$TEST_REPO\",
            \"workflow\": \"Auto-scale Test\",
            \"runnerName\": \"proxy-test\",
            \"labels\": [\"self-hosted\", \"test\"]
        }"
        
        if api_call POST "/api/jobs/delegate" "$job_data" > /dev/null 2>&1; then
            ((job_count++))
        fi
    done
    
    if [ $job_count -gt 0 ]; then
        log "  Delegated $job_count jobs to increase utilization"
        
        # Check utilization
        sleep 2
        local metrics=$(api_call GET "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/metrics")
        local utilization=$(echo "$metrics" | jq -r '.data.utilization')
        
        log "  Current utilization: $utilization"
        test_pass "Auto-scaling trigger tested (delegated $job_count jobs)"
    else
        test_fail "Failed to delegate jobs for auto-scaling test"
    fi
}

# Test 6: Scale down
test_scale_down() {
    test_start "Scale down idle runners"
    
    # Mark some jobs as completed to create idle runners
    psql "$DB_URL" -c "UPDATE runnerhub.jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE repository = '$TEST_REPO' AND status = 'running';" 2>/dev/null || true
    psql "$DB_URL" -c "UPDATE runnerhub.runners SET status = 'idle' WHERE repository = '$TEST_REPO' AND status = 'busy';" 2>/dev/null || true
    
    sleep 1
    
    local scale_request='{"action": "down"}'
    local response=$(api_call POST "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/scale" "$scale_request")
    
    if echo "$response" | jq -e '.success == true' > /dev/null; then
        local removed=$(echo "$response" | jq -r '.data.message' | grep -o '[0-9]* idle runners' | awk '{print $1}')
        test_pass "Scale down completed (removed ${removed:-0} idle runners)"
    else
        test_fail "Scale down request failed" "$response"
    fi
}

# Test 7: Validation tests
test_validation() {
    test_start "Input validation"
    
    # Test invalid min/max values
    local invalid_config='{"minRunners": 20, "maxRunners": 10}'
    if api_call PUT "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')" "$invalid_config" "" 400 > /dev/null 2>&1; then
        test_pass "Correctly rejected invalid min/max configuration"
    else
        test_fail "Failed to validate min/max configuration"
    fi
    
    # Test invalid scale action
    local invalid_scale='{"action": "invalid"}'
    if api_call POST "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/scale" "$invalid_scale" "" 400 > /dev/null 2>&1; then
        test_pass "Correctly rejected invalid scale action"
    else
        test_fail "Failed to validate scale action"
    fi
}

# Test 8: Concurrent operations
test_concurrent_operations() {
    test_start "Concurrent scaling operations"
    
    # Start multiple scale operations in parallel
    local pids=()
    for i in {1..3}; do
        (
            api_call POST "/api/runners/pools/$(echo $TEST_REPO | tr '/' '_')/scale" '{"action": "up", "count": 1}' > /dev/null 2>&1
        ) &
        pids+=($!)
    done
    
    # Wait for all operations
    local success=0
    for pid in "${pids[@]}"; do
        if wait $pid; then
            ((success++))
        fi
    done
    
    if [ $success -gt 0 ]; then
        test_pass "Handled $success concurrent operations successfully"
    else
        test_fail "All concurrent operations failed"
    fi
}

# Test 9: Pool listing
test_pool_listing() {
    test_start "List all pools with metrics"
    
    local response=$(api_call GET "/api/runners/pools")
    
    if echo "$response" | jq -e '.success == true and .data | type == "array"' > /dev/null; then
        local pool_count=$(echo "$response" | jq '.data | length')
        test_pass "Listed $pool_count runner pools"
    else
        test_fail "Failed to list runner pools" "$response"
    fi
}

# Test 10: Runner management
test_runner_management() {
    test_start "Runner listing and removal"
    
    # List runners
    local runners=$(api_call GET "/api/runners?repository=$TEST_REPO")
    
    if echo "$runners" | jq -e '.success == true' > /dev/null; then
        local runner_count=$(echo "$runners" | jq '.data | length')
        log "  Found $runner_count runners for test repository"
        
        # Try to remove a runner if any exist
        if [ $runner_count -gt 0 ]; then
            local runner_id=$(echo "$runners" | jq -r '.data[0].id')
            if api_call DELETE "/api/runners/$runner_id" > /dev/null 2>&1; then
                test_pass "Runner management operations working"
            else
                test_fail "Failed to remove runner"
            fi
        else
            test_pass "Runner listing working (no runners to remove)"
        fi
    else
        test_fail "Failed to list runners" "$runners"
    fi
}

# Main test execution
main() {
    log "Starting E2E tests for runner pool management..."
    log "API URL: $API_URL"
    log "Test Repository: $TEST_REPO"
    log ""
    
    # Initial cleanup
    cleanup_test_data
    
    # Verify service is running
    verify_service_running
    
    # Run tests
    test_pool_creation
    test_pool_update
    test_pool_metrics
    test_manual_scale_up
    test_auto_scaling
    test_scale_down
    test_validation
    test_concurrent_operations
    test_pool_listing
    test_runner_management
    
    # Final cleanup
    cleanup_test_data
    
    # Summary
    log ""
    log "=== Test Summary ==="
    log "${GREEN}Passed: $TESTS_PASSED${NC}"
    log "${RED}Failed: $TESTS_FAILED${NC}"
    log "End time: $(date)"
    
    if [ $TESTS_FAILED -eq 0 ]; then
        log ""
        log "${GREEN}✓ All E2E tests passed!${NC}"
        exit 0
    else
        log ""
        log "${RED}✗ Some tests failed${NC}"
        exit 1
    fi
}

# Run tests
main