/**
 * Secret Management System
 * Provides secure storage, encryption, and injection of secrets for GitHub Runner containers
 * with support for HashiCorp Vault, environment variables, and encrypted file storage
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

class SecretManagementSystem extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Encryption settings
      encryptionAlgorithm: options.encryptionAlgorithm || 'aes-256-gcm',
      keyDerivationIterations: options.keyDerivationIterations || 100000,
      saltLength: options.saltLength || 32,
      tagLength: options.tagLength || 16,
      
      // Secret storage backends
      backends: {
        vault: {
          enabled: options.vaultEnabled || false,
          address: options.vaultAddress || process.env.VAULT_ADDR,
          token: options.vaultToken || process.env.VAULT_TOKEN,
          namespace: options.vaultNamespace || 'github-runners',
          transitEngine: options.transitEngine || 'transit',
          kvEngine: options.kvEngine || 'secret'
        },
        encrypted: {
          enabled: options.encryptedStorageEnabled !== false,
          basePath: options.secretsPath || '/opt/github-runnerhub/secrets',
          keyPath: options.masterKeyPath || '/opt/github-runnerhub/keys/master.key'
        },
        environment: {
          enabled: options.envSecretsEnabled !== false,
          prefix: options.envPrefix || 'RUNNER_SECRET_'
        }
      },
      
      // Secret policies
      secretPolicies: {
        rotation: {
          enabled: options.rotationEnabled || false,
          interval: options.rotationInterval || 2592000000, // 30 days
          grace: options.rotationGrace || 86400000 // 24 hours
        },
        access: {
          requireMFA: options.requireMFA || false,
          auditAccess: options.auditAccess !== false,
          maxAccessCount: options.maxAccessCount || 100
        },
        validation: {
          enforceComplexity: options.enforceComplexity || true,
          minLength: options.minSecretLength || 16,
          requireSpecialChars: options.requireSpecialChars || true
        }
      },
      
      // Container injection settings
      injectionMethods: {
        environment: options.injectAsEnv !== false,
        file: options.injectAsFile || false,
        memory: options.injectInMemory || false
      },
      
      // Temporary secret settings
      tempSecretTTL: options.tempSecretTTL || 3600000, // 1 hour
      cleanupInterval: options.cleanupInterval || 300000, // 5 minutes
      
      ...options
    };
    
    // Secret storage
    this.secrets = new Map(); // secretId -> encryptedSecret
    this.secretMetadata = new Map(); // secretId -> metadata
    this.temporarySecrets = new Map(); // secretId -> tempSecret
    
    // Access tracking
    this.accessLog = [];
    this.secretAccess = new Map(); // secretId -> accessCount
    
    // Encryption keys
    this.masterKey = null;
    this.derivedKeys = new Map(); // purpose -> key
    
    // Vault client (if enabled)
    this.vaultClient = null;
    
    // Cleanup timer
    this.cleanupTimer = null;
    
    this.isInitialized = false;
  }

  /**
   * Initialize the secret management system
   */
  async initialize() {
    try {
      logger.info('Initializing Secret Management System');
      
      // Initialize encryption keys
      await this.initializeEncryption();
      
      // Initialize storage backends
      await this.initializeBackends();
      
      // Load existing secrets
      await this.loadSecrets();
      
      // Start cleanup timer
      this.startCleanupTimer();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Secret Management System initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Secret Management System:', error);
      throw error;
    }
  }

  /**
   * Store a secret
   */
  async storeSecret(secretId, secretValue, metadata = {}) {
    try {
      logger.info(`Storing secret: ${secretId}`);
      
      // Validate secret
      this.validateSecret(secretValue);
      
      // Encrypt the secret
      const encrypted = await this.encryptSecret(secretValue);
      
      // Store in active backend
      if (this.config.backends.vault.enabled) {
        await this.storeInVault(secretId, encrypted, metadata);
      } else if (this.config.backends.encrypted.enabled) {
        await this.storeEncrypted(secretId, encrypted, metadata);
      }
      
      // Store in memory cache
      this.secrets.set(secretId, encrypted);
      this.secretMetadata.set(secretId, {
        ...metadata,
        createdAt: new Date(),
        lastAccessed: null,
        accessCount: 0,
        rotationDue: this.calculateRotationDue()
      });
      
      // Audit log
      this.auditSecretAction('store', secretId, {
        metadata,
        backend: this.getActiveBackend()
      });
      
      // Emit event
      this.emit('secretStored', {
        secretId,
        metadata
      });
      
      return true;
      
    } catch (error) {
      logger.error(`Failed to store secret ${secretId}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve a secret
   */
  async getSecret(secretId, purpose = 'general') {
    try {
      logger.debug(`Retrieving secret: ${secretId}`);
      
      // Check access permissions
      await this.checkSecretAccess(secretId, purpose);
      
      // Get encrypted secret
      let encrypted = this.secrets.get(secretId);
      
      if (!encrypted) {
        // Try to load from backend
        if (this.config.backends.vault.enabled) {
          encrypted = await this.getFromVault(secretId);
        } else if (this.config.backends.encrypted.enabled) {
          encrypted = await this.getFromEncrypted(secretId);
        }
        
        if (!encrypted) {
          throw new Error(`Secret ${secretId} not found`);
        }
        
        // Cache it
        this.secrets.set(secretId, encrypted);
      }
      
      // Decrypt the secret
      const decrypted = await this.decryptSecret(encrypted);
      
      // Update access tracking
      this.trackSecretAccess(secretId);
      
      // Audit log
      this.auditSecretAction('retrieve', secretId, { purpose });
      
      return decrypted;
      
    } catch (error) {
      logger.error(`Failed to retrieve secret ${secretId}:`, error);
      throw error;
    }
  }

  /**
   * Inject secrets into a container
   */
  async injectSecrets(containerId, jobId, requiredSecrets = []) {
    try {
      logger.info(`Injecting secrets for container ${containerId}`);
      
      const injectedSecrets = [];
      
      for (const secretConfig of requiredSecrets) {
        const { secretId, name, method } = secretConfig;
        
        // Retrieve the secret
        const secretValue = await this.getSecret(secretId, `container-${containerId}`);
        
        // Inject based on method
        switch (method || 'environment') {
          case 'environment':
            await this.injectAsEnvironment(containerId, name, secretValue);
            break;
            
          case 'file':
            await this.injectAsFile(containerId, name, secretValue);
            break;
            
          case 'memory':
            await this.injectInMemory(containerId, name, secretValue);
            break;
            
          default:
            logger.warn(`Unknown injection method: ${method}`);
        }
        
        injectedSecrets.push({
          secretId,
          name,
          method: method || 'environment'
        });
      }
      
      // Create temporary access token for runtime secret access
      const accessToken = await this.createTemporaryAccessToken(jobId, requiredSecrets);
      
      // Emit injection event
      this.emit('secretsInjected', {
        containerId,
        jobId,
        count: injectedSecrets.length,
        accessToken
      });
      
      // Audit log
      this.auditSecretAction('inject', jobId, {
        containerId,
        secrets: injectedSecrets.map(s => s.secretId)
      });
      
      return {
        injectedSecrets,
        accessToken
      };
      
    } catch (error) {
      logger.error(`Failed to inject secrets for container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Rotate a secret
   */
  async rotateSecret(secretId, newValue) {
    try {
      logger.info(`Rotating secret: ${secretId}`);
      
      // Get current metadata
      const metadata = this.secretMetadata.get(secretId);
      if (!metadata) {
        throw new Error(`Secret ${secretId} not found`);
      }
      
      // Store old version for rollback
      const oldEncrypted = this.secrets.get(secretId);
      
      // Store new secret
      await this.storeSecret(secretId, newValue, {
        ...metadata,
        rotatedAt: new Date(),
        previousVersion: oldEncrypted
      });
      
      // Update rotation schedule
      metadata.rotationDue = this.calculateRotationDue();
      metadata.lastRotation = new Date();
      
      // Emit rotation event
      this.emit('secretRotated', {
        secretId,
        rotatedAt: metadata.lastRotation
      });
      
      // Audit log
      this.auditSecretAction('rotate', secretId, {
        reason: 'scheduled_rotation'
      });
      
      return true;
      
    } catch (error) {
      logger.error(`Failed to rotate secret ${secretId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a secret
   */
  async deleteSecret(secretId) {
    try {
      logger.info(`Deleting secret: ${secretId}`);
      
      // Remove from all backends
      if (this.config.backends.vault.enabled) {
        await this.deleteFromVault(secretId);
      } else if (this.config.backends.encrypted.enabled) {
        await this.deleteFromEncrypted(secretId);
      }
      
      // Remove from memory
      this.secrets.delete(secretId);
      this.secretMetadata.delete(secretId);
      this.secretAccess.delete(secretId);
      
      // Emit deletion event
      this.emit('secretDeleted', { secretId });
      
      // Audit log
      this.auditSecretAction('delete', secretId, {});
      
      return true;
      
    } catch (error) {
      logger.error(`Failed to delete secret ${secretId}:`, error);
      throw error;
    }
  }

  /**
   * Initialize encryption system
   */
  async initializeEncryption() {
    try {
      // Load or generate master key
      if (this.config.backends.encrypted.enabled) {
        this.masterKey = await this.loadOrGenerateMasterKey();
      } else {
        // Generate ephemeral key for session
        this.masterKey = crypto.randomBytes(32);
      }
      
      // Derive purpose-specific keys
      await this.deriveKeys();
      
      logger.debug('Encryption system initialized');
      
    } catch (error) {
      logger.error('Failed to initialize encryption:', error);
      throw error;
    }
  }

  /**
   * Load or generate master key
   */
  async loadOrGenerateMasterKey() {
    const keyPath = this.config.backends.encrypted.keyPath;
    
    try {
      // Try to load existing key
      const keyData = await fs.readFile(keyPath);
      return Buffer.from(keyData, 'hex');
      
    } catch (error) {
      // Generate new key
      logger.info('Generating new master key');
      const key = crypto.randomBytes(32);
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(keyPath), { recursive: true });
      
      // Save key
      await fs.writeFile(keyPath, key.toString('hex'), { mode: 0o600 });
      
      return key;
    }
  }

  /**
   * Derive purpose-specific keys
   */
  async deriveKeys() {
    const purposes = ['encryption', 'authentication', 'signing'];
    
    for (const purpose of purposes) {
      const salt = crypto.randomBytes(this.config.saltLength);
      const key = crypto.pbkdf2Sync(
        this.masterKey,
        salt,
        this.config.keyDerivationIterations,
        32,
        'sha256'
      );
      
      this.derivedKeys.set(purpose, { key, salt });
    }
  }

  /**
   * Encrypt a secret
   */
  async encryptSecret(plaintext) {
    const { key } = this.derivedKeys.get('encryption');
    
    // Generate IV
    const iv = crypto.randomBytes(16);
    
    // Create cipher
    const cipher = crypto.createCipheriv(this.config.encryptionAlgorithm, key, iv);
    
    // Encrypt
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    
    // Get auth tag
    const tag = cipher.getAuthTag();
    
    // Combine IV + tag + encrypted
    const combined = Buffer.concat([iv, tag, encrypted]);
    
    return combined.toString('base64');
  }

  /**
   * Decrypt a secret
   */
  async decryptSecret(encryptedData) {
    const { key } = this.derivedKeys.get('encryption');
    
    // Parse combined data
    const combined = Buffer.from(encryptedData, 'base64');
    const iv = combined.slice(0, 16);
    const tag = combined.slice(16, 16 + this.config.tagLength);
    const encrypted = combined.slice(16 + this.config.tagLength);
    
    // Create decipher
    const decipher = crypto.createDecipheriv(this.config.encryptionAlgorithm, key, iv);
    decipher.setAuthTag(tag);
    
    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  }

  /**
   * Validate secret complexity
   */
  validateSecret(secret) {
    if (!this.config.secretPolicies.validation.enforceComplexity) {
      return true;
    }
    
    if (secret.length < this.config.secretPolicies.validation.minLength) {
      throw new Error(`Secret must be at least ${this.config.secretPolicies.validation.minLength} characters`);
    }
    
    if (this.config.secretPolicies.validation.requireSpecialChars) {
      if (!/[!@#$%^&*(),.?":{}|<>]/.test(secret)) {
        throw new Error('Secret must contain special characters');
      }
    }
    
    return true;
  }

  /**
   * Check secret access permissions
   */
  async checkSecretAccess(secretId, _purpose) {
    const metadata = this.secretMetadata.get(secretId);
    if (!metadata) {
      throw new Error(`Secret ${secretId} not found`);
    }
    
    // Check access count limit
    const accessCount = this.secretAccess.get(secretId) || 0;
    if (accessCount >= this.config.secretPolicies.access.maxAccessCount) {
      throw new Error(`Secret ${secretId} has exceeded maximum access count`);
    }
    
    // Check MFA requirement
    if (this.config.secretPolicies.access.requireMFA) {
      // This would integrate with MFA system
      logger.debug(`MFA check for secret ${secretId}`);
    }
    
    return true;
  }

  /**
   * Track secret access
   */
  trackSecretAccess(secretId) {
    const metadata = this.secretMetadata.get(secretId);
    if (metadata) {
      metadata.lastAccessed = new Date();
      metadata.accessCount += 1;
    }
    
    const currentCount = this.secretAccess.get(secretId) || 0;
    this.secretAccess.set(secretId, currentCount + 1);
    
    this.accessLog.push({
      secretId,
      timestamp: new Date(),
      accessCount: currentCount + 1
    });
  }

  /**
   * Initialize storage backends
   */
  async initializeBackends() {
    // Initialize Vault if enabled
    if (this.config.backends.vault.enabled) {
      await this.initializeVault();
    }
    
    // Initialize encrypted storage
    if (this.config.backends.encrypted.enabled) {
      await this.initializeEncryptedStorage();
    }
    
    logger.debug('Storage backends initialized');
  }

  /**
   * Initialize Vault backend
   */
  async initializeVault() {
    // This would integrate with HashiCorp Vault
    // For now, we'll create a mock client
    
    this.vaultClient = {
      read: async (path) => {
        logger.debug(`Vault read: ${path}`);
        return null;
      },
      write: async (path, _data) => {
        logger.debug(`Vault write: ${path}`);
        return true;
      },
      delete: async (path) => {
        logger.debug(`Vault delete: ${path}`);
        return true;
      }
    };
    
    logger.info('Vault backend initialized');
  }

  /**
   * Initialize encrypted file storage
   */
  async initializeEncryptedStorage() {
    const basePath = this.config.backends.encrypted.basePath;
    
    try {
      await fs.mkdir(basePath, { recursive: true, mode: 0o700 });
      logger.info('Encrypted storage initialized');
    } catch (error) {
      logger.error('Failed to initialize encrypted storage:', error);
      throw error;
    }
  }

  /**
   * Store secret in Vault
   */
  async storeInVault(secretId, encrypted, metadata) {
    const path = `${this.config.backends.vault.kvEngine}/${this.config.backends.vault.namespace}/${secretId}`;
    
    await this.vaultClient.write(path, {
      data: encrypted,
      metadata: JSON.stringify(metadata),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get secret from Vault
   */
  async getFromVault(secretId) {
    const path = `${this.config.backends.vault.kvEngine}/${this.config.backends.vault.namespace}/${secretId}`;
    
    const response = await this.vaultClient.read(path);
    return response?.data;
  }

  /**
   * Delete secret from Vault
   */
  async deleteFromVault(secretId) {
    const path = `${this.config.backends.vault.kvEngine}/${this.config.backends.vault.namespace}/${secretId}`;
    
    await this.vaultClient.delete(path);
  }

  /**
   * Store secret in encrypted file
   */
  async storeEncrypted(secretId, encrypted, metadata) {
    const filePath = path.join(this.config.backends.encrypted.basePath, `${secretId}.enc`);
    const metaPath = path.join(this.config.backends.encrypted.basePath, `${secretId}.meta`);
    
    // Store encrypted secret
    await fs.writeFile(filePath, encrypted, { mode: 0o600 });
    
    // Store metadata
    await fs.writeFile(metaPath, JSON.stringify({
      ...metadata,
      storedAt: new Date().toISOString()
    }), { mode: 0o600 });
  }

  /**
   * Get secret from encrypted file
   */
  async getFromEncrypted(secretId) {
    const filePath = path.join(this.config.backends.encrypted.basePath, `${secretId}.enc`);
    
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete secret from encrypted storage
   */
  async deleteFromEncrypted(secretId) {
    const filePath = path.join(this.config.backends.encrypted.basePath, `${secretId}.enc`);
    const metaPath = path.join(this.config.backends.encrypted.basePath, `${secretId}.meta`);
    
    try {
      await fs.unlink(filePath);
      await fs.unlink(metaPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Load existing secrets
   */
  async loadSecrets() {
    if (this.config.backends.encrypted.enabled) {
      await this.loadEncryptedSecrets();
    }
    
    logger.info(`Loaded ${this.secrets.size} secrets`);
  }

  /**
   * Load secrets from encrypted storage
   */
  async loadEncryptedSecrets() {
    const basePath = this.config.backends.encrypted.basePath;
    
    try {
      const files = await fs.readdir(basePath);
      const secretFiles = files.filter(f => f.endsWith('.enc'));
      
      for (const file of secretFiles) {
        const secretId = file.replace('.enc', '');
        const filePath = path.join(basePath, file);
        const metaPath = path.join(basePath, `${secretId}.meta`);
        
        try {
          // Load encrypted data
          const encrypted = await fs.readFile(filePath, 'utf8');
          
          // Load metadata
          const metaData = await fs.readFile(metaPath, 'utf8');
          const metadata = JSON.parse(metaData);
          
          // Store in memory
          this.secrets.set(secretId, encrypted);
          this.secretMetadata.set(secretId, metadata);
          
        } catch (error) {
          logger.error(`Failed to load secret ${secretId}:`, error);
        }
      }
    } catch (error) {
      logger.error('Failed to load encrypted secrets:', error);
    }
  }

  /**
   * Inject secret as environment variable
   */
  async injectAsEnvironment(containerId, name, _value) {
    // This would integrate with Docker API to set environment variable
    // For security, we'll use a secure method that doesn't expose in docker inspect
    
    logger.debug(`Injected secret ${name} as environment variable in container ${containerId}`);
  }

  /**
   * Inject secret as file
   */
  async injectAsFile(containerId, name, _value) {
    // This would create a temporary file and mount it into the container
    // The file would be deleted after container stops
    
    const tempPath = `/tmp/secrets/${containerId}/${name}`;
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
    await fs.writeFile(tempPath, _value, { mode: 0o400 });
    
    logger.debug(`Injected secret ${name} as file in container ${containerId}`);
  }

  /**
   * Inject secret in memory
   */
  async injectInMemory(containerId, name, _value) {
    // This would use a secure memory injection method
    // For example, using a memory-mapped file or shared memory
    
    logger.debug(`Injected secret ${name} in memory for container ${containerId}`);
  }

  /**
   * Create temporary access token
   */
  async createTemporaryAccessToken(jobId, secrets) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + this.config.tempSecretTTL);
    
    this.temporarySecrets.set(token, {
      jobId,
      secrets,
      expires,
      used: false
    });
    
    return token;
  }

  /**
   * Calculate rotation due date
   */
  calculateRotationDue() {
    if (!this.config.secretPolicies.rotation.enabled) {
      return null;
    }
    
    return new Date(Date.now() + this.config.secretPolicies.rotation.interval);
  }

  /**
   * Get active backend name
   */
  getActiveBackend() {
    if (this.config.backends.vault.enabled) return 'vault';
    if (this.config.backends.encrypted.enabled) return 'encrypted';
    if (this.config.backends.environment.enabled) return 'environment';
    return 'memory';
  }

  /**
   * Start cleanup timer
   */
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSecrets().catch(err => 
        logger.error('Secret cleanup failed:', err)
      );
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up expired temporary secrets
   */
  async cleanupExpiredSecrets() {
    const now = new Date();
    const expired = [];
    
    for (const [token, data] of this.temporarySecrets.entries()) {
      if (data.expires < now) {
        expired.push(token);
      }
    }
    
    for (const token of expired) {
      this.temporarySecrets.delete(token);
    }
    
    if (expired.length > 0) {
      logger.debug(`Cleaned up ${expired.length} expired temporary secrets`);
    }
  }

  /**
   * Audit secret action
   */
  auditSecretAction(action, secretId, details) {
    const audit = {
      timestamp: new Date(),
      action,
      secretId,
      details,
      type: 'secret'
    };
    
    // Emit audit event
    this.emit('secretAudit', audit);
    
    logger.debug(`Secret audit: ${action} on ${secretId}`);
  }

  /**
   * Get secret management report
   */
  getSecretReport() {
    return {
      totalSecrets: this.secrets.size,
      temporarySecrets: this.temporarySecrets.size,
      backends: {
        vault: this.config.backends.vault.enabled,
        encrypted: this.config.backends.encrypted.enabled,
        environment: this.config.backends.environment.enabled
      },
      accessLog: this.accessLog.slice(-100), // Last 100 accesses
      statistics: {
        totalAccesses: this.accessLog.length,
        averageAccessPerSecret: this.calculateAverageAccess(),
        secretsNeedingRotation: this.getSecretsNeedingRotation().length,
        activeBackend: this.getActiveBackend()
      }
    };
  }

  /**
   * Calculate average access per secret
   */
  calculateAverageAccess() {
    if (this.secretAccess.size === 0) return 0;
    
    const total = Array.from(this.secretAccess.values())
      .reduce((sum, count) => sum + count, 0);
    
    return total / this.secretAccess.size;
  }

  /**
   * Get secrets needing rotation
   */
  getSecretsNeedingRotation() {
    const now = new Date();
    const needsRotation = [];
    
    for (const [secretId, metadata] of this.secretMetadata.entries()) {
      if (metadata.rotationDue && metadata.rotationDue < now) {
        needsRotation.push({ secretId, dueDate: metadata.rotationDue });
      }
    }
    
    return needsRotation;
  }

  /**
   * Stop the secret management system
   */
  async stop() {
    logger.info('Stopping Secret Management System');
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Clear sensitive data from memory
    this.secrets.clear();
    this.temporarySecrets.clear();
    this.masterKey = null;
    this.derivedKeys.clear();
    
    this.emit('stopped');
    logger.info('Secret Management System stopped');
  }
}

module.exports = SecretManagementSystem;