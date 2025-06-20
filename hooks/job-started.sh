#!/bin/bash
# GitHub Actions Runner Job Started Hook
# This script is called when a job is assigned to the runner

set -euo pipefail

# Logging function
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >&2
}

log "Job delegation hook triggered"

# Required environment variables
REQUIRED_VARS=(
    "GITHUB_JOB"
    "GITHUB_RUN_ID"
    "GITHUB_REPOSITORY"
    "GITHUB_WORKFLOW"
    "RUNNER_NAME"
    "ORCHESTRATOR_URL"
)

# Check required variables
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        log "ERROR: Required variable $var is not set"
        exit 1
    fi
done

# Extract additional context
GITHUB_SHA="${GITHUB_SHA:-}"
GITHUB_REF="${GITHUB_REF:-}"
GITHUB_EVENT_NAME="${GITHUB_EVENT_NAME:-}"
GITHUB_ACTOR="${GITHUB_ACTOR:-}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted}"

# Create job context JSON
JOB_CONTEXT=$(jq -n \
    --arg jobId "$GITHUB_JOB" \
    --arg runId "$GITHUB_RUN_ID" \
    --arg repository "$GITHUB_REPOSITORY" \
    --arg workflow "$GITHUB_WORKFLOW" \
    --arg runnerName "$RUNNER_NAME" \
    --arg sha "$GITHUB_SHA" \
    --arg ref "$GITHUB_REF" \
    --arg eventName "$GITHUB_EVENT_NAME" \
    --arg actor "$GITHUB_ACTOR" \
    --arg labels "$RUNNER_LABELS" \
    '{
        jobId: $jobId,
        runId: $runId,
        repository: $repository,
        workflow: $workflow,
        runnerName: $runnerName,
        sha: $sha,
        ref: $ref,
        eventName: $eventName,
        actor: $actor,
        labels: ($labels | split(","))
    }')

log "Delegating job to orchestrator: $GITHUB_REPOSITORY/$GITHUB_WORKFLOW"

# Send delegation request
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${ORCHESTRATOR_URL}/api/jobs/delegate" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${RUNNER_TOKEN:-}" \
    -d "$JOB_CONTEXT" \
    2>/dev/null || echo "000")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 201 ]; then
    log "Job successfully delegated"
    
    # Extract delegation ID if provided
    DELEGATION_ID=$(echo "$BODY" | jq -r '.delegationId // empty' 2>/dev/null || echo "")
    if [ -n "$DELEGATION_ID" ]; then
        echo "$DELEGATION_ID" > /tmp/delegation-${GITHUB_RUN_ID}-${GITHUB_JOB}.id
    fi
    
    # Exit with special code to skip job execution on proxy runner
    exit 78
else
    log "ERROR: Failed to delegate job. HTTP code: $HTTP_CODE"
    log "Response: $BODY"
    
    # Continue with normal execution if delegation fails
    exit 0
fi