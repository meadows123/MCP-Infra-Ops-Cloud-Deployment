import os
import json
import time
import logging
import requests
from datetime import datetime
import sys
import threading
from typing import Dict, Any

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

SERVICENOW_URL = os.getenv("SERVICENOW_URL", "").rstrip('/')
SERVICENOW_USER = os.getenv("SERVICENOW_USERNAME", "")
SERVICENOW_PASSWORD = os.getenv("SERVICENOW_PASSWORD", "")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger("servicenow_mcp")

# Log environment variable status (without exposing passwords)
logging.info(f"ServiceNow URL configured: {SERVICENOW_URL[:50] if SERVICENOW_URL else 'NOT SET'}...")
logging.info(f"ServiceNow Username configured: {SERVICENOW_USER[:10] if SERVICENOW_USER else 'NOT SET'}...")
logging.info(f"ServiceNow Password configured: {'YES' if SERVICENOW_PASSWORD else 'NOT SET'}")

# Check if environment variables are Key Vault references (not resolved) - warn but don't fail
if SERVICENOW_URL.startswith("@Microsoft.KeyVault") or SERVICENOW_USER.startswith("@Microsoft.KeyVault") or SERVICENOW_PASSWORD.startswith("@Microsoft.KeyVault"):
    logging.warning("WARNING: Key Vault references not resolved! Container App identity may not have Key Vault access.")

# Basic Authentication for ServiceNow
auth = (SERVICENOW_USER, SERVICENOW_PASSWORD)
headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
}

class ServiceNowController:
    def __init__(self, servicenow_url, username, password):
        if not servicenow_url or not username or not password:
            raise ValueError("ServiceNow credentials not properly configured")
        self.servicenow = servicenow_url.rstrip('/')
        self.auth = (username, password)
        self.headers = headers
    
    def get_records(self, table, query_params=None):
        """Retrieve records from a specified ServiceNow table."""
        url = f"{self.servicenow}/api/now/table/{table}"
        logging.info(f"GET Request to URL: {url}")
        logging.info(f"Query params: {query_params}")
        try:
            response = requests.get(url, auth=self.auth, headers=self.headers, params=query_params, verify=False)
            logging.info(f"Response status: {response.status_code}")
            response_data = response.json()
            logging.info(f"Response data: {json.dumps(response_data, indent=2)}")
            if response.status_code != 200:
                logging.error(f"Non-200 status code: {response.status_code}")
                return {"error": f"API returned status {response.status_code}: {response_data.get('error', {}).get('message', 'Unknown error')}"}
            if "error" in response_data:
                logging.error(f"API returned error: {response_data.get('error')}")
                return {"error": response_data.get("error", {}).get("message", "Unknown API error")}
            return response_data
        except requests.exceptions.RequestException as e:
            logging.error(f"GET request failed: {e}")
            return {"error": f"Request failed: {e}"}
    
    def create_record(self, table, payload):
        url = f"{self.servicenow}/api/now/table/{table}"
        clean_headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
        logging.info(f"POST Request to URL: {url} with Payload:\n{json.dumps(payload, indent=2)}")
    
        try:
            response = requests.post(
                url,
                auth=self.auth,
                headers=clean_headers,
                json=payload,
                verify=False,
                allow_redirects=False  # 🔥 THIS IS CRUCIAL 🔥
            )
    
            logging.info(f"Response Status Code: {response.status_code}")
            logging.info(f"Response Headers: {response.headers}")
            logging.info(f"Response Content: {response.text}")
    
            # Check for redirection
            if response.status_code in (301, 302, 307, 308):
                return {"error": f"Redirected to {response.headers.get('Location')}, check credentials or endpoint"}
    
            response.raise_for_status()
            return response.json()
    
        except requests.exceptions.RequestException as e:
            logging.error(f"POST request failed: {e}")
            return {"error": f"Request failed: {e}"}
        except json.JSONDecodeError as e:
            logging.error(f"JSON decode failed: {e}")
            return {"error": f"Failed to parse JSON response: {e}"}


    def update_record(self, table, record_sys_id, payload):
        """Update a record in a specified ServiceNow table."""
        url = f"{self.servicenow}/api/now/table/{table}/{record_sys_id}"
        logging.info(f"PATCH Request to URL: {url} with Payload: {json.dumps(payload, indent=2)}")
        try:
            response = requests.patch(url, auth=self.auth, headers=self.headers, json=payload, verify=False)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logging.error(f"PATCH request failed: {e}")
            return {"error": f"Request failed: {e}"}

# Initialize ServiceNow API Controller
servicenow_client = ServiceNowController(SERVICENOW_URL, SERVICENOW_USER, SERVICENOW_PASSWORD)

def send_response(response_data):
    """Send the response back to stdout."""
    response = json.dumps(response_data) + "\n"
    sys.stdout.write(response)
    sys.stdout.flush()

def handle_tools_discover():
    send_response({
        "result": [
            {
                "name": "create_servicenow_problem",
                "description": (
                    "🚨 Use this to create a new ServiceNow problem. "
                    "Only use when the user explicitly says to create a new problem ticket. "
                    "Do NOT use this tool to update or retrieve existing problems."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "problem_data": {"type": "object"}
                    }
                }
            },
            {
                "name": "get_servicenow_problem_sys_id",
                "description": (
                    "🔍 Only use if the user provides a problem number and asks to fetch its ServiceNow sys_id. "
                    "Do NOT use unless user explicitly asks to look up a problem by number."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "problem_number": {"type": "string"}
                    }
                }
            },
            {
                "name": "get_servicenow_problem_state",
                "description": (
                    "📊 Only use if the user provides a sys_id and wants to check the current problem state. "
                    "Do NOT use for new problem creation or general issue diagnosis."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sys_id": {"type": "string"}
                    }
                }
            },
            {
                "name": "get_servicenow_problem_details",
                "description": (
                    "📄 Use to get full JSON details of a specific problem, ONLY when the user gives a number. "
                    "Not needed for general actions or new problem creation."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "problem_number": {"type": "string"}
                    }
                }
            },
            {
                "name": "update_servicenow_problem",
                "description": (
                    "✏️ Use this to update an existing problem in ServiceNow. "
                    "Only use if the user asks to modify fields in a known problem by sys_id. "
                    "NEVER use this when creating new problems."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sys_id": {"type": "string"},
                        "update_data": {"type": "object"}
                    }
                }
            },
            {
                "name": "analyze_servicenow_problem",
                "description": (
                    "🔍 Use this to analyze a ServiceNow problem ticket and provide intelligent diagnosis. "
                    "This will fetch ticket details, analyze the problem description, and suggest resolution steps."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "problem_number": {"type": "string"}
                    }
                }
            },
            {
                "name": "resolve_servicenow_problem",
                "description": (
                    "🛠️ Use this to provide resolution steps for a ServiceNow problem. "
                    "This will analyze the problem, run network diagnostics if needed, and suggest specific fixes."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "problem_number": {"type": "string"},
                        "resolution_steps": {"type": "string"}
                    }
                }
            },
            {
                "name": "search_servicenow_problems",
                "description": (
                    "🔎 Use this to search for similar ServiceNow problems. "
                    "This helps identify patterns and previously resolved similar issues."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "search_query": {"type": "string"},
                        "category": {"type": "string"}
                    }
                }
            },
            {
                "name": "process_servicenow_comments",
                "description": (
                    "💬 Use this to read and process comments/work notes in a ServiceNow ticket. "
                    "This will analyze the latest comments and suggest appropriate actions."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "problem_number": {"type": "string"}
                    }
                }
            },
            {
                "name": "respond_to_servicenow_ticket",
                "description": (
                    "📝 Use this to add intelligent responses to ServiceNow tickets based on analysis. "
                    "This will add work notes with AI-generated responses and suggested actions."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "problem_number": {"type": "string"},
                        "response": {"type": "string"},
                        "action_taken": {"type": "string"}
                    }
                }
            },
            {
                "name": "get_servicenow_incident_details",
                "description": (
                    "📄 Use to get full JSON details of a specific ServiceNow incident ticket. "
                    "Use when the user provides an INC ticket number (e.g., INC0010002). "
                    "This works for Incident tickets, not Problem tickets."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "incident_number": {"type": "string"}
                    }
                }
            },
            {
                "name": "analyze_servicenow_incident",
                "description": (
                    "🔍 Use this to analyze a ServiceNow incident ticket and provide intelligent diagnosis. "
                    "Use when the user provides an INC ticket number (e.g., INC0010002). "
                    "This will fetch incident details, analyze the description, and suggest resolution steps."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "incident_number": {"type": "string"}
                    }
                }
            },
            {
                "name": "update_servicenow_incident",
                "description": (
                    "✏️ Use this to update an existing ServiceNow incident ticket. "
                    "Use when the user provides an INC ticket number and wants to modify fields."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "incident_number": {"type": "string"},
                        "update_data": {"type": "object"}
                    }
                }
            }
        ]
    })

def handle_tools_call(data):
    """Handle tools call (tools/call)."""
    tool_name = data.get("params", {}).get("name")
    arguments = data.get("params", {}).get("arguments", {})

    if tool_name == "get_servicenow_problem_sys_id":
        problem_number = arguments.get("problem_number", "")
        result = servicenow_client.get_records("problem", {"sysparm_query": f"number={problem_number}"})
        if result.get("result"):
            send_response({"result": result["result"][0]["sys_id"]})
        else:
            send_response({"error": "ServiceNow Problem not found"})

    elif tool_name == "get_servicenow_problem_state":
        sys_id = arguments.get("sys_id", "")
        result = servicenow_client.get_records("problem", {"sysparm_query": f"sys_id={sys_id}", "sysparm_fields": "problem_state"})
        if result.get("result"):
            send_response({"result": result["result"][0]["problem_state"]})
        else:
            send_response({"error": "ServiceNow Problem not found"})

    elif tool_name == "get_servicenow_problem_details":
        problem_number = arguments.get("problem_number", "")
        result = servicenow_client.get_records("problem", {"sysparm_query": f"number={problem_number}"})
        if result.get("result"):
            send_response({"result": json.dumps(result["result"][0], indent=2)})
        else:
            send_response({"error": "ServiceNow Problem details not found"})

    elif tool_name == "create_servicenow_problem":
        problem_data = arguments.get("problem_data", {})
        if isinstance(problem_data, str):
            try:
                problem_data = json.loads(problem_data)
            except json.JSONDecodeError as e:
                logging.error(f"Error parsing problem_data: {e}")
                send_response({"error": "Invalid problem_data format"})
                return
        logging.info(f"problem_data type: {type(problem_data)}, problem_data: {problem_data}")
        result = servicenow_client.create_record("problem", problem_data)
        send_response({"result": result})

    elif tool_name == "update_servicenow_problem":
        sys_id = arguments.get("sys_id", "")
        update_data = arguments.get("update_data", {})
        result = servicenow_client.update_record("problem", sys_id, update_data)
        send_response({"result": result})

    elif tool_name == "analyze_servicenow_problem":
        problem_number = arguments.get("problem_number", "")
        result = analyze_problem(problem_number)
        send_response({"result": result})

    elif tool_name == "resolve_servicenow_problem":
        problem_number = arguments.get("problem_number", "")
        resolution_steps = arguments.get("resolution_steps", "")
        result = resolve_problem(problem_number, resolution_steps)
        send_response({"result": result})

    elif tool_name == "search_servicenow_problems":
        search_query = arguments.get("search_query", "")
        category = arguments.get("category", "")
        result = search_problems(search_query, category)
        send_response({"result": result})

    elif tool_name == "process_servicenow_comments":
        problem_number = arguments.get("problem_number", "")
        result = process_comments(problem_number)
        send_response({"result": result})

    elif tool_name == "respond_to_servicenow_ticket":
        problem_number = arguments.get("problem_number", "")
        response = arguments.get("response", "")
        action_taken = arguments.get("action_taken", "")
        result = respond_to_ticket(problem_number, response, action_taken)
        send_response({"result": result})

    elif tool_name == "get_servicenow_incident_details":
        incident_number = arguments.get("incident_number", "")
        logging.info(f"Getting incident details for: {incident_number}")
        result = servicenow_client.get_records("incident", {"sysparm_query": f"number={incident_number}"})
        logging.info(f"get_records returned: {json.dumps(result, indent=2)}")
        if result.get("error"):
            logging.error(f"Error in result: {result.get('error')}")
            send_response({"error": result.get("error")})
        elif result.get("result") and len(result.get("result", [])) > 0:
            logging.info(f"Found incident: {result['result'][0].get('number')}")
            send_response({"result": json.dumps(result["result"][0], indent=2)})
        else:
            logging.warning(f"No result found for incident {incident_number}. Result keys: {result.keys() if isinstance(result, dict) else 'not a dict'}")
            send_response({"error": f"ServiceNow Incident {incident_number} not found"})

    elif tool_name == "analyze_servicenow_incident":
        incident_number = arguments.get("incident_number", "")
        result = analyze_incident(incident_number)
        send_response({"result": result})

    elif tool_name == "update_servicenow_incident":
        incident_number = arguments.get("incident_number", "")
        update_data = arguments.get("update_data", {})
        # First get the sys_id from the incident number
        incident_result = servicenow_client.get_records("incident", {"sysparm_query": f"number={incident_number}"})
        if not incident_result.get("result"):
            send_response({"error": f"Incident {incident_number} not found"})
            return
        sys_id = incident_result["result"][0]["sys_id"]
        result = servicenow_client.update_record("incident", sys_id, update_data)
        send_response({"result": result})

    else:
        send_response({"error": f"Tool '{tool_name}' not implemented in ServiceNow MCP"})

def analyze_problem(problem_number):
    """Analyze a ServiceNow problem and provide intelligent diagnosis"""
    try:
        # Get the problem details
        problem_result = servicenow_client.get_records("problem", {"sysparm_query": f"number={problem_number}"})
        
        if not problem_result.get("result"):
            return {"error": f"Problem {problem_number} not found"}
        
        problem_data = problem_result["result"][0]
        
        # Extract key information
        short_desc = problem_data.get("short_description", "")
        description = problem_data.get("description", "")
        category = problem_data.get("category", "")
        priority = problem_data.get("priority", "")
        state = problem_data.get("state", "")
        
        # Analyze the problem description for network-related issues
        analysis = {
            "problem_number": problem_number,
            "current_state": state,
            "priority": priority,
            "category": category,
            "analysis": {
                "is_network_issue": any(keyword in (short_desc + " " + description).lower() 
                                      for keyword in ["network", "connectivity", "interface", "port", "routing", "switch", "router"]),
                "affected_components": extract_affected_components(short_desc + " " + description),
                "suggested_diagnostics": suggest_diagnostics(short_desc + " " + description),
                "urgency_level": assess_urgency(priority, short_desc + " " + description)
            },
            "recommended_actions": generate_recommended_actions(problem_data)
        }
        
        return analysis
        
    except Exception as e:
        logging.error(f"Error analyzing problem {problem_number}: {e}")
        return {"error": f"Failed to analyze problem: {str(e)}"}

def analyze_incident(incident_number):
    """Analyze a ServiceNow incident and provide intelligent diagnosis"""
    try:
        # Get the incident details
        incident_result = servicenow_client.get_records("incident", {"sysparm_query": f"number={incident_number}"})
        logging.info(f"analyze_incident: get_records returned keys: {incident_result.keys() if isinstance(incident_result, dict) else 'not a dict'}")
        logging.info(f"analyze_incident: result count: {len(incident_result.get('result', []))}")
        
        if incident_result.get("error"):
            logging.error(f"analyze_incident: Error from get_records: {incident_result.get('error')}")
            return {"error": incident_result.get("error")}
        
        if not incident_result.get("result") or len(incident_result.get("result", [])) == 0:
            logging.warning(f"analyze_incident: No results found. Full response: {json.dumps(incident_result, indent=2)}")
            return {"error": f"Incident {incident_number} not found"}
        
        incident_data = incident_result["result"][0]
        
        # Extract key information
        short_desc = incident_data.get("short_description", "")
        description = incident_data.get("description", "")
        category = incident_data.get("category", "")
        priority = incident_data.get("priority", "")
        state = incident_data.get("state", "")
        urgency = incident_data.get("urgency", "")
        impact = incident_data.get("impact", "")
        
        # Analyze the incident description for network-related issues
        analysis = {
            "incident_number": incident_number,
            "current_state": state,
            "priority": priority,
            "urgency": urgency,
            "impact": impact,
            "category": category,
            "short_description": short_desc,
            "description": description,
            "analysis": {
                "is_network_issue": any(keyword in (short_desc + " " + description).lower() 
                                      for keyword in ["network", "connectivity", "interface", "port", "routing", "switch", "router", "down", "up"]),
                "affected_components": extract_affected_components(short_desc + " " + description),
                "suggested_diagnostics": suggest_diagnostics(short_desc + " " + description),
                "urgency_level": assess_urgency(priority, short_desc + " " + description)
            },
            "recommended_actions": generate_recommended_actions(incident_data)
        }
        
        return analysis
        
    except Exception as e:
        logging.error(f"Error analyzing incident {incident_number}: {e}")
        return {"error": f"Failed to analyze incident: {str(e)}"}

def resolve_problem(problem_number, resolution_steps):
    """Provide resolution steps for a ServiceNow problem"""
    try:
        # Get the problem details
        problem_result = servicenow_client.get_records("problem", {"sysparm_query": f"number={problem_number}"})
        
        if not problem_result.get("result"):
            return {"error": f"Problem {problem_number} not found"}
        
        problem_data = problem_result["result"][0]
        sys_id = problem_data.get("sys_id")
        
        # Create resolution data
        resolution_data = {
            "work_notes": f"AI-Generated Resolution Steps:\n\n{resolution_steps}\n\nResolution provided by MCP Network Automation System",
            "state": "102",  # Resolved state
            "resolution_code": "resolved_by_ai",
            "close_notes": f"Problem resolved using AI analysis and network diagnostics. Resolution steps: {resolution_steps}"
        }
        
        # Update the problem with resolution
        update_result = servicenow_client.update_record("problem", sys_id, resolution_data)
        
        return {
            "problem_number": problem_number,
            "resolution_applied": True,
            "resolution_steps": resolution_steps,
            "update_result": update_result
        }
        
    except Exception as e:
        logging.error(f"Error resolving problem {problem_number}: {e}")
        return {"error": f"Failed to resolve problem: {str(e)}"}

def search_problems(search_query, category=""):
    """Search for similar ServiceNow problems"""
    try:
        # Build search query
        query_parts = []
        if search_query:
            query_parts.append(f"short_descriptionLIKE{search_query}")
        if category:
            query_parts.append(f"category={category}")
        
        search_query_str = "^".join(query_parts) if query_parts else ""
        
        # Search for problems
        search_result = servicenow_client.get_records("problem", {
            "sysparm_query": search_query_str,
            "sysparm_limit": 10,
            "sysparm_fields": "number,short_description,category,state,priority,opened_at,resolved_at"
        })
        
        if not search_result.get("result"):
            return {"problems": [], "count": 0}
        
        problems = search_result["result"]
        
        # Analyze patterns in similar problems
        analysis = {
            "problems": problems,
            "count": len(problems),
            "common_patterns": analyze_common_patterns(problems),
            "resolution_suggestions": generate_resolution_suggestions(problems)
        }
        
        return analysis
        
    except Exception as e:
        logging.error(f"Error searching problems: {e}")
        return {"error": f"Failed to search problems: {str(e)}"}

def extract_affected_components(text):
    """Extract network components mentioned in the problem description"""
    import re
    
    components = []
    text_lower = text.lower()
    
    # Look for device names, interfaces, ports
    device_patterns = [
        r'\b(r\d+|sw\d+|core|dist|access|edge|firewall|asa|wlc|ap)\b',
        r'interface\s+(\w+/\d+)',
        r'port\s+(\d+)',
        r'gi\d+/\d+',
        r'fa\d+/\d+'
    ]
    
    for pattern in device_patterns:
        matches = re.findall(pattern, text_lower)
        components.extend(matches)
    
    return list(set(components))

def suggest_diagnostics(text):
    """Suggest diagnostic commands based on problem description"""
    text_lower = text.lower()
    diagnostics = []
    
    if any(keyword in text_lower for keyword in ["interface", "port", "down", "up"]):
        diagnostics.append("show interfaces")
        diagnostics.append("show interfaces status")
    
    if any(keyword in text_lower for keyword in ["connectivity", "ping", "reach"]):
        diagnostics.append("ping tests")
        diagnostics.append("traceroute")
    
    if any(keyword in text_lower for keyword in ["routing", "route", "bgp"]):
        diagnostics.append("show ip route")
        diagnostics.append("show ip bgp summary")
    
    if any(keyword in text_lower for keyword in ["configuration", "config"]):
        diagnostics.append("show running-config")
    
    return diagnostics

def assess_urgency(priority, description):
    """Assess the urgency level based on priority and description"""
    text_lower = description.lower()
    
    if priority in ["1", "2"] or any(keyword in text_lower for keyword in ["critical", "urgent", "down", "outage"]):
        return "HIGH"
    elif priority == "3" or any(keyword in text_lower for keyword in ["issue", "problem", "slow"]):
        return "MEDIUM"
    else:
        return "LOW"

def generate_recommended_actions(problem_data):
    """Generate recommended actions based on problem data"""
    actions = []
    
    category = problem_data.get("category", "").lower()
    description = problem_data.get("description", "").lower()
    
    if "network" in category or any(keyword in description for keyword in ["interface", "port", "connectivity"]):
        actions.extend([
            "Run network diagnostics on affected devices",
            "Check interface status and configuration",
            "Verify connectivity between devices",
            "Review recent configuration changes"
        ])
    
    if any(keyword in description for keyword in ["routing", "route", "bgp"]):
        actions.extend([
            "Check routing table on affected devices",
            "Verify BGP neighbor status",
            "Review routing protocol configuration"
        ])
    
    return actions

def analyze_common_patterns(problems):
    """Analyze common patterns in similar problems"""
    if not problems:
        return {}
    
    categories = {}
    states = {}
    priorities = {}
    
    for problem in problems:
        cat = problem.get("category", "Unknown")
        state = problem.get("state", "Unknown")
        priority = problem.get("priority", "Unknown")
        
        categories[cat] = categories.get(cat, 0) + 1
        states[state] = states.get(state, 0) + 1
        priorities[priority] = priorities.get(priority, 0) + 1
    
    return {
        "common_categories": sorted(categories.items(), key=lambda x: x[1], reverse=True),
        "common_states": sorted(states.items(), key=lambda x: x[1], reverse=True),
        "common_priorities": sorted(priorities.items(), key=lambda x: x[1], reverse=True)
    }

def generate_resolution_suggestions(problems):
    """Generate resolution suggestions based on similar problems"""
    suggestions = []
    
    # Look for resolved problems
    resolved_problems = [p for p in problems if p.get("state") in ["6", "7"] and p.get("resolved_at")]
    
    if resolved_problems:
        suggestions.append("Review similar resolved problems for resolution patterns")
        suggestions.append("Check if the same root cause applies to current problem")
    
    return suggestions

def process_comments(problem_number):
    """Process and analyze comments/work notes in a ServiceNow ticket"""
    try:
        # Get the problem details including work notes
        problem_result = servicenow_client.get_records("problem", {
            "sysparm_query": f"number={problem_number}",
            "sysparm_fields": "number,short_description,description,work_notes,comments,comments_and_work_notes,close_notes,state,priority,category"
        })
        
        if not problem_result.get("result"):
            return {"error": f"Problem {problem_number} not found"}
        
        problem_data = problem_result["result"][0]
        
        # Extract comments and work notes
        work_notes = problem_data.get("work_notes", "")
        comments = problem_data.get("comments", "")
        comments_and_work_notes = problem_data.get("comments_and_work_notes", "")
        close_notes = problem_data.get("close_notes", "")
        
        # Combine all text content
        all_text = f"{work_notes} {comments} {comments_and_work_notes} {close_notes}".strip()
        
        if not all_text:
            return {
                "problem_number": problem_number,
                "status": "no_comments",
                "message": "No comments or work notes found in this ticket",
                "suggested_actions": ["Add initial work notes", "Request more information from user"]
            }
        
        # Analyze the comments for actionable items
        analysis = analyze_comment_content(all_text)
        
        return {
            "problem_number": problem_number,
            "status": "comments_found",
            "comment_analysis": analysis,
            "latest_comments": all_text,
            "suggested_actions": generate_actions_from_comments(analysis, problem_data)
        }
        
    except Exception as e:
        logging.error(f"Error processing comments for {problem_number}: {e}")
        return {"error": f"Failed to process comments: {str(e)}"}

def respond_to_ticket(problem_number, response, action_taken):
    """Add intelligent response to a ServiceNow ticket"""
    try:
        # Get the problem details
        problem_result = servicenow_client.get_records("problem", {"sysparm_query": f"number={problem_number}"})
        
        if not problem_result.get("result"):
            return {"error": f"Problem {problem_number} not found"}
        
        problem_data = problem_result["result"][0]
        sys_id = problem_data.get("sys_id")
        
        # Create response data
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        work_notes = f"[{current_time}] AI Response:\n\n{response}\n\nAction Taken: {action_taken}\n\n--- Generated by MCP Network Automation AI ---"
        
        # Update the problem with the response
        update_data = {
            "work_notes": work_notes,
            "comments_and_work_notes": work_notes
        }
        
        update_result = servicenow_client.update_record("problem", sys_id, update_data)
        
        return {
            "problem_number": problem_number,
            "response_added": True,
            "response": response,
            "action_taken": action_taken,
            "timestamp": current_time,
            "update_result": update_result
        }
        
    except Exception as e:
        logging.error(f"Error responding to ticket {problem_number}: {e}")
        return {"error": f"Failed to respond to ticket: {str(e)}"}

def analyze_comment_content(comments_text):
    """Analyze comment content for actionable items"""
    import re
    
    analysis = {
        "urgency_indicators": [],
        "technical_issues": [],
        "user_requests": [],
        "status_updates": [],
        "questions": [],
        "action_items": []
    }
    
    text_lower = comments_text.lower()
    
    # Detect urgency indicators
    urgency_patterns = [
        r'\b(urgent|critical|asap|immediately|emergency|down|outage)\b',
        r'\b(not working|broken|failed|error|issue)\b'
    ]
    for pattern in urgency_patterns:
        matches = re.findall(pattern, text_lower)
        analysis["urgency_indicators"].extend(matches)
    
    # Detect technical issues
    tech_patterns = [
        r'\b(interface|port|routing|connectivity|ping|dns|bgp|vlan)\b',
        r'\b(show|config|command|device|router|switch)\b'
    ]
    for pattern in tech_patterns:
        matches = re.findall(pattern, text_lower)
        analysis["technical_issues"].extend(matches)
    
    # Detect user requests
    request_patterns = [
        r'\b(please|can you|could you|need|want|require)\b',
        r'\b(check|verify|test|run|execute)\b'
    ]
    for pattern in request_patterns:
        matches = re.findall(pattern, text_lower)
        analysis["user_requests"].extend(matches)
    
    # Detect questions
    question_patterns = [
        r'\?',
        r'\b(what|how|when|where|why|who)\b'
    ]
    for pattern in question_patterns:
        matches = re.findall(pattern, text_lower)
        analysis["questions"].extend(matches)
    
    # Detect action items
    action_patterns = [
        r'\b(fix|resolve|update|change|modify|restart|reload)\b',
        r'\b(implement|deploy|configure|setup)\b'
    ]
    for pattern in action_patterns:
        matches = re.findall(pattern, text_lower)
        analysis["action_items"].extend(matches)
    
    return analysis

def generate_actions_from_comments(analysis, problem_data):
    """Generate suggested actions based on comment analysis"""
    actions = []
    
    # Urgency-based actions
    if analysis["urgency_indicators"]:
        actions.extend([
            "Immediately investigate the reported issue",
            "Run network diagnostics to assess impact",
            "Check system status and availability",
            "Escalate if critical infrastructure is affected"
        ])
    
    # Technical issue actions
    if analysis["technical_issues"]:
        actions.extend([
            "Run relevant network diagnostic commands",
            "Check device configurations and status",
            "Verify connectivity and routing",
            "Review logs for error messages"
        ])
    
    # User request actions
    if analysis["user_requests"]:
        actions.extend([
            "Fulfill the specific user request",
            "Provide detailed status update",
            "Run requested diagnostic commands",
            "Document findings and next steps"
        ])
    
    # Question-based actions
    if analysis["questions"]:
        actions.extend([
            "Provide detailed answers to user questions",
            "Run diagnostic commands to gather information",
            "Check system status and provide updates",
            "Offer additional assistance or clarification"
        ])
    
    # Action item responses
    if analysis["action_items"]:
        actions.extend([
            "Execute the requested actions",
            "Provide status updates on progress",
            "Document completion of tasks",
            "Verify successful implementation"
        ])
    
    # Default actions if no specific patterns found
    if not any(analysis.values()):
        actions.extend([
            "Acknowledge the comment and provide status update",
            "Run basic network diagnostics",
            "Check ticket status and priority",
            "Offer additional assistance"
        ])
    
    return list(set(actions))  # Remove duplicates

def monitor_stdin():
    """Monitor stdin for input and process `tools/discover` or `tools/call`."""
    while True:
        try:
            line = sys.stdin.readline().strip()
            if not line:
                time.sleep(0.1)
                continue

            try:
                data = json.loads(line)
                if isinstance(data, dict) and data.get("method") == "tools/call":
                    handle_tools_call(data)
                elif isinstance(data, dict) and data.get("method") == "tools/discover":
                    handle_tools_discover()

            except json.JSONDecodeError as e:
                logger.error(f"JSON decode error: {e}")

        except Exception as e:
            logger.error(f"Exception in monitor_stdin: {str(e)}")
            time.sleep(0.1)

if __name__ == "__main__":
    logger.info("Starting server")

    # If --oneshot flag is passed, process one request and exit
    if "--oneshot" in sys.argv:
        try:
            line = sys.stdin.readline().strip()
            data = json.loads(line)

            if isinstance(data, dict) and data.get("method") == "tools/call":
                handle_tools_call(data)

            elif isinstance(data, dict) and data.get("method") == "tools/discover":
                handle_tools_discover()

        except Exception as e:
            logger.error(f"Oneshot error: {e}")
            send_response({"error": str(e)})

    else:
        # Default: run as a server
        monitor_stdin()  # Monitor stdin in a blocking manner for multiple requests