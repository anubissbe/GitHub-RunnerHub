import { 
  validateGitHubRepository, 
  validateWebhookEventType, 
  sanitizeStringInput, 
  validateURL, 
  validateRateLimitKey 
} from '../../src/utils/security-validators';

describe('Security Validators', () => {
  describe('validateGitHubRepository', () => {
    it('should validate correct repository format', () => {
      expect(validateGitHubRepository('owner/repo')).toBe('owner/repo');
      expect(validateGitHubRepository('test-org/my-repo')).toBe('test-org/my-repo');
    });

    it('should reject invalid repository formats', () => {
      expect(() => validateGitHubRepository('')).toThrow('Repository must be a non-empty string');
      expect(() => validateGitHubRepository('invalid')).toThrow('Repository must be in format "owner/repo"');
      expect(() => validateGitHubRepository('owner/repo/extra')).toThrow('Repository must be in format "owner/repo"');
    });

    it('should prevent path traversal attacks', () => {
      expect(() => validateGitHubRepository('../evil/repo')).toThrow('Repository names cannot contain path traversal sequences');
      expect(() => validateGitHubRepository('owner/../repo')).toThrow('Repository names cannot contain path traversal sequences');
      expect(() => validateGitHubRepository('owner\\repo')).toThrow('Repository names cannot contain path traversal sequences');
    });

    it('should prevent URL scheme injection', () => {
      expect(() => validateGitHubRepository('http://evil.com/repo')).toThrow('Repository names cannot contain URL schemes or colons');
      expect(() => validateGitHubRepository('owner:repo')).toThrow('Repository names cannot contain URL schemes or colons');
    });
  });

  describe('validateWebhookEventType', () => {
    it('should validate allowed event types', () => {
      expect(validateWebhookEventType('workflow_job')).toBe('workflow_job');
      expect(validateWebhookEventType('push')).toBe('push');
      expect(validateWebhookEventType('pull_request')).toBe('pull_request');
    });

    it('should reject invalid event types', () => {
      expect(() => validateWebhookEventType('')).toThrow('Event type must be a non-empty string');
      expect(() => validateWebhookEventType('invalid_event')).toThrow('Event type "invalid_event" is not supported');
      expect(() => validateWebhookEventType('UPPERCASE')).toThrow('Event type must contain only lowercase letters and underscores');
    });
  });

  describe('sanitizeStringInput', () => {
    it('should remove format string specifiers', () => {
      expect(sanitizeStringInput('Hello %s world')).toBe('Hello  world');
      expect(sanitizeStringInput('Value: %d')).toBe('Value: ');
      expect(sanitizeStringInput('Test %x hex')).toBe('Test  hex');
    });

    it('should remove template literal injection', () => {
      expect(sanitizeStringInput('Hello ${evil} world')).toBe('Hello  world');
      expect(sanitizeStringInput('Test ${process.exit(1)}')).toBe('Test ');
    });

    it('should remove control characters', () => {
      expect(sanitizeStringInput('Hello\x00World')).toBe('HelloWorld');
      expect(sanitizeStringInput('Test\x1FString')).toBe('TestString');
    });

    it('should truncate to max length', () => {
      const longString = 'a'.repeat(2000);
      expect(sanitizeStringInput(longString, 100)).toHaveLength(100);
    });
  });

  describe('validateURL', () => {
    it('should validate HTTPS URLs with allowed domains', () => {
      expect(validateURL('https://api.github.com/repos/owner/repo')).toBe('https://api.github.com/repos/owner/repo');
    });

    it('should reject non-HTTPS URLs', () => {
      expect(() => validateURL('http://api.github.com/test')).toThrow('Only HTTPS URLs are allowed');
      expect(() => validateURL('ftp://api.github.com/test')).toThrow('Only HTTPS URLs are allowed');
    });

    it('should reject disallowed domains', () => {
      expect(() => validateURL('https://evil.com/test')).toThrow('Domain evil.com is not in the allowlist');
    });

    it('should reject private IP addresses', () => {
      expect(() => validateURL('https://192.168.1.1/test')).toThrow('Private IP addresses and localhost are not allowed');
      expect(() => validateURL('https://127.0.0.1/test')).toThrow('Private IP addresses and localhost are not allowed');
      expect(() => validateURL('https://localhost/test')).toThrow('Private IP addresses and localhost are not allowed');
    });
  });

  describe('validateRateLimitKey', () => {
    it('should validate clean rate limit keys', () => {
      expect(validateRateLimitKey('user:123')).toBe('user:123');
      expect(validateRateLimitKey('api-key_test')).toBe('api-key_test');
    });

    it('should sanitize dangerous characters', () => {
      expect(validateRateLimitKey('user<script>alert(1)</script>')).toBe('useralert');
      expect(validateRateLimitKey('key with spaces')).toBe('keywithspaces');
    });

    it('should reject keys that are too long', () => {
      const longKey = 'a'.repeat(200);
      expect(() => validateRateLimitKey(longKey)).toThrow('Rate limit key too long');
    });
  });
});