#!/usr/bin/env python3
"""
Example: Multi-Tenant GitHub MCP Server
Shows how to integrate the integration_fetcher for organization-specific credentials
"""

import os
import sys
from flask import Flask, request, jsonify, g

# Add shared directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
from integration_fetcher import get_integration_config

app = Flask(__name__)

@app.before_request
def load_organization_credentials():
    """
    Middleware to load organization-specific GitHub credentials before each request
    Expects 'X-Organization-ID' header in requests
    
    Fallback behavior:
    1. If MULTI_TENANT_ENABLED=false → Always use environment variables
    2. If no X-Organization-ID header → Use environment variables
    3. If organization not found → Use environment variables
    """
    # Skip for health check
    if request.path == '/health':
        return
    
    # Check if multi-tenant mode is enabled (default: true)
    multi_tenant_enabled = os.getenv('MULTI_TENANT_ENABLED', 'true').lower() == 'true'
    
    if not multi_tenant_enabled:
        # Multi-tenant disabled - use environment variables
        g.github_config = {
            'access_token': os.getenv('GITHUB_ACCESS_TOKEN'),
            'username': os.getenv('GITHUB_USERNAME'),
            'default_repo': os.getenv('GITHUB_DEFAULT_REPO')
        }
        g.organization_id = 'default'
        print(f"🔧 Multi-tenant mode DISABLED - Using environment variables")
        return
    
    org_id = request.headers.get('X-Organization-ID')
    
    if not org_id:
        # No organization ID provided - use environment variables
        print("ℹ️ No X-Organization-ID header found - Using environment variables")
        g.github_config = {
            'access_token': os.getenv('GITHUB_ACCESS_TOKEN'),
            'username': os.getenv('GITHUB_USERNAME'),
            'default_repo': os.getenv('GITHUB_DEFAULT_REPO')
        }
        g.organization_id = 'default'
        return
    
    print(f"🏢 Loading GitHub credentials for organization: {org_id}")
    
    try:
        # Fetch organization-specific credentials
        config = get_integration_config(org_id, 'github')
        
        if config:
            g.github_config = config
            g.organization_id = org_id
            print(f"✅ Using organization-specific GitHub credentials")
        else:
            print(f"⚠️ Failed to fetch GitHub credentials for organization {org_id} - Using environment fallback")
            g.github_config = {
                'access_token': os.getenv('GITHUB_ACCESS_TOKEN'),
                'username': os.getenv('GITHUB_USERNAME'),
                'default_repo': os.getenv('GITHUB_DEFAULT_REPO')
            }
            g.organization_id = 'default'
    except Exception as e:
        print(f"❌ Error loading GitHub credentials for org {org_id}: {e}")
        print(f"↩️ Falling back to environment variables")
        g.github_config = {
            'access_token': os.getenv('GITHUB_ACCESS_TOKEN'),
            'username': os.getenv('GITHUB_USERNAME'),
            'default_repo': os.getenv('GITHUB_DEFAULT_REPO')
        }
        g.organization_id = 'default'


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "GitHub MCP Server (Multi-Tenant)",
        "multi_tenant": os.getenv('MULTI_TENANT_ENABLED', 'true').lower() == 'true'
    }), 200


@app.route('/repos/list', methods=['GET'])
def list_repos():
    """Example endpoint that uses organization-specific credentials"""
    try:
        # Get credentials from g context (set by middleware)
        github_config = getattr(g, 'github_config', {})
        org_id = getattr(g, 'organization_id', 'default')
        
        access_token = github_config.get('access_token')
        username = github_config.get('username')
        
        if not access_token:
            return jsonify({
                "error": "GitHub access token not configured",
                "organization_id": org_id
            }), 400
        
        # TODO: Use github_config to make API calls
        # For example:
        # import requests
        # headers = {
        #     'Authorization': f'Bearer {access_token}',
        #     'Accept': 'application/vnd.github.v3+json'
        # }
        # response = requests.get(f'https://api.github.com/users/{username}/repos', headers=headers)
        
        return jsonify({
            "status": "success",
            "message": "Using organization-specific credentials",
            "organization_id": org_id,
            "username": username
        }), 200
        
    except Exception as e:
        return jsonify({
            "error": str(e),
            "status": "error"
        }), 500


if __name__ == '__main__':
    port = int(os.getenv('PORT', 3000))
    print(f"🚀 Starting GitHub MCP Server (Multi-Tenant) on port {port}")
    print(f"📝 Multi-tenant mode: {os.getenv('MULTI_TENANT_ENABLED', 'true')}")
    app.run(host='0.0.0.0', port=port, debug=False)

