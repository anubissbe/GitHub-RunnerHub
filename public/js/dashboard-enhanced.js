// Enhanced Dashboard with real-time webhook updates
const socket = io();
const webhookSocket = io('/webhooks');
const monitoringSocket = io('/monitoring');

// State management
const state = {
  repositories: new Set(),
  recentWebhooks: [],
  webhookStats: {},
  connectedClients: 0,
  lastUpdate: null
};

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  console.log('Enhanced Dashboard initialized');
  
  // Setup WebSocket connections
  setupWebSocketConnections();
  
  // Load initial data
  loadDashboardData();
  
  // Setup refresh intervals
  setInterval(loadDashboardData, 30000); // Refresh every 30 seconds
  setInterval(updateConnectionStatus, 5000); // Check connection every 5 seconds
  
  // Setup event listeners
  setupEventListeners();
});

// Setup WebSocket connections
function setupWebSocketConnections() {
  // Main socket events
  socket.on('connect', () => {
    console.log('Connected to main WebSocket');
    updateConnectionStatus('connected');
    
    // Subscribe to all repositories we're tracking
    state.repositories.forEach(repo => {
      socket.emit('subscribe:repository', repo);
    });
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from main WebSocket');
    updateConnectionStatus('disconnected');
  });

  socket.on('metrics', (metrics) => {
    updateMetricsDisplay(metrics);
  });

  // Webhook-specific events
  socket.on('webhook:event', (event) => {
    handleWebhookEvent(event);
  });

  socket.on('webhook:job-update', (update) => {
    handleJobUpdate(update);
  });

  socket.on('webhook:workflow-run-update', (update) => {
    handleWorkflowRunUpdate(update);
  });

  socket.on('workflow-job', (data) => {
    handleWorkflowJob(data);
  });

  socket.on('push-event', (data) => {
    handlePushEvent(data);
  });

  socket.on('pull-request-event', (data) => {
    handlePullRequestEvent(data);
  });

  socket.on('deployment-event', (data) => {
    handleDeploymentEvent(data);
  });

  socket.on('security-alert', (data) => {
    handleSecurityAlert(data);
  });

  // Job and runner events
  socket.on('job-event', (event) => {
    updateJobsTable(event);
  });

  socket.on('runner-event', (event) => {
    updateRunnersTable(event);
  });

  socket.on('scaling-event', (event) => {
    updateScalingInfo(event);
  });

  // Webhook namespace events
  webhookSocket.on('connect', () => {
    console.log('Connected to webhook namespace');
    webhookSocket.emit('subscribe:webhook-events', {});
  });

  webhookSocket.on('event', (event) => {
    console.log('Webhook namespace event:', event);
  });

  // Monitoring namespace events
  monitoringSocket.on('connect', () => {
    console.log('Connected to monitoring namespace');
  });

  monitoringSocket.on('update', (metrics) => {
    console.log('Monitoring update:', metrics);
  });

  // Ping/pong for connection health
  setInterval(() => {
    socket.emit('ping');
  }, 30000);

  socket.on('pong', (data) => {
    console.log('Pong received:', data.timestamp);
    state.lastUpdate = new Date(data.timestamp);
  });
}

// Load dashboard data
async function loadDashboardData() {
  try {
    // Load jobs
    const jobsResponse = await fetch('/api/jobs?limit=20');
    const jobsData = await jobsResponse.json();
    if (jobsData.success) {
      updateJobsList(jobsData.data.jobs);
    }

    // Load runners
    const runnersResponse = await fetch('/api/runners');
    const runnersData = await runnersResponse.json();
    if (runnersData.success) {
      updateRunnersList(runnersData.data.runners);
    }

    // Load webhook statistics
    const webhookStatsResponse = await fetch('/api/webhooks/statistics?hours=1');
    const webhookStats = await webhookStatsResponse.json();
    if (webhookStats.success) {
      updateWebhookStatistics(webhookStats.data);
    }

    // Load recent webhook events
    const webhookEventsResponse = await fetch('/api/webhooks/events?limit=10');
    const webhookEvents = await webhookEventsResponse.json();
    if (webhookEvents.success) {
      updateWebhookEventsList(webhookEvents.data.events);
    }

    // Load metrics
    const metricsResponse = await fetch('/api/monitoring/metrics');
    const metricsData = await metricsResponse.json();
    if (metricsData.success) {
      updateMetricsDisplay(metricsData.data);
    }

  } catch (error) {
    console.error('Error loading dashboard data:', error);
    showError('Failed to load dashboard data');
  }
}

// Handle webhook events
function handleWebhookEvent(event) {
  console.log('Webhook event received:', event);
  
  // Add to recent webhooks
  state.recentWebhooks.unshift(event);
  if (state.recentWebhooks.length > 50) {
    state.recentWebhooks.pop();
  }
  
  // Update webhook event display
  addWebhookEventToDisplay(event);
  
  // Update statistics
  updateWebhookEventCount(event.event);
  
  // Show notification for important events
  if (event.event === 'workflow_job' || event.event === 'deployment') {
    showNotification(`${event.event}: ${event.action || 'triggered'}`, 'info');
  }
}

// Handle job updates
function handleJobUpdate(update) {
  console.log('Job update:', update);
  
  // Update job in the jobs table
  updateJobRow(update.job);
  
  // Show notification
  const message = `Job ${update.job.name} is ${update.action}`;
  const type = update.action === 'completed' 
    ? (update.job.conclusion === 'success' ? 'success' : 'error')
    : 'info';
  
  showNotification(message, type);
}

// Handle workflow run updates
function handleWorkflowRunUpdate(update) {
  console.log('Workflow run update:', update);
  
  // Update workflow runs display
  updateWorkflowRunDisplay(update);
  
  // Track repository
  if (update.repository?.fullName) {
    state.repositories.add(update.repository.fullName);
  }
}

// Handle workflow job events
function handleWorkflowJob(data) {
  console.log('Workflow job event:', data);
  
  const jobInfo = {
    id: data.job.id,
    name: data.job.name,
    status: data.job.status,
    repository: data.repository.full_name,
    action: data.action,
    labels: data.job.labels
  };
  
  // Update job display
  updateJobDisplay(jobInfo);
  
  // Update active jobs counter
  updateActiveJobsCount(data.action);
}

// Handle push events
function handlePushEvent(data) {
  console.log('Push event:', data);
  
  const eventInfo = {
    type: 'push',
    repository: data.repository.full_name,
    ref: data.ref,
    commits: data.commits,
    timestamp: data.timestamp
  };
  
  addActivityEvent(eventInfo);
}

// Handle pull request events
function handlePullRequestEvent(data) {
  console.log('Pull request event:', data);
  
  const eventInfo = {
    type: 'pull_request',
    action: data.action,
    repository: data.repository.full_name,
    number: data.pullRequest?.number,
    title: data.pullRequest?.title,
    timestamp: data.timestamp
  };
  
  addActivityEvent(eventInfo);
}

// Handle deployment events
function handleDeploymentEvent(data) {
  console.log('Deployment event:', data);
  
  const eventInfo = {
    type: 'deployment',
    action: data.action,
    repository: data.repository.full_name,
    environment: data.deployment?.environment,
    timestamp: data.timestamp
  };
  
  addActivityEvent(eventInfo);
  showNotification(`Deployment ${data.action} for ${data.deployment?.environment}`, 'warning');
}

// Handle security alerts
function handleSecurityAlert(data) {
  console.error('SECURITY ALERT:', data);
  
  // Show prominent notification
  showNotification(`Security Alert: ${data.eventType} in ${data.repository?.full_name}`, 'error', 10000);
  
  // Add to security alerts section
  addSecurityAlert(data);
  
  // Play alert sound if available
  playAlertSound();
}

// Update functions
function updateJobsList(jobs) {
  const jobsTableBody = document.getElementById('jobs-table-body');
  if (!jobsTableBody) return;
  
  jobsTableBody.innerHTML = '';
  
  jobs.forEach(job => {
    const row = createJobRow(job);
    jobsTableBody.appendChild(row);
  });
}

function updateRunnersList(runners) {
  const runnersTableBody = document.getElementById('runners-table-body');
  if (!runnersTableBody) return;
  
  runnersTableBody.innerHTML = '';
  
  runners.forEach(runner => {
    const row = createRunnerRow(runner);
    runnersTableBody.appendChild(row);
  });
}

function updateWebhookStatistics(stats) {
  // Update summary stats
  const summaryEl = document.getElementById('webhook-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="stat-card">
        <h4>Total Events</h4>
        <p class="stat-value">${stats.summary.totalEvents}</p>
      </div>
      <div class="stat-card">
        <h4>Processed</h4>
        <p class="stat-value success">${stats.summary.processedEvents}</p>
      </div>
      <div class="stat-card">
        <h4>Failed</h4>
        <p class="stat-value error">${stats.summary.failedEvents}</p>
      </div>
      <div class="stat-card">
        <h4>Success Rate</h4>
        <p class="stat-value">${stats.summary.successRate}%</p>
      </div>
    `;
  }
  
  // Update event breakdown
  const breakdownEl = document.getElementById('webhook-breakdown');
  if (breakdownEl) {
    breakdownEl.innerHTML = stats.byEvent.map(event => `
      <div class="event-stat">
        <span class="event-type">${event.event}</span>
        <span class="event-count">${event.total}</span>
        <span class="event-avg-time">${Math.round(event.avgProcessingTimeMs)}ms</span>
      </div>
    `).join('');
  }
}

function updateWebhookEventsList(events) {
  const eventsListEl = document.getElementById('webhook-events-list');
  if (!eventsListEl) return;
  
  eventsListEl.innerHTML = '';
  
  events.forEach(event => {
    const eventEl = createWebhookEventElement(event);
    eventsListEl.appendChild(eventEl);
  });
}

// Create elements
function createJobRow(job) {
  const row = document.createElement('tr');
  row.dataset.jobId = job.id;
  
  const statusClass = getStatusClass(job.status);
  const conclusionBadge = job.conclusion 
    ? `<span class="badge ${getConclusionClass(job.conclusion)}">${job.conclusion}</span>`
    : '';
  
  row.innerHTML = `
    <td>${job.id}</td>
    <td>${job.repository || '-'}</td>
    <td>${job.name}</td>
    <td><span class="status ${statusClass}">${job.status}</span></td>
    <td>${conclusionBadge}</td>
    <td>${job.runner_name || '-'}</td>
    <td>${formatDate(job.created_at)}</td>
  `;
  
  return row;
}

function createRunnerRow(runner) {
  const row = document.createElement('tr');
  row.dataset.runnerId = runner.id;
  
  const statusClass = getStatusClass(runner.status);
  
  row.innerHTML = `
    <td>${runner.id}</td>
    <td>${runner.name}</td>
    <td>${runner.type}</td>
    <td><span class="status ${statusClass}">${runner.status}</span></td>
    <td>${runner.current_job_id || '-'}</td>
    <td>${runner.labels?.join(', ') || '-'}</td>
    <td>${formatDate(runner.last_seen)}</td>
  `;
  
  return row;
}

function createWebhookEventElement(event) {
  const div = document.createElement('div');
  div.className = 'webhook-event';
  div.dataset.eventId = event.id;
  
  const processedClass = event.processed ? 'processed' : 'pending';
  const timeAgo = formatTimeAgo(event.timestamp);
  
  div.innerHTML = `
    <div class="event-header">
      <span class="event-type">${event.event}</span>
      ${event.action ? `<span class="event-action">${event.action}</span>` : ''}
      <span class="event-time">${timeAgo}</span>
    </div>
    <div class="event-details">
      <span class="event-repo">${event.repository}</span>
      <span class="event-status ${processedClass}">${processedClass}</span>
      ${event.processingDurationMs ? `<span class="event-duration">${event.processingDurationMs}ms</span>` : ''}
    </div>
  `;
  
  return div;
}

// Helper functions
function getStatusClass(status) {
  const statusClasses = {
    'idle': 'status-idle',
    'busy': 'status-busy',
    'offline': 'status-offline',
    'pending': 'status-pending',
    'running': 'status-running',
    'in_progress': 'status-running',
    'completed': 'status-completed',
    'failed': 'status-failed',
    'queued': 'status-queued'
  };
  
  return statusClasses[status] || 'status-unknown';
}

function getConclusionClass(conclusion) {
  const conclusionClasses = {
    'success': 'badge-success',
    'failure': 'badge-error',
    'cancelled': 'badge-warning',
    'skipped': 'badge-info',
    'timed_out': 'badge-error',
    'action_required': 'badge-warning'
  };
  
  return conclusionClasses[conclusion] || 'badge-default';
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString();
}

function formatTimeAgo(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function showNotification(message, type = 'info', duration = 5000) {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  const container = document.getElementById('notifications') || createNotificationContainer();
  container.appendChild(notification);
  
  // Animate in
  setTimeout(() => notification.classList.add('show'), 10);
  
  // Remove after duration
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, duration);
}

function createNotificationContainer() {
  const container = document.createElement('div');
  container.id = 'notifications';
  container.className = 'notifications-container';
  document.body.appendChild(container);
  return container;
}

function showError(message) {
  showNotification(message, 'error');
}

function updateConnectionStatus(status) {
  const statusEl = document.getElementById('connection-status');
  if (statusEl) {
    statusEl.className = `connection-status ${status}`;
    statusEl.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
  }
}

function addActivityEvent(eventInfo) {
  const activityEl = document.getElementById('activity-feed');
  if (!activityEl) return;
  
  const eventEl = document.createElement('div');
  eventEl.className = 'activity-event';
  eventEl.innerHTML = `
    <span class="event-icon">${getEventIcon(eventInfo.type)}</span>
    <span class="event-desc">${formatEventDescription(eventInfo)}</span>
    <span class="event-time">${formatTimeAgo(eventInfo.timestamp)}</span>
  `;
  
  activityEl.insertBefore(eventEl, activityEl.firstChild);
  
  // Keep only last 20 events
  while (activityEl.children.length > 20) {
    activityEl.lastChild.remove();
  }
}

function getEventIcon(type) {
  const icons = {
    'push': '🔀',
    'pull_request': '🔁',
    'deployment': '🚀',
    'workflow_job': '⚙️',
    'security': '🔒'
  };
  
  return icons[type] || '📌';
}

function formatEventDescription(eventInfo) {
  switch (eventInfo.type) {
    case 'push':
      return `Push to ${eventInfo.ref} in ${eventInfo.repository} (${eventInfo.commits} commits)`;
    case 'pull_request':
      return `PR #${eventInfo.number} ${eventInfo.action} in ${eventInfo.repository}`;
    case 'deployment':
      return `Deployment ${eventInfo.action} to ${eventInfo.environment} in ${eventInfo.repository}`;
    default:
      return `${eventInfo.type} event in ${eventInfo.repository}`;
  }
}

function addSecurityAlert(alert) {
  const alertsEl = document.getElementById('security-alerts');
  if (!alertsEl) return;
  
  const alertEl = document.createElement('div');
  alertEl.className = 'security-alert alert-high';
  alertEl.innerHTML = `
    <div class="alert-header">
      <span class="alert-type">${alert.eventType}</span>
      <span class="alert-time">${formatTimeAgo(alert.timestamp)}</span>
    </div>
    <div class="alert-details">
      <span class="alert-repo">${alert.repository?.full_name}</span>
      ${alert.alert ? `<span class="alert-desc">${alert.alert.summary || alert.alert.message}</span>` : ''}
    </div>
  `;
  
  alertsEl.insertBefore(alertEl, alertsEl.firstChild);
}

function playAlertSound() {
  // Optional: Play an alert sound
  const audio = new Audio('/sounds/alert.mp3');
  audio.play().catch(e => console.log('Could not play alert sound'));
}

function updateMetricsDisplay(metrics) {
  // Update various metric displays
  console.log('Updating metrics:', metrics);
  
  // Update job metrics
  if (metrics.jobs) {
    document.querySelectorAll('[data-metric="jobs.total"]').forEach(el => {
      el.textContent = metrics.jobs.total || 0;
    });
    document.querySelectorAll('[data-metric="jobs.running"]').forEach(el => {
      el.textContent = metrics.jobs.running || 0;
    });
  }
  
  // Update runner metrics
  if (metrics.runners) {
    document.querySelectorAll('[data-metric="runners.total"]').forEach(el => {
      el.textContent = metrics.runners.total || 0;
    });
    document.querySelectorAll('[data-metric="runners.busy"]').forEach(el => {
      el.textContent = metrics.runners.busy || 0;
    });
  }
}

// Setup event listeners
function setupEventListeners() {
  // Repository filter
  const repoFilterEl = document.getElementById('repo-filter');
  if (repoFilterEl) {
    repoFilterEl.addEventListener('change', (e) => {
      const repo = e.target.value;
      if (repo) {
        socket.emit('subscribe:repository', repo);
        state.repositories.add(repo);
      }
    });
  }
  
  // Refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadDashboardData();
      showNotification('Dashboard refreshed', 'success');
    });
  }
  
  // Test webhook button
  const testWebhookBtn = document.getElementById('test-webhook-btn');
  if (testWebhookBtn) {
    testWebhookBtn.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/webhooks/test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            eventType: 'workflow_job',
            repository: 'test/repo',
            action: 'queued'
          })
        });
        
        const result = await response.json();
        if (result.success) {
          showNotification('Test webhook sent successfully', 'success');
        } else {
          showError('Failed to send test webhook');
        }
      } catch (error) {
        console.error('Error sending test webhook:', error);
        showError('Error sending test webhook');
      }
    });
  }
}

// Export for use in other modules
window.dashboard = {
  state,
  socket,
  webhookSocket,
  monitoringSocket,
  refresh: loadDashboardData
};