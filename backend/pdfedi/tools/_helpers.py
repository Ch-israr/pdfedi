"""Shared helpers for tool modules (page-range parsing). Pure functions only."""
from __future__ import annotations

import re

from pdfedi.tools.base import ToolError

_RANGE_TOKEN_RE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$")

# Page sizes in PDF points (1/72 inch), shared by tools that offer them.
# Superset of n_up's _SHEET_SIZES and resize_pages' _SIZES (values identical).
PAGE_SIZES_PT: dict[str, tuple[float, float]] = {
    "a4": (595.0, 842.0),
    "a5": (420.0, 595.0),
    "letter": (612.0, 792.0),
    "legal": (612.0, 1008.0),
}


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


def open_pdf_reader(
    data: bytes, filename: str, *, encrypted_code: str = "encrypted_pdf"
):
    """Parse and validate PDF bytes, returning a pypdf PdfReader.

    Shared replacement for the identical ``_open_reader`` previously copied
    into 12 tools (compare, compress, crop, delete_pages, extract_images,
    merge, n_up, pdf_to_word, reorder_pages, resize_pages, rotate_pages,
    split) and for 5 same-shape inline validation sites (watermark,
    page_numbers, flatten, password_protect, redact).

    ``encrypted_code`` preserves each tool's observable error code:
    most tools use ``"encrypted_pdf"``; the 5 inline sites use
    ``"invalid_input"`` for encrypted inputs.

    DELIBERATE CONSISTENCY FIX (see audit-2026-10-13/CHANGELOG.md): parse
    failures are mapped to ``ToolError(code="invalid_input")`` everywhere.
    The 5 inline sites previously let a corrupt-PDF parse failure propagate
    as a raw pypdf exception; they now raise a clean ToolError like the
    other tools. The unlock_pdf / metadata / edit_metadata / ocr sites are
    genuinely different and intentionally left untouched.
    """
    from io import BytesIO

    from pypdf import PdfReader

    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            f"'{filename}' is not a valid PDF file.", code="invalid_input"
        )
    try:
        reader = PdfReader(BytesIO(data))
    except Exception as exc:
        raise ToolError(
            f"'{filename}' could not be parsed as a PDF: {exc}",
            code="invalid_input",
        ) from exc
    if getattr(reader, "is_encrypted", False):
        raise ToolError(
            f"'{filename}' is password-protected; encrypted PDFs are not supported.",
            code=encrypted_code,
        )
    try:
        count = len(reader.pages)
    except Exception as exc:
        raise ToolError(
            f"Could not read the pages of '{filename}': {exc}",
            code="invalid_input",
        ) from exc
    if count == 0:
        raise ToolError(f"'{filename}' contains no pages.", code="invalid_input")
    return reader


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
