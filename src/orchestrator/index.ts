/**
 * GitHub RunnerHub Enhanced Orchestrator System
 * 
 * Advanced container orchestration for GitHub Actions with intelligent job distribution,
 * Docker integration, auto-scaling, and real-time monitoring. Replaces traditional 
 * dedicated runners with a sophisticated container-based approach.
 */

// Enhanced Orchestrator Components
export { EnhancedOrchestrator, EnhancedOrchestratorConfig, EnhancedOrchestratorStatus } from './enhanced-orchestrator';
export { OrchestrationIntegration, IntegrationConfig, SystemHealth, IntegrationMetrics } from './orchestration-integration';

// Core Orchestrator Components (Legacy Support)
export { RunnerOrchestrator, OrchestratorConfig, OrchestratorStatus } from './runner-orchestrator';
export { ContainerAssignmentManager, ContainerStatus, LoadBalancingStrategy } from './container-assignment';
export { JobParser, ParsedJob, ValidationError } from './job-parser';
export { StatusReporter, JobStatus, JobStatusType, JobConclusion } from './status-reporter';
export { OrchestratorWebhookHandler, WebhookEvent } from './webhook-handler';
export { OrchestratorService, OrchestratorServiceConfig } from './orchestrator-service';

// Monitoring Components
export { OrchestratorMonitor, MonitoringConfig, HealthStatus, Alert } from './monitoring/orchestrator-monitor';
export { OrchestratorDashboard, DashboardConfig, DashboardData } from './monitoring/dashboard';

// Type Definitions
export interface Container {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  labels: Record<string, string>;
  resources: ResourceConfig;
  createdAt: Date;
  lastHealthCheck: Date;
  healthStatus: HealthStatus;
  assignedJob?: string;
  utilization: ResourceUtilization;
}

export interface ResourceConfig {
  cpu: number;
  memory: string;
  disk: string;
  network?: {
    bandwidth?: string;
    latency?: number;
  };
}

export interface ResourceUtilization {
  cpu: number; // 0-1
  memory: number; // 0-1
  disk: number; // 0-1
  network: number; // 0-1
}

export interface JobRequest {
  id: string;
  repository: string;
  workflow: string;
  jobName: string;
  runId: number;
  runNumber: number;
  sha: string;
  ref: string;
  environment: Record<string, string>;
  labels: string[];
  matrix?: any;
  steps: any[];
  needs?: string[];
  services?: Record<string, any>;
  container?: any;
}

export interface ContainerAssignment {
  jobId: string;
  containerId: string;
  containerName: string;
  assignedAt: Date;
  estimatedDuration: number;
  priority: number;
}

// Utility Functions
export function createOrchestratorService(config: OrchestratorServiceConfig): OrchestratorService {
  return OrchestratorService.getInstance(config);
}

export function getOrchestratorInstance(): RunnerOrchestrator | null {
  try {
    return RunnerOrchestrator.getInstance();
  } catch {
    return null;
  }
}

export function getContainerManagerInstance(): ContainerAssignmentManager {
  return ContainerAssignmentManager.getInstance();
}

export function getStatusReporterInstance(): StatusReporter {
  return StatusReporter.getInstance();
}

// Constants
export const ORCHESTRATOR_DEFAULTS = {
  MAX_CONCURRENT_JOBS: 50,
  CONTAINER_POOL_SIZE: 100,
  HEALTH_CHECK_INTERVAL: 30000,
  METRICS_INTERVAL: 60000,
  WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || '',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_ORG: process.env.GITHUB_ORG || ''
} as const;

export const LOAD_BALANCING_STRATEGIES = {
  ROUND_ROBIN: 'round-robin',
  LEAST_LOADED: 'least-loaded',
  RESOURCE_AWARE: 'resource-aware',
  AFFINITY_BASED: 'affinity-based'
} as const;

export const JOB_PRIORITIES = {
  LOW: 4,
  NORMAL: 3,
  HIGH: 2,
  CRITICAL: 1
} as const;

// Enhanced Factory Functions
export function createEnhancedOrchestrator(config?: Partial<EnhancedOrchestratorConfig>): EnhancedOrchestrator {
  const defaultConfig: EnhancedOrchestratorConfig = {
    maxConcurrentJobs: 50,
    containerPoolSize: 100,
    healthCheckInterval: 30000,
    metricsInterval: 60000,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    gitHubToken: process.env.GITHUB_TOKEN || '',
    gitHubOrg: process.env.GITHUB_ORG || '',
    jobDistribution: {
      enabled: true,
      maxConcurrentJobs: 100,
      maxQueuedJobs: 1000,
      enableDependencyExecution: true,
      enableResourceAwareScheduling: true,
      enableLoadBalancing: true
    },
    docker: {
      enabled: true,
      socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
      registryUrl: process.env.DOCKER_REGISTRY_URL,
      networkConfig: {
        defaultDriver: 'bridge',
        enableMonitoring: true
      },
      volumeConfig: {
        defaultDriver: 'local',
        enableCleanup: true
      }
    },
    scaling: {
      autoScaling: true,
      minContainers: 5,
      maxContainers: 200,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.3,
      cooldownPeriod: 300000 // 5 minutes
    }
  };

  const mergedConfig = { ...defaultConfig, ...config };
  return EnhancedOrchestrator.getInstance(mergedConfig);
}

export function createOrchestrationIntegration(config?: Partial<IntegrationConfig>): OrchestrationIntegration {
  const defaultConfig: IntegrationConfig = {
    orchestrator: {
      maxConcurrentJobs: 50,
      containerPoolSize: 100,
      healthCheckInterval: 30000,
      metricsInterval: 60000,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
      gitHubToken: process.env.GITHUB_TOKEN || '',
      gitHubOrg: process.env.GITHUB_ORG || '',
      jobDistribution: {
        enabled: true,
        maxConcurrentJobs: 100,
        maxQueuedJobs: 1000,
        enableDependencyExecution: true,
        enableResourceAwareScheduling: true,
        enableLoadBalancing: true
      },
      docker: {
        enabled: true,
        socketPath: '/var/run/docker.sock',
        networkConfig: {
          defaultDriver: 'bridge',
          enableMonitoring: true
        },
        volumeConfig: {
          defaultDriver: 'local',
          enableCleanup: true
        }
      },
      scaling: {
        autoScaling: true,
        minContainers: 5,
        maxContainers: 200,
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.3,
        cooldownPeriod: 300000
      }
    },
    webhook: {
      enabled: true,
      port: parseInt(process.env.WEBHOOK_PORT || '3000'),
      path: process.env.WEBHOOK_PATH || '/webhook',
      secret: process.env.GITHUB_WEBHOOK_SECRET || ''
    },
    monitoring: {
      enabled: true,
      metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
      healthCheckPort: parseInt(process.env.HEALTH_PORT || '8080')
    },
    features: {
      jobDistribution: true,
      dockerIntegration: true,
      autoScaling: true,
      legacyCompatibility: true
    }
  };

  const mergedConfig = { ...defaultConfig, ...config };
  return OrchestrationIntegration.getInstance(mergedConfig);
}

// Convenience function to create a complete orchestration system
export async function createOrchestratedRunnerHub(config?: {
  orchestrator?: Partial<EnhancedOrchestratorConfig>;
  integration?: Partial<IntegrationConfig>;
}) {
  const integration = createOrchestrationIntegration(config?.integration);
  await integration.initialize();
  
  return {
    integration,
    health: () => integration.getSystemHealth(),
    metrics: () => integration.getSystemMetrics(),
    getJobStatus: (jobId: string) => integration.getJobStatus(jobId),
    cancelJob: (jobId: string) => integration.cancelJob(jobId),
    getActiveJobs: () => integration.getActiveJobs(),
    shutdown: () => integration.shutdown()
  };
}