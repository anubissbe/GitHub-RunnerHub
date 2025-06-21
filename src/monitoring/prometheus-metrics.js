/**
 * Prometheus Metrics Collection System
 * Comprehensive metrics collection for GitHub-RunnerHub monitoring and observability
 */

const client = require('prom-client');
const EventEmitter = require('events');
const os = require('os');
const logger = require('../utils/logger');

class PrometheusMetrics extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Metrics configuration
      collection: {
        defaultLabels: options.defaultLabels || { service: 'github-runnerhub' },
        timeout: options.timeout || 10000,
        interval: options.interval || 15000, // 15 seconds
        enableDefaultMetrics: options.enableDefaultMetrics !== false
      },
      
      // Custom metrics configuration
      customMetrics: {
        enabled: options.enableCustomMetrics !== false,
        histogramBuckets: options.histogramBuckets || [0.1, 0.5, 1, 2, 5, 10, 30, 60],
        summaryQuantiles: options.summaryQuantiles || [0.01, 0.05, 0.5, 0.9, 0.95, 0.99, 0.999]
      },
      
      // Business metrics
      businessMetrics: {
        enabled: options.enableBusinessMetrics !== false,
        trackJobs: options.trackJobs !== false,
        trackRunners: options.trackRunners !== false,
        trackContainers: options.trackContainers !== false,
        trackSecurity: options.trackSecurity !== false
      },
      
      // Performance tracking
      performance: {
        enabled: options.enablePerformanceMetrics !== false,
        trackResponseTimes: options.trackResponseTimes !== false,
        trackResourceUsage: options.trackResourceUsage !== false,
        trackCacheMetrics: options.trackCacheMetrics !== false
      },
      
      ...options
    };
    
    // Initialize Prometheus registry
    this.register = new client.Registry();
    
    // Metrics storage
    this.metrics = {
      // System metrics
      system: {},
      
      // Application metrics  
      application: {},
      
      // Business metrics
      business: {},
      
      // Performance metrics
      performance: {},
      
      // Security metrics
      security: {}
    };
    
    // Collection state
    this.isCollecting = false;
    this.collectionTimer = null;
    this.lastCollection = null;
    
    // Statistics
    this.stats = {
      totalCollections: 0,
      failedCollections: 0,
      metricsCount: 0,
      lastCollectionDuration: 0
    };
  }

  /**
   * Initialize Prometheus metrics collection
   */
  async initialize() {
    try {
      logger.info('Initializing Prometheus Metrics Collection');
      
      // Set default labels
      this.register.setDefaultLabels(this.config.collection.defaultLabels);
      
      // Initialize default Node.js metrics
      if (this.config.collection.enableDefaultMetrics) {
        client.collectDefaultMetrics({
          register: this.register,
          timeout: this.config.collection.timeout
        });
      }
      
      // Initialize custom metrics
      this.initializeSystemMetrics();
      this.initializeApplicationMetrics();
      this.initializeBusinessMetrics();
      this.initializePerformanceMetrics();
      this.initializeSecurityMetrics();
      
      // Start collection
      this.startCollection();
      
      this.emit('initialized');
      logger.info('Prometheus Metrics Collection initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Prometheus Metrics:', error);
      throw error;
    }
  }

  /**
   * Initialize system-level metrics
   */
  initializeSystemMetrics() {
    // System resource metrics
    this.metrics.system.cpuUsage = new client.Gauge({
      name: 'system_cpu_usage_percent',
      help: 'System CPU usage percentage',
      labelNames: ['cpu'],
      registers: [this.register]
    });
    
    this.metrics.system.memoryUsage = new client.Gauge({
      name: 'system_memory_usage_bytes',
      help: 'System memory usage in bytes',
      labelNames: ['type'],
      registers: [this.register]
    });
    
    this.metrics.system.diskUsage = new client.Gauge({
      name: 'system_disk_usage_bytes',
      help: 'System disk usage in bytes',
      labelNames: ['mountpoint', 'type'],
      registers: [this.register]
    });
    
    this.metrics.system.networkIO = new client.Counter({
      name: 'system_network_io_bytes_total',
      help: 'Total network I/O bytes',
      labelNames: ['interface', 'direction'],
      registers: [this.register]
    });
    
    this.metrics.system.loadAverage = new client.Gauge({
      name: 'system_load_average',
      help: 'System load average',
      labelNames: ['period'],
      registers: [this.register]
    });
    
    this.metrics.system.uptime = new client.Gauge({
      name: 'system_uptime_seconds',
      help: 'System uptime in seconds',
      registers: [this.register]
    });
  }

  /**
   * Initialize application-level metrics
   */
  initializeApplicationMetrics() {
    // HTTP request metrics
    this.metrics.application.httpRequests = new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.register]
    });
    
    this.metrics.application.httpDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: this.config.customMetrics.histogramBuckets,
      registers: [this.register]
    });
    
    // Database metrics
    this.metrics.application.dbConnections = new client.Gauge({
      name: 'database_connections_active',
      help: 'Active database connections',
      labelNames: ['database', 'state'],
      registers: [this.register]
    });
    
    this.metrics.application.dbQueries = new client.Counter({
      name: 'database_queries_total',
      help: 'Total database queries executed',
      labelNames: ['database', 'operation', 'status'],
      registers: [this.register]
    });
    
    this.metrics.application.dbQueryDuration = new client.Histogram({
      name: 'database_query_duration_seconds',
      help: 'Database query duration in seconds',
      labelNames: ['database', 'operation'],
      buckets: this.config.customMetrics.histogramBuckets,
      registers: [this.register]
    });
    
    // Redis/Cache metrics
    this.metrics.application.cacheOperations = new client.Counter({
      name: 'cache_operations_total',
      help: 'Total cache operations',
      labelNames: ['operation', 'result'],
      registers: [this.register]
    });
    
    this.metrics.application.cacheHitRatio = new client.Gauge({
      name: 'cache_hit_ratio',
      help: 'Cache hit ratio percentage',
      labelNames: ['cache_type'],
      registers: [this.register]
    });
    
    // WebSocket metrics
    this.metrics.application.websocketConnections = new client.Gauge({
      name: 'websocket_connections_active',
      help: 'Active WebSocket connections',
      registers: [this.register]
    });
    
    this.metrics.application.websocketMessages = new client.Counter({
      name: 'websocket_messages_total',
      help: 'Total WebSocket messages',
      labelNames: ['direction', 'type'],
      registers: [this.register]
    });
  }

  /**
   * Initialize business-specific metrics
   */
  initializeBusinessMetrics() {
    if (!this.config.businessMetrics.enabled) return;
    
    // Job metrics
    if (this.config.businessMetrics.trackJobs) {
      this.metrics.business.jobsTotal = new client.Counter({
        name: 'github_jobs_total',
        help: 'Total GitHub Actions jobs processed',
        labelNames: ['repository', 'workflow', 'status', 'runner_type'],
        registers: [this.register]
      });
      
      this.metrics.business.jobDuration = new client.Histogram({
        name: 'github_job_duration_seconds',
        help: 'GitHub job execution duration in seconds',
        labelNames: ['repository', 'workflow', 'runner_type'],
        buckets: [30, 60, 300, 600, 1800, 3600, 7200],
        registers: [this.register]
      });
      
      this.metrics.business.jobsActive = new client.Gauge({
        name: 'github_jobs_active',
        help: 'Currently active GitHub jobs',
        labelNames: ['repository', 'runner_type'],
        registers: [this.register]
      });
      
      this.metrics.business.jobQueueSize = new client.Gauge({
        name: 'github_job_queue_size',
        help: 'Size of job queue',
        labelNames: ['priority'],
        registers: [this.register]
      });
    }
    
    // Runner metrics
    if (this.config.businessMetrics.trackRunners) {
      this.metrics.business.runnersTotal = new client.Gauge({
        name: 'github_runners_total',
        help: 'Total GitHub runners',
        labelNames: ['status', 'type', 'labels'],
        registers: [this.register]
      });
      
      this.metrics.business.runnerUtilization = new client.Gauge({
        name: 'github_runner_utilization_percent',
        help: 'Runner utilization percentage',
        labelNames: ['runner_id', 'type'],
        registers: [this.register]
      });
      
      this.metrics.business.apiCalls = new client.Counter({
        name: 'github_api_calls_total',
        help: 'Total GitHub API calls',
        labelNames: ['endpoint', 'method', 'status'],
        registers: [this.register]
      });
      
      this.metrics.business.apiRateLimit = new client.Gauge({
        name: 'github_api_rate_limit_remaining',
        help: 'Remaining GitHub API rate limit',
        registers: [this.register]
      });
    }
    
    // Container metrics
    if (this.config.businessMetrics.trackContainers) {
      this.metrics.business.containersActive = new client.Gauge({
        name: 'containers_active_total',
        help: 'Active containers',
        labelNames: ['job_id', 'image', 'status'],
        registers: [this.register]
      });
      
      this.metrics.business.containerStartupTime = new client.Histogram({
        name: 'container_startup_duration_seconds',
        help: 'Container startup duration in seconds',
        labelNames: ['image', 'runner_type'],
        buckets: [1, 2, 5, 10, 20, 30, 60],
        registers: [this.register]
      });
      
      this.metrics.business.containerResourceUsage = new client.Gauge({
        name: 'container_resource_usage',
        help: 'Container resource usage',
        labelNames: ['container_id', 'resource', 'unit'],
        registers: [this.register]
      });
    }
  }

  /**
   * Initialize performance metrics
   */
  initializePerformanceMetrics() {
    if (!this.config.performance.enabled) return;
    
    // Response time metrics
    if (this.config.performance.trackResponseTimes) {
      this.metrics.performance.responseTime = new client.Histogram({
        name: 'application_response_time_seconds',
        help: 'Application response time in seconds',
        labelNames: ['component', 'operation'],
        buckets: this.config.customMetrics.histogramBuckets,
        registers: [this.register]
      });
      
      this.metrics.performance.throughput = new client.Counter({
        name: 'application_throughput_total',
        help: 'Application throughput (operations per second)',
        labelNames: ['component', 'operation'],
        registers: [this.register]
      });
    }
    
    // Resource usage tracking
    if (this.config.performance.trackResourceUsage) {
      this.metrics.performance.heapUsage = new client.Gauge({
        name: 'nodejs_heap_usage_bytes',
        help: 'Node.js heap usage in bytes',
        labelNames: ['type'],
        registers: [this.register]
      });
      
      this.metrics.performance.eventLoopLag = new client.Gauge({
        name: 'nodejs_event_loop_lag_seconds',
        help: 'Node.js event loop lag in seconds',
        registers: [this.register]
      });
      
      this.metrics.performance.gcDuration = new client.Histogram({
        name: 'nodejs_gc_duration_seconds',
        help: 'Node.js garbage collection duration in seconds',
        labelNames: ['kind'],
        buckets: [0.001, 0.01, 0.1, 1, 10],
        registers: [this.register]
      });
    }
    
    // Cache performance
    if (this.config.performance.trackCacheMetrics) {
      this.metrics.performance.cacheSize = new client.Gauge({
        name: 'cache_size_bytes',
        help: 'Cache size in bytes',
        labelNames: ['cache_name', 'type'],
        registers: [this.register]
      });
      
      this.metrics.performance.cacheLatency = new client.Histogram({
        name: 'cache_operation_duration_seconds',
        help: 'Cache operation duration in seconds',
        labelNames: ['cache_name', 'operation'],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
        registers: [this.register]
      });
    }
  }

  /**
   * Initialize security metrics
   */
  initializeSecurityMetrics() {
    if (!this.config.businessMetrics.trackSecurity) return;
    
    this.metrics.security.securityEvents = new client.Counter({
      name: 'security_events_total',
      help: 'Total security events',
      labelNames: ['event_type', 'severity', 'source'],
      registers: [this.register]
    });
    
    this.metrics.security.vulnerabilities = new client.Gauge({
      name: 'security_vulnerabilities_detected',
      help: 'Security vulnerabilities detected',
      labelNames: ['severity', 'component'],
      registers: [this.register]
    });
    
    this.metrics.security.authEvents = new client.Counter({
      name: 'authentication_events_total',
      help: 'Authentication events',
      labelNames: ['event_type', 'result'],
      registers: [this.register]
    });
    
    this.metrics.security.failedLogins = new client.Counter({
      name: 'failed_login_attempts_total',
      help: 'Failed login attempts',
      labelNames: ['source_ip', 'reason'],
      registers: [this.register]
    });
    
    this.metrics.security.containerViolations = new client.Counter({
      name: 'container_security_violations_total',
      help: 'Container security violations',
      labelNames: ['violation_type', 'severity', 'action_taken'],
      registers: [this.register]
    });
  }

  /**
   * Start metrics collection
   */
  startCollection() {
    if (this.isCollecting) {
      logger.warn('Metrics collection already running');
      return;
    }
    
    this.isCollecting = true;
    this.collectionTimer = setInterval(() => {
      this.collectMetrics().catch(error => {
        logger.error('Metrics collection failed:', error);
        this.stats.failedCollections++;
      });
    }, this.config.collection.interval);
    
    logger.info(`Started metrics collection with ${this.config.collection.interval}ms interval`);
  }

  /**
   * Stop metrics collection
   */
  stopCollection() {
    if (!this.isCollecting) {
      return;
    }
    
    this.isCollecting = false;
    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = null;
    }
    
    logger.info('Stopped metrics collection');
  }

  /**
   * Collect all metrics
   */
  async collectMetrics() {
    const startTime = Date.now();
    
    try {
      await Promise.all([
        this.collectSystemMetrics(),
        this.collectApplicationMetrics(),
        this.collectPerformanceMetrics()
      ]);
      
      this.stats.totalCollections++;
      this.stats.lastCollectionDuration = Date.now() - startTime;
      this.lastCollection = new Date();
      
      this.emit('metricsCollected', {
        duration: this.stats.lastCollectionDuration,
        timestamp: this.lastCollection
      });
      
    } catch (error) {
      this.stats.failedCollections++;
      throw error;
    }
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics() {
    try {
      // CPU usage
      const cpus = os.cpus();
      cpus.forEach((cpu, index) => {
        const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
        const idle = cpu.times.idle;
        const usage = ((total - idle) / total) * 100;
        this.metrics.system.cpuUsage.set({ cpu: `cpu${index}` }, usage);
      });
      
      // Memory usage
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      
      this.metrics.system.memoryUsage.set({ type: 'total' }, totalMem);
      this.metrics.system.memoryUsage.set({ type: 'free' }, freeMem);
      this.metrics.system.memoryUsage.set({ type: 'used' }, usedMem);
      
      // Load average
      const loadAvg = os.loadavg();
      this.metrics.system.loadAverage.set({ period: '1m' }, loadAvg[0]);
      this.metrics.system.loadAverage.set({ period: '5m' }, loadAvg[1]);
      this.metrics.system.loadAverage.set({ period: '15m' }, loadAvg[2]);
      
      // Uptime
      this.metrics.system.uptime.set(os.uptime());
      
    } catch (error) {
      logger.error('Failed to collect system metrics:', error);
    }
  }

  /**
   * Collect application metrics
   */
  async collectApplicationMetrics() {
    try {
      // WebSocket connections would be collected from WebSocket server
      // Database connections would be collected from database pool
      // These are placeholders for integration points
      
    } catch (error) {
      logger.error('Failed to collect application metrics:', error);
    }
  }

  /**
   * Collect performance metrics
   */
  async collectPerformanceMetrics() {
    if (!this.config.performance.enabled) return;
    
    try {
      // Memory usage
      if (this.config.performance.trackResourceUsage) {
        const memUsage = process.memoryUsage();
        this.metrics.performance.heapUsage.set({ type: 'used' }, memUsage.heapUsed);
        this.metrics.performance.heapUsage.set({ type: 'total' }, memUsage.heapTotal);
        this.metrics.performance.heapUsage.set({ type: 'external' }, memUsage.external);
        this.metrics.performance.heapUsage.set({ type: 'rss' }, memUsage.rss);
      }
      
    } catch (error) {
      logger.error('Failed to collect performance metrics:', error);
    }
  }

  /**
   * Record HTTP request
   */
  recordHttpRequest(method, route, statusCode, duration) {
    this.metrics.application.httpRequests.inc({
      method: method.toUpperCase(),
      route,
      status_code: statusCode
    });
    
    this.metrics.application.httpDuration.observe({
      method: method.toUpperCase(),
      route,
      status_code: statusCode
    }, duration);
  }

  /**
   * Record database query
   */
  recordDatabaseQuery(database, operation, duration, success = true) {
    this.metrics.application.dbQueries.inc({
      database,
      operation,
      status: success ? 'success' : 'error'
    });
    
    this.metrics.application.dbQueryDuration.observe({
      database,
      operation
    }, duration);
  }

  /**
   * Record cache operation
   */
  recordCacheOperation(operation, result) {
    this.metrics.application.cacheOperations.inc({
      operation,
      result
    });
  }

  /**
   * Record job metrics
   */
  recordJob(repository, workflow, status, runnerType, duration = null) {
    if (!this.config.businessMetrics.trackJobs) return;
    
    this.metrics.business.jobsTotal.inc({
      repository,
      workflow,
      status,
      runner_type: runnerType
    });
    
    if (duration !== null) {
      this.metrics.business.jobDuration.observe({
        repository,
        workflow,
        runner_type: runnerType
      }, duration);
    }
  }

  /**
   * Record security event
   */
  recordSecurityEvent(eventType, severity, source) {
    if (!this.config.businessMetrics.trackSecurity) return;
    
    this.metrics.security.securityEvents.inc({
      event_type: eventType,
      severity,
      source
    });
  }

  /**
   * Update container metrics
   */
  updateContainerMetrics(containerId, resourceType, value, unit = '') {
    if (!this.config.businessMetrics.trackContainers) return;
    
    this.metrics.business.containerResourceUsage.set({
      container_id: containerId,
      resource: resourceType,
      unit
    }, value);
  }

  /**
   * Get metrics for Prometheus scraping
   */
  async getMetrics() {
    try {
      return await this.register.metrics();
    } catch (error) {
      logger.error('Failed to get metrics:', error);
      throw error;
    }
  }

  /**
   * Get metrics in JSON format
   */
  async getMetricsJSON() {
    try {
      return await this.register.getMetricsAsJSON();
    } catch (error) {
      logger.error('Failed to get metrics as JSON:', error);
      throw error;
    }
  }

  /**
   * Clear all metrics
   */
  clearMetrics() {
    this.register.clear();
    logger.info('Cleared all metrics');
  }

  /**
   * Get collection statistics
   */
  getStats() {
    return {
      isCollecting: this.isCollecting,
      stats: this.stats,
      lastCollection: this.lastCollection,
      metricsCount: Object.keys(this.metrics).reduce((count, category) => {
        return count + Object.keys(this.metrics[category]).length;
      }, 0),
      config: {
        interval: this.config.collection.interval,
        enabledFeatures: {
          defaultMetrics: this.config.collection.enableDefaultMetrics,
          businessMetrics: this.config.businessMetrics.enabled,
          performanceMetrics: this.config.performance.enabled,
          securityMetrics: this.config.businessMetrics.trackSecurity
        }
      }
    };
  }

  /**
   * Shutdown metrics collection
   */
  async shutdown() {
    logger.info('Shutting down Prometheus Metrics Collection');
    
    this.stopCollection();
    this.emit('shutdown');
    
    logger.info('Prometheus Metrics Collection shutdown completed');
  }
}

module.exports = PrometheusMetrics;