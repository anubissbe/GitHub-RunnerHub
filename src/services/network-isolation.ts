import Docker from 'dockerode';
import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import ServiceManager from './service-manager';

const logger = createLogger('NetworkIsolation');

export interface NetworkConfig {
  name: string;
  repository: string;
  subnet?: string;
  driver: 'bridge' | 'overlay' | 'host' | 'none';
  internal: boolean;
  attachable: boolean;
  labels: Record<string, string>;
  options?: Record<string, string>;
}

export interface NetworkInfo {
  id: string;
  name: string;
  repository: string;
  subnet: string;
  gateway: string;
  driver: string;
  internal: boolean;
  containers: string[];
  created: Date;
  lastUsed: Date;
}

export interface NetworkStats {
  totalNetworks: number;
  activeNetworks: number;
  isolatedContainers: number;
  networksByRepository: Map<string, number>;
}

/**
 * Network Isolation Service for GitHub RunnerHub
 * Provides per-repository network isolation for runner containers
 */
export class NetworkIsolationService extends EventEmitter {
  private static instance: NetworkIsolationService;
  private docker: Docker;
  private networkPrefix = 'runnerhub';
  private subnetCounter = 0;
  private networkCache: Map<string, NetworkInfo> = new Map();
  private repositoryNetworks: Map<string, Set<string>> = new Map();
  private initialized = false;

  private constructor() {
    super();
    this.docker = new Docker();
  }

  public static getInstance(): NetworkIsolationService {
    if (!NetworkIsolationService.instance) {
      NetworkIsolationService.instance = new NetworkIsolationService();
    }
    return NetworkIsolationService.instance;
  }

  /**
   * Initialize the network isolation service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('NetworkIsolationService already initialized');
      return;
    }

    try {
      logger.info('Initializing network isolation service');

      // Verify Docker connectivity
      await this.docker.ping();
      
      // Load existing networks
      await this.loadExistingNetworks();

      // Start network cleanup scheduler
      this.startCleanupScheduler();

      this.initialized = true;
      logger.info('Network isolation service initialized successfully', {
        networksLoaded: this.networkCache.size,
        repositories: this.repositoryNetworks.size
      });

      this.emit('initialized');

    } catch (error) {
      logger.error('Failed to initialize network isolation service', { 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Create an isolated network for a repository
   */
  async createRepositoryNetwork(repository: string): Promise<NetworkInfo> {
    try {
      const normalizedRepo = this.normalizeRepositoryName(repository);
      const networkName = this.generateNetworkName(normalizedRepo);

      // Check if network already exists
      const existingNetwork = await this.findNetworkByName(networkName);
      if (existingNetwork) {
        logger.info('Using existing network for repository', { 
          repository, 
          networkId: existingNetwork.id 
        });
        return existingNetwork;
      }

      // Generate subnet
      const subnet = this.generateSubnet();

      // Create network configuration
      const networkConfig: Docker.NetworkCreateOptions = {
        Name: networkName,
        Driver: 'bridge',
        Internal: true, // No external access
        Attachable: true,
        EnableIPv6: false,
        IPAM: {
          Driver: 'default',
          Config: [{
            Subnet: subnet,
            Gateway: this.getGatewayFromSubnet(subnet)
          }]
        },
        Options: {
          'com.docker.network.bridge.enable_icc': 'true', // Allow inter-container communication within network
          'com.docker.network.bridge.enable_ip_masquerade': 'false' // No NAT
        },
        Labels: {
          'runnerhub.network': 'true',
          'runnerhub.repository': repository,
          'runnerhub.created': new Date().toISOString(),
          'runnerhub.type': 'isolated'
        }
      };

      // Create the network
      const network = await this.docker.createNetwork(networkConfig);
      const networkInfo = await this.inspectNetwork(network.id);

      // Cache network info
      this.cacheNetworkInfo(networkInfo);

      // Track repository networks
      if (!this.repositoryNetworks.has(repository)) {
        this.repositoryNetworks.set(repository, new Set());
      }
      this.repositoryNetworks.get(repository)!.add(network.id);

      logger.info('Created isolated network for repository', {
        repository,
        networkId: network.id,
        networkName,
        subnet
      });

      this.emit('network-created', { repository, networkId: network.id });
      
      // Store in database
      await this.storeNetworkInDatabase(networkInfo);

      return networkInfo;

    } catch (error) {
      logger.error('Failed to create repository network', { 
        repository, 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Attach a container to a repository network
   */
  async attachContainerToNetwork(
    containerId: string, 
    repository: string,
    aliases?: string[]
  ): Promise<void> {
    try {
      const network = await this.getOrCreateRepositoryNetwork(repository);

      // Disconnect from default bridge network first
      try {
        const bridgeNetwork = this.docker.getNetwork('bridge');
        await bridgeNetwork.disconnect({ 
          Container: containerId, 
          Force: true 
        });
      } catch (error) {
        // Ignore if already disconnected
        logger.debug('Container may not be connected to default network', { 
          containerId, 
          error: (error as Error).message 
        });
      }

      // Connect to isolated network
      const dockerNetwork = this.docker.getNetwork(network.id);
      await dockerNetwork.connect({
        Container: containerId,
        EndpointConfig: {
          Aliases: aliases || [`runner-${containerId.substring(0, 12)}`]
        }
      });

      // Update network info
      network.containers.push(containerId);
      network.lastUsed = new Date();
      this.cacheNetworkInfo(network);

      logger.info('Attached container to isolated network', {
        containerId: containerId.substring(0, 12),
        repository,
        networkId: network.id
      });

      this.emit('container-attached', { 
        containerId, 
        repository, 
        networkId: network.id 
      });

    } catch (error) {
      logger.error('Failed to attach container to network', { 
        containerId, 
        repository, 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Detach a container from a repository network
   */
  async detachContainerFromNetwork(
    containerId: string, 
    repository: string
  ): Promise<void> {
    try {
      const networks = this.repositoryNetworks.get(repository);
      if (!networks || networks.size === 0) {
        logger.warn('No networks found for repository', { repository });
        return;
      }

      for (const networkId of networks) {
        try {
          const dockerNetwork = this.docker.getNetwork(networkId);
          await dockerNetwork.disconnect({
            Container: containerId,
            Force: true
          });

          // Update network info
          const networkInfo = this.networkCache.get(networkId);
          if (networkInfo) {
            networkInfo.containers = networkInfo.containers.filter(
              id => id !== containerId
            );
            networkInfo.lastUsed = new Date();
          }

          logger.info('Detached container from network', {
            containerId: containerId.substring(0, 12),
            repository,
            networkId
          });

        } catch (error) {
          logger.error('Failed to detach container from network', { 
            containerId, 
            networkId, 
            error: (error as Error).message 
          });
        }
      }

      this.emit('container-detached', { containerId, repository });

    } catch (error) {
      logger.error('Failed to detach container from networks', { 
        containerId, 
        repository, 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Remove a repository network
   */
  async removeRepositoryNetwork(repository: string, force = false): Promise<void> {
    try {
      const networks = this.repositoryNetworks.get(repository);
      if (!networks || networks.size === 0) {
        logger.warn('No networks to remove for repository', { repository });
        return;
      }

      for (const networkId of networks) {
        try {
          const dockerNetwork = this.docker.getNetwork(networkId);
          
          // Check if network has active containers
          const networkInfo = await this.inspectNetwork(networkId);
          if (networkInfo.containers.length > 0 && !force) {
            logger.warn('Network has active containers, skipping removal', {
              networkId,
              containerCount: networkInfo.containers.length
            });
            continue;
          }

          // Remove network
          await dockerNetwork.remove();

          // Clean up cache
          this.networkCache.delete(networkId);
          networks.delete(networkId);

          logger.info('Removed repository network', {
            repository,
            networkId
          });

          this.emit('network-removed', { repository, networkId });

          // Remove from database
          await this.removeNetworkFromDatabase(networkId);

        } catch (error) {
          logger.error('Failed to remove network', { 
            networkId, 
            error: (error as Error).message 
          });
        }
      }

      if (networks.size === 0) {
        this.repositoryNetworks.delete(repository);
      }

    } catch (error) {
      logger.error('Failed to remove repository networks', { 
        repository, 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Get network statistics
   */
  getNetworkStats(): NetworkStats {
    const stats: NetworkStats = {
      totalNetworks: this.networkCache.size,
      activeNetworks: 0,
      isolatedContainers: 0,
      networksByRepository: new Map()
    };

    for (const [_networkId, networkInfo] of this.networkCache) {
      if (networkInfo.containers.length > 0) {
        stats.activeNetworks++;
        stats.isolatedContainers += networkInfo.containers.length;
      }

      const count = stats.networksByRepository.get(networkInfo.repository) || 0;
      stats.networksByRepository.set(networkInfo.repository, count + 1);
    }

    return stats;
  }

  /**
   * List all isolated networks
   */
  async listIsolatedNetworks(): Promise<NetworkInfo[]> {
    const networks: NetworkInfo[] = [];
    
    for (const networkInfo of this.networkCache.values()) {
      networks.push({
        ...networkInfo,
        containers: [...networkInfo.containers] // Copy array
      });
    }

    return networks.sort((a, b) => b.created.getTime() - a.created.getTime());
  }

  /**
   * Get networks for a specific repository
   */
  async getRepositoryNetworks(repository: string): Promise<NetworkInfo[]> {
    const networkIds = this.repositoryNetworks.get(repository);
    if (!networkIds || networkIds.size === 0) {
      return [];
    }

    const networks: NetworkInfo[] = [];
    for (const networkId of networkIds) {
      const networkInfo = this.networkCache.get(networkId);
      if (networkInfo) {
        networks.push({
          ...networkInfo,
          containers: [...networkInfo.containers]
        });
      }
    }

    return networks;
  }

  /**
   * Clean up unused networks
   */
  async cleanupUnusedNetworks(maxIdleMinutes = 60): Promise<number> {
    let removedCount = 0;
    const now = new Date();

    try {
      for (const [networkId, networkInfo] of this.networkCache) {
        // Skip networks with active containers
        if (networkInfo.containers.length > 0) {
          continue;
        }

        // Check idle time
        const idleMinutes = (now.getTime() - networkInfo.lastUsed.getTime()) / 60000;
        if (idleMinutes > maxIdleMinutes) {
          try {
            const dockerNetwork = this.docker.getNetwork(networkId);
            await dockerNetwork.remove();

            // Clean up cache
            this.networkCache.delete(networkId);
            const networks = this.repositoryNetworks.get(networkInfo.repository);
            if (networks) {
              networks.delete(networkId);
              if (networks.size === 0) {
                this.repositoryNetworks.delete(networkInfo.repository);
              }
            }

            removedCount++;
            logger.info('Cleaned up idle network', {
              networkId,
              repository: networkInfo.repository,
              idleMinutes: Math.round(idleMinutes)
            });

            this.emit('network-cleaned', { networkId, repository: networkInfo.repository });

          } catch (error) {
            logger.error('Failed to clean up network', { 
              networkId, 
              error: (error as Error).message 
            });
          }
        }
      }

      logger.info('Network cleanup completed', { 
        removedCount, 
        remainingNetworks: this.networkCache.size 
      });

    } catch (error) {
      logger.error('Network cleanup failed', { error: (error as Error).message });
    }

    return removedCount;
  }

  /**
   * Verify network isolation
   */
  async verifyNetworkIsolation(
    containerId1: string, 
    containerId2: string
  ): Promise<boolean> {
    try {
      const container1 = await this.docker.getContainer(containerId1).inspect();
      const container2 = await this.docker.getContainer(containerId2).inspect();

      const networks1 = new Set(Object.keys(container1.NetworkSettings.Networks));
      const networks2 = new Set(Object.keys(container2.NetworkSettings.Networks));

      // Find common networks
      const commonNetworks = [...networks1].filter(n => networks2.has(n));

      // Filter out default networks
      const isolatedCommonNetworks = commonNetworks.filter(n => 
        n.startsWith(this.networkPrefix) && n !== 'bridge' && n !== 'host'
      );

      return isolatedCommonNetworks.length === 0;

    } catch (error) {
      logger.error('Failed to verify network isolation', { 
        error: (error as Error).message 
      });
      return false;
    }
  }

  // Private helper methods

  private async getOrCreateRepositoryNetwork(repository: string): Promise<NetworkInfo> {
    const networks = this.repositoryNetworks.get(repository);
    
    if (networks && networks.size > 0) {
      // Return the first available network
      const networkId = networks.values().next().value;
      if (networkId) {
        const networkInfo = this.networkCache.get(networkId);
        if (networkInfo) {
          return networkInfo;
        }
      }
    }

    // Create new network
    return this.createRepositoryNetwork(repository);
  }

  private normalizeRepositoryName(repository: string): string {
    // Replace special characters with hyphens
    return repository
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private generateNetworkName(normalizedRepo: string): string {
    const hash = crypto.createHash('sha256')
      .update(normalizedRepo)
      .digest('hex')
      .substring(0, 8);

    return `${this.networkPrefix}-${normalizedRepo}-${hash}`;
  }

  private generateSubnet(): string {
    // Generate subnet in 172.20.x.0/24 range
    const octet = 20 + (this.subnetCounter % 236); // 172.20.0.0 to 172.255.0.0
    this.subnetCounter++;
    return `172.${octet}.0.0/24`;
  }

  private getGatewayFromSubnet(subnet: string): string {
    const parts = subnet.split('/')[0].split('.');
    parts[3] = '1';
    return parts.join('.');
  }

  private async findNetworkByName(name: string): Promise<NetworkInfo | null> {
    for (const networkInfo of this.networkCache.values()) {
      if (networkInfo.name === name) {
        return networkInfo;
      }
    }

    // Check Docker for network
    try {
      const networks = await this.docker.listNetworks({
        filters: { name: [name] }
      });

      if (networks.length > 0) {
        return this.inspectNetwork(networks[0].Id);
      }
    } catch (error) {
      logger.debug('Network not found', { name, error: (error as Error).message });
    }

    return null;
  }

  private async inspectNetwork(networkId: string): Promise<NetworkInfo> {
    const network = this.docker.getNetwork(networkId);
    const info = await network.inspect();

    const networkInfo: NetworkInfo = {
      id: info.Id,
      name: info.Name,
      repository: info.Labels?.['runnerhub.repository'] || 'unknown',
      subnet: info.IPAM?.Config?.[0]?.Subnet || '',
      gateway: info.IPAM?.Config?.[0]?.Gateway || '',
      driver: info.Driver,
      internal: info.Internal,
      containers: Object.keys(info.Containers || {}),
      created: new Date(info.Created),
      lastUsed: new Date()
    };

    return networkInfo;
  }

  private cacheNetworkInfo(networkInfo: NetworkInfo): void {
    this.networkCache.set(networkInfo.id, networkInfo);
  }

  private async loadExistingNetworks(): Promise<void> {
    try {
      const networks = await this.docker.listNetworks({
        filters: {
          label: ['runnerhub.network=true']
        }
      });

      for (const network of networks) {
        try {
          const networkInfo = await this.inspectNetwork(network.Id);
          this.cacheNetworkInfo(networkInfo);

          // Rebuild repository mapping
          const repository = networkInfo.repository;
          if (!this.repositoryNetworks.has(repository)) {
            this.repositoryNetworks.set(repository, new Set());
          }
          this.repositoryNetworks.get(repository)!.add(network.Id);

        } catch (error) {
          logger.error('Failed to load network', { 
            networkId: network.Id, 
            error: (error as Error).message 
          });
        }
      }

      logger.info('Loaded existing isolated networks', { count: this.networkCache.size });

    } catch (error) {
      logger.error('Failed to load existing networks', { 
        error: (error as Error).message 
      });
    }
  }

  private startCleanupScheduler(): void {
    // Run cleanup every 30 minutes
    setInterval(async () => {
      try {
        await this.cleanupUnusedNetworks();
      } catch (error) {
        logger.error('Scheduled cleanup failed', { error: (error as Error).message });
      }
    }, 30 * 60 * 1000);

    logger.info('Network cleanup scheduler started');
  }

  private async storeNetworkInDatabase(networkInfo: NetworkInfo): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      const database = serviceManager.getService<any>('database');

      await database.query(
        `INSERT INTO network_isolation (
          network_id, name, repository, subnet, gateway, 
          driver, internal, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (network_id) DO UPDATE SET
          last_used = NOW()`,
        [
          networkInfo.id,
          networkInfo.name,
          networkInfo.repository,
          networkInfo.subnet,
          networkInfo.gateway,
          networkInfo.driver,
          networkInfo.internal,
          networkInfo.created
        ]
      );

    } catch (error) {
      logger.error('Failed to store network in database', { 
        error: (error as Error).message 
      });
    }
  }

  private async removeNetworkFromDatabase(networkId: string): Promise<void> {
    try {
      const serviceManager = ServiceManager.getInstance();
      const database = serviceManager.getService<any>('database');

      await database.query(
        'DELETE FROM network_isolation WHERE network_id = $1',
        [networkId]
      );

    } catch (error) {
      logger.error('Failed to remove network from database', { 
        error: (error as Error).message 
      });
    }
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down network isolation service');

    // Clear caches
    this.networkCache.clear();
    this.repositoryNetworks.clear();

    this.removeAllListeners();
    this.initialized = false;

    logger.info('Network isolation service shutdown complete');
  }
}

export default NetworkIsolationService.getInstance();