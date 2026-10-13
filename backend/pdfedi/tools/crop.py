"""Crop PDF pages by trimming margins from each edge (in points)."""
from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

from pdfedi.tools._helpers import resolve_pages
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="crop",
    name="Crop PDF",
    tagline="Trim margins from pages",
    description=(
        "Crop PDF pages by trimming a margin from the top, bottom, left and "
        "right edges (in points; 72 points = 1 inch). Select pages with ranges "
        "like '1-3,5' or leave empty to crop every page."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="top",
            kind="number",
            label="Top margin (pt)",
            required=False,
            default=0,
            help="Points to trim from the top edge.",
        ),
        ToolOption(
            name="bottom",
            kind="number",
            label="Bottom margin (pt)",
            required=False,
            default=0,
            help="Points to trim from the bottom edge.",
        ),
        ToolOption(
            name="left",
            kind="number",
            label="Left margin (pt)",
            required=False,
            default=0,
            help="Points to trim from the left edge.",
        ),
        ToolOption(
            name="right",
            kind="number",
            label="Right margin (pt)",
            required=False,
            default=0,
            help="Points to trim from the right edge.",
        ),
        ToolOption(
            name="pages",
            kind="pages",
            label="Pages",
            required=False,
            default=None,
            help="1-based ranges like '1-3,5'. Leave empty for all pages.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="edit",
)


def _open_reader(data: bytes, filename: str) -> PdfReader:
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            f"'{filename}' is not a valid PDF file.", code="invalid_input"
        )
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise ToolError(
            f"'{filename}' could not be parsed as a PDF: {exc}", code="invalid_input"
        ) from exc
    if getattr(reader, "is_encrypted", False):
        raise ToolError(
            f"'{filename}' is password-protected; encrypted PDFs are not supported.",
            code="encrypted_pdf",
        )
    try:
        count = len(reader.pages)
    except Exception as exc:
        raise ToolError(
            f"Could not read the pages of '{filename}': {exc}", code="invalid_input"
        ) from exc
    if count == 0:
        raise ToolError(f"'{filename}' contains no pages.", code="invalid_input")
    return reader


def _margin(options: dict, name: str) -> float:
    raw = get_option(options, SPEC, name)
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ToolError(
            f"Option '{name}' must be a number of points.", code="bad_option"
        ) from None
    if value < 0:
        raise ToolError(
            f"Option '{name}' must be 0 or greater.", code="bad_option"
        )
    return value


def run(ctx: ToolContext, options: dict) -> Path:
    """Trim margins from the selected pages; empty ``pages`` means all pages."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Crop needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    top = _margin(options, "top")
    bottom = _margin(options, "bottom")
    left = _margin(options, "left")
    right = _margin(options, "right")

    tool_input = ctx.inputs[0]
    reader = _open_reader(tool_input.path.read_bytes(), tool_input.filename)
    page_count = len(reader.pages)
    pages = resolve_pages(get_option(options, SPEC, "pages"), page_count)
    selected = set(pages)

    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        if (i + 1) in selected and (top or bottom or left or right):
            box = page.mediabox
            x0, y0 = float(box.left), float(box.bottom)
            x1, y1 = float(box.right), float(box.top)
            nx0, ny0 = x0 + left, y0 + bottom
            nx1, ny1 = x1 - right, y1 - top
            if nx1 - nx0 <= 0 or ny1 - ny0 <= 0:
                raise ToolError(
                    f"Margins are too large for page {i + 1}: nothing would "
                    "remain visible.",
                    code="invalid_crop",
                )
            page.cropbox = RectangleObject([nx0, ny0, nx1, ny1])
        writer.add_page(page)

    out = ctx.new_output_path("cropped.pdf").with_suffix(".pdf")
    with out.open("wb") as f:
        writer.write(f)
    return out
