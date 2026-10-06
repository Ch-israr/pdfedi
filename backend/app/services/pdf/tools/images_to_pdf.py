"""Convert images (PNG/JPG/TIFF/BMP/WebP) into a single PDF via Pillow."""
from __future__ import annotations

import io
from typing import Any

from PIL import Image

from app.services.pdf.registry import (
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolResult,
    register_tool,
)
from app.services.pdf.tools._common import check_input_count

# Pillow format name -> accepted
_ALLOWED_FORMATS = {"PNG", "JPEG", "TIFF", "BMP", "WEBP"}


def _load_image(data: bytes, index: int) -> Image.Image:
    if not isinstance(data, bytes) or not data:
        raise ToolError("INVALID_INPUT", f"Input #{index + 1} is empty.")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:
        raise ToolError(
            "INVALID_INPUT", f"Input #{index + 1} is not a readable image: {exc}"
        ) from exc
    if (image.format or "").upper() not in _ALLOWED_FORMATS:
        raise ToolError(
            "INVALID_INPUT",
            f"Input #{index + 1} has unsupported image type "
            f"{image.format!r}; allowed: PNG, JPG, TIFF, BMP, WebP.",
        )
    return image


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Combine images into one PDF, one image per page."""
    check_input_count(inputs, 1, 50, "images_to_pdf")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    pages: list[Image.Image] = []
    try:
        for i, data in enumerate(inputs):
            image = _load_image(data, i)
            pages.append(image.convert("RGB"))
            ctx.progress(int((i + 1) / len(inputs) * 80))
        buf = io.BytesIO()
        pages[0].save(
            buf,
            format="PDF",
            save_all=True,
            append_images=pages[1:],
            resolution=72.0,
        )
    finally:
        for image in pages:
            image.close()
    ctx.progress(100)
    return ToolResult(
        outputs=[("images.pdf", buf.getvalue())],
        meta={"input_images": len(inputs), "page_count": len(inputs)},
    )


register_tool(
    ToolDefinition(
        key="images_to_pdf",
        name="Images to PDF",
        description="Combine images into a single PDF, one image per page.",
        version="1.0.0",
        accepted_types=["png", "jpg", "jpeg", "tiff", "tif", "bmp", "webp"],
        min_inputs=1,
        max_inputs=50,
        required_entitlement="tool.images_to_pdf",
        config_schema={
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        output_description="Single PDF with one image per page",
        handler=handler,
    )
)
