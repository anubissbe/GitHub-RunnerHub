/**
 * Network Isolation E2E Test Suite
 * Tests the complete network isolation functionality
 */

const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';

let authToken = null;

// Helper functions
async function login() {
  try {
    const response = await axios.post(`${API_URL}/api/auth/login`, {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD
    });
    authToken = response.data.data.token;
    console.log('✅ Authentication successful');
    return authToken;
  } catch (error) {
    console.error('❌ Authentication failed:', error.response?.data || error.message);
    throw error;
  }
}

async function createNetwork(repository) {
  try {
    const response = await axios.post(
      `${API_URL}/api/networks`,
      { repository },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    console.log(`✅ Created network for repository: ${repository}`);
    return response.data.data.network;
  } catch (error) {
    console.error('❌ Network creation failed:', error.response?.data || error.message);
    throw error;
  }
}

async function listNetworks() {
  try {
    const response = await axios.get(`${API_URL}/api/networks`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return response.data.data.networks;
  } catch (error) {
    console.error('❌ Failed to list networks:', error.response?.data || error.message);
    throw error;
  }
}

async function getNetworkStats() {
  try {
    const response = await axios.get(`${API_URL}/api/networks/stats`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return response.data.data;
  } catch (error) {
    console.error('❌ Failed to get network stats:', error.response?.data || error.message);
    throw error;
  }
}

async function attachContainer(containerId, repository) {
  try {
    const response = await axios.post(
      `${API_URL}/api/networks/attach`,
      { containerId, repository },
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    console.log(`✅ Attached container ${containerId} to network for ${repository}`);
    return response.data;
  } catch (error) {
    console.error('❌ Container attachment failed:', error.response?.data || error.message);
    throw error;
  }
}

async function verifyIsolation(containerId) {
  try {
    const response = await axios.get(
      `${API_URL}/api/networks/verify-isolation?containerId=${containerId}`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    return response.data.data;
  } catch (error) {
    console.error('❌ Isolation verification failed:', error.response?.data || error.message);
    throw error;
  }
}

async function cleanupNetworks() {
  try {
    const response = await axios.post(
      `${API_URL}/api/networks/cleanup`,
      {},
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    console.log('✅ Network cleanup completed');
    return response.data.data;
  } catch (error) {
    console.error('❌ Network cleanup failed:', error.response?.data || error.message);
    throw error;
  }
}

// Docker helper functions
async function createTestContainer(name) {
  try {
    const { stdout } = await execAsync(`docker run -d --name ${name} alpine sleep 3600`);
    const containerId = stdout.trim();
    console.log(`✅ Created test container: ${name} (${containerId.substring(0, 12)})`);
    return containerId;
  } catch (error) {
    console.error(`❌ Failed to create container ${name}:`, error.message);
    throw error;
  }
}

async function removeTestContainer(name) {
  try {
    await execAsync(`docker rm -f ${name}`);
    console.log(`✅ Removed test container: ${name}`);
  } catch (error) {
    // Ignore if container doesn't exist
    if (!error.message.includes('No such container')) {
      console.error(`❌ Failed to remove container ${name}:`, error.message);
    }
  }
}

async function testContainerConnectivity(container1, container2) {
  try {
    // Get IP of container2
    const { stdout: ip } = await execAsync(
      `docker inspect ${container2} -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' | head -n1`
    );
    const targetIP = ip.trim();
    
    if (!targetIP) {
      console.log('⚠️  Container has no IP address (expected for isolated container)');
      return false;
    }

    // Try to ping from container1 to container2
    const { stdout } = await execAsync(`docker exec ${container1} ping -c 1 -W 2 ${targetIP} 2>&1 || true`);
    const canConnect = stdout.includes('1 packets transmitted, 1 received');
    
    console.log(`🔍 Connectivity test: ${container1} -> ${container2} (${targetIP}): ${canConnect ? 'CONNECTED' : 'ISOLATED'}`);
    return canConnect;
  } catch (error) {
    console.error('❌ Connectivity test failed:', error.message);
    return false;
  }
}

// Main test suite
async function runTests() {
  console.log('🚀 Starting Network Isolation E2E Tests\n');

  let testsPassed = 0;
  let testsFailed = 0;
  let container1Id = null;
  let container2Id = null;
  let container3Id = null;

  try {
    // Test 1: Authentication
    console.log('📋 Test 1: Authentication');
    await login();
    testsPassed++;

    // Test 2: Create Networks
    console.log('\n📋 Test 2: Create Networks for Different Repositories');
    const network1 = await createNetwork('test-org/repo1');
    const network2 = await createNetwork('test-org/repo2');
    
    if (network1.id && network2.id) {
      console.log('✅ Networks created successfully');
      testsPassed++;
    } else {
      throw new Error('Network creation failed');
    }

    // Test 3: List Networks
    console.log('\n📋 Test 3: List Networks');
    const networks = await listNetworks();
    
    if (networks.length >= 2) {
      console.log(`✅ Found ${networks.length} networks`);
      testsPassed++;
    } else {
      throw new Error('Expected at least 2 networks');
    }

    // Test 4: Network Statistics
    console.log('\n📋 Test 4: Network Statistics');
    const stats = await getNetworkStats();
    
    if (stats.totalNetworks >= 2) {
      console.log(`✅ Network stats: ${stats.totalNetworks} total, ${stats.activeNetworks} active`);
      testsPassed++;
    } else {
      throw new Error('Invalid network statistics');
    }

    // Test 5: Container Attachment
    console.log('\n📋 Test 5: Container Attachment to Networks');
    
    // Create test containers
    container1Id = await createTestContainer('test-container-1');
    container2Id = await createTestContainer('test-container-2');
    container3Id = await createTestContainer('test-container-3');

    // Attach containers to networks
    await attachContainer(container1Id, 'test-org/repo1');
    await attachContainer(container2Id, 'test-org/repo1'); // Same network
    await attachContainer(container3Id, 'test-org/repo2'); // Different network

    console.log('✅ All containers attached to networks');
    testsPassed++;

    // Test 6: Verify Isolation
    console.log('\n📋 Test 6: Verify Network Isolation');
    
    const isolation1 = await verifyIsolation(container1Id);
    const isolation3 = await verifyIsolation(container3Id);
    
    if (isolation1.isolated && isolation3.isolated) {
      console.log('✅ Containers are properly isolated');
      testsPassed++;
    } else {
      throw new Error('Container isolation verification failed');
    }

    // Test 7: Connectivity Test
    console.log('\n📋 Test 7: Container Connectivity Test');
    
    // Wait a moment for network changes to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Containers in same network should connect
    const canConnect12 = await testContainerConnectivity('test-container-1', 'test-container-2');
    
    // Containers in different networks should NOT connect
    const canConnect13 = await testContainerConnectivity('test-container-1', 'test-container-3');
    
    if (canConnect12 && !canConnect13) {
      console.log('✅ Network isolation working correctly:');
      console.log('   - Containers in same network CAN communicate');
      console.log('   - Containers in different networks CANNOT communicate');
      testsPassed++;
    } else {
      console.log('❌ Network isolation test failed:');
      console.log(`   - Same network connectivity: ${canConnect12} (expected: true)`);
      console.log(`   - Different network connectivity: ${canConnect13} (expected: false)`);
      testsFailed++;
    }

    // Test 8: Network Cleanup
    console.log('\n📋 Test 8: Network Cleanup');
    
    // Remove containers first
    await removeTestContainer('test-container-1');
    await removeTestContainer('test-container-2');
    await removeTestContainer('test-container-3');
    
    // Run cleanup
    const cleanupResult = await cleanupNetworks();
    console.log(`✅ Cleanup completed: ${cleanupResult.networksRemoved || 0} networks removed`);
    testsPassed++;

    // Test 9: RBAC Enforcement
    console.log('\n📋 Test 9: RBAC Enforcement');
    
    try {
      // Try with viewer token (should fail)
      const viewerResponse = await axios.post(`${API_URL}/api/auth/login`, {
        username: 'viewer',
        password: 'viewer123'
      });
      const viewerToken = viewerResponse.data.data.token;
      
      try {
        await axios.post(
          `${API_URL}/api/networks`,
          { repository: 'test-org/repo-viewer' },
          { headers: { Authorization: `Bearer ${viewerToken}` } }
        );
        console.log('❌ RBAC test failed: Viewer was able to create network');
        testsFailed++;
      } catch (error) {
        if (error.response?.status === 403) {
          console.log('✅ RBAC working correctly: Viewer cannot create networks');
          testsPassed++;
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('❌ RBAC test failed:', error.message);
      testsFailed++;
    }

  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
    testsFailed++;
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up test resources...');
    await removeTestContainer('test-container-1');
    await removeTestContainer('test-container-2');
    await removeTestContainer('test-container-3');
  }

  // Summary
  console.log('\n📊 Test Summary');
  console.log('================');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📋 Total: ${testsPassed + testsFailed}`);
  console.log(`🎯 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});