// Dashboard JavaScript
let socket;
let jobTimelineChart;
let runnerDistributionChart;

// Initialize dashboard
let isLoading = false;
let refreshInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    initializeSocket();
    initializeCharts();
    loadDashboardData();
    
    // Clear any existing interval
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    
    // Refresh data every 30 seconds (increased from 10)
    refreshInterval = setInterval(() => {
        if (!isLoading) {
            loadDashboardData();
        }
    }, 30000);
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
    
    jobs.forEach(job => {
        const row = document.createElement('tr');
        
        const duration = job.completedAt && job.startedAt
            ? ((new Date(job.completedAt) - new Date(job.startedAt)) / 1000).toFixed(0) + 's'
            : '-';
        
        const statusClass = {
            'completed': 'text-green-600',
            'failed': 'text-red-600',
            'running': 'text-blue-600',
            'pending': 'text-yellow-600'
        }[job.status] || 'text-gray-600';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                ${job.workflow || 'Unknown'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${job.repository || '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="text-sm ${statusClass}">${job.status}</span>
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
    
    runners.forEach(runner => {
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