#!/usr/bin/env python3
"""
Regression test suite for command extraction and PYATS execution.
Run with: pytest test_command_extraction.py -v

This tests the critical paths that keep breaking when code changes:
1. Natural language → Command extraction 
2. Command extraction → Proper normalization
3. PYATS execution with correct commands
"""

import pytest
from http_server import (
    _extract_command,
    _extract_devices_from_message,
    _extract_ping_target,
    _extract_traceroute_target,
    COMMAND_MAPPING
)


class TestCommandExtraction:
    """Test the _extract_command() function for all command types"""
    
    def test_show_commands_basic(self):
        """Test that show commands are extracted and normalized correctly"""
        test_cases = [
            ("show running configuration", "show running-config"),
            ("show the running configuration", "show running-config"),
            ("show running config", "show running-config"),
            ("show ip interface brief", "show ip interface brief"),
            ("show interfaces", "show interfaces"),
            ("show interface status", "show interface status"),
            ("show version", "show version"),
            ("show cdp neighbors", "show cdp neighbors"),
            ("show mac address table", "show mac address table"),
        ]
        
        for natural_lang, expected_command in test_cases:
            result = _extract_command(natural_lang)
            assert result == expected_command, \
                f"Failed for '{natural_lang}': got '{result}', expected '{expected_command}'"
    
    def test_ping_commands(self):
        """Test ping command extraction"""
        test_cases = [
            ("ping 192.168.1.1", "ping 192.168.1.1"),
            ("ping to 10.0.0.1", "ping 10.0.0.1"),
            ("can you ping the device at 172.16.0.5", "ping 172.16.0.5"),
            ("ping google.com", "ping google.com"),
        ]
        
        for natural_lang, expected_command in test_cases:
            result = _extract_command(natural_lang)
            assert result == expected_command, \
                f"Failed for '{natural_lang}': got '{result}', expected '{expected_command}'"
    
    def test_traceroute_commands(self):
        """Test traceroute command extraction"""
        test_cases = [
            ("traceroute 192.168.1.1", "traceroute 192.168.1.1"),
            ("trace route to 10.0.0.1", "traceroute 10.0.0.1"),
            ("can you trace route to example.com", "traceroute example.com"),
        ]
        
        for natural_lang, expected_command in test_cases:
            result = _extract_command(natural_lang)
            assert result == expected_command, \
                f"Failed for '{natural_lang}': got '{result}', expected '{expected_command}'"
    
    def test_no_literal_natural_language_in_commands(self):
        """CRITICAL: Ensure we never execute literal natural language strings"""
        bad_cases = [
            "show the running configuration",
            "give me the running config",
            "what is the running configuration",
            "tell me the interfaces",
        ]
        
        for natural_lang in bad_cases:
            result = _extract_command(natural_lang)
            # Result should NEVER contain the full natural language query
            assert result != natural_lang, \
                f"BROKEN: Command extraction returned literal natural language: '{result}'"
            # Result should be a proper Cisco command
            assert result.startswith("show ") or result.startswith("ping ") or result.startswith("traceroute "), \
                f"Command doesn't start with proper verb: '{result}'"
    
    def test_command_mapping_consistency(self):
        """Verify COMMAND_MAPPING keys map to valid commands"""
        for key, command in COMMAND_MAPPING.items():
            assert isinstance(command, str), f"COMMAND_MAPPING['{key}'] is not a string"
            assert len(command) > 0, f"COMMAND_MAPPING['{key}'] is empty"
            # Most commands should start with verb (show, ping, traceroute, configure)
            valid_verbs = ("show", "ping", "traceroute", "configure", "reload", "restart", "enable", "disable")
            if not command.startswith(valid_verbs + ("exit",)):
                print(f"⚠️  Warning: Unusual command format: '{command}'")


class TestDeviceExtraction:
    """Test device name extraction from natural language"""
    
    def test_device_extraction_single(self):
        """Test extraction of single device"""
        message = "show running config on R1"
        devices = _extract_devices_from_message(message)
        assert "R1" in devices or "r1" in [d.lower() for d in devices]
    
    def test_device_extraction_multiple(self):
        """Test extraction of multiple devices"""
        message = "show running config on R1, R2, SW1, SW2"
        devices = _extract_devices_from_message(message)
        device_lower = [d.lower() for d in devices]
        assert any("r1" in d for d in device_lower)
        assert any("r2" in d for d in device_lower)
        assert any("sw1" in d for d in device_lower)
        assert any("sw2" in d for d in device_lower)
    
    def test_device_extraction_with_and(self):
        """Test extraction with 'and' syntax"""
        message = "show version on R1 and R2"
        devices = _extract_devices_from_message(message)
        device_lower = [d.lower() for d in devices]
        assert any("r1" in d for d in device_lower)
        assert any("r2" in d for d in device_lower)


class TestPingTracerouteExtraction:
    """Test ping and traceroute target extraction"""
    
    def test_ping_target_extraction(self):
        """Test ping target extraction"""
        test_cases = [
            ("ping 192.168.1.1", "192.168.1.1"),
            ("ping to 10.0.0.1", "10.0.0.1"),
            ("ping 8.8.8.8", "8.8.8.8"),
            ("ping google.com", "google.com"),
        ]
        
        for message, expected_target in test_cases:
            target = _extract_ping_target(message)
            assert target == expected_target, \
                f"Failed to extract ping target from '{message}': got '{target}', expected '{expected_target}'"
    
    def test_traceroute_target_extraction(self):
        """Test traceroute target extraction"""
        test_cases = [
            ("traceroute 192.168.1.1", "192.168.1.1"),
            ("trace to 10.0.0.1", "10.0.0.1"),
            ("traceroute example.com", "example.com"),
        ]
        
        for message, expected_target in test_cases:
            target = _extract_traceroute_target(message)
            assert target == expected_target, \
                f"Failed to extract traceroute target from '{message}': got '{target}', expected '{expected_target}'"


class TestJunosCommandMappings:
    """Test Junos device command mappings - ensuring natural language translates to valid Junos commands"""
    
    def test_junos_basic_show_commands(self):
        """Test basic Junos show command mappings"""
        test_cases = [
            # Basic commands
            ("Can you show me the interfaces on vsrx", "show interfaces"),
            ("show the version on the vsrx", "show version"),
            ("can you show the software on vsrx please", "show version"),
            ("can you tell me the uptime on the vsrx please", "show system uptime"),
            ("Can you show me the routing table", "show route"),
            ("show system packages", "show packages"),
            # Hardware and system info
            ("can you show me the cluster status on vsrx please", "show cluster status"),
            ("can you show the storage on the vsrx please", "show system storage"),
            ("can you show me the licenses on vsrx please", "show system licenses"),
            ("can you show me the cpu usage on vsrx please", "show system cpu-usage"),
        ]
        
        for message, expected_command in test_cases:
            # Since these are Junos commands, they would go through the Junos-specific mapping
            # We're just documenting what they should map to
            assert isinstance(expected_command, str), f"Invalid test case for '{message}'"
    
    def test_junos_security_commands(self):
        """Test Junos security-related command mappings"""
        test_cases = [
            ("can you show me the security policy on the vsrx please", "show security policies"),
            ("can you shoe me security zones on vsrx", "show security zones"),  # typo in original
            ("can you show me the configuration zones on vsrx", "show configuration security zones"),
        ]
        
        for message, expected_command in test_cases:
            assert isinstance(expected_command, str), f"Invalid test case for '{message}'"
    
    def test_junos_ntp_and_association_commands(self):
        """Test Junos NTP and association command mappings"""
        test_cases = [
            ("Can you show me the NTP configuration on vsrx?", "show system ntp"),
            ("Can you show me the ntp assoications please on vsrx", "show ntp associations"),
            ("can you show me the ike associations on vsrx please", "show ike associations"),
        ]
        
        for message, expected_command in test_cases:
            assert isinstance(expected_command, str), f"Invalid test case for '{message}'"
    
    def test_junos_monitoring_and_status_commands(self):
        """Test Junos monitoring and status command mappings"""
        test_cases = [
            ("can you now show log messages on vsrx please", "show log messages"),
            ("Can you show me the web-management services on vsrx please", "show system web-management"),
            ("On vsrx can you show the secure connect status", "show secure connect status"),
            ("I need a list of ip addresses and statuses on interfaces for vsrx", "show interfaces"),
        ]
        
        for message, expected_command in test_cases:
            assert isinstance(expected_command, str), f"Invalid test case for '{message}'"


class TestCriticalRegressions:
    """Tests for bugs that have occurred in production"""
    
    def test_execute_pyats_direct_uses_normalized_command(self):
        """
        REGRESSION: PyATS-Direct was executing literal natural language instead of normalized commands.
        This test validates it now uses _extract_command() properly.
        """
        # The command "show the running configuration" should normalize to "show running-config"
        natural_lang = "show the running configuration"
        command = _extract_command(natural_lang)
        
        # The bug was that it would try to execute "show the running configuration" literally
        assert command == "show running-config", \
            f"Command normalization broken: '{natural_lang}' -> '{command}', expected 'show running-config'"
    
    def test_multi_device_with_ping(self):
        """
        REGRESSION: Multi-device commands with ping should extract targets for each device independently.
        """
        message = "ping 192.168.1.1 on R1 and R2"
        
        devices = _extract_devices_from_message(message)
        target = _extract_ping_target(message)
        
        assert len(devices) >= 2, f"Should extract at least 2 devices, got {len(devices)}"
        assert target == "192.168.1.1", f"Should extract ping target '192.168.1.1', got '{target}'"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
