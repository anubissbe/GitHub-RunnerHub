import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { createLogger } from '../utils/logger';
import { RunnerStatus } from '../types';

const logger = createLogger('ProxyRunnerService');

export interface ProxyRunnerConfig {
  name: string;
  url: string;
  token: string;
  labels: string[];
  orchestratorUrl: string;
  runnerPath: string;
  hooksPath: string;
}

export class ProxyRunner {
  private config: ProxyRunnerConfig;
  private runnerProcess: ChildProcess | null = null;
  private isRunning: boolean = false;
  private restartCount: number = 0;
  private maxRestarts: number = 5;

  constructor(config: ProxyRunnerConfig) {
    this.config = config;
  }

  /**
   * Configure the GitHub Actions runner with proxy hooks
   */
  async configure(): Promise<void> {
    logger.info('Configuring proxy runner', { name: this.config.name });

    try {
      // Ensure hooks directory exists
      await fs.mkdir(path.dirname(this.config.hooksPath), { recursive: true });

      // Copy hook scripts
      const hooksDir = path.join(__dirname, '../../hooks');
      const hookFiles = ['job-started.sh', 'job-completed.sh'];
      
      for (const hookFile of hookFiles) {
        const source = path.join(hooksDir, hookFile);
        const dest = path.join(this.config.hooksPath, hookFile);
        await fs.copyFile(source, dest);
        await fs.chmod(dest, 0o755);
      }

      // Set environment variables for hooks
      const env = {
        ...process.env,
        ACTIONS_RUNNER_HOOK_JOB_STARTED: path.join(this.config.hooksPath, 'job-started.sh'),
        ACTIONS_RUNNER_HOOK_JOB_COMPLETED: path.join(this.config.hooksPath, 'job-completed.sh'),
        ORCHESTRATOR_URL: this.config.orchestratorUrl,
        RUNNER_TOKEN: this.config.token,
        RUNNER_LABELS: this.config.labels.join(','),
        RUNNER_NAME: this.config.name
      };

      // Configure runner
      const configArgs = [
        '--url', this.config.url,
        '--token', this.config.token,
        '--name', this.config.name,
        '--labels', this.config.labels.join(','),
        '--work', '_work',
        '--unattended',
        '--replace'
      ];

      await this.executeCommand('./config.sh', configArgs, env);
      logger.info('Proxy runner configured successfully', { name: this.config.name });
    } catch (error) {
      logger.error('Failed to configure proxy runner', { name: this.config.name, error });
      throw error;
    }
  }

  /**
   * Start the proxy runner
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Proxy runner already running', { name: this.config.name });
      return;
    }

    logger.info('Starting proxy runner', { name: this.config.name });

    try {
      // Set up environment
      const env = {
        ...process.env,
        ACTIONS_RUNNER_HOOK_JOB_STARTED: path.join(this.config.hooksPath, 'job-started.sh'),
        ACTIONS_RUNNER_HOOK_JOB_COMPLETED: path.join(this.config.hooksPath, 'job-completed.sh'),
        ORCHESTRATOR_URL: this.config.orchestratorUrl,
        RUNNER_TOKEN: this.config.token,
        RUNNER_LABELS: this.config.labels.join(','),
        RUNNER_NAME: this.config.name
      };

      // Start runner process
      this.runnerProcess = spawn('./run.sh', [], {
        cwd: this.config.runnerPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.isRunning = true;

      // Handle stdout
      this.runnerProcess.stdout?.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          logger.debug(`[${this.config.name}] ${message}`);
        }
      });

      // Handle stderr
      this.runnerProcess.stderr?.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          logger.error(`[${this.config.name}] ${message}`);
        }
      });

      // Handle process exit
      this.runnerProcess.on('exit', (code, signal) => {
        this.isRunning = false;
        logger.info(`Proxy runner exited`, { 
          name: this.config.name, 
          code, 
          signal 
        });

        // Handle special exit codes
        if (code === 78) {
          // Job was delegated successfully
          logger.debug('Job delegated successfully');
        } else if (code !== 0 && this.restartCount < this.maxRestarts) {
          // Unexpected exit, attempt restart
          this.restartCount++;
          logger.warn('Restarting proxy runner', { 
            name: this.config.name, 
            attempt: this.restartCount 
          });
          setTimeout(() => this.start(), 5000);
        }
      });

      // Handle process errors
      this.runnerProcess.on('error', (error) => {
        logger.error('Proxy runner process error', { 
          name: this.config.name, 
          error 
        });
      });

      logger.info('Proxy runner started successfully', { name: this.config.name });
    } catch (error) {
      logger.error('Failed to start proxy runner', { name: this.config.name, error });
      throw error;
    }
  }

  /**
   * Stop the proxy runner
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.runnerProcess) {
      logger.warn('Proxy runner not running', { name: this.config.name });
      return;
    }

    logger.info('Stopping proxy runner', { name: this.config.name });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Force killing proxy runner', { name: this.config.name });
        this.runnerProcess?.kill('SIGKILL');
        resolve();
      }, 30000);

      this.runnerProcess?.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.runnerProcess?.kill('SIGTERM');
    });
  }

  /**
   * Remove the runner configuration
   */
  async remove(): Promise<void> {
    logger.info('Removing proxy runner', { name: this.config.name });

    try {
      await this.executeCommand('./config.sh', ['remove', '--token', this.config.token]);
      logger.info('Proxy runner removed successfully', { name: this.config.name });
    } catch (error) {
      logger.error('Failed to remove proxy runner', { name: this.config.name, error });
      throw error;
    }
  }

  /**
   * Get runner status
   */
  getStatus(): RunnerStatus {
    if (this.isRunning) {
      return RunnerStatus.IDLE; // Proxy runners are always idle since they delegate
    }
    return RunnerStatus.OFFLINE;
  }

  /**
   * Execute a command
   */
  private executeCommand(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd: this.config.runnerPath,
        env: env || process.env,
        stdio: 'pipe'
      });

      let _stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        _stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }
}

/**
 * Proxy Runner Manager - Manages multiple proxy runners
 */
export class ProxyRunnerManager {
  private runners: Map<string, ProxyRunner> = new Map();

  /**
   * Create and start a new proxy runner
   */
  async createRunner(config: ProxyRunnerConfig): Promise<void> {
    if (this.runners.has(config.name)) {
      throw new Error(`Runner ${config.name} already exists`);
    }

    const runner = new ProxyRunner(config);
    await runner.configure();
    await runner.start();
    
    this.runners.set(config.name, runner);
    logger.info('Created proxy runner', { name: config.name });
  }

  /**
   * Stop and remove a proxy runner
   */
  async removeRunner(name: string): Promise<void> {
    const runner = this.runners.get(name);
    if (!runner) {
      throw new Error(`Runner ${name} not found`);
    }

    await runner.stop();
    await runner.remove();
    this.runners.delete(name);
    
    logger.info('Removed proxy runner', { name });
  }

  /**
   * Get all runners
   */
  getRunners(): Map<string, ProxyRunner> {
    return this.runners;
  }

  /**
   * Stop all runners
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.runners.values()).map(runner => runner.stop());
    await Promise.all(promises);
  }
}

export default new ProxyRunnerManager();