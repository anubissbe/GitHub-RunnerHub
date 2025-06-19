# dotenv - Environment Variable Management

## Overview
Dotenv is a zero-dependency module that loads environment variables from a `.env` file into `process.env`. It's based on the twelve-factor app methodology and helps keep configuration separate from code.

**Official Documentation**: https://github.com/motdotla/dotenv

## Key Concepts and Features

### Core Features
- **Zero Dependencies**: Lightweight with no external dependencies
- **Early Loading**: Load environment variables at application start
- **Variable Expansion**: Support for variable references
- **Multiline Values**: Support for multiline strings
- **Comment Support**: Comments with # symbol
- **Type Parsing**: Automatic parsing of values

### How dotenv Works
1. Reads `.env` file from project root
2. Parses key-value pairs
3. Assigns to `process.env`
4. Doesn't overwrite existing variables
5. Supports multiple env files

### File Format
```bash
# .env file format
KEY=value
DATABASE_URL=postgresql://user:pass@localhost/db
API_KEY="quoted value with spaces"
MULTILINE="line1\nline2\nline3"
# This is a comment
EMPTY_VALUE=
```

## Common Use Cases

1. **Configuration Management**
   - Database connections
   - API keys and secrets
   - Feature flags
   - Service URLs

2. **Environment Separation**
   - Development settings
   - Testing configuration
   - Production secrets
   - Staging environments

3. **Security**
   - Keep secrets out of code
   - Git-ignored configuration
   - Local overrides
   - CI/CD variables

4. **Application Settings**
   - Port numbers
   - Logging levels
   - Cache settings
   - Timeout values

## Best Practices

### Basic Setup
```javascript
// Load at the very beginning of your application
import dotenv from 'dotenv';

// Basic loading
dotenv.config();

// With options
dotenv.config({
  path: '.env.local',          // Custom path
  encoding: 'utf8',            // File encoding
  debug: true,                 // Log errors
  override: false              // Don't override existing vars
});

// Multiple env files
dotenv.config({ path: '.env.defaults' });
dotenv.config({ path: '.env.local', override: true });

// Conditional loading
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: '.env.development' });
}

// Verify required variables
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'API_KEY'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});
```

### Environment Configuration Class
```javascript
class EnvironmentConfig {
  constructor() {
    this.loadEnvironment();
    this.validateEnvironment();
    this.parseEnvironment();
  }

  loadEnvironment() {
    const env = process.env.NODE_ENV || 'development';
    
    // Load base .env file
    dotenv.config({ path: '.env' });
    
    // Load environment-specific file
    dotenv.config({ 
      path: `.env.${env}`,
      override: true 
    });
    
    // Load local overrides (not committed to git)
    dotenv.config({ 
      path: '.env.local',
      override: true 
    });
  }

  validateEnvironment() {
    const required = {
      // Server
      PORT: { type: 'number', default: 3000 },
      NODE_ENV: { type: 'string', default: 'development' },
      
      // Database
      DATABASE_URL: { type: 'string', required: true },
      DB_POOL_SIZE: { type: 'number', default: 10 },
      
      // Security
      JWT_SECRET: { type: 'string', required: true },
      BCRYPT_ROUNDS: { type: 'number', default: 12 },
      SESSION_SECRET: { type: 'string', required: true },
      
      // API Keys
      GITHUB_TOKEN: { type: 'string', required: true },
      GITHUB_WEBHOOK_SECRET: { type: 'string', required: true },
      
      // Features
      ENABLE_SWAGGER: { type: 'boolean', default: false },
      ENABLE_METRICS: { type: 'boolean', default: false },
      LOG_LEVEL: { type: 'string', default: 'info' }
    };

    const errors = [];
    const config = {};

    for (const [key, options] of Object.entries(required)) {
      const value = process.env[key];
      
      if (!value && options.required) {
        errors.push(`Missing required environment variable: ${key}`);
        continue;
      }
      
      if (!value && options.default !== undefined) {
        config[key] = options.default;
        continue;
      }
      
      // Type conversion
      try {
        config[key] = this.parseValue(value, options.type);
      } catch (error) {
        errors.push(`Invalid ${options.type} for ${key}: ${value}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
    }

    this.config = config;
  }

  parseValue(value, type) {
    switch (type) {
      case 'number':
        const num = Number(value);
        if (isNaN(num)) throw new Error('Not a number');
        return num;
        
      case 'boolean':
        return value === 'true' || value === '1';
        
      case 'array':
        return value.split(',').map(v => v.trim());
        
      case 'json':
        return JSON.parse(value);
        
      default:
        return value;
    }
  }

  parseEnvironment() {
    // Parse complex configurations
    this.config.database = this.parseDatabaseUrl(this.config.DATABASE_URL);
    this.config.redis = this.parseRedisUrl(process.env.REDIS_URL);
    this.config.cors = this.parseCorsOrigins(process.env.CORS_ORIGINS);
  }

  parseDatabaseUrl(url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 5432,
      database: parsed.pathname.slice(1),
      user: parsed.username,
      password: parsed.password,
      ssl: parsed.searchParams.get('ssl') === 'true'
    };
  }

  parseRedisUrl(url) {
    if (!url) return null;
    
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 6379,
      password: parsed.password || undefined,
      db: parseInt(parsed.pathname.slice(1)) || 0
    };
  }

  parseCorsOrigins(origins) {
    if (!origins) return [];
    
    return origins
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean);
  }

  get(key) {
    return this.config[key];
  }

  getAll() {
    return { ...this.config };
  }

  isDevelopment() {
    return this.config.NODE_ENV === 'development';
  }

  isProduction() {
    return this.config.NODE_ENV === 'production';
  }

  isTest() {
    return this.config.NODE_ENV === 'test';
  }
}

// Singleton instance
export const config = new EnvironmentConfig();
```

### Multiple Environment Files
```javascript
class MultiEnvironmentLoader {
  constructor() {
    this.environments = ['defaults', 'development', 'test', 'staging', 'production'];
    this.loadedFiles = [];
  }

  load() {
    const currentEnv = process.env.NODE_ENV || 'development';
    
    // Load in order of precedence
    this.loadFile('.env');                    // Base configuration
    this.loadFile('.env.defaults');           // Default values
    this.loadFile(`.env.${currentEnv}`);     // Environment specific
    this.loadFile('.env.local');             // Local overrides (gitignored)
    this.loadFile(`.env.${currentEnv}.local`); // Local env overrides
    
    this.logLoadedFiles();
    this.validateConfiguration();
  }

  loadFile(filename) {
    try {
      const result = dotenv.config({ 
        path: filename,
        override: false  // Don't override existing values
      });
      
      if (!result.error) {
        this.loadedFiles.push(filename);
        
        if (process.env.DEBUG_ENV === 'true') {
          console.log(`Loaded ${filename}:`, result.parsed);
        }
      }
    } catch (error) {
      // File doesn't exist, skip silently
    }
  }

  logLoadedFiles() {
    if (process.env.LOG_ENV_LOADING === 'true') {
      console.log('Environment files loaded:', this.loadedFiles);
    }
  }

  validateConfiguration() {
    const env = process.env.NODE_ENV;
    
    if (!this.environments.includes(env)) {
      console.warn(`Unknown NODE_ENV: ${env}, defaulting to development`);
      process.env.NODE_ENV = 'development';
    }
  }
}

// Usage
const envLoader = new MultiEnvironmentLoader();
envLoader.load();
```

## Integration Patterns with GitHub RunnerHub Stack

### Application Configuration
```javascript
// config/index.js
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

class ApplicationConfig {
  constructor() {
    this.env = process.env.NODE_ENV || 'development';
    this.isDev = this.env === 'development';
    this.isProd = this.env === 'production';
    this.isTest = this.env === 'test';
    
    this.config = this.buildConfig();
    this.validate();
  }

  buildConfig() {
    return {
      // Server Configuration
      server: {
        port: parseInt(process.env.PORT) || 3000,
        host: process.env.HOST || '0.0.0.0',
        url: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
        corsOrigins: this.parseArray(process.env.CORS_ORIGINS),
        trustProxy: process.env.TRUST_PROXY === 'true',
        bodyLimit: process.env.BODY_LIMIT || '10mb',
        uploadLimit: process.env.UPLOAD_LIMIT || '50mb'
      },

      // Database Configuration
      database: {
        url: process.env.DATABASE_URL,
        poolMin: parseInt(process.env.DB_POOL_MIN) || 2,
        poolMax: parseInt(process.env.DB_POOL_MAX) || 10,
        ssl: process.env.DB_SSL === 'true',
        logging: process.env.DB_LOGGING === 'true',
        synchronize: this.isDev && process.env.DB_SYNC === 'true',
        migrations: process.env.DB_MIGRATIONS === 'true'
      },

      // Redis Configuration
      redis: {
        url: process.env.REDIS_URL,
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB) || 0,
        keyPrefix: process.env.REDIS_PREFIX || 'runnerhub:',
        ttl: parseInt(process.env.REDIS_TTL) || 3600
      },

      // Authentication
      auth: {
        jwtSecret: process.env.JWT_SECRET,
        jwtExpiry: process.env.JWT_EXPIRY || '15m',
        refreshExpiry: process.env.REFRESH_EXPIRY || '7d',
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
        sessionSecret: process.env.SESSION_SECRET,
        cookieDomain: process.env.COOKIE_DOMAIN,
        cookieSecure: this.isProd
      },

      // GitHub Integration
      github: {
        token: process.env.GITHUB_TOKEN,
        appId: process.env.GITHUB_APP_ID,
        privateKey: process.env.GITHUB_PRIVATE_KEY,
        webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET
      },

      // Docker Configuration
      docker: {
        socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
        registry: process.env.DOCKER_REGISTRY,
        username: process.env.DOCKER_USERNAME,
        password: process.env.DOCKER_PASSWORD,
        network: process.env.DOCKER_NETWORK || 'runnerhub'
      },

      // Runner Configuration
      runner: {
        image: process.env.RUNNER_IMAGE || 'ghcr.io/actions/runner:latest',
        maxRunners: parseInt(process.env.MAX_RUNNERS) || 10,
        workDir: process.env.RUNNER_WORK_DIR || '/tmp/runners',
        labels: this.parseArray(process.env.DEFAULT_RUNNER_LABELS),
        cpuLimit: process.env.RUNNER_CPU_LIMIT,
        memoryLimit: process.env.RUNNER_MEMORY_LIMIT,
        timeout: parseInt(process.env.RUNNER_TIMEOUT) || 3600000
      },

      // Logging
      logging: {
        level: process.env.LOG_LEVEL || (this.isDev ? 'debug' : 'info'),
        format: process.env.LOG_FORMAT || 'json',
        colorize: process.env.LOG_COLORIZE === 'true',
        timestamp: process.env.LOG_TIMESTAMP !== 'false',
        filename: process.env.LOG_FILE,
        maxSize: process.env.LOG_MAX_SIZE || '10m',
        maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
      },

      // Features
      features: {
        swagger: process.env.ENABLE_SWAGGER === 'true',
        metrics: process.env.ENABLE_METRICS === 'true',
        healthCheck: process.env.ENABLE_HEALTH_CHECK !== 'false',
        rateLimit: process.env.ENABLE_RATE_LIMIT === 'true',
        compression: process.env.ENABLE_COMPRESSION !== 'false',
        clustering: process.env.ENABLE_CLUSTERING === 'true'
      },

      // External Services
      services: {
        emailHost: process.env.EMAIL_HOST,
        emailPort: parseInt(process.env.EMAIL_PORT) || 587,
        emailUser: process.env.EMAIL_USER,
        emailPass: process.env.EMAIL_PASS,
        emailFrom: process.env.EMAIL_FROM,
        slackWebhook: process.env.SLACK_WEBHOOK_URL,
        sentryDsn: process.env.SENTRY_DSN
      }
    };
  }

  parseArray(value, delimiter = ',') {
    if (!value) return [];
    return value.split(delimiter).map(item => item.trim()).filter(Boolean);
  }

  validate() {
    const required = [
      'DATABASE_URL',
      'JWT_SECRET',
      'SESSION_SECRET',
      'GITHUB_TOKEN'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables:\n${missing.join('\n')}\n\n` +
        `Please check your .env file or environment configuration.`
      );
    }

    // Validate specific formats
    this.validateDatabaseUrl();
    this.validateJwtSecret();
  }

  validateDatabaseUrl() {
    try {
      new URL(this.config.database.url);
    } catch (error) {
      throw new Error(`Invalid DATABASE_URL: ${error.message}`);
    }
  }

  validateJwtSecret() {
    if (this.config.auth.jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long');
    }
  }

  get(path) {
    return path.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  getAll() {
    return { ...this.config };
  }
}

export const appConfig = new ApplicationConfig();
```

### Secrets Management
```javascript
class SecretsManager {
  constructor() {
    this.loadSecrets();
    this.setupRotation();
  }

  loadSecrets() {
    // Load from different sources based on environment
    if (process.env.USE_VAULT === 'true') {
      this.loadFromVault();
    } else if (process.env.USE_AWS_SECRETS === 'true') {
      this.loadFromAWS();
    } else {
      this.loadFromEnvFiles();
    }
  }

  loadFromEnvFiles() {
    // Development: Load from .env files
    dotenv.config({ path: '.env.secrets' });
    dotenv.config({ path: '.env.secrets.local', override: true });
    
    // Validate secrets
    this.validateSecrets();
  }

  async loadFromVault() {
    const vault = require('node-vault')({
      endpoint: process.env.VAULT_ADDR,
      token: process.env.VAULT_TOKEN
    });

    try {
      const secrets = await vault.read('secret/data/runnerhub');
      
      // Inject into process.env
      Object.entries(secrets.data.data).forEach(([key, value]) => {
        process.env[key] = value;
      });
      
      console.log('Secrets loaded from Vault successfully');
    } catch (error) {
      console.error('Failed to load secrets from Vault:', error);
      throw error;
    }
  }

  async loadFromAWS() {
    const AWS = require('aws-sdk');
    const client = new AWS.SecretsManager({
      region: process.env.AWS_REGION
    });

    try {
      const response = await client.getSecretValue({
        SecretId: process.env.AWS_SECRET_NAME
      }).promise();

      const secrets = JSON.parse(response.SecretString);
      
      Object.entries(secrets).forEach(([key, value]) => {
        process.env[key] = value;
      });
      
      console.log('Secrets loaded from AWS Secrets Manager successfully');
    } catch (error) {
      console.error('Failed to load secrets from AWS:', error);
      throw error;
    }
  }

  validateSecrets() {
    const requiredSecrets = [
      'JWT_SECRET',
      'SESSION_SECRET',
      'DATABASE_PASSWORD',
      'GITHUB_PRIVATE_KEY',
      'ENCRYPTION_KEY'
    ];

    const missing = requiredSecrets.filter(secret => !process.env[secret]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required secrets: ${missing.join(', ')}`);
    }

    // Validate secret strength
    if (process.env.JWT_SECRET.length < 64) {
      console.warn('JWT_SECRET should be at least 64 characters for production');
    }
  }

  setupRotation() {
    if (process.env.ENABLE_SECRET_ROTATION === 'true') {
      const rotationInterval = parseInt(process.env.SECRET_ROTATION_DAYS) || 90;
      
      setInterval(() => {
        this.checkSecretRotation();
      }, 24 * 60 * 60 * 1000); // Daily check
    }
  }

  async checkSecretRotation() {
    // Check if secrets need rotation
    const secretsMetadata = await this.getSecretsMetadata();
    
    for (const secret of secretsMetadata) {
      const daysSinceRotation = this.daysSince(secret.lastRotated);
      
      if (daysSinceRotation > 90) {
        console.warn(`Secret ${secret.name} needs rotation (${daysSinceRotation} days old)`);
        // Trigger rotation workflow
      }
    }
  }

  daysSince(date) {
    return Math.floor((Date.now() - new Date(date)) / (1000 * 60 * 60 * 24));
  }
}
```

### Environment-Specific Configuration
```javascript
// config/environments/development.js
export const developmentConfig = {
  // Development-specific overrides
  database: {
    logging: true,
    synchronize: true
  },
  
  logging: {
    level: 'debug',
    colorize: true
  },
  
  features: {
    swagger: true,
    metrics: true
  },
  
  // Development services
  services: {
    mockEmail: true,
    localCache: true
  }
};

// config/environments/production.js
export const productionConfig = {
  // Production-specific settings
  server: {
    trustProxy: true,
    compression: true
  },
  
  database: {
    ssl: true,
    logging: false,
    synchronize: false
  },
  
  auth: {
    cookieSecure: true,
    sessionTimeout: 3600000 // 1 hour
  },
  
  logging: {
    level: 'warn',
    format: 'json'
  },
  
  features: {
    swagger: false,
    rateLimit: true
  }
};

// config/environments/test.js
export const testConfig = {
  // Test-specific configuration
  database: {
    url: 'sqlite::memory:',
    synchronize: true
  },
  
  redis: {
    mock: true
  },
  
  auth: {
    bcryptRounds: 4 // Faster for tests
  },
  
  logging: {
    level: 'error'
  }
};

// Merge configurations
class EnvironmentConfigMerger {
  static merge() {
    const baseConfig = new ApplicationConfig().getAll();
    const env = process.env.NODE_ENV || 'development';
    
    const envConfigs = {
      development: developmentConfig,
      production: productionConfig,
      test: testConfig
    };
    
    const envConfig = envConfigs[env] || {};
    
    return this.deepMerge(baseConfig, envConfig);
  }
  
  static deepMerge(target, source) {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  }
  
  static isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
}
```

## GitHub RunnerHub Specific Patterns

### Dynamic Environment Configuration
```javascript
class DynamicEnvironment {
  constructor() {
    this.watchers = new Map();
    this.callbacks = new Map();
  }

  watch(envFile, callback) {
    const fs = require('fs');
    
    const watcher = fs.watchFile(envFile, { interval: 5000 }, () => {
      console.log(`Environment file ${envFile} changed, reloading...`);
      
      // Reload environment
      const parsed = dotenv.parse(fs.readFileSync(envFile));
      
      // Update process.env
      Object.entries(parsed).forEach(([key, value]) => {
        process.env[key] = value;
      });
      
      // Notify callbacks
      if (callback) callback(parsed);
      
      // Notify all registered callbacks
      this.notifyCallbacks(envFile, parsed);
    });
    
    this.watchers.set(envFile, watcher);
  }

  onChange(pattern, callback) {
    if (!this.callbacks.has(pattern)) {
      this.callbacks.set(pattern, []);
    }
    
    this.callbacks.get(pattern).push(callback);
  }

  notifyCallbacks(envFile, changes) {
    for (const [pattern, callbacks] of this.callbacks) {
      if (this.matchesPattern(envFile, pattern)) {
        callbacks.forEach(cb => cb(changes));
      }
    }
  }

  matchesPattern(file, pattern) {
    if (pattern instanceof RegExp) {
      return pattern.test(file);
    }
    
    return file.includes(pattern);
  }

  stop() {
    for (const [file, watcher] of this.watchers) {
      require('fs').unwatchFile(file);
    }
    
    this.watchers.clear();
    this.callbacks.clear();
  }
}

// Usage
const dynamicEnv = new DynamicEnvironment();

// Watch for changes
dynamicEnv.watch('.env.local', (changes) => {
  console.log('Local environment updated:', changes);
  
  // Restart services if needed
  if (changes.DATABASE_URL) {
    restartDatabaseConnection();
  }
});

// React to specific changes
dynamicEnv.onChange(/\.env/, (changes) => {
  if (changes.LOG_LEVEL) {
    logger.level = changes.LOG_LEVEL;
  }
});
```

### Environment Validation and Type Safety
```javascript
// env.schema.js
import { z } from 'zod';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)),
  
  // Database
  DATABASE_URL: z.string().url(),
  DB_POOL_SIZE: z.string().transform(Number).pipe(z.number().min(1).max(100)).optional(),
  
  // Authentication
  JWT_SECRET: z.string().min(32),
  BCRYPT_ROUNDS: z.string().transform(Number).pipe(z.number().min(10).max(20)),
  
  // GitHub
  GITHUB_TOKEN: z.string().regex(/^gh[ps]_[a-zA-Z0-9]{36}$/),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  
  // Features
  ENABLE_SWAGGER: z.string().transform(v => v === 'true').optional(),
  ENABLE_METRICS: z.string().transform(v => v === 'true').optional(),
  
  // Arrays
  CORS_ORIGINS: z.string().transform(v => v.split(',').map(s => s.trim())),
  RUNNER_LABELS: z.string().transform(v => v.split(',').map(s => s.trim())).optional()
});

class TypedEnvironment {
  constructor() {
    this.loadAndValidate();
  }

  loadAndValidate() {
    // Load environment
    dotenv.config();
    
    try {
      // Validate against schema
      this.env = envSchema.parse(process.env);
      
      console.log('Environment validation successful');
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        );
        
        throw new Error(
          `Environment validation failed:\n${errors.join('\n')}`
        );
      }
      
      throw error;
    }
  }

  get config() {
    return this.env;
  }

  // Type-safe accessors
  get isDevelopment() {
    return this.env.NODE_ENV === 'development';
  }

  get isProduction() {
    return this.env.NODE_ENV === 'production';
  }

  get port() {
    return this.env.PORT;
  }

  get databaseUrl() {
    return this.env.DATABASE_URL;
  }

  get corsOrigins() {
    return this.env.CORS_ORIGINS;
  }
}

// Export typed environment
export const env = new TypedEnvironment().config;
```

### Environment Templates and Examples
```javascript
class EnvironmentTemplateGenerator {
  static generate() {
    const templates = {
      '.env.example': this.generateExample(),
      '.env.test': this.generateTest(),
      'docker.env': this.generateDocker()
    };

    const fs = require('fs');
    
    Object.entries(templates).forEach(([filename, content]) => {
      fs.writeFileSync(filename, content);
      console.log(`Generated ${filename}`);
    });
  }

  static generateExample() {
    return `# GitHub RunnerHub Environment Configuration
# Copy this file to .env and update with your values

# Server Configuration
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
APP_URL=http://localhost:3000

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/runnerhub
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_SSL=false
DB_LOGGING=true

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=runnerhub:

# Authentication
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters
JWT_EXPIRY=15m
REFRESH_EXPIRY=7d
BCRYPT_ROUNDS=12
SESSION_SECRET=your-session-secret-key

# GitHub Integration
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\n...\\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_CLIENT_ID=xxxxxxxxxxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Docker Configuration
DOCKER_SOCKET=/var/run/docker.sock
DOCKER_REGISTRY=ghcr.io
DOCKER_USERNAME=your-username
DOCKER_PASSWORD=your-password

# Runner Configuration
RUNNER_IMAGE=ghcr.io/actions/runner:latest
MAX_RUNNERS=10
RUNNER_WORK_DIR=/tmp/runners
DEFAULT_RUNNER_LABELS=self-hosted,linux,x64
RUNNER_CPU_LIMIT=2
RUNNER_MEMORY_LIMIT=4g

# Logging
LOG_LEVEL=debug
LOG_FORMAT=pretty
LOG_COLORIZE=true

# Features
ENABLE_SWAGGER=true
ENABLE_METRICS=true
ENABLE_RATE_LIMIT=false

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# Email Configuration (optional)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=noreply@runnerhub.com
`;
  }

  static generateTest() {
    return `# Test Environment Configuration
NODE_ENV=test
PORT=3001
DATABASE_URL=sqlite::memory:
JWT_SECRET=test-jwt-secret-for-testing-only-not-for-production
BCRYPT_ROUNDS=4
LOG_LEVEL=error
ENABLE_SWAGGER=false
`;
  }

  static generateDocker() {
    return `# Docker Environment Configuration
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@db:5432/runnerhub
REDIS_URL=redis://redis:6379
DOCKER_SOCKET=/var/run/docker.sock
`;
  }
}

// Generate templates
EnvironmentTemplateGenerator.generate();
```

## Security Considerations

### Secure Environment Handling
```javascript
class SecureEnvironment {
  constructor() {
    this.sensitiveKeys = [
      'PASSWORD',
      'SECRET',
      'KEY',
      'TOKEN',
      'PRIVATE'
    ];
  }

  loadSecurely() {
    // Ensure .env file has proper permissions
    this.checkFilePermissions('.env');
    
    // Load environment
    dotenv.config();
    
    // Validate sensitive values
    this.validateSensitiveValues();
    
    // Prevent logging sensitive values
    this.setupSecureLogging();
  }

  checkFilePermissions(file) {
    const fs = require('fs');
    const stats = fs.statSync(file);
    const mode = (stats.mode & parseInt('777', 8)).toString(8);
    
    if (mode !== '600' && mode !== '400') {
      console.warn(
        `Warning: ${file} has permissions ${mode}. ` +
        `Consider using 600 or 400 for better security.`
      );
    }
  }

  validateSensitiveValues() {
    for (const [key, value] of Object.entries(process.env)) {
      if (this.isSensitive(key)) {
        // Check for common insecure values
        if (this.isInsecureValue(value)) {
          console.warn(`Warning: ${key} appears to have an insecure value`);
        }
        
        // Check for default values
        if (this.isDefaultValue(value)) {
          console.warn(`Warning: ${key} is using a default value`);
        }
      }
    }
  }

  isSensitive(key) {
    return this.sensitiveKeys.some(pattern => 
      key.toUpperCase().includes(pattern)
    );
  }

  isInsecureValue(value) {
    const insecurePatterns = [
      'password',
      'secret',
      '123456',
      'admin',
      'default',
      'changeme'
    ];
    
    return insecurePatterns.some(pattern => 
      value.toLowerCase().includes(pattern)
    );
  }

  isDefaultValue(value) {
    return value.includes('your-') || 
           value.includes('xxxx') || 
           value.includes('example');
  }

  setupSecureLogging() {
    // Override console methods to prevent logging secrets
    const originalLog = console.log;
    const originalError = console.error;
    
    const sanitize = (args) => {
      return args.map(arg => {
        if (typeof arg === 'object') {
          return this.sanitizeObject(arg);
        }
        
        if (typeof arg === 'string') {
          return this.sanitizeString(arg);
        }
        
        return arg;
      });
    };
    
    console.log = (...args) => {
      originalLog.apply(console, sanitize(args));
    };
    
    console.error = (...args) => {
      originalError.apply(console, sanitize(args));
    };
  }

  sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const sanitized = Array.isArray(obj) ? [] : {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (this.isSensitive(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  sanitizeString(str) {
    // Redact JWT tokens
    str = str.replace(/Bearer\s+[\w-]+\.[\w-]+\.[\w-]+/g, 'Bearer [REDACTED]');
    
    // Redact API keys
    str = str.replace(/([a-zA-Z0-9]{32,})/g, (match) => {
      if (match.length > 32) {
        return '[REDACTED]';
      }
      return match;
    });
    
    return str;
  }

  // Get value with fallback
  get(key, defaultValue = undefined) {
    const value = process.env[key];
    
    if (value === undefined && defaultValue === undefined) {
      throw new Error(`Environment variable ${key} is not defined`);
    }
    
    return value || defaultValue;
  }

  // Get sensitive value (never log)
  getSensitive(key) {
    const value = process.env[key];
    
    if (!value) {
      throw new Error(`Sensitive environment variable ${key} is not defined`);
    }
    
    // Mark as sensitive to prevent logging
    Object.defineProperty(value, '_sensitive', {
      value: true,
      writable: false,
      enumerable: false
    });
    
    return value;
  }
}
```

### Environment Encryption
```javascript
class EncryptedEnvironment {
  constructor() {
    this.crypto = require('crypto');
    this.algorithm = 'aes-256-gcm';
  }

  async encryptEnvFile(inputFile, outputFile, password) {
    const fs = require('fs').promises;
    
    // Read env file
    const content = await fs.readFile(inputFile, 'utf8');
    
    // Generate key from password
    const key = this.crypto.pbkdf2Sync(password, 'salt', 100000, 32, 'sha256');
    
    // Encrypt
    const iv = this.crypto.randomBytes(16);
    const cipher = this.crypto.createCipheriv(this.algorithm, key, iv);
    
    let encrypted = cipher.update(content, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Save encrypted file
    const output = {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      encrypted
    };
    
    await fs.writeFile(outputFile, JSON.stringify(output, null, 2));
    console.log(`Encrypted ${inputFile} to ${outputFile}`);
  }

  async decryptAndLoad(encryptedFile, password) {
    const fs = require('fs').promises;
    
    // Read encrypted file
    const data = JSON.parse(await fs.readFile(encryptedFile, 'utf8'));
    
    // Generate key from password
    const key = this.crypto.pbkdf2Sync(password, 'salt', 100000, 32, 'sha256');
    
    // Decrypt
    const decipher = this.crypto.createDecipheriv(
      this.algorithm,
      key,
      Buffer.from(data.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));
    
    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    // Parse and load into process.env
    const parsed = dotenv.parse(decrypted);
    
    Object.entries(parsed).forEach(([key, value]) => {
      process.env[key] = value;
    });
    
    console.log('Encrypted environment loaded successfully');
  }
}

// Usage
const encEnv = new EncryptedEnvironment();

// Encrypt .env file
if (process.argv[2] === 'encrypt') {
  const password = process.env.ENV_PASSWORD || 'changeme';
  encEnv.encryptEnvFile('.env', '.env.enc', password);
}

// Load encrypted environment
if (process.env.USE_ENCRYPTED_ENV === 'true') {
  const password = process.env.ENV_PASSWORD;
  if (!password) {
    throw new Error('ENV_PASSWORD required for encrypted environment');
  }
  
  encEnv.decryptAndLoad('.env.enc', password);
}
```

## Testing with dotenv

### Mock Environment for Tests
```javascript
// test/helpers/environment.js
class TestEnvironment {
  constructor() {
    this.originalEnv = { ...process.env };
  }

  setup(overrides = {}) {
    // Clear existing environment
    Object.keys(process.env).forEach(key => {
      delete process.env[key];
    });
    
    // Set test defaults
    const testDefaults = {
      NODE_ENV: 'test',
      PORT: '3001',
      DATABASE_URL: 'sqlite::memory:',
      JWT_SECRET: 'test-secret',
      BCRYPT_ROUNDS: '4',
      LOG_LEVEL: 'error'
    };
    
    // Apply defaults and overrides
    Object.assign(process.env, testDefaults, overrides);
  }

  restore() {
    // Clear test environment
    Object.keys(process.env).forEach(key => {
      delete process.env[key];
    });
    
    // Restore original
    Object.assign(process.env, this.originalEnv);
  }

  with(overrides, callback) {
    const original = { ...process.env };
    
    try {
      Object.assign(process.env, overrides);
      return callback();
    } finally {
      // Restore
      Object.keys(overrides).forEach(key => {
        if (original[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = original[key];
        }
      });
    }
  }
}

// Usage in tests
describe('Configuration', () => {
  const testEnv = new TestEnvironment();
  
  beforeEach(() => {
    testEnv.setup();
  });
  
  afterEach(() => {
    testEnv.restore();
  });
  
  test('should load configuration', () => {
    const config = new ApplicationConfig();
    expect(config.get('server.port')).toBe(3001);
    expect(config.isDevelopment()).toBe(false);
    expect(config.isTest()).toBe(true);
  });
  
  test('should handle missing required variables', () => {
    testEnv.with({ JWT_SECRET: undefined }, () => {
      expect(() => new ApplicationConfig()).toThrow('Missing required environment variables');
    });
  });
});
```

### Environment File Testing
```javascript
import { parse } from 'dotenv';
import fs from 'fs';

describe('Environment Files', () => {
  test('.env.example should have all required variables', () => {
    const example = parse(fs.readFileSync('.env.example'));
    const required = [
      'DATABASE_URL',
      'JWT_SECRET',
      'GITHUB_TOKEN',
      'SESSION_SECRET'
    ];
    
    required.forEach(key => {
      expect(example).toHaveProperty(key);
      expect(example[key]).not.toBe('');
    });
  });
  
  test('should not contain real secrets in .env.example', () => {
    const example = parse(fs.readFileSync('.env.example'));
    
    Object.entries(example).forEach(([key, value]) => {
      if (key.includes('SECRET') || key.includes('TOKEN')) {
        expect(value).toMatch(/^(your-|xxxx|example)/);
      }
    });
  });
  
  test('all .env files should have proper format', () => {
    const envFiles = ['.env.example', '.env.test'];
    
    envFiles.forEach(file => {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          if (line.trim() && !line.startsWith('#')) {
            expect(line).toMatch(/^[A-Z_]+=/);
          }
        });
      }
    });
  });
});
```

## Debugging and Troubleshooting

### Debug Utilities
```javascript
class EnvironmentDebugger {
  static debug() {
    console.log('=== Environment Debug Info ===');
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`Working Directory: ${process.cwd()}`);
    console.log('\nLoaded Files:');
    
    const files = ['.env', '.env.local', `.env.${process.env.NODE_ENV}`];
    files.forEach(file => {
      if (require('fs').existsSync(file)) {
        console.log(`  ✓ ${file}`);
      } else {
        console.log(`  ✗ ${file} (not found)`);
      }
    });
    
    console.log('\nEnvironment Variables:');
    const env = { ...process.env };
    
    // Sort and display
    Object.keys(env).sort().forEach(key => {
      const value = this.isSensitive(key) ? '[REDACTED]' : env[key];
      console.log(`  ${key}=${value}`);
    });
  }

  static isSensitive(key) {
    const patterns = ['SECRET', 'PASSWORD', 'TOKEN', 'KEY'];
    return patterns.some(p => key.toUpperCase().includes(p));
  }

  static validate() {
    const issues = [];
    
    // Check for common issues
    if (!process.env.NODE_ENV) {
      issues.push('NODE_ENV is not set');
    }
    
    // Check for development values in production
    if (process.env.NODE_ENV === 'production') {
      Object.entries(process.env).forEach(([key, value]) => {
        if (value.includes('localhost') || value.includes('127.0.0.1')) {
          issues.push(`${key} contains localhost reference`);
        }
        
        if (value.toLowerCase().includes('debug')) {
          issues.push(`${key} contains debug reference`);
        }
      });
    }
    
    return issues;
  }
}

// Run debug if requested
if (process.env.DEBUG_ENV === 'true') {
  EnvironmentDebugger.debug();
}
```

## Resources
- [dotenv NPM Package](https://github.com/motdotla/dotenv)
- [The Twelve-Factor App](https://12factor.net/config)
- [dotenv-expand](https://github.com/motdotla/dotenv-expand)
- [dotenv CLI](https://github.com/entropitor/dotenv-cli)