#!/usr/bin/env python3
"""
Dynamic Device Registry - Auto-discovers devices from testbed.yaml
Provides autonomous routing based on device metadata without hardcoding device names
"""

import yaml
import logging
import os
from typing import Dict, List, Set, Optional, Tuple, Iterable

logger = logging.getLogger("DeviceRegistry")

class DeviceRegistry:
    """
    Autonomously manages device discovery and routing
    Reads from testbed.yaml and provides vendor-aware routing
    """
    
    def __init__(self, testbed_path: str = None, vendor_tag_path: str = None):
        self.testbed_path = testbed_path or os.getenv("PYATS_TESTBED_PATH", "/app/testbed.yaml")
        default_vendor_tag_file = os.path.join(os.path.dirname(__file__), "vendor_tags.yaml")
        self.vendor_tag_path = vendor_tag_path or os.getenv("DEVICE_VENDOR_TAG_FILE", default_vendor_tag_file)
        self.devices: Dict[str, Dict] = {}
        self.vendor_to_devices: Dict[str, List[str]] = {}
        self.platform_to_vendor: Dict[str, str] = {}
        self.vendor_stack_map: Dict[str, str] = self._load_vendor_stack_map()
        self.load_devices()
    
    def _load_vendor_stack_map(self) -> Dict[str, str]:
        """Load vendor -> automation stack mapping from vendor_tags.yaml."""
        default_map = {
            "cisco": "pyats",
            "linux": "ansible",
            "windows": "ansible",
            "juniper": "ansible",
            "hpe": "ansible",
            "meraki": "ansible",
            "azure": "ansible",
        }

        try:
            if not self.vendor_tag_path or not os.path.exists(self.vendor_tag_path):
                logger.warning(f"⚠️ Vendor tag file not found, using defaults: {self.vendor_tag_path}")
                return default_map

            with open(self.vendor_tag_path, "r") as f:
                config = yaml.safe_load(f) or {}

            stacks = config.get("stacks", {})
            vendor_stack_map = dict(default_map)

            for stack_name, stack_details in stacks.items():
                vendors = stack_details.get("vendors", []) if isinstance(stack_details, dict) else []
                for vendor in vendors:
                    vendor_key = str(vendor).strip().lower()
                    if vendor_key:
                        vendor_stack_map[vendor_key] = stack_name

            logger.info(f"🏷️ Loaded vendor tag configuration: {vendor_stack_map}")
            return vendor_stack_map
        except Exception as exc:
            logger.error(f"❌ Failed to load vendor tag file {self.vendor_tag_path}: {exc}")
            return default_map

    def load_devices(self):
        """Load devices from testbed.yaml and build registry"""
        try:
            with open(self.testbed_path, 'r') as f:
                testbed = yaml.safe_load(f)
            
            if not testbed or 'devices' not in testbed:
                logger.warning(f"No devices found in testbed {self.testbed_path}")
                return
            
            for device_name, device_config in testbed['devices'].items():
                self.register_device(device_name, device_config)
            
            logger.info(f"✅ Loaded {len(self.devices)} devices from testbed")
            logger.info(f"📋 Device registry: {self.get_summary()}")
            
        except FileNotFoundError:
            logger.error(f"❌ Testbed file not found: {self.testbed_path}")
        except Exception as e:
            logger.error(f"❌ Failed to load testbed: {e}")
    
    def register_device(self, device_name: str, device_config: Dict):
        """Register a device in the registry"""
        platform = device_config.get('platform', 'unknown').lower()
        os_type = device_config.get('os', 'unknown').lower()
        
        # Determine vendor based on platform and OS
        vendor = self._detect_vendor(platform, os_type, device_name)
        
        # Store device info
        self.devices[device_name] = {
            'name': device_name,
            'vendor': vendor,
            'platform': platform,
            'os': os_type,
            'type': device_config.get('type', 'unknown'),
            'alias': device_config.get('alias', ''),
            'ip': device_config.get('connections', {}).get('cli', {}).get('ip', 'unknown')
        }
        
        # Build vendor-to-devices mapping
        if vendor not in self.vendor_to_devices:
            self.vendor_to_devices[vendor] = []
        self.vendor_to_devices[vendor].append(device_name)
        
        # Build platform-to-vendor mapping
        if platform not in self.platform_to_vendor:
            self.platform_to_vendor[platform] = vendor
        
        logger.debug(f"📍 Registered device {device_name}: vendor={vendor}, platform={platform}, os={os_type}")
    
    def get_stack_for_vendor(self, vendor: Optional[str]) -> str:
        """Return the automation stack responsible for the given vendor."""
        if not vendor:
            return "pyats"
        return self.vendor_stack_map.get(vendor.lower(), "pyats")

    def get_stack_for_device(self, device_name: str) -> str:
        """Return the automation stack for a specific device."""
        vendor = self.get_device_vendor(device_name)
        return self.get_stack_for_vendor(vendor)

    def categorize_devices_by_stack(self, device_names: Optional[Iterable[str]]) -> Dict[str, List[str]]:
        """Split a list of devices into automation stacks (pyATS vs Ansible)."""
        categorized: Dict[str, List[str]] = {}
        if not device_names:
            return categorized

        for device_name in device_names:
            if not device_name:
                continue
            stack = self.get_stack_for_device(device_name)
            categorized.setdefault(stack, []).append(device_name)

        return categorized

    def _detect_vendor(self, platform: str, os_type: str, device_name: str) -> str:
        """Autonomously detect vendor from platform and OS type"""
        # Juniper detection
        if any(x in platform for x in ['junos', 'juniper', 'vsrx', 'srx', 'mx', 'ex']):
            return 'juniper'
        if 'junos' in os_type:
            return 'juniper'
        
        # Cisco detection
        if any(x in platform for x in ['ios', 'iosxe', 'iosxr', 'csr', 'nxos', 'cisco']):
            return 'cisco'
        if 'ios' in os_type or 'iosxe' in os_type:
            return 'cisco'
        
        # HPE/Comware detection
        if any(x in platform for x in ['comware', 'hpe', 'hp']):
            return 'hpe'
        if 'comware' in os_type:
            return 'hpe'
        
        # Meraki detection
        if 'meraki' in platform or 'meraki' in os_type:
            return 'meraki'
        
        # Linux detection
        if any(x in platform for x in ['ubuntu', 'linux', 'debian', 'centos', 'rhel']):
            return 'linux'
        if any(x in os_type for x in ['linux', 'ubuntu', 'debian', 'centos', 'rhel']):
            return 'linux'
        
        # Windows detection
        if any(x in platform for x in ['windows', 'winrm']):
            return 'windows'
        if 'windows' in os_type:
            return 'windows'
        
        # Default: use device type if available
        if device_name:
            if 'router' in device_name.lower():
                return 'cisco'
            if 'switch' in device_name.lower():
                return 'cisco'
            if 'firewall' in device_name.lower() or 'srx' in device_name.lower():
                return 'juniper'
            if 'vm' in device_name.lower() or 'host' in device_name.lower():
                return 'linux'
        
        return 'unknown'
    
    def get_summary(self) -> str:
        """Get a summary of the device registry"""
        summary = {}
        for vendor, devices in self.vendor_to_devices.items():
            summary[vendor] = devices
        return summary
    
    def get_devices_by_vendor(self, vendor: str) -> List[str]:
        """Get all devices for a specific vendor"""
        return self.vendor_to_devices.get(vendor.lower(), [])
    
    def get_device_info(self, device_name: str) -> Optional[Dict]:
        """Get information about a specific device"""
        return self.devices.get(device_name)
    
    def get_device_vendor(self, device_name: str) -> Optional[str]:
        """Get the vendor for a specific device"""
        device = self.devices.get(device_name)
        return device['vendor'] if device else None
    
    def extract_devices_from_text(self, text: str) -> List[str]:
        """Extract device names mentioned in text (case-insensitive)"""
        text_lower = text.lower()
        mentioned_devices = []
        
        for device_name in self.devices.keys():
            if device_name.lower() in text_lower:
                if device_name not in mentioned_devices:
                    mentioned_devices.append(device_name)
        
        return mentioned_devices
    
    def get_vendor_from_keywords(self, text: str) -> Optional[str]:
        """Detect vendor from keywords in text (fallback if no specific device mentioned)"""
        text_lower = text.lower()
        
        # Check for vendor-specific keywords
        if any(x in text_lower for x in ['junos', 'juniper', 'vsrx', 'srx']):
            return 'juniper'
        if any(x in text_lower for x in ['cisco', 'ios', 'iosxe']):
            return 'cisco'
        if any(x in text_lower for x in ['comware', 'hpe']):
            return 'hpe'
        if any(x in text_lower for x in ['meraki']):
            return 'meraki'
        if any(x in text_lower for x in ['linux', 'ubuntu', 'bash', 'uname']):
            return 'linux'
        if any(x in text_lower for x in ['windows', 'powershell', 'Get-']):
            return 'windows'
        
        return None
    
    def is_vendor_request(self, mentioned_devices: List[str], vendor: str) -> bool:
        """Check if mentioned devices belong to a specific vendor"""
        if not mentioned_devices:
            return False
        
        vendor_devices = self.get_devices_by_vendor(vendor)
        return all(dev in vendor_devices for dev in mentioned_devices)
    
    def should_skip_vendor(self, mentioned_devices: List[str], vendor: str) -> bool:
        """Check if we should skip routing to a vendor based on mentioned devices"""
        if not mentioned_devices:
            # No specific devices mentioned - don't skip, use vendor keywords
            return False
        
        # Skip this vendor if user explicitly mentioned devices from OTHER vendors only
        vendor_devices = self.get_devices_by_vendor(vendor)
        user_devices_vendors = set(self.get_device_vendor(dev) for dev in mentioned_devices if dev in self.devices)
        
        # Skip if user only mentioned devices from vendors that don't include this one
        return vendor not in user_devices_vendors
    
    def get_routing_path(self, text: str) -> Tuple[Optional[List[str]], Optional[str]]:
        """
        Autonomously determine routing: (devices, vendor)
        Returns: (device_list, vendor) or (None, vendor_keyword) or (None, None)
        """
        mentioned_devices = self.extract_devices_from_text(text)
        vendor_keyword = self.get_vendor_from_keywords(text)
        
        if mentioned_devices:
            # Specific devices mentioned - route to them
            vendors = set(self.get_device_vendor(dev) for dev in mentioned_devices if dev in self.devices)
            primary_vendor = vendors.pop() if vendors else None
            logger.info(f"🎯 [AUTO-ROUTE] Specific devices: {mentioned_devices}, vendors: {vendors}")
            return (mentioned_devices, primary_vendor)
        elif vendor_keyword:
            # Vendor keywords detected but no specific devices
            logger.info(f"🎯 [AUTO-ROUTE] Vendor keyword detected: {vendor_keyword}")
            return (None, vendor_keyword)
        else:
            # No clear routing info
            logger.info(f"🎯 [AUTO-ROUTE] No specific routing detected")
            return (None, None)


# Global registry instance
_global_registry: Optional[DeviceRegistry] = None

def get_device_registry(testbed_path: str = None) -> DeviceRegistry:
    """Get or create the global device registry"""
    global _global_registry
    if _global_registry is None:
        _global_registry = DeviceRegistry(testbed_path)
    return _global_registry

def reload_device_registry(testbed_path: str = None):
    """Reload the device registry (useful if testbed changes)"""
    global _global_registry
    _global_registry = DeviceRegistry(testbed_path)
    return _global_registry
