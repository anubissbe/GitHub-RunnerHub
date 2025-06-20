import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import database from './database';
import containerLifecycle, { ContainerInfo, ContainerState } from './container-lifecycle';
import monitoringService from './monitoring';
import networkIsolation from './network-isolation';

const logger = createLogger('ContainerCleanup');

export interface CleanupPolicy {
  id: string;
  name: string;
  enabled: boolean;
  type: 'idle' | 'failed' | 'orphaned' | 'expired';
  conditions: {
    idleTimeMinutes?: number;
    maxLifetimeHours?: number;
    maxRetries?: number;
    excludeLabels?: string[];
  };
  actions: {
    stopContainer: boolean;
    removeContainer: boolean;
    archiveLogs: boolean;
    notifyOnCleanup: boolean;
  };
  schedule?: string; // Cron expression
  lastRun?: Date;
  statistics?: {
    containersCleanedTotal: number;
    lastCleanupCount: number;
    diskSpaceReclaimed: number;
  };
}

export interface CleanupResult {
  timestamp: Date;
  policiesExecuted: number;
  containersInspected: number;
  containersCleaned: number;
  errors: number;
  diskSpaceReclaimed: number;
  details: CleanupDetail[];
}

export interface CleanupDetail {
  containerId: string;
  containerName: string;
  policy: string;
  reason: string;
  action: 'stopped' | 'removed' | 'skipped';
  error?: string;
}

export class ContainerCleanupService extends EventEmitter {
  private static instance: ContainerCleanupService;
  private cleanupPolicies: Map<string, CleanupPolicy> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastCleanupResult: CleanupResult | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): ContainerCleanupService {
    if (!ContainerCleanupService.instance) {
      ContainerCleanupService.instance = new ContainerCleanupService();
    }
    return ContainerCleanupService.instance;
  }

  /**
   * Initialize the cleanup service
   */
  async initialize(): Promise<void> {
    logger.info('Initializing container cleanup service');

    try {
      // Load cleanup policies
      await this.loadDefaultPolicies();

      // Start cleanup scheduler
      this.startCleanupScheduler();

      logger.info('Container cleanup service initialized', {
        policiesLoaded: this.cleanupPolicies.size
      });
    } catch (error) {
      logger.error('Failed to initialize container cleanup service', { error });
      throw error;
    }
  }

  /**
   * Load default cleanup policies
   */
  private async loadDefaultPolicies(): Promise<void> {
    const defaultPolicies: CleanupPolicy[] = [
      {
        id: 'idle-containers',
        name: 'Idle Container Cleanup',
        enabled: true,
        type: 'idle',
        conditions: {
          idleTimeMinutes: 30,
          excludeLabels: ['persistent', 'no-cleanup']
        },
        actions: {
          stopContainer: true,
          removeContainer: true,
          archiveLogs: true,
          notifyOnCleanup: false
        },
        statistics: {
          containersCleanedTotal: 0,
          lastCleanupCount: 0,
          diskSpaceReclaimed: 0
        }
      },
      {
        id: 'failed-containers',
        name: 'Failed Container Cleanup',
        enabled: true,
        type: 'failed',
        conditions: {
          maxRetries: 3,
          idleTimeMinutes: 10
        },
        actions: {
          stopContainer: true,
          removeContainer: true,
          archiveLogs: true,
          notifyOnCleanup: true
        },
        statistics: {
          containersCleanedTotal: 0,
          lastCleanupCount: 0,
          diskSpaceReclaimed: 0
        }
      },
      {
        id: 'orphaned-containers',
        name: 'Orphaned Container Cleanup',
        enabled: true,
        type: 'orphaned',
        conditions: {
          idleTimeMinutes: 60
        },
        actions: {
          stopContainer: true,
          removeContainer: true,
          archiveLogs: false,
          notifyOnCleanup: true
        },
        statistics: {
          containersCleanedTotal: 0,
          lastCleanupCount: 0,
          diskSpaceReclaimed: 0
        }
      },
      {
        id: 'expired-containers',
        name: 'Expired Container Cleanup',
        enabled: true,
        type: 'expired',
        conditions: {
          maxLifetimeHours: 24
        },
        actions: {
          stopContainer: true,
          removeContainer: true,
          archiveLogs: true,
          notifyOnCleanup: false
        },
        statistics: {
          containersCleanedTotal: 0,
          lastCleanupCount: 0,
          diskSpaceReclaimed: 0
        }
      }
    ];

    for (const policy of defaultPolicies) {
      this.cleanupPolicies.set(policy.id, policy);
    }
  }

  /**
   * Start the cleanup scheduler
   */
  private startCleanupScheduler(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(async () => {
      if (!this.isRunning) {
        await this.runCleanup();
      }
    }, 5 * 60 * 1000);

    // Run initial cleanup after 1 minute
    setTimeout(() => this.runCleanup(), 60000);
  }

  /**
   * Run cleanup process
   */
  async runCleanup(): Promise<CleanupResult> {
    if (this.isRunning) {
      logger.warn('Cleanup already in progress, skipping');
      return this.lastCleanupResult || this.createEmptyResult();
    }

    this.isRunning = true;
    const startTime = Date.now();
    const result: CleanupResult = {
      timestamp: new Date(),
      policiesExecuted: 0,
      containersInspected: 0,
      containersCleaned: 0,
      errors: 0,
      diskSpaceReclaimed: 0,
      details: []
    };

    try {
      logger.info('Starting container cleanup run');

      // Get all containers
      const containers = containerLifecycle.getAllContainers();
      result.containersInspected = containers.length;

      // Execute each enabled policy
      for (const [policyId, policy] of this.cleanupPolicies) {
        if (!policy.enabled) continue;

        try {
          const policyResult = await this.executePolicy(policy, containers);
          result.policiesExecuted++;
          result.containersCleaned += policyResult.cleaned;
          result.diskSpaceReclaimed += policyResult.diskSpaceReclaimed;
          result.details.push(...policyResult.details);
        } catch (error) {
          logger.error('Error executing cleanup policy', {
            policyId,
            error
          });
          result.errors++;
        }
      }

      // Update statistics
      await this.updateStatistics(result);

      // Emit cleanup event
      this.emit('cleanup-completed', result);

      // Record monitoring event
      monitoringService.recordCleanupEvent({
        containersInspected: result.containersInspected,
        containersCleaned: result.containersCleaned,
        diskSpaceReclaimed: result.diskSpaceReclaimed,
        duration: Date.now() - startTime
      });

      logger.info('Container cleanup completed', {
        containersInspected: result.containersInspected,
        containersCleaned: result.containersCleaned,
        diskSpaceReclaimed: result.diskSpaceReclaimed,
        duration: Date.now() - startTime
      });

      this.lastCleanupResult = result;
      return result;
    } catch (error) {
      logger.error('Container cleanup failed', { error });
      result.errors++;
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Execute a single cleanup policy
   */
  private async executePolicy(
    policy: CleanupPolicy,
    containers: ContainerInfo[]
  ): Promise<{
    cleaned: number;
    diskSpaceReclaimed: number;
    details: CleanupDetail[];
  }> {
    const result = {
      cleaned: 0,
      diskSpaceReclaimed: 0,
      details: [] as CleanupDetail[]
    };

    logger.debug('Executing cleanup policy', {
      policyId: policy.id,
      policyName: policy.name
    });

    for (const container of containers) {
      try {
        const shouldCleanup = await this.evaluateContainer(container, policy);

        if (shouldCleanup) {
          const detail = await this.cleanupContainer(container, policy);
          result.details.push(detail);

          if (detail.action !== 'skipped') {
            result.cleaned++;
            // Estimate disk space (simplified - in reality would check actual usage)
            result.diskSpaceReclaimed += 100 * 1024 * 1024; // 100MB estimate
          }
        }
      } catch (error) {
        logger.error('Error processing container for cleanup', {
          containerId: container.id,
          policyId: policy.id,
          error
        });

        result.details.push({
          containerId: container.id,
          containerName: container.name,
          policy: policy.name,
          reason: 'Error during evaluation',
          action: 'skipped',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Update policy statistics
    if (policy.statistics) {
      policy.statistics.lastCleanupCount = result.cleaned;
      policy.statistics.containersCleanedTotal += result.cleaned;
      policy.statistics.diskSpaceReclaimed += result.diskSpaceReclaimed;
    }
    policy.lastRun = new Date();

    return result;
  }

  /**
   * Evaluate if a container should be cleaned up based on policy
   */
  private async evaluateContainer(
    container: ContainerInfo,
    policy: CleanupPolicy
  ): Promise<boolean> {
    // Check if container has exclude labels
    // Note: In real implementation, we would get labels from Docker inspect
    // For now, we'll skip label-based exclusion
    if (policy.conditions.excludeLabels) {
      // TODO: Implement label checking via Docker API
      // This would require getting container details from Docker
      // For now, we'll proceed without label checking
    }

    const now = Date.now();

    switch (policy.type) {
      case 'idle':
        // Check if container is idle for specified time
        // Using started time as proxy for last activity
        if (container.state !== ContainerState.RUNNING || !container.started) {
          return false;
        }

        const idleTime = now - container.started.getTime();
        const idleThreshold = (policy.conditions.idleTimeMinutes || 30) * 60 * 1000;

        if (idleTime > idleThreshold && !container.jobId) {
          logger.info('Container idle for cleanup', {
            containerId: container.id,
            idleMinutes: Math.floor(idleTime / 60000)
          });
          return true;
        }
        break;

      case 'failed':
        // Check failed containers
        if (container.state === ContainerState.STOPPED && container.exitCode !== 0) {
          const stoppedTime = container.finished ? 
            now - container.finished.getTime() : 0;
          const threshold = (policy.conditions.idleTimeMinutes || 10) * 60 * 1000;

          if (stoppedTime > threshold) {
            logger.info('Failed container for cleanup', {
              containerId: container.id,
              exitCode: container.exitCode
            });
            return true;
          }
        }
        break;

      case 'orphaned':
        // Check for orphaned containers (no associated job or runner)
        if (!container.runnerId && !container.jobId) {
          const createdTime = now - container.created.getTime();
          const threshold = (policy.conditions.idleTimeMinutes || 60) * 60 * 1000;

          if (createdTime > threshold) {
            logger.info('Orphaned container for cleanup', {
              containerId: container.id
            });
            return true;
          }
        }
        break;

      case 'expired':
        // Check if container exceeded max lifetime
        const lifetime = now - container.created.getTime();
        const maxLifetime = (policy.conditions.maxLifetimeHours || 24) * 60 * 60 * 1000;

        if (lifetime > maxLifetime) {
          logger.info('Expired container for cleanup', {
            containerId: container.id,
            lifetimeHours: Math.floor(lifetime / 3600000)
          });
          return true;
        }
        break;
    }

    return false;
  }

  /**
   * Cleanup a single container
   */
  private async cleanupContainer(
    container: ContainerInfo,
    policy: CleanupPolicy
  ): Promise<CleanupDetail> {
    const detail: CleanupDetail = {
      containerId: container.id,
      containerName: container.name,
      policy: policy.name,
      reason: `${policy.type} container cleanup`,
      action: 'skipped'
    };

    try {
      // Archive logs if requested
      if (policy.actions.archiveLogs && container.state === ContainerState.RUNNING) {
        await this.archiveContainerLogs(container);
      }

      // Stop container if running
      if (policy.actions.stopContainer && container.state === ContainerState.RUNNING) {
        logger.info('Stopping container for cleanup', {
          containerId: container.id,
          policy: policy.name
        });

        await containerLifecycle.stopContainer(container.id);
        detail.action = 'stopped';
      }

      // Remove container
      if (policy.actions.removeContainer) {
        logger.info('Removing container', {
          containerId: container.id,
          policy: policy.name
        });

        // Detach from network if attached
        if (container.labels?.repository) {
          try {
            await networkIsolation.detachContainerFromNetwork(
              container.id,
              container.labels.repository
            );
            logger.info('Detached container from isolated network', {
              containerId: container.id,
              repository: container.labels.repository
            });
          } catch (error) {
            logger.warn('Failed to detach container from network', {
              containerId: container.id,
              error: (error as Error).message
            });
          }
        }

        await containerLifecycle.removeContainer(container.id);
        detail.action = 'removed';

        // Update database if container had associated runner
        if (container.runnerId) {
          await database.query(
            'UPDATE runnerhub.runners SET container_id = NULL WHERE id = $1',
            [container.runnerId]
          );
        }
      }

      // Send notification if requested
      if (policy.actions.notifyOnCleanup) {
        this.emit('container-cleaned', {
          container,
          policy: policy.name,
          reason: detail.reason
        });
      }

    } catch (error) {
      logger.error('Failed to cleanup container', {
        containerId: container.id,
        error
      });
      detail.error = error instanceof Error ? error.message : String(error);
    }

    return detail;
  }

  /**
   * Archive container logs before removal
   */
  private async archiveContainerLogs(container: ContainerInfo): Promise<void> {
    try {
      const logs = await containerLifecycle.getContainerLogs(container.id, {
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: 1000
      });

      // Store logs in database
      await database.query(
        `INSERT INTO runnerhub.archived_logs 
         (container_id, container_name, logs, created_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [container.id, container.name, logs]
      );

      logger.debug('Archived container logs', { containerId: container.id });
    } catch (error) {
      logger.error('Failed to archive container logs', {
        containerId: container.id,
        error
      });
    }
  }

  /**
   * Update cleanup statistics
   */
  private async updateStatistics(result: CleanupResult): Promise<void> {
    try {
      await database.query(
        `INSERT INTO runnerhub.cleanup_history 
         (timestamp, policies_executed, containers_inspected, 
          containers_cleaned, errors, disk_space_reclaimed)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          result.timestamp,
          result.policiesExecuted,
          result.containersInspected,
          result.containersCleaned,
          result.errors,
          result.diskSpaceReclaimed
        ]
      );
    } catch (error) {
      logger.error('Failed to update cleanup statistics', { error });
    }
  }

  /**
   * Get cleanup policies
   */
  getCleanupPolicies(): CleanupPolicy[] {
    return Array.from(this.cleanupPolicies.values());
  }

  /**
   * Update cleanup policy
   */
  async updatePolicy(
    policyId: string,
    updates: Partial<CleanupPolicy>
  ): Promise<CleanupPolicy> {
    const policy = this.cleanupPolicies.get(policyId);
    if (!policy) {
      throw new Error(`Policy ${policyId} not found`);
    }

    const updatedPolicy = { ...policy, ...updates };
    this.cleanupPolicies.set(policyId, updatedPolicy);

    logger.info('Updated cleanup policy', {
      policyId,
      updates
    });

    this.emit('policy-updated', updatedPolicy);
    return updatedPolicy;
  }

  /**
   * Get cleanup history
   */
  async getCleanupHistory(hours: number = 24): Promise<any[]> {
    const result = await database.query(
      `SELECT * FROM runnerhub.cleanup_history
       WHERE timestamp >= CURRENT_TIMESTAMP - INTERVAL '${hours} hours'
       ORDER BY timestamp DESC`
    );
    return result;
  }

  /**
   * Get last cleanup result
   */
  getLastCleanupResult(): CleanupResult | null {
    return this.lastCleanupResult;
  }

  /**
   * Manually trigger cleanup
   */
  async triggerCleanup(): Promise<CleanupResult> {
    logger.info('Manual cleanup triggered');
    return await this.runCleanup();
  }

  /**
   * Create empty result
   */
  private createEmptyResult(): CleanupResult {
    return {
      timestamp: new Date(),
      policiesExecuted: 0,
      containersInspected: 0,
      containersCleaned: 0,
      errors: 0,
      diskSpaceReclaimed: 0,
      details: []
    };
  }

  /**
   * Shutdown the cleanup service
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down container cleanup service');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.cleanupPolicies.clear();
  }
}

export default ContainerCleanupService.getInstance();