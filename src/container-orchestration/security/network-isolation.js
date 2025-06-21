/**
 * Network Isolation Manager
 * Provides network segmentation and isolation for GitHub Runner containers
 * ensuring each job runs in a secure, isolated network environment
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class NetworkIsolationManager extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.docker = dockerAPI.docker;
    
    this.config = {
      // Network configuration
      networkPrefix: options.networkPrefix || 'gh-runner',
      networkDriver: options.networkDriver || 'bridge',
      enableIpv6: options.enableIpv6 || false,
      
      // Isolation levels
      isolationMode: options.isolationMode || 'strict', // 'strict', 'moderate', 'minimal'
      enableInterContainerComm: options.enableInterContainerComm || false,
      enableExternalAccess: options.enableExternalAccess || true,
      
      // Security policies
      defaultNetworkPolicy: options.defaultNetworkPolicy || 'deny-all',
      allowedPorts: options.allowedPorts || [80, 443], // Default allowed outbound ports
      blockedDomains: options.blockedDomains || [],
      allowedDomains: options.allowedDomains || ['github.com', 'githubusercontent.com'],
      
      // Network limits
      bandwidthLimit: options.bandwidthLimit || '100m', // 100 Mbps default
      maxConnectionsPerContainer: options.maxConnectionsPerContainer || 100,
      
      // DNS configuration
      dnsServers: options.dnsServers || ['8.8.8.8', '8.8.4.4'],
      enableDnsFiltering: options.enableDnsFiltering !== false,
      
      // Cleanup settings
      networkTtl: options.networkTtl || 3600000, // 1 hour
      cleanupInterval: options.cleanupInterval || 300000, // 5 minutes
      
      ...options
    };
    
    // Network management
    this.isolatedNetworks = new Map(); // jobId -> networkInfo
    this.networkPolicies = new Map(); // networkId -> policy
    this.activeConnections = new Map(); // containerId -> connections
    
    // Security tracking
    this.securityViolations = [];
    this.networkAudits = [];
    
    // Cleanup timer
    this.cleanupTimer = null;
    
    this.isInitialized = false;
  }

  /**
   * Initialize the network isolation manager
   */
  async initialize() {
    try {
      logger.info('Initializing Network Isolation Manager');
      
      // Create base isolation networks if needed
      await this.createBaseNetworks();
      
      // Start cleanup timer
      this.startCleanupTimer();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Network Isolation Manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Network Isolation Manager:', error);
      throw error;
    }
  }

  /**
   * Create an isolated network for a job
   */
  async createIsolatedNetwork(jobId, jobConfig = {}) {
    try {
      const networkName = this.generateNetworkName(jobId);
      const repository = jobConfig.repository || 'unknown';
      
      logger.info(`Creating isolated network for job ${jobId} (${repository})`);
      
      // Define network configuration based on isolation mode
      const networkConfig = this.generateNetworkConfig(jobId, jobConfig);
      
      // Create the Docker network
      const network = await this.docker.createNetwork({
        Name: networkName,
        Driver: this.config.networkDriver,
        EnableIPv6: this.config.enableIpv6,
        Internal: this.config.isolationMode === 'strict', // No external access in strict mode
        CheckDuplicate: true,
        IPAM: {
          Driver: 'default',
          Config: [
            {
              Subnet: this.generateSubnet(jobId),
              Gateway: this.generateGateway(jobId)
            }
          ]
        },
        Options: {
          'com.docker.network.bridge.enable_icc': String(this.config.enableInterContainerComm),
          'com.docker.network.bridge.enable_ip_masquerade': 'true',
          'com.github.runner.job': jobId,
          'com.github.runner.repository': repository
        },
        Labels: {
          'github-runner': 'true',
          'job-id': jobId,
          'repository': repository,
          'created-at': new Date().toISOString(),
          'isolation-mode': this.config.isolationMode
        }
      });
      
      // Apply network policies
      const policy = await this.applyNetworkPolicy(network, jobConfig);
      
      // Configure DNS filtering if enabled
      if (this.config.enableDnsFiltering) {
        await this.configureDnsFiltering(network, jobConfig);
      }
      
      // Store network information
      const networkInfo = {
        id: network.id,
        name: networkName,
        jobId,
        repository,
        subnet: networkConfig.subnet,
        gateway: networkConfig.gateway,
        policy,
        createdAt: new Date(),
        lastActivity: new Date()
      };
      
      this.isolatedNetworks.set(jobId, networkInfo);
      this.networkPolicies.set(network.id, policy);
      
      // Emit network created event
      this.emit('networkCreated', {
        jobId,
        networkId: network.id,
        repository,
        isolationMode: this.config.isolationMode
      });
      
      // Audit log
      this.auditNetworkAction('create', jobId, {
        networkId: network.id,
        repository,
        isolationMode: this.config.isolationMode
      });
      
      return network;
      
    } catch (error) {
      logger.error(`Failed to create isolated network for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Connect a container to an isolated network
   */
  async connectContainerToNetwork(containerId, jobId, options = {}) {
    try {
      const networkInfo = this.isolatedNetworks.get(jobId);
      if (!networkInfo) {
        throw new Error(`No isolated network found for job ${jobId}`);
      }
      
      logger.info(`Connecting container ${containerId} to isolated network for job ${jobId}`);
      
      const network = this.docker.getNetwork(networkInfo.id);
      
      // Configure container network settings
      const connectOptions = {
        Container: containerId,
        EndpointConfig: {
          IPAMConfig: {
            IPv4Address: this.assignContainerIP(jobId, containerId)
          },
          Links: options.links || [],
          Aliases: options.aliases || [`runner-${jobId}`]
        }
      };
      
      // Apply bandwidth limits if configured
      if (this.config.bandwidthLimit) {
        connectOptions.EndpointConfig.DriverOpts = {
          'com.docker.network.endpoint.bandwidth': this.config.bandwidthLimit
        };
      }
      
      await network.connect(connectOptions);
      
      // Track container connection
      this.trackContainerConnection(containerId, jobId, networkInfo.id);
      
      // Update network activity
      networkInfo.lastActivity = new Date();
      
      // Emit connection event
      this.emit('containerConnected', {
        containerId,
        jobId,
        networkId: networkInfo.id
      });
      
      // Audit log
      this.auditNetworkAction('connect', jobId, {
        containerId,
        networkId: networkInfo.id
      });
      
      return true;
      
    } catch (error) {
      logger.error(`Failed to connect container ${containerId} to network:`, error);
      throw error;
    }
  }

  /**
   * Disconnect a container from an isolated network
   */
  async disconnectContainerFromNetwork(containerId, jobId) {
    try {
      const networkInfo = this.isolatedNetworks.get(jobId);
      if (!networkInfo) {
        logger.warn(`No isolated network found for job ${jobId}`);
        return;
      }
      
      logger.info(`Disconnecting container ${containerId} from isolated network for job ${jobId}`);
      
      const network = this.docker.getNetwork(networkInfo.id);
      
      try {
        await network.disconnect({ Container: containerId });
      } catch (error) {
        // Ignore if container is already disconnected
        if (!error.message.includes('is not connected')) {
          throw error;
        }
      }
      
      // Remove connection tracking
      this.removeContainerConnection(containerId, jobId);
      
      // Emit disconnection event
      this.emit('containerDisconnected', {
        containerId,
        jobId,
        networkId: networkInfo.id
      });
      
      // Audit log
      this.auditNetworkAction('disconnect', jobId, {
        containerId,
        networkId: networkInfo.id
      });
      
    } catch (error) {
      logger.error(`Failed to disconnect container ${containerId} from network:`, error);
      throw error;
    }
  }

  /**
   * Remove an isolated network
   */
  async removeIsolatedNetwork(jobId) {
    try {
      const networkInfo = this.isolatedNetworks.get(jobId);
      if (!networkInfo) {
        logger.warn(`No isolated network found for job ${jobId}`);
        return;
      }
      
      logger.info(`Removing isolated network for job ${jobId}`);
      
      const network = this.docker.getNetwork(networkInfo.id);
      
      // Check if network is still in use
      const networkDetails = await network.inspect();
      if (networkDetails.Containers && Object.keys(networkDetails.Containers).length > 0) {
        logger.warn(`Network ${networkInfo.name} still has connected containers, skipping removal`);
        return false;
      }
      
      // Remove the network
      await network.remove();
      
      // Clean up tracking
      this.isolatedNetworks.delete(jobId);
      this.networkPolicies.delete(networkInfo.id);
      
      // Emit removal event
      this.emit('networkRemoved', {
        jobId,
        networkId: networkInfo.id,
        repository: networkInfo.repository
      });
      
      // Audit log
      this.auditNetworkAction('remove', jobId, {
        networkId: networkInfo.id,
        repository: networkInfo.repository
      });
      
      return true;
      
    } catch (error) {
      logger.error(`Failed to remove isolated network for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Apply network security policy
   */
  async applyNetworkPolicy(network, jobConfig) {
    const policy = {
      name: `policy-${network.id}`,
      rules: [],
      defaultAction: this.config.defaultNetworkPolicy
    };
    
    // Add egress rules based on configuration
    if (this.config.enableExternalAccess) {
      // Allow specific ports
      for (const port of this.config.allowedPorts) {
        policy.rules.push({
          type: 'egress',
          protocol: 'tcp',
          port,
          action: 'allow'
        });
      }
      
      // Allow specific domains
      for (const domain of this.config.allowedDomains) {
        policy.rules.push({
          type: 'egress',
          domain,
          action: 'allow'
        });
      }
    }
    
    // Block specific domains
    for (const domain of this.config.blockedDomains) {
      policy.rules.push({
        type: 'egress',
        domain,
        action: 'deny',
        priority: 100 // Higher priority to override allows
      });
    }
    
    // Repository-specific rules
    if (jobConfig.networkPolicy) {
      policy.rules.push(...jobConfig.networkPolicy.rules);
    }
    
    // Apply the policy (this would integrate with iptables/nftables in production)
    await this.enforceNetworkPolicy(network, policy);
    
    return policy;
  }

  /**
   * Enforce network policy using iptables/nftables
   */
  async enforceNetworkPolicy(network, policy) {
    // This is a simplified implementation
    // In production, this would integrate with iptables/nftables
    
    logger.debug(`Enforcing network policy for network ${network.id}`);
    
    // Store policy for reference
    this.networkPolicies.set(network.id, policy);
    
    // Log policy application
    this.emit('policyApplied', {
      networkId: network.id,
      policy: policy.name,
      rulesCount: policy.rules.length
    });
  }

  /**
   * Configure DNS filtering for the network
   */
  async configureDnsFiltering(network, jobConfig) {
    // This would integrate with a DNS filtering service
    // For now, we'll store the configuration
    
    const dnsConfig = {
      servers: this.config.dnsServers,
      allowedDomains: [...this.config.allowedDomains],
      blockedDomains: [...this.config.blockedDomains]
    };
    
    // Add job-specific DNS rules
    if (jobConfig.dnsRules) {
      dnsConfig.allowedDomains.push(...(jobConfig.dnsRules.allowed || []));
      dnsConfig.blockedDomains.push(...(jobConfig.dnsRules.blocked || []));
    }
    
    logger.debug(`Configured DNS filtering for network ${network.id}`);
    
    return dnsConfig;
  }

  /**
   * Monitor network traffic for security violations
   */
  async monitorNetworkTraffic(containerId, jobId) {
    try {
      const networkInfo = this.isolatedNetworks.get(jobId);
      if (!networkInfo) {
        return;
      }
      
      // This would integrate with packet capture tools
      // For now, we'll simulate monitoring
      
      const monitoring = {
        containerId,
        jobId,
        networkId: networkInfo.id,
        startTime: new Date(),
        violations: []
      };
      
      // Emit monitoring started event
      this.emit('monitoringStarted', monitoring);
      
      return monitoring;
      
    } catch (error) {
      logger.error(`Failed to monitor network traffic for container ${containerId}:`, error);
    }
  }

  /**
   * Detect and handle security violations
   */
  async handleSecurityViolation(violation) {
    logger.warn(`Security violation detected:`, violation);
    
    // Record violation
    this.securityViolations.push({
      ...violation,
      timestamp: new Date(),
      handled: false
    });
    
    // Take action based on violation severity
    switch (violation.severity) {
      case 'critical':
        // Immediate container termination
        await this.terminateViolatingContainer(violation.containerId);
        break;
        
      case 'high':
        // Block network access
        await this.blockContainerNetwork(violation.containerId);
        break;
        
      case 'medium':
        // Rate limit the container
        await this.rateLimitContainer(violation.containerId);
        break;
        
      case 'low':
        // Log and monitor
        logger.info(`Low severity violation logged for container ${violation.containerId}`);
        break;
    }
    
    // Emit violation event
    this.emit('securityViolation', violation);
    
    // Audit log
    this.auditSecurityEvent('violation', violation);
  }

  /**
   * Generate network name for a job
   */
  generateNetworkName(jobId) {
    return `${this.config.networkPrefix}-${jobId}-${Date.now()}`;
  }

  /**
   * Generate subnet for isolated network
   */
  generateSubnet(jobId) {
    // Generate unique subnet based on job ID
    // Using 172.20-31.x.x range for custom networks
    const hash = this.hashCode(jobId);
    const secondOctet = 20 + (hash % 12); // 20-31
    const thirdOctet = hash % 256;
    
    return `172.${secondOctet}.${thirdOctet}.0/24`;
  }

  /**
   * Generate gateway for isolated network
   */
  generateGateway(jobId) {
    const subnet = this.generateSubnet(jobId);
    const parts = subnet.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
  }

  /**
   * Assign IP address to container
   */
  assignContainerIP(jobId, containerId) {
    const subnet = this.generateSubnet(jobId);
    const parts = subnet.split('.');
    
    // Simple assignment - in production would track used IPs
    const lastOctet = (this.hashCode(containerId) % 253) + 2; // 2-254
    
    return `${parts[0]}.${parts[1]}.${parts[2]}.${lastOctet}`;
  }

  /**
   * Generate network configuration
   */
  generateNetworkConfig(jobId, jobConfig) {
    const subnet = this.generateSubnet(jobId);
    const gateway = this.generateGateway(jobId);
    
    return {
      subnet,
      gateway,
      dns: this.config.dnsServers,
      mtu: jobConfig.mtu || 1500,
      enableIPv6: this.config.enableIpv6
    };
  }

  /**
   * Track container connection
   */
  trackContainerConnection(containerId, jobId, networkId) {
    const connections = this.activeConnections.get(containerId) || [];
    connections.push({
      jobId,
      networkId,
      connectedAt: new Date()
    });
    this.activeConnections.set(containerId, connections);
  }

  /**
   * Remove container connection tracking
   */
  removeContainerConnection(containerId, jobId) {
    const connections = this.activeConnections.get(containerId);
    if (connections) {
      const filtered = connections.filter(conn => conn.jobId !== jobId);
      if (filtered.length > 0) {
        this.activeConnections.set(containerId, filtered);
      } else {
        this.activeConnections.delete(containerId);
      }
    }
  }

  /**
   * Create base networks for different isolation levels
   */
  async createBaseNetworks() {
    // Create default networks for different isolation modes
    // These can be used as templates or fallbacks
    
    const baseNetworks = [
      {
        name: `${this.config.networkPrefix}-strict-base`,
        mode: 'strict',
        internal: true
      },
      {
        name: `${this.config.networkPrefix}-moderate-base`,
        mode: 'moderate',
        internal: false
      }
    ];
    
    for (const netConfig of baseNetworks) {
      try {
        await this.docker.createNetwork({
          Name: netConfig.name,
          Driver: this.config.networkDriver,
          Internal: netConfig.internal,
          Labels: {
            'github-runner': 'true',
            'network-type': 'base',
            'isolation-mode': netConfig.mode
          }
        });
        
        logger.debug(`Created base network: ${netConfig.name}`);
      } catch (error) {
        // Network might already exist
        if (!error.message.includes('already exists')) {
          logger.error(`Failed to create base network ${netConfig.name}:`, error);
        }
      }
    }
  }

  /**
   * Start cleanup timer
   */
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredNetworks().catch(err => 
        logger.error('Network cleanup failed:', err)
      );
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up expired networks
   */
  async cleanupExpiredNetworks() {
    const now = Date.now();
    const expiredNetworks = [];
    
    for (const [jobId, networkInfo] of this.isolatedNetworks.entries()) {
      const age = now - networkInfo.createdAt.getTime();
      const idle = now - networkInfo.lastActivity.getTime();
      
      if (age > this.config.networkTtl || idle > this.config.networkTtl) {
        expiredNetworks.push(jobId);
      }
    }
    
    for (const jobId of expiredNetworks) {
      try {
        await this.removeIsolatedNetwork(jobId);
        logger.info(`Cleaned up expired network for job ${jobId}`);
      } catch (error) {
        logger.error(`Failed to cleanup network for job ${jobId}:`, error);
      }
    }
    
    if (expiredNetworks.length > 0) {
      logger.info(`Cleaned up ${expiredNetworks.length} expired networks`);
    }
  }

  /**
   * Terminate a container that violated security policy
   */
  async terminateViolatingContainer(containerId) {
    try {
      logger.warn(`Terminating container ${containerId} due to security violation`);
      
      // Force remove the container
      const container = this.docker.getContainer(containerId);
      await container.remove({ force: true });
      
      // Audit log
      this.auditSecurityEvent('container_terminated', {
        containerId,
        reason: 'security_violation'
      });
      
    } catch (error) {
      logger.error(`Failed to terminate violating container ${containerId}:`, error);
    }
  }

  /**
   * Block network access for a container
   */
  async blockContainerNetwork(containerId) {
    try {
      logger.warn(`Blocking network access for container ${containerId}`);
      
      // This would integrate with iptables to block traffic
      // For now, we'll disconnect from all networks
      
      const connections = this.activeConnections.get(containerId) || [];
      for (const conn of connections) {
        await this.disconnectContainerFromNetwork(containerId, conn.jobId);
      }
      
      // Audit log
      this.auditSecurityEvent('network_blocked', {
        containerId,
        reason: 'security_violation'
      });
      
    } catch (error) {
      logger.error(`Failed to block network for container ${containerId}:`, error);
    }
  }

  /**
   * Rate limit a container's network traffic
   */
  async rateLimitContainer(containerId) {
    try {
      logger.info(`Applying rate limit to container ${containerId}`);
      
      // This would integrate with tc (traffic control) to limit bandwidth
      // For now, we'll log the action
      
      // Audit log
      this.auditSecurityEvent('rate_limited', {
        containerId,
        limit: '10m' // 10 Mbps
      });
      
    } catch (error) {
      logger.error(`Failed to rate limit container ${containerId}:`, error);
    }
  }

  /**
   * Audit network action
   */
  auditNetworkAction(action, jobId, details) {
    const audit = {
      timestamp: new Date(),
      action,
      jobId,
      details,
      type: 'network'
    };
    
    this.networkAudits.push(audit);
    
    // Emit audit event
    this.emit('networkAudit', audit);
  }

  /**
   * Audit security event
   */
  auditSecurityEvent(event, details) {
    const audit = {
      timestamp: new Date(),
      event,
      details,
      type: 'security'
    };
    
    this.networkAudits.push(audit);
    
    // Emit audit event
    this.emit('securityAudit', audit);
  }

  /**
   * Get network isolation report
   */
  getNetworkReport() {
    return {
      activeNetworks: Array.from(this.isolatedNetworks.values()),
      activeConnections: this.activeConnections.size,
      securityViolations: this.securityViolations.length,
      recentAudits: this.networkAudits.slice(-100),
      statistics: {
        totalNetworksCreated: this.networkAudits.filter(a => a.action === 'create').length,
        totalConnectionsMade: this.networkAudits.filter(a => a.action === 'connect').length,
        totalViolations: this.securityViolations.length,
        averageNetworkLifetime: this.calculateAverageNetworkLifetime()
      }
    };
  }

  /**
   * Calculate average network lifetime
   */
  calculateAverageNetworkLifetime() {
    const removals = this.networkAudits.filter(a => a.action === 'remove');
    if (removals.length === 0) return 0;
    
    // This is simplified - in production would track create/remove pairs
    return this.config.networkTtl; // Return configured TTL as estimate
  }

  /**
   * Simple hash code generator
   */
  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Stop the network isolation manager
   */
  async stop() {
    logger.info('Stopping Network Isolation Manager');
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Clean up all networks
    for (const jobId of this.isolatedNetworks.keys()) {
      try {
        await this.removeIsolatedNetwork(jobId);
      } catch (error) {
        logger.error(`Failed to remove network for job ${jobId} during shutdown:`, error);
      }
    }
    
    this.emit('stopped');
    logger.info('Network Isolation Manager stopped');
  }
}

module.exports = NetworkIsolationManager;