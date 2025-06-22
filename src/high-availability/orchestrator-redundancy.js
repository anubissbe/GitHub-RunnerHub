/**
 * Orchestrator Redundancy Manager
 * 
 * Provides multi-node orchestrator deployment with leader election,
 * automatic failover, and state consistency across all nodes.
 */

const EventEmitter = require('events');
const Redis = require('ioredis');
const os = require('os');
const crypto = require('crypto');

class OrchestratorRedundancy extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      nodeId: options.nodeId || this.generateNodeId(),
      redisConfig: options.redis || { host: 'localhost', port: 6379 },
      electionTimeout: options.electionTimeout || 5000,
      heartbeatInterval: options.heartbeatInterval || 2000,
      leaderTTL: options.leaderTTL || 10000,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      ...options
    };
    
    this.redis = null;
    this.subscriber = null;
    this.isLeader = false;
    this.currentLeader = null;
    this.lastHeartbeat = Date.now();
    this.electionTimer = null;
    this.heartbeatTimer = null;
    this.retryCount = 0;
    
    this.state = {
      status: 'initializing',
      role: 'follower',
      term: 0,
      nodes: new Map(),
      lastElection: null,
      failoverCount: 0
    };
    
    this.logger = options.logger || console;
  }
  
  /**
   * Initialize the orchestrator redundancy system
   */
  async initialize() {
    try {
      this.logger.info('Initializing orchestrator redundancy system', {
        nodeId: this.config.nodeId,
        component: 'OrchestratorRedundancy'
      });
      
      await this.connectRedis();
      await this.registerNode();
      await this.startElectionProcess();
      
      this.state.status = 'active';
      this.emit('initialized', {
        nodeId: this.config.nodeId,
        status: this.state.status
      });
      
      this.logger.info('Orchestrator redundancy system initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize orchestrator redundancy', error);
      throw error;
    }
  }
  
  /**
   * Connect to Redis for distributed coordination
   */
  async connectRedis() {
    try {
      this.redis = new Redis({
        ...this.config.redisConfig,
        retryDelayOnFailover: 1000,
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        commandTimeout: 5000
      });
      
      this.subscriber = new Redis({
        ...this.config.redisConfig,
        retryDelayOnFailover: 1000,
        maxRetriesPerRequest: 3
      });
      
      // Setup event listeners
      this.redis.on('error', (error) => {
        this.logger.error('Redis connection error', error);
        this.handleConnectionFailure();
      });
      
      this.redis.on('reconnecting', () => {
        this.logger.info('Redis reconnecting...');
      });
      
      this.redis.on('connect', () => {
        this.logger.info('Redis connected successfully');
        this.retryCount = 0;
      });
      
      // Subscribe to election events
      await this.subscriber.subscribe('orchestrator:election', 'orchestrator:heartbeat');
      this.subscriber.on('message', (channel, message) => {
        this.handleRedisMessage(channel, message);
      });
      
    } catch (error) {
      this.logger.error('Failed to connect to Redis', error);
      throw error;
    }
  }
  
  /**
   * Register this node in the cluster
   */
  async registerNode() {
    const nodeInfo = {
      id: this.config.nodeId,
      hostname: os.hostname(),
      pid: process.pid,
      startTime: Date.now(),
      lastSeen: Date.now(),
      status: 'active',
      capabilities: this.getNodeCapabilities()
    };
    
    await this.redis.hset(
      'orchestrator:nodes',
      this.config.nodeId,
      JSON.stringify(nodeInfo)
    );
    
    this.logger.info('Node registered in cluster', nodeInfo);
  }
  
  /**
   * Start the leader election process
   */
  async startElectionProcess() {
    this.logger.info('Starting leader election process');
    
    // Check if there's already a leader
    const currentLeader = await this.redis.get('orchestrator:leader');
    if (currentLeader) {
      this.currentLeader = currentLeader;
      this.isLeader = (currentLeader === this.config.nodeId);
      this.state.role = this.isLeader ? 'leader' : 'follower';
      
      if (this.isLeader) {
        await this.becomeLeader();
      } else {
        await this.becomeFollower();
      }
    } else {
      // No leader exists, start election
      await this.initiateElection();
    }
    
    // Start monitoring leader heartbeat
    this.startHeartbeatMonitoring();
  }
  
  /**
   * Initiate a new leader election
   */
  async initiateElection() {
    try {
      this.logger.info('Initiating leader election', {
        nodeId: this.config.nodeId,
        term: this.state.term + 1
      });
      
      this.state.term++;
      this.state.lastElection = Date.now();
      
      // Try to acquire leadership using Redis SET with NX and EX
      const result = await this.redis.set(
        'orchestrator:leader',
        this.config.nodeId,
        'NX',
        'EX',
        Math.floor(this.config.leaderTTL / 1000)
      );
      
      if (result === 'OK') {
        // Successfully became leader
        await this.becomeLeader();
      } else {
        // Another node became leader
        const leader = await this.redis.get('orchestrator:leader');
        this.currentLeader = leader;
        await this.becomeFollower();
      }
      
      // Notify other nodes about election
      await this.redis.publish('orchestrator:election', JSON.stringify({
        type: 'election_result',
        leader: this.currentLeader,
        term: this.state.term,
        timestamp: Date.now()
      }));
      
    } catch (error) {
      this.logger.error('Election failed', error);
      await this.becomeFollower();
    }
  }
  
  /**
   * Become the cluster leader
   */
  async becomeLeader() {
    this.isLeader = true;
    this.currentLeader = this.config.nodeId;
    this.state.role = 'leader';
    
    this.logger.info('Became cluster leader', {
      nodeId: this.config.nodeId,
      term: this.state.term
    });
    
    // Start sending heartbeats
    this.startHeartbeat();
    
    // Update node status
    await this.updateNodeStatus('leader');
    
    this.emit('leadershipAcquired', {
      nodeId: this.config.nodeId,
      term: this.state.term
    });
  }
  
  /**
   * Become a follower node
   */
  async becomeFollower() {
    this.isLeader = false;
    this.state.role = 'follower';
    
    this.logger.info('Became follower', {
      nodeId: this.config.nodeId,
      leader: this.currentLeader
    });
    
    // Stop sending heartbeats
    this.stopHeartbeat();
    
    // Update node status
    await this.updateNodeStatus('follower');
    
    this.emit('leadershipLost', {
      nodeId: this.config.nodeId,
      leader: this.currentLeader
    });
  }
  
  /**
   * Start sending leader heartbeats
   */
  startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    this.heartbeatTimer = setInterval(async () => {
      try {
        if (this.isLeader) {
          // Extend leader lease
          await this.redis.expire('orchestrator:leader', Math.floor(this.config.leaderTTL / 1000));
          
          // Send heartbeat to followers
          await this.redis.publish('orchestrator:heartbeat', JSON.stringify({
            leader: this.config.nodeId,
            term: this.state.term,
            timestamp: Date.now()
          }));
          
          this.lastHeartbeat = Date.now();
        }
      } catch (error) {
        this.logger.error('Failed to send heartbeat', error);
        this.handleLeadershipFailure();
      }
    }, this.config.heartbeatInterval);
  }
  
  /**
   * Stop sending heartbeats
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  /**
   * Start monitoring leader heartbeat
   */
  startHeartbeatMonitoring() {
    if (this.electionTimer) {
      clearInterval(this.electionTimer);
    }
    
    this.electionTimer = setInterval(async () => {
      if (!this.isLeader) {
        const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
        
        if (timeSinceLastHeartbeat > this.config.electionTimeout) {
          this.logger.warn('Leader heartbeat timeout, initiating election', {
            timeSinceLastHeartbeat,
            timeout: this.config.electionTimeout
          });
          
          await this.initiateElection();
        }
      }
    }, this.config.heartbeatInterval);
  }
  
  /**
   * Handle Redis messages
   */
  handleRedisMessage(channel, message) {
    try {
      const data = JSON.parse(message);
      
      switch (channel) {
        case 'orchestrator:election':
          this.handleElectionMessage(data);
          break;
          
        case 'orchestrator:heartbeat':
          this.handleHeartbeatMessage(data);
          break;
      }
    } catch (error) {
      this.logger.error('Failed to handle Redis message', error);
    }
  }
  
  /**
   * Handle election messages
   */
  handleElectionMessage(data) {
    if (data.type === 'election_result') {
      this.currentLeader = data.leader;
      this.isLeader = (data.leader === this.config.nodeId);
      this.state.role = this.isLeader ? 'leader' : 'follower';
      
      if (data.term > this.state.term) {
        this.state.term = data.term;
      }
      
      this.emit('electionResult', {
        leader: data.leader,
        term: data.term,
        isLeader: this.isLeader
      });
    }
  }
  
  /**
   * Handle heartbeat messages
   */
  handleHeartbeatMessage(data) {
    if (data.leader === this.currentLeader) {
      this.lastHeartbeat = Date.now();
    }
  }
  
  /**
   * Handle connection failures
   */
  async handleConnectionFailure() {
    this.retryCount++;
    
    if (this.retryCount <= this.config.maxRetries) {
      this.logger.info('Attempting to reconnect', { attempt: this.retryCount });
      
      setTimeout(async () => {
        try {
          await this.connectRedis();
          await this.startElectionProcess();
        } catch (error) {
          this.logger.error('Reconnection failed', error);
        }
      }, this.config.retryDelay * this.retryCount);
    } else {
      this.logger.error('Max reconnection attempts reached');
      this.emit('connectionFailed');
    }
  }
  
  /**
   * Handle leadership failure
   */
  async handleLeadershipFailure() {
    if (this.isLeader) {
      this.logger.warn('Leadership failure detected, stepping down');
      await this.becomeFollower();
      this.state.failoverCount++;
      
      // Try to re-elect after a delay
      setTimeout(async () => {
        await this.initiateElection();
      }, this.config.retryDelay);
    }
  }
  
  /**
   * Update node status in Redis
   */
  async updateNodeStatus(status) {
    try {
      const nodeData = await this.redis.hget('orchestrator:nodes', this.config.nodeId);
      if (nodeData) {
        const node = JSON.parse(nodeData);
        node.status = status;
        node.lastSeen = Date.now();
        
        await this.redis.hset(
          'orchestrator:nodes',
          this.config.nodeId,
          JSON.stringify(node)
        );
      }
    } catch (error) {
      this.logger.error('Failed to update node status', error);
    }
  }
  
  /**
   * Get current cluster status
   */
  async getClusterStatus() {
    try {
      const [leader, nodesData] = await Promise.all([
        this.redis.get('orchestrator:leader'),
        this.redis.hgetall('orchestrator:nodes')
      ]);
      
      const nodes = Object.entries(nodesData).map(([id, data]) => ({
        id,
        ...JSON.parse(data)
      }));
      
      return {
        leader,
        nodes,
        isLeader: this.isLeader,
        currentNode: this.config.nodeId,
        term: this.state.term,
        failoverCount: this.state.failoverCount,
        clusterSize: nodes.length,
        activeNodes: nodes.filter(n => n.status === 'active').length
      };
    } catch (error) {
      this.logger.error('Failed to get cluster status', error);
      return null;
    }
  }
  
  /**
   * Force leadership election
   */
  async forceElection() {
    this.logger.info('Forcing new leader election');
    
    if (this.isLeader) {
      // Step down as leader
      await this.redis.del('orchestrator:leader');
      await this.becomeFollower();
    }
    
    // Wait a bit then start election
    setTimeout(async () => {
      await this.initiateElection();
    }, 1000);
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.logger.info('Shutting down orchestrator redundancy');
    
    this.stopHeartbeat();
    
    if (this.electionTimer) {
      clearInterval(this.electionTimer);
    }
    
    if (this.isLeader) {
      await this.redis.del('orchestrator:leader');
    }
    
    // Remove node from cluster
    await this.redis.hdel('orchestrator:nodes', this.config.nodeId);
    
    if (this.redis) {
      await this.redis.quit();
    }
    
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    
    this.state.status = 'shutdown';
    this.emit('shutdown');
  }
  
  /**
   * Generate unique node ID
   */
  generateNodeId() {
    const hostname = os.hostname();
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `orchestrator-${hostname}-${timestamp}-${random}`;
  }
  
  /**
   * Get node capabilities
   */
  getNodeCapabilities() {
    return {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memory: os.totalmem(),
      uptime: os.uptime(),
      version: process.version
    };
  }
  
  /**
   * Get health status
   */
  getHealthStatus() {
    const now = Date.now();
    const timeSinceLastHeartbeat = now - this.lastHeartbeat;
    
    return {
      status: this.state.status,
      role: this.state.role,
      isLeader: this.isLeader,
      nodeId: this.config.nodeId,
      currentLeader: this.currentLeader,
      term: this.state.term,
      lastHeartbeat: this.lastHeartbeat,
      timeSinceLastHeartbeat,
      failoverCount: this.state.failoverCount,
      healthy: this.state.status === 'active' && timeSinceLastHeartbeat < this.config.electionTimeout
    };
  }
}

module.exports = OrchestratorRedundancy;