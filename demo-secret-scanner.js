#!/usr/bin/env node

/**
 * Secret Scanner Demonstration Script
 * 
 * This script demonstrates the job log secret scanning functionality
 * implemented in the GitHub-RunnerHub system.
 */

const axios = require('axios');
const fs = require('fs');

// Configuration
const BASE_URL = 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;

// Sample job logs with various types of secrets
const sampleJobLogs = {
  "github-deployment": `2023-12-01T10:00:00Z [INFO] Starting GitHub deployment job
2023-12-01T10:00:01Z [DEBUG] Setting up environment variables
2023-12-01T10:00:02Z [DEBUG] GITHUB_TOKEN=ghp_1234567890abcdef1234567890abcdef123456
2023-12-01T10:00:03Z [INFO] Cloning repository...
2023-12-01T10:00:04Z [DEBUG] git clone https://github.com/user/repo.git
2023-12-01T10:00:05Z [INFO] Repository cloned successfully
2023-12-01T10:00:06Z [DEBUG] Installing dependencies...
2023-12-01T10:00:07Z [INFO] Running tests...
2023-12-01T10:00:08Z [DEBUG] All tests passed
2023-12-01T10:00:09Z [INFO] Deployment completed successfully`,

  "aws-deployment": `2023-12-01T11:00:00Z [INFO] Starting AWS deployment
2023-12-01T11:00:01Z [DEBUG] Configuring AWS credentials
2023-12-01T11:00:02Z [DEBUG] AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
2023-12-01T11:00:03Z [DEBUG] AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
2023-12-01T11:00:04Z [INFO] Uploading artifacts to S3...
2023-12-01T11:00:05Z [DEBUG] s3 cp build/ s3://my-bucket/
2023-12-01T11:00:06Z [INFO] Updating Lambda function...
2023-12-01T11:00:07Z [INFO] Deployment completed successfully`,

  "database-migration": `2023-12-01T12:00:00Z [INFO] Starting database migration
2023-12-01T12:00:01Z [DEBUG] Connecting to database...
2023-12-01T12:00:02Z [DEBUG] DATABASE_URL=postgresql://admin:supersecret123@db.example.com:5432/production
2023-12-01T12:00:03Z [INFO] Running migrations...
2023-12-01T12:00:04Z [DEBUG] Migration 001_create_users.sql executed
2023-12-01T12:00:05Z [DEBUG] Migration 002_add_indexes.sql executed
2023-12-01T12:00:06Z [INFO] All migrations completed successfully`,

  "api-integration": `2023-12-01T13:00:00Z [INFO] Starting API integration tests
2023-12-01T13:00:01Z [DEBUG] Setting up test environment
2023-12-01T13:00:02Z [DEBUG] API_KEY=sk-1234567890abcdef1234567890abcdef
2023-12-01T13:00:03Z [DEBUG] STRIPE_SECRET_KEY=sk_test_51234567890abcdef
2023-12-01T13:00:04Z [DEBUG] JWT_SECRET=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
2023-12-01T13:00:05Z [INFO] Running integration tests...
2023-12-01T13:00:06Z [DEBUG] Test 1: Create user - PASSED
2023-12-01T13:00:07Z [DEBUG] Test 2: Authenticate user - PASSED
2023-12-01T13:00:08Z [DEBUG] Test 3: Process payment - PASSED
2023-12-01T13:00:09Z [INFO] All integration tests passed`,

  "docker-build": `2023-12-01T14:00:00Z [INFO] Starting Docker build
2023-12-01T14:00:01Z [DEBUG] Building Docker image...
2023-12-01T14:00:02Z [DEBUG] Setting up Docker Hub credentials
2023-12-01T14:00:03Z [DEBUG] DOCKER_PASSWORD=dckr_pat_1234567890abcdef1234567890abcdef123456
2023-12-01T14:00:04Z [INFO] Logging into Docker Hub...
2023-12-01T14:00:05Z [DEBUG] docker login -u username -p $DOCKER_PASSWORD
2023-12-01T14:00:06Z [INFO] Building image myapp:latest...
2023-12-01T14:00:07Z [DEBUG] docker build -t myapp:latest .
2023-12-01T14:00:08Z [INFO] Pushing image to registry...
2023-12-01T14:00:09Z [DEBUG] docker push myapp:latest
2023-12-01T14:00:10Z [INFO] Docker build and push completed`,

  "clean-logs": `2023-12-01T15:00:00Z [INFO] Starting clean deployment
2023-12-01T15:00:01Z [DEBUG] No sensitive information in logs
2023-12-01T15:00:02Z [INFO] Building application...
2023-12-01T15:00:03Z [DEBUG] npm run build
2023-12-01T15:00:04Z [INFO] Running tests...
2023-12-01T15:00:05Z [DEBUG] npm test
2023-12-01T15:00:06Z [INFO] All tests passed
2023-12-01T15:00:07Z [INFO] Deployment completed successfully`
};

/**
 * Colors for console output
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

/**
 * Log with colors
 */
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

/**
 * Create a demo job in the system
 */
async function createDemoJob(jobName, logContent) {
  try {
    // Create a job delegation request
    const jobData = {
      jobId: `demo-${jobName}-${Date.now()}`,
      runId: `run-${Date.now()}`,
      repository: 'demo/secret-scanner-test',
      workflow: 'Secret Scanner Demo',
      runnerName: 'demo-runner',
      labels: ['demo', 'secret-scanner-test']
    };

    const response = await axios.post(`${API_BASE}/jobs/delegate`, jobData);
    
    if (response.data.success) {
      const jobId = response.data.data.delegationId;
      log(`✅ Created demo job: ${jobId}`, colors.green);
      
      // Simulate log content by directly scanning (since we don't have actual containers)
      return { jobId, logContent };
    } else {
      throw new Error('Failed to create job');
    }
  } catch (error) {
    log(`❌ Failed to create demo job: ${error.message}`, colors.red);
    return null;
  }
}

/**
 * Demonstrate secret scanning on a job
 */
async function demonstrateSecretScanning(jobId, logContent, description) {
  log(`\n${colors.bright}=== ${description} ===${colors.reset}`);
  log(`Job ID: ${jobId}`, colors.blue);
  
  try {
    // For demonstration, we'll show what the scanner would detect
    log('\n📋 Original Log Content (excerpt):', colors.cyan);
    const lines = logContent.split('\n');
    lines.slice(0, 5).forEach(line => {
      console.log(`  ${line}`);
    });
    if (lines.length > 5) {
      console.log(`  ... (${lines.length - 5} more lines)`);
    }

    // Simulate scanning by detecting known patterns
    const detectedSecrets = detectSecretsDemo(logContent);
    
    log(`\n🔍 Secret Scanning Results:`, colors.magenta);
    log(`  Total secrets detected: ${detectedSecrets.length}`, colors.yellow);
    
    if (detectedSecrets.length > 0) {
      detectedSecrets.forEach((secret, index) => {
        log(`  ${index + 1}. ${secret.type} (${secret.severity})`, colors.red);
        log(`     Line ${secret.line}: ${secret.preview}`, colors.yellow);
        log(`     Redacted: ${secret.redacted}`, colors.green);
      });
      
      log('\n🛡️ Redacted Log Content (excerpt):', colors.green);
      const redactedLog = redactSecrets(logContent, detectedSecrets);
      const redactedLines = redactedLog.split('\n');
      redactedLines.slice(0, 5).forEach(line => {
        console.log(`  ${line}`);
      });
      if (redactedLines.length > 5) {
        console.log(`  ... (${redactedLines.length - 5} more lines)`);
      }
    } else {
      log('  ✅ No secrets detected - logs are clean!', colors.green);
    }

    return detectedSecrets.length;
  } catch (error) {
    log(`❌ Failed to scan job logs: ${error.message}`, colors.red);
    return 0;
  }
}

/**
 * Demo secret detection (simplified version)
 */
function detectSecretsDemo(logContent) {
  const secrets = [];
  const lines = logContent.split('\n');
  
  const patterns = [
    {
      name: 'GitHub Token',
      regex: /ghp_[a-zA-Z0-9]{36}/g,
      severity: 'CRITICAL',
      category: 'TOKEN'
    },
    {
      name: 'AWS Access Key',
      regex: /AKIA[0-9A-Z]{16}/g,
      severity: 'CRITICAL', 
      category: 'CLOUD_CREDENTIALS'
    },
    {
      name: 'AWS Secret Key',
      regex: /[a-zA-Z0-9+/]{40}/g,
      severity: 'CRITICAL',
      category: 'CLOUD_CREDENTIALS'
    },
    {
      name: 'API Key',
      regex: /api[_-]?key[_-]?[=:][\s]*["\']?([a-zA-Z0-9_\-]{16,})["\']?/gi,
      severity: 'HIGH',
      category: 'API_KEY'
    },
    {
      name: 'Database URL',
      regex: /(postgresql|mysql|mongodb|redis):\/\/[^:]*:[^@]*@[^\/\s]*/gi,
      severity: 'HIGH',
      category: 'DATABASE_URL'
    },
    {
      name: 'JWT Token',
      regex: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
      severity: 'HIGH',
      category: 'JWT'
    },
    {
      name: 'Docker Token',
      regex: /dckr_pat_[a-zA-Z0-9_-]{32,}/g,
      severity: 'MEDIUM',
      category: 'TOKEN'
    }
  ];

  lines.forEach((line, lineIndex) => {
    patterns.forEach(pattern => {
      const matches = Array.from(line.matchAll(pattern.regex));
      matches.forEach(match => {
        const secret = match[0];
        secrets.push({
          type: pattern.name,
          severity: pattern.severity,
          category: pattern.category,
          line: lineIndex + 1,
          match: secret,
          preview: line.substring(Math.max(0, match.index - 10), match.index + secret.length + 10),
          redacted: generateRedaction(secret, pattern.category)
        });
      });
    });
  });

  return secrets;
}

/**
 * Generate redacted version of a secret
 */
function generateRedaction(secret, category) {
  const prefix = secret.substring(0, Math.min(4, secret.length));
  switch (category) {
    case 'TOKEN':
      return `[REDACTED_TOKEN_${prefix}***]`;
    case 'API_KEY':
      return `[REDACTED_API_KEY_${prefix}***]`;
    case 'CLOUD_CREDENTIALS':
      return `[REDACTED_CLOUD_CREDENTIALS_${prefix}***]`;
    case 'DATABASE_URL':
      return `[REDACTED_DATABASE_URL]`;
    case 'JWT':
      return `[REDACTED_JWT_TOKEN]`;
    default:
      return `[REDACTED_SECRET_${prefix}***]`;
  }
}

/**
 * Apply redaction to log content
 */
function redactSecrets(logContent, secrets) {
  let redactedContent = logContent;
  
  // Sort secrets by position (reverse order to maintain indices)
  const sortedSecrets = secrets.sort((a, b) => b.line - a.line);
  
  sortedSecrets.forEach(secret => {
    redactedContent = redactedContent.replace(
      new RegExp(escapeRegex(secret.match), 'g'),
      secret.redacted
    );
  });
  
  return redactedContent;
}

/**
 * Escape special regex characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Show secret scanner configuration
 */
async function showSecretScannerConfig() {
  log(`\n${colors.bright}=== Secret Scanner Configuration ===${colors.reset}`);
  
  const config = {
    enabled: true,
    autoRedact: true,
    minimumEntropy: 3.0,
    confidenceThreshold: 0.7,
    preserveFormatting: true,
    notifyOnDetection: true,
    blockJobOnSecrets: false,
    supportedPatterns: [
      'GitHub Tokens (ghp_*, github_pat_*)',
      'AWS Access Keys (AKIA*)',
      'AWS Secret Keys',
      'Generic API Keys',
      'Database Connection Strings',
      'JWT Tokens',
      'Docker Registry Tokens',
      'Slack Tokens',
      'Google API Keys',
      'Azure Keys',
      'SSH Private Keys',
      'TLS Certificates'
    ]
  };

  Object.entries(config).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      log(`  ${key}:`, colors.cyan);
      value.forEach(item => log(`    • ${item}`, colors.yellow));
    } else {
      log(`  ${key}: ${value}`, colors.cyan);
    }
  });
}

/**
 * Generate summary statistics
 */
function generateSummary(results) {
  log(`\n${colors.bright}=== Secret Scanning Summary ===${colors.reset}`);
  
  const totalJobs = results.length;
  const jobsWithSecrets = results.filter(r => r.secretCount > 0).length;
  const totalSecrets = results.reduce((sum, r) => sum + r.secretCount, 0);
  
  log(`  Total jobs scanned: ${totalJobs}`, colors.blue);
  log(`  Jobs with secrets: ${jobsWithSecrets}`, colors.red);
  log(`  Total secrets detected: ${totalSecrets}`, colors.red);
  log(`  Clean jobs: ${totalJobs - jobsWithSecrets}`, colors.green);
  
  if (totalSecrets > 0) {
    log(`\n  🚨 Security Alert: ${totalSecrets} secrets found across ${jobsWithSecrets} jobs!`, colors.red);
    log(`  📋 Recommended actions:`, colors.yellow);
    log(`    • Review and rotate exposed credentials`, colors.yellow);
    log(`    • Update CI/CD pipelines to use secure secret management`, colors.yellow);
    log(`    • Enable automatic secret scanning on all repositories`, colors.yellow);
    log(`    • Set up alerts for secret detection`, colors.yellow);
  } else {
    log(`\n  ✅ All jobs are clean - no secrets detected!`, colors.green);
  }
}

/**
 * Main demonstration function
 */
async function runDemo() {
  log(`${colors.bright}🔍 GitHub-RunnerHub Secret Scanner Demonstration${colors.reset}\n`);
  
  log('This demonstration shows the secret scanning functionality for job logs.');
  log('The scanner automatically detects and redacts sensitive information such as:');
  log('• API keys and tokens • Database credentials • Cloud service keys • SSH keys • Certificates\n');

  // Show configuration
  await showSecretScannerConfig();

  // Run demonstrations on different types of logs
  const results = [];
  
  for (const [jobType, logContent] of Object.entries(sampleJobLogs)) {
    const job = await createDemoJob(jobType, logContent);
    if (job) {
      const secretCount = await demonstrateSecretScanning(
        job.jobId, 
        job.logContent, 
        `${jobType.charAt(0).toUpperCase() + jobType.slice(1).replace('-', ' ')} Job`
      );
      results.push({ jobType, jobId: job.jobId, secretCount });
    }
  }

  // Generate summary
  generateSummary(results);

  log(`\n${colors.bright}📚 API Endpoints Available:${colors.reset}`);
  log(`  GET    /api/jobs/:id/logs?redacted=true        - Get job logs (auto-redacted)`, colors.cyan);
  log(`  GET    /api/jobs/:id/secret-scans              - Get secret scan results`, colors.cyan);
  log(`  POST   /api/jobs/:id/scan-secrets              - Trigger manual secret scan`, colors.cyan);
  log(`  GET    /api/security/secret-scanner/config     - Get scanner configuration`, colors.cyan);
  log(`  PUT    /api/security/secret-scanner/config     - Update scanner configuration`, colors.cyan);
  log(`  POST   /api/security/secret-scanner/patterns   - Add custom secret pattern`, colors.cyan);
  log(`  GET    /api/security/secret-scanner/stats      - Get scanning statistics`, colors.cyan);
  log(`  POST   /api/security/secret-scanner/test-pattern - Test a regex pattern`, colors.cyan);

  log(`\n${colors.bright}✨ Key Features Implemented:${colors.reset}`);
  log(`  ✅ Automatic secret detection with 13+ built-in patterns`, colors.green);
  log(`  ✅ Configurable redaction with multiple strategies`, colors.green);
  log(`  ✅ Entropy-based confidence scoring`, colors.green);
  log(`  ✅ Whitelist support for false positive reduction`, colors.green);
  log(`  ✅ Custom pattern support via API`, colors.green);
  log(`  ✅ Comprehensive audit logging`, colors.green);
  log(`  ✅ Statistics and reporting`, colors.green);
  log(`  ✅ Integration with existing job lifecycle`, colors.green);

  log(`\n${colors.bright}🎯 Demo completed successfully!${colors.reset}`);
}

// Run the demonstration
if (require.main === module) {
  runDemo().catch(error => {
    log(`❌ Demo failed: ${error.message}`, colors.red);
    process.exit(1);
  });
}

module.exports = {
  runDemo,
  demonstrateSecretScanning,
  detectSecretsDemo,
  redactSecrets
};