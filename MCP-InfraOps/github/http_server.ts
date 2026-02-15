#!/usr/bin/env node
/**
 * HTTP REST API wrapper for GitHub MCP Server
 * Exposes GitHub MCP functionality via HTTP endpoints for the orchestrator
 */

import express from 'express';
import cors from 'cors';
import https from 'https';

const app = express();
app.use(cors());
// Increase body size limit to handle large config files (default is 100kb)
app.use(express.json({ limit: '10mb' }));

// Get GitHub token from environment
let GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = 'https://api.github.com';

console.log('GitHub MCP Server starting...');
console.log(`GITHUB_TOKEN environment variable set: ${!!GITHUB_TOKEN}`);
console.log(`GITHUB_TOKEN value preview: ${GITHUB_TOKEN?.substring(0, 20)}...`);
console.log(`GITHUB_TOKEN length: ${GITHUB_TOKEN?.length || 0}`);

// Handle Key Vault reference format
if (GITHUB_TOKEN && GITHUB_TOKEN.includes('@Microsoft.KeyVault')) {
  console.error('❌ Key Vault reference detected but NOT resolved by Azure Container Apps!');
  console.error('   This means the container app may not have proper Key Vault access permissions.');
  console.error('   Please check:');
  console.error('   1. Container app has managed identity enabled');
  console.error('   2. Managed identity has "Key Vault Secrets User" role');
  console.error('   3. Key Vault access policy allows the managed identity');
} else if (GITHUB_TOKEN) {
  console.log('✅ GITHUB_TOKEN appears to be resolved (not a Key Vault reference)');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'github_mcp_server'
  });
});

// List available tools
app.get('/tools', (req, res) => {
  const tools = [
    { name: 'create_or_update_file', description: 'Create or update a file in a GitHub repository' },
    { name: 'search_repositories', description: 'Search for GitHub repositories' },
    { name: 'get_file_contents', description: 'Get file contents from a repository' },
    { name: 'create_issue', description: 'Create a GitHub issue' },
    { name: 'list_issues', description: 'List issues from a repository' },
    { name: 'create_pull_request', description: 'Create a pull request' },
    { name: 'list_pull_requests', description: 'List pull requests from a repository' },
  ];
  res.json({ tools });
});

// Helper function to make GitHub API calls
function makeGitHubRequest(path: string, method: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'GitHub-MCP-Server',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };

    // Log the request for debugging
    console.error(`[API] ${method} https://api.github.com${path}`);
    if (body && method === 'PUT') {
      console.error(`[API] Body keys: ${Object.keys(body).join(', ')}`);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          console.error(`[API ERROR] ${method} ${path} returned ${res.statusCode}`);
          console.error(`[API ERROR] Response: ${data.substring(0, 200)}`);
          reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[API ERROR] Request error: ${err.message}`);
      reject(err);
    });
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Execute a tool - simplified version that proxies to stdio MCP
app.post('/execute', async (req, res) => {
  try {
    // Debug: Check token availability at request time
    console.error(`[DEBUG] GITHUB_TOKEN check at request time: ${!!GITHUB_TOKEN}, length: ${GITHUB_TOKEN?.length || 0}`);
    const { tool, arguments: args, message } = req.body;
    
    // Support both tool-based and message-based requests
    if (!tool && !message) {
      return res.status(400).json({ error: 'Missing tool or message parameter' });
    }

    if (message) {
      // Handle message-based requests (from ChatGPT)
      const messageLower = message.toLowerCase();
      
      // PRIORITY: Check for file operations FIRST (create file, add file, update file)
      // This prevents "create a file in repo" from being misrouted to repository creation
      // Check for explicit file operation patterns
      const explicitFileOpPatterns = [
        'create a file',
        'create file', 
        'add file',
        'update file',
        'add to',
        'file in',
        'file to',
        'in the github repo',
        'to the github repo',
        'create a file in',
        'create file in',
        'create a file to',
        'create file to'
      ];
      
      const isFileOperation = explicitFileOpPatterns.some(pattern => messageLower.includes(pattern)) ||
                              (messageLower.includes('file') && (messageLower.includes('in') || messageLower.includes('to'))) ||
                              (messageLower.includes('create') && messageLower.includes('file') && (messageLower.includes('repo') || messageLower.includes('repository')));
      
      console.error(`[DEBUG] isFileOperation: ${isFileOperation}`);
      console.error(`[DEBUG] messageLower includes 'add': ${messageLower.includes('add')}`);
      console.error(`[DEBUG] messageLower includes 'update': ${messageLower.includes('update')}`);
      console.error(`[DEBUG] messageLower includes 'file': ${messageLower.includes('file')}`);
      console.error(`[DEBUG] message: ${message.substring(0, 150)}...`);
      
      // CRITICAL: Explicit check for "create a file" or "create file" - these should NEVER go to repo creation
      const hasCreateFilePattern = /create\s+(a\s+)?file/i.test(message);
      console.error(`[DEBUG] hasCreateFilePattern: ${hasCreateFilePattern}`);
      
      // Handle file operations FIRST (before repository creation)
      const shouldProcessAsFileOp = hasCreateFilePattern || isFileOperation || messageLower.includes('add') || messageLower.includes('update') || messageLower.includes('file');
      console.error(`[DEBUG] shouldProcessAsFileOp: ${shouldProcessAsFileOp}`);
      
      if (shouldProcessAsFileOp) {
        console.error(`[DEBUG] Processing as FILE OPERATION`);
        // Extract repository name (look for "repo", "repository", or repo name patterns)
        // Check more specific patterns first - prioritize quoted repo names and "in the github repo" patterns
        const repoPatterns = [
          /(?:in|to)\s+(?:the\s+)?(?:github\s+)?repo\s+["']([^"']+)["']/i,
          /(?:in|to)\s+(?:the\s+)?(?:github\s+)?repo\s+([a-zA-Z0-9_-]+)/i,
          /(?:in|to)\s+([a-zA-Z0-9_-]+)\s+repo/i,
          /repo\s+["']([^"']+)["']/i,
          /repo\s+([a-zA-Z0-9_-]+)/i,
          /repository\s+["']([^"']+)["']/i,
          /repository\s+([a-zA-Z0-9_-]+)/i
        ];
        let repoName: string | null = null;
        for (const pattern of repoPatterns) {
          const match = message.match(pattern);
          if (match) {
            repoName = match[1];
            break;
          }
        }

        // Extract file path (look for .md, .txt, .json, etc. or explicit file mentions)
        const filePatterns = [
          /(?:file|add|update)\s+([a-zA-Z0-9_./-]+\.(?:md|txt|json|js|ts|py|yaml|yml))/i,
          /([a-zA-Z0-9_./-]+\.(?:md|txt|json|js|ts|py|yaml|yml))/i,
          /(?:to|in)\s+([a-zA-Z0-9_./-]+\.(?:md|txt|json|js|ts|py|yaml|yml))/i
        ];
        let filePath: string | null = null;
        for (const pattern of filePatterns) {
          const match = message.match(pattern);
          if (match) {
            filePath = match[1];
            break;
          }
        }
        // Default file path if not specified
        if (!filePath) {
          if (messageLower.includes('readme') || messageLower.includes('comment')) {
            filePath = 'README.md';
          } else if (messageLower.includes('config') || messageLower.includes('configuration')) {
            // If it mentions config/configuration, default to a config file
            filePath = 'config.txt';
          } else if (messageLower.includes('create a file') || messageLower.includes('create file')) {
            // If user says "create a file" without specifying, default to a generic name
            filePath = 'file.txt';
          }
        }

        // Extract content (look for "say", "with content", "add comment", etc.)
        let content: string | null = null;
        
        // PRIORITY: Check for multi-line content pattern FIRST (e.g., "write content:\n<content>")
        // This handles large multi-line content like running configs that the simple regex patterns can't capture
        // Use greedy match to capture everything after "write content:\n" until end of string
        // This ensures we capture the full content even if it contains words like "in", "to", "repo", etc.
        // Find the position of "write content:" or "content:" in the message
        console.error(`[DEBUG] Message length: ${message.length} chars`);
        console.error(`[DEBUG] Checking for "write content:" in message...`);
        const writeContentIndex = message.toLowerCase().indexOf('write content:');
        const contentIndex = message.toLowerCase().indexOf('content:');
        console.error(`[DEBUG] writeContentIndex: ${writeContentIndex}, contentIndex: ${contentIndex}`);
        
        let extractedContent: string | null = null;
        
        // Try "write content:" first (more specific)
        if (writeContentIndex !== -1) {
          const startIndex = writeContentIndex + 'write content:'.length;
          // Skip any whitespace/newlines after the colon
          let contentStart = startIndex;
          while (contentStart < message.length && (message[contentStart] === ' ' || message[contentStart] === '\n' || message[contentStart] === '\r')) {
            contentStart++;
          }
          // Extract everything from contentStart to the end
          const extracted = message.substring(contentStart);
          extractedContent = extracted;
          console.error(`[DEBUG] Found "write content:" at index ${writeContentIndex}, extracted ${extracted.length} chars`);
        } 
        // Fallback to "content:" if "write content:" not found
        else if (contentIndex !== -1) {
          const startIndex = contentIndex + 'content:'.length;
          // Skip any whitespace/newlines after the colon
          let contentStart = startIndex;
          while (contentStart < message.length && (message[contentStart] === ' ' || message[contentStart] === '\n' || message[contentStart] === '\r')) {
            contentStart++;
          }
          // Extract everything from contentStart to the end
          const extracted = message.substring(contentStart);
          extractedContent = extracted;
          console.error(`[DEBUG] Found "content:" at index ${contentIndex}, extracted ${extracted.length} chars`);
        }
        
        if (extractedContent && extractedContent.trim().length > 0) {
          const trimmedContent = extractedContent.trim();
          content = trimmedContent;
          console.error(`[DEBUG] Extracted multi-line content (length: ${trimmedContent.length})`);
          console.error(`[DEBUG] Content preview (first 200 chars): ${trimmedContent.substring(0, 200)}`);
          console.error(`[DEBUG] Content preview (last 200 chars): ${trimmedContent.substring(Math.max(0, trimmedContent.length - 200))}`);
        }
        
        // If multi-line pattern didn't match, try simple patterns
        if (!content) {
          const contentPatterns = [
            /(?:say|content|add|write|comment)\s+(?:to|in|that|is|:)\s*["']?([^"']+)["']?/i,
            /(?:say|content|add|write|comment)\s+["']?([^"']+)["']?/i,
            /(?:#|##)\s*([^\n]+)/i  // Markdown headers/comments
          ];
          for (const pattern of contentPatterns) {
            const match = message.match(pattern);
            if (match && match[1]) {
              content = match[1].trim();
              // If it starts with #, it's a markdown header
              if (content && content.startsWith('#')) {
                content = content;
              }
              break;
            }
          }
        }

        if (!repoName) {
          return res.json({
            status: 'error',
            response: 'I need a repository name. Please specify which repository (e.g., "automation-test repo" or "in the automation-test repo").'
          });
        }

        if (!filePath) {
          return res.json({
            status: 'error',
            response: 'I need a file path. Please specify which file to update (e.g., "README.md" or "config.json").'
          });
        }

        // Content can be optional if it will be provided from another source (e.g., R1 config)
        // If no content is specified, we'll create an empty file or use a default message
        if (!content || content.trim().length === 0) {
          console.error(`[DEBUG] No content extracted from message`);
          console.error(`[DEBUG] Message length: ${message.length}`);
          console.error(`[DEBUG] Message preview (first 500 chars): ${message.substring(0, 500)}`);
          console.error(`[DEBUG] Message preview (last 500 chars): ${message.substring(Math.max(0, message.length - 500))}`);
          content = '# File created by MCP InfraOps\n\n'; // Default content if none specified
          console.error(`[DEBUG] No content specified, using default placeholder`);
        }

        // Debug: Check token before using it
        console.error(`[DEBUG] GITHUB_TOKEN check before API call: ${!!GITHUB_TOKEN}, length: ${GITHUB_TOKEN?.length || 0}`);
        if (!GITHUB_TOKEN) {
          console.error(`[ERROR] GITHUB_TOKEN is not set! process.env.GITHUB_TOKEN: ${!!process.env.GITHUB_TOKEN}`);
          return res.json({
            status: 'error',
            response: 'GitHub token is not configured.'
          });
        }

        try {
          // Get current user (owner)
          const userResult = await makeGitHubRequest('/user', 'GET');
          const owner = userResult.login;
          
          console.error(`[DEBUG] Extracted repo: ${repoName}, owner: ${owner}, file: ${filePath}`);
          console.error(`[DEBUG] Content to add: ${content ? content.substring(0, 50) : 'null'}...`);
          console.error(`[DEBUG] Content length: ${content ? content.length : 0} characters`);
          console.error(`[DEBUG] Content preview (first 200 chars): ${content ? content.substring(0, 200) : 'null'}`);
          
          // Verify repo exists and get default branch
          let defaultBranch = 'main';
          try {
            const repoCheck = await makeGitHubRequest(`/repos/${owner}/${repoName}`, 'GET');
            defaultBranch = repoCheck.default_branch || 'main';
            console.error(`[DEBUG] Repo exists: ${repoCheck.full_name}, default branch: ${defaultBranch}`);
          } catch (error: any) {
            console.error(`[ERROR] Repo check failed: ${error.message}`);
            return res.json({
              status: 'error',
              response: `Repository "${repoName}" not found for user "${owner}". Please check the repository name and ensure it exists.`
            });
          }

          // Get current file content if it exists (to get SHA for update)
          let sha: string | undefined;
          let isUpdate = false;
          // For GET requests, add ref as query parameter
          const getApiPath = `/repos/${owner}/${repoName}/contents/${filePath}?ref=${defaultBranch}`;
          console.error(`[DEBUG] Fetching existing file from: ${getApiPath}`);
          console.error(`[DEBUG] Repo: ${repoName}, Owner: ${owner}, File: ${filePath}, Branch: ${defaultBranch}`);
          try {
            const existingFile = await makeGitHubRequest(getApiPath, 'GET');
            sha = existingFile.sha;
            isUpdate = true;
            console.error(`[DEBUG] File exists, SHA: ${sha}`);
            // For "show run" config files, overwrite instead of appending
            // Check if this is a config file (show run output)
            const isConfigFile = filePath.toLowerCase().includes('show_run') || 
                                filePath.toLowerCase().includes('running_config') ||
                                filePath.toLowerCase().includes('config');
            
            if (isConfigFile) {
              // Overwrite: use new content as-is (don't append)
              console.error(`[DEBUG] Config file detected, overwriting existing content`);
            } else {
              // For other files, append to existing content
              const existingContent = Buffer.from(existingFile.content.replace(/\n/g, ''), 'base64').toString('utf-8');
              if (content) {
                content = existingContent + '\n\n' + content;
              }
            }
          } catch (error: any) {
            // File doesn't exist, will create new
            console.error(`[DEBUG] File ${filePath} doesn't exist, will create new. Error: ${error.message}`);
          }

          if (!content) {
            return res.json({
              status: 'error',
              response: 'Content is required to create or update a file.'
            });
          }

          // Create or update file
          const fileContent = Buffer.from(content).toString('base64');
          // For PUT requests, don't include query params in path - put branch in body
          const updateApiPath = `/repos/${owner}/${repoName}/contents/${filePath}`;
          const putBody: any = {
            message: isUpdate ? `Update ${filePath}` : `Add ${filePath}`,
            content: fileContent,
            branch: defaultBranch
          };
          if (sha) {
            putBody.sha = sha;
          }
          console.error(`[DEBUG] Creating/updating file at: ${updateApiPath}`);
          console.error(`[DEBUG] PUT body: ${JSON.stringify({...putBody, content: '[REDACTED]'})}`);
          console.error(`[DEBUG] Token type: ${GITHUB_TOKEN?.startsWith('github_pat_') ? 'Fine-grained PAT' : GITHUB_TOKEN?.startsWith('ghp_') ? 'Classic PAT' : 'Unknown'}`);
          console.error(`[DEBUG] Token preview: ${GITHUB_TOKEN?.substring(0, 20)}...${GITHUB_TOKEN?.substring(GITHUB_TOKEN.length - 4)}`);
          console.error(`[DEBUG] Authorization header format: Bearer ${GITHUB_TOKEN?.substring(0, 20)}...`);
          try {
            const result = await makeGitHubRequest(updateApiPath, 'PUT', putBody);
            console.error(`[DEBUG] Success! File updated.`);
            return res.json({
              status: 'success',
              response: `Successfully ${isUpdate ? 'updated' : 'created'} file "${filePath}" in repository "${repoName}"!\n\nFile URL: ${result.content.html_url}\nCommit: ${result.commit.sha}`
            });
          } catch (putError: any) {
            console.error(`[ERROR] PUT request failed: ${putError.message}`);
            console.error(`[ERROR] API Path was: ${updateApiPath}`);
            console.error(`[ERROR] Owner: ${owner}, Repo: ${repoName}, File: ${filePath}, Branch: ${defaultBranch}, SHA: ${sha || 'none'}`);
            throw putError;
          }

        } catch (error: any) {
          console.error('[ERROR] GitHub API error:', error);
          console.error('[ERROR] Full error details:', JSON.stringify(error));
          res.json({
            status: 'error',
            response: `Failed to create or update file: ${error.message}`
          });
        }
      }
      // Detect repository creation requests (ONLY if it's NOT a file operation)
      else if (!isFileOperation && messageLower.includes('create') && (messageLower.includes('repo') || messageLower.includes('repository')) && !messageLower.includes('file') && !messageLower.includes('in the') && !messageLower.includes('to the')) {
        console.error(`[DEBUG] Processing as REPOSITORY CREATION`);
        // Extract repository name
        const repoMatch = message.match(/["']([^"']+)["']/) || message.match(/repo called ([^\s]+)/i) || message.match(/repository called ([^\s]+)/i);
        const repoName = repoMatch ? repoMatch[1] : null;
        
        if (!repoName) {
          return res.json({
            status: 'error',
            response: 'I need a repository name to create a repository. Please specify a name like "My-Repo" or "MyRepo".'
          });
        }

        if (!GITHUB_TOKEN) {
          console.error('GitHub token is missing from environment');
          return res.json({
            status: 'error',
            response: 'GitHub token is not configured. Please add GITHUB_TOKEN to the container environment variables.'
          });
        }

        console.log(`GitHub token present: ${GITHUB_TOKEN ? 'Yes' : 'No'}`);
        console.log(`GitHub token length: ${GITHUB_TOKEN?.length || 0}`);

        try {
          // Create repository using GitHub API
          const result = await makeGitHubRequest(`/user/repos`, 'POST', {
            name: repoName,
            private: false,
            description: 'Created by MCP InfraOps',
            auto_init: true
          });

          res.json({
            status: 'success',
            response: `Successfully created repository "${repoName}" on GitHub!\n\nRepository URL: ${result.html_url}\nClone URL: ${result.clone_url}\n\nRepository is public and has been initialized with a README.`
          });
        } catch (error: any) {
          console.error('GitHub API error:', error);
          res.json({
            status: 'error',
            response: `Failed to create repository: ${error.message}`
          });
        }
      } else {
        res.json({
          status: 'success',
          response: `I received your GitHub request: "${message}". I can help you create repositories and add/update files. Please specify what you'd like to do.`
        });
      }
    } else {
      // Handle tool-based requests
      res.json({
        status: 'success',
        message: `Tool ${tool} executed successfully`,
        data: {
          tool,
          arguments: args,
          note: 'Tool execution not yet fully implemented'
        }
      });
    }
  } catch (error: any) {
    console.error('Error executing tool:', error);
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GitHub MCP HTTP Server listening on port ${PORT}`);
  console.log('Note: This is a simplified HTTP wrapper. Full functionality requires stdio MCP mode.');
});