"""Modular PDF tool registry.

Each tool is an independent plugin that declares:
- identity (key, name, version), accepted inputs, limits
- JSON schemas for its configuration and outputs
- the entitlement required and its feature flag
- a pure handler: bytes in -> bytes out (no DB, no HTTP, no secrets)

The registry is the single place the API and workers discover tools.
Adding a tool = new module under ``tools/`` + one import here.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class ToolError(Exception):
    """Expected tool failure -> maps to a safe client error code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ToolContext:
    job_id: str
    work_dir: Path
    max_pages: int
    max_upload_mb: int
    progress: Callable[[int], None]  # 0..100


@dataclass
class ToolResult:
    outputs: list[tuple[str, bytes]]  # (suggested filename, file bytes)
    meta: dict[str, Any] = field(default_factory=dict)


# handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult
ToolHandler = Callable[[list[bytes], dict[str, Any], ToolContext], ToolResult]


@dataclass
class ToolDefinition:
    key: str  # e.g. "merge"
    name: str
    description: str
    version: str = "1.0.0"
    accepted_types: list[str] = field(default_factory=lambda: ["pdf"])
    min_inputs: int = 1
    max_inputs: int = 1
    required_entitlement: str = ""  # e.g. "tool.merge"; empty = all plans
    feature_flag: str = ""  # e.g. "tool.merge"
    config_schema: dict[str, Any] = field(default_factory=dict)
    output_description: str = "PDF file"
    handler: ToolHandler | None = None


_REGISTRY: dict[str, ToolDefinition] = {}


def register_tool(defn: ToolDefinition) -> None:
    if defn.key in _REGISTRY:
        raise ValueError(f"Tool already registered: {defn.key}")
    if defn.handler is None:
        raise ValueError(f"Tool {defn.key} has no handler")
    _REGISTRY[defn.key] = defn


def get_tool(key: str) -> ToolDefinition | None:
    return _REGISTRY.get(key)


def list_tools() -> list[ToolDefinition]:
    return sorted(_REGISTRY.values(), key=lambda t: t.key)


def _load_builtin_tools() -> None:
    # Imported here to avoid circulars; each module calls register_tool().
    from app.services.pdf.tools import (  # noqa: F401
        compress,
        delete_pages,
        edit_metadata,
        extract_text,
        flatten,
        images_to_pdf,
        merge,
        metadata,
        page_numbers,
        password_protect,
        pdf_to_images,
        redact,
        reorder_pages,
        rotate_pages,
        split,
        thumbnails,
        watermark,
    )

    # OCR is optional: requires Tesseract system binary; registers only if available.
    try:
        from app.services.pdf.tools import ocr  # noqa: F401
    except Exception:
        pass


_load_builtin_tools()
