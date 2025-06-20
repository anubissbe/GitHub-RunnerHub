// Job related types
export interface Job {
  id: string;
  jobId: string;
  runId: string;
  repository: string;
  workflow: string;
  status: JobStatus;
  runnerName?: string;
  assignedRunnerId?: string;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobContext {
  jobId: string;
  runId: string;
  repository: string;
  workflow: string;
  runnerName: string;
  sha?: string;
  ref?: string;
  eventName?: string;
  actor?: string;
  labels: string[];
  environment?: Record<string, string>;
  secrets?: Record<string, string>;
  matrix?: Record<string, any>;
  needs?: string[];
}

export interface DelegatedJob extends JobContext {
  id: string;
  githubJobId: number;
  status: JobStatus;
  runnerId?: string;
  containerId?: string;
  startedAt?: Date;
  completedAt?: Date;
  exitCode?: number;
  logs?: string;
  metadata?: Record<string, any>;
}

export enum JobStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  ASSIGNED = 'assigned',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// Runner related types
export interface Runner {
  id: string;
  name: string;
  type: RunnerType;
  status: RunnerStatus;
  containerId?: string;
  labels: string[];
  repository?: string;
  githubRunnerId?: number;
  registrationToken?: string;
  lastHeartbeat: Date;
  createdAt: Date;
  updatedAt: Date;
}

export enum RunnerType {
  PROXY = 'proxy',
  EPHEMERAL = 'ephemeral',
  DEDICATED = 'dedicated'
}

export enum RunnerStatus {
  IDLE = 'idle',
  BUSY = 'busy',
  OFFLINE = 'offline',
  STARTING = 'starting',
  STOPPING = 'stopping'
}

// Runner pool types
export interface RunnerPool {
  id: string;
  repository: string;
  minRunners: number;
  maxRunners: number;
  currentRunners: number;
  scaleIncrement: number;
  scaleThreshold: number;
  lastScaledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScalingDecision {
  shouldScale: boolean;
  currentUtilization: number;
  runnersToAdd: number;
  reason: string;
}

// API types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Docker types
export interface ContainerConfig {
  image: string;
  name: string;
  env: Record<string, string>;
  labels: Record<string, string>;
  networks: string[];
  volumes?: string[];
  cpuLimit?: number;
  memoryLimit?: string;
  autoRemove?: boolean;
}

// Metrics types
export interface Metric {
  id: string;
  type: MetricType;
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: Date;
}

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary'
}

// Audit types
export interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

// Network isolation types
export interface NetworkIsolation {
  id: string;
  repository: string;
  networkName: string;
  subnet: string;
  gateway: string;
  dnsServers: string[];
  allowedEgress: EgressRule[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EgressRule {
  destination: string;
  port?: number;
  protocol: 'tcp' | 'udp' | 'any';
  description?: string;
}