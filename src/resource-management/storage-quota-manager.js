/**
 * Storage Quota Management System
 * Comprehensive storage control, monitoring, and enforcement for containers
 */

const EventEmitter = require('events');
const Docker = require('dockerode');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const logger = require('../utils/logger');

class StorageQuotaManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Storage quota configuration
      quotas: {
        defaultQuota: options.defaultQuota || '10g',
        minQuota: options.minQuota || '100m',
        maxQuota: options.maxQuota || '100g',
        volumeQuota: options.volumeQuota || '5g',
        tmpfsQuota: options.tmpfsQuota || '1g',
        workspaceQuota: options.workspaceQuota || '20g'
      },
      
      // Storage profiles
      profiles: {
        micro: {
          diskQuota: '500m',
          volumeQuota: '100m',
          tmpfsQuota: '50m',
          inodeQuota: 10000
        },
        small: {
          diskQuota: '2g',
          volumeQuota: '500m',
          tmpfsQuota: '200m',
          inodeQuota: 50000
        },
        medium: {
          diskQuota: '10g',
          volumeQuota: '2g',
          tmpfsQuota: '500m',
          inodeQuota: 100000
        },
        large: {
          diskQuota: '20g',
          volumeQuota: '5g',
          tmpfsQuota: '1g',
          inodeQuota: 200000
        },
        xlarge: {
          diskQuota: '50g',
          volumeQuota: '10g',
          tmpfsQuota: '2g',
          inodeQuota: 500000
        },
        ...options.customProfiles
      },
      
      // Monitoring configuration
      monitoring: {
        enabled: options.monitoringEnabled !== false,
        checkInterval: options.checkInterval || 30000, // 30 seconds
        usageThreshold: options.usageThreshold || 0.8, // 80%
        criticalThreshold: options.criticalThreshold || 0.95, // 95%
        enableAlerts: options.enableAlerts !== false
      },
      
      // Enforcement configuration
      enforcement: {
        enabled: options.enforcementEnabled !== false,
        softLimit: options.softLimit || 0.9, // 90% warning
        hardLimit: options.hardLimit || 1.0, // 100% enforcement
        gracePeriod: options.gracePeriod || 300000, // 5 minutes
        blockOnViolation: options.blockOnViolation !== false,
        cleanupOnViolation: options.cleanupOnViolation !== false
      },
      
      // Cleanup configuration
      cleanup: {
        enabled: options.cleanupEnabled !== false,
        cleanupInterval: options.cleanupInterval || 3600000, // 1 hour
        tempFileAge: options.tempFileAge || 86400000, // 24 hours
        cacheFileAge: options.cacheFileAge || 604800000, // 7 days
        logFileAge: options.logFileAge || 2592000000, // 30 days
        preservePatterns: options.preservePatterns || []
      },
      
      // Storage paths
      paths: {
        containerRoot: options.containerRoot || '/var/lib/docker/containers',
        volumeRoot: options.volumeRoot || '/var/lib/docker/volumes',
        tempRoot: options.tempRoot || '/tmp',
        workspaceRoot: options.workspaceRoot || '/workspace'
      },
      
      ...options
    };
    
    // Docker client
    this.docker = new Docker();
    
    // Storage tracking
    this.containerQuotas = new Map(); // containerId -> quota info
    this.storageUsage = new Map(); // containerId -> usage metrics
    this.violationHistory = new Map(); // containerId -> violations
    
    // Volume tracking
    this.volumeQuotas = new Map(); // volumeName -> quota
    this.volumeUsage = new Map(); // volumeName -> usage
    
    // Statistics
    this.stats = {
      totalContainersManaged: 0,
      totalQuotaViolations: 0,
      totalCleanupOperations: 0,
      totalSpaceReclaimed: 0,
      profileUsage: new Map(),
      avgDiskUsage: 0,
      peakDiskUsage: 0,
      currentTotalUsage: 0
    };
    
    this.monitoringTimer = null;
    this.cleanupTimer = null;
    this.isStarted = false;
  }

  /**
   * Start storage quota manager
   */
  start() {
    if (this.isStarted) {
      logger.warn('Storage quota manager already started');
      return;
    }
    
    logger.info('Starting Storage Quota Manager');
    
    // Start monitoring
    if (this.config.monitoring.enabled) {
      this.monitoringTimer = setInterval(() => {
        this.monitorStorageUsage().catch(error => {
          logger.error('Storage monitoring failed:', error);
        });
      }, this.config.monitoring.checkInterval);
    }
    
    // Start cleanup
    if (this.config.cleanup.enabled) {
      this.cleanupTimer = setInterval(() => {
        this.performStorageCleanup().catch(error => {
          logger.error('Storage cleanup failed:', error);
        });
      }, this.config.cleanup.cleanupInterval);
    }
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Storage quota manager started');
  }

  /**
   * Stop storage quota manager
   */
  stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Storage Quota Manager');
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Storage quota manager stopped');
  }

  /**
   * Apply storage quota to container
   */
  async applyStorageQuota(containerId, requirements = {}) {
    try {
      // Determine storage profile
      const profile = this.determineStorageProfile(requirements);
      
      // Calculate quota limits
      const quotaLimits = this.calculateQuotaLimits(profile, requirements);
      
      // Apply container storage limits
      await this.applyContainerStorageLimits(containerId, quotaLimits);
      
      // Track quota
      this.containerQuotas.set(containerId, {
        limits: quotaLimits,
        profile: profile.name,
        appliedAt: new Date(),
        requirements,
        violations: 0,
        warnings: 0
      });
      
      // Initialize usage tracking
      this.storageUsage.set(containerId, {
        disk: { used: 0, limit: quotaLimits.disk },
        inodes: { used: 0, limit: quotaLimits.inodes },
        volumes: new Map(),
        lastCheck: new Date()
      });
      
      this.stats.totalContainersManaged++;
      this.updateProfileUsage(profile.name);
      
      logger.info(`Applied storage quota to container ${containerId.substring(0, 12)}: ${profile.name} profile`);
      
      this.emit('quotaApplied', {
        containerId,
        profile: profile.name,
        limits: quotaLimits
      });
      
      return quotaLimits;
      
    } catch (error) {
      logger.error(`Failed to apply storage quota to container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Determine storage profile based on requirements
   */
  determineStorageProfile(requirements) {
    // Check for explicit profile
    if (requirements.profile && this.config.profiles[requirements.profile]) {
      return {
        name: requirements.profile,
        ...this.config.profiles[requirements.profile]
      };
    }
    
    // Auto-select profile based on requirements
    const requiredDisk = this.parseStorageValue(requirements.diskSpace || '10g');
    
    // Find best matching profile
    let selectedProfile = null;
    let selectedName = 'medium'; // default
    
    for (const [name, profile] of Object.entries(this.config.profiles)) {
      const profileDisk = this.parseStorageValue(profile.diskQuota);
      
      if (profileDisk >= requiredDisk) {
        if (!selectedProfile || profileDisk < this.parseStorageValue(selectedProfile.diskQuota)) {
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
   * Calculate quota limits
   */
  calculateQuotaLimits(profile, requirements) {
    const limits = {
      disk: this.parseStorageValue(requirements.diskQuota || profile.diskQuota || this.config.quotas.defaultQuota),
      volumes: this.parseStorageValue(requirements.volumeQuota || profile.volumeQuota || this.config.quotas.volumeQuota),
      tmpfs: this.parseStorageValue(requirements.tmpfsQuota || profile.tmpfsQuota || this.config.quotas.tmpfsQuota),
      inodes: requirements.inodeQuota || profile.inodeQuota || 100000,
      
      // Additional limits
      maxFileSize: requirements.maxFileSize ? this.parseStorageValue(requirements.maxFileSize) : null,
      maxOpenFiles: requirements.maxOpenFiles || 1000,
      
      // Directory-specific quotas
      directories: {
        workspace: this.parseStorageValue(requirements.workspaceQuota || this.config.quotas.workspaceQuota),
        temp: this.parseStorageValue(requirements.tempQuota || '1g'),
        cache: this.parseStorageValue(requirements.cacheQuota || '2g')
      }
    };
    
    // Apply bounds
    this.applyQuotaBounds(limits);
    
    return limits;
  }

  /**
   * Apply bounds to quota limits
   */
  applyQuotaBounds(limits) {
    const minQuota = this.parseStorageValue(this.config.quotas.minQuota);
    const maxQuota = this.parseStorageValue(this.config.quotas.maxQuota);
    
    limits.disk = Math.max(minQuota, Math.min(maxQuota, limits.disk));
    limits.volumes = Math.max(minQuota, Math.min(limits.disk, limits.volumes));
    limits.tmpfs = Math.max(minQuota / 10, Math.min(limits.disk / 2, limits.tmpfs));
    
    // Ensure directory quotas don't exceed disk quota
    for (const [dir, quota] of Object.entries(limits.directories)) {
      limits.directories[dir] = Math.min(quota, limits.disk);
    }
  }

  /**
   * Apply container storage limits
   */
  async applyContainerStorageLimits(containerId, limits) {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Get container info
      const info = await container.inspect();
      
      // Apply disk quota using device mapper or overlay2 storage driver limits
      await this.applyDiskQuota(containerId, info, limits.disk);
      
      // Apply tmpfs limits
      if (limits.tmpfs > 0) {
        await this.applyTmpfsLimits(container, limits.tmpfs);
      }
      
      // Apply inode limits if supported
      if (limits.inodes > 0) {
        await this.applyInodeLimits(containerId, limits.inodes);
      }
      
      // Set up directory quotas
      await this.setupDirectoryQuotas(containerId, limits.directories);
      
      logger.debug(`Applied storage limits to container ${containerId.substring(0, 12)}`);
      
    } catch (error) {
      logger.error(`Failed to apply container storage limits:`, error);
      throw error;
    }
  }

  /**
   * Apply disk quota to container
   */
  async applyDiskQuota(containerId, containerInfo, quotaBytes) {
    try {
      const storageDriver = containerInfo.Driver || 'overlay2';
      
      switch (storageDriver) {
        case 'overlay2':
        case 'overlay':
          // Use project quotas for overlay filesystems
          await this.applyOverlayQuota(containerId, containerInfo, quotaBytes);
          break;
          
        case 'devicemapper':
          // Use device mapper thin provisioning
          await this.applyDeviceMapperQuota(containerId, quotaBytes);
          break;
          
        case 'btrfs':
          // Use btrfs subvolume quotas
          await this.applyBtrfsQuota(containerId, containerInfo, quotaBytes);
          break;
          
        case 'zfs':
          // Use ZFS dataset quotas
          await this.applyZfsQuota(containerId, containerInfo, quotaBytes);
          break;
          
        default:
          logger.warn(`Unsupported storage driver for quotas: ${storageDriver}`);
      }
      
    } catch (error) {
      logger.error('Failed to apply disk quota:', error);
      throw error;
    }
  }

  /**
   * Apply overlay filesystem quota
   */
  async applyOverlayQuota(containerId, containerInfo, quotaBytes) {
    try {
      const upperDir = containerInfo.GraphDriver?.Data?.UpperDir;
      if (!upperDir) {
        throw new Error('Unable to find container upper directory');
      }
      
      // Check if filesystem supports project quotas
      const { stdout: mountInfo } = await execAsync(`findmnt -n -o FSTYPE,OPTIONS ${upperDir}`);
      
      if (mountInfo.includes('xfs') && mountInfo.includes('prjquota')) {
        // Use XFS project quotas
        await this.applyXfsProjectQuota(upperDir, containerId, quotaBytes);
      } else if (mountInfo.includes('ext4') && mountInfo.includes('quota')) {
        // Use ext4 quotas
        await this.applyExt4Quota(upperDir, containerId, quotaBytes);
      } else {
        // Fallback to directory size monitoring
        logger.warn('Filesystem does not support quotas, using monitoring-based enforcement');
      }
      
    } catch (error) {
      logger.error('Failed to apply overlay quota:', error);
      throw error;
    }
  }

  /**
   * Apply XFS project quota
   */
  async applyXfsProjectQuota(path, containerId, quotaBytes) {
    try {
      // Generate project ID from container ID
      const projectId = this.generateProjectId(containerId);
      
      // Set project ID on directory
      await execAsync(`xfs_quota -x -c "project -s -p ${path} ${projectId}" /`);
      
      // Set project quota
      const quotaBlocks = Math.ceil(quotaBytes / 1024); // Convert to KB
      await execAsync(`xfs_quota -x -c "limit -p bhard=${quotaBlocks}k ${projectId}" /`);
      
      logger.debug(`Applied XFS project quota ${projectId} to ${path}`);
      
    } catch (error) {
      logger.error('Failed to apply XFS project quota:', error);
      throw error;
    }
  }

  /**
   * Apply tmpfs limits
   */
  async applyTmpfsLimits(container, tmpfsBytes) {
    try {
      // Update container with tmpfs mounts
      await container.update({
        HostConfig: {
          Tmpfs: {
            '/tmp': `size=${tmpfsBytes},mode=1777`,
            '/var/tmp': `size=${Math.floor(tmpfsBytes / 2)},mode=1777`
          }
        }
      });
      
    } catch (error) {
      logger.error('Failed to apply tmpfs limits:', error);
      // Non-critical error
    }
  }

  /**
   * Apply inode limits
   */
  async applyInodeLimits(containerId, inodeLimit) {
    // Store inode limit for monitoring-based enforcement
    const usage = this.storageUsage.get(containerId);
    if (usage) {
      usage.inodes.limit = inodeLimit;
    }
  }

  /**
   * Setup directory quotas
   */
  async setupDirectoryQuotas(containerId, directoryQuotas) {
    // Store directory quotas for monitoring-based enforcement
    const quotaInfo = this.containerQuotas.get(containerId);
    if (quotaInfo) {
      quotaInfo.limits.directories = directoryQuotas;
    }
  }

  /**
   * Remove storage quota from container
   */
  async removeStorageQuota(containerId) {
    try {
      const quotaInfo = this.containerQuotas.get(containerId);
      if (!quotaInfo) {
        logger.warn(`No storage quota found for container ${containerId}`);
        return;
      }
      
      // Clean up any project quotas
      await this.cleanupContainerQuotas(containerId, quotaInfo);
      
      // Remove tracking
      this.containerQuotas.delete(containerId);
      this.storageUsage.delete(containerId);
      this.violationHistory.delete(containerId);
      
      logger.info(`Removed storage quota from container ${containerId.substring(0, 12)}`);
      
      this.emit('quotaRemoved', { containerId });
      
    } catch (error) {
      logger.error(`Failed to remove storage quota:`, error);
    }
  }

  /**
   * Monitor storage usage
   */
  async monitorStorageUsage() {
    try {
      const monitoringTasks = [];
      
      // Monitor container storage
      for (const [containerId, quotaInfo] of this.containerQuotas) {
        monitoringTasks.push(this.monitorContainerStorage(containerId, quotaInfo));
      }
      
      // Monitor volume storage
      for (const [volumeName, quota] of this.volumeQuotas) {
        monitoringTasks.push(this.monitorVolumeStorage(volumeName, quota));
      }
      
      await Promise.allSettled(monitoringTasks);
      
      // Update statistics
      this.updateStorageStatistics();
      
      // Check for alerts
      if (this.config.monitoring.enableAlerts) {
        this.checkStorageAlerts();
      }
      
    } catch (error) {
      logger.error('Storage monitoring failed:', error);
    }
  }

  /**
   * Monitor container storage
   */
  async monitorContainerStorage(containerId, quotaInfo) {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Get container info
      const info = await container.inspect();
      if (!info.State.Running) {
        return;
      }
      
      // Get storage usage
      const usage = await this.getContainerStorageUsage(containerId, info);
      
      // Update usage tracking
      this.storageUsage.set(containerId, {
        ...usage,
        lastCheck: new Date()
      });
      
      // Check for violations
      await this.checkStorageViolations(containerId, usage, quotaInfo.limits);
      
    } catch (error) {
      logger.debug(`Failed to monitor container ${containerId} storage:`, error);
    }
  }

  /**
   * Get container storage usage
   */
  async getContainerStorageUsage(containerId, containerInfo) {
    try {
      const usage = {
        disk: { used: 0, limit: 0 },
        inodes: { used: 0, limit: 0 },
        directories: {},
        volumes: new Map()
      };
      
      // Get root filesystem usage
      const upperDir = containerInfo.GraphDriver?.Data?.UpperDir;
      if (upperDir) {
        const diskUsage = await this.getDirectoryUsage(upperDir);
        usage.disk.used = diskUsage.bytes;
        usage.inodes.used = diskUsage.inodes;
      }
      
      // Get volume usage
      if (containerInfo.Mounts) {
        for (const mount of containerInfo.Mounts) {
          if (mount.Type === 'volume') {
            const volumeUsage = await this.getVolumeUsage(mount.Name);
            usage.volumes.set(mount.Name, volumeUsage);
          }
        }
      }
      
      // Get directory-specific usage
      const directories = ['workspace', 'temp', 'cache'];
      for (const dir of directories) {
        const dirPath = path.join(upperDir || '', dir);
        try {
          const dirUsage = await this.getDirectoryUsage(dirPath);
          usage.directories[dir] = dirUsage.bytes;
        } catch (error) {
          // Directory might not exist
          usage.directories[dir] = 0;
        }
      }
      
      return usage;
      
    } catch (error) {
      logger.error('Failed to get container storage usage:', error);
      return {
        disk: { used: 0, limit: 0 },
        inodes: { used: 0, limit: 0 },
        directories: {},
        volumes: new Map()
      };
    }
  }

  /**
   * Get directory usage
   */
  async getDirectoryUsage(dirPath) {
    try {
      const { stdout } = await execAsync(`du -sb "${dirPath}" 2>/dev/null || echo "0"`);
      const bytes = parseInt(stdout.split('\t')[0]) || 0;
      
      // Get inode count
      const { stdout: inodeOutput } = await execAsync(`find "${dirPath}" -type f 2>/dev/null | wc -l || echo "0"`);
      const inodes = parseInt(inodeOutput.trim()) || 0;
      
      return { bytes, inodes };
      
    } catch (error) {
      return { bytes: 0, inodes: 0 };
    }
  }

  /**
   * Get volume usage
   */
  async getVolumeUsage(volumeName) {
    try {
      const volume = this.docker.getVolume(volumeName);
      const volumeInfo = await volume.inspect();
      
      if (volumeInfo.Mountpoint) {
        const usage = await this.getDirectoryUsage(volumeInfo.Mountpoint);
        return {
          name: volumeName,
          used: usage.bytes,
          mountpoint: volumeInfo.Mountpoint
        };
      }
      
      return { name: volumeName, used: 0 };
      
    } catch (error) {
      return { name: volumeName, used: 0 };
    }
  }

  /**
   * Check storage violations
   */
  async checkStorageViolations(containerId, usage, limits) {
    const violations = [];
    
    // Check disk usage
    if (usage.disk.used > limits.disk) {
      violations.push({
        type: 'disk',
        used: usage.disk.used,
        limit: limits.disk,
        percentage: (usage.disk.used / limits.disk) * 100
      });
    }
    
    // Check inode usage
    if (usage.inodes.used > limits.inodes) {
      violations.push({
        type: 'inodes',
        used: usage.inodes.used,
        limit: limits.inodes,
        percentage: (usage.inodes.used / limits.inodes) * 100
      });
    }
    
    // Check directory quotas
    for (const [dir, limit] of Object.entries(limits.directories || {})) {
      const used = usage.directories[dir] || 0;
      if (used > limit) {
        violations.push({
          type: 'directory',
          directory: dir,
          used,
          limit,
          percentage: (used / limit) * 100
        });
      }
    }
    
    if (violations.length > 0) {
      await this.handleStorageViolations(containerId, violations);
    }
    
    // Check for warnings
    await this.checkStorageWarnings(containerId, usage, limits);
  }

  /**
   * Handle storage violations
   */
  async handleStorageViolations(containerId, violations) {
    try {
      // Update violation history
      const history = this.violationHistory.get(containerId) || [];
      history.push({
        timestamp: new Date(),
        violations
      });
      
      // Keep limited history
      if (history.length > 100) {
        history.shift();
      }
      
      this.violationHistory.set(containerId, history);
      
      // Update quota info
      const quotaInfo = this.containerQuotas.get(containerId);
      if (quotaInfo) {
        quotaInfo.violations++;
      }
      
      this.stats.totalQuotaViolations++;
      
      logger.warn(`Storage violations detected for container ${containerId.substring(0, 12)}:`, violations);
      
      // Take enforcement action
      if (this.config.enforcement.enabled) {
        await this.enforceStorageQuota(containerId, violations);
      }
      
      this.emit('storageViolation', {
        containerId,
        violations,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error(`Failed to handle storage violations:`, error);
    }
  }

  /**
   * Check storage warnings
   */
  async checkStorageWarnings(containerId, usage, limits) {
    const warnings = [];
    const warningThreshold = this.config.monitoring.usageThreshold;
    
    // Check disk usage warning
    const diskPercentage = usage.disk.used / limits.disk;
    if (diskPercentage > warningThreshold && diskPercentage <= 1) {
      warnings.push({
        type: 'disk',
        message: `Disk usage at ${(diskPercentage * 100).toFixed(1)}% of quota`,
        percentage: diskPercentage * 100
      });
    }
    
    // Check inode warning
    const inodePercentage = usage.inodes.used / limits.inodes;
    if (inodePercentage > warningThreshold && inodePercentage <= 1) {
      warnings.push({
        type: 'inodes',
        message: `Inode usage at ${(inodePercentage * 100).toFixed(1)}% of quota`,
        percentage: inodePercentage * 100
      });
    }
    
    if (warnings.length > 0) {
      const quotaInfo = this.containerQuotas.get(containerId);
      if (quotaInfo) {
        quotaInfo.warnings++;
      }
      
      this.emit('storageWarning', {
        containerId,
        warnings,
        timestamp: new Date()
      });
    }
  }

  /**
   * Enforce storage quota
   */
  async enforceStorageQuota(containerId, violations) {
    try {
      const quotaInfo = this.containerQuotas.get(containerId);
      if (!quotaInfo) return;
      
      // Check if in grace period
      const violationAge = Date.now() - (quotaInfo.firstViolation || Date.now());
      if (!quotaInfo.firstViolation) {
        quotaInfo.firstViolation = Date.now();
      }
      
      if (violationAge < this.config.enforcement.gracePeriod) {
        logger.info(`Container ${containerId.substring(0, 12)} in grace period for storage violations`);
        return;
      }
      
      // Take enforcement action
      if (this.config.enforcement.blockOnViolation) {
        await this.blockContainerWrites(containerId);
      }
      
      if (this.config.enforcement.cleanupOnViolation) {
        await this.performContainerCleanup(containerId, violations);
      }
      
      this.emit('storageEnforcement', {
        containerId,
        action: 'enforced',
        violations
      });
      
    } catch (error) {
      logger.error(`Failed to enforce storage quota:`, error);
    }
  }

  /**
   * Block container writes
   */
  async blockContainerWrites(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Make filesystem read-only
      await container.update({
        HostConfig: {
          ReadonlyRootfs: true
        }
      });
      
      logger.warn(`Blocked writes for container ${containerId.substring(0, 12)} due to quota violation`);
      
    } catch (error) {
      logger.error(`Failed to block container writes:`, error);
    }
  }

  /**
   * Perform container cleanup
   */
  async performContainerCleanup(containerId, violations) {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      
      let reclaimedSpace = 0;
      
      // Clean temp files
      if (violations.some(v => v.type === 'disk' || (v.type === 'directory' && v.directory === 'temp'))) {
        reclaimedSpace += await this.cleanTempFiles(containerId, info);
      }
      
      // Clean cache files
      if (violations.some(v => v.type === 'disk' || (v.type === 'directory' && v.directory === 'cache'))) {
        reclaimedSpace += await this.cleanCacheFiles(containerId, info);
      }
      
      // Clean old log files
      reclaimedSpace += await this.cleanOldLogs(containerId, info);
      
      this.stats.totalCleanupOperations++;
      this.stats.totalSpaceReclaimed += reclaimedSpace;
      
      logger.info(`Cleaned up ${this.formatStorage(reclaimedSpace)} from container ${containerId.substring(0, 12)}`);
      
      this.emit('storageCleanup', {
        containerId,
        reclaimedSpace,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error(`Failed to perform container cleanup:`, error);
    }
  }

  /**
   * Clean temp files
   */
  async cleanTempFiles(containerId, containerInfo) {
    try {
      const tempPaths = ['/tmp', '/var/tmp', '/temp'];
      let totalReclaimed = 0;
      
      for (const tempPath of tempPaths) {
        const { stdout } = await execAsync(
          `docker exec ${containerId} find ${tempPath} -type f -atime +1 -delete -print 2>/dev/null | wc -l || echo "0"`
        );
        
        const filesDeleted = parseInt(stdout.trim()) || 0;
        if (filesDeleted > 0) {
          logger.debug(`Deleted ${filesDeleted} old temp files from ${tempPath}`);
        }
      }
      
      return totalReclaimed;
      
    } catch (error) {
      logger.error('Failed to clean temp files:', error);
      return 0;
    }
  }

  /**
   * Clean cache files
   */
  async cleanCacheFiles(containerId, containerInfo) {
    try {
      const cachePaths = [
        '/var/cache',
        '/.cache',
        '/root/.cache',
        '/home/*/.cache'
      ];
      
      let totalReclaimed = 0;
      
      for (const cachePath of cachePaths) {
        try {
          await execAsync(
            `docker exec ${containerId} find ${cachePath} -type f -atime +7 -delete 2>/dev/null || true`
          );
        } catch (error) {
          // Ignore errors for non-existent paths
        }
      }
      
      return totalReclaimed;
      
    } catch (error) {
      logger.error('Failed to clean cache files:', error);
      return 0;
    }
  }

  /**
   * Clean old log files
   */
  async cleanOldLogs(containerId, containerInfo) {
    try {
      const logPaths = [
        '/var/log',
        '/logs'
      ];
      
      let totalReclaimed = 0;
      
      for (const logPath of logPaths) {
        try {
          // Truncate large log files
          await execAsync(
            `docker exec ${containerId} find ${logPath} -type f -name "*.log" -size +100M -exec truncate -s 0 {} \; 2>/dev/null || true`
          );
          
          // Delete old log files
          await execAsync(
            `docker exec ${containerId} find ${logPath} -type f -name "*.log.*" -mtime +30 -delete 2>/dev/null || true`
          );
        } catch (error) {
          // Ignore errors for non-existent paths
        }
      }
      
      return totalReclaimed;
      
    } catch (error) {
      logger.error('Failed to clean old logs:', error);
      return 0;
    }
  }

  /**
   * Perform storage cleanup
   */
  async performStorageCleanup() {
    try {
      logger.info('Performing scheduled storage cleanup');
      
      let totalReclaimed = 0;
      
      // Clean up stopped containers
      totalReclaimed += await this.cleanupStoppedContainers();
      
      // Clean up unused volumes
      totalReclaimed += await this.cleanupUnusedVolumes();
      
      // Clean up dangling images
      totalReclaimed += await this.cleanupDanglingImages();
      
      // Clean up build cache
      totalReclaimed += await this.cleanupBuildCache();
      
      this.stats.totalSpaceReclaimed += totalReclaimed;
      
      logger.info(`Storage cleanup completed. Reclaimed: ${this.formatStorage(totalReclaimed)}`);
      
      this.emit('cleanupCompleted', {
        reclaimedSpace: totalReclaimed,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error('Storage cleanup failed:', error);
    }
  }

  /**
   * Cleanup stopped containers
   */
  async cleanupStoppedContainers() {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { status: ['exited'] }
      });
      
      let reclaimed = 0;
      
      for (const containerInfo of containers) {
        // Skip recently stopped containers
        const exitTime = new Date(containerInfo.State === 'exited' ? containerInfo.Status : 0);
        if (Date.now() - exitTime < 3600000) continue; // 1 hour
        
        try {
          const container = this.docker.getContainer(containerInfo.Id);
          await container.remove({ v: true });
          reclaimed += containerInfo.SizeRw || 0;
        } catch (error) {
          logger.debug(`Failed to remove container ${containerInfo.Id}:`, error);
        }
      }
      
      return reclaimed;
      
    } catch (error) {
      logger.error('Failed to cleanup stopped containers:', error);
      return 0;
    }
  }

  /**
   * Cleanup unused volumes
   */
  async cleanupUnusedVolumes() {
    try {
      const { stdout } = await execAsync('docker volume prune -f --filter "label!=keep" 2>&1 || echo "0"');
      
      // Parse reclaimed space from output
      const match = stdout.match(/(\d+(?:\.\d+)?)(\s*[KMGT]?B)/i);
      if (match) {
        return this.parseStorageValue(match[1] + match[2]);
      }
      
      return 0;
      
    } catch (error) {
      logger.error('Failed to cleanup unused volumes:', error);
      return 0;
    }
  }

  /**
   * Cleanup dangling images
   */
  async cleanupDanglingImages() {
    try {
      const { stdout } = await execAsync('docker image prune -f 2>&1 || echo "0"');
      
      // Parse reclaimed space from output
      const match = stdout.match(/(\d+(?:\.\d+)?)(\s*[KMGT]?B)/i);
      if (match) {
        return this.parseStorageValue(match[1] + match[2]);
      }
      
      return 0;
      
    } catch (error) {
      logger.error('Failed to cleanup dangling images:', error);
      return 0;
    }
  }

  /**
   * Cleanup build cache
   */
  async cleanupBuildCache() {
    try {
      const { stdout } = await execAsync('docker builder prune -f --filter "until=24h" 2>&1 || echo "0"');
      
      // Parse reclaimed space from output
      const match = stdout.match(/(\d+(?:\.\d+)?)(\s*[KMGT]?B)/i);
      if (match) {
        return this.parseStorageValue(match[1] + match[2]);
      }
      
      return 0;
      
    } catch (error) {
      logger.error('Failed to cleanup build cache:', error);
      return 0;
    }
  }

  /**
   * Monitor volume storage
   */
  async monitorVolumeStorage(volumeName, quota) {
    try {
      const usage = await this.getVolumeUsage(volumeName);
      
      this.volumeUsage.set(volumeName, {
        ...usage,
        limit: quota,
        percentage: (usage.used / quota) * 100,
        lastCheck: new Date()
      });
      
      // Check for violations
      if (usage.used > quota) {
        this.emit('volumeQuotaExceeded', {
          volumeName,
          used: usage.used,
          limit: quota,
          percentage: (usage.used / quota) * 100
        });
      }
      
    } catch (error) {
      logger.debug(`Failed to monitor volume ${volumeName}:`, error);
    }
  }

  /**
   * Update storage statistics
   */
  updateStorageStatistics() {
    let totalUsage = 0;
    let containerCount = 0;
    
    for (const [containerId, usage] of this.storageUsage) {
      totalUsage += usage.disk.used;
      containerCount++;
    }
    
    this.stats.currentTotalUsage = totalUsage;
    this.stats.avgDiskUsage = containerCount > 0 ? totalUsage / containerCount : 0;
    this.stats.peakDiskUsage = Math.max(this.stats.peakDiskUsage, totalUsage);
  }

  /**
   * Check storage alerts
   */
  checkStorageAlerts() {
    const alerts = [];
    
    // Check container storage alerts
    for (const [containerId, usage] of this.storageUsage) {
      const quotaInfo = this.containerQuotas.get(containerId);
      if (!quotaInfo) continue;
      
      const diskPercentage = usage.disk.used / quotaInfo.limits.disk;
      
      if (diskPercentage > this.config.monitoring.criticalThreshold) {
        alerts.push({
          type: 'critical',
          containerId,
          message: `Container ${containerId.substring(0, 12)} disk usage critical: ${(diskPercentage * 100).toFixed(1)}%`,
          usage: usage.disk.used,
          limit: quotaInfo.limits.disk
        });
      } else if (diskPercentage > this.config.monitoring.usageThreshold) {
        alerts.push({
          type: 'warning',
          containerId,
          message: `Container ${containerId.substring(0, 12)} disk usage high: ${(diskPercentage * 100).toFixed(1)}%`,
          usage: usage.disk.used,
          limit: quotaInfo.limits.disk
        });
      }
    }
    
    if (alerts.length > 0) {
      this.emit('storageAlerts', {
        alerts,
        timestamp: new Date()
      });
    }
  }

  /**
   * Clean up container quotas
   */
  async cleanupContainerQuotas(containerId, quotaInfo) {
    try {
      // Clean up any project quotas
      const projectId = this.generateProjectId(containerId);
      await execAsync(`xfs_quota -x -c "limit -p bhard=0 ${projectId}" / 2>/dev/null || true`);
      
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Generate project ID from container ID
   */
  generateProjectId(containerId) {
    // Generate a numeric project ID from container ID hash
    let hash = 0;
    for (let i = 0; i < containerId.length; i++) {
      hash = ((hash << 5) - hash) + containerId.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 100000 + 10000; // Project IDs 10000-109999
  }

  /**
   * Update profile usage statistics
   */
  updateProfileUsage(profileName) {
    const current = this.stats.profileUsage.get(profileName) || 0;
    this.stats.profileUsage.set(profileName, current + 1);
  }

  /**
   * Parse storage value to bytes
   */
  parseStorageValue(value) {
    if (typeof value === 'number') return value;
    
    const match = String(value).match(/^(\d+(?:\.\d+)?)\s*([kmgt]?)b?$/i);
    if (!match) {
      throw new Error(`Invalid storage value: ${value}`);
    }
    
    const num = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    
    const multipliers = {
      '': 1,
      'k': 1024,
      'm': 1024 * 1024,
      'g': 1024 * 1024 * 1024,
      't': 1024 * 1024 * 1024 * 1024
    };
    
    return Math.floor(num * (multipliers[unit] || 1));
  }

  /**
   * Format storage value for display
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

  /**
   * Get storage quota status
   */
  getQuotaStatus(containerId) {
    const quotaInfo = this.containerQuotas.get(containerId);
    const usage = this.storageUsage.get(containerId);
    
    if (!quotaInfo || !usage) {
      return null;
    }
    
    return {
      containerId,
      profile: quotaInfo.profile,
      limits: quotaInfo.limits,
      usage: {
        disk: {
          used: usage.disk.used,
          limit: quotaInfo.limits.disk,
          percentage: (usage.disk.used / quotaInfo.limits.disk) * 100,
          formatted: {
            used: this.formatStorage(usage.disk.used),
            limit: this.formatStorage(quotaInfo.limits.disk)
          }
        },
        inodes: {
          used: usage.inodes.used,
          limit: quotaInfo.limits.inodes,
          percentage: (usage.inodes.used / quotaInfo.limits.inodes) * 100
        },
        directories: usage.directories,
        volumes: Array.from(usage.volumes.values())
      },
      violations: quotaInfo.violations,
      warnings: quotaInfo.warnings,
      appliedAt: quotaInfo.appliedAt,
      lastCheck: usage.lastCheck
    };
  }

  /**
   * Get storage manager statistics
   */
  getStatistics() {
    return {
      isStarted: this.isStarted,
      stats: {
        ...this.stats,
        profileUsage: Object.fromEntries(this.stats.profileUsage),
        avgDiskUsageFormatted: this.formatStorage(this.stats.avgDiskUsage),
        peakDiskUsageFormatted: this.formatStorage(this.stats.peakDiskUsage),
        currentTotalUsageFormatted: this.formatStorage(this.stats.currentTotalUsage),
        totalSpaceReclaimedFormatted: this.formatStorage(this.stats.totalSpaceReclaimed)
      },
      activeContainers: this.containerQuotas.size,
      activeVolumes: this.volumeQuotas.size,
      violationStats: {
        containersWithViolations: Array.from(this.containerQuotas.values())
          .filter(q => q.violations > 0).length,
        totalViolations: this.stats.totalQuotaViolations,
        recentViolations: Array.from(this.violationHistory.entries())
          .flatMap(([id, history]) => history.slice(-5))
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 10)
      },
      config: {
        quotas: this.config.quotas,
        profiles: Object.keys(this.config.profiles),
        monitoringEnabled: this.config.monitoring.enabled,
        enforcementEnabled: this.config.enforcement.enabled,
        cleanupEnabled: this.config.cleanup.enabled
      }
    };
  }
}

module.exports = StorageQuotaManager;