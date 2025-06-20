#!/bin/bash
# Verify the build and check for runtime errors

set -e

echo "=== GitHub-RunnerHub Build Verification ==="
echo

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Step 1: Check if dependencies are installed
echo "1. Checking dependencies..."
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✓${NC} Dependencies installed"
else
    echo -e "${RED}✗${NC} Dependencies not installed. Run 'npm install'"
    exit 1
fi

# Step 2: Run TypeScript build
echo -e "\n2. Building TypeScript..."
if npm run build > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} TypeScript build successful"
else
    echo -e "${RED}✗${NC} TypeScript build failed"
    npm run build
    exit 1
fi

# Step 3: Check if dist directory exists
echo -e "\n3. Checking build output..."
if [ -d "dist" ] && [ -f "dist/index.js" ]; then
    echo -e "${GREEN}✓${NC} Build output exists"
    echo "   - dist/index.js found"
    echo "   - $(find dist -name "*.js" | wc -l) JavaScript files generated"
else
    echo -e "${RED}✗${NC} Build output missing"
    exit 1
fi

# Step 4: Run type checking
echo -e "\n4. Running type check..."
if npm run typecheck > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} No TypeScript errors"
else
    echo -e "${RED}✗${NC} TypeScript errors found"
    npm run typecheck
    exit 1
fi

# Step 5: Check imports
echo -e "\n5. Checking module imports..."
if node -e "require('./dist/index.js')" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Module imports successful"
else
    echo -e "${RED}✗${NC} Module import errors"
    node -e "require('./dist/index.js')"
    exit 1
fi

# Step 6: Test configuration loading
echo -e "\n6. Testing configuration..."
cat > test-config.js << 'EOF'
const config = require('./dist/config').default;
console.log('Config loaded:', Object.keys(config).join(', '));
process.exit(0);
EOF

if node test-config.js > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Configuration loads correctly"
else
    echo -e "${RED}✗${NC} Configuration error"
    node test-config.js
    exit 1
fi
rm -f test-config.js

# Step 7: Check Docker files
echo -e "\n7. Checking Docker configuration..."
if docker-compose config > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Docker Compose configuration valid"
else
    echo -e "${RED}✗${NC} Docker Compose configuration error"
    docker-compose config
fi

# Step 8: Verify hook scripts
echo -e "\n8. Checking hook scripts..."
if [ -x "hooks/job-started.sh" ] && [ -x "hooks/job-completed.sh" ]; then
    echo -e "${GREEN}✓${NC} Hook scripts are executable"
else
    echo -e "${RED}✗${NC} Hook scripts not executable"
    exit 1
fi

# Summary
echo -e "\n=== Build Verification Summary ==="
echo -e "${GREEN}✓${NC} All build checks passed!"
echo
echo "Next steps:"
echo "1. Start Redis and PostgreSQL: docker-compose up -d redis postgres"
echo "2. Initialize database: psql \$DATABASE_URL < docker/postgres/init.sql"
echo "3. Start the application: npm start"
echo "4. Run E2E tests: ./scripts/e2e-test.sh"