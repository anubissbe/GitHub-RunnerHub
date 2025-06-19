# Prettier - Code Formatting

## Overview

Prettier is an opinionated code formatter that enforces consistent code style across the GitHub RunnerHub project. It automatically formats code according to predefined rules, eliminating debates about code style and ensuring consistency across team contributions.

## Official Resources

- **Prettier Official Site**: https://prettier.io/
- **Configuration Guide**: https://prettier.io/docs/en/configuration.html
- **Options Reference**: https://prettier.io/docs/en/options.html
- **Editor Integration**: https://prettier.io/docs/en/editors.html
- **Prettier with ESLint**: https://prettier.io/docs/en/integrating-with-linters.html

## Integration with GitHub RunnerHub

### Prettier Configuration

```json
// .prettierrc.json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "quoteProps": "as-needed",
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "avoid",
  "endOfLine": "lf",
  "embeddedLanguageFormatting": "auto",
  "htmlWhitespaceSensitivity": "css",
  "insertPragma": false,
  "jsxSingleQuote": true,
  "proseWrap": "preserve",
  "requirePragma": false,
  "overrides": [
    {
      "files": "*.json",
      "options": {
        "printWidth": 80,
        "tabWidth": 2
      }
    },
    {
      "files": "*.md",
      "options": {
        "printWidth": 80,
        "proseWrap": "always",
        "tabWidth": 2
      }
    },
    {
      "files": "*.yml",
      "options": {
        "tabWidth": 2,
        "singleQuote": false
      }
    },
    {
      "files": ["*.ts", "*.tsx"],
      "options": {
        "parser": "typescript",
        "printWidth": 100,
        "semi": true,
        "singleQuote": true,
        "trailingComma": "es5"
      }
    },
    {
      "files": "*.sql",
      "options": {
        "parser": "sql",
        "printWidth": 120,
        "tabWidth": 2,
        "keywordCase": "upper",
        "identifierCase": "lower"
      }
    }
  ]
}
```

### Prettier Ignore File

```bash
# .prettierignore
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
dist/
build/
coverage/
*.tsbuildinfo

# Generated files
*.min.js
*.min.css
*.bundle.js
*.bundle.css

# Configuration files that should maintain specific formatting
.env
.env.local
.env.production
.env.test

# Docker files
Dockerfile*
docker-compose*.yml

# Documentation
CHANGELOG.md
LICENSE

# Vendor files
vendor/
third-party/

# IDE files
.vscode/
.idea/

# Git files
.gitignore
.gitmodules

# CI/CD files that have strict formatting requirements
.github/workflows/*.yml

# Database files
*.sql.backup
*.db
*.sqlite

# Logs
logs/
*.log

# Temporary files
tmp/
temp/
.cache/

# OS generated files
.DS_Store
Thumbs.db

# Prettier itself
.prettierrc*
```

### Package.json Scripts

```json
{
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "format:staged": "lint-staged",
    "format:backend": "prettier --write 'backend/**/*.{js,ts,json}'",
    "format:frontend": "prettier --write 'frontend/**/*.{js,ts,tsx,json,css,scss}'",
    "format:docs": "prettier --write '**/*.md'",
    "format:config": "prettier --write '*.{json,yml,yaml}'",
    "format:ci": "prettier --check . --write=false"
  },
  "lint-staged": {
    "*.{js,ts,tsx,json,css,scss,md}": [
      "prettier --write"
    ],
    "*.{js,ts,tsx}": [
      "eslint --fix"
    ]
  }
}
```

## Configuration Best Practices

### 1. Team Consistency Rules

```javascript
// prettier.config.js - More advanced configuration
module.exports = {
  // Core formatting options
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'es5',
  
  // Layout options
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  
  // Bracket and parentheses formatting
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'avoid',
  
  // Line ending and pragma options
  endOfLine: 'lf',
  insertPragma: false,
  requirePragma: false,
  
  // Language-specific overrides
  overrides: [
    // TypeScript/JavaScript
    {
      files: ['*.ts', '*.tsx', '*.js', '*.jsx'],
      options: {
        parser: 'typescript',
        singleQuote: true,
        semi: true,
        trailingComma: 'es5',
        printWidth: 100
      }
    },
    
    // JSON configuration files
    {
      files: ['package.json', 'tsconfig.json', '.eslintrc.json'],
      options: {
        parser: 'json',
        printWidth: 80,
        tabWidth: 2
      }
    },
    
    // Markdown documentation
    {
      files: ['*.md', '*.mdx'],
      options: {
        parser: 'markdown',
        printWidth: 80,
        proseWrap: 'always',
        tabWidth: 2
      }
    },
    
    // YAML files (Docker Compose, GitHub Actions)
    {
      files: ['*.yml', '*.yaml'],
      options: {
        parser: 'yaml',
        printWidth: 80,
        tabWidth: 2,
        singleQuote: false
      }
    },
    
    // CSS and SCSS
    {
      files: ['*.css', '*.scss', '*.sass'],
      options: {
        parser: 'css',
        printWidth: 100,
        singleQuote: true
      }
    },
    
    // HTML templates
    {
      files: ['*.html'],
      options: {
        parser: 'html',
        printWidth: 120,
        htmlWhitespaceSensitivity: 'ignore'
      }
    },
    
    // SQL files
    {
      files: ['*.sql'],
      options: {
        parser: 'sql',
        printWidth: 120,
        tabWidth: 2,
        keywordCase: 'upper',
        identifierCase: 'lower',
        functionCase: 'upper'
      }
    }
  ]
};
```

### 2. Integration with ESLint

```json
// .eslintrc.json - ESLint and Prettier integration
{
  "extends": [
    "eslint:recommended",
    "@typescript-eslint/recommended",
    "prettier" // This turns off ESLint rules that conflict with Prettier
  ],
  "plugins": [
    "@typescript-eslint",
    "prettier"
  ],
  "rules": {
    "prettier/prettier": ["error", {
      "semi": true,
      "singleQuote": true,
      "printWidth": 100,
      "trailingComma": "es5"
    }]
  }
}
```

### 3. Editor Integration

```json
// .vscode/settings.json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.formatOnPaste": true,
  "editor.formatOnType": false,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  },
  "prettier.requireConfig": true,
  "prettier.useEditorConfig": false,
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[json]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[jsonc]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[markdown]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.wordWrap": "wordWrapColumn",
    "editor.wordWrapColumn": 80
  },
  "[css]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[scss]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[yaml]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[html]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

## Automated Formatting Workflows

### 1. Pre-commit Hooks

```bash
#!/bin/sh
# .husky/pre-commit
. "$(dirname "$0")/_/husky.sh"

# Run Prettier on staged files
npx lint-staged

# Check if any files were changed by formatting
if [ -n "$(git diff --name-only --staged)" ]; then
  echo "✅ Code formatting completed"
else
  echo "ℹ️  No files needed formatting"
fi
```

```json
// package.json lint-staged configuration
{
  "lint-staged": {
    "*.{js,ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,css,scss,md}": [
      "prettier --write"
    ],
    "*.{yml,yaml}": [
      "prettier --write --parser yaml"
    ]
  }
}
```

### 2. GitHub Actions Integration

```yaml
# .github/workflows/format-check.yml
name: Code Formatting Check

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  format-check:
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
      
      - name: Check Prettier formatting
        run: npm run format:check
      
      - name: Check ESLint + Prettier integration
        run: npm run lint:check
      
      - name: Comment PR with formatting suggestions
        if: failure() && github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ **Code formatting check failed**\n\nPlease run `npm run format` to fix formatting issues.'
            })
```

### 3. Automatic Formatting PR

```yaml
# .github/workflows/auto-format.yml
name: Auto Format Code

on:
  issue_comment:
    types: [created]

jobs:
  auto-format:
    if: |
      github.event.issue.pull_request &&
      contains(github.event.comment.body, '/format') &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR')
    
    runs-on: [self-hosted, docker, runnerhub]
    
    steps:
      - name: Get PR branch
        id: pr
        run: |
          PR_NUMBER=${{ github.event.issue.number }}
          PR_DATA=$(curl -s -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
            "https://api.github.com/repos/${{ github.repository }}/pulls/$PR_NUMBER")
          echo "::set-output name=branch::$(echo "$PR_DATA" | jq -r .head.ref)"
          echo "::set-output name=repo::$(echo "$PR_DATA" | jq -r .head.repo.full_name)"
      
      - name: Checkout PR branch
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          repository: ${{ steps.pr.outputs.repo }}
          ref: ${{ steps.pr.outputs.branch }}
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Format code
        run: |
          npm run format
          npm run lint:fix
      
      - name: Commit changes
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          
          if [[ -n $(git status --porcelain) ]]; then
            git add .
            git commit -m "🎨 Auto-format code [skip ci]"
            git push
            
            echo "✅ Code formatted and committed"
          else
            echo "ℹ️ No formatting changes needed"
          fi
      
      - name: Add reaction to comment
        uses: actions/github-script@v6
        with:
          script: |
            await github.rest.reactions.createForIssueComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              comment_id: ${{ github.event.comment.id }},
              content: '+1'
            });
```

## Advanced Prettier Usage

### 1. Custom Prettier Plugin

```javascript
// prettier-plugin-runner-hub.js
const { parsers } = require('prettier/parser-typescript');

const customParsers = {
  'runner-hub-config': {
    ...parsers.typescript,
    parse(text, parsers, options) {
      // Custom parsing for RunnerHub configuration files
      const ast = parsers.typescript.parse(text, parsers, options);
      
      // Add custom transformations
      return transformRunnerHubAST(ast);
    }
  }
};

function transformRunnerHubAST(ast) {
  // Custom AST transformations for RunnerHub patterns
  return ast;
}

module.exports = {
  parsers: customParsers,
  languages: [
    {
      name: 'RunnerHub Config',
      extensions: ['.runner.js', '.hub.config.js'],
      parsers: ['runner-hub-config']
    }
  ],
  defaultOptions: {
    tabWidth: 2,
    printWidth: 100
  }
};
```

### 2. Formatting Scripts

```javascript
// scripts/format-project.js
const prettier = require('prettier');
const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');

class ProjectFormatter {
  constructor() {
    this.prettierConfig = null;
    this.stats = {
      formatted: 0,
      unchanged: 0,
      errors: 0
    };
  }

  async init() {
    this.prettierConfig = await prettier.resolveConfig(process.cwd());
  }

  async formatProject() {
    console.log('🎨 Starting project formatting...');
    
    const filePatterns = [
      'backend/**/*.{js,ts}',
      'frontend/**/*.{js,ts,tsx}',
      'scripts/**/*.js',
      '*.{js,ts,json,md}'
    ];

    for (const pattern of filePatterns) {
      await this.formatFilePattern(pattern);
    }

    this.printSummary();
  }

  async formatFilePattern(pattern) {
    const files = glob.sync(pattern, {
      ignore: ['node_modules/**', 'dist/**', 'build/**']
    });

    console.log(`📁 Processing ${files.length} files matching ${pattern}`);

    for (const file of files) {
      await this.formatFile(file);
    }
  }

  async formatFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const fileInfo = await prettier.getFileInfo(filePath);
      
      if (fileInfo.ignored) {
        return;
      }

      const formatted = await prettier.format(content, {
        ...this.prettierConfig,
        filepath: filePath
      });

      if (content !== formatted) {
        await fs.writeFile(filePath, formatted, 'utf8');
        console.log(`✅ Formatted: ${filePath}`);
        this.stats.formatted++;
      } else {
        this.stats.unchanged++;
      }
    } catch (error) {
      console.error(`❌ Error formatting ${filePath}:`, error.message);
      this.stats.errors++;
    }
  }

  printSummary() {
    console.log('\n📊 Formatting Summary:');
    console.log(`   ✅ Formatted: ${this.stats.formatted} files`);
    console.log(`   ➡️  Unchanged: ${this.stats.unchanged} files`);
    console.log(`   ❌ Errors: ${this.stats.errors} files`);
    
    if (this.stats.errors > 0) {
      process.exit(1);
    }
  }

  async checkFormatting() {
    console.log('🔍 Checking project formatting...');
    
    const filePatterns = [
      'backend/**/*.{js,ts}',
      'frontend/**/*.{js,ts,tsx}',
      '*.{js,ts,json}'
    ];

    let unformattedFiles = [];

    for (const pattern of filePatterns) {
      const files = glob.sync(pattern, {
        ignore: ['node_modules/**', 'dist/**', 'build/**']
      });

      for (const file of files) {
        const isFormatted = await this.isFileFormatted(file);
        if (!isFormatted) {
          unformattedFiles.push(file);
        }
      }
    }

    if (unformattedFiles.length > 0) {
      console.error('\n❌ The following files are not formatted:');
      unformattedFiles.forEach(file => console.error(`   ${file}`));
      console.error('\nRun "npm run format" to fix formatting issues.');
      process.exit(1);
    } else {
      console.log('✅ All files are properly formatted!');
    }
  }

  async isFileFormatted(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const fileInfo = await prettier.getFileInfo(filePath);
      
      if (fileInfo.ignored) {
        return true;
      }

      const formatted = await prettier.format(content, {
        ...this.prettierConfig,
        filepath: filePath
      });

      return content === formatted;
    } catch (error) {
      console.error(`Error checking ${filePath}:`, error.message);
      return false;
    }
  }
}

// CLI interface
if (require.main === module) {
  const formatter = new ProjectFormatter();
  
  const command = process.argv[2];
  
  formatter.init().then(() => {
    switch (command) {
      case 'format':
        return formatter.formatProject();
      case 'check':
        return formatter.checkFormatting();
      default:
        console.log('Usage: node format-project.js [format|check]');
        process.exit(1);
    }
  }).catch(error => {
    console.error('Formatting failed:', error);
    process.exit(1);
  });
}
```

### 3. Custom Formatting Rules

```javascript
// prettier-rules.js - Custom formatting rules for RunnerHub
module.exports = {
  // Docker configuration formatting
  dockerConfig: {
    printWidth: 120,
    tabWidth: 2,
    singleQuote: false, // Docker prefers double quotes
    trailingComma: 'none'
  },
  
  // API route formatting
  apiRoutes: {
    printWidth: 100,
    tabWidth: 2,
    singleQuote: true,
    semi: true,
    // Custom rule: Always break chained method calls
    breakChainedMethods: true
  },
  
  // Test file formatting
  tests: {
    printWidth: 120, // Longer lines for test descriptions
    tabWidth: 2,
    singleQuote: true,
    semi: true
  },
  
  // Configuration file formatting
  config: {
    printWidth: 80,
    tabWidth: 2,
    singleQuote: false,
    trailingComma: 'none',
    // Keep JSON configs compact
    bracketSpacing: false
  }
};
```

## Monitoring and Quality Metrics

### 1. Formatting Metrics

```javascript
// scripts/format-metrics.js
const prettier = require('prettier');
const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');

class FormattingMetrics {
  constructor() {
    this.metrics = {
      totalFiles: 0,
      formattedFiles: 0,
      unformattedFiles: 0,
      ignoredFiles: 0,
      errors: 0,
      byExtension: new Map(),
      byDirectory: new Map()
    };
  }

  async collectMetrics() {
    const prettierConfig = await prettier.resolveConfig(process.cwd());
    const filePatterns = [
      '**/*.{js,ts,tsx,json,css,scss,md,yml,yaml,html}'
    ];

    for (const pattern of filePatterns) {
      const files = glob.sync(pattern, {
        ignore: [
          'node_modules/**',
          'dist/**',
          'build/**',
          'coverage/**',
          '.git/**'
        ]
      });

      for (const file of files) {
        await this.analyzeFile(file, prettierConfig);
      }
    }

    return this.generateReport();
  }

  async analyzeFile(filePath, config) {
    try {
      this.metrics.totalFiles++;
      
      const fileInfo = await prettier.getFileInfo(filePath);
      const extension = path.extname(filePath);
      const directory = path.dirname(filePath).split('/')[0];

      // Update extension stats
      if (!this.metrics.byExtension.has(extension)) {
        this.metrics.byExtension.set(extension, {
          total: 0,
          formatted: 0,
          unformatted: 0
        });
      }
      const extStats = this.metrics.byExtension.get(extension);
      extStats.total++;

      // Update directory stats
      if (!this.metrics.byDirectory.has(directory)) {
        this.metrics.byDirectory.set(directory, {
          total: 0,
          formatted: 0,
          unformatted: 0
        });
      }
      const dirStats = this.metrics.byDirectory.get(directory);
      dirStats.total++;

      if (fileInfo.ignored) {
        this.metrics.ignoredFiles++;
        return;
      }

      const content = await fs.readFile(filePath, 'utf8');
      const formatted = await prettier.format(content, {
        ...config,
        filepath: filePath
      });

      if (content === formatted) {
        this.metrics.formattedFiles++;
        extStats.formatted++;
        dirStats.formatted++;
      } else {
        this.metrics.unformattedFiles++;
        extStats.unformatted++;
        dirStats.unformatted++;
      }
    } catch (error) {
      this.metrics.errors++;
      console.error(`Error analyzing ${filePath}:`, error.message);
    }
  }

  generateReport() {
    const formattingRate = this.metrics.totalFiles > 0
      ? (this.metrics.formattedFiles / this.metrics.totalFiles) * 100
      : 0;

    return {
      summary: {
        total_files: this.metrics.totalFiles,
        formatted_files: this.metrics.formattedFiles,
        unformatted_files: this.metrics.unformattedFiles,
        ignored_files: this.metrics.ignoredFiles,
        error_files: this.metrics.errors,
        formatting_rate: Math.round(formattingRate * 100) / 100
      },
      by_extension: Object.fromEntries(this.metrics.byExtension),
      by_directory: Object.fromEntries(this.metrics.byDirectory),
      grade: this.calculateGrade(formattingRate),
      recommendations: this.generateRecommendations(),
      timestamp: new Date().toISOString()
    };
  }

  calculateGrade(formattingRate) {
    if (formattingRate >= 95) return 'A';
    if (formattingRate >= 85) return 'B';
    if (formattingRate >= 75) return 'C';
    if (formattingRate >= 60) return 'D';
    return 'F';
  }

  generateRecommendations() {
    const recommendations = [];
    
    if (this.metrics.unformattedFiles > 0) {
      recommendations.push('Run "npm run format" to automatically format unformatted files');
    }

    if (this.metrics.errors > 0) {
      recommendations.push('Fix parsing errors in files that failed formatting');
    }

    // Check which file types have the most formatting issues
    const worstExtension = Array.from(this.metrics.byExtension.entries())
      .sort((a, b) => b[1].unformatted - a[1].unformatted)[0];

    if (worstExtension && worstExtension[1].unformatted > 5) {
      recommendations.push(`Focus on formatting ${worstExtension[0]} files - they have the most issues`);
    }

    return recommendations;
  }
}

// API endpoint for formatting metrics
module.exports = FormattingMetrics;

if (require.main === module) {
  const metrics = new FormattingMetrics();
  metrics.collectMetrics()
    .then(report => {
      console.log('📊 Formatting Report:');
      console.log(`Grade: ${report.grade}`);
      console.log(`Formatting Rate: ${report.summary.formatting_rate}%`);
      console.log(`Files: ${report.summary.formatted_files}/${report.summary.total_files} formatted`);
      
      if (report.recommendations.length > 0) {
        console.log('\n💡 Recommendations:');
        report.recommendations.forEach(rec => console.log(`   - ${rec}`));
      }
    })
    .catch(console.error);
}
```

### 2. Dashboard Integration

```javascript
// API endpoint for formatting status
app.get('/api/code-quality/formatting', authenticateJWT, async (req, res) => {
  try {
    const FormattingMetrics = require('../scripts/format-metrics');
    const metrics = new FormattingMetrics();
    const report = await metrics.collectMetrics();
    
    res.json({
      status: report.summary.formatting_rate >= 95 ? 'excellent' : 
              report.summary.formatting_rate >= 80 ? 'good' :
              report.summary.formatting_rate >= 60 ? 'needs_improvement' : 'poor',
      data: report,
      last_updated: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## Testing Prettier Configuration

```javascript
// tests/prettier-config.test.js
const prettier = require('prettier');
const fs = require('fs');
const path = require('path');

describe('Prettier Configuration', () => {
  let prettierConfig;
  
  beforeAll(async () => {
    prettierConfig = await prettier.resolveConfig(process.cwd());
  });

  test('should load prettier configuration', () => {
    expect(prettierConfig).toBeTruthy();
    expect(prettierConfig.semi).toBe(true);
    expect(prettierConfig.singleQuote).toBe(true);
  });

  test('should format JavaScript correctly', async () => {
    const input = `const  test   =   "hello world";\nconsole.log(test)`;
    const expected = `const test = 'hello world';\nconsole.log(test);\n`;
    
    const formatted = await prettier.format(input, {
      ...prettierConfig,
      parser: 'babel'
    });
    
    expect(formatted).toBe(expected);
  });

  test('should format TypeScript correctly', async () => {
    const input = `interface User{name:string;age:number}`;
    const expected = `interface User {\n  name: string;\n  age: number;\n}\n`;
    
    const formatted = await prettier.format(input, {
      ...prettierConfig,
      parser: 'typescript'
    });
    
    expect(formatted).toBe(expected);
  });

  test('should format JSON correctly', async () => {
    const input = `{"name":"test","version":"1.0.0"}`;
    const expected = `{\n  "name": "test",\n  "version": "1.0.0"\n}\n`;
    
    const formatted = await prettier.format(input, {
      ...prettierConfig,
      parser: 'json'
    });
    
    expect(formatted).toBe(expected);
  });

  test('should respect file overrides', async () => {
    const mdContent = `# This is a very long title that should be wrapped at 80 characters according to our markdown configuration`;
    
    const formatted = await prettier.format(mdContent, {
      ...prettierConfig,
      parser: 'markdown',
      filepath: 'test.md'
    });
    
    expect(formatted.split('\n')[0].length).toBeLessThanOrEqual(80);
  });

  test('should ignore specified files', async () => {
    const fileInfo = await prettier.getFileInfo('node_modules/test.js');
    expect(fileInfo.ignored).toBe(true);
  });
});
```

## Performance Optimization

### 1. Parallel Formatting

```javascript
// scripts/parallel-format.js
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const prettier = require('prettier');
const fs = require('fs').promises;
const glob = require('glob');
const os = require('os');

if (isMainThread) {
  async function parallelFormat() {
    const files = glob.sync('**/*.{js,ts,tsx,json,css,md}', {
      ignore: ['node_modules/**', 'dist/**', 'build/**']
    });
    
    const numWorkers = Math.min(os.cpus().length, 4);
    const chunkSize = Math.ceil(files.length / numWorkers);
    const chunks = [];
    
    for (let i = 0; i < files.length; i += chunkSize) {
      chunks.push(files.slice(i, i + chunkSize));
    }
    
    console.log(`🚀 Formatting ${files.length} files using ${numWorkers} workers`);
    
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
    
    const totalStats = results.reduce((acc, stats) => ({
      formatted: acc.formatted + stats.formatted,
      unchanged: acc.unchanged + stats.unchanged,
      errors: acc.errors + stats.errors
    }), { formatted: 0, unchanged: 0, errors: 0 });
    
    console.log(`✅ Completed: ${totalStats.formatted} formatted, ${totalStats.unchanged} unchanged, ${totalStats.errors} errors`);
  }
  
  parallelFormat().catch(console.error);
  
} else {
  async function formatFiles() {
    const { files } = workerData;
    const prettierConfig = await prettier.resolveConfig(process.cwd());
    const stats = { formatted: 0, unchanged: 0, errors: 0 };
    
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf8');
        const formatted = await prettier.format(content, {
          ...prettierConfig,
          filepath: file
        });
        
        if (content !== formatted) {
          await fs.writeFile(file, formatted, 'utf8');
          stats.formatted++;
        } else {
          stats.unchanged++;
        }
      } catch (error) {
        console.error(`Error formatting ${file}:`, error.message);
        stats.errors++;
      }
    }
    
    parentPort.postMessage(stats);
  }
  
  formatFiles().catch(err => {
    console.error('Worker error:', err);
    process.exit(1);
  });
}
```

## Related Technologies

- ESLint (code linting)
- EditorConfig (editor configuration)
- StandardJS (opinionated formatter)
- Black (Python code formatter)
- Rustfmt (Rust code formatter)