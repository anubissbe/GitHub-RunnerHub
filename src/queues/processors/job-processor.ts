import { Job } from 'bullmq';
import { JobType } from '../config/redis-config';
import { logger } from '../../utils/logger';
import { DockerService } from '../../services/docker-service';
import { GitHubService } from '../../services/github-service';
import { DatabaseService } from '../../services/database-service';

export class JobProcessor {
  static async process(job: Job): Promise<any> {
    const { type, data } = job.data;
    logger.info(`Processing job ${job.id} of type ${type}`);
    
    try {
      switch (type) {
        case JobType.EXECUTE_WORKFLOW:
          return await JobProcessor.executeWorkflow(job, data);
          
        case JobType.PREPARE_RUNNER:
          return await JobProcessor.prepareRunner(job, data);
          
        case JobType.CLEANUP_RUNNER:
          return await JobProcessor.cleanupRunner(job, data);
          
        default:
          throw new Error(`Unknown job type: ${type}`);
      }
    } catch (error) {
      logger.error(`Error processing job ${job.id}:`, error);
      throw error;
    }
  }
  
  private static async executeWorkflow(job: Job, data: any): Promise<any> {
    const { workflowId, repository, runId, jobName } = data;
    
    // Update job progress
    await job.updateProgress(10);
    
    try {
      // 1. Prepare execution environment
      logger.info(`Preparing execution environment for workflow ${workflowId}`);
      const dockerService = DockerService.getInstance();
      
      // 2. Create container for job execution
      await job.updateProgress(30);
      const containerId = await dockerService.createJobContainer({
        repository,
        workflowId,
        runId,
        jobName,
        environment: data.environment || {}
      });
      
      // 3. Execute the workflow
      await job.updateProgress(50);
      logger.info(`Executing workflow ${workflowId} in container ${containerId}`);
      
      const result = await dockerService.executeJob(containerId, {
        commands: data.commands || [],
        timeout: data.timeout || 3600000, // 1 hour default
        workingDirectory: data.workingDirectory
      });
      
      // 4. Collect artifacts and logs
      await job.updateProgress(80);
      const artifacts = await dockerService.collectArtifacts(containerId);
      
      // 5. Update database with results
      await job.updateProgress(90);
      const db = DatabaseService.getInstance();
      await db.updateJobStatus(runId, {
        status: 'completed',
        result: result.exitCode === 0 ? 'success' : 'failure',
        completedAt: new Date(),
        logs: result.logs,
        artifacts
      });
      
      // 6. Cleanup
      await job.updateProgress(100);
      await dockerService.removeContainer(containerId);
      
      return {
        success: true,
        containerId,
        exitCode: result.exitCode,
        duration: result.duration,
        artifactsCount: artifacts.length
      };
    } catch (error) {
      logger.error(`Workflow execution failed for ${workflowId}:`, error);
      
      // Update job status in database
      const db = DatabaseService.getInstance();
      await db.updateJobStatus(runId, {
        status: 'failed',
        result: 'failure',
        completedAt: new Date(),
        error: error.message
      });
      
      throw error;
    }
  }
  
  private static async prepareRunner(job: Job, data: any): Promise<any> {
    const { runnerId, labels, workDirectory } = data;
    
    try {
      await job.updateProgress(20);
      
      // 1. Validate runner configuration
      const githubService = GitHubService.getInstance();
      const _runnerConfig = await githubService.getRunnerConfig(runnerId);
      
      await job.updateProgress(40);
      
      // 2. Prepare working directory
      const dockerService = DockerService.getInstance();
      await dockerService.prepareRunnerWorkspace({
        runnerId,
        workDirectory: workDirectory || `/tmp/runner-${runnerId}`,
        cleanExisting: true
      });
      
      await job.updateProgress(60);
      
      // 3. Pull required Docker images
      const images = data.requiredImages || ['node:20', 'python:3.11'];
      for (const image of images) {
        await dockerService.pullImage(image);
      }
      
      await job.updateProgress(80);
      
      // 4. Update runner status
      const db = DatabaseService.getInstance();
      await db.updateRunnerStatus(runnerId, {
        status: 'ready',
        preparedAt: new Date(),
        labels,
        capabilities: {
          docker: true,
          kubernetes: false,
          customImages: images
        }
      });
      
      await job.updateProgress(100);
      
      return {
        success: true,
        runnerId,
        workDirectory,
        preparedImages: images
      };
    } catch (error) {
      logger.error(`Runner preparation failed for ${runnerId}:`, error);
      throw error;
    }
  }
  
  private static async cleanupRunner(job: Job, data: any): Promise<any> {
    const { runnerId, force = false } = data;
    
    try {
      await job.updateProgress(20);
      
      // 1. Stop any running containers
      const dockerService = DockerService.getInstance();
      const containers = await dockerService.getRunnerContainers(runnerId);
      
      await job.updateProgress(40);
      
      for (const container of containers) {
        if (force) {
          await dockerService.forceRemoveContainer(container.id);
        } else {
          await dockerService.stopContainer(container.id);
          await dockerService.removeContainer(container.id);
        }
      }
      
      await job.updateProgress(60);
      
      // 2. Clean up workspace
      await dockerService.cleanupRunnerWorkspace(runnerId);
      
      await job.updateProgress(80);
      
      // 3. Update runner status
      const db = DatabaseService.getInstance();
      await db.updateRunnerStatus(runnerId, {
        status: 'offline',
        cleanedAt: new Date()
      });
      
      await job.updateProgress(100);
      
      return {
        success: true,
        runnerId,
        containersRemoved: containers.length
      };
    } catch (error) {
      logger.error(`Runner cleanup failed for ${runnerId}:`, error);
      throw error;
    }
  }
}