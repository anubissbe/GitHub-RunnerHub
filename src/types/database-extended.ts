import { DatabaseService } from '../services/database';

// Extended database interface with all required methods
export interface ExtendedDatabaseService extends DatabaseService {
  // Job management
  saveJobStatus(status: any): Promise<void>;
  updateJobCheckRunId(jobId: string, checkRunId: number): Promise<void>;
  markJobStatusReported(jobId: string): Promise<void>;
  getPendingStatusUpdates(): Promise<any[]>;
  appendJobLogs(jobId: string, logs: string, level: string): Promise<void>;
  updateJobStatus(jobId: string, status: any): Promise<void>;
  getJob(jobId: string): Promise<any>;
  
  // Container management
  createContainerAssignment(assignment: any): Promise<void>;
  
  // Migration rules
  createMigrationRules(rules: any[]): Promise<void>;
  
  // Interrupted jobs
  getInterruptedJobs(): Promise<any[]>;
  
  // Alerts
  saveAlert(alert: any): Promise<void>;
  updateAlert(alertId: string, update: any): Promise<void>;
  
  // Cleanup
  cleanupOldMetrics(cutoff: Date): Promise<void>;
  cleanupOldLogs(cutoff: Date): Promise<void>;
  cleanupOldAlerts(cutoff: Date): Promise<void>;
  
  // Health check
  isHealthy(): Promise<boolean>;
  
  // Check runs
  updateCheckRun(checkRunId: number, data: any): Promise<void>;
  
  // Initialize
  initialize(): Promise<void>;
}

// Helper to cast DatabaseService to ExtendedDatabaseService
export function getExtendedDatabase(): ExtendedDatabaseService {
  return DatabaseService.getInstance() as unknown as ExtendedDatabaseService;
}