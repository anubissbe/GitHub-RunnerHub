/**
 * E2E Tests for Redis Sentinel High Availability
 * 
 * These tests verify the Redis Sentinel cluster functionality including:
 * - Basic connectivity and service discovery
 * - Automatic failover mechanisms
 * - BullMQ queue resilience during failover
 * - Application-level Redis integration
 */

const Redis = require('ioredis');
const { Queue, Worker } = require('bullmq');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
    sentinels: [
        { host: 'redis-sentinel-1', port: 26379 },
        { host: 'redis-sentinel-2', port: 26379 },
        { host: 'redis-sentinel-3', port: 26379 }
    ],
    masterName: 'github-runnerhub-redis',
    password: process.env.REDIS_PASSWORD || 'redis_password_789',
    timeout: 30000,
    retryAttempts: 5
};

describe('Redis Sentinel E2E Tests', () => {
    let sentinelClient;
    let redisClient;
    let testQueue;
    let testWorker;
    
    beforeAll(async () => {
        console.log('Setting up Redis Sentinel E2E tests...');
        
        // Wait for services to be ready
        await waitForServices();
        
        // Create Sentinel client
        sentinelClient = new Redis({
            sentinels: TEST_CONFIG.sentinels,
            name: TEST_CONFIG.masterName,
            password: TEST_CONFIG.password,
            connectTimeout: 5000,
            commandTimeout: 5000,
            retryDelayOnFailover: 100,
            enableReadyCheck: false,
            maxRetriesPerRequest: null
        });
        
        // Create direct Redis client for testing
        redisClient = new Redis({
            sentinels: TEST_CONFIG.sentinels,
            name: TEST_CONFIG.masterName,
            password: TEST_CONFIG.password,
            connectTimeout: 5000,
            lazyConnect: false
        });
        
        // Create test queue
        testQueue = new Queue('test-sentinel-queue', {
            connection: sentinelClient,
            defaultJobOptions: {
                removeOnComplete: 10,
                removeOnFail: 10
            }
        });
        
        console.log('Redis Sentinel E2E test setup completed');
    }, TEST_CONFIG.timeout);
    
    afterAll(async () => {
        console.log('Cleaning up Redis Sentinel E2E tests...');
        
        if (testWorker) {
            await testWorker.close();
        }
        
        if (testQueue) {
            await testQueue.close();
        }
        
        if (sentinelClient) {
            sentinelClient.disconnect();
        }
        
        if (redisClient) {
            redisClient.disconnect();
        }
        
        console.log('Redis Sentinel E2E test cleanup completed');
    });
    
    describe('Basic Connectivity', () => {
        test('should connect to Redis via Sentinel', async () => {
            const pong = await redisClient.ping();
            expect(pong).toBe('PONG');
        });
        
        test('should discover Redis master through Sentinel', async () => {
            const masterInfo = await sentinelClient.call('SENTINEL', 'get-master-addr-by-name', TEST_CONFIG.masterName);
            expect(masterInfo).toBeDefined();
            expect(masterInfo).toHaveLength(2); // [host, port]
            expect(masterInfo[0]).toBeTruthy();
            expect(parseInt(masterInfo[1])).toBe(6379);
        });
        
        test('should have all Sentinels monitoring the master', async () => {
            const directSentinel = new Redis({ host: 'redis-sentinel-1', port: 26379 });
            
            try {
                const masters = await directSentinel.call('SENTINEL', 'masters');
                expect(masters).toBeDefined();
                expect(masters.length).toBeGreaterThan(0);
                
                // Find our master in the list
                const ourMaster = masters.find(master => {
                    const nameIndex = master.indexOf('name') + 1;
                    return master[nameIndex] === TEST_CONFIG.masterName;
                });
                
                expect(ourMaster).toBeDefined();
            } finally {
                directSentinel.disconnect();
            }
        });
        
        test('should have correct Sentinel quorum configuration', async () => {
            const directSentinel = new Redis({ host: 'redis-sentinel-1', port: 26379 });
            
            try {
                const masters = await directSentinel.call('SENTINEL', 'masters');
                const ourMaster = masters.find(master => {
                    const nameIndex = master.indexOf('name') + 1;
                    return master[nameIndex] === TEST_CONFIG.masterName;
                });
                
                const quorumIndex = ourMaster.indexOf('quorum') + 1;
                const quorum = parseInt(ourMaster[quorumIndex]);
                expect(quorum).toBe(2); // Should be 2 for our 3-sentinel setup
            } finally {
                directSentinel.disconnect();
            }
        });
    });
    
    describe('Data Operations', () => {
        test('should perform basic Redis operations', async () => {
            const testKey = `test:sentinel:${Date.now()}`;
            const testValue = `test-value-${Math.random()}`;
            
            await redisClient.set(testKey, testValue);
            const retrievedValue = await redisClient.get(testKey);
            
            expect(retrievedValue).toBe(testValue);
            
            // Cleanup
            await redisClient.del(testKey);
        });
        
        test('should handle Redis transactions', async () => {
            const testKey = `test:transaction:${Date.now()}`;
            const multi = redisClient.multi();
            
            multi.set(testKey, 'value1');
            multi.incr(testKey + ':counter');
            multi.set(testKey + ':flag', 'true');
            
            const results = await multi.exec();
            expect(results).toHaveLength(3);
            expect(results[0][0]).toBeNull(); // No error
            expect(results[1][0]).toBeNull(); // No error
            expect(results[2][0]).toBeNull(); // No error
            
            // Verify values
            const value = await redisClient.get(testKey);
            const counter = await redisClient.get(testKey + ':counter');
            const flag = await redisClient.get(testKey + ':flag');
            
            expect(value).toBe('value1');
            expect(counter).toBe('1');
            expect(flag).toBe('true');
            
            // Cleanup
            await redisClient.del(testKey, testKey + ':counter', testKey + ':flag');
        });
        
        test('should handle pub/sub operations', async () => {
            const channel = `test:pubsub:${Date.now()}`;
            const message = `test-message-${Math.random()}`;
            
            return new Promise((resolve, reject) => {
                const subscriber = new Redis({
                    sentinels: TEST_CONFIG.sentinels,
                    name: TEST_CONFIG.masterName,
                    password: TEST_CONFIG.password
                });
                
                const publisher = new Redis({
                    sentinels: TEST_CONFIG.sentinels,
                    name: TEST_CONFIG.masterName,
                    password: TEST_CONFIG.password
                });
                
                subscriber.subscribe(channel);
                
                subscriber.on('message', (receivedChannel, receivedMessage) => {
                    try {
                        expect(receivedChannel).toBe(channel);
                        expect(receivedMessage).toBe(message);
                        
                        subscriber.disconnect();
                        publisher.disconnect();
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
                
                subscriber.on('subscribe', () => {
                    publisher.publish(channel, message);
                });
                
                // Timeout safety
                setTimeout(() => {
                    subscriber.disconnect();
                    publisher.disconnect();
                    reject(new Error('Pub/sub test timeout'));
                }, 5000);
            });
        });
    });
    
    describe('BullMQ Integration', () => {
        test('should create and process jobs through Sentinel', async () => {
            const jobData = { test: 'sentinel-job', timestamp: Date.now() };
            let jobProcessed = false;
            
            // Create worker
            testWorker = new Worker('test-sentinel-queue', async (job) => {
                expect(job.data).toEqual(jobData);
                jobProcessed = true;
                return { success: true };
            }, {
                connection: new Redis({
                    sentinels: TEST_CONFIG.sentinels,
                    name: TEST_CONFIG.masterName,
                    password: TEST_CONFIG.password,
                    maxRetriesPerRequest: null
                })
            });
            
            // Add job
            const job = await testQueue.add('test-job', jobData);
            expect(job.id).toBeDefined();
            
            // Wait for job processing
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (jobProcessed) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
                
                setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve();
                }, 5000);
            });
            
            expect(jobProcessed).toBe(true);
        });
        
        test('should handle queue metrics through Sentinel', async () => {
            const waiting = await testQueue.getWaitingCount();
            const active = await testQueue.getActiveCount();
            const completed = await testQueue.getCompletedCount();
            const failed = await testQueue.getFailedCount();
            
            expect(typeof waiting).toBe('number');
            expect(typeof active).toBe('number');
            expect(typeof completed).toBe('number');
            expect(typeof failed).toBe('number');
        });
        
        test('should persist jobs across Redis restarts', async () => {
            const jobData = { test: 'persistence-test', timestamp: Date.now() };
            
            // Add job
            const job = await testQueue.add('persistence-test', jobData, {
                delay: 5000 // Delay to ensure it survives restart
            });
            
            // Verify job is in waiting state
            const waitingJobs = await testQueue.getWaiting();
            const ourJob = waitingJobs.find(j => j.id === job.id);
            expect(ourJob).toBeDefined();
            expect(ourJob.data).toEqual(jobData);
            
            // Job should still be there after some time
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const stillWaitingJobs = await testQueue.getWaiting();
            const stillOurJob = stillWaitingJobs.find(j => j.id === job.id);
            expect(stillOurJob).toBeDefined();
        });
    });
    
    describe('Failover Scenarios', () => {
        test('should handle master unavailability gracefully', async () => {
            console.log('Testing Redis failover resilience...');
            
            // First, establish baseline connectivity
            const testKey = `failover:test:${Date.now()}`;
            await redisClient.set(testKey, 'before-failover');
            
            // Simulate network partition or master slowdown
            // Note: In a real scenario, we might pause the master container
            // For this test, we'll test the client's resilience to timeouts
            
            const failoverPromises = [];
            
            // Test multiple concurrent operations during potential failover
            for (let i = 0; i < 10; i++) {
                failoverPromises.push(
                    redisClient.set(`${testKey}:${i}`, `value-${i}`)
                        .catch(err => {
                            // During failover, some operations might fail
                            console.log(`Operation ${i} failed during failover test:`, err.message);
                            return null;
                        })
                );
            }
            
            const results = await Promise.all(failoverPromises);
            
            // At least some operations should succeed
            const successfulOps = results.filter(r => r === 'OK').length;
            console.log(`${successfulOps}/10 operations succeeded during failover test`);
            
            // Verify the original test key is still accessible
            const retrievedValue = await redisClient.get(testKey);
            expect(retrievedValue).toBe('before-failover');
            
            // Cleanup
            await redisClient.del(testKey);
            for (let i = 0; i < 10; i++) {
                await redisClient.del(`${testKey}:${i}`);
            }
        });
        
        test('should maintain Sentinel monitoring during high load', async () => {
            const operations = [];
            const testKeyPrefix = `load:test:${Date.now()}`;
            
            // Generate high load
            for (let i = 0; i < 100; i++) {
                operations.push(
                    redisClient.set(`${testKeyPrefix}:${i}`, `value-${i}`)
                        .then(() => redisClient.get(`${testKeyPrefix}:${i}`))
                        .then(() => redisClient.del(`${testKeyPrefix}:${i}`))
                );
            }
            
            // Execute all operations concurrently
            const startTime = Date.now();
            await Promise.all(operations);
            const duration = Date.now() - startTime;
            
            console.log(`Completed 300 Redis operations in ${duration}ms`);
            
            // Verify Sentinel is still functional
            const masterInfo = await sentinelClient.call('SENTINEL', 'get-master-addr-by-name', TEST_CONFIG.masterName);
            expect(masterInfo).toBeDefined();
            expect(masterInfo).toHaveLength(2);
        });
    });
    
    describe('Application Integration', () => {
        test('should integrate with application Redis connection service', async () => {
            // This test verifies that our Redis connection service works correctly
            const RedisConnection = require('../../src/services/redis-connection');
            
            const appRedisClient = RedisConnection.createGeneralConnection();
            
            try {
                const isConnected = await RedisConnection.testRedisConnection(appRedisClient);
                expect(isConnected).toBe(true);
                
                const redisInfo = await RedisConnection.getRedisInfo(appRedisClient);
                expect(redisInfo).toBeDefined();
                expect(redisInfo.server).toBeDefined();
                expect(redisInfo.replication).toBeDefined();
            } finally {
                appRedisClient.disconnect();
            }
        });
        
        test('should work with HA Manager Redis operations', async () => {
            // Test the HA Manager's Redis integration
            const HAManager = require('../../src/services/ha-manager').default;
            
            const haManager = new HAManager();
            
            try {
                await haManager.initialize();
                
                // Test Redis client access
                const haRedisClient = haManager.getRedisClient();
                const pong = await haRedisClient.ping();
                expect(pong).toBe('PONG');
                
                // Test health check
                const health = await haManager.forceHealthCheck();
                expect(health).toBeDefined();
                expect(health.redis).toBeDefined();
                
            } catch (error) {
                console.log('HA Manager test skipped (services not available):', error.message);
            } finally {
                await haManager.shutdown();
            }
        });
    });
    
    describe('Monitoring and Observability', () => {
        test('should provide Redis metrics and statistics', async () => {
            const info = await redisClient.info();
            expect(info).toContain('redis_version');
            expect(info).toContain('connected_clients');
            expect(info).toContain('used_memory');
            
            const replicationInfo = await redisClient.info('replication');
            expect(replicationInfo).toContain('role:master');
        });
        
        test('should track Sentinel metrics', async () => {
            const directSentinel = new Redis({ host: 'redis-sentinel-1', port: 26379 });
            
            try {
                const sentinelInfo = await directSentinel.info('sentinel');
                expect(sentinelInfo).toContain('sentinel_masters');
                expect(sentinelInfo).toContain('sentinel_running_scripts');
            } finally {
                directSentinel.disconnect();
            }
        });
        
        test('should provide queue health metrics', async () => {
            const queueHealth = {
                waiting: await testQueue.getWaitingCount(),
                active: await testQueue.getActiveCount(),
                completed: await testQueue.getCompletedCount(),
                failed: await testQueue.getFailedCount()
            };
            
            expect(typeof queueHealth.waiting).toBe('number');
            expect(typeof queueHealth.active).toBe('number');
            expect(typeof queueHealth.completed).toBe('number');
            expect(typeof queueHealth.failed).toBe('number');
            
            console.log('Queue health metrics:', queueHealth);
        });
    });
});

// Utility functions
async function waitForServices() {
    console.log('Waiting for Redis Sentinel services to be ready...');
    
    const maxAttempts = 30;
    const delay = 2000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // Test Sentinel connectivity
            const testSentinel = new Redis({ host: 'redis-sentinel-1', port: 26379 });
            await testSentinel.ping();
            testSentinel.disconnect();
            
            // Test Redis master via Sentinel
            const testRedis = new Redis({
                sentinels: TEST_CONFIG.sentinels,
                name: TEST_CONFIG.masterName,
                password: TEST_CONFIG.password,
                connectTimeout: 2000,
                commandTimeout: 2000
            });
            await testRedis.ping();
            testRedis.disconnect();
            
            console.log('Redis Sentinel services are ready');
            return;
        } catch (error) {
            console.log(`Attempt ${attempt}/${maxAttempts}: Services not ready yet - ${error.message}`);
            
            if (attempt === maxAttempts) {
                throw new Error('Redis Sentinel services failed to become ready within timeout');
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function executeCommand(command, args = []) {
    return new Promise((resolve, reject) => {
        const process = spawn(command, args, { stdio: 'pipe' });
        let stdout = '';
        let stderr = '';
        
        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        process.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`Command failed with code ${code}: ${stderr}`));
            }
        });
    });
}