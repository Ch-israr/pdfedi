"""Delete selected pages from a PDF (at least one page must remain)."""
from __future__ import annotations

from pathlib import Path

from pypdf import PdfWriter

from pdfedi.tools._helpers import open_pdf_reader, parse_page_ranges
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
    reader = open_pdf_reader(tool_input.path.read_bytes(), tool_input.filename)
    page_count = len(reader.pages)

    pages = parse_page_ranges(spec)
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
