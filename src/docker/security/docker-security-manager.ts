import { createLogger } from '../../utils/logger';
import { DockerClient } from '../docker-client';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

const logger = createLogger('DockerSecurityManager');

export interface SecurityPolicyConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  level: SecurityLevel;
  enforcement: EnforcementMode;
  rules: SecurityRule[];
  exceptions: SecurityException[];
  metadata: PolicyMetadata;
}

export interface SecurityRule {
  id: string;
  name: string;
  type: SecurityRuleType;
  category: SecurityCategory;
  severity: SecuritySeverity;
  target: SecurityTarget;
  conditions: SecurityCondition[];
  actions: SecurityAction[];
  enabled: boolean;
  priority: number;
}

export interface SecurityCondition {
  type: ConditionType;
  operator: ConditionOperator;
  value: any;
  field?: string;
}

export interface SecurityAction {
  type: ActionType;
  parameters: Record<string, any>;
  order: number;
  timeout?: number;
  retries?: number;
}

export interface SecurityException {
  id: string;
  ruleId: string;
  target: string;
  reason: string;
  expiresAt?: Date;
  approvedBy: string;
  createdAt: Date;
}

export interface PolicyMetadata {
  author: string;
  created: Date;
  updated: Date;
  tags: string[];
  compliance: ComplianceFramework[];
  requiredCapabilities: string[];
  supportedPlatforms: string[];
}

export interface SecurityScanResult {
  id: string;
  containerId: string;
  imageId: string;
  scanType: ScanType;
  status: ScanStatus;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  findings: SecurityFinding[];
  summary: ScanSummary;
  metadata: ScanMetadata;
}

export interface SecurityFinding {
  id: string;
  type: FindingType;
  severity: SecuritySeverity;
  category: SecurityCategory;
  title: string;
  description: string;
  location: FindingLocation;
  remediation: RemediationAdvice;
  compliance: ComplianceViolation[];
  references: string[];
}

export interface FindingLocation {
  file?: string;
  line?: number;
  layer?: string;
  component?: string;
  package?: string;
  version?: string;
}

export interface RemediationAdvice {
  action: string;
  description: string;
  priority: RemediationPriority;
  effort: RemediationEffort;
  commands?: string[];
  links?: string[];
}

export interface ComplianceViolation {
  framework: ComplianceFramework;
  control: string;
  description: string;
  impact: ComplianceImpact;
}

export interface ScanSummary {
  totalFindings: number;
  criticalFindings: number;
  highFindings: number;
  mediumFindings: number;
  lowFindings: number;
  infoFindings: number;
  score: number;
  grade: SecurityGrade;
}

export interface ScanMetadata {
  scanner: string;
  scannerVersion: string;
  databaseVersion: string;
  rulesVersion: string;
  platform: string;
  environment: string;
}

export interface ContainerSecurityProfile {
  containerId: string;
  imageId: string;
  policies: string[];
  enforcements: ActiveEnforcement[];
  scans: SecurityScanResult[];
  violations: SecurityViolation[];
  status: SecurityStatus;
  riskScore: number;
  lastAssessment: Date;
  configuration: ContainerSecurityConfig;
}

export interface ActiveEnforcement {
  ruleId: string;
  policyId: string;
  actionType: ActionType;
  status: EnforcementStatus;
  appliedAt: Date;
  details: Record<string, any>;
}

export interface SecurityViolation {
  id: string;
  ruleId: string;
  containerId: string;
  type: ViolationType;
  severity: SecuritySeverity;
  description: string;
  detectedAt: Date;
  resolved: boolean;
  resolvedAt?: Date;
  resolution?: string;
}

export interface ContainerSecurityConfig {
  securityContext: SecurityContext;
  networkPolicies: NetworkSecurityPolicy[];
  resourceLimits: SecurityResourceLimits;
  accessControls: AccessControl[];
  monitoring: SecurityMonitoring;
}

export interface SecurityContext {
  runAsUser: number;
  runAsGroup: number;
  runAsNonRoot: boolean;
  readOnlyRootFilesystem: boolean;
  allowPrivilegeEscalation: boolean;
  privileged: boolean;
  capabilities: CapabilityConfig;
  seLinuxOptions: SELinuxOptions;
  seccompProfile: SeccompProfile;
  apparmorProfile: string;
}

export interface CapabilityConfig {
  add: string[];
  drop: string[];
}

export interface SELinuxOptions {
  user: string;
  role: string;
  type: string;
  level: string;
}

export interface SeccompProfile {
  type: 'RuntimeDefault' | 'Localhost' | 'Unconfined';
  localhostProfile?: string;
}

export interface NetworkSecurityPolicy {
  id: string;
  name: string;
  allowedPorts: PortRange[];
  blockedPorts: PortRange[];
  allowedHosts: string[];
  blockedHosts: string[];
  allowedProtocols: Protocol[];
  dnsPolicy: DNSPolicy;
}

export interface PortRange {
  from: number;
  to: number;
  protocol: Protocol;
}

export interface SecurityResourceLimits {
  cpu: ResourceLimit;
  memory: ResourceLimit;
  storage: ResourceLimit;
  network: NetworkLimit;
  fileDescriptors: ResourceLimit;
  processes: ResourceLimit;
}

export interface ResourceLimit {
  min?: string;
  max: string;
  default?: string;
  request?: string;
}

export interface NetworkLimit {
  bandwidth: string;
  connections: number;
  dnsQueries: number;
}

export interface AccessControl {
  id: string;
  type: AccessControlType;
  principal: string;
  resource: string;
  permissions: Permission[];
  conditions: AccessCondition[];
}

export interface AccessCondition {
  type: 'time' | 'ip' | 'location' | 'mfa';
  value: any;
}

export interface SecurityMonitoring {
  enabled: boolean;
  realTimeScanning: boolean;
  behaviorAnalysis: boolean;
  anomalyDetection: boolean;
  compliance: boolean;
  auditLogging: boolean;
  alerting: AlertingConfig;
}

export interface AlertingConfig {
  enabled: boolean;
  channels: AlertChannel[];
  thresholds: AlertThreshold[];
  escalation: EscalationPolicy;
}

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook' | 'sms';
  config: Record<string, any>;
  enabled: boolean;
}

export interface AlertThreshold {
  severity: SecuritySeverity;
  count: number;
  window: string;
  action: 'notify' | 'quarantine' | 'terminate';
}

export interface EscalationPolicy {
  enabled: boolean;
  levels: EscalationLevel[];
}

export interface EscalationLevel {
  level: number;
  delay: string;
  channels: string[];
  condition: string;
}

export enum SecurityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum EnforcementMode {
  PERMISSIVE = 'permissive',
  DETECTION = 'detection',
  ENFORCEMENT = 'enforcement',
  BLOCKING = 'blocking'
}

export enum SecurityRuleType {
  VULNERABILITY = 'vulnerability',
  COMPLIANCE = 'compliance',
  CONFIGURATION = 'configuration',
  BEHAVIOR = 'behavior',
  ACCESS = 'access',
  NETWORK = 'network',
  RESOURCE = 'resource'
}

export enum SecurityCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  CRYPTOGRAPHY = 'cryptography',
  DATA_PROTECTION = 'data_protection',
  NETWORK_SECURITY = 'network_security',
  SYSTEM_SECURITY = 'system_security',
  APPLICATION_SECURITY = 'application_security',
  COMPLIANCE = 'compliance'
}

export enum SecuritySeverity {
  INFO = 'info',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum SecurityTarget {
  CONTAINER = 'container',
  IMAGE = 'image',
  NETWORK = 'network',
  VOLUME = 'volume',
  HOST = 'host',
  REGISTRY = 'registry'
}

export enum ConditionType {
  IMAGE_NAME = 'image_name',
  IMAGE_TAG = 'image_tag',
  REGISTRY = 'registry',
  LABEL = 'label',
  ENVIRONMENT = 'environment',
  PORT = 'port',
  VOLUME = 'volume',
  CAPABILITY = 'capability',
  USER = 'user',
  COMMAND = 'command'
}

export enum ConditionOperator {
  EQUALS = 'equals',
  NOT_EQUALS = 'not_equals',
  CONTAINS = 'contains',
  NOT_CONTAINS = 'not_contains',
  STARTS_WITH = 'starts_with',
  ENDS_WITH = 'ends_with',
  MATCHES = 'matches',
  GREATER_THAN = 'greater_than',
  LESS_THAN = 'less_than',
  IN = 'in',
  NOT_IN = 'not_in'
}

export enum ActionType {
  BLOCK = 'block',
  QUARANTINE = 'quarantine',
  ALERT = 'alert',
  LOG = 'log',
  SCAN = 'scan',
  PATCH = 'patch',
  REMOVE = 'remove',
  ISOLATE = 'isolate',
  TERMINATE = 'terminate'
}

export enum ScanType {
  VULNERABILITY = 'vulnerability',
  CONFIGURATION = 'configuration',
  COMPLIANCE = 'compliance',
  MALWARE = 'malware',
  SECRETS = 'secrets',
  LICENSE = 'license'
}

export enum ScanStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export enum FindingType {
  VULNERABILITY = 'vulnerability',
  CONFIGURATION_ISSUE = 'configuration_issue',
  COMPLIANCE_VIOLATION = 'compliance_violation',
  MALWARE = 'malware',
  SECRET = 'secret',
  LICENSE_ISSUE = 'license_issue'
}

export enum ComplianceFramework {
  SOC2 = 'soc2',
  ISO27001 = 'iso27001',
  NIST = 'nist',
  GDPR = 'gdpr',
  HIPAA = 'hipaa',
  PCI_DSS = 'pci_dss',
  CIS = 'cis',
  OWASP = 'owasp'
}

export enum ComplianceImpact {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum RemediationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum RemediationEffort {
  TRIVIAL = 'trivial',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  VERY_HIGH = 'very_high'
}

export enum SecurityGrade {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
  F = 'F'
}

export enum SecurityStatus {
  SECURE = 'secure',
  WARNING = 'warning',
  CRITICAL = 'critical',
  COMPROMISED = 'compromised',
  QUARANTINED = 'quarantined'
}

export enum EnforcementStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
  FAILED = 'failed'
}

export enum ViolationType {
  POLICY_VIOLATION = 'policy_violation',
  CONFIGURATION_DRIFT = 'configuration_drift',
  UNAUTHORIZED_ACCESS = 'unauthorized_access',
  MALICIOUS_ACTIVITY = 'malicious_activity',
  COMPLIANCE_VIOLATION = 'compliance_violation'
}

export enum Protocol {
  TCP = 'tcp',
  UDP = 'udp',
  ICMP = 'icmp',
  ALL = 'all'
}

export enum DNSPolicy {
  CLUSTER_FIRST = 'ClusterFirst',
  CLUSTER_FIRST_WITH_HOST_NET = 'ClusterFirstWithHostNet',
  DEFAULT = 'Default',
  NONE = 'None'
}

export enum AccessControlType {
  RBAC = 'rbac',
  ABAC = 'abac',
  DAC = 'dac',
  MAC = 'mac'
}

export enum Permission {
  READ = 'read',
  WRITE = 'write',
  EXECUTE = 'execute',
  DELETE = 'delete',
  CREATE = 'create',
  ADMIN = 'admin'
}

export class DockerSecurityManager extends EventEmitter {
  private static instance: DockerSecurityManager;
  private dockerClient: DockerClient;
  private policies: Map<string, SecurityPolicyConfig> = new Map();
  private containerProfiles: Map<string, ContainerSecurityProfile> = new Map();
  private _scanResults: Map<string, SecurityScanResult[]> = new Map();
  private _violations: Map<string, SecurityViolation[]> = new Map();
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;

  private constructor() {
    super();
    this.dockerClient = DockerClient.getInstance();
    this.initializeDefaultPolicies();
  }

  public static getInstance(): DockerSecurityManager {
    if (!DockerSecurityManager.instance) {
      DockerSecurityManager.instance = new DockerSecurityManager();
    }
    return DockerSecurityManager.instance;
  }

  /**
   * Initialize default security policies
   */
  private initializeDefaultPolicies(): void {
    logger.info('Initializing default security policies');

    // High Security Policy
    this.registerPolicy({
      id: 'high-security-policy',
      name: 'High Security Policy',
      description: 'Comprehensive security policy for production environments',
      version: '1.0.0',
      enabled: true,
      level: SecurityLevel.HIGH,
      enforcement: EnforcementMode.ENFORCEMENT,
      rules: [
        {
          id: 'no-privileged-containers',
          name: 'No Privileged Containers',
          type: SecurityRuleType.CONFIGURATION,
          category: SecurityCategory.SYSTEM_SECURITY,
          severity: SecuritySeverity.HIGH,
          target: SecurityTarget.CONTAINER,
          conditions: [
            {
              type: ConditionType.LABEL,
              operator: ConditionOperator.EQUALS,
              value: true,
              field: 'privileged'
            }
          ],
          actions: [
            {
              type: ActionType.BLOCK,
              parameters: { message: 'Privileged containers are not allowed' },
              order: 1
            }
          ],
          enabled: true,
          priority: 100
        },
        {
          id: 'no-root-user',
          name: 'No Root User',
          type: SecurityRuleType.CONFIGURATION,
          category: SecurityCategory.SYSTEM_SECURITY,
          severity: SecuritySeverity.MEDIUM,
          target: SecurityTarget.CONTAINER,
          conditions: [
            {
              type: ConditionType.USER,
              operator: ConditionOperator.EQUALS,
              value: '0'
            }
          ],
          actions: [
            {
              type: ActionType.ALERT,
              parameters: { severity: 'medium' },
              order: 1
            }
          ],
          enabled: true,
          priority: 80
        },
        {
          id: 'readonly-root-filesystem',
          name: 'Read-only Root Filesystem',
          type: SecurityRuleType.CONFIGURATION,
          category: SecurityCategory.SYSTEM_SECURITY,
          severity: SecuritySeverity.MEDIUM,
          target: SecurityTarget.CONTAINER,
          conditions: [
            {
              type: ConditionType.LABEL,
              operator: ConditionOperator.NOT_EQUALS,
              value: true,
              field: 'readOnlyRootFilesystem'
            }
          ],
          actions: [
            {
              type: ActionType.LOG,
              parameters: { level: 'warning' },
              order: 1
            }
          ],
          enabled: true,
          priority: 60
        }
      ],
      exceptions: [],
      metadata: {
        author: 'GitHub RunnerHub Security Team',
        created: new Date(),
        updated: new Date(),
        tags: ['production', 'high-security', 'compliance'],
        compliance: [ComplianceFramework.SOC2, ComplianceFramework.ISO27001],
        requiredCapabilities: [],
        supportedPlatforms: ['linux', 'windows']
      }
    });

    // Development Policy
    this.registerPolicy({
      id: 'development-policy',
      name: 'Development Security Policy',
      description: 'Balanced security policy for development environments',
      version: '1.0.0',
      enabled: true,
      level: SecurityLevel.MEDIUM,
      enforcement: EnforcementMode.DETECTION,
      rules: [
        {
          id: 'scan-vulnerabilities',
          name: 'Scan for Vulnerabilities',
          type: SecurityRuleType.VULNERABILITY,
          category: SecurityCategory.APPLICATION_SECURITY,
          severity: SecuritySeverity.HIGH,
          target: SecurityTarget.IMAGE,
          conditions: [],
          actions: [
            {
              type: ActionType.SCAN,
              parameters: { scanType: 'vulnerability' },
              order: 1
            }
          ],
          enabled: true,
          priority: 90
        },
        {
          id: 'check-secrets',
          name: 'Check for Exposed Secrets',
          type: SecurityRuleType.CONFIGURATION,
          category: SecurityCategory.DATA_PROTECTION,
          severity: SecuritySeverity.CRITICAL,
          target: SecurityTarget.IMAGE,
          conditions: [],
          actions: [
            {
              type: ActionType.SCAN,
              parameters: { scanType: 'secrets' },
              order: 1
            }
          ],
          enabled: true,
          priority: 100
        }
      ],
      exceptions: [],
      metadata: {
        author: 'GitHub RunnerHub Security Team',
        created: new Date(),
        updated: new Date(),
        tags: ['development', 'medium-security'],
        compliance: [ComplianceFramework.OWASP],
        requiredCapabilities: [],
        supportedPlatforms: ['linux', 'windows']
      }
    });

    logger.info(`Initialized ${this.policies.size} default security policies`);
  }

  /**
   * Register a security policy
   */
  public registerPolicy(policy: SecurityPolicyConfig): void {
    const validationErrors = this.validatePolicy(policy);
    if (validationErrors.length > 0) {
      throw new Error(`Policy validation failed: ${validationErrors.join(', ')}`);
    }

    this.policies.set(policy.id, policy);
    logger.info(`Registered security policy: ${policy.id} (${policy.name})`);
    this.emit('policy:registered', { policy });
  }

  /**
   * Apply security policies to a container
   */
  public async applyPolicies(
    containerId: string,
    policyIds?: string[]
  ): Promise<ContainerSecurityProfile> {
    try {
      logger.info(`Applying security policies to container: ${containerId}`);

      const containerInfo = await this.dockerClient.getContainerInfo(containerId);
      if (!containerInfo) {
        throw new Error(`Container not found: ${containerId}`);
      }

      // Determine which policies to apply
      const policiesToApply = policyIds 
        ? policyIds.map(id => this.policies.get(id)).filter(Boolean) as SecurityPolicyConfig[]
        : Array.from(this.policies.values()).filter(p => p.enabled);

      const profile: ContainerSecurityProfile = {
        containerId,
        imageId: containerInfo.image,
        policies: policiesToApply.map(p => p.id),
        enforcements: [],
        scans: [],
        violations: [],
        status: SecurityStatus.SECURE,
        riskScore: 0,
        lastAssessment: new Date(),
        configuration: await this.getContainerSecurityConfig(containerId)
      };

      // Apply each policy
      for (const policy of policiesToApply) {
        await this.applyPolicy(profile, policy);
      }

      // Calculate risk score
      profile.riskScore = this.calculateRiskScore(profile);
      profile.status = this.determineSecurityStatus(profile);

      // Store the profile
      this.containerProfiles.set(containerId, profile);

      logger.info(`Applied ${policiesToApply.length} policies to container ${containerId}`);
      this.emit('policies:applied', { containerId, profile });

      return profile;
    } catch (error) {
      logger.error(`Failed to apply policies to container ${containerId}:`, error);
      this.emit('policies:application:failed', { containerId, error });
      throw error;
    }
  }

  /**
   * Apply a single policy to a container profile
   */
  private async applyPolicy(
    profile: ContainerSecurityProfile,
    policy: SecurityPolicyConfig
  ): Promise<void> {
    logger.debug(`Applying policy ${policy.id} to container ${profile.containerId}`);

    for (const rule of policy.rules.filter(r => r.enabled)) {
      try {
        const isViolation = await this.evaluateRule(profile, rule);
        
        if (isViolation) {
          await this.executeRuleActions(profile, rule, policy);
        }
      } catch (error) {
        logger.warn(`Failed to apply rule ${rule.id}:`, error);
      }
    }
  }

  /**
   * Evaluate a security rule against a container
   */
  private async evaluateRule(
    profile: ContainerSecurityProfile,
    rule: SecurityRule
  ): Promise<boolean> {
    if (rule.conditions.length === 0) {
      return true; // No conditions means always apply
    }

    const containerInfo = await this.dockerClient.getContainerInfo(profile.containerId);
    if (!containerInfo) {
      return false;
    }

    // Check all conditions (AND logic)
    for (const condition of rule.conditions) {
      if (!await this.evaluateCondition(containerInfo, condition)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate a single condition
   */
  private async evaluateCondition(
    containerInfo: any,
    condition: SecurityCondition
  ): Promise<boolean> {
    let actualValue: any;

    switch (condition.type) {
      case ConditionType.IMAGE_NAME:
        actualValue = containerInfo.image?.split(':')[0];
        break;
      case ConditionType.IMAGE_TAG:
        actualValue = containerInfo.image?.split(':')[1] || 'latest';
        break;
      case ConditionType.LABEL:
        actualValue = containerInfo.labels?.[condition.field || ''];
        break;
      case ConditionType.ENVIRONMENT:
        actualValue = containerInfo.environment?.find((env: string) => 
          env.startsWith(`${condition.field}=`)
        )?.split('=')[1];
        break;
      case ConditionType.USER:
        actualValue = containerInfo.user || '0';
        break;
      case ConditionType.PORT:
        actualValue = containerInfo.ports?.map((p: any) => p.containerPort);
        break;
      default:
        return false;
    }

    return this.compareValues(actualValue, condition.operator, condition.value);
  }

  /**
   * Compare values based on operator
   */
  private compareValues(actual: any, operator: ConditionOperator, expected: any): boolean {
    switch (operator) {
      case ConditionOperator.EQUALS:
        return actual === expected;
      case ConditionOperator.NOT_EQUALS:
        return actual !== expected;
      case ConditionOperator.CONTAINS:
        return String(actual).includes(String(expected));
      case ConditionOperator.NOT_CONTAINS:
        return !String(actual).includes(String(expected));
      case ConditionOperator.STARTS_WITH:
        return String(actual).startsWith(String(expected));
      case ConditionOperator.ENDS_WITH:
        return String(actual).endsWith(String(expected));
      case ConditionOperator.MATCHES:
        return new RegExp(expected).test(String(actual));
      case ConditionOperator.GREATER_THAN:
        return Number(actual) > Number(expected);
      case ConditionOperator.LESS_THAN:
        return Number(actual) < Number(expected);
      case ConditionOperator.IN:
        return Array.isArray(expected) && expected.includes(actual);
      case ConditionOperator.NOT_IN:
        return Array.isArray(expected) && !expected.includes(actual);
      default:
        return false;
    }
  }

  /**
   * Execute actions for a violated rule
   */
  private async executeRuleActions(
    profile: ContainerSecurityProfile,
    rule: SecurityRule,
    policy: SecurityPolicyConfig
  ): Promise<void> {
    logger.warn(`Security rule violation: ${rule.name} for container ${profile.containerId}`);

    // Record the violation
    const violation: SecurityViolation = {
      id: this.generateViolationId(),
      ruleId: rule.id,
      containerId: profile.containerId,
      type: ViolationType.POLICY_VIOLATION,
      severity: rule.severity,
      description: `${rule.name}: ${rule.type}`,
      detectedAt: new Date(),
      resolved: false
    };

    profile.violations.push(violation);

    // Execute actions based on enforcement mode
    for (const action of rule.actions.sort((a, b) => a.order - b.order)) {
      try {
        await this.executeAction(profile, action, rule, policy);
        
        const enforcement: ActiveEnforcement = {
          ruleId: rule.id,
          policyId: policy.id,
          actionType: action.type,
          status: EnforcementStatus.ACTIVE,
          appliedAt: new Date(),
          details: action.parameters
        };

        profile.enforcements.push(enforcement);
      } catch (error) {
        logger.error(`Failed to execute action ${action.type}:`, error);
      }
    }

    this.emit('violation:detected', { profile, rule, violation });
  }

  /**
   * Execute a specific security action
   */
  private async executeAction(
    profile: ContainerSecurityProfile,
    action: SecurityAction,
    rule: SecurityRule,
    _policy: SecurityPolicyConfig
  ): Promise<void> {
    switch (action.type) {
      case ActionType.BLOCK:
        await this.blockContainer(profile, action.parameters);
        break;
      case ActionType.QUARANTINE:
        await this.quarantineContainer(profile, action.parameters);
        break;
      case ActionType.ALERT:
        await this.sendAlert(profile, rule, action.parameters);
        break;
      case ActionType.LOG:
        this.logViolation(profile, rule, action.parameters);
        break;
      case ActionType.SCAN:
        await this.scanContainer(profile, action.parameters);
        break;
      case ActionType.TERMINATE:
        await this.terminateContainer(profile, action.parameters);
        break;
      case ActionType.ISOLATE:
        await this.isolateContainer(profile, action.parameters);
        break;
      default:
        logger.warn(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Block container operation
   */
  private async blockContainer(
    profile: ContainerSecurityProfile,
    parameters: Record<string, any>
  ): Promise<void> {
    logger.warn(`Blocking container ${profile.containerId}: ${parameters.message || 'Security policy violation'}`);
    
    try {
      await this.dockerClient.stopContainer(profile.containerId);
      profile.status = SecurityStatus.QUARANTINED;
      this.emit('container:blocked', { containerId: profile.containerId, reason: parameters.message });
    } catch (error) {
      logger.error(`Failed to block container ${profile.containerId}:`, error);
    }
  }

  /**
   * Quarantine container
   */
  private async quarantineContainer(
    profile: ContainerSecurityProfile,
    parameters: Record<string, any>
  ): Promise<void> {
    logger.warn(`Quarantining container ${profile.containerId}`);
    
    try {
      // Isolate network access
      await this.isolateContainer(profile, { isolateNetwork: true });
      
      // Note: Docker doesn't support updating container labels after creation
      // The quarantine status is tracked in our security profile
      logger.info(`Container ${profile.containerId} quarantined: ${parameters.reason || 'Policy violation'}`);

      profile.status = SecurityStatus.QUARANTINED;
      this.emit('container:quarantined', { containerId: profile.containerId });
    } catch (error) {
      logger.error(`Failed to quarantine container ${profile.containerId}:`, error);
    }
  }

  /**
   * Send security alert
   */
  private async sendAlert(
    profile: ContainerSecurityProfile,
    rule: SecurityRule,
    parameters: Record<string, any>
  ): Promise<void> {
    const alert = {
      type: 'security_violation',
      severity: parameters.severity || rule.severity,
      containerId: profile.containerId,
      imageId: profile.imageId,
      rule: rule.name,
      message: `Security rule violation: ${rule.name}`,
      timestamp: new Date()
    };

    logger.info('Security alert:', alert);
    this.emit('alert:sent', alert);
  }

  /**
   * Log security violation
   */
  private logViolation(
    profile: ContainerSecurityProfile,
    rule: SecurityRule,
    parameters: Record<string, any>
  ): void {
    const logLevel = parameters.level || 'info';
    const message = `Security violation: ${rule.name} for container ${profile.containerId}`;
    
    logger[logLevel as keyof typeof logger](message);
  }

  /**
   * Scan container for security issues
   */
  private async scanContainer(
    profile: ContainerSecurityProfile,
    parameters: Record<string, any>
  ): Promise<void> {
    const scanType = parameters.scanType || ScanType.VULNERABILITY;
    
    try {
      const scanResult = await this.performSecurityScan(profile.containerId, scanType);
      profile.scans.push(scanResult);
      
      this.emit('scan:completed', { containerId: profile.containerId, scanResult });
    } catch (error) {
      logger.error(`Failed to scan container ${profile.containerId}:`, error);
    }
  }

  /**
   * Terminate container
   */
  private async terminateContainer(
    profile: ContainerSecurityProfile,
    _parameters: Record<string, any>
  ): Promise<void> {
    logger.warn(`Terminating container ${profile.containerId} due to security violation`);
    
    try {
      await this.dockerClient.removeContainer(profile.containerId, true);
      profile.status = SecurityStatus.COMPROMISED;
      this.emit('container:terminated', { containerId: profile.containerId });
    } catch (error) {
      logger.error(`Failed to terminate container ${profile.containerId}:`, error);
    }
  }

  /**
   * Isolate container networking
   */
  private async isolateContainer(
    profile: ContainerSecurityProfile,
    _parameters: Record<string, any>
  ): Promise<void> {
    logger.warn(`Isolating container ${profile.containerId}`);
    
    try {
      // This would require network isolation implementation
      // For now, we'll just log the action
      logger.info(`Container ${profile.containerId} has been isolated`);
      this.emit('container:isolated', { containerId: profile.containerId });
    } catch (error) {
      logger.error(`Failed to isolate container ${profile.containerId}:`, error);
    }
  }

  /**
   * Perform security scan on container
   */
  private async performSecurityScan(
    containerId: string,
    scanType: ScanType
  ): Promise<SecurityScanResult> {
    const scanId = this.generateScanId();
    const startTime = new Date();

    try {
      logger.info(`Starting ${scanType} scan for container ${containerId}`);

      // Simulate scan results (in real implementation, this would call Trivy, Clair, etc.)
      const findings = await this.generateMockFindings(scanType);
      const endTime = new Date();

      const scanResult: SecurityScanResult = {
        id: scanId,
        containerId,
        imageId: (await this.dockerClient.getContainerInfo(containerId))?.image || '',
        scanType,
        status: ScanStatus.COMPLETED,
        startTime,
        endTime,
        duration: (endTime.getTime() - startTime.getTime()) / 1000,
        findings,
        summary: this.generateScanSummary(findings),
        metadata: {
          scanner: 'trivy',
          scannerVersion: '0.45.0',
          databaseVersion: '2023-10-01',
          rulesVersion: '1.0.0',
          platform: 'linux',
          environment: 'production'
        }
      };

      return scanResult;
    } catch (error) {
      logger.error(`Security scan failed for container ${containerId}:`, error);
      
      return {
        id: scanId,
        containerId,
        imageId: '',
        scanType,
        status: ScanStatus.FAILED,
        startTime,
        findings: [],
        summary: this.generateScanSummary([]),
        metadata: {
          scanner: 'trivy',
          scannerVersion: '0.45.0',
          databaseVersion: '2023-10-01',
          rulesVersion: '1.0.0',
          platform: 'linux',
          environment: 'production'
        }
      };
    }
  }

  /**
   * Generate mock security findings for demonstration
   */
  private async generateMockFindings(scanType: ScanType): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    if (scanType === ScanType.VULNERABILITY) {
      findings.push({
        id: 'vuln-001',
        type: FindingType.VULNERABILITY,
        severity: SecuritySeverity.HIGH,
        category: SecurityCategory.APPLICATION_SECURITY,
        title: 'CVE-2023-1234: Buffer Overflow in libssl',
        description: 'A buffer overflow vulnerability in OpenSSL that could lead to remote code execution',
        location: {
          package: 'openssl',
          version: '1.1.1k',
          file: '/usr/lib/libssl.so'
        },
        remediation: {
          action: 'Update package',
          description: 'Update OpenSSL to version 1.1.1w or later',
          priority: RemediationPriority.HIGH,
          effort: RemediationEffort.LOW,
          commands: ['apt-get update && apt-get install openssl=1.1.1w'],
          links: ['https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2023-1234']
        },
        compliance: [
          {
            framework: ComplianceFramework.SOC2,
            control: 'CC6.1',
            description: 'Vulnerability management',
            impact: ComplianceImpact.HIGH
          }
        ],
        references: ['https://nvd.nist.gov/vuln/detail/CVE-2023-1234']
      });
    }

    if (scanType === ScanType.SECRETS) {
      findings.push({
        id: 'secret-001',
        type: FindingType.SECRET,
        severity: SecuritySeverity.CRITICAL,
        category: SecurityCategory.DATA_PROTECTION,
        title: 'Exposed API Key',
        description: 'API key found in environment variable',
        location: {
          file: '/app/.env',
          line: 5
        },
        remediation: {
          action: 'Remove secret',
          description: 'Remove the API key from the environment file and use a secure secret management system',
          priority: RemediationPriority.URGENT,
          effort: RemediationEffort.MEDIUM,
          commands: ['Remove API_KEY from .env file'],
          links: ['https://owasp.org/www-project-top-ten/']
        },
        compliance: [
          {
            framework: ComplianceFramework.GDPR,
            control: 'Article 32',
            description: 'Security of processing',
            impact: ComplianceImpact.CRITICAL
          }
        ],
        references: []
      });
    }

    return findings;
  }

  /**
   * Generate scan summary from findings
   */
  private generateScanSummary(findings: SecurityFinding[]): ScanSummary {
    const summary: ScanSummary = {
      totalFindings: findings.length,
      criticalFindings: findings.filter(f => f.severity === SecuritySeverity.CRITICAL).length,
      highFindings: findings.filter(f => f.severity === SecuritySeverity.HIGH).length,
      mediumFindings: findings.filter(f => f.severity === SecuritySeverity.MEDIUM).length,
      lowFindings: findings.filter(f => f.severity === SecuritySeverity.LOW).length,
      infoFindings: findings.filter(f => f.severity === SecuritySeverity.INFO).length,
      score: 0,
      grade: SecurityGrade.F
    };

    // Calculate security score (0-100)
    if (summary.totalFindings === 0) {
      summary.score = 100;
      summary.grade = SecurityGrade.A;
    } else {
      const weightedScore = (
        summary.criticalFindings * 20 +
        summary.highFindings * 10 +
        summary.mediumFindings * 5 +
        summary.lowFindings * 2 +
        summary.infoFindings * 1
      );
      
      summary.score = Math.max(0, 100 - weightedScore);
      
      if (summary.score >= 90) summary.grade = SecurityGrade.A;
      else if (summary.score >= 80) summary.grade = SecurityGrade.B;
      else if (summary.score >= 70) summary.grade = SecurityGrade.C;
      else if (summary.score >= 60) summary.grade = SecurityGrade.D;
      else summary.grade = SecurityGrade.F;
    }

    return summary;
  }

  /**
   * Get container security configuration
   */
  private async getContainerSecurityConfig(containerId: string): Promise<ContainerSecurityConfig> {
    const containerInfo = await this.dockerClient.getContainerInfo(containerId);
    
    return {
      securityContext: {
        runAsUser: 0,
        runAsGroup: 0,
        runAsNonRoot: false,
        readOnlyRootFilesystem: false,
        allowPrivilegeEscalation: true,
        privileged: false, // Default to non-privileged for security
        capabilities: {
          add: [],
          drop: []
        },
        seLinuxOptions: {
          user: '',
          role: '',
          type: '',
          level: ''
        },
        seccompProfile: {
          type: 'RuntimeDefault'
        },
        apparmorProfile: ''
      },
      networkPolicies: [],
      resourceLimits: {
        cpu: { max: '1000m' },
        memory: { max: '1Gi' },
        storage: { max: '10Gi' },
        network: { bandwidth: '1Gbps', connections: 1000, dnsQueries: 100 },
        fileDescriptors: { max: '1024' },
        processes: { max: '100' }
      },
      accessControls: [],
      monitoring: {
        enabled: true,
        realTimeScanning: false,
        behaviorAnalysis: false,
        anomalyDetection: false,
        compliance: true,
        auditLogging: true,
        alerting: {
          enabled: true,
          channels: [],
          thresholds: [],
          escalation: { enabled: false, levels: [] }
        }
      }
    };
  }

  /**
   * Calculate risk score for a container
   */
  private calculateRiskScore(profile: ContainerSecurityProfile): number {
    let score = 0;

    // Base score from violations
    score += profile.violations.filter(v => !v.resolved).length * 10;
    
    // Score from scan results
    profile.scans.forEach(scan => {
      score += scan.summary.criticalFindings * 20;
      score += scan.summary.highFindings * 10;
      score += scan.summary.mediumFindings * 5;
    });

    // Configuration risks
    if (profile.configuration.securityContext.privileged) score += 50;
    if (!profile.configuration.securityContext.runAsNonRoot) score += 20;
    if (!profile.configuration.securityContext.readOnlyRootFilesystem) score += 10;

    return Math.min(100, score);
  }

  /**
   * Determine security status based on profile
   */
  private determineSecurityStatus(profile: ContainerSecurityProfile): SecurityStatus {
    const criticalViolations = profile.violations.filter(
      v => !v.resolved && v.severity === SecuritySeverity.CRITICAL
    ).length;

    const highViolations = profile.violations.filter(
      v => !v.resolved && v.severity === SecuritySeverity.HIGH
    ).length;

    if (profile.riskScore >= 80 || criticalViolations > 0) {
      return SecurityStatus.CRITICAL;
    } else if (profile.riskScore >= 50 || highViolations > 0) {
      return SecurityStatus.WARNING;
    } else {
      return SecurityStatus.SECURE;
    }
  }

  /**
   * Validate security policy configuration
   */
  private validatePolicy(policy: SecurityPolicyConfig): string[] {
    const errors: string[] = [];

    if (!policy.id) errors.push('Policy ID is required');
    if (!policy.name) errors.push('Policy name is required');
    if (!policy.version) errors.push('Policy version is required');
    if (!policy.rules || policy.rules.length === 0) {
      errors.push('Policy must have at least one rule');
    }

    policy.rules.forEach((rule, index) => {
      if (!rule.id) errors.push(`Rule ${index}: ID is required`);
      if (!rule.name) errors.push(`Rule ${index}: Name is required`);
      if (!rule.type) errors.push(`Rule ${index}: Type is required`);
      if (!rule.actions || rule.actions.length === 0) {
        errors.push(`Rule ${index}: Must have at least one action`);
      }
    });

    return errors;
  }

  /**
   * Generate unique violation ID
   */
  private generateViolationId(): string {
    return `viol_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Generate unique scan ID
   */
  private generateScanId(): string {
    return `scan_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Start continuous security monitoring
   */
  public startMonitoring(intervalMs = 300000): void {
    if (this.isMonitoring) {
      this.stopMonitoring();
    }

    logger.info(`Starting security monitoring with ${intervalMs}ms interval`);
    this.isMonitoring = true;

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performContinuousAssessment();
      } catch (error) {
        logger.error('Error during continuous security assessment:', error);
      }
    }, intervalMs);

    this.emit('monitoring:started', { intervalMs });
  }

  /**
   * Stop continuous security monitoring
   */
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      this.isMonitoring = false;
      logger.info('Security monitoring stopped');
      this.emit('monitoring:stopped');
    }
  }

  /**
   * Perform continuous security assessment
   */
  private async performContinuousAssessment(): Promise<void> {
    const containers = await this.dockerClient.listContainers();
    
    for (const container of containers) {
      try {
        if (this.containerProfiles.has(container.id)) {
          // Re-assess existing profiles
          await this.applyPolicies(container.id);
        }
      } catch (error) {
        logger.warn(`Failed to assess container ${container.id}:`, error);
      }
    }
  }

  /**
   * Get security manager statistics
   */
  public getSecurityStats(): any {
    const profiles = Array.from(this.containerProfiles.values());
    const policies = Array.from(this.policies.values());

    return {
      policies: {
        total: policies.length,
        enabled: policies.filter(p => p.enabled).length,
        byLevel: this.groupBy(policies, 'level'),
        byEnforcement: this.groupBy(policies, 'enforcement')
      },
      containers: {
        total: profiles.length,
        byStatus: this.groupBy(profiles, 'status'),
        averageRiskScore: profiles.length > 0 
          ? Math.round(profiles.reduce((sum, p) => sum + p.riskScore, 0) / profiles.length)
          : 0
      },
      violations: {
        total: profiles.reduce((sum, p) => sum + p.violations.length, 0),
        unresolved: profiles.reduce((sum, p) => sum + p.violations.filter(v => !v.resolved).length, 0),
        bySeverity: this.groupViolationsBySeverity(profiles)
      },
      scans: {
        total: profiles.reduce((sum, p) => sum + p.scans.length, 0),
        byType: this.groupScansByType(profiles),
        byStatus: this.groupScansByStatus(profiles)
      },
      monitoring: {
        enabled: this.isMonitoring,
        profilesTracked: profiles.length
      }
    };
  }

  /**
   * Helper method to group arrays by property
   */
  private groupBy<T>(array: T[], key: keyof T): Record<string, number> {
    return array.reduce((groups, item) => {
      const value = String(item[key]);
      groups[value] = (groups[value] || 0) + 1;
      return groups;
    }, {} as Record<string, number>);
  }

  /**
   * Group violations by severity
   */
  private groupViolationsBySeverity(profiles: ContainerSecurityProfile[]): Record<string, number> {
    const allViolations = profiles.flatMap(p => p.violations);
    return this.groupBy(allViolations, 'severity');
  }

  /**
   * Group scans by type
   */
  private groupScansByType(profiles: ContainerSecurityProfile[]): Record<string, number> {
    const allScans = profiles.flatMap(p => p.scans);
    return this.groupBy(allScans, 'scanType');
  }

  /**
   * Group scans by status
   */
  private groupScansByStatus(profiles: ContainerSecurityProfile[]): Record<string, number> {
    const allScans = profiles.flatMap(p => p.scans);
    return this.groupBy(allScans, 'status');
  }

  /**
   * List all policies
   */
  public listPolicies(): SecurityPolicyConfig[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get policy by ID
   */
  public getPolicy(policyId: string): SecurityPolicyConfig | undefined {
    return this.policies.get(policyId);
  }

  /**
   * Update policy
   */
  public updatePolicy(policyId: string, updates: Partial<SecurityPolicyConfig>): void {
    const policy = this.getPolicy(policyId);
    if (!policy) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    const updatedPolicy = { ...policy, ...updates };
    const errors = this.validatePolicy(updatedPolicy);
    if (errors.length > 0) {
      throw new Error(`Policy validation failed: ${errors.join(', ')}`);
    }

    this.policies.set(policyId, updatedPolicy);
    logger.info(`Updated security policy: ${policyId}`);
    this.emit('policy:updated', { policy: updatedPolicy });
  }

  /**
   * Remove policy
   */
  public removePolicy(policyId: string): boolean {
    const result = this.policies.delete(policyId);
    if (result) {
      logger.info(`Removed security policy: ${policyId}`);
      this.emit('policy:removed', { policyId });
    }
    return result;
  }

  /**
   * Get container security profile
   */
  public getContainerProfile(containerId: string): ContainerSecurityProfile | undefined {
    return this.containerProfiles.get(containerId);
  }

  /**
   * List all container profiles
   */
  public listContainerProfiles(): ContainerSecurityProfile[] {
    return Array.from(this.containerProfiles.values());
  }

  /**
   * Remove container profile
   */
  public removeContainerProfile(containerId: string): boolean {
    const result = this.containerProfiles.delete(containerId);
    if (result) {
      logger.info(`Removed container profile: ${containerId}`);
      this.emit('profile:removed', { containerId });
    }
    return result;
  }
}

export default DockerSecurityManager;