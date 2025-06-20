#!/bin/bash

# E2E Test Script for GitHub Webhook Integration
# This script tests the complete webhook processing pipeline

set -e

API_BASE="http://localhost:3000/api"
WEBHOOK_ENDPOINT="$API_BASE/webhooks/github"

echo "================================================"
echo "GitHub Webhook Integration E2E Test"
echo "================================================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

step() {
    echo -e "${BLUE}== $1 ==${NC}"
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

# Test webhook health endpoint
test_webhook_health() {
    step "Testing Webhook Health"
    
    HEALTH_RESPONSE=$(curl -s $API_BASE/webhooks/health)
    echo "Health response: $HEALTH_RESPONSE"
    
    if echo "$HEALTH_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        success "Webhook health endpoint working"
        
        STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.data.status')
        if [ "$STATUS" = "healthy" ]; then
            success "Webhook service is healthy"
        else
            error "Webhook service status: $STATUS"
        fi
    else
        error "Webhook health endpoint failed"
        return 1
    fi
}

# Test ping webhook
test_ping_webhook() {
    step "Testing Ping Webhook"
    
    PING_PAYLOAD='{
        "zen": "Test webhook from RunnerHub E2E test",
        "hook_id": 999999,
        "hook": {
            "type": "Repository",
            "id": 999999,
            "name": "web",
            "active": true,
            "events": ["workflow_job"]
        },
        "repository": {
            "id": 123456,
            "name": "test-repo",
            "full_name": "test-org/test-repo",
            "private": false
        }
    }'
    
    DELIVERY_ID="test-ping-$(date +%s)"
    
    PING_RESPONSE=$(curl -s -X POST $WEBHOOK_ENDPOINT \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: ping" \
        -H "X-GitHub-Delivery: $DELIVERY_ID" \
        -d "$PING_PAYLOAD")
    
    echo "Ping response: $PING_RESPONSE"
    
    if echo "$PING_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        success "Ping webhook processed successfully"
    else
        error "Ping webhook failed"
        return 1
    fi
}

# Test workflow job queued webhook
test_workflow_job_queued() {
    step "Testing Workflow Job Queued Webhook"
    
    JOB_ID=$(date +%s)
    RUN_ID=$((JOB_ID + 1000))
    
    WORKFLOW_JOB_PAYLOAD='{
        "action": "queued",
        "workflow_job": {
            "id": '$JOB_ID',
            "run_id": '$RUN_ID',
            "run_attempt": 1,
            "name": "E2E Test Job",
            "status": "queued",
            "labels": ["ubuntu-latest", "self-hosted"],
            "head_sha": "abc123def456789",
            "url": "https://api.github.com/repos/test-org/test-repo/actions/jobs/'$JOB_ID'",
            "html_url": "https://github.com/test-org/test-repo/actions/runs/'$RUN_ID'/job/'$JOB_ID'",
            "check_run_url": "https://api.github.com/repos/test-org/test-repo/check-runs/'$JOB_ID'",
            "steps": []
        },
        "repository": {
            "id": 123456,
            "name": "test-repo",
            "full_name": "test-org/test-repo",
            "private": false,
            "owner": {
                "login": "test-org",
                "type": "Organization"
            }
        }
    }'
    
    DELIVERY_ID="test-workflow-queued-$(date +%s)"
    
    QUEUED_RESPONSE=$(curl -s -X POST $WEBHOOK_ENDPOINT \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: workflow_job" \
        -H "X-GitHub-Delivery: $DELIVERY_ID" \
        -d "$WORKFLOW_JOB_PAYLOAD")
    
    echo "Workflow job queued response: $QUEUED_RESPONSE"
    
    if echo "$QUEUED_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        success "Workflow job queued webhook processed successfully"
        
        # Store job ID for subsequent tests
        echo $JOB_ID > /tmp/test-job-id
        echo $RUN_ID > /tmp/test-run-id
    else
        error "Workflow job queued webhook failed"
        return 1
    fi
}

# Test workflow job in progress webhook
test_workflow_job_in_progress() {
    step "Testing Workflow Job In Progress Webhook"
    
    if [ ! -f /tmp/test-job-id ]; then
        error "No test job ID found - run queued test first"
        return 1
    fi
    
    JOB_ID=$(cat /tmp/test-job-id)
    RUN_ID=$(cat /tmp/test-run-id)
    RUNNER_ID=999
    
    WORKFLOW_JOB_PAYLOAD='{
        "action": "in_progress",
        "workflow_job": {
            "id": '$JOB_ID',
            "run_id": '$RUN_ID',
            "run_attempt": 1,
            "name": "E2E Test Job",
            "status": "in_progress",
            "conclusion": null,
            "started_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
            "labels": ["ubuntu-latest", "self-hosted"],
            "runner_id": '$RUNNER_ID',
            "runner_name": "test-runner-'$RUNNER_ID'",
            "head_sha": "abc123def456789",
            "url": "https://api.github.com/repos/test-org/test-repo/actions/jobs/'$JOB_ID'",
            "html_url": "https://github.com/test-org/test-repo/actions/runs/'$RUN_ID'/job/'$JOB_ID'",
            "steps": [
                {
                    "name": "Set up job",
                    "status": "completed",
                    "conclusion": "success",
                    "number": 1
                },
                {
                    "name": "Run tests",
                    "status": "in_progress",
                    "conclusion": null,
                    "number": 2
                }
            ]
        },
        "repository": {
            "id": 123456,
            "name": "test-repo",
            "full_name": "test-org/test-repo",
            "private": false
        }
    }'
    
    DELIVERY_ID="test-workflow-progress-$(date +%s)"
    
    PROGRESS_RESPONSE=$(curl -s -X POST $WEBHOOK_ENDPOINT \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: workflow_job" \
        -H "X-GitHub-Delivery: $DELIVERY_ID" \
        -d "$WORKFLOW_JOB_PAYLOAD")
    
    echo "Workflow job in progress response: $PROGRESS_RESPONSE"
    
    if echo "$PROGRESS_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        success "Workflow job in progress webhook processed successfully"
    else
        error "Workflow job in progress webhook failed"
        return 1
    fi
}

# Test workflow job completed webhook
test_workflow_job_completed() {
    step "Testing Workflow Job Completed Webhook"
    
    if [ ! -f /tmp/test-job-id ]; then
        error "No test job ID found - run queued test first"
        return 1
    fi
    
    JOB_ID=$(cat /tmp/test-job-id)
    RUN_ID=$(cat /tmp/test-run-id)
    RUNNER_ID=999
    
    STARTED_TIME=$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
    COMPLETED_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    WORKFLOW_JOB_PAYLOAD='{
        "action": "completed",
        "workflow_job": {
            "id": '$JOB_ID',
            "run_id": '$RUN_ID',
            "run_attempt": 1,
            "name": "E2E Test Job",
            "status": "completed",
            "conclusion": "success",
            "started_at": "'$STARTED_TIME'",
            "completed_at": "'$COMPLETED_TIME'",
            "labels": ["ubuntu-latest", "self-hosted"],
            "runner_id": '$RUNNER_ID',
            "runner_name": "test-runner-'$RUNNER_ID'",
            "head_sha": "abc123def456789",
            "url": "https://api.github.com/repos/test-org/test-repo/actions/jobs/'$JOB_ID'",
            "html_url": "https://github.com/test-org/test-repo/actions/runs/'$RUN_ID'/job/'$JOB_ID'",
            "steps": [
                {
                    "name": "Set up job",
                    "status": "completed",
                    "conclusion": "success",
                    "number": 1,
                    "started_at": "'$STARTED_TIME'",
                    "completed_at": "'$(date -u -d '4 minutes ago' +%Y-%m-%dT%H:%M:%SZ)'"
                },
                {
                    "name": "Run tests",
                    "status": "completed",
                    "conclusion": "success",
                    "number": 2,
                    "started_at": "'$(date -u -d '4 minutes ago' +%Y-%m-%dT%H:%M:%SZ)'",
                    "completed_at": "'$COMPLETED_TIME'"
                }
            ]
        },
        "repository": {
            "id": 123456,
            "name": "test-repo",
            "full_name": "test-org/test-repo",
            "private": false
        }
    }'
    
    DELIVERY_ID="test-workflow-completed-$(date +%s)"
    
    COMPLETED_RESPONSE=$(curl -s -X POST $WEBHOOK_ENDPOINT \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: workflow_job" \
        -H "X-GitHub-Delivery: $DELIVERY_ID" \
        -d "$WORKFLOW_JOB_PAYLOAD")
    
    echo "Workflow job completed response: $COMPLETED_RESPONSE"
    
    if echo "$COMPLETED_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        success "Workflow job completed webhook processed successfully"
    else
        error "Workflow job completed webhook failed"
        return 1
    fi
}

# Test webhook events retrieval
test_webhook_events() {
    step "Testing Webhook Events Retrieval"
    
    # Wait a moment for events to be stored
    sleep 2
    
    EVENTS_RESPONSE=$(curl -s "$API_BASE/webhooks/events?limit=10")
    echo "Events response: $EVENTS_RESPONSE"
    
    if echo "$EVENTS_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        EVENT_COUNT=$(echo "$EVENTS_RESPONSE" | jq -r '.data.events | length')
        info "Retrieved $EVENT_COUNT webhook events"
        
        if [ "$EVENT_COUNT" -gt 0 ]; then
            success "Webhook events retrieved successfully"
            
            # Check if our test events are present
            TEST_EVENTS=$(echo "$EVENTS_RESPONSE" | jq '.data.events[] | select(.repository == "test-org/test-repo") | .event' | wc -l)
            info "Found $TEST_EVENTS test events in results"
        else
            error "No webhook events found"
        fi
    else
        error "Failed to retrieve webhook events"
        return 1
    fi
}

# Test webhook statistics
test_webhook_statistics() {
    step "Testing Webhook Statistics"
    
    STATS_RESPONSE=$(curl -s "$API_BASE/webhooks/statistics?hours=1")
    echo "Statistics response: $STATS_RESPONSE"
    
    if echo "$STATS_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        TOTAL_EVENTS=$(echo "$STATS_RESPONSE" | jq -r '.data.summary.totalEvents')
        PROCESSED_EVENTS=$(echo "$STATS_RESPONSE" | jq -r '.data.summary.processedEvents')
        
        info "Total events in last hour: $TOTAL_EVENTS"
        info "Processed events: $PROCESSED_EVENTS"
        
        success "Webhook statistics retrieved successfully"
        
        # Show breakdown by event type
        echo "$STATS_RESPONSE" | jq -r '.data.byEvent[] | "\(.event): \(.total) total, \(.processed) processed"'
    else
        error "Failed to retrieve webhook statistics"
        return 1
    fi
}

# Test priority calculation with different job types
test_job_priority() {
    step "Testing Job Priority Calculation"
    
    # Test production deployment (high priority)
    PROD_JOB_ID=$(date +%s)000
    PROD_PAYLOAD='{
        "action": "queued",
        "workflow_job": {
            "id": '$PROD_JOB_ID',
            "run_id": '$((PROD_JOB_ID + 1000))',
            "name": "Production Deployment",
            "status": "queued",
            "labels": ["production", "deploy", "ubuntu-latest"],
            "head_sha": "prod123"
        },
        "repository": {
            "full_name": "test-org/test-repo"
        }
    }'
    
    PROD_RESPONSE=$(curl -s -X POST $WEBHOOK_ENDPOINT \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: workflow_job" \
        -H "X-GitHub-Delivery: test-prod-$(date +%s)" \
        -d "$PROD_PAYLOAD")
    
    if echo "$PROD_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        success "Production job webhook processed (should have high priority)"
    else
        error "Production job webhook failed"
    fi
    
    # Test large runner job (lower priority)
    LARGE_JOB_ID=$(date +%s)001
    LARGE_PAYLOAD='{
        "action": "queued",
        "workflow_job": {
            "id": '$LARGE_JOB_ID',
            "run_id": '$((LARGE_JOB_ID + 1000))',
            "name": "Large Test Suite",
            "status": "queued",
            "labels": ["large", "self-hosted"],
            "head_sha": "large123"
        },
        "repository": {
            "full_name": "test-org/test-repo"
        }
    }'
    
    LARGE_RESPONSE=$(curl -s -X POST $WEBHOOK_ENDPOINT \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: workflow_job" \
        -H "X-GitHub-Delivery: test-large-$(date +%s)" \
        -d "$LARGE_PAYLOAD")
    
    if echo "$LARGE_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        success "Large runner job webhook processed (should have lower priority)"
    else
        error "Large runner job webhook failed"
    fi
}

# Test error handling
test_error_handling() {
    step "Testing Error Handling"
    
    # Test missing headers
    MISSING_HEADER_RESPONSE=$(curl -s -X POST $WEBHOOK_ENDPOINT \
        -H "Content-Type: application/json" \
        -d '{"test": "data"}')
    
    if echo "$MISSING_HEADER_RESPONSE" | jq -e '.success == false' > /dev/null 2>&1; then
        success "Missing header error handled correctly"
    else
        error "Missing header should have failed"
    fi
    
    # Test invalid JSON
    INVALID_JSON_RESPONSE=$(curl -s -X POST $WEBHOOK_ENDPOINT \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: ping" \
        -H "X-GitHub-Delivery: test-invalid" \
        -d '{invalid json}')
    
    if echo "$INVALID_JSON_RESPONSE" | jq -e '.success == false' > /dev/null 2>&1; then
        success "Invalid JSON error handled correctly"
    else
        error "Invalid JSON should have failed"
    fi
    
    # Test unsupported event
    UNSUPPORTED_RESPONSE=$(curl -s -X POST $WEBHOOK_ENDPOINT \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: unsupported_event" \
        -H "X-GitHub-Delivery: test-unsupported" \
        -d '{"test": "data"}')
    
    if echo "$UNSUPPORTED_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
        MESSAGE=$(echo "$UNSUPPORTED_RESPONSE" | jq -r '.message')
        if [[ "$MESSAGE" == *"not supported"* ]]; then
            success "Unsupported event handled gracefully"
        else
            error "Unsupported event should indicate not supported"
        fi
    else
        error "Unsupported event handling failed"
    fi
}

# Test webhook test endpoint
test_webhook_test_endpoint() {
    step "Testing Webhook Test Endpoint"
    
    TEST_RESPONSE=$(curl -s -X POST $API_BASE/webhooks/test \
        -H "Content-Type: application/json" \
        -d '{
            "eventType": "ping",
            "repository": "test-org/test-e2e"
        }')
    
    echo "Test endpoint response: $TEST_RESPONSE"
    
    if echo "$TEST_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        success "Webhook test endpoint working"
    else
        error "Webhook test endpoint failed"
        return 1
    fi
}

# Cleanup test files
cleanup_test_files() {
    info "Cleaning up test files..."
    rm -f /tmp/test-job-id /tmp/test-run-id
    success "Test files cleaned up"
}

# Main test execution
main() {
    echo "Starting GitHub Webhook Integration E2E Tests..."
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
    test_webhook_health
    
    echo ""
    test_webhook_test_endpoint
    
    echo ""
    test_ping_webhook
    
    echo ""
    test_workflow_job_queued
    
    echo ""
    test_workflow_job_in_progress
    
    echo ""
    test_workflow_job_completed
    
    echo ""
    test_job_priority
    
    echo ""
    test_webhook_events
    
    echo ""
    test_webhook_statistics
    
    echo ""
    test_error_handling
    
    echo ""
    cleanup_test_files
    
    echo ""
    echo "================================================"
    echo "GitHub Webhook Integration E2E Tests Complete!"
    echo "================================================"
}

# Run main function
main