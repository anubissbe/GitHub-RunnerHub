#!/bin/bash

# E2E Test Script for Container Cleanup Service
# This script tests the automated cleanup functionality

set -e

API_BASE="http://localhost:3000/api"
DOCKER_NETWORK="runnerhub-network"

echo "================================================"
echo "Container Cleanup E2E Test"
echo "================================================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
success() {
    echo -e "${GREEN}✓ $1${NC}"
}

error() {
    echo -e "${RED}✗ $1${NC}"
}

info() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Wait for API to be ready
wait_for_api() {
    info "Waiting for API to be ready..."
    for i in {1..30}; do
        if curl -s http://localhost:3000/health > /dev/null 2>&1; then
            success "API is ready"
            return 0
        fi
        sleep 1
    done
    error "API failed to start"
    exit 1
}

# Create test containers
create_test_containers() {
    info "Creating test containers..."
    
    # Create network if it doesn't exist
    docker network create $DOCKER_NETWORK 2>/dev/null || true
    
    # 1. Create an idle container (should be cleaned up)
    info "Creating idle container..."
    docker run -d \
        --name test-idle-container \
        --label runnerhub.managed=true \
        --label runnerhub.runner.id=test-runner-1 \
        --network $DOCKER_NETWORK \
        alpine:latest sleep 3600
    
    # 2. Create a failed container (should be cleaned up)
    info "Creating failed container..."
    docker run -d \
        --name test-failed-container \
        --label runnerhub.managed=true \
        --label runnerhub.runner.id=test-runner-2 \
        --label runnerhub.job.id=test-job-1 \
        --network $DOCKER_NETWORK \
        alpine:latest sh -c "exit 1" || true
    
    # 3. Create an orphaned container (should be cleaned up)
    info "Creating orphaned container..."
    docker run -d \
        --name test-orphaned-container \
        --label runnerhub.managed=true \
        --network $DOCKER_NETWORK \
        alpine:latest sleep 3600
    
    # 4. Create a persistent container (should NOT be cleaned up)
    info "Creating persistent container..."
    docker run -d \
        --name test-persistent-container \
        --label runnerhub.managed=true \
        --label runnerhub.persistent=true \
        --label runnerhub.runner.id=test-runner-3 \
        --network $DOCKER_NETWORK \
        alpine:latest sleep 3600
    
    success "Test containers created"
}

# Test cleanup policies API
test_cleanup_policies() {
    info "Testing cleanup policies API..."
    
    # Get all policies
    POLICIES=$(curl -s $API_BASE/cleanup/policies)
    echo "Policies response: $POLICIES"
    
    if [ -z "$POLICIES" ]; then
        error "Failed to get cleanup policies"
        return 1
    fi
    
    # Check if all default policies exist
    if echo "$POLICIES" | jq -e '.data[] | select(.id == "idle-containers")' > /dev/null; then
        success "Idle containers policy found"
    else
        error "Idle containers policy not found"
    fi
    
    if echo "$POLICIES" | jq -e '.data[] | select(.id == "failed-containers")' > /dev/null; then
        success "Failed containers policy found"
    else
        error "Failed containers policy not found"
    fi
    
    if echo "$POLICIES" | jq -e '.data[] | select(.id == "orphaned-containers")' > /dev/null; then
        success "Orphaned containers policy found"
    else
        error "Orphaned containers policy not found"
    fi
    
    if echo "$POLICIES" | jq -e '.data[] | select(.id == "expired-containers")' > /dev/null; then
        success "Expired containers policy found"
    else
        error "Expired containers policy not found"
    fi
}

# Test cleanup preview
test_cleanup_preview() {
    info "Testing cleanup preview..."
    
    PREVIEW=$(curl -s $API_BASE/cleanup/preview)
    echo "Preview response: $PREVIEW"
    
    if [ -z "$PREVIEW" ]; then
        error "Failed to get cleanup preview"
        return 1
    fi
    
    # Check if containers are identified for cleanup
    CONTAINERS_TO_CLEAN=$(echo "$PREVIEW" | jq -r '.data.containersToClean | length')
    info "Containers identified for cleanup: $CONTAINERS_TO_CLEAN"
    
    if [ "$CONTAINERS_TO_CLEAN" -gt 0 ]; then
        success "Cleanup preview identified containers"
        echo "$PREVIEW" | jq '.data.containersToClean[]'
    else
        error "No containers identified for cleanup"
    fi
}

# Test manual cleanup trigger
test_cleanup_trigger() {
    info "Testing manual cleanup trigger..."
    
    # Count containers before cleanup
    BEFORE_COUNT=$(docker ps -a --filter "label=runnerhub.managed=true" -q | wc -l)
    info "Containers before cleanup: $BEFORE_COUNT"
    
    # Trigger cleanup
    TRIGGER_RESPONSE=$(curl -s -X POST $API_BASE/cleanup/trigger)
    echo "Trigger response: $TRIGGER_RESPONSE"
    
    if [ -z "$TRIGGER_RESPONSE" ]; then
        error "Failed to trigger cleanup"
        return 1
    fi
    
    # Wait for cleanup to complete
    sleep 5
    
    # Get last cleanup result
    LAST_RESULT=$(curl -s $API_BASE/cleanup/last-result)
    echo "Last cleanup result: $LAST_RESULT"
    
    if [ -z "$LAST_RESULT" ]; then
        error "Failed to get last cleanup result"
        return 1
    fi
    
    # Check cleanup statistics
    CLEANED_COUNT=$(echo "$LAST_RESULT" | jq -r '.data.containersCleaned')
    INSPECTED_COUNT=$(echo "$LAST_RESULT" | jq -r '.data.containersInspected')
    
    info "Containers inspected: $INSPECTED_COUNT"
    info "Containers cleaned: $CLEANED_COUNT"
    
    # Count containers after cleanup
    AFTER_COUNT=$(docker ps -a --filter "label=runnerhub.managed=true" -q | wc -l)
    info "Containers after cleanup: $AFTER_COUNT"
    
    # Verify persistent container is still running
    if docker ps --filter "name=test-persistent-container" -q | grep -q .; then
        success "Persistent container preserved"
    else
        error "Persistent container was removed!"
    fi
    
    # Verify other containers were cleaned
    if [ "$AFTER_COUNT" -lt "$BEFORE_COUNT" ]; then
        success "Containers were cleaned up"
    else
        error "No containers were cleaned up"
    fi
}

# Test cleanup history
test_cleanup_history() {
    info "Testing cleanup history..."
    
    HISTORY=$(curl -s "$API_BASE/cleanup/history?hours=1")
    echo "History response: $HISTORY"
    
    if [ -z "$HISTORY" ]; then
        error "Failed to get cleanup history"
        return 1
    fi
    
    HISTORY_COUNT=$(echo "$HISTORY" | jq -r '.data.history | length')
    if [ "$HISTORY_COUNT" -gt 0 ]; then
        success "Cleanup history recorded"
        echo "$HISTORY" | jq '.data.history[0]'
    else
        error "No cleanup history found"
    fi
}

# Test policy update
test_policy_update() {
    info "Testing policy update..."
    
    # Update idle container policy
    UPDATE_RESPONSE=$(curl -s -X PUT $API_BASE/cleanup/policies/idle-containers \
        -H "Content-Type: application/json" \
        -d '{
            "conditions": {
                "idleTimeMinutes": 45
            }
        }')
    
    echo "Update response: $UPDATE_RESPONSE"
    
    if [ -z "$UPDATE_RESPONSE" ]; then
        error "Failed to update policy"
        return 1
    fi
    
    # Verify update
    POLICY=$(curl -s $API_BASE/cleanup/policies | jq '.data[] | select(.id == "idle-containers")')
    IDLE_TIME=$(echo "$POLICY" | jq -r '.conditions.idleTimeMinutes')
    
    if [ "$IDLE_TIME" == "45" ]; then
        success "Policy updated successfully"
    else
        error "Policy update failed"
    fi
}

# Test cleanup statistics
test_cleanup_statistics() {
    info "Testing cleanup statistics..."
    
    STATS=$(curl -s "$API_BASE/cleanup/statistics?days=1")
    echo "Statistics response: $STATS"
    
    if [ -z "$STATS" ]; then
        error "Failed to get cleanup statistics"
        return 1
    fi
    
    # Check summary
    TOTAL_CLEANED=$(echo "$STATS" | jq -r '.data.summary.totalContainersCleaned')
    ENABLED_POLICIES=$(echo "$STATS" | jq -r '.data.summary.enabledPolicies')
    
    info "Total containers cleaned: $TOTAL_CLEANED"
    info "Enabled policies: $ENABLED_POLICIES"
    
    if [ "$ENABLED_POLICIES" -eq 4 ]; then
        success "All policies enabled"
    else
        error "Not all policies are enabled"
    fi
}

# Cleanup test resources
cleanup_test_resources() {
    info "Cleaning up test resources..."
    
    # Remove test containers
    docker rm -f test-idle-container 2>/dev/null || true
    docker rm -f test-failed-container 2>/dev/null || true
    docker rm -f test-orphaned-container 2>/dev/null || true
    docker rm -f test-persistent-container 2>/dev/null || true
    
    success "Test resources cleaned up"
}

# Main test execution
main() {
    echo "Starting Container Cleanup E2E Tests..."
    echo ""
    
    # Ensure we're in the project directory
    cd "$(dirname "$0")/.."
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        error "jq is required for JSON parsing. Please install it."
        exit 1
    fi
    
    # Wait for API
    wait_for_api
    
    # Run tests
    echo ""
    echo "=== Test 1: Cleanup Policies API ==="
    test_cleanup_policies
    
    echo ""
    echo "=== Test 2: Creating Test Containers ==="
    create_test_containers
    
    # Wait for containers to be registered
    sleep 3
    
    echo ""
    echo "=== Test 3: Cleanup Preview ==="
    test_cleanup_preview
    
    echo ""
    echo "=== Test 4: Manual Cleanup Trigger ==="
    test_cleanup_trigger
    
    echo ""
    echo "=== Test 5: Cleanup History ==="
    test_cleanup_history
    
    echo ""
    echo "=== Test 6: Policy Update ==="
    test_policy_update
    
    echo ""
    echo "=== Test 7: Cleanup Statistics ==="
    test_cleanup_statistics
    
    echo ""
    echo "=== Cleanup ==="
    cleanup_test_resources
    
    echo ""
    echo "================================================"
    echo "Container Cleanup E2E Tests Complete!"
    echo "================================================"
}

# Run main function
main