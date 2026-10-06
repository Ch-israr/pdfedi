"""Reorder the pages of a PDF according to a 1-based permutation."""
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
    """Reorder pages. ``config.order`` is a 1-based permutation of 1..N."""
    check_input_count(inputs, 1, 1, "reorder_pages")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    order = config.get("order")
    if (
        not isinstance(order, list)
        or not order
        or any(not isinstance(x, int) or isinstance(x, bool) for x in order)
    ):
        raise ToolError(
            "INVALID_CONFIG",
            "config.order must be a non-empty list of 1-based page numbers.",
        )
    reader = open_pdf(inputs[0], ctx)
    page_count = len(reader.pages)
    if sorted(order) != list(range(1, page_count + 1)):
        raise ToolError(
            "INVALID_CONFIG",
            f"config.order must be a permutation of pages 1..{page_count}.",
        )
    writer = PdfWriter()
    for i, page_no in enumerate(order):
        writer.add_page(reader.pages[page_no - 1])
        if i % 10 == 0:
            ctx.progress(int(i / len(order) * 90))
    buf = io.BytesIO()
    writer.write(buf)
    ctx.progress(100)
    return ToolResult(
        outputs=[("reordered.pdf", buf.getvalue())],
        meta={"page_count": page_count, "order": order},
    )


register_tool(
    ToolDefinition(
        key="reorder_pages",
        name="Reorder Pages",
        description="Reorder the pages of a PDF using a 1-based page permutation.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.reorder",
        config_schema={
            "type": "object",
            "properties": {
                "order": {
                    "type": "array",
                    "items": {"type": "integer", "minimum": 1},
                    "description": "1-based permutation of pages 1..N, e.g. [3,1,2].",
                }
            },
            "required": ["order"],
            "additionalProperties": False,
        },
        output_description="PDF with pages in the requested order",
        handler=handler,
    )
)
