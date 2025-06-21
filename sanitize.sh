#\!/bin/bash

echo "🧹 Sanitizing GitHub-RunnerHub for public release..."

# Files to exclude from sanitization (node_modules, etc.)
EXCLUDE_PATTERNS="./node_modules/ ./load-testing/node_modules/ ./.git/"

# Create list of files to sanitize
FILES_TO_SANITIZE=$(find . -type f \( -name "*.js" -o -name "*.md" -o -name "*.json" \)  < /dev/null |  grep -v -E "(node_modules|\.git)")

echo "📝 Sanitizing files..."

for file in $FILES_TO_SANITIZE; do
    if [[ -f "$file" ]]; then
        # Replace sensitive data
        sed -i.bak 's/192\.168\.1\.24/YOUR_DOCKER_HOST/g' "$file"
        sed -i.bak 's/192\.168\.1\.25/YOUR_RUNNER_HOST/g' "$file"
        sed -i.bak 's/anubissbe/YOUR_GITHUB_USERNAME/g' "$file"
        sed -i.bak 's/bert@telkom\.be/your-email@domain.com/g' "$file"
        sed -i.bak 's/ghp_[A-Za-z0-9_]*/YOUR_GITHUB_TOKEN/g' "$file"
        sed -i.bak 's/hvs\.[A-Za-z0-9_]*/YOUR_VAULT_TOKEN/g' "$file"
        
        # Clean up backup files
        rm -f "$file.bak"
    fi
done

echo "✅ Sanitization complete\!"
echo "🔍 Verifying no sensitive data remains..."

# Check for remaining sensitive patterns
SENSITIVE_FOUND=0

if grep -r "192\.168\.1\." --include="*.js" --include="*.md" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git . > /dev/null 2>&1; then
    echo "⚠️  Found remaining IP addresses"
    SENSITIVE_FOUND=1
fi

if grep -r "anubissbe" --include="*.js" --include="*.md" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git . > /dev/null 2>&1; then
    echo "⚠️  Found remaining username references"
    SENSITIVE_FOUND=1
fi

if grep -r "bert@telkom\.be" --include="*.js" --include="*.md" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git . > /dev/null 2>&1; then
    echo "⚠️  Found remaining email addresses"
    SENSITIVE_FOUND=1
fi

if [[ $SENSITIVE_FOUND -eq 0 ]]; then
    echo "✅ No sensitive data detected - ready for GitHub\!"
else
    echo "❌ Some sensitive data may remain - please review"
fi
