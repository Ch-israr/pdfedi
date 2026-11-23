"""Add configurable page numbers to a PDF (reportlab + pypdf)."""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import black
from reportlab.pdfgen import canvas

from pdfedi.tools._helpers import coerce_int, open_pdf_reader, resolve_pages
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_VALID_VERTICAL = ("top", "bottom")
_VALID_HORIZONTAL = ("left", "center", "right")
_MARGIN = 36.0  # 0.5 inch


SPEC = ToolSpec(
    key="page_numbers",
    name="Add Page Numbers",
    tagline="Stamp page numbers in any corner",
    description="Add configurable page numbers to a PDF — position, start number and prefix/suffix.",
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(name="vertical", kind="select", label="Vertical position",
                   required=False, default="bottom", choices=["top", "bottom"]),
        ToolOption(name="horizontal", kind="select", label="Horizontal position",
                   required=False, default="center", choices=["left", "center", "right"]),
        ToolOption(name="start_number", kind="number", label="Start number",
                   required=False, default=1, help="First page number (positive integer)."),
        ToolOption(name="prefix", kind="text", label="Prefix", required=False, default=""),
        ToolOption(name="suffix", kind="text", label="Suffix", required=False, default=""),
        ToolOption(name="font_size", kind="number", label="Font size",
                   required=False, default=10, help="6 to 48."),
        ToolOption(name="pages", kind="pages", label="Pages", required=False, default=None,
                   help="1-based ranges like '1-3,5'. Leave empty for all pages."),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="edit",
)


def run(ctx: ToolContext, options: dict) -> Path:
    vertical = get_option(options, SPEC, "vertical")
    horizontal = get_option(options, SPEC, "horizontal")
    if vertical not in _VALID_VERTICAL:
        raise ToolError(f"Option 'vertical' must be one of {_VALID_VERTICAL}.", code="invalid_option")
    if horizontal not in _VALID_HORIZONTAL:
        raise ToolError(f"Option 'horizontal' must be one of {_VALID_HORIZONTAL}.", code="invalid_option")
    start = coerce_int(get_option(options, SPEC, "start_number"), "start_number", 1)
    font_size = coerce_int(get_option(options, SPEC, "font_size"), "font_size", 6, 48)
    prefix = get_option(options, SPEC, "prefix") or ""
    suffix = get_option(options, SPEC, "suffix") or ""
    if not isinstance(prefix, str) or not isinstance(suffix, str):
        raise ToolError("Options 'prefix' and 'suffix' must be strings.", code="invalid_option")

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    reader = open_pdf_reader(
        data, ctx.inputs[0].filename, encrypted_code="invalid_input"
    )
    page_count = len(reader.pages)

    pages = resolve_pages(get_option(options, SPEC, "pages"), page_count)
    page_set = set(pages)

    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        page_no = i + 1
        if page_no in page_set:
            mediabox = page.mediabox
            pw = float(mediabox.width)
            ph = float(mediabox.height)

            idx = pages.index(page_no)  # 0-based within the selected set
            number_text = f"{prefix}{start + idx}{suffix}"

            buf = io.BytesIO()
            c = canvas.Canvas(buf, pagesize=(pw, ph))
            c.setFillColor(black)
            c.setFont("Helvetica", font_size)
            y = ph - _MARGIN if vertical == "top" else _MARGIN
            if horizontal == "left":
                c.drawString(_MARGIN, y, number_text)
            elif horizontal == "right":
                c.drawRightString(pw - _MARGIN, y, number_text)
            else:
                c.drawCentredString(pw / 2, y, number_text)
            c.save()

            page.merge_page(PdfReader(buf).pages[0])
        writer.add_page(page)

    out_path = ctx.new_output_path("numbered.pdf")
    with open(out_path, "wb") as f:
        writer.write(f)
    return out_path
