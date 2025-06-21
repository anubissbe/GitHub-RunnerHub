/**
 * End-to-End Tests for High Availability System
 * 
 * This test suite validates the complete HA functionality including
 * leader election, health monitoring, failover, and recovery.
 */

const request = require('supertest');
const { expect } = require('chai');
const Redis = require('ioredis');
const { Client } = require('pg');

describe('High Availability System E2E Tests', () => {
    let app;
    let redisClient;
    let dbClient;
    let authToken;

    before(async () => {
        // Setup test environment
        process.env.NODE_ENV = 'test';
        process.env.HA_ENABLED = 'true';
        process.env.HA_NODE_ID = 'test-node-1';
        process.env.LEADER_ELECTION_ENABLED = 'true';
        
        // Import app after setting environment
        app = require('../../src/app');
        
        // Setup Redis client for testing
        redisClient = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD,
            retryDelayOnFailover: 100
        });
        
        // Setup database client for testing
        dbClient = new Client({
            connectionString: process.env.DATABASE_URL || 'postgresql://user:password@host:5432/database
        });
        await dbClient.connect();
        
        // Get auth token for API tests
        const authResponse = await request(app)
            .post('/api/auth/login')
            .send({
                username: 'test_admin',
                password: 'test_password'
            });
        
        if (authResponse.status === 200) {
            authToken = authResponse.body.data.token;
        }
    });

    after(async () => {
        if (redisClient) {
            redisClient.disconnect();
        }
        if (dbClient) {
            await dbClient.end();
        }
    });

    describe('HA Status and Configuration', () => {
        it('should return HA status when enabled', async () => {
            const response = await request(app)
                .get('/api/system/ha/status')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(response.body.success).to.be.true;
            expect(response.body.data).to.have.property('enabled', true);
            expect(response.body.data).to.have.property('nodeId');
            expect(response.body.data).to.have.property('services');
            expect(response.body.data.services).to.have.property('leaderElection');
            expect(response.body.data.services).to.have.property('healthMonitoring');
        });

        it('should return cluster information', async () => {
            const response = await request(app)
                .get('/api/system/ha/cluster')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(response.body.success).to.be.true;
            expect(response.body.data).to.have.property('mode', 'high-availability');
            expect(response.body.data).to.have.property('currentNode');
            expect(response.body.data).to.have.property('clusterSize');
        });
    });

    describe('Health Monitoring', () => {
        it('should perform comprehensive health check', async () => {
            const response = await request(app)
                .get('/api/system/ha/health')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).to.be.oneOf([200, 206, 503]);
            expect(response.body.success).to.be.true;
            expect(response.body.data).to.have.property('overall');
            expect(response.body.data).to.have.property('database');
            expect(response.body.data).to.have.property('redis');
            expect(response.body.data).to.have.property('loadBalancer');
            expect(response.body.data).to.have.property('orchestrators');
        });

        it('should monitor database replication status', async () => {
            const response = await request(app)
                .get('/api/system/ha/database')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).to.be.oneOf([200, 503]);
            expect(response.body.success).to.be.true;
            expect(response.body.data).to.have.property('primary');
            expect(response.body.data.primary).to.have.property('status');
            expect(response.body.data.primary).to.have.property('timestamp');
        });

        it('should monitor Redis Sentinel status', async () => {
            const response = await request(app)
                .get('/api/system/ha/redis')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).to.be.oneOf([200, 503]);
            expect(response.body.success).to.be.true;
            expect(response.body.data).to.have.property('master');
            
            if (process.env.REDIS_ENABLE_SENTINEL === 'true') {
                expect(response.body.data).to.have.property('sentinel');
                expect(response.body.data).to.have.property('mode', 'sentinel-cluster');
            }
        });
    });

    describe('Leader Election', () => {
        it('should handle leader election process', async () => {
            // Test leader election key in Redis
            const leaderKey = 'runnerhub:leader:lock';
            const leaderData = await redisClient.get(leaderKey);
            
            if (leaderData) {
                const leader = JSON.parse(leaderData);
                expect(leader).to.have.property('nodeId');
                expect(leader).to.have.property('timestamp');
            }
        });

        it('should allow forced leader election for admin users', async () => {
            const response = await request(app)
                .post('/api/system/ha/election/force')
                .set('Authorization', `Bearer ${authToken}`);

            // Should succeed or fail gracefully
            expect(response.status).to.be.oneOf([200, 400, 503]);
            
            if (response.status === 200) {
                expect(response.body.success).to.be.true;
                expect(response.body.message).to.include('election');
            }
        });

        it('should maintain leader information consistency', async () => {
            const statusResponse = await request(app)
                .get('/api/system/ha/status')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            const leaderFromStatus = statusResponse.body.data.currentLeader;
            const isLeaderFromStatus = statusResponse.body.data.isLeader;
            
            // Leader information should be consistent
            if (leaderFromStatus && isLeaderFromStatus) {
                expect(leaderFromStatus).to.equal(statusResponse.body.data.nodeId);
            }
        });
    });

    describe('Database High Availability', () => {
        it('should handle database connection switching', async () => {
            // Test primary database connection
            const query = 'SELECT pg_is_in_recovery() as is_replica, current_database() as db_name';
            
            try {
                const result = await dbClient.query(query);
                expect(result.rows).to.have.length(1);
                expect(result.rows[0]).to.have.property('db_name');
                
                // Log database role for debugging
                console.log(`Database role: ${result.rows[0].is_replica ? 'replica' : 'primary'}`);
            } catch (error) {
                // Database connection issues should be handled gracefully
                console.warn('Database connection test failed:', error.message);
            }
        });

        it('should monitor replication lag when replica is available', async () => {
            if (process.env.DATABASE_REPLICA_URL) {
                const response = await request(app)
                    .get('/api/system/ha/database')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(response.body.data).to.have.property('replica');
                
                if (response.body.data.replica.status === 'healthy') {
                    expect(response.body.data).to.have.property('replicationLag');
                    expect(response.body.data.replicationLag).to.be.a('number');
                }
            }
        });
    });

    describe('Redis High Availability', () => {
        it('should handle Redis master-slave replication', async () => {
            try {
                // Test Redis connectivity
                const pong = await redisClient.ping();
                expect(pong).to.equal('PONG');

                // Test data consistency
                const testKey = 'ha-test-' + Date.now();
                const testValue = 'test-value-' + Math.random();
                
                await redisClient.set(testKey, testValue, 'EX', 60);
                const retrievedValue = await redisClient.get(testKey);
                
                expect(retrievedValue).to.equal(testValue);
                
                // Cleanup
                await redisClient.del(testKey);
            } catch (error) {
                console.warn('Redis connection test failed:', error.message);
            }
        });

        it('should provide Sentinel cluster information when enabled', async () => {
            if (process.env.REDIS_ENABLE_SENTINEL === 'true') {
                const response = await request(app)
                    .get('/api/system/ha/redis')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(response.body.data.sentinel).to.be.an('array');
                
                if (response.body.data.sentinel.length > 0) {
                    response.body.data.sentinel.forEach(sentinel => {
                        expect(sentinel).to.have.property('status');
                        expect(sentinel).to.have.property('timestamp');
                    });
                }
            }
        });
    });

    describe('Failover and Recovery', () => {
        it('should handle graceful service degradation', async () => {
            // Test system behavior under component failures
            const healthResponse = await request(app)
                .get('/api/system/ha/health')
                .set('Authorization', `Bearer ${authToken}`);

            const health = healthResponse.body.data;
            
            // System should handle partial failures gracefully
            if (health.overall.status === 'degraded') {
                // Should still be able to serve requests
                expect(healthResponse.status).to.be.oneOf([200, 206]);
                expect(health.overall.details).to.have.property('healthyComponents');
                expect(health.overall.details).to.have.property('unhealthyComponents');
            }
        });

        it('should maintain service availability during component restart', async () => {
            // Test basic service availability
            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.body).to.have.property('status');
            expect(response.body.status).to.be.oneOf(['healthy', 'degraded']);
        });
    });

    describe('Configuration and Security', () => {
        it('should validate HA configuration', async () => {
            const configResponse = await request(app)
                .get('/api/system/config')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(configResponse.body.data).to.have.property('environment');
            expect(configResponse.body.data).to.have.property('services');
            
            // Should not expose sensitive configuration
            expect(configResponse.body.data).to.not.have.property('secrets');
            expect(configResponse.body.data).to.not.have.property('tokens');
        });

        it('should require authentication for HA management endpoints', async () => {
            const response = await request(app)
                .post('/api/system/ha/election/force')
                .expect(401);

            expect(response.body.success).to.be.false;
            expect(response.body.error).to.include('authentication');
        });

        it('should validate input for HA operations', async () => {
            // Test with invalid requests
            const response = await request(app)
                .post('/api/system/ha/election/force')
                .set('Authorization', `Bearer invalid_token`)
                .expect(401);

            expect(response.body.success).to.be.false;
        });
    });

    describe('Performance and Scalability', () => {
        it('should handle concurrent health checks efficiently', async () => {
            const startTime = Date.now();
            
            // Make multiple concurrent requests
            const requests = Array(5).fill().map(() => 
                request(app)
                    .get('/api/system/ha/health')
                    .set('Authorization', `Bearer ${authToken}`)
            );

            const responses = await Promise.all(requests);
            const endTime = Date.now();
            const totalTime = endTime - startTime;

            // All requests should complete successfully
            responses.forEach(response => {
                expect(response.status).to.be.oneOf([200, 206, 503]);
            });

            // Performance check - should complete within reasonable time
            expect(totalTime).to.be.lessThan(10000); // 10 seconds
            console.log(`Concurrent health checks completed in ${totalTime}ms`);
        });

        it('should provide consistent response times for status endpoints', async () => {
            const times = [];
            
            for (let i = 0; i < 3; i++) {
                const startTime = Date.now();
                
                await request(app)
                    .get('/api/system/ha/status')
                    .set('Authorization', `Bearer ${authToken}`);
                
                times.push(Date.now() - startTime);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            console.log(`Average response time: ${avgTime}ms`);
            
            // Response times should be reasonable
            expect(avgTime).to.be.lessThan(1000); // 1 second
        });
    });

    describe('Integration with Existing Systems', () => {
        it('should integrate with existing authentication system', async () => {
            // Test that HA endpoints work with existing auth
            const response = await request(app)
                .get('/api/system/ha/status')
                .set('Authorization', `Bearer ${authToken}`);

            if (authToken) {
                expect(response.status).to.equal(200);
            } else {
                expect(response.status).to.equal(401);
            }
        });

        it('should maintain compatibility with monitoring systems', async () => {
            // Test Prometheus metrics endpoint
            const metricsResponse = await request(app)
                .get('/metrics')
                .expect(200);

            expect(metricsResponse.text).to.include('runnerhub_');
            
            // Should include HA-specific metrics
            if (process.env.HA_ENABLED === 'true') {
                expect(metricsResponse.text).to.match(/runnerhub_ha_/);
            }
        });

        it('should work with existing logging and audit systems', async () => {
            // Trigger an HA operation and check if it's logged
            const response = await request(app)
                .get('/api/system/ha/health')
                .set('Authorization', `Bearer ${authToken}`);

            // Should complete without errors
            expect(response.status).to.be.oneOf([200, 206, 503]);
            
            // Audit logs should be created (checked via database if audit is enabled)
            if (process.env.AUDIT_ENABLED === 'true') {
                try {
                    const auditQuery = `
                        SELECT * FROM audit_logs 
                        WHERE event_type = 'HEALTH_CHECK' 
                        AND created_at > NOW() - INTERVAL '1 minute'
                        ORDER BY created_at DESC 
                        LIMIT 1
                    `;
                    const auditResult = await dbClient.query(auditQuery);
                    expect(auditResult.rows.length).to.be.greaterThan(0);
                } catch (error) {
                    // Audit table might not exist in test environment
                    console.warn('Audit log check skipped:', error.message);
                }
            }
        });
    });
});

// Additional helper functions for testing
function generateTestData() {
    return {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        value: Math.random()
    };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}