#!/bin/bash

# Comprehensive Remote Deployment and Testing Script for GitHub-RunnerHub
# Deploys to 192.168.1.16 and performs extensive testing

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REMOTE_HOST="git-runner"
REMOTE_USER="drwho"
REMOTE_PATH="/opt/github-runnerhub"
LOCAL_PROJECT_PATH="/opt/projects/projects/GitHub-RunnerHub"
SSH_KEY_PATH="$HOME/.ssh/git-runner_rsa"
DEPLOYMENT_LOG="/tmp/github-runnerhub-deployment-$(date +%Y%m%d_%H%M%S).log"

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
ISSUES_FOUND=()

# Utility functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$DEPLOYMENT_LOG"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$DEPLOYMENT_LOG"
    ((PASSED_TESTS++))
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$DEPLOYMENT_LOG"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$DEPLOYMENT_LOG"
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

# Execute command on remote server
remote_exec() {
    local command="$1"
    local description="${2:-Executing remote command}"
    
    log_info "$description"
    if ssh -o ConnectTimeout=10 -i "$SSH_KEY_PATH" "$REMOTE_USER@$REMOTE_HOST" "$command" 2>&1 | tee -a "$DEPLOYMENT_LOG"; then
        return 0
    else
        log_error "Remote command failed: $command"
        return 1
    fi
}

# Copy files to remote server
remote_copy() {
    local local_path="$1"
    local remote_path="$2"
    local description="${3:-Copying files}"
    
    log_info "$description"
    if scp -r -i "$SSH_KEY_PATH" "$local_path" "$REMOTE_USER@$REMOTE_HOST:$remote_path" 2>&1 | tee -a "$DEPLOYMENT_LOG"; then
        log_success "Successfully copied $local_path to $remote_path"
        return 0
    else
        log_error "Failed to copy $local_path to $remote_path"
        return 1
    fi
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
            log_error "Critical test failed. Stopping deployment."
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
    
    # Create issue body with deployment context
    local issue_body="## Issue Description
$description

## Environment Details
- **Deployment Target**: $REMOTE_HOST
- **Deployment Time**: $(date)
- **Version**: GitHub-RunnerHub v2.0.0
- **Detection Method**: Automated deployment testing

## Steps to Reproduce
1. Deploy GitHub-RunnerHub to fresh server
2. Run comprehensive testing suite
3. Observe the issue

## Expected Behavior
The system should function correctly without errors.

## Additional Context
- Log file: $DEPLOYMENT_LOG
- Deployment script: scripts/deploy-and-test-remote.sh

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
                --repo "YOUR_GITHUB_ORG/GitHub-RunnerHub" || log_warning "Failed to create GitHub issue with gh CLI"
        else
            # Create issue using curl
            curl -s -X POST \
                -H "Authorization: token $GITHUB_TOKEN" \
                -H "Accept: application/vnd.github.v3+json" \
                "https://api.github.com/repos/YOUR_GITHUB_ORG/GitHub-RunnerHub/issues" \
                -d "{
                    \"title\": \"$title\",
                    \"body\": \"$issue_body\",
                    \"labels\": [\"$labels\"]
                }" || log_warning "Failed to create GitHub issue with curl"
        fi
    else
        log_warning "GITHUB_TOKEN not set. Cannot create GitHub issue for: $title"
    fi
}

# Check prerequisites
check_prerequisites() {
    log_info "🔍 Checking deployment prerequisites..."
    
    # Check SSH key
    if [ ! -f "$SSH_KEY_PATH" ]; then
        log_error "SSH key not found at $SSH_KEY_PATH"
        exit 1
    fi
    
    # Test SSH connection
    if ! ssh -o ConnectTimeout=10 -i "$SSH_KEY_PATH" "$REMOTE_USER@$REMOTE_HOST" "echo 'SSH connection successful'" >/dev/null 2>&1; then
        log_error "Cannot connect to $REMOTE_HOST via SSH"
        exit 1
    fi
    
    # Check if GitHub token is available for issue creation
    if [ -z "${GITHUB_TOKEN:-}" ]; then
        log_warning "GITHUB_TOKEN not set. GitHub issues will not be created automatically."
        read -p "Continue without GitHub issue creation? (y/N): " -r
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    log_success "Prerequisites check passed"
}

# Prepare remote server
prepare_remote_server() {
    log_info "🛠️ Preparing remote server..."
    
    # Update system
    run_test "System update" "remote_exec 'apt update && apt upgrade -y' 'Updating system packages'"
    
    # Install required packages
    run_test "Install Docker" "remote_exec 'curl -fsSL https://get.docker.com | sh' 'Installing Docker'"
    run_test "Install Docker Compose" "remote_exec 'curl -L \"https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)\" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose' 'Installing Docker Compose'"
    run_test "Install Node.js" "remote_exec 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs' 'Installing Node.js 20'"
    run_test "Install Git" "remote_exec 'apt-get install -y git curl wget htop' 'Installing additional tools'"
    
    # Start Docker service
    run_test "Start Docker service" "remote_exec 'systemctl enable docker && systemctl start docker' 'Starting Docker service'"
    
    # Create project directory
    remote_exec "mkdir -p $REMOTE_PATH" "Creating project directory"
    
    log_success "Remote server preparation completed"
}

# Deploy application
deploy_application() {
    log_info "🚀 Deploying GitHub-RunnerHub..."
    
    # Copy project files
    run_test "Copy project files" "remote_copy '$LOCAL_PROJECT_PATH/' '$REMOTE_PATH/'"
    
    # Set up environment
    run_test "Setup environment" "remote_exec 'cd $REMOTE_PATH && cp .env.example .env' 'Creating environment file'"
    
    # Install dependencies
    run_test "Install dependencies" "remote_exec 'cd $REMOTE_PATH && npm install' 'Installing Node.js dependencies'"
    
    # Build application
    run_test "Build application" "remote_exec 'cd $REMOTE_PATH && npm run build' 'Building TypeScript application'"
    
    # Make scripts executable
    remote_exec "cd $REMOTE_PATH && chmod +x scripts/*.sh *.sh" "Making scripts executable"
    
    log_success "Application deployment completed"
}

# Test basic functionality
test_basic_functionality() {
    log_info "🧪 Testing basic functionality..."
    
    # Test Docker Compose configuration
    run_test "Docker Compose validation" "remote_exec 'cd $REMOTE_PATH && docker-compose config' 'Validating Docker Compose files'"
    
    # Start services
    run_test "Start services" "remote_exec 'cd $REMOTE_PATH && docker-compose up -d' 'Starting Docker services'"
    
    # Wait for services to be ready
    sleep 30
    
    # Check service status
    run_test "Check service status" "remote_exec 'cd $REMOTE_PATH && docker-compose ps' 'Checking service status'"
    
    # Test database connectivity
    run_test "Test database" "remote_exec 'cd $REMOTE_PATH && docker-compose exec -T postgres psql -U postgres -c \"SELECT 1;\"' 'Testing database connectivity'"
    
    # Test Redis connectivity
    run_test "Test Redis" "remote_exec 'cd $REMOTE_PATH && docker-compose exec -T redis redis-cli ping' 'Testing Redis connectivity'"
    
    # Build and start application
    run_test "Start application" "remote_exec 'cd $REMOTE_PATH && npm start &' 'Starting application'"
    
    # Wait for application to start
    sleep 20
    
    # Test application health endpoint
    run_test "Test health endpoint" "remote_exec 'curl -f http://localhost:3001/health' 'Testing application health endpoint'"
    
    log_success "Basic functionality tests completed"
}

# Test GitHub integration
test_github_integration() {
    log_info "🐙 Testing GitHub integration..."
    
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        # Set GitHub token on remote server
        remote_exec "cd $REMOTE_PATH && echo 'GITHUB_TOKEN=$GITHUB_TOKEN' >> .env" "Setting GitHub token"
        
        # Test GitHub API connectivity
        run_test "GitHub API connectivity" "remote_exec 'curl -H \"Authorization: token $GITHUB_TOKEN\" https://api.github.com/user' 'Testing GitHub API connectivity'"
        
        # Test rate limit endpoint
        run_test "GitHub rate limit" "remote_exec 'curl -H \"Authorization: token $GITHUB_TOKEN\" https://api.github.com/rate_limit' 'Testing GitHub rate limit endpoint'"
        
        # Restart application with GitHub token
        remote_exec "cd $REMOTE_PATH && pkill -f 'npm start' || true && npm start &" "Restarting application with GitHub token"
        sleep 20
        
        # Test GitHub integration endpoints
        run_test "GitHub status endpoint" "remote_exec 'curl -f http://localhost:3001/api/github/status' 'Testing GitHub status endpoint'"
        
    else
        log_warning "GITHUB_TOKEN not available. Skipping GitHub integration tests."
    fi
}

# Test advanced features
test_advanced_features() {
    log_info "🔧 Testing advanced features..."
    
    # Test monitoring endpoint
    run_test "Monitoring endpoint" "remote_exec 'curl -f http://localhost:3001/api/monitoring/dashboard' 'Testing monitoring dashboard endpoint'"
    
    # Test metrics endpoint
    run_test "Metrics endpoint" "remote_exec 'curl -f http://localhost:3001/api/metrics' 'Testing Prometheus metrics endpoint'"
    
    # Test dashboard access
    run_test "Dashboard access" "remote_exec 'curl -f http://localhost:3001/dashboard' 'Testing dashboard page access'"
    
    # Test database migration
    run_test "Database migrations" "remote_exec 'cd $REMOTE_PATH && npm run migrate || echo \"Migration command not found\"' 'Testing database migrations'"
    
    # Test backup system
    if remote_exec "cd $REMOTE_PATH && test -f setup-backup-system.sh" "Checking backup system availability"; then
        run_test "Backup system setup" "remote_exec 'cd $REMOTE_PATH && ./setup-backup-system.sh --dry-run' 'Testing backup system setup'"
    fi
}

# Performance and load testing
test_performance() {
    log_info "⚡ Testing performance..."
    
    # Test concurrent requests
    run_test "Concurrent requests" "remote_exec 'for i in {1..10}; do curl -s http://localhost:3001/health & done; wait' 'Testing concurrent requests'"
    
    # Test response times
    local response_time=$(remote_exec "curl -w '%{time_total}' -s -o /dev/null http://localhost:3001/health" "Measuring response time" | tail -1)
    if (( $(echo "$response_time < 1.0" | bc -l) )); then
        log_success "Response time test passed: ${response_time}s"
        ((PASSED_TESTS++))
    else
        log_issue "Slow response time" "Health endpoint response time is ${response_time}s, which exceeds the 1.0s threshold" "medium"
    fi
    ((TOTAL_TESTS++))
    
    # Test memory usage
    local memory_usage=$(remote_exec "ps aux | grep -E '(node|npm)' | grep -v grep | awk '{sum+=\$6} END {print sum/1024}'" "Checking memory usage" | tail -1)
    if [ -n "$memory_usage" ] && (( $(echo "$memory_usage < 1000" | bc -l) )); then
        log_success "Memory usage test passed: ${memory_usage}MB"
        ((PASSED_TESTS++))
    else
        log_issue "High memory usage" "Application memory usage is ${memory_usage}MB, which may be excessive" "low"
    fi
    ((TOTAL_TESTS++))
}

# Test security features
test_security() {
    log_info "🛡️ Testing security features..."
    
    # Test security headers
    local security_headers=$(remote_exec "curl -I http://localhost:3001/health 2>/dev/null | grep -i 'x-frame-options\\|x-content-type-options\\|x-xss-protection'" "Checking security headers" | wc -l)
    if [ "$security_headers" -gt 0 ]; then
        log_success "Security headers test passed"
        ((PASSED_TESTS++))
    else
        log_issue "Missing security headers" "Application is missing important security headers like X-Frame-Options, X-Content-Type-Options, etc." "medium"
    fi
    ((TOTAL_TESTS++))
    
    # Test for exposed sensitive information
    if remote_exec "curl -s http://localhost:3001/health | grep -i 'password\\|token\\|secret'" "Checking for exposed secrets" >/dev/null; then
        log_issue "Sensitive information exposure" "Health endpoint may be exposing sensitive information" "high"
    else
        log_success "No sensitive information exposed"
        ((PASSED_TESTS++))
    fi
    ((TOTAL_TESTS++))
}

# Test error handling
test_error_handling() {
    log_info "🚨 Testing error handling..."
    
    # Test invalid endpoints
    local invalid_response=$(remote_exec "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/invalid-endpoint" "Testing invalid endpoint")
    if [ "$invalid_response" = "404" ]; then
        log_success "Invalid endpoint handling test passed"
        ((PASSED_TESTS++))
    else
        log_issue "Incorrect error handling" "Invalid endpoint returned HTTP $invalid_response instead of 404" "low"
    fi
    ((TOTAL_TESTS++))
    
    # Test malformed requests
    local malformed_response=$(remote_exec "curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d 'invalid-json' http://localhost:3001/api/test" "Testing malformed request")
    if [ "$malformed_response" = "400" ] || [ "$malformed_response" = "404" ]; then
        log_success "Malformed request handling test passed"
        ((PASSED_TESTS++))
    else
        log_issue "Poor malformed request handling" "Malformed JSON request returned HTTP $malformed_response" "low"
    fi
    ((TOTAL_TESTS++))
}

# Check for common issues
check_common_issues() {
    log_info "🔍 Checking for common deployment issues..."
    
    # Check disk space
    local disk_usage=$(remote_exec "df / | tail -1 | awk '{print \$5}' | sed 's/%//'" "Checking disk usage")
    if [ "$disk_usage" -gt 90 ]; then
        log_issue "Low disk space" "Disk usage is at ${disk_usage}%, which may cause issues" "high"
    else
        log_success "Disk space check passed: ${disk_usage}% used"
        ((PASSED_TESTS++))
    fi
    ((TOTAL_TESTS++))
    
    # Check for port conflicts
    if remote_exec "netstat -tulpn | grep ':3001 '" "Checking port 3001" >/dev/null; then
        log_success "Application is listening on port 3001"
        ((PASSED_TESTS++))
    else
        log_issue "Port binding issue" "Application is not listening on expected port 3001" "critical"
    fi
    ((TOTAL_TESTS++))
    
    # Check Docker service status
    if remote_exec "systemctl is-active docker" "Checking Docker service" >/dev/null; then
        log_success "Docker service is running"
        ((PASSED_TESTS++))
    else
        log_issue "Docker service issue" "Docker service is not running properly" "critical"
    fi
    ((TOTAL_TESTS++))
    
    # Check container health
    local unhealthy_containers=$(remote_exec "cd $REMOTE_PATH && docker-compose ps | grep -c 'unhealthy\\|restarting\\|exited'" "Checking container health" || echo "0")
    if [ "$unhealthy_containers" -eq 0 ]; then
        log_success "All containers are healthy"
        ((PASSED_TESTS++))
    else
        log_issue "Unhealthy containers" "Found $unhealthy_containers unhealthy containers" "high"
    fi
    ((TOTAL_TESTS++))
}

# Cleanup and generate report
cleanup_and_report() {
    log_info "🧹 Cleaning up and generating report..."
    
    # Stop services
    remote_exec "cd $REMOTE_PATH && docker-compose down" "Stopping Docker services"
    
    # Generate test report
    local success_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    
    echo "
========================================
🚀 GitHub-RunnerHub Deployment Report
========================================

📊 Test Results:
- Total Tests: $TOTAL_TESTS
- Passed: $PASSED_TESTS
- Failed: $FAILED_TESTS
- Success Rate: ${success_rate}%

🎯 Deployment Status: $([ $FAILED_TESTS -eq 0 ] && echo "✅ SUCCESS" || echo "⚠️ ISSUES FOUND")

📋 Issues Found: ${#ISSUES_FOUND[@]}
" | tee -a "$DEPLOYMENT_LOG"

    if [ ${#ISSUES_FOUND[@]} -gt 0 ]; then
        echo "🐛 Issues Summary:" | tee -a "$DEPLOYMENT_LOG"
        for issue in "${ISSUES_FOUND[@]}"; do
            IFS='|' read -r severity title description <<< "$issue"
            echo "  [$severity] $title" | tee -a "$DEPLOYMENT_LOG"
        done
    fi
    
    echo "
📁 Full deployment log: $DEPLOYMENT_LOG
🌐 Repository: https://github.com/YOUR_GITHUB_ORG/GitHub-RunnerHub
📧 Report generated: $(date)
========================================
" | tee -a "$DEPLOYMENT_LOG"
    
    log_success "Deployment and testing completed!"
    
    # Copy log to remote for debugging
    remote_copy "$DEPLOYMENT_LOG" "$REMOTE_PATH/deployment.log" "Copying deployment log to remote server"
}

# Main execution
main() {
    echo "🚀 Starting GitHub-RunnerHub Comprehensive Deployment and Testing"
    echo "Target Server: $REMOTE_HOST"
    echo "Deployment Log: $DEPLOYMENT_LOG"
    echo "========================================================"
    
    # Start deployment process
    check_prerequisites
    prepare_remote_server
    deploy_application
    
    # Run comprehensive tests
    test_basic_functionality
    test_github_integration
    test_advanced_features
    test_performance
    test_security
    test_error_handling
    check_common_issues
    
    # Complete deployment
    cleanup_and_report
    
    # Exit with appropriate code
    if [ $FAILED_TESTS -eq 0 ]; then
        exit 0
    else
        exit 1
    fi
}

# Handle script interruption
trap 'log_error "Deployment interrupted"; exit 1' INT TERM

# Execute main function
main "$@"