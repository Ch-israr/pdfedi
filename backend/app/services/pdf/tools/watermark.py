"""Stamp a diagonal text watermark on every page (reportlab + pypdf, no PyMuPDF)."""
from __future__ import annotations

import io
from typing import Any

from app.services.pdf.registry import (
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolResult,
    register_tool,
)
from app.services.pdf.tools._common import check_input_count, open_pdf

_MAX_TEXT_LEN = 100


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Overlay diagonal watermark text on every page of the PDF."""
    check_input_count(inputs, 1, 1, "watermark")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    text = config.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ToolError("INVALID_CONFIG", "config.text is required and must be non-empty.")
    if len(text) > _MAX_TEXT_LEN:
        raise ToolError(
            "INVALID_CONFIG",
            f"config.text must be at most {_MAX_TEXT_LEN} characters.",
        )
    opacity = config.get("opacity", 0.2)
    if (
        not isinstance(opacity, (int, float))
        or isinstance(opacity, bool)
        or not 0.1 <= float(opacity) <= 0.5
    ):
        raise ToolError(
            "INVALID_CONFIG", "config.opacity must be a number between 0.1 and 0.5."
        )

    reader = open_pdf(inputs[0], ctx)  # header + parse + page-limit validation
    page_count = len(reader.pages)

    # Build watermark with reportlab (BSD), overlay with pypdf.
    # No PyMuPDF (AGPL) — see ARCHITECTURE.md Decision 2.
    from pypdf import PdfReader, PdfWriter
    from reportlab.lib.colors import Color
    from reportlab.pdfgen import canvas

    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        # Get page dimensions
        mediabox = page.mediabox
        pw = float(mediabox.width)
        ph = float(mediabox.height)

        # Create watermark overlay for this page size
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(pw, ph))
        # Semi-transparent gray
        c.setFillColor(Color(0.55, 0.55, 0.55, alpha=float(opacity)))
        fontsize = max(24.0, min(pw, ph) / 5)
        c.setFont("Helvetica", fontsize)
        # Center + rotate 45 degrees (diagonal)
        c.saveState()
        c.translate(pw / 2, ph / 2)
        c.rotate(45)
        c.drawCentredString(0, 0, text)
        c.restoreState()
        c.save()

        overlay_reader = PdfReader(buf)
        overlay_page = overlay_reader.pages[0]
        # Merge overlay onto the original page
        page.merge_page(overlay_page)
        writer.add_page(page)
        ctx.progress(int((i + 1) / page_count * 90))

    out_buf = io.BytesIO()
    writer.write(out_buf)
    out = out_buf.getvalue()
    ctx.progress(100)
    return ToolResult(
        outputs=[("watermarked.pdf", out)],
        meta={"page_count": page_count, "opacity": float(opacity)},
    )


register_tool(
    ToolDefinition(
        key="watermark",
        name="Add Watermark",
        description="Stamp diagonal watermark text on every page of a PDF.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.watermark",
        config_schema={
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 100,
                    "description": "Watermark text (required).",
                },
                "opacity": {
                    "type": "number",
                    "minimum": 0.1,
                    "maximum": 0.5,
                    "default": 0.2,
                },
            },
            "required": ["text"],
            "additionalProperties": False,
        },
        output_description="Watermarked PDF",
        handler=handler,
    )
)
