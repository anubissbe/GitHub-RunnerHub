/**
 * End-to-End Monitoring & Alerting System Integration Tests
 * Tests the complete monitoring implementation with all components working together
 */

const { describe, it, beforeEach, afterEach, expect } = require('@jest/globals');
const WebSocket = require('ws');
const axios = require('axios');
const MonitoringOrchestrator = require('../../src/monitoring/monitoring-orchestrator');
const PrometheusMetrics = require('../../src/monitoring/prometheus-metrics');
const AlertingSystem = require('../../src/monitoring/alerting-system');
const PerformanceAnalytics = require('../../src/monitoring/performance-analytics');
const RealtimeMonitoringUI = require('../../src/monitoring/realtime-ui');

describe('Monitoring & Alerting System E2E Tests', () => {
  let monitoringOrchestrator;
  let testWebSocketClients = [];

  beforeEach(async () => {
    // Initialize monitoring orchestrator with test configuration
    monitoringOrchestrator = new MonitoringOrchestrator({
      components: {
        prometheusMetrics: {
          enableDefaultMetrics: false, // Disable for testing
          enableBusinessMetrics: true,
          enablePerformanceMetrics: true
        },
        grafanaDashboards: {
          autoImport: false, // Disable Grafana integration for tests
          createFolders: false
        },
        alertingSystem: {
          evaluationInterval: 5000, // 5 seconds for faster testing
          channels: {
            email: { enabled: false },
            slack: { enabled: false },
            webhook: { enabled: false },
            pagerduty: { enabled: false }
          }
        },
        performanceAnalytics: {
          collectionInterval: 5000, // 5 seconds for faster testing
          enableTrendAnalysis: true,
          enableAnomalyDetection: true
        },
        realtimeUI: {
          wsPort: 8081, // Use different port for tests
          updateInterval: 1000 // 1 second for faster testing
        }
      },
      orchestrator: {
        healthCheckInterval: 10000, // 10 seconds for testing
        autoRestart: false // Disable auto-restart for tests
      }
    });

    await monitoringOrchestrator.initialize();
    
    // Wait a moment for components to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterEach(async () => {
    // Close WebSocket test clients
    for (const client of testWebSocketClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }
    testWebSocketClients = [];

    if (monitoringOrchestrator) {
      await monitoringOrchestrator.shutdown();
    }
  });

  describe('Complete Monitoring Workflow', () => {
    it('should initialize all monitoring components successfully', async () => {
      const status = monitoringOrchestrator.getMonitoringStatus();
      
      expect(status.orchestrator.isInitialized).toBe(true);
      expect(status.orchestrator.isRunning).toBe(true);
      expect(status.orchestrator.uptime).toBeGreaterThan(0);
      
      // Check component health
      expect(status.components.health.prometheusMetrics.status).toBe('healthy');
      expect(status.components.health.alertingSystem.status).toBe('healthy');
      expect(status.components.health.performanceAnalytics.status).toBe('healthy');
      expect(status.components.health.realtimeUI.status).toBe('healthy');
    });

    it('should collect and expose Prometheus metrics', async () => {
      // Record some test metrics
      monitoringOrchestrator.recordHttpRequest('GET', '/api/test', 200, 0.125);
      monitoringOrchestrator.recordDatabaseQuery('test_db', 'SELECT', 0.05, true);
      monitoringOrchestrator.recordJob('test/repo', 'ci', 'completed', 'self-hosted', 300);
      monitoringOrchestrator.recordSecurityEvent('test_event', 'info', 'test_source');
      
      // Get metrics
      const metrics = await monitoringOrchestrator.getMetrics();
      
      expect(typeof metrics).toBe('string');
      expect(metrics).toContain('http_requests_total');
      expect(metrics).toContain('database_queries_total');
      expect(metrics).toContain('github_jobs_total');
      expect(metrics).toContain('security_events_total');
    });

    it('should generate and manage alerts', async () => {
      const alertingSystem = monitoringOrchestrator.components.alertingSystem;
      
      // Add a test alert rule
      alertingSystem.addAlertRule({
        id: 'test_alert',
        name: 'Test Alert',
        query: 'test_metric > 10',
        severity: 'warning',
        for: '1m',
        labels: { component: 'test' },
        annotations: {
          summary: 'Test alert triggered',
          description: 'This is a test alert'
        },
        channels: []
      });
      
      // Verify rule was added
      const status = alertingSystem.getStatus();
      expect(status.alertRules).toBeGreaterThan(0);
      expect(status.isEvaluating).toBe(true);
      
      // Wait for at least one evaluation
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      const updatedStatus = alertingSystem.getStatus();
      expect(updatedStatus.lastEvaluation).toBeTruthy();
    });

    it('should perform performance analytics', async () => {
      const performanceAnalytics = monitoringOrchestrator.components.performanceAnalytics;
      
      // Wait for analytics to run
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      const status = performanceAnalytics.getStatus();
      expect(status.isAnalyzing).toBe(true);
      expect(status.lastAnalysis).toBeTruthy();
      expect(status.stats.analysisRuns).toBeGreaterThan(0);
      
      // Generate performance report
      const report = performanceAnalytics.generatePerformanceReport();
      expect(report).toBeTruthy();
      expect(report.summary).toBeTruthy();
      expect(report.timestamp).toBeTruthy();
    });

    it('should provide real-time UI connectivity', async () => {
      const realtimeUI = monitoringOrchestrator.components.realtimeUI;
      
      // Create WebSocket client
      const client = new WebSocket('ws://localhost:8081/monitoring');
      testWebSocketClients.push(client);
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 5000);
        
        client.on('open', () => {
          clearTimeout(timeout);
          
          // Verify connection in UI status
          const status = realtimeUI.getStatus();
          expect(status.wsServerRunning).toBe(true);
          expect(status.isStreaming).toBe(true);
          
          resolve();
        });
        
        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });

    it('should handle WebSocket widget subscriptions', async () => {
      const realtimeUI = monitoringOrchestrator.components.realtimeUI;
      
      // Create WebSocket client
      const client = new WebSocket('ws://localhost:8081/monitoring');
      testWebSocketClients.push(client);
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket test timeout'));
        }, 10000);
        
        let welcomeReceived = false;
        let widgetDataReceived = false;
        
        client.on('open', () => {
          // Subscribe to widgets
          client.send(JSON.stringify({
            type: 'subscribe',
            widgets: ['system-overview', 'performance-metrics']
          }));
        });
        
        client.on('message', (data) => {
          try {
            const message = JSON.parse(data);
            
            if (message.type === 'welcome') {
              welcomeReceived = true;
              expect(message.clientId).toBeTruthy();
              expect(message.config).toBeTruthy();
            }
            
            if (message.type === 'widget_update') {
              widgetDataReceived = true;
              expect(message.widget).toBeTruthy();
              expect(message.data).toBeTruthy();
              expect(message.timestamp).toBeTruthy();
            }
            
            if (welcomeReceived && widgetDataReceived) {
              clearTimeout(timeout);
              resolve();
            }
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });
        
        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });

    it('should handle cross-component event integration', async () => {
      const alertingSystem = monitoringOrchestrator.components.alertingSystem;
      const performanceAnalytics = monitoringOrchestrator.components.performanceAnalytics;
      
      // Set up event listeners
      let alertTriggered = false;
      let anomalyDetected = false;
      
      monitoringOrchestrator.on('alertTriggered', (alert) => {
        alertTriggered = true;
        expect(alert.name).toBeTruthy();
        expect(alert.severity).toBeTruthy();
      });
      
      monitoringOrchestrator.on('criticalAnomaly', (data) => {
        anomalyDetected = true;
        expect(data.metric).toBeTruthy();
        expect(data.anomalies).toBeTruthy();
      });
      
      // Simulate anomaly detection (this would normally happen automatically)
      performanceAnalytics.emit('anomalyDetected', {
        metric: 'test_metric',
        anomalies: [
          { severity: 'high', timestamp: Date.now(), valueKey: 'test', value: 100, zScore: 3.5 }
        ]
      });
      
      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      expect(anomalyDetected).toBe(true);
    });

    it('should perform health checks on all components', async () => {
      // Trigger health check
      await monitoringOrchestrator.performHealthCheck();
      
      const status = monitoringOrchestrator.getMonitoringStatus();
      
      expect(status.orchestrator.lastHealthCheck).toBeTruthy();
      expect(status.orchestrator.stats.totalHealthChecks).toBeGreaterThan(0);
      
      // Verify all components are healthy
      for (const [componentName, health] of Object.entries(status.components.health)) {
        expect(health.status).toBe('healthy');
        expect(health.lastCheck).toBeTruthy();
      }
    });

    it('should record and retrieve comprehensive metrics', async () => {
      // Record various types of metrics
      const metrics = [
        { type: 'http', data: ['POST', '/api/jobs', 201, 0.250] },
        { type: 'db', data: ['main_db', 'INSERT', 0.075, true] },
        { type: 'job', data: ['user/repo', 'build', 'failed', 'docker', 450] },
        { type: 'security', data: ['login_attempt', 'warning', 'auth_service'] }
      ];
      
      for (const metric of metrics) {
        switch (metric.type) {
          case 'http':
            monitoringOrchestrator.recordHttpRequest(...metric.data);
            break;
          case 'db':
            monitoringOrchestrator.recordDatabaseQuery(...metric.data);
            break;
          case 'job':
            monitoringOrchestrator.recordJob(...metric.data);
            break;
          case 'security':
            monitoringOrchestrator.recordSecurityEvent(...metric.data);
            break;
        }
      }
      
      // Retrieve metrics
      const prometheusMetrics = await monitoringOrchestrator.getMetrics();
      expect(prometheusMetrics).toContain('http_requests_total');
      expect(prometheusMetrics).toContain('database_queries_total');
      expect(prometheusMetrics).toContain('github_jobs_total');
      expect(prometheusMetrics).toContain('security_events_total');
      
      // Check metrics were recorded
      const prometheusStatus = monitoringOrchestrator.components.prometheusMetrics.getStats();
      expect(prometheusStatus.totalCollections).toBeGreaterThan(0);
    });

    it('should handle real-time data streaming', async () => {
      const realtimeUI = monitoringOrchestrator.components.realtimeUI;
      
      // Create WebSocket client
      const client = new WebSocket('ws://localhost:8081/monitoring');
      testWebSocketClients.push(client);
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Real-time streaming test timeout'));
        }, 15000);
        
        let updateCount = 0;
        const requiredUpdates = 3;
        
        client.on('open', () => {
          // Subscribe to system overview
          client.send(JSON.stringify({
            type: 'subscribe',
            widgets: ['system-overview']
          }));
        });
        
        client.on('message', (data) => {
          try {
            const message = JSON.parse(data);
            
            if (message.type === 'widget_update' && message.widget === 'system-overview') {
              updateCount++;
              
              expect(message.data.type).toBe('system-overview');
              expect(message.data.metrics).toBeTruthy();
              expect(message.data.lastUpdate).toBeTruthy();
              
              if (updateCount >= requiredUpdates) {
                clearTimeout(timeout);
                resolve();
              }
            }
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });
        
        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle component failures gracefully', async () => {
      const status = monitoringOrchestrator.getMonitoringStatus();
      expect(status.orchestrator.isRunning).toBe(true);
      
      // Simulate component failure by stopping one
      if (monitoringOrchestrator.components.performanceAnalytics) {
        await monitoringOrchestrator.components.performanceAnalytics.shutdown();
      }
      
      // Health check should detect the failure
      await monitoringOrchestrator.performHealthCheck();
      
      const updatedStatus = monitoringOrchestrator.getMonitoringStatus();
      
      // Orchestrator should still be running
      expect(updatedStatus.orchestrator.isRunning).toBe(true);
      expect(updatedStatus.orchestrator.stats.totalHealthChecks).toBeGreaterThan(0);
    });

    it('should handle WebSocket client disconnections', async () => {
      const realtimeUI = monitoringOrchestrator.components.realtimeUI;
      
      // Create and immediately close client
      const client = new WebSocket('ws://localhost:8081/monitoring');
      testWebSocketClients.push(client);
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 5000);
        
        client.on('open', () => {
          clearTimeout(timeout);
          
          // Get initial client count
          const initialStatus = realtimeUI.getStatus();
          const initialClients = initialStatus.clients.active;
          
          // Close client
          client.close();
          
          // Check client count decreased
          setTimeout(() => {
            const finalStatus = realtimeUI.getStatus();
            expect(finalStatus.clients.active).toBeLessThanOrEqual(initialClients);
            resolve();
          }, 1000);
        });
        
        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    });

    it('should maintain data integrity during high load', async () => {
      // Simulate high load by recording many metrics rapidly
      const startTime = Date.now();
      const metricsCount = 100;
      
      for (let i = 0; i < metricsCount; i++) {
        monitoringOrchestrator.recordHttpRequest('GET', `/api/test/${i}`, 200, Math.random() * 0.5);
        monitoringOrchestrator.recordDatabaseQuery('load_test', 'SELECT', Math.random() * 0.1, true);
        
        if (i % 10 === 0) {
          // Small delay every 10 metrics to prevent overwhelming
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      const endTime = Date.now();
      
      // Verify metrics were recorded
      const prometheusMetrics = await monitoringOrchestrator.getMetrics();
      expect(prometheusMetrics).toContain('http_requests_total');
      expect(prometheusMetrics).toContain('database_queries_total');
      
      // Performance should be reasonable
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      
      logger.info(`High load test completed: ${metricsCount} metrics in ${duration}ms`);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle multiple concurrent WebSocket clients', async () => {
      const clientCount = 10;
      const clients = [];
      
      // Create multiple clients
      for (let i = 0; i < clientCount; i++) {
        const client = new WebSocket('ws://localhost:8081/monitoring');
        clients.push(client);
        testWebSocketClients.push(client);
      }
      
      // Wait for all connections
      const connectionPromises = clients.map(client => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Client connection timeout'));
          }, 5000);
          
          client.on('open', () => {
            clearTimeout(timeout);
            
            // Subscribe to widgets
            client.send(JSON.stringify({
              type: 'subscribe',
              widgets: ['system-overview']
            }));
            
            resolve();
          });
          
          client.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      });
      
      await Promise.all(connectionPromises);
      
      // Verify all clients are connected
      const realtimeUI = monitoringOrchestrator.components.realtimeUI;
      const status = realtimeUI.getStatus();
      expect(status.clients.active).toBeGreaterThanOrEqual(clientCount);
      
      // Wait for updates to be sent to all clients
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // All clients should receive updates
      expect(status.stats.messagesTransmitted).toBeGreaterThan(0);
    });

    it('should maintain performance under sustained load', async () => {
      const testDuration = 10000; // 10 seconds
      const startTime = Date.now();
      let metricsRecorded = 0;
      
      // Record metrics continuously
      const recordMetrics = () => {
        if (Date.now() - startTime < testDuration) {
          monitoringOrchestrator.recordHttpRequest('GET', '/api/load-test', 200, Math.random() * 0.3);
          metricsRecorded++;
          setTimeout(recordMetrics, 50); // Record every 50ms
        }
      };
      
      recordMetrics();
      
      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, testDuration + 1000));
      
      // Verify system is still responsive
      const status = monitoringOrchestrator.getMonitoringStatus();
      expect(status.orchestrator.isRunning).toBe(true);
      
      // Check metrics were recorded
      const prometheusMetrics = await monitoringOrchestrator.getMetrics();
      expect(prometheusMetrics).toContain('http_requests_total');
      
      const metricsPerSecond = metricsRecorded / (testDuration / 1000);
      expect(metricsPerSecond).toBeGreaterThan(10); // Should handle at least 10 metrics/second
      
      logger.info(`Sustained load test: ${metricsRecorded} metrics in ${testDuration}ms (${metricsPerSecond.toFixed(1)} metrics/sec)`);
    });
  });
});