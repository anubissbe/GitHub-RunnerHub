#!/bin/bash
# GitHub Actions Runner Job Completed Hook
# This script is called when a job completes

set -euo pipefail

# Logging function
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >&2
}

log "Job completion hook triggered"

# Check if this was a delegated job
DELEGATION_FILE="/tmp/delegation-${GITHUB_RUN_ID}-${GITHUB_JOB}.id"
if [ -f "$DELEGATION_FILE" ]; then
    DELEGATION_ID=$(cat "$DELEGATION_FILE")
    log "Notifying orchestrator of delegated job completion: $DELEGATION_ID"
    
    # Send completion notification
    curl -s -X POST \
        "${ORCHESTRATOR_URL}/api/jobs/${DELEGATION_ID}/proxy-complete" \
        -H "Authorization: Bearer ${RUNNER_TOKEN:-}" \
        -H "Content-Type: application/json" \
        -d "{\"status\": \"completed\", \"runId\": \"$GITHUB_RUN_ID\", \"jobId\": \"$GITHUB_JOB\"}" \
        2>/dev/null || log "WARNING: Failed to notify orchestrator"
    
    # Clean up delegation file
    rm -f "$DELEGATION_FILE"
fi

log "Job completion hook finished"
exit 0