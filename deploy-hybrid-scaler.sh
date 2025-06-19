#!/bin/bash

echo "🚀 Deploying Hybrid Scaler Solution..."
echo ""
echo "This will enable:"
echo "  • Repository-specific runners (1 per repository)"
echo "  • Dynamic auto-scaling pool (2-8 additional runners)"
echo "  • Intelligent load distribution"
echo "  • Real-time dashboard metrics"
echo ""

# Deploy the hybrid scaler
echo "📦 Deploying Hybrid Scaler backend..."
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/backend/hybrid-scaler.js drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/backend/
scp -i ~/.ssh/git-runner_rsa /opt/projects/projects/GitHub-RunnerHub/backend/server.js drwho@192.168.1.16:/home/drwho/GitHub-RunnerHub/backend/

ssh -i ~/.ssh/git-runner_rsa drwho@192.168.1.16 << 'EOF'
cd /home/drwho/GitHub-RunnerHub

echo "🔧 Setting required environment variables..."
# Ensure GITHUB_ORG is set
if ! grep -q "GITHUB_ORG=" .env 2>/dev/null; then
    echo "GITHUB_ORG=anubissbe" >> .env
fi

echo "🔄 Restarting backend with Hybrid Scaler..."
docker-compose restart backend

echo "⏳ Waiting for Hybrid Scaler to initialize..."
sleep 20

echo ""
echo "🔍 Testing Hybrid Scaler functionality:"

# Test scaler status
echo "1. Scaler Status:"
curl -s http://localhost:8300/health | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(f'   Hybrid Scaler: {\"✅ Enabled\" if data.get(\"hybridScaler\") else \"❌ Disabled\"}')
    print(f'   Total Runners: {data.get(\"runners\", 0)}')
    if 'scalerStatus' in data and data['scalerStatus']:
        status = data['scalerStatus']
        print(f'   Repository Runners: {len(status.get(\"repositoryRunners\", []))}')
        print(f'   Dynamic Runners: {len(status.get(\"dynamicRunners\", []))}')
        print(f'   Scaler Running: {\"✅ Yes\" if status.get(\"isRunning\") else \"❌ No\"}')
except Exception as e:
    print(f'   ❌ Error: {e}')
"

echo ""
echo "2. Enhanced Public API:"
curl -s http://localhost:8300/api/public/runners | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(f'   Found {len(data)} runners:')
    repo_runners = [r for r in data if r.get('runnerType') == 'repository']
    dynamic_runners = [r for r in data if r.get('runnerType') == 'dynamic']
    print(f'     Repository: {len(repo_runners)}')
    print(f'     Dynamic: {len(dynamic_runners)}')
    for r in data[:5]:  # Show first 5
        print(f'     • {r.get(\"displayName\", \"Unknown\")} ({r.get(\"status\", \"Unknown\")})')
except Exception as e:
    print(f'   ❌ Error: {e}')
"

echo ""
echo "3. Scaler Metrics API:"
curl -s http://localhost:8300/api/public/scaler-metrics | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if data.get('enabled'):
        metrics = data.get('metrics', {})
        runners = data.get('runners', {})
        print(f'   ✅ Scaler Metrics Available')
        print(f'   Total: {runners.get(\"total\", 0)} runners')
        print(f'   Repository: {runners.get(\"repository\", 0)} | Dynamic: {runners.get(\"dynamic\", 0)}')
        print(f'   Online: {runners.get(\"online\", 0)} | Busy: {runners.get(\"busy\", 0)}')
    else:
        print(f'   ❌ {data.get(\"message\", \"Unknown error\")}')
except Exception as e:
    print(f'   ❌ Error: {e}')
"

echo ""
echo "✅ Hybrid Scaler deployment complete!"
EOF

echo ""
echo "🎉 Hybrid Scaler Solution Deployed!"
echo ""
echo "Key Features Now Available:"
echo "  ✅ Repository-specific runners (always 1 per repo)"
echo "  ✅ Dynamic auto-scaling pool (scales 2-8 based on load)"
echo "  ✅ Enhanced dashboard metrics"
echo "  ✅ Real-time WebSocket updates"
echo "  ✅ Intelligent load distribution"
echo ""
echo "Dashboard URLs:"
echo "  • Main Dashboard: http://192.168.1.16:8080/"
echo "  • Scaler Metrics: http://192.168.1.16:8300/api/public/scaler-metrics"
echo "  • Runner Status: http://192.168.1.16:8300/api/public/runners"
echo ""
echo "Auto-scaling will:"
echo "  • Scale UP when >70% of runners are busy"
echo "  • Scale DOWN when <30% of runners are busy"
echo "  • Maintain 2-8 dynamic runners + 5 repository runners"
echo "  • Cool-down period: 5 minutes between scaling actions"
echo ""
echo "Please refresh your browser (Ctrl+F5) to see the updated dashboard!"