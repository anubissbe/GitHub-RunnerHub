# GitHub API Integration Guide

## Overview

The GitHub RunnerHub dashboard now features full integration with the GitHub API to display real-time data from your GitHub Actions workflows, runners, and repositories. This guide explains how to configure and use the GitHub integration features.

## Features

### 1. Real-Time GitHub Data
- **Live Workflow Status**: View the current status of GitHub Actions workflows
- **Runner Monitoring**: Track GitHub-hosted and self-hosted runners
- **Job Queue Visualization**: See queued, running, and completed jobs
- **Repository Activity**: Monitor activity across multiple repositories

### 2. Smart Rate Limiting
- **Intelligent Request Management**: Automatically manages API requests to stay within GitHub's rate limits
- **Adaptive Strategies**: Switches between conservative and aggressive fetching based on remaining quota
- **Visual Status Indicator**: Dashboard shows current rate limit status

### 3. Caching Layer
- **Redis-based Caching**: Reduces API calls by caching frequently accessed data
- **Configurable TTLs**: Different cache durations for different data types:
  - Repositories: 5 minutes
  - Workflow runs: 1 minute
  - Runners: 30 seconds
  - Jobs: 30 seconds

## Configuration

### Environment Variables

```bash
# Required
GITHUB_TOKEN=your_github_personal_access_token

# Optional
GITHUB_REPOSITORIES=owner/repo1,owner/repo2  # Pre-configured repositories
REDIS_URL=redis://localhost:6379             # Redis connection for caching
```

### GitHub Token Permissions

Your GitHub Personal Access Token needs the following permissions:
- `repo` - Full repository access
- `workflow` - Access to GitHub Actions workflows
- `admin:org` - Read organization runners (if using org runners)

## Dashboard Features

### Repository Management
- **Add Repository**: Click "Add Repo" and enter in `owner/repo` format
- **Remove Repository**: Click the X button on any repository tag
- **Dynamic Updates**: Dashboard automatically refreshes when repositories are added/removed

### GitHub Status Indicator
- 🟢 **Green**: Connected, healthy rate limit (< 60% used)
- 🟡 **Yellow**: Limited, approaching rate limit (60-80% used)
- 🔴 **Red**: Rate limited (> 80% used)
- ⚫ **Gray**: Disconnected or no GitHub token

### Data Display
- **Jobs Table**: Shows workflow name, repository, branch, status, and duration
- **Runner Health**: Displays both GitHub-hosted and self-hosted runners
- **Metrics**: Combines GitHub API data with local RunnerHub data

## API Endpoints

### Repository Management
```bash
# Get tracked repositories
GET /api/monitoring/repositories

# Add repository
POST /api/monitoring/repositories
{
  "repository": "owner/repo"
}

# Remove repository
DELETE /api/monitoring/repositories/owner_repo
```

### Enhanced Monitoring
```bash
# Get system metrics with GitHub data
GET /api/monitoring/system

# Get dashboard data
GET /api/monitoring/dashboard

# Get repository-specific metrics
GET /api/monitoring/repository/owner_repo
```

## Testing the Integration

Run the provided test script to verify GitHub integration:

```bash
node test-github-integration.js
```

This will:
1. Check API endpoints
2. Verify GitHub connection
3. Display rate limit status
4. Add a test repository if needed
5. Confirm data is being fetched

## Troubleshooting

### No GitHub Data Showing
1. Verify `GITHUB_TOKEN` is set correctly
2. Check token permissions
3. Ensure repositories have recent workflow activity
4. Check rate limit status in dashboard

### Rate Limit Issues
1. The system automatically throttles requests when approaching limits
2. Data fetching temporarily disables if rate limited
3. Consider using multiple tokens for high-traffic scenarios

### Connection Issues
1. Check firewall/proxy settings
2. Verify GitHub API is accessible
3. Check Redis connection for caching
4. Review logs for specific error messages

## Architecture

### Data Flow
1. **GitHub API Client** (`github-api-enhanced.ts`): Handles rate limiting and queuing
2. **GitHub Data Service** (`github-data-service.ts`): Fetches and caches GitHub data
3. **Enhanced Monitoring** (`monitoring-enhanced.ts`): Merges GitHub and local data
4. **Dashboard UI**: Displays combined metrics with real-time updates

### Caching Strategy
- Data is cached in Redis to minimize API calls
- Cache is invalidated on webhook events (when implemented)
- Fallback to local data if GitHub API is unavailable

## Best Practices

1. **Start with Few Repositories**: Add repositories gradually to understand API usage
2. **Monitor Rate Limits**: Keep an eye on the rate limit indicator
3. **Use Webhooks**: Implement webhook integration for real-time updates (reduces polling)
4. **Configure Caching**: Adjust cache TTLs based on your needs

## Future Enhancements

- **Webhook Integration**: Real-time updates without polling
- **Historical Analytics**: Long-term trend analysis
- **Multi-org Support**: Track repositories across organizations
- **Custom Dashboards**: Per-repository dashboard views