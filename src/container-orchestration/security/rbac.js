/**
 * Role-Based Access Control (RBAC) System
 * Implements fine-grained access control for GitHub RunnerHub resources
 * with support for roles, permissions, and dynamic policy evaluation
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const logger = require('../../utils/logger');

class RBACSystem extends EventEmitter {
  constructor(auditLogger, options = {}) {
    super();
    
    this.auditLogger = auditLogger;
    
    this.config = {
      // Role hierarchy
      roleHierarchy: {
        admin: ['manager', 'developer', 'viewer'],
        manager: ['developer', 'viewer'],
        developer: ['viewer'],
        viewer: []
      },
      
      // Default roles
      defaultRoles: {
        admin: {
          name: 'Administrator',
          description: 'Full system access',
          permissions: ['*'],
          constraints: {}
        },
        manager: {
          name: 'Manager',
          description: 'Manage runners and workflows',
          permissions: [
            'runners:read',
            'runners:write',
            'runners:delete',
            'workflows:read',
            'workflows:write',
            'jobs:read',
            'jobs:write',
            'reports:read',
            'settings:read'
          ],
          constraints: {
            repositories: 'owned'
          }
        },
        developer: {
          name: 'Developer',
          description: 'Run workflows and view results',
          permissions: [
            'runners:read',
            'workflows:read',
            'workflows:execute',
            'jobs:read',
            'jobs:create',
            'logs:read'
          ],
          constraints: {
            repositories: 'assigned'
          }
        },
        viewer: {
          name: 'Viewer',
          description: 'Read-only access',
          permissions: [
            'runners:read',
            'workflows:read',
            'jobs:read',
            'logs:read',
            'reports:read'
          ],
          constraints: {
            repositories: 'public'
          }
        }
      },
      
      // Permission definitions
      permissions: {
        // Runner permissions
        'runners:read': { resource: 'runner', action: 'read' },
        'runners:write': { resource: 'runner', action: 'write' },
        'runners:delete': { resource: 'runner', action: 'delete' },
        'runners:execute': { resource: 'runner', action: 'execute' },
        
        // Workflow permissions
        'workflows:read': { resource: 'workflow', action: 'read' },
        'workflows:write': { resource: 'workflow', action: 'write' },
        'workflows:delete': { resource: 'workflow', action: 'delete' },
        'workflows:execute': { resource: 'workflow', action: 'execute' },
        
        // Job permissions
        'jobs:read': { resource: 'job', action: 'read' },
        'jobs:create': { resource: 'job', action: 'create' },
        'jobs:write': { resource: 'job', action: 'write' },
        'jobs:delete': { resource: 'job', action: 'delete' },
        'jobs:cancel': { resource: 'job', action: 'cancel' },
        
        // Log permissions
        'logs:read': { resource: 'log', action: 'read' },
        'logs:delete': { resource: 'log', action: 'delete' },
        
        // Settings permissions
        'settings:read': { resource: 'settings', action: 'read' },
        'settings:write': { resource: 'settings', action: 'write' },
        
        // Security permissions
        'security:read': { resource: 'security', action: 'read' },
        'security:write': { resource: 'security', action: 'write' },
        'security:audit': { resource: 'security', action: 'audit' },
        
        // Report permissions
        'reports:read': { resource: 'report', action: 'read' },
        'reports:write': { resource: 'report', action: 'write' },
        'reports:export': { resource: 'report', action: 'export' }
      },
      
      // Policy settings
      policies: {
        denyByDefault: options.denyByDefault !== false,
        requireAuthentication: options.requireAuthentication !== false,
        sessionTimeout: options.sessionTimeout || 3600000, // 1 hour
        maxSessionsPerUser: options.maxSessionsPerUser || 5,
        enforceConstraints: options.enforceConstraints !== false
      },
      
      // Cache settings
      cache: {
        enabled: options.cacheEnabled !== false,
        ttl: options.cacheTTL || 300000, // 5 minutes
        maxSize: options.cacheMaxSize || 1000
      },
      
      ...options
    };
    
    // User and role management
    this.users = new Map(); // userId -> user
    this.roles = new Map(); // roleId -> role
    this.userRoles = new Map(); // userId -> Set<roleId>
    this.sessions = new Map(); // sessionId -> session
    
    // Permission cache
    this.permissionCache = new Map(); // cacheKey -> permissions
    
    // Policy engine
    this.customPolicies = new Map(); // policyId -> policy
    
    // Statistics
    this.stats = {
      authorizationChecks: 0,
      granted: 0,
      denied: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    
    this.isInitialized = false;
  }

  /**
   * Initialize the RBAC system
   */
  async initialize() {
    try {
      logger.info('Initializing RBAC System');
      
      // Load default roles
      this.loadDefaultRoles();
      
      // Load saved users and roles
      await this.loadPersistedData();
      
      // Start session cleanup timer
      this.startSessionCleanup();
      
      this.isInitialized = true;
      this.emit('initialized');
      
      logger.info('RBAC System initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize RBAC System:', error);
      throw error;
    }
  }

  /**
   * Create a new user
   */
  async createUser(userData) {
    try {
      const userId = userData.id || this.generateId('user');
      
      const user = {
        id: userId,
        username: userData.username,
        email: userData.email,
        name: userData.name,
        active: userData.active !== false,
        attributes: userData.attributes || {},
        createdAt: new Date(),
        lastLogin: null
      };
      
      this.users.set(userId, user);
      
      // Audit log
      await this.auditLogger.log({
        category: 'authorization',
        action: 'user_created',
        userId: 'system',
        resourceType: 'user',
        resourceId: userId,
        details: { username: user.username }
      });
      
      this.emit('userCreated', user);
      
      return user;
      
    } catch (error) {
      logger.error('Failed to create user:', error);
      throw error;
    }
  }

  /**
   * Create a new role
   */
  async createRole(roleData) {
    try {
      const roleId = roleData.id || this.generateId('role');
      
      const role = {
        id: roleId,
        name: roleData.name,
        description: roleData.description,
        permissions: roleData.permissions || [],
        constraints: roleData.constraints || {},
        priority: roleData.priority || 0,
        createdAt: new Date()
      };
      
      // Validate permissions
      for (const permission of role.permissions) {
        if (permission !== '*' && !this.config.permissions[permission]) {
          throw new Error(`Invalid permission: ${permission}`);
        }
      }
      
      this.roles.set(roleId, role);
      
      // Clear cache
      this.clearPermissionCache();
      
      // Audit log
      await this.auditLogger.log({
        category: 'authorization',
        action: 'role_created',
        userId: 'system',
        resourceType: 'role',
        resourceId: roleId,
        details: { name: role.name, permissions: role.permissions }
      });
      
      this.emit('roleCreated', role);
      
      return role;
      
    } catch (error) {
      logger.error('Failed to create role:', error);
      throw error;
    }
  }

  /**
   * Assign role to user
   */
  async assignRole(userId, roleId) {
    try {
      const user = this.users.get(userId);
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }
      
      const role = this.roles.get(roleId);
      if (!role) {
        throw new Error(`Role ${roleId} not found`);
      }
      
      // Get or create user roles
      let userRoles = this.userRoles.get(userId);
      if (!userRoles) {
        userRoles = new Set();
        this.userRoles.set(userId, userRoles);
      }
      
      userRoles.add(roleId);
      
      // Clear cache for user
      this.clearUserPermissionCache(userId);
      
      // Audit log
      await this.auditLogger.log({
        category: 'authorization',
        action: 'role_assigned',
        userId: 'system',
        resourceType: 'user_role',
        resourceId: userId,
        details: { roleId, roleName: role.name }
      });
      
      this.emit('roleAssigned', { userId, roleId });
      
      return true;
      
    } catch (error) {
      logger.error('Failed to assign role:', error);
      throw error;
    }
  }

  /**
   * Remove role from user
   */
  async removeRole(userId, roleId) {
    try {
      const userRoles = this.userRoles.get(userId);
      if (!userRoles) {
        return false;
      }
      
      const removed = userRoles.delete(roleId);
      
      if (removed) {
        // Clear cache for user
        this.clearUserPermissionCache(userId);
        
        // Audit log
        await this.auditLogger.log({
          category: 'authorization',
          action: 'role_removed',
          userId: 'system',
          resourceType: 'user_role',
          resourceId: userId,
          details: { roleId }
        });
        
        this.emit('roleRemoved', { userId, roleId });
      }
      
      return removed;
      
    } catch (error) {
      logger.error('Failed to remove role:', error);
      throw error;
    }
  }

  /**
   * Check if user has permission
   */
  async checkPermission(userId, permission, context = {}) {
    try {
      this.stats.authorizationChecks++;
      
      // Check cache first
      const cacheKey = this.getCacheKey(userId, permission, context);
      if (this.config.cache.enabled) {
        const cached = this.permissionCache.get(cacheKey);
        if (cached && cached.expires > Date.now()) {
          this.stats.cacheHits++;
          return cached.allowed;
        }
      }
      
      this.stats.cacheMisses++;
      
      // Get user
      const user = this.users.get(userId);
      if (!user || !user.active) {
        await this.logAuthorizationResult(userId, permission, false, 'User not found or inactive');
        return false;
      }
      
      // Get user permissions
      const userPermissions = await this.getUserPermissions(userId);
      
      // Check permission
      const allowed = await this.evaluatePermission(userPermissions, permission, context, user);
      
      // Cache result
      if (this.config.cache.enabled) {
        this.permissionCache.set(cacheKey, {
          allowed,
          expires: Date.now() + this.config.cache.ttl
        });
        
        // Limit cache size
        if (this.permissionCache.size > this.config.cache.maxSize) {
          const firstKey = this.permissionCache.keys().next().value;
          this.permissionCache.delete(firstKey);
        }
      }
      
      // Update stats
      if (allowed) {
        this.stats.granted++;
      } else {
        this.stats.denied++;
      }
      
      // Audit log
      await this.logAuthorizationResult(userId, permission, allowed, context);
      
      return allowed;
      
    } catch (error) {
      logger.error('Failed to check permission:', error);
      return false;
    }
  }

  /**
   * Get all permissions for a user
   */
  async getUserPermissions(userId) {
    const permissions = new Set();
    const userRoles = this.userRoles.get(userId) || new Set();
    
    // Get permissions from all assigned roles
    for (const roleId of userRoles) {
      const role = this.roles.get(roleId);
      if (role) {
        // Add direct permissions
        for (const permission of role.permissions) {
          permissions.add(permission);
        }
        
        // Add inherited permissions from role hierarchy
        const inheritedRoles = this.getInheritedRoles(roleId);
        for (const inheritedRoleId of inheritedRoles) {
          const inheritedRole = this.roles.get(inheritedRoleId);
          if (inheritedRole) {
            for (const permission of inheritedRole.permissions) {
              permissions.add(permission);
            }
          }
        }
      }
    }
    
    return Array.from(permissions);
  }

  /**
   * Evaluate if permission is allowed
   */
  async evaluatePermission(userPermissions, requiredPermission, context, user) {
    // Check for wildcard permission
    if (userPermissions.includes('*')) {
      return true;
    }
    
    // Check direct permission
    if (userPermissions.includes(requiredPermission)) {
      // Check constraints
      if (this.config.policies.enforceConstraints) {
        return await this.evaluateConstraints(user, requiredPermission, context);
      }
      return true;
    }
    
    // Check wildcard patterns
    for (const userPerm of userPermissions) {
      if (this.matchPermission(userPerm, requiredPermission)) {
        // Check constraints
        if (this.config.policies.enforceConstraints) {
          return await this.evaluateConstraints(user, requiredPermission, context);
        }
        return true;
      }
    }
    
    // Check custom policies
    for (const [policyId, policy] of this.customPolicies) {
      if (policy.effect === 'allow' && await policy.evaluate(user, requiredPermission, context)) {
        return true;
      }
    }
    
    // Default deny
    return false;
  }

  /**
   * Match permission patterns
   */
  matchPermission(pattern, permission) {
    if (pattern === permission) return true;
    
    // Support wildcards (e.g., "runners:*" matches "runners:read")
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -2);
      return permission.startsWith(prefix + ':');
    }
    
    return false;
  }

  /**
   * Evaluate constraints
   */
  async evaluateConstraints(user, permission, context) {
    const userRoles = this.userRoles.get(user.id) || new Set();
    
    for (const roleId of userRoles) {
      const role = this.roles.get(roleId);
      if (!role || !role.constraints) continue;
      
      // Check repository constraints
      if (role.constraints.repositories && context.repository) {
        switch (role.constraints.repositories) {
          case 'owned':
            if (!context.isOwner) return false;
            break;
          case 'assigned':
            if (!context.isAssigned && !context.isOwner) return false;
            break;
          case 'public':
            if (context.isPrivate) return false;
            break;
        }
      }
      
      // Check time constraints
      if (role.constraints.timeRestriction) {
        const now = new Date();
        const { startTime, endTime, timezone } = role.constraints.timeRestriction;
        // Time-based access control logic here
      }
      
      // Check IP constraints
      if (role.constraints.ipWhitelist && context.ipAddress) {
        if (!role.constraints.ipWhitelist.includes(context.ipAddress)) {
          return false;
        }
      }
    }
    
    return true;
  }

  /**
   * Create a session for user
   */
  async createSession(userId, metadata = {}) {
    try {
      const user = this.users.get(userId);
      if (!user || !user.active) {
        throw new Error('User not found or inactive');
      }
      
      // Check session limit
      const userSessions = Array.from(this.sessions.values())
        .filter(s => s.userId === userId && s.active);
      
      if (userSessions.length >= this.config.policies.maxSessionsPerUser) {
        // Expire oldest session
        const oldest = userSessions.sort((a, b) => a.createdAt - b.createdAt)[0];
        await this.expireSession(oldest.id);
      }
      
      const sessionId = this.generateId('session');
      const session = {
        id: sessionId,
        userId,
        createdAt: new Date(),
        lastActivity: new Date(),
        expires: new Date(Date.now() + this.config.policies.sessionTimeout),
        active: true,
        metadata
      };
      
      this.sessions.set(sessionId, session);
      
      // Update user last login
      user.lastLogin = new Date();
      
      // Audit log
      await this.auditLogger.log({
        category: 'authentication',
        action: 'session_created',
        userId,
        sessionId,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent
      });
      
      this.emit('sessionCreated', session);
      
      return session;
      
    } catch (error) {
      logger.error('Failed to create session:', error);
      throw error;
    }
  }

  /**
   * Validate session
   */
  async validateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    
    if (!session || !session.active) {
      return null;
    }
    
    if (session.expires < new Date()) {
      await this.expireSession(sessionId);
      return null;
    }
    
    // Update last activity
    session.lastActivity = new Date();
    
    return session;
  }

  /**
   * Expire session
   */
  async expireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    session.active = false;
    
    // Audit log
    await this.auditLogger.log({
      category: 'authentication',
      action: 'session_expired',
      userId: session.userId,
      sessionId
    });
    
    this.emit('sessionExpired', session);
  }

  /**
   * Add custom policy
   */
  addPolicy(policyId, policy) {
    if (typeof policy.evaluate !== 'function') {
      throw new Error('Policy must have an evaluate function');
    }
    
    this.customPolicies.set(policyId, {
      id: policyId,
      name: policy.name,
      description: policy.description,
      effect: policy.effect || 'allow',
      evaluate: policy.evaluate
    });
    
    // Clear cache
    this.clearPermissionCache();
    
    logger.info(`Added custom policy: ${policyId}`);
  }

  /**
   * Load default roles
   */
  loadDefaultRoles() {
    for (const [roleId, roleData] of Object.entries(this.config.defaultRoles)) {
      this.roles.set(roleId, {
        id: roleId,
        ...roleData,
        createdAt: new Date()
      });
    }
    
    logger.info(`Loaded ${this.roles.size} default roles`);
  }

  /**
   * Load persisted data
   */
  async loadPersistedData() {
    // This would load from database or file
    // For now, create some test data
    
    // Create admin user
    const adminUser = await this.createUser({
      id: 'admin',
      username: 'admin',
      email: 'admin@runnerhub.local',
      name: 'System Administrator'
    });
    
    await this.assignRole(adminUser.id, 'admin');
  }

  /**
   * Get inherited roles from hierarchy
   */
  getInheritedRoles(roleId) {
    const inherited = new Set();
    const hierarchy = this.config.roleHierarchy[roleId];
    
    if (hierarchy) {
      for (const inheritedRole of hierarchy) {
        inherited.add(inheritedRole);
        // Recursively get inherited roles
        const subInherited = this.getInheritedRoles(inheritedRole);
        for (const sub of subInherited) {
          inherited.add(sub);
        }
      }
    }
    
    return Array.from(inherited);
  }

  /**
   * Generate unique ID
   */
  generateId(prefix) {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Get cache key
   */
  getCacheKey(userId, permission, context) {
    return `${userId}:${permission}:${JSON.stringify(context)}`;
  }

  /**
   * Clear permission cache
   */
  clearPermissionCache() {
    this.permissionCache.clear();
  }

  /**
   * Clear user permission cache
   */
  clearUserPermissionCache(userId) {
    for (const key of this.permissionCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.permissionCache.delete(key);
      }
    }
  }

  /**
   * Log authorization result
   */
  async logAuthorizationResult(userId, permission, allowed, context) {
    await this.auditLogger.log({
      category: 'authorization',
      action: 'permission_check',
      result: allowed ? 'granted' : 'denied',
      userId,
      details: {
        permission,
        context: typeof context === 'string' ? { reason: context } : context
      }
    });
  }

  /**
   * Start session cleanup timer
   */
  startSessionCleanup() {
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Every minute
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions() {
    const now = new Date();
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.active && session.expires < now) {
        this.expireSession(sessionId).catch(err => 
          logger.error('Failed to expire session:', err)
        );
      }
    }
  }

  /**
   * Get RBAC statistics
   */
  getStatistics() {
    return {
      users: this.users.size,
      roles: this.roles.size,
      activeSessions: Array.from(this.sessions.values()).filter(s => s.active).length,
      customPolicies: this.customPolicies.size,
      authorizationStats: {
        ...this.stats,
        grantRate: this.stats.authorizationChecks > 0 
          ? (this.stats.granted / this.stats.authorizationChecks * 100).toFixed(2) + '%'
          : '0%',
        cacheHitRate: (this.stats.cacheHits + this.stats.cacheMisses) > 0
          ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) * 100).toFixed(2) + '%'
          : '0%'
      }
    };
  }

  /**
   * Export RBAC configuration
   */
  exportConfiguration() {
    return {
      users: Array.from(this.users.values()),
      roles: Array.from(this.roles.values()),
      userRoles: Array.from(this.userRoles.entries()).map(([userId, roles]) => ({
        userId,
        roles: Array.from(roles)
      })),
      policies: Array.from(this.customPolicies.values()).map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        effect: p.effect
      }))
    };
  }

  /**
   * Stop the RBAC system
   */
  async stop() {
    logger.info('Stopping RBAC System');
    
    // Clear all sessions
    for (const session of this.sessions.values()) {
      if (session.active) {
        await this.expireSession(session.id);
      }
    }
    
    // Clear cache
    this.clearPermissionCache();
    
    this.emit('stopped');
    logger.info('RBAC System stopped');
  }
}

module.exports = RBACSystem;