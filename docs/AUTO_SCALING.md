# Auto-Scaling System

## Overview

The Auto-Scaling system provides intelligent, policy-based scaling of GitHub Actions runners to maintain optimal performance while minimizing resource waste. It monitors multiple metrics and makes scaling decisions based on configurable thresholds, with support for predictive scaling and cooldown periods.

## Architecture

### Core Components

1. **AutoScaler Service**: Central service managing scaling decisions
2. **Scaling Policies**: Per-repository configuration for scaling behavior
3. **Metrics Collection**: Real-time monitoring of utilization, queue depth, and wait times
4. **Predictive Analysis**: Historical data analysis for proactive scaling
5. **Cooldown Management**: Prevents scaling thrashing

### Scaling Decision Flow

```
Metrics Collection → Policy Evaluation → Decision Making → Cooldown Check → Execution
       ↑                                                                           ↓
       └───────────────────── Monitoring Loop (30s) ──────────────────────────────┘
```

## Scaling Policies

### Policy Configuration

Each repository can have its own scaling policy with the following parameters:

```typescript
interface ScalingPolicy {
  repository: string;
  scaleUpThreshold: number;     // Default: 0.8 (80%)
  scaleDownThreshold: number;   // Default: 0.2 (20%)
  scaleUpIncrement: number;     // Runners to add
  scaleDownIncrement: number;   // Runners to remove
  cooldownPeriod: number;       // Seconds between scaling
  queueDepthThreshold: number;  // Pending jobs threshold
  avgWaitTimeThreshold: number; // Wait time in seconds
}
```

### Default Policy

```json
{
  "scaleUpThreshold": 0.8,
  "scaleDownThreshold": 0.2,
  "scaleUpIncrement": 3,
  "scaleDownIncrement": 1,
  "cooldownPeriod": 300,
  "queueDepthThreshold": 3,
  "avgWaitTimeThreshold": 30
}
```

## Scaling Triggers

### Scale-Up Conditions (Priority Order)

1. **Queue Depth**: Pending jobs ≥ threshold
   - Immediate response to prevent job backlog
   - Highest priority trigger

2. **High Utilization**: Runner utilization ≥ threshold
   - Proactive scaling before queue builds
   - Based on active/total runner ratio

3. **Wait Time**: Average wait time ≥ threshold
   - Quality of service metric
   - Ensures jobs start quickly

### Scale-Down Conditions

1. **Low Utilization**: Runner utilization ≤ threshold
2. **No Pending Jobs**: Queue depth = 0
3. **No Active Jobs**: All runners idle
4. **Above Minimum**: Current runners > minimum threshold

## API Endpoints

### Policy Management

#### GET /api/scaling/policies
Get all scaling policies with current status.

**Response:**
```json
{
  "success": true,
  "data": [{
    "repository": "owner/repo",
    "policy": {
      "scaleUpThreshold": 0.8,
      "scaleDownThreshold": 0.2,
      "cooldownPeriod": 300
    },
    "lastAction": "2024-01-01T12:00:00Z",
    "inCooldown": false,
    "cooldownRemaining": 0
  }]
}
```

#### PUT /api/scaling/policies/:repository
Update scaling policy for a repository.

**Request:**
```json
{
  "scaleUpThreshold": 0.75,
  "scaleDownThreshold": 0.25,
  "scaleUpIncrement": 5,
  "cooldownPeriod": 600
}
```

### Metrics & Analytics

#### GET /api/scaling/metrics/history
Get historical scaling metrics.

**Query Parameters:**
- `repository`: Filter by repository (optional)
- `minutes`: History duration (1-1440, default: 60)

**Response:**
```json
{
  "success": true,
  "data": [{
    "timestamp": "2024-01-01T12:00:00Z",
    "repository": "owner/repo",
    "utilization": 0.85,
    "queueDepth": 5,
    "avgWaitTime": 45.2,
    "runnerCount": 10,
    "activeJobs": 8,
    "scalingDecision": "scale-up",
    "reason": "Utilization 85% exceeds threshold 80%"
  }]
}
```

#### GET /api/scaling/metrics/predictions/:repository
Get scaling predictions based on historical trends.

**Query Parameters:**
- `minutes`: Prediction window (default: 30)

**Response:**
```json
{
  "success": true,
  "data": {
    "repository": "owner/repo",
    "minutes": 30,
    "predictedUtilization": 0.92,
    "recommendedRunners": 15,
    "confidence": 0.85
  }
}
```

### Actions

#### POST /api/scaling/evaluate/:repository
Force immediate scaling evaluation (bypasses cooldown).

**Response:**
```json
{
  "success": true,
  "data": {
    "decision": "scale-up",
    "reason": "Queue depth 8 exceeds threshold 5",
    "metrics": {
      "utilization": 0.9,
      "queueDepth": 8,
      "avgWaitTime": 120
    }
  }
}
```

### Dashboard

#### GET /api/scaling/dashboard
Get comprehensive scaling dashboard data.

**Response:**
```json
{
  "success": true,
  "data": {
    "repositories": [{
      "repository": "owner/repo",
      "pool": {
        "minRunners": 2,
        "maxRunners": 20,
        "currentRunners": 12
      },
      "metrics": {
        "utilization": 0.75,
        "activeRunners": 9
      },
      "scaling": {
        "inCooldown": false,
        "lastScaleUp": "2024-01-01T11:45:00Z",
        "recentEvents": 3
      }
    }],
    "totalPools": 5,
    "activePools": 3,
    "scalingInProgress": 1
  }
}
```

## Scaling Algorithm

### Decision Process

1. **Collect Metrics**
   - Current utilization
   - Queue depth
   - Average wait time
   - Active jobs count

2. **Check Constraints**
   - Not already scaling
   - Not in cooldown period
   - Within min/max limits

3. **Evaluate Triggers**
   - Priority order evaluation
   - First matching trigger wins

4. **Execute Decision**
   - Add/remove runners
   - Update last action time
   - Emit scaling events

### Predictive Scaling

The system uses historical data to predict future needs:

1. **Trend Analysis**: Linear regression on utilization
2. **Pattern Recognition**: Identifies recurring patterns
3. **Confidence Scoring**: Based on data consistency
4. **Proactive Scaling**: Acts before thresholds are hit

## Configuration Examples

### High-Traffic Repository
```json
{
  "scaleUpThreshold": 0.7,
  "scaleDownThreshold": 0.3,
  "scaleUpIncrement": 10,
  "scaleDownIncrement": 5,
  "cooldownPeriod": 180,
  "queueDepthThreshold": 10,
  "avgWaitTimeThreshold": 15
}
```

### Cost-Optimized Setup
```json
{
  "scaleUpThreshold": 0.9,
  "scaleDownThreshold": 0.1,
  "scaleUpIncrement": 2,
  "scaleDownIncrement": 1,
  "cooldownPeriod": 600,
  "queueDepthThreshold": 5,
  "avgWaitTimeThreshold": 120
}
```

### Burst Workload
```json
{
  "scaleUpThreshold": 0.6,
  "scaleDownThreshold": 0.4,
  "scaleUpIncrement": 15,
  "scaleDownIncrement": 10,
  "cooldownPeriod": 300,
  "queueDepthThreshold": 2,
  "avgWaitTimeThreshold": 10
}
```

## Monitoring & Alerts

### Metrics Tracked

1. **Scaling Events**
   - Timestamp
   - Direction (up/down)
   - Runner count change
   - Trigger reason

2. **Performance Metrics**
   - Utilization over time
   - Queue depth trends
   - Wait time averages
   - Scaling effectiveness

3. **Resource Usage**
   - Total runners by repository
   - Cost implications
   - Efficiency metrics

### Alert Conditions

- Repeated scaling failures
- Hitting max runner limits
- Extended high utilization
- Cooldown preventing necessary scaling

## Best Practices

### 1. Threshold Tuning

- **Start Conservative**: Begin with default thresholds
- **Monitor Performance**: Track queue times and utilization
- **Adjust Gradually**: Small incremental changes
- **Consider Patterns**: Different settings for different times

### 2. Increment Sizing

- **Match Workload**: Larger increments for bursty loads
- **Cost Awareness**: Smaller increments for cost control
- **Response Time**: Larger increments for faster response

### 3. Cooldown Periods

- **Prevent Thrashing**: Minimum 3-5 minutes recommended
- **Match Startup Time**: Consider runner initialization time
- **Allow Stabilization**: Let metrics settle after scaling

### 4. Monitoring

- **Review Weekly**: Check scaling effectiveness
- **Track Costs**: Monitor resource consumption
- **Adjust Policies**: Based on actual usage patterns
- **Set Alerts**: For unusual scaling patterns

## Troubleshooting

### Common Issues

1. **Not Scaling Up**
   - Check if at max capacity
   - Verify cooldown period
   - Review threshold settings
   - Check for scaling errors

2. **Scaling Too Frequently**
   - Increase cooldown period
   - Adjust thresholds
   - Check for workload spikes

3. **Slow Response**
   - Reduce scale-up threshold
   - Increase increment size
   - Enable predictive scaling

### Debug Commands

```bash
# Check current policy
curl http://localhost:3000/api/scaling/policies/owner_repo

# View scaling history
curl "http://localhost:3000/api/scaling/metrics/history?repository=owner/repo&minutes=60"

# Force evaluation
curl -X POST http://localhost:3000/api/scaling/evaluate/owner_repo

# Get predictions
curl http://localhost:3000/api/scaling/metrics/predictions/owner_repo
```

## Integration Examples

### Webhook Trigger
```javascript
// Trigger scaling on webhook
app.post('/webhook/push', async (req, res) => {
  const repository = req.body.repository.full_name;
  
  // Force immediate evaluation
  await autoScaler.evaluateNow(repository);
  
  res.json({ message: 'Scaling evaluation triggered' });
});
```

### Scheduled Scaling
```javascript
// Scale up before known busy period
cron.schedule('0 9 * * 1-5', async () => {
  await autoScaler.updatePolicy('production/api', {
    scaleUpThreshold: 0.6 // More aggressive
  });
});

// Scale down after hours
cron.schedule('0 18 * * 1-5', async () => {
  await autoScaler.updatePolicy('production/api', {
    scaleUpThreshold: 0.9 // More conservative
  });
});
```

## Performance Impact

- **Monitoring Overhead**: <1% CPU usage
- **Decision Time**: <100ms per evaluation
- **Memory Usage**: ~50MB for 1 hour of history
- **Network Traffic**: Minimal (internal queries)

## Future Enhancements

1. **Machine Learning**: Advanced prediction models
2. **Cost Optimization**: Budget-aware scaling
3. **Multi-Region**: Cross-region scaling coordination
4. **Custom Metrics**: User-defined scaling triggers
5. **Integration**: Direct GitHub API integration