# Monitoring Dashboard

## Overview

The GitHub RunnerHub monitoring dashboard provides real-time visibility into the health and performance of your GitHub Actions runner infrastructure. It includes system metrics, job timelines, runner health status, and pool utilization.

## Features

### Real-Time Metrics
- **Job Statistics**: Total jobs, pending, running, completed, and failed counts
- **Runner Status**: Active runners, idle runners, and offline runners
- **Performance Metrics**: Average wait time and execution time
- **Pool Utilization**: Current utilization percentage and scaling events

### Interactive Charts
1. **Job Timeline**: 24-hour view of job completion and failure rates
2. **Runner Distribution**: Pie chart showing idle, busy, and offline runners

### Live Tables
1. **Recent Jobs**: Latest 10 jobs with status and duration
2. **Runner Health**: All runners with health status indicators

### WebSocket Updates
- Real-time metric updates every 10 seconds
- Live job and scaling event notifications
- Repository-specific event subscriptions

## Accessing the Dashboard

### Web Interface
Navigate to: `http://localhost:3000/dashboard`

### API Endpoints

#### System Metrics
```bash
GET /api/monitoring/system
```

Returns overall system metrics including job counts, runner status, and pool utilization.

#### Repository Metrics
```bash
GET /api/monitoring/repository/{owner_repo}
```

Returns metrics specific to a repository. Use underscore (_) instead of slash (/).

#### Job Timeline
```bash
GET /api/monitoring/timeline?hours=24
```

Returns hourly job statistics for charting.

#### Runner Health
```bash
GET /api/monitoring/health
```

Returns detailed health status for all runners.

#### Dashboard Data (Aggregated)
```bash
GET /api/monitoring/dashboard
```

Returns all data needed for the dashboard in a single request.

## Prometheus Integration

The system exposes Prometheus-compatible metrics at `/metrics`:

```bash
# HELP github_runnerhub_jobs_total Total number of jobs
# TYPE github_runnerhub_jobs_total gauge
github_runnerhub_jobs_total 150

# HELP github_runnerhub_jobs_by_status Number of jobs by status
# TYPE github_runnerhub_jobs_by_status gauge
github_runnerhub_jobs_by_status{status="pending"} 5
github_runnerhub_jobs_by_status{status="running"} 10
github_runnerhub_jobs_by_status{status="completed"} 120
github_runnerhub_jobs_by_status{status="failed"} 15

# HELP github_runnerhub_runners_total Total number of runners
# TYPE github_runnerhub_runners_total gauge
github_runnerhub_runners_total 25

# HELP github_runnerhub_pool_utilization Runner pool utilization
# TYPE github_runnerhub_pool_utilization gauge
github_runnerhub_pool_utilization{repository="owner/repo"} 0.75
```

### Grafana Dashboard

To use with Grafana:

1. Add Prometheus data source pointing to `http://localhost:3000/metrics`
2. Import the dashboard template (if provided)
3. Configure refresh interval (recommended: 10s)

## WebSocket Events

### Client Connection
```javascript
const socket = io('http://localhost:3000');

// Subscribe to repository events
socket.emit('subscribe:repository', 'owner/repo');

// Listen for metrics updates
socket.on('metrics', (metrics) => {
  console.log('System metrics updated:', metrics);
});

// Listen for job events
socket.on('job-event', (event) => {
  console.log('Job event:', event);
});

// Listen for scaling events
socket.on('scaling-event', (event) => {
  console.log('Scaling event:', event);
});
```

### Event Types

1. **metrics**: System-wide metrics updates (every 10s)
2. **job-event**: Job state changes (created, started, completed, failed)
3. **runner-event**: Runner state changes (created, started, stopped)
4. **scaling-event**: Pool scaling decisions and actions

## Health Status Indicators

### Runner Health States
- **✓ healthy** (green): Heartbeat within last 60 seconds
- **! warning** (yellow): Heartbeat within last 5 minutes
- **✗ critical** (red): No heartbeat for over 5 minutes
- **○ offline** (gray): Runner marked as offline

### Job Status Colors
- **completed** (green): Job finished successfully
- **failed** (red): Job failed with error
- **running** (blue): Job currently executing
- **pending** (yellow): Job waiting for runner

## Performance Considerations

### Data Retention
- Recent jobs: Last 100 jobs
- Timeline data: Last 7 days
- Metrics history: Last 24 hours

### Update Intervals
- Dashboard refresh: 10 seconds
- WebSocket metrics: 10 seconds
- Runner health check: 30 seconds
- Pool scaling check: 30 seconds

### Browser Requirements
- Modern browser with WebSocket support
- JavaScript enabled
- Recommended: Chrome, Firefox, Safari, Edge

## Customization

### Dashboard Configuration
Edit `/public/js/dashboard.js` to customize:
- Update intervals
- Chart colors and styles
- Table row limits
- WebSocket event handlers

### Metrics Collection
Edit `/src/services/monitoring.ts` to add:
- Custom metrics
- Additional aggregations
- New event types
- Extended health checks

## Troubleshooting

### Dashboard Not Loading
1. Verify server is running: `curl http://localhost:3000/health`
2. Check browser console for errors
3. Ensure WebSocket connection is established

### Metrics Not Updating
1. Check monitoring service logs
2. Verify database connectivity
3. Ensure runner heartbeats are being received

### WebSocket Connection Issues
1. Check for proxy/firewall blocking WebSocket
2. Verify CORS settings if accessing from different domain
3. Check browser WebSocket support

## Security Considerations

1. **Authentication**: Add authentication middleware for production
2. **CORS**: Configure allowed origins appropriately
3. **Rate Limiting**: Adjust limits for monitoring endpoints
4. **Data Exposure**: Filter sensitive information from metrics

## Future Enhancements

1. **Historical Analysis**: Trend analysis and predictions
2. **Alerting**: Threshold-based alerts via email/Slack
3. **Custom Dashboards**: Per-repository or team dashboards
4. **Mobile Support**: Responsive design improvements
5. **Export Options**: CSV/JSON export for metrics