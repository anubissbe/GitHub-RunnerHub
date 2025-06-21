#!/bin/bash

# Performance Validation Script
# Validates that optimizations are working correctly

set -euo pipefail

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:3000}"
PERFORMANCE_THRESHOLD_MS=500
THROUGHPUT_THRESHOLD=50

echo "🔍 Validating GitHub-RunnerHub Performance..."

# Test response time
echo "Testing response time..."
response_time=$(curl -w "%{time_total}" -s -o /dev/null "$ORCHESTRATOR_URL/health")
response_time_ms=$(echo "$response_time * 1000" | bc)

if (( $(echo "$response_time_ms < $PERFORMANCE_THRESHOLD_MS" | bc -l) )); then
    echo "✅ Response time: ${response_time_ms}ms (< ${PERFORMANCE_THRESHOLD_MS}ms)"
else
    echo "❌ Response time: ${response_time_ms}ms (> ${PERFORMANCE_THRESHOLD_MS}ms)"
    exit 1
fi

# Test throughput capacity
echo "Testing throughput capacity..."
for i in {1..10}; do
    curl -s "$ORCHESTRATOR_URL/api/health" > /dev/null &
done
wait

echo "✅ Throughput test completed"

# Validate resource usage
echo "Checking resource usage..."
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep runnerhub-

echo "✅ Performance validation completed successfully"
