import { Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import securityScanner, { ScanRequest } from '../services/security-scanner';
import jobLogSecretScanner from '../services/job-log-secret-scanner';
import auditLogger, { AuditEventType, AuditCategory, AuditSeverity } from '../services/audit-logger';

const logger = createLogger('SecurityController');

export class SecurityController {
  /**
   * Scan a container image
   * POST /api/security/scan
   */
  async scanImage(req: Request, res: Response): Promise<void> {
    try {
      const { imageName, imageTag, repository, policyId, force } = req.body;

      // Validate required fields
      if (!imageName) {
        res.status(400).json({
          success: false,
          error: 'Image name is required'
        });
        return;
      }

      const scanRequest: ScanRequest = {
        imageId: `${imageName}:${imageTag || 'latest'}`,
        imageName,
        imageTag: imageTag || 'latest',
        repository,
        userId: (req as any).user?.id,
        username: (req as any).user?.username,
        policyId,
        force: force === true
      };

      logger.info('Starting image security scan', {
        imageName,
        imageTag: imageTag || 'latest',
        requestedBy: scanRequest.username
      });

      const scanResult = await securityScanner.scanImage(scanRequest);

      // Check if scan failed policy
      if (policyId) {
        const policyCheck = await securityScanner.checkPolicy(scanResult, policyId);
        
        if (!policyCheck.passed) {
          res.status(422).json({
            success: false,
            error: 'Image failed security policy',
            data: {
              scanResult,
              policyViolations: policyCheck.violations,
              policy: policyCheck.policy
            }
          });
          return;
        }
      }

      res.json({
        success: true,
        data: {
          scanResult,
          message: 'Image scan completed successfully'
        }
      });
    } catch (error) {
      logger.error('Failed to scan image', { error });
      res.status(500).json({
        success: false,
        error: `Failed to scan image: ${(error as Error).message}`
      });
    }
  }

  /**
   * Get scan results
   * GET /api/security/scans
   */
  async getScanResults(req: Request, res: Response): Promise<void> {
    try {
      const { imageId, limit } = req.query;
      
      const results = await securityScanner.getScanResults(
        imageId as string,
        limit ? parseInt(limit as string) : 100
      );

      res.json({
        success: true,
        data: {
          scans: results,
          count: results.length
        }
      });
    } catch (error) {
      logger.error('Failed to get scan results', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get scan results'
      });
    }
  }

  /**
   * Get specific scan result
   * GET /api/security/scans/:scanId
   */
  async getScanResult(req: Request, res: Response): Promise<void> {
    try {
      const { scanId } = req.params;
      
      const result = await securityScanner.getScanResult(scanId);

      if (!result) {
        res.status(404).json({
          success: false,
          error: 'Scan result not found'
        });
        return;
      }

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Failed to get scan result', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get scan result'
      });
    }
  }

  /**
   * Get security policies
   * GET /api/security/policies
   */
  async getPolicies(_req: Request, res: Response): Promise<void> {
    try {
      const policies = await securityScanner.getPolicies();

      res.json({
        success: true,
        data: {
          policies,
          count: policies.length
        }
      });
    } catch (error) {
      logger.error('Failed to get policies', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get security policies'
      });
    }
  }

  /**
   * Create or update security policy
   * POST /api/security/policies
   */
  async upsertPolicy(req: Request, res: Response): Promise<void> {
    try {
      const policyData = req.body;

      // Validate required fields
      if (!policyData.name) {
        res.status(400).json({
          success: false,
          error: 'Policy name is required'
        });
        return;
      }

      const policy = await securityScanner.upsertPolicy(policyData);

      // Audit log
      await auditLogger.log({
        eventType: AuditEventType.SYSTEM_CONFIG_CHANGED,
        category: AuditCategory.SECURITY,
        severity: AuditSeverity.INFO,
        userId: (req as any).user?.id,
        username: (req as any).user?.username,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        resource: 'security_policy',
        resourceId: policy.id,
        action: policyData.id ? 'Updated security policy' : 'Created security policy',
        details: { policyName: policy.name },
        result: 'success'
      });

      res.json({
        success: true,
        data: {
          policy,
          message: policyData.id ? 'Policy updated successfully' : 'Policy created successfully'
        }
      });
    } catch (error) {
      logger.error('Failed to upsert policy', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to save security policy'
      });
    }
  }

  /**
   * Check image against policy
   * POST /api/security/check-policy
   */
  async checkPolicy(req: Request, res: Response): Promise<void> {
    try {
      const { scanId, policyId } = req.body;

      if (!scanId || !policyId) {
        res.status(400).json({
          success: false,
          error: 'Scan ID and policy ID are required'
        });
        return;
      }

      // Get scan result
      const scanResult = await securityScanner.getScanResult(scanId);
      
      if (!scanResult) {
        res.status(404).json({
          success: false,
          error: 'Scan result not found'
        });
        return;
      }

      // Check against policy
      const policyCheck = await securityScanner.checkPolicy(scanResult, policyId);

      res.json({
        success: true,
        data: {
          passed: policyCheck.passed,
          violations: policyCheck.violations,
          policy: policyCheck.policy,
          scanSummary: scanResult.summary
        }
      });
    } catch (error) {
      logger.error('Failed to check policy', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to check security policy'
      });
    }
  }

  /**
   * Get vulnerability statistics
   * GET /api/security/stats
   */
  async getVulnerabilityStats(req: Request, res: Response): Promise<void> {
    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 30;
      
      const stats = await securityScanner.getVulnerabilityStats(days);

      res.json({
        success: true,
        data: {
          stats,
          period: `${days} days`
        }
      });
    } catch (error) {
      logger.error('Failed to get vulnerability stats', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get vulnerability statistics'
      });
    }
  }

  /**
   * Get vulnerability details for an image
   * GET /api/security/vulnerabilities/:scanId
   */
  async getVulnerabilities(req: Request, res: Response): Promise<void> {
    try {
      const { scanId } = req.params;
      const { severity, fixable } = req.query;

      const scanResult = await securityScanner.getScanResult(scanId);
      
      if (!scanResult) {
        res.status(404).json({
          success: false,
          error: 'Scan result not found'
        });
        return;
      }

      let vulnerabilities = scanResult.vulnerabilities;

      // Filter by severity if requested
      if (severity) {
        const severities = (severity as string).split(',');
        vulnerabilities = vulnerabilities.filter(v => 
          severities.includes(v.severity)
        );
      }

      // Filter by fixable if requested
      if (fixable === 'true') {
        vulnerabilities = vulnerabilities.filter(v => v.fixedVersion);
      } else if (fixable === 'false') {
        vulnerabilities = vulnerabilities.filter(v => !v.fixedVersion);
      }

      res.json({
        success: true,
        data: {
          scanId,
          imageName: `${scanResult.imageName}:${scanResult.imageTag}`,
          scanDate: scanResult.scanDate,
          vulnerabilities,
          count: vulnerabilities.length,
          filters: { severity, fixable }
        }
      });
    } catch (error) {
      logger.error('Failed to get vulnerabilities', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get vulnerability details'
      });
    }
  }

  /**
   * Export scan results
   * GET /api/security/export/:scanId
   */
  async exportScanResult(req: Request, res: Response): Promise<void> {
    try {
      const { scanId } = req.params;
      const format = (req.query.format as string) || 'json';

      const scanResult = await securityScanner.getScanResult(scanId);
      
      if (!scanResult) {
        res.status(404).json({
          success: false,
          error: 'Scan result not found'
        });
        return;
      }

      // Audit log export
      await auditLogger.log({
        eventType: AuditEventType.DATA_EXPORTED,
        category: AuditCategory.SECURITY,
        severity: AuditSeverity.INFO,
        userId: (req as any).user?.id,
        username: (req as any).user?.username,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        resource: 'security_scan',
        resourceId: scanId,
        action: 'Exported security scan results',
        details: { format, imageId: scanResult.imageId },
        result: 'success'
      });

      if (format === 'csv') {
        // Convert to CSV
        const headers = [
          'CVE ID', 'Package', 'Version', 'Fixed Version', 
          'Severity', 'Title', 'CVSS Score'
        ];

        const rows = scanResult.vulnerabilities.map(v => [
          v.vulnerabilityId,
          v.packageName,
          v.packageVersion,
          v.fixedVersion || 'N/A',
          v.severity,
          v.title,
          v.cvss || 'N/A'
        ]);

        const csv = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 
          `attachment; filename="scan-${scanId}-vulnerabilities.csv"`);
        res.send(csv);
      } else {
        // JSON format
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 
          `attachment; filename="scan-${scanId}-results.json"`);
        res.json(scanResult);
      }
    } catch (error) {
      logger.error('Failed to export scan result', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to export scan results'
      });
    }
  }

  // ========== SECRET SCANNER ENDPOINTS ==========

  /**
   * Get secret scanner configuration
   * GET /api/security/secret-scanner/config
   */
  async getSecretScannerConfig(_req: Request, res: Response): Promise<void> {
    try {
      // For now, return a basic config response
      // In the future, you could expose configuration settings
      res.json({
        success: true,
        data: {
          enabled: true,
          message: 'Secret scanner is operational'
        }
      });
    } catch (error) {
      logger.error('Failed to get secret scanner config', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get secret scanner configuration'
      });
    }
  }

  /**
   * Update secret scanner configuration
   * PUT /api/security/secret-scanner/config
   */
  async updateSecretScannerConfig(req: Request, res: Response): Promise<void> {
    try {
      const configUpdate = req.body;

      // Validate configuration update
      const allowedFields = [
        'enabled', 'autoRedact', 'whitelistRepositories', 'minimumEntropy',
        'confidenceThreshold', 'preserveFormatting', 'notifyOnDetection',
        'blockJobOnSecrets', 'allowedFileExtensions'
      ];

      const invalidFields = Object.keys(configUpdate).filter(
        field => !allowedFields.includes(field)
      );

      if (invalidFields.length > 0) {
        res.status(400).json({
          success: false,
          error: `Invalid configuration fields: ${invalidFields.join(', ')}`
        });
        return;
      }

      await jobLogSecretScanner.updateConfiguration(configUpdate);

      // Audit log
      await auditLogger.log({
        eventType: AuditEventType.SYSTEM_CONFIG_CHANGED,
        category: AuditCategory.SECURITY,
        severity: AuditSeverity.INFO,
        userId: (req as any).user?.id,
        username: (req as any).user?.username,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        resource: 'secret_scanner_config',
        resourceId: 'default',
        action: 'Updated secret scanner configuration',
        details: configUpdate,
        result: 'success'
      });

      res.json({
        success: true,
        data: {
          message: 'Secret scanner configuration updated successfully',
          updatedFields: Object.keys(configUpdate)
        }
      });
    } catch (error) {
      logger.error('Failed to update secret scanner config', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to update secret scanner configuration'
      });
    }
  }

  /**
   * Add custom secret pattern
   * POST /api/security/secret-scanner/patterns
   */
  async addSecretPattern(req: Request, res: Response): Promise<void> {
    try {
      const patternData = req.body;

      // Validate required fields
      const requiredFields = ['name', 'description', 'regex', 'severity', 'category'];
      const missingFields = requiredFields.filter(field => !patternData[field]);

      if (missingFields.length > 0) {
        res.status(400).json({
          success: false,
          error: `Missing required fields: ${missingFields.join(', ')}`
        });
        return;
      }

      // Validate regex pattern
      try {
        new RegExp(patternData.regex);
      } catch (regexError) {
        res.status(400).json({
          success: false,
          error: 'Invalid regex pattern'
        });
        return;
      }

      // Convert string regex to RegExp object
      const pattern = {
        ...patternData,
        regex: new RegExp(patternData.regex, patternData.regexFlags || 'gi'),
        whitelistPatterns: patternData.whitelistPatterns?.map((p: string) => new RegExp(p, 'gi'))
      };

      const savedPattern = await jobLogSecretScanner.addCustomPattern(pattern);

      // Audit log
      await auditLogger.log({
        eventType: AuditEventType.SYSTEM_CONFIG_CHANGED,
        category: AuditCategory.SECURITY,
        severity: AuditSeverity.INFO,
        userId: (req as any).user?.id,
        username: (req as any).user?.username,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        resource: 'secret_pattern',
        resourceId: savedPattern.id,
        action: 'Added custom secret pattern',
        details: { patternName: savedPattern.name, category: savedPattern.category },
        result: 'success'
      });

      res.status(201).json({
        success: true,
        data: {
          pattern: {
            id: savedPattern.id,
            name: savedPattern.name,
            description: savedPattern.description,
            severity: savedPattern.severity,
            category: savedPattern.category,
            enabled: savedPattern.enabled
          },
          message: 'Custom secret pattern added successfully'
        }
      });
    } catch (error) {
      logger.error('Failed to add secret pattern', { error });
      res.status(500).json({
        success: false,
        error: `Failed to add secret pattern: ${(error as Error).message}`
      });
    }
  }

  /**
   * Get secret scanning statistics
   * GET /api/security/secret-scanner/stats
   */
  async getSecretScanningStats(req: Request, res: Response): Promise<void> {
    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 30;
      
      if (days < 1 || days > 365) {
        res.status(400).json({
          success: false,
          error: 'Days parameter must be between 1 and 365'
        });
        return;
      }

      const stats = await jobLogSecretScanner.getStatistics(days);

      res.json({
        success: true,
        data: {
          ...stats,
          period: `${days} days`
        }
      });
    } catch (error) {
      logger.error('Failed to get secret scanning stats', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to get secret scanning statistics'
      });
    }
  }

  /**
   * Test secret pattern
   * POST /api/security/secret-scanner/test-pattern
   */
  async testSecretPattern(req: Request, res: Response): Promise<void> {
    try {
      const { regex, testText, regexFlags } = req.body;

      if (!regex || !testText) {
        res.status(400).json({
          success: false,
          error: 'Both regex and testText are required'
        });
        return;
      }

      // Validate and test regex
      let regexPattern: RegExp;
      try {
        regexPattern = new RegExp(regex, regexFlags || 'gi');
      } catch (regexError) {
        res.status(400).json({
          success: false,
          error: 'Invalid regex pattern'
        });
        return;
      }

      // Test the pattern
      const matches = Array.from(testText.matchAll(regexPattern));
      const matchResults = matches.map((match, index: number) => ({
        index,
        match: (match as RegExpMatchArray)[0],
        position: (match as RegExpMatchArray).index || 0,
        groups: (match as RegExpMatchArray).slice(1)
      }));

      res.json({
        success: true,
        data: {
          matches: matchResults,
          matchCount: matches.length,
          pattern: regex,
          flags: regexFlags || 'gi',
          testPassed: matches.length > 0
        }
      });
    } catch (error) {
      logger.error('Failed to test secret pattern', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to test secret pattern'
      });
    }
  }

  /**
   * Export secret scanning results
   * GET /api/security/secret-scanner/export
   */
  async exportSecretScanResults(req: Request, res: Response): Promise<void> {
    try {
      const { days = '30', format = 'json' } = req.query;
      const daysNum = parseInt(days as string);

      if (daysNum < 1 || daysNum > 365) {
        res.status(400).json({
          success: false,
          error: 'Days parameter must be between 1 and 365'
        });
        return;
      }

      const stats = await jobLogSecretScanner.getStatistics(daysNum);

      // Audit log export
      await auditLogger.log({
        eventType: AuditEventType.DATA_EXPORTED,
        category: AuditCategory.SECURITY,
        severity: AuditSeverity.INFO,
        userId: (req as any).user?.id,
        username: (req as any).user?.username,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        resource: 'secret_scan_results',
        resourceId: 'export',
        action: 'Exported secret scanning results',
        details: { format, days: daysNum },
        result: 'success'
      });

      if (format === 'csv') {
        // Convert to CSV
        const headers = ['Date', 'Total Scans', 'Secrets Detected'];
        const rows = stats.scansByDay.map(day => [
          day.date.toISOString().split('T')[0],
          day.scans.toString(),
          day.secrets.toString()
        ]);

        const csv = [
          headers.join(','),
          ...rows.map(row => row.join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 
          `attachment; filename="secret-scan-stats-${daysNum}d.csv"`);
        res.send(csv);
      } else {
        // JSON format
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 
          `attachment; filename="secret-scan-stats-${daysNum}d.json"`);
        res.json({
          exportDate: new Date().toISOString(),
          period: `${daysNum} days`,
          data: stats
        });
      }
    } catch (error) {
      logger.error('Failed to export secret scan results', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to export secret scanning results'
      });
    }
  }
}

export default new SecurityController();