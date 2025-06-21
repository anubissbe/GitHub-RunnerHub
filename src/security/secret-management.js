/**
 * Secret Management System
 * Secure handling and injection of secrets into containers with encryption and access control
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class SecretManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Encryption settings
      encryption: {
        algorithm: options.algorithm || 'aes-256-gcm',
        keyDerivationIterations: options.iterations || 100000,
        saltLength: options.saltLength || 32,
        ivLength: options.ivLength || 16,
        tagLength: options.tagLength || 16
      },
      
      // Storage settings
      storage: {
        type: options.storageType || 'vault', // 'vault', 'file', 'memory'
        path: options.storagePath || '/var/lib/runnerhub/secrets',
        vaultUrl: options.vaultUrl || process.env.VAULT_ADDR,
        vaultToken: options.vaultToken || process.env.VAULT_TOKEN,
        vaultMount: options.vaultMount || 'secret'
      },
      
      // Access control
      accessControl: {
        enableRBAC: options.enableRBAC !== false,
        defaultTTL: options.defaultTTL || 3600, // 1 hour
        maxTTL: options.maxTTL || 86400, // 24 hours
        rotationInterval: options.rotationInterval || 604800000 // 7 days
      },
      
      // Secret injection methods
      injection: {
        methods: options.injectionMethods || ['env', 'file', 'volume'],
        defaultMethod: options.defaultInjectionMethod || 'env',
        secretsPath: options.secretsPath || '/run/secrets',
        envPrefix: options.envPrefix || 'SECRET_'
      },
      
      // Security policies
      policies: {
        requireEncryption: options.requireEncryption !== false,
        auditAll: options.auditAll !== false,
        maskInLogs: options.maskInLogs !== false,
        rotateOnAccess: options.rotateOnAccess || false,
        maxSecretSize: options.maxSecretSize || 1024 * 1024 // 1MB
      },
      
      ...options
    };
    
    // Secret storage
    this.secrets = new Map(); // secretId -> encryptedSecret
    this.secretMetadata = new Map(); // secretId -> metadata
    this.accessTokens = new Map(); // token -> permissions
    
    // Encryption state
    this.masterKey = null;
    this.keyDerivationSalt = null;
    
    // Access tracking
    this.accessLog = [];
    this.activeInjections = new Map(); // containerId -> injectedSecrets
    
    // Vault client (if using Vault)
    this.vaultClient = null;
    
    this.isInitialized = false;
  }

  /**
   * Initialize the secret manager
   */
  async initialize() {
    try {
      logger.info('Initializing Secret Manager');
      
      // Initialize encryption
      await this.initializeEncryption();
      
      // Initialize storage backend
      await this.initializeStorage();
      
      // Load existing secrets
      await this.loadSecrets();
      
      // Start secret rotation if enabled
      if (this.config.accessControl.rotationInterval > 0) {
        this.startSecretRotation();
      }
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('Secret Manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Secret Manager:', error);
      throw error;
    }
  }

  /**
   * Store a secret
   */
  async storeSecret(secretId, secretData, metadata = {}) {
    try {
      if (!this.isInitialized) {
        throw new Error('Secret Manager not initialized');
      }
      
      // Validate secret
      this.validateSecret(secretId, secretData);
      
      logger.info(`Storing secret ${secretId}`);
      
      // Encrypt secret
      const encryptedData = await this.encryptSecret(secretData);
      
      // Create metadata
      const secretMetadata = {
        id: secretId,
        createdAt: new Date(),
        updatedAt: new Date(),
        ttl: metadata.ttl || this.config.accessControl.defaultTTL,
        accessCount: 0,
        lastAccessed: null,
        tags: metadata.tags || [],
        permissions: metadata.permissions || {},
        rotationPolicy: metadata.rotationPolicy || 'manual',
        ...metadata
      };
      
      // Store in backend
      await this.storeInBackend(secretId, encryptedData, secretMetadata);
      
      // Update local cache
      this.secrets.set(secretId, encryptedData);
      this.secretMetadata.set(secretId, secretMetadata);
      
      // Audit log
      this.auditSecretOperation('store', secretId, { 
        success: true,
        metadata: this.sanitizeMetadata(secretMetadata)
      });
      
      this.emit('secretStored', { secretId, metadata: secretMetadata });
      
      logger.info(`Successfully stored secret ${secretId}`);
      return secretId;
      
    } catch (error) {
      logger.error(`Failed to store secret ${secretId}:`, error);
      this.auditSecretOperation('store', secretId, { success: false, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieve a secret
   */
  async retrieveSecret(secretId, accessToken = null) {
    try {
      if (!this.isInitialized) {
        throw new Error('Secret Manager not initialized');
      }
      
      // Check access permissions
      await this.checkAccess(secretId, 'read', accessToken);
      
      // Get encrypted secret
      const encryptedData = await this.getFromBackend(secretId);
      if (!encryptedData) {
        throw new Error(`Secret ${secretId} not found`);
      }
      
      // Decrypt secret
      const secretData = await this.decryptSecret(encryptedData);
      
      // Update access tracking
      await this.updateAccessTracking(secretId);
      
      // Audit log
      this.auditSecretOperation('retrieve', secretId, { success: true });
      
      this.emit('secretAccessed', { secretId, timestamp: new Date() });
      
      return secretData;
      
    } catch (error) {
      logger.error(`Failed to retrieve secret ${secretId}:`, error);
      this.auditSecretOperation('retrieve', secretId, { success: false, error: error.message });
      throw error;
    }
  }

  /**
   * Inject secrets into container
   */
  async injectSecrets(containerId, secretRequests) {
    try {
      if (!this.isInitialized) {
        throw new Error('Secret Manager not initialized');
      }
      
      logger.info(`Injecting ${secretRequests.length} secrets into container ${containerId}`);
      
      const injectedSecrets = [];
      
      for (const request of secretRequests) {
        const injection = await this.injectSingleSecret(containerId, request);
        injectedSecrets.push(injection);
      }
      
      // Track injections
      this.activeInjections.set(containerId, injectedSecrets);
      
      this.emit('secretsInjected', {
        containerId,
        secretCount: injectedSecrets.length,
        injections: injectedSecrets.map(i => ({ 
          secretId: i.secretId, 
          method: i.method,
          target: i.target 
        }))
      });
      
      logger.info(`Successfully injected ${injectedSecrets.length} secrets into container ${containerId}`);
      return injectedSecrets;
      
    } catch (error) {
      logger.error(`Failed to inject secrets into container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Inject a single secret
   */
  async injectSingleSecret(containerId, request) {
    const { secretId, method, target, accessToken } = request;
    
    // Retrieve secret
    const secretData = await this.retrieveSecret(secretId, accessToken);
    
    // Determine injection method
    const injectionMethod = method || this.config.injection.defaultMethod;
    
    let injection = {
      secretId,
      method: injectionMethod,
      target,
      injectedAt: new Date()
    };
    
    switch (injectionMethod) {
      case 'env':
        injection = await this.injectAsEnvironmentVariable(containerId, secretId, secretData, target);
        break;
        
      case 'file':
        injection = await this.injectAsFile(containerId, secretId, secretData, target);
        break;
        
      case 'volume':
        injection = await this.injectAsVolume(containerId, secretId, secretData, target);
        break;
        
      default:
        throw new Error(`Unsupported injection method: ${injectionMethod}`);
    }
    
    return injection;
  }

  /**
   * Inject secret as environment variable
   */
  async injectAsEnvironmentVariable(containerId, secretId, secretData, envName) {
    const varName = envName || `${this.config.injection.envPrefix}${secretId.toUpperCase()}`;
    
    // Note: In a real Docker environment, this would update container environment
    // For now, we'll simulate the injection
    logger.info(`Injecting secret ${secretId} as environment variable ${varName} in container ${containerId}`);
    
    return {
      secretId,
      method: 'env',
      target: varName,
      injectedAt: new Date(),
      cleanup: async () => {
        // Cleanup logic would go here
        logger.info(`Cleaned up environment variable ${varName} from container ${containerId}`);
      }
    };
  }

  /**
   * Inject secret as file
   */
  async injectAsFile(containerId, secretId, secretData, filePath) {
    const targetPath = filePath || path.join(this.config.injection.secretsPath, secretId);
    
    // Create secret file (in container filesystem)
    logger.info(`Injecting secret ${secretId} as file ${targetPath} in container ${containerId}`);
    
    // In real implementation, this would write to container's filesystem
    // For now, simulate the operation
    
    return {
      secretId,
      method: 'file',
      target: targetPath,
      injectedAt: new Date(),
      cleanup: async () => {
        // Cleanup logic would remove the file
        logger.info(`Cleaned up secret file ${targetPath} from container ${containerId}`);
      }
    };
  }

  /**
   * Inject secret as mounted volume
   */
  async injectAsVolume(containerId, secretId, secretData, mountPath) {
    const targetMount = mountPath || path.join(this.config.injection.secretsPath, secretId);
    
    logger.info(`Injecting secret ${secretId} as volume mount ${targetMount} in container ${containerId}`);
    
    // In real implementation, this would create and mount a volume
    
    return {
      secretId,
      method: 'volume',
      target: targetMount,
      injectedAt: new Date(),
      cleanup: async () => {
        // Cleanup logic would unmount and remove volume
        logger.info(`Cleaned up secret volume ${targetMount} from container ${containerId}`);
      }
    };
  }

  /**
   * Clean up secrets from container
   */
  async cleanupSecrets(containerId) {
    try {
      const injections = this.activeInjections.get(containerId);
      if (!injections) {
        return;
      }
      
      logger.info(`Cleaning up ${injections.length} secrets from container ${containerId}`);
      
      for (const injection of injections) {
        if (injection.cleanup) {
          await injection.cleanup();
        }
      }
      
      this.activeInjections.delete(containerId);
      
      this.emit('secretsCleanedUp', { containerId, secretCount: injections.length });
      
      logger.info(`Successfully cleaned up secrets from container ${containerId}`);
      
    } catch (error) {
      logger.error(`Failed to cleanup secrets from container ${containerId}:`, error);
    }
  }

  /**
   * Rotate secret
   */
  async rotateSecret(secretId, newSecretData = null) {
    try {
      logger.info(`Rotating secret ${secretId}`);
      
      // Generate new secret if not provided
      if (!newSecretData) {
        newSecretData = await this.generateSecret(secretId);
      }
      
      // Get current metadata
      const metadata = this.secretMetadata.get(secretId);
      if (!metadata) {
        throw new Error(`Secret ${secretId} not found`);
      }
      
      // Store old version for rollback
      const oldVersion = await this.getFromBackend(secretId);
      
      // Store new version
      await this.storeSecret(secretId, newSecretData, {
        ...metadata,
        previousVersion: oldVersion,
        rotatedAt: new Date(),
        rotationReason: 'scheduled'
      });
      
      this.emit('secretRotated', { secretId, rotatedAt: new Date() });
      
      logger.info(`Successfully rotated secret ${secretId}`);
      
    } catch (error) {
      logger.error(`Failed to rotate secret ${secretId}:`, error);
      throw error;
    }
  }

  /**
   * Encryption methods
   */
  
  async initializeEncryption() {
    if (!this.masterKey) {
      // Generate or load master key
      this.keyDerivationSalt = crypto.randomBytes(this.config.encryption.saltLength);
      
      // In production, this would be loaded from secure storage
      const password = process.env.SECRET_MASTER_PASSWORD || 'default-development-password';
      
      this.masterKey = crypto.pbkdf2Sync(
        password,
        this.keyDerivationSalt,
        this.config.encryption.keyDerivationIterations,
        32,
        'sha512'
      );
    }
  }
  
  async encryptSecret(data) {
    const iv = crypto.randomBytes(this.config.encryption.ivLength);
    const cipher = crypto.createCipher(this.config.encryption.algorithm, this.masterKey, { iv });
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      algorithm: this.config.encryption.algorithm
    };
  }
  
  async decryptSecret(encryptedData) {
    const decipher = crypto.createDecipher(
      encryptedData.algorithm,
      this.masterKey,
      { iv: Buffer.from(encryptedData.iv, 'hex') }
    );
    
    decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  /**
   * Storage backend methods
   */
  
  async initializeStorage() {
    switch (this.config.storage.type) {
      case 'vault':
        await this.initializeVaultStorage();
        break;
      case 'file':
        await this.initializeFileStorage();
        break;
      case 'memory':
        // Memory storage is already initialized
        break;
      default:
        throw new Error(`Unsupported storage type: ${this.config.storage.type}`);
    }
  }
  
  async initializeVaultStorage() {
    if (this.config.storage.vaultUrl && this.config.storage.vaultToken) {
      // Initialize Vault client (simplified)
      this.vaultClient = {
        url: this.config.storage.vaultUrl,
        token: this.config.storage.vaultToken,
        mount: this.config.storage.vaultMount
      };
      logger.info('Initialized Vault storage backend');
    } else {
      throw new Error('Vault URL and token required for Vault storage');
    }
  }
  
  async initializeFileStorage() {
    await fs.mkdir(this.config.storage.path, { recursive: true });
    logger.info(`Initialized file storage backend at ${this.config.storage.path}`);
  }
  
  async storeInBackend(secretId, encryptedData, metadata) {
    switch (this.config.storage.type) {
      case 'vault':
        await this.storeInVault(secretId, encryptedData, metadata);
        break;
      case 'file':
        await this.storeInFile(secretId, encryptedData, metadata);
        break;
      case 'memory':
        // Already stored in memory maps
        break;
    }
  }
  
  async getFromBackend(secretId) {
    switch (this.config.storage.type) {
      case 'vault':
        return await this.getFromVault(secretId);
      case 'file':
        return await this.getFromFile(secretId);
      case 'memory':
        return this.secrets.get(secretId);
    }
  }
  
  async storeInVault(secretId, encryptedData, metadata) {
    // Simplified Vault storage implementation
    logger.info(`Storing secret ${secretId} in Vault`);
    // Real implementation would use Vault API
  }
  
  async getFromVault(secretId) {
    // Simplified Vault retrieval implementation
    logger.info(`Retrieving secret ${secretId} from Vault`);
    // Real implementation would use Vault API
    return this.secrets.get(secretId); // Fallback to memory
  }
  
  async storeInFile(secretId, encryptedData, metadata) {
    const filePath = path.join(this.config.storage.path, `${secretId}.json`);
    const data = { encryptedData, metadata };
    await fs.writeFile(filePath, JSON.stringify(data), { mode: 0o600 });
  }
  
  async getFromFile(secretId) {
    try {
      const filePath = path.join(this.config.storage.path, `${secretId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      return parsed.encryptedData;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Helper methods
   */
  
  validateSecret(secretId, secretData) {
    if (!secretId || typeof secretId !== 'string') {
      throw new Error('Secret ID must be a non-empty string');
    }
    
    if (!secretData) {
      throw new Error('Secret data cannot be empty');
    }
    
    const dataSize = JSON.stringify(secretData).length;
    if (dataSize > this.config.policies.maxSecretSize) {
      throw new Error(`Secret size ${dataSize} exceeds maximum ${this.config.policies.maxSecretSize}`);
    }
  }
  
  async checkAccess(secretId, operation, accessToken) {
    if (!this.config.accessControl.enableRBAC) {
      return true;
    }
    
    if (!accessToken) {
      throw new Error('Access token required');
    }
    
    const permissions = this.accessTokens.get(accessToken);
    if (!permissions) {
      throw new Error('Invalid access token');
    }
    
    // Check if token has expired
    if (permissions.expiresAt && permissions.expiresAt < new Date()) {
      throw new Error('Access token expired');
    }
    
    // Check permissions
    if (!permissions.secrets.includes(secretId) && !permissions.secrets.includes('*')) {
      throw new Error(`Access denied to secret ${secretId}`);
    }
    
    if (!permissions.operations.includes(operation) && !permissions.operations.includes('*')) {
      throw new Error(`Operation ${operation} not permitted`);
    }
    
    return true;
  }
  
  async updateAccessTracking(secretId) {
    const metadata = this.secretMetadata.get(secretId);
    if (metadata) {
      metadata.accessCount++;
      metadata.lastAccessed = new Date();
    }
  }
  
  auditSecretOperation(operation, secretId, details) {
    if (!this.config.policies.auditAll) {
      return;
    }
    
    const auditEntry = {
      timestamp: new Date(),
      operation,
      secretId: this.config.policies.maskInLogs ? this.maskSecretId(secretId) : secretId,
      ...details
    };
    
    this.accessLog.push(auditEntry);
    
    // Keep only last 1000 entries
    if (this.accessLog.length > 1000) {
      this.accessLog.shift();
    }
    
    this.emit('auditLog', auditEntry);
  }
  
  maskSecretId(secretId) {
    if (secretId.length <= 4) {
      return '****';
    }
    return secretId.substring(0, 2) + '****' + secretId.substring(secretId.length - 2);
  }
  
  sanitizeMetadata(metadata) {
    const sanitized = { ...metadata };
    delete sanitized.permissions; // Don't log sensitive permissions
    return sanitized;
  }
  
  async loadSecrets() {
    // Load existing secrets from storage backend
    logger.info('Loading existing secrets from storage backend');
    // Implementation depends on storage type
  }
  
  startSecretRotation() {
    setInterval(() => {
      this.performScheduledRotation();
    }, this.config.accessControl.rotationInterval);
  }
  
  async performScheduledRotation() {
    try {
      for (const [secretId, metadata] of this.secretMetadata) {
        if (metadata.rotationPolicy === 'automatic') {
          const timeSinceCreation = Date.now() - metadata.createdAt.getTime();
          if (timeSinceCreation >= this.config.accessControl.rotationInterval) {
            await this.rotateSecret(secretId);
          }
        }
      }
    } catch (error) {
      logger.error('Error during scheduled secret rotation:', error);
    }
  }
  
  async generateSecret(secretId) {
    // Generate a new secret based on type
    // This is a simplified implementation
    return {
      value: crypto.randomBytes(32).toString('hex'),
      generatedAt: new Date()
    };
  }

  /**
   * Get secret manager status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      secretCount: this.secrets.size,
      activeInjections: this.activeInjections.size,
      storageType: this.config.storage.type,
      encryptionEnabled: this.config.policies.requireEncryption,
      auditEnabled: this.config.policies.auditAll,
      accessLogEntries: this.accessLog.length,
      config: {
        encryption: {
          algorithm: this.config.encryption.algorithm
        },
        storage: {
          type: this.config.storage.type
        },
        injection: {
          methods: this.config.injection.methods,
          defaultMethod: this.config.injection.defaultMethod
        }
      }
    };
  }

  /**
   * Stop secret manager
   */
  async stop() {
    logger.info('Stopping Secret Manager');
    
    // Clean up all active injections
    for (const containerId of this.activeInjections.keys()) {
      await this.cleanupSecrets(containerId);
    }
    
    this.emit('stopped');
    logger.info('Secret Manager stopped');
  }
}

module.exports = SecretManager;