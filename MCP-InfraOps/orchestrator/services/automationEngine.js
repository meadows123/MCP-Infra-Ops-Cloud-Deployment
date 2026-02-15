const winston = require('winston');

class AutomationEngine {
  constructor(options = {}) {
    this.mcpService = options.mcpService || null;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'automation-engine' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    this.workflows = new Map();
    this.executions = new Map();
    this.subscribers = new Set();
    this.executionCounter = 0;

    // Define available workflows
    this.defineWorkflows();
  }

  defineWorkflows() {
    // Network Issue Detection and Resolution Workflow
    this.workflows.set('network_issue_resolution', {
      id: 'network_issue_resolution',
      name: 'Network Issue Detection and Resolution',
      description: 'Automatically detect network issues and create ServiceNow tickets',
      steps: [
        {
          id: 'check_network_health',
          name: 'Check Network Health',
          service: 'pyats',
          tool: 'run_show_command',
          parameters: { device_name: 'all', command: 'show ip interface brief' }
        },
        {
          id: 'analyze_issues',
          name: 'Analyze Issues',
          service: 'internal',
          action: 'analyze_network_issues'
        },
        {
          id: 'create_ticket',
          name: 'Create ServiceNow Ticket',
          service: 'servicenow',
          tool: 'create_servicenow_problem',
          parameters: { problem_data: {} },
          condition: 'issues_found'
        },
        {
          id: 'apply_fixes',
          name: 'Apply Automated Fixes',
          service: 'pyats',
          tool: 'apply_device_configuration',
          parameters: { device_name: 'affected_devices', config_commands: '' },
          condition: 'auto_fix_available'
        }
      ]
    });

    // Configuration Backup Workflow
    this.workflows.set('config_backup', {
      id: 'config_backup',
      name: 'Configuration Backup',
      description: 'Backup device configurations to GitHub repository',
      steps: [
        {
          id: 'get_configs',
          name: 'Get Device Configurations',
          service: 'pyats',
          tool: 'execute_learn_config',
          parameters: { device_name: 'all' }
        },
        {
          id: 'format_configs',
          name: 'Format Configurations',
          service: 'internal',
          action: 'format_configurations'
        },
        {
          id: 'commit_to_github',
          name: 'Commit to GitHub',
          service: 'github',
          tool: 'push_files',
          parameters: { repository: 'network-configs', files: [] }
        }
      ]
    });

    // Network Documentation Update Workflow
    this.workflows.set('update_documentation', {
      id: 'update_documentation',
      name: 'Update Network Documentation',
      description: 'Update network documentation based on current state',
      steps: [
        {
          id: 'gather_topology',
          name: 'Gather Network Topology',
          service: 'pyats',
          tool: 'run_show_command',
          parameters: { device_name: 'all', command: 'show cdp neighbors' }
        },
        {
          id: 'generate_docs',
          name: 'Generate Documentation',
          service: 'internal',
          action: 'generate_documentation'
        },
        {
          id: 'update_repository',
          name: 'Update Documentation Repository',
          service: 'github',
          tool: 'create_or_update_file',
          parameters: { repository: 'network-docs', path: 'topology.md', content: '' }
        }
      ]
    });
  }

  async initialize() {
    this.logger.info('Initializing Automation Engine');
    
    // Load workflow definitions
    await this.loadWorkflowDefinitions();
    
    // Start workflow monitoring
    this.startWorkflowMonitoring();
  }

  async loadWorkflowDefinitions() {
    // This would typically load from a database or configuration file
    // For now, we're using the predefined workflows
    this.logger.info(`Loaded ${this.workflows.size} workflow definitions`);
  }

  async getAvailableWorkflows() {
    return Array.from(this.workflows.values()).map(workflow => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      steps: workflow.steps.length
    }));
  }

  async executeWorkflow(workflowId, parameters = {}) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const executionId = `exec_${++this.executionCounter}`;
    const execution = {
      id: executionId,
      workflowId,
      status: 'running',
      startTime: new Date(),
      steps: [],
      parameters,
      result: null
    };

    this.executions.set(executionId, execution);

    this.logger.info(`Starting workflow execution: ${executionId} - ${workflow.name}`);

    try {
      // Run real config_backup via Ansible + filesystem MCP when mcpService is available
      if (workflowId === 'config_backup' && this.mcpService) {
        const backupResult = await this.runConfigBackupWorkflow(parameters, execution);
        execution.status = backupResult.success ? 'completed' : 'failed';
        execution.endTime = new Date();
        execution.result = backupResult;
        if (backupResult.steps) execution.steps = backupResult.steps;
        this.logger.info(`Config backup workflow ${backupResult.success ? 'completed' : 'failed'}: ${executionId}`);
        this.notifySubscribers({
          type: 'workflow_completed',
          data: { executionId, workflowId, status: execution.status, result: execution.result }
        });
        return execution;
      }

      // Execute workflow steps
      for (const step of workflow.steps) {
        const stepResult = await this.executeStep(step, parameters, execution);
        execution.steps.push({
          id: step.id,
          name: step.name,
          status: stepResult.success ? 'completed' : 'failed',
          result: stepResult,
          timestamp: new Date().toISOString()
        });

        // Check if we should continue based on conditions
        if (step.condition && !this.evaluateCondition(step.condition, stepResult, parameters)) {
          this.logger.info(`Workflow ${executionId} stopped due to condition: ${step.condition}`);
          break;
        }
      }

      execution.status = 'completed';
      execution.endTime = new Date();
      execution.result = {
        success: true,
        message: 'Workflow completed successfully'
      };

      this.logger.info(`Workflow execution completed: ${executionId}`);

    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date();
      execution.result = {
        success: false,
        error: error.message
      };

      this.logger.error(`Workflow execution failed: ${executionId}`, error);
    }

    // Notify subscribers
    this.notifySubscribers({
      type: 'workflow_completed',
      data: {
        executionId,
        workflowId,
        status: execution.status,
        result: execution.result
      }
    });

    return execution;
  }

  async executeStep(step, parameters, execution) {
    this.logger.info(`Executing step: ${step.name} (${step.id})`);

    try {
      let result;

      if (step.service === 'internal') {
        result = await this.executeInternalAction(step.action, parameters);
      } else {
        // This would typically call the appropriate MCP server
        result = await this.executeMCPServiceCall(step.service, step.tool, step.parameters);
      }

      return {
        success: true,
        result,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error(`Step execution failed: ${step.name}`, error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async executeInternalAction(action, parameters) {
    switch (action) {
      case 'analyze_network_issues':
        return this.analyzeNetworkIssues(parameters);
      
      case 'format_configurations':
        return this.formatConfigurations(parameters);
      
      case 'generate_documentation':
        return this.generateDocumentation(parameters);
      
      default:
        throw new Error(`Unknown internal action: ${action}`);
    }
  }

  async executeMCPServiceCall(service, tool, parameters) {
    // This would typically make a call to the appropriate MCP server
    // For now, we'll simulate the service call
    
    this.logger.info(`Simulating MCP service call: ${service}.${tool}`);
    
    // Simulate different service responses
    const responses = {
      pyats: {
        run_show_command: { output: 'Interface status: up', parsed: true },
        execute_learn_config: { config: 'hostname router-01\ninterface GigabitEthernet0/0\n ip address 192.168.1.1 255.255.255.0' },
        apply_device_configuration: { status: 'success', message: 'Configuration applied' }
      },
      servicenow: {
        create_servicenow_problem: { sys_id: 'abc123', number: 'INC0010001' }
      },
      github: {
        push_files: { commit_sha: 'abc123def456', files_updated: 3 },
        create_or_update_file: { content: { sha: 'abc123' } }
      }
    };

    return new Promise((resolve) => {
      setTimeout(() => {
        const response = responses[service]?.[tool] || { status: 'success', message: 'Operation completed' };
        resolve(response);
      }, Math.random() * 2000 + 500); // 500-2500ms delay
    });
  }

  /**
   * Run the real config backup workflow: Ansible backup-config on all inventory hosts,
   * then store backups on fileserver and copy into repo (network-config-backups).
   * Requires shared volume: Ansible and Filesystem MCP must have access to BACKUP_BASE_PATH
   * and REPO_BACKUP_PATH (e.g. /projects).
   */
  async runConfigBackupWorkflow(parameters, execution) {
    const steps = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupBasePath = process.env.BACKUP_BASE_PATH || '/projects/backups';
    const backupFullPath = `${backupBasePath}/${timestamp}`;
    const repoBackupBase = process.env.REPO_BACKUP_PATH || '/projects/MCP-Infrastructure/network-config-backups';
    const repoBackupDir = `${repoBackupBase}/${timestamp}`;

    try {
      // Step 1: Run Ansible backup-config playbook (all devices from hosts.yml)
      this.logger.info(`Config backup: running Ansible backup-config.yml, backup_path=${backupFullPath}`);
      const ansibleResult = await this.mcpService.executeTool('ansible', 'run_playbook', {
        playbook_name: 'backup-config.yml',
        inventory: 'hosts.yml',
        extra_vars: { backup_path: backupFullPath }
      });
      steps.push({
        id: 'ansible_backup',
        name: 'Run Ansible backup-config',
        status: ansibleResult.result?.status === 'completed' ? 'completed' : 'failed',
        result: ansibleResult
      });

      const playbookOk = ansibleResult.result?.status === 'completed';
      if (!playbookOk) {
        const err = ansibleResult.result?.error || ansibleResult.result?.stderr || 'Playbook failed';
        this.logger.error(`Config backup: Ansible playbook failed: ${err}`);
        return {
          success: false,
          error: err,
          steps
        };
      }

      // Step 2: List backup directory via filesystem MCP
      const listResult = await this.mcpService.executeTool('filesystem', 'list_directory', {
        path: backupFullPath
      });
      steps.push({
        id: 'list_backups',
        name: 'List backup files',
        status: listResult.result?.status === 'success' ? 'completed' : 'failed',
        result: listResult
      });

      if (listResult.result?.status !== 'success' || !listResult.result?.output) {
        return {
          success: false,
          error: listResult.result?.error || 'Failed to list backup directory',
          steps
        };
      }

      // Parse "[FILE] filename" lines
      const fileNames = (listResult.result.output || '')
        .split('\n')
        .map(line => line.replace(/^\[FILE\]\s*/, '').trim())
        .filter(name => name && (name.endsWith('.cfg') || name.endsWith('.txt')));

      if (fileNames.length === 0) {
        this.logger.warn('Config backup: no backup files found in directory');
        return {
          success: true,
          message: 'Backup completed but no config files were written',
          backupPath: backupFullPath,
          repoBackupDir,
          files: [],
          steps
        };
      }

      // Step 3: Create repo backup directory
      await this.mcpService.executeTool('filesystem', 'create_directory', {
        path: repoBackupDir
      });
      steps.push({
        id: 'create_repo_dir',
        name: 'Create repo backup directory',
        status: 'completed',
        result: { path: repoBackupDir }
      });

      // Step 4: Copy each backup file to repo via filesystem MCP
      const copied = [];
      for (const name of fileNames) {
        const srcPath = `${backupFullPath}/${name}`;
        const destPath = `${repoBackupDir}/${name}`;
        const readRes = await this.mcpService.executeTool('filesystem', 'read_file', { path: srcPath });
        if (readRes.result?.status !== 'success') continue;
        await this.mcpService.executeTool('filesystem', 'write_file', {
          path: destPath,
          content: readRes.result.output
        });
        copied.push(name);
      }
      steps.push({
        id: 'copy_to_repo',
        name: 'Copy backups to repo',
        status: 'completed',
        result: { files: copied }
      });

      this.logger.info(`Config backup: saved ${copied.length} files to fileserver and repo ${repoBackupDir}`);
      return {
        success: true,
        message: `Backed up ${copied.length} device config(s) to fileserver and repo`,
        backupPath: backupFullPath,
        repoBackupDir,
        files: copied,
        steps
      };
    } catch (error) {
      this.logger.error('Config backup workflow error:', error);
      steps.push({
        id: 'error',
        name: 'Error',
        status: 'failed',
        result: { error: error.message }
      });
      return {
        success: false,
        error: error.message,
        steps
      };
    }
  }

  evaluateCondition(condition, stepResult, parameters) {
    switch (condition) {
      case 'issues_found':
        return stepResult.result && stepResult.result.issues && stepResult.result.issues.length > 0;
      
      case 'auto_fix_available':
        return stepResult.result && stepResult.result.auto_fix_available;
      
      default:
        return true;
    }
  }

  async analyzeNetworkIssues(parameters) {
    // Simulate network issue analysis
    return {
      issues: [
        {
          device: 'router-01',
          type: 'interface_down',
          severity: 'high',
          description: 'Interface GigabitEthernet0/1 is down'
        }
      ],
      auto_fix_available: true,
      recommendations: [
        'Check physical connection',
        'Verify interface configuration'
      ]
    };
  }

  async formatConfigurations(parameters) {
    // Simulate configuration formatting
    return {
      formatted_configs: [
        {
          device: 'router-01',
          config: '# Router 01 Configuration\nhostname router-01\ninterface GigabitEthernet0/0\n ip address 192.168.1.1 255.255.255.0'
        }
      ]
    };
  }

  async generateDocumentation(parameters) {
    // Simulate documentation generation
    return {
      topology: {
        devices: ['router-01', 'switch-01', 'firewall-01'],
        connections: [
          { from: 'router-01', to: 'switch-01', interface: 'GigabitEthernet0/0' }
        ]
      },
      documentation: '# Network Topology\n\n## Devices\n- Router 01\n- Switch 01\n- Firewall 01'
    };
  }

  async getExecutionHistory(limit = 10) {
    const executions = Array.from(this.executions.values())
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);

    return executions;
  }

  async getExecution(executionId) {
    return this.executions.get(executionId);
  }

  subscribe(websocket) {
    this.subscribers.add(websocket);
    this.logger.info('New subscriber added to automation engine');
  }

  unsubscribe(websocket) {
    this.subscribers.delete(websocket);
    this.logger.info('Subscriber removed from automation engine');
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

  startWorkflowMonitoring() {
    // Clean up old executions periodically
    setInterval(() => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      for (const [executionId, execution] of this.executions) {
        if (execution.endTime && execution.endTime < cutoff) {
          this.executions.delete(executionId);
        }
      }
    }, 60 * 60 * 1000); // Every hour

    this.logger.info('Workflow monitoring started');
  }

  async performMaintenance() {
    this.logger.info('Performing automation engine maintenance');
    
    // Clean up old executions
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    let cleanedCount = 0;
    
    for (const [executionId, execution] of this.executions) {
      if (execution.endTime && execution.endTime < cutoff) {
        this.executions.delete(executionId);
        cleanedCount++;
      }
    }

    this.logger.info(`Cleaned up ${cleanedCount} old executions`);
  }

  isHealthy() {
    return true; // Simple health check for now
  }
}

module.exports = AutomationEngine; 