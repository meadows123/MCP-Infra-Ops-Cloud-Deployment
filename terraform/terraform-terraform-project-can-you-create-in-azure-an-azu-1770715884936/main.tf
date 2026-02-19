# Resource Group
resource "azurerm_resource_group" "rg" {
  name     = "${var.environment}-${var.project_name}-rg"
  location = var.location

  tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "Terraform"
  }
}


# Virtual Network
resource "azurerm_virtual_network" "vnet" {
  name                = "Gems-Vnet"
  address_space       = ["10.10.0.0/16"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# Subnet
resource "azurerm_subnet" "subnet" {
  name                 = "dev-subnet"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.10.0.0/24"]
}
