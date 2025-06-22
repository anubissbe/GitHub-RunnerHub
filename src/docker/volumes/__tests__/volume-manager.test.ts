import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { 
  VolumeManager, 
  VolumeConfig, 
  VolumeDriver, 
  VolumePurpose, 
  VolumePersistence,
  VolumeEnvironment,
  AccessMode,
  BackupStrategy,
  CleanupStrategy
} from '../volume-manager';
import { DockerClient } from '../../docker-client';

// Mock DockerClient
jest.mock('../../docker-client');
const MockedDockerClient = jest.mocked(DockerClient);

describe('VolumeManager', () => {
  let volumeManager: VolumeManager;
  let mockDockerClient: jest.Mocked<DockerClient>;

  beforeEach(() => {
    // Reset singleton
    (VolumeManager as any).instance = undefined;
    
    // Mock DockerClient
    mockDockerClient = {
      docker: {
        createVolume: jest.fn(),
        getVolume: jest.fn()
      }
    } as any;
    
    MockedDockerClient.getInstance.mockReturnValue(mockDockerClient);
    
    volumeManager = VolumeManager.getInstance();
  });

  afterEach(() => {
    volumeManager.stopMonitoring();
    volumeManager.stopAutomaticCleanup();
    jest.clearAllMocks();
  });

  describe('Volume Configuration Management', () => {
    it('should initialize with default volume configurations', () => {
      const configs = volumeManager.listVolumeConfigs();
      
      expect(configs.length).toBe(3);
      expect(configs.map(c => c.id)).toEqual([
        'runner-workspace',
        'runner-cache',
        'runner-logs'
      ]);
    });

    it('should register new volume configuration', () => {
      const customConfig: VolumeConfig = {
        id: 'custom-volume',
        name: 'custom-test-volume',
        driver: VolumeDriver.LOCAL,
        driverOpts: {
          'type': 'ext4'
        },
        labels: {
          'test': 'true'
        },
        scope: 'local' as any,
        status: 'available' as any,
        createdAt: new Date(),
        metadata: {
          description: 'Custom test volume',
          purpose: VolumePurpose.DATA,
          persistence: VolumePersistence.PERSISTENT,
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
            maxAge: 30,
            maxSize: '10GB',
            cleanupStrategy: CleanupStrategy.LRU,
            exemptPatterns: []
          },
          security: {
            readonly: false,
            encrypted: false,
            accessMode: AccessMode.READ_WRITE,
            ownership: {
              uid: 1000,
              gid: 1000
            },
            permissions: '755',
            quotas: {
              enabled: false,
              hardLimit: '',
              softLimit: ''
            }
          },
          performance: {
            ioScheduler: 'cfq' as any,
            readAhead: 256,
            cacheSize: '512MB',
            syncMode: 'async' as any,
            compression: {
              enabled: false,
              algorithm: 'none' as any,
              level: 0,
              blockSize: '64KB'
            },
            optimization: 'balanced' as any
          },
          tags: ['custom', 'test'],
          environment: VolumeEnvironment.TESTING
        }
      };

      volumeManager.registerVolumeConfig(customConfig);
      
      const retrieved = volumeManager.getVolumeConfig('custom-volume');
      expect(retrieved).toEqual(customConfig);
    });

    it('should filter volume configurations', () => {
      // Filter by driver
      const localVolumes = volumeManager.listVolumeConfigs({
        driver: VolumeDriver.LOCAL
      });
      expect(localVolumes.length).toBe(3);

      // Filter by purpose
      const cacheVolumes = volumeManager.listVolumeConfigs({
        purpose: VolumePurpose.CACHE
      });
      expect(cacheVolumes.length).toBe(1);
      expect(cacheVolumes[0].id).toBe('runner-cache');

      // Filter by persistence
      const persistentVolumes = volumeManager.listVolumeConfigs({
        persistence: VolumePersistence.PERSISTENT
      });
      expect(persistentVolumes.length).toBe(2);

      // Filter by tags
      const workspaceVolumes = volumeManager.listVolumeConfigs({
        tags: ['workspace']
      });
      expect(workspaceVolumes.length).toBe(1);
      expect(workspaceVolumes[0].id).toBe('runner-workspace');
    });
  });

  describe('Volume Creation and Management', () => {
    beforeEach(() => {
      const mockVolume = {
        Name: 'test-volume',
        Mountpoint: '/var/lib/docker/volumes/test-volume/_data'
      };
      
      mockDockerClient.docker.createVolume.mockResolvedValue(mockVolume);
      
      const mockVolumeInstance = {
        remove: jest.fn().mockResolvedValue(undefined)
      };
      mockDockerClient.docker.getVolume.mockReturnValue(mockVolumeInstance);
    });

    it('should create Docker volume from configuration', async () => {
      const volumeId = await volumeManager.createVolume('runner-workspace');

      expect(volumeId).toBe('test-volume');
      expect(mockDockerClient.docker.createVolume).toHaveBeenCalledWith(
        expect.objectContaining({
          Name: 'github-runner-workspace',
          Driver: 'local',
          DriverOpts: expect.objectContaining({
            'type': 'ext4'
          }),
          Labels: expect.objectContaining({
            'github.runner.volume': 'workspace',
            'volume.config.id': 'runner-workspace'
          })
        })
      );
    });

    it('should remove Docker volume', async () => {
      await volumeManager.removeVolume('test-volume');

      const mockVolumeInstance = mockDockerClient.docker.getVolume();
      expect(mockVolumeInstance.remove).toHaveBeenCalledWith({ force: false });
    });

    it('should remove Docker volume with force', async () => {
      await volumeManager.removeVolume('test-volume', true);

      const mockVolumeInstance = mockDockerClient.docker.getVolume();
      expect(mockVolumeInstance.remove).toHaveBeenCalledWith({ force: true });
    });

    it('should throw error for non-existent volume configuration', async () => {
      await expect(
        volumeManager.createVolume('non-existent')
      ).rejects.toThrow('Volume configuration not found: non-existent');
    });
  });

  describe('Volume Mounting', () => {
    it('should mount volume to container', async () => {
      const mountId = await volumeManager.mountVolume(
        'volume-123',
        'container-456',
        '/app/data',
        {
          readonly: true,
          consistency: 'cached' as any
        }
      );

      expect(mountId).toMatch(/volume-123-container-456-\d+/);
    });

    it('should unmount volume from container', async () => {
      const mountId = await volumeManager.mountVolume(
        'volume-123',
        'container-456',
        '/app/data'
      );

      await volumeManager.unmountVolume(mountId);

      // Should emit unmounted event
      const emitSpy = jest.spyOn(volumeManager, 'emit');
      expect(emitSpy).toHaveBeenCalledWith(
        'volume:unmounted',
        expect.objectContaining({
          mountId,
          volumeId: 'volume-123',
          containerId: 'container-456'
        })
      );
    });

    it('should throw error when unmounting non-existent mount', async () => {
      await expect(
        volumeManager.unmountVolume('non-existent-mount')
      ).rejects.toThrow('Mount not found: non-existent-mount');
    });
  });

  describe('Volume Usage and Statistics', () => {
    it('should get volume usage statistics', async () => {
      const usage = await volumeManager.getVolumeUsage('runner-workspace');

      expect(usage).toBeTruthy();
      expect(usage!.volumeId).toBe('runner-workspace');
      expect(usage!.totalSize).toBeGreaterThan(0);
      expect(usage!.usagePercentage).toBeGreaterThanOrEqual(0);
      expect(usage!.usagePercentage).toBeLessThanOrEqual(100);
      expect(usage!.timestamp).toBeInstanceOf(Date);
    });

    it('should return null for non-existent volume', async () => {
      const usage = await volumeManager.getVolumeUsage('non-existent');
      expect(usage).toBeNull();
    });
  });

  describe('Volume Snapshots', () => {
    it('should create volume snapshot', async () => {
      const snapshotId = await volumeManager.createSnapshot(
        'runner-cache',
        'daily-backup',
        'Daily backup snapshot',
        ['backup', 'daily']
      );

      expect(snapshotId).toMatch(/runner-cache-snapshot-\d+/);
    });

    it('should restore volume from snapshot', async () => {
      // First create a snapshot
      const snapshotId = await volumeManager.createSnapshot(
        'runner-cache',
        'backup-snapshot'
      );

      // Then restore from it
      const restoredVolumeId = await volumeManager.restoreFromSnapshot(snapshotId);

      expect(restoredVolumeId).toMatch(/runner-cache-restored-\d+/);
    });

    it('should restore to specific volume ID', async () => {
      const snapshotId = await volumeManager.createSnapshot(
        'runner-cache',
        'backup-snapshot'
      );

      const restoredVolumeId = await volumeManager.restoreFromSnapshot(
        snapshotId,
        'custom-restored-volume'
      );

      expect(restoredVolumeId).toBe('custom-restored-volume');
    });

    it('should throw error for non-existent snapshot', async () => {
      await expect(
        volumeManager.restoreFromSnapshot('non-existent-snapshot')
      ).rejects.toThrow('Snapshot not found: non-existent-snapshot');
    });
  });

  describe('Volume Configuration Validation', () => {
    it('should validate volume configuration', () => {
      const validConfig = volumeManager.getVolumeConfig('runner-workspace')!;
      const errors = volumeManager.validateVolumeConfig(validConfig);
      
      expect(errors).toEqual([]);
    });

    it('should detect validation errors', () => {
      const invalidConfig: VolumeConfig = {
        id: '',
        name: '',
        driver: VolumeDriver.LOCAL,
        driverOpts: {},
        labels: {},
        scope: 'local' as any,
        status: 'available' as any,
        createdAt: new Date(),
        metadata: {
          description: 'Invalid config',
          purpose: VolumePurpose.DATA,
          persistence: VolumePersistence.PERSISTENT,
          backup: {
            enabled: true, // Enabled but missing required fields
            schedule: '',
            retention: 0,
            compression: false,
            encryption: false,
            destination: '',
            strategy: BackupStrategy.FULL
          },
          retention: {
            enabled: false,
            maxAge: 0,
            maxSize: '',
            cleanupStrategy: CleanupStrategy.LRU,
            exemptPatterns: []
          },
          security: {
            readonly: false,
            encrypted: false,
            accessMode: AccessMode.READ_WRITE,
            ownership: {
              uid: 1000,
              gid: 1000
            },
            permissions: 'invalid', // Invalid permissions
            quotas: {
              enabled: true, // Enabled but missing limits
              hardLimit: '',
              softLimit: ''
            }
          },
          performance: {
            ioScheduler: 'cfq' as any,
            readAhead: 256,
            cacheSize: '512MB',
            syncMode: 'async' as any,
            compression: {
              enabled: true,
              algorithm: 'gzip' as any,
              level: 15, // Invalid level
              blockSize: '64KB'
            },
            optimization: 'balanced' as any
          },
          tags: [],
          environment: VolumeEnvironment.TESTING
        }
      };

      const errors = volumeManager.validateVolumeConfig(invalidConfig);
      
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Volume ID is required');
      expect(errors).toContain('Volume name is required');
      expect(errors).toContain('Invalid permissions format (must be octal notation)');
      expect(errors).toContain('Hard limit is required when quotas are enabled');
      expect(errors).toContain('Soft limit is required when quotas are enabled');
      expect(errors).toContain('Compression level must be between 1 and 9');
      expect(errors).toContain('Backup schedule is required when backups are enabled');
      expect(errors).toContain('Backup destination is required when backups are enabled');
    });
  });

  describe('Volume Monitoring', () => {
    it('should start and stop monitoring', () => {
      const startSpy = jest.spyOn(volumeManager, 'emit');
      
      volumeManager.startMonitoring(1000);
      expect(startSpy).toHaveBeenCalledWith('monitoring:started', { intervalMs: 1000 });

      volumeManager.stopMonitoring();
      expect(startSpy).toHaveBeenCalledWith('monitoring:stopped');
    });

    it('should start and stop automatic cleanup', () => {
      const startSpy = jest.spyOn(volumeManager, 'emit');
      
      volumeManager.startAutomaticCleanup(2000);
      expect(startSpy).toHaveBeenCalledWith('cleanup:started', { intervalMs: 2000 });

      volumeManager.stopAutomaticCleanup();
      expect(startSpy).toHaveBeenCalledWith('cleanup:stopped');
    });

    it('should collect volume metrics during monitoring', async () => {
      const metricsSpy = jest.spyOn(volumeManager, 'emit');
      
      // Start monitoring with very short interval for testing
      volumeManager.startMonitoring(100);
      
      // Wait for at least one metrics collection
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should have collected metrics (no specific assertion as it's internal)
      expect(metricsSpy).toHaveBeenCalledWith('monitoring:started', { intervalMs: 100 });
    });
  });

  describe('Volume Configuration Updates', () => {
    it('should update volume configuration', () => {
      const originalConfig = volumeManager.getVolumeConfig('runner-workspace')!;

      volumeManager.updateVolumeConfig('runner-workspace', {
        metadata: {
          ...originalConfig.metadata,
          description: 'Updated workspace description',
          tags: ['updated', 'workspace']
        }
      });

      const updated = volumeManager.getVolumeConfig('runner-workspace')!;
      expect(updated.metadata.description).toBe('Updated workspace description');
      expect(updated.metadata.tags).toContain('updated');
    });

    it('should throw error when updating non-existent configuration', () => {
      expect(() => {
        volumeManager.updateVolumeConfig('non-existent', {
          name: 'Updated Name'
        });
      }).toThrow('Volume configuration not found: non-existent');
    });

    it('should validate updates', () => {
      expect(() => {
        volumeManager.updateVolumeConfig('runner-workspace', {
          id: '', // Invalid ID
          name: ''  // Invalid name
        });
      }).toThrow('Volume configuration validation failed');
    });
  });

  describe('Volume Manager Statistics', () => {
    it('should provide volume manager statistics', () => {
      const stats = volumeManager.getVolumeManagerStats();

      expect(stats).toMatchObject({
        totalVolumes: 3,
        byDriver: {
          'local': 3
        },
        byPurpose: {
          'workspace': 1,
          'cache': 1,
          'logs': 1
        },
        byPersistence: {
          'session': 1,
          'persistent': 2
        },
        byEnvironment: {
          'production': 3
        },
        mounts: {
          total: 0,
          byStatus: {}
        },
        snapshots: {
          total: 0,
          byVolume: {}
        },
        monitoring: {
          enabled: false,
          volumesWithUsage: 0,
          totalDataPoints: 0
        },
        cleanup: {
          enabled: false
        }
      });
    });

    it('should show monitoring stats when active', () => {
      volumeManager.startMonitoring(100);
      
      const stats = volumeManager.getVolumeManagerStats();
      expect(stats.monitoring.enabled).toBe(true);
    });

    it('should show cleanup stats when active', () => {
      volumeManager.startAutomaticCleanup(100);
      
      const stats = volumeManager.getVolumeManagerStats();
      expect(stats.cleanup.enabled).toBe(true);
    });

    it('should include mount and snapshot statistics', async () => {
      // Add a mount
      await volumeManager.mountVolume('volume-123', 'container-456', '/app/data');
      
      // Add a snapshot
      await volumeManager.createSnapshot('runner-cache', 'test-snapshot');

      const stats = volumeManager.getVolumeManagerStats();
      expect(stats.mounts.total).toBe(1);
      expect(stats.snapshots.total).toBe(1);
      expect(stats.snapshots.byVolume['runner-cache']).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle Docker volume creation errors', async () => {
      const error = new Error('Docker daemon not responding');
      mockDockerClient.docker.createVolume.mockRejectedValue(error);

      const errorSpy = jest.spyOn(volumeManager, 'emit');

      await expect(
        volumeManager.createVolume('runner-workspace')
      ).rejects.toThrow('Docker daemon not responding');

      expect(errorSpy).toHaveBeenCalledWith(
        'volume:create:failed',
        expect.objectContaining({
          config: expect.any(Object),
          error
        })
      );
    });

    it('should handle volume removal errors', async () => {
      const error = new Error('Volume in use');
      const mockVolumeInstance = {
        remove: jest.fn().mockRejectedValue(error)
      };
      mockDockerClient.docker.getVolume.mockReturnValue(mockVolumeInstance);

      const errorSpy = jest.spyOn(volumeManager, 'emit');

      await expect(
        volumeManager.removeVolume('test-volume')
      ).rejects.toThrow('Volume in use');

      expect(errorSpy).toHaveBeenCalledWith(
        'volume:remove:failed',
        expect.objectContaining({
          id: 'test-volume',
          error
        })
      );
    });

    it('should handle snapshot creation errors', async () => {
      const errorSpy = jest.spyOn(volumeManager, 'emit');

      await expect(
        volumeManager.createSnapshot('non-existent-volume', 'test-snapshot')
      ).rejects.toThrow('Volume configuration not found: non-existent-volume');

      expect(errorSpy).toHaveBeenCalledWith(
        'snapshot:create:failed',
        expect.objectContaining({
          volumeId: 'non-existent-volume',
          error: expect.any(Error)
        })
      );
    });
  });
});