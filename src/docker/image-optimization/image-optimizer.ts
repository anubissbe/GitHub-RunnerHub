import { createLogger } from '../../utils/logger';
import { DockerClient } from '../docker-client';
import { EventEmitter } from 'events';
import Docker from 'dockerode';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = createLogger('ImageOptimizer');

export interface ImageOptimizationConfig {
  enabled: boolean;
  baseImages: BaseImageConfig[];
  layerCaching: LayerCachingConfig;
  compression: CompressionConfig;
  security: SecurityConfig;
  performance: PerformanceConfig;
  cleanup: CleanupConfig;
}

export interface BaseImageConfig {
  id: string;
  name: string;
  tag: string;
  category: ImageCategory;
  optimizations: OptimizationRule[];
  prebuilt: boolean;
  buildArgs: Record<string, string>;
  labels: Record<string, string>;
  metadata: ImageMetadata;
}

export interface OptimizationRule {
  id: string;
  name: string;
  type: OptimizationType;
  target: OptimizationTarget;
  priority: number;
  conditions: OptimizationCondition[];
  actions: OptimizationAction[];
  enabled: boolean;
}

export interface OptimizationCondition {
  type: 'size' | 'layers' | 'architecture' | 'labels' | 'age';
  operator: 'gt' | 'lt' | 'eq' | 'contains' | 'matches';
  value: any;
}

export interface OptimizationAction {
  type: OptimizationActionType;
  parameters: Record<string, any>;
  order: number;
}

export interface LayerCachingConfig {
  enabled: boolean;
  strategy: CachingStrategy;
  maxCacheSize: string; // e.g., "50GB"
  maxAge: number; // hours
  enablePredictive: boolean;
  enableSharing: boolean;
  invalidationRules: CacheInvalidationRule[];
}

export interface CacheInvalidationRule {
  id: string;
  trigger: 'time' | 'size' | 'dependency' | 'manual';
  condition: any;
  action: 'delete' | 'rebuild' | 'mark_stale';
}

export interface CompressionConfig {
  enabled: boolean;
  algorithm: CompressionAlgorithm;
  level: number; // 1-9
  excludeExtensions: string[];
  parallelize: boolean;
  chunkSize: string; // e.g., "64MB"
}

export interface SecurityConfig {
  scanImages: boolean;
  scannerConfig: ImageScannerConfig;
  enforceSignatures: boolean;
  allowedRegistries: string[];
  blockedImages: string[];
  vulnerabilityThreshold: VulnerabilityLevel;
}

export interface ImageScannerConfig {
  scanner: 'trivy' | 'clair' | 'anchore' | 'snyk';
  database: {
    url: string;
    updateInterval: number; // hours
  };
  ignoreUnfixed: boolean;
  skipFiles: string[];
  skipDirs: string[];
}

export interface PerformanceConfig {
  parallelBuilds: number;
  buildTimeout: number; // seconds
  pullTimeout: number; // seconds
  enableMultiStage: boolean;
  enableBuildKit: boolean;
  buildKitConfig: BuildKitConfig;
}

export interface BuildKitConfig {
  workers: number;
  gcPolicy: GCPolicy[];
  frontend: string;
  exportCache: boolean;
  importCache: boolean;
}

export interface GCPolicy {
  keepDuration: string; // e.g., "72h"
  keepBytes: string; // e.g., "10GB"
  filters: string[];
}

export interface CleanupConfig {
  enabled: boolean;
  schedule: string; // cron expression
  removeUnused: boolean;
  removeDangling: boolean;
  pruneStrategy: PruneStrategy;
  retentionPeriod: number; // hours
  excludeImages: string[];
}

export interface ImageMetadata {
  size: number;
  layers: number;
  architecture: string;
  os: string;
  created: Date;
  lastUsed: Date;
  usageCount: number;
  buildTime: number; // seconds
  optimizationScore: number; // 0-100
  tags: string[];
}

export interface OptimizedImage {
  id: string;
  originalId: string;
  name: string;
  tag: string;
  optimizations: AppliedOptimization[];
  sizeBefore: number;
  sizeAfter: number;
  reductionPercent: number;
  buildTime: number;
  createdAt: Date;
  metadata: ImageMetadata;
}

export interface AppliedOptimization {
  ruleId: string;
  type: OptimizationType;
  action: OptimizationActionType;
  impact: OptimizationImpact;
  duration: number; // seconds
}

export interface OptimizationImpact {
  sizeReduction: number; // bytes
  layerReduction: number;
  buildTimeChange: number; // seconds
  score: number; // 0-100
}

export interface BuildContext {
  dockerfile: string;
  contextPath: string;
  buildArgs: Record<string, string>;
  labels: Record<string, string>;
  target?: string;
  platform?: string;
  cache?: boolean;
}

export enum ImageCategory {
  BASE = 'base',
  RUNTIME = 'runtime',
  BUILDER = 'builder',
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  TESTING = 'testing',
  SECURITY = 'security'
}

export enum OptimizationType {
  SIZE_REDUCTION = 'size_reduction',
  LAYER_OPTIMIZATION = 'layer_optimization',
  CACHE_OPTIMIZATION = 'cache_optimization',
  SECURITY_HARDENING = 'security_hardening',
  PERFORMANCE_TUNING = 'performance_tuning'
}

export enum OptimizationTarget {
  DOCKERFILE = 'dockerfile',
  LAYERS = 'layers',
  METADATA = 'metadata',
  FILESYSTEM = 'filesystem',
  DEPENDENCIES = 'dependencies'
}

export enum OptimizationActionType {
  REMOVE_PACKAGE_CACHE = 'remove_package_cache',
  MERGE_LAYERS = 'merge_layers',
  COMPRESS_LAYERS = 'compress_layers',
  REMOVE_UNUSED_FILES = 'remove_unused_files',
  OPTIMIZE_DOCKERFILE = 'optimize_dockerfile',
  ADD_MULTISTAGE = 'add_multistage',
  UPDATE_BASE_IMAGE = 'update_base_image',
  REMOVE_VULNERABILITIES = 'remove_vulnerabilities'
}

export enum CachingStrategy {
  LRU = 'lru',
  LFU = 'lfu',
  FIFO = 'fifo',
  PREDICTIVE = 'predictive',
  ADAPTIVE = 'adaptive'
}

export enum CompressionAlgorithm {
  GZIP = 'gzip',
  ZSTD = 'zstd',
  LZ4 = 'lz4',
  BROTLI = 'brotli'
}

export enum VulnerabilityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum PruneStrategy {
  AGGRESSIVE = 'aggressive',
  CONSERVATIVE = 'conservative',
  BALANCED = 'balanced',
  CUSTOM = 'custom'
}

export class ImageOptimizer extends EventEmitter {
  private static instance: ImageOptimizer;
  private dockerClient: DockerClient;
  private config: ImageOptimizationConfig;
  private optimizedImages: Map<string, OptimizedImage> = new Map();
  // Reserved for future optimization queue implementation
  // private optimizationQueue: string[] = [];
  // private _isOptimizing = false;
  private cacheDirectory: string;

  private constructor() {
    super();
    this.dockerClient = DockerClient.getInstance();
    this.cacheDirectory = process.env.IMAGE_CACHE_DIR || '/tmp/image-optimizer';
    this.config = this.getDefaultConfig();
    this.initializeOptimizer();
  }

  public static getInstance(): ImageOptimizer {
    if (!ImageOptimizer.instance) {
      ImageOptimizer.instance = new ImageOptimizer();
    }
    return ImageOptimizer.instance;
  }

  /**
   * Initialize the image optimizer
   */
  private async initializeOptimizer(): Promise<void> {
    try {
      logger.info('Initializing Image Optimizer');

      // Ensure cache directory exists
      await fs.mkdir(this.cacheDirectory, { recursive: true });

      // Load existing optimized images
      await this.loadOptimizedImages();

      // Setup cleanup scheduler if enabled
      if (this.config.cleanup.enabled) {
        this.setupCleanupScheduler();
      }

      // Start layer cache monitoring
      if (this.config.layerCaching.enabled) {
        this.startCacheMonitoring();
      }

      logger.info('Image Optimizer initialized successfully');
      this.emit('optimizer:initialized');
    } catch (error) {
      logger.error('Failed to initialize Image Optimizer:', error);
      throw error;
    }
  }

  /**
   * Get default optimization configuration
   */
  private getDefaultConfig(): ImageOptimizationConfig {
    return {
      enabled: true,
      baseImages: this.getDefaultBaseImages(),
      layerCaching: {
        enabled: true,
        strategy: CachingStrategy.ADAPTIVE,
        maxCacheSize: '50GB',
        maxAge: 72, // 3 days
        enablePredictive: true,
        enableSharing: true,
        invalidationRules: []
      },
      compression: {
        enabled: true,
        algorithm: CompressionAlgorithm.ZSTD,
        level: 6,
        excludeExtensions: ['.jpg', '.png', '.gif', '.zip', '.gz'],
        parallelize: true,
        chunkSize: '64MB'
      },
      security: {
        scanImages: true,
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
        enforceSignatures: false,
        allowedRegistries: ['docker.io', 'ghcr.io', 'gcr.io'],
        blockedImages: [],
        vulnerabilityThreshold: VulnerabilityLevel.HIGH
      },
      performance: {
        parallelBuilds: 2,
        buildTimeout: 1800, // 30 minutes
        pullTimeout: 300, // 5 minutes
        enableMultiStage: true,
        enableBuildKit: true,
        buildKitConfig: {
          workers: 4,
          gcPolicy: [
            {
              keepDuration: '72h',
              keepBytes: '10GB',
              filters: ['type==source.local']
            }
          ],
          frontend: 'dockerfile.v0',
          exportCache: true,
          importCache: true
        }
      },
      cleanup: {
        enabled: true,
        schedule: '0 2 * * *', // Daily at 2 AM
        removeUnused: true,
        removeDangling: true,
        pruneStrategy: PruneStrategy.BALANCED,
        retentionPeriod: 168, // 1 week
        excludeImages: ['ubuntu:latest', 'node:18-alpine', 'python:3.11-slim']
      }
    };
  }

  /**
   * Get default base image configurations
   */
  private getDefaultBaseImages(): BaseImageConfig[] {
    return [
      {
        id: 'ubuntu-optimized',
        name: 'ubuntu',
        tag: '22.04-optimized',
        category: ImageCategory.BASE,
        optimizations: [
          {
            id: 'remove-apt-cache',
            name: 'Remove APT Cache',
            type: OptimizationType.SIZE_REDUCTION,
            target: OptimizationTarget.FILESYSTEM,
            priority: 1,
            conditions: [
              {
                type: 'size',
                operator: 'gt',
                value: '100MB'
              }
            ],
            actions: [
              {
                type: OptimizationActionType.REMOVE_PACKAGE_CACHE,
                parameters: { paths: ['/var/lib/apt/lists/*', '/var/cache/apt/*'] },
                order: 1
              }
            ],
            enabled: true
          }
        ],
        prebuilt: true,
        buildArgs: {},
        labels: {
          'image.optimized': 'true',
          'image.version': '1.0.0'
        },
        metadata: {
          size: 0,
          layers: 0,
          architecture: 'amd64',
          os: 'linux',
          created: new Date(),
          lastUsed: new Date(),
          usageCount: 0,
          buildTime: 0,
          optimizationScore: 85,
          tags: ['ubuntu', 'base', 'optimized']
        }
      },
      {
        id: 'node-optimized',
        name: 'node',
        tag: '18-alpine-optimized',
        category: ImageCategory.RUNTIME,
        optimizations: [
          {
            id: 'remove-npm-cache',
            name: 'Remove NPM Cache',
            type: OptimizationType.SIZE_REDUCTION,
            target: OptimizationTarget.FILESYSTEM,
            priority: 1,
            conditions: [
              {
                type: 'size',
                operator: 'gt',
                value: '50MB'
              }
            ],
            actions: [
              {
                type: OptimizationActionType.REMOVE_PACKAGE_CACHE,
                parameters: { paths: ['/root/.npm', '/usr/local/lib/node_modules/npm/cache'] },
                order: 1
              }
            ],
            enabled: true
          }
        ],
        prebuilt: true,
        buildArgs: {},
        labels: {
          'image.optimized': 'true',
          'image.runtime': 'nodejs'
        },
        metadata: {
          size: 0,
          layers: 0,
          architecture: 'amd64',
          os: 'linux',
          created: new Date(),
          lastUsed: new Date(),
          usageCount: 0,
          buildTime: 0,
          optimizationScore: 90,
          tags: ['nodejs', 'alpine', 'optimized']
        }
      }
    ];
  }

  /**
   * Optimize an image
   */
  public async optimizeImage(
    imageId: string,
    options?: {
      force?: boolean;
      optimizations?: string[];
      buildContext?: BuildContext;
    }
  ): Promise<OptimizedImage> {
    try {
      logger.info(`Starting optimization for image: ${imageId}`);

      // Check if already optimized
      if (!options?.force && this.optimizedImages.has(imageId)) {
        const existingOptimization = this.optimizedImages.get(imageId)!;
        logger.info(`Image ${imageId} already optimized, returning existing optimization`);
        return existingOptimization;
      }

      // Get image information
      const imageInfo = await (this.dockerClient as any).getImageInfo(imageId);
      if (!imageInfo) {
        throw new Error(`Image not found: ${imageId}`);
      }

      // Analyze image for optimization opportunities
      const analysis = await this.analyzeImage(imageId);
      
      // Select optimization rules to apply
      const applicableRules = this.selectOptimizationRules(analysis, options?.optimizations);
      
      if (applicableRules.length === 0) {
        logger.info(`No applicable optimization rules for image: ${imageId}`);
        return this.createOptimizedImage(imageId, imageInfo, []);
      }

      // Apply optimizations
      const appliedOptimizations: AppliedOptimization[] = [];
      let currentImageId = imageId;
      let currentSize = imageInfo.size;

      for (const rule of applicableRules) {
        try {
          const startTime = Date.now();
          const result = await this.applyOptimization(currentImageId, rule, options?.buildContext);
          
          if (result.success) {
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            
            appliedOptimizations.push({
              ruleId: rule.id,
              type: rule.type,
              action: rule.actions[0].type,
              impact: result.impact,
              duration
            });

            currentImageId = result.optimizedImageId;
            currentSize = result.newSize;
          }
        } catch (error) {
          logger.warn(`Failed to apply optimization rule ${rule.id}:`, error);
        }
      }

      // Create optimized image record
      const optimizedImage = this.createOptimizedImage(
        currentImageId,
        { ...imageInfo, size: currentSize },
        appliedOptimizations
      );

      // Store optimization result
      this.optimizedImages.set(imageId, optimizedImage);
      await this.saveOptimizedImages();

      logger.info(`Image optimization completed: ${imageId} -> ${currentImageId}`);
      this.emit('image:optimized', { original: imageId, optimized: optimizedImage });

      return optimizedImage;
    } catch (error) {
      logger.error(`Failed to optimize image ${imageId}:`, error);
      this.emit('image:optimization:failed', { imageId, error });
      throw error;
    }
  }

  /**
   * Analyze image for optimization opportunities
   */
  private async analyzeImage(imageId: string): Promise<any> {
    try {
      const imageInfo = await (this.dockerClient as any).getImageInfo(imageId);
      const history = await (this.dockerClient as any).getImageHistory(imageId);
      
      return {
        size: imageInfo.size,
        layers: history.length,
        architecture: imageInfo.architecture,
        os: imageInfo.os,
        packageCaches: await this.detectPackageCaches(imageId),
        unusedFiles: await this.detectUnusedFiles(imageId),
        vulnerabilities: this.config.security.scanImages 
          ? await this.scanImageVulnerabilities(imageId)
          : [],
        optimizationPotential: this.calculateOptimizationPotential(imageInfo, history)
      };
    } catch (error) {
      logger.error(`Failed to analyze image ${imageId}:`, error);
      throw error;
    }
  }

  /**
   * Select applicable optimization rules
   */
  private selectOptimizationRules(
    analysis: any,
    requestedOptimizations?: string[]
  ): OptimizationRule[] {
    const allRules = this.getAllOptimizationRules();
    
    return allRules.filter(rule => {
      // Check if specifically requested
      if (requestedOptimizations && !requestedOptimizations.includes(rule.id)) {
        return false;
      }

      // Check if rule is enabled
      if (!rule.enabled) {
        return false;
      }

      // Check conditions
      return rule.conditions.every(condition => {
        return this.evaluateCondition(condition, analysis);
      });
    }).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Apply a single optimization
   */
  private async applyOptimization(
    imageId: string,
    rule: OptimizationRule,
    buildContext?: BuildContext
  ): Promise<{
    success: boolean;
    optimizedImageId: string;
    newSize: number;
    impact: OptimizationImpact;
  }> {
    try {
      logger.info(`Applying optimization rule: ${rule.name} to ${imageId}`);

      const sizeBefore = (await (this.dockerClient as any).getImageInfo(imageId))?.size || 0;
      let optimizedImageId = imageId;

      // Apply each action in the rule
      for (const action of rule.actions.sort((a, b) => a.order - b.order)) {
        optimizedImageId = await this.executeOptimizationAction(
          optimizedImageId,
          action,
          buildContext
        );
      }

      const sizeAfter = (await (this.dockerClient as any).getImageInfo(optimizedImageId))?.size || sizeBefore;
      
      const impact: OptimizationImpact = {
        sizeReduction: sizeBefore - sizeAfter,
        layerReduction: 0, // Would need to calculate
        buildTimeChange: 0, // Would need to measure
        score: this.calculateOptimizationScore(sizeBefore, sizeAfter)
      };

      return {
        success: true,
        optimizedImageId,
        newSize: sizeAfter,
        impact
      };
    } catch (error) {
      logger.error(`Failed to apply optimization rule ${rule.id}:`, error);
      return {
        success: false,
        optimizedImageId: imageId,
        newSize: 0,
        impact: {
          sizeReduction: 0,
          layerReduction: 0,
          buildTimeChange: 0,
          score: 0
        }
      };
    }
  }

  /**
   * Execute a specific optimization action
   */
  private async executeOptimizationAction(
    imageId: string,
    action: OptimizationAction,
    buildContext?: BuildContext
  ): Promise<string> {
    switch (action.type) {
      case OptimizationActionType.REMOVE_PACKAGE_CACHE:
        return this.removePackageCache(imageId, action.parameters);
      
      case OptimizationActionType.MERGE_LAYERS:
        return this.mergeLayers(imageId, action.parameters);
      
      case OptimizationActionType.COMPRESS_LAYERS:
        return this.compressLayers(imageId, action.parameters);
      
      case OptimizationActionType.REMOVE_UNUSED_FILES:
        return this.removeUnusedFiles(imageId, action.parameters);
      
      case OptimizationActionType.OPTIMIZE_DOCKERFILE:
        return this.optimizeDockerfile(imageId, action.parameters, buildContext);
      
      default:
        logger.warn(`Unknown optimization action: ${action.type}`);
        return imageId;
    }
  }

  /**
   * Remove package cache from image
   */
  private async removePackageCache(
    imageId: string,
    parameters: Record<string, any>
  ): Promise<string> {
    const paths = parameters.paths as string[];
    if (!paths || paths.length === 0) {
      return imageId;
    }

    const dockerfile = `
FROM ${imageId}
RUN rm -rf ${paths.join(' ')} || true
`;

    return this.buildOptimizedImage(dockerfile, `${imageId}-cache-removed`);
  }

  /**
   * Merge layers in image
   */
  private async mergeLayers(
    imageId: string,
    _parameters: Record<string, any>
  ): Promise<string> {
    // This would require more complex layer manipulation
    // For now, return the original image
    logger.info(`Layer merging not yet implemented for ${imageId}`);
    return imageId;
  }

  /**
   * Compress layers in image
   */
  private async compressLayers(
    imageId: string,
    _parameters: Record<string, any>
  ): Promise<string> {
    // This would require layer-level compression
    // For now, return the original image
    logger.info(`Layer compression not yet implemented for ${imageId}`);
    return imageId;
  }

  /**
   * Remove unused files from image
   */
  private async removeUnusedFiles(
    imageId: string,
    parameters: Record<string, any>
  ): Promise<string> {
    const patterns = parameters.patterns as string[] || [
      '/tmp/*',
      '/var/tmp/*',
      '/var/cache/*',
      '*.log'
    ];

    const dockerfile = `
FROM ${imageId}
RUN find / -type f \\( ${patterns.map(p => `-name "${p}"`).join(' -o ')} \\) -delete 2>/dev/null || true
`;

    return this.buildOptimizedImage(dockerfile, `${imageId}-unused-removed`);
  }

  /**
   * Optimize Dockerfile
   */
  private async optimizeDockerfile(
    imageId: string,
    _parameters: Record<string, any>,
    buildContext?: BuildContext
  ): Promise<string> {
    if (!buildContext?.dockerfile) {
      logger.warn(`No Dockerfile context provided for optimization of ${imageId}`);
      return imageId;
    }

    // This would involve analyzing and optimizing the Dockerfile
    // For now, return the original image
    logger.info(`Dockerfile optimization not yet implemented for ${imageId}`);
    return imageId;
  }

  /**
   * Build optimized image from Dockerfile
   */
  private async buildOptimizedImage(
    dockerfile: string,
    tag: string
  ): Promise<string> {
    try {
      const buildContext = path.join(this.cacheDirectory, `build-${Date.now()}`);
      await fs.mkdir(buildContext, { recursive: true });
      
      const dockerfilePath = path.join(buildContext, 'Dockerfile');
      await fs.writeFile(dockerfilePath, dockerfile);

      const buildOptions: Docker.ImageBuildOptions = {
        t: tag,
        buildargs: {},
        labels: {
          'optimization.generated': 'true',
          'optimization.timestamp': new Date().toISOString()
        }
      };

      const imageId = await (this.dockerClient as any).buildImage(buildContext, buildOptions);
      
      // Cleanup build context
      await fs.rmdir(buildContext, { recursive: true });
      
      return imageId;
    } catch (error) {
      logger.error('Failed to build optimized image:', error);
      throw error;
    }
  }

  /**
   * Detect package caches in image
   */
  private async detectPackageCaches(_imageId: string): Promise<string[]> {
    // This would involve scanning the image filesystem
    // For now, return common cache locations
    return [
      '/var/lib/apt/lists/*',
      '/var/cache/apt/*',
      '/root/.npm',
      '/root/.cache',
      '/tmp/*'
    ];
  }

  /**
   * Detect unused files in image
   */
  private async detectUnusedFiles(_imageId: string): Promise<string[]> {
    // This would involve filesystem analysis
    // For now, return common unused file patterns
    return [
      '*.log',
      '/tmp/*',
      '/var/tmp/*',
      '*.bak',
      '*.old'
    ];
  }

  /**
   * Scan image for vulnerabilities
   */
  private async scanImageVulnerabilities(imageId: string): Promise<any[]> {
    try {
      // This would integrate with Trivy or other security scanners
      logger.info(`Scanning image for vulnerabilities: ${imageId}`);
      return [];
    } catch (error) {
      logger.error(`Failed to scan image ${imageId}:`, error);
      return [];
    }
  }

  /**
   * Calculate optimization potential
   */
  private calculateOptimizationPotential(imageInfo: any, history: any[]): number {
    // Simple heuristic based on size and layer count
    const sizeFactor = Math.min(imageInfo.size / (1024 * 1024 * 1024), 1); // GB
    const layerFactor = Math.min(history.length / 50, 1);
    
    return Math.round((sizeFactor + layerFactor) * 50);
  }

  /**
   * Evaluate optimization condition
   */
  private evaluateCondition(condition: OptimizationCondition, analysis: any): boolean {
    const value = this.getAnalysisValue(analysis, condition.type);
    
    switch (condition.operator) {
      case 'gt':
        return this.compareValues(value, condition.value) > 0;
      case 'lt':
        return this.compareValues(value, condition.value) < 0;
      case 'eq':
        return this.compareValues(value, condition.value) === 0;
      case 'contains':
        return String(value).includes(String(condition.value));
      case 'matches':
        return new RegExp(condition.value).test(String(value));
      default:
        return false;
    }
  }

  /**
   * Get analysis value by type
   */
  private getAnalysisValue(analysis: any, type: string): any {
    switch (type) {
      case 'size':
        return analysis.size;
      case 'layers':
        return analysis.layers;
      case 'architecture':
        return analysis.architecture;
      case 'labels':
        return analysis.labels;
      case 'age':
        return analysis.age;
      default:
        return null;
    }
  }

  /**
   * Compare values (supports size strings like "100MB")
   */
  private compareValues(value1: any, value2: any): number {
    // Handle size comparisons
    if (typeof value2 === 'string' && value2.match(/^\d+[KMGT]?B?$/i)) {
      const size1 = typeof value1 === 'number' ? value1 : this.parseSize(value1);
      const size2 = this.parseSize(value2);
      return size1 - size2;
    }
    
    // Handle numeric comparisons
    if (typeof value1 === 'number' && typeof value2 === 'number') {
      return value1 - value2;
    }
    
    // Handle string comparisons
    return String(value1).localeCompare(String(value2));
  }

  /**
   * Parse size string to bytes
   */
  private parseSize(sizeStr: string): number {
    const units: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024
    };

    const match = sizeStr.toUpperCase().match(/^(\d+)([KMGT]?B?)$/);
    if (!match) {
      return 0;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2] || 'B';
    
    return value * (units[unit] || 1);
  }

  /**
   * Get all optimization rules
   */
  private getAllOptimizationRules(): OptimizationRule[] {
    const rules: OptimizationRule[] = [];
    
    // Collect rules from base images
    this.config.baseImages.forEach(baseImage => {
      rules.push(...baseImage.optimizations);
    });
    
    // Add default rules
    rules.push(...this.getDefaultOptimizationRules());
    
    return rules;
  }

  /**
   * Get default optimization rules
   */
  private getDefaultOptimizationRules(): OptimizationRule[] {
    return [
      {
        id: 'remove-temp-files',
        name: 'Remove Temporary Files',
        type: OptimizationType.SIZE_REDUCTION,
        target: OptimizationTarget.FILESYSTEM,
        priority: 5,
        conditions: [
          {
            type: 'size',
            operator: 'gt',
            value: '10MB'
          }
        ],
        actions: [
          {
            type: OptimizationActionType.REMOVE_UNUSED_FILES,
            parameters: {
              patterns: ['/tmp/*', '/var/tmp/*', '*.log', '*.bak']
            },
            order: 1
          }
        ],
        enabled: true
      }
    ];
  }

  /**
   * Calculate optimization score
   */
  private calculateOptimizationScore(sizeBefore: number, sizeAfter: number): number {
    if (sizeBefore === 0) return 0;
    
    const reduction = (sizeBefore - sizeAfter) / sizeBefore;
    return Math.round(reduction * 100);
  }

  /**
   * Create optimized image record
   */
  private createOptimizedImage(
    imageId: string,
    imageInfo: any,
    appliedOptimizations: AppliedOptimization[]
  ): OptimizedImage {
    const sizeBefore = imageInfo.originalSize || imageInfo.size;
    const sizeAfter = imageInfo.size;
    const reductionPercent = sizeBefore > 0 
      ? Math.round(((sizeBefore - sizeAfter) / sizeBefore) * 100)
      : 0;

    return {
      id: this.generateOptimizationId(imageId),
      originalId: imageId,
      name: imageInfo.name || 'unknown',
      tag: imageInfo.tag || 'latest',
      optimizations: appliedOptimizations,
      sizeBefore,
      sizeAfter,
      reductionPercent,
      buildTime: appliedOptimizations.reduce((sum, opt) => sum + opt.duration, 0),
      createdAt: new Date(),
      metadata: {
        size: sizeAfter,
        layers: imageInfo.layers || 0,
        architecture: imageInfo.architecture || 'unknown',
        os: imageInfo.os || 'unknown',
        created: new Date(),
        lastUsed: new Date(),
        usageCount: 1,
        buildTime: 0,
        optimizationScore: this.calculateOptimizationScore(sizeBefore, sizeAfter),
        tags: imageInfo.tags || []
      }
    };
  }

  /**
   * Generate unique optimization ID
   */
  private generateOptimizationId(imageId: string): string {
    const hash = crypto.createHash('sha256');
    hash.update(`${imageId}-${Date.now()}`);
    return hash.digest('hex').substring(0, 16);
  }

  /**
   * Load existing optimized images
   */
  private async loadOptimizedImages(): Promise<void> {
    try {
      const cacheFile = path.join(this.cacheDirectory, 'optimized-images.json');
      const data = await fs.readFile(cacheFile, 'utf-8');
      const images = JSON.parse(data) as OptimizedImage[];
      
      images.forEach(image => {
        this.optimizedImages.set(image.originalId, image);
      });
      
      logger.info(`Loaded ${images.length} optimized image records`);
    } catch {
      // File doesn't exist or is invalid, start fresh
      logger.info('Starting with empty optimized images cache');
    }
  }

  /**
   * Save optimized images to cache
   */
  private async saveOptimizedImages(): Promise<void> {
    try {
      const cacheFile = path.join(this.cacheDirectory, 'optimized-images.json');
      const images = Array.from(this.optimizedImages.values());
      await fs.writeFile(cacheFile, JSON.stringify(images, null, 2));
    } catch (error) {
      logger.error('Failed to save optimized images cache:', error);
    }
  }

  /**
   * Setup cleanup scheduler
   */
  private setupCleanupScheduler(): void {
    // This would integrate with a cron scheduler
    logger.info('Image cleanup scheduler setup (placeholder implementation)');
  }

  /**
   * Start cache monitoring
   */
  private startCacheMonitoring(): void {
    // This would monitor cache usage and performance
    logger.info('Layer cache monitoring started (placeholder implementation)');
  }

  /**
   * Get optimization statistics
   */
  public getOptimizationStats(): any {
    const optimizations = Array.from(this.optimizedImages.values());
    
    if (optimizations.length === 0) {
      return {
        totalOptimizations: 0,
        totalSizeReduction: 0,
        averageReduction: 0,
        totalBuildTime: 0
      };
    }

    const totalSizeReduction = optimizations.reduce(
      (sum, opt) => sum + (opt.sizeBefore - opt.sizeAfter), 0
    );
    const totalBuildTime = optimizations.reduce(
      (sum, opt) => sum + opt.buildTime, 0
    );

    return {
      totalOptimizations: optimizations.length,
      totalSizeReduction,
      averageReduction: Math.round(
        optimizations.reduce((sum, opt) => sum + opt.reductionPercent, 0) / optimizations.length
      ),
      totalBuildTime,
      byType: this.groupOptimizationsByType(optimizations)
    };
  }

  /**
   * Group optimizations by type
   */
  private groupOptimizationsByType(optimizations: OptimizedImage[]): Record<string, number> {
    const groups: Record<string, number> = {};
    
    optimizations.forEach(opt => {
      opt.optimizations.forEach(applied => {
        groups[applied.type] = (groups[applied.type] || 0) + 1;
      });
    });
    
    return groups;
  }

  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<ImageOptimizationConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('Image optimizer configuration updated');
    this.emit('config:updated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): ImageOptimizationConfig {
    return { ...this.config };
  }

  /**
   * List optimized images
   */
  public listOptimizedImages(): OptimizedImage[] {
    return Array.from(this.optimizedImages.values());
  }

  /**
   * Get optimized image by original ID
   */
  public getOptimizedImage(originalImageId: string): OptimizedImage | undefined {
    return this.optimizedImages.get(originalImageId);
  }

  /**
   * Remove optimized image record
   */
  public removeOptimizedImage(originalImageId: string): boolean {
    const result = this.optimizedImages.delete(originalImageId);
    if (result) {
      this.saveOptimizedImages();
      this.emit('optimization:removed', { originalImageId });
    }
    return result;
  }

  /**
   * Cleanup old optimizations
   */
  public async cleanupOptimizations(maxAge: number = 168): Promise<number> {
    const cutoffDate = new Date(Date.now() - (maxAge * 60 * 60 * 1000));
    let removedCount = 0;

    for (const [imageId, optimization] of this.optimizedImages.entries()) {
      if (optimization.createdAt < cutoffDate) {
        this.optimizedImages.delete(imageId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      await this.saveOptimizedImages();
      logger.info(`Cleaned up ${removedCount} old optimizations`);
      this.emit('cleanup:completed', { removedCount });
    }

    return removedCount;
  }
}

export default ImageOptimizer;