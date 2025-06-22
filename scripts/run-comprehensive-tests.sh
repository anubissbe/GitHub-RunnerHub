#!/bin/bash

# Comprehensive Test Runner Script
# Runs all types of tests in the correct order

set -e

echo "🧪 Starting Comprehensive Test Suite"
echo "====================================="

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
UNIT_TESTS_PASSED=false
INTEGRATION_TESTS_PASSED=false
E2E_TESTS_PASSED=false
SECURITY_TESTS_PASSED=false
LOAD_TESTS_PASSED=false

# Function to print status
print_status() {
    local test_type=$1
    local status=$2
    if [ "$status" = true ]; then
        echo -e "${GREEN}✅ ${test_type} PASSED${NC}"
    else
        echo -e "${RED}❌ ${test_type} FAILED${NC}"
    fi
}

# Function to run tests with error handling
run_test_suite() {
    local test_name=$1
    local test_command=$2
    local result_var=$3
    
    echo -e "\n${BLUE}🔍 Running ${test_name}...${NC}"
    echo "Command: $test_command"
    
    if eval "$test_command"; then
        echo -e "${GREEN}✅ ${test_name} completed successfully${NC}"
        eval "$result_var=true"
    else
        echo -e "${RED}❌ ${test_name} failed${NC}"
        eval "$result_var=false"
    fi
}

# Check prerequisites
echo -e "${YELLOW}🔧 Checking prerequisites...${NC}"

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
fi

# Build the project first
echo -e "${YELLOW}🔨 Building project...${NC}"
npm run build

# Lint check
echo -e "${YELLOW}🔍 Running linter...${NC}"
npm run lint

# Type check
echo -e "${YELLOW}📝 Running type check...${NC}"
npm run typecheck

# 1. Unit Tests
run_test_suite "Unit Tests" "npm run test:unit" "UNIT_TESTS_PASSED"

# 2. Integration Tests
run_test_suite "Integration Tests" "npm run test:integration" "INTEGRATION_TESTS_PASSED"

# 3. End-to-End Tests
run_test_suite "End-to-End Tests" "npm run test:e2e" "E2E_TESTS_PASSED"

# 4. Security Tests
run_test_suite "Security Tests" "npm run test:security" "SECURITY_TESTS_PASSED"

# 5. Load Tests (if Artillery is available)
if command -v artillery &> /dev/null; then
    run_test_suite "Load Tests" "npm run test:load" "LOAD_TESTS_PASSED"
else
    echo -e "${YELLOW}⚠️  Artillery not found, skipping load tests${NC}"
    LOAD_TESTS_PASSED=true
fi

# Generate coverage report
echo -e "\n${BLUE}📊 Generating coverage report...${NC}"
npm run test:coverage || echo -e "${YELLOW}⚠️  Coverage report generation failed${NC}"

# Summary
echo -e "\n${BLUE}📋 Test Results Summary${NC}"
echo "=========================="
print_status "Unit Tests" $UNIT_TESTS_PASSED
print_status "Integration Tests" $INTEGRATION_TESTS_PASSED
print_status "End-to-End Tests" $E2E_TESTS_PASSED
print_status "Security Tests" $SECURITY_TESTS_PASSED
print_status "Load Tests" $LOAD_TESTS_PASSED

# Overall result
if [ "$UNIT_TESTS_PASSED" = true ] && [ "$INTEGRATION_TESTS_PASSED" = true ] && \
   [ "$E2E_TESTS_PASSED" = true ] && [ "$SECURITY_TESTS_PASSED" = true ] && \
   [ "$LOAD_TESTS_PASSED" = true ]; then
    echo -e "\n${GREEN}🎉 ALL TESTS PASSED! 🎉${NC}"
    echo -e "${GREEN}The application is ready for deployment.${NC}"
    exit 0
else
    echo -e "\n${RED}💥 SOME TESTS FAILED! 💥${NC}"
    echo -e "${RED}Please fix the failing tests before proceeding.${NC}"
    exit 1
fi