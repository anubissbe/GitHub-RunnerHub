import { MonitoringService } from '../services/monitoring';

// Extended monitoring interface with all required methods
export interface ExtendedMonitoringService extends MonitoringService {
  recordJobDuration(jobId: string, duration: number): Promise<void>;
  recordMetricSnapshot(metrics: any): Promise<void>;
  recordMetricDeltas(deltas: any): Promise<void>;
  recordCustomMetrics(metrics: any): Promise<void>;
  recordStatusReports(reports: any): Promise<void>;
}

// Helper to cast MonitoringService to ExtendedMonitoringService
export function getExtendedMonitoring(): ExtendedMonitoringService {
  return MonitoringService.getInstance() as unknown as ExtendedMonitoringService;
}