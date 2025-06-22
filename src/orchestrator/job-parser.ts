import { createLogger } from '../utils/logger';
import * as yaml from 'js-yaml';

const logger = createLogger('JobParser');

export interface ParsedJob {
  id: string;
  name: string;
  runs_on: string | string[];
  container?: ContainerConfig;
  services?: Record<string, ServiceConfig>;
  steps: StepConfig[];
  env?: Record<string, string>;
  defaults?: {
    run?: {
      shell?: string;
      working_directory?: string;
    };
  };
  timeout_minutes?: number;
  continue_on_error?: boolean;
  strategy?: StrategyConfig;
  needs?: string | string[];
  outputs?: Record<string, string>;
  secrets?: Record<string, string>;
  if?: string;
}

export interface ContainerConfig {
  image: string;
  credentials?: {
    username: string;
    password: string;
  };
  env?: Record<string, string>;
  ports?: number[];
  volumes?: string[];
  options?: string;
}

export interface ServiceConfig {
  image: string;
  credentials?: {
    username: string;
    password: string;
  };
  env?: Record<string, string>;
  ports?: number[];
  volumes?: string[];
  options?: string;
}

export interface StepConfig {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, any>;
  env?: Record<string, string>;
  continue_on_error?: boolean;
  timeout_minutes?: number;
  if?: string;
  shell?: string;
  working_directory?: string;
}

export interface StrategyConfig {
  matrix?: Record<string, any[]>;
  fail_fast?: boolean;
  max_parallel?: number;
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export class JobParser {
  private static instance: JobParser;
  
  private constructor() {}
  
  public static getInstance(): JobParser {
    if (!JobParser.instance) {
      JobParser.instance = new JobParser();
    }
    return JobParser.instance;
  }
  
  /**
   * Parse GitHub Actions job configuration
   */
  public parseJob(jobData: any): ParsedJob {
    logger.debug('Parsing job configuration', { jobId: jobData.id });
    
    const parsed: ParsedJob = {
      id: jobData.id?.toString() || '',
      name: jobData.name || '',
      runs_on: this.parseRunsOn(jobData.labels || jobData.runs_on),
      steps: this.parseSteps(jobData.steps || []),
      env: jobData.env || {},
      timeout_minutes: jobData.timeout_minutes || 360, // 6 hours default
      continue_on_error: jobData.continue_on_error || false,
      needs: jobData.needs,
      outputs: jobData.outputs || {},
      if: jobData.if
    };
    
    // Parse container configuration
    if (jobData.container) {
      parsed.container = this.parseContainer(jobData.container);
    }
    
    // Parse services
    if (jobData.services) {
      parsed.services = this.parseServices(jobData.services);
    }
    
    // Parse strategy (matrix builds)
    if (jobData.strategy) {
      parsed.strategy = this.parseStrategy(jobData.strategy);
    }
    
    // Parse defaults
    if (jobData.defaults) {
      parsed.defaults = jobData.defaults;
    }
    
    // Parse secrets (from workflow_job webhook)
    if (jobData.secrets) {
      parsed.secrets = jobData.secrets;
    }
    
    return parsed;
  }
  
  private parseRunsOn(runsOn: any): string | string[] {
    if (typeof runsOn === 'string') {
      return runsOn;
    }
    
    if (Array.isArray(runsOn)) {
      return runsOn;
    }
    
    // Default to self-hosted
    return ['self-hosted', 'linux', 'x64'];
  }
  
  private parseContainer(container: any): ContainerConfig {
    if (typeof container === 'string') {
      return { image: container };
    }
    
    return {
      image: container.image,
      credentials: container.credentials,
      env: container.env || {},
      ports: container.ports || [],
      volumes: container.volumes || [],
      options: container.options
    };
  }
  
  private parseServices(services: any): Record<string, ServiceConfig> {
    const parsed: Record<string, ServiceConfig> = {};
    
    for (const [name, service] of Object.entries(services)) {
      if (typeof service === 'string') {
        parsed[name] = { image: service };
      } else if (typeof service === 'object' && service !== null) {
        parsed[name] = {
          image: (service as any).image,
          credentials: (service as any).credentials,
          env: (service as any).env || {},
          ports: (service as any).ports || [],
          volumes: (service as any).volumes || [],
          options: (service as any).options
        };
      }
    }
    
    return parsed;
  }
  
  private parseSteps(steps: any[]): StepConfig[] {
    return steps.map((step, index) => ({
      id: step.id || `step-${index}`,
      name: step.name || `Step ${index + 1}`,
      uses: step.uses,
      run: step.run,
      with: step.with || {},
      env: step.env || {},
      continue_on_error: step.continue_on_error || false,
      timeout_minutes: step.timeout_minutes,
      if: step.if,
      shell: step.shell,
      working_directory: step.working_directory
    }));
  }
  
  private parseStrategy(strategy: any): StrategyConfig {
    return {
      matrix: strategy.matrix,
      fail_fast: strategy.fail_fast !== false, // Default true
      max_parallel: strategy.max_parallel
    };
  }
  
  /**
   * Validate parsed job configuration
   */
  public validateJob(job: ParsedJob): ValidationError[] {
    const errors: ValidationError[] = [];
    
    // Validate required fields
    if (!job.id) {
      errors.push({
        field: 'id',
        message: 'Job ID is required',
        severity: 'error'
      });
    }
    
    if (!job.name) {
      errors.push({
        field: 'name',
        message: 'Job name is required',
        severity: 'error'
      });
    }
    
    if (!job.runs_on || (Array.isArray(job.runs_on) && job.runs_on.length === 0)) {
      errors.push({
        field: 'runs_on',
        message: 'Job must specify runs-on labels',
        severity: 'error'
      });
    }
    
    if (!job.steps || job.steps.length === 0) {
      errors.push({
        field: 'steps',
        message: 'Job must have at least one step',
        severity: 'error'
      });
    }
    
    // Validate container configuration
    if (job.container) {
      const containerErrors = this.validateContainer(job.container);
      errors.push(...containerErrors.map(err => ({
        ...err,
        field: `container.${err.field}`
      })));
    }
    
    // Validate services
    if (job.services) {
      for (const [name, service] of Object.entries(job.services)) {
        const serviceErrors = this.validateService(service);
        errors.push(...serviceErrors.map(err => ({
          ...err,
          field: `services.${name}.${err.field}`
        })));
      }
    }
    
    // Validate steps
    job.steps.forEach((step, index) => {
      const stepErrors = this.validateStep(step);
      errors.push(...stepErrors.map(err => ({
        ...err,
        field: `steps[${index}].${err.field}`
      })));
    });
    
    // Validate strategy
    if (job.strategy) {
      const strategyErrors = this.validateStrategy(job.strategy);
      errors.push(...strategyErrors.map(err => ({
        ...err,
        field: `strategy.${err.field}`
      })));
    }
    
    // Validate timeout
    if (job.timeout_minutes && (job.timeout_minutes < 1 || job.timeout_minutes > 360)) {
      errors.push({
        field: 'timeout_minutes',
        message: 'Timeout must be between 1 and 360 minutes',
        severity: 'warning'
      });
    }
    
    return errors;
  }
  
  private validateContainer(container: ContainerConfig): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (!container.image) {
      errors.push({
        field: 'image',
        message: 'Container image is required',
        severity: 'error'
      });
    } else if (!this.isValidImageName(container.image)) {
      errors.push({
        field: 'image',
        message: 'Invalid container image name',
        severity: 'error'
      });
    }
    
    if (container.credentials) {
      if (!container.credentials.username || !container.credentials.password) {
        errors.push({
          field: 'credentials',
          message: 'Both username and password are required for credentials',
          severity: 'error'
        });
      }
    }
    
    return errors;
  }
  
  private validateService(service: ServiceConfig): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (!service.image) {
      errors.push({
        field: 'image',
        message: 'Service image is required',
        severity: 'error'
      });
    } else if (!this.isValidImageName(service.image)) {
      errors.push({
        field: 'image',
        message: 'Invalid service image name',
        severity: 'error'
      });
    }
    
    return errors;
  }
  
  private validateStep(step: StepConfig): ValidationError[] {
    const errors: ValidationError[] = [];
    
    // Must have either 'uses' or 'run'
    if (!step.uses && !step.run) {
      errors.push({
        field: 'uses/run',
        message: 'Step must have either "uses" or "run" property',
        severity: 'error'
      });
    }
    
    // Cannot have both 'uses' and 'run'
    if (step.uses && step.run) {
      errors.push({
        field: 'uses/run',
        message: 'Step cannot have both "uses" and "run" properties',
        severity: 'error'
      });
    }
    
    // Validate action reference
    if (step.uses && !this.isValidActionReference(step.uses)) {
      errors.push({
        field: 'uses',
        message: 'Invalid action reference format',
        severity: 'error'
      });
    }
    
    // Validate shell
    if (step.shell && !this.isValidShell(step.shell)) {
      errors.push({
        field: 'shell',
        message: 'Invalid shell specified',
        severity: 'warning'
      });
    }
    
    return errors;
  }
  
  private validateStrategy(strategy: StrategyConfig): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (strategy.matrix) {
      // Validate matrix has at least one dimension
      if (Object.keys(strategy.matrix).length === 0) {
        errors.push({
          field: 'matrix',
          message: 'Matrix must have at least one dimension',
          severity: 'error'
        });
      }
      
      // Validate each matrix dimension has values
      for (const [key, values] of Object.entries(strategy.matrix)) {
        if (!Array.isArray(values) || values.length === 0) {
          errors.push({
            field: `matrix.${key}`,
            message: 'Matrix dimension must be a non-empty array',
            severity: 'error'
          });
        }
      }
    }
    
    if (strategy.max_parallel && strategy.max_parallel < 1) {
      errors.push({
        field: 'max_parallel',
        message: 'Max parallel must be at least 1',
        severity: 'warning'
      });
    }
    
    return errors;
  }
  
  private isValidImageName(image: string): boolean {
    // Basic validation for Docker image names
    const imageRegex = /^[a-z0-9]+([\-._/][a-z0-9]+)*(:[a-z0-9]+([\-._][a-z0-9]+)*)?(@sha256:[a-f0-9]{64})?$/i;
    return imageRegex.test(image);
  }
  
  private isValidActionReference(action: string): boolean {
    // Validate GitHub Action reference format
    // Examples: actions/checkout@v3, owner/repo@ref, ./path/to/action
    const actionRegex = /^([a-z0-9\-]+\/[a-z0-9\-._]+@[a-z0-9\-._]+|\.\/[a-z0-9\-._/]+)$/i;
    return actionRegex.test(action);
  }
  
  private isValidShell(shell: string): boolean {
    const validShells = ['bash', 'sh', 'cmd', 'powershell', 'pwsh', 'python'];
    return validShells.includes(shell.toLowerCase());
  }
  
  /**
   * Check if job can run on this orchestrator
   */
  public canRunJob(job: ParsedJob): boolean {
    const supportedLabels = ['self-hosted', 'linux', 'x64', 'docker'];
    
    if (typeof job.runs_on === 'string') {
      return supportedLabels.includes(job.runs_on.toLowerCase());
    }
    
    if (Array.isArray(job.runs_on)) {
      // Check if we match all required labels
      const requiredLabels = job.runs_on.map(label => label.toLowerCase());
      
      // Must include 'self-hosted' to run on our orchestrator
      if (!requiredLabels.includes('self-hosted')) {
        return false;
      }
      
      // Check OS compatibility
      if (requiredLabels.includes('windows') || requiredLabels.includes('macos')) {
        return false; // We only support Linux
      }
      
      return true;
    }
    
    return false;
  }
  
  /**
   * Transform parsed job for execution
   */
  public transformForExecution(job: ParsedJob): any {
    return {
      id: job.id,
      name: job.name,
      container: job.container || { image: 'ubuntu:latest' },
      services: job.services || {},
      steps: this.transformSteps(job.steps),
      env: {
        ...job.env,
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        GITHUB_JOB: job.name,
        RUNNER_OS: 'Linux',
        RUNNER_ARCH: 'X64'
      },
      timeout: job.timeout_minutes * 60 * 1000, // Convert to milliseconds
      continueOnError: job.continue_on_error,
      shell: job.defaults?.run?.shell || 'bash',
      workingDirectory: job.defaults?.run?.working_directory || '/github/workspace'
    };
  }
  
  private transformSteps(steps: StepConfig[]): any[] {
    return steps.map(step => ({
      id: step.id,
      name: step.name,
      type: step.uses ? 'action' : 'run',
      action: step.uses,
      script: step.run,
      inputs: step.with,
      env: step.env,
      continueOnError: step.continue_on_error,
      timeout: step.timeout_minutes ? step.timeout_minutes * 60 * 1000 : undefined,
      condition: step.if,
      shell: step.shell,
      workingDirectory: step.working_directory
    }));
  }
}

export default JobParser;