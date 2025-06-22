# GitHub-RunnerHub Training Program

## 🎓 Overview

Welcome to the comprehensive GitHub-RunnerHub training program! This structured curriculum takes you from beginner to expert, providing hands-on experience with all aspects of the system.

## 🎯 Learning Objectives

By completing this training program, you will be able to:

- **Deploy and configure** GitHub-RunnerHub in any environment
- **Manage runner fleets** efficiently and securely
- **Optimize performance** using auto-scaling and monitoring
- **Implement security** best practices and compliance
- **Troubleshoot issues** quickly and effectively
- **Extend the system** with custom integrations

## 📚 Training Curriculum

### 🌱 Beginner Level (4-6 hours)

#### Module 1: Introduction & Concepts (1 hour)
**Learning Goals**: Understand what GitHub-RunnerHub is and why it's valuable

**Topics Covered**:
- GitHub Actions architecture overview
- Self-hosted runners vs GitHub-hosted runners
- GitHub-RunnerHub value proposition
- System architecture at a high level
- Key terminology and concepts

**Hands-on Exercise**:
- Explore GitHub Actions in a sample repository
- Compare costs: GitHub-hosted vs self-hosted runners
- Review GitHub-RunnerHub dashboard demo

**Assessment**: Quiz on basic concepts and terminology

#### Module 2: Installation & Setup (2 hours)
**Learning Goals**: Successfully install and configure GitHub-RunnerHub

**Topics Covered**:
- System requirements and prerequisites
- Installation methods (quick start vs custom)
- Basic configuration
- GitHub token setup and permissions
- First runner registration

**Hands-on Exercise**:
```bash
# Complete installation walkthrough
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub
./install-comprehensive.sh --mode development

# Configure GitHub integration
export GITHUB_TOKEN=your_token
export GITHUB_ORG=your_org

# Set up first runner
./simple-runner-setup.sh

# Verify installation
curl http://localhost:3001/health
```

**Assessment**: Successfully complete installation and run a test workflow

#### Module 3: Dashboard & Basic Operations (1 hour)
**Learning Goals**: Navigate the dashboard and perform basic operations

**Topics Covered**:
- Dashboard overview and navigation
- Monitoring job execution
- Managing runners (start/stop/configure)
- Viewing logs and troubleshooting basics
- User management and permissions

**Hands-on Exercise**:
- Navigate all dashboard sections
- Execute sample workflows
- Monitor job progress in real-time
- Create additional users with different roles

**Assessment**: Complete a series of dashboard tasks

#### Module 4: First Workflows (1-2 hours)
**Learning Goals**: Create and execute workflows using GitHub-RunnerHub

**Topics Covered**:
- Workflow YAML syntax review
- Targeting self-hosted runners
- Using runner labels effectively
- Basic job routing and runner selection
- Viewing execution results

**Hands-on Exercise**:
Create and execute these workflows:
```yaml
# Simple workflow
name: Hello RunnerHub
on: [push]
jobs:
  hello:
    runs-on: [self-hosted, runnerhub]
    steps:
      - run: echo "Hello from RunnerHub!"

# Multi-step workflow  
name: Build and Test
on: [push]
jobs:
  build:
    runs-on: [self-hosted, linux, x64]
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
```

**Assessment**: Create and successfully execute 3 different workflows

### 🚀 Intermediate Level (6-8 hours)

#### Module 5: Advanced Configuration (2 hours)
**Learning Goals**: Configure advanced features and customizations

**Topics Covered**:
- Environment variables and configuration files
- Security configuration (RBAC, audit logging)
- Performance tuning and optimization
- Integration with external services
- Custom runner labels and routing

**Hands-on Exercise**:
```bash
# Configure advanced security
curl -X PUT http://localhost:3001/api/security/policies \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "scanEnabled": true,
    "quarantineOnVulnerability": true,
    "secretScanningEnabled": true
  }'

# Set up custom routing rules
curl -X POST http://localhost:3001/api/routing/rules \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "name": "GPU Workloads",
    "conditions": {
      "labels": ["gpu", "cuda"],
      "repository": "*/ml-*"
    },
    "target": {
      "runners": ["gpu-runner-*"]
    }
  }'

# Configure auto-scaling
curl -X PUT http://localhost:3001/api/scaling/config \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "enabled": true,
    "mode": "balanced",
    "minRunners": 2,
    "maxRunners": 20,
    "scaleUpThreshold": 0.8,
    "scaleDownThreshold": 0.3
  }'
```

**Assessment**: Configure a multi-runner setup with custom routing and security

#### Module 6: Scaling & Performance (2 hours)
**Learning Goals**: Implement and manage auto-scaling for optimal performance

**Topics Covered**:
- Auto-scaling concepts and algorithms
- Demand prediction and forecasting
- Container pre-warming strategies
- Performance monitoring and optimization
- Cost optimization techniques

**Hands-on Exercise**:
```bash
# Monitor scaling in action
# 1. Generate load using multiple workflows
for i in {1..10}; do
  curl -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" \
    https://api.github.com/repos/YOUR_ORG/YOUR_REPO/actions/workflows/load-test.yml/dispatches \
    -d '{"ref": "main"}'
done

# 2. Watch auto-scaling respond
curl http://localhost:3001/api/scaling/status
curl http://localhost:3001/api/analytics/realtime

# 3. Analyze performance
curl http://localhost:3001/api/analytics/dashboard
```

**Assessment**: Successfully configure and demonstrate auto-scaling under load

#### Module 7: Security & Compliance (2 hours)
**Learning Goals**: Implement enterprise-grade security features

**Topics Covered**:
- Container vulnerability scanning
- Network isolation and security policies
- Secret management with Vault integration
- Audit logging and compliance reporting
- Security incident response

**Hands-on Exercise**:
```bash
# Enable security scanning
curl -X POST http://localhost:3001/api/security/scan \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "target": "image",
    "identifier": "ghcr.io/actions/runner:latest",
    "scanType": "vulnerability"
  }'

# Configure network isolation
curl -X PUT http://localhost:3001/api/security/network \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "isolationEnabled": true,
    "allowedDomains": ["github.com", "api.github.com"],
    "blockedPorts": [22, 3389, 5432]
  }'

# Set up secret management
vault kv put secret/github-runner \
  token=ghp_example_token \
  webhook_secret=super_secret_key

# Review audit logs
curl http://localhost:3001/api/security/audit-logs \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Assessment**: Implement complete security configuration and pass compliance scan

### 🏆 Advanced Level (8-10 hours)

#### Module 8: Enterprise Deployment (3 hours)
**Learning Goals**: Deploy GitHub-RunnerHub in production environments

**Topics Covered**:
- High availability architecture
- Load balancing and failover
- Database replication and backup
- Monitoring and alerting setup
- Disaster recovery procedures

**Hands-on Exercise**:
```bash
# Deploy HA configuration
./install-comprehensive.sh --mode production --enable-ha

# Configure load balancing
# Edit docker-compose.ha.yml for load balancer setup

# Set up database replication
./scripts/setup-postgres-replication.sh --setup-users --init-replica

# Configure monitoring
docker-compose -f docker-compose.monitoring.yml up -d

# Test failover
docker-compose stop api-primary
# Verify secondary takes over
curl http://localhost:3001/health
```

**Assessment**: Deploy and validate a complete HA production environment

#### Module 9: Custom Development (3 hours)
**Learning Goals**: Extend GitHub-RunnerHub with custom functionality

**Topics Covered**:
- API integration and extension
- Custom webhook handlers
- Plugin development
- Custom runner types
- Integration with external systems

**Hands-on Exercise**:
```javascript
// Create custom webhook handler
const express = require('express');
const app = express();

app.post('/webhook/custom', (req, res) => {
  const event = req.body;
  
  // Custom logic for specific events
  if (event.action === 'workflow_run' && event.workflow_run.conclusion === 'failure') {
    // Trigger custom notification or remediation
    console.log('Workflow failed, triggering custom action');
  }
  
  res.status(200).send('OK');
});

// Create custom runner template
const customTemplate = {
  name: 'ml-gpu-runner',
  image: 'ghcr.io/actions/runner:gpu',
  labels: ['self-hosted', 'linux', 'gpu', 'cuda'],
  resources: { cpu: 8, memory: 32768, gpu: 1 },
  customization: {
    packages: ['nvidia-docker2', 'cuda-toolkit'],
    env: { CUDA_VISIBLE_DEVICES: 'all' }
  }
};

// Register custom template
fetch('http://localhost:3001/api/templates', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(customTemplate)
});
```

**Assessment**: Develop and deploy a custom integration or extension

#### Module 10: Operations & Troubleshooting (2 hours)
**Learning Goals**: Master operational procedures and troubleshooting

**Topics Covered**:
- Advanced troubleshooting techniques
- Performance tuning and optimization
- Capacity planning and scaling strategies
- Incident response procedures
- Maintenance and update procedures

**Hands-on Exercise**:
```bash
# Simulate and resolve common issues
# 1. Database connection failure
docker-compose stop postgres
# Diagnose and resolve

# 2. Runner registration issues
sudo systemctl stop github-runner-runnerhub-1
# Troubleshoot and fix

# 3. High memory usage
# Identify and resolve memory leaks

# 4. Performance degradation
# Use profiling tools to identify bottlenecks

# 5. Security incident response
# Simulate security alert and respond
```

**Assessment**: Successfully diagnose and resolve a series of complex issues

## 🛠️ Hands-on Labs

### Lab 1: Complete Installation (Beginner)
**Duration**: 2 hours
**Objective**: Install GitHub-RunnerHub from scratch and configure it

**Prerequisites**: 
- Linux/macOS system with Docker
- GitHub account with admin access to an organization
- Basic command line knowledge

**Tasks**:
1. Install all prerequisites
2. Clone repository and run installation
3. Configure GitHub integration  
4. Set up first runner
5. Execute test workflow
6. Verify all components working

**Success Criteria**: 
- Dashboard accessible and functional
- Runner visible and online
- Test workflow executes successfully
- All health checks pass

### Lab 2: Security Hardening (Intermediate)
**Duration**: 3 hours
**Objective**: Implement comprehensive security configuration

**Prerequisites**: 
- Completed Lab 1
- Basic understanding of Docker security
- Familiarity with security concepts

**Tasks**:
1. Enable container vulnerability scanning
2. Configure network isolation
3. Set up secret management with Vault
4. Implement audit logging
5. Configure RBAC with multiple users
6. Test security policies

**Success Criteria**:
- All security scans pass
- Network isolation working
- Secrets properly managed
- Audit trail captured
- RBAC functioning correctly

### Lab 3: Auto-Scaling Setup (Intermediate)
**Duration**: 3 hours
**Objective**: Configure and validate auto-scaling functionality

**Prerequisites**:
- Completed Lab 1
- Understanding of scaling concepts
- Access to cloud resources (optional)

**Tasks**:
1. Configure auto-scaling parameters
2. Set up demand prediction
3. Configure container pre-warming
4. Enable cost optimization
5. Generate load to test scaling
6. Monitor and tune performance

**Success Criteria**:
- Auto-scaling responds to load changes
- Cost optimization working
- Performance metrics collected
- Scaling decisions logged and justified

### Lab 4: Production Deployment (Advanced)
**Duration**: 4 hours
**Objective**: Deploy production-ready environment with HA

**Prerequisites**:
- Completed previous labs
- Understanding of HA concepts
- Production environment access

**Tasks**:
1. Deploy HA configuration
2. Set up load balancing
3. Configure database replication
4. Implement monitoring and alerting
5. Test failover scenarios
6. Create disaster recovery plan

**Success Criteria**:
- HA deployment functional
- Failover working correctly
- Monitoring and alerts configured
- DR procedures documented and tested

## 📋 Assessment Methods

### Knowledge Checks
- **Quizzes**: Multiple choice and short answer questions
- **Practical Tasks**: Hands-on configuration and operation
- **Troubleshooting**: Diagnose and resolve simulated issues
- **Design Exercises**: Architecture and configuration design

### Certification Levels

#### 🥉 Bronze: GitHub-RunnerHub Associate
**Requirements**:
- Complete Beginner modules (1-4)
- Pass knowledge assessment (80% minimum)
- Successfully complete Lab 1
- Demonstrate basic operational skills

**Skills Validated**:
- Basic installation and configuration
- Dashboard navigation and usage
- Simple workflow execution
- Basic troubleshooting

#### 🥈 Silver: GitHub-RunnerHub Professional  
**Requirements**:
- Complete Intermediate modules (5-7)
- Pass advanced knowledge assessment (85% minimum)
- Successfully complete Labs 2 and 3
- Demonstrate advanced operational skills

**Skills Validated**:
- Advanced configuration and customization
- Security implementation and management
- Auto-scaling setup and optimization
- Performance monitoring and tuning

#### 🥇 Gold: GitHub-RunnerHub Expert
**Requirements**:
- Complete Advanced modules (8-10)
- Pass expert knowledge assessment (90% minimum)
- Successfully complete Lab 4
- Complete capstone project

**Skills Validated**:
- Enterprise deployment and management
- Custom development and integration
- Advanced troubleshooting and optimization
- Architectural design and planning

### Capstone Project (Expert Level)
Design and implement a complete GitHub-RunnerHub solution for a fictional enterprise with:

- **Multi-environment deployment** (dev/staging/prod)
- **Custom integrations** with existing tools
- **Advanced security** and compliance requirements
- **Cost optimization** strategy
- **Disaster recovery** plan
- **Documentation** and runbooks

## 📚 Learning Resources

### Documentation
- [System Architecture](../architecture/SYSTEM_ARCHITECTURE.md)
- [API Reference](../api/API_REFERENCE.md)
- [User Manual](../guides/USER_MANUAL.md)
- [Security Guide](../guides/SECURITY_GUIDE.md)
- [Troubleshooting Guide](../troubleshooting/README.md)

### Video Tutorials
- Installation and Setup (30 minutes)
- Dashboard Tour (20 minutes)
- Advanced Configuration (45 minutes)
- Security Implementation (40 minutes)
- Auto-Scaling Deep Dive (60 minutes)
- Troubleshooting Workshop (90 minutes)

### Interactive Demos
- Live dashboard with sample data
- Workflow execution simulation
- Auto-scaling visualization
- Security scanning demonstration

### Community Resources
- GitHub Discussions for Q&A
- Sample workflows and configurations
- Best practices and patterns
- Real-world case studies

## 🎓 Getting Started

### Self-Paced Learning
1. **Start with Beginner Module 1** - Introduction & Concepts
2. **Set up lab environment** - Prepare your system for hands-on practice
3. **Follow the curriculum** - Progress through modules at your own pace
4. **Complete hands-on labs** - Reinforce learning with practical exercises
5. **Take assessments** - Validate your knowledge and skills

### Instructor-Led Training
- **Public workshops** - Regularly scheduled group training sessions
- **Private training** - Customized training for your organization
- **Virtual sessions** - Remote training via video conferencing
- **On-site training** - Trainer comes to your location

### Training Schedule Recommendations

#### Part-Time (2-4 hours/week): 8-12 weeks total
- **Week 1-2**: Beginner Modules 1-2, Lab 1
- **Week 3-4**: Beginner Modules 3-4, Practice
- **Week 5-6**: Intermediate Modules 5-6, Lab 2  
- **Week 7-8**: Intermediate Module 7, Lab 3
- **Week 9-10**: Advanced Modules 8-9, Lab 4
- **Week 11-12**: Advanced Module 10, Capstone Project

#### Full-Time (6-8 hours/day): 2-3 weeks total
- **Week 1**: Complete Beginner and Intermediate levels
- **Week 2**: Complete Advanced level and labs
- **Week 3**: Capstone project and certification

#### Intensive (8+ hours/day): 1 week total
- **Day 1-2**: Beginner level complete
- **Day 3-4**: Intermediate level complete  
- **Day 5**: Advanced level and final assessment

Start your GitHub-RunnerHub learning journey today and become an expert in enterprise-grade GitHub Actions management!