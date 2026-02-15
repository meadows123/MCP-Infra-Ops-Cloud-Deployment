#!/usr/bin/env python3
"""
Command Execution Telemetry & Autonomous Monitoring
Tracks command success/failure rates and automatically alerts when regressions occur.
"""

import json
import logging
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, List, Optional
from enum import Enum

logger = logging.getLogger("telemetry")


class ExecutionStatus(Enum):
    """Execution status values"""
    SUCCESS = "success"
    FAILURE = "failure"
    TIMEOUT = "timeout"
    INVALID_COMMAND = "invalid_command"
    NO_DEVICE = "no_device"
    UNKNOWN = "unknown"


class CommandTelemetry:
    """Track command execution metrics to detect broken code patterns"""
    
    def __init__(self, retention_seconds: int = 3600):
        self.retention_seconds = retention_seconds
        
        # Metrics per device
        self.device_metrics: Dict[str, Dict] = defaultdict(lambda: {
            "total": 0,
            "success": 0,
            "failure": 0,
            "timeout": 0,
            "avg_duration_ms": 0,
            "last_execution": None,
            "status_history": []
        })
        
        # Metrics per command type
        self.command_metrics: Dict[str, Dict] = defaultdict(lambda: {
            "total": 0,
            "success": 0,
            "failure": 0,
            "devices_failed_on": set(),
        })
        
        # Alert thresholds
        self.alert_thresholds = {
            "failure_rate": 0.3,  # Alert if >30% of commands fail
            "consecutive_failures": 5,  # Alert after 5 consecutive failures
        }
    
    def record_execution(
        self,
        device: str,
        command: str,
        status: ExecutionStatus,
        duration_ms: Optional[float] = None,
        error_msg: Optional[str] = None,
        output: Optional[str] = None
    ) -> Optional[Dict]:
        """
        Record a command execution and return alerts if thresholds exceeded.
        
        Args:
            device: Device name (e.g., "R1")
            command: Normalized command (e.g., "show running-config")
            status: ExecutionStatus enum value
            duration_ms: Execution duration in milliseconds
            error_msg: Error message if execution failed
            output: Command output
        
        Returns:
            Alert dictionary if thresholds exceeded, None otherwise
        """
        timestamp = datetime.now()
        
        # Update device metrics
        dev_stats = self.device_metrics[device]
        dev_stats["total"] += 1
        dev_stats["last_execution"] = timestamp.isoformat()
        
        if status == ExecutionStatus.SUCCESS:
            dev_stats["success"] += 1
            dev_stats["status_history"].append(("success", timestamp))
        else:
            dev_stats["failure"] += 1
            dev_stats["status_history"].append((status.value, timestamp))
        
        if duration_ms is not None:
            # Exponential moving average for duration
            alpha = 0.3
            current_avg = dev_stats.get("avg_duration_ms", 0)
            dev_stats["avg_duration_ms"] = alpha * duration_ms + (1 - alpha) * current_avg
        
        # Keep only recent history
        cutoff = timestamp - timedelta(seconds=self.retention_seconds)
        dev_stats["status_history"] = [
            (s, t) for s, t in dev_stats["status_history"]
            if t > cutoff
        ]
        
        # Update command metrics
        cmd_stats = self.command_metrics[command]
        cmd_stats["total"] += 1
        
        if status == ExecutionStatus.SUCCESS:
            cmd_stats["success"] += 1
        else:
            cmd_stats["failure"] += 1
            cmd_stats["devices_failed_on"].add(device)
        
        # Check for alerts
        alerts = self._check_alerts(device, command)
        
        if alerts:
            for alert in alerts:
                logger.warning(f"🚨 ALERT: {alert}")
        
        return alerts if alerts else None
    
    def _check_alerts(self, device: str, command: str) -> List[str]:
        """Check if thresholds exceeded and return alert messages"""
        alerts = []
        
        dev_stats = self.device_metrics[device]
        cmd_stats = self.command_metrics[command]
        
        # Check failure rate
        if dev_stats["total"] >= 10:  # Need at least 10 samples
            failure_rate = dev_stats["failure"] / dev_stats["total"]
            if failure_rate > self.alert_thresholds["failure_rate"]:
                alerts.append(
                    f"HIGH FAILURE RATE on {device}: {failure_rate:.1%} "
                    f"({dev_stats['failure']}/{dev_stats['total']} failed)"
                )
        
        # Check consecutive failures
        recent_history = dev_stats["status_history"][-10:]  # Last 10 executions
        consecutive_fails = 0
        for status, _ in reversed(recent_history):
            if status != "success":
                consecutive_fails += 1
            else:
                break
        
        if consecutive_fails >= self.alert_thresholds["consecutive_failures"]:
            alerts.append(
                f"CONSECUTIVE FAILURES on {device}: {consecutive_fails} in a row - "
                f"possible code regression!"
            )
        
        # Check if command fails on multiple devices (code issue, not device-specific)
        if len(cmd_stats["devices_failed_on"]) >= 3:  # Failed on 3+ devices
            alerts.append(
                f"COMMAND REGRESSION: '{command}' failing on multiple devices "
                f"({', '.join(cmd_stats['devices_failed_on'])}) - likely code issue"
            )
        
        return alerts
    
    def get_health_report(self) -> Dict:
        """Generate a health report of all devices and commands"""
        report = {
            "timestamp": datetime.now().isoformat(),
            "devices": {},
            "commands": {},
            "alerts": []
        }
        
        # Device health
        for device, metrics in self.device_metrics.items():
            if metrics["total"] > 0:
                success_rate = metrics["success"] / metrics["total"]
                report["devices"][device] = {
                    "success_rate": success_rate,
                    "total": metrics["total"],
                    "success": metrics["success"],
                    "failure": metrics["failure"],
                    "avg_duration_ms": round(metrics.get("avg_duration_ms", 0), 2),
                    "status": "🟢 healthy" if success_rate >= 0.9 else "🟡 degraded" if success_rate >= 0.7 else "🔴 critical"
                }
        
        # Command health
        for command, metrics in self.command_metrics.items():
            if metrics["total"] > 0:
                success_rate = metrics["success"] / metrics["total"]
                report["commands"][command] = {
                    "success_rate": success_rate,
                    "total": metrics["total"],
                    "failed_on": list(metrics["devices_failed_on"]),
                    "status": "🟢 healthy" if success_rate >= 0.9 else "🟡 degraded" if success_rate >= 0.7 else "🔴 critical"
                }
        
        return report
    
    def export_metrics(self, filepath: str):
        """Export metrics to JSON file for analysis"""
        report = self.get_health_report()
        with open(filepath, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        logger.info(f"📊 Metrics exported to {filepath}")


# Global telemetry instance
telemetry = CommandTelemetry()


def record_execution(
    device: str,
    command: str,
    status: ExecutionStatus,
    duration_ms: Optional[float] = None,
    error_msg: Optional[str] = None,
    output: Optional[str] = None
):
    """Convenience function to record execution through global telemetry"""
    return telemetry.record_execution(device, command, status, duration_ms, error_msg, output)


def get_health_report() -> Dict:
    """Get current health report"""
    return telemetry.get_health_report()
