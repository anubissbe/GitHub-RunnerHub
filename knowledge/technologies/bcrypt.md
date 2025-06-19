# bcrypt - Password Hashing Library

## Overview
bcrypt is a password hashing function designed by Niels Provos and David Mazières, based on the Blowfish cipher. The bcrypt npm package provides a secure way to hash and verify passwords in Node.js applications.

**Official Documentation**: https://github.com/kelektiv/node.bcrypt.js

## Key Concepts and Features

### Core Features
- **Adaptive Hashing**: Configurable work factor (salt rounds)
- **Salt Generation**: Automatic random salt generation
- **Timing Attack Resistance**: Constant-time comparison
- **Future-Proof**: Adjustable computational cost
- **Cross-Platform**: Works on various operating systems
- **Promise Support**: Both callback and promise APIs

### How bcrypt Works
1. **Salt Generation**: Creates random salt
2. **Key Stretching**: Multiple rounds of hashing
3. **Work Factor**: Exponential time complexity (2^rounds)
4. **Output Format**: `$2b$[rounds]$[salt][hash]`

### Security Properties
- Resistant to rainbow table attacks
- Computationally expensive by design
- Increases difficulty as hardware improves
- One-way function (irreversible)

## Common Use Cases

1. **User Authentication**
   - Password storage
   - Login verification
   - Password reset
   - Account creation

2. **API Security**
   - API key hashing
   - Token storage
   - Secret management
   - Session tokens

3. **Data Protection**
   - Sensitive data hashing
   - PII protection
   - Compliance requirements
   - Audit trails

4. **Access Control**
   - Role-based passwords
   - Multi-factor authentication
   - Temporary access codes
   - PIN storage

## Best Practices

### Basic Usage
```javascript
import bcrypt from 'bcrypt';

class PasswordService {
  constructor() {
    // Recommended salt rounds (10-12 for web apps)
    this.saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
  }

  // Hash a password
  async hashPassword(plainPassword) {
    try {
      const hash = await bcrypt.hash(plainPassword, this.saltRounds);
      return hash;
    } catch (error) {
      throw new Error('Password hashing failed');
    }
  }

  // Verify a password
  async verifyPassword(plainPassword, hashedPassword) {
    try {
      const isMatch = await bcrypt.compare(plainPassword, hashedPassword);
      return isMatch;
    } catch (error) {
      // Return false for any error to prevent timing attacks
      return false;
    }
  }

  // Generate salt explicitly (usually not needed)
  async generateSalt() {
    return bcrypt.genSalt(this.saltRounds);
  }

  // Hash with explicit salt (for testing)
  async hashWithSalt(plainPassword, salt) {
    return bcrypt.hash(plainPassword, salt);
  }
}

// Synchronous versions (not recommended for production)
class SyncPasswordService {
  hashPasswordSync(plainPassword) {
    return bcrypt.hashSync(plainPassword, 12);
  }

  verifyPasswordSync(plainPassword, hashedPassword) {
    return bcrypt.compareSync(plainPassword, hashedPassword);
  }
}
```

### Advanced Configuration
```javascript
class SecurePasswordService {
  constructor() {
    // Dynamic salt rounds based on environment
    this.saltRounds = this.calculateSaltRounds();
    this.minPasswordLength = 8;
    this.maxPasswordLength = 128; // bcrypt has 72 byte limit
  }

  calculateSaltRounds() {
    // Adjust based on server capacity and security requirements
    const baseRounds = 12;
    
    if (process.env.NODE_ENV === 'development') {
      return 10; // Faster for development
    }
    
    if (process.env.HIGH_SECURITY === 'true') {
      return 14; // More secure but slower
    }
    
    return baseRounds;
  }

  async hashPassword(plainPassword) {
    // Validate password
    this.validatePassword(plainPassword);
    
    // Pre-hash long passwords to avoid bcrypt's 72-byte limit
    if (plainPassword.length > 72) {
      plainPassword = await this.preHashPassword(plainPassword);
    }
    
    const hash = await bcrypt.hash(plainPassword, this.saltRounds);
    
    // Store metadata with hash
    return {
      hash,
      algorithm: 'bcrypt',
      rounds: this.saltRounds,
      createdAt: new Date().toISOString()
    };
  }

  validatePassword(password) {
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a string');
    }
    
    if (password.length < this.minPasswordLength) {
      throw new Error(`Password must be at least ${this.minPasswordLength} characters`);
    }
    
    if (password.length > this.maxPasswordLength) {
      throw new Error(`Password must not exceed ${this.maxPasswordLength} characters`);
    }
  }

  async preHashPassword(password) {
    // Use SHA256 to handle long passwords
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(password).digest('base64');
  }

  async verifyPassword(plainPassword, passwordData) {
    try {
      // Handle both string hash and object with metadata
      const hash = typeof passwordData === 'string' 
        ? passwordData 
        : passwordData.hash;
      
      // Pre-hash if necessary
      if (plainPassword.length > 72) {
        plainPassword = await this.preHashPassword(plainPassword);
      }
      
      const isValid = await bcrypt.compare(plainPassword, hash);
      
      // Check if rehashing is needed
      if (isValid && typeof passwordData === 'object') {
        const needsRehash = this.needsRehash(passwordData);
        return { isValid, needsRehash };
      }
      
      return { isValid, needsRehash: false };
    } catch (error) {
      logger.error('Password verification error:', error);
      return { isValid: false, needsRehash: false };
    }
  }

  needsRehash(passwordData) {
    // Check if password needs rehashing with updated settings
    if (passwordData.rounds < this.saltRounds) {
      return true;
    }
    
    // Check if hash is too old (e.g., > 1 year)
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    if (new Date(passwordData.createdAt) < oneYearAgo) {
      return true;
    }
    
    return false;
  }
}
```

## Integration Patterns with GitHub RunnerHub Stack

### User Authentication System
```javascript
class UserAuthService {
  constructor(passwordService, db) {
    this.passwordService = passwordService;
    this.db = db;
    this.maxLoginAttempts = 5;
    this.lockoutDuration = 15 * 60 * 1000; // 15 minutes
  }

  async register(userData) {
    const { email, password, ...otherData } = userData;
    
    // Check if user exists
    const existingUser = await this.db.users.findOne({ email });
    if (existingUser) {
      throw new Error('User already exists');
    }
    
    // Validate password strength
    this.validatePasswordStrength(password);
    
    // Hash password
    const hashedPassword = await this.passwordService.hashPassword(password);
    
    // Create user
    const user = await this.db.users.create({
      email,
      password: hashedPassword,
      ...otherData,
      createdAt: new Date(),
      passwordChangedAt: new Date(),
      failedLoginAttempts: 0,
      accountLocked: false
    });
    
    // Log registration
    await this.logAuthEvent('registration', user.id, { email });
    
    return {
      id: user.id,
      email: user.email
    };
  }

  async login(email, password) {
    const user = await this.db.users.findOne({ email });
    
    if (!user) {
      // Prevent timing attacks by still hashing
      await this.passwordService.verifyPassword(password, '$2b$12$dummy.hash.to.prevent.timing.attacks');
      throw new Error('Invalid credentials');
    }
    
    // Check account lockout
    if (user.accountLocked && user.lockedUntil > new Date()) {
      const remainingTime = Math.ceil((user.lockedUntil - new Date()) / 1000 / 60);
      throw new Error(`Account locked. Try again in ${remainingTime} minutes`);
    }
    
    // Verify password
    const isValid = await this.passwordService.verifyPassword(password, user.password);
    
    if (!isValid) {
      await this.handleFailedLogin(user);
      throw new Error('Invalid credentials');
    }
    
    // Reset failed attempts on successful login
    if (user.failedLoginAttempts > 0 || user.accountLocked) {
      await this.db.users.update(user.id, {
        failedLoginAttempts: 0,
        accountLocked: false,
        lockedUntil: null
      });
    }
    
    // Check if password needs rehashing
    const passwordAge = new Date() - new Date(user.passwordChangedAt);
    const threeMonths = 90 * 24 * 60 * 60 * 1000;
    
    if (passwordAge > threeMonths) {
      // Flag for password update reminder
      user.passwordUpdateRecommended = true;
    }
    
    // Log successful login
    await this.logAuthEvent('login', user.id, { email });
    
    return {
      id: user.id,
      email: user.email,
      roles: user.roles,
      passwordUpdateRecommended: user.passwordUpdateRecommended
    };
  }

  async handleFailedLogin(user) {
    const attempts = user.failedLoginAttempts + 1;
    
    const updateData = {
      failedLoginAttempts: attempts,
      lastFailedLogin: new Date()
    };
    
    if (attempts >= this.maxLoginAttempts) {
      updateData.accountLocked = true;
      updateData.lockedUntil = new Date(Date.now() + this.lockoutDuration);
      
      await this.logAuthEvent('account_locked', user.id, {
        reason: 'max_failed_attempts',
        attempts
      });
    }
    
    await this.db.users.update(user.id, updateData);
  }

  async changePassword(userId, currentPassword, newPassword) {
    const user = await this.db.users.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Verify current password
    const isValid = await this.passwordService.verifyPassword(currentPassword, user.password);
    
    if (!isValid) {
      await this.logAuthEvent('password_change_failed', userId, {
        reason: 'invalid_current_password'
      });
      throw new Error('Current password is incorrect');
    }
    
    // Validate new password
    this.validatePasswordStrength(newPassword);
    
    // Check password history
    await this.checkPasswordHistory(userId, newPassword);
    
    // Hash new password
    const hashedPassword = await this.passwordService.hashPassword(newPassword);
    
    // Update password
    await this.db.users.update(userId, {
      password: hashedPassword,
      passwordChangedAt: new Date(),
      passwordUpdateRecommended: false
    });
    
    // Add to password history
    await this.db.passwordHistory.create({
      userId,
      passwordHash: hashedPassword,
      changedAt: new Date()
    });
    
    // Revoke all sessions
    await this.revokeAllSessions(userId);
    
    await this.logAuthEvent('password_changed', userId);
    
    return { success: true };
  }

  async checkPasswordHistory(userId, newPassword) {
    // Get last 5 password hashes
    const history = await this.db.passwordHistory.find({
      userId,
      limit: 5,
      order: { changedAt: 'desc' }
    });
    
    for (const record of history) {
      const isReused = await this.passwordService.verifyPassword(
        newPassword, 
        record.passwordHash
      );
      
      if (isReused) {
        throw new Error('Password has been used recently. Please choose a different password.');
      }
    }
  }

  validatePasswordStrength(password) {
    const minLength = 8;
    const requireUppercase = true;
    const requireLowercase = true;
    const requireNumbers = true;
    const requireSpecialChars = true;
    
    if (password.length < minLength) {
      throw new Error(`Password must be at least ${minLength} characters long`);
    }
    
    if (requireUppercase && !/[A-Z]/.test(password)) {
      throw new Error('Password must contain at least one uppercase letter');
    }
    
    if (requireLowercase && !/[a-z]/.test(password)) {
      throw new Error('Password must contain at least one lowercase letter');
    }
    
    if (requireNumbers && !/\d/.test(password)) {
      throw new Error('Password must contain at least one number');
    }
    
    if (requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      throw new Error('Password must contain at least one special character');
    }
    
    // Check common passwords
    if (this.isCommonPassword(password)) {
      throw new Error('Password is too common. Please choose a more unique password.');
    }
  }

  isCommonPassword(password) {
    const commonPasswords = [
      'password', '123456', 'password123', 'admin', 'letmein',
      'welcome', 'monkey', '1234567890', 'qwerty', 'abc123'
    ];
    
    return commonPasswords.includes(password.toLowerCase());
  }

  async logAuthEvent(event, userId, metadata = {}) {
    await this.db.authLogs.create({
      event,
      userId,
      metadata,
      ip: metadata.ip || 'unknown',
      userAgent: metadata.userAgent || 'unknown',
      timestamp: new Date()
    });
  }
}
```

### API Key Management
```javascript
class ApiKeyService {
  constructor(passwordService, db) {
    this.passwordService = passwordService;
    this.db = db;
  }

  async generateApiKey(userId, name, permissions = []) {
    // Generate secure random key
    const rawKey = this.generateSecureKey();
    
    // Hash the key for storage
    const hashedKey = await this.passwordService.hashPassword(rawKey);
    
    // Store key metadata
    const apiKey = await this.db.apiKeys.create({
      userId,
      name,
      keyHash: hashedKey,
      keyPrefix: rawKey.substring(0, 8), // For identification
      permissions,
      lastUsed: null,
      expiresAt: this.calculateExpiry(),
      createdAt: new Date()
    });
    
    // Return the raw key only once
    return {
      id: apiKey.id,
      key: rawKey,
      name: apiKey.name,
      expiresAt: apiKey.expiresAt
    };
  }

  generateSecureKey() {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('base64url');
  }

  calculateExpiry(days = 365) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    return expiry;
  }

  async validateApiKey(rawKey) {
    // Extract prefix for faster lookup
    const prefix = rawKey.substring(0, 8);
    
    // Find potential matches
    const candidates = await this.db.apiKeys.find({
      keyPrefix: prefix,
      active: true
    });
    
    // Verify against each candidate
    for (const candidate of candidates) {
      const isValid = await this.passwordService.verifyPassword(
        rawKey,
        candidate.keyHash
      );
      
      if (isValid) {
        // Check expiration
        if (candidate.expiresAt && candidate.expiresAt < new Date()) {
          throw new Error('API key has expired');
        }
        
        // Update last used
        await this.db.apiKeys.update(candidate.id, {
          lastUsed: new Date(),
          usageCount: candidate.usageCount + 1
        });
        
        return {
          valid: true,
          userId: candidate.userId,
          permissions: candidate.permissions,
          keyId: candidate.id
        };
      }
    }
    
    // No valid key found
    return { valid: false };
  }

  async rotateApiKey(keyId, userId) {
    const existingKey = await this.db.apiKeys.findOne({
      id: keyId,
      userId,
      active: true
    });
    
    if (!existingKey) {
      throw new Error('API key not found');
    }
    
    // Generate new key
    const newKeyData = await this.generateApiKey(
      userId,
      existingKey.name + ' (rotated)',
      existingKey.permissions
    );
    
    // Deactivate old key
    await this.db.apiKeys.update(keyId, {
      active: false,
      rotatedAt: new Date(),
      rotatedTo: newKeyData.id
    });
    
    return newKeyData;
  }
}
```

### Password Reset Flow
```javascript
class PasswordResetService {
  constructor(passwordService, db, emailService) {
    this.passwordService = passwordService;
    this.db = db;
    this.emailService = emailService;
    this.tokenExpiry = 60 * 60 * 1000; // 1 hour
  }

  async initiatePasswordReset(email) {
    const user = await this.db.users.findOne({ email });
    
    if (!user) {
      // Don't reveal if user exists
      return { message: 'If the email exists, a reset link has been sent' };
    }
    
    // Generate reset token
    const resetToken = this.generateResetToken();
    const hashedToken = await this.passwordService.hashPassword(resetToken);
    
    // Store reset token
    await this.db.passwordResets.create({
      userId: user.id,
      tokenHash: hashedToken,
      expiresAt: new Date(Date.now() + this.tokenExpiry),
      used: false,
      createdAt: new Date()
    });
    
    // Send email
    await this.emailService.sendPasswordReset({
      email: user.email,
      name: user.name,
      resetLink: `https://app.runnerhub.com/reset-password?token=${resetToken}`
    });
    
    return { message: 'If the email exists, a reset link has been sent' };
  }

  generateResetToken() {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  }

  async resetPassword(token, newPassword) {
    // Find valid reset token
    const resets = await this.db.passwordResets.find({
      used: false,
      expiresAt: { $gt: new Date() }
    });
    
    let validReset = null;
    
    for (const reset of resets) {
      const isValid = await this.passwordService.verifyPassword(token, reset.tokenHash);
      if (isValid) {
        validReset = reset;
        break;
      }
    }
    
    if (!validReset) {
      throw new Error('Invalid or expired reset token');
    }
    
    // Get user
    const user = await this.db.users.findById(validReset.userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Validate new password
    this.validatePasswordStrength(newPassword);
    
    // Hash new password
    const hashedPassword = await this.passwordService.hashPassword(newPassword);
    
    // Update password
    await this.db.users.update(user.id, {
      password: hashedPassword,
      passwordChangedAt: new Date()
    });
    
    // Mark token as used
    await this.db.passwordResets.update(validReset.id, {
      used: true,
      usedAt: new Date()
    });
    
    // Revoke all other reset tokens
    await this.db.passwordResets.updateMany(
      { userId: user.id, used: false },
      { used: true, revokedAt: new Date() }
    );
    
    // Send confirmation email
    await this.emailService.sendPasswordResetConfirmation({
      email: user.email,
      name: user.name
    });
    
    return { success: true };
  }
}
```

## GitHub RunnerHub Specific Patterns

### Runner Token Management
```javascript
class RunnerTokenService {
  constructor(passwordService, db) {
    this.passwordService = passwordService;
    this.db = db;
  }

  async generateRunnerToken(runnerId, ownerId) {
    // Generate cryptographically secure token
    const token = this.generateSecureToken();
    
    // Hash for storage
    const tokenHash = await this.passwordService.hashPassword(token);
    
    // Store with metadata
    await this.db.runnerTokens.create({
      runnerId,
      ownerId,
      tokenHash,
      tokenPrefix: token.substring(0, 10),
      createdAt: new Date(),
      lastUsed: null,
      active: true
    });
    
    return {
      token,
      runnerId,
      prefix: token.substring(0, 10)
    };
  }

  generateSecureToken() {
    const crypto = require('crypto');
    // Format: rht_[random]_[checksum]
    const random = crypto.randomBytes(24).toString('base64url');
    const checksum = crypto
      .createHash('sha256')
      .update(random)
      .digest('hex')
      .substring(0, 6);
    
    return `rht_${random}_${checksum}`;
  }

  async validateRunnerToken(token, runnerId) {
    // Extract prefix
    const prefix = token.substring(0, 10);
    
    // Find potential matches
    const candidates = await this.db.runnerTokens.find({
      runnerId,
      tokenPrefix: prefix,
      active: true
    });
    
    for (const candidate of candidates) {
      const isValid = await this.passwordService.verifyPassword(
        token,
        candidate.tokenHash
      );
      
      if (isValid) {
        // Update usage
        await this.db.runnerTokens.update(candidate.id, {
          lastUsed: new Date(),
          usageCount: (candidate.usageCount || 0) + 1
        });
        
        return {
          valid: true,
          ownerId: candidate.ownerId,
          runnerId: candidate.runnerId
        };
      }
    }
    
    return { valid: false };
  }

  async rotateRunnerToken(runnerId, ownerId, oldToken) {
    // Validate old token
    const validation = await this.validateRunnerToken(oldToken, runnerId);
    
    if (!validation.valid || validation.ownerId !== ownerId) {
      throw new Error('Invalid token or unauthorized');
    }
    
    // Generate new token
    const newToken = await this.generateRunnerToken(runnerId, ownerId);
    
    // Deactivate old tokens
    await this.db.runnerTokens.updateMany(
      { runnerId, active: true },
      { active: false, deactivatedAt: new Date() }
    );
    
    return newToken;
  }
}
```

### Performance Optimization
```javascript
class OptimizedPasswordService {
  constructor() {
    this.saltRounds = 12;
    this.hashCache = new Map();
    this.cacheSize = 1000;
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  async hashPassword(password) {
    // Don't cache password hashes for security
    return bcrypt.hash(password, this.saltRounds);
  }

  async verifyPassword(plainPassword, hashedPassword) {
    // Create cache key
    const cacheKey = this.createCacheKey(plainPassword, hashedPassword);
    
    // Check cache
    const cached = this.hashCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.result;
    }
    
    // Perform verification
    const result = await bcrypt.compare(plainPassword, hashedPassword);
    
    // Cache result
    this.cacheResult(cacheKey, result);
    
    return result;
  }

  createCacheKey(plain, hashed) {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(plain + hashed)
      .digest('hex');
  }

  cacheResult(key, result) {
    // Implement LRU cache
    if (this.hashCache.size >= this.cacheSize) {
      const firstKey = this.hashCache.keys().next().value;
      this.hashCache.delete(firstKey);
    }
    
    this.hashCache.set(key, {
      result,
      timestamp: Date.now()
    });
  }

  // Benchmark salt rounds for server
  async benchmarkSaltRounds(targetTime = 250) {
    console.log('Benchmarking bcrypt salt rounds...');
    
    for (let rounds = 10; rounds <= 20; rounds++) {
      const start = Date.now();
      await bcrypt.hash('benchmark_password', rounds);
      const duration = Date.now() - start;
      
      console.log(`Rounds: ${rounds}, Time: ${duration}ms`);
      
      if (duration > targetTime) {
        console.log(`Recommended salt rounds: ${rounds - 1}`);
        return rounds - 1;
      }
    }
    
    return 12; // Default
  }
}
```

### Security Monitoring
```javascript
class PasswordSecurityMonitor {
  constructor(db) {
    this.db = db;
    this.alertThresholds = {
      failedLogins: 10,
      passwordResets: 5,
      suspiciousActivity: 3
    };
  }

  async monitorLoginAttempts(userId, ip) {
    const recentAttempts = await this.db.authLogs.count({
      userId,
      event: 'failed_login',
      timestamp: { $gt: new Date(Date.now() - 3600000) } // Last hour
    });
    
    if (recentAttempts >= this.alertThresholds.failedLogins) {
      await this.triggerSecurityAlert('excessive_failed_logins', {
        userId,
        attempts: recentAttempts,
        ip
      });
    }
  }

  async monitorPasswordResets(email) {
    const recentResets = await this.db.passwordResets.count({
      email,
      createdAt: { $gt: new Date(Date.now() - 86400000) } // Last 24 hours
    });
    
    if (recentResets >= this.alertThresholds.passwordResets) {
      await this.triggerSecurityAlert('excessive_password_resets', {
        email,
        count: recentResets
      });
    }
  }

  async detectPasswordSpray(ip) {
    // Check for multiple failed logins from same IP across different accounts
    const failedLogins = await this.db.authLogs.find({
      event: 'failed_login',
      ip,
      timestamp: { $gt: new Date(Date.now() - 600000) } // Last 10 minutes
    });
    
    const uniqueUsers = new Set(failedLogins.map(log => log.userId)).size;
    
    if (uniqueUsers >= 5) {
      await this.triggerSecurityAlert('password_spray_attack', {
        ip,
        targetedUsers: uniqueUsers,
        attempts: failedLogins.length
      });
      
      // Block IP
      await this.blockIP(ip);
    }
  }

  async triggerSecurityAlert(type, data) {
    await this.db.securityAlerts.create({
      type,
      severity: this.calculateSeverity(type),
      data,
      timestamp: new Date(),
      handled: false
    });
    
    // Send notification
    await this.notifySecurityTeam(type, data);
  }

  calculateSeverity(type) {
    const severityMap = {
      'password_spray_attack': 'critical',
      'excessive_failed_logins': 'high',
      'excessive_password_resets': 'medium'
    };
    
    return severityMap[type] || 'low';
  }
}
```

## Security Considerations

### bcrypt Security Best Practices
```javascript
// 1. Choose appropriate salt rounds
const benchmarkSaltRounds = async () => {
  const testPassword = 'BenchmarkPassword123!';
  
  for (let rounds = 10; rounds <= 15; rounds++) {
    const start = Date.now();
    await bcrypt.hash(testPassword, rounds);
    const time = Date.now() - start;
    
    console.log(`Rounds: ${rounds}, Time: ${time}ms`);
  }
};

// 2. Handle bcrypt limitations
const handleLongPasswords = async (password) => {
  // bcrypt truncates at 72 bytes
  if (Buffer.byteLength(password, 'utf8') > 72) {
    // Pre-hash with SHA-256
    const crypto = require('crypto');
    const preHashed = crypto
      .createHash('sha256')
      .update(password)
      .digest('base64');
    
    return bcrypt.hash(preHashed, 12);
  }
  
  return bcrypt.hash(password, 12);
};

// 3. Implement password policies
const passwordPolicies = {
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  preventCommonPasswords: true,
  preventUserInfo: true,
  preventRepetition: true,
  preventSequences: true
};

// 4. Secure comparison function
const secureCompare = async (plaintext, hash) => {
  try {
    // bcrypt.compare is already timing-safe
    return await bcrypt.compare(plaintext, hash);
  } catch (error) {
    // Log error but don't expose details
    logger.error('Password comparison error:', error);
    return false;
  }
};

// 5. Migration from older algorithms
const migrateFromMD5 = async (user, plainPassword) => {
  const crypto = require('crypto');
  const md5Hash = crypto
    .createHash('md5')
    .update(plainPassword)
    .digest('hex');
  
  if (md5Hash === user.oldPasswordHash) {
    // Valid password, migrate to bcrypt
    const bcryptHash = await bcrypt.hash(plainPassword, 12);
    
    await db.users.update(user.id, {
      password: bcryptHash,
      oldPasswordHash: null,
      hashAlgorithm: 'bcrypt'
    });
    
    return true;
  }
  
  return false;
};
```

### Common Vulnerabilities and Prevention
```javascript
// 1. Prevent timing attacks
const preventTimingAttack = async (email, password) => {
  const user = await db.users.findOne({ email });
  
  if (!user) {
    // Still perform hash comparison to maintain consistent timing
    const dummyHash = '$2b$12$dummyhashtopreventtimingattack';
    await bcrypt.compare(password, dummyHash);
    throw new Error('Invalid credentials');
  }
  
  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    throw new Error('Invalid credentials');
  }
  
  return user;
};

// 2. Prevent DoS through high salt rounds
const validateHashFormat = (hash) => {
  // Ensure hash follows expected format
  const bcryptRegex = /^\$2[aby]\$\d{1,2}\$[./A-Za-z0-9]{53}$/;
  
  if (!bcryptRegex.test(hash)) {
    throw new Error('Invalid hash format');
  }
  
  // Extract and validate salt rounds
  const rounds = parseInt(hash.split('$')[2]);
  
  if (rounds > 15) {
    throw new Error('Excessive salt rounds detected');
  }
  
  return true;
};

// 3. Secure error handling
const secureErrorHandler = (error) => {
  // Don't leak information about valid usernames
  const genericError = 'Authentication failed';
  
  const errorMap = {
    'User not found': genericError,
    'Invalid password': genericError,
    'Account locked': 'Account temporarily locked',
    'Email not verified': 'Please verify your email'
  };
  
  return errorMap[error.message] || genericError;
};
```

## Testing bcrypt Implementation

### Unit Tests
```javascript
import bcrypt from 'bcrypt';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let passwordService;
  
  beforeEach(() => {
    passwordService = new PasswordService();
  });
  
  describe('hashPassword', () => {
    test('should hash password successfully', async () => {
      const password = 'TestPassword123!';
      const hash = await passwordService.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.startsWith('$2b$')).toBe(true);
    });
    
    test('should generate different hashes for same password', async () => {
      const password = 'TestPassword123!';
      const hash1 = await passwordService.hashPassword(password);
      const hash2 = await passwordService.hashPassword(password);
      
      expect(hash1).not.toBe(hash2);
    });
    
    test('should reject invalid passwords', async () => {
      await expect(passwordService.hashPassword('')).rejects.toThrow();
      await expect(passwordService.hashPassword(null)).rejects.toThrow();
      await expect(passwordService.hashPassword(123)).rejects.toThrow();
    });
  });
  
  describe('verifyPassword', () => {
    test('should verify correct password', async () => {
      const password = 'TestPassword123!';
      const hash = await bcrypt.hash(password, 10);
      
      const isValid = await passwordService.verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });
    
    test('should reject incorrect password', async () => {
      const password = 'TestPassword123!';
      const wrongPassword = 'WrongPassword123!';
      const hash = await bcrypt.hash(password, 10);
      
      const isValid = await passwordService.verifyPassword(wrongPassword, hash);
      expect(isValid).toBe(false);
    });
    
    test('should handle invalid hash gracefully', async () => {
      const password = 'TestPassword123!';
      const invalidHash = 'not-a-valid-hash';
      
      const isValid = await passwordService.verifyPassword(password, invalidHash);
      expect(isValid).toBe(false);
    });
  });
});
```

### Performance Tests
```javascript
describe('bcrypt Performance', () => {
  test('should hash within acceptable time', async () => {
    const password = 'TestPassword123!';
    const rounds = 12;
    
    const start = Date.now();
    await bcrypt.hash(password, rounds);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(500); // Should complete within 500ms
  });
  
  test('should verify within acceptable time', async () => {
    const password = 'TestPassword123!';
    const hash = await bcrypt.hash(password, 12);
    
    const start = Date.now();
    await bcrypt.compare(password, hash);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(500); // Should complete within 500ms
  });
  
  test('salt rounds should scale exponentially', async () => {
    const password = 'TestPassword123!';
    const timings = {};
    
    for (let rounds = 10; rounds <= 13; rounds++) {
      const start = Date.now();
      await bcrypt.hash(password, rounds);
      timings[rounds] = Date.now() - start;
    }
    
    // Each increment should roughly double the time
    expect(timings[11]).toBeGreaterThan(timings[10] * 1.5);
    expect(timings[12]).toBeGreaterThan(timings[11] * 1.5);
  });
});
```

## Migration and Compatibility

### Migrating from Other Hash Algorithms
```javascript
class HashMigrationService {
  constructor(passwordService, db) {
    this.passwordService = passwordService;
    this.db = db;
  }

  async migrateUserPassword(userId, plainPassword) {
    const user = await this.db.users.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    let isValid = false;
    
    switch (user.hashAlgorithm) {
      case 'bcrypt':
        // Already using bcrypt
        return { migrated: false };
        
      case 'pbkdf2':
        isValid = await this.verifyPBKDF2(plainPassword, user.password);
        break;
        
      case 'scrypt':
        isValid = await this.verifyScrypt(plainPassword, user.password);
        break;
        
      case 'argon2':
        isValid = await this.verifyArgon2(plainPassword, user.password);
        break;
        
      default:
        throw new Error('Unknown hash algorithm');
    }
    
    if (isValid) {
      // Migrate to bcrypt
      const bcryptHash = await this.passwordService.hashPassword(plainPassword);
      
      await this.db.users.update(userId, {
        password: bcryptHash,
        hashAlgorithm: 'bcrypt',
        migratedAt: new Date()
      });
      
      return { migrated: true };
    }
    
    return { migrated: false, error: 'Invalid password' };
  }

  async verifyPBKDF2(password, hash) {
    const crypto = require('crypto');
    const [salt, iterations, keylen, storedHash] = hash.split(':');
    
    const derivedKey = crypto.pbkdf2Sync(
      password,
      salt,
      parseInt(iterations),
      parseInt(keylen),
      'sha256'
    );
    
    return derivedKey.toString('hex') === storedHash;
  }

  async bulkMigration() {
    const users = await this.db.users.find({
      hashAlgorithm: { $ne: 'bcrypt' }
    });
    
    console.log(`Found ${users.length} users to migrate`);
    
    // Migration will happen on next login
    for (const user of users) {
      await this.db.users.update(user.id, {
        requirePasswordChange: true,
        migrationPending: true
      });
    }
  }
}
```

## Resources
- [bcrypt NPM Package](https://github.com/kelektiv/node.bcrypt.js)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [bcrypt Wikipedia](https://en.wikipedia.org/wiki/Bcrypt)
- [How bcrypt Works](https://auth0.com/blog/hashing-in-action-understanding-bcrypt/)