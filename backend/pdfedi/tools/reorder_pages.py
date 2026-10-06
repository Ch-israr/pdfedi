"""Reorder the pages of a PDF according to a 1-based permutation.

The old contract took ``order`` as a JSON list of integers (``[3,1,2]``);
a comma-separated string (``"3,1,2"``) is accepted as well.
"""
from __future__ import annotations

import io
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
    key="reorder_pages",
    name="Reorder Pages",
    tagline="Rearrange PDF page order",
    description=(
        "Reorder the pages of a PDF using a 1-based page permutation, "
        "e.g. '3,1,2' moves page 3 first. Every page must appear exactly once."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="order",
            kind="text",
            label="Page order",
            required=True,
            default=None,
            help="1-based permutation of pages 1..N, e.g. '3,1,2'.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
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


def _parse_order(raw) -> list[int]:
    """Accept ``[3,1,2]`` (old contract) or ``"3,1,2"``; return ints."""
    if isinstance(raw, str):
        tokens = [t.strip() for t in raw.split(",")]
        if not tokens or any(not t for t in tokens):
            raise ToolError(
                "Option 'order' must be a non-empty 1-based page permutation "
                "like '3,1,2'.",
                code="bad_option",
            )
        try:
            order = [int(t) for t in tokens]
        except ValueError:
            raise ToolError(
                "Option 'order' must contain only page numbers, e.g. '3,1,2'.",
                code="bad_option",
            ) from None
    elif isinstance(raw, list):
        order = raw
    else:
        raise ToolError(
            "Option 'order' must be a 1-based page permutation like '3,1,2'.",
            code="bad_option",
        )
    if not order or any(
        not isinstance(x, int) or isinstance(x, bool) or x < 1 for x in order
    ):
        raise ToolError(
            "Option 'order' must be a non-empty list of 1-based page numbers.",
            code="bad_option",
        )
    return order


def run(ctx: ToolContext, options: dict) -> Path:
    """Reorder pages. ``order`` must be a permutation of pages 1..N."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Reorder pages needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    order = _parse_order(require_option(options, SPEC, "order"))
    tool_input = ctx.inputs[0]
    reader = _open_reader(tool_input.path.read_bytes(), tool_input.filename)
    page_count = len(reader.pages)

    if sorted(order) != list(range(1, page_count + 1)):
        raise ToolError(
            f"Option 'order' must be a permutation of pages 1..{page_count} "
            "(every page exactly once).",
            code="bad_option",
        )

    writer = PdfWriter()
    for page_no in order:
        writer.add_page(reader.pages[page_no - 1])

    out = ctx.new_output_path("reordered.pdf").with_suffix(".pdf")
    with out.open("wb") as f:
        writer.write(f)
    return out
