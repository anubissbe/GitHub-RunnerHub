#!/bin/bash

echo "🚀 Continuing to update remaining repositories..."

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_USER="anubissbe"

# Remaining repositories to process
REMAINING_REPOS=(
    "claude-code-tools"
    "cline-documentation"
    "image-gen"
    "mcp-enhanced-workspace"
    "mcp-human-writing-style"
    "mcp-human-writing-style-reddit"
    "mcp-jarvis"
    "scripts"
    "threat-modeling-platform"
)

TOTAL_UPDATED=0

for REPO in "${REMAINING_REPOS[@]}"; do
    echo "═══════════════════════════════════════════════════════════"
    echo "📦 Processing repository: $REPO"
    echo "═══════════════════════════════════════════════════════════"
    
    # Check if .github/workflows exists
    WORKFLOWS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
      "https://api.github.com/repos/$GITHUB_USER/$REPO/contents/.github/workflows" 2>/dev/null | \
      jq -r 'if type == "array" then .[].name else empty end' 2>/dev/null)
    
    if [ -z "$WORKFLOWS" ]; then
        echo "  ⏭️  No workflows found in this repository"
        echo ""
        continue
    fi
    
    REPO_UPDATED=0
    echo "  Found workflows: $(echo "$WORKFLOWS" | wc -l)"
    
    for WORKFLOW in $WORKFLOWS; do
        echo "  📝 Checking $WORKFLOW..."
        
        # Get current file content and SHA
        FILE_DATA=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
          "https://api.github.com/repos/$GITHUB_USER/$REPO/contents/.github/workflows/$WORKFLOW")
        
        SHA=$(echo "$FILE_DATA" | jq -r '.sha')
        CONTENT=$(echo "$FILE_DATA" | jq -r '.content' | base64 -d)
        
        # Skip if already using self-hosted
        if echo "$CONTENT" | grep -q "runs-on:.*self-hosted.*runnerhub"; then
            echo "     ✅ Already using self-hosted runners"
            continue
        fi
        
        # Check if it uses GitHub-hosted runners
        if echo "$CONTENT" | grep -q "runs-on:.*ubuntu-\|runs-on: ubuntu-\|runs-on: \[ubuntu-\|runs-on: windows-\|runs-on: macos-"; then
            # Update runs-on to use self-hosted runners
            UPDATED_CONTENT=$(echo "$CONTENT" | \
              sed 's/runs-on: ubuntu-latest/runs-on: [self-hosted, runnerhub]/g' | \
              sed 's/runs-on: ubuntu-[0-9.]*/runs-on: [self-hosted, runnerhub]/g' | \
              sed 's/runs-on: \[ubuntu-latest\]/runs-on: [self-hosted, runnerhub]/g' | \
              sed 's/runs-on: \[ubuntu-[0-9.]*\]/runs-on: [self-hosted, runnerhub]/g' | \
              sed 's/runs-on: windows-latest/runs-on: [self-hosted, runnerhub]/g' | \
              sed 's/runs-on: macos-latest/runs-on: [self-hosted, runnerhub]/g')
            
            # Base64 encode the updated content
            ENCODED=$(echo "$UPDATED_CONTENT" | base64 -w 0)
            
            # Update the file
            UPDATE_RESULT=$(curl -s -X PUT \
              -H "Authorization: token $GITHUB_TOKEN" \
              -H "Accept: application/vnd.github.v3+json" \
              "https://api.github.com/repos/$GITHUB_USER/$REPO/contents/.github/workflows/$WORKFLOW" \
              -d "{
                \"message\": \"chore: Update $WORKFLOW to use self-hosted runners\",
                \"content\": \"$ENCODED\",
                \"sha\": \"$SHA\"
              }")
            
            if echo "$UPDATE_RESULT" | grep -q "\"commit\""; then
                echo "     ✅ Updated to use self-hosted runners"
                REPO_UPDATED=$((REPO_UPDATED + 1))
                TOTAL_UPDATED=$((TOTAL_UPDATED + 1))
            else
                echo "     ❌ Failed to update"
            fi
        else
            echo "     ⏭️  No GitHub-hosted runners found"
        fi
        
        sleep 0.5
    done
    
    if [ $REPO_UPDATED -gt 0 ]; then
        echo "  📊 Updated $REPO_UPDATED workflows in $REPO"
        
        # Cancel queued workflows
        QUEUED_RUNS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
          "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runs?status=queued" | \
          jq -r '.workflow_runs[].id')
        
        if [ -n "$QUEUED_RUNS" ]; then
            echo "  🚫 Cancelling queued workflows..."
            for RUN_ID in $QUEUED_RUNS; do
                curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
                  "https://api.github.com/repos/$GITHUB_USER/$REPO/actions/runs/$RUN_ID/cancel" > /dev/null
                echo "     Cancelled run #$RUN_ID"
            done
        fi
    fi
    
    echo ""
done

echo "✅ Updated $TOTAL_UPDATED workflows in remaining repositories"