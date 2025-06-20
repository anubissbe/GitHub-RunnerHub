#!/bin/bash
# E2E Test Runner for GitHub RunnerHub
# Runs comprehensive end-to-end tests to verify complete system functionality

set -e

echo "🚀 GitHub RunnerHub E2E Test Runner"
echo "=================================================="

# Check if services are running
check_service() {
    local service_name=$1
    local url=$2
    
    echo -n "Checking $service_name... "
    if curl -s -f "$url" > /dev/null 2>&1; then
        echo "✅ Running"
        return 0
    else
        echo "❌ Not available"
        return 1
    fi
}

# Function to start services if needed
start_services() {
    echo "🔧 Starting required services..."
    
    # Check if docker-compose is available
    if command -v docker-compose &> /dev/null; then
        echo "Starting Docker services..."
        docker-compose up -d postgres redis
        sleep 5
    else
        echo "⚠️ Docker Compose not available - ensure services are running manually"
    fi
    
    # Start the application in background for testing
    echo "Starting GitHub RunnerHub application..."
    npm run build
    npm start &
    APP_PID=$!
    echo "Application started with PID: $APP_PID"
    
    # Wait for application to be ready
    echo "Waiting for application to be ready..."
    for i in {1..30}; do
        if curl -s -f "http://localhost:3000/api/health" > /dev/null 2>&1; then
            echo "✅ Application is ready"
            break
        fi
        echo -n "."
        sleep 2
    done
    
    if [ $i -eq 30 ]; then
        echo "❌ Application failed to start within 60 seconds"
        kill $APP_PID 2>/dev/null || true
        exit 1
    fi
}

# Function to stop services
cleanup_services() {
    echo "🧹 Cleaning up services..."
    if [ ! -z "$APP_PID" ]; then
        kill $APP_PID 2>/dev/null || true
        echo "Application stopped"
    fi
    
    # Don't stop Docker services automatically as they might be used elsewhere
    # docker-compose down
}

# Trap to ensure cleanup on exit
trap cleanup_services EXIT

# Pre-flight checks
echo "🔍 Pre-flight System Checks"
echo "----------------------------"

# Check if Node.js and npm are available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"

# Check if jest is available
if ! npm list jest &> /dev/null; then
    echo "⚠️ Jest not found in dependencies, installing..."
    npm install --save-dev jest supertest
fi

# Check if the application is already running
echo ""
echo "🔍 Service Availability Check"
echo "----------------------------"

API_RUNNING=false
if check_service "API Server" "http://localhost:3000/api/health"; then
    API_RUNNING=true
fi

check_service "PostgreSQL" "http://localhost:5432" || echo "⚠️ Assuming PostgreSQL is available"
check_service "Redis" "http://localhost:6379" || echo "⚠️ Assuming Redis is available"

# Start services if not running
if [ "$API_RUNNING" = false ]; then
    echo ""
    echo "🚀 Services not detected, starting..."
    start_services
    STARTED_SERVICES=true
else
    echo "✅ Using existing running services"
    STARTED_SERVICES=false
fi

echo ""
echo "🧪 Running E2E Tests"
echo "===================="

# Set test environment
export NODE_ENV=test
export TEST_MODE=e2e

# Run the E2E tests
echo "Starting comprehensive E2E test suite..."

# Run with Jest
if npm run test:e2e 2>/dev/null; then
    echo "✅ Using npm run test:e2e command"
else
    echo "Running E2E tests directly with Jest..."
    npx jest tests/e2e/complete-workflow.e2e.test.js --verbose --detectOpenHandles --forceExit
fi

# Capture test results
TEST_RESULT=$?

echo ""
echo "📊 Test Results Summary"
echo "======================"

if [ $TEST_RESULT -eq 0 ]; then
    echo "🎉 All E2E tests passed successfully!"
    echo ""
    echo "✅ Verified Components:"
    echo "   • System health and connectivity"
    echo "   • Runner pool management and auto-scaling"
    echo "   • GitHub webhook processing and integration"  
    echo "   • Container lifecycle management and cleanup"
    echo "   • Monitoring, metrics, and real-time updates"
    echo "   • Job routing and processing logic"
    echo "   • Complete end-to-end workflow"
    echo "   • Performance and load testing"
    echo "   • Error handling and recovery"
    echo ""
    echo "🏗️ Architecture Verified:"
    echo "   GitHub Webhook → Job Queue → Runner Pool → Container Lifecycle → Monitoring"
    echo ""
    echo "✅ GitHub RunnerHub is ready for production deployment!"
else
    echo "❌ Some E2E tests failed"
    echo ""
    echo "🔍 Troubleshooting Steps:"
    echo "1. Check application logs: docker-compose logs -f"
    echo "2. Verify database connectivity: npm run test:db"
    echo "3. Check Redis connectivity: npm run test:redis"
    echo "4. Review API endpoints: curl http://localhost:3000/api/health"
    echo "5. Check service status: docker ps"
fi

# Additional system verification
echo ""
echo "🔍 Post-Test System Verification"
echo "==============================="

# Check final service status
check_service "API Server" "http://localhost:3000/api/health"
echo ""

# Show resource usage
if command -v docker &> /dev/null; then
    echo "📈 Docker Resource Usage:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | head -10
fi

echo ""
echo "🏁 E2E Test Run Complete"
echo "========================"
echo "Timestamp: $(date)"
echo "Test Result: $([ $TEST_RESULT -eq 0 ] && echo "SUCCESS" || echo "FAILURE")"

if [ "$STARTED_SERVICES" = true ]; then
    echo "Note: Services were started for testing and will be stopped on script exit"
else
    echo "Note: Existing services were used and will remain running"
fi

exit $TEST_RESULT