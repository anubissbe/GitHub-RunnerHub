#!/bin/bash

# Local Comprehensive Testing Script for GitHub-RunnerHub
# Tests the system locally first, then prepares for remote deployment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_PATH="/opt/projects/projects/GitHub-RunnerHub"
TEST_LOG="/tmp/github-runnerhub-local-test-$(date +%Y%m%d_%H%M%S).log"
REMOTE_HOST="192.168.1.16"

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
ISSUES_FOUND=()

# Utility functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$TEST_LOG"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$TEST_LOG"
    ((PASSED_TESTS++))
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$TEST_LOG"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$TEST_LOG"
    ((FAILED_TESTS++))
}

log_issue() {
    local issue_title="$1"
    local issue_description="$2"
    local severity="${3:-medium}"
    
    log_error "ISSUE FOUND: $issue_title"
    ISSUES_FOUND+=("$severity|$issue_title|$issue_description")
    
    # Create GitHub issue
    create_github_issue "$issue_title" "$issue_description" "$severity"
}

# Test function wrapper
run_test() {
    local test_name="$1"
    local test_command="$2"
    local critical="${3:-false}"
    
    ((TOTAL_TESTS++))
    log_info "🧪 Running test: $test_name"
    
    if eval "$test_command"; then
        log_success "✅ Test passed: $test_name"
        return 0
    else
        log_error "❌ Test failed: $test_name"
        
        if [ "$critical" = "true" ]; then
            log_error "Critical test failed. Stopping testing."
            exit 1
        fi
        return 1
    fi
}

# Create GitHub issue
create_github_issue() {
    local title="$1"
    local description="$2"
    local severity="$3"
    
    # Add severity label
    local labels="bug"
    case "$severity" in
        "critical") labels="bug,critical,priority:high" ;;
        "high") labels="bug,priority:high" ;;
        "medium") labels="bug,priority:medium" ;;
        "low") labels="bug,priority:low" ;;
    esac
    
    # Create issue body with testing context
    local issue_body="## Issue Description
$description

## Environment Details
- **Test Environment**: Local development
- **Target Deployment**: $REMOTE_HOST
- **Test Time**: $(date)
- **Version**: GitHub-RunnerHub v2.0.0
- **Detection Method**: Comprehensive local testing

## Steps to Reproduce
1. Run local comprehensive testing suite
2. Execute specific test case that failed
3. Observe the issue

## Expected Behavior
The system should function correctly without errors.

## Severity
$severity

## Additional Context
- Test log: $TEST_LOG
- Test script: scripts/local-comprehensive-test.sh

## Labels
$labels"

    if [ -n "${GITHUB_TOKEN:-}" ]; then
        log_info "Creating GitHub issue: $title"
        
        # Use GitHub CLI if available, otherwise use curl
        if command -v gh >/dev/null 2>&1; then
            echo "$issue_body" | gh issue create \
                --title "$title" \
                --body-file - \
                --label "$labels" \
                --repo "YOUR_GITHUB_ORG/GitHub-RunnerHub" 2>/dev/null || log_warning "Failed to create GitHub issue with gh CLI"
        else
            # Create issue using curl
            curl -s -X POST \
                -H "Authorization: token $GITHUB_TOKEN" \
                -H "Accept: application/vnd.github.v3+json" \
                "https://api.github.com/repos/YOUR_GITHUB_ORG/GitHub-RunnerHub/issues" \
                -d "$(cat <<EOF
{
    "title": "$title",
    "body": "$issue_body",
    "labels": ["bug", "automated-testing"]
}
EOF
)" >/dev/null 2>&1 || log_warning "Failed to create GitHub issue with curl"
        fi
        
        log_success "GitHub issue created: $title"
    else
        log_warning "GITHUB_TOKEN not set. Logging issue locally: $title"
        echo "ISSUE: $title - $description" >> "$TEST_LOG.issues"
    fi
}

# Test project structure
test_project_structure() {
    log_info "📁 Testing project structure..."
    
    # Check essential files
    local essential_files=(
        "package.json"
        "tsconfig.json"
        "docker-compose.yml"
        "README.md"
        ".gitignore"
        "src/index.ts"
        "src/app.ts"
    )
    
    for file in "${essential_files[@]}"; do
        if [ -f "$PROJECT_PATH/$file" ]; then
            log_success "Essential file exists: $file"
            ((PASSED_TESTS++))
        else
            log_issue "Missing essential file" "Required file is missing: $file" "high"
        fi
        ((TOTAL_TESTS++))
    done
    
    # Check directory structure
    local essential_dirs=(
        "src"
        "src/controllers"
        "src/services"
        "src/routes"
        "docs"
        "scripts"
        "migrations"
    )
    
    for dir in "${essential_dirs[@]}"; do
        if [ -d "$PROJECT_PATH/$dir" ]; then
            log_success "Essential directory exists: $dir"
            ((PASSED_TESTS++))
        else
            log_issue "Missing essential directory" "Required directory is missing: $dir" "medium"
        fi
        ((TOTAL_TESTS++))
    done
}

# Test package.json and dependencies
test_dependencies() {
    log_info "📦 Testing dependencies..."
    
    cd "$PROJECT_PATH"
    
    # Check package.json syntax
    run_test "package.json syntax" "node -e 'JSON.parse(require(\"fs\").readFileSync(\"package.json\", \"utf8\"))'"
    
    # Check if node_modules exists
    if [ -d "node_modules" ]; then
        log_success "node_modules directory exists"
        ((PASSED_TESTS++))
    else
        log_warning "node_modules not found, running npm install..."
        run_test "npm install" "npm install"
    fi
    ((TOTAL_TESTS++))
    
    # Check for security vulnerabilities
    run_test "Security audit" "npm audit --audit-level=high" "false"
    
    # Check for outdated packages
    if npm outdated >/dev/null 2>&1; then
        log_warning "Some packages are outdated (not critical)"
    else
        log_success "All packages are up to date"
        ((PASSED_TESTS++))
    fi
    ((TOTAL_TESTS++))
}

# Test TypeScript compilation
test_typescript() {
    log_info "🔧 Testing TypeScript compilation..."
    
    cd "$PROJECT_PATH"
    
    # Test TypeScript configuration
    run_test "TypeScript config" "npx tsc --noEmit --skipLibCheck"
    
    # Test build process
    run_test "Build process" "npm run build"
    
    # Check if dist directory was created
    if [ -d "dist" ]; then
        log_success "Build output directory created"
        ((PASSED_TESTS++))
    else
        log_issue "Build output missing" "dist directory was not created during build" "high"
    fi
    ((TOTAL_TESTS++))
    
    # Check for TypeScript errors in main files
    local main_files=(
        "src/index.ts"
        "src/app.ts"
        "src/config/index.ts"
    )
    
    for file in "${main_files[@]}"; do
        if npx tsc --noEmit --skipLibCheck "$file" >/dev/null 2>&1; then
            log_success "TypeScript compilation passed: $file"
            ((PASSED_TESTS++))
        else
            log_issue "TypeScript compilation error" "Compilation failed for $file" "high"
        fi
        ((TOTAL_TESTS++))
    done
}

# Test Docker configuration
test_docker() {
    log_info "🐳 Testing Docker configuration..."
    
    cd "$PROJECT_PATH"
    
    # Test Docker Compose file syntax
    run_test "Docker Compose syntax" "docker-compose config >/dev/null"
    
    # Test if Docker daemon is running
    if docker info >/dev/null 2>&1; then
        log_success "Docker daemon is running"
        ((PASSED_TESTS++))
    else
        log_issue "Docker daemon not running" "Docker daemon is not accessible" "critical"
        return
    fi
    ((TOTAL_TESTS++))
    
    # Test Docker Compose services
    run_test "Start Docker services" "docker-compose up -d --remove-orphans"
    
    # Wait for services to start
    sleep 30
    
    # Check service status
    local running_services=$(docker-compose ps --services --filter "status=running" | wc -l)
    local total_services=$(docker-compose ps --services | wc -l)
    
    if [ "$running_services" -eq "$total_services" ]; then
        log_success "All Docker services are running ($running_services/$total_services)"
        ((PASSED_TESTS++))
    else
        log_issue "Docker services not starting" "Only $running_services out of $total_services services are running" "high"
    fi
    ((TOTAL_TESTS++))
    
    # Test individual service health
    local services=("postgres" "redis")
    for service in "${services[@]}"; do
        if docker-compose ps "$service" | grep -q "Up"; then
            log_success "Service $service is running"
            ((PASSED_TESTS++))
        else
            log_issue "Service not running" "Docker service $service is not running properly" "high"
        fi
        ((TOTAL_TESTS++))
    done
}

# Test database connectivity
test_database() {
    log_info "🗄️ Testing database connectivity..."
    
    cd "$PROJECT_PATH"
    
    # Test PostgreSQL connection
    if docker-compose exec -T postgres psql -U postgres -c "SELECT 1;" >/dev/null 2>&1; then
        log_success "PostgreSQL connection successful"
        ((PASSED_TESTS++))
    else
        log_issue "PostgreSQL connection failed" "Cannot connect to PostgreSQL database" "critical"
    fi
    ((TOTAL_TESTS++))
    
    # Test Redis connection
    if docker-compose exec -T redis redis-cli ping | grep -q "PONG"; then
        log_success "Redis connection successful"
        ((PASSED_TESTS++))
    else
        log_issue "Redis connection failed" "Cannot connect to Redis cache" "high"
    fi
    ((TOTAL_TESTS++))
    
    # Test database schema
    if docker-compose exec -T postgres psql -U postgres -c "\\dt" >/dev/null 2>&1; then
        log_success "Database schema accessible"
        ((PASSED_TESTS++))
    else
        log_warning "Database schema may not be initialized"
    fi
    ((TOTAL_TESTS++))
}

# Test application startup
test_application() {
    log_info "🚀 Testing application startup..."
    
    cd "$PROJECT_PATH"
    
    # Start application in background
    timeout 30 npm start &
    local app_pid=$!
    
    # Wait for application to start
    sleep 20
    
    # Check if application is responding
    if curl -f http://localhost:3001/health >/dev/null 2>&1; then
        log_success "Application health check passed"
        ((PASSED_TESTS++))
    else
        log_issue "Application not responding" "Health endpoint is not accessible at http://localhost:3001/health" "critical"
    fi
    ((TOTAL_TESTS++))
    
    # Test API endpoints
    local endpoints=(
        "/health"
        "/api/metrics"
        "/dashboard"
    )
    
    for endpoint in "${endpoints[@]}"; do
        local status_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001$endpoint" || echo "000")
        if [ "$status_code" = "200" ]; then
            log_success "Endpoint $endpoint returned 200"
            ((PASSED_TESTS++))
        else
            log_issue "Endpoint error" "Endpoint $endpoint returned status $status_code instead of 200" "medium"
        fi
        ((TOTAL_TESTS++))
    done
    
    # Stop application
    kill $app_pid 2>/dev/null || true
}

# Test GitHub integration
test_github_integration() {
    log_info "🐙 Testing GitHub integration..."
    
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        # Test GitHub API connectivity
        if curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user >/dev/null 2>&1; then
            log_success "GitHub API connectivity test passed"
            ((PASSED_TESTS++))
        else
            log_issue "GitHub API connectivity failed" "Cannot connect to GitHub API with provided token" "high"
        fi
        ((TOTAL_TESTS++))
        
        # Test rate limit
        local rate_limit=$(curl -s -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit | jq -r '.rate.remaining' 2>/dev/null || echo "0")
        if [ "$rate_limit" -gt 100 ]; then
            log_success "GitHub rate limit OK: $rate_limit remaining"
            ((PASSED_TESTS++))
        else
            log_warning "GitHub rate limit low: $rate_limit remaining"
        fi
        ((TOTAL_TESTS++))
        
    else
        log_warning "GITHUB_TOKEN not set. Skipping GitHub integration tests."
    fi
}

# Test security features
test_security() {
    log_info "🛡️ Testing security features..."
    
    cd "$PROJECT_PATH"
    
    # Check for hardcoded secrets
    if grep -r "password.*=.*['\"].*['\"]" src/ 2>/dev/null | grep -v "your-password\|example\|placeholder"; then
        log_issue "Hardcoded credentials found" "Found potential hardcoded credentials in source code" "critical"
    else
        log_success "No hardcoded credentials found"
        ((PASSED_TESTS++))
    fi
    ((TOTAL_TESTS++))
    
    # Check .env.example exists
    if [ -f ".env.example" ]; then
        log_success ".env.example file exists"
        ((PASSED_TESTS++))
    else
        log_issue "Missing .env.example" ".env.example file is missing for secure configuration" "medium"
    fi
    ((TOTAL_TESTS++))
    
    # Check gitignore for sensitive files
    if grep -q "\.env" .gitignore && grep -q "node_modules" .gitignore; then
        log_success ".gitignore properly configured"
        ((PASSED_TESTS++))
    else
        log_issue "Incomplete .gitignore" ".gitignore does not properly exclude sensitive files" "medium"
    fi
    ((TOTAL_TESTS++))
}

# Test documentation
test_documentation() {
    log_info "📚 Testing documentation..."
    
    cd "$PROJECT_PATH"
    
    # Check README completeness
    local readme_sections=(
        "Installation"
        "Usage"
        "Configuration"
        "API"
        "Contributing"
    )
    
    for section in "${readme_sections[@]}"; do
        if grep -q "$section" README.md; then
            log_success "README contains $section section"
            ((PASSED_TESTS++))
        else
            log_warning "README missing $section section"
        fi
        ((TOTAL_TESTS++))
    done
    
    # Check for broken links in README
    if command -v markdown-link-check >/dev/null 2>&1; then
        if markdown-link-check README.md >/dev/null 2>&1; then
            log_success "README links are valid"
            ((PASSED_TESTS++))
        else
            log_issue "Broken links in README" "README contains broken or invalid links" "low"
        fi
        ((TOTAL_TESTS++))
    fi
    
    # Check API documentation
    if [ -d "docs" ] && [ "$(find docs -name "*.md" | wc -l)" -gt 3 ]; then
        log_success "Comprehensive documentation exists"
        ((PASSED_TESTS++))
    else
        log_issue "Limited documentation" "Insufficient documentation in docs directory" "low"
    fi
    ((TOTAL_TESTS++))
}

# Test scripts and executables
test_scripts() {
    log_info "📜 Testing scripts and executables..."
    
    cd "$PROJECT_PATH"
    
    # Check script executability
    local scripts=(
        "scripts/comprehensive-e2e-test.sh"
        "scripts/sanitize-for-github.sh"
        "install-comprehensive.sh"
        "setup-backup-system.sh"
    )
    
    for script in "${scripts[@]}"; do
        if [ -f "$script" ]; then
            if [ -x "$script" ]; then
                log_success "Script is executable: $script"
                ((PASSED_TESTS++))
            else
                log_issue "Script not executable" "Script $script exists but is not executable" "low"
            fi
        else
            log_warning "Script not found: $script"
        fi
        ((TOTAL_TESTS++))
    done
    
    # Test script syntax
    for script in "${scripts[@]}"; do
        if [ -f "$script" ]; then
            if bash -n "$script" >/dev/null 2>&1; then
                log_success "Script syntax OK: $script"
                ((PASSED_TESTS++))
            else
                log_issue "Script syntax error" "Script $script has syntax errors" "medium"
            fi
            ((TOTAL_TESTS++))
        fi
    done
}

# Cleanup function
cleanup() {
    log_info "🧹 Cleaning up test environment..."
    
    cd "$PROJECT_PATH"
    
    # Stop any running services
    docker-compose down >/dev/null 2>&1 || true
    
    # Kill any background processes
    pkill -f "npm start" >/dev/null 2>&1 || true
    
    log_success "Cleanup completed"
}

# Generate final report
generate_report() {
    log_info "📊 Generating test report..."
    
    local success_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    
    echo "
========================================
🧪 GitHub-RunnerHub Comprehensive Test Report
========================================

📊 Test Results:
- Total Tests: $TOTAL_TESTS
- Passed: $PASSED_TESTS
- Failed: $FAILED_TESTS
- Success Rate: ${success_rate}%

🎯 Overall Status: $([ $FAILED_TESTS -eq 0 ] && echo "✅ ALL TESTS PASSED" || echo "⚠️ ISSUES FOUND")

📋 Issues Found: ${#ISSUES_FOUND[@]}
" | tee -a "$TEST_LOG"

    if [ ${#ISSUES_FOUND[@]} -gt 0 ]; then
        echo "🐛 Issues Summary:" | tee -a "$TEST_LOG"
        for issue in "${ISSUES_FOUND[@]}"; do
            IFS='|' read -r severity title description <<< "$issue"
            echo "  [$severity] $title" | tee -a "$TEST_LOG"
        done
        echo "" | tee -a "$TEST_LOG"
    fi
    
    echo "🎯 Deployment Readiness:" | tee -a "$TEST_LOG"
    if [ $FAILED_TESTS -eq 0 ]; then
        echo "✅ System is ready for deployment to $REMOTE_HOST" | tee -a "$TEST_LOG"
    elif [ ${#ISSUES_FOUND[@]} -gt 0 ]; then
        local critical_issues=$(printf '%s\n' "${ISSUES_FOUND[@]}" | grep "^critical" | wc -l)
        if [ "$critical_issues" -gt 0 ]; then
            echo "❌ Critical issues found. Fix before deployment." | tee -a "$TEST_LOG"
        else
            echo "⚠️ Non-critical issues found. Deployment possible with monitoring." | tee -a "$TEST_LOG"
        fi
    fi
    
    echo "
📁 Full test log: $TEST_LOG
📁 Issues log: $TEST_LOG.issues (if exists)
🌐 Repository: https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub
📧 Report generated: $(date)
========================================
" | tee -a "$TEST_LOG"
    
    log_success "Test report generated!"
}

# Main execution
main() {
    echo "🧪 Starting GitHub-RunnerHub Comprehensive Local Testing"
    echo "Project Path: $PROJECT_PATH"
    echo "Test Log: $TEST_LOG"
    echo "Target Deployment: $REMOTE_HOST"
    echo "========================================================"
    
    # Run all test suites
    test_project_structure
    test_dependencies
    test_typescript
    test_docker
    test_database
    test_application
    test_github_integration
    test_security
    test_documentation
    test_scripts
    
    # Clean up and report
    cleanup
    generate_report
    
    # Return appropriate exit code
    if [ $FAILED_TESTS -eq 0 ]; then
        log_success "🎉 All tests passed! System ready for deployment."
        exit 0
    else
        log_error "⚠️ Some tests failed. Review issues before deployment."
        exit 1
    fi
}

# Handle script interruption
trap 'log_error "Testing interrupted"; cleanup; exit 1' INT TERM

# Execute main function
main "$@"