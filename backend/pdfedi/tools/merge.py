"""Merge multiple PDFs into a single PDF, preserving input order."""
from __future__ import annotations

import json
from pathlib import Path

from pypdf import PdfWriter

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
)

SPEC = ToolSpec(
    key="merge",
    name="Merge PDFs",
    tagline="Combine multiple PDFs into one",
    description=(
        "Combine two or more PDF files into a single PDF, preserving the "
        "order the files were uploaded in."
    ),
    input_kinds=["pdf"],
    min_files=2,
    max_files=20,
    options=[
        ToolOption(
            name="page_order",
            kind="text",
            label="Page order (JSON)",
            required=False,
            default=None,
            help="Optional JSON list of [file, page] pairs in merge order, "
            "e.g. '[[1,2],[0,1]]' merges file 2 page 2 first, then file 1 "
            "page 1. File numbers are 0-based, page numbers 1-based. "
            "Omit to merge every page in upload order.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="organize",
)


def _parse_page_order(raw, readers: list) -> list[tuple[int, int]]:
    """Parse ``page_order`` into validated (file_index, page_no) pairs."""
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        raise ToolError(
            "Option 'page_order' must be a JSON list of [file, page] pairs, "
            "e.g. '[[0,1],[1,2]]'.",
            code="bad_option",
        ) from None
    if not isinstance(data, list) or not data:
        raise ToolError(
            "Option 'page_order' must be a non-empty JSON list of "
            "[file, page] pairs, e.g. '[[0,1],[1,2]]'.",
            code="bad_option",
        )
    pairs: list[tuple[int, int]] = []
    for entry in data:
        if (
            not isinstance(entry, list)
            or len(entry) != 2
            or any(not isinstance(x, int) or isinstance(x, bool) for x in entry)
        ):
            raise ToolError(
                "Option 'page_order' entries must be [file, page] pairs of "
                "integers, e.g. '[[0,1],[1,2]]'.",
                code="bad_option",
            )
        file_index, page_no = entry
        if not 0 <= file_index < len(readers):
            raise ToolError(
                f"Option 'page_order' references file {file_index + 1}, but "
                f"only {len(readers)} file(s) were uploaded.",
                code="bad_option",
            )
        page_count = len(readers[file_index].pages)
        if not 1 <= page_no <= page_count:
            raise ToolError(
                f"Option 'page_order' references page {page_no} of file "
                f"{file_index + 1}, which has {page_count} page(s).",
                code="bad_option",
            )
        pairs.append((file_index, page_no))
    return pairs


def run(ctx: ToolContext, options: dict) -> Path:
    """Merge ctx.inputs (2-20 PDFs) into one PDF inside ctx.workdir."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    n = len(ctx.inputs)
    if not SPEC.min_files <= n <= SPEC.max_files:
        raise ToolError(
            f"Merge needs between {SPEC.min_files} and {SPEC.max_files} PDF files; "
            f"got {n}.",
            code="bad_input_count",
        )

    readers = [
        open_pdf_reader(tool_input.path.read_bytes(), tool_input.filename)
        for tool_input in ctx.inputs
    ]

    writer = PdfWriter()
    page_order_raw = options.get("page_order")
    if page_order_raw is None or (
        isinstance(page_order_raw, str) and not page_order_raw.strip()
    ):
        for reader in readers:
            for page in reader.pages:
                writer.add_page(page)
    else:
        for file_index, page_no in _parse_page_order(page_order_raw, readers):
            writer.add_page(readers[file_index].pages[page_no - 1])

    out = ctx.new_output_path("merged.pdf").with_suffix(".pdf")
    with out.open("wb") as f:
        writer.write(f)
    return out
