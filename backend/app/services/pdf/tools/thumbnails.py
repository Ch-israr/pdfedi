"""Render PDF pages to PNG thumbnails with pypdfium2 (Apache-2.0)."""
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

_THUMBNAIL_CAP = 50


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Render selected pages to PNG thumbnails at the requested width."""
    check_input_count(inputs, 1, 1, "thumbnails")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    width = config.get("width", 300)
    if (
        not isinstance(width, int)
        or isinstance(width, bool)
        or not 16 <= width <= 2000
    ):
        raise ToolError(
            "INVALID_CONFIG", "config.width must be an integer between 16 and 2000."
        )
    reader = open_pdf(inputs[0], ctx)  # header + parse + page-limit validation
    page_count = len(reader.pages)
    pages = resolve_pages(config.get("pages"), page_count)
    if len(pages) > _THUMBNAIL_CAP:
        raise ToolError(
            "INVALID_CONFIG",
            f"At most {_THUMBNAIL_CAP} thumbnails per job; {len(pages)} requested.",
        )

    # Use pypdfium2 (Apache-2.0) — no PyMuPDF (AGPL).
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "DEPENDENCY_UNAVAILABLE",
            "Thumbnails are not available on this deployment (pypdfium2 missing).",
        ) from exc

    pdf = pdfium.PdfDocument(inputs[0])
    outputs: list[tuple[str, bytes]] = []
    try:
        for i, page_no in enumerate(pages):
            page = pdf[page_no - 1]
            # Render at thumbnail scale (width px wide, preserving aspect)
            # PDFium default is 72 DPI; scale to target width
            src_width_pt = page.get_size()[0]
            scale = width / src_width_pt if src_width_pt > 0 else 1.0
            pil_image = page.render(scale=scale).to_pil()
            import io
            buf = io.BytesIO()
            pil_image.save(buf, format="PNG")
            outputs.append((f"thumb-{page_no:03d}.png", buf.getvalue()))
            page.close()
            ctx.progress(int((i + 1) / len(pages) * 100))
    finally:
        pdf.close()
    return ToolResult(
        outputs=outputs,
        meta={"thumbnails": len(outputs), "width": width, "page_count": page_count},
    )


register_tool(
    ToolDefinition(
        key="thumbnails",
        name="Page Thumbnails",
        description="Render PDF pages to PNG thumbnails (max 50 per job).",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.thumbnails",
        config_schema={
            "type": "object",
            "properties": {
                "width": {
                    "type": "integer",
                    "minimum": 16,
                    "maximum": 2000,
                    "default": 300,
                    "description": "Thumbnail width in pixels.",
                },
                "pages": {
                    "type": ["string", "null"],
                    "description": "1-based ranges like '1-3'; null = all pages.",
                    "default": None,
                },
            },
            "additionalProperties": False,
        },
        output_description="PNG thumbnails, one per selected page",
        handler=handler,
    )
)
