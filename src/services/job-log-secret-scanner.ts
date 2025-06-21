import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import database from './database';
import auditLogger, { AuditEventType, AuditCategory, AuditSeverity } from './audit-logger';
import * as crypto from 'crypto';

const logger = createLogger('JobLogSecretScanner');

export interface SecretPattern {
  id: string;
  name: string;
  description: string;
  regex: RegExp;
  entropy?: number; // Minimum entropy for this pattern
  enabled: boolean;
  severity: SecretSeverity;
  category: SecretCategory;
  redactionPattern?: string; // Custom redaction pattern
  whitelistPatterns?: RegExp[]; // Patterns to whitelist/ignore
}

export enum SecretSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

export enum SecretCategory {
  API_KEY = 'api_key',
  PASSWORD = 'password',
  TOKEN = 'token',
  CERTIFICATE = 'certificate',
  PRIVATE_KEY = 'private_key',
  DATABASE_URL = 'database_url',
  CLOUD_CREDENTIALS = 'cloud_credentials',
  JWT = 'jwt',
  SSH_KEY = 'ssh_key',
  GENERIC = 'generic'
}

export interface DetectedSecret {
  id: string;
  pattern: SecretPattern;
  match: string;
  redactedMatch: string;
  lineNumber: number;
  columnStart: number;
  columnEnd: number;
  context: string; // Surrounding context
  entropy?: number;
  confidence: number; // 0-1 confidence score
}

export interface ScanResult {
  id: string;
  jobId: string;
  logContent: string;
  redactedLogContent: string;
  scanDate: Date;
  scanDuration: number;
  detectedSecrets: DetectedSecret[];
  summary: {
    totalSecrets: number;
    criticalSecrets: number;
    highSecrets: number;
    mediumSecrets: number;
    lowSecrets: number;
    categoryCounts: Record<SecretCategory, number>;
  };
  status: 'completed' | 'failed' | 'in_progress';
  errorMessage?: string;
}

export interface ScanConfiguration {
  enabled: boolean;
  autoRedact: boolean;
  whitelistRepositories?: string[];
  customPatterns?: SecretPattern[];
  minimumEntropy?: number;
  confidenceThreshold?: number;
  preserveFormatting?: boolean;
  notifyOnDetection?: boolean;
  blockJobOnSecrets?: boolean;
  allowedFileExtensions?: string[];
}

export class JobLogSecretScanner extends EventEmitter {
  private static instance: JobLogSecretScanner;
  private initialized = false;
  private patterns: Map<string, SecretPattern> = new Map();
  private configuration: ScanConfiguration = {
    enabled: true,
    autoRedact: true,
    minimumEntropy: 3.0,
    confidenceThreshold: 0.7,
    preserveFormatting: true,
    notifyOnDetection: true,
    blockJobOnSecrets: false
  };

  private constructor() {
    super();
  }

  public static getInstance(): JobLogSecretScanner {
    if (!JobLogSecretScanner.instance) {
      JobLogSecretScanner.instance = new JobLogSecretScanner();
    }
    return JobLogSecretScanner.instance;
  }

  /**
   * Initialize the secret scanner with default patterns
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Secret scanner already initialized');
      return;
    }

    logger.info('Initializing job log secret scanner');

    try {
      // Load configuration from database
      await this.loadConfiguration();

      // Load default patterns
      await this.loadDefaultPatterns();

      // Load custom patterns from database
      await this.loadCustomPatterns();

      this.initialized = true;
      logger.info('Job log secret scanner initialized successfully', {
        patternCount: this.patterns.size,
        enabled: this.configuration.enabled
      });
    } catch (error) {
      logger.error('Failed to initialize secret scanner', { error });
      throw error;
    }
  }

  /**
   * Scan job logs for secrets
   */
  async scanJobLogs(jobId: string, logContent: string, userId?: string): Promise<ScanResult> {
    if (!this.configuration.enabled) {
      logger.debug('Secret scanning disabled, skipping scan', { jobId });
      return this.createEmptyScanResult(jobId, logContent);
    }

    const scanId = crypto.randomUUID();
    const startTime = Date.now();

    logger.info('Starting job log secret scan', { scanId, jobId });

    try {
      const detectedSecrets = await this.detectSecrets(logContent);
      const redactedContent = this.configuration.autoRedact 
        ? this.redactSecrets(logContent, detectedSecrets)
        : logContent;

      const scanResult: ScanResult = {
        id: scanId,
        jobId,
        logContent,
        redactedLogContent: redactedContent,
        scanDate: new Date(),
        scanDuration: Date.now() - startTime,
        detectedSecrets,
        summary: this.calculateSummary(detectedSecrets),
        status: 'completed'
      };

      // Save scan result
      await this.saveScanResult(scanResult);

      // Audit log
      await auditLogger.log({
        eventType: AuditEventType.CONTAINER_CREATED,
        category: AuditCategory.SECURITY,
        severity: this.getSeverityFromScan(scanResult),
        userId,
        resource: 'job_logs',
        resourceId: jobId,
        action: 'Secret scan completed',
        details: {
          scanId,
          secretsFound: scanResult.summary.totalSecrets,
          criticalSecrets: scanResult.summary.criticalSecrets,
          duration: scanResult.scanDuration
        },
        result: 'success'
      });

      // Emit events
      this.emit('scan:completed', scanResult);

      if (scanResult.summary.totalSecrets > 0) {
        this.emit('secrets:detected', {
          scanId,
          jobId,
          secrets: detectedSecrets
        });

        if (this.configuration.notifyOnDetection) {
          logger.warn('Secrets detected in job logs', {
            jobId,
            secretCount: scanResult.summary.totalSecrets,
            criticalCount: scanResult.summary.criticalSecrets
          });
        }
      }

      logger.info('Job log secret scan completed', {
        scanId,
        jobId,
        duration: scanResult.scanDuration,
        secretsFound: scanResult.summary.totalSecrets
      });

      return scanResult;

    } catch (error) {
      const scanResult: ScanResult = {
        id: scanId,
        jobId,
        logContent,
        redactedLogContent: logContent,
        scanDate: new Date(),
        scanDuration: Date.now() - startTime,
        detectedSecrets: [],
        summary: this.calculateSummary([]),
        status: 'failed',
        errorMessage: (error as Error).message
      };

      await this.saveScanResult(scanResult);
      this.emit('scan:failed', { scanId, jobId, error });

      logger.error('Job log secret scan failed', {
        scanId,
        jobId,
        error: (error as Error).message
      });

      throw error;
    }
  }

  /**
   * Detect secrets in log content
   */
  private async detectSecrets(content: string): Promise<DetectedSecret[]> {
    const detectedSecrets: DetectedSecret[] = [];
    const lines = content.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      
      for (const [, pattern] of this.patterns) {
        if (!pattern.enabled) continue;

        const matches = Array.from(line.matchAll(new RegExp(pattern.regex, 'gi')));
        
        for (const match of matches) {
          if (!match.index) continue;

          const matchedText = match[0];
          
          // Check whitelist patterns
          if (this.isWhitelisted(matchedText, pattern)) {
            continue;
          }

          // Calculate entropy
          const entropy = this.calculateEntropy(matchedText);
          if (pattern.entropy && entropy < pattern.entropy) {
            continue;
          }

          // Calculate confidence
          const confidence = this.calculateConfidence(matchedText, pattern);
          if (confidence < this.configuration.confidenceThreshold!) {
            continue;
          }

          // Get context (surrounding lines)
          const contextStart = Math.max(0, lineIndex - 2);
          const contextEnd = Math.min(lines.length - 1, lineIndex + 2);
          const context = lines.slice(contextStart, contextEnd + 1).join('\n');

          const detectedSecret: DetectedSecret = {
            id: crypto.randomUUID(),
            pattern,
            match: matchedText,
            redactedMatch: this.generateRedactedMatch(matchedText, pattern),
            lineNumber: lineIndex + 1,
            columnStart: match.index,
            columnEnd: match.index + matchedText.length,
            context,
            entropy,
            confidence
          };

          detectedSecrets.push(detectedSecret);
        }
      }
    }

    return detectedSecrets;
  }

  /**
   * Redact secrets from log content
   */
  private redactSecrets(content: string, secrets: DetectedSecret[]): string {
    let redactedContent = content;

    // Sort secrets by position (reverse order to maintain indices)
    const sortedSecrets = secrets.sort((a, b) => {
      if (a.lineNumber !== b.lineNumber) {
        return b.lineNumber - a.lineNumber;
      }
      return b.columnStart - a.columnStart;
    });

    const lines = redactedContent.split('\n');

    for (const secret of sortedSecrets) {
      const lineIndex = secret.lineNumber - 1;
      if (lineIndex >= 0 && lineIndex < lines.length) {
        const line = lines[lineIndex];
        const before = line.substring(0, secret.columnStart);
        const after = line.substring(secret.columnEnd);
        
        lines[lineIndex] = before + secret.redactedMatch + after;
      }
    }

    return lines.join('\n');
  }

  /**
   * Check if a match should be whitelisted
   */
  private isWhitelisted(match: string, pattern: SecretPattern): boolean {
    if (!pattern.whitelistPatterns) return false;

    return pattern.whitelistPatterns.some(whitelistPattern => 
      whitelistPattern.test(match)
    );
  }

  /**
   * Calculate entropy of a string
   */
  private calculateEntropy(str: string): number {
    if (str.length === 0) return 0;

    const charFreq: { [key: string]: number } = {};
    for (const char of str) {
      charFreq[char] = (charFreq[char] || 0) + 1;
    }

    let entropy = 0;
    const length = str.length;

    for (const char in charFreq) {
      const freq = charFreq[char] / length;
      if (freq > 0) {
        entropy -= freq * Math.log2(freq);
      }
    }

    return entropy;
  }

  /**
   * Calculate confidence score for a match
   */
  private calculateConfidence(match: string, pattern: SecretPattern): number {
    let confidence = 0.5; // Base confidence

    // Length-based confidence
    if (match.length >= 20) confidence += 0.2;
    if (match.length >= 32) confidence += 0.1;

    // Character variety
    const hasUppercase = /[A-Z]/.test(match);
    const hasLowercase = /[a-z]/.test(match);
    const hasNumbers = /[0-9]/.test(match);
    const hasSpecialChars = /[^a-zA-Z0-9]/.test(match);

    let charVariety = 0;
    if (hasUppercase) charVariety++;
    if (hasLowercase) charVariety++;
    if (hasNumbers) charVariety++;
    if (hasSpecialChars) charVariety++;

    confidence += (charVariety / 4) * 0.2;

    // Pattern-specific adjustments
    if (pattern.category === SecretCategory.JWT && match.split('.').length === 3) {
      confidence += 0.3;
    }

    return Math.min(1.0, confidence);
  }

  /**
   * Generate redacted version of a match
   */
  private generateRedactedMatch(match: string, pattern: SecretPattern): string {
    if (pattern.redactionPattern) {
      return pattern.redactionPattern;
    }

    // Default redaction patterns by category
    switch (pattern.category) {
      case SecretCategory.API_KEY:
        return `[REDACTED_API_KEY_${match.substring(0, 4)}***]`;
      case SecretCategory.PASSWORD:
        return '[REDACTED_PASSWORD]';
      case SecretCategory.TOKEN:
        return `[REDACTED_TOKEN_${match.substring(0, 4)}***]`;
      case SecretCategory.PRIVATE_KEY:
        return '[REDACTED_PRIVATE_KEY]';
      case SecretCategory.CERTIFICATE:
        return '[REDACTED_CERTIFICATE]';
      case SecretCategory.DATABASE_URL:
        return '[REDACTED_DATABASE_URL]';
      case SecretCategory.CLOUD_CREDENTIALS:
        return '[REDACTED_CLOUD_CREDENTIALS]';
      case SecretCategory.JWT:
        return '[REDACTED_JWT_TOKEN]';
      case SecretCategory.SSH_KEY:
        return '[REDACTED_SSH_KEY]';
      default:
        return `[REDACTED_SECRET_${match.substring(0, 4)}***]`;
    }
  }

  /**
   * Load default secret patterns
   */
  private async loadDefaultPatterns(): Promise<void> {
    const defaultPatterns: Omit<SecretPattern, 'id'>[] = [
      {
        name: 'GitHub Token',
        description: 'GitHub personal access token or app token',
        regex: /\b(gh[ps]_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})\b/,
        enabled: true,
        severity: SecretSeverity.CRITICAL,
        category: SecretCategory.TOKEN,
        entropy: 4.0
      },
      {
        name: 'AWS Access Key',
        description: 'Amazon Web Services access key',
        regex: /\b(AKIA[0-9A-Z]{16})\b/,
        enabled: true,
        severity: SecretSeverity.CRITICAL,
        category: SecretCategory.CLOUD_CREDENTIALS,
        entropy: 3.5
      },
      {
        name: 'AWS Secret Key',
        description: 'Amazon Web Services secret access key',
        regex: /\b([a-zA-Z0-9+/]{40})\b/,
        enabled: true,
        severity: SecretSeverity.CRITICAL,
        category: SecretCategory.CLOUD_CREDENTIALS,
        entropy: 4.5
      },
      {
        name: 'Generic API Key',
        description: 'Generic API key pattern',
        regex: /\b(api[_-]?key[_-]?[=:][\s]*["\']?([a-zA-Z0-9_\-]{16,})["\']?)\b/i,
        enabled: true,
        severity: SecretSeverity.HIGH,
        category: SecretCategory.API_KEY,
        entropy: 3.0
      },
      {
        name: 'Password in URL',
        description: 'Password embedded in connection string or URL',
        regex: /(password[_-]?[=:][\s]*["\']?([^"\s\n]{8,})["\']?)/i,
        enabled: true,
        severity: SecretSeverity.HIGH,
        category: SecretCategory.PASSWORD,
        entropy: 2.5
      },
      {
        name: 'JWT Token',
        description: 'JSON Web Token',
        regex: /\b(eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*)\b/,
        enabled: true,
        severity: SecretSeverity.HIGH,
        category: SecretCategory.JWT,
        entropy: 4.0
      },
      {
        name: 'Private Key',
        description: 'Private key in PEM format',
        regex: /-----BEGIN\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/i,
        enabled: true,
        severity: SecretSeverity.CRITICAL,
        category: SecretCategory.PRIVATE_KEY
      },
      {
        name: 'Database Connection String',
        description: 'Database connection string with credentials',
        regex: /(postgresql|mysql|mongodb|redis):\/\/[^:]*:[^@]*@[^\/\s]*/i,
        enabled: true,
        severity: SecretSeverity.HIGH,
        category: SecretCategory.DATABASE_URL
      },
      {
        name: 'Slack Token',
        description: 'Slack API token',
        regex: /\b(xox[baprs]-([0-9a-zA-Z]{10,48}))\b/,
        enabled: true,
        severity: SecretSeverity.HIGH,
        category: SecretCategory.TOKEN,
        entropy: 3.5
      },
      {
        name: 'Google API Key',
        description: 'Google API key',
        regex: /\b(AIza[0-9A-Za-z-_]{35})\b/,
        enabled: true,
        severity: SecretSeverity.HIGH,
        category: SecretCategory.API_KEY,
        entropy: 4.0
      },
      {
        name: 'Azure Key',
        description: 'Microsoft Azure key or token',
        regex: /\b([a-zA-Z0-9]{8}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{12})\b/,
        enabled: true,
        severity: SecretSeverity.HIGH,
        category: SecretCategory.CLOUD_CREDENTIALS,
        entropy: 3.0
      },
      {
        name: 'Docker Registry Token',
        description: 'Docker registry authentication token',
        regex: /\b(dckr_pat_[a-zA-Z0-9_-]{32,})\b/,
        enabled: true,
        severity: SecretSeverity.MEDIUM,
        category: SecretCategory.TOKEN,
        entropy: 3.5
      },
      {
        name: 'SSH Private Key',
        description: 'SSH private key content',
        regex: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+OPENSSH\s+PRIVATE\s+KEY-----/i,
        enabled: true,
        severity: SecretSeverity.CRITICAL,
        category: SecretCategory.SSH_KEY
      }
    ];

    for (const patternData of defaultPatterns) {
      const pattern: SecretPattern = {
        id: crypto.randomUUID(),
        ...patternData
      };
      this.patterns.set(pattern.id, pattern);
    }

    logger.info('Loaded default secret patterns', { count: defaultPatterns.length });
  }

  /**
   * Load custom patterns from database
   */
  private async loadCustomPatterns(): Promise<void> {
    try {
      const rows = await database.query(`
        SELECT * FROM secret_patterns 
        WHERE enabled = true 
        ORDER BY name
      `);

      for (const row of rows) {
        const pattern: SecretPattern = {
          id: row.id,
          name: row.name,
          description: row.description,
          regex: new RegExp(row.regex_pattern, row.regex_flags || 'gi'),
          entropy: row.minimum_entropy,
          enabled: row.enabled,
          severity: row.severity,
          category: row.category,
          redactionPattern: row.redaction_pattern,
          whitelistPatterns: row.whitelist_patterns?.map((p: string) => new RegExp(p, 'gi'))
        };

        this.patterns.set(pattern.id, pattern);
      }

      logger.info('Loaded custom secret patterns from database', { count: rows.length });
    } catch (error) {
      logger.warn('Failed to load custom patterns from database', { error });
      // Continue with default patterns only
    }
  }

  /**
   * Load configuration from database
   */
  private async loadConfiguration(): Promise<void> {
    try {
      const [config] = await database.query(`
        SELECT * FROM secret_scanner_config 
        WHERE id = 'default'
      `);

      if (config) {
        this.configuration = {
          enabled: config.enabled,
          autoRedact: config.auto_redact,
          whitelistRepositories: config.whitelist_repositories,
          minimumEntropy: config.minimum_entropy,
          confidenceThreshold: config.confidence_threshold,
          preserveFormatting: config.preserve_formatting,
          notifyOnDetection: config.notify_on_detection,
          blockJobOnSecrets: config.block_job_on_secrets,
          allowedFileExtensions: config.allowed_file_extensions
        };
      }

      logger.debug('Loaded secret scanner configuration', this.configuration);
    } catch (error) {
      logger.warn('Failed to load configuration from database, using defaults', { error });
    }
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(secrets: DetectedSecret[]) {
    const summary = {
      totalSecrets: secrets.length,
      criticalSecrets: 0,
      highSecrets: 0,
      mediumSecrets: 0,
      lowSecrets: 0,
      categoryCounts: {} as Record<SecretCategory, number>
    };

    // Initialize category counts
    for (const category of Object.values(SecretCategory)) {
      summary.categoryCounts[category] = 0;
    }

    for (const secret of secrets) {
      // Count by severity
      switch (secret.pattern.severity) {
        case SecretSeverity.CRITICAL:
          summary.criticalSecrets++;
          break;
        case SecretSeverity.HIGH:
          summary.highSecrets++;
          break;
        case SecretSeverity.MEDIUM:
          summary.mediumSecrets++;
          break;
        case SecretSeverity.LOW:
          summary.lowSecrets++;
          break;
      }

      // Count by category
      summary.categoryCounts[secret.pattern.category]++;
    }

    return summary;
  }

  /**
   * Get audit severity from scan result
   */
  private getSeverityFromScan(scanResult: ScanResult): AuditSeverity {
    if (scanResult.summary.criticalSecrets > 0) {
      return AuditSeverity.CRITICAL;
    } else if (scanResult.summary.highSecrets > 0) {
      return AuditSeverity.WARNING;
    } else if (scanResult.summary.totalSecrets > 0) {
      return AuditSeverity.INFO;
    }
    return AuditSeverity.INFO;
  }

  /**
   * Save scan result to database
   */
  private async saveScanResult(scanResult: ScanResult): Promise<void> {
    try {
      await database.query(`
        INSERT INTO job_log_secret_scans (
          id, job_id, scan_date, scan_duration, detected_secrets, 
          summary, status, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        scanResult.id,
        scanResult.jobId,
        scanResult.scanDate,
        scanResult.scanDuration,
        JSON.stringify(scanResult.detectedSecrets),
        JSON.stringify(scanResult.summary),
        scanResult.status,
        scanResult.errorMessage
      ]);
    } catch (error) {
      logger.error('Failed to save scan result', { error });
      throw error;
    }
  }

  /**
   * Create empty scan result for disabled scanning
   */
  private createEmptyScanResult(jobId: string, logContent: string): ScanResult {
    return {
      id: crypto.randomUUID(),
      jobId,
      logContent,
      redactedLogContent: logContent,
      scanDate: new Date(),
      scanDuration: 0,
      detectedSecrets: [],
      summary: this.calculateSummary([]),
      status: 'completed'
    };
  }

  /**
   * Get scan results for a job
   */
  async getScanResults(jobId: string): Promise<ScanResult[]> {
    try {
      const rows = await database.query(`
        SELECT * FROM job_log_secret_scans 
        WHERE job_id = $1 
        ORDER BY scan_date DESC
      `, [jobId]);

      return rows.map(row => ({
        id: row.id,
        jobId: row.job_id,
        logContent: '', // Don't return full content in list
        redactedLogContent: '', // Don't return full content in list
        scanDate: row.scan_date,
        scanDuration: row.scan_duration,
        detectedSecrets: row.detected_secrets || [],
        summary: row.summary,
        status: row.status,
        errorMessage: row.error_message
      }));
    } catch (error) {
      logger.error('Failed to get scan results', { error });
      throw error;
    }
  }

  /**
   * Update configuration
   */
  async updateConfiguration(config: Partial<ScanConfiguration>): Promise<void> {
    this.configuration = { ...this.configuration, ...config };
    
    try {
      await database.query(`
        INSERT INTO secret_scanner_config (
          id, enabled, auto_redact, whitelist_repositories, minimum_entropy,
          confidence_threshold, preserve_formatting, notify_on_detection,
          block_job_on_secrets, allowed_file_extensions, updated_at
        ) VALUES (
          'default', $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP
        )
        ON CONFLICT (id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          auto_redact = EXCLUDED.auto_redact,
          whitelist_repositories = EXCLUDED.whitelist_repositories,
          minimum_entropy = EXCLUDED.minimum_entropy,
          confidence_threshold = EXCLUDED.confidence_threshold,
          preserve_formatting = EXCLUDED.preserve_formatting,
          notify_on_detection = EXCLUDED.notify_on_detection,
          block_job_on_secrets = EXCLUDED.block_job_on_secrets,
          allowed_file_extensions = EXCLUDED.allowed_file_extensions,
          updated_at = CURRENT_TIMESTAMP
      `, [
        this.configuration.enabled,
        this.configuration.autoRedact,
        this.configuration.whitelistRepositories,
        this.configuration.minimumEntropy,
        this.configuration.confidenceThreshold,
        this.configuration.preserveFormatting,
        this.configuration.notifyOnDetection,
        this.configuration.blockJobOnSecrets,
        this.configuration.allowedFileExtensions
      ]);

      logger.info('Updated secret scanner configuration');
    } catch (error) {
      logger.error('Failed to save configuration', { error });
      throw error;
    }
  }

  /**
   * Add custom pattern
   */
  async addCustomPattern(pattern: Omit<SecretPattern, 'id'>): Promise<SecretPattern> {
    const id = crypto.randomUUID();
    const fullPattern: SecretPattern = { id, ...pattern };

    try {
      await database.query(`
        INSERT INTO secret_patterns (
          id, name, description, regex_pattern, regex_flags, minimum_entropy,
          enabled, severity, category, redaction_pattern, whitelist_patterns
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        id,
        pattern.name,
        pattern.description,
        pattern.regex.source,
        pattern.regex.flags,
        pattern.entropy,
        pattern.enabled,
        pattern.severity,
        pattern.category,
        pattern.redactionPattern,
        pattern.whitelistPatterns?.map(p => p.source)
      ]);

      this.patterns.set(id, fullPattern);
      logger.info('Added custom secret pattern', { name: pattern.name });

      return fullPattern;
    } catch (error) {
      logger.error('Failed to add custom pattern', { error });
      throw error;
    }
  }

  /**
   * Get statistics
   */
  async getStatistics(days: number = 30): Promise<{
    totalScans: number;
    secretsDetected: number;
    mostCommonSecrets: Array<{ category: string; count: number }>;
    scansByDay: Array<{ date: Date; scans: number; secrets: number }>;
  }> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const [stats] = await database.query(`
        SELECT 
          COUNT(*) as total_scans,
          SUM((summary->>'totalSecrets')::int) as secrets_detected
        FROM job_log_secret_scans
        WHERE scan_date >= $1
      `, [since]);

      const commonSecrets = await database.query(`
        SELECT 
          secret->>'category' as category,
          COUNT(*) as count
        FROM job_log_secret_scans,
          LATERAL jsonb_array_elements(detected_secrets) as secret
        WHERE scan_date >= $1
        GROUP BY secret->>'category'
        ORDER BY count DESC
        LIMIT 10
      `, [since]);

      const dailyStats = await database.query(`
        SELECT 
          DATE_TRUNC('day', scan_date) as date,
          COUNT(*) as scans,
          SUM((summary->>'totalSecrets')::int) as secrets
        FROM job_log_secret_scans
        WHERE scan_date >= $1
        GROUP BY DATE_TRUNC('day', scan_date)
        ORDER BY date
      `, [since]);

      return {
        totalScans: parseInt(stats.total_scans) || 0,
        secretsDetected: parseInt(stats.secrets_detected) || 0,
        mostCommonSecrets: commonSecrets.map((row: any) => ({
          category: row.category,
          count: parseInt(row.count)
        })),
        scansByDay: dailyStats.map((row: any) => ({
          date: row.date,
          scans: parseInt(row.scans),
          secrets: parseInt(row.secrets) || 0
        }))
      };
    } catch (error) {
      logger.error('Failed to get statistics', { error });
      throw error;
    }
  }

  /**
   * Shutdown the scanner
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down job log secret scanner');
    this.removeAllListeners();
    logger.info('Job log secret scanner shut down successfully');
  }
}

export default JobLogSecretScanner.getInstance();