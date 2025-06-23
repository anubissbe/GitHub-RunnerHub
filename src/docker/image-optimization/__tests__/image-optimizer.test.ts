import { ImageOptimizer, OptimizationType, OptimizationActionType, ImageCategory } from '../image-optimizer';
import { DockerClient } from '../../docker-client';
import * as fs from 'fs/promises';

// Mock DockerClient
jest.mock('../../docker-client');
jest.mock('fs/promises');

const mockDockerClient = {
  getImageInfo: jest.fn(),
  getImageHistory: jest.fn(),
  buildImage: jest.fn(),
  createContainer: jest.fn(),
  startContainer: jest.fn(),
  stopContainer: jest.fn(),
  removeContainer: jest.fn()
};

const mockFs = fs as jest.Mocked<typeof fs>;

describe('ImageOptimizer', () => {
  let imageOptimizer: ImageOptimizer;

  beforeEach(() => {
    jest.clearAllMocks();
    (DockerClient.getInstance as jest.Mock).mockReturnValue(mockDockerClient);
    
    // Mock fs operations
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.readFile.mockRejectedValue(new Error('File not found'));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.rmdir.mockResolvedValue(undefined);

    imageOptimizer = ImageOptimizer.getInstance();
  });

  describe('Image Analysis', () => {
    it('should analyze image correctly', async () => {
      const imageId = 'test-image:latest';
      const mockImageInfo = {
        id: imageId,
        size: 1000000000, // 1GB
        architecture: 'amd64',
        os: 'linux',
        name: 'test-image',
        tag: 'latest'
      };

      const mockHistory = [
        { id: 'layer1', size: 100000000 },
        { id: 'layer2', size: 200000000 },
        { id: 'layer3', size: 700000000 }
      ];

      mockDockerClient.getImageInfo.mockResolvedValue(mockImageInfo);
      mockDockerClient.getImageHistory.mockResolvedValue(mockHistory);

      // Access private method via any type casting
      const analysis = await (imageOptimizer as any).analyzeImage(imageId);

      expect(analysis).toEqual({
        size: 1000000000,
        layers: 3,
        architecture: 'amd64',
        os: 'linux',
        packageCaches: expect.any(Array),
        unusedFiles: expect.any(Array),
        vulnerabilities: [],
        optimizationPotential: expect.any(Number)
      });
    });

    it('should detect package caches', async () => {
      const imageId = 'ubuntu:latest';
      const caches = await (imageOptimizer as any).detectPackageCaches(imageId);

      expect(caches).toContain('/var/lib/apt/lists/*');
      expect(caches).toContain('/var/cache/apt/*');
      expect(caches).toContain('/root/.npm');
    });

    it('should detect unused files', async () => {
      const imageId = 'test-image:latest';
      const unusedFiles = await (imageOptimizer as any).detectUnusedFiles(imageId);

      expect(unusedFiles).toContain('*.log');
      expect(unusedFiles).toContain('/tmp/*');
      expect(unusedFiles).toContain('*.bak');
    });
  });

  describe('Optimization Rules', () => {
    it('should select applicable optimization rules', () => {
      const analysis = {
        size: 500000000, // 500MB
        layers: 10,
        packageCaches: ['/var/lib/apt/lists/*'],
        unusedFiles: ['*.log']
      };

      const rules = (imageOptimizer as any).selectOptimizationRules(analysis);

      expect(rules).toBeInstanceOf(Array);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules[0]).toHaveProperty('id');
      expect(rules[0]).toHaveProperty('type');
      expect(rules[0]).toHaveProperty('enabled', true);
    });

    it('should filter rules by conditions', () => {
      const smallImageAnalysis = {
        size: 1000000, // 1MB
        layers: 2
      };

      const rules = (imageOptimizer as any).selectOptimizationRules(smallImageAnalysis);
      
      // Should have fewer rules for small images
      expect(rules.length).toBeLessThanOrEqual(5);
    });

    it('should evaluate conditions correctly', () => {
      const analysis = { size: 100000000 }; // 100MB
      
      const gtCondition = {
        type: 'size',
        operator: 'gt',
        value: '50MB'
      };

      const ltCondition = {
        type: 'size',
        operator: 'lt',
        value: '50MB'
      };

      expect((imageOptimizer as any).evaluateCondition(gtCondition, analysis)).toBe(true);
      expect((imageOptimizer as any).evaluateCondition(ltCondition, analysis)).toBe(false);
    });
  });

  describe('Image Optimization', () => {
    it('should optimize image successfully', async () => {
      const imageId = 'test-image:latest';
      const mockImageInfo = {
        id: imageId,
        size: 1000000000,
        architecture: 'amd64',
        os: 'linux',
        name: 'test-image',
        tag: 'latest'
      };

      const mockHistory = [
        { id: 'layer1', size: 100000000 },
        { id: 'layer2', size: 900000000 }
      ];

      mockDockerClient.getImageInfo.mockResolvedValue(mockImageInfo);
      mockDockerClient.getImageHistory.mockResolvedValue(mockHistory);
      mockDockerClient.buildImage.mockResolvedValue('optimized-image-id');

      const result = await imageOptimizer.optimizeImage(imageId);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('originalId', imageId);
      expect(result).toHaveProperty('optimizations');
      expect(result).toHaveProperty('sizeBefore');
      expect(result).toHaveProperty('sizeAfter');
      expect(result).toHaveProperty('reductionPercent');
    });

    it('should return existing optimization if already optimized', async () => {
      const imageId = 'test-image:latest';
      
      // First optimization
      const mockImageInfo = {
        id: imageId,
        size: 1000000000,
        architecture: 'amd64',
        os: 'linux',
        name: 'test-image',
        tag: 'latest'
      };

      mockDockerClient.getImageInfo.mockResolvedValue(mockImageInfo);
      mockDockerClient.getImageHistory.mockResolvedValue([]);
      mockDockerClient.buildImage.mockResolvedValue('optimized-image-id');

      const firstResult = await imageOptimizer.optimizeImage(imageId);
      
      // Second optimization (should return cached)
      const secondResult = await imageOptimizer.optimizeImage(imageId);

      expect(firstResult.id).toBe(secondResult.id);
      expect(mockDockerClient.buildImage).toHaveBeenCalledTimes(0); // No additional builds
    });

    it('should force re-optimization when requested', async () => {
      const imageId = 'test-image:latest';
      const mockImageInfo = {
        id: imageId,
        size: 1000000000,
        architecture: 'amd64',
        os: 'linux',
        name: 'test-image',
        tag: 'latest'
      };

      mockDockerClient.getImageInfo.mockResolvedValue(mockImageInfo);
      mockDockerClient.getImageHistory.mockResolvedValue([]);
      mockDockerClient.buildImage.mockResolvedValue('optimized-image-id');

      // First optimization
      await imageOptimizer.optimizeImage(imageId);
      
      // Force re-optimization
      await imageOptimizer.optimizeImage(imageId, { force: true });

      expect(mockDockerClient.getImageInfo).toHaveBeenCalledTimes(2);
    });
  });

  describe('Optimization Actions', () => {
    it('should remove package cache', async () => {
      const imageId = 'ubuntu:latest';
      const parameters = {
        paths: ['/var/lib/apt/lists/*', '/var/cache/apt/*']
      };

      mockDockerClient.buildImage.mockResolvedValue('cleaned-image-id');

      const result = await (imageOptimizer as any).removePackageCache(imageId, parameters);

      expect(result).toBe('cleaned-image-id');
      expect(mockDockerClient.buildImage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          t: expect.stringContaining('cache-removed')
        })
      );
    });

    it('should remove unused files', async () => {
      const imageId = 'test-image:latest';
      const parameters = {
        patterns: ['*.log', '/tmp/*', '*.bak']
      };

      mockDockerClient.buildImage.mockResolvedValue('cleaned-image-id');

      const result = await (imageOptimizer as any).removeUnusedFiles(imageId, parameters);

      expect(result).toBe('cleaned-image-id');
      expect(mockDockerClient.buildImage).toHaveBeenCalled();
    });

    it('should build optimized image from dockerfile', async () => {
      const dockerfile = 'FROM ubuntu:latest\nRUN apt-get clean';
      const tag = 'optimized-image';

      mockDockerClient.buildImage.mockResolvedValue('new-image-id');

      const result = await (imageOptimizer as any).buildOptimizedImage(dockerfile, tag);

      expect(result).toBe('new-image-id');
      expect(mockFs.mkdir).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('Dockerfile'),
        dockerfile
      );
    });
  });

  describe('Configuration Management', () => {
    it('should get current configuration', () => {
      const config = imageOptimizer.getConfig();

      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('baseImages');
      expect(config).toHaveProperty('layerCaching');
      expect(config).toHaveProperty('compression');
      expect(config).toHaveProperty('security');
      expect(config).toHaveProperty('performance');
      expect(config).toHaveProperty('cleanup');
    });

    it('should update configuration', () => {
      const updates = {
        enabled: false,
        compression: {
          enabled: false,
          algorithm: 'gzip' as any,
          level: 9,
          excludeExtensions: ['.jpg'],
          parallelize: false,
          chunkSize: '32MB'
        }
      };

      imageOptimizer.updateConfig(updates);
      const config = imageOptimizer.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.compression.algorithm).toBe('gzip');
      expect(config.compression.level).toBe(9);
    });

    it('should validate base image configurations', () => {
      const config = imageOptimizer.getConfig();
      
      expect(config.baseImages).toBeInstanceOf(Array);
      expect(config.baseImages.length).toBeGreaterThan(0);
      
      config.baseImages.forEach(baseImage => {
        expect(baseImage).toHaveProperty('id');
        expect(baseImage).toHaveProperty('name');
        expect(baseImage).toHaveProperty('tag');
        expect(baseImage).toHaveProperty('category');
        expect(baseImage).toHaveProperty('optimizations');
        expect(baseImage.optimizations).toBeInstanceOf(Array);
      });
    });
  });

  describe('Statistics and Reporting', () => {
    beforeEach(async () => {
      // Setup some test optimizations
      const testImage1 = {
        id: 'opt1',
        originalId: 'image1:latest',
        name: 'image1',
        tag: 'latest',
        optimizations: [
          {
            ruleId: 'remove-cache',
            type: OptimizationType.SIZE_REDUCTION,
            action: OptimizationActionType.REMOVE_PACKAGE_CACHE,
            impact: { sizeReduction: 50000000, layerReduction: 1, buildTimeChange: 0, score: 20 },
            duration: 30
          }
        ],
        sizeBefore: 1000000000,
        sizeAfter: 950000000,
        reductionPercent: 5,
        buildTime: 30,
        createdAt: new Date(),
        metadata: {
          size: 950000000,
          layers: 5,
          architecture: 'amd64',
          os: 'linux',
          created: new Date(),
          lastUsed: new Date(),
          usageCount: 1,
          buildTime: 30,
          optimizationScore: 20,
          tags: ['test']
        }
      };

      (imageOptimizer as any).optimizedImages.set('image1:latest', testImage1);
    });

    it('should get optimization statistics', () => {
      const stats = imageOptimizer.getOptimizationStats();

      expect(stats).toHaveProperty('totalOptimizations');
      expect(stats).toHaveProperty('totalSizeReduction');
      expect(stats).toHaveProperty('averageReduction');
      expect(stats).toHaveProperty('totalBuildTime');
      expect(stats).toHaveProperty('byType');
      
      expect(stats.totalOptimizations).toBe(1);
      expect(stats.totalSizeReduction).toBe(50000000);
      expect(stats.averageReduction).toBe(5);
      expect(stats.totalBuildTime).toBe(30);
    });

    it('should list optimized images', () => {
      const optimizedImages = imageOptimizer.listOptimizedImages();

      expect(optimizedImages).toBeInstanceOf(Array);
      expect(optimizedImages.length).toBe(1);
      expect(optimizedImages[0]).toHaveProperty('originalId', 'image1:latest');
    });

    it('should get optimized image by original ID', () => {
      const optimizedImage = imageOptimizer.getOptimizedImage('image1:latest');

      expect(optimizedImage).toBeDefined();
      expect(optimizedImage?.originalId).toBe('image1:latest');
      expect(optimizedImage?.reductionPercent).toBe(5);
    });

    it('should return undefined for non-existent optimization', () => {
      const optimizedImage = imageOptimizer.getOptimizedImage('non-existent:latest');

      expect(optimizedImage).toBeUndefined();
    });
  });

  describe('Cleanup Operations', () => {
    beforeEach(() => {
      // Setup test optimizations with different ages
      const oldDate = new Date(Date.now() - (200 * 60 * 60 * 1000)); // 200 hours ago
      const recentDate = new Date(Date.now() - (50 * 60 * 60 * 1000)); // 50 hours ago

      const oldOptimization = {
        id: 'old-opt',
        originalId: 'old-image:latest',
        name: 'old-image',
        tag: 'latest',
        optimizations: [],
        sizeBefore: 1000000000,
        sizeAfter: 900000000,
        reductionPercent: 10,
        buildTime: 60,
        createdAt: oldDate,
        metadata: {
          size: 900000000,
          layers: 5,
          architecture: 'amd64',
          os: 'linux',
          created: oldDate,
          lastUsed: oldDate,
          usageCount: 1,
          buildTime: 60,
          optimizationScore: 30,
          tags: ['old']
        }
      };

      const recentOptimization = {
        id: 'recent-opt',
        originalId: 'recent-image:latest',
        name: 'recent-image',
        tag: 'latest',
        optimizations: [],
        sizeBefore: 1000000000,
        sizeAfter: 800000000,
        reductionPercent: 20,
        buildTime: 45,
        createdAt: recentDate,
        metadata: {
          size: 800000000,
          layers: 4,
          architecture: 'amd64',
          os: 'linux',
          created: recentDate,
          lastUsed: recentDate,
          usageCount: 2,
          buildTime: 45,
          optimizationScore: 40,
          tags: ['recent']
        }
      };

      (imageOptimizer as any).optimizedImages.set('old-image:latest', oldOptimization);
      (imageOptimizer as any).optimizedImages.set('recent-image:latest', recentOptimization);
    });

    it('should cleanup old optimizations', async () => {
      const maxAge = 168; // 1 week in hours
      const removedCount = await imageOptimizer.cleanupOptimizations(maxAge);

      expect(removedCount).toBe(1); // Should remove the old optimization
      expect(imageOptimizer.getOptimizedImage('old-image:latest')).toBeUndefined();
      expect(imageOptimizer.getOptimizedImage('recent-image:latest')).toBeDefined();
    });

    it('should remove specific optimized image', () => {
      const result = imageOptimizer.removeOptimizedImage('recent-image:latest');

      expect(result).toBe(true);
      expect(imageOptimizer.getOptimizedImage('recent-image:latest')).toBeUndefined();
    });

    it('should return false when removing non-existent optimization', () => {
      const result = imageOptimizer.removeOptimizedImage('non-existent:latest');

      expect(result).toBe(false);
    });
  });

  describe('Utility Functions', () => {
    it('should parse size strings correctly', () => {
      const parseSize = (imageOptimizer as any).parseSize;

      expect(parseSize('1024B')).toBe(1024);
      expect(parseSize('1KB')).toBe(1024);
      expect(parseSize('1MB')).toBe(1024 * 1024);
      expect(parseSize('1GB')).toBe(1024 * 1024 * 1024);
      expect(parseSize('invalid')).toBe(0);
    });

    it('should compare values correctly', () => {
      const compareValues = (imageOptimizer as any).compareValues;

      expect(compareValues(1000000000, '500MB')).toBeGreaterThan(0);
      expect(compareValues(500000000, '1GB')).toBeLessThan(0);
      expect(compareValues(1073741824, '1GB')).toBe(0);
      expect(compareValues(10, 5)).toBe(5);
      expect(compareValues('abc', 'def')).toBeLessThan(0);
    });

    it('should calculate optimization score correctly', () => {
      const calculateOptimizationScore = (imageOptimizer as any).calculateOptimizationScore;

      expect(calculateOptimizationScore(1000, 800)).toBe(20); // 20% reduction
      expect(calculateOptimizationScore(1000, 500)).toBe(50); // 50% reduction
      expect(calculateOptimizationScore(0, 0)).toBe(0); // No reduction possible
      expect(calculateOptimizationScore(1000, 1000)).toBe(0); // No reduction
    });

    it('should generate unique optimization IDs', () => {
      const generateId1 = (imageOptimizer as any).generateOptimizationId('image1:latest');
      const generateId2 = (imageOptimizer as any).generateOptimizationId('image1:latest');

      expect(generateId1).toBeDefined();
      expect(generateId2).toBeDefined();
      expect(generateId1).not.toBe(generateId2); // Should be unique due to timestamp
      expect(generateId1.length).toBe(16);
      expect(generateId2.length).toBe(16);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing image gracefully', async () => {
      const imageId = 'non-existent:latest';
      
      mockDockerClient.getImageInfo.mockResolvedValue(null);

      await expect(imageOptimizer.optimizeImage(imageId)).rejects.toThrow('Image not found');
    });

    it('should handle build failures gracefully', async () => {
      const imageId = 'test-image:latest';
      const mockImageInfo = {
        id: imageId,
        size: 1000000000,
        architecture: 'amd64',
        os: 'linux'
      };

      mockDockerClient.getImageInfo.mockResolvedValue(mockImageInfo);
      mockDockerClient.getImageHistory.mockResolvedValue([]);
      mockDockerClient.buildImage.mockRejectedValue(new Error('Build failed'));

      // Should handle the error and continue with other optimizations
      const result = await imageOptimizer.optimizeImage(imageId);
      
      expect(result).toBeDefined();
      expect(result.optimizations.length).toBe(0); // No successful optimizations
    });

    it('should handle file system errors gracefully', async () => {
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      const dockerfile = 'FROM ubuntu:latest';
      const tag = 'test-image';

      await expect(
        (imageOptimizer as any).buildOptimizedImage(dockerfile, tag)
      ).rejects.toThrow('Permission denied');
    });
  });
});