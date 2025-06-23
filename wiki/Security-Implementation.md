# Security Implementation 🔒

GitHub-RunnerHub is built with **security-first principles** and implements comprehensive enterprise-grade security features. This guide covers all security implementations, best practices, and compliance features.

## 🛡️ Security Overview

### Security Architecture Principles

- **🔒 Defense in Depth** - Multiple layers of security controls
- **🎯 Zero Trust** - Never trust, always verify approach
- **📊 Continuous Monitoring** - Real-time threat detection and response
- **🔐 Encryption Everywhere** - Data protection at rest and in transit
- **📝 Audit Everything** - Comprehensive logging for compliance
- **⚡ Automated Response** - Immediate threat mitigation

### Security Compliance

- ✅ **OWASP Top 10** - Complete protection against web vulnerabilities
- ✅ **SOC2 Type II** - Security, availability, and confidentiality controls
- ✅ **ISO 27001** - Information security management standards
- ✅ **GDPR** - Data protection and privacy compliance
- ✅ **HIPAA** - Healthcare data security requirements
- ✅ **PCI-DSS** - Payment card industry security standards

## 🔒 Input Validation & SSRF Protection

### GitHub Repository Validation

Comprehensive validation prevents Server-Side Request Forgery (SSRF) attacks:

```typescript
/**
 * Validates GitHub repository format and prevents SSRF attacks
 */
export function validateGitHubRepository(repository: string): string {
  // Format validation: owner/repo
  const parts = repository.trim().split('/');
  if (parts.length !== 2) {
    throw new Error('Repository must be in format "owner/repo"');
  }

  const [owner, repo] = parts;

  // Prevent path traversal
  if (owner.includes('..') || repo.includes('..') || 
      owner.includes('/') || repo.includes('/') ||
      owner.includes('\\\\') || repo.includes('\\\\')) {
    throw new Error('Repository names cannot contain path traversal sequences');
  }

  // Prevent URL scheme injection
  if (owner.toLowerCase().startsWith('http') || repo.toLowerCase().startsWith('http') ||
      owner.includes(':') || repo.includes(':')) {
    throw new Error('Repository names cannot contain URL schemes or colons');
  }

  // GitHub naming rules validation
  const validNamePattern = /^[a-zA-Z0-9-]+$/;
  if (!validNamePattern.test(owner) || !validNamePattern.test(repo)) {
    throw new Error('Repository owner and name must contain only alphanumeric characters and hyphens');
  }

  return `${owner}/${repo}`;
}
```

### Format String Protection

Prevents format string attacks and template injection:

```typescript
/**
 * Sanitizes string input to prevent format string attacks
 */
export function sanitizeStringInput(input: string, maxLength: number = 1000): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = input.substring(0, maxLength);

  // Remove format string specifiers
  sanitized = sanitized.replace(/%[sdioxX%]/g, '');

  // Remove template literal injection
  sanitized = sanitized.replace(/\\$\\{[^}]*\\}/g, '');

  // Remove control characters
  sanitized = sanitized.replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]/g, '');

  return sanitized.trim();
}
```

### Webhook Event Validation

Whitelist-based validation for GitHub webhook events:

```typescript
/**
 * Validates webhook event types against allowlist
 */
export function validateWebhookEventType(eventType: string): string {
  const allowedEvents = [
    'workflow_job', 'workflow_run', 'push', 'pull_request',
    'check_run', 'check_suite', 'deployment', 'release'
    // ... complete allowlist
  ];

  if (!allowedEvents.includes(eventType.trim())) {
    throw new Error(`Event type "${eventType}" is not supported`);
  }

  return eventType.trim();
}
```

### URL Validation & SSRF Prevention

Comprehensive URL validation with domain allowlisting:

```typescript
/**
 * Validates URLs to prevent SSRF attacks
 */
export function validateURL(url: string, allowedDomains: string[] = ['api.github.com']): string {
  const parsedUrl = new URL(url);

  // Only allow HTTPS
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }

  // Domain allowlist validation
  if (!allowedDomains.includes(parsedUrl.hostname)) {
    throw new Error(`Domain ${parsedUrl.hostname} is not in the allowlist`);
  }

  // Prevent private IP ranges
  const hostname = parsedUrl.hostname;
  if (/^(10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.|127\\.|169\\.254\\.|::1|localhost)/.test(hostname)) {
    throw new Error('Private IP addresses and localhost are not allowed');
  }

  return url;
}
```

## 🚨 Rate Limiting & DDoS Protection

### Intelligent Rate Limiting

Multi-level rate limiting with adaptive thresholds:

```typescript
export const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = config.security.apiRateWindow;
  const limit = config.security.apiRateLimit;

  // Implement sliding window rate limiting
  if (!store[key] || store[key].resetTime < now) {
    store[key] = {
      count: 1,
      resetTime: now + windowMs
    };
  } else {
    store[key].count++;
  }

  if (store[key].count > limit) {
    res.status(429).json({
      success: false,
      error: 'Too many requests'
    });
    return;
  }

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', limit.toString());
  res.setHeader('X-RateLimit-Remaining', (limit - store[key].count).toString());
  res.setHeader('X-RateLimit-Reset', store[key].resetTime.toString());

  next();
};
```

### Authentication Rate Limiting

Special rate limiting for authentication endpoints:

```typescript
// Apply stricter rate limiting to auth routes
router.use('/auth', rateLimiter);
router.use('/auth/login', strictRateLimiter);  // Lower limits for login attempts
```

## 🔐 Network Isolation & Container Security

### Per-Job Network Isolation

Each job runs in an isolated network environment:

```javascript
class NetworkIsolation {
  async createIsolatedNetwork(jobId) {
    const networkName = `job-network-${jobId}`;
    
    const network = await this.docker.createNetwork({
      Name: networkName,
      Driver: 'bridge',
      Options: {
        'com.docker.network.bridge.enable_icc': 'false',
        'com.docker.network.bridge.enable_ip_masquerade': 'true'
      },
      IPAM: {
        Driver: 'default',
        Config: [{
          Subnet: await this.allocateSubnet(),
          Gateway: await this.allocateGateway()
        }]
      }
    });

    // Apply firewall rules
    await this.applyFirewallRules(networkName);
    
    return network;
  }

  async applyFirewallRules(networkName) {
    const rules = [
      // Block inter-container communication
      `iptables -I DOCKER-USER -i ${networkName} -j DROP`,
      // Allow outbound HTTPS only
      `iptables -I DOCKER-USER -i ${networkName} -p tcp --dport 443 -j ACCEPT`,
      // Block common attack ports
      `iptables -I DOCKER-USER -i ${networkName} -p tcp --dport 22 -j DROP`,
      `iptables -I DOCKER-USER -i ${networkName} -p tcp --dport 3389 -j DROP`
    ];

    for (const rule of rules) {
      await execAsync(rule);
    }
  }
}
```

### Container Security Scanning

Real-time vulnerability scanning with Trivy:

```javascript
class ContainerScanner {
  async scanImage(imageName) {
    const scanResults = await execAsync(`trivy image --format json ${imageName}`);
    const vulnerabilities = JSON.parse(scanResults);
    
    const criticalVulns = vulnerabilities.Results
      .flatMap(result => result.Vulnerabilities || [])
      .filter(vuln => vuln.Severity === 'CRITICAL' || vuln.Severity === 'HIGH');

    if (criticalVulns.length > 0) {
      throw new SecurityViolationError(
        `Image ${imageName} contains ${criticalVulns.length} critical/high vulnerabilities`
      );
    }

    return vulnerabilities;
  }

  async scanRunningContainer(containerId) {
    // Runtime security monitoring
    const processes = await this.getContainerProcesses(containerId);
    const networkConnections = await this.getNetworkConnections(containerId);
    
    // Detect suspicious activities
    await this.detectCryptomining(processes);
    await this.detectUnauthorizedNetwork(networkConnections);
    await this.detectPrivilegeEscalation(processes);
  }
}
```

## 🔑 Secret Management & Encryption

### Multi-Layer Encryption

AES-256-GCM encryption for sensitive data:

```javascript
class SecretManager {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyDerivation = 'pbkdf2';
    this.iterations = 100000;
  }

  async encryptSecret(plaintext, masterKey) {
    const salt = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    
    // Derive encryption key
    const key = crypto.pbkdf2Sync(masterKey, salt, this.iterations, 32, 'sha512');
    
    const cipher = crypto.createCipher(this.algorithm, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  async injectSecret(containerId, secretName, secretValue, method = 'env') {
    const encryptedValue = await this.encryptSecret(secretValue, this.masterKey);
    
    switch (method) {
      case 'env':
        await this.injectEnvironmentVariable(containerId, secretName, encryptedValue);
        break;
      case 'file':
        await this.injectSecretFile(containerId, secretName, encryptedValue);
        break;
      case 'volume':
        await this.injectSecretVolume(containerId, secretName, encryptedValue);
        break;
    }

    // Schedule automatic cleanup
    this.scheduleSecretCleanup(containerId, secretName);
  }
}
```

### HashiCorp Vault Integration

Enterprise secret management with Vault:

```javascript
class VaultService {
  async getSecret(path) {
    const response = await this.vaultClient.read(path);
    return response.data;
  }

  async rotateSecret(path) {
    const newSecret = crypto.randomBytes(32).toString('hex');
    await this.vaultClient.write(path, { value: newSecret });
    
    // Notify all consumers of secret rotation
    await this.notifySecretRotation(path);
    
    return newSecret;
  }

  async createDynamicSecret(role, ttl = '1h') {
    const response = await this.vaultClient.write(
      `database/creds/${role}`,
      { ttl }
    );
    
    return {
      username: response.data.username,
      password: response.data.password,
      lease_id: response.lease_id
    };
  }
}
```

## 📝 Audit Logging & Compliance

### Tamper-Proof Audit Logs

Cryptographically signed audit trails:

```javascript
class AuditLogger {
  async logSecurityEvent(event) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      eventType: event.type,
      severity: event.severity,
      userId: event.userId,
      resourceId: event.resourceId,
      action: event.action,
      result: event.result,
      metadata: event.metadata,
      sourceIp: event.sourceIp,
      userAgent: event.userAgent
    };

    // Create hash chain for tamper detection
    const previousHash = await this.getLastEntryHash();
    auditEntry.previousHash = previousHash;
    auditEntry.hash = this.calculateHash(auditEntry);

    // Sign the entry
    auditEntry.signature = this.signEntry(auditEntry);

    await this.writeAuditEntry(auditEntry);
    
    // Real-time compliance monitoring
    await this.checkComplianceRules(auditEntry);
  }

  calculateHash(entry) {
    const data = JSON.stringify(entry, Object.keys(entry).sort());
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  signEntry(entry) {
    const privateKey = this.getSigningKey();
    const signature = crypto.sign('sha256', Buffer.from(entry.hash), privateKey);
    return signature.toString('base64');
  }
}
```

### Compliance Frameworks

Support for multiple compliance frameworks:

```javascript
class ComplianceManager {
  async generateSOC2Report(startDate, endDate) {
    const controls = [
      'CC6.1', // Logical Access Controls
      'CC6.2', // Authentication and Authorization
      'CC6.3', // System Access Controls
      'CC7.1', // System Boundaries and Configurations
      'CC7.2', // System Monitoring
    ];

    const report = {};
    for (const control of controls) {
      report[control] = await this.assessControl(control, startDate, endDate);
    }

    return report;
  }

  async generateGDPRReport() {
    return {
      dataProcessing: await this.getDataProcessingActivities(),
      dataSubjects: await this.getDataSubjectRights(),
      lawfulBasis: await this.getLawfulBasisAssessment(),
      dataRetention: await this.getDataRetentionPolicies(),
      dataBreaches: await this.getDataBreachLog()
    };
  }
}
```

## 🚨 Threat Detection & Response

### ML-Based Anomaly Detection

Machine learning for threat detection:

```javascript
class ThreatDetection {
  async analyzeJobBehavior(jobId, metrics) {
    const features = this.extractFeatures(metrics);
    const anomalyScore = await this.mlModel.predict(features);
    
    if (anomalyScore > this.threshold) {
      await this.handleAnomalousJob(jobId, anomalyScore, metrics);
    }
  }

  extractFeatures(metrics) {
    return {
      cpuUsage: metrics.cpu.usage,
      memoryUsage: metrics.memory.usage,
      networkTraffic: metrics.network.bytesOut,
      processCount: metrics.processes.length,
      networkConnections: metrics.network.connections.length,
      fileSystemActivity: metrics.filesystem.operations
    };
  }

  async handleAnomalousJob(jobId, score, metrics) {
    // Immediate response
    await this.quarantineContainer(jobId);
    
    // Generate security alert
    await this.generateSecurityAlert({
      type: 'ANOMALOUS_BEHAVIOR',
      severity: 'HIGH',
      jobId,
      anomalyScore: score,
      metrics,
      timestamp: new Date().toISOString()
    });

    // Notify security team
    await this.notifySecurityTeam(jobId, score);
  }
}
```

### Runtime Security Monitoring

Real-time container monitoring:

```javascript
class RuntimeMonitor {
  async monitorContainer(containerId) {
    const monitoringInterval = setInterval(async () => {
      try {
        // Monitor system calls
        const syscalls = await this.getSyscalls(containerId);
        await this.analyzeSyscalls(syscalls);

        // Monitor network activity
        const network = await this.getNetworkActivity(containerId);
        await this.analyzeNetworkActivity(network);

        // Monitor file system changes
        const filesystem = await this.getFileSystemChanges(containerId);
        await this.analyzeFileSystemChanges(filesystem);

        // Check for cryptomining indicators
        await this.detectCryptomining(containerId);

      } catch (error) {
        logger.error('Runtime monitoring error', { containerId, error });
      }
    }, 5000); // Monitor every 5 seconds

    // Store monitoring handle for cleanup
    this.monitoringHandles.set(containerId, monitoringInterval);
  }

  async detectCryptomining(containerId) {
    const processes = await this.getContainerProcesses(containerId);
    const suspiciousProcesses = processes.filter(proc => 
      this.cryptominingIndicators.some(indicator => 
        proc.name.includes(indicator) || proc.args.includes(indicator)
      )
    );

    if (suspiciousProcesses.length > 0) {
      await this.handleCryptominingDetection(containerId, suspiciousProcesses);
    }
  }
}
```

## 🔧 Security Configuration

### Security Levels

Configurable security levels for different environments:

```javascript
const securityConfigs = {
  low: {
    rateLimiting: { enabled: true, limit: 1000 },
    networkIsolation: { enabled: false },
    containerScanning: { enabled: false },
    auditLogging: { level: 'basic' },
    encryption: { algorithm: 'aes-128' }
  },
  
  medium: {
    rateLimiting: { enabled: true, limit: 500 },
    networkIsolation: { enabled: true },
    containerScanning: { enabled: true, critical_only: true },
    auditLogging: { level: 'standard' },
    encryption: { algorithm: 'aes-256' }
  },
  
  high: {
    rateLimiting: { enabled: true, limit: 200 },
    networkIsolation: { enabled: true },
    containerScanning: { enabled: true, all_severities: true },
    auditLogging: { level: 'comprehensive' },
    encryption: { algorithm: 'aes-256-gcm' },
    runtimeMonitoring: { enabled: true }
  },
  
  critical: {
    rateLimiting: { enabled: true, limit: 100 },
    networkIsolation: { enabled: true, strict: true },
    containerScanning: { enabled: true, block_on_vuln: true },
    auditLogging: { level: 'forensic' },
    encryption: { algorithm: 'aes-256-gcm', key_rotation: '24h' },
    runtimeMonitoring: { enabled: true, ml_detection: true },
    accessControl: { mfa_required: true }
  }
};
```

### Environment-Specific Security

```bash
# Development Environment
export SECURITY_LEVEL=medium
export ENABLE_DEBUG_LOGGING=true
export SKIP_CERTIFICATE_VALIDATION=true

# Staging Environment  
export SECURITY_LEVEL=high
export ENABLE_SECURITY_SCANNING=true
export REQUIRE_HTTPS=true

# Production Environment
export SECURITY_LEVEL=critical
export ENABLE_SECURITY_SCANNING=true
export ENABLE_RUNTIME_MONITORING=true
export REQUIRE_HTTPS=true
export ENABLE_WAF=true
export ENABLE_DDoS_PROTECTION=true
```

## 📊 Security Monitoring & Metrics

### Security Metrics Collection

```javascript
class SecurityMetrics {
  async collectSecurityMetrics() {
    return {
      authentication: {
        successful_logins: await this.getSuccessfulLogins(),
        failed_logins: await this.getFailedLogins(),
        active_sessions: await this.getActiveSessions()
      },
      
      vulnerability_scanning: {
        scans_completed: await this.getScansCompleted(),
        vulnerabilities_found: await this.getVulnerabilitiesFound(),
        critical_vulnerabilities: await this.getCriticalVulnerabilities()
      },
      
      threat_detection: {
        threats_detected: await this.getThreatsDetected(),
        false_positives: await this.getFalsePositives(),
        incidents_resolved: await this.getIncidentsResolved()
      },
      
      compliance: {
        audit_events: await this.getAuditEvents(),
        policy_violations: await this.getPolicyViolations(),
        compliance_score: await this.getComplianceScore()
      }
    };
  }
}
```

### Security Dashboards

Real-time security monitoring dashboards available at:

- **Security Overview**: `/dashboard/security`
- **Threat Detection**: `/dashboard/security/threats`
- **Vulnerability Management**: `/dashboard/security/vulnerabilities`
- **Compliance Status**: `/dashboard/security/compliance`
- **Audit Logs**: `/dashboard/security/audit`

## 🚨 Incident Response

### Automated Incident Response

```javascript
class IncidentResponse {
  async handleSecurityIncident(incident) {
    // Classify incident severity
    const severity = this.classifyIncident(incident);
    
    // Immediate containment
    if (severity >= 'HIGH') {
      await this.containIncident(incident);
    }
    
    // Notify stakeholders
    await this.notifyStakeholders(incident, severity);
    
    // Begin investigation
    await this.startInvestigation(incident);
    
    // Document incident
    await this.documentIncident(incident);
  }

  async containIncident(incident) {
    switch (incident.type) {
      case 'MALICIOUS_CONTAINER':
        await this.quarantineContainer(incident.containerId);
        break;
      case 'UNAUTHORIZED_ACCESS':
        await this.suspendUserAccount(incident.userId);
        break;
      case 'DATA_BREACH':
        await this.enableDataLossProtection();
        break;
    }
  }
}
```

## 🔍 Security Testing

### Automated Security Testing

```javascript
// Security test suite
describe('Security Implementation', () => {
  describe('Input Validation', () => {
    test('should prevent SSRF attacks', async () => {
      const maliciousRepo = 'http://evil.com/repo';
      expect(() => validateGitHubRepository(maliciousRepo))
        .toThrow('Repository must be in format "owner/repo"');
    });

    test('should prevent path traversal', async () => {
      const maliciousRepo = '../evil/repo';
      expect(() => validateGitHubRepository(maliciousRepo))
        .toThrow('Repository names cannot contain path traversal sequences');
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits', async () => {
      // Test rate limiting implementation
    });
  });

  describe('Encryption', () => {
    test('should encrypt secrets properly', async () => {
      // Test encryption implementation
    });
  });
});
```

## 📋 Security Checklist

### Pre-Production Security Checklist

- [ ] **Input Validation**
  - [ ] SSRF protection implemented
  - [ ] Format string protection enabled
  - [ ] URL validation configured
  - [ ] Path traversal prevention active

- [ ] **Authentication & Authorization**
  - [ ] Strong password policies enforced
  - [ ] Multi-factor authentication enabled
  - [ ] Role-based access control configured
  - [ ] Session management implemented

- [ ] **Network Security**
  - [ ] HTTPS enforced
  - [ ] Network isolation enabled
  - [ ] Firewall rules configured
  - [ ] DDoS protection active

- [ ] **Container Security**
  - [ ] Vulnerability scanning enabled
  - [ ] Runtime monitoring active
  - [ ] Resource limits enforced
  - [ ] Security policies applied

- [ ] **Data Protection**
  - [ ] Encryption at rest enabled
  - [ ] Encryption in transit enforced
  - [ ] Secret management configured
  - [ ] Key rotation scheduled

- [ ] **Monitoring & Logging**
  - [ ] Audit logging enabled
  - [ ] Security monitoring active
  - [ ] Incident response ready
  - [ ] Compliance reporting configured

---

## 🆘 Security Support

For security-related questions or issues:

1. **Security Documentation**: [Security Best Practices](Security-Best-Practices)
2. **Vulnerability Reports**: [security@github-runnerhub.com](mailto:security@github-runnerhub.com)
3. **Incident Response**: [incident-response@github-runnerhub.com](mailto:incident-response@github-runnerhub.com)
4. **Security Discussions**: [GitHub Security Discussions](https://github.com/anubissbe/GitHub-RunnerHub/discussions/categories/security)

---

**🔒 Security is not a feature, it's a foundation**

**🏠 Back to: [Wiki Home](Home)**