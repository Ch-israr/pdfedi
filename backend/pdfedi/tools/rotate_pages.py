"""Rotate selected pages of a PDF clockwise by 90, 180 or 270 degrees."""
from __future__ import annotations

import io
import re
from pathlib import Path

from pypdf import PdfReader, PdfWriter

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
    require_option,
)

SPEC = ToolSpec(
    key="rotate_pages",
    name="Rotate Pages",
    tagline="Rotate PDF pages",
    description=(
        "Rotate selected pages of a PDF clockwise by 90, 180 or 270 degrees. "
        "Leave the page range empty to rotate every page."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="angle",
            kind="select",
            label="Rotation angle",
            required=True,
            default=None,
            choices=["90", "180", "270"],
            help="Clockwise rotation applied to the selected pages.",
        ),
        ToolOption(
            name="pages",
            kind="pages",
            label="Pages",
            required=False,
            default=None,
            help="1-based ranges like '1-3,5'. Empty means all pages.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="organize",
)

_RANGE_TOKEN_RE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$")


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


def _parse_page_ranges(spec: str) -> list[int]:
    """Parse a 1-based inclusive page-range string like ``"1-3,5"``."""
    if not isinstance(spec, str) or not spec.strip():
        raise ToolError(
            "Page range must be a non-empty string like '1-3,5'.", code="bad_option"
        )
    pages: set[int] = set()
    for token in spec.split(","):
        match = _RANGE_TOKEN_RE.match(token)
        if not match:
            raise ToolError(
                f"Invalid page range token {token.strip()!r}. "
                "Use forms like '1-3,5'.",
                code="bad_option",
            )
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) is not None else start
        if start < 1 or end < 1:
            raise ToolError("Page numbers start at 1.", code="bad_option")
        if end < start:
            raise ToolError(
                f"Invalid range {start}-{end}: end is before start.", code="bad_option"
            )
        pages.update(range(start, end + 1))
    return sorted(pages)


def run(ctx: ToolContext, options: dict) -> Path:
    """Rotate the selected pages clockwise; empty ``pages`` means all pages."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Rotate needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    raw_angle = require_option(options, SPEC, "angle")
    try:
        angle = int(str(raw_angle).strip())
    except (TypeError, ValueError):
        raise ToolError(
            "Option 'angle' must be one of 90, 180, 270.", code="bad_option"
        ) from None
    if angle not in (90, 180, 270):
        raise ToolError(
            "Option 'angle' must be one of 90, 180, 270.", code="bad_option"
        )

    tool_input = ctx.inputs[0]
    reader = _open_reader(tool_input.path.read_bytes(), tool_input.filename)
    page_count = len(reader.pages)

    pages_spec = get_option(options, SPEC, "pages")
    if pages_spec is None or (isinstance(pages_spec, str) and not pages_spec.strip()):
        pages = list(range(1, page_count + 1))
    else:
        pages = _parse_page_ranges(pages_spec)
        out_of_range = [p for p in pages if p > page_count]
        if out_of_range:
            raise ToolError(
                f"Page(s) {out_of_range} exceed the document page count "
                f"({page_count}).",
                code="bad_option",
            )

    selected = set(pages)
    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        if (i + 1) in selected:
            page.rotate(angle)
        writer.add_page(page)

    out = ctx.new_output_path("rotated.pdf").with_suffix(".pdf")
    with out.open("wb") as f:
        writer.write(f)
    return out
