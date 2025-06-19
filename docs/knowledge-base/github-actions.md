# GitHub Actions - CI/CD and Self-Hosted Runners

## Overview

GitHub Actions is a continuous integration and continuous delivery (CI/CD) platform that allows you to automate your build, test, and deployment pipeline. GitHub RunnerHub leverages self-hosted runners to provide cost-effective, scalable CI/CD infrastructure.

## Official Documentation

- **Official Site**: https://docs.github.com/en/actions
- **Self-Hosted Runners**: https://docs.github.com/en/actions/hosting-your-own-runners
- **Workflow Syntax**: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions
- **API Reference**: https://docs.github.com/en/rest/actions
- **Security Hardening**: https://docs.github.com/en/actions/security-guides

## Integration with GitHub RunnerHub

### Runner Registration Flow

```javascript
// runner-manager.js
async registerRunner(repoName, runnerName) {
  // 1. Get registration token
  const token = await this.getRegistrationToken(repoName);
  
  // 2. Create runner container
  const container = await docker.createContainer({
    Image: 'myoung34/github-runner:latest',
    name: runnerName,
    Env: [
      `REPO_URL=https://github.com/${this.org}/${repoName}`,
      `RUNNER_NAME=${runnerName}`,
      `RUNNER_TOKEN=${token}`,
      `RUNNER_WORKDIR=/tmp/runner/work`,
      'RUNNER_GROUP=default',
      'LABELS=self-hosted,docker,runnerhub'
    ]
  });
  
  // 3. Start runner
  await container.start();
}
```

### Workflow Configuration

```yaml
# .github/workflows/example.yml
name: Build and Test
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: [self-hosted, docker, runnerhub]
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
      
      - name: Build
        run: npm run build
```

### Runner Labels and Selection

```yaml
# Target specific runner capabilities
runs-on: [self-hosted, docker, runnerhub, gpu]

# Target specific repository runners
runs-on: [self-hosted, repo-ProjectHub-Mcp]

# Target dynamic runners
runs-on: [self-hosted, dynamic, high-memory]
```

## Configuration Best Practices

### 1. Runner Configuration

```javascript
// Optimal runner settings
const runnerConfig = {
  // Resource limits
  HostConfig: {
    Memory: 2 * 1024 * 1024 * 1024, // 2GB
    MemorySwap: 2 * 1024 * 1024 * 1024,
    CpuShares: 1024,
    CpuQuota: 200000, // 2 CPUs
    
    // Security settings
    ReadonlyRootfs: false,
    Privileged: false,
    CapDrop: ['ALL'],
    CapAdd: ['NET_ADMIN'],
    
    // Networking
    NetworkMode: 'bridge',
    
    // Volumes
    Binds: [
      '/var/run/docker.sock:/var/run/docker.sock',
      `${RUNNER_WORK_DIR}:/tmp/runner/work`
    ]
  }
};
```

### 2. Workflow Optimization

```yaml
name: Optimized Workflow

on:
  push:
    paths-ignore:
      - '**.md'
      - 'docs/**'
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: [self-hosted, docker]
    timeout-minutes: 30
    
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # For better caching
      
      - name: Cache dependencies
        uses: actions/cache@v3
        with:
          path: |
            ~/.npm
            node_modules
          key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-node-
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'
```

### 3. Matrix Builds

```yaml
jobs:
  test:
    runs-on: [self-hosted, docker]
    strategy:
      matrix:
        node-version: [16, 18, 20]
        os: [ubuntu-latest]
      fail-fast: false
    
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
```

## Security Considerations

### 1. Runner Security

```javascript
// Secure runner configuration
const secureRunnerConfig = {
  // Use non-root user
  User: '1000:1000',
  
  // Limit capabilities
  HostConfig: {
    CapDrop: ['ALL'],
    CapAdd: ['DAC_OVERRIDE'], // Minimal required
    SecurityOpt: ['no-new-privileges'],
    ReadonlyPaths: ['/proc', '/sys'],
    
    // Resource limits
    Ulimits: [
      { Name: 'nofile', Soft: 1024, Hard: 2048 },
      { Name: 'nproc', Soft: 512, Hard: 1024 }
    ]
  }
};
```

### 2. Secrets Management

```yaml
# Store secrets in GitHub
jobs:
  deploy:
    runs-on: [self-hosted]
    steps:
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
```

### 3. OIDC Token Authentication

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: [self-hosted]
    steps:
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActions
          aws-region: us-east-1
```

## Monitoring and Debugging

### 1. Workflow Debugging

```yaml
jobs:
  debug:
    runs-on: [self-hosted]
    steps:
      - name: Dump contexts
        env:
          GITHUB_CONTEXT: ${{ toJson(github) }}
          JOB_CONTEXT: ${{ toJson(job) }}
          RUNNER_CONTEXT: ${{ toJson(runner) }}
        run: |
          echo "$GITHUB_CONTEXT"
          echo "$JOB_CONTEXT"
          echo "$RUNNER_CONTEXT"
      
      - name: Enable debug logging
        run: echo "ACTIONS_STEP_DEBUG=true" >> $GITHUB_ENV
```

### 2. Runner Monitoring

```javascript
// Monitor runner health
async monitorRunners() {
  const runners = await this.listRunners();
  
  for (const runner of runners) {
    const stats = await container.stats({ stream: false });
    
    console.log({
      name: runner.name,
      status: runner.status,
      cpu: this.calculateCPUUsage(stats),
      memory: this.calculateMemoryUsage(stats),
      uptime: this.getUptime(runner)
    });
  }
}
```

### 3. Workflow Analytics

```javascript
// Track workflow metrics
async getWorkflowMetrics(repo) {
  const { data: runs } = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner: this.org,
    repo: repo,
    per_page: 100
  });
  
  return {
    total: runs.total_count,
    success: runs.workflow_runs.filter(r => r.conclusion === 'success').length,
    failed: runs.workflow_runs.filter(r => r.conclusion === 'failure').length,
    avgDuration: this.calculateAvgDuration(runs.workflow_runs),
    queueTime: this.calculateAvgQueueTime(runs.workflow_runs)
  };
}
```

## Advanced Patterns

### 1. Composite Actions

```yaml
# .github/actions/setup-project/action.yml
name: 'Setup Project'
description: 'Setup Node.js project with caching'

inputs:
  node-version:
    description: 'Node.js version'
    required: false
    default: '18'

runs:
  using: 'composite'
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'npm'
    
    - name: Cache dependencies
      uses: actions/cache@v3
      with:
        path: node_modules
        key: deps-${{ hashFiles('package-lock.json') }}
    
    - name: Install dependencies
      shell: bash
      run: npm ci
```

### 2. Reusable Workflows

```yaml
# .github/workflows/reusable-test.yml
name: Reusable Test Workflow

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
    secrets:
      token:
        required: true

jobs:
  test:
    runs-on: [self-hosted]
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

### 3. Dynamic Job Generation

```yaml
jobs:
  setup:
    runs-on: [self-hosted]
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - id: set-matrix
        run: |
          echo "matrix={\"repo\":[\"repo1\",\"repo2\",\"repo3\"]}" >> $GITHUB_OUTPUT
  
  build:
    needs: setup
    runs-on: [self-hosted]
    strategy:
      matrix: ${{ fromJson(needs.setup.outputs.matrix) }}
    steps:
      - run: echo "Building ${{ matrix.repo }}"
```

## Performance Optimization

### 1. Caching Strategies

```yaml
- name: Cache multiple paths
  uses: actions/cache@v3
  with:
    path: |
      ~/.npm
      ~/.cache
      node_modules
      .next/cache
    key: ${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}-${{ hashFiles('**.[jt]s', '**.[jt]sx') }}
    restore-keys: |
      ${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}-
      ${{ runner.os }}-
```

### 2. Artifact Management

```yaml
- name: Upload artifacts
  uses: actions/upload-artifact@v3
  with:
    name: build-artifacts
    path: |
      dist/
      !dist/**/*.map
    retention-days: 7
    if-no-files-found: error

- name: Download artifacts
  uses: actions/download-artifact@v3
  with:
    name: build-artifacts
    path: ./dist
```

### 3. Parallel Job Execution

```yaml
jobs:
  test-unit:
    runs-on: [self-hosted]
    steps:
      - run: npm run test:unit
  
  test-integration:
    runs-on: [self-hosted]
    steps:
      - run: npm run test:integration
  
  test-e2e:
    runs-on: [self-hosted]
    steps:
      - run: npm run test:e2e
  
  report:
    needs: [test-unit, test-integration, test-e2e]
    runs-on: [self-hosted]
    if: always()
    steps:
      - run: npm run test:report
```

## API Integration

### 1. GitHub Actions API Usage

```javascript
// List workflow runs
const { data: runs } = await octokit.rest.actions.listWorkflowRunsForRepo({
  owner: 'anubissbe',
  repo: 'GitHub-RunnerHub',
  status: 'in_progress'
});

// Cancel workflow run
await octokit.rest.actions.cancelWorkflowRun({
  owner: 'anubissbe',
  repo: 'GitHub-RunnerHub',
  run_id: 123456789
});

// Re-run failed jobs
await octokit.rest.actions.reRunWorkflowFailedJobs({
  owner: 'anubissbe',
  repo: 'GitHub-RunnerHub',
  run_id: 123456789
});
```

### 2. Webhook Integration

```javascript
// Handle workflow events
app.post('/webhook', (req, res) => {
  const event = req.headers['x-github-event'];
  
  switch(event) {
    case 'workflow_run':
      handleWorkflowRun(req.body);
      break;
    case 'workflow_job':
      handleWorkflowJob(req.body);
      break;
  }
  
  res.sendStatus(200);
});
```

## Common Issues and Solutions

### 1. Runner Not Picking Up Jobs

**Problem**: Jobs stuck in queue

**Solution**:
```bash
# Check runner status
docker logs github-runner-<name>

# Verify labels match
docker exec github-runner-<name> ./config.sh --check

# Re-register runner
docker restart github-runner-<name>
```

### 2. Docker-in-Docker Issues

**Problem**: Cannot run Docker commands in workflow

**Solution**:
```yaml
jobs:
  build:
    runs-on: [self-hosted]
    container:
      image: docker:dind
      options: --privileged
    steps:
      - run: docker build .
```

### 3. Artifact Upload Failures

**Problem**: Large artifacts fail to upload

**Solution**:
```yaml
- name: Split and upload artifacts
  run: |
    split -b 1G dist.tar.gz dist.tar.gz.part
    
- name: Upload parts
  uses: actions/upload-artifact@v3
  with:
    name: dist-parts
    path: dist.tar.gz.part*
```

## Related Technologies

- GitHub API
- Docker containers
- Kubernetes (runner orchestration)
- ArgoCD (GitOps)
- Jenkins (alternative CI/CD)