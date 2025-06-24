/**
 * Network Bandwidth Controller
 * Advanced network traffic shaping, monitoring, and control for containers
 */

const EventEmitter = require('events');
const Docker = require('dockerode');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const logger = require('../utils/logger');

class NetworkBandwidthController extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Bandwidth configuration
      bandwidth: {
        defaultIngressLimit: options.defaultIngressLimit || '100mbit',
        defaultEgressLimit: options.defaultEgressLimit || '100mbit',
        minBandwidth: options.minBandwidth || '1mbit',
        maxBandwidth: options.maxBandwidth || '1gbit',
        burstSize: options.burstSize || '10mb',
        latency: options.latency || '0ms'
      },
      
      // Network profiles
      profiles: {
        micro: {
          ingress: '10mbit',
          egress: '10mbit',
          burst: '1mb',
          priority: 1,
          latency: '0ms'
        },
        small: {
          ingress: '50mbit',
          egress: '50mbit',
          burst: '5mb',
          priority: 2,
          latency: '0ms'
        },
        medium: {
          ingress: '100mbit',
          egress: '100mbit',
          burst: '10mb',
          priority: 3,
          latency: '0ms'
        },
        large: {
          ingress: '500mbit',
          egress: '500mbit',
          burst: '50mb',
          priority: 4,
          latency: '0ms'
        },
        xlarge: {
          ingress: '1gbit',
          egress: '1gbit',
          burst: '100mb',
          priority: 5,
          latency: '0ms'
        },
        ...options.customProfiles
      },
      
      // Traffic control configuration
      trafficControl: {
        enabled: options.trafficControlEnabled !== false,
        interface: options.interface || 'eth0',
        queueDiscipline: options.queueDiscipline || 'htb', // htb, tbf, cbq
        defaultClass: options.defaultClass || 1,
        maxClasses: options.maxClasses || 10000
      },
      
      // Monitoring configuration
      monitoring: {
        enabled: options.monitoringEnabled !== false,
        interval: options.monitoringInterval || 10000, // 10 seconds
        retainMetrics: options.retainMetrics || 3600000, // 1 hour
        enableAlerts: options.enableAlerts !== false
      },
      
      // Rate limiting configuration
      rateLimiting: {
        enabled: options.rateLimitingEnabled !== false,
        packetsPerSecond: options.packetsPerSecond || 10000,
        connectionsPerMinute: options.connectionsPerMinute || 1000,
        burstAllowance: options.burstAllowance || 1.5
      },
      
      // Protocol-specific limits
      protocols: {
        http: {
          requestsPerSecond: options.httpRequestsPerSecond || 1000,
          maxConnections: options.httpMaxConnections || 100
        },
        https: {
          requestsPerSecond: options.httpsRequestsPerSecond || 1000,
          maxConnections: options.httpsMaxConnections || 100
        },
        ssh: {
          enabled: options.sshEnabled || false,
          maxConnections: options.sshMaxConnections || 5
        },
        dns: {
          queriesPerSecond: options.dnsQueriesPerSecond || 100
        }
      },
      
      ...options
    };
    
    // Docker client
    this.docker = new Docker();
    
    // Network tracking
    this.containerBandwidth = new Map(); // containerId -> bandwidth config
    this.networkInterfaces = new Map(); // containerId -> interface info
    this.trafficStats = new Map(); // containerId -> traffic statistics
    this.rateLimiters = new Map(); // containerId -> rate limiter info
    
    // TC (Traffic Control) management
    this.tcClasses = new Map(); // containerId -> tc class ID
    this.nextClassId = 10; // Start from class 10
    
    // Statistics
    this.stats = {
      totalContainersManaged: 0,
      totalBandwidthAllocated: { ingress: 0, egress: 0 },
      totalTrafficProcessed: { rx: 0, tx: 0 },
      profileUsage: new Map(),
      violations: {
        bandwidth: 0,
        rateLimit: 0,
        protocol: 0
      },
      alerts: {
        total: 0,
        bandwidth: 0,
        congestion: 0,
        errors: 0
      }
    };
    
    this.monitoringTimer = null;
    this.isStarted = false;
    this.tcInitialized = false;
  }

  /**
   * Start network bandwidth controller
   */
  async start() {
    if (this.isStarted) {
      logger.warn('Network bandwidth controller already started');
      return;
    }
    
    logger.info('Starting Network Bandwidth Controller');
    
    // Initialize traffic control
    if (this.config.trafficControl.enabled) {
      await this.initializeTrafficControl();
    }
    
    // Start monitoring
    if (this.config.monitoring.enabled) {
      this.monitoringTimer = setInterval(() => {
        this.monitorNetworkTraffic().catch(error => {
          logger.error('Network monitoring failed:', error);
        });
      }, this.config.monitoring.interval);
    }
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Network bandwidth controller started');
  }

  /**
   * Stop network bandwidth controller
   */
  async stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Network Bandwidth Controller');
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    // Clean up traffic control
    if (this.tcInitialized) {
      await this.cleanupTrafficControl();
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Network bandwidth controller stopped');
  }

  /**
   * Apply bandwidth limits to container
   */
  async applyBandwidthLimits(containerId, requirements = {}) {
    try {
      // Determine network profile
      const profile = this.determineNetworkProfile(requirements);
      
      // Calculate bandwidth limits
      const limits = this.calculateBandwidthLimits(profile, requirements);
      
      // Get container network interface
      const networkInterface = await this.getContainerInterface(containerId);
      
      // Apply traffic shaping
      if (this.config.trafficControl.enabled) {
        await this.applyTrafficShaping(containerId, networkInterface, limits);
      }
      
      // Set up rate limiting
      if (this.config.rateLimiting.enabled) {
        await this.setupRateLimiting(containerId, limits);
      }
      
      // Track bandwidth allocation
      this.containerBandwidth.set(containerId, {
        limits,
        profile: profile.name,
        interface: networkInterface,
        appliedAt: new Date(),
        requirements
      });
      
      // Initialize traffic statistics
      this.trafficStats.set(containerId, {
        rx: { bytes: 0, packets: 0, errors: 0, dropped: 0 },
        tx: { bytes: 0, packets: 0, errors: 0, dropped: 0 },
        history: [],
        lastUpdate: new Date()
      });
      
      // Update statistics
      this.stats.totalContainersManaged++;
      this.stats.totalBandwidthAllocated.ingress += this.parseBandwidth(limits.ingress);
      this.stats.totalBandwidthAllocated.egress += this.parseBandwidth(limits.egress);
      this.updateProfileUsage(profile.name);
      
      logger.info(`Applied bandwidth limits to container ${containerId.substring(0, 12)}: ${profile.name} profile`);
      
      this.emit('bandwidthApplied', {
        containerId,
        profile: profile.name,
        limits
      });
      
      return limits;
      
    } catch (error) {
      logger.error(`Failed to apply bandwidth limits to container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Initialize traffic control
   */
  async initializeTrafficControl() {
    try {
      const iface = this.config.trafficControl.interface;
      
      // Check if TC is already configured
      try {
        await execAsync(`tc qdisc show dev ${iface}`);
        logger.info('Traffic control already initialized');
      } catch (error) {
        // Initialize root qdisc
        await execAsync(`tc qdisc add dev ${iface} root handle 1: htb default ${this.config.trafficControl.defaultClass}`);
        
        // Add default class
        await execAsync(`tc class add dev ${iface} parent 1: classid 1:1 htb rate ${this.config.bandwidth.maxBandwidth}`);
        
        logger.info('Traffic control initialized');
      }
      
      this.tcInitialized = true;
      
    } catch (error) {
      logger.error('Failed to initialize traffic control:', error);
      throw error;
    }
  }

  /**
   * Determine network profile
   */
  determineNetworkProfile(requirements) {
    // Check for explicit profile
    if (requirements.profile && this.config.profiles[requirements.profile]) {
      return {
        name: requirements.profile,
        ...this.config.profiles[requirements.profile]
      };
    }
    
    // Auto-select profile based on requirements
    const requiredBandwidth = this.parseBandwidth(requirements.bandwidth || '100mbit');
    
    // Find best matching profile
    let selectedProfile = null;
    let selectedName = 'medium'; // default
    
    for (const [name, profile] of Object.entries(this.config.profiles)) {
      const profileBandwidth = Math.min(
        this.parseBandwidth(profile.ingress),
        this.parseBandwidth(profile.egress)
      );
      
      if (profileBandwidth >= requiredBandwidth) {
        if (!selectedProfile || profileBandwidth < Math.min(
          this.parseBandwidth(selectedProfile.ingress),
          this.parseBandwidth(selectedProfile.egress)
        )) {
          selectedProfile = profile;
          selectedName = name;
        }
      }
    }
    
    return {
      name: selectedName,
      ...(selectedProfile || this.config.profiles.medium)
    };
  }

  /**
   * Calculate bandwidth limits
   */
  calculateBandwidthLimits(profile, requirements) {
    const limits = {
      ingress: requirements.ingress || profile.ingress || this.config.bandwidth.defaultIngressLimit,
      egress: requirements.egress || profile.egress || this.config.bandwidth.defaultEgressLimit,
      burst: requirements.burst || profile.burst || this.config.bandwidth.burstSize,
      priority: requirements.priority || profile.priority || 3,
      latency: requirements.latency || profile.latency || this.config.bandwidth.latency,
      
      // Protocol-specific limits
      protocols: {
        http: {
          requestsPerSecond: requirements.httpRps || this.config.protocols.http.requestsPerSecond,
          maxConnections: requirements.httpConnections || this.config.protocols.http.maxConnections
        },
        https: {
          requestsPerSecond: requirements.httpsRps || this.config.protocols.https.requestsPerSecond,
          maxConnections: requirements.httpsConnections || this.config.protocols.https.maxConnections
        },
        ssh: {
          enabled: requirements.sshEnabled !== undefined ? requirements.sshEnabled : this.config.protocols.ssh.enabled,
          maxConnections: requirements.sshConnections || this.config.protocols.ssh.maxConnections
        },
        dns: {
          queriesPerSecond: requirements.dnsQps || this.config.protocols.dns.queriesPerSecond
        }
      },
      
      // Rate limiting
      rateLimit: {
        packetsPerSecond: requirements.pps || this.config.rateLimiting.packetsPerSecond,
        connectionsPerMinute: requirements.cpm || this.config.rateLimiting.connectionsPerMinute
      }
    };
    
    // Apply bounds
    this.applyBandwidthBounds(limits);
    
    return limits;
  }

  /**
   * Apply bounds to bandwidth limits
   */
  applyBandwidthBounds(limits) {
    const minBw = this.parseBandwidth(this.config.bandwidth.minBandwidth);
    const maxBw = this.parseBandwidth(this.config.bandwidth.maxBandwidth);
    
    // Ensure bandwidth is within bounds
    const ingressBw = this.parseBandwidth(limits.ingress);
    const egressBw = this.parseBandwidth(limits.egress);
    
    limits.ingress = this.formatBandwidth(Math.max(minBw, Math.min(maxBw, ingressBw)));
    limits.egress = this.formatBandwidth(Math.max(minBw, Math.min(maxBw, egressBw)));
    
    // Ensure burst doesn't exceed bandwidth
    const burstSize = this.parseBandwidth(limits.burst);
    const maxBurst = Math.min(ingressBw, egressBw) / 8; // 1/8 of bandwidth
    limits.burst = this.formatBandwidth(Math.min(burstSize, maxBurst));
    
    // Bound priority
    limits.priority = Math.max(1, Math.min(10, limits.priority));
  }

  /**
   * Get container network interface
   */
  async getContainerInterface(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      
      // Get primary network interface
      const networks = info.NetworkSettings?.Networks;
      if (!networks) {
        throw new Error('No networks found for container');
      }
      
      // Get the first network (usually bridge)
      const networkName = Object.keys(networks)[0];
      const networkInfo = networks[networkName];
      
      // Get veth interface on host
      const { stdout } = await execAsync(
        `ip link | grep -E "veth.*@if${networkInfo.EndpointID?.substring(0, 8)}" | cut -d: -f2 | tr -d ' '`
      );
      
      const vethInterface = stdout.trim() || `veth${containerId.substring(0, 8)}`;
      
      this.networkInterfaces.set(containerId, {
        veth: vethInterface,
        network: networkName,
        ip: networkInfo.IPAddress,
        mac: networkInfo.MacAddress,
        gateway: networkInfo.Gateway
      });
      
      return vethInterface;
      
    } catch (error) {
      logger.error(`Failed to get container interface:`, error);
      throw error;
    }
  }

  /**
   * Apply traffic shaping
   */
  async applyTrafficShaping(containerId, networkInterface, limits) {
    try {
      const classId = this.getOrCreateTcClass(containerId);
      const iface = this.config.trafficControl.interface;
      
      // Create HTB class for container
      await execAsync(
        `tc class add dev ${iface} parent 1:1 classid 1:${classId} htb ` +
        `rate ${limits.egress} burst ${limits.burst} prio ${limits.priority}`
      );
      
      // Add SFQ qdisc for fairness
      await execAsync(
        `tc qdisc add dev ${iface} parent 1:${classId} handle ${classId}: sfq perturb 10`
      );
      
      // Apply ingress policing on container interface
      await this.applyIngressPolicing(networkInterface, limits.ingress, limits.burst);
      
      // Add latency if specified
      if (limits.latency && limits.latency !== '0ms') {
        await this.applyNetworkLatency(networkInterface, limits.latency);
      }
      
      // Set up iptables marking for traffic classification
      await this.setupTrafficMarking(containerId, classId);
      
      logger.debug(`Applied traffic shaping to container ${containerId.substring(0, 12)}`);
      
    } catch (error) {
      logger.error('Failed to apply traffic shaping:', error);
      throw error;
    }
  }

  /**
   * Apply ingress policing
   */
  async applyIngressPolicing(networkInterface, rate, burst) {
    try {
      // Remove existing ingress qdisc if any
      await execAsync(`tc qdisc del dev ${networkInterface} ingress 2>/dev/null || true`);
      
      // Add ingress qdisc
      await execAsync(`tc qdisc add dev ${networkInterface} ingress`);
      
      // Add policer
      await execAsync(
        `tc filter add dev ${networkInterface} parent ffff: protocol ip prio 1 u32 ` +
        `match u32 0 0 police rate ${rate} burst ${burst} drop flowid :1`
      );
      
    } catch (error) {
      logger.error('Failed to apply ingress policing:', error);
    }
  }

  /**
   * Apply network latency
   */
  async applyNetworkLatency(interface, latency) {
    try {
      // Parse latency value
      const latencyMs = parseInt(latency);
      if (latencyMs <= 0) return;
      
      // Add netem qdisc for latency
      await execAsync(
        `tc qdisc add dev ${interface} root netem delay ${latency}`
      );
      
    } catch (error) {
      logger.error('Failed to apply network latency:', error);
    }
  }

  /**
   * Setup traffic marking
   */
  async setupTrafficMarking(containerId, classId) {
    try {
      const containerInfo = this.networkInterfaces.get(containerId);
      if (!containerInfo || !containerInfo.ip) return;
      
      // Mark outgoing traffic from container
      await execAsync(
        `iptables -t mangle -A POSTROUTING -s ${containerInfo.ip} -j MARK --set-mark ${classId}`
      );
      
      // Apply tc filter based on mark
      const iface = this.config.trafficControl.interface;
      await execAsync(
        `tc filter add dev ${iface} parent 1: protocol ip prio 1 handle ${classId} fw flowid 1:${classId}`
      );
      
    } catch (error) {
      logger.error('Failed to setup traffic marking:', error);
    }
  }

  /**
   * Setup rate limiting
   */
  async setupRateLimiting(containerId, limits) {
    try {
      const containerInfo = this.networkInterfaces.get(containerId);
      if (!containerInfo || !containerInfo.ip) return;
      
      // Create iptables rules for rate limiting
      const rateLimitChain = `RATELIMIT_${containerId.substring(0, 8)}`;
      
      // Create custom chain
      await execAsync(`iptables -t filter -N ${rateLimitChain} 2>/dev/null || true`);
      
      // Add rate limiting rules
      await execAsync(
        `iptables -t filter -A ${rateLimitChain} -m limit --limit ${limits.rateLimit.packetsPerSecond}/s ` +
        `--limit-burst ${Math.floor(limits.rateLimit.packetsPerSecond * this.config.rateLimiting.burstAllowance)} -j ACCEPT`
      );
      
      // Drop exceeding packets
      await execAsync(`iptables -t filter -A ${rateLimitChain} -j DROP`);
      
      // Apply to container traffic
      await execAsync(
        `iptables -t filter -A FORWARD -s ${containerInfo.ip} -j ${rateLimitChain}`
      );
      await execAsync(
        `iptables -t filter -A FORWARD -d ${containerInfo.ip} -j ${rateLimitChain}`
      );
      
      // Protocol-specific rate limiting
      await this.setupProtocolRateLimiting(containerId, containerInfo.ip, limits.protocols);
      
      this.rateLimiters.set(containerId, {
        chain: rateLimitChain,
        rules: [],
        appliedAt: new Date()
      });
      
    } catch (error) {
      logger.error('Failed to setup rate limiting:', error);
    }
  }

  /**
   * Setup protocol-specific rate limiting
   */
  async setupProtocolRateLimiting(containerId, containerIp, protocolLimits) {
    try {
      const rateLimiter = this.rateLimiters.get(containerId);
      if (!rateLimiter) return;
      
      // HTTP/HTTPS rate limiting
      if (protocolLimits.http.requestsPerSecond > 0) {
        await execAsync(
          `iptables -t filter -I FORWARD -s ${containerIp} -p tcp --dport 80 ` +
          `-m limit --limit ${protocolLimits.http.requestsPerSecond}/s -j ACCEPT`
        );
        await execAsync(
          `iptables -t filter -I FORWARD -s ${containerIp} -p tcp --dport 443 ` +
          `-m limit --limit ${protocolLimits.https.requestsPerSecond}/s -j ACCEPT`
        );
      }
      
      // SSH access control
      if (!protocolLimits.ssh.enabled) {
        await execAsync(
          `iptables -t filter -A FORWARD -s ${containerIp} -p tcp --dport 22 -j DROP`
        );
        await execAsync(
          `iptables -t filter -A FORWARD -d ${containerIp} -p tcp --dport 22 -j DROP`
        );
      }
      
      // DNS rate limiting
      if (protocolLimits.dns.queriesPerSecond > 0) {
        await execAsync(
          `iptables -t filter -I FORWARD -s ${containerIp} -p udp --dport 53 ` +
          `-m limit --limit ${protocolLimits.dns.queriesPerSecond}/s -j ACCEPT`
        );
      }
      
    } catch (error) {
      logger.error('Failed to setup protocol rate limiting:', error);
    }
  }

  /**
   * Remove bandwidth limits
   */
  async removeBandwidthLimits(containerId) {
    try {
      const bandwidthInfo = this.containerBandwidth.get(containerId);
      if (!bandwidthInfo) {
        logger.warn(`No bandwidth limits found for container ${containerId}`);
        return;
      }
      
      // Remove traffic shaping
      if (this.tcInitialized) {
        await this.removeTrafficShaping(containerId);
      }
      
      // Remove rate limiting
      await this.removeRateLimiting(containerId);
      
      // Update statistics
      this.stats.totalBandwidthAllocated.ingress -= this.parseBandwidth(bandwidthInfo.limits.ingress);
      this.stats.totalBandwidthAllocated.egress -= this.parseBandwidth(bandwidthInfo.limits.egress);
      
      // Clean up tracking
      this.containerBandwidth.delete(containerId);
      this.networkInterfaces.delete(containerId);
      this.trafficStats.delete(containerId);
      
      logger.info(`Removed bandwidth limits from container ${containerId.substring(0, 12)}`);
      
      this.emit('bandwidthRemoved', { containerId });
      
    } catch (error) {
      logger.error(`Failed to remove bandwidth limits:`, error);
    }
  }

  /**
   * Remove traffic shaping
   */
  async removeTrafficShaping(containerId) {
    try {
      const classId = this.tcClasses.get(containerId);
      if (!classId) return;
      
      const iface = this.config.trafficControl.interface;
      
      // Remove TC class
      await execAsync(`tc class del dev ${iface} classid 1:${classId} 2>/dev/null || true`);
      
      // Remove traffic marking
      const containerInfo = this.networkInterfaces.get(containerId);
      if (containerInfo && containerInfo.ip) {
        await execAsync(
          `iptables -t mangle -D POSTROUTING -s ${containerInfo.ip} -j MARK --set-mark ${classId} 2>/dev/null || true`
        );
      }
      
      // Remove TC filter
      await execAsync(
        `tc filter del dev ${iface} parent 1: handle ${classId} fw 2>/dev/null || true`
      );
      
      this.tcClasses.delete(containerId);
      
    } catch (error) {
      logger.error('Failed to remove traffic shaping:', error);
    }
  }

  /**
   * Remove rate limiting
   */
  async removeRateLimiting(containerId) {
    try {
      const rateLimiter = this.rateLimiters.get(containerId);
      if (!rateLimiter) return;
      
      const containerInfo = this.networkInterfaces.get(containerId);
      if (containerInfo && containerInfo.ip) {
        // Remove FORWARD rules
        await execAsync(
          `iptables -t filter -D FORWARD -s ${containerInfo.ip} -j ${rateLimiter.chain} 2>/dev/null || true`
        );
        await execAsync(
          `iptables -t filter -D FORWARD -d ${containerInfo.ip} -j ${rateLimiter.chain} 2>/dev/null || true`
        );
        
        // Remove protocol-specific rules
        await execAsync(
          `iptables -t filter -D FORWARD -s ${containerInfo.ip} -p tcp --dport 80 -m limit -j ACCEPT 2>/dev/null || true`
        );
        await execAsync(
          `iptables -t filter -D FORWARD -s ${containerInfo.ip} -p tcp --dport 443 -m limit -j ACCEPT 2>/dev/null || true`
        );
        await execAsync(
          `iptables -t filter -D FORWARD -s ${containerInfo.ip} -p tcp --dport 22 -j DROP 2>/dev/null || true`
        );
        await execAsync(
          `iptables -t filter -D FORWARD -d ${containerInfo.ip} -p tcp --dport 22 -j DROP 2>/dev/null || true`
        );
      }
      
      // Remove custom chain
      await execAsync(`iptables -t filter -F ${rateLimiter.chain} 2>/dev/null || true`);
      await execAsync(`iptables -t filter -X ${rateLimiter.chain} 2>/dev/null || true`);
      
      this.rateLimiters.delete(containerId);
      
    } catch (error) {
      logger.error('Failed to remove rate limiting:', error);
    }
  }

  /**
   * Monitor network traffic
   */
  async monitorNetworkTraffic() {
    try {
      const monitoringTasks = [];
      
      for (const [containerId, bandwidthInfo] of this.containerBandwidth) {
        monitoringTasks.push(this.monitorContainerTraffic(containerId, bandwidthInfo));
      }
      
      await Promise.allSettled(monitoringTasks);
      
      // Update global statistics
      this.updateNetworkStatistics();
      
      // Check for alerts
      if (this.config.monitoring.enableAlerts) {
        this.checkNetworkAlerts();
      }
      
    } catch (error) {
      logger.error('Network monitoring failed:', error);
    }
  }

  /**
   * Monitor container traffic
   */
  async monitorContainerTraffic(containerId, bandwidthInfo) {
    try {
      const interface = bandwidthInfo.interface;
      if (!interface) return;
      
      // Get interface statistics
      const stats = await this.getInterfaceStatistics(interface);
      
      // Get previous stats
      const prevStats = this.trafficStats.get(containerId);
      if (!prevStats) return;
      
      // Calculate rates
      const timeDiff = (Date.now() - prevStats.lastUpdate.getTime()) / 1000; // seconds
      if (timeDiff <= 0) return;
      
      const rxRate = (stats.rx.bytes - prevStats.rx.bytes) / timeDiff;
      const txRate = (stats.tx.bytes - prevStats.tx.bytes) / timeDiff;
      
      // Update statistics
      const updatedStats = {
        rx: stats.rx,
        tx: stats.tx,
        rates: {
          rx: rxRate,
          tx: txRate,
          rxPackets: (stats.rx.packets - prevStats.rx.packets) / timeDiff,
          txPackets: (stats.tx.packets - prevStats.tx.packets) / timeDiff
        },
        lastUpdate: new Date()
      };
      
      // Add to history
      if (!updatedStats.history) {
        updatedStats.history = [];
      }
      updatedStats.history.push({
        timestamp: new Date(),
        rx: rxRate,
        tx: txRate
      });
      
      // Keep limited history
      const maxHistory = this.config.monitoring.retainMetrics / this.config.monitoring.interval;
      if (updatedStats.history.length > maxHistory) {
        updatedStats.history.shift();
      }
      
      this.trafficStats.set(containerId, updatedStats);
      
      // Check for violations
      await this.checkBandwidthViolations(containerId, updatedStats.rates, bandwidthInfo.limits);
      
      // Update total traffic
      this.stats.totalTrafficProcessed.rx += stats.rx.bytes - prevStats.rx.bytes;
      this.stats.totalTrafficProcessed.tx += stats.tx.bytes - prevStats.tx.bytes;
      
    } catch (error) {
      logger.debug(`Failed to monitor container ${containerId} traffic:`, error);
    }
  }

  /**
   * Get interface statistics
   */
  async getInterfaceStatistics(interface) {
    try {
      const { stdout } = await execAsync(`cat /sys/class/net/${interface}/statistics/rx_bytes`);
      const rxBytes = parseInt(stdout.trim()) || 0;
      
      const { stdout: txOut } = await execAsync(`cat /sys/class/net/${interface}/statistics/tx_bytes`);
      const txBytes = parseInt(txOut.trim()) || 0;
      
      const { stdout: rxPkts } = await execAsync(`cat /sys/class/net/${interface}/statistics/rx_packets`);
      const rxPackets = parseInt(rxPkts.trim()) || 0;
      
      const { stdout: txPkts } = await execAsync(`cat /sys/class/net/${interface}/statistics/tx_packets`);
      const txPackets = parseInt(txPkts.trim()) || 0;
      
      const { stdout: rxErr } = await execAsync(`cat /sys/class/net/${interface}/statistics/rx_errors`);
      const rxErrors = parseInt(rxErr.trim()) || 0;
      
      const { stdout: txErr } = await execAsync(`cat /sys/class/net/${interface}/statistics/tx_errors`);
      const txErrors = parseInt(txErr.trim()) || 0;
      
      const { stdout: rxDrop } = await execAsync(`cat /sys/class/net/${interface}/statistics/rx_dropped`);
      const rxDropped = parseInt(rxDrop.trim()) || 0;
      
      const { stdout: txDrop } = await execAsync(`cat /sys/class/net/${interface}/statistics/tx_dropped`);
      const txDropped = parseInt(txDrop.trim()) || 0;
      
      return {
        rx: {
          bytes: rxBytes,
          packets: rxPackets,
          errors: rxErrors,
          dropped: rxDropped
        },
        tx: {
          bytes: txBytes,
          packets: txPackets,
          errors: txErrors,
          dropped: txDropped
        }
      };
      
    } catch (error) {
      return {
        rx: { bytes: 0, packets: 0, errors: 0, dropped: 0 },
        tx: { bytes: 0, packets: 0, errors: 0, dropped: 0 }
      };
    }
  }

  /**
   * Check bandwidth violations
   */
  async checkBandwidthViolations(containerId, rates, limits) {
    const violations = [];
    
    // Check ingress violation
    const ingressLimit = this.parseBandwidth(limits.ingress);
    if (rates.rx > ingressLimit) {
      violations.push({
        type: 'ingress',
        actual: rates.rx,
        limit: ingressLimit,
        percentage: (rates.rx / ingressLimit) * 100
      });
    }
    
    // Check egress violation
    const egressLimit = this.parseBandwidth(limits.egress);
    if (rates.tx > egressLimit) {
      violations.push({
        type: 'egress',
        actual: rates.tx,
        limit: egressLimit,
        percentage: (rates.tx / egressLimit) * 100
      });
    }
    
    // Check packet rate violations
    if (rates.rxPackets > limits.rateLimit.packetsPerSecond ||
        rates.txPackets > limits.rateLimit.packetsPerSecond) {
      violations.push({
        type: 'packet_rate',
        actual: Math.max(rates.rxPackets, rates.txPackets),
        limit: limits.rateLimit.packetsPerSecond
      });
    }
    
    if (violations.length > 0) {
      this.stats.violations.bandwidth++;
      
      logger.warn(`Bandwidth violations detected for container ${containerId.substring(0, 12)}:`, violations);
      
      this.emit('bandwidthViolation', {
        containerId,
        violations,
        timestamp: new Date()
      });
    }
  }

  /**
   * Update network statistics
   */
  updateNetworkStatistics() {
    // Calculate aggregate statistics
    let totalRxRate = 0;
    let totalTxRate = 0;
    let activeContainers = 0;
    
    for (const [containerId, stats] of this.trafficStats) {
      if (stats.rates) {
        totalRxRate += stats.rates.rx;
        totalTxRate += stats.rates.tx;
        activeContainers++;
      }
    }
    
    this.stats.currentRates = {
      rx: totalRxRate,
      tx: totalTxRate,
      total: totalRxRate + totalTxRate
    };
    
    this.stats.activeContainers = activeContainers;
  }

  /**
   * Check network alerts
   */
  checkNetworkAlerts() {
    const alerts = [];
    
    // Check for high bandwidth usage
    for (const [containerId, stats] of this.trafficStats) {
      const bandwidthInfo = this.containerBandwidth.get(containerId);
      if (!bandwidthInfo || !stats.rates) continue;
      
      const ingressLimit = this.parseBandwidth(bandwidthInfo.limits.ingress);
      const egressLimit = this.parseBandwidth(bandwidthInfo.limits.egress);
      
      const ingressUsage = (stats.rates.rx / ingressLimit) * 100;
      const egressUsage = (stats.rates.tx / egressLimit) * 100;
      
      if (ingressUsage > 90 || egressUsage > 90) {
        alerts.push({
          type: 'high_bandwidth',
          containerId,
          severity: (ingressUsage > 95 || egressUsage > 95) ? 'critical' : 'warning',
          message: `Container ${containerId.substring(0, 12)} using high bandwidth: ` +
                   `Ingress ${ingressUsage.toFixed(1)}%, Egress ${egressUsage.toFixed(1)}%`,
          usage: {
            ingress: { rate: stats.rates.rx, percentage: ingressUsage },
            egress: { rate: stats.rates.tx, percentage: egressUsage }
          }
        });
      }
      
      // Check for packet loss
      if (stats.rx.errors > 0 || stats.tx.errors > 0 ||
          stats.rx.dropped > 0 || stats.tx.dropped > 0) {
        alerts.push({
          type: 'packet_loss',
          containerId,
          severity: 'warning',
          message: `Container ${containerId.substring(0, 12)} experiencing packet loss`,
          errors: {
            rx: { errors: stats.rx.errors, dropped: stats.rx.dropped },
            tx: { errors: stats.tx.errors, dropped: stats.tx.dropped }
          }
        });
      }
    }
    
    // Check total bandwidth allocation
    const totalAllocated = this.stats.totalBandwidthAllocated.ingress + 
                          this.stats.totalBandwidthAllocated.egress;
    const maxTotal = this.parseBandwidth(this.config.bandwidth.maxBandwidth) * 2;
    
    if (totalAllocated > maxTotal * 0.9) {
      alerts.push({
        type: 'overallocation',
        severity: 'critical',
        message: 'Total bandwidth allocation exceeding capacity',
        allocated: totalAllocated,
        capacity: maxTotal
      });
    }
    
    if (alerts.length > 0) {
      this.stats.alerts.total += alerts.length;
      
      this.emit('networkAlerts', {
        alerts,
        timestamp: new Date()
      });
    }
  }

  /**
   * Cleanup traffic control
   */
  async cleanupTrafficControl() {
    try {
      const iface = this.config.trafficControl.interface;
      
      // Remove all TC rules
      await execAsync(`tc qdisc del dev ${iface} root 2>/dev/null || true`);
      
      // Clean up iptables rules
      for (const [containerId, info] of this.networkInterfaces) {
        await this.removeRateLimiting(containerId);
      }
      
      this.tcInitialized = false;
      
      logger.info('Traffic control cleaned up');
      
    } catch (error) {
      logger.error('Failed to cleanup traffic control:', error);
    }
  }

  /**
   * Get or create TC class
   */
  getOrCreateTcClass(containerId) {
    let classId = this.tcClasses.get(containerId);
    
    if (!classId) {
      classId = this.nextClassId++;
      if (this.nextClassId > this.config.trafficControl.maxClasses) {
        this.nextClassId = 10; // Reset
      }
      this.tcClasses.set(containerId, classId);
    }
    
    return classId;
  }

  /**
   * Update profile usage
   */
  updateProfileUsage(profileName) {
    const current = this.stats.profileUsage.get(profileName) || 0;
    this.stats.profileUsage.set(profileName, current + 1);
  }

  /**
   * Parse bandwidth value to bits per second
   */
  parseBandwidth(value) {
    if (typeof value === 'number') return value;
    
    const match = String(value).match(/^(\d+(?:\.\d+)?)\s*([kmgt]?)bit$/i);
    if (!match) {
      throw new Error(`Invalid bandwidth value: ${value}`);
    }
    
    const num = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    
    const multipliers = {
      '': 1,
      'k': 1000,
      'm': 1000000,
      'g': 1000000000,
      't': 1000000000000
    };
    
    return Math.floor(num * (multipliers[unit] || 1));
  }

  /**
   * Format bandwidth for display
   */
  formatBandwidth(bitsPerSecond) {
    const units = ['bit', 'kbit', 'mbit', 'gbit', 'tbit'];
    let value = bitsPerSecond;
    let unitIndex = 0;
    
    while (value >= 1000 && unitIndex < units.length - 1) {
      value /= 1000;
      unitIndex++;
    }
    
    return `${value.toFixed(0)}${units[unitIndex]}`;
  }

  /**
   * Get bandwidth status for container
   */
  getBandwidthStatus(containerId) {
    const bandwidthInfo = this.containerBandwidth.get(containerId);
    const stats = this.trafficStats.get(containerId);
    const networkInfo = this.networkInterfaces.get(containerId);
    
    if (!bandwidthInfo || !stats) {
      return null;
    }
    
    return {
      containerId,
      profile: bandwidthInfo.profile,
      limits: bandwidthInfo.limits,
      interface: networkInfo,
      traffic: {
        rx: {
          total: stats.rx.bytes,
          rate: stats.rates?.rx || 0,
          packets: stats.rx.packets,
          errors: stats.rx.errors,
          dropped: stats.rx.dropped
        },
        tx: {
          total: stats.tx.bytes,
          rate: stats.rates?.tx || 0,
          packets: stats.tx.packets,
          errors: stats.tx.errors,
          dropped: stats.tx.dropped
        }
      },
      usage: {
        ingress: {
          rate: stats.rates?.rx || 0,
          limit: this.parseBandwidth(bandwidthInfo.limits.ingress),
          percentage: ((stats.rates?.rx || 0) / this.parseBandwidth(bandwidthInfo.limits.ingress)) * 100
        },
        egress: {
          rate: stats.rates?.tx || 0,
          limit: this.parseBandwidth(bandwidthInfo.limits.egress),
          percentage: ((stats.rates?.tx || 0) / this.parseBandwidth(bandwidthInfo.limits.egress)) * 100
        }
      },
      history: stats.history || [],
      appliedAt: bandwidthInfo.appliedAt,
      lastUpdate: stats.lastUpdate
    };
  }

  /**
   * Get bandwidth controller statistics
   */
  getStatistics() {
    return {
      isStarted: this.isStarted,
      tcInitialized: this.tcInitialized,
      stats: {
        ...this.stats,
        profileUsage: Object.fromEntries(this.stats.profileUsage),
        totalBandwidthAllocatedFormatted: {
          ingress: this.formatBandwidth(this.stats.totalBandwidthAllocated.ingress),
          egress: this.formatBandwidth(this.stats.totalBandwidthAllocated.egress)
        },
        totalTrafficProcessedFormatted: {
          rx: this.formatStorage(this.stats.totalTrafficProcessed.rx),
          tx: this.formatStorage(this.stats.totalTrafficProcessed.tx)
        },
        currentRatesFormatted: this.stats.currentRates ? {
          rx: this.formatBandwidth(this.stats.currentRates.rx),
          tx: this.formatBandwidth(this.stats.currentRates.tx),
          total: this.formatBandwidth(this.stats.currentRates.total)
        } : null
      },
      activeContainers: this.containerBandwidth.size,
      tcClasses: this.tcClasses.size,
      config: {
        bandwidth: this.config.bandwidth,
        profiles: Object.keys(this.config.profiles),
        trafficControlEnabled: this.config.trafficControl.enabled,
        rateLimitingEnabled: this.config.rateLimiting.enabled,
        monitoringEnabled: this.config.monitoring.enabled
      }
    };
  }

  /**
   * Format storage value
   */
  formatStorage(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    
    return `${value.toFixed(2)} ${units[unitIndex]}`;
  }
}

module.exports = NetworkBandwidthController;