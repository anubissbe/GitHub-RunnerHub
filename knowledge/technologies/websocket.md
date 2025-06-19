# WebSocket (ws) - Real-time Communication

## Overview
The 'ws' module is a simple, fast, and thoroughly tested WebSocket client and server implementation for Node.js. It provides the building blocks for real-time, bidirectional communication between clients and servers.

**Official Documentation**: https://github.com/websockets/ws

## Key Concepts and Features

### Core Features
- **WebSocket Server & Client**: Full implementation of WebSocket protocol
- **Binary Support**: Send and receive binary data
- **Compression**: Per-message deflate compression
- **Backpressure Handling**: Built-in flow control
- **Extensions Support**: Custom protocol extensions
- **Low Overhead**: Minimal memory footprint

### Technical Characteristics
- RFC 6455 compliant
- No external dependencies
- Event-driven architecture
- Supports permessage-deflate
- Automatic ping/pong frames
- Connection state management

## Common Use Cases

1. **Real-time Updates**
   - Live dashboards
   - Push notifications
   - Status monitoring
   - Progress tracking

2. **Interactive Applications**
   - Chat systems
   - Collaborative editing
   - Live streaming
   - Gaming servers

3. **IoT Communication**
   - Device monitoring
   - Sensor data streaming
   - Remote control
   - Telemetry

4. **Financial Applications**
   - Stock tickers
   - Trading platforms
   - Price alerts
   - Market data feeds

## Best Practices

### Server Setup
```javascript
import { WebSocketServer } from 'ws';
import http from 'http';

// Standalone WebSocket server
const wss = new WebSocketServer({ 
  port: 8080,
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    threshold: 1024 // Only compress messages > 1024 bytes
  },
  maxPayload: 10 * 1024 * 1024 // 10MB max message size
});

// WebSocket server with Express
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Handle connections
wss.on('connection', (ws, req) => {
  // Get client info
  const ip = req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];
  
  console.log(`New connection from ${ip}`);
  
  // Set up event handlers
  ws.on('message', (data) => {
    handleMessage(ws, data);
  });
  
  ws.on('close', () => {
    console.log(`Connection closed from ${ip}`);
  });
  
  ws.on('error', (error) => {
    console.error(`WebSocket error from ${ip}:`, error);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to RunnerHub WebSocket'
  }));
});

server.listen(3000);
```

### Client Management
```javascript
class WebSocketManager {
  constructor() {
    this.clients = new Map();
    this.rooms = new Map();
  }

  addClient(ws, clientInfo) {
    const clientId = this.generateClientId();
    
    const client = {
      id: clientId,
      ws: ws,
      info: clientInfo,
      rooms: new Set(),
      lastActivity: Date.now(),
      isAlive: true
    };
    
    this.clients.set(clientId, client);
    
    // Set up ping/pong for connection health
    ws.on('pong', () => {
      client.isAlive = true;
      client.lastActivity = Date.now();
    });
    
    return clientId;
  }

  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    // Remove from all rooms
    for (const room of client.rooms) {
      this.leaveRoom(clientId, room);
    }
    
    this.clients.delete(clientId);
  }

  joinRoom(clientId, roomName) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    client.rooms.add(roomName);
    
    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, new Set());
    }
    
    this.rooms.get(roomName).add(clientId);
  }

  leaveRoom(clientId, roomName) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    client.rooms.delete(roomName);
    
    const room = this.rooms.get(roomName);
    if (room) {
      room.delete(clientId);
      if (room.size === 0) {
        this.rooms.delete(roomName);
      }
    }
  }

  broadcast(message, options = {}) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    
    for (const [clientId, client] of this.clients) {
      if (options.exclude && options.exclude.includes(clientId)) {
        continue;
      }
      
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  broadcastToRoom(roomName, message, excludeClientId) {
    const room = this.rooms.get(roomName);
    if (!room) return;
    
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    
    for (const clientId of room) {
      if (clientId === excludeClientId) continue;
      
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  startHeartbeat(interval = 30000) {
    setInterval(() => {
      for (const [clientId, client] of this.clients) {
        if (!client.isAlive) {
          this.removeClient(clientId);
          client.ws.terminate();
          continue;
        }
        
        client.isAlive = false;
        client.ws.ping();
      }
    }, interval);
  }

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

### Message Protocol
```javascript
class MessageProtocol {
  constructor() {
    this.handlers = new Map();
    this.middleware = [];
  }

  use(middleware) {
    this.middleware.push(middleware);
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }

  async handleMessage(ws, rawData, context = {}) {
    try {
      // Parse message
      const message = this.parseMessage(rawData);
      
      // Run middleware
      for (const mw of this.middleware) {
        const result = await mw(message, ws, context);
        if (result === false) return; // Middleware rejected message
      }
      
      // Handle message by type
      const handler = this.handlers.get(message.type);
      if (handler) {
        await handler(message, ws, context);
      } else {
        this.sendError(ws, `Unknown message type: ${message.type}`);
      }
    } catch (error) {
      logger.error('Message handling error:', error);
      this.sendError(ws, 'Internal server error');
    }
  }

  parseMessage(rawData) {
    try {
      if (Buffer.isBuffer(rawData)) {
        rawData = rawData.toString();
      }
      
      const message = JSON.parse(rawData);
      
      if (!message.type) {
        throw new Error('Message type is required');
      }
      
      return message;
    } catch (error) {
      throw new Error('Invalid message format');
    }
  }

  sendMessage(ws, type, data = {}) {
    if (ws.readyState !== WebSocket.OPEN) return;
    
    const message = {
      type,
      timestamp: new Date().toISOString(),
      ...data
    };
    
    ws.send(JSON.stringify(message));
  }

  sendError(ws, error) {
    this.sendMessage(ws, 'error', {
      error: error instanceof Error ? error.message : error
    });
  }
}

// Usage
const protocol = new MessageProtocol();

// Add authentication middleware
protocol.use(async (message, ws, context) => {
  if (message.type === 'auth') return true; // Skip auth for auth messages
  
  if (!context.authenticated) {
    protocol.sendError(ws, 'Not authenticated');
    return false;
  }
  
  return true;
});

// Handle specific message types
protocol.on('auth', async (message, ws, context) => {
  const { token } = message;
  const user = await validateToken(token);
  
  if (user) {
    context.authenticated = true;
    context.user = user;
    protocol.sendMessage(ws, 'auth_success', { user });
  } else {
    protocol.sendError(ws, 'Invalid token');
  }
});

protocol.on('subscribe', async (message, ws, context) => {
  const { channel } = message;
  await subscribeToChannel(context.clientId, channel);
  protocol.sendMessage(ws, 'subscribed', { channel });
});
```

## Integration Patterns with GitHub RunnerHub Stack

### Real-time Runner Updates
```javascript
class RunnerWebSocketService {
  constructor(wss, runnerService) {
    this.wss = wss;
    this.runnerService = runnerService;
    this.clients = new WebSocketManager();
    this.setupHandlers();
  }

  setupHandlers() {
    this.wss.on('connection', (ws, req) => {
      const clientId = this.clients.addClient(ws, {
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent']
      });

      ws.on('message', (data) => {
        this.handleMessage(clientId, data);
      });

      ws.on('close', () => {
        this.clients.removeClient(clientId);
      });

      // Send initial runner state
      this.sendRunnerState(ws);
    });

    // Listen to runner events
    this.runnerService.on('runner:created', (runner) => {
      this.broadcastRunnerUpdate('created', runner);
    });

    this.runnerService.on('runner:updated', (runner) => {
      this.broadcastRunnerUpdate('updated', runner);
    });

    this.runnerService.on('runner:deleted', (runnerId) => {
      this.broadcastRunnerUpdate('deleted', { id: runnerId });
    });

    this.runnerService.on('runner:status', (runnerId, status) => {
      this.broadcastRunnerStatus(runnerId, status);
    });

    // Start heartbeat
    this.clients.startHeartbeat();
  }

  async handleMessage(clientId, rawData) {
    try {
      const message = JSON.parse(rawData);
      
      switch (message.type) {
        case 'subscribe':
          await this.handleSubscribe(clientId, message);
          break;
          
        case 'unsubscribe':
          await this.handleUnsubscribe(clientId, message);
          break;
          
        case 'get_runner_logs':
          await this.handleGetLogs(clientId, message);
          break;
          
        case 'stream_logs':
          await this.handleStreamLogs(clientId, message);
          break;
          
        default:
          this.sendError(clientId, `Unknown message type: ${message.type}`);
      }
    } catch (error) {
      logger.error('WebSocket message error:', error);
      this.sendError(clientId, 'Invalid message format');
    }
  }

  async handleSubscribe(clientId, message) {
    const { channel, runnerId } = message;
    
    if (channel === 'runners') {
      this.clients.joinRoom(clientId, 'runners');
      this.sendSuccess(clientId, 'Subscribed to runners channel');
    } else if (channel === 'runner' && runnerId) {
      this.clients.joinRoom(clientId, `runner:${runnerId}`);
      this.sendSuccess(clientId, `Subscribed to runner ${runnerId}`);
      
      // Send current runner state
      const runner = await this.runnerService.getRunner(runnerId);
      if (runner) {
        this.sendToClient(clientId, {
          type: 'runner_state',
          runner
        });
      }
    }
  }

  async handleStreamLogs(clientId, message) {
    const { runnerId, tail = 100 } = message;
    const client = this.clients.clients.get(clientId);
    
    if (!client) return;
    
    try {
      const logStream = await this.runnerService.streamLogs(runnerId, { tail });
      
      logStream.on('data', (log) => {
        this.sendToClient(clientId, {
          type: 'log_entry',
          runnerId,
          log: {
            timestamp: log.timestamp,
            stream: log.stream,
            message: log.message
          }
        });
      });
      
      logStream.on('end', () => {
        this.sendToClient(clientId, {
          type: 'log_stream_end',
          runnerId
        });
      });
      
      // Store stream reference for cleanup
      client.logStream = logStream;
      
    } catch (error) {
      this.sendError(clientId, `Failed to stream logs: ${error.message}`);
    }
  }

  broadcastRunnerUpdate(action, runner) {
    this.clients.broadcastToRoom('runners', {
      type: 'runner_update',
      action,
      runner
    });
    
    // Also send to subscribers of specific runner
    if (runner.id) {
      this.clients.broadcastToRoom(`runner:${runner.id}`, {
        type: 'runner_update',
        action,
        runner
      });
    }
  }

  broadcastRunnerStatus(runnerId, status) {
    const message = {
      type: 'runner_status',
      runnerId,
      status,
      timestamp: new Date().toISOString()
    };
    
    this.clients.broadcastToRoom('runners', message);
    this.clients.broadcastToRoom(`runner:${runnerId}`, message);
  }

  async sendRunnerState(ws) {
    try {
      const runners = await this.runnerService.getAllRunners();
      ws.send(JSON.stringify({
        type: 'initial_state',
        runners
      }));
    } catch (error) {
      logger.error('Failed to send initial state:', error);
    }
  }

  sendToClient(clientId, message) {
    const client = this.clients.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  sendSuccess(clientId, message) {
    this.sendToClient(clientId, {
      type: 'success',
      message
    });
  }

  sendError(clientId, error) {
    this.sendToClient(clientId, {
      type: 'error',
      error
    });
  }
}
```

### Authentication with JWT
```javascript
import jwt from 'jsonwebtoken';

class AuthenticatedWebSocket {
  constructor(wss, jwtSecret) {
    this.wss = wss;
    this.jwtSecret = jwtSecret;
    this.authenticatedClients = new Map();
  }

  setup() {
    this.wss.on('connection', (ws, req) => {
      // Try to authenticate from query params or headers
      const token = this.extractToken(req);
      
      if (token) {
        this.authenticateConnection(ws, token);
      } else {
        // Allow connection but require auth message
        this.setupUnauthenticatedHandlers(ws);
      }
    });
  }

  extractToken(req) {
    // From query params
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryToken = url.searchParams.get('token');
    if (queryToken) return queryToken;
    
    // From Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    
    return null;
  }

  authenticateConnection(ws, token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      
      const clientInfo = {
        userId: decoded.userId,
        permissions: decoded.permissions || [],
        authenticatedAt: Date.now()
      };
      
      this.authenticatedClients.set(ws, clientInfo);
      
      ws.send(JSON.stringify({
        type: 'authenticated',
        userId: clientInfo.userId
      }));
      
      this.setupAuthenticatedHandlers(ws, clientInfo);
      
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'auth_error',
        error: 'Invalid token'
      }));
      
      // Close connection after sending error
      setTimeout(() => ws.close(1008, 'Invalid token'), 1000);
    }
  }

  setupUnauthenticatedHandlers(ws) {
    let authenticated = false;
    
    ws.on('message', (data) => {
      if (authenticated) return;
      
      try {
        const message = JSON.parse(data);
        
        if (message.type === 'auth' && message.token) {
          this.authenticateConnection(ws, message.token);
          authenticated = true;
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Authentication required'
          }));
        }
      } catch (error) {
        ws.close(1002, 'Invalid message format');
      }
    });
    
    // Close connection if not authenticated within 10 seconds
    setTimeout(() => {
      if (!authenticated) {
        ws.close(1008, 'Authentication timeout');
      }
    }, 10000);
  }

  setupAuthenticatedHandlers(ws, clientInfo) {
    ws.on('message', (data) => {
      this.handleAuthenticatedMessage(ws, data, clientInfo);
    });
    
    ws.on('close', () => {
      this.authenticatedClients.delete(ws);
    });
  }

  hasPermission(clientInfo, permission) {
    return clientInfo.permissions.includes(permission) || 
           clientInfo.permissions.includes('admin');
  }

  handleAuthenticatedMessage(ws, data, clientInfo) {
    try {
      const message = JSON.parse(data);
      
      // Check permissions for certain operations
      if (message.type === 'delete_runner' && !this.hasPermission(clientInfo, 'runners:delete')) {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Insufficient permissions'
        }));
        return;
      }
      
      // Process message...
      
    } catch (error) {
      logger.error('Message handling error:', error);
    }
  }
}
```

### Binary Data Handling
```javascript
class BinaryProtocol {
  constructor() {
    this.MESSAGE_TYPES = {
      TEXT: 0x01,
      BINARY: 0x02,
      FILE_CHUNK: 0x03,
      COMMAND: 0x04
    };
  }

  createBinaryMessage(type, data) {
    // Format: [type (1 byte)][length (4 bytes)][data]
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const message = Buffer.allocUnsafe(5 + dataBuffer.length);
    
    message.writeUInt8(type, 0);
    message.writeUInt32BE(dataBuffer.length, 1);
    dataBuffer.copy(message, 5);
    
    return message;
  }

  parseBinaryMessage(buffer) {
    if (buffer.length < 5) {
      throw new Error('Invalid message: too short');
    }
    
    const type = buffer.readUInt8(0);
    const length = buffer.readUInt32BE(1);
    
    if (buffer.length < 5 + length) {
      throw new Error('Invalid message: incomplete data');
    }
    
    const data = buffer.slice(5, 5 + length);
    
    return { type, data };
  }

  handleBinaryMessage(ws, buffer) {
    try {
      const { type, data } = this.parseBinaryMessage(buffer);
      
      switch (type) {
        case this.MESSAGE_TYPES.FILE_CHUNK:
          this.handleFileChunk(ws, data);
          break;
          
        case this.MESSAGE_TYPES.COMMAND:
          this.handleCommand(ws, data);
          break;
          
        default:
          ws.send(this.createBinaryMessage(
            this.MESSAGE_TYPES.TEXT,
            JSON.stringify({ error: 'Unknown message type' })
          ));
      }
    } catch (error) {
      logger.error('Binary message error:', error);
    }
  }

  handleFileChunk(ws, data) {
    // Parse file chunk header
    const fileId = data.slice(0, 16).toString('hex');
    const chunkIndex = data.readUInt32BE(16);
    const totalChunks = data.readUInt32BE(20);
    const chunkData = data.slice(24);
    
    // Store chunk (implement actual storage logic)
    this.storeFileChunk(fileId, chunkIndex, totalChunks, chunkData);
    
    // Send acknowledgment
    const ack = Buffer.allocUnsafe(20);
    Buffer.from(fileId, 'hex').copy(ack, 0);
    ack.writeUInt32BE(chunkIndex, 16);
    
    ws.send(this.createBinaryMessage(this.MESSAGE_TYPES.COMMAND, ack));
  }
}
```

## GitHub RunnerHub Specific Patterns

### Live Log Streaming
```javascript
class LogStreamer {
  constructor(wss, dockerService) {
    this.wss = wss;
    this.dockerService = dockerService;
    this.activeStreams = new Map();
  }

  async streamContainerLogs(ws, containerId, options = {}) {
    // Check if already streaming
    if (this.activeStreams.has(containerId)) {
      const stream = this.activeStreams.get(containerId);
      stream.clients.add(ws);
      return;
    }

    try {
      // Create log stream
      const logStream = await this.dockerService.streamLogs(containerId, {
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: options.tail || 100
      });

      const clients = new Set([ws]);
      const streamInfo = {
        stream: logStream,
        clients: clients,
        parser: this.createLogParser(containerId, clients)
      };

      this.activeStreams.set(containerId, streamInfo);

      // Pipe logs through parser
      logStream.pipe(streamInfo.parser);

      // Handle stream end
      logStream.on('end', () => {
        this.stopStream(containerId);
      });

      // Handle client disconnect
      ws.on('close', () => {
        clients.delete(ws);
        if (clients.size === 0) {
          this.stopStream(containerId);
        }
      });

    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: `Failed to stream logs: ${error.message}`
      }));
    }
  }

  createLogParser(containerId, clients) {
    return new Transform({
      transform(chunk, encoding, callback) {
        const lines = chunk.toString().split('\n').filter(Boolean);
        
        for (const line of lines) {
          const logEntry = this.parseLogLine(line);
          const message = JSON.stringify({
            type: 'log',
            containerId,
            ...logEntry
          });

          // Send to all connected clients
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(message);
            }
          }
        }
        
        callback();
      }.bind(this),

      parseLogLine(line) {
        // Docker log format: 2023-01-01T00:00:00.000000000Z stdout|stderr message
        const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(stdout|stderr)\s+(.*)$/);
        
        if (match) {
          return {
            timestamp: match[1],
            stream: match[2],
            message: match[3]
          };
        }
        
        return {
          timestamp: new Date().toISOString(),
          stream: 'stdout',
          message: line
        };
      }
    });
  }

  stopStream(containerId) {
    const streamInfo = this.activeStreams.get(containerId);
    if (!streamInfo) return;

    streamInfo.stream.destroy();
    
    // Notify clients
    for (const client of streamInfo.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'stream_end',
          containerId
        }));
      }
    }

    this.activeStreams.delete(containerId);
  }
}
```

### Real-time Metrics Dashboard
```javascript
class MetricsBroadcaster {
  constructor(wss, metricsService) {
    this.wss = wss;
    this.metricsService = metricsService;
    this.subscribers = new Set();
    this.broadcastInterval = null;
  }

  start() {
    this.wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const message = JSON.parse(data);
        
        if (message.type === 'subscribe_metrics') {
          this.subscribers.add(ws);
          
          // Send initial metrics
          this.sendMetrics(ws);
          
          ws.on('close', () => {
            this.subscribers.delete(ws);
          });
        }
      });
    });

    // Start broadcasting metrics
    this.broadcastInterval = setInterval(() => {
      this.broadcastMetrics();
    }, 5000); // Every 5 seconds
  }

  async broadcastMetrics() {
    if (this.subscribers.size === 0) return;

    try {
      const metrics = await this.metricsService.collectMetrics();
      const message = JSON.stringify({
        type: 'metrics_update',
        timestamp: new Date().toISOString(),
        metrics
      });

      // Send to all subscribers
      for (const ws of this.subscribers) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        } else {
          this.subscribers.delete(ws);
        }
      }
    } catch (error) {
      logger.error('Failed to broadcast metrics:', error);
    }
  }

  async sendMetrics(ws) {
    try {
      const metrics = await this.metricsService.collectMetrics();
      ws.send(JSON.stringify({
        type: 'metrics_snapshot',
        timestamp: new Date().toISOString(),
        metrics
      }));
    } catch (error) {
      logger.error('Failed to send metrics:', error);
    }
  }

  stop() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }
  }
}
```

### Connection Recovery
```javascript
class ResilientWebSocket {
  constructor(url, options = {}) {
    this.url = url;
    this.options = {
      reconnectInterval: 1000,
      maxReconnectInterval: 30000,
      reconnectDecay: 1.5,
      maxReconnectAttempts: null,
      ...options
    };
    
    this.ws = null;
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;
    this.messageQueue = [];
    this.eventHandlers = new Map();
    
    this.connect();
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);
      this.setupEventHandlers();
    } catch (error) {
      this.scheduleReconnect();
    }
  }

  setupEventHandlers() {
    this.ws.onopen = (event) => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      
      // Send queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        this.send(message);
      }
      
      this.emit('open', event);
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      this.emit('close', event);
      
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (event) => {
      console.error('WebSocket error:', event);
      this.emit('error', event);
    };

    this.ws.onmessage = (event) => {
      this.emit('message', event);
    };
  }

  scheduleReconnect() {
    if (this.options.maxReconnectAttempts && 
        this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    const timeout = Math.min(
      this.options.reconnectInterval * Math.pow(this.options.reconnectDecay, this.reconnectAttempts),
      this.options.maxReconnectInterval
    );

    console.log(`Reconnecting in ${timeout}ms...`);
    this.reconnectAttempts++;

    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, timeout);
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    } else {
      // Queue message for sending after reconnection
      this.messageQueue.push(data);
    }
  }

  close(code = 1000, reason = '') {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close(code, reason);
    }
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, ...args) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }
}
```

## Performance Optimization

### Message Compression
```javascript
import zlib from 'zlib';

class CompressedWebSocket {
  constructor(ws) {
    this.ws = ws;
    this.compressionThreshold = 1024; // Compress messages > 1KB
  }

  async send(data) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    const buffer = Buffer.from(message);

    if (buffer.length > this.compressionThreshold) {
      // Compress large messages
      const compressed = await this.compress(buffer);
      
      // Send with compression header
      const header = Buffer.allocUnsafe(5);
      header.writeUInt8(0x01, 0); // Compression flag
      header.writeUInt32BE(buffer.length, 1); // Original size
      
      this.ws.send(Buffer.concat([header, compressed]));
    } else {
      // Send uncompressed
      const header = Buffer.allocUnsafe(1);
      header.writeUInt8(0x00, 0); // No compression
      
      this.ws.send(Buffer.concat([header, buffer]));
    }
  }

  compress(buffer) {
    return new Promise((resolve, reject) => {
      zlib.gzip(buffer, (err, compressed) => {
        if (err) reject(err);
        else resolve(compressed);
      });
    });
  }

  static async parseMessage(data) {
    const buffer = Buffer.from(data);
    const compressionFlag = buffer.readUInt8(0);

    if (compressionFlag === 0x01) {
      // Decompress
      const originalSize = buffer.readUInt32BE(1);
      const compressed = buffer.slice(5);
      
      return new Promise((resolve, reject) => {
        zlib.gunzip(compressed, (err, decompressed) => {
          if (err) reject(err);
          else resolve(decompressed.toString());
        });
      });
    } else {
      // No compression
      return buffer.slice(1).toString();
    }
  }
}
```

### Rate Limiting
```javascript
class RateLimitedWebSocket {
  constructor(wss) {
    this.wss = wss;
    this.clients = new Map();
    this.limits = {
      messagesPerMinute: 60,
      messagesPerHour: 1000,
      bytesPerMinute: 1024 * 1024 // 1MB
    };
  }

  setup() {
    this.wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;
      
      this.clients.set(ws, {
        ip: clientIp,
        messageCount: { minute: 0, hour: 0 },
        byteCount: { minute: 0 },
        resetTimers: this.setupResetTimers()
      });

      ws.on('message', (data) => {
        if (this.checkRateLimit(ws, data)) {
          this.handleMessage(ws, data);
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Rate limit exceeded'
          }));
        }
      });

      ws.on('close', () => {
        const client = this.clients.get(ws);
        if (client) {
          client.resetTimers.forEach(timer => clearInterval(timer));
          this.clients.delete(ws);
        }
      });
    });
  }

  checkRateLimit(ws, data) {
    const client = this.clients.get(ws);
    if (!client) return false;

    const messageSize = Buffer.byteLength(data);

    // Check message count limits
    if (client.messageCount.minute >= this.limits.messagesPerMinute ||
        client.messageCount.hour >= this.limits.messagesPerHour) {
      return false;
    }

    // Check byte count limits
    if (client.byteCount.minute + messageSize > this.limits.bytesPerMinute) {
      return false;
    }

    // Update counters
    client.messageCount.minute++;
    client.messageCount.hour++;
    client.byteCount.minute += messageSize;

    return true;
  }

  setupResetTimers() {
    return [
      // Reset minute counters
      setInterval(() => {
        for (const client of this.clients.values()) {
          client.messageCount.minute = 0;
          client.byteCount.minute = 0;
        }
      }, 60 * 1000),

      // Reset hour counters
      setInterval(() => {
        for (const client of this.clients.values()) {
          client.messageCount.hour = 0;
        }
      }, 60 * 60 * 1000)
    ];
  }
}
```

## Testing WebSocket Applications

### Unit Testing
```javascript
import { WebSocket, WebSocketServer } from 'ws';
import { promisify } from 'util';

describe('WebSocket Server', () => {
  let wss;
  let serverPort;

  beforeEach(async () => {
    wss = new WebSocketServer({ port: 0 });
    serverPort = wss.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => wss.close(resolve));
  });

  test('should handle client connections', async () => {
    const connectionPromise = new Promise((resolve) => {
      wss.on('connection', (ws) => {
        resolve(ws);
      });
    });

    const client = new WebSocket(`ws://localhost:${serverPort}`);
    await new Promise((resolve) => client.on('open', resolve));

    const serverWs = await connectionPromise;
    expect(serverWs).toBeDefined();

    client.close();
  });

  test('should echo messages', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        ws.send(`Echo: ${data}`);
      });
    });

    const client = new WebSocket(`ws://localhost:${serverPort}`);
    await new Promise((resolve) => client.on('open', resolve));

    const messagePromise = new Promise((resolve) => {
      client.on('message', (data) => {
        resolve(data.toString());
      });
    });

    client.send('Hello');
    const response = await messagePromise;
    
    expect(response).toBe('Echo: Hello');
    client.close();
  });
});
```

### Integration Testing
```javascript
class WebSocketTestClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.messageHandlers = new Map();
    this.messageQueue = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      
      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          handler(message);
        } else {
          this.messageQueue.push(message);
        }
      });
    });
  }

  send(type, data = {}) {
    this.ws.send(JSON.stringify({ type, ...data }));
  }

  waitForMessage(type, timeout = 5000) {
    return new Promise((resolve, reject) => {
      // Check if message already received
      const existingMessage = this.messageQueue.find(m => m.type === type);
      if (existingMessage) {
        this.messageQueue = this.messageQueue.filter(m => m !== existingMessage);
        resolve(existingMessage);
        return;
      }

      // Wait for future message
      const timer = setTimeout(() => {
        this.messageHandlers.delete(type);
        reject(new Error(`Timeout waiting for message type: ${type}`));
      }, timeout);

      this.messageHandlers.set(type, (message) => {
        clearTimeout(timer);
        this.messageHandlers.delete(type);
        resolve(message);
      });
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Usage in tests
describe('RunnerHub WebSocket Integration', () => {
  let client;

  beforeEach(async () => {
    client = new WebSocketTestClient('ws://localhost:8080');
    await client.connect();
  });

  afterEach(() => {
    client.close();
  });

  test('should receive runner updates', async () => {
    client.send('subscribe', { channel: 'runners' });
    
    const subscribed = await client.waitForMessage('subscribed');
    expect(subscribed.channel).toBe('runners');

    // Trigger a runner update
    await createRunner({ name: 'test-runner' });

    const update = await client.waitForMessage('runner_update');
    expect(update.action).toBe('created');
    expect(update.runner.name).toBe('test-runner');
  });
});
```

## Resources
- [ws Documentation](https://github.com/websockets/ws/blob/HEAD/doc/ws.md)
- [WebSocket Protocol RFC 6455](https://tools.ietf.org/html/rfc6455)
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [WebSocket Security](https://devcenter.heroku.com/articles/websocket-security)