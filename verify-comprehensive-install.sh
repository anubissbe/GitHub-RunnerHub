#!/bin/bash

# GitHub RunnerHub - Installation Verification Script
# This script verifies that all components were installed correctly

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# Check results
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Functions
check() {
    local name="$1"
    local command="$2"
    
    ((TOTAL_CHECKS++))
    printf "%-50s" "Checking $name..."
    
    if eval "$command" &>/dev/null; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED_CHECKS++))
    else
        echo -e "${RED}✗ FAIL${NC}"
        ((FAILED_CHECKS++))
    fi
}

header() {
    echo
    echo -e "${PURPLE}=== $1 ===${NC}"
    echo
}

# Main verification
echo -e "${BLUE}"
cat << "EOF"
   ______ _ _   _   _       _       _____                             _   _       _     
  / _____(_) | | | | |     | |     |  __ \                           | | | |     | |    
 | |  __  _| |_| |_| |_   _| |__   | |__) |   _ _ __  _ __   ___ _ __| |_| |_   _| |__  
 | | |_ | | __| __| | | | | |  _ \ |  _  / | | |  _ \|  _ \ / _ \  __|  _  | | | |  _ \ 
 | |__| | | |_| |_| | |_| | |_) | | | \ \ |_| | | | | | | |  __/ |  | | | | |_| | |_) |
  \_____| |_|\__|\__|  \__,_|_.__/  |_|  \_\__,_|_| |_|_| |_|\___|_|  |_| |_|\__,_|_.__/ 
       _| |                                                                              
      |__/                         Installation Verification                                             
EOF
echo -e "${NC}"

# Check prerequisites
header "Prerequisites"
check "Docker" "docker --version"
check "Docker Compose" "docker-compose version || docker compose version"
check "Node.js" "node --version"
check "npm" "npm --version"
check "Git" "git --version"

# Check configuration files
header "Configuration Files"
check "Environment file (.env)" "test -f .env"
check "Docker Compose file" "test -f docker-compose.yml"
check "Package.json" "test -f package.json"
check "TypeScript config" "test -f tsconfig.json"

# Check Docker resources
header "Docker Resources"
check "Docker daemon" "docker info"
check "Frontend network" "docker network inspect runnerhub-frontend"
check "Backend network" "docker network inspect runnerhub-backend"
check "Data network" "docker network inspect runnerhub-data"
check "PostgreSQL volume" "docker volume inspect runnerhub-postgres-data"
check "Redis volume" "docker volume inspect runnerhub-redis-data"

# Check running services
header "Running Services"
check "PostgreSQL container" "docker ps | grep postgres"
check "Redis container" "docker ps | grep redis"
check "Application container" "docker ps | grep app || docker ps | grep runnerhub"

# Check service health
header "Service Health"
check "PostgreSQL connection" "docker exec postgres pg_isready -U app_user 2>/dev/null || docker exec github-runnerhub-postgres-1 pg_isready -U app_user"
check "Redis connection" "docker exec redis redis-cli ping 2>/dev/null || docker exec github-runnerhub-redis-1 redis-cli ping"

# Check API endpoints
header "API Endpoints"
check "Health endpoint" "curl -sf http://localhost:3001/health"
check "API root" "curl -sf http://localhost:3001/api"

# Check optional services
header "Optional Services"
if docker ps | grep -q vault; then
    check "Vault container" "docker ps | grep vault"
    check "Vault status" "docker exec vault vault status || true"
fi

if docker ps | grep -q prometheus; then
    check "Prometheus container" "docker ps | grep prometheus"
    check "Prometheus health" "curl -sf http://localhost:9090/-/healthy"
fi

if docker ps | grep -q grafana; then
    check "Grafana container" "docker ps | grep grafana"
    check "Grafana health" "curl -sf http://localhost:3030/api/health"
fi

if docker ps | grep -q nginx; then
    check "Nginx container" "docker ps | grep nginx"
    check "Nginx health" "curl -sf http://localhost/health"
fi

# Check build artifacts
header "Build Artifacts"
check "TypeScript build output" "test -d dist"
check "Node modules" "test -d node_modules"
check "Log directory" "test -d logs"

# Check database
header "Database"
if docker exec postgres pg_isready -U app_user &>/dev/null || docker exec github-runnerhub-postgres-1 pg_isready -U app_user &>/dev/null; then
    POSTGRES_CONTAINER=$(docker ps --format "{{.Names}}" | grep postgres | head -1)
    check "Database exists" "docker exec $POSTGRES_CONTAINER psql -U app_user -lqt | cut -d \| -f 1 | grep -qw github_runnerhub"
    check "Database tables" "docker exec $POSTGRES_CONTAINER psql -U app_user -d github_runnerhub -c '\\dt' | grep -q runner"
fi

# Summary
echo
echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Verification Summary${NC}"
echo -e "${PURPLE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "Total checks: $TOTAL_CHECKS"
echo -e "Passed: ${GREEN}$PASSED_CHECKS${NC}"
echo -e "Failed: ${RED}$FAILED_CHECKS${NC}"
echo

if [[ $FAILED_CHECKS -eq 0 ]]; then
    echo -e "${GREEN}✅ All checks passed! Installation verified successfully.${NC}"
    echo
    echo "You can now:"
    echo "  • Access the dashboard at: http://localhost:3000"
    echo "  • Use the API at: http://localhost:3001"
    echo "  • View logs: docker-compose logs -f"
    exit 0
else
    echo -e "${YELLOW}⚠️  Some checks failed. Please review the output above.${NC}"
    echo
    echo "Common fixes:"
    echo "  • Ensure all services are running: docker-compose up -d"
    echo "  • Check service logs: docker-compose logs <service>"
    echo "  • Restart failed services: docker-compose restart <service>"
    echo "  • Re-run installation: ./install-comprehensive.sh"
    exit 1
fi