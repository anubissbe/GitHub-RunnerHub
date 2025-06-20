# Network Isolation Testing Summary

## Overview

This document provides a comprehensive testing guide for the network isolation feature implemented in GitHub-RunnerHub. The feature ensures that containers from different repositories cannot communicate with each other, providing complete security isolation.

## Testing Checklist

### 1. Build Verification ✅
```bash
npm run build
```
- **Status**: PASSED
- **Details**: TypeScript compilation successful with no errors

### 2. Database Migration
```bash
# Run the network isolation migration
./scripts/run-migrations.sh

# Verify tables created
psql $DATABASE_URL -c "\dt network_isolation*"
psql $DATABASE_URL -c "\dt container_network_associations"
```

### 3. Unit Tests
```bash
# Run existing tests
npm test -- --passWithNoTests

# Create network isolation specific tests
npm test -- src/services/network-isolation.test.ts
```

### 4. Integration Testing

#### Test 1: Network Creation
```bash
# Login as admin
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}' | jq -r '.data.token')

# Create network for repository
curl -X POST http://localhost:3000/api/networks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repository": "test-org/test-repo"}'
```

#### Test 2: Network Listing
```bash
# List all networks
curl -X GET http://localhost:3000/api/networks \
  -H "Authorization: Bearer $TOKEN"

# Get networks for specific repository
curl -X GET http://localhost:3000/api/networks/repository/test-org/test-repo \
  -H "Authorization: Bearer $TOKEN"
```

#### Test 3: Container Attachment
```bash
# Start a test container
docker run -d --name test-container alpine sleep 3600
CONTAINER_ID=$(docker ps -q -f name=test-container)

# Attach to network
curl -X POST http://localhost:3000/api/networks/attach \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"containerId\": \"$CONTAINER_ID\", \"repository\": \"test-org/test-repo\"}"

# Verify attachment
docker inspect $CONTAINER_ID | jq '.[0].NetworkSettings.Networks'
```

#### Test 4: Isolation Verification
```bash
# Create containers for different repositories
docker run -d --name repo1-container alpine sleep 3600
docker run -d --name repo2-container alpine sleep 3600

CONTAINER1_ID=$(docker ps -q -f name=repo1-container)
CONTAINER2_ID=$(docker ps -q -f name=repo2-container)

# Attach to different networks
curl -X POST http://localhost:3000/api/networks/attach \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"containerId\": \"$CONTAINER1_ID\", \"repository\": \"org/repo1\"}"

curl -X POST http://localhost:3000/api/networks/attach \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"containerId\": \"$CONTAINER2_ID\", \"repository\": \"org/repo2\"}"

# Verify isolation
curl -X GET "http://localhost:3000/api/networks/verify-isolation?containerId=$CONTAINER1_ID" \
  -H "Authorization: Bearer $TOKEN"

# Test connectivity (should fail)
docker exec repo1-container ping -c 1 $(docker inspect repo2-container -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
```

#### Test 5: Network Cleanup
```bash
# Remove test containers
docker rm -f repo1-container repo2-container test-container

# Run cleanup
curl -X POST http://localhost:3000/api/networks/cleanup \
  -H "Authorization: Bearer $TOKEN"

# Verify networks removed
docker network ls | grep runnerhub
```

### 5. Security Testing

#### Test 1: RBAC Enforcement
```bash
# Login as viewer (should fail)
VIEWER_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "viewer", "password": "viewer123"}' | jq -r '.data.token')

# Try to create network (should get 403)
curl -X POST http://localhost:3000/api/networks \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repository": "test-org/test-repo"}'
```

#### Test 2: Network Isolation
```bash
# Create two containers in same network
# They should be able to communicate

# Create two containers in different networks
# They should NOT be able to communicate
```

### 6. Performance Testing

#### Test 1: Concurrent Network Creation
```bash
# Create 10 networks concurrently
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/networks \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"repository\": \"test-org/repo-$i\"}" &
done
wait

# Check all created successfully
curl -X GET http://localhost:3000/api/networks/stats \
  -H "Authorization: Bearer $TOKEN"
```

#### Test 2: Large-Scale Cleanup
```bash
# Create many idle networks
# Wait for cleanup interval
# Verify automatic cleanup works
```

### 7. E2E Workflow Testing

```bash
# Complete workflow test
npm run test:e2e

# Or manual workflow:
# 1. Receive GitHub webhook
# 2. Create job
# 3. Allocate runner with isolated network
# 4. Execute job
# 5. Clean up container and network
```

## Test Results Summary

| Test Category | Status | Notes |
|--------------|--------|-------|
| Build Verification | ✅ PASSED | TypeScript compilation successful |
| Database Migration | ⏳ PENDING | Requires migration execution |
| Unit Tests | ⏳ PENDING | Need to create network-specific tests |
| Integration Tests | ⏳ PENDING | Manual testing required |
| Security Tests | ⏳ PENDING | RBAC and isolation verification |
| Performance Tests | ⏳ PENDING | Concurrent operation testing |
| E2E Tests | ⏳ PENDING | Full workflow validation |

## Verification Commands

```bash
# Quick verification script
cat << 'EOF' > verify-network-isolation.sh
#!/bin/bash

echo "=== Network Isolation Verification ==="

# Check service health
echo "1. Checking service health..."
curl -s http://localhost:3000/health | jq .

# Check network stats
echo "2. Getting network statistics..."
curl -s -X GET http://localhost:3000/api/networks/stats \
  -H "Authorization: Bearer $TOKEN" | jq .

# List Docker networks
echo "3. Docker networks:"
docker network ls | grep runnerhub || echo "No runnerhub networks found"

# Check database
echo "4. Database records:"
psql $DATABASE_URL -c "SELECT COUNT(*) as network_count FROM network_isolation;"
psql $DATABASE_URL -c "SELECT COUNT(*) as association_count FROM container_network_associations;"

echo "=== Verification Complete ==="
EOF

chmod +x verify-network-isolation.sh
./verify-network-isolation.sh
```

## Troubleshooting

### Common Issues

1. **Network creation fails**
   - Check Docker daemon permissions
   - Verify subnet range availability
   - Check for naming conflicts

2. **Container can't attach to network**
   - Verify container exists
   - Check network exists for repository
   - Ensure proper authentication

3. **Cleanup not working**
   - Check cleanup interval configuration
   - Verify database connectivity
   - Review cleanup logs

### Debug Commands

```bash
# Check Docker network details
docker network inspect <network-name>

# View container networks
docker inspect <container-id> | jq '.[0].NetworkSettings.Networks'

# Check service logs
docker-compose logs orchestrator | grep -i network

# Database queries
psql $DATABASE_URL -c "SELECT * FROM network_isolation WHERE repository = 'org/repo';"
psql $DATABASE_URL -c "SELECT * FROM network_isolation_audit ORDER BY created_at DESC LIMIT 10;"
```

## Next Steps

1. Create automated test suite for network isolation
2. Add network metrics to monitoring dashboard
3. Implement network policies for advanced configuration
4. Add network bandwidth monitoring
5. Create network troubleshooting tools