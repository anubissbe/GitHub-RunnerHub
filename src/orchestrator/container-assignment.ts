import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';
import database from '../services/database';
import monitoringService from '../services/monitoring';

const logger = createLogger('ContainerAssignment');

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

export interface HealthStatus {
  healthy: boolean;
  lastCheck: Date;
  checks: {
    connectivity: boolean;
    diskSpace: boolean;
    memory: boolean;
    dockerDaemon: boolean;
  };
  message?: string;
}

export enum ContainerStatus {
  CREATING = 'creating',
  READY = 'ready',
  ASSIGNED = 'assigned',
  BUSY = 'busy',
  DRAINING = 'draining',
  UNHEALTHY = 'unhealthy',
  TERMINATING = 'terminating'
}

export interface AssignmentRequest {
  jobId: string;
  labels: string[];
  image?: string;
  resources?: Partial<ResourceConfig>;
  affinity?: AffinityRules;
  priority: number;
}

export interface AffinityRules {
  nodeAffinity?: {
    required?: string[];
    preferred?: string[];
  };
  containerAffinity?: {
    required?: string[];
    preferred?: string[];
  };
  antiAffinity?: {
    jobs?: string[];
    labels?: string[];
  };
}

export interface LoadBalancingStrategy {
  type: 'round-robin' | 'least-loaded' | 'resource-aware' | 'affinity-based';
  config?: any;
}

export class ContainerAssignmentManager extends EventEmitter {
  private static instance: ContainerAssignmentManager;
  private containers: Map<string, Container> = new Map();
  private assignments: Map<string, string> = new Map(); // jobId -> containerId
  private loadBalancingStrategy: LoadBalancingStrategy;
  private databaseService: typeof database;
  private metricsCollector: typeof monitoringService;
  
  private roundRobinIndex = 0;
  private assignmentHistory: Map<string, Date> = new Map();
  
  private constructor() {
    super();
    this.databaseService = database;
    this.metricsCollector = monitoringService;
    this.loadBalancingStrategy = {
      type: 'resource-aware' // Default strategy
    };
  }
  
  public static getInstance(): ContainerAssignmentManager {
    if (!ContainerAssignmentManager.instance) {
      ContainerAssignmentManager.instance = new ContainerAssignmentManager();
    }
    return ContainerAssignmentManager.instance;
  }
  
  public async initialize(): Promise<void> {
    logger.info('Initializing Container Assignment Manager');
    
    // Load existing containers from database
    await this.loadContainers();
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    logger.info('Container Assignment Manager initialized');
  }
  
  private async loadContainers(): Promise<void> {
    try {
      const containers = await this.databaseService.query<Container>(
        `SELECT * FROM runnerhub.containers WHERE status = 'active'`
      );
      
      for (const container of containers) {
        this.containers.set(container.id, container);
      }
      
      logger.info(`Loaded ${containers.length} active containers`);
    } catch (error) {
      logger.error('Failed to load containers:', error);
    }
  }
  
  /**
   * Register a new container
   */
  public async registerContainer(container: Container): Promise<void> {
    logger.info(`Registering container ${container.id}`);
    
    this.containers.set(container.id, container);
    await this.databaseService.query(
      `INSERT INTO runnerhub.containers (id, name, status, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = $2, status = $3, updated_at = NOW()`,
      [container.id, container.name, container.status, new Date()]
    );
    
    this.emit('container:registered', container);
  }
  
  /**
   * Unregister a container
   */
  public async unregisterContainer(containerId: string): Promise<void> {
    logger.info(`Unregistering container ${containerId}`);
    
    const container = this.containers.get(containerId);
    if (!container) return;
    
    // Release any assigned job
    if (container.assignedJob) {
      this.assignments.delete(container.assignedJob);
    }
    
    this.containers.delete(containerId);
    await this.databaseService.query(
      `DELETE FROM runnerhub.containers WHERE id = $1`,
      [containerId]
    );
    
    this.emit('container:unregistered', container);
  }
  
  /**
   * Assign a container to a job using load balancing
   */
  public async assignContainer(request: AssignmentRequest): Promise<Container | null> {
    logger.info(`Assigning container for job ${request.jobId}`, {
      labels: request.labels,
      priority: request.priority
    });
    
    // Get eligible containers
    const eligibleContainers = this.getEligibleContainers(request);
    
    if (eligibleContainers.length === 0) {
      logger.warn('No eligible containers available');
      this.emit('assignment:failed', { jobId: request.jobId, reason: 'no_containers' });
      return null;
    }
    
    // Select container based on load balancing strategy
    const container = await this.selectContainer(eligibleContainers, request);
    
    if (!container) {
      logger.error('Failed to select container');
      this.emit('assignment:failed', { jobId: request.jobId, reason: 'selection_failed' });
      return null;
    }
    
    // Perform assignment
    await this.performAssignment(container, request.jobId);
    
    return container;
  }
  
  private getEligibleContainers(request: AssignmentRequest): Container[] {
    const eligible: Container[] = [];
    
    for (const container of this.containers.values()) {
      // Check status
      if (container.status !== ContainerStatus.READY) {
        continue;
      }
      
      // Check health
      if (!container.healthStatus.healthy) {
        continue;
      }
      
      // Check labels
      if (request.labels.length > 0) {
        const hasRequiredLabels = request.labels.every(label => 
          container.labels[label] === 'true'
        );
        if (!hasRequiredLabels) {
          continue;
        }
      }
      
      // Check image compatibility
      if (request.image && container.image !== request.image) {
        // Allow compatible base images
        if (!this.areImagesCompatible(container.image, request.image)) {
          continue;
        }
      }
      
      // Check resource requirements
      if (request.resources) {
        if (!this.hasRequiredResources(container, request.resources)) {
          continue;
        }
      }
      
      // Check affinity rules
      if (request.affinity) {
        if (!this.checkAffinityRules(container, request.affinity)) {
          continue;
        }
      }
      
      eligible.push(container);
    }
    
    return eligible;
  }
  
  private areImagesCompatible(containerImage: string, requestedImage: string): boolean {
    // Simple compatibility check - can be enhanced
    const containerBase = containerImage.split(':')[0];
    const requestedBase = requestedImage.split(':')[0];
    
    // Check if same base image
    if (containerBase === requestedBase) {
      return true;
    }
    
    // Check for compatible alternatives
    const compatibilityMap: Record<string, string[]> = {
      'ubuntu': ['ubuntu', 'debian'],
      'debian': ['debian', 'ubuntu'],
      'node': ['node', 'ubuntu'],
      'python': ['python', 'ubuntu']
    };
    
    const compatibleImages = compatibilityMap[requestedBase] || [];
    return compatibleImages.includes(containerBase);
  }
  
  private hasRequiredResources(container: Container, required: Partial<ResourceConfig>): boolean {
    // Check CPU
    if (required.cpu && container.resources.cpu < required.cpu) {
      return false;
    }
    
    // Check memory
    if (required.memory) {
      const containerMemory = this.parseMemory(container.resources.memory);
      const requiredMemory = this.parseMemory(required.memory);
      if (containerMemory < requiredMemory) {
        return false;
      }
    }
    
    // Check available resources based on utilization
    const availableCpu = container.resources.cpu * (1 - container.utilization.cpu);
    const availableMemory = 1 - container.utilization.memory;
    
    if (required.cpu && availableCpu < required.cpu) {
      return false;
    }
    
    if (required.memory && availableMemory < 0.2) { // Need at least 20% free
      return false;
    }
    
    return true;
  }
  
  private parseMemory(memory: string): number {
    // Parse memory string to bytes
    const units: Record<string, number> = {
      'Ki': 1024,
      'Mi': 1024 * 1024,
      'Gi': 1024 * 1024 * 1024,
      'K': 1000,
      'M': 1000 * 1000,
      'G': 1000 * 1000 * 1000
    };
    
    const match = memory.match(/^(\d+)([KMG]i?)$/);
    if (!match) return 0;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    return value * (units[unit] || 1);
  }
  
  private checkAffinityRules(container: Container, affinity: AffinityRules): boolean {
    // Check node affinity
    if (affinity.nodeAffinity) {
      // Required rules must all match
      if (affinity.nodeAffinity.required) {
        const hasRequired = affinity.nodeAffinity.required.every(label => 
          container.labels[`node.${label}`] === 'true'
        );
        if (!hasRequired) return false;
      }
    }
    
    // Check anti-affinity
    if (affinity.antiAffinity) {
      // Check if container has conflicting jobs
      if (affinity.antiAffinity.jobs && container.assignedJob) {
        if (affinity.antiAffinity.jobs.includes(container.assignedJob)) {
          return false;
        }
      }
      
      // Check if container has conflicting labels
      if (affinity.antiAffinity.labels) {
        const hasConflicting = affinity.antiAffinity.labels.some(label => 
          container.labels[label] === 'true'
        );
        if (hasConflicting) return false;
      }
    }
    
    return true;
  }
  
  private async selectContainer(
    containers: Container[], 
    request: AssignmentRequest
  ): Promise<Container | null> {
    switch (this.loadBalancingStrategy.type) {
      case 'round-robin':
        return this.selectRoundRobin(containers);
        
      case 'least-loaded':
        return this.selectLeastLoaded(containers);
        
      case 'resource-aware':
        return this.selectResourceAware(containers, request);
        
      case 'affinity-based':
        return this.selectAffinityBased(containers, request);
        
      default:
        return this.selectResourceAware(containers, request);
    }
  }
  
  private selectRoundRobin(containers: Container[]): Container {
    const selected = containers[this.roundRobinIndex % containers.length];
    this.roundRobinIndex++;
    return selected;
  }
  
  private selectLeastLoaded(containers: Container[]): Container {
    return containers.reduce((least, current) => {
      const leastLoad = this.calculateLoad(least);
      const currentLoad = this.calculateLoad(current);
      return currentLoad < leastLoad ? current : least;
    });
  }
  
  private selectResourceAware(
    containers: Container[], 
    request: AssignmentRequest
  ): Container {
    // Score containers based on resource availability and requirements
    const scored = containers.map(container => ({
      container,
      score: this.scoreContainer(container, request)
    }));
    
    // Sort by score (higher is better)
    scored.sort((a, b) => b.score - a.score);
    
    // Log top 3 candidates
    logger.debug('Top container candidates:', 
      scored.slice(0, 3).map(s => ({
        id: s.container.id,
        score: s.score.toFixed(2)
      }))
    );
    
    return scored[0].container;
  }
  
  private selectAffinityBased(
    containers: Container[], 
    request: AssignmentRequest
  ): Container {
    // Score containers based on affinity preferences
    const scored = containers.map(container => ({
      container,
      score: this.scoreAffinity(container, request)
    }));
    
    scored.sort((a, b) => b.score - a.score);
    
    return scored[0].container;
  }
  
  private calculateLoad(container: Container): number {
    // Weighted average of resource utilization
    const weights = {
      cpu: 0.4,
      memory: 0.3,
      disk: 0.2,
      network: 0.1
    };
    
    return (
      container.utilization.cpu * weights.cpu +
      container.utilization.memory * weights.memory +
      container.utilization.disk * weights.disk +
      container.utilization.network * weights.network
    );
  }
  
  private scoreContainer(container: Container, request: AssignmentRequest): number {
    let score = 100;
    
    // Resource availability score (0-40 points)
    const resourceScore = (1 - this.calculateLoad(container)) * 40;
    score = resourceScore;
    
    // Health score (0-20 points)
    const healthScore = container.healthStatus.healthy ? 20 : 0;
    score += healthScore;
    
    // Recent usage penalty (-10 to 0 points)
    const lastAssignment = this.assignmentHistory.get(container.id);
    if (lastAssignment) {
      const timeSinceAssignment = Date.now() - lastAssignment.getTime();
      const recentUsagePenalty = Math.max(0, 10 - (timeSinceAssignment / 60000)); // Penalty decreases over 10 minutes
      score -= recentUsagePenalty;
    }
    
    // Priority bonus (0-20 points)
    if (request.priority <= 2) { // High priority
      score += 20;
    } else if (request.priority === 3) { // Normal priority
      score += 10;
    }
    
    // Label match bonus (0-20 points)
    const labelMatches = request.labels.filter(label => 
      container.labels[label] === 'true'
    ).length;
    const labelBonus = (labelMatches / Math.max(request.labels.length, 1)) * 20;
    score += labelBonus;
    
    return score;
  }
  
  private scoreAffinity(container: Container, request: AssignmentRequest): number {
    let score = 50; // Base score
    
    if (!request.affinity) return score;
    
    // Preferred node affinity
    if (request.affinity.nodeAffinity?.preferred) {
      const matches = request.affinity.nodeAffinity.preferred.filter(label => 
        container.labels[`node.${label}`] === 'true'
      ).length;
      score += matches * 10;
    }
    
    // Preferred container affinity
    if (request.affinity.containerAffinity?.preferred) {
      const matches = request.affinity.containerAffinity.preferred.filter(label => 
        container.labels[label] === 'true'
      ).length;
      score += matches * 10;
    }
    
    return score;
  }
  
  private async performAssignment(container: Container, jobId: string): Promise<void> {
    // Update container status
    container.status = ContainerStatus.ASSIGNED;
    container.assignedJob = jobId;
    
    // Update tracking
    this.assignments.set(jobId, container.id);
    this.assignmentHistory.set(container.id, new Date());
    
    // Save to database
    await this.databaseService.query(
      `INSERT INTO runnerhub.container_assignments (job_id, container_id, assigned_at) VALUES ($1, $2, $3)`,
      [jobId, container.id, new Date()]
    );
    
    // Update metrics
    this.metricsCollector.emit('assignment:created', {
      jobId,
      containerId: container.id,
      strategy: this.loadBalancingStrategy.type
    });
    
    logger.info(`Assigned container ${container.id} to job ${jobId}`);
    this.emit('container:assigned', { container, jobId });
  }
  
  /**
   * Release a container assignment
   */
  public async releaseContainer(jobId: string): Promise<void> {
    const containerId = this.assignments.get(jobId);
    if (!containerId) {
      logger.warn(`No container assigned to job ${jobId}`);
      return;
    }
    
    const container = this.containers.get(containerId);
    if (!container) {
      logger.error(`Container ${containerId} not found`);
      return;
    }
    
    // Update container status
    container.status = ContainerStatus.READY;
    container.assignedJob = undefined;
    
    // Update tracking
    this.assignments.delete(jobId);
    
    // Update database
    await this.databaseService.query(
      `UPDATE runnerhub.container_assignments SET completed_at = NOW() WHERE job_id = $1`,
      [jobId]
    );
    
    logger.info(`Released container ${containerId} from job ${jobId}`);
    this.emit('container:released', { container, jobId });
  }
  
  /**
   * Update container health status
   */
  public async updateContainerHealth(
    containerId: string, 
    health: HealthStatus
  ): Promise<void> {
    const container = this.containers.get(containerId);
    if (!container) return;
    
    container.healthStatus = health;
    container.lastHealthCheck = new Date();
    
    if (!health.healthy && container.status === ContainerStatus.READY) {
      container.status = ContainerStatus.UNHEALTHY;
      logger.warn(`Container ${containerId} marked unhealthy`);
      this.emit('container:unhealthy', container);
    } else if (health.healthy && container.status === ContainerStatus.UNHEALTHY) {
      container.status = ContainerStatus.READY;
      logger.info(`Container ${containerId} recovered`);
      this.emit('container:recovered', container);
    }
  }
  
  /**
   * Update container utilization
   */
  public async updateContainerUtilization(
    containerId: string, 
    utilization: ResourceUtilization
  ): Promise<void> {
    const container = this.containers.get(containerId);
    if (!container) return;
    
    container.utilization = utilization;
    
    // Check if container is overloaded
    if (utilization.cpu > 0.9 || utilization.memory > 0.9) {
      logger.warn(`Container ${containerId} is overloaded`, utilization);
      this.emit('container:overloaded', container);
    }
  }
  
  private startHealthMonitoring(): void {
    setInterval(async () => {
      for (const container of this.containers.values()) {
        // Skip unhealthy containers
        if (container.status === ContainerStatus.UNHEALTHY) {
          continue;
        }
        
        // Check if health check is overdue
        const timeSinceLastCheck = Date.now() - container.lastHealthCheck.getTime();
        if (timeSinceLastCheck > 60000) { // 1 minute
          logger.warn(`Container ${container.id} health check overdue`);
          
          // Mark as potentially unhealthy
          if (container.status === ContainerStatus.READY) {
            await this.updateContainerHealth(container.id, {
              healthy: false,
              lastCheck: new Date(),
              checks: {
                connectivity: false,
                diskSpace: true,
                memory: true,
                dockerDaemon: true
              },
              message: 'Health check timeout'
            });
          }
        }
      }
    }, 30000); // Check every 30 seconds
  }
  
  /**
   * Set load balancing strategy
   */
  public setLoadBalancingStrategy(strategy: LoadBalancingStrategy): void {
    this.loadBalancingStrategy = strategy;
    logger.info(`Load balancing strategy set to: ${strategy.type}`);
  }
  
  /**
   * Get container statistics
   */
  public getStatistics(): any {
    const stats = {
      total: this.containers.size,
      ready: 0,
      assigned: 0,
      unhealthy: 0,
      utilization: {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: 0
      }
    };
    
    for (const container of this.containers.values()) {
      switch (container.status) {
        case ContainerStatus.READY:
          stats.ready++;
          break;
        case ContainerStatus.ASSIGNED:
        case ContainerStatus.BUSY:
          stats.assigned++;
          break;
        case ContainerStatus.UNHEALTHY:
          stats.unhealthy++;
          break;
      }
      
      // Accumulate utilization
      stats.utilization.cpu += container.utilization.cpu;
      stats.utilization.memory += container.utilization.memory;
      stats.utilization.disk += container.utilization.disk;
      stats.utilization.network += container.utilization.network;
    }
    
    // Average utilization
    if (stats.total > 0) {
      stats.utilization.cpu /= stats.total;
      stats.utilization.memory /= stats.total;
      stats.utilization.disk /= stats.total;
      stats.utilization.network /= stats.total;
    }
    
    return stats;
  }
}

export default ContainerAssignmentManager;