/**
 * Grafana Dashboards Management System
 * Comprehensive dashboard provisioning and management for GitHub-RunnerHub monitoring
 */

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

class GrafanaDashboards {
  constructor(options = {}) {
    this.config = {
      // Grafana connection
      grafana: {
        url: options.grafanaUrl || process.env.GRAFANA_URL || 'http://localhost:3000',
        username: options.grafanaUsername || process.env.GRAFANA_USERNAME || 'admin',
        password: options.grafanaPassword || process.env.GRAFANA_PASSWORD || 'admin',
        orgId: options.grafanaOrgId || 1
      },
      
      // Dashboard configuration
      dashboards: {
        outputDir: options.outputDir || './grafana-dashboards',
        autoImport: options.autoImport !== false,
        updateExisting: options.updateExisting !== false,
        createFolders: options.createFolders !== false
      },
      
      // Data source configuration
      dataSources: {
        prometheus: {
          name: options.prometheusName || 'Prometheus',
          url: options.prometheusUrl || process.env.PROMETHEUS_URL || 'http://localhost:9090',
          type: 'prometheus',
          access: 'proxy'
        }
      },
      
      ...options
    };
    
    // Dashboard definitions storage
    this.dashboardConfigs = new Map();
    this.folders = new Map();
    
    // Grafana API client
    this.grafanaAPI = axios.create({
      baseURL: this.config.grafana.url,
      auth: {
        username: this.config.grafana.username,
        password: this.config.grafana.password
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Initialize Grafana dashboards
   */
  async initialize() {
    try {
      logger.info('Initializing Grafana Dashboards');
      
      // Create output directory
      await fs.mkdir(this.config.dashboards.outputDir, { recursive: true });
      
      // Test Grafana connection
      await this.testGrafanaConnection();
      
      // Setup data sources
      await this.setupDataSources();
      
      // Create folders
      if (this.config.dashboards.createFolders) {
        await this.createFolders();
      }
      
      // Generate dashboard configurations
      this.generateDashboardConfigs();
      
      // Create dashboard files
      await this.createDashboardFiles();
      
      // Import dashboards to Grafana
      if (this.config.dashboards.autoImport) {
        await this.importDashboards();
      }
      
      logger.info('Grafana Dashboards initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Grafana Dashboards:', error);
      throw error;
    }
  }

  /**
   * Test Grafana connection
   */
  async testGrafanaConnection() {
    try {
      const response = await this.grafanaAPI.get('/api/health');
      logger.info('Grafana connection successful:', response.data);
      return true;
    } catch (error) {
      logger.error('Grafana connection failed:', error.message);
      throw new Error(`Cannot connect to Grafana at ${this.config.grafana.url}`);
    }
  }

  /**
   * Setup data sources
   */
  async setupDataSources() {
    try {
      // Check if Prometheus data source exists
      const existingDataSources = await this.grafanaAPI.get('/api/datasources');
      const prometheusExists = existingDataSources.data.some(
        ds => ds.name === this.config.dataSources.prometheus.name
      );
      
      if (!prometheusExists) {
        // Create Prometheus data source
        await this.grafanaAPI.post('/api/datasources', {
          name: this.config.dataSources.prometheus.name,
          type: this.config.dataSources.prometheus.type,
          url: this.config.dataSources.prometheus.url,
          access: this.config.dataSources.prometheus.access,
          isDefault: true
        });
        
        logger.info('Created Prometheus data source');
      } else {
        logger.info('Prometheus data source already exists');
      }
      
    } catch (error) {
      logger.error('Failed to setup data sources:', error);
      throw error;
    }
  }

  /**
   * Create folders for organizing dashboards
   */
  async createFolders() {
    const folderDefinitions = [
      { title: 'GitHub RunnerHub', uid: 'github-runnerhub' },
      { title: 'System Monitoring', uid: 'system-monitoring' },
      { title: 'Application Metrics', uid: 'application-metrics' },
      { title: 'Business Intelligence', uid: 'business-intelligence' },
      { title: 'Security Monitoring', uid: 'security-monitoring' }
    ];
    
    for (const folder of folderDefinitions) {
      try {
        const response = await this.grafanaAPI.post('/api/folders', folder);
        this.folders.set(folder.uid, response.data);
        logger.info(`Created folder: ${folder.title}`);
      } catch (error) {
        if (error.response?.data?.message?.includes('already exists')) {
          logger.info(`Folder already exists: ${folder.title}`);
        } else {
          logger.error(`Failed to create folder ${folder.title}:`, error.message);
        }
      }
    }
  }

  /**
   * Generate dashboard configurations
   */
  generateDashboardConfigs() {
    // System Overview Dashboard
    this.dashboardConfigs.set('system-overview', {
      dashboard: this.createSystemOverviewDashboard(),
      folderId: this.folders.get('system-monitoring')?.id || null,
      filename: 'system-overview.json'
    });
    
    // Application Performance Dashboard
    this.dashboardConfigs.set('application-performance', {
      dashboard: this.createApplicationPerformanceDashboard(),
      folderId: this.folders.get('application-metrics')?.id || null,
      filename: 'application-performance.json'
    });
    
    // GitHub Actions Dashboard
    this.dashboardConfigs.set('github-actions', {
      dashboard: this.createGitHubActionsDashboard(),
      folderId: this.folders.get('business-intelligence')?.id || null,
      filename: 'github-actions.json'
    });
    
    // Container Orchestration Dashboard
    this.dashboardConfigs.set('container-orchestration', {
      dashboard: this.createContainerOrchestrationDashboard(),
      folderId: this.folders.get('github-runnerhub')?.id || null,
      filename: 'container-orchestration.json'
    });
    
    // Security Monitoring Dashboard
    this.dashboardConfigs.set('security-monitoring', {
      dashboard: this.createSecurityMonitoringDashboard(),
      folderId: this.folders.get('security-monitoring')?.id || null,
      filename: 'security-monitoring.json'
    });
    
    // Real-time Operations Dashboard
    this.dashboardConfigs.set('realtime-operations', {
      dashboard: this.createRealtimeOperationsDashboard(),
      folderId: this.folders.get('github-runnerhub')?.id || null,
      filename: 'realtime-operations.json'
    });
  }

  /**
   * Create System Overview Dashboard
   */
  createSystemOverviewDashboard() {
    return {
      id: null,
      title: 'System Overview',
      tags: ['system', 'overview'],
      timezone: 'browser',
      refresh: '30s',
      time: {
        from: 'now-1h',
        to: 'now'
      },
      panels: [
        {
          id: 1,
          title: 'CPU Usage',
          type: 'stat',
          targets: [
            {
              expr: '100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
              legendFormat: 'CPU Usage %'
            }
          ],
          fieldConfig: {
            defaults: {
              unit: 'percent',
              min: 0,
              max: 100,
              thresholds: {
                steps: [
                  { color: 'green', value: 0 },
                  { color: 'yellow', value: 70 },
                  { color: 'red', value: 90 }
                ]
              }
            }
          },
          gridPos: { h: 8, w: 6, x: 0, y: 0 }
        },
        {
          id: 2,
          title: 'Memory Usage',
          type: 'stat',
          targets: [
            {
              expr: '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100',
              legendFormat: 'Memory Usage %'
            }
          ],
          fieldConfig: {
            defaults: {
              unit: 'percent',
              min: 0,
              max: 100,
              thresholds: {
                steps: [
                  { color: 'green', value: 0 },
                  { color: 'yellow', value: 80 },
                  { color: 'red', value: 95 }
                ]
              }
            }
          },
          gridPos: { h: 8, w: 6, x: 6, y: 0 }
        },
        {
          id: 3,
          title: 'Load Average',
          type: 'graph',
          targets: [
            {
              expr: 'system_load_average{period="1m"}',
              legendFormat: '1m load avg'
            },
            {
              expr: 'system_load_average{period="5m"}',
              legendFormat: '5m load avg'
            },
            {
              expr: 'system_load_average{period="15m"}',
              legendFormat: '15m load avg'
            }
          ],
          gridPos: { h: 8, w: 12, x: 12, y: 0 }
        },
        {
          id: 4,
          title: 'Network I/O',
          type: 'graph',
          targets: [
            {
              expr: 'rate(system_network_io_bytes_total[5m])',
              legendFormat: '{{interface}} - {{direction}}'
            }
          ],
          yAxes: [
            {
              unit: 'binBps'
            }
          ],
          gridPos: { h: 8, w: 12, x: 0, y: 8 }
        },
        {
          id: 5,
          title: 'System Uptime',
          type: 'stat',
          targets: [
            {
              expr: 'system_uptime_seconds',
              legendFormat: 'Uptime'
            }
          ],
          fieldConfig: {
            defaults: {
              unit: 's'
            }
          },
          gridPos: { h: 8, w: 12, x: 12, y: 8 }
        }
      ]
    };
  }

  /**
   * Create Application Performance Dashboard
   */
  createApplicationPerformanceDashboard() {
    return {
      id: null,
      title: 'Application Performance',
      tags: ['application', 'performance'],
      timezone: 'browser',
      refresh: '15s',
      time: {
        from: 'now-1h',
        to: 'now'
      },
      panels: [
        {
          id: 1,
          title: 'HTTP Request Rate',
          type: 'graph',
          targets: [
            {
              expr: 'rate(http_requests_total[5m])',
              legendFormat: '{{method}} {{route}} - {{status_code}}'
            }
          ],
          yAxes: [
            {
              unit: 'reqps'
            }
          ],
          gridPos: { h: 8, w: 12, x: 0, y: 0 }
        },
        {
          id: 2,
          title: 'HTTP Response Time',
          type: 'graph',
          targets: [
            {
              expr: 'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))',
              legendFormat: '95th percentile'
            },
            {
              expr: 'histogram_quantile(0.50, rate(http_request_duration_seconds_bucket[5m]))',
              legendFormat: '50th percentile'
            }
          ],
          yAxes: [
            {
              unit: 's'
            }
          ],
          gridPos: { h: 8, w: 12, x: 12, y: 0 }
        },
        {
          id: 3,
          title: 'Database Query Performance',
          type: 'graph',
          targets: [
            {
              expr: 'rate(database_queries_total[5m])',
              legendFormat: '{{database}} - {{operation}} - {{status}}'
            }
          ],
          gridPos: { h: 8, w: 12, x: 0, y: 8 }
        },
        {
          id: 4,
          title: 'Cache Hit Ratio',
          type: 'stat',
          targets: [
            {
              expr: 'cache_hit_ratio',
              legendFormat: '{{cache_type}}'
            }
          ],
          fieldConfig: {
            defaults: {
              unit: 'percent',
              min: 0,
              max: 100,
              thresholds: {
                steps: [
                  { color: 'red', value: 0 },
                  { color: 'yellow', value: 70 },
                  { color: 'green', value: 90 }
                ]
              }
            }
          },
          gridPos: { h: 8, w: 12, x: 12, y: 8 }
        },
        {
          id: 5,
          title: 'Active WebSocket Connections',
          type: 'stat',
          targets: [
            {
              expr: 'websocket_connections_active',
              legendFormat: 'WebSocket Connections'
            }
          ],
          gridPos: { h: 4, w: 6, x: 0, y: 16 }
        },
        {
          id: 6,
          title: 'Database Connections',
          type: 'stat',
          targets: [
            {
              expr: 'database_connections_active',
              legendFormat: '{{database}} - {{state}}'
            }
          ],
          gridPos: { h: 4, w: 6, x: 6, y: 16 }
        }
      ]
    };
  }

  /**
   * Create GitHub Actions Dashboard
   */
  createGitHubActionsDashboard() {
    return {
      id: null,
      title: 'GitHub Actions',
      tags: ['github', 'actions', 'business'],
      timezone: 'browser',
      refresh: '30s',
      time: {
        from: 'now-6h',
        to: 'now'
      },
      panels: [
        {
          id: 1,
          title: 'Job Completion Rate',
          type: 'stat',
          targets: [
            {
              expr: 'rate(github_jobs_total{status="completed"}[5m]) / rate(github_jobs_total[5m]) * 100',
              legendFormat: 'Success Rate %'
            }
          ],
          fieldConfig: {
            defaults: {
              unit: 'percent',
              min: 0,
              max: 100,
              thresholds: {
                steps: [
                  { color: 'red', value: 0 },
                  { color: 'yellow', value: 80 },
                  { color: 'green', value: 95 }
                ]
              }
            }
          },
          gridPos: { h: 8, w: 6, x: 0, y: 0 }
        },
        {
          id: 2,
          title: 'Active Jobs',
          type: 'stat',
          targets: [
            {
              expr: 'github_jobs_active',
              legendFormat: '{{repository}} - {{runner_type}}'
            }
          ],
          gridPos: { h: 8, w: 6, x: 6, y: 0 }
        },
        {
          id: 3,
          title: 'Job Duration Distribution',
          type: 'graph',
          targets: [
            {
              expr: 'histogram_quantile(0.95, rate(github_job_duration_seconds_bucket[5m]))',
              legendFormat: '95th percentile'
            },
            {
              expr: 'histogram_quantile(0.50, rate(github_job_duration_seconds_bucket[5m]))',
              legendFormat: 'Median'
            }
          ],
          yAxes: [
            {
              unit: 's'
            }
          ],
          gridPos: { h: 8, w: 12, x: 12, y: 0 }
        },
        {
          id: 4,
          title: 'Job Queue Size',
          type: 'graph',
          targets: [
            {
              expr: 'github_job_queue_size',
              legendFormat: '{{priority}} priority'
            }
          ],
          gridPos: { h: 8, w: 12, x: 0, y: 8 }
        },
        {
          id: 5,
          title: 'Runner Utilization',
          type: 'graph',
          targets: [
            {
              expr: 'github_runner_utilization_percent',
              legendFormat: '{{runner_id}} - {{type}}'
            }
          ],
          yAxes: [
            {
              unit: 'percent',
              min: 0,
              max: 100
            }
          ],
          gridPos: { h: 8, w: 12, x: 12, y: 8 }
        },
        {
          id: 6,
          title: 'GitHub API Rate Limit',
          type: 'stat',
          targets: [
            {
              expr: 'github_api_rate_limit_remaining',
              legendFormat: 'Remaining API Calls'
            }
          ],
          fieldConfig: {
            defaults: {
              thresholds: {
                steps: [
                  { color: 'red', value: 0 },
                  { color: 'yellow', value: 1000 },
                  { color: 'green', value: 3000 }
                ]
              }
            }
          },
          gridPos: { h: 4, w: 12, x: 0, y: 16 }
        }
      ]
    };
  }

  /**
   * Create Container Orchestration Dashboard
   */
  createContainerOrchestrationDashboard() {
    return {
      id: null,
      title: 'Container Orchestration',
      tags: ['containers', 'orchestration'],
      timezone: 'browser',
      refresh: '15s',
      time: {
        from: 'now-1h',
        to: 'now'
      },
      panels: [
        {
          id: 1,
          title: 'Active Containers',
          type: 'stat',
          targets: [
            {
              expr: 'containers_active_total',
              legendFormat: '{{status}}'
            }
          ],
          gridPos: { h: 8, w: 6, x: 0, y: 0 }
        },
        {
          id: 2,
          title: 'Container Startup Time',
          type: 'graph',
          targets: [
            {
              expr: 'histogram_quantile(0.95, rate(container_startup_duration_seconds_bucket[5m]))',
              legendFormat: '95th percentile'
            },
            {
              expr: 'histogram_quantile(0.50, rate(container_startup_duration_seconds_bucket[5m]))',
              legendFormat: 'Median'
            }
          ],
          yAxes: [
            {
              unit: 's'
            }
          ],
          gridPos: { h: 8, w: 18, x: 6, y: 0 }
        },
        {
          id: 3,
          title: 'Container Resource Usage',
          type: 'graph',
          targets: [
            {
              expr: 'container_resource_usage{resource="cpu"}',
              legendFormat: 'CPU - {{container_id}}'
            },
            {
              expr: 'container_resource_usage{resource="memory"}',
              legendFormat: 'Memory - {{container_id}}'
            }
          ],
          gridPos: { h: 8, w: 24, x: 0, y: 8 }
        }
      ]
    };
  }

  /**
   * Create Security Monitoring Dashboard
   */
  createSecurityMonitoringDashboard() {
    return {
      id: null,
      title: 'Security Monitoring',
      tags: ['security', 'monitoring'],
      timezone: 'browser',
      refresh: '30s',
      time: {
        from: 'now-24h',
        to: 'now'
      },
      panels: [
        {
          id: 1,
          title: 'Security Events',
          type: 'graph',
          targets: [
            {
              expr: 'rate(security_events_total[5m])',
              legendFormat: '{{event_type}} - {{severity}}'
            }
          ],
          gridPos: { h: 8, w: 12, x: 0, y: 0 }
        },
        {
          id: 2,
          title: 'Vulnerabilities Detected',
          type: 'stat',
          targets: [
            {
              expr: 'security_vulnerabilities_detected',
              legendFormat: '{{severity}} - {{component}}'
            }
          ],
          gridPos: { h: 8, w: 12, x: 12, y: 0 }
        },
        {
          id: 3,
          title: 'Failed Login Attempts',
          type: 'graph',
          targets: [
            {
              expr: 'rate(failed_login_attempts_total[5m])',
              legendFormat: '{{source_ip}} - {{reason}}'
            }
          ],
          gridPos: { h: 8, w: 12, x: 0, y: 8 }
        },
        {
          id: 4,
          title: 'Container Security Violations',
          type: 'graph',
          targets: [
            {
              expr: 'rate(container_security_violations_total[5m])',
              legendFormat: '{{violation_type}} - {{severity}}'
            }
          ],
          gridPos: { h: 8, w: 12, x: 12, y: 8 }
        }
      ]
    };
  }

  /**
   * Create Real-time Operations Dashboard
   */
  createRealtimeOperationsDashboard() {
    return {
      id: null,
      title: 'Real-time Operations',
      tags: ['realtime', 'operations'],
      timezone: 'browser',
      refresh: '5s',
      time: {
        from: 'now-15m',
        to: 'now'
      },
      panels: [
        {
          id: 1,
          title: 'Live System Status',
          type: 'stat',
          targets: [
            {
              expr: 'up',
              legendFormat: 'System Status'
            }
          ],
          fieldConfig: {
            defaults: {
              mappings: [
                { type: 'value', value: '0', text: 'DOWN' },
                { type: 'value', value: '1', text: 'UP' }
              ],
              thresholds: {
                steps: [
                  { color: 'red', value: 0 },
                  { color: 'green', value: 1 }
                ]
              }
            }
          },
          gridPos: { h: 4, w: 6, x: 0, y: 0 }
        },
        {
          id: 2,
          title: 'Current Throughput',
          type: 'stat',
          targets: [
            {
              expr: 'rate(http_requests_total[1m])',
              legendFormat: 'Requests/sec'
            }
          ],
          gridPos: { h: 4, w: 6, x: 6, y: 0 }
        },
        {
          id: 3,
          title: 'Response Time (Last 5min)',
          type: 'graph',
          targets: [
            {
              expr: 'histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[30s]))',
              legendFormat: '99th percentile'
            }
          ],
          yAxes: [
            {
              unit: 's'
            }
          ],
          gridPos: { h: 8, w: 12, x: 12, y: 0 }
        }
      ]
    };
  }

  /**
   * Create dashboard files
   */
  async createDashboardFiles() {
    for (const [_name, config] of this.dashboardConfigs) {
      try {
        const filePath = path.join(this.config.dashboards.outputDir, config.filename);
        const dashboardJSON = JSON.stringify(config.dashboard, null, 2);
        
        await fs.writeFile(filePath, dashboardJSON);
        logger.info(`Created dashboard file: ${config.filename}`);
        
      } catch (error) {
        logger.error(`Failed to create dashboard file ${config.filename}:`, error);
      }
    }
  }

  /**
   * Import dashboards to Grafana
   */
  async importDashboards() {
    for (const [_name, config] of this.dashboardConfigs) {
      try {
        const payload = {
          dashboard: config.dashboard,
          folderId: config.folderId,
          overwrite: this.config.dashboards.updateExisting
        };
        
        const response = await this.grafanaAPI.post('/api/dashboards/db', payload);
        logger.info(`Imported dashboard: ${config.dashboard.title} (ID: ${response.data.id})`);
        
      } catch (error) {
        logger.error(`Failed to import dashboard ${config.dashboard.title}:`, error.message);
      }
    }
  }

  /**
   * Export dashboard from Grafana
   */
  async exportDashboard(uid) {
    try {
      const response = await this.grafanaAPI.get(`/api/dashboards/uid/${uid}`);
      return response.data.dashboard;
    } catch (error) {
      logger.error(`Failed to export dashboard ${uid}:`, error);
      throw error;
    }
  }

  /**
   * Delete dashboard from Grafana
   */
  async deleteDashboard(uid) {
    try {
      await this.grafanaAPI.delete(`/api/dashboards/uid/${uid}`);
      logger.info(`Deleted dashboard: ${uid}`);
    } catch (error) {
      logger.error(`Failed to delete dashboard ${uid}:`, error);
      throw error;
    }
  }

  /**
   * Get all dashboards
   */
  async getAllDashboards() {
    try {
      const response = await this.grafanaAPI.get('/api/search?type=dash-db');
      return response.data;
    } catch (error) {
      logger.error('Failed to get dashboards:', error);
      throw error;
    }
  }

  /**
   * Get dashboard status
   */
  getStatus() {
    return {
      configured: this.dashboardConfigs.size,
      folders: this.folders.size,
      config: {
        grafanaUrl: this.config.grafana.url,
        outputDir: this.config.dashboards.outputDir,
        autoImport: this.config.dashboards.autoImport
      }
    };
  }
}

module.exports = GrafanaDashboards;