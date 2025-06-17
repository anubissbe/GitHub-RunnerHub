#\!/bin/bash

echo "🧹 Final cleanup - removing all non-Docker runners..."

# Get list of runners actually in Docker
DOCKER_RUNNERS=$(ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 'docker ps --format "{{.Names}}"  < /dev/null |  grep "^runnerhub-" | grep -v "backend\|frontend"')

echo "✅ Active Docker runners:"
echo "$DOCKER_RUNNERS"
echo ""

# Remove ALL GitHub runners that are not in the Docker list
echo "🗑️  Removing GitHub runners not in Docker..."
gh api repos/anubissbe/ProjectHub-Mcp/actions/runners --paginate | jq -r '.runners[] | select(.name | startswith("runnerhub")) | "\(.id):\(.name)"' | while IFS=: read -r id name; do
    if \! echo "$DOCKER_RUNNERS" | grep -q "^${name}$"; then
        echo "   - Removing $name (ID: $id)"
        gh api -X DELETE "repos/anubissbe/ProjectHub-Mcp/actions/runners/$id" 2>/dev/null || true
    fi
done

echo ""
echo "✅ Cleanup complete\!"
