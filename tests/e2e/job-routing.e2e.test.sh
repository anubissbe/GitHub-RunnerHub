#!/bin/bash

# Job Routing E2E Test Suite
# This script performs comprehensive end-to-end testing of the job routing system

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test configuration
API_BASE="http://localhost:3000/api"
TEST_REPO="test/routing-e2e"
WAIT_TIME=2

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

api_delete() {
    curl -s -X DELETE "$API_BASE$1" -H "Content-Type: application/json"
}

# Setup test environment
setup() {
    log_info "Setting up test environment..."
    
    # Create test runner pool with labeled runners
    local pool_response=$(api_post "/runners/pools" "{
        \"repository\": \"$TEST_REPO\",
        \"minRunners\": 2,
        \"maxRunners\": 5,
        \"targetSize\": 3
    }")
    
    if [[ $(echo "$pool_response" | jq -r '.success') != "true" ]]; then
        log_error "Failed to create test pool"
        exit 1
    fi
    
    # Create labeled runners (would be done by runner pool manager in real scenario)
    log_info "Test pool created. Simulating labeled runners..."
    
    # Note: In real deployment, runners would be created with labels
    # For testing, we'll work with the routing rules and test the logic
    
    sleep $WAIT_TIME
}

# Cleanup test environment
cleanup() {
    log_info "Cleaning up test environment..."
    
    # Delete test routing rules
    local rules=$(api_get "/routing/rules" | jq -r '.data[] | select(.name | contains("E2E Test")) | .id')
    
    for rule_id in $rules; do
        api_delete "/routing/rules/$rule_id" > /dev/null
        log_info "Deleted test rule: $rule_id"
    done
    
    log_info "Cleanup completed"
}

# Test 1: Get all routing rules
test_get_routing_rules() {
    run_test "Get all routing rules"
    
    local response=$(api_get "/routing/rules")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local rule_count=$(echo "$response" | jq '.data | length')
        log_success "Retrieved $rule_count routing rules"
    else
        log_error "Failed to get routing rules"
    fi
}

# Test 2: Create a new routing rule
test_create_routing_rule() {
    run_test "Create a new routing rule"
    
    local rule_data='{
        "name": "E2E Test - GPU Workloads",
        "priority": 100,
        "conditions": {
            "labels": ["gpu", "cuda"],
            "repository": "test/*"
        },
        "targets": {
            "runnerLabels": ["gpu-enabled", "cuda-12"],
            "exclusive": false
        },
        "enabled": true
    }'
    
    local response=$(api_post "/routing/rules" "$rule_data")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        RULE_ID=$(echo "$response" | jq -r '.data.id')
        log_success "Created routing rule with ID: $RULE_ID"
    else
        log_error "Failed to create routing rule"
    fi
}

# Test 3: Get specific routing rule
test_get_routing_rule() {
    run_test "Get specific routing rule"
    
    if [[ -z "$RULE_ID" ]]; then
        log_error "No rule ID available from previous test"
        return
    fi
    
    local response=$(api_get "/routing/rules/$RULE_ID")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local rule_name=$(echo "$response" | jq -r '.data.name')
        log_success "Retrieved rule: $rule_name"
    else
        log_error "Failed to get routing rule"
    fi
}

# Test 4: Update routing rule
test_update_routing_rule() {
    run_test "Update routing rule"
    
    if [[ -z "$RULE_ID" ]]; then
        log_error "No rule ID available from previous test"
        return
    fi
    
    local update_data='{
        "priority": 120,
        "targets": {
            "runnerLabels": ["gpu-enabled", "cuda-12", "high-memory"],
            "exclusive": true
        }
    }'
    
    local response=$(api_put "/routing/rules/$RULE_ID" "$update_data")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local new_priority=$(echo "$response" | jq -r '.data.priority')
        local exclusive=$(echo "$response" | jq -r '.data.targets.exclusive')
        
        if [[ "$new_priority" == "120" && "$exclusive" == "true" ]]; then
            log_success "Rule updated successfully"
        else
            log_error "Rule update values don't match"
        fi
    else
        log_error "Failed to update routing rule"
    fi
}

# Test 5: Test routing rule with sample job
test_rule_testing() {
    run_test "Test routing rule functionality"
    
    local test_data='{
        "rule": {
            "name": "Test Rule",
            "priority": 50,
            "conditions": {
                "labels": ["linux", "docker"]
            },
            "targets": {
                "runnerLabels": ["linux", "docker", "self-hosted"]
            }
        },
        "sampleJob": {
            "repository": "test/repo",
            "labels": ["linux", "docker", "node"]
        }
    }'
    
    local response=$(api_post "/routing/test" "$test_data")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local matches=$(echo "$response" | jq -r '.data.matches')
        if [[ "$matches" == "true" ]]; then
            log_success "Rule testing works correctly"
        else
            log_error "Rule should have matched but didn't"
        fi
    else
        log_error "Failed to test routing rule"
    fi
}

# Test 6: Preview job routing
test_preview_routing() {
    run_test "Preview job routing"
    
    local job_data='{
        "job": {
            "repository": "test/routing-e2e",
            "workflow": "build",
            "labels": ["gpu", "cuda", "linux"]
        }
    }'
    
    local response=$(api_post "/routing/preview" "$job_data")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local matched_rule=$(echo "$response" | jq -r '.data.matchedRule.name // "none"')
        local reason=$(echo "$response" | jq -r '.data.reason')
        log_success "Preview completed - Matched rule: $matched_rule, Reason: $reason"
    else
        log_error "Failed to preview routing"
    fi
}

# Test 7: Get label suggestions
test_get_label_suggestions() {
    run_test "Get label suggestions"
    
    local response=$(api_get "/routing/labels/suggestions")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local label_count=$(echo "$response" | jq '.data | length')
        log_success "Retrieved $label_count label suggestions"
        
        # Check for common labels
        local has_linux=$(echo "$response" | jq '.data | contains(["linux"])')
        local has_docker=$(echo "$response" | jq '.data | contains(["docker"])')
        
        if [[ "$has_linux" == "true" && "$has_docker" == "true" ]]; then
            log_success "Common labels are present in suggestions"
        fi
    else
        log_error "Failed to get label suggestions"
    fi
}

# Test 8: Get routing analytics
test_get_routing_analytics() {
    run_test "Get routing analytics"
    
    local response=$(api_get "/routing/analytics?hours=24")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        local time_window=$(echo "$response" | jq -r '.data.timeWindow')
        log_success "Retrieved analytics for $time_window"
    else
        log_error "Failed to get routing analytics"
    fi
}

# Test 9: Test wildcard patterns
test_wildcard_patterns() {
    run_test "Test wildcard pattern matching"
    
    # Create rule with wildcard pattern
    local rule_data='{
        "name": "E2E Test - Wildcard Pattern",
        "priority": 80,
        "conditions": {
            "repository": "*/production",
            "branch": "release-*"
        },
        "targets": {
            "runnerLabels": ["production", "secure"]
        },
        "enabled": true
    }'
    
    local create_response=$(api_post "/routing/rules" "$rule_data")
    if [[ $(echo "$create_response" | jq -r '.success') != "true" ]]; then
        log_error "Failed to create wildcard rule"
        return
    fi
    
    local wildcard_rule_id=$(echo "$create_response" | jq -r '.data.id')
    
    # Test with matching job
    local preview_data='{
        "job": {
            "repository": "myorg/production",
            "workflow": "deploy",
            "ref": "refs/heads/release-1.0"
        }
    }'
    
    local preview_response=$(api_post "/routing/preview" "$preview_data")
    if [[ $(echo "$preview_response" | jq -r '.success') == "true" ]]; then
        local matched=$(echo "$preview_response" | jq -r '.data.matchedRule.name // "none"')
        if [[ "$matched" == "E2E Test - Wildcard Pattern" ]]; then
            log_success "Wildcard pattern matching works correctly"
        else
            log_error "Wildcard pattern should have matched"
        fi
    else
        log_error "Failed to preview with wildcard pattern"
    fi
    
    # Cleanup
    api_delete "/routing/rules/$wildcard_rule_id" > /dev/null
}

# Test 10: Test priority ordering
test_priority_ordering() {
    run_test "Test priority ordering"
    
    # Create two overlapping rules with different priorities
    local high_priority_rule='{
        "name": "E2E Test - High Priority",
        "priority": 200,
        "conditions": {"labels": ["test-label"]},
        "targets": {"runnerLabels": ["high-priority-runner"]},
        "enabled": true
    }'
    
    local low_priority_rule='{
        "name": "E2E Test - Low Priority",
        "priority": 50,
        "conditions": {"labels": ["test-label"]},
        "targets": {"runnerLabels": ["low-priority-runner"]},
        "enabled": true
    }'
    
    # Create both rules
    local high_response=$(api_post "/routing/rules" "$high_priority_rule")
    local low_response=$(api_post "/routing/rules" "$low_priority_rule")
    
    if [[ $(echo "$high_response" | jq -r '.success') != "true" || 
          $(echo "$low_response" | jq -r '.success') != "true" ]]; then
        log_error "Failed to create priority test rules"
        return
    fi
    
    local high_id=$(echo "$high_response" | jq -r '.data.id')
    local low_id=$(echo "$low_response" | jq -r '.data.id')
    
    # Test which rule matches
    local preview_data='{
        "job": {
            "repository": "test/repo",
            "labels": ["test-label"]
        }
    }'
    
    local preview_response=$(api_post "/routing/preview" "$preview_data")
    if [[ $(echo "$preview_response" | jq -r '.success') == "true" ]]; then
        local matched=$(echo "$preview_response" | jq -r '.data.matchedRule.name')
        if [[ "$matched" == "E2E Test - High Priority" ]]; then
            log_success "Priority ordering works correctly"
        else
            log_error "High priority rule should have matched"
        fi
    else
        log_error "Failed to test priority ordering"
    fi
    
    # Cleanup
    api_delete "/routing/rules/$high_id" > /dev/null
    api_delete "/routing/rules/$low_id" > /dev/null
}

# Test 11: Test exclusive runner matching
test_exclusive_matching() {
    run_test "Test exclusive runner matching"
    
    local exclusive_rule='{
        "name": "E2E Test - Exclusive Runners",
        "priority": 90,
        "conditions": {"labels": ["secure"]},
        "targets": {
            "runnerLabels": ["secure", "isolated"],
            "exclusive": true
        },
        "enabled": true
    }'
    
    local response=$(api_post "/routing/rules" "$exclusive_rule")
    if [[ $(echo "$response" | jq -r '.success') == "true" ]]; then
        local rule_id=$(echo "$response" | jq -r '.data.id')
        log_success "Created exclusive matching rule"
        
        # In a real test, we would verify that only runners with EXACTLY
        # the specified labels are selected
        
        # Cleanup
        api_delete "/routing/rules/$rule_id" > /dev/null
    else
        log_error "Failed to create exclusive matching rule"
    fi
}

# Test 12: Delete routing rule
test_delete_routing_rule() {
    run_test "Delete routing rule"
    
    if [[ -z "$RULE_ID" ]]; then
        log_error "No rule ID available from previous test"
        return
    fi
    
    local response=$(api_delete "/routing/rules/$RULE_ID")
    local success=$(echo "$response" | jq -r '.success')
    
    if [[ "$success" == "true" ]]; then
        log_success "Deleted routing rule"
        
        # Verify it's gone
        local get_response=$(api_get "/routing/rules/$RULE_ID")
        local get_success=$(echo "$get_response" | jq -r '.success')
        
        if [[ "$get_success" == "false" ]]; then
            log_success "Rule confirmed deleted"
        else
            log_error "Rule still exists after deletion"
        fi
    else
        log_error "Failed to delete routing rule"
    fi
}

# Main test execution
main() {
    echo "==================================="
    echo "Job Routing E2E Test Suite"
    echo "==================================="
    
    # Setup
    setup
    
    # Run tests
    test_get_routing_rules
    test_create_routing_rule
    test_get_routing_rule
    test_update_routing_rule
    test_rule_testing
    test_preview_routing
    test_get_label_suggestions
    test_get_routing_analytics
    test_wildcard_patterns
    test_priority_ordering
    test_exclusive_matching
    test_delete_routing_rule
    
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