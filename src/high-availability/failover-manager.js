/**
 * Failover Manager
 * 
 * Provides automated detection and recovery from component failures,
 * with circuit breaker patterns and graceful service migration.
 */

const EventEmitter = require('events');
const { promisify: _promisify } = require('util');
const http = require('http');
const https = require('https');

class FailoverManager extends EventEmitter {
  constructor(healthChecker, orchestratorRedundancy, options = {}) {
    super();
    
    this.healthChecker = healthChecker;
    this.orchestratorRedundancy = orchestratorRedundancy;
    
    this.config = {
      checkInterval: options.checkInterval || 5000,
      failureThreshold: options.failureThreshold || 3,
      recoveryThreshold: options.recoveryThreshold || 2,
      failoverTimeout: options.failoverTimeout || 30000,
      circuitBreakerTimeout: options.circuitBreakerTimeout || 60000,
      maxConcurrentFailovers: options.maxConcurrentFailovers || 3,
      ...options
    };
    
    this.components = new Map();
    this.circuitBreakers = new Map();
    this.activeFailovers = new Set();
    this.failoverHistory = [];
    
    this.state = {
      status: 'initializing',
      totalFailovers: 0,
      successfulFailovers: 0,
      failedFailovers: 0,
      lastFailover: null
    };
    
    this.monitorTimer = null;
    this.logger = options.logger || console;
  }
  
  /**
   * Initialize the failover manager
   */
  async initialize() {
    try {
      this.logger.info('Initializing failover manager');
      
      await this.setupDefaultComponents();
      this.startMonitoring();
      
      this.state.status = 'active';
      this.emit('initialized');
      
      this.logger.info('Failover manager initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize failover manager', error);
      throw error;
    }
  }
  
  /**
   * Setup default components to monitor
   */
  async setupDefaultComponents() {
    // Core application components
    this.registerComponent('api-server', {
      type: 'http',
      primaryEndpoint: 'http://localhost:3001/health',
      fallbackEndpoints: ['http://localhost:3002/health'],
      healthCheck: () => this.checkHttpHealth('http://localhost:3001/health'),
      failoverAction: () => this.failoverHttpService('api-server'),
      recoveryAction: () => this.recoverHttpService('api-server'),
      criticalComponent: true
    });
    
    this.registerComponent('database', {
      type: 'database',
      primaryEndpoint: 'postgresql://localhost:5432',
      fallbackEndpoints: ['postgresql://backup:5432'],
      healthCheck: () => this.healthChecker.checkDatabaseHealth(),
      failoverAction: () => this.failoverDatabase(),
      recoveryAction: () => this.recoverDatabase(),
      criticalComponent: true
    });
    
    this.registerComponent('redis', {
      type: 'cache',
      primaryEndpoint: 'redis://localhost:6379',
      fallbackEndpoints: ['redis://backup:6379'],
      healthCheck: () => this.healthChecker.checkRedisHealth(),
      failoverAction: () => this.failoverRedis(),
      recoveryAction: () => this.recoverRedis(),
      criticalComponent: false
    });
    
    this.registerComponent('container-orchestrator', {
      type: 'orchestrator',
      healthCheck: () => this.healthChecker.checkOrchestratorHealth(),
      failoverAction: () => this.failoverOrchestrator(),
      recoveryAction: () => this.recoverOrchestrator(),
      criticalComponent: true
    });
    
    this.registerComponent('monitoring', {
      type: 'monitoring',
      primaryEndpoint: 'http://localhost:9090/api/v1/query',
      healthCheck: () => this.healthChecker.checkMonitoringHealth(),
      failoverAction: () => this.failoverMonitoring(),
      recoveryAction: () => this.recoverMonitoring(),
      criticalComponent: false
    });
  }
  
  /**
   * Register a component for failover management
   */
  registerComponent(name, config) {
    this.components.set(name, {
      name,
      ...config,
      status: 'unknown',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastCheck: null,
      lastFailover: null,
      failoverCount: 0
    });
    
    // Initialize circuit breaker
    this.circuitBreakers.set(name, {
      state: 'closed', // closed, open, half-open
      failureCount: 0,
      lastFailureTime: null,
      nextAttemptTime: null
    });
    
    this.logger.info('Registered component for failover management', {
      component: name,
      type: config.type,
      critical: config.criticalComponent
    });
  }
  
  /**
   * Start monitoring all components
   */
  startMonitoring() {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
    }
    
    this.monitorTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.checkInterval);
    
    this.logger.info('Started failover monitoring', {
      interval: this.config.checkInterval,
      components: Array.from(this.components.keys())
    });
  }
  
  /**
   * Perform health checks on all components
   */
  async performHealthChecks() {
    const promises = Array.from(this.components.entries()).map(
      ([name, component]) => this.checkComponentHealth(name, component)
    );
    
    await Promise.allSettled(promises);
  }
  
  /**
   * Check health of a specific component
   */
  async checkComponentHealth(name, component) {
    try {
      // Skip if circuit breaker is open
      const circuitBreaker = this.circuitBreakers.get(name);
      if (circuitBreaker.state === 'open') {
        if (Date.now() < circuitBreaker.nextAttemptTime) {
          return; // Still in cooldown period
        }
        // Try half-open state
        circuitBreaker.state = 'half-open';
      }
      
      const startTime = Date.now();
      const healthResult = await Promise.race([
        component.healthCheck(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 10000)
        )
      ]);
      
      const responseTime = Date.now() - startTime;
      component.lastCheck = Date.now();
      
      if (healthResult.healthy) {
        await this.handleHealthyComponent(name, component, responseTime);
      } else {
        await this.handleUnhealthyComponent(name, component, healthResult.error);
      }
      
    } catch (error) {
      await this.handleUnhealthyComponent(name, component, error);
    }
  }
  
  /**
   * Handle healthy component status
   */
  async handleHealthyComponent(name, component, responseTime) {
    const wasUnhealthy = component.status === 'unhealthy';
    
    component.status = 'healthy';
    component.consecutiveFailures = 0;
    component.consecutiveSuccesses++;
    
    // Update circuit breaker
    const circuitBreaker = this.circuitBreakers.get(name);
    if (circuitBreaker.state === 'half-open') {
      if (component.consecutiveSuccesses >= this.config.recoveryThreshold) {
        circuitBreaker.state = 'closed';
        circuitBreaker.failureCount = 0;
        this.logger.info('Circuit breaker closed', { component: name });
      }
    }
    
    // Trigger recovery if component was previously unhealthy
    if (wasUnhealthy && component.consecutiveSuccesses >= this.config.recoveryThreshold) {
      await this.triggerRecovery(name, component);
    }
    
    this.emit('componentHealthy', {
      component: name,
      responseTime,
      consecutiveSuccesses: component.consecutiveSuccesses
    });
  }
  
  /**
   * Handle unhealthy component status
   */
  async handleUnhealthyComponent(name, component, error) {
    component.status = 'unhealthy';
    component.consecutiveSuccesses = 0;
    component.consecutiveFailures++;
    
    // Update circuit breaker
    const circuitBreaker = this.circuitBreakers.get(name);
    circuitBreaker.failureCount++;
    circuitBreaker.lastFailureTime = Date.now();
    
    if (circuitBreaker.failureCount >= this.config.failureThreshold) {
      circuitBreaker.state = 'open';
      circuitBreaker.nextAttemptTime = Date.now() + this.config.circuitBreakerTimeout;
      this.logger.warn('Circuit breaker opened', { component: name });
    }
    
    this.logger.warn('Component health check failed', {
      component: name,
      error: error.message,
      consecutiveFailures: component.consecutiveFailures,
      circuitBreakerState: circuitBreaker.state
    });
    
    // Trigger failover if threshold reached
    if (component.consecutiveFailures >= this.config.failureThreshold) {
      await this.triggerFailover(name, component);
    }
    
    this.emit('componentUnhealthy', {
      component: name,
      error: error.message,
      consecutiveFailures: component.consecutiveFailures
    });
  }
  
  /**
   * Trigger failover for a component
   */
  async triggerFailover(name, component) {
    // Check if we can perform more failovers
    if (this.activeFailovers.size >= this.config.maxConcurrentFailovers) {
      this.logger.warn('Max concurrent failovers reached, queuing failover', {
        component: name,
        activeFailovers: this.activeFailovers.size
      });
      return;
    }
    
    // Check if failover is already in progress
    if (this.activeFailovers.has(name)) {
      return;
    }
    
    this.activeFailovers.add(name);
    this.state.totalFailovers++;
    component.failoverCount++;
    component.lastFailover = Date.now();
    this.state.lastFailover = Date.now();
    
    try {
      this.logger.info('Triggering failover', {
        component: name,
        type: component.type,
        criticalComponent: component.criticalComponent
      });
      
      const failoverResult = await Promise.race([
        component.failoverAction(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Failover timeout')), this.config.failoverTimeout)
        )
      ]);
      
      if (failoverResult.success) {
        this.state.successfulFailovers++;
        this.logger.info('Failover completed successfully', {
          component: name,
          result: failoverResult
        });
        
        this.emit('failoverSuccess', {
          component: name,
          result: failoverResult,
          timestamp: Date.now()
        });
      } else {
        throw new Error(failoverResult.error || 'Failover failed');
      }
      
    } catch (error) {
      this.state.failedFailovers++;
      this.logger.error('Failover failed', {
        component: name,
        error: error.message
      });
      
      this.emit('failoverFailed', {
        component: name,
        error: error.message,
        timestamp: Date.now()
      });
    } finally {
      this.activeFailovers.delete(name);
      
      // Record failover in history
      this.failoverHistory.push({
        component: name,
        timestamp: Date.now(),
        success: !this.activeFailovers.has(name)
      });
      
      // Keep only last 100 entries
      if (this.failoverHistory.length > 100) {
        this.failoverHistory = this.failoverHistory.slice(-100);
      }
    }
  }
  
  /**
   * Trigger recovery for a component
   */
  async triggerRecovery(name, component) {
    try {
      this.logger.info('Triggering recovery', { component: name });
      
      const recoveryResult = await component.recoveryAction();
      
      if (recoveryResult.success) {
        this.logger.info('Recovery completed successfully', {
          component: name,
          result: recoveryResult
        });
        
        this.emit('recoverySuccess', {
          component: name,
          result: recoveryResult,
          timestamp: Date.now()
        });
      }
      
    } catch (error) {
      this.logger.error('Recovery failed', {
        component: name,
        error: error.message
      });
      
      this.emit('recoveryFailed', {
        component: name,
        error: error.message,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Check HTTP service health
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
              healthy: res.statusCode === 200 && result.status === 'healthy',
              statusCode: res.statusCode,
              data: result
            });
          } catch {
            resolve({
              healthy: res.statusCode === 200,
              statusCode: res.statusCode
            });
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('HTTP health check timeout'));
      });
    });
  }
  
  /**
   * Failover HTTP service
   */
  async failoverHttpService(serviceName) {
    // Implementation would depend on your load balancer/service discovery
    this.logger.info('Failing over HTTP service', { service: serviceName });
    
    // Example: Update load balancer configuration
    // Example: Start backup instance
    // Example: Update service discovery records
    
    return { success: true, message: 'HTTP service failover initiated' };
  }
  
  /**
   * Recover HTTP service
   */
  async recoverHttpService(serviceName) {
    this.logger.info('Recovering HTTP service', { service: serviceName });
    
    // Example: Restore primary service to load balancer
    // Example: Gracefully drain backup instance
    
    return { success: true, message: 'HTTP service recovery initiated' };
  }
  
  /**
   * Failover database
   */
  async failoverDatabase() {
    this.logger.info('Failing over database');
    
    // Example: Promote read replica to primary
    // Example: Update connection strings
    // Example: Notify applications of new primary
    
    return { success: true, message: 'Database failover initiated' };
  }
  
  /**
   * Recover database
   */
  async recoverDatabase() {
    this.logger.info('Recovering database');
    
    // Example: Re-establish replication
    // Example: Validate data consistency
    
    return { success: true, message: 'Database recovery initiated' };
  }
  
  /**
   * Failover Redis
   */
  async failoverRedis() {
    this.logger.info('Failing over Redis');
    
    // Example: Promote Redis replica
    // Example: Update Sentinel configuration
    
    return { success: true, message: 'Redis failover initiated' };
  }
  
  /**
   * Recover Redis
   */
  async recoverRedis() {
    this.logger.info('Recovering Redis');
    
    // Example: Re-establish master-replica relationship
    
    return { success: true, message: 'Redis recovery initiated' };
  }
  
  /**
   * Failover orchestrator
   */
  async failoverOrchestrator() {
    this.logger.info('Failing over orchestrator');
    
    // Trigger orchestrator leader election
    if (this.orchestratorRedundancy) {
      await this.orchestratorRedundancy.forceElection();
    }
    
    return { success: true, message: 'Orchestrator failover initiated' };
  }
  
  /**
   * Recover orchestrator
   */
  async recoverOrchestrator() {
    this.logger.info('Recovering orchestrator');
    
    // Orchestrator recovery is handled by redundancy system
    return { success: true, message: 'Orchestrator recovery handled by redundancy system' };
  }
  
  /**
   * Failover monitoring
   */
  async failoverMonitoring() {
    this.logger.info('Failing over monitoring');
    
    // Example: Start backup Prometheus instance
    // Example: Update scrape configurations
    
    return { success: true, message: 'Monitoring failover initiated' };
  }
  
  /**
   * Recover monitoring
   */
  async recoverMonitoring() {
    this.logger.info('Recovering monitoring');
    
    // Example: Restore primary monitoring stack
    
    return { success: true, message: 'Monitoring recovery initiated' };
  }
  
  /**
   * Force failover for a specific component
   */
  async forceFailover(componentName) {
    const component = this.components.get(componentName);
    if (!component) {
      throw new Error(`Component ${componentName} not found`);
    }
    
    this.logger.info('Forcing failover', { component: componentName });
    await this.triggerFailover(componentName, component);
  }
  
  /**
   * Get failover status
   */
  getFailoverStatus() {
    const components = Array.from(this.components.entries()).map(([name, component]) => ({
      name,
      status: component.status,
      type: component.type,
      critical: component.criticalComponent,
      consecutiveFailures: component.consecutiveFailures,
      consecutiveSuccesses: component.consecutiveSuccesses,
      failoverCount: component.failoverCount,
      lastCheck: component.lastCheck,
      lastFailover: component.lastFailover,
      circuitBreakerState: this.circuitBreakers.get(name).state
    }));
    
    return {
      status: this.state.status,
      totalFailovers: this.state.totalFailovers,
      successfulFailovers: this.state.successfulFailovers,
      failedFailovers: this.state.failedFailovers,
      lastFailover: this.state.lastFailover,
      activeFailovers: this.activeFailovers.size,
      components,
      recentFailovers: this.failoverHistory.slice(-10)
    };
  }
  
  /**
   * Stop monitoring
   */
  stop() {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    
    this.state.status = 'stopped';
    this.emit('stopped');
    
    this.logger.info('Failover manager stopped');
  }
}

module.exports = FailoverManager;