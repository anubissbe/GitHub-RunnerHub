import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import database from './database';
import runnerPoolManager from './runner-pool-manager';
import { DelegatedJob, Runner, JobStatus } from '../types';

const logger = createLogger('JobRouter');

export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  conditions: {
    labels?: string[];
    repository?: string;
    workflow?: string;
    branch?: string;
    event?: string;
  };
  targets: {
    runnerLabels: string[];
    poolOverride?: string;
    exclusive?: boolean;
  };
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoutingDecision {
  job: DelegatedJob;
  matchedRule?: RoutingRule;
  targetRunners: Runner[];
  poolName: string;
  reason: string;
}

export class JobRouter extends EventEmitter {
  private static instance: JobRouter;
  private routingRules: Map<string, RoutingRule> = new Map();
  private labelIndex: Map<string, Set<string>> = new Map(); // label -> rule IDs

  private constructor() {
    super();
  }

  public static getInstance(): JobRouter {
    if (!JobRouter.instance) {
      JobRouter.instance = new JobRouter();
    }
    return JobRouter.instance;
  }

  /**
   * Initialize the job router
   */
  async initialize(): Promise<void> {
    logger.info('Initializing job router');

    try {
      // Load routing rules from database
      await this.loadRoutingRules();

      // Set up periodic rule refresh
      setInterval(() => this.loadRoutingRules(), 60000); // Every minute

      logger.info('Job router initialized', {
        rulesLoaded: this.routingRules.size
      });
    } catch (error) {
      logger.error('Failed to initialize job router', { error });
      throw error;
    }
  }

  /**
   * Load routing rules from database
   */
  private async loadRoutingRules(): Promise<void> {
    try {
      const rules = await database.query<RoutingRule>(`
        SELECT 
          id,
          name,
          priority,
          conditions,
          targets,
          enabled,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM runnerhub.routing_rules
        WHERE enabled = true
        ORDER BY priority DESC, created_at ASC
      `);

      // Clear existing rules
      this.routingRules.clear();
      this.labelIndex.clear();

      // Load new rules and build index
      for (const rule of rules) {
        this.routingRules.set(rule.id, rule);

        // Index by labels for fast lookup
        if (rule.conditions.labels) {
          for (const label of rule.conditions.labels) {
            if (!this.labelIndex.has(label)) {
              this.labelIndex.set(label, new Set());
            }
            this.labelIndex.get(label)!.add(rule.id);
          }
        }
      }

      logger.debug('Routing rules loaded', {
        count: rules.length,
        labelIndexSize: this.labelIndex.size
      });
    } catch (error) {
      logger.error('Failed to load routing rules', { error });
    }
  }

  /**
   * Route a job to appropriate runners
   */
  async routeJob(job: DelegatedJob): Promise<RoutingDecision> {
    logger.info('Routing job', {
      jobId: job.id,
      repository: job.repository,
      labels: job.labels
    });

    try {
      // Find matching routing rules
      const matchedRule = await this.findMatchingRule(job);

      if (matchedRule) {
        // Apply routing rule
        return await this.applyRoutingRule(job, matchedRule);
      } else {
        // Default routing based on repository
        return await this.applyDefaultRouting(job);
      }
    } catch (error) {
      logger.error('Failed to route job', {
        jobId: job.id,
        error
      });

      // Fallback to default routing
      return await this.applyDefaultRouting(job);
    }
  }

  /**
   * Find the best matching routing rule for a job
   */
  private async findMatchingRule(job: DelegatedJob): Promise<RoutingRule | null> {
    const candidateRules: RoutingRule[] = [];

    // Quick lookup by labels
    if (job.labels && job.labels.length > 0) {
      const ruleIds = new Set<string>();
      
      for (const label of job.labels) {
        const labelRules = this.labelIndex.get(label);
        if (labelRules) {
          labelRules.forEach(id => ruleIds.add(id));
        }
      }

      // Check each candidate rule
      for (const ruleId of ruleIds) {
        const rule = this.routingRules.get(ruleId);
        if (rule && this.matchesRule(job, rule)) {
          candidateRules.push(rule);
        }
      }
    }

    // Also check rules without label conditions
    for (const rule of this.routingRules.values()) {
      if (!rule.conditions.labels && this.matchesRule(job, rule)) {
        candidateRules.push(rule);
      }
    }

    // Sort by priority (highest first) and return the best match
    candidateRules.sort((a, b) => b.priority - a.priority);
    
    if (candidateRules.length > 0) {
      const selected = candidateRules[0];
      logger.info('Matched routing rule', {
        jobId: job.id,
        ruleId: selected.id,
        ruleName: selected.name,
        priority: selected.priority
      });
      return selected;
    }

    return null;
  }

  /**
   * Check if a job matches a routing rule
   */
  private matchesRule(job: DelegatedJob, rule: RoutingRule): boolean {
    const conditions = rule.conditions;

    // Check repository match
    if (conditions.repository && 
        !this.matchesPattern(job.repository, conditions.repository)) {
      return false;
    }

    // Check workflow match
    if (conditions.workflow && 
        !this.matchesPattern(job.workflow, conditions.workflow)) {
      return false;
    }

    // Check branch match
    if (conditions.branch && job.ref) {
      const branch = job.ref.replace('refs/heads/', '');
      if (!this.matchesPattern(branch, conditions.branch)) {
        return false;
      }
    }

    // Check event match
    if (conditions.event && job.eventName &&
        conditions.event !== job.eventName) {
      return false;
    }

    // Check labels match (job must have all required labels)
    if (conditions.labels && conditions.labels.length > 0) {
      if (!job.labels || job.labels.length === 0) {
        return false;
      }

      const jobLabelSet = new Set(job.labels);
      for (const requiredLabel of conditions.labels) {
        if (!jobLabelSet.has(requiredLabel)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if a string matches a pattern (supports wildcards)
   */
  private matchesPattern(str: string, pattern: string): boolean {
    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
      .replace(/\*/g, '.*'); // Replace * with .*
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(str);
  }

  /**
   * Apply a routing rule to find target runners
   */
  private async applyRoutingRule(
    job: DelegatedJob,
    rule: RoutingRule
  ): Promise<RoutingDecision> {
    const poolName = rule.targets.poolOverride || job.repository;
    await runnerPoolManager.getOrCreatePool(poolName);

    // Find runners with matching labels
    const allRunners = await runnerPoolManager.getActiveRunners(poolName);
    const targetRunners = allRunners.filter((runner: Runner) => {
      if (!runner.labels) return false;

      const runnerLabelSet = new Set(runner.labels);
      
      // Check if runner has all required labels
      for (const requiredLabel of rule.targets.runnerLabels) {
        if (!runnerLabelSet.has(requiredLabel)) {
          return false;
        }
      }

      // If exclusive, runner should only have the required labels
      if (rule.targets.exclusive) {
        return runnerLabelSet.size === rule.targets.runnerLabels.length;
      }

      return true;
    });

    // Record routing decision
    await this.recordRoutingDecision(job.id, rule.id, targetRunners.length);

    this.emit('job-routed', {
      jobId: job.id,
      ruleId: rule.id,
      ruleName: rule.name,
      targetCount: targetRunners.length
    });

    return {
      job,
      matchedRule: rule,
      targetRunners,
      poolName,
      reason: `Matched rule: ${rule.name} (priority: ${rule.priority})`
    };
  }

  /**
   * Apply default routing when no rules match
   */
  private async applyDefaultRouting(job: DelegatedJob): Promise<RoutingDecision> {
    const poolName = job.repository;
    await runnerPoolManager.getOrCreatePool(poolName);
    const targetRunners = await runnerPoolManager.getActiveRunners(poolName);

    // If job has labels, try to find runners with matching labels
    let filteredRunners = targetRunners;
    if (job.labels && job.labels.length > 0) {
      const jobLabelSet = new Set(job.labels);
      
      filteredRunners = targetRunners.filter((runner: Runner) => {
        if (!runner.labels) return false;
        
        const runnerLabelSet = new Set(runner.labels);
        // Runner must have at least one matching label
        for (const label of jobLabelSet) {
          if (runnerLabelSet.has(label)) {
            return true;
          }
        }
        return false;
      });

      // If no runners match labels, fall back to all runners
      if (filteredRunners.length === 0) {
        logger.warn('No runners match job labels, using all runners', {
          jobId: job.id,
          jobLabels: job.labels
        });
        filteredRunners = targetRunners;
      }
    }

    return {
      job,
      matchedRule: undefined,
      targetRunners: filteredRunners,
      poolName,
      reason: 'Default routing - no matching rules'
    };
  }

  /**
   * Record routing decision for analytics
   */
  private async recordRoutingDecision(
    jobId: string,
    ruleId: string | null,
    targetCount: number
  ): Promise<void> {
    try {
      await database.query(`
        INSERT INTO runnerhub.routing_decisions (
          job_id,
          rule_id,
          target_count,
          created_at
        ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      `, [jobId, ruleId, targetCount]);
    } catch (error) {
      logger.error('Failed to record routing decision', { error });
    }
  }

  /**
   * Create a new routing rule
   */
  async createRoutingRule(rule: Omit<RoutingRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<RoutingRule> {
    const [created] = await database.query<RoutingRule>(`
      INSERT INTO runnerhub.routing_rules (
        name,
        priority,
        conditions,
        targets,
        enabled
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING 
        id,
        name,
        priority,
        conditions,
        targets,
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `, [
      rule.name,
      rule.priority,
      JSON.stringify(rule.conditions),
      JSON.stringify(rule.targets),
      rule.enabled
    ]);

    // Reload rules to update cache
    await this.loadRoutingRules();

    logger.info('Created routing rule', {
      ruleId: created.id,
      name: created.name
    });

    return created;
  }

  /**
   * Update an existing routing rule
   */
  async updateRoutingRule(
    ruleId: string,
    updates: Partial<Omit<RoutingRule, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<RoutingRule> {
    const setClause: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (updates.name !== undefined) {
      setClause.push(`name = $${paramCount++}`);
      values.push(updates.name);
    }
    if (updates.priority !== undefined) {
      setClause.push(`priority = $${paramCount++}`);
      values.push(updates.priority);
    }
    if (updates.conditions !== undefined) {
      setClause.push(`conditions = $${paramCount++}`);
      values.push(JSON.stringify(updates.conditions));
    }
    if (updates.targets !== undefined) {
      setClause.push(`targets = $${paramCount++}`);
      values.push(JSON.stringify(updates.targets));
    }
    if (updates.enabled !== undefined) {
      setClause.push(`enabled = $${paramCount++}`);
      values.push(updates.enabled);
    }

    values.push(ruleId);

    const [updated] = await database.query<RoutingRule>(`
      UPDATE runnerhub.routing_rules
      SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING 
        id,
        name,
        priority,
        conditions,
        targets,
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `, values);

    // Reload rules to update cache
    await this.loadRoutingRules();

    logger.info('Updated routing rule', {
      ruleId: updated.id,
      name: updated.name
    });

    return updated;
  }

  /**
   * Delete a routing rule
   */
  async deleteRoutingRule(ruleId: string): Promise<void> {
    await database.query(`
      DELETE FROM runnerhub.routing_rules
      WHERE id = $1
    `, [ruleId]);

    // Reload rules to update cache
    await this.loadRoutingRules();

    logger.info('Deleted routing rule', { ruleId });
  }

  /**
   * Get all routing rules
   */
  async getRoutingRules(): Promise<RoutingRule[]> {
    return Array.from(this.routingRules.values());
  }

  /**
   * Get routing analytics
   */
  async getRoutingAnalytics(hours: number = 24): Promise<any> {
    const result = await database.query(`
      SELECT 
        rr.id as rule_id,
        rr.name as rule_name,
        COUNT(rd.id) as match_count,
        AVG(rd.target_count) as avg_targets,
        MAX(rd.created_at) as last_matched
      FROM runnerhub.routing_rules rr
      LEFT JOIN runnerhub.routing_decisions rd ON rr.id = rd.rule_id
        AND rd.created_at >= CURRENT_TIMESTAMP - INTERVAL '${hours} hours'
      GROUP BY rr.id, rr.name
      ORDER BY match_count DESC
    `);

    return result;
  }

  /**
   * Test a routing rule with a sample job
   */
  async testRoutingRule(
    rule: Omit<RoutingRule, 'id' | 'createdAt' | 'updatedAt'>,
    sampleJob: Partial<DelegatedJob>
  ): Promise<{
    matches: boolean;
    targetRunners: Runner[];
    reason: string;
  }> {
    // Create a temporary rule for testing
    const testRule: RoutingRule = {
      ...rule,
      id: 'test',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Create a test job
    const testJob: DelegatedJob = {
      id: 'test-job',
      githubJobId: 1,
      jobId: 'test-job-id',
      runId: String(sampleJob.runId || 1),
      repository: sampleJob.repository || 'test/repo',
      workflow: sampleJob.workflow || 'test-workflow',
      runnerName: 'test-runner',
      status: JobStatus.PENDING,
      labels: sampleJob.labels || []
    };

    // Test if job matches rule
    const matches = this.matchesRule(testJob, testRule);

    if (!matches) {
      return {
        matches: false,
        targetRunners: [],
        reason: 'Job does not match rule conditions'
      };
    }

    // Find target runners
    const poolName = testRule.targets.poolOverride || testJob.repository;
    const allRunners = await runnerPoolManager.getActiveRunners(poolName);
    
    const targetRunners = allRunners.filter((runner: Runner) => {
      if (!runner.labels) return false;

      const runnerLabelSet = new Set(runner.labels);
      
      for (const requiredLabel of testRule.targets.runnerLabels) {
        if (!runnerLabelSet.has(requiredLabel)) {
          return false;
        }
      }

      if (testRule.targets.exclusive) {
        return runnerLabelSet.size === testRule.targets.runnerLabels.length;
      }

      return true;
    });

    return {
      matches: true,
      targetRunners,
      reason: `Rule matches - found ${targetRunners.length} target runners`
    };
  }

  /**
   * Shutdown the job router
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down job router');
    this.routingRules.clear();
    this.labelIndex.clear();
  }
}

export default JobRouter.getInstance();