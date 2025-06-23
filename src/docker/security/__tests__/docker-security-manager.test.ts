import { 
  DockerSecurityManager, 
  SecurityLevel, 
  EnforcementMode, 
  SecurityRuleType, 
  SecuritySeverity,
  SecurityTarget,
  SecurityCategory,
  ConditionType,
  ConditionOperator,
  ActionType,
  SecurityStatus
} from '../docker-security-manager';
import { DockerClient } from '../../docker-client';

// Mock DockerClient
jest.mock('../../docker-client');

const mockDockerClient = {
  getContainerInfo: jest.fn(),
  listContainers: jest.fn(),
  stopContainer: jest.fn(),
  removeContainer: jest.fn(),
  updateContainer: jest.fn()
};

describe('DockerSecurityManager', () => {
  let securityManager: DockerSecurityManager;

  beforeEach(() => {
    jest.clearAllMocks();
    (DockerClient.getInstance as jest.Mock).mockReturnValue(mockDockerClient);
    securityManager = DockerSecurityManager.getInstance();
  });

  describe('Policy Management', () => {
    it('should register a valid security policy', () => {
      const policy = {
        id: 'test-policy',
        name: 'Test Policy',
        description: 'A test security policy',
        version: '1.0.0',
        enabled: true,
        level: SecurityLevel.MEDIUM,
        enforcement: EnforcementMode.DETECTION,
        rules: [
          {
            id: 'test-rule',
            name: 'Test Rule',
            type: SecurityRuleType.CONFIGURATION,
            category: SecurityCategory.SYSTEM_SECURITY,
            severity: SecuritySeverity.MEDIUM,
            target: SecurityTarget.CONTAINER,
            conditions: [],
            actions: [
              {
                type: ActionType.LOG,
                parameters: { level: 'info' },
                order: 1
              }
            ],
            enabled: true,
            priority: 50
          }
        ],
        exceptions: [],
        metadata: {
          author: 'Test Author',
          created: new Date(),
          updated: new Date(),
          tags: ['test'],
          compliance: [],
          requiredCapabilities: [],
          supportedPlatforms: ['linux']
        }
      };

      expect(() => securityManager.registerPolicy(policy)).not.toThrow();
      expect(securityManager.getPolicy('test-policy')).toEqual(policy);
    });

    it('should reject invalid security policy', () => {
      const invalidPolicy = {
        id: '',
        name: '',
        description: '',
        version: '',
        enabled: true,
        level: SecurityLevel.MEDIUM,
        enforcement: EnforcementMode.DETECTION,
        rules: [],
        exceptions: [],
        metadata: {
          author: 'Test Author',
          created: new Date(),
          updated: new Date(),
          tags: [],
          compliance: [],
          requiredCapabilities: [],
          supportedPlatforms: []
        }
      };

      expect(() => securityManager.registerPolicy(invalidPolicy)).toThrow();
    });

    it('should list all policies', () => {
      const policies = securityManager.listPolicies();
      expect(policies).toBeInstanceOf(Array);
      expect(policies.length).toBeGreaterThan(0);
      
      // Should include default policies
      expect(policies.some(p => p.id === 'high-security-policy')).toBe(true);
      expect(policies.some(p => p.id === 'development-policy')).toBe(true);
    });

    it('should update existing policy', () => {
      const policyId = 'high-security-policy';
      const updates = {
        description: 'Updated description',
        enabled: false
      };

      securityManager.updatePolicy(policyId, updates);
      const updatedPolicy = securityManager.getPolicy(policyId);

      expect(updatedPolicy?.description).toBe('Updated description');
      expect(updatedPolicy?.enabled).toBe(false);
    });

    it('should remove policy', () => {
      const testPolicy = {
        id: 'removable-policy',
        name: 'Removable Policy',
        description: 'A policy to be removed',
        version: '1.0.0',
        enabled: true,
        level: SecurityLevel.LOW,
        enforcement: EnforcementMode.PERMISSIVE,
        rules: [
          {
            id: 'dummy-rule',
            name: 'Dummy Rule',
            type: SecurityRuleType.CONFIGURATION,
            category: SecurityCategory.SYSTEM_SECURITY,
            severity: SecuritySeverity.LOW,
            target: SecurityTarget.CONTAINER,
            conditions: [],
            actions: [
              {
                type: ActionType.LOG,
                parameters: {},
                order: 1
              }
            ],
            enabled: true,
            priority: 1
          }
        ],
        exceptions: [],
        metadata: {
          author: 'Test',
          created: new Date(),
          updated: new Date(),
          tags: [],
          compliance: [],
          requiredCapabilities: [],
          supportedPlatforms: ['linux']
        }
      };

      securityManager.registerPolicy(testPolicy);
      expect(securityManager.getPolicy('removable-policy')).toBeDefined();

      const removed = securityManager.removePolicy('removable-policy');
      expect(removed).toBe(true);
      expect(securityManager.getPolicy('removable-policy')).toBeUndefined();
    });
  });

  describe('Policy Application', () => {
    beforeEach(() => {
      mockDockerClient.getContainerInfo.mockResolvedValue({
        id: 'test-container',
        image: 'ubuntu:latest',
        name: 'test-container',
        labels: { 'test.label': 'value' },
        environment: ['TEST_ENV=value'],
        privileged: false,
        user: '1000',
        ports: [{ containerPort: 8080, protocol: 'tcp' }]
      });
    });

    it('should apply policies to container', async () => {
      const containerId = 'test-container';
      
      const profile = await securityManager.applyPolicies(containerId);

      expect(profile).toBeDefined();
      expect(profile.containerId).toBe(containerId);
      expect(profile.policies.length).toBeGreaterThan(0);
      expect(profile.status).toBeDefined();
      expect(profile.riskScore).toBeGreaterThanOrEqual(0);
    });

    it('should apply specific policies to container', async () => {
      const containerId = 'test-container';
      const policyIds = ['development-policy'];
      
      const profile = await securityManager.applyPolicies(containerId, policyIds);

      expect(profile.policies).toEqual(policyIds);
    });

    it('should handle container not found', async () => {
      mockDockerClient.getContainerInfo.mockResolvedValue(null);
      
      await expect(securityManager.applyPolicies('non-existent')).rejects.toThrow('Container not found');
    });
  });

  describe('Rule Evaluation', () => {
    beforeEach(() => {
      mockDockerClient.getContainerInfo.mockResolvedValue({
        id: 'test-container',
        image: 'ubuntu:22.04',
        name: 'test-container',
        labels: { 'privileged': 'true' },
        environment: ['NODE_ENV=production'],
        privileged: true,
        user: '0',
        ports: [{ containerPort: 22, protocol: 'tcp' }]
      });
    });

    it('should evaluate image name conditions', async () => {
      const containerId = 'test-container';
      
      // Create a policy that blocks Ubuntu images
      const testPolicy = {
        id: 'block-ubuntu-policy',
        name: 'Block Ubuntu Policy',
        description: 'Blocks Ubuntu containers',
        version: '1.0.0',
        enabled: true,
        level: SecurityLevel.HIGH,
        enforcement: EnforcementMode.ENFORCEMENT,
        rules: [
          {
            id: 'block-ubuntu-rule',
            name: 'Block Ubuntu Containers',
            type: SecurityRuleType.CONFIGURATION,
            category: SecurityCategory.SYSTEM_SECURITY,
            severity: SecuritySeverity.HIGH,
            target: SecurityTarget.CONTAINER,
            conditions: [
              {
                type: ConditionType.IMAGE_NAME,
                operator: ConditionOperator.STARTS_WITH,
                value: 'ubuntu'
              }
            ],
            actions: [
              {
                type: ActionType.BLOCK,
                parameters: { message: 'Ubuntu images not allowed' },
                order: 1
              }
            ],
            enabled: true,
            priority: 100
          }
        ],
        exceptions: [],
        metadata: {
          author: 'Security Team',
          created: new Date(),
          updated: new Date(),
          tags: ['security'],
          compliance: [],
          requiredCapabilities: [],
          supportedPlatforms: ['linux']
        }
      };

      securityManager.registerPolicy(testPolicy);
      const profile = await securityManager.applyPolicies(containerId, ['block-ubuntu-policy']);

      expect(profile.violations.length).toBeGreaterThan(0);
      expect(profile.violations[0].ruleId).toBe('block-ubuntu-rule');
    });

    it('should evaluate privileged container conditions', async () => {
      const containerId = 'test-container';
      
      const profile = await securityManager.applyPolicies(containerId, ['high-security-policy']);

      // Should detect privileged container violation
      const privilegedViolation = profile.violations.find(v => 
        v.ruleId === 'no-privileged-containers'
      );
      expect(privilegedViolation).toBeDefined();
    });

    it('should evaluate root user conditions', async () => {
      const containerId = 'test-container';
      
      const profile = await securityManager.applyPolicies(containerId, ['high-security-policy']);

      // Should detect root user violation
      const rootUserViolation = profile.violations.find(v => 
        v.ruleId === 'no-root-user'
      );
      expect(rootUserViolation).toBeDefined();
    });
  });

  describe('Security Actions', () => {
    beforeEach(() => {
      mockDockerClient.getContainerInfo.mockResolvedValue({
        id: 'test-container',
        image: 'ubuntu:latest',
        name: 'test-container',
        labels: {},
        environment: [],
        privileged: true,
        user: '0',
        ports: []
      });
    });

    it('should execute block action', async () => {
      const containerId = 'test-container';
      
      const profile = await securityManager.applyPolicies(containerId, ['high-security-policy']);

      // Should have blocked the container due to privileged mode
      expect(mockDockerClient.stopContainer).toHaveBeenCalledWith(containerId);
      expect(profile.status).toBe(SecurityStatus.QUARANTINED);
    });

    it('should execute alert action', async () => {
      const containerId = 'test-container';
      
      // Listen for alert events
      const alertPromise = new Promise((resolve) => {
        securityManager.once('alert:sent', resolve);
      });

      await securityManager.applyPolicies(containerId, ['high-security-policy']);

      // Should have sent an alert
      await expect(alertPromise).resolves.toBeDefined();
    });

    it('should execute scan action', async () => {
      const containerId = 'test-container';
      
      const profile = await securityManager.applyPolicies(containerId, ['development-policy']);

      // Should have performed scans
      expect(profile.scans.length).toBeGreaterThan(0);
      expect(profile.scans.some(s => s.scanType === 'vulnerability')).toBe(true);
      expect(profile.scans.some(s => s.scanType === 'secrets')).toBe(true);
    });
  });

  describe('Security Scanning', () => {
    it('should perform vulnerability scan', async () => {
      const containerId = 'test-container';
      mockDockerClient.getContainerInfo.mockResolvedValue({
        id: containerId,
        image: 'ubuntu:latest'
      });

      // Access the private method via type assertion
      const scanResult = await (securityManager as any).performSecurityScan(containerId, 'vulnerability');

      expect(scanResult).toBeDefined();
      expect(scanResult.scanType).toBe('vulnerability');
      expect(scanResult.status).toBe('completed');
      expect(scanResult.findings).toBeInstanceOf(Array);
      expect(scanResult.summary).toBeDefined();
      expect(scanResult.summary.totalFindings).toBeGreaterThanOrEqual(0);
    });

    it('should generate security findings', async () => {
      const findings = await (securityManager as any).generateMockFindings('vulnerability');

      expect(findings).toBeInstanceOf(Array);
      if (findings.length > 0) {
        const finding = findings[0];
        expect(finding).toHaveProperty('id');
        expect(finding).toHaveProperty('type');
        expect(finding).toHaveProperty('severity');
        expect(finding).toHaveProperty('title');
        expect(finding).toHaveProperty('description');
        expect(finding).toHaveProperty('remediation');
      }
    });

    it('should calculate scan summary correctly', () => {
      const mockFindings = [
        {
          id: '1',
          type: 'vulnerability' as any,
          severity: 'critical' as any,
          category: 'application_security' as any,
          title: 'Critical Vuln',
          description: 'Critical vulnerability',
          location: {},
          remediation: {
            action: 'Update',
            description: 'Update package',
            priority: 'high' as any,
            effort: 'low' as any
          },
          compliance: [],
          references: []
        },
        {
          id: '2',
          type: 'vulnerability' as any,
          severity: 'high' as any,
          category: 'application_security' as any,
          title: 'High Vuln',
          description: 'High vulnerability',
          location: {},
          remediation: {
            action: 'Update',
            description: 'Update package',
            priority: 'medium' as any,
            effort: 'low' as any
          },
          compliance: [],
          references: []
        }
      ];

      const summary = (securityManager as any).generateScanSummary(mockFindings);

      expect(summary.totalFindings).toBe(2);
      expect(summary.criticalFindings).toBe(1);
      expect(summary.highFindings).toBe(1);
      expect(summary.score).toBeLessThan(100);
      expect(summary.grade).toBeDefined();
    });
  });

  describe('Risk Assessment', () => {
    it('should calculate risk score correctly', () => {
      const mockProfile = {
        containerId: 'test',
        imageId: 'ubuntu:latest',
        policies: [],
        enforcements: [],
        scans: [
          {
            id: 'scan1',
            containerId: 'test',
            imageId: 'ubuntu:latest',
            scanType: 'vulnerability' as any,
            status: 'completed' as any,
            startTime: new Date(),
            findings: [],
            summary: {
              totalFindings: 5,
              criticalFindings: 1,
              highFindings: 2,
              mediumFindings: 2,
              lowFindings: 0,
              infoFindings: 0,
              score: 50,
              grade: 'C' as any
            },
            metadata: {
              scanner: 'trivy',
              scannerVersion: '0.45.0',
              databaseVersion: '2023-10-01',
              rulesVersion: '1.0.0',
              platform: 'linux',
              environment: 'test'
            }
          }
        ],
        violations: [
          {
            id: 'viol1',
            ruleId: 'test-rule',
            containerId: 'test',
            type: 'policy_violation' as any,
            severity: 'high' as any,
            description: 'Test violation',
            detectedAt: new Date(),
            resolved: false
          }
        ],
        status: 'warning' as any,
        riskScore: 0,
        lastAssessment: new Date(),
        configuration: {
          securityContext: {
            runAsUser: 0,
            runAsGroup: 0,
            runAsNonRoot: false,
            readOnlyRootFilesystem: false,
            allowPrivilegeEscalation: true,
            privileged: true,
            capabilities: { add: [], drop: [] },
            seLinuxOptions: { user: '', role: '', type: '', level: '' },
            seccompProfile: { type: 'RuntimeDefault' as any },
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
        }
      };

      const riskScore = (securityManager as any).calculateRiskScore(mockProfile);

      expect(riskScore).toBeGreaterThan(0);
      expect(riskScore).toBeLessThanOrEqual(100);
    });

    it('should determine security status correctly', () => {
      const highRiskProfile = {
        riskScore: 85,
        violations: [
          {
            id: 'viol1',
            severity: 'critical' as any,
            resolved: false
          }
        ]
      };

      const status = (securityManager as any).determineSecurityStatus(highRiskProfile);
      expect(status).toBe(SecurityStatus.CRITICAL);

      const lowRiskProfile = {
        riskScore: 10,
        violations: []
      };

      const lowStatus = (securityManager as any).determineSecurityStatus(lowRiskProfile);
      expect(lowStatus).toBe(SecurityStatus.SECURE);
    });
  });

  describe('Monitoring', () => {
    it('should start and stop monitoring', () => {
      expect(securityManager.getSecurityStats().monitoring.enabled).toBe(false);

      securityManager.startMonitoring(1000);
      expect(securityManager.getSecurityStats().monitoring.enabled).toBe(true);

      securityManager.stopMonitoring();
      expect(securityManager.getSecurityStats().monitoring.enabled).toBe(false);
    });

    it('should perform continuous assessment', async () => {
      mockDockerClient.listContainers.mockResolvedValue([
        { id: 'container1', name: 'test1' },
        { id: 'container2', name: 'test2' }
      ]);

      mockDockerClient.getContainerInfo.mockResolvedValue({
        id: 'container1',
        image: 'ubuntu:latest',
        name: 'test1',
        labels: {},
        environment: [],
        privileged: false,
        user: '1000',
        ports: []
      });

      await (securityManager as any).performContinuousAssessment();

      // Should have attempted to assess containers
      expect(mockDockerClient.listContainers).toHaveBeenCalled();
    });
  });

  describe('Statistics and Reporting', () => {
    beforeEach(async () => {
      // Setup test data
      mockDockerClient.getContainerInfo.mockResolvedValue({
        id: 'test-container',
        image: 'ubuntu:latest',
        name: 'test-container',
        labels: {},
        environment: [],
        privileged: false,
        user: '1000',
        ports: []
      });

      await securityManager.applyPolicies('test-container');
    });

    it('should provide comprehensive security statistics', () => {
      const stats = securityManager.getSecurityStats();

      expect(stats).toHaveProperty('policies');
      expect(stats).toHaveProperty('containers');
      expect(stats).toHaveProperty('violations');
      expect(stats).toHaveProperty('scans');
      expect(stats).toHaveProperty('monitoring');

      expect(stats.policies.total).toBeGreaterThan(0);
      expect(stats.containers.total).toBeGreaterThan(0);
      expect(typeof stats.containers.averageRiskScore).toBe('number');
    });

    it('should list container profiles', () => {
      const profiles = securityManager.listContainerProfiles();

      expect(profiles).toBeInstanceOf(Array);
      expect(profiles.length).toBeGreaterThan(0);
      expect(profiles[0]).toHaveProperty('containerId');
      expect(profiles[0]).toHaveProperty('status');
      expect(profiles[0]).toHaveProperty('riskScore');
    });

    it('should get specific container profile', () => {
      const profile = securityManager.getContainerProfile('test-container');

      expect(profile).toBeDefined();
      expect(profile?.containerId).toBe('test-container');
    });

    it('should remove container profile', () => {
      const removed = securityManager.removeContainerProfile('test-container');

      expect(removed).toBe(true);
      expect(securityManager.getContainerProfile('test-container')).toBeUndefined();
    });
  });

  describe('Value Comparison', () => {
    it('should compare values correctly with different operators', () => {
      const compareValues = (securityManager as any).compareValues;

      // Equals
      expect(compareValues('test', ConditionOperator.EQUALS, 'test')).toBe(true);
      expect(compareValues('test', ConditionOperator.EQUALS, 'other')).toBe(false);

      // Not equals
      expect(compareValues('test', ConditionOperator.NOT_EQUALS, 'other')).toBe(true);
      expect(compareValues('test', ConditionOperator.NOT_EQUALS, 'test')).toBe(false);

      // Contains
      expect(compareValues('hello world', ConditionOperator.CONTAINS, 'world')).toBe(true);
      expect(compareValues('hello world', ConditionOperator.CONTAINS, 'xyz')).toBe(false);

      // Starts with
      expect(compareValues('hello world', ConditionOperator.STARTS_WITH, 'hello')).toBe(true);
      expect(compareValues('hello world', ConditionOperator.STARTS_WITH, 'world')).toBe(false);

      // Ends with
      expect(compareValues('hello world', ConditionOperator.ENDS_WITH, 'world')).toBe(true);
      expect(compareValues('hello world', ConditionOperator.ENDS_WITH, 'hello')).toBe(false);

      // Matches (regex)
      expect(compareValues('test123', ConditionOperator.MATCHES, '\\d+')).toBe(true);
      expect(compareValues('testABC', ConditionOperator.MATCHES, '\\d+')).toBe(false);

      // Greater than
      expect(compareValues(10, ConditionOperator.GREATER_THAN, 5)).toBe(true);
      expect(compareValues(3, ConditionOperator.GREATER_THAN, 5)).toBe(false);

      // Less than
      expect(compareValues(3, ConditionOperator.LESS_THAN, 5)).toBe(true);
      expect(compareValues(10, ConditionOperator.LESS_THAN, 5)).toBe(false);

      // In
      expect(compareValues('apple', ConditionOperator.IN, ['apple', 'banana', 'orange'])).toBe(true);
      expect(compareValues('grape', ConditionOperator.IN, ['apple', 'banana', 'orange'])).toBe(false);

      // Not in
      expect(compareValues('grape', ConditionOperator.NOT_IN, ['apple', 'banana', 'orange'])).toBe(true);
      expect(compareValues('apple', ConditionOperator.NOT_IN, ['apple', 'banana', 'orange'])).toBe(false);
    });
  });

  describe('Utility Functions', () => {
    it('should generate unique violation IDs', () => {
      const id1 = (securityManager as any).generateViolationId();
      const id2 = (securityManager as any).generateViolationId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^viol_[a-f0-9]{16}$/);
    });

    it('should generate unique scan IDs', () => {
      const id1 = (securityManager as any).generateScanId();
      const id2 = (securityManager as any).generateScanId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^scan_[a-f0-9]{16}$/);
    });

    it('should group arrays by property correctly', () => {
      const testArray = [
        { type: 'A', value: 1 },
        { type: 'B', value: 2 },
        { type: 'A', value: 3 },
        { type: 'C', value: 4 }
      ];

      const grouped = (securityManager as any).groupBy(testArray, 'type');

      expect(grouped).toEqual({
        'A': 2,
        'B': 1,
        'C': 1
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle Docker client errors gracefully', async () => {
      mockDockerClient.getContainerInfo.mockRejectedValue(new Error('Docker daemon not running'));

      await expect(securityManager.applyPolicies('test-container')).rejects.toThrow();
    });

    it('should handle policy validation errors', () => {
      const invalidPolicy = {
        id: 'invalid-policy',
        name: 'Invalid Policy',
        description: 'Invalid policy for testing',
        version: '1.0.0',
        enabled: true,
        level: SecurityLevel.MEDIUM,
        enforcement: EnforcementMode.DETECTION,
        rules: [], // Empty rules should cause validation error
        exceptions: [],
        metadata: {
          author: 'Test',
          created: new Date(),
          updated: new Date(),
          tags: [],
          compliance: [],
          requiredCapabilities: [],
          supportedPlatforms: []
        }
      };

      expect(() => securityManager.registerPolicy(invalidPolicy)).toThrow('Policy must have at least one rule');
    });

    it('should handle non-existent policy updates', () => {
      expect(() => {
        securityManager.updatePolicy('non-existent-policy', { enabled: false });
      }).toThrow('Policy not found');
    });

    it('should handle action execution failures gracefully', async () => {
      mockDockerClient.stopContainer.mockRejectedValue(new Error('Failed to stop container'));
      mockDockerClient.getContainerInfo.mockResolvedValue({
        id: 'test-container',
        image: 'ubuntu:latest',
        privileged: true,
        user: '0'
      });

      // Should not throw even if action execution fails
      const profile = await securityManager.applyPolicies('test-container', ['high-security-policy']);
      expect(profile).toBeDefined();
    });
  });
});