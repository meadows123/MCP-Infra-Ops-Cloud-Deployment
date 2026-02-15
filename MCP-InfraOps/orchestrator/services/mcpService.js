const winston = require('winston');

class MCPService {
  constructor() {
    this.servers = new Map();
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'mcp-service' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    // Define available MCP servers (use env vars from Terraform or fallback to internal DNS)
    // Terraform provides external FQDNs via environment variables
    this.serverConfigs = {
      pyats: {
        name: 'pyATS MCP Server',
        url: process.env.PYATS_MCP_URL || 'http://localhost:3002',
        healthCheck: '/health',
        type: 'langgraph'    // Special type to skip tool discovery
      },
      meraki: {
        name: 'Meraki MCP Server',
        url: process.env.MERAKI_MCP_URL || 'http://meraki-mcp-server:5000',
        healthCheck: '/health'
      },
      junos: {
        name: 'Junos MCP Server',
        url: process.env.JUNOS_MCP_URL || 'http://junos-mcp-server:5000',
        healthCheck: '/health'
      },
      chatgpt: {
        name: 'ChatGPT MCP Server',
        url: process.env.CHATGPT_MCP_URL || 'https://chatgpt-mcp-server2.ambitiousbay-fb2b1932.uksouth.azurecontainerapps.io',
        healthCheck: '/health'
      },
      servicenow: {
        name: 'ServiceNow MCP Server',
        url: process.env.SERVICENOW_MCP_URL || 'http://servicenow-mcp-server:3000',
        healthCheck: '/health'
      },
      github: {
        name: 'GitHub MCP Server',
        url: process.env.GITHUB_MCP_URL || 'http://github-mcp-server:3000',
        healthCheck: '/health'
      },
      email: {
        name: 'Email MCP Server',
        url: process.env.EMAIL_MCP_URL || 'http://email-mcp-server:3000',
        healthCheck: '/health'
      },
      slack: {
        name: 'Slack MCP Server',
        url: process.env.SLACK_MCP_URL || 'http://slack-mcp-server:3000',
        healthCheck: '/health'
      },
      google_search: {
        name: 'Google Search MCP Server',
        url: process.env.GOOGLE_SEARCH_MCP_URL || 'http://google-search-mcp-server:3000',
        healthCheck: '/health'
      },
      sequential_thinking: {
        name: 'Sequential Thinking MCP Server',
        url: process.env.SEQUENTIAL_THINKING_MCP_URL || 'http://sequential-thinking-mcp-server:3000',
        healthCheck: '/health'
      },
      quickchart: {
        name: 'QuickChart MCP Server',
        url: process.env.QUICKCHART_MCP_URL || 'http://quickchart-mcp-server:3000',
        healthCheck: '/health'
      },
      google_maps: {
        name: 'Google Maps MCP Server',
        url: process.env.GOOGLE_MAPS_MCP_URL || 'http://google-maps-mcp-server:3000',
        healthCheck: '/health'
      },
      filesystem: {
        name: 'Filesystem MCP Server',
        url: process.env.FILESYSTEM_MCP_URL || 'http://filesystem-mcp-server:3000',
        healthCheck: '/health'
      },
      email: {
        name: 'Email MCP Server',
        url: process.env.EMAIL_MCP_URL || 'http://email-mcp-server:3000',
        healthCheck: '/health'
      },
      excalidraw: {
        name: 'Excalidraw MCP Server',
        url: process.env.EXCALIDRAW_MCP_URL || 'http://excalidraw-mcp-server:3000',
        healthCheck: '/health'
      },
      ansible: {
        name: 'Ansible MCP Server',
        url: process.env.ANSIBLE_MCP_URL || 'http://ansible-mcp-server:5000',
        healthCheck: '/health'
      }
    };
  }

  async initialize() {
    this.logger.info('Initializing MCP Service - Discovering Azure Container Apps');
    
    // Discover all configured servers (they're already running in Azure)
    for (const [serverId, config] of Object.entries(this.serverConfigs)) {
      try {
        await this.discoverServer(serverId);
      } catch (error) {
        this.logger.error(`Failed to discover ${serverId} server:`, error);
      }
    }
  }

  async discoverServer(serverId) {
    const config = this.serverConfigs[serverId];
    if (!config) {
      throw new Error(`Unknown server: ${serverId}`);
    }

    this.logger.info(`Discovering ${serverId} server at ${config.url}`);

    const serverInfo = {
      id: serverId,
      name: config.name,
      config,
      status: 'discovering',
      startTime: new Date(),
      lastHealthCheck: null
    };

    this.servers.set(serverId, serverInfo);

    // Check if server is healthy
    try {
      const health = await this.checkServerHealth(serverId);
      serverInfo.status = 'running';
      serverInfo.lastHealthCheck = new Date();
      serverInfo.health = health;
      this.logger.info(`Server ${serverId} discovered and healthy`);
    } catch (error) {
      serverInfo.status = 'unreachable';
      serverInfo.error = error.message;
      this.logger.warn(`Server ${serverId} is unreachable:`, error.message);
    }

    return { status: 'discovered', serverId };
  }

  async startServer(serverId) {
    // In Azure Container Apps, servers are always running
    // This method just re-discovers the server
    return await this.discoverServer(serverId);
  }

  async stopServer(serverId) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // In Azure Container Apps, we can't stop servers from the orchestrator
    // Mark it as unavailable in our registry
    server.status = 'unavailable';
    this.logger.info(`Server ${serverId} marked as unavailable`);
    
    return { status: 'unavailable', serverId, message: 'Azure Container Apps cannot be stopped from orchestrator' };
  }

  async checkServerHealth(serverId, retryCount = 0) {
    const maxRetries = 2;
    const server = this.servers.get(serverId);
    
    // If server not discovered yet, get config
    let config, url, healthCheck;
    if (!server) {
      config = this.serverConfigs[serverId];
      if (!config) {
        throw new Error(`Server ${serverId} not found`);
      }
      url = config.url;
      healthCheck = config.healthCheck;
    } else {
      url = server.config.url;
      healthCheck = server.config.healthCheck;
    }

    const healthUrl = `${url}${healthCheck}`;

    if (retryCount === 0) {
      this.logger.info(`Checking health: ${healthUrl}`);
    } else {
      this.logger.info(`Retrying health check (attempt ${retryCount + 1}/${maxRetries + 1}): ${healthUrl}`);
    }

    try {
      const response = await fetch(healthUrl, { 
        signal: AbortSignal.timeout(10000)  // 10 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`Health check failed with status ${response.status}`);
      }
      
      const health = await response.json();
      
      // Update server status if it exists
      if (server) {
        server.lastHealthCheck = new Date();
        server.health = health;
        server.status = 'running'; // Update status to running on successful health check
        server.error = null; // Clear any previous errors
      }
      
      this.logger.info(`Health check successful for ${serverId}`);
      return health;
    } catch (error) {
      // Retry logic for transient failures
      if (retryCount < maxRetries && (
        error.message.includes('timeout') || 
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('fetch failed')
      )) {
        this.logger.warn(`Health check failed for ${serverId}, retrying... (${error.message})`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1))); // Exponential backoff
        return this.checkServerHealth(serverId, retryCount + 1);
      }
      
      // Update server status if it exists
      if (server) {
        server.status = 'unreachable';
        server.error = error.message;
        server.lastHealthCheck = new Date();
      }
      
      this.logger.error(`Health check failed for ${serverId} after ${retryCount + 1} attempts: ${error.message}`);
      throw new Error(`Health check failed: ${error.message}`);
    }
  }

  async getServerTools(serverId) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    if (server.status !== 'running') {
      throw new Error(`Server ${serverId} is not running (status: ${server.status})`);
    }

    // Skip tool discovery for LangGraph servers (they don't expose /tools endpoint)
    if (server.config.type === 'langgraph') {
      this.logger.info(`Skipping tool discovery for LangGraph server ${serverId}`);
      return []; // Return empty array - tools are handled via LangGraph API
    }

    try {
      const { url } = server.config;
      const toolsUrl = `${url}/tools`;
      
      const response = await fetch(toolsUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`Failed to get tools with status ${response.status}`);
      }

      const result = await response.json();
      this.logger.info(`Retrieved ${result.tools?.length || 0} tools from ${serverId}`);
      
      return result.tools || [];
    } catch (error) {
      this.logger.error(`Failed to get tools from ${serverId}:`, error);
      throw new Error(`Failed to get tools: ${error.message}`);
    }
  }

  async executeTool(serverId, toolName, args) {
    let server = this.servers.get(serverId);
    if (!server) {
      // Try to discover the server if not found
      this.logger.info(`Server ${serverId} not found, attempting discovery...`);
      await this.discoverServer(serverId);
      server = this.servers.get(serverId);
      if (!server) {
        throw new Error(`Server ${serverId} not found after discovery attempt`);
      }
    }

    // If server is unreachable, try to re-discover it once before failing
    if (server.status !== 'running') {
      this.logger.warn(`Server ${serverId} status is ${server.status}, attempting re-discovery...`);
      try {
        await this.discoverServer(serverId);
        server = this.servers.get(serverId);
        
        // Check again after re-discovery
        if (server.status !== 'running') {
          throw new Error(`Server ${serverId} is not running (status: ${server.status}). Last error: ${server.error || 'Unknown error'}`);
        }
      } catch (error) {
        this.logger.error(`Failed to re-discover server ${serverId}:`, error);
        throw new Error(`Server ${serverId} is not running (status: ${server.status}). Re-discovery failed: ${error.message}`);
      }
    }

    this.logger.info(`Executing tool ${toolName} on server ${serverId} with args:`, args);

    // Call the pyATS server via direct HTTP API
    try {
      const { url } = server.config;
      
      // Direct HTTP API endpoint for executing tools
      const executeUrl = `${url}/execute`;
      
      this.logger.info(`🌐 [DEBUG] Orchestrator: Calling PyATS HTTP API at ${executeUrl}`);
      this.logger.info(`📤 [DEBUG] Orchestrator: Tool: ${toolName}, Args:`, args);
      
      // Use longer timeout for Ansible playbooks (e.g. config backup)
      const timeoutMs = (serverId === 'ansible' && toolName === 'run_playbook') ? 120000 : 30000;
      const response = await fetch(executeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool: toolName,
          arguments: args
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`❌ [DEBUG] Orchestrator: PyATS HTTP API error: ${errorText}`);
        throw new Error(`PyATS HTTP API failed with status ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      this.logger.info(`✅ [DEBUG] Orchestrator: Got result from PyATS HTTP API:`, result);
      
      this.logger.info(`✅ [DEBUG] Orchestrator: Tool ${toolName} executed successfully on ${serverId}`);
      
      return {
        serverId,
        tool: toolName,
        arguments: args,
        result: result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Tool execution failed for ${toolName} on ${serverId}:`, error);
      throw new Error(`Tool execution failed: ${error.message}`);
    }
  }

  async executeNaturalLanguageRequest(serverId, request) {
    let server = this.servers.get(serverId);
    if (!server) {
      // Try to discover the server if not found
      this.logger.info(`Server ${serverId} not found, attempting discovery...`);
      await this.discoverServer(serverId);
      server = this.servers.get(serverId);
      if (!server) {
        throw new Error(`Server ${serverId} not found after discovery attempt`);
      }
    }

    // If server is unreachable, try to re-discover it once before failing
    if (server.status !== 'running') {
      this.logger.warn(`Server ${serverId} status is ${server.status}, attempting re-discovery...`);
      try {
        await this.discoverServer(serverId);
        server = this.servers.get(serverId);
        
        // Check again after re-discovery
        if (server.status !== 'running') {
          throw new Error(`Server ${serverId} is not running (status: ${server.status}). Last error: ${server.error || 'Unknown error'}`);
        }
      } catch (error) {
        this.logger.error(`Failed to re-discover server ${serverId}:`, error);
        throw new Error(`Server ${serverId} is not running (status: ${server.status}). Re-discovery failed: ${error.message}`);
      }
    }

    this.logger.info(`🌐 [DEBUG] Orchestrator: Processing natural language request for ${serverId}: ${request}`);

    // For pyATS server, call LangGraph API with the natural language request
    try {
      const { url } = server.config;
      
      // Step 1: Create a thread
      const threadsUrl = `${url}/threads`;
      this.logger.info(`🧵 [DEBUG] Orchestrator: Creating thread at ${threadsUrl}`);
      
      const threadResponse = await fetch(threadsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          metadata: { source: 'mcp-orchestrator' }
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!threadResponse.ok) {
        const errorText = await threadResponse.text();
        this.logger.error(`❌ [DEBUG] Orchestrator: Failed to create thread: ${errorText}`);
        throw new Error(`Failed to create thread: ${errorText}`);
      }

      const thread = await threadResponse.json();
      const threadId = thread.thread_id;
      this.logger.info(`✅ [DEBUG] Orchestrator: Created thread ${threadId}`);
      
      // Step 2: Create a run with the user's request
      const runsUrl = `${url}/threads/${threadId}/runs`;
      this.logger.info(`🚀 [DEBUG] Orchestrator: Creating run at ${runsUrl}`);
      this.logger.info(`📝 [DEBUG] Orchestrator: Request: ${request}`);
      
      const runResponse = await fetch(runsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assistant_id: "MCpyATS",
          input: {
            messages: [{
              role: "user",
              content: request
            }]
          }
        }),
        signal: AbortSignal.timeout(60000)
      });

      if (!runResponse.ok) {
        const errorText = await runResponse.text();
        this.logger.error(`❌ [DEBUG] Orchestrator: LangGraph run error: ${errorText}`);
        throw new Error(`LangGraph run failed: ${errorText}`);
      }

      const run = await runResponse.json();
      this.logger.info(`✅ [DEBUG] Orchestrator: Run created, waiting for completion...`);
      
      // Step 3: Wait for the run to complete
      const runId = run.run_id;
      let runStatus = run.status;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds max wait
      
      while (runStatus !== 'success' && runStatus !== 'error' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const statusResponse = await fetch(`${url}/threads/${threadId}/runs/${runId}`, {
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          runStatus = statusData.status;
          this.logger.info(`📊 [DEBUG] Orchestrator: Run status: ${runStatus}`);
        }
        
        attempts++;
      }
      
      // Step 4: Get the thread state to retrieve messages
      const stateResponse = await fetch(`${url}/threads/${threadId}/state`, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!stateResponse.ok) {
        throw new Error('Failed to get thread state');
      }
      
      const state = await stateResponse.json();
      let output = "Command executed";
      let toolResults = [];
      
      if (state.values && state.values.messages) {
        const messages = state.values.messages;
        
        // Collect all tool results
        for (const msg of messages) {
          if (msg.type === 'tool' && msg.content) {
            toolResults.push(msg.content);
          }
        }
        
        // Get the last AI message
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].type === 'ai' && messages[i].content) {
            output = messages[i].content;
            break;
          }
        }
        
        // If we have tool results but no AI summary, include the tool results
        if (toolResults.length > 0 && output === "Command executed") {
          output = "Tool Results:\n" + toolResults.join("\n\n");
        }
      }
      
      this.logger.info(`✅ [DEBUG] Orchestrator: Got result: ${output.substring(0, 200)}...`);
      
      return {
        serverId,
        request: request,
        result: { output: output },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`💥 [DEBUG] Orchestrator: Natural language request failed for ${serverId}:`, error);
      throw new Error(`Natural language request failed: ${error.message}`);
    }
  }

  async getServers() {
    const serverList = [];
    
    // Check health for all servers, but don't fail if some are unreachable
    const healthCheckPromises = Array.from(this.servers.entries()).map(async ([serverId, server]) => {
      try {
        // Only check health if server was last checked more than 30 seconds ago
        // or if it's currently unreachable (to allow recovery)
        const shouldCheck = !server.lastHealthCheck || 
                           (Date.now() - server.lastHealthCheck.getTime() > 30000) ||
                           server.status === 'unreachable';
        
        if (shouldCheck) {
          await this.checkServerHealth(serverId);
        }
        
        return {
          id: serverId,
          name: server.name,
          status: server.status,
          health: server.health || { status: 'unknown' },
          startTime: server.startTime,
          uptime: server.startTime ? Date.now() - server.startTime.getTime() : 0,
          lastHealthCheck: server.lastHealthCheck,
          error: server.error
        };
      } catch (error) {
        // Don't throw - include server with error status
        return {
          id: serverId,
          name: server.name,
          status: server.status || 'unreachable',
          health: { error: error.message },
          startTime: server.startTime,
          uptime: server.startTime ? Date.now() - server.startTime.getTime() : 0,
          lastHealthCheck: server.lastHealthCheck,
          error: error.message
        };
      }
    });

    const results = await Promise.allSettled(healthCheckPromises);
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        serverList.push(result.value);
      } else {
        this.logger.error('Error checking server health:', result.reason);
      }
    }

    return serverList;
  }

  isHealthy() {
    return Array.from(this.servers.values()).some(server => server.status === 'running');
  }

  async cleanup() {
    this.logger.info('Cleaning up MCP Service');
    
    // In Azure Container Apps, servers continue running
    // Just clear our local registry
    this.servers.clear();
    this.logger.info('MCP Service registry cleared');
  }
}

module.exports = MCPService; 