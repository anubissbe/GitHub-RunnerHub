#!/bin/bash
# Comprehensive error checking for GitHub-RunnerHub

echo "=== GitHub-RunnerHub Error Check ==="
echo

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS_FOUND=0

# 1. Check TypeScript compilation
echo "1. TypeScript Compilation Check"
if npm run build > /tmp/build.log 2>&1; then
    echo -e "   ${GREEN}✓${NC} No TypeScript errors"
else
    echo -e "   ${RED}✗${NC} TypeScript compilation failed"
    cat /tmp/build.log
    ERRORS_FOUND=1
fi

# 2. Check for syntax errors
echo -e "\n2. JavaScript Syntax Check"
for file in dist/**/*.js; do
    if [ -f "$file" ]; then
        if ! node -c "$file" 2>/dev/null; then
            echo -e "   ${RED}✗${NC} Syntax error in $file"
            ERRORS_FOUND=1
        fi
    fi
done
if [ $ERRORS_FOUND -eq 0 ]; then
    echo -e "   ${GREEN}✓${NC} No syntax errors"
fi

# 3. Check for missing dependencies
echo -e "\n3. Dependency Check"
MISSING_DEPS=$(npm ls 2>&1 | grep "UNMET DEPENDENCY" || true)
if [ -z "$MISSING_DEPS" ]; then
    echo -e "   ${GREEN}✓${NC} All dependencies satisfied"
else
    echo -e "   ${RED}✗${NC} Missing dependencies:"
    echo "$MISSING_DEPS"
    ERRORS_FOUND=1
fi

# 4. Check Docker configuration
echo -e "\n4. Docker Configuration Check"
if docker-compose config > /dev/null 2>&1; then
    echo -e "   ${GREEN}✓${NC} Docker Compose configuration valid"
else
    echo -e "   ${RED}✗${NC} Docker Compose configuration error"
    docker-compose config
    ERRORS_FOUND=1
fi

# 5. Check SQL syntax
echo -e "\n5. SQL Syntax Check"
# Basic SQL syntax check (not comprehensive)
if grep -E "CREATE|INSERT|UPDATE|DELETE" docker/postgres/init.sql | grep -v ";" > /dev/null; then
    echo -e "   ${YELLOW}⚠${NC}  Possible missing semicolons in SQL"
else
    echo -e "   ${GREEN}✓${NC} SQL syntax appears correct"
fi

# 6. Check for console.log statements (except in allowed places)
echo -e "\n6. Console.log Check"
CONSOLE_LOGS=$(grep -r "console\.log" src/ --include="*.ts" | grep -v "test\." | grep -v "spec\." || true)
if [ -z "$CONSOLE_LOGS" ]; then
    echo -e "   ${GREEN}✓${NC} No console.log statements in production code"
else
    echo -e "   ${YELLOW}⚠${NC}  Found console.log statements:"
    echo "$CONSOLE_LOGS" | head -5
fi

# 7. Check for TODO comments
echo -e "\n7. TODO Comments Check"
TODO_COUNT=$(grep -r "TODO\|FIXME\|XXX" src/ --include="*.ts" | wc -l || echo "0")
if [ "$TODO_COUNT" -eq "0" ]; then
    echo -e "   ${GREEN}✓${NC} No TODO comments found"
else
    echo -e "   ${YELLOW}⚠${NC}  Found $TODO_COUNT TODO/FIXME comments"
fi

# 8. Check TypeScript strict mode
echo -e "\n8. TypeScript Strict Mode Check"
if grep -q '"strict": true' tsconfig.json; then
    echo -e "   ${GREEN}✓${NC} TypeScript strict mode enabled"
else
    echo -e "   ${YELLOW}⚠${NC}  TypeScript strict mode not enabled"
fi

# 9. Check for security issues
echo -e "\n9. Security Check"
# Check for hardcoded secrets
SECRETS=$(grep -r "password\|secret\|token" src/ --include="*.ts" | grep -E "=\s*['\"]" | grep -v "test\." | grep -v "\.example" || true)
if [ -z "$SECRETS" ]; then
    echo -e "   ${GREEN}✓${NC} No hardcoded secrets found"
else
    echo -e "   ${RED}✗${NC} Possible hardcoded secrets:"
    echo "$SECRETS" | head -3
    ERRORS_FOUND=1
fi

# 10. Run unit tests
echo -e "\n10. Unit Test Check"
if npm test -- --passWithNoTests > /tmp/test.log 2>&1; then
    TEST_COUNT=$(grep -o "[0-9]* passed" /tmp/test.log | head -1)
    echo -e "   ${GREEN}✓${NC} Tests pass ($TEST_COUNT)"
else
    echo -e "   ${RED}✗${NC} Some tests failed"
    tail -20 /tmp/test.log
    ERRORS_FOUND=1
fi

# Summary
echo -e "\n=== Error Check Summary ==="
if [ $ERRORS_FOUND -eq 0 ]; then
    echo -e "${GREEN}✓ No critical errors found!${NC}"
    echo -e "\nThe codebase is ready for deployment."
else
    echo -e "${RED}✗ Found $ERRORS_FOUND critical error(s)${NC}"
    echo -e "\nPlease fix the errors before proceeding."
    exit 1
fi

# Clean up
rm -f /tmp/build.log /tmp/test.log

echo -e "\nNext steps:"
echo "1. Run integration tests: ./scripts/integration-test.sh"
echo "2. Deploy with Docker: docker-compose up -d"
echo "3. Run E2E tests: ./scripts/e2e-test.sh"