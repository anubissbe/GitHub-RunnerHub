/**
 * Usage Reporting and Analytics System
 * Comprehensive resource usage tracking, reporting, and analytics
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const logger = require('../utils/logger');

class UsageReportingAnalytics extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Reporting configuration
      reporting: {
        enabled: options.reportingEnabled !== false,
        interval: options.reportingInterval || 3600000, // 1 hour
        formats: {
          json: options.jsonReports !== false,
          csv: options.csvReports !== false,
          html: options.htmlReports !== false,
          pdf: options.pdfReports || false
        },
        destinations: {
          file: options.fileReports !== false,
          database: options.databaseReports !== false,
          email: options.emailReports || false,
          webhook: options.webhookReports || false
        },
        retention: {
          daily: options.dailyRetention || 30, // days
          weekly: options.weeklyRetention || 12, // weeks
          monthly: options.monthlyRetention || 12, // months
          yearly: options.yearlyRetention || 3 // years
        }
      },
      
      // Analytics configuration
      analytics: {
        enabled: options.analyticsEnabled !== false,
        realtime: options.realtimeAnalytics !== false,
        aggregationInterval: options.aggregationInterval || 60000, // 1 minute
        metrics: {
          basic: options.basicMetrics !== false,
          advanced: options.advancedMetrics !== false,
          custom: options.customMetrics || []
        },
        insights: {
          enabled: options.insightsEnabled !== false,
          mlPowered: options.mlInsights !== false,
          alertOnAnomalies: options.alertOnAnomalies !== false
        }
      },
      
      // Data collection
      collection: {
        enabled: options.collectionEnabled !== false,
        interval: options.collectionInterval || 30000, // 30 seconds
        sources: {
          containers: options.collectContainers !== false,
          hosts: options.collectHosts !== false,
          network: options.collectNetwork !== false,
          storage: options.collectStorage !== false
        },
        granularity: {
          raw: options.rawData || false,
          minute: options.minuteData !== false,
          hour: options.hourData !== false,
          day: options.dayData !== false
        }
      },
      
      // Visualization configuration
      visualization: {
        enabled: options.visualizationEnabled !== false,
        charts: {
          timeSeries: options.timeSeriesCharts !== false,
          heatmaps: options.heatmapCharts !== false,
          gauges: options.gaugeCharts !== false,
          distribution: options.distributionCharts !== false
        },
        dashboards: {
          overview: options.overviewDashboard !== false,
          detailed: options.detailedDashboard !== false,
          executive: options.executiveDashboard !== false
        }
      },
      
      // Storage configuration
      storage: {
        path: options.storagePath || '/var/lib/runnerhub/reports',
        maxSize: options.maxStorageSize || 10 * 1024 * 1024 * 1024, // 10GB
        compression: options.compression !== false
      },
      
      ...options
    };
    
    // Data storage
    this.usageData = {
      current: new Map(), // Real-time data
      aggregated: {
        minute: [],
        hour: [],
        day: [],
        week: [],
        month: []
      },
      historical: new Map() // Long-term storage
    };
    
    // Analytics state
    this.analytics = {
      metrics: new Map(),
      insights: [],
      trends: new Map(),
      forecasts: new Map(),
      anomalies: []
    };
    
    // Report generation state
    this.reports = {
      scheduled: new Map(),
      generated: [],
      templates: new Map()
    };
    
    // Statistics
    this.stats = {
      dataPointsCollected: 0,
      reportsGenerated: 0,
      insightsDiscovered: 0,
      anomaliesDetected: 0,
      storageUsed: 0,
      lastCollection: null,
      lastReport: null,
      lastAnalysis: null
    };
    
    this.collectionTimer = null;
    this.reportingTimer = null;
    this.aggregationTimer = null;
    this.isStarted = false;
  }

  /**
   * Start usage reporting and analytics
   */
  async start() {
    if (this.isStarted) {
      logger.warn('Usage reporting and analytics already started');
      return;
    }
    
    logger.info('Starting Usage Reporting and Analytics System');
    
    // Initialize storage
    await this.initializeStorage();
    
    // Start data collection
    if (this.config.collection.enabled) {
      this.collectionTimer = setInterval(() => {
        this.collectUsageData().catch(error => {
          logger.error('Data collection failed:', error);
        });
      }, this.config.collection.interval);
    }
    
    // Start report generation
    if (this.config.reporting.enabled) {
      this.reportingTimer = setInterval(() => {
        this.generateScheduledReports().catch(error => {
          logger.error('Report generation failed:', error);
        });
      }, this.config.reporting.interval);
    }
    
    // Start data aggregation
    if (this.config.analytics.enabled) {
      this.aggregationTimer = setInterval(() => {
        this.aggregateData().catch(error => {
          logger.error('Data aggregation failed:', error);
        });
      }, this.config.analytics.aggregationInterval);
    }
    
    // Initialize report templates
    this.initializeReportTemplates();
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Usage reporting and analytics started');
  }

  /**
   * Stop usage reporting and analytics
   */
  async stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Usage Reporting and Analytics System');
    
    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = null;
    }
    
    if (this.reportingTimer) {
      clearInterval(this.reportingTimer);
      this.reportingTimer = null;
    }
    
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
    
    // Generate final report
    await this.generateFinalReport();
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Usage reporting and analytics stopped');
  }

  /**
   * Initialize storage
   */
  async initializeStorage() {
    try {
      // Create storage directories
      const dirs = [
        this.config.storage.path,
        path.join(this.config.storage.path, 'reports'),
        path.join(this.config.storage.path, 'analytics'),
        path.join(this.config.storage.path, 'raw')
      ];
      
      for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
      }
      
      // Load historical data if exists
      await this.loadHistoricalData();
      
      logger.info('Storage initialized');
      
    } catch (error) {
      logger.error('Failed to initialize storage:', error);
    }
  }

  /**
   * Initialize report templates
   */
  initializeReportTemplates() {
    // Daily report template
    this.reports.templates.set('daily', {
      title: 'Daily Resource Usage Report',
      sections: [
        'executive_summary',
        'resource_utilization',
        'cost_analysis',
        'performance_metrics',
        'anomalies',
        'recommendations'
      ],
      metrics: [
        'cpu_usage',
        'memory_usage',
        'storage_usage',
        'network_traffic',
        'container_count',
        'job_throughput'
      ]
    });
    
    // Weekly report template
    this.reports.templates.set('weekly', {
      title: 'Weekly Resource Usage Report',
      sections: [
        'weekly_summary',
        'trend_analysis',
        'capacity_planning',
        'optimization_opportunities',
        'incident_summary'
      ],
      metrics: [
        'weekly_trends',
        'peak_usage',
        'efficiency_scores',
        'cost_trends'
      ]
    });
    
    // Monthly report template
    this.reports.templates.set('monthly', {
      title: 'Monthly Resource Usage Report',
      sections: [
        'monthly_overview',
        'capacity_analysis',
        'cost_breakdown',
        'sla_compliance',
        'strategic_recommendations'
      ],
      metrics: [
        'monthly_totals',
        'growth_rates',
        'budget_analysis',
        'forecast'
      ]
    });
  }

  /**
   * Collect usage data
   */
  async collectUsageData() {
    try {
      const timestamp = new Date();
      const dataPoint = {
        timestamp,
        resources: {},
        metadata: {}
      };
      
      // Collect container data
      if (this.config.collection.sources.containers) {
        dataPoint.resources.containers = await this.collectContainerMetrics();
      }
      
      // Collect host data
      if (this.config.collection.sources.hosts) {
        dataPoint.resources.hosts = await this.collectHostMetrics();
      }
      
      // Collect network data
      if (this.config.collection.sources.network) {
        dataPoint.resources.network = await this.collectNetworkMetrics();
      }
      
      // Collect storage data
      if (this.config.collection.sources.storage) {
        dataPoint.resources.storage = await this.collectStorageMetrics();
      }
      
      // Store data point
      this.storeDataPoint(dataPoint);
      
      // Update statistics
      this.stats.dataPointsCollected++;
      this.stats.lastCollection = timestamp;
      
      // Run real-time analytics
      if (this.config.analytics.realtime) {
        await this.runRealtimeAnalytics(dataPoint);
      }
      
      this.emit('dataCollected', dataPoint);
      
    } catch (error) {
      logger.error('Failed to collect usage data:', error);
    }
  }

  /**
   * Collect container metrics
   */
  async collectContainerMetrics() {
    // This would integrate with container resource managers
    return {
      total: 0,
      running: 0,
      stopped: 0,
      cpu: {
        allocated: 0,
        used: 0,
        percentage: 0
      },
      memory: {
        allocated: 0,
        used: 0,
        percentage: 0
      },
      byProfile: new Map(),
      byStatus: new Map()
    };
  }

  /**
   * Collect host metrics
   */
  async collectHostMetrics() {
    return {
      total: 0,
      active: 0,
      cpu: {
        total: 0,
        used: 0,
        percentage: 0
      },
      memory: {
        total: 0,
        used: 0,
        percentage: 0
      },
      loadAverage: [0, 0, 0]
    };
  }

  /**
   * Collect network metrics
   */
  async collectNetworkMetrics() {
    return {
      bandwidth: {
        ingress: 0,
        egress: 0,
        total: 0
      },
      packets: {
        sent: 0,
        received: 0,
        dropped: 0,
        errors: 0
      },
      connections: {
        active: 0,
        established: 0,
        timewait: 0
      }
    };
  }

  /**
   * Collect storage metrics
   */
  async collectStorageMetrics() {
    return {
      volumes: {
        total: 0,
        used: 0,
        available: 0,
        percentage: 0
      },
      containers: {
        total: 0,
        layers: 0,
        size: 0
      },
      images: {
        total: 0,
        size: 0
      }
    };
  }

  /**
   * Store data point
   */
  storeDataPoint(dataPoint) {
    // Store in current data
    this.usageData.current.set(dataPoint.timestamp.getTime(), dataPoint);
    
    // Limit current data size
    if (this.usageData.current.size > 1000) {
      const oldestKey = Math.min(...this.usageData.current.keys());
      this.usageData.current.delete(oldestKey);
    }
    
    // Store raw data if enabled
    if (this.config.collection.granularity.raw) {
      this.storeRawData(dataPoint);
    }
  }

  /**
   * Store raw data
   */
  async storeRawData(dataPoint) {
    try {
      const filename = `raw_${dataPoint.timestamp.toISOString().replace(/:/g, '-')}.json`;
      const filepath = path.join(this.config.storage.path, 'raw', filename);
      
      await fs.writeFile(filepath, JSON.stringify(dataPoint, null, 2));
      
      // Update storage statistics
      const stats = await fs.stat(filepath);
      this.stats.storageUsed += stats.size;
      
      // Clean up old raw files
      await this.cleanupOldRawData();
      
    } catch (error) {
      logger.error('Failed to store raw data:', error);
    }
  }

  /**
   * Run real-time analytics
   */
  async runRealtimeAnalytics(dataPoint) {
    try {
      // Calculate instant metrics
      const metrics = this.calculateInstantMetrics(dataPoint);
      
      // Update analytics state
      for (const [key, value] of Object.entries(metrics)) {
        this.analytics.metrics.set(key, value);
      }
      
      // Detect anomalies
      if (this.config.analytics.insights.alertOnAnomalies) {
        const anomalies = await this.detectAnomalies(dataPoint);
        if (anomalies.length > 0) {
          this.handleAnomalies(anomalies);
        }
      }
      
      // Generate insights
      if (this.config.analytics.insights.enabled) {
        const insights = await this.generateInsights(dataPoint);
        if (insights.length > 0) {
          this.analytics.insights.push(...insights);
          this.stats.insightsDiscovered += insights.length;
        }
      }
      
      this.stats.lastAnalysis = new Date();
      
    } catch (error) {
      logger.error('Real-time analytics failed:', error);
    }
  }

  /**
   * Calculate instant metrics
   */
  calculateInstantMetrics(dataPoint) {
    const metrics = {};
    
    // Resource utilization
    if (dataPoint.resources.containers) {
      metrics.containerUtilization = dataPoint.resources.containers.cpu.percentage;
      metrics.memoryUtilization = dataPoint.resources.containers.memory.percentage;
    }
    
    // Efficiency scores
    metrics.cpuEfficiency = this.calculateEfficiency(
      dataPoint.resources.containers?.cpu.used || 0,
      dataPoint.resources.containers?.cpu.allocated || 1
    );
    
    metrics.memoryEfficiency = this.calculateEfficiency(
      dataPoint.resources.containers?.memory.used || 0,
      dataPoint.resources.containers?.memory.allocated || 1
    );
    
    // Cost metrics
    metrics.currentCostRate = this.calculateCostRate(dataPoint);
    
    return metrics;
  }

  /**
   * Detect anomalies
   */
  async detectAnomalies(dataPoint) {
    const anomalies = [];
    
    // Get historical baseline
    const baseline = await this.getHistoricalBaseline();
    if (!baseline) return anomalies;
    
    // Check CPU anomaly
    if (dataPoint.resources.containers) {
      const cpuUsage = dataPoint.resources.containers.cpu.percentage;
      if (Math.abs(cpuUsage - baseline.cpu.mean) > baseline.cpu.stdDev * 3) {
        anomalies.push({
          type: 'cpu_anomaly',
          severity: 'high',
          value: cpuUsage,
          baseline: baseline.cpu.mean,
          deviation: Math.abs(cpuUsage - baseline.cpu.mean) / baseline.cpu.stdDev,
          timestamp: dataPoint.timestamp
        });
      }
    }
    
    // Check memory anomaly
    if (dataPoint.resources.containers) {
      const memoryUsage = dataPoint.resources.containers.memory.percentage;
      if (Math.abs(memoryUsage - baseline.memory.mean) > baseline.memory.stdDev * 3) {
        anomalies.push({
          type: 'memory_anomaly',
          severity: 'high',
          value: memoryUsage,
          baseline: baseline.memory.mean,
          deviation: Math.abs(memoryUsage - baseline.memory.mean) / baseline.memory.stdDev,
          timestamp: dataPoint.timestamp
        });
      }
    }
    
    return anomalies;
  }

  /**
   * Generate insights
   */
  async generateInsights(dataPoint) {
    const insights = [];
    
    // Underutilization insight
    if (dataPoint.resources.containers?.cpu.percentage < 20) {
      insights.push({
        type: 'underutilization',
        resource: 'cpu',
        message: 'CPU utilization is very low. Consider consolidating workloads.',
        severity: 'medium',
        recommendation: 'scale_down',
        potential_savings: this.estimateSavings('cpu', 0.5)
      });
    }
    
    // Over-provisioning insight
    if (dataPoint.resources.containers?.memory.used < 
        dataPoint.resources.containers?.memory.allocated * 0.3) {
      insights.push({
        type: 'over_provisioning',
        resource: 'memory',
        message: 'Memory is significantly over-provisioned.',
        severity: 'medium',
        recommendation: 'right_size',
        potential_savings: this.estimateSavings('memory', 0.4)
      });
    }
    
    return insights;
  }

  /**
   * Handle anomalies
   */
  handleAnomalies(anomalies) {
    for (const anomaly of anomalies) {
      // Store anomaly
      this.analytics.anomalies.push(anomaly);
      this.stats.anomaliesDetected++;
      
      // Emit alert
      this.emit('anomalyDetected', anomaly);
      
      logger.warn(`Anomaly detected: ${anomaly.type} - ${anomaly.severity}`);
    }
    
    // Limit anomaly history
    if (this.analytics.anomalies.length > 1000) {
      this.analytics.anomalies = this.analytics.anomalies.slice(-1000);
    }
  }

  /**
   * Aggregate data
   */
  async aggregateData() {
    try {
      const now = new Date();
      
      // Minute aggregation
      if (this.config.collection.granularity.minute) {
        await this.aggregateMinuteData(now);
      }
      
      // Hour aggregation
      if (this.config.collection.granularity.hour && now.getMinutes() === 0) {
        await this.aggregateHourData(now);
      }
      
      // Day aggregation
      if (this.config.collection.granularity.day && now.getHours() === 0) {
        await this.aggregateDayData(now);
      }
      
      // Clean up old aggregated data
      await this.cleanupAggregatedData();
      
    } catch (error) {
      logger.error('Data aggregation failed:', error);
    }
  }

  /**
   * Aggregate minute data
   */
  async aggregateMinuteData(timestamp) {
    const minuteStart = new Date(timestamp);
    minuteStart.setSeconds(0, 0);
    
    const dataPoints = Array.from(this.usageData.current.values())
      .filter(dp => {
        const dpTime = new Date(dp.timestamp);
        return dpTime >= minuteStart && dpTime < new Date(minuteStart.getTime() + 60000);
      });
    
    if (dataPoints.length > 0) {
      const aggregated = this.calculateAggregates(dataPoints);
      aggregated.timestamp = minuteStart;
      aggregated.granularity = 'minute';
      
      this.usageData.aggregated.minute.push(aggregated);
      
      // Limit size
      if (this.usageData.aggregated.minute.length > 1440) { // 24 hours
        this.usageData.aggregated.minute.shift();
      }
    }
  }

  /**
   * Calculate aggregates
   */
  calculateAggregates(dataPoints) {
    const aggregated = {
      count: dataPoints.length,
      resources: {
        containers: {
          cpu: { min: Infinity, max: 0, avg: 0, sum: 0 },
          memory: { min: Infinity, max: 0, avg: 0, sum: 0 }
        }
      }
    };
    
    // Calculate aggregates
    for (const dp of dataPoints) {
      if (dp.resources.containers) {
        // CPU
        const cpu = dp.resources.containers.cpu.percentage || 0;
        aggregated.resources.containers.cpu.min = Math.min(aggregated.resources.containers.cpu.min, cpu);
        aggregated.resources.containers.cpu.max = Math.max(aggregated.resources.containers.cpu.max, cpu);
        aggregated.resources.containers.cpu.sum += cpu;
        
        // Memory
        const memory = dp.resources.containers.memory.percentage || 0;
        aggregated.resources.containers.memory.min = Math.min(aggregated.resources.containers.memory.min, memory);
        aggregated.resources.containers.memory.max = Math.max(aggregated.resources.containers.memory.max, memory);
        aggregated.resources.containers.memory.sum += memory;
      }
    }
    
    // Calculate averages
    if (dataPoints.length > 0) {
      aggregated.resources.containers.cpu.avg = aggregated.resources.containers.cpu.sum / dataPoints.length;
      aggregated.resources.containers.memory.avg = aggregated.resources.containers.memory.sum / dataPoints.length;
    }
    
    return aggregated;
  }

  /**
   * Generate scheduled reports
   */
  async generateScheduledReports() {
    try {
      const now = new Date();
      
      // Daily report
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        await this.generateReport('daily', now);
      }
      
      // Weekly report (Monday)
      if (now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
        await this.generateReport('weekly', now);
      }
      
      // Monthly report (1st day)
      if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
        await this.generateReport('monthly', now);
      }
      
    } catch (error) {
      logger.error('Scheduled report generation failed:', error);
    }
  }

  /**
   * Generate report
   */
  async generateReport(type, timestamp = new Date()) {
    try {
      logger.info(`Generating ${type} report`);
      
      const template = this.reports.templates.get(type);
      if (!template) {
        throw new Error(`Unknown report type: ${type}`);
      }
      
      const report = {
        id: `${type}_${timestamp.toISOString()}`,
        type,
        timestamp,
        title: template.title,
        period: this.getReportPeriod(type, timestamp),
        sections: {},
        metrics: {},
        metadata: {
          generatedAt: new Date(),
          version: '1.0'
        }
      };
      
      // Generate report sections
      for (const section of template.sections) {
        report.sections[section] = await this.generateReportSection(section, report.period);
      }
      
      // Calculate metrics
      for (const metric of template.metrics) {
        report.metrics[metric] = await this.calculateReportMetric(metric, report.period);
      }
      
      // Save report
      await this.saveReport(report);
      
      // Distribute report
      await this.distributeReport(report);
      
      this.stats.reportsGenerated++;
      this.stats.lastReport = new Date();
      
      this.emit('reportGenerated', {
        type,
        id: report.id,
        timestamp
      });
      
      return report;
      
    } catch (error) {
      logger.error(`Failed to generate ${type} report:`, error);
      throw error;
    }
  }

  /**
   * Generate report section
   */
  async generateReportSection(section, period) {
    switch (section) {
      case 'executive_summary':
        return this.generateExecutiveSummary(period);
        
      case 'resource_utilization':
        return this.generateResourceUtilization(period);
        
      case 'cost_analysis':
        return this.generateCostAnalysis(period);
        
      case 'performance_metrics':
        return this.generatePerformanceMetrics(period);
        
      case 'anomalies':
        return this.generateAnomaliesSection(period);
        
      case 'recommendations':
        return this.generateRecommendations(period);
        
      default:
        return { content: `Section ${section} not implemented` };
    }
  }

  /**
   * Generate executive summary
   */
  async generateExecutiveSummary(period) {
    const data = await this.getDataForPeriod(period);
    
    return {
      title: 'Executive Summary',
      content: {
        totalContainers: data.containers?.total || 0,
        avgCpuUtilization: data.avgMetrics?.cpu || 0,
        avgMemoryUtilization: data.avgMetrics?.memory || 0,
        totalCost: data.cost?.total || 0,
        costTrend: data.cost?.trend || 'stable',
        keyInsights: data.insights?.slice(0, 3) || [],
        criticalIssues: data.anomalies?.filter(a => a.severity === 'critical').length || 0
      }
    };
  }

  /**
   * Save report
   */
  async saveReport(report) {
    try {
      // Save in different formats
      if (this.config.reporting.formats.json) {
        await this.saveJsonReport(report);
      }
      
      if (this.config.reporting.formats.csv) {
        await this.saveCsvReport(report);
      }
      
      if (this.config.reporting.formats.html) {
        await this.saveHtmlReport(report);
      }
      
      // Store report reference
      this.reports.generated.push({
        id: report.id,
        type: report.type,
        timestamp: report.timestamp,
        savedAt: new Date()
      });
      
      // Limit stored references
      if (this.reports.generated.length > 1000) {
        this.reports.generated.shift();
      }
      
    } catch (error) {
      logger.error('Failed to save report:', error);
      throw error;
    }
  }

  /**
   * Save JSON report
   */
  async saveJsonReport(report) {
    const filename = `${report.id}.json`;
    let filepath = path.join(this.config.storage.path, 'reports', filename);
    
    let content = JSON.stringify(report, null, 2);
    
    if (this.config.storage.compression) {
      // Compress content
      const zlib = require('zlib');
      content = await promisify(zlib.gzip)(content);
      filepath += '.gz';
    }
    
    await fs.writeFile(filepath, content);
  }

  /**
   * Distribute report
   */
  async distributeReport(report) {
    try {
      // File distribution (already done in saveReport)
      
      // Database distribution
      if (this.config.reporting.destinations.database) {
        await this.saveReportToDatabase(report);
      }
      
      // Email distribution
      if (this.config.reporting.destinations.email) {
        await this.emailReport(report);
      }
      
      // Webhook distribution
      if (this.config.reporting.destinations.webhook) {
        await this.sendReportWebhook(report);
      }
      
    } catch (error) {
      logger.error('Failed to distribute report:', error);
    }
  }

  /**
   * Get data for period
   */
  async getDataForPeriod(period) {
    const data = {
      containers: { total: 0 },
      avgMetrics: { cpu: 0, memory: 0 },
      cost: { total: 0, trend: 'stable' },
      insights: [],
      anomalies: []
    };
    
    // Get aggregated data for period
    const aggregatedData = this.getAggregatedDataForPeriod(period);
    
    if (aggregatedData.length > 0) {
      // Calculate averages
      const cpuSum = aggregatedData.reduce((sum, d) => sum + (d.resources?.containers?.cpu?.avg || 0), 0);
      const memorySum = aggregatedData.reduce((sum, d) => sum + (d.resources?.containers?.memory?.avg || 0), 0);
      
      data.avgMetrics.cpu = cpuSum / aggregatedData.length;
      data.avgMetrics.memory = memorySum / aggregatedData.length;
    }
    
    // Get insights for period
    data.insights = this.analytics.insights.filter(i => 
      i.timestamp >= period.start && i.timestamp <= period.end
    );
    
    // Get anomalies for period
    data.anomalies = this.analytics.anomalies.filter(a => 
      a.timestamp >= period.start && a.timestamp <= period.end
    );
    
    return data;
  }

  /**
   * Get aggregated data for period
   */
  getAggregatedDataForPeriod(period) {
    const { start, end } = period;
    const data = [];
    
    // Check different granularities based on period duration
    const duration = end - start;
    const _hour = 3600000;
    const day = 86400000;
    
    if (duration <= day) {
      // Use minute data for daily reports
      data.push(...this.usageData.aggregated.minute.filter(d => 
        d.timestamp >= start && d.timestamp <= end
      ));
    } else if (duration <= day * 7) {
      // Use hour data for weekly reports
      data.push(...this.usageData.aggregated.hour.filter(d => 
        d.timestamp >= start && d.timestamp <= end
      ));
    } else {
      // Use day data for monthly reports
      data.push(...this.usageData.aggregated.day.filter(d => 
        d.timestamp >= start && d.timestamp <= end
      ));
    }
    
    return data;
  }

  /**
   * Get report period
   */
  getReportPeriod(type, timestamp) {
    const end = new Date(timestamp);
    let start;
    
    switch (type) {
      case 'daily':
        start = new Date(end);
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
        
      case 'weekly':
        start = new Date(end);
        start.setDate(start.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        break;
        
      case 'monthly':
        start = new Date(end);
        start.setMonth(start.getMonth() - 1);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setDate(0); // Last day of previous month
        end.setHours(23, 59, 59, 999);
        break;
    }
    
    return { start, end, type };
  }

  /**
   * Clean up old data
   */
  async cleanupOldData() {
    try {
      // Clean up based on retention policies
      const now = new Date();
      
      // Clean daily data
      const dailyRetention = now.getTime() - (this.config.reporting.retention.daily * 86400000);
      this.usageData.aggregated.day = this.usageData.aggregated.day.filter(
        d => d.timestamp.getTime() > dailyRetention
      );
      
      // Clean weekly data
      const weeklyRetention = now.getTime() - (this.config.reporting.retention.weekly * 7 * 86400000);
      this.usageData.aggregated.week = this.usageData.aggregated.week.filter(
        d => d.timestamp.getTime() > weeklyRetention
      );
      
      // Clean up files
      await this.cleanupOldFiles();
      
    } catch (error) {
      logger.error('Data cleanup failed:', error);
    }
  }

  /**
   * Clean up old files
   */
  async cleanupOldFiles() {
    try {
      const reportDir = path.join(this.config.storage.path, 'reports');
      const files = await fs.readdir(reportDir);
      
      const now = Date.now();
      const retentionMs = this.config.reporting.retention.daily * 86400000;
      
      for (const file of files) {
        const filepath = path.join(reportDir, file);
        const stats = await fs.stat(filepath);
        
        if (now - stats.mtime.getTime() > retentionMs) {
          await fs.unlink(filepath);
          logger.debug(`Deleted old report file: ${file}`);
        }
      }
      
    } catch (error) {
      logger.error('File cleanup failed:', error);
    }
  }

  /**
   * Load historical data
   */
  async loadHistoricalData() {
    try {
      // Load recent aggregated data from disk
      // This would be implemented based on actual storage
    } catch (error) {
      logger.error('Failed to load historical data:', error);
    }
  }

  /**
   * Generate final report on shutdown
   */
  async generateFinalReport() {
    try {
      await this.generateReport('shutdown', new Date());
    } catch (error) {
      logger.error('Failed to generate final report:', error);
    }
  }

  /**
   * Get historical baseline
   */
  async getHistoricalBaseline() {
    // Calculate baseline from historical data
    const data = this.usageData.aggregated.hour.slice(-168); // Last week
    
    if (data.length < 24) return null;
    
    const cpuValues = data.map(d => d.resources?.containers?.cpu?.avg || 0);
    const memoryValues = data.map(d => d.resources?.containers?.memory?.avg || 0);
    
    return {
      cpu: {
        mean: cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length,
        stdDev: this.calculateStdDev(cpuValues)
      },
      memory: {
        mean: memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length,
        stdDev: this.calculateStdDev(memoryValues)
      }
    };
  }

  /**
   * Calculate standard deviation
   */
  calculateStdDev(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate efficiency
   */
  calculateEfficiency(used, allocated) {
    if (allocated === 0) return 0;
    return (used / allocated) * 100;
  }

  /**
   * Calculate cost rate
   */
  calculateCostRate(dataPoint) {
    // Simple cost calculation
    const cpuCost = (dataPoint.resources.containers?.cpu.used || 0) * 0.01;
    const memoryCost = (dataPoint.resources.containers?.memory.used || 0) * 0.005;
    return cpuCost + memoryCost;
  }

  /**
   * Estimate savings
   */
  estimateSavings(resource, percentage) {
    const currentCost = resource === 'cpu' ? 0.01 : 0.005;
    return currentCost * percentage * 24; // Daily savings
  }

  /**
   * Get current usage summary
   */
  getCurrentUsageSummary() {
    const current = Array.from(this.usageData.current.values()).pop();
    
    if (!current) {
      return {
        timestamp: new Date(),
        resources: {},
        metrics: {},
        insights: []
      };
    }
    
    return {
      timestamp: current.timestamp,
      resources: current.resources,
      metrics: Object.fromEntries(this.analytics.metrics),
      insights: this.analytics.insights.slice(-5),
      anomalies: this.analytics.anomalies.slice(-5)
    };
  }

  /**
   * Get analytics dashboard data
   */
  getAnalyticsDashboard() {
    return {
      realtime: {
        cpu: this.analytics.metrics.get('containerUtilization') || 0,
        memory: this.analytics.metrics.get('memoryUtilization') || 0,
        efficiency: {
          cpu: this.analytics.metrics.get('cpuEfficiency') || 0,
          memory: this.analytics.metrics.get('memoryEfficiency') || 0
        },
        cost: this.analytics.metrics.get('currentCostRate') || 0
      },
      trends: {
        hourly: this.calculateTrends('hour'),
        daily: this.calculateTrends('day'),
        weekly: this.calculateTrends('week')
      },
      insights: {
        total: this.stats.insightsDiscovered,
        recent: this.analytics.insights.slice(-10),
        byType: this.groupInsightsByType()
      },
      anomalies: {
        total: this.stats.anomaliesDetected,
        recent: this.analytics.anomalies.slice(-10),
        bySeverity: this.groupAnomaliesBySeverity()
      }
    };
  }

  /**
   * Calculate trends
   */
  calculateTrends(granularity) {
    const data = this.usageData.aggregated[granularity] || [];
    
    if (data.length < 2) {
      return { cpu: 0, memory: 0, cost: 0 };
    }
    
    const recent = data.slice(-10);
    const older = data.slice(-20, -10);
    
    const recentAvg = {
      cpu: recent.reduce((sum, d) => sum + (d.resources?.containers?.cpu?.avg || 0), 0) / recent.length,
      memory: recent.reduce((sum, d) => sum + (d.resources?.containers?.memory?.avg || 0), 0) / recent.length
    };
    
    const olderAvg = {
      cpu: older.reduce((sum, d) => sum + (d.resources?.containers?.cpu?.avg || 0), 0) / older.length,
      memory: older.reduce((sum, d) => sum + (d.resources?.containers?.memory?.avg || 0), 0) / older.length
    };
    
    return {
      cpu: ((recentAvg.cpu - olderAvg.cpu) / olderAvg.cpu) * 100,
      memory: ((recentAvg.memory - olderAvg.memory) / olderAvg.memory) * 100,
      cost: 0 // Simplified
    };
  }

  /**
   * Group insights by type
   */
  groupInsightsByType() {
    const groups = {};
    
    for (const insight of this.analytics.insights) {
      if (!groups[insight.type]) {
        groups[insight.type] = 0;
      }
      groups[insight.type]++;
    }
    
    return groups;
  }

  /**
   * Group anomalies by severity
   */
  groupAnomaliesBySeverity() {
    const groups = { low: 0, medium: 0, high: 0, critical: 0 };
    
    for (const anomaly of this.analytics.anomalies) {
      groups[anomaly.severity] = (groups[anomaly.severity] || 0) + 1;
    }
    
    return groups;
  }

  /**
   * Generate custom report
   */
  async generateCustomReport(options) {
    const report = await this.generateReport(
      options.type || 'custom',
      options.timestamp || new Date()
    );
    
    return report;
  }

  /**
   * Export data
   */
  async exportData(format, period) {
    const data = await this.getDataForPeriod(period);
    
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
        
      case 'csv':
        return this.convertToCsv(data);
        
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Convert data to CSV
   */
  convertToCsv(data) {
    // Simple CSV conversion
    const rows = [
      ['Timestamp', 'CPU Usage', 'Memory Usage', 'Cost']
    ];
    
    // Add data rows
    if (data.aggregated) {
      for (const point of data.aggregated) {
        rows.push([
          point.timestamp.toISOString(),
          point.resources?.containers?.cpu?.avg || 0,
          point.resources?.containers?.memory?.avg || 0,
          point.cost || 0
        ]);
      }
    }
    
    return rows.map(row => row.join(',')).join('\n');
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return {
      isStarted: this.isStarted,
      stats: {
        ...this.stats,
        lastCollection: this.stats.lastCollection?.toISOString() || 'Never',
        lastReport: this.stats.lastReport?.toISOString() || 'Never',
        lastAnalysis: this.stats.lastAnalysis?.toISOString() || 'Never',
        storageUsedMB: (this.stats.storageUsed / 1024 / 1024).toFixed(2)
      },
      dataPoints: {
        current: this.usageData.current.size,
        minute: this.usageData.aggregated.minute.length,
        hour: this.usageData.aggregated.hour.length,
        day: this.usageData.aggregated.day.length
      },
      reports: {
        generated: this.stats.reportsGenerated,
        recent: this.reports.generated.slice(-10),
        scheduled: Array.from(this.reports.scheduled.entries())
      },
      analytics: {
        metrics: this.analytics.metrics.size,
        insights: this.analytics.insights.length,
        anomalies: this.analytics.anomalies.length
      },
      config: {
        reporting: {
          enabled: this.config.reporting.enabled,
          formats: this.config.reporting.formats,
          destinations: this.config.reporting.destinations
        },
        analytics: {
          enabled: this.config.analytics.enabled,
          realtime: this.config.analytics.realtime,
          insights: this.config.analytics.insights
        },
        collection: {
          enabled: this.config.collection.enabled,
          interval: this.config.collection.interval,
          sources: this.config.collection.sources
        }
      }
    };
  }
}

module.exports = UsageReportingAnalytics;