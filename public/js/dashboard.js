// Dashboard JavaScript
let socket;
let jobTimelineChart;
let runnerDistributionChart;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    initializeSocket();
    initializeCharts();
    loadDashboardData();
    
    // Refresh data every 10 seconds
    setInterval(loadDashboardData, 10000);
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
    // Job Timeline Chart
    const timelineCtx = document.getElementById('jobTimeline').getContext('2d');
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
    
    // Runner Distribution Chart
    const distributionCtx = document.getElementById('runnerDistribution').getContext('2d');
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
    try {
        const response = await fetch('/api/monitoring/dashboard');
        const result = await response.json();
        
        if (result.success) {
            updateDashboard(result.data);
        }
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
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
    const labels = timeline.map((item, index) => {
        const date = new Date(item.hour);
        // Use index-based labels to ensure consistency
        return `${23 - index}h ago`;
    });
    
    const completed = timeline.map(item => parseInt(item.completed) || 0);
    const failed = timeline.map(item => parseInt(item.failed) || 0);
    
    // Clear and reset the chart data completely
    jobTimelineChart.data.labels.length = 0;
    jobTimelineChart.data.labels.push(...labels);
    
    jobTimelineChart.data.datasets[0].data.length = 0;
    jobTimelineChart.data.datasets[0].data.push(...completed);
    
    jobTimelineChart.data.datasets[1].data.length = 0;
    jobTimelineChart.data.datasets[1].data.push(...failed);
    
    jobTimelineChart.update('none'); // Update without animation
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