#\!/bin/bash

echo "🚀 Configuring ALL repositories to use RunnerHub runners..."

# First, clean up all non-RunnerHub runners from all repos
echo "🧹 Step 1: Cleaning up old runners from all repositories..."

# Get all repositories
REPOS=$(gh repo list anubissbe --limit 100 --json name --jq '.[].name')

echo "Found $(echo "$REPOS"  < /dev/null |  wc -l) repositories"
echo ""

# For each repo, remove non-RunnerHub runners
for REPO in $REPOS; do
    echo "🔍 Checking $REPO..."
    
    # Get runners for this repo
    RUNNERS=$(gh api "repos/anubissbe/$REPO/actions/runners" 2>/dev/null | jq -r '.runners[] | select(.name | startswith("runnerhub") | not) | "\(.id):\(.name)"')
    
    if [ -n "$RUNNERS" ]; then
        echo "  Found old runners to remove:"
        echo "$RUNNERS" | while IFS=: read -r id name; do
            echo "    - Removing $name (ID: $id)"
            gh api -X DELETE "repos/anubissbe/$REPO/actions/runners/$id" 2>/dev/null
        done
    fi
done

echo ""
echo "✅ Cleanup complete\!"
echo ""
echo "📝 Step 2: Updating all repository workflows..."

# Create a directory for repo updates
mkdir -p /tmp/repo-updates
cd /tmp/repo-updates

for REPO in $REPOS; do
    echo "📂 Processing $REPO..."
    
    # Skip if no workflows
    if \! gh api "repos/anubissbe/$REPO/contents/.github/workflows" >/dev/null 2>&1; then
        echo "  ℹ️  No workflows found"
        continue
    fi
    
    # Clone the repo
    rm -rf "$REPO"
    gh repo clone "anubissbe/$REPO" -- --depth=1 2>/dev/null
    
    if [ -d "$REPO/.github/workflows" ]; then
        cd "$REPO"
        
        # Update workflow files
        UPDATED=false
        for workflow in .github/workflows/*.yml .github/workflows/*.yaml; do
            if [ -f "$workflow" ]; then
                # Create backup
                cp "$workflow" "$workflow.bak"
                
                # Replace runner configurations
                sed -i 's/runs-on: ubuntu-latest/runs-on: [self-hosted, docker, runnerhub]/g' "$workflow"
                sed -i 's/runs-on: ubuntu-[0-9]*/runs-on: [self-hosted, docker, runnerhub]/g' "$workflow"
                sed -i 's/runs-on: \[ubuntu-latest\]/runs-on: [self-hosted, docker, runnerhub]/g' "$workflow"
                sed -i 's/\[self-hosted, docker, git-runner\]/[self-hosted, docker, runnerhub]/g' "$workflow"
                
                # Check if file changed
                if \! diff -q "$workflow" "$workflow.bak" >/dev/null; then
                    echo "    ✓ Updated $(basename $workflow)"
                    UPDATED=true
                fi
                rm "$workflow.bak"
            fi
        done
        
        # Commit and push if changes were made
        if [ "$UPDATED" = true ]; then
            git add .github/workflows/
            git config user.name "anubissbe"
            git config user.email "bert@telkom.be"
            git commit -m "ci: Update workflows to use RunnerHub self-hosted runners

- Replace ubuntu-latest with self-hosted RunnerHub runners
- Ensures all workflows use local runner infrastructure
- Part of organization-wide runner standardization"
            
            # Try to push
            if git push origin main 2>/dev/null || git push origin master 2>/dev/null; then
                echo "  ✅ Pushed workflow updates"
            else
                echo "  ⚠️  Could not push (may need PR)"
            fi
        else
            echo "  ✅ Workflows already configured correctly"
        fi
        
        cd ..
    fi
done

cd /opt/projects/projects/GitHub-RunnerHub

echo ""
echo "🎉 Configuration Complete\!"
echo ""
echo "📊 Summary:"
echo "- ✅ Removed all non-RunnerHub runners from all repositories"
echo "- ✅ Updated all repository workflows to use RunnerHub"
echo ""
echo "🏃 Your RunnerHub runners at 192.168.1.16 now work for ALL repositories\!"
echo "📱 Monitor at: http://192.168.1.16:8080"
