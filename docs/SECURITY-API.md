# Security API Reference

## Overview

This document provides detailed API reference for all security components in GitHub RunnerHub. Each component can be used independently or as part of the integrated security orchestrator.

## Table of Contents

1. [Security Orchestrator](#security-orchestrator)
2. [Network Isolation Manager](#network-isolation-manager)
3. [Resource Quota Manager](#resource-quota-manager)
4. [Secret Management System](#secret-management-system)
5. [Container Security Scanner](#container-security-scanner)
6. [RBAC System](#rbac-system)
7. [Runtime Security Monitor](#runtime-security-monitor)
8. [Audit Logger](#audit-logger)

## Security Orchestrator

Central coordinator for all security components.

### Constructor
```javascript
const securityOrchestrator = new SecurityOrchestrator(dockerAPI, options);
```

**Options:**
- `securityLevel` (string): 'low', 'medium', 'high', 'paranoid'
- `components` (object): Enable/disable specific components
- `policies` (object): Security policy configuration
- `integration` (object): External integration settings

### Methods

#### initialize()
Initialize the security orchestrator and all enabled components.
```javascript
await securityOrchestrator.initialize();
```

#### createJobSecurityContext(jobId, jobConfig)
Create security context for a job.
```javascript
const context = await securityOrchestrator.createJobSecurityContext('job123', {
  repository: 'org/repo',
  userId: 'user123',
  priority: 'high'
});
```

**Returns:**
```javascript
{
  jobId: 'job123',
  state: 'ready', // 'initializing', 'ready', 'blocked'
  checks: {
    authentication: true,
    authorization: true,
    scanning: true,
    resourceAllocation: true,
    networkIsolation: true
  },
  network: { /* network details */ },
  resources: { /* allocated resources */ },
  threats: [],
  violations: []
}
```

#### prepareSecureContainer(containerId, jobId)
Apply security controls to a container.
```javascript
const secured = await securityOrchestrator.prepareSecureContainer('container123', 'job123');
```

#### cleanupJobSecurity(jobId)
Clean up security resources after job completion.
```javascript
const report = await securityOrchestrator.cleanupJobSecurity('job123');
```

#### handleSecurityThreat(threat)
Handle detected security threats.
```javascript
await securityOrchestrator.handleSecurityThreat({
  type: 'suspicious_process',
  severity: 'high',
  containerId: 'container123',
  details: { /* threat details */ }
});
```

### Events

- `initialized`: Security orchestrator initialized
- `securityContextCreated`: Job security context created
- `containerSecured`: Container security applied
- `threatHandled`: Security threat handled
- `jobBlocked`: Job blocked by security policy
- `securityAlert`: Security alert generated

## Network Isolation Manager

Manages network isolation and segmentation for containers.

### Constructor
```javascript
const networkManager = new NetworkIsolationManager(dockerAPI, options);
```

**Options:**
- `isolationMode`: 'strict', 'moderate', 'relaxed'
- `enableDNSFiltering`: Enable DNS filtering
- `allowedDomains`: Whitelist of allowed domains
- `customNetworkPolicies`: Custom network policies

### Methods

#### createIsolatedNetwork(jobId, jobConfig)
Create isolated network for a job.
```javascript
const network = await networkManager.createIsolatedNetwork('job123', {
  allowInternet: false,
  allowedPorts: [80, 443],
  customDNS: ['8.8.8.8']
});
```

#### connectContainerToNetwork(containerId, jobId)
Connect container to its isolated network.
```javascript
await networkManager.connectContainerToNetwork('container123', 'job123');
```

#### applyNetworkPolicies(jobId, policies)
Apply network policies to a job's network.
```javascript
await networkManager.applyNetworkPolicies('job123', {
  ingress: [
    { from: 'github.com', ports: [443] }
  ],
  egress: [
    { to: 'npmjs.org', ports: [443] }
  ]
});
```

#### monitorNetworkTraffic(jobId)
Monitor network traffic for a job.
```javascript
const traffic = await networkManager.monitorNetworkTraffic('job123');
```

## Resource Quota Manager

Manages resource allocation and enforcement.

### Constructor
```javascript
const quotaManager = new ResourceQuotaManager(dockerAPI, options);
```

**Options:**
- `enableOvercommit`: Allow resource overcommit
- `overcommitRatio`: Overcommit ratio (default: 1.2)
- `quotaEnforcement`: 'hard' or 'soft'
- `defaults`: Default resource quotas

### Methods

#### allocateResources(jobId, jobConfig)
Allocate resources for a job.
```javascript
const allocation = await quotaManager.allocateResources('job123', {
  priority: 'high',
  requestedResources: {
    cpu: '2.0',
    memory: '4GB',
    disk: '20GB'
  }
});
```

#### applyResourceLimits(containerId, jobId)
Apply resource limits to a container.
```javascript
await quotaManager.applyResourceLimits('container123', 'job123');
```

#### monitorResourceUsage(jobId)
Monitor resource usage for a job.
```javascript
const usage = await quotaManager.monitorResourceUsage('job123');
// Returns: { cpu: 45.2, memory: 78.5, disk: 12.3, network: 5.6 }
```

#### releaseResources(jobId)
Release allocated resources.
```javascript
await quotaManager.releaseResources('job123');
```

## Secret Management System

Secure handling of secrets and sensitive data.

### Constructor
```javascript
const secretManager = new SecretManagementSystem(options);
```

**Options:**
- `backend`: 'vault', 'file', 'memory'
- `encryption`: Encryption settings
- `vault`: Vault connection settings
- `rotation`: Secret rotation settings

### Methods

#### storeSecret(secretId, secretValue, metadata)
Store a secret securely.
```javascript
await secretManager.storeSecret('github-token', 'ghp_xxxx', {
  owner: 'user123',
  expiresAt: new Date('2024-12-31'),
  autoRotate: true
});
```

#### retrieveSecret(secretId, requester)
Retrieve a secret.
```javascript
const secret = await secretManager.retrieveSecret('github-token', {
  userId: 'user123',
  jobId: 'job123'
});
```

#### injectSecrets(containerId, jobId, secrets)
Inject secrets into a container.
```javascript
await secretManager.injectSecrets('container123', 'job123', [
  { name: 'GITHUB_TOKEN', secretId: 'github-token' },
  { name: 'NPM_TOKEN', secretId: 'npm-token' }
]);
```

#### rotateSecret(secretId)
Rotate a secret.
```javascript
const newVersion = await secretManager.rotateSecret('github-token');
```

## Container Security Scanner

Scans container images for vulnerabilities.

### Constructor
```javascript
const scanner = new ContainerSecurityScanner(dockerAPI, options);
```

**Options:**
- `scanners`: Scanner configuration (Trivy, etc.)
- `policies`: Security policies
- `blockOnFailure`: Block execution on scan failure
- `caching`: Scan result caching

### Methods

#### scanImage(imageId)
Scan a container image.
```javascript
const results = await scanner.scanImage('ubuntu:20.04');
```

**Returns:**
```javascript
{
  imageId: 'ubuntu:20.04',
  scanDate: '2024-03-20T10:30:00Z',
  scanner: 'trivy',
  vulnerabilities: {
    critical: 0,
    high: 2,
    medium: 5,
    low: 12
  },
  findings: [ /* detailed findings */ ],
  overallStatus: 'pass', // 'pass', 'warn', 'fail'
  policyViolations: []
}
```

#### applyScanPolicy(imageId, policy)
Apply security policy to scan results.
```javascript
const decision = await scanner.applyScanPolicy('ubuntu:20.04', {
  maxCritical: 0,
  maxHigh: 5,
  requireLatestPatches: true
});
```

## RBAC System

Role-based access control implementation.

### Constructor
```javascript
const rbac = new RBACSystem(auditLogger, options);
```

**Options:**
- `denyByDefault`: Default deny policy
- `requireAuthentication`: Require authentication
- `sessionTimeout`: Session timeout duration
- `cacheEnabled`: Enable permission caching

### Methods

#### createUser(userData)
Create a new user.
```javascript
const user = await rbac.createUser({
  username: 'john.doe',
  email: 'john@example.com',
  name: 'John Doe'
});
```

#### createRole(roleData)
Create a new role.
```javascript
const role = await rbac.createRole({
  name: 'CI/CD Manager',
  permissions: ['workflows:*', 'runners:read'],
  constraints: {
    repositories: 'owned',
    timeRestriction: {
      startTime: '09:00',
      endTime: '18:00'
    }
  }
});
```

#### assignRole(userId, roleId)
Assign role to user.
```javascript
await rbac.assignRole('user123', 'manager');
```

#### checkPermission(userId, permission, context)
Check if user has permission.
```javascript
const allowed = await rbac.checkPermission('user123', 'workflows:execute', {
  repository: 'org/repo',
  isOwner: true
});
```

#### createSession(userId, metadata)
Create user session.
```javascript
const session = await rbac.createSession('user123', {
  ipAddress: '10.0.1.100',
  userAgent: 'Mozilla/5.0...'
});
```

## Runtime Security Monitor

Real-time security monitoring for containers.

### Constructor
```javascript
const monitor = new RuntimeSecurityMonitor(dockerAPI, auditLogger, options);
```

**Options:**
- `monitoringInterval`: Check interval (ms)
- `syscallMonitoring`: Enable syscall monitoring
- `suspiciousProcesses`: List of suspicious processes
- `detectionRules`: Custom detection rules

### Methods

#### startContainerMonitoring(containerId, jobId, metadata)
Start monitoring a container.
```javascript
await monitor.startContainerMonitoring('container123', 'job123', {
  repository: 'org/repo',
  expectedProcesses: ['node', 'npm']
});
```

#### performSecurityCheck(containerId)
Perform security check on container.
```javascript
const threats = await monitor.performSecurityCheck('container123');
```

#### stopContainerMonitoring(containerId)
Stop monitoring a container.
```javascript
await monitor.stopContainerMonitoring('container123');
```

### Events

- `threatDetected`: Security threat detected
- `anomalyDetected`: Behavioral anomaly detected
- `processViolation`: Suspicious process detected

## Audit Logger

Comprehensive audit logging system.

### Constructor
```javascript
const auditLogger = new AuditLogger(options);
```

**Options:**
- `storage`: Storage configuration
- `integrity`: Integrity settings
- `compliance`: Compliance standards
- `retention`: Retention policies

### Methods

#### log(event)
Log an audit event.
```javascript
await auditLogger.log({
  category: 'authorization',
  action: 'permission_granted',
  userId: 'user123',
  resourceType: 'workflow',
  resourceId: 'workflow456',
  result: 'success',
  details: { /* additional details */ }
});
```

#### search(query)
Search audit logs.
```javascript
const events = await auditLogger.search({
  startDate: new Date('2024-03-01'),
  endDate: new Date('2024-03-31'),
  category: 'security',
  userId: 'user123',
  limit: 100
});
```

#### export(query, format)
Export audit logs.
```javascript
const report = await auditLogger.export({
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-03-31')
}, 'compliance'); // 'json', 'csv', 'compliance'
```

#### verifyIntegrity(startDate, endDate)
Verify log integrity.
```javascript
const results = await auditLogger.verifyIntegrity(
  new Date('2024-03-01'),
  new Date('2024-03-31')
);
// Returns: { verified: 1000, failed: 0, errors: [] }
```

## Security Event Schemas

### Threat Event
```javascript
{
  type: 'threat_type',
  severity: 'critical|high|medium|low',
  timestamp: 'ISO 8601 date',
  source: 'component_name',
  containerId: 'container_id',
  jobId: 'job_id',
  details: {
    // Threat-specific details
  },
  evidence: [
    // Supporting evidence
  ],
  recommendedAction: 'action_to_take'
}
```

### Audit Event
```javascript
{
  id: 'evt_unique_id',
  timestamp: 'ISO 8601 date',
  category: 'category_name',
  action: 'action_performed',
  result: 'success|failure',
  userId: 'user_id',
  sessionId: 'session_id',
  resourceType: 'resource_type',
  resourceId: 'resource_id',
  details: {
    // Event-specific details
  },
  compliance: {
    standards: ['SOC2', 'ISO27001'],
    dataClassification: 'public|internal|confidential',
    retentionRequired: 365
  },
  integrity: {
    hash: 'sha256:hash',
    algorithm: 'sha256',
    previousHash: 'sha256:previous_hash'
  }
}
```

## Error Handling

All security components follow consistent error handling:

```javascript
try {
  await securityComponent.method();
} catch (error) {
  if (error.code === 'SECURITY_VIOLATION') {
    // Handle security violation
  } else if (error.code === 'PERMISSION_DENIED') {
    // Handle permission denied
  } else if (error.code === 'RESOURCE_EXHAUSTED') {
    // Handle resource exhaustion
  } else {
    // Handle general error
  }
}
```

## Best Practices

1. **Always initialize security components** before use
2. **Handle security events** appropriately
3. **Log all security-relevant actions**
4. **Follow principle of least privilege**
5. **Regularly review security policies**
6. **Monitor security metrics**
7. **Keep security components updated**

## Security Metrics

Monitor these key security metrics:

```javascript
const metrics = await securityOrchestrator.getSecurityMetrics();

// Key metrics to track:
// - Security score (0-100)
// - Active threats count
// - Failed authentication attempts
// - Policy violations
// - Scan findings by severity
// - Resource quota violations
// - Network policy violations
// - Audit events by category
```