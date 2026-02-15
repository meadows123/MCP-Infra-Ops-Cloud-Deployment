/**
 * Integration Credentials Fetcher for Multi-Tenant MCP Servers (JavaScript/Node.js)
 * Fetches organization-specific API keys and credentials from Supabase
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class IntegrationFetcher {
  constructor(supabaseUrl = null, supabaseKey = null) {
    this.supabaseUrl = supabaseUrl || process.env.SUPABASE_URL;
    this.supabaseKey = supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.cacheDir = path.join(os.tmpdir(), 'mcp_integrations');
    this.cacheTTL = parseInt(process.env.INTEGRATION_CACHE_TTL || '300', 10) * 1000; // Convert to ms
    
    // Create cache directory if it doesn't exist
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    
    console.log(`IntegrationFetcher initialized with cache dir: ${this.cacheDir}`);
  }

  /**
   * Get integration configuration for an organization
   */
  async getIntegrationConfig(organizationId, integrationType, forceRefresh = false) {
    // Check cache first
    if (!forceRefresh) {
      const cached = this._getFromCache(organizationId, integrationType);
      if (cached) {
        console.log(`Using cached ${integrationType} config for org ${organizationId}`);
        return cached;
      }
    }

    // Fetch from Supabase
    console.log(`Fetching ${integrationType} config for organization ${organizationId}`);
    const config = await this._fetchFromSupabase(organizationId, integrationType);

    if (config) {
      this._saveToCache(organizationId, integrationType, config);
    }

    return config;
  }

  /**
   * Fetch integration config from Supabase
   */
  async _fetchFromSupabase(organizationId, integrationType) {
    if (!this.supabaseUrl || !this.supabaseKey) {
      console.warn('Supabase credentials not configured - using environment fallback');
      return this._getFromEnvironment(integrationType);
    }

    try {
      const url = `${this.supabaseUrl}/rest/v1/integrations?organization_id=eq.${organizationId}&integration_type=eq.${integrationType}&is_active=eq.true&select=config,last_tested_at,test_status`;
      
      const response = await fetch(url, {
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.error(`Failed to fetch ${integrationType} config: ${response.statusText}`);
        return this._getFromEnvironment(integrationType);
      }

      const data = await response.json();

      if (!data || data.length === 0) {
        console.log(`No ${integrationType} config found for org ${organizationId} - using fallback`);
        return this._getFromEnvironment(integrationType);
      }

      const integration = data[0];
      const config = integration.config || {};

      console.log(`✅ Fetched ${integrationType} config for org ${organizationId}`);
      return config;

    } catch (error) {
      console.error(`Error fetching ${integrationType} config:`, error.message);
      return this._getFromEnvironment(integrationType);
    }
  }

  /**
   * Get integration config from environment variables (fallback for testing)
   */
  _getFromEnvironment(integrationType) {
    console.log(`Loading ${integrationType} config from environment variables (fallback)`);

    const configs = {
      'github': {
        access_token: process.env.GITHUB_ACCESS_TOKEN,
        username: process.env.GITHUB_USERNAME,
        default_repo: process.env.GITHUB_DEFAULT_REPO
      },
      'google_maps': {
        api_key: process.env.GOOGLE_MAPS_API_KEY
      },
      'email_smtp': {
        smtp_host: process.env.SMTP_HOST || 'smtp.gmail.com',
        smtp_port: parseInt(process.env.SMTP_PORT || '587', 10),
        smtp_username: process.env.SMTP_USERNAME,
        smtp_password: process.env.SMTP_PASSWORD,
        smtp_from_email: process.env.SMTP_FROM_EMAIL,
        smtp_from_name: process.env.SMTP_FROM_NAME || 'Network Automation',
        use_tls: (process.env.SMTP_USE_TLS || 'true').toLowerCase() === 'true'
      },
      'email_sendgrid': {
        api_key: process.env.SENDGRID_API_KEY,
        from_email: process.env.SENDGRID_FROM_EMAIL,
        from_name: process.env.SENDGRID_FROM_NAME || 'Network Automation'
      },
      'slack': {
        bot_token: process.env.SLACK_BOT_TOKEN,
        webhook_url: process.env.SLACK_WEBHOOK_URL,
        default_channel: process.env.SLACK_DEFAULT_CHANNEL || '#network-alerts'
      },
      'servicenow': {
        instance_url: process.env.SERVICENOW_INSTANCE_URL,
        username: process.env.SERVICENOW_USERNAME,
        password: process.env.SERVICENOW_PASSWORD
      },
      'openai': {
        api_key: process.env.OPENAI_API_KEY,
        organization_id: process.env.OPENAI_ORG_ID,
        default_model: process.env.OPENAI_MODEL || 'gpt-4'
      },
      'anthropic': {
        api_key: process.env.ANTHROPIC_API_KEY,
        default_model: process.env.ANTHROPIC_MODEL || 'claude-3-opus-20240229'
      }
    };

    const config = configs[integrationType] || {};

    // Filter out null/undefined values
    const filteredConfig = Object.keys(config).reduce((acc, key) => {
      if (config[key] !== null && config[key] !== undefined) {
        acc[key] = config[key];
      }
      return acc;
    }, {});

    if (Object.keys(filteredConfig).length === 0) {
      console.warn(`No environment config found for ${integrationType}`);
      return null;
    }

    return filteredConfig;
  }

  /**
   * Get integration config from cache
   */
  _getFromCache(organizationId, integrationType) {
    const cacheFile = path.join(this.cacheDir, `${organizationId}_${integrationType}.json`);

    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    try {
      const stats = fs.statSync(cacheFile);
      const age = Date.now() - stats.mtimeMs;

      if (age > this.cacheTTL) {
        console.log(`Cache expired for ${integrationType} (org: ${organizationId})`);
        return null;
      }

      const data = fs.readFileSync(cacheFile, 'utf8');
      return JSON.parse(data);

    } catch (error) {
      console.warn(`Error reading cache for ${integrationType}:`, error.message);
      return null;
    }
  }

  /**
   * Save integration config to cache
   */
  _saveToCache(organizationId, integrationType, config) {
    try {
      const cacheFile = path.join(this.cacheDir, `${organizationId}_${integrationType}.json`);
      fs.writeFileSync(cacheFile, JSON.stringify(config, null, 2));
      console.log(`Cached ${integrationType} config for org ${organizationId}`);
    } catch (error) {
      console.warn(`Error caching ${integrationType} config:`, error.message);
    }
  }

  /**
   * Clear cached integration configs
   */
  clearCache(organizationId = null, integrationType = null) {
    try {
      if (organizationId && integrationType) {
        const cacheFile = path.join(this.cacheDir, `${organizationId}_${integrationType}.json`);
        if (fs.existsSync(cacheFile)) {
          fs.unlinkSync(cacheFile);
          console.log(`Cleared cache for ${integrationType} (org: ${organizationId})`);
        }
      } else if (organizationId) {
        const files = fs.readdirSync(this.cacheDir).filter(f => f.startsWith(`${organizationId}_`));
        files.forEach(f => fs.unlinkSync(path.join(this.cacheDir, f)));
        console.log(`Cleared all integration cache for org ${organizationId}`);
      } else if (integrationType) {
        const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith(`_${integrationType}.json`));
        files.forEach(f => fs.unlinkSync(path.join(this.cacheDir, f)));
        console.log(`Cleared ${integrationType} cache for all organizations`);
      } else {
        const files = fs.readdirSync(this.cacheDir);
        files.forEach(f => fs.unlinkSync(path.join(this.cacheDir, f)));
        console.log('Cleared all integration cache');
      }
    } catch (error) {
      console.error('Error clearing cache:', error.message);
    }
  }
}

// Singleton instance
let fetcherInstance = null;

function getFetcher() {
  if (!fetcherInstance) {
    fetcherInstance = new IntegrationFetcher();
  }
  return fetcherInstance;
}

async function getIntegrationConfig(organizationId, integrationType, forceRefresh = false) {
  const fetcher = getFetcher();
  return await fetcher.getIntegrationConfig(organizationId, integrationType, forceRefresh);
}

module.exports = {
  IntegrationFetcher,
  getFetcher,
  getIntegrationConfig
};

