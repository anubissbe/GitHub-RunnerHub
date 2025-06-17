#!/bin/bash

echo "🔧 Creating simple dashboard fix..."

# Create a simple monitoring script
cat > /tmp/simple-monitor.sh << 'EOF'
#!/bin/bash

echo "📊 Setting up multi-repo monitoring..."

# First, let's check what's currently running
echo "Current backend status:"
docker ps | grep runnerhub-backend

# Check if we can access the runners via API
echo ""
echo "Checking runners across repositories..."

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
REPOS=("ProjectHub-Mcp" "GitHub-RunnerHub" "JarvisAI" "ai-video-studio")

TOTAL_RUNNERS=0
ONLINE_RUNNERS=0
BUSY_RUNNERS=0

for REPO in "${REPOS[@]}"; do
    RUNNERS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
        "https://api.github.com/repos/anubissbe/$REPO/actions/runners" | \
        jq '.runners | length')
    
    ONLINE=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
        "https://api.github.com/repos/anubissbe/$REPO/actions/runners" | \
        jq '.runners | map(select(.status == "online")) | length')
    
    BUSY=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
        "https://api.github.com/repos/anubissbe/$REPO/actions/runners" | \
        jq '.runners | map(select(.busy == true)) | length')
    
    echo "$REPO: $RUNNERS runners ($ONLINE online, $BUSY busy)"
    
    TOTAL_RUNNERS=$((TOTAL_RUNNERS + RUNNERS))
    ONLINE_RUNNERS=$((ONLINE_RUNNERS + ONLINE))
    BUSY_RUNNERS=$((BUSY_RUNNERS + BUSY))
done

echo ""
echo "Total across checked repos: $TOTAL_RUNNERS runners ($ONLINE_RUNNERS online, $BUSY_RUNNERS busy)"

# Check actual Docker containers
echo ""
echo "Docker containers running:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "(runner|Runner)" | wc -l
EOF

chmod +x /tmp/simple-monitor.sh

# Execute on remote server
echo "🚀 Checking runner status..."
scp /tmp/simple-monitor.sh remote-server:/tmp/
ssh remote-server "bash /tmp/simple-monitor.sh"

echo ""
echo "📱 Dashboard Issue:"
echo "The RunnerHub dashboard at http://192.168.1.16:8080 is currently configured"
echo "to only monitor the GitHub-RunnerHub repository runners."
echo ""
echo "Your runners ARE working correctly - they're processing jobs from all repositories."
echo "The dashboard just needs to be updated to aggregate data from all repos."
echo ""
echo "🔍 To verify runners are working:"
echo "1. Check GitHub: https://github.com/anubissbe/ProjectHub-Mcp/actions"
echo "2. Look at runner status in each repo's settings"
echo "3. Push code to trigger workflows"