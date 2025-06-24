#!/bin/bash

# Clean build directories before running tests to avoid Haste module naming collision
echo "🧹 Cleaning build directories..."

# Remove dist directory if it exists
if [ -d "dist" ]; then
    echo "Removing dist directory..."
    rm -rf dist
fi

# Remove build directory if it exists
if [ -d "build" ]; then
    echo "Removing build directory..."
    rm -rf build
fi

# Clear Jest cache
echo "Clearing Jest cache..."
npx jest --clearCache

echo "✅ Clean complete!"