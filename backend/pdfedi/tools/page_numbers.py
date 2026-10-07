"""Add configurable page numbers to a PDF (reportlab + pypdf)."""
from __future__ import annotations

import io
import re
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import black
from reportlab.pdfgen import canvas

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


def _coerce_int(value, name: str, minimum: int, maximum: int | None = None) -> int:
    if isinstance(value, bool):
        raise ToolError(f"Option '{name}' must be an integer.", code="invalid_option")
    try:
        ivalue = int(value)
    except (TypeError, ValueError):
        raise ToolError(f"Option '{name}' must be an integer.", code="invalid_option")
    # Reject non-integral floats like 2.5 (int("2.5") raises; int(2.5) silently truncates)
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
    vertical = get_option(options, SPEC, "vertical")
    horizontal = get_option(options, SPEC, "horizontal")
    if vertical not in _VALID_VERTICAL:
        raise ToolError(f"Option 'vertical' must be one of {_VALID_VERTICAL}.", code="invalid_option")
    if horizontal not in _VALID_HORIZONTAL:
        raise ToolError(f"Option 'horizontal' must be one of {_VALID_HORIZONTAL}.", code="invalid_option")
    start = _coerce_int(get_option(options, SPEC, "start_number"), "start_number", 1)
    font_size = _coerce_int(get_option(options, SPEC, "font_size"), "font_size", 6, 48)
    prefix = get_option(options, SPEC, "prefix") or ""
    suffix = get_option(options, SPEC, "suffix") or ""
    if not isinstance(prefix, str) or not isinstance(suffix, str):
        raise ToolError("Options 'prefix' and 'suffix' must be strings.", code="invalid_option")

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    data = ctx.inputs[0].path.read_bytes()
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError("Input is not a valid PDF file.", code="invalid_input")

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ToolError("Input PDF is encrypted.", code="invalid_input")
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
