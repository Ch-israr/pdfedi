"""Compress PDFs to a target file size (court-filing workflow).

Strategy, in order of strength:
1. Rebuild the PDF with pypdf (drops unused objects, de-duplicates
   identical objects) — this alone shrinks many files.
2. If still over target, downscale + re-encode embedded images as JPEG at
   progressively lower scale/quality until the target is met or the
   strongest level is reached.

Honest limits, stated on the tool page: if a PDF has no images (text-only)
there is almost nothing to shrink, and if even the strongest image
downscale cannot reach the target the ZIP still contains the smallest
version plus a compression_report.txt saying the target was missed — it
never pretends it hit the target. Text-only PDFs already under the target
are returned rebuilt, unchanged in content.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, NumberObject

from pdfedi.tools._helpers import _pil_from_xobject, open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
    get_option,
)

# CM/ECF filing limits vary by court (roughly 3–200 MB). These are the
# common target sizes, not court-specific rules — the tool page tells the
# user to check their own court's local rule.
_TARGET_CHOICES = ["2", "5", "10", "25", "50"]

SPEC = ToolSpec(
    key="compress",
    name="Compress PDF",
    tagline="Shrink a PDF to a target size for filing",
    description=(
        "Compress a PDF down to a target file size — pick a size limit "
        "(for example 25 MB, the most common court e-filing limit) and the "
        "tool rebuilds the file and downscales embedded images until it "
        "fits, or returns the smallest version it can make. Upload 1–10 "
        "PDFs; results come back as a ZIP of compressed PDFs."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=10,
    options=[
        ToolOption(
            name="target_mb",
            kind="select",
            label="Target size (MB)",
            required=False,
            default="25",
            choices=_TARGET_CHOICES,
            help="Compress to at most this size. Court e-filing (CM/ECF) limits vary by court, roughly 3–200 MB — 25 MB is the most common. Check your court's local rule.",
        ),
    ],
    output_kind="zip",
    output_ext="zip",
    output_mime="application/zip",
    activity="optimizing",
    category="optimize",
)

# (image scale, JPEG quality) — tried in order until the target is met.
_LEVELS: list[tuple[float, int]] = [
    (1.0, 90),
    (1.0, 70),
    (0.75, 65),
    (0.5, 55),
    (0.35, 45),
    (0.25, 35),
]


def _replace_images(reader, scale: float, quality: int) -> int:
    """Downscale + JPEG re-encode embedded images in-place on reader pages.

    Returns the number of images replaced. Images that cannot be decoded,
    are 1-bit masks, or would not get smaller are left untouched.
    """
    from PIL import Image

    replaced = 0
    for page in reader.pages:
        try:
            resources = page.get("/Resources")
            if resources is None:
                continue
            resources = resources.get_object()
            xobjects = resources.get("/XObject")
            if xobjects is None:
                continue
            xobjects = xobjects.get_object()
        except Exception:
            continue
        for _name, ref in list(xobjects.items()):
            try:
                img_obj = ref.get_object()
            except Exception:
                continue
            try:
                if str(img_obj.get("/Subtype")) != "/Image":
                    continue
                if int(img_obj.get("/BitsPerComponent", 8)) == 1:
                    continue  # 1-bit masks — re-encoding would destroy them
                width = int(img_obj["/Width"])
                height = int(img_obj["/Height"])
                if width <= 0 or height <= 0:
                    continue
            except Exception:
                continue
            try:
                pil_image = _pil_from_xobject(img_obj)
            except Exception:
                continue
            if pil_image is None:
                continue
            try:
                if pil_image.mode == "CMYK":
                    pil_image = pil_image.convert("RGB")
                elif pil_image.mode not in ("RGB", "L"):
                    pil_image = pil_image.convert("RGB")
                new_w = max(1, int(width * scale))
                new_h = max(1, int(height * scale))
                if (new_w, new_h) != pil_image.size:
                    pil_image = pil_image.resize((new_w, new_h), Image.LANCZOS)
                buf = io.BytesIO()
                pil_image.save(buf, format="JPEG", quality=quality, optimize=True)
                jpeg = buf.getvalue()
                # Only replace if the re-encode is actually smaller than
                # the stored stream.
                try:
                    old_len = len(img_obj.get_data())
                except Exception:
                    old_len = 0
                if old_len and len(jpeg) >= old_len and scale >= 1.0:
                    continue
                stream = DecodedStreamObject()
                stream.set_data(jpeg)
                stream[NameObject("/Type")] = NameObject("/XObject")
                stream[NameObject("/Subtype")] = NameObject("/Image")
                stream[NameObject("/Width")] = NumberObject(new_w)
                stream[NameObject("/Height")] = NumberObject(new_h)
                stream[NameObject("/ColorSpace")] = (
                    NameObject("/DeviceGray")
                    if pil_image.mode == "L"
                    else NameObject("/DeviceRGB")
                )
                stream[NameObject("/BitsPerComponent")] = NumberObject(8)
                stream[NameObject("/Filter")] = NameObject("/DCTDecode")
                # A JPEG replacement has no soft mask / decode parms.
                for key in ("/SMask", "/DecodeParms", "/Decode"):
                    if key in stream:
                        del stream[key]
                xobjects[_name] = stream
                replaced += 1
            except Exception:
                continue
            finally:
                try:
                    pil_image.close()
                except Exception:
                    pass
    return replaced


def _rebuild(data: bytes, scale: float | None, quality: int) -> bytes:
    """Rebuild the PDF; optionally downscale images first."""
    reader = open_pdf_reader(data, "input.pdf")
    if scale is not None:
        _replace_images(reader, scale, quality)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    try:
        writer.compress_identical_objects()
    except Exception:
        pass
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def compress_to_target(data: bytes, target_bytes: int) -> tuple[bytes, bool]:
    """Return (pdf_bytes, met_target). Raises ToolError only for bad input."""
    # Level 0: plain rebuild, no image changes.
    best = _rebuild(data, None, 90)
    if len(best) <= target_bytes:
        return best, True
    # If the original was already smaller than the rebuild, keep original.
    if len(data) <= target_bytes and len(data) < len(best):
        return data, True
    for scale, quality in _LEVELS:
        attempt = _rebuild(data, scale, quality)
        if len(attempt) < len(best):
            best = attempt
        if len(best) <= target_bytes:
            return best, True
    return best, False


def run(ctx: ToolContext, options: dict) -> Path:
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    raw_target = get_option(options, SPEC, "target_mb")
    try:
        target_mb = int(raw_target)
    except (TypeError, ValueError):
        raise ToolError("Option 'target_mb' must be a number of MB.", code="invalid_option")
    if str(target_mb) not in _TARGET_CHOICES:
        raise ToolError(
            f"Option 'target_mb' must be one of {', '.join(_TARGET_CHOICES)} MB.",
            code="invalid_option",
        )
    target_bytes = target_mb * 1024 * 1024
    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")

    out = Path(str(ctx.new_output_path("compressed")) + ".zip")
    lines = [
        "PDFEDI compression report",
        f"Target: {target_mb} MB per file",
        "",
    ]
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for tool_input in ctx.inputs:
            data = tool_input.path.read_bytes()
            # Validate the PDF before compressing (raises ToolError).
            open_pdf_reader(data, tool_input.filename)
            compressed, met = compress_to_target(data, target_bytes)
            stem = Path(tool_input.filename).stem or "document"
            zf.writestr(f"{stem}_compressed.pdf", compressed)
            status = "OK — target met" if met else "TARGET MISSED — smallest version possible"
            lines.append(
                f"{tool_input.filename}: {len(data) / 1024 / 1024:.2f} MB -> "
                f"{len(compressed) / 1024 / 1024:.2f} MB — {status}"
            )
        lines.append("")
        lines.append(
            "If a target was missed, try a larger target or split the "
            "document first. Court e-filing limits vary by court."
        )
        zf.writestr("compression_report.txt", "\n".join(lines) + "\n")
    return out
