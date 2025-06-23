export { 
  DockerSecurityManager,
  type SecurityPolicyConfig,
  type SecurityRule,
  type SecurityCondition,
  type SecurityAction,
  type SecurityException,
  type PolicyMetadata,
  type SecurityScanResult,
  type SecurityFinding,
  type FindingLocation,
  type RemediationAdvice,
  type ComplianceViolation,
  type ScanSummary,
  type ScanMetadata,
  type ContainerSecurityProfile,
  type ActiveEnforcement,
  type SecurityViolation,
  type ContainerSecurityConfig,
  type SecurityContext,
  type CapabilityConfig,
  type SELinuxOptions,
  type SeccompProfile,
  type NetworkSecurityPolicy,
  type PortRange,
  type SecurityResourceLimits,
  type ResourceLimit,
  type NetworkLimit,
  type AccessControl,
  type AccessCondition,
  type SecurityMonitoring,
  type AlertingConfig,
  type AlertChannel,
  type AlertThreshold,
  type EscalationPolicy,
  type EscalationLevel,
  SecurityLevel,
  EnforcementMode,
  SecurityRuleType,
  SecurityCategory,
  SecuritySeverity,
  SecurityTarget,
  ConditionType,
  ConditionOperator,
  ActionType,
  ScanType,
  ScanStatus,
  FindingType,
  ComplianceFramework,
  ComplianceImpact,
  RemediationPriority,
  RemediationEffort,
  SecurityGrade,
  SecurityStatus,
  EnforcementStatus,
  ViolationType,
  Protocol,
  DNSPolicy,
  AccessControlType,
  Permission
} from './docker-security-manager';

import { DockerSecurityManager } from './docker-security-manager';

// Convenience function to create and configure security manager
export function createDockerSecurityManager() {
  return DockerSecurityManager.getInstance();
}

// Convenience function to apply security policies
export async function applySecurityPolicies(
  containerId: string, 
  policyIds?: string[]
) {
  const manager = DockerSecurityManager.getInstance();
  return manager.applyPolicies(containerId, policyIds);
}

// Convenience function to get security statistics
export function getSecurityStats() {
  const manager = DockerSecurityManager.getInstance();
  return manager.getSecurityStats();
}

// Default security policies for common use cases
export const DEFAULT_SECURITY_POLICIES = {
  PRODUCTION: 'high-security-policy',
  DEVELOPMENT: 'development-policy',
  TESTING: 'test-security-policy',
  CI_CD: 'ci-cd-security-policy'
} as const;

// Common security rule templates
export function createSecurityRule(options: {
  id: string;
  name: string;
  type: any;
  severity: any;
  conditions: any[];
  actions: any[];
  enabled?: boolean;
  priority?: number;
}) {
  return {
    id: options.id,
    name: options.name,
    type: options.type,
    category: 'system_security' as any,
    severity: options.severity,
    target: 'container' as any,
    conditions: options.conditions,
    actions: options.actions,
    enabled: options.enabled ?? true,
    priority: options.priority ?? 50
  };
}

// Security policy templates
export function createSecurityPolicy(options: {
  id: string;
  name: string;
  description: string;
  level: any;
  enforcement: any;
  rules: any[];
  author?: string;
  tags?: string[];
}) {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    enabled: true,
    level: options.level,
    enforcement: options.enforcement,
    rules: options.rules,
    exceptions: [],
    metadata: {
      author: options.author || 'Security Team',
      created: new Date(),
      updated: new Date(),
      tags: options.tags || [],
      compliance: [],
      requiredCapabilities: [],
      supportedPlatforms: ['linux', 'windows']
    }
  };
}