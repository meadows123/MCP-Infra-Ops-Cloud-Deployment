#!/usr/bin/env python3
"""
HTTP wrapper for ServiceNow MCP Server
Provides HTTP endpoints for the ServiceNow MCP functionality
"""

import os
import json
import logging
import subprocess
import sys
import requests
import urllib3
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger("servicenow_http_server")

# Get ServiceNow credentials directly
SERVICENOW_URL = os.getenv("SERVICENOW_URL", "").rstrip('/')
SERVICENOW_USER = os.getenv("SERVICENOW_USERNAME", "")
SERVICENOW_PASSWORD = os.getenv("SERVICENOW_PASSWORD", "")

# Log what we see
logger.info(f"http_server: SERVICENOW_URL = {SERVICENOW_URL[:50] if SERVICENOW_URL else 'NOT SET'}...")
logger.info(f"http_server: SERVICENOW_USERNAME = {SERVICENOW_USER[:10] if SERVICENOW_USER else 'NOT SET'}...")
logger.info(f"http_server: SERVICENOW_PASSWORD = {'SET' if SERVICENOW_PASSWORD else 'NOT SET'}")

# Check if we have Key Vault references (not resolved)
if SERVICENOW_URL.startswith("@Microsoft.KeyVault") or SERVICENOW_USER.startswith("@Microsoft.KeyVault") or SERVICENOW_PASSWORD.startswith("@Microsoft.KeyVault"):
    logger.error("ERROR: Key Vault references not resolved in http_server.py! Check Container App environment variables.")
else:
    logger.info("✅ ServiceNow credentials appear to be resolved correctly")

app = FastAPI(title="ServiceNow MCP HTTP Server", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

class ServiceNowDirectClient:
    """Direct ServiceNow API client that bypasses the subprocess"""
    def __init__(self, url, username, password):
        self.url = url.rstrip('/')
        self.auth = (username, password)
        self.headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    
    def get_records(self, table, query_params=None):
        """Retrieve records from ServiceNow"""
        url = f"{self.url}/api/now/table/{table}"
        logger.info(f"Direct API call to: {url}")
        logger.info(f"Query params: {query_params}")
        try:
            response = requests.get(url, auth=self.auth, headers=self.headers, params=query_params, verify=False)
            logger.info(f"Response status: {response.status_code}")
            logger.info(f"Response headers: {dict(response.headers)}")
            
            if response.status_code != 200:
                error_text = response.text[:500] if hasattr(response, 'text') else "No error details"
                logger.error(f"API error response: {error_text}")
                return {"error": f"API returned status {response.status_code}: {error_text}"}
            
            # Check if response has content before trying to parse JSON
            response_text = response.text.strip()
            if not response_text:
                logger.error(f"Empty response from ServiceNow API")
                return {"error": "ServiceNow API returned an empty response. Please check your credentials and ServiceNow URL."}
            
            # Check if response is JSON (starts with { or [)
            if not (response_text.startswith('{') or response_text.startswith('[')):
                logger.error(f"Non-JSON response from ServiceNow API. First 200 chars: {response_text[:200]}")
                return {"error": f"ServiceNow API returned a non-JSON response. This may indicate an authentication error or invalid URL. Response preview: {response_text[:200]}"}
            
            try:
                data = response.json()
            except ValueError as json_error:
                logger.error(f"Failed to parse JSON response: {json_error}")
                logger.error(f"Response text (first 500 chars): {response_text[:500]}")
                return {"error": f"Failed to parse ServiceNow API response as JSON: {str(json_error)}. Response preview: {response_text[:200]}"}
            
            logger.info(f"API response keys: {list(data.keys()) if isinstance(data, dict) else 'Not a dict'}")
            if "error" in data:
                error_msg = data.get("error", {})
                if isinstance(error_msg, dict):
                    error_msg = error_msg.get("message", str(error_msg))
                logger.error(f"ServiceNow API error: {error_msg}")
                return {"error": str(error_msg)}
            # Include X-Total-Count header if available (for pagination/counting)
            if "X-Total-Count" in response.headers:
                data["total_count"] = int(response.headers["X-Total-Count"])
            return data
        except requests.exceptions.RequestException as e:
            logger.error(f"API request failed (network error): {e}", exc_info=True)
            return {"error": f"Network error connecting to ServiceNow: {str(e)}"}
        except Exception as e:
            logger.error(f"API request failed: {e}", exc_info=True)
            return {"error": f"Request failed: {e}"}
    
    def get_count(self, table, query_params=None):
        """Get count of records from ServiceNow table"""
        url = f"{self.url}/api/now/table/{table}"
        params = query_params.copy() if query_params else {}
        params["sysparm_limit"] = "1"  # Only need 1 record to get headers
        params["sysparm_count"] = "true"  # Request count in response
        
        try:
            response = requests.get(url, auth=self.auth, headers=self.headers, params=params, verify=False)
            logger.info(f"Count API call - Response status: {response.status_code}")
            if response.status_code != 200:
                error_text = response.text[:500] if hasattr(response, 'text') else "No error details"
                logger.error(f"Count API error response: {error_text}")
                return {"error": f"API returned status {response.status_code}: {error_text}"}
            
            # Get count from X-Total-Count header (preferred method)
            if "X-Total-Count" in response.headers:
                count = int(response.headers["X-Total-Count"])
                logger.info(f"Got count from X-Total-Count header: {count}")
                return {"count": count}
            
            # Fallback: parse from response body
            data = response.json()
            if "error" in data:
                error_msg = data.get("error", {})
                if isinstance(error_msg, dict):
                    error_msg = error_msg.get("message", str(error_msg))
                logger.error(f"ServiceNow API error: {error_msg}")
                return {"error": str(error_msg)}
            
            # If no header, try to get from result length (may be limited)
            result_list = data.get("result", [])
            count = len(result_list) if isinstance(result_list, list) else 0
            logger.info(f"Got count from result length: {count} (may be limited)")
            return {"count": count}
        except Exception as e:
            logger.error(f"Count API request failed: {e}", exc_info=True)
            return {"error": f"Request failed: {e}"}
    
    def update_record(self, table, sys_id, update_data):
        """Update a ServiceNow record"""
        url = f"{self.url}/api/now/table/{table}/{sys_id}"
        logger.info(f"Updating record: {url}")
        logger.info(f"Update data: {update_data}")
        
        # Track what state we're trying to set
        expected_state = update_data.get("state") if "state" in update_data else None
        
        try:
            # Try PUT first, but also try PATCH if PUT doesn't work for state changes
            response = requests.put(url, auth=self.auth, headers=self.headers, json=update_data, verify=False)
            logger.info(f"Update response status: {response.status_code}")
            
            # If PUT returns 200 but state didn't change, try PATCH
            if response.status_code in [200, 204] and expected_state:
                data = response.json() if response.text else {}
                if data and isinstance(data, dict) and "result" in data:
                    result_data = data["result"]
                    actual_state = result_data.get("state", "")
                    # Check if state is a dict (display value format) or direct value
                    if isinstance(actual_state, dict):
                        actual_state = actual_state.get("value", "")
                    if str(actual_state) != str(expected_state):
                        logger.warning(f"⚠️ [SERVICENOW] PUT didn't change state. Expected: {expected_state}, Got: {actual_state}. Trying PATCH...")
                        # Try PATCH method
                        response = requests.patch(url, auth=self.auth, headers=self.headers, json=update_data, verify=False)
                        logger.info(f"PATCH response status: {response.status_code}")
            
            if response.status_code not in [200, 204]:
                error_text = response.text[:500] if hasattr(response, 'text') else "No error details"
                logger.error(f"Update API error response: {error_text}")
                return {"error": f"API returned status {response.status_code}: {error_text}"}
            data = response.json() if response.text else {}
            
            # Log the updated record data if available (helps verify assignment was set)
            if data and isinstance(data, dict) and "result" in data:
                result_data = data["result"]
                if isinstance(result_data, dict):
                    # Log state if present (critical for close/resolve operations)
                    state = result_data.get("state", "")
                    state_value = state
                    if isinstance(state, dict):
                        state_value = state.get("value", "")
                        state_display = state.get("display_value", "")
                        logger.info(f"📊 [SERVICENOW] Updated record - state value: {state_value}, display: {state_display}")
                    else:
                        logger.info(f"📊 [SERVICENOW] Updated record - state: {state_value}")
                    
                    # Verify state was actually changed
                    if expected_state is not None:
                        if str(state_value) != str(expected_state):
                            logger.error(f"❌ [SERVICENOW] STATE UPDATE FAILED! Expected: {expected_state}, Actual: {state_value}. ServiceNow may have ACLs or workflow rules preventing state change.")
                        else:
                            logger.info(f"✅ [SERVICENOW] State successfully updated to: {state_value}")
                    
                    # Log assignment_group if present
                    assignment_group = result_data.get("assignment_group", "")
                    if assignment_group:
                        assignment_group_display = result_data.get("assignment_group", {}).get("display_value", "") if isinstance(result_data.get("assignment_group"), dict) else ""
                        logger.info(f"📝 [SERVICENOW] Updated record - assignment_group sys_id: {assignment_group}, display: {assignment_group_display}")
                    
                    # Log assigned_to if present
                    assigned_to = result_data.get("assigned_to", "")
                    if assigned_to:
                        assigned_to_display = result_data.get("assigned_to", {}).get("display_value", "") if isinstance(result_data.get("assigned_to"), dict) else ""
                        logger.info(f"👤 [SERVICENOW] Updated record - assigned_to sys_id: {assigned_to}, display: {assigned_to_display}")
            
            if "error" in data:
                error_msg = data.get("error", {})
                if isinstance(error_msg, dict):
                    error_msg = error_msg.get("message", str(error_msg))
                logger.error(f"ServiceNow API error: {error_msg}")
                return {"error": str(error_msg)}
            return {"success": True, "data": data}
        except Exception as e:
            logger.error(f"Update API request failed: {e}", exc_info=True)
            return {"error": f"Request failed: {e}"}
    
    def add_comment(self, table, sys_id, comment):
        """Add a comment/note to a ServiceNow record"""
        # For change_request, incident, and problem tables, comments go in the 'comments' field
        return self.update_record(table, sys_id, {"comments": comment})

# Initialize direct client if credentials are available
if SERVICENOW_URL and SERVICENOW_USER and SERVICENOW_PASSWORD and not SERVICENOW_URL.startswith("@Microsoft.KeyVault"):
    servicenow_client = ServiceNowDirectClient(SERVICENOW_URL, SERVICENOW_USER, SERVICENOW_PASSWORD)
    logger.info("✅ Initialized direct ServiceNow client")
else:
    servicenow_client = None
    logger.warning("⚠️  ServiceNow client not initialized - credentials not available")

# Direct client is used for all operations - no subprocess needed

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "servicenow-mcp-http"}

@app.get("/tools")
async def get_tools():
    """Get available ServiceNow tools"""
    tools = [
        {
            "name": "get_servicenow_incident_details",
            "description": "Get full JSON details of a specific ServiceNow incident ticket",
            "parameters": {
                "type": "object",
                "properties": {
                    "incident_number": {"type": "string"}
                }
            }
        },
        {
            "name": "analyze_servicenow_incident",
            "description": "Analyze a ServiceNow incident ticket and provide intelligent diagnosis",
            "parameters": {
                "type": "object",
                "properties": {
                    "incident_number": {"type": "string"}
                }
            }
        },
        {
            "name": "get_servicenow_problem_details",
            "description": "Get full JSON details of a specific ServiceNow problem ticket",
            "parameters": {
                "type": "object",
                "properties": {
                    "problem_number": {"type": "string"}
                }
            }
        },
        {
            "name": "analyze_servicenow_problem",
            "description": "Analyze a ServiceNow problem ticket and provide intelligent diagnosis",
            "parameters": {
                "type": "object",
                "properties": {
                    "problem_number": {"type": "string"}
                }
            }
        },
        {
            "name": "get_servicenow_change_details",
            "description": "Get full JSON details of a specific ServiceNow change ticket",
            "parameters": {
                "type": "object",
                "properties": {
                    "change_number": {"type": "string"}
                }
            }
        },
        {
            "name": "analyze_servicenow_change",
            "description": "Analyze a ServiceNow change ticket and provide intelligent diagnosis",
            "parameters": {
                "type": "object",
                "properties": {
                    "change_number": {"type": "string"}
                }
            }
        },
        {
            "name": "count_servicenow_tickets",
            "description": "Count the number of ServiceNow tickets (problems, incidents, or changes)",
            "parameters": {
                "type": "object",
                "properties": {
                    "table": {
                        "type": "string",
                        "description": "Table name: 'problem', 'incident', or 'change_request'. If not specified, counts all types."
                    },
                    "ticket_type": {
                        "type": "string",
                        "description": "Type of tickets to count: 'problem', 'incident', 'change', or 'all'"
                    }
                }
            }
        },
        {
            "name": "list_servicenow_tickets",
            "description": "List ServiceNow tickets (problems, incidents, or changes) with their details",
            "parameters": {
                "type": "object",
                "properties": {
                    "table": {
                        "type": "string",
                        "description": "Table name: 'problem', 'incident', or 'change_request'"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of tickets to return (default: 50)"
                    },
                    "query": {
                        "type": "string",
                        "description": "Optional ServiceNow query filter (sysparm_query format)"
                    }
                },
                "required": ["table"]
            }
        }
    ]
    return {"result": tools}

@app.post("/execute")
async def execute_tool(request: Dict[str, Any]):
    """Execute a ServiceNow tool"""
    try:
        tool_name = request.get("tool_name")
        arguments = request.get("arguments", {})
        
        logger.info(f"🔧 [SERVICENOW] Received execute request - tool_name: {tool_name}, arguments keys: {list(arguments.keys()) if arguments else 'None'}")
        
        if not tool_name:
            logger.error("❌ [SERVICENOW] tool_name is required but not provided")
            raise HTTPException(status_code=400, detail="tool_name is required")
        
        # If we have a direct client, use it for common operations
        if servicenow_client:
            if tool_name == "get_servicenow_incident_details":
                incident_number = arguments.get("incident_number", "")
                result = servicenow_client.get_records("incident", {"sysparm_query": f"number={incident_number}"})
                if result.get("error"):
                    return {"error": result.get("error")}
                elif result.get("result") and len(result.get("result", [])) > 0:
                    return {"result": json.dumps(result["result"][0], indent=2)}
                else:
                    return {"error": f"ServiceNow Incident {incident_number} not found"}
            
            elif tool_name == "analyze_servicenow_incident":
                incident_number = arguments.get("incident_number", "")
                # Get incident details - request all relevant text fields including comments and work notes
                incident_result = servicenow_client.get_records(
                    "incident", 
                    {
                        "sysparm_query": f"number={incident_number}",
                        "sysparm_fields": "number,sys_id,state,priority,urgency,impact,category,short_description,description,work_notes,comments,comments_and_work_notes"
                    }
                )
                if incident_result.get("error"):
                    return {"result": {"error": incident_result.get("error")}}
                if not incident_result.get("result") or len(incident_result.get("result", [])) == 0:
                    return {"result": {"error": f"Incident {incident_number} not found"}}
                
                incident_data = incident_result["result"][0]
                # Return analysis
                analysis = {
                    "incident_number": incident_number,
                    "current_state": incident_data.get("state", ""),
                    "priority": incident_data.get("priority", ""),
                    "urgency": incident_data.get("urgency", ""),
                    "impact": incident_data.get("impact", ""),
                    "category": incident_data.get("category", ""),
                    "short_description": incident_data.get("short_description", ""),
                    "description": incident_data.get("description", ""),
                    "work_notes": incident_data.get("work_notes", ""),
                    "comments": incident_data.get("comments", ""),
                    "comments_and_work_notes": incident_data.get("comments_and_work_notes", ""),
                    "analysis": {
                        "is_network_issue": any(keyword in (incident_data.get("short_description", "") + " " + incident_data.get("description", "")).lower() 
                                              for keyword in ["network", "connectivity", "interface", "port", "routing", "switch", "router", "down", "up"]),
                    },
                    "recommended_actions": [
                        "Review incident details and current state",
                        "Check affected network components",
                        "Verify incident priority and urgency",
                        "Update incident with findings"
                    ]
                }
                return {"result": analysis}
            
            elif tool_name == "get_servicenow_problem_details":
                problem_number = arguments.get("problem_number", "")
                result = servicenow_client.get_records("problem", {"sysparm_query": f"number={problem_number}"})
                if result.get("error"):
                    return {"error": result.get("error")}
                elif result.get("result") and len(result.get("result", [])) > 0:
                    return {"result": json.dumps(result["result"][0], indent=2)}
                else:
                    return {"error": f"ServiceNow Problem {problem_number} not found"}
            
            elif tool_name == "analyze_servicenow_problem":
                problem_number = arguments.get("problem_number", "")
                # Get problem details - request all relevant text fields including comments and work notes
                problem_result = servicenow_client.get_records(
                    "problem", 
                    {
                        "sysparm_query": f"number={problem_number}",
                        "sysparm_fields": "number,sys_id,state,priority,urgency,impact,category,short_description,description,work_notes,comments,comments_and_work_notes"
                    }
                )
                if problem_result.get("error"):
                    return {"result": {"error": problem_result.get("error")}}
                if not problem_result.get("result") or len(problem_result.get("result", [])) == 0:
                    return {"result": {"error": f"Problem {problem_number} not found"}}
                
                problem_data = problem_result["result"][0]
                # Return analysis
                analysis = {
                    "problem_number": problem_number,
                    "current_state": problem_data.get("state", ""),
                    "priority": problem_data.get("priority", ""),
                    "urgency": problem_data.get("urgency", ""),
                    "impact": problem_data.get("impact", ""),
                    "category": problem_data.get("category", ""),
                    "short_description": problem_data.get("short_description", ""),
                    "description": problem_data.get("description", ""),
                    "work_notes": problem_data.get("work_notes", ""),
                    "comments": problem_data.get("comments", ""),
                    "comments_and_work_notes": problem_data.get("comments_and_work_notes", ""),
                    "analysis": {
                        "is_network_issue": any(keyword in (problem_data.get("short_description", "") + " " + problem_data.get("description", "")).lower() 
                                              for keyword in ["network", "connectivity", "interface", "port", "routing", "switch", "router", "down", "up"]),
                    },
                    "recommended_actions": [
                        "Review problem details and current state",
                        "Check affected network components",
                        "Verify problem priority and urgency",
                        "Update problem with findings"
                    ]
                }
                return {"result": analysis}
            
            elif tool_name == "get_servicenow_change_details":
                change_number = arguments.get("change_number", "")
                result = servicenow_client.get_records("change_request", {"sysparm_query": f"number={change_number}"})
                if result.get("error"):
                    return {"error": result.get("error")}
                elif result.get("result") and len(result.get("result", [])) > 0:
                    return {"result": json.dumps(result["result"][0], indent=2)}
                else:
                    return {"error": f"ServiceNow Change {change_number} not found"}
            
            elif tool_name == "analyze_servicenow_change":
                change_number = arguments.get("change_number", "")
                logger.info(f"🔍 [SERVICENOW] Analyzing change ticket: {change_number}")
                # Get change details - request all relevant text fields
                change_result = servicenow_client.get_records(
                    "change_request", 
                    {
                        "sysparm_query": f"number={change_number}",
                        "sysparm_fields": "number,sys_id,state,priority,urgency,impact,category,short_description,description,work_notes,comments,implementation_plan,test_plan,backout_plan"
                    }
                )
                logger.info(f"🔍 [SERVICENOW] Change query result: {change_result}")
                if change_result.get("error"):
                    logger.error(f"🔍 [SERVICENOW] Change query error: {change_result.get('error')}")
                    return {"result": {"error": f"Change {change_number} not found: {change_result.get('error')}"}}
                if not change_result.get("result") or len(change_result.get("result", [])) == 0:
                    logger.warning(f"🔍 [SERVICENOW] Change {change_number} not found in results")
                    return {"result": {"error": f"Change {change_number} not found"}}
                
                change_data = change_result["result"][0]
                # Combine all text fields for analysis
                all_text = (
                    change_data.get("short_description", "") + " " +
                    change_data.get("description", "") + " " +
                    change_data.get("work_notes", "") + " " +
                    change_data.get("comments", "") + " " +
                    change_data.get("implementation_plan", "") + " " +
                    change_data.get("test_plan", "") + " " +
                    change_data.get("backout_plan", "")
                ).strip()
                
                # Return analysis with all text fields
                analysis = {
                    "change_number": change_number,
                    "current_state": change_data.get("state", ""),
                    "priority": change_data.get("priority", ""),
                    "urgency": change_data.get("urgency", ""),
                    "impact": change_data.get("impact", ""),
                    "category": change_data.get("category", ""),
                    "short_description": change_data.get("short_description", ""),
                    "description": change_data.get("description", ""),
                    "work_notes": change_data.get("work_notes", ""),
                    "comments": change_data.get("comments", ""),
                    "implementation_plan": change_data.get("implementation_plan", ""),
                    "test_plan": change_data.get("test_plan", ""),
                    "backout_plan": change_data.get("backout_plan", ""),
                    "analysis": {
                        "is_network_issue": any(keyword in all_text.lower() 
                                              for keyword in ["network", "connectivity", "interface", "port", "routing", "switch", "router", "down", "up"]),
                    },
                    "recommended_actions": [
                        "Review change details and current state",
                        "Check affected network components",
                        "Verify change priority and urgency",
                        "Update change with findings"
                    ]
                }
                logger.info(f"🔍 [SERVICENOW] Change analysis includes all text fields. Description length: {len(change_data.get('description', ''))}, Implementation plan length: {len(change_data.get('implementation_plan', ''))}")
                return {"result": analysis}
            
            elif tool_name == "update_servicenow_incident":
                incident_number = arguments.get("incident_number", "")
                update_data = arguments.get("update_data", {})
                logger.info(f"📝 [SERVICENOW] Updating incident {incident_number} with data: {list(update_data.keys())}")
                
                if not incident_number:
                    logger.error("❌ [SERVICENOW] incident_number is required but not provided")
                    return {"error": "incident_number is required"}
                
                if not update_data:
                    logger.error("❌ [SERVICENOW] update_data is required but not provided")
                    return {"error": "update_data is required"}
                
                # First get the sys_id
                logger.info(f"📝 [SERVICENOW] Looking up incident {incident_number}")
                incident_result = servicenow_client.get_records("incident", {"sysparm_query": f"number={incident_number}"})
                
                if incident_result.get("error"):
                    logger.error(f"❌ [SERVICENOW] Error looking up incident: {incident_result.get('error')}")
                    return {"error": f"Error looking up incident: {incident_result.get('error')}"}
                
                if not incident_result.get("result") or len(incident_result.get("result", [])) == 0:
                    logger.error(f"❌ [SERVICENOW] Incident {incident_number} not found")
                    return {"error": f"Incident {incident_number} not found"}
                
                sys_id = incident_result["result"][0]["sys_id"]
                logger.info(f"📝 [SERVICENOW] Found incident sys_id: {sys_id}, updating...")
                
                # Update the incident
                result = servicenow_client.update_record("incident", sys_id, update_data)
                
                if result.get("error"):
                    logger.error(f"❌ [SERVICENOW] Error updating incident: {result.get('error')}")
                    return {"error": result.get("error")}
                
                logger.info(f"✅ [SERVICENOW] Successfully updated incident {incident_number}")
                return {"result": f"Incident {incident_number} updated successfully"}
            
            elif tool_name == "update_servicenow_problem":
                problem_number = arguments.get("problem_number", "")
                update_data = arguments.get("update_data", {})
                logger.info(f"📝 [SERVICENOW] Updating problem {problem_number}")
                # First get the sys_id
                problem_result = servicenow_client.get_records("problem", {"sysparm_query": f"number={problem_number}"})
                if not problem_result.get("result") or len(problem_result.get("result", [])) == 0:
                    return {"error": f"Problem {problem_number} not found"}
                sys_id = problem_result["result"][0]["sys_id"]
                # Update the problem
                result = servicenow_client.update_record("problem", sys_id, update_data)
                if result.get("error"):
                    return {"error": result.get("error")}
                return {"result": f"Problem {problem_number} updated successfully"}
            
            elif tool_name == "update_servicenow_change":
                change_number = arguments.get("change_number", "")
                update_data = arguments.get("update_data", {})
                logger.info(f"📝 [SERVICENOW] Updating change {change_number}")
                # First get the sys_id
                change_result = servicenow_client.get_records("change_request", {"sysparm_query": f"number={change_number}"})
                if not change_result.get("result") or len(change_result.get("result", [])) == 0:
                    return {"error": f"Change {change_number} not found"}
                sys_id = change_result["result"][0]["sys_id"]
                # Update the change
                result = servicenow_client.update_record("change_request", sys_id, update_data)
                if result.get("error"):
                    return {"error": result.get("error")}
                return {"result": f"Change {change_number} updated successfully"}
            
            elif tool_name == "count_servicenow_tickets":
                table = arguments.get("table")
                ticket_type = arguments.get("ticket_type", "all")
                logger.info(f"📊 [SERVICENOW] Counting tickets - table: {table}, type: {ticket_type}")
                
                if ticket_type == "all" or not table:
                    # Count all ticket types
                    problem_count_result = servicenow_client.get_count("problem")
                    incident_count_result = servicenow_client.get_count("incident")
                    change_count_result = servicenow_client.get_count("change_request")
                    
                    problem_count = problem_count_result.get("count", 0) if not problem_count_result.get("error") else 0
                    incident_count = incident_count_result.get("count", 0) if not incident_count_result.get("error") else 0
                    change_count = change_count_result.get("count", 0) if not change_count_result.get("error") else 0
                    
                    return {
                        "result": {
                            "problem_count": problem_count,
                            "incident_count": incident_count,
                            "change_count": change_count
                        }
                    }
                else:
                    # Count specific table
                    count_result = servicenow_client.get_count(table)
                    
                    if count_result.get("error"):
                        return {"error": count_result.get("error")}
                    
                    count = count_result.get("count", 0)
                    return {"result": {"count": count}}
            
            elif tool_name == "list_servicenow_tickets":
                table = arguments.get("table")
                limit = arguments.get("limit", 50)
                query = arguments.get("query")
                # Check if this is an escalation query (passed as separate argument for code-based filtering)
                is_escalation_query = arguments.get("is_escalation_query", False)
                
                if not table:
                    return {"error": "Table name is required (problem, incident, or change_request)"}
                
                logger.info(f"📋 [SERVICENOW] Listing tickets - table: {table}, limit: {limit}, query: {query}")
                
                # Build query parameters
                query_params = {
                    "sysparm_limit": str(limit),
                    "sysparm_display_value": "true"  # Return display values for better readability
                }
                
                # Add optional query filter
                if query:
                    query_params["sysparm_query"] = query
                
                # Check if query includes escalation filter or if it's an escalation query
                # Request escalation fields so we can filter in code if needed
                include_escalation_fields = is_escalation_query or (query and ("escalation" in query.lower() or "escalation_time" in query.lower()))
                if include_escalation_fields:
                    # Request escalation-related fields
                    query_params["sysparm_fields"] = "number,short_description,state,priority,sys_id,escalation,escalation_time,escalation_state"
                    logger.info(f"📋 [SERVICENOW] Including escalation fields in response")
                
                # Get records
                result = servicenow_client.get_records(table, query_params)
                
                if result.get("error"):
                    return {"error": result.get("error")}
                
                tickets = result.get("result", [])
                total_count = result.get("total_count", len(tickets))
                
                # Format response with ticket number and short description
                # Include escalation fields if they were requested
                formatted_tickets = []
                for ticket in tickets:
                    ticket_data = {
                        "number": ticket.get("number", "N/A"),
                        "short_description": ticket.get("short_description", "N/A"),
                        "state": ticket.get("state", "N/A"),
                        "priority": ticket.get("priority", "N/A"),
                        "sys_id": ticket.get("sys_id", "N/A")
                    }
                    # Include escalation fields if available
                    if include_escalation_fields:
                        ticket_data["escalation"] = ticket.get("escalation", "")
                        ticket_data["escalation_time"] = ticket.get("escalation_time", "")
                        ticket_data["escalation_state"] = ticket.get("escalation_state", "")
                    formatted_tickets.append(ticket_data)
                
                return {
                    "result": {
                        "tickets": formatted_tickets,
                        "total_count": total_count,
                        "returned_count": len(formatted_tickets)
                    }
                }
        
        # Tool not supported by direct client
        logger.error(f"❌ [SERVICENOW] Tool '{tool_name}' is not yet implemented in the direct API client")
        raise HTTPException(
            status_code=400, 
            detail=f"Tool '{tool_name}' is not yet implemented in the direct API client. Supported tools: get_servicenow_incident_details, analyze_servicenow_incident, update_servicenow_incident, get_servicenow_problem_details, analyze_servicenow_problem, update_servicenow_problem, get_servicenow_change_details, analyze_servicenow_change, update_servicenow_change, count_servicenow_tickets, list_servicenow_tickets"
        )
        
    except HTTPException as he:
        logger.error(f"❌ [SERVICENOW] HTTPException: {he.status_code} - {he.detail}")
        raise
    except Exception as e:
        logger.error(f"❌ [SERVICENOW] Error executing tool {tool_name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat_endpoint(request: Dict[str, Any]):
    """Chat endpoint for natural language ServiceNow interactions"""
    try:
        message = request.get("message", "")
        organization_id = request.get("organization_id", "default")
        
        if not message:
            raise HTTPException(status_code=400, detail="message is required")
        
        # For now, return available tools
        # In the future, this could be enhanced with AI to understand natural language
        tools_response = await get_tools()
        
        return {
            "response": f"I can help you with ServiceNow operations. Available tools: {', '.join([tool['name'] for tool in tools_response.get('result', [])])}",
            "tools": tools_response.get('result', [])
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.getenv("PORT", 3000))
    logger.info(f"Starting ServiceNow MCP HTTP Server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
