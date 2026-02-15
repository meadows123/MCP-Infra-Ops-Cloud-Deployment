#!/usr/bin/env python3
"""
Integration Credentials Fetcher for Multi-Tenant MCP Servers
Fetches organization-specific API keys and credentials from Supabase
"""

import os
import json
import logging
import requests
from typing import Optional, Dict, Any
from pathlib import Path
import tempfile
from datetime import datetime, timedelta

logger = logging.getLogger("IntegrationFetcher")


class IntegrationFetcher:
    """
    Fetches and manages organization-specific integration credentials
    """
    
    # Supported integration types
    INTEGRATION_TYPES = [
        'github',
        'google_maps',
        'email_smtp',
        'email_sendgrid',
        'slack',
        'servicenow',
        'openai',
        'anthropic'
    ]
    
    def __init__(self, supabase_url: str = None, supabase_key: str = None):
        """
        Initialize the integration fetcher
        
        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key (for server-side access)
        """
        self.supabase_url = supabase_url or os.getenv("SUPABASE_URL")
        self.supabase_key = supabase_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        self.cache_dir = Path(tempfile.gettempdir()) / "mcp_integrations"
        self.cache_dir.mkdir(exist_ok=True)
        self.cache_ttl = int(os.getenv('INTEGRATION_CACHE_TTL', 300))  # 5 minutes default
        
        logger.info(f"IntegrationFetcher initialized with cache dir: {self.cache_dir}")
    
    def get_integration_config(
        self, 
        organization_id: str, 
        integration_type: str,
        force_refresh: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        Get integration configuration for an organization
        
        Args:
            organization_id: The organization UUID
            integration_type: Type of integration (github, google_maps, etc.)
            force_refresh: Force fetch from database even if cached
            
        Returns:
            Integration config dictionary or None if not found/error
        """
        if integration_type not in self.INTEGRATION_TYPES:
            logger.error(f"Invalid integration type: {integration_type}")
            return None
        
        # Check cache first
        if not force_refresh:
            cached = self._get_from_cache(organization_id, integration_type)
            if cached:
                logger.info(f"Using cached {integration_type} config for org {organization_id}")
                return cached
        
        # Fetch from Supabase
        logger.info(f"Fetching {integration_type} config for organization {organization_id}")
        config = self._fetch_from_supabase(organization_id, integration_type)
        
        if config:
            self._save_to_cache(organization_id, integration_type, config)
        
        return config
    
    def _fetch_from_supabase(
        self, 
        organization_id: str, 
        integration_type: str
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch integration config from Supabase
        
        Args:
            organization_id: The organization UUID
            integration_type: Type of integration
            
        Returns:
            Integration config or None if error
        """
        if not self.supabase_url or not self.supabase_key:
            logger.warning("Supabase credentials not configured - using environment fallback")
            return self._get_from_environment(integration_type)
        
        try:
            response = requests.get(
                f"{self.supabase_url}/rest/v1/integrations",
                params={
                    "organization_id": f"eq.{organization_id}",
                    "integration_type": f"eq.{integration_type}",
                    "is_active": "eq.true",
                    "select": "config,last_tested_at,test_status"
                },
                headers={
                    "apikey": self.supabase_key,
                    "Authorization": f"Bearer {self.supabase_key}",
                    "Content-Type": "application/json"
                },
                timeout=10
            )
            
            if not response.ok:
                logger.error(f"Failed to fetch {integration_type} config: {response.text}")
                return self._get_from_environment(integration_type)
            
            data = response.json()
            
            if not data or len(data) == 0:
                logger.info(f"No {integration_type} config found for org {organization_id} - using fallback")
                return self._get_from_environment(integration_type)
            
            integration = data[0]
            config = integration.get('config', {})
            
            logger.info(f"✅ Fetched {integration_type} config for org {organization_id}")
            return config
            
        except Exception as e:
            logger.error(f"Error fetching {integration_type} config: {e}", exc_info=True)
            return self._get_from_environment(integration_type)
    
    def _get_from_environment(self, integration_type: str) -> Optional[Dict[str, Any]]:
        """
        Get integration config from environment variables (fallback for testing)
        
        Args:
            integration_type: Type of integration
            
        Returns:
            Integration config from environment or None
        """
        logger.info(f"Loading {integration_type} config from environment variables (fallback)")
        
        configs = {
            'github': {
                'access_token': os.getenv('GITHUB_ACCESS_TOKEN'),
                'username': os.getenv('GITHUB_USERNAME'),
                'default_repo': os.getenv('GITHUB_DEFAULT_REPO')
            },
            'google_maps': {
                'api_key': os.getenv('GOOGLE_MAPS_API_KEY'),
                'enabled_apis': ['geocoding', 'places', 'directions']
            },
            'email_smtp': {
                'smtp_host': os.getenv('SMTP_HOST', 'smtp.gmail.com'),
                'smtp_port': int(os.getenv('SMTP_PORT', 587)),
                'smtp_username': os.getenv('SMTP_USERNAME'),
                'smtp_password': os.getenv('SMTP_PASSWORD'),
                'smtp_from_email': os.getenv('SMTP_FROM_EMAIL'),
                'smtp_from_name': os.getenv('SMTP_FROM_NAME', 'Network Automation'),
                'use_tls': os.getenv('SMTP_USE_TLS', 'true').lower() == 'true'
            },
            'email_sendgrid': {
                'api_key': os.getenv('SENDGRID_API_KEY'),
                'from_email': os.getenv('SENDGRID_FROM_EMAIL'),
                'from_name': os.getenv('SENDGRID_FROM_NAME', 'Network Automation')
            },
            'slack': {
                'bot_token': os.getenv('SLACK_BOT_TOKEN'),
                'webhook_url': os.getenv('SLACK_WEBHOOK_URL'),
                'default_channel': os.getenv('SLACK_DEFAULT_CHANNEL', '#network-alerts')
            },
            'servicenow': {
                'instance_url': os.getenv('SERVICENOW_INSTANCE_URL'),
                'username': os.getenv('SERVICENOW_USERNAME'),
                'password': os.getenv('SERVICENOW_PASSWORD')
            },
            'openai': {
                'api_key': os.getenv('OPENAI_API_KEY'),
                'organization_id': os.getenv('OPENAI_ORG_ID'),
                'default_model': os.getenv('OPENAI_MODEL', 'gpt-4')
            },
            'anthropic': {
                'api_key': os.getenv('ANTHROPIC_API_KEY'),
                'default_model': os.getenv('ANTHROPIC_MODEL', 'claude-3-opus-20240229')
            }
        }
        
        config = configs.get(integration_type, {})
        
        # Filter out None values
        config = {k: v for k, v in config.items() if v is not None}
        
        if not config:
            logger.warning(f"No environment config found for {integration_type}")
            return None
        
        return config
    
    def _get_from_cache(
        self, 
        organization_id: str, 
        integration_type: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get integration config from cache
        
        Args:
            organization_id: Organization UUID
            integration_type: Type of integration
            
        Returns:
            Cached config or None if expired/missing
        """
        cache_file = self.cache_dir / f"{organization_id}_{integration_type}.json"
        
        if not cache_file.exists():
            return None
        
        try:
            # Check age
            age = datetime.now() - datetime.fromtimestamp(cache_file.stat().st_mtime)
            if age.total_seconds() > self.cache_ttl:
                logger.info(f"Cache expired for {integration_type} (org: {organization_id})")
                return None
            
            with open(cache_file, 'r') as f:
                config = json.load(f)
            
            return config
            
        except Exception as e:
            logger.warning(f"Error reading cache for {integration_type}: {e}")
            return None
    
    def _save_to_cache(
        self, 
        organization_id: str, 
        integration_type: str, 
        config: Dict[str, Any]
    ):
        """
        Save integration config to cache
        
        Args:
            organization_id: Organization UUID
            integration_type: Type of integration
            config: Configuration to cache
        """
        try:
            cache_file = self.cache_dir / f"{organization_id}_{integration_type}.json"
            
            with open(cache_file, 'w') as f:
                json.dump(config, f, indent=2)
            
            logger.info(f"Cached {integration_type} config for org {organization_id}")
            
        except Exception as e:
            logger.warning(f"Error caching {integration_type} config: {e}")
    
    def clear_cache(self, organization_id: str = None, integration_type: str = None):
        """
        Clear cached integration configs
        
        Args:
            organization_id: If provided, only clear this org's cache
            integration_type: If provided, only clear this integration type
        """
        try:
            if organization_id and integration_type:
                # Clear specific integration for specific org
                cache_file = self.cache_dir / f"{organization_id}_{integration_type}.json"
                if cache_file.exists():
                    cache_file.unlink()
                    logger.info(f"Cleared cache for {integration_type} (org: {organization_id})")
            elif organization_id:
                # Clear all integrations for specific org
                for file in self.cache_dir.glob(f"{organization_id}_*.json"):
                    file.unlink()
                logger.info(f"Cleared all integration cache for org {organization_id}")
            elif integration_type:
                # Clear specific integration for all orgs
                for file in self.cache_dir.glob(f"*_{integration_type}.json"):
                    file.unlink()
                logger.info(f"Cleared {integration_type} cache for all organizations")
            else:
                # Clear all cache
                for file in self.cache_dir.glob("*.json"):
                    file.unlink()
                logger.info("Cleared all integration cache")
        except Exception as e:
            logger.error(f"Error clearing cache: {e}")
    
    def test_integration(
        self, 
        organization_id: str, 
        integration_type: str
    ) -> Dict[str, Any]:
        """
        Test an integration to verify credentials work
        
        Args:
            organization_id: Organization UUID
            integration_type: Type of integration to test
            
        Returns:
            Test result dictionary
        """
        config = self.get_integration_config(organization_id, integration_type, force_refresh=True)
        
        if not config:
            return {
                'success': False,
                'error': f'No configuration found for {integration_type}',
                'integration_type': integration_type
            }
        
        # TODO: Implement actual integration tests
        # For now, just check if required fields are present
        
        required_fields = {
            'github': ['access_token'],
            'google_maps': ['api_key'],
            'email_smtp': ['smtp_host', 'smtp_username', 'smtp_password'],
            'email_sendgrid': ['api_key'],
            'slack': ['bot_token'],
            'servicenow': ['instance_url', 'username', 'password'],
            'openai': ['api_key'],
            'anthropic': ['api_key']
        }
        
        required = required_fields.get(integration_type, [])
        missing = [field for field in required if not config.get(field)]
        
        if missing:
            return {
                'success': False,
                'error': f'Missing required fields: {", ".join(missing)}',
                'integration_type': integration_type
            }
        
        return {
            'success': True,
            'message': f'{integration_type} configuration is valid',
            'integration_type': integration_type,
            'config_summary': {k: '***' if 'password' in k.lower() or 'token' in k.lower() or 'key' in k.lower() else v 
                              for k, v in config.items()}
        }


# Singleton instance
_fetcher_instance = None


def get_fetcher() -> IntegrationFetcher:
    """Get or create the global IntegrationFetcher instance"""
    global _fetcher_instance
    if _fetcher_instance is None:
        _fetcher_instance = IntegrationFetcher()
    return _fetcher_instance


def get_integration_config(
    organization_id: str, 
    integration_type: str,
    force_refresh: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Convenience function to get integration config
    
    Args:
        organization_id: Organization UUID
        integration_type: Type of integration
        force_refresh: Force fetch from database
        
    Returns:
        Integration config or None
    """
    fetcher = get_fetcher()
    return fetcher.get_integration_config(organization_id, integration_type, force_refresh)


if __name__ == "__main__":
    # Test the fetcher
    import sys
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 3:
        print("Usage: python integration_fetcher.py <organization_id> <integration_type>")
        print(f"Available integration types: {', '.join(IntegrationFetcher.INTEGRATION_TYPES)}")
        sys.exit(1)
    
    org_id = sys.argv[1]
    integration = sys.argv[2]
    
    config = get_integration_config(org_id, integration, force_refresh=True)
    
    if config:
        print(f"✅ Integration config for {integration}:")
        # Mask sensitive values
        masked_config = {k: '***' if any(s in k.lower() for s in ['password', 'token', 'key', 'secret']) else v 
                        for k, v in config.items()}
        print(json.dumps(masked_config, indent=2))
    else:
        print(f"❌ No config found for {integration}")
        sys.exit(1)

