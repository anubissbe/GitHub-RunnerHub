#!/bin/bash

# GitHub-RunnerHub Installation Verification Script
# Verifies that all components are working correctly
# Version: 1.0.0

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_PROJECT_NAME="github-runnerhub"
API_BASE_URL="http://localhost:3000"
WEBSOCKET_URL="ws://localhost:3001"
GRAFANA_URL="http://localhost:3002"
PROMETHEUS_URL="http://localhost:9090"

# Test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
WARNINGS=0

print_header() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                 GitHub-RunnerHub Installation Verification                  ║"
    echo "║                                                                              ║"
    echo "║  This script verifies that all components are working correctly             ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

log() {
    local level=$1
    shift
    local message="$*"
    
    case $level in
        "PASS")
            echo -e "${GREEN}✅ [PASS]${NC} $message"
            ((PASSED_TESTS++))
            ;;
        "FAIL")
            echo -e "${RED}❌ [FAIL]${NC} $message"
            ((FAILED_TESTS++))
            ;;
        "WARN")
            echo -e "${YELLOW}⚠️  [WARN]${NC} $message"
            ((WARNINGS++))
            ;;
        "INFO")
            echo -e "${BLUE}ℹ️  [INFO]${NC} $message"
            ;;
        "TEST")
            echo -e "${CYAN}🧪 [TEST]${NC} $message"
            ((TOTAL_TESTS++))
            ;;
    esac
}

run_test() {
    local test_name="$1"
    local test_command="$2"
    
    log "TEST" "$test_name"
    
    if eval "$test_command" >/dev/null 2>&1; then
        log "PASS" "$test_name"
        return 0
    else
        log "FAIL" "$test_name"
        return 1
    fi
}

check_prerequisites() {
    echo -e "\n${CYAN}📋 Checking Prerequisites${NC}"
    echo "=================================="
    
    run_test "Docker is installed" "command -v docker"
    run_test "Docker Compose is available" "docker compose version || docker-compose --version"
    run_test "Node.js is installed" "command -v node"
    run_test "npm is installed" "command -v npm"
    run_test "Git is installed" "command -v git"
    run_test "Docker daemon is running" "docker info"
    
    # Check versions
    local docker_version=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    local node_version=$(node --version | cut -d'v' -f2)
    
    log "INFO" "Docker version: $docker_version"
    log "INFO" "Node.js version: $node_version"
    
    # Check minimum versions
    if version_compare "$node_version" "20.0.0"; then
        log "PASS" "Node.js version is sufficient (≥20.0.0)"
    else
        log "FAIL" "Node.js version is too old (required: ≥20.0.0)"
    fi
}

version_compare() {
    local version1=$1
    local version2=$2
    
    if [[ "$(printf '%s\n' "$version1" "$version2" | sort -V | head -n1)" == "$version2" ]]; then
        return 0
    else
        return 1
    fi
}

check_configuration() {
    echo -e "\n${CYAN}⚙️  Checking Configuration${NC}"
    echo "=================================="
    
    cd "$SCRIPT_DIR"
    
    run_test "Configuration file exists" "test -f .env"
    run_test "Docker Compose file exists" "test -f docker-compose.yml"
    run_test "Package.json exists" "test -f package.json"
    run_test "TypeScript config exists" "test -f tsconfig.json"
    
    if [[ -f ".env" ]]; then
        source .env
        
        if [[ -n "${GITHUB_TOKEN:-}" ]]; then
            log "PASS" "GitHub token is configured"
        else
            log "FAIL" "GitHub token is not configured"
        fi
        
        if [[ -n "${GITHUB_ORG:-}" ]]; then
            log "PASS" "GitHub organization is configured"
        else
            log "FAIL" "GitHub organization is not configured"
        fi
        
        if [[ -n "${DATABASE_URL:-}" ]]; then
            log "PASS" "Database URL is configured"
        else
            log "FAIL" "Database URL is not configured"
        fi
    else
        log "FAIL" "Configuration file (.env) not found"
    fi
}

check_build_status() {
    echo -e "\n${CYAN}🔨 Checking Build Status${NC}"
    echo "=================================="
    
    cd "$SCRIPT_DIR"
    
    run_test "Node modules installed" "test -d node_modules"
    run_test "TypeScript compiled" "test -f dist/index.js"
    
    if [[ ! -d "node_modules" ]]; then
        log "INFO" "Installing dependencies..."
        npm install
    fi
    
    if [[ ! -f "dist/index.js" ]]; then
        log "INFO" "Building application..."
        npm run build
    fi
}

check_docker_services() {
    echo -e "\n${CYAN}🐳 Checking Docker Services${NC}"
    echo "=================================="
    
    cd "$SCRIPT_DIR"
    
    # Check if docker-compose is running
    local running_services=$(docker-compose ps --services --filter "status=running" 2>/dev/null || true)
    
    if [[ -z "$running_services" ]]; then
        log "WARN" "No Docker services are running. Starting services..."
        docker-compose up -d
        sleep 10
        running_services=$(docker-compose ps --services --filter "status=running" 2>/dev/null || true)
    fi
    
    # Check individual services
    local expected_services=("postgres" "redis" "docker-proxy" "orchestrator")
    
    for service in "${expected_services[@]}"; do
        if echo "$running_services" | grep -q "^$service$"; then
            log "PASS" "Service '$service' is running"
            
            # Check service health
            local container_name="${COMPOSE_PROJECT_NAME}-${service}-1"
            if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "$container_name.*healthy\|$container_name.*Up"; then
                log "PASS" "Service '$service' is healthy"
            else
                log "WARN" "Service '$service' health status unknown"
            fi
        else
            log "FAIL" "Service '$service' is not running"
        fi
    done
    
    # Check proxy-runner (optional)
    if echo "$running_services" | grep -q "proxy-runner"; then
        log "PASS" "Proxy runner is running"
    else
        log "WARN" "Proxy runner is not running (this is optional)"
    fi
}

check_network_connectivity() {
    echo -e "\n${CYAN}🌐 Checking Network Connectivity${NC}"
    echo "=================================="
    
    # Check port availability
    local ports=("3000:API" "3001:WebSocket" "5432:PostgreSQL" "6379:Redis")
    
    for port_info in "${ports[@]}"; do
        local port=$(echo "$port_info" | cut -d':' -f1)
        local service=$(echo "$port_info" | cut -d':' -f2)
        
        if netstat -tuln 2>/dev/null | grep -q ":$port " || ss -tuln 2>/dev/null | grep -q ":$port "; then
            log "PASS" "Port $port ($service) is listening"
        else
            log "FAIL" "Port $port ($service) is not listening"
        fi
    done
    
    # Check Docker network
    if docker network ls | grep -q "runnerhub-network"; then
        log "PASS" "Docker network exists"
    else
        log "FAIL" "Docker network is missing"
    fi
}

check_api_endpoints() {
    echo -e "\n${CYAN}🔗 Checking API Endpoints${NC}"
    echo "=================================="
    
    # Wait for API to be available
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -s -f "$API_BASE_URL/health" >/dev/null 2>&1; then
            break
        fi
        
        if [[ $attempt -eq $max_attempts ]]; then
            log "FAIL" "API is not responding after $max_attempts attempts"
            return 1
        fi
        
        log "INFO" "Waiting for API... (attempt $attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done
    
    # Test endpoints
    local endpoints=(
        "GET:$API_BASE_URL/health:Health Check"
        "GET:$API_BASE_URL/api/runners:Runner List"
        "GET:$API_BASE_URL/api/jobs:Job List"
        "GET:$API_BASE_URL/metrics:Metrics"
    )
    
    for endpoint_info in "${endpoints[@]}"; do
        local method=$(echo "$endpoint_info" | cut -d':' -f1)
        local url=$(echo "$endpoint_info" | cut -d':' -f2)
        local description=$(echo "$endpoint_info" | cut -d':' -f3)
        
        local status_code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" 2>/dev/null || echo "000")
        
        if [[ $status_code -eq 200 ]]; then
            log "PASS" "$description endpoint (HTTP $status_code)"
        elif [[ $status_code -eq 401 ]]; then
            log "WARN" "$description endpoint requires authentication (HTTP $status_code)"
        else
            log "FAIL" "$description endpoint failed (HTTP $status_code)"
        fi
    done
}

check_database_connectivity() {
    echo -e "\n${CYAN}🗄️  Checking Database Connectivity${NC}"
    echo "=================================="
    
    # Test PostgreSQL connection
    if docker-compose exec -T postgres pg_isready -U runnerhub >/dev/null 2>&1; then
        log "PASS" "PostgreSQL is accepting connections"
        
        # Test database operations
        if docker-compose exec -T postgres psql -U runnerhub -d github_runnerhub -c "SELECT 1;" >/dev/null 2>&1; then
            log "PASS" "Database queries are working"
        else
            log "FAIL" "Database queries are failing"
        fi
    else
        log "FAIL" "PostgreSQL is not accepting connections"
    fi
    
    # Test Redis connection
    if docker-compose exec -T redis redis-cli ping >/dev/null 2>&1; then
        log "PASS" "Redis is responding to ping"
    else
        log "FAIL" "Redis is not responding"
    fi
}

check_monitoring_services() {
    echo -e "\n${CYAN}📊 Checking Monitoring Services${NC}"
    echo "=================================="
    
    # Check if monitoring services are running
    local running_services=$(docker-compose ps --services --filter "status=running" 2>/dev/null || true)
    
    if echo "$running_services" | grep -q "prometheus"; then
        log "PASS" "Prometheus is running"
        
        # Test Prometheus endpoint
        local prom_status=$(curl -s -o /dev/null -w "%{http_code}" "$PROMETHEUS_URL" 2>/dev/null || echo "000")
        if [[ $prom_status -eq 200 ]]; then
            log "PASS" "Prometheus web interface is accessible"
        else
            log "FAIL" "Prometheus web interface is not accessible (HTTP $prom_status)"
        fi
    else
        log "WARN" "Prometheus is not running (monitoring is optional)"
    fi
    
    if echo "$running_services" | grep -q "grafana"; then
        log "PASS" "Grafana is running"
        
        # Test Grafana endpoint
        local grafana_status=$(curl -s -o /dev/null -w "%{http_code}" "$GRAFANA_URL" 2>/dev/null || echo "000")
        if [[ $grafana_status -eq 200 ]]; then
            log "PASS" "Grafana web interface is accessible"
        else
            log "FAIL" "Grafana web interface is not accessible (HTTP $grafana_status)"
        fi
    else
        log "WARN" "Grafana is not running (monitoring is optional)"
    fi
}

check_logs_and_data() {
    echo -e "\n${CYAN}📝 Checking Logs and Data${NC}"
    echo "=================================="
    
    cd "$SCRIPT_DIR"
    
    # Check log directories
    if [[ -d "logs" ]]; then
        log "PASS" "Logs directory exists"
        
        if [[ -f "logs/combined.log" ]]; then
            log "PASS" "Application logs are being written"
        else
            log "WARN" "Application logs not found"
        fi
    else
        log "WARN" "Logs directory does not exist"
    fi
    
    # Check data directory
    if [[ -d "data" ]]; then
        log "PASS" "Data directory exists"
    else
        log "WARN" "Data directory does not exist"
    fi
    
    # Check Docker volumes
    local volumes=$(docker volume ls --filter "name=runnerhub" --format "{{.Name}}" 2>/dev/null || true)
    if [[ -n "$volumes" ]]; then
        log "PASS" "Docker volumes exist"
        echo "$volumes" | while read -r volume; do
            log "INFO" "Found volume: $volume"
        done
    else
        log "WARN" "No Docker volumes found"
    fi
}

run_integration_tests() {
    echo -e "\n${CYAN}🧪 Running Integration Tests${NC}"
    echo "=================================="
    
    cd "$SCRIPT_DIR"
    
    # Check if test files exist
    if [[ -d "tests" ]]; then
        log "PASS" "Test directory exists"
        
        # Run basic tests
        if npm test -- --passWithNoTests --silent >/dev/null 2>&1; then
            log "PASS" "Unit tests are passing"
        else
            log "WARN" "Some unit tests are failing"
        fi
    else
        log "WARN" "Test directory not found"
    fi
    
    # Test basic API functionality
    log "INFO" "Testing basic API functionality..."
    
    # Create a test API call
    local test_response=$(curl -s "$API_BASE_URL/health" 2>/dev/null || echo "")
    if echo "$test_response" | grep -q "ok\|healthy\|success"; then
        log "PASS" "API health check returns valid response"
    else
        log "FAIL" "API health check returns invalid response"
    fi
}

print_summary() {
    echo -e "\n${CYAN}📊 Verification Summary${NC}"
    echo "=================================="
    
    echo -e "Total Tests: ${TOTAL_TESTS}"
    echo -e "${GREEN}Passed: ${PASSED_TESTS}${NC}"
    echo -e "${RED}Failed: ${FAILED_TESTS}${NC}"
    echo -e "${YELLOW}Warnings: ${WARNINGS}${NC}"
    
    local success_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    
    echo -e "\nSuccess Rate: ${success_rate}%"
    
    if [[ $FAILED_TESTS -eq 0 ]]; then
        echo -e "\n${GREEN}🎉 All critical tests passed! GitHub-RunnerHub is working correctly.${NC}"
        
        echo -e "\n${CYAN}🌐 Service URLs:${NC}"
        echo -e "   • API Dashboard: $API_BASE_URL"
        echo -e "   • Health Check:  $API_BASE_URL/health"
        echo -e "   • Metrics:       $API_BASE_URL/metrics"
        echo -e "   • Grafana:       $GRAFANA_URL"
        echo -e "   • Prometheus:    $PROMETHEUS_URL"
        
        return 0
    else
        echo -e "\n${RED}❌ Some critical tests failed. Please review the issues above.${NC}"
        
        echo -e "\n${CYAN}🔧 Troubleshooting Tips:${NC}"
        echo -e "   • Check Docker services: docker-compose ps"
        echo -e "   • View logs: docker-compose logs -f"
        echo -e "   • Restart services: docker-compose restart"
        echo -e "   • Rebuild: docker-compose build --no-cache"
        
        return 1
    fi
}

show_help() {
    cat << EOF
GitHub-RunnerHub Installation Verification

Usage: $0 [OPTIONS]

OPTIONS:
    -h, --help              Show this help message and exit
    -v, --verbose           Enable verbose output
    --skip-build           Skip build verification
    --skip-monitoring      Skip monitoring service checks
    --api-only             Only test API endpoints
    --quick                Run quick verification (essential tests only)

EXAMPLES:
    $0                      # Full verification
    $0 --quick              # Quick verification
    $0 --api-only           # Only test API endpoints
    $0 --skip-monitoring    # Skip monitoring checks

EOF
}

main() {
    local SKIP_BUILD=false
    local SKIP_MONITORING=false
    local API_ONLY=false
    local QUICK_MODE=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -v|--verbose)
                set -x
                shift
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --skip-monitoring)
                SKIP_MONITORING=true
                shift
                ;;
            --api-only)
                API_ONLY=true
                shift
                ;;
            --quick)
                QUICK_MODE=true
                shift
                ;;
            *)
                log "FAIL" "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    print_header
    
    if [[ $API_ONLY == true ]]; then
        check_api_endpoints
    elif [[ $QUICK_MODE == true ]]; then
        check_prerequisites
        check_docker_services
        check_api_endpoints
    else
        check_prerequisites
        check_configuration
        
        if [[ $SKIP_BUILD == false ]]; then
            check_build_status
        fi
        
        check_docker_services
        check_network_connectivity
        check_api_endpoints
        check_database_connectivity
        
        if [[ $SKIP_MONITORING == false ]]; then
            check_monitoring_services
        fi
        
        check_logs_and_data
        run_integration_tests
    fi
    
    print_summary
}

# Run main function
main "$@"