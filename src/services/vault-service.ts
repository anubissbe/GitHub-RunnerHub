import { createLogger } from '../utils/logger';
import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';

const logger = createLogger('VaultService');

export interface VaultConfig {
  url: string;
  token: string;
  namespace?: string;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface SecretData {
  [key: string]: string | number | boolean;
}

export interface VaultSecret {
  path: string;
  data: SecretData;
  version?: number;
  metadata?: {
    created_time: string;
    version: number;
    destroyed: boolean;
  };
}

export interface TokenInfo {
  accessor: string;
  creation_time: number;
  creation_ttl: number;
  display_name: string;
  entity_id: string;
  expire_time?: string;
  explicit_max_ttl: number;
  id: string;
  issue_time: string;
  meta?: Record<string, string>;
  num_uses: number;
  orphan: boolean;
  path: string;
  policies: string[];
  renewable: boolean;
  ttl: number;
  type: string;
  lease_duration?: number; // Added for token renewal responses
}

/**
 * HashiCorp Vault integration service for GitHub RunnerHub
 * Provides secure secret management, token rotation, and audit logging
 */
export class VaultService extends EventEmitter {
  private static instance: VaultService;
  private client: AxiosInstance;
  private config: VaultConfig;
  private tokenRenewalTimer?: NodeJS.Timeout;
  private secretCache: Map<string, { data: SecretData; ttl: number }> = new Map();

  private constructor(config: VaultConfig) {
    super();
    this.config = {
      retryAttempts: 3,
      retryDelay: 1000,
      ...config
    };

    this.client = axios.create({
      baseURL: this.config.url,
      headers: {
        'X-Vault-Token': this.config.token,
        'Content-Type': 'application/json',
        ...(this.config.namespace && { 'X-Vault-Namespace': this.config.namespace })
      },
      timeout: 10000
    });

    this.setupInterceptors();
  }

  public static getInstance(config?: VaultConfig): VaultService {
    if (!VaultService.instance) {
      if (!config) {
        throw new Error('VaultService configuration required for first initialization');
      }
      VaultService.instance = new VaultService(config);
    }
    return VaultService.instance;
  }

  /**
   * Initialize Vault service and set up token renewal
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Vault service', { 
      url: this.config.url,
      namespace: this.config.namespace 
    });

    try {
      // Verify Vault connectivity
      await this.checkHealth();
      
      // Verify token validity
      const tokenInfo = await this.getTokenInfo();
      logger.info('Vault token validated', {
        displayName: tokenInfo.display_name,
        policies: tokenInfo.policies,
        ttl: tokenInfo.ttl,
        renewable: tokenInfo.renewable
      });

      // Set up automatic token renewal if renewable
      if (tokenInfo.renewable && tokenInfo.ttl > 0) {
        this.setupTokenRenewal(tokenInfo.ttl);
      }

      // Verify access to GitHub RunnerHub secrets
      await this.verifySecretAccess();

      logger.info('Vault service initialized successfully');
      this.emit('initialized');

    } catch (error) {
      logger.error('Failed to initialize Vault service', { error });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get secret from Vault with caching
   */
  async getSecret(path: string, version?: number): Promise<VaultSecret> {
    const cacheKey = `${path}:${version || 'latest'}`;
    
    // Check cache first
    const cached = this.secretCache.get(cacheKey);
    if (cached && Date.now() < cached.ttl) {
      logger.debug('Retrieved secret from cache', { path });
      return { path, data: cached.data };
    }

    try {
      const versionParam = version ? `?version=${version}` : '';
      const response = await this.client.get(`/v1/secret/data/${path}${versionParam}`);
      
      const secret: VaultSecret = {
        path,
        data: response.data.data.data,
        version: response.data.data.metadata.version,
        metadata: response.data.data.metadata
      };

      // Cache for 5 minutes
      this.secretCache.set(cacheKey, {
        data: secret.data,
        ttl: Date.now() + 300000
      });

      logger.debug('Retrieved secret from Vault', { 
        path, 
        version: secret.version,
        keysCount: Object.keys(secret.data).length 
      });

      this.emit('secret-accessed', { path, version: secret.version });
      return secret;

    } catch (error) {
      logger.error('Failed to retrieve secret', { path, version, error });
      throw this.handleVaultError(error);
    }
  }

  /**
   * Store secret in Vault
   */
  async putSecret(path: string, data: SecretData): Promise<{ version: number }> {
    try {
      const response = await this.client.post(`/v1/secret/data/${path}`, {
        data
      });

      const version = response.data.data.version;
      
      // Invalidate cache
      this.invalidateSecretCache(path);

      logger.info('Secret stored successfully', { 
        path, 
        version,
        keysCount: Object.keys(data).length 
      });

      this.emit('secret-updated', { path, version });
      return { version };

    } catch (error) {
      logger.error('Failed to store secret', { path, error });
      throw this.handleVaultError(error);
    }
  }

  /**
   * Delete secret from Vault
   */
  async deleteSecret(path: string, versions?: number[]): Promise<void> {
    try {
      if (versions && versions.length > 0) {
        // Delete specific versions
        await this.client.post(`/v1/secret/delete/${path}`, {
          versions
        });
        logger.info('Deleted secret versions', { path, versions });
      } else {
        // Delete latest version
        await this.client.delete(`/v1/secret/metadata/${path}`);
        logger.info('Deleted secret completely', { path });
      }

      // Invalidate cache
      this.invalidateSecretCache(path);

      this.emit('secret-deleted', { path, versions });

    } catch (error) {
      logger.error('Failed to delete secret', { path, versions, error });
      throw this.handleVaultError(error);
    }
  }

  /**
   * List secrets at a given path
   */
  async listSecrets(path: string): Promise<string[]> {
    try {
      const response = await this.client.get(`/v1/secret/metadata/${path}?list=true`);
      const keys = response.data.data.keys || [];
      
      logger.debug('Listed secrets', { path, count: keys.length });
      return keys;

    } catch (error) {
      logger.error('Failed to list secrets', { path, error });
      throw this.handleVaultError(error);
    }
  }

  /**
   * Get GitHub-specific secrets for RunnerHub
   */
  async getGitHubSecrets(): Promise<{
    token: string;
    webhookSecret: string;
    appId?: string;
    privateKey?: string;
  }> {
    try {
      const secret = await this.getSecret('github/runnerhub');
      
      return {
        token: secret.data.token as string,
        webhookSecret: secret.data.webhook_secret as string,
        appId: secret.data.app_id as string,
        privateKey: secret.data.private_key as string
      };

    } catch (error) {
      logger.error('Failed to retrieve GitHub secrets', { error });
      throw error;
    }
  }

  /**
   * Get database credentials
   */
  async getDatabaseCredentials(): Promise<{
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  }> {
    try {
      const secret = await this.getSecret('database/runnerhub');
      
      return {
        host: secret.data.host as string,
        port: secret.data.port as number,
        database: secret.data.database as string,
        username: secret.data.username as string,
        password: secret.data.password as string
      };

    } catch (error) {
      logger.error('Failed to retrieve database credentials', { error });
      throw error;
    }
  }

  /**
   * Get Redis credentials
   */
  async getRedisCredentials(): Promise<{
    host: string;
    port: number;
    password?: string;
  }> {
    try {
      const secret = await this.getSecret('redis/runnerhub');
      
      return {
        host: secret.data.host as string,
        port: secret.data.port as number,
        password: secret.data.password as string
      };

    } catch (error) {
      logger.error('Failed to retrieve Redis credentials', { error });
      throw error;
    }
  }

  /**
   * Rotate GitHub token
   */
  async rotateGitHubToken(newToken: string): Promise<void> {
    try {
      const currentSecrets = await this.getGitHubSecrets();
      
      await this.putSecret('github/runnerhub', {
        ...currentSecrets,
        token: newToken,
        rotated_at: new Date().toISOString()
      });

      logger.info('GitHub token rotated successfully');
      this.emit('token-rotated', { type: 'github' });

    } catch (error) {
      logger.error('Failed to rotate GitHub token', { error });
      throw error;
    }
  }

  /**
   * Get token information
   */
  async getTokenInfo(): Promise<TokenInfo> {
    try {
      const response = await this.client.get('/v1/auth/token/lookup-self');
      return response.data.data;

    } catch (error) {
      logger.error('Failed to get token info', { error });
      throw this.handleVaultError(error);
    }
  }

  /**
   * Renew token
   */
  async renewToken(increment?: number): Promise<TokenInfo> {
    try {
      const response = await this.client.post('/v1/auth/token/renew-self', {
        increment: increment || 3600 // 1 hour default
      });

      const tokenInfo = response.data.auth;
      logger.info('Token renewed successfully', { 
        ttl: tokenInfo.lease_duration || tokenInfo.ttl,
        renewable: tokenInfo.renewable 
      });

      this.emit('token-renewed', { ttl: tokenInfo.lease_duration || tokenInfo.ttl });
      return tokenInfo;

    } catch (error) {
      logger.error('Failed to renew token', { error });
      throw this.handleVaultError(error);
    }
  }

  /**
   * Check Vault health
   */
  async checkHealth(): Promise<{
    initialized: boolean;
    sealed: boolean;
    standby: boolean;
    version: string;
  }> {
    try {
      const response = await this.client.get('/v1/sys/health');
      return response.data;

    } catch (error) {
      logger.error('Vault health check failed', { error });
      throw this.handleVaultError(error);
    }
  }

  /**
   * Set up automatic token renewal
   */
  private setupTokenRenewal(ttl: number): void {
    // Renew when 75% of TTL has passed
    const renewalTime = Math.max(ttl * 0.75 * 1000, 300000); // At least 5 minutes

    if (this.tokenRenewalTimer) {
      clearTimeout(this.tokenRenewalTimer);
    }

    this.tokenRenewalTimer = setTimeout(async () => {
      try {
        const newTokenInfo = await this.renewToken();
        this.setupTokenRenewal(newTokenInfo.lease_duration || newTokenInfo.ttl);
      } catch (error) {
        logger.error('Automatic token renewal failed', { error });
        this.emit('token-renewal-failed', error);
      }
    }, renewalTime);

    logger.info('Token renewal scheduled', { 
      renewalTimeMs: renewalTime,
      renewalTimeMin: Math.round(renewalTime / 60000) 
    });
  }

  /**
   * Verify access to required secret paths
   */
  private async verifySecretAccess(): Promise<void> {
    const requiredPaths = [
      'github/runnerhub',
      'database/runnerhub', 
      'redis/runnerhub'
    ];

    for (const path of requiredPaths) {
      try {
        await this.getSecret(path);
        logger.debug('Verified access to secret path', { path });
      } catch (error) {
        logger.warn('Cannot access secret path - may need to be created', { path });
      }
    }
  }

  /**
   * Set up HTTP interceptors for retry and logging
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('Vault API request', { 
          method: config.method?.toUpperCase(),
          url: config.url,
          path: config.url?.replace(this.config.url, '')
        });
        return config;
      },
      (error) => {
        logger.error('Vault request interceptor error', { error });
        return Promise.reject(error);
      }
    );

    // Response interceptor with retry logic
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('Vault API response', { 
          status: response.status,
          url: response.config.url?.replace(this.config.url, '')
        });
        return response;
      },
      async (error) => {
        const config = error.config;
        
        if (!config.retryCount) {
          config.retryCount = 0;
        }

        if (config.retryCount < (this.config.retryAttempts || 3)) {
          config.retryCount++;
          
          logger.warn('Retrying Vault request', { 
            attempt: config.retryCount,
            maxAttempts: this.config.retryAttempts,
            url: config.url?.replace(this.config.url, '')
          });

          await new Promise(resolve => 
            setTimeout(resolve, this.config.retryDelay || 1000)
          );

          return this.client.request(config);
        }

        return Promise.reject(this.handleVaultError(error));
      }
    );
  }

  /**
   * Handle Vault-specific errors
   */
  private handleVaultError(error: any): Error {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      switch (status) {
        case 400:
          return new Error(`Vault bad request: ${data.errors?.join(', ') || 'Invalid request'}`);
        case 403:
          return new Error(`Vault access denied: ${data.errors?.join(', ') || 'Insufficient permissions'}`);
        case 404:
          return new Error(`Vault path not found: ${data.errors?.join(', ') || 'Path does not exist'}`);
        case 429:
          return new Error(`Vault rate limited: ${data.errors?.join(', ') || 'Too many requests'}`);
        case 500:
          return new Error(`Vault server error: ${data.errors?.join(', ') || 'Internal server error'}`);
        case 503:
          return new Error(`Vault unavailable: ${data.errors?.join(', ') || 'Service unavailable'}`);
        default:
          return new Error(`Vault error (${status}): ${data.errors?.join(', ') || 'Unknown error'}`);
      }
    }

    if (error.code === 'ECONNREFUSED') {
      return new Error('Cannot connect to Vault server - check URL and network connectivity');
    }

    if (error.code === 'ETIMEDOUT') {
      return new Error('Vault request timeout - server may be overloaded');
    }

    return error;
  }

  /**
   * Invalidate cache for a secret path
   */
  private invalidateSecretCache(path: string): void {
    const keysToDelete = Array.from(this.secretCache.keys())
      .filter(key => key.startsWith(`${path}:`));
    
    keysToDelete.forEach(key => this.secretCache.delete(key));
    logger.debug('Invalidated secret cache', { path, keysRemoved: keysToDelete.length });
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Vault service');

    if (this.tokenRenewalTimer) {
      clearTimeout(this.tokenRenewalTimer);
      this.tokenRenewalTimer = undefined;
    }

    this.secretCache.clear();
    this.removeAllListeners();

    logger.info('Vault service shutdown complete');
  }
}

export default VaultService;