"""Render PDF pages to PNG/JPEG images and pack them in a ZIP (pypdfium2)."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from pdfedi.tools._helpers import page_count_of_pdf, read_input_bytes, resolve_pages
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_IMAGE_CAP = 100
_MIN_DPI = 72
_MAX_DPI = 300

SPEC = ToolSpec(
    key="pdf_to_images",
    name="PDF to Images",
    tagline="Turn PDF pages into PNG or JPEG images",
    description=(
        f"Render the selected pages of a PDF to PNG or JPEG images at the "
        f"chosen resolution and download them as a single ZIP file "
        f"(max {_IMAGE_CAP} images per job)."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="format",
            kind="select",
            label="Image format",
            required=False,
            default="png",
            choices=["png", "jpeg"],
            help="Output image format.",
        ),
        ToolOption(
            name="dpi",
            kind="number",
            label="Resolution (DPI)",
            required=False,
            default=150,
            help=f"Render resolution, {_MIN_DPI}–{_MAX_DPI} DPI (clamped).",
        ),
        ToolOption(
            name="pages",
            kind="pages",
            label="Pages",
            required=False,
            default=None,
            help="1-based ranges like '1-3,5'. Leave empty for all pages.",
        ),
    ],
    output_kind="zip",
    output_ext="zip",
    output_mime="application/zip",
    activity="converting",
    category="convert",
)


def run(ctx: ToolContext, options: dict) -> Path:
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"PDF to Images needs exactly 1 PDF; got {len(ctx.inputs)}.",
            code="invalid_input",
        )
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="invalid_option")

    image_format = get_option(options, SPEC, "format")
    if image_format not in ("png", "jpeg"):
        raise ToolError(
            "Option 'format' must be 'png' or 'jpeg'.", code="invalid_option"
        )

    raw_dpi = get_option(options, SPEC, "dpi")
    try:
        dpi = int(raw_dpi)
    except (TypeError, ValueError) as exc:
        raise ToolError(
            "Option 'dpi' must be a number.", code="invalid_option"
        ) from exc
    dpi = max(_MIN_DPI, min(_MAX_DPI, dpi))

    data = read_input_bytes(ctx.inputs[0].path)
    page_count = page_count_of_pdf(data)
    pages = resolve_pages(get_option(options, SPEC, "pages"), page_count)
    if not pages:
        raise ToolError("No pages selected.", code="invalid_option")
    if len(pages) > _IMAGE_CAP:
        raise ToolError(
            f"At most {_IMAGE_CAP} images per job; {len(pages)} requested.",
            code="invalid_option",
        )

    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "Image rendering is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc

    out = Path(str(ctx.new_output_path("page_images")) + ".zip")
    scale = dpi / 72.0
    pdf = pdfium.PdfDocument(data)
    try:
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for page_no in pages:
                page = pdf[page_no - 1]
                try:
                    pil_image = page.render(scale=scale).to_pil()
                finally:
                    page.close()
                buf = io.BytesIO()
                if image_format == "jpeg":
                    if pil_image.mode in ("RGBA", "LA", "PA"):
                        pil_image = pil_image.convert("RGB")
                    pil_image.save(buf, format="JPEG", quality=85)
                    name = f"page-{page_no:03d}.jpg"
                else:
                    pil_image.save(buf, format="PNG")
                    name = f"page-{page_no:03d}.png"
                zf.writestr(name, buf.getvalue())
    finally:
        pdf.close()
    return out
