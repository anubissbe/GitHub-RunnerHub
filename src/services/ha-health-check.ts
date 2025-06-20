/**
 * High Availability Health Check Service for GitHub RunnerHub
 * 
 * This service provides comprehensive health checking for all HA components
 * including database replication, Redis Sentinel cluster, load balancer connectivity,
 * and inter-service communication.
 */

import { Pool } from 'pg';
import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { config } from '../config';
import axios from 'axios';

export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: Date;
    latency?: number;
    details?: Record<string, any>;
    error?: string;
}

export interface ComponentHealth {
    database: {
        primary: HealthStatus;
        replica: HealthStatus;
        replicationLag?: number;
    };
    redis: {
        master: HealthStatus;
        slave: HealthStatus;
        sentinel: HealthStatus[];
    };
    loadBalancer: HealthStatus;
    orchestrators: Record<string, HealthStatus>;
    sharedStorage: HealthStatus;
    overall: HealthStatus;
}

export interface HealthCheckConfig {
    checkInterval: number;
    timeout: number;
    retryCount: number;
    retryDelay: number;
    alertThreshold: number;
}

export class HAHealthCheckService extends EventEmitter {
    private logger: any;
    private config: HealthCheckConfig;
    private primaryDb?: Pool;
    private replicaDb?: Pool;
    private redisMaster?: Redis;
    private redisSentinel?: Redis;
    private checkTimer?: NodeJS.Timeout;
    private lastHealthStatus: ComponentHealth | null = null;
    private alertCounts: Record<string, number> = {};

    constructor(options: Partial<HealthCheckConfig> = {}) {
        super();
        
        this.logger = createLogger('HAHealthCheck');
        
        this.config = {
            checkInterval: options.checkInterval || 30000, // 30 seconds
            timeout: options.timeout || 5000, // 5 seconds
            retryCount: options.retryCount || 3,
            retryDelay: options.retryDelay || 1000, // 1 second
            alertThreshold: options.alertThreshold || 3 // Alert after 3 consecutive failures
        };

        this.initializeConnections();
        this.logger.info('HA Health Check service initialized', this.config);
    }

    /**
     * Initialize database and Redis connections
     */
    private initializeConnections(): void {
        // PostgreSQL connections
        this.primaryDb = new Pool({
            connectionString: config.database.url,
            max: 5,
            connectionTimeoutMillis: this.config.timeout,
            idleTimeoutMillis: 30000
        });

        if (config.ha.database.replicaUrl) {
            this.replicaDb = new Pool({
                connectionString: config.ha.database.replicaUrl,
                max: 5,
                connectionTimeoutMillis: this.config.timeout,
                idleTimeoutMillis: 30000
            });
        }

        // Redis connections
        this.redisMaster = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
            connectTimeout: this.config.timeout,
            lazyConnect: true,
            maxRetriesPerRequest: this.config.retryCount
        });

        // Redis Sentinel connection
        if (config.ha.redis.sentinelHosts && config.ha.redis.sentinelHosts.length > 0) {
            this.redisSentinel = new Redis({
                sentinels: config.ha.redis.sentinelHosts.map((host: string) => {
                    const [hostname, port] = host.split(':');
                    return { host: hostname, port: parseInt(port) };
                }),
                name: config.ha.redis.masterName,
                password: config.redis.password,
                connectTimeout: this.config.timeout,
                lazyConnect: true
            });
        }
    }

    /**
     * Start health monitoring
     */
    async startMonitoring(): Promise<void> {
        this.logger.info('Starting HA health monitoring');
        
        // Perform initial health check
        await this.performHealthCheck();
        
        // Schedule periodic health checks
        this.scheduleHealthChecks();
        
        this.emit('monitoring:started', { timestamp: new Date() });
    }

    /**
     * Stop health monitoring
     */
    async stopMonitoring(): Promise<void> {
        this.logger.info('Stopping HA health monitoring');
        
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
            this.checkTimer = undefined;
        }

        // Close connections
        if (this.primaryDb) {
            await this.primaryDb.end();
        }
        if (this.replicaDb) {
            await this.replicaDb.end();
        }
        if (this.redisMaster) {
            this.redisMaster.disconnect();
        }
        if (this.redisSentinel) {
            this.redisSentinel.disconnect();
        }

        this.emit('monitoring:stopped', { timestamp: new Date() });
    }

    /**
     * Schedule periodic health checks
     */
    private scheduleHealthChecks(): void {
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
        }

        this.checkTimer = setTimeout(async () => {
            try {
                await this.performHealthCheck();
            } catch (error) {
                this.logger.error('Error during scheduled health check', { error });
            }
            
            this.scheduleHealthChecks();
        }, this.config.checkInterval);
    }

    /**
     * Perform comprehensive health check
     */
    async performHealthCheck(): Promise<ComponentHealth> {
        const startTime = Date.now();
        this.logger.debug('Starting comprehensive health check');

        const healthStatus: ComponentHealth = {
            database: {
                primary: await this.checkDatabaseHealth('primary'),
                replica: await this.checkDatabaseHealth('replica')
            },
            redis: {
                master: await this.checkRedisHealth('master'),
                slave: await this.checkRedisHealth('slave'),
                sentinel: await this.checkRedisSentinelHealth()
            },
            loadBalancer: await this.checkLoadBalancerHealth(),
            orchestrators: await this.checkOrchestratorHealth(),
            sharedStorage: await this.checkSharedStorageHealth(),
            overall: { status: 'healthy', timestamp: new Date() }
        };

        // Check replication lag
        if (healthStatus.database.primary.status === 'healthy' && healthStatus.database.replica.status === 'healthy') {
            healthStatus.database.replicationLag = await this.checkReplicationLag();
        }

        // Determine overall health
        healthStatus.overall = this.calculateOverallHealth(healthStatus);
        
        const duration = Date.now() - startTime;
        this.logger.debug('Health check completed', { 
            duration,
            overallStatus: healthStatus.overall.status 
        });

        // Compare with previous status and emit alerts if needed
        this.processHealthStatusChange(healthStatus);
        
        this.lastHealthStatus = healthStatus;
        this.emit('health:checked', healthStatus);

        return healthStatus;
    }

    /**
     * Check database health (primary or replica)
     */
    async checkDatabaseHealth(type: 'primary' | 'replica'): Promise<HealthStatus> {
        const pool = type === 'primary' ? this.primaryDb : this.replicaDb;
        
        if (!pool) {
            return {
                status: 'unhealthy',
                timestamp: new Date(),
                error: `${type} database not configured`
            };
        }

        const startTime = Date.now();
        
        try {
            const client = await pool.connect();
            
            try {
                // Test basic connectivity
                await client.query('SELECT 1');
                
                // Check if it's a replica
                const replicationResult = await client.query('SELECT pg_is_in_recovery()');
                const isReplica = replicationResult.rows[0].pg_is_in_recovery;
                
                // Get additional stats
                const statsQuery = `
                    SELECT 
                        pg_database_size(current_database()) as db_size,
                        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
                        (SELECT count(*) FROM pg_stat_activity) as total_connections
                `;
                const statsResult = await client.query(statsQuery);
                
                const latency = Date.now() - startTime;
                
                return {
                    status: 'healthy',
                    timestamp: new Date(),
                    latency,
                    details: {
                        type,
                        isReplica,
                        dbSize: parseInt(statsResult.rows[0].db_size),
                        activeConnections: parseInt(statsResult.rows[0].active_connections),
                        totalConnections: parseInt(statsResult.rows[0].total_connections)
                    }
                };
            } finally {
                client.release();
            }
        } catch (error) {
            const latency = Date.now() - startTime;
            this.logger.error(`Database health check failed for ${type}`, { error, latency });
            
            return {
                status: 'unhealthy',
                timestamp: new Date(),
                latency,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Check Redis health (master or slave)
     */
    async checkRedisHealth(type: 'master' | 'slave'): Promise<HealthStatus> {
        const startTime = Date.now();
        
        try {
            const redis = type === 'master' ? this.redisMaster : this.redisSentinel;
            
            if (!redis) {
                return {
                    status: 'unhealthy',
                    timestamp: new Date(),
                    error: `Redis ${type} not configured`
                };
            }

            // Test basic connectivity
            const pong = await redis.ping();
            
            // Get Redis info
            const info = await redis.info();
            const infoLines = info.split('\r\n');
            const infoObj: Record<string, string> = {};
            
            infoLines.forEach(line => {
                if (line.includes(':')) {
                    const [key, value] = line.split(':');
                    infoObj[key] = value;
                }
            });

            const latency = Date.now() - startTime;
            
            return {
                status: pong === 'PONG' ? 'healthy' : 'degraded',
                timestamp: new Date(),
                latency,
                details: {
                    type,
                    role: infoObj.role,
                    connectedClients: parseInt(infoObj.connected_clients || '0'),
                    usedMemory: parseInt(infoObj.used_memory || '0'),
                    usedMemoryHuman: infoObj.used_memory_human,
                    uptimeInSeconds: parseInt(infoObj.uptime_in_seconds || '0')
                }
            };
        } catch (error) {
            const latency = Date.now() - startTime;
            this.logger.error(`Redis health check failed for ${type}`, { error, latency });
            
            return {
                status: 'unhealthy',
                timestamp: new Date(),
                latency,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Check Redis Sentinel health
     */
    async checkRedisSentinelHealth(): Promise<HealthStatus[]> {
        const sentinelStatuses: HealthStatus[] = [];
        
        if (!config.ha.redis.sentinelHosts || config.ha.redis.sentinelHosts.length === 0) {
            return [{
                status: 'unhealthy',
                timestamp: new Date(),
                error: 'Redis Sentinel not configured'
            }];
        }

        for (const host of config.ha.redis.sentinelHosts) {
            const startTime = Date.now();
            
            try {
                const [hostname, port] = host.split(':');
                const sentinel = new Redis({
                    host: hostname,
                    port: parseInt(port),
                    connectTimeout: this.config.timeout,
                    commandTimeout: this.config.timeout
                });

                // Check sentinel status
                const masters = await sentinel.call('SENTINEL', 'masters') as any[][];
                const masterInfo = masters[0];
                
                await sentinel.disconnect();
                
                const latency = Date.now() - startTime;
                
                sentinelStatuses.push({
                    status: 'healthy',
                    timestamp: new Date(),
                    latency,
                    details: {
                        host,
                        masterName: masterInfo ? masterInfo[1] : null,
                        masterStatus: masterInfo ? masterInfo[9] : null,
                        numOtherSentinels: masterInfo ? parseInt(masterInfo[27]) : 0
                    }
                });
            } catch (error) {
                const latency = Date.now() - startTime;
                this.logger.error(`Sentinel health check failed for ${host}`, { error, latency });
                
                sentinelStatuses.push({
                    status: 'unhealthy',
                    timestamp: new Date(),
                    latency,
                    error: error instanceof Error ? error.message : String(error),
                    details: { host }
                });
            }
        }

        return sentinelStatuses;
    }

    /**
     * Check load balancer health
     */
    async checkLoadBalancerHealth(): Promise<HealthStatus> {
        const startTime = Date.now();
        
        try {
            if (!config.ha.loadBalancerUrl) {
                return {
                    status: 'unhealthy',
                    timestamp: new Date(),
                    error: 'Load balancer URL not configured'
                };
            }

            const response = await axios.get(`${config.ha.loadBalancerUrl}/health`, {
                timeout: this.config.timeout,
                validateStatus: () => true // Don't throw on non-2xx status codes
            });

            const latency = Date.now() - startTime;
            
            return {
                status: response.status === 200 ? 'healthy' : 'degraded',
                timestamp: new Date(),
                latency,
                details: {
                    statusCode: response.status,
                    responseData: response.data
                }
            };
        } catch (error) {
            const latency = Date.now() - startTime;
            this.logger.error('Load balancer health check failed', { error, latency });
            
            return {
                status: 'unhealthy',
                timestamp: new Date(),
                latency,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Check orchestrator instances health
     */
    async checkOrchestratorHealth(): Promise<Record<string, HealthStatus>> {
        const orchestratorHealth: Record<string, HealthStatus> = {};
        
        if (!config.ha.clusterNodes || config.ha.clusterNodes.length === 0) {
            return orchestratorHealth;
        }

        const healthChecks = config.ha.clusterNodes.map(async (nodeId: string) => {
            const startTime = Date.now();
            
            try {
                // Get node URL from environment or use default pattern
                const nodeUrl = process.env[`${nodeId.toUpperCase()}_URL`] || `http://${nodeId}:3001`;
                
                const response = await axios.get(`${nodeUrl}/health`, {
                    timeout: this.config.timeout,
                    validateStatus: () => true
                });

                const latency = Date.now() - startTime;
                
                orchestratorHealth[nodeId] = {
                    status: response.status === 200 ? 'healthy' : 'degraded',
                    timestamp: new Date(),
                    latency,
                    details: {
                        nodeId,
                        url: nodeUrl,
                        statusCode: response.status,
                        responseData: response.data
                    }
                };
            } catch (error) {
                const latency = Date.now() - startTime;
                
                orchestratorHealth[nodeId] = {
                    status: 'unhealthy',
                    timestamp: new Date(),
                    latency,
                    error: error instanceof Error ? error.message : String(error),
                    details: { nodeId }
                };
            }
        });

        await Promise.all(healthChecks);
        return orchestratorHealth;
    }

    /**
     * Check shared storage health
     */
    async checkSharedStorageHealth(): Promise<HealthStatus> {
        const startTime = Date.now();
        
        try {
            const fs = require('fs').promises;
            const path = require('path');
            
            const storagePath = config.ha.storage?.sharedPath || '/shared';
            const testFile = path.join(storagePath, '.health-check');
            const testData = `health-check-${Date.now()}`;
            
            // Write test file
            await fs.writeFile(testFile, testData);
            
            // Read test file
            const readData = await fs.readFile(testFile, 'utf8');
            
            // Clean up test file
            await fs.unlink(testFile);
            
            const latency = Date.now() - startTime;
            
            if (readData === testData) {
                return {
                    status: 'healthy',
                    timestamp: new Date(),
                    latency,
                    details: {
                        path: storagePath,
                        writable: true,
                        readable: true
                    }
                };
            } else {
                return {
                    status: 'degraded',
                    timestamp: new Date(),
                    latency,
                    error: 'Data integrity check failed'
                };
            }
        } catch (error) {
            const latency = Date.now() - startTime;
            this.logger.error('Shared storage health check failed', { error, latency });
            
            return {
                status: 'unhealthy',
                timestamp: new Date(),
                latency,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Check PostgreSQL replication lag
     */
    async checkReplicationLag(): Promise<number | undefined> {
        try {
            if (!this.replicaDb || !this.primaryDb) {
                return undefined;
            }

            const client = await this.primaryDb.connect();
            
            try {
                const result = await client.query(`
                    SELECT 
                        client_addr,
                        state,
                        pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) as lag_bytes,
                        EXTRACT(EPOCH FROM (now() - reply_time)) as lag_seconds
                    FROM pg_stat_replication;
                `);

                if (result.rows.length > 0) {
                    return parseFloat(result.rows[0].lag_seconds) || 0;
                }
                
                return undefined;
            } finally {
                client.release();
            }
        } catch (error) {
            this.logger.error('Failed to check replication lag', { error });
            return undefined;
        }
    }

    /**
     * Calculate overall health status
     */
    private calculateOverallHealth(health: ComponentHealth): HealthStatus {
        const components = [
            health.database.primary,
            health.database.replica,
            health.redis.master,
            health.redis.slave,
            health.loadBalancer,
            health.sharedStorage,
            ...Object.values(health.orchestrators),
            ...health.redis.sentinel
        ].filter(Boolean);

        const healthyCount = components.filter(c => c.status === 'healthy').length;
        const degradedCount = components.filter(c => c.status === 'degraded').length;
        const unhealthyCount = components.filter(c => c.status === 'unhealthy').length;

        let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
        
        if (unhealthyCount > 0) {
            overallStatus = 'unhealthy';
        } else if (degradedCount > 0) {
            overallStatus = 'degraded';
        } else {
            overallStatus = 'healthy';
        }

        return {
            status: overallStatus,
            timestamp: new Date(),
            details: {
                totalComponents: components.length,
                healthyComponents: healthyCount,
                degradedComponents: degradedCount,
                unhealthyComponents: unhealthyCount
            }
        };
    }

    /**
     * Process health status changes and emit alerts
     */
    private processHealthStatusChange(currentHealth: ComponentHealth): void {
        if (!this.lastHealthStatus) {
            return; // First check, no comparison
        }

        // Check for status changes
        const changes: Array<{ component: string; from: string; to: string }> = [];

        // Database changes
        if (this.lastHealthStatus.database.primary.status !== currentHealth.database.primary.status) {
            changes.push({
                component: 'database.primary',
                from: this.lastHealthStatus.database.primary.status,
                to: currentHealth.database.primary.status
            });
        }

        if (this.lastHealthStatus.database.replica.status !== currentHealth.database.replica.status) {
            changes.push({
                component: 'database.replica',
                from: this.lastHealthStatus.database.replica.status,
                to: currentHealth.database.replica.status
            });
        }

        // Overall status change
        if (this.lastHealthStatus.overall.status !== currentHealth.overall.status) {
            changes.push({
                component: 'overall',
                from: this.lastHealthStatus.overall.status,
                to: currentHealth.overall.status
            });
        }

        // Emit alerts for significant changes
        changes.forEach(change => {
            if (change.to === 'unhealthy' || (change.from === 'healthy' && change.to === 'degraded')) {
                this.alertCounts[change.component] = (this.alertCounts[change.component] || 0) + 1;
                
                if (this.alertCounts[change.component] >= this.config.alertThreshold) {
                    this.emit('health:alert', {
                        component: change.component,
                        status: change.to,
                        previousStatus: change.from,
                        alertCount: this.alertCounts[change.component],
                        timestamp: new Date(),
                        details: currentHealth
                    });
                }
            } else if (change.to === 'healthy' && change.from !== 'healthy') {
                // Recovery alert
                this.alertCounts[change.component] = 0; // Reset alert count
                this.emit('health:recovery', {
                    component: change.component,
                    status: change.to,
                    previousStatus: change.from,
                    timestamp: new Date()
                });
            }
        });
    }

    /**
     * Get current health status
     */
    getCurrentHealth(): ComponentHealth | null {
        return this.lastHealthStatus;
    }

    /**
     * Force immediate health check
     */
    async forceHealthCheck(): Promise<ComponentHealth> {
        return await this.performHealthCheck();
    }
}

export default HAHealthCheckService;