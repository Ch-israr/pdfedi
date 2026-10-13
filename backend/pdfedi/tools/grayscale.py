"""Convert every PDF page to grayscale.

Pages are rendered to grayscale images at the chosen DPI and rebuilt into a
new PDF — text is no longer selectable in the output. Useful for printing
and for shrinking colour-heavy documents.
"""
from __future__ import annotations

import io
from pathlib import Path

from pdfedi.tools._helpers import page_count_of_pdf, read_input_bytes
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="grayscale",
    name="Grayscale PDF",
    tagline="Convert pages to black and white",
    description=(
        "Convert every page of a PDF to grayscale. Each page is rendered to a "
        "grayscale image at the chosen DPI and rebuilt into a new PDF at the "
        "original page dimensions — text in the output is no longer selectable. "
        "Useful for cheaper printing and smaller colour-heavy files."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="dpi",
            kind="number",
            label="Resolution (DPI)",
            required=False,
            default=200,
            help="Render resolution in dots per inch (72–600).",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="optimizing",
    category="optimize",
)

_MIN_DPI = 72
_MAX_DPI = 600
_PAGE_CAP = 50


def run(ctx: ToolContext, options: dict) -> Path:
    """Render each page grayscale at the chosen DPI and rebuild the PDF."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Grayscale needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    raw_dpi = get_option(options, SPEC, "dpi")
    try:
        dpi = int(raw_dpi)
    except (TypeError, ValueError):
        raise ToolError("Option 'dpi' must be a number.", code="bad_option") from None
    if dpi < _MIN_DPI or dpi > _MAX_DPI:
        raise ToolError(
            f"Option 'dpi' must be between {_MIN_DPI} and {_MAX_DPI}.",
            code="bad_option",
        )

    tool_input = ctx.inputs[0]
    data = read_input_bytes(tool_input.path)
    page_count = page_count_of_pdf(data)
    if page_count == 0:
        raise ToolError(
            f"'{tool_input.filename}' contains no pages.", code="invalid_input"
        )
    if page_count > _PAGE_CAP:
        raise ToolError(
            f"Grayscale supports at most {_PAGE_CAP} pages per job.",
            code="bad_option",
        )

    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise ToolError(
            "Image rendering is unavailable on this deployment.",
            code="dependency_unavailable",
        ) from exc

    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    scale = dpi / 72.0
    pages: list[tuple[float, float, bytes]] = []  # (w_pt, h_pt, jpeg_bytes)
    try:
        doc = pdfium.PdfDocument(data)
        try:
            for i in range(len(doc)):
                page = doc[i]
                w_pt, h_pt = page.get_size()
                try:
                    pil_image = page.render(scale=scale).to_pil().convert("L")
                finally:
                    page.close()
                buf = io.BytesIO()
                pil_image.save(buf, "JPEG", quality=85, optimize=True)
                pages.append((w_pt, h_pt, buf.getvalue()))
        finally:
            doc.close()
    except ToolError:
        raise
    except Exception as exc:
        raise ToolError(
            f"Could not render '{tool_input.filename}': {exc}", code="invalid_input"
        ) from exc

    out = ctx.new_output_path("grayscale.pdf").with_suffix(".pdf")
    pdf = canvas.Canvas(str(out))
    try:
        for w_pt, h_pt, jpeg_bytes in pages:
            pdf.setPageSize((w_pt, h_pt))
            pdf.drawImage(
                ImageReader(io.BytesIO(jpeg_bytes)),
                0,
                0,
                width=w_pt,
                height=h_pt,
                preserveAspectRatio=True,
                anchor="c",
            )
            pdf.showPage()
    finally:
        pdf.save()
    return out
