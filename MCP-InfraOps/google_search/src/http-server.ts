/**
 * HTTP REST API wrapper for Google Search MCP Server
 * Exposes Google Search functionality via HTTP endpoints
 */
import express from 'express';
import cors from 'cors';
import { tools, toolHandlers } from './tools/index.js';
import { logger } from "./utils/logger.js";

const app = express();
const port = parseInt(process.env.PORT || '3000');

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Google Search MCP Server',
    version: '0.1.0',
    mode: 'http'
  });
});

// List available tools
app.get('/tools', (req, res) => {
  logger.info("[HTTP] List available tools");
  res.json({ tools });
});

// Execute a tool
app.post('/execute', async (req, res) => {
  try {
    const { tool, arguments: args } = req.body;
    
    if (!tool) {
      return res.status(400).json({ error: 'Missing tool parameter' });
    }

    logger.info(`[HTTP] Executing tool: ${tool}`);
    
    const handler = toolHandlers[tool];
    if (!handler) {
      return res.status(400).json({ 
        error: `Unknown tool: ${tool}`,
        available_tools: Object.keys(toolHandlers)
      });
    }

    const result = await handler(args || {});
    res.json(result);
    
  } catch (error: any) {
    logger.error(`[HTTP] Error executing tool: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// MCP JSON-RPC endpoint (for compatibility)
app.post('/mcp', async (req, res) => {
  try {
    const request = req.body;
    
    if (request.method === 'tools/list') {
      logger.info("[MCP] List tools request");
      return res.json({
        jsonrpc: '2.0',
        result: { tools },
        id: request.id || null
      });
    }
    
    if (request.method === 'tools/call') {
      const toolName = request.params?.name;
      const args = request.params?.arguments || {};
      
      logger.info(`[MCP] Call tool: ${toolName}`);
      
      const handler = toolHandlers[toolName];
      if (!handler) {
        return res.json({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
          id: request.id || null
        });
      }

      const result = await handler(args);
      return res.json({
        jsonrpc: '2.0',
        result,
        id: request.id || null
      });
    }

    res.json({
      jsonrpc: '2.0',
      error: { code: -32601, message: 'Method not found' },
      id: request.id || null
    });
    
  } catch (error: any) {
    logger.error(`[MCP] Error: ${error.message}`);
    res.json({
      jsonrpc: '2.0',
      error: { code: -32603, message: error.message },
      id: req.body.id || null
    });
  }
});

// Start the server
app.listen(port, () => {
  logger.info(`🚀 Google Search MCP HTTP Server running on port ${port}`);
  logger.info(`📝 Health check: http://localhost:${port}/health`);
  logger.info(`🔧 Tools: http://localhost:${port}/tools`);
  logger.info(`⚡ Execute: POST http://localhost:${port}/execute`);
});

