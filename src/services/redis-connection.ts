/**
 * Redis Connection Service with High Availability Support
 * 
 * This service provides Redis connections with automatic failover support
 * using Redis Sentinel when HA is enabled, falling back to direct connection
 * when HA is disabled.
 */

import Redis from 'ioredis';
import { createLogger } from '../utils/logger';
import { config } from '../config';

const logger = createLogger('RedisConnection');

export interface RedisConnectionConfig {
    connectionName?: string;
    maxRetriesPerRequest?: number | null;
    enableOfflineQueue?: boolean;
    lazyConnect?: boolean;
}

/**
 * Create Redis connection with HA support
 */
export function createRedisConnection(connectionConfig: RedisConnectionConfig = {}): Redis {
    const {
        connectionName = 'default',
        maxRetriesPerRequest = null,
        enableOfflineQueue = true,
        lazyConnect = false
    } = connectionConfig;

    logger.info('Creating Redis connection', {
        connectionName,
        haEnabled: config.ha.enabled,
        sentinelEnabled: config.ha.redis.enableSentinel
    });

    let redisConnection: Redis;

    if (config.ha.enabled && config.ha.redis.enableSentinel && config.ha.redis.sentinelHosts.length > 0) {
        // Use Redis Sentinel for HA
        logger.info('Connecting to Redis via Sentinel', {
            sentinels: config.ha.redis.sentinelHosts,
            masterName: config.ha.redis.masterName
        });

        redisConnection = new Redis({
            sentinels: config.ha.redis.sentinelHosts.map((host: string) => {
                const [hostname, port] = host.split(':');
                return { host: hostname, port: parseInt(port) };
            }),
            name: config.ha.redis.masterName,
            password: config.redis.password,
            sentinelPassword: config.ha.redis.sentinelPassword,
            maxRetriesPerRequest,
            enableOfflineQueue,
            lazyConnect,
            connectTimeout: 5000,
            commandTimeout: 5000,
            enableReadyCheck: false,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                logger.warn(`Redis Sentinel connection retry attempt ${times}, delay ${delay}ms`, {
                    connectionName
                });
                return delay;
            },
            // Sentinel-specific options
            sentinelRetryStrategy: (times) => {
                const delay = Math.min(times * 100, 5000);
                logger.warn(`Redis Sentinel retry attempt ${times}, delay ${delay}ms`, {
                    connectionName
                });
                return delay;
            },
            natMap: {
                // Handle NAT mapping if needed in containerized environments
            }
        });

        // Handle Sentinel-specific events
        redisConnection.on('sentinelConnect', (sentinel) => {
            logger.info('Connected to Sentinel', {
                connectionName,
                sentinel: `${sentinel.options.host}:${sentinel.options.port}`
            });
        });

        redisConnection.on('sentinelError', (err, sentinel) => {
            logger.error('Sentinel connection error', {
                connectionName,
                sentinel: `${sentinel.options.host}:${sentinel.options.port}`,
                error: err.message
            });
        });

        redisConnection.on('sentinelReconnecting', (sentinel) => {
            logger.warn('Sentinel reconnecting', {
                connectionName,
                sentinel: `${sentinel.options.host}:${sentinel.options.port}`
            });
        });

        // Handle master changes
        redisConnection.on('ready', () => {
            logger.info('Connected to Redis master via Sentinel', {
                connectionName,
                status: 'ready'
            });
        });

    } else {
        // Use direct Redis connection
        logger.info('Connecting to Redis directly', {
            host: config.redis.host,
            port: config.redis.port
        });

        redisConnection = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
            maxRetriesPerRequest,
            enableOfflineQueue,
            lazyConnect,
            connectTimeout: 5000,
            commandTimeout: 5000,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                logger.warn(`Redis connection retry attempt ${times}, delay ${delay}ms`, {
                    connectionName
                });
                return delay;
            }
        });
    }

    // Common event handlers
    redisConnection.on('connect', () => {
        logger.info('Redis connection established', { connectionName });
    });

    redisConnection.on('ready', () => {
        logger.info('Redis connection ready', { connectionName });
    });

    redisConnection.on('error', (err) => {
        logger.error('Redis connection error', {
            connectionName,
            error: err.message
        });
    });

    redisConnection.on('close', () => {
        logger.warn('Redis connection closed', { connectionName });
    });

    redisConnection.on('reconnecting', (ms: number) => {
        logger.warn('Redis reconnecting', {
            connectionName,
            delay: ms
        });
    });

    redisConnection.on('end', () => {
        logger.warn('Redis connection ended', { connectionName });
    });

    // Handle Redis Sentinel failover events
    if (config.ha.enabled && config.ha.redis.enableSentinel) {
        redisConnection.on('failover', (options) => {
            logger.warn('Redis failover detected', {
                connectionName,
                oldMaster: options.oldMaster,
                newMaster: options.newMaster
            });
        });

        redisConnection.on('node error', (err, node) => {
            logger.error('Redis node error', {
                connectionName,
                node: `${node.options.host}:${node.options.port}`,
                error: err.message
            });
        });

        redisConnection.on('+node', (node) => {
            logger.info('Redis node added', {
                connectionName,
                node: `${node.options.host}:${node.options.port}`
            });
        });

        redisConnection.on('-node', (node) => {
            logger.warn('Redis node removed', {
                connectionName,
                node: `${node.options.host}:${node.options.port}`
            });
        });
    }

    return redisConnection;
}

/**
 * Create Redis connection specifically for BullMQ
 */
export function createBullMQConnection(): Redis {
    return createRedisConnection({
        connectionName: 'bullmq',
        maxRetriesPerRequest: null, // Required by BullMQ
        enableOfflineQueue: false,
        lazyConnect: false
    });
}

/**
 * Create Redis connection for queue events
 */
export function createQueueEventsConnection(): Redis {
    return createRedisConnection({
        connectionName: 'queue-events',
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        lazyConnect: false
    });
}

/**
 * Create Redis connection for general purpose operations
 */
export function createGeneralConnection(): Redis {
    return createRedisConnection({
        connectionName: 'general',
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true,
        lazyConnect: true
    });
}

/**
 * Test Redis connection
 */
export async function testRedisConnection(connection: Redis): Promise<boolean> {
    try {
        const pong = await connection.ping();
        if (pong === 'PONG') {
            logger.info('Redis connection test successful');
            return true;
        } else {
            logger.error('Redis connection test failed: unexpected response', { response: pong });
            return false;
        }
    } catch (error) {
        logger.error('Redis connection test failed', { error });
        return false;
    }
}

/**
 * Get Redis connection info
 */
export async function getRedisInfo(connection: Redis): Promise<any> {
    try {
        const info = await connection.info();
        const replicationInfo = await connection.info('replication');
        const serverInfo = await connection.info('server');
        
        return {
            server: parseRedisInfo(serverInfo),
            replication: parseRedisInfo(replicationInfo),
            full: parseRedisInfo(info)
        };
    } catch (error) {
        logger.error('Failed to get Redis info', { error });
        return null;
    }
}

/**
 * Parse Redis INFO command output
 */
function parseRedisInfo(info: string): Record<string, string> {
    const lines = info.split('\r\n');
    const result: Record<string, string> = {};
    
    lines.forEach(line => {
        if (line.includes(':') && !line.startsWith('#')) {
            const [key, value] = line.split(':');
            result[key] = value;
        }
    });
    
    return result;
}

export default {
    createRedisConnection,
    createBullMQConnection,
    createQueueEventsConnection,
    createGeneralConnection,
    testRedisConnection,
    getRedisInfo
};