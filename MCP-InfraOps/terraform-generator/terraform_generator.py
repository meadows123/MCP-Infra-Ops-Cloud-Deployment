#!/usr/bin/env python3
"""
Terraform Infrastructure Code Generator
Parses natural language requests and generates Terraform code
"""

import re
import json
from typing import Dict, List, Optional, Tuple


class TerraformGenerator:
    """Generate Terraform code from natural language infrastructure requests"""
    
    # Regex patterns for parameter extraction
    PATTERNS = {
        'ram': r'(\d+)\s*(?:gb|giga|gigabyte)(?:\s+ram)?',
        'region': r'(?:region|location).*?(?:south[\-\s]?east|southeast|south[\-\s]?east|east|west|north|central|eastus2?|westus2?)',
        'ip_address': r'(?:internal\s+)?ip\s+(?:address|of)\s+(?:10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)',
        'vm_name': r'(?:name|called)\s+(?:of\s+)?([a-z0-9\-]+)',
        'os': r'(?:ubuntu|windows|centos|debian|rhel|linux)',
        'disk_size': r'(\d+)\s*(?:gb|giga|gigabyte)(?:\s+disk)',
        'resource_name': r'(?:called|named|name)\s+([A-Za-z0-9\-_]+)',
        'cidr': r'(?:subnet|cidr|range|address\s+space|address_space)\s+(?:of\s+)?(\d+\.\d+\.\d+\.\d+/\d+)',
        'vnet_name': r'(?:vnet|virtual\s+network)\s+(?:called|named)\s+([A-Za-z0-9\-_]+)',
        'firewall_name': r'(?:firewall|fw)\s+(?:called|named)\s+([A-Za-z0-9\-_]+)',
        'route_table_name': r'(?:route\s+table|routing\s+table)\s+(?:called|named)\s+([A-Za-z0-9\-_]+)',
        'nsg_name': r'(?:security\s+group|nsg|network\s+security\s+group)\s+(?:called|named)\s+([A-Za-z0-9\-_]+)',
    }
    
    # Region mappings
    AZURE_REGIONS = {
        'southeast': 'Southeast Asia',
        'south-east': 'Southeast Asia',
        'eastus': 'East US',
        'westus': 'West US',
        'eastus2': 'East US 2',
        'westus2': 'West US 2',
        'centralus': 'Central US',
        'northeurope': 'North Europe',
        'westeurope': 'West Europe',
    }
    
    # VM size mappings (Azure SKUs)
    AZURE_VM_SIZES = {
        '2': 'Standard_B2s',      # 2GB RAM
        '4': 'Standard_D2s_v3',   # 4GB RAM
        '8': 'Standard_D4s_v3',   # 8GB RAM
        '16': 'Standard_D8s_v3',  # 16GB RAM
        '32': 'Standard_D16s_v3', # 32GB RAM
    }
    
    def __init__(self, request: str, project_name: str, environment: str = 'dev'):
        """Initialize the Terraform generator"""
        self.request = request.lower()
        self.original_request = request  # Keep original for name extraction
        self.project_name = project_name
        self.environment = environment
        self.parameters = {}
        self.resource_type = None
        self.resource_types = []  # Support multiple resource types
        self._detect_resource_types()
        self._extract_parameters()
    
    def _detect_resource_types(self):
        """Detect ALL types of Azure resources being requested (supports multi-resource)"""
        request_lower = self.request
        
        # Check for specific resource types in order of priority
        resource_keywords = {
            'firewall': ['firewall', 'fw', 'azure firewall'],
            'vnet': ['vnet', 'virtual network', 'create.*network', 'create.*vnet'],
            'route_table': ['route table', 'routing table', 'route.*table'],
            'nsg': ['security group', 'nsg', 'network security group'],
            'subnet': ['create.*subnet'],  # Only match explicit subnet creation
            'storage_account': ['storage account', 'storage', 'blob storage'],
            'load_balancer': ['load balancer', 'load balancing'],
            'nic': ['network interface', 'nic', 'network adapter'],
            'public_ip': ['public ip', 'public ip address', 'public.*ip'],
            'vm': ['vm', 'virtual machine', 'instance', 'server'],
        }
        
        # Find ALL resource types mentioned
        all_found_types = set()
        matches = []
        
        for resource_type, keywords in resource_keywords.items():
            for keyword in keywords:
                if keyword in request_lower:
                    all_found_types.add(resource_type)
                    # Find FIRST occurrence for ordering
                    if '*' in keyword:
                        import re as re_module
                        match = re_module.search(keyword, request_lower)
                        if match:
                            pos = match.start()
                            matches.append((pos, resource_type))
                    else:
                        pos = request_lower.find(keyword)  # FIRST occurrence
                        if pos >= 0:
                            matches.append((pos, resource_type))
                    break  # Found this type, move to next
        
        # Sort by position (order of mention)
        matches.sort()
        
        # For multi-resource requests like "firewall AND vnet", generate both
        # Priority: if both firewall and vnet mentioned, generate firewall first, then vnet
        if 'firewall' in all_found_types and 'vnet' in all_found_types:
            self.resource_types = ['firewall', 'vnet']
            self.resource_type = 'firewall+vnet'  # Composite type
        elif matches:
            # Filter out subnet unless it's the only explicit request
            primary_types = [t for t in [m[1] for m in matches] if t != 'subnet']
            if primary_types:
                self.resource_types = primary_types
                self.resource_type = primary_types[0]  # Primary is first mentioned
            elif 'subnet' in all_found_types:
                self.resource_types = ['subnet']
                self.resource_type = 'subnet'
        else:
            # Default to VM if nothing detected
            self.resource_types = ['vm']
            self.resource_type = 'vm'
        
        self.parameters['resource_type'] = self.resource_type
        self.parameters['resource_types'] = self.resource_types
    
    def _extract_parameters(self):
        """Extract infrastructure parameters from the request"""
        # Extract resource-specific names (case-insensitive search, preserving original case)
        
        # Handle composite types (firewall+vnet)
        if self.resource_type == 'firewall+vnet' or 'firewall' in self.resource_types:
            fw_match = re.search(r'firewall\s+(?:called|named)\s+([A-Za-z0-9\-_]+)', self.original_request, re.IGNORECASE)
            if fw_match:
                self.parameters['firewall_name'] = fw_match.group(1)
            else:
                fw_match = re.search(r'(?:called|named)\s+([A-Za-z0-9\-_]+).*?firewall', self.original_request, re.IGNORECASE)
                if fw_match:
                    self.parameters['firewall_name'] = fw_match.group(1)
                else:
                    self.parameters['firewall_name'] = f"{self.environment}-firewall"
        
        if self.resource_type == 'firewall+vnet' or self.resource_type == 'vnet' or 'vnet' in self.resource_types:
            vnet_match = re.search(r'vnet\s+(?:called|named)\s+([A-Za-z0-9\-_]+)', self.original_request, re.IGNORECASE)
            if vnet_match:
                self.parameters['vnet_name'] = vnet_match.group(1)
            else:
                vnet_match = re.search(r'(?:called|named)\s+([A-Za-z0-9\-_]+).*?vnet', self.original_request, re.IGNORECASE)
                if vnet_match:
                    self.parameters['vnet_name'] = vnet_match.group(1)
                else:
                    self.parameters['vnet_name'] = f"{self.environment}-vnet"
        
        elif self.resource_type == 'subnet':
            subnet_match = re.search(r'subnet\s+(?:called|named)\s+([A-Za-z0-9\-_]+)', self.original_request, re.IGNORECASE)
            if subnet_match:
                self.parameters['subnet_name'] = subnet_match.group(1)
            else:
                self.parameters['subnet_name'] = f"{self.environment}-subnet"
        
        elif self.resource_type == 'route_table':
            rt_match = re.search(r'route\s+table\s+(?:called|named)\s+([A-Za-z0-9\-_]+)', self.original_request, re.IGNORECASE)
            if rt_match:
                self.parameters['route_table_name'] = rt_match.group(1)
            else:
                self.parameters['route_table_name'] = f"{self.environment}-route-table"
        
        elif self.resource_type == 'nsg':
            nsg_match = re.search(r'(?:security\s+group|nsg)\s+(?:called|named)\s+([A-Za-z0-9\-_]+)', self.original_request, re.IGNORECASE)
            if nsg_match:
                self.parameters['nsg_name'] = nsg_match.group(1)
            else:
                self.parameters['nsg_name'] = f"{self.environment}-nsg"
        
        # Extract CIDR blocks (for VNets, subnets)
        cidr_match = re.search(r'(\d+\.\d+\.\d+\.\d+/\d+)', self.request)
        if cidr_match:
            cidr_found = cidr_match.group(1)
            self.parameters['cidr_block'] = cidr_found
            
            # For VNet+Subnet scenarios, if we get a /24, make VNet /16 and Subnet /24
            if (self.resource_type == 'vnet' or self.resource_type == 'firewall+vnet') and '/24' in cidr_found:
                # Convert subnet CIDR like 10.10.0.0/24 to VNet CIDR like 10.10.0.0/16
                octets = cidr_found.split('/')[0].split('.')
                vnet_cidr = f"{octets[0]}.{octets[1]}.0.0/16"
                self.parameters['vnet_cidr'] = vnet_cidr
                self.parameters['subnet_address_prefix'] = cidr_found
            else:
                self.parameters['subnet_address_prefix'] = cidr_found
        else:
            # Extract range from pattern like "subnet of 10.10.0.0/24"
            range_match = re.search(r'subnet\s+(?:of|:)?\s*(\d+\.\d+\.\d+\.\d+/\d+)', self.original_request, re.IGNORECASE)
            if range_match:
                cidr_found = range_match.group(1)
                self.parameters['cidr_block'] = cidr_found
                self.parameters['subnet_address_prefix'] = cidr_found
                # Also apply vnet_cidr conversion for firewall+vnet type
                if self.resource_type == 'firewall+vnet' and '/24' in cidr_found:
                    octets = cidr_found.split('/')[0].split('.')
                    vnet_cidr = f"{octets[0]}.{octets[1]}.0.0/16"
                    self.parameters['vnet_cidr'] = vnet_cidr
            else:
                self.parameters['cidr_block'] = '10.0.0.0/16'
                self.parameters['subnet_address_prefix'] = '10.0.1.0/24'
        
        # Extract RAM
        ram_match = re.search(self.PATTERNS['ram'], self.request, re.IGNORECASE)
        if ram_match:
            self.parameters['ram_gb'] = int(ram_match.group(1))
        else:
            self.parameters['ram_gb'] = 4  # Default to 4GB
        
        # Extract region
        region_match = re.search(self.PATTERNS['region'], self.request, re.IGNORECASE)
        if region_match:
            region_lower = region_match.group(0).lower().replace(' ', '-')
            for key, azure_region in self.AZURE_REGIONS.items():
                if key in region_lower:
                    self.parameters['region'] = azure_region
                    self.parameters['region_code'] = key
                    break
        
        if 'region' not in self.parameters:
            self.parameters['region'] = 'West US'
            self.parameters['region_code'] = 'westus'
        
        # Extract IP address
        ip_match = re.search(self.PATTERNS['ip_address'], self.request, re.IGNORECASE)
        if ip_match:
            self.parameters['private_ip'] = ip_match.group(0).split()[-1]
        else:
            self.parameters['private_ip'] = '10.0.1.20'  # Default
        
        # Extract OS
        os_match = re.search(self.PATTERNS['os'], self.request, re.IGNORECASE)
        if os_match:
            os_type = os_match.group(0).lower()
            if 'windows' in os_type:
                self.parameters['os'] = 'windows'
            else:
                self.parameters['os'] = 'linux'
        else:
            self.parameters['os'] = 'linux'  # Default to Linux
        
        # Extract disk size
        disk_match = re.search(self.PATTERNS['disk_size'], self.request, re.IGNORECASE)
        if disk_match:
            self.parameters['disk_size_gb'] = int(disk_match.group(1))
        else:
            self.parameters['disk_size_gb'] = 100  # Default to 100GB
        
        # Determine VM size based on RAM
        ram_str = str(self.parameters['ram_gb'])
        self.parameters['vm_size'] = self.AZURE_VM_SIZES.get(ram_str, 'Standard_D4s_v3')
    
    def generate_variables_tf(self) -> str:
        """Generate variables.tf file"""
        return f'''variable "environment" {{
  description = "Environment name"
  type        = string
  default     = "{self.environment}"
}}

variable "project_name" {{
  description = "Project name"
  type        = string
  default     = "{self.project_name}"
}}

variable "location" {{
  description = "Azure region"
  type        = string
  default     = "{self.parameters['region']}"
}}

variable "vnet_address_space" {{
  description = "VNET address space"
  type        = list(string)
  default     = ["10.0.0.0/16"]
}}

variable "subnet_address_prefix" {{
  description = "Subnet address prefix"
  type        = string
  default     = "10.0.1.0/24"
}}

variable "private_ip_address" {{
  description = "Private IP address for VM NIC"
  type        = string
  default     = "{self.parameters['private_ip']}"
}}

variable "vm_size" {{
  description = "VM size"
  type        = string
  default     = "{self.parameters['vm_size']}"
}}

variable "disk_size_gb" {{
  description = "OS disk size in GB"
  type        = number
  default     = {self.parameters['disk_size_gb']}
}}
'''
    
    def generate_main_tf(self) -> str:
        """Generate main.tf file with resources based on detected resource type"""
        
        # Always start with resource group
        content = f'''# Resource Group
resource "azurerm_resource_group" "rg" {{
  name     = "${{var.environment}}-${{var.project_name}}-rg"
  location = var.location

  tags = {{
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "Terraform"
  }}
}}

'''
        
        # Handle composite resource types (e.g., firewall+vnet)
        if self.resource_type == 'firewall+vnet':
            # Generate both firewall AND vnet
            firewall_name = self.parameters.get('firewall_name', f'{self.environment}-firewall')
            vnet_name = self.parameters.get('vnet_name', f'{self.environment}-vnet')
            vnet_cidr = self.parameters.get('vnet_cidr') or self.parameters.get('cidr_block', '10.0.0.0/16')
            subnet_cidr = self.parameters.get('subnet_address_prefix', '10.0.1.0/24')
            
            content += f'''
# Azure Firewall
resource "azurerm_firewall" "fw" {{
  name                = "{firewall_name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku_name            = "AZFW_VNet"
  sku_tier            = "Standard"

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}

# Virtual Network
resource "azurerm_virtual_network" "vnet" {{
  name                = "{vnet_name}"
  address_space       = ["{vnet_cidr}"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}

# Subnet
resource "azurerm_subnet" "subnet" {{
  name                 = "{self.environment}-subnet"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["{subnet_cidr}"]
}}
'''
            return content
        
        # Generate resources based on detected type
        if self.resource_type == 'firewall':
            firewall_name = self.parameters.get('firewall_name', f'{self.environment}-firewall')
            content += f'''
# Azure Firewall
resource "azurerm_firewall" "fw" {{
  name                = "{firewall_name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku_name            = "AZFW_VNet"
  sku_tier            = "Standard"

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}
'''
        
        elif self.resource_type == 'vnet':
            vnet_name = self.parameters.get('vnet_name', f'{self.environment}-vnet')
            # Use vnet_cidr if available (e.g., 10.10.0.0/16 for a /24 subnet), otherwise use cidr_block
            cidr = self.parameters.get('vnet_cidr') or self.parameters.get('cidr_block', '10.0.0.0/16')
            subnet_cidr = self.parameters.get('subnet_address_prefix', '10.0.1.0/24')
            
            content += f'''
# Virtual Network
resource "azurerm_virtual_network" "vnet" {{
  name                = "{vnet_name}"
  address_space       = ["{cidr}"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}

# Subnet
resource "azurerm_subnet" "subnet" {{
  name                 = "{self.environment}-subnet"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["{subnet_cidr}"]
}}
'''
        
        elif self.resource_type == 'subnet':
            subnet_name = self.parameters.get('subnet_name', f'{self.environment}-subnet')
            subnet_cidr = self.parameters.get('subnet_address_prefix', '10.0.1.0/24')
            
            content += f'''
# Virtual Network (required for subnet)
resource "azurerm_virtual_network" "vnet" {{
  name                = "{self.environment}-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}

# Subnet
resource "azurerm_subnet" "subnet" {{
  name                 = "{subnet_name}"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["{subnet_cidr}"]
}}
'''
        
        elif self.resource_type == 'route_table':
            rt_name = self.parameters.get('route_table_name', f'{self.environment}-route-table')
            
            content += f'''
# Route Table
resource "azurerm_route_table" "rt" {{
  name                = "{rt_name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}

# Example route (modify as needed)
resource "azurerm_route" "example_route" {{
  name                = "default-route"
  resource_group_name = azurerm_resource_group.rg.name
  route_table_name    = azurerm_route_table.rt.name
  address_prefix      = "0.0.0.0/0"
  next_hop_type       = "Internet"
}}
'''
        
        elif self.resource_type == 'nsg':
            nsg_name = self.parameters.get('nsg_name', f'{self.environment}-nsg')
            
            content += f'''
# Network Security Group
resource "azurerm_network_security_group" "nsg" {{
  name                = "{nsg_name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  security_rule {{
    name                       = "AllowSSH"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }}

  security_rule {{
    name                       = "AllowRDP"
    priority                   = 101
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3389"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }}

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}
'''
        
        else:  # Default to VM for backward compatibility
            if self.parameters['os'] == 'windows':
                image_publisher = "MicrosoftWindowsServer"
                image_offer = "WindowsServer"
                image_sku = "2019-Datacenter"
                os_profile = '''
  os_profile {
    computer_name  = "${{var.environment}}-${{var.project_name}}-vm"
    admin_username = "azureuser"
    admin_password = random_password.vm_password.result
  }

  os_profile_windows_config {
    enable_automatic_updates = true
  }
'''
            else:
                image_publisher = "Canonical"
                image_offer = "0001-com-ubuntu-server-focal"
                image_sku = "20_04-lts-gen2"
                os_profile = '''
  os_profile {
    computer_name  = "${{var.environment}}-${{var.project_name}}-vm"
    admin_username = "azureuser"
  }

  os_profile_linux_config {
    disable_password_authentication = true
    ssh_keys {
      path     = "/home/azureuser/.ssh/authorized_keys"
      key_data = tls_public_key.vm_key.public_key_openssh
    }
  }
'''
            
            content += f'''
# Virtual Network
resource "azurerm_virtual_network" "vnet" {{
  name                = "${{var.environment}}-${{var.project_name}}-vnet"
  address_space       = var.vnet_address_space
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}

# Subnet
resource "azurerm_subnet" "subnet" {{
  name                 = "${{var.environment}}-${{var.project_name}}-subnet"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = [var.subnet_address_prefix]
}}

# Network Security Group
resource "azurerm_network_security_group" "nsg" {{
  name                = "${{var.environment}}-${{var.project_name}}-nsg"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  security_rule {{
    name                       = "AllowRDP"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3389"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }}

  security_rule {{
    name                       = "AllowSSH"
    priority                   = 101
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }}

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}

# Network Interface
resource "azurerm_network_interface" "nic" {{
  name                = "${{var.environment}}-${{var.project_name}}-nic"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  ip_configuration {{
    name                          = "primary"
    subnet_id                     = azurerm_subnet.subnet.id
    private_ip_address_allocation = "Static"
    private_ip_address            = var.private_ip_address
  }}

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}

# Associate NSG with NIC
resource "azurerm_network_interface_security_group_association" "nsg_assoc" {{
  network_interface_id      = azurerm_network_interface.nic.id
  network_security_group_id = azurerm_network_security_group.nsg.id
}}

# Storage Account for diagnostics (optional)
resource "azurerm_storage_account" "storage" {{
  name                     = "${{replace(var.environment, "-", "")}}${{replace(var.project_name, "-", "")}}sa"
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  tags = {{
    Environment = var.environment
    Project     = var.project_name
  }}
}}

# SSH Key pair (Linux only)
{f'resource "tls_private_key" "vm_key" {{\n  algorithm = "RSA"\n  rsa_bits  = 4096\n}}\n' if self.parameters['os'] == 'linux' else ''}

# Random password (Windows only)
{f'resource "random_password" "vm_password" {{\n  length  = 20\n  special = true\n}}\n' if self.parameters['os'] == 'windows' else ''}

# Virtual Machine
resource "azurerm_virtual_machine" "vm" {{
  name                  = "${{var.environment}}-${{var.project_name}}-vm"
  location              = azurerm_resource_group.rg.location
  resource_group_name   = azurerm_resource_group.rg.name
  vm_size               = var.vm_size

  network_interface_ids = [
    azurerm_network_interface.nic.id,
  ]

  delete_os_disk_on_delete = true

  storage_image_reference {{
    publisher = "{image_publisher}"
    offer     = "{image_offer}"
    sku       = "{image_sku}"
    version   = "latest"
  }}

  storage_os_disk {{
    name              = "${{var.environment}}-${{var.project_name}}-osdisk"
    caching           = "ReadWrite"
    create_option     = "FromImage"
    managed_disk_type = "Premium_LRS"
    disk_size_gb      = var.disk_size_gb
  }}{os_profile}

  tags = {{
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "Terraform"
  }}
}}
'''
        
        return content
    
    def generate_outputs_tf(self) -> str:
        """Generate outputs.tf file"""
        return f'''output "resource_group_id" {{
  description = "The ID of the created resource group"
  value       = azurerm_resource_group.rg.id
}}

output "resource_group_name" {{
  description = "The name of the created resource group"
  value       = azurerm_resource_group.rg.name
}}

output "vnet_id" {{
  description = "The ID of the created virtual network"
  value       = azurerm_virtual_network.vnet.id
}}

output "subnet_id" {{
  description = "The ID of the created subnet"
  value       = azurerm_subnet.subnet.id
}}

output "nic_id" {{
  description = "The ID of the network interface"
  value       = azurerm_network_interface.nic.id
}}

output "nic_private_ip" {{
  description = "The private IP address of the NIC"
  value       = azurerm_network_interface.nic.private_ip_address
}}

output "vm_id" {{
  description = "The ID of the created virtual machine"
  value       = azurerm_virtual_machine.vm.id
}}

output "vm_name" {{
  description = "The name of the created virtual machine"
  value       = azurerm_virtual_machine.vm.name
}}

output "environment" {{
  description = "Environment"
  value       = var.environment
}}

output "location" {{
  description = "Azure region where resources were created"
  value       = var.location
}}
'''
    
    def generate_backend_tf(self) -> str:
        """Generate backend.tf file for remote state"""
        return '''# Backend configuration for Terraform state
# Uncomment and configure for your setup

# terraform {{
#   backend "azurerm" {{
#     resource_group_name  = "terraform-state"
#     storage_account_name = "tfstate"
#     container_name       = "tfstate"
#     key                  = "terraform.tfstate"
#   }}
# }}

terraform {
  required_version = ">= 1.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}
'''
    
    def get_extracted_parameters(self) -> Dict:
        """Return extracted parameters"""
        return self.parameters.copy()
    
    def generate_all(self) -> Dict[str, str]:
        """Generate all Terraform files"""
        return {
            'main.tf': self.generate_main_tf(),
            'variables.tf': self.generate_variables_tf(),
            'outputs.tf': self.generate_outputs_tf(),
            'backend.tf': self.generate_backend_tf(),
        }


# Test the generator
if __name__ == '__main__':
    request = "Can you create a VM with 4gb and put in south-east region, with internal ip of 10.10.10.20."
    generator = TerraformGenerator(request, 'test-project', 'dev')
    
    print("📊 Extracted Parameters:")
    print(json.dumps(generator.get_extracted_parameters(), indent=2))
    
    print("\n" + "="*80)
    print("Generated Terraform Files:")
    print("="*80)
    
    files = generator.generate_all()
    for filename, content in files.items():
        print(f"\n📄 {filename}")
        print("-" * 80)
        print(content[:500] + "..." if len(content) > 500 else content)
