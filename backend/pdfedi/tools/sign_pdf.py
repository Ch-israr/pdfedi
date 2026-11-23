"""Add a visible signature image to chosen pages of a PDF.

The signature itself is drawn or typed in the browser and sent to the
server as a PNG; this module validates it and composites it onto the
chosen pages at the chosen position and size (reportlab overlay + pypdf
merge, the same pattern as the watermark tool).

Honest limits, stated in the tool copy: this adds a *visible* signature
image — it is NOT a cryptographic / digital signature and carries no
certificate or legal proof of signing. For a certified digital signature,
use a dedicated signing service.
"""
from __future__ import annotations

import base64
import binascii
import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas

from pdfedi.tools._helpers import open_pdf_reader, resolve_pages
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
    require_option,
)

SPEC = ToolSpec(
    key="sign_pdf",
    name="Sign PDF",
    tagline="Draw a signature and place it on your PDF",
    description=(
        "Sign a PDF with a signature you draw or type in the browser, placed "
        "on the pages you choose. The signature is added as a visible image "
        "on the page — it is not a cryptographic digital signature and "
        "carries no certificate."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="signature_png",
            kind="text",
            label="Signature image (PNG)",
            required=True,
            help="A PNG image of the signature (drawn or typed in the browser).",
        ),
        ToolOption(
            name="pages",
            kind="pages",
            label="Pages",
            required=False,
            default=None,
            help="1-based ranges like '1-3,5'. Leave empty for all pages.",
        ),
        ToolOption(
            name="x",
            kind="number",
            label="Horizontal position (0–1)",
            required=False,
            default=0.6,
            help="0 is the left edge, 1 is the right edge (measured from the left).",
        ),
        ToolOption(
            name="y",
            kind="number",
            label="Vertical position (0–1)",
            required=False,
            default=0.8,
            help="0 is the top of the page, 1 is the bottom.",
        ),
        ToolOption(
            name="width_frac",
            kind="number",
            label="Signature width (fraction of page)",
            required=False,
            default=0.25,
            help="0.05 (small) to 0.6 (wide). Height follows the image shape.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    category="edit",
)

_MAX_PNG_BYTES = 1_000_000
_MAX_PNG_DIM = 2000


def _decode_signature_png(value) -> bytes:
    """Accept a data URL or raw base64 PNG; return validated PNG bytes."""
    if not isinstance(value, str) or not value.strip():
        raise ToolError(
            "Option 'signature_png' is required: draw or type a signature first.",
            code="invalid_option",
        )
    raw = value.strip()
    if raw.startswith("data:"):
        if "," not in raw:
            raise ToolError("Option 'signature_png' is not a valid image.", code="invalid_option")
        header, raw = raw.split(",", 1)
        if "image/png" not in header and "image/" not in header:
            raise ToolError("Option 'signature_png' must be a PNG image.", code="invalid_option")
    try:
        png = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise ToolError("Option 'signature_png' is not valid base64.", code="invalid_option")
    if len(png) > _MAX_PNG_BYTES:
        raise ToolError("Signature image is too large (max 1 MB).", code="invalid_option")
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ToolError("Option 'signature_png' must be a PNG image.", code="invalid_option")
    try:
        from PIL import Image
        with Image.open(io.BytesIO(png)) as img:
            img.verify()
            if max(img.size) > _MAX_PNG_DIM:
                raise ToolError("Signature image is too large (max 2000 px).", code="invalid_option")
    except ToolError:
        raise
    except Exception:
        raise ToolError("Option 'signature_png' is not a readable PNG image.", code="invalid_option")
    return png


def _coerce_frac(value, name: str, lo: float, hi: float, default: float) -> float:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        raise ToolError(f"Option '{name}' must be a number.", code="invalid_option")
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise ToolError(f"Option '{name}' must be a number.", code="invalid_option")
    if not lo <= v <= hi:
        raise ToolError(f"Option '{name}' must be between {lo} and {hi}.", code="invalid_option")
    return v


def run(ctx: ToolContext, options: dict) -> Path:
    """Composite the signature PNG onto the chosen pages."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Sign PDF needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    png = _decode_signature_png(require_option(options, SPEC, "signature_png"))
    pages_spec = get_option(options, SPEC, "pages")
    x_frac = _coerce_frac(get_option(options, SPEC, "x"), "x", 0.0, 1.0, 0.6)
    y_frac = _coerce_frac(get_option(options, SPEC, "y"), "y", 0.0, 1.0, 0.8)
    width_frac = _coerce_frac(
        get_option(options, SPEC, "width_frac"), "width_frac", 0.05, 0.6, 0.25
    )

    data = ctx.inputs[0].path.read_bytes()
    reader = open_pdf_reader(data, ctx.inputs[0].filename)
    page_count = len(reader.pages)
    pages = resolve_pages(
        pages_spec if isinstance(pages_spec, str) else None, page_count
    )

    # Image aspect from the PNG header bytes (no full decode needed).
    from PIL import Image
    with Image.open(io.BytesIO(png)) as img:
        iw, ih = img.size
    aspect = ih / iw if iw else 1.0

    writer = PdfWriter()
    for idx, page in enumerate(reader.pages, start=1):
        if idx in pages:
            mediabox = page.mediabox
            pw = float(mediabox.width)
            ph = float(mediabox.height)
            img_w = width_frac * pw
            img_h = img_w * aspect
            # x/y are fractions from the top-left; PDF origin is bottom-left.
            left = x_frac * pw
            top = y_frac * ph
            # Clamp so the signature stays on the page.
            left = max(0.0, min(left, pw - img_w))
            bottom = ph - top - img_h
            bottom = max(0.0, min(bottom, ph - img_h))
            buf = io.BytesIO()
            c = rl_canvas.Canvas(buf, pagesize=(pw, ph))
            c.drawImage(
                ImageReader(io.BytesIO(png)), left, bottom,
                width=img_w, height=img_h,
                mask="auto", preserveAspectRatio=True,
            )
            c.save()
            page.merge_page(PdfReader(buf).pages[0])
        writer.add_page(page)

    out_path = ctx.new_output_path("signed.pdf")
    with open(out_path, "wb") as f:
        writer.write(f)
    return out_path
