import { Job } from 'bullmq';
import { JobType } from '../config/redis-config';
import { logger } from '../../utils/logger';
import { DockerService } from '../../services/docker-service';
import { DatabaseService } from '../../services/database-service';
import { QueueManager } from '../queue-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

export class CleanupProcessor {
  static async process(job: Job): Promise<any> {
    const { type, data } = job.data;
    logger.info(`Processing cleanup job ${job.id} of type ${type}`);
    
    try {
      switch (type) {
        case JobType.CLEANUP_OLD_JOBS:
          return await CleanupProcessor.cleanupOldJobs(job, data);
          
        case JobType.CLEANUP_CONTAINERS:
          return await CleanupProcessor.cleanupContainers(job, data);
          
        case JobType.CLEANUP_LOGS:
          return await CleanupProcessor.cleanupLogs(job, data);
          
        default:
          throw new Error(`Unknown cleanup job type: ${type}`);
      }
    } catch (error) {
      logger.error(`Error processing cleanup job ${job.id}:`, error);
      throw error;
    }
  }
  
  private static async cleanupOldJobs(job: Job, data: any): Promise<any> {
    const { 
      maxAge = 7 * 24 * 60 * 60 * 1000, // 7 days default
      batchSize = 100,
      cleanQueues = true,
      cleanDatabase = true
    } = data;
    
    try {
      await job.updateProgress(10);
      
      const cutoffDate = new Date(Date.now() - maxAge);
      const results: Record<string, number> = {};
      
      // 1. Clean up old jobs from queues
      if (cleanQueues) {
        await job.updateProgress(30);
        const queueManager = QueueManager.getInstance();
        
        for (const queueName of Object.values(QUEUE_CONFIG.queues)) {
          const queue = queueManager.getQueue(queueName);
          if (queue) {
            // Clean completed jobs
            const completedJobs = await queue.clean(maxAge, batchSize, 'completed');
            results[`${queueName}_completed`] = completedJobs.length;
            
            // Clean failed jobs (keep them longer - 30 days)
            const failedJobs = await queue.clean(maxAge * 4, batchSize, 'failed');
            results[`${queueName}_failed`] = failedJobs.length;
          }
        }
      }
      
      // 2. Clean up old job records from database
      if (cleanDatabase) {
        await job.updateProgress(60);
        const db = DatabaseService.getInstance();
        
        // Delete old completed jobs
        const deletedCompleted = await db.deleteOldJobs({
          status: 'completed',
          before: cutoffDate,
          limit: batchSize
        });
        results.database_completed = deletedCompleted;
        
        // Delete old failed jobs (keep them longer)
        const deletedFailed = await db.deleteOldJobs({
          status: 'failed',
          before: new Date(Date.now() - maxAge * 4),
          limit: batchSize
        });
        results.database_failed = deletedFailed;
      }
      
      await job.updateProgress(90);
      
      // 3. Log cleanup summary
      const totalCleaned = Object.values(results).reduce((sum, count) => sum + count, 0);
      logger.info(`Cleaned up ${totalCleaned} old jobs`, results);
      
      await job.updateProgress(100);
      
      return {
        success: true,
        cutoffDate,
        results,
        totalCleaned
      };
    } catch (error) {
      logger.error('Old jobs cleanup failed:', error);
      throw error;
    }
  }
  
  private static async cleanupContainers(job: Job, data: any): Promise<any> {
    const { 
      maxAge = 24 * 60 * 60 * 1000, // 24 hours default
      includeExited = true,
      includeDead = true,
      preserveLabels = ['com.github-runnerhub.preserve=true']
    } = data;
    
    try {
      await job.updateProgress(10);
      
      const dockerService = DockerService.getInstance();
      const cutoffDate = new Date(Date.now() - maxAge);
      
      // 1. List all containers
      const containers = await dockerService.listContainers({
        all: true,
        filters: {
          label: ['com.github-runnerhub.managed=true']
        }
      });
      
      await job.updateProgress(30);
      
      const results = {
        examined: containers.length,
        removed: 0,
        preserved: 0,
        errors: 0
      };
      
      // 2. Process each container
      for (const container of containers) {
        try {
          // Check if container should be preserved
          const shouldPreserve = preserveLabels.some(label => {
            const [key, value] = label.split('=');
            return container.Labels[key] === value;
          });
          
          if (shouldPreserve) {
            results.preserved++;
            continue;
          }
          
          // Check container state and age
          const containerInfo = await dockerService.inspectContainer(container.Id);
          const finishedAt = containerInfo.State.FinishedAt;
          
          if (finishedAt && new Date(finishedAt) < cutoffDate) {
            // Container is old enough to remove
            if (containerInfo.State.Status === 'exited' && includeExited) {
              await dockerService.removeContainer(container.Id, { v: true });
              results.removed++;
            } else if (containerInfo.State.Status === 'dead' && includeDead) {
              await dockerService.removeContainer(container.Id, { v: true, force: true });
              results.removed++;
            }
          }
        } catch (error) {
          logger.error(`Error processing container ${container.Id}:`, error);
          results.errors++;
        }
        
        // Update progress
        const progress = 30 + (60 * (results.removed + results.preserved + results.errors) / containers.length);
        await job.updateProgress(Math.min(90, progress));
      }
      
      // 3. Clean up dangling volumes
      const volumes = await dockerService.pruneVolumes();
      
      await job.updateProgress(100);
      
      logger.info('Container cleanup completed', results);
      
      return {
        success: true,
        cutoffDate,
        results,
        volumesRemoved: volumes.VolumesDeleted?.length || 0,
        spaceReclaimed: volumes.SpaceReclaimed || 0
      };
    } catch (error) {
      logger.error('Container cleanup failed:', error);
      throw error;
    }
  }
  
  private static async cleanupLogs(job: Job, data: any): Promise<any> {
    const { 
      maxAge = 30 * 24 * 60 * 60 * 1000, // 30 days default
      maxSize = 100 * 1024 * 1024, // 100MB default
      logDirectories = [
        '/var/log/github-runnerhub',
        '/tmp/runner-logs'
      ],
      patterns = ['*.log', '*.txt', '*.out']
    } = data;
    
    try {
      await job.updateProgress(10);
      
      const cutoffDate = new Date(Date.now() - maxAge);
      const results = {
        filesExamined: 0,
        filesDeleted: 0,
        bytesReclaimed: 0,
        errors: 0
      };
      
      // Process each log directory
      for (let i = 0; i < logDirectories.length; i++) {
        const directory = logDirectories[i];
        
        try {
          // Check if directory exists
          await fs.access(directory);
          
          // Get all files in directory
          const files = await CleanupProcessor.getLogFiles(directory, patterns);
          results.filesExamined += files.length;
          
          // Process each file
          for (const file of files) {
            try {
              const stats = await fs.stat(file);
              
              // Check if file should be deleted
              if (stats.mtime < cutoffDate || stats.size > maxSize) {
                await fs.unlink(file);
                results.filesDeleted++;
                results.bytesReclaimed += stats.size;
              }
            } catch (error) {
              logger.error(`Error processing log file ${file}:`, error);
              results.errors++;
            }
          }
        } catch (error) {
          logger.warn(`Log directory ${directory} not accessible:`, error);
        }
        
        // Update progress
        const progress = 10 + (80 * (i + 1) / logDirectories.length);
        await job.updateProgress(progress);
      }
      
      // Clean up empty directories
      for (const directory of logDirectories) {
        try {
          await CleanupProcessor.removeEmptyDirectories(directory);
        } catch (error) {
          logger.warn(`Could not clean empty directories in ${directory}:`, error);
        }
      }
      
      await job.updateProgress(100);
      
      logger.info('Log cleanup completed', results);
      
      return {
        success: true,
        cutoffDate,
        results,
        bytesReclaimedMB: Math.round(results.bytesReclaimed / (1024 * 1024))
      };
    } catch (error) {
      logger.error('Log cleanup failed:', error);
      throw error;
    }
  }
  
  private static async getLogFiles(directory: string, patterns: string[]): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        
        if (entry.isDirectory()) {
          // Recursively get files from subdirectories
          const subFiles = await CleanupProcessor.getLogFiles(fullPath, patterns);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          // Check if file matches any pattern
          const matches = patterns.some(pattern => {
            const regex = new RegExp(pattern.replace('*', '.*'));
            return regex.test(entry.name);
          });
          
          if (matches) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      logger.error(`Error reading directory ${directory}:`, error);
    }
    
    return files;
  }
  
  private static async removeEmptyDirectories(directory: string): Promise<void> {
    try {
      const entries = await fs.readdir(directory);
      
      if (entries.length === 0) {
        // Directory is empty, remove it
        await fs.rmdir(directory);
        logger.debug(`Removed empty directory: ${directory}`);
      } else {
        // Check subdirectories
        for (const entry of entries) {
          const fullPath = path.join(directory, entry);
          const stats = await fs.stat(fullPath);
          
          if (stats.isDirectory()) {
            await CleanupProcessor.removeEmptyDirectories(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore errors for directory removal
    }
  }
}

const QUEUE_CONFIG = {
  queues: {
    JOB_EXECUTION: 'job-execution',
    CONTAINER_MANAGEMENT: 'container-management',
    MONITORING: 'monitoring',
    CLEANUP: 'cleanup',
    WEBHOOK_PROCESSING: 'webhook-processing',
    METRICS_COLLECTION: 'metrics-collection'
  }
};