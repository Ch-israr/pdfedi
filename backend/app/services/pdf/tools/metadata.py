"""Inspect PDF metadata; output a .json file and mirror it in ToolResult.meta."""
from __future__ import annotations

import io
import json
from typing import Any

from pypdf import PdfReader

from app.services.pdf.registry import (
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolResult,
    register_tool,
)
from app.services.pdf.tools._common import check_input_count

_METADATA_FIELDS = (
    ("title", "/Title"),
    ("author", "/Author"),
    ("subject", "/Subject"),
    ("keywords", "/Keywords"),
    ("creator", "/Creator"),
    ("producer", "/Producer"),
)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Read document metadata without modifying the PDF."""
    check_input_count(inputs, 1, 1, "metadata")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    data = inputs[0]
    if not isinstance(data, bytes) or not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            "INVALID_INPUT", "Input is not a valid PDF file (missing %PDF- header)."
        )
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise ToolError(
            "INVALID_INPUT", f"Input could not be parsed as a PDF: {exc}"
        ) from exc

    encrypted = bool(getattr(reader, "is_encrypted", False))
    payload: dict[str, Any] = {
        "title": None,
        "author": None,
        "subject": None,
        "keywords": None,
        "creator": None,
        "producer": None,
        "page_count": None,
        "encrypted": encrypted,
        "has_forms": None,
    }
    if not encrypted:
        info = reader.metadata or {}
        for name, pdf_key in _METADATA_FIELDS:
            payload[name] = _text(info.get(pdf_key))
        try:
            payload["page_count"] = len(reader.pages)
        except Exception:
            payload["page_count"] = None
        try:
            payload["has_forms"] = reader.get_fields() is not None
        except Exception:
            payload["has_forms"] = None
    ctx.progress(100)
    blob = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    return ToolResult(outputs=[("metadata.json", blob)], meta=payload)


register_tool(
    ToolDefinition(
        key="metadata",
        name="Inspect Metadata",
        description="Read a PDF's document metadata and structure into JSON.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.metadata",
        config_schema={
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        output_description="JSON file with document metadata",
        handler=handler,
    )
)
