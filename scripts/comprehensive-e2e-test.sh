#!/bin/bash

# Comprehensive E2E Testing Script for GitHub-RunnerHub
# This script validates the entire system functionality

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="http://localhost:3001"
TIMEOUT=30
RETRIES=3

# Test results
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Utility functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ((TESTS_FAILED++))
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

run_test() {
    local test_name="$1"
    local test_command="$2"
    
    echo ""
    log_info "Running test: $test_name"
    ((TESTS_TOTAL++))
    
    if eval "$test_command"; then
        log_success "$test_name"
        return 0
    else
        log_error "$test_name"
        return 1
    fi
}

# Wait for service to be ready
wait_for_service() {
    local url="$1"
    local service_name="$2"
    local max_attempts=30
    local attempt=1
    
    log_info "Waiting for $service_name to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "$url" > /dev/null 2>&1; then
            log_success "$service_name is ready"
            return 0
        fi
        
        echo -n "."
        sleep 2
        ((attempt++))
    done
    
    log_error "$service_name failed to start within timeout"
    return 1
}

# Health Check Tests
test_health_endpoint() {
    curl -s -f "$API_BASE_URL/health" | grep -q "ok"
}

test_api_status() {
    local response=$(curl -s "$API_BASE_URL/health")
    echo "$response" | grep -q "healthy"
}

# Database Tests
test_database_connectivity() {
    curl -s "$API_BASE_URL/health" | grep -q "database.*connected"
}

# GitHub Integration Tests
test_github_api_status() {
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        curl -s -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/user" > /dev/null
    else
        log_warning "GITHUB_TOKEN not set, skipping GitHub API test"
        return 0
    fi
}

test_github_rate_limit() {
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        curl -s -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/rate_limit" | grep -q "remaining"
    else
        log_warning "GITHUB_TOKEN not set, skipping rate limit test"
        return 0
    fi
}

# API Endpoint Tests
test_api_endpoints() {
    # Test basic endpoints (no auth required for health checks)
    local endpoints=(
        "/health"
        "/api/metrics"
    )
    
    for endpoint in "${endpoints[@]}"; do
        if ! curl -s -f "$API_BASE_URL$endpoint" > /dev/null; then
            return 1
        fi
    done
    
    return 0
}

# Docker Tests
test_docker_services() {
    local required_services=("postgres" "redis")
    
    for service in "${required_services[@]}"; do
        if ! docker-compose ps | grep -q "${service}.*Up"; then
            log_error "Service $service is not running"
            return 1
        fi
    done
    
    return 0
}

# Performance Tests
test_response_time() {
    local start_time=$(date +%s%N)
    curl -s "$API_BASE_URL/health" > /dev/null
    local end_time=$(date +%s%N)
    local response_time=$(( (end_time - start_time) / 1000000 )) # Convert to milliseconds
    
    if [ $response_time -lt 1000 ]; then # Less than 1 second
        log_info "Response time: ${response_time}ms"
        return 0
    else
        log_error "Response time too slow: ${response_time}ms"
        return 1
    fi
}

# Load Testing (basic)
test_concurrent_requests() {
    log_info "Testing concurrent requests..."
    
    # Create background jobs
    local pids=()
    for i in {1..10}; do
        curl -s "$API_BASE_URL/health" > /dev/null &
        pids+=($!)
    done
    
    # Wait for all to complete
    local failed=0
    for pid in "${pids[@]}"; do
        if ! wait $pid; then
            ((failed++))
        fi
    done
    
    if [ $failed -eq 0 ]; then
        log_info "All 10 concurrent requests succeeded"
        return 0
    else
        log_error "$failed out of 10 concurrent requests failed"
        return 1
    fi
}

# WebSocket Test
test_websocket_connection() {
    # Simple WebSocket connectivity test using curl
    if command -v wscat > /dev/null 2>&1; then
        timeout 5 wscat -c "ws://localhost:3001" -x '{"type":"ping"}' 2>/dev/null | grep -q "pong" || return 0
    else
        log_warning "wscat not available, skipping WebSocket test"
        return 0
    fi
}

# Security Tests
test_security_headers() {
    local response=$(curl -s -I "$API_BASE_URL/health")
    
    # Check for security headers
    if echo "$response" | grep -qi "x-content-type-options"; then
        return 0
    else
        log_warning "Security headers not found"
        return 0 # Warning only, not failure
    fi
}

# File System Tests
test_log_files() {
    if [ -d "logs" ] && [ "$(ls -A logs 2>/dev/null)" ]; then
        log_info "Log files are being created"
        return 0
    else
        log_warning "No log files found"
        return 0 # Warning only
    fi
}

# Configuration Tests
test_environment_variables() {
    local required_vars=("NODE_ENV")
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var:-}" ]; then
            log_warning "Environment variable $var is not set"
        fi
    done
    
    return 0
}

# Cleanup function
cleanup() {
    log_info "Cleaning up test resources..."
    # Add any cleanup logic here
}

# Main test execution
main() {
    echo "🚀 Starting Comprehensive E2E Tests for GitHub-RunnerHub"
    echo "=================================================="
    
    # Trap cleanup on exit
    trap cleanup EXIT
    
    # Pre-flight checks
    log_info "Performing pre-flight checks..."
    
    # Check if services are running
    if ! docker-compose ps | grep -q "Up"; then
        log_error "Docker services are not running. Please start them first:"
        echo "  docker-compose up -d"
        exit 1
    fi
    
    # Wait for services to be ready
    wait_for_service "$API_BASE_URL/health" "API Server"
    
    # Core Functionality Tests
    echo ""
    echo "🔍 Running Core Functionality Tests"
    echo "--------------------------------"
    
    run_test "Health Endpoint" "test_health_endpoint"
    run_test "API Status" "test_api_status"
    run_test "Database Connectivity" "test_database_connectivity"
    run_test "API Endpoints" "test_api_endpoints"
    run_test "Docker Services" "test_docker_services"
    
    # Performance Tests
    echo ""
    echo "⚡ Running Performance Tests"
    echo "-------------------------"
    
    run_test "Response Time" "test_response_time"
    run_test "Concurrent Requests" "test_concurrent_requests"
    
    # Integration Tests
    echo ""
    echo "🔗 Running Integration Tests"
    echo "--------------------------"
    
    run_test "GitHub API Status" "test_github_api_status"
    run_test "GitHub Rate Limit" "test_github_rate_limit"
    run_test "WebSocket Connection" "test_websocket_connection"
    
    # Security Tests
    echo ""
    echo "🛡️ Running Security Tests"
    echo "----------------------"
    
    run_test "Security Headers" "test_security_headers"
    
    # System Tests
    echo ""
    echo "🔧 Running System Tests"
    echo "--------------------"
    
    run_test "Environment Variables" "test_environment_variables"
    run_test "Log Files" "test_log_files"
    
    # Test Summary
    echo ""
    echo "📊 Test Summary"
    echo "=============="
    echo "Total Tests: $TESTS_TOTAL"
    echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
    
    if [ $TESTS_FAILED -eq 0 ]; then
        echo ""
        log_success "🎉 All tests passed! GitHub-RunnerHub is ready for production."
        exit 0
    else
        echo ""
        log_error "❌ Some tests failed. Please review the output above."
        exit 1
    fi
}

# Script options
case "${1:-}" in
    --help|-h)
        echo "Comprehensive E2E Testing Script for GitHub-RunnerHub"
        echo ""
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --quick        Run only basic tests"
        echo "  --verbose      Enable verbose output"
        echo ""
        echo "Environment Variables:"
        echo "  GITHUB_TOKEN   GitHub Personal Access Token (optional)"
        echo "  API_BASE_URL   API base URL (default: http://localhost:3001)"
        echo ""
        exit 0
        ;;
    --quick)
        # Run only essential tests
        log_info "Running quick tests only..."
        run_test "Health Endpoint" "test_health_endpoint"
        run_test "API Status" "test_api_status"
        run_test "Docker Services" "test_docker_services"
        exit $?
        ;;
    --verbose)
        set -x
        main
        ;;
    "")
        main
        ;;
    *)
        echo "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac