"""Compress a PDF: structural cleanup + image downsampling (pypdf + PIL).

No PyMuPDF (AGPL, banned). Image replacement rebuilds the XObject with the
correct /Filter (DCTDecode for JPEG), avoiding stream/filter mismatch
corruption.
"""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    DecodedStreamObject,
    EncodedStreamObject,
    NameObject,
    NumberObject,
)

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools.extract_images import (
    _iter_image_xobjects,
    _pil_from_xobject,
)
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

SPEC = ToolSpec(
    key="compress",
    name="Compress PDF",
    tagline="Reduce PDF file size",
    description=(
        "Reduce PDF file size with structural cleanup and image downsampling. "
        "Choose a quality level to trade image fidelity for smaller files."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="quality",
            kind="select",
            label="Quality",
            required=False,
            default="medium",
            choices=["low", "medium", "high"],
            help="'low'/'medium' downsample images; 'high' keeps images intact "
            "(structural compression only).",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="optimizing",
    category="optimize",
)

# quality -> (max image dimension in px or None, JPEG quality)
_QUALITY_SETTINGS: dict[str, tuple[int | None, int]] = {
    "low": (800, 40),
    "medium": (1400, 60),
    "high": (None, 0),  # structural compression only, no downsampling
}


def _downsample_image_object(img_obj, max_dim: int, jpeg_quality: int) -> bool:
    """Downsample a pypdf image XObject in place. Returns True if modified."""
    image = _pil_from_xobject(img_obj)
    if image is None:
        return False

    w, h = image.size
    if max(w, h) > max_dim:
        scale = max_dim / max(w, h)
        image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        w, h = image.size

    if image.mode in ("RGBA", "LA", "PA", "P"):
        # JPEG has no alpha; composite onto white
        bg = Image.new("RGB", image.size, (255, 255, 255))
        if image.mode == "P":
            image = image.convert("RGBA")
        bg.paste(
            image,
            mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None,
        )
        image = bg
    elif image.mode != "RGB":
        image = image.convert("RGB")

    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=jpeg_quality, optimize=True)
    jpeg_bytes = buf.getvalue()

    # Only replace if it actually shrinks. Compare against the true encoded
    # stream size (_data is never mutated by get_data()); comparing against
    # decoded pixel bytes would make JPEG almost always "win", even when the
    # original Flate stream was already smaller.
    raw = getattr(img_obj, "_data", None)
    orig_size = len(raw) if raw else w * h * 3
    if len(jpeg_bytes) >= orig_size:
        return False

    # Rebuild the XObject as a proper DCTDecode (JPEG) image
    if isinstance(img_obj, (DecodedStreamObject, EncodedStreamObject)):
        img_obj._data = jpeg_bytes
    else:
        return False
    img_obj[NameObject("/Filter")] = NameObject("/DCTDecode")
    img_obj[NameObject("/Width")] = NumberObject(w)
    img_obj[NameObject("/Height")] = NumberObject(h)
    img_obj[NameObject("/ColorSpace")] = NameObject("/DeviceRGB")
    img_obj[NameObject("/BitsPerComponent")] = NumberObject(8)
    # Remove keys that don't apply to DCTDecode
    for key in ("/DecodeParms", "/Interpolate", "/SMask", "/Mask"):
        img_obj.pop(NameObject(key), None)
    return True


def run(ctx: ToolContext, options: dict) -> Path:
    """Compress the single input PDF. ``quality`` trades fidelity for size."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Compress needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    quality = get_option(options, SPEC, "quality")
    if quality not in _QUALITY_SETTINGS:
        raise ToolError(
            "Option 'quality' must be one of 'low', 'medium', 'high'.",
            code="bad_option",
        )

    tool_input = ctx.inputs[0]
    reader = open_pdf_reader(tool_input.path.read_bytes(), tool_input.filename)

    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)

    max_dim, jpeg_quality = _QUALITY_SETTINGS[quality]
    if max_dim is not None:
        for img_obj in _iter_image_xobjects(writer):
            _downsample_image_object(img_obj, max_dim, jpeg_quality)

    out = ctx.new_output_path("compressed.pdf").with_suffix(".pdf")
    with out.open("wb") as f:
        writer.write(f)
    return out
