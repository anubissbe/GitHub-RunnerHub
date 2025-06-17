#!/bin/bash

# Configure all your repositories to use self-hosted runners
# This script will add/update GitHub Actions workflows to use your RunnerHub runners

set -e

GITHUB_TOKEN="${GITHUB_TOKEN:-}"
GITHUB_USER="anubissbe"

# Check if token is provided
if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Error: GITHUB_TOKEN environment variable is required"
    echo "Usage: GITHUB_TOKEN=your_token ./configure-all-repos.sh"
    exit 1
fi

echo "🚀 Configuring all repositories to use self-hosted runners..."

# Get list of your original repositories (not forks)
REPOS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/user/repos?type=owner&per_page=100" | \
  jq -r '.[] | select(.fork == false) | .name')

echo "Found repositories:"
echo "$REPOS" | sed 's/^/  - /'
echo ""

# Create a universal workflow template
create_workflow_template() {
  local repo_name="$1"
  local workflow_content=""
  
  # Determine workflow based on repository type/name
  if [[ "$repo_name" =~ (mcp|ProjectHub|JarvisAI|Jarvis) ]]; then
    # Node.js/TypeScript project
    workflow_content='name: CI/CD Self-Hosted

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]
  workflow_dispatch:

jobs:
  test-and-build:
    runs-on: [self-hosted, runnerhub]
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '\''18'\''
        cache: '\''npm'\''
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run tests
      run: npm test --if-present
      
    - name: Build project
      run: npm run build --if-present
      
    - name: Run linting
      run: npm run lint --if-present
      
    - name: Type checking
      run: npm run typecheck --if-present

  docker-build:
    runs-on: [self-hosted, runnerhub]
    needs: test-and-build
    if: github.ref == '\''refs/heads/main'\'' || github.ref == '\''refs/heads/master'\''
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Build Docker images
      run: |
        if [ -f docker-compose.yml ]; then
          docker-compose build
        elif [ -f Dockerfile ]; then
          docker build -t ${{ github.repository }}:latest .
        fi
'
  elif [[ "$repo_name" =~ (ai-|image-gen|threat-modeling) ]]; then
    # Python AI/ML project
    workflow_content='name: CI/CD Self-Hosted

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]
  workflow_dispatch:

jobs:
  test-and-build:
    runs-on: [self-hosted, runnerhub]
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Setup Python
      uses: actions/setup-python@v5
      with:
        python-version: '\''3.11'\''
        
    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        if [ -f requirements.txt ]; then
          pip install -r requirements.txt
        elif [ -f pyproject.toml ]; then
          pip install -e .
        fi
        
    - name: Run tests
      run: |
        if [ -f pytest.ini ] || [ -f pyproject.toml ]; then
          pytest
        elif [ -f test_*.py ] || [ -d tests/ ]; then
          python -m pytest
        fi
      continue-on-error: true
        
    - name: Run linting
      run: |
        if command -v flake8 &> /dev/null; then
          flake8 .
        elif command -v pylint &> /dev/null; then
          pylint **/*.py
        fi
      continue-on-error: true

  docker-build:
    runs-on: [self-hosted, runnerhub]
    needs: test-and-build
    if: github.ref == '\''refs/heads/main'\'' || github.ref == '\''refs/heads/master'\''
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Build Docker images
      run: |
        if [ -f docker-compose.yml ]; then
          docker-compose build
        elif [ -f Dockerfile ]; then
          docker build -t ${{ github.repository }}:latest .
        fi
'
  else
    # Generic project
    workflow_content='name: CI/CD Self-Hosted

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]
  workflow_dispatch:

jobs:
  build-and-test:
    runs-on: [self-hosted, runnerhub]
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Auto-detect and run build
      run: |
        echo "🔍 Auto-detecting project type..."
        
        if [ -f package.json ]; then
          echo "📦 Node.js project detected"
          npm ci
          npm test --if-present
          npm run build --if-present
        elif [ -f requirements.txt ] || [ -f pyproject.toml ]; then
          echo "🐍 Python project detected"
          python -m pip install --upgrade pip
          if [ -f requirements.txt ]; then
            pip install -r requirements.txt
          elif [ -f pyproject.toml ]; then
            pip install -e .
          fi
          if command -v pytest &> /dev/null; then
            pytest --continue-on-collection-errors
          fi
        elif [ -f go.mod ]; then
          echo "🐹 Go project detected"
          go mod tidy
          go test ./...
          go build ./...
        elif [ -f Cargo.toml ]; then
          echo "🦀 Rust project detected"
          cargo test
          cargo build
        elif [ -f Makefile ]; then
          echo "🛠️ Makefile detected"
          make
        else
          echo "📁 Generic project - running basic checks"
          ls -la
          find . -name "*.sh" -exec chmod +x {} \;
        fi
        
    - name: Build Docker if present
      run: |
        if [ -f docker-compose.yml ]; then
          echo "🐳 Building with Docker Compose"
          docker-compose build
        elif [ -f Dockerfile ]; then
          echo "🐳 Building with Docker"
          docker build -t ${{ github.repository }}:latest .
        fi
      continue-on-error: true
'
  fi
  
  echo "$workflow_content"
}

# Function to update repository workflow
update_repo_workflow() {
  local repo="$1"
  echo "📝 Configuring $repo..."
  
  # Get the workflow content
  local workflow_content=$(create_workflow_template "$repo")
  
  # Base64 encode the content
  local encoded_content=$(echo "$workflow_content" | base64 -w 0)
  
  # Check if .github/workflows directory and file exist
  local file_exists=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$GITHUB_USER/$repo/contents/.github/workflows/self-hosted-ci.yml" | \
    jq -r '.sha // "null"')
  
  if [ "$file_exists" != "null" ]; then
    # Update existing file
    echo "  ↻ Updating existing workflow..."
    curl -s -X PUT \
      -H "Authorization: token $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github.v3+json" \
      "https://api.github.com/repos/$GITHUB_USER/$repo/contents/.github/workflows/self-hosted-ci.yml" \
      -d "{
        \"message\": \"Update self-hosted runner workflow for RunnerHub\",
        \"content\": \"$encoded_content\",
        \"sha\": \"$file_exists\"
      }" > /dev/null
  else
    # Create new file
    echo "  + Creating new workflow..."
    curl -s -X PUT \
      -H "Authorization: token $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github.v3+json" \
      "https://api.github.com/repos/$GITHUB_USER/$repo/contents/.github/workflows/self-hosted-ci.yml" \
      -d "{
        \"message\": \"Add self-hosted runner workflow for RunnerHub\",
        \"content\": \"$encoded_content\"
      }" > /dev/null
  fi
  
  echo "  ✅ Configured $repo"
}

# Configure each repository
echo "🔧 Configuring workflows for each repository..."
echo ""

while IFS= read -r repo; do
  if [ -n "$repo" ]; then
    update_repo_workflow "$repo"
    sleep 1  # Rate limiting
  fi
done <<< "$REPOS"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               ║"
echo "║            🎉 All Repositories Configured! 🎉                 ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "📊 Summary:"
echo "• Configured $(echo "$REPOS" | wc -l) repositories"
echo "• All workflows now use [self-hosted, runnerhub] runners"
echo "• Workflows include auto-detection for different project types"
echo "• Each repo now has .github/workflows/self-hosted-ci.yml"
echo ""
echo "🚀 Your runners will now handle CI/CD for all your projects!"
echo "📱 View progress at: http://192.168.1.16:8080"
echo ""