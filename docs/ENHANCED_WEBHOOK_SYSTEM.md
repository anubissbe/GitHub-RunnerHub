# Enhanced GitHub Webhook System

## Overview

The enhanced GitHub webhook system provides comprehensive support for all GitHub event types with advanced features including real-time updates, event deduplication, replay functionality, and detailed monitoring.

## Key Enhancements

### 1. Comprehensive Event Support

The system now supports **ALL** GitHub webhook event types:

#### Actions Events
- `workflow_job` - Job queued, in progress, or completed
- `workflow_run` - Workflow run requested, in progress, or completed  
- `workflow_dispatch` - Manual workflow triggers
- `check_run` - Check run created or updated
- `check_suite` - Check suite requested or completed

#### Code Events
- `push` - Git push to repository
- `create` - Branch or tag created
- `delete` - Branch or tag deleted
- `gollum` - Wiki page created or updated

#### Pull Request Events
- `pull_request` - PR opened, closed, merged, etc.
- `pull_request_review` - PR review submitted
- `pull_request_review_comment` - Comment on PR review
- `pull_request_target` - PR from fork

#### Issue Events
- `issues` - Issue opened, closed, labeled, etc.
- `issue_comment` - Comment on issue

#### Repository Events
- `deployment` - Deployment created
- `deployment_status` - Deployment status updated
- `fork` - Repository forked
- `page_build` - GitHub Pages build
- `public` - Repository made public
- `release` - Release published
- `repository` - Repository created, deleted, etc.
- `repository_dispatch` - Custom repository event
- `star` - Repository starred
- `status` - Commit status updated
- `watch` - Repository watched

#### Security Events
- `code_scanning_alert` - Code scanning alert
- `secret_scanning_alert` - Secret detected
- `security_advisory` - Security advisory published
- `vulnerability_alert` - Vulnerability detected

#### Organization Events
- `member` - Member added/removed
- `membership` - Team membership changed
- `organization` - Organization updated
- `org_block` - User blocked/unblocked
- `team` - Team created/deleted
- `team_add` - Repository added to team

#### Other Events
- `installation` - GitHub App installation
- `label` - Label created/edited
- `milestone` - Milestone created/closed
- `package` - Package published
- `ping` - Webhook test
- `project` - Project created/updated
- `sponsorship` - Sponsorship created/cancelled

### 2. Event Deduplication

Prevents duplicate processing of webhook events:

```typescript
// Deduplication based on:
- Event type
- Delivery ID  
- Action
- Repository
- Key entity IDs (job, run, PR, issue, etc.)

// Configurable TTL for dedup cache (default: 60 seconds)
```

### 3. Enhanced Validation

Comprehensive webhook validation:

- **Header Validation**: Required GitHub headers
- **Signature Verification**: HMAC-SHA256 with timing-safe comparison
- **Payload Validation**: Structure and required fields
- **User-Agent Check**: Verify GitHub-Hookshot origin

### 4. Real-time WebSocket Updates

Three WebSocket namespaces for different use cases:

#### Main Namespace (`/`)
```javascript
// Connect
const socket = io();

// Subscribe to repository
socket.emit('subscribe:repository', 'org/repo');

// Listen for events
socket.on('workflow-job', (data) => {
  console.log('Job update:', data);
});

socket.on('push-event', (data) => {
  console.log('Push event:', data);
});

socket.on('security-alert', (data) => {
  console.log('SECURITY ALERT:', data);
});
```

#### Webhook Namespace (`/webhooks`)
```javascript
// Connect to webhook namespace
const webhookSocket = io('/webhooks');

// Subscribe with filters
webhookSocket.emit('subscribe:webhook-events', {
  repository: 'org/repo',
  eventType: 'workflow_job'
});

// Listen for webhook events
webhookSocket.on('event', (data) => {
  console.log('Webhook event:', data);
});
```

#### Monitoring Namespace (`/monitoring`)
```javascript
// Connect to monitoring namespace
const monitoringSocket = io('/monitoring');

// Receive real-time metrics
monitoringSocket.on('update', (metrics) => {
  console.log('Metrics update:', metrics);
});
```

### 5. Webhook Event Replay

Replay failed or specific webhook events:

```bash
# Replay a specific webhook by delivery ID
POST /api/webhooks/replay/:deliveryId

# Retry all failed webhooks
POST /api/webhooks/retry-failed
```

### 6. Advanced Monitoring & Metrics

#### Webhook Statistics
```bash
GET /api/webhooks/statistics?hours=24

Response:
{
  "summary": {
    "totalEvents": 1500,
    "processedEvents": 1480,
    "pendingEvents": 5,
    "failedEvents": 15,
    "successRate": "98.67",
    "avgProcessingTimeMs": 125
  },
  "byEvent": [
    {
      "event": "workflow_job",
      "total": 800,
      "processed": 790,
      "failed": 10,
      "avgProcessingTimeMs": 150
    }
  ]
}
```

#### Webhook Health
```bash
GET /api/webhooks/health

Response:
{
  "status": "healthy",
  "healthScore": 95,
  "recentEvents": 10,
  "lastEventTime": "2024-01-01T12:00:00Z",
  "failedWebhooksCount": 2,
  "metrics": {
    "hourly": {
      "total": 150,
      "failed": 2,
      "avgProcessingTimeMs": 125
    }
  }
}
```

### 7. Enhanced Database Schema

New tables and indexes for better performance:

- **webhook_events**: Enhanced with deduplication and processing metrics
- **webhook_metrics**: Processing time and success tracking
- **job_metrics**: Detailed job execution metrics
- **repository_stats**: Repository-level statistics

Views for analytics:
- **webhook_event_stats**: Aggregated event statistics
- **repository_activity**: Repository activity summary

## Configuration

### Environment Variables

```bash
# Webhook secret for signature verification
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Database connection
DATABASE_URL=postgresql://user:pass@host:port/db

# Optional: Webhook processing settings
WEBHOOK_DEDUP_TTL=60000  # Deduplication cache TTL (ms)
WEBHOOK_MAX_RETRIES=3    # Max retry attempts
```

### GitHub Repository Setup

1. Go to Settings → Webhooks
2. Add webhook:
   - **Payload URL**: `https://your-domain.com/api/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: Your webhook secret
   - **Events**: Select individual events or "Send me everything"

## API Reference

### Webhook Endpoints

#### Receive GitHub Webhook
```
POST /api/webhooks/github
Headers:
  X-GitHub-Event: [event-type]
  X-GitHub-Delivery: [unique-id]
  X-Hub-Signature-256: [signature]
```

#### Get Webhook Events
```
GET /api/webhooks/events
Query Parameters:
  - repository: Filter by repository
  - event: Filter by event type
  - action: Filter by action
  - processed: Filter by processed status (true/false)
  - startDate: Start date filter
  - endDate: End date filter
  - limit: Max results (default: 100)
  - offset: Pagination offset
```

#### Get Webhook Statistics
```
GET /api/webhooks/statistics
Query Parameters:
  - hours: Time window in hours (default: 24)
```

#### Get Webhook Health
```
GET /api/webhooks/health
```

#### Get Supported Event Types
```
GET /api/webhooks/events/types
```

#### Get Failed Webhooks
```
GET /api/webhooks/failed
Query Parameters:
  - limit: Max results (default: 10)
```

#### Replay Webhook
```
POST /api/webhooks/replay/:deliveryId
```

#### Retry Failed Webhooks
```
POST /api/webhooks/retry-failed
```

#### Test Webhook
```
POST /api/webhooks/test
Body:
{
  "eventType": "workflow_job",
  "repository": "test/repo",
  "action": "queued"
}
```

## Usage Examples

### JavaScript Client

```javascript
// Listen for real-time webhook events
const socket = io('http://localhost:3000');

// Subscribe to specific repository
socket.emit('subscribe:repository', 'myorg/myrepo');

// Handle workflow job events
socket.on('workflow-job', (data) => {
  console.log(`Job ${data.job.name} is ${data.action}`);
  
  if (data.action === 'completed') {
    console.log(`Conclusion: ${data.job.conclusion}`);
  }
});

// Handle security alerts
socket.on('security-alert', (data) => {
  alert(`Security issue in ${data.repository.full_name}: ${data.eventType}`);
});

// Monitor webhook health
async function checkWebhookHealth() {
  const response = await fetch('/api/webhooks/health');
  const health = await response.json();
  
  if (health.data.healthScore < 80) {
    console.warn('Webhook system health degraded:', health.data);
  }
}
```

### Python Client

```python
import socketio
import requests

# Connect to WebSocket
sio = socketio.Client()

@sio.on('workflow-job')
def on_workflow_job(data):
    print(f"Job {data['job']['name']} is {data['action']}")

@sio.on('security-alert')
def on_security_alert(data):
    print(f"SECURITY ALERT: {data['eventType']} in {data['repository']['full_name']}")

# Connect
sio.connect('http://localhost:3000')

# Subscribe to repository
sio.emit('subscribe:repository', 'myorg/myrepo')

# Check webhook statistics
response = requests.get('http://localhost:3000/api/webhooks/statistics?hours=1')
stats = response.json()
print(f"Success rate: {stats['data']['summary']['successRate']}%")
```

## Monitoring & Troubleshooting

### Dashboard

Access the enhanced dashboard at `http://localhost:3000/dashboard` for:

- Real-time webhook event stream
- Event statistics and success rates
- Failed webhook tracking
- Repository-specific filtering
- Security alert monitoring

### Common Issues

#### 1. Webhook Signature Validation Fails
- Verify `GITHUB_WEBHOOK_SECRET` matches GitHub configuration
- Check Content-Type is `application/json`
- Ensure no proxy is modifying the request body

#### 2. Duplicate Events
- Check deduplication cache is working
- Verify delivery IDs are unique
- Review cache TTL settings

#### 3. WebSocket Connection Issues
- Check firewall allows WebSocket connections
- Verify CORS settings
- Test with different transports (polling vs websocket)

#### 4. High Processing Times
- Review database indexes
- Check for blocking operations
- Monitor database connection pool

### Debug Mode

Enable detailed logging:

```bash
DEBUG=GitHubWebhook* npm start
```

## Performance Considerations

### Optimization Tips

1. **Database Indexes**: Ensure all indexes are created
2. **Connection Pooling**: Use appropriate pool size
3. **Async Processing**: Heavy operations should be queued
4. **Caching**: Implement caching for frequently accessed data
5. **Rate Limiting**: Implement rate limiting for API endpoints

### Scaling

For high-volume environments:

1. **Horizontal Scaling**: Run multiple instances with load balancer
2. **Queue Distribution**: Use Redis for distributed job queue
3. **Database Sharding**: Partition webhook_events by date/repository
4. **CDN**: Serve static assets via CDN
5. **Monitoring**: Use Prometheus + Grafana for metrics

## Security Best Practices

1. **Always use webhook secrets** in production
2. **Validate all incoming data** before processing
3. **Use HTTPS** for webhook endpoints
4. **Implement rate limiting** to prevent abuse
5. **Log security events** for audit trails
6. **Rotate secrets regularly**
7. **Monitor for anomalies** in webhook patterns

## Migration Guide

To migrate from the basic webhook system:

1. Run database migrations:
   ```bash
   psql $DATABASE_URL < migrations/007_enhanced_webhook_tables.sql
   ```

2. Update imports:
   ```typescript
   // Old
   import githubWebhook from './services/github-webhook';
   
   // New
   import githubWebhookEnhanced from './services/github-webhook-enhanced';
   ```

3. Update app initialization:
   ```typescript
   // Use enhanced app
   import AppEnhanced from './app-enhanced';
   const app = new AppEnhanced();
   ```

4. Update webhook URL in GitHub settings (if changed)

5. Test with various event types

## Future Enhancements

Planned improvements:

1. **Event Filtering**: Repository/org-level event filtering
2. **Event Transformation**: Custom event transformation pipelines  
3. **Webhook Analytics**: Deep analytics and insights
4. **Event Archival**: Long-term event storage
5. **Multi-tenancy**: Organization-level isolation
6. **GraphQL API**: GraphQL endpoint for webhook data
7. **Event Streaming**: Kafka/EventBridge integration

## Support

For issues or questions:

1. Check the logs: `docker logs runnerhub-app`
2. Review webhook events: `/api/webhooks/events`
3. Check health status: `/api/webhooks/health`
4. Enable debug logging for detailed traces