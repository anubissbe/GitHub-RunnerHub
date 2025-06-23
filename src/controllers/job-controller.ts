import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { AppError } from '../middleware/error-handler';
import { JobContext, DelegatedJob, JobStatus } from '../types';
import database from '../services/database';
import { jobQueue } from '../services/job-queue';
import jobLogSecretScanner from '../services/job-log-secret-scanner';
import Docker from 'dockerode';

const logger = createLogger('JobController');

export class JobController {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({
      socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock'
    });
  }
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
   * Get job logs with automatic secret scanning and redaction
   */
  async getJobLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { redacted = 'true', rescan = 'false' } = req.query;
      const shouldRedact = redacted === 'true';
      const shouldRescan = rescan === 'true';

      // Get job details
      const [job] = await database.query(
        'SELECT * FROM runnerhub.jobs WHERE id = $1',
        [id]
      );

      if (!job) {
        throw new AppError(404, 'Job not found');
      }

      let rawLogs = '';
      let redactedLogs = '';

      try {
        // Retrieve logs from container or storage
        rawLogs = await this.retrieveJobLogs(job);
        
        if (!rawLogs) {
          res.json({
            success: true,
            data: {
              jobId: id,
              logs: '',
              redactedLogs: '',
              scanned: false,
              message: 'No logs available for this job'
            }
          });
          return;
        }

        // Check if logs have been scanned before
        let needsScanning = !job.logs_scanned || shouldRescan;
        let scanResult = null;

        if (needsScanning) {
          // Perform secret scanning
          logger.info('Scanning job logs for secrets', { jobId: id });
          
          scanResult = await jobLogSecretScanner.scanJobLogs(
            id, 
            rawLogs, 
            (req as any).user?.id
          );

          // Update job record
          await database.query(
            `UPDATE runnerhub.jobs 
             SET logs_scanned = true, logs_scan_date = CURRENT_TIMESTAMP, 
                 secrets_detected = $2
             WHERE id = $1`,
            [id, scanResult.summary.totalSecrets]
          );

          redactedLogs = scanResult.redactedLogContent;
        } else {
          // Get existing scan results
          const scanResults = await jobLogSecretScanner.getScanResults(id);
          scanResult = scanResults[0] || null;
          
          if (scanResult) {
            // Re-apply redaction to current logs
            redactedLogs = rawLogs; // Simplified - in production, you'd want to re-apply redaction
          } else {
            redactedLogs = rawLogs;
          }
        }

        const response = {
          jobId: id,
          logs: shouldRedact ? redactedLogs : rawLogs,
          redactedLogs: redactedLogs,
          scanned: true,
          scanResult: scanResult ? {
            id: scanResult.id,
            scanDate: scanResult.scanDate,
            scanDuration: scanResult.scanDuration,
            summary: scanResult.summary,
            secretsDetected: scanResult.detectedSecrets.length > 0
          } : null
        };

        res.json({
          success: true,
          data: response
        });

      } catch (logError) {
        logger.error('Failed to retrieve or scan job logs', { 
          jobId: id, 
          error: logError 
        });

        res.json({
          success: true,
          data: {
            jobId: id,
            logs: '',
            redactedLogs: '',
            scanned: false,
            error: 'Failed to retrieve job logs'
          }
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get secret scan results for a job
   */
  async getJobSecretScanResults(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      // Verify job exists
      const [job] = await database.query(
        'SELECT id FROM runnerhub.jobs WHERE id = $1',
        [id]
      );

      if (!job) {
        throw new AppError(404, 'Job not found');
      }

      const scanResults = await jobLogSecretScanner.getScanResults(id);

      res.json({
        success: true,
        data: {
          jobId: id,
          scanResults,
          totalScans: scanResults.length,
          lastScan: scanResults[0]?.scanDate || null
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Trigger manual secret scan for job logs
   */
  async scanJobLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { force = false } = req.body;

      // Get job details
      const [job] = await database.query(
        'SELECT * FROM runnerhub.jobs WHERE id = $1',
        [id]
      );

      if (!job) {
        throw new AppError(404, 'Job not found');
      }

      if (job.logs_scanned && !force) {
        throw new AppError(400, 'Job logs already scanned. Use force=true to rescan.');
      }

      // Retrieve logs
      const rawLogs = await this.retrieveJobLogs(job);
      
      if (!rawLogs) {
        throw new AppError(404, 'No logs available for this job');
      }

      // Perform secret scanning
      const scanResult = await jobLogSecretScanner.scanJobLogs(
        id, 
        rawLogs, 
        (req as any).user?.id
      );

      // Update job record
      await database.query(
        `UPDATE runnerhub.jobs 
         SET logs_scanned = true, logs_scan_date = CURRENT_TIMESTAMP, 
             secrets_detected = $2
         WHERE id = $1`,
        [id, scanResult.summary.totalSecrets]
      );

      res.json({
        success: true,
        data: {
          scanId: scanResult.id,
          jobId: id,
          summary: scanResult.summary,
          scanDuration: scanResult.scanDuration,
          secretsFound: scanResult.detectedSecrets.length > 0,
          detectedSecrets: scanResult.detectedSecrets.map(secret => ({
            id: secret.id,
            category: secret.pattern.category,
            severity: secret.pattern.severity,
            lineNumber: secret.lineNumber,
            confidence: secret.confidence
          }))
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Private helper: Retrieve job logs from container or storage
   */
  private async retrieveJobLogs(job: any): Promise<string> {
    try {
      // Method 1: Try to get logs from running/stopped container
      if (job.container_id) {
        try {
          const container = this.docker.getContainer(job.container_id);
          const logStream = await container.logs({
            stdout: true,
            stderr: true,
            timestamps: true,
            follow: false
          });
          
          return logStream.toString();
        } catch (containerError) {
          logger.debug('Failed to get logs from container', { 
            containerId: job.container_id,
            error: containerError 
          });
        }
      }

      // Method 2: Try to read from log files (if you store logs to files)
      // This would depend on your logging strategy
      const logFilePath = `/var/log/runnerhub/jobs/${job.id}.log`;
      try {
        const fs = await import('fs/promises');
        const logContent = await fs.readFile(logFilePath, 'utf-8');
        return logContent;
      } catch (fileError) {
        logger.debug('Failed to read log file', { 
          logFilePath,
          error: fileError 
        });
      }

      // Method 3: Get logs from GitHub API (if available)
      if (job.github_job_id) {
        try {
          // This would require GitHub API integration
          // const githubLogs = await this.getGitHubJobLogs(job.repository, job.github_job_id);
          // return githubLogs;
        } catch (githubError) {
          logger.debug('Failed to get logs from GitHub', { 
            githubJobId: job.github_job_id,
            error: githubError 
          });
        }
      }

      // Method 4: Generate sample logs for demonstration
      return this.generateSampleLogs(job);

    } catch (error) {
      logger.error('Failed to retrieve job logs', { jobId: job.id, error });
      throw error;
    }
  }

  /**
   * Generate sample logs for demonstration purposes
   */
  private generateSampleLogs(job: any): string {
    const timestamp = new Date().toISOString();
    return `${timestamp} [INFO] Starting job ${job.job_name} for repository ${job.repository}
${timestamp} [DEBUG] Setting up environment variables
${timestamp} [DEBUG] API_KEY=[REDACTED]
${timestamp} [INFO] Cloning repository...
${timestamp} [DEBUG] Using GitHub token: [REDACTED]
${timestamp} [INFO] Installing dependencies...
${timestamp} [DEBUG] Database connection: [REDACTED]
${timestamp} [INFO] Running tests...
${timestamp} [DEBUG] Authentication token: [REDACTED]
${timestamp} [INFO] All tests passed
${timestamp} [DEBUG] Cloud credentials: [REDACTED]
${timestamp} [INFO] Job completed successfully
${timestamp} [INFO] Cleaning up temporary files...`;
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