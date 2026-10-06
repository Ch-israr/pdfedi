"""Add configurable page numbers to a PDF (reportlab + pypdf)."""
from __future__ import annotations

import io
from typing import Any

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import black
from reportlab.pdfgen import canvas

from app.services.pdf.registry import (
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolResult,
    register_tool,
)
from app.services.pdf.tools._common import check_input_count, open_pdf, resolve_pages

_VALID_VPOS = ("top", "bottom")
_VALID_HPOS = ("left", "center", "right")


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Stamp page numbers. Position, start number, prefix/suffix configurable."""
    check_input_count(inputs, 1, 1, "page_numbers")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")

    vpos = config.get("vertical", "bottom")
    hpos = config.get("horizontal", "center")
    start = config.get("start_number", 1)
    prefix = config.get("prefix", "")
    suffix = config.get("suffix", "")
    font_size = config.get("font_size", 10)

    if vpos not in _VALID_VPOS:
        raise ToolError("INVALID_CONFIG", f"vertical must be one of {_VALID_VPOS}")
    if hpos not in _VALID_HPOS:
        raise ToolError("INVALID_CONFIG", f"horizontal must be one of {_VALID_HPOS}")
    if not isinstance(start, int) or start < 1:
        raise ToolError("INVALID_CONFIG", "start_number must be a positive integer.")
    if not isinstance(font_size, int) or not 6 <= font_size <= 48:
        raise ToolError("INVALID_CONFIG", "font_size must be between 6 and 48.")

    reader = open_pdf(inputs[0], ctx)
    page_count = len(reader.pages)
    pages = resolve_pages(config.get("pages"), page_count)
    page_set = set(pages)

    writer = PdfWriter()
    margin = 36  # 0.5 inch
    for i, page in enumerate(reader.pages):
        page_no = i + 1
        if page_no in page_set:
            mediabox = page.mediabox
            pw = float(mediabox.width)
            ph = float(mediabox.height)

            # Number for this page (1-based within the selected set)
            idx = pages.index(page_no)
            number_text = f"{prefix}{start + idx}{suffix}"

            buf = io.BytesIO()
            c = canvas.Canvas(buf, pagesize=(pw, ph))
            c.setFillColor(black)
            c.setFont("Helvetica", font_size)

            y = ph - margin if vpos == "top" else margin
            if hpos == "left":
                c.drawString(margin, y, number_text)
            elif hpos == "right":
                c.drawRightString(pw - margin, y, number_text)
            else:
                c.drawCentredString(pw / 2, y, number_text)
            c.save()

            overlay = PdfReader(buf).pages[0]
            page.merge_page(overlay)

        writer.add_page(page)
        ctx.progress(int((i + 1) / page_count * 90))

    out_buf = io.BytesIO()
    writer.write(out_buf)
    ctx.progress(100)
    return ToolResult(
        outputs=[("numbered.pdf", out_buf.getvalue())],
        meta={
            "pages_numbered": len(pages),
            "start_number": start,
            "position": f"{vpos}-{hpos}",
        },
    )


register_tool(
    ToolDefinition(
        key="page_numbers",
        name="Add Page Numbers",
        description="Stamp configurable page numbers (position, start, prefix/suffix).",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.page_numbers",
        config_schema={
            "type": "object",
            "properties": {
                "vertical": {"type": "string", "enum": ["top", "bottom"], "default": "bottom"},
                "horizontal": {"type": "string", "enum": ["left", "center", "right"], "default": "center"},
                "start_number": {"type": "integer", "minimum": 1, "default": 1},
                "prefix": {"type": "string", "default": ""},
                "suffix": {"type": "string", "default": ""},
                "font_size": {"type": "integer", "minimum": 6, "maximum": 48, "default": 10},
                "pages": {
                    "type": ["string", "null"],
                    "description": "1-based ranges like '1-3'; null = all pages.",
                    "default": None,
                },
            },
            "additionalProperties": False,
        },
        output_description="PDF with page numbers",
        handler=handler,
    )
)
