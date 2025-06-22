/**
 * Artillery Load Test Processor
 * Custom functions for load testing scenarios
 */

const crypto = require('crypto');

module.exports = {
  // Generate random data for tests
  generateRandomData,
  
  // Custom authentication
  customAuth,
  
  // Performance tracking
  trackPerformance,
  
  // Error handling
  handleErrors,
  
  // Setup and teardown
  beforeTest,
  afterTest
};

/**
 * Generate random test data
 */
function generateRandomData(requestParams, context, ee, next) {
  context.vars.random_id = crypto.randomUUID();
  context.vars.random_repo = `test-repo-${Math.floor(Math.random() * 1000)}`;
  context.vars.random_workflow = `workflow-${Math.floor(Math.random() * 100)}`;
  context.vars.timestamp = Date.now();
  
  return next();
}

/**
 * Custom authentication handler
 */
function customAuth(requestParams, context, ee, next) {
  // Set custom auth headers or modify request
  if (context.vars.auth_token) {
    requestParams.headers = requestParams.headers || {};
    requestParams.headers['Authorization'] = `Bearer ${context.vars.auth_token}`;
  }
  
  return next();
}

/**
 * Track performance metrics
 */
function trackPerformance(requestParams, response, context, ee, next) {
  if (response.timings) {
    const totalTime = response.timings.phases.total;
    
    // Emit custom metrics
    ee.emit('counter', 'custom.response_time', totalTime);
    
    // Track slow responses
    if (totalTime > 1000) {
      ee.emit('counter', 'custom.slow_responses', 1);
    }
    
    // Track by status code
    ee.emit('counter', `custom.status_${response.statusCode}`, 1);
  }
  
  return next();
}

/**
 * Handle and track errors
 */
function handleErrors(requestParams, response, context, ee, next) {
  if (response.statusCode >= 400) {
    context.vars.error_count = (context.vars.error_count || 0) + 1;
    
    // Track specific error types
    if (response.statusCode === 401) {
      ee.emit('counter', 'custom.auth_errors', 1);
    } else if (response.statusCode === 429) {
      ee.emit('counter', 'custom.rate_limit_errors', 1);
    } else if (response.statusCode >= 500) {
      ee.emit('counter', 'custom.server_errors', 1);
    }
    
    // Log error details for debugging
    console.log(`Error ${response.statusCode}: ${requestParams.url}`);
  }
  
  return next();
}

/**
 * Setup before test
 */
function beforeTest(context, ee, next) {
  console.log('Starting load test...');
  context.vars.test_start_time = Date.now();
  
  // Initialize counters
  context.vars.request_count = 0;
  context.vars.error_count = 0;
  
  return next();
}

/**
 * Cleanup after test
 */
function afterTest(context, ee, next) {
  const testDuration = Date.now() - context.vars.test_start_time;
  console.log(`Test completed in ${testDuration}ms`);
  console.log(`Total requests: ${context.vars.request_count}`);
  console.log(`Total errors: ${context.vars.error_count}`);
  
  return next();
}