import { Job } from 'bullmq';
import { JobType } from '../config/redis-config';
import { logger } from '../../utils/logger';
import { DockerService } from '../../services/docker-service';
import { DatabaseService } from '../../services/database-service';
import { ContainerHealthChecker } from '../../services/container-health-checker';

export class ContainerProcessor {
  static async process(job: Job): Promise<any> {
    const { type, data } = job.data;
    logger.info(`Processing container job ${job.id} of type ${type}`);
    
    try {
      switch (type) {
        case JobType.CREATE_CONTAINER:
          return await ContainerProcessor.createContainer(job, data);
          
        case JobType.DESTROY_CONTAINER:
          return await ContainerProcessor.destroyContainer(job, data);
          
        case JobType.HEALTH_CHECK:
          return await ContainerProcessor.healthCheck(job, data);
          
        default:
          throw new Error(`Unknown container job type: ${type}`);
      }
    } catch (error) {
      logger.error(`Error processing container job ${job.id}:`, error);
      throw error;
    }
  }
  
  private static async createContainer(job: Job, data: any): Promise<any> {
    const { name, image, config, labels, purpose } = data;
    
    try {
      await job.updateProgress(10);
      
      const dockerService = DockerService.getInstance();
      
      // 1. Check if image exists locally
      const imageExists = await dockerService.imageExists(image);
      if (!imageExists) {
        await job.updateProgress(20);
        logger.info(`Pulling image ${image}...`);
        await dockerService.pullImage(image);
      }
      
      await job.updateProgress(40);
      
      // 2. Create container with configuration
      const containerConfig = {
        Image: image,
        name: name || `runner-${Date.now()}`,
        Labels: {
          'com.github-runnerhub.managed': 'true',
          'com.github-runnerhub.purpose': purpose || 'job-execution',
          'com.github-runnerhub.created': new Date().toISOString(),
          ...labels
        },
        HostConfig: {
          AutoRemove: false,
          RestartPolicy: { Name: 'no' },
          ...config?.hostConfig
        },
        Env: data.environment || [],
        ...config
      };
      
      const container = await dockerService.createContainer(containerConfig);
      const containerId = container.id;
      
      await job.updateProgress(60);
      
      // 3. Start container if requested
      if (data.autoStart !== false) {
        await dockerService.startContainer(containerId);
      }
      
      await job.updateProgress(80);
      
      // 4. Store container info in database
      const db = DatabaseService.getInstance();
      await db.createContainerRecord({
        containerId,
        name: containerConfig.name,
        image,
        purpose: purpose || 'job-execution',
        status: data.autoStart !== false ? 'running' : 'created',
        createdAt: new Date(),
        metadata: {
          labels,
          config: config || {}
        }
      });
      
      await job.updateProgress(100);
      
      return {
        success: true,
        containerId,
        name: containerConfig.name,
        status: data.autoStart !== false ? 'running' : 'created'
      };
    } catch (error) {
      logger.error(`Container creation failed:`, error);
      throw error;
    }
  }
  
  private static async destroyContainer(job: Job, data: any): Promise<any> {
    const { containerId, force = false, removeVolumes = true } = data;
    
    try {
      await job.updateProgress(20);
      
      const dockerService = DockerService.getInstance();
      
      // 1. Get container info
      const containerInfo = await dockerService.inspectContainer(containerId);
      if (!containerInfo) {
        throw new Error(`Container ${containerId} not found`);
      }
      
      await job.updateProgress(40);
      
      // 2. Stop container if running
      if (containerInfo.State.Running) {
        if (force) {
          await dockerService.killContainer(containerId);
        } else {
          await dockerService.stopContainer(containerId, { timeout: 30 });
        }
      }
      
      await job.updateProgress(60);
      
      // 3. Remove container
      await dockerService.removeContainer(containerId, { v: removeVolumes });
      
      await job.updateProgress(80);
      
      // 4. Update database
      const db = DatabaseService.getInstance();
      await db.updateContainerRecord(containerId, {
        status: 'removed',
        removedAt: new Date()
      });
      
      await job.updateProgress(100);
      
      return {
        success: true,
        containerId,
        wasRunning: containerInfo.State.Running,
        forcedStop: force
      };
    } catch (error) {
      logger.error(`Container destruction failed for ${containerId}:`, error);
      throw error;
    }
  }
  
  private static async healthCheck(job: Job, data: any): Promise<any> {
    const { containerId, checks = ['basic', 'network', 'filesystem'] } = data;
    
    try {
      await job.updateProgress(10);
      
      const dockerService = DockerService.getInstance();
      const healthChecker = ContainerHealthChecker.getInstance();
      
      // 1. Check if container exists and is running
      const containerInfo = await dockerService.inspectContainer(containerId);
      if (!containerInfo) {
        throw new Error(`Container ${containerId} not found`);
      }
      
      if (!containerInfo.State.Running) {
        return {
          success: false,
          containerId,
          healthy: false,
          reason: 'Container not running',
          checks: {}
        };
      }
      
      await job.updateProgress(30);
      
      // 2. Perform health checks
      const healthResults: Record<string, any> = {};
      
      if (checks.includes('basic')) {
        healthResults.basic = await healthChecker.checkBasicHealth(containerId);
      }
      
      await job.updateProgress(50);
      
      if (checks.includes('network')) {
        healthResults.network = await healthChecker.checkNetworkHealth(containerId);
      }
      
      await job.updateProgress(70);
      
      if (checks.includes('filesystem')) {
        healthResults.filesystem = await healthChecker.checkFilesystemHealth(containerId);
      }
      
      if (checks.includes('resources')) {
        healthResults.resources = await healthChecker.checkResourceUsage(containerId);
      }
      
      await job.updateProgress(90);
      
      // 3. Determine overall health
      const isHealthy = Object.values(healthResults).every(result => result.healthy);
      
      // 4. Update database
      const db = DatabaseService.getInstance();
      await db.updateContainerHealth(containerId, {
        healthy: isHealthy,
        lastChecked: new Date(),
        checkResults: healthResults
      });
      
      await job.updateProgress(100);
      
      return {
        success: true,
        containerId,
        healthy: isHealthy,
        checks: healthResults,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error(`Health check failed for container ${containerId}:`, error);
      throw error;
    }
  }
}