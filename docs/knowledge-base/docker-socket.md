# Docker Socket - Container Monitoring

## Overview

Docker Socket provides access to the Docker daemon API through a Unix socket, enabling GitHub RunnerHub to manage runner containers, monitor their status, and collect metrics. This integration is crucial for the auto-scaling functionality and real-time monitoring capabilities.

## Official Resources

- **Docker Engine API**: https://docs.docker.com/engine/api/
- **Docker Socket Security**: https://docs.docker.com/engine/security/protect-access/
- **Dockerode Library**: https://github.com/apocas/dockerode
- **Docker Events API**: https://docs.docker.com/engine/api/v1.42/#operation/SystemEvents
- **Container Monitoring**: https://docs.docker.com/config/containers/runmetrics/

## Integration with GitHub RunnerHub

### Docker Socket Connection

```javascript
// services/docker-client.js
const Docker = require('dockerode');
const EventEmitter = require('events');

class DockerClient extends EventEmitter {
  constructor() {
    super();
    
    // Initialize Docker client with socket connection
    this.docker = new Docker({
      socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
      timeout: 30000
    });
    
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 5000;
    
    this.init();
  }

  async init() {
    try {
      // Test connection
      await this.docker.ping();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      console.log('Docker client connected successfully');
      this.emit('connected');
      
      // Start monitoring events
      this.startEventMonitoring();
      
    } catch (error) {
      console.error('Failed to connect to Docker:', error.message);
      this.isConnected = false;
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.init(), this.reconnectInterval);
      } else {
        this.emit('error', new Error('Max reconnection attempts reached'));
      }
    }
  }

  async startEventMonitoring() {
    try {
      const stream = await this.docker.getEvents({
        filters: {
          type: ['container'],
          label: ['app=github-runner']
        }
      });

      stream.setEncoding('utf8');
      
      stream.on('data', (chunk) => {
        const lines = chunk.split('\n').filter(line => line.trim());
        
        lines.forEach(line => {
          try {
            const event = JSON.parse(line);
            this.handleDockerEvent(event);
          } catch (error) {
            console.error('Failed to parse Docker event:', error);
          }
        });
      });

      stream.on('error', (error) => {
        console.error('Docker events stream error:', error);
        this.emit('events_error', error);
        
        // Attempt to restart event monitoring
        setTimeout(() => this.startEventMonitoring(), 5000);
      });

      stream.on('end', () => {
        console.log('Docker events stream ended');
        // Restart monitoring after delay
        setTimeout(() => this.startEventMonitoring(), 1000);
      });

    } catch (error) {
      console.error('Failed to start Docker event monitoring:', error);
      this.emit('events_error', error);
    }
  }

  handleDockerEvent(event) {
    const { Type, Action, Actor, time } = event;
    
    if (Type === 'container' && Actor.Attributes['app'] === 'github-runner') {
      const containerName = Actor.Attributes['name'];
      const containerId = Actor.ID;
      
      this.emit('runner_event', {
        action: Action,
        containerId,
        containerName,
        timestamp: new Date(time * 1000),
        attributes: Actor.Attributes
      });
      
      console.log(`Runner container event: ${Action} for ${containerName}`);
    }
  }

  async getRunnerContainers() {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: ['app=github-runner']
        }
      });

      return containers.map(container => ({
        id: container.Id,
        name: container.Names[0].substring(1), // Remove leading slash
        image: container.Image,
        state: container.State,
        status: container.Status,
        created: new Date(container.Created * 1000),
        ports: container.Ports,
        labels: container.Labels,
        networkSettings: container.NetworkSettings
      }));
    } catch (error) {
      console.error('Failed to get runner containers:', error);
      throw error;
    }
  }

  async getContainerStats(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });
      
      return this.parseContainerStats(stats);
    } catch (error) {
      console.error(`Failed to get stats for container ${containerId}:`, error);
      throw error;
    }
  }

  parseContainerStats(stats) {
    // Calculate CPU usage percentage
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                    (stats.precpu_stats.cpu_usage?.total_usage || 0);
    const systemDelta = stats.cpu_stats.system_cpu_usage - 
                       (stats.precpu_stats.system_cpu_usage || 0);
    const cpuPercent = systemDelta > 0 && cpuDelta > 0 
      ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 
      : 0;

    // Calculate memory usage
    const memoryUsage = stats.memory_stats.usage || 0;
    const memoryLimit = stats.memory_stats.limit || 0;
    const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

    // Calculate network I/O
    const networks = stats.networks || {};
    const networkRx = Object.values(networks).reduce((sum, net) => sum + (net.rx_bytes || 0), 0);
    const networkTx = Object.values(networks).reduce((sum, net) => sum + (net.tx_bytes || 0), 0);

    // Calculate block I/O
    const blockIO = stats.blkio_stats.io_service_bytes_recursive || [];
    const diskRead = blockIO.find(io => io.op === 'Read')?.value || 0;
    const diskWrite = blockIO.find(io => io.op === 'Write')?.value || 0;

    return {
      timestamp: new Date(),
      cpu: {
        usage_percent: Math.round(cpuPercent * 100) / 100,
        throttling: stats.cpu_stats.throttling_data
      },
      memory: {
        usage_bytes: memoryUsage,
        limit_bytes: memoryLimit,
        usage_percent: Math.round(memoryPercent * 100) / 100,
        cache: stats.memory_stats.stats?.cache || 0
      },
      network: {
        rx_bytes: networkRx,
        tx_bytes: networkTx
      },
      disk: {
        read_bytes: diskRead,
        write_bytes: diskWrite
      },
      pids: stats.pids_stats?.current || 0
    };
  }

  async createRunnerContainer(config) {
    try {
      const containerConfig = {
        Image: config.image || 'myoung34/github-runner:latest',
        name: config.name,
        Env: config.environment || [],
        Labels: {
          'app': 'github-runner',
          'repository': config.repository,
          'runner-type': config.type || 'dedicated',
          'created-by': 'runnerhub',
          'created-at': new Date().toISOString()
        },
        HostConfig: {
          AutoRemove: config.autoRemove || false,
          RestartPolicy: {
            Name: config.restartPolicy || 'unless-stopped'
          },
          Memory: config.memoryLimit || 2 * 1024 * 1024 * 1024, // 2GB
          CpuShares: config.cpuShares || 1024,
          Binds: config.volumes || [
            '/var/run/docker.sock:/var/run/docker.sock:ro'
          ],
          SecurityOpt: ['no-new-privileges'],
          ReadonlyRootfs: false // GitHub runner needs write access
        },
        NetworkingConfig: {
          EndpointsConfig: {
            [config.network || 'bridge']: {}
          }
        }
      };

      const container = await this.docker.createContainer(containerConfig);
      await container.start();

      return {
        id: container.id,
        name: config.name,
        created: true
      };
    } catch (error) {
      console.error('Failed to create runner container:', error);
      throw error;
    }
  }

  async removeRunnerContainer(containerId, force = false) {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Stop container gracefully first
      if (!force) {
        try {
          await container.stop({ t: 30 }); // 30 second grace period
        } catch (error) {
          console.warn(`Failed to stop container gracefully: ${error.message}`);
        }
      }

      // Remove container
      await container.remove({ force: force });
      
      return { removed: true, id: containerId };
    } catch (error) {
      console.error(`Failed to remove container ${containerId}:`, error);
      throw error;
    }
  }

  async getContainerLogs(containerId, options = {}) {
    try {
      const container = this.docker.getContainer(containerId);
      
      const logOptions = {
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: options.tail || 100,
        since: options.since || 0,
        ...options
      };

      const stream = await container.logs(logOptions);
      
      return stream.toString('utf8');
    } catch (error) {
      console.error(`Failed to get logs for container ${containerId}:`, error);
      throw error;
    }
  }

  async executeCommand(containerId, command) {
    try {
      const container = this.docker.getContainer(containerId);
      
      const exec = await container.exec({
        Cmd: typeof command === 'string' ? command.split(' ') : command,
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start();
      
      return new Promise((resolve, reject) => {
        let output = '';
        
        stream.on('data', (chunk) => {
          output += chunk.toString();
        });
        
        stream.on('end', () => {
          resolve(output);
        });
        
        stream.on('error', reject);
      });
    } catch (error) {
      console.error(`Failed to execute command in container ${containerId}:`, error);
      throw error;
    }
  }
}

module.exports = DockerClient;
```

### Container Monitoring Service

```javascript
// services/container-monitor.js
class ContainerMonitor extends EventEmitter {
  constructor(dockerClient, redis) {
    super();
    this.docker = dockerClient;
    this.redis = redis;
    this.monitoringInterval = 30000; // 30 seconds
    this.statsHistory = new Map();
    this.alertThresholds = {
      cpu: 90,
      memory: 85,
      disk: 80
    };
    
    this.startMonitoring();
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.docker.on('runner_event', (event) => {
      this.handleRunnerEvent(event);
    });

    this.docker.on('connected', () => {
      console.log('Docker client reconnected, resuming monitoring');
      this.startMonitoring();
    });
  }

  async startMonitoring() {
    console.log('Starting container monitoring...');
    
    // Initial scan
    await this.scanContainers();
    
    // Set up periodic monitoring
    this.monitoringTimer = setInterval(() => {
      this.scanContainers().catch(error => {
        console.error('Container monitoring error:', error);
      });
    }, this.monitoringInterval);
  }

  async scanContainers() {
    try {
      const containers = await this.docker.getRunnerContainers();
      
      for (const container of containers) {
        if (container.state === 'running') {
          await this.monitorContainer(container);
        }
      }
      
      // Clean up stats for removed containers
      this.cleanupStatsHistory(containers.map(c => c.id));
      
    } catch (error) {
      console.error('Failed to scan containers:', error);
    }
  }

  async monitorContainer(container) {
    try {
      const stats = await this.docker.getContainerStats(container.id);
      
      // Store current stats
      this.updateStatsHistory(container.id, stats);
      
      // Check for alerts
      this.checkResourceAlerts(container, stats);
      
      // Emit monitoring event
      this.emit('container_stats', {
        container: container,
        stats: stats,
        timestamp: stats.timestamp
      });
      
      // Store in Redis for real-time access
      await this.redis.setex(
        `container_stats:${container.id}`,
        60, // 1 minute TTL
        JSON.stringify({
          container: {
            id: container.id,
            name: container.name,
            state: container.state
          },
          stats: stats
        })
      );
      
    } catch (error) {
      console.error(`Failed to monitor container ${container.id}:`, error);
    }
  }

  updateStatsHistory(containerId, stats) {
    if (!this.statsHistory.has(containerId)) {
      this.statsHistory.set(containerId, []);
    }
    
    const history = this.statsHistory.get(containerId);
    history.push(stats);
    
    // Keep only last 100 entries (roughly 50 minutes of data)
    if (history.length > 100) {
      history.shift();
    }
  }

  checkResourceAlerts(container, stats) {
    const alerts = [];
    
    // CPU usage alert
    if (stats.cpu.usage_percent > this.alertThresholds.cpu) {
      alerts.push({
        type: 'high_cpu',
        severity: 'warning',
        value: stats.cpu.usage_percent,
        threshold: this.alertThresholds.cpu
      });
    }
    
    // Memory usage alert
    if (stats.memory.usage_percent > this.alertThresholds.memory) {
      alerts.push({
        type: 'high_memory',
        severity: 'warning',
        value: stats.memory.usage_percent,
        threshold: this.alertThresholds.memory
      });
    }
    
    // Disk I/O alert (if very high)
    const diskWriteMB = stats.disk.write_bytes / 1024 / 1024;
    if (diskWriteMB > 100) { // > 100MB/s
      alerts.push({
        type: 'high_disk_io',
        severity: 'info',
        value: diskWriteMB,
        unit: 'MB/s'
      });
    }
    
    if (alerts.length > 0) {
      this.emit('resource_alert', {
        container: container,
        alerts: alerts,
        timestamp: new Date()
      });
    }
  }

  async handleRunnerEvent(event) {
    console.log(`Container event: ${event.action} for ${event.containerName}`);
    
    const eventData = {
      ...event,
      processed_at: new Date()
    };
    
    // Store event in Redis
    await this.redis.lpush(
      'container_events',
      JSON.stringify(eventData)
    );
    
    // Keep only last 1000 events
    await this.redis.ltrim('container_events', 0, 999);
    
    // Handle specific events
    switch (event.action) {
      case 'start':
        await this.handleContainerStart(event);
        break;
      case 'die':
        await this.handleContainerDie(event);
        break;
      case 'stop':
        await this.handleContainerStop(event);
        break;
    }
    
    // Emit to WebSocket clients
    this.emit('container_event', eventData);
  }

  async handleContainerStart(event) {
    console.log(`Runner container started: ${event.containerName}`);
    
    // Update container status
    await this.redis.hset(
      'container_status',
      event.containerId,
      JSON.stringify({
        name: event.containerName,
        status: 'running',
        started_at: event.timestamp
      })
    );
  }

  async handleContainerDie(event) {
    console.log(`Runner container died: ${event.containerName}`);
    
    // Check exit code if available
    const exitCode = event.attributes?.exitCode;
    if (exitCode && exitCode !== '0') {
      this.emit('container_error', {
        container: event.containerName,
        exitCode: exitCode,
        timestamp: event.timestamp
      });
    }
    
    // Clean up stats
    this.statsHistory.delete(event.containerId);
    await this.redis.del(`container_stats:${event.containerId}`);
  }

  async handleContainerStop(event) {
    console.log(`Runner container stopped: ${event.containerName}`);
    
    // Update status
    await this.redis.hset(
      'container_status',
      event.containerId,
      JSON.stringify({
        name: event.containerName,
        status: 'stopped',
        stopped_at: event.timestamp
      })
    );
  }

  cleanupStatsHistory(activeContainerIds) {
    const activeIds = new Set(activeContainerIds);
    
    for (const containerId of this.statsHistory.keys()) {
      if (!activeIds.has(containerId)) {
        this.statsHistory.delete(containerId);
      }
    }
  }

  getContainerHistory(containerId, timeframe = '1h') {
    const history = this.statsHistory.get(containerId) || [];
    const cutoff = Date.now() - this.parseTimeframe(timeframe);
    
    return history.filter(stats => 
      stats.timestamp.getTime() > cutoff
    );
  }

  parseTimeframe(timeframe) {
    const timeframes = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000
    };
    
    return timeframes[timeframe] || timeframes['1h'];
  }

  async getAggregatedStats() {
    const containers = await this.docker.getRunnerContainers();
    const runningContainers = containers.filter(c => c.state === 'running');
    
    let totalCPU = 0;
    let totalMemoryUsed = 0;
    let totalMemoryLimit = 0;
    let totalNetworkRx = 0;
    let totalNetworkTx = 0;
    
    for (const container of runningContainers) {
      try {
        const stats = await this.docker.getContainerStats(container.id);
        
        totalCPU += stats.cpu.usage_percent;
        totalMemoryUsed += stats.memory.usage_bytes;
        totalMemoryLimit += stats.memory.limit_bytes;
        totalNetworkRx += stats.network.rx_bytes;
        totalNetworkTx += stats.network.tx_bytes;
      } catch (error) {
        console.error(`Failed to get stats for ${container.id}:`, error);
      }
    }
    
    return {
      containers: {
        total: containers.length,
        running: runningContainers.length,
        stopped: containers.length - runningContainers.length
      },
      resources: {
        cpu: {
          average_usage: runningContainers.length > 0 
            ? totalCPU / runningContainers.length 
            : 0
        },
        memory: {
          total_used: totalMemoryUsed,
          total_limit: totalMemoryLimit,
          usage_percent: totalMemoryLimit > 0 
            ? (totalMemoryUsed / totalMemoryLimit) * 100 
            : 0
        },
        network: {
          total_rx: totalNetworkRx,
          total_tx: totalNetworkTx
        }
      },
      timestamp: new Date()
    };
  }

  stop() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    console.log('Container monitoring stopped');
  }
}

module.exports = ContainerMonitor;
```

## Configuration Best Practices

### 1. Docker Socket Security

```javascript
// Secure Docker socket configuration
class SecureDockerClient {
  constructor() {
    this.docker = new Docker({
      socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
      timeout: 30000,
      // Enable request/response logging in development
      ...(process.env.NODE_ENV === 'development' && {
        log: console.log
      })
    });
    
    this.setupSecurityConstraints();
  }

  setupSecurityConstraints() {
    // Define allowed operations
    this.allowedOperations = new Set([
      'listContainers',
      'createContainer',
      'startContainer',
      'stopContainer',
      'removeContainer',
      'getContainer',
      'containerStats',
      'containerLogs',
      'containerExec'
    ]);
    
    // Define restricted images
    this.allowedImages = new Set([
      'myoung34/github-runner:latest',
      'myoung34/github-runner:ubuntu-20.04',
      'myoung34/github-runner:ubuntu-22.04'
    ]);
  }

  async secureCreateContainer(config) {
    // Validate image
    if (!this.allowedImages.has(config.Image)) {
      throw new Error(`Image not allowed: ${config.Image}`);
    }
    
    // Enforce security constraints
    const secureConfig = {
      ...config,
      HostConfig: {
        ...config.HostConfig,
        // Security settings
        Privileged: false,
        ReadonlyRootfs: false, // GitHub runner needs write access
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'SETUID', 'SETGID'], // Minimal required
        SecurityOpt: ['no-new-privileges'],
        
        // Resource limits
        Memory: Math.min(config.HostConfig?.Memory || 2147483648, 8589934592), // Max 8GB
        MemorySwap: config.HostConfig?.Memory || 2147483648,
        CpuShares: Math.min(config.HostConfig?.CpuShares || 1024, 2048),
        
        // Network restrictions
        NetworkMode: 'bridge', // Force bridge network
        
        // Volume restrictions
        Binds: this.validateVolumes(config.HostConfig?.Binds || [])
      }
    };
    
    return await this.docker.createContainer(secureConfig);
  }

  validateVolumes(binds) {
    const allowedPaths = [
      '/var/run/docker.sock:/var/run/docker.sock:ro',
      '/tmp/runner'
    ];
    
    return binds.filter(bind => {
      const [hostPath] = bind.split(':');
      return allowedPaths.some(allowed => 
        hostPath === allowed || hostPath.startsWith(allowed)
      );
    });
  }
}
```

### 2. Performance Optimization

```javascript
// Optimized Docker operations
class OptimizedDockerClient {
  constructor() {
    this.docker = new Docker();
    this.operationQueue = [];
    this.processing = false;
    this.cache = new Map();
    this.cacheTimeout = 30000; // 30 seconds
  }

  async queueOperation(operation, ...args) {
    return new Promise((resolve, reject) => {
      this.operationQueue.push({
        operation,
        args,
        resolve,
        reject,
        timestamp: Date.now()
      });
      
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.operationQueue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    while (this.operationQueue.length > 0) {
      const { operation, args, resolve, reject } = this.operationQueue.shift();
      
      try {
        const result = await this[operation](...args);
        resolve(result);
      } catch (error) {
        reject(error);
      }
      
      // Small delay to prevent overwhelming Docker daemon
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.processing = false;
  }

  async cachedListContainers(options = {}) {
    const cacheKey = `listContainers:${JSON.stringify(options)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    const containers = await this.docker.listContainers(options);
    
    this.cache.set(cacheKey, {
      data: containers,
      timestamp: Date.now()
    });
    
    return containers;
  }

  async batchGetStats(containerIds) {
    const statsPromises = containerIds.map(async (id) => {
      try {
        const container = this.docker.getContainer(id);
        const stats = await container.stats({ stream: false });
        return { id, stats, error: null };
      } catch (error) {
        return { id, stats: null, error: error.message };
      }
    });
    
    return await Promise.all(statsPromises);
  }
}
```

### 3. Health Monitoring

```javascript
// Docker daemon health monitoring
class DockerHealthMonitor {
  constructor(dockerClient) {
    this.docker = dockerClient;
    this.healthStatus = {
      connected: false,
      lastCheck: null,
      version: null,
      info: null
    };
    
    this.startHealthChecks();
  }

  async startHealthChecks() {
    // Initial health check
    await this.checkHealth();
    
    // Periodic health checks
    setInterval(() => {
      this.checkHealth().catch(error => {
        console.error('Docker health check failed:', error);
      });
    }, 30000); // Every 30 seconds
  }

  async checkHealth() {
    try {
      // Ping Docker daemon
      const pingResult = await this.docker.ping();
      
      if (pingResult === 'OK') {
        this.healthStatus.connected = true;
        this.healthStatus.lastCheck = new Date();
        
        // Get additional info periodically
        if (!this.healthStatus.version || 
            Date.now() - this.healthStatus.lastCheck > 300000) { // 5 minutes
          
          const [version, info] = await Promise.all([
            this.docker.version(),
            this.docker.info()
          ]);
          
          this.healthStatus.version = version;
          this.healthStatus.info = {
            containers: info.Containers,
            containersRunning: info.ContainersRunning,
            containersPaused: info.ContainersPaused,
            containersStopped: info.ContainersStopped,
            images: info.Images,
            serverVersion: info.ServerVersion,
            architecture: info.Architecture,
            ncpu: info.NCPU,
            memTotal: info.MemTotal
          };
        }
      }
    } catch (error) {
      this.healthStatus.connected = false;
      this.healthStatus.lastCheck = new Date();
      console.error('Docker health check failed:', error.message);
    }
  }

  getHealthStatus() {
    return {
      ...this.healthStatus,
      status: this.healthStatus.connected ? 'healthy' : 'unhealthy'
    };
  }

  async getDaemonMetrics() {
    try {
      const info = await this.docker.info();
      
      return {
        containers: {
          total: info.Containers,
          running: info.ContainersRunning,
          paused: info.ContainersPaused,
          stopped: info.ContainersStopped
        },
        images: info.Images,
        system: {
          cpu_count: info.NCPU,
          memory_total: info.MemTotal,
          server_version: info.ServerVersion,
          storage_driver: info.Driver
        },
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Failed to get daemon metrics:', error);
      throw error;
    }
  }
}
```

## Security Considerations

### 1. Socket Access Control

```javascript
// Docker socket access control
class DockerSocketGuard {
  constructor() {
    this.allowedOperations = new Set([
      'createContainer',
      'startContainer',
      'stopContainer',
      'removeContainer',
      'listContainers',
      'getContainer',
      'containerStats',
      'containerLogs'
    ]);
    
    this.blockedOperations = new Set([
      'createImage',
      'buildImage',
      'removeImage',
      'createNetwork',
      'removeNetwork',
      'createVolume',
      'removeVolume'
    ]);
  }

  validateOperation(operation) {
    if (this.blockedOperations.has(operation)) {
      throw new Error(`Operation not allowed: ${operation}`);
    }
    
    if (!this.allowedOperations.has(operation)) {
      console.warn(`Unrecognized operation: ${operation}`);
    }
  }

  auditLog(operation, args, user = 'system') {
    const logEntry = {
      timestamp: new Date().toISOString(),
      operation,
      args: this.sanitizeArgs(args),
      user,
      level: this.getOperationLevel(operation)
    };
    
    console.log('Docker operation:', JSON.stringify(logEntry));
    
    // Send to audit system if configured
    if (process.env.AUDIT_WEBHOOK) {
      this.sendAuditEvent(logEntry);
    }
  }

  sanitizeArgs(args) {
    // Remove sensitive information from args
    if (Array.isArray(args)) {
      return args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          const sanitized = { ...arg };
          delete sanitized.Env; // Remove environment variables
          return sanitized;
        }
        return arg;
      });
    }
    return args;
  }

  getOperationLevel(operation) {
    const criticalOps = ['removeContainer', 'stopContainer'];
    return criticalOps.includes(operation) ? 'critical' : 'info';
  }
}
```

## Monitoring and Debugging

### 1. Container Metrics Dashboard

```javascript
// API endpoints for container metrics
app.get('/api/containers/metrics', authenticateJWT, async (req, res) => {
  try {
    const timeframe = req.query.timeframe || '1h';
    const containerMonitor = req.app.get('containerMonitor');
    
    const aggregatedStats = await containerMonitor.getAggregatedStats();
    const recentEvents = await getRecentContainerEvents(timeframe);
    
    res.json({
      aggregate: aggregatedStats,
      events: recentEvents,
      timeframe,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/containers/:id/stats', authenticateJWT, async (req, res) => {
  try {
    const containerId = req.params.id;
    const dockerClient = req.app.get('dockerClient');
    const containerMonitor = req.app.get('containerMonitor');
    
    const [currentStats, history] = await Promise.all([
      dockerClient.getContainerStats(containerId),
      containerMonitor.getContainerHistory(containerId, req.query.timeframe)
    ]);
    
    res.json({
      current: currentStats,
      history,
      container_id: containerId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/containers/:id/logs', authenticateJWT, async (req, res) => {
  try {
    const containerId = req.params.id;
    const dockerClient = req.app.get('dockerClient');
    
    const logs = await dockerClient.getContainerLogs(containerId, {
      tail: parseInt(req.query.tail) || 100,
      since: req.query.since || 0,
      follow: req.query.follow === 'true'
    });
    
    res.json({
      logs,
      container_id: containerId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 2. Alert System

```javascript
// Container alerting system
class ContainerAlertManager {
  constructor(containerMonitor, notificationService) {
    this.monitor = containerMonitor;
    this.notifications = notificationService;
    this.alertHistory = new Map();
    this.cooldownPeriod = 5 * 60 * 1000; // 5 minutes
    
    this.setupAlertHandlers();
  }

  setupAlertHandlers() {
    this.monitor.on('resource_alert', (alert) => {
      this.handleResourceAlert(alert);
    });

    this.monitor.on('container_error', (error) => {
      this.handleContainerError(error);
    });

    this.monitor.on('container_event', (event) => {
      if (event.action === 'die' && event.attributes?.exitCode !== '0') {
        this.handleUnexpectedExit(event);
      }
    });
  }

  async handleResourceAlert(alert) {
    const alertKey = `${alert.container.id}:${alert.alerts[0].type}`;
    const lastAlert = this.alertHistory.get(alertKey);
    
    // Check cooldown period
    if (lastAlert && Date.now() - lastAlert < this.cooldownPeriod) {
      return;
    }
    
    this.alertHistory.set(alertKey, Date.now());
    
    const message = this.formatResourceAlert(alert);
    
    await this.notifications.send({
      type: 'resource_alert',
      severity: alert.alerts[0].severity,
      message,
      container: alert.container.name,
      timestamp: alert.timestamp
    });
  }

  formatResourceAlert(alert) {
    const container = alert.container.name;
    const alerts = alert.alerts.map(a => 
      `${a.type}: ${a.value}${a.unit || '%'} (threshold: ${a.threshold}${a.unit || '%'})`
    ).join(', ');
    
    return `Container ${container} resource alert: ${alerts}`;
  }

  async handleContainerError(error) {
    await this.notifications.send({
      type: 'container_error',
      severity: 'error',
      message: `Container ${error.container} exited with code ${error.exitCode}`,
      timestamp: error.timestamp
    });
  }
}
```

## Performance Optimization

### 1. Efficient Stats Collection

```javascript
// Optimized stats collection with streaming
class StreamingStatsCollector {
  constructor(dockerClient) {
    this.docker = dockerClient;
    this.activeStreams = new Map();
  }

  async startStatsStream(containerId, callback) {
    if (this.activeStreams.has(containerId)) {
      return; // Already streaming
    }

    try {
      const container = this.docker.getContainer(containerId);
      const stream = await container.stats({ stream: true });
      
      this.activeStreams.set(containerId, stream);
      
      stream.on('data', (chunk) => {
        try {
          const stats = JSON.parse(chunk.toString());
          const parsedStats = this.parseContainerStats(stats);
          callback(containerId, parsedStats);
        } catch (error) {
          console.error(`Failed to parse stats for ${containerId}:`, error);
        }
      });
      
      stream.on('error', (error) => {
        console.error(`Stats stream error for ${containerId}:`, error);
        this.stopStatsStream(containerId);
      });
      
      stream.on('end', () => {
        console.log(`Stats stream ended for ${containerId}`);
        this.activeStreams.delete(containerId);
      });
      
    } catch (error) {
      console.error(`Failed to start stats stream for ${containerId}:`, error);
    }
  }

  stopStatsStream(containerId) {
    const stream = this.activeStreams.get(containerId);
    if (stream) {
      stream.destroy();
      this.activeStreams.delete(containerId);
    }
  }

  stopAllStreams() {
    for (const [containerId, stream] of this.activeStreams) {
      stream.destroy();
    }
    this.activeStreams.clear();
  }
}
```

## Testing Docker Integration

```javascript
// Docker integration tests
describe('Docker Integration', () => {
  let dockerClient;
  
  beforeAll(async () => {
    dockerClient = new DockerClient();
    await dockerClient.init();
  });

  test('should connect to Docker daemon', async () => {
    const ping = await dockerClient.docker.ping();
    expect(ping).toBe('OK');
  });

  test('should list runner containers', async () => {
    const containers = await dockerClient.getRunnerContainers();
    expect(Array.isArray(containers)).toBe(true);
  });

  test('should create and remove test container', async () => {
    const config = {
      name: 'test-runner',
      image: 'myoung34/github-runner:latest',
      environment: ['REPO_URL=https://github.com/test/repo'],
      autoRemove: true
    };
    
    const result = await dockerClient.createRunnerContainer(config);
    expect(result.created).toBe(true);
    
    // Clean up
    await dockerClient.removeRunnerContainer(result.id, true);
  });

  test('should get container stats', async () => {
    // Use existing container or create test one
    const containers = await dockerClient.getRunnerContainers();
    
    if (containers.length > 0) {
      const stats = await dockerClient.getContainerStats(containers[0].id);
      
      expect(stats).toHaveProperty('cpu');
      expect(stats).toHaveProperty('memory');
      expect(stats).toHaveProperty('network');
    }
  });
});
```

## Related Technologies

- Docker Engine API
- Docker Compose
- Kubernetes Container Runtime
- Podman (Docker alternative)
- containerd (Container runtime)