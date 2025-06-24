import { Job } from 'bullmq';
import { JobType } from '../config/redis-config';
import { logger } from '../../utils/logger';
import { GitHubService } from '../../services/github-service';
import { DatabaseService } from '../../services/database-service';
import { QueueManager } from '../queue-manager';
import { QUEUE_CONFIG } from '../config/redis-config';

export class WebhookProcessor {
  static async process(job: Job): Promise<any> {
    const { type, data } = job.data;
    logger.info(`Processing webhook job ${job.id} of type ${type}`);
    
    try {
      switch (type) {
        case JobType.PROCESS_WEBHOOK:
          return await WebhookProcessor.processWebhook(job, data);
          
        case JobType.SYNC_GITHUB_DATA:
          return await WebhookProcessor.syncGithubData(job, data);
          
        default:
          throw new Error(`Unknown webhook job type: ${type}`);
      }
    } catch (error) {
      logger.error(`Error processing webhook job ${job.id}:`, error);
      throw error;
    }
  }
  
  private static async processWebhook(job: Job, data: any): Promise<any> {
    const { event, payload, headers } = data;
    
    try {
      await job.updateProgress(10);
      
      const githubService = GitHubService.getInstance();
      const db = DatabaseService.getInstance();
      
      // 1. Validate webhook signature
      const isValid = await githubService.validateWebhookSignature(
        payload,
        headers['x-hub-signature-256']
      );
      
      if (!isValid) {
        throw new Error('Invalid webhook signature');
      }
      
      await job.updateProgress(20);
      
      // 2. Store webhook event
      await db.storeWebhookEvent({
        event,
        payload,
        receivedAt: new Date(),
        processed: false
      });
      
      await job.updateProgress(30);
      
      // 3. Process based on event type
      const queueManager = QueueManager.getInstance();
      
      switch (event) {
        case 'workflow_job':
          await WebhookProcessor.handleWorkflowJobEvent(job, payload, queueManager);
          break;
          
        case 'workflow_run':
          await WebhookProcessor.handleWorkflowRunEvent(job, payload, queueManager);
          break;
          
        case 'check_run':
          await WebhookProcessor.handleCheckRunEvent(job, payload, queueManager);
          break;
          
        case 'push':
          await WebhookProcessor.handlePushEvent(job, payload, queueManager);
          break;
          
        case 'pull_request':
          await WebhookProcessor.handlePullRequestEvent(job, payload, queueManager);
          break;
          
        case 'repository':
          await WebhookProcessor.handleRepositoryEvent(job, payload, queueManager);
          break;
          
        default:
          logger.info(`Unhandled webhook event type: ${event}`);
      }
      
      await job.updateProgress(90);
      
      // 4. Mark webhook as processed
      await db.updateWebhookEvent(payload.id, {
        processed: true,
        processedAt: new Date()
      });
      
      await job.updateProgress(100);
      
      return {
        success: true,
        event,
        processed: true
      };
    } catch (error) {
      logger.error(`Webhook processing failed for event ${event}:`, error);
      throw error;
    }
  }
  
  private static async handleWorkflowJobEvent(job: Job, payload: any, queueManager: QueueManager): Promise<void> {
    const { action, workflow_job, repository } = payload;
    
    await job.updateProgress(40);
    
    const db = DatabaseService.getInstance();
    
    switch (action) {
      case 'queued':
        // New job queued - prepare runner
        await queueManager.addJob(
          QUEUE_CONFIG.queues.JOB_EXECUTION,
          JobType.PREPARE_RUNNER,
          {
            type: JobType.PREPARE_RUNNER,
            data: {
              runnerId: workflow_job.runner_id,
              labels: workflow_job.labels,
              workDirectory: `/workspace/${repository.name}/${workflow_job.id}`
            }
          },
          { priority: QUEUE_CONFIG.priorities.HIGH }
        );
        
        await db.createJobRecord({
          jobId: workflow_job.id,
          runId: workflow_job.run_id,
          repository: repository.full_name,
          name: workflow_job.name,
          status: 'queued',
          labels: workflow_job.labels,
          createdAt: new Date(workflow_job.created_at)
        });
        break;
        
      case 'in_progress':
        // Job started - execute workflow
        await queueManager.addJob(
          QUEUE_CONFIG.queues.JOB_EXECUTION,
          JobType.EXECUTE_WORKFLOW,
          {
            type: JobType.EXECUTE_WORKFLOW,
            data: {
              workflowId: workflow_job.id,
              repository: repository.full_name,
              runId: workflow_job.run_id,
              jobName: workflow_job.name,
              commands: workflow_job.steps,
              environment: workflow_job.env
            }
          },
          { priority: QUEUE_CONFIG.priorities.CRITICAL }
        );
        
        await db.updateJobRecord(workflow_job.id, {
          status: 'in_progress',
          startedAt: new Date(workflow_job.started_at)
        });
        break;
        
      case 'completed':
        // Job completed - cleanup
        await queueManager.addJob(
          QUEUE_CONFIG.queues.JOB_EXECUTION,
          JobType.CLEANUP_RUNNER,
          {
            type: JobType.CLEANUP_RUNNER,
            data: {
              runnerId: workflow_job.runner_id,
              force: false
            }
          },
          { priority: QUEUE_CONFIG.priorities.LOW }
        );
        
        await db.updateJobRecord(workflow_job.id, {
          status: 'completed',
          conclusion: workflow_job.conclusion,
          completedAt: new Date(workflow_job.completed_at)
        });
        break;
    }
    
    await job.updateProgress(70);
  }
  
  private static async handleWorkflowRunEvent(job: Job, payload: any, queueManager: QueueManager): Promise<void> {
    const { action, workflow_run, repository } = payload;
    
    await job.updateProgress(40);
    
    const db = DatabaseService.getInstance();
    
    // Store or update workflow run
    await db.upsertWorkflowRun({
      runId: workflow_run.id,
      repository: repository.full_name,
      workflow: workflow_run.name,
      event: workflow_run.event,
      status: workflow_run.status,
      conclusion: workflow_run.conclusion,
      branch: workflow_run.head_branch,
      commit: workflow_run.head_sha,
      actor: workflow_run.actor.login,
      createdAt: new Date(workflow_run.created_at),
      updatedAt: new Date(workflow_run.updated_at)
    });
    
    // Queue monitoring update
    await queueManager.addJob(
      QUEUE_CONFIG.queues.MONITORING,
      JobType.UPDATE_STATUS,
      {
        type: JobType.UPDATE_STATUS,
        data: {
          component: `workflow_${workflow_run.id}`,
          status: workflow_run.status,
          message: `Workflow ${workflow_run.name} ${action}`,
          metadata: {
            repository: repository.full_name,
            conclusion: workflow_run.conclusion
          }
        }
      }
    );
    
    await job.updateProgress(70);
  }
  
  private static async handleCheckRunEvent(job: Job, payload: any, _queueManager: QueueManager): Promise<void> {
    const { check_run, repository } = payload;
    
    await job.updateProgress(40);
    
    const db = DatabaseService.getInstance();
    
    // Store check run data
    await db.upsertCheckRun({
      checkRunId: check_run.id,
      repository: repository.full_name,
      name: check_run.name,
      status: check_run.status,
      conclusion: check_run.conclusion,
      startedAt: new Date(check_run.started_at),
      completedAt: check_run.completed_at ? new Date(check_run.completed_at) : null
    });
    
    await job.updateProgress(70);
  }
  
  private static async handlePushEvent(job: Job, payload: any, queueManager: QueueManager): Promise<void> {
    const { ref, repository, commits } = payload;
    
    await job.updateProgress(40);
    
    // Queue a sync job to update repository data
    await queueManager.addJob(
      QUEUE_CONFIG.queues.WEBHOOK_PROCESSING,
      JobType.SYNC_GITHUB_DATA,
      {
        type: JobType.SYNC_GITHUB_DATA,
        data: {
          repository: repository.full_name,
          syncType: 'repository',
          branch: ref.replace('refs/heads/', ''),
          commits: commits.length
        }
      }
    );
    
    await job.updateProgress(70);
  }
  
  private static async handlePullRequestEvent(job: Job, payload: any, _queueManager: QueueManager): Promise<void> {
    const { pull_request, repository } = payload;
    
    await job.updateProgress(40);
    
    const db = DatabaseService.getInstance();
    
    // Store pull request data
    await db.upsertPullRequest({
      prId: pull_request.id,
      number: pull_request.number,
      repository: repository.full_name,
      title: pull_request.title,
      state: pull_request.state,
      author: pull_request.user.login,
      createdAt: new Date(pull_request.created_at),
      updatedAt: new Date(pull_request.updated_at)
    });
    
    await job.updateProgress(70);
  }
  
  private static async handleRepositoryEvent(job: Job, payload: any, queueManager: QueueManager): Promise<void> {
    const { action, repository } = payload;
    
    await job.updateProgress(40);
    
    if (action === 'created' || action === 'publicized') {
      // Queue a sync job for new repository
      await queueManager.addJob(
        QUEUE_CONFIG.queues.WEBHOOK_PROCESSING,
        JobType.SYNC_GITHUB_DATA,
        {
          type: JobType.SYNC_GITHUB_DATA,
          data: {
            repository: repository.full_name,
            syncType: 'full',
            includeWorkflows: true,
            includeRunners: true
          }
        }
      );
    }
    
    await job.updateProgress(70);
  }
  
  private static async syncGithubData(job: Job, data: any): Promise<any> {
    const { repository, syncType = 'repository', includeWorkflows = false, includeRunners = false } = data;
    
    try {
      await job.updateProgress(10);
      
      const githubService = GitHubService.getInstance();
      const db = DatabaseService.getInstance();
      
      const syncResults: Record<string, any> = {};
      
      // 1. Sync repository data
      if (syncType === 'repository' || syncType === 'full') {
        await job.updateProgress(30);
        const repoData = await githubService.getRepository(repository);
        await db.upsertRepository(repoData);
        syncResults.repository = true;
      }
      
      // 2. Sync workflows
      if (includeWorkflows) {
        await job.updateProgress(50);
        const workflows = await githubService.getWorkflows(repository);
        for (const workflow of workflows) {
          await db.upsertWorkflow(workflow);
        }
        syncResults.workflows = workflows.length;
      }
      
      // 3. Sync runners
      if (includeRunners) {
        await job.updateProgress(70);
        const runners = await githubService.getRunners(repository);
        for (const runner of runners) {
          await db.upsertRunner(runner);
        }
        syncResults.runners = runners.length;
      }
      
      await job.updateProgress(90);
      
      // 4. Update sync timestamp
      await db.updateSyncStatus(repository, {
        lastSynced: new Date(),
        syncType,
        success: true
      });
      
      await job.updateProgress(100);
      
      return {
        success: true,
        repository,
        syncType,
        results: syncResults
      };
    } catch (error) {
      logger.error(`GitHub data sync failed for ${repository}:`, error);
      throw error;
    }
  }
}