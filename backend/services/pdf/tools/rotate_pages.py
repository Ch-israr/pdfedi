"""Rotate selected pages of a PDF by 90, 180 or 270 degrees."""
from __future__ import annotations

import io
from typing import Any

from pypdf import PdfWriter

from app.services.pdf.registry import (
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolResult,
    register_tool,
)
from app.services.pdf.tools._common import check_input_count, open_pdf, resolve_pages

_ALLOWED_ROTATIONS = (90, 180, 270)


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Rotate pages clockwise. ``config.pages`` null means all pages."""
    check_input_count(inputs, 1, 1, "rotate_pages")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    rotation = config.get("rotation")
    if rotation not in _ALLOWED_ROTATIONS:
        raise ToolError(
            "INVALID_CONFIG",
            f"config.rotation must be one of {_ALLOWED_ROTATIONS}.",
        )
    reader = open_pdf(inputs[0], ctx)
    page_count = len(reader.pages)
    pages = resolve_pages(config.get("pages"), page_count)
    writer = PdfWriter()
    selected = set(pages)
    for i, page in enumerate(reader.pages):
        if (i + 1) in selected:
            page.rotate(rotation)
        writer.add_page(page)
        if i % 10 == 0:
            ctx.progress(int(i / page_count * 90))
    buf = io.BytesIO()
    writer.write(buf)
    ctx.progress(100)
    return ToolResult(
        outputs=[("rotated.pdf", buf.getvalue())],
        meta={"rotation": rotation, "rotated_pages": pages, "page_count": page_count},
    )


register_tool(
    ToolDefinition(
        key="rotate_pages",
        name="Rotate Pages",
        description="Rotate selected pages of a PDF clockwise by 90, 180 or 270 degrees.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.rotate",
        config_schema={
            "type": "object",
            "properties": {
                "rotation": {"type": "integer", "enum": [90, 180, 270]},
                "pages": {
                    "type": ["string", "null"],
                    "description": "1-based ranges like '1-3,5'; null = all pages.",
                    "default": None,
                },
            },
            "required": ["rotation"],
            "additionalProperties": False,
        },
        output_description="PDF with rotated pages",
        handler=handler,
    )
)
