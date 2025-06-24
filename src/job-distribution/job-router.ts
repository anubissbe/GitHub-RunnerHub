import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import { ContainerAssignmentManager } from '../orchestrator/container-assignment';
import { DockerIntegrationService } from '../docker';

const logger = createLogger('JobRouter');

export interface JobRoutingRequest {
  jobId: string;
  workflowId: string;
  repository: string;
  sha: string;
  ref: string;
  labels: string[];
  environment: Record<string, string>;
  services: Record<string, any>;
  container: any;
  strategy: string[];
  matrix?: any;
  needs?: string[];
  timeout: number;
  priority: JobPriority;
  resourceRequirements: ResourceRequirements;
  metadata: JobMetadata;
}

export interface ResourceRequirements {
  cpu: {
    min: number; // cores
    max: number;
    preferred: number;
  };
  memory: {
    min: string; // e.g., "1GB"
    max: string;
    preferred: string;
  };
  disk: {
    min: string;
    max: string;
    preferred: string;
  };
  network: {
    bandwidth: string; // e.g., "100Mbps"
    latency: number; // ms
  };
  gpu?: {
    required: boolean;
    type?: string; // e.g., "nvidia-tesla-v100"
    memory?: string;
  };
  specialized: string[]; // e.g., ["docker", "kubernetes", "android-emulator"]
}

export interface JobMetadata {
  estimatedDuration: number; // seconds
  jobType: JobType;
  workflowType: WorkflowType;
  criticality: JobCriticality;
  tags: string[];
  constraints: JobConstraints;
  preferences: JobPreferences;
}

export interface JobConstraints {
  allowedRunners: string[];
  blockedRunners: string[];
  requiredCapabilities: string[];
  geographicRestrictions?: {
    allowedRegions: string[];
    blockedRegions: string[];
  };
  timeConstraints?: {
    scheduledStart?: Date;
    deadline?: Date;
    allowedTimeWindows?: Array<{start: string; end: string}>;
  };
  securityLevel: SecurityLevel;
}

export interface JobPreferences {
  preferredRunners: string[];
  affinityRules: AffinityRule[];
  antiAffinityRules: AntiAffinityRule[];
  performanceProfile: PerformanceProfile;
}

export interface AffinityRule {
  type: 'hard' | 'soft';
  weight: number; // 1-100 for soft rules
  selector: {
    labels?: Record<string, string>;
    capabilities?: string[];
    characteristics?: string[];
  };
}

export interface AntiAffinityRule {
  type: 'hard' | 'soft';
  weight: number;
  avoidJobsWith: {
    labels?: Record<string, string>;
    repository?: string;
    workflowName?: string;
  };
}

export interface JobRoutingResult {
  success: boolean;
  routingDecision: RoutingDecision;
  selectedRunner?: RunnerAssignment;
  alternatives: RunnerAssignment[];
  reasoning: RoutingReasoning;
  estimatedStartTime: Date;
  estimatedCompletionTime: Date;
  metrics: RoutingMetrics;
}

export interface RoutingDecision {
  algorithm: RoutingAlgorithm;
  strategy: RoutingStrategy;
  factors: RoutingFactor[];
  confidence: number; // 0-1
}

export interface RunnerAssignment {
  runnerId: string;
  runnerType: string;
  containerId?: string;
  score: number;
  reasoning: string;
  capabilities: string[];
  currentLoad: number;
  estimatedPerformance: PerformanceEstimate;
}

export interface PerformanceEstimate {
  expectedDuration: number; // seconds
  resourceUtilization: {
    cpu: number; // 0-1
    memory: number;
    disk: number;
    network: number;
  };
  confidenceLevel: number; // 0-1
}

export interface RoutingReasoning {
  primaryFactors: string[];
  secondaryFactors: string[];
  constraints: string[];
  tradeoffs: string[];
  warnings: string[];
}

export interface RoutingMetrics {
  routingTime: number; // ms
  candidatesEvaluated: number;
  algorithmComplexity: number;
  cacheHits: number;
  cacheMisses: number;
}

export enum JobPriority {
  CRITICAL = 1,
  HIGH = 2,
  NORMAL = 3,
  LOW = 4,
  BACKGROUND = 5
}

export enum JobType {
  BUILD = 'build',
  TEST = 'test',
  DEPLOY = 'deploy',
  SECURITY_SCAN = 'security-scan',
  COMPLIANCE = 'compliance',
  BENCHMARK = 'benchmark',
  MAINTENANCE = 'maintenance',
  CUSTOM = 'custom'
}

export enum WorkflowType {
  CI = 'ci',
  CD = 'cd',
  CRON = 'cron',
  MANUAL = 'manual',
  RELEASE = 'release',
  HOTFIX = 'hotfix',
  FEATURE = 'feature'
}

export enum JobCriticality {
  BLOCKING = 'blocking',
  IMPORTANT = 'important',
  NORMAL = 'normal',
  OPTIONAL = 'optional'
}

export enum SecurityLevel {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  CONFIDENTIAL = 'confidential',
  RESTRICTED = 'restricted'
}

export enum PerformanceProfile {
  SPEED = 'speed',
  BALANCED = 'balanced',
  EFFICIENCY = 'efficiency',
  RELIABILITY = 'reliability'
}

export enum RoutingAlgorithm {
  ROUND_ROBIN = 'round-robin',
  LEAST_LOADED = 'least-loaded',
  RESOURCE_AWARE = 'resource-aware',
  INTELLIGENT = 'intelligent',
  MACHINE_LEARNING = 'ml-based'
}

export enum RoutingStrategy {
  IMMEDIATE = 'immediate',
  SCHEDULED = 'scheduled',
  BATCHED = 'batched',
  ADAPTIVE = 'adaptive'
}

export enum RoutingFactor {
  RESOURCE_AVAILABILITY = 'resource-availability',
  CURRENT_LOAD = 'current-load',
  HISTORICAL_PERFORMANCE = 'historical-performance',
  AFFINITY_RULES = 'affinity-rules',
  GEOGRAPHIC_PROXIMITY = 'geographic-proximity',
  COST_OPTIMIZATION = 'cost-optimization',
  SECURITY_COMPLIANCE = 'security-compliance',
  CAPABILITY_MATCHING = 'capability-matching'
}

export class JobRouter extends EventEmitter {
  private static instance: JobRouter;
  private containerManager: ContainerAssignmentManager;
  private _dockerIntegration: DockerIntegrationService;
  private routingCache: Map<string, JobRoutingResult> = new Map();
  private performanceHistory: Map<string, PerformanceHistory[]> = new Map();
  private routingAlgorithms: Map<RoutingAlgorithm, RoutingAlgorithmImpl> = new Map();

  private constructor() {
    super();
    this.containerManager = ContainerAssignmentManager.getInstance();
    this._dockerIntegration = DockerIntegrationService.getInstance();
    this.initializeRoutingAlgorithms();
  }

  public static getInstance(): JobRouter {
    if (!JobRouter.instance) {
      JobRouter.instance = new JobRouter();
    }
    return JobRouter.instance;
  }

  /**
   * Initialize routing algorithms
   */
  private initializeRoutingAlgorithms(): void {
    this.routingAlgorithms.set(RoutingAlgorithm.ROUND_ROBIN, new RoundRobinAlgorithm());
    this.routingAlgorithms.set(RoutingAlgorithm.LEAST_LOADED, new LeastLoadedAlgorithm());
    this.routingAlgorithms.set(RoutingAlgorithm.RESOURCE_AWARE, new ResourceAwareAlgorithm());
    this.routingAlgorithms.set(RoutingAlgorithm.INTELLIGENT, new IntelligentAlgorithm());
    this.routingAlgorithms.set(RoutingAlgorithm.MACHINE_LEARNING, new MLBasedAlgorithm());
  }

  /**
   * Route a job to the best available runner
   */
  public async routeJob(request: JobRoutingRequest): Promise<JobRoutingResult> {
    const startTime = Date.now();

    try {
      logger.info(`Routing job ${request.jobId} for repository ${request.repository}`);

      // Check cache first
      const cacheKey = this.generateCacheKey(request);
      if (this.routingCache.has(cacheKey)) {
        const cachedResult = this.routingCache.get(cacheKey)!;
        logger.debug(`Cache hit for job routing: ${request.jobId}`);
        cachedResult.metrics.cacheHits++;
        return cachedResult;
      }

      // Validate request
      this.validateRoutingRequest(request);

      // Select routing algorithm
      const algorithm = this.selectRoutingAlgorithm(request);
      const algorithmImpl = this.routingAlgorithms.get(algorithm)!;

      // Get available runners
      const availableRunners = await this.getAvailableRunners(request);

      // Apply constraints and filters
      const filteredRunners = this.applyConstraints(availableRunners, request);

      // Execute routing algorithm
      const routingResult = await algorithmImpl.route(filteredRunners, request);

      // Enhance result with additional metadata
      routingResult.metrics = {
        routingTime: Date.now() - startTime,
        candidatesEvaluated: availableRunners.length,
        algorithmComplexity: algorithmImpl.getComplexity(),
        cacheHits: 0,
        cacheMisses: 1
      };

      // Cache result
      this.routingCache.set(cacheKey, routingResult);

      // Emit routing event
      this.emit('job:routed', {
        jobId: request.jobId,
        result: routingResult
      });

      logger.info(`Job ${request.jobId} routed successfully to ${routingResult.selectedRunner?.runnerId}`);
      return routingResult;

    } catch (error) {
      logger.error(`Failed to route job ${request.jobId}:`, error);
      
      const failureResult: JobRoutingResult = {
        success: false,
        routingDecision: {
          algorithm: RoutingAlgorithm.ROUND_ROBIN,
          strategy: RoutingStrategy.IMMEDIATE,
          factors: [],
          confidence: 0
        },
        alternatives: [],
        reasoning: {
          primaryFactors: [],
          secondaryFactors: [],
          constraints: [],
          tradeoffs: [],
          warnings: [`Routing failed: ${error}`]
        },
        estimatedStartTime: new Date(),
        estimatedCompletionTime: new Date(Date.now() + request.metadata.estimatedDuration * 1000),
        metrics: {
          routingTime: Date.now() - startTime,
          candidatesEvaluated: 0,
          algorithmComplexity: 0,
          cacheHits: 0,
          cacheMisses: 1
        }
      };

      this.emit('job:routing:failed', {
        jobId: request.jobId,
        error,
        result: failureResult
      });

      return failureResult;
    }
  }

  /**
   * Route multiple jobs with batch optimization
   */
  public async routeJobBatch(requests: JobRoutingRequest[]): Promise<JobRoutingResult[]> {
    logger.info(`Routing batch of ${requests.length} jobs`);

    const batchStartTime = Date.now();
    const results: JobRoutingResult[] = [];

    try {
      // Sort jobs by priority and dependencies
      const sortedRequests = this.sortJobsByPriority(requests);

      // Analyze batch for optimization opportunities
      const batchAnalysis = this.analyzeBatch(sortedRequests);

      // Route jobs with batch optimization
      for (const request of sortedRequests) {
        const result = await this.routeJob(request);
        results.push(result);

        // Update batch state for subsequent routing decisions
        this.updateBatchState(request, result, batchAnalysis);
      }

      const batchTime = Date.now() - batchStartTime;
      logger.info(`Batch routing completed in ${batchTime}ms`);

      this.emit('job:batch:routed', {
        requestCount: requests.length,
        successCount: results.filter(r => r.success).length,
        batchTime,
        results
      });

      return results;

    } catch (error) {
      logger.error('Failed to route job batch:', error);
      throw error;
    }
  }

  /**
   * Validate routing request
   */
  private validateRoutingRequest(request: JobRoutingRequest): void {
    if (!request.jobId) {
      throw new Error('Job ID is required');
    }

    if (!request.repository) {
      throw new Error('Repository is required');
    }

    if (!request.labels || request.labels.length === 0) {
      throw new Error('Job labels are required');
    }

    if (!request.resourceRequirements) {
      throw new Error('Resource requirements are required');
    }

    // Validate resource requirements
    const { cpu, memory, disk } = request.resourceRequirements;
    if (cpu.min <= 0 || cpu.min > cpu.max) {
      throw new Error('Invalid CPU requirements');
    }

    if (!memory.min || !memory.max) {
      throw new Error('Memory requirements must be specified');
    }

    if (!disk.min || !disk.max) {
      throw new Error('Disk requirements must be specified');
    }

    // Validate constraints
    if (request.metadata.constraints.securityLevel === SecurityLevel.RESTRICTED) {
      if (!request.metadata.constraints.allowedRunners?.length) {
        throw new Error('Restricted security level requires explicit runner allowlist');
      }
    }
  }

  /**
   * Select the best routing algorithm for the request
   */
  private selectRoutingAlgorithm(request: JobRoutingRequest): RoutingAlgorithm {
    // ML-based for critical jobs with complex requirements
    if (request.priority <= JobPriority.HIGH && 
        request.metadata.constraints.requiredCapabilities.length > 3) {
      return RoutingAlgorithm.MACHINE_LEARNING;
    }

    // Intelligent for jobs with specific affinity rules
    if (request.metadata.preferences.affinityRules.length > 0 ||
        request.metadata.preferences.antiAffinityRules.length > 0) {
      return RoutingAlgorithm.INTELLIGENT;
    }

    // Resource-aware for resource-intensive jobs
    if (request.resourceRequirements.cpu.min > 4 ||
        this.parseMemoryToGB(request.resourceRequirements.memory.min) > 8) {
      return RoutingAlgorithm.RESOURCE_AWARE;
    }

    // Least loaded for normal jobs
    if (request.priority === JobPriority.NORMAL) {
      return RoutingAlgorithm.LEAST_LOADED;
    }

    // Default to round robin
    return RoutingAlgorithm.ROUND_ROBIN;
  }

  /**
   * Get available runners that can potentially handle the job
   */
  private async getAvailableRunners(request: JobRoutingRequest): Promise<RunnerCandidate[]> {
    // For now, return mock candidates until proper integration is implemented
    const containers: any[] = [];
    
    const candidates: RunnerCandidate[] = containers.map((container: any) => ({
      id: container.id,
      type: 'container',
      labels: container.labels,
      capabilities: this.extractCapabilities(container),
      resources: {
        cpu: container.resources.cpu,
        memory: container.resources.memory,
        disk: container.resources.disk
      },
      currentLoad: container.utilization.cpu,
      status: container.status,
      location: this.getRunnerLocation(container),
      performanceHistory: this.performanceHistory.get(container.id) || []
    }));

    return candidates.filter(candidate => 
      this.isRunnerCompatible(candidate, request)
    );
  }

  /**
   * Apply constraints and filters to runner candidates
   */
  private applyConstraints(
    candidates: RunnerCandidate[], 
    request: JobRoutingRequest
  ): RunnerCandidate[] {
    const constraints = request.metadata.constraints;

    return candidates.filter(candidate => {
      // Check allowed runners
      if (constraints.allowedRunners.length > 0) {
        if (!constraints.allowedRunners.includes(candidate.id)) {
          return false;
        }
      }

      // Check blocked runners
      if (constraints.blockedRunners.includes(candidate.id)) {
        return false;
      }

      // Check required capabilities
      for (const capability of constraints.requiredCapabilities) {
        if (!candidate.capabilities.includes(capability)) {
          return false;
        }
      }

      // Check security level
      if (!this.checkSecurityCompliance(candidate, constraints.securityLevel)) {
        return false;
      }

      // Check resource requirements
      if (!this.checkResourceRequirements(candidate, request.resourceRequirements)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Generate cache key for routing request
   */
  private generateCacheKey(request: JobRoutingRequest): string {
    const keyData = {
      labels: request.labels.sort(),
      resources: request.resourceRequirements,
      constraints: request.metadata.constraints,
      preferences: request.metadata.preferences
    };

    return Buffer.from(JSON.stringify(keyData)).toString('base64');
  }

  /**
   * Sort jobs by priority and dependencies
   */
  private sortJobsByPriority(requests: JobRoutingRequest[]): JobRoutingRequest[] {
    return requests.sort((a, b) => {
      // First by priority
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      // Then by criticality
      const criticalityOrder = {
        [JobCriticality.BLOCKING]: 1,
        [JobCriticality.IMPORTANT]: 2,
        [JobCriticality.NORMAL]: 3,
        [JobCriticality.OPTIONAL]: 4
      };

      const aCriticality = criticalityOrder[a.metadata.criticality];
      const bCriticality = criticalityOrder[b.metadata.criticality];

      if (aCriticality !== bCriticality) {
        return aCriticality - bCriticality;
      }

      // Finally by estimated duration (shorter first for batch efficiency)
      return a.metadata.estimatedDuration - b.metadata.estimatedDuration;
    });
  }

  /**
   * Analyze batch for optimization opportunities
   */
  private analyzeBatch(requests: JobRoutingRequest[]): BatchAnalysis {
    const analysis: BatchAnalysis = {
      totalJobs: requests.length,
      priorityDistribution: this.calculatePriorityDistribution(requests),
      resourceRequirements: this.aggregateResourceRequirements(requests),
      affinityGroups: this.identifyAffinityGroups(requests),
      optimizationOpportunities: []
    };

    // Identify optimization opportunities
    if (analysis.affinityGroups.length > 1) {
      analysis.optimizationOpportunities.push('batch-affinity');
    }

    if (requests.some(r => r.metadata.jobType === JobType.BUILD) &&
        requests.some(r => r.metadata.jobType === JobType.TEST)) {
      analysis.optimizationOpportunities.push('pipeline-optimization');
    }

    return analysis;
  }

  /**
   * Update batch state for subsequent routing decisions
   */
  private updateBatchState(
    request: JobRoutingRequest, 
    result: JobRoutingResult, 
    _analysis: BatchAnalysis
  ): void {
    // Update performance history
    if (result.selectedRunner) {
      const history: PerformanceHistory = {
        jobId: request.jobId,
        runnerId: result.selectedRunner.runnerId,
        startTime: new Date(),
        estimatedDuration: request.metadata.estimatedDuration,
        actualDuration: 0, // Will be updated when job completes
        resourceUtilization: result.selectedRunner.estimatedPerformance.resourceUtilization,
        success: true
      };

      if (!this.performanceHistory.has(result.selectedRunner.runnerId)) {
        this.performanceHistory.set(result.selectedRunner.runnerId, []);
      }

      this.performanceHistory.get(result.selectedRunner.runnerId)!.push(history);
    }
  }

  /**
   * Helper methods
   */
  private parseMemoryToGB(memory: string): number {
    const value = parseFloat(memory);
    const unit = memory.toLowerCase().slice(-2);
    
    switch (unit) {
      case 'gb': return value;
      case 'mb': return value / 1024;
      case 'tb': return value * 1024;
      default: return value; // Assume GB if no unit
    }
  }

  private extractCapabilities(container: any): string[] {
    const capabilities: string[] = [];

    // Extract from labels
    Object.keys(container.labels).forEach(label => {
      if (label.startsWith('capability.')) {
        capabilities.push(label.replace('capability.', ''));
      }
    });

    // Add default capabilities based on image
    if (container.image.includes('docker')) {
      capabilities.push('docker');
    }

    if (container.image.includes('node')) {
      capabilities.push('nodejs', 'npm', 'yarn');
    }

    if (container.image.includes('python')) {
      capabilities.push('python', 'pip');
    }

    return capabilities;
  }

  private getRunnerLocation(container: any): RunnerLocation {
    // Extract location from labels or use default
    return {
      region: container.labels['location.region'] || 'default',
      zone: container.labels['location.zone'] || 'default',
      datacenter: container.labels['location.datacenter'] || 'local'
    };
  }

  private isRunnerCompatible(candidate: RunnerCandidate, request: JobRoutingRequest): boolean {
    // Check if runner can handle the job's basic requirements
    return candidate.labels['self-hosted'] === 'true' &&
           this.hasRequiredLabels(candidate, request.labels);
  }

  private hasRequiredLabels(candidate: RunnerCandidate, requiredLabels: string[]): boolean {
    return requiredLabels.every(label => 
      Object.keys(candidate.labels).includes(label) ||
      candidate.capabilities.includes(label)
    );
  }

  private checkSecurityCompliance(candidate: RunnerCandidate, securityLevel: SecurityLevel): boolean {
    const runnerSecurityLevel = candidate.labels['security.level'] || SecurityLevel.PUBLIC;
    
    const securityLevelOrder: Record<string, number> = {
      [SecurityLevel.PUBLIC]: 1,
      [SecurityLevel.INTERNAL]: 2,
      [SecurityLevel.CONFIDENTIAL]: 3,
      [SecurityLevel.RESTRICTED]: 4
    };

    return securityLevelOrder[runnerSecurityLevel] >= securityLevelOrder[securityLevel];
  }

  private checkResourceRequirements(
    candidate: RunnerCandidate, 
    requirements: ResourceRequirements
  ): boolean {
    // Check CPU
    if (candidate.resources.cpu < requirements.cpu.min) {
      return false;
    }

    // Check memory
    const candidateMemoryGB = this.parseMemoryToGB(candidate.resources.memory);
    const requiredMemoryGB = this.parseMemoryToGB(requirements.memory.min);
    if (candidateMemoryGB < requiredMemoryGB) {
      return false;
    }

    // Check current load
    if (candidate.currentLoad > 0.8) { // 80% load threshold
      return false;
    }

    return true;
  }

  private calculatePriorityDistribution(requests: JobRoutingRequest[]): Record<JobPriority, number> {
    const distribution: Record<JobPriority, number> = {
      [JobPriority.CRITICAL]: 0,
      [JobPriority.HIGH]: 0,
      [JobPriority.NORMAL]: 0,
      [JobPriority.LOW]: 0,
      [JobPriority.BACKGROUND]: 0
    };

    requests.forEach(request => {
      distribution[request.priority]++;
    });

    return distribution;
  }

  private aggregateResourceRequirements(requests: JobRoutingRequest[]): AggregatedResources {
    const total = {
      cpu: 0,
      memory: 0, // in GB
      disk: 0    // in GB
    };

    requests.forEach(request => {
      total.cpu += request.resourceRequirements.cpu.preferred;
      total.memory += this.parseMemoryToGB(request.resourceRequirements.memory.preferred);
      total.disk += this.parseMemoryToGB(request.resourceRequirements.disk.preferred);
    });

    return total;
  }

  private identifyAffinityGroups(requests: JobRoutingRequest[]): AffinityGroup[] {
    const groups: AffinityGroup[] = [];
    
    // Group by repository
    const repoGroups = new Map<string, JobRoutingRequest[]>();
    requests.forEach(request => {
      if (!repoGroups.has(request.repository)) {
        repoGroups.set(request.repository, []);
      }
      repoGroups.get(request.repository)!.push(request);
    });

    repoGroups.forEach((jobs, repo) => {
      if (jobs.length > 1) {
        groups.push({
          type: 'repository',
          identifier: repo,
          jobs: jobs.map(j => j.jobId),
          affinityStrength: 0.8
        });
      }
    });

    return groups;
  }

  /**
   * Get routing statistics
   */
  public getRoutingStatistics(): RoutingStatistics {
    const cacheEntries = Array.from(this.routingCache.values());
    
    return {
      totalRoutingRequests: cacheEntries.length,
      successfulRouting: cacheEntries.filter(r => r.success).length,
      averageRoutingTime: cacheEntries.reduce((sum, r) => sum + r.metrics.routingTime, 0) / cacheEntries.length || 0,
      cacheHitRate: this.calculateCacheHitRate(),
      algorithmUsage: this.calculateAlgorithmUsage(cacheEntries),
      performanceMetrics: this.calculatePerformanceMetrics()
    };
  }

  private calculateCacheHitRate(): number {
    const cacheEntries = Array.from(this.routingCache.values());
    if (cacheEntries.length === 0) return 0;

    const totalRequests = cacheEntries.reduce((sum, r) => sum + r.metrics.cacheHits + r.metrics.cacheMisses, 0);
    const totalHits = cacheEntries.reduce((sum, r) => sum + r.metrics.cacheHits, 0);

    return totalRequests > 0 ? totalHits / totalRequests : 0;
  }

  private calculateAlgorithmUsage(results: JobRoutingResult[]): Record<RoutingAlgorithm, number> {
    const usage: Record<RoutingAlgorithm, number> = {
      [RoutingAlgorithm.ROUND_ROBIN]: 0,
      [RoutingAlgorithm.LEAST_LOADED]: 0,
      [RoutingAlgorithm.RESOURCE_AWARE]: 0,
      [RoutingAlgorithm.INTELLIGENT]: 0,
      [RoutingAlgorithm.MACHINE_LEARNING]: 0
    };

    results.forEach(result => {
      usage[result.routingDecision.algorithm]++;
    });

    return usage;
  }

  private calculatePerformanceMetrics(): PerformanceMetrics {
    const allHistory = Array.from(this.performanceHistory.values()).flat();
    
    if (allHistory.length === 0) {
      return {
        averageJobDuration: 0,
        accuracyRate: 0,
        resourceUtilizationEfficiency: 0
      };
    }

    const completedJobs = allHistory.filter(h => h.actualDuration > 0);
    
    return {
      averageJobDuration: completedJobs.reduce((sum, h) => sum + h.actualDuration, 0) / completedJobs.length || 0,
      accuracyRate: this.calculateAccuracyRate(completedJobs),
      resourceUtilizationEfficiency: this.calculateResourceEfficiency(completedJobs)
    };
  }

  private calculateAccuracyRate(history: PerformanceHistory[]): number {
    if (history.length === 0) return 0;

    const accurateEstimates = history.filter(h => {
      const variance = Math.abs(h.actualDuration - h.estimatedDuration) / h.estimatedDuration;
      return variance <= 0.2; // Within 20% of estimate
    });

    return accurateEstimates.length / history.length;
  }

  private calculateResourceEfficiency(history: PerformanceHistory[]): number {
    if (history.length === 0) return 0;

    const avgUtilization = history.reduce((sum, h) => {
      const totalUtilization = (h.resourceUtilization.cpu + 
                               h.resourceUtilization.memory + 
                               h.resourceUtilization.disk) / 3;
      return sum + totalUtilization;
    }, 0) / history.length;

    return avgUtilization;
  }
}

// Supporting interfaces and types
interface RunnerCandidate {
  id: string;
  type: string;
  labels: Record<string, string>;
  capabilities: string[];
  resources: {
    cpu: number;
    memory: string;
    disk: string;
  };
  currentLoad: number;
  status: string;
  location: RunnerLocation;
  performanceHistory: PerformanceHistory[];
}

interface RunnerLocation {
  region: string;
  zone: string;
  datacenter: string;
}

interface PerformanceHistory {
  jobId: string;
  runnerId: string;
  startTime: Date;
  estimatedDuration: number;
  actualDuration: number;
  resourceUtilization: {
    cpu: number;
    memory: number;
    disk: number;
    network: number;
  };
  success: boolean;
}

interface BatchAnalysis {
  totalJobs: number;
  priorityDistribution: Record<JobPriority, number>;
  resourceRequirements: AggregatedResources;
  affinityGroups: AffinityGroup[];
  optimizationOpportunities: string[];
}

interface AggregatedResources {
  cpu: number;
  memory: number;
  disk: number;
}

interface AffinityGroup {
  type: string;
  identifier: string;
  jobs: string[];
  affinityStrength: number;
}

interface RoutingStatistics {
  totalRoutingRequests: number;
  successfulRouting: number;
  averageRoutingTime: number;
  cacheHitRate: number;
  algorithmUsage: Record<RoutingAlgorithm, number>;
  performanceMetrics: PerformanceMetrics;
}

interface PerformanceMetrics {
  averageJobDuration: number;
  accuracyRate: number;
  resourceUtilizationEfficiency: number;
}

// Abstract base class for routing algorithms
abstract class RoutingAlgorithmImpl {
  abstract route(candidates: RunnerCandidate[], request: JobRoutingRequest): Promise<JobRoutingResult>;
  abstract getComplexity(): number;
}

// Routing algorithm implementations
class RoundRobinAlgorithm extends RoutingAlgorithmImpl {
  private currentIndex = 0;

  async route(candidates: RunnerCandidate[], request: JobRoutingRequest): Promise<JobRoutingResult> {
    if (candidates.length === 0) {
      return this.createFailureResult('No available runners');
    }

    const selectedRunner = candidates[this.currentIndex % candidates.length];
    this.currentIndex++;

    return this.createSuccessResult(selectedRunner, candidates, request, 'Round-robin selection');
  }

  getComplexity(): number {
    return 1; // O(1)
  }

  private createSuccessResult(
    selected: RunnerCandidate, 
    alternatives: RunnerCandidate[], 
    request: JobRoutingRequest,
    reasoning: string
  ): JobRoutingResult {
    return {
      success: true,
      routingDecision: {
        algorithm: RoutingAlgorithm.ROUND_ROBIN,
        strategy: RoutingStrategy.IMMEDIATE,
        factors: [RoutingFactor.CURRENT_LOAD],
        confidence: 0.6
      },
      selectedRunner: {
        runnerId: selected.id,
        runnerType: selected.type,
        score: 1.0,
        reasoning,
        capabilities: selected.capabilities,
        currentLoad: selected.currentLoad,
        estimatedPerformance: {
          expectedDuration: request.metadata.estimatedDuration,
          resourceUtilization: {
            cpu: 0.5,
            memory: 0.5,
            disk: 0.3,
            network: 0.2
          },
          confidenceLevel: 0.6
        }
      },
      alternatives: alternatives.slice(0, 3).map(runner => ({
        runnerId: runner.id,
        runnerType: runner.type,
        score: 0.8,
        reasoning: 'Alternative option',
        capabilities: runner.capabilities,
        currentLoad: runner.currentLoad,
        estimatedPerformance: {
          expectedDuration: request.metadata.estimatedDuration * 1.1,
          resourceUtilization: {
            cpu: 0.5,
            memory: 0.5,
            disk: 0.3,
            network: 0.2
          },
          confidenceLevel: 0.5
        }
      })),
      reasoning: {
        primaryFactors: ['Round-robin distribution'],
        secondaryFactors: ['Load balancing'],
        constraints: [],
        tradeoffs: ['Simple but not optimal'],
        warnings: []
      },
      estimatedStartTime: new Date(),
      estimatedCompletionTime: new Date(Date.now() + request.metadata.estimatedDuration * 1000),
      metrics: {
        routingTime: 0,
        candidatesEvaluated: alternatives.length,
        algorithmComplexity: 1,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
  }

  private createFailureResult(reason: string): JobRoutingResult {
    return {
      success: false,
      routingDecision: {
        algorithm: RoutingAlgorithm.ROUND_ROBIN,
        strategy: RoutingStrategy.IMMEDIATE,
        factors: [],
        confidence: 0
      },
      alternatives: [],
      reasoning: {
        primaryFactors: [],
        secondaryFactors: [],
        constraints: [],
        tradeoffs: [],
        warnings: [reason]
      },
      estimatedStartTime: new Date(),
      estimatedCompletionTime: new Date(),
      metrics: {
        routingTime: 0,
        candidatesEvaluated: 0,
        algorithmComplexity: 1,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
  }
}

class LeastLoadedAlgorithm extends RoutingAlgorithmImpl {
  async route(candidates: RunnerCandidate[], request: JobRoutingRequest): Promise<JobRoutingResult> {
    if (candidates.length === 0) {
      return this.createFailureResult('No available runners');
    }

    // Sort by current load (ascending)
    const sortedCandidates = [...candidates].sort((a, b) => a.currentLoad - b.currentLoad);
    const selectedRunner = sortedCandidates[0];

    return this.createSuccessResult(selectedRunner, sortedCandidates.slice(1), request, 
      `Selected least loaded runner (${Math.round(selectedRunner.currentLoad * 100)}% load)`);
  }

  getComplexity(): number {
    return 2; // O(n log n) for sorting
  }

  private createSuccessResult(
    selected: RunnerCandidate, 
    alternatives: RunnerCandidate[], 
    request: JobRoutingRequest,
    reasoning: string
  ): JobRoutingResult {
    return {
      success: true,
      routingDecision: {
        algorithm: RoutingAlgorithm.LEAST_LOADED,
        strategy: RoutingStrategy.IMMEDIATE,
        factors: [RoutingFactor.CURRENT_LOAD],
        confidence: 0.8
      },
      selectedRunner: {
        runnerId: selected.id,
        runnerType: selected.type,
        score: 1.0 - selected.currentLoad,
        reasoning,
        capabilities: selected.capabilities,
        currentLoad: selected.currentLoad,
        estimatedPerformance: {
          expectedDuration: request.metadata.estimatedDuration,
          resourceUtilization: {
            cpu: selected.currentLoad + 0.3,
            memory: 0.5,
            disk: 0.3,
            network: 0.2
          },
          confidenceLevel: 0.8
        }
      },
      alternatives: alternatives.slice(0, 3).map((runner, index) => ({
        runnerId: runner.id,
        runnerType: runner.type,
        score: 1.0 - runner.currentLoad - (index * 0.1),
        reasoning: `Alternative with ${Math.round(runner.currentLoad * 100)}% load`,
        capabilities: runner.capabilities,
        currentLoad: runner.currentLoad,
        estimatedPerformance: {
          expectedDuration: request.metadata.estimatedDuration * (1 + runner.currentLoad * 0.5),
          resourceUtilization: {
            cpu: runner.currentLoad + 0.3,
            memory: 0.5,
            disk: 0.3,
            network: 0.2
          },
          confidenceLevel: 0.7 - (index * 0.1)
        }
      })),
      reasoning: {
        primaryFactors: ['Current load optimization'],
        secondaryFactors: ['Resource availability'],
        constraints: [],
        tradeoffs: ['May not consider job-specific requirements'],
        warnings: []
      },
      estimatedStartTime: new Date(),
      estimatedCompletionTime: new Date(Date.now() + request.metadata.estimatedDuration * 1000),
      metrics: {
        routingTime: 0,
        candidatesEvaluated: alternatives.length + 1,
        algorithmComplexity: 2,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
  }

  private createFailureResult(reason: string): JobRoutingResult {
    return {
      success: false,
      routingDecision: {
        algorithm: RoutingAlgorithm.LEAST_LOADED,
        strategy: RoutingStrategy.IMMEDIATE,
        factors: [],
        confidence: 0
      },
      alternatives: [],
      reasoning: {
        primaryFactors: [],
        secondaryFactors: [],
        constraints: [],
        tradeoffs: [],
        warnings: [reason]
      },
      estimatedStartTime: new Date(),
      estimatedCompletionTime: new Date(),
      metrics: {
        routingTime: 0,
        candidatesEvaluated: 0,
        algorithmComplexity: 2,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
  }
}

class ResourceAwareAlgorithm extends RoutingAlgorithmImpl {
  async route(candidates: RunnerCandidate[], request: JobRoutingRequest): Promise<JobRoutingResult> {
    if (candidates.length === 0) {
      return this.createFailureResult('No available runners');
    }

    // Score candidates based on resource fit
    const scoredCandidates = candidates.map(candidate => ({
      candidate,
      score: this.calculateResourceScore(candidate, request.resourceRequirements)
    })).sort((a, b) => b.score - a.score);

    const selectedRunner = scoredCandidates[0].candidate;
    const alternatives = scoredCandidates.slice(1).map(sc => sc.candidate);

    return this.createSuccessResult(selectedRunner, alternatives, request, 
      `Resource-optimized selection (score: ${scoredCandidates[0].score.toFixed(2)})`);
  }

  getComplexity(): number {
    return 3; // O(n) for scoring + O(n log n) for sorting
  }

  private calculateResourceScore(candidate: RunnerCandidate, requirements: ResourceRequirements): number {
    let score = 0;

    // CPU score
    const cpuRatio = candidate.resources.cpu / requirements.cpu.preferred;
    score += cpuRatio >= 1 ? Math.min(2 - cpuRatio, 1) : cpuRatio * 0.5;

    // Memory score  
    const candidateMemoryGB = this.parseMemoryToGB(candidate.resources.memory);
    const requiredMemoryGB = this.parseMemoryToGB(requirements.memory.preferred);
    const memoryRatio = candidateMemoryGB / requiredMemoryGB;
    score += memoryRatio >= 1 ? Math.min(2 - memoryRatio, 1) : memoryRatio * 0.5;

    // Load penalty
    score *= (1 - candidate.currentLoad);

    return Math.max(0, Math.min(1, score));
  }

  private parseMemoryToGB(memory: string): number {
    const value = parseFloat(memory);
    const unit = memory.toLowerCase().slice(-2);
    
    switch (unit) {
      case 'gb': return value;
      case 'mb': return value / 1024;
      case 'tb': return value * 1024;
      default: return value; // Assume GB if no unit
    }
  }

  private createSuccessResult(
    selected: RunnerCandidate, 
    alternatives: RunnerCandidate[], 
    request: JobRoutingRequest,
    reasoning: string
  ): JobRoutingResult {
    return {
      success: true,
      routingDecision: {
        algorithm: RoutingAlgorithm.RESOURCE_AWARE,
        strategy: RoutingStrategy.IMMEDIATE,
        factors: [RoutingFactor.RESOURCE_AVAILABILITY, RoutingFactor.CURRENT_LOAD],
        confidence: 0.9
      },
      selectedRunner: {
        runnerId: selected.id,
        runnerType: selected.type,
        score: this.calculateResourceScore(selected, request.resourceRequirements),
        reasoning,
        capabilities: selected.capabilities,
        currentLoad: selected.currentLoad,
        estimatedPerformance: {
          expectedDuration: request.metadata.estimatedDuration,
          resourceUtilization: {
            cpu: Math.min(0.8, selected.currentLoad + 0.4),
            memory: 0.6,
            disk: 0.4,
            network: 0.3
          },
          confidenceLevel: 0.9
        }
      },
      alternatives: alternatives.slice(0, 3).map((runner, index) => ({
        runnerId: runner.id,
        runnerType: runner.type,
        score: this.calculateResourceScore(runner, request.resourceRequirements),
        reasoning: `Resource-aware alternative (rank ${index + 2})`,
        capabilities: runner.capabilities,
        currentLoad: runner.currentLoad,
        estimatedPerformance: {
          expectedDuration: request.metadata.estimatedDuration * (1.1 + index * 0.1),
          resourceUtilization: {
            cpu: Math.min(0.8, runner.currentLoad + 0.4),
            memory: 0.6,
            disk: 0.4,
            network: 0.3
          },
          confidenceLevel: 0.8 - (index * 0.1)
        }
      })),
      reasoning: {
        primaryFactors: ['Resource optimization', 'Capacity matching'],
        secondaryFactors: ['Current load consideration'],
        constraints: [],
        tradeoffs: ['May not consider affinity rules'],
        warnings: []
      },
      estimatedStartTime: new Date(),
      estimatedCompletionTime: new Date(Date.now() + request.metadata.estimatedDuration * 1000),
      metrics: {
        routingTime: 0,
        candidatesEvaluated: alternatives.length + 1,
        algorithmComplexity: 3,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
  }

  private createFailureResult(reason: string): JobRoutingResult {
    return {
      success: false,
      routingDecision: {
        algorithm: RoutingAlgorithm.RESOURCE_AWARE,
        strategy: RoutingStrategy.IMMEDIATE,
        factors: [],
        confidence: 0
      },
      alternatives: [],
      reasoning: {
        primaryFactors: [],
        secondaryFactors: [],
        constraints: [],
        tradeoffs: [],
        warnings: [reason]
      },
      estimatedStartTime: new Date(),
      estimatedCompletionTime: new Date(),
      metrics: {
        routingTime: 0,
        candidatesEvaluated: 0,
        algorithmComplexity: 3,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
  }
}

class IntelligentAlgorithm extends RoutingAlgorithmImpl {
  async route(candidates: RunnerCandidate[], request: JobRoutingRequest): Promise<JobRoutingResult> {
    if (candidates.length === 0) {
      return this.createFailureResult('No available runners');
    }

    // Multi-factor scoring
    const scoredCandidates = candidates.map(candidate => ({
      candidate,
      score: this.calculateIntelligentScore(candidate, request),
      factors: this.getScoreFactors(candidate, request)
    })).sort((a, b) => b.score - a.score);

    const selectedRunner = scoredCandidates[0];
    const alternatives = scoredCandidates.slice(1).map(sc => sc.candidate);

    return this.createSuccessResult(
      selectedRunner.candidate, 
      alternatives, 
      request, 
      `Intelligent multi-factor selection (score: ${selectedRunner.score.toFixed(2)}, factors: ${selectedRunner.factors.join(', ')})`
    );
  }

  getComplexity(): number {
    return 4; // O(n) for complex scoring + O(n log n) for sorting
  }

  private calculateIntelligentScore(candidate: RunnerCandidate, request: JobRoutingRequest): number {
    let score = 0;
    let factors = 0;

    // Resource fitness (30%)
    const resourceScore = this.calculateResourceFitness(candidate, request.resourceRequirements);
    score += resourceScore * 0.3;
    factors++;

    // Load balancing (20%)
    const loadScore = 1 - candidate.currentLoad;
    score += loadScore * 0.2;
    factors++;

    // Capability matching (25%)
    const capabilityScore = this.calculateCapabilityMatch(candidate, request);
    score += capabilityScore * 0.25;
    factors++;

    // Affinity rules (15%)
    const affinityScore = this.calculateAffinityScore(candidate, request);
    score += affinityScore * 0.15;
    factors++;

    // Performance history (10%)
    const historyScore = this.calculateHistoryScore(candidate, request);
    score += historyScore * 0.1;
    factors++;

    return score / factors;
  }

  private getScoreFactors(candidate: RunnerCandidate, request: JobRoutingRequest): string[] {
    const factors: string[] = [];
    
    if (this.calculateResourceFitness(candidate, request.resourceRequirements) > 0.8) {
      factors.push('resource-fit');
    }
    
    if (candidate.currentLoad < 0.3) {
      factors.push('low-load');
    }
    
    if (this.calculateCapabilityMatch(candidate, request) > 0.9) {
      factors.push('capability-match');
    }
    
    return factors;
  }

  private calculateResourceFitness(candidate: RunnerCandidate, requirements: ResourceRequirements): number {
    // Similar to ResourceAwareAlgorithm but more sophisticated
    let score = 0;
    let factors = 0;

    // CPU fitness
    const cpuRatio = candidate.resources.cpu / requirements.cpu.preferred;
    if (cpuRatio >= 1) {
      score += Math.min(1, 2 - cpuRatio); // Prefer slight over-provisioning
    } else {
      score += cpuRatio * 0.7; // Penalty for under-provisioning
    }
    factors++;

    // Memory fitness
    const candidateMemoryGB = this.parseMemoryToGB(candidate.resources.memory);
    const requiredMemoryGB = this.parseMemoryToGB(requirements.memory.preferred);
    const memoryRatio = candidateMemoryGB / requiredMemoryGB;
    if (memoryRatio >= 1) {
      score += Math.min(1, 2 - memoryRatio);
    } else {
      score += memoryRatio * 0.6;
    }
    factors++;

    return score / factors;
  }

  private calculateCapabilityMatch(candidate: RunnerCandidate, request: JobRoutingRequest): number {
    const requiredCapabilities = [
      ...request.labels,
      ...request.metadata.constraints.requiredCapabilities
    ];

    if (requiredCapabilities.length === 0) return 1;

    const matchedCapabilities = requiredCapabilities.filter(cap => 
      candidate.capabilities.includes(cap) || 
      Object.keys(candidate.labels).includes(cap)
    );

    return matchedCapabilities.length / requiredCapabilities.length;
  }

  private calculateAffinityScore(candidate: RunnerCandidate, request: JobRoutingRequest): number {
    let score = 0.5; // Base score
    let _totalWeight = 0;

    // Positive affinity rules
    for (const rule of request.metadata.preferences.affinityRules) {
      const matches = this.evaluateAffinityRule(candidate, rule);
      if (matches) {
        if (rule.type === 'hard') {
          score += 0.5;
        } else {
          score += (rule.weight / 100) * 0.3;
        }
      }
      _totalWeight += rule.type === 'hard' ? 1 : rule.weight / 100;
    }

    // Negative affinity rules (anti-affinity)
    for (const rule of request.metadata.preferences.antiAffinityRules) {
      // This would need access to currently running jobs
      // For now, assume neutral impact
      _totalWeight += rule.type === 'hard' ? 1 : rule.weight / 100;
    }

    return Math.max(0, Math.min(1, score));
  }

  private evaluateAffinityRule(candidate: RunnerCandidate, rule: AffinityRule): boolean {
    const selector = rule.selector;

    // Check labels
    if (selector.labels) {
      for (const [key, value] of Object.entries(selector.labels)) {
        if (candidate.labels[key] !== value) {
          return false;
        }
      }
    }

    // Check capabilities
    if (selector.capabilities) {
      for (const capability of selector.capabilities) {
        if (!candidate.capabilities.includes(capability)) {
          return false;
        }
      }
    }

    return true;
  }

  private calculateHistoryScore(candidate: RunnerCandidate, _request: JobRoutingRequest): number {
    if (candidate.performanceHistory.length === 0) {
      return 0.5; // Neutral score for new runners
    }

    // Calculate success rate
    const successfulJobs = candidate.performanceHistory.filter(h => h.success);
    const successRate = successfulJobs.length / candidate.performanceHistory.length;

    // Calculate average performance
    const avgPerformance = successfulJobs.reduce((sum, h) => {
      const accuracy = h.actualDuration > 0 ? 
        Math.max(0, 1 - Math.abs(h.actualDuration - h.estimatedDuration) / h.estimatedDuration) : 
        0.5;
      return sum + accuracy;
    }, 0) / (successfulJobs.length || 1);

    return (successRate * 0.6) + (avgPerformance * 0.4);
  }

  private parseMemoryToGB(memory: string): number {
    const value = parseFloat(memory);
    const unit = memory.toLowerCase().slice(-2);
    
    switch (unit) {
      case 'gb': return value;
      case 'mb': return value / 1024;
      case 'tb': return value * 1024;
      default: return value;
    }
  }

  private createSuccessResult(
    selected: RunnerCandidate, 
    alternatives: RunnerCandidate[], 
    request: JobRoutingRequest,
    reasoning: string
  ): JobRoutingResult {
    return {
      success: true,
      routingDecision: {
        algorithm: RoutingAlgorithm.INTELLIGENT,
        strategy: RoutingStrategy.ADAPTIVE,
        factors: [
          RoutingFactor.RESOURCE_AVAILABILITY,
          RoutingFactor.CURRENT_LOAD,
          RoutingFactor.CAPABILITY_MATCHING,
          RoutingFactor.AFFINITY_RULES,
          RoutingFactor.HISTORICAL_PERFORMANCE
        ],
        confidence: 0.95
      },
      selectedRunner: {
        runnerId: selected.id,
        runnerType: selected.type,
        score: this.calculateIntelligentScore(selected, request),
        reasoning,
        capabilities: selected.capabilities,
        currentLoad: selected.currentLoad,
        estimatedPerformance: {
          expectedDuration: request.metadata.estimatedDuration,
          resourceUtilization: {
            cpu: Math.min(0.85, selected.currentLoad + 0.3),
            memory: 0.65,
            disk: 0.4,
            network: 0.3
          },
          confidenceLevel: 0.95
        }
      },
      alternatives: alternatives.slice(0, 3).map((runner, index) => ({
        runnerId: runner.id,
        runnerType: runner.type,
        score: this.calculateIntelligentScore(runner, request),
        reasoning: `Intelligent alternative (rank ${index + 2})`,
        capabilities: runner.capabilities,
        currentLoad: runner.currentLoad,
        estimatedPerformance: {
          expectedDuration: request.metadata.estimatedDuration * (1.05 + index * 0.05),
          resourceUtilization: {
            cpu: Math.min(0.85, runner.currentLoad + 0.3),
            memory: 0.65,
            disk: 0.4,
            network: 0.3
          },
          confidenceLevel: 0.9 - (index * 0.05)
        }
      })),
      reasoning: {
        primaryFactors: ['Multi-factor optimization', 'Intelligent scoring'],
        secondaryFactors: ['Resource fitness', 'Capability matching', 'Performance history'],
        constraints: ['Affinity rules', 'Load balancing'],
        tradeoffs: ['Computational complexity for better accuracy'],
        warnings: []
      },
      estimatedStartTime: new Date(),
      estimatedCompletionTime: new Date(Date.now() + request.metadata.estimatedDuration * 1000),
      metrics: {
        routingTime: 0,
        candidatesEvaluated: alternatives.length + 1,
        algorithmComplexity: 4,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
  }

  private createFailureResult(reason: string): JobRoutingResult {
    return {
      success: false,
      routingDecision: {
        algorithm: RoutingAlgorithm.INTELLIGENT,
        strategy: RoutingStrategy.ADAPTIVE,
        factors: [],
        confidence: 0
      },
      alternatives: [],
      reasoning: {
        primaryFactors: [],
        secondaryFactors: [],
        constraints: [],
        tradeoffs: [],
        warnings: [reason]
      },
      estimatedStartTime: new Date(),
      estimatedCompletionTime: new Date(),
      metrics: {
        routingTime: 0,
        candidatesEvaluated: 0,
        algorithmComplexity: 4,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
  }
}

class MLBasedAlgorithm extends RoutingAlgorithmImpl {
  async route(candidates: RunnerCandidate[], request: JobRoutingRequest): Promise<JobRoutingResult> {
    if (candidates.length === 0) {
      return this.createFailureResult('No available runners');
    }

    // Simulate ML-based scoring (in production, this would use actual ML models)
    const scoredCandidates = candidates.map(candidate => ({
      candidate,
      score: this.calculateMLScore(candidate, request),
      prediction: this.generateMLPrediction(candidate, request)
    })).sort((a, b) => b.score - a.score);

    const selectedRunner = scoredCandidates[0];
    const alternatives = scoredCandidates.slice(1).map(sc => sc.candidate);

    return this.createSuccessResult(
      selectedRunner.candidate, 
      alternatives, 
      request, 
      `ML-predicted optimal selection (confidence: ${selectedRunner.prediction.confidence.toFixed(2)}, predicted duration: ${selectedRunner.prediction.expectedDuration}s)`
    );
  }

  getComplexity(): number {
    return 5; // O(n) for ML inference + O(n log n) for sorting
  }

  private calculateMLScore(candidate: RunnerCandidate, request: JobRoutingRequest): number {
    // Simulate ML model prediction based on features
    const features = this.extractFeatures(candidate, request);
    
    // Simplified neural network simulation
    let score = 0;
    
    // Layer 1: Feature processing
    const processedFeatures = features.map(f => Math.tanh(f));
    
    // Layer 2: Weighted combination (simulated learned weights)
    const weights = [0.3, 0.25, 0.2, 0.15, 0.1]; // Corresponds to feature importance
    score = processedFeatures.reduce((sum, feature, index) => {
      return sum + feature * (weights[index] || 0.1);
    }, 0);
    
    // Output layer: Sigmoid activation
    return 1 / (1 + Math.exp(-score));
  }

  private extractFeatures(candidate: RunnerCandidate, request: JobRoutingRequest): number[] {
    const features: number[] = [];

    // Feature 1: Resource utilization efficiency
    const cpuRatio = candidate.resources.cpu / request.resourceRequirements.cpu.preferred;
    features.push(Math.min(2, cpuRatio) - 1); // Normalize around 0

    // Feature 2: Current load normalized
    features.push(candidate.currentLoad * 2 - 1); // Range: -1 to 1

    // Feature 3: Capability match ratio
    const requiredCaps = request.metadata.constraints.requiredCapabilities;
    const matchRatio = requiredCaps.length > 0 ? 
      requiredCaps.filter(cap => candidate.capabilities.includes(cap)).length / requiredCaps.length :
      1;
    features.push(matchRatio * 2 - 1);

    // Feature 4: Historical performance score
    let perfScore = 0.5; // Default for new runners
    if (candidate.performanceHistory.length > 0) {
      const successRate = candidate.performanceHistory.filter(h => h.success).length / candidate.performanceHistory.length;
      perfScore = successRate;
    }
    features.push(perfScore * 2 - 1);

    // Feature 5: Job priority impact
    const priorityWeight = (6 - request.priority) / 5; // Higher priority = higher weight
    features.push(priorityWeight * 2 - 1);

    return features;
  }

  private generateMLPrediction(candidate: RunnerCandidate, request: JobRoutingRequest): MLPrediction {
    const baseScore = this.calculateMLScore(candidate, request);
    
    // Simulate prediction uncertainty based on historical data
    const historyConfidence = candidate.performanceHistory.length > 0 ? 
      Math.min(1, candidate.performanceHistory.length / 10) : 0.3;
    
    const confidence = baseScore * historyConfidence;
    
    // Predict duration with some variance
    const baseDuration = request.metadata.estimatedDuration;
    const loadFactor = 1 + (candidate.currentLoad * 0.5);
    const expectedDuration = Math.round(baseDuration * loadFactor);
    
    return {
      score: baseScore,
      confidence,
      expectedDuration,
      resourcePrediction: {
        cpuPeak: Math.min(1, candidate.currentLoad + 0.4),
        memoryPeak: 0.7,
        diskIO: 0.3,
        networkIO: 0.2
      },
      risks: this.identifyRisks(candidate, request, baseScore)
    };
  }

  private identifyRisks(candidate: RunnerCandidate, request: JobRoutingRequest, score: number): string[] {
    const risks: string[] = [];

    if (candidate.currentLoad > 0.7) {
      risks.push('High current load may impact performance');
    }

    if (score < 0.6) {
      risks.push('Low confidence in successful execution');
    }

    if (candidate.performanceHistory.length < 5) {
      risks.push('Limited historical data for prediction');
    }

    const requiredCaps = request.metadata.constraints.requiredCapabilities;
    const missingCaps = requiredCaps.filter(cap => !candidate.capabilities.includes(cap));
    if (missingCaps.length > 0) {
      risks.push(`Missing capabilities: ${missingCaps.join(', ')}`);
    }

    return risks;
  }

  private createSuccessResult(
    selected: RunnerCandidate, 
    alternatives: RunnerCandidate[], 
    request: JobRoutingRequest,
    reasoning: string
  ): JobRoutingResult {
    const prediction = this.generateMLPrediction(selected, request);

    return {
      success: true,
      routingDecision: {
        algorithm: RoutingAlgorithm.MACHINE_LEARNING,
        strategy: RoutingStrategy.ADAPTIVE,
        factors: [
          RoutingFactor.HISTORICAL_PERFORMANCE,
          RoutingFactor.RESOURCE_AVAILABILITY,
          RoutingFactor.CAPABILITY_MATCHING,
          RoutingFactor.CURRENT_LOAD
        ],
        confidence: prediction.confidence
      },
      selectedRunner: {
        runnerId: selected.id,
        runnerType: selected.type,
        score: prediction.score,
        reasoning,
        capabilities: selected.capabilities,
        currentLoad: selected.currentLoad,
        estimatedPerformance: {
          expectedDuration: prediction.expectedDuration,
          resourceUtilization: {
            cpu: prediction.resourcePrediction.cpuPeak,
            memory: prediction.resourcePrediction.memoryPeak,
            disk: prediction.resourcePrediction.diskIO,
            network: prediction.resourcePrediction.networkIO
          },
          confidenceLevel: prediction.confidence
        }
      },
      alternatives: alternatives.slice(0, 3).map((runner, _index) => {
        const altPrediction = this.generateMLPrediction(runner, request);
        return {
          runnerId: runner.id,
          runnerType: runner.type,
          score: altPrediction.score,
          reasoning: `ML alternative (confidence: ${altPrediction.confidence.toFixed(2)})`,
          capabilities: runner.capabilities,
          currentLoad: runner.currentLoad,
          estimatedPerformance: {
            expectedDuration: altPrediction.expectedDuration,
            resourceUtilization: {
              cpu: altPrediction.resourcePrediction.cpuPeak,
              memory: altPrediction.resourcePrediction.memoryPeak,
              disk: altPrediction.resourcePrediction.diskIO,
              network: altPrediction.resourcePrediction.networkIO
            },
            confidenceLevel: altPrediction.confidence
          }
        };
      }),
      reasoning: {
        primaryFactors: ['Machine learning optimization', 'Predictive analytics'],
        secondaryFactors: ['Historical pattern analysis', 'Multi-dimensional feature analysis'],
        constraints: ['Model confidence thresholds'],
        tradeoffs: ['Higher accuracy with increased computational cost'],
        warnings: prediction.risks
      },
      estimatedStartTime: new Date(),
      estimatedCompletionTime: new Date(Date.now() + prediction.expectedDuration * 1000),
      metrics: {
        routingTime: 0,
        candidatesEvaluated: alternatives.length + 1,
        algorithmComplexity: 5,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
  }

  private createFailureResult(reason: string): JobRoutingResult {
    return {
      success: false,
      routingDecision: {
        algorithm: RoutingAlgorithm.MACHINE_LEARNING,
        strategy: RoutingStrategy.ADAPTIVE,
        factors: [],
        confidence: 0
      },
      alternatives: [],
      reasoning: {
        primaryFactors: [],
        secondaryFactors: [],
        constraints: [],
        tradeoffs: [],
        warnings: [reason]
      },
      estimatedStartTime: new Date(),
      estimatedCompletionTime: new Date(),
      metrics: {
        routingTime: 0,
        candidatesEvaluated: 0,
        algorithmComplexity: 5,
        cacheHits: 0,
        cacheMisses: 0
      }
    };
  }
}

interface MLPrediction {
  score: number;
  confidence: number;
  expectedDuration: number;
  resourcePrediction: {
    cpuPeak: number;
    memoryPeak: number;
    diskIO: number;
    networkIO: number;
  };
  risks: string[];
}

export default JobRouter;