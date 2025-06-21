#!/usr/bin/env ts-node

import { SecurityScanner } from '../src/services/security-scanner';
import { createLogger } from '../src/utils/logger';

const logger = createLogger('SecurityScanningTest');

async function testSecurityScanning() {
  logger.info('Starting security scanning test...');

  try {
    // Initialize security scanner
    const scanner = SecurityScanner.getInstance();
    await scanner.initialize();
    logger.info('Security scanner initialized');

    // Test 1: Scan a known good image
    logger.info('Test 1: Scanning alpine:latest...');
    const alpineResult = await scanner.scanImage({
      imageId: 'alpine:latest',
      imageName: 'alpine',
      imageTag: 'latest',
      repository: 'test-repo',
      username: 'test-user'
    });
    
    logger.info('Alpine scan completed:', {
      scanId: alpineResult.id,
      duration: alpineResult.scanDuration,
      summary: alpineResult.summary
    });

    // Test 2: Scan an image with known vulnerabilities
    logger.info('Test 2: Scanning older nginx image...');
    const nginxResult = await scanner.scanImage({
      imageId: 'nginx:1.16.0',
      imageName: 'nginx',
      imageTag: '1.16.0',
      repository: 'test-repo',
      username: 'test-user'
    });
    
    logger.info('Nginx scan completed:', {
      scanId: nginxResult.id,
      duration: nginxResult.scanDuration,
      summary: nginxResult.summary
    });

    // Test 3: Test policy management
    logger.info('Test 3: Testing policy management...');
    
    // Get existing policies
    const policies = await scanner.getPolicies();
    logger.info(`Found ${policies.length} policies`);
    
    // Create a test policy
    const testPolicy = await scanner.upsertPolicy({
      name: 'Test Policy',
      description: 'Test policy for manual testing',
      blockOnCritical: true,
      blockOnHigh: false,
      maxCriticalVulnerabilities: 0,
      maxHighVulnerabilities: 5,
      maxMediumVulnerabilities: 20,
      exemptCVEs: [],
      requiredLabels: [],
      trustedRegistries: ['docker.io'],
      enabled: true
    });
    
    logger.info('Created test policy:', { policyId: testPolicy.id });

    // Test 4: Check policy compliance
    logger.info('Test 4: Checking policy compliance...');
    
    const complianceCheck = await scanner.checkPolicy(nginxResult, testPolicy.id);
    logger.info('Policy compliance check:', {
      passed: complianceCheck.passed,
      violations: complianceCheck.violations
    });

    // Test 5: Get vulnerability statistics
    logger.info('Test 5: Getting vulnerability statistics...');
    
    const stats = await scanner.getVulnerabilityStats(7);
    logger.info('Vulnerability statistics:', {
      totalScans: stats.totalScans,
      failedScans: stats.failedScans,
      averageVulnerabilities: stats.averageVulnerabilities,
      criticalTrendCount: stats.criticalTrend.length,
      topVulnerableCount: stats.topVulnerableImages.length
    });

    // Test 6: Test caching
    logger.info('Test 6: Testing scan caching...');
    
    const startTime = Date.now();
    await scanner.scanImage({
      imageId: 'alpine:latest',
      imageName: 'alpine',
      imageTag: 'latest',
      repository: 'test-repo',
      username: 'test-user'
    });
    
    const cacheTime = Date.now() - startTime;
    logger.info('Cached scan retrieved in:', { timeMs: cacheTime });

    // Test 7: Force scan (bypass cache)
    logger.info('Test 7: Testing force scan...');
    
    const forceStartTime = Date.now();
    await scanner.scanImage({
      imageId: 'alpine:latest',
      imageName: 'alpine',
      imageTag: 'latest',
      repository: 'test-repo',
      username: 'test-user',
      force: true
    });
    
    const forceTime = Date.now() - forceStartTime;
    logger.info('Forced scan completed in:', { timeMs: forceTime });

    logger.info('All security scanning tests completed successfully!');

  } catch (error) {
    logger.error('Security scanning test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testSecurityScanning().then(() => {
    logger.info('Test completed');
    process.exit(0);
  }).catch(error => {
    logger.error('Test failed:', error);
    process.exit(1);
  });
}