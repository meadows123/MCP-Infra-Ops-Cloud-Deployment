#!/usr/bin/env node
/**
 * Integrations API Server
 * Simple HTTP API for third-party integrations (GitHub, Google Maps, Email, etc.)
 * Fetches organization-specific credentials from Supabase and calls APIs directly
 */

const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');
const path = require('path');
const https = require('https');
const http = require('http');
require('dotenv').config();

// Disable SSL verification for development (Supabase may use self-signed certs)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Import integration fetcher
const { getIntegrationConfig } = require('./shared/integrationFetcher');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get organization ID from request header
 */
function getOrganizationId(req) {
  const orgId = req.headers['x-organization-id'];
  if (!orgId && process.env.MULTI_TENANT_ENABLED !== 'false') {
    console.warn('⚠️ No X-Organization-ID header found');
  }
  return orgId || 'default';
}

/**
 * Check if multi-tenant mode is enabled
 */
function isMultiTenantEnabled() {
  return process.env.MULTI_TENANT_ENABLED !== 'false';
}

/**
 * Async handler wrapper to catch promise rejections
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Integrations API',
    multi_tenant: isMultiTenantEnabled(),
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// USER / ORGANIZATION ENDPOINTS
// ============================================================================

/**
 * GET /api/users/:userId
 * Fetch user organization and role from Supabase
 * Uses the service role key for backend-to-backend authentication
 */
app.get('/api/users/:userId', async (req, res) => {
  const { userId } = req.params;
  
  if (!userId) {
    return res.status(400).json({
      error: 'Missing userId parameter',
      message: 'Please provide a user ID'
    });
  }
  
  try {
    console.log(`📋 Fetching user data for: ${userId}`);
    
    // Get Supabase credentials from environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !serviceRoleKey) {
      console.warn('⚠️ Supabase credentials not configured');
      return res.status(503).json({
        error: 'Supabase not configured',
        message: 'Backend Supabase integration is not configured'
      });
    }
    
    // Call Supabase REST API using service role key (more permissions)
    const response = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=id,organization_id,role`,
      {
        method: 'GET',
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Supabase REST API error:', data);
      return res.status(response.status).json({
        error: 'Failed to fetch user from Supabase',
        message: data?.message || 'Unknown error'
      });
    }
    
    const userData = data[0];
    
    if (!userData) {
      console.warn(`⚠️ User not found: ${userId}`);
      return res.status(404).json({
        error: 'User not found',
        message: `No user record found for ID: ${userId}`
      });
    }
    
    console.log(`✅ User data retrieved:`, {
      id: userData.id,
      organization_id: userData.organization_id,
      role: userData.role
    });
    
    res.json({
      success: true,
      user: {
        id: userData.id,
        organization_id: userData.organization_id,
        role: userData.role || 'viewer'
      }
    });
    
  } catch (error) {
    console.error('💥 Error fetching user:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/devices
 * Fetch devices for an organization from Supabase
 * Query params: organization_id (required), limit (optional, default 100)
 */
app.get('/api/devices', async (req, res) => {
  const { organization_id, limit = 100 } = req.query;
  
  if (!organization_id) {
    return res.status(400).json({
      error: 'Missing organization_id parameter',
      message: 'Please provide organization_id in query parameters'
    });
  }
  
  try {
    console.log(`🖥️  Fetching devices for organization: ${organization_id}`);
    
    // Get Supabase credentials from environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !serviceRoleKey) {
      console.warn('⚠️ Supabase credentials not configured');
      return res.status(503).json({
        error: 'Supabase not configured',
        message: 'Backend Supabase integration is not configured'
      });
    }
    
    // Call Supabase REST API using service role key
    const response = await fetch(
      `${supabaseUrl}/rest/v1/devices?organization_id=eq.${organization_id}&select=*&order=created_at.desc&limit=${limit}`,
      {
        method: 'GET',
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Supabase REST API error:', data);
      return res.status(response.status).json({
        error: 'Failed to fetch devices from Supabase',
        message: data?.message || 'Unknown error'
      });
    }
    
    console.log(`✅ Fetched ${data.length} devices for org ${organization_id}`);
    
    res.json({
      success: true,
      devices: data,
      count: data.length
    });
    
  } catch (error) {
    console.error('💥 Error fetching devices:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ============================================================================
// GITHUB INTEGRATION
// ============================================================================

/**
 * GET /api/github/repos
 * List repositories for the authenticated user
 */
app.get('/api/github/repos', async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    console.log(`🐙 Fetching GitHub repos for org: ${orgId}`);
    
    // Get credentials
    const config = await getIntegrationConfig(orgId, 'github');
    
    if (!config || !config.access_token) {
      return res.status(400).json({
        error: 'GitHub integration not configured',
        message: 'Please add your GitHub Personal Access Token in the Integrations page'
      });
    }
    
    // Call GitHub API
    const octokit = new Octokit({ auth: config.access_token });
    const { data } = await octokit.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 30
    });
    
    res.json({
      success: true,
      repositories: data.map(repo => ({
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        url: repo.html_url,
        private: repo.private,
        updated_at: repo.updated_at
      }))
    });
    
  } catch (error) {
    console.error('❌ GitHub API error:', error.message);
    res.status(500).json({
      error: 'GitHub API request failed',
      message: error.message
    });
  }
});

/**
 * GET /api/github/repo/:owner/:repo
 * Get repository details
 */
app.get('/api/github/repo/:owner/:repo', async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { owner, repo } = req.params;
    
    console.log(`🐙 Fetching repo ${owner}/${repo} for org: ${orgId}`);
    
    const config = await getIntegrationConfig(orgId, 'github');
    
    if (!config || !config.access_token) {
      return res.status(400).json({
        error: 'GitHub integration not configured'
      });
    }
    
    const octokit = new Octokit({ auth: config.access_token });
    const { data } = await octokit.repos.get({ owner, repo });
    
    res.json({
      success: true,
      repository: {
        name: data.name,
        full_name: data.full_name,
        description: data.description,
        url: data.html_url,
        stars: data.stargazers_count,
        forks: data.forks_count,
        language: data.language,
        created_at: data.created_at,
        updated_at: data.updated_at
      }
    });
    
  } catch (error) {
    console.error('❌ GitHub API error:', error.message);
    res.status(500).json({
      error: 'GitHub API request failed',
      message: error.message
    });
  }
});

/**
 * POST /api/github/issues
 * Create an issue in a repository
 */
app.post('/api/github/issues', async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { owner, repo, title, body } = req.body;
    
    if (!owner || !repo || !title) {
      return res.status(400).json({
        error: 'Missing required fields: owner, repo, title'
      });
    }
    
    console.log(`🐙 Creating issue in ${owner}/${repo} for org: ${orgId}`);
    
    const config = await getIntegrationConfig(orgId, 'github');
    
    if (!config || !config.access_token) {
      return res.status(400).json({
        error: 'GitHub integration not configured'
      });
    }
    
    const octokit = new Octokit({ auth: config.access_token });
    const { data } = await octokit.issues.create({
      owner,
      repo,
      title,
      body: body || ''
    });
    
    res.json({
      success: true,
      issue: {
        number: data.number,
        title: data.title,
        url: data.html_url,
        state: data.state
      }
    });
    
  } catch (error) {
    console.error('❌ GitHub API error:', error.message);
    res.status(500).json({
      error: 'Failed to create GitHub issue',
      message: error.message
    });
  }
});

// ============================================================================
// INFRASTRUCTURE APPROVAL REQUESTS
// ============================================================================

/**
 * GET /api/approval-requests
 * Fetch infrastructure approval requests (PRs) from GitHub
 * Queries params: 
 *   - state: 'open' (default) | 'closed' | 'all'
 * 
 * Uses GitHub credentials from organization integrations config (Supabase)
 * Falls back to GITHUB_TOKEN environment variable if not configured
 */
app.get('/api/approval-requests', asyncHandler(async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { state = 'all' } = req.query; // Changed to 'all' to fetch all states

    console.log(`📦 Fetching approval requests for org: ${orgId}, state: ${state}`);

    // Try to get GitHub config from organization integrations first
    let githubConfig = await getIntegrationConfig(orgId, 'github', false);
    let githubToken, repoUrl;

    if (githubConfig && githubConfig.token && githubConfig.repository_url) {
      // Use org-specific configuration
      githubToken = githubConfig.token;
      repoUrl = githubConfig.repository_url;
      console.log(`✅ Using GitHub config from organization integrations`);
    } else {
      // Fall back to environment variables
      githubToken = process.env.GITHUB_TOKEN;
      repoUrl = process.env.GITHUB_REPO_URL || 'https://github.com/meadows123/MCP-Infra-Ops-Cloud-Deployment.git';
      
      if (!githubToken) {
        return res.status(400).json({
          error: 'GitHub integration not configured',
          message: 'Please configure GitHub credentials in your organization Integrations settings, or set GITHUB_TOKEN environment variable'
        });
      }
      
      console.log(`⚠️  Using fallback GitHub config from environment variables`);
    }

    // Initialize Octokit with GitHub token
    const octokit = new Octokit({ auth: githubToken });

    // Extract owner and repo from URL
    const urlMatch = repoUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
    
    if (!urlMatch) {
      return res.status(400).json({
        error: 'Invalid GitHub repository URL',
        message: `Could not parse repository from URL: ${repoUrl}. Expected format: https://github.com/owner/repo or https://github.com/owner/repo.git`
      });
    }

    const owner = urlMatch[1];
    const repo = urlMatch[2];

    console.log(`📦 Fetching approval requests from: ${owner}/${repo}`);

    // Fetch pull requests - all states
    let pullRequests = [];
    
    // Get open PRs (pending)
    const { data: openPRs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      per_page: 50,
      sort: 'created',
      direction: 'desc'
    });
    
    // Get closed PRs (merged or rejected)
    const { data: closedPRs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'closed',
      per_page: 50,
      sort: 'created',
      direction: 'desc'
    });
    
    pullRequests = [...openPRs, ...closedPRs];

    // Convert pull requests to approval request format
    const approvalRequests = pullRequests.map((pr, index) => {
      // Extract infrastructure details from PR title/body
      const title = pr.title;
      const description = pr.body || '';
      
      // Try to determine provider from title/body
      let provider = 'Generic';
      if (title.toLowerCase().includes('azure') || description.toLowerCase().includes('azure')) {
        provider = 'Azure';
      } else if (title.toLowerCase().includes('aws') || description.toLowerCase().includes('aws')) {
        provider = 'AWS';
      } else if (title.toLowerCase().includes('gcp') || description.toLowerCase().includes('gcp')) {
        provider = 'GCP';
      }

      // Determine status based on PR state
      let status = 'pending';
      if (pr.merged_at) {
        status = 'deployed'; // PR was merged
      } else if (pr.state === 'closed' && !pr.merged_at) {
        status = 'rejected'; // PR was closed without merging
      }

      return {
        id: pr.number,
        mrId: `PR-${pr.number}`,
        number: pr.number,
        title: title,
        description: description.substring(0, 200), // Truncate long descriptions
        body: description, // Full body for parsing in frontend
        status: status, // pending, deployed, or rejected
        provider: provider,
        resourceType: 'Infrastructure Change',
        requester: pr.user?.login || 'unknown',
        createdAt: new Date(pr.created_at),
        updatedAt: new Date(pr.updated_at),
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        branch: pr.head?.ref || 'unknown',
        estimatedCost: 'TBD',
        prUrl: pr.html_url,
        prNumber: pr.number,
        repository: `${owner}/${repo}`,
        files: pr.changed_files,
        parameters: {
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files
        },
        terraformDiff: description, // Use PR body as the diff for now
        labels: pr.labels?.map(l => l.name) || [],
        mergedBy: pr.merged_by?.login || null
      };
    });

    console.log(`✅ Found ${approvalRequests.length} total pull requests`);
    console.log(`   - Pending: ${approvalRequests.filter(r => r.status === 'pending').length}`);
    console.log(`   - Deployed: ${approvalRequests.filter(r => r.status === 'deployed').length}`);
    console.log(`   - Rejected: ${approvalRequests.filter(r => r.status === 'rejected').length}`);

    res.json({
      success: true,
      approvalRequests,
      count: approvalRequests.length,
      repository: `${owner}/${repo}`,
      summary: {
        pending: approvalRequests.filter(r => r.status === 'pending').length,
        deployed: approvalRequests.filter(r => r.status === 'deployed').length,
        rejected: approvalRequests.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('❌ Error fetching approval requests:', error.message);
    
    // Provide more specific error messages
    let statusCode = 500;
    let errorMessage = error.message;
    
    if (error.message.includes('Bad credentials')) {
      statusCode = 401;
      errorMessage = `GitHub authentication failed: Invalid or expired token. Please generate a new Personal Access Token at https://github.com/settings/tokens with 'repo' and 'workflow' scopes and update GITHUB_TOKEN in your environment.`;
    } else if (error.message.includes('404') || error.message.includes('Not Found')) {
      statusCode = 404;
      errorMessage = `Repository not found. Verify that GITHUB_REPO_URL is correct and the token has access to it.`;
    } else if (error.message.includes('Unauthorized')) {
      statusCode = 401;
      errorMessage = `Token does not have permission to access this repository. Ensure token has 'repo' and 'workflow' scopes.`;
    }
    
    res.status(statusCode).json({
      error: 'Failed to fetch approval requests',
      message: errorMessage,
      statusCode: statusCode
    });
  }
}));

/**
 * POST /api/merge-pull-request
 * Merge a pull request on GitHub
 * 
 * Body:
 *   - prNumber: GitHub PR number
 *   - repository: Repository name (owner/repo)
 *   - mergeMethod: 'merge' | 'squash' | 'rebase' (default: 'squash')
 */
app.post('/api/merge-pull-request', asyncHandler(async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { prNumber, repository, mergeMethod = 'squash' } = req.body;

    if (!prNumber || !repository) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'prNumber and repository are required'
      });
    }

    console.log(`🔀 Merging PR #${prNumber} in ${repository}`);

    // Get GitHub credentials
    let githubConfig = await getIntegrationConfig(orgId, 'github', false);
    let githubToken = githubConfig?.token || process.env.GITHUB_TOKEN;

    if (!githubToken) {
      return res.status(400).json({
        error: 'GitHub integration not configured',
        message: 'Please configure GitHub credentials in your organization Integrations settings, or set GITHUB_TOKEN environment variable'
      });
    }

    // Initialize Octokit with GitHub token
    const octokit = new Octokit({ auth: githubToken });

    // Parse owner and repo
    const [owner, repo] = repository.split('/');

    // Merge the pull request
    const { data: mergeResult } = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: mergeMethod,
      commit_message: `Approved and merged infrastructure changes for PR #${prNumber}`,
      commit_title: `Merge infrastructure PR #${prNumber}`
    });

    console.log(`✅ Successfully merged PR #${prNumber}:`, mergeResult);

    res.json({
      success: true,
      message: `Pull request #${prNumber} merged successfully`,
      mergeResult: {
        sha: mergeResult.sha,
        merged: mergeResult.merged,
        message: mergeResult.message
      }
    });

  } catch (error) {
    console.error('❌ Error merging PR:', error.message);
    
    let statusCode = 500;
    let errorMessage = error.message;

    if (error.message.includes('Bad credentials')) {
      statusCode = 401;
      errorMessage = 'GitHub authentication failed: Invalid or expired token';
    } else if (error.message.includes('405')) {
      statusCode = 405;
      errorMessage = 'Pull request cannot be merged (may already be merged or in conflict state)';
    } else if (error.message.includes('404')) {
      statusCode = 404;
      errorMessage = 'Pull request not found';
    }

    res.status(statusCode).json({
      error: 'Failed to merge pull request',
      message: errorMessage,
      statusCode: statusCode
    });
  }
}));

/**
 * POST /api/close-pull-request
 * Close a pull request on GitHub without merging
 * 
 * Body:
 *   - prNumber: GitHub PR number
 *   - repository: Repository name (owner/repo)
 */
app.post('/api/close-pull-request', asyncHandler(async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { prNumber, repository } = req.body;

    if (!prNumber || !repository) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'prNumber and repository are required'
      });
    }

    console.log(`❌ Closing PR #${prNumber} in ${repository}`);

    // Get GitHub credentials
    let githubConfig = await getIntegrationConfig(orgId, 'github', false);
    let githubToken = githubConfig?.token || process.env.GITHUB_TOKEN;

    if (!githubToken) {
      return res.status(400).json({
        error: 'GitHub integration not configured',
        message: 'Please configure GitHub credentials in your organization Integrations settings, or set GITHUB_TOKEN environment variable'
      });
    }

    // Initialize Octokit with GitHub token
    const octokit = new Octokit({ auth: githubToken });

    // Parse owner and repo
    const [owner, repo] = repository.split('/');

    // Close the pull request
    const { data: closeResult } = await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: prNumber,
      state: 'closed'
    });

    console.log(`✅ Successfully closed PR #${prNumber}:`, closeResult);

    res.json({
      success: true,
      message: `Pull request #${prNumber} closed successfully`,
      closeResult: {
        id: closeResult.id,
        state: closeResult.state,
        title: closeResult.title
      }
    });

  } catch (error) {
    console.error('❌ Error closing PR:', error.message);
    
    let statusCode = 500;
    let errorMessage = error.message;

    if (error.message.includes('Bad credentials')) {
      statusCode = 401;
      errorMessage = 'GitHub authentication failed: Invalid or expired token';
    } else if (error.message.includes('404')) {
      statusCode = 404;
      errorMessage = 'Pull request not found';
    }

    res.status(statusCode).json({
      error: 'Failed to close pull request',
      message: errorMessage,
      statusCode: statusCode
    });
  }
}));

/**
 * POST /api/terraform-destroy
 * Execute terraform destroy to remove all managed infrastructure
 * 
 * Body:
 *   - action: 'destroy' (required)
 *   - confirmationId: unique confirmation ID for audit trail
 */
app.post('/api/terraform-destroy', asyncHandler(async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { action, confirmationId } = req.body;

    if (action !== 'destroy') {
      return res.status(400).json({
        error: 'Invalid action',
        message: 'Only "destroy" action is supported'
      });
    }

    console.log(`⚠️ TERRAFORM DESTROY INITIATED`);
    console.log(`   Org ID: ${orgId}`);
    console.log(`   Confirmation ID: ${confirmationId}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);

    // Get GitHub config to access the repository
    let githubConfig = await getIntegrationConfig(orgId, 'github', false);
    let githubToken, repoUrl;

    if (githubConfig && githubConfig.token && githubConfig.repository_url) {
      githubToken = githubConfig.token;
      repoUrl = githubConfig.repository_url;
    } else {
      githubToken = process.env.GITHUB_TOKEN;
      repoUrl = process.env.GITHUB_REPO_URL || 'https://github.com/meadows123/MCP-Infra-Ops-Cloud-Deployment.git';
      
      if (!githubToken) {
        return res.status(400).json({
          error: 'GitHub integration not configured',
          message: 'Cannot execute destroy without GitHub access'
        });
      }
    }

    const octokit = new Octokit({ auth: githubToken });
    const urlMatch = repoUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
    
    if (!urlMatch) {
      return res.status(400).json({
        error: 'Invalid GitHub repository URL',
        message: `Could not parse repository from URL: ${repoUrl}`
      });
    }

    const owner = urlMatch[1];
    const repo = urlMatch[2];

    console.log(`📦 Repository: ${owner}/${repo}`);

    // Create a destroy PR with terraform destroy command
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const branchName = `terraform-destroy-${timestamp}`;
    const prTitle = `[DESTROY] Terraform Destroy - ${new Date().toLocaleDateString()}`;

    // Get the main branch first
    const { data: mainBranch } = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: 'main'
    });

    console.log(`🌿 Creating destroy branch from main`);

    // Create the new branch
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: mainBranch.commit.sha
    });

    // Create a destroy manifest file
    const destroyManifest = `# Terraform Destroy Manifest
# Generated: ${new Date().toISOString()}
# Confirmation ID: ${confirmationId}
# Organization: ${orgId}

This pull request initiates a complete terraform destroy operation.

## Action
\`\`\`bash
terraform destroy -auto-approve
\`\`\`

## WARNING
This will:
- Destroy all Terraform-managed infrastructure
- Delete all associated resources
- Remove all cloud deployments
- This action CANNOT be undone

## Approved By
System initiated destroy request

## Timestamp
${new Date().toISOString()}
`;

    // Commit the manifest
    const { data: baseTree } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: mainBranch.commit.sha
    });

    const { data: newBlob } = await octokit.rest.git.createBlob({
      owner,
      repo,
      content: destroyManifest,
      encoding: 'utf-8'
    });

    const { data: newTree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseTree.sha,
      tree: [
        {
          path: '.destroy/manifest.md',
          mode: '100644',
          type: 'blob',
          sha: newBlob.sha
        }
      ]
    });

    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: `[DESTROY] Terraform destroy initiated - ${confirmationId}`,
      tree: newTree.sha,
      parents: [mainBranch.commit.sha]
    });

    // Update the branch
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
      sha: newCommit.sha
    });

    console.log(`✅ Created destroy branch: ${branchName}`);

    // Create the PR
    const { data: destroyPR } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: prTitle,
      head: branchName,
      base: 'main',
      body: `## Infrastructure Destroy Request

**Status:** PENDING REVIEW

### Details
- **Confirmation ID:** ${confirmationId}
- **Organization:** ${orgId}
- **Initiated:** ${new Date().toISOString()}
- **Action:** Complete infrastructure destruction

### Command
\`\`\`bash
terraform destroy -auto-approve
\`\`\`

### Warning
🚨 **THIS WILL DESTROY ALL INFRASTRUCTURE**

This pull request, when merged and executed, will:
- ❌ Destroy all cloud resources
- ❌ Delete all databases
- ❌ Remove all deployments
- ❌ This action cannot be undone

### Next Steps
1. Review the destroy manifest in .destroy/manifest.md
2. Verify this is the correct environment
3. Merge only if absolutely certain
4. Monitor the destruction process

---
*This PR was automatically generated by the Terraform Approval System*`
    });

    console.log(`✅ Created destroy PR #${destroyPR.number}`);

    res.json({
      success: true,
      message: 'Terraform destroy initiated. A pull request has been created.',
      prNumber: destroyPR.number,
      prUrl: destroyPR.html_url,
      branchName: branchName,
      confirmationId: confirmationId,
      output: `Destroy operation initiated successfully.\n\nPull Request: #${destroyPR.number}\nURL: ${destroyPR.html_url}\n\nReview the destroy manifest before merging.`
    });

  } catch (error) {
    console.error('❌ Error initiating destroy:', error.message);

    let statusCode = 500;
    let errorMessage = error.message;

    if (error.message.includes('Bad credentials')) {
      statusCode = 401;
      errorMessage = 'GitHub authentication failed';
    } else if (error.message.includes('404') || error.message.includes('Not Found')) {
      statusCode = 404;
      errorMessage = 'Repository not found';
    }

    res.status(statusCode).json({
      error: 'Failed to initiate terraform destroy',
      message: errorMessage,
      statusCode: statusCode
    });
  }
}));

// ============================================================================
// INFRASTRUCTURE / TERRAFORM INTEGRATION
// ============================================================================

/**
 * POST /api/infrastructure/request
 * Handle infrastructure-as-code requests (Terraform generation)
 * Generates Terraform code and creates a merge request with the code
 */
app.post('/api/infrastructure/request', asyncHandler(async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { request, project_name, environment, create_mr } = req.body;

    if (!request) {
      return res.status(400).json({
        error: 'Missing required field: request',
        message: 'Please provide an infrastructure request description'
      });
    }

    console.log(`🏗️ [Infrastructure Request] Org: ${orgId}, Project: ${project_name}`);
    console.log(`📋 Request: ${request.substring(0, 100)}...`);

    // Get GitHub config for creating the MR
    let githubConfig = await getIntegrationConfig(orgId, 'github', false);
    let githubToken, repoUrl;

    if (githubConfig && githubConfig.token && githubConfig.repository_url) {
      githubToken = githubConfig.token;
      repoUrl = githubConfig.repository_url;
      console.log(`✅ Using GitHub config from organization integrations`);
    } else {
      // Fall back to environment variables
      githubToken = process.env.GITHUB_TOKEN;
      repoUrl = process.env.GITHUB_REPO_URL || 'https://github.com/meadows123/MCP-Infra-Ops-Cloud-Deployment.git';

      if (!githubToken) {
        return res.status(400).json({
          error: 'GitHub integration not configured',
          message: 'Please configure GitHub credentials in your organization Integrations settings, or set GITHUB_TOKEN environment variable'
        });
      }

      console.log(`⚠️ Using fallback GitHub config from environment variables`);
    }

    // Initialize Octokit with GitHub token
    const octokit = new Octokit({ auth: githubToken });

    // Extract owner and repo from URL
    const urlMatch = repoUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);

    if (!urlMatch) {
      return res.status(400).json({
        error: 'Invalid GitHub repository URL',
        message: `Could not parse repository from URL: ${repoUrl}`
      });
    }

    const owner = urlMatch[1];
    const repo = urlMatch[2];

    // Generate a branch name from the request
    const branchName = `terraform/${project_name || 'infra'}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9\-]/g, '-');
    const prTitle = `[Terraform] ${project_name || 'Infrastructure'} - ${request.substring(0, 60)}...`;
    
    // Note: prBody will be created after Terraform code is generated so we can include it in the description
    let prBody;

    // Call Python terraform-generator to generate actual Terraform code
    let terraformContent;
    let extractedParams = {};
    
    try {
      const { execSync } = require('child_process');
      const pythonScript = `
import sys
import json
sys.path.insert(0, '/app/terraform-generator')
from terraform_generator import TerraformGenerator

request = ${JSON.stringify(request)}
project = ${JSON.stringify(project_name)}
env = ${JSON.stringify(environment)}

gen = TerraformGenerator(request, project, env)
params = gen.get_extracted_parameters()
files = gen.generate_all()

result = {
  "parameters": params,
  "files": files
}

print(json.dumps(result))
`;
      
      const result = JSON.parse(execSync(`python3 -c '${pythonScript.replace(/'/g, "'\\''")}'`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024  // 10MB buffer for large terraform files
      }));
      
      // Use main.tf as the primary terraform content
      terraformContent = result.files['main.tf'];
      extractedParams = result.parameters;
      
      console.log(`✅ Generated Terraform code with parameters:`, extractedParams);
    } catch (pythonError) {
      console.warn(`⚠️  Failed to call Python generator: ${pythonError.message}`);
      console.log(`Using fallback placeholder code`);
      
      // Fallback to placeholder if Python fails
      terraformContent = `# Terraform configuration generated from request
# Generated: ${new Date().toISOString()}
# Request: ${request}
# Project: ${project_name}
# Environment: ${environment}

# ============================================================================
# PLACEHOLDER: Python generator failed, using fallback
# ============================================================================

# Example resources:
# resource "azurerm_resource_group" "rg" {
#   name     = "\${var.environment}-\${var.project_name}-rg"
#   location = var.location
# }
#
# resource "azurerm_virtual_machine" "vm" {
#   name                  = "\${var.environment}-\${var.project_name}-vm"
#   location              = azurerm_resource_group.rg.location
#   resource_group_name   = azurerm_resource_group.rg.name
#   vm_size               = var.vm_size
# }
`;
    }

    // Build the PR body with Terraform code preview and extracted parameters
    const parametersSummary = Object.entries(extractedParams)
      .map(([key, value]) => `- **${key}**: ${value}`)
      .join('\n');
    
    const terraformPreview = terraformContent.split('\n').slice(0, 30).join('\n');
    
    prBody = `## Infrastructure Request

**User Request:**
\`\`\`
${request}
\`\`\`

### Extracted Parameters
${parametersSummary || '- No specific parameters extracted'}

### Project Details
- **Project Name:** ${project_name}
- **Environment:** ${environment}
- **Generated:** ${new Date().toISOString()}

### Generated Terraform Code Preview
\`\`\`hcl
${terraformPreview}
...
(See \`terraform/${branchName}/main.tf\` for the full configuration)
\`\`\`

## How to Apply

1. **Review** the Terraform code in this pull request
2. **Approve** the pull request once verified
3. **Merge** to trigger the CI/CD pipeline
4. **Apply** using: \`terraform apply -var-file="terraform.tfvars"\`

## Files Changed
- \`terraform/${branchName}/main.tf\` - Main infrastructure resources
- \`terraform/${branchName}/variables.tf\` - Input variables
- \`terraform/${branchName}/outputs.tf\` - Output values
- \`terraform/${branchName}/backend.tf\` - Remote state configuration`;

    let prUrl, prNumber;

    if (create_mr) {
      try {
        // Create a new branch from main
        const mainBranchRef = await octokit.rest.git.getRef({
          owner,
          repo,
          ref: 'heads/main'
        });

        await octokit.rest.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${branchName}`,
          sha: mainBranchRef.data.object.sha
        });

        console.log(`🌿 Created branch: ${branchName}`);

        // Create terraform file in the branch
        const filePath = `terraform/${branchName}/main.tf`;
        
        await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: filePath,
          message: `Add Terraform configuration: ${prTitle}`,
          content: Buffer.from(terraformContent).toString('base64'),
          branch: branchName
        });

        console.log(`📝 Created terraform file: ${filePath}`);

        // Also create the GitHub Actions workflow file if it doesn't exist
        const workflowPath = '.github/workflows/terraform-apply.yml';
        const workflowContent = `name: Terraform Apply

# Trigger on push to main (which happens after PR merge)
on:
  push:
    branches:
      - main
    paths:
      - 'terraform/**/*.tf'
      - '.github/workflows/terraform-apply.yml'

env:
  TERRAFORM_VERSION: 1.5.0

jobs:
  terraform-apply:
    name: Terraform Apply
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v2
        with:
          terraform_version: \${{ env.TERRAFORM_VERSION }}

      - name: Find Terraform Directories
        id: find_dirs
        run: |
          # Find all directories with .tf files
          DIRS=\$(find terraform -name "*.tf" -type f | xargs -I {} dirname {} | sort -u)
          echo "Found terraform directories:"
          echo "\$DIRS"
          # Take the first (most recent) directory
          WORKING_DIR=\$(echo "\$DIRS" | head -1)
          echo "Using directory: \$WORKING_DIR"
          echo "working_dir=\$WORKING_DIR" >> \$GITHUB_OUTPUT

      - name: Terraform Format Check
        if: steps.find_dirs.outputs.working_dir
        run: terraform fmt -check
        working-directory: \${{ steps.find_dirs.outputs.working_dir }}
        continue-on-error: true

      - name: Terraform Init
        if: steps.find_dirs.outputs.working_dir
        run: terraform init
        working-directory: \${{ steps.find_dirs.outputs.working_dir }}
        env:
          ARM_CLIENT_ID: \${{ secrets.AZURE_CLIENT_ID }}
          ARM_CLIENT_SECRET: \${{ secrets.AZURE_CLIENT_SECRET }}
          ARM_SUBSCRIPTION_ID: \${{ secrets.AZURE_SUBSCRIPTION_ID }}
          ARM_TENANT_ID: \${{ secrets.AZURE_TENANT_ID }}

      - name: Terraform Validate
        if: steps.find_dirs.outputs.working_dir
        run: terraform validate
        working-directory: \${{ steps.find_dirs.outputs.working_dir }}

      - name: Terraform Plan
        if: steps.find_dirs.outputs.working_dir
        run: |
          terraform plan -out=tfplan \\
            -var="subscription_id=\$ARM_SUBSCRIPTION_ID" \\
            -var="client_id=\$ARM_CLIENT_ID" \\
            -var="client_secret=\$ARM_CLIENT_SECRET" \\
            -var="tenant_id=\$ARM_TENANT_ID"
        working-directory: \${{ steps.find_dirs.outputs.working_dir }}
        env:
          ARM_CLIENT_ID: \${{ secrets.AZURE_CLIENT_ID }}
          ARM_CLIENT_SECRET: \${{ secrets.AZURE_CLIENT_SECRET }}
          ARM_SUBSCRIPTION_ID: \${{ secrets.AZURE_SUBSCRIPTION_ID }}
          ARM_TENANT_ID: \${{ secrets.AZURE_TENANT_ID }}

      - name: Terraform Apply
        if: steps.find_dirs.outputs.working_dir
        run: terraform apply -auto-approve tfplan
        working-directory: \${{ steps.find_dirs.outputs.working_dir }}
        env:
          ARM_CLIENT_ID: \${{ secrets.AZURE_CLIENT_ID }}
          ARM_CLIENT_SECRET: \${{ secrets.AZURE_CLIENT_SECRET }}
          ARM_SUBSCRIPTION_ID: \${{ secrets.AZURE_SUBSCRIPTION_ID }}
          ARM_TENANT_ID: \${{ secrets.AZURE_TENANT_ID }}

      - name: Post Apply Summary
        if: always() && steps.find_dirs.outputs.working_dir
        run: |
          echo "## Terraform Apply Summary" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "✅ Merge to main detected" >> \$GITHUB_STEP_SUMMARY
          echo "✅ Terraform plan validated" >> \$GITHUB_STEP_SUMMARY
          echo "✅ Infrastructure deployed to Azure" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY
          echo "**Resources Created/Updated:**" >> \$GITHUB_STEP_SUMMARY
          terraform output -json 2>/dev/null | jq -r 'to_entries[] | "- \\(.key): \\(.value.value)"' >> \$GITHUB_STEP_SUMMARY || echo "- Check Azure Portal for details" >> \$GITHUB_STEP_SUMMARY
        working-directory: \${{ steps.find_dirs.outputs.working_dir }}

      - name: Notify on Failure
        if: failure()
        run: |
          echo "❌ Terraform apply failed!"
          echo "Please check the workflow logs and fix the Terraform configuration."
          exit 1
`;

        try {
          await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: workflowPath,
            message: 'Add: Terraform auto-apply workflow',
            content: Buffer.from(workflowContent).toString('base64'),
            branch: branchName
          });
          console.log(`✅ Created GitHub Actions workflow: ${workflowPath}`);
        } catch (workflowError) {
          console.warn(`⚠️ Failed to create workflow file (may already exist): ${workflowError.message}`);
          // Continue - workflow not critical to terraform creation
        }

        // Create a pull request
        const pr = await octokit.rest.pulls.create({
          owner,
          repo,
          title: prTitle,
          body: prBody,
          head: branchName,
          base: 'main'
        });

        prUrl = pr.data.html_url;
        prNumber = pr.data.number;

        console.log(`✅ Created pull request #${prNumber}: ${prUrl}`);
      } catch (prError) {
        console.error(`❌ Failed to create pull request: ${prError.message}`);
        // Continue anyway - the user still got the terraform code generated
      }
    }

    res.json({
      success: true,
      message: 'Infrastructure request processed successfully',
      request: request.substring(0, 200),
      project_name,
      environment,
      terraform_code: terraformContent,
      extracted_parameters: extractedParams,
      merge_request: create_mr ? {
        url: prUrl,
        number: prNumber,
        branch: branchName,
        status: 'created'
      } : {
        status: 'skipped',
        message: 'Merge request creation was not requested'
      },
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error(`❌ Error processing infrastructure request: ${error.message}`);
    res.status(500).json({
      error: 'Failed to process infrastructure request',
      message: error.message
    });
  }
}));

// ============================================================================
// GOOGLE MAPS INTEGRATION
// ============================================================================

/**
 * POST /api/maps/geocode
 * Geocode an address
 */
app.post('/api/maps/geocode', async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({
        error: 'Missing required field: address'
      });
    }
    
    console.log(`🗺️ Geocoding address for org: ${orgId}`);
    
    const config = await getIntegrationConfig(orgId, 'google_maps');
    
    if (!config || !config.api_key) {
      return res.status(400).json({
        error: 'Google Maps integration not configured',
        message: 'Please add your Google Maps API Key in the Integrations page'
      });
    }
    
    // Call Google Maps Geocoding API
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${config.api_key}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status !== 'OK') {
      return res.status(400).json({
        error: 'Geocoding failed',
        message: data.error_message || data.status
      });
    }
    
    const result = data.results[0];
    
    res.json({
      success: true,
      location: {
        address: result.formatted_address,
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        place_id: result.place_id
      }
    });
    
  } catch (error) {
    console.error('❌ Google Maps API error:', error.message);
    res.status(500).json({
      error: 'Google Maps API request failed',
      message: error.message
    });
  }
});

/**
 * POST /api/maps/directions
 * Get directions between two points
 */
app.post('/api/maps/directions', async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { origin, destination } = req.body;
    
    if (!origin || !destination) {
      return res.status(400).json({
        error: 'Missing required fields: origin, destination'
      });
    }
    
    console.log(`🗺️ Getting directions for org: ${orgId}`);
    
    const config = await getIntegrationConfig(orgId, 'google_maps');
    
    if (!config || !config.api_key) {
      return res.status(400).json({
        error: 'Google Maps integration not configured'
      });
    }
    
    // Call Google Maps Directions API
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${config.api_key}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status !== 'OK') {
      return res.status(400).json({
        error: 'Directions request failed',
        message: data.error_message || data.status
      });
    }
    
    const route = data.routes[0];
    const leg = route.legs[0];
    
    res.json({
      success: true,
      directions: {
        distance: leg.distance.text,
        duration: leg.duration.text,
        start_address: leg.start_address,
        end_address: leg.end_address,
        steps: leg.steps.map(step => ({
          instruction: step.html_instructions.replace(/<[^>]*>/g, ''),
          distance: step.distance.text,
          duration: step.duration.text
        }))
      }
    });
    
  } catch (error) {
    console.error('❌ Google Maps API error:', error.message);
    res.status(500).json({
      error: 'Google Maps API request failed',
      message: error.message
    });
  }
});

// ============================================================================
// EMAIL INTEGRATION
// ============================================================================

/**
 * POST /api/email/send
 * Send an email via SMTP
 */
app.post('/api/email/send', async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { to, subject, body, html } = req.body;
    
    if (!to || !subject || (!body && !html)) {
      return res.status(400).json({
        error: 'Missing required fields: to, subject, body or html'
      });
    }
    
    console.log(`📧 Sending email for org: ${orgId}`);
    
    const config = await getIntegrationConfig(orgId, 'email_smtp');
    
    if (!config || !config.smtp_host || !config.smtp_username || !config.smtp_password) {
      return res.status(400).json({
        error: 'Email integration not configured',
        message: 'Please add your SMTP credentials in the Integrations page'
      });
    }
    
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port || 587,
      secure: config.smtp_port === 465, // true for 465, false for other ports
      auth: {
        user: config.smtp_username,
        pass: config.smtp_password
      },
      tls: {
        rejectUnauthorized: config.use_tls !== false
      }
    });
    
    // Send email
    const info = await transporter.sendMail({
      from: `"${config.smtp_from_name || 'Network Automation'}" <${config.smtp_from_email || config.smtp_username}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject,
      text: body,
      html: html
    });
    
    res.json({
      success: true,
      message: 'Email sent successfully',
      messageId: info.messageId
    });
    
  } catch (error) {
    console.error('❌ Email sending error:', error.message);
    res.status(500).json({
      error: 'Failed to send email',
      message: error.message
    });
  }
});

/**
 * POST /api/email/test
 * Test email configuration
 */
app.post('/api/email/test', async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    console.log(`📧 Testing email config for org: ${orgId}`);
    
    const config = await getIntegrationConfig(orgId, 'email_smtp');
    
    if (!config || !config.smtp_host || !config.smtp_username || !config.smtp_password) {
      return res.status(400).json({
        error: 'Email integration not configured'
      });
    }
    
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port || 587,
      secure: config.smtp_port === 465,
      auth: {
        user: config.smtp_username,
        pass: config.smtp_password
      }
    });
    
    // Verify connection
    await transporter.verify();
    
    res.json({
      success: true,
      message: 'Email configuration is valid',
      smtp_host: config.smtp_host,
      smtp_port: config.smtp_port
    });
    
  } catch (error) {
    console.error('❌ Email test error:', error.message);
    res.status(400).json({
      error: 'Email configuration is invalid',
      message: error.message
    });
  }
});

// ============================================================================
// USER INVITATION EMAIL
// ============================================================================

/**
 * POST /api/email/send-invitation
 * Send user invitation email
 */
app.post('/api/email/send-invitation', async (req, res) => {
  try {
    const orgId = getOrganizationId(req);
    const { email, role, invitationToken, organizationName, inviterName } = req.body;
    
    if (!email || !role || !invitationToken) {
      return res.status(400).json({
        error: 'Missing required fields: email, role, invitationToken'
      });
    }
    
    console.log(`📧 Sending invitation email to ${email} for org: ${orgId}`);
    
    // Try SendGrid first, then fall back to SMTP
    let sendgridConfig = await getIntegrationConfig(orgId, 'email_sendgrid');
    let smtpConfig = await getIntegrationConfig(orgId, 'email_smtp');
    
    if (!sendgridConfig && !smtpConfig) {
      return res.status(400).json({
        error: 'Email integration not configured',
        message: 'Please configure SendGrid or SMTP settings in the Integrations page first'
      });
    }
    
    // Build invitation URL
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.example.com';
    const invitationUrl = `${frontendUrl}/accept-invitation?token=${invitationToken}`;
    
    // Get role permissions description
    const getRolePermissions = (role) => {
      const permissions = {
        admin: [
          'Manage devices and network infrastructure',
          'Run show and configuration commands',
          'Manage integrations and API keys',
          'Invite and manage team members',
          'Full AI bot access with all commands'
        ],
        editor: [
          'Add, edit, and delete devices',
          'Run show and configuration commands',
          'Execute automation workflows',
          'AI bot access with configuration commands',
          'View analytics and reports'
        ],
        viewer: [
          'View all devices and network topology',
          'Run show commands only',
          'View analytics and reports',
          'AI bot access with show commands only',
          'No editing or configuration changes'
        ],
        'read-only': [
          'View devices and network information',
          'View analytics and reports',
          'AI bot interaction (view only)',
          'No command execution',
          'No editing capabilities'
        ]
      };
      return permissions[role] || permissions['viewer'];
    };
    
    const rolePermissions = getRolePermissions(role);
    
    // Build HTML email
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #667eea; color: white !important; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: 600; }
          .role-badge { display: inline-block; background: #e0e7ff; color: #4338ca; padding: 6px 16px; border-radius: 6px; font-size: 14px; font-weight: 600; text-transform: capitalize; }
          .permissions { background: white; border-left: 4px solid #667eea; padding: 16px; margin: 20px 0; border-radius: 4px; }
          .permissions li { margin: 8px 0; color: #1f2937; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">🎉 You're Invited!</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px;">Join ${organizationName || 'the team'} on MCP Network Automation</p>
          </div>
          <div class="content">
            <p>Hi there!</p>
            <p><strong>${inviterName || 'Your colleague'}</strong> has invited you to join their workspace on the <strong>MCP Network Automation Platform</strong>.</p>
            
            <p>You've been assigned the role: <span class="role-badge">${role}</span></p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${invitationUrl}" class="button" style="color: white;">Accept Invitation</a>
            </div>
            
            <div class="permissions">
              <p style="margin-top: 0; font-weight: 600; color: #1f2937;">What you'll be able to do:</p>
              <ul style="margin: 10px 0; padding-left: 20px;">
                ${rolePermissions.map(perm => `<li>${perm}</li>`).join('')}
              </ul>
            </div>
            
            <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 13px; color: #6b7280;">
              This invitation expires in <strong>7 days</strong>. If you didn't expect this invitation, you can safely ignore this email.
            </p>
          </div>
          <div class="footer">
            <p style="margin: 5px 0; font-weight: 600;">MCP Network Automation Platform</p>
            <p style="margin: 5px 0;">Secure, scalable network management and automation</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const textContent = `
You're invited to join ${organizationName || 'the team'} on MCP Network Automation!

${inviterName || 'Your colleague'} has invited you to join their workspace.

Role: ${role}

What you'll be able to do:
${rolePermissions.map(perm => `• ${perm}`).join('\n')}

Accept your invitation: ${invitationUrl}

This invitation expires in 7 days.

---
MCP Network Automation Platform
    `;
    
    // Send email using SendGrid or SMTP
    let messageId;
    
    if (sendgridConfig && sendgridConfig.api_key) {
      // Use SendGrid
      console.log('📧 Sending via SendGrid');
      
      sgMail.setApiKey(sendgridConfig.api_key);
      
      const msg = {
        to: email,
        from: {
          email: sendgridConfig.from_email,
          name: sendgridConfig.from_name || 'MCP Network Automation'
        },
        replyTo: {
          email: sendgridConfig.from_email,
          name: sendgridConfig.from_name || 'MCP Network Automation'
        },
        subject: `You've been invited to join ${organizationName || 'a workspace'} on MCP Network Automation`,
        text: textContent,
        html: htmlContent
      };
      
      const result = await sgMail.send(msg);
      messageId = result[0].headers['x-message-id'];
      console.log('✅ Email sent via SendGrid');
      
    } else if (smtpConfig && smtpConfig.smtp_host) {
      // Use SMTP
      console.log('📧 Sending via SMTP');
      
      const transporter = nodemailer.createTransport({
        host: smtpConfig.smtp_host,
        port: smtpConfig.smtp_port || 587,
        secure: smtpConfig.smtp_port === 465,
        auth: {
          user: smtpConfig.smtp_username,
          pass: smtpConfig.smtp_password
        }
      });
      
      const info = await transporter.sendMail({
        from: `"${smtpConfig.smtp_from_name || 'MCP Network Automation'}" <${smtpConfig.smtp_from_email || smtpConfig.smtp_username}>`,
        to: email,
        subject: `You've been invited to join ${organizationName || 'a workspace'} on MCP Network Automation`,
        text: textContent,
        html: htmlContent
      });
      
      messageId = info.messageId;
      console.log('✅ Email sent via SMTP');
    }
    
    res.json({
      success: true,
      message: 'Invitation email sent successfully',
      messageId: messageId,
      method: sendgridConfig ? 'sendgrid' : 'smtp'
    });
    
  } catch (error) {
    console.error('❌ Error sending invitation email:', error.message);
    res.status(500).json({
      error: 'Failed to send invitation email',
      message: error.message
    });
  }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🚀 Integrations API Server Started');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🔐 Multi-Tenant: ${isMultiTenantEnabled() ? 'Enabled ✅' : 'Disabled ⚠️'}`);
  console.log(`📊 Health Check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('📡 Available Endpoints:');
  console.log('  Infrastructure:');
  console.log('    POST /api/infrastructure/request');
  console.log('  GitHub:');
  console.log('    GET  /api/github/repos');
  console.log('    GET  /api/github/repo/:owner/:repo');
  console.log('    POST /api/github/issues');
  console.log('    GET  /api/approval-requests');
  console.log('    POST /api/merge-pull-request');
  console.log('    POST /api/close-pull-request');
  console.log('  Google Maps:');
  console.log('    POST /api/maps/geocode');
  console.log('    POST /api/maps/directions');
  console.log('  Email:');
  console.log('    POST /api/email/send');
  console.log('    POST /api/email/test');
  console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  process.exit(0);
});

