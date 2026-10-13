"""Extract embedded images from a PDF and pack them into a ZIP archive."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, NameObject

from pdfedi.tools._helpers import open_pdf_reader
from pdfedi.tools.base import (
    ToolContext,
    ToolError,
    ToolOption,
    ToolSpec,
)

SPEC = ToolSpec(
    key="extract_images",
    name="Extract Images",
    tagline="Pull images out of a PDF",
    description=(
        "Extract every embedded image from a PDF — photos, logos, figures — "
        "and download them together as a ZIP archive. JPEG images keep their "
        "original bytes; other formats are exported as PNG."
    ),
    input_kinds=["pdf"],
    min_files=1,
    max_files=1,
    options=[],
    output_kind="zip",
    output_ext="zip",
    output_mime="application/zip",
    activity="converting",
    category="convert",
)


def _iter_image_xobjects(reader: PdfReader):
    """Yield each unique image XObject across all pages."""
    from pypdf.generic import IndirectObject

    seen: set[int] = set()
    for page in reader.pages:
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


def _pil_from_xobject(img_obj) -> Image.Image | None:
    """Decode an image XObject to a PIL image (JPEG opened directly,
    raw pixel data reconstructed via frombytes)."""
    try:
        data = img_obj.get_data()
    except Exception:
        return None

    filt = img_obj.get("/Filter")
    filters = list(filt) if isinstance(filt, ArrayObject) else [filt]
    if NameObject("/DCTDecode") in filters:
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
            return image
        except Exception:
            return None

    try:
        width = int(img_obj["/Width"])
        height = int(img_obj["/Height"])
        bpc = int(img_obj.get("/BitsPerComponent", 8))
        cs = img_obj.get("/ColorSpace")
    except Exception:
        return None
    cs_name = str(cs[0]) if isinstance(cs, ArrayObject) and cs else str(cs or "")

    mode = None
    if cs_name == "/DeviceRGB" and bpc == 8:
        mode = "RGB"
    elif cs_name == "/DeviceGray" and bpc == 8:
        mode = "L"
    elif cs_name == "/DeviceGray" and bpc == 1:
        mode = "1"
    elif cs_name == "/DeviceCMYK" and bpc == 8:
        mode = "CMYK"
    if mode is None:
        return None
    try:
        return Image.frombytes(mode, (width, height), data)
    except Exception:
        return None


def _original_bytes(img_obj) -> tuple[str, bytes] | None:
    """Return (extension, bytes) keeping the original encoding when it is a
    standard image format; otherwise decode and re-encode as PNG."""
    filt = img_obj.get("/Filter")
    filters = list(filt) if isinstance(filt, ArrayObject) else [filt]

    if NameObject("/DCTDecode") in filters:
        try:
            data = bytes(img_obj.get_data())
        except Exception:
            return None
        if data[:2] == b"\xff\xd8":
            return ("jpg", data)
    if NameObject("/JPXDecode") in filters:
        try:
            data = bytes(img_obj.get_data())
        except Exception:
            return None
        if data:
            return ("jp2", data)

    image = _pil_from_xobject(img_obj)
    if image is None:
        return None
    if image.mode == "CMYK":
        image = image.convert("RGB")
    elif image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    buf = io.BytesIO()
    image.save(buf, "PNG")
    return ("png", buf.getvalue())


def run(ctx: ToolContext, options: dict) -> Path:
    """Extract embedded images into a ZIP of image files."""
    if not isinstance(options, dict):
        raise ToolError("Options must be an object.", code="bad_options")
    if len(ctx.inputs) != 1:
        raise ToolError(
            f"Extract Images needs exactly 1 PDF file; got {len(ctx.inputs)}.",
            code="bad_input_count",
        )

    tool_input = ctx.inputs[0]
    reader = open_pdf_reader(tool_input.path.read_bytes(), tool_input.filename)

    images: list[tuple[str, bytes]] = []
    for img_obj in _iter_image_xobjects(reader):
        try:
            result = _original_bytes(img_obj)
        except Exception:
            continue
        if result is not None:
            images.append(result)

    if not images:
        raise ToolError(
            f"'{tool_input.filename}' contains no embedded images.",
            code="no_images",
        )

    out = ctx.new_output_path("images.zip").with_suffix(".zip")
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for i, (ext, data) in enumerate(images, start=1):
            zf.writestr(f"image-{i:03d}.{ext}", data)
    return out
