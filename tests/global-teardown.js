/**
 * Global Jest Teardown
 * Runs once after all tests
 */

const { Client } = require('pg');
const Redis = require('ioredis');

module.exports = async () => {
  console.log('Tearing down test environment...');
  
  // Clean up test Redis
  try {
    const redis = new Redis({
      host: process.env.TEST_REDIS_HOST || 'localhost',
      port: process.env.TEST_REDIS_PORT || 6379,
      maxRetriesPerRequest: 1,
      retryDelayOnFailover: 100,
      lazyConnect: true
    });
    
    await redis.connect();
    await redis.flushdb(); // Clear test data
    await redis.quit();
    console.log('Redis cleanup complete');
  } catch (error) {
    console.warn('Redis cleanup warning:', error.message);
  }
  
  // Clean up test database
  try {
    const dbUrl = process.env.TEST_DATABASE_URL || 'postgresql://test_user:test_password@localhost:5432/github_runnerhub_test';
    const dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();
    
    // Clean up test data but keep database for faster subsequent runs
    await dbClient.query('TRUNCATE TABLE users, jobs, runners, audit_logs CASCADE');
    console.log('Database cleanup complete');
    
    await dbClient.end();
  } catch (error) {
    console.warn('Database cleanup warning:', error.message);
  }
  
  console.log('Test environment teardown complete');
};