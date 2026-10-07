"""Sandbox tool registry — explicit opt-in only.

Add ONLY the specific tool(s) currently under test. Never copy production
tools here. Format: {"<module>": "<key>"} where <module> is the file under
sandbox/tools/ (without .py) and <key> matches the tool's SPEC.key.
"""
from __future__ import annotations

SANDBOX_TOOLS: dict[str, str] = {
    # "my_experiment": "my_experiment",
}
