# Job Log Secret Scanning

## Overview

The GitHub-RunnerHub system includes a comprehensive secret scanning feature that automatically detects and redacts sensitive information from job logs. This feature helps protect against accidental exposure of credentials, API keys, and other sensitive data in CI/CD pipeline logs.

## Features

### 🔍 Automatic Detection
- **13+ Built-in Patterns**: Detects common secret types including GitHub tokens, AWS credentials, API keys, database URLs, JWT tokens, and more
- **Entropy Analysis**: Uses entropy calculations to identify high-randomness strings that may be secrets
- **Confidence Scoring**: Assigns confidence scores based on pattern complexity and characteristics
- **Context Awareness**: Considers surrounding text and log structure for better accuracy

### 🛡️ Smart Redaction
- **Configurable Redaction**: Multiple redaction strategies with preservable formatting
- **Pattern-Specific Redaction**: Different redaction patterns for different secret types
- **Whitelist Support**: Configure exceptions for known false positives
- **Line Preservation**: Maintains log structure and readability

### ⚙️ Configuration
- **Enable/Disable**: Toggle scanning on/off system-wide
- **Auto-Redaction**: Automatic redaction of detected secrets
- **Confidence Thresholds**: Adjustable confidence levels
- **Repository Whitelisting**: Exclude specific repositories from scanning
- **Custom Patterns**: Add organization-specific secret patterns

### 📊 Monitoring & Reporting
- **Scan Statistics**: Track scanning activity and secret detection rates
- **Audit Logging**: Complete audit trail of all scanning activities
- **Export Capabilities**: Export scan results in JSON or CSV format
- **Real-time Alerts**: Notifications when secrets are detected

## Secret Types Detected

| Category | Examples | Severity |
|----------|----------|----------|
| **GitHub Tokens** | `ghp_*`, `github_pat_*` | Critical |
| **AWS Credentials** | Access Keys, Secret Keys | Critical |
| **API Keys** | Generic API keys, Service keys | High |
| **Database URLs** | PostgreSQL, MySQL, MongoDB | High |
| **JWT Tokens** | JSON Web Tokens | High |
| **Cloud Keys** | Azure, GCP credentials | High |
| **Docker Tokens** | Registry tokens | Medium |
| **SSH Keys** | Private keys, certificates | Critical |

## API Endpoints

### Job Log Endpoints

#### Get Job Logs (with scanning)
```http
GET /api/jobs/{jobId}/logs?redacted=true&rescan=false
```

**Parameters:**
- `redacted` (boolean): Return redacted logs (default: true)
- `rescan` (boolean): Force rescan even if already scanned (default: false)

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "job-123",
    "logs": "[REDACTED LOG CONTENT]",
    "redactedLogs": "[REDACTED LOG CONTENT]",
    "scanned": true,
    "scanResult": {
      "id": "scan-456",
      "scanDate": "2023-12-01T10:00:00Z",
      "scanDuration": 150,
      "summary": {
        "totalSecrets": 2,
        "criticalSecrets": 1,
        "highSecrets": 1,
        "categoryCounts": {
          "token": 1,
          "api_key": 1
        }
      },
      "secretsDetected": true
    }
  }
}
```

#### Get Secret Scan Results
```http
GET /api/jobs/{jobId}/secret-scans
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "job-123",
    "scanResults": [
      {
        "id": "scan-456",
        "scanDate": "2023-12-01T10:00:00Z",
        "scanDuration": 150,
        "summary": {
          "totalSecrets": 2,
          "criticalSecrets": 1
        },
        "status": "completed"
      }
    ],
    "totalScans": 1,
    "lastScan": "2023-12-01T10:00:00Z"
  }
}
```

#### Trigger Manual Secret Scan
```http
POST /api/jobs/{jobId}/scan-secrets
```

**Request Body:**
```json
{
  "force": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "scanId": "scan-789",
    "jobId": "job-123",
    "summary": {
      "totalSecrets": 2,
      "criticalSecrets": 1,
      "highSecrets": 1
    },
    "scanDuration": 150,
    "secretsFound": true,
    "detectedSecrets": [
      {
        "id": "secret-1",
        "category": "token",
        "severity": "critical",
        "lineNumber": 5,
        "confidence": 0.95
      }
    ]
  }
}
```

### Configuration Endpoints

#### Get Scanner Configuration
```http
GET /api/security/secret-scanner/config
```

#### Update Scanner Configuration
```http
PUT /api/security/secret-scanner/config
```

**Request Body:**
```json
{
  "enabled": true,
  "autoRedact": true,
  "minimumEntropy": 3.0,
  "confidenceThreshold": 0.7,
  "notifyOnDetection": true,
  "blockJobOnSecrets": false
}
```

#### Add Custom Pattern
```http
POST /api/security/secret-scanner/patterns
```

**Request Body:**
```json
{
  "name": "Custom API Key",
  "description": "Organization-specific API key pattern",
  "regex": "myorg_[a-zA-Z0-9]{32}",
  "severity": "high",
  "category": "api_key",
  "entropy": 4.0,
  "enabled": true
}
```

#### Get Scanning Statistics
```http
GET /api/security/secret-scanner/stats?days=30
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalScans": 156,
    "secretsDetected": 23,
    "mostCommonSecrets": [
      { "category": "api_key", "count": 12 },
      { "category": "token", "count": 8 }
    ],
    "scansByDay": [
      { "date": "2023-12-01", "scans": 15, "secrets": 3 }
    ],
    "period": "30 days"
  }
}
```

#### Test Secret Pattern
```http
POST /api/security/secret-scanner/test-pattern
```

**Request Body:**
```json
{
  "regex": "api_key[=:]\\s*([a-zA-Z0-9]{32})",
  "testText": "Setting api_key=abcd1234567890abcd1234567890abcd",
  "regexFlags": "gi"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "matches": [
      {
        "index": 0,
        "match": "api_key=abcd1234567890abcd1234567890abcd",
        "position": 8,
        "groups": ["abcd1234567890abcd1234567890abcd"]
      }
    ],
    "matchCount": 1,
    "testPassed": true
  }
}
```

## Database Schema

### Tables Created

#### job_log_secret_scans
Stores scan results for job logs.

```sql
CREATE TABLE job_log_secret_scans (
    id UUID PRIMARY KEY,
    job_id VARCHAR(100) NOT NULL,
    scan_date TIMESTAMP WITH TIME ZONE,
    scan_duration INTEGER,
    detected_secrets JSONB,
    summary JSONB,
    status VARCHAR(20),
    error_message TEXT
);
```

#### secret_patterns
Stores custom secret detection patterns.

```sql
CREATE TABLE secret_patterns (
    id UUID PRIMARY KEY,
    name VARCHAR(255) UNIQUE,
    description TEXT,
    regex_pattern TEXT,
    regex_flags VARCHAR(10),
    minimum_entropy DECIMAL(4,2),
    enabled BOOLEAN,
    severity VARCHAR(20),
    category VARCHAR(50),
    redaction_pattern VARCHAR(255),
    whitelist_patterns JSONB
);
```

#### secret_scanner_config
Global configuration for the secret scanner.

```sql
CREATE TABLE secret_scanner_config (
    id VARCHAR(50) PRIMARY KEY,
    enabled BOOLEAN,
    auto_redact BOOLEAN,
    whitelist_repositories JSONB,
    minimum_entropy DECIMAL(4,2),
    confidence_threshold DECIMAL(3,2),
    preserve_formatting BOOLEAN,
    notify_on_detection BOOLEAN,
    block_job_on_secrets BOOLEAN
);
```

## Configuration Options

### Global Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | true | Enable/disable secret scanning |
| `autoRedact` | boolean | true | Automatically redact detected secrets |
| `minimumEntropy` | number | 3.0 | Minimum entropy threshold for detection |
| `confidenceThreshold` | number | 0.7 | Minimum confidence score for reporting |
| `preserveFormatting` | boolean | true | Maintain log formatting when redacting |
| `notifyOnDetection` | boolean | true | Send notifications when secrets are found |
| `blockJobOnSecrets` | boolean | false | Block job completion if secrets detected |

### Pattern Configuration

Custom patterns can be added with the following properties:

- **name**: Human-readable pattern name
- **description**: Pattern description
- **regex**: Regular expression for detection
- **severity**: critical, high, medium, low
- **category**: Secret category (api_key, token, etc.)
- **entropy**: Minimum entropy threshold
- **redactionPattern**: Custom redaction format
- **whitelistPatterns**: Regex patterns to exclude

## Integration

### Automatic Scanning

Secret scanning is automatically triggered when:

1. **Job logs are retrieved** via the API
2. **Job completion** (if configured)
3. **Manual trigger** via API request

### Audit Integration

All scanning activities are logged to the audit system with:

- Event type: `CONTAINER_CREATED` (for security events)
- Category: `SECURITY`
- Severity: Based on secrets found
- Details: Scan results and metadata

### Monitoring Integration

Scanning metrics are integrated with the monitoring system:

- Scan counts and durations
- Secret detection rates
- Failed scan alerts
- Performance metrics

## Security Considerations

### Data Protection
- **No Storage**: Raw secrets are never stored permanently
- **Redaction Only**: Only redacted logs are retained
- **Audit Trail**: Complete audit log of all scanning activities
- **Access Control**: Requires appropriate permissions to view scan results

### Performance
- **Efficient Patterns**: Optimized regex patterns for performance
- **Caching**: Scan results are cached to avoid re-scanning
- **Timeouts**: Configurable scan timeouts to prevent hanging
- **Rate Limiting**: Built-in rate limiting for scan requests

### False Positives
- **Whitelist Support**: Configure known false positives
- **Confidence Scoring**: Use confidence thresholds to reduce noise
- **Manual Review**: Manual verification capabilities
- **Pattern Tuning**: Ability to adjust and improve patterns

## Best Practices

### Pattern Development
1. **Test Thoroughly**: Use the pattern testing endpoint
2. **Start Conservative**: Begin with high confidence thresholds
3. **Monitor Results**: Review scan statistics regularly
4. **Iterative Improvement**: Refine patterns based on results

### Configuration
1. **Environment-Specific**: Different configs for dev/staging/prod
2. **Regular Review**: Periodically review and update settings
3. **Performance Monitoring**: Monitor scan performance and adjust timeouts
4. **Access Control**: Limit configuration access to administrators

### Response Procedures
1. **Immediate Action**: Rotate exposed credentials immediately
2. **Impact Assessment**: Determine scope of potential exposure
3. **Process Improvement**: Update CI/CD processes to prevent recurrence
4. **Team Training**: Educate teams on secure practices

## Troubleshooting

### Common Issues

#### High False Positive Rate
- Adjust confidence thresholds
- Add whitelist patterns for known safe strings
- Review and refine regex patterns

#### Performance Issues
- Increase scan timeouts
- Optimize regex patterns
- Enable caching if disabled

#### Missing Detections
- Lower confidence thresholds
- Add custom patterns for organization-specific secrets
- Review entropy settings

### Debug Information

Enable debug logging to troubleshoot scanning issues:

```javascript
// In logger configuration
logger.level = 'debug';
```

Debug logs include:
- Pattern matching details
- Entropy calculations
- Confidence scoring
- Performance metrics

## Future Enhancements

### Planned Features
- **Machine Learning**: ML-based secret detection
- **Integration APIs**: Third-party tool integrations
- **Advanced Analytics**: Trend analysis and reporting
- **Real-time Scanning**: Stream-based log scanning
- **Custom Notifications**: Webhook and email alerts

### Extension Points
- **Custom Redaction**: Plugin-based redaction strategies
- **Pattern Marketplace**: Shared pattern repository
- **External Validation**: Integration with secret management systems
- **Advanced Reporting**: Executive dashboards and reports