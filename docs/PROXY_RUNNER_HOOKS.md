# Proxy Runner Hook Architecture

## Overview

The proxy runner uses GitHub Actions runner's hook system to intercept jobs and delegate them to ephemeral containers. This document describes the hook architecture and implementation.

## GitHub Runner Hook System

GitHub Actions runner provides several extension points through environment variables and scripts:

1. **ACTIONS_RUNNER_HOOK_JOB_STARTED** - Called when a job starts
2. **ACTIONS_RUNNER_HOOK_JOB_COMPLETED** - Called when a job completes
3. **ACTIONS_STEP_DEBUG** - Enables debug logging

## Hook Implementation Strategy

### 1. Job Interception Hook

```bash
#!/bin/bash
# Location: hooks/job-started.sh

# Extract job context from environment
JOB_ID="${GITHUB_JOB}"
RUN_ID="${GITHUB_RUN_ID}"
REPOSITORY="${GITHUB_REPOSITORY}"
WORKFLOW="${GITHUB_WORKFLOW}"
RUNNER_NAME="${RUNNER_NAME}"

# Package job context
JOB_CONTEXT=$(cat <<EOF
{
  "jobId": "${JOB_ID}",
  "runId": "${RUN_ID}",
  "repository": "${REPOSITORY}",
  "workflow": "${WORKFLOW}",
  "runnerName": "${RUNNER_NAME}",
  "labels": "${RUNNER_LABELS}",
  "environment": $(env | jq -R -s 'split("\n") | map(select(length > 0) | split("=") | {key: .[0], value: .[1]}) | from_entries')
}
EOF
)

# Delegate to orchestrator
curl -X POST ${ORCHESTRATOR_URL}/api/jobs/delegate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNNER_TOKEN}" \
  -d "${JOB_CONTEXT}"

# Block execution on proxy runner
echo "Job delegated to ephemeral container"
exit 78  # Special exit code to skip job execution
```

### 2. Job Completion Hook

```bash
#!/bin/bash
# Location: hooks/job-completed.sh

# Notify orchestrator of completion
curl -X POST ${ORCHESTRATOR_URL}/api/jobs/${GITHUB_JOB}/complete \
  -H "Authorization: Bearer ${RUNNER_TOKEN}"
```

## Proxy Runner Modifications

### 1. Runner Configuration

```typescript
// src/services/proxy-runner.ts
export interface ProxyRunnerConfig {
  name: string;
  url: string;
  token: string;
  labels: string[];
  orchestratorUrl: string;
  hookScriptsPath: string;
}

export class ProxyRunner {
  private config: ProxyRunnerConfig;
  private runnerProcess: ChildProcess | null = null;

  constructor(config: ProxyRunnerConfig) {
    this.config = config;
  }

  async configure(): Promise<void> {
    // Set up environment variables
    process.env.ACTIONS_RUNNER_HOOK_JOB_STARTED = path.join(this.config.hookScriptsPath, 'job-started.sh');
    process.env.ACTIONS_RUNNER_HOOK_JOB_COMPLETED = path.join(this.config.hookScriptsPath, 'job-completed.sh');
    process.env.ORCHESTRATOR_URL = this.config.orchestratorUrl;
    process.env.RUNNER_TOKEN = this.config.token;
    process.env.RUNNER_LABELS = this.config.labels.join(',');

    // Configure runner
    await this.executeCommand('./config.sh', [
      '--url', this.config.url,
      '--token', this.config.token,
      '--name', this.config.name,
      '--labels', this.config.labels.join(','),
      '--unattended',
      '--replace'
    ]);
  }

  async start(): Promise<void> {
    this.runnerProcess = spawn('./run.sh', [], {
      env: { ...process.env },
      stdio: 'inherit'
    });

    this.runnerProcess.on('exit', (code) => {
      logger.info(`Runner process exited with code ${code}`);
      if (code !== 0 && code !== 78) { // 78 is our delegation code
        this.restart();
      }
    });
  }
}
```

### 2. Job Context Extraction

```typescript
// src/types/job-context.ts
export interface JobContext {
  jobId: string;
  runId: string;
  repository: string;
  workflow: string;
  runnerName: string;
  labels: string[];
  environment: Record<string, string>;
  secrets?: Record<string, string>;
  matrix?: Record<string, any>;
  needs?: string[];
}

export interface DelegatedJob extends JobContext {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  containerId?: string;
  startedAt?: Date;
  completedAt?: Date;
  exitCode?: number;
  logs?: string;
}
```

## Ephemeral Runner Registration

### 1. JIT Runner Token Generation

```typescript
// src/services/github-api.ts
export class GitHubAPIService {
  async generateRunnerToken(repository: string): Promise<string> {
    const response = await this.octokit.request(
      'POST /repos/{owner}/{repo}/actions/runners/registration-token',
      {
        owner: repository.split('/')[0],
        repo: repository.split('/')[1]
      }
    );
    return response.data.token;
  }

  async removeRunner(repository: string, runnerId: number): Promise<void> {
    await this.octokit.request(
      'DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}',
      {
        owner: repository.split('/')[0],
        repo: repository.split('/')[1],
        runner_id: runnerId
      }
    );
  }
}
```

### 2. Container Runner Setup

```typescript
// src/services/container-runner.ts
export class ContainerRunner {
  async createAndRegister(job: DelegatedJob): Promise<string> {
    // Generate JIT token
    const token = await this.githubApi.generateRunnerToken(job.repository);

    // Create container with runner
    const container = await this.docker.createContainer({
      Image: 'github-runner:latest',
      name: `runner-${job.id}`,
      Env: [
        `RUNNER_TOKEN=${token}`,
        `RUNNER_NAME=ephemeral-${job.id}`,
        `RUNNER_LABELS=ephemeral,container,${job.labels.join(',')}`,
        `GITHUB_URL=https://github.com/${job.repository}`,
        `JOB_ID=${job.jobId}`,
        `RUN_ID=${job.runId}`
      ],
      HostConfig: {
        AutoRemove: true,
        NetworkMode: `${this.config.networkPrefix}-${job.repository.replace('/', '-')}`
      }
    });

    await container.start();
    return container.id;
  }
}
```

## Hook Script Installation

### Dockerfile for Proxy Runner

```dockerfile
FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    git \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Create runner user
RUN useradd -m -s /bin/bash runner && \
    usermod -aG sudo runner && \
    echo "runner ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Download GitHub runner
WORKDIR /home/runner
RUN curl -O -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz && \
    tar xzf actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz && \
    rm actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz

# Copy hook scripts
COPY hooks/ /home/runner/hooks/
RUN chmod +x /home/runner/hooks/*.sh

# Copy entrypoint
COPY docker/proxy-runner/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER runner
ENTRYPOINT ["/entrypoint.sh"]
```

## Security Considerations

1. **Token Security**: Runner tokens are never persisted, only held in memory
2. **Network Isolation**: Each job runs in an isolated network
3. **Container Security**: Containers run with minimal privileges
4. **Audit Logging**: All job delegations are logged

## Monitoring and Observability

### Metrics to Track

1. **Job Delegation Metrics**
   - Total jobs delegated
   - Delegation success/failure rate
   - Time to delegate

2. **Runner Health Metrics**
   - Proxy runner uptime
   - Hook execution success rate
   - Connection failures

### Logging

```typescript
// Enhanced logging for debugging
logger.info('Job delegation initiated', {
  jobId: job.jobId,
  repository: job.repository,
  runnerName: job.runnerName,
  labels: job.labels
});
```

## Failure Handling

1. **Delegation Failure**: Job fails on proxy runner, GitHub retries
2. **Container Creation Failure**: Job requeued with exponential backoff
3. **Network Issues**: Circuit breaker pattern for orchestrator communication

## Testing Strategy

1. **Unit Tests**: Test hook scripts with mock environment
2. **Integration Tests**: Test full delegation flow
3. **Load Tests**: Verify system handles concurrent delegations
4. **Failure Tests**: Test various failure scenarios