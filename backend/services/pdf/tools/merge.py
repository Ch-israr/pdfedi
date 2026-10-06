"""Merge multiple PDFs into one, preserving input order."""
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
from app.services.pdf.tools._common import check_input_count, open_pdf


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Merge input PDFs in order into a single PDF document."""
    check_input_count(inputs, 2, 50, "merge")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    writer = PdfWriter()
    total_pages = 0
    for i, data in enumerate(inputs):
        reader = open_pdf(data, ctx)
        for page in reader.pages:
            writer.add_page(page)
        total_pages += len(reader.pages)
        ctx.progress(int((i + 1) / len(inputs) * 90))
    out = io.BytesIO()
    writer.write(out)
    ctx.progress(100)
    return ToolResult(
        outputs=[("merged.pdf", out.getvalue())],
        meta={"input_files": len(inputs), "page_count": total_pages},
    )


register_tool(
    ToolDefinition(
        key="merge",
        name="Merge PDFs",
        description="Combine two or more PDF files into a single PDF, preserving input order.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=2,
        max_inputs=50,
        required_entitlement="tool.merge",
        config_schema={
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        output_description="Single merged PDF file",
        handler=handler,
    )
)
