"""Compress a PDF: structural cleanup + DPI-aware image recompression.

No PyMuPDF (AGPL, banned). Image replacement rebuilds the XObject with the
correct /Filter (DCTDecode for JPEG), avoiding stream/filter mismatch
corruption. Recompression is budgeted by EFFECTIVE DPI so scanned pages
keep readable resolution (see _QUALITY_SETTINGS).
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
from pdfedi.tools.extract_images import _pil_from_xobject
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
        "Reduce PDF file size with structural cleanup and resolution-aware "
        "image optimization that preserves scanned-document readability. "
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
            help="'high' preserves full resolution (near-lossless, only "
            "recompresses when the saving is significant); 'medium' caps "
            "image resolution at 300 DPI; 'low' at 200 DPI (readable but "
            "smaller).",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="optimizing",
    category="optimize",
)

# quality -> (target effective DPI or None, JPEG quality)
#
# Chroma subsampling is deliberately left at Pillow's default: explicit
# subsampling (4:2:2 / 4:4:4) combined with optimize=True crashes this
# Pillow/libjpeg build on some real images ("Suspension not allowed
# here" -> OSError, reproduced on a photo PDF at medium), while the
# measured fidelity gain was marginal. Reliability wins.
#
# The caps are EFFECTIVE DPI (image pixels per inch at its displayed size),
# not absolute pixel counts. The previous absolute caps (800px/q40 low,
# 1400px/q60 medium) crushed a full-page 600-DPI scan to 68/120 DPI and
# destroyed small print, signatures and stamps. 200 DPI is the readability
# floor for scanned text; 300 DPI is print grade.
#
# 'high' has NO DPI cap: full resolution is preserved, already-JPEG images
# are never re-encoded, and losslessly stored images are recompressed
# (q92) only when that saves at least 20% — otherwise the original
# stream is kept byte-identical.
_QUALITY_SETTINGS: dict[str, tuple[int | None, int]] = {
    "low": (200, 80),
    "medium": (300, 88),
    "high": (None, 92),
}


def _iter_page_image_xobjects(writer):
    """Yield (image XObject, page width pt, page height pt) per unique image.

    The page dimensions give the largest area the image can be displayed at
    (visible content cannot exceed the page), so pixels-per-inch computed
    against the page is a LOWER bound of the true effective DPI: capping on
    it can never push an image below the target DPI at its real display
    size. An image shared by several pages is processed once, against the
    largest referencing page (the most conservative choice).
    """
    from pypdf.generic import IndirectObject

    best: dict[int, tuple] = {}
    for page in writer.pages:
        try:
            page_w = float(page.mediabox.width)
            page_h = float(page.mediabox.height)
            resources = page["/Resources"]
            xobjects = resources.get("/XObject")
            if xobjects is None:
                continue
            if isinstance(xobjects, IndirectObject):
                xobjects = xobjects.get_object()
            for name in list(xobjects.keys()):
                obj = xobjects[name]
                idnum = None
                if isinstance(obj, IndirectObject):
                    idnum = obj.idnum
                    obj = obj.get_object()
                if obj.get("/Subtype") != "/Image":
                    continue
                key = idnum if idnum is not None else id(obj)
                prev = best.get(key)
                if prev is None or page_w * page_h > prev[1] * prev[2]:
                    best[key] = (obj, page_w, page_h)
        except (KeyError, AttributeError, TypeError, ValueError):
            continue
    yield from best.values()


def _is_jpeg(img_obj) -> bool:
    from pypdf.generic import ArrayObject

    filt = img_obj.get("/Filter")
    filters = list(filt) if isinstance(filt, ArrayObject) else [filt]
    return NameObject("/DCTDecode") in filters


def _process_image_object(
    img_obj,
    page_w_pt: float,
    page_h_pt: float,
    target_dpi: int | None,
    jpeg_quality: int,
    *,
    allow_inplace_jpeg: bool,
    min_saving: float,
) -> bool:
    """Re-encode one image XObject within the preset's fidelity budget.

    Returns True if the image was replaced. Quality safeguards:
    - resolution is never reduced below ``target_dpi`` at page size
      (and not at all when ``target_dpi`` is None);
    - an already-JPEG image is re-encoded in place ONLY at the 'low'
      preset (bounded trade, no resolution loss); at 'medium'/'high' it
      is left byte-identical unless it is being downsampled to the cap;
    - a no-resize recompression must save at least ``min_saving`` of the
      original stream (the 'high' preset's worthwhile threshold), and
      every replacement must be smaller than the original stream;
    - the source ICC profile is preserved when it matches the output's
      channel count, so color interpretation does not change;
    - grayscale stays grayscale (no forced RGB upconversion).
    """
    try:
        src_w = int(img_obj["/Width"])
        src_h = int(img_obj["/Height"])
    except (KeyError, TypeError, ValueError):
        return False
    if src_w <= 0 or src_h <= 0:
        return False

    if target_dpi is None:
        scale = 1.0
    else:
        scale = min(
            1.0,
            target_dpi * (page_w_pt / 72.0) / src_w,
            target_dpi * (page_h_pt / 72.0) / src_h,
        )
    src_is_jpeg = _is_jpeg(img_obj)
    if scale >= 1.0 and src_is_jpeg and not allow_inplace_jpeg:
        return False

    image = _pil_from_xobject(img_obj)
    if image is None:
        return False

    if scale < 1.0:
        image = image.resize(
            (max(1, round(src_w * scale)), max(1, round(src_h * scale))),
            Image.LANCZOS,
        )
    w, h = image.size

    if image.mode == "L":
        out_mode = "L"  # grayscale JPEG: no chroma data to invent
    elif image.mode in ("RGBA", "LA", "PA", "P"):
        # JPEG has no alpha; composite onto white
        bg = Image.new("RGB", image.size, (255, 255, 255))
        if image.mode == "P":
            image = image.convert("RGBA")
        bg.paste(
            image,
            mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None,
        )
        image = bg
        out_mode = "RGB"
    elif image.mode != "RGB":
        image = image.convert("RGB")
        out_mode = "RGB"
    else:
        out_mode = "RGB"

    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=jpeg_quality, optimize=True)
    jpeg_bytes = buf.getvalue()

    # Only replace if it actually shrinks. Compare against the true encoded
    # stream size (_data is never mutated by get_data()); comparing against
    # decoded pixel bytes would make JPEG almost always "win", even when the
    # original Flate stream was already smaller. A no-resize recompression
    # must additionally clear the preset's worthwhile-saving threshold.
    raw = getattr(img_obj, "_data", None)
    orig_size = len(raw) if raw else src_w * src_h * 3
    if len(jpeg_bytes) >= orig_size:
        return False
    if scale >= 1.0 and min_saving > 0 and len(jpeg_bytes) > orig_size * (1 - min_saving):
        return False

    # Preserve the source ICC profile when it matches the output's channel
    # count: the decoded pixel values live in that profile's space (no
    # color conversion is performed), so keeping the profile keeps the
    # rendered colors identical in ICC-aware viewers.
    keep_cs = None
    try:
        from pypdf.generic import ArrayObject

        cs = img_obj.get("/ColorSpace")
        if hasattr(cs, "get_object"):
            cs = cs.get_object()
        if (
            isinstance(cs, ArrayObject)
            and len(cs) >= 2
            and str(cs[0]) == "/ICCBased"
            and int(cs[1].get_object().get("/N")) == (1 if out_mode == "L" else 3)
        ):
            keep_cs = cs
    except Exception:
        keep_cs = None

    # Rebuild the XObject as a proper DCTDecode (JPEG) image
    if isinstance(img_obj, (DecodedStreamObject, EncodedStreamObject)):
        img_obj._data = jpeg_bytes
    else:
        return False
    img_obj[NameObject("/Filter")] = NameObject("/DCTDecode")
    img_obj[NameObject("/Width")] = NumberObject(w)
    img_obj[NameObject("/Height")] = NumberObject(h)
    if keep_cs is not None:
        img_obj[NameObject("/ColorSpace")] = keep_cs
    else:
        img_obj[NameObject("/ColorSpace")] = NameObject(
            "/DeviceGray" if out_mode == "L" else "/DeviceRGB"
        )
    img_obj[NameObject("/BitsPerComponent")] = NumberObject(8)
    # Remove keys that don't apply to DCTDecode
    for key in ("/DecodeParms", "/Interpolate", "/SMask", "/Mask"):
        img_obj.pop(NameObject(key), None)
    return True


def _drop_decode_cache(img_obj) -> None:
    """Release pypdf's cached decoded bytes for this image object.

    EncodedStreamObject.get_data() caches the full decoded stream in
    ``decoded_self`` — 100MB+ for the full-page scans this tool downsamples.
    Without this the whole run accumulates one cache entry per image
    (this exact pattern OOM-crashed a production instance). Mirrors
    pdf_to_word._drop_decode_cache; ``_data`` is deliberately NOT cleared
    here because compress rewrites it with the replacement JPEG bytes.
    """
    try:
        img_obj.decoded_self = None
    except Exception:
        pass


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

    target_dpi, jpeg_quality = _QUALITY_SETTINGS[quality]
    for img_obj, page_w_pt, page_h_pt in _iter_page_image_xobjects(writer):
        _process_image_object(
            img_obj,
            page_w_pt,
            page_h_pt,
            target_dpi,
            jpeg_quality,
            allow_inplace_jpeg=(quality == "low"),
            min_saving=0.20 if quality == "high" else 0.0,
        )
        # After the replacement is computed, release the decode cache so
        # the next image's 100MB+ decode does not accumulate.
        _drop_decode_cache(img_obj)

    out = ctx.new_output_path("compressed.pdf").with_suffix(".pdf")
    with out.open("wb") as f:
        writer.write(f)
    return out
