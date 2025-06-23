import { EventEmitter } from 'events';
import Docker from 'dockerode';
import { createLogger } from '../utils/logger';
import database from './database';
import auditLogger, { AuditEventType, AuditCategory, AuditSeverity } from './audit-logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);
const logger = createLogger('SecurityScanner');

export interface ScanResult {
  id: string;
  imageId: string;
  imageName: string;
  imageTag: string;
  scanDate: Date;
  scanDuration: number;
  vulnerabilities: Vulnerability[];
  summary: VulnerabilitySummary;
  scanEngine: 'trivy' | 'grype' | 'clair';
  status: 'completed' | 'failed' | 'in_progress';
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface Vulnerability {
  id: string;
  packageName: string;
  packageVersion: string;
  vulnerabilityId: string;
  severity: VulnerabilitySeverity;
  title: string;
  description: string;
  fixedVersion?: string;
  cvss?: number;
  cveIds?: string[];
  references?: string[];
  publishedDate?: Date;
  lastModifiedDate?: Date;
}

export enum VulnerabilitySeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  NEGLIGIBLE = 'negligible',
  UNKNOWN = 'unknown'
}

export interface VulnerabilitySummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  negligible: number;
  unknown: number;
  fixable: number;
}

export interface ScanPolicy {
  id: string;
  name: string;
  description?: string;
  blockOnCritical: boolean;
  blockOnHigh: boolean;
  maxCriticalVulnerabilities: number;
  maxHighVulnerabilities: number;
  maxMediumVulnerabilities: number;
  exemptCVEs?: string[];
  requiredLabels?: string[];
  trustedRegistries?: string[];
  enabled: boolean;
}

export interface ScanRequest {
  imageId: string;
  imageName: string;
  imageTag?: string;
  repository?: string;
  userId?: string;
  username?: string;
  policyId?: string;
  force?: boolean;
}

export class SecurityScanner extends EventEmitter {
  private static instance: SecurityScanner;
  private docker: Docker;
  private scanning: Map<string, ScanRequest> = new Map();
  private scanResultsCache: Map<string, ScanResult> = new Map();
  private cacheTimeout = 3600000; // 1 hour
  private scanTimeout = 300000; // 5 minutes
  private trivyVersion = 'latest';
  private scanDirectory = '/tmp/security-scans';
  private initialized = false;

  private constructor() {
    super();
    this.docker = new Docker({
      socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock'
    });
  }

  public static getInstance(): SecurityScanner {
    if (!SecurityScanner.instance) {
      SecurityScanner.instance = new SecurityScanner();
    }
    return SecurityScanner.instance;
  }

  /**
   * Initialize the security scanner
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Security scanner already initialized');
      return;
    }

    logger.info('Initializing security scanner');

    try {
      // Ensure scan directory exists
      await fs.mkdir(this.scanDirectory, { recursive: true });

      // Check if Trivy is installed
      await this.checkTrivyInstallation();

      // Load default policies
      await this.loadDefaultPolicies();

      // Start cache cleanup interval
      setInterval(() => this.cleanupCache(), this.cacheTimeout);

      this.initialized = true;
      logger.info('Security scanner initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize security scanner', { error });
      throw error;
    }
  }

  /**
   * Scan a container image for vulnerabilities
   */
  async scanImage(request: ScanRequest): Promise<ScanResult> {
    const scanId = uuidv4();
    const startTime = Date.now();

    logger.info('Starting image security scan', {
      scanId,
      imageName: request.imageName,
      imageTag: request.imageTag || 'latest'
    });

    // Check if already scanning this image
    const scanKey = `${request.imageName}:${request.imageTag || 'latest'}`;
    if (this.scanning.has(scanKey) && !request.force) {
      logger.warn('Image already being scanned', { scanKey });
      throw new Error('Image scan already in progress');
    }

    // Check cache
    if (!request.force) {
      const cachedResult = this.scanResultsCache.get(scanKey);
      if (cachedResult && (Date.now() - cachedResult.scanDate.getTime()) < this.cacheTimeout) {
        logger.debug('Returning cached scan result', { scanKey });
        return cachedResult;
      }
    }

    this.scanning.set(scanKey, request);
    this.emit('scan:started', { scanId, request });

    try {
      // Pull image if needed
      await this.ensureImageExists(request.imageId || scanKey);

      // Run security scan
      const vulnerabilities = await this.runTrivyScan(scanKey);

      // Create scan result
      const scanResult: ScanResult = {
        id: scanId,
        imageId: request.imageId,
        imageName: request.imageName,
        imageTag: request.imageTag || 'latest',
        scanDate: new Date(),
        scanDuration: Date.now() - startTime,
        vulnerabilities,
        summary: this.calculateSummary(vulnerabilities),
        scanEngine: 'trivy',
        status: 'completed',
        metadata: {
          repository: request.repository,
          scannedBy: request.username
        }
      };

      // Apply policy if specified
      if (request.policyId) {
        await this.applyPolicy(scanResult, request.policyId);
      }

      // Save to database
      await this.saveScanResult(scanResult);

      // Cache result
      this.scanResultsCache.set(scanKey, scanResult);

      // Audit log
      await auditLogger.log({
        eventType: AuditEventType.CONTAINER_CREATED,
        category: AuditCategory.SECURITY,
        severity: this.getSeverityFromScan(scanResult),
        userId: request.userId,
        username: request.username,
        resource: 'container_image',
        resourceId: scanKey,
        action: 'Security scan completed',
        details: {
          scanId,
          vulnerabilities: scanResult.summary,
          duration: scanResult.scanDuration
        },
        result: 'success'
      });

      this.emit('scan:completed', scanResult);
      logger.info('Image security scan completed', {
        scanId,
        duration: scanResult.scanDuration,
        vulnerabilities: scanResult.summary
      });

      return scanResult;

    } catch (error) {
      const scanResult: ScanResult = {
        id: scanId,
        imageId: request.imageId,
        imageName: request.imageName,
        imageTag: request.imageTag || 'latest',
        scanDate: new Date(),
        scanDuration: Date.now() - startTime,
        vulnerabilities: [],
        summary: this.calculateSummary([]),
        scanEngine: 'trivy',
        status: 'failed',
        errorMessage: (error as Error).message
      };

      await this.saveScanResult(scanResult);
      this.emit('scan:failed', { scanId, error });

      logger.error('Image security scan failed', {
        scanId,
        error: (error as Error).message
      });

      throw error;

    } finally {
      this.scanning.delete(scanKey);
    }
  }

  /**
   * Get scan results from database
   */
  async getScanResults(imageId?: string, limit: number = 100): Promise<ScanResult[]> {
    try {
      let query = `
        SELECT 
          id, image_id, image_name, image_tag, scan_date, scan_duration,
          vulnerabilities, summary, scan_engine, status, error_message, metadata
        FROM security_scans
      `;
      const params: any[] = [];

      if (imageId) {
        query += ' WHERE image_id = $1';
        params.push(imageId);
      }

      query += ' ORDER BY scan_date DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      const rows = await database.query(query, params);
      return rows.map(row => this.mapRowToScanResult(row));

    } catch (error) {
      logger.error('Failed to get scan results', { error });
      throw error;
    }
  }

  /**
   * Get scan result by ID
   */
  async getScanResult(scanId: string): Promise<ScanResult | null> {
    try {
      const rows = await database.query(
        `SELECT * FROM security_scans WHERE id = $1`,
        [scanId]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.mapRowToScanResult(rows[0]);

    } catch (error) {
      logger.error('Failed to get scan result', { scanId, error });
      throw error;
    }
  }

  /**
   * Get security policies
   */
  async getPolicies(): Promise<ScanPolicy[]> {
    try {
      const rows = await database.query(`
        SELECT * FROM security_policies 
        WHERE enabled = true 
        ORDER BY name
      `);

      return rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        blockOnCritical: row.block_on_critical,
        blockOnHigh: row.block_on_high,
        maxCriticalVulnerabilities: row.max_critical,
        maxHighVulnerabilities: row.max_high,
        maxMediumVulnerabilities: row.max_medium,
        exemptCVEs: row.exempt_cves,
        requiredLabels: row.required_labels,
        trustedRegistries: row.trusted_registries,
        enabled: row.enabled
      }));

    } catch (error) {
      logger.error('Failed to get policies', { error });
      throw error;
    }
  }

  /**
   * Create or update a security policy
   */
  async upsertPolicy(policy: Omit<ScanPolicy, 'id'> & { id?: string }): Promise<ScanPolicy> {
    try {
      const id = policy.id || uuidv4();
      
      await database.query(`
        INSERT INTO security_policies (
          id, name, description, block_on_critical, block_on_high,
          max_critical, max_high, max_medium, exempt_cves,
          required_labels, trusted_registries, enabled
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          block_on_critical = EXCLUDED.block_on_critical,
          block_on_high = EXCLUDED.block_on_high,
          max_critical = EXCLUDED.max_critical,
          max_high = EXCLUDED.max_high,
          max_medium = EXCLUDED.max_medium,
          exempt_cves = EXCLUDED.exempt_cves,
          required_labels = EXCLUDED.required_labels,
          trusted_registries = EXCLUDED.trusted_registries,
          enabled = EXCLUDED.enabled,
          updated_at = CURRENT_TIMESTAMP
      `, [
        id,
        policy.name,
        policy.description,
        policy.blockOnCritical,
        policy.blockOnHigh,
        policy.maxCriticalVulnerabilities,
        policy.maxHighVulnerabilities,
        policy.maxMediumVulnerabilities,
        policy.exemptCVEs,
        policy.requiredLabels,
        policy.trustedRegistries,
        policy.enabled
      ]);

      return { ...policy, id };

    } catch (error) {
      logger.error('Failed to upsert policy', { error });
      throw error;
    }
  }

  /**
   * Check if image passes security policy
   */
  async checkPolicy(scanResult: ScanResult, policyId: string): Promise<{
    passed: boolean;
    violations: string[];
    policy: ScanPolicy;
  }> {
    const policies = await this.getPolicies();
    const policy = policies.find(p => p.id === policyId);

    if (!policy) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    const violations: string[] = [];
    const summary = scanResult.summary;

    // Check critical vulnerabilities
    if (policy.blockOnCritical && summary.critical > 0) {
      violations.push(`Image has ${summary.critical} critical vulnerabilities (policy blocks any critical)`);
    }

    if (summary.critical > policy.maxCriticalVulnerabilities) {
      violations.push(`Image has ${summary.critical} critical vulnerabilities (max allowed: ${policy.maxCriticalVulnerabilities})`);
    }

    // Check high vulnerabilities
    if (policy.blockOnHigh && summary.high > 0) {
      violations.push(`Image has ${summary.high} high vulnerabilities (policy blocks any high)`);
    }

    if (summary.high > policy.maxHighVulnerabilities) {
      violations.push(`Image has ${summary.high} high vulnerabilities (max allowed: ${policy.maxHighVulnerabilities})`);
    }

    // Check medium vulnerabilities
    if (summary.medium > policy.maxMediumVulnerabilities) {
      violations.push(`Image has ${summary.medium} medium vulnerabilities (max allowed: ${policy.maxMediumVulnerabilities})`);
    }

    // Check for non-exempt CVEs
    if (policy.exemptCVEs && policy.exemptCVEs.length > 0) {
      const nonExemptCritical = scanResult.vulnerabilities.filter(v => 
        v.severity === VulnerabilitySeverity.CRITICAL &&
        !v.cveIds?.some(cve => policy.exemptCVEs?.includes(cve))
      );

      if (nonExemptCritical.length > 0) {
        violations.push(`Image has ${nonExemptCritical.length} non-exempt critical vulnerabilities`);
      }
    }

    // Log policy check
    await auditLogger.log({
      eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
      category: AuditCategory.SECURITY,
      severity: violations.length > 0 ? AuditSeverity.WARNING : AuditSeverity.INFO,
      resource: 'security_policy',
      resourceId: policyId,
      action: 'Security policy check',
      details: {
        scanId: scanResult.id,
        policyName: policy.name,
        passed: violations.length === 0,
        violations,
        summary: scanResult.summary
      },
      result: violations.length === 0 ? 'success' : 'failure'
    });

    return {
      passed: violations.length === 0,
      violations,
      policy
    };
  }

  /**
   * Get vulnerability statistics
   */
  async getVulnerabilityStats(days: number = 30): Promise<{
    totalScans: number;
    failedScans: number;
    averageVulnerabilities: number;
    criticalTrend: Array<{ date: Date; count: number }>;
    topVulnerableImages: Array<{ image: string; critical: number; high: number }>;
    commonVulnerabilities: Array<{ cve: string; count: number; severity: string }>;
  }> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      // Get scan statistics
      const statsResult = await database.query(`
        SELECT 
          COUNT(*) as total_scans,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_scans,
          AVG((summary->>'total')::int) as avg_vulnerabilities
        FROM security_scans
        WHERE scan_date >= $1
      `, [since]);

      // Get critical vulnerability trend
      const trendResult = await database.query(`
        SELECT 
          DATE_TRUNC('day', scan_date) as date,
          AVG((summary->>'critical')::int) as count
        FROM security_scans
        WHERE scan_date >= $1 AND status = 'completed'
        GROUP BY DATE_TRUNC('day', scan_date)
        ORDER BY date
      `, [since]);

      // Get top vulnerable images
      const topImagesResult = await database.query(`
        SELECT 
          image_name || ':' || image_tag as image,
          MAX((summary->>'critical')::int) as critical,
          MAX((summary->>'high')::int) as high
        FROM security_scans
        WHERE scan_date >= $1 AND status = 'completed'
        GROUP BY image_name, image_tag
        ORDER BY critical DESC, high DESC
        LIMIT 10
      `, [since]);

      // Get common vulnerabilities
      const commonVulnsResult = await database.query(`
        SELECT 
          vuln->>'vulnerabilityId' as cve,
          COUNT(*) as count,
          vuln->>'severity' as severity
        FROM security_scans,
          LATERAL jsonb_array_elements(vulnerabilities) as vuln
        WHERE scan_date >= $1 AND status = 'completed'
        GROUP BY vuln->>'vulnerabilityId', vuln->>'severity'
        ORDER BY count DESC
        LIMIT 20
      `, [since]);

      const stats = statsResult[0];
      
      return {
        totalScans: parseInt(stats.total_scans),
        failedScans: parseInt(stats.failed_scans),
        averageVulnerabilities: parseFloat(stats.avg_vulnerabilities) || 0,
        criticalTrend: trendResult.map((row: any) => ({
          date: row.date,
          count: parseFloat(row.count) || 0
        })),
        topVulnerableImages: topImagesResult.map((row: any) => ({
          image: row.image,
          critical: parseInt(row.critical) || 0,
          high: parseInt(row.high) || 0
        })),
        commonVulnerabilities: commonVulnsResult.map((row: any) => ({
          cve: row.cve,
          count: parseInt(row.count),
          severity: row.severity
        }))
      };

    } catch (error) {
      logger.error('Failed to get vulnerability statistics', { error });
      throw error;
    }
  }

  // Private helper methods

  private async checkTrivyInstallation(): Promise<void> {
    try {
      // Use safe spawn instead of execAsync
      const trivyProcess = spawn('trivy', ['--version']);
      let stdout = '';
      
      trivyProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      await new Promise<void>((resolve, reject) => {
        trivyProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`trivy exited with code ${code}`));
          }
        });
        trivyProcess.on('error', reject);
      });
      
      logger.info('Trivy scanner detected', { version: stdout.trim() });
    } catch (error) {
      logger.warn('Trivy not found, will use Docker image', { error: (error as Error).message });
      // Pull Trivy Docker image
      await this.pullTrivyImage();
    }
  }

  private async pullTrivyImage(): Promise<void> {
    logger.info('Pulling Trivy Docker image');
    
    try {
      // Validate trivy version to prevent injection
      if (!/^[a-zA-Z0-9\.-]+$/.test(this.trivyVersion)) {
        throw new Error('Invalid trivy version format');
      }
      
      // Use safe spawn instead of execAsync
      const dockerProcess = spawn('docker', ['pull', `aquasec/trivy:${this.trivyVersion}`]);
      
      await new Promise<void>((resolve, reject) => {
        dockerProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`docker pull exited with code ${code}`));
          }
        });
        dockerProcess.on('error', reject);
      });
      
      logger.info('Trivy Docker image pulled successfully');
    } catch (error) {
      throw new Error(`Failed to pull Trivy image: ${(error as Error).message}`);
    }
  }

  private async ensureImageExists(imageRef: string): Promise<void> {
    try {
      await this.docker.getImage(imageRef).inspect();
      logger.debug('Image exists locally', { imageRef });
    } catch (error) {
      logger.info('Pulling image for scanning', { imageRef });
      
      const stream = await this.docker.pull(imageRef);
      
      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err: any) => {
          if (err) reject(err);
          else resolve(undefined);
        });
      });
    }
  }

  private async runTrivyScan(imageRef: string): Promise<Vulnerability[]> {
    const outputFile = path.join(this.scanDirectory, `${uuidv4()}.json`);

    try {
      // Validate and sanitize inputs
      const sanitizedImageRef = imageRef.replace(/[^a-zA-Z0-9.\/:_-]/g, '');
      const sanitizedOutputFile = outputFile.replace(/[^a-zA-Z0-9.\/_-]/g, '');
      const timeoutSeconds = Math.floor(this.scanTimeout / 1000);
      
      // Prepare safe command arguments
      const trivyArgs = [
        'image',
        '--format', 'json',
        '--output', sanitizedOutputFile,
        '--timeout', `${timeoutSeconds}s`,
        sanitizedImageRef
      ];
      
      logger.debug('Running Trivy scan', { args: trivyArgs });
      
      try {
        // Try native Trivy first using spawn for safety
        const { spawn } = require('child_process');
        const trivyProcess = spawn('trivy', trivyArgs);
        await new Promise((resolve, reject) => {
          trivyProcess.on('close', (code: number) => {
            if (code === 0) resolve(code);
            else reject(new Error(`Trivy command failed with code ${code}`));
          });
        });
      } catch (nativeError) {
        // Fallback to Docker
        logger.debug('Falling back to Docker Trivy');
        // Validate and sanitize inputs
        const sanitizedImageRef = imageRef.replace(/[^a-zA-Z0-9.\/:_-]/g, '');
        const sanitizedOutputFile = outputFile.replace(/[^a-zA-Z0-9.\/_-]/g, '');
        const sanitizedVersion = this.trivyVersion.replace(/[^a-zA-Z0-9._-]/g, '');
        
        const dockerArgs = [
          'run', '--rm',
          '-v', '/var/run/docker.sock:/var/run/docker.sock',
          '-v', `${sanitizedOutputFile}:${sanitizedOutputFile}`,
          `aquasec/trivy:${sanitizedVersion}`,
          'image', '--format', 'json',
          '--output', sanitizedOutputFile,
          sanitizedImageRef
        ];
        
        const { spawn } = require('child_process');
        const dockerProcess = spawn('docker', dockerArgs);
        await new Promise((resolve, reject) => {
          dockerProcess.on('close', (code: number) => {
            if (code === 0) resolve(code);
            else reject(new Error(`Docker command failed with code ${code}`));
          });
        });
      }

      // Read and parse results
      const resultJson = await fs.readFile(outputFile, 'utf-8');
      const trivyResult = JSON.parse(resultJson);

      // Convert Trivy format to our format
      const vulnerabilities: Vulnerability[] = [];

      if (trivyResult.Results) {
        for (const result of trivyResult.Results) {
          if (result.Vulnerabilities) {
            for (const vuln of result.Vulnerabilities) {
              vulnerabilities.push({
                id: uuidv4(),
                packageName: vuln.PkgName,
                packageVersion: vuln.InstalledVersion,
                vulnerabilityId: vuln.VulnerabilityID,
                severity: this.mapTrivySeverity(vuln.Severity),
                title: vuln.Title || vuln.VulnerabilityID,
                description: vuln.Description || '',
                fixedVersion: vuln.FixedVersion,
                cvss: vuln.CVSS?.nvd?.V3Score || vuln.CVSS?.redhat?.V3Score,
                cveIds: [vuln.VulnerabilityID],
                references: vuln.References,
                publishedDate: vuln.PublishedDate ? new Date(vuln.PublishedDate) : undefined,
                lastModifiedDate: vuln.LastModifiedDate ? new Date(vuln.LastModifiedDate) : undefined
              });
            }
          }
        }
      }

      return vulnerabilities;

    } finally {
      // Cleanup
      try {
        await fs.unlink(outputFile);
      } catch (error) {
        logger.debug('Failed to cleanup scan output file', { outputFile });
      }
    }
  }

  private mapTrivySeverity(trivySeverity: string): VulnerabilitySeverity {
    switch (trivySeverity.toUpperCase()) {
      case 'CRITICAL':
        return VulnerabilitySeverity.CRITICAL;
      case 'HIGH':
        return VulnerabilitySeverity.HIGH;
      case 'MEDIUM':
        return VulnerabilitySeverity.MEDIUM;
      case 'LOW':
        return VulnerabilitySeverity.LOW;
      case 'NEGLIGIBLE':
        return VulnerabilitySeverity.NEGLIGIBLE;
      default:
        return VulnerabilitySeverity.UNKNOWN;
    }
  }

  private calculateSummary(vulnerabilities: Vulnerability[]): VulnerabilitySummary {
    const summary: VulnerabilitySummary = {
      total: vulnerabilities.length,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      negligible: 0,
      unknown: 0,
      fixable: 0
    };

    for (const vuln of vulnerabilities) {
      switch (vuln.severity) {
        case VulnerabilitySeverity.CRITICAL:
          summary.critical++;
          break;
        case VulnerabilitySeverity.HIGH:
          summary.high++;
          break;
        case VulnerabilitySeverity.MEDIUM:
          summary.medium++;
          break;
        case VulnerabilitySeverity.LOW:
          summary.low++;
          break;
        case VulnerabilitySeverity.NEGLIGIBLE:
          summary.negligible++;
          break;
        default:
          summary.unknown++;
      }

      if (vuln.fixedVersion) {
        summary.fixable++;
      }
    }

    return summary;
  }

  private getSeverityFromScan(scanResult: ScanResult): AuditSeverity {
    if (scanResult.summary.critical > 0) {
      return AuditSeverity.CRITICAL;
    } else if (scanResult.summary.high > 0) {
      return AuditSeverity.WARNING;
    } else if (scanResult.summary.medium > 0) {
      return AuditSeverity.INFO;
    }
    return AuditSeverity.INFO;
  }

  private async saveScanResult(scanResult: ScanResult): Promise<void> {
    try {
      await database.query(`
        INSERT INTO security_scans (
          id, image_id, image_name, image_tag, scan_date, scan_duration,
          vulnerabilities, summary, scan_engine, status, error_message, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        scanResult.id,
        scanResult.imageId,
        scanResult.imageName,
        scanResult.imageTag,
        scanResult.scanDate,
        scanResult.scanDuration,
        JSON.stringify(scanResult.vulnerabilities),
        JSON.stringify(scanResult.summary),
        scanResult.scanEngine,
        scanResult.status,
        scanResult.errorMessage,
        JSON.stringify(scanResult.metadata || {})
      ]);
    } catch (error) {
      logger.error('Failed to save scan result', { error });
      throw error;
    }
  }

  private async applyPolicy(scanResult: ScanResult, policyId: string): Promise<void> {
    const policyCheck = await this.checkPolicy(scanResult, policyId);
    
    if (!policyCheck.passed) {
      throw new Error(`Security policy violations: ${policyCheck.violations.join(', ')}`);
    }
  }

  private async loadDefaultPolicies(): Promise<void> {
    const defaultPolicies: Omit<ScanPolicy, 'id'>[] = [
      {
        name: 'Default Security Policy',
        description: 'Standard security policy for all images',
        blockOnCritical: true,
        blockOnHigh: false,
        maxCriticalVulnerabilities: 0,
        maxHighVulnerabilities: 10,
        maxMediumVulnerabilities: 50,
        exemptCVEs: [],
        requiredLabels: [],
        trustedRegistries: ['docker.io', 'ghcr.io'],
        enabled: true
      },
      {
        name: 'Strict Security Policy',
        description: 'Strict policy for production images',
        blockOnCritical: true,
        blockOnHigh: true,
        maxCriticalVulnerabilities: 0,
        maxHighVulnerabilities: 0,
        maxMediumVulnerabilities: 5,
        exemptCVEs: [],
        requiredLabels: ['approved', 'production'],
        trustedRegistries: ['ghcr.io'],
        enabled: true
      },
      {
        name: 'Development Policy',
        description: 'Relaxed policy for development images',
        blockOnCritical: false,
        blockOnHigh: false,
        maxCriticalVulnerabilities: 5,
        maxHighVulnerabilities: 20,
        maxMediumVulnerabilities: 100,
        exemptCVEs: [],
        requiredLabels: [],
        trustedRegistries: [],
        enabled: true
      }
    ];

    for (const policy of defaultPolicies) {
      try {
        await this.upsertPolicy(policy);
        logger.debug('Loaded default policy', { name: policy.name });
      } catch (error) {
        logger.error('Failed to load default policy', { name: policy.name, error });
      }
    }
  }

  private cleanupCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, result] of this.scanResultsCache.entries()) {
      if (now - result.scanDate.getTime() > this.cacheTimeout) {
        this.scanResultsCache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Cleaned up scan cache', { removed });
    }
  }

  private mapRowToScanResult(row: any): ScanResult {
    return {
      id: row.id,
      imageId: row.image_id,
      imageName: row.image_name,
      imageTag: row.image_tag,
      scanDate: row.scan_date,
      scanDuration: row.scan_duration,
      vulnerabilities: row.vulnerabilities || [],
      summary: row.summary,
      scanEngine: row.scan_engine,
      status: row.status,
      errorMessage: row.error_message,
      metadata: row.metadata
    };
  }

  /**
   * Shutdown the security scanner
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down security scanner');
    
    // Wait for any in-progress scans
    if (this.scanning.size > 0) {
      logger.info(`Waiting for ${this.scanning.size} scans to complete`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    logger.info('Security scanner shut down successfully');
  }
}

export default SecurityScanner.getInstance();