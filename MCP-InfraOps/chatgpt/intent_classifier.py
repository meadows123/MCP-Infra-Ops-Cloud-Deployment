#!/usr/bin/env python3
"""
LLM-based Intent Classification for ChatGPT routing

This module classifies user requests using the existing LLM client (OpenAI/Azure/Groq)
to determine which MCP service should handle the request.

Intent categories:
- KNOWLEDGE: Definition, explanation, informational requests
- NETWORK_DEVICE: Network device querying, configuration, automation
- INFRASTRUCTURE: Cloud infrastructure (Terraform, Azure, VMs)
- SERVICENOW: Ticket/incident management
- SEARCH: General web search
- OTHER: Unknown/unclassified
"""

import logging
import json
from typing import Optional, Dict
from enum import Enum
import asyncio

# For Ollama fallback
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

logger = logging.getLogger("intent_classifier")


class RequestIntent(str, Enum):
    """Possible request intents"""
    KNOWLEDGE = "KNOWLEDGE"
    NETWORK_DEVICE = "NETWORK_DEVICE"
    INFRASTRUCTURE = "INFRASTRUCTURE"
    SERVICENOW = "SERVICENOW"
    SEARCH = "SEARCH"
    OTHER = "OTHER"


class IntentClassifier:
    """Classify user requests using the existing LLM client"""

    def __init__(self, client=None, model: str = None):
        """
        Initialize the intent classifier

        Args:
            client: OpenAI/Azure client instance (will be imported from http_server if not provided)
            model: Model name to use (will be auto-detected if not provided)
        """
        self.client = client
        self.model = model

    async def classify(self, user_query: str) -> Dict[str, any]:
        """
        Classify a user request to determine routing

        Args:
            user_query: The user's request text

        Returns:
            Dict with keys:
                - intent: RequestIntent enum value
                - confidence: float 0-1
                - reasoning: str explanation
        """
        # Get client and model if not already set
        if self.client is None:
            try:
                from http_server import client as shared_client, OLLAMA_MODEL, GROQ_MODEL, USE_OLLAMA_FLAG, USE_GROQ_FLAG
                self.client = shared_client
                
                # Determine which model name to use
                if USE_OLLAMA_FLAG:
                    self.model = OLLAMA_MODEL
                elif USE_GROQ_FLAG:
                    self.model = GROQ_MODEL
                elif self.model is None:
                    self.model = "gpt-3.5-turbo"  # Default fallback
            except ImportError:
                logger.error("Could not import LLM client from http_server")
                return self._classify_with_keywords(user_query)
        
        if self.client is None:
            logger.warning("No LLM client available, falling back to keyword matching")
            return self._classify_with_keywords(user_query)
        
        return await self._classify_with_llm(user_query)

    async def _classify_with_llm(self, user_query: str) -> Dict[str, any]:
        """Classify using the existing LLM client (OpenAI/Azure/Groq)"""
        try:
            # System prompt for intent classification
            system_prompt = """You are an expert at classifying user requests for a network automation platform.

Your task is to classify requests into ONE of these categories:
- KNOWLEDGE: User asking for definitions, explanations, or general information (e.g., "What is network automation?", "Explain VLAN", "How does routing work?")
- NETWORK_DEVICE: User wants to query or configure actual network devices (e.g., "Show interface status on R1", "Configure VLAN 10", "Check BGP neighbors")
- INFRASTRUCTURE: User wants to create/manage cloud infrastructure (e.g., "Create Azure VM", "Deploy firewall", "Create VNet", "Set up storage account")
- SERVICENOW: User wants to create/manage tickets or incidents (e.g., "Create a ticket", "Check incident status", "Log a problem")
- SEARCH: User wants a general web search (e.g., "Search for network trends", "Find latest Azure features")
- OTHER: Request doesn't fit above categories

Always respond in JSON format with ONLY these fields:
{
  "intent": "INTENT_HERE",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this intent was chosen"
}

Do not include any text outside the JSON."""

            logger.info(f"🧠 Classifying with LLM: '{user_query}'")

            # Call the LLM
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_query}
                ],
                temperature=0.3,  # Low temperature for consistent classification
                max_tokens=200,
            )

            response_text = response.choices[0].message.content.strip()
            logger.debug(f"LLM response: {response_text}")

            # Parse JSON response
            try:
                result = json.loads(response_text)
                intent_str = result.get("intent", "OTHER").upper()
                confidence = float(result.get("confidence", 0.5))
                reasoning = result.get("reasoning", "LLM classification")

                # Validate intent
                try:
                    intent = RequestIntent[intent_str]
                except KeyError:
                    logger.warning(f"Invalid intent '{intent_str}', defaulting to OTHER")
                    intent = RequestIntent.OTHER

                logger.info(
                    f"✅ Classification: {intent.value} (confidence: {confidence:.2f}) - {reasoning}"
                )

                return {
                    "intent": intent,
                    "confidence": confidence,
                    "reasoning": reasoning,
                    "method": "llm",
                }

            except json.JSONDecodeError:
                logger.warning("Failed to parse LLM JSON response")
                logger.debug(f"Raw response was: {response_text}")
                return self._classify_with_keywords(user_query)

        except Exception as e:
            logger.error(f"LLM classification error: {e}")
            logger.info("Falling back to keyword matching")
            return self._classify_with_keywords(user_query)

    async def _classify_with_ollama(self, user_query: str) -> Dict[str, any]:
        """Classify using local Ollama Mistral model (fallback)"""
        if not REQUESTS_AVAILABLE:
            logger.warning("Requests library not available for Ollama, using keyword matching")
            return self._classify_with_keywords(user_query)
        
        try:
            # Prompt for Mistral to classify the intent
            classification_prompt = f"""You are an expert at classifying user requests for a network automation platform.

Classify the following request into ONE category:
- KNOWLEDGE: User asking for definitions, explanations, or general information (e.g., "What is network automation?", "Explain VLAN", "How does routing work?")
- NETWORK_DEVICE: User wants to query or configure actual network devices (e.g., "Show interface status on R1", "Configure VLAN 10", "Check BGP neighbors")
- INFRASTRUCTURE: User wants to create/manage cloud infrastructure (e.g., "Create Azure VM", "Deploy firewall", "Create VNet", "Set up storage account")
- SERVICENOW: User wants to create/manage tickets or incidents (e.g., "Create a ticket", "Check incident status", "Log a problem")
- SEARCH: User wants a general web search (e.g., "Search for network trends", "Find latest Azure features")
- OTHER: Request doesn't fit above categories

User Request: "{user_query}"

Respond in JSON format:
{{
  "intent": "INTENT_HERE",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this intent was chosen"
}}

IMPORTANT: Return ONLY the JSON, no other text."""

            logger.info(f"🤖 Classifying with Ollama: '{user_query}'")

            ollama_url = "http://localhost:11434"
            
            # Run requests call in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: requests.post(
                    f"{ollama_url}/api/generate",
                    json={
                        "model": "mistral",
                        "prompt": classification_prompt,
                        "stream": False,
                        "temperature": 0.3,  # Low temperature for consistent classification
                    },
                    timeout=30,
                ),
            )

            if response.status_code != 200:
                logger.error(f"Ollama error: {response.text}")
                return self._classify_with_keywords(user_query)

            data = response.json()
            response_text = data.get("response", "").strip()

            logger.debug(f"Ollama response: {response_text}")

            # Parse JSON response
            try:
                result = json.loads(response_text)
                intent_str = result.get("intent", "OTHER").upper()
                confidence = float(result.get("confidence", 0.5))
                reasoning = result.get("reasoning", "Ollama classification")

                # Validate intent
                try:
                    intent = RequestIntent[intent_str]
                except KeyError:
                    logger.warning(f"Invalid intent '{intent_str}', defaulting to OTHER")
                    intent = RequestIntent.OTHER

                logger.info(
                    f"✅ Classification: {intent.value} (confidence: {confidence:.2f}) - {reasoning}"
                )

                return {
                    "intent": intent,
                    "confidence": confidence,
                    "reasoning": reasoning,
                    "method": "ollama",
                }

            except json.JSONDecodeError:
                logger.warning("Failed to parse Ollama JSON response")
                logger.debug(f"Raw response was: {response_text}")
                return self._classify_with_keywords(user_query)

        except Exception as e:
            logger.error(f"Ollama classification error: {e}")
            logger.info("Falling back to keyword matching")
            return self._classify_with_keywords(user_query)

    def _classify_with_keywords(self, user_query: str) -> Dict[str, any]:
        """Fallback keyword-based classification"""
        query_lower = user_query.lower()

        # Define keyword patterns for each intent
        patterns = {
            RequestIntent.INFRASTRUCTURE: [
                "create vm", "create vnet", "create subnet", "create firewall",
                "create azure", "deploy vm", "terraform", "infrastructure",
                "storage account", "app gateway", "resource group",
            ],
            RequestIntent.NETWORK_DEVICE: [
                "show interface", "show version", "configure", "cisco",
                "router", "switch", "device", "testbed", "pyats",
                "r1", "r2", "sw1", "sw2", "vlan", "acl", "bgp",
            ],
            RequestIntent.SERVICENOW: [
                "create ticket", "incident", "problem", "ticket",
                "create problem", "create incident",
            ],
            RequestIntent.KNOWLEDGE: [
                "what is", "explain", "tell me about", "how does",
                "definition of", "describe", "what are", "information about",
            ],
            RequestIntent.SEARCH: [
                "search for", "find", "look up", "research",
            ],
        }

        # Count matches for each intent
        intent_scores = {intent: 0 for intent in RequestIntent}

        for intent, keywords in patterns.items():
            for keyword in keywords:
                if keyword in query_lower:
                    intent_scores[intent] += 1

        # Find intent with highest score
        best_intent = max(intent_scores, key=intent_scores.get)

        if intent_scores[best_intent] == 0:
            best_intent = RequestIntent.OTHER
            confidence = 0.3
        else:
            total = sum(intent_scores.values())
            confidence = intent_scores[best_intent] / total

        logger.info(
            f"⚠️  Fallback classification: {best_intent.value} (confidence: {confidence:.2f}) - keyword match"
        )

        return {
            "intent": best_intent,
            "confidence": confidence,
            "reasoning": f"Keyword match: {best_intent.value}",
            "method": "keywords",
        }


# Singleton instance
_classifier = None


async def get_classifier() -> IntentClassifier:
    """Get or create the intent classifier"""
    global _classifier
    if _classifier is None:
        _classifier = IntentClassifier()
    return _classifier


async def classify_request(user_query: str) -> Dict[str, any]:
    """
    Classify a user request

    Args:
        user_query: The user's request

    Returns:
        Classification result with intent and confidence
    """
    classifier = await get_classifier()
    return await classifier.classify(user_query)
