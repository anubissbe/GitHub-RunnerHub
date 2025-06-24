/**
 * Real-time Monitoring UI Components
 * Interactive dashboard components for real-time monitoring and visualization
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const logger = require('../utils/logger');

class RealtimeMonitoringUI extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // WebSocket configuration
      websocket: {
        port: options.wsPort || 8080,
        path: options.wsPath || '/monitoring',
        heartbeatInterval: options.heartbeatInterval || 30000,
        maxConnections: options.maxConnections || 1000
      },
      
      // UI configuration
      ui: {
        updateInterval: options.updateInterval || 1000, // 1 second
        maxDataPoints: options.maxDataPoints || 100,
        enableAnimations: options.enableAnimations !== false,
        theme: options.theme || 'dark',
        autoRefresh: options.autoRefresh !== false
      },
      
      // Dashboard configuration
      dashboard: {
        widgets: options.widgets || [
          'system-overview',
          'performance-metrics',
          'job-monitoring',
          'alert-status',
          'resource-utilization'
        ],
        layout: options.layout || 'grid',
        refreshRate: options.refreshRate || 5000
      },
      
      // Data streaming
      streaming: {
        enableCompression: options.enableCompression !== false,
        batchSize: options.batchSize || 50,
        throttleInterval: options.throttleInterval || 100
      },
      
      ...options
    };
    
    // WebSocket server
    this.wsServer = null;
    this.clients = new Map(); // clientId -> client info
    this.activeConnections = new Set();
    
    // Data management
    this.dataBuffer = new Map(); // metric -> circular buffer
    this.widgetData = new Map(); // widget -> data
    this.alertData = new Map(); // alert -> data
    
    // UI state
    this.isStreaming = false;
    this.streamingTimer = null;
    this.lastUpdate = null;
    
    // Statistics
    this.stats = {
      totalConnections: 0,
      activeClients: 0,
      messagesTransmitted: 0,
      dataPointsStreamed: 0,
      lastHeartbeat: null
    };
  }

  /**
   * Initialize real-time monitoring UI
   */
  async initialize() {
    try {
      logger.info('Initializing Real-time Monitoring UI');
      
      // Initialize WebSocket server
      await this.initializeWebSocketServer();
      
      // Initialize data buffers
      this.initializeDataBuffers();
      
      // Initialize UI widgets
      this.initializeWidgets();
      
      // Start data streaming
      this.startDataStreaming();
      
      this.emit('initialized');
      logger.info('Real-time Monitoring UI initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Real-time Monitoring UI:', error);
      throw error;
    }
  }

  /**
   * Initialize WebSocket server
   */
  async initializeWebSocketServer() {
    this.wsServer = new WebSocket.Server({
      port: this.config.websocket.port,
      path: this.config.websocket.path,
      maxPayload: 1024 * 1024 // 1MB
    });
    
    this.wsServer.on('connection', (ws, request) => {
      this.handleNewConnection(ws, request);
    });
    
    this.wsServer.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });
    
    // Start heartbeat
    this.startHeartbeat();
    
    logger.info(`WebSocket server listening on port ${this.config.websocket.port}`);
  }

  /**
   * Handle new WebSocket connection
   */
  handleNewConnection(ws, request) {
    const clientId = this.generateClientId();
    const clientInfo = {
      id: clientId,
      ws,
      ip: request.socket.remoteAddress,
      userAgent: request.headers['user-agent'],
      connectedAt: new Date(),
      lastPing: new Date(),
      subscribedWidgets: new Set(),
      isAlive: true
    };
    
    this.clients.set(clientId, clientInfo);
    this.activeConnections.add(ws);
    this.stats.totalConnections++;
    this.stats.activeClients++;
    
    // Set up event handlers
    ws.on('message', (message) => {
      this.handleClientMessage(clientId, message);
    });
    
    ws.on('close', () => {
      this.handleClientDisconnect(clientId);
    });
    
    ws.on('error', (error) => {
      logger.error(`WebSocket client error for ${clientId}:`, error);
      this.handleClientDisconnect(clientId);
    });
    
    ws.on('pong', () => {
      clientInfo.isAlive = true;
      clientInfo.lastPing = new Date();
    });
    
    // Send welcome message
    this.sendToClient(clientId, {
      type: 'welcome',
      clientId,
      config: {
        updateInterval: this.config.ui.updateInterval,
        theme: this.config.ui.theme,
        availableWidgets: this.config.dashboard.widgets
      }
    });
    
    logger.info(`New WebSocket client connected: ${clientId} from ${clientInfo.ip}`);
  }

  /**
   * Handle client message
   */
  handleClientMessage(clientId, message) {
    try {
      const data = JSON.parse(message);
      const client = this.clients.get(clientId);
      
      if (!client) return;
      
      switch (data.type) {
        case 'subscribe':
          this.handleSubscription(clientId, data.widgets);
          break;
          
        case 'unsubscribe':
          this.handleUnsubscription(clientId, data.widgets);
          break;
          
        case 'widget_config':
          this.handleWidgetConfig(clientId, data.widget, data.config);
          break;
          
        case 'request_data':
          this.handleDataRequest(clientId, data.widget, data.timeRange);
          break;
          
        case 'ping':
          this.sendToClient(clientId, { type: 'pong', timestamp: Date.now() });
          break;
          
        default:
          logger.warn(`Unknown message type from client ${clientId}: ${data.type}`);
      }
      
    } catch (error) {
      logger.error(`Failed to handle message from client ${clientId}:`, error);
    }
  }

  /**
   * Handle client disconnect
   */
  handleClientDisconnect(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      this.activeConnections.delete(client.ws);
      this.clients.delete(clientId);
      this.stats.activeClients--;
      
      logger.info(`Client disconnected: ${clientId}`);
    }
  }

  /**
   * Handle widget subscription
   */
  handleSubscription(clientId, widgets) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    for (const widget of widgets) {
      if (this.config.dashboard.widgets.includes(widget)) {
        client.subscribedWidgets.add(widget);
        
        // Send initial data for the widget
        const widgetData = this.widgetData.get(widget);
        if (widgetData) {
          this.sendToClient(clientId, {
            type: 'widget_data',
            widget,
            data: widgetData
          });
        }
      }
    }
    
    logger.debug(`Client ${clientId} subscribed to widgets:`, widgets);
  }

  /**
   * Handle widget unsubscription
   */
  handleUnsubscription(clientId, widgets) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    for (const widget of widgets) {
      client.subscribedWidgets.delete(widget);
    }
    
    logger.debug(`Client ${clientId} unsubscribed from widgets:`, widgets);
  }

  /**
   * Handle widget configuration
   */
  handleWidgetConfig(clientId, widget, config) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    // Store client-specific widget configuration
    if (!client.widgetConfigs) {
      client.widgetConfigs = new Map();
    }
    
    client.widgetConfigs.set(widget, config);
    logger.debug(`Client ${clientId} updated config for widget ${widget}`);
  }

  /**
   * Handle data request
   */
  async handleDataRequest(clientId, widget, timeRange) {
    try {
      const historicalData = await this.getHistoricalData(widget, timeRange);
      
      this.sendToClient(clientId, {
        type: 'historical_data',
        widget,
        data: historicalData,
        timeRange
      });
      
    } catch (error) {
      logger.error(`Failed to handle data request for ${widget}:`, error);
    }
  }

  /**
   * Initialize data buffers
   */
  initializeDataBuffers() {
    const metrics = [
      'system_cpu',
      'system_memory',
      'system_load',
      'http_requests',
      'http_response_time',
      'database_queries',
      'cache_hit_ratio',
      'active_jobs',
      'job_success_rate',
      'container_count',
      'security_events'
    ];
    
    for (const metric of metrics) {
      this.dataBuffer.set(metric, []);
    }
    
    logger.info('Initialized data buffers for real-time metrics');
  }

  /**
   * Initialize UI widgets
   */
  initializeWidgets() {
    // System Overview Widget
    this.widgetData.set('system-overview', {
      type: 'system-overview',
      title: 'System Overview',
      metrics: {
        cpu: { value: 0, unit: '%', status: 'ok' },
        memory: { value: 0, unit: '%', status: 'ok' },
        load: { value: 0, unit: '', status: 'ok' },
        uptime: { value: 0, unit: 's', status: 'ok' }
      },
      lastUpdate: new Date()
    });
    
    // Performance Metrics Widget
    this.widgetData.set('performance-metrics', {
      type: 'performance-metrics',
      title: 'Performance Metrics',
      charts: {
        responseTime: {
          labels: [],
          datasets: [{
            label: 'Response Time (ms)',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)'
          }]
        },
        throughput: {
          labels: [],
          datasets: [{
            label: 'Requests/sec',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)'
          }]
        }
      },
      lastUpdate: new Date()
    });
    
    // Job Monitoring Widget
    this.widgetData.set('job-monitoring', {
      type: 'job-monitoring',
      title: 'Job Monitoring',
      stats: {
        active: 0,
        queued: 0,
        completed: 0,
        failed: 0,
        successRate: 0
      },
      recentJobs: [],
      lastUpdate: new Date()
    });
    
    // Alert Status Widget
    this.widgetData.set('alert-status', {
      type: 'alert-status',
      title: 'Alert Status',
      summary: {
        critical: 0,
        warning: 0,
        info: 0,
        total: 0
      },
      recentAlerts: [],
      lastUpdate: new Date()
    });
    
    // Resource Utilization Widget
    this.widgetData.set('resource-utilization', {
      type: 'resource-utilization',
      title: 'Resource Utilization',
      resources: {
        cpu: { current: 0, max: 100, unit: '%' },
        memory: { current: 0, max: 100, unit: '%' },
        disk: { current: 0, max: 100, unit: '%' },
        network: { current: 0, max: 1000, unit: 'Mbps' }
      },
      trend: [],
      lastUpdate: new Date()
    });
    
    logger.info('Initialized UI widgets');
  }

  /**
   * Start data streaming
   */
  startDataStreaming() {
    if (this.isStreaming) {
      logger.warn('Data streaming already running');
      return;
    }
    
    this.isStreaming = true;
    this.streamingTimer = setInterval(() => {
      this.updateAndStreamData().catch(error => {
        logger.error('Data streaming failed:', error);
      });
    }, this.config.ui.updateInterval);
    
    logger.info(`Started data streaming with ${this.config.ui.updateInterval}ms interval`);
  }

  /**
   * Stop data streaming
   */
  stopDataStreaming() {
    if (!this.isStreaming) {
      return;
    }
    
    this.isStreaming = false;
    if (this.streamingTimer) {
      clearInterval(this.streamingTimer);
      this.streamingTimer = null;
    }
    
    logger.info('Stopped data streaming');
  }

  /**
   * Update and stream data to clients
   */
  async updateAndStreamData() {
    try {
      // Generate mock real-time data (in real implementation, this would come from metrics)
      const currentData = this.generateMockData();
      
      // Update data buffers
      this.updateDataBuffers(currentData);
      
      // Update widget data
      this.updateWidgetData(currentData);
      
      // Stream to connected clients
      this.streamToClients();
      
      this.lastUpdate = new Date();
      this.stats.dataPointsStreamed++;
      
    } catch (error) {
      logger.error('Failed to update and stream data:', error);
    }
  }

  /**
   * Generate mock real-time data
   */
  generateMockData() {
    return {
      timestamp: Date.now(),
      system: {
        cpu: 20 + Math.random() * 60,
        memory: 30 + Math.random() * 50,
        load: 0.5 + Math.random() * 2,
        uptime: Date.now() / 1000
      },
      performance: {
        responseTime: 50 + Math.random() * 200,
        throughput: 80 + Math.random() * 40,
        errorRate: Math.random() * 5
      },
      jobs: {
        active: Math.floor(Math.random() * 20),
        queued: Math.floor(Math.random() * 10),
        completed: Math.floor(Math.random() * 100),
        failed: Math.floor(Math.random() * 5)
      },
      alerts: {
        critical: Math.floor(Math.random() * 3),
        warning: Math.floor(Math.random() * 8),
        info: Math.floor(Math.random() * 15)
      },
      resources: {
        cpu: 25 + Math.random() * 50,
        memory: 40 + Math.random() * 40,
        disk: 50 + Math.random() * 30,
        network: Math.random() * 500
      }
    };
  }

  /**
   * Update data buffers
   */
  updateDataBuffers(data) {
    const maxPoints = this.config.ui.maxDataPoints;
    
    // Update each metric buffer
    for (const [metric, buffer] of this.dataBuffer) {
      let value = 0;
      
      // Map data to metrics
      switch (metric) {
        case 'system_cpu':
          value = data.system.cpu;
          break;
        case 'system_memory':
          value = data.system.memory;
          break;
        case 'http_response_time':
          value = data.performance.responseTime;
          break;
        case 'active_jobs':
          value = data.jobs.active;
          break;
        // Add more mappings as needed
      }
      
      buffer.push({
        timestamp: data.timestamp,
        value
      });
      
      // Keep buffer size limited
      if (buffer.length > maxPoints) {
        buffer.shift();
      }
    }
  }

  /**
   * Update widget data
   */
  updateWidgetData(data) {
    // Update system overview
    const systemOverview = this.widgetData.get('system-overview');
    systemOverview.metrics.cpu.value = Math.round(data.system.cpu);
    systemOverview.metrics.memory.value = Math.round(data.system.memory);
    systemOverview.metrics.load.value = data.system.load.toFixed(2);
    systemOverview.metrics.uptime.value = Math.round(data.system.uptime);
    systemOverview.lastUpdate = new Date();
    
    // Update performance metrics
    const performanceMetrics = this.widgetData.get('performance-metrics');
    const timeLabel = new Date().toLocaleTimeString();
    
    performanceMetrics.charts.responseTime.labels.push(timeLabel);
    performanceMetrics.charts.responseTime.datasets[0].data.push(data.performance.responseTime);
    
    performanceMetrics.charts.throughput.labels.push(timeLabel);
    performanceMetrics.charts.throughput.datasets[0].data.push(data.performance.throughput);
    
    // Keep chart data limited
    const maxChartPoints = 20;
    if (performanceMetrics.charts.responseTime.labels.length > maxChartPoints) {
      performanceMetrics.charts.responseTime.labels.shift();
      performanceMetrics.charts.responseTime.datasets[0].data.shift();
      performanceMetrics.charts.throughput.labels.shift();
      performanceMetrics.charts.throughput.datasets[0].data.shift();
    }
    
    performanceMetrics.lastUpdate = new Date();
    
    // Update job monitoring
    const jobMonitoring = this.widgetData.get('job-monitoring');
    jobMonitoring.stats = {
      active: data.jobs.active,
      queued: data.jobs.queued,
      completed: data.jobs.completed,
      failed: data.jobs.failed,
      successRate: data.jobs.completed > 0 ? 
        ((data.jobs.completed / (data.jobs.completed + data.jobs.failed)) * 100).toFixed(1) : 0
    };
    jobMonitoring.lastUpdate = new Date();
    
    // Update alert status
    const alertStatus = this.widgetData.get('alert-status');
    alertStatus.summary = {
      critical: data.alerts.critical,
      warning: data.alerts.warning,
      info: data.alerts.info,
      total: data.alerts.critical + data.alerts.warning + data.alerts.info
    };
    alertStatus.lastUpdate = new Date();
    
    // Update resource utilization
    const resourceUtil = this.widgetData.get('resource-utilization');
    resourceUtil.resources.cpu.current = Math.round(data.resources.cpu);
    resourceUtil.resources.memory.current = Math.round(data.resources.memory);
    resourceUtil.resources.disk.current = Math.round(data.resources.disk);
    resourceUtil.resources.network.current = Math.round(data.resources.network);
    resourceUtil.lastUpdate = new Date();
  }

  /**
   * Stream data to connected clients
   */
  streamToClients() {
    for (const [_clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        for (const widget of client.subscribedWidgets) {
          const widgetData = this.widgetData.get(widget);
          if (widgetData) {
            this.sendToClient(_clientId, {
              type: 'widget_update',
              widget,
              data: widgetData,
              timestamp: Date.now()
            });
          }
        }
      }
    }
    
    this.stats.messagesTransmitted++;
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        const data = JSON.stringify(message);
        client.ws.send(data);
      } catch (error) {
        logger.error(`Failed to send message to client ${clientId}:`, error);
      }
    }
  }

  /**
   * Broadcast message to all clients
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    
    for (const [_clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(data);
        } catch (error) {
          logger.error(`Failed to broadcast to client ${_clientId}:`, error);
        }
      }
    }
  }

  /**
   * Start heartbeat to detect disconnected clients
   */
  startHeartbeat() {
    setInterval(() => {
      this.stats.lastHeartbeat = new Date();
      
      for (const [_clientId, client] of this.clients) {
        if (client.isAlive === false) {
          logger.info(`Terminating inactive client: ${_clientId}`);
          client.ws.terminate();
          this.handleClientDisconnect(_clientId);
        } else {
          client.isAlive = false;
          client.ws.ping();
        }
      }
    }, this.config.websocket.heartbeatInterval);
  }

  /**
   * Get historical data for widget
   */
  async getHistoricalData(widget, timeRange) {
    // In a real implementation, this would query a database
    // For now, return mock historical data
    const data = [];
    const now = Date.now();
    const interval = 60000; // 1 minute
    const points = Math.min(timeRange.duration / interval, 100);
    
    for (let i = points; i >= 0; i--) {
      data.push({
        timestamp: now - (i * interval),
        value: Math.random() * 100
      });
    }
    
    return data;
  }

  /**
   * Generate unique client ID
   */
  generateClientId() {
    return `client-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Get UI status
   */
  getStatus() {
    return {
      isStreaming: this.isStreaming,
      wsServerRunning: this.wsServer !== null,
      stats: this.stats,
      clients: {
        total: this.clients.size,
        active: this.activeConnections.size,
        list: Array.from(this.clients.values()).map(client => ({
          id: client.id,
          ip: client.ip,
          connectedAt: client.connectedAt,
          subscribedWidgets: Array.from(client.subscribedWidgets)
        }))
      },
      widgets: Array.from(this.widgetData.keys()),
      config: {
        wsPort: this.config.websocket.port,
        updateInterval: this.config.ui.updateInterval,
        maxDataPoints: this.config.ui.maxDataPoints
      }
    };
  }

  /**
   * Generate client-side JavaScript for dashboard
   */
  generateClientScript() {
    return `
      class RealtimeMonitoringClient {
        constructor(config = {}) {
          this.wsUrl = config.wsUrl || 'ws://localhost:${this.config.websocket.port}${this.config.websocket.path}';
          this.ws = null;
          this.isConnected = false;
          this.widgets = new Map();
          this.eventHandlers = new Map();
        }
        
        connect() {
          this.ws = new WebSocket(this.wsUrl);
          
          this.ws.onopen = () => {
            this.isConnected = true;
            console.log('Connected to monitoring server');
            this.emit('connected');
          };
          
          this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          };
          
          this.ws.onclose = () => {
            this.isConnected = false;
            console.log('Disconnected from monitoring server');
            this.emit('disconnected');
          };
          
          this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.emit('error', error);
          };
        }
        
        handleMessage(data) {
          switch (data.type) {
            case 'welcome':
              this.emit('welcome', data);
              break;
            case 'widget_update':
              this.updateWidget(data.widget, data.data);
              break;
            case 'widget_data':
              this.initializeWidget(data.widget, data.data);
              break;
            default:
              this.emit('message', data);
          }
        }
        
        subscribe(widgets) {
          if (this.isConnected) {
            this.ws.send(JSON.stringify({
              type: 'subscribe',
              widgets: Array.isArray(widgets) ? widgets : [widgets]
            }));
          }
        }
        
        updateWidget(widgetId, data) {
          this.emit('widget_update', { widgetId, data });
        }
        
        initializeWidget(widgetId, data) {
          this.widgets.set(widgetId, data);
          this.emit('widget_initialized', { widgetId, data });
        }
        
        on(event, handler) {
          if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
          }
          this.eventHandlers.get(event).push(handler);
        }
        
        emit(event, data) {
          const handlers = this.eventHandlers.get(event);
          if (handlers) {
            handlers.forEach(handler => handler(data));
          }
        }
      }
      
      // Auto-initialize if in browser
      if (typeof window !== 'undefined') {
        window.RealtimeMonitoringClient = RealtimeMonitoringClient;
      }
    `;
  }

  /**
   * Shutdown real-time monitoring UI
   */
  async shutdown() {
    logger.info('Shutting down Real-time Monitoring UI');
    
    this.stopDataStreaming();
    
    // Close all client connections
    for (const [_clientId, client] of this.clients) {
      client.ws.close();
    }
    
    // Close WebSocket server
    if (this.wsServer) {
      this.wsServer.close();
    }
    
    this.emit('shutdown');
    logger.info('Real-time Monitoring UI shutdown completed');
  }
}

module.exports = RealtimeMonitoringUI;