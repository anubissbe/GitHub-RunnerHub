/**
 * Audit Logging E2E Test Suite
 * Tests the complete audit logging functionality
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'operator123';
const VIEWER_USERNAME = 'viewer';
const VIEWER_PASSWORD = 'viewer123';

let adminToken = null;
let operatorToken = null;
let viewerToken = null;

// Helper functions
async function login(username, password) {
  try {
    const response = await axios.post(`${API_URL}/api/auth/login`, {
      username,
      password
    });
    return response.data.data.token;
  } catch (error) {
    console.error(`❌ Login failed for ${username}:`, error.response?.data || error.message);
    throw error;
  }
}

async function generateTestEvents() {
  const events = [];
  
  // Generate some test login events
  for (let i = 0; i < 5; i++) {
    try {
      await axios.post(`${API_URL}/api/auth/login`, {
        username: 'nonexistent',
        password: 'wrongpassword'
      });
    } catch (error) {
      // Expected to fail
      events.push('Failed login attempt');
    }
  }

  // Generate some successful operations
  try {
    // Create a job (requires operator token)
    const jobResponse = await axios.post(
      `${API_URL}/api/jobs/delegate`,
      {
        repository: 'test-org/test-repo',
        workflow: 'test-workflow',
        jobId: uuidv4(),
        runId: Math.floor(Math.random() * 1000000)
      },
      { headers: { Authorization: `Bearer ${operatorToken}` } }
    );
    events.push('Job created');
  } catch (error) {
    console.error('Failed to create job:', error.response?.data || error.message);
  }

  return events;
}

// Main test suite
async function runTests() {
  console.log('🚀 Starting Audit Logging E2E Tests\n');

  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // Test 1: Authentication and Setup
    console.log('📋 Test 1: Authentication Setup');
    try {
      adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
      operatorToken = await login(OPERATOR_USERNAME, OPERATOR_PASSWORD);
      viewerToken = await login(VIEWER_USERNAME, VIEWER_PASSWORD);
      
      console.log('✅ All users authenticated successfully');
      testsPassed++;
    } catch (error) {
      console.error('❌ Authentication failed');
      testsFailed++;
      return;
    }

    // Test 2: Generate Test Events
    console.log('\n📋 Test 2: Generate Test Audit Events');
    try {
      const events = await generateTestEvents();
      console.log(`✅ Generated ${events.length} test events`);
      testsPassed++;
      
      // Wait for events to be flushed to database
      await new Promise(resolve => setTimeout(resolve, 6000));
    } catch (error) {
      console.error('❌ Failed to generate test events:', error.message);
      testsFailed++;
    }

    // Test 3: Query Audit Logs
    console.log('\n📋 Test 3: Query Audit Logs');
    try {
      const response = await axios.get(`${API_URL}/api/audit/logs`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
        params: {
          limit: 20,
          categories: 'authentication'
        }
      });

      const { logs, count } = response.data.data;
      console.log(`✅ Retrieved ${count} audit logs`);
      
      // Verify we have authentication events
      const authEvents = logs.filter(log => log.category === 'authentication');
      if (authEvents.length > 0) {
        console.log(`   - Found ${authEvents.length} authentication events`);
        testsPassed++;
      } else {
        console.error('❌ No authentication events found');
        testsFailed++;
      }
    } catch (error) {
      console.error('❌ Failed to query audit logs:', error.response?.data || error.message);
      testsFailed++;
    }

    // Test 4: Get Audit Statistics
    console.log('\n📋 Test 4: Get Audit Statistics');
    try {
      const response = await axios.get(`${API_URL}/api/audit/stats`, {
        headers: { Authorization: `Bearer ${viewerToken}` }
      });

      const { stats } = response.data.data;
      console.log('✅ Retrieved audit statistics:');
      console.log(`   - Total events: ${stats.totalEvents}`);
      console.log(`   - Failure rate: ${stats.failureRate}%`);
      console.log(`   - Top users: ${stats.topUsers.map(u => u.username).join(', ')}`);
      
      if (stats.totalEvents > 0) {
        testsPassed++;
      } else {
        console.error('❌ No events in statistics');
        testsFailed++;
      }
    } catch (error) {
      console.error('❌ Failed to get audit stats:', error.response?.data || error.message);
      testsFailed++;
    }

    // Test 5: Security Events (Admin Only)
    console.log('\n📋 Test 5: Get Security Events (Admin Only)');
    try {
      // Try with viewer token (should fail)
      try {
        await axios.get(`${API_URL}/api/audit/security`, {
          headers: { Authorization: `Bearer ${viewerToken}` }
        });
        console.error('❌ Viewer was able to access security events');
        testsFailed++;
      } catch (error) {
        if (error.response?.status === 403) {
          console.log('✅ Viewer correctly denied access to security events');
        }
      }

      // Try with admin token (should succeed)
      const response = await axios.get(`${API_URL}/api/audit/security`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      const { events, summary } = response.data.data;
      console.log('✅ Admin retrieved security events:');
      console.log(`   - Critical: ${summary.critical}`);
      console.log(`   - Error: ${summary.error}`);
      console.log(`   - Warning: ${summary.warning}`);
      testsPassed++;
    } catch (error) {
      console.error('❌ Failed to get security events:', error.response?.data || error.message);
      testsFailed++;
    }

    // Test 6: Export Audit Logs
    console.log('\n📋 Test 6: Export Audit Logs');
    try {
      // Export as JSON
      const jsonResponse = await axios.get(`${API_URL}/api/audit/export`, {
        headers: { Authorization: `Bearer ${operatorToken}` },
        params: {
          format: 'json',
          limit: 10
        }
      });

      const jsonData = JSON.parse(jsonResponse.data);
      console.log(`✅ Exported ${jsonData.length} events as JSON`);

      // Export as CSV
      const csvResponse = await axios.get(`${API_URL}/api/audit/export`, {
        headers: { Authorization: `Bearer ${operatorToken}` },
        params: {
          format: 'csv',
          limit: 10
        }
      });

      const csvLines = csvResponse.data.split('\n');
      console.log(`✅ Exported ${csvLines.length - 1} events as CSV`);
      testsPassed++;
    } catch (error) {
      console.error('❌ Failed to export audit logs:', error.response?.data || error.message);
      testsFailed++;
    }

    // Test 7: User Activity Tracking
    console.log('\n📋 Test 7: User Activity Tracking');
    try {
      // Get admin user ID from token (decode JWT)
      const tokenParts = adminToken.split('.');
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      const userId = payload.sub;

      const response = await axios.get(`${API_URL}/api/audit/users/${userId}`, {
        headers: { Authorization: `Bearer ${operatorToken}` }
      });

      const { events, summary } = response.data.data;
      console.log(`✅ Retrieved activity for user ${userId}:`);
      console.log(`   - Total actions: ${summary.totalActions}`);
      console.log(`   - Success rate: ${(summary.successfulActions / summary.totalActions * 100).toFixed(1)}%`);
      console.log(`   - Last activity: ${summary.lastActivity}`);
      testsPassed++;
    } catch (error) {
      console.error('❌ Failed to get user activity:', error.response?.data || error.message);
      testsFailed++;
    }

    // Test 8: Event Types Metadata
    console.log('\n📋 Test 8: Get Event Types Metadata');
    try {
      const response = await axios.get(`${API_URL}/api/audit/event-types`, {
        headers: { Authorization: `Bearer ${viewerToken}` }
      });

      const { eventTypes, categories, severities } = response.data.data;
      console.log('✅ Retrieved event metadata:');
      console.log(`   - Event types: ${eventTypes.length}`);
      console.log(`   - Categories: ${categories.length}`);
      console.log(`   - Severities: ${severities.length}`);
      testsPassed++;
    } catch (error) {
      console.error('❌ Failed to get event types:', error.response?.data || error.message);
      testsFailed++;
    }

    // Test 9: Suspicious Activity Detection
    console.log('\n📋 Test 9: Trigger Suspicious Activity Detection');
    try {
      // Generate rapid failed login attempts
      const attempts = [];
      for (let i = 0; i < 6; i++) {
        attempts.push(
          axios.post(`${API_URL}/api/auth/login`, {
            username: 'suspicioususer',
            password: 'wrongpassword'
          }).catch(() => {})
        );
      }
      await Promise.all(attempts);

      // Wait for events to be processed
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check security events
      const response = await axios.get(`${API_URL}/api/audit/security`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        params: {
          includeLowSeverity: false
        }
      });

      const failedLogins = response.data.data.events.filter(
        e => e.eventType === 'user.login.failed' && e.username === 'suspicioususer'
      );

      if (failedLogins.length >= 5) {
        console.log('✅ Suspicious activity detected:');
        console.log(`   - ${failedLogins.length} failed login attempts recorded`);
        testsPassed++;
      } else {
        console.error('❌ Suspicious activity not properly detected');
        testsFailed++;
      }
    } catch (error) {
      console.error('❌ Failed to test suspicious activity:', error.response?.data || error.message);
      testsFailed++;
    }

    // Test 10: Audit Log Cleanup (Admin Only)
    console.log('\n📋 Test 10: Audit Log Cleanup (Admin Only)');
    try {
      // This would delete old logs, so we'll use a high retention period for safety
      const response = await axios.post(
        `${API_URL}/api/audit/cleanup`,
        { retentionDays: 365 },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );

      const { deletedCount, cutoffDate } = response.data.data;
      console.log('✅ Cleanup completed:');
      console.log(`   - Deleted: ${deletedCount} old events`);
      console.log(`   - Cutoff date: ${cutoffDate}`);
      testsPassed++;
    } catch (error) {
      console.error('❌ Failed to cleanup audit logs:', error.response?.data || error.message);
      testsFailed++;
    }

  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
    testsFailed++;
  }

  // Summary
  console.log('\n📊 Test Summary');
  console.log('================');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📋 Total: ${testsPassed + testsFailed}`);
  console.log(`🎯 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);

  // Performance Note
  console.log('\n⚡ Performance Metrics:');
  console.log('- Audit events are buffered for 5 seconds before database write');
  console.log('- Critical events are flushed immediately');
  console.log('- Export supports up to 10,000 records per request');

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});