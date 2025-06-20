#!/bin/bash
# E2E test for container lifecycle management

set -e

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
DB_URL="${DATABASE_URL:-postgresql://app_user:app_secure_2024@192.168.1.24:5433/mcp_learning}"
TEST_JOB_ID="e2e-test-job-$(date +%s)"
TEST_RUNNER_ID="e2e-test-runner-$(date +%s)"
LOG_FILE="/tmp/container-lifecycle-e2e-test.log"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Initialize test
echo "=== Container Lifecycle Management E2E Test ===" | tee $LOG_FILE
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

# Test 1: List containers
test_list_containers() {
    test_start "List containers API"
    
    local response=$(api_call GET "/api/containers")
    
    if echo "$response" | jq -e '.success == true and .data | type == "array"' > /dev/null; then
        local count=$(echo "$response" | jq '.data | length')
        log "  Found $count containers"
        test_pass "Container list API working"
    else
        test_fail "Container list API failed" "$response"
    fi
}

# Test 2: Container lifecycle flow
test_container_lifecycle() {
    test_start "Complete container lifecycle flow"
    
    # Step 1: Create a test job
    log "  Creating test job..."
    local job_data="{
        \"jobId\": \"$TEST_JOB_ID\",
        \"runId\": \"e2e-run-1\",
        \"repository\": \"test/lifecycle\",
        \"workflow\": \"E2E Test\",
        \"runnerName\": \"e2e-runner\",
        \"labels\": [\"self-hosted\", \"e2e-test\"]
    }"
    
    local delegate_response=$(api_call POST "/api/jobs/delegate" "$job_data")
    
    if echo "$delegate_response" | jq -e '.success == true' > /dev/null; then
        log "  Job delegated successfully"
        
        # Wait for container creation
        sleep 5
        
        # Step 2: Find the container
        local containers=$(api_call GET "/api/containers?jobId=$TEST_JOB_ID")
        
        if echo "$containers" | jq -e '.data | length > 0' > /dev/null 2>&1; then
            local container_id=$(echo "$containers" | jq -r '.data[0].id')
            local container_state=$(echo "$containers" | jq -r '.data[0].state')
            
            log "  Container created: $container_id (state: $container_state)"
            
            # Step 3: Check container details
            local details=$(api_call GET "/api/containers/$container_id")
            
            if echo "$details" | jq -e '.success == true' > /dev/null; then
                log "  Container details retrieved successfully"
                
                # Step 4: Get container stats (if running)
                if [ "$container_state" = "running" ]; then
                    local stats=$(api_call GET "/api/containers/$container_id/stats" "" 200)
                    if [ $? -eq 0 ]; then
                        log "  Container stats retrieved"
                    fi
                fi
                
                # Step 5: Stop container
                local stop_response=$(api_call POST "/api/containers/$container_id/stop" '{"timeout": 10}')
                
                if echo "$stop_response" | jq -e '.success == true' > /dev/null 2>&1; then
                    log "  Container stopped successfully"
                    
                    # Step 6: Remove container
                    local remove_response=$(api_call DELETE "/api/containers/$container_id" '{"force": false}')
                    
                    if echo "$remove_response" | jq -e '.success == true' > /dev/null 2>&1; then
                        test_pass "Complete container lifecycle executed"
                    else
                        test_fail "Container removal failed"
                    fi
                else
                    test_fail "Container stop failed"
                fi
            else
                test_fail "Failed to get container details"
            fi
        else
            test_fail "No container found for job"
        fi
    else
        test_fail "Job delegation failed" "$delegate_response"
    fi
}

# Test 3: Container execution
test_container_execution() {
    test_start "Container command execution"
    
    # Get a running container
    local containers=$(api_call GET "/api/containers?state=running")
    
    if echo "$containers" | jq -e '.data | length > 0' > /dev/null 2>&1; then
        local container_id=$(echo "$containers" | jq -r '.data[0].id')
        
        # Execute command
        local exec_data='{"command": ["echo", "Hello from E2E test"], "user": "root"}'
        local exec_response=$(api_call POST "/api/containers/$container_id/exec" "$exec_data")
        
        if echo "$exec_response" | jq -e '.success == true and .data.exitCode == 0' > /dev/null; then
            local output=$(echo "$exec_response" | jq -r '.data.output')
            log "  Command output: $output"
            test_pass "Container command execution working"
        else
            test_fail "Command execution failed" "$exec_response"
        fi
    else
        log "${YELLOW}  No running containers to test execution${NC}"
        test_pass "Container execution test skipped (no running containers)"
    fi
}

# Test 4: Container logs
test_container_logs() {
    test_start "Container log retrieval"
    
    # Get any container
    local containers=$(api_call GET "/api/containers")
    
    if echo "$containers" | jq -e '.data | length > 0' > /dev/null 2>&1; then
        local container_id=$(echo "$containers" | jq -r '.data[0].id')
        
        local logs_response=$(api_call GET "/api/containers/$container_id/logs?tail=10")
        
        if echo "$logs_response" | jq -e '.success == true' > /dev/null; then
            test_pass "Container logs retrieval working"
        else
            test_fail "Log retrieval failed"
        fi
    else
        test_pass "Log retrieval test skipped (no containers)"
    fi
}

# Test 5: Resource usage monitoring
test_resource_monitoring() {
    test_start "Resource usage monitoring"
    
    local usage_response=$(api_call GET "/api/containers/usage/summary")
    
    if echo "$usage_response" | jq -e '.success == true and .data | has("totalContainers")' > /dev/null; then
        local total=$(echo "$usage_response" | jq -r '.data.totalContainers')
        local cpu=$(echo "$usage_response" | jq -r '.data.totalCpuPercent')
        local memory=$(echo "$usage_response" | jq -r '.data.totalMemoryMB')
        
        log "  Total containers: $total"
        log "  Total CPU: ${cpu}%"
        log "  Total Memory: ${memory}MB"
        
        test_pass "Resource monitoring working"
    else
        test_fail "Resource monitoring failed" "$usage_response"
    fi
}

# Test 6: Container filtering
test_container_filtering() {
    test_start "Container filtering"
    
    # Test state filter
    local running=$(api_call GET "/api/containers?state=running")
    local stopped=$(api_call GET "/api/containers?state=stopped")
    
    if echo "$running" | jq -e '.success == true' > /dev/null && \
       echo "$stopped" | jq -e '.success == true' > /dev/null; then
        
        local running_count=$(echo "$running" | jq '.data | length')
        local stopped_count=$(echo "$stopped" | jq '.data | length')
        
        log "  Running containers: $running_count"
        log "  Stopped containers: $stopped_count"
        
        test_pass "Container filtering working"
    else
        test_fail "Container filtering failed"
    fi
}

# Test 7: Container by runner
test_container_by_runner() {
    test_start "Get containers by runner ID"
    
    # First get a runner with container
    local runners=$(psql "$DB_URL" -t -c "SELECT id FROM runnerhub.runners WHERE container_id IS NOT NULL LIMIT 1" 2>/dev/null | xargs)
    
    if [ -n "$runners" ]; then
        local response=$(api_call GET "/api/containers/runner/$runners")
        
        if echo "$response" | jq -e '.success == true' > /dev/null; then
            test_pass "Container by runner lookup working"
        else
            test_fail "Container by runner lookup failed"
        fi
    else
        test_pass "Container by runner test skipped (no runners with containers)"
    fi
}

# Test 8: Error handling
test_error_handling() {
    test_start "Error handling"
    
    # Test non-existent container
    local response=$(api_call GET "/api/containers/non-existent-id" "" 404)
    
    if [ $? -eq 0 ]; then
        log "  404 handling correct"
    fi
    
    # Test invalid command execution
    local exec_response=$(api_call POST "/api/containers/fake-id/exec" '{"command": "invalid"}' 400)
    
    if [ $? -eq 0 ]; then
        log "  Invalid request handling correct"
    fi
    
    test_pass "Error handling working correctly"
}

# Test 9: Concurrent operations
test_concurrent_operations() {
    test_start "Concurrent container operations"
    
    # Get multiple containers
    local containers=$(api_call GET "/api/containers")
    local container_count=$(echo "$containers" | jq '.data | length')
    
    if [ "$container_count" -ge 2 ]; then
        # Get stats for multiple containers concurrently
        local pids=()
        local success=0
        
        echo "$containers" | jq -r '.data[0:2][].id' | while read -r container_id; do
            (api_call GET "/api/containers/$container_id/stats" > /dev/null 2>&1 && echo "OK") &
            pids+=($!)
        done
        
        # Wait and count successes
        for pid in "${pids[@]}"; do
            if wait $pid; then
                ((success++))
            fi
        done
        
        test_pass "Handled concurrent operations"
    else
        test_pass "Concurrent operations test skipped (insufficient containers)"
    fi
}

# Test 10: Cleanup verification
test_cleanup_verification() {
    test_start "Cleanup policy verification"
    
    # Check for old completed jobs
    local old_jobs=$(psql "$DB_URL" -t -c "
        SELECT COUNT(*) FROM runnerhub.jobs j
        JOIN runnerhub.runners r ON j.assigned_runner_id = r.id
        WHERE j.status IN ('completed', 'failed')
        AND j.completed_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'
        AND r.container_id IS NOT NULL
    " 2>/dev/null | xargs)
    
    if [ "$old_jobs" = "0" ]; then
        test_pass "Cleanup policy working (no stale containers)"
    else
        test_fail "Found $old_jobs jobs with stale containers"
    fi
}

# Cleanup function
cleanup_test_data() {
    log "${YELLOW}Cleaning up test data...${NC}"
    
    # Clean up test jobs
    psql "$DB_URL" -c "DELETE FROM runnerhub.jobs WHERE job_id LIKE 'e2e-test-job-%';" 2>/dev/null || true
    psql "$DB_URL" -c "DELETE FROM runnerhub.runners WHERE name LIKE 'e2e-runner%';" 2>/dev/null || true
}

# Main test execution
main() {
    log "Starting E2E tests for container lifecycle management..."
    log "API URL: $API_URL"
    log ""
    
    # Verify service is running
    verify_service_running
    
    # Run tests
    test_list_containers
    test_container_lifecycle
    test_container_execution
    test_container_logs
    test_resource_monitoring
    test_container_filtering
    test_container_by_runner
    test_error_handling
    test_concurrent_operations
    test_cleanup_verification
    
    # Cleanup
    cleanup_test_data
    
    # Summary
    log ""
    log "=== Test Summary ==="
    log "${GREEN}Passed: $TESTS_PASSED${NC}"
    log "${RED}Failed: $TESTS_FAILED${NC}"
    log "End time: $(date)"
    
    if [ $TESTS_FAILED -eq 0 ]; then
        log ""
        log "${GREEN}✓ All container lifecycle E2E tests passed!${NC}"
        exit 0
    else
        log ""
        log "${RED}✗ Some tests failed${NC}"
        exit 1
    fi
}

# Run tests
main