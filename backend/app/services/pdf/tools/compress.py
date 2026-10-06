"""Compress a PDF: structural cleanup + image downsampling (pypdf + PIL).

No PyMuPDF (AGPL) — see ARCHITECTURE.md Decision 2.
Image replacement rebuilds the XObject with correct /Filter (DCTDecode for
JPEG), avoiding the stream/filter mismatch corruption bug.
"""
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
from app.services.pdf.tools._common import check_input_count, open_pdf

# quality -> (max image dimension in px or None, JPEG quality)
_QUALITY_SETTINGS: dict[str, tuple[int | None, int]] = {
    "low": (800, 40),
    "medium": (1400, 60),
    "high": (None, 0),  # structural compression only, no downsampling
}


def _downsample_image_object(img_obj, max_dim: int, jpeg_quality: int) -> bool:
    """Downsample a pypdf image XObject in place. Returns True if modified."""
    from pypdf.generic import DecodedStreamObject, EncodedStreamObject, NameObject, NumberObject

    try:
        # Get image dimensions from the XObject dictionary
        width = int(img_obj["/Width"])
        height = int(img_obj["/Height"])
    except (KeyError, ValueError, TypeError):
        return False

    if max(width, height) <= max_dim:
        # Still re-encode to JPEG for size savings if it's large enough to matter
        pass

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
        bg.paste(image, mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None)
        image = bg
    elif image.mode != "RGB":
        image = image.convert("RGB")

    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=jpeg_quality, optimize=True)
    jpeg_bytes = buf.getvalue()

    # Only replace if it actually shrinks
    original_len = len(data)
    if len(jpeg_bytes) >= original_len:
        return False

    # Rebuild the XObject as a proper DCTDecode (JPEG) image
    img_obj._data = jpeg_bytes
    img_obj[NameObject("/Filter")] = NameObject("/DCTDecode")
    img_obj[NameObject("/Width")] = NumberObject(w)
    img_obj[NameObject("/Height")] = NumberObject(h)
    img_obj[NameObject("/ColorSpace")] = NameObject("/DeviceRGB")
    img_obj[NameObject("/BitsPerComponent")] = NumberObject(8)
    # Remove keys that don't apply to DCTDecode
    for key in ("/DecodeParms", "/Interpolate", "/SMask", "/Mask"):
        img_obj.pop(NameObject(key), None)
    return True


def handler(inputs: list[bytes], config: dict, ctx: ToolContext) -> ToolResult:
    """Compress the PDF. ``quality`` trades image fidelity for file size."""
    check_input_count(inputs, 1, 1, "compress")
    if not isinstance(config, dict):
        raise ToolError("INVALID_CONFIG", "Config must be an object.")
    quality = config.get("quality", "medium")
    if quality not in _QUALITY_SETTINGS:
        raise ToolError(
            "INVALID_CONFIG",
            "config.quality must be one of 'low', 'medium', 'high'.",
        )
    reader = open_pdf(inputs[0], ctx)  # header + parse + page-limit validation
    page_count = len(reader.pages)

    from pypdf import PdfWriter

    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)

    max_dim, jpeg_quality = _QUALITY_SETTINGS[quality]
    downsampled = 0
    if max_dim is not None:
        # Walk all image XObjects in the writer
        from pypdf.generic import IndirectObject

        seen: set[int] = set()
        total = 0
        for page in writer.pages:
            try:
                resources = page["/Resources"]
                xobjects = resources.get("/XObject")
                if xobjects is None:
                    continue
                # Resolve indirect reference
                if isinstance(xobjects, IndirectObject):
                    xobjects = xobjects.get_object()
                for name in list(xobjects.keys()):
                    obj = xobjects[name]
                    if isinstance(obj, IndirectObject):
                        idnum = obj.idnum
                        if idnum in seen:
                            continue
                        seen.add(idnum)
                        obj = obj.get_object()
                    if obj.get("/Subtype") == "/Image":
                        total += 1
            except (KeyError, AttributeError, TypeError):
                continue

        done = 0
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
                        obj = obj.get_object()
                    if obj.get("/Subtype") == "/Image":
                        if _downsample_image_object(obj, max_dim, jpeg_quality):
                            downsampled += 1
                        done += 1
                        if total:
                            ctx.progress(int(done / total * 80))
            except (KeyError, AttributeError, TypeError):
                continue

    buf = io.BytesIO()
    writer.write(buf)
    out = buf.getvalue()

    ctx.progress(100)
    original = len(inputs[0])
    compressed = len(out)
    return ToolResult(
        outputs=[("compressed.pdf", out)],
        meta={
            "quality": quality,
            "page_count": page_count,
            "original_bytes": original,
            "compressed_bytes": compressed,
            "images_downsampled": downsampled,
            "ratio": round(compressed / original, 3) if original else 1.0,
        },
    )


register_tool(
    ToolDefinition(
        key="compress",
        name="Compress PDF",
        description="Reduce PDF file size with structural cleanup and image downsampling.",
        version="2.0.0",
        accepted_types=["pdf"],
        min_inputs=1,
        max_inputs=1,
        required_entitlement="tool.compress",
        config_schema={
            "type": "object",
            "properties": {
                "quality": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "default": "medium",
                    "description": "Image quality trade-off; 'high' keeps images intact.",
                }
            },
            "additionalProperties": False,
        },
        output_description="Compressed PDF",
        handler=handler,
    )
)
