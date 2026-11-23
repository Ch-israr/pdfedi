"""Add a header or footer line to PDF pages (reportlab + pypdf).

The stamped text is a template: ``{page}`` is replaced with the page
number and ``{total}`` with the total page count, so "Page {page} of
{total}" works. Any other text is stamped literally.
"""
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
    key="header_footer",
    name="Add Header / Footer",
    tagline="Stamp text on every page",
    description=(
        "Add a header or footer line to your PDF pages — custom text with "
        "{page} and {total} placeholders, position and font size. "
        "Applied to all pages or selected ranges."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(name="text", kind="text", label="Header / footer text",
                   required=False, default="Page {page} of {total}",
                   help="Use {page} for the page number and {total} for the page count."),
        ToolOption(name="vertical", kind="select", label="Position",
                   required=False, default="bottom", choices=["top", "bottom"],
                   help="'top' stamps a header, 'bottom' stamps a footer."),
        ToolOption(name="horizontal", kind="select", label="Alignment",
                   required=False, default="center", choices=["left", "center", "right"]),
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
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="invalid_option")
    text_template = get_option(options, SPEC, "text")
    if text_template is None:
        text_template = SPEC.options[0].default
    if not isinstance(text_template, str) or not text_template.strip():
        raise ToolError("Option 'text' must not be empty.", code="invalid_option")
    if len(text_template) > 200:
        raise ToolError("Option 'text' must be at most 200 characters.", code="invalid_option")
    vertical = get_option(options, SPEC, "vertical")
    horizontal = get_option(options, SPEC, "horizontal")
    if vertical not in _VALID_VERTICAL:
        raise ToolError(f"Option 'vertical' must be one of {_VALID_VERTICAL}.", code="invalid_option")
    if horizontal not in _VALID_HORIZONTAL:
        raise ToolError(f"Option 'horizontal' must be one of {_VALID_HORIZONTAL}.", code="invalid_option")
    font_size = coerce_int(get_option(options, SPEC, "font_size"), "font_size", 6, 48)

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
            line = text_template.replace("{page}", str(page_no)).replace("{total}", str(page_count))

            buf = io.BytesIO()
            c = canvas.Canvas(buf, pagesize=(pw, ph))
            c.setFillColor(black)
            c.setFont("Helvetica", font_size)
            y = ph - _MARGIN if vertical == "top" else _MARGIN
            if horizontal == "left":
                c.drawString(_MARGIN, y, line)
            elif horizontal == "right":
                c.drawRightString(pw - _MARGIN, y, line)
            else:
                c.drawCentredString(pw / 2, y, line)
            c.save()

            page.merge_page(PdfReader(buf).pages[0])
        writer.add_page(page)

    out_path = ctx.new_output_path("header_footer.pdf")
    with open(out_path, "wb") as f:
        writer.write(f)
    return out_path
