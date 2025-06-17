#\!/bin/bash

echo "🧹 Cleaning up offline runners from GitHub..."

cat > /tmp/cleanup-runners.sh << 'SCRIPT'
#\!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"

echo "📋 Getting list of offline runners..."

# Get all offline runners
OFFLINE_RUNNERS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners"  < /dev/null |  \
    python3 -c "
import sys, json
data = json.load(sys.stdin)
for runner in data['runners']:
    if runner['status'] == 'offline' and runner['name'].startswith('runnerhub'):
        print(f\"{runner['id']}:{runner['name']}\")
")

if [ -z "$OFFLINE_RUNNERS" ]; then
    echo "✅ No offline runners to clean up"
else
    echo "🗑️  Found offline runners to remove:"
    echo "$OFFLINE_RUNNERS" | while IFS=: read -r id name; do
        echo "   - $name (ID: $id)"
        
        # Remove the runner from GitHub
        curl -s -X DELETE \
            -H "Authorization: token $GITHUB_TOKEN" \
            -H "Accept: application/vnd.github.v3+json" \
            "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners/$id"
        
        echo "     ✅ Removed from GitHub"
    done
fi

echo ""
echo "📊 Current runner status:"
echo ""

# Show current status
curl -s -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners" | \
    python3 -c "
import sys, json
data = json.load(sys.stdin)
online = sum(1 for r in data['runners'] if r['status'] == 'online' and r['name'].startswith('runnerhub'))
offline = sum(1 for r in data['runners'] if r['status'] == 'offline' and r['name'].startswith('runnerhub'))
busy = sum(1 for r in data['runners'] if r['busy'] and r['name'].startswith('runnerhub'))
print(f'Total RunnerHub runners: {online + offline}')
print(f'  ✅ Online: {online}')
print(f'  ❌ Offline: {offline}')
print(f'  🏃 Busy: {busy}')
"

echo ""
echo "🐳 Docker containers running:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep runnerhub- | grep -v "backend\|frontend" | wc -l

echo ""
echo "✅ Cleanup complete\!"
SCRIPT

# Deploy and execute
scp -i ~/.ssh/git-runner_rsa /tmp/cleanup-runners.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/cleanup-runners.sh && bash /tmp/cleanup-runners.sh"
