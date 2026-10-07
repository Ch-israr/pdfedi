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
    IndirectObject,
    NameObject,
    NumberObject,
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
)

# quality -> (max image dimension in px or None, JPEG quality)
_QUALITY_SETTINGS: dict[str, tuple[int | None, int]] = {
    "low": (800, 40),
    "medium": (1400, 60),
    "high": (None, 0),  # structural compression only, no downsampling
}


def _open_reader(data: bytes, filename: str) -> PdfReader:
    if not data.lstrip().startswith(b"%PDF-"):
        raise ToolError(
            f"'{filename}' is not a valid PDF file.", code="invalid_input"
        )
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise ToolError(
            f"'{filename}' could not be parsed as a PDF: {exc}", code="invalid_input"
        ) from exc
    if getattr(reader, "is_encrypted", False):
        raise ToolError(
            f"'{filename}' is password-protected; encrypted PDFs are not supported.",
            code="encrypted_pdf",
        )
    try:
        count = len(reader.pages)
    except Exception as exc:
        raise ToolError(
            f"Could not read the pages of '{filename}': {exc}", code="invalid_input"
        ) from exc
    if count == 0:
        raise ToolError(f"'{filename}' contains no pages.", code="invalid_input")
    return reader


def _downsample_image_object(img_obj, max_dim: int, jpeg_quality: int) -> bool:
    """Downsample a pypdf image XObject in place. Returns True if modified."""
    try:
        data = img_obj.get_data()
    except Exception:
        return False

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:
        return False  # exotic image — leave untouched

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

    # Only replace if it actually shrinks
    if len(jpeg_bytes) >= len(data):
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


def _iter_image_xobjects(writer: PdfWriter):
    """Yield each unique image XObject in the writer's pages."""
    seen: set[int] = set()
    for page in writer.pages:
        try:
            resources = page["/Resources"]
            xobjects = resources.get("/XObject")
            if xobjects is None:
                continue
            if isinstance(xobjects, IndirectObject):
                xobjects = xobjects.get_object()
            for name in list(xobjects.keys()):
                obj = xobjects[name]
                if isinstance(obj, IndirectObject):
                    if obj.idnum in seen:
                        continue
                    seen.add(obj.idnum)
                    obj = obj.get_object()
                if obj.get("/Subtype") == "/Image":
                    yield obj
        except (KeyError, AttributeError, TypeError):
            continue


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
    reader = _open_reader(tool_input.path.read_bytes(), tool_input.filename)

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
