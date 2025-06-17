#!/bin/bash

echo "Testing GitHub RunnerHub fixes..."
echo "================================"

# Check 1: Type consistency in frontend types
echo "1. Checking type consistency..."
if grep -q "labels: RunnerLabel\[\]" frontend/src/types/index.ts; then
    echo "✓ Runner labels type is correctly defined"
else
    echo "✗ Runner labels type issue"
fi

# Check 2: Backend Dockerfile
echo -e "\n2. Checking Backend Dockerfile..."
if grep -q "docker-cli" backend/Dockerfile && grep -q "HEALTHCHECK" backend/Dockerfile; then
    echo "✓ Backend Dockerfile has docker-cli and health check"
else
    echo "✗ Backend Dockerfile missing docker-cli or health check"
fi

# Check 3: Frontend environment variables
echo -e "\n3. Checking frontend environment variables..."
if grep -q "import.meta.env.VITE_API_URL" frontend/src/App.tsx; then
    echo "✓ Frontend uses environment variables for API URL"
else
    echo "✗ Frontend still has hardcoded URLs"
fi

# Check 4: WebSocket error handling
echo -e "\n4. Checking WebSocket error handling..."
if grep -q "try {" backend/server.js && grep -q "timestamp: new Date" backend/server.js; then
    echo "✓ WebSocket broadcast has error handling and timestamps"
else
    echo "✗ WebSocket broadcast missing error handling"
fi

# Check 5: Vite config
echo -e "\n5. Checking Vite config..."
if grep -q "process.env.PORT" frontend/vite.config.ts; then
    echo "✓ Vite config uses PORT environment variable"
else
    echo "✗ Vite config has hardcoded port"
fi

# Check 6: No duplicate index.js
echo -e "\n6. Checking for duplicate files..."
if [ ! -f backend/index.js ]; then
    echo "✓ No duplicate index.js file"
else
    echo "✗ Duplicate index.js still exists"
fi

# Check 7: .env.example exists
echo -e "\n7. Checking .env.example..."
if [ -f .env.example ]; then
    echo "✓ .env.example file exists"
else
    echo "✗ .env.example file missing"
fi

echo -e "\n================================"
echo "All checks complete!"