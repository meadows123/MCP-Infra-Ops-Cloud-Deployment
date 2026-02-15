#!/usr/bin/env node

/**
 * MCP server for Google search using Playwright headless browser
 * Provides functionality to search on Google with multiple keywords
 * 
 * Supports two modes:
 * - stdio: Standard MCP protocol via stdin/stdout (default)
 * - http: HTTP REST API mode (set MCP_MODE=http)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

// Parse command line arguments, check for debug flag
export const isDebugMode = process.argv.includes("--debug");

// Check if HTTP mode is enabled
const isHttpMode = process.env.MCP_MODE === 'http';

/**
 * Start the server
 */
async function main() {
  logger.info("[Setup] Initializing Google Search MCP server...");

  if (isDebugMode) {
    logger.debug("[Setup] Debug mode enabled, Chrome browser window will be visible");
  }

  if (isHttpMode) {
    logger.info("[Setup] Starting in HTTP mode");
    // Import and start HTTP server
    await import("./http-server.js");
  } else {
    logger.info("[Setup] Starting in stdio mode");
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("[Setup] Server started");
  }
}

main().catch((error) => {
  logger.error(`[Error] Server error: ${error}`);
  process.exit(1);
});
