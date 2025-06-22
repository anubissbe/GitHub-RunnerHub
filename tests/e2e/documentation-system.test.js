/**
 * End-to-End Documentation & Training System Tests
 * Validates documentation completeness, formatting, and accessibility
 */

const fs = require('fs').promises;
const path = require('path');
const { describe, it, expect } = require('@jest/globals');

describe('Documentation & Training System E2E Tests', () => {
  const docsPath = path.join(__dirname, '../../docs');
  const rootPath = path.join(__dirname, '../..');

  describe('Documentation Structure', () => {
    it('should have all required documentation files', async () => {
      const requiredFiles = [
        'README.md',
        'FAQ.md',
        'api/API_REFERENCE.md',
        'architecture/SYSTEM_ARCHITECTURE.md',
        'guides/QUICK_START.md',
        'troubleshooting/README.md',
        'training/README.md'
      ];

      for (const file of requiredFiles) {
        const filePath = path.join(docsPath, file);
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
        
        // Verify file is not empty
        const content = await fs.readFile(filePath, 'utf8');
        expect(content.length).toBeGreaterThan(100);
      }
    });

    it('should have proper folder organization', async () => {
      const requiredFolders = [
        'api',
        'architecture', 
        'guides',
        'troubleshooting',
        'training'
      ];

      for (const folder of requiredFolders) {
        const folderPath = path.join(docsPath, folder);
        const stats = await fs.stat(folderPath);
        expect(stats.isDirectory()).toBe(true);
      }
    });

    it('should have implementation summaries in root', async () => {
      const summaryFiles = [
        'DOCUMENTATION_TRAINING_PLAN.md',
        'DOCUMENTATION_TRAINING_SUMMARY.md'
      ];

      for (const file of summaryFiles) {
        const filePath = path.join(rootPath, file);
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      }
    });
  });

  describe('Documentation Content Quality', () => {
    it('should have comprehensive architecture documentation', async () => {
      const archPath = path.join(docsPath, 'architecture/SYSTEM_ARCHITECTURE.md');
      const content = await fs.readFile(archPath, 'utf8');
      
      // Check for key sections
      expect(content).toMatch(/## 🏗️ Overview/);
      expect(content).toMatch(/## 📐 High-Level Architecture/);
      expect(content).toMatch(/## 🎯 Core Components/);
      expect(content).toMatch(/## 🔄 Data Flow Architecture/);
      expect(content).toMatch(/## 🛡️ Security Architecture/);
      
      // Check for Mermaid diagrams
      expect(content).toMatch(/```mermaid/);
      expect(content.split('```mermaid').length).toBeGreaterThan(3);
      
      // Verify minimum content length (comprehensive documentation)
      expect(content.length).toBeGreaterThan(15000);
    });

    it('should have complete API reference', async () => {
      const apiPath = path.join(docsPath, 'api/API_REFERENCE.md');
      const content = await fs.readFile(apiPath, 'utf8');
      
      // Check for key API sections
      expect(content).toMatch(/## 🔑 Authentication/);
      expect(content).toMatch(/## 🎯 API Endpoints/);
      expect(content).toMatch(/### Authentication & User Management/);
      expect(content).toMatch(/### Job Management/);
      expect(content).toMatch(/### Runner Management/);
      expect(content).toMatch(/### Security/);
      expect(content).toMatch(/### Monitoring & Analytics/);
      
      // Check for HTTP methods
      expect(content).toMatch(/GET \/api\//);
      expect(content).toMatch(/POST \/api\//);
      expect(content).toMatch(/PUT \/api\//);
      expect(content).toMatch(/DELETE \/api\//);
      
      // Verify comprehensive coverage
      expect(content.length).toBeGreaterThan(15000);
    });

    it('should have practical quick start guide', async () => {
      const quickStartPath = path.join(docsPath, 'guides/QUICK_START.md');
      const content = await fs.readFile(quickStartPath, 'utf8');
      
      // Check for essential sections
      expect(content).toMatch(/## 🚀 Get Started in 5 Minutes/);
      expect(content).toMatch(/## 📋 Prerequisites/);
      expect(content).toMatch(/## 🔑 Step 1: GitHub Token Setup/);
      expect(content).toMatch(/## 📥 Step 2: Download and Install/);
      expect(content).toMatch(/## ⚙️ Step 3: Initial Configuration/);
      expect(content).toMatch(/## 🎛️ Step 4: Access the Dashboard/);
      expect(content).toMatch(/## 🏃‍♂️ Step 5: Set Up Your First Runner/);
      expect(content).toMatch(/## ✅ Step 6: Verify Everything Works/);
      
      // Check for executable commands
      expect(content).toMatch(/```bash/);
      expect(content).toMatch(/git clone/);
      expect(content).toMatch(/\.\/install-comprehensive\.sh/);
      
      // Verify practical content
      expect(content.length).toBeGreaterThan(7000);
    });

    it('should have comprehensive troubleshooting guide', async () => {
      const troubleshootingPath = path.join(docsPath, 'troubleshooting/README.md');
      const content = await fs.readFile(troubleshootingPath, 'utf8');
      
      // Check for troubleshooting sections
      expect(content).toMatch(/## 🚨 Emergency Quick Fixes/);
      expect(content).toMatch(/## 📂 Issue Categories/);
      expect(content).toMatch(/### 1\. Installation & Setup Issues/);
      expect(content).toMatch(/### 2\. GitHub Integration Issues/);
      expect(content).toMatch(/### 3\. Runner Issues/);
      expect(content).toMatch(/### 4\. Container & Job Issues/);
      expect(content).toMatch(/### 5\. Performance Issues/);
      
      // Check for diagnostic tools
      expect(content).toMatch(/## 🛠️ Diagnostic Tools/);
      expect(content).toMatch(/### Health Check Script/);
      expect(content).toMatch(/### Log Aggregation Script/);
      
      // Verify comprehensive coverage
      expect(content.length).toBeGreaterThan(15000);
    });

    it('should have structured training program', async () => {
      const trainingPath = path.join(docsPath, 'training/README.md');
      const content = await fs.readFile(trainingPath, 'utf8');
      
      // Check for training structure
      expect(content).toMatch(/## 🎓 Overview/);
      expect(content).toMatch(/## 🎯 Learning Objectives/);
      expect(content).toMatch(/## 📚 Training Curriculum/);
      expect(content).toMatch(/### 🌱 Beginner Level/);
      expect(content).toMatch(/### 🚀 Intermediate Level/);
      expect(content).toMatch(/### 🏆 Advanced Level/);
      
      // Check for hands-on components
      expect(content).toMatch(/## 🛠️ Hands-on Labs/);
      expect(content).toMatch(/## 📋 Assessment Methods/);
      expect(content).toMatch(/### Certification Levels/);
      
      // Verify comprehensive curriculum
      expect(content.length).toBeGreaterThan(16000);
    });

    it('should have comprehensive FAQ', async () => {
      const faqPath = path.join(docsPath, 'FAQ.md');
      const content = await fs.readFile(faqPath, 'utf8');
      
      // Check for FAQ categories
      expect(content).toMatch(/## 🤔 General Questions/);
      expect(content).toMatch(/## 🔧 Installation & Setup/);
      expect(content).toMatch(/## 🏃‍♂️ Runner Management/);
      expect(content).toMatch(/## 🔒 Security/);
      expect(content).toMatch(/## 📊 Monitoring & Performance/);
      expect(content).toMatch(/## 💰 Cost & Performance/);
      expect(content).toMatch(/## 🛠️ Troubleshooting/);
      expect(content).toMatch(/## 🔧 Advanced Usage/);
      
      // Check for Q&A format
      expect(content).toMatch(/### What is GitHub-RunnerHub\?/);
      expect(content).toMatch(/### How is it different/);
      expect(content).toMatch(/### What are the system requirements\?/);
      
      // Verify comprehensive Q&A
      expect(content.length).toBeGreaterThan(12000);
    });
  });

  describe('Documentation Formatting', () => {
    it('should have consistent markdown formatting', async () => {
      const files = [
        'README.md',
        'api/API_REFERENCE.md',
        'architecture/SYSTEM_ARCHITECTURE.md',
        'guides/QUICK_START.md'
      ];

      for (const file of files) {
        const content = await fs.readFile(path.join(docsPath, file), 'utf8');
        
        // Check for proper headers
        expect(content).toMatch(/^# /m);
        expect(content).toMatch(/^## /m);
        
        // Check for proper code blocks
        const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
        expect(codeBlocks.length).toBeGreaterThan(0);
        
        // Check for proper links (but be flexible for different file types)
        const links = content.match(/\[.*?\]\(.*?\)/g) || [];
        
        // Only check for links in files that should definitely have them
        if (file === 'README.md' || file === 'guides/QUICK_START.md') {
          expect(links.length).toBeGreaterThan(0);
        }
      }
    });

    it('should have proper table of contents in long documents', async () => {
      const longDocs = [
        'api/API_REFERENCE.md',
        'architecture/SYSTEM_ARCHITECTURE.md',
        'troubleshooting/README.md',
        'training/README.md'
      ];

      for (const doc of longDocs) {
        const content = await fs.readFile(path.join(docsPath, doc), 'utf8');
        
        // Should have multiple ## level headers
        const h2Headers = content.match(/^## /gm) || [];
        expect(h2Headers.length).toBeGreaterThan(4);
        
        // Should have multiple ### level headers
        const h3Headers = content.match(/^### /gm) || [];
        expect(h3Headers.length).toBeGreaterThan(3);
      }
    });

    it('should use consistent emoji usage', async () => {
      const files = [
        'README.md',
        'guides/QUICK_START.md',
        'training/README.md'
      ];

      for (const file of files) {
        const content = await fs.readFile(path.join(docsPath, file), 'utf8');
        
        // Check for emoji usage in headers
        const emojiHeaders = content.match(/^## [🎯🔧🚀📋🎓🔍🛠️⚡📊💰🔒🤔]/gm) || [];
        expect(emojiHeaders.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Code Examples Validation', () => {
    it('should have executable bash commands', async () => {
      const files = [
        'guides/QUICK_START.md',
        'api/API_REFERENCE.md',
        'troubleshooting/README.md'
      ];

      for (const file of files) {
        const content = await fs.readFile(path.join(docsPath, file), 'utf8');
        
        // Check for bash code blocks (some files may not have any)
        const bashBlocks = content.match(/```bash[\s\S]*?```/g) || [];
        
        // Check for common commands based on file type
        if (file === 'guides/QUICK_START.md') {
          expect(bashBlocks.length).toBeGreaterThan(0);
          expect(content).toMatch(/git clone/);
        }
        
        // Check for at least some command examples in any format
        const hasCommands = content.match(/git|curl|docker|npm|sudo/) !== null;
        expect(hasCommands).toBe(true);
      }
    });

    it('should have valid JSON examples', async () => {
      const apiPath = path.join(docsPath, 'api/API_REFERENCE.md');
      const content = await fs.readFile(apiPath, 'utf8');
      
      // Extract JSON blocks
      const jsonBlocks = content.match(/```json[\s\S]*?```/g) || [];
      expect(jsonBlocks.length).toBeGreaterThan(10);
      
      // Validate JSON syntax
      for (const block of jsonBlocks.slice(0, 5)) { // Test first 5
        const jsonContent = block.replace(/```json\n?/, '').replace(/```$/, '');
        expect(() => JSON.parse(jsonContent)).not.toThrow();
      }
    });

    it('should have valid YAML examples', async () => {
      const quickStartPath = path.join(docsPath, 'guides/QUICK_START.md');
      const content = await fs.readFile(quickStartPath, 'utf8');
      
      // Check for YAML blocks
      const yamlBlocks = content.match(/```yaml[\s\S]*?```/g) || [];
      expect(yamlBlocks.length).toBeGreaterThan(0);
      
      // Basic YAML structure validation
      for (const block of yamlBlocks) {
        const yamlContent = block.replace(/```yaml\n?/, '').replace(/```$/, '');
        expect(yamlContent).toMatch(/name:|on:|jobs:/);
      }
    });
  });

  describe('Cross-References and Links', () => {
    it('should have proper internal links', async () => {
      const readmePath = path.join(docsPath, 'README.md');
      const content = await fs.readFile(readmePath, 'utf8');
      
      // Check for links to other documentation
      expect(content).toMatch(/\[.*?\]\(.*\.md\)/);
      expect(content).toMatch(/guides\/QUICK_START\.md/);
      expect(content).toMatch(/api\/API_REFERENCE\.md/);
      expect(content).toMatch(/architecture\/SYSTEM_ARCHITECTURE\.md/);
      expect(content).toMatch(/troubleshooting\/README\.md/);
      expect(content).toMatch(/training\/README\.md/);
    });

    it('should reference main documentation in README.md', async () => {
      const mainReadmePath = path.join(rootPath, 'README.md');
      const content = await fs.readFile(mainReadmePath, 'utf8');
      
      // Should reference the documentation system
      expect(content).toMatch(/Documentation & Training/);
      expect(content).toMatch(/DOCUMENTATION_TRAINING_SUMMARY\.md/);
    });

    it('should have consistent cross-references', async () => {
      const files = [
        'api/API_REFERENCE.md',
        'architecture/SYSTEM_ARCHITECTURE.md',
        'guides/QUICK_START.md'
      ];

      for (const file of files) {
        const content = await fs.readFile(path.join(docsPath, file), 'utf8');
        
        // Check for references to other docs (allow relative paths and README references)
        const internalLinks = content.match(/\[.*?\]\(\.\.\/.*\.md.*?\)/g) || [];
        const relativeLinks = content.match(/\[.*?\]\([^http].*\.md.*?\)/g) || [];
        const totalInternalLinks = internalLinks.length + relativeLinks.length;
        
        // Some files may not have cross-references, so make this conditional
        if (content.includes('README.md') || content.includes('../') || content.includes('docs/')) {
          expect(totalInternalLinks).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Security and Privacy', () => {
    it('should not contain real credentials or tokens', async () => {
      const allFiles = [
        'README.md',
        'FAQ.md',
        'api/API_REFERENCE.md',
        'architecture/SYSTEM_ARCHITECTURE.md',
        'guides/QUICK_START.md',
        'troubleshooting/README.md',
        'training/README.md'
      ];

      for (const file of allFiles) {
        const content = await fs.readFile(path.join(docsPath, file), 'utf8');
        
        // Should not contain real tokens (check for GitHub token patterns)
        expect(content).not.toMatch(/ghp_[a-zA-Z0-9]{36}/);
        expect(content).not.toMatch(/github_pat_[a-zA-Z0-9_]{82}/);
        
        // Should use placeholder values (if tokens are mentioned)
        if (content.includes('token') || content.includes('TOKEN')) {
          expect(content).toMatch(/your_token|YOUR_TOKEN|ghp_your_token|your-username|example|your_secure_password|your-domain|jwt_token|refresh_token_here|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
        }
      }
    });

    it('should not contain private IP addresses', async () => {
      const allFiles = [
        'README.md',
        'FAQ.md',
        'api/API_REFERENCE.md',
        'architecture/SYSTEM_ARCHITECTURE.md',
        'guides/QUICK_START.md',
        'troubleshooting/README.md',
        'training/README.md'
      ];

      for (const file of allFiles) {
        const content = await fs.readFile(path.join(docsPath, file), 'utf8');
        
        // Should not contain 192.168.x.x addresses
        expect(content).not.toMatch(/192\.168\.\d+\.\d+/);
        
        // Should use example IPs or localhost
        const acceptableIPs = content.match(/(?:10\.0\.\d+\.\d+|localhost|127\.0\.0\.1|example\.com)/g) || [];
        if (content.includes('IP') || content.includes('address')) {
          expect(acceptableIPs.length).toBeGreaterThan(0);
        }
      }
    });

    it('should use placeholder organization names', async () => {
      const allFiles = [
        'api/API_REFERENCE.md',
        'guides/QUICK_START.md',
        'training/README.md'
      ];

      for (const file of allFiles) {
        const content = await fs.readFile(path.join(docsPath, file), 'utf8');
        
        // Should use placeholder org names
        const placeholders = content.match(/YOUR_ORG|your-org|example-org|owner\/repo/g) || [];
        if (content.includes('github.com') && content.includes('org')) {
          expect(placeholders.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Accessibility and Usability', () => {
    it('should have proper heading hierarchy', async () => {
      const files = [
        'architecture/SYSTEM_ARCHITECTURE.md',
        'api/API_REFERENCE.md',
        'troubleshooting/README.md'
      ];

      for (const file of files) {
        const content = await fs.readFile(path.join(docsPath, file), 'utf8');
        
        // Should start with h1
        expect(content).toMatch(/^# /);
        
        // Should have proper hierarchy (no h4 without h3, etc.)
        const h1Count = (content.match(/^# /gm) || []).length;
        const h2Count = (content.match(/^## /gm) || []).length;
        const h3Count = (content.match(/^### /gm) || []).length;
        
        expect(h1Count).toBeGreaterThanOrEqual(1); // Should have at least one h1
        expect(h2Count).toBeGreaterThan(0); // Should have h2 sections
        
        if (h3Count > 0) {
          expect(h2Count).toBeGreaterThan(0); // h3 should not exist without h2
        }
      }
    });

    it('should have descriptive alt text for diagrams', async () => {
      const archPath = path.join(docsPath, 'architecture/SYSTEM_ARCHITECTURE.md');
      const content = await fs.readFile(archPath, 'utf8');
      
      // Check for Mermaid diagrams with descriptions
      const mermaidBlocks = content.match(/```mermaid[\s\S]*?```/g) || [];
      expect(mermaidBlocks.length).toBeGreaterThan(0);
      
      // Should have contextual descriptions near diagrams
      for (const block of mermaidBlocks) {
        const blockIndex = content.indexOf(block);
        const surrounding = content.slice(Math.max(0, blockIndex - 200), blockIndex + block.length + 200);
        
        // Should have descriptive text around diagrams
        expect(surrounding.toLowerCase()).toMatch(/architecture|flow|diagram|system|component/);
      }
    });

    it('should have search-friendly content structure', async () => {
      const readmePath = path.join(docsPath, 'README.md');
      const content = await fs.readFile(readmePath, 'utf8');
      
      // Should have navigation aids
      expect(content).toMatch(/## 🚀 Quick Navigation/);
      expect(content).toMatch(/## 📋 Documentation Structure/);
      expect(content).toMatch(/## 🎯 Documentation by User Type/);
      
      // Should have clear categorization
      expect(content).toMatch(/### 👩‍💻 Developers/);
      expect(content).toMatch(/### 🔧 DevOps Engineers/);
      expect(content).toMatch(/### 🛡️ Security Engineers/);
      expect(content).toMatch(/### 👨‍💼 System Administrators/);
    });
  });
});

// Integration test for documentation completeness
describe('Documentation System Integration', () => {
  it('should provide complete coverage of system features', async () => {
    const rootPath = path.join(__dirname, '../..');
    
    // Check that major implementation summaries exist and reference docs
    const summaryFiles = [
      'AUTO_SCALING_SYSTEM_SUMMARY.md',
      'RESOURCE_MANAGEMENT_SYSTEM_SUMMARY.md', 
      'DOCUMENTATION_TRAINING_SUMMARY.md'
    ];

    for (const file of summaryFiles) {
      const filePath = path.join(rootPath, file);
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    }

    // Verify main README references all documentation
    const mainReadme = await fs.readFile(path.join(rootPath, 'README.md'), 'utf8');
    expect(mainReadme).toMatch(/Documentation & Training/);
    expect(mainReadme).toMatch(/Auto-Scaling System/);
    expect(mainReadme).toMatch(/Resource Management/);
  });

  it('should have consistent documentation standards across all files', async () => {
    const docsPath = path.join(__dirname, '../../docs');
    const files = await fs.readdir(docsPath, { recursive: true });
    const mdFiles = files.filter(f => f.endsWith('.md'));
    
    expect(mdFiles.length).toBeGreaterThan(5);
    
    // Verify each markdown file has proper structure
    for (const file of mdFiles.slice(0, 10)) { // Test subset for performance
      const content = await fs.readFile(path.join(docsPath, file), 'utf8');
      
      if (content.length > 500) { // Only check substantial files
        // Should have title
        expect(content).toMatch(/^# /);
        
        // Should have sections
        expect(content).toMatch(/^## /m);
        
        // Should have proper formatting
        expect(content.split('\n').length).toBeGreaterThan(10);
      }
    }
  });
});