/**
 * Global Jest Setup
 * Runs once before all tests
 */

const { Client } = require('pg');
const Redis = require('ioredis');

module.exports = async () => {
  console.log('Setting up test environment...');
  
  // Set up test database
  try {
    const dbUrl = process.env.TEST_DATABASE_URL || 'postgresql://test_user:test_password@localhost:5432/postgres';
    const dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();
    
    // Create test database if it doesn't exist
    try {
      await dbClient.query('CREATE DATABASE github_runnerhub_test');
      console.log('Created test database');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        console.warn('Database creation warning:', error.message);
      }
    }
    
    await dbClient.end();
  } catch (error) {
    console.warn('Database setup warning:', error.message);
  }
  
  // Set up test Redis (if available)
  try {
    const redis = new Redis({
      host: process.env.TEST_REDIS_HOST || 'localhost',
      port: process.env.TEST_REDIS_PORT || 6379,
      maxRetriesPerRequest: 1,
      retryDelayOnFailover: 100,
      lazyConnect: true
    });
    
    await redis.connect();
    await redis.flushdb(); // Clear test Redis
    await redis.quit();
    console.log('Redis test setup complete');
  } catch (error) {
    console.warn('Redis setup warning:', error.message);
  }
  
  console.log('Test environment setup complete');
};