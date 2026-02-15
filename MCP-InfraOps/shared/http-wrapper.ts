/**
 * Generic HTTP wrapper for MCP SDK servers
 * Exposes MCP functionality via HTTP REST API
 */
import express from 'express';
import cors from 'cors';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export interface HttpWrapperConfig {
  serverName: string;
  serverVersion: string;
  port?: number;
  createMcpServer: () => Server;
}

export function createHttpWrapper(config: HttpWrapperConfig) {
  const app = express();
  const port = config.port || parseInt(process.env.PORT || '3000');
  
  app.use(cors());
  app.use(express.json());

  // Create the MCP server instance
  const mcpServer = config.createMcpServer();

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      service: config.serverName,
      version: config.serverVersion,
      mode: 'http'
    });
  });

  // List available tools
  app.get('/tools', async (req, res) => {
    try {
      const result = await mcpServer.request(
        { method: 'tools/list' },
        ListToolsRequestSchema
      );
      res.json(result);
    } catch (error: any) {
      console.error('Error listing tools:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Execute a tool
  app.post('/execute', async (req, res) => {
    try {
      const { tool, arguments: args } = req.body;
      
      if (!tool) {
        return res.status(400).json({ error: 'Missing tool parameter' });
      }

      const result = await mcpServer.request(
        {
          method: 'tools/call',
          params: {
            name: tool,
            arguments: args || {}
          }
        },
        CallToolRequestSchema
      );

      res.json(result);
    } catch (error: any) {
      console.error('Error executing tool:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // MCP JSON-RPC endpoint (for full MCP protocol compatibility)
  app.post('/mcp', async (req, res) => {
    try {
      const request = req.body;
      
      if (!request.method) {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid Request' },
          id: request.id || null
        });
      }

      // Route to appropriate handler based on method
      let result;
      if (request.method === 'tools/list') {
        result = await mcpServer.request(request, ListToolsRequestSchema);
      } else if (request.method === 'tools/call') {
        result = await mcpServer.request(request, CallToolRequestSchema);
      } else {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32601, message: 'Method not found' },
          id: request.id || null
        });
      }

      res.json({
        jsonrpc: '2.0',
        result,
        id: request.id || null
      });
    } catch (error: any) {
      console.error('Error processing MCP request:', error);
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: error.message },
        id: req.body.id || null
      });
    }
  });

  // Start the server
  app.listen(port, () => {
    console.log(`🚀 ${config.serverName} HTTP Server running on port ${port}`);
    console.log(`📝 Health check: http://localhost:${port}/health`);
    console.log(`🔧 Tools: http://localhost:${port}/tools`);
    console.log(`⚡ Execute: POST http://localhost:${port}/execute`);
  });

  return app;
}

