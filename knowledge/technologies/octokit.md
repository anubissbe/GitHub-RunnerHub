# Octokit - GitHub API Client

## Overview
Octokit is the official GitHub SDK for JavaScript/TypeScript. It provides a comprehensive, easy-to-use interface for interacting with the GitHub API, including REST API, GraphQL API, and GitHub Apps.

**Official Documentation**: https://octokit.github.io/rest.js/

## Key Concepts and Features

### Core Features
- **Complete GitHub API Coverage**: Full REST and GraphQL API support
- **Authentication Methods**: Personal tokens, OAuth, GitHub Apps
- **TypeScript Support**: Full type definitions
- **Pagination Helpers**: Automatic pagination handling
- **Rate Limiting**: Built-in rate limit handling
- **Webhooks**: Event payload validation
- **GitHub Apps**: App installation and authentication

### Technical Characteristics
- Modular plugin architecture
- Request/response hooks
- Automatic retries
- Custom endpoints support
- Enterprise GitHub support
- Browser and Node.js compatible

## Common Use Cases

1. **Repository Management**
   - Creating repositories
   - Managing branches and tags
   - File operations
   - Release management

2. **Issue and PR Operations**
   - Creating issues/PRs
   - Managing labels and milestones
   - Review management
   - Comment threads

3. **Actions and Workflows**
   - Workflow triggers
   - Secret management
   - Runner management
   - Artifact handling

4. **Organization Management**
   - Team operations
   - Member management
   - Permission control
   - Audit logs

## Best Practices

### Authentication Setup
```javascript
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

// Personal Access Token
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  baseUrl: 'https://api.github.com', // or GitHub Enterprise URL
  userAgent: 'RunnerHub/1.0.0',
  timeZone: 'UTC',
  throttle: {
    onRateLimit: (retryAfter, options) => {
      console.warn(`Rate limit hit for ${options.method} ${options.url}`);
      return true; // Retry
    },
    onSecondaryRateLimit: (retryAfter, options) => {
      console.warn(`Secondary rate limit hit for ${options.method} ${options.url}`);
      return true;
    }
  }
});

// GitHub App Authentication
const appOctokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID
  }
});

// OAuth App
const oauthOctokit = new Octokit({
  auth: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    code: authorizationCode // from OAuth flow
  }
});
```

### Error Handling
```javascript
class GitHubService {
  constructor(token) {
    this.octokit = new Octokit({ auth: token });
  }

  async safeRequest(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error.status === 404) {
        throw new Error('Resource not found');
      } else if (error.status === 403) {
        if (error.response?.headers['x-ratelimit-remaining'] === '0') {
          const resetTime = new Date(error.response.headers['x-ratelimit-reset'] * 1000);
          throw new Error(`Rate limit exceeded. Resets at ${resetTime.toISOString()}`);
        }
        throw new Error('Access forbidden');
      } else if (error.status === 401) {
        throw new Error('Authentication failed');
      } else if (error.status === 422) {
        const validationErrors = error.response?.data?.errors || [];
        throw new Error(`Validation failed: ${JSON.stringify(validationErrors)}`);
      }
      throw error;
    }
  }

  async getRepository(owner, repo) {
    return this.safeRequest(async () => {
      const { data } = await this.octokit.repos.get({ owner, repo });
      return data;
    });
  }
}
```

### Pagination Handling
```javascript
// Manual pagination
async function getAllIssues(owner, repo) {
  const issues = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await octokit.issues.listForRepo({
      owner,
      repo,
      per_page: perPage,
      page,
      state: 'all'
    });

    issues.push(...data);

    if (data.length < perPage) break;
    page++;
  }

  return issues;
}

// Using pagination helper
async function getAllIssuesWithHelper(owner, repo) {
  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: 'all',
    per_page: 100
  });

  return issues;
}

// Async iterator for memory efficiency
async function* iterateIssues(owner, repo) {
  const iterator = octokit.paginate.iterator(octokit.issues.listForRepo, {
    owner,
    repo,
    per_page: 100
  });

  for await (const { data } of iterator) {
    for (const issue of data) {
      yield issue;
    }
  }
}
```

## Integration Patterns with GitHub RunnerHub Stack

### Self-Hosted Runner Management
```javascript
class GitHubRunnerManager {
  constructor(octokit) {
    this.octokit = octokit;
  }

  async createRegistrationToken(owner, repo) {
    try {
      const { data } = await this.octokit.actions.createRegistrationTokenForRepo({
        owner,
        repo
      });

      return {
        token: data.token,
        expiresAt: data.expires_at
      };
    } catch (error) {
      throw new Error(`Failed to create registration token: ${error.message}`);
    }
  }

  async removeRunner(owner, repo, runnerId) {
    try {
      await this.octokit.actions.deleteSelfHostedRunnerFromRepo({
        owner,
        repo,
        runner_id: runnerId
      });
    } catch (error) {
      if (error.status !== 404) {
        throw new Error(`Failed to remove runner: ${error.message}`);
      }
    }
  }

  async listRunners(owner, repo) {
    const { data } = await this.octokit.actions.listSelfHostedRunnersForRepo({
      owner,
      repo,
      per_page: 100
    });

    return data.runners.map(runner => ({
      id: runner.id,
      name: runner.name,
      os: runner.os,
      status: runner.status,
      busy: runner.busy,
      labels: runner.labels.map(l => l.name)
    }));
  }

  async getRunner(owner, repo, runnerId) {
    try {
      const { data } = await this.octokit.actions.getSelfHostedRunnerForRepo({
        owner,
        repo,
        runner_id: runnerId
      });

      return data;
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async downloadRunnerPackage(owner, repo, platform = 'linux', architecture = 'x64') {
    const { data } = await this.octokit.actions.listRunnerApplicationsForRepo({
      owner,
      repo
    });

    const runner = data.find(r => 
      r.os === platform && r.architecture === architecture
    );

    if (!runner) {
      throw new Error(`No runner found for ${platform}-${architecture}`);
    }

    return {
      downloadUrl: runner.download_url,
      filename: runner.filename,
      sha256: runner.sha256_checksum
    };
  }
}
```

### Workflow and Job Management
```javascript
class WorkflowManager {
  constructor(octokit) {
    this.octokit = octokit;
  }

  async listWorkflows(owner, repo) {
    const { data } = await this.octokit.actions.listRepoWorkflows({
      owner,
      repo
    });

    return data.workflows;
  }

  async triggerWorkflow(owner, repo, workflowId, ref = 'main', inputs = {}) {
    await this.octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowId,
      ref,
      inputs
    });
  }

  async getWorkflowRuns(owner, repo, options = {}) {
    const { data } = await this.octokit.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      status: options.status,
      branch: options.branch,
      event: options.event,
      actor: options.actor,
      created: options.created,
      per_page: options.perPage || 30
    });

    return data.workflow_runs;
  }

  async getWorkflowRunJobs(owner, repo, runId) {
    const jobs = await this.octokit.paginate(
      this.octokit.actions.listJobsForWorkflowRun,
      {
        owner,
        repo,
        run_id: runId
      }
    );

    return jobs.map(job => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      runnerId: job.runner_id,
      runnerName: job.runner_name,
      runnerGroupId: job.runner_group_id,
      runnerGroupName: job.runner_group_name,
      steps: job.steps
    }));
  }

  async rerunWorkflow(owner, repo, runId) {
    await this.octokit.actions.reRunWorkflow({
      owner,
      repo,
      run_id: runId
    });
  }

  async cancelWorkflowRun(owner, repo, runId) {
    await this.octokit.actions.cancelWorkflowRun({
      owner,
      repo,
      run_id: runId
    });
  }

  async downloadJobLogs(owner, repo, jobId) {
    try {
      const { data } = await this.octokit.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: jobId
      });

      return data; // Returns log content as string
    } catch (error) {
      if (error.status === 410) {
        throw new Error('Logs have expired or been deleted');
      }
      throw error;
    }
  }
}
```

### Repository Operations
```javascript
class RepositoryService {
  constructor(octokit) {
    this.octokit = octokit;
  }

  async createRepository(options) {
    const isOrg = options.organization !== undefined;
    
    const createOptions = {
      name: options.name,
      description: options.description,
      private: options.private || false,
      auto_init: options.autoInit || false,
      gitignore_template: options.gitignoreTemplate,
      license_template: options.licenseTemplate,
      has_issues: options.hasIssues !== false,
      has_projects: options.hasProjects !== false,
      has_wiki: options.hasWiki !== false,
      allow_squash_merge: options.allowSquashMerge !== false,
      allow_merge_commit: options.allowMergeCommit !== false,
      allow_rebase_merge: options.allowRebaseMerge !== false,
      delete_branch_on_merge: options.deleteBranchOnMerge || false
    };

    let response;
    if (isOrg) {
      response = await this.octokit.repos.createInOrg({
        org: options.organization,
        ...createOptions
      });
    } else {
      response = await this.octokit.repos.createForAuthenticatedUser(createOptions);
    }

    return response.data;
  }

  async createFile(owner, repo, path, content, message, options = {}) {
    const { data } = await this.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      branch: options.branch,
      committer: options.committer || {
        name: 'RunnerHub Bot',
        email: 'bot@runnerhub.com'
      },
      author: options.author || {
        name: 'RunnerHub Bot',
        email: 'bot@runnerhub.com'
      }
    });

    return data;
  }

  async getFileContent(owner, repo, path, ref) {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref
      });

      if (Array.isArray(data)) {
        throw new Error('Path is a directory, not a file');
      }

      if (data.type !== 'file') {
        throw new Error(`Path is a ${data.type}, not a file`);
      }

      return {
        content: Buffer.from(data.content, 'base64').toString(),
        sha: data.sha,
        size: data.size,
        encoding: data.encoding
      };
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async createBranch(owner, repo, branch, fromRef = 'main') {
    // Get the SHA of the ref to branch from
    const { data: refData } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${fromRef}`
    });

    // Create new branch
    const { data } = await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: refData.object.sha
    });

    return data;
  }

  async protectBranch(owner, repo, branch, protection) {
    await this.octokit.repos.updateBranchProtection({
      owner,
      repo,
      branch,
      required_status_checks: protection.requiredStatusChecks || null,
      enforce_admins: protection.enforceAdmins || false,
      required_pull_request_reviews: protection.requiredPullRequestReviews || null,
      restrictions: protection.restrictions || null,
      allow_force_pushes: protection.allowForcePushes || false,
      allow_deletions: protection.allowDeletions || false,
      required_conversation_resolution: protection.requiredConversationResolution || false
    });
  }
}
```

### Secret Management
```javascript
class SecretsManager {
  constructor(octokit) {
    this.octokit = octokit;
  }

  async createOrUpdateRepoSecret(owner, repo, secretName, secretValue) {
    // Get the repository public key
    const { data: { key_id, key } } = await this.octokit.actions.getRepoPublicKey({
      owner,
      repo
    });

    // Encrypt the secret value
    const encryptedValue = await this.encryptSecret(secretValue, key);

    // Create or update the secret
    await this.octokit.actions.createOrUpdateRepoSecret({
      owner,
      repo,
      secret_name: secretName,
      encrypted_value: encryptedValue,
      key_id
    });
  }

  async encryptSecret(value, publicKey) {
    const { box, randomBytes } = await import('tweetnacl');
    const { encode: encodeBase64 } = await import('base64-arraybuffer');

    const messageBytes = Buffer.from(value);
    const keyBytes = Buffer.from(publicKey, 'base64');

    const nonce = randomBytes(box.nonceLength);
    const ephemeralKeyPair = box.keyPair();

    const encrypted = box(
      messageBytes,
      nonce,
      keyBytes,
      ephemeralKeyPair.secretKey
    );

    const encryptedMessage = new Uint8Array(
      ephemeralKeyPair.publicKey.length + encrypted.length
    );
    encryptedMessage.set(ephemeralKeyPair.publicKey);
    encryptedMessage.set(encrypted, ephemeralKeyPair.publicKey.length);

    return encodeBase64(encryptedMessage.buffer);
  }

  async listRepoSecrets(owner, repo) {
    const { data } = await this.octokit.actions.listRepoSecrets({
      owner,
      repo,
      per_page: 100
    });

    return data.secrets.map(secret => ({
      name: secret.name,
      createdAt: secret.created_at,
      updatedAt: secret.updated_at
    }));
  }

  async deleteRepoSecret(owner, repo, secretName) {
    await this.octokit.actions.deleteRepoSecret({
      owner,
      repo,
      secret_name: secretName
    });
  }

  async createOrUpdateOrgSecret(org, secretName, secretValue, visibility = 'all', selectedRepoIds = []) {
    const { data: { key_id, key } } = await this.octokit.actions.getOrgPublicKey({
      org
    });

    const encryptedValue = await this.encryptSecret(secretValue, key);

    await this.octokit.actions.createOrUpdateOrgSecret({
      org,
      secret_name: secretName,
      encrypted_value: encryptedValue,
      key_id,
      visibility,
      selected_repository_ids: visibility === 'selected' ? selectedRepoIds : undefined
    });
  }
}
```

## GitHub RunnerHub Specific Patterns

### Runner Registration Flow
```javascript
class RunnerRegistrationService {
  constructor(octokit, dockerService) {
    this.octokit = octokit;
    this.dockerService = dockerService;
  }

  async registerRunner(config) {
    try {
      // Step 1: Get registration token
      const { token, expiresAt } = await this.createRegistrationToken(
        config.owner,
        config.repo
      );

      // Step 2: Create runner container with token
      const container = await this.dockerService.createRunnerContainer({
        name: config.runnerName,
        image: config.runnerImage || 'ghcr.io/actions/runner:latest',
        environment: {
          RUNNER_NAME: config.runnerName,
          RUNNER_TOKEN: token,
          RUNNER_WORKDIR: '/work',
          LABELS: config.labels.join(','),
          RUNNER_GROUP: config.runnerGroup || 'default',
          DISABLE_AUTOMATIC_DEREGISTRATION: 'true'
        },
        volumes: {
          '/var/run/docker.sock': '/var/run/docker.sock',
          [`${config.workDir}`]: '/work'
        }
      });

      // Step 3: Start container and wait for registration
      await container.start();
      const runnerId = await this.waitForRegistration(
        config.owner,
        config.repo,
        config.runnerName
      );

      return {
        runnerId,
        containerId: container.id,
        runnerName: config.runnerName,
        expiresAt
      };
    } catch (error) {
      logger.error('Runner registration failed:', error);
      throw error;
    }
  }

  async waitForRegistration(owner, repo, runnerName, timeout = 60000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const runners = await this.listRunners(owner, repo);
      const runner = runners.find(r => r.name === runnerName);

      if (runner) {
        return runner.id;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Runner registration timeout');
  }

  async deregisterRunner(owner, repo, runnerId) {
    try {
      // Remove from GitHub
      await this.octokit.actions.deleteSelfHostedRunnerFromRepo({
        owner,
        repo,
        runner_id: runnerId
      });

      logger.info(`Runner ${runnerId} deregistered from GitHub`);
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }
  }
}
```

### Webhook Processing
```javascript
import { createNodeMiddleware, Webhooks } from '@octokit/webhooks';
import { createHmac } from 'crypto';

class WebhookProcessor {
  constructor(secret) {
    this.webhooks = new Webhooks({
      secret
    });

    this.setupHandlers();
  }

  setupHandlers() {
    // Workflow job events
    this.webhooks.on('workflow_job', async ({ payload }) => {
      switch (payload.action) {
        case 'queued':
          await this.handleJobQueued(payload.workflow_job);
          break;
        case 'in_progress':
          await this.handleJobInProgress(payload.workflow_job);
          break;
        case 'completed':
          await this.handleJobCompleted(payload.workflow_job);
          break;
      }
    });

    // Workflow run events
    this.webhooks.on('workflow_run', async ({ payload }) => {
      if (payload.action === 'completed') {
        await this.handleWorkflowCompleted(payload.workflow_run);
      }
    });

    // Check run events
    this.webhooks.on('check_run', async ({ payload }) => {
      if (payload.action === 'created') {
        await this.handleCheckRunCreated(payload.check_run);
      }
    });
  }

  async handleJobQueued(job) {
    logger.info(`Job queued: ${job.name} (${job.id})`);
    
    // Check if we have available runners for the job
    const requiredLabels = job.labels;
    const availableRunner = await this.findAvailableRunner(requiredLabels);

    if (!availableRunner) {
      // Scale up runners if needed
      await this.scaleUpRunners(requiredLabels);
    }
  }

  async handleJobInProgress(job) {
    logger.info(`Job in progress: ${job.name} on runner ${job.runner_name}`);
    
    // Update runner status
    await this.updateRunnerStatus(job.runner_id, 'busy');
  }

  async handleJobCompleted(job) {
    logger.info(`Job completed: ${job.name} with conclusion ${job.conclusion}`);
    
    // Update runner status
    if (job.runner_id) {
      await this.updateRunnerStatus(job.runner_id, 'idle');
    }

    // Check if runner needs maintenance
    if (job.conclusion === 'failure') {
      await this.checkRunnerHealth(job.runner_id);
    }
  }

  verifyWebhookSignature(payload, signature) {
    const hmac = createHmac('sha256', this.webhooks.secret);
    hmac.update(payload, 'utf8');
    const expectedSignature = `sha256=${hmac.digest('hex')}`;
    
    return signature === expectedSignature;
  }

  // Express middleware
  middleware() {
    return createNodeMiddleware(this.webhooks);
  }
}

// Usage in Express app
app.use('/webhooks/github', webhookProcessor.middleware());
```

### GraphQL Operations
```javascript
class GitHubGraphQLService {
  constructor(octokit) {
    this.octokit = octokit;
  }

  async getRunnerGroupsWithRunners(owner) {
    const query = `
      query($owner: String!) {
        organization(login: $owner) {
          runnerGroups(first: 100) {
            edges {
              node {
                id
                name
                visibility
                default
                runners(first: 100) {
                  edges {
                    node {
                      id
                      name
                      os
                      status
                      busy
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const { organization } = await this.octokit.graphql(query, { owner });
    
    return organization.runnerGroups.edges.map(edge => ({
      id: edge.node.id,
      name: edge.node.name,
      visibility: edge.node.visibility,
      isDefault: edge.node.default,
      runners: edge.node.runners.edges.map(r => r.node)
    }));
  }

  async getWorkflowRunDetails(owner, repo, runId) {
    const query = `
      query($owner: String!, $repo: String!, $runId: Int!) {
        repository(owner: $owner, name: $repo) {
          workflowRun(number: $runId) {
            id
            status
            conclusion
            event
            headBranch
            headSha
            workflow {
              name
              path
            }
            jobs(first: 100) {
              nodes {
                id
                name
                status
                conclusion
                startedAt
                completedAt
                runner {
                  id
                  name
                }
                steps {
                  name
                  status
                  conclusion
                  number
                }
              }
            }
          }
        }
      }
    `;

    const { repository } = await this.octokit.graphql(query, {
      owner,
      repo,
      runId
    });

    return repository.workflowRun;
  }

  async searchRepositories(query, filters = {}) {
    const gqlQuery = `
      query($query: String!, $first: Int!) {
        search(query: $query, type: REPOSITORY, first: $first) {
          repositoryCount
          edges {
            node {
              ... on Repository {
                id
                nameWithOwner
                description
                stargazerCount
                forkCount
                primaryLanguage {
                  name
                }
                updatedAt
                isPrivate
                hasActionsEnabled
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const searchQuery = this.buildSearchQuery(query, filters);
    const { search } = await this.octokit.graphql(gqlQuery, {
      query: searchQuery,
      first: filters.limit || 100
    });

    return {
      total: search.repositoryCount,
      repositories: search.edges.map(e => e.node),
      hasMore: search.pageInfo.hasNextPage,
      cursor: search.pageInfo.endCursor
    };
  }

  buildSearchQuery(base, filters) {
    let query = base;

    if (filters.language) {
      query += ` language:${filters.language}`;
    }
    if (filters.user) {
      query += ` user:${filters.user}`;
    }
    if (filters.org) {
      query += ` org:${filters.org}`;
    }
    if (filters.topic) {
      query += ` topic:${filters.topic}`;
    }
    if (filters.hasActions) {
      query += ' "github actions"';
    }

    return query;
  }
}
```

### Rate Limit Management
```javascript
class RateLimitManager {
  constructor(octokit) {
    this.octokit = octokit;
    this.limits = null;
    this.lastCheck = null;
  }

  async checkRateLimit() {
    const { data } = await this.octokit.rateLimit.get();
    
    this.limits = {
      core: {
        limit: data.rate.limit,
        remaining: data.rate.remaining,
        reset: new Date(data.rate.reset * 1000)
      },
      search: {
        limit: data.resources.search.limit,
        remaining: data.resources.search.remaining,
        reset: new Date(data.resources.search.reset * 1000)
      },
      graphql: {
        limit: data.resources.graphql.limit,
        remaining: data.resources.graphql.remaining,
        reset: new Date(data.resources.graphql.reset * 1000)
      }
    };

    this.lastCheck = new Date();
    return this.limits;
  }

  async waitForRateLimit(resource = 'core', minRemaining = 10) {
    if (!this.limits || Date.now() - this.lastCheck > 60000) {
      await this.checkRateLimit();
    }

    const limit = this.limits[resource];
    
    if (limit.remaining < minRemaining) {
      const waitTime = limit.reset.getTime() - Date.now();
      
      if (waitTime > 0) {
        logger.warn(`Rate limit low for ${resource}. Waiting ${waitTime}ms until reset.`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        await this.checkRateLimit();
      }
    }
  }

  async executeWithRateLimit(operation, resource = 'core') {
    await this.waitForRateLimit(resource);
    
    try {
      const result = await operation();
      
      // Update rate limit from response headers
      if (result.headers) {
        this.updateFromHeaders(result.headers, resource);
      }
      
      return result;
    } catch (error) {
      if (error.status === 403 && error.response?.headers['x-ratelimit-remaining'] === '0') {
        const resetTime = new Date(
          parseInt(error.response.headers['x-ratelimit-reset']) * 1000
        );
        const waitTime = resetTime.getTime() - Date.now();
        
        logger.warn(`Rate limit exceeded. Waiting ${waitTime}ms until reset.`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        return operation();
      }
      throw error;
    }
  }

  updateFromHeaders(headers, resource) {
    if (!this.limits) {
      this.limits = {};
    }

    const remaining = headers['x-ratelimit-remaining'];
    const limit = headers['x-ratelimit-limit'];
    const reset = headers['x-ratelimit-reset'];

    if (remaining && limit && reset) {
      this.limits[resource] = {
        limit: parseInt(limit),
        remaining: parseInt(remaining),
        reset: new Date(parseInt(reset) * 1000)
      };
    }
  }
}
```

## Testing with Octokit

### Mocking Octokit
```javascript
import { jest } from '@jest/globals';

const mockOctokit = {
  repos: {
    get: jest.fn(),
    createForAuthenticatedUser: jest.fn(),
    listForUser: jest.fn()
  },
  actions: {
    createRegistrationTokenForRepo: jest.fn(),
    listSelfHostedRunnersForRepo: jest.fn(),
    deleteSelfHostedRunnerFromRepo: jest.fn()
  },
  paginate: jest.fn()
};

describe('GitHubService', () => {
  let githubService;

  beforeEach(() => {
    githubService = new GitHubService(mockOctokit);
  });

  test('should create repository', async () => {
    const mockRepo = {
      id: 123,
      name: 'test-repo',
      full_name: 'user/test-repo'
    };

    mockOctokit.repos.createForAuthenticatedUser.mockResolvedValue({
      data: mockRepo
    });

    const result = await githubService.createRepository({
      name: 'test-repo',
      private: true
    });

    expect(result).toEqual(mockRepo);
    expect(mockOctokit.repos.createForAuthenticatedUser).toHaveBeenCalledWith({
      name: 'test-repo',
      private: true
    });
  });
});
```

### Integration Testing
```javascript
describe('GitHub API Integration', () => {
  let octokit;
  const testRepoName = `test-repo-${Date.now()}`;

  beforeAll(() => {
    octokit = new Octokit({
      auth: process.env.GITHUB_TEST_TOKEN
    });
  });

  afterAll(async () => {
    // Cleanup test repository
    try {
      await octokit.repos.delete({
        owner: process.env.GITHUB_TEST_USER,
        repo: testRepoName
      });
    } catch (error) {
      // Ignore if already deleted
    }
  });

  test('should create and configure repository', async () => {
    // Create repository
    const { data: repo } = await octokit.repos.createForAuthenticatedUser({
      name: testRepoName,
      auto_init: true
    });

    expect(repo.name).toBe(testRepoName);

    // Add a file
    await octokit.repos.createOrUpdateFileContents({
      owner: repo.owner.login,
      repo: repo.name,
      path: 'README.md',
      message: 'Initial commit',
      content: Buffer.from('# Test Repository').toString('base64')
    });

    // Verify file exists
    const { data: file } = await octokit.repos.getContent({
      owner: repo.owner.login,
      repo: repo.name,
      path: 'README.md'
    });

    expect(file.type).toBe('file');
  });
});
```

## Performance Optimization

### Request Caching
```javascript
class CachedOctokit {
  constructor(octokit, cache) {
    this.octokit = octokit;
    this.cache = cache;
  }

  async getRepository(owner, repo) {
    const cacheKey = `repo:${owner}/${repo}`;
    const cached = await this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 300000) { // 5 minutes
      return cached.data;
    }

    const { data } = await this.octokit.repos.get({ owner, repo });
    
    await this.cache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });

    return data;
  }

  async invalidateCache(patterns) {
    for (const pattern of patterns) {
      await this.cache.deletePattern(pattern);
    }
  }
}
```

### Batch Operations
```javascript
class BatchGitHubOperations {
  constructor(octokit) {
    this.octokit = octokit;
  }

  async batchCreateIssues(owner, repo, issues) {
    const results = [];
    const batchSize = 10; // Avoid rate limits

    for (let i = 0; i < issues.length; i += batchSize) {
      const batch = issues.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(issue => 
          this.octokit.issues.create({
            owner,
            repo,
            title: issue.title,
            body: issue.body,
            labels: issue.labels,
            assignees: issue.assignees
          })
        )
      );

      results.push(...batchResults);

      // Delay between batches
      if (i + batchSize < issues.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  async parallelRepositoryOperations(repos, operation) {
    const concurrency = 5;
    const results = [];

    for (let i = 0; i < repos.length; i += concurrency) {
      const batch = repos.slice(i, i + concurrency);
      
      const batchResults = await Promise.allSettled(
        batch.map(repo => operation(repo))
      );

      results.push(...batchResults);
    }

    return results;
  }
}
```

## Resources
- [Octokit.js Documentation](https://octokit.github.io/rest.js/)
- [GitHub REST API Documentation](https://docs.github.com/en/rest)
- [GitHub GraphQL API Documentation](https://docs.github.com/en/graphql)
- [GitHub Apps Documentation](https://docs.github.com/en/developers/apps)
- [Octokit Authentication Strategies](https://github.com/octokit/auth.js)