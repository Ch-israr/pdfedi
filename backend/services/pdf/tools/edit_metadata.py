"""Edit or remove PDF metadata fields; output the modified PDF."""
from __future__ import annotations

import io
from typing import Any

from pypdf import PdfReader, PdfWriter

from app.services.pdf.registry import (
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolResult,
    register_tool,
)
from app.services.pdf.tools._common import check_input_count, open_pdf

# Writable metadata fields (PDF info dictionary keys)
_WRITABLE_FIELDS = {
    "title": "/Title",
    "author": "/Author",
    "subject": "/Subject",
    "keywords": "/Keywords",
    "creator": "/Creator",
    "producer": "/Producer",
}


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Set or clear metadata fields. Empty string / null clears the field."""
    check_input_count(inputs, 1, 1, "edit_metadata")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")

    fields = config.get("fields", {})
    if not isinstance(fields, dict):
        raise ToolError("INVALID_CONFIG", "config.fields must be an object.")
    remove_all = bool(config.get("remove_all", False))

    # Validate field names
    for key in fields:
        if key not in _WRITABLE_FIELDS:
            raise ToolError(
                "INVALID_CONFIG",
                f"Unknown metadata field '{key}'. Allowed: {sorted(_WRITABLE_FIELDS)}",
            )

    reader = open_pdf(inputs[0], ctx)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)

    if remove_all:
        # Clear all standard metadata fields
        writer.add_metadata({k: "" for k in _WRITABLE_FIELDS.values()})
    else:
        meta = {}
        for key, pdf_key in _WRITABLE_FIELDS.items():
            if key in fields:
                val = fields[key]
                # None or empty string clears the field
                meta[pdf_key] = "" if val is None else str(val)
        if meta:
            writer.add_metadata(meta)

    buf = io.BytesIO()
    writer.write(buf)
    out = buf.getvalue()
    ctx.progress(100)

    return ToolResult(
        outputs=[("metadata-updated.pdf", out)],
        meta={
            "fields_updated": list(fields.keys()) if not remove_all else "all_cleared",
            "remove_all": remove_all,
        },
    )


register_tool(
    ToolDefinition(
        key="edit_metadata",
        name="Edit Metadata",
        description="Set, update, or remove PDF metadata (title, author, subject, keywords, etc.).",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.edit_metadata",
        config_schema={
            "type": "object",
            "properties": {
                "fields": {
                    "type": "object",
                    "description": "Fields to set. Null/empty string clears a field.",
                    "properties": {
                        "title": {"type": ["string", "null"]},
                        "author": {"type": ["string", "null"]},
                        "subject": {"type": ["string", "null"]},
                        "keywords": {"type": ["string", "null"]},
                        "creator": {"type": ["string", "null"]},
                        "producer": {"type": ["string", "null"]},
                    },
                    "additionalProperties": False,
                },
                "remove_all": {
                    "type": "boolean",
                    "default": False,
                    "description": "Remove all metadata fields.",
                },
            },
            "additionalProperties": False,
        },
        output_description="PDF with updated metadata",
        handler=handler,
    )
)
