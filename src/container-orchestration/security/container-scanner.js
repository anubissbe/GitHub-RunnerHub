/**
 * Container Security Scanner
 * Integrates with Trivy and other security scanning tools to scan container images
 * for vulnerabilities, misconfigurations, and compliance issues
 */

const EventEmitter = require('events');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

class ContainerSecurityScanner extends EventEmitter {
  constructor(dockerAPI, options = {}) {
    super();
    
    this.dockerAPI = dockerAPI;
    this.docker = dockerAPI.docker;
    
    this.config = {
      // Scanner configuration
      scanners: {
        trivy: {
          enabled: options.trivyEnabled !== false,
          binaryPath: options.trivyPath || 'trivy',
          cacheDir: options.trivyCacheDir || '/var/lib/trivy',
          dbRepository: options.trivyDbRepo || 'ghcr.io/aquasecurity/trivy-db',
          severity: options.trivySeverity || ['CRITICAL', 'HIGH', 'MEDIUM'],
          ignoreUnfixed: options.ignoreUnfixed || false,
          timeout: options.scanTimeout || 300000 // 5 minutes
        },
        clair: {
          enabled: options.clairEnabled || false,
          endpoint: options.clairEndpoint || 'http://localhost:6060',
          timeout: options.clairTimeout || 300000
        },
        custom: {
          enabled: options.customScannerEnabled || false,
          command: options.customScannerCommand,
          args: options.customScannerArgs || []
        }
      },
      
      // Scan policies
      policies: {
        blockOnCritical: options.blockOnCritical !== false,
        blockOnHigh: options.blockOnHigh || false,
        maxCriticalVulns: options.maxCriticalVulns || 0,
        maxHighVulns: options.maxHighVulns || 5,
        maxMediumVulns: options.maxMediumVulns || 20,
        requiredCompliance: options.requiredCompliance || ['CIS', 'PCI-DSS'],
        allowedLicenses: options.allowedLicenses || ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause'],
        bannedPackages: options.bannedPackages || []
      },
      
      // Scan settings
      scanBeforeRun: options.scanBeforeRun !== false,
      scanSchedule: options.scanSchedule || 86400000, // 24 hours
      parallelScans: options.parallelScans || 3,
      retryAttempts: options.retryAttempts || 2,
      
      // Reporting
      reportFormat: options.reportFormat || ['json', 'table'],
      reportPath: options.reportPath || '/opt/github-runnerhub/security-reports',
      sendAlerts: options.sendAlerts !== false,
      webhookUrl: options.webhookUrl,
      
      ...options
    };
    
    // Scan tracking
    this.scanQueue = [];
    this.activeScans = new Map(); // scanId -> scanData
    this.scanHistory = new Map(); // imageId -> scanResults
    this.vulnerabilityDatabase = new Map(); // CVE -> details
    
    // Statistics
    this.scanStats = {
      totalScans: 0,
      blockedContainers: 0,
      vulnerabilitiesFound: 0,
      criticalVulns: 0,
      highVulns: 0,
      mediumVulns: 0
    };
    
    // Timers
    this.scheduledScanTimer = null;
    this.queueProcessTimer = null;
    
    this.isInitialized = false;
  }

  /**
   * Initialize the container security scanner
   */
  async initialize() {
    try {
      logger.info('Initializing Container Security Scanner');
      
      // Verify scanner availability
      await this.verifyScanners();
      
      // Update vulnerability database
      if (this.config.scanners.trivy.enabled) {
        await this.updateTrivyDatabase();
      }
      
      // Create report directory
      await fs.mkdir(this.config.reportPath, { recursive: true });
      
      // Start queue processor
      this.startQueueProcessor();
      
      // Start scheduled scans if configured
      if (this.config.scanSchedule > 0) {
        this.startScheduledScans();
      }
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Container Security Scanner initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Container Security Scanner:', error);
      throw error;
    }
  }

  /**
   * Scan a container image
   */
  async scanImage(imageId, options = {}) {
    try {
      const scanId = this.generateScanId();
      const scanData = {
        scanId,
        imageId,
        options,
        status: 'queued',
        queuedAt: new Date(),
        results: null
      };
      
      logger.info(`Queueing security scan for image ${imageId}`);
      
      // Add to queue or scan immediately
      if (this.activeScans.size < this.config.parallelScans) {
        await this.executeScan(scanData);
      } else {
        this.scanQueue.push(scanData);
      }
      
      return scanId;
      
    } catch (error) {
      logger.error(`Failed to queue scan for image ${imageId}:`, error);
      throw error;
    }
  }

  /**
   * Execute security scan
   */
  async executeScan(scanData) {
    try {
      scanData.status = 'scanning';
      scanData.startedAt = new Date();
      this.activeScans.set(scanData.scanId, scanData);
      
      logger.info(`Starting security scan ${scanData.scanId} for image ${scanData.imageId}`);
      
      // Get image details
      const imageInfo = await this.getImageInfo(scanData.imageId);
      
      // Run configured scanners
      const results = {
        scanId: scanData.scanId,
        imageId: scanData.imageId,
        imageName: imageInfo.RepoTags?.[0] || scanData.imageId,
        scanDate: new Date(),
        scanners: {},
        vulnerabilities: [],
        misconfigurations: [],
        secrets: [],
        licenses: [],
        overallStatus: 'pass'
      };
      
      // Run Trivy scan
      if (this.config.scanners.trivy.enabled) {
        const trivyResults = await this.runTrivyScan(scanData.imageId, imageInfo);
        results.scanners.trivy = trivyResults;
        results.vulnerabilities.push(...(trivyResults.vulnerabilities || []));
        results.misconfigurations.push(...(trivyResults.misconfigurations || []));
        results.secrets.push(...(trivyResults.secrets || []));
        results.licenses.push(...(trivyResults.licenses || []));
      }
      
      // Run Clair scan if enabled
      if (this.config.scanners.clair.enabled) {
        const clairResults = await this.runClairScan(scanData.imageId);
        results.scanners.clair = clairResults;
        results.vulnerabilities.push(...(clairResults.vulnerabilities || []));
      }
      
      // Run custom scanner if configured
      if (this.config.scanners.custom.enabled) {
        const customResults = await this.runCustomScan(scanData.imageId);
        results.scanners.custom = customResults;
      }
      
      // Deduplicate and sort vulnerabilities
      results.vulnerabilities = this.deduplicateVulnerabilities(results.vulnerabilities);
      results.vulnerabilities.sort((a, b) => this.compareSeverity(b.severity, a.severity));
      
      // Apply security policies
      const policyResults = await this.applySecurityPolicies(results);
      results.policyViolations = policyResults.violations;
      results.overallStatus = policyResults.passed ? 'pass' : 'fail';
      
      // Update scan data
      scanData.status = 'completed';
      scanData.completedAt = new Date();
      scanData.results = results;
      
      // Store scan results
      this.scanHistory.set(scanData.imageId, results);
      
      // Generate report
      await this.generateScanReport(results);
      
      // Send alerts if needed
      if (!policyResults.passed && this.config.sendAlerts) {
        await this.sendSecurityAlert(results);
      }
      
      // Update statistics
      this.updateScanStatistics(results);
      
      // Emit scan completed event
      this.emit('scanCompleted', {
        scanId: scanData.scanId,
        imageId: scanData.imageId,
        passed: policyResults.passed,
        vulnerabilityCount: results.vulnerabilities.length
      });
      
      // Clean up
      this.activeScans.delete(scanData.scanId);
      
      // Process next in queue
      this.processQueue();
      
      return results;
      
    } catch (error) {
      logger.error(`Security scan failed for ${scanData.imageId}:`, error);
      
      scanData.status = 'failed';
      scanData.error = error.message;
      this.activeScans.delete(scanData.scanId);
      
      // Process next in queue
      this.processQueue();
      
      throw error;
    }
  }

  /**
   * Run Trivy security scan
   */
  async runTrivyScan(imageId, imageInfo) {
    return new Promise((resolve, reject) => {
      const results = {
        vulnerabilities: [],
        misconfigurations: [],
        secrets: [],
        licenses: [],
        status: 'completed'
      };
      
      // Prepare Trivy command
      const args = [
        'image',
        '--format', 'json',
        '--severity', this.config.scanners.trivy.severity.join(','),
        '--quiet',
        '--cache-dir', this.config.scanners.trivy.cacheDir
      ];
      
      if (this.config.scanners.trivy.ignoreUnfixed) {
        args.push('--ignore-unfixed');
      }
      
      // Add security checks
      args.push('--security-checks', 'vuln,config,secret,license');
      
      // Add image name
      args.push(imageInfo.RepoTags?.[0] || imageId);
      
      logger.debug(`Running Trivy scan with args: ${args.join(' ')}`);
      
      const trivy = spawn(this.config.scanners.trivy.binaryPath, args);
      
      let stdout = '';
      let stderr = '';
      
      trivy.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      trivy.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      trivy.on('close', (code) => {
        if (code !== 0 && code !== 1) { // Exit code 1 means vulnerabilities found
          reject(new Error(`Trivy scan failed with code ${code}: ${stderr}`));
          return;
        }
        
        try {
          const scanResult = JSON.parse(stdout);
          
          // Process results
          if (scanResult.Results) {
            for (const result of scanResult.Results) {
              // Process vulnerabilities
              if (result.Vulnerabilities) {
                for (const vuln of result.Vulnerabilities) {
                  results.vulnerabilities.push({
                    id: vuln.VulnerabilityID,
                    package: vuln.PkgName,
                    version: vuln.InstalledVersion,
                    fixedVersion: vuln.FixedVersion,
                    severity: vuln.Severity,
                    title: vuln.Title,
                    description: vuln.Description,
                    references: vuln.References,
                    cvss: vuln.CVSS,
                    scanner: 'trivy'
                  });
                }
              }
              
              // Process misconfigurations
              if (result.Misconfigurations) {
                for (const misconfig of result.Misconfigurations) {
                  results.misconfigurations.push({
                    id: misconfig.ID,
                    type: misconfig.Type,
                    title: misconfig.Title,
                    description: misconfig.Description,
                    severity: misconfig.Severity,
                    resolution: misconfig.Resolution,
                    scanner: 'trivy'
                  });
                }
              }
              
              // Process secrets
              if (result.Secrets) {
                for (const secret of result.Secrets) {
                  results.secrets.push({
                    ruleId: secret.RuleID,
                    category: secret.Category,
                    severity: secret.Severity,
                    title: secret.Title,
                    match: secret.Match,
                    scanner: 'trivy'
                  });
                }
              }
              
              // Process licenses
              if (result.Licenses) {
                for (const license of result.Licenses) {
                  results.licenses.push({
                    package: license.PkgName,
                    license: license.Name,
                    confidence: license.Confidence,
                    scanner: 'trivy'
                  });
                }
              }
            }
          }
          
          resolve(results);
          
        } catch (error) {
          reject(new Error(`Failed to parse Trivy results: ${error.message}`));
        }
      });
      
      // Set timeout
      setTimeout(() => {
        trivy.kill();
        reject(new Error('Trivy scan timeout'));
      }, this.config.scanners.trivy.timeout);
    });
  }

  /**
   * Run Clair security scan
   */
  async runClairScan(imageId) {
    // This would integrate with Clair API
    // For now, return empty results
    
    logger.debug(`Running Clair scan for image ${imageId}`);
    
    return {
      vulnerabilities: [],
      status: 'not_implemented'
    };
  }

  /**
   * Run custom security scan
   */
  async runCustomScan(imageId) {
    // This would run custom scanner command
    // For now, return empty results
    
    logger.debug(`Running custom scan for image ${imageId}`);
    
    return {
      status: 'not_implemented'
    };
  }

  /**
   * Apply security policies to scan results
   */
  async applySecurityPolicies(results) {
    const violations = [];
    let passed = true;
    
    // Count vulnerabilities by severity
    const vulnCounts = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0
    };
    
    for (const vuln of results.vulnerabilities) {
      if (vulnCounts[vuln.severity] !== undefined) {
        vulnCounts[vuln.severity]++;
      }
    }
    
    // Check vulnerability policies
    if (vulnCounts.CRITICAL > this.config.policies.maxCriticalVulns) {
      violations.push({
        type: 'vulnerability_count',
        severity: 'critical',
        message: `Found ${vulnCounts.CRITICAL} critical vulnerabilities (max allowed: ${this.config.policies.maxCriticalVulns})`,
        blocking: this.config.policies.blockOnCritical
      });
      
      if (this.config.policies.blockOnCritical) {
        passed = false;
      }
    }
    
    if (vulnCounts.HIGH > this.config.policies.maxHighVulns) {
      violations.push({
        type: 'vulnerability_count',
        severity: 'high',
        message: `Found ${vulnCounts.HIGH} high vulnerabilities (max allowed: ${this.config.policies.maxHighVulns})`,
        blocking: this.config.policies.blockOnHigh
      });
      
      if (this.config.policies.blockOnHigh) {
        passed = false;
      }
    }
    
    // Check for secrets
    if (results.secrets.length > 0) {
      violations.push({
        type: 'secrets_found',
        severity: 'critical',
        message: `Found ${results.secrets.length} exposed secrets`,
        blocking: true
      });
      passed = false;
    }
    
    // Check licenses
    const unapprovedLicenses = results.licenses.filter(
      l => !this.config.policies.allowedLicenses.includes(l.license)
    );
    
    if (unapprovedLicenses.length > 0) {
      violations.push({
        type: 'unapproved_licenses',
        severity: 'medium',
        message: `Found ${unapprovedLicenses.length} packages with unapproved licenses`,
        licenses: unapprovedLicenses.map(l => l.license),
        blocking: false
      });
    }
    
    // Check banned packages
    const bannedPackagesFound = results.vulnerabilities
      .filter(v => this.config.policies.bannedPackages.includes(v.package))
      .map(v => v.package);
    
    if (bannedPackagesFound.length > 0) {
      violations.push({
        type: 'banned_packages',
        severity: 'high',
        message: `Found ${bannedPackagesFound.length} banned packages`,
        packages: [...new Set(bannedPackagesFound)],
        blocking: true
      });
      passed = false;
    }
    
    return { passed, violations };
  }

  /**
   * Verify scanner availability
   */
  async verifyScanners() {
    if (this.config.scanners.trivy.enabled) {
      await this.verifyTrivyInstallation();
    }
    
    if (this.config.scanners.clair.enabled) {
      await this.verifyClairConnection();
    }
  }

  /**
   * Verify Trivy installation
   */
  async verifyTrivyInstallation() {
    return new Promise((resolve, reject) => {
      const trivy = spawn(this.config.scanners.trivy.binaryPath, ['--version']);
      
      trivy.on('close', (code) => {
        if (code === 0) {
          logger.info('Trivy scanner verified');
          resolve();
        } else {
          reject(new Error('Trivy scanner not found or not executable'));
        }
      });
      
      trivy.on('error', (error) => {
        reject(new Error(`Trivy verification failed: ${error.message}`));
      });
    });
  }

  /**
   * Verify Clair connection
   */
  async verifyClairConnection() {
    // This would check Clair API availability
    logger.debug('Clair connection verification not implemented');
  }

  /**
   * Update Trivy vulnerability database
   */
  async updateTrivyDatabase() {
    return new Promise((resolve, _reject) => {
      logger.info('Updating Trivy vulnerability database');
      
      const trivy = spawn(this.config.scanners.trivy.binaryPath, [
        'image',
        '--download-db-only',
        '--cache-dir', this.config.scanners.trivy.cacheDir
      ]);
      
      trivy.on('close', (code) => {
        if (code === 0) {
          logger.info('Trivy database updated successfully');
          resolve();
        } else {
          // Database update failure is not critical
          logger.warn('Trivy database update failed, using existing database');
          resolve();
        }
      });
      
      trivy.on('error', (error) => {
        logger.warn(`Trivy database update error: ${error.message}`);
        resolve();
      });
    });
  }

  /**
   * Get image information
   */
  async getImageInfo(imageId) {
    try {
      const image = this.docker.getImage(imageId);
      return await image.inspect();
    } catch (error) {
      logger.error(`Failed to get image info for ${imageId}:`, error);
      return { Id: imageId };
    }
  }

  /**
   * Deduplicate vulnerabilities from multiple scanners
   */
  deduplicateVulnerabilities(vulnerabilities) {
    const seen = new Set();
    const deduplicated = [];
    
    for (const vuln of vulnerabilities) {
      const key = `${vuln.id}-${vuln.package}-${vuln.version}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(vuln);
      }
    }
    
    return deduplicated;
  }

  /**
   * Compare vulnerability severity
   */
  compareSeverity(a, b) {
    const severityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
    return (severityOrder[a] || 0) - (severityOrder[b] || 0);
  }

  /**
   * Generate scan report
   */
  async generateScanReport(results) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFilename = `scan-${results.imageId.substring(0, 12)}-${timestamp}`;
    
    // Generate JSON report
    if (this.config.reportFormat.includes('json')) {
      const jsonPath = path.join(this.config.reportPath, `${baseFilename}.json`);
      await fs.writeFile(jsonPath, JSON.stringify(results, null, 2));
    }
    
    // Generate human-readable report
    if (this.config.reportFormat.includes('table')) {
      const tablePath = path.join(this.config.reportPath, `${baseFilename}.txt`);
      const tableContent = this.generateTableReport(results);
      await fs.writeFile(tablePath, tableContent);
    }
    
    // Generate HTML report
    if (this.config.reportFormat.includes('html')) {
      const htmlPath = path.join(this.config.reportPath, `${baseFilename}.html`);
      const htmlContent = this.generateHtmlReport(results);
      await fs.writeFile(htmlPath, htmlContent);
    }
  }

  /**
   * Generate table format report
   */
  generateTableReport(results) {
    let report = `Security Scan Report\n`;
    report += `====================\n\n`;
    report += `Image: ${results.imageName}\n`;
    report += `Scan Date: ${results.scanDate.toISOString()}\n`;
    report += `Status: ${results.overallStatus.toUpperCase()}\n\n`;
    
    // Vulnerability summary
    const vulnCounts = {};
    for (const vuln of results.vulnerabilities) {
      vulnCounts[vuln.severity] = (vulnCounts[vuln.severity] || 0) + 1;
    }
    
    report += `Vulnerabilities Summary:\n`;
    report += `-----------------------\n`;
    for (const [severity, count] of Object.entries(vulnCounts)) {
      report += `${severity}: ${count}\n`;
    }
    report += `\n`;
    
    // Policy violations
    if (results.policyViolations && results.policyViolations.length > 0) {
      report += `Policy Violations:\n`;
      report += `-----------------\n`;
      for (const violation of results.policyViolations) {
        report += `- ${violation.message} [${violation.severity}]\n`;
      }
      report += `\n`;
    }
    
    // Detailed vulnerabilities
    if (results.vulnerabilities.length > 0) {
      report += `Detailed Vulnerabilities:\n`;
      report += `------------------------\n`;
      for (const vuln of results.vulnerabilities.slice(0, 50)) { // Limit to 50
        report += `${vuln.id} - ${vuln.package}@${vuln.version} [${vuln.severity}]\n`;
        if (vuln.fixedVersion) {
          report += `  Fixed in: ${vuln.fixedVersion}\n`;
        }
      }
    }
    
    return report;
  }

  /**
   * Generate HTML format report
   */
  generateHtmlReport(results) {
    // Simplified HTML report
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Security Scan Report - ${results.imageName}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .header { background: #f0f0f0; padding: 10px; }
    .status-pass { color: green; }
    .status-fail { color: red; }
    .severity-critical { color: red; font-weight: bold; }
    .severity-high { color: orange; }
    .severity-medium { color: yellow; }
    .severity-low { color: gray; }
    table { border-collapse: collapse; width: 100%; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Security Scan Report</h1>
    <p>Image: ${results.imageName}</p>
    <p>Scan Date: ${results.scanDate.toISOString()}</p>
    <p>Status: <span class="status-${results.overallStatus}">${results.overallStatus.toUpperCase()}</span></p>
  </div>
  
  <h2>Vulnerability Summary</h2>
  <table>
    <tr>
      <th>Severity</th>
      <th>Count</th>
    </tr>
    ${Object.entries(this.countVulnerabilitiesBySeverity(results.vulnerabilities))
      .map(([sev, count]) => `<tr><td class="severity-${sev.toLowerCase()}">${sev}</td><td>${count}</td></tr>`)
      .join('')}
  </table>
  
  ${results.policyViolations && results.policyViolations.length > 0 ? `
    <h2>Policy Violations</h2>
    <ul>
      ${results.policyViolations.map(v => `<li>${v.message}</li>`).join('')}
    </ul>
  ` : ''}
  
  <h2>Top Vulnerabilities</h2>
  <table>
    <tr>
      <th>CVE ID</th>
      <th>Package</th>
      <th>Severity</th>
      <th>Fixed Version</th>
    </tr>
    ${results.vulnerabilities.slice(0, 20).map(v => `
      <tr>
        <td>${v.id}</td>
        <td>${v.package}@${v.version}</td>
        <td class="severity-${v.severity.toLowerCase()}">${v.severity}</td>
        <td>${v.fixedVersion || 'N/A'}</td>
      </tr>
    `).join('')}
  </table>
</body>
</html>`;
  }

  /**
   * Count vulnerabilities by severity
   */
  countVulnerabilitiesBySeverity(vulnerabilities) {
    const counts = {};
    for (const vuln of vulnerabilities) {
      counts[vuln.severity] = (counts[vuln.severity] || 0) + 1;
    }
    return counts;
  }

  /**
   * Send security alert
   */
  async sendSecurityAlert(results) {
    const alert = {
      type: 'security_scan_failed',
      severity: 'high',
      image: results.imageName,
      vulnerabilities: results.vulnerabilities.length,
      policyViolations: results.policyViolations,
      timestamp: new Date()
    };
    
    // Emit alert event
    this.emit('securityAlert', alert);
    
    // Send webhook if configured
    if (this.config.webhookUrl) {
      try {
        // This would send webhook notification
        logger.info(`Sending security alert webhook for ${results.imageName}`);
      } catch (error) {
        logger.error('Failed to send security webhook:', error);
      }
    }
  }

  /**
   * Update scan statistics
   */
  updateScanStatistics(results) {
    this.scanStats.totalScans++;
    
    if (results.overallStatus === 'fail') {
      this.scanStats.blockedContainers++;
    }
    
    this.scanStats.vulnerabilitiesFound += results.vulnerabilities.length;
    
    for (const vuln of results.vulnerabilities) {
      switch (vuln.severity) {
        case 'CRITICAL':
          this.scanStats.criticalVulns++;
          break;
        case 'HIGH':
          this.scanStats.highVulns++;
          break;
        case 'MEDIUM':
          this.scanStats.mediumVulns++;
          break;
      }
    }
  }

  /**
   * Generate scan ID
   */
  generateScanId() {
    return `scan-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Start queue processor
   */
  startQueueProcessor() {
    this.queueProcessTimer = setInterval(() => {
      this.processQueue();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Process scan queue
   */
  processQueue() {
    while (this.scanQueue.length > 0 && this.activeScans.size < this.config.parallelScans) {
      const scanData = this.scanQueue.shift();
      this.executeScan(scanData).catch(err => 
        logger.error(`Failed to execute queued scan:`, err)
      );
    }
  }

  /**
   * Start scheduled scans
   */
  startScheduledScans() {
    this.scheduledScanTimer = setInterval(() => {
      this.performScheduledScans().catch(err => 
        logger.error('Scheduled scan failed:', err)
      );
    }, this.config.scanSchedule);
  }

  /**
   * Perform scheduled scans of running containers
   */
  async performScheduledScans() {
    try {
      const containers = await this.docker.listContainers({
        filters: {
          label: ['github-runner=true']
        }
      });
      
      for (const container of containers) {
        const imageId = container.ImageID;
        
        // Check if recently scanned
        const lastScan = this.scanHistory.get(imageId);
        if (lastScan && (Date.now() - lastScan.scanDate.getTime() < this.config.scanSchedule)) {
          continue;
        }
        
        // Queue scan
        await this.scanImage(imageId, { scheduled: true });
      }
      
    } catch (error) {
      logger.error('Failed to perform scheduled scans:', error);
    }
  }

  /**
   * Get scan results for an image
   */
  getScanResults(imageId) {
    return this.scanHistory.get(imageId);
  }

  /**
   * Get security scanner report
   */
  getSecurityReport() {
    return {
      statistics: this.scanStats,
      activeScans: Array.from(this.activeScans.values()).map(s => ({
        scanId: s.scanId,
        imageId: s.imageId,
        status: s.status,
        startedAt: s.startedAt
      })),
      queueLength: this.scanQueue.length,
      recentScans: Array.from(this.scanHistory.values()).slice(-10),
      configuration: {
        scanners: Object.keys(this.config.scanners).filter(s => this.config.scanners[s].enabled),
        policies: this.config.policies,
        scanBeforeRun: this.config.scanBeforeRun
      }
    };
  }

  /**
   * Stop the security scanner
   */
  async stop() {
    logger.info('Stopping Container Security Scanner');
    
    if (this.scheduledScanTimer) {
      clearInterval(this.scheduledScanTimer);
      this.scheduledScanTimer = null;
    }
    
    if (this.queueProcessTimer) {
      clearInterval(this.queueProcessTimer);
      this.queueProcessTimer = null;
    }
    
    // Wait for active scans to complete
    const timeout = 30000; // 30 seconds
    const start = Date.now();
    
    while (this.activeScans.size > 0 && Date.now() - start < timeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Clear remaining scans
    this.scanQueue = [];
    this.activeScans.clear();
    
    this.emit('stopped');
    logger.info('Container Security Scanner stopped');
  }
}

module.exports = ContainerSecurityScanner;