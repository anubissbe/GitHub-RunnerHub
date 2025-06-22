import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ContainerTemplateManager, TemplateConfig, ContainerCategory } from '../container-templates';
import { DockerClient } from '../../docker-client';

// Mock DockerClient
jest.mock('../../docker-client');
const MockedDockerClient = jest.mocked(DockerClient);

describe('ContainerTemplateManager', () => {
  let templateManager: ContainerTemplateManager;
  let mockDockerClient: jest.Mocked<DockerClient>;

  beforeEach(() => {
    // Reset singleton
    (ContainerTemplateManager as any).instance = undefined;
    
    // Mock DockerClient
    mockDockerClient = {
      createContainer: jest.fn(),
      getContainerInfo: jest.fn(),
      listImages: jest.fn(),
      pullImage: jest.fn()
    } as any;
    
    MockedDockerClient.getInstance.mockReturnValue(mockDockerClient);
    
    templateManager = ContainerTemplateManager.getInstance();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Template Registration and Retrieval', () => {
    it('should initialize with default templates', () => {
      const templates = templateManager.listTemplates();
      
      expect(templates.length).toBe(4);
      expect(templates.map(t => t.id)).toEqual([
        'ubuntu-runner',
        'nodejs-runner', 
        'python-runner',
        'docker-dind'
      ]);
    });

    it('should register a new template', () => {
      const customTemplate: TemplateConfig = {
        id: 'custom-java',
        name: 'Java Runner',
        description: 'Java 11 environment',
        image: 'openjdk',
        tag: '11',
        category: ContainerCategory.JAVA,
        labels: {
          'github.runner.type': 'java',
          'github.runner.version': '11'
        },
        environment: {
          'JAVA_HOME': '/usr/local/openjdk-11'
        },
        exposedPorts: [],
        volumes: [],
        resources: {
          cpuLimit: 2,
          memoryLimit: '4g'
        },
        securityOptions: {
          privileged: false,
          readOnlyRootfs: false,
          noNewPrivileges: true,
          capabilities: {
            add: [],
            drop: ['ALL']
          }
        },
        restartPolicy: {
          name: 'on-failure'
        },
        metadata: {
          version: '1.0.0',
          maintainer: 'Test',
          created: new Date(),
          updated: new Date(),
          tags: ['java'],
          githubActions: {
            compatible: true,
            requiredLabels: ['self-hosted', 'linux', 'java'],
            supportedSteps: ['run', 'setup-java']
          },
          performance: {
            startupTime: 25,
            memoryFootprint: 1536,
            cpuIntensive: true
          },
          security: {
            level: 'medium',
            scanRequired: true,
            trustedBase: true
          }
        }
      };

      templateManager.registerTemplate(customTemplate);
      
      const retrieved = templateManager.getTemplate('custom-java');
      expect(retrieved).toEqual(customTemplate);
    });

    it('should retrieve templates by category', () => {
      const nodeTemplates = templateManager.listTemplates(ContainerCategory.NODEJS);
      
      expect(nodeTemplates.length).toBe(1);
      expect(nodeTemplates[0].id).toBe('nodejs-runner');
    });
  });

  describe('Template Search', () => {
    it('should search templates by labels', () => {
      const results = templateManager.searchTemplates({
        labels: ['self-hosted', 'linux', 'ubuntu']
      });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ubuntu-runner');
    });

    it('should search templates by category and tags', () => {
      const results = templateManager.searchTemplates({
        category: ContainerCategory.NODEJS,
        tags: ['typescript']
      });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('nodejs-runner');
    });

    it('should search templates by security level', () => {
      const results = templateManager.searchTemplates({
        securityLevel: 'high'
      });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('docker-dind');
    });
  });

  describe('Template Validation', () => {
    it('should validate template configuration', () => {
      const invalidTemplate: TemplateConfig = {
        id: '',
        name: '',
        description: 'Invalid template',
        image: '',
        tag: '',
        category: ContainerCategory.GENERAL,
        labels: {},
        environment: {},
        exposedPorts: [
          {
            containerPort: 99999, // Invalid port
            protocol: 'tcp'
          }
        ],
        volumes: [
          {
            source: '', // Missing source
            target: '',
            type: 'bind'
          }
        ],
        resources: {
          cpuLimit: -1, // Invalid CPU
          memoryLimit: 'invalid'
        },
        securityOptions: {
          privileged: true,
          readOnlyRootfs: false,
          noNewPrivileges: true,
          capabilities: {
            add: [],
            drop: []
          }
        },
        restartPolicy: {
          name: 'no'
        },
        metadata: {
          version: '1.0.0',
          maintainer: 'Test',
          created: new Date(),
          updated: new Date(),
          tags: [],
          githubActions: {
            compatible: true,
            requiredLabels: [],
            supportedSteps: []
          },
          performance: {
            startupTime: 30,
            memoryFootprint: 512,
            cpuIntensive: false
          },
          security: {
            level: 'low', // Should be critical for privileged
            scanRequired: false,
            trustedBase: true
          }
        }
      };

      const errors = templateManager.validateTemplate(invalidTemplate);
      
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Template ID is required');
      expect(errors).toContain('Template name is required');
      expect(errors).toContain('Template image is required');
      expect(errors).toContain('CPU limit must be greater than 0');
      expect(errors).toContain('Memory limit must be in format like "512m" or "2g"');
      expect(errors).toContain('Privileged containers must have critical security level');
    });

    it('should pass validation for valid template', () => {
      const validTemplate = templateManager.getTemplate('ubuntu-runner')!;
      const errors = templateManager.validateTemplate(validTemplate);
      
      expect(errors).toEqual([]);
    });
  });

  describe('Container Creation from Template', () => {
    beforeEach(() => {
      mockDockerClient.listImages.mockResolvedValue([
        {
          id: 'ubuntu:22.04',
          repository: 'ubuntu',
          tag: '22.04',
          size: 1000000,
          created: new Date(),
          labels: {}
        }
      ]);
      mockDockerClient.createContainer.mockResolvedValue('container-123');
    });

    it('should create container from template', async () => {
      const containerId = await templateManager.createContainerFromTemplate(
        'ubuntu-runner',
        {
          name: 'test-ubuntu-container',
          environment: {
            'CUSTOM_VAR': 'value'
          },
          labels: {
            'custom.label': 'test'
          }
        }
      );

      expect(containerId).toBe('container-123');
      expect(mockDockerClient.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Image: 'ubuntu:22.04',
          name: 'test-ubuntu-container',
          Env: expect.arrayContaining([
            'CUSTOM_VAR=value',
            'DEBIAN_FRONTEND=noninteractive'
          ]),
          Labels: expect.objectContaining({
            'custom.label': 'test',
            'template.id': 'ubuntu-runner'
          })
        })
      );
    });

    it('should pull image if not available', async () => {
      mockDockerClient.listImages.mockResolvedValue([]);
      
      await templateManager.createContainerFromTemplate(
        'ubuntu-runner',
        { name: 'test-container' }
      );

      expect(mockDockerClient.pullImage).toHaveBeenCalledWith('ubuntu', '22.04');
    });

    it('should throw error for non-existent template', async () => {
      await expect(
        templateManager.createContainerFromTemplate(
          'non-existent',
          { name: 'test' }
        )
      ).rejects.toThrow('Template not found: non-existent');
    });
  });

  describe('Template Management', () => {
    it('should update template', () => {
      const template = templateManager.getTemplate('ubuntu-runner')!;
      const originalVersion = template.metadata.version;

      templateManager.updateTemplate('ubuntu-runner', {
        description: 'Updated Ubuntu runner',
        metadata: {
          ...template.metadata,
          version: '1.1.0'
        }
      });

      const updated = templateManager.getTemplate('ubuntu-runner')!;
      expect(updated.description).toBe('Updated Ubuntu runner');
      expect(updated.metadata.version).toBe('1.1.0');
      expect(updated.metadata.updated).not.toEqual(template.metadata.updated);
    });

    it('should remove template', () => {
      const result = templateManager.removeTemplate('ubuntu-runner');
      
      expect(result).toBe(true);
      expect(templateManager.getTemplate('ubuntu-runner')).toBeUndefined();
    });

    it('should clone template', () => {
      const cloned = templateManager.cloneTemplate(
        'ubuntu-runner',
        'ubuntu-runner-custom',
        {
          name: 'Custom Ubuntu Runner',
          description: 'Customized Ubuntu environment',
          environment: {
            'CUSTOM_ENV': 'value'
          }
        }
      );

      expect(cloned.id).toBe('ubuntu-runner-custom');
      expect(cloned.name).toBe('Custom Ubuntu Runner');
      expect(cloned.environment.CUSTOM_ENV).toBe('value');
      expect(cloned.image).toBe('ubuntu'); // Inherited from original
    });
  });

  describe('Template Recommendations', () => {
    it('should recommend templates based on labels', () => {
      const recommendations = templateManager.getRecommendedTemplates({
        labels: ['self-hosted', 'linux', 'nodejs']
      });

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].id).toBe('nodejs-runner');
    });

    it('should recommend templates based on resource requirements', () => {
      const recommendations = templateManager.getRecommendedTemplates({
        resourceRequirements: {
          minCpu: 4,
          minMemory: '6g'
        }
      });

      // Should prefer templates with higher resources
      expect(recommendations.length).toBeGreaterThan(0);
      const recommended = recommendations[0];
      expect(recommended.resources.cpuLimit).toBeGreaterThanOrEqual(4);
    });

    it('should recommend templates based on performance requirements', () => {
      const recommendations = templateManager.getRecommendedTemplates({
        performance: {
          maxStartupTime: 20,
          maxMemoryFootprint: 1000
        }
      });

      expect(recommendations.length).toBeGreaterThan(0);
      const recommended = recommendations[0];
      expect(recommended.metadata.performance.startupTime).toBeLessThanOrEqual(20);
    });
  });

  describe('Template Statistics', () => {
    it('should provide template statistics', () => {
      const stats = templateManager.getTemplateStatistics();

      expect(stats).toMatchObject({
        total: 4,
        byCategory: expect.any(Object),
        bySecurityLevel: expect.any(Object),
        averageStartupTime: expect.any(Number),
        averageMemoryFootprint: expect.any(Number)
      });

      expect(stats.byCategory[ContainerCategory.GENERAL]).toBe(1);
      expect(stats.byCategory[ContainerCategory.NODEJS]).toBe(1);
      expect(stats.bySecurityLevel.medium).toBe(3);
      expect(stats.bySecurityLevel.high).toBe(1);
    });
  });

  describe('Template Import/Export', () => {
    it('should export template', () => {
      const exported = templateManager.exportTemplate('ubuntu-runner');

      expect(exported).toBeTruthy();
      expect(exported!.id).toBe('ubuntu-runner');
      expect(exported).not.toBe(templateManager.getTemplate('ubuntu-runner')); // Should be a copy
    });

    it('should import template', () => {
      const templateConfig: TemplateConfig = {
        id: 'imported-template',
        name: 'Imported Template',
        description: 'Template imported from external source',
        image: 'alpine',
        tag: 'latest',
        category: ContainerCategory.GENERAL,
        labels: {},
        environment: {},
        exposedPorts: [],
        volumes: [],
        resources: {
          cpuLimit: 1,
          memoryLimit: '1g'
        },
        securityOptions: {
          privileged: false,
          readOnlyRootfs: false,
          noNewPrivileges: true,
          capabilities: {
            add: [],
            drop: ['ALL']
          }
        },
        restartPolicy: {
          name: 'no'
        },
        metadata: {
          version: '1.0.0',
          maintainer: 'External',
          created: new Date(),
          updated: new Date(),
          tags: ['alpine'],
          githubActions: {
            compatible: true,
            requiredLabels: ['self-hosted'],
            supportedSteps: ['run']
          },
          performance: {
            startupTime: 10,
            memoryFootprint: 256,
            cpuIntensive: false
          },
          security: {
            level: 'medium',
            scanRequired: true,
            trustedBase: true
          }
        }
      };

      templateManager.importTemplate(templateConfig);
      
      const imported = templateManager.getTemplate('imported-template');
      expect(imported).toBeTruthy();
      expect(imported!.name).toBe('Imported Template');
    });
  });

  describe('Template Cleanup', () => {
    it('should cleanup unused templates', async () => {
      // Add a custom template with old timestamp
      const oldTemplate = templateManager.cloneTemplate(
        'ubuntu-runner',
        'old-template',
        { name: 'Old Template' }
      );
      
      // Manually set old timestamp
      oldTemplate.metadata.updated = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      templateManager.updateTemplate('old-template', oldTemplate);

      const removedTemplates = await templateManager.cleanupUnusedTemplates(30);

      expect(removedTemplates).toContain('old-template');
      expect(templateManager.getTemplate('old-template')).toBeUndefined();
      
      // Default templates should not be removed
      expect(templateManager.getTemplate('ubuntu-runner')).toBeTruthy();
    });
  });

  describe('Container-to-Template Creation', () => {
    beforeEach(() => {
      mockDockerClient.getContainerInfo.mockResolvedValue({
        id: 'container-123',
        name: 'test-container',
        image: 'ubuntu:20.04',
        status: 'running',
        state: 'running',
        created: new Date(),
        ports: [
          {
            containerPort: 3000,
            hostPort: 3000,
            protocol: 'tcp'
          }
        ],
        mounts: [
          {
            source: '/host/path',
            destination: '/container/path',
            mode: 'rw',
            type: 'bind'
          }
        ],
        networks: [],
        labels: {
          'custom.label': 'value'
        },
        environment: [
          'NODE_ENV=production',
          'PORT=3000'
        ]
      });
    });

    it('should create template from existing container', async () => {
      const template = await templateManager.createTemplateFromContainer(
        'container-123',
        {
          id: 'from-container',
          name: 'Template from Container',
          description: 'Generated from existing container',
          category: ContainerCategory.NODEJS,
          maintainer: 'Test User',
          tags: ['generated', 'container']
        }
      );

      expect(template.id).toBe('from-container');
      expect(template.name).toBe('Template from Container');
      expect(template.image).toBe('ubuntu');
      expect(template.tag).toBe('20.04');
      expect(template.environment.NODE_ENV).toBe('production');
      expect(template.environment.PORT).toBe('3000');
      expect(template.exposedPorts[0].containerPort).toBe(3000);
      expect(template.volumes[0].source).toBe('/host/path');
      
      // Should be registered in template manager
      const retrieved = templateManager.getTemplate('from-container');
      expect(retrieved).toEqual(template);
    });
  });
});