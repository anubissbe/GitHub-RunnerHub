import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import { GitHubService } from '../services/github-service';
import { DatabaseService } from '../services/database-service';
import { MetricsCollector } from '../services/metrics-collector';

const logger = createLogger('StatusReporter');

export interface JobStatus {
  id: string;
  repository: string;
  sha: string;
  runId: number;
  checkRunId?: number;
  name: string;
  status: JobStatusType;
  conclusion?: JobConclusion;
  startedAt?: Date;
  completedAt?: Date;
  output?: CheckRunOutput;
  annotations?: Annotation[];
  steps?: StepStatus[];
}

export enum JobStatusType {
  QUEUED = 'queued',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed'
}

export enum JobConclusion {
  SUCCESS = 'success',
  FAILURE = 'failure',
  CANCELLED = 'cancelled',
  SKIPPED = 'skipped',
  TIMED_OUT = 'timed_out',
  ACTION_REQUIRED = 'action_required',
  NEUTRAL = 'neutral'
}

export interface CheckRunOutput {
  title: string;
  summary: string;
  text?: string;
  annotations_count?: number;
  annotations_url?: string;
}

export interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  start_column?: number;
  end_column?: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  message: string;
  title?: string;
  raw_details?: string;
}

export interface StepStatus {
  number: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped';
  started_at?: Date;
  completed_at?: Date;
}

export interface StatusReporterConfig {
  batchSize: number;
  reportInterval: number;
  retryAttempts: number;
  retryDelay: number;
}

export class StatusReporter extends EventEmitter {
  private static instance: StatusReporter;
  private githubService: GitHubService;
  private databaseService: DatabaseService;
  private metricsCollector: MetricsCollector;
  private config: StatusReporterConfig;
  
  private statusQueue: Map<string, JobStatus> = new Map();
  private reportInterval?: NodeJS.Timer;
  private isReporting = false;
  
  private constructor(config?: Partial<StatusReporterConfig>) {
    super();
    this.githubService = GitHubService.getInstance();
    this.databaseService = DatabaseService.getInstance();
    this.metricsCollector = MetricsCollector.getInstance();
    
    this.config = {
      batchSize: 10,
      reportInterval: 5000, // 5 seconds
      retryAttempts: 3,
      retryDelay: 1000, // 1 second
      ...config
    };
  }
  
  public static getInstance(config?: Partial<StatusReporterConfig>): StatusReporter {
    if (!StatusReporter.instance) {
      StatusReporter.instance = new StatusReporter(config);
    }
    return StatusReporter.instance;
  }
  
  public async initialize(): Promise<void> {
    logger.info('Initializing Status Reporter');
    
    // Start the reporting interval
    this.startReportingInterval();
    
    // Recover any pending status updates from database
    await this.recoverPendingUpdates();
    
    logger.info('Status Reporter initialized');
  }
  
  /**
   * Report job status to GitHub
   */
  public async reportJobStatus(status: JobStatus): Promise<void> {
    logger.info(`Reporting job status: ${status.id}`, {
      repository: status.repository,
      status: status.status,
      conclusion: status.conclusion
    });
    
    try {
      // Add to queue for batch processing
      this.statusQueue.set(status.id, status);
      
      // Store in database for recovery
      await this.databaseService.saveJobStatus(status);
      
      // If queue is getting large, trigger immediate report
      if (this.statusQueue.size >= this.config.batchSize) {
        await this.processStatusQueue();
      }
      
      this.emit('status:queued', status);
    } catch (error) {
      logger.error('Failed to queue job status:', error);
      this.emit('status:error', { status, error });
    }
  }
  
  /**
   * Report job started
   */
  public async reportJobStarted(
    jobId: string,
    repository: string,
    sha: string,
    name: string,
    runId: number
  ): Promise<void> {
    await this.reportJobStatus({
      id: jobId,
      repository,
      sha,
      runId,
      name,
      status: JobStatusType.IN_PROGRESS,
      startedAt: new Date(),
      output: {
        title: `${name} - In Progress`,
        summary: 'Job execution started'
      }
    });
  }
  
  /**
   * Report job completed
   */
  public async reportJobCompleted(
    jobId: string,
    repository: string,
    sha: string,
    name: string,
    runId: number,
    conclusion: JobConclusion,
    output?: CheckRunOutput,
    annotations?: Annotation[]
  ): Promise<void> {
    await this.reportJobStatus({
      id: jobId,
      repository,
      sha,
      runId,
      name,
      status: JobStatusType.COMPLETED,
      conclusion,
      completedAt: new Date(),
      output: output || {
        title: `${name} - ${this.formatConclusion(conclusion)}`,
        summary: this.generateSummary(conclusion)
      },
      annotations
    });
  }
  
  /**
   * Report step status
   */
  public async reportStepStatus(
    jobId: string,
    step: StepStatus
  ): Promise<void> {
    const jobStatus = this.statusQueue.get(jobId);
    if (!jobStatus) {
      logger.warn(`Job ${jobId} not found in status queue`);
      return;
    }
    
    // Update step status
    if (!jobStatus.steps) {
      jobStatus.steps = [];
    }
    
    const existingStepIndex = jobStatus.steps.findIndex(s => s.number === step.number);
    if (existingStepIndex >= 0) {
      jobStatus.steps[existingStepIndex] = step;
    } else {
      jobStatus.steps.push(step);
    }
    
    // Generate step summary
    const stepSummary = this.generateStepSummary(jobStatus.steps);
    if (jobStatus.output) {
      jobStatus.output.text = stepSummary;
    }
    
    // Re-queue the updated status
    this.statusQueue.set(jobId, jobStatus);
  }
  
  private generateStepSummary(steps: StepStatus[]): string {
    const lines: string[] = ['### Steps'];
    
    for (const step of steps.sort((a, b) => a.number - b.number)) {
      let icon = '⏳';
      if (step.status === 'completed') {
        icon = step.conclusion === 'success' ? '✅' : 
               step.conclusion === 'failure' ? '❌' : 
               step.conclusion === 'skipped' ? '⏭️' : '⚠️';
      }
      
      lines.push(`${icon} **Step ${step.number}: ${step.name}**`);
      
      if (step.started_at) {
        lines.push(`   Started: ${step.started_at.toISOString()}`);
      }
      
      if (step.completed_at && step.started_at) {
        const duration = step.completed_at.getTime() - step.started_at.getTime();
        lines.push(`   Duration: ${this.formatDuration(duration)}`);
      }
      
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
  
  private formatConclusion(conclusion: JobConclusion): string {
    const conclusionMap: Record<JobConclusion, string> = {
      [JobConclusion.SUCCESS]: 'Success',
      [JobConclusion.FAILURE]: 'Failed',
      [JobConclusion.CANCELLED]: 'Cancelled',
      [JobConclusion.SKIPPED]: 'Skipped',
      [JobConclusion.TIMED_OUT]: 'Timed Out',
      [JobConclusion.ACTION_REQUIRED]: 'Action Required',
      [JobConclusion.NEUTRAL]: 'Neutral'
    };
    
    return conclusionMap[conclusion] || conclusion;
  }
  
  private generateSummary(conclusion: JobConclusion): string {
    const summaryMap: Record<JobConclusion, string> = {
      [JobConclusion.SUCCESS]: 'Job completed successfully',
      [JobConclusion.FAILURE]: 'Job failed during execution',
      [JobConclusion.CANCELLED]: 'Job was cancelled',
      [JobConclusion.SKIPPED]: 'Job was skipped',
      [JobConclusion.TIMED_OUT]: 'Job exceeded time limit',
      [JobConclusion.ACTION_REQUIRED]: 'Job requires manual intervention',
      [JobConclusion.NEUTRAL]: 'Job completed with neutral result'
    };
    
    return summaryMap[conclusion] || 'Job completed';
  }
  
  private startReportingInterval(): void {
    this.reportInterval = setInterval(async () => {
      if (!this.isReporting && this.statusQueue.size > 0) {
        await this.processStatusQueue();
      }
    }, this.config.reportInterval);
  }
  
  private async processStatusQueue(): Promise<void> {
    if (this.isReporting || this.statusQueue.size === 0) {
      return;
    }
    
    this.isReporting = true;
    
    try {
      // Get batch of statuses to report
      const batch = Array.from(this.statusQueue.entries())
        .slice(0, this.config.batchSize);
      
      logger.info(`Processing ${batch.length} status updates`);
      
      // Process each status
      const results = await Promise.allSettled(
        batch.map(([jobId, status]) => this.reportSingleStatus(status))
      );
      
      // Remove successfully reported statuses from queue
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const [jobId] = batch[index];
          this.statusQueue.delete(jobId);
          this.emit('status:reported', batch[index][1]);
        } else {
          logger.error('Failed to report status:', result.reason);
          this.emit('status:failed', { 
            status: batch[index][1], 
            error: result.reason 
          });
        }
      });
      
      // Update metrics
      const successful = results.filter(r => r.status === 'fulfilled').length;
      await this.metricsCollector.recordStatusReports({
        total: batch.length,
        successful,
        failed: batch.length - successful
      });
      
    } catch (error) {
      logger.error('Error processing status queue:', error);
    } finally {
      this.isReporting = false;
    }
  }
  
  private async reportSingleStatus(status: JobStatus): Promise<void> {
    let attempts = 0;
    let lastError: any;
    
    while (attempts < this.config.retryAttempts) {
      try {
        if (!status.checkRunId) {
          // Create new check run
          const checkRun = await this.githubService.createCheckRun(
            status.repository,
            {
              name: status.name,
              head_sha: status.sha,
              status: this.mapStatusToGitHub(status.status),
              started_at: status.startedAt?.toISOString(),
              completed_at: status.completedAt?.toISOString(),
              conclusion: status.conclusion,
              output: status.output,
              annotations: status.annotations
            }
          );
          
          // Save check run ID for future updates
          status.checkRunId = checkRun.id;
          await this.databaseService.updateJobCheckRunId(status.id, checkRun.id);
        } else {
          // Update existing check run
          await this.githubService.updateCheckRun(
            status.repository,
            status.checkRunId,
            {
              status: this.mapStatusToGitHub(status.status),
              completed_at: status.completedAt?.toISOString(),
              conclusion: status.conclusion,
              output: status.output,
              annotations: status.annotations
            }
          );
        }
        
        // Mark as reported in database
        await this.databaseService.markJobStatusReported(status.id);
        
        logger.info(`Successfully reported status for job ${status.id}`);
        return;
        
      } catch (error) {
        lastError = error;
        attempts++;
        
        if (attempts < this.config.retryAttempts) {
          logger.warn(`Failed to report status (attempt ${attempts}), retrying...`, error);
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * attempts));
        }
      }
    }
    
    throw new Error(`Failed to report status after ${attempts} attempts: ${lastError}`);
  }
  
  private mapStatusToGitHub(status: JobStatusType): 'queued' | 'in_progress' | 'completed' {
    switch (status) {
      case JobStatusType.QUEUED:
        return 'queued';
      case JobStatusType.IN_PROGRESS:
        return 'in_progress';
      case JobStatusType.COMPLETED:
        return 'completed';
      default:
        return 'queued';
    }
  }
  
  private async recoverPendingUpdates(): Promise<void> {
    try {
      const pendingUpdates = await this.databaseService.getPendingStatusUpdates();
      
      for (const status of pendingUpdates) {
        this.statusQueue.set(status.id, status);
      }
      
      if (pendingUpdates.length > 0) {
        logger.info(`Recovered ${pendingUpdates.length} pending status updates`);
      }
    } catch (error) {
      logger.error('Failed to recover pending status updates:', error);
    }
  }
  
  /**
   * Report real-time logs
   */
  public async reportLogs(
    jobId: string,
    logs: string,
    level: 'info' | 'warning' | 'error' = 'info'
  ): Promise<void> {
    try {
      // Store logs in database
      await this.databaseService.appendJobLogs(jobId, logs, level);
      
      // Emit for real-time streaming
      this.emit('logs:received', { jobId, logs, level });
    } catch (error) {
      logger.error('Failed to report logs:', error);
    }
  }
  
  /**
   * Create annotations from test results
   */
  public createAnnotationsFromTestResults(testResults: any[]): Annotation[] {
    const annotations: Annotation[] = [];
    
    for (const result of testResults) {
      if (result.status === 'failed') {
        annotations.push({
          path: result.file || 'unknown',
          start_line: result.line || 1,
          end_line: result.line || 1,
          annotation_level: 'failure',
          message: result.message || 'Test failed',
          title: result.name || 'Test Failure',
          raw_details: result.stack
        });
      }
    }
    
    return annotations;
  }
  
  /**
   * Get status reporting statistics
   */
  public getStatistics(): any {
    return {
      queueSize: this.statusQueue.size,
      isReporting: this.isReporting,
      config: this.config
    };
  }
  
  public async shutdown(): Promise<void> {
    logger.info('Shutting down Status Reporter');
    
    // Clear interval
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
    }
    
    // Process remaining queue
    if (this.statusQueue.size > 0) {
      logger.info(`Processing ${this.statusQueue.size} remaining status updates`);
      await this.processStatusQueue();
    }
    
    logger.info('Status Reporter shutdown complete');
  }
}

export default StatusReporter;