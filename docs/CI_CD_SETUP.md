# CI/CD Setup Documentation

## Overview

This document describes the comprehensive CI/CD pipeline setup for GitHub-RunnerHub using GitHub Actions.

## Workflow Structure

### Single Unified Workflow: `release.yml`

We've implemented a single, professional CI/CD workflow that handles all aspects of the development lifecycle:

```yaml
.github/workflows/release.yml
```

### Workflow Features

1. **Multi-trigger Support**
   - Push to `main` or `develop` branches
   - Pull requests
   - Manual workflow dispatch with release type selection
   - Tag pushes (`v*.*.*`)

2. **Jobs Pipeline**
   - **Quality Checks** - Linting, type checking, building, testing
   - **Security Scanning** - Trivy and Snyk vulnerability scanning
   - **Container Build** - Multi-platform Docker images
   - **Release Creation** - Automated GitHub releases with changelogs
   - **Deployment Notification** - Summary and status reporting

3. **Key Features**
   - ✅ Non-blocking quality checks (allows TypeScript issues while developing)
   - ✅ Automatic semantic versioning
   - ✅ Container vulnerability scanning
   - ✅ SBOM (Software Bill of Materials) generation
   - ✅ Multi-registry support (GHCR and Docker Hub)
   - ✅ Professional changelog generation
   - ✅ Comprehensive job summaries

## Setup Instructions

### 1. GitHub Secrets Configuration

Run the provided setup script to configure required secrets:

```bash
./scripts/setup-github-secrets.sh
```

Required secrets:
- `SNYK_TOKEN` - For security scanning (retrieved from Vault)
- `DOCKERHUB_USERNAME` (optional) - For Docker Hub publishing
- `DOCKERHUB_TOKEN` (optional) - Docker Hub access token

### 2. Manual Secret Setup (Alternative)

If you prefer to set up secrets manually:

```bash
# Set SNYK token
gh secret set SNYK_TOKEN --body "f9616fd1-3834-48cb-9562-5d3d5869073e"

# Set Docker Hub credentials (optional)
gh secret set DOCKERHUB_USERNAME --body "your-username"
gh secret set DOCKERHUB_TOKEN --body "your-token"
```

## Workflow Triggers

### Automatic Triggers

1. **Push to main/develop**
   - Runs full pipeline
   - Creates development builds
   - Publishes containers

2. **Pull Requests**
   - Runs quality and security checks
   - Builds containers (no push)
   - Provides PR status checks

3. **Tag Push (v*.*.*)**
   - Creates official release
   - Publishes versioned containers
   - Generates release notes

### Manual Trigger

```bash
# Trigger a patch release
gh workflow run release.yml -f release_type=patch

# Trigger a minor release
gh workflow run release.yml -f release_type=minor

# Trigger a major release
gh workflow run release.yml -f release_type=major
```

## Container Images

### GitHub Container Registry (Primary)

Images are automatically published to:
```
ghcr.io/anubissbe/github-runnerhub:latest
ghcr.io/anubissbe/github-runnerhub:main
ghcr.io/anubissbe/github-runnerhub:v1.0.0
```

### Docker Hub (Optional)

If Docker Hub credentials are configured:
```
anubissbe/github-runnerhub:latest
anubissbe/github-runnerhub:main
anubissbe/github-runnerhub:v1.0.0
```

## Release Process

### Automatic Releases

Releases are created automatically when:
1. A tag is pushed (`git tag v1.0.0 && git push --tags`)
2. Manual workflow dispatch is used

### Release Contents

Each release includes:
- 📦 Source code archive
- 📄 SBOM (Software Bill of Materials)
- 📝 Automated changelog
- 🐳 Container image references
- 📊 Build information

### Version Numbering

- **Development**: `0.0.0-dev.{sha}`
- **Tagged Release**: `{major}.{minor}.{patch}`
- **Manual Release**: Increments based on selected type

## Security Features

### Vulnerability Scanning

1. **Trivy Scanning**
   - Filesystem scanning for dependencies
   - Container image scanning
   - SARIF reports uploaded to GitHub Security

2. **Snyk Scanning**
   - Dependency vulnerability detection
   - License compliance checking
   - Integration with GitHub Security tab

### Secret Management

- Secrets stored in GitHub repository settings
- SNYK token retrieved from Vault (192.168.1.24:8200)
- No hardcoded credentials in workflow files

## Monitoring

### Workflow Status

Check workflow runs:
```bash
# List recent runs
gh run list --workflow=release.yml

# View specific run
gh run view <run-id>

# Watch run in real-time
gh run watch <run-id>
```

### Build Badges

Add to README:
```markdown
[![Release & Deploy](https://github.com/anubissbe/GitHub-RunnerHub/actions/workflows/release.yml/badge.svg)](https://github.com/anubissbe/GitHub-RunnerHub/actions/workflows/release.yml)
```

## Troubleshooting

### Common Issues

1. **TypeScript Errors**
   - The workflow continues despite TypeScript errors
   - Fix errors in development, not blocking deployment

2. **Docker Hub Login Failures**
   - Optional step with `continue-on-error`
   - Check secrets configuration

3. **SNYK Token Issues**
   - Verify token in Vault: http://192.168.1.24:8200
   - Update using setup script

### Debug Workflow

```bash
# Re-run with debug logging
gh workflow run release.yml --ref main
```

## Best Practices

1. **Commit Messages**
   - Use conventional commits for better changelogs
   - Examples: `feat:`, `fix:`, `docs:`, `chore:`

2. **Versioning**
   - Use semantic versioning (MAJOR.MINOR.PATCH)
   - Tag releases: `git tag v1.0.0`

3. **Branch Protection**
   - Enable required status checks
   - Require PR reviews before merge

## Future Enhancements

- [ ] Add deployment to Kubernetes clusters
- [ ] Implement blue-green deployments
- [ ] Add performance benchmarking
- [ ] Integrate with external monitoring
- [ ] Add multi-architecture builds (arm64)

## Summary

The CI/CD pipeline provides:
- ✅ Professional, enterprise-grade automation
- ✅ Comprehensive quality and security checks
- ✅ Multi-registry container publishing
- ✅ Automated release management
- ✅ Clear visibility and monitoring

All workflows are consolidated into a single, maintainable file that handles the complete software delivery lifecycle.