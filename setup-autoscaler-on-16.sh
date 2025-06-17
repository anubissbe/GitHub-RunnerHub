#!/bin/bash

echo "🚀 Setting up Auto-Scaler on 192.168.1.16..."

cat > /tmp/autoscaler.sh << 'AUTOSCALER'
#!/bin/bash

echo "📦 Installing Auto-Scaler on 192.168.1.16..."

cd /opt/GitHub-RunnerHub || mkdir -p /opt/GitHub-RunnerHub && cd /opt/GitHub-RunnerHub

# Create auto-scaler script
cat > autoscaler.sh << 'SCRIPT'
#!/bin/bash

GITHUB_TOKEN="YOUR_GITHUB_TOKEN_HERE"
GITHUB_ORG="anubissbe"
REPO="ProjectHub-Mcp"
MIN_FREE_RUNNERS=5
SCALE_INCREMENT=5
SCALE_THRESHOLD=0.8

echo "🤖 GitHub RunnerHub Auto-Scaler Started"
echo "   Min Free: $MIN_FREE_RUNNERS"
echo "   Scale at: ${SCALE_THRESHOLD}0% utilization"
echo "   Increment: $SCALE_INCREMENT runners"
echo ""

while true; do
    # Get runner metrics
    RUNNERS_JSON=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
        "https://api.github.com/repos/$GITHUB_ORG/$REPO/actions/runners")
    
    TOTAL=$(echo "$RUNNERS_JSON" | jq '.runners | length')
    ONLINE=$(echo "$RUNNERS_JSON" | jq '.runners | map(select(.status == "online")) | length')
    BUSY=$(echo "$RUNNERS_JSON" | jq '.runners | map(select(.busy == true)) | length')
    FREE=$((ONLINE - BUSY))
    
    echo "[$(date '+%H:%M:%S')] Runners: Total=$TOTAL, Online=$ONLINE, Busy=$BUSY, Free=$FREE"
    
    # Check if we need to scale
    if [ $FREE -lt $MIN_FREE_RUNNERS ]; then
        NEEDED=$((MIN_FREE_RUNNERS - FREE))
        echo "📈 Scaling UP: Need $NEEDED more free runners"
        
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
        
        # Update dashboard
        echo "🔄 Dashboard will update automatically to show new runners"
    fi
    
    # Check utilization
    if [ $ONLINE -gt 0 ]; then
        UTIL=$(echo "scale=2; $BUSY / $ONLINE" | bc)
        if (( $(echo "$UTIL > $SCALE_THRESHOLD" | bc -l) )); then
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
        fi
    fi
    
    sleep 30
done
SCRIPT

chmod +x autoscaler.sh

# Install dependencies
sudo apt-get update
sudo apt-get install -y jq bc

# Start auto-scaler in background
nohup ./autoscaler.sh > autoscaler.log 2>&1 &
echo $! > autoscaler.pid

echo ""
echo "✅ Auto-Scaler installed and running!"
echo "   PID: $(cat autoscaler.pid)"
echo "   Log: /opt/GitHub-RunnerHub/autoscaler.log"
echo ""
echo "📊 The dashboard at http://192.168.1.16:8080 will show:"
echo "   - Current runners (updates every 30 seconds)"
echo "   - New runners as they spawn"
echo "   - Runner status (idle/busy)"
echo ""
echo "🎯 Auto-scaling rules:"
echo "   - Always maintains 5 free runners"
echo "   - Spawns more when < 5 are free"
echo "   - Spawns 5 more when 80% are busy"
echo ""
echo "To watch auto-scaler in action:"
echo "   tail -f /opt/GitHub-RunnerHub/autoscaler.log"
AUTOSCALER

# Deploy to 192.168.1.16
scp -i ~/.ssh/git-runner_rsa /tmp/autoscaler.sh drwho@192.168.1.16:/tmp/
ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 "bash /tmp/autoscaler.sh"