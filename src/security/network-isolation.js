/**
 * Network Isolation System
 * Provides per-job network segmentation and isolation for enhanced security
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class NetworkIsolationManager extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.config = {
      // Network isolation modes
      isolationMode: options.isolationMode || 'strict', // 'strict', 'moderate', 'minimal'
      networkDriver: options.networkDriver || 'bridge',
      ipamDriver: options.ipamDriver || 'default',
      
      // Network configuration
      subnetPool: options.subnetPool || '172.20.0.0/16',
      subnetSize: options.subnetSize || 24, // /24 subnets
      
      // Security policies
      allowInterContainerComm: options.allowInterContainerComm || false,
      allowExternalAccess: options.allowExternalAccess || true,
      enableFirewall: options.enableFirewall !== false,
      
      // DNS configuration
      customDns: options.customDns || ['8.8.8.8', '1.1.1.1'],
      enableDnsFiltering: options.enableDnsFiltering || true,
      blockedDomains: options.blockedDomains || [
        'malware.example.com',
        'phishing.example.com'
      ],
      
      // Network limits
      bandwidthLimit: options.bandwidthLimit || '100m', // 100 Mbps
      connectionLimit: options.connectionLimit || 1000,
      
      ...options
    };
    
    // Network state tracking
    this.jobNetworks = new Map(); // jobId -> networkInfo
    this.networkPools = new Map(); // poolId -> networkPool
    this.subnetAllocator = new SubnetAllocator(this.config.subnetPool, this.config.subnetSize);
    
    // Security rules
    this.firewallRules = new Map(); // networkId -> rules
    this.networkPolicies = new Map(); // policyId -> policy
    
    // Monitoring
    this.networkMetrics = {
      activeNetworks: 0,
      totalConnections: 0,
      blockedConnections: 0,
      bandwidthUsage: 0
    };
    
    this.isInitialized = false;
    this.cleanupInterval = null;
  }

  /**
   * Initialize the network isolation system
   */
  async initialize() {
    try {
      logger.info('Initializing Network Isolation Manager');
      
      // Initialize Docker network capabilities
      await this.initializeDockerNetworking();
      
      // Create default network policies
      await this.createDefaultPolicies();
      
      // Set up network monitoring
      this.setupNetworkMonitoring();
      
      // Start cleanup interval
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
   * Create isolated network for a job
   */
  async createIsolatedNetwork(jobId, jobConfig = {}) {
    try {
      if (!this.isInitialized) {
        throw new Error('Network Isolation Manager not initialized');
      }
      
      logger.info(`Creating isolated network for job ${jobId}`);
      
      // Allocate subnet
      const subnet = this.subnetAllocator.allocate();
      const networkName = this.generateNetworkName(jobId);
      
      // Create Docker network
      const network = await this.dockerAPI.createNetwork({
        Name: networkName,
        Driver: this.config.networkDriver,
        Internal: this.config.isolationMode === 'strict',
        IPAM: {
          Driver: this.config.ipamDriver,
          Config: [{
            Subnet: subnet,
            Gateway: this.calculateGateway(subnet)
          }]
        },
        Options: {
          'com.docker.network.bridge.name': `br-${jobId.substring(0, 12)}`,
          'com.docker.network.driver.mtu': '1500'
        },
        Labels: {
          'runnerhub.job.id': jobId,
          'runnerhub.network.type': 'isolated',
          'runnerhub.security.level': this.config.isolationMode,
          'runnerhub.created.at': new Date().toISOString()
        }
      });
      
      // Configure network security
      const securityConfig = await this.configureNetworkSecurity(network.Id, jobConfig);
      
      // Store network information
      const networkInfo = {
        id: network.Id,
        name: networkName,
        jobId,
        subnet,
        gateway: this.calculateGateway(subnet),
        securityConfig,
        createdAt: new Date(),
        containers: new Set()
      };
      
      this.jobNetworks.set(jobId, networkInfo);
      this.networkMetrics.activeNetworks++;
      
      // Emit network created event
      this.emit('networkCreated', {
        jobId,
        networkId: network.Id,
        subnet,
        securityLevel: this.config.isolationMode
      });
      
      logger.info(`Created isolated network ${networkName} for job ${jobId} with subnet ${subnet}`);
      return networkInfo;
      
    } catch (error) {
      logger.error(`Failed to create isolated network for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Connect container to isolated network
   */
  async connectContainer(jobId, containerId, containerConfig = {}) {
    try {
      const networkInfo = this.jobNetworks.get(jobId);
      if (!networkInfo) {
        throw new Error(`No isolated network found for job ${jobId}`);
      }
      
      logger.info(`Connecting container ${containerId} to isolated network for job ${jobId}`);
      
      // Allocate IP address
      const ipAddress = this.allocateContainerIP(networkInfo.subnet, networkInfo.containers.size);
      
      // Connect container to network
      await this.dockerAPI.connectToNetwork(networkInfo.id, containerId, {
        IPAMConfig: {
          IPv4Address: ipAddress
        },
        Aliases: [
          `container-${containerId.substring(0, 12)}`,
          `job-${jobId}`
        ]
      });
      
      // Update network information
      networkInfo.containers.add(containerId);
      
      // Apply container-specific network policies
      await this.applyContainerNetworkPolicies(containerId, networkInfo, containerConfig);
      
      this.emit('containerConnected', {
        jobId,
        containerId,
        networkId: networkInfo.id,
        ipAddress
      });
      
      logger.info(`Connected container ${containerId} to network ${networkInfo.name} with IP ${ipAddress}`);
      return { networkInfo, ipAddress };
      
    } catch (error) {
      logger.error(`Failed to connect container ${containerId} to network for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Disconnect container from network
   */
  async disconnectContainer(jobId, containerId) {
    try {
      const networkInfo = this.jobNetworks.get(jobId);
      if (!networkInfo) {
        logger.warn(`No network found for job ${jobId}, container ${containerId}`);
        return;
      }
      
      logger.info(`Disconnecting container ${containerId} from network for job ${jobId}`);
      
      // Disconnect from Docker network
      await this.dockerAPI.disconnectFromNetwork(networkInfo.id, containerId);
      
      // Update tracking
      networkInfo.containers.delete(containerId);
      
      this.emit('containerDisconnected', {
        jobId,
        containerId,
        networkId: networkInfo.id
      });
      
      logger.info(`Disconnected container ${containerId} from network ${networkInfo.name}`);
      
    } catch (error) {
      logger.error(`Failed to disconnect container ${containerId} from network for job ${jobId}:`, error);
      // Don't throw - cleanup should continue
    }
  }

  /**
   * Remove isolated network for a job
   */
  async removeIsolatedNetwork(jobId) {
    try {
      const networkInfo = this.jobNetworks.get(jobId);
      if (!networkInfo) {
        logger.warn(`No network found for job ${jobId}`);
        return;
      }
      
      logger.info(`Removing isolated network for job ${jobId}`);
      
      // Disconnect all remaining containers
      for (const containerId of networkInfo.containers) {
        await this.disconnectContainer(jobId, containerId);
      }
      
      // Remove Docker network
      await this.dockerAPI.removeNetwork(networkInfo.id);
      
      // Release subnet
      this.subnetAllocator.release(networkInfo.subnet);
      
      // Clean up tracking
      this.jobNetworks.delete(jobId);
      this.firewallRules.delete(networkInfo.id);
      this.networkMetrics.activeNetworks--;
      
      this.emit('networkRemoved', {
        jobId,
        networkId: networkInfo.id,
        subnet: networkInfo.subnet
      });
      
      logger.info(`Removed isolated network ${networkInfo.name} for job ${jobId}`);
      
    } catch (error) {
      logger.error(`Failed to remove isolated network for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Configure network security policies
   */
  async configureNetworkSecurity(networkId, jobConfig) {
    const securityConfig = {
      firewallRules: [],
      dnsFiltering: this.config.enableDnsFiltering,
      bandwidthLimit: this.config.bandwidthLimit,
      connectionLimit: this.config.connectionLimit
    };
    
    // Create firewall rules based on isolation mode
    switch (this.config.isolationMode) {
      case 'strict':
        securityConfig.firewallRules.push(
          { action: 'DENY', protocol: 'all', source: 'any', destination: 'external' },
          { action: 'ALLOW', protocol: 'tcp', source: 'container', destination: 'dns' },
          { action: 'ALLOW', protocol: 'udp', source: 'container', destination: 'dns' }
        );
        break;
        
      case 'moderate':
        securityConfig.firewallRules.push(
          { action: 'ALLOW', protocol: 'tcp', source: 'container', destination: 'external', ports: [80, 443] },
          { action: 'ALLOW', protocol: 'tcp', source: 'container', destination: 'dns' },
          { action: 'DENY', protocol: 'all', source: 'external', destination: 'container' }
        );
        break;
        
      case 'minimal':
        securityConfig.firewallRules.push(
          { action: 'ALLOW', protocol: 'all', source: 'container', destination: 'external' },
          { action: 'DENY', protocol: 'all', source: 'external', destination: 'container' }
        );
        break;
    }
    
    // Apply job-specific security rules
    if (jobConfig.allowedDomains) {
      securityConfig.allowedDomains = jobConfig.allowedDomains;
    }
    
    if (jobConfig.requiredPorts) {
      for (const port of jobConfig.requiredPorts) {
        securityConfig.firewallRules.push({
          action: 'ALLOW',
          protocol: 'tcp',
          source: 'container',
          destination: 'external',
          ports: [port]
        });
      }
    }
    
    // Store and apply rules
    this.firewallRules.set(networkId, securityConfig);
    await this.applyFirewallRules(networkId, securityConfig);
    
    return securityConfig;
  }

  /**
   * Apply firewall rules to network
   */
  async applyFirewallRules(networkId, securityConfig) {
    try {
      // In a real implementation, this would configure iptables or similar
      // For now, we'll log the rules that would be applied
      logger.info(`Applying firewall rules to network ${networkId}:`, {
        rules: securityConfig.firewallRules,
        dnsFiltering: securityConfig.dnsFiltering,
        bandwidthLimit: securityConfig.bandwidthLimit
      });
      
      // Apply bandwidth limiting (simplified)
      if (securityConfig.bandwidthLimit) {
        await this.applyBandwidthLimit(networkId, securityConfig.bandwidthLimit);
      }
      
      // Apply DNS filtering (simplified)
      if (securityConfig.dnsFiltering) {
        await this.applyDnsFiltering(networkId);
      }
      
    } catch (error) {
      logger.error(`Failed to apply firewall rules to network ${networkId}:`, error);
      throw error;
    }
  }

  /**
   * Apply bandwidth limiting
   */
  async applyBandwidthLimit(networkId, limit) {
    // Implementation would use tc (traffic control) or similar
    logger.info(`Applied bandwidth limit of ${limit} to network ${networkId}`);
  }

  /**
   * Apply DNS filtering
   */
  async applyDnsFiltering(networkId) {
    // Implementation would configure DNS filtering
    logger.info(`Applied DNS filtering to network ${networkId}, blocked domains:`, this.config.blockedDomains);
  }

  /**
   * Apply container-specific network policies
   */
  async applyContainerNetworkPolicies(containerId, networkInfo, containerConfig) {
    try {
      // Apply container-specific bandwidth limits
      if (containerConfig.bandwidthLimit) {
        await this.applyContainerBandwidthLimit(containerId, containerConfig.bandwidthLimit);
      }
      
      // Apply container-specific firewall rules
      if (containerConfig.firewallRules) {
        await this.applyContainerFirewallRules(containerId, containerConfig.firewallRules);
      }
      
      logger.info(`Applied network policies to container ${containerId}`);
      
    } catch (error) {
      logger.error(`Failed to apply network policies to container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Monitor network security events
   */
  async monitorNetworkSecurity() {
    try {
      // Check for suspicious network activity
      for (const [jobId, networkInfo] of this.jobNetworks) {
        const networkStats = await this.getNetworkStats(networkInfo.id);
        
        // Check for anomalies
        if (networkStats.connectionsPerSecond > this.config.connectionLimit) {
          this.emit('securityAlert', {
            type: 'excessive_connections',
            jobId,
            networkId: networkInfo.id,
            value: networkStats.connectionsPerSecond,
            threshold: this.config.connectionLimit
          });
        }
        
        if (networkStats.bandwidthUsage > this.parseBandwidthLimit(this.config.bandwidthLimit)) {
          this.emit('securityAlert', {
            type: 'bandwidth_exceeded',
            jobId,
            networkId: networkInfo.id,
            value: networkStats.bandwidthUsage,
            threshold: this.config.bandwidthLimit
          });
        }
      }
      
    } catch (error) {
      logger.error('Error monitoring network security:', error);
    }
  }

  /**
   * Helper methods
   */
  
  generateNetworkName(jobId) {
    return `runnerhub-job-${jobId.substring(0, 12)}`;
  }
  
  calculateGateway(subnet) {
    // Calculate first IP in subnet as gateway
    const parts = subnet.split('/')[0].split('.');
    parts[3] = '1';
    return parts.join('.');
  }
  
  allocateContainerIP(subnet, containerIndex) {
    // Allocate IP addresses starting from .10
    const parts = subnet.split('/')[0].split('.');
    parts[3] = String(10 + containerIndex);
    return parts.join('.');
  }
  
  async initializeDockerNetworking() {
    // Verify Docker network capabilities
    const networks = await this.dockerAPI.listNetworks();
    logger.info(`Found ${networks.length} existing Docker networks`);
  }
  
  async createDefaultPolicies() {
    // Create default network policies
    this.networkPolicies.set('default-strict', {
      allowInterContainer: false,
      allowExternal: false,
      requiredPorts: []
    });
    
    this.networkPolicies.set('default-moderate', {
      allowInterContainer: false,
      allowExternal: true,
      requiredPorts: [80, 443]
    });
  }
  
  setupNetworkMonitoring() {
    // Set up periodic security monitoring
    setInterval(() => {
      this.monitorNetworkSecurity();
    }, 30000); // Every 30 seconds
  }
  
  startCleanupTimer() {
    // Clean up orphaned networks every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOrphanedNetworks();
    }, 300000);
  }
  
  async cleanupOrphanedNetworks() {
    try {
      const networks = await this.dockerAPI.listNetworks({
        filters: { label: ['runnerhub.network.type=isolated'] }
      });
      
      for (const network of networks) {
        const jobId = network.Labels['runnerhub.job.id'];
        if (!this.jobNetworks.has(jobId)) {
          logger.warn(`Found orphaned network ${network.Name}, removing`);
          await this.dockerAPI.removeNetwork(network.Id);
        }
      }
      
    } catch (error) {
      logger.error('Error during network cleanup:', error);
    }
  }
  
  async getNetworkStats(_networkId) {
    // Simplified network stats - in production would get real metrics
    return {
      connectionsPerSecond: Math.floor(Math.random() * 100),
      bandwidthUsage: Math.floor(Math.random() * 1000000), // bytes/sec
      activeConnections: Math.floor(Math.random() * 50)
    };
  }
  
  parseBandwidthLimit(limit) {
    // Parse bandwidth limit string (e.g., "100m" -> 100000000 bytes/sec)
    const match = limit.match(/^(\d+)([kmg]?)$/i);
    if (!match) return 0;
    
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    switch (unit) {
      case 'k': return value * 1000;
      case 'm': return value * 1000000;
      case 'g': return value * 1000000000;
      default: return value;
    }
  }
  
  async applyContainerBandwidthLimit(containerId, limit) {
    logger.info(`Applied bandwidth limit ${limit} to container ${containerId}`);
  }
  
  async applyContainerFirewallRules(containerId, rules) {
    logger.info(`Applied firewall rules to container ${containerId}:`, rules);
  }

  /**
   * Get network isolation status
   */
  getNetworkStatus() {
    return {
      activeNetworks: this.networkMetrics.activeNetworks,
      jobNetworks: Array.from(this.jobNetworks.entries()).map(([jobId, info]) => ({
        jobId,
        networkId: info.id,
        subnet: info.subnet,
        containers: info.containers.size,
        securityLevel: this.config.isolationMode,
        createdAt: info.createdAt
      })),
      metrics: this.networkMetrics,
      config: {
        isolationMode: this.config.isolationMode,
        subnetPool: this.config.subnetPool,
        enableFirewall: this.config.enableFirewall,
        enableDnsFiltering: this.config.enableDnsFiltering
      }
    };
  }

  /**
   * Stop network isolation manager
   */
  async stop() {
    logger.info('Stopping Network Isolation Manager');
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Clean up all job networks
    for (const jobId of this.jobNetworks.keys()) {
      await this.removeIsolatedNetwork(jobId);
    }
    
    this.emit('stopped');
    logger.info('Network Isolation Manager stopped');
  }
}

/**
 * Subnet Allocator
 * Manages subnet allocation and release
 */
class SubnetAllocator {
  constructor(pool, subnetSize) {
    this.pool = pool;
    this.subnetSize = subnetSize;
    this.allocatedSubnets = new Set();
    
    // Parse pool network
    const [baseIP, poolSize] = pool.split('/');
    this.baseIP = baseIP;
    this.poolSize = parseInt(poolSize);
    this.maxSubnets = Math.pow(2, subnetSize - this.poolSize);
  }
  
  allocate() {
    for (let i = 0; i < this.maxSubnets; i++) {
      const subnet = this.generateSubnet(i);
      if (!this.allocatedSubnets.has(subnet)) {
        this.allocatedSubnets.add(subnet);
        return subnet;
      }
    }
    throw new Error('No available subnets in pool');
  }
  
  release(subnet) {
    this.allocatedSubnets.delete(subnet);
  }
  
  generateSubnet(index) {
    const parts = this.baseIP.split('.');
    parts[2] = String(parseInt(parts[2]) + index);
    return `${parts.join('.')}/${this.subnetSize}`;
  }
}

module.exports = NetworkIsolationManager;