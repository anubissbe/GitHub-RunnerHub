#!/bin/bash

# Continuous Performance Monitoring Script
# Monitors key performance metrics and alerts on issues

set -euo pipefail

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:3000}"
MONITORING_INTERVAL=30
LOG_FILE="/tmp/performance-monitor.log"

echo "📊 Starting continuous performance monitoring..."
echo "Monitoring interval: ${MONITORING_INTERVAL}s"
echo "Log file: $LOG_FILE"

while true; do
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Check health endpoint
    if curl -f -s "$ORCHESTRATOR_URL/health" > /dev/null; then
        health_status="OK"
    else
        health_status="FAILED"
    fi
    
    # Get response time
    response_time=$(curl -w "%{time_total}" -s -o /dev/null "$ORCHESTRATOR_URL/health" 2>/dev/null || echo "0")
    
    # Get container stats
    container_stats=$(docker stats --no-stream --format "{{.CPUPerc}},{{.MemUsage}}" runnerhub-orchestrator-optimized 2>/dev/null || echo "0%,0B / 0B")
    
    # Log metrics
    echo "$timestamp,Health:$health_status,ResponseTime:${response_time}s,Stats:$container_stats" >> "$LOG_FILE"
    
    # Check for performance issues
    if [[ "$health_status" != "OK" ]]; then
        echo "⚠️ Health check failed at $timestamp"
    fi
    
    response_time_ms=$(echo "$response_time * 1000" | bc 2>/dev/null || echo "0")
    if (( $(echo "$response_time_ms > 1000" | bc -l 2>/dev/null || echo "0") )); then
        echo "⚠️ High response time: ${response_time_ms}ms at $timestamp"
    fi
    
    sleep "$MONITORING_INTERVAL"
done
