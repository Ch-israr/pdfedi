"""Delete selected pages from a PDF (at least one page must remain)."""
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
    require_option,
)

SPEC = ToolSpec(
    key="delete_pages",
    name="Delete Pages",
    tagline="Remove pages from a PDF",
    description=(
        "Remove the selected pages from a PDF. At least one page must remain "
        "in the document."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="pages",
            kind="pages",
            label="Pages to delete",
            required=True,
            default=None,
            help="1-based pages to delete, e.g. '1,3,5-7'.",
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
    """Parse a 1-based inclusive page-range string like ``"1,3,5-7"``."""
    if not isinstance(spec, str) or not spec.strip():
        raise ToolError(
            "Page range must be a non-empty string like '1,3,5-7'.", code="bad_option"
        )
    pages: set[int] = set()
    for token in spec.split(","):
        match = _RANGE_TOKEN_RE.match(token)
        if not match:
            raise ToolError(
                f"Invalid page range token {token.strip()!r}. "
                "Use forms like '1,3,5-7'.",
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
    """Delete the pages listed in ``pages`` (1-based ranges)."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Delete pages needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    spec = require_option(options, SPEC, "pages")
    tool_input = ctx.inputs[0]
    reader = _open_reader(tool_input.path.read_bytes(), tool_input.filename)
    page_count = len(reader.pages)

    pages = _parse_page_ranges(spec)
    out_of_range = [p for p in pages if p > page_count]
    if out_of_range:
        raise ToolError(
            f"Page(s) {out_of_range} exceed the document page count ({page_count}).",
            code="bad_option",
        )
    if len(pages) >= page_count:
        raise ToolError(
            "Cannot delete every page; at least one page must remain.",
            code="bad_option",
        )

    doomed = set(pages)
    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        if (i + 1) not in doomed:
            writer.add_page(page)

    out = ctx.new_output_path("pages-deleted.pdf").with_suffix(".pdf")
    with out.open("wb") as f:
        writer.write(f)
    return out
