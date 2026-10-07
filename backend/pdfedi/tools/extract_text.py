"""Extract plain text from PDF pages into a single .txt file (pypdfium2)."""
from __future__ import annotations

from pathlib import Path

from pdfedi.tools._helpers import page_count_of_pdf, read_input_bytes, resolve_pages
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="extract_text",
    name="Extract Text",
    tagline="Pull plain text out of a PDF",
    description=(
        "Extract plain text from the selected pages of a PDF into a single "
        ".txt file. Text is extracted in reading order, one blank line "
        "between pages."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="pages",
            kind="pages",
            label="Pages",
            required=False,
            default=None,
            help="1-based ranges like '1-3,5'. Leave empty for all pages.",
        ),
    ],
    output_kind="text",
    output_ext="txt",
    output_mime="text/plain",
    activity="converting",
)


def run(ctx: ToolContext, options: dict) -> Path:
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Extract Text needs exactly 1 PDF; got {len(ctx.inputs)}.",
            code="invalid_input",
        )
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="invalid_option")

    data = read_input_bytes(ctx.inputs[0].path)
    page_count = page_count_of_pdf(data)
    pages = resolve_pages(get_option(options, SPEC, "pages"), page_count)
    if not pages:
        raise ToolError("No pages selected.", code="invalid_option")

    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "Text extraction is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc

    pdf = pdfium.PdfDocument(data)
    try:
        parts: list[str] = []
        for page_no in pages:
            page = pdf[page_no - 1]
            try:
                textpage = page.get_textpage()
                try:
                    parts.append(textpage.get_text_range())
                finally:
                    textpage.close()
            finally:
                page.close()
    finally:
        pdf.close()

    text = "\n\n".join(part.rstrip("\n") for part in parts).strip() + "\n"
    out = Path(str(ctx.new_output_path("extracted_text")) + ".txt")
    out.write_text(text, encoding="utf-8")
    return out
