# WebSocket - Real-time Updates Architecture

## Overview

WebSocket provides full-duplex, bidirectional communication channels over a single TCP connection. GitHub RunnerHub uses WebSockets to deliver real-time updates for runner status, workflow events, and auto-scaling activities to the dashboard.

## Official Documentation

- **WebSocket Protocol**: https://tools.ietf.org/html/rfc6455
- **MDN WebSocket API**: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- **Socket.IO**: https://socket.io/docs/v4/
- **ws Library**: https://github.com/websockets/ws
- **WebSocket Security**: https://tools.ietf.org/html/rfc6455#section-10

## Integration with GitHub RunnerHub

### Server Implementation

```javascript
// server.js - WebSocket setup
const WebSocket = require('ws');
const http = require('http');

const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server,
  path: '/ws',
  verifyClient: (info, cb) => {
    // Verify origin
    const origin = info.origin;
    const allowed = ['http://localhost:8080', 'https://runnerhub.example.com'];
    
    if (allowed.includes(origin)) {
      cb(true);
    } else {
      cb(false, 401, 'Unauthorized');
    }
  }
});

// Connection handling
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from:', req.socket.remoteAddress);
  
  // Send initial connection confirmation
  ws.send(JSON.stringify({
    event: 'connected',
    data: {
      id: generateClientId(),
      timestamp: new Date().toISOString()
    }
  }));
  
  // Handle messages from client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleClientMessage(ws, data);
    } catch (error) {
      ws.send(JSON.stringify({
        event: 'error',
        data: { message: 'Invalid message format' }
      }));
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log('Client disconnected');
    removeClient(ws);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  // Add to clients list
  addClient(ws);
});
```

### Client Implementation

```typescript
// useWebSocket.ts - React hook
import { useEffect, useRef, useState } from 'react';

interface WebSocketMessage {
  event: string;
  data: any;
}

export const useWebSocket = (url: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout>();
  const reconnectAttempts = useRef(0);

  const connect = () => {
    try {
      ws.current = new WebSocket(url);
      
      ws.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        reconnectAttempts.current = 0;
        
        // Send authentication if needed
        if (token) {
          ws.current?.send(JSON.stringify({
            type: 'auth',
            token: token
          }));
        }
      };
      
      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);
          
          // Handle specific events
          switch (message.event) {
            case 'runner:status':
              updateRunnerStatus(message.data);
              break;
            case 'workflow:update':
              updateWorkflow(message.data);
              break;
            case 'scale':
              handleScaleEvent(message.data);
              break;
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };
      
      ws.current.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        
        // Attempt reconnection
        if (reconnectAttempts.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectTimeout.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        }
      };
      
      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
    }
  };
  
  const sendMessage = (message: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected');
    }
  };
  
  useEffect(() => {
    connect();
    
    return () => {
      clearTimeout(reconnectTimeout.current);
      ws.current?.close();
    };
  }, [url]);
  
  return {
    isConnected,
    lastMessage,
    sendMessage
  };
};
```

### Event Broadcasting System

```javascript
// websocket-manager.js
class WebSocketManager {
  constructor() {
    this.clients = new Map();
    this.rooms = new Map();
  }
  
  // Broadcast to all connected clients
  broadcast(event, data) {
    const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    
    this.clients.forEach((client, id) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        // Remove disconnected clients
        this.clients.delete(id);
      }
    });
  }
  
  // Send to specific client
  sendToClient(clientId, event, data) {
    const client = this.clients.get(clientId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event, data }));
    }
  }
  
  // Room-based broadcasting
  broadcastToRoom(room, event, data) {
    const roomClients = this.rooms.get(room) || [];
    roomClients.forEach(clientId => {
      this.sendToClient(clientId, event, data);
    });
  }
  
  // Join room
  joinRoom(clientId, room) {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room).add(clientId);
  }
  
  // Leave room
  leaveRoom(clientId, room) {
    const roomClients = this.rooms.get(room);
    if (roomClients) {
      roomClients.delete(clientId);
      if (roomClients.size === 0) {
        this.rooms.delete(room);
      }
    }
  }
}

const wsManager = new WebSocketManager();
```

## Configuration Best Practices

### 1. Connection Management

```javascript
// Connection pooling and health checks
class WebSocketPool {
  constructor(options = {}) {
    this.maxConnections = options.maxConnections || 1000;
    this.pingInterval = options.pingInterval || 30000;
    this.pongTimeout = options.pongTimeout || 10000;
    this.connections = new Map();
  }
  
  addConnection(ws, metadata = {}) {
    const id = generateId();
    const connection = {
      ws,
      id,
      metadata,
      isAlive: true,
      lastActivity: Date.now()
    };
    
    // Set up ping/pong
    const pingInterval = setInterval(() => {
      if (!connection.isAlive) {
        this.removeConnection(id);
        return;
      }
      
      connection.isAlive = false;
      ws.ping();
    }, this.pingInterval);
    
    ws.on('pong', () => {
      connection.isAlive = true;
      connection.lastActivity = Date.now();
    });
    
    ws.on('close', () => {
      clearInterval(pingInterval);
      this.removeConnection(id);
    });
    
    this.connections.set(id, connection);
    
    // Check connection limit
    if (this.connections.size > this.maxConnections) {
      this.removeOldestConnection();
    }
    
    return id;
  }
  
  removeConnection(id) {
    const connection = this.connections.get(id);
    if (connection) {
      connection.ws.close();
      this.connections.delete(id);
    }
  }
  
  removeOldestConnection() {
    let oldest = null;
    let oldestTime = Date.now();
    
    this.connections.forEach((conn) => {
      if (conn.lastActivity < oldestTime) {
        oldest = conn.id;
        oldestTime = conn.lastActivity;
      }
    });
    
    if (oldest) {
      this.removeConnection(oldest);
    }
  }
}
```

### 2. Message Protocol

```javascript
// Standardized message format
const MessageTypes = {
  // Client to Server
  AUTH: 'auth',
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  PING: 'ping',
  
  // Server to Client
  AUTH_SUCCESS: 'auth:success',
  AUTH_FAILED: 'auth:failed',
  EVENT: 'event',
  ERROR: 'error',
  PONG: 'pong'
};

// Message validation
const validateMessage = (message) => {
  const schema = {
    type: { required: true, type: 'string' },
    id: { required: false, type: 'string' },
    data: { required: false, type: 'object' },
    timestamp: { required: false, type: 'string' }
  };
  
  // Validate against schema
  for (const [key, rules] of Object.entries(schema)) {
    if (rules.required && !message.hasOwnProperty(key)) {
      throw new Error(`Missing required field: ${key}`);
    }
    
    if (message[key] && typeof message[key] !== rules.type) {
      throw new Error(`Invalid type for field ${key}: expected ${rules.type}`);
    }
  }
  
  return true;
};
```

### 3. Event Subscription System

```javascript
// Subscription manager
class SubscriptionManager {
  constructor() {
    this.subscriptions = new Map();
  }
  
  subscribe(clientId, eventPattern) {
    if (!this.subscriptions.has(clientId)) {
      this.subscriptions.set(clientId, new Set());
    }
    
    this.subscriptions.get(clientId).add(eventPattern);
  }
  
  unsubscribe(clientId, eventPattern) {
    const clientSubs = this.subscriptions.get(clientId);
    if (clientSubs) {
      clientSubs.delete(eventPattern);
      if (clientSubs.size === 0) {
        this.subscriptions.delete(clientId);
      }
    }
  }
  
  getSubscribers(event) {
    const subscribers = [];
    
    this.subscriptions.forEach((patterns, clientId) => {
      patterns.forEach(pattern => {
        if (this.matchesPattern(event, pattern)) {
          subscribers.push(clientId);
        }
      });
    });
    
    return subscribers;
  }
  
  matchesPattern(event, pattern) {
    // Support wildcards: runner.* matches runner.created, runner.updated, etc.
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(event);
  }
}
```

## Security Considerations

### 1. Authentication

```javascript
// Token-based authentication
const authenticateWebSocket = async (ws, token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Attach user to connection
    ws.userId = user.id;
    ws.permissions = user.permissions;
    
    ws.send(JSON.stringify({
      type: MessageTypes.AUTH_SUCCESS,
      data: { userId: user.id }
    }));
    
    return true;
  } catch (error) {
    ws.send(JSON.stringify({
      type: MessageTypes.AUTH_FAILED,
      data: { message: 'Authentication failed' }
    }));
    
    // Close connection after delay
    setTimeout(() => ws.close(1008, 'Authentication failed'), 1000);
    return false;
  }
};
```

### 2. Rate Limiting

```javascript
// WebSocket rate limiting
class WebSocketRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000; // 1 minute
    this.maxMessages = options.maxMessages || 100;
    this.clients = new Map();
  }
  
  checkLimit(clientId) {
    const now = Date.now();
    const clientData = this.clients.get(clientId) || { messages: [], blocked: false };
    
    // Remove old messages
    clientData.messages = clientData.messages.filter(
      time => now - time < this.windowMs
    );
    
    // Check if blocked
    if (clientData.blocked && now < clientData.blockedUntil) {
      return false;
    }
    
    // Check rate limit
    if (clientData.messages.length >= this.maxMessages) {
      clientData.blocked = true;
      clientData.blockedUntil = now + this.windowMs;
      this.clients.set(clientId, clientData);
      return false;
    }
    
    // Add message timestamp
    clientData.messages.push(now);
    clientData.blocked = false;
    this.clients.set(clientId, clientData);
    
    return true;
  }
  
  cleanup() {
    const now = Date.now();
    this.clients.forEach((data, clientId) => {
      if (data.messages.length === 0 && (!data.blocked || now > data.blockedUntil)) {
        this.clients.delete(clientId);
      }
    });
  }
}
```

### 3. Input Validation

```javascript
// Sanitize and validate WebSocket messages
const sanitizeMessage = (message) => {
  // Prevent prototype pollution
  if (message.constructor !== Object) {
    throw new Error('Invalid message format');
  }
  
  // Whitelist allowed fields
  const allowedFields = ['type', 'id', 'data', 'timestamp'];
  const sanitized = {};
  
  for (const key of allowedFields) {
    if (message.hasOwnProperty(key)) {
      sanitized[key] = message[key];
    }
  }
  
  // Validate data types
  if (sanitized.data && typeof sanitized.data !== 'object') {
    throw new Error('Data field must be an object');
  }
  
  // Prevent excessive nesting
  const maxDepth = 5;
  const checkDepth = (obj, depth = 0) => {
    if (depth > maxDepth) {
      throw new Error('Message exceeds maximum nesting depth');
    }
    
    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null) {
        checkDepth(value, depth + 1);
      }
    }
  };
  
  if (sanitized.data) {
    checkDepth(sanitized.data);
  }
  
  return sanitized;
};
```

## Monitoring and Debugging

### 1. Connection Metrics

```javascript
// WebSocket metrics collection
class WebSocketMetrics {
  constructor() {
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0,
      reconnections: 0,
      avgMessageSize: 0,
      peakConnections: 0
    };
    
    this.connectionDurations = [];
  }
  
  onConnection() {
    this.metrics.totalConnections++;
    this.metrics.activeConnections++;
    
    if (this.metrics.activeConnections > this.metrics.peakConnections) {
      this.metrics.peakConnections = this.metrics.activeConnections;
    }
    
    return Date.now(); // Return connection start time
  }
  
  onDisconnection(startTime) {
    this.metrics.activeConnections--;
    const duration = Date.now() - startTime;
    this.connectionDurations.push(duration);
    
    // Keep only last 1000 durations
    if (this.connectionDurations.length > 1000) {
      this.connectionDurations.shift();
    }
  }
  
  onMessage(size, direction = 'received') {
    if (direction === 'received') {
      this.metrics.messagesReceived++;
    } else {
      this.metrics.messagesSent++;
    }
    
    // Update average message size
    const totalMessages = this.metrics.messagesSent + this.metrics.messagesReceived;
    this.metrics.avgMessageSize = 
      (this.metrics.avgMessageSize * (totalMessages - 1) + size) / totalMessages;
  }
  
  getMetrics() {
    const avgConnectionDuration = this.connectionDurations.length > 0
      ? this.connectionDurations.reduce((a, b) => a + b, 0) / this.connectionDurations.length
      : 0;
    
    return {
      ...this.metrics,
      avgConnectionDuration,
      uptime: process.uptime()
    };
  }
}
```

### 2. Debug Logging

```javascript
// WebSocket debug middleware
const debugWebSocket = (ws, req) => {
  const clientId = generateId();
  const clientIp = req.socket.remoteAddress;
  
  console.log(`[WS] New connection: ${clientId} from ${clientIp}`);
  
  // Log all messages
  const originalSend = ws.send.bind(ws);
  ws.send = (data) => {
    console.log(`[WS] Sending to ${clientId}:`, data);
    originalSend(data);
  };
  
  ws.on('message', (data) => {
    console.log(`[WS] Received from ${clientId}:`, data);
  });
  
  ws.on('close', (code, reason) => {
    console.log(`[WS] Connection closed: ${clientId}, code: ${code}, reason: ${reason}`);
  });
  
  ws.on('error', (error) => {
    console.error(`[WS] Error for ${clientId}:`, error);
  });
};
```

### 3. Health Checks

```javascript
// WebSocket health endpoint
app.get('/api/websocket/health', (req, res) => {
  const stats = {
    connections: wss.clients.size,
    readyState: {
      connecting: 0,
      open: 0,
      closing: 0,
      closed: 0
    }
  };
  
  wss.clients.forEach((client) => {
    switch (client.readyState) {
      case WebSocket.CONNECTING:
        stats.readyState.connecting++;
        break;
      case WebSocket.OPEN:
        stats.readyState.open++;
        break;
      case WebSocket.CLOSING:
        stats.readyState.closing++;
        break;
      case WebSocket.CLOSED:
        stats.readyState.closed++;
        break;
    }
  });
  
  res.json({
    status: stats.readyState.open > 0 ? 'healthy' : 'unhealthy',
    stats,
    uptime: process.uptime()
  });
});
```

## Advanced Patterns

### 1. Message Queuing

```javascript
// Offline message queue
class MessageQueue {
  constructor(maxSize = 1000) {
    this.queues = new Map();
    this.maxSize = maxSize;
  }
  
  enqueue(clientId, message) {
    if (!this.queues.has(clientId)) {
      this.queues.set(clientId, []);
    }
    
    const queue = this.queues.get(clientId);
    queue.push({
      message,
      timestamp: Date.now()
    });
    
    // Limit queue size
    if (queue.length > this.maxSize) {
      queue.shift();
    }
  }
  
  dequeue(clientId) {
    const queue = this.queues.get(clientId) || [];
    this.queues.delete(clientId);
    return queue;
  }
  
  // Send queued messages when client reconnects
  sendQueued(ws, clientId) {
    const messages = this.dequeue(clientId);
    
    messages.forEach(({ message, timestamp }) => {
      ws.send(JSON.stringify({
        ...message,
        queued: true,
        queuedAt: timestamp
      }));
    });
  }
}
```

### 2. Binary Protocol Support

```javascript
// Binary message handling
ws.on('message', (data, isBinary) => {
  if (isBinary) {
    // Handle binary data
    const buffer = Buffer.from(data);
    
    // Example: First byte is message type
    const messageType = buffer.readUInt8(0);
    
    switch (messageType) {
      case 0x01: // File upload
        handleFileUpload(buffer.slice(1));
        break;
      case 0x02: // Metrics data
        handleMetricsData(buffer.slice(1));
        break;
    }
  } else {
    // Handle text messages
    const message = JSON.parse(data.toString());
    handleTextMessage(message);
  }
});

// Send binary data
const sendBinaryMetrics = (ws, metrics) => {
  const buffer = Buffer.alloc(1 + 4 * metrics.length);
  buffer.writeUInt8(0x02, 0); // Message type
  
  metrics.forEach((value, index) => {
    buffer.writeFloatLE(value, 1 + index * 4);
  });
  
  ws.send(buffer);
};
```

### 3. Compression

```javascript
// Enable per-message compression
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: {
    zlibDeflateOptions: {
      level: 6,
      memLevel: 8,
      strategy: 0
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    threshold: 1024, // Only compress messages > 1KB
    concurrencyLimit: 10
  }
});
```

## Performance Optimization

### 1. Message Batching

```javascript
// Batch multiple updates
class MessageBatcher {
  constructor(ws, options = {}) {
    this.ws = ws;
    this.batchInterval = options.interval || 100;
    this.maxBatchSize = options.maxSize || 50;
    this.queue = [];
    this.timer = null;
  }
  
  send(event, data) {
    this.queue.push({ event, data });
    
    if (this.queue.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.batchInterval);
    }
  }
  
  flush() {
    if (this.queue.length === 0) return;
    
    const batch = this.queue.splice(0);
    this.ws.send(JSON.stringify({
      type: 'batch',
      messages: batch
    }));
    
    clearTimeout(this.timer);
    this.timer = null;
  }
}
```

### 2. Selective Updates

```javascript
// Send updates only to interested clients
class SelectiveBroadcaster {
  constructor(wsManager) {
    this.wsManager = wsManager;
    this.subscriptions = new Map();
  }
  
  subscribe(clientId, filter) {
    this.subscriptions.set(clientId, filter);
  }
  
  broadcast(event, data) {
    this.subscriptions.forEach((filter, clientId) => {
      if (this.matchesFilter(data, filter)) {
        this.wsManager.sendToClient(clientId, event, data);
      }
    });
  }
  
  matchesFilter(data, filter) {
    // Example: Filter by repository
    if (filter.repository && data.repository !== filter.repository) {
      return false;
    }
    
    // Filter by runner status
    if (filter.status && data.status !== filter.status) {
      return false;
    }
    
    return true;
  }
}
```

## Common Issues and Solutions

### 1. Connection Drops

**Problem**: Clients frequently disconnect

**Solution**:
```javascript
// Implement heartbeat
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

ws.on('pong', () => {
  ws.isAlive = true;
});
```

### 2. Memory Leaks

**Problem**: Memory usage increases over time

**Solution**:
```javascript
// Clean up references
ws.on('close', () => {
  // Remove from all collections
  wsManager.removeClient(ws.id);
  subscriptionManager.removeClient(ws.id);
  messageQueue.dequeue(ws.id);
  
  // Clear event listeners
  ws.removeAllListeners();
});
```

### 3. Scaling Issues

**Problem**: Single WebSocket server can't handle load

**Solution**:
```javascript
// Use Redis for pub/sub across multiple servers
const Redis = require('ioredis');
const pub = new Redis();
const sub = new Redis();

// Subscribe to Redis channels
sub.subscribe('runner:updates', 'workflow:updates');

sub.on('message', (channel, message) => {
  // Broadcast to local WebSocket clients
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
});

// Publish updates
const broadcastUpdate = (channel, data) => {
  pub.publish(channel, JSON.stringify(data));
};
```

## Testing Strategies

```javascript
// WebSocket testing
const WebSocket = require('ws');

describe('WebSocket Server', () => {
  let ws;
  
  beforeEach((done) => {
    ws = new WebSocket('ws://localhost:8300');
    ws.on('open', done);
  });
  
  afterEach(() => {
    ws.close();
  });
  
  test('should receive connection confirmation', (done) => {
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      expect(message.event).toBe('connected');
      expect(message.data).toHaveProperty('id');
      done();
    });
  });
  
  test('should handle subscriptions', (done) => {
    ws.send(JSON.stringify({
      type: 'subscribe',
      data: { event: 'runner:*' }
    }));
    
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'subscription:confirmed') {
        done();
      }
    });
  });
});
```

## Related Technologies

- Socket.IO (abstraction layer)
- Server-Sent Events (SSE)
- Long Polling
- WebRTC (peer-to-peer)
- MQTT (IoT messaging)