#!/bin/bash

# Auto-Scaling E2E Test Suite
# This script performs comprehensive end-to-end testing of the auto-scaling system

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test configuration
API_BASE="http://localhost:3000/api"
TEST_REPO="test/auto-scaling-e2e"
WAIT_TIME=5

# Counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
log_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((TESTS_FAILED++))
}

run_test() {
    ((TESTS_RUN++))
    echo -e "\n${YELLOW}[TEST $TESTS_RUN]${NC} $1"
}

# Wait for condition with timeout
wait_for_condition() {
    local condition=$1
    local timeout=$2
    local interval=1
    local elapsed=0
    
    while [ $elapsed -lt $timeout ]; do
        if eval "$condition"; then
            return 0
        fi
        sleep $interval
        elapsed=$((elapsed + interval))
    done
    
    return 1
}

# API helper functions
api_get() {
    curl -s -X GET "$API_BASE$1" -H "Content-Type: application/json"
}

api_post() {
    curl -s -X POST "$API_BASE$1" -H "Content-Type: application/json" -d "$2"
}

api_put() {
    curl -s -X PUT "$API_BASE$1" -H "Content-Type: application/json" -d "$2"
}

# Setup test environment
setup() {
    log_info "Setting up test environment..."
    
    # Create test runner pool
    local pool_response=$(api_post "/runners/pools" "{
        \"repository\": \"$TEST_REPO\",
        \"minRunners\": 2,
        \"maxRunners\": 10,
        \"targetSize\": 3
    }")
    
    if [[ $(echo "$pool_response" | jq -r '.success') != "true" ]]; then
        log_error "Failed to create test pool"
        exit 1
    fi
    
    log_info "Test pool created successfully"
    sleep 2
}

# Cleanup test environment
cleanup() {
    log_info "Cleaning up test environment..."
    
    # Scale down to minimum
    api_post "/scaling/evaluate/$TEST_REPO" ""
    
    # Remove test pool (this would need to be implemented)
    # api_delete "/runners/pools/$TEST_REPO"
    
    log_info "Cleanup completed"
}

# Test 1: Get scaling policies
test_get_scaling_policies() {
    run_test "Get scaling policies"
    
    local response=$(api_get "/scaling/policies")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local policy_count=$(echo "$response" | jq '.data | length')
        if [[ $policy_count -gt 0 ]]; then
            log_success "Retrieved $policy_count scaling policies"
        else
            log_error "No scaling policies found"
        fi
    else
        log_error "Failed to get scaling policies"
    fi
}

# Test 2: Update scaling policy
test_update_scaling_policy() {
    run_test "Update scaling policy"
    
    local update_data='{
        "scaleUpThreshold": 0.75,
        "scaleDownThreshold": 0.25,
        "scaleUpIncrement": 5,
        "cooldownPeriod": 120
    }'
    
    local response=$(api_put "/scaling/policies/$TEST_REPO" "$update_data")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        log_success "Scaling policy updated successfully"
        
        # Verify the update
        local policies=$(api_get "/scaling/policies")
        local updated_threshold=$(echo "$policies" | jq -r ".data[] | select(.repository == \"$TEST_REPO\") | .policy.scaleUpThreshold")
        
        if [[ "$updated_threshold" == "0.75" ]]; then
            log_success "Policy update verified"
        else
            log_error "Policy update verification failed"
        fi
    else
        log_error "Failed to update scaling policy"
    fi
}

# Test 3: Get metrics history
test_get_metrics_history() {
    run_test "Get metrics history"
    
    local response=$(api_get "/scaling/metrics/history?repository=$TEST_REPO&minutes=30")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local metrics_count=$(echo "$response" | jq '.data | length')
        log_success "Retrieved $metrics_count historical metrics"
    else
        log_error "Failed to get metrics history"
    fi
}

# Test 4: Get scaling predictions
test_get_scaling_predictions() {
    run_test "Get scaling predictions"
    
    local response=$(api_get "/scaling/metrics/predictions/$TEST_REPO?minutes=30")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local confidence=$(echo "$response" | jq -r '.data.confidence')
        log_success "Got scaling predictions with confidence: $confidence"
    else
        log_error "Failed to get scaling predictions"
    fi
}

# Test 5: Force scaling evaluation
test_force_scaling_evaluation() {
    run_test "Force scaling evaluation"
    
    local response=$(api_post "/scaling/evaluate/$TEST_REPO" "")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local decision=$(echo "$response" | jq -r '.data.decision')
        local reason=$(echo "$response" | jq -r '.data.reason')
        log_success "Scaling evaluation completed: $decision - $reason"
    else
        log_error "Failed to force scaling evaluation"
    fi
}

# Test 6: Test scale-up trigger by high utilization
test_scale_up_high_utilization() {
    run_test "Scale-up on high utilization"
    
    # Simulate high load by creating multiple jobs
    log_info "Creating high load scenario..."
    
    for i in {1..8}; do
        api_post "/jobs" "{
            \"repository\": \"$TEST_REPO\",
            \"workflowName\": \"scale-test-$i\",
            \"jobName\": \"load-test-$i\",
            \"runId\": $i,
            \"runNumber\": $i,
            \"payload\": {}
        }" > /dev/null
    done
    
    log_info "Waiting for auto-scaler to detect high utilization..."
    sleep 35  # Wait for next scaling evaluation cycle
    
    # Check if scaling occurred
    local history=$(api_get "/scaling/metrics/history?repository=$TEST_REPO&minutes=5")
    local scale_up_events=$(echo "$history" | jq '[.data[] | select(.scalingDecision == "scale-up")] | length')
    
    if [[ $scale_up_events -gt 0 ]]; then
        log_success "Auto-scaler triggered scale-up on high utilization"
        
        # Verify runner count increased
        local pool_info=$(api_get "/runners/pools/$TEST_REPO")
        local current_runners=$(echo "$pool_info" | jq -r '.data.currentRunners // 0')
        log_info "Current runner count: $current_runners"
    else
        log_error "Auto-scaler did not trigger scale-up"
    fi
}

# Test 7: Test cooldown period
test_cooldown_period() {
    run_test "Cooldown period enforcement"
    
    # Force immediate evaluation (should work)
    local response1=$(api_post "/scaling/evaluate/$TEST_REPO" "")
    local decision1=$(echo "$response1" | jq -r '.data.decision')
    
    log_info "First evaluation: $decision1"
    
    # Try another evaluation immediately (should be blocked by cooldown)
    sleep 2
    
    # Check scaling status
    local status=$(api_get "/scaling/policies")
    local in_cooldown=$(echo "$status" | jq -r ".data[] | select(.repository == \"$TEST_REPO\") | .inCooldown")
    
    if [[ "$in_cooldown" == "true" ]]; then
        log_success "Cooldown period is being enforced"
        
        local cooldown_remaining=$(echo "$status" | jq -r ".data[] | select(.repository == \"$TEST_REPO\") | .cooldownRemaining")
        log_info "Cooldown remaining: $cooldown_remaining seconds"
    else
        log_error "Cooldown period not enforced properly"
    fi
}

# Test 8: Test scale-down on low utilization
test_scale_down_low_utilization() {
    run_test "Scale-down on low utilization"
    
    log_info "Waiting for jobs to complete and utilization to drop..."
    
    # Wait for cooldown to expire
    sleep 120
    
    # Check current metrics
    local metrics=$(api_get "/scaling/metrics/history?repository=$TEST_REPO&minutes=5")
    local recent_utilization=$(echo "$metrics" | jq '.data[-1].utilization // 1')
    
    log_info "Current utilization: $recent_utilization"
    
    # Force evaluation to trigger scale-down
    local response=$(api_post "/scaling/evaluate/$TEST_REPO" "")
    local decision=$(echo "$response" | jq -r '.data.decision')
    
    if [[ "$decision" == "scale-down" ]]; then
        log_success "Auto-scaler triggered scale-down on low utilization"
    else
        log_info "Scale-down not triggered (decision: $decision)"
    fi
}

# Test 9: Test minimum runner enforcement
test_minimum_runners() {
    run_test "Minimum runner enforcement"
    
    # Get current pool info
    local pool_info=$(api_get "/runners/pools/$TEST_REPO")
    local min_runners=$(echo "$pool_info" | jq -r '.data.minRunners // 2')
    local current_runners=$(echo "$pool_info" | jq -r '.data.currentRunners // 0')
    
    log_info "Min runners: $min_runners, Current: $current_runners"
    
    # If we're at minimum, scale-down should not occur
    if [[ $current_runners -eq $min_runners ]]; then
        local response=$(api_post "/scaling/evaluate/$TEST_REPO" "")
        local decision=$(echo "$response" | jq -r '.data.decision')
        
        if [[ "$decision" != "scale-down" ]]; then
            log_success "Minimum runner limit enforced"
        else
            log_error "Scale-down attempted below minimum"
        fi
    else
        log_info "Not at minimum runners, skipping test"
    fi
}

# Test 10: Test maximum runner enforcement
test_maximum_runners() {
    run_test "Maximum runner enforcement"
    
    # Update policy to make scaling more aggressive
    api_put "/scaling/policies/$TEST_REPO" '{
        "scaleUpThreshold": 0.1,
        "scaleUpIncrement": 10
    }'
    
    # Create many jobs to trigger max scaling
    log_info "Creating maximum load scenario..."
    for i in {1..20}; do
        api_post "/jobs" "{
            \"repository\": \"$TEST_REPO\",
            \"workflowName\": \"max-test-$i\",
            \"jobName\": \"max-load-$i\",
            \"runId\": $((100 + i)),
            \"runNumber\": $((100 + i)),
            \"payload\": {}
        }" > /dev/null
    done
    
    # Wait for scaling
    sleep 35
    
    # Check if maximum is enforced
    local pool_info=$(api_get "/runners/pools/$TEST_REPO")
    local max_runners=$(echo "$pool_info" | jq -r '.data.maxRunners // 10')
    local current_runners=$(echo "$pool_info" | jq -r '.data.currentRunners // 0')
    
    log_info "Max runners: $max_runners, Current: $current_runners"
    
    if [[ $current_runners -le $max_runners ]]; then
        log_success "Maximum runner limit enforced"
    else
        log_error "Runner count exceeded maximum"
    fi
}

# Test 11: Test dashboard endpoint
test_scaling_dashboard() {
    run_test "Scaling dashboard endpoint"
    
    local response=$(api_get "/scaling/dashboard")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local total_pools=$(echo "$response" | jq -r '.data.totalPools')
        local active_pools=$(echo "$response" | jq -r '.data.activePools')
        log_success "Dashboard data retrieved - Total pools: $total_pools, Active: $active_pools"
    else
        log_error "Failed to get dashboard data"
    fi
}

# Test 12: Test metrics persistence
test_metrics_persistence() {
    run_test "Metrics persistence over time"
    
    # Get initial metrics count
    local initial_response=$(api_get "/scaling/metrics/history?repository=$TEST_REPO&minutes=60")
    local initial_count=$(echo "$initial_response" | jq '.data | length')
    
    log_info "Initial metrics count: $initial_count"
    
    # Wait for a scaling cycle
    sleep 35
    
    # Get updated metrics count
    local updated_response=$(api_get "/scaling/metrics/history?repository=$TEST_REPO&minutes=60")
    local updated_count=$(echo "$updated_response" | jq '.data | length')
    
    log_info "Updated metrics count: $updated_count"
    
    if [[ $updated_count -gt $initial_count ]]; then
        log_success "Metrics are being persisted over time"
    else
        log_error "Metrics not being persisted properly"
    fi
}

# Main test execution
main() {
    echo "==================================="
    echo "Auto-Scaling E2E Test Suite"
    echo "==================================="
    
    # Setup
    setup
    
    # Run tests
    test_get_scaling_policies
    test_update_scaling_policy
    test_get_metrics_history
    test_get_scaling_predictions
    test_force_scaling_evaluation
    test_scale_up_high_utilization
    test_cooldown_period
    test_scale_down_low_utilization
    test_minimum_runners
    test_maximum_runners
    test_scaling_dashboard
    test_metrics_persistence
    
    # Cleanup
    cleanup
    
    # Summary
    echo -e "\n==================================="
    echo "Test Summary"
    echo "==================================="
    echo -e "Total Tests: $TESTS_RUN"
    echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Failed: $TESTS_FAILED${NC}"
    
    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "\n${GREEN}All tests passed!${NC}"
        exit 0
    else
        echo -e "\n${RED}Some tests failed!${NC}"
        exit 1
    fi
}

# Run main function
main "$@"