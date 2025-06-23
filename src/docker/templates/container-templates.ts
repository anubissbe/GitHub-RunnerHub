import { createLogger } from '../../utils/logger';
import { DockerClient } from '../docker-client';
import Docker from 'dockerode';

const logger = createLogger('ContainerTemplates');

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  image: string;
  tag: string;
  category: ContainerCategory;
  labels: Record<string, string>;
  environment: Record<string, string>;
  workingDir?: string;
  user?: string;
  entrypoint?: string[];
  cmd?: string[];
  exposedPorts: PortConfig[];
  volumes: VolumeConfig[];
  resources: ResourceConfig;
  securityOptions: SecurityConfig;
  networkMode?: string;
  restartPolicy: RestartPolicy;
  healthCheck?: HealthCheckConfig;
  metadata: TemplateMetadata;
}

export interface PortConfig {
  containerPort: number;
  protocol: 'tcp' | 'udp';
  expose?: boolean;
  hostPort?: number;
}

export interface VolumeConfig {
  source: string;
  target: string;
  type: 'bind' | 'volume' | 'tmpfs';
  readonly?: boolean;
  options?: Record<string, any>;
}

export interface ResourceConfig {
  cpuLimit: number; // CPU cores
  memoryLimit: string; // e.g., "512m", "2g"
  cpuReservation?: number;
  memoryReservation?: string;
  diskQuota?: string;
  swapLimit?: string;
  oomKillDisable?: boolean;
  pidsLimit?: number;
}

export interface SecurityConfig {
  privileged: boolean;
  readOnlyRootfs: boolean;
  noNewPrivileges: boolean;
  capabilities: {
    add: string[];
    drop: string[];
  };
  seccompProfile?: string;
  apparmorProfile?: string;
  selinuxOptions?: {
    user?: string;
    role?: string;
    type?: string;
    level?: string;
  };
  sysctls?: Record<string, string>;
}

export interface RestartPolicy {
  name: 'no' | 'always' | 'unless-stopped' | 'on-failure';
  maximumRetryCount?: number;
}

export interface HealthCheckConfig {
  test: string[];
  interval: number; // seconds
  timeout: number; // seconds
  retries: number;
  startPeriod?: number; // seconds
}

export interface TemplateMetadata {
  version: string;
  maintainer: string;
  created: Date;
  updated: Date;
  tags: string[];
  githubActions: {
    compatible: boolean;
    requiredLabels: string[];
    supportedSteps: string[];
  };
  performance: {
    startupTime: number; // estimated seconds
    memoryFootprint: number; // MB
    cpuIntensive: boolean;
  };
  security: {
    level: 'low' | 'medium' | 'high' | 'critical';
    scanRequired: boolean;
    trustedBase: boolean;
  };
}

export enum ContainerCategory {
  GENERAL = 'general',
  NODEJS = 'nodejs',
  PYTHON = 'python',
  JAVA = 'java',
  DOTNET = 'dotnet',
  GO = 'go',
  RUST = 'rust',
  PHP = 'php',
  RUBY = 'ruby',
  DATABASE = 'database',
  TESTING = 'testing',
  SECURITY = 'security',
  DEPLOYMENT = 'deployment',
  CUSTOM = 'custom'
}

export class ContainerTemplateManager {
  private static instance: ContainerTemplateManager;
  private dockerClient: DockerClient;
  private templates: Map<string, TemplateConfig> = new Map();
  // Template registry configuration (reserved for future use)
  // private _templateRegistry: string;

  private constructor() {
    this.dockerClient = DockerClient.getInstance();
    // this._templateRegistry = process.env.TEMPLATE_REGISTRY || 'default';
    this.initializeDefaultTemplates();
  }

  public static getInstance(): ContainerTemplateManager {
    if (!ContainerTemplateManager.instance) {
      ContainerTemplateManager.instance = new ContainerTemplateManager();
    }
    return ContainerTemplateManager.instance;
  }

  /**
   * Initialize default container templates
   */
  private initializeDefaultTemplates(): void {
    logger.info('Initializing default container templates');

    // Ubuntu runner template
    this.registerTemplate({
      id: 'ubuntu-runner',
      name: 'Ubuntu GitHub Actions Runner',
      description: 'Standard Ubuntu environment for GitHub Actions',
      image: 'ubuntu',
      tag: '22.04',
      category: ContainerCategory.GENERAL,
      labels: {
        'github.runner.type': 'ubuntu',
        'github.runner.version': '22.04',
        'github.runner.category': 'general'
      },
      environment: {
        'DEBIAN_FRONTEND': 'noninteractive',
        'TZ': 'UTC',
        'GITHUB_ACTIONS': 'true',
        'CI': 'true'
      },
      workingDir: '/github/workspace',
      user: 'runner',
      exposedPorts: [],
      volumes: [
        {
          source: '/tmp',
          target: '/tmp',
          type: 'tmpfs',
          options: { size: '1g' }
        }
      ],
      resources: {
        cpuLimit: 2,
        memoryLimit: '4g',
        cpuReservation: 0.5,
        memoryReservation: '1g',
        diskQuota: '20g'
      },
      securityOptions: {
        privileged: false,
        readOnlyRootfs: false,
        noNewPrivileges: true,
        capabilities: {
          add: [],
          drop: ['ALL']
        }
      },
      restartPolicy: {
        name: 'no'
      },
      healthCheck: {
        test: ['CMD', 'curl', '-f', 'http://localhost:8080/health'],
        interval: 30,
        timeout: 10,
        retries: 3,
        startPeriod: 60
      },
      metadata: {
        version: '1.0.0',
        maintainer: 'GitHub RunnerHub',
        created: new Date(),
        updated: new Date(),
        tags: ['ubuntu', 'general', 'ci'],
        githubActions: {
          compatible: true,
          requiredLabels: ['self-hosted', 'linux', 'ubuntu'],
          supportedSteps: ['run', 'checkout', 'cache', 'upload-artifact']
        },
        performance: {
          startupTime: 15,
          memoryFootprint: 512,
          cpuIntensive: false
        },
        security: {
          level: 'medium',
          scanRequired: true,
          trustedBase: true
        }
      }
    });

    // Node.js runner template
    this.registerTemplate({
      id: 'nodejs-runner',
      name: 'Node.js GitHub Actions Runner',
      description: 'Node.js environment optimized for JavaScript/TypeScript projects',
      image: 'node',
      tag: '18-bullseye',
      category: ContainerCategory.NODEJS,
      labels: {
        'github.runner.type': 'nodejs',
        'github.runner.version': '18',
        'github.runner.category': 'development'
      },
      environment: {
        'NODE_ENV': 'production',
        'NPM_CONFIG_CACHE': '/github/workspace/.npm',
        'YARN_CACHE_FOLDER': '/github/workspace/.yarn',
        'CI': 'true',
        'GITHUB_ACTIONS': 'true'
      },
      workingDir: '/github/workspace',
      user: 'node',
      exposedPorts: [
        {
          containerPort: 3000,
          protocol: 'tcp',
          expose: true
        }
      ],
      volumes: [
        {
          source: '/github/workspace/.npm',
          target: '/root/.npm',
          type: 'volume'
        },
        {
          source: '/github/workspace/.yarn',
          target: '/usr/local/share/.cache/yarn',
          type: 'volume'
        }
      ],
      resources: {
        cpuLimit: 4,
        memoryLimit: '8g',
        cpuReservation: 1,
        memoryReservation: '2g',
        diskQuota: '30g'
      },
      securityOptions: {
        privileged: false,
        readOnlyRootfs: false,
        noNewPrivileges: true,
        capabilities: {
          add: [],
          drop: ['NET_ADMIN', 'SYS_ADMIN']
        }
      },
      restartPolicy: {
        name: 'on-failure',
        maximumRetryCount: 3
      },
      metadata: {
        version: '1.0.0',
        maintainer: 'GitHub RunnerHub',
        created: new Date(),
        updated: new Date(),
        tags: ['nodejs', 'javascript', 'typescript', 'npm', 'yarn'],
        githubActions: {
          compatible: true,
          requiredLabels: ['self-hosted', 'linux', 'nodejs'],
          supportedSteps: ['run', 'setup-node', 'cache', 'upload-artifact']
        },
        performance: {
          startupTime: 20,
          memoryFootprint: 1024,
          cpuIntensive: true
        },
        security: {
          level: 'medium',
          scanRequired: true,
          trustedBase: true
        }
      }
    });

    // Python runner template
    this.registerTemplate({
      id: 'python-runner',
      name: 'Python GitHub Actions Runner',
      description: 'Python environment with pip, poetry, and common scientific libraries',
      image: 'python',
      tag: '3.11-slim',
      category: ContainerCategory.PYTHON,
      labels: {
        'github.runner.type': 'python',
        'github.runner.version': '3.11',
        'github.runner.category': 'development'
      },
      environment: {
        'PYTHONUNBUFFERED': '1',
        'PYTHONDONTWRITEBYTECODE': '1',
        'PIP_NO_CACHE_DIR': '1',
        'PIP_DISABLE_PIP_VERSION_CHECK': '1',
        'CI': 'true',
        'GITHUB_ACTIONS': 'true'
      },
      workingDir: '/github/workspace',
      user: 'runner',
      exposedPorts: [
        {
          containerPort: 8000,
          protocol: 'tcp',
          expose: true
        }
      ],
      volumes: [
        {
          source: '/github/workspace/.cache/pip',
          target: '/root/.cache/pip',
          type: 'volume'
        }
      ],
      resources: {
        cpuLimit: 4,
        memoryLimit: '6g',
        cpuReservation: 1,
        memoryReservation: '2g',
        diskQuota: '25g'
      },
      securityOptions: {
        privileged: false,
        readOnlyRootfs: false,
        noNewPrivileges: true,
        capabilities: {
          add: [],
          drop: ['NET_ADMIN', 'SYS_ADMIN']
        }
      },
      restartPolicy: {
        name: 'on-failure',
        maximumRetryCount: 3
      },
      metadata: {
        version: '1.0.0',
        maintainer: 'GitHub RunnerHub',
        created: new Date(),
        updated: new Date(),
        tags: ['python', 'pip', 'poetry', 'scientific'],
        githubActions: {
          compatible: true,
          requiredLabels: ['self-hosted', 'linux', 'python'],
          supportedSteps: ['run', 'setup-python', 'cache', 'upload-artifact']
        },
        performance: {
          startupTime: 25,
          memoryFootprint: 1536,
          cpuIntensive: true
        },
        security: {
          level: 'medium',
          scanRequired: true,
          trustedBase: true
        }
      }
    });

    // Docker-in-Docker template
    this.registerTemplate({
      id: 'docker-dind',
      name: 'Docker-in-Docker Runner',
      description: 'Docker environment for building and running containers',
      image: 'docker',
      tag: 'dind',
      category: ContainerCategory.DEPLOYMENT,
      labels: {
        'github.runner.type': 'docker',
        'github.runner.version': 'latest',
        'github.runner.category': 'deployment'
      },
      environment: {
        'DOCKER_TLS_CERTDIR': '/certs',
        'DOCKER_DRIVER': 'overlay2',
        'CI': 'true',
        'GITHUB_ACTIONS': 'true'
      },
      workingDir: '/github/workspace',
      user: 'root',
      exposedPorts: [
        {
          containerPort: 2376,
          protocol: 'tcp',
          expose: false
        }
      ],
      volumes: [
        {
          source: '/var/lib/docker',
          target: '/var/lib/docker',
          type: 'volume'
        },
        {
          source: '/certs',
          target: '/certs',
          type: 'volume'
        }
      ],
      resources: {
        cpuLimit: 8,
        memoryLimit: '16g',
        cpuReservation: 2,
        memoryReservation: '4g',
        diskQuota: '100g'
      },
      securityOptions: {
        privileged: true,
        readOnlyRootfs: false,
        noNewPrivileges: false,
        capabilities: {
          add: ['SYS_ADMIN'],
          drop: []
        }
      },
      restartPolicy: {
        name: 'unless-stopped'
      },
      metadata: {
        version: '1.0.0',
        maintainer: 'GitHub RunnerHub',
        created: new Date(),
        updated: new Date(),
        tags: ['docker', 'dind', 'containers', 'deployment'],
        githubActions: {
          compatible: true,
          requiredLabels: ['self-hosted', 'linux', 'docker'],
          supportedSteps: ['run', 'docker-build', 'docker-push', 'upload-artifact']
        },
        performance: {
          startupTime: 45,
          memoryFootprint: 2048,
          cpuIntensive: true
        },
        security: {
          level: 'high',
          scanRequired: true,
          trustedBase: true
        }
      }
    });

    logger.info(`Initialized ${this.templates.size} default templates`);
  }

  /**
   * Register a new template
   */
  public registerTemplate(template: TemplateConfig): void {
    this.templates.set(template.id, template);
    logger.info(`Registered template: ${template.id} (${template.name})`);
  }

  /**
   * Get template by ID
   */
  public getTemplate(templateId: string): TemplateConfig | undefined {
    return this.templates.get(templateId);
  }

  /**
   * List all templates
   */
  public listTemplates(category?: ContainerCategory): TemplateConfig[] {
    const templates = Array.from(this.templates.values());
    return category 
      ? templates.filter(t => t.category === category)
      : templates;
  }

  /**
   * Search templates by criteria
   */
  public searchTemplates(criteria: {
    category?: ContainerCategory;
    labels?: string[];
    tags?: string[];
    securityLevel?: string;
  }): TemplateConfig[] {
    return Array.from(this.templates.values()).filter(template => {
      if (criteria.category && template.category !== criteria.category) {
        return false;
      }

      if (criteria.labels) {
        const hasRequiredLabels = criteria.labels.every(label =>
          template.metadata.githubActions.requiredLabels.includes(label)
        );
        if (!hasRequiredLabels) return false;
      }

      if (criteria.tags) {
        const hasMatchingTags = criteria.tags.some(tag =>
          template.metadata.tags.includes(tag)
        );
        if (!hasMatchingTags) return false;
      }

      if (criteria.securityLevel && template.metadata.security.level !== criteria.securityLevel) {
        return false;
      }

      return true;
    });
  }

  /**
   * Create container from template
   */
  public async createContainerFromTemplate(
    templateId: string,
    options: {
      name: string;
      environment?: Record<string, string>;
      volumes?: VolumeConfig[];
      ports?: PortConfig[];
      labels?: Record<string, string>;
      networkMode?: string;
    }
  ): Promise<string> {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    logger.info(`Creating container from template: ${templateId}`, { 
      containerName: options.name 
    });

    // Ensure image is available
    await this.ensureImageAvailable(template.image, template.tag);

    // Build Docker container options
    const containerOptions = this.buildContainerOptions(template, options);

    try {
      const containerId = await this.dockerClient.createContainer(containerOptions);
      
      logger.info(`Container created from template ${templateId}: ${containerId}`);
      return containerId;
    } catch (error) {
      logger.error(`Failed to create container from template ${templateId}:`, error);
      throw error;
    }
  }

  /**
   * Validate template configuration
   */
  public validateTemplate(template: TemplateConfig): string[] {
    const errors: string[] = [];

    // Required fields validation
    if (!template.id) errors.push('Template ID is required');
    if (!template.name) errors.push('Template name is required');
    if (!template.image) errors.push('Template image is required');
    if (!template.tag) errors.push('Template tag is required');

    // Resource validation
    if (template.resources.cpuLimit <= 0) {
      errors.push('CPU limit must be greater than 0');
    }
    if (!template.resources.memoryLimit.match(/^\d+[kmg]$/i)) {
      errors.push('Memory limit must be in format like "512m" or "2g"');
    }

    // Security validation
    if (template.securityOptions.privileged && template.metadata.security.level !== 'critical') {
      errors.push('Privileged containers must have critical security level');
    }

    // Port validation
    template.exposedPorts.forEach((port, index) => {
      if (port.containerPort < 1 || port.containerPort > 65535) {
        errors.push(`Invalid container port ${port.containerPort} at index ${index}`);
      }
    });

    // Volume validation
    template.volumes.forEach((volume, index) => {
      if (!volume.source || !volume.target) {
        errors.push(`Volume at index ${index} must have source and target`);
      }
    });

    return errors;
  }

  /**
   * Update template
   */
  public updateTemplate(templateId: string, updates: Partial<TemplateConfig>): void {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const updatedTemplate = { 
      ...template, 
      ...updates, 
      metadata: { 
        ...template.metadata, 
        ...updates.metadata,
        updated: new Date() 
      }
    };

    const errors = this.validateTemplate(updatedTemplate);
    if (errors.length > 0) {
      throw new Error(`Template validation failed: ${errors.join(', ')}`);
    }

    this.templates.set(templateId, updatedTemplate);
    logger.info(`Updated template: ${templateId}`);
  }

  /**
   * Remove template
   */
  public removeTemplate(templateId: string): boolean {
    const result = this.templates.delete(templateId);
    if (result) {
      logger.info(`Removed template: ${templateId}`);
    }
    return result;
  }

  /**
   * Build Docker container options from template
   */
  private buildContainerOptions(
    template: TemplateConfig, 
    options: any
  ): Docker.ContainerCreateOptions {
    const env = Object.entries({
      ...template.environment,
      ...options.environment
    }).map(([key, value]) => `${key}=${value}`);

    const labels = {
      ...template.labels,
      ...options.labels,
      'template.id': template.id,
      'template.version': template.metadata.version
    };

    // Build port bindings
    const exposedPorts: any = {};
    const portBindings: any = {};
    
    [...template.exposedPorts, ...(options.ports || [])].forEach(port => {
      const portSpec = `${port.containerPort}/${port.protocol}`;
      exposedPorts[portSpec] = {};
      
      if (port.hostPort) {
        portBindings[portSpec] = [{ HostPort: port.hostPort.toString() }];
      }
    });

    // Build volume mounts
    const binds: string[] = [];
    const volumes: any = {};

    [...template.volumes, ...(options.volumes || [])].forEach(volume => {
      if (volume.type === 'bind') {
        const mountSpec = volume.readonly 
          ? `${volume.source}:${volume.target}:ro`
          : `${volume.source}:${volume.target}`;
        binds.push(mountSpec);
      } else if (volume.type === 'volume') {
        volumes[volume.target] = {};
      }
    });

    return {
      Image: `${template.image}:${template.tag}`,
      name: options.name,
      Env: env,
      Labels: labels,
      WorkingDir: template.workingDir,
      User: template.user,
      Entrypoint: template.entrypoint,
      Cmd: template.cmd,
      ExposedPorts: exposedPorts,
      Volumes: volumes,
      HostConfig: {
        CpuCount: template.resources.cpuLimit,
        Memory: this.parseMemoryLimit(template.resources.memoryLimit),
        MemoryReservation: template.resources.memoryReservation 
          ? this.parseMemoryLimit(template.resources.memoryReservation) 
          : undefined,
        CpuPercent: template.resources.cpuReservation 
          ? Math.round(template.resources.cpuReservation * 100) 
          : undefined,
        PortBindings: portBindings,
        Binds: binds,
        RestartPolicy: {
          Name: template.restartPolicy.name,
          MaximumRetryCount: template.restartPolicy.maximumRetryCount || 0
        },
        Privileged: template.securityOptions.privileged,
        ReadonlyRootfs: template.securityOptions.readOnlyRootfs,
        SecurityOpt: this.buildSecurityOptions(template.securityOptions),
        NetworkMode: options.networkMode || template.networkMode || 'bridge',
        CapAdd: template.securityOptions.capabilities.add,
        CapDrop: template.securityOptions.capabilities.drop
      },
      Healthcheck: template.healthCheck ? {
        Test: template.healthCheck.test,
        Interval: template.healthCheck.interval * 1000000000, // Convert to nanoseconds
        Timeout: template.healthCheck.timeout * 1000000000,
        Retries: template.healthCheck.retries,
        StartPeriod: template.healthCheck.startPeriod 
          ? template.healthCheck.startPeriod * 1000000000 
          : undefined
      } : undefined
    };
  }

  /**
   * Parse memory limit string to bytes
   */
  private parseMemoryLimit(limit: string): number {
    const units: Record<string, number> = {
      'k': 1024,
      'm': 1024 * 1024,
      'g': 1024 * 1024 * 1024
    };

    const match = limit.toLowerCase().match(/^(\d+)([kmg])$/);
    if (!match) {
      throw new Error(`Invalid memory limit format: ${limit}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    
    return value * units[unit];
  }

  /**
   * Build security options array
   */
  private buildSecurityOptions(security: SecurityConfig): string[] {
    const options: string[] = [];

    if (security.seccompProfile) {
      options.push(`seccomp=${security.seccompProfile}`);
    }

    if (security.apparmorProfile) {
      options.push(`apparmor=${security.apparmorProfile}`);
    }

    if (security.noNewPrivileges) {
      options.push('no-new-privileges');
    }

    return options;
  }

  /**
   * Ensure image is available locally
   */
  private async ensureImageAvailable(image: string, tag: string): Promise<void> {
    try {
      const images = await this.dockerClient.listImages();
      const fullImageName = `${image}:${tag}`;
      
      const imageExists = images.some(img => 
        img.repository === image && img.tag === tag
      );

      if (!imageExists) {
        logger.info(`Pulling image: ${fullImageName}`);
        await this.dockerClient.pullImage(image, tag);
      }
    } catch (error) {
      logger.error(`Failed to ensure image availability: ${image}:${tag}`, error);
      throw error;
    }
  }

  /**
   * Get template statistics
   */
  public getTemplateStatistics(): any {
    const templates = Array.from(this.templates.values());
    
    const stats = {
      total: templates.length,
      byCategory: {} as Record<string, number>,
      bySecurityLevel: {} as Record<string, number>,
      averageStartupTime: 0,
      averageMemoryFootprint: 0
    };

    templates.forEach(template => {
      // Count by category
      stats.byCategory[template.category] = (stats.byCategory[template.category] || 0) + 1;
      
      // Count by security level
      const secLevel = template.metadata.security.level;
      stats.bySecurityLevel[secLevel] = (stats.bySecurityLevel[secLevel] || 0) + 1;
    });

    // Calculate averages
    if (templates.length > 0) {
      stats.averageStartupTime = Math.round(
        templates.reduce((sum, t) => sum + t.metadata.performance.startupTime, 0) / templates.length
      );
      
      stats.averageMemoryFootprint = Math.round(
        templates.reduce((sum, t) => sum + t.metadata.performance.memoryFootprint, 0) / templates.length
      );
    }

    return stats;
  }

  /**
   * Export template configuration
   */
  public exportTemplate(templateId: string): TemplateConfig | null {
    const template = this.getTemplate(templateId);
    if (!template) {
      return null;
    }

    return JSON.parse(JSON.stringify(template));
  }

  /**
   * Import template configuration
   */
  public importTemplate(templateConfig: TemplateConfig): void {
    const errors = this.validateTemplate(templateConfig);
    if (errors.length > 0) {
      throw new Error(`Template validation failed: ${errors.join(', ')}`);
    }

    templateConfig.metadata.updated = new Date();
    this.registerTemplate(templateConfig);
  }

  /**
   * Clone template with modifications
   */
  public cloneTemplate(
    templateId: string, 
    newId: string, 
    modifications: Partial<TemplateConfig>
  ): TemplateConfig {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const clonedTemplate: TemplateConfig = {
      ...JSON.parse(JSON.stringify(template)),
      ...modifications,
      id: newId,
      metadata: {
        ...template.metadata,
        ...modifications.metadata,
        version: '1.0.0',
        created: new Date(),
        updated: new Date()
      }
    };

    const errors = this.validateTemplate(clonedTemplate);
    if (errors.length > 0) {
      throw new Error(`Cloned template validation failed: ${errors.join(', ')}`);
    }

    this.registerTemplate(clonedTemplate);
    return clonedTemplate;
  }

  /**
   * Get template recommendations based on job requirements
   */
  public getRecommendedTemplates(requirements: {
    labels?: string[];
    environment?: Record<string, string>;
    resourceRequirements?: {
      minCpu?: number;
      minMemory?: string;
      minDisk?: string;
    };
    performance?: {
      maxStartupTime?: number;
      maxMemoryFootprint?: number;
    };
  }): TemplateConfig[] {
    const templates = Array.from(this.templates.values());
    const recommendations: Array<{ template: TemplateConfig; score: number }> = [];

    templates.forEach(template => {
      let score = 0;

      // Label matching score
      if (requirements.labels) {
        const matchingLabels = requirements.labels.filter(label =>
          template.metadata.githubActions.requiredLabels.includes(label)
        ).length;
        score += (matchingLabels / requirements.labels.length) * 40;
      }

      // Resource requirements score
      if (requirements.resourceRequirements) {
        const { minCpu, minMemory, minDisk } = requirements.resourceRequirements;
        
        if (minCpu && template.resources.cpuLimit >= minCpu) score += 15;
        if (minMemory && this.compareMemory(template.resources.memoryLimit, minMemory) >= 0) score += 15;
        if (minDisk && template.resources.diskQuota && this.compareMemory(template.resources.diskQuota, minDisk) >= 0) score += 10;
      }

      // Performance score
      if (requirements.performance) {
        const { maxStartupTime, maxMemoryFootprint } = requirements.performance;
        
        if (maxStartupTime && template.metadata.performance.startupTime <= maxStartupTime) score += 10;
        if (maxMemoryFootprint && template.metadata.performance.memoryFootprint <= maxMemoryFootprint) score += 10;
      }

      recommendations.push({ template, score });
    });

    return recommendations
      .sort((a, b) => b.score - a.score)
      .map(r => r.template)
      .slice(0, 5); // Top 5 recommendations
  }

  /**
   * Compare memory sizes (e.g., "2g" vs "1024m")
   */
  private compareMemory(size1: string, size2: string): number {
    try {
      const bytes1 = this.parseMemoryLimit(size1);
      const bytes2 = this.parseMemoryLimit(size2);
      return bytes1 - bytes2;
    } catch {
      return 0;
    }
  }

  /**
   * Cleanup unused templates
   */
  public async cleanupUnusedTemplates(unusedThresholdDays = 30): Promise<string[]> {
    const removedTemplates: string[] = [];
    const cutoffDate = new Date(Date.now() - (unusedThresholdDays * 24 * 60 * 60 * 1000));

    for (const [templateId, template] of this.templates.entries()) {
      // Don't remove default templates
      if (['ubuntu-runner', 'nodejs-runner', 'python-runner', 'docker-dind'].includes(templateId)) {
        continue;
      }

      // Remove if not updated recently
      if (template.metadata.updated < cutoffDate) {
        this.removeTemplate(templateId);
        removedTemplates.push(templateId);
      }
    }

    logger.info(`Cleaned up ${removedTemplates.length} unused templates`);
    return removedTemplates;
  }

  /**
   * Create template from existing container
   */
  public async createTemplateFromContainer(
    containerId: string,
    templateConfig: {
      id: string;
      name: string;
      description: string;
      category: ContainerCategory;
      maintainer?: string;
      tags?: string[];
    }
  ): Promise<TemplateConfig> {
    try {
      const containerInfo = await this.dockerClient.getContainerInfo(containerId);
      
      const template: TemplateConfig = {
        id: templateConfig.id,
        name: templateConfig.name,
        description: templateConfig.description,
        image: containerInfo.image.split(':')[0] || containerInfo.image,
        tag: containerInfo.image.split(':')[1] || 'latest',
        category: templateConfig.category,
        labels: containerInfo.labels,
        environment: containerInfo.environment.reduce((env, envVar) => {
          const [key, value] = envVar.split('=');
          env[key] = value || '';
          return env;
        }, {} as Record<string, string>),
        exposedPorts: containerInfo.ports.map(port => ({
          containerPort: port.containerPort,
          protocol: port.protocol,
          expose: !!port.hostPort,
          hostPort: port.hostPort
        })),
        volumes: containerInfo.mounts.map(mount => ({
          source: mount.source,
          target: mount.destination,
          type: mount.type,
          readonly: mount.mode === 'ro'
        })),
        resources: {
          cpuLimit: 2,
          memoryLimit: '4g',
          diskQuota: '20g'
        },
        securityOptions: {
          privileged: false,
          readOnlyRootfs: false,
          noNewPrivileges: true,
          capabilities: {
            add: [],
            drop: ['ALL']
          }
        },
        restartPolicy: {
          name: 'on-failure',
          maximumRetryCount: 3
        },
        metadata: {
          version: '1.0.0',
          maintainer: templateConfig.maintainer || 'GitHub RunnerHub',
          created: new Date(),
          updated: new Date(),
          tags: templateConfig.tags || [],
          githubActions: {
            compatible: true,
            requiredLabels: ['self-hosted', 'linux'],
            supportedSteps: ['run', 'checkout', 'cache']
          },
          performance: {
            startupTime: 30,
            memoryFootprint: 1024,
            cpuIntensive: false
          },
          security: {
            level: 'medium',
            scanRequired: true,
            trustedBase: false
          }
        }
      };

      const errors = this.validateTemplate(template);
      if (errors.length > 0) {
        throw new Error(`Generated template validation failed: ${errors.join(', ')}`);
      }

      this.registerTemplate(template);
      logger.info(`Created template from container ${containerId}: ${template.id}`);
      
      return template;
    } catch (error) {
      logger.error(`Failed to create template from container ${containerId}:`, error);
      throw error;
    }
  }
}

export default ContainerTemplateManager;