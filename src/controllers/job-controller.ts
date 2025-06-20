import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { AppError } from '../middleware/error-handler';
import { JobContext, DelegatedJob, JobStatus } from '../types';
import database from '../services/database';
import { jobQueue } from '../services/job-queue';

const logger = createLogger('JobController');

export class JobController {
  /**
   * Delegate a job from proxy runner to ephemeral container
   */
  async delegateJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jobContext: JobContext = req.body;
      
      // Validate required fields
      if (!jobContext.jobId || !jobContext.runId || !jobContext.repository) {
        throw new AppError(400, 'Missing required job context fields');
      }

      logger.info('Received job delegation request', {
        repository: jobContext.repository,
        workflow: jobContext.workflow,
        jobId: jobContext.jobId
      });

      // Create delegated job record
      const delegatedJob: DelegatedJob = {
        id: uuidv4(),
        githubJobId: parseInt(jobContext.jobId),
        status: JobStatus.QUEUED,
        ...jobContext,
        metadata: {
          delegatedAt: new Date().toISOString(),
          proxyRunner: jobContext.runnerName
        }
      };

      // Save to database
      await database.query(
        `INSERT INTO runnerhub.jobs 
         (id, github_job_id, repository, workflow_name, job_name, status, labels, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          delegatedJob.id,
          delegatedJob.githubJobId,
          delegatedJob.repository,
          delegatedJob.workflow,
          delegatedJob.jobId,
          delegatedJob.status,
          delegatedJob.labels,
          JSON.stringify(delegatedJob.metadata)
        ]
      );

      // Queue job for processing
      await jobQueue.add('process-job', delegatedJob, {
        priority: this.getJobPriority(delegatedJob),
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });

      // Emit WebSocket event
      const io = (req as any).io;
      io.to(`repo:${delegatedJob.repository}`).emit('job:delegated', {
        jobId: delegatedJob.id,
        repository: delegatedJob.repository,
        status: delegatedJob.status
      });

      res.status(201).json({
        success: true,
        data: {
          delegationId: delegatedJob.id,
          status: delegatedJob.status
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get job details
   */
  async getJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const [job] = await database.query(
        'SELECT * FROM runnerhub.jobs WHERE id = $1',
        [id]
      );

      if (!job) {
        throw new AppError(404, 'Job not found');
      }

      res.json({
        success: true,
        data: this.formatJob(job)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List jobs with pagination
   */
  async listJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const repository = req.query.repository as string;
      const status = req.query.status as string;

      const offset = (page - 1) * limit;
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (repository) {
        params.push(repository);
        whereClause += ` AND repository = $${params.length}`;
      }

      if (status) {
        params.push(status);
        whereClause += ` AND status = $${params.length}`;
      }

      // Get total count
      const [{ count }] = await database.query(
        `SELECT COUNT(*) FROM runnerhub.jobs ${whereClause}`,
        params
      );

      // Get jobs
      params.push(limit, offset);
      const jobs = await database.query(
        `SELECT * FROM runnerhub.jobs ${whereClause} 
         ORDER BY created_at DESC 
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      res.json({
        success: true,
        data: jobs.map(this.formatJob),
        pagination: {
          page,
          limit,
          total: parseInt(count),
          totalPages: Math.ceil(parseInt(count) / limit)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update job status (internal use)
   */
  async updateJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status, runnerId, containerId } = req.body;

      if (!status || !Object.values(JobStatus).includes(status)) {
        throw new AppError(400, 'Invalid status');
      }

      const updateFields = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
      const params = [id, status];

      if (runnerId) {
        params.push(runnerId);
        updateFields.push(`runner_id = $${params.length}`);
      }

      if (containerId) {
        params.push(containerId);
        updateFields.push(`container_id = $${params.length}`);
      }

      if (status === JobStatus.RUNNING) {
        updateFields.push('started_at = CURRENT_TIMESTAMP');
      } else if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
        updateFields.push('completed_at = CURRENT_TIMESTAMP');
      }

      await database.query(
        `UPDATE runnerhub.jobs SET ${updateFields.join(', ')} WHERE id = $1`,
        params
      );

      // Get updated job
      const [job] = await database.query(
        'SELECT * FROM runnerhub.jobs WHERE id = $1',
        [id]
      );

      // Emit WebSocket event
      const io = (req as any).io;
      io.to(`repo:${job.repository}`).emit('job:status', {
        jobId: job.id,
        repository: job.repository,
        status: job.status
      });

      res.json({
        success: true,
        data: this.formatJob(job)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark job as complete from proxy runner
   */
  async proxyComplete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      logger.info('Proxy runner reported job completion', { jobId: id });

      // Update job status
      await database.query(
        `UPDATE runnerhub.jobs 
         SET status = $2, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1 AND status != $3`,
        [id, JobStatus.COMPLETED, JobStatus.FAILED]
      );

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get job logs
   */
  async getJobLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: _id } = req.params;

      // TODO: Implement log retrieval from container or storage
      res.json({
        success: true,
        data: {
          logs: 'Log retrieval not yet implemented'
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Helper: Get job priority based on labels
   */
  private getJobPriority(job: DelegatedJob): number {
    if (job.labels.includes('urgent') || job.labels.includes('priority')) {
      return 10;
    }
    if (job.labels.includes('low-priority')) {
      return 1;
    }
    return 5;
  }

  /**
   * Helper: Format job for API response
   */
  private formatJob(dbJob: any): DelegatedJob {
    return {
      id: dbJob.id,
      githubJobId: dbJob.github_job_id,
      jobId: dbJob.job_name,
      runId: dbJob.metadata?.runId || '',
      repository: dbJob.repository,
      workflow: dbJob.workflow_name,
      runnerName: dbJob.metadata?.proxyRunner || '',
      status: dbJob.status,
      runnerId: dbJob.runner_id,
      containerId: dbJob.container_id,
      labels: dbJob.labels || [],
      startedAt: dbJob.started_at,
      completedAt: dbJob.completed_at,
      metadata: dbJob.metadata
    };
  }
}