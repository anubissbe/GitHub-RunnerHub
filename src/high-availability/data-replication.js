/**
 * Data Replication Manager
 * 
 * Manages multi-region data replication with consistency guarantees
 * for PostgreSQL, Redis, and file storage systems.
 */

const EventEmitter = require('events');
const { Client } = require('pg');
const Redis = require('ioredis');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class DataReplicationManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      postgresql: {
        primary: options.postgresql?.primary || {
          host: 'localhost',
          port: 5432,
          database: 'github_runnerhub',
          user: 'postgres',
          password: 'password'
        },
        replicas: options.postgresql?.replicas || [],
        replicationLag: options.postgresql?.replicationLag || 5000,
        healthCheckInterval: options.postgresql?.healthCheckInterval || 10000
      },
      redis: {
        primary: options.redis?.primary || { host: 'localhost', port: 6379 },
        sentinels: options.redis?.sentinels || [],
        masterName: options.redis?.masterName || 'mymaster',
        healthCheckInterval: options.redis?.healthCheckInterval || 5000
      },
      fileStorage: {
        primaryPath: options.fileStorage?.primaryPath || '/opt/data/primary',
        replicaPaths: options.fileStorage?.replicaPaths || [],
        syncInterval: options.fileStorage?.syncInterval || 60000,
        compressionEnabled: options.fileStorage?.compressionEnabled || true
      },
      replicationTimeout: options.replicationTimeout || 30000,
      maxRetries: options.maxRetries || 3,
      ...options
    };
    
    this.clients = {
      postgresql: {
        primary: null,
        replicas: []
      },
      redis: {
        primary: null,
        sentinels: []
      }
    };
    
    this.state = {
      status: 'initializing',
      postgresql: {
        primaryHealthy: false,
        replicasHealthy: [],
        replicationLag: {},
        lastCheck: null
      },
      redis: {
        primaryHealthy: false,
        sentinelsHealthy: [],
        lastCheck: null
      },
      fileStorage: {
        primaryHealthy: false,
        replicasHealthy: [],
        lastSync: null,
        syncErrors: []
      },
      totalReplications: 0,
      failedReplications: 0
    };
    
    this.monitoringTimers = new Map();
    this.logger = options.logger || console;
  }
  
  /**
   * Initialize the data replication manager
   */
  async initialize() {
    try {
      this.logger.info('Initializing data replication manager');
      
      await this.initializePostgreSQL();
      await this.initializeRedis();
      await this.initializeFileStorage();
      
      this.startMonitoring();
      
      this.state.status = 'active';
      this.emit('initialized');
      
      this.logger.info('Data replication manager initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize data replication manager', error);
      throw error;
    }
  }
  
  /**
   * Initialize PostgreSQL replication
   */
  async initializePostgreSQL() {
    try {
      // Connect to primary database
      this.clients.postgresql.primary = new Client(this.config.postgresql.primary);
      await this.clients.postgresql.primary.connect();
      
      // Verify primary is in recovery mode (should be false for primary)
      const primaryResult = await this.clients.postgresql.primary.query('SELECT pg_is_in_recovery()');
      if (primaryResult.rows[0].pg_is_in_recovery) {
        throw new Error('Primary PostgreSQL instance is in recovery mode');
      }
      
      this.logger.info('Connected to PostgreSQL primary', {
        host: this.config.postgresql.primary.host,
        database: this.config.postgresql.primary.database
      });
      
      // Connect to replica databases
      for (let i = 0; i < this.config.postgresql.replicas.length; i++) {
        const replicaConfig = this.config.postgresql.replicas[i];
        const replica = new Client(replicaConfig);
        
        try {
          await replica.connect();
          
          // Verify replica is in recovery mode
          const replicaResult = await replica.query('SELECT pg_is_in_recovery()');
          if (!replicaResult.rows[0].pg_is_in_recovery) {
            this.logger.warn('Replica is not in recovery mode', { replica: replicaConfig.host });
          }
          
          this.clients.postgresql.replicas.push(replica);
          this.state.postgresql.replicasHealthy.push(true);
          
          this.logger.info('Connected to PostgreSQL replica', {
            host: replicaConfig.host,
            database: replicaConfig.database
          });
          
        } catch (error) {
          this.logger.error('Failed to connect to PostgreSQL replica', {
            replica: replicaConfig.host,
            error: error.message
          });
          this.state.postgresql.replicasHealthy.push(false);
        }
      }
      
      this.state.postgresql.primaryHealthy = true;
      
    } catch (error) {
      this.logger.error('Failed to initialize PostgreSQL replication', error);
      throw error;
    }
  }
  
  /**
   * Initialize Redis replication with Sentinel
   */
  async initializeRedis() {
    try {
      // Connect to Redis Sentinels
      for (const sentinelConfig of this.config.redis.sentinels) {
        const sentinel = new Redis(sentinelConfig);
        
        try {
          await sentinel.ping();
          this.clients.redis.sentinels.push(sentinel);
          this.state.redis.sentinelsHealthy.push(true);
          
          this.logger.info('Connected to Redis Sentinel', {
            host: sentinelConfig.host,
            port: sentinelConfig.port
          });
          
        } catch (error) {
          this.logger.error('Failed to connect to Redis Sentinel', {
            sentinel: sentinelConfig,
            error: error.message
          });
          this.state.redis.sentinelsHealthy.push(false);
        }
      }
      
      // Connect to Redis primary through Sentinel
      if (this.clients.redis.sentinels.length > 0) {
        this.clients.redis.primary = new Redis({
          sentinels: this.config.redis.sentinels,
          name: this.config.redis.masterName,
          retryDelayOnFailover: 1000,
          maxRetriesPerRequest: 3
        });
        
        await this.clients.redis.primary.ping();
        this.state.redis.primaryHealthy = true;
        
        this.logger.info('Connected to Redis primary through Sentinel');
      } else {
        // Fallback to direct connection
        this.clients.redis.primary = new Redis(this.config.redis.primary);
        await this.clients.redis.primary.ping();
        this.state.redis.primaryHealthy = true;
        
        this.logger.info('Connected to Redis primary directly');
      }
      
    } catch (error) {
      this.logger.error('Failed to initialize Redis replication', error);
      throw error;
    }
  }
  
  /**
   * Initialize file storage replication
   */
  async initializeFileStorage() {
    try {
      // Ensure primary storage directory exists
      await fs.mkdir(this.config.fileStorage.primaryPath, { recursive: true });
      
      // Check primary storage health
      await fs.access(this.config.fileStorage.primaryPath, fs.constants.R_OK | fs.constants.W_OK);
      this.state.fileStorage.primaryHealthy = true;
      
      this.logger.info('Primary file storage initialized', {
        path: this.config.fileStorage.primaryPath
      });
      
      // Initialize replica storage paths
      for (const replicaPath of this.config.fileStorage.replicaPaths) {
        try {
          await fs.mkdir(replicaPath, { recursive: true });
          await fs.access(replicaPath, fs.constants.R_OK | fs.constants.W_OK);
          this.state.fileStorage.replicasHealthy.push(true);
          
          this.logger.info('Replica file storage initialized', { path: replicaPath });
          
        } catch (error) {
          this.logger.error('Failed to initialize replica file storage', {
            path: replicaPath,
            error: error.message
          });
          this.state.fileStorage.replicasHealthy.push(false);
        }
      }
      
    } catch (error) {
      this.logger.error('Failed to initialize file storage replication', error);
      throw error;
    }
  }
  
  /**
   * Start monitoring replication health
   */
  startMonitoring() {
    // PostgreSQL monitoring
    const pgTimer = setInterval(async () => {
      await this.checkPostgreSQLReplication();
    }, this.config.postgresql.healthCheckInterval);
    this.monitoringTimers.set('postgresql', pgTimer);
    
    // Redis monitoring
    const redisTimer = setInterval(async () => {
      await this.checkRedisReplication();
    }, this.config.redis.healthCheckInterval);
    this.monitoringTimers.set('redis', redisTimer);
    
    // File storage monitoring
    const fileTimer = setInterval(async () => {
      await this.syncFileStorage();
    }, this.config.fileStorage.syncInterval);
    this.monitoringTimers.set('fileStorage', fileTimer);
    
    this.logger.info('Started replication monitoring');
  }
  
  /**
   * Check PostgreSQL replication health and lag
   */
  async checkPostgreSQLReplication() {
    try {
      this.state.postgresql.lastCheck = Date.now();
      
      // Check primary health
      try {
        await this.clients.postgresql.primary.query('SELECT 1');
        this.state.postgresql.primaryHealthy = true;
      } catch (error) {
        this.state.postgresql.primaryHealthy = false;
        this.logger.error('PostgreSQL primary health check failed', error);
        return;
      }
      
      // Get current WAL position from primary
      const walResult = await this.clients.postgresql.primary.query(
        'SELECT pg_current_wal_lsn() as current_lsn'
      );
      const primaryLSN = walResult.rows[0].current_lsn;
      
      // Check each replica
      for (let i = 0; i < this.clients.postgresql.replicas.length; i++) {
        const replica = this.clients.postgresql.replicas[i];
        
        try {
          // Check replica health
          await replica.query('SELECT 1');
          this.state.postgresql.replicasHealthy[i] = true;
          
          // Get replica WAL position
          const replicaResult = await replica.query(
            'SELECT pg_last_wal_receive_lsn() as receive_lsn, pg_last_wal_replay_lsn() as replay_lsn'
          );
          
          const receiveLSN = replicaResult.rows[0].receive_lsn;
          const replayLSN = replicaResult.rows[0].replay_lsn;
          
          // Calculate replication lag
          const lagResult = await this.clients.postgresql.primary.query(
            'SELECT EXTRACT(EPOCH FROM (pg_current_timestamp() - pg_last_xact_replay_timestamp())) as lag',
            []
          );
          
          const lag = lagResult.rows[0]?.lag || 0;
          this.state.postgresql.replicationLag[`replica_${i}`] = lag * 1000; // Convert to milliseconds
          
          if (lag * 1000 > this.config.postgresql.replicationLag) {
            this.logger.warn('PostgreSQL replication lag detected', {
              replica: i,
              lag: lag * 1000,
              threshold: this.config.postgresql.replicationLag
            });
            
            this.emit('replicationLag', {
              type: 'postgresql',
              replica: i,
              lag: lag * 1000
            });
          }
          
        } catch (error) {
          this.state.postgresql.replicasHealthy[i] = false;
          this.logger.error('PostgreSQL replica health check failed', {
            replica: i,
            error: error.message
          });
        }
      }
      
    } catch (error) {
      this.logger.error('PostgreSQL replication check failed', error);
    }
  }
  
  /**
   * Check Redis replication health
   */
  async checkRedisReplication() {
    try {
      this.state.redis.lastCheck = Date.now();
      
      // Check primary health
      try {
        await this.clients.redis.primary.ping();
        this.state.redis.primaryHealthy = true;
      } catch (error) {
        this.state.redis.primaryHealthy = false;
        this.logger.error('Redis primary health check failed', error);
        return;
      }
      
      // Check Sentinel health
      for (let i = 0; i < this.clients.redis.sentinels.length; i++) {
        const sentinel = this.clients.redis.sentinels[i];
        
        try {
          await sentinel.ping();
          this.state.redis.sentinelsHealthy[i] = true;
          
          // Get master info from Sentinel
          const masterInfo = await sentinel.sentinel('masters');
          const master = masterInfo.find(m => m[1] === this.config.redis.masterName);
          
          if (master) {
            const flags = master[9];
            if (flags.includes('down') || flags.includes('s_down') || flags.includes('o_down')) {
              this.logger.warn('Redis master marked as down by Sentinel', {
                sentinel: i,
                flags
              });
            }
          }
          
        } catch (error) {
          this.state.redis.sentinelsHealthy[i] = false;
          this.logger.error('Redis Sentinel health check failed', {
            sentinel: i,
            error: error.message
          });
        }
      }
      
    } catch (error) {
      this.logger.error('Redis replication check failed', error);
    }
  }
  
  /**
   * Synchronize file storage across replicas
   */
  async syncFileStorage() {
    try {
      this.state.fileStorage.lastSync = Date.now();
      
      // Check primary storage health
      try {
        await fs.access(this.config.fileStorage.primaryPath, fs.constants.R_OK);
        this.state.fileStorage.primaryHealthy = true;
      } catch (error) {
        this.state.fileStorage.primaryHealthy = false;
        this.logger.error('Primary file storage health check failed', error);
        return;
      }
      
      // Sync to each replica
      for (let i = 0; i < this.config.fileStorage.replicaPaths.length; i++) {
        const replicaPath = this.config.fileStorage.replicaPaths[i];
        
        try {
          await this.syncDirectories(this.config.fileStorage.primaryPath, replicaPath);
          this.state.fileStorage.replicasHealthy[i] = true;
          
        } catch (error) {
          this.state.fileStorage.replicasHealthy[i] = false;
          this.state.fileStorage.syncErrors.push({
            replica: i,
            path: replicaPath,
            error: error.message,
            timestamp: Date.now()
          });
          
          this.logger.error('File storage sync failed', {
            replica: i,
            path: replicaPath,
            error: error.message
          });
        }
      }
      
      // Keep only recent sync errors
      this.state.fileStorage.syncErrors = this.state.fileStorage.syncErrors
        .filter(err => Date.now() - err.timestamp < 3600000); // Last hour
      
    } catch (error) {
      this.logger.error('File storage sync failed', error);
    }
  }
  
  /**
   * Sync directories recursively
   */
  async syncDirectories(sourcePath, targetPath) {
    const sourceStats = await fs.stat(sourcePath);
    
    if (sourceStats.isDirectory()) {
      // Ensure target directory exists
      await fs.mkdir(targetPath, { recursive: true });
      
      // Get source directory contents
      const sourceFiles = await fs.readdir(sourcePath);
      const targetFiles = await fs.readdir(targetPath).catch(() => []);
      
      // Sync each file/directory
      for (const file of sourceFiles) {
        const sourceFilePath = path.join(sourcePath, file);
        const targetFilePath = path.join(targetPath, file);
        
        await this.syncDirectories(sourceFilePath, targetFilePath);
      }
      
      // Remove files that don't exist in source
      for (const file of targetFiles) {
        if (!sourceFiles.includes(file)) {
          const targetFilePath = path.join(targetPath, file);
          await fs.rm(targetFilePath, { recursive: true, force: true });
          this.logger.debug('Removed file from replica', { file: targetFilePath });
        }
      }
      
    } else {
      // Sync individual file
      const sourceContent = await fs.readFile(sourcePath);
      const sourceHash = crypto.createHash('sha256').update(sourceContent).digest('hex');
      
      let needsSync = true;
      
      try {
        const targetContent = await fs.readFile(targetPath);
        const targetHash = crypto.createHash('sha256').update(targetContent).digest('hex');
        needsSync = sourceHash !== targetHash;
      } catch {
        // Target file doesn't exist or can't be read
        needsSync = true;
      }
      
      if (needsSync) {
        await fs.writeFile(targetPath, sourceContent);
        this.logger.debug('Synced file to replica', { file: targetPath });
      }
    }
  }
  
  /**
   * Perform failover to replica database
   */
  async failoverToReplica(replicaIndex = 0) {
    try {
      this.logger.info('Performing database failover', { replica: replicaIndex });
      
      if (replicaIndex >= this.clients.postgresql.replicas.length) {
        throw new Error('Invalid replica index');
      }
      
      const replica = this.clients.postgresql.replicas[replicaIndex];
      
      // Promote replica to primary
      await replica.query('SELECT pg_promote()');
      
      // Wait for promotion to complete
      let promoted = false;
      for (let i = 0; i < 30; i++) {
        const result = await replica.query('SELECT pg_is_in_recovery()');
        if (!result.rows[0].pg_is_in_recovery) {
          promoted = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (!promoted) {
        throw new Error('Replica promotion timeout');
      }
      
      // Update primary client
      this.clients.postgresql.primary = replica;
      this.clients.postgresql.replicas.splice(replicaIndex, 1);
      this.state.postgresql.replicasHealthy.splice(replicaIndex, 1);
      
      this.logger.info('Database failover completed successfully');
      this.emit('failoverCompleted', { type: 'postgresql', newPrimary: replicaIndex });
      
      return { success: true, newPrimary: replicaIndex };
      
    } catch (error) {
      this.logger.error('Database failover failed', error);
      throw error;
    }
  }
  
  /**
   * Get replication status
   */
  getReplicationStatus() {
    return {
      status: this.state.status,
      postgresql: {
        primaryHealthy: this.state.postgresql.primaryHealthy,
        replicasHealthy: this.state.postgresql.replicasHealthy,
        replicationLag: this.state.postgresql.replicationLag,
        lastCheck: this.state.postgresql.lastCheck,
        totalReplicas: this.clients.postgresql.replicas.length
      },
      redis: {
        primaryHealthy: this.state.redis.primaryHealthy,
        sentinelsHealthy: this.state.redis.sentinelsHealthy,
        lastCheck: this.state.redis.lastCheck,
        totalSentinels: this.clients.redis.sentinels.length
      },
      fileStorage: {
        primaryHealthy: this.state.fileStorage.primaryHealthy,
        replicasHealthy: this.state.fileStorage.replicasHealthy,
        lastSync: this.state.fileStorage.lastSync,
        syncErrors: this.state.fileStorage.syncErrors.length,
        totalReplicas: this.config.fileStorage.replicaPaths.length
      },
      totalReplications: this.state.totalReplications,
      failedReplications: this.state.failedReplications
    };
  }
  
  /**
   * Stop replication monitoring
   */
  stop() {
    // Clear all monitoring timers
    for (const [name, timer] of this.monitoringTimers) {
      clearInterval(timer);
    }
    this.monitoringTimers.clear();
    
    // Close database connections
    if (this.clients.postgresql.primary) {
      this.clients.postgresql.primary.end();
    }
    
    for (const replica of this.clients.postgresql.replicas) {
      replica.end();
    }
    
    // Close Redis connections
    if (this.clients.redis.primary) {
      this.clients.redis.primary.quit();
    }
    
    for (const sentinel of this.clients.redis.sentinels) {
      sentinel.quit();
    }
    
    this.state.status = 'stopped';
    this.emit('stopped');
    
    this.logger.info('Data replication manager stopped');
  }
}

module.exports = DataReplicationManager;