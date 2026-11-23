"""Add a header or footer line to PDF pages (reportlab + pypdf).

The stamped text is a template: ``{page}`` is replaced with the page
number and ``{total}`` with the total page count, so "Page {page} of
{total}" works. Any other text is stamped literally.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import black
from reportlab.pdfgen import canvas

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_VALID_VERTICAL = ("top", "bottom")
_VALID_HORIZONTAL = ("left", "center", "right")
_RANGE_TOKEN_RE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$")
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


def _coerce_int(value, name: str, minimum: int, maximum: int | None = None) -> int:
    if isinstance(value, bool):
        raise ToolError(f"Option '{name}' must be an integer.", code="invalid_option")
    try:
        ivalue = int(value)
    except (TypeError, ValueError):
        raise ToolError(f"Option '{name}' must be an integer.", code="invalid_option")
    if isinstance(value, float) and not value.is_integer():
        raise ToolError(f"Option '{name}' must be an integer.", code="invalid_option")
    if ivalue < minimum or (maximum is not None and ivalue > maximum):
        bound = f"at least {minimum}" if maximum is None else f"between {minimum} and {maximum}"
        raise ToolError(f"Option '{name}' must be {bound}.", code="invalid_option")
    return ivalue


def _parse_page_ranges(spec: str | None, page_count: int) -> list[int]:
    """Parse '1-3,5' into sorted 1-based page numbers; None/empty = all pages."""
    if spec is None or (isinstance(spec, str) and not spec.strip()):
        return list(range(1, page_count + 1))
    if not isinstance(spec, str):
        raise ToolError("Option 'pages' must be a string like '1-3,5'.", code="invalid_option")
    pages: set[int] = set()
    for token in spec.split(","):
        match = _RANGE_TOKEN_RE.match(token)
        if not match:
            raise ToolError(
                f"Invalid page range {token.strip()!r}. Use forms like '1-3,5'.",
                code="invalid_option",
            )
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) is not None else start
        if start < 1 or end < 1:
            raise ToolError("Page numbers start at 1.", code="invalid_option")
        if end < start:
            raise ToolError(f"Invalid range {start}-{end}: end is before start.", code="invalid_option")
        pages.update(range(start, end + 1))
    out_of_range = [p for p in pages if p > page_count]
    if out_of_range:
        raise ToolError(
            f"Page(s) {sorted(out_of_range)} exceed the document page count ({page_count}).",
            code="invalid_option",
        )
    return sorted(pages)


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
    font_size = _coerce_int(get_option(options, SPEC, "font_size"), "font_size", 6, 48)

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    reader = open_pdf_reader(
        data, ctx.inputs[0].filename, encrypted_code="invalid_input"
    )
    page_count = len(reader.pages)
    pages = _parse_page_ranges(get_option(options, SPEC, "pages"), page_count)
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
