import Docker from 'dockerode';
import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';

const logger = createLogger('DockerClient');

export interface DockerClientConfig {
  socketPath?: string;
  host?: string;
  port?: number;
  protocol?: 'http' | 'https';
  timeout?: number;
  version?: string;
  ca?: string;
  cert?: string;
  key?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: Date;
  started?: Date;
  finished?: Date;
  ports: PortMapping[];
  mounts: VolumeMount[];
  networks: NetworkInfo[];
  labels: Record<string, string>;
  environment: string[];
}

export interface PortMapping {
  containerPort: number;
  hostPort?: number;
  protocol: 'tcp' | 'udp';
  hostIP?: string;
}

export interface VolumeMount {
  source: string;
  destination: string;
  mode: 'ro' | 'rw';
  type: 'bind' | 'volume' | 'tmpfs';
}

export interface NetworkInfo {
  name: string;
  id: string;
  ipAddress?: string;
  gateway?: string;
  macAddress?: string;
}

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  digest?: string;
  size: number;
  created: Date;
  labels: Record<string, string>;
}

export interface ContainerStats {
  cpuUsage: number; // Percentage 0-100
  memoryUsage: number; // Bytes
  memoryLimit: number; // Bytes
  memoryPercentage: number; // Percentage 0-100
  networkRx: number; // Bytes
  networkTx: number; // Bytes
  blockRead: number; // Bytes
  blockWrite: number; // Bytes
  timestamp: Date;
}

export interface ContainerLogs {
  stdout: string[];
  stderr: string[];
  timestamp: Date;
}

export class DockerClient extends EventEmitter {
  private static instance: DockerClient;
  private docker: Docker;
  private config: DockerClientConfig;
  private isConnected = false;
  private connectionRetries = 0;
  private maxRetries = 5;
  private retryDelay = 1000;

  private constructor(config: DockerClientConfig = {}) {
    super();
    this.config = {
      socketPath: '/var/run/docker.sock',
      timeout: 30000,
      version: 'v1.41',
      ...config
    };

    this.docker = new Docker(this.config);
  }

  public static getInstance(config?: DockerClientConfig): DockerClient {
    if (!DockerClient.instance) {
      DockerClient.instance = new DockerClient(config);
    }
    return DockerClient.instance;
  }

  /**
   * Initialize and test Docker connection
   */
  public async initialize(): Promise<void> {
    logger.info('Initializing Docker client');

    try {
      await this.testConnection();
      this.isConnected = true;
      this.connectionRetries = 0;
      
      logger.info('Docker client initialized successfully');
      this.emit('connected');
    } catch (error) {
      this.isConnected = false;
      logger.error('Failed to initialize Docker client:', error);
      
      if (this.connectionRetries < this.maxRetries) {
        this.connectionRetries++;
        logger.info(`Retrying connection in ${this.retryDelay}ms (attempt ${this.connectionRetries}/${this.maxRetries})`);
        
        setTimeout(() => {
          this.initialize();
        }, this.retryDelay * this.connectionRetries);
      } else {
        this.emit('connection:failed', error);
        throw error;
      }
    }
  }

  /**
   * Test Docker daemon connection
   */
  private async testConnection(): Promise<void> {
    const info = await this.docker.info();
    logger.debug('Docker daemon info:', {
      version: info.ServerVersion,
      containers: info.Containers,
      images: info.Images,
      architecture: info.Architecture
    });
  }

  /**
   * Create a new container
   */
  public async createContainer(options: Docker.ContainerCreateOptions): Promise<string> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      logger.info('Creating container:', { 
        image: options.Image, 
        name: options.name 
      });

      const container = await this.docker.createContainer(options);
      const containerId = container.id;

      logger.info(`Container created successfully: ${containerId}`);
      this.emit('container:created', { id: containerId, options });

      return containerId;
    } catch (error) {
      logger.error('Failed to create container:', error);
      this.emit('container:create:failed', { options, error });
      throw error;
    }
  }

  /**
   * Start a container
   */
  public async startContainer(containerId: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      logger.info(`Starting container: ${containerId}`);

      const container = this.docker.getContainer(containerId);
      await container.start();

      logger.info(`Container started successfully: ${containerId}`);
      this.emit('container:started', { id: containerId });
    } catch (error) {
      logger.error(`Failed to start container ${containerId}:`, error);
      this.emit('container:start:failed', { id: containerId, error });
      throw error;
    }
  }

  /**
   * Stop a container
   */
  public async stopContainer(containerId: string, timeout = 10): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      logger.info(`Stopping container: ${containerId}`);

      const container = this.docker.getContainer(containerId);
      await container.stop({ t: timeout });

      logger.info(`Container stopped successfully: ${containerId}`);
      this.emit('container:stopped', { id: containerId });
    } catch (error) {
      logger.error(`Failed to stop container ${containerId}:`, error);
      this.emit('container:stop:failed', { id: containerId, error });
      throw error;
    }
  }

  /**
   * Remove a container
   */
  public async removeContainer(containerId: string, force = false): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      logger.info(`Removing container: ${containerId}`);

      const container = this.docker.getContainer(containerId);
      await container.remove({ force });

      logger.info(`Container removed successfully: ${containerId}`);
      this.emit('container:removed', { id: containerId });
    } catch (error) {
      logger.error(`Failed to remove container ${containerId}:`, error);
      this.emit('container:remove:failed', { id: containerId, error });
      throw error;
    }
  }

  /**
   * Get container information
   */
  public async getContainerInfo(containerId: string): Promise<ContainerInfo> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      const container = this.docker.getContainer(containerId);
      const inspect = await container.inspect();

      return this.parseContainerInfo(inspect);
    } catch (error) {
      logger.error(`Failed to get container info ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * List containers
   */
  public async listContainers(all = true): Promise<ContainerInfo[]> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      const containers = await this.docker.listContainers({ all });
      const containerInfos: ContainerInfo[] = [];

      for (const containerData of containers) {
        try {
          const container = this.docker.getContainer(containerData.Id);
          const inspect = await container.inspect();
          containerInfos.push(this.parseContainerInfo(inspect));
        } catch (error) {
          logger.warn(`Failed to inspect container ${containerData.Id}:`, error);
        }
      }

      return containerInfos;
    } catch (error) {
      logger.error('Failed to list containers:', error);
      throw error;
    }
  }

  /**
   * Get container statistics
   */
  public async getContainerStats(containerId: string): Promise<ContainerStats> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });

      return this.parseContainerStats(stats);
    } catch (error) {
      logger.error(`Failed to get container stats ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Get container logs
   */
  public async getContainerLogs(
    containerId: string, 
    options: { tail?: number; since?: number; follow?: boolean } = {}
  ): Promise<ContainerLogs> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      const container = this.docker.getContainer(containerId);
      const logOptions: Docker.ContainerLogsOptions = {
        stdout: true,
        stderr: true,
        tail: options.tail || 100,
        since: options.since || 0,
        follow: options.follow || false
      };

      const logOptionsWithFollow: Docker.ContainerLogsOptions & { follow: false } = { 
        ...logOptions, 
        follow: false 
      };
      const result = await container.logs(logOptionsWithFollow);
      
      // Handle different return types based on options
      if (result instanceof Buffer) {
        return this.parseContainerLogs(result);
      } else {
        // Handle stream case
        const stream = result as unknown as NodeJS.ReadableStream;
        const chunks: Buffer[] = [];
        return new Promise((resolve, reject) => {
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            const logs = Buffer.concat(chunks);
            resolve(this.parseContainerLogs(logs));
          });
          stream.on('error', reject);
        });
      }
    } catch (error) {
      logger.error(`Failed to get container logs ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Execute command in container
   */
  public async execInContainer(
    containerId: string, 
    command: string[], 
    options: { 
      workingDir?: string; 
      user?: string; 
      env?: string[]; 
      attachStdout?: boolean;
      attachStderr?: boolean;
    } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      const container = this.docker.getContainer(containerId);
      
      const exec = await container.exec({
        Cmd: command,
        AttachStdout: options.attachStdout ?? true,
        AttachStderr: options.attachStderr ?? true,
        WorkingDir: options.workingDir,
        User: options.user,
        Env: options.env
      });

      const stream = await exec.start({ Detach: false });
      
      return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        stream.on('data', (chunk: Buffer) => {
          const output = chunk.toString();
          // Docker stream format: first byte indicates stdout(1) or stderr(2)
          if (chunk[0] === 1) {
            stdout += output.slice(8); // Remove header
          } else if (chunk[0] === 2) {
            stderr += output.slice(8); // Remove header
          }
        });

        stream.on('end', async () => {
          try {
            const inspect = await exec.inspect();
            resolve({
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              exitCode: inspect.ExitCode || 0
            });
          } catch (error) {
            reject(error);
          }
        });

        stream.on('error', reject);
      });
    } catch (error) {
      logger.error(`Failed to execute command in container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Pull image
   */
  public async pullImage(imageName: string, tag = 'latest'): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      const fullImageName = `${imageName}:${tag}`;
      logger.info(`Pulling image: ${fullImageName}`);

      await new Promise((resolve, reject) => {
        this.docker.pull(fullImageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(err);
            return;
          }

          this.docker.modem.followProgress(stream, (err: Error | null, res: unknown[]) => {
            if (err) {
              reject(err);
            } else {
              resolve(res);
            }
          }, (event: Record<string, unknown>) => {
            logger.debug('Pull progress:', event);
            this.emit('image:pull:progress', { image: fullImageName, event });
          });
        });
      });

      logger.info(`Image pulled successfully: ${fullImageName}`);
      this.emit('image:pulled', { image: fullImageName });
    } catch (error) {
      logger.error(`Failed to pull image ${imageName}:${tag}:`, error);
      this.emit('image:pull:failed', { image: `${imageName}:${tag}`, error });
      throw error;
    }
  }

  /**
   * List images
   */
  public async listImages(): Promise<ImageInfo[]> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      const images = await this.docker.listImages();
      return images.map(this.parseImageInfo);
    } catch (error) {
      logger.error('Failed to list images:', error);
      throw error;
    }
  }

  /**
   * Remove image
   */
  public async removeImage(imageId: string, force = false): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      logger.info(`Removing image: ${imageId}`);

      const image = this.docker.getImage(imageId);
      await image.remove({ force });

      logger.info(`Image removed successfully: ${imageId}`);
      this.emit('image:removed', { id: imageId });
    } catch (error) {
      logger.error(`Failed to remove image ${imageId}:`, error);
      this.emit('image:remove:failed', { id: imageId, error });
      throw error;
    }
  }

  /**
   * Create network
   */
  public async createNetwork(options: Docker.NetworkCreateOptions): Promise<string> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      logger.info('Creating network:', options.Name);

      const network = await this.docker.createNetwork(options);
      const networkId = network.id;

      logger.info(`Network created successfully: ${networkId}`);
      this.emit('network:created', { id: networkId, options });

      return networkId;
    } catch (error) {
      logger.error('Failed to create network:', error);
      this.emit('network:create:failed', { options, error });
      throw error;
    }
  }

  /**
   * Remove network
   */
  public async removeNetwork(networkId: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Docker client not connected');
    }

    try {
      logger.info(`Removing network: ${networkId}`);

      const network = this.docker.getNetwork(networkId);
      await network.remove();

      logger.info(`Network removed successfully: ${networkId}`);
      this.emit('network:removed', { id: networkId });
    } catch (error) {
      logger.error(`Failed to remove network ${networkId}:`, error);
      this.emit('network:remove:failed', { id: networkId, error });
      throw error;
    }
  }

  /**
   * Parse container inspection data
   */
  private parseContainerInfo(inspect: Docker.ContainerInspectInfo): ContainerInfo {
    const state = inspect.State;
    const config = inspect.Config;
    const hostConfig = inspect.HostConfig;
    const networkSettings = inspect.NetworkSettings;

    return {
      id: inspect.Id,
      name: inspect.Name.startsWith('/') ? inspect.Name.slice(1) : inspect.Name,
      image: config.Image,
      status: state.Status,
      state: state.Status,
      created: new Date(inspect.Created),
      started: state.StartedAt ? new Date(state.StartedAt) : undefined,
      finished: state.FinishedAt && state.FinishedAt !== '0001-01-01T00:00:00Z' 
        ? new Date(state.FinishedAt) : undefined,
      ports: this.parsePorts(config.ExposedPorts, hostConfig.PortBindings),
      mounts: (inspect.Mounts || []).map((mount) => ({
        source: mount.Source,
        destination: mount.Destination,
        mode: mount.Mode as 'ro' | 'rw',
        type: mount.Type as 'bind' | 'volume' | 'tmpfs'
      })),
      networks: this.parseNetworks(networkSettings.Networks),
      labels: config.Labels || {},
      environment: config.Env || []
    };
  }

  /**
   * Parse port mappings
   */
  private parsePorts(exposedPorts: Record<string, Record<string, unknown>> | undefined, portBindings: Docker.PortMap | undefined): PortMapping[] {
    const ports: PortMapping[] = [];

    if (exposedPorts) {
      Object.keys(exposedPorts).forEach(portSpec => {
        const [portStr, protocol] = portSpec.split('/');
        const containerPort = parseInt(portStr, 10);
        
        const bindings = portBindings?.[portSpec];
        if (bindings && bindings.length > 0) {
          bindings.forEach((binding: Docker.PortBinding) => {
            ports.push({
              containerPort,
              hostPort: binding.HostPort ? parseInt(binding.HostPort, 10) : undefined,
              protocol: protocol as 'tcp' | 'udp',
              hostIP: binding.HostIp
            });
          });
        } else {
          ports.push({
            containerPort,
            protocol: protocol as 'tcp' | 'udp'
          });
        }
      });
    }

    return ports;
  }

  /**
   * Parse network information
   */
  private parseNetworks(networks: Record<string, Docker.NetworkInfo> | undefined): NetworkInfo[] {
    const networkInfos: NetworkInfo[] = [];

    if (networks) {
      Object.entries(networks).forEach(([name, network]) => {
        networkInfos.push({
          name,
          id: network.NetworkID,
          ipAddress: network.IPAddress,
          gateway: network.Gateway,
          macAddress: network.MacAddress
        });
      });
    }

    return networkInfos;
  }

  /**
   * Parse container statistics
   */
  private parseContainerStats(stats: Docker.ContainerStats): ContainerStats {
    const cpuStats = stats.cpu_stats;
    const preCpuStats = stats.precpu_stats;
    const memoryStats = stats.memory_stats;
    const networkStats = stats.networks;
    const blockStats = stats.blkio_stats;

    // Calculate CPU usage percentage
    const cpuDelta = cpuStats.cpu_usage.total_usage - preCpuStats.cpu_usage.total_usage;
    const systemDelta = cpuStats.system_cpu_usage - preCpuStats.system_cpu_usage;
    const numCpus = cpuStats.online_cpus || 1;
    const cpuUsage = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

    // Calculate network I/O
    let networkRx = 0;
    let networkTx = 0;
    if (networkStats) {
      Object.values(networkStats).forEach((network) => {
        networkRx += network.rx_bytes || 0;
        networkTx += network.tx_bytes || 0;
      });
    }

    // Calculate block I/O
    let blockRead = 0;
    let blockWrite = 0;
    if (blockStats?.io_service_bytes_recursive) {
      blockStats.io_service_bytes_recursive.forEach((entry) => {
        if (entry.op === 'Read') blockRead += entry.value;
        if (entry.op === 'Write') blockWrite += entry.value;
      });
    }

    return {
      cpuUsage: Math.round(cpuUsage * 100) / 100,
      memoryUsage: memoryStats.usage || 0,
      memoryLimit: memoryStats.limit || 0,
      memoryPercentage: memoryStats.limit 
        ? Math.round((memoryStats.usage / memoryStats.limit) * 10000) / 100 
        : 0,
      networkRx,
      networkTx,
      blockRead,
      blockWrite,
      timestamp: new Date()
    };
  }

  /**
   * Parse container logs
   */
  private parseContainerLogs(logs: Buffer | string): ContainerLogs {
    const logString = logs.toString();
    const lines = logString.split('\n').filter((line: string) => line.trim());
    
    const stdout: string[] = [];
    const stderr: string[] = [];

    lines.forEach((line: string) => {
      // Docker log format: first byte indicates stream type
      if (line.length > 8) {
        const streamType = line.charCodeAt(0);
        const content = line.slice(8);
        
        if (streamType === 1) {
          stdout.push(content);
        } else if (streamType === 2) {
          stderr.push(content);
        }
      }
    });

    return {
      stdout,
      stderr,
      timestamp: new Date()
    };
  }

  /**
   * Parse image information
   */
  private parseImageInfo(image: Docker.ImageInfo): ImageInfo {
    const repoTags = image.RepoTags || ['<none>:<none>'];
    const [repository, tag] = repoTags[0].split(':');

    return {
      id: image.Id,
      repository,
      tag,
      digest: image.RepoDigests?.[0],
      size: image.Size,
      created: new Date(image.Created * 1000),
      labels: image.Labels || {}
    };
  }

  /**
   * Check if Docker client is connected
   */
  public isDockerConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get Docker client configuration
   */
  public getConfig(): DockerClientConfig {
    return { ...this.config };
  }

  /**
   * Close Docker client connection
   */
  public async close(): Promise<void> {
    logger.info('Closing Docker client connection');
    this.isConnected = false;
    this.emit('disconnected');
  }
}

export default DockerClient;