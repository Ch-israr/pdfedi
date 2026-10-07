"""Stamp a diagonal text watermark on every page (reportlab + pypdf)."""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color
from reportlab.pdfgen import canvas

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
    require_option,
)

_MAX_TEXT_LEN = 100

SPEC = ToolSpec(
    key="watermark",
    name="Add Watermark",
    tagline="Stamp diagonal text across every page",
    description="Overlay semi-transparent diagonal watermark text on every page of a PDF.",
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="text",
            kind="text",
            label="Watermark text",
            required=True,
            help=f"1–{_MAX_TEXT_LEN} characters.",
        ),
        ToolOption(
            name="opacity",
            kind="number",
            label="Opacity",
            required=False,
            default=0.2,
            help="0.1 (faint) to 0.5 (strong).",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="edit",
)


def _coerce_opacity(value) -> float:
    if isinstance(value, bool):
        raise ToolError("Option 'opacity' must be a number between 0.1 and 0.5.", code="invalid_option")
    try:
        opacity = float(value)
    except (TypeError, ValueError):
        raise ToolError("Option 'opacity' must be a number between 0.1 and 0.5.", code="invalid_option")
    if not 0.1 <= opacity <= 0.5:
        raise ToolError("Option 'opacity' must be a number between 0.1 and 0.5.", code="invalid_option")
    return opacity


def run(ctx: ToolContext, options: dict) -> Path:
    text = require_option(options, SPEC, "text")
    if not isinstance(text, str) or not text.strip():
        raise ToolError("Option 'text' is required and must be non-empty.", code="invalid_option")
    if len(text) > _MAX_TEXT_LEN:
        raise ToolError(
            f"Option 'text' must be at most {_MAX_TEXT_LEN} characters.", code="invalid_option"
        )
    opacity = _coerce_opacity(get_option(options, SPEC, "opacity"))

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError("Input is not a valid PDF file.", code="invalid_input")

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ToolError("Input PDF is encrypted.", code="invalid_input")

    writer = PdfWriter()
    for page in reader.pages:
        mediabox = page.mediabox
        pw = float(mediabox.width)
        ph = float(mediabox.height)

        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(pw, ph))
        c.setFillColor(Color(0.55, 0.55, 0.55, alpha=opacity))
        c.setFont("Helvetica", max(24.0, min(pw, ph) / 5))
        c.saveState()
        c.translate(pw / 2, ph / 2)
        c.rotate(45)
        c.drawCentredString(0, 0, text)
        c.restoreState()
        c.save()

        page.merge_page(PdfReader(buf).pages[0])
        writer.add_page(page)

    out_path = ctx.new_output_path("watermarked.pdf")
    with open(out_path, "wb") as f:
        writer.write(f)
    return out_path
