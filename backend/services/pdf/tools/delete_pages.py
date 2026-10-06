"""Delete selected pages from a PDF (at least one page must remain)."""
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
from app.services.pdf.tools._common import (
    check_input_count,
    open_pdf,
    parse_page_ranges,
)


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Delete the pages listed in ``config.pages`` (1-based ranges)."""
    check_input_count(inputs, 1, 1, "delete_pages")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    spec = config.get("pages")
    if spec is None:
        raise ToolError(
            "INVALID_CONFIG", "config.pages is required, e.g. '1,3,5-7'."
        )
    reader = open_pdf(inputs[0], ctx)
    page_count = len(reader.pages)
    pages = parse_page_ranges(spec)
    out_of_range = [p for p in pages if p > page_count]
    if out_of_range:
        raise ToolError(
            "INVALID_CONFIG",
            f"Page(s) {out_of_range} exceed the document page count ({page_count}).",
        )
    if len(pages) >= page_count:
        raise ToolError(
            "INVALID_CONFIG",
            "Cannot delete every page; at least one page must remain.",
        )
    doomed = set(pages)
    writer = PdfWriter()
    kept = 0
    for i, page in enumerate(reader.pages):
        if (i + 1) not in doomed:
            writer.add_page(page)
            kept += 1
        if i % 10 == 0:
            ctx.progress(int(i / page_count * 90))
    buf = io.BytesIO()
    writer.write(buf)
    ctx.progress(100)
    return ToolResult(
        outputs=[("pages-deleted.pdf", buf.getvalue())],
        meta={"deleted_pages": pages, "page_count": kept},
    )


register_tool(
    ToolDefinition(
        key="delete_pages",
        name="Delete Pages",
        description="Remove selected pages from a PDF; at least one page must remain.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.delete_pages",
        config_schema={
            "type": "object",
            "properties": {
                "pages": {
                    "type": "string",
                    "description": "1-based pages to delete, e.g. '1,3,5-7'.",
                }
            },
            "required": ["pages"],
            "additionalProperties": False,
        },
        output_description="PDF with the selected pages removed",
        handler=handler,
    )
)
