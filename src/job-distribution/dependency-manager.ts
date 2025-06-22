import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import { JobRoutingRequest, JobPriority } from './job-router';

const logger = createLogger('DependencyManager');

export interface DependencyConfig {
  maxDependencyDepth: number;
  timeoutHandling: TimeoutHandling;
  circularDependencyDetection: boolean;
  dependencyResolution: DependencyResolutionStrategy;
  parallelExecution: ParallelExecutionConfig;
  conditionalDependencies: boolean;
}

export interface TimeoutHandling {
  enabled: boolean;
  defaultTimeout: number; // milliseconds
  escalationPolicy: EscalationPolicy;
  retryPolicy: RetryPolicy;
}

export interface EscalationPolicy {
  enabled: boolean;
  escalationLevels: EscalationLevel[];
  maxEscalations: number;
  notificationChannels: string[];
}

export interface EscalationLevel {
  timeThreshold: number; // milliseconds
  action: EscalationAction;
  notifyUsers: string[];
  fallbackJob?: string;
}

export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;
  backoffStrategy: BackoffStrategy;
  retryableErrors: string[];
}

export interface ParallelExecutionConfig {
  maxParallelJobs: number;
  resourceSharing: boolean;
  loadBalancing: boolean;
  dynamicScaling: boolean;
  batchOptimization: boolean;
}

export interface JobDependency {
  id: string;
  sourceJobId: string;
  targetJobId: string;
  dependencyType: DependencyType;
  condition?: DependencyCondition;
  metadata: DependencyMetadata;
  status: DependencyStatus;
  createdAt: Date;
  resolvedAt?: Date;
  timeoutAt?: Date;
}

export interface DependencyCondition {
  type: ConditionType;
  expression: string;
  variables: Record<string, any>;
  evaluator: ConditionEvaluator;
}

export interface DependencyMetadata {
  description: string;
  priority: number; // 1-10, 10 being highest
  optional: boolean;
  timeout: number; // milliseconds
  retryable: boolean;
  tags: string[];
}

export interface JobNode {
  jobId: string;
  job: JobRoutingRequest;
  dependencies: string[]; // Job IDs this job depends on
  dependents: string[]; // Job IDs that depend on this job
  status: JobNodeStatus;
  startTime?: Date;
  endTime?: Date;
  result?: JobExecutionResult;
  metadata: JobNodeMetadata;
}

export interface JobNodeMetadata {
  depth: number; // Distance from root nodes
  fanIn: number; // Number of dependencies
  fanOut: number; // Number of dependents
  criticalPath: boolean; // Is on critical path
  estimatedDuration: number;
  actualDuration?: number;
  resourceRequirements: any;
}

export interface JobExecutionResult {
  success: boolean;
  exitCode?: number;
  output?: string;
  error?: string;
  metrics: ExecutionMetrics;
}

export interface ExecutionMetrics {
  startTime: Date;
  endTime: Date;
  duration: number; // milliseconds
  resourceUsage: ResourceUsageMetrics;
  performance: PerformanceMetrics;
}

export interface ResourceUsageMetrics {
  peakCpu: number; // 0-1
  peakMemory: number; // bytes
  peakDisk: number; // bytes
  networkIO: number; // bytes
  avgCpu: number;
  avgMemory: number;
}

export interface PerformanceMetrics {
  throughput: number;
  latency: number;
  errorRate: number;
  efficiency: number; // 0-1
}

export interface DependencyGraph {
  nodes: Map<string, JobNode>;
  edges: Map<string, JobDependency>;
  roots: string[]; // Jobs with no dependencies
  leaves: string[]; // Jobs with no dependents
  layers: string[][]; // Jobs grouped by execution layer
  criticalPath: string[]; // Longest path through graph
  metadata: GraphMetadata;
}

export interface GraphMetadata {
  totalJobs: number;
  maxDepth: number;
  totalDependencies: number;
  cycleDetected: boolean;
  estimatedDuration: number;
  parallelismFactor: number; // Average parallelism
  complexity: GraphComplexity;
}

export interface DependencyResolutionResult {
  success: boolean;
  readyJobs: string[]; // Jobs ready to execute
  blockedJobs: string[]; // Jobs blocked by dependencies
  failedJobs: string[]; // Jobs that failed dependency resolution
  warnings: string[];
  graph: DependencyGraph;
  executionPlan: ExecutionPlan;
}

export interface ExecutionPlan {
  phases: ExecutionPhase[];
  estimatedDuration: number;
  parallelism: number[];
  resourceRequirements: any;
  criticalPath: string[];
  optimizations: PlanOptimization[];
}

export interface ExecutionPhase {
  phaseId: number;
  jobs: string[];
  estimatedDuration: number;
  parallelizable: boolean;
  resourceRequirements: any;
  constraints: PhaseConstraints;
}

export interface PhaseConstraints {
  maxParallelJobs: number;
  resourceLimits: any;
  timeConstraints?: {
    earliestStart?: Date;
    latestEnd?: Date;
  };
}

export interface PlanOptimization {
  type: OptimizationType;
  description: string;
  estimatedSavings: number; // milliseconds
  riskLevel: RiskLevel;
  applicableJobs: string[];
}

export enum DependencyType {
  SEQUENTIAL = 'sequential',
  CONDITIONAL = 'conditional',
  RESOURCE = 'resource',
  DATA = 'data',
  TEMPORAL = 'temporal',
  APPROVAL = 'approval'
}

export enum DependencyStatus {
  PENDING = 'pending',
  SATISFIED = 'satisfied',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled'
}

export enum JobNodeStatus {
  WAITING = 'waiting',
  READY = 'ready',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  SKIPPED = 'skipped'
}

export enum ConditionType {
  SUCCESS = 'success',
  FAILURE = 'failure',
  ALWAYS = 'always',
  CUSTOM = 'custom',
  EXPRESSION = 'expression'
}

export enum ConditionEvaluator {
  JAVASCRIPT = 'javascript',
  JSON_PATH = 'jsonpath',
  REGEX = 'regex',
  COMPARISON = 'comparison'
}

export enum DependencyResolutionStrategy {
  STRICT = 'strict',
  LENIENT = 'lenient',
  OPTIMISTIC = 'optimistic',
  ADAPTIVE = 'adaptive'
}

export enum EscalationAction {
  NOTIFY = 'notify',
  RETRY = 'retry',
  SKIP = 'skip',
  FALLBACK = 'fallback',
  CANCEL = 'cancel'
}

export enum BackoffStrategy {
  LINEAR = 'linear',
  EXPONENTIAL = 'exponential',
  FIBONACCI = 'fibonacci',
  FIXED = 'fixed'
}

export enum GraphComplexity {
  SIMPLE = 'simple',
  MODERATE = 'moderate',
  COMPLEX = 'complex',
  VERY_COMPLEX = 'very_complex'
}

export enum OptimizationType {
  PARALLEL_EXECUTION = 'parallel-execution',
  RESOURCE_SHARING = 'resource-sharing',
  BATCH_PROCESSING = 'batch-processing',
  DEPENDENCY_ELIMINATION = 'dependency-elimination',
  CRITICAL_PATH_OPTIMIZATION = 'critical-path-optimization'
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export class DependencyManager extends EventEmitter {
  private static instance: DependencyManager;
  private config: DependencyConfig;
  private dependencyGraphs: Map<string, DependencyGraph> = new Map();
  private activeDependencies: Map<string, JobDependency> = new Map();
  private jobNodes: Map<string, JobNode> = new Map();
  private executionPlans: Map<string, ExecutionPlan> = new Map();
  private timeoutCheckers: Map<string, NodeJS.Timeout> = new Map();

  private constructor(config: DependencyConfig) {
    super();
    this.config = config;
  }

  public static getInstance(config?: DependencyConfig): DependencyManager {
    if (!DependencyManager.instance) {
      const defaultConfig: DependencyConfig = {
        maxDependencyDepth: 10,
        timeoutHandling: {
          enabled: true,
          defaultTimeout: 3600000, // 1 hour
          escalationPolicy: {
            enabled: true,
            escalationLevels: [
              {
                timeThreshold: 1800000, // 30 minutes
                action: EscalationAction.NOTIFY,
                notifyUsers: ['admin']
              }
            ],
            maxEscalations: 3,
            notificationChannels: ['email', 'slack']
          },
          retryPolicy: {
            enabled: true,
            maxRetries: 3,
            backoffStrategy: BackoffStrategy.EXPONENTIAL,
            retryableErrors: ['timeout', 'network-error', 'temporary-failure']
          }
        },
        circularDependencyDetection: true,
        dependencyResolution: DependencyResolutionStrategy.ADAPTIVE,
        parallelExecution: {
          maxParallelJobs: 50,
          resourceSharing: true,
          loadBalancing: true,
          dynamicScaling: true,
          batchOptimization: true
        },
        conditionalDependencies: true
      };

      DependencyManager.instance = new DependencyManager(config || defaultConfig);
    }
    return DependencyManager.instance;
  }

  /**
   * Create dependency graph from job requests
   */
  public async createDependencyGraph(
    graphId: string,
    jobs: JobRoutingRequest[]
  ): Promise<DependencyGraph> {
    logger.info(`Creating dependency graph ${graphId} with ${jobs.length} jobs`);

    const graph: DependencyGraph = {
      nodes: new Map(),
      edges: new Map(),
      roots: [],
      leaves: [],
      layers: [],
      criticalPath: [],
      metadata: {
        totalJobs: jobs.length,
        maxDepth: 0,
        totalDependencies: 0,
        cycleDetected: false,
        estimatedDuration: 0,
        parallelismFactor: 1,
        complexity: GraphComplexity.SIMPLE
      }
    };

    // Create job nodes
    for (const job of jobs) {
      const node = this.createJobNode(job);
      graph.nodes.set(job.jobId, node);
      this.jobNodes.set(job.jobId, node);
    }

    // Create dependencies
    for (const job of jobs) {
      if (job.needs && job.needs.length > 0) {
        for (const dependsOn of job.needs) {
          const dependency = this.createDependency(dependsOn, job.jobId);
          graph.edges.set(dependency.id, dependency);
          this.activeDependencies.set(dependency.id, dependency);

          // Update node connections
          const sourceNode = graph.nodes.get(dependsOn);
          const targetNode = graph.nodes.get(job.jobId);
          
          if (sourceNode && targetNode) {
            sourceNode.dependents.push(job.jobId);
            targetNode.dependencies.push(dependsOn);
          }
        }
      }
    }

    // Analyze graph structure
    await this.analyzeGraph(graph);

    // Detect cycles
    if (this.config.circularDependencyDetection) {
      graph.metadata.cycleDetected = this.detectCycles(graph);
      if (graph.metadata.cycleDetected) {
        throw new Error('Circular dependency detected in job graph');
      }
    }

    // Calculate execution layers
    this.calculateExecutionLayers(graph);

    // Find critical path
    this.calculateCriticalPath(graph);

    // Store graph
    this.dependencyGraphs.set(graphId, graph);

    logger.info(`Created dependency graph ${graphId} with ${graph.metadata.totalDependencies} dependencies`);
    return graph;
  }

  /**
   * Resolve dependencies and get ready jobs
   */
  public async resolveDependencies(graphId: string): Promise<DependencyResolutionResult> {
    const graph = this.dependencyGraphs.get(graphId);
    if (!graph) {
      throw new Error(`Dependency graph not found: ${graphId}`);
    }

    logger.info(`Resolving dependencies for graph ${graphId}`);

    const result: DependencyResolutionResult = {
      success: true,
      readyJobs: [],
      blockedJobs: [],
      failedJobs: [],
      warnings: [],
      graph,
      executionPlan: await this.createExecutionPlan(graph)
    };

    // Check each job's dependencies
    for (const [jobId, node] of graph.nodes.entries()) {
      try {
        const resolutionStatus = await this.resolveJobDependencies(node, graph);
        
        switch (resolutionStatus) {
          case DependencyStatus.SATISFIED:
            if (node.status === JobNodeStatus.WAITING) {
              result.readyJobs.push(jobId);
              node.status = JobNodeStatus.READY;
            }
            break;
          
          case DependencyStatus.PENDING:
            result.blockedJobs.push(jobId);
            break;
          
          case DependencyStatus.FAILED:
          case DependencyStatus.TIMEOUT:
            result.failedJobs.push(jobId);
            node.status = JobNodeStatus.FAILED;
            result.success = false;
            break;
        }
      } catch (error) {
        logger.error(`Failed to resolve dependencies for job ${jobId}:`, error);
        result.failedJobs.push(jobId);
        result.warnings.push(`Dependency resolution failed for ${jobId}: ${error}`);
        result.success = false;
      }
    }

    // Emit dependency resolution event
    this.emit('dependencies:resolved', { graphId, result });

    return result;
  }

  /**
   * Resolve dependencies for a specific job
   */
  private async resolveJobDependencies(node: JobNode, graph: DependencyGraph): Promise<DependencyStatus> {
    if (node.dependencies.length === 0) {
      return DependencyStatus.SATISFIED;
    }

    let allSatisfied = true;
    let anyFailed = false;

    for (const depJobId of node.dependencies) {
      const depNode = graph.nodes.get(depJobId);
      if (!depNode) {
        logger.warn(`Dependency job not found: ${depJobId}`);
        anyFailed = true;
        continue;
      }

      // Find the dependency edge
      const dependency = this.findDependency(depJobId, node.jobId, graph);
      if (!dependency) {
        logger.warn(`Dependency edge not found: ${depJobId} -> ${node.jobId}`);
        anyFailed = true;
        continue;
      }

      // Check dependency status
      const status = await this.checkDependencyStatus(dependency, depNode);
      dependency.status = status;

      switch (status) {
        case DependencyStatus.SATISFIED:
          // Dependency satisfied, continue checking
          break;
        
        case DependencyStatus.PENDING:
          allSatisfied = false;
          break;
        
        case DependencyStatus.FAILED:
        case DependencyStatus.TIMEOUT:
          anyFailed = true;
          break;
      }
    }

    if (anyFailed) {
      return DependencyStatus.FAILED;
    }

    return allSatisfied ? DependencyStatus.SATISFIED : DependencyStatus.PENDING;
  }

  /**
   * Check status of a specific dependency
   */
  private async checkDependencyStatus(dependency: JobDependency, depNode: JobNode): Promise<DependencyStatus> {
    // Check timeout
    if (dependency.timeoutAt && new Date() > dependency.timeoutAt) {
      return DependencyStatus.TIMEOUT;
    }

    // Check if dependency job completed successfully
    if (depNode.status === JobNodeStatus.COMPLETED && depNode.result?.success) {
      // Check conditional dependencies
      if (dependency.condition) {
        const conditionMet = await this.evaluateCondition(dependency.condition, depNode);
        return conditionMet ? DependencyStatus.SATISFIED : DependencyStatus.FAILED;
      }
      
      return DependencyStatus.SATISFIED;
    }

    // Check for failure
    if (depNode.status === JobNodeStatus.FAILED || 
        (depNode.status === JobNodeStatus.COMPLETED && !depNode.result?.success)) {
      
      // Handle optional dependencies
      if (dependency.metadata.optional) {
        return DependencyStatus.SATISFIED;
      }
      
      return DependencyStatus.FAILED;
    }

    // Check for cancellation
    if (depNode.status === JobNodeStatus.CANCELLED) {
      return dependency.metadata.optional ? DependencyStatus.SATISFIED : DependencyStatus.FAILED;
    }

    // Dependency is still pending
    return DependencyStatus.PENDING;
  }

  /**
   * Evaluate conditional dependency
   */
  private async evaluateCondition(condition: DependencyCondition, depNode: JobNode): Promise<boolean> {
    if (!this.config.conditionalDependencies) {
      return true; // Always satisfied if conditional dependencies disabled
    }

    try {
      switch (condition.type) {
        case ConditionType.SUCCESS:
          return depNode.result?.success === true;
        
        case ConditionType.FAILURE:
          return depNode.result?.success === false;
        
        case ConditionType.ALWAYS:
          return true;
        
        case ConditionType.CUSTOM:
          return await this.evaluateCustomCondition(condition, depNode);
        
        case ConditionType.EXPRESSION:
          return await this.evaluateExpressionCondition(condition, depNode);
        
        default:
          logger.warn(`Unknown condition type: ${condition.type}`);
          return false;
      }
    } catch (error) {
      logger.error('Error evaluating dependency condition:', error);
      return false;
    }
  }

  /**
   * Evaluate custom condition
   */
  private async evaluateCustomCondition(condition: DependencyCondition, depNode: JobNode): Promise<boolean> {
    switch (condition.evaluator) {
      case ConditionEvaluator.JAVASCRIPT:
        return this.evaluateJavaScriptCondition(condition.expression, depNode, condition.variables);
      
      case ConditionEvaluator.JSON_PATH:
        return this.evaluateJsonPathCondition(condition.expression, depNode);
      
      case ConditionEvaluator.REGEX:
        return this.evaluateRegexCondition(condition.expression, depNode);
      
      case ConditionEvaluator.COMPARISON:
        return this.evaluateComparisonCondition(condition.expression, depNode, condition.variables);
      
      default:
        return false;
    }
  }

  /**
   * Evaluate expression condition
   */
  private async evaluateExpressionCondition(condition: DependencyCondition, depNode: JobNode): Promise<boolean> {
    // Simple expression evaluation - in production would use a proper expression parser
    const expression = condition.expression.toLowerCase();
    
    if (expression.includes('success')) {
      return depNode.result?.success === true;
    }
    
    if (expression.includes('failure') || expression.includes('failed')) {
      return depNode.result?.success === false;
    }
    
    if (expression.includes('exit_code')) {
      const exitCodeMatch = expression.match(/exit_code\s*==\s*(\d+)/);
      if (exitCodeMatch) {
        const expectedCode = parseInt(exitCodeMatch[1]);
        return depNode.result?.exitCode === expectedCode;
      }
    }
    
    return true; // Default to satisfied
  }

  /**
   * Mark job as completed and update dependents
   */
  public async markJobCompleted(
    jobId: string,
    result: JobExecutionResult
  ): Promise<void> {
    const node = this.jobNodes.get(jobId);
    if (!node) {
      throw new Error(`Job node not found: ${jobId}`);
    }

    logger.info(`Marking job ${jobId} as completed with success: ${result.success}`);

    // Update node status
    node.status = JobNodeStatus.COMPLETED;
    node.endTime = new Date();
    node.result = result;
    node.metadata.actualDuration = result.duration;

    // Clear any timeout timers
    const timeoutId = this.timeoutCheckers.get(jobId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeoutCheckers.delete(jobId);
    }

    // Update dependencies that this job satisfies
    for (const dependency of this.activeDependencies.values()) {
      if (dependency.sourceJobId === jobId) {
        if (result.success) {
          dependency.status = DependencyStatus.SATISFIED;
          dependency.resolvedAt = new Date();
        } else {
          dependency.status = DependencyStatus.FAILED;
        }
      }
    }

    // Emit job completion event
    this.emit('job:completed', { jobId, result });

    // Trigger dependency resolution for dependent jobs
    for (const dependentJobId of node.dependents) {
      this.emit('dependency:check', { jobId: dependentJobId });
    }
  }

  /**
   * Mark job as failed and handle failure propagation
   */
  public async markJobFailed(
    jobId: string,
    error: string,
    propagateFailure = true
  ): Promise<void> {
    const node = this.jobNodes.get(jobId);
    if (!node) {
      throw new Error(`Job node not found: ${jobId}`);
    }

    logger.info(`Marking job ${jobId} as failed: ${error}`);

    // Update node status
    node.status = JobNodeStatus.FAILED;
    node.endTime = new Date();
    node.result = {
      success: false,
      error,
      metrics: {
        startTime: node.startTime || new Date(),
        endTime: new Date(),
        duration: node.startTime ? Date.now() - node.startTime.getTime() : 0,
        resourceUsage: {
          peakCpu: 0,
          peakMemory: 0,
          peakDisk: 0,
          networkIO: 0,
          avgCpu: 0,
          avgMemory: 0
        },
        performance: {
          throughput: 0,
          latency: 0,
          errorRate: 1.0,
          efficiency: 0
        }
      }
    };

    // Update dependencies
    for (const dependency of this.activeDependencies.values()) {
      if (dependency.sourceJobId === jobId) {
        dependency.status = dependency.metadata.optional ? 
          DependencyStatus.SATISFIED : DependencyStatus.FAILED;
      }
    }

    // Handle failure propagation
    if (propagateFailure) {
      await this.propagateFailure(jobId);
    }

    this.emit('job:failed', { jobId, error });
  }

  /**
   * Propagate failure to dependent jobs
   */
  private async propagateFailure(jobId: string): Promise<void> {
    const node = this.jobNodes.get(jobId);
    if (!node) return;

    const strategy = this.config.dependencyResolution;

    for (const dependentJobId of node.dependents) {
      const dependentNode = this.jobNodes.get(dependentJobId);
      if (!dependentNode) continue;

      // Check if dependent job has alternative paths
      const hasAlternativePaths = await this.hasAlternativeDependencyPaths(dependentJobId, jobId);

      switch (strategy) {
        case DependencyResolutionStrategy.STRICT:
          // Always fail dependent jobs
          await this.markJobFailed(dependentJobId, `Dependency failed: ${jobId}`, true);
          break;

        case DependencyResolutionStrategy.LENIENT:
          // Skip dependent jobs but don't fail them
          if (!hasAlternativePaths) {
            dependentNode.status = JobNodeStatus.SKIPPED;
            this.emit('job:skipped', { jobId: dependentJobId, reason: `Dependency failed: ${jobId}` });
          }
          break;

        case DependencyResolutionStrategy.OPTIMISTIC:
          // Try to continue with optional dependencies
          const hasRequiredDependencies = await this.hasRequiredDependencies(dependentJobId, jobId);
          if (hasRequiredDependencies) {
            await this.markJobFailed(dependentJobId, `Required dependency failed: ${jobId}`, true);
          }
          break;

        case DependencyResolutionStrategy.ADAPTIVE:
          // Use intelligent decision based on job importance and alternatives
          const shouldFail = await this.shouldFailDependentJob(dependentJobId, jobId);
          if (shouldFail) {
            await this.markJobFailed(dependentJobId, `Critical dependency failed: ${jobId}`, true);
          } else {
            dependentNode.status = JobNodeStatus.SKIPPED;
          }
          break;
      }
    }
  }

  /**
   * Create execution plan for the dependency graph
   */
  private async createExecutionPlan(graph: DependencyGraph): Promise<ExecutionPlan> {
    const phases: ExecutionPhase[] = [];
    let totalDuration = 0;
    const parallelism: number[] = [];

    // Create phases from execution layers
    for (let i = 0; i < graph.layers.length; i++) {
      const layer = graph.layers[i];
      const phase: ExecutionPhase = {
        phaseId: i,
        jobs: layer,
        estimatedDuration: this.calculateLayerDuration(layer),
        parallelizable: layer.length > 1,
        resourceRequirements: this.aggregateResourceRequirements(layer),
        constraints: {
          maxParallelJobs: Math.min(layer.length, this.config.parallelExecution.maxParallelJobs),
          resourceLimits: {}
        }
      };

      phases.push(phase);
      totalDuration += phase.estimatedDuration;
      parallelism.push(layer.length);
    }

    // Identify optimizations
    const optimizations = this.identifyOptimizations(graph, phases);

    return {
      phases,
      estimatedDuration: totalDuration,
      parallelism,
      resourceRequirements: this.aggregateResourceRequirements(Array.from(graph.nodes.keys())),
      criticalPath: graph.criticalPath,
      optimizations
    };
  }

  /**
   * Calculate execution layers (topological sort)
   */
  private calculateExecutionLayers(graph: DependencyGraph): void {
    const layers: string[][] = [];
    const visited = new Set<string>();
    const inDegree = new Map<string, number>();

    // Calculate in-degrees
    for (const [jobId, node] of graph.nodes.entries()) {
      inDegree.set(jobId, node.dependencies.length);
    }

    // Process layers
    while (visited.size < graph.nodes.size) {
      const currentLayer: string[] = [];

      // Find nodes with no incoming edges
      for (const [jobId, degree] of inDegree.entries()) {
        if (degree === 0 && !visited.has(jobId)) {
          currentLayer.push(jobId);
        }
      }

      if (currentLayer.length === 0) {
        // Possible cycle or error
        break;
      }

      // Add to layers and mark as visited
      layers.push(currentLayer);
      for (const jobId of currentLayer) {
        visited.add(jobId);
        
        // Reduce in-degree of dependents
        const node = graph.nodes.get(jobId)!;
        for (const dependentId of node.dependents) {
          const currentDegree = inDegree.get(dependentId) || 0;
          inDegree.set(dependentId, currentDegree - 1);
        }
      }
    }

    graph.layers = layers;
    graph.metadata.maxDepth = layers.length;

    // Update node metadata
    for (let i = 0; i < layers.length; i++) {
      for (const jobId of layers[i]) {
        const node = graph.nodes.get(jobId)!;
        node.metadata.depth = i;
      }
    }
  }

  /**
   * Calculate critical path through the graph
   */
  private calculateCriticalPath(graph: DependencyGraph): void {
    const distances = new Map<string, number>();
    const predecessors = new Map<string, string>();

    // Initialize distances
    for (const jobId of graph.nodes.keys()) {
      distances.set(jobId, 0);
    }

    // Calculate longest paths (critical path)
    for (const layer of graph.layers) {
      for (const jobId of layer) {
        const node = graph.nodes.get(jobId)!;
        const currentDistance = distances.get(jobId) || 0;

        for (const dependentId of node.dependents) {
          const dependentNode = graph.nodes.get(dependentId)!;
          const newDistance = currentDistance + dependentNode.metadata.estimatedDuration;
          const existingDistance = distances.get(dependentId) || 0;

          if (newDistance > existingDistance) {
            distances.set(dependentId, newDistance);
            predecessors.set(dependentId, jobId);
          }
        }
      }
    }

    // Find the job with maximum distance (end of critical path)
    let maxDistance = 0;
    let endJob = '';
    for (const [jobId, distance] of distances.entries()) {
      if (distance > maxDistance) {
        maxDistance = distance;
        endJob = jobId;
      }
    }

    // Reconstruct critical path
    const criticalPath: string[] = [];
    let currentJob = endJob;
    while (currentJob) {
      criticalPath.unshift(currentJob);
      const node = graph.nodes.get(currentJob)!;
      node.metadata.criticalPath = true;
      currentJob = predecessors.get(currentJob) || '';
    }

    graph.criticalPath = criticalPath;
    graph.metadata.estimatedDuration = maxDistance;
  }

  /**
   * Detect cycles in the dependency graph
   */
  private detectCycles(graph: DependencyGraph): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = graph.nodes.get(nodeId);
      if (node) {
        for (const dependentId of node.dependents) {
          if (!visited.has(dependentId)) {
            if (dfs(dependentId)) {
              return true;
            }
          } else if (recursionStack.has(dependentId)) {
            return true; // Cycle detected
          }
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Create job node from job request
   */
  private createJobNode(job: JobRoutingRequest): JobNode {
    return {
      jobId: job.jobId,
      job,
      dependencies: job.needs || [],
      dependents: [],
      status: JobNodeStatus.WAITING,
      metadata: {
        depth: 0,
        fanIn: job.needs?.length || 0,
        fanOut: 0,
        criticalPath: false,
        estimatedDuration: job.metadata.estimatedDuration,
        resourceRequirements: job.resourceRequirements
      }
    };
  }

  /**
   * Create dependency between jobs
   */
  private createDependency(sourceJobId: string, targetJobId: string): JobDependency {
    const dependencyId = `${sourceJobId}->${targetJobId}`;
    
    return {
      id: dependencyId,
      sourceJobId,
      targetJobId,
      dependencyType: DependencyType.SEQUENTIAL,
      metadata: {
        description: `${targetJobId} depends on ${sourceJobId}`,
        priority: 5,
        optional: false,
        timeout: this.config.timeoutHandling.defaultTimeout,
        retryable: true,
        tags: []
      },
      status: DependencyStatus.PENDING,
      createdAt: new Date(),
      timeoutAt: new Date(Date.now() + this.config.timeoutHandling.defaultTimeout)
    };
  }

  /**
   * Find dependency edge between two jobs
   */
  private findDependency(sourceJobId: string, targetJobId: string, graph: DependencyGraph): JobDependency | null {
    const dependencyId = `${sourceJobId}->${targetJobId}`;
    return graph.edges.get(dependencyId) || null;
  }

  /**
   * Analyze graph structure and complexity
   */
  private async analyzeGraph(graph: DependencyGraph): Promise<void> {
    let totalDependencies = 0;
    let maxFanIn = 0;
    let maxFanOut = 0;

    for (const node of graph.nodes.values()) {
      totalDependencies += node.dependencies.length;
      maxFanIn = Math.max(maxFanIn, node.dependencies.length);
      maxFanOut = Math.max(maxFanOut, node.dependents.length);
    }

    graph.metadata.totalDependencies = totalDependencies;

    // Determine complexity
    if (totalDependencies < 5 && graph.nodes.size < 10) {
      graph.metadata.complexity = GraphComplexity.SIMPLE;
    } else if (totalDependencies < 20 && graph.nodes.size < 50) {
      graph.metadata.complexity = GraphComplexity.MODERATE;
    } else if (totalDependencies < 100 && graph.nodes.size < 200) {
      graph.metadata.complexity = GraphComplexity.COMPLEX;
    } else {
      graph.metadata.complexity = GraphComplexity.VERY_COMPLEX;
    }

    // Calculate parallelism factor
    const avgLayerSize = graph.layers.length > 0 ? 
      graph.layers.reduce((sum, layer) => sum + layer.length, 0) / graph.layers.length : 1;
    graph.metadata.parallelismFactor = avgLayerSize;

    // Find roots and leaves
    graph.roots = Array.from(graph.nodes.values())
      .filter(node => node.dependencies.length === 0)
      .map(node => node.jobId);

    graph.leaves = Array.from(graph.nodes.values())
      .filter(node => node.dependents.length === 0)
      .map(node => node.jobId);
  }

  /**
   * Helper methods for condition evaluation
   */
  private evaluateJavaScriptCondition(expression: string, depNode: JobNode, variables: Record<string, any>): boolean {
    try {
      // Create safe evaluation context
      const context = {
        success: depNode.result?.success,
        exitCode: depNode.result?.exitCode,
        output: depNode.result?.output,
        error: depNode.result?.error,
        duration: depNode.result?.metrics.duration,
        ...variables
      };

      // Simple expression evaluation (in production, use a safe evaluator)
      return new Function('context', `with(context) { return ${expression}; }`)(context);
    } catch (error) {
      logger.error('JavaScript condition evaluation error:', error);
      return false;
    }
  }

  private evaluateJsonPathCondition(expression: string, depNode: JobNode): boolean {
    // Simplified JSONPath evaluation
    try {
      const data = {
        result: depNode.result,
        status: depNode.status,
        metadata: depNode.metadata
      };
      
      // Basic JSONPath support (would use jsonpath library in production)
      return expression.includes('success') ? depNode.result?.success === true : false;
    } catch (error) {
      return false;
    }
  }

  private evaluateRegexCondition(expression: string, depNode: JobNode): boolean {
    try {
      const regex = new RegExp(expression);
      const output = depNode.result?.output || '';
      return regex.test(output);
    } catch (error) {
      return false;
    }
  }

  private evaluateComparisonCondition(expression: string, depNode: JobNode, variables: Record<string, any>): boolean {
    // Simple comparison evaluation
    const parts = expression.split(/\s*(==|!=|<|>|<=|>=)\s*/);
    if (parts.length !== 3) return false;

    const [left, operator, right] = parts;
    
    let leftValue: any = depNode.result?.exitCode;
    let rightValue: any = right;

    if (left === 'duration') {
      leftValue = depNode.result?.metrics.duration;
    } else if (left === 'success') {
      leftValue = depNode.result?.success;
    }

    if (variables[right] !== undefined) {
      rightValue = variables[right];
    }

    switch (operator) {
      case '==': return leftValue == rightValue;
      case '!=': return leftValue != rightValue;
      case '<': return leftValue < rightValue;
      case '>': return leftValue > rightValue;
      case '<=': return leftValue <= rightValue;
      case '>=': return leftValue >= rightValue;
      default: return false;
    }
  }

  /**
   * Helper methods for dependency analysis
   */
  private async hasAlternativeDependencyPaths(jobId: string, failedJobId: string): Promise<boolean> {
    const node = this.jobNodes.get(jobId);
    if (!node) return false;

    // Check if job has other non-failed dependencies
    for (const depId of node.dependencies) {
      if (depId !== failedJobId) {
        const depNode = this.jobNodes.get(depId);
        if (depNode && depNode.status !== JobNodeStatus.FAILED) {
          return true;
        }
      }
    }

    return false;
  }

  private async hasRequiredDependencies(jobId: string, failedJobId: string): Promise<boolean> {
    const node = this.jobNodes.get(jobId);
    if (!node) return false;

    // Check if the failed dependency was required (non-optional)
    for (const dependency of this.activeDependencies.values()) {
      if (dependency.targetJobId === jobId && dependency.sourceJobId === failedJobId) {
        return !dependency.metadata.optional;
      }
    }

    return false;
  }

  private async shouldFailDependentJob(dependentJobId: string, failedJobId: string): Promise<boolean> {
    // Intelligent decision based on job importance, alternatives, and strategy
    const dependentNode = this.jobNodes.get(dependentJobId);
    if (!dependentNode) return true;

    // Check if dependent job is on critical path
    if (dependentNode.metadata.criticalPath) {
      return true;
    }

    // Check job priority
    if (dependentNode.job.priority <= JobPriority.HIGH) {
      return true;
    }

    // Check if there are alternative paths
    return !(await this.hasAlternativeDependencyPaths(dependentJobId, failedJobId));
  }

  private calculateLayerDuration(layer: string[]): number {
    let maxDuration = 0;
    
    for (const jobId of layer) {
      const node = this.jobNodes.get(jobId);
      if (node) {
        maxDuration = Math.max(maxDuration, node.metadata.estimatedDuration);
      }
    }
    
    return maxDuration;
  }

  private aggregateResourceRequirements(jobIds: string[]): any {
    // Aggregate resource requirements for multiple jobs
    let totalCpu = 0;
    let totalMemory = 0;
    
    for (const jobId of jobIds) {
      const node = this.jobNodes.get(jobId);
      if (node && node.metadata.resourceRequirements) {
        totalCpu += node.metadata.resourceRequirements.cpu?.preferred || 0;
        // Additional resource aggregation logic
      }
    }
    
    return {
      cpu: totalCpu,
      memory: `${totalMemory}GB`
    };
  }

  private identifyOptimizations(graph: DependencyGraph, phases: ExecutionPhase[]): PlanOptimization[] {
    const optimizations: PlanOptimization[] = [];

    // Parallel execution optimization
    for (const phase of phases) {
      if (phase.jobs.length > 1 && !phase.parallelizable) {
        optimizations.push({
          type: OptimizationType.PARALLEL_EXECUTION,
          description: `Enable parallel execution for phase ${phase.phaseId}`,
          estimatedSavings: phase.estimatedDuration * 0.6,
          riskLevel: RiskLevel.LOW,
          applicableJobs: phase.jobs
        });
      }
    }

    // Critical path optimization
    if (graph.criticalPath.length > 0) {
      optimizations.push({
        type: OptimizationType.CRITICAL_PATH_OPTIMIZATION,
        description: 'Optimize critical path execution',
        estimatedSavings: graph.metadata.estimatedDuration * 0.2,
        riskLevel: RiskLevel.MEDIUM,
        applicableJobs: graph.criticalPath
      });
    }

    return optimizations;
  }

  /**
   * Public API methods
   */
  public getDependencyGraph(graphId: string): DependencyGraph | undefined {
    return this.dependencyGraphs.get(graphId);
  }

  public getExecutionPlan(graphId: string): ExecutionPlan | undefined {
    return this.executionPlans.get(graphId);
  }

  public async cancelJob(jobId: string): Promise<void> {
    const node = this.jobNodes.get(jobId);
    if (node) {
      node.status = JobNodeStatus.CANCELLED;
      this.emit('job:cancelled', { jobId });
    }
  }

  public async retryJob(jobId: string): Promise<void> {
    const node = this.jobNodes.get(jobId);
    if (node && node.status === JobNodeStatus.FAILED) {
      node.status = JobNodeStatus.WAITING;
      this.emit('job:retry', { jobId });
    }
  }

  public getJobStatus(jobId: string): JobNodeStatus | undefined {
    const node = this.jobNodes.get(jobId);
    return node?.status;
  }

  public getDependencyStatistics(): any {
    return {
      totalGraphs: this.dependencyGraphs.size,
      totalJobs: this.jobNodes.size,
      totalDependencies: this.activeDependencies.size,
      activeTimeouts: this.timeoutCheckers.size
    };
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down dependency manager');

    // Clear all timeouts
    for (const timeoutId of this.timeoutCheckers.values()) {
      clearTimeout(timeoutId);
    }

    this.dependencyGraphs.clear();
    this.activeDependencies.clear();
    this.jobNodes.clear();
    this.executionPlans.clear();
    this.timeoutCheckers.clear();

    this.emit('shutdown:complete');
  }
}

export default DependencyManager;