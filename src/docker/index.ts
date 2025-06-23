/**
 * GitHub RunnerHub Docker Integration Layer
 * 
 * Comprehensive Docker integration providing container lifecycle management,
 * template-based container creation, advanced networking, and intelligent
 * volume management with performance optimization and security enforcement.
 */

// Import core modules
import { DockerClient, DockerClientConfig } from './docker-client';
import { ContainerTemplateManager } from './templates/container-templates';
import { NetworkManager } from './networking/network-manager';
import { VolumeManager } from './volumes/volume-manager';
import { ImageOptimizer } from './image-optimization/image-optimizer';
import { DockerSecurityManager } from './security/docker-security-manager';

// Core Docker Client
export { DockerClient, DockerClientConfig };
export type {
  ContainerInfo,
  PortMapping,
  VolumeMount as DockerVolumeMount,
  NetworkInfo,
  ImageInfo,
  ContainerStats,
  ContainerLogs
} from './docker-client';

// Container Templates System
export { 
  ContainerTemplateManager,
  ContainerCategory,
  TemplateConfig,
  PortConfig,
  VolumeConfig as TemplateVolumeConfig,
  ResourceConfig,
  SecurityConfig,
  RestartPolicy,
  HealthCheckConfig,
  TemplateMetadata
} from './templates/container-templates';

// Network Management System
export {
  NetworkManager,
  NetworkDriver,
  NetworkScope,
  NetworkEnvironment,
  NetworkIsolation,
  NetworkConfig,
  IPAMConfig,
  IPAMPoolConfig,
  NetworkMetadata,
  NetworkPerformance,
  NetworkSecurity,
  FirewallRule,
  AccessControlPolicy,
  NetworkMonitoring,
  ContainerNetworkInfo,
  NetworkEndpoint,
  NetworkStats
} from './networking/network-manager';

// Volume Management System
export {
  VolumeManager,
  VolumeDriver,
  VolumeScope,
  VolumeStatus,
  VolumePurpose,
  VolumePersistence,
  VolumeEnvironment,
  VolumeConfig,
  VolumeMetadata,
  BackupConfig,
  RetentionConfig,
  VolumeSecurityConfig,
  VolumePerformanceConfig,
  VolumeMount,
  MountOptions,
  VolumeUsage,
  VolumeSnapshot,
  BackupStrategy,
  CleanupStrategy,
  AccessMode,
  IOScheduler,
  SyncMode,
  CompressionAlgorithm,
  OptimizationLevel,
  MountStatus,
  MountPropagation,
  MountConsistency,
  SelinuxRelabel
} from './volumes/volume-manager';

// Image Optimization System
export {
  ImageOptimizer,
  ImageOptimizationConfig,
  BaseImageConfig,
  OptimizationRule,
  OptimizationCondition,
  OptimizationAction,
  LayerCachingConfig,
  CompressionConfig as ImageCompressionConfig,
  SecurityConfig as ImageSecurityConfig,
  PerformanceConfig as ImagePerformanceConfig,
  CleanupConfig as ImageCleanupConfig,
  OptimizedImage,
  AppliedOptimization,
  OptimizationImpact,
  BuildContext,
  ImageCategory,
  OptimizationType,
  OptimizationTarget,
  OptimizationActionType,
  CachingStrategy,
  CompressionAlgorithm as ImageCompressionAlgorithm,
  VulnerabilityLevel,
  PruneStrategy,
  createImageOptimizer,
  optimizeImage,
  getOptimizationStats
} from './image-optimization';

// Security Management System
export {
  DockerSecurityManager,
  SecurityPolicyConfig,
  SecurityRule,
  SecurityCondition,
  SecurityAction,
  SecurityException,
  PolicyMetadata,
  SecurityScanResult,
  SecurityFinding,
  FindingLocation,
  RemediationAdvice,
  ComplianceViolation,
  ScanSummary,
  ScanMetadata,
  ContainerSecurityProfile,
  ActiveEnforcement,
  SecurityViolation,
  ContainerSecurityConfig,
  SecurityContext,
  CapabilityConfig,
  SELinuxOptions,
  SeccompProfile,
  NetworkSecurityPolicy,
  PortRange,
  SecurityResourceLimits,
  ResourceLimit,
  NetworkLimit,
  AccessControl,
  AccessCondition,
  SecurityMonitoring,
  AlertingConfig,
  AlertChannel,
  AlertThreshold,
  EscalationPolicy,
  EscalationLevel,
  SecurityLevel,
  EnforcementMode,
  SecurityRuleType,
  SecurityCategory,
  SecuritySeverity,
  SecurityTarget,
  ConditionType,
  ConditionOperator,
  ActionType,
  ScanType,
  ScanStatus,
  FindingType,
  ComplianceFramework,
  ComplianceImpact,
  RemediationPriority,
  RemediationEffort,
  SecurityGrade,
  SecurityStatus,
  EnforcementStatus,
  ViolationType,
  Protocol,
  DNSPolicy,
  AccessControlType,
  Permission,
  createDockerSecurityManager,
  applySecurityPolicies,
  getSecurityStats,
  DEFAULT_SECURITY_POLICIES,
  createSecurityRule,
  createSecurityPolicy
} from './security';

// Utility Functions and Factory Methods
export function createDockerClient(config?: any): DockerClient {
  return DockerClient.getInstance(config);
}

export function getContainerTemplateManager(): ContainerTemplateManager {
  return ContainerTemplateManager.getInstance();
}

export function getNetworkManager(): NetworkManager {
  return NetworkManager.getInstance();
}

export function getVolumeManager(): VolumeManager {
  return VolumeManager.getInstance();
}

export function getImageOptimizer(): ImageOptimizer {
  return ImageOptimizer.getInstance();
}

export function getDockerSecurityManager(): DockerSecurityManager {
  return DockerSecurityManager.getInstance();
}

// Docker Integration Service Factory
export interface DockerIntegrationConfig {
  docker?: {
    socketPath?: string;
    host?: string;
    port?: number;
    protocol?: 'http' | 'https';
    timeout?: number;
  };
  templates?: {
    registryUrl?: string;
    defaultCategory?: string;
    autoLoad?: boolean;
  };
  networking?: {
    defaultDriver?: string;
    enableMonitoring?: boolean;
    monitoringInterval?: number;
  };
  volumes?: {
    defaultDriver?: string;
    enableCleanup?: boolean;
    cleanupInterval?: number;
    enableMonitoring?: boolean;
    monitoringInterval?: number;
  };
  imageOptimization?: {
    enabled?: boolean;
    autoOptimize?: boolean;
    scanImages?: boolean;
    enforceSignatures?: boolean;
    cleanupOldOptimizations?: boolean;
  };
  security?: {
    enabled?: boolean;
    defaultPolicy?: string;
    enforcementMode?: 'permissive' | 'detection' | 'enforcement' | 'blocking';
    scanOnCreate?: boolean;
    monitoring?: boolean;
    alerting?: boolean;
  };
}

export class DockerIntegrationService {
  private static instance: DockerIntegrationService;
  private dockerClient: DockerClient;
  private templateManager: ContainerTemplateManager;
  private networkManager: NetworkManager;
  private volumeManager: VolumeManager;
  private imageOptimizer: ImageOptimizer;
  private securityManager: DockerSecurityManager;
  private config: DockerIntegrationConfig;

  private constructor(config: DockerIntegrationConfig = {}) {
    this.config = config;
    
    // Initialize core components
    this.dockerClient = DockerClient.getInstance(config.docker);
    this.templateManager = ContainerTemplateManager.getInstance();
    this.networkManager = NetworkManager.getInstance();
    this.volumeManager = VolumeManager.getInstance();
    this.imageOptimizer = ImageOptimizer.getInstance();
    this.securityManager = DockerSecurityManager.getInstance();
  }

  public static getInstance(config?: DockerIntegrationConfig): DockerIntegrationService {
    if (!DockerIntegrationService.instance) {
      DockerIntegrationService.instance = new DockerIntegrationService(config);
    }
    return DockerIntegrationService.instance;
  }

  /**
   * Initialize all Docker integration components
   */
  public async initialize(): Promise<void> {
    // Initialize Docker client
    await this.dockerClient.initialize();

    // Start network monitoring if enabled
    if (this.config.networking?.enableMonitoring) {
      this.networkManager.startMonitoring(
        this.config.networking.monitoringInterval || 60000
      );
    }

    // Start volume monitoring and cleanup if enabled
    if (this.config.volumes?.enableMonitoring) {
      this.volumeManager.startMonitoring(
        this.config.volumes.monitoringInterval || 300000
      );
    }

    if (this.config.volumes?.enableCleanup) {
      this.volumeManager.startAutomaticCleanup(
        this.config.volumes.cleanupInterval || 3600000
      );
    }

    // Configure image optimization if enabled
    if (this.config.imageOptimization?.enabled) {
      this.imageOptimizer.updateConfig({
        enabled: true,
        security: {
          scanImages: this.config.imageOptimization.scanImages ?? true,
          enforceSignatures: this.config.imageOptimization.enforceSignatures ?? false,
          scannerConfig: {
            scanner: 'trivy',
            database: {
              url: 'ghcr.io/aquasecurity/trivy-db',
              updateInterval: 24
            },
            ignoreUnfixed: false,
            skipFiles: [],
            skipDirs: []
          },
          allowedRegistries: ['docker.io', 'ghcr.io', 'gcr.io'],
          blockedImages: [],
          vulnerabilityThreshold: 'high' as any
        },
        cleanup: {
          enabled: this.config.imageOptimization.cleanupOldOptimizations ?? true,
          schedule: '0 2 * * *',
          removeUnused: true,
          removeDangling: true,
          pruneStrategy: 'balanced' as any,
          retentionPeriod: 168,
          excludeImages: ['ubuntu:latest', 'node:18-alpine', 'python:3.11-slim']
        }
      });
    }

    // Configure security if enabled
    if (this.config.security?.enabled) {
      // Start security monitoring if enabled
      if (this.config.security.monitoring) {
        this.securityManager.startMonitoring(300000); // 5 minutes
      }
    }
  }

  /**
   * Shutdown all Docker integration components
   */
  public async shutdown(): Promise<void> {
    // Stop monitoring services
    this.networkManager.stopMonitoring();
    this.volumeManager.stopMonitoring();
    this.volumeManager.stopAutomaticCleanup();
    this.securityManager.stopMonitoring();

    // Close Docker client
    await this.dockerClient.close();
  }

  /**
   * Get system health status
   */
  public getHealthStatus(): {
    docker: boolean;
    templates: { available: number; categories: number };
    networks: { configured: number; monitoring: boolean };
    volumes: { configured: number; monitoring: boolean; cleanup: boolean };
    imageOptimization: { enabled: boolean; optimizedImages: number };
    security: { enabled: boolean; monitoring: boolean; policies: number; containers: number };
  } {
    const templateStats = this.templateManager.getTemplateStatistics();
    const networkStats = this.networkManager.getNetworkManagerStats();
    const volumeStats = this.volumeManager.getVolumeManagerStats();
    const imageOptimizationStats = this.imageOptimizer.getOptimizationStats();
    const securityStats = this.securityManager.getSecurityStats();

    return {
      docker: this.dockerClient.isDockerConnected(),
      templates: {
        available: templateStats.total,
        categories: Object.keys(templateStats.byCategory).length
      },
      networks: {
        configured: networkStats.totalNetworks,
        monitoring: networkStats.monitoring.enabled
      },
      volumes: {
        configured: volumeStats.totalVolumes,
        monitoring: volumeStats.monitoring.enabled,
        cleanup: volumeStats.cleanup.enabled
      },
      imageOptimization: {
        enabled: this.config.imageOptimization?.enabled ?? false,
        optimizedImages: imageOptimizationStats.totalOptimizations
      },
      security: {
        enabled: this.config.security?.enabled ?? false,
        monitoring: securityStats.monitoring.enabled,
        policies: securityStats.policies.total,
        containers: securityStats.containers.total
      }
    };
  }

  /**
   * Get comprehensive system metrics
   */
  public getSystemMetrics(): {
    docker: any;
    templates: any;
    networks: any;
    volumes: any;
    imageOptimization: any;
    security: any;
  } {
    return {
      docker: {
        connected: this.dockerClient.isDockerConnected(),
        config: this.dockerClient.getConfig()
      },
      templates: this.templateManager.getTemplateStatistics(),
      networks: this.networkManager.getNetworkManagerStats(),
      volumes: this.volumeManager.getVolumeManagerStats(),
      imageOptimization: this.imageOptimizer.getOptimizationStats(),
      security: this.securityManager.getSecurityStats()
    };
  }

  /**
   * Create a complete container environment
   */
  public async createContainerEnvironment(options: {
    templateId: string;
    containerName: string;
    networkConfig?: {
      configId: string;
      aliases?: string[];
      ipAddress?: string;
    };
    volumeMounts?: Array<{
      configId: string;
      mountPath: string;
      readonly?: boolean;
    }>;
    environment?: Record<string, string>;
    labels?: Record<string, string>;
  }): Promise<{
    containerId: string;
    networkId?: string;
    volumeMounts: string[];
  }> {
    const result = {
      containerId: '',
      networkId: undefined as string | undefined,
      volumeMounts: [] as string[]
    };

    try {
      // Create volumes first
      if (options.volumeMounts) {
        for (const volumeMount of options.volumeMounts) {
          const volumeId = await this.volumeManager.createVolume(volumeMount.configId);
          const mountId = await this.volumeManager.mountVolume(
            volumeId,
            'placeholder', // Will be updated after container creation
            volumeMount.mountPath,
            { readonly: volumeMount.readonly || false }
          );
          result.volumeMounts.push(mountId);
        }
      }

      // Create network if specified
      if (options.networkConfig) {
        result.networkId = await this.networkManager.createNetwork(options.networkConfig.configId);
      }

      // Create container from template
      result.containerId = await this.templateManager.createContainerFromTemplate(
        options.templateId,
        {
          name: options.containerName,
          environment: options.environment,
          labels: options.labels,
          networkMode: result.networkId
        }
      );

      // Connect to network if created
      if (result.networkId && options.networkConfig) {
        await this.networkManager.connectContainer(
          result.containerId,
          result.networkId,
          {
            aliases: options.networkConfig.aliases,
            ipv4Address: options.networkConfig.ipAddress
          }
        );
      }

      return result;
    } catch (error) {
      // Cleanup on failure
      if (result.containerId) {
        try {
          await this.dockerClient.removeContainer(result.containerId, true);
        } catch (cleanupError) {
          // Log but don't throw
        }
      }

      if (result.networkId) {
        try {
          await this.networkManager.removeNetwork(result.networkId);
        } catch (cleanupError) {
          // Log but don't throw
        }
      }

      for (const mountId of result.volumeMounts) {
        try {
          await this.volumeManager.unmountVolume(mountId);
        } catch (cleanupError) {
          // Log but don't throw
        }
      }

      throw error;
    }
  }

  /**
   * Cleanup container environment
   */
  public async cleanupContainerEnvironment(
    containerId: string,
    options?: {
      removeNetwork?: boolean;
      removeVolumes?: boolean;
      force?: boolean;
    }
  ): Promise<void> {
    const opts = {
      removeNetwork: false,
      removeVolumes: false,
      force: false,
      ...options
    };

    try {
      // Get container network info before removal
      const networkInfo = await this.networkManager.getContainerNetworkInfo(containerId);

      // Stop and remove container
      await this.dockerClient.stopContainer(containerId);
      await this.dockerClient.removeContainer(containerId, opts.force);

      // Remove networks if requested
      if (opts.removeNetwork) {
        for (const network of networkInfo) {
          try {
            await this.networkManager.removeNetwork(network.networkId);
          } catch (error) {
            // Log but continue
          }
        }
      }

      // Remove volumes if requested
      if (opts.removeVolumes) {
        // This would require tracking volume mounts by container
        // Implementation depends on how mount tracking is implemented
      }
    } catch (error) {
      throw error;
    }
  }

  // Getters for individual managers
  public get docker(): DockerClient {
    return this.dockerClient;
  }

  public get templates(): ContainerTemplateManager {
    return this.templateManager;
  }

  public get networks(): NetworkManager {
    return this.networkManager;
  }

  public get volumes(): VolumeManager {
    return this.volumeManager;
  }

  public get imageOptimizer(): ImageOptimizer {
    return this.imageOptimizer;
  }

  public get security(): DockerSecurityManager {
    return this.securityManager;
  }
}

// Default export
export default DockerIntegrationService;

// Constants
export const DOCKER_INTEGRATION_DEFAULTS = {
  DOCKER_SOCKET_PATH: '/var/run/docker.sock',
  DOCKER_TIMEOUT: 30000,
  NETWORK_MONITORING_INTERVAL: 60000,
  VOLUME_MONITORING_INTERVAL: 300000,
  VOLUME_CLEANUP_INTERVAL: 3600000,
  DEFAULT_NETWORK_DRIVER: 'bridge',
  DEFAULT_VOLUME_DRIVER: 'local'
} as const;