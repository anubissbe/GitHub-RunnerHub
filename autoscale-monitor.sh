#!/bin/bash

echo "🚀 GitHub RunnerHub Auto-Scaling Monitor"

# Create monitoring script on remote server
cat > /tmp/autoscale-monitor.sh << 'EOF'
#!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"
MIN_FREE_RUNNERS=5
SCALE_INCREMENT=5
SCALE_THRESHOLD=0.8

# Auto-scaling loop
while true; do
    # Get current runner status
    RUNNERS_JSON=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
        "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners")
    
    TOTAL_RUNNERS=$(echo "$RUNNERS_JSON" | jq '.runners | length')
    ONLINE_RUNNERS=$(echo "$RUNNERS_JSON" | jq '.runners | map(select(.status == "online")) | length')
    BUSY_RUNNERS=$(echo "$RUNNERS_JSON" | jq '.runners | map(select(.busy == true)) | length')
    FREE_RUNNERS=$((ONLINE_RUNNERS - BUSY_RUNNERS))
    
    if [ $ONLINE_RUNNERS -gt 0 ]; then
        UTILIZATION=$(echo "scale=2; $BUSY_RUNNERS / $ONLINE_RUNNERS" | bc)
    else
        UTILIZATION=0
    fi
    
    # Display status
    clear
    echo "🏃 GitHub RunnerHub Auto-Scaling Monitor - $(date)"
    echo "══════════════════════════════════════════════════════════"
    echo ""
    echo "📊 Runner Status:"
    echo "   Total Runners: $TOTAL_RUNNERS"
    echo "   Online: $ONLINE_RUNNERS"
    echo "   Busy: $BUSY_RUNNERS"
    echo "   Free: $FREE_RUNNERS"
    echo "   Utilization: $(echo "$UTILIZATION * 100" | bc | cut -d. -f1)%"
    echo ""
    
    # Auto-scaling logic
    if [ $FREE_RUNNERS -lt $MIN_FREE_RUNNERS ]; then
        NEEDED=$((MIN_FREE_RUNNERS - FREE_RUNNERS))
        echo "📈 Scaling UP: Need $NEEDED more runners (maintaining $MIN_FREE_RUNNERS free)"
        
        for i in $(seq 1 $NEEDED); do
            RUNNER_ID=$(openssl rand -hex 3)
            RUNNER_NAME="runnerhub-auto-${RUNNER_ID}"
            
            TOKEN=$(curl -s -X POST \
                -H "Authorization: token $GITHUB_TOKEN" \
                -H "Accept: application/vnd.github.v3+json" \
                "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners/registration-token" | \
                jq -r '.token')
            
            if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
                docker run -d \
                    --name "$RUNNER_NAME" \
                    --restart unless-stopped \
                    -e RUNNER_TOKEN="$TOKEN" \
                    -e RUNNER_NAME="$RUNNER_NAME" \
                    -e RUNNER_WORKDIR="/tmp/runner/work" \
                    -e LABELS="self-hosted,Linux,X64,docker,runnerhub,auto-scaled" \
                    -e REPO_URL="https://github.com/$GITHUB_ORG/$REPO" \
                    -v /var/run/docker.sock:/var/run/docker.sock \
                    myoung34/github-runner:latest > /dev/null 2>&1
                
                echo "   ✅ Spawned: $RUNNER_NAME"
            fi
            sleep 2
        done
    elif [ $(echo "$UTILIZATION > $SCALE_THRESHOLD" | bc) -eq 1 ]; then
        echo "📈 High utilization detected! Spawning $SCALE_INCREMENT more runners..."
        
        for i in $(seq 1 $SCALE_INCREMENT); do
            RUNNER_ID=$(openssl rand -hex 3)
            RUNNER_NAME="runnerhub-auto-${RUNNER_ID}"
            
            TOKEN=$(curl -s -X POST \
                -H "Authorization: token $GITHUB_TOKEN" \
                -H "Accept: application/vnd.github.v3+json" \
                "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners/registration-token" | \
                jq -r '.token')
            
            if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
                docker run -d \
                    --name "$RUNNER_NAME" \
                    --restart unless-stopped \
                    -e RUNNER_TOKEN="$TOKEN" \
                    -e RUNNER_NAME="$RUNNER_NAME" \
                    -e RUNNER_WORKDIR="/tmp/runner/work" \
                    -e LABELS="self-hosted,Linux,X64,docker,runnerhub,auto-scaled" \
                    -e REPO_URL="https://github.com/$GITHUB_ORG/$REPO" \
                    -v /var/run/docker.sock:/var/run/docker.sock \
                    myoung34/github-runner:latest > /dev/null 2>&1
                
                echo "   ✅ Spawned: $RUNNER_NAME"
            fi
            sleep 2
        done
    else
        echo "✅ System balanced - no scaling needed"
    fi
    
    echo ""
    echo "🏃 Active Runners:"
    echo "$RUNNERS_JSON" | jq -r '.runners[] | select(.name | startswith("runnerhub-auto")) | "   \(.name) - \(.status) \(if .busy then "(busy)" else "(free)" end)"' | head -10
    
    # Wait 30 seconds before next check
    sleep 30
done
EOF

chmod +x /tmp/autoscale-monitor.sh

# Deploy and run on server
scp /tmp/autoscale-monitor.sh remote-server:/opt/runnerhub/autoscale-monitor.sh
ssh remote-server "chmod +x /opt/runnerhub/autoscale-monitor.sh"

echo "✅ Auto-scaling monitor deployed!"
echo ""
echo "To run the monitor:"
echo "  ssh remote-server"
echo "  /opt/runnerhub/autoscale-monitor.sh"
echo ""
echo "Or run in background:"
echo "  ssh remote-server 'nohup /opt/runnerhub/autoscale-monitor.sh > /opt/runnerhub/autoscale.log 2>&1 &'"