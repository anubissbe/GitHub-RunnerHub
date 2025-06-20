#!/bin/bash
# Integration test with Docker services

set -e

echo "=== GitHub-RunnerHub Integration Test ==="
echo

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check Docker
if ! docker --version > /dev/null 2>&1; then
    echo -e "${RED}Docker is not installed${NC}"
    exit 1
fi

# Function to wait for service
wait_for_service() {
    local service=$1
    local port=$2
    local timeout=30
    local elapsed=0
    
    echo -n "Waiting for $service on port $port..."
    while ! nc -z localhost $port 2>/dev/null; do
        if [ $elapsed -ge $timeout ]; then
            echo -e " ${RED}timeout!${NC}"
            return 1
        fi
        sleep 1
        elapsed=$((elapsed + 1))
        echo -n "."
    done
    echo -e " ${GREEN}ready!${NC}"
    return 0
}

# Start test services
echo "Starting test services..."

# Start Redis
docker run -d --name test-redis -p 6379:6379 redis:7-alpine > /dev/null 2>&1 || {
    docker stop test-redis > /dev/null 2>&1
    docker rm test-redis > /dev/null 2>&1
    docker run -d --name test-redis -p 6379:6379 redis:7-alpine > /dev/null 2>&1
}

# Start PostgreSQL
docker run -d --name test-postgres \
    -e POSTGRES_USER=test \
    -e POSTGRES_PASSWORD=test \
    -e POSTGRES_DB=github_runnerhub \
    -p 5432:5432 \
    postgres:16 > /dev/null 2>&1 || {
    docker stop test-postgres > /dev/null 2>&1
    docker rm test-postgres > /dev/null 2>&1
    docker run -d --name test-postgres \
        -e POSTGRES_USER=test \
        -e POSTGRES_PASSWORD=test \
        -e POSTGRES_DB=github_runnerhub \
        -p 5432:5432 \
        postgres:16 > /dev/null 2>&1
}

# Wait for services
wait_for_service "Redis" 6379
wait_for_service "PostgreSQL" 5432

# Give PostgreSQL extra time to initialize
sleep 3

# Initialize database schema
echo "Initializing database schema..."
PGPASSWORD=test psql -h localhost -U test -d github_runnerhub -f docker/postgres/init.sql > /dev/null 2>&1 || {
    echo -e "${YELLOW}Warning: Database initialization had issues (may already exist)${NC}"
}

# Create test environment
cat > .env.test << EOF
NODE_ENV=test
PORT=3001
GITHUB_TOKEN=test-github-token
GITHUB_ORG=test-org
REDIS_HOST=localhost
REDIS_PORT=6379
DATABASE_URL=postgresql://test:test@localhost:5432/github_runnerhub
DB_HOST=localhost
DB_PORT=5432
DB_NAME=github_runnerhub
DB_USER=test
DB_PASSWORD=test
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=test-vault-token
JWT_SECRET=test-jwt-secret
ENCRYPTION_KEY=test-encryption-key
LOG_LEVEL=error
EOF

# Start the application
echo -e "\nStarting application..."
NODE_ENV=test node dist/index.js > app.log 2>&1 &
APP_PID=$!

# Wait for app to start
sleep 5

# Check if app is running
if ! kill -0 $APP_PID 2>/dev/null; then
    echo -e "${RED}Application failed to start${NC}"
    echo "Last 20 lines of app.log:"
    tail -20 app.log
    cleanup
    exit 1
fi

echo -e "${GREEN}Application started successfully${NC}"

# Run tests
echo -e "\nRunning API tests..."

# Test health endpoint
echo -n "Testing health endpoint... "
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:3001/health 2>/dev/null || echo "000")
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ (HTTP $HTTP_CODE)${NC}"
fi

# Test job delegation
echo -n "Testing job delegation... "
JOB_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3001/api/jobs/delegate \
    -H "Content-Type: application/json" \
    -d '{
        "jobId": "test-123",
        "runId": "run-456",
        "repository": "test/repo",
        "workflow": "Test",
        "runnerName": "test-runner",
        "labels": ["self-hosted"]
    }' 2>/dev/null || echo "000")

HTTP_CODE=$(echo "$JOB_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "201" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ (HTTP $HTTP_CODE)${NC}"
fi

# Cleanup function
cleanup() {
    echo -e "\nCleaning up..."
    kill $APP_PID 2>/dev/null || true
    docker stop test-redis test-postgres > /dev/null 2>&1
    docker rm test-redis test-postgres > /dev/null 2>&1
    rm -f .env.test app.log
}

# Clean up
cleanup

echo -e "\n${GREEN}Integration test completed!${NC}"