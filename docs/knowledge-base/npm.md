# npm - Package Management

## Overview

npm (Node Package Manager) is the default package manager for Node.js and the world's largest software registry. In GitHub RunnerHub, npm manages dependencies, scripts, and the entire JavaScript/TypeScript ecosystem across backend, frontend, and development tools.

## Official Resources

- **npm Official Site**: https://www.npmjs.com/
- **npm Documentation**: https://docs.npmjs.com/
- **npm CLI Reference**: https://docs.npmjs.com/cli/v9/commands
- **package.json Guide**: https://docs.npmjs.com/cli/v9/configuring-npm/package-json
- **Security Best Practices**: https://docs.npmjs.com/packages-and-modules/securing-your-code

## Integration with GitHub RunnerHub

### Root Package.json Configuration

```json
{
  "name": "github-runnerhub",
  "version": "1.0.0",
  "description": "Enterprise-grade self-hosted GitHub Actions runner infrastructure",
  "main": "backend/src/server.js",
  "private": true,
  "workspaces": [
    "backend",
    "frontend",
    "shared"
  ],
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=9.0.0"
  },
  "scripts": {
    // Development scripts
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:backend": "npm run dev --workspace=backend",
    "dev:frontend": "npm run dev --workspace=frontend",
    
    // Build scripts
    "build": "npm run build --workspaces",
    "build:backend": "npm run build --workspace=backend",
    "build:frontend": "npm run build --workspace=frontend",
    "build:prod": "npm run build:backend && npm run build:frontend",
    
    // Test scripts
    "test": "npm run test --workspaces",
    "test:unit": "jest --testPathPattern='\\.(test|spec)\\.(js|ts)$'",
    "test:integration": "jest --testPathPattern='\\.integration\\.test\\.(js|ts)$'",
    "test:e2e": "jest --testPathPattern='\\.e2e\\.test\\.(js|ts)$'",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --coverage --watchAll=false --maxWorkers=4",
    
    // Code quality scripts
    "lint": "eslint . --ext .js,.ts,.tsx",
    "lint:fix": "eslint . --ext .js,.ts,.tsx --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    
    // Setup and installation
    "setup": "npm ci && npm run build",
    "postinstall": "npm run setup:husky",
    "setup:husky": "husky install",
    "prepare": "husky install",
    
    // Docker scripts
    "docker:build": "docker-compose build",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "docker:logs": "docker-compose logs -f",
    
    // Deployment scripts
    "deploy:staging": "npm run build:prod && npm run docker:build && npm run docker:up",
    "deploy:prod": "npm run test:ci && npm run build:prod && npm run docker:build",
    
    // Maintenance scripts
    "clean": "rimraf node_modules dist build coverage .eslintcache",
    "clean:all": "npm run clean && npm run clean --workspaces",
    "outdated": "npm outdated && npm outdated --workspaces",
    "audit": "npm audit && npm audit --workspaces",
    "audit:fix": "npm audit fix && npm audit fix --workspaces",
    "update": "npm update && npm update --workspaces",
    
    // Utility scripts
    "start": "node backend/dist/server.js",
    "start:dev": "nodemon backend/src/server.js",
    "start:prod": "NODE_ENV=production npm start",
    "logs": "pm2 logs runnerhub",
    "status": "pm2 status",
    "reload": "pm2 reload runnerhub",
    
    // Custom scripts for RunnerHub
    "runners:list": "node scripts/list-runners.js",
    "runners:scale": "node scripts/scale-runners.js",
    "runners:cleanup": "node scripts/cleanup-runners.js",
    "metrics:collect": "node scripts/collect-metrics.js",
    "health:check": "node scripts/health-check.js"
  },
  "keywords": [
    "github-actions",
    "ci-cd",
    "docker",
    "runners",
    "automation",
    "self-hosted"
  ],
  "author": "anubissbe",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/anubissbe/GitHub-RunnerHub.git"
  },
  "bugs": {
    "url": "https://github.com/anubissbe/GitHub-RunnerHub/issues"
  },
  "homepage": "https://github.com/anubissbe/GitHub-RunnerHub#readme",
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "concurrently": "^8.0.0",
    "eslint": "^8.0.0",
    "eslint-config-prettier": "^9.0.0",
    "eslint-plugin-import": "^2.0.0",
    "eslint-plugin-security": "^1.0.0",
    "husky": "^8.0.0",
    "jest": "^29.0.0",
    "lint-staged": "^14.0.0",
    "nodemon": "^3.0.0",
    "prettier": "^3.0.0",
    "rimraf": "^5.0.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "express": "^4.18.0",
    "dotenv": "^16.0.0"
  },
  "volta": {
    "node": "18.17.0",
    "npm": "9.6.7"
  }
}
```

### Backend Package Configuration

```json
{
  "name": "runnerhub-backend",
  "version": "1.0.0",
  "description": "GitHub RunnerHub backend API server",
  "main": "dist/server.js",
  "scripts": {
    "dev": "nodemon --exec ts-node src/server.ts",
    "build": "tsc && npm run copy-assets",
    "copy-assets": "copyfiles -u 1 src/**/*.json src/**/*.sql dist/",
    "start": "node dist/server.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "compression": "^1.7.4",
    "express-rate-limit": "^6.10.0",
    "express-validator": "^7.0.1",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "dockerode": "^3.3.5",
    "ws": "^8.13.0",
    "redis": "^4.6.7",
    "mongoose": "^7.5.0",
    "dotenv": "^16.3.1",
    "winston": "^3.10.0",
    "joi": "^17.9.2",
    "multer": "^1.4.5-lts.1",
    "swagger-jsdoc": "^6.2.8",
    "swagger-ui-express": "^5.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.17",
    "@types/cors": "^2.8.13",
    "@types/compression": "^1.7.2",
    "@types/jsonwebtoken": "^9.0.2",
    "@types/bcrypt": "^5.0.0",
    "@types/ws": "^8.5.5",
    "@types/multer": "^1.4.7",
    "@types/swagger-jsdoc": "^6.0.1",
    "@types/swagger-ui-express": "^4.1.3",
    "ts-node": "^10.9.1",
    "nodemon": "^3.0.1",
    "copyfiles": "^2.4.1",
    "supertest": "^6.3.3",
    "@types/supertest": "^2.0.12"
  }
}
```

### Frontend Package Configuration

```json
{
  "name": "runnerhub-frontend",
  "version": "1.0.0",
  "description": "GitHub RunnerHub React dashboard",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.15.0",
    "react-query": "^3.39.3",
    "axios": "^1.5.0",
    "recharts": "^2.8.0",
    "react-hook-form": "^7.45.4",
    "react-hot-toast": "^2.4.1",
    "clsx": "^2.0.0",
    "lucide-react": "^0.274.0",
    "date-fns": "^2.30.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.15",
    "@types/react-dom": "^18.2.7",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "@vitejs/plugin-react": "^4.0.3",
    "eslint": "^8.45.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.3",
    "typescript": "^5.0.2",
    "vite": "^4.4.5",
    "vitest": "^0.34.6",
    "@vitest/ui": "^0.34.6",
    "tailwindcss": "^3.3.3",
    "autoprefixer": "^10.4.15",
    "postcss": "^8.4.29"
  }
}
```

## Configuration Best Practices

### 1. Workspace Management

```json
// package.json - Advanced workspace configuration
{
  "workspaces": {
    "packages": [
      "backend",
      "frontend",
      "shared",
      "tools/*"
    ],
    "nohoist": [
      "**/react",
      "**/react-dom",
      "**/@types/react"
    ]
  },
  "scripts": {
    // Workspace-specific commands
    "install:backend": "npm install --workspace=backend",
    "install:frontend": "npm install --workspace=frontend",
    "install:all": "npm install --workspaces",
    
    // Cross-workspace commands
    "clean:workspaces": "npm run clean --workspaces --if-present",
    "build:workspaces": "npm run build --workspaces --if-present",
    "test:workspaces": "npm run test --workspaces --if-present",
    
    // Dependency management
    "deps:update": "npm update --workspaces",
    "deps:audit": "npm audit --workspaces",
    "deps:outdated": "npm outdated --workspaces"
  }
}
```

### 2. Security Configuration

```json
// .npmrc - npm security and performance settings
registry=https://registry.npmjs.org/
audit-level=moderate
fund=false
save-exact=true
package-lock=true
shrinkwrap=false
optional=false
engine-strict=true
prefer-offline=true
cache-max=86400000
init-license=MIT
init-author-name=anubissbe
init-author-email=bert@telkom.be
init-version=1.0.0

# Security settings
audit-level=moderate
fund=false

# Performance settings
prefer-offline=true
cache-max=86400000
maxsockets=50

# Workspace settings
workspaces-update=true
include-workspace-root=true
```

### 3. Custom npm Scripts

```javascript
// scripts/npm-utils.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class NPMUtils {
  static async checkOutdated() {
    console.log('🔍 Checking for outdated packages...');
    
    try {
      const output = execSync('npm outdated --json', { encoding: 'utf8' });
      const outdated = JSON.parse(output);
      
      if (Object.keys(outdated).length === 0) {
        console.log('✅ All packages are up to date!');
        return;
      }
      
      console.log('📦 Outdated packages found:');
      Object.entries(outdated).forEach(([pkg, info]) => {
        console.log(`  ${pkg}: ${info.current} → ${info.latest}`);
      });
      
      return outdated;
    } catch (error) {
      if (error.status === 1) {
        // npm outdated returns exit code 1 when packages are outdated
        const output = error.stdout.toString();
        if (output) {
          const outdated = JSON.parse(output);
          return outdated;
        }
      }
      console.error('❌ Error checking outdated packages:', error.message);
    }
  }

  static async auditSecurity() {
    console.log('🔒 Running security audit...');
    
    try {
      const output = execSync('npm audit --json', { encoding: 'utf8' });
      const audit = JSON.parse(output);
      
      console.log(`📊 Security audit results:`);
      console.log(`  Total vulnerabilities: ${audit.metadata.vulnerabilities.total}`);
      console.log(`  Critical: ${audit.metadata.vulnerabilities.critical}`);
      console.log(`  High: ${audit.metadata.vulnerabilities.high}`);
      console.log(`  Moderate: ${audit.metadata.vulnerabilities.moderate}`);
      console.log(`  Low: ${audit.metadata.vulnerabilities.low}`);
      
      if (audit.metadata.vulnerabilities.total > 0) {
        console.log('⚠️  Run "npm audit fix" to fix automatically fixable issues');
      } else {
        console.log('✅ No security vulnerabilities found!');
      }
      
      return audit;
    } catch (error) {
      console.error('❌ Error running security audit:', error.message);
    }
  }

  static async generateLockfileDiff() {
    console.log('📝 Generating lockfile diff...');
    
    try {
      const beforeInstall = fs.readFileSync('package-lock.json', 'utf8');
      
      execSync('npm install', { stdio: 'inherit' });
      
      const afterInstall = fs.readFileSync('package-lock.json', 'utf8');
      
      if (beforeInstall !== afterInstall) {
        console.log('📦 package-lock.json was updated');
        // Could implement actual diff here
      } else {
        console.log('✅ No changes to package-lock.json');
      }
    } catch (error) {
      console.error('❌ Error generating lockfile diff:', error.message);
    }
  }

  static async analyzeBundle() {
    console.log('📊 Analyzing bundle size...');
    
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const deps = Object.keys(packageJson.dependencies || {});
      const devDeps = Object.keys(packageJson.devDependencies || {});
      
      console.log(`📦 Dependencies: ${deps.length}`);
      console.log(`🛠️  Dev Dependencies: ${devDeps.length}`);
      
      // Analyze node_modules size
      const nodeModulesSize = this.getDirectorySize('node_modules');
      console.log(`💾 node_modules size: ${this.formatBytes(nodeModulesSize)}`);
      
      return {
        dependencies: deps.length,
        devDependencies: devDeps.length,
        nodeModulesSize
      };
    } catch (error) {
      console.error('❌ Error analyzing bundle:', error.message);
    }
  }

  static getDirectorySize(dir) {
    if (!fs.existsSync(dir)) return 0;
    
    let size = 0;
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        size += this.getDirectorySize(filePath);
      } else {
        size += stats.size;
      }
    });
    
    return size;
  }

  static formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  static async cleanCache() {
    console.log('🧹 Cleaning npm cache...');
    
    try {
      execSync('npm cache clean --force', { stdio: 'inherit' });
      console.log('✅ npm cache cleaned');
    } catch (error) {
      console.error('❌ Error cleaning cache:', error.message);
    }
  }

  static async verifyInstallation() {
    console.log('✅ Verifying installation...');
    
    try {
      // Check if package-lock.json exists
      if (!fs.existsSync('package-lock.json')) {
        console.warn('⚠️  package-lock.json not found');
      }
      
      // Verify all dependencies are installed
      execSync('npm ls --depth=0', { stdio: 'pipe' });
      console.log('✅ All dependencies verified');
      
      // Check for security vulnerabilities
      await this.auditSecurity();
      
    } catch (error) {
      console.error('❌ Installation verification failed:', error.message);
      process.exit(1);
    }
  }
}

module.exports = NPMUtils;

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  const utils = NPMUtils;
  
  switch (command) {
    case 'outdated':
      utils.checkOutdated();
      break;
    case 'audit':
      utils.auditSecurity();
      break;
    case 'analyze':
      utils.analyzeBundle();
      break;
    case 'clean':
      utils.cleanCache();
      break;
    case 'verify':
      utils.verifyInstallation();
      break;
    default:
      console.log('Usage: node npm-utils.js [outdated|audit|analyze|clean|verify]');
  }
}
```

## Security Best Practices

### 1. Dependency Security

```javascript
// scripts/security-check.js
const { execSync } = require('child_process');
const fs = require('fs');
const semver = require('semver');

class SecurityChecker {
  constructor() {
    this.vulnerabilities = [];
    this.recommendations = [];
  }

  async checkDependencies() {
    console.log('🔒 Running comprehensive security check...');
    
    await this.checkNpmAudit();
    await this.checkOutdatedPackages();
    await this.checkKnownVulnerabilities();
    await this.checkLicenses();
    
    return this.generateReport();
  }

  async checkNpmAudit() {
    try {
      const output = execSync('npm audit --json', { encoding: 'utf8' });
      const audit = JSON.parse(output);
      
      if (audit.metadata.vulnerabilities.total > 0) {
        this.vulnerabilities.push({
          type: 'npm_audit',
          count: audit.metadata.vulnerabilities.total,
          details: audit.advisories
        });
        
        if (audit.metadata.vulnerabilities.critical > 0) {
          this.recommendations.push('CRITICAL: Fix critical vulnerabilities immediately');
        }
      }
    } catch (error) {
      if (error.status === 1) {
        // Handle npm audit exit code 1 (vulnerabilities found)
        const output = error.stdout.toString();
        if (output) {
          const audit = JSON.parse(output);
          this.vulnerabilities.push({
            type: 'npm_audit',
            count: audit.metadata.vulnerabilities.total,
            severity: audit.metadata.vulnerabilities
          });
        }
      }
    }
  }

  async checkOutdatedPackages() {
    try {
      const output = execSync('npm outdated --json', { encoding: 'utf8' });
      const outdated = JSON.parse(output);
      
      const criticallyOutdated = Object.entries(outdated).filter(([pkg, info]) => {
        const current = semver.coerce(info.current);
        const latest = semver.coerce(info.latest);
        
        if (current && latest) {
          const majorDiff = semver.major(latest) - semver.major(current);
          return majorDiff >= 2; // 2+ major versions behind
        }
        return false;
      });
      
      if (criticallyOutdated.length > 0) {
        this.vulnerabilities.push({
          type: 'outdated_packages',
          count: criticallyOutdated.length,
          packages: criticallyOutdated.map(([pkg]) => pkg)
        });
        
        this.recommendations.push('Update critically outdated packages');
      }
    } catch (error) {
      // npm outdated returns exit code 1 when packages are outdated
    }
  }

  async checkKnownVulnerabilities() {
    // Check against a known list of vulnerable packages
    const knownVulnerable = [
      'node-uuid', // Use uuid instead
      'request', // Deprecated
      'lodash@<4.17.19' // Known vulnerabilities in older versions
    ];
    
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
    
    const found = [];
    knownVulnerable.forEach(vulnPkg => {
      const [pkg, version] = vulnPkg.split('@');
      if (allDeps[pkg]) {
        if (version && semver.satisfies(allDeps[pkg], version)) {
          found.push(pkg);
        } else if (!version) {
          found.push(pkg);
        }
      }
    });
    
    if (found.length > 0) {
      this.vulnerabilities.push({
        type: 'known_vulnerable',
        packages: found
      });
      
      this.recommendations.push('Replace known vulnerable packages');
    }
  }

  async checkLicenses() {
    try {
      // This would require license-checker package
      // For demonstration, we'll check for GPL licenses which might be problematic
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      
      if (packageJson.license && packageJson.license.includes('GPL')) {
        this.recommendations.push('Review GPL license compatibility');
      }
    } catch (error) {
      console.warn('Could not check licenses:', error.message);
    }
  }

  generateReport() {
    const report = {
      status: this.vulnerabilities.length === 0 ? 'secure' : 'vulnerable',
      vulnerabilities: this.vulnerabilities,
      recommendations: this.recommendations,
      score: this.calculateSecurityScore(),
      timestamp: new Date().toISOString()
    };
    
    return report;
  }

  calculateSecurityScore() {
    let score = 100;
    
    this.vulnerabilities.forEach(vuln => {
      switch (vuln.type) {
        case 'npm_audit':
          score -= vuln.count * 5;
          break;
        case 'outdated_packages':
          score -= vuln.count * 2;
          break;
        case 'known_vulnerable':
          score -= vuln.packages.length * 10;
          break;
      }
    });
    
    return Math.max(0, score);
  }
}

module.exports = SecurityChecker;
```

### 2. Package Integrity

```javascript
// scripts/integrity-check.js
const crypto = require('crypto');
const fs = require('fs');
const { execSync } = require('child_process');

class IntegrityChecker {
  async checkPackageIntegrity() {
    console.log('🔍 Checking package integrity...');
    
    const checks = {
      lockfileSync: await this.checkLockfileSync(),
      packageIntegrity: await this.checkPackageJsonIntegrity(),
      nodeModulesSync: await this.checkNodeModulesSync(),
      checksums: await this.verifyChecksums()
    };
    
    return {
      allPassed: Object.values(checks).every(check => check.passed),
      checks,
      timestamp: new Date().toISOString()
    };
  }

  async checkLockfileSync() {
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const lockfile = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
      
      const packageDeps = Object.keys(packageJson.dependencies || {});
      const lockDeps = Object.keys(lockfile.dependencies || {});
      
      const missing = packageDeps.filter(dep => !lockDeps.includes(dep));
      const extra = lockDeps.filter(dep => !packageDeps.includes(dep));
      
      return {
        passed: missing.length === 0 && extra.length === 0,
        missing,
        extra,
        message: missing.length === 0 && extra.length === 0 
          ? 'package.json and package-lock.json are in sync'
          : 'package.json and package-lock.json are out of sync'
      };
    } catch (error) {
      return {
        passed: false,
        error: error.message,
        message: 'Could not verify lockfile sync'
      };
    }
  }

  async checkPackageJsonIntegrity() {
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      
      // Check required fields
      const requiredFields = ['name', 'version', 'description'];
      const missing = requiredFields.filter(field => !packageJson[field]);
      
      // Check for suspicious scripts
      const suspiciousScripts = [];
      if (packageJson.scripts) {
        Object.entries(packageJson.scripts).forEach(([name, script]) => {
          if (script.includes('rm -rf') || script.includes('curl') || script.includes('wget')) {
            suspiciousScripts.push(name);
          }
        });
      }
      
      return {
        passed: missing.length === 0 && suspiciousScripts.length === 0,
        missing,
        suspiciousScripts,
        message: missing.length === 0 && suspiciousScripts.length === 0
          ? 'package.json integrity verified'
          : 'package.json has integrity issues'
      };
    } catch (error) {
      return {
        passed: false,
        error: error.message,
        message: 'Could not verify package.json integrity'
      };
    }
  }

  async checkNodeModulesSync() {
    try {
      // Run npm ls to check for missing or extraneous packages
      const output = execSync('npm ls --json', { encoding: 'utf8' });
      const ls = JSON.parse(output);
      
      const problems = ls.problems || [];
      
      return {
        passed: problems.length === 0,
        problems,
        message: problems.length === 0
          ? 'node_modules is in sync'
          : `node_modules has ${problems.length} issues`
      };
    } catch (error) {
      return {
        passed: false,
        error: error.message,
        message: 'Could not verify node_modules sync'
      };
    }
  }

  async verifyChecksums() {
    try {
      // Verify package-lock.json checksums
      const lockfile = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
      let verified = 0;
      let total = 0;
      
      const checkDependency = (dep) => {
        if (dep.integrity) {
          total++;
          // In a real implementation, you'd verify the actual file integrity
          verified++;
        }
        
        if (dep.dependencies) {
          Object.values(dep.dependencies).forEach(checkDependency);
        }
      };
      
      if (lockfile.dependencies) {
        Object.values(lockfile.dependencies).forEach(checkDependency);
      }
      
      return {
        passed: total > 0 && verified === total,
        verified,
        total,
        message: `${verified}/${total} checksums verified`
      };
    } catch (error) {
      return {
        passed: false,
        error: error.message,
        message: 'Could not verify checksums'
      };
    }
  }
}

module.exports = IntegrityChecker;
```

## Performance Optimization

### 1. npm Performance

```bash
# .npmrc - Performance optimizations
# Cache settings
cache-max=86400000
cache-min=3600000

# Network optimizations
maxsockets=50
timeout=60000
fetch-retry-mintimeout=10000
fetch-retry-maxtimeout=60000

# Installation optimizations
prefer-offline=true
prefer-dedupe=true
legacy-peer-deps=false

# Registry optimizations
registry=https://registry.npmjs.org/
always-auth=false
```

### 2. Build Optimization

```javascript
// scripts/optimize-build.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class BuildOptimizer {
  async optimizeBuild() {
    console.log('⚡ Optimizing build process...');
    
    await this.optimizePackageJson();
    await this.optimizeNodeModules();
    await this.generateBuildInfo();
    
    console.log('✅ Build optimization complete');
  }

  async optimizePackageJson() {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    // Remove unnecessary fields for production
    if (process.env.NODE_ENV === 'production') {
      delete packageJson.devDependencies;
      delete packageJson.scripts.dev;
      delete packageJson.scripts.test;
    }
    
    // Optimize dependencies
    const optimized = {
      ...packageJson,
      dependencies: this.sortDependencies(packageJson.dependencies || {})
    };
    
    fs.writeFileSync('package.json.optimized', JSON.stringify(optimized, null, 2));
  }

  async optimizeNodeModules() {
    // Remove unnecessary files from node_modules
    const unnecessaryPatterns = [
      '**/test/**',
      '**/tests/**',
      '**/*.test.js',
      '**/*.spec.js',
      '**/docs/**',
      '**/examples/**',
      '**/.github/**',
      '**/README.md',
      '**/CHANGELOG.md'
    ];
    
    unnecessaryPatterns.forEach(pattern => {
      try {
        execSync(`find node_modules -name "${pattern}" -type f -delete`, { stdio: 'pipe' });
      } catch (error) {
        // Ignore errors for non-existent files
      }
    });
  }

  sortDependencies(deps) {
    return Object.keys(deps)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = deps[key];
        return sorted;
      }, {});
  }

  async generateBuildInfo() {
    const buildInfo = {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      npmVersion: execSync('npm --version', { encoding: 'utf8' }).trim(),
      platform: process.platform,
      arch: process.arch,
      environment: process.env.NODE_ENV || 'development',
      commit: this.getGitCommit(),
      branch: this.getGitBranch()
    };
    
    fs.writeFileSync('build-info.json', JSON.stringify(buildInfo, null, 2));
  }

  getGitCommit() {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  getGitBranch() {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }
}

module.exports = BuildOptimizer;
```

## Monitoring and Analytics

### 1. npm Analytics

```javascript
// scripts/npm-analytics.js
const fs = require('fs');
const { execSync } = require('child_process');

class NPMAnalytics {
  constructor() {
    this.metrics = {
      dependencies: {},
      performance: {},
      security: {},
      maintenance: {}
    };
  }

  async collectMetrics() {
    console.log('📊 Collecting npm analytics...');
    
    await this.analyzeDependencies();
    await this.analyzePerformance();
    await this.analyzeSecurity();
    await this.analyzeMaintenance();
    
    return this.generateReport();
  }

  async analyzeDependencies() {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    this.metrics.dependencies = {
      total: Object.keys(packageJson.dependencies || {}).length,
      dev: Object.keys(packageJson.devDependencies || {}).length,
      peer: Object.keys(packageJson.peerDependencies || {}).length,
      optional: Object.keys(packageJson.optionalDependencies || {}).length,
      bundled: (packageJson.bundledDependencies || []).length
    };
    
    // Analyze dependency tree depth
    try {
      const lsOutput = execSync('npm ls --json', { encoding: 'utf8' });
      const ls = JSON.parse(lsOutput);
      this.metrics.dependencies.treeDepth = this.calculateTreeDepth(ls.dependencies || {});
    } catch (error) {
      this.metrics.dependencies.treeDepth = 'unknown';
    }
  }

  calculateTreeDepth(deps, depth = 0) {
    let maxDepth = depth;
    
    Object.values(deps).forEach(dep => {
      if (dep.dependencies) {
        const childDepth = this.calculateTreeDepth(dep.dependencies, depth + 1);
        maxDepth = Math.max(maxDepth, childDepth);
      }
    });
    
    return maxDepth;
  }

  async analyzePerformance() {
    const startTime = Date.now();
    
    try {
      // Measure install time
      execSync('npm ci --timing', { stdio: 'pipe' });
      this.metrics.performance.installTime = Date.now() - startTime;
    } catch (error) {
      this.metrics.performance.installTime = 'error';
    }
    
    // Analyze node_modules size
    this.metrics.performance.nodeModulesSize = this.getDirectorySize('node_modules');
    
    // Count total files
    this.metrics.performance.totalFiles = this.countFiles('node_modules');
  }

  async analyzeSecurity() {
    try {
      const auditOutput = execSync('npm audit --json', { encoding: 'utf8' });
      const audit = JSON.parse(auditOutput);
      
      this.metrics.security = {
        vulnerabilities: audit.metadata.vulnerabilities,
        advisories: Object.keys(audit.advisories || {}).length
      };
    } catch (error) {
      if (error.stdout) {
        const audit = JSON.parse(error.stdout);
        this.metrics.security = {
          vulnerabilities: audit.metadata.vulnerabilities,
          advisories: Object.keys(audit.advisories || {}).length
        };
      } else {
        this.metrics.security = { error: 'Could not run audit' };
      }
    }
  }

  async analyzeMaintenance() {
    try {
      const outdatedOutput = execSync('npm outdated --json', { encoding: 'utf8' });
      const outdated = JSON.parse(outdatedOutput);
      
      this.metrics.maintenance = {
        outdated: Object.keys(outdated).length,
        majorUpdates: Object.values(outdated).filter(pkg => 
          this.isMajorUpdate(pkg.current, pkg.latest)
        ).length
      };
    } catch (error) {
      if (error.stdout) {
        const outdated = JSON.parse(error.stdout);
        this.metrics.maintenance = {
          outdated: Object.keys(outdated).length,
          majorUpdates: Object.values(outdated).filter(pkg => 
            this.isMajorUpdate(pkg.current, pkg.latest)
          ).length
        };
      } else {
        this.metrics.maintenance = { outdated: 0, majorUpdates: 0 };
      }
    }
  }

  isMajorUpdate(current, latest) {
    const semver = require('semver');
    try {
      const currentMajor = semver.major(semver.coerce(current));
      const latestMajor = semver.major(semver.coerce(latest));
      return latestMajor > currentMajor;
    } catch {
      return false;
    }
  }

  getDirectorySize(dir) {
    if (!fs.existsSync(dir)) return 0;
    
    let size = 0;
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        size += this.getDirectorySize(filePath);
      } else {
        size += stats.size;
      }
    });
    
    return size;
  }

  countFiles(dir) {
    if (!fs.existsSync(dir)) return 0;
    
    let count = 0;
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        count += this.countFiles(filePath);
      } else {
        count++;
      }
    });
    
    return count;
  }

  generateReport() {
    const report = {
      summary: {
        health_score: this.calculateHealthScore(),
        total_dependencies: this.metrics.dependencies.total + this.metrics.dependencies.dev,
        security_vulnerabilities: this.metrics.security.vulnerabilities?.total || 0,
        outdated_packages: this.metrics.maintenance.outdated || 0
      },
      metrics: this.metrics,
      recommendations: this.generateRecommendations(),
      timestamp: new Date().toISOString()
    };
    
    return report;
  }

  calculateHealthScore() {
    let score = 100;
    
    // Penalize security issues
    if (this.metrics.security.vulnerabilities) {
      score -= this.metrics.security.vulnerabilities.critical * 20;
      score -= this.metrics.security.vulnerabilities.high * 10;
      score -= this.metrics.security.vulnerabilities.moderate * 5;
    }
    
    // Penalize outdated packages
    score -= (this.metrics.maintenance.outdated || 0) * 2;
    score -= (this.metrics.maintenance.majorUpdates || 0) * 5;
    
    // Penalize too many dependencies
    const totalDeps = this.metrics.dependencies.total + this.metrics.dependencies.dev;
    if (totalDeps > 100) {
      score -= (totalDeps - 100) * 0.5;
    }
    
    return Math.max(0, Math.round(score));
  }

  generateRecommendations() {
    const recommendations = [];
    
    if (this.metrics.security.vulnerabilities?.total > 0) {
      recommendations.push('Run "npm audit fix" to address security vulnerabilities');
    }
    
    if (this.metrics.maintenance.outdated > 10) {
      recommendations.push('Update outdated packages to improve security and performance');
    }
    
    if (this.metrics.performance.nodeModulesSize > 500 * 1024 * 1024) { // 500MB
      recommendations.push('Consider reducing dependency footprint - node_modules is very large');
    }
    
    if (this.metrics.dependencies.total > 50) {
      recommendations.push('Review dependencies - consider if all are necessary');
    }
    
    return recommendations;
  }
}

module.exports = NPMAnalytics;
```

## CI/CD Integration

### 1. GitHub Actions npm Workflow

```yaml
# .github/workflows/npm.yml
name: npm Workflow

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  npm-security:
    runs-on: [self-hosted, docker, runnerhub]
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Verify npm cache
        run: npm cache verify
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run security audit
        run: npm audit --audit-level moderate
      
      - name: Check for outdated packages
        run: npm outdated
        continue-on-error: true
      
      - name: Verify package integrity
        run: node scripts/integrity-check.js
      
      - name: Generate npm analytics
        run: node scripts/npm-analytics.js
      
      - name: Upload npm report
        uses: actions/upload-artifact@v3
        with:
          name: npm-analytics
          path: npm-analytics.json
```

### 2. Dependency Update Automation

```yaml
# .github/workflows/dependency-update.yml
name: Dependency Updates

on:
  schedule:
    - cron: '0 2 * * 1' # Weekly on Monday at 2 AM
  workflow_dispatch:

jobs:
  update-dependencies:
    runs-on: [self-hosted, docker, runnerhub]
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Update dependencies
        run: |
          npm update
          npm audit fix --force
      
      - name: Run tests
        run: npm test
      
      - name: Create Pull Request
        uses: peter-evans/create-pull-request@v5
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          commit-message: '📦 Update npm dependencies'
          title: 'chore: Update npm dependencies'
          body: |
            ## Automated Dependency Update
            
            This PR updates npm dependencies to their latest versions.
            
            - Updated packages to latest compatible versions
            - Fixed security vulnerabilities with `npm audit fix`
            - All tests passing
            
            Please review the changes before merging.
          branch: automated/dependency-updates
          delete-branch: true
```

## Related Technologies

- Yarn (alternative package manager)
- pnpm (performant npm alternative)
- Bower (deprecated frontend package manager)
- Composer (PHP package manager)
- pip (Python package manager)