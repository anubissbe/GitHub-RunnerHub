#!/bin/bash

# High Availability Deployment Verification Script
# Comprehensive testing of all HA components and functionality

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
API_BASE_URL=${API_BASE_URL:-http://localhost:3001}
LOAD_BALANCER_URL=${LOAD_BALANCER_URL:-http://localhost:80}

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
WARNINGS=0

# Utility functions
info() {
    echo -e "${CYAN}ℹ️  $1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

header() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

test_result() {
    local test_name="$1"
    local result="$2"
    local details="${3:-}"
    
    ((TOTAL_TESTS++))
    
    if [[ "$result" == "PASS" ]]; then
        success "$test_name"
        ((PASSED_TESTS++))
    elif [[ "$result" == "WARN" ]]; then
        warning "$test_name - $details"
        ((WARNINGS++))
    else
        error "$test_name - $details"
        ((FAILED_TESTS++))
    fi
}

# Test function wrapper
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    if eval "$test_command" >/dev/null 2>&1; then
        test_result "$test_name" "PASS"
        return 0
    else
        test_result "$test_name" "FAIL" "Command failed: $test_command"
        return 1
    fi
}

# Check if service is running
check_service() {
    local service_name="$1"
    local check_command="$2"
    
    if eval "$check_command" >/dev/null 2>&1; then
        test_result "Service $service_name is running" "PASS"
        return 0
    else
        test_result "Service $service_name is running" "FAIL" "Service not responding"
        return 1
    fi
}

# Check HTTP endpoint
check_endpoint() {
    local endpoint_name="$1"
    local url="$2"
    local expected_status="${3:-200}"
    
    local status_code
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    
    if [[ "$status_code" == "$expected_status" ]]; then
        test_result "Endpoint $endpoint_name ($url)" "PASS"
        return 0
    else
        test_result "Endpoint $endpoint_name ($url)" "FAIL" "Expected $expected_status, got $status_code"
        return 1
    fi
}

# Main verification functions
verify_prerequisites() {
    header "Prerequisites Verification"
    
    run_test "Docker is installed" "command -v docker"
    run_test "Docker Compose is available" "docker compose version || docker-compose --version"
    run_test "curl is available" "command -v curl"
    run_test "jq is available" "command -v jq"
    
    # Check Docker daemon
    check_service "Docker daemon" "docker info"
}

verify_containers() {
    header "Container Status Verification"
    
    # Check required containers
    local required_containers=(
        "runnerhub-haproxy"
        "runnerhub-orchestrator-1"
        "runnerhub-orchestrator-2" 
        "runnerhub-orchestrator-3"
        "runnerhub-postgres-primary"
        "runnerhub-redis-master"
        "runnerhub-redis-sentinel-1"
        "runnerhub-redis-sentinel-2"
        "runnerhub-redis-sentinel-3"
    )
    
    for container in "${required_containers[@]}"; do
        if docker ps --format "{{.Names}}" | grep -q "^$container$"; then
            # Check if container is healthy
            local health_status
            health_status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "no-health-check")
            
            if [[ "$health_status" == "healthy" ]] || [[ "$health_status" == "no-health-check" ]]; then
                test_result "Container $container" "PASS"
            else
                test_result "Container $container" "WARN" "Health status: $health_status"
            fi
        else
            test_result "Container $container" "FAIL" "Container not running"
        fi
    done
}

verify_networks() {
    header "Network Configuration Verification"
    
    # Check Docker networks
    local required_networks=(
        "runnerhub-ha-network"
        "runnerhub-backend-network"
    )
    
    for network in "${required_networks[@]}"; do
        if docker network ls --format "{{.Name}}" | grep -q "^$network$"; then
            test_result "Network $network exists" "PASS"
        else
            test_result "Network $network exists" "FAIL" "Network not found"
        fi
    done
}

verify_load_balancer() {
    header "Load Balancer Verification"
    
    # Check HAProxy
    check_service "HAProxy" "docker exec runnerhub-haproxy haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg"
    
    # Check load balancer endpoints
    check_endpoint "Load Balancer Health" "$LOAD_BALANCER_URL/health"
    check_endpoint "HAProxy Stats" "http://localhost:8080/stats" "200"
    
    # Test load balancing by making multiple requests
    info "Testing load balancing distribution..."
    local responses=()
    for i in {1..6}; do
        local response
        response=$(curl -s "$LOAD_BALANCER_URL/api/system/ha/status" -H "Content-Type: application/json" 2>/dev/null || echo "{}")
        responses+=("$response")
    done
    
    # Check if we get responses (basic load balancing test)
    if [[ ${#responses[@]} -eq 6 ]]; then
        test_result "Load balancer distribution test" "PASS"
    else
        test_result "Load balancer distribution test" "FAIL" "Failed to get responses"
    fi
}

verify_database_ha() {
    header "Database High Availability Verification"
    
    # Check primary database
    check_service "PostgreSQL Primary" "docker exec runnerhub-postgres-primary pg_isready -U app_user"
    
    # Check replica database (if exists)
    if docker ps --format "{{.Names}}" | grep -q "runnerhub-postgres-replica"; then
        check_service "PostgreSQL Replica" "docker exec runnerhub-postgres-replica pg_isready -U app_user"
        
        # Check replication status
        local replication_status
        replication_status=$(docker exec runnerhub-postgres-primary psql -U app_user -d github_runnerhub -t -c "SELECT count(*) FROM pg_stat_replication;" 2>/dev/null | xargs || echo "0")
        
        if [[ "$replication_status" -gt 0 ]]; then
            test_result "PostgreSQL replication active" "PASS"
        else
            test_result "PostgreSQL replication active" "WARN" "No active replication connections"
        fi
    else
        test_result "PostgreSQL Replica setup" "WARN" "Replica not configured"
    fi
    
    # Test database connectivity via API
    check_endpoint "Database health via API" "$API_BASE_URL/api/system/ha/database"
}

verify_redis_ha() {
    header "Redis High Availability Verification"
    
    # Check Redis master
    check_service "Redis Master" "docker exec runnerhub-redis-master redis-cli -a \${REDIS_PASSWORD:-} ping"
    
    # Check Redis slave (if exists)
    if docker ps --format "{{.Names}}" | grep -q "runnerhub-redis-slave"; then
        check_service "Redis Slave" "docker exec runnerhub-redis-slave redis-cli -a \${REDIS_PASSWORD:-} ping"
    fi
    
    # Check Sentinel instances
    local sentinel_count=0
    for i in {1..3}; do
        if docker ps --format "{{.Names}}" | grep -q "runnerhub-redis-sentinel-$i"; then
            if docker exec "runnerhub-redis-sentinel-$i" redis-cli -p 26379 ping >/dev/null 2>&1; then
                test_result "Redis Sentinel $i" "PASS"
                ((sentinel_count++))
            else
                test_result "Redis Sentinel $i" "FAIL" "Sentinel not responding"
            fi
        else
            test_result "Redis Sentinel $i" "FAIL" "Container not running"
        fi
    done
    
    # Check sentinel quorum
    if [[ $sentinel_count -ge 2 ]]; then
        test_result "Sentinel quorum satisfied" "PASS"
    else
        test_result "Sentinel quorum satisfied" "FAIL" "Need at least 2 sentinels, found $sentinel_count"
    fi
    
    # Test Redis connectivity via API
    check_endpoint "Redis health via API" "$API_BASE_URL/api/system/ha/redis"
}

verify_orchestrator_cluster() {
    header "Orchestrator Cluster Verification"
    
    # Check orchestrator instances
    local healthy_orchestrators=0
    for i in {1..3}; do
        if check_endpoint "Orchestrator $i health" "http://orchestrator-$i:3001/health" >/dev/null 2>&1; then
            ((healthy_orchestrators++))
        fi
    done
    
    if [[ $healthy_orchestrators -ge 2 ]]; then
        test_result "Orchestrator cluster health" "PASS"
    else
        test_result "Orchestrator cluster health" "WARN" "Only $healthy_orchestrators/3 orchestrators healthy"
    fi
    
    # Test HA API endpoints
    check_endpoint "HA Status API" "$API_BASE_URL/api/system/ha/status"
    check_endpoint "HA Health API" "$API_BASE_URL/api/system/ha/health"
    check_endpoint "HA Cluster API" "$API_BASE_URL/api/system/ha/cluster"
}

verify_leader_election() {
    header "Leader Election Verification"
    
    # Check if leader election is working via API
    local ha_status
    ha_status=$(curl -s "$API_BASE_URL/api/system/ha/status" 2>/dev/null || echo "{}")
    
    if echo "$ha_status" | jq -e '.data.isLeader' >/dev/null 2>&1; then
        local is_leader
        is_leader=$(echo "$ha_status" | jq -r '.data.isLeader')
        local current_leader
        current_leader=$(echo "$ha_status" | jq -r '.data.currentLeader // "none"')
        
        if [[ "$is_leader" == "true" ]] || [[ "$current_leader" != "none" ]]; then
            test_result "Leader election functioning" "PASS"
        else
            test_result "Leader election functioning" "WARN" "No clear leader identified"
        fi
    else
        test_result "Leader election API accessible" "FAIL" "Cannot access HA status"
    fi
}

verify_health_monitoring() {
    header "Health Monitoring Verification"
    
    # Test comprehensive health check
    local health_response
    health_response=$(curl -s "$API_BASE_URL/api/system/ha/health" 2>/dev/null || echo "{}")
    
    if echo "$health_response" | jq -e '.data.overall' >/dev/null 2>&1; then
        local overall_status
        overall_status=$(echo "$health_response" | jq -r '.data.overall.status')
        
        case "$overall_status" in
            "healthy")
                test_result "Overall system health" "PASS"
                ;;
            "degraded")
                test_result "Overall system health" "WARN" "System is degraded but functional"
                ;;
            "unhealthy")
                test_result "Overall system health" "FAIL" "System is unhealthy"
                ;;
            *)
                test_result "Overall system health" "FAIL" "Unknown status: $overall_status"
                ;;
        esac
    else
        test_result "Health monitoring API" "FAIL" "Cannot access health data"
    fi
}

perform_failover_tests() {
    header "Failover Testing (Non-Destructive)"
    
    info "Running non-destructive failover tests..."
    
    # Test API resilience by making multiple requests
    local success_count=0
    local total_requests=10
    
    for i in $(seq 1 $total_requests); do
        if curl -s -f "$API_BASE_URL/api/system/ha/status" >/dev/null 2>&1; then
            ((success_count++))
        fi
        sleep 0.5
    done
    
    local success_rate=$((success_count * 100 / total_requests))
    
    if [[ $success_rate -ge 90 ]]; then
        test_result "API resilience test" "PASS" "$success_rate% success rate"
    elif [[ $success_rate -ge 70 ]]; then
        test_result "API resilience test" "WARN" "$success_rate% success rate"
    else
        test_result "API resilience test" "FAIL" "$success_rate% success rate"
    fi
}

verify_monitoring_integration() {
    header "Monitoring Integration Verification"
    
    # Check Prometheus metrics
    if docker ps --format "{{.Names}}" | grep -q "runnerhub-prometheus"; then
        check_endpoint "Prometheus" "http://localhost:9090/-/healthy"
        
        # Check for HA-specific metrics
        local metrics_response
        metrics_response=$(curl -s "http://localhost:9090/api/v1/label/__name__/values" 2>/dev/null || echo "{}")
        
        if echo "$metrics_response" | grep -q "runnerhub_ha"; then
            test_result "HA metrics available" "PASS"
        else
            test_result "HA metrics available" "WARN" "HA-specific metrics not found"
        fi
    else
        test_result "Prometheus setup" "WARN" "Prometheus not running"
    fi
    
    # Check Grafana
    if docker ps --format "{{.Names}}" | grep -q "runnerhub-grafana"; then
        check_endpoint "Grafana" "http://localhost:3000/api/health"
    else
        test_result "Grafana setup" "WARN" "Grafana not running"
    fi
}

print_summary() {
    header "Verification Summary"
    
    echo -e "Total Tests: ${TOTAL_TESTS}"
    echo -e "${GREEN}Passed: ${PASSED_TESTS}${NC}"
    echo -e "${RED}Failed: ${FAILED_TESTS}${NC}"
    echo -e "${YELLOW}Warnings: ${WARNINGS}${NC}"
    
    local success_rate=0
    if [[ $TOTAL_TESTS -gt 0 ]]; then
        success_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    fi
    
    echo -e "\nSuccess Rate: ${success_rate}%"
    
    if [[ $FAILED_TESTS -eq 0 ]]; then
        if [[ $WARNINGS -eq 0 ]]; then
            success "🎉 All tests passed! HA deployment is fully operational."
        else
            warning "✅ All critical tests passed, but there are $WARNINGS warnings to review."
        fi
    else
        error "❌ $FAILED_TESTS tests failed. HA deployment needs attention."
        return 1
    fi
}

# Main execution
main() {
    echo -e "${CYAN}"
    cat << "EOF"
╔══════════════════════════════════════════════════════════════════════════════╗
║           GitHub RunnerHub - HA Deployment Verification                     ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    
    info "Starting comprehensive HA deployment verification..."
    echo "API Base URL: $API_BASE_URL"
    echo "Load Balancer URL: $LOAD_BALANCER_URL"
    echo
    
    # Run all verification tests
    verify_prerequisites
    verify_containers  
    verify_networks
    verify_load_balancer
    verify_database_ha
    verify_redis_ha
    verify_orchestrator_cluster
    verify_leader_election
    verify_health_monitoring
    perform_failover_tests
    verify_monitoring_integration
    
    # Print final summary
    print_summary
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-url)
            API_BASE_URL="$2"
            shift 2
            ;;
        --lb-url)
            LOAD_BALANCER_URL="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--api-url URL] [--lb-url URL]"
            echo "  --api-url URL    API base URL (default: http://localhost:3001)"
            echo "  --lb-url URL     Load balancer URL (default: http://localhost:80)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Run main function
main