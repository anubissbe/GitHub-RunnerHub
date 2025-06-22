/**
 * GitHub RunnerHub Orchestrator System
 * 
 * Advanced container orchestration for GitHub Actions replacing traditional dedicated runners
 * with intelligent container assignment, load balancing, and real-time status reporting.
 */

// Core Orchestrator Components
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