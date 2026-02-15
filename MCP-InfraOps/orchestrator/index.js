const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const WebSocket = require('ws');
const cron = require('node-cron');
const winston = require('winston');
const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config();

// Import service modules
const MCPService = require('./services/mcpService');
const NetworkMonitor = require('./services/networkMonitor');
const AutomationEngine = require('./services/automationEngine');
const NotificationService = require('./services/notificationService');

// Configure logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'mcp-orchestrator' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize services
const mcpService = new MCPService();
const networkMonitor = new NetworkMonitor();
const automationEngine = new AutomationEngine({ mcpService });
const notificationService = new NotificationService();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      mcp: mcpService.isHealthy(),
      network: networkMonitor.isHealthy(),
      automation: automationEngine.isHealthy(),
      notifications: notificationService.isHealthy()
    }
  });
});

// MCP Server management endpoints
app.get('/api/mcp/servers', async (req, res) => {
  try {
    const servers = await mcpService.getServers();
    res.json(servers);
  } catch (error) {
    logger.error('Error getting MCP servers:', error);
    res.status(500).json({ error: 'Failed to get MCP servers' });
  }
});

app.post('/api/mcp/servers/:serverId/start', async (req, res) => {
  try {
    const { serverId } = req.params;
    const result = await mcpService.startServer(serverId);
    res.json(result);
  } catch (error) {
    logger.error(`Error starting MCP server ${req.params.serverId}:`, error);
    res.status(500).json({ error: 'Failed to start MCP server' });
  }
});

app.post('/api/mcp/servers/:serverId/stop', async (req, res) => {
  try {
    const { serverId } = req.params;
    const result = await mcpService.stopServer(serverId);
    res.json(result);
  } catch (error) {
    logger.error(`Error stopping MCP server ${req.params.serverId}:`, error);
    res.status(500).json({ error: 'Failed to stop MCP server' });
  }
});

// Network monitoring endpoints
app.get('/api/network/status', async (req, res) => {
  try {
    const status = await networkMonitor.getNetworkStatus();
    res.json(status);
  } catch (error) {
    logger.error('Error getting network status:', error);
    res.status(500).json({ error: 'Failed to get network status' });
  }
});

app.get('/api/network/devices', async (req, res) => {
  try {
    const devices = await networkMonitor.getDevices();
    res.json(devices);
  } catch (error) {
    logger.error('Error getting network devices:', error);
    res.status(500).json({ error: 'Failed to get network devices' });
  }
});

// Automation endpoints
app.post('/api/automation/workflow', async (req, res) => {
  try {
    const { workflow, parameters } = req.body;
    const result = await automationEngine.executeWorkflow(workflow, parameters);
    res.json(result);
  } catch (error) {
    logger.error('Error executing automation workflow:', error);
    res.status(500).json({ error: 'Failed to execute automation workflow' });
  }
});

app.get('/api/automation/workflows', async (req, res) => {
  try {
    const workflows = await automationEngine.getAvailableWorkflows();
    res.json(workflows);
  } catch (error) {
    logger.error('Error getting automation workflows:', error);
    res.status(500).json({ error: 'Failed to get automation workflows' });
  }
});

// Unified MCP tool execution endpoint
app.post('/api/mcp/execute', async (req, res) => {
  try {
    const { server, tool, arguments: args } = req.body;
    const result = await mcpService.executeTool(server, tool, args);
    res.json(result);
  } catch (error) {
    logger.error('Error executing MCP tool:', error);
    res.status(500).json({ error: 'Failed to execute MCP tool' });
  }
});

// Natural language execution endpoint for pyATS/LangGraph
app.post('/api/mcp/execute-natural', async (req, res) => {
  try {
    const { server, request } = req.body;
    logger.info(`🌐 [DEBUG] Orchestrator: Received natural language request for ${server}: ${request}`);
    
    // Forward the natural language request to LangGraph
    const result = await mcpService.executeNaturalLanguageRequest(server, request);
    res.json(result);
  } catch (error) {
    logger.error('Error executing natural language request:', error);
    res.status(500).json({ error: 'Failed to execute natural language request', details: error.message });
  }
});

// Get tools from MCP server
app.get('/api/mcp/servers/:serverId/tools', async (req, res) => {
  try {
    const { serverId } = req.params;
    const tools = await mcpService.getServerTools(serverId);
    res.json(tools);
  } catch (error) {
    logger.error('Error getting MCP server tools:', error);
    res.status(500).json({ error: 'Failed to get MCP server tools' });
  }
});

// WebSocket for real-time updates
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  logger.info('WebSocket client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(ws, data);
    } catch (error) {
      logger.error('Error handling WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket client disconnected');
  });
});

function handleWebSocketMessage(ws, data) {
  switch (data.type) {
    case 'subscribe_network_updates':
      networkMonitor.subscribe(ws);
      break;
    case 'subscribe_automation_updates':
      automationEngine.subscribe(ws);
      break;
    default:
      logger.warn('Unknown WebSocket message type:', data.type);
  }
}

// Scheduled tasks
cron.schedule('*/5 * * * *', async () => {
  try {
    logger.info('Running scheduled network health check');
    await networkMonitor.performHealthCheck();
  } catch (error) {
    logger.error('Error in scheduled network health check:', error);
  }
});

cron.schedule('0 */6 * * *', async () => {
  try {
    logger.info('Running scheduled automation maintenance');
    await automationEngine.performMaintenance();
  } catch (error) {
    logger.error('Error in scheduled automation maintenance:', error);
  }
});

// Periodic MCP server health check and recovery (every 2 minutes)
cron.schedule('*/2 * * * *', async () => {
  try {
    logger.info('Running scheduled MCP server health check');
    // Re-check health for any unreachable servers
    const servers = await mcpService.getServers();
    const unreachableServers = servers.filter(s => s.status === 'unreachable');
    if (unreachableServers.length > 0) {
      logger.info(`Attempting to recover ${unreachableServers.length} unreachable server(s)`);
      for (const server of unreachableServers) {
        try {
          await mcpService.discoverServer(server.id);
          logger.info(`Successfully recovered server: ${server.id}`);
        } catch (error) {
          logger.warn(`Failed to recover server ${server.id}:`, error.message);
        }
      }
    }
  } catch (error) {
    logger.error('Error in scheduled MCP server health check:', error);
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(PORT, () => {
  logger.info(`MCP Orchestrator server running on port ${PORT}`);
  
  // Initialize services
  mcpService.initialize();
  networkMonitor.initialize();
  automationEngine.initialize();
  notificationService.initialize();
});

// Attach WebSocket server
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

module.exports = app; 