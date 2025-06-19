# Dockerode - Node.js Docker API Client

## Overview
Dockerode is a Node.js module that provides a programmatic interface to Docker's Remote API. It allows you to manage Docker containers, images, networks, and volumes directly from Node.js applications.

**Official Documentation**: https://github.com/apocas/dockerode

## Key Concepts and Features

### Core Features
- **Full Docker API Coverage**: Complete implementation of Docker Engine API
- **Promise Support**: Modern async/await patterns
- **Stream Support**: Real-time logs and stats streaming
- **Event System**: Docker event monitoring
- **Connection Options**: Unix socket, TCP, and SSH connections
- **TypeScript Support**: Full type definitions

### Technical Characteristics
- Lightweight wrapper around Docker API
- Supports both callbacks and promises
- Stream-based operations for efficiency
- Comprehensive error handling
- Docker Compose compatibility
- Swarm mode support

## Common Use Cases

1. **Container Management**
   - Creating and running containers
   - Starting/stopping containers
   - Monitoring container health
   - Executing commands in containers

2. **Image Operations**
   - Building images
   - Pulling/pushing images
   - Image inspection
   - Layer management

3. **System Administration**
   - Resource monitoring
   - Log collection
   - Event monitoring
   - Cleanup operations

4. **CI/CD Integration**
   - Dynamic container creation
   - Test environment provisioning
   - Build automation
   - Deployment orchestration

## Best Practices

### Connection Setup
```javascript
import Docker from 'dockerode';

// Local Docker daemon (Unix socket)
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Remote Docker daemon (TCP)
const dockerRemote = new Docker({
  host: '192.168.1.10',
  port: 2375,
  ca: fs.readFileSync('ca.pem'),
  cert: fs.readFileSync('cert.pem'),
  key: fs.readFileSync('key.pem')
});

// Docker via SSH
const dockerSSH = new Docker({
  protocol: 'ssh',
  host: 'remote-host',
  username: 'user',
  sshOptions: {
    privateKey: fs.readFileSync('/home/user/.ssh/id_rsa')
  }
});

// Environment-based configuration
const dockerEnv = new Docker({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock'
});
```

### Error Handling
```javascript
class DockerService {
  constructor() {
    this.docker = new Docker();
  }

  async createContainer(config) {
    try {
      const container = await this.docker.createContainer(config);
      return container;
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`Image ${config.Image} not found`);
      } else if (error.statusCode === 409) {
        throw new Error(`Container name ${config.name} already exists`);
      } else if (error.statusCode === 500) {
        throw new Error('Docker daemon error: ' + error.message);
      }
      throw error;
    }
  }

  async safeContainerOperation(containerId, operation) {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      
      if (!info) {
        throw new Error('Container not found');
      }
      
      return await operation(container, info);
    } catch (error) {
      logger.error(`Container operation failed: ${error.message}`);
      throw error;
    }
  }
}
```

### Container Lifecycle Management
```javascript
class ContainerManager {
  constructor(docker) {
    this.docker = docker;
  }

  async createAndStart(config) {
    // Pull image if not exists
    await this.ensureImage(config.Image);
    
    // Create container
    const container = await this.docker.createContainer({
      ...config,
      HostConfig: {
        AutoRemove: false,
        RestartPolicy: {
          Name: 'unless-stopped',
          MaximumRetryCount: 3
        },
        ...config.HostConfig
      }
    });
    
    // Attach event listeners before starting
    container.attach({ stream: true, stdout: true, stderr: true }, (err, stream) => {
      if (!err) {
        stream.on('data', (chunk) => {
          logger.info(`Container ${container.id}: ${chunk.toString()}`);
        });
      }
    });
    
    // Start container
    await container.start();
    
    // Wait for container to be running
    await this.waitForRunning(container);
    
    return container;
  }

  async ensureImage(imageName) {
    try {
      const image = this.docker.getImage(imageName);
      await image.inspect();
    } catch (error) {
      if (error.statusCode === 404) {
        logger.info(`Pulling image ${imageName}...`);
        const stream = await this.docker.pull(imageName);
        await new Promise((resolve, reject) => {
          this.docker.modem.followProgress(stream, (err, res) => {
            err ? reject(err) : resolve(res);
          });
        });
      } else {
        throw error;
      }
    }
  }

  async waitForRunning(container, timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const info = await container.inspect();
      
      if (info.State.Running) {
        return true;
      }
      
      if (info.State.Status === 'exited' || info.State.Status === 'dead') {
        throw new Error(`Container failed to start: ${info.State.Error || 'Unknown error'}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Container start timeout');
  }
}
```

## Integration Patterns with GitHub RunnerHub Stack

### GitHub Actions Runner Management
```javascript
class GitHubRunnerDocker {
  constructor(docker) {
    this.docker = docker;
    this.runnerImage = 'ghcr.io/actions/runner:latest';
  }

  async createRunner(config) {
    const container = await this.docker.createContainer({
      Image: this.runnerImage,
      name: `github-runner-${config.name}`,
      Env: [
        `RUNNER_NAME=${config.name}`,
        `RUNNER_TOKEN=${config.token}`,
        `RUNNER_WORKDIR=/work`,
        `RUNNER_GROUP=${config.group || 'default'}`,
        `LABELS=${config.labels.join(',')}`,
        `RUNNER_REPOSITORY_URL=${config.repoUrl}`
      ],
      HostConfig: {
        Binds: [
          '/var/run/docker.sock:/var/run/docker.sock:rw',
          `${config.workDir}:/work:rw`
        ],
        Devices: config.gpuEnabled ? [{
          PathOnHost: '/dev/nvidia0',
          PathInContainer: '/dev/nvidia0',
          CgroupPermissions: 'rwm'
        }] : [],
        Resources: {
          CpuShares: config.cpuShares || 1024,
          Memory: config.memory || 2147483648, // 2GB
          MemorySwap: config.memorySwap || 4294967296 // 4GB
        },
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'SETUID', 'SETGID']
      },
      Labels: {
        'com.github.runnerhub.type': 'runner',
        'com.github.runnerhub.runner-id': config.id,
        'com.github.runnerhub.runner-name': config.name,
        'com.github.runnerhub.repo': config.repoUrl
      }
    });

    await container.start();
    return container;
  }

  async removeRunner(runnerId) {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: [`com.github.runnerhub.runner-id=${runnerId}`]
      }
    });

    for (const containerInfo of containers) {
      const container = this.docker.getContainer(containerInfo.Id);
      
      if (containerInfo.State === 'running') {
        await container.stop({ t: 30 });
      }
      
      await container.remove({ v: true, force: true });
    }
  }

  async getRunnerStatus(runnerId) {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: [`com.github.runnerhub.runner-id=${runnerId}`]
      }
    });

    if (containers.length === 0) {
      return { status: 'not_found' };
    }

    const container = this.docker.getContainer(containers[0].Id);
    const info = await container.inspect();
    
    return {
      status: info.State.Status,
      running: info.State.Running,
      startedAt: info.State.StartedAt,
      finishedAt: info.State.FinishedAt,
      exitCode: info.State.ExitCode,
      error: info.State.Error,
      health: info.State.Health
    };
  }
}
```

### Real-time Container Monitoring
```javascript
class ContainerMonitor {
  constructor(docker) {
    this.docker = docker;
    this.monitors = new Map();
  }

  async startMonitoring(containerId, callback) {
    if (this.monitors.has(containerId)) {
      return;
    }

    const container = this.docker.getContainer(containerId);
    
    // Monitor stats
    const statsStream = await container.stats({ stream: true });
    
    statsStream.on('data', (data) => {
      const stats = JSON.parse(data);
      const processed = this.processStats(stats);
      callback('stats', processed);
    });

    // Monitor logs
    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      timestamps: true,
      tail: 0
    });

    const logParser = this.createLogParser(callback);
    container.modem.demuxStream(logStream, logParser.stdout, logParser.stderr);

    // Monitor events
    const eventFilter = {
      container: [containerId],
      type: ['container']
    };

    const eventStream = await this.docker.getEvents({ filters: eventFilter });
    
    eventStream.on('data', (data) => {
      const event = JSON.parse(data);
      callback('event', {
        action: event.Action,
        timestamp: new Date(event.time * 1000),
        attributes: event.Actor.Attributes
      });
    });

    this.monitors.set(containerId, {
      stats: statsStream,
      logs: logStream,
      events: eventStream
    });
  }

  stopMonitoring(containerId) {
    const monitor = this.monitors.get(containerId);
    if (monitor) {
      monitor.stats.destroy();
      monitor.logs.destroy();
      monitor.events.destroy();
      this.monitors.delete(containerId);
    }
  }

  processStats(stats) {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                     stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - 
                        stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || 1;
    const cpuPercent = (cpuDelta / systemDelta) * cpuCount * 100;

    const memUsage = stats.memory_stats.usage || 0;
    const memLimit = stats.memory_stats.limit || 1;
    const memPercent = (memUsage / memLimit) * 100;

    return {
      cpu: {
        percent: cpuPercent.toFixed(2),
        cores: cpuCount
      },
      memory: {
        usage: memUsage,
        limit: memLimit,
        percent: memPercent.toFixed(2)
      },
      network: {
        rx: stats.networks?.eth0?.rx_bytes || 0,
        tx: stats.networks?.eth0?.tx_bytes || 0
      },
      disk: {
        read: stats.blkio_stats?.io_service_bytes_recursive?.[0]?.value || 0,
        write: stats.blkio_stats?.io_service_bytes_recursive?.[1]?.value || 0
      },
      timestamp: new Date()
    };
  }

  createLogParser(callback) {
    return {
      stdout: new Transform({
        transform(chunk, encoding, done) {
          callback('log', {
            stream: 'stdout',
            message: chunk.toString(),
            timestamp: new Date()
          });
          done();
        }
      }),
      stderr: new Transform({
        transform(chunk, encoding, done) {
          callback('log', {
            stream: 'stderr',
            message: chunk.toString(),
            timestamp: new Date()
          });
          done();
        }
      })
    };
  }
}
```

### Image Management
```javascript
class ImageManager {
  constructor(docker) {
    this.docker = docker;
  }

  async buildImage(dockerfilePath, imageName, buildArgs = {}) {
    const stream = await this.docker.buildImage({
      context: path.dirname(dockerfilePath),
      src: [path.basename(dockerfilePath)]
    }, {
      t: imageName,
      buildargs: buildArgs,
      dockerfile: path.basename(dockerfilePath)
    });

    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      }, (event) => {
        if (event.stream) {
          logger.info(`Build: ${event.stream.trim()}`);
        }
      });
    });
  }

  async pullImage(imageName, onProgress) {
    const auth = {
      username: process.env.DOCKER_USERNAME,
      password: process.env.DOCKER_PASSWORD,
      serveraddress: 'https://index.docker.io/v1'
    };

    const stream = await this.docker.pull(imageName, { authconfig: auth });

    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      }, onProgress);
    });
  }

  async pushImage(imageName, tag = 'latest') {
    const image = this.docker.getImage(`${imageName}:${tag}`);
    
    const auth = {
      username: process.env.DOCKER_USERNAME,
      password: process.env.DOCKER_PASSWORD
    };

    const stream = await image.push({ authconfig: auth });

    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      });
    });
  }

  async cleanupImages(keepDays = 7) {
    const images = await this.docker.listImages({ all: true });
    const cutoffTime = Date.now() - (keepDays * 24 * 60 * 60 * 1000);

    for (const imageInfo of images) {
      if (imageInfo.Created * 1000 < cutoffTime && imageInfo.RepoTags[0] !== '<none>:<none>') {
        try {
          const image = this.docker.getImage(imageInfo.Id);
          await image.remove({ force: true });
          logger.info(`Removed old image: ${imageInfo.Id}`);
        } catch (error) {
          logger.error(`Failed to remove image ${imageInfo.Id}: ${error.message}`);
        }
      }
    }
  }
}
```

### Volume and Network Management
```javascript
class VolumeNetworkManager {
  constructor(docker) {
    this.docker = docker;
  }

  async createRunnerVolume(runnerId) {
    const volume = await this.docker.createVolume({
      Name: `runner-${runnerId}-workspace`,
      Labels: {
        'com.github.runnerhub.runner-id': runnerId,
        'com.github.runnerhub.type': 'workspace'
      }
    });

    return volume;
  }

  async createRunnerNetwork() {
    const network = await this.docker.createNetwork({
      Name: 'runnerhub-network',
      Driver: 'bridge',
      Internal: false,
      Attachable: true,
      EnableIPv6: false,
      IPAM: {
        Driver: 'default',
        Config: [{
          Subnet: '172.28.0.0/16',
          Gateway: '172.28.0.1'
        }]
      },
      Labels: {
        'com.github.runnerhub.network': 'true'
      }
    });

    return network;
  }

  async connectContainerToNetwork(containerId, networkName) {
    const network = this.docker.getNetwork(networkName);
    await network.connect({
      Container: containerId,
      EndpointConfig: {
        IPAMConfig: {
          IPv4Address: await this.getNextIPAddress(networkName)
        }
      }
    });
  }

  async getNextIPAddress(networkName) {
    const network = this.docker.getNetwork(networkName);
    const info = await network.inspect();
    
    const subnet = info.IPAM.Config[0].Subnet;
    const usedIPs = Object.values(info.Containers || {})
      .map(c => c.IPv4Address.split('/')[0]);
    
    // Simple IP allocation (production would need better algorithm)
    const baseIP = subnet.split('.').slice(0, 3).join('.');
    for (let i = 10; i < 250; i++) {
      const candidateIP = `${baseIP}.${i}`;
      if (!usedIPs.includes(candidateIP)) {
        return candidateIP;
      }
    }
    
    throw new Error('No available IP addresses');
  }
}
```

## GitHub RunnerHub Specific Patterns

### Container Health Checks
```javascript
class HealthChecker {
  constructor(docker) {
    this.docker = docker;
  }

  async checkContainerHealth(containerId) {
    const container = this.docker.getContainer(containerId);
    
    try {
      const info = await container.inspect();
      
      // Basic health check
      if (!info.State.Running) {
        return {
          healthy: false,
          reason: 'Container not running',
          state: info.State.Status
        };
      }

      // Check if container has health check
      if (info.State.Health) {
        return {
          healthy: info.State.Health.Status === 'healthy',
          reason: info.State.Health.Log?.[0]?.Output || 'Health check status',
          failingStreak: info.State.Health.FailingStreak || 0
        };
      }

      // Custom health check via exec
      const exec = await container.exec({
        Cmd: ['test', '-f', '/var/run/runner.pid'],
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start();
      const exitCode = await new Promise((resolve) => {
        exec.inspect((err, data) => {
          resolve(data?.ExitCode || 1);
        });
      });

      return {
        healthy: exitCode === 0,
        reason: exitCode === 0 ? 'Runner process found' : 'Runner process not found'
      };
    } catch (error) {
      return {
        healthy: false,
        reason: error.message
      };
    }
  }

  async performHealthChecks() {
    const containers = await this.docker.listContainers({
      filters: {
        label: ['com.github.runnerhub.type=runner']
      }
    });

    const results = await Promise.all(
      containers.map(async (containerInfo) => {
        const health = await this.checkContainerHealth(containerInfo.Id);
        return {
          id: containerInfo.Id,
          name: containerInfo.Names[0],
          ...health
        };
      })
    );

    return results;
  }
}
```

### Advanced Exec Operations
```javascript
class ExecManager {
  constructor(docker) {
    this.docker = docker;
  }

  async executeCommand(containerId, command, options = {}) {
    const container = this.docker.getContainer(containerId);
    
    const exec = await container.exec({
      Cmd: Array.isArray(command) ? command : command.split(' '),
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: options.stdin || false,
      Tty: options.tty || false,
      User: options.user || '',
      WorkingDir: options.workingDir || '',
      Env: options.env || []
    });

    const stream = await exec.start({
      hijack: true,
      stdin: options.stdin || false
    });

    return new Promise((resolve, reject) => {
      const output = { stdout: '', stderr: '' };
      
      if (options.tty) {
        stream.on('data', (chunk) => {
          output.stdout += chunk.toString();
        });
      } else {
        container.modem.demuxStream(stream, 
          { write: (chunk) => { output.stdout += chunk.toString(); } },
          { write: (chunk) => { output.stderr += chunk.toString(); } }
        );
      }

      stream.on('end', async () => {
        const info = await exec.inspect();
        resolve({
          exitCode: info.ExitCode,
          stdout: output.stdout,
          stderr: output.stderr
        });
      });

      stream.on('error', reject);
    });
  }

  async runInteractiveShell(containerId) {
    const container = this.docker.getContainer(containerId);
    
    const exec = await container.exec({
      Cmd: ['/bin/bash'],
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      Tty: true
    });

    const stream = await exec.start({
      hijack: true,
      stdin: true
    });

    // Connect to stdin/stdout
    process.stdin.pipe(stream);
    stream.pipe(process.stdout);

    // Handle cleanup
    stream.on('end', () => {
      process.stdin.unpipe(stream);
      stream.unpipe(process.stdout);
    });

    return stream;
  }
}
```

### Event Handling and Recovery
```javascript
class EventHandler {
  constructor(docker) {
    this.docker = docker;
    this.handlers = new Map();
  }

  async startEventMonitoring() {
    const stream = await this.docker.getEvents({
      filters: {
        type: ['container'],
        label: ['com.github.runnerhub.managed=true']
      }
    });

    stream.on('data', (data) => {
      const event = JSON.parse(data);
      this.handleEvent(event);
    });

    stream.on('error', (error) => {
      logger.error('Docker event stream error:', error);
      // Reconnect after delay
      setTimeout(() => this.startEventMonitoring(), 5000);
    });
  }

  handleEvent(event) {
    const eventKey = `${event.Type}:${event.Action}`;
    const handler = this.handlers.get(eventKey);
    
    if (handler) {
      handler(event);
    }

    // Log all events
    logger.info(`Docker event: ${eventKey}`, {
      container: event.Actor.Attributes.name,
      time: new Date(event.time * 1000)
    });
  }

  on(eventType, action, handler) {
    this.handlers.set(`${eventType}:${action}`, handler);
  }

  setupRunnerHandlers() {
    // Container died unexpectedly
    this.on('container', 'die', async (event) => {
      const exitCode = parseInt(event.Actor.Attributes.exitCode);
      const containerName = event.Actor.Attributes.name;
      
      if (exitCode !== 0) {
        logger.error(`Container ${containerName} died with exit code ${exitCode}`);
        
        // Attempt to restart
        if (event.Actor.Attributes['com.github.runnerhub.auto-restart'] === 'true') {
          await this.restartContainer(event.Actor.ID);
        }
      }
    });

    // Container OOM killed
    this.on('container', 'oom', async (event) => {
      logger.error(`Container ${event.Actor.Attributes.name} killed due to OOM`);
      // Increase memory limit and restart
      await this.increaseMemoryAndRestart(event.Actor.ID);
    });
  }

  async restartContainer(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      await container.restart();
      logger.info(`Successfully restarted container ${containerId}`);
    } catch (error) {
      logger.error(`Failed to restart container ${containerId}:`, error);
    }
  }
}
```

## Performance Optimization

### Connection Pooling
```javascript
class DockerPool {
  constructor(maxConnections = 10) {
    this.connections = [];
    this.maxConnections = maxConnections;
    this.initializePool();
  }

  initializePool() {
    for (let i = 0; i < this.maxConnections; i++) {
      this.connections.push({
        docker: new Docker({ socketPath: '/var/run/docker.sock' }),
        inUse: false
      });
    }
  }

  async acquire() {
    while (true) {
      const connection = this.connections.find(c => !c.inUse);
      if (connection) {
        connection.inUse = true;
        return connection.docker;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  release(docker) {
    const connection = this.connections.find(c => c.docker === docker);
    if (connection) {
      connection.inUse = false;
    }
  }

  async withConnection(operation) {
    const docker = await this.acquire();
    try {
      return await operation(docker);
    } finally {
      this.release(docker);
    }
  }
}
```

### Batch Operations
```javascript
class BatchOperations {
  constructor(docker) {
    this.docker = docker;
  }

  async batchRemoveContainers(containerIds, options = {}) {
    const batchSize = options.batchSize || 5;
    const results = [];

    for (let i = 0; i < containerIds.length; i += batchSize) {
      const batch = containerIds.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(id => this.removeContainer(id, options))
      );
      results.push(...batchResults);
    }

    return results;
  }

  async removeContainer(containerId, options) {
    const container = this.docker.getContainer(containerId);
    
    try {
      // Stop if running
      const info = await container.inspect();
      if (info.State.Running) {
        await container.stop({ t: options.stopTimeout || 10 });
      }
      
      // Remove
      await container.remove({ 
        v: options.removeVolumes || true,
        force: options.force || false 
      });
      
      return { success: true, containerId };
    } catch (error) {
      return { success: false, containerId, error: error.message };
    }
  }
}
```

## Debugging and Troubleshooting

### Debug Logging
```javascript
// Enable debug mode
const Docker = require('dockerode');

// Debug mode with request/response logging
const docker = new Docker({
  socketPath: '/var/run/docker.sock',
  debug: true
});

// Custom debug handler
docker.modem.debug = (msg) => {
  logger.debug('Docker API:', msg);
};
```

### Common Issues and Solutions
```javascript
class DockerTroubleshooter {
  async diagnoseConnection() {
    try {
      await this.docker.ping();
      console.log('✓ Docker daemon is accessible');
    } catch (error) {
      console.error('✗ Cannot connect to Docker daemon');
      console.error('  Check if Docker is running and socket permissions');
    }
  }

  async diagnoseContainer(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      
      console.log('Container Status:', info.State.Status);
      console.log('Exit Code:', info.State.ExitCode);
      
      if (info.State.Error) {
        console.error('Error:', info.State.Error);
      }
      
      // Get last 50 logs
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: 50
      });
      
      console.log('Recent logs:', logs.toString());
    } catch (error) {
      console.error('Diagnosis failed:', error.message);
    }
  }
}
```

## Resources
- [Dockerode GitHub Repository](https://github.com/apocas/dockerode)
- [Docker Engine API Reference](https://docs.docker.com/engine/api/)
- [Dockerode Examples](https://github.com/apocas/dockerode/tree/master/examples)
- [Docker SDK Documentation](https://docs.docker.com/engine/api/sdk/)