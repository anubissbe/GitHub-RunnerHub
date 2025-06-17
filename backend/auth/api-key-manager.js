const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// In production, use a database. This uses file storage for simplicity
const API_KEYS_FILE = path.join(__dirname, '../../data/api-keys.json');

class APIKeyManager {
  constructor() {
    this.keys = new Map();
    this.keyMetadata = new Map();
    this.initializeStorage();
  }

  async initializeStorage() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(API_KEYS_FILE);
      await fs.mkdir(dataDir, { recursive: true });

      // Load existing keys
      try {
        const data = await fs.readFile(API_KEYS_FILE, 'utf8');
        const stored = JSON.parse(data);
        
        stored.forEach(item => {
          this.keys.set(item.key, item.hashedKey);
          this.keyMetadata.set(item.key, {
            id: item.id,
            name: item.name,
            scopes: item.scopes,
            createdAt: new Date(item.createdAt),
            lastUsed: item.lastUsed ? new Date(item.lastUsed) : null,
            expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
            active: item.active
          });
        });
      } catch (error) {
        // File doesn't exist yet, start with empty
        console.log('No existing API keys found, starting fresh');
      }
    } catch (error) {
      console.error('Error initializing API key storage:', error);
    }
  }

  async saveKeys() {
    try {
      const data = Array.from(this.keys.entries()).map(([key, hashedKey]) => {
        const metadata = this.keyMetadata.get(key);
        return {
          id: metadata.id,
          key: key.substring(0, 8) + '...',  // Store only prefix for identification
          hashedKey,
          name: metadata.name,
          scopes: metadata.scopes,
          createdAt: metadata.createdAt,
          lastUsed: metadata.lastUsed,
          expiresAt: metadata.expiresAt,
          active: metadata.active
        };
      });

      await fs.writeFile(API_KEYS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving API keys:', error);
    }
  }

  generateAPIKey(prefix = 'rh') {
    // Format: rh_live_32randomcharacters or rh_test_32randomcharacters
    const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
    const randomBytes = crypto.randomBytes(24).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    return `${prefix}_${env}_${randomBytes}`;
  }

  hashAPIKey(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  async createAPIKey(options = {}) {
    const {
      name = 'Unnamed Key',
      scopes = ['read'],
      expiresIn = null, // null means no expiration
      userId = null
    } = options;

    const apiKey = this.generateAPIKey();
    const hashedKey = this.hashAPIKey(apiKey);
    const keyId = crypto.randomUUID();

    const metadata = {
      id: keyId,
      name,
      scopes,
      userId,
      createdAt: new Date(),
      lastUsed: null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn) : null,
      active: true
    };

    this.keys.set(apiKey, hashedKey);
    this.keyMetadata.set(apiKey, metadata);

    await this.saveKeys();

    return {
      id: keyId,
      key: apiKey,
      name,
      scopes,
      createdAt: metadata.createdAt,
      expiresAt: metadata.expiresAt
    };
  }

  async validateAPIKey(apiKey) {
    if (!apiKey || !apiKey.startsWith('rh_')) {
      return { valid: false, error: 'Invalid API key format' };
    }

    const hashedKey = this.hashAPIKey(apiKey);
    
    // Find the key by comparing hashes
    let foundKey = null;
    for (const [key, hash] of this.keys.entries()) {
      if (hash === hashedKey || key === apiKey) {
        foundKey = key;
        break;
      }
    }

    if (!foundKey) {
      return { valid: false, error: 'API key not found' };
    }

    const metadata = this.keyMetadata.get(foundKey);
    
    if (!metadata) {
      return { valid: false, error: 'API key metadata not found' };
    }

    // Check if key is active
    if (!metadata.active) {
      return { valid: false, error: 'API key is inactive' };
    }

    // Check expiration
    if (metadata.expiresAt && metadata.expiresAt < new Date()) {
      return { valid: false, error: 'API key has expired' };
    }

    // Update last used
    metadata.lastUsed = new Date();
    await this.saveKeys();

    return {
      valid: true,
      keyId: metadata.id,
      scopes: metadata.scopes,
      userId: metadata.userId,
      name: metadata.name
    };
  }

  async revokeAPIKey(keyId) {
    // Find key by ID
    let targetKey = null;
    for (const [key, metadata] of this.keyMetadata.entries()) {
      if (metadata.id === keyId) {
        targetKey = key;
        break;
      }
    }

    if (!targetKey) {
      throw new Error('API key not found');
    }

    const metadata = this.keyMetadata.get(targetKey);
    metadata.active = false;
    
    await this.saveKeys();

    return { success: true, keyId };
  }

  async listAPIKeys(userId = null) {
    const keys = [];
    
    for (const [key, metadata] of this.keyMetadata.entries()) {
      if (userId && metadata.userId !== userId) {
        continue;
      }

      keys.push({
        id: metadata.id,
        name: metadata.name,
        prefix: key.substring(0, 12) + '...',
        scopes: metadata.scopes,
        createdAt: metadata.createdAt,
        lastUsed: metadata.lastUsed,
        expiresAt: metadata.expiresAt,
        active: metadata.active
      });
    }

    return keys.sort((a, b) => b.createdAt - a.createdAt);
  }

  async rotateAPIKey(keyId) {
    // Find existing key
    let oldKey = null;
    let oldMetadata = null;
    
    for (const [key, metadata] of this.keyMetadata.entries()) {
      if (metadata.id === keyId) {
        oldKey = key;
        oldMetadata = metadata;
        break;
      }
    }

    if (!oldKey) {
      throw new Error('API key not found');
    }

    // Create new key with same metadata
    const newKey = await this.createAPIKey({
      name: oldMetadata.name + ' (Rotated)',
      scopes: oldMetadata.scopes,
      userId: oldMetadata.userId,
      expiresIn: oldMetadata.expiresAt ? 
        oldMetadata.expiresAt.getTime() - Date.now() : null
    });

    // Revoke old key
    await this.revokeAPIKey(keyId);

    return newKey;
  }

  // Middleware for Express
  middleware(options = {}) {
    const { scopes = [], optional = false } = options;

    return async (req, res, next) => {
      // Check for API key in headers
      const apiKey = req.headers['x-api-key'] || 
                     req.headers['authorization']?.replace('Bearer ', '');

      if (!apiKey) {
        if (optional) {
          return next();
        }
        return res.status(401).json({ error: 'API key required' });
      }

      try {
        const validation = await this.validateAPIKey(apiKey);
        
        if (!validation.valid) {
          return res.status(401).json({ error: validation.error });
        }

        // Check required scopes
        if (scopes.length > 0) {
          const hasRequiredScopes = scopes.every(scope => 
            validation.scopes.includes(scope)
          );
          
          if (!hasRequiredScopes) {
            return res.status(403).json({ 
              error: 'Insufficient permissions',
              required: scopes,
              provided: validation.scopes
            });
          }
        }

        // Attach key info to request
        req.apiKey = {
          id: validation.keyId,
          scopes: validation.scopes,
          userId: validation.userId,
          name: validation.name
        };

        next();
      } catch (error) {
        res.status(500).json({ error: 'Error validating API key' });
      }
    };
  }
}

// API Key management endpoints
function setupAPIKeyEndpoints(app, jwtAuth) {
  const apiKeyManager = new APIKeyManager();

  // Create new API key (requires JWT auth)
  app.post('/api/keys', jwtAuth.middleware(), async (req, res) => {
    try {
      const { name, scopes, expiresIn } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Key name is required' });
      }

      const apiKey = await apiKeyManager.createAPIKey({
        name,
        scopes: scopes || ['read'],
        expiresIn: expiresIn || null,
        userId: req.user.id || req.user.userId
      });

      res.json({
        message: 'API key created successfully',
        apiKey
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // List API keys (requires JWT auth)
  app.get('/api/keys', jwtAuth.middleware(), async (req, res) => {
    try {
      const keys = await apiKeyManager.listAPIKeys(
        req.user.role === 'admin' ? null : req.user.id
      );
      res.json({ keys });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Revoke API key (requires JWT auth)
  app.delete('/api/keys/:keyId', jwtAuth.middleware(), async (req, res) => {
    try {
      const { keyId } = req.params;
      
      // Verify ownership unless admin
      if (req.user.role !== 'admin') {
        const keys = await apiKeyManager.listAPIKeys(req.user.id);
        const ownsKey = keys.some(k => k.id === keyId);
        
        if (!ownsKey) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      await apiKeyManager.revokeAPIKey(keyId);
      res.json({ message: 'API key revoked successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rotate API key (requires JWT auth)
  app.post('/api/keys/:keyId/rotate', jwtAuth.middleware(), async (req, res) => {
    try {
      const { keyId } = req.params;
      
      // Verify ownership unless admin
      if (req.user.role !== 'admin') {
        const keys = await apiKeyManager.listAPIKeys(req.user.id);
        const ownsKey = keys.some(k => k.id === keyId);
        
        if (!ownsKey) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const newKey = await apiKeyManager.rotateAPIKey(keyId);
      res.json({
        message: 'API key rotated successfully',
        apiKey: newKey
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return apiKeyManager;
}

module.exports = {
  APIKeyManager,
  setupAPIKeyEndpoints
};