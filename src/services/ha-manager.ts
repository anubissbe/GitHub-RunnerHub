/**
 * High Availability Manager for GitHub RunnerHub
 * 
 * This service coordinates all HA components including leader election,
 * health monitoring, failover detection, and service coordination.
 */

import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { createLogger } from '../utils/logger';
import { config } from '../config';
import LeaderElectionService from './leader-election';
import HAHealthCheckService from './ha-health-check';
import { createGeneralConnection } from './redis-connection';

export interface HAStatus {
    enabled: boolean;
    nodeId: string;
    isLeader: boolean;
    currentLeader: string | null;
    healthStatus: 'healthy' | 'degraded' | 'unhealthy';
    lastHealthCheck: Date | null;
    uptimeSeconds: number;
    services: {
        leaderElection: boolean;
        healthMonitoring: boolean;
        databaseHA: boolean;
        redisHA: boolean;
    };
}

export interface FailoverEvent {
    type: 'database' | 'redis' | 'orchestrator' | 'loadbalancer';
    from: string;
    to: string;
    timestamp: Date;
    reason: string;
    details?: Record<string, any>;
}

export class HAManager extends EventEmitter {
    private logger: any;
    private isInitialized = false;
    private isShuttingDown = false;
    private startTime: Date;
    
    // HA Services
    private leaderElection?: LeaderElectionService;
    private healthCheck?: HAHealthCheckService;
    
    // Database connections
    private primaryDb?: Pool;
    private replicaDb?: Pool;
    private currentDbPool?: Pool;
    
    // Redis connections
    private redisClient?: Redis;
    private redisSentinel?: Redis;
    
    // Status tracking
    private isLeader = false;
    private currentLeader: string | null = null;
    private lastHealthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    private lastHealthCheck: Date | null = null;

    constructor() {
        super();
        this.logger = createLogger('HAManager');
        this.startTime = new Date();
        
        this.logger.info('HA Manager initialized', {
            enabled: config.ha.enabled,
            nodeId: config.ha.nodeId,
            clusterNodes: config.ha.clusterNodes
        });
    }

    /**
     * Initialize HA Manager and all HA services
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            this.logger.warn('HA Manager already initialized');
            return;
        }

        if (!config.ha.enabled) {
            this.logger.info('HA is disabled, running in single-node mode');
            await this.initializeSingleNodeMode();
            return;
        }

        this.logger.info('Initializing HA Manager', {
            nodeId: config.ha.nodeId,
            clusterNodes: config.ha.clusterNodes
        });

        try {
            // Initialize database connections
            await this.initializeDatabaseConnections();
            
            // Initialize Redis connections
            await this.initializeRedisConnections();
            
            // Initialize health monitoring
            await this.initializeHealthMonitoring();
            
            // Initialize leader election
            await this.initializeLeaderElection();
            
            // Set up event handlers
            this.setupEventHandlers();
            
            this.isInitialized = true;
            this.logger.info('HA Manager initialized successfully');
            
            this.emit('ha:initialized', {
                nodeId: config.ha.nodeId,
                timestamp: new Date()
            });
            
        } catch (error) {
            this.logger.error('Failed to initialize HA Manager', { error });
            throw error;
        }
    }

    /**
     * Initialize single-node mode (no HA)
     */
    private async initializeSingleNodeMode(): Promise<void> {
        this.logger.info('Initializing single-node mode');
        
        // Initialize basic database connection
        this.primaryDb = new Pool({
            connectionString: config.database.url,
            max: config.ha.database.connectionPoolSize,
            idleTimeoutMillis: 30000
        });
        
        this.currentDbPool = this.primaryDb;
        
        // Initialize basic Redis connection
        this.redisClient = createGeneralConnection();
        
        this.isLeader = true; // In single-node mode, we're always the leader
        this.isInitialized = true;
        
        this.emit('ha:single-node-initialized', {
            nodeId: config.ha.nodeId,
            timestamp: new Date()
        });
    }

    /**
     * Initialize database connections with HA support
     */
    private async initializeDatabaseConnections(): Promise<void> {
        this.logger.info('Initializing database connections');
        
        // Primary database connection
        this.primaryDb = new Pool({
            connectionString: config.database.url,
            max: config.ha.database.connectionPoolSize,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        });
        
        // Replica database connection (if configured)
        if (config.ha.database.replicaUrl && config.ha.database.enableReadReplica) {
            this.replicaDb = new Pool({
                connectionString: config.ha.database.replicaUrl,
                max: Math.floor(config.ha.database.connectionPoolSize / 2),
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000
            });
            
            this.logger.info('Replica database connection configured');
        }
        
        // Start with primary as current connection
        this.currentDbPool = this.primaryDb;
        
        // Test connections
        await this.testDatabaseConnections();
    }

    /**
     * Test database connections
     */
    private async testDatabaseConnections(): Promise<void> {
        try {
            // Test primary connection
            const primaryClient = await this.primaryDb!.connect();
            await primaryClient.query('SELECT 1');
            primaryClient.release();
            this.logger.info('Primary database connection tested successfully');
            
            // Test replica connection if available
            if (this.replicaDb) {
                const replicaClient = await this.replicaDb.connect();
                await replicaClient.query('SELECT 1');
                replicaClient.release();
                this.logger.info('Replica database connection tested successfully');
            }
        } catch (error) {
            this.logger.error('Database connection test failed', { error });
            throw error;
        }
    }

    /**
     * Initialize Redis connections with Sentinel support
     */
    private async initializeRedisConnections(): Promise<void> {
        this.logger.info('Initializing Redis connections');
        
        // Use HA-aware Redis connection service
        this.redisClient = createGeneralConnection();
        
        if (config.ha.redis.enableSentinel && config.ha.redis.sentinelHosts.length > 0) {
            this.redisSentinel = this.redisClient;
            this.logger.info('Redis Sentinel connection configured via connection service', {
                sentinels: config.ha.redis.sentinelHosts,
                masterName: config.ha.redis.masterName
            });
        } else {
            this.logger.info('Direct Redis connection configured via connection service');
        }
        
        // Test Redis connection
        await this.testRedisConnection();
    }

    /**
     * Test Redis connection
     */
    private async testRedisConnection(): Promise<void> {
        try {
            const pong = await this.redisClient!.ping();
            if (pong === 'PONG') {
                this.logger.info('Redis connection tested successfully');
            } else {
                throw new Error(`Unexpected Redis ping response: ${pong}`);
            }
        } catch (error) {
            this.logger.error('Redis connection test failed', { error });
            throw error;
        }
    }

    /**
     * Initialize health monitoring
     */
    private async initializeHealthMonitoring(): Promise<void> {
        this.logger.info('Initializing health monitoring');
        
        this.healthCheck = new HAHealthCheckService({
            checkInterval: config.ha.healthCheck.interval,
            timeout: config.ha.healthCheck.timeout,
            retryCount: config.ha.healthCheck.retryCount,
            alertThreshold: config.ha.healthCheck.alertThreshold
        });
        
        await this.healthCheck.startMonitoring();
        this.logger.info('Health monitoring started');
    }

    /**
     * Initialize leader election
     */
    private async initializeLeaderElection(): Promise<void> {
        if (!config.ha.leaderElection.enabled) {
            this.logger.info('Leader election disabled');
            this.isLeader = true; // Assume leadership if election is disabled
            return;
        }
        
        this.logger.info('Initializing leader election');
        
        this.leaderElection = new LeaderElectionService(this.redisClient!, {
            nodeId: config.ha.nodeId,
            lockKey: config.ha.leaderElection.lockKey,
            lockTTL: config.ha.leaderElection.lockTTL,
            renewalInterval: config.ha.leaderElection.renewalInterval,
            retryInterval: config.ha.leaderElection.retryInterval,
            maxRetries: config.ha.leaderElection.maxRetries
        });
        
        await this.leaderElection.startElection();
        this.logger.info('Leader election started');
    }

    /**
     * Set up event handlers for HA services
     */
    private setupEventHandlers(): void {
        // Leader election events
        if (this.leaderElection) {
            this.leaderElection.on('leadership:acquired', (data) => {
                this.isLeader = true;
                this.currentLeader = data.nodeId;
                this.logger.info('Leadership acquired', data);
                this.emit('ha:leadership:acquired', data);
                this.onLeadershipChange(true);
            });
            
            this.leaderElection.on('leadership:lost', (data) => {
                this.isLeader = false;
                this.logger.warn('Leadership lost', data);
                this.emit('ha:leadership:lost', data);
                this.onLeadershipChange(false);
            });
            
            this.leaderElection.on('leadership:changed', (data) => {
                this.currentLeader = data.newLeader;
                this.logger.info('Leadership changed', data);
                this.emit('ha:leadership:changed', data);
            });
        }
        
        // Health check events
        if (this.healthCheck) {
            this.healthCheck.on('health:checked', (health) => {
                this.lastHealthStatus = health.overall.status;
                this.lastHealthCheck = health.overall.timestamp;
                this.emit('ha:health:checked', health);
            });
            
            this.healthCheck.on('health:alert', (alert) => {
                this.logger.warn('Health alert', alert);
                this.emit('ha:health:alert', alert);
                this.handleHealthAlert(alert);
            });
            
            this.healthCheck.on('health:recovery', (recovery) => {
                this.logger.info('Health recovery', recovery);
                this.emit('ha:health:recovery', recovery);
            });
        }
        
        // Redis failover events
        if (this.redisSentinel) {
            this.redisSentinel.on('failover', (data) => {
                this.logger.warn('Redis failover detected', data);
                this.handleRedisFailover(data);
            });
        }
    }

    /**
     * Handle leadership change
     */
    private onLeadershipChange(isLeader: boolean): void {
        if (isLeader) {
            this.logger.info('Became leader - starting leader-only services');
            // Start services that should only run on the leader
            this.startLeaderServices();
        } else {
            this.logger.info('Lost leadership - stopping leader-only services');
            // Stop services that should only run on the leader
            this.stopLeaderServices();
        }
    }

    /**
     * Start services that should only run on the leader
     */
    private startLeaderServices(): void {
        // These services should only run on the leader to avoid conflicts
        // For example: cleanup jobs, monitoring aggregation, etc.
        this.logger.info('Starting leader-only services');
        
        this.emit('ha:leader-services:start', {
            nodeId: config.ha.nodeId,
            timestamp: new Date()
        });
    }

    /**
     * Stop services that should only run on the leader
     */
    private stopLeaderServices(): void {
        this.logger.info('Stopping leader-only services');
        
        this.emit('ha:leader-services:stop', {
            nodeId: config.ha.nodeId,
            timestamp: new Date()
        });
    }

    /**
     * Handle health alerts
     */
    private handleHealthAlert(alert: any): void {
        this.logger.warn('Handling health alert', alert);
        
        // Implement specific failover logic based on component
        switch (alert.component) {
            case 'database.primary':
                this.handleDatabaseFailover();
                break;
            case 'redis.master':
                this.handleRedisFailover(alert);
                break;
            default:
                this.logger.info('No specific failover action for component', { component: alert.component });
        }
    }

    /**
     * Handle database failover
     */
    private async handleDatabaseFailover(): Promise<void> {
        if (!this.replicaDb) {
            this.logger.error('Database failover requested but no replica configured');
            return;
        }
        
        this.logger.warn('Initiating database failover to replica');
        
        try {
            // Test replica connection
            const replicaClient = await this.replicaDb.connect();
            await replicaClient.query('SELECT 1');
            replicaClient.release();
            
            // Switch to replica
            this.currentDbPool = this.replicaDb;
            
            const failoverEvent: FailoverEvent = {
                type: 'database',
                from: 'primary',
                to: 'replica',
                timestamp: new Date(),
                reason: 'Primary database health check failed'
            };
            
            this.logger.warn('Database failover completed', failoverEvent);
            this.emit('ha:failover', failoverEvent);
            
        } catch (error) {
            this.logger.error('Database failover failed', { error });
            this.emit('ha:failover:failed', {
                type: 'database',
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date()
            });
        }
    }

    /**
     * Handle Redis failover
     */
    private handleRedisFailover(data: any): void {
        const failoverEvent: FailoverEvent = {
            type: 'redis',
            from: data.oldMaster || 'unknown',
            to: data.newMaster || 'unknown',
            timestamp: new Date(),
            reason: 'Redis Sentinel initiated failover',
            details: data
        };
        
        this.logger.warn('Redis failover completed', failoverEvent);
        this.emit('ha:failover', failoverEvent);
    }

    /**
     * Get current HA status
     */
    getStatus(): HAStatus {
        const uptimeSeconds = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
        
        return {
            enabled: config.ha.enabled,
            nodeId: config.ha.nodeId,
            isLeader: this.isLeader,
            currentLeader: this.currentLeader,
            healthStatus: this.lastHealthStatus,
            lastHealthCheck: this.lastHealthCheck,
            uptimeSeconds,
            services: {
                leaderElection: !!this.leaderElection && config.ha.leaderElection.enabled,
                healthMonitoring: !!this.healthCheck,
                databaseHA: !!this.replicaDb && config.ha.database.enableReadReplica,
                redisHA: config.ha.redis.enableSentinel
            }
        };
    }

    /**
     * Get database connection pool
     */
    getDatabasePool(): Pool {
        if (!this.currentDbPool) {
            throw new Error('Database not initialized');
        }
        return this.currentDbPool;
    }

    /**
     * Get Redis client
     */
    getRedisClient(): Redis {
        if (!this.redisClient) {
            throw new Error('Redis not initialized');
        }
        return this.redisClient;
    }

    /**
     * Force leadership election
     */
    async forceElection(): Promise<void> {
        if (this.leaderElection) {
            await this.leaderElection.forceElection();
        } else {
            this.logger.warn('Cannot force election - leader election not enabled');
        }
    }

    /**
     * Force health check
     */
    async forceHealthCheck(): Promise<any> {
        if (this.healthCheck) {
            return await this.healthCheck.forceHealthCheck();
        } else {
            this.logger.warn('Cannot force health check - health monitoring not enabled');
            return null;
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }
        
        this.isShuttingDown = true;
        this.logger.info('Shutting down HA Manager');
        
        try {
            // Stop leader election
            if (this.leaderElection) {
                await this.leaderElection.stopElection();
            }
            
            // Stop health monitoring
            if (this.healthCheck) {
                await this.healthCheck.stopMonitoring();
            }
            
            // Close database connections
            if (this.primaryDb) {
                await this.primaryDb.end();
            }
            if (this.replicaDb) {
                await this.replicaDb.end();
            }
            
            // Close Redis connections
            if (this.redisClient) {
                this.redisClient.disconnect();
            }
            
            this.logger.info('HA Manager shutdown completed');
            this.emit('ha:shutdown', {
                nodeId: config.ha.nodeId,
                timestamp: new Date()
            });
            
        } catch (error) {
            this.logger.error('Error during HA Manager shutdown', { error });
            throw error;
        }
    }
}

export default HAManager;