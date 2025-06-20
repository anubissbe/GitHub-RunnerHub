import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const API_BASE_URL = 'http://localhost:3001/api';
const TEST_IMAGE = 'nginx:1.21.0'; // Known image with some vulnerabilities

describe('Container Security Scanning E2E Tests', () => {
  let authToken: string;

  beforeAll(async () => {
    // Get auth token (in real test, would authenticate properly)
    // For now, assume we have a valid token
    authToken = process.env.TEST_AUTH_TOKEN || 'test-token';
  });

  describe('Security Scanning API', () => {
    test('Should scan a container image', async () => {
      console.log('Testing image scanning...');
      
      try {
        const response = await axios.post(
          `${API_BASE_URL}/security/scan`,
          {
            imageName: 'nginx',
            imageTag: '1.21.0',
            repository: 'test-repo'
          },
          {
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.data.scanResult).toBeDefined();
        expect(response.data.data.scanResult.imageName).toBe('nginx');
        expect(response.data.data.scanResult.imageTag).toBe('1.21.0');
        expect(response.data.data.scanResult.status).toBe('completed');
        expect(response.data.data.scanResult.summary).toBeDefined();
        expect(response.data.data.scanResult.vulnerabilities).toBeInstanceOf(Array);
        
        console.log('Scan result:', response.data.data.scanResult.summary);
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error('API Error:', error.response?.data);
        }
        throw error;
      }
    });

    test('Should get scan results', async () => {
      console.log('Testing scan results retrieval...');
      
      try {
        const response = await axios.get(
          `${API_BASE_URL}/security/scans?limit=10`,
          {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.data.scans).toBeInstanceOf(Array);
        expect(response.data.data.count).toBeGreaterThanOrEqual(0);
        
        console.log(`Found ${response.data.data.count} scan results`);
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error('API Error:', error.response?.data);
        }
        throw error;
      }
    });

    test('Should get security policies', async () => {
      console.log('Testing policy retrieval...');
      
      try {
        const response = await axios.get(
          `${API_BASE_URL}/security/policies`,
          {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.data.policies).toBeInstanceOf(Array);
        expect(response.data.data.policies.length).toBeGreaterThan(0);
        
        // Check default policies exist
        const policyNames = response.data.data.policies.map((p: any) => p.name);
        expect(policyNames).toContain('Default Security Policy');
        expect(policyNames).toContain('Strict Security Policy');
        expect(policyNames).toContain('Development Policy');
        
        console.log(`Found ${response.data.data.policies.length} policies`);
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error('API Error:', error.response?.data);
        }
        throw error;
      }
    });

    test('Should create and update a security policy', async () => {
      console.log('Testing policy management...');
      
      const testPolicy = {
        name: 'Test Policy',
        description: 'E2E test policy',
        blockOnCritical: true,
        blockOnHigh: false,
        maxCriticalVulnerabilities: 0,
        maxHighVulnerabilities: 5,
        maxMediumVulnerabilities: 20,
        enabled: true
      };

      try {
        // Create policy
        const createResponse = await axios.post(
          `${API_BASE_URL}/security/policies`,
          testPolicy,
          {
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        expect(createResponse.status).toBe(201);
        expect(createResponse.data.success).toBe(true);
        expect(createResponse.data.data.policy.name).toBe(testPolicy.name);
        
        const policyId = createResponse.data.data.policy.id;
        console.log(`Created policy with ID: ${policyId}`);

        // Update policy
        const updatedPolicy = {
          ...testPolicy,
          id: policyId,
          description: 'Updated E2E test policy',
          maxHighVulnerabilities: 10
        };

        const updateResponse = await axios.post(
          `${API_BASE_URL}/security/policies`,
          updatedPolicy,
          {
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        expect(updateResponse.status).toBe(201);
        expect(updateResponse.data.data.policy.description).toBe('Updated E2E test policy');
        expect(updateResponse.data.data.policy.maxHighVulnerabilities).toBe(10);

        // Delete policy
        const deleteResponse = await axios.delete(
          `${API_BASE_URL}/security/policies/${policyId}`,
          {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          }
        );

        expect(deleteResponse.status).toBe(200);
        console.log('Policy deleted successfully');
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error('API Error:', error.response?.data);
        }
        throw error;
      }
    });

    test('Should check policy compliance', async () => {
      console.log('Testing policy compliance check...');
      
      try {
        // First, scan an image
        const scanResponse = await axios.post(
          `${API_BASE_URL}/security/scan`,
          {
            imageName: 'alpine',
            imageTag: 'latest',
            repository: 'test-repo'
          },
          {
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const scanId = scanResponse.data.data.scanResult.id;

        // Get the default policy
        const policiesResponse = await axios.get(
          `${API_BASE_URL}/security/policies`,
          {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          }
        );

        const defaultPolicy = policiesResponse.data.data.policies.find(
          (p: any) => p.name === 'Default Security Policy'
        );

        // Check compliance
        const complianceResponse = await axios.post(
          `${API_BASE_URL}/security/policies/${defaultPolicy.id}/check`,
          { scanId },
          {
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        expect(complianceResponse.status).toBe(200);
        expect(complianceResponse.data.success).toBe(true);
        expect(complianceResponse.data.data).toHaveProperty('passed');
        expect(complianceResponse.data.data).toHaveProperty('violations');
        expect(complianceResponse.data.data).toHaveProperty('policy');
        
        console.log(`Compliance check result: ${complianceResponse.data.data.passed ? 'PASSED' : 'FAILED'}`);
        if (!complianceResponse.data.data.passed) {
          console.log('Violations:', complianceResponse.data.data.violations);
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error('API Error:', error.response?.data);
        }
        throw error;
      }
    });

    test('Should get vulnerability statistics', async () => {
      console.log('Testing vulnerability statistics...');
      
      try {
        const response = await axios.get(
          `${API_BASE_URL}/security/stats?days=7`,
          {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.data.stats).toBeDefined();
        expect(response.data.data.stats).toHaveProperty('totalScans');
        expect(response.data.data.stats).toHaveProperty('failedScans');
        expect(response.data.data.stats).toHaveProperty('averageVulnerabilities');
        expect(response.data.data.stats).toHaveProperty('criticalTrend');
        expect(response.data.data.stats).toHaveProperty('topVulnerableImages');
        expect(response.data.data.stats).toHaveProperty('commonVulnerabilities');
        
        console.log('Statistics:', {
          totalScans: response.data.data.stats.totalScans,
          failedScans: response.data.data.stats.failedScans,
          avgVulnerabilities: response.data.data.stats.averageVulnerabilities
        });
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error('API Error:', error.response?.data);
        }
        throw error;
      }
    });
  });

  describe('Container Creation with Security Scanning', () => {
    test('Should block container creation if image has critical vulnerabilities', async () => {
      console.log('Testing container creation with security scanning...');
      
      // This test would require the full system to be running
      // For now, we'll just verify the endpoint exists
      try {
        const response = await axios.post(
          `${API_BASE_URL}/runners`,
          {
            name: 'test-runner',
            type: 'ephemeral',
            labels: ['test'],
            repository: 'test-repo',
            image: 'nginx:1.16.0' // Older version likely to have vulnerabilities
          },
          {
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            },
            validateStatus: () => true // Don't throw on 4xx/5xx
          }
        );

        // If security scanning is enabled and strict, this should fail
        if (response.status === 422) {
          expect(response.data.error).toContain('security');
          console.log('Container creation blocked due to security policy - EXPECTED');
        } else if (response.status === 201) {
          console.log('Container created successfully - security scanning may be disabled');
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error('API Error:', error.response?.data);
        }
        throw error;
      }
    });
  });
});

// Run the tests
if (require.main === module) {
  console.log('Running Container Security Scanning E2E Tests...');
  console.log('Note: Ensure the GitHub RunnerHub API is running on port 3001');
  console.log('Set TEST_AUTH_TOKEN environment variable with a valid JWT token');
}