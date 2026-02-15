const winston = require('winston');

class NetworkMonitor {
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'network-monitor' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    this.devices = new Map();
    this.subscribers = new Set();
    this.healthStatus = {
      overall: 'unknown',
      devices: {},
      lastCheck: null
    };
  }

  async initialize() {
    this.logger.info('Initializing Network Monitor');
    
    // Load initial device inventory
    await this.loadDeviceInventory();
    
    // Start monitoring
    this.startMonitoring();
  }

  async loadDeviceInventory() {
    try {
      // This would typically load from a configuration file or database
      // For now, we'll use sample data
      const sampleDevices = [
        {
          id: 'router-01',
          name: 'Core Router 01',
          type: 'router',
          ip: '192.168.1.1',
          status: 'online',
          model: 'Cisco ISR4321',
          location: 'Data Center A'
        },
        {
          id: 'switch-01',
          name: 'Access Switch 01',
          type: 'switch',
          ip: '192.168.1.2',
          status: 'online',
          model: 'Cisco Catalyst 2960',
          location: 'Floor 1'
        },
        {
          id: 'firewall-01',
          name: 'Perimeter Firewall',
          type: 'firewall',
          ip: '192.168.1.3',
          status: 'online',
          model: 'Cisco ASA 5510',
          location: 'DMZ'
        }
      ];

      sampleDevices.forEach(device => {
        this.devices.set(device.id, device);
      });

      this.logger.info(`Loaded ${sampleDevices.length} devices into inventory`);
    } catch (error) {
      this.logger.error('Error loading device inventory:', error);
    }
  }

  async getNetworkStatus() {
    return {
      overall: this.healthStatus.overall,
      devices: Array.from(this.devices.values()),
      lastCheck: this.healthStatus.lastCheck,
      summary: {
        total: this.devices.size,
        online: Array.from(this.devices.values()).filter(d => d.status === 'online').length,
        offline: Array.from(this.devices.values()).filter(d => d.status === 'offline').length,
        warning: Array.from(this.devices.values()).filter(d => d.status === 'warning').length
      }
    };
  }

  async getDevices() {
    return Array.from(this.devices.values());
  }

  async getDevice(deviceId) {
    return this.devices.get(deviceId);
  }

  async performHealthCheck() {
    this.logger.info('Performing network health check');
    
    const startTime = Date.now();
    let onlineCount = 0;
    let offlineCount = 0;
    let warningCount = 0;

    for (const [deviceId, device] of this.devices) {
      try {
        const status = await this.checkDeviceHealth(device);
        device.status = status;
        device.lastCheck = new Date().toISOString();
        
        switch (status) {
          case 'online':
            onlineCount++;
            break;
          case 'offline':
            offlineCount++;
            break;
          case 'warning':
            warningCount++;
            break;
        }

        this.healthStatus.devices[deviceId] = {
          status,
          responseTime: Date.now() - startTime,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        this.logger.error(`Error checking health for device ${deviceId}:`, error);
        device.status = 'offline';
        offlineCount++;
      }
    }

    // Determine overall status
    if (offlineCount === 0 && warningCount === 0) {
      this.healthStatus.overall = 'healthy';
    } else if (offlineCount === 0) {
      this.healthStatus.overall = 'warning';
    } else {
      this.healthStatus.overall = 'critical';
    }

    this.healthStatus.lastCheck = new Date().toISOString();

    // Notify subscribers
    this.notifySubscribers({
      type: 'health_check_complete',
      data: {
        overall: this.healthStatus.overall,
        summary: {
          total: this.devices.size,
          online: onlineCount,
          offline: offlineCount,
          warning: warningCount
        },
        timestamp: this.healthStatus.lastCheck
      }
    });

    this.logger.info(`Health check complete: ${onlineCount} online, ${offlineCount} offline, ${warningCount} warning`);
  }

  async checkDeviceHealth(device) {
    // This would typically use the pyATS MCP server to check device health
    // For now, we'll simulate the health check
    
    try {
      // Simulate ping/connectivity test
      const isReachable = await this.simulatePing(device.ip);
      
      if (!isReachable) {
        return 'offline';
      }

      // Simulate additional health checks
      const healthScore = Math.random();
      
      if (healthScore > 0.8) {
        return 'online';
      } else if (healthScore > 0.5) {
        return 'warning';
      } else {
        return 'offline';
      }
    } catch (error) {
      this.logger.error(`Error checking health for ${device.name}:`, error);
      return 'offline';
    }
  }

  async simulatePing(ip) {
    // Simulate network ping with some randomness
    return new Promise((resolve) => {
      setTimeout(() => {
        // 95% success rate for simulation
        resolve(Math.random() > 0.05);
      }, Math.random() * 1000 + 100); // 100-1100ms response time
    });
  }

  async executeCommand(deviceId, command) {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    this.logger.info(`Executing command on ${device.name}: ${command}`);

    // This would typically use the pyATS MCP server to execute commands
    // For now, we'll simulate the command execution
    
    const result = {
      deviceId,
      command,
      output: `Simulated output for command: ${command}`,
      timestamp: new Date().toISOString(),
      success: true
    };

    return result;
  }

  async getDeviceConfiguration(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    this.logger.info(`Getting configuration for ${device.name}`);

    // This would typically use the pyATS MCP server to get device config
    // For now, we'll simulate the configuration retrieval
    
    const config = {
      deviceId,
      hostname: device.name,
      interfaces: [
        { name: 'GigabitEthernet0/0', ip: '192.168.1.1', status: 'up' },
        { name: 'GigabitEthernet0/1', ip: '10.0.0.1', status: 'up' }
      ],
      routing: {
        ospf: { enabled: true, area: 0 },
        bgp: { enabled: false }
      },
      timestamp: new Date().toISOString()
    };

    return config;
  }

  subscribe(websocket) {
    this.subscribers.add(websocket);
    this.logger.info('New subscriber added to network monitor');
  }

  unsubscribe(websocket) {
    this.subscribers.delete(websocket);
    this.logger.info('Subscriber removed from network monitor');
  }

  notifySubscribers(data) {
    this.subscribers.forEach(ws => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(JSON.stringify(data));
        } catch (error) {
          this.logger.error('Error sending to subscriber:', error);
          this.subscribers.delete(ws);
        }
      } else {
        this.subscribers.delete(ws);
      }
    });
  }

  startMonitoring() {
    // Start periodic health checks
    setInterval(() => {
      this.performHealthCheck();
    }, 30000); // Every 30 seconds

    this.logger.info('Network monitoring started');
  }

  isHealthy() {
    return this.healthStatus.overall === 'healthy' || this.healthStatus.overall === 'warning';
  }
}

module.exports = NetworkMonitor; 