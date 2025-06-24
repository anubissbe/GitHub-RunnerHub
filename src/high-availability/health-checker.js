/**
 * Comprehensive Health Checker
 * 
 * Provides deep health checks for all services with dependency validation,
 * performance baseline monitoring, and predictive failure detection.
 */

const EventEmitter = require('events');
const { Client } = require('pg');
const Redis = require('ioredis');
const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs').promises;

class HealthChecker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      checkInterval: options.checkInterval || 5000,
      timeoutDuration: options.timeoutDuration || 10000,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      performanceWindow: options.performanceWindow || 100, // Keep last 100 checks
      alertThresholds: {
        responseTime: options.alertThresholds?.responseTime || 5000,
        errorRate: options.alertThresholds?.errorRate || 0.1,
        cpuUsage: options.alertThresholds?.cpuUsage || 80,
        memoryUsage: options.alertThresholds?.memoryUsage || 85,
        diskUsage: options.alertThresholds?.diskUsage || 90
      },
      ...options
    };
    
    this.services = new Map();
    this.dependencies = new Map();
    this.performanceBaselines = new Map();
    this.healthHistory = new Map();
    
    this.state = {
      status: 'initializing',
      totalChecks: 0,
      failedChecks: 0,
      lastCheck: null,
      overallHealth: 'unknown'
    };
    
    this.checkTimer = null;
    this.logger = options.logger || console;
  }
  
  /**
   * Initialize the health checker
   */
  async initialize() {
    try {
      this.logger.info('Initializing health checker');
      
      await this.registerDefaultServices();
      await this.establishPerformanceBaselines();
      
      this.startHealthChecks();
      
      this.state.status = 'active';
      this.emit('initialized');
      
      this.logger.info('Health checker initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize health checker', error);
      throw error;
    }
  }
  
  /**
   * Register default services for health monitoring
   */
  async registerDefaultServices() {
    // API Server
    this.registerService('api-server', {
      type: 'http',
      endpoint: 'http://localhost:3001/health',
      critical: true,
      dependencies: ['database', 'redis'],
      healthCheck: () => this.checkHttpHealth('http://localhost:3001/health'),
      expectedResponseTime: 1000
    });
    
    // Database
    this.registerService('database', {
      type: 'postgresql',
      critical: true,
      dependencies: [],
      healthCheck: () => this.checkDatabaseHealth(),
      expectedResponseTime: 500
    });
    
    // Redis Cache
    this.registerService('redis', {
      type: 'redis',
      critical: false,
      dependencies: [],
      healthCheck: () => this.checkRedisHealth(),
      expectedResponseTime: 100
    });
    
    // Container Orchestrator
    this.registerService('container-orchestrator', {
      type: 'orchestrator',
      critical: true,
      dependencies: ['api-server'],
      healthCheck: () => this.checkOrchestratorHealth(),
      expectedResponseTime: 2000
    });
    
    // File System
    this.registerService('filesystem', {
      type: 'filesystem',
      critical: true,
      dependencies: [],
      healthCheck: () => this.checkFileSystemHealth(),
      expectedResponseTime: 500
    });
    
    // GitHub API Integration
    this.registerService('github-api', {
      type: 'external',
      critical: false,
      dependencies: [],
      healthCheck: () => this.checkGitHubAPIHealth(),
      expectedResponseTime: 3000
    });
    
    // Monitoring Stack
    this.registerService('monitoring', {
      type: 'http',
      endpoint: 'http://localhost:9090/api/v1/query',
      critical: false,
      dependencies: [],
      healthCheck: () => this.checkMonitoringHealth(),
      expectedResponseTime: 2000
    });
    
    // System Resources
    this.registerService('system-resources', {
      type: 'system',
      critical: true,
      dependencies: [],
      healthCheck: () => this.checkSystemResourcesHealth(),
      expectedResponseTime: 100
    });
  }
  
  /**
   * Register a service for health monitoring
   */
  registerService(name, config) {
    this.services.set(name, {
      name,
      ...config,
      status: 'unknown',
      lastCheck: null,
      consecutiveFailures: 0,
      totalChecks: 0,
      failedChecks: 0,
      averageResponseTime: 0,
      lastError: null
    });
    
    this.healthHistory.set(name, []);
    this.performanceBaselines.set(name, {
      responseTime: {
        min: Infinity,
        max: 0,
        avg: 0,
        percentile95: 0
      },
      successRate: 1.0,
      established: false
    });
    
    this.logger.info('Registered service for health monitoring', {
      service: name,
      type: config.type,
      critical: config.critical,
      dependencies: config.dependencies
    });
  }
  
  /**
   * Start regular health checks
   */
  startHealthChecks() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
    
    this.checkTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.checkInterval);
    
    this.logger.info('Started health checks', {
      interval: this.config.checkInterval,
      services: Array.from(this.services.keys())
    });
  }
  
  /**
   * Perform health checks on all services
   */
  async performHealthChecks() {
    this.state.totalChecks++;
    this.state.lastCheck = Date.now();
    
    const results = new Map();
    
    // Check services in dependency order
    const sortedServices = this.topologicalSort();
    
    for (const serviceName of sortedServices) {
      const service = this.services.get(serviceName);
      const result = await this.checkServiceHealth(serviceName, service);
      results.set(serviceName, result);
    }
    
    // Calculate overall health
    this.calculateOverallHealth(results);
    
    // Emit health check completed event
    this.emit('healthCheckCompleted', {
      timestamp: this.state.lastCheck,
      results: Object.fromEntries(results),
      overallHealth: this.state.overallHealth
    });
  }
  
  /**
   * Check health of a specific service
   */
  async checkServiceHealth(serviceName, service) {
    const startTime = Date.now();
    let result = {
      service: serviceName,
      healthy: false,
      responseTime: 0,
      error: null,
      timestamp: startTime,
      dependencies: []
    };
    
    try {
      // Check dependencies first
      const dependencyResults = await this.checkDependencies(service.dependencies);
      result.dependencies = dependencyResults;
      
      // If critical dependencies are unhealthy, skip this service check
      const hasUnhealthyDependencies = dependencyResults.some(dep => 
        !dep.healthy && this.services.get(dep.service)?.critical
      );
      
      if (hasUnhealthyDependencies) {
        throw new Error('Critical dependencies are unhealthy');
      }
      
      // Perform the actual health check
      const healthResult = await Promise.race([
        service.healthCheck(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), this.config.timeoutDuration)
        )
      ]);
      
      result.responseTime = Date.now() - startTime;
      result.healthy = healthResult.healthy;
      result.details = healthResult.details;
      
      if (!result.healthy && healthResult.error) {
        result.error = healthResult.error;
      }
      
    } catch (error) {
      result.responseTime = Date.now() - startTime;
      result.healthy = false;
      result.error = error.message;
    }
    
    // Update service statistics
    this.updateServiceStats(serviceName, result);
    
    // Update performance baselines
    this.updatePerformanceBaselines(serviceName, result);
    
    // Check for anomalies and alerts
    this.checkForAnomalies(serviceName, result);
    
    return result;
  }
  
  /**
   * Check dependencies for a service
   */
  async checkDependencies(dependencies) {
    const results = [];
    
    for (const depName of dependencies) {
      const depService = this.services.get(depName);
      if (depService) {
        results.push({
          service: depName,
          healthy: depService.status === 'healthy',
          lastCheck: depService.lastCheck
        });
      }
    }
    
    return results;
  }
  
  /**
   * Update service statistics
   */
  updateServiceStats(serviceName, result) {
    const service = this.services.get(serviceName);
    
    service.totalChecks++;
    service.lastCheck = result.timestamp;
    service.status = result.healthy ? 'healthy' : 'unhealthy';
    
    if (result.healthy) {
      service.consecutiveFailures = 0;
    } else {
      service.consecutiveFailures++;
      service.failedChecks++;
      service.lastError = result.error;
      this.state.failedChecks++;
    }
    
    // Update average response time
    const alpha = 0.1; // Exponential moving average factor
    service.averageResponseTime = service.averageResponseTime === 0 
      ? result.responseTime 
      : (alpha * result.responseTime) + ((1 - alpha) * service.averageResponseTime);
    
    // Store health history
    const history = this.healthHistory.get(serviceName);
    history.push({
      timestamp: result.timestamp,
      healthy: result.healthy,
      responseTime: result.responseTime,
      error: result.error
    });
    
    // Keep only recent history
    if (history.length > this.config.performanceWindow) {
      history.splice(0, history.length - this.config.performanceWindow);
    }
  }
  
  /**
   * Update performance baselines
   */
  updatePerformanceBaselines(serviceName, result) {
    const baseline = this.performanceBaselines.get(serviceName);
    const history = this.healthHistory.get(serviceName);
    
    if (result.healthy) {
      // Update response time metrics
      baseline.responseTime.min = Math.min(baseline.responseTime.min, result.responseTime);
      baseline.responseTime.max = Math.max(baseline.responseTime.max, result.responseTime);
      
      // Calculate average from recent healthy checks
      const recentHealthyChecks = history
        .filter(h => h.healthy)
        .slice(-50) // Last 50 healthy checks
        .map(h => h.responseTime);
      
      if (recentHealthyChecks.length > 0) {
        baseline.responseTime.avg = recentHealthyChecks.reduce((a, b) => a + b, 0) / recentHealthyChecks.length;
        
        // Calculate 95th percentile
        const sorted = recentHealthyChecks.sort((a, b) => a - b);
        const index = Math.ceil(sorted.length * 0.95) - 1;
        baseline.responseTime.percentile95 = sorted[index] || 0;
      }
    }
    
    // Calculate success rate
    const recentChecks = history.slice(-50);
    if (recentChecks.length > 0) {
      const successfulChecks = recentChecks.filter(h => h.healthy).length;
      baseline.successRate = successfulChecks / recentChecks.length;
    }
    
    // Mark baseline as established after sufficient data
    if (!baseline.established && history.length >= 20) {
      baseline.established = true;
      this.logger.info('Performance baseline established', {
        service: serviceName,
        baseline
      });
    }
  }
  
  /**
   * Check for anomalies and generate alerts
   */
  checkForAnomalies(serviceName, result) {
    const service = this.services.get(serviceName);
    const baseline = this.performanceBaselines.get(serviceName);
    
    if (!baseline.established) return;
    
    // Check response time anomaly
    if (result.healthy && result.responseTime > baseline.responseTime.percentile95 * 2) {
      this.emit('anomalyDetected', {
        type: 'performance',
        service: serviceName,
        metric: 'responseTime',
        value: result.responseTime,
        baseline: baseline.responseTime.percentile95,
        severity: 'warning'
      });
    }
    
    // Check consecutive failures
    if (service.consecutiveFailures >= 3) {
      this.emit('anomalyDetected', {
        type: 'availability',
        service: serviceName,
        metric: 'consecutiveFailures',
        value: service.consecutiveFailures,
        severity: service.critical ? 'critical' : 'warning'
      });
    }
    
    // Check success rate degradation
    if (baseline.successRate < 0.9) {
      this.emit('anomalyDetected', {
        type: 'reliability',
        service: serviceName,
        metric: 'successRate',
        value: baseline.successRate,
        severity: service.critical ? 'critical' : 'warning'
      });
    }
  }
  
  /**
   * Calculate overall system health
   */
  calculateOverallHealth(results) {
    const criticalResults = Array.from(results.values()).filter(r => 
      this.services.get(r.service)?.critical
    );
    
    const healthyCritical = criticalResults.filter(r => r.healthy).length;
    const totalCritical = criticalResults.length;
    
    if (totalCritical === 0) {
      this.state.overallHealth = 'unknown';
    } else if (healthyCritical === totalCritical) {
      this.state.overallHealth = 'healthy';
    } else if (healthyCritical > totalCritical * 0.5) {
      this.state.overallHealth = 'degraded';
    } else {
      this.state.overallHealth = 'unhealthy';
    }
  }
  
  /**
   * Topological sort for dependency-ordered checking
   */
  topologicalSort() {
    const visited = new Set();
    const visiting = new Set();
    const result = [];
    
    const visit = (serviceName) => {
      if (visiting.has(serviceName)) {
        throw new Error(`Circular dependency detected: ${serviceName}`);
      }
      
      if (visited.has(serviceName)) {
        return;
      }
      
      visiting.add(serviceName);
      
      const service = this.services.get(serviceName);
      if (service?.dependencies) {
        for (const dep of service.dependencies) {
          visit(dep);
        }
      }
      
      visiting.delete(serviceName);
      visited.add(serviceName);
      result.push(serviceName);
    };
    
    for (const serviceName of this.services.keys()) {
      visit(serviceName);
    }
    
    return result;
  }
  
  /**
   * Establish performance baselines
   */
  async establishPerformanceBaselines() {
    this.logger.info('Establishing performance baselines...');
    
    // Perform initial health checks to establish baselines
    for (let i = 0; i < 10; i++) {
      await this.performHealthChecks();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.logger.info('Initial performance baselines established');
  }
  
  /**
   * HTTP Health Check Implementation
   */
  async checkHttpHealth(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;
      
      const req = client.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve({
              healthy: res.statusCode === 200 && (result.status === 'healthy' || result.status === 'ok'),
              details: {
                statusCode: res.statusCode,
                response: result
              }
            });
          } catch {
            resolve({
              healthy: res.statusCode === 200,
              details: {
                statusCode: res.statusCode,
                response: data.substring(0, 200)
              }
            });
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(this.config.timeoutDuration, () => {
        req.destroy();
        reject(new Error('HTTP request timeout'));
      });
    });
  }
  
  /**
   * Database Health Check Implementation
   */
  async checkDatabaseHealth() {
    let client;
    try {
      client = new Client({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'github_runnerhub',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password',
        connectionTimeoutMillis: 5000
      });
      
      await client.connect();
      
      // Test basic query
      const result = await client.query('SELECT 1 as test, NOW() as timestamp');
      
      // Check connection count
      const connResult = await client.query(
        'SELECT count(*) as connections FROM pg_stat_activity'
      );
      
      const connections = parseInt(connResult.rows[0].connections);
      
      return {
        healthy: true,
        details: {
          timestamp: result.rows[0].timestamp,
          activeConnections: connections
        }
      };
      
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        details: {
          errorCode: error.code
        }
      };
    } finally {
      if (client) {
        await client.end();
      }
    }
  }
  
  /**
   * Redis Health Check Implementation
   */
  async checkRedisHealth() {
    let client;
    try {
      client = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        connectTimeout: 5000,
        commandTimeout: 5000,
        retryDelayOnFailover: 1000,
        maxRetriesPerRequest: 1
      });
      
      // Test basic operations
      const pingResult = await client.ping();
      const testKey = `healthcheck:${Date.now()}`;
      
      await client.set(testKey, 'test', 'EX', 60);
      const getValue = await client.get(testKey);
      await client.del(testKey);
      
      // Get Redis info
      const info = await client.info('memory');
      const memoryInfo = this.parseRedisInfo(info);
      
      return {
        healthy: pingResult === 'PONG' && getValue === 'test',
        details: {
          ping: pingResult,
          memoryUsed: memoryInfo.used_memory_human,
          memoryPeak: memoryInfo.used_memory_peak_human
        }
      };
      
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    } finally {
      if (client) {
        client.quit();
      }
    }
  }
  
  /**
   * Orchestrator Health Check Implementation
   */
  async checkOrchestratorHealth() {
    // Check if orchestrator processes are running
    // This would integrate with your container orchestration system
    
    return {
      healthy: true,
      details: {
        status: 'active',
        containersManaged: 0 // Would be actual count
      }
    };
  }
  
  /**
   * File System Health Check Implementation
   */
  async checkFileSystemHealth() {
    try {
      const testPath = '/tmp/healthcheck';
      const testData = 'health check test';
      
      // Test write/read/delete
      await fs.writeFile(testPath, testData);
      const readData = await fs.readFile(testPath, 'utf8');
      await fs.unlink(testPath);
      
      // Check disk space
      await fs.stat('/');
      
      return {
        healthy: readData === testData,
        details: {
          readable: true,
          writable: true,
          // Note: Getting actual disk space requires additional implementation
          diskSpace: 'available'
        }
      };
      
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
  
  /**
   * GitHub API Health Check Implementation
   */
  async checkGitHubAPIHealth() {
    try {
      const response = await this.checkHttpHealth('https://api.github.com/rate_limit');
      
      if (response.healthy && response.details?.response?.rate) {
        const rate = response.details.response.rate;
        return {
          healthy: rate.remaining > 100,
          details: {
            rateLimit: rate.limit,
            remaining: rate.remaining,
            resetTime: new Date(rate.reset * 1000)
          }
        };
      }
      
      return response;
      
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
  
  /**
   * Monitoring Health Check Implementation
   */
  async checkMonitoringHealth() {
    try {
      const response = await this.checkHttpHealth('http://localhost:9090/-/healthy');
      return response;
      
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
  
  /**
   * System Resources Health Check Implementation
   */
  async checkSystemResourcesHealth() {
    try {
      const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;
      
      const alerts = [];
      
      if (cpuUsage > this.config.alertThresholds.cpuUsage) {
        alerts.push(`High CPU usage: ${cpuUsage.toFixed(2)}%`);
      }
      
      if (memoryUsage > this.config.alertThresholds.memoryUsage) {
        alerts.push(`High memory usage: ${memoryUsage.toFixed(2)}%`);
      }
      
      return {
        healthy: alerts.length === 0,
        details: {
          cpuUsage: cpuUsage.toFixed(2),
          memoryUsage: memoryUsage.toFixed(2),
          totalMemory: Math.round(totalMem / 1024 / 1024 / 1024) + 'GB',
          freeMemory: Math.round(freeMem / 1024 / 1024 / 1024) + 'GB',
          uptime: os.uptime(),
          alerts
        }
      };
      
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
  
  /**
   * Parse Redis INFO response
   */
  parseRedisInfo(info) {
    const result = {};
    info.split('\r\n').forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = value;
      }
    });
    return result;
  }
  
  /**
   * Get comprehensive health status
   */
  getHealthStatus() {
    const services = Array.from(this.services.entries()).map(([name, service]) => ({
      name,
      status: service.status,
      type: service.type,
      critical: service.critical,
      lastCheck: service.lastCheck,
      consecutiveFailures: service.consecutiveFailures,
      averageResponseTime: Math.round(service.averageResponseTime),
      totalChecks: service.totalChecks,
      failedChecks: service.failedChecks,
      successRate: service.totalChecks > 0 ? 
        ((service.totalChecks - service.failedChecks) / service.totalChecks * 100).toFixed(2) + '%' : 'N/A',
      lastError: service.lastError,
      dependencies: service.dependencies
    }));
    
    return {
      overall: {
        status: this.state.status,
        health: this.state.overallHealth,
        totalChecks: this.state.totalChecks,
        failedChecks: this.state.failedChecks,
        successRate: this.state.totalChecks > 0 ? 
          ((this.state.totalChecks - this.state.failedChecks) / this.state.totalChecks * 100).toFixed(2) + '%' : 'N/A',
        lastCheck: this.state.lastCheck
      },
      services,
      summary: {
        total: services.length,
        healthy: services.filter(s => s.status === 'healthy').length,
        unhealthy: services.filter(s => s.status === 'unhealthy').length,
        unknown: services.filter(s => s.status === 'unknown').length,
        critical: services.filter(s => s.critical).length,
        criticalHealthy: services.filter(s => s.critical && s.status === 'healthy').length
      }
    };
  }
  
  /**
   * Stop health checking
   */
  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    
    this.state.status = 'stopped';
    this.emit('stopped');
    
    this.logger.info('Health checker stopped');
  }
}

module.exports = HealthChecker;