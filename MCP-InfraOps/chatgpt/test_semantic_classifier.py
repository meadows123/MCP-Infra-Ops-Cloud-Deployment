#!/usr/bin/env python3
"""
Semantic Intent Classification Demo & Test
Run this to see how the semantic classifier understands different requests.

Usage:
    python3 test_semantic_classifier.py

This will test various request types and show how the AI classifies them.
"""

import asyncio
import json
from typing import List, Tuple
from intent_classifier import classify_request, RequestIntent


# Test cases: (request, expected_intent)
TEST_CASES: List[Tuple[str, str]] = [
    # NETWORK_DEVICE - Clear
    ("Show the running configuration on R1", "NETWORK_DEVICE"),
    ("Can you check if the router is online?", "NETWORK_DEVICE"),
    ("Configure VLAN 10 on the switch", "NETWORK_DEVICE"),
    ("What's the BGP status on the core router?", "NETWORK_DEVICE"),
    ("Check connectivity between R1 and R2", "NETWORK_DEVICE"),
    ("Display the interface status on SW1", "NETWORK_DEVICE"),
    
    # INFRASTRUCTURE - Cloud/Terraform
    ("Create an Azure VM with Ubuntu 22.04", "INFRASTRUCTURE"),
    ("Deploy the network infrastructure", "INFRASTRUCTURE"),
    ("Create a new VNet with subnet 10.0.0.0/16", "INFRASTRUCTURE"),
    ("Provision a storage account for backups", "INFRASTRUCTURE"),
    
    # KNOWLEDGE - Definitions/Explanations
    ("What is BGP?", "KNOWLEDGE"),
    ("Explain how OSPF works", "KNOWLEDGE"),
    ("Tell me about network segmentation", "KNOWLEDGE"),
    ("How does VLAN tagging work?", "KNOWLEDGE"),
    
    # SERVICENOW - Ticketing
    ("Create a ServiceNow incident for the outage", "SERVICENOW"),
    ("Log a problem ticket for the network issues", "SERVICENOW"),
    ("Create a change request for the maintenance", "SERVICENOW"),
    
    # SEARCH - Web search
    ("Search for latest network security trends", "SEARCH"),
    ("Find information about SD-WAN", "SEARCH"),
    
    # EDGE CASES - Tricky requests
    ("Tell me about the router's configuration", "NETWORK_DEVICE"),  # "Tell me about" but specific device
    ("What can I do to fix the network?", "NETWORK_DEVICE"),  # Has "What" (KNOWLEDGE keyword) but context is troubleshooting
    ("Check if we need to reconfigure the network", "NETWORK_DEVICE"),  # Has "Check" (query) and "reconfigure" (action)
]


async def test_semantic_classifier():
    """Run semantic classification tests"""
    print("\n" + "="*80)
    print("🧠 SEMANTIC INTENT CLASSIFIER TEST")
    print("="*80 + "\n")
    
    passed = 0
    failed = 0
    
    for request, expected_intent in TEST_CASES:
        try:
            # Classify the request
            result = await classify_request(request)
            intent = result.get("intent", RequestIntent.OTHER)
            confidence = result.get("confidence", 0)
            reasoning = result.get("reasoning", "")
            
            # Check if it matches
            intent_str = intent.value if hasattr(intent, 'value') else str(intent)
            is_correct = intent_str == expected_intent
            
            status = "✅ PASS" if is_correct else "❌ FAIL"
            passed += is_correct
            failed += (1 - is_correct)
            
            print(f"{status} | {intent_str} (confidence: {confidence:.2f})")
            print(f"   Request: {request}")
            print(f"   Expected: {expected_intent}")
            print(f"   Reasoning: {reasoning}")
            print()
            
        except Exception as e:
            print(f"❌ ERROR | Exception during classification")
            print(f"   Request: {request}")
            print(f"   Error: {e}")
            print()
            failed += 1
    
    # Summary
    print("="*80)
    print(f"RESULTS: {passed} passed, {failed} failed out of {len(TEST_CASES)} tests")
    success_rate = (passed / len(TEST_CASES)) * 100
    print(f"Success rate: {success_rate:.1f}%")
    
    if success_rate >= 80:
        print("🎉 Semantic classification is working well!")
    elif success_rate >= 60:
        print("⚠️  Semantic classification needs tuning")
    else:
        print("❌ Semantic classification is unreliable")
    
    print("="*80 + "\n")


async def interactive_demo():
    """Run an interactive demo"""
    print("\n" + "="*80)
    print("🧠 SEMANTIC INTENT CLASSIFIER - INTERACTIVE DEMO")
    print("="*80)
    print("Enter requests to see how the AI classifies them.")
    print("Type 'quit' to exit.\n")
    
    while True:
        request = input("Your request> ").strip()
        
        if request.lower() in ('quit', 'exit', 'q'):
            break
        
        if not request:
            continue
        
        try:
            result = await classify_request(request)
            intent = result.get("intent", RequestIntent.OTHER)
            confidence = result.get("confidence", 0)
            reasoning = result.get("reasoning", "")
            method = result.get("method", "unknown")
            
            intent_str = intent.value if hasattr(intent, 'value') else str(intent)
            
            print(f"\n📊 Classification Result:")
            print(f"   Intent: {intent_str}")
            print(f"   Confidence: {confidence:.1%}")
            print(f"   Method: {method}")
            print(f"   Reasoning: {reasoning}")
            print()
            
        except Exception as e:
            print(f"❌ Error: {e}\n")


async def main():
    """Main entry point"""
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == '--interactive':
        await interactive_demo()
    else:
        await test_semantic_classifier()


if __name__ == "__main__":
    asyncio.run(main())
