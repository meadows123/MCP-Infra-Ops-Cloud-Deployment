const winston = require('winston');

class NotificationService {
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'notification-service' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    this.notifications = new Map();
    this.subscribers = new Set();
    this.notificationCounter = 0;
    this.templates = new Map();

    // Define notification templates
    this.defineTemplates();
  }

  defineTemplates() {
    // Network Issue Alert Template
    this.templates.set('network_issue_alert', {
      subject: '🚨 Network Issue Detected - {device_name}',
      body: `
Dear Network Administrator,

A network issue has been detected on device {device_name}.

**Issue Details:**
- Device: {device_name}
- Type: {issue_type}
- Severity: {severity}
- Description: {description}
- Time: {timestamp}

**Actions Taken:**
{actions_taken}

**Next Steps:**
{next_steps}

This is an automated notification from the MCP Network Automation System.

Best regards,
Network Automation Team
      `.trim()
    });

    // Workflow Completion Template
    this.templates.set('workflow_completion', {
      subject: '✅ Workflow Completed - {workflow_name}',
      body: `
Dear Administrator,

The workflow "{workflow_name}" has completed successfully.

**Workflow Details:**
- Workflow: {workflow_name}
- Execution ID: {execution_id}
- Status: {status}
- Duration: {duration}
- Steps Completed: {steps_completed}/{total_steps}

**Results:**
{results}

**Summary:**
{summary}

This is an automated notification from the MCP Network Automation System.

Best regards,
Network Automation Team
      `.trim()
    });

    // System Health Alert Template
    this.templates.set('system_health_alert', {
      subject: '⚠️ System Health Alert - {component}',
      body: `
Dear System Administrator,

A system health alert has been triggered for component {component}.

**Alert Details:**
- Component: {component}
- Status: {status}
- Message: {message}
- Time: {timestamp}

**Impact:**
{impact}

**Recommended Actions:**
{recommended_actions}

This is an automated notification from the MCP Network Automation System.

Best regards,
System Automation Team
      `.trim()
    });
  }

  async initialize() {
    this.logger.info('Initializing Notification Service');
    
    // Load notification templates
    await this.loadTemplates();
    
    // Start notification monitoring
    this.startNotificationMonitoring();
  }

  async loadTemplates() {
    // This would typically load from a database or configuration file
    // For now, we're using the predefined templates
    this.logger.info(`Loaded ${this.templates.size} notification templates`);
  }

  async sendNotification(type, data, recipients) {
    const template = this.templates.get(type);
    if (!template) {
      throw new Error(`Notification template ${type} not found`);
    }

    const notificationId = `notif_${++this.notificationCounter}`;
    const notification = {
      id: notificationId,
      type,
      recipients,
      data,
      status: 'pending',
      createdAt: new Date(),
      sentAt: null,
      error: null
    };

    this.notifications.set(notificationId, notification);

    this.logger.info(`Sending notification: ${notificationId} - ${type}`);

    try {
      // Format the notification content
      const formattedContent = this.formatNotification(template, data);
      
      // Send via email MCP server
      await this.sendEmailNotification(recipients, formattedContent.subject, formattedContent.body);
      
      notification.status = 'sent';
      notification.sentAt = new Date();

      this.logger.info(`Notification sent successfully: ${notificationId}`);

    } catch (error) {
      notification.status = 'failed';
      notification.error = error.message;
      
      this.logger.error(`Failed to send notification: ${notificationId}`, error);
    }

    // Notify subscribers
    this.notifySubscribers({
      type: 'notification_sent',
      data: {
        notificationId,
        type,
        status: notification.status,
        recipients: recipients.length
      }
    });

    return notification;
  }

  formatNotification(template, data) {
    let subject = template.subject;
    let body = template.body;

    // Replace placeholders with actual data
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{${key}}`;
      subject = subject.replace(new RegExp(placeholder, 'g'), value);
      body = body.replace(new RegExp(placeholder, 'g'), value);
    }

    return { subject, body };
  }

  async sendEmailNotification(recipients, subject, body) {
    // This would typically use the email MCP server
    // For now, we'll simulate the email sending
    
    this.logger.info(`Simulating email send to ${recipients.length} recipients: ${subject}`);
    
    // Simulate email sending with some randomness
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // 95% success rate for simulation
        if (Math.random() > 0.05) {
          resolve({
            messageId: `msg_${Date.now()}`,
            recipients: recipients.length,
            status: 'sent'
          });
        } else {
          reject(new Error('Email service temporarily unavailable'));
        }
      }, Math.random() * 1000 + 500); // 500-1500ms delay
    });
  }

  async sendNetworkIssueAlert(deviceName, issueType, severity, description, actionsTaken = [], nextSteps = []) {
    const data = {
      device_name: deviceName,
      issue_type: issueType,
      severity: severity,
      description: description,
      timestamp: new Date().toLocaleString(),
      actions_taken: actionsTaken.length > 0 ? actionsTaken.join('\n- ') : 'No automated actions taken',
      next_steps: nextSteps.length > 0 ? nextSteps.join('\n- ') : 'Please investigate manually'
    };

    const recipients = this.getNetworkAdmins();
    
    return this.sendNotification('network_issue_alert', data, recipients);
  }

  async sendWorkflowCompletionAlert(workflowName, executionId, status, duration, stepsCompleted, totalSteps, results, summary) {
    const data = {
      workflow_name: workflowName,
      execution_id: executionId,
      status: status,
      duration: duration,
      steps_completed: stepsCompleted,
      total_steps: totalSteps,
      results: results,
      summary: summary
    };

    const recipients = this.getWorkflowAdmins();
    
    return this.sendNotification('workflow_completion', data, recipients);
  }

  async sendSystemHealthAlert(component, status, message, impact, recommendedActions) {
    const data = {
      component: component,
      status: status,
      message: message,
      timestamp: new Date().toLocaleString(),
      impact: impact,
      recommended_actions: recommendedActions
    };

    const recipients = this.getSystemAdmins();
    
    return this.sendNotification('system_health_alert', data, recipients);
  }

  getNetworkAdmins() {
    // This would typically load from configuration or database
    return ['network-admin@company.com', 'noc@company.com'];
  }

  getWorkflowAdmins() {
    // This would typically load from configuration or database
    return ['automation-admin@company.com', 'devops@company.com'];
  }

  getSystemAdmins() {
    // This would typically load from configuration or database
    return ['system-admin@company.com', 'infrastructure@company.com'];
  }

  async getNotificationHistory(limit = 50) {
    const notifications = Array.from(this.notifications.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);

    return notifications;
  }

  async getNotification(notificationId) {
    return this.notifications.get(notificationId);
  }

  async getNotificationStats() {
    const notifications = Array.from(this.notifications.values());
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return {
      total: notifications.length,
      last24h: notifications.filter(n => n.createdAt >= last24h).length,
      last7d: notifications.filter(n => n.createdAt >= last7d).length,
      sent: notifications.filter(n => n.status === 'sent').length,
      failed: notifications.filter(n => n.status === 'failed').length,
      pending: notifications.filter(n => n.status === 'pending').length
    };
  }

  subscribe(websocket) {
    this.subscribers.add(websocket);
    this.logger.info('New subscriber added to notification service');
  }

  unsubscribe(websocket) {
    this.subscribers.delete(websocket);
    this.logger.info('Subscriber removed from notification service');
  }

  notifySubscribers(data) {
    this.subscribers.forEach(ws => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(JSON.stringify(data));
        } catch (error) {
          this.logger.error('Error sending to subscriber:', error);
          this.subscribers.delete(ws);
        }
      } else {
        this.subscribers.delete(ws);
      }
    });
  }

  startNotificationMonitoring() {
    // Clean up old notifications periodically
    setInterval(() => {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      let cleanedCount = 0;
      
      for (const [notificationId, notification] of this.notifications) {
        if (notification.createdAt < cutoff) {
          this.notifications.delete(notificationId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.info(`Cleaned up ${cleanedCount} old notifications`);
      }
    }, 24 * 60 * 60 * 1000); // Every 24 hours

    this.logger.info('Notification monitoring started');
  }

  async performMaintenance() {
    this.logger.info('Performing notification service maintenance');
    
    // Clean up old notifications
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
    let cleanedCount = 0;
    
    for (const [notificationId, notification] of this.notifications) {
      if (notification.createdAt < cutoff) {
        this.notifications.delete(notificationId);
        cleanedCount++;
      }
    }

    this.logger.info(`Cleaned up ${cleanedCount} old notifications`);
  }

  isHealthy() {
    return true; // Simple health check for now
  }
}

module.exports = NotificationService; 