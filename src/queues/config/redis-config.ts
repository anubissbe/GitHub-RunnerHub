import { ConnectionOptions } from 'bullmq';
import { RedisOptions } from 'ioredis';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest?: number;
  enableReadyCheck?: boolean;
  retryStrategy?: (times: number) => number | null;
}

// Redis connection configuration for Bull queues
export const getRedisConfig = (): RedisConfig => {
  const config: RedisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    }
  };

  // Remove undefined values
  Object.keys(config).forEach(key => {
    if (config[key as keyof RedisConfig] === undefined) {
      delete config[key as keyof RedisConfig];
    }
  });

  return config;
};

// Bull-specific connection options
export const getBullConnectionOptions = (): ConnectionOptions => {
  const redisConfig = getRedisConfig();
  
  return {
    connection: redisConfig as RedisOptions
  };
};

// Queue configuration constants
export const QUEUE_CONFIG = {
  defaultJobOptions: {
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 1000     // Keep max 1000 completed jobs
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
      count: 5000         // Keep max 5000 failed jobs
    },
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 2000
    }
  },
  
  // Queue priorities
  priorities: {
    CRITICAL: 1,
    HIGH: 2,
    NORMAL: 3,
    LOW: 4
  },
  
  // Queue names
  queues: {
    JOB_EXECUTION: 'job-execution',
    CONTAINER_MANAGEMENT: 'container-management',
    MONITORING: 'monitoring',
    CLEANUP: 'cleanup',
    WEBHOOK_PROCESSING: 'webhook-processing',
    METRICS_COLLECTION: 'metrics-collection'
  }
};

// Job type definitions
export enum JobType {
  // Job execution
  EXECUTE_WORKFLOW = 'execute_workflow',
  PREPARE_RUNNER = 'prepare_runner',
  CLEANUP_RUNNER = 'cleanup_runner',
  
  // Container management
  CREATE_CONTAINER = 'create_container',
  DESTROY_CONTAINER = 'destroy_container',
  HEALTH_CHECK = 'health_check',
  
  // Monitoring
  COLLECT_METRICS = 'collect_metrics',
  SEND_ALERT = 'send_alert',
  UPDATE_STATUS = 'update_status',
  
  // Webhook processing
  PROCESS_WEBHOOK = 'process_webhook',
  SYNC_GITHUB_DATA = 'sync_github_data',
  
  // Cleanup
  CLEANUP_OLD_JOBS = 'cleanup_old_jobs',
  CLEANUP_CONTAINERS = 'cleanup_containers',
  CLEANUP_LOGS = 'cleanup_logs'
}

export default {
  getRedisConfig,
  getBullConnectionOptions,
  QUEUE_CONFIG,
  JobType
};