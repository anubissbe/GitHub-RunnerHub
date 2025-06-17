#!/bin/bash

echo "🔧 Updating all workflows to use self-hosted runners..."

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_USER="anubissbe"
REPO="ProjectHub-Mcp"

# Get all workflow files
WORKFLOWS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$GITHUB_USER/$REPO/contents/.github/workflows" | \
  jq -r '.[].name')

echo "Found workflows:"
echo "$WORKFLOWS"
echo ""

for WORKFLOW in $WORKFLOWS; do
    echo "📝 Updating $WORKFLOW..."
    
    # Get current file content and SHA
    FILE_DATA=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
      "https://api.github.com/repos/$GITHUB_USER/$REPO/contents/.github/workflows/$WORKFLOW")
    
    SHA=$(echo "$FILE_DATA" | jq -r '.sha')
    CONTENT=$(echo "$FILE_DATA" | jq -r '.content' | base64 -d)
    
    # Skip if already using self-hosted
    if echo "$CONTENT" | grep -q "runs-on:.*self-hosted.*runnerhub"; then
        echo "  ✅ Already using self-hosted runners"
        continue
    fi
    
    # Update runs-on to use self-hosted runners
    UPDATED_CONTENT=$(echo "$CONTENT" | \
      sed 's/runs-on: ubuntu-latest/runs-on: [self-hosted, runnerhub]/g' | \
      sed 's/runs-on: ubuntu-[0-9.]*/runs-on: [self-hosted, runnerhub]/g' | \
      sed 's/runs-on: \[ubuntu-latest\]/runs-on: [self-hosted, runnerhub]/g')
    
    # Only update if content changed
    if [ "$CONTENT" != "$UPDATED_CONTENT" ]; then
        # Base64 encode the updated content
        ENCODED=$(echo "$UPDATED_CONTENT" | base64 -w 0)
        
        # Update the file
        curl -s -X PUT \
          -H "Authorization: token $GITHUB_TOKEN" \
          -H "Accept: application/vnd.github.v3+json" \
          "https://api.github.com/repos/$GITHUB_USER/$REPO/contents/.github/workflows/$WORKFLOW" \
          -d "{
            \"message\": \"Update $WORKFLOW to use self-hosted runners\",
            \"content\": \"$ENCODED\",
            \"sha\": \"$SHA\"
          }" > /dev/null
        
        echo "  ✅ Updated to use self-hosted runners"
    else
        echo "  ⏭️  No changes needed"
    fi
    
    sleep 1
done

echo ""
echo "✅ All workflows updated!"
echo ""
echo "📊 Updated workflows will now use your self-hosted runners"
echo "🚀 The queued build should start processing soon"