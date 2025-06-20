# Job Routing System

## Overview

The Job Routing System provides intelligent, label-based routing of GitHub Actions jobs to specific runners. It enables organizations to optimize resource utilization, enforce security policies, and ensure jobs run on appropriate infrastructure.

## Key Features

- **Label-Based Routing**: Route jobs to runners based on required labels
- **Priority-Based Rules**: Multiple rules with priority ordering
- **Pattern Matching**: Support for wildcards in repository, workflow, and branch conditions
- **Pool Override**: Route jobs to specific runner pools
- **Exclusive Matching**: Ensure runners have only the required labels
- **Analytics & Monitoring**: Track routing decisions and rule effectiveness
- **Rule Testing**: Preview routing decisions before deployment

## Architecture

### Components

1. **JobRouter Service**: Core routing engine
   - Rule evaluation and matching
   - Label indexing for performance
   - Caching and periodic refresh
   - Analytics collection

2. **Routing Rules**: Configurable policies
   - Conditions (labels, repository, workflow, branch, event)
   - Targets (runner labels, pool override, exclusivity)
   - Priority ordering

3. **REST API**: Management interface
   - CRUD operations for rules
   - Testing and preview capabilities
   - Analytics and metrics

4. **Database Schema**: Persistent storage
   - `routing_rules`: Rule definitions
   - `routing_decisions`: Historical decisions for analytics

## Routing Algorithm

### Rule Evaluation Process

1. **Quick Label Index Lookup**
   - Jobs with labels are matched against indexed rules
   - O(1) lookup performance per label

2. **Condition Matching**
   - Repository pattern matching (supports wildcards)
   - Workflow name matching
   - Branch name extraction and matching
   - Event type matching
   - Label subset verification

3. **Priority Ordering**
   - Rules sorted by priority (highest first)
   - First matching rule wins
   - Default routing if no rules match

4. **Target Runner Selection**
   - Find runners with all required labels
   - Apply exclusivity constraints if specified
   - Fall back to pool runners if no matches

## API Reference

### Routing Rules Management

#### GET /api/routing/rules
Get all routing rules.

**Response:**
```json
{
  "success": true,
  "data": [{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "GPU Workloads",
    "priority": 100,
    "conditions": {
      "labels": ["gpu", "cuda"],
      "repository": "*/ml-*"
    },
    "targets": {
      "runnerLabels": ["gpu-enabled", "cuda-12"],
      "exclusive": false
    },
    "enabled": true,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }]
}
```

#### POST /api/routing/rules
Create a new routing rule.

**Request:**
```json
{
  "name": "Production Deployments",
  "priority": 90,
  "conditions": {
    "repository": "*/production",
    "branch": "main",
    "labels": ["deploy"]
  },
  "targets": {
    "runnerLabels": ["production", "secure"],
    "exclusive": true
  },
  "enabled": true
}
```

#### PUT /api/routing/rules/:id
Update an existing routing rule.

**Request:**
```json
{
  "priority": 95,
  "targets": {
    "runnerLabels": ["production", "secure", "validated"]
  }
}
```

#### DELETE /api/routing/rules/:id
Delete a routing rule.

### Testing & Preview

#### POST /api/routing/test
Test a routing rule with a sample job.

**Request:**
```json
{
  "rule": {
    "name": "Test Rule",
    "conditions": {
      "labels": ["gpu"]
    },
    "targets": {
      "runnerLabels": ["gpu-enabled"]
    }
  },
  "sampleJob": {
    "repository": "org/repo",
    "labels": ["gpu", "linux"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "matches": true,
    "targetRunners": [
      {
        "id": "runner-123",
        "name": "gpu-runner-1",
        "labels": ["gpu-enabled", "linux"]
      }
    ],
    "reason": "Rule matches - found 1 target runners"
  }
}
```

#### POST /api/routing/preview
Preview routing for a job without executing.

**Request:**
```json
{
  "job": {
    "repository": "org/ml-project",
    "workflowName": "train-model",
    "labels": ["gpu", "large-model"],
    "payload": {
      "ref": "refs/heads/feature/new-model"
    }
  }
}
```

### Analytics

#### GET /api/routing/analytics
Get routing analytics.

**Query Parameters:**
- `hours`: Time window (default: 24)

**Response:**
```json
{
  "success": true,
  "data": {
    "timeWindow": "24 hours",
    "rules": [{
      "rule_id": "550e8400-e29b-41d4-a716-446655440000",
      "rule_name": "GPU Workloads",
      "match_count": 156,
      "avg_targets": 3.5,
      "last_matched": "2024-01-01T12:00:00Z"
    }]
  }
}
```

#### GET /api/routing/labels/suggestions
Get suggested labels based on existing runners.

**Response:**
```json
{
  "success": true,
  "data": [
    "arm64",
    "cuda",
    "docker",
    "gpu",
    "kubernetes",
    "large",
    "linux",
    "macos",
    "production",
    "self-hosted",
    "windows",
    "x64"
  ]
}
```

## Configuration Examples

### GPU Workloads
Route machine learning jobs to GPU-enabled runners:

```json
{
  "name": "GPU Workloads",
  "priority": 100,
  "conditions": {
    "labels": ["gpu", "cuda"]
  },
  "targets": {
    "runnerLabels": ["gpu-enabled", "cuda-12"],
    "exclusive": false
  }
}
```

### Production Security
Ensure production deployments use secure, validated runners:

```json
{
  "name": "Production Deployments",
  "priority": 90,
  "conditions": {
    "repository": "*/production",
    "branch": "main",
    "event": "workflow_dispatch"
  },
  "targets": {
    "runnerLabels": ["production", "secure", "validated"],
    "exclusive": true
  }
}
```

### Platform-Specific Builds
Route builds to appropriate OS runners:

```json
{
  "name": "Windows Builds",
  "priority": 70,
  "conditions": {
    "labels": ["windows", "win32"]
  },
  "targets": {
    "runnerLabels": ["windows", "windows-latest"],
    "poolOverride": "windows-pool"
  }
}
```

### Resource-Intensive Jobs
Route large jobs to high-capacity runners:

```json
{
  "name": "Large Jobs",
  "priority": 80,
  "conditions": {
    "labels": ["large", "memory-intensive"]
  },
  "targets": {
    "runnerLabels": ["xlarge", "high-memory"],
    "exclusive": false
  }
}
```

## Pattern Matching

### Repository Patterns
- `*/production` - Matches any repository ending with "production"
- `org/*` - Matches all repositories in "org"
- `org/app-*` - Matches repositories starting with "app-" in "org"
- `*` - Matches all repositories

### Workflow Patterns
- `deploy-*` - Matches workflows starting with "deploy-"
- `*-test` - Matches workflows ending with "-test"
- `build` - Exact match for "build" workflow

### Branch Patterns
- `main` - Exact match for main branch
- `feature/*` - Matches all feature branches
- `release-*` - Matches release branches

## Best Practices

### 1. Rule Priority Design
- **100+**: Critical security/compliance rules
- **80-99**: Resource-specific rules (GPU, high-memory)
- **60-79**: Platform/OS specific rules
- **40-59**: Team or project-specific rules
- **0-39**: General optimization rules

### 2. Label Naming Conventions
```yaml
# Platform/Architecture
- linux, windows, macos
- x64, arm64

# Resources
- gpu, cuda, opencl
- large, xlarge, high-memory

# Security/Environment
- production, staging, development
- secure, validated, isolated

# Capabilities
- docker, kubernetes
- self-hosted
```

### 3. Testing Strategy
1. Create rule in disabled state
2. Test with various job scenarios
3. Monitor in preview mode
4. Enable gradually with low priority
5. Increase priority after validation

### 4. Monitoring & Optimization
- Review analytics weekly
- Identify underutilized rules
- Consolidate similar rules
- Adjust priorities based on conflicts
- Remove obsolete rules

## Troubleshooting

### Common Issues

1. **Jobs Not Matching Expected Rules**
   - Check rule priority ordering
   - Verify all conditions are met
   - Use preview endpoint to debug
   - Check if rule is enabled

2. **No Runners Available**
   - Verify runners have required labels
   - Check pool configuration
   - Review exclusive constraints
   - Ensure runners are online

3. **Performance Issues**
   - Monitor rule count (keep < 100)
   - Use specific conditions over wildcards
   - Index frequently used labels
   - Consolidate overlapping rules

### Debug Workflow

1. **Preview the routing decision:**
   ```bash
   curl -X POST http://localhost:3000/api/routing/preview \
     -H "Content-Type: application/json" \
     -d '{"job": {"repository": "org/repo", "labels": ["gpu"]}}'
   ```

2. **Check rule matches:**
   ```bash
   curl http://localhost:3000/api/routing/rules | jq '.data[] | select(.conditions.labels | contains(["gpu"]))'
   ```

3. **Review recent decisions:**
   ```bash
   curl "http://localhost:3000/api/routing/analytics?hours=1"
   ```

## Integration with Container Orchestrator

The job router is automatically invoked during job execution:

1. Job submitted to orchestrator
2. Router evaluates all matching rules
3. Selects highest priority matching rule
4. Identifies target runners
5. Creates ephemeral container on selected runner
6. Records routing decision for analytics

```typescript
// Automatic routing in orchestrator
const routingDecision = await jobRouter.routeJob(job);
logger.info('Job routing decision', {
  jobId: job.id,
  matchedRule: routingDecision.matchedRule?.name,
  targetCount: routingDecision.targetRunners.length
});
```

## Security Considerations

1. **Rule Validation**
   - Validate label formats
   - Sanitize pattern inputs
   - Limit rule complexity

2. **Access Control**
   - Restrict rule management to admins
   - Audit all rule changes
   - Version control rule configurations

3. **Resource Protection**
   - Use exclusive matching for sensitive runners
   - Implement pool isolation
   - Monitor unusual routing patterns

## Performance Optimization

1. **Label Indexing**: O(1) lookup for label-based rules
2. **Rule Caching**: In-memory cache with 60-second refresh
3. **Priority Ordering**: Early termination on first match
4. **Database Indexes**: Optimized queries for analytics

## Future Enhancements

1. **Machine Learning**: Predictive routing based on job history
2. **Cost Optimization**: Route based on runner costs
3. **Geographic Routing**: Route to nearest datacenter
4. **Dynamic Labels**: Auto-generate labels from job context
5. **Rule Templates**: Pre-configured rule sets for common scenarios