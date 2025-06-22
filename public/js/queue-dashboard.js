// Queue Dashboard JavaScript
class QueueDashboard {
  constructor() {
    this.updateInterval = 5000; // 5 seconds
    this.charts = {};
    this.isUpdating = false;
  }

  async init() {
    console.log('Initializing Queue Dashboard...');
    
    // Initialize UI components
    this.initializeCharts();
    this.attachEventListeners();
    
    // Start periodic updates
    await this.updateDashboard();
    setInterval(() => this.updateDashboard(), this.updateInterval);
  }

  initializeCharts() {
    // Queue Status Chart
    const statusCtx = document.getElementById('queueStatusChart')?.getContext('2d');
    if (statusCtx) {
      this.charts.status = new Chart(statusCtx, {
        type: 'doughnut',
        data: {
          labels: ['Waiting', 'Active', 'Completed', 'Failed', 'Delayed', 'Paused'],
          datasets: [{
            data: [0, 0, 0, 0, 0, 0],
            backgroundColor: [
              '#FFA500', // Orange for waiting
              '#4CAF50', // Green for active
              '#2196F3', // Blue for completed
              '#F44336', // Red for failed
              '#FF9800', // Amber for delayed
              '#9E9E9E'  // Grey for paused
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

    // Queue Throughput Chart
    const throughputCtx = document.getElementById('throughputChart')?.getContext('2d');
    if (throughputCtx) {
      this.charts.throughput = new Chart(throughputCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Jobs/minute',
            data: [],
            borderColor: '#4CAF50',
            backgroundColor: 'rgba(76, 175, 80, 0.1)',
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true
            }
          },
          plugins: {
            legend: {
              display: false
            }
          }
        }
      });
    }

    // Queue Distribution Chart
    const distributionCtx = document.getElementById('queueDistributionChart')?.getContext('2d');
    if (distributionCtx) {
      this.charts.distribution = new Chart(distributionCtx, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            label: 'Jobs',
            data: [],
            backgroundColor: '#2196F3'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true
            }
          }
        }
      });
    }
  }

  attachEventListeners() {
    // Queue action buttons
    document.querySelectorAll('.queue-action').forEach(button => {
      button.addEventListener('click', (e) => this.handleQueueAction(e));
    });

    // Job retry buttons
    document.querySelectorAll('.retry-job').forEach(button => {
      button.addEventListener('click', (e) => this.handleJobRetry(e));
    });

    // Refresh button
    document.getElementById('refreshDashboard')?.addEventListener('click', () => {
      this.updateDashboard();
    });

    // Auto-refresh toggle
    document.getElementById('autoRefresh')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.startAutoRefresh();
      } else {
        this.stopAutoRefresh();
      }
    });
  }

  async updateDashboard() {
    if (this.isUpdating) return;
    
    this.isUpdating = true;
    try {
      // Update queue statistics
      const stats = await this.fetchQueueStats();
      this.updateQueueStats(stats);
      
      // Update charts
      this.updateCharts(stats);
      
      // Update job lists
      await this.updateJobLists();
      
      // Update timestamp
      this.updateTimestamp();
    } catch (error) {
      console.error('Error updating dashboard:', error);
      this.showError('Failed to update dashboard');
    } finally {
      this.isUpdating = false;
    }
  }

  async fetchQueueStats() {
    const response = await fetch('/api/queues/stats', {
      headers: {
        'Authorization': `Bearer ${this.getAuthToken()}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch queue statistics');
    }
    
    const data = await response.json();
    return data.stats;
  }

  updateQueueStats(stats) {
    // Update summary cards
    let totalJobs = 0;
    let activeJobs = 0;
    let failedJobs = 0;
    let completedJobs = 0;

    Object.values(stats).forEach(queueStats => {
      totalJobs += queueStats.total;
      activeJobs += queueStats.active;
      failedJobs += queueStats.failed;
      completedJobs += queueStats.completed;
    });

    document.getElementById('totalJobs').textContent = totalJobs.toLocaleString();
    document.getElementById('activeJobs').textContent = activeJobs.toLocaleString();
    document.getElementById('failedJobs').textContent = failedJobs.toLocaleString();
    document.getElementById('completedJobs').textContent = completedJobs.toLocaleString();

    // Update individual queue cards
    Object.entries(stats).forEach(([queueName, queueStats]) => {
      this.updateQueueCard(queueName, queueStats);
    });
  }

  updateQueueCard(queueName, stats) {
    const card = document.querySelector(`[data-queue="${queueName}"]`);
    if (!card) return;

    card.querySelector('.queue-waiting').textContent = stats.waiting;
    card.querySelector('.queue-active').textContent = stats.active;
    card.querySelector('.queue-completed').textContent = stats.completed;
    card.querySelector('.queue-failed').textContent = stats.failed;

    // Update status indicator
    const statusIndicator = card.querySelector('.queue-status');
    if (stats.paused > 0) {
      statusIndicator.className = 'queue-status paused';
      statusIndicator.textContent = 'Paused';
    } else if (stats.active > 0) {
      statusIndicator.className = 'queue-status active';
      statusIndicator.textContent = 'Active';
    } else {
      statusIndicator.className = 'queue-status idle';
      statusIndicator.textContent = 'Idle';
    }
  }

  updateCharts(stats) {
    // Update status chart
    if (this.charts.status) {
      let waiting = 0, active = 0, completed = 0, failed = 0, delayed = 0, paused = 0;
      
      Object.values(stats).forEach(queueStats => {
        waiting += queueStats.waiting;
        active += queueStats.active;
        completed += queueStats.completed;
        failed += queueStats.failed;
        delayed += queueStats.delayed;
        paused += queueStats.paused;
      });

      this.charts.status.data.datasets[0].data = [waiting, active, completed, failed, delayed, paused];
      this.charts.status.update();
    }

    // Update distribution chart
    if (this.charts.distribution) {
      const labels = Object.keys(stats);
      const data = labels.map(queue => stats[queue].total);

      this.charts.distribution.data.labels = labels;
      this.charts.distribution.data.datasets[0].data = data;
      this.charts.distribution.update();
    }

    // Update throughput chart (add new data point)
    if (this.charts.throughput) {
      const now = new Date().toLocaleTimeString();
      const throughput = this.calculateThroughput(stats);

      this.charts.throughput.data.labels.push(now);
      this.charts.throughput.data.datasets[0].data.push(throughput);

      // Keep only last 20 data points
      if (this.charts.throughput.data.labels.length > 20) {
        this.charts.throughput.data.labels.shift();
        this.charts.throughput.data.datasets[0].data.shift();
      }

      this.charts.throughput.update();
    }
  }

  calculateThroughput(stats) {
    // Calculate jobs processed per minute (simplified)
    let completed = 0;
    Object.values(stats).forEach(queueStats => {
      completed += queueStats.completed;
    });
    
    // This is a simplified calculation - in real implementation,
    // you'd track the delta between updates
    return Math.round(completed / 60);
  }

  async updateJobLists() {
    // Update failed jobs list
    await this.updateFailedJobs();
    
    // Update active jobs list
    await this.updateActiveJobs();
  }

  async updateFailedJobs() {
    try {
      const response = await fetch('/api/queues/jobs?state=failed&limit=10', {
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`
        }
      });

      if (!response.ok) return;

      const data = await response.json();
      const container = document.getElementById('failedJobsList');
      if (!container) return;

      container.innerHTML = data.jobs.map(job => `
        <div class="job-item failed">
          <div class="job-info">
            <span class="job-id">${job.id}</span>
            <span class="job-type">${job.type}</span>
            <span class="job-queue">${job.queue}</span>
          </div>
          <div class="job-error">${job.failedReason || 'Unknown error'}</div>
          <div class="job-actions">
            <button class="btn btn-sm btn-warning retry-job" data-job-id="${job.id}" data-queue="${job.queue}">
              Retry
            </button>
          </div>
        </div>
      `).join('');

      // Re-attach event listeners for retry buttons
      container.querySelectorAll('.retry-job').forEach(button => {
        button.addEventListener('click', (e) => this.handleJobRetry(e));
      });
    } catch (error) {
      console.error('Error updating failed jobs:', error);
    }
  }

  async updateActiveJobs() {
    try {
      const response = await fetch('/api/queues/jobs?state=active&limit=10', {
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`
        }
      });

      if (!response.ok) return;

      const data = await response.json();
      const container = document.getElementById('activeJobsList');
      if (!container) return;

      container.innerHTML = data.jobs.map(job => `
        <div class="job-item active">
          <div class="job-info">
            <span class="job-id">${job.id}</span>
            <span class="job-type">${job.type}</span>
            <span class="job-queue">${job.queue}</span>
          </div>
          <div class="job-progress">
            <div class="progress">
              <div class="progress-bar" style="width: ${job.progress || 0}%">
                ${job.progress || 0}%
              </div>
            </div>
          </div>
        </div>
      `).join('');
    } catch (error) {
      console.error('Error updating active jobs:', error);
    }
  }

  async handleQueueAction(event) {
    const button = event.target;
    const action = button.dataset.action;
    const queue = button.dataset.queue;

    try {
      button.disabled = true;
      
      const response = await fetch(`/api/queues/${queue}/${action}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        this.showSuccess(`Queue ${queue} ${action}d successfully`);
        await this.updateDashboard();
      } else {
        throw new Error('Action failed');
      }
    } catch (error) {
      this.showError(`Failed to ${action} queue ${queue}`);
    } finally {
      button.disabled = false;
    }
  }

  async handleJobRetry(event) {
    const button = event.target;
    const jobId = button.dataset.jobId;
    const queue = button.dataset.queue;

    try {
      button.disabled = true;
      
      const response = await fetch(`/api/queues/jobs/${jobId}/retry`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ queue })
      });

      if (response.ok) {
        this.showSuccess('Job queued for retry');
        await this.updateDashboard();
      } else {
        throw new Error('Retry failed');
      }
    } catch (error) {
      this.showError('Failed to retry job');
    } finally {
      button.disabled = false;
    }
  }

  updateTimestamp() {
    const timestamp = document.getElementById('lastUpdated');
    if (timestamp) {
      timestamp.textContent = new Date().toLocaleString();
    }
  }

  startAutoRefresh() {
    if (this.refreshInterval) return;
    
    this.refreshInterval = setInterval(() => {
      this.updateDashboard();
    }, this.updateInterval);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.classList.add('show');
    }, 100);
    
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 3000);
  }

  getAuthToken() {
    return localStorage.getItem('authToken') || '';
  }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const dashboard = new QueueDashboard();
  dashboard.init();
  
  // Export to global scope for debugging
  window.queueDashboard = dashboard;
});