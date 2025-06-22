import { createLogger } from '../../utils/logger';
import { DockerClient } from '../docker-client';
import { EventEmitter } from 'events';
import Docker from 'dockerode';

const logger = createLogger('NetworkManager');

export interface NetworkConfig {
  id: string;
  name: string;
  driver: NetworkDriver;
  scope: NetworkScope;
  internal: boolean;
  attachable: boolean;
  ingress: boolean;
  enableIPv6: boolean;
  options: Record<string, string>;
  labels: Record<string, string>;
  ipamConfig: IPAMConfig;
  metadata: NetworkMetadata;
}

export interface IPAMConfig {
  driver: string;
  config: IPAMPoolConfig[];
  options: Record<string, string>;
}

export interface IPAMPoolConfig {
  subnet: string;
  ipRange?: string;
  gateway?: string;
  auxAddresses?: Record<string, string>;
}

export interface NetworkMetadata {
  created: Date;
  updated: Date;
  description: string;
  environment: NetworkEnvironment;
  isolation: NetworkIsolation;
  performance: NetworkPerformance;
  security: NetworkSecurity;
  tags: string[];
}

export interface NetworkPerformance {
  bandwidth: string; // e.g., "1Gbps", "100Mbps"
  latency: number; // milliseconds
  mtu: number; // Maximum Transmission Unit
  priority: number; // 1-10, 10 being highest
}

export interface NetworkSecurity {
  encrypted: boolean;
  firewallRules: FirewallRule[];
  accessControl: AccessControlPolicy;
  monitoring: NetworkMonitoring;
}

export interface FirewallRule {
  id: string;
  action: 'allow' | 'deny';
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  sourceIP?: string;
  sourcePort?: string;
  destinationIP?: string;
  destinationPort?: string;
  priority: number;
}

export interface AccessControlPolicy {
  defaultAction: 'allow' | 'deny';
  allowedNetworks: string[];
  blockedNetworks: string[];
  serviceAccounts: string[];
}

export interface NetworkMonitoring {
  enabled: boolean;
  logTraffic: boolean;
  alertOnAnomalies: boolean;
  metricsCollection: boolean;
}

export interface ContainerNetworkInfo {
  containerId: string;
  containerName: string;
  networkId: string;
  networkName: string;
  ipAddress: string;
  macAddress: string;
  aliases: string[];
  endpoints: NetworkEndpoint[];
}

export interface NetworkEndpoint {
  id: string;
  name: string;
  ipAddress: string;
  macAddress: string;
  gateway: string;
  subnet: string;
}

export interface NetworkStats {
  networkId: string;
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
  errorsReceived: number;
  errorsSent: number;
  droppedReceived: number;
  droppedSent: number;
  timestamp: Date;
}

export enum NetworkDriver {
  BRIDGE = 'bridge',
  HOST = 'host',
  OVERLAY = 'overlay',
  MACVLAN = 'macvlan',
  NONE = 'none',
  CUSTOM = 'custom'
}

export enum NetworkScope {
  LOCAL = 'local',
  GLOBAL = 'global',
  SWARM = 'swarm'
}

export enum NetworkEnvironment {
  DEVELOPMENT = 'development',
  TESTING = 'testing',
  STAGING = 'staging',
  PRODUCTION = 'production'
}

export enum NetworkIsolation {
  NONE = 'none',
  BASIC = 'basic',
  STRICT = 'strict',
  COMPLETE = 'complete'
}

export class NetworkManager extends EventEmitter {
  private static instance: NetworkManager;
  private dockerClient: DockerClient;
  private networks: Map<string, NetworkConfig> = new Map();
  private networkStats: Map<string, NetworkStats[]> = new Map();
  private monitoringInterval?: NodeJS.Timeout;

  private constructor() {
    super();
    this.dockerClient = DockerClient.getInstance();
    this.initializeDefaultNetworks();
  }

  public static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }

  /**
   * Initialize default network configurations
   */
  private initializeDefaultNetworks(): void {
    logger.info('Initializing default network configurations');

    // Default bridge network for general containers
    this.registerNetworkConfig({
      id: 'runner-bridge',
      name: 'github-runner-bridge',
      driver: NetworkDriver.BRIDGE,
      scope: NetworkScope.LOCAL,
      internal: false,
      attachable: true,
      ingress: false,
      enableIPv6: false,
      options: {
        'com.docker.network.bridge.enable_icc': 'true',
        'com.docker.network.bridge.enable_ip_masquerade': 'true',
        'com.docker.network.driver.mtu': '1500'
      },
      labels: {
        'github.runner.network': 'bridge',
        'github.runner.purpose': 'general'
      },
      ipamConfig: {
        driver: 'default',
        config: [{
          subnet: '172.20.0.0/16',
          gateway: '172.20.0.1'
        }],
        options: {}
      },
      metadata: {
        created: new Date(),
        updated: new Date(),
        description: 'Default bridge network for GitHub Action runners',
        environment: NetworkEnvironment.PRODUCTION,
        isolation: NetworkIsolation.BASIC,
        performance: {
          bandwidth: '1Gbps',
          latency: 1,
          mtu: 1500,
          priority: 5
        },
        security: {
          encrypted: false,
          firewallRules: [],
          accessControl: {
            defaultAction: 'allow',
            allowedNetworks: ['172.20.0.0/16'],
            blockedNetworks: [],
            serviceAccounts: []
          },
          monitoring: {
            enabled: true,
            logTraffic: false,
            alertOnAnomalies: true,
            metricsCollection: true
          }
        },
        tags: ['bridge', 'general', 'runners']
      }
    });

    // Isolated network for security-sensitive workloads
    this.registerNetworkConfig({
      id: 'runner-isolated',
      name: 'github-runner-isolated',
      driver: NetworkDriver.BRIDGE,
      scope: NetworkScope.LOCAL,
      internal: true,
      attachable: false,
      ingress: false,
      enableIPv6: false,
      options: {
        'com.docker.network.bridge.enable_icc': 'false',
        'com.docker.network.bridge.enable_ip_masquerade': 'false',
        'com.docker.network.driver.mtu': '1500'
      },
      labels: {
        'github.runner.network': 'isolated',
        'github.runner.purpose': 'security'
      },
      ipamConfig: {
        driver: 'default',
        config: [{
          subnet: '172.21.0.0/16',
          gateway: '172.21.0.1'
        }],
        options: {}
      },
      metadata: {
        created: new Date(),
        updated: new Date(),
        description: 'Isolated network for security-sensitive GitHub Action runners',
        environment: NetworkEnvironment.PRODUCTION,
        isolation: NetworkIsolation.STRICT,
        performance: {
          bandwidth: '1Gbps',
          latency: 1,
          mtu: 1500,
          priority: 8
        },
        security: {
          encrypted: false,
          firewallRules: [
            {
              id: 'deny-all-external',
              action: 'deny',
              protocol: 'all',
              destinationIP: '0.0.0.0/0',
              priority: 100
            }
          ],
          accessControl: {
            defaultAction: 'deny',
            allowedNetworks: ['172.21.0.0/16'],
            blockedNetworks: ['0.0.0.0/0'],
            serviceAccounts: ['security-scanner', 'compliance-checker']
          },
          monitoring: {
            enabled: true,
            logTraffic: true,
            alertOnAnomalies: true,
            metricsCollection: true
          }
        },
        tags: ['isolated', 'security', 'compliance']
      }
    });

    // High-performance network for CI/CD workloads
    this.registerNetworkConfig({
      id: 'runner-performance',
      name: 'github-runner-performance',
      driver: NetworkDriver.BRIDGE,
      scope: NetworkScope.LOCAL,
      internal: false,
      attachable: true,
      ingress: false,
      enableIPv6: false,
      options: {
        'com.docker.network.bridge.enable_icc': 'true',
        'com.docker.network.bridge.enable_ip_masquerade': 'true',
        'com.docker.network.driver.mtu': '9000' // Jumbo frames for performance
      },
      labels: {
        'github.runner.network': 'performance',
        'github.runner.purpose': 'ci-cd'
      },
      ipamConfig: {
        driver: 'default',
        config: [{
          subnet: '172.22.0.0/16',
          gateway: '172.22.0.1'
        }],
        options: {}
      },
      metadata: {
        created: new Date(),
        updated: new Date(),
        description: 'High-performance network for CI/CD intensive GitHub Action runners',
        environment: NetworkEnvironment.PRODUCTION,
        isolation: NetworkIsolation.BASIC,
        performance: {
          bandwidth: '10Gbps',
          latency: 0.5,
          mtu: 9000,
          priority: 9
        },
        security: {
          encrypted: false,
          firewallRules: [],
          accessControl: {
            defaultAction: 'allow',
            allowedNetworks: ['172.22.0.0/16'],
            blockedNetworks: [],
            serviceAccounts: []
          },
          monitoring: {
            enabled: true,
            logTraffic: false,
            alertOnAnomalies: true,
            metricsCollection: true
          }
        },
        tags: ['performance', 'ci-cd', 'high-bandwidth']
      }
    });

    logger.info(`Initialized ${this.networks.size} default network configurations`);
  }

  /**
   * Register a network configuration
   */
  public registerNetworkConfig(config: NetworkConfig): void {
    this.networks.set(config.id, config);
    logger.info(`Registered network configuration: ${config.id} (${config.name})`);
  }

  /**
   * Get network configuration by ID
   */
  public getNetworkConfig(networkId: string): NetworkConfig | undefined {
    return this.networks.get(networkId);
  }

  /**
   * List all network configurations
   */
  public listNetworkConfigs(filter?: {
    driver?: NetworkDriver;
    environment?: NetworkEnvironment;
    isolation?: NetworkIsolation;
    tags?: string[];
  }): NetworkConfig[] {
    const configs = Array.from(this.networks.values());
    
    if (!filter) {
      return configs;
    }

    return configs.filter(config => {
      if (filter.driver && config.driver !== filter.driver) {
        return false;
      }

      if (filter.environment && config.metadata.environment !== filter.environment) {
        return false;
      }

      if (filter.isolation && config.metadata.isolation !== filter.isolation) {
        return false;
      }

      if (filter.tags) {
        const hasAllTags = filter.tags.every(tag => config.metadata.tags.includes(tag));
        if (!hasAllTags) return false;
      }

      return true;
    });
  }

  /**
   * Create Docker network from configuration
   */
  public async createNetwork(configId: string): Promise<string> {
    const config = this.getNetworkConfig(configId);
    if (!config) {
      throw new Error(`Network configuration not found: ${configId}`);
    }

    try {
      logger.info(`Creating Docker network: ${config.name}`);

      const networkOptions: Docker.NetworkCreateOptions = {
        Name: config.name,
        Driver: config.driver,
        Scope: config.scope,
        Internal: config.internal,
        Attachable: config.attachable,
        Ingress: config.ingress,
        EnableIPv6: config.enableIPv6,
        Options: config.options,
        Labels: {
          ...config.labels,
          'network.config.id': config.id,
          'network.config.version': '1.0.0'
        },
        IPAM: {
          Driver: config.ipamConfig.driver,
          Config: config.ipamConfig.config.map(poolConfig => ({
            Subnet: poolConfig.subnet,
            IPRange: poolConfig.ipRange,
            Gateway: poolConfig.gateway,
            AuxiliaryAddresses: poolConfig.auxAddresses
          })),
          Options: config.ipamConfig.options
        }
      };

      const networkId = await this.dockerClient.createNetwork(networkOptions);
      
      logger.info(`Docker network created: ${networkId} (${config.name})`);
      this.emit('network:created', { id: networkId, config });

      return networkId;
    } catch (error) {
      logger.error(`Failed to create network ${config.name}:`, error);
      this.emit('network:create:failed', { config, error });
      throw error;
    }
  }

  /**
   * Remove Docker network
   */
  public async removeNetwork(networkId: string): Promise<void> {
    try {
      logger.info(`Removing Docker network: ${networkId}`);

      await this.dockerClient.removeNetwork(networkId);
      
      logger.info(`Docker network removed: ${networkId}`);
      this.emit('network:removed', { id: networkId });
    } catch (error) {
      logger.error(`Failed to remove network ${networkId}:`, error);
      this.emit('network:remove:failed', { id: networkId, error });
      throw error;
    }
  }

  /**
   * Connect container to network
   */
  public async connectContainer(
    containerId: string,
    networkId: string,
    options?: {
      aliases?: string[];
      ipv4Address?: string;
      ipv6Address?: string;
      links?: string[];
      endpointConfig?: any;
    }
  ): Promise<void> {
    try {
      logger.info(`Connecting container ${containerId} to network ${networkId}`);

      const network = this.dockerClient['docker'].getNetwork(networkId);
      await network.connect({
        Container: containerId,
        EndpointConfig: {
          Aliases: options?.aliases,
          IPAMConfig: {
            IPv4Address: options?.ipv4Address,
            IPv6Address: options?.ipv6Address
          },
          Links: options?.links,
          ...options?.endpointConfig
        }
      });

      logger.info(`Container ${containerId} connected to network ${networkId}`);
      this.emit('container:connected', { containerId, networkId, options });
    } catch (error) {
      logger.error(`Failed to connect container ${containerId} to network ${networkId}:`, error);
      this.emit('container:connect:failed', { containerId, networkId, error });
      throw error;
    }
  }

  /**
   * Disconnect container from network
   */
  public async disconnectContainer(
    containerId: string,
    networkId: string,
    force = false
  ): Promise<void> {
    try {
      logger.info(`Disconnecting container ${containerId} from network ${networkId}`);

      const network = this.dockerClient['docker'].getNetwork(networkId);
      await network.disconnect({
        Container: containerId,
        Force: force
      });

      logger.info(`Container ${containerId} disconnected from network ${networkId}`);
      this.emit('container:disconnected', { containerId, networkId });
    } catch (error) {
      logger.error(`Failed to disconnect container ${containerId} from network ${networkId}:`, error);
      this.emit('container:disconnect:failed', { containerId, networkId, error });
      throw error;
    }
  }

  /**
   * Get container network information
   */
  public async getContainerNetworkInfo(containerId: string): Promise<ContainerNetworkInfo[]> {
    try {
      const containerInfo = await this.dockerClient.getContainerInfo(containerId);
      const networkInfos: ContainerNetworkInfo[] = [];

      containerInfo.networks.forEach(network => {
        networkInfos.push({
          containerId,
          containerName: containerInfo.name,
          networkId: network.id,
          networkName: network.name,
          ipAddress: network.ipAddress || '',
          macAddress: network.macAddress || '',
          aliases: [], // Would need to get from Docker API
          endpoints: [{
            id: network.id,
            name: network.name,
            ipAddress: network.ipAddress || '',
            macAddress: network.macAddress || '',
            gateway: network.gateway || '',
            subnet: '' // Would need to get from network details
          }]
        });
      });

      return networkInfos;
    } catch (error) {
      logger.error(`Failed to get container network info for ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Get network statistics
   */
  public async getNetworkStats(networkId: string): Promise<NetworkStats | null> {
    try {
      // Note: Docker doesn't provide direct network statistics
      // This would typically require additional monitoring tools
      const existingStats = this.networkStats.get(networkId);
      
      if (!existingStats || existingStats.length === 0) {
        return null;
      }

      return existingStats[existingStats.length - 1];
    } catch (error) {
      logger.error(`Failed to get network stats for ${networkId}:`, error);
      return null;
    }
  }

  /**
   * Start network monitoring
   */
  public startMonitoring(intervalMs = 60000): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    logger.info(`Starting network monitoring with ${intervalMs}ms interval`);

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectNetworkMetrics();
      } catch (error) {
        logger.error('Error collecting network metrics:', error);
      }
    }, intervalMs);

    this.emit('monitoring:started', { intervalMs });
  }

  /**
   * Stop network monitoring
   */
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      logger.info('Network monitoring stopped');
      this.emit('monitoring:stopped');
    }
  }

  /**
   * Collect network metrics
   */
  private async collectNetworkMetrics(): Promise<void> {
    // This is a simplified implementation
    // In a real scenario, you'd integrate with network monitoring tools
    
    for (const [networkId, config] of this.networks.entries()) {
      try {
        // Simulate network metrics collection
        const stats: NetworkStats = {
          networkId,
          bytesReceived: Math.floor(Math.random() * 1000000),
          bytesSent: Math.floor(Math.random() * 1000000),
          packetsReceived: Math.floor(Math.random() * 10000),
          packetsSent: Math.floor(Math.random() * 10000),
          errorsReceived: Math.floor(Math.random() * 10),
          errorsSent: Math.floor(Math.random() * 10),
          droppedReceived: Math.floor(Math.random() * 5),
          droppedSent: Math.floor(Math.random() * 5),
          timestamp: new Date()
        };

        if (!this.networkStats.has(networkId)) {
          this.networkStats.set(networkId, []);
        }

        const networkStats = this.networkStats.get(networkId)!;
        networkStats.push(stats);

        // Keep only last 1000 data points
        if (networkStats.length > 1000) {
          networkStats.splice(0, networkStats.length - 1000);
        }

        this.emit('metrics:collected', { networkId, stats });
      } catch (error) {
        logger.warn(`Failed to collect metrics for network ${networkId}:`, error);
      }
    }
  }

  /**
   * Validate network configuration
   */
  public validateNetworkConfig(config: NetworkConfig): string[] {
    const errors: string[] = [];

    // Basic validation
    if (!config.id) errors.push('Network ID is required');
    if (!config.name) errors.push('Network name is required');
    if (!config.driver) errors.push('Network driver is required');

    // IPAM validation
    if (config.ipamConfig.config.length === 0) {
      errors.push('At least one IPAM config is required');
    }

    config.ipamConfig.config.forEach((ipamConfig, index) => {
      if (!ipamConfig.subnet) {
        errors.push(`IPAM config ${index}: subnet is required`);
      } else {
        // Basic subnet validation
        if (!ipamConfig.subnet.includes('/')) {
          errors.push(`IPAM config ${index}: subnet must include CIDR notation`);
        }
      }
    });

    // Security validation
    if (config.metadata.isolation === NetworkIsolation.STRICT && !config.internal) {
      errors.push('Strict isolation requires internal network');
    }

    // Performance validation
    if (config.metadata.performance.mtu < 68 || config.metadata.performance.mtu > 9000) {
      errors.push('MTU must be between 68 and 9000');
    }

    return errors;
  }

  /**
   * Update network configuration
   */
  public updateNetworkConfig(networkId: string, updates: Partial<NetworkConfig>): void {
    const config = this.getNetworkConfig(networkId);
    if (!config) {
      throw new Error(`Network configuration not found: ${networkId}`);
    }

    const updatedConfig = {
      ...config,
      ...updates,
      metadata: {
        ...config.metadata,
        ...updates.metadata,
        updated: new Date()
      }
    };

    const errors = this.validateNetworkConfig(updatedConfig);
    if (errors.length > 0) {
      throw new Error(`Network configuration validation failed: ${errors.join(', ')}`);
    }

    this.networks.set(networkId, updatedConfig);
    logger.info(`Updated network configuration: ${networkId}`);
    this.emit('config:updated', { networkId, config: updatedConfig });
  }

  /**
   * Remove network configuration
   */
  public removeNetworkConfig(networkId: string): boolean {
    const result = this.networks.delete(networkId);
    if (result) {
      logger.info(`Removed network configuration: ${networkId}`);
      this.emit('config:removed', { networkId });
    }
    return result;
  }

  /**
   * Get network recommendations for container
   */
  public getNetworkRecommendations(requirements: {
    isolation?: NetworkIsolation;
    performance?: {
      bandwidth?: string;
      latency?: number;
    };
    security?: {
      encrypted?: boolean;
      monitoring?: boolean;
    };
    environment?: NetworkEnvironment;
  }): NetworkConfig[] {
    const configs = Array.from(this.networks.values());
    const recommendations: Array<{ config: NetworkConfig; score: number }> = [];

    configs.forEach(config => {
      let score = 0;

      // Isolation matching
      if (requirements.isolation) {
        if (config.metadata.isolation === requirements.isolation) {
          score += 40;
        } else if (config.metadata.isolation > requirements.isolation) {
          score += 20; // Higher isolation is acceptable
        }
      }

      // Performance matching
      if (requirements.performance) {
        if (requirements.performance.bandwidth) {
          // Simplified bandwidth comparison
          if (config.metadata.performance.bandwidth.includes('10G')) score += 20;
          else if (config.metadata.performance.bandwidth.includes('1G')) score += 15;
        }

        if (requirements.performance.latency) {
          if (config.metadata.performance.latency <= requirements.performance.latency) {
            score += 15;
          }
        }
      }

      // Security matching
      if (requirements.security) {
        if (requirements.security.encrypted && config.metadata.security.encrypted) {
          score += 15;
        }

        if (requirements.security.monitoring && config.metadata.security.monitoring.enabled) {
          score += 10;
        }
      }

      // Environment matching
      if (requirements.environment) {
        if (config.metadata.environment === requirements.environment) {
          score += 10;
        }
      }

      recommendations.push({ config, score });
    });

    return recommendations
      .sort((a, b) => b.score - a.score)
      .map(r => r.config)
      .slice(0, 3); // Top 3 recommendations
  }

  /**
   * Get network manager statistics
   */
  public getNetworkManagerStats(): any {
    const configs = Array.from(this.networks.values());
    
    return {
      totalNetworks: configs.length,
      byDriver: this.groupBy(configs, 'driver'),
      byIsolation: this.groupBy(configs, c => c.metadata.isolation),
      byEnvironment: this.groupBy(configs, c => c.metadata.environment),
      monitoring: {
        enabled: !!this.monitoringInterval,
        networksWithStats: this.networkStats.size,
        totalDataPoints: Array.from(this.networkStats.values())
          .reduce((sum, stats) => sum + stats.length, 0)
      }
    };
  }

  /**
   * Helper method to group arrays by property
   */
  private groupBy<T>(array: T[], keyFn: string | ((item: T) => any)): Record<string, number> {
    return array.reduce((groups, item) => {
      const key = typeof keyFn === 'string' ? (item as any)[keyFn] : keyFn(item);
      groups[key] = (groups[key] || 0) + 1;
      return groups;
    }, {} as Record<string, number>);
  }
}

export default NetworkManager;