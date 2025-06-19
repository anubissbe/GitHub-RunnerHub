# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| 1.0.x   | :x:                |

## Reporting a Vulnerability

We take the security of GitHub RunnerHub seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### Please do not report security vulnerabilities through public GitHub issues.

Instead, please report them via email to **security@runnerhub.dev**.

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

Please include the requested information listed below (as much as you can provide) to help us better understand the nature and scope of the possible issue:

- Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit the issue

This information will help us triage your report more quickly.

## Preferred Languages

We prefer all communications to be in English.

## Policy

We follow the principle of [Responsible Disclosure](https://en.wikipedia.org/wiki/Responsible_disclosure).

## Security Measures

### Current Security Features

1. **Runner Isolation**
   - Each runner runs in its own Docker container
   - Containers have limited filesystem access
   - Network isolation between runners

2. **Token Security**
   - GitHub tokens are stored as environment variables
   - Tokens are never logged or exposed in UI
   - Registration tokens expire after use

3. **API Security**
   - CORS headers configured for known origins
   - Rate limiting on all endpoints
   - No authentication required for read-only endpoints

4. **Docker Security**
   - Runners use read-only filesystem mounts where possible
   - Docker socket access is limited
   - Regular security updates for base images

### Best Practices

1. **Token Management**
   - Use tokens with minimal required scopes
   - Rotate tokens regularly
   - Never commit tokens to version control

2. **Network Security**
   - Run RunnerHub behind a firewall
   - Use HTTPS for production deployments
   - Limit access to management ports

3. **Monitoring**
   - Monitor runner logs for suspicious activity
   - Set up alerts for failed authentication attempts
   - Regular security audits

## Security Updates

Security updates will be released as soon as possible after a vulnerability is confirmed. We will:

1. Release a patch version
2. Update the security advisory
3. Notify users through GitHub releases

## Contact

For any security-related questions, please contact security@runnerhub.dev.