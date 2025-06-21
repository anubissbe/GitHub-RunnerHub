/**
 * Runtime Security Monitor
 * Provides real-time security monitoring and threat detection for running containers
 * with behavioral analysis, anomaly detection, and automatic response capabilities
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

class RuntimeSecurityMonitor extends EventEmitter {
  constructor(dockerAPI, auditLogger, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.docker = dockerAPI.docker;
    this.auditLogger = auditLogger;
    
    this.config = {
      // Monitoring configuration
      monitoring: {
        interval: options.monitoringInterval || 5000, // 5 seconds
        syscallMonitoring: options.syscallMonitoring || false,
        fileIntegrityMonitoring: options.fileIntegrityMonitoring !== false,
        networkMonitoring: options.networkMonitoring !== false,
        processMonitoring: options.processMonitoring !== false,
        memoryMonitoring: options.memoryMonitoring !== false
      },
      
      // Detection rules
      detectionRules: {
        // Process rules
        suspiciousProcesses: options.suspiciousProcesses || [
          'nc', 'netcat', 'nmap', 'tcpdump', 'wireshark',
          'metasploit', 'sqlmap', 'nikto', 'burpsuite'
        ],
        allowedProcesses: options.allowedProcesses || [
          'node', 'npm', 'yarn', 'git', 'docker', 'bash', 'sh'
        ],
        maxProcesses: options.maxProcesses || 50,
        
        // Network rules
        suspiciousPorts: options.suspiciousPorts || [22, 23, 135, 139, 445, 3389],
        allowedPorts: options.allowedPorts || [80, 443, 3000, 8080],
        maxConnections: options.maxConnections || 100,
        outboundWhitelist: options.outboundWhitelist || [
          'github.com',
          'githubusercontent.com',
          'docker.io',
          'npmjs.org'
        ],
        
        // File rules
        protectedPaths: options.protectedPaths || [
          '/etc/passwd',
          '/etc/shadow',
          '/etc/sudoers',
          '/.ssh',
          '/root'
        ],
        suspiciousFilePatterns: options.suspiciousFilePatterns || [
          /\.sh$/,
          /\.exe$/,
          /\.dll$/,
          /\.so$/
        ],
        
        // Behavior rules
        maxCpuUsage: options.maxCpuUsage || 90,
        maxMemoryUsage: options.maxMemoryUsage || 85,
        maxDiskIORate: options.maxDiskIORate || 104857600, // 100MB/s
        cryptominingPatterns: options.cryptominingPatterns || [
          'xmrig', 'minerd', 'minergate', 'ethminer'
        ]
      },
      
      // Response actions
      responseActions: {
        alertOnly: options.alertOnly || false,
        killSuspiciousProcesses: options.killSuspiciousProcesses !== false,
        blockNetworkAccess: options.blockNetworkAccess !== false,
        terminateContainer: options.terminateContainer || false,
        snapshotForensics: options.snapshotForensics !== false
      },
      
      // Machine learning
      anomalyDetection: {
        enabled: options.anomalyDetectionEnabled || false,
        baselineWindow: options.baselineWindow || 3600000, // 1 hour
        sensitivityThreshold: options.sensitivityThreshold || 0.8,
        modelUpdateInterval: options.modelUpdateInterval || 86400000 // 24 hours
      },
      
      // Alerting
      alerting: {
        cooldownPeriod: options.alertCooldown || 300000, // 5 minutes
        aggregationWindow: options.alertAggregation || 60000, // 1 minute
        severityLevels: {
          critical: 1,
          high: 2,
          medium: 3,
          low: 4,
          info: 5
        }
      },
      
      ...options
    };
    
    // Monitoring state
    this.monitoredContainers = new Map(); // containerId -> monitoringData
    this.containerBaselines = new Map(); // containerId -> baseline
    this.detectedThreats = new Map(); // threatId -> threat
    this.alertHistory = [];
    
    // Behavioral analysis
    this.behaviorProfiles = new Map(); // containerId -> behaviorProfile
    this.anomalyModels = new Map(); // modelType -> model
    
    // Statistics
    this.stats = {
      containersMonitored: 0,
      threatsDetected: 0,
      threatsBlocked: 0,
      falsePositives: 0,
      anomaliesDetected: 0
    };
    
    // Timers
    this.monitoringTimer = null;
    this.modelUpdateTimer = null;
    
    this.isInitialized = false;
  }

  /**
   * Initialize the runtime security monitor
   */
  async initialize() {
    try {
      logger.info('Initializing Runtime Security Monitor');
      
      // Load detection rules
      await this.loadDetectionRules();
      
      // Initialize anomaly detection models if enabled
      if (this.config.anomalyDetection.enabled) {
        await this.initializeAnomalyDetection();
      }
      
      // Start monitoring
      this.startMonitoring();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Runtime Security Monitor initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Runtime Security Monitor:', error);
      throw error;
    }
  }

  /**
   * Start monitoring a container
   */
  async startContainerMonitoring(containerId, jobId, metadata = {}) {
    try {
      logger.info(`Starting runtime monitoring for container ${containerId}`);
      
      const monitoringData = {
        containerId,
        jobId,
        metadata,
        startTime: new Date(),
        lastCheck: null,
        baseline: null,
        threats: [],
        anomalies: [],
        metrics: {
          processes: [],
          network: {
            connections: [],
            traffic: { in: 0, out: 0 }
          },
          filesystem: {
            changes: [],
            integrity: new Map()
          },
          resource: {
            cpu: [],
            memory: [],
            diskIO: []
          }
        }
      };
      
      this.monitoredContainers.set(containerId, monitoringData);
      this.stats.containersMonitored++;
      
      // Create baseline if anomaly detection is enabled
      if (this.config.anomalyDetection.enabled) {
        await this.createContainerBaseline(containerId);
      }
      
      // Initial security scan
      await this.performSecurityCheck(containerId);
      
      // Audit log
      await this.auditLogger.log({
        category: 'security',
        action: 'monitoring_started',
        resourceType: 'container',
        resourceId: containerId,
        details: { jobId, metadata }
      });
      
      this.emit('monitoringStarted', { containerId, jobId });
      
      return true;
      
    } catch (error) {
      logger.error(`Failed to start monitoring for container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Stop monitoring a container
   */
  async stopContainerMonitoring(containerId) {
    try {
      const monitoringData = this.monitoredContainers.get(containerId);
      if (!monitoringData) {
        return;
      }
      
      logger.info(`Stopping runtime monitoring for container ${containerId}`);
      
      // Generate final report
      const report = await this.generateSecurityReport(containerId);
      
      // Clean up
      this.monitoredContainers.delete(containerId);
      this.containerBaselines.delete(containerId);
      this.behaviorProfiles.delete(containerId);
      
      // Audit log
      await this.auditLogger.log({
        category: 'security',
        action: 'monitoring_stopped',
        resourceType: 'container',
        resourceId: containerId,
        details: { 
          duration: Date.now() - monitoringData.startTime.getTime(),
          threatsDetected: monitoringData.threats.length,
          report
        }
      });
      
      this.emit('monitoringStopped', { containerId, report });
      
      return report;
      
    } catch (error) {
      logger.error(`Failed to stop monitoring for container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Perform security check on container
   */
  async performSecurityCheck(containerId) {
    try {
      const monitoringData = this.monitoredContainers.get(containerId);
      if (!monitoringData) {
        return;
      }
      
      monitoringData.lastCheck = new Date();
      
      // Process monitoring
      if (this.config.monitoring.processMonitoring) {
        await this.monitorProcesses(containerId);
      }
      
      // Network monitoring
      if (this.config.monitoring.networkMonitoring) {
        await this.monitorNetwork(containerId);
      }
      
      // File integrity monitoring
      if (this.config.monitoring.fileIntegrityMonitoring) {
        await this.monitorFileIntegrity(containerId);
      }
      
      // Resource monitoring
      if (this.config.monitoring.memoryMonitoring) {
        await this.monitorResources(containerId);
      }
      
      // Behavioral analysis
      if (this.config.anomalyDetection.enabled) {
        await this.performBehavioralAnalysis(containerId);
      }
      
    } catch (error) {
      logger.error(`Security check failed for container ${containerId}:`, error);
    }
  }

  /**
   * Monitor processes in container
   */
  async monitorProcesses(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Execute ps command in container
      const exec = await container.exec({
        Cmd: ['ps', 'aux'],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const stream = await exec.start();
      const output = await this.streamToString(stream);
      
      // Parse process list
      const processes = this.parseProcessList(output);
      
      // Check for suspicious processes
      for (const process of processes) {
        // Check against suspicious process list
        for (const suspicious of this.config.detectionRules.suspiciousProcesses) {
          if (process.command.toLowerCase().includes(suspicious)) {
            await this.handleThreat({
              type: 'suspicious_process',
              severity: 'high',
              containerId,
              details: {
                process: process.command,
                pid: process.pid,
                user: process.user
              }
            });
          }
        }
        
        // Check for cryptomining
        for (const pattern of this.config.detectionRules.cryptominingPatterns) {
          if (process.command.toLowerCase().includes(pattern)) {
            await this.handleThreat({
              type: 'cryptomining',
              severity: 'critical',
              containerId,
              details: {
                process: process.command,
                pid: process.pid
              }
            });
          }
        }
      }
      
      // Check process count
      if (processes.length > this.config.detectionRules.maxProcesses) {
        await this.handleThreat({
          type: 'excessive_processes',
          severity: 'medium',
          containerId,
          details: {
            count: processes.length,
            limit: this.config.detectionRules.maxProcesses
          }
        });
      }
      
      // Update monitoring data
      const monitoringData = this.monitoredContainers.get(containerId);
      if (monitoringData) {
        monitoringData.metrics.processes = processes;
      }
      
    } catch (error) {
      logger.error(`Process monitoring failed for container ${containerId}:`, error);
    }
  }

  /**
   * Monitor network activity
   */
  async monitorNetwork(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Get network connections
      const exec = await container.exec({
        Cmd: ['netstat', '-tuln'],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const stream = await exec.start();
      const output = await this.streamToString(stream);
      
      // Parse connections
      const connections = this.parseNetworkConnections(output);
      
      // Check for suspicious ports
      for (const conn of connections) {
        if (this.config.detectionRules.suspiciousPorts.includes(conn.port)) {
          await this.handleThreat({
            type: 'suspicious_port',
            severity: 'high',
            containerId,
            details: {
              port: conn.port,
              protocol: conn.protocol,
              state: conn.state
            }
          });
        }
      }
      
      // Check connection count
      if (connections.length > this.config.detectionRules.maxConnections) {
        await this.handleThreat({
          type: 'excessive_connections',
          severity: 'medium',
          containerId,
          details: {
            count: connections.length,
            limit: this.config.detectionRules.maxConnections
          }
        });
      }
      
      // Update monitoring data
      const monitoringData = this.monitoredContainers.get(containerId);
      if (monitoringData) {
        monitoringData.metrics.network.connections = connections;
      }
      
    } catch (error) {
      logger.error(`Network monitoring failed for container ${containerId}:`, error);
    }
  }

  /**
   * Monitor file integrity
   */
  async monitorFileIntegrity(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const monitoringData = this.monitoredContainers.get(containerId);
      if (!monitoringData) return;
      
      // Check protected paths
      for (const protectedPath of this.config.detectionRules.protectedPaths) {
        try {
          // Get file hash
          const exec = await container.exec({
            Cmd: ['sha256sum', protectedPath],
            AttachStdout: true,
            AttachStderr: true
          });
          
          const stream = await exec.start();
          const output = await this.streamToString(stream);
          const hash = output.split(' ')[0];
          
          // Compare with baseline
          const baselineHash = monitoringData.metrics.filesystem.integrity.get(protectedPath);
          if (baselineHash && baselineHash !== hash) {
            await this.handleThreat({
              type: 'file_integrity_violation',
              severity: 'critical',
              containerId,
              details: {
                path: protectedPath,
                expectedHash: baselineHash,
                actualHash: hash
              }
            });
          } else if (!baselineHash) {
            // Store baseline
            monitoringData.metrics.filesystem.integrity.set(protectedPath, hash);
          }
          
        } catch (error) {
          // File might not exist, which is fine
        }
      }
      
      // Check for suspicious file creation
      const exec = await container.exec({
        Cmd: ['find', '/', '-type', 'f', '-mmin', '-1', '-ls'],
        AttachStdout: true,
        AttachStderr: true
      });
      
      const stream = await exec.start();
      const output = await this.streamToString(stream);
      const recentFiles = output.split('\n').filter(line => line.trim());
      
      for (const file of recentFiles) {
        for (const pattern of this.config.detectionRules.suspiciousFilePatterns) {
          if (pattern.test(file)) {
            await this.handleThreat({
              type: 'suspicious_file_created',
              severity: 'medium',
              containerId,
              details: {
                file,
                pattern: pattern.toString()
              }
            });
          }
        }
      }
      
    } catch (error) {
      logger.error(`File integrity monitoring failed for container ${containerId}:`, error);
    }
  }

  /**
   * Monitor resource usage
   */
  async monitorResources(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });
      
      const monitoringData = this.monitoredContainers.get(containerId);
      if (!monitoringData) return;
      
      // Calculate resource usage
      const cpuUsage = this.calculateCpuUsage(stats);
      const memoryUsage = this.calculateMemoryUsage(stats);
      const diskIO = this.calculateDiskIO(stats);
      
      // Check CPU usage
      if (cpuUsage > this.config.detectionRules.maxCpuUsage) {
        await this.handleThreat({
          type: 'excessive_cpu_usage',
          severity: 'high',
          containerId,
          details: {
            usage: cpuUsage,
            limit: this.config.detectionRules.maxCpuUsage
          }
        });
      }
      
      // Check memory usage
      if (memoryUsage > this.config.detectionRules.maxMemoryUsage) {
        await this.handleThreat({
          type: 'excessive_memory_usage',
          severity: 'high',
          containerId,
          details: {
            usage: memoryUsage,
            limit: this.config.detectionRules.maxMemoryUsage
          }
        });
      }
      
      // Check disk I/O
      if (diskIO.writeRate > this.config.detectionRules.maxDiskIORate) {
        await this.handleThreat({
          type: 'excessive_disk_io',
          severity: 'medium',
          containerId,
          details: {
            writeRate: diskIO.writeRate,
            limit: this.config.detectionRules.maxDiskIORate
          }
        });
      }
      
      // Update metrics
      monitoringData.metrics.resource.cpu.push({ timestamp: new Date(), value: cpuUsage });
      monitoringData.metrics.resource.memory.push({ timestamp: new Date(), value: memoryUsage });
      monitoringData.metrics.resource.diskIO.push({ timestamp: new Date(), value: diskIO });
      
      // Keep only recent metrics
      const maxMetrics = 100;
      if (monitoringData.metrics.resource.cpu.length > maxMetrics) {
        monitoringData.metrics.resource.cpu = monitoringData.metrics.resource.cpu.slice(-maxMetrics);
      }
      if (monitoringData.metrics.resource.memory.length > maxMetrics) {
        monitoringData.metrics.resource.memory = monitoringData.metrics.resource.memory.slice(-maxMetrics);
      }
      if (monitoringData.metrics.resource.diskIO.length > maxMetrics) {
        monitoringData.metrics.resource.diskIO = monitoringData.metrics.resource.diskIO.slice(-maxMetrics);
      }
      
    } catch (error) {
      logger.error(`Resource monitoring failed for container ${containerId}:`, error);
    }
  }

  /**
   * Perform behavioral analysis
   */
  async performBehavioralAnalysis(containerId) {
    try {
      const monitoringData = this.monitoredContainers.get(containerId);
      if (!monitoringData || !monitoringData.baseline) return;
      
      // Get current behavior profile
      const currentProfile = this.createBehaviorProfile(monitoringData.metrics);
      
      // Compare with baseline
      const anomalies = this.detectAnomalies(currentProfile, monitoringData.baseline);
      
      // Handle anomalies
      for (const anomaly of anomalies) {
        if (anomaly.score > this.config.anomalyDetection.sensitivityThreshold) {
          await this.handleThreat({
            type: 'behavioral_anomaly',
            severity: anomaly.score > 0.9 ? 'high' : 'medium',
            containerId,
            details: {
              anomalyType: anomaly.type,
              score: anomaly.score,
              description: anomaly.description
            }
          });
          
          this.stats.anomaliesDetected++;
        }
      }
      
      // Update behavior profile
      this.behaviorProfiles.set(containerId, currentProfile);
      
    } catch (error) {
      logger.error(`Behavioral analysis failed for container ${containerId}:`, error);
    }
  }

  /**
   * Handle detected threat
   */
  async handleThreat(threat) {
    try {
      const threatId = this.generateThreatId();
      threat.id = threatId;
      threat.detectedAt = new Date();
      
      logger.warn(`Threat detected: ${threat.type} in container ${threat.containerId}`);
      
      // Store threat
      this.detectedThreats.set(threatId, threat);
      this.stats.threatsDetected++;
      
      // Add to container's threat list
      const monitoringData = this.monitoredContainers.get(threat.containerId);
      if (monitoringData) {
        monitoringData.threats.push(threat);
      }
      
      // Check if we should aggregate alerts
      if (!this.shouldAlert(threat)) {
        return;
      }
      
      // Take response action
      if (!this.config.responseActions.alertOnly) {
        await this.respondToThreat(threat);
      }
      
      // Emit threat event
      this.emit('threatDetected', threat);
      
      // Audit log
      await this.auditLogger.log({
        category: 'security',
        action: 'threat_detected',
        level: threat.severity,
        resourceType: 'container',
        resourceId: threat.containerId,
        details: threat
      });
      
      // Add to alert history
      this.alertHistory.push({
        threat,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error('Failed to handle threat:', error);
    }
  }

  /**
   * Respond to detected threat
   */
  async respondToThreat(threat) {
    try {
      logger.info(`Responding to threat ${threat.id} (${threat.type})`);
      
      switch (threat.type) {
        case 'suspicious_process':
        case 'cryptomining':
          if (this.config.responseActions.killSuspiciousProcesses) {
            await this.killProcess(threat.containerId, threat.details.pid);
          }
          break;
          
        case 'suspicious_port':
        case 'excessive_connections':
          if (this.config.responseActions.blockNetworkAccess) {
            await this.blockNetworkAccess(threat.containerId);
          }
          break;
          
        case 'file_integrity_violation':
          if (this.config.responseActions.snapshotForensics) {
            await this.createForensicSnapshot(threat.containerId);
          }
          break;
      }
      
      // Terminate container for critical threats
      if (threat.severity === 'critical' && this.config.responseActions.terminateContainer) {
        await this.terminateContainer(threat.containerId);
      }
      
      this.stats.threatsBlocked++;
      
    } catch (error) {
      logger.error(`Failed to respond to threat ${threat.id}:`, error);
    }
  }

  /**
   * Kill a process in container
   */
  async killProcess(containerId, pid) {
    try {
      const container = this.docker.getContainer(containerId);
      
      await container.exec({
        Cmd: ['kill', '-9', String(pid)],
        AttachStdout: false,
        AttachStderr: false
      });
      
      logger.info(`Killed process ${pid} in container ${containerId}`);
      
    } catch (error) {
      logger.error(`Failed to kill process ${pid}:`, error);
    }
  }

  /**
   * Block network access for container
   */
  async blockNetworkAccess(containerId) {
    try {
      // This would integrate with network isolation system
      logger.info(`Blocking network access for container ${containerId}`);
      
      this.emit('networkBlocked', { containerId });
      
    } catch (error) {
      logger.error(`Failed to block network access:`, error);
    }
  }

  /**
   * Create forensic snapshot
   */
  async createForensicSnapshot(containerId) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotPath = `/tmp/forensics/${containerId}-${timestamp}`;
      
      await fs.mkdir(snapshotPath, { recursive: true });
      
      // Export container filesystem
      const container = this.docker.getContainer(containerId);
      const stream = await container.export();
      
      const tarPath = path.join(snapshotPath, 'filesystem.tar');
      const writeStream = require('fs').createWriteStream(tarPath);
      stream.pipe(writeStream);
      
      // Save container info
      const info = await container.inspect();
      await fs.writeFile(
        path.join(snapshotPath, 'container-info.json'),
        JSON.stringify(info, null, 2)
      );
      
      // Save monitoring data
      const monitoringData = this.monitoredContainers.get(containerId);
      if (monitoringData) {
        await fs.writeFile(
          path.join(snapshotPath, 'monitoring-data.json'),
          JSON.stringify(monitoringData, null, 2)
        );
      }
      
      logger.info(`Created forensic snapshot at ${snapshotPath}`);
      
    } catch (error) {
      logger.error(`Failed to create forensic snapshot:`, error);
    }
  }

  /**
   * Terminate container
   */
  async terminateContainer(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      await container.kill();
      
      logger.warn(`Terminated container ${containerId} due to security threat`);
      
      this.emit('containerTerminated', { containerId, reason: 'security_threat' });
      
    } catch (error) {
      logger.error(`Failed to terminate container ${containerId}:`, error);
    }
  }

  /**
   * Create baseline for container
   */
  async createContainerBaseline(containerId) {
    try {
      // Wait for container to stabilize
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
      
      const monitoringData = this.monitoredContainers.get(containerId);
      if (!monitoringData) return;
      
      // Collect baseline metrics
      await this.performSecurityCheck(containerId);
      
      // Create baseline profile
      const baseline = this.createBehaviorProfile(monitoringData.metrics);
      monitoringData.baseline = baseline;
      this.containerBaselines.set(containerId, baseline);
      
      logger.debug(`Created baseline for container ${containerId}`);
      
    } catch (error) {
      logger.error(`Failed to create baseline for container ${containerId}:`, error);
    }
  }

  /**
   * Create behavior profile from metrics
   */
  createBehaviorProfile(metrics) {
    return {
      processCount: metrics.processes.length,
      processNames: metrics.processes.map(p => p.command),
      networkConnections: metrics.network.connections.length,
      networkPorts: metrics.network.connections.map(c => c.port),
      cpuPattern: this.calculatePattern(metrics.resource.cpu),
      memoryPattern: this.calculatePattern(metrics.resource.memory),
      diskIOPattern: this.calculatePattern(metrics.resource.diskIO)
    };
  }

  /**
   * Calculate pattern from metrics
   */
  calculatePattern(metrics) {
    if (metrics.length === 0) return null;
    
    const values = metrics.map(m => m.value);
    return {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      stdDev: this.calculateStdDev(values),
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }

  /**
   * Calculate standard deviation
   */
  calculateStdDev(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(value => Math.pow(value - mean, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquareDiff);
  }

  /**
   * Detect anomalies
   */
  detectAnomalies(current, baseline) {
    const anomalies = [];
    
    // Process count anomaly
    if (Math.abs(current.processCount - baseline.processCount) > 5) {
      anomalies.push({
        type: 'process_count',
        score: Math.min(1, Math.abs(current.processCount - baseline.processCount) / baseline.processCount),
        description: `Unusual process count: ${current.processCount} (baseline: ${baseline.processCount})`
      });
    }
    
    // New processes
    const newProcesses = current.processNames.filter(p => !baseline.processNames.includes(p));
    if (newProcesses.length > 0) {
      anomalies.push({
        type: 'new_processes',
        score: Math.min(1, newProcesses.length / baseline.processNames.length),
        description: `New processes detected: ${newProcesses.join(', ')}`
      });
    }
    
    // Network anomalies
    if (Math.abs(current.networkConnections - baseline.networkConnections) > 10) {
      anomalies.push({
        type: 'network_connections',
        score: Math.min(1, Math.abs(current.networkConnections - baseline.networkConnections) / baseline.networkConnections),
        description: `Unusual network connections: ${current.networkConnections} (baseline: ${baseline.networkConnections})`
      });
    }
    
    // Resource usage anomalies
    if (current.cpuPattern && baseline.cpuPattern) {
      const cpuDeviation = Math.abs(current.cpuPattern.mean - baseline.cpuPattern.mean) / baseline.cpuPattern.stdDev;
      if (cpuDeviation > 3) {
        anomalies.push({
          type: 'cpu_usage',
          score: Math.min(1, cpuDeviation / 5),
          description: `Abnormal CPU usage pattern`
        });
      }
    }
    
    return anomalies;
  }

  /**
   * Check if we should alert
   */
  shouldAlert(threat) {
    // Check cooldown period
    const recentAlerts = this.alertHistory.filter(
      a => a.threat.containerId === threat.containerId &&
           a.threat.type === threat.type &&
           Date.now() - a.timestamp.getTime() < this.config.alerting.cooldownPeriod
    );
    
    return recentAlerts.length === 0;
  }

  /**
   * Parse process list
   */
  parseProcessList(output) {
    const lines = output.split('\n').slice(1); // Skip header
    const processes = [];
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 11) {
        processes.push({
          user: parts[0],
          pid: parseInt(parts[1]),
          cpu: parseFloat(parts[2]),
          mem: parseFloat(parts[3]),
          command: parts.slice(10).join(' ')
        });
      }
    }
    
    return processes;
  }

  /**
   * Parse network connections
   */
  parseNetworkConnections(output) {
    const lines = output.split('\n').slice(2); // Skip headers
    const connections = [];
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const localAddr = parts[3];
        const port = parseInt(localAddr.split(':').pop());
        
        if (!isNaN(port)) {
          connections.push({
            protocol: parts[0],
            localAddress: localAddr,
            port,
            state: parts[5] || 'LISTEN'
          });
        }
      }
    }
    
    return connections;
  }

  /**
   * Calculate CPU usage
   */
  calculateCpuUsage(stats) {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || 1;
    
    if (systemDelta > 0) {
      return (cpuDelta / systemDelta) * cpuCount * 100;
    }
    
    return 0;
  }

  /**
   * Calculate memory usage
   */
  calculateMemoryUsage(stats) {
    const usage = stats.memory_stats.usage || 0;
    const limit = stats.memory_stats.limit || 1;
    return (usage / limit) * 100;
  }

  /**
   * Calculate disk I/O
   */
  calculateDiskIO(stats) {
    const ioStats = stats.blkio_stats?.io_service_bytes_recursive || [];
    let readBytes = 0;
    let writeBytes = 0;
    
    for (const stat of ioStats) {
      if (stat.op === 'read') readBytes = stat.value;
      if (stat.op === 'write') writeBytes = stat.value;
    }
    
    return {
      readBytes,
      writeBytes,
      readRate: 0, // Would need previous stats to calculate rate
      writeRate: 0
    };
  }

  /**
   * Stream to string
   */
  async streamToString(stream) {
    const chunks = [];
    return new Promise((resolve, reject) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
      stream.on('error', reject);
    });
  }

  /**
   * Generate threat ID
   */
  generateThreatId() {
    return `threat_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Load detection rules
   */
  async loadDetectionRules() {
    // This would load custom detection rules from file or database
    logger.debug('Loaded detection rules');
  }

  /**
   * Initialize anomaly detection
   */
  async initializeAnomalyDetection() {
    // This would initialize ML models for anomaly detection
    logger.info('Initialized anomaly detection models');
    
    // Start model update timer
    if (this.config.anomalyDetection.modelUpdateInterval > 0) {
      this.modelUpdateTimer = setInterval(() => {
        this.updateAnomalyModels().catch(err => 
          logger.error('Failed to update anomaly models:', err)
        );
      }, this.config.anomalyDetection.modelUpdateInterval);
    }
  }

  /**
   * Update anomaly models
   */
  async updateAnomalyModels() {
    // This would retrain ML models based on collected data
    logger.debug('Updated anomaly detection models');
  }

  /**
   * Start monitoring timer
   */
  startMonitoring() {
    this.monitoringTimer = setInterval(() => {
      this.performMonitoringCycle().catch(err => 
        logger.error('Monitoring cycle failed:', err)
      );
    }, this.config.monitoring.interval);
  }

  /**
   * Perform monitoring cycle
   */
  async performMonitoringCycle() {
    for (const [containerId] of this.monitoredContainers) {
      await this.performSecurityCheck(containerId);
    }
  }

  /**
   * Generate security report
   */
  async generateSecurityReport(containerId) {
    const monitoringData = this.monitoredContainers.get(containerId);
    if (!monitoringData) return null;
    
    return {
      containerId,
      jobId: monitoringData.jobId,
      monitoringDuration: Date.now() - monitoringData.startTime.getTime(),
      threatsDetected: monitoringData.threats.length,
      threats: monitoringData.threats,
      anomaliesDetected: monitoringData.anomalies.length,
      anomalies: monitoringData.anomalies,
      metrics: {
        avgCpuUsage: this.calculateAverage(monitoringData.metrics.resource.cpu.map(m => m.value)),
        avgMemoryUsage: this.calculateAverage(monitoringData.metrics.resource.memory.map(m => m.value)),
        processCount: monitoringData.metrics.processes.length,
        networkConnections: monitoringData.metrics.network.connections.length
      }
    };
  }

  /**
   * Calculate average
   */
  calculateAverage(values) {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Get runtime monitor statistics
   */
  getStatistics() {
    return {
      ...this.stats,
      activeContainers: this.monitoredContainers.size,
      totalThreats: this.detectedThreats.size,
      recentAlerts: this.alertHistory.slice(-10),
      configuration: {
        monitoring: this.config.monitoring,
        anomalyDetection: this.config.anomalyDetection.enabled,
        responseActions: this.config.responseActions
      }
    };
  }

  /**
   * Stop the runtime monitor
   */
  async stop() {
    logger.info('Stopping Runtime Security Monitor');
    
    // Clear timers
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    if (this.modelUpdateTimer) {
      clearInterval(this.modelUpdateTimer);
      this.modelUpdateTimer = null;
    }
    
    // Stop monitoring all containers
    for (const [containerId] of this.monitoredContainers) {
      await this.stopContainerMonitoring(containerId);
    }
    
    this.emit('stopped');
    logger.info('Runtime Security Monitor stopped');
  }
}

module.exports = RuntimeSecurityMonitor;