/**
 * Security validation utilities
 * Provides input validation and sanitization functions to prevent security vulnerabilities
 */

import { createLogger } from './logger';

const logger = createLogger('SecurityValidators');

/**
 * Validates GitHub repository format and prevents path traversal
 * @param repository - Repository string in format "owner/repo"
 * @returns Validated repository string or throws error
 */
export function validateGitHubRepository(repository: string): string {
  if (!repository || typeof repository !== 'string') {
    throw new Error('Repository must be a non-empty string');
  }

  // Remove any leading/trailing whitespace
  const trimmed = repository.trim();

  // Check basic format: owner/repo
  const parts = trimmed.split('/');
  if (parts.length !== 2) {
    throw new Error('Repository must be in format "owner/repo"');
  }

  const [owner, repo] = parts;

  // Validate owner and repo names according to GitHub rules
  if (!owner || !repo) {
    throw new Error('Both owner and repository name must be non-empty');
  }

  // GitHub username/org rules: alphanumeric, hyphens, max 39 chars
  const validNamePattern = /^[a-zA-Z0-9-]+$/;
  if (!validNamePattern.test(owner) || !validNamePattern.test(repo)) {
    throw new Error('Repository owner and name must contain only alphanumeric characters and hyphens');
  }

  // Length validation
  if (owner.length > 39 || repo.length > 100) {
    throw new Error('Repository owner must be ≤39 chars, repository name must be ≤100 chars');
  }

  // Prevent path traversal attacks
  if (owner.includes('..') || repo.includes('..') || 
      owner.includes('/') || repo.includes('/') ||
      owner.includes('\\') || repo.includes('\\')) {
    throw new Error('Repository names cannot contain path traversal sequences');
  }

  // Prevent URL scheme injection
  if (owner.toLowerCase().startsWith('http') || repo.toLowerCase().startsWith('http') ||
      owner.includes(':') || repo.includes(':')) {
    throw new Error('Repository names cannot contain URL schemes or colons');
  }

  logger.debug('Validated GitHub repository', { repository: `${owner}/${repo}` });
  return `${owner}/${repo}`;
}

/**
 * Validates and sanitizes webhook event types
 * @param eventType - Event type from webhook headers
 * @returns Validated event type or throws error
 */
export function validateWebhookEventType(eventType: string): string {
  if (!eventType || typeof eventType !== 'string') {
    throw new Error('Event type must be a non-empty string');
  }

  const trimmed = eventType.trim();

  // Whitelist of allowed GitHub event types
  const allowedEvents = [
    'check_run', 'check_suite', 'workflow_dispatch', 'workflow_job', 'workflow_run',
    'create', 'delete', 'push',
    'pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_target',
    'issues', 'issue_comment',
    'deployment', 'deployment_status', 'fork', 'gollum', 'page_build', 'public',
    'release', 'repository', 'repository_dispatch', 'star', 'status', 'watch',
    'ping', 'installation', 'installation_repositories', 'organization', 'member'
  ];

  if (!allowedEvents.includes(trimmed)) {
    throw new Error(`Event type "${trimmed}" is not supported`);
  }

  // Additional security checks
  if (trimmed.length > 50) {
    throw new Error('Event type too long');
  }

  if (!/^[a-z_]+$/.test(trimmed)) {
    throw new Error('Event type must contain only lowercase letters and underscores');
  }

  return trimmed;
}

/**
 * Sanitizes string input to prevent format string attacks
 * @param input - User input string
 * @param maxLength - Maximum allowed length
 * @returns Sanitized string
 */
export function sanitizeStringInput(input: string, maxLength: number = 1000): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Truncate to max length
  let sanitized = input.substring(0, maxLength);

  // Remove potential format string specifiers
  sanitized = sanitized.replace(/%[sdioxX%]/g, '');

  // Remove potential template literal injection
  sanitized = sanitized.replace(/\$\{[^}]*\}/g, '');

  // Remove control characters except common whitespace
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return sanitized.trim();
}

/**
 * Validates URL to prevent SSRF attacks
 * @param url - URL to validate
 * @param allowedDomains - List of allowed domains
 * @returns Validated URL or throws error
 */
export function validateURL(url: string, allowedDomains: string[] = ['api.github.com']): string {
  if (!url || typeof url !== 'string') {
    throw new Error('URL must be a non-empty string');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    throw new Error('Invalid URL format');
  }

  // Only allow HTTPS
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }

  // Check against allowed domains
  if (!allowedDomains.includes(parsedUrl.hostname)) {
    throw new Error(`Domain ${parsedUrl.hostname} is not in the allowlist`);
  }

  // Prevent private IP ranges (basic check)
  const hostname = parsedUrl.hostname;
  if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|169\.254\.|::1|localhost)/.test(hostname)) {
    throw new Error('Private IP addresses and localhost are not allowed');
  }

  return url;
}

/**
 * Rate limiting key validator
 * @param key - Rate limiting key
 * @returns Validated key
 */
export function validateRateLimitKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Rate limit key must be a non-empty string');
  }

  // Remove any potentially dangerous characters
  const sanitized = key.replace(/[^a-zA-Z0-9:\-_.]/g, '');
  
  if (sanitized.length === 0) {
    throw new Error('Rate limit key contains no valid characters');
  }

  if (sanitized.length > 100) {
    throw new Error('Rate limit key too long');
  }

  return sanitized;
}