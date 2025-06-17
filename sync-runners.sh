#\!/bin/bash

echo "🔄 Syncing GitHub runners with Docker containers..."

cat > /tmp/sync-runners.sh << 'SCRIPT'
#\!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"

echo "📋 Getting runners from Docker and GitHub..."

# Get Docker runners
DOCKER_RUNNERS=$(docker ps --format "{{.Names}}"  < /dev/null |  grep "^runnerhub-" | grep -v "backend\|frontend" | sort)

# Get GitHub runners
GITHUB_RUNNERS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners" | \
    python3 -c "
import sys, json
data = json.load(sys.stdin)
for runner in data['runners']:
    if runner['name'].startswith('runnerhub'):
        print(f\"{runner['id']}:{runner['name']}:{runner['status']}\")
")

echo ""
echo "🧹 Removing runners not in Docker..."

# Remove runners that don't exist in Docker
echo "$GITHUB_RUNNERS" | while IFS=: read -r id name status; do
    if \! echo "$DOCKER_RUNNERS" | grep -q "^$name$"; then
        echo "   - Removing $name (status: $status) - not in Docker"
        curl -s -X DELETE \
            -H "Authorization: token $GITHUB_TOKEN" \
            -H "Accept: application/vnd.github.v3+json" \
            "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners/$id"
    fi
done

sleep 2

echo ""
echo "📊 Final status:"
echo ""

# Show final status
FINAL_COUNT=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners" | \
    python3 -c "
import sys, json
data = json.load(sys.stdin)
runners = [r for r in data['runners'] if r['name'].startswith('runnerhub')]
online = sum(1 for r in runners if r['status'] == 'online')
offline = sum(1 for r in runners if r['status'] == 'offline')
busy = sum(1 for r in runners if r['busy'])
print(f'GitHub Runners: {len(runners)}')
print(f'  ✅ Online: {online}')
print(f'  ❌ Offline: {offline}')
print(f'  🏃 Busy: {busy}')
")

echo "$FINAL_COUNT"
echo ""
echo "Docker Runners: $(docker ps --format "{{.Names}}" | grep "^runnerhub-" | grep -v "backend\|frontend" | wc -l)"

echo ""
echo "✅ Sync complete - GitHub now matches Docker\!"
SCRIPT

scp -i ~/.ssh/git-runner_rsa /tmp/sync-runners.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "chmod +x /tmp/sync-runners.sh && bash /tmp/sync-runners.sh"
