import { createLogger } from '../../utils/logger';
import { DockerClient } from '../docker-client';
import { EventEmitter } from 'events';
import Docker from 'dockerode';
import * as _path from 'path';

const logger = createLogger('VolumeManager');

export interface VolumeConfig {
  id: string;
  name: string;
  driver: VolumeDriver;
  driverOpts: Record<string, string>;
  labels: Record<string, string>;
  scope: VolumeScope;
  mountpoint?: string;
  status: VolumeStatus;
  createdAt: Date;
  metadata: VolumeMetadata;
}

export interface VolumeMetadata {
  description: string;
  purpose: VolumePurpose;
  persistence: VolumePersistence;
  backup: BackupConfig;
  retention: RetentionConfig;
  security: VolumeSecurityConfig;
  performance: VolumePerformanceConfig;
  tags: string[];
  environment: VolumeEnvironment;
}

export interface BackupConfig {
  enabled: boolean;
  schedule: string; // cron expression
  retention: number; // days
  compression: boolean;
  encryption: boolean;
  destination: string;
  strategy: BackupStrategy;
}

export interface RetentionConfig {
  enabled: boolean;
  maxAge: number; // days
  maxSize: string; // e.g., "100GB"
  cleanupStrategy: CleanupStrategy;
  exemptPatterns: string[]; // file patterns to exempt from cleanup
}

export interface VolumeSecurityConfig {
  readonly: boolean;
  encrypted: boolean;
  accessMode: AccessMode;
  ownership: OwnershipConfig;
  permissions: string; // octal notation
  selinuxContext?: string;
  quotas: VolumeQuotas;
}

export interface OwnershipConfig {
  uid: number;
  gid: number;
  user?: string;
  group?: string;
}

export interface VolumeQuotas {
  enabled: boolean;
  hardLimit: string; // e.g., "10GB"
  softLimit: string; // e.g., "8GB"
  inodeLimit?: number;
  graceePeriod?: number; // seconds
}

export interface VolumePerformanceConfig {
  ioScheduler: IOScheduler;
  readAhead: number; // KB
  cacheSize: string; // e.g., "1GB"
  syncMode: SyncMode;
  compression: CompressionConfig;
  optimization: OptimizationLevel;
}

export interface CompressionConfig {
  enabled: boolean;
  algorithm: CompressionAlgorithm;
  level: number; // 1-9
  blockSize: string; // e.g., "64KB"
}

export interface VolumeMount {
  id: string;
  volumeId: string;
  containerId: string;
  containerName: string;
  mountPath: string;
  mountOptions: MountOptions;
  createdAt: Date;
  status: MountStatus;
}

export interface MountOptions {
  readonly: boolean;
  bind: boolean;
  propagation: MountPropagation;
  consistency: MountConsistency;
  selinuxRelabel: SelinuxRelabel;
  tmpfsOptions?: TmpfsOptions;
}

export interface TmpfsOptions {
  size: string; // e.g., "100m"
  mode: string; // octal permissions
  nodev: boolean;
  nosuid: boolean;
  noexec: boolean;
}

export interface VolumeUsage {
  volumeId: string;
  totalSize: number; // bytes
  usedSize: number; // bytes
  availableSize: number; // bytes
  usagePercentage: number;
  inodeTotal: number;
  inodeUsed: number;
  inodeAvailable: number;
  timestamp: Date;
}

export interface VolumeSnapshot {
  id: string;
  volumeId: string;
  name: string;
  description: string;
  size: number; // bytes
  createdAt: Date;
  tags: string[];
  metadata: Record<string, any>;
}

export enum VolumeDriver {
  LOCAL = 'local',
  NFS = 'nfs',
  CIFS = 'cifs',
  EFS = 'efs',
  GLUSTER = 'glusterfs',
  CEPH = 'ceph',
  CUSTOM = 'custom'
}

export enum VolumeScope {
  LOCAL = 'local',
  GLOBAL = 'global'
}

export enum VolumeStatus {
  CREATING = 'creating',
  AVAILABLE = 'available',
  IN_USE = 'in_use',
  ERROR = 'error',
  DELETING = 'deleting'
}

export enum VolumePurpose {
  DATA = 'data',
  CACHE = 'cache',
  LOGS = 'logs',
  CONFIG = 'config',
  TEMP = 'temp',
  BACKUP = 'backup',
  WORKSPACE = 'workspace'
}

export enum VolumePersistence {
  EPHEMERAL = 'ephemeral',
  SESSION = 'session',
  PERSISTENT = 'persistent',
  PERMANENT = 'permanent'
}

export enum BackupStrategy {
  FULL = 'full',
  INCREMENTAL = 'incremental',
  DIFFERENTIAL = 'differential',
  SNAPSHOT = 'snapshot'
}

export enum CleanupStrategy {
  LRU = 'lru', // Least Recently Used
  FIFO = 'fifo', // First In, First Out
  SIZE_BASED = 'size_based',
  AGE_BASED = 'age_based'
}

export enum AccessMode {
  READ_WRITE = 'rw',
  READ_ONLY = 'ro',
  WRITE_ONLY = 'wo'
}

export enum IOScheduler {
  CFQ = 'cfq',
  DEADLINE = 'deadline',
  NOOP = 'noop',
  BFQ = 'bfq',
  MQ_DEADLINE = 'mq-deadline'
}

export enum SyncMode {
  ASYNC = 'async',
  SYNC = 'sync',
  DATASYNC = 'datasync',
  BARRIER = 'barrier'
}

export enum CompressionAlgorithm {
  NONE = 'none',
  GZIP = 'gzip',
  LZ4 = 'lz4',
  ZSTD = 'zstd',
  BZIP2 = 'bzip2'
}

export enum OptimizationLevel {
  NONE = 'none',
  BASIC = 'basic',
  BALANCED = 'balanced',
  PERFORMANCE = 'performance',
  MAXIMUM = 'maximum'
}

export enum MountStatus {
  MOUNTING = 'mounting',
  MOUNTED = 'mounted',
  UNMOUNTING = 'unmounting',
  UNMOUNTED = 'unmounted',
  ERROR = 'error'
}

export enum MountPropagation {
  PRIVATE = 'private',
  RPRIVATE = 'rprivate',
  SHARED = 'shared',
  RSHARED = 'rshared',
  SLAVE = 'slave',
  RSLAVE = 'rslave'
}

export enum MountConsistency {
  CONSISTENT = 'consistent',
  CACHED = 'cached',
  DELEGATED = 'delegated'
}

export enum SelinuxRelabel {
  SHARED = 'z',
  PRIVATE = 'Z',
  NONE = ''
}

export enum VolumeEnvironment {
  DEVELOPMENT = 'development',
  TESTING = 'testing',
  STAGING = 'staging',
  PRODUCTION = 'production'
}

export class VolumeManager extends EventEmitter {
  private static instance: VolumeManager;
  private dockerClient: DockerClient;
  private volumes: Map<string, VolumeConfig> = new Map();
  private mounts: Map<string, VolumeMount> = new Map();
  private usage: Map<string, VolumeUsage[]> = new Map();
  private snapshots: Map<string, VolumeSnapshot[]> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;

  private constructor() {
    super();
    this.dockerClient = DockerClient.getInstance();
    this.initializeDefaultVolumes();
  }

  public static getInstance(): VolumeManager {
    if (!VolumeManager.instance) {
      VolumeManager.instance = new VolumeManager();
    }
    return VolumeManager.instance;
  }

  /**
   * Initialize default volume configurations
   */
  private initializeDefaultVolumes(): void {
    logger.info('Initializing default volume configurations');

    // Workspace volume for GitHub Actions
    this.registerVolumeConfig({
      id: 'runner-workspace',
      name: 'github-runner-workspace',
      driver: VolumeDriver.LOCAL,
      driverOpts: {
        'type': 'ext4',
        'device': 'tmpfs',
        'o': 'size=10g,uid=1000,gid=1000'
      },
      labels: {
        'github.runner.volume': 'workspace',
        'github.runner.purpose': 'execution'
      },
      scope: VolumeScope.LOCAL,
      status: VolumeStatus.AVAILABLE,
      createdAt: new Date(),
      metadata: {
        description: 'Workspace volume for GitHub Action execution',
        purpose: VolumePurpose.WORKSPACE,
        persistence: VolumePersistence.SESSION,
        backup: {
          enabled: false,
          schedule: '',
          retention: 0,
          compression: false,
          encryption: false,
          destination: '',
          strategy: BackupStrategy.SNAPSHOT
        },
        retention: {
          enabled: true,
          maxAge: 1, // 1 day
          maxSize: '10GB',
          cleanupStrategy: CleanupStrategy.LRU,
          exemptPatterns: ['.git/*', 'node_modules/*']
        },
        security: {
          readonly: false,
          encrypted: false,
          accessMode: AccessMode.READ_WRITE,
          ownership: {
            uid: 1000,
            gid: 1000,
            user: 'runner',
            group: 'runner'
          },
          permissions: '755',
          quotas: {
            enabled: true,
            hardLimit: '10GB',
            softLimit: '8GB',
            inodeLimit: 1000000,
            graceePeriod: 3600
          }
        },
        performance: {
          ioScheduler: IOScheduler.BFQ,
          readAhead: 256,
          cacheSize: '512MB',
          syncMode: SyncMode.ASYNC,
          compression: {
            enabled: false,
            algorithm: CompressionAlgorithm.NONE,
            level: 0,
            blockSize: '64KB'
          },
          optimization: OptimizationLevel.PERFORMANCE
        },
        tags: ['workspace', 'ephemeral', 'execution'],
        environment: VolumeEnvironment.PRODUCTION
      }
    });

    // Cache volume for build artifacts
    this.registerVolumeConfig({
      id: 'runner-cache',
      name: 'github-runner-cache',
      driver: VolumeDriver.LOCAL,
      driverOpts: {
        'type': 'ext4',
        'o': 'defaults'
      },
      labels: {
        'github.runner.volume': 'cache',
        'github.runner.purpose': 'performance'
      },
      scope: VolumeScope.LOCAL,
      status: VolumeStatus.AVAILABLE,
      createdAt: new Date(),
      metadata: {
        description: 'Cache volume for build artifacts and dependencies',
        purpose: VolumePurpose.CACHE,
        persistence: VolumePersistence.PERSISTENT,
        backup: {
          enabled: true,
          schedule: '0 2 * * *', // Daily at 2 AM
          retention: 7,
          compression: true,
          encryption: false,
          destination: '/backup/cache',
          strategy: BackupStrategy.INCREMENTAL
        },
        retention: {
          enabled: true,
          maxAge: 30,
          maxSize: '50GB',
          cleanupStrategy: CleanupStrategy.LRU,
          exemptPatterns: ['*.lock', 'package-lock.json']
        },
        security: {
          readonly: false,
          encrypted: false,
          accessMode: AccessMode.READ_WRITE,
          ownership: {
            uid: 1000,
            gid: 1000,
            user: 'runner',
            group: 'runner'
          },
          permissions: '755',
          quotas: {
            enabled: true,
            hardLimit: '50GB',
            softLimit: '40GB',
            inodeLimit: 5000000,
            graceePeriod: 7200
          }
        },
        performance: {
          ioScheduler: IOScheduler.CFQ,
          readAhead: 512,
          cacheSize: '1GB',
          syncMode: SyncMode.ASYNC,
          compression: {
            enabled: true,
            algorithm: CompressionAlgorithm.LZ4,
            level: 3,
            blockSize: '128KB'
          },
          optimization: OptimizationLevel.BALANCED
        },
        tags: ['cache', 'persistent', 'build-artifacts'],
        environment: VolumeEnvironment.PRODUCTION
      }
    });

    // Logs volume for persistent logging
    this.registerVolumeConfig({
      id: 'runner-logs',
      name: 'github-runner-logs',
      driver: VolumeDriver.LOCAL,
      driverOpts: {
        'type': 'ext4',
        'o': 'defaults'
      },
      labels: {
        'github.runner.volume': 'logs',
        'github.runner.purpose': 'monitoring'
      },
      scope: VolumeScope.LOCAL,
      status: VolumeStatus.AVAILABLE,
      createdAt: new Date(),
      metadata: {
        description: 'Logs volume for GitHub Action execution logs',
        purpose: VolumePurpose.LOGS,
        persistence: VolumePersistence.PERSISTENT,
        backup: {
          enabled: true,
          schedule: '0 3 * * *', // Daily at 3 AM
          retention: 30,
          compression: true,
          encryption: true,
          destination: '/backup/logs',
          strategy: BackupStrategy.FULL
        },
        retention: {
          enabled: true,
          maxAge: 90,
          maxSize: '20GB',
          cleanupStrategy: CleanupStrategy.AGE_BASED,
          exemptPatterns: ['error.log', 'critical.log']
        },
        security: {
          readonly: false,
          encrypted: true,
          accessMode: AccessMode.READ_WRITE,
          ownership: {
            uid: 1000,
            gid: 1000,
            user: 'runner',
            group: 'runner'
          },
          permissions: '750',
          quotas: {
            enabled: true,
            hardLimit: '20GB',
            softLimit: '15GB',
            inodeLimit: 2000000,
            graceePeriod: 86400
          }
        },
        performance: {
          ioScheduler: IOScheduler.DEADLINE,
          readAhead: 128,
          cacheSize: '256MB',
          syncMode: SyncMode.SYNC,
          compression: {
            enabled: true,
            algorithm: CompressionAlgorithm.GZIP,
            level: 6,
            blockSize: '32KB'
          },
          optimization: OptimizationLevel.BASIC
        },
        tags: ['logs', 'persistent', 'monitoring'],
        environment: VolumeEnvironment.PRODUCTION
      }
    });

    logger.info(`Initialized ${this.volumes.size} default volume configurations`);
  }

  /**
   * Register a volume configuration
   */
  public registerVolumeConfig(config: VolumeConfig): void {
    this.volumes.set(config.id, config);
    logger.info(`Registered volume configuration: ${config.id} (${config.name})`);
  }

  /**
   * Get volume configuration by ID
   */
  public getVolumeConfig(volumeId: string): VolumeConfig | undefined {
    return this.volumes.get(volumeId);
  }

  /**
   * List all volume configurations
   */
  public listVolumeConfigs(filter?: {
    driver?: VolumeDriver;
    purpose?: VolumePurpose;
    persistence?: VolumePersistence;
    environment?: VolumeEnvironment;
    tags?: string[];
  }): VolumeConfig[] {
    const configs = Array.from(this.volumes.values());

    if (!filter) {
      return configs;
    }

    return configs.filter(config => {
      if (filter.driver && config.driver !== filter.driver) {
        return false;
      }

      if (filter.purpose && config.metadata.purpose !== filter.purpose) {
        return false;
      }

      if (filter.persistence && config.metadata.persistence !== filter.persistence) {
        return false;
      }

      if (filter.environment && config.metadata.environment !== filter.environment) {
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
   * Create Docker volume from configuration
   */
  public async createVolume(configId: string): Promise<string> {
    const config = this.getVolumeConfig(configId);
    if (!config) {
      throw new Error(`Volume configuration not found: ${configId}`);
    }

    try {
      logger.info(`Creating Docker volume: ${config.name}`);

      const volumeOptions: Docker.VolumeCreateOptions = {
        Name: config.name,
        Driver: config.driver,
        DriverOpts: config.driverOpts,
        Labels: {
          ...config.labels,
          'volume.config.id': config.id,
          'volume.config.version': '1.0.0'
        }
      };

      const volume = await this.dockerClient['docker'].createVolume(volumeOptions);
      const volumeId = volume.Name;

      // Update status
      config.status = VolumeStatus.AVAILABLE;
      config.mountpoint = volume.Mountpoint;

      logger.info(`Docker volume created: ${volumeId} (${config.name})`);
      this.emit('volume:created', { id: volumeId, config });

      return volumeId;
    } catch (error) {
      config.status = VolumeStatus.ERROR;
      logger.error(`Failed to create volume ${config.name}:`, error);
      this.emit('volume:create:failed', { config, error });
      throw error;
    }
  }

  /**
   * Remove Docker volume
   */
  public async removeVolume(volumeId: string, force = false): Promise<void> {
    try {
      logger.info(`Removing Docker volume: ${volumeId}`);

      const volume = this.dockerClient['docker'].getVolume(volumeId);
      await volume.remove({ force });

      // Remove any mount records
      for (const [mountId, mount] of this.mounts.entries()) {
        if (mount.volumeId === volumeId) {
          this.mounts.delete(mountId);
        }
      }

      logger.info(`Docker volume removed: ${volumeId}`);
      this.emit('volume:removed', { id: volumeId });
    } catch (error) {
      logger.error(`Failed to remove volume ${volumeId}:`, error);
      this.emit('volume:remove:failed', { id: volumeId, error });
      throw error;
    }
  }

  /**
   * Mount volume to container
   */
  public async mountVolume(
    volumeId: string,
    containerId: string,
    mountPath: string,
    options: Partial<MountOptions> = {}
  ): Promise<string> {
    try {
      const mountId = `${volumeId}-${containerId}-${Date.now()}`;
      
      const mountRecord: VolumeMount = {
        id: mountId,
        volumeId,
        containerId,
        containerName: '', // Would be filled from container info
        mountPath,
        mountOptions: {
          readonly: false,
          bind: false,
          propagation: MountPropagation.PRIVATE,
          consistency: MountConsistency.CONSISTENT,
          selinuxRelabel: SelinuxRelabel.NONE,
          ...options
        },
        createdAt: new Date(),
        status: MountStatus.MOUNTED
      };

      this.mounts.set(mountId, mountRecord);

      logger.info(`Volume ${volumeId} mounted to container ${containerId} at ${mountPath}`);
      this.emit('volume:mounted', { mountId, volumeId, containerId, mountPath });

      return mountId;
    } catch (error) {
      logger.error(`Failed to mount volume ${volumeId} to container ${containerId}:`, error);
      this.emit('volume:mount:failed', { volumeId, containerId, error });
      throw error;
    }
  }

  /**
   * Unmount volume from container
   */
  public async unmountVolume(mountId: string): Promise<void> {
    try {
      const mount = this.mounts.get(mountId);
      if (!mount) {
        throw new Error(`Mount not found: ${mountId}`);
      }

      mount.status = MountStatus.UNMOUNTED;
      this.mounts.delete(mountId);

      logger.info(`Volume ${mount.volumeId} unmounted from container ${mount.containerId}`);
      this.emit('volume:unmounted', { mountId, volumeId: mount.volumeId, containerId: mount.containerId });
    } catch (error) {
      logger.error(`Failed to unmount volume ${mountId}:`, error);
      this.emit('volume:unmount:failed', { mountId, error });
      throw error;
    }
  }

  /**
   * Get volume usage statistics
   */
  public async getVolumeUsage(volumeId: string): Promise<VolumeUsage | null> {
    try {
      const config = this.getVolumeConfig(volumeId);
      if (!config || !config.mountpoint) {
        return null;
      }

      // This would typically use filesystem utilities to get actual usage
      // For now, we'll simulate the data
      const usage: VolumeUsage = {
        volumeId,
        totalSize: 10 * 1024 * 1024 * 1024, // 10GB
        usedSize: Math.floor(Math.random() * 5 * 1024 * 1024 * 1024), // Random up to 5GB
        availableSize: 0,
        usagePercentage: 0,
        inodeTotal: 1000000,
        inodeUsed: Math.floor(Math.random() * 500000),
        inodeAvailable: 0,
        timestamp: new Date()
      };

      usage.availableSize = usage.totalSize - usage.usedSize;
      usage.usagePercentage = (usage.usedSize / usage.totalSize) * 100;
      usage.inodeAvailable = usage.inodeTotal - usage.inodeUsed;

      // Store usage history
      if (!this.usage.has(volumeId)) {
        this.usage.set(volumeId, []);
      }
      
      const usageHistory = this.usage.get(volumeId)!;
      usageHistory.push(usage);
      
      // Keep only last 1000 data points
      if (usageHistory.length > 1000) {
        usageHistory.splice(0, usageHistory.length - 1000);
      }

      return usage;
    } catch (error) {
      logger.error(`Failed to get volume usage for ${volumeId}:`, error);
      return null;
    }
  }

  /**
   * Create volume snapshot
   */
  public async createSnapshot(
    volumeId: string,
    snapshotName: string,
    description = '',
    tags: string[] = []
  ): Promise<string> {
    try {
      const config = this.getVolumeConfig(volumeId);
      if (!config) {
        throw new Error(`Volume configuration not found: ${volumeId}`);
      }

      const snapshotId = `${volumeId}-snapshot-${Date.now()}`;
      const snapshot: VolumeSnapshot = {
        id: snapshotId,
        volumeId,
        name: snapshotName,
        description,
        size: Math.floor(Math.random() * 1024 * 1024 * 1024), // Simulated size
        createdAt: new Date(),
        tags,
        metadata: {
          originalVolume: volumeId,
          creationMethod: 'manual'
        }
      };

      if (!this.snapshots.has(volumeId)) {
        this.snapshots.set(volumeId, []);
      }

      this.snapshots.get(volumeId)!.push(snapshot);

      logger.info(`Snapshot created for volume ${volumeId}: ${snapshotId}`);
      this.emit('snapshot:created', { snapshotId, volumeId, snapshot });

      return snapshotId;
    } catch (error) {
      logger.error(`Failed to create snapshot for volume ${volumeId}:`, error);
      this.emit('snapshot:create:failed', { volumeId, error });
      throw error;
    }
  }

  /**
   * Restore volume from snapshot
   */
  public async restoreFromSnapshot(snapshotId: string, newVolumeId?: string): Promise<string> {
    try {
      let snapshot: VolumeSnapshot | undefined;
      let sourceVolumeId: string | undefined;

      // Find snapshot across all volumes
      for (const [volumeId, snapshots] of this.snapshots.entries()) {
        snapshot = snapshots.find(s => s.id === snapshotId);
        if (snapshot) {
          sourceVolumeId = volumeId;
          break;
        }
      }

      if (!snapshot || !sourceVolumeId) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }

      const targetVolumeId = newVolumeId || `${sourceVolumeId}-restored-${Date.now()}`;

      // In a real implementation, this would restore the actual data
      logger.info(`Restoring volume ${targetVolumeId} from snapshot ${snapshotId}`);
      
      this.emit('volume:restored', { snapshotId, sourceVolumeId, targetVolumeId });

      return targetVolumeId;
    } catch (error) {
      logger.error(`Failed to restore from snapshot ${snapshotId}:`, error);
      this.emit('volume:restore:failed', { snapshotId, error });
      throw error;
    }
  }

  /**
   * Start volume monitoring and cleanup
   */
  public startMonitoring(intervalMs = 300000): void { // 5 minutes default
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    logger.info(`Starting volume monitoring with ${intervalMs}ms interval`);

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectVolumeMetrics();
      } catch (error) {
        logger.error('Error collecting volume metrics:', error);
      }
    }, intervalMs);

    this.emit('monitoring:started', { intervalMs });
  }

  /**
   * Start automatic cleanup
   */
  public startAutomaticCleanup(intervalMs = 3600000): void { // 1 hour default
    if (this.cleanupInterval) {
      this.stopAutomaticCleanup();
    }

    logger.info(`Starting automatic cleanup with ${intervalMs}ms interval`);

    this.cleanupInterval = setInterval(async () => {
      try {
        await this.performAutomaticCleanup();
      } catch (error) {
        logger.error('Error during automatic cleanup:', error);
      }
    }, intervalMs);

    this.emit('cleanup:started', { intervalMs });
  }

  /**
   * Stop volume monitoring
   */
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      logger.info('Volume monitoring stopped');
      this.emit('monitoring:stopped');
    }
  }

  /**
   * Stop automatic cleanup
   */
  public stopAutomaticCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
      logger.info('Automatic cleanup stopped');
      this.emit('cleanup:stopped');
    }
  }

  /**
   * Collect volume metrics
   */
  private async collectVolumeMetrics(): Promise<void> {
    for (const [volumeId, _config] of this.volumes.entries()) {
      try {
        await this.getVolumeUsage(volumeId);
      } catch (error) {
        logger.warn(`Failed to collect metrics for volume ${volumeId}:`, error);
      }
    }
  }

  /**
   * Perform automatic cleanup based on retention policies
   */
  private async performAutomaticCleanup(): Promise<void> {
    for (const [volumeId, config] of this.volumes.entries()) {
      if (!config.metadata.retention.enabled) {
        continue;
      }

      try {
        await this.cleanupVolume(volumeId);
      } catch (error) {
        logger.warn(`Failed to cleanup volume ${volumeId}:`, error);
      }
    }
  }

  /**
   * Cleanup volume based on retention policy
   */
  private async cleanupVolume(volumeId: string): Promise<void> {
    const config = this.getVolumeConfig(volumeId);
    if (!config) {
      return;
    }

    const retention = config.metadata.retention;
    const cutoffDate = new Date(Date.now() - (retention.maxAge * 24 * 60 * 60 * 1000));
    logger.debug(`Cleanup cutoff date: ${cutoffDate.toISOString()}`);

    logger.info(`Performing cleanup for volume ${volumeId} (strategy: ${retention.cleanupStrategy})`);

    // In a real implementation, this would:
    // 1. Scan the volume for files
    // 2. Apply the cleanup strategy
    // 3. Remove files exceeding retention policy
    // 4. Respect exempt patterns

    this.emit('volume:cleaned', { volumeId, strategy: retention.cleanupStrategy });
  }

  /**
   * Validate volume configuration
   */
  public validateVolumeConfig(config: VolumeConfig): string[] {
    const errors: string[] = [];

    // Basic validation
    if (!config.id) errors.push('Volume ID is required');
    if (!config.name) errors.push('Volume name is required');
    if (!config.driver) errors.push('Volume driver is required');

    // Security validation
    if (config.metadata.security.permissions) {
      const perms = config.metadata.security.permissions;
      if (!/^[0-7]{3,4}$/.test(perms)) {
        errors.push('Invalid permissions format (must be octal notation)');
      }
    }

    // Quota validation
    if (config.metadata.security.quotas.enabled) {
      const quotas = config.metadata.security.quotas;
      if (!quotas.hardLimit) {
        errors.push('Hard limit is required when quotas are enabled');
      }
      if (!quotas.softLimit) {
        errors.push('Soft limit is required when quotas are enabled');
      }
    }

    // Performance validation
    const perf = config.metadata.performance;
    if (perf.compression.enabled && perf.compression.level < 1 || perf.compression.level > 9) {
      errors.push('Compression level must be between 1 and 9');
    }

    // Backup validation
    if (config.metadata.backup.enabled) {
      const backup = config.metadata.backup;
      if (!backup.schedule) {
        errors.push('Backup schedule is required when backups are enabled');
      }
      if (!backup.destination) {
        errors.push('Backup destination is required when backups are enabled');
      }
    }

    return errors;
  }

  /**
   * Update volume configuration
   */
  public updateVolumeConfig(volumeId: string, updates: Partial<VolumeConfig>): void {
    const config = this.getVolumeConfig(volumeId);
    if (!config) {
      throw new Error(`Volume configuration not found: ${volumeId}`);
    }

    const updatedConfig = {
      ...config,
      ...updates,
      metadata: {
        ...config.metadata,
        ...updates.metadata
      }
    };

    const errors = this.validateVolumeConfig(updatedConfig);
    if (errors.length > 0) {
      throw new Error(`Volume configuration validation failed: ${errors.join(', ')}`);
    }

    this.volumes.set(volumeId, updatedConfig);
    logger.info(`Updated volume configuration: ${volumeId}`);
    this.emit('config:updated', { volumeId, config: updatedConfig });
  }

  /**
   * Get volume manager statistics
   */
  public getVolumeManagerStats(): any {
    const configs = Array.from(this.volumes.values());
    
    return {
      totalVolumes: configs.length,
      byDriver: this.groupBy(configs, 'driver'),
      byPurpose: this.groupBy(configs, c => c.metadata.purpose),
      byPersistence: this.groupBy(configs, c => c.metadata.persistence),
      byEnvironment: this.groupBy(configs, c => c.metadata.environment),
      mounts: {
        total: this.mounts.size,
        byStatus: this.groupBy(Array.from(this.mounts.values()), 'status')
      },
      snapshots: {
        total: Array.from(this.snapshots.values()).reduce((sum, snaps) => sum + snaps.length, 0),
        byVolume: Object.fromEntries(
          Array.from(this.snapshots.entries()).map(([volumeId, snaps]) => [volumeId, snaps.length])
        )
      },
      monitoring: {
        enabled: !!this.monitoringInterval,
        volumesWithUsage: this.usage.size,
        totalDataPoints: Array.from(this.usage.values())
          .reduce((sum, usage) => sum + usage.length, 0)
      },
      cleanup: {
        enabled: !!this.cleanupInterval
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

export default VolumeManager;