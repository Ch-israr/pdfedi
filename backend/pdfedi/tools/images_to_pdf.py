"""Combine image files into a single PDF, one image per page (Pillow)."""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from pdfedi.tools._helpers import read_input_bytes
from pdfedi.tools.base import ToolContext, ToolError, ToolSpec

_ALLOWED_FORMATS = {"PNG", "JPEG", "TIFF", "BMP", "WEBP"}

SPEC = ToolSpec(
    key="images_to_pdf",
    name="Images to PDF",
    tagline="Combine images into one PDF",
    description=(
        "Combine PNG, JPG, TIFF, BMP or WebP images into a single PDF, "
        "one image per page, in the order the files were uploaded."
    ),
    input_kinds=["image"],
    min_files=1,
    max_files=20,
    options=[],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="converting",
)


def _load_image(data: bytes, index: int) -> Image.Image:
    if not data:
        raise ToolError(
            f"Input #{index + 1} is empty.", code="invalid_input"
        )
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:
        raise ToolError(
            f"Input #{index + 1} is not a readable image: {exc}",
            code="invalid_input",
        ) from exc
    if (image.format or "").upper() not in _ALLOWED_FORMATS:
        raise ToolError(
            f"Input #{index + 1} has unsupported image type "
            f"{image.format!r}; allowed: PNG, JPG, TIFF, BMP, WebP.",
            code="invalid_input",
        )
    return image


def run(ctx: ToolContext, options: dict) -> Path:
    if not 1 <= len(ctx.inputs) <= 20:
        raise ToolError(
            f"Images to PDF needs between 1 and 20 images; "
            f"got {len(ctx.inputs)}.",
            code="invalid_input",
        )

    pages: list[Image.Image] = []
    try:
        for i, tool_input in enumerate(ctx.inputs):
            data = read_input_bytes(tool_input.path)
            pages.append(_load_image(data, i).convert("RGB"))
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

    out = Path(str(ctx.new_output_path("images")) + ".pdf")
    out.write_bytes(buf.getvalue())
    return out
