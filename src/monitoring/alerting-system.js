/**
 * Comprehensive Alerting System
 * Advanced alerting with multiple notification channels, escalation policies, and intelligent routing
 */

const EventEmitter = require('events');
const axios = require('axios');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class AlertingSystem extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Alert evaluation
      evaluation: {
        interval: options.evaluationInterval || 30000, // 30 seconds
        batchSize: options.batchSize || 50,
        retryAttempts: options.retryAttempts || 3,
        retryDelay: options.retryDelay || 5000
      },
      
      // Notification channels
      channels: {
        email: {
          enabled: options.emailEnabled || false,
          smtp: {
            host: options.smtpHost || process.env.SMTP_HOST,
            port: options.smtpPort || process.env.SMTP_PORT || 587,
            secure: options.smtpSecure || false,
            auth: {
              user: options.smtpUser || process.env.SMTP_USER,
              pass: options.smtpPassword || process.env.SMTP_PASSWORD
            }
          },
          from: options.emailFrom || process.env.EMAIL_FROM || 'noreply@runnerhub.com',
          templates: options.emailTemplates || {}
        },
        
        slack: {
          enabled: options.slackEnabled || false,
          webhookUrl: options.slackWebhook || process.env.SLACK_WEBHOOK_URL,
          channel: options.slackChannel || '#alerts',
          username: options.slackUsername || 'RunnerHub Alerts',
          iconEmoji: options.slackIcon || ':warning:'
        },
        
        webhook: {
          enabled: options.webhookEnabled || false,
          urls: options.webhookUrls || [],
          timeout: options.webhookTimeout || 10000,
          retries: options.webhookRetries || 2
        },
        
        pagerduty: {
          enabled: options.pagerdutyEnabled || false,
          integrationKey: options.pagerdutyKey || process.env.PAGERDUTY_INTEGRATION_KEY,
          apiUrl: 'https://events.pagerduty.com/v2/enqueue'
        }
      },
      
      // Alert rules configuration
      rules: {
        defaultSeverity: options.defaultSeverity || 'warning',
        severityLevels: options.severityLevels || ['info', 'warning', 'critical'],
        evaluationTimeout: options.evaluationTimeout || 30000,
        suppressDuplicates: options.suppressDuplicates !== false,
        suppressionWindow: options.suppressionWindow || 300000 // 5 minutes
      },
      
      // Escalation policies
      escalation: {
        enabled: options.escalationEnabled || false,
        levels: options.escalationLevels || [
          { duration: 300000, channels: ['slack'] },      // 5 minutes
          { duration: 900000, channels: ['email'] },      // 15 minutes
          { duration: 1800000, channels: ['pagerduty'] }  // 30 minutes
        ]
      },
      
      ...options
    };
    
    // Alert rules storage
    this.alertRules = new Map();
    this.activeAlerts = new Map();
    this.alertHistory = [];
    this.suppressedAlerts = new Set();
    
    // Notification channel clients
    this.notificationClients = {};
    
    // Evaluation state
    this.isEvaluating = false;
    this.evaluationTimer = null;
    this.lastEvaluation = null;
    
    // Statistics
    this.stats = {
      totalAlerts: 0,
      alertsByChannel: new Map(),
      alertsBySeverity: new Map(),
      escalatedAlerts: 0,
      suppressedAlerts: 0,
      failedNotifications: 0
    };
  }

  /**
   * Initialize alerting system
   */
  async initialize() {
    try {
      logger.info('Initializing Alerting System');
      
      // Initialize notification channels
      await this.initializeNotificationChannels();
      
      // Load default alert rules
      this.loadDefaultAlertRules();
      
      // Start alert evaluation
      this.startEvaluation();
      
      this.emit('initialized');
      logger.info('Alerting System initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Alerting System:', error);
      throw error;
    }
  }

  /**
   * Initialize notification channels
   */
  async initializeNotificationChannels() {
    // Initialize email client
    if (this.config.channels.email.enabled && this.config.channels.email.smtp.host) {
      this.notificationClients.email = nodemailer.createTransporter(this.config.channels.email.smtp);
      
      // Test email connection
      try {
        await this.notificationClients.email.verify();
        logger.info('Email notification channel initialized');
      } catch (error) {
        logger.error('Email notification channel failed:', error);
        this.config.channels.email.enabled = false;
      }
    }
    
    // Initialize Slack client
    if (this.config.channels.slack.enabled && this.config.channels.slack.webhookUrl) {
      this.notificationClients.slack = axios.create({
        timeout: 10000
      });
      logger.info('Slack notification channel initialized');
    }
    
    // Initialize webhook clients
    if (this.config.channels.webhook.enabled && this.config.channels.webhook.urls.length > 0) {
      this.notificationClients.webhook = axios.create({
        timeout: this.config.channels.webhook.timeout
      });
      logger.info('Webhook notification channels initialized');
    }
    
    // Initialize PagerDuty client
    if (this.config.channels.pagerduty.enabled && this.config.channels.pagerduty.integrationKey) {
      this.notificationClients.pagerduty = axios.create({
        baseURL: this.config.channels.pagerduty.apiUrl,
        timeout: 10000
      });
      logger.info('PagerDuty notification channel initialized');
    }
  }

  /**
   * Load default alert rules
   */
  loadDefaultAlertRules() {
    // System resource alerts
    this.addAlertRule({
      id: 'high_cpu_usage',
      name: 'High CPU Usage',
      query: '100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 90',
      severity: 'warning',
      for: '5m',
      labels: { component: 'system', resource: 'cpu' },
      annotations: {
        summary: 'High CPU usage detected',
        description: 'CPU usage is above 90% for 5 minutes'
      },
      channels: ['slack', 'email']
    });
    
    this.addAlertRule({
      id: 'high_memory_usage',
      name: 'High Memory Usage',
      query: '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 95',
      severity: 'critical',
      for: '2m',
      labels: { component: 'system', resource: 'memory' },
      annotations: {
        summary: 'Critical memory usage detected',
        description: 'Memory usage is above 95% for 2 minutes'
      },
      channels: ['slack', 'email', 'pagerduty']
    });
    
    // Application alerts
    this.addAlertRule({
      id: 'high_response_time',
      name: 'High HTTP Response Time',
      query: 'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2',
      severity: 'warning',
      for: '3m',
      labels: { component: 'application', metric: 'response_time' },
      annotations: {
        summary: 'High HTTP response time detected',
        description: '95th percentile response time is above 2 seconds'
      },
      channels: ['slack']
    });
    
    this.addAlertRule({
      id: 'high_error_rate',
      name: 'High HTTP Error Rate',
      query: 'rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) * 100 > 10',
      severity: 'critical',
      for: '2m',
      labels: { component: 'application', metric: 'error_rate' },
      annotations: {
        summary: 'High HTTP error rate detected',
        description: 'HTTP error rate is above 10% for 2 minutes'
      },
      channels: ['slack', 'email', 'pagerduty']
    });
    
    // Business logic alerts
    this.addAlertRule({
      id: 'job_failure_rate',
      name: 'High Job Failure Rate',
      query: 'rate(github_jobs_total{status="failed"}[10m]) / rate(github_jobs_total[10m]) * 100 > 20',
      severity: 'warning',
      for: '5m',
      labels: { component: 'business', metric: 'job_failure_rate' },
      annotations: {
        summary: 'High job failure rate detected',
        description: 'GitHub job failure rate is above 20%'
      },
      channels: ['slack', 'email']
    });
    
    this.addAlertRule({
      id: 'api_rate_limit_low',
      name: 'GitHub API Rate Limit Low',
      query: 'github_api_rate_limit_remaining < 500',
      severity: 'warning',
      for: '1m',
      labels: { component: 'integration', service: 'github_api' },
      annotations: {
        summary: 'GitHub API rate limit running low',
        description: 'Less than 500 API calls remaining'
      },
      channels: ['slack']
    });
    
    // Security alerts
    this.addAlertRule({
      id: 'security_events_spike',
      name: 'Security Events Spike',
      query: 'rate(security_events_total[5m]) > 10',
      severity: 'critical',
      for: '1m',
      labels: { component: 'security', metric: 'events' },
      annotations: {
        summary: 'Security events spike detected',
        description: 'High rate of security events detected'
      },
      channels: ['slack', 'email', 'pagerduty']
    });
    
    this.addAlertRule({
      id: 'failed_login_attempts',
      name: 'Multiple Failed Login Attempts',
      query: 'rate(failed_login_attempts_total[5m]) > 5',
      severity: 'warning',
      for: '2m',
      labels: { component: 'security', metric: 'authentication' },
      annotations: {
        summary: 'Multiple failed login attempts detected',
        description: 'High rate of failed authentication attempts'
      },
      channels: ['slack', 'email']
    });
    
    logger.info(`Loaded ${this.alertRules.size} default alert rules`);
  }

  /**
   * Add alert rule
   */
  addAlertRule(rule) {
    // Validate rule
    if (!rule.id || !rule.name || !rule.query) {
      throw new Error('Alert rule must have id, name, and query');
    }
    
    // Set defaults
    const alertRule = {
      id: rule.id,
      name: rule.name,
      query: rule.query,
      severity: rule.severity || this.config.rules.defaultSeverity,
      for: rule.for || '1m',
      labels: rule.labels || {},
      annotations: rule.annotations || {},
      channels: rule.channels || ['slack'],
      enabled: rule.enabled !== false,
      createdAt: new Date(),
      lastEvaluated: null,
      lastTriggered: null
    };
    
    this.alertRules.set(rule.id, alertRule);
    logger.info(`Added alert rule: ${rule.name}`);
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId) {
    if (this.alertRules.delete(ruleId)) {
      logger.info(`Removed alert rule: ${ruleId}`);
      return true;
    }
    return false;
  }

  /**
   * Start alert evaluation
   */
  startEvaluation() {
    if (this.isEvaluating) {
      logger.warn('Alert evaluation already running');
      return;
    }
    
    this.isEvaluating = true;
    this.evaluationTimer = setInterval(() => {
      this.evaluateRules().catch(error => {
        logger.error('Alert rule evaluation failed:', error);
      });
    }, this.config.evaluation.interval);
    
    logger.info(`Started alert evaluation with ${this.config.evaluation.interval}ms interval`);
  }

  /**
   * Stop alert evaluation
   */
  stopEvaluation() {
    if (!this.isEvaluating) {
      return;
    }
    
    this.isEvaluating = false;
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
    
    logger.info('Stopped alert evaluation');
  }

  /**
   * Evaluate all alert rules
   */
  async evaluateRules() {
    const startTime = Date.now();
    const enabledRules = Array.from(this.alertRules.values()).filter(rule => rule.enabled);
    
    try {
      for (const rule of enabledRules) {
        await this.evaluateRule(rule);
      }
      
      this.lastEvaluation = new Date();
      
      this.emit('evaluationCompleted', {
        duration: Date.now() - startTime,
        rulesEvaluated: enabledRules.length,
        timestamp: this.lastEvaluation
      });
      
    } catch (error) {
      logger.error('Failed to evaluate alert rules:', error);
      throw error;
    }
  }

  /**
   * Evaluate single alert rule
   */
  async evaluateRule(rule) {
    try {
      rule.lastEvaluated = new Date();
      
      // In a real implementation, this would query Prometheus
      // For now, we'll simulate the evaluation
      const triggered = await this.queryPrometheus(rule.query);
      
      if (triggered) {
        await this.handleTriggeredAlert(rule);
      } else {
        await this.handleResolvedAlert(rule);
      }
      
    } catch (error) {
      logger.error(`Failed to evaluate rule ${rule.id}:`, error);
    }
  }

  /**
   * Query Prometheus (placeholder implementation)
   */
  async queryPrometheus(_query) {
    // In a real implementation, this would make an HTTP request to Prometheus
    // For now, we'll simulate random triggers for demonstration
    return Math.random() < 0.1; // 10% chance of triggering
  }

  /**
   * Handle triggered alert
   */
  async handleTriggeredAlert(rule) {
    const alertId = `${rule.id}_${Date.now()}`;
    
    // Check if alert is suppressed
    if (this.isAlertSuppressed(rule)) {
      this.stats.suppressedAlerts++;
      return;
    }
    
    // Create alert
    const alert = {
      id: alertId,
      ruleId: rule.id,
      name: rule.name,
      severity: rule.severity,
      status: 'firing',
      labels: rule.labels,
      annotations: rule.annotations,
      startsAt: new Date(),
      endsAt: null,
      generatorURL: `http://localhost:3001/alerts/${alertId}`,
      fingerprint: this.generateFingerprint(rule)
    };
    
    // Store active alert
    this.activeAlerts.set(alertId, alert);
    this.alertHistory.push({ ...alert, action: 'triggered' });
    
    // Update statistics
    this.stats.totalAlerts++;
    this.updateSeverityStats(alert.severity);
    
    // Send notifications
    await this.sendAlertNotifications(alert, rule.channels);
    
    // Add to suppression if enabled
    if (this.config.rules.suppressDuplicates) {
      this.suppressedAlerts.add(alert.fingerprint);
      setTimeout(() => {
        this.suppressedAlerts.delete(alert.fingerprint);
      }, this.config.rules.suppressionWindow);
    }
    
    rule.lastTriggered = new Date();
    
    this.emit('alertTriggered', alert);
    logger.warn(`Alert triggered: ${rule.name} (${alert.severity})`);
  }

  /**
   * Handle resolved alert
   */
  async handleResolvedAlert(rule) {
    // Find active alerts for this rule
    const activeAlerts = Array.from(this.activeAlerts.values())
      .filter(alert => alert.ruleId === rule.id && alert.status === 'firing');
    
    for (const alert of activeAlerts) {
      alert.status = 'resolved';
      alert.endsAt = new Date();
      
      this.alertHistory.push({ ...alert, action: 'resolved' });
      this.activeAlerts.delete(alert.id);
      
      // Send resolution notifications
      await this.sendResolutionNotifications(alert, rule.channels);
      
      this.emit('alertResolved', alert);
      logger.info(`Alert resolved: ${rule.name}`);
    }
  }

  /**
   * Send alert notifications
   */
  async sendAlertNotifications(alert, channels) {
    const notifications = [];
    
    for (const channel of channels) {
      if (this.config.channels[channel]?.enabled) {
        notifications.push(this.sendNotification(channel, alert, 'alert'));
      }
    }
    
    try {
      await Promise.allSettled(notifications);
      this.updateChannelStats(channels);
    } catch (error) {
      logger.error('Failed to send alert notifications:', error);
      this.stats.failedNotifications++;
    }
  }

  /**
   * Send resolution notifications
   */
  async sendResolutionNotifications(alert, channels) {
    const notifications = [];
    
    for (const channel of channels) {
      if (this.config.channels[channel]?.enabled) {
        notifications.push(this.sendNotification(channel, alert, 'resolution'));
      }
    }
    
    try {
      await Promise.allSettled(notifications);
    } catch (error) {
      logger.error('Failed to send resolution notifications:', error);
      this.stats.failedNotifications++;
    }
  }

  /**
   * Send notification to specific channel
   */
  async sendNotification(channel, alert, type) {
    try {
      switch (channel) {
        case 'email':
          await this.sendEmailNotification(alert, type);
          break;
        case 'slack':
          await this.sendSlackNotification(alert, type);
          break;
        case 'webhook':
          await this.sendWebhookNotification(alert, type);
          break;
        case 'pagerduty':
          await this.sendPagerDutyNotification(alert, type);
          break;
        default:
          logger.warn(`Unknown notification channel: ${channel}`);
      }
    } catch (error) {
      logger.error(`Failed to send ${channel} notification:`, error);
      throw error;
    }
  }

  /**
   * Send email notification
   */
  async sendEmailNotification(alert, type) {
    if (!this.notificationClients.email) {
      throw new Error('Email client not initialized');
    }
    
    const subject = type === 'alert' 
      ? `[${alert.severity.toUpperCase()}] ${alert.name}` 
      : `[RESOLVED] ${alert.name}`;
    
    const html = this.generateEmailTemplate(alert, type);
    
    await this.notificationClients.email.sendMail({
      from: this.config.channels.email.from,
      to: this.config.channels.email.recipients || 'admin@example.com',
      subject,
      html
    });
  }

  /**
   * Send Slack notification
   */
  async sendSlackNotification(alert, type) {
    if (!this.notificationClients.slack) {
      throw new Error('Slack client not initialized');
    }
    
    const color = this.getSeverityColor(alert.severity);
    const emoji = type === 'alert' ? ':warning:' : ':white_check_mark:';
    
    const payload = {
      channel: this.config.channels.slack.channel,
      username: this.config.channels.slack.username,
      icon_emoji: this.config.channels.slack.iconEmoji,
      attachments: [
        {
          color,
          title: `${emoji} ${alert.name}`,
          text: alert.annotations.description,
          fields: [
            {
              title: 'Severity',
              value: alert.severity.toUpperCase(),
              short: true
            },
            {
              title: 'Status',
              value: type === 'alert' ? 'FIRING' : 'RESOLVED',
              short: true
            },
            {
              title: 'Time',
              value: new Date().toISOString(),
              short: true
            }
          ],
          footer: 'GitHub RunnerHub Monitoring',
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    };
    
    await this.notificationClients.slack.post(this.config.channels.slack.webhookUrl, payload);
  }

  /**
   * Send webhook notification
   */
  async sendWebhookNotification(alert, type) {
    if (!this.notificationClients.webhook) {
      throw new Error('Webhook client not initialized');
    }
    
    const payload = {
      alert,
      type,
      timestamp: new Date().toISOString(),
      source: 'github-runnerhub'
    };
    
    const notifications = this.config.channels.webhook.urls.map(url => 
      this.notificationClients.webhook.post(url, payload)
    );
    
    await Promise.all(notifications);
  }

  /**
   * Send PagerDuty notification
   */
  async sendPagerDutyNotification(alert, type) {
    if (!this.notificationClients.pagerduty) {
      throw new Error('PagerDuty client not initialized');
    }
    
    const eventAction = type === 'alert' ? 'trigger' : 'resolve';
    
    const payload = {
      routing_key: this.config.channels.pagerduty.integrationKey,
      event_action: eventAction,
      dedup_key: alert.fingerprint,
      payload: {
        summary: alert.annotations.summary,
        source: 'github-runnerhub',
        severity: alert.severity,
        component: alert.labels.component || 'unknown',
        group: alert.labels.group || 'default',
        class: alert.labels.class || 'monitoring'
      }
    };
    
    await this.notificationClients.pagerduty.post('', payload);
  }

  /**
   * Generate email template
   */
  generateEmailTemplate(alert, type) {
    const status = type === 'alert' ? 'FIRING' : 'RESOLVED';
    const color = this.getSeverityColor(alert.severity);
    
    return `
      <html>
        <body style="font-family: Arial, sans-serif;">
          <div style="border-left: 4px solid ${color}; padding: 20px; margin: 20px 0;">
            <h2 style="color: ${color}; margin: 0;">${alert.name}</h2>
            <p><strong>Status:</strong> ${status}</p>
            <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
            <p><strong>Description:</strong> ${alert.annotations.description}</p>
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
            
            ${Object.keys(alert.labels).length > 0 ? `
              <h3>Labels:</h3>
              <ul>
                ${Object.entries(alert.labels).map(([key, value]) => 
                  `<li><strong>${key}:</strong> ${value}</li>`
                ).join('')}
              </ul>
            ` : ''}
            
            <hr>
            <p style="font-size: 12px; color: #666;">
              Generated by GitHub RunnerHub Monitoring System
            </p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Helper methods
   */
  
  isAlertSuppressed(rule) {
    if (!this.config.rules.suppressDuplicates) {
      return false;
    }
    
    const fingerprint = this.generateFingerprint(rule);
    return this.suppressedAlerts.has(fingerprint);
  }
  
  generateFingerprint(rule) {
    return `${rule.id}_${JSON.stringify(rule.labels)}`;
  }
  
  getSeverityColor(severity) {
    const colors = {
      info: '#36a3f7',
      warning: '#ffab00',
      critical: '#f56a00'
    };
    return colors[severity] || colors.warning;
  }
  
  updateSeverityStats(severity) {
    const count = this.stats.alertsBySeverity.get(severity) || 0;
    this.stats.alertsBySeverity.set(severity, count + 1);
  }
  
  updateChannelStats(channels) {
    for (const channel of channels) {
      const count = this.stats.alertsByChannel.get(channel) || 0;
      this.stats.alertsByChannel.set(channel, count + 1);
    }
  }

  /**
   * Get alerting system status
   */
  getStatus() {
    return {
      isEvaluating: this.isEvaluating,
      alertRules: this.alertRules.size,
      activeAlerts: this.activeAlerts.size,
      lastEvaluation: this.lastEvaluation,
      stats: {
        ...this.stats,
        alertsByChannel: Object.fromEntries(this.stats.alertsByChannel),
        alertsBySeverity: Object.fromEntries(this.stats.alertsBySeverity)
      },
      channels: {
        email: this.config.channels.email.enabled,
        slack: this.config.channels.slack.enabled,
        webhook: this.config.channels.webhook.enabled,
        pagerduty: this.config.channels.pagerduty.enabled
      }
    };
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit = 100) {
    return this.alertHistory
      .slice(-limit)
      .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
  }

  /**
   * Get active alerts
   */
  getActiveAlerts() {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Shutdown alerting system
   */
  async shutdown() {
    logger.info('Shutting down Alerting System');
    
    this.stopEvaluation();
    
    // Close notification clients
    if (this.notificationClients.email) {
      this.notificationClients.email.close();
    }
    
    this.emit('shutdown');
    logger.info('Alerting System shutdown completed');
  }
}

module.exports = AlertingSystem;