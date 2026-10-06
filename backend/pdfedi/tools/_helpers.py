"""Shared helpers for tool modules (page-range parsing). Pure functions only."""
from __future__ import annotations

import re

from pdfedi.tools.base import ToolError

_RANGE_TOKEN_RE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$")


def parse_page_ranges(spec: str) -> list[int]:
    """Parse a 1-based inclusive page-range string like ``"1-3,5,8-10"``.

    Returns a sorted list of unique page numbers. Raises ToolError on any
    malformed token.
    """
    if not isinstance(spec, str) or not spec.strip():
        raise ToolError(
            "Page range must be a non-empty string like '1-3,5'.",
            code="invalid_option",
        )
    pages: set[int] = set()
    for token in spec.split(","):
        match = _RANGE_TOKEN_RE.match(token)
        if not match:
            raise ToolError(
                f"Invalid page range token {token.strip()!r}. "
                "Use forms like '1-3,5,8-10'.",
                code="invalid_option",
            )
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) is not None else start
        if start < 1 or end < 1:
            raise ToolError("Page numbers start at 1.", code="invalid_option")
        if end < start:
            raise ToolError(
                f"Invalid range {start}-{end}: end is before start.",
                code="invalid_option",
            )
        pages.update(range(start, end + 1))
    return sorted(pages)


def resolve_pages(spec: str | None, page_count: int) -> list[int]:
    """Resolve a page-range spec against a document.

    ``None`` (or an empty string) means all pages. Returns 1-based page
    numbers in ascending order. Raises ToolError if any page is out of range.
    """
    if spec is None or (isinstance(spec, str) and not spec.strip()):
        return list(range(1, page_count + 1))
    pages = parse_page_ranges(spec)
    out_of_range = [p for p in pages if p > page_count]
    if out_of_range:
        raise ToolError(
            f"Page(s) {out_of_range} exceed the document page count "
            f"({page_count}).",
            code="invalid_option",
        )
    return pages


def read_input_bytes(ctx_inputs_path) -> bytes:
    """Read an input file's bytes, raising ToolError if unreadable."""
    try:
        return ctx_inputs_path.read_bytes()
    except OSError as exc:
        raise ToolError(
            f"Could not read input file: {exc}", code="invalid_input"
        ) from exc


def page_count_of_pdf(data: bytes) -> int:
    """Return the page count of PDF bytes, raising ToolError if unparsable."""
    from pypdf import PdfReader

    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            "Input is not a valid PDF file (missing %PDF- header).",
            code="invalid_input",
        )
    import io

    try:
        reader = PdfReader(io.BytesIO(data))
        if getattr(reader, "is_encrypted", False):
            raise ToolError(
                "This PDF is encrypted; tools cannot process it without "
                "the password.",
                code="encrypted_input",
            )
        return len(reader.pages)
    except ToolError:
        raise
    except Exception as exc:
        raise ToolError(
            f"Input could not be parsed as a PDF: {exc}", code="invalid_input"
        ) from exc
