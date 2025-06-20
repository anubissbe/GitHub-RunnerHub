/**
 * High Availability Database Service for GitHub RunnerHub
 * 
 * This service provides automatic failover support for PostgreSQL primary/replica
 * configurations with health monitoring and connection management.
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { config } from '../config';

export interface DatabaseHealth {
    primary: {
        status: 'healthy' | 'degraded' | 'unhealthy';
        isStandby: boolean;
        connections: number;
        lagSeconds?: number;
        lastCheck: Date;
        error?: string;
    };
    replica: {
        status: 'healthy' | 'degraded' | 'unhealthy';
        isStandby: boolean;
        connections: number;
        lagSeconds?: number;
        lastCheck: Date;
        error?: string;
    };
    overall: 'healthy' | 'degraded' | 'unhealthy';
}

export interface DatabaseMetrics {
    primaryConnections: number;
    replicaConnections: number;
    replicationLagBytes: number;
    replicationLagSeconds: number;
    failoverCount: number;
    lastFailover?: Date;
    uptime: number;
}

export interface FailoverEvent {
    timestamp: Date;
    reason: string;
    fromPool: 'primary' | 'replica';
    toPool: 'primary' | 'replica';
    success: boolean;
    duration?: number;
    error?: string;
}

export class DatabaseHAService extends EventEmitter {
    private logger: any;
    private primaryPool?: Pool;
    private replicaPool?: Pool;
    private currentWritePool?: Pool;
    private currentReadPool?: Pool;
    private healthCheckInterval?: NodeJS.Timer;
    private isShuttingDown = false;
    private failoverCount = 0;
    private lastFailover?: Date;
    private startTime = new Date();

    constructor() {
        super();
        this.logger = createLogger('DatabaseHA');
    }

    /**
     * Initialize database connections with HA support
     */
    async initialize(): Promise<void> {
        this.logger.info('Initializing Database HA service');

        try {
            // Create primary pool
            await this.createPrimaryPool();

            // Create replica pool if configured
            if (config.ha.database.replicaUrl && config.ha.database.enableReadReplica) {
                await this.createReplicaPool();
            }

            // Set initial active pools
            this.currentWritePool = this.primaryPool;
            this.currentReadPool = this.replicaPool || this.primaryPool;

            // Test connections
            await this.testConnections();

            // Start health monitoring
            this.startHealthMonitoring();

            this.logger.info('Database HA service initialized successfully');
            this.emit('initialized');

        } catch (error) {
            this.logger.error('Failed to initialize Database HA service', { error });
            throw error;
        }
    }

    /**
     * Create primary database pool
     */
    private async createPrimaryPool(): Promise<void> {
        const poolConfig: PoolConfig = {
            connectionString: config.database.url,
            max: config.ha.database.connectionPoolSize || 20,
            min: 2,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            statement_timeout: 30000,
            query_timeout: 30000,
            application_name: 'runnerhub-primary'
        };

        this.primaryPool = new Pool(poolConfig);

        // Set up pool event handlers
        this.primaryPool.on('connect', (_client) => {
            this.logger.debug('Primary pool: New client connected');
        });

        this.primaryPool.on('error', (err, _client) => {
            this.logger.error('Primary pool: Client error', { error: err.message });
            this.emit('primary:error', err);
        });

        this.primaryPool.on('remove', () => {
            this.logger.debug('Primary pool: Client removed');
        });

        this.logger.info('Primary database pool created');
    }

    /**
     * Create replica database pool
     */
    private async createReplicaPool(): Promise<void> {
        if (!config.ha.database.replicaUrl) {
            return;
        }

        const poolConfig: PoolConfig = {
            connectionString: config.ha.database.replicaUrl,
            max: Math.floor(config.ha.database.connectionPoolSize / 2) || 10,
            min: 1,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            statement_timeout: 30000,
            query_timeout: 30000,
            application_name: 'runnerhub-replica'
        };

        this.replicaPool = new Pool(poolConfig);

        // Set up pool event handlers
        this.replicaPool.on('connect', (_client) => {
            this.logger.debug('Replica pool: New client connected');
        });

        this.replicaPool.on('error', (err, _client) => {
            this.logger.error('Replica pool: Client error', { error: err.message });
            this.emit('replica:error', err);
        });

        this.replicaPool.on('remove', () => {
            this.logger.debug('Replica pool: Client removed');
        });

        this.logger.info('Replica database pool created');
    }

    /**
     * Test database connections
     */
    private async testConnections(): Promise<void> {
        // Test primary connection
        if (this.primaryPool) {
            try {
                const client = await this.primaryPool.connect();
                await client.query('SELECT 1 as primary_test');
                client.release();
                this.logger.info('Primary database connection test successful');
            } catch (error) {
                this.logger.error('Primary database connection test failed', { error });
                throw error;
            }
        }

        // Test replica connection
        if (this.replicaPool) {
            try {
                const client = await this.replicaPool.connect();
                await client.query('SELECT 1 as replica_test');
                client.release();
                this.logger.info('Replica database connection test successful');
            } catch (error) {
                this.logger.warn('Replica database connection test failed', { error });
                // Don't throw for replica failures - we can fall back to primary
            }
        }
    }

    /**
     * Start health monitoring
     */
    private startHealthMonitoring(): void {
        const interval = config.ha.healthCheck?.interval || 30000;
        
        this.healthCheckInterval = setInterval(async () => {
            if (!this.isShuttingDown) {
                await this.performHealthCheck();
            }
        }, interval);

        this.logger.info('Database health monitoring started', { interval });
    }

    /**
     * Perform comprehensive health check
     */
    async performHealthCheck(): Promise<DatabaseHealth> {
        const startTime = Date.now();
        
        const health: DatabaseHealth = {
            primary: {
                status: 'unhealthy',
                isStandby: false,
                connections: 0,
                lastCheck: new Date()
            },
            replica: {
                status: 'unhealthy',
                isStandby: true,
                connections: 0,
                lastCheck: new Date()
            },
            overall: 'unhealthy'
        };

        // Check primary health
        if (this.primaryPool) {
            try {
                const client = await this.primaryPool.connect();
                
                try {
                    // Basic health check
                    await client.query('SELECT 1');
                    
                    // Check if it's a standby
                    const standbyResult = await client.query('SELECT pg_is_in_recovery()');
                    health.primary.isStandby = standbyResult.rows[0].pg_is_in_recovery;
                    
                    // Get connection count
                    const connResult = await client.query(
                        'SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = \'active\''
                    );
                    health.primary.connections = parseInt(connResult.rows[0].active_connections);
                    
                    // Check replication lag if this is primary
                    if (!health.primary.isStandby) {
                        const lagResult = await client.query(`
                            SELECT COALESCE(EXTRACT(EPOCH FROM (now() - reply_time)), 0) as lag_seconds
                            FROM pg_stat_replication 
                            LIMIT 1
                        `);
                        
                        if (lagResult.rows.length > 0) {
                            health.primary.lagSeconds = parseFloat(lagResult.rows[0].lag_seconds);
                        }
                    }
                    
                    health.primary.status = 'healthy';
                    
                } finally {
                    client.release();
                }
                
            } catch (error) {
                health.primary.error = error instanceof Error ? error.message : String(error);
                this.logger.error('Primary health check failed', { error });
            }
        }

        // Check replica health
        if (this.replicaPool) {
            try {
                const client = await this.replicaPool.connect();
                
                try {
                    // Basic health check
                    await client.query('SELECT 1');
                    
                    // Check if it's a standby
                    const standbyResult = await client.query('SELECT pg_is_in_recovery()');
                    health.replica.isStandby = standbyResult.rows[0].pg_is_in_recovery;
                    
                    // Get connection count
                    const connResult = await client.query(
                        'SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = \'active\''
                    );
                    health.replica.connections = parseInt(connResult.rows[0].active_connections);
                    
                    // Check replication lag if this is standby
                    if (health.replica.isStandby) {
                        const lagResult = await client.query(`
                            SELECT pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) as lag_bytes,
                                   EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) as lag_seconds
                        `);
                        
                        if (lagResult.rows.length > 0) {
                            health.replica.lagSeconds = parseFloat(lagResult.rows[0].lag_seconds || 0);
                        }
                    }
                    
                    health.replica.status = 'healthy';
                    
                } finally {
                    client.release();
                }
                
            } catch (error) {
                health.replica.error = error instanceof Error ? error.message : String(error);
                this.logger.error('Replica health check failed', { error });
            }
        }

        // Determine overall health
        if (health.primary.status === 'healthy' && 
            (!this.replicaPool || health.replica.status === 'healthy')) {
            health.overall = 'healthy';
        } else if (health.primary.status === 'healthy' || health.replica.status === 'healthy') {
            health.overall = 'degraded';
        } else {
            health.overall = 'unhealthy';
        }

        const duration = Date.now() - startTime;
        this.logger.debug('Health check completed', { 
            duration, 
            overall: health.overall,
            primaryStatus: health.primary.status,
            replicaStatus: health.replica.status
        });

        this.emit('health:checked', health);

        // Handle failover if needed
        await this.handleHealthBasedFailover(health);

        return health;
    }

    /**
     * Handle automatic failover based on health status
     */
    private async handleHealthBasedFailover(health: DatabaseHealth): Promise<void> {
        // If primary is unhealthy but replica is healthy, consider failover
        if (health.primary.status === 'unhealthy' && 
            health.replica.status === 'healthy' && 
            this.replicaPool &&
            this.currentWritePool === this.primaryPool) {
            
            this.logger.warn('Primary database unhealthy, considering failover to replica');
            
            // Check if replica can handle writes (promoted to primary)
            try {
                const client = await this.replicaPool.connect();
                const standbyResult = await client.query('SELECT pg_is_in_recovery()');
                client.release();
                
                if (!standbyResult.rows[0].pg_is_in_recovery) {
                    // Replica has been promoted, switch to it
                    await this.performFailover('replica', 'Primary unhealthy, replica promoted');
                }
            } catch (error) {
                this.logger.error('Failed to check replica promotion status', { error });
            }
        }

        // If replica is unhealthy, fall back to primary for reads
        if (health.replica.status === 'unhealthy' && 
            health.primary.status === 'healthy' &&
            this.currentReadPool === this.replicaPool) {
            
            this.logger.warn('Replica unhealthy, falling back to primary for reads');
            this.currentReadPool = this.primaryPool;
            this.emit('readpool:changed', { from: 'replica', to: 'primary' });
        }

        // If replica recovers, switch back to it for reads
        if (health.replica.status === 'healthy' && 
            this.replicaPool &&
            this.currentReadPool === this.primaryPool &&
            config.ha.database.enableReadReplica) {
            
            this.logger.info('Replica recovered, switching back for reads');
            this.currentReadPool = this.replicaPool;
            this.emit('readpool:changed', { from: 'primary', to: 'replica' });
        }
    }

    /**
     * Perform manual failover
     */
    async performFailover(target: 'primary' | 'replica', reason: string): Promise<FailoverEvent> {
        const startTime = Date.now();
        const fromPool = this.currentWritePool === this.primaryPool ? 'primary' : 'replica';
        
        this.logger.warn('Initiating database failover', { 
            from: fromPool, 
            to: target, 
            reason 
        });

        const failoverEvent: FailoverEvent = {
            timestamp: new Date(),
            reason,
            fromPool,
            toPool: target,
            success: false
        };

        try {
            if (target === 'replica' && this.replicaPool) {
                // Switch to replica
                this.currentWritePool = this.replicaPool;
                this.currentReadPool = this.replicaPool;
                
                // Test write capability
                const client = await this.replicaPool.connect();
                await client.query('SELECT 1');
                client.release();
                
                failoverEvent.success = true;
                this.failoverCount++;
                this.lastFailover = new Date();
                
                this.logger.warn('Database failover completed successfully', {
                    from: fromPool,
                    to: target,
                    duration: Date.now() - startTime
                });
                
            } else if (target === 'primary' && this.primaryPool) {
                // Switch back to primary
                this.currentWritePool = this.primaryPool;
                this.currentReadPool = this.replicaPool || this.primaryPool;
                
                // Test write capability
                const client = await this.primaryPool.connect();
                await client.query('SELECT 1');
                client.release();
                
                failoverEvent.success = true;
                this.failoverCount++;
                this.lastFailover = new Date();
                
                this.logger.info('Database failback completed successfully', {
                    from: fromPool,
                    to: target,
                    duration: Date.now() - startTime
                });
            } else {
                throw new Error(`Invalid failover target: ${target}`);
            }

        } catch (error) {
            failoverEvent.error = error instanceof Error ? error.message : String(error);
            this.logger.error('Database failover failed', { 
                error, 
                from: fromPool, 
                to: target 
            });
        }

        failoverEvent.duration = Date.now() - startTime;
        this.emit('failover', failoverEvent);

        return failoverEvent;
    }

    /**
     * Get database connection for writes (always primary)
     */
    async getWriteConnection(): Promise<PoolClient> {
        if (!this.currentWritePool) {
            throw new Error('No write database pool available');
        }

        return this.currentWritePool.connect();
    }

    /**
     * Get database connection for reads (prefer replica if available)
     */
    async getReadConnection(): Promise<PoolClient> {
        if (!this.currentReadPool) {
            throw new Error('No read database pool available');
        }

        return this.currentReadPool.connect();
    }

    /**
     * Execute query with automatic connection management
     */
    async query(text: string, params?: any[], useRead = false): Promise<any> {
        const pool = useRead ? this.currentReadPool : this.currentWritePool;
        
        if (!pool) {
            throw new Error('No database pool available');
        }

        const client = await pool.connect();
        try {
            const result = await client.query(text, params);
            return result;
        } finally {
            client.release();
        }
    }

    /**
     * Get current database metrics
     */
    async getMetrics(): Promise<DatabaseMetrics> {
        const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
        
        const metrics: DatabaseMetrics = {
            primaryConnections: 0,
            replicaConnections: 0,
            replicationLagBytes: 0,
            replicationLagSeconds: 0,
            failoverCount: this.failoverCount,
            lastFailover: this.lastFailover,
            uptime
        };

        // Get primary connection count
        if (this.primaryPool) {
            metrics.primaryConnections = this.primaryPool.totalCount;
        }

        // Get replica connection count
        if (this.replicaPool) {
            metrics.replicaConnections = this.replicaPool.totalCount;
        }

        // Get replication lag from primary
        if (this.primaryPool) {
            try {
                const client = await this.primaryPool.connect();
                const result = await client.query(`
                    SELECT 
                        COALESCE(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn), 0) as lag_bytes,
                        COALESCE(EXTRACT(EPOCH FROM (now() - reply_time)), 0) as lag_seconds
                    FROM pg_stat_replication 
                    LIMIT 1
                `);
                
                if (result.rows.length > 0) {
                    metrics.replicationLagBytes = parseInt(result.rows[0].lag_bytes);
                    metrics.replicationLagSeconds = parseFloat(result.rows[0].lag_seconds);
                }
                
                client.release();
            } catch (error) {
                this.logger.error('Failed to get replication metrics', { error });
            }
        }

        return metrics;
    }

    /**
     * Get current health status
     */
    async getCurrentHealth(): Promise<DatabaseHealth> {
        return this.performHealthCheck();
    }

    /**
     * Graceful shutdown
     */
    async shutdown(): Promise<void> {
        this.isShuttingDown = true;
        this.logger.info('Shutting down Database HA service');

        // Stop health monitoring
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        // Close database pools
        if (this.primaryPool) {
            await this.primaryPool.end();
            this.logger.info('Primary database pool closed');
        }

        if (this.replicaPool) {
            await this.replicaPool.end();
            this.logger.info('Replica database pool closed');
        }

        this.emit('shutdown');
        this.logger.info('Database HA service shutdown completed');
    }
}

export default DatabaseHAService;