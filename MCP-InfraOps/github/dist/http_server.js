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
app.use(express.json());
// Get GitHub token from environment
let GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = 'https://api.github.com';
console.log('GitHub MCP Server starting...');
console.log(`GITHUB_TOKEN environment variable set: ${!!GITHUB_TOKEN}`);
console.log(`GITHUB_TOKEN value preview: ${GITHUB_TOKEN?.substring(0, 20)}...`);
// Handle Key Vault reference format
if (GITHUB_TOKEN && GITHUB_TOKEN.includes('@Microsoft.KeyVault')) {
    console.log('Key Vault reference detected - this needs to be resolved by Azure');
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
function makeGitHubRequest(path, method, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: path,
            method: method,
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
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
                }
                else {
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
        const { tool, arguments: args, message } = req.body;
        // Support both tool-based and message-based requests
        if (!tool && !message) {
            return res.status(400).json({ error: 'Missing tool or message parameter' });
        }
        if (message) {
            // Handle message-based requests (from ChatGPT)
            const messageLower = message.toLowerCase();
            // Detect repository creation requests
            if (messageLower.includes('create') && (messageLower.includes('repo') || messageLower.includes('repository'))) {
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
                }
                catch (error) {
                    console.error('GitHub API error:', error);
                    res.json({
                        status: 'error',
                        response: `Failed to create repository: ${error.message}`
                    });
                }
            }
            // Detect file operations (add file, update file, add to repo, etc.)
            else if (messageLower.includes('add') || messageLower.includes('update') || messageLower.includes('file')) {
                // Extract repository name (look for "repo", "repository", or repo name patterns)
                // Check more specific patterns first
                const repoPatterns = [
                    /in\s+the\s+([a-zA-Z0-9_-]+)\s+repo/i,
                    /to\s+([a-zA-Z0-9_-]+)\s+repo/i,
                    /([a-zA-Z0-9_-]+)\s+repo/i,
                    /(?:repo|repository)\s+called\s+([a-zA-Z0-9_-]+)/i,
                    /(?:repo|repository)\s+([a-zA-Z0-9_-]+)/i
                ];
                let repoName = null;
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
                let filePath = null;
                for (const pattern of filePatterns) {
                    const match = message.match(pattern);
                    if (match) {
                        filePath = match[1];
                        break;
                    }
                }
                // Default to README.md if no file specified
                if (!filePath && (messageLower.includes('readme') || messageLower.includes('comment'))) {
                    filePath = 'README.md';
                }
                // Extract content (look for "say", "with content", "add comment", etc.)
                let content = null;
                const contentPatterns = [
                    /(?:say|content|add|write|comment)\s+(?:to|in|that|is|:)\s*["']?([^"']+)["']?/i,
                    /(?:say|content|add|write|comment)\s+["']?([^"']+)["']?/i,
                    /(?:#|##)\s*([^\n]+)/i // Markdown headers/comments
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
                if (!content) {
                    return res.json({
                        status: 'error',
                        response: 'I need content to add. Please specify what to add to the file (e.g., "add comment # Great work" or "with content: Hello World").'
                    });
                }
                if (!GITHUB_TOKEN) {
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
                    console.error(`[DEBUG] Content to add: ${content?.substring(0, 50)}...`);
                    // Verify repo exists and get default branch
                    let defaultBranch = 'main';
                    try {
                        const repoCheck = await makeGitHubRequest(`/repos/${owner}/${repoName}`, 'GET');
                        defaultBranch = repoCheck.default_branch || 'main';
                        console.error(`[DEBUG] Repo exists: ${repoCheck.full_name}, default branch: ${defaultBranch}`);
                    }
                    catch (error) {
                        console.error(`[ERROR] Repo check failed: ${error.message}`);
                        return res.json({
                            status: 'error',
                            response: `Repository "${repoName}" not found for user "${owner}". Please check the repository name and ensure it exists.`
                        });
                    }
                    // Get current file content if it exists (to get SHA for update)
                    let sha;
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
                        // If updating, append to existing content
                        const existingContent = Buffer.from(existingFile.content.replace(/\n/g, ''), 'base64').toString('utf-8');
                        if (content) {
                            content = existingContent + '\n\n' + content;
                        }
                    }
                    catch (error) {
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
                    const putBody = {
                        message: isUpdate ? `Update ${filePath}` : `Add ${filePath}`,
                        content: fileContent,
                        branch: defaultBranch
                    };
                    if (sha) {
                        putBody.sha = sha;
                    }
                    console.error(`[DEBUG] Creating/updating file at: ${updateApiPath}`);
                    console.error(`[DEBUG] PUT body: ${JSON.stringify({ ...putBody, content: '[REDACTED]' })}`);
                    try {
                        const result = await makeGitHubRequest(updateApiPath, 'PUT', putBody);
                        console.error(`[DEBUG] Success! File updated.`);
                        return res.json({
                            status: 'success',
                            response: `Successfully ${isUpdate ? 'updated' : 'created'} file "${filePath}" in repository "${repoName}"!\n\nFile URL: ${result.content.html_url}\nCommit: ${result.commit.sha}`
                        });
                    }
                    catch (putError) {
                        console.error(`[ERROR] PUT request failed: ${putError.message}`);
                        console.error(`[ERROR] API Path was: ${updateApiPath}`);
                        console.error(`[ERROR] Owner: ${owner}, Repo: ${repoName}, File: ${filePath}, Branch: ${defaultBranch}, SHA: ${sha || 'none'}`);
                        throw putError;
                    }
                }
                catch (error) {
                    console.error('[ERROR] GitHub API error:', error);
                    console.error('[ERROR] Full error details:', JSON.stringify(error));
                    res.json({
                        status: 'error',
                        response: `Failed to create or update file: ${error.message}`
                    });
                }
            }
            else {
                res.json({
                    status: 'success',
                    response: `I received your GitHub request: "${message}". I can help you create repositories and add/update files. Please specify what you'd like to do.`
                });
            }
        }
        else {
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
    }
    catch (error) {
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
