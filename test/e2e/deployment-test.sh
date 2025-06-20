#!/bin/bash

# GitHub RunnerHub - E2E Deployment Test
# This script performs end-to-end testing of the deployed instance

set -euo pipefail

# Configuration
DEPLOYMENT_HOST="${DEPLOYMENT_HOST:-192.168.1.16}"
DEPLOYMENT_PORT="${DEPLOYMENT_PORT:-3001}"
BASE_URL="http://${DEPLOYMENT_HOST}:${DEPLOYMENT_PORT}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Test functions
test_endpoint() {
    local endpoint=$1
    local expected_status=${2:-200}
    local description=$3
    
    echo -n "Testing ${description}... "
    
    status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${endpoint}")
    
    if [ "$status" -eq "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Expected: ${expected_status}, Got: ${status})"
        ((TESTS_FAILED++))
        return 1
    fi
}

test_json_response() {
    local endpoint=$1
    local json_path=$2
    local expected_value=$3
    local description=$4
    
    echo -n "Testing ${description}... "
    
    response=$(curl -s "${BASE_URL}${endpoint}")
    actual_value=$(echo "$response" | jq -r "$json_path" 2>/dev/null || echo "PARSE_ERROR")
    
    if [ "$actual_value" = "$expected_value" ]; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Expected: ${expected_value}, Got: ${actual_value})"
        ((TESTS_FAILED++))
        return 1
    fi
}

test_websocket() {
    local description="WebSocket connectivity"
    
    echo -n "Testing ${description}... "
    
    # Check if socket.io.js is available
    status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/socket.io/socket.io.js")
    
    if [ "$status" -eq "200" ]; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Socket.io not available)"
        ((TESTS_FAILED++))
        return 1
    fi
}

test_docker_containers() {
    local description="Docker containers on remote"
    
    echo -n "Testing ${description}... "
    
    if command -v ssh &> /dev/null && ssh -q git-runner true 2>/dev/null; then
        containers=$(ssh git-runner "docker ps --format '{{.Names}}' | grep runnerhub | wc -l")
        if [ "$containers" -ge "3" ]; then
            echo -e "${GREEN}✓ PASS${NC} (${containers} containers running)"
            ((TESTS_PASSED++))
            return 0
        else
            echo -e "${RED}✗ FAIL${NC} (Only ${containers} containers running)"
            ((TESTS_FAILED++))
            return 1
        fi
    else
        echo -e "${YELLOW}⚠ SKIP${NC} (SSH not available)"
        return 0
    fi
}

# Main test execution
echo "=================================="
echo "GitHub RunnerHub E2E Testing"
echo "Target: ${BASE_URL}"
echo "=================================="
echo

# 1. Basic connectivity tests
echo "1. Basic Connectivity Tests"
echo "---------------------------"
test_endpoint "/health" 200 "Health endpoint"
test_endpoint "/api" 200 "API info endpoint"
test_endpoint "/dashboard" 200 "Dashboard page"
test_endpoint "/favicon.ico" 204 "Favicon handling"
echo

# 2. API response tests
echo "2. API Response Tests"
echo "---------------------"
test_json_response "/health" ".status" "ok" "Health status check"
test_json_response "/api" ".name" "GitHub RunnerHub" "API name check"
test_json_response "/api" ".status" "running" "API running status"
test_json_response "/health" ".redis.connected" "true" "Redis connectivity"
test_json_response "/health" ".database.connected" "true" "Database connectivity"
echo

# 3. Dashboard functionality tests
echo "3. Dashboard Tests"
echo "------------------"
test_endpoint "/api/jobs" 200 "Jobs API endpoint"
test_endpoint "/api/runners" 200 "Runners API endpoint"
test_endpoint "/api/metrics" 200 "Metrics API endpoint"
test_websocket
echo

# 4. Infrastructure tests
echo "4. Infrastructure Tests"
echo "-----------------------"
test_docker_containers
echo

# 5. Performance tests
echo "5. Performance Tests"
echo "--------------------"
echo -n "Testing response time... "
response_time=$(curl -s -o /dev/null -w "%{time_total}" "${BASE_URL}/health")
if (( $(echo "$response_time < 1.0" | bc -l) )); then
    echo -e "${GREEN}✓ PASS${NC} (${response_time}s)"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (${response_time}s - too slow)"
    ((TESTS_FAILED++))
fi
echo

# 6. Security tests
echo "6. Security Tests"
echo "-----------------"
test_endpoint "/api/auth/login" 401 "Auth endpoint (no credentials)"
test_endpoint "/.env" 404 "Environment file protection"
test_endpoint "/node_modules" 404 "Node modules protection"
echo

# Summary
echo "=================================="
echo "Test Summary"
echo "=================================="
echo -e "Tests Passed: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Tests Failed: ${RED}${TESTS_FAILED}${NC}"
echo

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed!${NC}"
    exit 1
fi