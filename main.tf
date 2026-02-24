# Azure Application Gateway Create - Ansible Execution

## Execution Method
This change will be executed using the Ansible playbook: `azure/manage-azure-appgateway.yml`

## Request Details
Create me an Azure app gateway named InfraOps-AppGW and place in InfraOps-RG resource group and put it in the 10.10.1.0/24 subnet

## Execution Steps
1. Approve this PR to authorize the change
2. The Ansible playbook will execute with the following parameters:
   - action: create
   - resource: Application Gateway
   - subscription: default
   
## Playbook: manage-azure-appgateway.yml
- Handles subnet resolution by CIDR (skips reserved subnets like AzureFirewallSubnet)
- Creates/deletes Azure Application Gateway with Standard_v2 SKU
- Automatically creates public IP if needed
- Validates all required parameters before execution

## Status
Waiting for approval...
