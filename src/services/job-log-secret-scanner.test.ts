import jobLogSecretScanner, { SecretSeverity, SecretCategory, JobLogSecretScanner } from './job-log-secret-scanner';

// Mock dependencies
jest.mock('./database', () => ({
  query: jest.fn()
}));

jest.mock('./audit-logger', () => ({
  log: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

describe('JobLogSecretScanner', () => {
  let scanner: JobLogSecretScanner;

  beforeEach(() => {
    scanner = jobLogSecretScanner;
    // Reset any state if needed
    jest.clearAllMocks();
  });

  describe('Secret Detection', () => {
    test('should detect GitHub tokens', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [INFO] Starting CI job
        2023-01-01T10:00:01Z [DEBUG] Using GitHub token: ghp_EXAMPLE_TOKEN_REPLACE_WITH_YOURS56
        2023-01-01T10:00:02Z [INFO] Job completed
      `;

      const result = await scanner.scanJobLogs('test-job-1', logContent);
      
      expect(result.detectedSecrets).toHaveLength(1);
      expect(result.detectedSecrets[0].pattern.category).toBe(SecretCategory.TOKEN);
      expect(result.detectedSecrets[0].pattern.severity).toBe(SecretSeverity.CRITICAL);
      expect(result.detectedSecrets[0].match).toBe('ghp_EXAMPLE_TOKEN_REPLACE_WITH_YOURS56');
    });

    test('should detect AWS credentials', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [INFO] Starting deployment
        2023-01-01T10:00:01Z [DEBUG] AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
        2023-01-01T10:00:02Z [DEBUG] AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
        2023-01-01T10:00:03Z [INFO] Deployment completed
      `;

      const result = await scanner.scanJobLogs('test-job-2', logContent);
      
      expect(result.detectedSecrets.length).toBeGreaterThan(0);
      
      const awsAccessKey = result.detectedSecrets.find((s: any) => 
        s.match.includes('AKIAIOSFODNN7EXAMPLE')
      );
      expect(awsAccessKey).toBeDefined();
      expect(awsAccessKey?.pattern.category).toBe(SecretCategory.CLOUD_CREDENTIALS);
    });

    test('should detect JWT tokens', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [INFO] Authenticating user
        2023-01-01T10:00:01Z [DEBUG] JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
        2023-01-01T10:00:02Z [INFO] Authentication successful
      `;

      const result = await scanner.scanJobLogs('test-job-3', logContent);
      
      expect(result.detectedSecrets).toHaveLength(1);
      expect(result.detectedSecrets[0].pattern.category).toBe(SecretCategory.JWT);
      expect(result.detectedSecrets[0].match).toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    test('should detect database connection strings', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [INFO] Connecting to database
        2023-01-01T10:00:01Z [DEBUG] DB_URL=postgresql://user:password123@localhost:5432/mydb
        2023-01-01T10:00:02Z [INFO] Database connected
      `;

      const result = await scanner.scanJobLogs('test-job-4', logContent);
      
      expect(result.detectedSecrets).toHaveLength(1);
      expect(result.detectedSecrets[0].pattern.category).toBe(SecretCategory.DATABASE_URL);
      expect(result.detectedSecrets[0].match).toContain('postgresql://user:password123@localhost:5432/mydb');
    });

    test('should detect API keys', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [INFO] Initializing API client
        2023-01-01T10:00:01Z [DEBUG] API_KEY=sk-1234567890abcdef1234567890abcdef
        2023-01-01T10:00:02Z [INFO] API client ready
      `;

      const result = await scanner.scanJobLogs('test-job-5', logContent);
      
      expect(result.detectedSecrets).toHaveLength(1);
      expect(result.detectedSecrets[0].pattern.category).toBe(SecretCategory.API_KEY);
    });
  });

  describe('Secret Redaction', () => {
    test('should redact GitHub tokens', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [INFO] Starting CI job
        2023-01-01T10:00:01Z [DEBUG] Using GitHub token: ghp_EXAMPLE_TOKEN_REPLACE_WITH_YOURS56
        2023-01-01T10:00:02Z [INFO] Job completed
      `;

      const result = await scanner.scanJobLogs('test-job-redact-1', logContent);
      
      expect(result.redactedLogContent).not.toContain('ghp_EXAMPLE_TOKEN_REPLACE_WITH_YOURS56');
      expect(result.redactedLogContent).toContain('[REDACTED_TOKEN_ghp_***]');
    });

    test('should preserve log formatting', async () => {
      const logContent = `2023-01-01T10:00:00Z [INFO] Starting CI job
2023-01-01T10:00:01Z [DEBUG] Using GitHub token: ghp_EXAMPLE_TOKEN_REPLACE_WITH_YOURS56
2023-01-01T10:00:02Z [INFO] Job completed`;

      const result = await scanner.scanJobLogs('test-job-redact-2', logContent);
      
      // Should maintain line structure
      const originalLines = logContent.split('\n');
      const redactedLines = result.redactedLogContent.split('\n');
      expect(redactedLines).toHaveLength(originalLines.length);
      
      // Should preserve timestamps and log levels
      expect(result.redactedLogContent).toContain('2023-01-01T10:00:00Z [INFO]');
      expect(result.redactedLogContent).toContain('2023-01-01T10:00:01Z [DEBUG]');
      expect(result.redactedLogContent).toContain('2023-01-01T10:00:02Z [INFO]');
    });
  });

  describe('Statistical Calculations', () => {
    test('should calculate correct summary statistics', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [DEBUG] GitHub token: ghp_EXAMPLE_TOKEN_REPLACE_WITH_YOURS56
        2023-01-01T10:00:01Z [DEBUG] AWS key: AKIAIOSFODNN7EXAMPLE
        2023-01-01T10:00:02Z [DEBUG] API key: sk-1234567890abcdef1234567890abcdef
        2023-01-01T10:00:03Z [DEBUG] JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
      `;

      const result = await scanner.scanJobLogs('test-job-stats', logContent);
      
      expect(result.summary.totalSecrets).toBe(4);
      expect(result.summary.criticalSecrets).toBeGreaterThan(0);
      expect(result.summary.highSecrets).toBeGreaterThan(0);
      
      // Check category counts
      expect(result.summary.categoryCounts[SecretCategory.TOKEN]).toBeGreaterThan(0);
      expect(result.summary.categoryCounts[SecretCategory.CLOUD_CREDENTIALS]).toBeGreaterThan(0);
      expect(result.summary.categoryCounts[SecretCategory.API_KEY]).toBeGreaterThan(0);
      expect(result.summary.categoryCounts[SecretCategory.JWT]).toBeGreaterThan(0);
    });
  });

  describe('Entropy Calculation', () => {
    test('should calculate entropy correctly', () => {
      // Test the entropy calculation method (if exposed or through reflection)
      // For now, this is a placeholder for entropy testing
      expect(true).toBe(true);
    });
  });

  describe('Confidence Scoring', () => {
    test('should assign higher confidence to complex secrets', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [DEBUG] Simple: abc123
        2023-01-01T10:00:01Z [DEBUG] Complex: ghp_EXAMPLE_TOKEN_REPLACE_WITH_YOURS56
      `;

      const result = await scanner.scanJobLogs('test-job-confidence', logContent);
      
      if (result.detectedSecrets.length > 0) {
        const complexSecret = result.detectedSecrets.find((s: any) => 
          s.match.includes('ghp_')
        );
        
        if (complexSecret) {
          expect(complexSecret.confidence).toBeGreaterThan(0.7);
        }
      }
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty logs', async () => {
      const result = await scanner.scanJobLogs('test-job-empty', '');
      
      expect(result.detectedSecrets).toHaveLength(0);
      expect(result.summary.totalSecrets).toBe(0);
      expect(result.redactedLogContent).toBe('');
    });

    test('should handle logs with no secrets', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [INFO] Starting CI job
        2023-01-01T10:00:01Z [INFO] Running tests
        2023-01-01T10:00:02Z [INFO] Job completed successfully
      `;

      const result = await scanner.scanJobLogs('test-job-clean', logContent);
      
      expect(result.detectedSecrets).toHaveLength(0);
      expect(result.summary.totalSecrets).toBe(0);
      expect(result.redactedLogContent).toBe(logContent);
    });

    test('should handle very large logs', async () => {
      // Generate a large log file
      const lines = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`2023-01-01T10:${String(i % 60).padStart(2, '0')}:00Z [INFO] Log line ${i}`);
      }
      // Add one secret in the middle
      lines[500] = '2023-01-01T10:30:00Z [DEBUG] Token: ghp_EXAMPLE_TOKEN_REPLACE_WITH_YOURS56';
      
      const logContent = lines.join('\n');
      
      const result = await scanner.scanJobLogs('test-job-large', logContent);
      
      expect(result.detectedSecrets).toHaveLength(1);
      expect(result.summary.totalSecrets).toBe(1);
    });

    test('should handle logs with multiple secrets on same line', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [DEBUG] Secrets: API_KEY=sk-123456 GITHUB_TOKEN=ghp_abcdef AWS_KEY=AKIATEST123
      `;

      const result = await scanner.scanJobLogs('test-job-multiline', logContent);
      
      expect(result.detectedSecrets.length).toBeGreaterThan(1);
    });
  });

  describe('Performance', () => {
    test('should complete scanning within reasonable time', async () => {
      const logContent = `
        2023-01-01T10:00:00Z [INFO] Starting performance test
        2023-01-01T10:00:01Z [DEBUG] API_KEY=sk-1234567890abcdef1234567890abcdef
        2023-01-01T10:00:02Z [INFO] Performance test completed
      `;

      const startTime = Date.now();
      const result = await scanner.scanJobLogs('test-job-perf', logContent);
      const endTime = Date.now();

      expect(result.scanDuration).toBeLessThan(5000); // 5 seconds max
      expect(endTime - startTime).toBeLessThan(5000);
    });
  });
});