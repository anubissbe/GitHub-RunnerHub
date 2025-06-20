#!/bin/bash
set -e

# Required environment variables
REQUIRED_VARS=(
    "GITHUB_TOKEN"
    "GITHUB_URL"
    "ORCHESTRATOR_URL"
)

# Check required variables
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo "Error: Required environment variable $var is not set"
        exit 1
    fi
done

# Set defaults
RUNNER_NAME="${RUNNER_NAME:-proxy-runner-$(hostname)}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,proxy}"
RUNNER_GROUP="${RUNNER_GROUP:-default}"

# Export variables for hooks
export ORCHESTRATOR_URL
export RUNNER_TOKEN="${GITHUB_TOKEN}"
export RUNNER_LABELS
export RUNNER_NAME

# Configure runner
echo "Configuring runner..."
./config.sh \
    --url "${GITHUB_URL}" \
    --token "${GITHUB_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS}" \
    --work "${RUNNER_WORK_DIRECTORY}" \
    --runnergroup "${RUNNER_GROUP}" \
    --unattended \
    --replace

# Cleanup function
cleanup() {
    echo "Removing runner..."
    ./config.sh remove --token "${GITHUB_TOKEN}" || true
    exit
}

# Register cleanup
trap cleanup EXIT

# Run the runner
echo "Starting runner..."
exec ./run.sh