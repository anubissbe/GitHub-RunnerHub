// Dashboard JavaScript
let socket;
let jobTimelineChart;
let runnerDistributionChart;
let trackedRepositories = [];

// Initialize dashboard
let isLoading = false;
let refreshInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    initializeSocket();
    initializeCharts();
    loadTrackedRepositories();
    loadDashboardData();
    
    // Clear any existing interval
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    
    // Auto-refresh every 10 seconds for real-time updates
    refreshInterval = setInterval(() => {
        if (!isLoading) {
            loadDashboardData();
        }
    }, 10000); // 10 seconds
    
    // Add visual refresh indicator
    addRefreshIndicator();
});

// Initialize WebSocket connection
function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to WebSocket');
    });
    
    socket.on('metrics', (metrics) => {
        updateSystemMetrics(metrics);
    });
    
    socket.on('job-event', (event) => {
        console.log('Job event:', event);
        // Could add real-time job updates here
    });
    
    socket.on('scaling-event', (event) => {
        console.log('Scaling event:', event);
        // Could show scaling notifications
    });
}

// Initialize charts
function initializeCharts() {
    // Destroy existing charts if they exist
    if (jobTimelineChart) {
        jobTimelineChart.destroy();
        jobTimelineChart = null;
    }
    if (runnerDistributionChart) {
        runnerDistributionChart.destroy();
        runnerDistributionChart = null;
    }
    
    // Fix canvas container height
    const timelineCanvas = document.getElementById('jobTimeline');
    const timelineContainer = timelineCanvas.parentElement;
    timelineContainer.style.position = 'relative';
    timelineContainer.style.height = '300px';
    
    // Job Timeline Chart
    const timelineCtx = timelineCanvas.getContext('2d');
    jobTimelineChart = new Chart(timelineCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Completed',
                    data: [],
                    borderColor: 'rgb(34, 197, 94)',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    tension: 0.4
                },
                {
                    label: 'Failed',
                    data: [],
                    borderColor: 'rgb(239, 68, 68)',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
    
    // Fix runner distribution container height
    const distributionCanvas = document.getElementById('runnerDistribution');
    const distributionContainer = distributionCanvas.parentElement;
    distributionContainer.style.position = 'relative';
    distributionContainer.style.height = '300px';
    
    // Runner Distribution Chart
    const distributionCtx = distributionCanvas.getContext('2d');
    runnerDistributionChart = new Chart(distributionCtx, {
        type: 'doughnut',
        data: {
            labels: ['Idle', 'Busy', 'Offline'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: [
                    'rgb(34, 197, 94)',
                    'rgb(59, 130, 246)',
                    'rgb(156, 163, 175)'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// Load dashboard data
async function loadDashboardData() {
    if (isLoading) return;
    
    isLoading = true;
    try {
        const response = await fetch('/api/monitoring/dashboard');
        const result = await response.json();
        
        if (result.success) {
            updateDashboard(result.data);
        }
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
    } finally {
        isLoading = false;
    }
}

// Update dashboard with new data
function updateDashboard(data) {
    // Update system metrics
    updateSystemMetrics(data.system);
    
    // Update job timeline
    updateJobTimeline(data.timeline);
    
    // Update recent jobs
    updateRecentJobs(data.recentJobs);
    
    // Update runner health
    updateRunnerHealth(data.runnerHealth);
    
    // Update GitHub integration status
    if (data.githubIntegration) {
        updateGitHubStatus(data.githubIntegration);
    }
    
    // Update last updated time
    document.getElementById('lastUpdated').textContent = new Date(data.lastUpdated).toLocaleString();
}

// Update system metrics
function updateSystemMetrics(metrics) {
    document.getElementById('totalJobs').textContent = metrics.jobs.total;
    document.getElementById('completedJobs').textContent = metrics.jobs.completed;
    document.getElementById('failedJobs').textContent = metrics.jobs.failed;
    
    document.getElementById('activeRunners').textContent = metrics.runners.busy;
    document.getElementById('totalRunners').textContent = metrics.runners.total;
    
    document.getElementById('avgWaitTime').textContent = metrics.jobs.averageWaitTime.toFixed(1);
    document.getElementById('avgUtilization').textContent = (metrics.pools.averageUtilization * 100).toFixed(0) + '%';
    document.getElementById('scalingEvents').textContent = metrics.pools.scalingEvents;
    
    // Update runner distribution chart
    runnerDistributionChart.data.datasets[0].data = [
        metrics.runners.idle,
        metrics.runners.busy,
        metrics.runners.offline
    ];
    runnerDistributionChart.update();
}

// Update job timeline
function updateJobTimeline(timeline) {
    if (!timeline || timeline.length === 0) return;
    
    // Don't recreate the chart, just update the data
    if (!jobTimelineChart) return;
    
    // Ensure we have exactly 24 data points
    const timelineData = timeline.slice(0, 24);
    
    // Generate consistent labels
    const labels = [];
    for (let i = 23; i >= 0; i--) {
        labels.push(`-${i}h`);
    }
    
    const completed = timelineData.map(item => parseInt(item.completed) || 0);
    const failed = timelineData.map(item => parseInt(item.failed) || 0);
    
    // Update the existing chart data
    jobTimelineChart.data.labels = labels;
    jobTimelineChart.data.datasets[0].data = completed;
    jobTimelineChart.data.datasets[1].data = failed;
    jobTimelineChart.update('none');
}

// Update recent jobs table
function updateRecentJobs(jobs) {
    const tbody = document.getElementById('recentJobsTable');
    tbody.innerHTML = '';
    
    if (jobs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500">
                    No recent jobs found. Jobs will appear here once GitHub Actions workflows are triggered.
                </td>
            </tr>
        `;
        return;
    }
    
    jobs.forEach(job => {
        const row = document.createElement('tr');
        
        const duration = job.completedAt && job.startedAt
            ? ((new Date(job.completedAt) - new Date(job.startedAt)) / 1000).toFixed(0) + 's'
            : job.startedAt ? 'Running...' : 'Queued';
        
        const statusClass = {
            'completed': 'text-green-600',
            'failed': 'text-red-600',
            'running': 'text-blue-600',
            'in_progress': 'text-blue-600',
            'pending': 'text-yellow-600',
            'queued': 'text-yellow-600'
        }[job.status] || 'text-gray-600';
        
        const statusIcon = {
            'completed': '✓',
            'failed': '✗',
            'running': '⟳',
            'in_progress': '⟳',
            'pending': '○',
            'queued': '○'
        }[job.status] || '?';
        
        // Extract repository from job data or use provided repository
        const repoMatch = job.repository && job.repository.includes('/') ? job.repository : 
                         job.id && job.id.startsWith('github-') ? 'GitHub Job' : 'Local Job';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm font-medium text-gray-900">${job.workflow || job.name || 'Unknown'}</div>
                ${job.labels && job.labels.length > 0 ? 
                    `<div class="text-xs text-gray-500 mt-1">Labels: ${job.labels.slice(0, 3).join(', ')}</div>` : 
                    ''}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm text-gray-900">${repoMatch}</div>
                ${job.head_branch ? `<div class="text-xs text-gray-500">${job.head_branch}</div>` : ''}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="text-sm ${statusClass}">
                    <span class="inline-block">${statusIcon}</span>
                    ${job.status}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${duration}
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// Update runner health table
function updateRunnerHealth(runners) {
    const tbody = document.getElementById('runnerHealthTable');
    tbody.innerHTML = '';
    
    // Only show real GitHub runners (filter out any remaining mock data)
    const githubRunners = runners.filter(runner => 
        runner.id && runner.id.startsWith('github-')
    );
    
    if (githubRunners.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500">
                    No GitHub runners found. Deploy runners using the setup scripts.
                </td>
            </tr>
        `;
        return;
    }
    
    githubRunners.forEach(runner => {
        const row = document.createElement('tr');
        
        const healthClass = `status-${runner.healthStatus}`;
        const healthIcon = {
            'healthy': '✓',
            'warning': '!',
            'critical': '✗',
            'offline': '○'
        }[runner.healthStatus] || '?';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                ${runner.name}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${runner.type}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${runner.status}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="text-sm font-bold ${healthClass}">${healthIcon} ${runner.healthStatus}</span>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// Add refresh indicator function
function addRefreshIndicator() {
    const lastUpdatedElement = document.getElementById('lastUpdated');
    if (!lastUpdatedElement) return;
    
    // Add refresh countdown
    const parent = lastUpdatedElement.parentElement;
    const refreshIndicator = document.createElement('span');
    refreshIndicator.id = 'refreshIndicator';
    refreshIndicator.className = 'ml-4 text-sm text-gray-500';
    parent.appendChild(refreshIndicator);
    
    // Update countdown every second
    let countdown = 10;
    const updateCountdown = () => {
        if (isLoading) {
            refreshIndicator.innerHTML = '<span class="text-blue-600">⟳ Refreshing...</span>';
        } else {
            refreshIndicator.innerHTML = `<span class="text-gray-400">⟳ Auto-refresh in ${countdown}s</span>`;
            countdown--;
            if (countdown < 0) countdown = 10;
        }
    };
    
    updateCountdown();
    setInterval(updateCountdown, 1000);
}

// Load tracked repositories
async function loadTrackedRepositories() {
    try {
        const response = await fetch('/api/monitoring/repositories');
        const result = await response.json();
        
        if (result.success) {
            trackedRepositories = result.data;
            updateRepositoryList();
        }
    } catch (error) {
        console.error('Failed to load tracked repositories:', error);
    }
}

// Update repository list UI
function updateRepositoryList() {
    const listElement = document.getElementById('repositoryList');
    listElement.innerHTML = '';
    
    if (trackedRepositories.length === 0) {
        listElement.innerHTML = '<span class="text-gray-500 text-sm">No repositories tracked. Add one to get started.</span>';
        return;
    }
    
    trackedRepositories.forEach(repo => {
        const tag = document.createElement('div');
        tag.className = 'inline-flex items-center bg-blue-100 text-blue-800 text-sm px-3 py-1 rounded-full';
        tag.innerHTML = `
            <span>${repo}</span>
            <button onclick="removeRepository('${repo}')" class="ml-2 text-blue-600 hover:text-blue-800">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        `;
        listElement.appendChild(tag);
    });
}

// Add repository
async function addRepository() {
    const input = document.getElementById('newRepository');
    const repository = input.value.trim();
    
    if (!repository || !repository.includes('/')) {
        alert('Please enter a valid repository in the format: owner/repo');
        return;
    }
    
    try {
        const response = await fetch('/api/monitoring/repositories', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ repository })
        });
        
        const result = await response.json();
        
        if (result.success) {
            trackedRepositories.push(repository);
            updateRepositoryList();
            input.value = '';
            
            // Reload dashboard data
            loadDashboardData();
        } else {
            alert(result.message || 'Failed to add repository');
        }
    } catch (error) {
        console.error('Failed to add repository:', error);
        alert('Failed to add repository');
    }
}

// Remove repository
async function removeRepository(repository) {
    if (!confirm(`Remove ${repository} from tracking?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/monitoring/repositories/${repository.replace('/', '_')}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            trackedRepositories = trackedRepositories.filter(r => r !== repository);
            updateRepositoryList();
            
            // Reload dashboard data
            loadDashboardData();
        } else {
            alert(result.message || 'Failed to remove repository');
        }
    } catch (error) {
        console.error('Failed to remove repository:', error);
        alert('Failed to remove repository');
    }
}

// Update GitHub status
function updateGitHubStatus(integration) {
    const statusElement = document.getElementById('githubStatus');
    const rateLimitElement = document.getElementById('rateLimitInfo');
    
    if (integration.enabled) {
        const percentUsed = (integration.rateLimitStatus.used / integration.rateLimitStatus.limit) * 100;
        let statusColor = 'bg-green-500';
        let statusText = 'Connected';
        
        if (percentUsed > 80) {
            statusColor = 'bg-red-500';
            statusText = 'Rate Limited';
        } else if (percentUsed > 60) {
            statusColor = 'bg-yellow-500';
            statusText = 'Limited';
        }
        
        statusElement.innerHTML = `
            <span class="inline-block w-2 h-2 ${statusColor} rounded-full mr-1"></span>
            ${statusText}
        `;
        
        rateLimitElement.textContent = `${integration.rateLimitStatus.remaining}/${integration.rateLimitStatus.limit} (${Math.round(percentUsed)}% used)`;
    } else {
        statusElement.innerHTML = `
            <span class="inline-block w-2 h-2 bg-gray-400 rounded-full mr-1"></span>
            Disconnected
        `;
        rateLimitElement.textContent = 'N/A';
    }
}