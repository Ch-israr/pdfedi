"""Shared helpers for PDF tool plugins.

Pure helpers only: page-range parsing, PDF validation, lazy optional
imports. No DB, no network, no secrets.
"""
from __future__ import annotations

import io
import re
from typing import Any

from pypdf import PdfReader

from app.services.pdf.registry import ToolContext, ToolError

__all__ = [
    "parse_page_ranges",
    "resolve_pages",
    "check_input_count",
    "open_pdf",
]

_RANGE_TOKEN_RE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$")


def parse_page_ranges(spec: str) -> list[int]:
    """Parse a 1-based inclusive page-range string like ``"1-3,5,8-10"``.

    Returns a sorted list of unique page numbers.
    Raises ``ToolError("INVALID_CONFIG", ...)`` on any malformed token.
    """
    if not isinstance(spec, str) or not spec.strip():
        raise ToolError(
            "INVALID_CONFIG",
            "Page range must be a non-empty string like '1-3,5'.",
        )
    pages: set[int] = set()
    for token in spec.split(","):
        match = _RANGE_TOKEN_RE.match(token)
        if not match:
            raise ToolError(
                "INVALID_CONFIG",
                f"Invalid page range token {token.strip()!r}. "
                "Use forms like '1-3,5,8-10'.",
            )
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) is not None else start
        if start < 1 or end < 1:
            raise ToolError("INVALID_CONFIG", "Page numbers start at 1.")
        if end < start:
            raise ToolError(
                "INVALID_CONFIG",
                f"Invalid range {start}-{end}: end is before start.",
            )
        pages.update(range(start, end + 1))
    return sorted(pages)


def resolve_pages(spec: str | None, page_count: int) -> list[int]:
    """Resolve a page-range spec (or ``None`` = all pages) against a document.

    Returns 1-based page numbers in ascending order.
    """
    if spec is None:
        return list(range(1, page_count + 1))
    pages = parse_page_ranges(spec)
    out_of_range = [p for p in pages if p > page_count]
    if out_of_range:
        raise ToolError(
            "INVALID_CONFIG",
            f"Page(s) {out_of_range} exceed the document page count ({page_count}).",
        )
    return pages


def check_input_count(
    inputs: list[bytes], min_inputs: int, max_inputs: int, tool: str
) -> None:
    """Enforce a tool's declared input arity."""
    if not min_inputs <= len(inputs) <= max_inputs:
        raise ToolError(
            "INVALID_INPUT",
            f"Tool '{tool}' requires between {min_inputs} and {max_inputs} "
            f"input file(s); got {len(inputs)}.",
        )


def open_pdf(
    data: bytes, ctx: ToolContext, *, allow_encrypted: bool = False
) -> PdfReader:
    """Validate PDF bytes and return a ``PdfReader``.

    Detection is via the ``%PDF-`` magic header AND a successful parse.
    Enforces ``ctx.max_pages``. Encrypted inputs are rejected unless
    ``allow_encrypted`` is set.
    """
    if not isinstance(data, bytes) or not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            "INVALID_INPUT", "Input is not a valid PDF file (missing %PDF- header)."
        )
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise ToolError(
            "INVALID_INPUT", f"Input could not be parsed as a PDF: {exc}"
        ) from exc
    if getattr(reader, "is_encrypted", False) and not allow_encrypted:
        raise ToolError(
            "INVALID_INPUT",
            "Password-protected PDFs are not supported as input for this tool.",
        )
    try:
        count = len(reader.pages)
    except Exception as exc:
        raise ToolError(
            "INVALID_INPUT", f"Could not read PDF pages: {exc}"
        ) from exc
    if count == 0:
        raise ToolError("INVALID_INPUT", "PDF contains no pages.")
    if count > ctx.max_pages:
        raise ToolError(
            "PAGE_LIMIT",
            f"PDF has {count} pages, exceeding the limit of {ctx.max_pages} pages.",
        )
    return reader


# NOTE: lazy_fitz() was removed 2026-10-06. PyMuPDF is AGPL-3.0 and banned
# from production paths (see ARCHITECTURE.md Decision 2). All tools now use
# pypdf (BSD) + pypdfium2 (Apache-2.0) + reportlab (BSD).
