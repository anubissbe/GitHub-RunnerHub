import { Job } from 'bullmq';
import { JobType } from '../config/redis-config';
import { logger } from '../../utils/logger';
import { MonitoringService } from '../../services/monitoring-service';
import { AlertingService } from '../../services/alerting-service';
import { DatabaseService } from '../../services/database-service';
import { MetricsCollector } from '../../services/metrics-collector';

export class MonitoringProcessor {
  static async process(job: Job): Promise<any> {
    const { type, data } = job.data;
    logger.info(`Processing monitoring job ${job.id} of type ${type}`);
    
    try {
      switch (type) {
        case JobType.COLLECT_METRICS:
          return await MonitoringProcessor.collectMetrics(job, data);
          
        case JobType.SEND_ALERT:
          return await MonitoringProcessor.sendAlert(job, data);
          
        case JobType.UPDATE_STATUS:
          return await MonitoringProcessor.updateStatus(job, data);
          
        default:
          throw new Error(`Unknown monitoring job type: ${type}`);
      }
    } catch (error) {
      logger.error(`Error processing monitoring job ${job.id}:`, error);
      throw error;
    }
  }
  
  private static async collectMetrics(job: Job, data: any): Promise<any> {
    const { targets = ['system', 'containers', 'queues'], interval = 60 } = data;
    
    try {
      await job.updateProgress(10);
      
      const metricsCollector = MetricsCollector.getInstance();
      const metrics: Record<string, any> = {};
      
      // 1. Collect system metrics
      if (targets.includes('system')) {
        await job.updateProgress(30);
        metrics.system = await metricsCollector.collectSystemMetrics();
      }
      
      // 2. Collect container metrics
      if (targets.includes('containers')) {
        await job.updateProgress(50);
        metrics.containers = await metricsCollector.collectContainerMetrics();
      }
      
      // 3. Collect queue metrics
      if (targets.includes('queues')) {
        await job.updateProgress(70);
        metrics.queues = await metricsCollector.collectQueueMetrics();
      }
      
      // 4. Collect application metrics
      if (targets.includes('application')) {
        await job.updateProgress(80);
        metrics.application = await metricsCollector.collectApplicationMetrics();
      }
      
      // 5. Store metrics in database
      await job.updateProgress(90);
      const db = DatabaseService.getInstance();
      await db.storeMetrics({
        timestamp: new Date(),
        interval,
        metrics
      });
      
      // 6. Check for anomalies
      const monitoringService = MonitoringService.getInstance();
      const anomalies = await monitoringService.detectAnomalies(metrics);
      
      if (anomalies.length > 0) {
        logger.warn(`Detected ${anomalies.length} anomalies in metrics`);
        // Queue alert jobs for anomalies
        for (const anomaly of anomalies) {
          await job.queue.add(JobType.SEND_ALERT, {
            type: JobType.SEND_ALERT,
            data: {
              severity: anomaly.severity,
              type: 'anomaly',
              title: anomaly.title,
              description: anomaly.description,
              metrics: anomaly.metrics
            }
          });
        }
      }
      
      await job.updateProgress(100);
      
      return {
        success: true,
        metricsCollected: Object.keys(metrics).length,
        anomaliesDetected: anomalies.length,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Metrics collection failed:', error);
      throw error;
    }
  }
  
  private static async sendAlert(job: Job, data: any): Promise<any> {
    const { severity, type, title, description, channels = ['email', 'slack'], metadata = {} } = data;
    
    try {
      await job.updateProgress(20);
      
      const alertingService = AlertingService.getInstance();
      
      // 1. Format alert message
      const alert = {
        id: `alert-${Date.now()}`,
        severity,
        type,
        title,
        description,
        timestamp: new Date(),
        metadata,
        source: 'GitHub-RunnerHub'
      };
      
      await job.updateProgress(40);
      
      // 2. Send to requested channels
      const results: Record<string, boolean> = {};
      
      if (channels.includes('email')) {
        try {
          await alertingService.sendEmailAlert(alert);
          results.email = true;
        } catch (error) {
          logger.error('Email alert failed:', error);
          results.email = false;
        }
      }
      
      await job.updateProgress(60);
      
      if (channels.includes('slack')) {
        try {
          await alertingService.sendSlackAlert(alert);
          results.slack = true;
        } catch (error) {
          logger.error('Slack alert failed:', error);
          results.slack = false;
        }
      }
      
      await job.updateProgress(80);
      
      if (channels.includes('webhook')) {
        try {
          await alertingService.sendWebhookAlert(alert, data.webhookUrl);
          results.webhook = true;
        } catch (error) {
          logger.error('Webhook alert failed:', error);
          results.webhook = false;
        }
      }
      
      // 3. Store alert in database
      const db = DatabaseService.getInstance();
      await db.storeAlert({
        ...alert,
        channels,
        deliveryResults: results
      });
      
      await job.updateProgress(100);
      
      return {
        success: true,
        alertId: alert.id,
        deliveryResults: results
      };
    } catch (error) {
      logger.error('Alert sending failed:', error);
      throw error;
    }
  }
  
  private static async updateStatus(job: Job, data: any): Promise<any> {
    const { component, status, message, metadata = {} } = data;
    
    try {
      await job.updateProgress(30);
      
      const monitoringService = MonitoringService.getInstance();
      
      // 1. Update component status
      await monitoringService.updateComponentStatus(component, {
        status,
        message,
        lastUpdated: new Date(),
        metadata
      });
      
      await job.updateProgress(60);
      
      // 2. Check if status change requires alerts
      const previousStatus = await monitoringService.getPreviousStatus(component);
      
      if (previousStatus && previousStatus !== status) {
        // Status changed - check if alert is needed
        if (status === 'error' || status === 'critical') {
          await job.queue.add(JobType.SEND_ALERT, {
            type: JobType.SEND_ALERT,
            data: {
              severity: status === 'critical' ? 'critical' : 'error',
              type: 'status_change',
              title: `${component} Status Changed`,
              description: `${component} status changed from ${previousStatus} to ${status}: ${message}`,
              metadata: {
                component,
                previousStatus,
                currentStatus: status
              }
            }
          });
        }
      }
      
      await job.updateProgress(80);
      
      // 3. Update dashboard
      await monitoringService.broadcastStatusUpdate({
        component,
        status,
        message,
        timestamp: new Date()
      });
      
      await job.updateProgress(100);
      
      return {
        success: true,
        component,
        status,
        statusChanged: previousStatus !== status
      };
    } catch (error) {
      logger.error(`Status update failed for ${component}:`, error);
      throw error;
    }
  }
}