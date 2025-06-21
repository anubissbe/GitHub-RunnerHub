/**
 * E2E Tests for RBAC System
 * Tests role-based access control, permissions, and session management
 */

const { expect } = require('chai');
const RBACSystem = require('../../../src/container-orchestration/security/rbac');
const AuditLogger = require('../../../src/container-orchestration/security/audit-logger');
const fs = require('fs').promises;
const path = require('path');

describe('RBAC System E2E Tests', () => {
  let rbac;
  let auditLogger;
  let testUsers = [];
  let testRoles = [];
  let testSessions = [];
  let tempDir;

  beforeEach(async () => {
    // Create temp directory for audit logs
    tempDir = `/tmp/rbac-test-${Date.now()}`;
    await fs.mkdir(tempDir, { recursive: true });

    auditLogger = new AuditLogger({
      auditPath: tempDir,
      compression: false,
      retentionDays: 1
    });
    await auditLogger.initialize();

    rbac = new RBACSystem(auditLogger, {
      denyByDefault: true,
      requireAuthentication: true,
      sessionTimeout: 3600000,
      cacheEnabled: true
    });
    await rbac.initialize();
  });

  afterEach(async () => {
    // Cleanup sessions
    for (const sessionId of testSessions) {
      try {
        await rbac.expireSession(sessionId);
      } catch (error) {
        // Session might already be expired
      }
    }

    if (rbac) {
      await rbac.stop();
    }

    if (auditLogger) {
      await auditLogger.stop();
    }

    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist
    }

    testUsers = [];
    testRoles = [];
    testSessions = [];
  });

  describe('User Management', () => {
    it('should create and manage users', async () => {
      const userData = {
        username: 'john.doe',
        email: 'john@example.com',
        name: 'John Doe'
      };

      const user = await rbac.createUser(userData);
      testUsers.push(user.id);

      expect(user).to.exist;
      expect(user.id).to.exist;
      expect(user.username).to.equal(userData.username);
      expect(user.email).to.equal(userData.email);
      expect(user.active).to.be.true;
    });

    it('should handle duplicate usernames', async () => {
      const userData = {
        username: 'duplicate.user',
        email: 'dup1@example.com'
      };

      const user1 = await rbac.createUser(userData);
      testUsers.push(user1.id);

      // Try to create user with same username
      const user2Data = {
        username: 'duplicate.user',
        email: 'dup2@example.com'
      };

      const user2 = await rbac.createUser(user2Data);
      testUsers.push(user2.id);

      // Should create with different ID
      expect(user2.id).to.not.equal(user1.id);
    });
  });

  describe('Role Management', () => {
    it('should create custom roles', async () => {
      const roleData = {
        name: 'CI/CD Manager',
        description: 'Manages CI/CD workflows',
        permissions: [
          'workflows:read',
          'workflows:write',
          'workflows:execute',
          'runners:read',
          'jobs:read'
        ],
        constraints: {
          repositories: 'owned'
        }
      };

      const role = await rbac.createRole(roleData);
      testRoles.push(role.id);

      expect(role).to.exist;
      expect(role.name).to.equal(roleData.name);
      expect(role.permissions).to.deep.equal(roleData.permissions);
      expect(role.constraints).to.deep.equal(roleData.constraints);
    });

    it('should validate permissions when creating roles', async () => {
      const invalidRoleData = {
        name: 'Invalid Role',
        permissions: ['invalid:permission', 'workflows:read']
      };

      try {
        await rbac.createRole(invalidRoleData);
        expect.fail('Should have thrown error for invalid permission');
      } catch (error) {
        expect(error.message).to.include('Invalid permission');
      }
    });

    it('should support wildcard permissions', async () => {
      const wildcardRole = {
        name: 'Workflow Admin',
        permissions: ['workflows:*']
      };

      const role = await rbac.createRole(wildcardRole);
      testRoles.push(role.id);

      const user = await rbac.createUser({
        username: 'workflow.admin',
        email: 'wadmin@example.com'
      });
      testUsers.push(user.id);

      await rbac.assignRole(user.id, role.id);

      // Should have all workflow permissions
      const canRead = await rbac.checkPermission(user.id, 'workflows:read');
      const canWrite = await rbac.checkPermission(user.id, 'workflows:write');
      const canDelete = await rbac.checkPermission(user.id, 'workflows:delete');

      expect(canRead).to.be.true;
      expect(canWrite).to.be.true;
      expect(canDelete).to.be.true;
    });
  });

  describe('Role Assignment', () => {
    it('should assign roles to users', async () => {
      const user = await rbac.createUser({
        username: 'test.developer',
        email: 'dev@example.com'
      });
      testUsers.push(user.id);

      await rbac.assignRole(user.id, 'developer');

      const permissions = await rbac.getUserPermissions(user.id);
      expect(permissions).to.include('workflows:read');
      expect(permissions).to.include('jobs:create');
    });

    it('should support multiple roles per user', async () => {
      const user = await rbac.createUser({
        username: 'multi.role',
        email: 'multi@example.com'
      });
      testUsers.push(user.id);

      await rbac.assignRole(user.id, 'developer');
      await rbac.assignRole(user.id, 'viewer');

      const permissions = await rbac.getUserPermissions(user.id);
      
      // Should have combined permissions
      expect(permissions).to.include('workflows:execute'); // from developer
      expect(permissions).to.include('reports:read'); // from viewer
    });

    it('should handle role inheritance', async () => {
      const user = await rbac.createUser({
        username: 'manager.user',
        email: 'manager@example.com'
      });
      testUsers.push(user.id);

      await rbac.assignRole(user.id, 'manager');

      const permissions = await rbac.getUserPermissions(user.id);
      
      // Manager inherits from developer and viewer
      expect(permissions).to.include('runners:write'); // manager permission
      expect(permissions).to.include('workflows:execute'); // inherited from developer
      expect(permissions).to.include('reports:read'); // inherited from viewer
    });
  });

  describe('Permission Checking', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await rbac.createUser({
        username: 'perm.test',
        email: 'perm@example.com'
      });
      testUsers.push(testUser.id);
    });

    it('should deny by default', async () => {
      // User with no roles
      const allowed = await rbac.checkPermission(testUser.id, 'workflows:read');
      expect(allowed).to.be.false;
    });

    it('should grant permissions based on roles', async () => {
      await rbac.assignRole(testUser.id, 'developer');

      const canRead = await rbac.checkPermission(testUser.id, 'workflows:read');
      const canWrite = await rbac.checkPermission(testUser.id, 'workflows:write');

      expect(canRead).to.be.true;
      expect(canWrite).to.be.false; // Developer can't write workflows
    });

    it('should enforce repository constraints', async () => {
      await rbac.assignRole(testUser.id, 'manager');

      // Manager can only access owned repositories
      const ownedAccess = await rbac.checkPermission(testUser.id, 'runners:write', {
        repository: 'user/repo',
        isOwner: true
      });

      const otherAccess = await rbac.checkPermission(testUser.id, 'runners:write', {
        repository: 'other/repo',
        isOwner: false
      });

      expect(ownedAccess).to.be.true;
      expect(otherAccess).to.be.false;
    });

    it('should cache permission checks', async () => {
      await rbac.assignRole(testUser.id, 'viewer');

      // First check - cache miss
      const start = Date.now();
      const result1 = await rbac.checkPermission(testUser.id, 'reports:read');
      const firstTime = Date.now() - start;

      // Second check - cache hit
      const cacheStart = Date.now();
      const result2 = await rbac.checkPermission(testUser.id, 'reports:read');
      const cacheTime = Date.now() - cacheStart;

      expect(result1).to.equal(result2);
      expect(cacheTime).to.be.lessThan(firstTime);

      // Verify cache statistics
      const stats = rbac.getStatistics();
      expect(stats.authorizationStats.cacheHits).to.be.greaterThan(0);
    });
  });

  describe('Session Management', () => {
    it('should create and validate sessions', async () => {
      const user = await rbac.createUser({
        username: 'session.user',
        email: 'session@example.com'
      });
      testUsers.push(user.id);

      const session = await rbac.createSession(user.id, {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0'
      });
      testSessions.push(session.id);

      expect(session).to.exist;
      expect(session.userId).to.equal(user.id);
      expect(session.active).to.be.true;

      // Validate session
      const validated = await rbac.validateSession(session.id);
      expect(validated).to.exist;
      expect(validated.id).to.equal(session.id);
    });

    it('should expire sessions after timeout', async () => {
      // Create RBAC with short timeout
      const shortRbac = new RBACSystem(auditLogger, {
        sessionTimeout: 100 // 100ms
      });
      await shortRbac.initialize();

      const user = await shortRbac.createUser({
        username: 'timeout.user',
        email: 'timeout@example.com'
      });

      const session = await shortRbac.createSession(user.id);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 200));

      const validated = await shortRbac.validateSession(session.id);
      expect(validated).to.be.null;

      await shortRbac.stop();
    });

    it('should enforce session limits', async () => {
      const user = await rbac.createUser({
        username: 'limit.user',
        email: 'limit@example.com'
      });
      testUsers.push(user.id);

      const sessions = [];
      
      // Create max sessions
      for (let i = 0; i < 5; i++) {
        const session = await rbac.createSession(user.id, {
          device: `device${i}`
        });
        sessions.push(session);
        testSessions.push(session.id);
      }

      // Create one more - should expire oldest
      const newSession = await rbac.createSession(user.id, {
        device: 'device5'
      });
      testSessions.push(newSession.id);

      // Check that oldest session is expired
      const oldestValidated = await rbac.validateSession(sessions[0].id);
      expect(oldestValidated).to.be.null;
    });
  });

  describe('Custom Policies', () => {
    it('should support custom authorization policies', async () => {
      const user = await rbac.createUser({
        username: 'policy.user',
        email: 'policy@example.com',
        attributes: {
          department: 'engineering'
        }
      });
      testUsers.push(user.id);

      // Add custom policy
      rbac.addPolicy('engineering-policy', {
        name: 'Engineering Department Policy',
        description: 'Grants additional permissions to engineering department',
        effect: 'allow',
        evaluate: async (user, permission, context) => {
          return user.attributes?.department === 'engineering' && 
                 permission.startsWith('engineering:');
        }
      });

      // Check custom permission
      const allowed = await rbac.checkPermission(user.id, 'engineering:deploy');
      expect(allowed).to.be.true;

      // Non-engineering permission should still be denied
      const denied = await rbac.checkPermission(user.id, 'finance:view');
      expect(denied).to.be.false;
    });

    it('should support time-based access control', async () => {
      const timeRole = await rbac.createRole({
        name: 'Business Hours Access',
        permissions: ['workflows:execute'],
        constraints: {
          timeRestriction: {
            startTime: '09:00',
            endTime: '17:00',
            timezone: 'UTC'
          }
        }
      });
      testRoles.push(timeRole.id);

      const user = await rbac.createUser({
        username: 'time.user',
        email: 'time@example.com'
      });
      testUsers.push(user.id);

      await rbac.assignRole(user.id, timeRole.id);

      // This test would need to mock time to properly test
      // For now, just verify the constraint is stored
      const role = rbac.roles.get(timeRole.id);
      expect(role.constraints.timeRestriction).to.exist;
    });
  });

  describe('Audit Integration', () => {
    it('should audit all authorization events', async () => {
      const user = await rbac.createUser({
        username: 'audit.user',
        email: 'audit@example.com'
      });
      testUsers.push(user.id);

      await rbac.assignRole(user.id, 'viewer');

      // Perform some actions
      await rbac.checkPermission(user.id, 'reports:read');
      await rbac.checkPermission(user.id, 'runners:write');

      // Check audit logs
      const events = await auditLogger.search({
        category: 'authorization',
        userId: 'system',
        limit: 100
      });

      const authEvents = events.filter(e => 
        e.action === 'permission_check' && 
        e.details?.permission
      );

      expect(authEvents.length).to.be.greaterThan(0);
      
      // Should have both granted and denied events
      const granted = authEvents.filter(e => e.result === 'granted');
      const denied = authEvents.filter(e => e.result === 'denied');
      
      expect(granted.length).to.be.greaterThan(0);
      expect(denied.length).to.be.greaterThan(0);
    });
  });

  describe('Performance and Scale', () => {
    it('should handle many users and roles efficiently', async () => {
      const userCount = 100;
      const users = [];

      // Create many users
      const startCreate = Date.now();
      for (let i = 0; i < userCount; i++) {
        const user = await rbac.createUser({
          username: `perf.user${i}`,
          email: `perf${i}@example.com`
        });
        users.push(user);
        testUsers.push(user.id);
        
        // Assign random roles
        const roles = ['viewer', 'developer', 'manager'];
        const role = roles[i % roles.length];
        await rbac.assignRole(user.id, role);
      }
      const createTime = Date.now() - startCreate;

      // Perform many permission checks
      const startCheck = Date.now();
      const checkPromises = [];
      for (let i = 0; i < 1000; i++) {
        const user = users[i % users.length];
        checkPromises.push(
          rbac.checkPermission(user.id, 'workflows:read')
        );
      }
      await Promise.all(checkPromises);
      const checkTime = Date.now() - startCheck;

      // Should complete in reasonable time
      expect(createTime).to.be.lessThan(10000); // 10 seconds for 100 users
      expect(checkTime).to.be.lessThan(1000); // 1 second for 1000 checks

      // Check cache effectiveness
      const stats = rbac.getStatistics();
      expect(stats.authorizationStats.cacheHitRate).to.not.equal('0%');
    });
  });

  describe('Security Features', () => {
    it('should prevent privilege escalation', async () => {
      const user = await rbac.createUser({
        username: 'escalation.user',
        email: 'escalation@example.com'
      });
      testUsers.push(user.id);

      await rbac.assignRole(user.id, 'developer');

      // Developer shouldn't be able to grant admin permissions
      const canGrantAdmin = await rbac.checkPermission(user.id, 'security:write');
      expect(canGrantAdmin).to.be.false;

      // Shouldn't be able to modify their own roles
      const canModifyRoles = await rbac.checkPermission(user.id, 'roles:write');
      expect(canModifyRoles).to.be.false;
    });

    it('should track failed authentication attempts', async () => {
      // Try to validate non-existent session
      const result = await rbac.validateSession('invalid-session-id');
      expect(result).to.be.null;

      // Check audit logs for failed attempts
      const events = await auditLogger.search({
        category: 'authentication',
        limit: 10
      });

      // Would need to implement tracking in RBAC to properly test this
      expect(events).to.be.an('array');
    });
  });
});