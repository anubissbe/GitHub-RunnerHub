# Container Security Scanning

## Overview

The GitHub RunnerHub implements comprehensive container image security scanning to ensure that only secure, compliant images are used for running GitHub Actions workflows. This feature integrates Trivy vulnerability scanner to automatically scan container images before deployment.

## Architecture

### Components

1. **Security Scanner Service** (`src/services/security-scanner.ts`)
   - Core scanning engine using Trivy
   - Vulnerability detection and classification
   - Policy enforcement
   - Scan result caching
   - Event-driven notifications

2. **Security Controller** (`src/controllers/security-controller.ts`)
   - REST API endpoints for security operations
   - Request validation and authorization
   - Response formatting

3. **Database Schema** (`migrations/006_create_security_scanning_tables.sql`)
   - `security_scans`: Stores scan results
   - `security_policies`: Policy definitions
   - `security_exemptions`: CVE exemptions

### Integration Points

- **Container Orchestrator**: Scans images before container creation
- **Audit Logger**: Records all security events
- **Event System**: Real-time notifications for scan results

## Features

### 1. Vulnerability Scanning

- **Automatic Scanning**: Images are scanned automatically before deployment
- **Manual Scanning**: On-demand scanning via API
- **Comprehensive Detection**: Identifies vulnerabilities in:
  - OS packages
  - Application dependencies
  - Known CVEs
  - Security misconfigurations

### 2. Policy Management

#### Default Policies

1. **Default Security Policy**
   - Blocks critical vulnerabilities
   - Allows up to 10 high vulnerabilities
   - Allows up to 50 medium vulnerabilities
   - Trusted registries: docker.io, ghcr.io

2. **Strict Security Policy**
   - Blocks critical and high vulnerabilities
   - Allows up to 5 medium vulnerabilities
   - Requires specific labels: approved, production
   - Trusted registries: ghcr.io only

3. **Development Policy**
   - Relaxed settings for development
   - Allows up to 5 critical vulnerabilities
   - Allows up to 20 high vulnerabilities
   - No registry restrictions

#### Policy Configuration

```json
{
  "name": "Custom Policy",
  "description": "Custom security policy",
  "blockOnCritical": true,
  "blockOnHigh": false,
  "maxCriticalVulnerabilities": 0,
  "maxHighVulnerabilities": 10,
  "maxMediumVulnerabilities": 50,
  "exemptCVEs": ["CVE-2023-12345"],
  "requiredLabels": ["approved"],
  "trustedRegistries": ["ghcr.io", "docker.io"],
  "enabled": true
}
```

### 3. Scan Results

#### Vulnerability Classification

- **Critical**: Immediate action required
- **High**: Should be fixed soon
- **Medium**: Plan to fix
- **Low**: Fix if convenient
- **Negligible**: Informational only
- **Unknown**: Unclassified vulnerabilities

#### Result Format

```json
{
  "id": "scan-uuid",
  "imageName": "myapp",
  "imageTag": "v1.0.0",
  "scanDate": "2024-01-20T10:00:00Z",
  "scanDuration": 45000,
  "summary": {
    "total": 15,
    "critical": 0,
    "high": 2,
    "medium": 8,
    "low": 5,
    "negligible": 0,
    "unknown": 0,
    "fixable": 12
  },
  "vulnerabilities": [
    {
      "vulnerabilityId": "CVE-2023-12345",
      "severity": "high",
      "packageName": "libssl",
      "packageVersion": "1.1.1",
      "fixedVersion": "1.1.1f",
      "title": "SSL vulnerability",
      "description": "Description of the vulnerability"
    }
  ]
}
```

## API Endpoints

### Scan Image
```http
POST /api/security/scan
Authorization: Bearer <token>
Content-Type: application/json

{
  "imageName": "myapp",
  "imageTag": "v1.0.0",
  "repository": "my-repo",
  "policyId": "policy-uuid",
  "force": false
}
```

### Get Scan Results
```http
GET /api/security/scans?imageId=myapp:v1.0.0&limit=10
Authorization: Bearer <token>
```

### Get Scan Result
```http
GET /api/security/scans/{scanId}
Authorization: Bearer <token>
```

### Get Policies
```http
GET /api/security/policies
Authorization: Bearer <token>
```

### Create/Update Policy
```http
POST /api/security/policies
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Production Policy",
  "blockOnCritical": true,
  "maxHighVulnerabilities": 0
}
```

### Check Policy Compliance
```http
POST /api/security/policies/{policyId}/check
Authorization: Bearer <token>
Content-Type: application/json

{
  "scanId": "scan-uuid"
}
```

### Get Vulnerability Statistics
```http
GET /api/security/stats?days=30
Authorization: Bearer <token>
```

### Delete Policy
```http
DELETE /api/security/policies/{policyId}
Authorization: Bearer <token>
```

### Exempt CVE
```http
POST /api/security/policies/{policyId}/exemptions
Authorization: Bearer <token>
Content-Type: application/json

{
  "cve": "CVE-2023-12345",
  "reason": "False positive",
  "expiresAt": "2024-12-31"
}
```

## Configuration

### Environment Variables

```bash
# Security scanning configuration
SECURITY_SCAN_IMAGES=true              # Enable automatic scanning (default: true)
SECURITY_BLOCK_ON_VULNERABILITIES=true # Block deployment on policy violations
SECURITY_BLOCK_ON_SCAN_FAILURE=true    # Block if scan fails
SECURITY_DEFAULT_POLICY_ID=uuid        # Default policy to apply
TRIVY_VERSION=latest                   # Trivy scanner version
SECURITY_SCAN_TIMEOUT=300000           # Scan timeout in ms (5 minutes)
SECURITY_MAX_CRITICAL=0                # Max critical vulnerabilities allowed
SECURITY_MAX_HIGH=5                    # Max high vulnerabilities allowed
```

### Scanner Configuration

The security scanner can be configured in `config/index.ts`:

```typescript
security: {
  scanImages: true,
  blockOnVulnerabilities: true,
  blockOnScanFailure: true,
  defaultPolicyId: 'default-policy-uuid',
  trivyVersion: 'latest',
  scanTimeout: 300000,
  maxCriticalVulnerabilities: 0,
  maxHighVulnerabilities: 5
}
```

## Usage Examples

### 1. Scanning an Image Before Deployment

```typescript
// In ContainerOrchestratorV2
const scanResult = await securityScanner.scanImage({
  imageName: 'myapp',
  imageTag: 'v1.0.0',
  repository: 'my-repo',
  userId: user.id,
  username: user.username,
  policyId: config.security.defaultPolicyId
});

if (scanResult.summary.critical > 0) {
  throw new Error('Image contains critical vulnerabilities');
}
```

### 2. Creating a Custom Policy

```typescript
const policy = await securityScanner.upsertPolicy({
  name: 'Production Strict',
  description: 'Zero tolerance for vulnerabilities in production',
  blockOnCritical: true,
  blockOnHigh: true,
  maxCriticalVulnerabilities: 0,
  maxHighVulnerabilities: 0,
  maxMediumVulnerabilities: 0,
  trustedRegistries: ['ghcr.io'],
  enabled: true
});
```

### 3. Checking Policy Compliance

```typescript
const compliance = await securityScanner.checkPolicy(scanResult, policyId);

if (!compliance.passed) {
  console.error('Policy violations:', compliance.violations);
  // Handle policy failure
}
```

## Security Best Practices

### 1. Image Selection
- Use official base images from trusted registries
- Prefer minimal base images (alpine, distroless)
- Regularly update base images
- Pin specific versions instead of using 'latest'

### 2. Vulnerability Management
- Set up automated scanning in CI/CD pipeline
- Create policies appropriate for each environment
- Regularly review and update exemptions
- Monitor vulnerability trends

### 3. Policy Configuration
- Start with strict policies and relax as needed
- Different policies for dev/staging/production
- Document exemption reasons
- Set exemption expiration dates

### 4. Response to Vulnerabilities
- **Critical**: Stop deployment, fix immediately
- **High**: Fix within 7 days
- **Medium**: Fix within 30 days
- **Low**: Fix in next release cycle

## Monitoring and Alerts

### Events

The security scanner emits the following events:

- `scan:started`: Scan initiated
- `scan:completed`: Scan finished successfully
- `scan:failed`: Scan failed
- `policy:violated`: Policy check failed
- `vulnerability:critical`: Critical vulnerability detected

### Metrics

- Total scans performed
- Failed scans
- Average vulnerabilities per image
- Policy violation rate
- Most common vulnerabilities

### Audit Trail

All security operations are logged:

```json
{
  "eventType": "CONTAINER_CREATED",
  "category": "SECURITY",
  "severity": "WARNING",
  "action": "Security scan completed",
  "details": {
    "scanId": "uuid",
    "vulnerabilities": {
      "critical": 0,
      "high": 2
    }
  }
}
```

## Troubleshooting

### Common Issues

1. **Scan Timeout**
   - Increase `SECURITY_SCAN_TIMEOUT`
   - Check network connectivity
   - Verify Docker daemon access

2. **Trivy Not Found**
   - Scanner will auto-download Trivy Docker image
   - Ensure Docker is accessible
   - Check disk space for image storage

3. **Policy Violations**
   - Review scan results for details
   - Check policy configuration
   - Consider adding CVE exemptions

4. **Cache Issues**
   - Force scan with `force: true` parameter
   - Cache expires after 1 hour
   - Manual cache cleanup available

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug npm start
```

## Performance Considerations

### Scanning Performance
- First scan of an image may take 1-5 minutes
- Subsequent scans use cached vulnerability database
- Parallel scanning supported for multiple images

### Optimization Tips
1. Pre-scan base images during build
2. Use multi-stage builds to reduce attack surface
3. Implement image layer caching
4. Schedule periodic background scans

## Integration with CI/CD

### GitHub Actions Example

```yaml
- name: Scan Container Image
  run: |
    curl -X POST http://runnerhub.example.com/api/security/scan \
      -H "Authorization: Bearer ${{ secrets.RUNNERHUB_TOKEN }}" \
      -H "Content-Type: application/json" \
      -d '{
        "imageName": "${{ env.IMAGE_NAME }}",
        "imageTag": "${{ env.IMAGE_TAG }}",
        "policyId": "${{ env.SECURITY_POLICY_ID }}"
      }'
```

### Pre-deployment Hook

```javascript
// In deployment pipeline
async function preDeploymentCheck(image) {
  const scan = await securityScanner.scanImage({
    imageName: image.name,
    imageTag: image.tag,
    policyId: process.env.PRODUCTION_POLICY_ID
  });
  
  if (scan.summary.critical > 0 || scan.summary.high > 0) {
    throw new Error('Image fails security requirements');
  }
}
```

## Future Enhancements

1. **Additional Scanners**
   - Grype integration
   - Clair support
   - Custom scanner plugins

2. **Advanced Features**
   - SBOM (Software Bill of Materials) generation
   - License compliance checking
   - Secret scanning in images
   - Configuration compliance

3. **Automation**
   - Auto-remediation for known fixes
   - Automated PR creation for updates
   - Scheduled background scanning
   - Integration with dependency update tools