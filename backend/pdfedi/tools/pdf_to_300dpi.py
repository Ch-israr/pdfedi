"""Convert a PDF's embedded images to a target DPI for print.

Raises the *effective* DPI of embedded raster images to 300 (Print) or
600 (High-quality print) DPI. Effective DPI is what a print shop or a
preflight checker measures: image pixels divided by the size the image is
drawn at on the page. Images already at or above the target are left
untouched; images below it are upscaled (at most 2x per image) with
LANCZOS resampling and JPEG re-encoding.

Honest limits, stated on the tool page: raising DPI cannot add detail
that was not in the original image — it only raises the number that
print checkers read. Text and vector graphics have no DPI and are never
touched. This tool only increases DPI; downsampling is Compress's job.

What is skipped (counted honestly in the report, never silently broken):
1-bit images (JBIG2/CCITT), images with a soft mask (/SMask), images
used as someone else's soft mask, and images that cannot be decoded.
CMYK images are kept CMYK (a print-targeted tool must not convert them
to RGB the way Compress does).
"""
from __future__ import annotations

import io
import math
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import (
    ContentStream,
    DecodedStreamObject,
    NameObject,
    NumberObject,
)

from pdfedi.tools._helpers import _pil_from_xobject, open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

_TARGET_CHOICES = ["300", "600"]

SPEC = ToolSpec(
    key="pdf_to_300dpi",
    name="Convert PDF to 300 DPI",
    tagline="Raise image DPI for print",
    description=(
        "Raise the effective DPI of the images in your PDF to 300 DPI "
        "(or 600 for high-quality print) so it passes print-shop and "
        "portal checks. Images already at the target are left alone, and "
        "no image is upscaled more than 2x. Raising DPI cannot add detail "
        "that is not in the original — it fixes the number checkers read. "
        "Text and vector graphics are untouched."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[
        ToolOption(
            name="target_dpi",
            kind="select",
            label="Target DPI",
            required=False,
            default="300",
            choices=_TARGET_CHOICES,
            help="300 DPI is the print standard. 600 DPI is for high-quality print. Images below the target are upscaled (at most 2x); images already at or above it are left untouched.",
        ),
    ],
    output_kind="pdf",
    output_ext="pdf",
    output_mime="application/pdf",
    activity="optimizing",
    category="optimize",
)

# Safety caps: never produce an image larger than this.
_MAX_SIDE_PX = 10000
_MAX_PIXELS = 40_000_000
# JPEG quality for upscaled images.
_JPEG_QUALITY = 90
# Upscaling never exceeds this factor per image.
_MAX_UPSCALE = 2.0


def _resolve(obj):
    try:
        if hasattr(obj, "get_object"):
            return obj.get_object()
    except Exception:
        return None
    return obj


def _mat_mul(m1, m2):
    """Compose two PDF matrices (m1 applied first, then m2)."""
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    )


def _displayed_size(ctm):
    """Width/height in points of a unit square drawn under ``ctm``."""
    return math.hypot(ctm[0], ctm[1]), math.hypot(ctm[2], ctm[3])


class _ImageInfo:
    __slots__ = ("obj", "ref_key", "width", "height", "eff_dpi", "draw_area")

    def __init__(self, obj, ref_key, width, height, eff_dpi, draw_area):
        self.obj = obj
        self.ref_key = ref_key
        self.width = width
        self.height = height
        self.eff_dpi = eff_dpi
        self.draw_area = draw_area


def _walk_content(cs, resources, ctm, reader, out, depth=0):
    """Simulate a content stream, recording each image XObject's largest draw.

    ``out`` maps a stable image key to _ImageInfo (largest displayed area
    wins when the same image is drawn at several sizes). Form XObjects are
    followed recursively with their /Matrix composed into the CTM.
    """
    stack: list[tuple] = []
    xobjects = {}
    if isinstance(resources, dict):
        xobjects = _resolve(resources.get("/XObject")) or {}
        if not isinstance(xobjects, dict):
            xobjects = {}
    for operands, op in cs.operations:
        if op == b"q":
            stack.append(ctm)
        elif op == b"Q":
            if stack:
                ctm = stack.pop()
        elif op == b"cm":
            try:
                m = tuple(float(x) for x in operands)
                if len(m) != 6:
                    continue
            except Exception:
                continue
            ctm = _mat_mul(m, ctm)
        elif op == b"Do":
            if not operands:
                continue
            name = str(operands[0])
            ref = xobjects.get(name)
            if ref is None:
                continue
            obj = _resolve(ref)
            if not isinstance(obj, dict):
                continue
            subtype = str(obj.get("/Subtype", ""))
            if subtype == "/Image":
                try:
                    width = int(obj["/Width"])
                    height = int(obj["/Height"])
                except Exception:
                    continue
                if width <= 0 or height <= 0:
                    continue
                w_pt, h_pt = _displayed_size(ctm)
                if w_pt <= 0 or h_pt <= 0:
                    continue
                dpi = min(width / (w_pt / 72.0), height / (h_pt / 72.0))
                key = _image_key(ref, obj)
                area = w_pt * h_pt
                prev = out.get(key)
                if prev is None or area > prev.draw_area:
                    out[key] = _ImageInfo(obj, key, width, height, dpi, area)
            elif subtype == "/Form" and depth < 5:
                matrix = obj.get("/Matrix")
                try:
                    form_m = tuple(float(x) for x in matrix) if matrix else (1, 0, 0, 1, 0, 0)
                    if len(form_m) != 6:
                        form_m = (1, 0, 0, 1, 0, 0)
                except Exception:
                    form_m = (1, 0, 0, 1, 0, 0)
                form_res = _resolve(obj.get("/Resources")) or resources
                try:
                    sub = ContentStream(obj, reader)
                except Exception:
                    continue
                _walk_content(
                    sub, form_res, _mat_mul(form_m, ctm), reader, out, depth + 1
                )


def _image_key(ref, obj):
    """Stable key for an image XObject (indirect id when available)."""
    try:
        idnum = getattr(ref, "idnum", None)
        generation = getattr(ref, "generation", None)
        if idnum is not None:
            return (idnum, generation)
    except Exception:
        pass
    return ("direct", id(obj))


def _collect_smask_keys(reader):
    """Keys of every image XObject used as another image's soft mask."""
    keys = set()
    for page in reader.pages:
        try:
            resources = _resolve(page.get("/Resources"))
            if not isinstance(resources, dict):
                continue
            xobjects = _resolve(resources.get("/XObject")) or {}
            if not isinstance(xobjects, dict):
                continue
        except Exception:
            continue
        for ref in list(xobjects.values()):
            obj = _resolve(ref)
            if not isinstance(obj, dict):
                continue
            if str(obj.get("/Subtype", "")) != "/Image":
                continue
            smask = obj.get("/SMask")
            if smask is not None:
                keys.add(_image_key(smask, _resolve(smask)))
    return keys


def _measure_images(reader):
    """Return {key: _ImageInfo} for every image XObject drawn in the PDF."""
    out: dict = {}
    for page in reader.pages:
        try:
            resources = _resolve(page.get("/Resources"))
            cs = page.get_contents()
        except Exception:
            continue
        if cs is None:
            continue
        try:
            _walk_content(cs, resources, (1, 0, 0, 1, 0, 0), reader, out)
        except Exception:
            continue
    return out


def _upscale_images(reader, target_dpi):
    """Upscale below-target images in place. Returns a report dict."""
    from PIL import Image

    measured = _measure_images(reader)
    smask_keys = _collect_smask_keys(reader)
    report = {
        "total": len(measured),
        "upscaled": 0,
        "already_ok": 0,
        "skipped": 0,
        "skipped_reasons": {},
        "before_min": None,
        "before_max": None,
        "after_min": None,
        "after_max": None,
        "target_dpi": target_dpi,
    }
    if not measured:
        return report

    effs = [info.eff_dpi for info in measured.values()]
    report["before_min"] = min(effs)
    report["before_max"] = max(effs)

    for key, info in measured.items():
        obj = info.obj
        if info.eff_dpi >= target_dpi:
            report["already_ok"] += 1
            continue
        reason = None
        try:
            if int(obj.get("/BitsPerComponent", 8)) == 1:
                reason = "1-bit image"
            elif obj.get("/SMask") is not None:
                reason = "has soft mask"
            elif key in smask_keys:
                reason = "is a soft mask"
        except Exception:
            reason = "unreadable"
        if reason is None:
            try:
                pil_image = _pil_from_xobject(obj)
            except Exception:
                pil_image = None
            if pil_image is None:
                reason = "could not decode"
        if reason is not None:
            report["skipped"] += 1
            report["skipped_reasons"][reason] = (
                report["skipped_reasons"].get(reason, 0) + 1
            )
            continue
        try:
            scale = min(target_dpi / info.eff_dpi, _MAX_UPSCALE)
            new_w = max(1, int(round(info.width * scale)))
            new_h = max(1, int(round(info.height * scale)))
            # Pixel caps: shrink the scale to fit instead of refusing.
            if new_w > _MAX_SIDE_PX or new_h > _MAX_SIDE_PX or new_w * new_h > _MAX_PIXELS:
                fit = min(
                    _MAX_SIDE_PX / info.width,
                    _MAX_SIDE_PX / info.height,
                    math.sqrt(_MAX_PIXELS / (info.width * info.height)),
                )
                if fit <= 1.0:
                    report["skipped"] += 1
                    report["skipped_reasons"]["too large"] = (
                        report["skipped_reasons"].get("too large", 0) + 1
                    )
                    continue
                scale = fit
                new_w = max(1, int(round(info.width * scale)))
                new_h = max(1, int(round(info.height * scale)))
            mode = pil_image.mode
            if mode == "CMYK":
                colorspace = "/DeviceCMYK"
            elif mode == "L":
                colorspace = "/DeviceGray"
            elif mode == "RGB":
                colorspace = "/DeviceRGB"
            else:
                # Paletted / other modes: convert (loses nothing visible
                # for an upscale) rather than failing the job.
                pil_image = pil_image.convert("RGB")
                mode = "RGB"
                colorspace = "/DeviceRGB"
            if (new_w, new_h) != pil_image.size:
                pil_image = pil_image.resize((new_w, new_h), Image.LANCZOS)
            buf = io.BytesIO()
            pil_image.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
            jpeg = buf.getvalue()
            stream = DecodedStreamObject()
            stream.set_data(jpeg)
            stream[NameObject("/Type")] = NameObject("/XObject")
            stream[NameObject("/Subtype")] = NameObject("/Image")
            stream[NameObject("/Width")] = NumberObject(new_w)
            stream[NameObject("/Height")] = NumberObject(new_h)
            stream[NameObject("/ColorSpace")] = NameObject(colorspace)
            stream[NameObject("/BitsPerComponent")] = NumberObject(8)
            stream[NameObject("/Filter")] = NameObject("/DCTDecode")
            # The replacement carries no mask / decode params of its own.
            for drop in ("/SMask", "/SMaskInData", "/DecodeParms", "/Decode"):
                if drop in stream:
                    del stream[drop]
            # Replace the stream data in place so every draw of this
            # image (all pages) picks up the upscaled version.
            obj._data = stream.get_data()
            for attr in ("/Width", "/Height", "/ColorSpace", "/BitsPerComponent", "/Filter"):
                obj[NameObject(attr)] = stream[attr]
            for drop in ("/SMask", "/SMaskInData", "/DecodeParms", "/Decode", "/Intent"):
                if drop in obj:
                    del obj[NameObject(drop)]
            # pypdf caches decoded data on the object; drop it.
            try:
                obj.decoded_self = None
            except Exception:
                pass
            report["upscaled"] += 1
        except Exception:
            report["skipped"] += 1
            report["skipped_reasons"]["processing failed"] = (
                report["skipped_reasons"].get("processing failed", 0) + 1
            )
            continue
        finally:
            try:
                pil_image.close()
            except Exception:
                pass

    # Re-measure for the after-DPI numbers (replacement changed pixels).
    after = _measure_images(reader)
    if after:
        after_effs = [info.eff_dpi for info in after.values()]
        report["after_min"] = min(after_effs)
        report["after_max"] = max(after_effs)
    return report


def _report_text(report) -> str:
    target = report["target_dpi"]
    if report["total"] == 0:
        return (
            f"PDFEDI Convert to {target} DPI — no raster images found in "
            "this PDF, so nothing was changed. Text and vector graphics "
            "have no DPI."
        )
    parts = [
        f"PDFEDI Convert to {target} DPI — "
        f"{report['upscaled']} image(s) raised toward {target} DPI, "
        f"{report['already_ok']} already at or above {target} DPI"
    ]
    if report["skipped"]:
        reasons = ", ".join(
            f"{n} {r}" for r, n in sorted(report["skipped_reasons"].items())
        )
        parts.append(f", {report['skipped']} skipped ({reasons})")
    before = (
        f"Min effective DPI before: {report['before_min']:.0f}"
        if report["before_min"] is not None
        else "Min effective DPI before: n/a"
    )
    after = (
        f"after: {report['after_min']:.0f}"
        if report["after_min"] is not None
        else "after: n/a"
    )
    parts.append(f". {before}, {after}.")
    parts.append(
        " Raising DPI cannot add detail that was not in the original — "
        "it raises the effective DPI that print shops check."
    )
    return "".join(parts)


def run(ctx: ToolContext, options: dict) -> Path:
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    raw_target = get_option(options, SPEC, "target_dpi")
    try:
        target_dpi = int(raw_target)
    except (TypeError, ValueError):
        raise ToolError(
            "Option 'target_dpi' must be 300 or 600 DPI.", code="invalid_option"
        )
    if str(target_dpi) not in _TARGET_CHOICES:
        raise ToolError(
            "Option 'target_dpi' must be 300 or 600 DPI.", code="invalid_option"
        )
    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")

    data = ctx.inputs[0].path.read_bytes()
    reader = open_pdf_reader(
        data, ctx.inputs[0].filename, encrypted_code="invalid_input"
    )
    report = _upscale_images(reader, target_dpi)

    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    try:
        writer.compress_identical_objects()
    except Exception:
        pass
    # The DPI report lives in the output PDF's document properties.
    try:
        meta = dict(writer.metadata or {})
        meta["/Subject"] = _report_text(report)
        writer.add_metadata(meta)
    except Exception:
        pass

    out_path = ctx.new_output_path("300dpi.pdf")
    with open(out_path, "wb") as f:
        writer.write(f)
    return out_path
