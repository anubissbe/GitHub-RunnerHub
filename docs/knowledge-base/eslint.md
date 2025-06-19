# ESLint - Code Linting

## Overview

ESLint is a static code analysis tool for identifying problematic patterns in JavaScript code. In GitHub RunnerHub, ESLint ensures code quality, consistency, and helps prevent common errors across the entire codebase.

## Official Resources

- **ESLint Official Site**: https://eslint.org/
- **Configuration Guide**: https://eslint.org/docs/latest/use/configure/
- **Rules Reference**: https://eslint.org/docs/latest/rules/
- **Shareable Configs**: https://eslint.org/docs/latest/extend/shareable-configs
- **TypeScript ESLint**: https://typescript-eslint.io/

## Integration with GitHub RunnerHub

### ESLint Configuration

```json
// .eslintrc.json
{
  "env": {
    "node": true,
    "es2022": true,
    "jest": true
  },
  "extends": [
    "eslint:recommended",
    "@typescript-eslint/recommended",
    "@typescript-eslint/recommended-requiring-type-checking",
    "prettier"
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module",
    "project": ["./tsconfig.json", "./backend/tsconfig.json", "./frontend/tsconfig.json"]
  },
  "plugins": [
    "@typescript-eslint",
    "import",
    "security",
    "promise",
    "node"
  ],
  "rules": {
    // TypeScript specific rules
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/prefer-nullish-coalescing": "error",
    "@typescript-eslint/prefer-optional-chain": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-misused-promises": "error",
    
    // Import rules
    "import/order": ["error", {
      "groups": [
        "builtin",
        "external",
        "internal",
        "parent",
        "sibling",
        "index"
      ],
      "newlines-between": "always",
      "alphabetize": {
        "order": "asc",
        "caseInsensitive": true
      }
    }],
    "import/no-unresolved": "error",
    "import/no-cycle": "error",
    "import/no-unused-modules": "warn",
    
    // Security rules
    "security/detect-object-injection": "warn",
    "security/detect-non-literal-regexp": "warn",
    "security/detect-unsafe-regex": "error",
    "security/detect-buffer-noassert": "error",
    "security/detect-child-process": "warn",
    "security/detect-disable-mustache-escape": "error",
    "security/detect-eval-with-expression": "error",
    "security/detect-no-csrf-before-method-override": "error",
    "security/detect-non-literal-fs-filename": "warn",
    "security/detect-non-literal-require": "warn",
    "security/detect-possible-timing-attacks": "warn",
    "security/detect-pseudoRandomBytes": "error",
    
    // Promise rules
    "promise/always-return": "error",
    "promise/catch-or-return": "error",
    "promise/param-names": "error",
    "promise/no-return-wrap": "error",
    "promise/no-nesting": "warn",
    "promise/no-promise-in-callback": "warn",
    "promise/no-callback-in-promise": "warn",
    "promise/avoid-new": "warn",
    
    // Node.js rules
    "node/no-unpublished-require": "off",
    "node/no-missing-import": "off", // TypeScript handles this
    "node/no-unsupported-features/es-syntax": "off",
    "node/callback-return": "error",
    "node/global-require": "error",
    "node/handle-callback-err": "error",
    "node/no-mixed-requires": "error",
    "node/no-new-require": "error",
    "node/no-path-concat": "error",
    "node/no-process-exit": "error",
    "node/no-sync": "warn",
    
    // General rules
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "no-debugger": "error",
    "no-alert": "error",
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "no-script-url": "error",
    "no-return-await": "error",
    "prefer-const": "error",
    "prefer-arrow-callback": "error",
    "arrow-spacing": "error",
    "no-var": "error",
    "object-shorthand": "error",
    "prefer-template": "error",
    "template-curly-spacing": "error",
    "yield-star-spacing": "error",
    "eqeqeq": ["error", "strict"],
    "no-throw-literal": "error",
    "prefer-promise-reject-errors": "error"
  },
  "overrides": [
    {
      "files": ["*.test.js", "*.test.ts", "*.spec.js", "*.spec.ts"],
      "env": {
        "jest": true
      },
      "rules": {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "security/detect-object-injection": "off"
      }
    },
    {
      "files": ["scripts/**/*.js", "scripts/**/*.ts"],
      "rules": {
        "no-console": "off",
        "node/no-process-exit": "off"
      }
    },
    {
      "files": ["frontend/**/*.ts", "frontend/**/*.tsx"],
      "env": {
        "browser": true,
        "node": false
      },
      "extends": [
        "plugin:react/recommended",
        "plugin:react-hooks/recommended"
      ],
      "rules": {
        "react/react-in-jsx-scope": "off",
        "react/prop-types": "off",
        "@typescript-eslint/no-non-null-assertion": "warn"
      }
    }
  ],
  "ignorePatterns": [
    "node_modules/",
    "dist/",
    "build/",
    "coverage/",
    "*.min.js",
    "vendor/"
  ]
}
```

### Package.json Scripts

```json
{
  "scripts": {
    "lint": "eslint . --ext .js,.ts,.tsx",
    "lint:fix": "eslint . --ext .js,.ts,.tsx --fix",
    "lint:check": "eslint . --ext .js,.ts,.tsx --max-warnings 0",
    "lint:staged": "lint-staged",
    "lint:ci": "eslint . --ext .js,.ts,.tsx --format json --output-file eslint-report.json"
  },
  "lint-staged": {
    "*.{js,ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ]
  }
}
```

### Custom ESLint Rules

```javascript
// eslint-rules/no-hardcoded-secrets.js
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hardcoded secrets and tokens',
      category: 'Security',
      recommended: true
    },
    fixable: null,
    schema: []
  },

  create(context) {
    const secretPatterns = [
      /ghp_[a-zA-Z0-9]{36}/, // GitHub Personal Access Token
      /gh[sus]_[A-Za-z0-9_]{36}/, // GitHub App tokens
      /sk-[a-zA-Z0-9]{48}/, // OpenAI API Key
      /AIza[0-9A-Za-z\\-_]{35}/, // Google API Key
      /AKIA[0-9A-Z]{16}/, // AWS Access Key
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, // UUIDs that might be secrets
      /(password|passwd|pwd|secret|token|key|auth).*[:=]\s*["'][^"']{8,}["']/i
    ];

    function checkForSecrets(node, value) {
      if (typeof value === 'string') {
        secretPatterns.forEach(pattern => {
          if (pattern.test(value)) {
            context.report({
              node,
              message: 'Hardcoded secret detected. Use environment variables or a secure vault instead.'
            });
          }
        });
      }
    }

    return {
      Literal(node) {
        checkForSecrets(node, node.value);
      },
      TemplateElement(node) {
        checkForSecrets(node, node.value.raw);
      }
    };
  }
};
```

### ESLint for Docker and CI/CD

```yaml
# .github/workflows/lint.yml
name: ESLint Check

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: [self-hosted, docker, runnerhub]
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run ESLint
        run: |
          npm run lint:check
          npm run lint:ci
      
      - name: Upload ESLint results
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: eslint-report
          path: eslint-report.json
      
      - name: Annotate PR with ESLint results
        uses: ataylorme/eslint-annotate-action@v2
        if: github.event_name == 'pull_request'
        with:
          repo-token: "${{ secrets.GITHUB_TOKEN }}"
          report-json: "eslint-report.json"
```

## Configuration Best Practices

### 1. Progressive Enhancement

```javascript
// .eslintrc.js with environment-based configuration
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  extends: [
    'eslint:recommended'
  ],
  
  // Override based on environment
  ...(process.env.NODE_ENV === 'production' && {
    rules: {
      'no-console': 'error',
      'no-debugger': 'error'
    }
  }),
  
  // Development-specific rules
  ...(process.env.NODE_ENV === 'development' && {
    rules: {
      'no-console': 'warn',
      'no-debugger': 'warn'
    }
  }),
  
  // Strict mode for CI
  ...(process.env.CI && {
    rules: {
      'max-warnings': 0
    }
  })
};
```

### 2. Project-Specific Rules

```javascript
// Custom configuration for GitHub RunnerHub
const runnerHubRules = {
  // Docker-related rules
  'no-process-exit': 'off', // Allow in container management
  'security/detect-child-process': 'warn', // Needed for Docker operations
  
  // API-specific rules
  'consistent-return': 'error', // Important for API endpoints
  'no-magic-numbers': ['warn', { ignore: [0, 1, 200, 201, 400, 401, 403, 404, 500] }],
  
  // Async/Promise rules
  'require-await': 'error',
  'no-return-await': 'error',
  'prefer-promise-reject-errors': 'error',
  
  // Security for runner management
  'security/detect-non-literal-require': 'error',
  'security/detect-eval-with-expression': 'error',
  
  // Performance rules
  'no-await-in-loop': 'warn',
  'prefer-const': 'error'
};

module.exports = {
  extends: ['./base-eslint-config.js'],
  rules: runnerHubRules,
  
  overrides: [
    {
      files: ['backend/routes/**/*.js'],
      rules: {
        // API endpoint specific rules
        'consistent-return': 'error',
        'no-implicit-coercion': 'error'
      }
    },
    {
      files: ['backend/services/docker-*.js'],
      rules: {
        // Docker service specific rules
        'security/detect-child-process': 'off',
        'node/no-sync': 'off'
      }
    }
  ]
};
```

### 3. Integration with VS Code

```json
// .vscode/settings.json
{
  "eslint.enable": true,
  "eslint.format.enable": true,
  "eslint.lintTask.enable": true,
  "eslint.run": "onType",
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
  ],
  "eslint.workingDirectories": [
    "./backend",
    "./frontend"
  ],
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.options": {
    "configFile": ".eslintrc.json"
  }
}
```

## Security Considerations

### 1. Security-Focused Rules

```javascript
// Enhanced security rules for RunnerHub
const securityRules = {
  // Prevent common security issues
  'security/detect-object-injection': 'error',
  'security/detect-non-literal-regexp': 'error',
  'security/detect-unsafe-regex': 'error',
  'security/detect-buffer-noassert': 'error',
  'security/detect-disable-mustache-escape': 'error',
  'security/detect-eval-with-expression': 'error',
  'security/detect-no-csrf-before-method-override': 'error',
  'security/detect-possible-timing-attacks': 'error',
  'security/detect-pseudoRandomBytes': 'error',
  
  // Custom security rules
  'no-hardcoded-secrets': 'error',
  'no-sql-injection': 'error',
  'validate-user-input': 'error'
};

// Custom rule for SQL injection prevention
const noSqlInjectionRule = {
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.property && 
            ['query', 'execute', 'raw'].includes(node.callee.property.name)) {
          
          const firstArg = node.arguments[0];
          if (firstArg && firstArg.type === 'TemplateLiteral') {
            const hasUserInput = firstArg.expressions.some(expr => 
              expr.type === 'MemberExpression' && 
              (expr.object.name === 'req' || expr.object.name === 'params')
            );
            
            if (hasUserInput) {
              context.report({
                node,
                message: 'Potential SQL injection. Use parameterized queries instead.'
              });
            }
          }
        }
      }
    };
  }
};
```

### 2. Secrets Detection

```javascript
// Advanced secrets detection
const secretsDetectionRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Detect various types of hardcoded secrets',
      category: 'Security'
    }
  },
  
  create(context) {
    const secretPatterns = new Map([
      ['github-token', /ghp_[a-zA-Z0-9]{36}/],
      ['github-app-token', /gh[sus]_[A-Za-z0-9_]{36}/],
      ['openai-key', /sk-[a-zA-Z0-9]{48}/],
      ['google-api-key', /AIza[0-9A-Za-z\\-_]{35}/],
      ['aws-access-key', /AKIA[0-9A-Z]{16}/],
      ['docker-token', /dckr_pat_[a-zA-Z0-9_-]{36}/],
      ['slack-token', /xox[baprs]-[0-9]{10,12}-[0-9]{10,12}-[a-zA-Z0-9]{24,32}/],
      ['private-key', /-----BEGIN [A-Z ]+PRIVATE KEY-----/],
      ['generic-secret', /(password|passwd|pwd|secret|token|key|auth).*[:=]\s*["'][^"']{8,}["']/i]
    ]);
    
    function detectSecrets(node, value, context) {
      if (typeof value !== 'string' || value.length < 8) return;
      
      for (const [type, pattern] of secretPatterns) {
        if (pattern.test(value)) {
          context.report({
            node,
            message: `Detected ${type}. Use environment variables or secure vault instead.`,
            data: { type }
          });
        }
      }
    }
    
    return {
      Literal(node) {
        detectSecrets(node, node.value, context);
      },
      TemplateElement(node) {
        detectSecrets(node, node.value.raw, context);
      }
    };
  }
};
```

## Monitoring and Reporting

### 1. ESLint Metrics Collection

```javascript
// scripts/eslint-metrics.js
const eslint = require('eslint');
const fs = require('fs');
const path = require('path');

class ESLintMetrics {
  constructor() {
    this.cli = new eslint.ESLint({
      configFile: '.eslintrc.json',
      extensions: ['.js', '.ts', '.tsx']
    });
  }

  async collectMetrics() {
    const results = await this.cli.lintFiles(['backend/**', 'frontend/**']);
    
    const metrics = {
      files: {
        total: results.length,
        withErrors: results.filter(r => r.errorCount > 0).length,
        withWarnings: results.filter(r => r.warningCount > 0).length
      },
      issues: {
        errors: results.reduce((sum, r) => sum + r.errorCount, 0),
        warnings: results.reduce((sum, r) => sum + r.warningCount, 0),
        fixable: results.reduce((sum, r) => sum + r.fixableErrorCount + r.fixableWarningCount, 0)
      },
      rules: this.analyzeRuleViolations(results),
      severity: this.calculateSeverityDistribution(results),
      timestamp: new Date().toISOString()
    };

    return metrics;
  }

  analyzeRuleViolations(results) {
    const ruleStats = new Map();
    
    results.forEach(result => {
      result.messages.forEach(message => {
        const rule = message.ruleId || 'unknown';
        const current = ruleStats.get(rule) || { count: 0, severity: message.severity };
        current.count++;
        ruleStats.set(rule, current);
      });
    });

    return Object.fromEntries(
      Array.from(ruleStats.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 20) // Top 20 violated rules
    );
  }

  calculateSeverityDistribution(results) {
    const distribution = { error: 0, warning: 0 };
    
    results.forEach(result => {
      result.messages.forEach(message => {
        if (message.severity === 2) distribution.error++;
        else if (message.severity === 1) distribution.warning++;
      });
    });

    return distribution;
  }

  async generateReport() {
    const metrics = await this.collectMetrics();
    const report = {
      summary: `ESLint Analysis: ${metrics.issues.errors} errors, ${metrics.issues.warnings} warnings across ${metrics.files.total} files`,
      metrics,
      recommendations: this.generateRecommendations(metrics)
    };

    // Save report
    fs.writeFileSync('eslint-metrics.json', JSON.stringify(report, null, 2));
    
    return report;
  }

  generateRecommendations(metrics) {
    const recommendations = [];
    
    if (metrics.issues.errors > 0) {
      recommendations.push('Fix all ESLint errors before deployment');
    }
    
    if (metrics.issues.fixable > metrics.issues.errors * 0.5) {
      recommendations.push('Run eslint --fix to automatically resolve many issues');
    }
    
    const topRule = Object.keys(metrics.rules)[0];
    if (topRule && metrics.rules[topRule].count > 10) {
      recommendations.push(`Consider reviewing the '${topRule}' rule - it's violated frequently`);
    }
    
    if (metrics.files.withErrors / metrics.files.total > 0.3) {
      recommendations.push('Consider gradual migration with ESLint overrides for legacy files');
    }
    
    return recommendations;
  }
}

// Usage
if (require.main === module) {
  const metrics = new ESLintMetrics();
  metrics.generateReport()
    .then(report => {
      console.log(report.summary);
      console.log('Recommendations:', report.recommendations);
    })
    .catch(console.error);
}
```

### 2. Dashboard Integration

```javascript
// API endpoint for ESLint metrics
app.get('/api/code-quality/eslint', authenticateJWT, async (req, res) => {
  try {
    const metricsCollector = new ESLintMetrics();
    const metrics = await metricsCollector.collectMetrics();
    
    res.json({
      data: metrics,
      status: metrics.issues.errors === 0 ? 'passing' : 'failing',
      grade: calculateCodeQualityGrade(metrics),
      trend: await getMetricsTrend(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function calculateCodeQualityGrade(metrics) {
  const totalIssues = metrics.issues.errors + metrics.issues.warnings;
  const filesWithIssues = metrics.files.withErrors + metrics.files.withWarnings;
  const issueRate = totalIssues / metrics.files.total;
  const cleanFileRate = (metrics.files.total - filesWithIssues) / metrics.files.total;
  
  if (metrics.issues.errors === 0 && issueRate < 0.1) return 'A';
  if (metrics.issues.errors < 5 && cleanFileRate > 0.8) return 'B';
  if (metrics.issues.errors < 20 && cleanFileRate > 0.6) return 'C';
  if (metrics.issues.errors < 50) return 'D';
  return 'F';
}
```

## Performance Optimization

### 1. ESLint Caching

```javascript
// .eslintrc.js with caching optimization
module.exports = {
  cache: true,
  cacheLocation: '.eslintcache',
  cacheStrategy: 'content', // Use file content for cache key
  
  // Optimize parser performance
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    // Only include project files that need type checking
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    createDefaultProgram: false // Disable for better performance
  },
  
  // Exclude unnecessary files
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    '*.min.js',
    'vendor/',
    'docs/',
    '*.d.ts'
  ]
};
```

### 2. Parallel Linting

```javascript
// scripts/parallel-lint.js
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { ESLint } = require('eslint');
const path = require('path');
const fs = require('fs');

if (isMainThread) {
  // Main thread - orchestrate parallel linting
  async function parallelLint() {
    const files = await getSourceFiles();
    const chunkSize = Math.ceil(files.length / 4); // 4 workers
    const chunks = [];
    
    for (let i = 0; i < files.length; i += chunkSize) {
      chunks.push(files.slice(i, i + chunkSize));
    }
    
    const workers = chunks.map(chunk => 
      new Worker(__filename, { workerData: { files: chunk } })
    );
    
    const results = await Promise.all(
      workers.map(worker => 
        new Promise((resolve, reject) => {
          worker.on('message', resolve);
          worker.on('error', reject);
          worker.on('exit', code => {
            if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
          });
        })
      )
    );
    
    // Combine results
    const combinedResults = results.flat();
    const totalErrors = combinedResults.reduce((sum, r) => sum + r.errorCount, 0);
    const totalWarnings = combinedResults.reduce((sum, r) => sum + r.warningCount, 0);
    
    console.log(`ESLint completed: ${totalErrors} errors, ${totalWarnings} warnings`);
    
    return combinedResults;
  }
  
  async function getSourceFiles() {
    // Implementation to get all source files
    const glob = require('glob');
    return glob.sync('**/*.{js,ts,tsx}', {
      ignore: ['node_modules/**', 'dist/**', 'build/**']
    });
  }
  
  parallelLint().catch(console.error);
  
} else {
  // Worker thread - lint assigned files
  async function lintFiles() {
    const { files } = workerData;
    const eslint = new ESLint();
    
    const results = await eslint.lintFiles(files);
    parentPort.postMessage(results);
  }
  
  lintFiles().catch(err => {
    console.error('Worker error:', err);
    process.exit(1);
  });
}
```

## Testing ESLint Configuration

```javascript
// tests/eslint-config.test.js
const { ESLint } = require('eslint');
const path = require('path');

describe('ESLint Configuration', () => {
  let eslint;
  
  beforeAll(() => {
    eslint = new ESLint({
      useEslintrc: true,
      baseConfig: require('../.eslintrc.json')
    });
  });

  test('should validate configuration', async () => {
    const code = `
      const test = "hello world";
      console.log(test);
    `;
    
    const results = await eslint.lintText(code, { filePath: 'test.js' });
    expect(results).toHaveLength(1);
    expect(results[0].messages).toBeDefined();
  });

  test('should catch security issues', async () => {
    const codeWithSecurityIssue = `
      const userInput = req.params.id;
      const query = \`SELECT * FROM users WHERE id = \${userInput}\`;
    `;
    
    const results = await eslint.lintText(codeWithSecurityIssue, { filePath: 'security-test.js' });
    const securityMessages = results[0].messages.filter(msg => 
      msg.ruleId && msg.ruleId.startsWith('security/')
    );
    
    expect(securityMessages.length).toBeGreaterThan(0);
  });

  test('should enforce TypeScript rules', async () => {
    const tsCode = `
      function test(param: any): void {
        return param;
      }
    `;
    
    const results = await eslint.lintText(tsCode, { filePath: 'test.ts' });
    const tsMessages = results[0].messages.filter(msg => 
      msg.ruleId && msg.ruleId.startsWith('@typescript-eslint/')
    );
    
    expect(tsMessages.length).toBeGreaterThan(0);
  });

  test('should allow test file patterns', async () => {
    const testCode = `
      describe('test', () => {
        test('should work', () => {
          expect(true).toBe(true);
        });
      });
    `;
    
    const results = await eslint.lintText(testCode, { filePath: 'example.test.js' });
    const errors = results[0].messages.filter(msg => msg.severity === 2);
    
    expect(errors).toHaveLength(0);
  });
});
```

## Related Technologies

- Prettier (code formatting)
- JSHint (alternative linter)
- TSLint (deprecated TypeScript linter)
- SonarJS (static code analysis)
- StandardJS (opinionated linter)