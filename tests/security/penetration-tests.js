/**
 * Security Penetration Tests
 * Tests for common security vulnerabilities and attack vectors
 */

const request = require('supertest');
const { expect } = require('chai');
const crypto = require('crypto');

describe('Security Penetration Tests', () => {
  let app;
  let authToken;

  before(async () => {
    // Import app
    try {
      app = require('../../src/app');
    } catch (error) {
      console.warn('Could not load app for security tests:', error.message);
      return;
    }

    // Get auth token if possible
    try {
      const authResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'admin_password'
        });

      if (authResponse.status === 200) {
        authToken = authResponse.body.token;
      }
    } catch (error) {
      console.warn('Could not authenticate for security tests');
    }
  });

  describe('Authentication Security', () => {
    it('should prevent brute force attacks', async function() {
      this.timeout(10000);
      
      if (!app) return this.skip();

      const attempts = [];
      for (let i = 0; i < 10; i++) {
        attempts.push(
          request(app)
            .post('/api/auth/login')
            .send({
              username: 'admin',
              password: 'wrong_password'
            })
        );
      }

      const responses = await Promise.all(attempts);
      
      // Should have rate limiting or account lockout
      const blockedResponses = responses.filter(r => r.status === 429 || r.status === 423);
      expect(blockedResponses.length).to.be.greaterThan(0);
    });

    it('should reject weak passwords', async function() {
      if (!app) return this.skip();

      const weakPasswords = ['123', 'password', 'admin', ''];
      
      for (const password of weakPasswords) {
        const response = await request(app)
          .post('/api/users')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            username: 'testuser',
            password: password,
            email: 'test@example.com'
          });

        expect(response.status).to.be.oneOf([400, 401, 404]);
      }
    });

    it('should invalidate tokens on logout', async function() {
      if (!app || !authToken) return this.skip();

      // Use token
      const beforeLogout = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${authToken}`);

      // Logout
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`);

      // Try to use token again
      const afterLogout = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${authToken}`);

      if (beforeLogout.status === 200) {
        expect(afterLogout.status).to.equal(401);
      }
    });
  });

  describe('Input Validation Security', () => {
    it('should prevent SQL injection attacks', async function() {
      if (!app) return this.skip();

      const sqlPayloads = [
        "'; DROP TABLE users; --",
        "1' OR '1'='1",
        "admin'/*",
        "' UNION SELECT * FROM users --"
      ];

      for (const payload of sqlPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            username: payload,
            password: 'password'
          });

        // Should not succeed and should not return database errors
        expect(response.status).to.not.equal(200);
        expect(response.body.error || '').to.not.include('SQL');
        expect(response.body.error || '').to.not.include('database');
      }
    });

    it('should prevent XSS attacks', async function() {
      if (!app) return this.skip();

      const xssPayloads = [
        '<script>alert("xss")</script>',
        'javascript:alert("xss")',
        '<img src="x" onerror="alert(1)">',
        '"><script>alert(String.fromCharCode(88,83,83))</script>'
      ];

      for (const payload of xssPayloads) {
        const response = await request(app)
          .post('/api/jobs')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            repository: payload,
            workflow: 'test',
            ref: 'main'
          });

        // Check response doesn't contain unescaped payload
        if (response.body && typeof response.body === 'object') {
          const responseText = JSON.stringify(response.body);
          expect(responseText).to.not.include('<script>');
          expect(responseText).to.not.include('javascript:');
        }
      }
    });

    it('should validate and sanitize file paths', async function() {
      if (!app) return this.skip();

      const pathTraversalPayloads = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '/etc/shadow',
        'C:\\Windows\\System32\\drivers\\etc\\hosts'
      ];

      for (const payload of pathTraversalPayloads) {
        const response = await request(app)
          .get('/api/files/' + encodeURIComponent(payload))
          .set('Authorization', `Bearer ${authToken}`);

        // Should not succeed in accessing system files
        expect(response.status).to.be.oneOf([400, 403, 404]);
      }
    });
  });

  describe('Authorization Security', () => {
    it('should enforce role-based access control', async function() {
      if (!app) return this.skip();

      // Try to access admin endpoints without proper role
      const adminEndpoints = [
        '/api/admin/users',
        '/api/admin/system',
        '/api/admin/logs'
      ];

      for (const endpoint of adminEndpoints) {
        const response = await request(app)
          .get(endpoint)
          .set('Authorization', `Bearer ${authToken}`);

        // Should require admin role
        expect(response.status).to.be.oneOf([401, 403, 404]);
      }
    });

    it('should prevent horizontal privilege escalation', async function() {
      if (!app) return this.skip();

      // Try to access other users' data
      const response = await request(app)
        .get('/api/users/other-user-id')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).to.be.oneOf([401, 403, 404]);
    });

    it('should prevent vertical privilege escalation', async function() {
      if (!app) return this.skip();

      // Try to modify system settings
      const response = await request(app)
        .patch('/api/system/config')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ debug: true });

      expect(response.status).to.be.oneOf([401, 403, 404]);
    });
  });

  describe('Data Protection Security', () => {
    it('should not expose sensitive information in responses', async function() {
      if (!app) return this.skip();

      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${authToken}`);

      if (response.status === 200 && response.body) {
        const responseText = JSON.stringify(response.body);
        
        // Should not contain sensitive data
        expect(responseText).to.not.include('password');
        expect(responseText).to.not.include('secret');
        expect(responseText).to.not.include('private_key');
        expect(responseText).to.not.include('api_key');
      }
    });

    it('should use secure headers', async function() {
      if (!app) return this.skip();

      const response = await request(app)
        .get('/health');

      // Check for security headers
      const headers = response.headers;
      
      // Should have security headers
      expect(headers).to.have.property('x-content-type-options');
      expect(headers['x-content-type-options']).to.equal('nosniff');
    });

    it('should prevent information disclosure in errors', async function() {
      if (!app) return this.skip();

      const response = await request(app)
        .get('/api/nonexistent/endpoint')
        .set('Authorization', `Bearer ${authToken}`);

      if (response.body && response.body.error) {
        const error = response.body.error.toLowerCase();
        
        // Should not reveal internal information
        expect(error).to.not.include('stack trace');
        expect(error).to.not.include('database');
        expect(error).to.not.include('internal');
        expect(error).to.not.include('mysql');
        expect(error).to.not.include('postgresql');
      }
    });
  });

  describe('Session Security', () => {
    it('should have secure session management', async function() {
      if (!app) return this.skip();

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'admin_password'
        });

      if (response.headers['set-cookie']) {
        const cookies = response.headers['set-cookie'];
        
        // Check for secure cookie flags
        cookies.forEach(cookie => {
          if (cookie.includes('session') || cookie.includes('token')) {
            expect(cookie).to.include('HttpOnly');
            expect(cookie).to.include('Secure');
          }
        });
      }
    });

    it('should prevent session fixation', async function() {
      if (!app) return this.skip();

      // Get initial session
      const response1 = await request(app)
        .get('/api/auth/session');

      // Login
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'admin_password'
        });

      // Get new session
      const response2 = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${loginResponse.body.token}`);

      // Session should change after login
      if (response1.body && response2.body) {
        expect(response1.body.sessionId).to.not.equal(response2.body.sessionId);
      }
    });
  });

  describe('Rate Limiting Security', () => {
    it('should implement API rate limiting', async function() {
      this.timeout(15000);
      
      if (!app) return this.skip();

      const requests = [];
      for (let i = 0; i < 100; i++) {
        requests.push(
          request(app)
            .get('/api/jobs')
            .set('Authorization', `Bearer ${authToken}`)
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);
      
      // Should have some rate limiting
      expect(rateLimited.length).to.be.greaterThan(0);
    });
  });

  describe('File Upload Security', () => {
    it('should validate file types and sizes', async function() {
      if (!app) return this.skip();

      // Test malicious file upload
      const response = await request(app)
        .post('/api/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', Buffer.from('#!/bin/bash\nrm -rf /'), 'malicious.sh');

      expect(response.status).to.be.oneOf([400, 403, 404]);
    });
  });

  describe('Cryptographic Security', () => {
    it('should use strong cryptographic practices', async function() {
      if (!app) return this.skip();

      // Test password hashing endpoint if available
      const response = await request(app)
        .post('/api/test/hash')
        .send({ password: 'testpassword' });

      if (response.status === 200 && response.body.hash) {
        // Should not be plain text or weak hash
        expect(response.body.hash).to.not.equal('testpassword');
        expect(response.body.hash.length).to.be.greaterThan(20);
      }
    });
  });
});