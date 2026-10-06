"""Extract text from a PDF with pypdfium2 (Apache-2.0); output a single .txt file."""
from __future__ import annotations

from typing import Any

from app.services.pdf.registry import (
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolResult,
    register_tool,
)
from app.services.pdf.tools._common import (
    check_input_count,
    open_pdf,
    resolve_pages,
)


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Extract plain text from the selected pages into one .txt file."""
    check_input_count(inputs, 1, 1, "extract_text")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    reader = open_pdf(inputs[0], ctx)  # header + parse + page-limit validation
    page_count = len(reader.pages)
    pages = resolve_pages(config.get("pages"), page_count)

    # Use pypdfium2 (Apache-2.0, Google PDFium) — no PyMuPDF (AGPL).
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "DEPENDENCY_UNAVAILABLE",
            "Text extraction is not available on this deployment (pypdfium2 missing).",
        ) from exc

    pdf = pdfium.PdfDocument(inputs[0])
    try:
        parts: list[str] = []
        for i, page_no in enumerate(pages):
            page = pdf[page_no - 1]
            textpage = page.get_textpage()
            parts.append(textpage.get_text_range())
            textpage.close()
            page.close()
            ctx.progress(int((i + 1) / len(pages) * 100))
    finally:
        pdf.close()

    text = "\n\n".join(part.rstrip("\n") for part in parts).strip() + "\n"
    return ToolResult(
        outputs=[("extracted.txt", text.encode("utf-8"))],
        meta={
            "pages_extracted": len(pages),
            "page_count": page_count,
            "characters": len(text),
        },
    )


register_tool(
    ToolDefinition(
        key="extract_text",
        name="Extract Text",
        description="Extract plain text from a PDF into a single .txt file.",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.extract_text",
        config_schema={
            "type": "object",
            "properties": {
                "pages": {
                    "type": ["string", "null"],
                    "description": "1-based ranges like '1-3'; null = all pages.",
                    "default": None,
                }
            },
            "additionalProperties": False,
        },
        output_description="Plain-text file with the extracted text",
        handler=handler,
    )
)
