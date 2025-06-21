#!/bin/bash

# Quick Issue Detection Script for GitHub-RunnerHub
# Rapidly identifies critical issues before deployment

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_PATH="/opt/projects/projects/GitHub-RunnerHub"
ISSUES_FOUND=()

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

create_github_issue() {
    local title="$1"
    local description="$2"
    local severity="$3"
    
    ISSUES_FOUND+=("$severity|$title|$description")
    
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        log_info "Creating GitHub issue: $title"
        curl -s -X POST \
            -H "Authorization: token $GITHUB_TOKEN" \
            -H "Accept: application/vnd.github.v3+json" \
            "https://api.github.com/repos/YOUR_GITHUB_ORG/GitHub-RunnerHub/issues" \
            -d "{
                \"title\": \"$title\",
                \"body\": \"**Severity:** $severity\\n\\n$description\\n\\n**Auto-detected during deployment preparation**\",
                \"labels\": [\"bug\", \"automated-detection\", \"$severity\"]
            }" >/dev/null 2>&1 && log_success "Issue created" || log_warning "Failed to create issue"
    fi
}

echo "🔍 Quick Issue Detection for GitHub-RunnerHub"
echo "=============================================="

cd "$PROJECT_PATH"

# Check 1: Essential files
log_info "Checking essential files..."
essential_files=("package.json" "tsconfig.json" "docker-compose.yml" "README.md" "src/index.ts")
for file in "${essential_files[@]}"; do
    if [ ! -f "$file" ]; then
        create_github_issue "Missing essential file: $file" "Critical file $file is missing from the project structure" "critical"
        log_error "Missing: $file"
    fi
done

# Check 2: Package.json syntax
log_info "Checking package.json syntax..."
if ! node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))" 2>/dev/null; then
    create_github_issue "Invalid package.json syntax" "The package.json file contains syntax errors" "critical"
    log_error "Invalid package.json"
fi

# Check 3: TypeScript config
log_info "Checking TypeScript configuration..."
if ! npx tsc --noEmit --skipLibCheck 2>/dev/null; then
    create_github_issue "TypeScript compilation errors" "TypeScript compilation fails with errors" "high"
    log_error "TypeScript errors found"
fi

# Check 4: Docker Compose syntax
log_info "Checking Docker Compose syntax..."
if ! docker-compose config >/dev/null 2>&1; then
    create_github_issue "Invalid Docker Compose configuration" "docker-compose.yml has syntax errors or invalid configuration" "high"
    log_error "Docker Compose config invalid"
fi

# Check 5: Port conflicts
log_info "Checking for port conflicts..."
if netstat -tuln 2>/dev/null | grep -q ":3001 "; then
    create_github_issue "Port 3001 already in use" "Application port 3001 is already in use by another process" "medium"
    log_warning "Port 3001 is in use"
fi

# Check 6: Hardcoded sensitive data
log_info "Scanning for hardcoded secrets..."
if grep -r "192\.168\.1\.24\|hvs\.[A-Za-z0-9]" src/ 2>/dev/null | grep -v "YOUR_" | head -1; then
    create_github_issue "Hardcoded sensitive data found" "Found hardcoded IP addresses or tokens in source code" "critical"
    log_error "Sensitive data found"
fi

# Check 7: Missing environment example
log_info "Checking environment configuration..."
if [ ! -f ".env.example" ]; then
    create_github_issue "Missing .env.example file" "No .env.example file provided for configuration reference" "medium"
    log_warning "Missing .env.example"
fi

# Check 8: Database migration files
log_info "Checking database migrations..."
if [ ! -d "migrations" ] || [ -z "$(ls migrations/*.sql 2>/dev/null)" ]; then
    create_github_issue "Missing database migrations" "No database migration files found in migrations directory" "medium"
    log_warning "No migration files"
fi

# Check 9: Installation scripts
log_info "Checking installation scripts..."
if [ ! -f "install-comprehensive.sh" ] || [ ! -x "install-comprehensive.sh" ]; then
    create_github_issue "Installation script issues" "install-comprehensive.sh is missing or not executable" "medium"
    log_warning "Installation script issues"
fi

# Check 10: Test configuration
log_info "Checking test setup..."
if [ ! -f "jest.config.js" ] && ! grep -q "test.*jest" package.json; then
    create_github_issue "Missing test configuration" "No Jest configuration found for running tests" "low"
    log_warning "No test config"
fi

echo ""
echo "📊 Quick Issue Detection Results:"
echo "================================="
echo "Issues found: ${#ISSUES_FOUND[@]}"

if [ ${#ISSUES_FOUND[@]} -gt 0 ]; then
    echo ""
    echo "🐛 Issues Summary:"
    for issue in "${ISSUES_FOUND[@]}"; do
        IFS='|' read -r severity title description <<< "$issue"
        echo "  [$severity] $title"
    done
    
    # Count critical issues
    critical_count=$(printf '%s\n' "${ISSUES_FOUND[@]}" | grep -c "^critical" || echo "0")
    
    echo ""
    if [ "$critical_count" -gt 0 ]; then
        log_error "❌ $critical_count critical issues found. Fix before deployment!"
        exit 1
    else
        log_warning "⚠️ Non-critical issues found. Deployment possible with monitoring."
        exit 2
    fi
else
    log_success "✅ No critical issues detected. System appears ready for deployment."
    exit 0
fi