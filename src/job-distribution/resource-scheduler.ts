import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import { JobRoutingRequest, ResourceRequirements, JobPriority } from './job-router';

const logger = createLogger('ResourceScheduler');

export interface SchedulerConfig {
  schedulingAlgorithm: SchedulingAlgorithm;
  resourcePools: ResourcePool[];
  schedulingInterval: number;
  preemptionEnabled: boolean;
  fairShareEnabled: boolean;
  backfillEnabled: boolean;
  resourceReservation: boolean;
  autoScaling: AutoScalingConfig;
}

export interface ResourcePool {
  id: string;
  name: string;
  description: string;
  capacity: ResourceCapacity;
  allocation: ResourceAllocation;
  runners: PoolRunner[];
  policies: PoolPolicies;
  status: PoolStatus;
  metrics: PoolMetrics;
}

export interface ResourceCapacity {
  cpu: {
    total: number; // Total CPU cores
    available: number;
    reserved: number;
  };
  memory: {
    total: string; // e.g., "1TB"
    available: string;
    reserved: string;
  };
  storage: {
    total: string;
    available: string;
    reserved: string;
  };
  network: {
    bandwidth: string; // e.g., "10Gbps"
    available: string;
  };
  gpu?: {
    total: number;
    available: number;
    types: Record<string, number>; // e.g., {"nvidia-v100": 4}
  };
  specialized: Record<string, number>; // Custom resources
}

export interface ResourceAllocation {
  cpu: number;
  memory: string;
  storage: string;
  network: string;
  gpu?: number;
  specialized: Record<string, number>;
}

export interface PoolRunner {
  id: string;
  name: string;
  status: RunnerStatus;
  capacity: ResourceCapacity;
  allocation: ResourceAllocation;
  utilization: ResourceUtilization;
  jobs: RunningJob[];
  lastHeartbeat: Date;
  metadata: RunnerMetadata;
}

export interface RunnerMetadata {
  labels: Record<string, string>;
  capabilities: string[];
  architecture: string;
  operatingSystem: string;
  containerRuntime: string;
  location: {
    region: string;
    zone: string;
    datacenter: string;
  };
  performance: {
    benchmarkScore: number;
    averageJobDuration: number;
    reliability: number; // 0-1
  };
}

export interface PoolPolicies {
  maxJobsPerRunner: number;
  maxCpuUtilization: number; // 0-1
  maxMemoryUtilization: number; // 0-1
  preemptionPolicy: PreemptionPolicy;
  resourceLimits: ResourceLimits;
  schedulingConstraints: SchedulingConstraints;
}

export interface PreemptionPolicy {
  enabled: boolean;
  priorityThreshold: JobPriority;
  gracePeriod: number; // seconds
  strategy: PreemptionStrategy;
}

export interface ResourceLimits {
  cpuQuota: number; // cores per job
  memoryQuota: string; // memory per job
  storageQuota: string; // storage per job
  networkQuota: string; // network per job
  timeQuota: number; // max execution time per job
}

export interface SchedulingConstraints {
  allowedJobTypes: string[];
  blockedJobTypes: string[];
  requiredLabels: Record<string, string>;
  antiAffinityRules: string[];
  timeWindows: SchedulingWindow[];
}

export interface SchedulingWindow {
  start: string; // HH:mm format
  end: string;
  daysOfWeek: number[]; // 0-6, 0 = Sunday
  timezone: string;
  priority: JobPriority;
}

export interface PoolMetrics {
  totalJobs: number;
  activeJobs: number;
  queuedJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageWaitTime: number;
  averageExecutionTime: number;
  throughput: number; // jobs per hour
  efficiency: number; // 0-1
  utilization: ResourceUtilization;
}

export interface ResourceUtilization {
  cpu: number; // 0-1
  memory: number; // 0-1
  storage: number; // 0-1
  network: number; // 0-1
  gpu?: number; // 0-1
}

export interface SchedulingRequest {
  job: JobRoutingRequest;
  constraints: SchedulingConstraints;
  preferences: SchedulingPreferences;
  deadline?: Date;
  estimatedDuration: number;
  resourceRequirements: ResourceRequirements;
}

export interface SchedulingPreferences {
  preferredPools: string[];
  preferredRunners: string[];
  performanceProfile: PerformanceProfile;
  costOptimization: boolean;
  powerEfficiency: boolean;
  locality: LocalityPreference;
}

export interface LocalityPreference {
  region?: string;
  zone?: string;
  datacenter?: string;
  colocation: boolean; // Prefer same location as related jobs
}

export interface SchedulingResult {
  success: boolean;
  scheduledJob?: ScheduledJob;
  alternatives: ScheduledJob[];
  reason: string;
  metrics: SchedulingMetrics;
  warnings: string[];
}

export interface ScheduledJob {
  jobId: string;
  poolId: string;
  runnerId: string;
  scheduledAt: Date;
  estimatedStartTime: Date;
  estimatedCompletionTime: Date;
  resourceAllocation: ResourceAllocation;
  priority: JobPriority;
  preemptible: boolean;
}

export interface SchedulingMetrics {
  schedulingTime: number; // ms
  poolsEvaluated: number;
  runnersEvaluated: number;
  constraintsApplied: number;
  resourceFragmentation: number; // 0-1
  schedulingEfficiency: number; // 0-1
}

export interface AutoScalingConfig {
  enabled: boolean;
  minRunners: number;
  maxRunners: number;
  scaleUpThreshold: number; // 0-1 utilization
  scaleDownThreshold: number; // 0-1 utilization
  scaleUpCooldown: number; // seconds
  scaleDownCooldown: number; // seconds
  scaleUpSteps: number; // runners to add
  scaleDownSteps: number; // runners to remove
  predictiveScaling: boolean;
}

export interface RunningJob {
  id: string;
  startTime: Date;
  estimatedEndTime: Date;
  priority: JobPriority;
  resourceUsage: ResourceAllocation;
  preemptible: boolean;
}

export enum SchedulingAlgorithm {
  FIFO = 'fifo',
  FAIR_SHARE = 'fair-share',
  PRIORITY = 'priority',
  SHORTEST_JOB_FIRST = 'shortest-job-first',
  BACKFILL = 'backfill',
  GANG_SCHEDULING = 'gang-scheduling',
  DEADLINE_AWARE = 'deadline-aware',
  MULTI_OBJECTIVE = 'multi-objective'
}

export enum RunnerStatus {
  ACTIVE = 'active',
  IDLE = 'idle',
  BUSY = 'busy',
  DRAINING = 'draining',
  MAINTENANCE = 'maintenance',
  OFFLINE = 'offline',
  ERROR = 'error'
}

export enum PoolStatus {
  ACTIVE = 'active',
  DRAINING = 'draining',
  MAINTENANCE = 'maintenance',
  SCALING = 'scaling',
  DISABLED = 'disabled'
}

export enum PreemptionStrategy {
  LOWEST_PRIORITY = 'lowest-priority',
  SHORTEST_REMAINING = 'shortest-remaining',
  LEAST_PROGRESS = 'least-progress',
  NEWEST_JOB = 'newest-job'
}

export enum PerformanceProfile {
  SPEED = 'speed',
  EFFICIENCY = 'efficiency',
  BALANCED = 'balanced',
  COST_OPTIMIZED = 'cost-optimized'
}

export class ResourceScheduler extends EventEmitter {
  private static instance: ResourceScheduler;
  private config: SchedulerConfig;
  private resourcePools: Map<string, ResourcePool> = new Map();
  private schedulingQueue: SchedulingRequest[] = [];
  private scheduledJobs: Map<string, ScheduledJob> = new Map();
  private schedulingInterval?: NodeJS.Timeout;
  private autoScaler: AutoScaler;
  private fairShareCalculator: FairShareCalculator;
  private backfillScheduler: BackfillScheduler;

  private constructor(config: SchedulerConfig) {
    super();
    this.config = config;
    this.autoScaler = new AutoScaler(config.autoScaling);
    this.fairShareCalculator = new FairShareCalculator();
    this.backfillScheduler = new BackfillScheduler();
    this.initializeResourcePools();
    this.startSchedulingLoop();
  }

  public static getInstance(config?: SchedulerConfig): ResourceScheduler {
    if (!ResourceScheduler.instance) {
      const defaultConfig: SchedulerConfig = {
        schedulingAlgorithm: SchedulingAlgorithm.MULTI_OBJECTIVE,
        resourcePools: [],
        schedulingInterval: 5000, // 5 seconds
        preemptionEnabled: true,
        fairShareEnabled: true,
        backfillEnabled: true,
        resourceReservation: true,
        autoScaling: {
          enabled: true,
          minRunners: 2,
          maxRunners: 100,
          scaleUpThreshold: 0.8,
          scaleDownThreshold: 0.3,
          scaleUpCooldown: 300,
          scaleDownCooldown: 600,
          scaleUpSteps: 2,
          scaleDownSteps: 1,
          predictiveScaling: false
        }
      };

      ResourceScheduler.instance = new ResourceScheduler(config || defaultConfig);
    }
    return ResourceScheduler.instance;
  }

  /**
   * Schedule a job for execution
   */
  public async scheduleJob(request: SchedulingRequest): Promise<SchedulingResult> {
    const startTime = Date.now();

    try {
      logger.info(`Scheduling job ${request.job.jobId}`);

      // Validate scheduling request
      this.validateSchedulingRequest(request);

      // Check if immediate scheduling is possible
      const immediateResult = await this.tryImmediateScheduling(request);
      if (immediateResult.success) {
        return immediateResult;
      }

      // Add to scheduling queue
      this.addToSchedulingQueue(request);

      // Return queued result
      return this.createQueuedResult(request, Date.now() - startTime);

    } catch (error) {
      logger.error(`Failed to schedule job ${request.job.jobId}:`, error);
      return this.createErrorResult(request, error as Error, Date.now() - startTime);
    }
  }

  /**
   * Try to schedule job immediately
   */
  private async tryImmediateScheduling(request: SchedulingRequest): Promise<SchedulingResult> {
    const startTime = Date.now();

    // Find eligible pools
    const eligiblePools = this.findEligiblePools(request);
    if (eligiblePools.length === 0) {
      return this.createFailureResult(request, 'No eligible resource pools found', Date.now() - startTime);
    }

    // Apply scheduling algorithm
    const schedulingResult = await this.applySchedulingAlgorithm(request, eligiblePools);
    if (!schedulingResult) {
      return this.createFailureResult(request, 'No suitable runners available', Date.now() - startTime);
    }

    // Allocate resources
    const allocated = await this.allocateResources(schedulingResult, request);
    if (!allocated) {
      return this.createFailureResult(request, 'Resource allocation failed', Date.now() - startTime);
    }

    // Create scheduled job
    this.scheduledJobs.set(request.job.jobId, schedulingResult);

    logger.info(`Job ${request.job.jobId} scheduled immediately on runner ${schedulingResult.runnerId}`);

    return this.createSuccessResult(
      request,
      schedulingResult,
      [],
      'Immediate scheduling successful',
      Date.now() - startTime
    );
  }

  /**
   * Find eligible resource pools for a job
   */
  private findEligiblePools(request: SchedulingRequest): ResourcePool[] {
    const eligible: ResourcePool[] = [];

    for (const pool of this.resourcePools.values()) {
      if (this.isPoolEligible(pool, request)) {
        eligible.push(pool);
      }
    }

    // Sort pools by preference and availability
    return eligible.sort((a, b) => this.comparePoolSuitability(a, b, request));
  }

  /**
   * Check if pool is eligible for the job
   */
  private isPoolEligible(pool: ResourcePool, request: SchedulingRequest): boolean {
    // Check pool status
    if (pool.status !== PoolStatus.ACTIVE) {
      return false;
    }

    // Check resource availability
    if (!this.hasAvailableResources(pool, request.resourceRequirements)) {
      return false;
    }

    // Check constraints
    const constraints = request.constraints;
    
    // Check allowed job types
    if (constraints.allowedJobTypes.length > 0) {
      if (!constraints.allowedJobTypes.includes(request.job.metadata.jobType)) {
        return false;
      }
    }

    // Check blocked job types
    if (constraints.blockedJobTypes.includes(request.job.metadata.jobType)) {
      return false;
    }

    // Check time windows
    if (!this.isWithinSchedulingWindow(pool, request)) {
      return false;
    }

    return true;
  }

  /**
   * Check if pool has available resources
   */
  private hasAvailableResources(pool: ResourcePool, requirements: ResourceRequirements): boolean {
    // Check CPU
    if (pool.capacity.cpu.available < requirements.cpu.min) {
      return false;
    }

    // Check memory
    const availableMemoryGB = this.parseMemoryToGB(pool.capacity.memory.available);
    const requiredMemoryGB = this.parseMemoryToGB(requirements.memory.min);
    if (availableMemoryGB < requiredMemoryGB) {
      return false;
    }

    // Check storage
    const availableStorageGB = this.parseMemoryToGB(pool.capacity.storage.available);
    const requiredStorageGB = this.parseMemoryToGB(requirements.disk.min);
    if (availableStorageGB < requiredStorageGB) {
      return false;
    }

    // Check GPU if required
    if (requirements.gpu?.required) {
      if (!pool.capacity.gpu || pool.capacity.gpu.available < 1) {
        return false;
      }

      if (requirements.gpu.type) {
        const availableGpuType = pool.capacity.gpu.types[requirements.gpu.type] || 0;
        if (availableGpuType < 1) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if current time is within scheduling window
   */
  private isWithinSchedulingWindow(pool: ResourcePool, request: SchedulingRequest): boolean {
    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    for (const window of pool.policies.schedulingConstraints.timeWindows) {
      // Check if current day is allowed
      if (!window.daysOfWeek.includes(currentDay)) {
        continue;
      }

      // Check if current time is within window
      if (currentTime >= window.start && currentTime <= window.end) {
        // Check if job priority meets window requirements
        if (request.job.priority <= window.priority) {
          return true;
        }
      }
    }

    // If no windows defined, allow all times
    return pool.policies.schedulingConstraints.timeWindows.length === 0;
  }

  /**
   * Compare pool suitability for scheduling
   */
  private comparePoolSuitability(a: ResourcePool, b: ResourcePool, request: SchedulingRequest): number {
    // Prefer pools mentioned in preferences
    const aPreferred = request.preferences.preferredPools.includes(a.id);
    const bPreferred = request.preferences.preferredPools.includes(b.id);
    
    if (aPreferred && !bPreferred) return -1;
    if (!aPreferred && bPreferred) return 1;

    // Compare by available resources (prefer pools with more resources)
    const aAvailability = this.calculatePoolAvailability(a);
    const bAvailability = this.calculatePoolAvailability(b);
    
    if (aAvailability !== bAvailability) {
      return bAvailability - aAvailability;
    }

    // Compare by efficiency
    return b.metrics.efficiency - a.metrics.efficiency;
  }

  /**
   * Calculate pool resource availability score
   */
  private calculatePoolAvailability(pool: ResourcePool): number {
    const cpuAvail = pool.capacity.cpu.available / pool.capacity.cpu.total;
    const memAvail = this.parseMemoryToGB(pool.capacity.memory.available) / this.parseMemoryToGB(pool.capacity.memory.total);
    const storageAvail = this.parseMemoryToGB(pool.capacity.storage.available) / this.parseMemoryToGB(pool.capacity.storage.total);
    
    return (cpuAvail + memAvail + storageAvail) / 3;
  }

  /**
   * Apply scheduling algorithm to select best runner
   */
  private async applySchedulingAlgorithm(
    request: SchedulingRequest,
    pools: ResourcePool[]
  ): Promise<ScheduledJob | null> {
    switch (this.config.schedulingAlgorithm) {
      case SchedulingAlgorithm.FIFO:
        return this.scheduleFIFO(request, pools);
      
      case SchedulingAlgorithm.FAIR_SHARE:
        return this.scheduleFairShare(request, pools);
      
      case SchedulingAlgorithm.PRIORITY:
        return this.schedulePriority(request, pools);
      
      case SchedulingAlgorithm.SHORTEST_JOB_FIRST:
        return this.scheduleShortestJobFirst(request, pools);
      
      case SchedulingAlgorithm.BACKFILL:
        return this.scheduleBackfill(request, pools);
      
      case SchedulingAlgorithm.DEADLINE_AWARE:
        return this.scheduleDeadlineAware(request, pools);
      
      case SchedulingAlgorithm.MULTI_OBJECTIVE:
        return this.scheduleMultiObjective(request, pools);
      
      default:
        return this.scheduleFIFO(request, pools);
    }
  }

  /**
   * FIFO (First In, First Out) scheduling
   */
  private async scheduleFIFO(request: SchedulingRequest, pools: ResourcePool[]): Promise<ScheduledJob | null> {
    // Find first available runner that meets requirements
    for (const pool of pools) {
      const runner = this.findAvailableRunner(pool, request);
      if (runner) {
        return this.createScheduledJob(request, pool, runner);
      }
    }
    return null;
  }

  /**
   * Fair Share scheduling
   */
  private async scheduleFairShare(request: SchedulingRequest, pools: ResourcePool[]): Promise<ScheduledJob | null> {
    const fairShares = this.fairShareCalculator.calculateFairShares(request, pools);
    
    // Find runner in pool with lowest current usage relative to fair share
    let bestRunner: PoolRunner | null = null;
    let bestPool: ResourcePool | null = null;
    let bestScore = Infinity;

    for (const pool of pools) {
      const fairShare = fairShares.get(pool.id) || 0;
      const currentUsage = this.calculatePoolUsage(pool);
      const fairShareRatio = currentUsage / (fairShare || 1);

      if (fairShareRatio < bestScore) {
        const runner = this.findAvailableRunner(pool, request);
        if (runner) {
          bestScore = fairShareRatio;
          bestRunner = runner;
          bestPool = pool;
        }
      }
    }

    if (bestRunner && bestPool) {
      return this.createScheduledJob(request, bestPool, bestRunner);
    }

    return null;
  }

  /**
   * Priority-based scheduling
   */
  private async schedulePriority(request: SchedulingRequest, pools: ResourcePool[]): Promise<ScheduledJob | null> {
    // Check if preemption is needed for high-priority jobs
    if (request.job.priority <= JobPriority.HIGH && this.config.preemptionEnabled) {
      const preemptionResult = await this.attemptPreemption(request, pools);
      if (preemptionResult) {
        return preemptionResult;
      }
    }

    // Find best available runner
    return this.scheduleFIFO(request, pools);
  }

  /**
   * Shortest Job First scheduling
   */
  private async scheduleShortestJobFirst(request: SchedulingRequest, pools: ResourcePool[]): Promise<ScheduledJob | null> {
    // For immediate scheduling, this is similar to FIFO
    // In queue processing, jobs would be sorted by estimated duration
    return this.scheduleFIFO(request, pools);
  }

  /**
   * Backfill scheduling
   */
  private async scheduleBackfill(request: SchedulingRequest, pools: ResourcePool[]): Promise<ScheduledJob | null> {
    return this.backfillScheduler.schedule(request, pools);
  }

  /**
   * Deadline-aware scheduling
   */
  private async scheduleDeadlineAware(request: SchedulingRequest, pools: ResourcePool[]): Promise<ScheduledJob | null> {
    if (!request.deadline) {
      return this.scheduleFIFO(request, pools);
    }

    // Find runner that can complete job before deadline
    const now = new Date();
    const timeToDeadline = request.deadline.getTime() - now.getTime();
    
    for (const pool of pools) {
      const runner = this.findRunnerForDeadline(pool, request, timeToDeadline);
      if (runner) {
        return this.createScheduledJob(request, pool, runner);
      }
    }

    return null;
  }

  /**
   * Multi-objective scheduling
   */
  private async scheduleMultiObjective(request: SchedulingRequest, pools: ResourcePool[]): Promise<ScheduledJob | null> {
    interface ScoredRunner {
      pool: ResourcePool;
      runner: PoolRunner;
      score: number;
    }

    const candidates: ScoredRunner[] = [];

    // Score all available runners
    for (const pool of pools) {
      for (const runner of pool.runners) {
        if (this.isRunnerAvailable(runner, request)) {
          const score = this.calculateMultiObjectiveScore(pool, runner, request);
          candidates.push({ pool, runner, score });
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Select runner with highest score
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    return this.createScheduledJob(request, best.pool, best.runner);
  }

  /**
   * Calculate multi-objective score for runner
   */
  private calculateMultiObjectiveScore(pool: ResourcePool, runner: PoolRunner, request: SchedulingRequest): number {
    let score = 0;
    let factors = 0;

    // Performance factor (30%)
    const performanceScore = runner.metadata.performance.benchmarkScore / 100; // Normalize to 0-1
    score += performanceScore * 0.3;
    factors++;

    // Resource efficiency factor (25%)
    const resourceFit = this.calculateResourceFit(runner, request.resourceRequirements);
    score += resourceFit * 0.25;
    factors++;

    // Reliability factor (20%)
    score += runner.metadata.performance.reliability * 0.2;
    factors++;

    // Load balancing factor (15%)
    const loadScore = 1 - runner.utilization.cpu; // Prefer less loaded runners
    score += loadScore * 0.15;
    factors++;

    // Locality factor (10%)
    const localityScore = this.calculateLocalityScore(runner, request.preferences.locality);
    score += localityScore * 0.1;
    factors++;

    return score / factors;
  }

  /**
   * Calculate how well runner resources fit job requirements
   */
  private calculateResourceFit(runner: PoolRunner, requirements: ResourceRequirements): number {
    let score = 0;
    let factors = 0;

    // CPU fit
    const cpuRatio = runner.capacity.cpu.available / requirements.cpu.preferred;
    score += cpuRatio >= 1 ? Math.min(1, 2 - cpuRatio) : cpuRatio * 0.5;
    factors++;

    // Memory fit
    const runnerMemGB = this.parseMemoryToGB(runner.capacity.memory.available);
    const reqMemGB = this.parseMemoryToGB(requirements.memory.preferred);
    const memRatio = runnerMemGB / reqMemGB;
    score += memRatio >= 1 ? Math.min(1, 2 - memRatio) : memRatio * 0.5;
    factors++;

    // Storage fit
    const runnerStorageGB = this.parseMemoryToGB(runner.capacity.storage.available);
    const reqStorageGB = this.parseMemoryToGB(requirements.disk.preferred);
    const storageRatio = runnerStorageGB / reqStorageGB;
    score += storageRatio >= 1 ? Math.min(1, 2 - storageRatio) : storageRatio * 0.5;
    factors++;

    return score / factors;
  }

  /**
   * Calculate locality score based on preferences
   */
  private calculateLocalityScore(runner: PoolRunner, locality: LocalityPreference): number {
    if (!locality.region && !locality.zone && !locality.datacenter) {
      return 1; // No preference
    }

    let score = 0;
    let factors = 0;

    if (locality.region) {
      score += runner.metadata.location.region === locality.region ? 1 : 0;
      factors++;
    }

    if (locality.zone) {
      score += runner.metadata.location.zone === locality.zone ? 1 : 0;
      factors++;
    }

    if (locality.datacenter) {
      score += runner.metadata.location.datacenter === locality.datacenter ? 1 : 0;
      factors++;
    }

    return factors > 0 ? score / factors : 1;
  }

  /**
   * Find available runner in pool
   */
  private findAvailableRunner(pool: ResourcePool, request: SchedulingRequest): PoolRunner | null {
    for (const runner of pool.runners) {
      if (this.isRunnerAvailable(runner, request)) {
        return runner;
      }
    }
    return null;
  }

  /**
   * Check if runner is available for the job
   */
  private isRunnerAvailable(runner: PoolRunner, request: SchedulingRequest): boolean {
    // Check runner status
    if (runner.status !== RunnerStatus.ACTIVE && runner.status !== RunnerStatus.IDLE) {
      return false;
    }

    // Check capacity
    if (!this.hasAvailableResources(
      { capacity: runner.capacity } as ResourcePool, 
      request.resourceRequirements
    )) {
      return false;
    }

    // Check job limit
    if (runner.jobs.length >= runner.metadata.capabilities.includes('multi-job') ? 5 : 1) {
      return false;
    }

    // Check utilization limits
    if (runner.utilization.cpu > 0.9 || runner.utilization.memory > 0.9) {
      return false;
    }

    return true;
  }

  /**
   * Find runner that can meet deadline
   */
  private findRunnerForDeadline(pool: ResourcePool, request: SchedulingRequest, timeToDeadline: number): PoolRunner | null {
    for (const runner of pool.runners) {
      if (this.isRunnerAvailable(runner, request)) {
        // Estimate completion time based on runner performance
        const estimatedDuration = this.estimateJobDuration(runner, request);
        
        if (estimatedDuration < timeToDeadline) {
          return runner;
        }
      }
    }
    return null;
  }

  /**
   * Estimate job duration on specific runner
   */
  private estimateJobDuration(runner: PoolRunner, request: SchedulingRequest): number {
    const baseDuration = request.estimatedDuration;
    const performanceFactor = runner.metadata.performance.benchmarkScore / 100;
    const loadFactor = 1 + runner.utilization.cpu;
    
    return baseDuration * loadFactor / performanceFactor;
  }

  /**
   * Attempt preemption for high-priority job
   */
  private async attemptPreemption(request: SchedulingRequest, pools: ResourcePool[]): Promise<ScheduledJob | null> {
    // Find jobs that can be preempted
    const preemptibleJobs = this.findPreemptibleJobs(pools, request);
    
    if (preemptibleJobs.length === 0) {
      return null;
    }

    // Select job to preempt based on strategy
    const jobToPreempt = this.selectJobToPreempt(preemptibleJobs, request);
    
    if (jobToPreempt) {
      await this.preemptJob(jobToPreempt);
      
      // Schedule the high-priority job on the freed runner
      const pool = this.resourcePools.get(jobToPreempt.poolId)!;
      const runner = pool.runners.find(r => r.id === jobToPreempt.runnerId)!;
      
      return this.createScheduledJob(request, pool, runner);
    }

    return null;
  }

  /**
   * Find jobs that can be preempted
   */
  private findPreemptibleJobs(pools: ResourcePool[], request: SchedulingRequest): ScheduledJob[] {
    const preemptible: ScheduledJob[] = [];

    for (const job of this.scheduledJobs.values()) {
      if (job.preemptible && job.priority > request.job.priority) {
        preemptible.push(job);
      }
    }

    return preemptible;
  }

  /**
   * Select which job to preempt
   */
  private selectJobToPreempt(preemptibleJobs: ScheduledJob[], request: SchedulingRequest): ScheduledJob | null {
    if (preemptibleJobs.length === 0) return null;

    // Sort by priority (higher number = lower priority, preempt first)
    preemptibleJobs.sort((a, b) => b.priority - a.priority);

    // Return the lowest priority job
    return preemptibleJobs[0];
  }

  /**
   * Preempt a running job
   */
  private async preemptJob(job: ScheduledJob): Promise<void> {
    logger.info(`Preempting job ${job.jobId} on runner ${job.runnerId}`);

    // Remove from scheduled jobs
    this.scheduledJobs.delete(job.jobId);

    // Emit preemption event
    this.emit('job:preempted', { job });

    // In a real implementation, this would stop the actual job execution
  }

  /**
   * Create scheduled job
   */
  private createScheduledJob(request: SchedulingRequest, pool: ResourcePool, runner: PoolRunner): ScheduledJob {
    const now = new Date();
    const estimatedDuration = this.estimateJobDuration(runner, request);
    
    return {
      jobId: request.job.jobId,
      poolId: pool.id,
      runnerId: runner.id,
      scheduledAt: now,
      estimatedStartTime: now,
      estimatedCompletionTime: new Date(now.getTime() + estimatedDuration),
      resourceAllocation: this.calculateResourceAllocation(request.resourceRequirements),
      priority: request.job.priority,
      preemptible: request.job.priority > JobPriority.HIGH
    };
  }

  /**
   * Calculate resource allocation for job
   */
  private calculateResourceAllocation(requirements: ResourceRequirements): ResourceAllocation {
    return {
      cpu: requirements.cpu.preferred,
      memory: requirements.memory.preferred,
      storage: requirements.disk.preferred,
      network: requirements.network.bandwidth,
      specialized: {}
    };
  }

  /**
   * Allocate resources for scheduled job
   */
  private async allocateResources(job: ScheduledJob, request: SchedulingRequest): Promise<boolean> {
    const pool = this.resourcePools.get(job.poolId);
    const runner = pool?.runners.find(r => r.id === job.runnerId);
    
    if (!pool || !runner) {
      return false;
    }

    // Update pool capacity
    pool.capacity.cpu.available -= job.resourceAllocation.cpu;
    pool.capacity.cpu.reserved += job.resourceAllocation.cpu;

    // Update runner capacity
    runner.capacity.cpu.available -= job.resourceAllocation.cpu;

    // Add job to runner
    const runningJob: RunningJob = {
      id: job.jobId,
      startTime: job.estimatedStartTime,
      estimatedEndTime: job.estimatedCompletionTime,
      priority: job.priority,
      resourceUsage: job.resourceAllocation,
      preemptible: job.preemptible
    };

    runner.jobs.push(runningJob);

    logger.info(`Allocated resources for job ${job.jobId} on runner ${job.runnerId}`);
    return true;
  }

  /**
   * Add job to scheduling queue
   */
  private addToSchedulingQueue(request: SchedulingRequest): void {
    // Insert in priority order
    const insertIndex = this.findSchedulingQueueInsertIndex(request);
    this.schedulingQueue.splice(insertIndex, 0, request);

    logger.info(`Added job ${request.job.jobId} to scheduling queue at position ${insertIndex + 1}`);
  }

  /**
   * Find insertion index for scheduling queue
   */
  private findSchedulingQueueInsertIndex(request: SchedulingRequest): number {
    let left = 0;
    let right = this.schedulingQueue.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      
      if (this.schedulingQueue[mid].job.priority > request.job.priority) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }

  /**
   * Initialize resource pools
   */
  private initializeResourcePools(): void {
    // Create default resource pools from config
    for (const poolConfig of this.config.resourcePools) {
      this.resourcePools.set(poolConfig.id, poolConfig);
    }

    // If no pools configured, create a default one
    if (this.resourcePools.size === 0) {
      const defaultPool: ResourcePool = {
        id: 'default',
        name: 'Default Resource Pool',
        description: 'Default resource pool for GitHub Actions runners',
        capacity: {
          cpu: { total: 100, available: 100, reserved: 0 },
          memory: { total: '400GB', available: '400GB', reserved: '0GB' },
          storage: { total: '10TB', available: '10TB', reserved: '0TB' },
          network: { bandwidth: '10Gbps', available: '10Gbps' },
          specialized: {}
        },
        allocation: {
          cpu: 0,
          memory: '0GB',
          storage: '0GB',
          network: '0Mbps',
          specialized: {}
        },
        runners: [],
        policies: {
          maxJobsPerRunner: 1,
          maxCpuUtilization: 0.9,
          maxMemoryUtilization: 0.9,
          preemptionPolicy: {
            enabled: true,
            priorityThreshold: JobPriority.HIGH,
            gracePeriod: 300,
            strategy: PreemptionStrategy.LOWEST_PRIORITY
          },
          resourceLimits: {
            cpuQuota: 8,
            memoryQuota: '32GB',
            storageQuota: '100GB',
            networkQuota: '1Gbps',
            timeQuota: 7200 // 2 hours
          },
          schedulingConstraints: {
            allowedJobTypes: [],
            blockedJobTypes: [],
            requiredLabels: {},
            antiAffinityRules: [],
            timeWindows: []
          }
        },
        status: PoolStatus.ACTIVE,
        metrics: {
          totalJobs: 0,
          activeJobs: 0,
          queuedJobs: 0,
          completedJobs: 0,
          failedJobs: 0,
          averageWaitTime: 0,
          averageExecutionTime: 0,
          throughput: 0,
          efficiency: 1.0,
          utilization: {
            cpu: 0,
            memory: 0,
            storage: 0,
            network: 0
          }
        }
      };

      this.resourcePools.set('default', defaultPool);
    }

    logger.info(`Initialized ${this.resourcePools.size} resource pools`);
  }

  /**
   * Start scheduling loop
   */
  private startSchedulingLoop(): void {
    this.schedulingInterval = setInterval(() => {
      this.processSchedulingQueue();
    }, this.config.schedulingInterval);

    logger.info(`Started scheduling loop with ${this.config.schedulingInterval}ms interval`);
  }

  /**
   * Process scheduling queue
   */
  private async processSchedulingQueue(): Promise<void> {
    if (this.schedulingQueue.length === 0) {
      return;
    }

    logger.debug(`Processing scheduling queue with ${this.schedulingQueue.length} jobs`);

    const processedJobs: string[] = [];

    // Process jobs in order
    for (let i = 0; i < this.schedulingQueue.length; i++) {
      const request = this.schedulingQueue[i];

      try {
        const result = await this.tryImmediateScheduling(request);
        
        if (result.success) {
          processedJobs.push(request.job.jobId);
          this.emit('job:scheduled', { request, result });
        }
      } catch (error) {
        logger.error(`Failed to schedule queued job ${request.job.jobId}:`, error);
      }
    }

    // Remove processed jobs from queue
    this.schedulingQueue = this.schedulingQueue.filter(
      request => !processedJobs.includes(request.job.jobId)
    );

    // Run auto-scaling
    if (this.config.autoScaling.enabled) {
      await this.autoScaler.evaluate(this.resourcePools, this.schedulingQueue);
    }
  }

  /**
   * Validate scheduling request
   */
  private validateSchedulingRequest(request: SchedulingRequest): void {
    if (!request.job.jobId) {
      throw new Error('Job ID is required');
    }

    if (!request.resourceRequirements) {
      throw new Error('Resource requirements are required');
    }

    if (request.estimatedDuration <= 0) {
      throw new Error('Estimated duration must be positive');
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
      default: return value;
    }
  }

  private calculatePoolUsage(pool: ResourcePool): number {
    const cpuUsage = (pool.capacity.cpu.total - pool.capacity.cpu.available) / pool.capacity.cpu.total;
    const memUsage = this.parseMemoryToGB(pool.capacity.memory.total) - this.parseMemoryToGB(pool.capacity.memory.available);
    const memUsageRatio = memUsage / this.parseMemoryToGB(pool.capacity.memory.total);
    
    return (cpuUsage + memUsageRatio) / 2;
  }

  /**
   * Result creation methods
   */
  private createSuccessResult(
    request: SchedulingRequest,
    scheduledJob: ScheduledJob,
    alternatives: ScheduledJob[],
    reason: string,
    processingTime: number
  ): SchedulingResult {
    return {
      success: true,
      scheduledJob,
      alternatives,
      reason,
      metrics: {
        schedulingTime: processingTime,
        poolsEvaluated: this.resourcePools.size,
        runnersEvaluated: this.getTotalRunners(),
        constraintsApplied: this.countConstraints(request),
        resourceFragmentation: this.calculateResourceFragmentation(),
        schedulingEfficiency: 0.9
      },
      warnings: []
    };
  }

  private createQueuedResult(request: SchedulingRequest, processingTime: number): SchedulingResult {
    return {
      success: true,
      alternatives: [],
      reason: 'Job queued for scheduling',
      metrics: {
        schedulingTime: processingTime,
        poolsEvaluated: 0,
        runnersEvaluated: 0,
        constraintsApplied: 0,
        resourceFragmentation: 0,
        schedulingEfficiency: 0
      },
      warnings: ['Job added to scheduling queue']
    };
  }

  private createFailureResult(request: SchedulingRequest, reason: string, processingTime: number): SchedulingResult {
    return {
      success: false,
      alternatives: [],
      reason,
      metrics: {
        schedulingTime: processingTime,
        poolsEvaluated: this.resourcePools.size,
        runnersEvaluated: this.getTotalRunners(),
        constraintsApplied: this.countConstraints(request),
        resourceFragmentation: this.calculateResourceFragmentation(),
        schedulingEfficiency: 0
      },
      warnings: []
    };
  }

  private createErrorResult(request: SchedulingRequest, error: Error, processingTime: number): SchedulingResult {
    return {
      success: false,
      alternatives: [],
      reason: `Scheduling error: ${error.message}`,
      metrics: {
        schedulingTime: processingTime,
        poolsEvaluated: 0,
        runnersEvaluated: 0,
        constraintsApplied: 0,
        resourceFragmentation: 0,
        schedulingEfficiency: 0
      },
      warnings: [error.message]
    };
  }

  private getTotalRunners(): number {
    return Array.from(this.resourcePools.values())
      .reduce((total, pool) => total + pool.runners.length, 0);
  }

  private countConstraints(request: SchedulingRequest): number {
    let count = 0;
    const constraints = request.constraints;
    
    if (constraints.allowedJobTypes.length > 0) count++;
    if (constraints.blockedJobTypes.length > 0) count++;
    if (Object.keys(constraints.requiredLabels).length > 0) count++;
    if (constraints.antiAffinityRules.length > 0) count++;
    if (constraints.timeWindows.length > 0) count++;
    
    return count;
  }

  private calculateResourceFragmentation(): number {
    // Simplified fragmentation calculation
    let totalFragmentation = 0;
    let poolCount = 0;

    for (const pool of this.resourcePools.values()) {
      const cpuFrag = pool.capacity.cpu.available / pool.capacity.cpu.total;
      const memFrag = this.parseMemoryToGB(pool.capacity.memory.available) / this.parseMemoryToGB(pool.capacity.memory.total);
      
      totalFragmentation += (cpuFrag + memFrag) / 2;
      poolCount++;
    }

    return poolCount > 0 ? totalFragmentation / poolCount : 0;
  }

  /**
   * Public API methods
   */
  public getResourcePools(): ResourcePool[] {
    return Array.from(this.resourcePools.values());
  }

  public getSchedulingQueue(): SchedulingRequest[] {
    return [...this.schedulingQueue];
  }

  public getScheduledJobs(): ScheduledJob[] {
    return Array.from(this.scheduledJobs.values());
  }

  public async addResourcePool(pool: ResourcePool): Promise<void> {
    this.resourcePools.set(pool.id, pool);
    logger.info(`Added resource pool: ${pool.id}`);
  }

  public async removeResourcePool(poolId: string): Promise<void> {
    this.resourcePools.delete(poolId);
    logger.info(`Removed resource pool: ${poolId}`);
  }

  public async updatePoolStatus(poolId: string, status: PoolStatus): Promise<void> {
    const pool = this.resourcePools.get(poolId);
    if (pool) {
      pool.status = status;
      logger.info(`Updated pool ${poolId} status to ${status}`);
    }
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down resource scheduler');

    if (this.schedulingInterval) {
      clearInterval(this.schedulingInterval);
    }

    // Wait for current scheduling cycle to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    this.emit('shutdown:complete');
  }
}

/**
 * Supporting classes
 */
class AutoScaler {
  constructor(private config: AutoScalingConfig) {}

  async evaluate(pools: Map<string, ResourcePool>, queue: SchedulingRequest[]): Promise<void> {
    if (!this.config.enabled) return;

    for (const pool of pools.values()) {
      await this.evaluatePool(pool, queue);
    }
  }

  private async evaluatePool(pool: ResourcePool, queue: SchedulingRequest[]): Promise<void> {
    const utilization = this.calculatePoolUtilization(pool);
    const activeRunners = pool.runners.filter(r => r.status === RunnerStatus.ACTIVE).length;

    // Scale up if utilization is high
    if (utilization > this.config.scaleUpThreshold && activeRunners < this.config.maxRunners) {
      const runnersToAdd = Math.min(this.config.scaleUpSteps, this.config.maxRunners - activeRunners);
      await this.scaleUp(pool, runnersToAdd);
    }
    
    // Scale down if utilization is low
    else if (utilization < this.config.scaleDownThreshold && activeRunners > this.config.minRunners) {
      const runnersToRemove = Math.min(this.config.scaleDownSteps, activeRunners - this.config.minRunners);
      await this.scaleDown(pool, runnersToRemove);
    }
  }

  private calculatePoolUtilization(pool: ResourcePool): number {
    const totalCpu = pool.capacity.cpu.total;
    const availableCpu = pool.capacity.cpu.available;
    return totalCpu > 0 ? (totalCpu - availableCpu) / totalCpu : 0;
  }

  private async scaleUp(pool: ResourcePool, count: number): Promise<void> {
    logger.info(`Scaling up pool ${pool.id} by ${count} runners`);
    // Implementation would create new runners
  }

  private async scaleDown(pool: ResourcePool, count: number): Promise<void> {
    logger.info(`Scaling down pool ${pool.id} by ${count} runners`);
    // Implementation would remove idle runners
  }
}

class FairShareCalculator {
  calculateFairShares(request: SchedulingRequest, pools: ResourcePool[]): Map<string, number> {
    const shares = new Map<string, number>();
    
    // Simple equal share for now
    const equalShare = 1.0 / pools.length;
    
    for (const pool of pools) {
      shares.set(pool.id, equalShare);
    }
    
    return shares;
  }
}

class BackfillScheduler {
  async schedule(request: SchedulingRequest, pools: ResourcePool[]): Promise<ScheduledJob | null> {
    // Find slots where job can fit around existing jobs
    for (const pool of pools) {
      const slot = this.findBackfillSlot(pool, request);
      if (slot) {
        return slot;
      }
    }
    
    return null;
  }

  private findBackfillSlot(pool: ResourcePool, request: SchedulingRequest): ScheduledJob | null {
    // Simplified backfill - in practice would analyze time slots
    const availableRunner = pool.runners.find(r => 
      r.status === RunnerStatus.IDLE || 
      (r.status === RunnerStatus.ACTIVE && r.jobs.length === 0)
    );

    if (availableRunner) {
      return {
        jobId: request.job.jobId,
        poolId: pool.id,
        runnerId: availableRunner.id,
        scheduledAt: new Date(),
        estimatedStartTime: new Date(),
        estimatedCompletionTime: new Date(Date.now() + request.estimatedDuration),
        resourceAllocation: {
          cpu: request.resourceRequirements.cpu.preferred,
          memory: request.resourceRequirements.memory.preferred,
          storage: request.resourceRequirements.disk.preferred,
          network: request.resourceRequirements.network.bandwidth,
          specialized: {}
        },
        priority: request.job.priority,
        preemptible: request.job.priority > JobPriority.HIGH
      };
    }

    return null;
  }
}

export default ResourceScheduler;