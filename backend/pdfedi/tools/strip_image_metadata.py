"""Strip image metadata (EXIF / GPS / XMP) with a before/after report.

Opens each image, lists the metadata it carries (camera make/model,
date taken, GPS coordinates, software, …), then re-saves it without
that metadata and reports what was removed.

Honest limit, stated on the tool page and in the report: this removes
standard EXIF/XMP/GPS metadata. It does NOT verify removal of C2PA or
AI-generation markers (JUMBF segments) — for C2PA/SynthID cleaning, use
ClearMark, which is built for that job.
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolSpec,
)

_SPEC_NOTE = (
    "Standard EXIF/XMP/GPS metadata was removed. C2PA / AI-generation "
    "markers were not verified as removed — use ClearMark for C2PA/SynthID "
    "cleaning."
)

SPEC = ToolSpec(
    key="strip_image_metadata",
    name="Strip Image Metadata",
    tagline="Remove EXIF and GPS from photos, with a report",
    description=(
        "Remove hidden metadata from photos — camera make and model, date "
        "taken, GPS location, software — and get a before/after report "
        "showing exactly what was removed. Upload 1–10 JPG, PNG or WebP "
        "images; results come back as a ZIP of cleaned images plus "
        "metadata_report.json. Note: C2PA/AI markers are not verified as "
        "removed by this tool."
    ),
    input_kinds=["image"],
    min_files=1,
    max_files=10,
    options=[],
    output_kind="zip",
    output_ext="zip",
    output_mime="application/zip",
    activity="processing",
    category="security",
)


def _readable_exif(img) -> dict[str, str]:
    """EXIF tags as {tag name: value} with GPS flagged, or {} if none."""
    from PIL.ExifTags import GPSTAGS, TAGS

    try:
        raw = img.getexif()
    except Exception:
        return {}
    out: dict[str, str] = {}
    if not raw:
        return out
    for tag_id, value in raw.items():
        name = TAGS.get(tag_id, f"Tag {tag_id}")
        if tag_id == 34853:  # GPSInfo
            try:
                gps = {
                    GPSTAGS.get(k, f"GPS {k}"): str(v)
                    for k, v in dict(value).items()
                }
                out["GPSInfo"] = json.dumps(gps, ensure_ascii=False)
            except Exception:
                out["GPSInfo"] = str(value)
        else:
            try:
                out[str(name)] = str(value)[:200]
            except Exception:
                continue
    return out


def run(ctx: ToolContext, options: dict) -> Path:
    from PIL import Image

    if not ctx.inputs:
        raise ToolError("No input file provided.", code="missing_input")
    report: dict[str, Any] = {"files": [], "note": _SPEC_NOTE}
    out = Path(str(ctx.new_output_path("images_stripped")) + ".zip")
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for tool_input in ctx.inputs:
            data = tool_input.path.read_bytes()
            try:
                img = Image.open(io.BytesIO(data))
                img.load()
            except Exception as exc:
                raise ToolError(
                    f"'{tool_input.filename}' is not a readable image: {exc}",
                    code="invalid_input",
                ) from exc
            fmt = (img.format or "").upper()
            if fmt not in ("JPEG", "PNG", "WEBP"):
                raise ToolError(
                    f"'{tool_input.filename}' is {fmt or 'an unknown format'}; "
                    "only JPG, PNG and WebP are supported.",
                    code="invalid_input",
                )
            before = _readable_exif(img)
            # Also record XMP/IPTC presence via img.info (PIL keeps them
            # there for PNG/JPEG when present).
            extra_before = sorted(
                key for key in ("exif", "icc_profile", "jfif", "dpi", "xmp")
                if key in img.info
            )
            buf = io.BytesIO()
            save_kwargs: dict[str, Any] = {}
            if fmt == "JPEG":
                save_kwargs = {"quality": 95, "subsampling": 0}
                # No exif= passed: PIL writes no APP1 EXIF segment.
            img.save(buf, format=fmt, **save_kwargs)
            cleaned = buf.getvalue()
            after_img = Image.open(io.BytesIO(cleaned))
            after = _readable_exif(after_img)
            stem = Path(tool_input.filename).stem or "image"
            ext = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}[fmt]
            zf.writestr(f"{stem}_clean.{ext}", cleaned)
            report["files"].append({
                "filename": tool_input.filename,
                "format": fmt,
                "before_exif": before,
                "before_other_info_keys": extra_before,
                "after_exif": after,
                "removed": sorted(before.keys()),
                "note": _SPEC_NOTE,
            })
            img.close()
    with zipfile.ZipFile(out, "a", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("metadata_report.json", json.dumps(report, indent=2) + "\n")
    return out
