"""Render PDF pages to PNG/JPEG images with pypdfium2 (Apache-2.0)."""
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

_IMAGE_CAP = 100
_MIN_DPI = 72
_MAX_DPI = 300


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Render selected pages to PNG or JPEG images."""
    check_input_count(inputs, 1, 1, "pdf_to_images")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    image_format = config.get("format", "png")
    if image_format not in ("png", "jpeg"):
        raise ToolError(
            "INVALID_CONFIG", "config.format must be 'png' or 'jpeg'."
        )
    dpi = config.get("dpi", 150)
    if (
        not isinstance(dpi, int)
        or isinstance(dpi, bool)
        or not _MIN_DPI <= dpi <= _MAX_DPI
    ):
        raise ToolError(
            "INVALID_CONFIG",
            f"config.dpi must be an integer between {_MIN_DPI} and {_MAX_DPI}.",
        )
    reader = open_pdf(inputs[0], ctx)  # header + parse + page-limit validation
    page_count = len(reader.pages)
    pages = resolve_pages(config.get("pages"), page_count)
    if len(pages) > _IMAGE_CAP:
        raise ToolError(
            "INVALID_CONFIG",
            f"At most {_IMAGE_CAP} images per job; {len(pages)} requested.",
        )

    # Use pypdfium2 (Apache-2.0, Google PDFium) — no PyMuPDF (AGPL).
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "DEPENDENCY_UNAVAILABLE",
            "Image rendering is not available on this deployment (pypdfium2 missing).",
        ) from exc

    pdf = pdfium.PdfDocument(inputs[0])
    outputs: list[tuple[str, bytes]] = []
    try:
        scale = dpi / 72.0
        for i, page_no in enumerate(pages):
            page = pdf[page_no - 1]
            # Render at the requested DPI
            pil_image = page.render(scale=scale).to_pil()
            import io
            buf = io.BytesIO()
            if image_format == "jpeg":
                # JPEG needs RGB (no alpha)
                if pil_image.mode in ("RGBA", "LA", "PA"):
                    pil_image = pil_image.convert("RGB")
                pil_image.save(buf, format="JPEG", quality=85)
                name = f"page-{page_no:03d}.jpg"
            else:
                pil_image.save(buf, format="PNG")
                name = f"page-{page_no:03d}.png"
            outputs.append((name, buf.getvalue()))
            page.close()
            ctx.progress(int((i + 1) / len(pages) * 100))
    finally:
        pdf.close()
    return ToolResult(
        outputs=outputs,
        meta={
            "images": len(outputs),
            "format": image_format,
            "dpi": dpi,
            "page_count": page_count,
        },
    )


register_tool(
    ToolDefinition(
        key="pdf_to_images",
        name="PDF to Images",
        description="Render PDF pages to PNG or JPEG images (max 100 per job).",
        version="1.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.pdf_to_images",
        config_schema={
            "type": "object",
            "properties": {
                "format": {
                    "type": "string",
                    "enum": ["png", "jpeg"],
                    "default": "png",
                },
                "dpi": {
                    "type": "integer",
                    "minimum": 72,
                    "maximum": 300,
                    "default": 150,
                },
                "pages": {
                    "type": ["string", "null"],
                    "description": "1-based ranges like '1-3'; null = all pages.",
                    "default": None,
                },
            },
            "additionalProperties": False,
        },
        output_description="PNG/JPEG images, one per selected page",
        handler=handler,
    )
)
