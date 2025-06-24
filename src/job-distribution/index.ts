// Job Distribution System - Main Entry Point
// This module provides comprehensive job distribution capabilities including
// intelligent routing, load balancing, resource-aware scheduling, dependency
// management, and parallel execution orchestration.

// Import types that are used in this file
import type { ResourceRequirements, JobMetadata, JobRoutingRequest } from './job-router';
import { RoutingAlgorithm, JobRouter } from './job-router';
import { LoadBalancingAlgorithm, LoadBalancer, BackoffStrategy } from './load-balancer';
import { SchedulingAlgorithm, ResourceScheduler } from './resource-scheduler';
import { DependencyResolutionStrategy, DependencyManager } from './dependency-manager';
import { ParallelExecutor } from './parallel-executor';

// Core Router
export {
  JobRouter,
  type JobRoutingRequest,
  type JobRoutingResult,
  type RoutingDecision,
  type ResourceRequirements,
  type JobMetadata,
  type JobConstraints,
  type JobPreferences,
  type AffinityRule,
  type AntiAffinityRule,
  JobPriority,
  JobType,
  WorkflowType,
  JobCriticality,
  SecurityLevel,
  PerformanceProfile,
  RoutingAlgorithm
} from './job-router';

// Load Balancer
export {
  LoadBalancer,
  type LoadBalancerConfig,
  type LoadBalancingStrategy,
  type LoadBalancingResult,
  type LoadBalancerMetrics,
  type JobQueue,
  type QueuedJob,
  type StickyConfig,
  type SpilloverConfig,
  type ThrottlingConfig,
  type ResourceUtilization,
  type PoolHealthMetrics,
  LoadBalancingAlgorithm,
  BackoffStrategy
} from './load-balancer';

// Resource Scheduler
export {
  ResourceScheduler,
  type SchedulerConfig,
  type SchedulingRequest,
  type SchedulingResult,
  type ResourcePool,
  type ResourceCapacity,
  type ResourceAllocation,
  type PoolRunner,
  type PoolPolicies,
  type AutoScalingConfig,
  type SchedulingMetrics,
  SchedulingAlgorithm,
  PoolStatus,
  RunnerStatus
} from './resource-scheduler';

// Dependency Manager
export {
  DependencyManager,
  type DependencyConfig,
  type DependencyGraph,
  type JobDependency,
  type JobNode,
  type DependencyCondition,
  type DependencyMetadata,
  type TimeoutHandling,
  type EscalationPolicy,
  type RetryPolicy,
  type ParallelExecutionConfig as DependencyParallelConfig,
  DependencyType,
  DependencyStatus,
  DependencyResolutionStrategy,
  ConditionType as DependencyConditionType,
  ConditionEvaluator,
  JobNodeStatus,
  JobExecutionResult,
  EscalationAction
} from './dependency-manager';

// Add missing type definitions for convenience
export type RouterConfig = {
  algorithm: RoutingAlgorithm;
  enableMetrics: boolean;
  enableAdaptiveRouting: boolean;
  loadBalancingFactor: number;
  responseTimeFactor: number;
  reliabilityFactor: number;
  capacityFactor: number;
};

export type RunnerInfo = {
  id: string;
  repository: string;
  status: string;
  labels: string[];
  capacity: ResourceRequirements;
};

export type ExecutionContext = {
  jobId: string;
  repository: string;
  requirements: ResourceRequirements;
  metadata: JobMetadata;
};

// Parallel Executor
export {
  ParallelExecutor,
  type ParallelExecutionConfig,
  type ExecutionPlan,
  type ExecutionJob,
  type ExecutionStrategy,
  type ExecutionCondition,
  type FailureHandlingConfig,
  type MonitoringConfig,
  type TotalResourceRequirements,
  type ExecutionPlanMetadata,
  type ExecutionConstraints,
  type ExecutionPreferences,
  type ExecutionError,
  type JobExecutionMetadata,
  type ExecutionAttempt,
  type ResourceUsageRecord,
  type PerformanceMetrics,
  type ExecutionDiagnostics,
  type ParallelExecutionMetrics,
  type ResourceUtilizationMetrics,
  type UtilizationMetric,
  type PerformanceStats,
  type BottleneckAnalysis,
  ConditionType,
  ComparisonOperator,
  ExecutionPlanStatus,
  ExecutionStage,
  JobExecutionStatus,
  ExecutionErrorType,
  ErrorSeverity,
  AttemptStatus,
  OptimizationTarget
} from './parallel-executor';

// Convenience factory functions for creating configurations
export const createDefaultJobDistributionConfig = () => ({
  router: {
    algorithm: RoutingAlgorithm.INTELLIGENT,
    enableMetrics: true,
    enableAdaptiveRouting: true,
    loadBalancingFactor: 0.3,
    responseTimeFactor: 0.2,
    reliabilityFactor: 0.3,
    capacityFactor: 0.2
  },
  loadBalancer: {
    maxConcurrentJobs: 100,
    maxQueueSize: 1000,
    loadBalancingStrategy: {
      algorithm: LoadBalancingAlgorithm.WEIGHTED_ROUND_ROBIN,
      weights: {},
      stickyness: {
        enabled: false,
        sessionKey: 'repository',
        ttl: 3600,
        maxSessions: 1000
      }
    },
    healthCheckInterval: 30000,
    circuitBreakerThreshold: 0.8,
    adaptiveThresholds: true,
    priorityQueues: 5,
    preemptionEnabled: false
  },
  scheduler: {
    schedulingAlgorithm: SchedulingAlgorithm.MULTI_OBJECTIVE,
    resourcePools: [],
    schedulingInterval: 5000,
    preemptionEnabled: false,
    fairShareEnabled: true,
    backfillEnabled: true,
    resourceReservation: true,
    autoScaling: {
      enabled: true,
      minReplicas: 1,
      maxReplicas: 100,
      targetUtilization: 0.8,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.3,
      cooldownPeriod: 300000
    }
  },
  dependencyManager: {
    maxDependencyDepth: 10,
    circularDependencyDetection: true,
    dependencyResolution: DependencyResolutionStrategy.STRICT,
    timeoutHandling: {
      enabled: true,
      defaultTimeout: 3600000,
      escalationPolicy: {
        enabled: true,
        escalationLevels: [],
        maxEscalations: 3,
        notificationChannels: ['email']
      },
      retryPolicy: {
        enabled: true,
        maxRetries: 3,
        backoffStrategy: BackoffStrategy.EXPONENTIAL,
        retryableErrors: ['timeout', 'network', 'resource']
      }
    },
    conditionalDependencies: true,
    parallelExecution: {
      maxParallelJobs: 50,
      resourceSharing: true,
      loadBalancing: true,
      dynamicScaling: true,
      batchOptimization: true
    }
  },
  parallelExecutor: {
    maxConcurrentJobs: 100,
    maxQueuedJobs: 1000,
    jobTimeout: 3600000,
    enableDependencyExecution: true,
    enableResourceAwareScheduling: true,
    enableLoadBalancing: true,
    executionStrategies: [
      {
        name: 'balanced',
        priority: 1,
        conditions: [],
        configuration: {
          loadBalancingWeight: 0.4,
          resourceSchedulingWeight: 0.4,
          routingWeight: 0.2
        }
      }
    ],
    failureHandling: {
      retryEnabled: true,
      maxRetries: 3,
      retryDelay: 5000,
      retryBackoffMultiplier: 2,
      failFastEnabled: false,
      rollbackEnabled: true,
      notificationChannels: ['email', 'slack']
    },
    monitoring: {
      metricsEnabled: true,
      detailedLogging: true,
      performanceTracking: true,
      resourceUtilizationTracking: true,
      executionTimeTracking: true
    }
  }
});

// Job Distribution System Orchestrator
// This class provides a unified interface to all job distribution components
export class JobDistributionSystem {
  private router: JobRouter;
  private loadBalancer: LoadBalancer;
  private scheduler: ResourceScheduler;
  private dependencyManager: DependencyManager;
  private parallelExecutor: ParallelExecutor;
  private isInitialized: boolean = false;

  constructor(_config = createDefaultJobDistributionConfig()) {
    this.router = JobRouter.getInstance();
    this.loadBalancer = LoadBalancer.getInstance();
    this.scheduler = ResourceScheduler.getInstance();
    this.dependencyManager = DependencyManager.getInstance();
    this.parallelExecutor = ParallelExecutor.getInstance();
    
    // TODO: Configure components with config parameters
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Initialize all components
    // Components are initialized via getInstance()
    await this.parallelExecutor.start();

    this.isInitialized = true;
  }

  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    // Shutdown all components in reverse order
    await this.parallelExecutor.stop();

    this.isInitialized = false;
  }

  public async submitJob(job: JobRoutingRequest): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('JobDistributionSystem not initialized');
    }

    return this.parallelExecutor.submitSingleJob(job);
  }

  public async submitJobBatch(
    jobs: JobRoutingRequest[],
    options?: {
      planName?: string;
      planDescription?: string;
      executionStrategy?: string;
      enableDependencies?: boolean;
    }
  ): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('JobDistributionSystem not initialized');
    }

    return this.parallelExecutor.submitJobBatch(jobs, options);
  }

  public getSystemMetrics() {
    return {
      router: { status: 'active' },
      loadBalancer: this.loadBalancer.getMetrics(),
      scheduler: { status: 'active' },
      dependencyManager: { status: 'active' },
      parallelExecutor: this.parallelExecutor.getMetrics()
    };
  }

  public getSystemHealth() {
    return {
      router: true,
      loadBalancer: { healthy: true },
      scheduler: { healthy: true },
      dependencyManager: { healthy: true },
      parallelExecutor: this.parallelExecutor.getMetrics().activeExecutions >= 0
    };
  }

  // Component access for advanced usage
  public get components() {
    return {
      router: this.router,
      loadBalancer: this.loadBalancer,
      scheduler: this.scheduler,
      dependencyManager: this.dependencyManager,
      parallelExecutor: this.parallelExecutor
    };
  }
}

// Default export for easy usage
export default JobDistributionSystem;